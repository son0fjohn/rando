// City chunks, geometry: one z16 chunk of baked map data (scripts/
// bake_city_tiles.py) -> flat typed arrays per material, ready for
// THREE.BufferGeometry. Pure JS, no three.js and no DOM, so it runs in the
// chunk worker (citygen.worker.js), on the page as a fallback, and in node
// tests. web/citytiles.js owns the materials, the meshes and the streaming.
//
// The look is Itaewon's, by the rules in assets/world/STYLE.md (web/style.js
// holds the numbers): low-poly extrusions in six creams with flat roofs,
// one painted window tile per facade class (mixed / shop / office / res; the
// night lights pick whole windows per building in the shader), a baked
// shadow film, AC boxes, awnings, sign panels and bins on the lots facing a
// road, the asphalt strip on each road's centreline over the map's paving,
// the lawn tile on parks with sparse painted trees, blue water, and along
// the roads street lights and power poles with wires and lanterns.

export const SCALE = 0.55;         // world units per metre (world3d geoPos)
export const FLOOR_U = 3.2 * SCALE * 2.4; // one storey in world units (the map's 2.4x vertical)
export const EXTENT = 4096;
import { STYLE, worldHeight, styleClass, wallIndex } from "./style.js";

// metres -> world height: the map's 2.4x vertical up to 50 m, gentler above
// so a 200 m tower doesn't swallow the screen (style.js)
export { worldHeight };

// same projection as world3d geoPos (north = -z)
export function projector([lat0, lng0]) {
  const mLat = 110540.0, mLng = 111320.0 * Math.cos(lat0 * Math.PI / 180);
  return {
    fwd: (lng, lat) => [(lng - lng0) * mLng * SCALE, -(lat - lat0) * mLat * SCALE],
    inv: (x, z) => [x / (mLng * SCALE) + lng0, -z / (mLat * SCALE) + lat0], // -> [lng, lat]
  };
}

// Itaewon's hand-made hills (world3d.js terrainY uses this too, so the two
// can never disagree): Namsan rises to the north-west, the ground falls
// gently south toward the river, light rolling noise elsewhere; flat again
// past ~1.3 km, where the procedural city takes over. World units, origin
// at Itaewon station.
const sstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export function itaewonHill(x, z) {
  const nw = (-z) * 0.8 + (-x) * 0.5;
  let h = 34 * sstep((nw - 260) / 480);
  h -= 14 * sstep((z - 320) / 420);
  h += 5 * Math.sin(x * 0.0055 + 1.7) * Math.sin(z * 0.0047 - 0.4);
  const d = Math.hypot(x, z);
  if (d > 900) h *= 1 - sstep((d - 900) / 380);
  return h;
}

export function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = (lng + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return [x, y];
}

export function tileToLngLat(z, x, y, px, py) {
  const n = 2 ** z;
  const fx = x + px / EXTENT, fy = y + py / EXTENT;
  const lng = fx / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * fy / n))) * 180 / Math.PI;
  return [lng, lat];
}

// ---- the look is STYLE.md (web/style.js): six creams, flat roofs, Itaewon's
// window tiles, its props and its road widths. Nothing here picks a colour.
export const ROAD_W = STYLE.roads;
const MAIN = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const MINOR = new Set(["footway", "path", "steps", "cycleway", "service", "track"]);

export function hash32(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
function seedOf(b, i, key) {
  let h = key;
  const p = b.p;
  for (let k = 0; k < Math.min(p.length, 8); k++) h = hash32(h ^ (p[k] * 2654435761));
  return hash32(h ^ i);
}
const pick = (arr, s) => arr[s % arr.length];
function rgb(hex, k = 1) {
  return [((hex >> 16) & 255) / 255 * k, ((hex >> 8) & 255) / 255 * k, (hex & 255) / 255 * k];
}
function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(s || "");
  return m ? parseInt(m[1], 16) : null;
}
// sRGB -> linear, so vertex colours match three's colour-managed materials
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linRGB = c => [lin(c[0]), lin(c[1]), lin(c[2])];

// ---- buffers
class Buf {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.s = []; this.i = []; this.v = 0; }
  vert(x, y, z, nx, ny, nz, u, v, c, s) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(c[0], c[1], c[2]); this.s.push(s);
    return this.v++;
  }
  // a planar polygon face (convex, given in order) with its own flat normal;
  // the winding is fixed to face `want` (any vector on the outside)
  face(pts, uvs, c, s, want) {
    const [a, b, d] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let flip = false;
    if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
    const base = this.v;
    pts.forEach((q, k) => this.vert(q[0], q[1], q[2], nx, ny, nz, uvs ? uvs[k][0] : 0, uvs ? uvs[k][1] : 0, c, s));
    for (let k = 1; k < pts.length - 1; k++) {
      if (flip) this.i.push(base, base + k + 1, base + k);
      else this.i.push(base, base + k, base + k + 1);
    }
  }
  // horizontal polygon (ring of [x,z]) at height y, triangulated, facing up
  flat(ring, y, c, s, uvScale = 0) {
    const tris = earcut(ring);
    if (!tris.length) return;
    const base = this.v;
    for (const [x, z] of ring) this.vert(x, y, z, 0, 1, 0, x * uvScale, z * uvScale, c, s);
    for (let k = 0; k < tris.length; k += 3) {
      const a = ring[tris[k]], b = ring[tris[k + 1]], d = ring[tris[k + 2]];
      const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      // y-up normal needs (b-a)x(d-a) with positive y: in (x,z) that's cross < 0
      if (cross < 0) this.i.push(base + tris[k], base + tris[k + 1], base + tris[k + 2]);
      else this.i.push(base + tris[k], base + tris[k + 2], base + tris[k + 1]);
    }
  }
  box(cx, y0, cz, w, h, d, rot, c, s) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (dx, dz) => [cx + dx * cs - dz * sn, cz + dx * sn + dz * cs];
    const q = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
    const y1 = y0 + h;
    for (let k = 0; k < 4; k++) {
      const a = q[k], b = q[(k + 1) % 4];
      const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
      this.face([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], null, c, s, [mx, 0, mz]);
    }
    this.face(q.map(([x, z]) => [x, y1, z]), null, c, s, [0, 1, 0]);
  }
  line(ax, ay, az, bx, by, bz) {
    this.p.push(ax, ay, az, bx, by, bz);
    this.v += 2;
    this.lineOnly = true;
  }
  out() {
    if (!this.v) return null;
    if (this.lineOnly) return { lines: true, pos: new Float32Array(this.p) };
    return {
      pos: new Float32Array(this.p), nrm: new Float32Array(this.n), uv: new Float32Array(this.u),
      col: new Float32Array(this.c), seed: new Float32Array(this.s),
      idx: this.v > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
    };
  }
}

