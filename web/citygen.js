// City chunks, geometry: one z16 chunk of baked map data (scripts/
// bake_city_tiles.py) -> flat typed arrays per material, ready for
// THREE.BufferGeometry. Pure JS, no three.js and no DOM, so it runs in the
// chunk worker (citygen.worker.js), on the page as a fallback, and in node
// tests. web/citytiles.js owns the materials, the meshes and the streaming.
//
// The look is the map's: low-poly extrusions, flat roofs on blocks and
// towers, gabled / hipped roofs on houses, window grids by type (the night
// lights pick windows per building in the shader), shopfronts and abstract
// glowing signs where commercial buildings face a street, pale roads with
// sidewalks, green parks and forests with trees, blue water.

export const SCALE = 0.55;         // world units per metre (world3d geoPos)
export const FLOOR_U = 3.2 * SCALE * 2.4; // one storey in world units (the map's 2.4x vertical)
export const EXTENT = 4096;

// metres -> world height: the map's 2.4x vertical up to 25 m, gentler above
// so a 200 m tower doesn't swallow the screen
export function worldHeight(m) {
  return m <= 25 ? m * SCALE * 2.4 : (25 * 2.4 + (m - 25) * 1.45) * SCALE;
}

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

// ---- palettes (sRGB hex). Warm, slightly desaturated, like the map.
// the map's warm cream family (theme.js walls), nudged per type
const WALLS = {
  h: [0xf2efe7, 0xebdfd6, 0xe6dccb, 0xdcc9b4, 0xe8e2d4, 0xd9c2ad],
  a: [0xf2efe7, 0xe8e2d4, 0xeeeae2, 0xe3e1da, 0xebe4d6],
  c: [0xe8e2d4, 0xdcd5c5, 0xe6dccb, 0xebdfd6, 0xd6cfc3, 0xddd0bd, 0xe2d6c4],
  o: [0xd3d6d6, 0xc8ced2, 0xdcdcd6, 0xc3c8c8, 0xd0d2cc],
  v: [0xe2cdb8, 0xe6dccb, 0xd9c0a8, 0xe8e2d4],
  i: [0xd6cfc3, 0xcfcbc1, 0xdcd5c5],
  s: [0xdcd5c5, 0xd6cfc3],
};
const ROOF_PITCHED = [0x9a6a58, 0x7d8590, 0x6f7078, 0x7f907e, 0x8c7466];
const ROOF_FLAT = [0xd9d4c8, 0xcdc8bc, 0xc4c3ba, 0xd2cabc];
const ROOF_GREEN = 0x9fb5a0; // Seoul's green-painted rooftops
const SIGNS = [0xff5d8a, 0xffc83d, 0x5de0ff, 0x8a7dff, 0xff8a3d, 0x5dffb0, 0xff4d4d, 0xfff2a8];
const GROUND = {
  park: 0xb4c98c, forest: 0x93b179, plaza: 0xede5d5, walk: 0xe9e3d6, mark: 0xfbfaf4,
};
export const ROAD_W = { // world units, a touch wider than real so the streets read
  motorway: 15, trunk: 14, primary: 13, secondary: 11, tertiary: 9, residential: 6.6,
  living_street: 5.5, unclassified: 6.6, service: 4.2, pedestrian: 5, footway: 2, cycleway: 2,
  path: 1.8, steps: 2, track: 3,
};
const WALK_ADD = { motorway: 0, trunk: 3, primary: 3.4, secondary: 3, tertiary: 2.6, residential: 2,
  living_street: 1.6, unclassified: 1.6 };
const MAIN = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const SHOPPY = new Set(["primary", "secondary", "tertiary", "residential", "living_street", "pedestrian", "unclassified"]);
const MINOR = new Set(["footway", "path", "steps", "cycleway", "service", "track"]);
const LAMPS = new Set(["trunk", "primary", "secondary", "tertiary", "residential", "living_street", "pedestrian"]);

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

