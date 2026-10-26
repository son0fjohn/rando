// Rando avatar v4: the new player character. One shared, gender-neutral
// base (avatar4/base.glb: big round head, lanky, mitten hands, a bald body
// in a tee + shorts underlayer), rigged with a clean humanoid skeleton
// (20 joints, identity rest rotations, +z forward, the character's left on
// +x). Matte clay shading, no outlines. Everything is a code tint:
//   - skin (8 tones), the underlayer tee and shorts: one region-mask
//     texture (R skin, G tee, B shorts) mixes the colors in the shader;
//   - the face (face4.js): drawn on a canvas and mapped onto the head
//     through its own UV set (TEXCOORD_1, weighted by _FACEW), so the eyes
//     are part of the head's surface, lit and skinned with it, and swap or
//     tint without touching the mesh;
//   - items (avatar4/items/*.glb): fitted and skinned offline to the same
//     joints, bound to this skeleton at load, tinted by a key-color mask.
// Motion is procedural on the skeleton (idle sway + walk), the same API as
// avatar3's animated build: { group, ready, pose, clipLength, config,
// setConfig, setExpression, expression, react, dispose, walking, phase,
// tick }.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "https://esm.sh/three@0.160.0/examples/jsm/utils/SkeletonUtils.js";
import { faceTexture4, drawFace4, EXPRESSIONS4, EXPR_ALIAS } from "./face4.js";

const BASE = new URL("./avatar4/", import.meta.url).href;
const CHAR_H = 15;

import { ITEMS4, HAIR4_RGB, SKIN4_RGB, SLOTS4, PART_OPTIONS4, DEFAULT_AVATAR4, normalizeAvatar4, EMOTES4, LAYER4 } from "./items4.js";
export { ITEMS4, HAIR4_RGB, SKIN4_RGB, SLOTS4, PART_OPTIONS4, DEFAULT_AVATAR4, normalizeAvatar4, EMOTES4 };
const TEE_RGB = [214, 214, 216], SHORTS_RGB = [150, 152, 158];

const lin = (rgb, out = new THREE.Color()) => out.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);

// test hook (test/glitch4.html): 0 = normal; 1 = every layer in a flat ID
// colour (R part, G body region); 2 = view depth packed into RGB (1/100
// world units per 2^24). Shared by every avatar4 material.
export const DEBUG4 = { mode: { value: 0 }, fit: () => ({ scalpAt, HC, fitCache, bodyCovers, bodyAt, bodyCover, headCover }) };
const PART_ID = { body: 1, bottom: 2, top: 3, shoes: 4, neck: 5, hair: 6, facewear: 7, head: 8 };
const DEBUG_FRAG = `
if (uDbg > 0.5) {
  if (uDbg < 1.5) gl_FragColor = vec4(uPartId / 255.0, DBG_G / 255.0, 0.0, 1.0);
  else { float z = clamp(vViewPosition.z / 100.0, 0.0, 1.0) * 16777215.0;
    gl_FragColor = vec4(floor(z / 65536.0) / 255.0, mod(floor(z / 256.0), 256.0) / 255.0, mod(z, 256.0) / 255.0, 1.0); }
}`;
const debugHook = (sh, part, g = "0.0") => {
  sh.uniforms.uDbg = DEBUG4.mode; sh.uniforms.uPartId = { value: PART_ID[part] ?? 9 };
  sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nuniform float uDbg, uPartId;\n#define DBG_G ${g}`)
    .replace("#include <dithering_fragment>", "#include <dithering_fragment>" + DEBUG_FRAG);
};

// ---------------- the clay material ----------------
// Lambert (per-pixel, matte), its map read as the region mask. Clothes hide
// what's under them by discarding body pixels: the tee / shorts regions,
// and bands of the rest pose's height (feet under shoes, the scalp under a
// hat), so nothing pokes through in any pose.
function bodyMaterial(mask) {
  const U = {
    uSkin: { value: new THREE.Color() }, uTee: { value: lin(TEE_RGB) }, uShorts: { value: lin(SHORTS_RGB) },
    uFace: { value: null }, uHide: { value: new THREE.Vector4(0, 0, -1, 9) }, // tee, shorts, below y, above y
    uHideArms: { value: 0 }, uHideLegs: { value: 0 }, uHideEars: { value: 0 }, uScalp: { value: new THREE.Vector4(0, 0, 0, 0) }, // rgb, on
    // where the top / the bottom actually cover the body (round its axis, CY0..CY1): the
    // underlayer is only hidden there, so a wide collar or a short hem never opens a hole
    uCovT: { value: NO_COVER }, uCovB: { value: NO_COVER }, uCovOn: { value: new THREE.Vector2(0, 0) },
  };
  const m = new THREE.MeshLambertMaterial({ map: mask });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    debugHook(sh, "body", "dbgRegion");
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 faceUv; attribute float _facew; varying vec2 vFaceUv; varying float vFaceW; varying vec3 vRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFaceUv = faceUv; vFaceW = _facew; vRest = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uSkin, uTee, uShorts; uniform sampler2D uFace, uCovT, uCovB; uniform vec4 uHide, uScalp; uniform float uHideArms, uHideLegs, uHideEars; uniform vec2 uCovOn;
varying vec2 vFaceUv; varying float vFaceW; varying vec3 vRest;`)
      .replace("#include <map_fragment>", `
vec3 rg = texture2D(map, vMapUv).rgb;
float bodyM = step(vRest.y, 0.76) / max(rg.r + rg.g + rg.b, 1e-3);
float tee = rg.g * bodyM, shorts = rg.b * bodyM;
// arms: out past the shoulders, above the wrists; legs: below the hips
float arm = step(0.115, abs(vRest.x)) * step(0.505, vRest.y) * step(vRest.y, 0.72);
float leg = step(vRest.y, 0.42) * step(abs(vRest.x), 0.13);
// debug region (glitch4): 1 hand, 2 arm, 3 leg, 4 head, 5 torso
float dbgRegion = abs(vRest.x) > 0.2 && vRest.y < 0.56 ? 1.0 : arm > 0.5 ? 2.0 : leg > 0.5 ? 3.0 : vRest.y > 0.76 ? 4.0 : 5.0;
vec2 covUv = vec2(atan(vRest.x, vRest.z) / 6.2831853 + 0.5, (vRest.y - ${CY0.toFixed(3)}) / ${(CY1 - CY0).toFixed(3)});
bool inMap = covUv.y > 0.0 && covUv.y < 1.0;
// (well inside it: at the cloth's edge the underlayer shows, like an undershirt, never a hole)
bool covT = uCovOn.x < 0.5 || !inMap || texture2D(uCovT, covUv).r > 0.95;
bool covB = uCovOn.y < 0.5 || !inMap || texture2D(uCovB, covUv).r > 0.95;
if ((uHide.x > 0.5 && tee > 0.5 && covT && vRest.y < 0.715) || (uHide.y > 0.5 && shorts > 0.5 && covB) || vRest.y < uHide.z || vRest.y > uHide.w
    || (uHideArms > 0.5 && arm > 0.5 && tee + shorts < 0.5) || (uHideLegs > 0.5 && leg > 0.5)
    || (uHideEars > 0.5 && abs(vRest.x) > 0.088 && vRest.y > 0.82 && vRest.y < 0.92)) discard;
vec3 col = uSkin * (1.0 - tee - shorts) + uTee * tee + uShorts * shorts;
// under hair the scalp takes the hair's colour (no skin through gaps between locks)
float ear = step(0.085, abs(vRest.x)) * step(vRest.y, 0.905);
float scalp = uScalp.w * (1.0 - ear) * max(smoothstep(0.935, 0.955, vRest.y - max(vRest.z, 0.0) * 0.4 + 0.02),
  smoothstep(0.0, -0.03, vRest.z) * smoothstep(0.8, 0.83, vRest.y));
col = mix(col, uScalp.rgb, scalp);
if (scalp > 0.5) dbgRegion = 6.0;
vec4 fc = texture2D(uFace, vFaceUv);
col = mix(col, fc.rgb, fc.a * vFaceW * step(0.0, vFaceUv.x) * step(vFaceUv.x, 1.0) * step(0.0, vFaceUv.y) * step(vFaceUv.y, 1.0));
diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => "rando-body4";
  m.userData.U = U;
  return m;
}