// ---- small geometry helpers on [x,z] rings
export function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(r) {
  let x = 0, z = 0;
  for (const p of r) { x += p[0]; z += p[1]; }
  return [x / r.length, z / r.length];
}
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
// minimum-area oriented box: { c:[x,z], ax:[ux,uz] long axis, L, S }
export function orientedBox(ring) {
  const h = hull(ring);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (const q of h) {
      const u = q[0] * ux + q[1] * uz, v = -q[0] * uz + q[1] * ux;
      mnU = Math.min(mnU, u); mxU = Math.max(mxU, u); mnV = Math.min(mnV, v); mxV = Math.max(mxV, v);
    }
    const area = (mxU - mnU) * (mxV - mnV);
    if (!best || area < best.area) {
      const cu = (mnU + mxU) / 2, cv = (mnV + mxV) / 2;
      best = { area, c: [cu * ux - cv * uz, cu * uz + cv * ux], ax: [ux, uz], du: mxU - mnU, dv: mxV - mnV };
    }
  }
  if (!best) return null;
  if (best.dv > best.du) best = { ...best, ax: [-best.ax[1], best.ax[0]], du: best.dv, dv: best.du };
  return { c: best.c, ax: best.ax, L: best.du, S: best.dv };
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  const qx = ax + t * dx, qz = az + t * dz;
  return [Math.hypot(px - qx, pz - qz), qx, qz];
}

// ear clipping for simple rings ([x,z]); returns index triples. Footprints
// are small; park and water rings up to a few hundred points.
export function earcut(ring) {
  const n = ring.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (ringArea(ring) < 0) idx.reverse();
  const out = [];
  const cross = (a, b, c) => (ring[b][0] - ring[a][0]) * (ring[c][1] - ring[a][1]) - (ring[b][1] - ring[a][1]) * (ring[c][0] - ring[a][0]);
  const inTri = (p, a, b, c) => {
    const [px, pz] = ring[p];
    const s1 = (ring[b][0] - ring[a][0]) * (pz - ring[a][1]) - (ring[b][1] - ring[a][1]) * (px - ring[a][0]);
    const s2 = (ring[c][0] - ring[b][0]) * (pz - ring[b][1]) - (ring[c][1] - ring[b][1]) * (px - ring[b][0]);
    const s3 = (ring[a][0] - ring[c][0]) * (pz - ring[c][1]) - (ring[a][1] - ring[c][1]) * (px - ring[c][0]);
    return s1 >= 0 && s2 >= 0 && s3 >= 0;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 1e-9) continue; // reflex
      let ok = true;
      for (const p of idx) {
        if (p === a || p === b || p === c) continue;
        if (inTri(p, a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) { // degenerate leftovers: fan them so nothing has a hole
      for (let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1]);
      return out;
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

// ---- round Itaewon: what the hand-made map already has (opts.exclude)
//   { b, r }: the plain circles: a building (its centroid) within b world
//     units of the origin, a road (its middle) within r, is the hand-made map's.
//   + { env, grid } (handmadeMask, from the hand-made map's own buildings
//     and roads, world3d.js handmadeSrc): env, how far its buildings reach in each of
//     env.length directions (from +x toward +z); grid, the cells its
//     buildings (bit 1) and roads (bit 2) cover. Inside the reach everything
//     is the hand-made map's; outside it the procedural city fills in, except
//     what the hand-made map already has there (the same building, a street
//     it carries on further out), so the two meet with no ring of nothing
//     between them and nothing twice.
export function handmade(ex) {
  if (!ex) return null;
  if (!ex.env) {
    const d = (x, z) => Math.hypot(x, z);
    return {
      building: (ring, cx, cz) => d(cx, cz) < ex.b,
      road: pts => d(...pts[pts.length >> 1]) < ex.r,
      area: ring => d(...ring[0]) < ex.b && d(...ring[ring.length >> 1]) < ex.b,
      label: (x, z) => d(x, z) < ex.r,
      inside: () => false,
    };
  }
  const env = ex.env, n = env.length, g = ex.grid;
  const reach = (x, z) => {
    const a = ((Math.atan2(z, x) / (2 * Math.PI)) + 1) % 1 * n, i = Math.floor(a) % n, f = a - Math.floor(a);
    return env[i] * (1 - f) + env[(i + 1) % n] * f;
  };
  const inside = (x, z) => Math.hypot(x, z) < reach(x, z);
  const cell = (x, z, bit) => {
    const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((z - g.z0) / g.cell);
    return i >= 0 && j >= 0 && i < g.w && j < g.h && (g.bits[j * g.w + i] & bit) !== 0;
  };
  return {
    // the same building already there: its middle, or most of its corners
    // (pulled a metre in, so a neighbour sharing a wall doesn't count)
    building: (ring, cx, cz) => {
      if (inside(cx, cz) || cell(cx, cz, 1)) return true;
      let k = 0;
      for (const [x, z] of ring) { const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz) || 1, t = Math.min(1, 0.55 / l); if (cell(x + dx * t, z + dz * t, 1)) k++; }
      return k * 2 > ring.length;
    },
    // inside its reach, or a street the hand-made map has drawn: most of
    // its length in there or on its roads
    road: pts => {
      if (inside(...pts[pts.length >> 1])) return true;
      let on = 0, all = 0;
      for (let q = 0; q < pts.length - 1; q++) {
        const [ax, az] = pts[q], [bx, bz] = pts[q + 1], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
        for (let s = 0; s < m; s++) { const t = (s + 0.5) / m, x = ax + (bx - ax) * t, z = az + (bz - az) * t; all++; if (inside(x, z) || cell(x, z, 2)) on++; }
      }
      return all > 0 && on * 2 > all;
    },
    area: ring => inside(...ring[0]) && inside(...ring[ring.length >> 1]),
    label: (x, z) => inside(x, z),
    inside,   // (a park's trees: none on the hand-made map, it has its own)
  };
}

// the mask from the hand-made map's footprints and roads, flat ({ bxy, bat,
// rxy, rat, rhw }: points, where each one starts, roads' half widths): the
// reach per direction (64 sectors, the furthest footprint corner, widened a
// sector each way, + 6 u), and a 4 u grid of the cells its buildings (bit 1)
// and roads (bit 2) cover. Built in the chunk worker, once per city.
export function handmadeMask({ b, r, src }) {
  const { bxy, bat, rxy, rat, rhw } = src, N = 64, env = new Float32Array(N);
  const sector = (x, z) => Math.floor(((Math.atan2(z, x) / (2 * Math.PI)) + 1) % 1 * N) % N;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < bxy.length; k += 2) {
    const x = bxy[k], z = bxy[k + 1], s = sector(x, z), d = Math.hypot(x, z);
    if (d > env[s]) env[s] = d;
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  for (let k = 0; k < rxy.length; k += 2) { x0 = Math.min(x0, rxy[k]); z0 = Math.min(z0, rxy[k + 1]); x1 = Math.max(x1, rxy[k]); z1 = Math.max(z1, rxy[k + 1]); }
  const reach = env.map((_, i) => Math.max(env[(i + N - 1) % N], env[i], env[(i + 1) % N]) + 6);
  const cell = 4; x0 -= 20; z0 -= 20; x1 += 20; z1 += 20;
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell), bits = new Uint8Array(w * h);
  const set = (i, j, bit) => { if (i >= 0 && j >= 0 && i < w && j < h) bits[j * w + i] |= bit; };
  for (let p = 0; p < bat.length - 1; p++) {
    const ring = [];
    for (let k = bat[p]; k < bat[p + 1]; k++) ring.push([bxy[k * 2], bxy[k * 2 + 1]]);
    let a = Infinity, c = Infinity, e = -Infinity, f = -Infinity;
    for (const [x, z] of ring) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); set(Math.floor((x - x0) / cell), Math.floor((z - z0) / cell), 1); }
    for (let i = Math.floor((a - x0) / cell); i <= Math.floor((e - x0) / cell); i++)
      for (let j = Math.floor((c - z0) / cell); j <= Math.floor((f - z0) / cell); j++)
        if (pointInRing(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, ring)) set(i, j, 1);
  }
  for (let p = 0; p < rat.length - 1; p++) {
    const hw = rhw[p], k = Math.ceil(hw / cell);
    for (let q = rat[p]; q < rat[p + 1] - 1; q++) {
      const ax = rxy[q * 2], az = rxy[q * 2 + 1], bx = rxy[q * 2 + 2], bz = rxy[q * 2 + 3], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s <= m; s++) {
        const x = ax + (bx - ax) * s / m, z = az + (bz - az) * s / m, ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell);
        for (let i = ci - k; i <= ci + k; i++) for (let j = cj - k; j <= cj + k; j++)
          if (Math.hypot(x0 + (i + 0.5) * cell - x, z0 + (j + 0.5) * cell - z) <= hw) set(i, j, 2);
      }
    }
  }
  return { b, r, env: reach, grid: { cell, x0, z0, w, h, bits } };
}

