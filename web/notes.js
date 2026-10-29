// Notes on the map: short notes anywhere public, the feel of Elden Ring's
// messages. A line of text, a photo or a meme, left where you stand (pinned
// to a ~20 m square, never your exact spot), found on the map from anywhere,
// read only within 80 m. Votes make a note live longer (or shorter); enough
// of them make it a permanent landmark. Spots the app already knows (the NPC
// venues, data/heroes.json) gather notes into small hubs.
// docs/notes.md has the whole design; the rules live in SQL
// (supabase/migrations/019_notes.sql), the pure parts in notegeo.js /
// notefilter.js / noteimage.js.
//
// Privacy, here on the phone:
//   * your position is read on the phone and snapped to the 20 m grid
//     (notegeo.js snap) before it goes anywhere; only the snapped cell is
//     sent (open / vote / react / report / leave), and the server keeps none
//     of it but a note's own (snapped) position
//   * markers come from the box the map is showing, never "near me"
//   * photos are redrawn on a canvas and re-encoded (noteimage.js): no EXIF,
//     no GPS. They stay pending (yours only) until the moderation check passes
//   * the public-places check (no notes at anyone's home) runs on the
//     phone's own copy of the map data
//   * no analytics events of its own (so nothing about notes reaches
//     analytics: no place, no id, nothing typed)
//
//   backend.js: import("./notes.js").then(m => m.notes.init(sb))
import { world3d } from "./world3d.js";
import { t, lang, onLang } from "./i18n.js";
import { esc } from "./hpkit.js";
import { sfx } from "./fx.js";
import { askPermission, permState, toast } from "./permissions.js";
import { onboard } from "./onboard.js";
import { snap, distM, RANGE_M, placeVerdict, toLocal, NOTE_RULES, NOTE_SPOTS } from "./notegeo.js";
import { checkNote } from "./notefilter.js";
import { cleanImage, hasMetadata, decode, render } from "./noteimage.js";
import { PMTiles, gunzip } from "./pmtiles.js";
import { tileStore } from "./citycache.js";
import { lngLatToTile, tileToLngLat } from "./citygen.js";
import { omtChunks, OMT_Z } from "./cityomt.js";

const Q = () => new URLSearchParams(location.search);    // read fresh: the tests move ?devlat with history.replaceState
const HUB_DIST = 200;           // camera distance (world units) past which a spot's notes fold into one hub (the zoom goes to 230)
const LIFT = 7;                 // a marker floats this far over the street (world units)
const REFRESH_MS = 1200;

const ICON = {
  text: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 5 4z"/><path class="ln" d="M7.5 8.5h9M7.5 12h6"/></svg>`,
  photo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3.2L9 5h6l1.8 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle class="ln" cx="12" cy="13" r="3.4"/></svg>`,
  meme: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path class="ln" d="M7 8h10M7 16h10"/><circle class="ln" cx="9.5" cy="12" r=".9"/><circle class="ln" cx="14.5" cy="12" r=".9"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5l7 8h-4.5v6h-5v-6H5z"/></svg>`,
  down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19l-7-8h4.5V5h5v6H19z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
};

let sb = null, layer = null, leaveBtn = null, hubs = new Map(), spots = NOTE_SPOTS;
const markers = new Map();          // id -> { el, n, pos, near }
let gen = 0;                        // bumped by our own changes, so a box answer from before them is dropped
let shown = false, lastBox = null, lastFetch = 0, fetching = false, origin = "", myCell = null, devKey = "", watchId = null, watchPos = null;

// ---------------------------------------------------------------- where you are (on the phone only)
// the raw position never leaves this module; callers get it snapped
async function hereRaw({ ask = false } = {}) {
  const q = Q();
  if (q.get("devlat") && q.get("devlng")) return { lat: Number(q.get("devlat")), lng: Number(q.get("devlng")) };
  if (watchPos) return watchPos;
  if (!navigator.geolocation) return null;
  const st = await permState("location");
  if (st !== "granted") {
    if (!ask || !(await askPermission("location", { body: t("notes.perm") }))) return null;
  }
  try {
    const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 12000, maximumAge: 20000, enableHighAccuracy: true }));
    watchPos = { lat: p.coords.latitude, lng: p.coords.longitude };
    follow();
    return watchPos;
  } catch { return null; }
}
// keep the in-range rings honest while you walk (only once location is allowed)
function follow() {
  if (watchId != null || !navigator.geolocation?.watchPosition) return;
  watchId = navigator.geolocation.watchPosition(p => { watchPos = { lat: p.coords.latitude, lng: p.coords.longitude }; updateNear(); },
    () => {}, { enableHighAccuracy: true, maximumAge: 15000 });
}
async function hereCell(opts) { const p = await hereRaw(opts); return p ? { cell: snap(p.lat, p.lng), raw: p } : null; }