// items: their own texture, optionally recolored. tint: [keyRGB, newRGB]
// pairs; each pixel near a key (in chroma + lightness) is moved to the new
// color keeping its shading. hair: the whole texture, by luminance.
function itemMaterial(map, def, cfg, hat = null, edge = false) {
  const keys = [], cols = [];
  const tints = typeof def.tint === "function" ? def.tint(cfg) : def.tint ?? [];
  for (const [k, c] of tints.slice(0, 3)) { keys.push(lin(k)); cols.push(lin(c)); }
  while (keys.length < 3) { keys.push(new THREE.Color(-9, -9, -9)); cols.push(new THREE.Color()); }
  const U = { uKey: { value: keys }, uCol: { value: cols }, uAll: { value: def.cat === "hair" ? 1 : 0 } };
  const m = new THREE.MeshLambertMaterial({ map, side: def.doubleSide ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    debugHook(sh, def.cat === "face" ? "facewear" : def.cat);
    // cut edges take the colour of the cloth just inside them (refit4.mjs)
    if (edge) sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 _edgecol; varying vec4 vEdge;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEdge = _edgecol;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uKey[3], uCol[3]; uniform float uAll;" + (edge ? "\nvarying vec4 vEdge;" : ""))
      .replace("#include <map_fragment>", `
vec4 tx = texture2D(map, vMapUv);
vec3 c = tx.rgb;
${edge ? "c = mix(c, pow(vEdge.rgb, vec3(2.2)), vEdge.a);" : ""}
for (int k = 0; k < 3; k++) {
  if (uKey[k].r < -1.0) continue;
  float lk = dot(uKey[k], vec3(.3, .59, .11)), lc = dot(c, vec3(.3, .59, .11));
  vec3 ck = uKey[k] / max(lk, 1e-3), cc = c / max(lc, 1e-3);
  float near = 1.0 - smoothstep(0.18, 0.42, distance(ck, cc) + abs(log2(max(lc, 1e-3) / max(lk, 1e-3))) * 0.12);
  // keep the texture's light and dark, within reason (a near-black key would blow small differences up)
  c = mix(c, uCol[k] * clamp(lc / max(lk, 1e-3), 0.45, 1.6), max(near, uAll));
}
diffuseColor *= vec4(c, tx.a);`);
  };
  // layers in order (LAYER4): where two still meet, the outer one wins the depth test
  const L = LAYER4[def.cat] ?? 0;
  m.polygonOffset = L > 0; m.polygonOffsetFactor = -0.5 * L; m.polygonOffsetUnits = -2 * L;
  // under a hood: the hair behind the head is inside it
  if (def.cat === "hair" && hat?.hairBack) clipBehind(m, HC[2] - 0.015);
  else m.customProgramCacheKey = () => "rando-item4-" + def.cat + (edge ? "-e" : "");
  return m;
}

// ---------------- layer shells ----------------
// Layers never share a surface, and the outer one always wins. In rest
// space (base units), once per item or pair, cached:
//  - the head shell: the scalp's radius round the head centre, measured
//    per direction from the base mesh;
//  - a hat is pushed out to sit at least HAT_GAP off the scalp, so it never
//    touches the scalp or the hair under it;
//  - hat hair: wherever a hat covers the head, the hair is pressed down to
//    within HAIR_IN of the scalp; what the hat doesn't cover (bangs, sides,
//    the back, a ponytail's tail) stays as it is;
//  - hair lies over a top's collar and over neck items (lifted LIFT off
//    them), and so do neck items and a hood's neck; a top's hem goes over
//    the bottom's waistband (pressed in);
//  - a mask or shades sit FACE_GAP off the face;
//  - a hood hides the hair behind the head (itemMaterial clips it).
const HC = [0, 0.895, 0];                       // head centre
const AZ = 96, PO = 48;                         // head / body maps: azimuth bins; head map polar bins (fine enough for the nose)
const CY0 = 0.36, CY1 = 0.84, CYN = 40;         // body map: heights round the vertical axis
// (big flat triangles sag ~0.003 toward a curved scalp between their corners: the gaps allow for it)
const HAT_GAP = 0.016, FACE_GAP = 0.008, HAIR_IN = 0.0075, HAIR_MIN = 0.005, LIFT = 0.008, MAX_LIFT = 0.035, TUCK = 0.007, SOFT = 0.003;
const softplus = x => x > 20 ? x : Math.log1p(Math.exp(x));
// a smooth max / min that keeps the order of the layers inside a shell
const atLeast = (r, a) => a + SOFT * softplus((r - a) / SOFT);
const atMost = (r, a) => a - SOFT * softplus((a - r) / SOFT);

// positions as a plain xyz array (the glbs' attributes are interleaved)
const xyz = geo => { const a = geo.attributes.position, p = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { p[i * 3] = a.getX(i); p[i * 3 + 1] = a.getY(i); p[i * 3 + 2] = a.getZ(i); } return p; };
function triangles(geo, keep = null) {
  const p = xyz(geo), ix = geo.index?.array, n = ix ? ix.length : p.length / 3, out = [];
  for (let i = 0; i < n; i += 3) {
    const a = ix ? ix[i] : i, b = ix ? ix[i + 1] : i + 1, c = ix ? ix[i + 2] : i + 2;
    if (keep && !keep(p[a * 3 + 1], p[b * 3 + 1], p[c * 3 + 1])) continue;
    out.push(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2], p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
  }
  return new Float32Array(out);
}
// distances along the ray o + t·d to every triangle it crosses (only the
// triangles listed in `only`, when given: a bucket of them)
function hits(T, o, d, only = null) {
  const out = [], n = only ? only.length : T.length / 9;
  for (let q = 0; q < n; q++) {
    const i = (only ? only[q] : q) * 9;
    const e1x = T[i + 3] - T[i], e1y = T[i + 4] - T[i + 1], e1z = T[i + 5] - T[i + 2];
    const e2x = T[i + 6] - T[i], e2y = T[i + 7] - T[i + 1], e2z = T[i + 8] - T[i + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tx = o[0] - T[i], ty = o[1] - T[i + 1], tz = o[2] - T[i + 2];
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-5) out.push(t);
  }
  return out;
}
// triangles bucketed by a per-corner key range (lo..hi bins, inclusive), so a ray only tests its bucket
function buckets(T, nb, key) {
  const B = Array.from({ length: nb }, () => []);
  for (let t = 0; t < T.length / 9; t++) {
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < 3; c++) { const k = key(T[t * 9 + c * 3], T[t * 9 + c * 3 + 1], T[t * 9 + c * 3 + 2]); lo = Math.min(lo, k); hi = Math.max(hi, k); }
    for (let b = Math.max(0, Math.floor(lo)); b <= Math.min(nb - 1, Math.ceil(hi)); b++) B[b].push(t);
  }
  return B;
}
// head map directions: bin centres; and a point's (fractional) bin
const headDir = (i, j) => { const az = (i + 0.5) / AZ * 2 * Math.PI - Math.PI, po = (j + 0.5) / PO * Math.PI; return [Math.sin(po) * Math.sin(az), Math.cos(po), Math.sin(po) * Math.cos(az)]; };
const headBin = (x, y, z) => { const r = Math.hypot(x, y, z) || 1; return [(Math.atan2(x, z) + Math.PI) / (2 * Math.PI) * AZ - 0.5, Math.acos(Math.max(-1, Math.min(1, y / r))) / Math.PI * PO - 0.5]; };
const bodyRow = j => CY0 + (j + 0.5) / CYN * (CY1 - CY0);
// (a triangle spanning the pole or the back seam just lands in a wide range of buckets: still correct)
const polarBuckets = T => buckets(T, PO, (x, y, z) => headBin(x - HC[0], y - HC[1], z - HC[2])[1]);
// bilinear, wrapping round in azimuth
function sample(map, W, H, fi, fj) {
  const i0 = Math.floor(fi), j0 = Math.max(0, Math.min(H - 1, Math.floor(fj))), j1 = Math.min(H - 1, j0 + 1);
  const ti = fi - i0, tj = Math.max(0, Math.min(1, fj - j0)), a = ((i0 % W) + W) % W, b = (a + 1) % W;
  return (map[j0 * W + a] * (1 - ti) + map[j0 * W + b] * ti) * (1 - tj) + (map[j1 * W + a] * (1 - ti) + map[j1 * W + b] * ti) * tj;
}
// coverage maps: dilate once, then blur, so a layer's edge fades out over a bin or two
// (down = -2: no dilation, just the blur)
function soften(m, W, H, down = 0) {
  let a = Float32Array.from(m);
  if (down > -2) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let v = m[j * W + i];
    for (let dj = -1; dj <= 1 + down; dj++) for (let di = -1; di <= 1; di++) { const jj = j - dj; if (jj >= 0 && jj < H) v = Math.max(v, m[jj * W + ((i + di + W) % W)]); }
    a[j * W + i] = v;
  }
  const b = new Float32Array(a.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let v = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj; if (jj >= 0 && jj < H) { v += a[jj * W + ((i + di + W) % W)]; n++; } }
    b[j * W + i] = v / n;
  }
  return b;
}
let SCALP = null;
const BONE_IX = {};
// the scalp's radius per head direction (directions below the jaw keep the
// last good radius: nothing is fitted there)
function scalpMap(geo) {
  if (SCALP) return SCALP;
  const T = triangles(geo, (a, b, c) => Math.min(a, b, c) > 0.74), R = new Float32Array(AZ * PO), Bk = polarBuckets(T);
  for (let j = 0; j < PO; j++) for (let i = 0; i < AZ; i++) {
    const h = hits(T, HC, headDir(i, j), Bk[j]);
    R[j * AZ + i] = h.length ? Math.min(0.14, Math.min(...h)) : (j ? R[(j - 1) * AZ + i] : 0.1);
  }
  for (let j = Math.round(PO * 0.64); j < PO; j++) for (let i = 0; i < AZ; i++) R[j * AZ + i] = R[(j - 1) * AZ + i];
  return SCALP = R;
}
const scalpAt = (x, y, z) => { const [fi, fj] = headBin(x - HC[0], y - HC[1], z - HC[2]); return sample(SCALP, AZ, PO, fi, fj); };
// where a hat covers the head: a ray from the head centre meets it close to the scalp
function headCover(geos) {
  const T = geos.map(g => triangles(g)), Bk = T.map(polarBuckets), C = new Float32Array(AZ * PO);
  for (let j = 0; j < PO; j++) for (let i = 0; i < AZ; i++) {
    const R = SCALP[j * AZ + i];
    C[j * AZ + i] = T.some((t, k) => hits(t, HC, headDir(i, j), Bk[k][j]).some(h => h < R + 0.06)) ? 1 : 0;
  }
  return soften(C, AZ, PO, 1);
}
// round the body's vertical axis: where a top (or neck item) is, and its radius
// (the first surface out from the axis, past the middle of the body)
function bodyCover(geos) {
  const T = geos.map(g => triangles(g)), C = new Float32Array(AZ * CYN), R = new Float32Array(AZ * CYN), Ro = new Float32Array(AZ * CYN);
  const Bk = T.map(t => buckets(t, CYN, (x, y) => (y - CY0) / (CY1 - CY0) * CYN - 0.5));
  for (let j = 0; j < CYN; j++) for (let i = 0; i < AZ; i++) {
    const az = (i + 0.5) / AZ * 2 * Math.PI - Math.PI, o = [0, bodyRow(j), 0], d = [Math.sin(az), 0, Math.cos(az)];
    const h = T.flatMap((t, k) => hits(t, o, d, Bk[k][j])).filter(t => t > 0.02 && t < 0.24);
    // R: its inside (what goes under it is pressed in under this); Ro: its outside, the
    // last surface within a cloth's thickness (what goes over it is lifted past this)
    if (h.length) { const r0 = Math.min(...h); C[j * AZ + i] = 1; R[j * AZ + i] = r0; Ro[j * AZ + i] = Math.max(...h.filter(t => t < r0 + 0.035)); }
  }
  // fill radii where uncovered with the neighbours', so sampling across an edge stays sane
  for (const M of [R, Ro]) for (let k = 0; k < 4; k++) for (let j = 0; j < CYN; j++) for (let i = 0; i < AZ; i++) if (!M[j * AZ + i]) {
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => M[Math.max(0, Math.min(CYN - 1, j + dj)) * AZ + (i + di + AZ) % AZ]).filter(Boolean);
    if (n.length) M[j * AZ + i] = Math.max(...n);
  }
  return { C: soften(C, AZ, CYN), exact: soften(C, AZ, CYN, -2), R, Ro };
}
// a cover map as a texture for the body shader (azimuth wraps)
const NO_COVER = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
NO_COVER.needsUpdate = true;
const coverTexs = new Map();
function coverTex(id, M) {
  if (coverTexs.has(id)) return coverTexs.get(id);
  const d = new Uint8Array(AZ * CYN * 4);
  for (let k = 0; k < AZ * CYN; k++) d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = d[k * 4 + 3] = Math.round(Math.min(1, M.exact[k]) * 255);
  const t = new THREE.DataTexture(d, AZ, CYN);
  t.wrapS = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  coverTexs.set(id, t);
  return t;
}
const bodyAt = (map, x, y, z, outer = false) => {
  const fi = (Math.atan2(x, z) + Math.PI) / (2 * Math.PI) * AZ - 0.5, fj = (y - CY0) / (CY1 - CY0) * CYN - 0.5;
  if (fj < -1 || fj > CYN) return [0, 0];
  return [sample(map.C, AZ, CYN, fi, fj), sample(outer ? map.Ro : map.R, AZ, CYN, fi, fj)];
};
// a copy of an item's geometry with its positions moved (everything else shared)
function moved(geo, fn) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  g.index = geo.index;
  const p = xyz(geo);
  for (let i = 0; i < p.length; i += 3) fn(p, i);
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.computeBoundingSphere();
  return g;
}
// hair and a hood's drape ride the head bone; below the jaw they hand over
// to the chest (all of it by the shoulders), so long hair and the hood's
// neck move with the body under them instead of swinging through the top
function onTheChest(geo) {
  const P = geo.attributes.position, n = P.count, J = new Uint16Array(n * 4), W = new Float32Array(n * 4);
  const head = BONE_IX.head, chest = BONE_IX.chest, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  if (head == null || chest == null) return geo;
  let changed = false;
  for (let i = 0; i < n; i++) {
    const y = P.getY(i), k = Math.min(1, Math.max(0, (0.8 - y) / 0.14)), w = k * k * (3 - 2 * k);
    if (w > 0) { J.set([head, chest, 0, 0], i * 4); W.set([1 - w, w, 0, 0], i * 4); changed = true; }
    else { J.set([si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], i * 4); W.set([sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)], i * 4); }
  }
  if (!changed) return geo;
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  g.index = geo.index;
  g.setAttribute("skinIndex", new THREE.BufferAttribute(J, 4)); g.setAttribute("skinWeight", new THREE.BufferAttribute(W, 4));
  g.computeBoundingSphere();
  return g;
}
// radial moves round the head centre / the body's axis
const headTo = (p, i, f) => {
  const x = p[i] - HC[0], y = p[i + 1] - HC[1], z = p[i + 2] - HC[2], r = Math.hypot(x, y, z);
  if (r < 1e-4) return;
  const k = f(r) / r; p[i] = HC[0] + x * k; p[i + 1] = HC[1] + y * k; p[i + 2] = HC[2] + z * k;
};
const axisTo = (p, i, f) => {
  const r = Math.hypot(p[i], p[i + 2]);
  if (r < 1e-4) return;
  const k = f(r) / r; p[i] *= k; p[i + 2] *= k;
};
// the fitted geometry of one worn item, given the other worn items that
// shape it ({ id, def, geos }), cached
const fitCache = new Map(), headCovers = new Map(), bodyCovers = new Map();
const headCoverOf = o => headCovers.get(o.id) ?? headCovers.set(o.id, headCover(o.geos)).get(o.id);
const bodyCoverOf = o => bodyCovers.get(o.id) ?? bodyCovers.set(o.id, bodyCover(o.geos)).get(o.id);
// which other worn items shape an item's fit
const shapes = (def, o) => def.cat === "hair" ? (o.cat === "head" && o.shell !== false) || ((o.cat === "top" || o.cat === "neck") && o.liftsHair !== false)
  : def.cat === "bottom" ? o.cat === "top" && o.tucks !== false
  : def.cat === "neck" || def.cat === "head" ? o.cat === "top" : false;