// a far chunk's footprint (lod 2): its oriented box when it nearly fills
// it (most buildings), else as it is; counter-clockwise like the ring
function farRing(ring) {
  if (ring.length <= 4) return ring;
  const ob = orientedBox(ring);
  if (!ob || Math.abs(ringArea(ring)) < 0.72 * ob.L * ob.S) return ring;
  const [cx, cz] = ob.c, [ux, uz] = ob.ax, L = ob.L / 2, S = ob.S / 2;
  const box = [[-L, -S], [L, -S], [L, S], [-L, S]].map(([a, b]) => [cx + ux * a - uz * b, cz + uz * a + ux * b]);
  return ringArea(box) < 0 ? box.reverse() : box;
}

// ---- the chunk
// payload: the parsed tile JSON. opts: { z, x, y, origin:[lat,lng], lod: 0|1|2
// (0 full detail, 1 walls + roofs + shadows + parks, 2 the far ones:
// buildings as plain blocks, no shadows, fewer trees),
// heroes: [{ lat, lng, clear (m), fp: [[lng,lat]...], osm, glb, shape, h, glow }]:
//   with a glb, the model replaces the procedural buildings at its spot;
//   without one (yet) it still stands out: its building grows to the
//   landmark's height with a glowing crown, or (shape "tower") a procedural
//   tower stands there. exclude: { b, r } world units round the origin where
//   the hand-made Itaewon map already has buildings (b) and roads (r).
export function buildChunk(payload, opts) {
  const { z, x: tx, y: ty, lod = 0 } = opts;
  const P = projector(opts.origin);
  const toW = (px, py) => P.fwd(...tileToLngLat(z, tx, ty, px, py));
  const key = hash32(tx * 73856093 ^ ty * 19349663);
  const near = lod === 0, far = lod >= 2;
  const B = {};
  const buf = k => (B[k] ??= new Buf());
  const stats = { buildings: 0, hidden: 0, awnings: 0, signs: 0, roads: 0, trees: 0, lamps: 0, poles: 0 };

  const heroes = (opts.heroes || []).map(h => {
    const [hx, hz] = P.fwd(h.lng, h.lat);
    const [fx, fy] = lngLatToTile(h.lng, h.lat, z);
    return { ...h, x: hx, z: hz, r: (h.clear ?? 0) * SCALE, fpW: h.fp ? h.fp.map(([lng, lat]) => P.fwd(lng, lat)) : null,
      here: Math.floor(fx) === tx && Math.floor(fy) === ty };
  });
  const hides = h => h.glb || (h.landmark && h.shape === "tower");
  const ex = opts.exclude, hm = handmade(ex);
  // a placeholder landmark's own building: the one under its pin (or the nearest within 25 m)
  const boosted = new Map(); // building index -> hero
  for (const h of heroes) {
    if (hides(h) || !h.landmark) continue;
    let best = -1, bd = 25 * SCALE;
    (payload.b || []).forEach((b, i) => {
      const ring = []; for (let k = 0; k < b.p.length; k += 2) ring.push(toW(b.p[k], b.p[k + 1]));
      if ((h.osm && b.o === h.osm) || pointInRing(h.x, h.z, ring)) { best = i; bd = -1; return; }
      if (bd < 0) return;
      const [cx, cz] = centroid(ring), d = Math.hypot(cx - h.x, cz - h.z);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) boosted.set(best, h);
  }

  // roads first: the lots' street pass, the lamps and the poles look for them
  const roads = [];
  for (const r of payload.r || []) {
    const pts = [];
    for (let k = 0; k < r.p.length; k += 2) pts.push(toW(r.p[k], r.p[k + 1]));
    if (pts.length < 2) continue;
    if (hm?.road(pts)) continue;
    if (!near && MINOR.has(r.c)) continue; // far away: streets only, no paths
    roads.push({ c: r.c, n: r.n, pts, w: ROAD_W[r.c] ?? 11 });
  }

  // --- buildings (STYLE.md 5): straight walls in one of six creams by
  // position, Itaewon's window tile per class, a flat roof at wall × 0.8, an
  // outline, a baked shadow, an AC box; road-facing lots go to the street pass
  const nightWin = 0;
  const lots = [];
  const nearestRoad = (cx, cz, within) => {
    let best = null;
    for (const r of roads) for (let q = 0; q < r.pts.length - 1; q++) {
      const [d, qx, qz] = segDist(cx, cz, r.pts[q][0], r.pts[q][1], r.pts[q + 1][0], r.pts[q + 1][1]);
      if (d < within && (!best || d < best.d)) best = { r, d, qx, qz };
    }
    return best;
  };
  const acC = linRGB(rgb(STYLE.ac.day));
  const centres = [];   // (where each building stands: tests and ?fps=1 count what's round you)
  for (let i = 0; i < (payload.b || []).length; i++) {
    const b = payload.b[i];
    let ring = [];
    for (let k = 0; k < b.p.length; k += 2) ring.push(toW(b.p[k], b.p[k + 1]));
    if (ring.length < 3) continue;
    if (ringArea(ring) < 0) ring = ring.reverse(); // CCW in (x,z): outward normal is (dz,-dx)
    const [cx, cz] = centroid(ring);
    if (hm?.building(ring, cx, cz)) continue;
    if (heroes.some(h => hides(h) && ((h.osm && b.o === h.osm) || (h.fpW && pointInRing(cx, cz, h.fpW)) || (h.r && Math.hypot(cx - h.x, cz - h.z) < h.r))) ||
        (opts.clearAt && (pointInRing(0, 0, ring) || Math.hypot(cx, cz) < opts.clearAt * SCALE))) {
      stats.hidden++;
      continue;
    }
    if (!near && b.k === "s") continue;
    if (far) ring = farRing(ring);
    stats.buildings++;
    centres.push(cx, cz);
    const s = seedOf(b, i, key);
    const area = Math.abs(ringArea(ring));
    const road = nearestRoad(cx, cz, STYLE.awning.roadWithin);
    const main = !!road && MAIN.has(road.r.c) && road.d < road.r.w / 2 + 16;
    const floors = Math.max(1, b.f || Math.round(b.h / STYLE.LEVEL_M));
    const cls = styleClass({ floors, area, main });
    const wi = wallIndex(cx, cz);
    const wallC = linRGB(rgb(STYLE.walls[wi]));
    const roofC = wallC.map(c => c * STYLE.roofMul);
    const hero = boosted.get(i);
    const top = worldHeight(hero ? Math.max(b.h, hero.h ?? b.h) : b.h);
    const y0 = -0.4;
    const seedF = (s % 997) / 997;
    const seedA = wi + seedF * 0.999;   // the shader: floor() the lit variant, fract() the window hash
    const W = buf("wall_" + cls);
    let run = ((cx + cz) * 0.07) % STYLE.tile.u;   // the tile desynced between neighbours
    const vTop = (top - y0) / STYLE.tile.v;
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const nx = (bz - az) / len, nz = -(bx - ax) / len;
      const u0 = run / STYLE.tile.u, u1 = (run + len) / STYLE.tile.u;
      run += len;
      W.face([[ax, y0, az], [bx, y0, bz], [bx, top, bz], [ax, top, az]],
        [[u0, 0], [u1, 0], [u1, vTop], [u0, vTop]], wallC, seedA, [nx, 0, nz]);
    }
    if (near) outline(buf("lines"), ring, y0, top);
    if (hero) crown(buf("glow"), ring, top, linRGB(rgb(parseHex(hero.glow) ?? 0xffd36b)), seedF);
    buf("roof").flat(ring, top, roofC, seedF);
    if (!far) shadow(buf("shadow"), ring, top, opts.shadow);
    if (near && area > STYLE.ac.minArea && s % 3 !== 0) {
      const hs = hash32(s + 77);
      const x = cx + ((hs % 7) - 3) * 0.6, z = cz + (((hs >> 4) % 5) - 2) * 0.6;
      const [w, h, d] = STYLE.ac.size;
      if (pointInRing(x, z, ring)) buf("ac").box(x, top, z, w, h, d, (hs >> 8) % 2 ? 0.4 : -0.2, acC, 0);
    }
    if (near && road) lots.push({ ring, cx, cz, top, s, road });
  }
  // the street pass (5.7): awnings, sign panels, bins and cones on road-facing lots
  let awnings = 0;
  for (const lot of lots) awnings += streetPass(buf, lot, stats, awnings);
  stats.awnings = awnings;

  // --- roads (4): the asphalt strip on the centreline; the paving is the sidewalk
  const Rd = buf("road");
  for (const r of roads) {
    stats.roads++;
    ribbon(Rd, r.pts, r.w / 2, 0.16, [1, 1, 1], 1, MINOR.has(r.c) ? 1 : 0, near || MAIN.has(r.c));
  }

  // --- placeholder towers (landmarks with no model yet, shape "tower")
  for (const h of heroes) if (h.here && !h.glb && h.landmark && h.shape === "tower") tower(buf, h, linRGB(rgb(parseHex(h.glow) ?? 0xffd36b)));

  // --- parks and forests (3: the lawn tile), water; plazas are the paving itself
  const Wt = buf("water");
  const Gr = buf("grass");
  const trees = [], wet = [];
  for (const a of payload.a || []) {
    const ring = [];
    for (let k = 0; k < a.p.length; k += 2) ring.push(toW(a.p[k], a.p[k + 1]));
    if (ring.length < 3) continue;
    if (hm?.area(ring)) continue;
    // (water above parks: a lake often sits inside its park's outline)
    if (a.k === "water" || a.k === "ocean") { Wt.flat(ring, a.k === "ocean" ? 0.085 : 0.09, [1, 1, 1], 0, 0.02); wet.push(ring); continue; }
    if (a.k !== "park" && a.k !== "forest") continue;
    Gr.flat(ring, a.k === "forest" ? 0.05 : 0.06, [1, 1, 1], 0, 1 / STYLE.grassRepeat);
    scatterTrees(trees, ring, a.k === "forest" ? STYLE.tree.forestStep : STYLE.tree.step, 1, key ^ a.p.length);
  }
  if (hm) {                   // (nor on the hand-made map)
    let n = 0;
    for (let k = 0; k < trees.length; k += 4) if (!hm.inside(trees[k], trees[k + 1])) { trees[n++] = trees[k]; trees[n++] = trees[k + 1]; trees[n++] = trees[k + 2]; trees[n++] = trees[k + 3]; }
    trees.length = n;
  }
  if (wet.length) {           // no trees on the water
    let n = 0;
    for (let k = 0; k < trees.length; k += 4) if (!wet.some(r => pointInRing(trees[k], trees[k + 1], r))) { trees[n++] = trees[k]; trees[n++] = trees[k + 1]; trees[n++] = trees[k + 2]; trees[n++] = trees[k + 3]; }
    trees.length = n;
  }
  const maxTrees = near ? STYLE.tree.maxNear : far ? STYLE.tree.maxFar >> 2 : STYLE.tree.maxFar;     // (4 numbers a tree)
  if (trees.length > maxTrees * 4) trees.length = maxTrees * 4;
  stats.trees = trees.length / 4;

  // --- street lights (5.8) along roads wide enough, every 25 u, alternating sides
  const lamps = [];
  if (near) {
    for (const r of roads) {
      if (r.w < STYLE.lamp.minRoad) continue;
      let acc = 12, side = 1;
      for (let k = 0; k < r.pts.length - 1 && lamps.length < STYLE.lamp.maxPerChunk * 3; k++) {
        const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        while (acc < len && lamps.length < STYLE.lamp.maxPerChunk * 3) {
          const off = r.w / 2 + STYLE.lamp.out;
          lamps.push(ax + ux * acc - uz * off * side, az + uz * acc + ux * off * side, Math.atan2(ux, uz) + (side > 0 ? 0 : Math.PI));
          side = -side;
          acc += STYLE.lamp.spacing;
        }
        acc -= len;
      }
    }
  }
  stats.lamps = lamps.length / 3;
  // --- power poles with sagging wires, a lamp on every third, a paper lantern on every third span
  const poles = [], lanterns = [];
  if (near) polesAlong(roads, buf("wires"), poles, lanterns);
  stats.poles = poles.length / 3;

  // --- street names: one per named road per chunk, at its longest piece
  const labels = [];
  const best = new Map();
  for (const r of roads) {
    if (!r.n) continue;
    let L = 0;
    for (let k = 0; k < r.pts.length - 1; k++) L += Math.hypot(r.pts[k + 1][0] - r.pts[k][0], r.pts[k + 1][1] - r.pts[k][1]);
    if (L > (best.get(r.n)?.L ?? 40)) best.set(r.n, { L, p: r.pts[r.pts.length >> 1] });
  }
  for (const [n, v] of best) labels.push({ text: n, x: v.p[0], z: v.p[1] });
  // names the data carries as points (the worldwide tiles: main roads, major places)
  for (const l of payload.l || []) {
    if (best.has(l.t) || labels.some(o => o.text === l.t)) continue;
    const [x, z] = toW(l.x, l.y);
    if (hm?.label(x, z)) continue;
    labels.push({ text: l.t, x, z, poi: !!l.poi });
  }

  const groups = {};
  for (const [k, b] of Object.entries(B)) { const o = b.out(); if (o) groups[k] = o; }
  // round Itaewon the procedural city stands on the hand-made map's hills
  if (ex) for (const g of Object.values(groups)) for (let k = 0; k < g.pos.length; k += 3) g.pos[k + 1] += itaewonHill(g.pos[k], g.pos[k + 2]);
  return { groups, trees: new Float32Array(trees), lamps: new Float32Array(lamps), poles: new Float32Array(poles), lanterns: new Float32Array(lanterns), centres: new Float32Array(centres), labels, stats, nightWin };
}

