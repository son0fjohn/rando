// The city anywhere on Earth: where the baked archive (scripts/
// bake_city_tiles.py) has no chunk, the worker reads the free worldwide
// OpenMapTiles vector tiles that OpenFreeMap serves (OpenStreetMap data, no
// key, no per-user cost) and turns each one into the same chunk payloads the
// archive holds. One z14 tile covers 4 x 4 of our z16 chunks.
//
//   omtChunks(bytes, x14, y14, { buildings }) -> Map("x16,y16" -> payload)
//
// buildings: the same z14 tile out of Overture Maps' building tiles (the
// "building" layer of an Overture buildings PMTiles: OpenStreetMap plus the
// machine-learned footprints OpenStreetMap lacks, with height, num_floors,
// class, roof_shape). Given, the buildings come from it instead of
// OpenMapTiles' layer (which is OpenStreetMap only: in Korea a fraction of
// the houses); bytes may then be null (only the buildings, no roads).
//
// Buildings: the footprint (clipped to the z14 tile so neighbours meet
// exactly), render_height when the map has one. OpenMapTiles fills a missing
// height with 5 m, so 5 m or less counts as unknown and is estimated the
// baker's way: a type from size, shape and whether it fronts a main road,
// then floors per type (houses 2-4, apartments 10-20, offices 8-20...),
// deterministic per building. Roads by class (tunnels left out), water,
// parks, woods and grass, the names of main roads and of major places.
// Pure JS, no DOM: the chunk worker and node tests run it.
import { decodeMVT, ringArea } from "./mvt.js";

export const OMT_Z = 14;
const SUB = 4, EXT = 4096, BIG = SUB * EXT; // z14 tile in z16-chunk units
const LEVEL_M = 3.2;
const FLOORS = { h: [2, 4], a: [10, 20], c: [3, 6], o: [8, 20], v: [3, 5], i: [1, 3], s: [1, 1] };
const MAIN = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const ROAD = {
  motorway: "motorway", trunk: "trunk", primary: "primary", secondary: "secondary", tertiary: "tertiary",
  minor: "residential", service: "service", track: "track", busway: "primary",
};
const PATH = { pedestrian: "pedestrian", footway: "footway", cycleway: "cycleway", steps: "steps", path: "path", bridleway: "path" };
const MINOR_SUB = { living_street: "living_street", unclassified: "unclassified", residential: "residential" };
const LANDCOVER = { grass: "park", wood: "forest", forest: "forest", wetland: "park" };
const LANDUSE = { cemetery: "park", pitch: "park", playground: "park", stadium: "park", garden: "park" };

function hash(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; }

// Sutherland-Hodgman: a ring clipped to a box (open ring in, open ring out)
function clipRing(ring, x0, y0, x1, y1) {
  let out = ring;
  const edges = [[p => p[0] >= x0, (a, b) => at(a, b, (x0 - a[0]) / (b[0] - a[0]))],
                 [p => p[0] <= x1, (a, b) => at(a, b, (x1 - a[0]) / (b[0] - a[0]))],
                 [p => p[1] >= y0, (a, b) => at(a, b, (y0 - a[1]) / (b[1] - a[1]))],
                 [p => p[1] <= y1, (a, b) => at(a, b, (y1 - a[1]) / (b[1] - a[1]))]];
  for (const [inside, cross] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (inside(b)) { if (!inside(a)) out.push(cross(a, b)); out.push(b); }
      else if (inside(a)) out.push(cross(a, b));
    }
    if (out.length < 3) return [];
  }
  return out;
}
const at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// a polyline clipped to a box: the runs inside (Liang-Barsky per segment)
function clipLine(pts, x0, y0, x1, y1) {
  const runs = [];
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const s = [ax + dx * t0, ay + dy * t0], e = [ax + dx * t1, ay + dy * t1];
    if (!cur || t0 > 0) { cur = [s]; runs.push(cur); }
    cur.push(e);
    if (t1 < 1) cur = null;
  }
  return runs.filter(r => r.length >= 2);
}

function centroid(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return r[0];
  return [cx / (3 * a), cy / (3 * a)];
}

