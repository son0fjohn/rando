// City chunks, worker: fetch a chunk out of the PMTiles archive (device
// cache first), build its geometry (citygen.js) off the main thread and hand
// the typed arrays back without copying. web/citytiles.js drives it.
// Anywhere the archive doesn't cover, the chunk comes from the worldwide
// OpenMapTiles tiles instead (cityomt.js: one z14 tile -> 16 chunks), and a
// chunk at the edge of a baked area gets the rest of itself from there too.
// Between the two: the region archives (web/tiles/regions.json, whole cities
// baked from Overture: OpenStreetMap plus the machine-learned footprints
// OpenStreetMap lacks, which in Korea is most houses), read wherever the
// areas' archive has no chunk (or only part of one) and the chunk lies in a
// region's box. A chunk whose data couldn't be reached (offline, a server
// error) comes back marked `retry`, and citytiles.js asks for it again.
import { PMTiles, gunzip } from "./pmtiles.js";
import { buildChunk, packChunk, handmadeMask, tileToLngLat } from "./citygen.js";
import { tileStore } from "./citycache.js";
import { omtChunks, OMT_Z } from "./cityomt.js";

let src = null, cfg = null, store = null, omtStore = null, ready = null;
let regions = [];         // [{ id, bbox: [w, s, e, n], src: PMTiles, store }] (regions.json)
const parsed = new Map(); // "z/x/y" -> payload (small LRU: lod swaps rebuild without refetching)

// a chunk out of one archive: the device cache first. null: the archive has
// no such chunk; throws when the archive can't be reached
async function fromArchive(a, st, z, x, y) {
  const k = `${z}/${x}/${y}`;
  let bytes = await st.get(k);
  const cached = bytes ? "device" : null;
  if (!bytes) {
    bytes = await a.tile(z, x, y);
    if (bytes) st.put(k, bytes);
  }
  return { p: bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null, cached };
}
// the regions whose box holds the chunk's middle, in regions.json's order
// (neighbouring boxes overlap a little: a chunk on one's edge is whole in the next)
const regionsAt = (z, x, y) => {
  const [lng, lat] = tileToLngLat(z, x, y, 2048, 2048);
  return regions.filter(g => lng > g.bbox[0] && lng < g.bbox[2] && lat > g.bbox[1] && lat < g.bbox[3]);
};

async function payload(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (parsed.has(k)) { const v = parsed.get(k); parsed.delete(k); parsed.set(k, v); return { p: v, cached: "mem" }; }
  await ready;
  let retry = false;
  // (an archive that isn't there at all, 404, is no archive; one that can't be reached is asked again)
  const missing = err => /pmtiles 404|not a PMTiles/.test(err?.message || "");
  let { p, cached } = await fromArchive(src, store, z, x, y).catch(err => { if (!missing(err)) retry = true; return { p: null, cached: null }; });
  // a region archive (a whole city) where the areas' archive has nothing or only part
  for (const g of !p || p.cut ? regionsAt(z, x, y) : []) {
    const r = await fromArchive(g.src, g.store, z, x, y).catch(err => {
      if (missing(err)) return null;
      console.warn(`city: the ${g.id} archive isn't reachable:`, err?.message || err);
      retry = true;
      return null;
    });
    if (r?.p) {
      r.p.src = g.id;
      // (a region chunk is whole: what lies outside the area's circle comes from it)
      p = p ? { ...merge(p, r.p, z, x, y), cut: undefined, src: "baked+" + g.id } : r.p;
      cached ??= r.cached;
      break;
    }
  }
  if ((cfg.omt || cfg.ovt) && (!p || p.cut)) {
    if (Date.now() < omtDownUntil) retry = true;
    else {
      const { w, partial } = await omtPayload(x, y).catch(err => {
        // unreachable (offline, blocked, a server error): say so once, leave
        // it 10 s, and have the chunk asked for again (citytiles.js, after 15 s)
        if (!omtDownUntil) console.warn("city: the worldwide tiles aren't reachable:", err?.message || err);
        omtDownUntil = Date.now() + 10e3;
        retry = true;
        return {};
      });
      if (partial) retry = true;
      if (w) p = p ? merge(p, w, z, x, y) : w;
    }
  }
  if (!retry) {          // (a chunk that's missing a part isn't kept: it's asked for again)
    parsed.set(k, p);
    if (parsed.size > 60) parsed.delete(parsed.keys().next().value);
  }
  return { p, cached, retry };
}