// What the page draws (citytiles.js): the groups that share a material
// merged into one geometry, so a chunk costs a handful of draw calls. The
// four facade classes become one "wall" mesh (one texture array, the class
// in a byte per vertex, "cls"), and roofs, AC boxes, awnings
// and kerb clutter (the same plain vertex-coloured material) one "roof".
// buildChunk's own groups stay as they are: the specs read them.
const ROOFISH = ["roof", "ac", "awn", "clutter"];
export function packChunk(out) {
  const g = out.groups, groups = {};
  const walls = STYLE.classes.map((c, i) => [g["wall_" + c], i]).filter(([x]) => x);
  if (walls.length) groups.wall = mergeGroups(walls, true);
  const roofs = ROOFISH.map(k => [g[k], 0]).filter(([x]) => x);
  if (roofs.length) groups.roof = mergeGroups(roofs);
  for (const [k, v] of Object.entries(g)) if (!k.startsWith("wall_") && !ROOFISH.includes(k)) groups[k] = v;
  return { ...out, groups };
}
function mergeGroups(parts, cls = false) {
  if (parts.length === 1 && !cls) return parts[0][0];
  let nv = 0, ni = 0;
  for (const [p] of parts) { nv += p.pos.length / 3; ni += p.idx.length; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), seed = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), c = cls ? new Uint8Array(nv) : null;
  let v = 0, i = 0;
  for (const [p, k] of parts) {
    const n = p.pos.length / 3;
    pos.set(p.pos, v * 3); nrm.set(p.nrm, v * 3); uv.set(p.uv, v * 2); col.set(p.col, v * 3); seed.set(p.seed, v);
    if (c) c.fill(k, v, v + n);
    for (let q = 0; q < p.idx.length; q++) idx[i + q] = p.idx[q] + v;
    v += n; i += p.idx.length;
  }
  return c ? { pos, nrm, uv, col, seed, idx, cls: c } : { pos, nrm, uv, col, seed, idx };
}