function fitted(id, idx, geo, others) {
  const def = ITEMS4[id], key = [id, idx, ...others.map(o => o.id)].join("|");
  if (fitCache.has(key)) return fitCache.get(key);
  let g = geo;
  const shell = def.cat === "head" && def.shell !== false, face = def.cat === "face";
  if (shell || face) g = moved(g, (p, i) => {
    // a hat sits on the head shell: nothing of it inside scalp + HAT_GAP;
    // a mask or shades sit just off the face
    // (a mask over the nose and mouth stands further off than shades: the nose is a small, sharp bump)
    const R = scalpAt(p[i], p[i + 1], p[i + 2]), gap = shell ? HAT_GAP : p[i + 1] < 0.855 ? FACE_GAP * 1.6 : FACE_GAP;
    if (p[i + 1] > HC[1] - (shell ? 0.08 : 0.13)) headTo(p, i, r => r < R + gap + 0.03 ? atLeast(r, R + gap) : r);
  });
  if (def.cat === "hair") g = moved(g, (p, i) => {
    // hair never shares the scalp's surface (a buzz cut stands HAIR_MIN off it)
    if (p[i + 1] > HC[1] - 0.1) { const R = scalpAt(p[i], p[i + 1], p[i + 2]); headTo(p, i, r => r < R + HAIR_MIN + 0.01 ? atLeast(r, R + HAIR_MIN) : r); }
  });
  for (const o of others) {
    if (def.cat === "hair" && o.def.cat === "head" && o.def.shell !== false) {
      // hat hair: pressed under whatever the hat covers
      const C = headCoverOf(o);
      g = moved(g, (p, i) => {
        const [fi, fj] = headBin(p[i] - HC[0], p[i + 1] - HC[1], p[i + 2] - HC[2]), c = sample(C, AZ, PO, fi, fj);
        if (c < 0.01) return;
        const R = sample(SCALP, AZ, PO, fi, fj);
        headTo(p, i, r => r + c * (atMost(r, R + HAIR_IN) - r));
      });
    }
    if (def.cat === "hair" && (o.def.cat === "top" || o.def.cat === "neck") && o.def.liftsHair !== false) {
      // hair lies over a collar / a scarf / straps
      const M = bodyCoverOf(o);
      g = moved(g, (p, i) => {
        const [c, R] = bodyAt(M, p[i], p[i + 1], p[i + 2], true);
        // further down the back, more room: hair rides the head bone, the top bends with the spine
        if (c > 0.01 && Math.hypot(p[i], p[i + 2]) > R * 0.6) axisTo(p, i, r => r + c * Math.min(MAX_LIFT * 1.7, atLeast(r, R + LIFT + Math.max(0, 0.84 - p[i + 1]) * 0.05) - r));
      });
    }
    if ((def.cat === "neck" || def.cat === "head") && o.def.cat === "top") {
      // a chain, a scarf, straps, a hood's neck: over the top, never through it
      const M = bodyCoverOf(o);
      g = moved(g, (p, i) => {
        const [c, R] = bodyAt(M, p[i], p[i + 1], p[i + 2], true);
        // (more room: near the shoulders the top follows the arms, the chain the chest)
        // all the way round: behind the neck it rests on the collar, never inside it
        // (at most 2.5 × MAX_LIFT: past that the cover is a sleeve or an arm, not the chest)
        if (c > 0.01 && p[i + 1] < 0.8) axisTo(p, i, r => r + c * Math.min(MAX_LIFT * 2.5, atLeast(r, R + LIFT * 2.5) - r));
      });
    }
    if (def.cat === "bottom" && o.def.cat === "top" && o.def.tucks !== false) {
      // the waistband goes in under the top's hem
      const M = bodyCoverOf(o);
      g = moved(g, (p, i) => {
        const [c, R] = bodyAt(M, p[i], p[i + 1], p[i + 2]);
        if (c > 0.01) axisTo(p, i, r => r + c * (atMost(r, R - TUCK) - r));
      });
    }
  }
  if (def.cat === "hair" || def.cat === "head") g = onTheChest(g);
  if (fitCache.size > 200) fitCache.delete(fitCache.keys().next().value);
  fitCache.set(key, g);
  return g;
}