// ---- the chunk
// payload: the parsed tile JSON. opts: { z, x, y, origin:[lat,lng], lod: 0|1,
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
  const near = lod === 0;
  const B = {};
  const buf = k => (B[k] ??= new Buf());
  const stats = { buildings: 0, hidden: 0, shops: 0, signs: 0, roads: 0, trees: 0, lamps: 0 };

  const heroes = (opts.heroes || []).map(h => {
    const [hx, hz] = P.fwd(h.lng, h.lat);
    const [fx, fy] = lngLatToTile(h.lng, h.lat, z);
    return { ...h, x: hx, z: hz, r: (h.clear ?? 0) * SCALE, fpW: h.fp ? h.fp.map(([lng, lat]) => P.fwd(lng, lat)) : null,
      here: Math.floor(fx) === tx && Math.floor(fy) === ty };
  });
  const hides = h => h.glb || (h.landmark && h.shape === "tower");
  const ex = opts.exclude;
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

  // roads first: shopfronts and lamps look for them
  const roads = [];
  for (const r of payload.r || []) {
    const pts = [];
    for (let k = 0; k < r.p.length; k += 2) pts.push(toW(r.p[k], r.p[k + 1]));
    if (pts.length < 2) continue;
    if (ex) { const [mx, mz] = pts[pts.length >> 1]; if (Math.hypot(mx, mz) < ex.r) continue; }
    if (!near && MINOR.has(r.c)) continue; // far away: streets only, no paths
    roads.push({ c: r.c, n: r.n, pts, w: ROAD_W[r.c] ?? 5 });
  }
  const shopRoads = roads.filter(r => SHOPPY.has(r.c));

  // --- buildings
  const nightWin = 0;
  for (let i = 0; i < (payload.b || []).length; i++) {
    const b = payload.b[i];
    let ring = [];
    for (let k = 0; k < b.p.length; k += 2) ring.push(toW(b.p[k], b.p[k + 1]));
    if (ring.length < 3) continue;
    if (ringArea(ring) < 0) ring = ring.reverse(); // CCW in (x,z): outward normal is (dz,-dx)
    const [cx, cz] = centroid(ring);
    if (ex && Math.hypot(cx, cz) < ex.b) continue;
    if (heroes.some(h => hides(h) && ((h.osm && b.o === h.osm) || (h.fpW && pointInRing(cx, cz, h.fpW)) || (h.r && Math.hypot(cx - h.x, cz - h.z) < h.r))) ||
        (opts.clearAt && (pointInRing(0, 0, ring) || Math.hypot(cx, cz) < opts.clearAt * SCALE))) {
      stats.hidden++;
      continue;
    }
    if (!near && b.k === "s") continue;
    stats.buildings++;
    const s = seedOf(b, i, key);
    const kind = WALLS[b.k] ? b.k : "c";
    const fc = parseHex(b.fc);
    const jit = 0.97 + (s % 97) / 97 * 0.09;
    const wallC = linRGB(rgb(fc ?? pick(WALLS[kind], s >>> 3), jit));
    const hero = boosted.get(i);
    const top = worldHeight(hero ? Math.max(b.h, hero.h ?? b.h) : b.h);
    const y0 = -0.4;
    const floors = Math.max(1, b.f || Math.round(b.h / 3.2));
    const seedF = (s % 997) / 997;
    const wk = near ? "wall_" + kind : "wall_g";
    const W = buf(wk);
    let run = (s % 13) * 1.7;
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const nx = (bz - az) / len, nz = -(bx - ax) / len;
      const u0 = run / 6.6, u1 = (run + len) / 6.6;
      run += len;
      W.face([[ax, y0, az], [bx, y0, bz], [bx, top, bz], [ax, top, az]],
        [[u0, 0], [u1, 0], [u1, floors], [u0, floors]], wallC, seedF, [nx, 0, nz]);
    }
    if (near) outline(buf("lines"), ring, y0, top);
    if (hero) crown(buf("glow"), ring, top, linRGB(rgb(parseHex(hero.glow) ?? 0xffd36b)), seedF);
    // roof
    const R = buf("roof");
    const box = b.r !== "f" ? orientedBox(ring) : null;
    if (box && box.S > 1.2) {
      const roofC = linRGB(rgb(pick(ROOF_PITCHED, s >>> 5), 0.94 + (s % 7) * 0.02));
      pitchedRoof(R, box, top, b.r, roofC, wallC, seedF);
    } else {
      const korea = opts.origin[0] > 33 && opts.origin[0] < 39 && opts.origin[1] > 124 && opts.origin[1] < 131;
      const green = korea && b.k !== "o" && (s >>> 7) % 100 < 34;
      const roofC = linRGB(rgb(green ? ROOF_GREEN : pick(ROOF_FLAT, s >>> 5), 0.95 + (s % 5) * 0.02));
      R.flat(ring, top, roofC, seedF);
      if (near && b.k !== "h" && Math.abs(ringArea(ring)) > 40) rooftop(R, ring, top, s, korea);
    }
    // shopfronts + signs on commercial buildings facing a street
    if (near && (b.k === "c" || ((b.k === "a" || b.k === "o") && (s % 3 === 0))) && shopRoads.length) {
      shopfronts(buf, ring, top, floors, b, s, shopRoads, stats);
    }
  }

  // --- roads: sidewalks under, asphalt over, a dashed centre line on big ones
  const G = buf("ground");
  const Rd = buf("road");
  const walkC = linRGB(rgb(GROUND.walk)), markC = linRGB(rgb(GROUND.mark));
  for (const r of roads) {
    stats.roads++;
    const wa = WALK_ADD[r.c] ?? 0;
    if (wa && near) ribbon(G, r.pts, r.w / 2 + wa, 0.1, walkC, 0, 0, true);
    else if (wa && MAIN.has(r.c)) ribbon(G, r.pts, r.w / 2 + wa * 0.7, 0.1, walkC, 0, 0, false);
    ribbon(Rd, r.pts, r.w / 2, 0.16, [1, 1, 1], 1, MINOR.has(r.c) ? 1 : 0, near || MAIN.has(r.c));
    if (near && MAIN.has(r.c) && r.w >= 9) dashes(G, r.pts, 0.22, markC);
  }

  // --- placeholder towers (landmarks with no model yet, shape "tower")
  for (const h of heroes) if (h.here && !h.glb && h.landmark && h.shape === "tower") tower(buf, h, linRGB(rgb(parseHex(h.glow) ?? 0xffd36b)));

  // --- parks, forests, plazas, water
  const Wt = buf("water");
  const trees = [], wet = [];
  for (const a of payload.a || []) {
    const ring = [];
    for (let k = 0; k < a.p.length; k += 2) ring.push(toW(a.p[k], a.p[k + 1]));
    if (ring.length < 3) continue;
    if (ex && Math.hypot(...ring[0]) < ex.b && Math.hypot(...ring[ring.length >> 1]) < ex.b) continue;
    // (water above parks and plazas: a lake often sits inside its park's outline)
    if (a.k === "water" || a.k === "ocean") { Wt.flat(ring, a.k === "ocean" ? 0.085 : 0.09, [1, 1, 1], 0, 0.02); wet.push(ring); continue; }
    const y = a.k === "plaza" ? 0.08 : a.k === "forest" ? 0.05 : 0.06;
    G.flat(ring, y, linRGB(rgb(GROUND[a.k] ?? GROUND.park)), 0);
    if (a.k === "park" || a.k === "forest") scatterTrees(trees, ring, a.k === "forest" ? 8.5 : 13, near ? 1 : 0.35, key ^ a.p.length);
  }
  if (wet.length) {           // no trees on the water
    let n = 0;
    for (let k = 0; k < trees.length; k += 4) if (!wet.some(r => pointInRing(trees[k], trees[k + 1], r))) { trees[n++] = trees[k]; trees[n++] = trees[k + 1]; trees[n++] = trees[k + 2]; trees[n++] = trees[k + 3]; }
    trees.length = n;
  }
  const maxTrees = near ? 80 : 28;     // (4 numbers a tree)
  if (trees.length > maxTrees * 4) trees.length = maxTrees * 4;
  stats.trees = trees.length / 4;

  // --- street lamps along lit streets (near chunks only)
  const lamps = [];
  if (near) {
    for (const r of roads) {
      if (!LAMPS.has(r.c)) continue;
      let acc = 13, side = 1;
      for (let k = 0; k < r.pts.length - 1; k++) {
        const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        while (acc < len) {
          const off = r.w / 2 + 0.8;
          lamps.push(ax + ux * acc - uz * off * side, az + uz * acc + ux * off * side, Math.atan2(ux, uz) + (side > 0 ? 0 : Math.PI));
          side = -side;
          acc += MAIN.has(r.c) ? 24 : 30;
        }
        acc -= len;
      }
    }
  }
  stats.lamps = lamps.length / 3;

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
    if (ex && Math.hypot(x, z) < ex.r) continue;
    labels.push({ text: l.t, x, z, poi: !!l.poi });
  }

  const groups = {};
  for (const [k, b] of Object.entries(B)) { const o = b.out(); if (o) groups[k] = o; }
  // round Itaewon the procedural city stands on the hand-made map's hills
  if (ex) for (const g of Object.values(groups)) for (let k = 0; k < g.pos.length; k += 3) g.pos[k + 1] += itaewonHill(g.pos[k], g.pos[k + 2]);
  return { groups, trees: new Float32Array(trees), lamps: new Float32Array(lamps), labels, stats, nightWin };
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