// the map's dark outlines: the roof edge and the corners that turn
function outline(Lb, ring, y0, top) {
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const a = ring[(k + n - 1) % n], b = ring[k], c = ring[(k + 1) % n];
    Lb.line(b[0], top, b[1], c[0], top, c[1]);
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.5) Lb.line(b[0], y0, b[1], b[0], top, b[1]);
  }
}

// the baked shadow (5.6): the footprint swept along the sun, capped, a dark
// film just above the ground that everything else draws over. Only the walls
// facing the sun's way are swept: whatever another wall's sweep covers lies
// under the building, or under the cap, or under a sunward sweep (follow a
// shadow point back toward the sun: it leaves the footprint through a
// sunward wall), so the film looks the same with a third fewer triangles.
// (ring: counter-clockwise in x,z, the outward normal (dz, -dx))
function shadow(S, ring, top, sweep = null) {
  const { kMax, k0, kPerU, y } = STYLE.shadow, dir = sweep ?? STYLE.shadow.dir;
  const k = Math.min(kMax, k0 + top * kPerU), ox = dir[0] * k, oz = dir[1] * k;
  const n = ring.length, c = [1, 1, 1];
  for (let e = 0; e < n; e++) {
    const [ax, az] = ring[e], [bx, bz] = ring[(e + 1) % n];
    if ((bz - az) * ox - (bx - ax) * oz <= 0) continue;
    S.face([[ax, y, az], [bx, y, bz], [bx + ox, y, bz + oz], [ax + ox, y, az + oz]], null, c, 0, [0, 1, 0]);
  }
  S.flat(ring.map(([x, z]) => [x + ox, z + oz]), y, c, 0);
}

