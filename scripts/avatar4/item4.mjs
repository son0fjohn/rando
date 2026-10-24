// one cosmetic item for the avatar4 base, from a Tripo mesh of the item worn
// on the base (front view, same A-pose):
//  1. orient (front +z), scale by the A-pose arm span, anchor feet (or the
//     head top, for shoes), then nudge into place against the base (ICP,
//     translation only) on a band of the body the item doesn't touch
//  2. keep the item's triangles: in its zone, by texture colour (not skin,
//     not the underlayer), largest pieces only
//  3. weld, simplify to the target, texture shrunk to 512 webp
//  4. skin: weights from the nearest base vertices (hair/head: rigid head)
//  5. write a skinned glb with the base's joints, in the base's model space
// node item4.mjs <tripo.glb> <base.glb> <cat> <out.glb> [target tris]
import { NodeIO, Document } from "@gltf-transform/core";
import { weld, simplify, dedup, prune, compactPrimitive } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
const [inp, basePath, cat, out, targetArg] = process.argv.slice(2);
const target = +(targetArg ?? (cat === "shoes" ? 900 : 1500));
const io = new NodeIO();
await MeshoptSimplifier.ready;

// ---- the base (rest pose, height 1)
const bdoc = await io.read(basePath);
const bprim = bdoc.getRoot().listMeshes()[0].listPrimitives()[0];
const BP = bprim.getAttribute("POSITION").getArray(), BJ = bprim.getAttribute("JOINTS_0").getArray(), BW = bprim.getAttribute("WEIGHTS_0").getArray();
const bskin = bdoc.getRoot().listSkins()[0], bjoints = bskin.listJoints();
const jointNames = bjoints.map(j => j.getName());
const bN = BP.length / 3;
// spatial hash of base verts
const CELL = 0.02, hash = new Map(), hk = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
for (let i = 0; i < bN; i++) { const k = hk(BP[i * 3], BP[i * 3 + 1], BP[i * 3 + 2]); (hash.get(k) ?? hash.set(k, []).get(k)).push(i); }
function kNearest(x, y, z, K = 1, maxR = 8) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL), best = [];
  for (let r = 0; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
      for (const i of hash.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const d = (BP[i * 3] - x) ** 2 + (BP[i * 3 + 1] - y) ** 2 + (BP[i * 3 + 2] - z) ** 2;
        best.push([d, i]);
      }
    }
    if (best.length >= K && r >= 1) break;
  }
  return best.sort((a, b) => a[0] - b[0]).slice(0, K);
}
let bspan = 0; for (let i = 0; i < bN; i++) bspan = Math.max(bspan, Math.abs(BP[i * 3]));