function pitchedRoof(R, box, top, kind, roofC, wallC, seed) {
  const { c, ax } = box;
  const L = box.L + 0.7, S = box.S + 0.7; // eaves
  const ux = ax[0], uz = ax[1], vx = -uz, vz = ux;
  const P = (u, v, y) => [c[0] + ux * u + vx * v, y, c[1] + uz * u + vz * v];
  const rh = Math.min(S * 0.42, 7.5);
  const ry = top + rh;
  const c0 = P(-L / 2, -S / 2, top), c1 = P(L / 2, -S / 2, top), c2 = P(L / 2, S / 2, top), c3 = P(-L / 2, S / 2, top);
  const up = (a, b) => [(a[0] + b[0]) / 2 - c[0], 1.5, (a[2] + b[2]) / 2 - c[1]];
  if (kind === "p" || L - S < 0.6) { // pyramid
    const apex = [c[0], ry, c[1]];
    for (const [a, b] of [[c0, c1], [c1, c2], [c2, c3], [c3, c0]]) R.face([a, b, apex], null, roofC, seed, up(a, b));
    return;
  }
  if (kind === "h") {
    const r0 = P(-L / 2 + S / 2, 0, ry), r1 = P(L / 2 - S / 2, 0, ry);
    R.face([c0, c1, r1, r0], null, roofC, seed, up(c0, c1));
    R.face([c2, c3, r0, r1], null, roofC, seed, up(c2, c3));
    R.face([c1, c2, r1], null, roofC, seed, up(c1, c2));
    R.face([c3, c0, r0], null, roofC, seed, up(c3, c0));
    return;
  }
  // gabled: ridge along the long side, wall-coloured gable ends
  const m0 = P(-L / 2, 0, ry), m1 = P(L / 2, 0, ry);
  R.face([c0, c1, m1, m0], null, roofC, seed, up(c0, c1));
  R.face([c2, c3, m0, m1], null, roofC, seed, up(c2, c3));
  const g = [wallC[0] * 0.92, wallC[1] * 0.92, wallC[2] * 0.92];
  R.face([c1, c2, m1], null, g, seed, [ux, 0, uz]);
  R.face([c3, c0, m0], null, g, seed, [-ux, 0, -uz]);
}