// ---------------------------------------------------------------- the server
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
async function myId() { return (await sb.auth.getSession()).data.session?.user?.id ?? null; }

// ---------------------------------------------------------------- markers
function screenOn() {
  const nav = document.getElementById("navbar"), b = document.body.classList;
  return !!nav && !nav.hidden && !b.contains("onb-on") && !b.contains("in-lobby") && !b.contains("hp-on-map") && !world3d.paused
    && document.getElementById("style-screen")?.hidden !== false;
}
function ensureLayer() {
  if (layer || !world3d.frame) return;
  layer = document.createElement("div");
  layer.id = "notes-layer";
  world3d.frame.appendChild(layer);
  leaveBtn = document.createElement("button");
  leaveBtn.type = "button";
  leaveBtn.id = "notes-leave";
  leaveBtn.className = "glass-icon";             // round, bottom-right of the map (theme.css "Notes")
  leaveBtn.innerHTML = `<span aria-hidden="true">📝</span>`;
  leaveBtn.addEventListener("click", e => { e.stopPropagation(); leave(); });
  world3d.frame.appendChild(leaveBtn);
  label();
  world3d.tickHooks.push(place);
}
function label() { if (leaveBtn) { leaveBtn.setAttribute("aria-label", t("notes.leave")); leaveBtn.title = t("notes.leave"); } }

// the map's visible ground, as a lat/lng box: the screen's corners cast onto
// the street, cut where the map's haze is total (nothing past it shows)
function viewBox() {
  const cam = world3d.camera, V = cam.position.constructor;
  const T = world3d.target, y0 = T.y;
  const R = world3d.rangeOn ? world3d.fogR : Infinity;
  const pts = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [-1, 0.6], [1, 0.6]]) {
    const d = new V(sx, sy, 0.5).unproject(cam).sub(cam.position).normalize();
    let k = d.y < -0.02 ? (y0 - cam.position.y) / d.y : 1800;
    k = Math.min(k, 1800);
    const p = cam.position.clone().add(d.multiplyScalar(k));
    const r = Math.hypot(p.x - T.x, p.z - T.z);
    if (r > R) { p.x = T.x + (p.x - T.x) * R / r; p.z = T.z + (p.z - T.z) * R / r; }
    pts.push(world3d.ungeo(p.x, p.z));
  }
  let s = Math.min(...pts.map(p => p[0])), n = Math.max(...pts.map(p => p[0]));
  let w = Math.min(...pts.map(p => p[1])), e = Math.max(...pts.map(p => p[1]));
  const pl = (n - s) * 0.12 + 0.0005, pg = (e - w) * 0.12 + 0.0005;
  s -= pl; n += pl; w -= pg; e += pg;
  const cl = (a, b, max) => { if (b - a <= max) return [a, b]; const m = (a + b) / 2; return [m - max / 2, m + max / 2]; };
  [s, n] = cl(s, n, 0.18); [w, e] = cl(w, e, 0.22);
  return { s, w, n, e };
}

async function refresh(force = false) {
  if (fetching || !sb) return;
  const now = Date.now();
  const b = viewBox();
  const moved = !lastBox || Math.abs(b.s - lastBox.s) + Math.abs(b.n - lastBox.n) + Math.abs(b.w - lastBox.w) + Math.abs(b.e - lastBox.e) > (lastBox.n - lastBox.s) * 0.15;
  if (!force && !moved && now - lastFetch < 20000) return;
  fetching = true;
  const g = gen;
  try {
    const list = await rpc("notes_in_box", { p_s: b.s, p_w: b.w, p_n: b.n, p_e: b.e });
    if (g !== gen) { lastFetch = 0; return; }     // a note was left / reported meanwhile: this answer is stale
    lastBox = b; lastFetch = now;
    sync(list ?? [], b);
  } catch (e) { if (!/sign in/.test(e.message)) console.warn("[notes] markers:", e.message); }
  finally { fetching = false; }
}

function pinHtml(n) {
  return `<span class="np-ring"></span><span class="np-pin">${n.landmark ? ICON.star : ICON[n.kind] ?? ICON.text}</span>${n.mine ? `<span class="np-me"></span>` : ""}`;
}
function sync(list, box) {
  const seen = new Set();
  for (const n of list) {
    seen.add(n.id);
    let m = markers.get(n.id);
    if (!m) {
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.id = n.id;
      el.addEventListener("click", e => { e.stopPropagation(); tapNote(n.id); });
      layer.appendChild(el);
      m = { el, n: null, pos: null, near: false };
      markers.set(n.id, m);
    }
    const key = `${n.kind}|${n.landmark}|${n.mine}|${n.state}`;
    if (m.key !== key) {
      m.el.className = `note-pin k-${n.kind}${n.landmark ? " landmark" : ""}${n.mine ? " mine" : ""}${n.state ? ` ${n.state}` : ""}`;
      m.el.innerHTML = pinHtml(n);
      m.el.setAttribute("aria-label", t(n.landmark ? "notes.aria.landmark" : `notes.aria.${n.kind}`));
      m.key = key;
    }
    m.n = n; m.pos = null;
  }
  // forget the ones in this box that are gone (expired, reported, taken down)
  for (const [id, m] of markers) {
    const inBox = m.n.lat >= box.s && m.n.lat <= box.n && m.n.lng >= box.w && m.n.lng <= box.e;
    if (inBox && !seen.has(id)) drop(id);
  }
  updateNear();
  world3d.needsRender = true;
}
function drop(id) { gen++; const m = markers.get(id); if (!m) return; m.el.remove(); markers.delete(id); }

