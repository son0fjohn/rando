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

import { ITEMS4, HAIR4_RGB, SKIN4_RGB, SLOTS4, PART_OPTIONS4, DEFAULT_AVATAR4, normalizeAvatar4, EMOTES4 } from "./items4.js";
export { ITEMS4, HAIR4_RGB, SKIN4_RGB, SLOTS4, PART_OPTIONS4, DEFAULT_AVATAR4, normalizeAvatar4, EMOTES4 };
const TEE_RGB = [214, 214, 216], SHORTS_RGB = [150, 152, 158];

const lin = (rgb, out = new THREE.Color()) => out.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);

// ---------------- the clay material ----------------
// Lambert (per-pixel, matte), its map read as the region mask. Clothes hide
// what's under them by discarding body pixels: the tee / shorts regions,
// and bands of the rest pose's height (feet under shoes, the scalp under a
// hat), so nothing pokes through in any pose.
function bodyMaterial(mask) {
  const U = {
    uSkin: { value: new THREE.Color() }, uTee: { value: lin(TEE_RGB) }, uShorts: { value: lin(SHORTS_RGB) },
    uFace: { value: null }, uHide: { value: new THREE.Vector4(0, 0, -1, 9) }, // tee, shorts, below y, above y
    uHideArms: { value: 0 }, uHideLegs: { value: 0 }, uScalp: { value: new THREE.Vector4(0, 0, 0, 0) }, // rgb, on
  };
  const m = new THREE.MeshLambertMaterial({ map: mask });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 faceUv; attribute float _facew; varying vec2 vFaceUv; varying float vFaceW; varying vec3 vRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFaceUv = faceUv; vFaceW = _facew; vRest = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uSkin, uTee, uShorts; uniform sampler2D uFace; uniform vec4 uHide, uScalp; uniform float uHideArms, uHideLegs;
varying vec2 vFaceUv; varying float vFaceW; varying vec3 vRest;`)
      .replace("#include <map_fragment>", `
vec3 rg = texture2D(map, vMapUv).rgb;
float bodyM = step(vRest.y, 0.76) / max(rg.r + rg.g + rg.b, 1e-3);
float tee = rg.g * bodyM, shorts = rg.b * bodyM;
// arms: out past the shoulders, above the wrists; legs: below the hips
float arm = step(0.115, abs(vRest.x)) * step(0.505, vRest.y) * step(vRest.y, 0.72);
float leg = step(vRest.y, 0.42) * step(abs(vRest.x), 0.13);
if ((uHide.x > 0.5 && tee > 0.5) || (uHide.y > 0.5 && shorts > 0.5) || vRest.y < uHide.z || vRest.y > uHide.w
    || (uHideArms > 0.5 && arm > 0.5 && tee + shorts < 0.5) || (uHideLegs > 0.5 && leg > 0.5)) discard;
vec3 col = uSkin * (1.0 - tee - shorts) + uTee * tee + uShorts * shorts;
// under hair the scalp takes the hair's colour (no skin through gaps between locks)
float ear = step(0.085, abs(vRest.x)) * step(vRest.y, 0.905);
float scalp = uScalp.w * (1.0 - ear) * max(smoothstep(0.935, 0.955, vRest.y - max(vRest.z, 0.0) * 0.4 + 0.02),
  smoothstep(0.0, -0.03, vRest.z) * smoothstep(0.8, 0.83, vRest.y));
col = mix(col, uScalp.rgb, scalp);
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
function itemMaterial(map, def, cfg) {
  const keys = [], cols = [];
  const tints = typeof def.tint === "function" ? def.tint(cfg) : def.tint ?? [];
  for (const [k, c] of tints.slice(0, 3)) { keys.push(lin(k)); cols.push(lin(c)); }
  while (keys.length < 3) { keys.push(new THREE.Color(-9, -9, -9)); cols.push(new THREE.Color()); }
  const U = { uKey: { value: keys }, uCol: { value: cols }, uAll: { value: def.cat === "hair" ? 1 : 0 } };
  const m = new THREE.MeshLambertMaterial({ map, side: def.doubleSide ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uKey[3], uCol[3]; uniform float uAll;")
      .replace("#include <map_fragment>", `
vec4 tx = texture2D(map, vMapUv);
vec3 c = tx.rgb;
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
  m.customProgramCacheKey = () => "rando-item4";
  return m;
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
    // hats over hair: a hat's def says how much hair stays (hairCut: y in
    // rest-pose units; the hair above it is clipped)
    const hide = { tee: 0, shorts: 0, below: -1, above: 9, arms: 0, legs: 0 };
    for (const id of ids) {
      const h = ITEMS4[id].hides ?? {};
      if (h.tee) hide.tee = 1; if (h.shorts) hide.shorts = 1; if (h.arms) hide.arms = 1; if (h.legs) hide.legs = 1;
      if (h.below != null) hide.below = Math.max(hide.below, h.below);
      if (h.above != null) hide.above = Math.min(hide.above, h.above);
    }
    U.uHide.value.set(hide.tee, hide.shorts, hide.below, hide.above);
    U.uHideArms.value = hide.arms; U.uHideLegs.value = hide.legs;
    // the scalp under hair takes the hair colour; under a hat, the hat's (no
    // skin through the gaps either way)
    const hairDef = ITEMS4[cfg.hair];
    const scalpRgb = hat?.scalp ?? (hairDef?.scalp ? HAIR4_RGB[cfg.hairColor] ?? HAIR4_RGB.black : null);
    if (scalpRgb) { const c = lin(scalpRgb); U.uScalp.value.set(c.r * 0.75, c.g * 0.75, c.b * 0.75, 1); }
    else U.uScalp.value.set(0, 0, 0, 0);
    ready = Promise.all(ids.map(id => loadItem(id).then(meshes => {
      if (disposed || my !== epoch) return;
      const def = ITEMS4[id];
      for (const src of meshes) {
        const mat = itemMaterial(src.material.map, def, cfg);
        if (def.cat === "hair" && hat?.hairCut != null) cutAbove(mat, hat.hairCut);
        const sm = new THREE.SkinnedMesh(src.geometry, mat);
        // its flat colour (the lobby sprites paint parts flat): the tint's, else its own
        const tints = typeof def.tint === "function" ? def.tint(cfg) : def.tint;
        sm.userData.rgb = tints?.[0]?.[1] ?? def.rgb;
        sm.frustumCulled = false; sm.castShadow = true; sm.userData.part = def.cat === "face" ? "facewear" : def.cat;
        body.parent.add(sm);
        sm.bind(skel, body.bindMatrix);
        worn.push(sm);
      }
    }))).then(() => {});
  };

  // hoop earrings, made in code: a small gold ring hanging from each ear, on the head bone
  const hoops = () => [-1, 1].map(side => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0028, 8, 24), new THREE.MeshLambertMaterial({ color: 0xe8c25a, emissive: 0x3a2a08 }));
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
  const STRIDE = 7.2;
  const fold = x => Math.max(0, x);
  // idle: arms down from the A-pose, loose; a wider stance, weight on one
  // leg; a slow breathing sway, now and then a little nod. walk: thighs
  // swing, knees fold, arms swing against the legs, a springy bounce.
  const applyMotion = (t, w, p) => {
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
    group.position.y = i * (0.02 + sway * 0.02) + w * 0.3 * Math.abs(Math.sin(p)) + hop * 0.9;
  };
  const faceTick = (t, walking) => {
    if (t > M.nextBlink) { M.blinkUntil = t + 0.13; M.nextBlink = t + 2.2 + Math.random() * 3; }
    if (!walking && t > M.nextNod) { M.nodAt = t; M.nextNod = t + 6 + Math.random() * 5; }
    let show = expr;
    if (expr === "neutral" && t < M.blinkUntil) show = "blink";
    if (show !== M.shownExpr) { M.shownExpr = show; U.uFace.value = faceTex(show); }
  };

  paint(); dress(); applyMotion(0, 0, 0);
  let lastT = null, walkW = 0, walkP = 0;
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
    phase: Math.random() * Math.PI * 2,
    tick(t) {
      const dt = lastT === null ? 0.016 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      walkW += ((this.walking ? 1 : 0) - walkW) * Math.min(1, dt / 0.2);
      walkP += dt * STRIDE * Math.min(1, walkW * 1.5 + 0.2);
      applyMotion(t, walkW, walkP);
      faceTick(t, this.walking);
      emoteTick(t);
    },
  };
}

// hair under a hat: clip everything above the hat's line (rest-pose height)
function cutAbove(mat, y) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    prev(sh);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vRestY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRestY = position.y;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vRestY;")
      .replace("void main() {", `void main() {\n  if (vRestY > ${y.toFixed(4)}) discard;`);
  };
  mat.customProgramCacheKey = () => "rando-item4-cut" + y;
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
    const meshes = await loadItem(id);
    if (!thumbR) { thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbR.outputColorSpace = THREE.SRGBColorSpace; }
    thumbR.setSize(size, size, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeef3ff, 0x5a6aa8, 2.2));
    const k = new THREE.DirectionalLight(0xfff3dc, 1.7); k.position.set(4, 10, 12); scene.add(k);
    const rim = new THREE.DirectionalLight(0xffd57a, 1.2); rim.position.set(-6, 6, -8); scene.add(rim);
    const g = new THREE.Group(), mats = [];
    for (const src of meshes) { const m = itemMaterial(src.material.map, def, { hairColor }); mats.push(m); g.add(new THREE.Mesh(src.geometry, m)); }
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
