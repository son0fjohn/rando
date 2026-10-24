// Re-fit an item to the slimmer base (slim4.mjs) and give it its fit.
//  1. follow: how much the item follows the body in (0 = stays its size,
//     so a loose top gets looser; 1 = tight things: leggings, a baby tee,
//     socks, a chain on the chest). The body's move is interpolated from
//     the nearest base vertices.
//  2. relaxed / oversized (tops and bottoms), around the bones the item is
//     skinned to, blended by its own skin weights:
//       box     the body of a top, wider round the spine (and a touch squarer)
//       sleeve  [at the shoulder, at the cuff]: wide, puffy sleeves; the
//               shoulder end wider too, so the seam drops
//       hem     a top's hem lowered by this much (base units)
//       slen    sleeves lengthened by this much
//       leg     [at the hip, at the hem]: wide legs
//       stack   trousers lengthened to sit on the shoes, bunching above
//     Never toward the body: the side of a sleeve facing the torso and the
//     inside of a trouser leg widen far less, so they don't meet.
//  3. clean cut edges (everything but hair): where the item was cut out of
//     its figure, the open edge zigzags and its last triangles carry colours
//     from beside it (skin, hair, background). The edge loops are smoothed,
//     and each edge vertex gets the colour of the cloth just inside it
//     (_EDGECOL: rgb + weight, avatar4.js blends it in).
// Skin weights are kept (they were copied from the base where the item was).
//   node refit4.mjs <old base.glb> <new base.glb> <item.glb> <out.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
const [oldB, newB, inp, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const name = inp.split("/").pop().replace(/\.glb$/, "");

// per item: follow, and the relaxed fit
// (a top's numbers get a little extra on top: the thin body should feel lost in it)
const T = (box, sleeve, hem = 0.03, slen = 0.015) => ({ follow: 0, box: box + 0.03, sleeve: [sleeve[0] + 0.05, sleeve[1] + 0.08], hem, slen });
const B = (leg, stack = true) => ({ follow: 0, leg, stack });
const FIT = {
  top_sweat_babyblue: T(1.08, [1.16, 1.45]), top_puffer_black: T(1.03, [1.05, 1.15], 0.02, 0.01), top_track_purple: T(1.08, [1.15, 1.4]),
  top_bomber_olive: T(1.07, [1.12, 1.35], 0, 0.012), top_cardigan_cream: T(1.1, [1.16, 1.45], 0.035), top_varsity: T(1.07, [1.12, 1.35], 0.02),
  top_tee_oversized: T(1.1, [1.22, 1.4], 0.03, 0.012), top_zip_hoodie: T(1.08, [1.15, 1.45]), top_denim_jacket: T(1.07, [1.12, 1.35], 0.02),
  top_crop_flannel: T(1.06, [1.15, 1.4], 0.03), top_baby_tee: { follow: 1 },
  bottom_cargo_chain: B([1.08, 1.35]), bottom_snowpants: B([1.03, 1.12]), bottom_track_purple: B([1.08, 1.35]), bottom_jeans_wide: B([1.06, 1.3]),
  // (joggers and the plaid pants end in a gathered cuff at the ankle: no stacking)
  bottom_plaid_wide: B([1.06, 1.22], false), bottom_sweatpants: B([1.08, 1.2], false), bottom_cargo_shorts: B([1.1, 1.2], false),
  bottom_skirt_pleated: { follow: 0.5 }, bottom_skirt_long: { follow: 0.3 }, bottom_mini_leggings: { follow: 1 },
};
// shoes follow the slimmer ankles; neck things stay where they were (they sit over clothes,
// and avatar4.js lifts them over the top)
const fit = FIT[name] ?? (/^shoes_/.test(name) ? { follow: 1 } : { follow: 0 });

const read = async f => {
  const doc = await io.read(f), root = doc.getRoot(), prim = root.listMeshes()[0].listPrimitives()[0];
  return { doc, root, prim, P: prim.getAttribute("POSITION"), skin: root.listSkins()[0] };
};
const ob = await read(oldB), nb = await read(newB), it = await read(inp);
const bn = ob.P.getCount(), OP = ob.P.getArray(), NP = nb.P.getArray();
// base joints: positions and bone segments (rest, model space)
const joints = nb.skin.listJoints(), names = joints.map(j => j.getName());
const jp = joints.map(j => { const m = j.getWorldMatrix(); return [m[12], m[13], m[14]]; });
const child = joints.map(j => joints.indexOf(j.listChildren().find(c => joints.includes(c))));
const seg = k => child[k] >= 0 ? [jp[k], jp[child[k]]] : null;
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(...a), nrm = a => { const l = len(a) || 1; return a.map(v => v / l); };
const closestT = ([a, b], p) => { const ab = sub(b, a); return Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); };
const at = ([a, b], t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const J = n => names.indexOf(n);

// item joints -> base joint index (same names)
const ij = it.skin.listJoints().map(j => J(j.getName()));
const IP = it.prim.getAttribute("POSITION"), IJ = it.prim.getAttribute("JOINTS_0"), IW = it.prim.getAttribute("WEIGHTS_0");
const n = IP.getCount(), pos = [], wts = [];
for (let i = 0; i < n; i++) {
  pos.push(IP.getElement(i, [0, 0, 0]));
  const j = IJ.getElement(i, [0, 0, 0, 0]), w = IW.getElement(i, [0, 0, 0, 0]);
  wts.push(j.map((k, q) => [ij[k], w[q]]).filter(([, w]) => w > 0));
}
// 1. follow the body in
if (fit.follow) {
  // a coarse grid over the old base's vertices for nearest lookups
  const G = 0.03, grid = new Map(), key = (x, y, z) => `${Math.floor(x / G)},${Math.floor(y / G)},${Math.floor(z / G)}`;
  for (let i = 0; i < bn; i++) { const k = key(OP[i * 3], OP[i * 3 + 1], OP[i * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
  for (const p of pos) {
    const near = [];
    for (let r = 1; near.length < 4 && r < 6; r++) {
      near.length = 0;
      const [cx, cy, cz] = [Math.floor(p[0] / G), Math.floor(p[1] / G), Math.floor(p[2] / G)];
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++)
        for (const i of grid.get(`${x},${y},${z}`) ?? []) near.push([Math.hypot(OP[i * 3] - p[0], OP[i * 3 + 1] - p[1], OP[i * 3 + 2] - p[2]), i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    let sw = 0; const d = [0, 0, 0];
    for (const [dist, i] of near.slice(0, 4)) { const w = 1 / (dist + 1e-4); sw += w; for (let a = 0; a < 3; a++) d[a] += (NP[i * 3 + a] - OP[i * 3 + a]) * w; }
    if (sw) for (let a = 0; a < 3; a++) p[a] += d[a] / sw * fit.follow;
  }
}
// tight things (follow 1) also stand a hair off the body, along their normals
if (fit.follow === 1 && it.prim.getAttribute("NORMAL")) {
  const N = it.prim.getAttribute("NORMAL");
  pos.forEach((p, i) => { const nv = N.getElement(i, [0, 0, 0]); for (let a = 0; a < 3; a++) p[a] += nv[a] * 0.006; });
}
// 2. the relaxed fit
const torso = /^(hips|spine|chest)$/, arm = /^(shoulder|upperarm|forearm|hand)_/, leg = /^(thigh|shin|foot)_/;
const side = nm => nm.endsWith("_L") ? 1 : -1;   // the character's left is +x
const armChain = s => [J(`upperarm_${s}`), J(`forearm_${s}`), J(`hand_${s}`)];
const legChain = s => [J(`thigh_${s}`), J(`shin_${s}`), J(`foot_${s}`)];
// t along a two-bone chain (0 at the root joint, 1 at the end)
const chainT = (chain, p) => {
  const [a, b, c] = chain.map(k => jp[k]), L1 = len(sub(b, a)), L2 = len(sub(c, b));
  const t1 = closestT([a, b], p), t2 = closestT([b, c], p);
  const d1 = len(sub(p, at([a, b], t1))), d2 = len(sub(p, at([b, c], t2)));
  return d1 <= d2 ? { t: t1 * L1 / (L1 + L2), c: at([a, b], t1), dir: nrm(sub(b, a)) } : { t: (L1 + t2 * L2) / (L1 + L2), c: at([b, c], t2), dir: nrm(sub(c, b)) };
};
const weightOf = (w, re) => w.reduce((s, [k, x]) => s + (k >= 0 && re.test(names[k]) ? x : 0), 0);
let yHemTop = 9, yHemLeg = 9;
{
  const ty = [], ly = [];
  pos.forEach((p, i) => { if (weightOf(wts[i], torso) > 0.5) ty.push(p[1]); if (weightOf(wts[i], leg) > 0.5) ly.push(p[1]); });
  ty.sort((a, b) => a - b); ly.sort((a, b) => a - b);
  if (ty.length) yHemTop = ty[Math.floor(ty.length * 0.02)];
  if (ly.length) yHemLeg = ly[Math.floor(ly.length * 0.02)];
}
const STACK_Y = 0.075;
const out3 = pos.map((p, i) => {
  if (!fit.box && !fit.leg) return p;
  const d = [0, 0, 0];
  for (const [k, w] of wts[i]) {
    if (k < 0) continue;
    const nm = names[k];
    if (fit.box && torso.test(nm)) {
      // round the spine, horizontally; a little more at the corners (boxy)
      const s = seg(k) ?? [jp[k], jp[k]], c = at(s, closestT(s, p)), h = [p[0] - c[0], 0, p[2] - c[2]];
      const az = Math.atan2(h[0], h[2]), box = (fit.box - 1) * (1 + 0.35 * Math.abs(Math.sin(2 * az)));
      for (let a = 0; a < 3; a++) d[a] += h[a] * box * w;
    } else if (fit.sleeve && arm.test(nm)) {
      const sd = side(nm), { t, c, dir } = chainT(armChain(sd > 0 ? "L" : "R"), p);
      let r = sub(p, c); r = sub(r, dir.map(v => v * dot(r, dir)));
      // toward the body: in from the arm, perpendicular to it
      let inb = [-sd, 0, 0]; inb = nrm(sub(inb, dir.map(v => v * dot(inb, dir))));
      const facing = Math.max(0, dot(nrm(r), inb));
      const s = (fit.sleeve[0] + (fit.sleeve[1] - fit.sleeve[0]) * Math.min(1, t * 1.6) - 1) * (1 - 0.8 * facing);
      for (let a = 0; a < 3; a++) d[a] += (r[a] * s + dir[a] * fit.slen * smooth(0.45, 1, t)) * w;
    } else if (fit.leg && leg.test(nm)) {
      const sd = side(nm), { t, c, dir } = chainT(legChain(sd > 0 ? "L" : "R"), p);
      let r = sub(p, c); r = sub(r, dir.map(v => v * dot(r, dir)));
      const inside = Math.max(0, dot(nrm(r), [-sd, 0, 0]));
      const s = (fit.leg[0] + (fit.leg[1] - fit.leg[0]) * smooth(0, 0.85, t) - 1) * (1 - 0.75 * inside);
      for (let a = 0; a < 3; a++) d[a] += r[a] * s * w;
    }
  }
  const q = p.map((v, a) => v + d[a]);
  // a longer hem
  if (fit.hem && weightOf(wts[i], torso) > 0.3) q[1] -= fit.hem * smooth(yHemTop + 0.07, yHemTop, p[1]);
  // trousers down onto the shoes, bunching a little above the hem
  if (fit.stack && weightOf(wts[i], leg) > 0.5 && yHemLeg > STACK_Y) {
    const k = smooth(yHemLeg + 0.16, yHemLeg, p[1]), E = yHemLeg - STACK_Y;
    q[1] -= E * k;
    const sd = q[0] > 0 ? 1 : -1, { c } = chainT(legChain(sd > 0 ? "L" : "R"), q);
    // (and flaring out at the hem, so it sits over the shoe rather than through it)
    const bunch = 1 + k * (0.06 + 0.035 * Math.sin(p[1] * 260)) + k * k * 0.12;
    q[0] = c[0] + (q[0] - c[0]) * bunch; q[2] = c[2] + (q[2] - c[2]) * bunch;
  }
  return q;
});
// 3. clean cut edges
if (!/^hair_/.test(name)) {
  const IDX = it.prim.getIndices().getArray(), key = q => q.map(v => Math.round(v * 2e4)).join(",");
  const kid = new Map(), vk = out3.map(q => { const k = key(q); if (!kid.has(k)) kid.set(k, kid.size); return kid.get(k); });
  const E = new Map(), nb = Array.from({ length: kid.size }, () => new Set());
  for (let t = 0; t < IDX.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = vk[IDX[t + e]], b = vk[IDX[t + (e + 1) % 3]], k = a < b ? a + "|" + b : b + "|" + a;
    E.set(k, (E.get(k) ?? 0) + 1); nb[a].add(b); nb[b].add(a);
  }
  const bnb = Array.from({ length: kid.size }, () => []);
  for (const [k, c] of E) if (c === 1) { const [a, b] = k.split("|").map(Number); bnb[a].push(b); bnb[b].push(a); }
  const onEdge = bnb.map(l => l.length > 0);
  // the position of each key (shared by the vertices split at UV seams)
  const kp = []; vk.forEach((k, i) => { kp[k] ??= out3[i].slice(); });
  // smooth the edge loops (only along the loop, so the hem stays where it was)
  // (Taubin: a shrink step then an inflate step, so a collar doesn't tighten)
  for (let it2 = 0; it2 < 16; it2++) {
    const f = it2 % 2 ? -0.53 : 0.5, nx = kp.map(q => q.slice());
    for (let k = 0; k < kp.length; k++) if (bnb[k].length === 2) {
      const [a, b] = bnb[k];
      for (let c = 0; c < 3; c++) nx[k][c] = kp[k][c] + f * ((kp[a][c] + kp[b][c]) / 2 - kp[k][c]);
    }
    for (let k = 0; k < kp.length; k++) kp[k] = nx[k];
  }
  vk.forEach((k, i) => { if (onEdge[k]) out3[i] = kp[k].slice(); });
  // the cloth's colour a few rings in from the edge
  const tex = it.prim.getMaterial()?.getBaseColorTexture();
  const UV = it.prim.getAttribute("TEXCOORD_0");
  if (tex && UV) {
    const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const texel = i => { const [u, v] = UV.getElement(i, [0, 0]); const x = Math.min(info.width - 1, Math.max(0, Math.round(u * (info.width - 1)))), y = Math.min(info.height - 1, Math.max(0, Math.round(v * (info.height - 1)))), o = (y * info.width + x) * 4; return [data[o], data[o + 1], data[o + 2]]; };
    const verts = Array.from({ length: kid.size }, () => []); vk.forEach((k, i) => verts[k].push(i));
    // ring distance from the edge
    const ring = new Array(kid.size).fill(99), q = [];
    onEdge.forEach((e, k) => { if (e) { ring[k] = 0; q.push(k); } });
    for (let h = 0; h < q.length; h++) for (const m of nb[q[h]]) if (ring[m] > ring[q[h]] + 1) { ring[m] = ring[q[h]] + 1; q.push(m); }
    const col = new Float32Array(n * 4);
    for (let k = 0; k < kid.size; k++) {
      if (ring[k] > 1) continue;
      // walk inward to rings 2..4 and average what's there
      const seen = new Set([k]), front = [k], pick = [];
      for (let h = 0; h < front.length && pick.length < 24; h++) for (const m of nb[front[h]]) if (!seen.has(m)) {
        seen.add(m); if (ring[m] <= 5) front.push(m); if (ring[m] >= 2 && ring[m] <= 4) pick.push(m);
      }
      if (!pick.length) continue;
      const c = [0, 0, 0]; let cn = 0;
      for (const m of pick) for (const i of verts[m]) { const t = texel(i); c[0] += t[0]; c[1] += t[1]; c[2] += t[2]; cn++; }
      for (const i of verts[k]) col.set([c[0] / cn / 255, c[1] / cn / 255, c[2] / cn / 255, ring[k] === 0 ? 1 : 0.6], i * 4);
    }
    it.prim.setAttribute("_EDGECOL", it.doc.createAccessor().setType("VEC4").setArray(col).setBuffer(it.root.listBuffers()[0]));
  }
  console.log(`  edges: ${onEdge.filter(Boolean).length} edge points smoothed + recoloured`);
}
let mv = 0;
const arr = new Float32Array(n * 3);
out3.forEach((q, i) => { mv = Math.max(mv, Math.hypot(q[0] - IP.getElement(i, [0, 0, 0])[0], q[1] - IP.getElement(i, [0, 0, 0])[1], q[2] - IP.getElement(i, [0, 0, 0])[2])); arr.set(q, i * 3); });
IP.setArray(arr);
await io.write(out, it.doc);
console.log(`${name}: follow ${fit.follow ?? 0}${fit.box ? " relaxed top" : ""}${fit.leg ? " relaxed legs" : ""}, max move ${mv.toFixed(4)}, hem ${yHemTop < 9 ? yHemTop.toFixed(3) : "-"} / ${yHemLeg < 9 ? yHemLeg.toFixed(3) : "-"}`);
