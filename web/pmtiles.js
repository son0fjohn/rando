// A small PMTiles v3 reader (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md):
// one static archive, HTTP range requests, no server. Used by the city
// chunk worker to pull z16 map chunks out of web/tiles/*.pmtiles locally or
// a planet build on R2 in production. No three.js, no DOM: it runs in a
// worker, on the page and in node tests.

const HEADER_BYTES = 16384; // header + root directory arrive in one request

export async function gunzip(buf) {
  const ds = new DecompressionStream("gzip");
  const out = new Response(new Blob([buf]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

function u64(dv, o) { return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296; }

function readVarint(p) {
  let v = 0, mul = 1, b;
  do {
    b = p.buf[p.pos++];
    v += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80);
  return v;
}

export function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let a = 0; a < z; a++) acc += 4 ** a;
  const n = 2 ** z;
  let d = 0, tx = x, ty = y;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0, ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { tx = n - 1 - tx; ty = n - 1 - ty; }
      const t = tx; tx = ty; ty = t;
    }
  }
  return acc + d;
}

function parseDirectory(buf) {
  const p = { buf, pos: 0 };
  const n = readVarint(p);
  const es = new Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last += readVarint(p); es[i] = { id: last, run: 1, len: 0, off: 0 }; }
  for (let i = 0; i < n; i++) es[i].run = readVarint(p);
  for (let i = 0; i < n; i++) es[i].len = readVarint(p);
  for (let i = 0; i < n; i++) {
    const v = readVarint(p);
    es[i].off = v === 0 && i > 0 ? es[i - 1].off + es[i - 1].len : v - 1;
  }
  return es;
}

function findEntry(es, id) {
  let lo = 0, hi = es.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, c = id - es[m].id;
    if (c > 0) lo = m + 1;
    else if (c < 0) hi = m - 1;
    else return es[m];
  }
  if (hi >= 0) {
    const e = es[hi];
    if (e.run === 0) return e;               // a leaf directory covers it
    if (id - e.id < e.run) return e;         // inside a run of identical tiles
  }
  return null;
}

export class PMTiles {
  constructor(url, { fetch: f = (...a) => fetch(...a) } = {}) {
    this.url = url;
    this.fetch = f;
    this.whole = null;     // the server ignored Range: we got the file
    this.dirs = new Map(); // offset -> parsed directory
    this.ready = null;
  }

  async range(off, len) {
    if (this.whole) return this.whole.subarray(off, off + len);
    const r = await this.fetch(this.url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
    if (!r.ok) throw new Error(`pmtiles ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    if (r.status === 200 && b.length > len) { this.whole = b; return b.subarray(off, off + len); }
    return b;
  }

  async decompress(buf, kind) {
    if (kind === 2) return gunzip(buf);
    if (kind === 1 || kind === 0) return buf;
    throw new Error(`pmtiles: compression ${kind} not supported`);
  }

  header() {
    this.ready ??= (async () => {
      const b = await this.range(0, HEADER_BYTES);
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      if (String.fromCharCode(...b.subarray(0, 7)) !== "PMTiles" || b[7] !== 3) throw new Error("not a PMTiles v3 archive");
      const h = {
        rootOff: u64(dv, 8), rootLen: u64(dv, 16), metaOff: u64(dv, 24), metaLen: u64(dv, 32),
        leafOff: u64(dv, 40), leafLen: u64(dv, 48), dataOff: u64(dv, 56), dataLen: u64(dv, 64),
        internal: b[97], tileComp: b[98], tileType: b[99], minZoom: b[100], maxZoom: b[101],
        bounds: [dv.getInt32(102, true) / 1e7, dv.getInt32(106, true) / 1e7, dv.getInt32(110, true) / 1e7, dv.getInt32(114, true) / 1e7],
        center: [dv.getInt32(119, true) / 1e7, dv.getInt32(123, true) / 1e7, b[118]],
      };
      const root = h.rootOff + h.rootLen <= b.length ? b.subarray(h.rootOff, h.rootOff + h.rootLen) : await this.range(h.rootOff, h.rootLen);
      this.dirs.set("root", parseDirectory(await this.decompress(root, h.internal)));
      this.h = h;
      return h;
    })();
    return this.ready;
  }

  async metadata() {
    const h = await this.header();
    const raw = await this.decompress(await this.range(h.metaOff, h.metaLen), h.internal);
    return JSON.parse(new TextDecoder().decode(raw));
  }

  // the tile's bytes, decompressed; null when the archive has no such tile
  async tile(z, x, y) {
    const h = await this.header();
    if (z < h.minZoom || z > h.maxZoom) return null;
    const id = zxyToTileId(z, x, y);
    let dir = this.dirs.get("root");
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(dir, id);
      if (!e) return null;
      if (e.run > 0) return this.decompress(await this.range(h.dataOff + e.off, e.len), h.tileComp);
      const key = h.leafOff + e.off;
      dir = this.dirs.get(key);
      if (!dir) {
        dir = parseDirectory(await this.decompress(await this.range(key, e.len), h.internal));
        this.dirs.set(key, dir);
      }
    }
    return null;
  }
}
