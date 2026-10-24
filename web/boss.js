// The Ritual's host, The Boss: an old mafia boss whose only clown is his
// face paint, sitting back in a folding chair behind the table in a plain
// gray basement (basement.js: the room, camera-mapped from the approved
// picture). Him: one rigged low-poly mesh (games/ritual/boss/boss.glb, see
// docs/npc_scenes.md); the cigar and his rings ride his left hand, the
// capsule his right. He's lit live, soft and even like the picture, the
// lamp's warmth from the left. Animations are procedural on the bones,
// quick and settled (no float):
//   idle    slow breathing, now and then a slow drag on the cigar and an
//           exhale, a slight head tilt
//   reach   leans forward and takes a capsule out of the box
//   hold    holds the capsule up to the camera (the chosen player's face
//           inside, their name under it)
//   twist   twists it open: pop, the lid flies off
//   peek    peeks inside, an eyebrow up, a tiny smirk
//   shhh    a finger to his painted lips
//   nod     a slow approving nod
//   sip     a sip of his coffee (a tap on the cup)
// Small life: a thin wisp from the cigar, a slow haze, a very subtle lamp
// flicker (basement.js).
//
// Look around: the same camera as Side Quest's Prophet (npcstage.js): drag
// to orbit, pinch, it glides home; hold(true) keeps it home for the pick
// and the reveal. His head follows the camera a little.
//
//   const b = await bossScene(hostEl);
//   b.capsule(faceUrl, "alice"); b.setPose("reach"); b.play("twist"); b.hold(true);
//   b.onTap = kind => ...;   // "boss" | "box" | "cup" | "lamp" (true: he reacts)
//   b.capsuleRect();          // the capsule on screen (the slip flies out of it)
//   b.attach(otherEl); b.dispose();
import { retroStage, THREE } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { basementRoom, PROJ, TABLE, BOX, CUP, CHAIR } from "./basement.js";
import { viewFrom, orbitCamera, pickTap, headFollow, encode, underTable, softDot, smokeWisp } from "./npcstage.js";