// ---- the worldwide fallback: OpenMapTiles z14 tiles (OpenFreeMap)
let template = null, omtDownUntil = 0;
const omt = new Map(); // "x14,y14" -> Promise<Map of chunk payloads>
async function omtTemplate() {
  template ??= (async () => {
    if (cfg.omt.includes("{z}")) return cfg.omt;
    const tj = await (await fetch(new URL(cfg.omt, cfg.base))).json();
    return new URL(tj.tiles[0], new URL(cfg.omt, cfg.base)).href.replace(/%7B/g, "{").replace(/%7D/g, "}");
  })().catch(err => { template = null; throw err; });
  return template;
}
// the z14 OpenMapTiles tile's bytes (null: nothing there, sea or desert)
async function omtTile(x14, y14) {
  const key = `omt/${OMT_Z}/${x14}/${y14}`;
  let bytes = await omtStore.get(key);
  if (!bytes) {
    const url = (await omtTemplate()).replace("{z}", OMT_Z).replace("{x}", x14).replace("{y}", y14);
    const r = await fetch(url);
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw new Error(`omt ${r.status}`);
    bytes = new Uint8Array(await r.arrayBuffer());
    omtStore.put(key, bytes);
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await gunzip(bytes));
  return bytes;
}
// ... and the same tile out of Overture's buildings PMTiles (cfg.ovt; off
// unless set: see docs/map_city.md "Worldwide Overture buildings")
let ovtSrc = null;
async function ovtTile(x14, y14) {
  const key = `ovt/${OMT_Z}/${x14}/${y14}`;
  let bytes = await omtStore.get(key);
  if (!bytes) {
    ovtSrc ??= new PMTiles(cfg.ovt);
    bytes = await ovtSrc.tile(OMT_Z, x14, y14);
    if (!bytes) return null;
    bytes = new Uint8Array(bytes);
    omtStore.put(key, bytes);
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await gunzip(bytes));
  return bytes;
}
// the worldwide chunk: { w: payload or null, partial: one of the two sources failed }
async function omtPayload(x16, y16) {
  const x14 = x16 >> 2, y14 = y16 >> 2, k = `${x14},${y14}`;
  if (!omt.has(k)) {
    omt.set(k, (async () => {
      const [a, b] = await Promise.allSettled([cfg.omt ? omtTile(x14, y14) : null, cfg.ovt ? ovtTile(x14, y14) : null]);
      if (a.status === "rejected" && (!cfg.ovt || b.status === "rejected")) throw a.reason;
      if (b.status === "rejected") console.warn("city: Overture's building tiles aren't reachable:", b.reason?.message || b.reason);
      const m = omtChunks(a.value ?? null, x14, y14, { buildings: b.value ?? null });
      if (b.value) for (const c of m.values()) c.src = a.value ? "omt+ovt" : "ovt";
      m.partial = a.status === "rejected" || b.status === "rejected";
      return m;
    })().catch(err => { omt.delete(k); throw err; }));
    if (omt.size > 24) omt.delete(omt.keys().next().value);
  }
  const m = await omt.get(k);
  if (m.partial) omt.delete(k);   // (asked for again next time)
  return { w: m.get(`${x16},${y16}`) ?? null, partial: m.partial };
}

// a baked chunk the area's circle only partly covers: the fallback's
// buildings, roads and areas that lie outside every circle join it
function merge(p, w, z, x, y) {
  const cuts = p.cut.map(([lat, lng, r]) => ({ lat, lng, r, k: 111320 * Math.cos(lat * Math.PI / 180) }));
  const inside = (px, py) => {
    const [lng, lat] = tileToLngLat(z, x, y, px, py);
    return cuts.some(c => Math.hypot((lat - c.lat) * 110540, (lng - c.lng) * c.k) < c.r);
  };
  const mid = q => { let sx = 0, sy = 0, n = q.length / 2; for (let i = 0; i < q.length; i += 2) { sx += q[i]; sy += q[i + 1]; } return [sx / n, sy / n]; };
  return {
    ...p,
    b: p.b.concat(w.b.filter(b => !inside(...mid(b.p)))),
    r: p.r.concat(w.r.filter(r => !inside(r.p[(r.p.length >> 2) * 2], r.p[(r.p.length >> 2) * 2 + 1]))),
    a: p.a.concat(w.a.filter(a => !inside(...mid(a.p)))),
    l: (p.l ?? []).concat((w.l ?? []).filter(l => !inside(l.x, l.y))),
  };
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type === "init") {
    cfg = m;
    if (cfg.exclude?.src) cfg.exclude = handmadeMask(cfg.exclude);   // (round Itaewon: the hand-made map's own shape)
    const url = new URL(m.url, m.base);
    src = new PMTiles(url.href);
    omtStore = tileStore("omt");
    let done;
    ready = new Promise(r => { done = r; });
    try {
      const h = await src.header();
      // (the device cache is keyed by the archive's size: a re-baked archive isn't read from an old copy)
      store = tileStore(`${m.url}@${h.dataLen}`);
      self.postMessage({ type: "meta", bounds: h.bounds, minZoom: h.minZoom, maxZoom: h.maxZoom });
    } catch (err) {
      store = tileStore(m.url);
      self.postMessage({ type: "error", error: String(err?.message || err) });
    }
    if (m.regions !== false) {
      try {
        const r = await fetch(new URL("regions.json", url));
        if (r.ok) regions = ((await r.json()).regions ?? []).map(g => ({ ...g, src: new PMTiles(new URL(g.file, url).href), store: tileStore(`${g.file}@${g.bytes ?? 0}`) }));
      } catch { /* no regions: the areas' archive and the worldwide tiles */ }
    }
    done();
    return;
  }
  if (m.type === "chunk") {
    const t0 = performance.now();
    try {
      const { p, cached, retry } = await payload(m.z, m.x, m.y);
      const t1 = performance.now();
      if (!p) { self.postMessage({ type: "chunk", id: m.id, empty: true, retry, t: { fetch: t1 - t0, build: 0 } }); return; }
      const out = packChunk(buildChunk(p, { z: m.z, x: m.x, y: m.y, origin: cfg.origin, lod: m.lod, heroes: cfg.heroes, clearAt: cfg.clearAt, exclude: cfg.exclude, shadow: m.shadow ?? null }));
      out.stats.src = p.src ?? (p.cut ? "baked+omt" : "baked");
      const t2 = performance.now();
      const xfer = [out.trees.buffer, out.lamps.buffer, out.poles.buffer, out.lanterns.buffer, out.centres.buffer];
      for (const g of Object.values(out.groups)) xfer.push(...[g.pos, g.nrm, g.uv, g.col, g.seed, g.idx, g.cls].filter(Boolean).map(a => a.buffer));
      self.postMessage({ type: "chunk", id: m.id, ...out, cached, retry, t: { fetch: t1 - t0, build: t2 - t1 } }, xfer);
    } catch (err) {
      self.postMessage({ type: "chunk", id: m.id, error: String(err?.message || err) });
    }
  }
};
