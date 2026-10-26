// Manhunt's host, The Hunter: a bounty hunter in an off-white double-
// breasted suit (a fleck or two of red on it), gold aviators, a toothpick,
// a scar on his cheek, a gold watch, slicked black hair, a handheld tracker
// with a green radar screen in his right hand. He leans back on the rail of
// a brushed-steel elevator (elevator.js: the room, camera-mapped from the
// approved picture). One rigged low-poly mesh (games/manhunt/hunter/
// hunter.glb, see docs/npc_scenes.md), lit live by the ceiling panel.
// Animations are procedural on the bones (aimed limbs, blended quickly):
//   idle   leaning on the rail, slow breathing, a glance at the tracker now
//          and then, his head following the camera a little
//   tie    straightens his tie (the left hand out of his pocket and back)
//   tap    holds the tracker up and taps its screen twice (a green blip)
//   point  points the tracker at you
//   smirk  a slow head cock, the corner of his mouth (his toothpick) up
//   nod    a slow nod
// The room's life: the floor counter (live), the light's flicker, the doors.
//
// Look around: the same camera as the other hosts (npcstage.js), ±40° here:
// drag to orbit, pinch, it glides home ~4 s after the last touch.
//
//   const h = await hunterScene(hostEl);
//   h.play("tap"); h.room.counter("B2"); h.room.doors(false); h.room.flicker();
//   h.onTap = kind => ...;   // "hunter" | "panel" | "light" | "counter" (true: he reacts)
//   h.attach(otherEl); h.dispose();
import { retroStage, THREE } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { elevatorRoom, PROJ, cabinToWorld, CABIN_TURN } from "./elevator.js";
import { viewFrom, orbitCamera, pickTap, headFollow, encode, softDot, screenBox } from "./npcstage.js";

