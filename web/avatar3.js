// Rando avatar v3 — articulated humanoid base (3.5등신, PS2-matte) replacing
// the procedural blob for players/remotes. One rigged body mesh + code
// tints (5 skin tones recolor the shared texture, never separate meshes),
// 9 hair meshes × 5 texture recolors, 6 face designs × 6 iris decals
// (offline-extracted PNGs on a curved patch), and attachable top/bottom/
// shoe meshes that share the body's fit transform. The rig (34 tripo
// joints) ships in the GLB for future clip retargeting; runtime motion is
// the same procedural bob contract the blob used, so world code and feel
// are unchanged. API mirrors character3d: { group, config, setConfig,
// walking, phase, tick }.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { celMaterial, setFace } from "./cel.js";
import { faceTexture, EXPRESSIONS, EYE_Y, EYE_DX, drawFace } from "./face3.js";
import * as SkeletonUtils from "https://esm.sh/three@0.160.0/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";

const BASE = "avatar3";
const CHAR_H = 15;

// palette sampled offline from the generated variant sheets (avatar3_prep):
// skin ladder reordered light -> dark by luminance.
export const SKIN_RGB = {
  1: [238, 196, 156], 2: [205, 170, 147], 3: [192, 135, 91],
  4: [155, 99, 65], 5: [89, 60, 44],
};
const SKIN_BASE = [226, 189, 173]; // baked tone in body.glb's texture
export const HAIR_RGB = {
  black: [53, 52, 57], brown: [115, 82, 70], yellow: [225, 185, 122],
  red: [206, 55, 58], white: [225, 210, 200],
};
export const IRIS3_HEX = { // UI swatches only; decals carry the real color
  black: "#262a30", navy: "#2e4468", current: "#4a4e57",
  brown: "#8a6a52", blue: "#3f7fd1", green: "#5d9c53",
};

// f4, f5 and m5 are blocked: their meshes hang a panel of hair over the
// face from every mounting (front or back), which no fit can clear. A
// saved f4/f5/m5 falls back to the default style (normalizeAvatar3).
export const HAIR_STYLES = ["f1", "f2", "f3", "m1", "m2", "m3"];
export const PART_OPTIONS3 = {
  skin: ["1", "2", "3", "4", "5"],
  hair: ["none", ...HAIR_STYLES],
  hairColor: Object.keys(HAIR_RGB),
  face: ["f1", "f2", "f3", "f4", "f5", "f6"],
  iris: Object.keys(IRIS3_HEX),
  // crop-pink / ringer-white / shirt-open-white exist as assets but their
  // FRONT panels fused into the body mesh in this segmentation roll —
  // listed again once a cleaner gen lands (see rando-wardrobe-pipeline)
  top: ["none", "tee-baggy-black", "tee-white-graphic", "hoodie-maroon"],
  bottom: ["none", "cargo-black", "jeans-baggy-blue", "cargo-khaki",
           "track-navy", "camo", "loose-brown", "skirt-denim-grey",
           "skirt-pleated-black", "shorts-green", "shorts-blue"],
  shoes: ["none", "sneaker-hitop-black", "loafer-black", "sneaker-white-lowtop",
          "boot-work-tan", "clog-pink", "sneaker-white-stripe"],
};

// six starter fits, all from free items (baggy, street): top + bottom + shoes
export const STARTER_FITS = [
  { id: "skate", name: "Skate", top: "tee-baggy-black", bottom: "jeans-baggy-blue", shoes: "sneaker-hitop-black" },
  { id: "utility", name: "Utility", top: "tee-white-graphic", bottom: "cargo-khaki", shoes: "sneaker-white-stripe" },
  { id: "night-run", name: "Night run", top: "tee-baggy-black", bottom: "track-navy", shoes: "sneaker-white-lowtop" },
  { id: "weekend", name: "Weekend", top: "tee-white-graphic", bottom: "loose-brown", shoes: "sneaker-white-stripe" },
  { id: "summer", name: "Summer", top: "tee-white-graphic", bottom: "shorts-green", shoes: "sneaker-white-lowtop" },
  { id: "all-black", name: "All black", top: "tee-baggy-black", bottom: "cargo-black", shoes: "sneaker-hitop-black" },
];

export const DEFAULT_AVATAR3 = {
  skin: "1", hair: "f1", hairColor: "black", face: "f1", iris: "current",
  top: "none", bottom: "none", shoes: "sneaker-white-stripe",
};

// old blob configs ({ body, eyes, iris, head }) carry no mappable meaning
// here — any unknown/legacy value falls back per-key to the default, which
// is exactly the requested migration (skin 1, hair f1 black, default eyes).
export function normalizeAvatar3(raw) {
  const cfg = { ...DEFAULT_AVATAR3 };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_AVATAR3)) {
      const v = raw[k] != null ? String(raw[k]) : null;
      if (v && PART_OPTIONS3[k].includes(v)) cfg[k] = v;
    }
  }
  return cfg;
}

// ---------------- template load ----------------
const loader = new GLTFLoader();
let templatePromise = null;
let T = null; // resolved template

// faces are drawn in code (face3.js); kept for callers that awaited the
// old decal PNGs before drawing a thumb
export function loadFaceDecals() { return Promise.resolve(); }

// The runtime never drives the skeleton (motion is group-level, blob-style),
// and Tripo's rigs carry mesh-node transforms that make bind-pose skinning
// fragile — so render the body as a STATIC mesh: same geometry, same node
// transform, bones ignored. The rig stays in the GLB for future animation.
export function staticize(src) {
  const swaps = [];
  src.traverse(o => { if (o.isSkinnedMesh) swaps.push(o); });
  for (const sm of swaps) {
    const mesh = new THREE.Mesh(sm.geometry, sm.material);
    mesh.name = sm.name;
    mesh.position.copy(sm.position);
    mesh.quaternion.copy(sm.quaternion);
    mesh.scale.copy(sm.scale);
    sm.parent.add(mesh);
    sm.parent.remove(sm);
  }
}

// face analysis on the body texture: find the two baked dark eye clusters
// on the face front, erase a box covering eyes+mouth, remember where the
// face points so the decal patch can aim there.
function analyzeFace(src) {
  let sm = null;
  src.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  if (!sm || !sm.material.map?.image) return null;
  const img = sm.material.map.image;
  const cv = document.createElement("canvas");
  const scale = Math.min(1, 2048 / img.width);
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const pos = sm.geometry.attributes.position;
  const uv = sm.geometry.attributes.uv;
  // geometry attributes live in the mesh's local/bind space; measure in the
  // scene frame (the same frame the garment pieces share) via matrixWorld
  sm.updateWorldMatrix(true, false);
  const W = sm.matrixWorld.clone();
  const wp = (i, out) => out.fromBufferAttribute(pos, i).applyMatrix4(W);
  const lumAt = (u, v) => {
    const x = Math.min(cv.width - 1, Math.max(0, Math.round(u * cv.width)));
    const y = Math.min(cv.height - 1, Math.max(0, Math.round(v * cv.height)));
    const i = (y * cv.width + x) * 4;
    return (px[i] + px[i + 1] + px[i + 2]) / 3;
  };
  // facing-agnostic: gather every dark head-band vertex regardless of the
  // rig's export heading (Tripo bodies face ±X as often as ±Z)
  const v0 = new THREE.Vector3();
  const geoBox = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) geoBox.expandByPoint(wp(i, v0));
  const height = geoBox.max.y - geoBox.min.y;
  const darks = [];
  for (let i = 0; i < pos.count; i++) {
    if (wp(i, v0).y < geoBox.min.y + height * 0.55) continue; // head band
    if (lumAt(uv.getX(i), uv.getY(i)) > 95) continue;
    darks.push(i);
  }
  if (darks.length < 12) return null;
  const v = new THREE.Vector3();
  // head sphere least-squares fit on the crown
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const B = [0, 0, 0, 0];
  const yCap = geoBox.min.y + height * 0.72;
  for (let i = 0; i < pos.count; i++) {
    wp(i, v);
    if (v.y < yCap) continue;
    const x = v.x, y = v.y, z = v.z;
    const row = [2 * x, 2 * y, 2 * z, 1];
    const rhs = x * x + y * y + z * z;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
      B[r] += row[r] * rhs;
    }
  }
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [B[col], B[piv]] = [B[piv], B[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < 4; c++) A[r][c] -= f * A[col][c];
      B[r] -= f * B[col];
    }
  }
  const sol = B.map((b, i) => b / A[i][i]);
  const C = new THREE.Vector3(sol[0], sol[1], sol[2]);
  const R = Math.sqrt(Math.max(1e-8, sol[3] + C.lengthSq()));
  // face direction + erase box across BOTH eyes, extended down over the
  // mouth (the decal replaces the whole feature set)
  const ub = { u0: 1, v0: 1, u1: 0, v1: 0 };
  const mid = new THREE.Vector3();
  for (const i of darks) {
    mid.add(wp(i, v));
    ub.u0 = Math.min(ub.u0, uv.getX(i)); ub.u1 = Math.max(ub.u1, uv.getX(i));
    ub.v0 = Math.min(ub.v0, uv.getY(i)); ub.v1 = Math.max(ub.v1, uv.getY(i));
  }
  mid.divideScalar(darks.length);
  let rMax = 0;
  for (const i of darks) {
    rMax = Math.max(rMax, wp(i, v).sub(C).length());
  }
  // patch must clear the whole skull, not just the eye bumps
  const sphereR = Math.max(R, rMax);
  const dir = mid.clone().sub(C).setY(0).normalize(); // horizontal facing
  dir.add(new THREE.Vector3(0, 0.07, 0)).normalize();
  // sample a fill color beside the box, then erase (box + mouth margin)
  const padU = 0.015, padV = 0.012;
  const bx = Math.floor((ub.u0 - padU) * cv.width);
  const by = Math.floor((ub.v0 - padV) * cv.height);
  const bw = Math.ceil((ub.u1 - ub.u0 + 2 * padU) * cv.width);
  const bh = Math.ceil((ub.v1 - ub.v0 + 2 * padV + 0.05) * cv.height);
  let fill = [226, 189, 173], best = 0;
  for (const [sx, sy] of [[bx - 9, by + bh / 2], [bx + bw + 9, by + bh / 2], [bx + bw / 2, by - 9]]) {
    const i = ((Math.max(0, Math.min(cv.height - 1, Math.round(sy)))) * cv.width +
               (Math.max(0, Math.min(cv.width - 1, Math.round(sx))))) * 4;
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
    if (l > best) { best = l; fill = [px[i], px[i + 1], px[i + 2]]; }
  }
  ctx.fillStyle = `rgb(${fill[0]},${fill[1]},${fill[2]})`;
  ctx.fillRect(bx, by, bw, bh);
  img.close?.();
  const frame = faceFrame(sm, wp, darks, C, R, dir);
  // the symmetric facing, not the eye-cluster guess: the guess sat 6.6°
  // off on body.glb, so the whole character stood slightly turned
  return { canvas: cv, C, R: sphereR, dir: frame.dir.clone(), frame };
}