// in range: a soft glowing ring (your snapped cell to theirs, as the server measures)
function updateNear() {
  const p = Q().get("devlat") ? { lat: +Q().get("devlat"), lng: +Q().get("devlng") } : watchPos;
  myCell = p ? snap(p.lat, p.lng) : null;
  for (const m of markers.values()) {
    const near = !!myCell && distM(myCell, m.n) <= RANGE_M;
    if (near !== m.near) { m.near = near; m.el.classList.toggle("near", near); }
  }
}

// every frame: each marker on screen (scaled a little by distance), the spot hubs when zoomed out
function place() {
  if (!layer) return;
  const on = shown;
  if (!on) return;
  const o = world3d.ungeo(0, 0).join();
  if (o !== origin) { origin = o; for (const m of markers.values()) m.pos = null; for (const h of hubs.values()) h.pos = null; }
  const cam = world3d.camera, W = world3d.frame.clientWidth, H = world3d.frame.clientHeight;
  const folded = world3d.cam.dist > HUB_DIST;
  // the hubs: a spot with 2+ notes, while zoomed out
  const bySpot = new Map();
  if (folded) for (const m of markers.values()) if (m.n.spot && !m.n.landmark) (bySpot.get(m.n.spot) ?? bySpot.set(m.n.spot, []).get(m.n.spot)).push(m);
  for (const [sp, list] of bySpot) if (list.length < 2) bySpot.delete(sp);
  for (const [id, h] of hubs) if (!bySpot.has(id)) { h.el.remove(); hubs.delete(id); }
  for (const [id, list] of bySpot) {
    let h = hubs.get(id);
    if (!h) {
      const s = spots.find(x => x.id === id);
      if (!s) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "note-hub";
      el.addEventListener("click", e => { e.stopPropagation(); zoomTo(s); });
      layer.appendChild(el);
      h = { el, s, pos: null, n: 0 };
      hubs.set(id, h);
    }
    if (h.n !== list.length) { h.n = list.length; h.el.innerHTML = `<span class="nh-in glass"><span class="nh-n">${list.length}</span><span class="nh-t">${esc(h.s.name)}</span></span>`; h.el.setAttribute("aria-label", t("notes.hub", { n: list.length })); }
    h.pos ??= lift(world3d.geo(h.s.lat, h.s.lng));
    put(h.el, h.pos, cam, W, H, 1);
  }
  for (const m of markers.values()) {
    if (folded && m.n.spot && bySpot.has(m.n.spot)) { m.el.style.display = "none"; continue; }
    m.pos ??= lift(world3d.geo(m.n.lat, m.n.lng));
    put(m.el, m.pos, cam, W, H);
  }
}
const lift = p => { p.y += LIFT; return p; };
function put(el, pos, cam, W, H, kMin = 0.62) {
  const v = pos.clone().project(cam);
  const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
  const fade = world3d.rangeFade?.(pos) ?? 1;    // past the map's haze: gone with the rest
  if (v.z > 1 || fade <= 0.02 || x < -30 || x > W + 30 || y < -30 || y > H + 30) { el.style.display = "none"; return; }
  const dist = cam.position.distanceTo(pos);
  const k = Math.max(kMin, Math.min(1.15, 210 / dist));
  el.style.display = "";
  el.style.opacity = fade >= 0.99 ? "" : fade.toFixed(2);
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${k.toFixed(3)})`;
  el.style.zIndex = String(Math.round(4000 - dist));
}
function zoomTo(s) {
  sfx.tick?.();
  const p = world3d.geo(s.lat, s.lng);
  world3d.observing = true;
  world3d.target.set(p.x, p.y, p.z);
  world3d.camGoal = { ...world3d.cam, dist: 150 };
  world3d.applyCamera();
}

// ---------------------------------------------------------------- reading a note
let card = null;
function closeCard() { if (!card) return; const c = card; card = null; c.classList.add("out"); setTimeout(() => c.remove(), 220); }
function scrim(cls, html) {
  const el = document.createElement("div");
  el.className = `notes-scrim glass-scrim ${cls}`;
  el.innerHTML = html;
  el.addEventListener("click", e => { if (e.target === el) { sfx.back?.(); close(el); } });
  document.body.appendChild(el);
  return el;
}
function close(el) { if (el === card) closeCard(); else { el.classList.add("out"); setTimeout(() => el.remove(), 220); } }

async function tapNote(id) {
  const m = markers.get(id);
  if (!m) return;
  let here = null;
  if (!m.n.mine) {
    here = await hereCell({ ask: true });
    if (!here) { toast(t("notes.needLoc")); return; }
    if (distM(here.cell, m.n) > RANGE_M) { sfx.back?.(); toast(t("notes.closer")); return; }
  }
  const at = here?.cell ?? { lat: m.n.lat, lng: m.n.lng };
  let res;
  try { res = await rpc("open_note", { p_id: id, p_lat: at.lat, p_lng: at.lng }); }
  catch (e) { toast(t("notes.why.other")); return; }
  if (!res?.ok) { toast(t(res?.why === "far" ? "notes.closer" : "notes.why.gone")); if (res?.why === "gone") drop(id); return; }
  sfx.open?.();
  showCard(res, at);
}

const ago = iso => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return t("notes.ago.now");
  if (s < 3600) return t("notes.ago.m", { n: Math.round(s / 60) });
  if (s < 86400 * 1.5) return t("notes.ago.h", { n: Math.round(s / 3600) });
  return t("notes.ago.d", { n: Math.round(s / 86400) });
};
const left = iso => {
  const s = Math.max(0, (new Date(iso).getTime() - Date.now()) / 1000);
  return s >= 86400 * 1.5 ? t("notes.dur.d", { n: Math.round(s / 86400) }) : t("notes.dur.h", { n: Math.max(1, Math.round(s / 3600)) });
};
async function imageUrl(n) {
  if (n.image) return sb.storage.from("notes").getPublicUrl(n.image).data?.publicUrl ?? null;
  if (n.upload) { const { data } = await sb.storage.from("note-uploads").createSignedUrl(n.upload, 600); return data?.signedUrl ?? null; }
  return null;
}

function showCard(n, at) {
  closeCard();
  const el = card = scrim("note-open", `<div class="glass glass-sheet note-card" role="dialog" aria-label="${esc(t("notes.aria." + n.kind))}"></div>`);
  const body = el.querySelector(".note-card");
  const draw = async () => {
    const pic = n.kind !== "text" ? `<div class="nc-pic${n.image_state && n.image_state !== "approved" ? " " + n.image_state : ""}"><img alt="" decoding="async"></div>` : "";
    const badge = n.landmark ? `<span class="nc-badge gold">${ICON.star}${esc(t("notes.landmark"))}</span>` : "";
    body.innerHTML = `
      <div class="nc-top">
        <span class="nc-kind">${ICON[n.kind]}</span>
        <span class="nc-where">${esc(n.mine ? t("notes.mine") : n.spot ? n.spot : t("notes.note"))}</span>${badge}
        <button type="button" class="glass-icon sm nc-x" aria-label="${esc(t("notes.close"))}">${ICON.x}</button>
      </div>
      ${n.image_state === "pending" ? `<p class="nc-state">${esc(t("notes.pending"))}</p>` : n.image_state === "rejected" ? `<p class="nc-state bad">${esc(t("notes.rejected"))}</p>` : ""}
      ${pic}
      ${n.body ? `<p class="nc-text">${esc(n.body)}</p>` : ""}
      <p class="nc-meta">${esc(ago(n.created_at))} · ${esc(t(n.views === 1 ? "notes.view1" : "notes.views", { n: n.views }))} · ${esc(n.landmark ? t("notes.forever") : t("notes.fades", { t: left(n.expires_at) }))}</p>
      <div class="nc-react">
        <div class="nc-vote" role="group" aria-label="${esc(t("notes.score"))}">
          <button type="button" class="glass-icon sm nc-up${n.my_vote === 1 ? " on" : ""}" aria-label="${esc(t("notes.up"))}" aria-pressed="${n.my_vote === 1}" ${n.mine ? "disabled" : ""}>${ICON.up}</button>
          <b class="nc-score" aria-live="polite">${n.score > 0 ? "+" : ""}${n.score}</b>
          <button type="button" class="glass-icon sm nc-down${n.my_vote === -1 ? " on" : ""}" aria-label="${esc(t("notes.down"))}" aria-pressed="${n.my_vote === -1}" ${n.mine ? "disabled" : ""}>${ICON.down}</button>
        </div>
        <button type="button" class="glass-btn clear xs fit nc-agree${n.my_react === 1 ? " on" : ""}" aria-pressed="${n.my_react === 1}" ${n.mine ? "disabled" : ""}>${esc(t("notes.agree"))} <b>${n.agree}</b></button>
        <button type="button" class="glass-btn clear xs fit nc-disagree${n.my_react === -1 ? " on" : ""}" aria-pressed="${n.my_react === -1}" ${n.mine ? "disabled" : ""}>${esc(t("notes.disagree"))} <b>${n.disagree}</b></button>
      </div>
      <div class="nc-foot">
        ${n.mine ? `<button type="button" class="nc-link nc-remove">${esc(t("notes.remove"))}</button>` : `<button type="button" class="nc-link nc-report">${esc(t("notes.report"))}</button>`}
      </div>`;
    body.querySelector(".nc-x").onclick = () => { sfx.back?.(); closeCard(); };
    const img = body.querySelector(".nc-pic img");
    if (img) imageUrl(n).then(u => { if (u) img.src = u; }).catch(() => {});
    const act = async (fn, args) => {
      try {
        const r = await rpc(fn, { p_id: n.id, p_lat: at.lat, p_lng: at.lng, ...args });
        if (!r?.ok) { toast(t(r?.why === "far" ? "notes.closer" : r?.why === "own" ? "notes.own" : "notes.why.gone")); return; }
        n = { ...n, ...r }; sfx.tick?.(); draw();
      } catch { toast(t("notes.why.other")); }
    };
    body.querySelector(".nc-up").onclick = () => { act("vote_note", { p_v: n.my_vote === 1 ? 0 : 1 }); };
    body.querySelector(".nc-down").onclick = () => { act("vote_note", { p_v: n.my_vote === -1 ? 0 : -1 }); };
    body.querySelector(".nc-agree").onclick = () => act("react_note", { p_r: n.my_react === 1 ? 0 : 1 });
    body.querySelector(".nc-disagree").onclick = () => act("react_note", { p_r: n.my_react === -1 ? 0 : -1 });
    body.querySelector(".nc-report")?.addEventListener("click", () => confirmReport(n, at));
    body.querySelector(".nc-remove")?.addEventListener("click", async () => {
      try { await rpc("remove_my_note", { p_id: n.id }); drop(n.id); closeCard(); toast(t("notes.removed")); } catch { toast(t("notes.why.other")); }
    });
  };
  draw();
}

function confirmReport(n, at) {
  const el = scrim("note-confirm", `<div class="glass glass-dialog" role="alertdialog" aria-labelledby="nr-t">
      <b id="nr-t">${esc(t("notes.reportQ"))}</b>
      <p>${esc(t("notes.reportSub"))}</p>
      <div class="glass-row"><button type="button" class="glass-btn clear sm" data-no>${esc(t("notes.cancel"))}</button><button type="button" class="glass-btn gold sm" data-yes>${esc(t("notes.report"))}</button></div>
    </div>`);
  el.querySelector("[data-no]").onclick = () => { sfx.back?.(); close(el); };
  el.querySelector("[data-yes]").onclick = async () => {
    try {
      const r = await rpc("report_note", { p_id: n.id, p_lat: at.lat, p_lng: at.lng });
      close(el);
      if (!r?.ok) { toast(t(r?.why === "far" ? "notes.closer" : "notes.why.other")); return; }
      drop(n.id); closeCard(); sfx.whoosh?.();
      toast(t("notes.reported"));
    } catch { close(el); toast(t("notes.why.other")); }
  };
}

// ---------------------------------------------------------------- public places only (the phone's own map data)
const ITAEWON = { lat: 37.5346, lng: 126.9946 }, U_PER_M = 0.55;
let itaewonB = null, pm = null, store = null, omtTpl = null;
const omtCache = new Map();
function cityUrl() { return Q().get("tiles") || "tiles/cities.pmtiles"; }
async function chunk(x, y) {
  pm ??= new PMTiles(new URL(cityUrl(), document.baseURI).href);
  store ??= tileStore(cityUrl());
  const k = `16/${x}/${y}`;
  let bytes = await store.get(k), failed = false;
  if (!bytes) { bytes = await pm.tile(16, x, y).catch(() => { failed = true; return null; }); if (bytes) store.put(k, bytes); }
  let p = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  if (!p || p.cut) {
    const w = await omtChunk(x, y).catch(() => undefined);
    if (w === undefined && !p) return failed ? undefined : null;
    if (w) p = p ? { ...p, b: [...(p.b ?? []), ...(w.b ?? [])], a: [...(p.a ?? []), ...(w.a ?? [])] } : w;
  }
  return p;
}
// the worldwide OpenMapTiles fallback (cityomt.js), as the city worker reads it
async function omtChunk(x16, y16) {
  const src = Q().get("omt") === "0" ? null : Q().get("omt") || "https://tiles.openfreemap.org/planet";
  if (!src) return null;
  const x14 = x16 >> 2, y14 = y16 >> 2, k = `${x14},${y14}`;
  if (!omtCache.has(k)) {
    omtCache.set(k, (async () => {
      const key = `omt/${OMT_Z}/${x14}/${y14}`;
      let bytes = await store.get(key);
      if (!bytes) {
        omtTpl ??= src.includes("{z}") ? Promise.resolve(src)
          : fetch(src).then(r => r.json()).then(tj => new URL(tj.tiles[0], src).href.replace(/%7B/g, "{").replace(/%7D/g, "}"));
        const url = (await omtTpl).replace("{z}", OMT_Z).replace("{x}", x14).replace("{y}", y14);
        const r = await fetch(url);
        if (r.status === 204 || r.status === 404) return new Map();
        if (!r.ok) throw new Error(`omt ${r.status}`);
        bytes = new Uint8Array(await r.arrayBuffer());
        store.put(key, bytes);
      }
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await gunzip(bytes));
      return omtChunks(bytes, x14, y14);
    })().catch(e => { omtCache.delete(k); omtTpl = null; throw e; }));
  }
  return (await omtCache.get(k)).get(`${x16},${y16}`) ?? null;
}
// the buildings and areas round a cell, in metres from its centre; null when no map data could be read
export async function placeShapes(cell) {
  const out = { buildings: [], areas: [] };
  let any = false;
  const dIt = distM(cell, ITAEWON);
  // Itaewon's hand-made buildings (world units from the station, 0.55 a metre, north = -z)
  if (dIt < 1600) {
    const bs = await (itaewonB ??= fetch("buildings.json").then(r => r.json()).then(j => j.buildings).catch(() => { itaewonB = null; return null; }));
    if (bs) {
      any = true;
      const [cx, cy] = toLocal(ITAEWON, cell.lat, cell.lng);
      for (const b of bs) {
        const [x0, z0] = b.p[0];
        if (Math.abs(x0 / U_PER_M - cx) > 150 || Math.abs(-z0 / U_PER_M - cy) > 150) continue;
        out.buildings.push({ ring: b.p.map(([x, z]) => [x / U_PER_M - cx, -z / U_PER_M - cy]), kind: b.cls ?? "mixed" });
      }
    }
  }
  // the procedural city (where the hand-made buildings end, and everywhere else)
  if (dIt > 1350) {
    const tiles = new Set();
    for (const [dx, dy] of [[0, 0], [-45, -45], [45, -45], [45, 45], [-45, 45]]) {
      const lat = cell.lat + dy / 110540, lng = cell.lng + dx / (111320 * Math.cos(cell.lat * Math.PI / 180));
      const [fx, fy] = lngLatToTile(lng, lat, 16);
      tiles.add(`${Math.floor(fx)},${Math.floor(fy)}`);
    }
    for (const k of tiles) {
      const [x, y] = k.split(",").map(Number);
      const p = await chunk(x, y);
      if (p === undefined) continue;          // couldn't be read (offline)
      any = true;
      if (!p) continue;                       // read, and nothing there
      const ring = q => { const r = []; for (let i = 0; i < q.length; i += 2) { const [lng, lat] = tileToLngLat(16, x, y, q[i], q[i + 1]); r.push(toLocal(cell, lat, lng)); } return r; };
      for (const b of p.b ?? []) out.buildings.push({ ring: ring(b.p), kind: b.k });
      for (const a of p.a ?? []) if (a.k === "residential") out.areas.push({ ring: ring(a.p), kind: a.k });
    }
  }
  return any ? out : null;
}

// ---------------------------------------------------------------- leaving a note
let busy = false, step = "";
async function leave() {
  if (busy) return;
  busy = true;
  sfx.confirm?.();
  try {
    step = "verify";
    // (no onboarding UI, ?onb=0: the gate can't ask; the server still refuses unverified accounts)
    if (!(await onboard.requireVerified("notes").catch(() => true))) return;
    step = "locate";
    const here = await hereCell({ ask: true });
    if (!here) { toast(t("notes.needLoc")); return; }
    step = "map data";
    const shapes = await placeShapes(here.cell).catch(() => null);
    if (!shapes) { toast(t("notes.cantCheck")); return; }
    const raw = toLocal(here.cell, here.raw.lat, here.raw.lng);
    const v = placeVerdict(shapes, raw);
    if (!v.ok) { blocked(); return; }
    step = "limit";
    let n = NOTE_RULES.PER_DAY;
    try { n = await rpc("my_notes_left"); } catch {}
    if (n <= 0) { sfx.back?.(); toast(t("notes.limit")); return; }
    step = "composer";
    composer(here.cell, n);
  } finally { busy = false; step = "done:" + step; }
}
function blocked() {
  sfx.back?.();
  const el = scrim("note-blocked", `<div class="glass glass-dialog" role="alertdialog" aria-labelledby="nb-t">
      <b id="nb-t">${esc(t("notes.blocked"))}</b>
      <p>${esc(t("notes.blockedSub"))}</p>
      <button type="button" class="glass-btn gold sm" data-ok>${esc(t("notes.ok"))}</button>
    </div>`);
  el.querySelector("[data-ok]").onclick = () => { sfx.back?.(); close(el); };
}

function composer(cell, leftToday) {
  const allow = NOTE_SPOTS.filter(s => distM(s, cell) < 150).map(s => s.name);
  const el = scrim("note-compose", `<form class="glass glass-sheet note-sheet" novalidate>
      <div class="ns-top"><b>${esc(t("notes.title"))}</b><button type="button" class="glass-icon sm" data-x aria-label="${esc(t("notes.close"))}">${ICON.x}</button></div>
      <p class="ns-sub">${esc(t("notes.sub"))}</p>
      <div class="glass-seg ns-seg" role="tablist">
        <button type="button" data-k="text" class="on" role="tab">${esc(t("notes.text"))}</button><button type="button" data-k="photo" role="tab">${esc(t("notes.photo"))}</button><button type="button" data-k="meme" role="tab">${esc(t("notes.meme"))}</button>
      </div>
      <div class="ns-pane" data-p="text">
        <textarea class="glass-field ns-text" rows="3" maxlength="${NOTE_RULES.TEXT_MAX}" placeholder="${esc(t("notes.placeholder"))}" aria-label="${esc(t("notes.text"))}"></textarea>
      </div>
      <div class="ns-pane" data-p="pic" hidden>
        <div class="ns-pick">
          <button type="button" class="glass-btn clear sm" data-cam>${esc(t("notes.camera"))}</button>
          <button type="button" class="glass-btn clear sm" data-lib>${esc(t("notes.library"))}</button>
        </div>
        <canvas class="ns-preview" hidden></canvas>
        <input class="glass-field ns-cap" maxlength="${NOTE_RULES.TEXT_MAX}" placeholder="${esc(t("notes.caption"))}" aria-label="${esc(t("notes.caption"))}">
        <div class="ns-meme" hidden>
          <input class="glass-field ns-mtop" maxlength="${NOTE_RULES.CAPTION_MAX}" placeholder="${esc(t("notes.top"))}" aria-label="${esc(t("notes.top"))}" autocapitalize="characters">
          <input class="glass-field ns-mbottom" maxlength="${NOTE_RULES.CAPTION_MAX}" placeholder="${esc(t("notes.bottom"))}" aria-label="${esc(t("notes.bottom"))}" autocapitalize="characters">
        </div>
        <input type="file" accept="image/*" capture="environment" data-cam-in hidden>
        <input type="file" accept="image/*" data-lib-in hidden>
      </div>
      <p class="ns-err" role="status" aria-live="polite"></p>
      <div class="ns-foot"><span class="ns-left">${esc(t("notes.left", { n: leftToday }))}</span><button type="submit" class="glass-btn gold sm fit ns-post" disabled>${esc(t("notes.post"))}</button></div>
    </form>`);
  const f = el.querySelector("form"), $ = s => f.querySelector(s);
  const err = $(".ns-err"), post = $(".ns-post"), cv = $(".ns-preview");
  let kind = "text", file = null, img = null;
  const fields = () => kind === "text" ? [$(".ns-text").value] : kind === "photo" ? [$(".ns-cap").value] : [$(".ns-mtop").value, $(".ns-mbottom").value];
  const check = () => {
    const vals = fields();
    let why = null;
    for (const v of vals) { const r = checkNote(v, { allow, max: kind === "meme" ? NOTE_RULES.CAPTION_MAX : NOTE_RULES.TEXT_MAX, required: false }); if (!r.ok) { why = r.why; break; } }
    const need = kind === "text" ? !!vals[0].trim() : !!img;
    err.textContent = why ? t(`notes.why.${why}`) : "";
    err.classList.toggle("on", !!why);
    post.disabled = !!why || !need;
    return !why && need;
  };
  const preview = () => {
    if (!img) { cv.hidden = true; return; }
    render(img, { max: 720, canvas: cv, top: kind === "meme" ? $(".ns-mtop").value : "", bottom: kind === "meme" ? $(".ns-mbottom").value : "" });
    cv.hidden = false;
  };
  const tab = k => {
    kind = k;
    f.querySelectorAll(".ns-seg button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    $('[data-p="text"]').hidden = k !== "text";
    $('[data-p="pic"]').hidden = k === "text";
    $(".ns-cap").hidden = k !== "photo";
    $(".ns-meme").hidden = k !== "meme";
    preview(); check();
  };
  f.querySelectorAll(".ns-seg button").forEach(b => b.onclick = () => { sfx.tick?.(); tab(b.dataset.k); });
  const pick = async inp => {
    const fl = inp.files?.[0];
    if (!fl) return;
    try { const d = await decode(fl); img?.close?.(); img = d; file = fl; preview(); check(); }
    catch { err.textContent = t("notes.badPic"); }
  };
  $("[data-cam]").onclick = () => $("[data-cam-in]").click();
  $("[data-lib]").onclick = () => $("[data-lib-in]").click();
  $("[data-cam-in]").onchange = e => pick(e.target);
  $("[data-lib-in]").onchange = e => pick(e.target);
  for (const s of [".ns-text", ".ns-cap"]) $(s).addEventListener("input", check);
  for (const s of [".ns-mtop", ".ns-mbottom"]) $(s).addEventListener("input", () => { preview(); check(); });
  $("[data-x]").onclick = () => { sfx.back?.(); close(el); };
  setTimeout(() => $(".ns-text").focus(), 250);
  f.onsubmit = async e => {
    e.preventDefault();
    if (!check()) return;
    post.disabled = true; post.textContent = t("notes.posting");
    try {
      const args = { p_lat: cell.lat, p_lng: cell.lng, p_kind: kind, p_body: null, p_top: null, p_bottom: null, p_image: null };
      if (kind === "text") args.p_body = $(".ns-text").value.trim();
      else {
        if (kind === "photo") args.p_body = $(".ns-cap").value.trim() || null;
        else { args.p_top = $(".ns-mtop").value.trim() || null; args.p_bottom = $(".ns-mbottom").value.trim() || null; }
        // the picture: redrawn and re-encoded (no EXIF / GPS), checked, then uploaded to your own folder
        const jpeg = await cleanImage(file, kind === "meme" ? { top: args.p_top ?? "", bottom: args.p_bottom ?? "" } : {});
        if (hasMetadata(new Uint8Array(await jpeg.arrayBuffer())).any) throw new Error("metadata");
        const uid = await myId();
        const path = `${uid}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from("note-uploads").upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error(error.message);
        args.p_image = path;
      }
      const r = await rpc("leave_note", args);
      if (!r?.ok) {
        post.textContent = t("notes.post");
        if (r?.why === "verify") { err.textContent = t("notes.why.verify"); err.classList.add("on"); post.disabled = true; onboard.requireVerified("notes").catch(() => {}); return; }
        err.textContent = t(r?.why === "limit" ? "notes.limit" : `notes.why.${r?.why ?? "other"}`); err.classList.add("on");
        check();
        return;
      }
      if (args.p_image) sb.functions?.invoke?.("moderate-note", { body: { id: r.id } }).catch?.(() => {});
      sfx.ping?.();
      close(el);
      toast(t(args.p_image ? "notes.postedImg" : "notes.posted"), 3400);
      // on the map at once (yours, pending if it's a picture)
      gen++;
      sync([...[...markers.values()].map(m => m.n), { id: r.id, kind, lat: r.lat, lng: r.lng, landmark: false, spot: NOTE_SPOTS.find(s => s.name === r.spot)?.id ?? null, mine: true, state: args.p_image ? "pending" : null }], { s: 0, n: 0, w: 0, e: 0 });
      lastFetch = 0;
    } catch (x) {
      console.warn("[notes] leave:", x?.message);
      post.textContent = t("notes.post"); err.textContent = t("notes.why.other"); err.classList.add("on"); check();
    }
  };
  check();
}

