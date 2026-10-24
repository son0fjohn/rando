// Side Quest's host, The Prophet, sitting cross-legged on the floor behind a
// low table in a rooftop room at night (rooftop.js: the room, camera-mapped
// from the approved picture). Him: one rigged low-poly mesh
// (games/sidequest/prophet/prophet.glb, see docs/npc_scenes.md): his hat and
// durag tails ride the head bone, the pipe is in his mouth, the chain on his
// chest. He's lit live, by lights where the picture's are (the lamp on the
// left, the TV's pink, the door's night blue, the string lights). Poses are
// procedural, blended on the bones, quick and settled (no float):
//   idle   slow breathing, a slight head tilt now and then, a pipe puff
//   reveal leans in, hands hovering over the ball, the ball brightens
//   point  points at the one the ball chose (at the camera: at you)
//   nod    a smug nod to close a turn
// Small life: a thin wisp of smoke from the pipe, the ball's soft glow, the
// lamp, the TV and the string lights, a slow camera push-in on the key moments.
//
// Look around (npcstage.js, the same camera as the Ritual's Boss): drag to
// orbit, pinch to zoom a bit, it glides home ~3 s after the last touch;
// hold(true) keeps it home (the game does that for the pick and the
// reveal). His head turns a little toward the camera. Tap him (onTap("prophet")
// decides whether he reacts: a nod or a pipe puff), the ball (it pulses and
// swirls), the lamp (it flickers) or the TV (a burst of static).
//
//   const p = await prophetScene(hostEl);
//   p.setPose("reveal"); p.orb("spin"); p.face(url, pop); p.push(1); p.hold(true);
//   p.onTap = kind => kind === "prophet" && canTalk();   // "prophet" | "ball" | "lamp" | "tv"
//   p.ballRect();  // the ball on screen, for the card to rise out of
//   p.attach(otherEl); p.dispose();
import { retroStage, THREE, blobShadow } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { rooftopRoom, PROJ, TABLE } from "./rooftop.js";
import { viewFrom, orbitCamera, pickTap, headFollow, encode, underTable, softDot, smokeWisp } from "./npcstage.js";

const ART = new URL("./games/sidequest/prophet/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the stage: display-ready colour (the room's paint is the picture itself),
// no grade, no bloom; a slightly soft render a little under screen resolution
export const PROPHET_MOOD = {
  scale: 1.0, maxW: 560, smooth: true, msaa: 4, encoded: true,
  bg: 0x1a1220,
  fog: { color: 0x1a1220, near: 30, far: 60 },
  // his light: a dim purple room, the lamp's warmth from the left, the TV's pink, the door's blue
  ambient: { sky: 0xc890d0, ground: 0x5a2a50, intensity: 1.1 },
  key: { color: 0xffd6c0, intensity: 0.6, pos: [-1.0, 2.0, 2.5] },
  fill: { color: 0xb080ff, intensity: 0.5, pos: [1.5, 1.2, 2.5] },
  bloom: false,
  grade: { tint: [1, 1, 1], sat: 1, contrast: 1, lift: 0 },
  levels: 255, dither: 0, vignette: 0, grain: 0,
};

// the default view: the picture's camera (rooftop.js PROJ), orbiting a point
// on the table (the ranges and timings are npcstage.js ORBIT, shared)
export const VIEW = viewFrom(PROJ, 2.5);

const mat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });

// ---------------------------------------------------------------- the poses
// Euler targets per bone, on top of the model's standing rest pose. SIT is
// the base; the others add to it. Bones: root hips spine chest neck head,
// shoulder/upperarm/forearm/hand _L _R, thigh/shin/foot _L _R. Left is the
// character's left (+x, screen right).
export const SIT = {
  // cross-legged: knees out to the sides, shins crossed in front (solved on the rig)
  thigh_L: [-1.768, 0.303, 0.329], thigh_R: [-1.751, -0.383, -0.207], shin_L: [2.014, 0.312, -1.203], shin_R: [1.94, -0.415, 1.228],
  spine: [0.1, 0, 0], chest: [0.02, 0, 0], neck: [-0.1, 0, 0], head: [-0.02, 0, 0],   // leaning on the table, head up
  // elbows out, forearms on the table's back edge, fists by the ball
  // (solved on the rig for the picture's elbows and fists)
  upperarm_L: [-0.704, -0.603, 0.471], upperarm_R: [-0.694, 0.586, -0.101],
  forearm_L: [-0.63, -0.695, 0.082], forearm_R: [-1.674, 0.135, 0.515],
  hand_L: [0.45, 0, 0.1], hand_R: [0.45, 0, -0.1],
};
export const POSES = {
  idle: {},
  // leans in over the table, both hands reaching out over the ball (solved on the rig)
  reveal: { spine: [0.22, 0, 0], chest: [0.1, 0, 0], head: [-0.06, 0, 0],
    upperarm_L: [-0.381, -0.677, 0.266], upperarm_R: [-0.585, 0.827, -0.491], forearm_L: [0.22, 0.172, 0.231], forearm_R: [0.827, -0.17, -0.605],
    hand_L: [-0.45, 0, 0], hand_R: [-0.45, 0, 0] },
  // his right arm up and out at the camera: at you
  point: { spine: [0.1, 0, 0], chest: [0, -0.12, 0], head: [-0.02, -0.08, -0.06],
    upperarm_R: [-0.584, 0.847, -0.518], forearm_R: [1.338, -0.265, -0.623], hand_R: [-0.2, 0, 0] },
  // the nod itself is animated; this is its lean back
  nod: { spine: [-0.02, 0, 0], chest: [-0.04, 0, 0] },
};
const BONES = ["hips", "spine", "chest", "neck", "head", "upperarm_L", "upperarm_R", "forearm_L", "forearm_R", "hand_L", "hand_R", "thigh_L", "thigh_R", "shin_L", "shin_R"];

// where he sits: on the floor (a flat cushion), left of the ball, turned a little toward the camera
export const SEAT = { x: -0.13, z: -0.45, turn: 0.16, scale: 1.78, wide: 1.1, seatY: 0.17 };