// FACE_SCALE > 1 draws the features bigger than the baked eyes they replace
const FACE_SCALE = 1.22;
// The face's own UV set: every body vertex gets faceUvw = (u, v, weight),
// a planar projection of its REST position onto the face plane, lined up
// so the eyes found on the head land on face3's EYE_Y / EYE_DX. It is a
// vertex attribute, so the face skins with the head bone in every pose;
// the cel shader composites the face texture through it (cel.js).
function faceFrame(sm, wp, darks, C0, R, dir0) {
  const up0 = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  // square the frame up on the two eyes: the axis between them is the
  // head's true left-right, and the head center sits midway between them
  // (the crown sphere fit and the dark-cluster facing drift sideways a
  // little, which made the hairline lopsided)
  let ax = new THREE.Vector3().crossVectors(up0, dir0).normalize(); // viewer's right
  const eyeL = new THREE.Vector3(), eyeR = new THREE.Vector3();
  let nl = 0, nr = 0;
  for (const i of darks) {
    wp(i, v);
    const d = v.clone().sub(C0);
    if (d.dot(dir0) <= 0) continue;
    if (d.dot(ax) < 0) { eyeL.add(v); nl++; } else { eyeR.add(v); nr++; }
  }
  const C = C0.clone();
  let dir = dir0.clone();
  if (nl > 3 && nr > 3) {
    eyeL.divideScalar(nl); eyeR.divideScalar(nr);
    const across = eyeR.clone().sub(eyeL).setY(0);
    if (across.lengthSq() > 1e-10) {
      ax = across.normalize();
      dir = new THREE.Vector3().crossVectors(ax, up0).normalize();
      const mid = eyeL.clone().add(eyeR).multiplyScalar(0.5);
      C.addScaledVector(ax, mid.clone().sub(C).dot(ax));
    }
  }
  // then refine on the skull's own mirror symmetry: the eye clusters
  // aren't exact (one can pick up more brow or lash than the other), and a
  // few degrees of yaw tilt the hairline visibly to one side
  {
    const pts = [];
    for (let i = 0; i < sm.geometry.attributes.position.count; i += 1) {
      wp(i, v);
      const d = v.clone().sub(C);
      if (d.length() < 1.3 * R && d.y > -0.3 * R) pts.push(d);
    }
    const cell = R * 0.08, hash = new Map();
    const hk = (x, y, z) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
    for (const q of pts) { const k = hk(q.x, q.y, q.z); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(q); }
    const nearD = (x, y, z) => {
      let bd = cell * cell * 4;
      const cx = Math.round(x / cell), cy = Math.round(y / cell), cz = Math.round(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (const q of hash.get(`${cx + a},${cy + b},${cz + c}`) ?? []) {
          const dd = (q.x - x) ** 2 + (q.y - y) ** 2 + (q.z - z) ** 2;
          if (dd < bd) bd = dd;
        }
      }
      return bd;
    };
    const cost = (yaw, off) => {
      const n = new THREE.Vector3(ax.x, 0, ax.z).applyAxisAngle(up0, yaw);
      let sum = 0;
      for (let k = 0; k < pts.length; k += 2) {
        const q = pts[k];
        const t = 2 * (q.dot(n) - off);
        sum += nearD(q.x - t * n.x, q.y - t * n.y, q.z - t * n.z);
      }
      return sum;
    };
    let best = [0, 0], bc = cost(0, 0);
    for (let yd = -24; yd <= 24; yd += 2) for (let o = -0.12; o <= 0.121; o += 0.03) {
      const c = cost(yd * Math.PI / 180, o * R);
      if (c < bc) { bc = c; best = [yd * Math.PI / 180, o * R]; }
    }
    const [y0, o0] = best;
    for (let yd = -2; yd <= 2; yd += 0.5) for (let o = -0.03; o <= 0.031; o += 0.01) {
      const c = cost(y0 + yd * Math.PI / 180, o0 + o * R);
      if (c < bc) { bc = c; best = [y0 + yd * Math.PI / 180, o0 + o * R]; }
    }
    ax.applyAxisAngle(up0, best[0]).setY(0).normalize();
    C.addScaledVector(ax, best[1]);
    dir = new THREE.Vector3().crossVectors(ax, up0).normalize();
    if (dir.dot(dir0) < 0) { dir.negate(); ax.negate(); }
  }
  const ay = new THREE.Vector3().crossVectors(dir, ax).normalize();
  const as = [], bs = [];
  for (const i of darks) {
    wp(i, v).sub(C);
    if (v.dot(dir) <= 0) continue;
    as.push(v.dot(ax)); bs.push(v.dot(ay));
  }
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
  const left = as.filter(a => a < 0), right = as.filter(a => a > 0);
  const sep = Math.max(R * 0.35, med(right) - med(left));
  const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)] ?? 0;
  const eyeB = pct(bs, 0.6); // upper half of the dark cluster: eyes, not mouth
  const eyeA = (med(right) + med(left)) / 2;
  const unit = sep / (2 * EYE_DX) * FACE_SCALE; // world units per face canvas
  const pos = sm.geometry.attributes.position;
  const nrm = sm.geometry.attributes.normal;
  const NM = new THREE.Matrix3().getNormalMatrix(sm.matrixWorld);
  const nv = new THREE.Vector3();
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // facing weight: the side of the head never takes a stretched eye
    const facing = nrm ? nv.fromBufferAttribute(nrm, i).applyMatrix3(NM).normalize().dot(dir) : 1;
    wp(i, v).sub(C);
    const depth = v.dot(dir) / R, dist = v.length() / R;
    const a = v.dot(ax), b = v.dot(ay);
    out[i * 3] = 0.5 + (a - eyeA) / unit;
    out[i * 3 + 1] = 1 - (EYE_Y - (b - eyeB) / unit); // texture v (flipY)
    const w = THREE.MathUtils.smoothstep(depth, 0.15, 0.45) *
      THREE.MathUtils.smoothstep(facing, 0.25, 0.55) *
      (1 - THREE.MathUtils.smoothstep(dist, 1.25, 1.45));
    out[i * 3 + 2] = w;
  }
  sm.geometry.setAttribute("faceUvw", new THREE.BufferAttribute(out, 3));
  shapeBody(sm, wp, { C, R, dir, ax, ay, eyeB, unit });
  return { sep, unit, eyeA, eyeB, dir, C };
}

// the scalp's edge, as a height above the eyes by how far round the head
// you are (depth: 1 = straight ahead, 0 = above the ear, -1 = the back):
// high across the forehead, a short temple, just over the ear, then down
// behind it to the nape. Piecewise linear between knots.
function hairline(depth, f) {
  const K = [[-1, -0.66 * f.R], [-0.62, -0.6 * f.R], [-0.42, -0.36 * f.R], [-0.22, 0.1 * f.R],
    [0.15, 0.14 * f.R], [0.45, 0.2 * f.R], [0.68, 0.23 * f.unit], [1, 0.27 * f.unit]];
  for (let k = 1; k < K.length; k++) {
    if (depth <= K[k][0]) {
      const t = (depth - K[k - 1][0]) / (K[k][0] - K[k - 1][0]);
      return K[k - 1][1] + (K[k][1] - K[k - 1][1]) * Math.max(0, t);
    }
  }
  return K[K.length - 1][1];
}

