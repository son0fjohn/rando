// Notes in the offline Supabase stub (test/stubs/supabase.js plugs it in):
// the RPCs of migrations/019_notes.sql with the same rules (snapped to the
// 20 m grid, 5 a day, 80 m to open / vote / react / report, one vote and one
// reaction per player, lifespan and landmarks, spots, reports hide at once,
// pending pictures for their author only, coins for upvotes capped at 10 a
// day), the two storage buckets, and a fake moderator for the
// moderate-note Edge Function. The real SQL is tested by test/notes_sql.mjs.
//
// State lives in the coin "server" (one IndexedDB state shared by every tab
// of the browser context, one call at a time), so a second phone in the same
// context sees the first one's notes. Pictures are kept as data: URLs.
//   window.__noteUploads   every upload's bytes (the tests look for EXIF / GPS in them)
//   stub-moderate-ms       (localStorage) how long the fake moderator takes (default 2500)
// The fake moderator passes a picture unless it's mostly magenta (#ff00ff:
// the tests' stand-in for nudity / violence), which it rejects.
// Every player's vote weighs 1 here (the trust weights are the SQL's).
import { snap, distM, spotFor, NOTE_SPOTS, NOTE_RULES, RANGE_M } from "/web/notegeo.js";
import { serverProblem } from "/web/notefilter.js";