// a box in a local frame: X along, Y up (tilted by pitch about X), Z out
function obb(B, c, X, Z, w, h, d, pitch, col) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const Y = [Z[0] * sp, cp, Z[2] * sp], Zp = [Z[0] * cp, -sp, Z[2] * cp];
  const P = (a, b, e) => [c[0] + X[0] * a + Y[0] * b + Zp[0] * e, c[1] + X[1] * a + Y[1] * b + Zp[1] * e, c[2] + X[2] * a + Y[2] * b + Zp[2] * e];
  const q = (a, b, e, f, g, hh, want) => B.face([P(...a), P(...b), P(...e), P(...f)], null, col, 0, want);
  const W = w / 2, H = h / 2, D = d / 2;
  q([-W, -H, D], [W, -H, D], [W, H, D], [-W, H, D], Zp);
  q([W, -H, -D], [-W, -H, -D], [-W, H, -D], [W, H, -D], Zp.map(v => -v));
  q([-W, H, -D], [-W, H, D], [W, H, D], [W, H, -D], Y);
  q([-W, -H, D], [-W, -H, -D], [W, -H, -D], [W, -H, D], Y.map(v => -v));
  q([W, -H, D], [W, -H, -D], [W, H, -D], [W, H, D], X);
  q([-W, -H, -D], [-W, -H, D], [-W, H, D], [-W, H, -D], X.map(v => -v));
}

// a cylinder or cone (8 sides) standing on the ground
function cylinder(B, x, z, r0, r1, h, col) {
  const n = 8, y1 = h, ring0 = [], ring1 = [];
  for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; ring0.push([x + Math.cos(a) * r0, z + Math.sin(a) * r0]); ring1.push([x + Math.cos(a) * r1, z + Math.sin(a) * r1]); }
  for (let k = 0; k < n; k++) {
    const a = ring0[k], b = ring0[(k + 1) % n], c2 = ring1[(k + 1) % n], d = ring1[k];
    const mx = (a[0] + b[0]) / 2 - x, mz = (a[1] + b[1]) / 2 - z;
    if (r1 > 0.01) B.face([[a[0], 0, a[1]], [b[0], 0, b[1]], [c2[0], y1, c2[1]], [d[0], y1, d[1]]], null, col, 0, [mx, 0, mz]);
    else B.face([[a[0], 0, a[1]], [b[0], 0, b[1]], [x, y1, z]], null, col, 0, [mx, 0, mz]);
  }
  if (r1 > 0.01) B.flat(ring1.slice().reverse(), y1, col, 0);
}

