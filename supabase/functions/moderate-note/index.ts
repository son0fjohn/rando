// moderate-note: the image check a note's photo or meme must pass before
// anyone but its author sees it (supabase/migrations/019_notes.sql).
//
//   POST { "id": "<note id>" }   the app calls it right after leave_note
//   POST { "sweep": true }       re-checks up to 20 pending notes (a cron or a
//                                database webhook can call it as a safety net)
//
// For a pending note it reads the upload from the private `note-uploads`
// bucket (already stripped of metadata on the phone: web/noteimage.js), asks
// the provider, and then either copies it to the public `notes` bucket as
// `<note id>.jpg` (no user id in the name) and marks it approved, or marks it
// rejected and deletes the upload. If the provider can't be reached or has no
// key, the note stays pending (fail closed): nothing unchecked goes public.
//
// Providers (MODERATION_PROVIDER, default: openai if OPENAI_API_KEY is set,
// else google if GOOGLE_VISION_KEY is):
//   openai   omni-moderation-latest (https://api.openai.com/v1/moderations):
//            rejected when flagged for sexual, sexual/minors, violence,
//            violence/graphic, self-harm or hate categories
//   google   Cloud Vision SafeSearch (images:annotate): rejected when adult or
//            violence is LIKELY / VERY_LIKELY, or racy is VERY_LIKELY
//
// Deploy:  supabase functions deploy moderate-note
// Secrets: supabase secrets set OPENAI_API_KEY=sk-...        (or)
//          supabase secrets set MODERATION_PROVIDER=google GOOGLE_VISION_KEY=...
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set for every function by Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const url = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, service, { auth: { persistSession: false } });

type Verdict = { ok: boolean; why?: string } | null;   // null: couldn't decide (stay pending)

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function openai(jpeg: Uint8Array): Promise<Verdict> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const r = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "omni-moderation-latest", input: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64(jpeg)}` } }] }),
  });
  if (!r.ok) { console.warn("openai moderation", r.status, await r.text().catch(() => "")); return null; }
  const res = (await r.json()).results?.[0];
  if (!res) return null;
  const bad = Object.entries(res.categories ?? {}).filter(([k, v]) => v && /^(sexual|violence|self-harm|hate|harassment\/threatening)/.test(k)).map(([k]) => k);
  return bad.length ? { ok: false, why: bad.join(",") } : { ok: true };
}

async function google(jpeg: Uint8Array): Promise<Verdict> {
  const key = Deno.env.get("GOOGLE_VISION_KEY");
  if (!key) return null;
  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: b64(jpeg) }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }] }),
  });
  if (!r.ok) { console.warn("vision safesearch", r.status, await r.text().catch(() => "")); return null; }
  const s = (await r.json()).responses?.[0]?.safeSearchAnnotation;
  if (!s) return null;
  const likely = (v: string) => v === "LIKELY" || v === "VERY_LIKELY";
  const why = [likely(s.adult) && "adult", likely(s.violence) && "violence", s.racy === "VERY_LIKELY" && "racy"].filter(Boolean);
  return why.length ? { ok: false, why: why.join(",") } : { ok: true };
}

function provider(): (b: Uint8Array) => Promise<Verdict> {
  const p = Deno.env.get("MODERATION_PROVIDER") ?? (Deno.env.get("OPENAI_API_KEY") ? "openai" : "google");
  return p === "google" ? google : openai;
}

async function check(id: string): Promise<string> {
  const { data: n, error } = await db.from("notes").select("id, image, image_state").eq("id", id).maybeSingle();
  if (error || !n) return "no such note";
  if (n.image_state !== "pending" || !n.image) return n.image_state;
  const { data: file, error: e2 } = await db.storage.from("note-uploads").download(n.image);
  if (e2 || !file) return "pending (upload not readable yet)";
  const jpeg = new Uint8Array(await file.arrayBuffer());
  if (jpeg.length > 2_100_000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    await db.rpc("note_image_verdict", { p_id: n.id, p_ok: false });
    return "rejected (not a JPEG)";
  }
  let v: Verdict = null;
  try { v = await provider()(jpeg); } catch (e) { console.warn("moderation failed", e); }
  if (!v) return "pending (no verdict)";
  if (v.ok) {
    const { error: e3 } = await db.storage.from("notes").upload(`${n.id}.jpg`, jpeg, { contentType: "image/jpeg", upsert: true });
    if (e3) return `pending (copy failed: ${e3.message})`;
    await db.rpc("note_image_verdict", { p_id: n.id, p_ok: true });
    return "approved";
  }
  await db.rpc("note_image_verdict", { p_id: n.id, p_ok: false });
  await db.storage.from("note-uploads").remove([n.image]);
  console.log("rejected", n.id, v.why);
  return "rejected";
}

Deno.serve(async req => {
  // (the preflight: allow whatever headers this supabase-js asks for; newer
  // versions send more than the four listed below, and a refused preflight
  // means the picture is never checked)
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": req.headers.get("access-control-request-headers") ?? cors["access-control-allow-headers"] } });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.sweep) {
      const { data } = await db.from("notes").select("id").eq("image_state", "pending").lt("created_at", new Date(Date.now() - 60_000).toISOString()).limit(20);
      const out: Record<string, string> = {};
      for (const r of data ?? []) out[r.id] = await check(r.id);
      return json(out);
    }
    if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id)) return json({ error: "bad id" }, 400);
    return json({ state: await check(body.id) });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...cors } });