// oriented bounding box over the hull: long side, short side, how full
function obb(r) {
  const pts = r.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (const p of hull) { const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux; mnU = Math.min(mnU, u); mxU = Math.max(mxU, u); mnV = Math.min(mnV, v); mxV = Math.max(mxV, v); }
    const A = (mxU - mnU) * (mxV - mnV);
    if (!best || A < best.A) best = { A, L: Math.max(mxU - mnU, mxV - mnV), S: Math.min(mxU - mnU, mxV - mnV) };
  }
  return best ?? { A: 1, L: 1, S: 1 };
}

// the baker's classify(), for buildings with no type: size, shape, the road
// a floor count with no data: the class's range, where the seed and the
// footprint's size place it (a big footprint leans taller within its class)
function guessFloors(kind, area, seed) {
  const [lo, hi] = FLOORS[kind];
  const rank = Math.min(1, Math.max(0, (Math.log(Math.max(area, 1)) - Math.log(60)) / (Math.log(2000) - Math.log(60))));
  const u = 0.6 * ((seed % 1000) / 1000) + 0.4 * rank;
  return lo + Math.min(hi - lo, Math.floor(u * (hi - lo + 1)));
}
// ... then its street: halfway to the median floors of the measured
// buildings within 60 m, within its class's range (the bake does the same)
export function settleGuesses(bs, mPerPx) {
  const c = bs.map(b => { const p = b.p; let x = 0, y = 0; for (let k = 0; k < p.length; k += 2) { x += p[k]; y += p[k + 1]; } return [x / (p.length / 2), y / (p.length / 2)]; });
  const r2 = (60 / mPerPx) ** 2;
  bs.forEach((b, i) => {
    if (!b._g) return;
    delete b._g;
    const near = [];
    bs.forEach((o, j) => { if (o.m && (c[j][0] - c[i][0]) ** 2 + (c[j][1] - c[i][1]) ** 2 < r2) near.push(o.f); });
    if (near.length < 2) return;
    near.sort((a, b2) => a - b2);
    const [lo, hi] = FLOORS[b.k];
    const fl = Math.max(lo, Math.min(hi, Math.round(0.5 * b.f + 0.5 * near[near.length >> 1])));
    if (fl !== b.f) { b.f = fl; b.h = Math.round((fl * LEVEL_M + 1) * 10) / 10; }
  });
}

// Overture's (OpenStreetMap's) building class -> our type (the baker's
// classify(), scripts/bake_city_tiles.py); null: not a building we draw
const KIND = {};
for (const [k, list] of Object.entries({
  h: "house detached semidetached_house terrace bungalow hut cabin farm static_caravan villa",
  a: "apartments dormitory",
  c: "commercial retail kiosk supermarket mall shop",
  o: "office hotel government",
  v: "school university college kindergarten hospital church temple shrine civic public train_station transportation religious cathedral mosque chapel fire_station library museum stadium sports_hall sports_centre",
  i: "industrial warehouse factory manufacture service",
  s: "garage garages shed carport toilets storage_tank outbuilding",
  x: "roof shelter construction ruins bridge",
})) for (const c of list.split(" ")) KIND[c] = k;
const SUBKIND = { education: "v", religious: "v", civic: "v", medical: "v", transportation: "v", industrial: "i", outbuilding: "s" };
function classKind(cls, sub, area) {
  const c = (cls || "").toLowerCase(), k = KIND[c];
  if (k) return k === "x" ? null : k;
  if (c === "residential" || sub === "residential") return area > 700 ? "a" : "h";
  if (sub === "commercial") return area > 1500 ? "o" : "c";
  return SUBKIND[sub] ?? "";   // "": nothing known, guessed from size and shape
}
const ROOF = { gabled: "g", saltbox: "g", gambrel: "g", mansard: "g", hipped: "h", "half-hipped": "h", pyramidal: "p" };