const ART = new URL("./games/ritual/boss/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the stage: display-ready colour (the room's paint is the picture itself),
// soft gray light, no bloom; a slightly soft render a little under screen
// resolution (the same settings as the Prophet's)
export const BOSS_MOOD = {
  scale: 1.0, maxW: 560, smooth: true, msaa: 4, encoded: true,
  bg: 0x505052,
  fog: { color: 0x505052, near: 30, far: 60 },
  ambient: { sky: 0xeeeae6, ground: 0x8a8480, intensity: 1.4 },
  key: { color: 0xfff2e6, intensity: 0.38, pos: [-1.2, 2.4, 2.6] },
  fill: { color: 0xe6ecf6, intensity: 0.3, pos: [1.8, 1.4, 2.4] },
  bloom: false,
  grade: { tint: [1, 1, 1], sat: 1, contrast: 1, lift: 0 },
  levels: 255, dither: 0, vignette: 0, grain: 0,
};

// the default view: the picture's camera, orbiting a point by the box
export const VIEW = viewFrom(PROJ, 3.0);

// ---------------------------------------------------------------- the poses
// Euler targets per bone, on top of the model's rest pose (standing, arms
// hanging). SIT is the base; the others add to it. Left is his left (+x,
// screen right).
export const SIT = {
  hips: [0, 0, 0],
  thigh_L: [-1.45, 0, 0.12], thigh_R: [-1.45, 0, -0.12], shin_L: [1.35, 0, -0.05], shin_R: [1.35, 0, 0.05],
  spine: [-0.14, 0, 0], chest: [-0.06, 0, 0], neck: [0.12, 0, 0], head: [0.06, 0.05, 0.08],   // sitting back, chest out, the head a little to one side
  // his left: the cigar up by his face, elbow out; his right: the forearm
  // resting on the box's edge (solved on the rig for the picture's elbows and wrists)
  upperarm_L: [-0.974, -0.349, 0.182], forearm_L: [-1.05, 0.056, -0.154], hand_L: [0.2, 0, 0],
  upperarm_R: [-0.946, 0.212, 0.23], forearm_R: [-0.017, 0.116, 0.255], hand_R: [0.7, 0, 0],
};
export const POSES = {
  idle: {},
  // leaning in, the right hand down into the box (solved on the rig)
  reach: { spine: [0.32, 0, 0], chest: [0.12, 0, 0], head: [0.1, 0, -0.05],
    upperarm_R: [-0.463, 0.026, 0.21], forearm_R: [-0.082, 0.148, 0.55], hand_R: [-0.1, 0, 0] },
  // the capsule held up to the camera in his right hand, in front of his chest
  hold: { spine: [0.08, 0, 0], head: [-0.04, 0, -0.04],
    upperarm_R: [-0.239, -0.324, 0.394], forearm_R: [-0.132, 0.052, 0.229], hand_R: [-0.9, 0.0, 0.0] },
  // peeking into it, held close under his chin
  peek: { spine: [0.12, 0, 0], chest: [0.06, 0, 0], neck: [0.15, 0, 0], head: [0.25, 0.12, 0.1],
    upperarm_R: [-0.016, -0.172, 0.347], forearm_R: [-0.227, 0.043, 0.38], hand_R: [-1.0, 0.0, 0.0] },
  // a finger to his lips
  shhh: { spine: [0.04, 0, 0], head: [-0.02, 0, 0],
    upperarm_R: [0.05, -0.203, 0.434], forearm_R: [-0.713, -0.181, 0.747], hand_R: [-0.6, 0.2, -0.3] },
  // the nod itself is animated; this is its lean back
  nod: { spine: [-0.03, 0, 0], chest: [-0.03, 0, 0] },
};
const BONES = ["hips", "spine", "chest", "neck", "head", "upperarm_L", "upperarm_R", "forearm_L", "forearm_R", "hand_L", "hand_R", "thigh_L", "thigh_R", "shin_L", "shin_R"];

// where he sits: in the chair (on its right-hand part, as in the picture),
// facing the camera; the model is 1 tall, he's a big man
export const SEAT = { x: -0.12, z: -0.66, turn: 0.0, scale: 2.05, wide: 1.06, hipY: 0.6 };

export async function bossScene(host) {
  const st = await retroStage(host, BOSS_MOOD);
  const { scene, camera } = st;
  camera.near = 0.05; camera.far = 30;
  const room = await basementRoom(st);
  const ty = TABLE.y;

  // his light: soft and even; the lamp's warmth from the left
  const LIGHT = { lamp: 0.55 };
  const lampLight = new THREE.PointLight(0xffd8a8, LIGHT.lamp, 2.2, 1.6); lampLight.position.set(-0.48, ty + 0.4, 0.3); scene.add(lampLight);

  // ---- him: lit live, in the table's shadow below its top (npcstage.js)
  const g = await new GLTFLoader().loadAsync(`${ART}boss.glb`);
  const model = g.scene;
  model.scale.setScalar(SEAT.scale);
  const bone = {}, hitMeshes = [];
  model.traverse(o => {
    if (o.isBone) bone[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      const m = o.material;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 2; }
      o.material = new THREE.MeshLambertMaterial({ map: m.map ?? null, color: 0xffffff });
      o.material.onBeforeCompile = underTable(TABLE);
      hitMeshes.push(o);
    }
  });
  model.position.set(SEAT.x, SEAT.hipY - 0.46 * SEAT.scale, SEAT.z); model.rotation.y = SEAT.turn;
  model.scale.x *= SEAT.wide;                            // the jacket's breadth
  scene.add(model);
  const rest = {};
  for (const n of BONES) if (bone[n]) rest[n] = bone[n].quaternion.clone();
  // the picture's proportions: a big man, a smaller head than the turnaround's
  bone.head?.scale.setScalar(0.82);
  for (const n of ["hand_L", "hand_R"]) bone[n]?.scale.setScalar(0.86);

  // ---- props on his hands (in the hand bones' space: model units, the rest
  // pose's axes; a hanging hand points down -y, its palm faces in)
  const lit = (color, o = {}) => { const m = new THREE.MeshLambertMaterial({ color, ...o }); m.onBeforeCompile = encode; return m; };
  // the cigar between his fingers, its ember, a gold ring or two
  const cigar = new THREE.Group();
  const cBody = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0095, 0.085, 8), lit(0x4a2c1c)); cBody.rotation.z = Math.PI / 2; cigar.add(cBody);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0098, 0.0098, 0.01, 8), lit(0xc8a040)); band.rotation.z = Math.PI / 2; band.position.x = -0.026; cigar.add(band);
  const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 8), lit(0x9a3a22, { emissive: 0xd04010, emissiveIntensity: 0.35 }));
  ember.rotation.z = Math.PI / 2; ember.position.x = 0.044; cigar.add(ember);
  const tipAnchor = new THREE.Object3D(); tipAnchor.position.x = 0.05; cigar.add(tipAnchor);
  cigar.position.set(0.0, -0.075, 0.03); cigar.rotation.set(0, -0.5, 0.9);
  bone.hand_L?.add(cigar);
  const ringM = lit(0xd8ac3a, { emissive: 0x5a3c08, emissiveIntensity: 0.4 });
  for (const [x, y] of [[0.006, -0.055], [-0.008, -0.06]]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0035, 5, 10), ringM); r.position.set(x, y, 0.004); r.rotation.x = Math.PI / 2; bone.hand_L?.add(r); }
  // the index finger he raises for "shhh" (his right; the model's hand is a
  // loose fist): drawn each frame from his knuckles up to his painted lips
  const finger = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lit(0x8a6450)); finger.visible = false; scene.add(finger);
  const knuck = new THREE.Object3D(); knuck.position.set(0.01, -0.07, 0.035); bone.hand_R?.add(knuck);
  const lips = new THREE.Object3D(); lips.position.set(0, 0.012, 0.115); bone.head?.add(lips);
  // a smoke wisp from the cigar's tip; an exhale from his mouth
  const smokeTex = softDot([[0, "rgba(255,255,255,.9)"], [0.4, "rgba(235,235,235,.35)"], [1, "rgba(220,220,220,0)"]]);
  const wisp = smokeWisp(scene, smokeTex, { n: 14, color: 0xe4e4e8, rise: 0.45, speed: 0.2, base: 0.1, thick: 0.08 });
  const mouth = new THREE.Object3D(); mouth.position.set(0, 0.86 - 0.805, 0.1); bone.head?.add(mouth);
  const breath = smokeWisp(scene, smokeTex, { n: 10, color: 0xe8e8ec, rise: 0.3, speed: 0.5, base: 0, thick: 0.14 });

  // ---- the capsule: a coloured dome over a white cup, the chosen player's
  // face inside, their name under it; it rides his right hand
  const capsule = new THREE.Group();
  const CR = 0.055;
  const cupMesh = new THREE.Mesh(new THREE.SphereGeometry(CR, 14, 7, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lit(0xf2f0ec));
  const lid = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(CR * 1.01, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x8ac8ff, transparent: true, opacity: 0.45, depthWrite: false }));
  dome.material.onBeforeCompile = encode; dome.renderOrder = 4; lid.add(dome);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(CR * 1.0, 0.004, 5, 18), lit(0xd8d4cc)); rim.rotation.x = Math.PI / 2; capsule.add(rim);
  capsule.add(cupMesh, lid);
  const faceSp = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  faceSp.material.onBeforeCompile = encode; faceSp.scale.setScalar(CR * 1.7); faceSp.position.y = CR * 0.25; faceSp.renderOrder = 3.5; capsule.add(faceSp);
  const nameCv = document.createElement("canvas"); nameCv.width = 256; nameCv.height = 64;
  const nameTex = new THREE.CanvasTexture(nameCv); nameTex.colorSpace = THREE.SRGBColorSpace;
  const nameSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
  nameSp.material.onBeforeCompile = encode; nameSp.scale.set(0.24, 0.06, 1); nameSp.renderOrder = 6; scene.add(nameSp);   // under it, on screen (placed each frame)
  capsule.position.set(0.0, -0.09, 0.045); capsule.visible = false;
  bone.hand_R?.add(capsule);
  const capAnchor = new THREE.Object3D(); capsule.add(capAnchor);
  const LID_COLS = [0x8ac8ff, 0xff8ab0, 0xffd060, 0x9ef08a, 0xc8a0ff];
  const texL = new THREE.TextureLoader();
  function setCapsule(url, name) {
    if (url && faceSp.material.map?.userData.url !== url) {
      texL.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.userData.url = url; const old = faceSp.material.map; faceSp.material.map = t; faceSp.material.needsUpdate = true; if (old && old !== t) old.dispose(); });
    }
    faceOn = url ? 1 : 0;
    const x = nameCv.getContext("2d");
    x.clearRect(0, 0, 256, 64);
    if (name) {
      x.font = "600 30px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Apple SD Gothic Neo', system-ui, sans-serif";
      const w = Math.min(240, x.measureText(name).width + 28);
      x.fillStyle = "rgba(12, 22, 56, .92)"; x.beginPath(); x.roundRect((256 - w) / 2, 8, w, 48, 12); x.fill();
      x.fillStyle = "#f4f7ff"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(name, 128, 33, 220);
      let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      dome.material.color.setHex(LID_COLS[h % LID_COLS.length]);
    }
    nameTex.needsUpdate = true; nameOn = name ? 1 : 0;
  }
  let faceOn = 0, nameOn = 0, capState = "hidden", lidT = 9;
  // "hidden" | "inhand" (shut) | "open" (the lid off)
  function capsuleState(s) {
    if (s === capState) return;
    if (s === "open") lidT = 0;
    if (s !== "open") { lid.position.set(0, 0, 0); lid.rotation.set(0, 0, 0); lid.visible = true; dome.material.opacity = 0.45; }
    capState = s; capsule.visible = s !== "hidden";
  }

  // ---- looking around (npcstage.js, shared with the Prophet)
  const orbit = orbitCamera(st, VIEW, { onTap: (x, y) => tap(x, y), rise: yaw => Math.max(0, -yaw - 0.35) * 0.3 });
  const { view, want } = orbit;

  // ---- taps: him, the box, the cup, the lamp
  const targets = [...room.targets, { kind: "boss", objs: hitMeshes }];
  const api = { onTap: null };
  function tap(cx, cy) {
    const best = pickTap(st, targets, cx, cy);
    if (!best) return;
    const ok = api.onTap?.(best.kind);
    room.poke(best.kind);
    if (best.kind === "lamp") lampPokeT = 0;
    if (best.kind === "cup" && ok) play("sip");
    if (best.kind === "boss" && ok) play(Math.random() < 0.5 ? "drag" : "nod");
  }

  // ---- poses: target eulers per bone, blended quickly (critically damped, no float)
  let poseName = "idle", poseT = 0, lampPokeT = 9, lampFade = 1;
  const boxC = new THREE.Vector3(BOX.x, TABLE.y + 0.15, BOX.z);
  const target = {}, cur = {};
  for (const n of BONES) { cur[n] = new THREE.Vector3(...(SIT[n] ?? [0, 0, 0])); target[n] = new THREE.Vector3(); }
  function setPose(name) {
    if (!POSES[name]) name = "idle";
    if (name === "nod") { play("nod"); name = "idle"; }
    if (name !== poseName) poseT = 0;
    poseName = name;
  }
  // one-off animations on top of the pose: [name, start, length]
  const acts = new Map();
  const LEN = { drag: 3.2, nod: 1.6, twist: 1.0, sip: 3.0, smirk: 1.8 };
  function play(name) { if (LEN[name]) acts.set(name, 0); if (name === "twist") lidT = 9; }
  const env = (k, a = 0.25, b = 0.25) => Math.min(1, k / a, (1 - k) / b);          // a ramp up, hold, ramp down (0..1)
  const ease = k => k * k * (3 - 2 * k);
  let nextDrag = 4 + Math.random() * 4;
  const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), bp = new THREE.Vector3(), cp = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), pq = new THREE.Quaternion();

  st.onFrame((t, dt) => {
    const still = reduce();
    orbit.update(t, dt);
    poseT += dt;
    // ---- him: the seated base + this pose + small life
    const P = POSES[poseName];
    for (const n of BONES) {
      const b = SIT[n] ?? [0, 0, 0], p = P[n] ?? [0, 0, 0];
      target[n].set(b[0] + p[0], b[1] + p[1], b[2] + p[2]);
    }
    headFollow(target, view);
    for (const [name, a] of acts) { const k = a + dt / LEN[name]; if (k >= 1) acts.delete(name); else acts.set(name, k); }
    if (!still) {
      const br = Math.sin(t * 1.1);                                   // breathing, slow
      target.chest.x += br * 0.016; target.spine.x += br * 0.008;
      target.upperarm_L.z += br * 0.01; target.upperarm_R.z -= br * 0.01;
      if (poseName === "idle") {
        target.head.z += Math.sin(t * 0.33) * 0.05 * Math.max(0, Math.sin(t * 0.11));   // a slight tilt now and then
        target.head.y += Math.sin(t * 0.21 + 1) * 0.04;
        nextDrag -= dt;
        if (nextDrag < 0) { nextDrag = 9 + Math.random() * 7; if (!acts.has("sip")) play("drag"); }
      }
    }
    // a drag: the cigar to his lips, a slow pull, back down; then he exhales
    let exhale = 0;
    if (acts.has("drag")) {
      const k = acts.get("drag"), e = ease(env(k, 0.3, 0.3));
      target.upperarm_L.x -= 0.05 * e; target.upperarm_L.z -= 0.45 * e; target.forearm_L.x -= 0.35 * e; target.forearm_L.y += 0.55 * e; target.hand_L.x -= 0.2 * e;
      target.head.y += 0.12 * e; target.head.x -= 0.06 * e;
      if (k > 0.72) exhale = Math.sin((k - 0.72) / 0.28 * Math.PI);
    }
    // a sip: the left hand to the cup and up (the cup rides it), back down
    if (acts.has("sip")) {
      const k = acts.get("sip"), e = ease(env(k, 0.3, 0.3)), lift = ease(Math.max(0, Math.min(1, (k - 0.3) / 0.15))) * (1 - ease(Math.max(0, Math.min(1, (k - 0.62) / 0.12))));
      target.upperarm_L.x -= 0.3 * e; target.upperarm_L.z -= 0.55 * e; target.forearm_L.x += 1.1 * e - 1.3 * lift; target.forearm_L.y += 0.3 * e;
      target.head.x -= 0.12 * lift;
    }
    // the slow approving nod: two dips, then settle
    if (acts.has("nod")) { const k = acts.get("nod"); target.head.x += Math.sin(k * Math.PI * 2) * 0.14 * (1 - k * 0.5); target.neck.x += Math.sin(k * Math.PI * 2) * 0.05; }
    // the twist: the right wrist turns, the lid comes loose
    if (acts.has("twist")) { const k = acts.get("twist"); target.hand_R.y += Math.sin(k * Math.PI * 3) * 0.35 * (1 - k); }
    // the smirk: an eyebrow-up head cock
    if (acts.has("smirk")) { const k = acts.get("smirk"), e = env(k, 0.2, 0.3); target.head.z -= 0.12 * e; target.head.x -= 0.05 * e; }
    const kb = 1 - Math.exp(-dt * 8);
    for (const n of BONES) {
      if (!bone[n]) continue;
      cur[n].lerp(target[n], kb);
      tmpE.set(cur[n].x, cur[n].y, cur[n].z);
      bone[n].quaternion.copy(rest[n]).multiply(tmpQ.setFromEuler(tmpE));
    }

    // ---- "shhh": the finger from his knuckles to his lips, once the hand's there
    finger.visible = poseName === "shhh" && poseT > 0.45;
    if (finger.visible) {
      // upright across his lips, its base on his fist
      knuck.getWorldPosition(bp); lips.getWorldPosition(cp);
      const fwd = camera.position.clone().sub(cp).normalize().multiplyScalar(0.035);   // just in front of the face
      cp.add(fwd);
      const top = cp.y + 0.03, bot = Math.min(bp.y + 0.02, cp.y - 0.05);
      finger.position.set(cp.x, (top + bot) / 2, Math.max(cp.z, bp.z + 0.02));   // in front of his fist too
      finger.quaternion.identity();
      finger.scale.set(0.034, Math.max(0.02, top - bot), 0.034);
    }
    // ---- the capsule: its dome turned to the camera (the face inside it,
    // the name under it), the face fades in, the lid pops off and flies
    if (capState !== "hidden") {
      capsule.parent.updateWorldMatrix(true, false);
      capsule.getWorldPosition(cp);
      bp.copy(camera.position).sub(cp).normalize().lerp(UP, 0.35).normalize();
      capsule.parent.getWorldQuaternion(pq);
      capsule.quaternion.copy(pq.invert()).multiply(tmpQ.setFromUnitVectors(UP, bp));
      nameSp.position.copy(cp).y -= 0.11;
    }
    faceSp.material.opacity += ((capState !== "hidden" ? faceOn * 0.95 : 0) - faceSp.material.opacity) * Math.min(1, dt * 8);
    nameSp.material.opacity += ((capState !== "hidden" && poseName === "hold" ? nameOn : 0) - nameSp.material.opacity) * Math.min(1, dt * 8);
    if (capState === "open") {
      lidT += dt;
      const k = Math.min(1, lidT / 0.7);
      lid.position.set(k * 0.06, Math.sin(k * Math.PI) * 0.08 + k * 0.02, k * 0.03); lid.rotation.set(0, k * 6, k * 1.4);
      dome.material.opacity = 0.45 * (1 - k); lid.visible = k < 1;
    }
    // ---- the room's life; a lamp tap flickers his light too
    room.update(t, dt);
    lampPokeT += dt;
    lampLight.intensity = LIGHT.lamp * room.lampLevel;
    // the lamp out of the way when it stands between the camera and him / the box
    const lp = bp.copy(room.lamp.position); lp.y += 0.3;
    const lampD = lp.distanceTo(camera.position), boxD = boxC.distanceTo(camera.position);
    lp.project(camera); const bq = cp.copy(boxC).project(camera);
    const sep = Math.hypot((lp.x - bq.x) * camera.aspect, lp.y - bq.y);
    const fadeTo = lampD < boxD && sep < 0.5 ? 0.18 + Math.max(0, sep - 0.25) * 2.5 : 1;
    lampFade += (Math.min(1, fadeTo) - lampFade) * Math.min(1, dt * 6);
    room.lampFade(lampFade > 0.995 ? 1 : lampFade);
    // ---- smoke: the wisp off the ember; an exhale from his mouth
    wisp.update(tipAnchor, t, dt, 0, capState === "hidden" || poseName !== "shhh" ? 1 : 0.6);
    breath.update(mouth, t, dt, exhale);
  });

  Object.defineProperty(api, "pose", { get: () => poseName });
  return Object.assign(api, {
    stage: st,
    setPose, play, capsule: setCapsule, capsuleState,
    push: orbit.push,
    // glide back to the default view and stay there (the key moments)
    hold: orbit.hold,
    capsuleRect: () => st.rectOf(capAnchor, CR * SEAT.scale * 1.6),
    attach: el => st.attach(el),
    dispose: () => { orbit.dispose(); room.dispose(); smokeTex.dispose(); nameTex.dispose(); st.dispose(); },
    // for tests and tuning: the scene's parts
    debug: { scene, camera, model, bone, view, want, SIT, POSES, VIEW, SEAT, T: orbit.T, tap, rest, room, capsule, cigar, finger, lights: { lampLight, hemi: st.lights.hemi }, LIGHT, acts, cur },
  });
}
