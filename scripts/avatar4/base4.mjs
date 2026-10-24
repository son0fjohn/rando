// the new player base, step 2: region-mask texture, smooth normals, a face UV
// set (TEXCOORD_1 + _FACEW) on the head's front, a humanoid skeleton with
// geodesic skin weights (seeded on each bone's own limb). Writes base.glb.
import { NodeIO } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";
import { readFile } from "node:fs/promises";
const [inp, png, out] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(inp);
const root = doc.getRoot(), buf = root.listBuffers()[0];
const mesh = root.listMeshes()[0], prim = mesh.listPrimitives()[0];
const tex = root.listTextures()[0]; tex.setImage(await readFile(png)); tex.setMimeType("image/png");
const mat = prim.getMaterial(); mat.setName("body"); mat.setRoughnessFactor(1); mat.setMetallicFactor(0);
const P = prim.getAttribute("POSITION"), IDX = prim.getIndices().getArray();
const n = P.getCount(), pos = [];
for (let i = 0; i < n; i++) pos.push(P.getElement(i, [0, 0, 0]));
const key = p => p.map(x => Math.round(x * 2e4)).join(",");
// close pinholes: corners on open edges that sit within 2 mm (model units
// 0.002) of each other collapse to one point (the source had a sliver hole
// beside the nose)
{
  const E = new Map(), k0 = i => key(pos[i]);
  for (let t = 0; t < IDX.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = k0(IDX[t + k]), b = k0(IDX[t + (k + 1) % 3]), e = a < b ? a + "|" + b : b + "|" + a;
    E.set(e, (E.get(e) ?? 0) + 1);
  }
  const openK = new Set();
  for (const [e, c] of E) if (c === 1) for (const k of e.split("|")) openK.add(k);
  const openV = [...Array(n).keys()].filter(i => openK.has(k0(i)));
  const done = new Set();
  for (const i of openV) {
    if (done.has(i)) continue;
    const cl = openV.filter(j => Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1], pos[i][2] - pos[j][2]) < 0.002);
    const c = [0, 1, 2].map(a => cl.reduce((s, j) => s + pos[j][a], 0) / cl.length);
    for (const j of cl) { pos[j] = c.slice(); P.setElement(j, c); done.add(j); }
  }
  console.log("pinhole corners collapsed", done.size);
}
const nodeOf = new Int32Array(n), nodeIdx = new Map(), npos = [];
for (let i = 0; i < n; i++) { const k = key(pos[i]); if (!nodeIdx.has(k)) { nodeIdx.set(k, npos.length); npos.push(pos[i]); } nodeOf[i] = nodeIdx.get(k); }
const M = npos.length, acc = Array.from({ length: M }, () => [0, 0, 0]), adj = Array.from({ length: M }, () => new Map());
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
for (let t = 0; t < IDX.length; t += 3) {
  const [a, b, c] = [IDX[t], IDX[t + 1], IDX[t + 2]].map(i => pos[i]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const ns = [IDX[t], IDX[t + 1], IDX[t + 2]].map(i => nodeOf[i]);
  for (const x of ns) { acc[x][0] += f[0]; acc[x][1] += f[1]; acc[x][2] += f[2]; }
  for (let k = 0; k < 3; k++) { const x = ns[k], y = ns[(k + 1) % 3]; if (x !== y) { const d = d3(npos[x], npos[y]); adj[x].set(y, d); adj[y].set(x, d); } }
}
// smooth the head (decimation left flat facets across the cheeks and
// chin): Taubin passes on the head's graph nodes, fading in above the neck
{
  // only the eye sockets (the sculpt's carved eyes; ours are painted): the
  // nose and the chin keep their shape
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wOf = v => { const [x, y, z] = npos[v]; const ax = Math.abs(x), front = ss(0.0, 0.025, z);
    const eyes = ss(0.012, 0.022, ax) * (1 - ss(0.12, 0.14, ax)) * ss(0.82, 0.835, y) * (1 - ss(0.91, 0.93, y));
    const lower = (1 - ss(0.1, 0.12, ax)) * ss(0.772, 0.785, y) * (1 - ss(0.82, 0.835, y)) * 0.7;
    const nose = (1 - ss(0.014, 0.022, ax)) * ss(0.815, 0.83, y) * (1 - ss(0.85, 0.86, y));
    return front * Math.max(eyes, lower) * (1 - nose); };
  const ITER = +(process.env.SMOOTH ?? 8), orig = npos.map(p => p.slice());
  // the lower face gets many more passes (the sculpt's mouthless snout had a hard rim)
  const LOWER = +(process.env.LOWER ?? 24);
  const wLow = v => { const [x, y, z] = npos[v]; return ss(0.0, 0.025, z) * (1 - ss(0.1, 0.12, Math.abs(x))) * ss(0.772, 0.785, y) * (1 - ss(0.825, 0.84, y)) * (1 - (1 - ss(0.014, 0.022, Math.abs(x))) * ss(0.815, 0.83, y)); };
  for (let it = 0; it < (ITER + LOWER) * 2; it++) {
    const f = it % 2 ? -0.53 : 0.5, wf = it >= ITER * 2 ? wLow : wOf;
    const next = npos.map(p => p.slice());
    for (let v = 0; v < M; v++) {
      const w = wf(v); if (!w || !adj[v].size) continue;
      const c = [0, 0, 0]; for (const u of adj[v].keys()) { c[0] += npos[u][0]; c[1] += npos[u][1]; c[2] += npos[u][2]; }
      const k = adj[v].size;
      for (let a = 0; a < 3; a++) next[v][a] = npos[v][a] + f * w * (c[a] / k - npos[v][a]);
    }
    for (let v = 0; v < M; v++) npos[v] = next[v];
  }
  // any triangle the smoothing turned over (or squashed) gets its corners back
  const fn = (Q, t) => { const [a, b, c] = [IDX[t], IDX[t + 1], IDX[t + 2]].map(i => Q[nodeOf[i]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
  for (let pass = 0; pass < 6; pass++) {
    let fixed = 0;
    for (let t = 0; t < IDX.length; t += 3) {
      const a = fn(orig, t), b = fn(npos, t), la = Math.hypot(...a), lb = Math.hypot(...b);
      if (la > 0 && (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * (lb || 1)) < 0.5) {
        for (const i of [IDX[t], IDX[t + 1], IDX[t + 2]]) npos[nodeOf[i]] = orig[nodeOf[i]].slice();
        fixed++;
      }
    }
    console.log("smoothing: restored", fixed, "triangles");
    if (!fixed) break;
  }
  for (let i = 0; i < n; i++) { pos[i] = npos[nodeOf[i]].slice(); P.setElement(i, pos[i]); }
  acc.forEach(a => a.fill(0));
  for (let t = 0; t < IDX.length; t += 3) {
    const [a, b, c] = [IDX[t], IDX[t + 1], IDX[t + 2]].map(i => pos[i]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const x of [IDX[t], IDX[t + 1], IDX[t + 2]].map(i => nodeOf[i])) { acc[x][0] += f[0]; acc[x][1] += f[1]; acc[x][2] += f[2]; }
  }
}
const N = prim.getAttribute("NORMAL"), nrm = [];
// the face's normals lean toward a smooth ellipsoid round the head (the
// anime trick): soft, even light on the cheeks and chin, no snout rim
const HC = [0, 0.872, -0.012], HR = [0.115, 0.13, 0.11];
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < n; i++) {
  const s = acc[nodeOf[i]]; const l = Math.hypot(...s) || 1; let v = s.map(x => x / l);
  const p = pos[i];
  const w = +(process.env.FACEN ?? 0.75) * sst(0.765, 0.785, p[1]) * (1 - sst(0.9, 0.93, p[1])) * sst(-0.01, 0.03, p[2]) * (1 - sst(0.08, 0.1, Math.abs(p[0])));
  if (w > 0) {
    const e = [0, 1, 2].map(a => (p[a] - HC[a]) / (HR[a] * HR[a])), le = Math.hypot(...e) || 1;
    v = v.map((x, a) => x * (1 - w) + e[a] / le * w); const l2 = Math.hypot(...v) || 1; v = v.map(x => x / l2);
  }
  N.setElement(i, v); nrm.push(v);
}

// ---- the face layer's UVs: the head's front, projected straight on
// (x -0.1..0.1 -> u 0..1, y 0.76..0.96 -> v 0..1), weighted by how much the
// surface faces forward; the cheeks and the back of the head get none
const FX0 = -0.1, FW = 0.2, FY0 = 0.76, FH = 0.2;
const fuv = new Float32Array(n * 2), fw = new Float32Array(n);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let faceN = 0;
for (let i = 0; i < n; i++) {
  const p = pos[i], nz = nrm[i][2];
  fuv[i * 2] = (p[0] - FX0) / FW; fuv[i * 2 + 1] = (p[1] - FY0) / FH;
  fw[i] = p[1] > 0.775 ? sstep(0.05, 0.4, nz) * sstep(0.0, 0.03, p[2]) : 0;
  if (fw[i] > 0) faceN++;
}
prim.setAttribute("TEXCOORD_1", doc.createAccessor().setType("VEC2").setArray(fuv).setBuffer(buf));
prim.setAttribute("_FACEW", doc.createAccessor().setType("SCALAR").setArray(fw).setBuffer(buf));

// ---- the skeleton (height 1, facing +z, the character's left is +x; A-pose arms)
const J = [
  ["root", null, [0, 0, 0]],
  ["hips", "root", [0, 0.47, 0.0]],
  ["spine", "hips", [0, 0.55, 0.0]],
  ["chest", "spine", [0, 0.64, 0.0]],
  ["neck", "chest", [0, 0.745, -0.005]],
  ["head", "neck", [0, 0.795, 0.0]],
  ["shoulder_L", "chest", [0.06, 0.71, 0]], ["upperarm_L", "shoulder_L", [0.135, 0.68, 0]], ["forearm_L", "upperarm_L", [0.195, 0.585, 0.0]], ["hand_L", "forearm_L", [0.245, 0.49, 0.01]],
  ["shoulder_R", "chest", [-0.06, 0.71, 0]], ["upperarm_R", "shoulder_R", [-0.135, 0.68, 0]], ["forearm_R", "upperarm_R", [-0.195, 0.585, 0.0]], ["hand_R", "forearm_R", [-0.245, 0.49, 0.01]],
  ["thigh_L", "hips", [0.055, 0.44, 0.0]], ["shin_L", "thigh_L", [0.06, 0.235, -0.005]], ["foot_L", "shin_L", [0.06, 0.05, -0.02]],
  ["thigh_R", "hips", [-0.055, 0.44, 0.0]], ["shin_R", "thigh_R", [-0.06, 0.235, -0.005]], ["foot_R", "shin_R", [-0.06, 0.05, -0.02]],
];
const J_ = Object.fromEntries(J.map(([name, parent, w], i) => [name, { i, parent, w }]));
const end = { hips: "spine", spine: "chest", chest: "neck", neck: "head", upperarm_L: "forearm_L", forearm_L: "hand_L", upperarm_R: "forearm_R", forearm_R: "hand_R", thigh_L: "shin_L", shin_L: "foot_L", thigh_R: "shin_R", shin_R: "foot_R" };
const tip = { hand_L: [0.29, 0.4, 0.01], hand_R: [-0.29, 0.4, 0.01], foot_L: [0.06, 0.0, 0.08], foot_R: [-0.06, 0.0, 0.08], head: [0, 1.0, 0] };
const seg = name => [J_[name].w, end[name] ? J_[end[name]].w : tip[name] ?? J_[name].w];
const distSeg = (p, [a, b]) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
};
const side = (p, s) => (s === "L" ? p[0] > 0 : p[0] < 0);
const seedOK = {
  hips: p => Math.abs(p[0]) < 0.09 && p[1] > 0.43 && p[1] < 0.5, spine: p => Math.abs(p[0]) < 0.09 && p[1] > 0.52 && p[1] < 0.6,
  chest: p => Math.abs(p[0]) < 0.08 && p[1] > 0.62 && p[1] < 0.72, neck: p => Math.abs(p[0]) < 0.04 && p[1] > 0.75 && p[1] < 0.78,
  head: p => p[1] > 0.82,
  upperarm_L: p => p[0] > 0.14 && p[1] > 0.6 && p[1] < 0.68, forearm_L: p => p[0] > 0.2 && p[1] > 0.5 && p[1] < 0.58, hand_L: p => p[0] > 0.24 && p[1] < 0.48,
  upperarm_R: p => p[0] < -0.14 && p[1] > 0.6 && p[1] < 0.68, forearm_R: p => p[0] < -0.2 && p[1] > 0.5 && p[1] < 0.58, hand_R: p => p[0] < -0.24 && p[1] < 0.48,
  thigh_L: p => side(p, "L") && Math.abs(p[0]) < 0.12 && p[1] > 0.3 && p[1] < 0.38, shin_L: p => side(p, "L") && Math.abs(p[0]) < 0.12 && p[1] > 0.08 && p[1] < 0.2, foot_L: p => side(p, "L") && Math.abs(p[0]) < 0.12 && p[1] < 0.035,
  thigh_R: p => side(p, "R") && Math.abs(p[0]) < 0.12 && p[1] > 0.3 && p[1] < 0.38, shin_R: p => side(p, "R") && Math.abs(p[0]) < 0.12 && p[1] > 0.08 && p[1] < 0.2, foot_R: p => side(p, "R") && Math.abs(p[0]) < 0.12 && p[1] < 0.035,
};
const BONES = Object.keys(seedOK);
function dijkstra(seeds) {
  const dist = new Float64Array(M).fill(Infinity), heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const [v, d0] of seeds) { if (d0 < dist[v]) { dist[v] = d0; push(d0, v); } }
  while (heap.length) { const [d, v] = pop(); if (d > dist[v]) continue; for (const [u, w] of adj[v]) { const nd = d + w; if (nd < dist[u]) { dist[u] = nd; push(nd, u); } } }
  return dist;
}
const geo = {};
for (const b of BONES) {
  const sg = seg(b), seeds = [];
  for (let v = 0; v < M; v++) if (seedOK[b](npos[v])) seeds.push([v, distSeg(npos[v], sg) * 0.25]);
  geo[b] = dijkstra(seeds);
  if (!seeds.length) console.log("NO SEEDS", b);
}
const joints = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
let unreached = 0;
for (let i = 0; i < n; i++) {
  const v = nodeOf[i];
  // the head is rigid above the jaw line (the face layer must not smear)
  if (pos[i][1] > 0.79) { joints[i * 4] = J_.head.i; weights[i * 4] = 1; continue; }
  let list = BONES.map(b => [b, geo[b][v]]).filter(([, d]) => isFinite(d));
  if (!list.length) { unreached++; list = [["hips", 0]]; }
  list = list.map(([b, d]) => [b, 1 / (d + 0.01) ** 4]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = list.reduce((x, [, w]) => x + w, 0);
  list.forEach(([b, w], k) => { joints[i * 4 + k] = J_[b].i; weights[i * 4 + k] = w / s; });
}
console.log("unreached", unreached, "graph nodes", M, "face verts", faceN);
prim.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(joints).setBuffer(buf));
prim.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(weights).setBuffer(buf));
const scene = root.listScenes()[0];
const meshNode = root.listNodes().find(x => x.getMesh() === mesh);
meshNode.setName("body");
const nodes = {};
for (const [name, parent, w] of J) {
  const pw = parent ? J_[parent].w : [0, 0, 0];
  const nd = doc.createNode(name).setTranslation([w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]]);
  nodes[name] = nd;
  if (parent) nodes[parent].addChild(nd); else scene.addChild(nd);
}
const ibm = new Float32Array(J.length * 16);
J.forEach(([, , w], k) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1], k * 16));
const skin = doc.createSkin("body").setSkeleton(nodes.root).setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buf));
for (const [name] of J) skin.addJoint(nodes[name]);
meshNode.setSkin(skin);
await doc.transform(prune({ keepAttributes: true }));
await io.write(out, doc);
let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
console.log("wrote", out, "tris", tris, "verts", n, "joints", J.length);