// ---------------- loading ----------------
const loader = new GLTFLoader();
let tplP = null, TPL = null;
export function loadAvatar4() {
  if (tplP) return tplP;
  tplP = loader.loadAsync(BASE + "base.glb").then(g => {
    let body = null;
    g.scene.traverse(o => { if (o.isSkinnedMesh && !body) body = o; });
    if (!body) throw new Error("avatar4/base.glb: no skinned mesh");
    const geo = body.geometry;
    if (geo.attributes.uv1) geo.setAttribute("faceUv", geo.attributes.uv1);
    scalpMap(geo);
    body.skeleton.bones.forEach((b, i) => { BONE_IX[b.name] = i; });
    const mask = body.material.map;
    mask.colorSpace = THREE.NoColorSpace; mask.needsUpdate = true;
    TPL = { scene: g.scene, mask };
    return TPL;
  });
  return tplP;
}
const itemCache = new Map();
function loadItem(id) {
  if (!itemCache.has(id)) itemCache.set(id, loader.loadAsync(BASE + "items/" + ITEMS4[id].file).then(g => {
    const meshes = [];
    g.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    for (const o of meshes) if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    return meshes;
  }));
  return itemCache.get(id);
}

// ---------------- the character ----------------
function build(cfg) {
  const group = new THREE.Group();
  const rig = SkeletonUtils.clone(TPL.scene);
  rig.scale.setScalar(CHAR_H);
  group.add(rig);
  let body = null;
  rig.traverse(o => { if (o.isSkinnedMesh && !body) body = o; });
  body.material = bodyMaterial(TPL.mask);
  body.frustumCulled = false; body.castShadow = true; body.userData.part = "body";
  const U = body.material.userData.U;
  const skel = body.skeleton, bone = n => skel.bones.find(b => b.name === n);
  let disposed = false, epoch = 0, expr = "neutral", ready = Promise.resolve();
  let worn = [];

  // face accessories drawn on the face layer (band-aid, star, nose ring)
  const decal = () => ITEMS4[cfg.face]?.code === "decal" ? cfg.face : null;
  const faceTex = e => faceTexture4(cfg, e, decal());
  const paint = () => {
    lin(SKIN4_RGB[cfg.skin], U.uSkin.value);
    U.uFace.value = faceTex(M.shownExpr ?? "neutral");
  };
  const dress = () => {
    const my = ++epoch;
    for (const w of worn) { w.parent?.remove(w); w.material.dispose(); if (w.userData.ownGeo) w.geometry.dispose(); }
    worn = [];
    const hat = ITEMS4[cfg.head];
    const all = SLOTS4.map(s => cfg[s]).filter(id => id && id !== "none" && ITEMS4[id]);
    // a hat can hide the hairstyles that would poke through it (the hood: buns, tails)
    const ids = all.filter(id => ITEMS4[id].file && !(ITEMS4[id].cat === "hair" && hat?.hidesHair?.includes(id)));
    if (all.some(id => ITEMS4[id].code === "hoops")) worn.push(...hoops());
    const hide = { tee: 0, shorts: 0, below: -1, above: 9, arms: 0, legs: 0, ears: 0 };
    for (const id of ids) {
      const h = ITEMS4[id].hides ?? {};
      if (h.tee) hide.tee = 1; if (h.ears) hide.ears = 1; if (h.shorts) hide.shorts = 1; if (h.arms) hide.arms = 1; if (h.legs) hide.legs = 1;
      if (h.below != null) hide.below = Math.max(hide.below, h.below);
      if (h.above != null) hide.above = Math.min(hide.above, h.above);
    }
    U.uHide.value.set(hide.tee, hide.shorts, hide.below, hide.above);
    U.uHideArms.value = hide.arms; U.uHideLegs.value = hide.legs; U.uHideEars.value = hide.ears;
    // the scalp under hair takes the hair colour; under a hat, the hat's (no
    // skin through the gaps either way)
    const hairDef = ITEMS4[cfg.hair];
    const scalpRgb = hat?.scalp ?? (hairDef?.scalp ? HAIR4_RGB[cfg.hairColor] ?? HAIR4_RGB.black : null);
    if (scalpRgb) { const c = lin(scalpRgb); U.uScalp.value.set(c.r * 0.75, c.g * 0.75, c.b * 0.75, 1); }
    else U.uScalp.value.set(0, 0, 0, 0);
    ready = Promise.all(ids.map(id => loadItem(id))).then(loaded => {
      if (disposed || my !== epoch) return;
      const worn4 = ids.map((id, k) => ({ id, def: ITEMS4[id], meshes: loaded[k], geos: loaded[k].map(m => m.geometry) }));
      const top = worn4.find(o => o.def.cat === "top"), bot = worn4.find(o => o.def.cat === "bottom");
      U.uCovT.value = top ? coverTex(top.id, bodyCoverOf(top)) : NO_COVER;
      U.uCovB.value = bot ? coverTex(bot.id, bodyCoverOf(bot)) : NO_COVER;
      U.uCovOn.value.set(top ? 1 : 0, bot ? 1 : 0);
      for (const { id, def, meshes } of worn4) {
        const others = worn4.filter(o => o.id !== id && shapes(def, o.def));
        meshes.forEach((src, k) => {
          const mat = itemMaterial(src.material.map, def, cfg, hat, !!src.geometry.attributes._edgecol);
          const sm = new THREE.SkinnedMesh(fitted(id, k, src.geometry, others), mat);
          // its flat colour (the lobby sprites paint parts flat): the tint's, else its own
          const tints = typeof def.tint === "function" ? def.tint(cfg) : def.tint;
          sm.userData.rgb = tints?.[0]?.[1] ?? def.rgb;
          sm.frustumCulled = false; sm.castShadow = true; sm.userData.part = def.cat === "face" ? "facewear" : def.cat;
          body.parent.add(sm);
          sm.bind(skel, body.bindMatrix);
          worn.push(sm);
        });
      }
    });
  };

  // hoop earrings, made in code: a small gold ring hanging from each ear, on the head bone
  const hoops = () => [-1, 1].map(side => {
    const mat = new THREE.MeshLambertMaterial({ color: 0xe8c25a, emissive: 0x3a2a08 });
    mat.onBeforeCompile = sh => debugHook(sh, "facewear");
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0028, 8, 24), mat);
    m.position.set(side * 0.112, 0.036, -0.004);           // head-bone space (base units): under the ear lobe
    m.rotation.y = Math.PI / 2;
    m.userData.ownGeo = true; m.userData.part = "facewear"; m.userData.rgb = [232, 194, 90];
    B.head.add(m);
    return m;
  });

  // ---- emotes: a doodled mark that pops up by the head for a moment
  let emoteSpr = null, emoteUntil = 0, emoteT0 = 0;
  const emote = (name, secs = 1.8) => {
    if (!EMOTES4.includes(name)) return;
    if (!emoteSpr) {
      emoteSpr = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      emoteSpr.renderOrder = 5;
      B.head.add(emoteSpr);
    }
    emoteSpr.material.map = emoteTexture(name); emoteSpr.material.needsUpdate = true;
    emoteSpr.visible = true;
    emoteT0 = lastT ?? 0; emoteUntil = emoteT0 + secs;
  };
  const emoteTick = t => {
    if (!emoteSpr?.visible) return;
    if (t > emoteUntil) { emoteSpr.visible = false; return; }
    const k = Math.min(1, (t - emoteT0) / 0.18), out = Math.max(0, 1 - (emoteUntil - t) / 0.25);
    const sc = 0.1 * (k < 1 ? 0.6 + 0.5 * k : 1) * (1 - out * 0.4);
    emoteSpr.scale.set(sc, sc, 1);
    emoteSpr.position.set(0.1, 0.2 + Math.sin((t - emoteT0) * 5) * 0.006, 0.03);
    emoteSpr.material.opacity = 1 - out;
  };

  // ---- motion (character frame: x = its left, y = up, z = forward)
  const M = { nextBlink: 1.5, blinkUntil: 0, nextNod: 4, nodAt: -10, hopAt: -10, shownExpr: null };
  const B = Object.fromEntries(["hips", "spine", "chest", "neck", "head", "upperarm_L", "forearm_L", "hand_L", "upperarm_R", "forearm_R", "hand_R",
    "thigh_L", "shin_L", "foot_L", "thigh_R", "shin_R", "foot_R", "shoulder_L", "shoulder_R"].map(n => [n, bone(n)]));
  const rest = new Map(skel.bones.map(b => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const gq = new THREE.Quaternion(), pq = new THREE.Quaternion(), dq = new THREE.Quaternion(), eu = new THREE.Euler();
  const turn = (b, x, y, z) => {
    if (!b || (!x && !y && !z)) return;
    rig.getWorldQuaternion(gq); b.parent.getWorldQuaternion(pq);
    const rel = gq.invert().multiply(pq);
    dq.setFromEuler(eu.set(x, y, z, "YXZ"));
    dq.premultiply(rel.clone().invert()).multiply(rel);
    b.quaternion.premultiply(dq);
    b.updateMatrixWorld(true);
  };
  // point a bone along a direction in the character frame (its child gives
  // the bone's current direction), blended by w: the sitting pose is written
  // as where each limb points, so it holds for every outfit and proportion
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vw = new THREE.Vector3(), aq = new THREE.Quaternion(), iq = new THREE.Quaternion(), rq = new THREE.Quaternion();
  const aim = (b, c, x, y, z, w = 1) => {
    if (!b || !c || w <= 0) return;
    b.getWorldPosition(va); c.getWorldPosition(vb);
    rig.worldToLocal(va); rig.worldToLocal(vb);
    aq.setFromUnitVectors(vb.sub(va).normalize(), vw.set(x, y, z).normalize());
    iq.identity().slerp(aq, w);
    rig.getWorldQuaternion(gq); b.parent.getWorldQuaternion(pq);
    const rel = gq.invert().multiply(pq);
    dq.copy(iq).premultiply(rq.copy(rel).invert()).multiply(rel);
    b.quaternion.premultiply(dq);
    b.updateMatrixWorld(true);
  };
  const STRIDE = 7.2;
  const fold = x => Math.max(0, x);
  // sitting cross-legged on a floor cushion (the game hosts' rooms): knees
  // out to the sides, shins crossed in front, hands on the knees, a little
  // lean in. It returns how far to lower the body for the seat to land on
  // the group's origin (measured off the posed hips, so any outfit sits right).
  const THIGH_R = 0.7, hipAt = new THREE.Vector3();
  const sitPose = (t, w) => {
    const br = Math.sin(t * 1.3) * 0.012;
    turn(B.spine, (0.08 + br) * w, 0, 0);
    turn(B.chest, 0.03 * w, 0, 0);
    aim(B.thigh_L, B.shin_L, 0.62, -0.08, 0.78, w); aim(B.thigh_R, B.shin_R, -0.62, -0.08, 0.78, w);
    aim(B.shin_L, B.foot_L, -0.92, -0.18, 0.18, w); aim(B.shin_R, B.foot_R, 0.92, -0.1, 0.12, w);
    // the feet lie forward on their outer edge (with the thighs up they'd point at the ceiling)
    turn(B.foot_L, 1.35 * w, 0, -0.35 * w); turn(B.foot_R, 1.35 * w, 0, 0.35 * w);
    aim(B.upperarm_L, B.forearm_L, 0.3, -0.8, 0.45, w); aim(B.upperarm_R, B.forearm_R, -0.3, -0.8, 0.45, w);
    aim(B.forearm_L, B.hand_L, 0.12, -0.42, 0.9, w); aim(B.forearm_R, B.hand_R, -0.12, -0.42, 0.9, w);
    // how far to drop (character units) so the seat rests on the group's origin
    B.thigh_L.getWorldPosition(hipAt); rig.worldToLocal(hipAt);
    return -(hipAt.y * CHAR_H - THIGH_R);
  };
  // sitting on a chair at a table (Mask Off's round table): thighs forward,
  // shins down, feet flat, upright with a little lean in, forearms resting on
  // the table's edge in front. Same contract as sitPose: the seat lands on the
  // group's origin.
  const chairPose = (t, w) => {
    const br = Math.sin(t * 1.3) * 0.012;
    turn(B.spine, (0.06 + br) * w, 0, 0);
    turn(B.chest, 0.04 * w, 0, 0);
    aim(B.thigh_L, B.shin_L, 0.1, -0.06, 1, w); aim(B.thigh_R, B.shin_R, -0.1, -0.06, 1, w);
    aim(B.shin_L, B.foot_L, 0.03, -1, 0.06, w); aim(B.shin_R, B.foot_R, -0.03, -1, 0.06, w);
    aim(B.upperarm_L, B.forearm_L, 0.22, -0.8, 0.55, w); aim(B.upperarm_R, B.forearm_R, -0.22, -0.8, 0.55, w);
    aim(B.forearm_L, B.hand_L, -0.28, 0.02, 1, w); aim(B.forearm_R, B.hand_R, 0.28, 0.02, 1, w);
    B.thigh_L.getWorldPosition(hipAt); rig.worldToLocal(hipAt);
    return -(hipAt.y * CHAR_H - THIGH_R);
  };
  // idle: arms down from the A-pose, loose; a wider stance, weight on one
  // leg; a slow breathing sway, now and then a little nod. walk: thighs
  // swing, knees fold, arms swing against the legs, a springy bounce.
  const applyMotion = (t, w, p, sit = 0, gz = 0, u = 1, chair = 0) => {
    for (const [b, r] of rest) { b.quaternion.copy(r.q); b.position.copy(r.p); }
    rig.updateMatrixWorld(true);
    const i = 1 - w, sway = Math.sin(t * 1.15);
    const since = t - M.nodAt, nod = since >= 0 && since < 0.9 ? Math.sin(since / 0.45 * Math.PI) ** 2 * 0.12 : 0;
    const sL = Math.sin(p), sR = -sL;
    // a little hop with the arms out (equip reactions)
    const sh = t - M.hopAt, hop = sh >= 0 && sh < 0.5 ? Math.sin(sh / 0.5 * Math.PI) : 0;
    turn(B.hips, 0, w * sL * 0.1 + i * 0.04, i * (0.03 + sway * 0.01));
    turn(B.spine, -0.02 * w, -w * sL * 0.06, -i * 0.02);
    turn(B.chest, -0.03 * i - 0.03 * w + i * sway * 0.01, -w * sL * 0.1, -i * 0.02);
    turn(B.neck, (-0.02 + nod * 0.4) * i, w * sL * 0.06, 0);
    turn(B.head, (-0.04 + nod) * i - 0.02 * w, i * sway * 0.04, i * 0.05 - w * sL * 0.02);
    // legs: -x swings a foot forward, +x folds a knee
    turn(B.thigh_L, w * -0.5 * sL + i * -0.04, i * 0.08, 0.05 * i + 0.02 * w);
    turn(B.shin_L, w * (0.08 + 0.85 * fold(Math.sin(p - 0.9))) + i * 0.12, 0, 0);
    turn(B.foot_L, w * 0.3 * fold(-sL) - i * 0.08 - 0.05 * i, 0, -0.05 * i);
    turn(B.thigh_R, w * -0.5 * sR, -i * 0.05, -0.06 * i - 0.02 * w);
    turn(B.shin_R, w * (0.08 + 0.85 * fold(Math.sin(p + Math.PI - 0.9))), 0, 0);
    turn(B.foot_R, w * 0.3 * fold(-sR), 0, 0.06 * i);
    // arms: down from the A-pose, hands a little in front, swinging
    turn(B.upperarm_L, w * 0.5 * sL + i * (0.05 + sway * 0.02), 0, -0.42 - 0.02 * i * sway + hop * 0.5);
    turn(B.forearm_L, -0.22 - w * 0.3 * fold(-sL), 0, -0.08);
    turn(B.upperarm_R, w * 0.5 * sR + i * (0.03 - sway * 0.02), 0, 0.42 + 0.02 * i * sway - hop * 0.5);
    turn(B.forearm_R, -0.22 - w * 0.3 * fold(-sR), 0, 0.08);
    // the bob is written ABSOLUTE into group.position.y (the world adds the
    // terrain height after tick(), the same contract as avatar3)
    // (u: the group's own scale, for a scaled-down character in a room; 1 on the map)
    group.position.y = (i * (0.02 + sway * 0.02) + w * 0.3 * Math.abs(Math.sin(p)) + hop * 0.9) * u;
    if (sit > 0) { const drop = sitPose(t, sit); group.position.y = group.position.y * (1 - sit) + (drop + hop * 0.4) * sit * u; }
    if (chair > 0) { const drop = chairPose(t, chair); group.position.y = group.position.y * (1 - chair) + (drop + hop * 0.2) * chair * u; }
    // where they're looking: a turn of the head (yaw, + = to their left), the neck taking a little
    if (gz) { turn(B.neck, 0, gz * 0.3, 0); turn(B.head, 0, gz * 0.7, 0); }
  };
  const faceTick = (t, walking) => {
    if (t > M.nextBlink) { M.blinkUntil = t + 0.13; M.nextBlink = t + 2.2 + Math.random() * 3; }
    if (!walking && t > M.nextNod) { M.nodAt = t; M.nextNod = t + 6 + Math.random() * 5; }
    let show = expr;
    if (expr === "neutral" && t < M.blinkUntil) show = "blink";
    if (show !== M.shownExpr) { M.shownExpr = show; U.uFace.value = faceTex(show); }
  };

  paint(); dress(); applyMotion(0, 0, 0);
  let lastT = null, walkW = 0, walkP = 0, sitW = 0, chairW = 0, gazeNow = 0, nodNow = 0;
  const IDLE_LEN = 4, WALK_LEN = Math.PI * 2 / STRIDE;
  return {
    group,
    get ready() { return ready; },
    pose(clip, t) { const wk = clip === "walk"; applyMotion(t, wk ? 1 : 0, wk ? t / WALK_LEN * Math.PI * 2 : 0); return true; },
    clipLength: clip => clip === "walk" ? WALK_LEN : IDLE_LEN,
    get config() { return { ...cfg }; },
    setConfig(next) {
      const prev = cfg;
      cfg = normalizeAvatar4({ ...cfg, ...next });
      paint();
      if (SLOTS4.some(s => prev[s] !== cfg[s]) || prev.hairColor !== cfg.hairColor) dress();
    },
    setExpression(name) {
      name = EXPR_ALIAS[name] ?? name;
      expr = EXPRESSIONS4.includes(name) ? name : "neutral";
      M.shownExpr = expr; U.uFace.value = faceTex(expr);
    },
    // a doodled mark by the head: anger, zzz, hearts, spiral, sparkles, sweat, question, exclaim
    emote,
    get expression() { return expr; },
    // react to something (equip, a win): a quick expression, a hop, a sparkle
    react(name = "happy", secs = 1.2) {
      this.setExpression(name);
      clearTimeout(M.reactT);
      M.reactT = setTimeout(() => !disposed && this.setExpression("neutral"), secs * 1000);
      M.hopAt = lastT ?? 0;
      emote("sparkles", Math.min(secs, 1.2));
    },
    dispose() {
      disposed = true; epoch++; clearTimeout(M.reactT);
      for (const w of worn) { w.material.dispose(); if (w.userData.ownGeo) w.geometry.dispose(); }
      emoteSpr?.material.dispose();
      body.material.dispose(); group.clear();
    },
    __rig: () => ({ turn, B, rest, rig, body, U }), // dev harness only
    walking: false,
    // "stand", "sit" (cross-legged on a floor cushion) or "chair" (on a chair
    // at a table); eased in and out
    stance: "stand",
    // the head bone (a mask or a prop rides it)
    get head() { return B.head; },
    // where they look up or down: head pitch in radians (+ = down), eased
    tilt: 0,
    // where they look: head yaw in radians (+ = to their left), eased
    gaze: 0,
    // the group's scale when it's scaled down into a room (npcstage.js): the
    // bob, hop and seat are offsets of the group, so they scale with it
    unit: 1,
    phase: Math.random() * Math.PI * 2,
    tick(t) {
      // the first frame takes the stance as it is (someone who pops in sitting doesn't sit down first)
      if (lastT === null) { sitW = this.stance === "sit" ? 1 : 0; chairW = this.stance === "chair" ? 1 : 0; }
      const dt = lastT === null ? 0.016 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      walkW += ((this.walking ? 1 : 0) - walkW) * Math.min(1, dt / 0.2);
      walkP += dt * STRIDE * Math.min(1, walkW * 1.5 + 0.2);
      sitW += ((this.stance === "sit" ? 1 : 0) - sitW) * Math.min(1, dt / 0.25);
      chairW += ((this.stance === "chair" ? 1 : 0) - chairW) * Math.min(1, dt / 0.25);
      gazeNow += (this.gaze - gazeNow) * Math.min(1, dt / 0.35);
      nodNow += (this.tilt - nodNow) * Math.min(1, dt / 0.35);
      applyMotion(t, walkW, walkP, sitW, gazeNow, this.unit, chairW);
      if (nodNow) turn(B.head, nodNow, 0, 0);
      faceTick(t, this.walking);
      emoteTick(t);
    },
  };
}

// hair under a hood: clip everything behind the head (rest-pose z)
function clipBehind(mat, z) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    prev(sh);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vRestZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRestZ = position.z;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vRestZ;")
      .replace("void main() {", `void main() {\n  if (vRestZ < ${z.toFixed(4)}) discard;`);
  };
  mat.customProgramCacheKey = () => "rando-item4-behind" + z;
}