// the street pass (5.7) for one road-facing lot: the edge nearest the road
// gets an awning (60 %), a sign panel on a tall building (55 %), and one lot
// in ten a bin or a cone at the kerb. Deterministic from the lot's seed.
function streetPass(buf, lot, stats, soFar) {
  const { ring, cx, cz, top, s, road } = lot;
  let h = s;
  const rnd = () => ((h = hash32(h + 1)) & 0xffff) / 65536;
  let edge = null, ed = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k], [x2, z2] = ring[(k + 1) % ring.length];
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const d = (mx - road.qx) ** 2 + (mz - road.qz) ** 2;
    if (d < ed) { ed = d; edge = [x1, z1, x2, z2, mx, mz]; }
  }
  const [x1, z1, x2, z2, mx, mz] = edge;
  const elen = Math.hypot(x2 - x1, z2 - z1);
  if (elen < 5) return 0;
  const ux = (x2 - x1) / elen, uz = (z2 - z1) / elen;
  let ox = mx - cx, oz = mz - cz;
  const on = Math.hypot(ox, oz) || 1; ox /= on; oz /= on;
  let n = 0;
  const A = STYLE.awning, Pn = STYLE.panel, C = STYLE.clutter;
  if (rnd() < A.chance && soFar < 520) {
    n++;
    const col = linRGB(rgb(A.colors[s % A.colors.length]));
    obb(buf("awn"), [mx + ox * A.out, A.y, mz + oz * A.out], [ux, 0, uz], [ox, 0, oz], Math.min(elen * A.lenMul, A.maxLen), A.size[0], A.size[1], A.pitch, col);
  }
  if (top > Pn.minH && rnd() < Pn.chance) {
    stats.signs++;
    const col = linRGB(rgb(Pn.colors[s % Pn.colors.length]));
    const t = (rnd() - 0.5) * elen * 0.5;
    const sx = mx + ux * t + ox * Pn.out, sz = mz + uz * t + oz * Pn.out;
    const y = Pn.y0 + rnd() * (top - Pn.minH + 1);
    buf("panel").box(sx, y - Pn.size[1] / 2, sz, Pn.size[2], Pn.size[1], Pn.size[0], Math.atan2(uz, ux), col, 0);
  }
  if (rnd() < C.chance) {
    const kx = road.qx + ox * (road.r.w / 2 + 1.5), kz = road.qz + oz * (road.r.w / 2 + 1.5);
    if (rnd() < C.binShare) cylinder(buf("clutter"), kx, kz, C.bin.r[0], C.bin.r[1], C.bin.h, linRGB(rgb(C.bin.day)));
    else cylinder(buf("clutter"), kx, kz, C.cone.r, 0, C.cone.h, linRGB(rgb(C.cone.day)));
  }
  return n;
}

// power poles (5.8) along the wider roads, 80 u apart on one side, wired
// to the previous pole on the same road with two sagging catenaries; a lamp
// on every third pole, a paper lantern hung from every third span
// the pieces of a street (a baked road is cut at every crossing and chunk
// edge) chained back into one polyline by their shared endpoints, the
// straightest continuation first, so poles and wires can run down a street
function chainRoads(roads) {
  const key = ([x, z]) => `${Math.round(x * 2)}|${Math.round(z * 2)}`;
  const ends = new Map();
  const add = (k, v) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(v); };
  for (const r of roads) { add(key(r.pts[0]), { r, atStart: true }); add(key(r.pts[r.pts.length - 1]), { r, atStart: false }); }
  const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = (a, b) => { const d = b - a; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); };
  const used = new Set(), chains = [];
  const extend = (pts, chain) => {
    for (;;) {
      const end = pts[pts.length - 1], dir = heading(pts[pts.length - 2], end);
      let best = null, bd = 0.6;   // joins that turn less than ~35°
      for (const c of ends.get(key(end)) ?? []) {
        if (used.has(c.r)) continue;
        const q = c.atStart ? c.r.pts : [...c.r.pts].reverse();
        const d = turn(dir, heading(q[0], q[1]));
        if (d < bd) { bd = d; best = { r: c.r, q }; }
      }
      if (!best) return;
      used.add(best.r);
      chain.w = Math.max(chain.w, best.r.w);
      pts.push(...best.q.slice(1));
    }
  };
  for (const r of roads) {
    if (used.has(r)) continue;
    used.add(r);
    const chain = { c: r.c, w: r.w, pts: [...r.pts] };
    extend(chain.pts, chain);
    chain.pts.reverse();
    extend(chain.pts, chain);
    chains.push(chain);
  }
  return chains;
}

function polesAlong(roads, Wr, poles, lanterns) {
  const P = STYLE.pole;
  const total = pts => { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return L; };
  // the point and direction a distance d along a polyline
  const along = (pts, d) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az);
      if (d <= len || k === pts.length - 2) { const t = len ? Math.min(d, len) / len : 0; return [ax + (bx - ax) * t, az + (bz - az) * t, len ? (bx - ax) / len : 1, len ? (bz - az) / len : 0]; }
      d -= len;
    }
    return [pts[0][0], pts[0][1], 1, 0];
  };
  // the longest streets wide enough carry the poles, a line of them down one
  // side, so every pole has a wire to the next; a piece too short for two has none
  const cands = chainRoads(roads.filter(r => r.w >= P.minRoad)).map(r => ({ r, L: total(r.pts) })).filter(c => c.L >= P.spacing * 1.1).sort((a, b) => b.L - a.L);
  let j = 0;
  for (const { r, L } of cands) {
    const n = Math.min(Math.floor(L / P.spacing) + 1, Math.floor((P.maxPerChunk * 3 - poles.length) / 3));
    if (n < 2) return;
    const start = (L - (n - 1) * P.spacing) / 2, off = r.w / 2 + P.out;
    let prev = null;
    for (let i = 0; i < n; i++, j++) {
      const [x, z, ux, uz] = along(r.pts, start + i * P.spacing);
      const px = x - uz * off, pz = z + ux * off;
      poles.push(px, pz, j % P.lampEvery === 0 ? 1 : 0);
      if (prev && Math.hypot(px - prev[0], pz - prev[1]) < P.maxSpan) {
        for (const wy of P.wireY) {
          for (let q = 0; q < P.segs; q++) {
            const t0 = q / P.segs, t1 = (q + 1) / P.segs;
            const sag = t => wy - Math.sin(t * Math.PI) * P.sag;
            Wr.line(prev[0] + (px - prev[0]) * t0, sag(t0), prev[1] + (pz - prev[1]) * t0, prev[0] + (px - prev[0]) * t1, sag(t1), prev[1] + (pz - prev[1]) * t1);
          }
        }
        if (j % P.lanternEvery === 1) {   // a paper lantern hung mid-span under the lower wire
          const lx = (prev[0] + px) / 2, lz = (prev[1] + pz) / 2, ly = P.wireY[1] - P.sag - P.lanternDrop;
          lanterns.push(lx, ly, lz);
          Wr.line(lx, ly + 1.1, lz, lx, ly + P.lanternDrop + 0.1, lz);
        }
      }
      prev = [px, pz];
    }
  }
}

