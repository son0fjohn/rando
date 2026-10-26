// City chunks, worker: fetch a chunk out of the PMTiles archive (device
// cache first), build its geometry (citygen.js) off the main thread and hand
// the typed arrays back without copying. web/citytiles.js drives it.
import { PMTiles } from "./pmtiles.js";
import { buildChunk } from "./citygen.js";
import { tileStore } from "./citycache.js";

let src = null, cfg = null, store = null;
const parsed = new Map(); // "z/x/y" -> payload (small LRU: lod swaps rebuild without refetching)

async function payload(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (parsed.has(k)) { const v = parsed.get(k); parsed.delete(k); parsed.set(k, v); return { p: v, cached: "mem" }; }
  let bytes = await store.get(k), cached = bytes ? "device" : null;
  if (!bytes) {
    bytes = await src.tile(z, x, y);
    if (bytes) store.put(k, bytes);
  }
  const p = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  parsed.set(k, p);
  if (parsed.size > 60) parsed.delete(parsed.keys().next().value);
  return { p, cached };
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
      const out = buildChunk(p, { z: m.z, x: m.x, y: m.y, origin: cfg.origin, lod: m.lod, heroes: cfg.heroes, clearAt: cfg.clearAt });
      const t2 = performance.now();
      const xfer = [out.trees.buffer, out.lamps.buffer];
      for (const g of Object.values(out.groups)) xfer.push(...[g.pos, g.nrm, g.uv, g.col, g.seed, g.idx].filter(Boolean).map(a => a.buffer));
      self.postMessage({ type: "chunk", id: m.id, ...out, cached, t: { fetch: t1 - t0, build: t2 - t1 } }, xfer);
    } catch (err) {
      self.postMessage({ type: "chunk", id: m.id, error: String(err?.message || err) });
    }
  }
};