// ---------------------------------------------------------------- start
export const notes = {
  init(client) {
    if (sb || Q().get("notes") === "0") return;
    sb = client;
    rpc("note_spot_list").then(l => { if (Array.isArray(l) && l.length) spots = l; }).catch(() => {});
    onLang(() => { label(); for (const m of markers.values()) m.key = null; });
    // show / hide with the world screen; refresh the markers as the map moves
    const loop = () => {
      ensureLayer();
      if (!layer) return;
      const on = screenOn();
      if (on !== shown) { shown = on; document.body.classList.toggle("notes-on", on); if (on) lastFetch = 0; }
      if (!on) return;
      const q = Q(), k = `${q.get("devlat")},${q.get("devlng")}`;
      if (k !== devKey) { devKey = k; updateNear(); }
      refresh();
    };
    setInterval(loop, REFRESH_MS);
    setTimeout(loop, 400);
    permState("location").then(s => { if (s === "granted" && !Q().get("devlat")) follow(); }).catch(() => {});
  },
  refresh: () => refresh(true),
  get step() { return step; },       // where Leave a note got to (tests)
  // tests: what's on the map right now (no positions of anyone but the notes)
  get markers() { return [...markers.values()].map(m => ({ id: m.n.id, kind: m.n.kind, near: m.near, landmark: m.n.landmark, mine: m.n.mine, state: m.n.state, spot: m.n.spot })); },
};