// a flat strip along a polyline, with round-ish joints; uv along the length
function ribbon(Bf, pts, hw, y, c, uvMode, seedV, joints = true) {
  let run = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const nx = -(bz - az) / len * hw, nz = (bx - ax) / len * hw;
    const v0 = run / 26, v1 = (run + len) / 26;
    run += len;
    Bf.face([[ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz]],
      uvMode ? [[0, v0], [0, v1], [1, v1], [1, v0]] : null, c, seedV, [0, 1, 0]);
  }
  if (!joints) return;
  for (let k = 0; k < pts.length; k++) { // joints and ends (a hexagon fills the wedge)
    if (k > 0 && k < pts.length - 1) {
      const a = pts[k - 1], b = pts[k], c2 = pts[k + 1];
      const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c2[1] - b[1], c2[0] - b[0]);
      let d = Math.abs(t2 - t1); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < 0.12) continue; // straight through: no gap to fill
    }
    const [x, z] = pts[k];
    const oct = [];
    for (let a = 0; a < 6; a++) oct.push([x + Math.cos(a * Math.PI / 3) * hw, y - 0.005, z + Math.sin(a * Math.PI / 3) * hw]);
    Bf.face(oct, uvMode ? oct.map(q => [(q[0] - x) / (2 * hw) + 0.5, 0]) : null, c, seedV, [0, 1, 0]);
  }
}

function scatterTrees(out, ring, step, keep, seed) {
  let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const [x, z] of ring) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); }
  if ((mxx - mnx) * (mxz - mnz) < step * step * 0.6) return;
  let s = seed >>> 0;
  for (let x = mnx + step / 2; x < mxx; x += step) {
    for (let z = mnz + step / 2; z < mxz; z += step) {
      s = hash32(s + 1);
      if ((s & 1023) / 1023 > keep) continue;
      const jx = x + ((s >> 10) & 255) / 255 * step * 0.8 - step * 0.4, jz = z + ((s >> 18) & 255) / 255 * step * 0.8 - step * 0.4;
      if (!pointInRing(jx, jz, ring)) continue;
      out.push(jx, jz, STYLE.tree.scale[0] + ((s >> 4) & 63) / 63 * (STYLE.tree.scale[1] - STYLE.tree.scale[0]), ((s >> 12) % 100) < STYLE.tree.palmShare * 100 ? 1 : 0);
    }
  }
}

// a landmark's glowing crown: a lit band round the top of its walls
function crown(G, ring, top, c, seed) {
  const n = ring.length, h = Math.max(1.2, top * 0.035);
  for (let k = 0; k < n; k++) {
    const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const nx = (bz - az) / len * 0.18, nz = -(bx - ax) / len * 0.18;
    G.face([[ax + nx, top - h, az + nz], [bx + nx, top - h, bz + nz], [bx + nx, top + 0.15, bz + nz], [ax + nx, top + 0.15, az + nz]],
      null, c, seed, [nx, 0, nz]);
  }
}

// a placeholder tower: an eight-sided shaft, a pod near the top with a lit
// band, a mast (N Seoul Tower, Calgary Tower until their models are in)
function tower(buf, h, glowC) {
  const H = worldHeight(h.h ?? 150), R = (h.radius ?? 7) * SCALE, sd = 8;
  const prism = (B, r0, r1, y0, y1, c) => {
    const ring = k => [h.x + Math.cos(k / sd * Math.PI * 2) * 1, h.z + Math.sin(k / sd * Math.PI * 2) * 1];
    for (let k = 0; k < sd; k++) {
      const [ax, az] = ring(k), [bx, bz] = ring(k + 1);
      const ox = (ax - h.x), oz = (az - h.z), px = (bx - h.x), pz = (bz - h.z);
      B.face([[h.x + ox * r0, y0, h.z + oz * r0], [h.x + px * r0, y0, h.z + pz * r0], [h.x + px * r1, y1, h.z + pz * r1], [h.x + ox * r1, y1, h.z + oz * r1]],
        null, c, 0.5, [(ox + px) / 2, 0, (oz + pz) / 2]);
    }
    const capR = r1, cap = []; for (let k = 0; k < sd; k++) cap.push([h.x + (ring(k)[0] - h.x) * capR, h.z + (ring(k)[1] - h.z) * capR]);
    B.flat(cap.reverse(), y1, c, 0.5);
  };
  const shaft = linRGB(rgb(0xe9e4d8)), pod = linRGB(rgb(0xd7d2c6)), mast = linRGB(rgb(0xc9c4b8));
  const R0 = buf("roof"), G = buf("glow");
  prism(R0, R * 1.25, R * 0.85, -0.4, H * 0.72, shaft);
  prism(R0, R * 2.3, R * 2.6, H * 0.72, H * 0.8, pod);
  prism(G, R * 2.62, R * 2.62, H * 0.765, H * 0.785, glowC);
  prism(R0, R * 2.6, R * 1.6, H * 0.8, H * 0.86, pod);
  prism(R0, R * 0.35, R * 0.18, H * 0.86, H, mast);
}