// ---- the item mesh: orient, scale, anchor
const doc = await io.read(inp);
const root = doc.getRoot();
await doc.transform(weld({ tolerance: 0.0001 }));
{ // pre-thin to ~200k so the cut runs fast
  const p0 = root.listMeshes()[0].listPrimitives()[0], t0 = p0.getIndices().getCount() / 3;
  if (t0 > 220000) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 200000 / t0, error: 0.002, lockBorder: false }), prune({ keepAttributes: true }));
}
const prim = root.listMeshes()[0].listPrimitives()[0];
const POS = prim.getAttribute("POSITION"), NOR = prim.getAttribute("NORMAL");
const n0 = POS.getCount(), v = [0, 0, 0];
const P = new Float32Array(n0 * 3);
const BACK = !!process.env.BACK;   // a back-view picture: the mesh faces away, turn it round
for (let i = 0; i < n0; i++) { POS.getElement(i, v); P.set(BACK ? [v[2], v[1], -v[0]] : [-v[2], v[1], v[0]], i * 3); }
let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
for (let i = 0; i < n0; i++) { minY = Math.min(minY, P[i * 3 + 1]); maxY = Math.max(maxY, P[i * 3 + 1]); minX = Math.min(minX, P[i * 3]); maxX = Math.max(maxX, P[i * 3]); }
const s = (2 * bspan) / (maxX - minX), midX = (minX + maxX) / 2;
const bTop = Math.max(...Array.from({ length: bN }, (_, i) => BP[i * 3 + 1]));
const ty = -minY * s;
for (let i = 0; i < n0; i++) { P[i * 3] = (P[i * 3] - midX) * s; P[i * 3 + 1] = P[i * 3 + 1] * s + ty; P[i * 3 + 2] *= s; }
for (let i = 0; i < n0; i++) POS.setElement(i, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
for (let i = 0; i < n0; i++) { NOR.getElement(i, v); NOR.setElement(i, BACK ? [v[2], v[1], -v[0]] : [-v[2], v[1], v[0]]); }

// ---- texture colours at each triangle
const tex = root.listTextures()[0];
const img = sharp(Buffer.from(tex.getImage()));
const { data: TX, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
const UV = prim.getAttribute("TEXCOORD_0"), IDX = prim.getIndices().getArray();
const colAt = (u, w) => { const x = Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width))), y = Math.min(info.height - 1, Math.max(0, Math.floor(w * info.height))); const o = (y * info.width + x) * 3; return [TX[o], TX[o + 1], TX[o + 2]]; };
const uv = new Float32Array(n0 * 2); for (let i = 0; i < n0; i++) { UV.getElement(i, v); uv[i * 2] = v[0]; uv[i * 2 + 1] = v[1]; }
const T = IDX.length / 3;
const triCol = [], triC = [];
for (let t = 0; t < T; t++) {
  const c = [0, 0, 0], p = [0, 0, 0];
  for (const f of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3]]) {
    let uu = 0, vv = 0; for (let k = 0; k < 3; k++) { uu += f[k] * uv[IDX[t * 3 + k] * 2]; vv += f[k] * uv[IDX[t * 3 + k] * 2 + 1]; }
    const q = colAt(uu, vv); for (let a = 0; a < 3; a++) c[a] += q[a] / 4;
  }
  for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) p[a] += P[IDX[t * 3 + k] * 3 + a] / 3;
  triCol.push(c); triC.push(p);
}
// line the figure up with the base on what every picture shows bare: skin
// (face, hands, legs), translation only
{
  const isSkin0 = c => { const r = Math.max(c[0], 1), gr = c[1] / r, br = c[2] / r;
    return c[0] > 60 && c[0] > c[1] && c[1] > c[2] && gr > 0.5 && gr < 0.86 && br > 0.3 && br < 0.72; };
  const sk = []; for (let t = 0; t < T; t += 2) if (isSkin0(triCol[t]) && triC[t][1] > 0.12 && triC[t][1] < 0.95) sk.push(t);
  const D = [0, 0, 0];
  for (let it = 0; it < 14; it++) {
    const d = [0, 0, 0]; let c = 0;
    for (const t of sk) {
      const p = [triC[t][0] + D[0], triC[t][1] + D[1], triC[t][2] + D[2]];
      const [nb] = kNearest(p[0], p[1], p[2], 1, 3); if (!nb || nb[0] > 0.0016) continue;
      for (let a = 0; a < 3; a++) d[a] += BP[nb[1] * 3 + a] - p[a]; c++;
    }
    if (!c) break;
    for (let a = 0; a < 3; a++) D[a] += d[a] / c;
    if (Math.hypot(...d) / c < 1e-5) break;
  }
  console.log("icp skin tris", sk.length, "shift", D.map(x => x.toFixed(4)).join(","));
  for (let i = 0; i < n0; i++) for (let a = 0; a < 3; a++) P[i * 3 + a] += D[a];
  for (const p of triC) for (let a = 0; a < 3; a++) p[a] += D[a];
  for (let i = 0; i < n0; i++) POS.setElement(i, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
}
// skin: warm, saturated (r well above b); underlayer: neutral gray
// skin: r > g > b with g/r and b/r in a narrow band (red, mustard, gold and
// purple fall outside it; tan can still pass, so hats keep their crown whole)
const isSkin = c => { const r = Math.max(c[0], 1), gr = c[1] / r, br = c[2] / r;
  return c[0] > 60 && c[0] > c[1] && c[1] > c[2] && gr > 0.5 && gr < 0.86 && br > 0.3 && br < 0.72; };
const isGray = c => Math.max(...c) - Math.min(...c) < 16 && c[0] > 60 && c[0] < 185;
// how far a triangle sits off the bare base (the underlayer hugs it; clothes stand off)
const off = p => { const [nb] = kNearest(p[0], p[1], p[2], 1, 4); return nb ? Math.sqrt(nb[0]) : 1; };
// per picture overrides: YMIN / YMAX (rest heights), XMAX (|x|), FACE=upper|lower
const E = process.env, num = (k, d) => E[k] != null ? +E[k] : d;
const FRONT_FACE = p => p[2] > 0.0 && p[1] < 0.885 && Math.abs(p[0]) < 0.095;   // the face's front: eyes, nose, cheeks
const zone0 = {
  hair: p => p[1] > num("YMIN", 0.74),
  top: p => p[1] > num("YMIN", 0.41) && p[1] < num("YMAX", 0.8),
  shoes: p => p[1] < num("YMAX", 0.14),
  head: p => p[1] > num("YMIN", 0.8) && !FRONT_FACE(p),
  face: p => E.FACE === "lower" ? (p[1] > num("YMIN", 0.75) && p[1] < 0.86 && p[2] > num("ZMIN", -0.02) && Math.abs(p[0]) < 0.12)
                                : (p[1] > 0.83 && p[1] < num("YMAX", 0.91) && p[2] > 0.0 && Math.abs(p[0]) < num("XMAX", 0.13)),
  bottom: p => p[1] > num("YMIN", 0.1) && p[1] < num("YMAX", 0.47) && Math.abs(p[0]) < num("XMAX", 0.17),
  neck: p => p[1] > num("YMIN", 0.42) && p[1] < num("YMAX", 0.8) && Math.abs(p[0]) < num("XMAX", 0.16) && (E.SIDE === "back" ? p[2] < 0.0 : E.SIDE === "front" ? p[2] > -0.01 : true),
}[cat];
const zone = p => zone0(p);
const pick = {
  // hair: stands off the bald head, or is clearly less saturated than skin; never the painted eyes
  hair: (c, p) => !(p[1] < 0.8 && E.HDARK && c[0] + c[1] + c[2] > 270) && !(p[1] < 0.78 && (isGray(c) || Math.abs(p[0]) > num("HXMAX", 0.16))) && !(p[1] < 0.885 && p[2] > 0.035 && Math.abs(p[0]) < 0.1) && (p[1] > 0.935 || off(p) > 0.009 || (c[0] - c[2]) / Math.max(c[0], 1) < 0.3),
  // NOHAIR: long dark hair hangs over this top's back and shoulders; leave it out
  top: (c, p) => !isSkin(c) && (!isGray(c) || (off(p) > 0.012 && p[1] > 0.5)) && !(E.NOHAIR && c[0] + c[1] + c[2] < 110 && p[1] > 0.58 && (p[2] < 0.01 || Math.abs(p[0]) > 0.07)),
  shoes: c => !isSkin(c) && !(E.NOTBLUE && c[2] > c[0] + 12) && !(E.NOTPURPLE && c[2] > c[1] + 25 && c[0] > c[1] + 15),
  head: (c, p) => (E.TOPALL && p[1] > 0.93) || !isSkin(c) || off(p) > 0.012,
  face: (c, p) => !isSkin(c) && (off(p) > 0.004 || E.FACE === "lower"),
  bottom: (c, p) => !isSkin(c) && (!isGray(c) || off(p) > 0.01),
  // CHAIN: a thin thing on the tee (no skin in its zone): anything not the tee's gray
  neck: (c, p) => E.CHAIN ? !isGray(c) && c[0] + c[1] + c[2] > 150 && Math.max(...c) - Math.min(...c) > 30 : !isSkin(c) && !(isGray(c) && off(p) < 0.012),
}[cat];
if (process.env.DBG) { const box = t => Math.abs(triC[t][0]) < 0.05 && triC[t][1] > 0.6 && triC[t][1] < 0.7 && triC[t][2] > 0.02;
  const r = {}; for (let t = 0; t < T; t++) if (box(t)) { const c = triCol[t], k = `skin${+isSkin(c)} gray${+isGray(c)} off${off(triC[t]) > 0.012 ? 1 : 0}`; r[k] = (r[k] ?? 0) + 1; if (Math.random() < 0.01) console.log(c.map(Math.round), triC[t].map(x => x.toFixed(3))); }
  console.log(r); }
if (process.env.DBG2) { let my = 0; for (let t = 0; t < T; t++) my = Math.max(my, triC[t][1]); console.log("max centroid y", my.toFixed(3));
  const h = {}; for (let t = 0; t < T; t++) if (triC[t][1] > 0.93) { const c = triCol[t].map(x => Math.round(x / 20) * 20).join(","); h[c] = (h[c] ?? 0) + 1; }
  console.log(Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 12)); }