// Body regions + proportions, done once on the template mesh (so every
// pose and clip keeps them):
// - bodyRgn = (scalp, skin, tank, shorts) weights. The cel shader paints
//   those regions flat (skin tone, hair color, the base tank and shorts),
//   which replaces the baked texture's painted hairline, seams and stray
//   skin-colored patches on the tank. Hem lines follow body height, the
//   hairline follows the face frame.
// - limbs and torso 12% slimmer: each vertex moves toward its bones' axes
//   (blended by skin weight, so joints stay continuous); hands 18% bigger
//   about the wrist. Bind-pose edit: the skeleton and clips are untouched.
const SLIM = 0.12, HAND = 1.18;
function shapeBody(sm, wp, f) {
  const geo = sm.geometry;
  const pos = geo.attributes.position;
  const sIdx = geo.attributes.skinIndex, sWt = geo.attributes.skinWeight;
  const bones = sm.skeleton?.bones ?? [];
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    wp(i, v); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const H = maxY - minY;
  const lat = i => (P[i * 3] - f.C.x) * f.ax.x + (P[i * 3 + 2] - f.C.z) * f.ax.z;
  const yn = i => (P[i * 3 + 1] - minY) / H;
  // joint -> kind
  const kindOf = (j, i) => {
    const nm = bones[j]?.name ?? "";
    if (/Head_2/.test(nm)) return "head";
    if (/Head_/.test(nm)) return "neck";
    if (/Spine|Root/.test(nm)) return "torso";
    if (/0_(Left|Right)_Limb/.test(nm)) return "arm";
    if (/1_(Left|Right)_Limb/.test(nm)) return "leg";
    return Math.abs(lat(i)) > 0.055 * H ? "arm" : "torso";
  };
  const kw = new Float32Array(n * 5); // head, neck, torso, arm, leg weights
  const K = { head: 0, neck: 1, torso: 2, arm: 3, leg: 4 };
  const domJ = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1;
    for (let c = 0; c < 4; c++) {
      const j = sIdx ? sIdx.getComponent(i, c) : 0, w = sWt ? sWt.getComponent(i, c) : 0;
      if (w <= 0) continue;
      kw[i * 5 + K[kindOf(j, i)]] += w;
      if (w > bw) { bw = w; best = j; }
    }
    domJ[i] = best;
  }
  // regions
  const rgn = new Float32Array(n * 4);
  const ss = THREE.MathUtils.smoothstep;
  const WAIST = 0.468, HEM = 0.31, NECKLINE = 0.638, SLEEVE = 0.548;
  for (let i = 0; i < n; i++) {
    const y = yn(i);
    const torso = kw[i * 5 + 2], leg = kw[i * 5 + 4], arm = kw[i * 5 + 3], head = kw[i * 5];
    rgn[i * 4 + 1] = 1; // skin everywhere underneath
    const notArm = 1 - ss(arm, 0.4, 0.6);
    // soft ramps (not steps): the shader cuts at the 0.5 iso-line, which
    // then runs smoothly through triangles instead of zig-zagging on edges
    const band = (x, e, wd) => ss(x, e - wd, e + wd);
    // (not "torso + leg": Tripo's weights bleed the resting hands' bones
    // into the thighs, which chewed the hem into spikes)
    const body = notArm * (1 - ss(head + kw[i * 5 + 1], 0.4, 0.6));
    // the base tee: torso up to the neck, plus short sleeves on the arms
    // (cut by height alone: this rig's neck weights reach down onto the
    // chest, and following them made the neckline ragged)
    const armCut = THREE.MathUtils.lerp(1, band(y, SLEEVE, 0.012), ss(arm, 0.4, 0.6)); // sleeves
    // a crew neck: low at the middle, rising over the shoulders
    const neckH = NECKLINE + 0.045 * ss(Math.abs(lat(i)) / H, 0.022, 0.045);
    rgn[i * 4 + 2] = armCut * band(y, WAIST, 0.012) * (1 - band(y, neckH, 0.012));
    rgn[i * 4 + 3] = body * (1 - band(y, WAIST, 0.012)) * band(y, HEM, 0.03);
    // scalp: anything on the skull above a hairline that sits high on the
    // forehead, above the ears at the sides and drops to the nape
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).sub(f.C);
    if (v.length() < 1.35 * f.R && v.dot(f.ay) > -0.75 * f.R) {
      const depth = v.dot(f.dir) / v.length(), b = v.dot(f.ay);
      const line = f.eyeB + hairline(depth, f);
      // stored as a signed distance (0.5 = on the line, 1 R = 0.5 units) so
      // the shader can move the cut: lower while hair is on, so gaps
      // between strands show hair color, not forehead
      rgn[i * 4] = THREE.MathUtils.clamp(0.5 + (b - line) / f.R * 0.5, 0, 1);
    }
  }
  geo.setAttribute("bodyRgn", new THREE.BufferAttribute(rgn, 4));
  // feet (inside any shoe): hidden while shoes are worn, see cel.js uHide
  const foot = new Float32Array(n);
  for (let i = 0; i < n; i++) foot[i] = kw[i * 5 + 4] * (1 - ss(yn(i), 0.095, 0.115));
  geo.setAttribute("footW", new THREE.BufferAttribute(foot, 1));
  // slimming: per joint group, the principal axis through its centroid
  const groups = new Map(); // joint -> { c, axis }
  const byJ = new Map();
  for (let i = 0; i < n; i++) { if (!byJ.has(domJ[i])) byJ.set(domJ[i], []); byJ.get(domJ[i]).push(i); }
  for (const [j, ids] of byJ) {
    if (ids.length < 20) continue;
    const c = new THREE.Vector3();
    for (const i of ids) c.add(v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    c.divideScalar(ids.length);
    // power iteration on the covariance for the main axis
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of ids) {
      const d = [P[i * 3] - c.x, P[i * 3 + 1] - c.y, P[i * 3 + 2] - c.z];
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) cov[r * 3 + q] += d[r] * d[q];
    }
    let a = new THREE.Vector3(0, 1, 0);
    for (let it = 0; it < 24; it++) {
      a = new THREE.Vector3(cov[0] * a.x + cov[1] * a.y + cov[2] * a.z,
        cov[3] * a.x + cov[4] * a.y + cov[5] * a.z, cov[6] * a.x + cov[7] * a.y + cov[8] * a.z).normalize();
    }
    // the torso slims about a vertical axis (its main axis is the width)
    const k = kindOf(j, ids[0]);
    if (k === "torso") a.set(0, 1, 0);
    groups.set(j, { c, a, k });
  }
  // wrists: per side, the arm vertices just above the hand
  const HANDY = 0.445;
  const wrist = { [-1]: new THREE.Vector3(), [1]: new THREE.Vector3() }, wc = { [-1]: 0, [1]: 0 };
  for (let i = 0; i < n; i++) {
    const y = yn(i);
    if (kw[i * 5 + 3] < 0.6 || y < HANDY - 0.012 || y > HANDY + 0.012) continue;
    const sd = Math.sign(lat(i)) || 1;
    wrist[sd].add(v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); wc[sd]++;
  }
  for (const sd of [-1, 1]) if (wc[sd]) wrist[sd].divideScalar(wc[sd]);
  const inv = sm.matrixWorld.clone().invert();
  const d = new THREE.Vector3(), off = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    off.set(0, 0, 0);
    const y = yn(i);
    const isHand = kw[i * 5 + 3] > 0.5 && y < HANDY;
    const slimmable = 1 - kw[i * 5] - kw[i * 5 + 1]; // not head/neck
    if (slimmable > 0.01) {
      for (let c = 0; c < 4; c++) {
        const w = sWt ? sWt.getComponent(i, c) : 0;
        const g = w > 0 && groups.get(sIdx.getComponent(i, c));
        if (!g || g.k === "head" || g.k === "neck") continue;
        // feet and hands keep their size (sneakers + hands are the chunky bits)
        if (g.k === "leg" && y < 0.11) continue;
        if (isHand) continue;
        d.copy(p).sub(g.c);
        d.sub(g.a.clone().multiplyScalar(d.dot(g.a))); // perpendicular part
        off.addScaledVector(d, -SLIM * w);
      }
    }
    if (kw[i * 5 + 3] > 0.3 && y < HANDY + 0.01 && wc[Math.sign(lat(i)) || 1]) {
      const t = ss(y, HANDY + 0.01, HANDY - 0.03); // 0 at the wrist -> 1 in the palm
      const wr = wrist[Math.sign(lat(i)) || 1];
      off.add(d.copy(p).sub(wr).multiplyScalar((HAND - 1) * t));
    }
    p.add(off).applyMatrix4(inv);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  smoothNormals(geo);
  // anime-style face shading: the face's normals lean toward straight
  // ahead (and a little up), so the face lights as one calm surface — the
  // jaw and cheek undersides no longer fall into cel shadow (which read
  // as a beard on small sprites)
  const nrm = geo.attributes.normal;
  const NM = new THREE.Matrix3().getNormalMatrix(sm.matrixWorld), NMi = NM.clone().invert();
  const ahead = f.dir.clone().addScaledVector(f.ay, 0.35).normalize();
  const nw = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).sub(f.C);
    const dist = v.length() / f.R;
    if (dist > 1.35) continue;
    const depth = v.dot(f.dir) / Math.max(1e-6, v.length());
    const below = 1 - ss(v.dot(f.ay), f.eyeB + 0.25 * f.R, f.eyeB + 0.45 * f.R);
    const k = 0.8 * ss(depth, -0.05, 0.35) * below * (1 - ss(dist, 1.2, 1.35)) * (1 - kw[i * 5 + 2] - kw[i * 5 + 3]);
    if (k <= 0.001) continue;
    nw.fromBufferAttribute(nrm, i).applyMatrix3(NM).normalize().lerp(ahead, k).normalize().applyMatrix3(NMi).normalize();
    nrm.setXYZ(i, nw.x, nw.y, nw.z);
  }
  nrm.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}

