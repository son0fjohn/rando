// City chunks, worker: fetch a chunk out of the PMTiles archive (device
// cache first), build its geometry (citygen.js) off the main thread and hand
// the typed arrays back without copying. web/citytiles.js drives it.
// Anywhere the archive doesn't cover, the chunk comes from the worldwide
// OpenMapTiles tiles instead (cityomt.js: one z14 tile -> 16 chunks), and a
// chunk at the edge of a baked area gets the rest of itself from there too.
import { PMTiles, gunzip } from "./pmtiles.js";
import { buildChunk, tileToLngLat } from "./citygen.js";
import { tileStore } from "./citycache.js";
import { omtChunks, OMT_Z } from "./cityomt.js";

let src = null, cfg = null, store = null;
const parsed = new Map(); // "z/x/y" -> payload (small LRU: lod swaps rebuild without refetching)

async function payload(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (parsed.has(k)) { const v = parsed.get(k); parsed.delete(k); parsed.set(k, v); return { p: v, cached: "mem" }; }
  let bytes = await store.get(k), cached = bytes ? "device" : null;
  if (!bytes) {
    bytes = await src.tile(z, x, y).catch(() => null);
    if (bytes) store.put(k, bytes);
  }
  let p = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  if (cfg.omt && (!p || p.cut) && Date.now() > omtDownUntil) {
    const w = await omtPayload(x, y).catch(err => {
      // unreachable (offline, blocked): say so once, then leave it a minute
      if (!omtDownUntil) console.warn("city: the worldwide tiles aren't reachable:", err?.message || err);
      omtDownUntil = Date.now() + 60e3;
      return null;
    });
    if (w) p = p ? merge(p, w, z, x, y) : w;
  }
  parsed.set(k, p);
  if (parsed.size > 60) parsed.delete(parsed.keys().next().value);
  return { p, cached };
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
async function omtPayload(x16, y16) {
  const x14 = x16 >> 2, y14 = y16 >> 2, k = `${x14},${y14}`;
  if (!omt.has(k)) {
    omt.set(k, (async () => {
      const key = `omt/${OMT_Z}/${x14}/${y14}`;
      let bytes = await store.get(key);
      if (!bytes) {
        const url = (await omtTemplate()).replace("{z}", OMT_Z).replace("{x}", x14).replace("{y}", y14);
        const r = await fetch(url);
        if (r.status === 204 || r.status === 404) return new Map(); // nothing there (sea, desert)
        if (!r.ok) throw new Error(`omt ${r.status}`);
        bytes = new Uint8Array(await r.arrayBuffer());
        store.put(key, bytes);
      }
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await gunzip(bytes));
      return omtChunks(bytes, x14, y14);
    })().catch(err => { omt.delete(k); throw err; }));
    if (omt.size > 24) omt.delete(omt.keys().next().value);
  }
  return (await omt.get(k)).get(`${x16},${y16}`) ?? null;
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
    src = new PMTiles(new URL(m.url, m.base).href);
    store = tileStore(m.url);
    try {
      const h = await src.header();
      self.postMessage({ type: "meta", bounds: h.bounds, minZoom: h.minZoom, maxZoom: h.maxZoom });
    } catch (err) {
      self.postMessage({ type: "error", error: String(err?.message || err) });
    }
    return;
  }
  if (m.type === "chunk") {
    const t0 = performance.now();
    try {
      const { p, cached } = await payload(m.z, m.x, m.y);
      const t1 = performance.now();
      if (!p) { self.postMessage({ type: "chunk", id: m.id, empty: true, t: { fetch: t1 - t0, build: 0 } }); return; }
      const out = buildChunk(p, { z: m.z, x: m.x, y: m.y, origin: cfg.origin, lod: m.lod, heroes: cfg.heroes, clearAt: cfg.clearAt, exclude: cfg.exclude });
      out.stats.src = p.src ?? (p.cut ? "baked+omt" : "baked");
      const t2 = performance.now();
      const xfer = [out.trees.buffer, out.lamps.buffer, out.poles.buffer, out.lanterns.buffer];
      for (const g of Object.values(out.groups)) xfer.push(...[g.pos, g.nrm, g.uv, g.col, g.seed, g.idx].filter(Boolean).map(a => a.buffer));
      self.postMessage({ type: "chunk", id: m.id, ...out, cached, t: { fetch: t1 - t0, build: t2 - t1 } }, xfer);
    } catch (err) {
      self.postMessage({ type: "chunk", id: m.id, error: String(err?.message || err) });
    }
  }
};