let keep = new Uint8Array(T);
for (let t = 0; t < T; t++) keep[t] = zone(triC[t]) && pick(triCol[t], triC[t]) ? 1 : 0;
// clean up: majority filter over neighbours (twice), then the biggest pieces
// neighbours by position (UV seams split vertices; the pieces must not split there)
const posKey = new Map(), vkey = new Int32Array(n0);
for (let i = 0; i < n0; i++) { const k = `${Math.round(P[i * 3] * 5e4)},${Math.round(P[i * 3 + 1] * 5e4)},${Math.round(P[i * 3 + 2] * 5e4)}`; if (!posKey.has(k)) posKey.set(k, posKey.size); vkey[i] = posKey.get(k); }
const byKey = Array.from({ length: posKey.size }, () => []);
for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) byKey[vkey[IDX[t * 3 + k]]].push(t);
const vt = { length: n0 }; for (let i = 0; i < n0; i++) vt[i] = byKey[vkey[i]];
for (let pass = 0; pass < (cat === "hair" ? 4 : 2); pass++) {
  const nk = keep.slice();
  for (let t = 0; t < T; t++) {
    if (!zone(triC[t])) continue;
    let a = 0, b = 0; for (let k = 0; k < 3; k++) for (const u of vt[IDX[t * 3 + k]]) { if (u === t) continue; keep[u] ? a++ : b++; }
    nk[t] = a > b * 1.5 ? 1 : b > a * 1.5 ? 0 : keep[t];
  }
  keep = nk;
}
const comp = new Int32Array(T).fill(-1), sizes = [];
for (let t = 0; t < T; t++) {
  if (!keep[t] || comp[t] >= 0) continue;
  const id = sizes.length, st = [t]; comp[t] = id; let sz = 0;
  while (st.length) { const x = st.pop(); sz++; for (let k = 0; k < 3; k++) for (const u of vt[IDX[x * 3 + k]]) if (keep[u] && comp[u] < 0) { comp[u] = id; st.push(u); } }
  sizes.push(sz);
}
const biggest = Math.max(...sizes);
const minPiece = cat === "shoes" ? biggest * 0.3 : biggest * 0.08;
const kept = [];
for (let t = 0; t < T; t++) if (keep[t] && sizes[comp[t]] >= minPiece) kept.push(IDX[t * 3], IDX[t * 3 + 1], IDX[t * 3 + 2]);
console.log("tris", T, "kept", kept.length / 3, "pieces", sizes.filter(x => x >= minPiece).length, "of", sizes.length);
prim.getIndices().setArray(new Uint32Array(kept));
await doc.transform(prune({ keepAttributes: true }));
compactPrimitive(prim);
await doc.transform(weld({ tolerance: 0.0002 }), simplify({ simplifier: MeshoptSimplifier, ratio: target / (kept.length / 3), error: 0.03, lockBorder: false }), dedup(), prune({ keepAttributes: true }));
const p2 = root.listMeshes()[0].listPrimitives()[0];
compactPrimitive(p2);
const n = p2.getAttribute("POSITION").getCount(), P2 = p2.getAttribute("POSITION").getArray();