const ART = new URL("./games/manhunt/hunter/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the stage: display-ready colour (the room's paint is the picture), the
// ceiling panel's warm light from above, no bloom
export const HUNTER_MOOD = {
  scale: Math.min(1.25, Math.max(1, globalThis.devicePixelRatio || 1)), maxW: 640, smooth: true, msaa: 4, encoded: true,
  bg: 0x2a2622,
  fog: { color: 0x2a2622, near: 30, far: 60 },
  ambient: { sky: 0xfff0dc, ground: 0x6a5e52, intensity: 1.35 },
  key: { color: 0xfff0d8, intensity: 0.75, pos: [-0.3, 2.6, 1.6] },
  fill: { color: 0xd8e0ec, intensity: 0.35, pos: [1.2, 1.4, 3.2] },
  bloom: false,
  grade: { tint: [1, 1, 1], sat: 1, contrast: 1, lift: 0 },
  levels: 255, dither: 0, vignette: 0, grain: 0,
};

// the default view: the picture's camera, orbiting him (±40°)
export const VIEW = viewFrom(PROJ, 3.2, { yawRange: [-0.7, 0.7], pitchRange: [-0.08, 0.18] });

// where he leans: his hips against the back rail (in the picture), turned
// a little off the wall toward the camera; his height (the model is 1 tall)
const HIPS = cabinToWorld(-0.82, 0, 0.12);
export const SPOT = { x: HIPS.x, z: HIPS.z, turn: CABIN_TURN - 0.55, lean: -0.13, side: 0.15, height: 2.15 };

// ---------------------------------------------------------------- the poses
// Spine, neck and head as Euler offsets; arms and legs as directions in his
// own frame (+x his left, +y up, +z forward) for the upper and the lower
// bone, the hand as an Euler twist. LEAN is the picture's pose.
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
export const LEAN = {
  hips: [0, 0, 0], spine: [0.06, 0.04, 0], chest: [0.05, 0.05, 0], neck: [0.02, 0, 0], head: [0.04, -0.08, 0.06],
  // his right: hanging by the rail, the tracker loose at his hip, screen out
  armR: { up: V(-0.32, -0.94, 0.1), fore: V(-0.16, -0.9, 0.4), hand: [0.3, -0.3, 0.3] },
  // his left: the hand in his trouser pocket, the elbow out a little
  armL: { up: V(0.36, -0.92, -0.12), fore: V(-0.32, -0.88, 0.36), hand: [0, 0, -0.2] },
  // the right leg planted, the left crossed over in front of it
  legR: { up: V(-0.06, -0.97, 0.24), low: V(-0.02, -0.99, 0.12) },
  legL: { up: V(-0.18, -0.93, 0.32), low: V(-0.26, -0.96, 0.08) },
};
// the tracker held up in front of his chest, screen to him; the left hand over it
const TAP = {
  armR: { up: V(-0.2, -0.75, 0.62), fore: V(0.45, 0.5, 0.74), hand: [-0.9, 0, 0.4] },
  armL: { up: V(0.25, -0.7, 0.66), fore: V(-0.62, 0.4, 0.68), hand: [0, 0, 0] },
};
export const POSES = {
  idle: {},
  tap: { ...TAP, head: [0.32, 0.02, 0], neck: [0.1, 0, 0] },
  // the tracker pointed at the camera, the arm out
  point: { armR: { up: V(-0.15, -0.05, 0.99), fore: V(-0.05, 0.05, 1), hand: [-1.4, 0, 0] }, spine: [0.02, -0.12, 0], head: [0, -0.06, -0.04] },
};
const EULER_BONES = ["hips", "spine", "chest", "neck", "head"];
const LINES_DEFAULT = ["Going down. Runners, you have a head start."];

export async function hunterScene(host) {
  const st = await retroStage(host, HUNTER_MOOD);
  const { scene, camera } = st;
  camera.near = 0.05; camera.far = 30;
  const room = await elevatorRoom(st);

  // his light: the ceiling panel straight above, warm
  const top = new THREE.PointLight(0xffecd0, 1.3, 4.5, 1.4); top.position.copy(cabinToWorld(-0.55, 2.3, 0.6)); scene.add(top);

  // ---- him
  const g = await new GLTFLoader().loadAsync(`${ART}hunter.glb`);
  const model = g.scene;
  model.scale.setScalar(SPOT.height);
  const bone = {}, hitMeshes = [];
  model.traverse(o => {
    if (o.isBone) bone[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      const m = o.material;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 2; }
      o.material = new THREE.MeshLambertMaterial({ map: m.map ?? null, color: 0xffffff });
      o.material.onBeforeCompile = encode;
      hitMeshes.push(o);
    }
  });
  // the holder: at his hips' spot, turned, leaning back on the rail
  const holder = new THREE.Group(); holder.position.set(SPOT.x, 0, SPOT.z); holder.rotation.y = SPOT.turn; scene.add(holder);
  const tilt = new THREE.Group(); tilt.position.y = 0.47 * SPOT.height; tilt.rotation.set(SPOT.lean, 0, SPOT.side); holder.add(tilt);
  model.position.y = -0.47 * SPOT.height; tilt.add(model);
  const rest = {}, restDir = {};
  for (const n of Object.keys(bone)) rest[n] = bone[n].quaternion.clone();
  const wp = n => { const v = new THREE.Vector3(); bone[n].getWorldPosition(v); return model.worldToLocal(v); };
  model.updateMatrixWorld(true);
  for (const [a, b] of [["upperarm_R", "forearm_R"], ["forearm_R", "hand_R"], ["upperarm_L", "forearm_L"], ["forearm_L", "hand_L"], ["thigh_R", "shin_R"], ["shin_R", "foot_R"], ["thigh_L", "shin_L"], ["shin_L", "foot_L"]])
    restDir[a] = wp(b).sub(wp(a)).normalize();

  // ---- the tracker's screen: a green blip that glows on a tap
  const blipTex = softDot([[0, "rgba(160,255,150,1)"], [0.35, "rgba(60,255,90,.55)"], [1, "rgba(20,200,60,0)"]]);
  const blip = new THREE.Sprite(new THREE.SpriteMaterial({ map: blipTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  blip.material.onBeforeCompile = encode; blip.scale.setScalar(0.12); blip.renderOrder = 5; scene.add(blip);
  const screenAt = new THREE.Object3D(); screenAt.position.set(-0.006, -0.06, 0.02); bone.hand_R?.add(screenAt);

  // ---- the floor-button panel on the side wall (the "floor panel": a tap beeps)
  const lit = (color, o = {}) => { const m = new THREE.MeshLambertMaterial({ color, ...o }); m.onBeforeCompile = encode; return m; };
  const panel = new THREE.Group();
  const plateM = lit(0x9c968e);
  panel.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.012), plateM));
  const btnM = lit(0xd8d2c8, { emissive: 0x201810 }), btnLit = lit(0xfff0c8, { emissive: 0xffb860, emissiveIntensity: 0.9 });
  const buttons = [];
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 14), btnM);
    b.rotation.x = Math.PI / 2; b.position.set(i % 2 ? 0.045 : -0.045, 0.14 - Math.floor(i / 2) * 0.075, 0.008);
    panel.add(b); buttons.push(b);
  }
  const pp = cabinToWorld(-0.012, 1.18, 1.05);
  panel.position.copy(pp); panel.rotation.y = CABIN_TURN - Math.PI / 2; scene.add(panel);
  let litBtn = -1, btnT = 9;

  // ---- looking around
  const orbit = orbitCamera(st, VIEW, { onTap: (x, y) => tap(x, y) });
  const { view, want } = orbit;

  // ---- taps: him, the panel, the light, the counter
  const panelHits = []; panel.traverse(o => o.isMesh && panelHits.push(o));
  const targets = [...room.targets, { kind: "panel", objs: panelHits }, { kind: "hunter", objs: hitMeshes }];
  const api = { onTap: null };
  function tap(cx, cy) {
    const best = pickTap(st, targets, cx, cy);
    if (!best) return;
    const ok = api.onTap?.(best.kind);
    room.poke(best.kind);
    if (best.kind === "panel") { litBtn = Math.floor(Math.random() * buttons.length); btnT = 0; }
    if (best.kind === "hunter" && ok) play(["smirk", "tie", "tap", "nod"][Math.floor(Math.random() * 4)]);
  }

  // ---- poses
  let poseName = "idle";
  const cur = {}, tgt = {};
  const arr = v => (v?.isVector3 ? v.toArray() : v);
  const clonePose = p => JSON.parse(JSON.stringify(p, (k, v) => (v?.isVector3 ? [v.x, v.y, v.z] : v)));
  const base = clonePose(LEAN);
  for (const n of EULER_BONES) { cur[n] = new THREE.Vector3(...base[n]); tgt[n] = new THREE.Vector3(); }
  const LIMBS = { armR: ["upperarm_R", "forearm_R", "hand_R"], armL: ["upperarm_L", "forearm_L", "hand_L"], legR: ["thigh_R", "shin_R", null], legL: ["thigh_L", "shin_L", null] };
  for (const k of Object.keys(LIMBS)) {
    const b = base[k];
    cur[k] = { a: new THREE.Vector3(...b.up), b: new THREE.Vector3(...(b.fore ?? b.low)), h: new THREE.Vector3(...(b.hand ?? [0, 0, 0])) };
    tgt[k] = { a: new THREE.Vector3(), b: new THREE.Vector3(), h: new THREE.Vector3() };
  }
  function setPose(name) { if (!POSES[name]) name = "idle"; poseName = name; }
  const acts = new Map();
  const LEN = { tie: 2.6, tap: 2.4, smirk: 1.8, nod: 1.5, point: 2.2, glance: 2.2 };
  function play(name) { if (!LEN[name]) return; acts.set(name, 0); if (name === "tap") taps = [0.45, 0.62]; }
  let taps = [], blipT = 9;
  const env = (k, a = 0.25, b = 0.25) => Math.max(0, Math.min(1, k / a, (1 - k) / b));
  const ease = k => k * k * (3 - 2 * k);
  let nextGlance = 7 + Math.random() * 5;
  const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), qW = new THREE.Quaternion(), qa = new THREE.Quaternion(), qInv = new THREE.Quaternion();
  const dirA = new THREE.Vector3();
  const mixDir = (out, from, to, k) => out.copy(from).lerp(to, k).normalize();
  function aimLimb([up, low, hand], a, b, h, parentW) {
    if (!bone[up]) return;
    qa.setFromUnitVectors(restDir[up], a);
    qInv.copy(parentW).invert();
    bone[up].quaternion.copy(rest[up]).premultiply(qInv.clone().multiply(qa));
    const upW = qW.copy(parentW).multiply(bone[up].quaternion);
    qa.setFromUnitVectors(restDir[low], b);
    bone[low].quaternion.copy(upW.clone().invert().multiply(qa));
    if (hand && bone[hand]) bone[hand].quaternion.copy(rest[hand]).multiply(tmpQ.setFromEuler(tmpE.set(h.x, h.y, h.z)));
  }
  const blendLimb = (k, src, e) => { if (!src) return; mixDir(tgt[k].a, tgt[k].a, dirA.set(...arr(src.up)), e); mixDir(tgt[k].b, tgt[k].b, dirA.set(...arr(src.fore ?? src.low)), e); if (src.hand) tgt[k].h.lerp(dirA.set(...src.hand), e); };

  st.onFrame((t, dt) => {
    const still = reduce();
    orbit.update(t, dt);
    const P = POSES[poseName];
    for (const n of EULER_BONES) { const b = base[n], p = P[n] ?? [0, 0, 0]; tgt[n].set(b[0] + p[0], b[1] + p[1], b[2] + p[2]); }
    for (const k of Object.keys(LIMBS)) {
      const src = P[k] ?? {}, b = base[k];
      tgt[k].a.set(...arr(src.up ?? b.up)); tgt[k].b.set(...arr(src.fore ?? src.low ?? b.fore ?? b.low)); tgt[k].h.set(...arr(src.hand ?? b.hand ?? [0, 0, 0]));
    }
    headFollow(tgt, view);
    for (const [name, a] of acts) { const k = a + dt / LEN[name]; if (k >= 1) acts.delete(name); else acts.set(name, k); }
    if (!still) {
      const br = Math.sin(t * 1.0);
      tgt.chest.x += br * 0.014; tgt.spine.x += br * 0.006;
      if (poseName === "idle") {
        tgt.head.y += Math.sin(t * 0.23 + 1) * 0.05;
        tgt.head.z += Math.sin(t * 0.29) * 0.03;
        nextGlance -= dt;
        if (nextGlance < 0) { nextGlance = 9 + Math.random() * 8; if (!acts.size) play("glance"); }
      }
    }
    // a glance at the tracker: the hand comes up a little, the head goes down to it
    if (acts.has("glance")) {
      const k = acts.get("glance"), e = ease(env(k, 0.3, 0.3));
      blendLimb("armR", { up: V(-0.25, -0.88, 0.4), fore: V(0.15, -0.2, 0.97), hand: [-0.6, 0, 0.4] }, e * 0.85);
      tgt.head.x += 0.3 * e; tgt.head.y -= 0.2 * e;
    }
    // the tie: the left hand out of the pocket, two small tugs at the knot, back
    if (acts.has("tie")) {
      const k = acts.get("tie"), e = ease(env(k, 0.28, 0.28));
      const tug = Math.sin(Math.max(0, (k - 0.3) / 0.4) * Math.PI * 4) * (k > 0.3 && k < 0.7 ? 0.08 : 0);
      blendLimb("armL", { up: V(0.3, -0.62, 0.72), fore: V(-0.55, 0.78 + tug, 0.3), hand: [0.2, 0, -0.4] }, e);
      tgt.head.x -= 0.12 * e; tgt.head.z += 0.06 * e; tgt.neck.x -= 0.06 * e;
    }
    // the tap: the tracker up in front of him, two taps on its screen (the blip)
    if (acts.has("tap")) {
      const k = acts.get("tap"), e = ease(env(k, 0.22, 0.22));
      const press = Math.max(...[0.45, 0.62].map(c => Math.max(0, 1 - Math.abs(k - c) / 0.06)));
      blendLimb("armR", TAP.armR, e);
      blendLimb("armL", { ...TAP.armL, fore: dirA.set(-0.62, 0.4 - press * 0.25, 0.68).normalize().toArray() }, e);
      tgt.head.x += 0.3 * e; tgt.neck.x += 0.1 * e;
      while (taps.length && k >= taps[0]) { taps.shift(); blipT = 0; api.onBlip?.(); }
    }
    // the point: the tracker at you, held, back
    if (acts.has("point")) { const k = acts.get("point"), e = ease(env(k, 0.2, 0.25)); blendLimb("armR", POSES.point.armR, e); tgt.spine.y -= 0.12 * e; }
    // the smirk: a slow head cock, chin up a hair
    if (acts.has("smirk")) { const k = acts.get("smirk"), e = ease(env(k, 0.25, 0.35)); tgt.head.z -= 0.16 * e; tgt.head.x -= 0.08 * e; tgt.head.y += 0.06 * e; }
    if (acts.has("nod")) { const k = acts.get("nod"); tgt.head.x += Math.sin(k * Math.PI) * 0.2; tgt.neck.x += Math.sin(k * Math.PI) * 0.06; }
    // ---- blend, apply
    const kb = 1 - Math.exp(-dt * 8);
    for (const n of EULER_BONES) cur[n].lerp(tgt[n], kb);
    for (const k of Object.keys(LIMBS)) { mixDir(cur[k].a, cur[k].a, tgt[k].a, kb); mixDir(cur[k].b, cur[k].b, tgt[k].b, kb); cur[k].h.lerp(tgt[k].h, kb); }
    for (const n of EULER_BONES) if (bone[n]) bone[n].quaternion.copy(rest[n]).multiply(tmpQ.setFromEuler(tmpE.set(cur[n].x, cur[n].y, cur[n].z)));
    const hipsW = bone.hips.quaternion.clone();
    const chestW = hipsW.clone().multiply(bone.spine.quaternion).multiply(bone.chest.quaternion);
    aimLimb(LIMBS.armR, cur.armR.a, cur.armR.b, cur.armR.h, chestW.clone().multiply(bone.shoulder_R.quaternion));
    aimLimb(LIMBS.armL, cur.armL.a, cur.armL.b, cur.armL.h, chestW.clone().multiply(bone.shoulder_L.quaternion));
    aimLimb(LIMBS.legR, cur.legR.a, cur.legR.b, cur.legR.h, hipsW);
    aimLimb(LIMBS.legL, cur.legL.a, cur.legL.b, cur.legL.h, hipsW);
    model.updateMatrixWorld(true);
    // ---- the blip on the tracker's screen
    blipT += dt;
    screenAt.getWorldPosition(blip.position);
    blip.material.opacity = blipT < 0.5 ? (1 - blipT / 0.5) * 0.9 : (still ? 0 : 0.12 + 0.08 * Math.max(0, Math.sin(t * 2.4)));
    // ---- a lit floor button fades
    btnT += dt;
    buttons.forEach((b, i) => { b.material = i === litBtn && btnT < 2.5 ? btnLit : btnM; });
    top.intensity = 1.3 * room.level;
    room.update(t, dt);
  });

  Object.defineProperty(api, "pose", { get: () => poseName });
  return Object.assign(api, {
    stage: st, room,
    setPose, play,
    playing: name => acts.has(name),
    lines: LINES_DEFAULT,
    push: orbit.push,
    home: orbit.home,
    attach: el => st.attach(el),
    dispose: () => { orbit.dispose(); room.dispose(); blipTex.dispose(); st.dispose(); },
    debug: { hostRect: () => screenBox(st, model), base, scene, camera, model, holder, tilt, bone, view, want, LEAN, POSES, VIEW, SPOT, T: orbit.T, tap, rest, restDir, room, acts, cur, panel, lights: { top, hemi: st.lights.hemi } },
  });
}