function rooftop(R, ring, top, s, korea) {
  const [cx, cz] = centroid(ring);
  const n = 1 + (s % 3);
  for (let k = 0; k < n; k++) {
    const hs = hash32(s + k * 977);
    const dx = ((hs & 255) / 255 - 0.5) * 5, dz = (((hs >> 8) & 255) / 255 - 0.5) * 5;
    const x = cx + dx, z = cz + dz;
    if (!pointInRing(x, z, ring)) continue;
    const tank = korea && k === 0 && (hs >> 16) % 3 === 0;
    const c = linRGB(rgb(tank ? 0x5f9a78 : 0xb9b6ae));
    if (tank) R.box(x, top, z, 1.6, 1.9, 1.6, 0, c, 0);
    else R.box(x, top, z, 1.4 + (hs % 5) * 0.2, 0.9, 1.1, ((hs >> 4) % 6) * 0.5, c, 0);
  }
}

function shopfronts(buf, ring, top, floors, b, s, roads, stats) {
  const S = buf("shop"), G = buf("sign");
  const fh = Math.min(FLOOR_U, top - 0.4);
  let blade = b.k === "c" && floors >= 3 && s % 2 === 0;
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 2.6) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len, nx = uz, nz = -ux;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let faces = false;
    for (const r of roads) {
      for (let q = 0; q < r.pts.length - 1 && !faces; q++) {
        const [d, qx, qz] = segDist(mx, mz, r.pts[q][0], r.pts[q][1], r.pts[q + 1][0], r.pts[q + 1][1]);
        if (d < r.w / 2 + 6 && (qx - mx) * nx + (qz - mz) * nz > 0.3) faces = true;
      }
      if (faces) break;
    }
    if (!faces) continue;
    stats.shops++;
    const es = hash32(s + k * 131);
    const inset = Math.min(0.35, len * 0.1), o = 0.1;
    const p0 = [ax + ux * inset + nx * o, az + uz * inset + nz * o], p1 = [bx - ux * inset + nx * o, bz - uz * inset + nz * o];
    const L = len - inset * 2;
    const variant = es % 4;
    const v0 = variant / 4, v1 = (variant + 1) / 4;
    const u1 = Math.max(1, Math.round(L / 4.6));
    S.face([[p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], fh, p1[1]], [p0[0], fh, p0[1]]],
      [[0, v0], [u1, v0], [u1, v1], [0, v1]], [1, 1, 1], (es % 997) / 997, [nx, 0, nz]);
    // the sign band over the shop: an abstract lit panel (no text)
    if (top > fh + 1.6) {
      stats.signs++;
      const sc = linRGB(rgb(pick(SIGNS, es >>> 3)));
      const sl = L * (0.6 + (es % 30) / 100), off = (L - sl) / 2, so = 0.28;
      const q0 = [p0[0] + ux * off + nx * so, p0[1] + uz * off + nz * so], q1 = [q0[0] + ux * sl, q0[1] + uz * sl];
      const sv = (es >>> 9) % 8;
      G.face([[q0[0], fh + 0.15, q0[1]], [q1[0], fh + 0.15, q1[1]], [q1[0], fh + 1.25, q1[1]], [q0[0], fh + 1.25, q0[1]]],
        [[0, sv / 8], [Math.max(1, Math.round(sl / 3)), sv / 8], [Math.max(1, Math.round(sl / 3)), (sv + 1) / 8], [0, (sv + 1) / 8]],
        sc, 1, [nx, 0, nz]);
    }
    // one vertical blade sign per tall commercial building
    if (blade && top > fh * 2.2) {
      blade = false;
      stats.signs++;
      const bc = linRGB(rgb(pick(SIGNS, es >>> 11)));
      const bx0 = ax + ux * 0.8 + nx * 0.2, bz0 = az + uz * 0.8 + nz * 0.2;
      const y0 = fh + 1.6, y1 = Math.min(top - 1, y0 + FLOOR_U * Math.min(4, floors - 1.5));
      const w = 0.35, d = 1.5;
      const A = [bx0 - ux * w, bz0 - uz * w], Bp = [bx0 + ux * w, bz0 + uz * w];
      const A2 = [A[0] + nx * d, A[1] + nz * d], B2 = [Bp[0] + nx * d, Bp[1] + nz * d];
      const sv = (es >>> 13) % 8, hv = Math.max(1, Math.round((y1 - y0) / 3));
      const uvs = [[0, sv / 8], [hv, sv / 8], [hv, (sv + 1) / 8], [0, (sv + 1) / 8]];
      // two big faces (both sides of the blade) + the front edge
      G.face([[A[0], y0, A[1]], [A2[0], y0, A2[1]], [A2[0], y1, A2[1]], [A[0], y1, A[1]]], uvs, bc, 1, [-ux, 0, -uz]);
      G.face([[Bp[0], y0, Bp[1]], [B2[0], y0, B2[1]], [B2[0], y1, B2[1]], [Bp[0], y1, Bp[1]]], uvs, bc, 1, [ux, 0, uz]);
      G.face([[A2[0], y0, A2[1]], [B2[0], y0, B2[1]], [B2[0], y1, B2[1]], [A2[0], y1, A2[1]]], null, bc, 1, [nx, 0, nz]);
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

function dashes(G, pts, y, c) {
  let acc = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz * 0.22, nz = ux * 0.22;
    while (acc + 3 < len) {
      const sx = ax + ux * acc, sz = az + uz * acc, ex = sx + ux * 3, ez = sz + uz * 3;
      G.face([[sx + nx, y, sz + nz], [ex + nx, y, ez + nz], [ex - nx, y, ez - nz], [sx - nx, y, sz - nz]], null, c, 0, [0, 1, 0]);
      acc += 8;
    }
    acc -= len;
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
      out.push(jx, jz, 0.8 + ((s >> 4) & 63) / 63 * 0.6, s % 3);
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