// area-weighted normals, welded across UV seams (vertices that share a
// position share a normal): no shading creases along texture seams, and
// the reshaped limbs shade like their new shape
function smoothNormals(geo) {
  const pos = geo.attributes.position, n = pos.count;
  const key = new Int32Array(n), ids = new Map();
  const q = 1e5 / (geo.boundingSphere?.radius || 1);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    key[i] = ids.get(k);
  }
  const acc = new Float32Array(ids.size * 3);
  const idx = geo.index ? geo.index.array : null;
  const tris = (idx ? idx.length : n) / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    b.sub(a); c.sub(a); b.cross(c); // area-weighted face normal
    for (const i of [i0, i1, i2]) {
      acc[key[i] * 3] += b.x; acc[key[i] * 3 + 1] += b.y; acc[key[i] * 3 + 2] += b.z;
    }
  }
  // then relax them over welded neighbors: Tripo surfaces are lumpy, and
  // a 3-step toon ramp turns every lump into a blotch
  const nb = Array.from({ length: ids.size }, () => new Set());
  for (let t = 0; t < tris; t++) {
    const k = [0, 1, 2].map(e => key[idx ? idx[t * 3 + e] : t * 3 + e]);
    for (const x of k) for (const y of k) if (x !== y) nb[x].add(y);
  }
  let cur = acc;
  for (let it = 0; it < 4; it++) {
    const nx = new Float32Array(cur.length);
    for (let k = 0; k < ids.size; k++) {
      a.set(cur[k * 3], cur[k * 3 + 1], cur[k * 3 + 2]).normalize();
      for (const m of nb[k]) {
        b.set(cur[m * 3], cur[m * 3 + 1], cur[m * 3 + 2]).normalize();
        a.addScaledVector(b, 0.6 / nb[k].size);
      }
      nx[k * 3] = a.x; nx[k * 3 + 1] = a.y; nx[k * 3 + 2] = a.z;
    }
    cur = nx;
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a.set(cur[key[i] * 3], cur[key[i] * 3 + 1], cur[key[i] * 3 + 2]).normalize();
    out[i * 3] = a.x; out[i * 3 + 1] = a.y; out[i * 3 + 2] = a.z;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(out, 3));
}

// flatten any PBR into the world's matte look, keep the map
export function matteify(root) {
  root.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const src = o.material;
    o.material = new THREE.MeshLambertMaterial({ map: src.map ?? null });
    o.material.map && (o.material.map.colorSpace = THREE.SRGBColorSpace);
    o.frustumCulled = false;
  });
}

// every character piece gets the shared cel material (keeps its map)
function celify(root) {
  root.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.material = celMaterial({ map: o.material.map ?? null });
    o.frustumCulled = false;
    // some pieces ship without normals (skirt-denim-grey): the toon ramp
    // lit them solid black
    if (!o.geometry.attributes.normal) { o.geometry.computeBoundingSphere(); smoothNormals(o.geometry); }
  });
}

// the face texture for a config + expression (shared, cache-owned)
const faceFor = (cfg, expr = "neutral") => faceTexture({
  style: cfg.face, iris: cfg.iris, expr,
  brow: cfg.hair === "none" ? [70, 52, 46] : HAIR_RGB[cfg.hairColor],
});

const srgb = c => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
// the base layer, painted flat by the cel shader (see shapeBody)
const BASE_TANK = [244, 241, 232], BASE_SHORTS = [62, 70, 104];
const paintFor = cfg => ({
  skin: srgb(SKIN_RGB[cfg.skin] ?? SKIN_BASE),
  // exactly the hair's color: where a shell sits close, the scalp reads as
  // more hair rather than a darker patch
  scalp: srgb(HAIR_RGB[cfg.hairColor] ?? HAIR_RGB.black),
  tank: srgb(BASE_TANK), shorts: srgb(BASE_SHORTS),
  // with hair on, the scalp reaches 0.12 R lower (see bodyRgn)
  scalpCut: cfg.hair === "none" ? 0.5 : 0.44,
  // body under worn clothes isn't drawn at all, so it can never poke
  // through a sleeve, a waistband or a shoe (x tee, y shorts, z feet)
  hide: [cfg.top !== "none", cfg.bottom !== "none", cfg.shoes !== "none"],
});

export function loadHumanTemplate() {
  if (templatePromise) return templatePromise;
  templatePromise = (async () => {
    const g = await loader.loadAsync(`${BASE}/body.glb`);
    const src = g.scene;
    src.updateWorldMatrix(true, true);
    const face = analyzeFace(src);
    staticize(src);
    // the rig exports facing wherever Tripo felt like — yaw the source so
    // the detected face points +Z (the app's forward), and remember the
    // yaw + source frame center so attachments can be matched to it
    let yaw = 0;
    if (face) {
      yaw = Math.atan2(face.dir.x, face.dir.z);
      src.rotation.y = -yaw;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      face.dir.applyQuaternion(q);
      face.C.applyQuaternion(q);
      face.frame.C.applyQuaternion(q);
      face.frame.dir.applyQuaternion(q);
    }
    src.updateWorldMatrix(true, true);
    const srcBox = new THREE.Box3().setFromObject(src);
    const srcCenter = new THREE.Vector3();
    srcBox.getCenter(srcCenter); // garment frames are centered on origin
    // fit wrapper: normalize to CHAR_H, feet on ground, centered — the SAME
    // numbers are applied to every attachment (all pieces share the body's
    // Tripo-normalized source frame, so one transform fits all)
    const fit = new THREE.Group();
    fit.add(src);
    fit.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(fit);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = CHAR_H / size.y;
    fit.scale.setScalar(s);
    fit.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(fit);
    const off = new THREE.Vector3(
      -(box2.min.x + box2.max.x) / 2, -box2.min.y, -(box2.min.z + box2.max.z) / 2);
    fit.position.copy(off);
    // the head in the fitted (world) frame, for fitting hair and hats
    const head = face && {
      C: face.frame.C.clone().multiplyScalar(s).add(off),
      dir: face.frame.dir.clone(),
      R: face.R * s, unit: face.frame.unit * s,
      eyeY: face.frame.C.y * s + off.y + face.frame.eyeB * s,
    };
    T = {
      fit, face, head,
      fitScale: s, fitOffset: off, yaw, srcCenter,
      pieces: {},           // "cat/id" -> template scene (cel)
      pieceLoads: {},       // in-flight piece loads
    };
    return T;
  })();
  return templatePromise;
}

// drop triangles whose three root-frame vertices ALL satisfy dropFn
function cropTris(root, dropFn) {
  root.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    const drop = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      drop[i] = dropFn(v) ? 1 : 0;
    }
    const idx = geo.index;
    const tri = idx ? idx.array : null;
    const triCount = (tri ? tri.length : pos.count) / 3;
    const kept = [];
    for (let t = 0; t < triCount; t++) {
      const a = tri ? tri[t * 3] : t * 3;
      const b = tri ? tri[t * 3 + 1] : t * 3 + 1;
      const c = tri ? tri[t * 3 + 2] : t * 3 + 2;
      if (drop[a] && drop[b] && drop[c]) continue;
      kept.push(a, b, c);
    }
    geo.setIndex(kept);
  });
}

// drop triangles whose vertices sit entirely above yLimit (root frame)
const cropAboveY = (root, yLimit) => cropTris(root, v => v.y > yLimit);

function pieceUrl(cat, id) {
  const sub = { hair: "hair", top: "tops", bottom: "bottoms", shoes: "shoes" }[cat];
  return `${BASE}/${sub}/${id}.glb`;
}

// load (and cache) an attachment template; resolves to a matte scene
function loadPiece(cat, id) {
  const key = `${cat}/${id}`;
  if (T.pieces[key]) return Promise.resolve(T.pieces[key]);
  if (!T.pieceLoads[key]) {
    T.pieceLoads[key] = loader.loadAsync(pieceUrl(cat, id)).then(async g => {
      celify(g.scene);
      // segmentation left some bottoms with hidden inner surfaces reaching
      // the chest (invisible on the source model, visible worn) — crop any
      // face fully above the waistline of the shared source frame
      if (cat === "bottom") cropAboveY(g.scene, 0.22);
      const trim = PIECE_TRIM[key];
      if (trim) {
        // raw-frame front/side axes: inner.rotation.y = -T.yaw maps raw to
        // scene, so raw "front" is scene +Z rotated by +T.yaw
        const f = new THREE.Vector3(Math.sin(T.yaw), 0, Math.cos(T.yaw));
        const s = new THREE.Vector3(Math.cos(T.yaw), 0, -Math.sin(T.yaw));
        cropTris(g.scene, v =>
          v.y < trim.yBelow && v.dot(f) > trim.front &&
          Math.abs(v.dot(s)) < trim.halfWidth);
      }
      if (cat !== "hair") {
        // seam dilation at the size each part gets in the merged atlas, one
        // part per task so the page stays responsive while outfits load
        const parts = [];
        g.scene.traverse(o => { if (o.isMesh) parts.push(o); });
        const cell = parts.length < 2 ? 1024 : Math.min(1024, Math.floor(2048 / Math.ceil(Math.sqrt(parts.length))));
        for (const o of parts) { dilateMap(o, cell); await new Promise(r => setTimeout(r, 0)); }
      }
      if (cat === "hair") fitHair(g.scene, key);
      if (cat === "shoes") chunkyShoes(g.scene, key);
      mergePiece(g.scene, cat === "hair");
      T.pieces[key] = g.scene;
      delete T.pieceLoads[key];
      return g.scene;
    });
  }
  return T.pieceLoads[key];
}

// hair is one flat code tint (the cel shader shades it): Tripo's hair
// textures carry baked skin, holes and seams, and a texture recolor
// drifted between builds. Double-sided, so any hole in the shell shows
// hair from the inside rather than the background.
function tintHair(root, color) {
  const c = srgb(HAIR_RGB[color] ?? HAIR_RGB.black);
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material.map = null;
    o.material.color.copy(c);
    o.material.side = THREE.DoubleSide;
    o.material.needsUpdate = true;
  });
}