// smooth normals across UV seams (clay look, no facets)
{
  const I3 = p2.getIndices().getArray(), Nn = new Map(), key = i => `${Math.round(P2[i * 3] * 5e4)},${Math.round(P2[i * 3 + 1] * 5e4)},${Math.round(P2[i * 3 + 2] * 5e4)}`;
  for (let t = 0; t < I3.length; t += 3) {
    const [a, b, c] = [I3[t], I3[t + 1], I3[t + 2]];
    const u = [0, 1, 2].map(k => P2[b * 3 + k] - P2[a * 3 + k]), w = [0, 1, 2].map(k => P2[c * 3 + k] - P2[a * 3 + k]);
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const i of [a, b, c]) { const k = key(i), acc = Nn.get(k) ?? [0, 0, 0]; acc[0] += f[0]; acc[1] += f[1]; acc[2] += f[2]; Nn.set(k, acc); }
  }
  const NA = p2.getAttribute("NORMAL");
  for (let i = 0; i < n; i++) { const a = Nn.get(key(i)) ?? [0, 1, 0], l = Math.hypot(...a) || 1; NA.setElement(i, a.map(x => x / l)); }
}
// ---- skin weights
const headJ = jointNames.indexOf("head");
const J = new Uint8Array(n * 4), W = new Float32Array(n * 4);
for (let i = 0; i < n; i++) {
  if (cat === "hair" || cat === "head" || cat === "face") { J[i * 4] = headJ; W[i * 4] = 1; continue; }
  if (E.RIGID) { J[i * 4] = jointNames.indexOf(E.RIGID); W[i * 4] = 1; continue; }   // a stiff thing (a skateboard) rides one bone
  const nb = kNearest(P2[i * 3], P2[i * 3 + 1], P2[i * 3 + 2], 6, 12);
  const acc = new Map();
  for (const [d, b] of nb) { const w0 = 1 / (Math.sqrt(d) + 0.004); for (let k = 0; k < 4; k++) { const j = BJ[b * 4 + k], w = BW[b * 4 + k] * w0; if (w > 0) acc.set(j, (acc.get(j) ?? 0) + w); } }
  const top4 = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top4.reduce((s, [, w]) => s + w, 0) || 1;
  top4.forEach(([j, w], k) => { J[i * 4 + k] = j; W[i * 4 + k] = w / sum; });
  if (!top4.length) { J[i * 4] = 0; W[i * 4] = 1; }
}
const buf = root.listBuffers()[0];
p2.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(J).setBuffer(buf));
p2.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(W).setBuffer(buf));
// the base's skeleton, copied
const nodes = new Map();
const copyNode = src => { const nd = doc.createNode(src.getName()).setTranslation(src.getTranslation()); nodes.set(src, nd); for (const c of src.listChildren()) nd.addChild(copyNode(c)); return nd; };
const broot = bjoints[0];
const sc = root.listScenes()[0];
for (const nd of root.listNodes()) if (!nd.getMesh()) nd.dispose();
const meshNode = root.listNodes().find(x => x.getMesh());
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setName(cat);
if (!sc.listChildren().includes(meshNode)) sc.addChild(meshNode);
sc.addChild(copyNode(broot));
const skin = doc.createSkin(cat).setSkeleton(nodes.get(broot)).setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(bskin.getInverseBindMatrices().getArray().slice()).setBuffer(buf));
for (const j of bjoints) skin.addJoint(nodes.get(j));
meshNode.setSkin(skin);
// material: matte, its texture shrunk
const mat = p2.getMaterial(); mat.setRoughnessFactor(1).setMetallicFactor(0).setName(cat);
for (const t of root.listTextures()) if (t !== mat.getBaseColorTexture()) t.dispose();
const t0 = mat.getBaseColorTexture();
t0.setImage(await sharp(Buffer.from(t0.getImage())).resize(+(process.env.TEX ?? 512), +(process.env.TEX ?? 512)).webp({ quality: 90 }).toBuffer()).setMimeType("image/webp");
mat.setNormalTexture(null); mat.setMetallicRoughnessTexture(null); mat.setOcclusionTexture(null); mat.setEmissiveTexture(null);
doc.createExtension((await import("@gltf-transform/extensions")).EXTTextureWebP).setRequired(true);
await doc.transform(prune({ keepAttributes: true }));
await io.registerExtensions([(await import("@gltf-transform/extensions")).EXTTextureWebP]).write(out, doc);
// mean colour of the kept texture (for tint keys)
const UV2 = p2.getAttribute("TEXCOORD_0"), I2 = p2.getIndices().getArray(); const m = [0, 0, 0]; let mc = 0;
for (let t = 0; t < I2.length; t += 3) { let uu = 0, vv = 0; for (let k = 0; k < 3; k++) { UV2.getElement(I2[t + k], v); uu += v[0] / 3; vv += v[1] / 3; } const c = colAt(uu, vv); for (let a = 0; a < 3; a++) m[a] += c[a]; mc++; }
let yMin = 1e9, yMax = -1e9; for (let i = 0; i < n; i++) { yMin = Math.min(yMin, P2[i * 3 + 1]); yMax = Math.max(yMax, P2[i * 3 + 1]); }
console.log("wrote", out, "tris", I2.length / 3, "verts", n, "mean rgb", m.map(x => Math.round(x / mc)).join(","), "y", yMin.toFixed(3), yMax.toFixed(3));