export async function makeCharacter4(raw) {
  await loadAvatar4();
  return build(normalizeAvatar4(raw));
}
export function makeCharacter4Sync(raw) { return TPL ? build(normalizeAvatar4(raw)) : null; }

// ---------------- emote marks (drawn once each, doodle style) ----------------
const emoteCache = new Map();
function emoteTexture(name) {
  if (emoteCache.has(name)) return emoteCache.get(name);
  const S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.lineCap = g.lineJoin = "round";
  const ink = (c, w = 9) => { g.strokeStyle = c; g.lineWidth = w; };
  const heart = (x, y, r, c) => {
    g.fillStyle = c; g.beginPath(); g.moveTo(x, y + r * 0.9);
    g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.4, x, y - r * 0.4);
    g.bezierCurveTo(x + r * 0.6, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9); g.fill();
  };
  const sparkle = (x, y, r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.28 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  if (name === "anger") {
    // the cross-shaped vein mark
    ink("#ff3b4e", 11);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.beginPath(); g.moveTo(64 + sx * 14, 64 + sy * 40); g.quadraticCurveTo(64 + sx * 14, 64 + sy * 14, 64 + sx * 40, 64 + sy * 14); g.stroke();
    }
  } else if (name === "zzz") {
    g.fillStyle = "#cfe0ff"; g.strokeStyle = "#2b3a6b"; g.lineWidth = 5; g.font = "900 44px system-ui, sans-serif";
    [["Z", 28, 104, 1], ["z", 64, 70, 0.8], ["z", 92, 40, 0.6]].forEach(([c, x, y, k]) => { g.save(); g.translate(x, y); g.scale(k, k); g.strokeText(c, 0, 0); g.fillText(c, 0, 0); g.restore(); });
  } else if (name === "hearts") {
    heart(46, 72, 24, "#ff5d8a"); heart(90, 42, 16, "#ff8fb0");
  } else if (name === "spiral") {
    ink("#5a4bd8", 8); g.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.15) { const r = 4 + a * 2.6; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.stroke();
  } else if (name === "sparkles") {
    g.fillStyle = "#ffd23f"; sparkle(50, 70, 30); g.fillStyle = "#fff3b0"; sparkle(96, 36, 18); sparkle(94, 96, 12);
  } else if (name === "sweat") {
    g.fillStyle = "#7fc8ff"; g.strokeStyle = "#2f6fb0"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(64, 18); g.bezierCurveTo(30, 70, 40, 108, 64, 108); g.bezierCurveTo(88, 108, 98, 70, 64, 18); g.fill(); g.stroke();
    g.fillStyle = "#dff2ff"; g.beginPath(); g.ellipse(54, 82, 6, 11, -0.3, 0, 7); g.fill();
  } else {
    const ch = name === "question" ? "?" : "!";
    g.font = "900 104px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 10; g.strokeStyle = "#1d1730"; g.fillStyle = name === "question" ? "#6fd3ff" : "#ffd23f";
    g.strokeText(ch, 64, 68); g.fillText(ch, 64, 68);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  emoteCache.set(name, t);
  return t;
}