// One mesh per piece: Tripo splits hair and clothes into many parts (up to
// 20 for a pair of shoes), each its own draw call — ~28 per dressed
// character. Hair is one flat tint, so its parts just merge; clothes get
// their textures packed into one atlas (a padded cell each, UVs remapped)
// and merge into a single textured mesh. Once per piece template.
function mergePiece(scene, untextured) {
  scene.updateWorldMatrix(true, true);
  const meshes = [];
  scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (meshes.length < 2) return;
  const n = meshes.length, grid = Math.ceil(Math.sqrt(n));
  const cell = Math.min(1024, Math.floor(2048 / grid)), pad = 4;
  let atlas = null, g = null;
  if (!untextured) {
    atlas = document.createElement("canvas");
    atlas.width = atlas.height = grid * cell;
    g = atlas.getContext("2d");
  }
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const geos = meshes.map((m, k) => {
    let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(name)) geo.deleteAttribute(name);
    if (untextured) { geo.deleteAttribute("uv"); return geo; }
    const cx = k % grid, cy = Math.floor(k / grid);
    const img = m.material.map?.image;
    if (img) g.drawImage(img, cx * cell + pad, cy * cell + pad, cell - 2 * pad, cell - 2 * pad);
    else { g.fillStyle = "#" + m.material.color.getHexString(); g.fillRect(cx * cell, cy * cell, cell, cell); }
    const flip = m.material.map?.flipY ?? false;
    let uv = geo.attributes.uv;
    if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2).fill(0.5), 2); geo.setAttribute("uv", uv); }
    const s0 = (cell - 2 * pad) / (grid * cell), o = pad / (grid * cell);
    for (let i = 0; i < uv.count; i++) {
      const u = Math.min(1, Math.max(0, uv.getX(i)));
      let v = Math.min(1, Math.max(0, uv.getY(i)));
      if (flip) v = 1 - v; // the atlas is unflipped (glTF convention)
      uv.setXY(i, cx / grid + o + u * s0, cy / grid + o + v * s0);
    }
    return geo;
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) return; // mismatched attributes: keep the parts
  let map = null;
  if (atlas) {
    map = new THREE.CanvasTexture(atlas);
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; map.anisotropy = 4;
  }
  const mesh = new THREE.Mesh(merged, celMaterial({ map }));
  mesh.frustumCulled = false;
  for (const m of meshes) { m.parent.remove(m); m.material.map?.dispose(); m.material.dispose(); }
  scene.add(mesh);
}

// Texture seams: Tripo atlases leave the background (near-white) right up
// to each UV island, and filtering/mipmaps bleed it in as white fringes
// along garment seams. Rasterize the mesh's own UV triangles into a mask
// and push the island colors a few pixels outward over the background.
// Once per piece template, at load.
function dilateMap(mesh, size = 1024) {
  const map = mesh.material.map, img = map?.image, uv = mesh.geometry.attributes.uv;
  if (!img || !uv) return;
  const sc = Math.min(1, size / img.width), W = Math.round(img.width * sc), H = Math.round(img.height * sc);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const mk = document.createElement("canvas"); mk.width = W; mk.height = H;
  const m = mk.getContext("2d", { willReadFrequently: true });
  m.fillStyle = "#fff"; m.strokeStyle = "#fff"; m.lineWidth = 1.5;
  const idx = mesh.geometry.index?.array, n = idx ? idx.length : uv.count;
  const P = i => [uv.getX(i) * W, (map.flipY ? 1 - uv.getY(i) : uv.getY(i)) * H];
  m.beginPath();
  for (let t = 0; t < n; t += 3) {
    const [a, b, c] = [0, 1, 2].map(k => P(idx ? idx[t + k] : t + k));
    m.moveTo(a[0], a[1]); m.lineTo(b[0], b[1]); m.lineTo(c[0], c[1]); m.closePath();
  }
  m.fill(); m.stroke();
  const id = g.getImageData(0, 0, W, H), px = id.data;
  const mask = m.getImageData(0, 0, W, H).data;
  // grow outward ring by ring from the island edges (only the frontier is
  // visited, so it costs ~ the edge length, not the texture area)
  const inside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inside[i] = mask[i * 4 + 3] > 0 ? 1 : 0;
  let front = [];
  for (let i = 0; i < W * H; i++) {
    if (inside[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && inside[i - 1]) || (x < W - 1 && inside[i + 1]) || (y > 0 && inside[i - W]) || (y < H - 1 && inside[i + W])) front.push(i);
  }
  for (let pass = 0; pass < 6 && front.length; pass++) {
    const done = [];
    for (const i of front) {
      if (inside[i]) continue;
      const x = i % W;
      let r = 0, gg = 0, b = 0, k = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H || inside[j] !== 1) continue;
        r += px[j * 4]; gg += px[j * 4 + 1]; b += px[j * 4 + 2]; k++;
      }
      if (k) { px[i * 4] = r / k; px[i * 4 + 1] = gg / k; px[i * 4 + 2] = b / k; done.push(i); }
    }
    const next = [];
    for (const i of done) inside[i] = 2; // filled this pass (a source from the next)
    for (const i of done) {
      inside[i] = 1;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && !inside[j]) next.push(j);
    }
    front = next;
  }
  g.putImageData(id, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = map.flipY; tex.wrapS = map.wrapS; tex.wrapT = map.wrapT;
  tex.anisotropy = 4;
  mesh.material.map = tex;
  mesh.material.needsUpdate = true;
}

// Chunky sneakers: each shoe grows 18% wider/longer and 12% taller about
// its own sole center, sole kept on the ground. Once per shoe template.
const SHOE_GROW = [1.18, 1.12];
function chunkyShoes(scene, key) {
  const jig = attachWrapper(scene, key);
  jig.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  const pts = [];
  jig.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push([o, i, v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone()]);
  });
  const side = { [-1]: { c: new THREE.Vector3(), n: 0, minY: Infinity }, [1]: { c: new THREE.Vector3(), n: 0, minY: Infinity } };
  for (const [, , p] of pts) {
    const sd = side[p.x < 0 ? -1 : 1];
    sd.c.add(p); sd.n++; sd.minY = Math.min(sd.minY, p.y);
  }
  for (const k of [-1, 1]) if (side[k].n) side[k].c.divideScalar(side[k].n);
  const touched = new Set(), invs = new Map();
  for (const [o, i, p] of pts) {
    if (!invs.has(o)) invs.set(o, o.matrixWorld.clone().invert());
    const sd = side[p.x < 0 ? -1 : 1];
    p.x = sd.c.x + (p.x - sd.c.x) * SHOE_GROW[0];
    p.z = sd.c.z + (p.z - sd.c.z) * SHOE_GROW[0];
    p.y = sd.minY + (p.y - sd.minY) * SHOE_GROW[1];
    p.applyMatrix4(invs.get(o));
    o.geometry.attributes.position.setXYZ(i, p.x, p.y, p.z);
    touched.add(o.geometry);
  }
  for (const g of touched) { g.attributes.position.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); }
}

// Fit a hair piece to the head once, on its shared template geometry:
// - drop the face/skull shell some generations include (triangles lying
//   on the face below the hairline);
// - fold any fringe that hangs past the brows back up above the eyes;
// - pull the shell in toward the scalp (snug: no gap at the temples).
//   The scalp underneath is painted the hair color, so a little overlap
//   never shows skin.
function fitHair(scene, key) {
  const h = T.head;
  if (!h) return;
  const jig = attachWrapper(scene, key);
  jig.updateWorldMatrix(true, true);
  const up = new THREE.Vector3(0, 1, 0);
  const ax = new THREE.Vector3().crossVectors(up, h.dir).normalize();
  const browY = h.eyeY + 0.135 * h.unit; // just over the lash line
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  jig.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry, pos = geo.attributes.position, n = pos.count;
    const inv = o.matrixWorld.clone().invert();
    const onFace = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      d.copy(v).sub(h.C);
      const dist = d.length(), depth = d.dot(h.dir) / Math.max(1e-6, dist);
      const lat = Math.abs(d.dot(ax));
      onFace[i] = depth > 0.25 && v.y < browY + 0.05 * h.R && dist < 1.12 * h.R ? 1 : 0;
      // in front of the face, below the brows: a fringe in the middle folds
      // up above the eyes; face-framing locks further out are pushed
      // sideways clear of the eyes (they keep their length)
      if (depth > 0.3 && v.y < browY && v.y > h.eyeY - 0.9 * h.R) {
        if (lat < 0.42 * h.R) v.y = browY - (browY - v.y) * 0.12;
        else if (lat < 0.95 * h.R) {
          const sgn = Math.sign(d.dot(ax)) || 1;
          v.addScaledVector(ax, sgn * (0.95 * h.R - lat));
        }
      }
      // snug: above the ears, shells float off the skull
      if (v.y > h.eyeY - 0.25 * h.R && dist > 1.06 * h.R) {
        d.copy(v).sub(h.C);
        const dd = d.length();
        v.copy(h.C).addScaledVector(d, (1.06 * h.R + (dd - 1.06 * h.R) * 0.82) / dd);
      }
      v.applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    const idx = geo.index ? Array.from(geo.index.array) : [...Array(n).keys()];
    const kept = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (onFace[idx[t]] && onFace[idx[t + 1]] && onFace[idx[t + 2]]) continue;
      kept.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    geo.setIndex(kept);
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    smoothNormals(geo); // welded + relaxed: no cel blotches on lumpy shells
  });
}

// per-style correction table (raw garment-frame units; pieces are
// zero-centered, body is 1.0 tall). lift: f2 rides low. yaw: f5's GLB
// exports facing backwards — its curtain hung over the face. trim: f2's
// fringe hangs to the nose — clip the central fringe triangles below brow
// height in the raw frame (raw "front" is the +T.yaw direction).
const PIECE_LIFT = { "hair/f2": 0.02 };
const PIECE_YAW = { "hair/m2": Math.PI }; // m2 exports facing backwards
const PIECE_TRIM = { "hair/f2": { yBelow: 0.335, front: 0.03, halfWidth: 0.12 } };