export async function prophetScene(host) {
  const st = await retroStage(host, PROPHET_MOOD);
  const { scene, camera } = st;
  camera.near = 0.05; camera.far = 30;

  // ---- the room (camera-mapped from the picture) and the ball on its stand
  const room = await rooftopRoom(st);
  const TABLE_Y = TABLE.y;
  const R = 0.09, BALL = new THREE.Vector3(0.022, TABLE_Y + 0.065 + R, 0.47);
  const stand = new THREE.Group();
  const sb = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.082, 0.06, 8), mat(0x3a2e4a)); sb.position.y = 0.03; stand.add(sb);
  const sr = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 6, 18), mat(0x2e2440)); sr.rotation.x = Math.PI / 2; sr.position.y = 0.062; stand.add(sr);
  stand.position.set(BALL.x, TABLE_Y, BALL.z); scene.add(stand);
  const glass = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 1), new THREE.MeshLambertMaterial({ color: 0xc8b0f0, emissive: 0x7a5ad0, emissiveIntensity: 0.1, flatShading: true, transparent: true, opacity: 0.94 }));
  glass.position.copy(BALL); glass.renderOrder = 3; scene.add(glass);
  // a face in the ball (drawn over the glass, under its halo), a soft halo around it
  const face = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
  face.scale.setScalar(R * 1.3); face.position.copy(BALL); face.renderOrder = 3.5; scene.add(face);
  const haloTex = softDot();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xc8b4ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.scale.setScalar(R * 3.4); halo.position.copy(BALL); halo.renderOrder = 4; scene.add(halo);
  const ballLight = new THREE.PointLight(0xb9a0ff, 0.25, 0.7, 2); ballLight.position.copy(BALL).add(new THREE.Vector3(0, 0.05, 0.05)); scene.add(ballLight);
  const ballAnchor = new THREE.Object3D(); ballAnchor.position.copy(BALL); scene.add(ballAnchor);
  // his light, where the picture's comes from
  const LIGHT = { lamp: 1.0 };
  let lampFade = 1;
  const lampLight = new THREE.PointLight(0xffcf9a, LIGHT.lamp, 2.6, 1.6); lampLight.position.set(-0.5, TABLE_Y + 0.32, 0.42); scene.add(lampLight);
  const tvLight = new THREE.PointLight(0xff4aa8, 0.8, 3.4, 1.4); tvLight.position.set(-1.1, 1.2, -2.4); scene.add(tvLight);
  const doorLight = new THREE.PointLight(0x4a78ff, 0.8, 4.5, 1.2); doorLight.position.set(0.95, 1.1, -2.9); scene.add(doorLight);
  const stringLight = new THREE.PointLight(0xffb070, 0.35, 4, 1.5); stringLight.position.set(-0.2, 2.1, -2.6); scene.add(stringLight);

  // ---- him: lit live, in the table's shadow below its top (npcstage.js)
  for (const m of [sb.material, sr.material, glass.material, face.material, halo.material]) m.onBeforeCompile = encode;
  const g = await new GLTFLoader().loadAsync(`${ART}prophet.glb`);
  const model = g.scene;
  model.scale.setScalar(SEAT.scale);                     // the model is 1 tall: a big man, seated
  const bone = {};
  const hitMeshes = [];
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
  // sitting on the floor (a flat cushion), cross-legged behind the table
  const hipsRest = 0.42 * SEAT.scale;
  model.position.set(SEAT.x, SEAT.seatY - hipsRest, SEAT.z); model.rotation.y = SEAT.turn;
  model.scale.x *= SEAT.wide;                            // the jacket's puff
  scene.add(model);
  const meShadow = blobShadow(0.9, 0.7, 0.35); meShadow.position.set(SEAT.x, 0.006, SEAT.z + 0.15); scene.add(meShadow);
  const rest = {};
  for (const n of BONES) if (bone[n]) rest[n] = bone[n].quaternion.clone();
  // the picture's proportions: huge puffy sleeves, big blocky fists, a big hat
  for (const n of ["upperarm_L", "upperarm_R"]) bone[n]?.scale.setScalar(1.12);
  for (const n of ["hand_L", "hand_R"]) bone[n]?.scale.setScalar(1.1);
  for (const n of ["thigh_L", "thigh_R"]) bone[n]?.scale.setScalar(1.35);   // big baggy legs, knees out under the table
  for (const n of ["foot_L", "foot_R"]) bone[n]?.scale.setScalar(0.45);     // feet tucked under (the picture shows none)
  bone.head?.scale.setScalar(1.14);
  // the pipe's bowl, in the head bone's space (the model's rest coordinates)
  const bowl = new THREE.Object3D(); bowl.position.set(0.062, 0.732 - 0.715, 0.15);
  bone.head?.add(bowl);

  // ---- smoke: a thin wisp from the bowl, looping
  const smoke = smokeWisp(scene, haloTex, { encodeIt: false });

  // ---- the ball's moods: idle (a soft lavender glow), spin (faces flicking),
  // swirl (the quest coming), landed (held, bright), burst (the reveal), dim
  const ORB = {
    idle: { glow: 0.45, col: 0xc0a8ff }, spin: { glow: 0.55, col: 0xc0a8ff }, swirl: { glow: 0.9, col: 0xd0bcff },
    landed: { glow: 0.75, col: 0xe8dcff }, burst: { glow: 1.4, col: 0xf4ecff }, dim: { glow: 0.1, col: 0x9a8ad0 },
  };
  let orbNow = { glow: 0.0, col: new THREE.Color(0xb9a0ff) }, orbGoal = ORB.idle, burstT = 9, faceOn = 0, popT = 9;
  const texL = new THREE.TextureLoader();
  function orb(mode) { orbGoal = ORB[mode] ?? ORB.idle; if (mode === "burst") burstT = 0; }
  function setFace(url, pop) {
    if (!url) { faceOn = 0; return; }
    if (face.material.map?.userData.url !== url) {
      texL.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.userData.url = url; const old = face.material.map; face.material.map = t; face.material.needsUpdate = true; if (old && old !== t) old.dispose(); });
    }
    faceOn = 1; if (pop) popT = 0;
  }

  // ---- looking around (npcstage.js); swinging round to the left, the
  // camera rises a little to look over the lamp
  const orbit = orbitCamera(st, VIEW, { onTap: (x, y) => tap(x, y), rise: yaw => Math.max(0, -yaw - 0.35) * 0.32 });
  const { view, want } = orbit;

  // ---- taps: him, the ball, the lamp, the TV
  const targets = [{ kind: "ball", objs: [glass, stand] }, ...room.targets, { kind: "prophet", objs: hitMeshes }];
  let ballPokeT = 9, lampPokeT = 9, spinV = 0;
  const api = { onTap: null };
  function tap(cx, cy) {
    let best = pickTap(st, targets, cx, cy);
    // the ball is small on screen: a near miss still counts
    if (!best || best.kind !== "ball") {
      const b = st.rectOf(ballAnchor, R * 1.8);
      if (cx > b.left && cx < b.left + b.width && cy > b.top && cy < b.top + b.height) best = { kind: "ball" };
    }
    if (!best) return;
    const ok = api.onTap?.(best.kind);
    if (best.kind === "ball") { ballPokeT = 0; spinV = 9; }
    if (best.kind === "lamp") lampPokeT = 0;
    room.poke(best.kind);
    if (best.kind === "prophet" && ok) { if (Math.random() < 0.5) nodT = 0; else { puffK = 1; puffT = 5 + Math.random() * 4; } }
  }

  // ---- poses: target eulers per bone, blended quickly (critically damped, no float)
  let poseName = "idle", poseT = 0, nodT = 9, puffT = 3 + Math.random() * 3, puffK = 0;
  const target = {}, cur = {};
  for (const n of BONES) { cur[n] = new THREE.Vector3(...(SIT[n] ?? [0, 0, 0])); target[n] = new THREE.Vector3(); }
  function setPose(name) {
    if (!POSES[name]) name = "idle";
    if (name === "nod") nodT = 0;
    if (name !== poseName) { poseName = name; poseT = 0; }
  }
  const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), tmpC = new THREE.Color(), bp = new THREE.Vector3();

  st.onFrame((t, dt) => {
    const still = reduce();
    poseT += dt;
    orbit.update(t, dt);

    // ---- him: targets are the seated base + this pose + small life
    const P = POSES[poseName];
    for (const n of BONES) {
      const b = SIT[n] ?? [0, 0, 0], p = P[n] ?? [0, 0, 0];
      target[n].set(b[0] + p[0], b[1] + p[1], b[2] + p[2]);
    }
    // he keeps half an eye on you: the head turns a little toward the camera
    headFollow(target, view);
    if (!still) {
      const br = Math.sin(t * 1.25);                                  // breathing, ~5 s a breath
      target.chest.x += br * 0.018; target.spine.x += br * 0.01;
      target.upperarm_L.z -= br * 0.012; target.upperarm_R.z += br * 0.012;
      if (poseName === "idle") {
        target.head.z += Math.sin(t * 0.37) * 0.05 * Math.max(0, Math.sin(t * 0.13));   // a slight tilt now and then
        target.head.y += Math.sin(t * 0.23 + 1) * 0.04;
      }
      // a pipe puff every few seconds: a small lift of the chin, a thicker wisp
      puffT -= dt;
      if (puffT < 0) { puffT = 5 + Math.random() * 4; puffK = 1; }
      puffK = Math.max(0, puffK - dt * 0.7);
      if (poseName === "idle") target.head.x -= Math.sin(Math.min(1, puffK) * Math.PI) * 0.06;
      if (poseName === "reveal") { target.hand_L.z += Math.sin(t * 6) * 0.05; target.hand_R.z -= Math.sin(t * 6 + 1) * 0.05; }
    }
    // the smug nod: two dips, then settle
    nodT += dt;
    if (nodT < 1.1) { const k = nodT / 1.1; target.head.x += Math.sin(k * Math.PI * 2) * 0.16 * (1 - k * 0.5); target.head.z += 0.06 * Math.sin(k * Math.PI); }
    const k = 1 - Math.exp(-dt * 9);
    for (const n of BONES) {
      if (!bone[n]) continue;
      cur[n].lerp(target[n], k);
      tmpE.set(cur[n].x, cur[n].y, cur[n].z);
      bone[n].quaternion.copy(rest[n]).multiply(tmpQ.setFromEuler(tmpE));
    }

    // ---- the ball (and a tap: a pulse and a swirl)
    const kk = Math.min(1, dt * 5);
    orbNow.glow += (orbGoal.glow - orbNow.glow) * kk; orbNow.col.lerp(tmpC.setHex(orbGoal.col), kk);
    burstT += dt; ballPokeT += dt;
    const poke = ballPokeT < 1 ? Math.sin(ballPokeT * Math.PI) * 0.7 : 0;
    const glow = orbNow.glow * (1 + 0.08 * Math.sin(t * 2.2)) + (burstT < 0.8 ? (1 - burstT / 0.8) * 1.2 : 0) + (poseName === "reveal" ? 0.25 : 0) + poke;
    glass.material.emissive.copy(orbNow.col).multiplyScalar(0.55); glass.material.emissiveIntensity = 0.08 + glow * 0.6;
    spinV *= Math.exp(-dt * 2.5); glass.rotation.y += (0.15 + spinV) * dt * (still ? 0 : 1);
    halo.material.color.copy(orbNow.col); halo.material.opacity = Math.min(0.75, glow * 0.36); halo.scale.setScalar(R * (3.0 + glow * 1.1));
    ballLight.color.copy(orbNow.col); ballLight.intensity = 0.05 + glow * 0.35;
    face.material.opacity += ((faceOn ? 0.92 : 0) * (orbGoal === ORB.swirl ? 0.3 : 1) * (poke > 0.3 ? 0.5 : 1) - face.material.opacity) * Math.min(1, dt * 10);
    popT += dt;
    const pop = popT < 0.5 ? 1 + Math.sin(Math.min(1, popT / 0.5) * Math.PI) * 0.22 : 1;
    face.scale.setScalar(R * 1.3 * pop);
    // ---- the room's life (lamp, TV, bulbs); a lamp tap flickers his light too
    room.update(t, dt);
    // the lamp out of the way when it stands in front of the ball
    const lp = bp.copy(room.lamp.position); lp.y += 0.25;
    const lampD = lp.distanceTo(camera.position), ballD = BALL.distanceTo(camera.position);
    lp.project(camera); const bq = BALL.clone().project(camera);
    const sep = Math.hypot((lp.x - bq.x) * camera.aspect, lp.y - bq.y);
    const fadeTo = lampD < ballD && sep < 0.42 ? 0.18 + Math.max(0, sep - 0.2) * 2 : 1;
    const lf = lampFade + (Math.min(1, fadeTo) - lampFade) * Math.min(1, dt * 6);
    if (Math.abs(lf - lampFade) > 0.002 || (lf < 1 && fadeTo >= 1)) { lampFade = lf > 0.995 ? 1 : lf; room.lampFade(lampFade); }
    lampPokeT += dt;
    const fl = lampPokeT < 0.9 && !still ? (Math.floor(lampPokeT * 16) % 3 === 1 ? 0.45 : 0.8 + 0.2 * Math.random()) : 1;
    lampLight.intensity = LIGHT.lamp * fl;
    // ---- the smoke: rises, drifts, widens, fades; thicker right after a puff
    smoke.update(bowl, t, dt, puffK);
  });

  return Object.assign(api, {
    stage: st,
    setPose, orb, face: setFace,
    push: orbit.push,
    // glide back to the default view and stay there (the key moments)
    hold: orbit.hold,
    ballRect: () => st.rectOf(ballAnchor, R),
    attach: el => st.attach(el),
    dispose: () => { orbit.dispose(); room.dispose(); st.dispose(); },
    get pose() { return poseName; },
    // for tests and tuning: the scene's parts
    debug: { scene, camera, model, bone, view, want, SIT, POSES, VIEW, SEAT, T: orbit.T, tap, rest, room, glass, stand, lights: { lampLight, tvLight, doorLight, stringLight, hemi: st.lights.hemi }, LIGHT },
  });
}