export function notesStub({ me, verified, cstate, save, withState }) {
  const S = st => (st.notes ??= { list: [], votes: {}, reacts: {}, views: {}, reports: {}, bans: [], imgs: {} });
  const day0 = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
  const visible = (n, u) => ["live", "restored"].includes(n.status) && (n.landmark || n.expires > Date.now()) && (["none", "approved"].includes(n.image_state) || n.author === u);
  const near = (n, lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const c = snap(lat, lng);
    return !!c && distM(c, n) <= RANGE_M;
  };
  const card = (st, n) => {
    const u = me(), N = S(st);
    return { ok: true, id: n.id, kind: n.kind, body: n.body, top: n.top, bottom: n.bottom,
      image: n.image_state === "approved" ? `${n.id}.jpg` : null, upload: n.author === u ? n.image : null,
      image_state: n.author === u ? n.image_state : null, lat: n.lat, lng: n.lng,
      created_at: new Date(n.created).toISOString(), expires_at: new Date(n.expires).toISOString(), landmark: n.landmark,
      spot: NOTE_SPOTS.find(s => s.id === n.spot)?.name ?? null, score: Math.round(n.up - n.down), agree: n.agree, disagree: n.disagree,
      views: n.views, my_vote: N.votes[n.id]?.[u] ?? null, my_react: N.reacts[n.id]?.[u] ?? null, mine: n.author === u };
  };
  const recount = (st, n) => {
    const N = S(st), vs = Object.values(N.votes[n.id] ?? {}), rs = Object.values(N.reacts[n.id] ?? {});
    n.up = vs.filter(v => v === 1).length; n.down = vs.filter(v => v === -1).length;
    n.agree = rs.filter(r => r === 1).length; n.disagree = rs.filter(r => r === -1).length;
    const net = n.up - n.down, spot = !!n.spot;
    n.expires = Math.max(Date.now(), n.created + ((spot ? NOTE_RULES.SPOT_LIFE_DAYS : NOTE_RULES.LIFE_DAYS) + net) * 864e5);
    n.landmark = n.landmark || net * (spot ? NOTE_RULES.SPOT_VOTE_MUL : 1) >= NOTE_RULES.LANDMARK;
    const steps = Math.max(0, Math.floor(net / NOTE_RULES.COIN_EVERY));
    if (steps > n.paid) {
      const want = steps - n.paid; n.paid = steps;
      const today = st.ledger.filter(l => l.user === n.author && l.reason === "note" && l.t >= day0()).reduce((a, l) => a + l.delta, 0);
      const pay = Math.min(want, NOTE_RULES.COINS_PER_DAY - today);
      if (pay > 0 && n.authorVerified) st.ledger.push({ user: n.author, delta: pay, reason: "note", t: Date.now() });
    }
  };
  const find = (st, id) => S(st).list.find(n => n.id === id);
  const rpc = {
    note_spot_list: () => NOTE_SPOTS.map(({ id, name, lat, lng }) => ({ id, name, lat, lng })),
    notes_in_box: ({ p_s, p_w, p_n, p_e }) => {
      if (p_n < p_s || p_e < p_w || p_n - p_s > 0.2 || p_e - p_w > 0.25) throw new Error("bad box");
      const st = cstate(), u = me();
      return S(st).list.filter(n => n.lat >= p_s && n.lat <= p_n && n.lng >= p_w && n.lng <= p_e && visible(n, u))
        .sort((a, b) => (b.landmark - a.landmark) || (b.created - a.created)).slice(0, 300)
        .map(n => ({ id: n.id, kind: n.kind, lat: n.lat, lng: n.lng, landmark: n.landmark, spot: n.spot, mine: n.author === u,
          state: n.author === u && ["pending", "rejected"].includes(n.image_state) ? n.image_state : null }));
    },
    my_notes_left: () => Math.max(0, NOTE_RULES.PER_DAY - S(cstate()).list.filter(n => n.author === me() && n.created >= day0()).length),
    leave_note: ({ p_lat, p_lng, p_kind, p_body = null, p_top = null, p_bottom = null, p_image = null }) => {
      const st = cstate(), N = S(st), u = me();
      if (N.bans.includes(u)) return { ok: false, why: "banned" };
      if (!["text", "photo", "meme"].includes(p_kind)) throw new Error("bad kind");
      const clean = s => (s ?? "").trim() || null;
      p_body = clean(p_body); p_top = clean(p_top); p_bottom = clean(p_bottom);
      if (p_kind === "text" && (!p_body || p_image)) throw new Error("bad note");
      if (p_kind !== "text" && !(p_image ?? "").startsWith(`${u}/`)) throw new Error("bad image");
      if ([...(p_body ?? "")].length > 200 || [...(p_top ?? "")].length > 60 || [...(p_bottom ?? "")].length > 60) return { ok: false, why: "long" };
      const why = serverProblem(p_body ?? "") ?? serverProblem(p_top ?? "") ?? serverProblem(p_bottom ?? "");
      if (why) return { ok: false, why };
      const today = N.list.filter(n => n.author === u && n.created >= day0()).length;
      if (today >= NOTE_RULES.PER_DAY) return { ok: false, why: "limit", left: 0 };
      const c = snap(p_lat, p_lng), spot = spotFor(c);
      const n = { id: crypto.randomUUID(), author: u, authorVerified: true, kind: p_kind, body: p_body, top: p_top, bottom: p_bottom, image: p_image,
        image_state: p_image ? "pending" : "none", lat: c.lat, lng: c.lng, spot: spot?.id ?? null, created: Date.now(),
        expires: Date.now() + (spot ? NOTE_RULES.SPOT_LIFE_DAYS : NOTE_RULES.LIFE_DAYS) * 864e5, landmark: false,
        up: 0, down: 0, agree: 0, disagree: 0, views: 0, paid: 0, status: "live" };
      N.list.push(n); save(st);
      return { ...card(st, n), left: NOTE_RULES.PER_DAY - 1 - today };
    },
    open_note: ({ p_id, p_lat, p_lng }) => {
      const st = cstate(), N = S(st), u = me(), n = find(st, p_id);
      if (!n || !visible(n, u)) return { ok: false, why: "gone" };
      if (n.author !== u) {
        if (!near(n, p_lat, p_lng)) return { ok: false, why: "far" };
        const v = (N.views[n.id] ??= []);
        if (!v.includes(u)) { v.push(u); n.views++; save(st); }
      }
      return card(st, n);
    },
    vote_note: ({ p_id, p_lat, p_lng, p_v }) => {
      const st = cstate(), N = S(st), u = me(), n = find(st, p_id);
      if (![-1, 0, 1].includes(p_v)) throw new Error("bad vote");
      if (!n || !visible(n, u)) return { ok: false, why: "gone" };
      if (n.author === u) return { ok: false, why: "own" };
      if (!near(n, p_lat, p_lng)) return { ok: false, why: "far" };
      const vs = (N.votes[n.id] ??= {});
      if (p_v === 0) delete vs[u]; else vs[u] = p_v;
      recount(st, n); save(st);
      return card(st, n);
    },
    react_note: ({ p_id, p_lat, p_lng, p_r }) => {
      const st = cstate(), N = S(st), u = me(), n = find(st, p_id);
      if (![-1, 0, 1].includes(p_r)) throw new Error("bad reaction");
      if (!n || !visible(n, u)) return { ok: false, why: "gone" };
      if (n.author === u) return { ok: false, why: "own" };
      if (!near(n, p_lat, p_lng)) return { ok: false, why: "far" };
      const rs = (N.reacts[n.id] ??= {});
      if (p_r === 0) delete rs[u]; else rs[u] = p_r;
      recount(st, n); save(st);
      return card(st, n);
    },
    report_note: ({ p_id, p_lat, p_lng }) => {
      const st = cstate(), N = S(st), u = me(), n = find(st, p_id);
      if (!n || !visible(n, u)) return { ok: true };
      if (n.author !== u && !near(n, p_lat, p_lng)) return { ok: false, why: "far" };
      const r = (N.reports[n.id] ??= []);
      if (!r.includes(u)) r.push(u);
      if (n.status === "live") n.status = "reported";
      save(st);
      return { ok: true };
    },
    remove_my_note: ({ p_id }) => {
      const st = cstate(), N = S(st);
      N.list = N.list.filter(n => !(n.id === p_id && n.author === me()));
      save(st); return { ok: true };
    },
  };

  // the two buckets: note-uploads (private, your own folder) and notes (public, moderated copies)
  globalThis.__noteUploads ??= [];
  const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const storage = {
    from: bucket => ({
      async upload(path, blob, opts = {}) {
        if (bucket === "note-uploads" && !path.startsWith(`${me()}/`)) return { data: null, error: { message: "new row violates row-level security policy" } };
        if (bucket !== "note-uploads") return { data: null, error: { message: "not allowed" } };
        const bytes = new Uint8Array(await blob.arrayBuffer());
        globalThis.__noteUploads.push({ path, type: opts.contentType ?? blob.type, bytes: Array.from(bytes) });
        const url = await toDataUrl(blob);
        await withState(() => { const st = cstate(); S(st).imgs[`${bucket}/${path}`] = url; save(st); });
        return { data: { path }, error: null };
      },
      getPublicUrl(path) {
        const st = cstate();
        return { data: { publicUrl: bucket === "notes" ? st?.notes?.imgs?.[`notes/${path}`] ?? "" : "" } };
      },
      async createSignedUrl(path) {
        const url = await withState(() => {
          if (bucket === "note-uploads" && !path.startsWith(`${me()}/`)) return null;
          return cstate()?.notes?.imgs?.[`${bucket}/${path}`] ?? null;
        });
        return url ? { data: { signedUrl: url }, error: null } : { data: null, error: { message: "Object not found" } };
      },
    }),
  };

  // the moderate-note Edge Function, faked: a while later, pass or reject
  const mostlyMagenta = url => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = 32; c.height = 32;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      let hits = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] > 200) hits++;
      res(hits > 32 * 32 * 0.35);
    };
    img.onerror = () => res(true);       // can't be read: fail closed
    img.src = url;
  });
  const functions = {
    async invoke(name, { body } = {}) {
      if (name !== "moderate-note") return { data: null, error: { message: `function ${name} not stubbed` } };
      const ms = Number(localStorage.getItem("stub-moderate-ms") ?? 2500);
      setTimeout(async () => {
        const n = await withState(() => find(cstate(), body?.id));
        if (!n || n.image_state !== "pending") return;
        const url = await withState(() => cstate().notes.imgs[`note-uploads/${n.image}`]);
        const bad = !url || await mostlyMagenta(url);
        await withState(() => {
          const st = cstate(), x = find(st, n.id);
          if (!x || x.image_state !== "pending") return;
          x.image_state = bad ? "rejected" : "approved";
          if (!bad) S(st).imgs[`notes/${x.id}.jpg`] = url;
          save(st);
        });
      }, ms);
      return { data: { queued: true }, error: null };
    },
  };
  return { rpc, storage, functions };
}