// ---------------- 2D identity thumb (chat headers, cards) ----------------
// a skin disc, a hair cap in the hair colour, the same eyes the head wears. Synchronous.
export function avatarThumb4(raw, size = 128) {
  const cfg = normalizeAvatar4(raw);
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const g = cv.getContext("2d"), skin = SKIN4_RGB[cfg.skin], hair = HAIR4_RGB[cfg.hairColor];
  g.fillStyle = `rgb(${skin})`;
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2); g.fill();
  if (cfg.hair !== "none" || cfg.head !== "none") {
    g.fillStyle = cfg.head !== "none" ? "rgb(70,72,86)" : `rgb(${hair})`;
    g.beginPath(); g.arc(size / 2, size / 2 - size * 0.05, size * 0.43, Math.PI * 1.03, Math.PI * 1.97); g.fill();
  }
  g.save();
  const fs = size * 1.05;
  g.translate(size / 2 - fs / 2, size * 0.56 - fs * 0.48);
  drawFace4(g, fs, { eyes: cfg.eyes, iris: cfg.iris, expr: "neutral" });
  g.restore();
  return cv.toDataURL();
}

// ---------------- 3D item thumbnails (the Style screen's tiles) ----------------
// the item on its own, lit like the stage, framed to its bounds; one small
// offscreen renderer, one render at a time, cached per item (+ hair colour)
const thumbCache = new Map();
let thumbR = null, thumbQ = Promise.resolve();
export function pieceThumb4(id, { hairColor = "darkbrown", size = 160 } = {}) {
  const def = ITEMS4[id];
  const key = `${id}/${def?.cat === "hair" ? hairColor : ""}/${size}`;
  if (!def) return Promise.reject(new Error("no such item"));
  if (!thumbCache.has(key)) thumbCache.set(key, thumbQ = thumbQ.catch(() => {}).then(async () => {
    if (!def.file) return codeThumb(id, size);
    const [meshes] = await Promise.all([loadItem(id), loadAvatar4()]);
    if (!thumbR) { thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbR.outputColorSpace = THREE.SRGBColorSpace; }
    thumbR.setSize(size, size, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeef3ff, 0x5a6aa8, 2.2));
    const k = new THREE.DirectionalLight(0xfff3dc, 1.7); k.position.set(4, 10, 12); scene.add(k);
    const rim = new THREE.DirectionalLight(0xffd57a, 1.2); rim.position.set(-6, 6, -8); scene.add(rim);
    const g = new THREE.Group(), mats = [];
    meshes.forEach((src, k) => { const m = itemMaterial(src.material.map, def, { hairColor }, null, !!src.geometry.attributes._edgecol); mats.push(m); g.add(new THREE.Mesh(fitted(id, k, src.geometry, []), m)); });
    g.rotation.y = def.cat === "shoes" ? -0.6 : /backpack|skateboard/.test(id) ? Math.PI - 0.4 : 0.35;
    scene.add(g); g.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.001, 50);
    cam.position.set(c.x, c.y + r * (def.cat === "shoes" ? 1.6 : 0.4), c.z + r / Math.tan(15 * Math.PI / 180)); cam.lookAt(c);
    await thumbR.compileAsync?.(scene, cam);
    thumbR.render(scene, cam);
    const url = thumbR.domElement.toDataURL("image/png");
    mats.forEach(m => m.dispose());
    return url;
  }));
  return thumbCache.get(key);
}
// the code-made face things: the face layer with the decal, or the hoops
function codeThumb(id, size) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const g = cv.getContext("2d");
  g.fillStyle = "rgb(228,182,146)"; g.beginPath(); g.arc(size / 2, size * 0.52, size * 0.4, 0, Math.PI * 2); g.fill();
  if (id === "hoops") {
    g.strokeStyle = "#e8c25a"; g.lineWidth = size * 0.035;
    for (const x of [0.1, 0.9]) { g.beginPath(); g.arc(size * x, size * 0.66, size * 0.07, 0, Math.PI * 2); g.stroke(); }
  }
  const fs = size * 1.05;
  g.save(); g.translate(size / 2 - fs / 2, size * 0.5 - fs * 0.5);
  drawFace4(g, fs, { decal: ITEMS4[id].code === "decal" ? id : null });
  g.restore();
  return cv.toDataURL();
}

// ---------------- the names every screen already uses ----------------
export const SKIN_RGB = SKIN4_RGB, HAIR_RGB = HAIR4_RGB;
export const normalizeAvatar = normalizeAvatar4;
export const makeHumanCharacter = makeCharacter4, makeAnimatedCharacter = makeCharacter4;
export const makeHumanCharacterSync = makeCharacter4Sync;
export const loadHumanTemplate = loadAvatar4, loadAnimTemplate = loadAvatar4;
export const avatarThumb = avatarThumb4, pieceThumb = pieceThumb4;
