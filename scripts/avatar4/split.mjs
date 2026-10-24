// the player base, step 1 (v2): orient (front +z, feet y=0, height 1), weld,
// a first pass to ~60k, then the head and the body simplified on their own
// (the cut between them locked, so they still share it): more of the
// triangle budget goes to the face, where it shows.
import { NodeIO } from "@gltf-transform/core";
import { weld, simplify, dedup, prune, compactPrimitive } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
const [inp, out, headT = "2300", bodyT = "2300", cutY = "0.772"] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(inp);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute("POSITION"), nor = prim.getAttribute("NORMAL");
const v = [0, 0, 0];
let minY = 1e9, maxY = -1e9;
for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]); }
const k = 1 / (maxY - minY);
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v); pos.setElement(i, [-v[2] * k, (v[1] - minY) * k, v[0] * k]);
  nor.getElement(i, v); nor.setElement(i, [-v[2], v[1], v[0]]);
}
await MeshoptSimplifier.ready;
const before = prim.getIndices().getCount() / 3;
await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio: 60000 / before, error: 0.002, lockBorder: false }), dedup(), prune());
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = p.getAttribute("POSITION").getArray(), I = p.getIndices().getArray();
const head = [], body = [];
for (let t = 0; t < I.length; t += 3) {
  const cy = (P[I[t] * 3 + 1] + P[I[t + 1] * 3 + 1] + P[I[t + 2] * 3 + 1]) / 3;
  (cy > +cutY ? head : body).push(I[t], I[t + 1], I[t + 2]);
}
const S = (idx, target) => {
  const [res] = MeshoptSimplifier.simplify(new Uint32Array(idx), P, 3, target * 3, 0.05, ["LockBorder"]);
  return res;
};
const h = S(head, +headT), b = S(body, +bodyT);
console.log("60k pass", I.length / 3, "head", head.length / 3, "->", h.length / 3, "body", body.length / 3, "->", b.length / 3);
const all = new Uint32Array(h.length + b.length); all.set(h); all.set(b, h.length);
p.getIndices().setArray(all);
await doc.transform(prune(), dedup());
compactPrimitive(p);
await io.write(out, doc);
console.log("tris", all.length / 3, "verts", p.getAttribute("POSITION").getCount());
