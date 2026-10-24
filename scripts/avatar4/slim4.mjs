// The base, slimmer: arms, legs, torso and neck pulled in toward their
// bones by SLIM (15%) on the mesh itself (bones, rig and head untouched).
// Each vertex moves toward the nearest point on each of its bones' segments
// (joint → child joint), blended by its skin weights, so the joints stay
// smooth. The head, hands and feet keep their size.
//   node slim4.mjs <base.glb> <out.glb> [factor=0.85]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const [inp, out, f = "0.85"] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot(), skin = root.listSkins()[0], joints = skin.listJoints();
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute("POSITION"), J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0");
const SLIM = +f;
// how much each bone's part keeps of its girth
const keep = name => /head/.test(name) ? 1 : /hand/.test(name) ? 0.95 : /foot/.test(name) ? 1 : SLIM;
// joint positions (rest, model space)
const world = j => { const m = j.getWorldMatrix(); return [m[12], m[13], m[14]]; };
const jp = joints.map(world);
const child = joints.map(j => { const c = j.listChildren().find(c => joints.includes(c)); return c ? jp[joints.indexOf(c)] : null; });
// segment of each bone; a leaf (head, hand, foot) gets a short one along its parent's direction
const seg = joints.map((j, k) => {
  if (child[k]) return [jp[k], child[k]];
  const par = joints.findIndex(p => p.listChildren().includes(j)), a = par >= 0 ? jp[par] : jp[k];
  const d = jp[k].map((v, i) => v - a[i]), L = Math.hypot(...d) || 1;
  return [jp[k], jp[k].map((v, i) => v + d[i] / L * 0.05)];
});
const closest = ([a, b], p) => {
  const ab = b.map((v, i) => v - a[i]), t = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * (p[i] - a[i]), 0) / (ab.reduce((s, v) => s + v * v, 0) || 1)));
  return a.map((v, i) => v + ab[i] * t);
};
const n = P.getCount(), out3 = new Float32Array(n * 3);
let moved = 0;
for (let i = 0; i < n; i++) {
  const p = P.getElement(i, [0, 0, 0]), j = J.getElement(i, [0, 0, 0, 0]), w = W.getElement(i, [0, 0, 0, 0]);
  const d = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    if (!w[k]) continue;
    const c = closest(seg[j[k]], p), s = (1 - keep(joints[j[k]].getName())) * w[k];
    for (let a = 0; a < 3; a++) d[a] += (c[a] - p[a]) * s;
  }
  moved = Math.max(moved, Math.hypot(...d));
  for (let a = 0; a < 3; a++) out3[i * 3 + a] = p[a] + d[a];
}
P.setArray(out3);
await io.write(out, doc);
console.log(`slimmed ${n} vertices by ${Math.round((1 - SLIM) * 100)}%, max move ${moved.toFixed(4)} -> ${out}`);