function guessKind(area, elong, fronts, korea) {
  if (area < 25) return "s";
  if (area < 150) return fronts ? "c" : "h";
  if (area < 700) return fronts || area >= 300 ? "c" : "h";
  if (korea && elong >= 2.2 && area < 3500 && !fronts) return "a";
  if (fronts || area >= 2500) return "o";
  return "c";
}
function roofFor(kind, area, fill, korea, seed) {
  if (!["h", "v", "s"].includes(kind) || area > 420 || fill < 0.72) return "f";
  const pitched = kind === "v" ? 0.3 : korea ? 0.45 : 0.7;
  if ((seed % 1000) / 1000 >= pitched) return "f";
  return (seed >> 10) % 3 ? "g" : "h";
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
const flat = (pts, ox, oy) => { const o = []; for (const [x, y] of pts) o.push(Math.round((x - ox) * 10) / 10, Math.round((y - oy) * 10) / 10); return o; };

export function omtChunks(bytes, x14, y14, { buildings = null } = {}) {
  const L = bytes ? decodeMVT(bytes) : {};
  const OV = buildings ? decodeMVT(buildings) : null;
  const out = new Map();
  const chunk = (i, j) => {
    const k = `${x14 * SUB + i},${y14 * SUB + j}`;
    if (!out.has(k)) out.set(k, { v: 1, src: "omt", b: [], r: [], a: [], l: [] });
    return out.get(k);
  };
  for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) chunk(i, j);
  // metres per unit (z16-chunk units across the z14 tile) at this latitude
  const n = 2 ** OMT_Z, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y14 + 0.5) / n))) * 180 / Math.PI;
  const lng = (x14 + 0.5) / n * 360 - 180;
  const mPerU = 40075016.686 * Math.cos(lat * Math.PI / 180) / n / BIG;
  const korea = lat > 33 && lat < 39 && lng > 124 && lng < 131;
  const sc = l => BIG / (l?.extent || 4096);
  const eachIn = (LL, name, fn) => { const l = LL[name]; if (l) { const k = sc(l); for (const f of l.features) fn(f, g => g.map(([x, y]) => [x * k, y * k])); } };
  const each = (name, fn) => eachIn(L, name, fn);

  // roads (and the main ones, which buildings ask about)
  const mains = [];
  each("transportation", (f, S) => {
    if (f.type !== 2 || f.props.brunnel === "tunnel") return;
    const c = f.props.class;
    let cls = ROAD[c];
    if (c === "path") cls = PATH[f.props.subclass] ?? "path";
    if (c === "minor") cls = MINOR_SUB[f.props.subclass] ?? "residential";
    if (!cls) return; // rail, transit, ferry, aerialway...
    for (const line of f.geom) {
      const pts = S(line);
      if (MAIN.has(cls)) mains.push(pts);
      for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) {
        for (const run of clipLine(pts, i * EXT, j * EXT, (i + 1) * EXT, (j + 1) * EXT)) chunk(i, j).r.push({ c: cls, p: flat(run, i * EXT, j * EXT) });
      }
    }
  });
  const nearMain = (ring, d) => {
    for (const pts of mains) {
      for (let s = 0; s + 1 < pts.length; s++) {
        const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
        for (let v = 0; v < ring.length; v += Math.max(1, ring.length >> 3)) {
          if (segDist(ring[v][0], ring[v][1], ax, ay, bx, by) < d) return true;
        }
      }
    }
    return false;
  };
  // street names: one label at the middle of each named main road piece
  each("transportation_name", (f, S) => {
    if (f.type !== 2 || !f.props.name || !MAIN.has(f.props.class)) return;
    for (const line of f.geom) {
      const pts = S(line), [x, y] = pts[pts.length >> 1];
      const i = Math.floor(x / EXT), j = Math.floor(y / EXT);
      if (i >= 0 && j >= 0 && i < SUB && j < SUB) chunk(i, j).l.push({ t: f.props.name, x: x - i * EXT, y: y - j * EXT });
    }
  });
  // major places
  each("poi", (f, S) => {
    if (f.type !== 1 || !f.props.name || (f.props.rank ?? 99) > 1) return;
    for (const [x, y] of S(f.geom)) {
      const i = Math.floor(x / EXT), j = Math.floor(y / EXT);
      if (i >= 0 && j >= 0 && i < SUB && j < SUB) chunk(i, j).l.push({ t: f.props.name, x: x - i * EXT, y: y - j * EXT, poi: 1 });
    }
  });

  // buildings: each one to the chunk holding its centroid
  const stats = { buildings: 0, measured: 0 };
  // one footprint: hm, the height the data has (m, else 0); fl its floors;
  // kind its type ("" unknown); roof its shape ("" unknown)
  const building = (f, S, { hm = 0, fl: fl0 = 0, kind: k0 = "", roof: r0 = "", fc = null }) => {
    // the largest outer ring (holes and building parts' extra rings dropped)
    let ring = null, best = 0;
    for (const r of f.geom) { const a = ringArea(r); if (a > best) { best = a; ring = r; } }
    if (!ring) return;
    let pts = S(ring.slice(0, -1));
    pts = clipRing(pts, 0, 0, BIG, BIG);
    if (pts.length < 3) return;
    const area = Math.abs(ringArea(pts)) * mPerU * mPerU;
    if (area < 12) return;
    const [cx, cy] = centroid(pts);
    const i = Math.min(SUB - 1, Math.max(0, Math.floor(cx / EXT))), j = Math.min(SUB - 1, Math.max(0, Math.floor(cy / EXT)));
    const seed = hash(Math.round(x14 * BIG + cx) * 73856093 ^ Math.round(y14 * BIG + cy) * 19349663);
    const box = obb(pts);
    const elong = box.L / Math.max(box.S, 1e-6), fill = Math.abs(ringArea(pts)) / Math.max(box.A, 1e-6);
    const fronts = nearMain(pts, 22 / mPerU);
    const kind = k0 || guessKind(area, elong, fronts, korea);
    let h, fl, m = 0;
    if (hm > 2) { h = hm; fl = fl0 || Math.max(1, Math.round(hm / LEVEL_M)); m = 1; }
    else if (fl0 > 0) { fl = fl0; h = fl * LEVEL_M + 1; m = 1; }
    else {
      fl = guessFloors(kind, area, seed);
      h = fl * LEVEL_M + (kind !== "s" ? 1 : 0.4);
    }
    if (m) stats.measured++;
    const b = { p: flat(pts, i * EXT, j * EXT), h: Math.round(Math.max(2.6, Math.min(h, 600)) * 10) / 10, f: fl, k: kind, r: r0 || roofFor(kind, area, fill, korea, seed) };
    if (m) b.m = 1; else if (kind !== "s") b._g = 1;
    if (fc) b.fc = fc;
    chunk(i, j).b.push(b);
    stats.buildings++;
  };
  if (OV) {
    // Overture's buildings (OpenStreetMap + the machine-learned footprints)
    eachIn(OV, "building", (f, S) => {
      const q = f.props;
      if (f.type !== 3 || q.is_underground === true || q.is_underground === "true" || (+q.min_height || 0) > 0) return;
      let area = 0; for (const r of f.geom) area = Math.max(area, ringArea(r));
      const kind = classKind(q.class, q.subtype, area * (BIG / (OV.building.extent || 4096)) ** 2 * mPerU * mPerU);
      if (kind === null) return;
      building(f, S, { hm: +q.height || 0, fl: Math.round(+q.num_floors || 0), kind, roof: ROOF[(q.roof_shape || "").toLowerCase()] ?? (q.roof_shape ? "f" : ""), fc: q.facade_color || null });
    });
  } else {
    each("building", (f, S) => {
      if (f.type !== 3 || f.props.hide_3d || (f.props.render_min_height ?? 0) > 0) return;
      // OpenMapTiles fills a missing height with 5 m: 5 or less counts as unknown
      const rh = +f.props.render_height || 0;
      building(f, S, { hm: rh > 5 ? rh : 0, fc: f.props.colour || null });
    });
  }

  // water, parks, woods, grass
  const area = (k, f, S) => {
    if (f.type !== 3) return;
    for (const r of f.geom) {
      if (ringArea(r) <= 0) continue; // holes
      const pts = S(r.slice(0, -1));
      for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) {
        const c = clipRing(pts, i * EXT, j * EXT, (i + 1) * EXT, (j + 1) * EXT);
        if (c.length >= 3) chunk(i, j).a.push({ k, p: flat(c, i * EXT, j * EXT) });
      }
    }
  };
  each("water", (f, S) => { if (f.props.class !== "swimming_pool") area(f.props.class === "ocean" ? "ocean" : "water", f, S); });
  each("park", (f, S) => area(/nature|protected|forest/.test(f.props.class ?? "") ? "forest" : "park", f, S));
  each("landcover", (f, S) => { const k = LANDCOVER[f.props.class] ?? LANDCOVER[f.props.subclass]; if (k) area(k, f, S); });
  each("landuse", (f, S) => { const k = LANDUSE[f.props.class]; if (k) area(k, f, S); });

  for (const c of out.values()) settleGuesses(c.b, mPerU * BIG / (SUB * EXT));   // (chunk pixels: SUB×EXT across the tile's BIG units)
  out.stats = stats;
  return out;
}