function attachWrapper(scene, pieceKey) {
  const clone = scene.clone(true);
  clone.traverse(o => {
    if (o.isMesh) o.material = o.material.clone();
  });
  // garment GLBs live in a zero-centered Tripo frame; the rigged body's
  // frame may be offset — move pieces into the body's frame, then match
  // its yaw so they turn with the face
  const inner = new THREE.Group();
  inner.add(clone);
  inner.rotation.y = -T.yaw + (PIECE_YAW[pieceKey] ?? 0);
  inner.position.copy(T.srcCenter); // then step into the body's frame
  inner.position.y += PIECE_LIFT[pieceKey] ?? 0;
  const wrap = new THREE.Group();
  wrap.scale.setScalar(T.fitScale);
  wrap.position.copy(T.fitOffset);
  wrap.add(inner);
  return wrap;
}

function buildHumanApi(cfg) {
  const group = new THREE.Group();
  let disposed = false;
  // Every rebuild bumps the epoch; async attachment loads capture theirs and
  // bail if another rebuild happened meanwhile. (A config-VALUE compare is
  // not enough: an A→B→A flip lets the stale in-flight A-load attach twice.)
  let epoch = 0;
  // per-build GPU resources we created (materials, face-patch tex/geo) —
  // freed on the next rebuild and on dispose. Shared template resources
  // (piece geometries, skin/hair texture caches, decals) are never freed.
  let owned = [];
  const disposeOwned = () => { for (const r of owned) r.dispose?.(); owned = []; };

  // settles once this build's attachments have loaded (or failed)
  let ready = Promise.resolve();
  let bodyMats = [], expr = "neutral";
  const rebuild = () => {
    const myEpoch = ++epoch;
    disposeOwned();
    group.clear();
    bodyMats = [];
    // body (static clone of the template) — swap in the tone texture.
    // castShadow is set HERE, not just by the world at spawn: rebuild()
    // replaces the meshes, so spawn-time flags are lost on outfit changes.
    const body = T.fit.clone(true);
    body.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.material = celMaterial({ face: faceFor(cfg, expr), paint: paintFor(cfg) });
        bodyMats.push(o.material);
        o.frustumCulled = false;
        o.castShadow = true;
        o.userData.part = "body";
        owned.push(o.material); // map is the shared tone cache — material only
      }
    });
    group.add(body);
    // attachments — async-load then attach if this build is still current
    const want = [];
    if (cfg.hair !== "none") want.push(["hair", cfg.hair]);
    if (cfg.top !== "none") want.push(["top", cfg.top]);
    if (cfg.bottom !== "none") want.push(["bottom", cfg.bottom]);
    if (cfg.shoes !== "none") want.push(["shoes", cfg.shoes]);
    ready = Promise.all(want.map(([cat, id]) =>
      loadPiece(cat, id).then(scene => {
        if (disposed || myEpoch !== epoch) return;
        const wrap = attachWrapper(scene, `${cat}/${id}`);
        if (cat === "hair") tintHair(wrap, cfg.hairColor);
        wrap.traverse(o => {
          if (o.isMesh) { o.castShadow = true; o.userData.part = cat; owned.push(o.material); }
        });
        group.add(wrap);
      }).catch(() => {}))).then(() => {});
  };
  rebuild();

  return {
    group,
    get ready() { return ready; },
    get config() { return { ...cfg }; },
    setConfig(next) {
      cfg = normalizeAvatar3({ ...cfg, ...next });
      rebuild();
    },
    // swap the face texture: neutral, smile, smirk, surprised, wink, laugh
    setExpression(name) {
      expr = EXPRESSIONS.includes(name) || name === "blink" ? name : "neutral";
      for (const m of bodyMats) setFace(m, faceFor(cfg, expr));
    },
    get expression() { return expr; },
    dispose() {
      disposed = true;
      epoch++;          // orphan any in-flight attachment loads
      disposeOwned();
      group.clear();
    },
    walking: false,
    phase: Math.random() * Math.PI * 2,
    tick(t) { // same body language contract as the blob
      const p = t * (this.walking ? 9 : 2) + this.phase;
      const s = Math.sin(p);
      if (this.walking) {
        group.position.y = Math.abs(s) * 0.5;
        group.rotation.z = s * 0.05;
      } else {
        group.position.y = s * 0.14;
        group.rotation.z = 0;
      }
    },
  };
}

// ---------------- animated-body mode ----------------
// body.glb kept skinned and moved procedurally (applyMotion); garments
// follow the skeleton via runtime skin-weight transfer from the nearest
// body vertex (hair: the head bone), so every cosmetic combination
// animates without per-outfit rigging. The map uses this build.
let animPromise = null;
let AT = null; // { scene, bodyMesh, face }

export function loadAnimTemplate() {
  if (animPromise) return animPromise;
  animPromise = (async () => {
    await loadHumanTemplate(); // head frame / piece cache / shaped geometry
    // The same body.glb, kept skinned. (The Tripo idle/walk clips are
    // retired: retargeted onto this rig they bent the knees with the feet
    // trailing, so everyone hovered in a kneel. Motion is procedural on
    // this skeleton now, from its straight rest pose.)
    const g = await loader.loadAsync(`${BASE}/body.glb`);
    const scene = g.scene;
    scene.updateWorldMatrix(true, true);
    let bodyMesh = null;
    scene.traverse(o => { if (o.isSkinnedMesh && !bodyMesh) bodyMesh = o; });
    if (!bodyMesh) throw new Error("body.glb has no skinned mesh");
    // share the static template's processed geometry (same file, same
    // vertex order): face UVs, painted regions, the slimmer shape
    let tg = null;
    T.fit.traverse(o => { if (o.isMesh && !tg) tg = o.geometry; });
    if (tg?.attributes.skinIndex && tg.attributes.position.count === bodyMesh.geometry.attributes.position.count) {
      bodyMesh.geometry = tg;
    } else analyzeFace(scene);
    AT = { scene, bodyMesh, face: T.face };
    return AT;
  })();
  return animPromise;
}

