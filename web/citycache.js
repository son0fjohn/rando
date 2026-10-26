// City chunks, device cache: decoded chunk bytes kept in the Cache API so a
// street you've seen loads from the phone next time (PMTiles answers with
// 206 range responses, which the Cache API won't store, so we store the
// tile itself under a synthetic same-origin key). Silent no-op where the
// Cache API is missing (old browsers, private modes, node).
const NAME = "rando-city-v1";
const MAX = 600; // chunks kept per archive (~5 MB)

export function tileStore(archive) {
  const ok = typeof caches !== "undefined";
  const key = k => `/__city/${encodeURIComponent(archive)}/${k}`;
  let open = null;
  const c = () => (open ??= caches.open(NAME).catch(() => null));
  let puts = 0;
  return {
    async get(k) {
      if (!ok) return null;
      try {
        const r = await (await c())?.match(key(k));
        return r ? new Uint8Array(await r.arrayBuffer()) : null;
      } catch { return null; }
    },
    async put(k, bytes) {
      if (!ok) return;
      try {
        const cache = await c();
        if (!cache) return;
        await cache.put(key(k), new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
        if (++puts % 50 === 0) { // trim the oldest when over budget
          const keys = await cache.keys();
          for (const r of keys.slice(0, Math.max(0, keys.length - MAX))) await cache.delete(r);
        }
      } catch { /* quota, private mode: fine, it's a cache */ }
    },
  };
}