// copy skinIndex/skinWeight from the nearest body vertex onto a garment
// mesh and bind it to the body's skeleton. Both inputs must have live
// world matrices; the garment geometry is rebuilt in the body's LOCAL
// (bind) frame so the skinning math matches the body exactly.
function skinToBody(garmentMesh, bodySkinned, rigidBone = -1) {
  const gGeo = garmentMesh.geometry.clone();
  const gPos = gGeo.attributes.position;
  const bGeo = bodySkinned.geometry;
  const bPos = bGeo.attributes.position;
  const bIdx = bGeo.attributes.skinIndex;
  const bWt = bGeo.attributes.skinWeight;
  // body verts to world once, into a coarse spatial hash
  const bWorld = new Float32Array(bPos.count * 3);
  const v = new THREE.Vector3();
  const cell = 0.9; // world units (~15-unit body): fine enough, cheap enough
  const hash = new Map();
  const keyOf = (x, y, z) =>
    `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  for (let i = 0; i < bPos.count; i++) {
    v.fromBufferAttribute(bPos, i).applyMatrix4(bodySkinned.matrixWorld);
    bWorld[i * 3] = v.x; bWorld[i * 3 + 1] = v.y; bWorld[i * 3 + 2] = v.z;
    const k = keyOf(v.x, v.y, v.z);
    let arr = hash.get(k);
    if (!arr) hash.set(k, arr = []);
    arr.push(i);
  }
  const nearest = (x, y, z) => {
    let best = -1, bd = Infinity;
    const cx = Math.round(x / cell), cy = Math.round(y / cell), cz = Math.round(z / cell);
    for (let r = 0; r < 4 && best < 0; r++) { // grow the ring until a hit
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const arr = hash.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!arr) continue;
        for (const i of arr) {
          const ddx = bWorld[i * 3] - x, ddy = bWorld[i * 3 + 1] - y, ddz = bWorld[i * 3 + 2] - z;
          const d = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best;
  };
  const inv = new THREE.Matrix4().copy(bodySkinned.matrixWorld).invert();
  const idx = new Uint16Array(gPos.count * 4);
  const wt = new Float32Array(gPos.count * 4);
  for (let i = 0; i < gPos.count; i++) {
    v.fromBufferAttribute(gPos, i).applyMatrix4(garmentMesh.matrixWorld);
    const n = rigidBone >= 0 ? -1 : nearest(v.x, v.y, v.z);
    if (rigidBone >= 0) { idx[i * 4] = rigidBone; wt[i * 4] = 1; }
    else if (n >= 0) {
      for (let c = 0; c < 4; c++) {
        idx[i * 4 + c] = bIdx.getComponent(n, c);
        wt[i * 4 + c] = bWt.getComponent(n, c);
      }
    } else { wt[i * 4] = 1; }
    // rebuild the vertex in the body's local frame
    v.applyMatrix4(inv);
    gPos.setXYZ(i, v.x, v.y, v.z);
  }
  gGeo.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  gGeo.setAttribute("skinWeight", new THREE.BufferAttribute(wt, 4));
  const sm = new THREE.SkinnedMesh(gGeo, garmentMesh.material);
  sm.frustumCulled = false;
  sm.castShadow = true;
  return sm; // caller binds: sm.bind(skeleton, bindMatrix) + parents it
}

// Rebuild the skeleton where the body actually is. Tripo's bones sit
// mirrored and offset from the joints they move (their inverse bind
// matrices hide it at rest, but any rotation swings limbs about the wrong
// pivots — the old clips bent knees backwards). Each bone is moved to its
// joint as the skin weights show it (the seam where its vertices hand over
// from its parent), with no rotation or scale, parented straight into the
// character's frame; then the mesh is re-bound to it. At rest nothing
// moves; rotations now pivot at real joints, in the character's own axes.
function cleanRig(sm, frame) {
  const bones = sm.skeleton.bones;
  const geo = sm.geometry, pos = geo.attributes.position;
  const sI = geo.attributes.skinIndex, sW = geo.attributes.skinWeight;
  frame.updateMatrixWorld(true);
  const toFrame = new THREE.Matrix4().copy(frame.matrixWorld).invert().multiply(sm.matrixWorld);
  const n = pos.count;
  const P = Array.from({ length: n }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toFrame));
  const parentIdx = bones.map(b => bones.indexOf(b.parent));
  const sums = bones.map(() => ({ seam: new THREE.Vector3(), ns: 0, all: new THREE.Vector3(), na: 0 }));
  for (let i = 0; i < n; i++) {
    const w = [0, 1, 2, 3].map(c => [sI.getComponent(i, c), sW.getComponent(i, c)]);
    for (const [j, wt] of w) {
      if (wt <= 0) continue;
      sums[j].all.addScaledVector(P[i], wt); sums[j].na += wt;
      // a seam vertex: shared with this bone's parent
      const pj = parentIdx[j];
      const wp = w.find(([k]) => k === pj)?.[1] ?? 0;
      if (pj >= 0 && wt > 0.15 && wp > 0.15) { sums[j].seam.add(P[i]); sums[j].ns++; }
    }
  }
  const pivot = bones.map(() => null);
  const pivotOf = j => {
    if (pivot[j]) return pivot[j];
    const sm_ = sums[j], pj = parentIdx[j];
    if (sm_.ns >= 3) pivot[j] = sm_.seam.clone().divideScalar(sm_.ns);
    else if (pj < 0) pivot[j] = sm_.na ? sm_.all.clone().divideScalar(sm_.na) : new THREE.Vector3();
    else {
      // no seam: the end of its own vertices nearest the parent's joint
      const pp = pivotOf(pj);
      if (!sm_.na) pivot[j] = pp.clone();
      else {
        const c = sm_.all.clone().divideScalar(sm_.na);
        pivot[j] = pp.clone().lerp(c, 0.35);
      }
    }
    return pivot[j];
  };
  bones.forEach((_, j) => pivotOf(j));
  for (let j = 0; j < bones.length; j++) {
    const b = bones[j], pj = parentIdx[j];
    if (pj < 0) { b.parent?.remove(b); frame.add(b); }
    b.quaternion.identity();
    b.scale.set(1, 1, 1);
    b.position.copy(pivot[j]).sub(pj >= 0 ? pivot[pj] : new THREE.Vector3());
  }
  frame.updateMatrixWorld(true);
  sm.skeleton.calculateInverses();
  sm.bind(sm.skeleton, sm.matrixWorld);
}

function buildAnimApi(cfg) {
  const group = new THREE.Group();
  let disposed = false;
  let epoch = 0;
  let owned = [];
  const disposeOwned = () => { for (const r of owned) r.dispose?.(); owned = []; };

  // fit the animated scene exactly like the static template: same height,
  // feet on ground, face already yawed by the shared T numbers (the anim
  // GLBs come from the same source body, so T's fit transform applies)
  const rig = SkeletonUtils.clone(AT.scene);
  const fit = new THREE.Group();
  fit.add(rig);
  fit.rotation.y = -T.yaw;

  let bodySkinned = null;
  rig.traverse(o => { if (o.isSkinnedMesh && !bodySkinned) bodySkinned = o; });
  const headBone = bodySkinned.skeleton.bones.findIndex(b => /Head_2/.test(b.name));

  // Same body.glb as the static template, placed by the same numbers.
  // Then RE-BIND the skin to the skeleton exactly as it now stands (its
  // rest pose): Tripo's inverse bind matrices don't match its own node
  // tree, which rendered the skinned body half a body low and made bone
  // rotations swing about the wrong pivots. Re-bound, skinning at rest is
  // the identity and the bones live in the character's own frame.
  const s = T.fitScale;
  fit.scale.setScalar(s);
  fit.position.copy(T.fitOffset);
  group.add(fit);
  group.updateMatrixWorld(true);
  cleanRig(bodySkinned, group);

  // the rigged body's proportions shift slightly vs the static template —
  // hair jigged with static numbers lands low on this head. Lift it by the
  // measured world-space face-height difference between the two templates.
  const staticFaceY = T.face ? T.face.C.y * T.fitScale + T.fitOffset.y : 0;
  const animFaceY = AT.face ? AT.face.C.y * s + fit.position.y : staticFaceY;
  // (same body.glb as the static build now, so this is ~0; kept as a guard)
  const headLift = animFaceY - staticFaceY;

  let ready = Promise.resolve();
  let bodyMat = null, expr = "neutral";
  const rebuild = () => {
    const myEpoch = ++epoch;
    disposeOwned();
    // strip previous garments/decals (children tagged as attachments)
    for (const c of [...group.children]) if (c.userData.attachment) group.remove(c);
    for (const c of [...(bodySkinned?.parent?.children ?? [])]) {
      if (c.userData.attachment) c.parent.remove(c);
    }
    if (bodySkinned) {
      bodySkinned.material = bodyMat = celMaterial({ face: faceFor(cfg, expr), paint: paintFor(cfg) });
      bodySkinned.frustumCulled = false;
      bodySkinned.castShadow = true;
      bodySkinned.userData.part = "body";
      owned.push(bodySkinned.material);
    }
    const want = [];
    if (cfg.hair !== "none") want.push(["hair", cfg.hair]);
    if (cfg.top !== "none") want.push(["top", cfg.top]);
    if (cfg.bottom !== "none") want.push(["bottom", cfg.bottom]);
    if (cfg.shoes !== "none") want.push(["shoes", cfg.shoes]);
    ready = Promise.all(want.map(([cat, id]) =>
      loadPiece(cat, id).then(scene => {
        if (disposed || myEpoch !== epoch) return;
        const wrap = attachWrapper(scene, `${cat}/${id}`);
        if (cat === "hair") tintHair(wrap, cfg.hairColor);
        // position the wrap inside fit (shares the static template's
        // source-frame math), then convert each mesh to a skinned copy
        // attachWrapper output is already WORLD-fitted (static template
        // numbers) — jig it at group level, NOT under the anim fit, or it
        // double-transforms. Both fits normalize to the same world pose.
        wrap.userData.attachment = true;
        if (cat === "hair") wrap.position.y += headLift;
        group.add(wrap);
        wrap.updateWorldMatrix(true, true);
        bodySkinned.updateWorldMatrix(true, true);
        const skinned = [];
        wrap.traverse(o => {
          if (!o.isMesh) return;
          owned.push(o.material);
          // hair and headwear ride the head bone rigidly (nearest-vertex
          // weights let long hair pick up chest and arm bones and smear)
          const sm = skinToBody(o, bodySkinned, cat === "hair" ? headBone : -1);
          owned.push(sm.geometry);
          sm.material = o.material;
          skinned.push(sm);
        });
        for (const sm of skinned) {
          // geometry was baked into the body mesh's LOCAL frame — the
          // garment must render through the SAME node matrix (Tripo rigs
          // carry big mesh-node transforms; a plain sibling would miss
          // them). Copy the body's local matrix verbatim.
          sm.userData.attachment = true;
          sm.userData.part = cat;
          sm.matrixAutoUpdate = false;
          sm.matrix.copy(bodySkinned.matrix);
          bodySkinned.parent.add(sm);
          sm.bind(bodySkinned.skeleton, bodySkinned.bindMatrix);
        }
        group.remove(wrap); // static wrap was only a positioning jig
      }).catch(() => {}))).then(() => {});
  };
  rebuild();

  // ---- motion: procedural, on the rig, from its straight rest pose ----
  const bones = bodySkinned.skeleton.bones;
  const boneBy = re => bones.find(b => re.test(b.name)) ?? null;
  const rest = new Map(bones.map(b => [b, b.quaternion.clone()]));
  group.updateMatrixWorld(true);
  // which limb chain is on the character's +x side (names can't be trusted
  // to agree with the facing): compare where the thigh/upper arm sit
  const gInv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const sideOf = b => b ? Math.sign(b.getWorldPosition(new THREE.Vector3()).applyMatrix4(gInv).x) || 1 : 1;
  const chain = (re, n) => Array.from({ length: n }, (_, k) => boneBy(new RegExp(re + k + "$")));
  const legL = chain("1_Left_Limb_", 3), legR = chain("1_Right_Limb_", 3);
  const armL = chain("0_Left_Limb_", 2), armR = chain("0_Right_Limb_", 2);
  // a = the leg on the character's +x side; b = the other
  const [legA, legB] = sideOf(legL[0]) > 0 ? [legL, legR] : [legR, legL];
  const [armA, armB] = sideOf(armL[0]) > 0 ? [armL, armR] : [armR, armL];
  const M = {
    spine0: boneBy(/Spine_0/), spine1: boneBy(/Spine_1/),
    neck: boneBy(/Head_0/), head: boneBy(/Head_2/),
    nextBlink: 1.5, blinkUntil: 0, nextNod: 4, nodAt: -10, smileUntil: 0, shownExpr: null,
  };
  const gq = new THREE.Quaternion(), pq = new THREE.Quaternion(), dq = new THREE.Quaternion();
  const euler = new THREE.Euler();
  // rotate a bone by (pitch x, yaw y, roll z) in the CHARACTER's frame
  // (x = its left-right axis, y = up, z = forward), whatever the rig's
  // axes. Parents first: each call refreshes the bone's subtree.
  const turn = (b, x, y, z) => {
    if (!b || (!x && !y && !z)) return;
    group.getWorldQuaternion(gq);
    b.parent.getWorldQuaternion(pq);
    const rel = gq.invert().multiply(pq); // parent, in the character frame
    dq.setFromEuler(euler.set(x, y, z, "YXZ"));
    dq.premultiply(rel.clone().invert()).multiply(rel);
    b.quaternion.premultiply(dq);
    b.updateMatrixWorld(true);
  };
  const STRIDE = 7.5; // walk phase, rad/s: a step every ~0.42 s
  // w = how much walk is blended in (0 idle .. 1 walk); p = walk phase
  // Idle (swagger): weight on the -x leg, the other knee relaxed forward;
  // upper body leaning off the hip, chest up, shoulders loose, chin a
  // touch up and head cocked; a slow breathing sway, and every few seconds
  // a little double nod (with a smile, see faceTick).
  // Walk: thighs swing, knees fold on the way through, arms swing against
  // the legs, shoulders twist, head steadies, a springy bounce.
  const applyMotion = (t, w, p) => {
    for (const [b, q] of rest) b.quaternion.copy(q);
    group.updateMatrixWorld(true);
    const i = 1 - w;
    const sway = Math.sin(t * 1.15);
    const since = t - M.nodAt;
    const nod = since >= 0 && since < 0.9 ? Math.sin(since / 0.45 * Math.PI) ** 2 * 0.16 : 0;
    const sA = Math.sin(p), sB = Math.sin(p + Math.PI);
    const fold = x => Math.max(0, x); // knees only bend one way
    // torso
    turn(M.spine0, -0.02 * w, w * sA * 0.08 + i * 0.06, i * (0.1 + sway * 0.015) + w * sA * 0.03);
    turn(M.spine1, -0.05 * i - 0.04 * w, w * sA * 0.14, -i * 0.05 + w * sA * 0.04);
    turn(M.neck, (-0.06 + nod * 0.5) * i - 0.04 * w, -w * sA * 0.1, 0);
    turn(M.head, (-0.08 + nod) * i - 0.02 * w, i * (sway * 0.03 - 0.06), i * 0.09 - w * sA * 0.03);
    // legs (character frame: -x pitch swings a foot forward, +x folds a knee)
    turn(legA[0], i * -0.2 + w * -0.42 * sA, i * 0.2, i * 0.07);
    turn(legA[1], i * 0.4 + w * (0.08 + 0.75 * fold(Math.sin(p - 0.9))), 0, 0);
    turn(legA[2], i * -0.2 + w * 0.25 * fold(-sA), 0, 0);
    turn(legB[0], w * -0.42 * sB, 0, i * -0.02);
    turn(legB[1], w * (0.08 + 0.75 * fold(Math.sin(p + Math.PI - 0.9))), 0, 0);
    turn(legB[2], w * 0.25 * fold(-sB), 0, 0);
    // arms: loose at the sides in idle, swinging against the legs in walk
    turn(armA[0], w * 0.45 * sB + i * (0.06 + sway * 0.02), 0, 0.1 * i);
    turn(armA[1], -0.2 - w * 0.25 * fold(-sB), 0, 0);
    turn(armB[0], w * 0.45 * sA + i * (0.02 - sway * 0.02), 0, -0.12 * i);
    turn(armB[1], -0.15 - w * 0.25 * fold(-sA), 0, 0);
    // bounce: a breath in idle, a springy step (twice per stride) in walk
    group.position.y = i * (0.03 + sway * 0.03) + w * 0.38 * Math.abs(Math.sin(p));
  };
  const faceTick = (t, walking) => {
    if (t > M.nextBlink) { M.blinkUntil = t + 0.12; M.nextBlink = t + 2.2 + Math.random() * 3; }
    if (!walking && t > M.nextNod) {
      M.nodAt = t; M.smileUntil = t + 1.6; M.nextNod = t + 6 + Math.random() * 5;
    }
    // a set expression (setExpression) wins; neutral gets blinks and smiles
    let show = expr;
    if (expr === "neutral") show = t < M.blinkUntil ? "blink" : t < M.smileUntil ? "smile" : "neutral";
    if (show !== M.shownExpr) { M.shownExpr = show; setFace(bodyMat, faceFor(cfg, show)); }
  };
  applyMotion(0, 0, 0);

  let lastT = null, walkW = 0, walkP = 0;
  const IDLE_LEN = 4, WALK_LEN = Math.PI * 2 / STRIDE;
  return {
    group,
    get ready() { return ready; },
    // sprite baking: a pose at a moment of the idle or walk cycle
    pose(clip, t) {
      const walk = clip === "walk";
      applyMotion(t, walk ? 1 : 0, walk ? t / WALK_LEN * Math.PI * 2 : 0);
      return true;
    },
    clipLength(clip) { return clip === "walk" ? WALK_LEN : IDLE_LEN; },
    __rig: () => ({ turn, bones, rest, legA, legB, armA, armB, M, group }), // dev harness only
    get config() { return { ...cfg }; },
    setConfig(next) {
      cfg = normalizeAvatar3({ ...cfg, ...next });
      rebuild();
    },
    setExpression(name) {
      expr = EXPRESSIONS.includes(name) || name === "blink" ? name : "neutral";
      M.shownExpr = expr;
      setFace(bodyMat, faceFor(cfg, expr));
    },
    get expression() { return expr; },
    // react to something (equip, a win): a quick expression, then back
    react(name = "smile", secs = 1.2) {
      this.setExpression(name);
      clearTimeout(M.reactT);
      M.reactT = setTimeout(() => !disposed && this.setExpression("neutral"), secs * 1000);
      M.nodAt = lastT ?? 0;
    },
    dispose() {
      disposed = true;
      clearTimeout(M.reactT);
      epoch++;
      disposeOwned();
      group.clear();
    },
    walking: false,
    phase: Math.random() * Math.PI * 2,
    tick(t) {
      const dt = lastT === null ? 0.016 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      walkW += ((this.walking ? 1 : 0) - walkW) * Math.min(1, dt / 0.2);
      walkP += dt * STRIDE * Math.min(1, walkW * 1.5 + 0.2);
      applyMotion(t, walkW, walkP);
      faceTick(t, this.walking);
    },
  };
}

export async function makeAnimatedCharacter(rawCfg) {
  await loadAnimTemplate();
  return buildAnimApi(normalizeAvatar3(rawCfg));
}

export const __debugT = () => T; // dev harness introspection only

export async function makeHumanCharacter(rawCfg) {
  await loadHumanTemplate();
  return buildHumanApi(normalizeAvatar3(rawCfg));
}

// sync path for spawn loops; null until the template resolves — callers
// fall back to the procedural blob (same pattern as the GLB mode)
export function makeHumanCharacterSync(rawCfg) {
  return T ? buildHumanApi(normalizeAvatar3(rawCfg)) : null;
}

// 2D identity thumb for chat headers / cards: skin-tone disc, hair cap and
// the drawn face. Synchronous.
export function avatarThumb3(rawCfg, size = 128) {
  const cfg = normalizeAvatar3(rawCfg);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const skin = SKIN_RGB[cfg.skin] ?? SKIN_BASE;
  g.fillStyle = `rgb(${skin[0]},${skin[1]},${skin[2]})`;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  g.fill();
  const hair = HAIR_RGB[cfg.hairColor] ?? [90, 80, 76];
  if (cfg.hair !== "none") { // simple cap arc suggests the hair color
    g.fillStyle = `rgb(${hair[0]},${hair[1]},${hair[2]})`;
    g.beginPath();
    g.arc(size / 2, size / 2 - size * 0.04, size * 0.43, Math.PI * 1.05, Math.PI * 1.95);
    g.fill();
  }
  // the same face the 3D head wears, scaled so its eyes fill the disc
  g.save();
  g.translate(size / 2, size * 0.5);
  const fs = size * 1.15;
  g.translate(-fs / 2, -fs * EYE_Y);
  drawFace(g, fs, { style: cfg.face, iris: cfg.iris, expr: "smile",
    brow: cfg.hair === "none" ? [70, 52, 46] : HAIR_RGB[cfg.hairColor] });
  g.restore();
  return cv.toDataURL();
}

// 3D item thumbnails for the style screen: the piece on its own, cel
// shaded, framed to its bounds, rendered once into a data URL (cached per
// piece + tint). One small offscreen renderer, one render at a time.
const thumbCache = new Map();
let thumbR = null, thumbQ = Promise.resolve();
export function pieceThumb(cat, id, { hairColor = "brown", size = 160 } = {}) {
  const key = `${cat}/${id}/${cat === "hair" ? hairColor : ""}/${size}`;
  if (!thumbCache.has(key)) {
    thumbCache.set(key, thumbQ = thumbQ.catch(() => {}).then(async () => {
      await loadHumanTemplate();
      const scene0 = await loadPiece(cat, id);
      if (!thumbR) {
        thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbR.outputColorSpace = THREE.SRGBColorSpace;
      }
      thumbR.setSize(size, size, false);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xeef3ff, 0x5a6aa8, 2.4));
      const key2 = new THREE.DirectionalLight(0xfff3dc, 1.8); key2.position.set(4, 10, 12); scene.add(key2);
      const rim2 = new THREE.DirectionalLight(0xffd57a, 1.4); rim2.position.set(-6, 6, -8); scene.add(rim2);
      const wrap = attachWrapper(scene0, `${cat}/${id}`);
      if (cat === "hair") tintHair(wrap, hairColor);
      scene.add(wrap);
      wrap.rotation.y = cat === "shoes" ? -0.6 : cat === "hair" ? 0.5 : 0.3;
      wrap.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(wrap), c = new THREE.Vector3(), sz = new THREE.Vector3();
      box.getCenter(c); box.getSize(sz);
      const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
      const el = cat === "shoes" ? 0.55 : 0.12;
      cam.position.set(c.x, c.y + r * 4 * el, c.z + r / Math.tan(15 * Math.PI / 180));
      cam.lookAt(c);
      // compile off the main thread where the GPU allows (parallel shader
      // compile): the first thumbnail used to stall the page for seconds
      await thumbR.compileAsync?.(scene, cam);
      thumbR.render(scene, cam);
      const url = thumbR.domElement.toDataURL("image/png");
      wrap.traverse(o => { if (o.isMesh) o.material.dispose(); });
      return url;
    }));
  }
  return thumbCache.get(key);
}
