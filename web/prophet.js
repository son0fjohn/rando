// Side Quest's host, The Prophet, in his back room: a plain gray storeroom
// (folding table, folding chair, a metal shelf with cardboard boxes and a
// yellow bin, a gray door, a table lamp) built from simple primitives in flat
// colours, him seated behind the table, and the crystal ball on its stand in
// front of him. Soft, even light with gentle ambient occlusion, no bloom, no
// outlines; drawn at a reduced resolution and softly upscaled (retrolook.js,
// smooth mood).
//
// He's one rigged low-poly mesh (games/sidequest/prophet/prophet.glb, see
// docs/npc_scenes.md): his hat and durag tails ride the head bone, the pipe
// is in his mouth, the chain on his chest. Poses are procedural, blended on
// the bones, quick and settled (no float):
//   idle   slow breathing, a slight head tilt now and then, a pipe puff
//   reveal leans in, hands hovering over the ball, the ball brightens
//   point  points at the one the ball chose (at the camera: at you)
//   nod    a smug nod to close a turn
// Small life: a thin wisp of smoke from the pipe, the ball's soft glow, a
// slow camera push-in on the key moments.
//
//   const p = await prophetScene(hostEl);
//   p.setPose("reveal"); p.orb("spin"); p.face(url, pop); p.push(1);
//   p.ballRect();  // the ball on screen, for the card to rise out of
//   p.attach(otherEl); p.dispose();
import { retroStage, THREE, bakeAO, blobShadow } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const ART = new URL("./games/sidequest/prophet/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the back room's light: soft and even, a little warm from the lamp, gray walls
export const PROPHET_MOOD = {
  scale: 0.75, maxW: 560, smooth: true, msaa: 4,
  bg: 0x77797c,
  fog: { color: 0x77797c, near: 7, far: 16 },
  ambient: { sky: 0xeeeef0, ground: 0x777573, intensity: 1.05 },
  key: { color: 0xfff6ea, intensity: 0.7, pos: [1.2, 3.4, 3.2] },
  fill: { color: 0xe6ecff, intensity: 0.32, pos: [-3, 2, 1.5] },
  bloom: false,
  grade: { tint: [1.0, 1.0, 1.0], sat: 0.97, contrast: 0.97, lift: 0.015 },
  levels: 255, dither: 0, vignette: 0.1, grain: 0,
};

const mat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
const box = (w, h, d, color, o) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o));
// a box with softly rounded edges (the reference's "soft blocks")
function softBox(w, h, d, r, color) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - r * 2, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - r * 2) / 2);
  return new THREE.Mesh(g, mat(color));
}

// ---------------------------------------------------------------- the poses
// Euler targets per bone, on top of the model's standing rest pose. SIT is
// the base; the others add to it. Bones: root hips spine chest neck head,
// shoulder/upperarm/forearm/hand _L _R, thigh/shin/foot _L _R. Left is the
// character's left (+x, screen right).
const SIT = {
  thigh_L: [-1.57, 0, 0.06], thigh_R: [-1.57, 0, -0.06], shin_L: [1.5, 0, 0], shin_R: [1.5, 0, 0],
  spine: [0.06, 0, 0], chest: [0.04, 0, 0], neck: [0, 0, 0], head: [0.04, 0, 0],
  // forearms resting on the table, hands loosely in front
  upperarm_L: [-0.5, 0, 0.55], upperarm_R: [-0.5, 0, -0.55],
  forearm_L: [-1.32, 0, -0.5], forearm_R: [-1.32, 0, 0.5],
  hand_L: [0.15, 0, 0.1], hand_R: [0.15, 0, -0.1],
};
const POSES = {
  idle: {},
  // leans in over the table, both hands hovering over the ball
  reveal: { spine: [0.22, 0, 0], chest: [0.1, 0, 0], head: [-0.06, 0, 0],
    upperarm_L: [-0.55, 0, -0.42], upperarm_R: [-0.55, 0, 0.42], forearm_L: [0.12, 0, -0.5], forearm_R: [0.12, 0, 0.5],
    hand_L: [-0.5, 0, 0.3], hand_R: [-0.5, 0, -0.3] },
  // his right arm straight out at the camera: at you
  point: { spine: [0.1, 0, 0], chest: [0, -0.12, 0], head: [-0.02, -0.08, -0.06],
    upperarm_R: [-0.95, 0.05, 0.55], forearm_R: [1.08, 0, -0.62], hand_R: [-0.2, 0, 0] },
  // the nod itself is animated; this is its lean back
  nod: { spine: [-0.02, 0, 0], chest: [-0.04, 0, 0] },
};
const BONES = ["hips", "spine", "chest", "neck", "head", "upperarm_L", "upperarm_R", "forearm_L", "forearm_R", "hand_L", "hand_R", "thigh_L", "thigh_R", "shin_L", "shin_R"];

export async function prophetScene(host) {
  const st = await retroStage(host, PROPHET_MOOD);
  const { scene, camera } = st;
  camera.fov = 41; camera.near = 0.05; camera.far = 30;
  const CAM = { home: new THREE.Vector3(0, 1.38, 2.2), push: new THREE.Vector3(0, 1.34, 1.7) };
  const LOOK = { home: new THREE.Vector3(0, 1.02, -0.45), push: new THREE.Vector3(0, 1.06, -0.45) };
  camera.position.copy(CAM.home); camera.lookAt(LOOK.home); camera.updateProjectionMatrix();

  // ---- the room: gray walls, a gray floor, a door, a shelf
  const WALL = 0x8f9093, FLOOR = 0x6c6c6e;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mat(FLOOR)); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.2), mat(WALL)); back.position.set(0, 2.1, -1.9); scene.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(5, 4.2), mat(0x828386)); side.position.set(2.35, 2.1, 0.4); side.rotation.y = -Math.PI / 2; scene.add(side);
  const sideL = side.clone(); sideL.position.x = -2.35; sideL.rotation.y = Math.PI / 2; scene.add(sideL);
  // a bulkhead along the top of the back wall, as in the room's corner
  const beam = box(9, 0.36, 0.3, 0x86878a); beam.position.set(0, 2.62, -1.76); scene.add(beam);
  const skirt = box(9, 0.08, 0.04, 0x707174); skirt.position.set(0, 0.04, -1.88); scene.add(skirt);
  // the door (back wall, right): frame, slab, a small window, a handle
  const door = new THREE.Group();
  const frame = box(1.02, 2.12, 0.08, 0x6e7074); frame.position.y = 1.06; door.add(frame);
  const slab = softBox(0.86, 2.02, 0.06, 0.012, 0x62656a); slab.position.set(0, 1.02, 0.05); door.add(slab);
  const win = box(0.2, 0.36, 0.02, 0x3a3d42); win.position.set(0.1, 1.55, 0.09); door.add(win);
  const handle = box(0.11, 0.025, 0.03, 0x9c9fa4); handle.position.set(0.3, 1.0, 0.11); door.add(handle);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), mat(0x8a8d92)); rose.rotation.x = Math.PI / 2; rose.position.set(0.35, 1.0, 0.09); door.add(rose);
  door.position.set(0.6, 0, -1.86); scene.add(door);
  // the metal shelf (back wall, left) with cardboard boxes and a yellow bin
  const shelf = new THREE.Group();
  const post = (x, z) => { const p = box(0.04, 2.0, 0.04, 0x55585c); p.position.set(x, 1.0, z); shelf.add(p); };
  post(-0.58, -0.2); post(0.58, -0.2); post(-0.58, 0.2); post(0.58, 0.2);
  for (const y of [0.18, 0.86, 1.52]) { const b = box(1.2, 0.04, 0.44, 0x5c5f63); b.position.y = y; shelf.add(b); }
  const card = 0xb38d5e, cardDark = 0x9c7a50;
  const cbox = (w, h, d, x, y, z, c = card) => { const b = softBox(w, h, d, 0.01, c); b.position.set(x, y + h / 2, z); shelf.add(b); const t = box(w * 0.98, 0.012, 0.05, 0x8a6a42); t.position.set(x, y + h + 0.002, z); shelf.add(t); };
  cbox(0.52, 0.34, 0.38, -0.25, 1.54, 0); cbox(0.42, 0.3, 0.36, 0.28, 1.54, 0.01, cardDark);
  cbox(0.6, 0.4, 0.4, -0.15, 0.2, 0); cbox(0.36, 0.28, 0.34, 0.36, 0.2, 0.02, cardDark);
  const bin = softBox(0.64, 0.34, 0.4, 0.03, 0xd8c23a); bin.position.set(-0.08, 0.88 + 0.17, 0); shelf.add(bin);
  const lid = box(0.66, 0.03, 0.42, 0xc8b030); lid.position.set(-0.08, 0.88 + 0.35, 0); shelf.add(lid);
  shelf.position.set(-0.86, 0, -1.62); shelf.rotation.y = 0.1; scene.add(shelf);
  bakeAO(shelf, { floor: 0, reach: 1.2, strength: 0.45 });
  bakeAO(door, { floor: 0, reach: 0.9, strength: 0.35 });

  // ---- the folding chair behind him
  const chair = new THREE.Group();
  const seat = softBox(0.46, 0.05, 0.42, 0.015, 0x4a4c50); seat.position.y = 0.58; chair.add(seat);
  const backrest = softBox(0.44, 0.2, 0.04, 0.012, 0x4a4c50); backrest.position.set(0, 1.0, -0.2); chair.add(backrest);
  for (const sx of [-1, 1]) {
    const leg = box(0.03, 0.95, 0.03, 0x3c3e42); leg.position.set(sx * 0.21, 0.47, -0.18); leg.rotation.x = 0.08; chair.add(leg);
    const leg2 = box(0.03, 0.48, 0.03, 0x3c3e42); leg2.position.set(sx * 0.21, 0.23, 0.17); leg2.rotation.x = -0.12; chair.add(leg2);
  }
  chair.position.set(-0.08, 0, -0.66); chair.rotation.y = 0.18; scene.add(chair);

  // ---- the folding table, the lamp, the ball on its stand
  const TABLE_Y = 0.76;
  const table = new THREE.Group();
  const top = softBox(1.9, 0.045, 0.82, 0.016, 0x7c7d80); top.position.y = TABLE_Y - 0.022; table.add(top);
  const apron = box(1.84, 0.05, 0.76, 0x7d7e81); apron.position.y = TABLE_Y - 0.07; table.add(apron);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {   // folding legs, splayed
    const l = box(0.035, 0.76, 0.035, 0x3a3b3e); l.position.set(sx * 0.8, 0.37, sz * 0.24); l.rotation.x = sz * 0.22; table.add(l);
  }
  table.position.set(0, 0, 0.02); scene.add(table);
  const tableShadow = blobShadow(2.1, 1.1, 0.35); tableShadow.position.set(0, 0.004, 0.02); scene.add(tableShadow);
  const lamp = new THREE.Group();
  const lbase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.05, 14), mat(0x3e4044)); lbase.position.y = 0.025; lamp.add(lbase);
  const lstem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 10), mat(0x4a4c50)); lstem.position.y = 0.2; lamp.add(lstem);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.24, 14, 1, true), mat(0xe2d6bc, { side: THREE.DoubleSide, emissive: 0x6a5a3a, emissiveIntensity: 0.35 }));
  shade.position.y = 0.44; lamp.add(shade);
  lamp.position.set(-0.5, TABLE_Y, 0.3); scene.add(lamp);
  const lampLight = new THREE.PointLight(0xffe2b0, 0.55, 2.6, 2); lampLight.position.set(-0.46, TABLE_Y + 0.36, 0.3); scene.add(lampLight);

  const R = 0.064, BALL = new THREE.Vector3(0, TABLE_Y + 0.07 + R, 0.08);
  const stand = new THREE.Group();
  const sb = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.08, 0.058, 14), mat(0x3b2d4c)); sb.position.y = 0.029; stand.add(sb);
  const sr = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 6, 16), mat(0x2f2440)); sr.rotation.x = Math.PI / 2; sr.position.y = 0.062; stand.add(sr);
  stand.position.set(BALL.x, TABLE_Y, BALL.z); scene.add(stand);
  const glass = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 1), new THREE.MeshLambertMaterial({ color: 0xa898d8, emissive: 0x6a50c0, emissiveIntensity: 0.1, flatShading: true, transparent: true, opacity: 0.9 }));
  glass.position.copy(BALL); glass.renderOrder = 3; scene.add(glass);
  // a face in the ball (drawn over the glass, under its halo), a soft halo around it
  const face = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
  face.scale.setScalar(R * 1.3); face.position.copy(BALL); face.renderOrder = 3.5; scene.add(face);
  const haloTex = new THREE.CanvasTexture((() => {
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 6, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.4, "rgba(220,200,255,.35)"); g.addColorStop(1, "rgba(200,180,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
  })());
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xc8b4ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.scale.setScalar(R * 3.4); halo.position.copy(BALL); halo.renderOrder = 4; scene.add(halo);
  const ballLight = new THREE.PointLight(0xb9a0ff, 0.25, 0.7, 2); ballLight.position.copy(BALL).add(new THREE.Vector3(0, 0.05, 0.05)); scene.add(ballLight);
  const ballAnchor = new THREE.Object3D(); ballAnchor.position.copy(BALL); scene.add(ballAnchor);
  bakeAO(table, { floor: 0, reach: 0.8, strength: 0.5 }); bakeAO(chair, { floor: 0, reach: 0.6, strength: 0.4 });

  // ---- him
  const g = await new GLTFLoader().loadAsync(`${ART}prophet.glb`);
  const model = g.scene;
  const S = 1.86;                                        // the model is 1 tall: a big man, seated
  model.scale.setScalar(S);
  const bone = {};
  model.traverse(o => {
    if (o.isBone) bone[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      const m = o.material;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 2; }
      o.material = new THREE.MeshLambertMaterial({ map: m.map ?? null, color: 0xffffff });
    }
  });
  // seated: the hips down to the chair's seat
  const seatY = 0.6, hipsRest = 0.42 * S;
  model.position.set(0, seatY - hipsRest, -0.52);
  scene.add(model);
  const meShadow = blobShadow(0.9, 0.6, 0.35); meShadow.position.set(0, 0.006, -0.42); scene.add(meShadow);
  const rest = {};
  for (const n of BONES) if (bone[n]) rest[n] = bone[n].quaternion.clone();
  // the pipe's bowl, in the head bone's space (the model's rest coordinates)
  const bowl = new THREE.Object3D(); bowl.position.set(0.062, 0.732 - 0.715, 0.15);
  bone.head?.add(bowl);

  // ---- smoke: a thin wisp from the bowl, looping
  const smokeTex = haloTex;
  const puffs = [];
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xe8e8ec, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
    sp.userData = { t: i / 16, x: 0 }; sp.renderOrder = 5; scene.add(sp); puffs.push(sp);
  }

  // ---- the ball's moods: idle (a soft lavender glow), spin (faces flicking),
  // swirl (the quest coming), landed (held, bright), burst (the reveal), dim
  const ORB = {
    idle: { glow: 0.0, col: 0xb9a0ff }, spin: { glow: 0.55, col: 0xc0a8ff }, swirl: { glow: 0.9, col: 0xd0bcff },
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

  // ---- poses: target eulers per bone, blended quickly (critically damped, no float)
  let poseName = "idle", poseT = 0, pushGoal = 0, pushNow = 0, nodT = 9, puffT = 3 + Math.random() * 3, puffK = 0;
  const target = {}, cur = {};
  for (const n of BONES) { cur[n] = new THREE.Vector3(...(SIT[n] ?? [0, 0, 0])); target[n] = new THREE.Vector3(); }
  function setPose(name) {
    if (!POSES[name]) name = "idle";
    if (name === "nod") nodT = 0;
    if (name !== poseName) { poseName = name; poseT = 0; }
  }
  const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), tmpC = new THREE.Color(), camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

  st.onFrame((t, dt) => {
    const still = reduce();
    poseT += dt;
    // targets: the seated base + this pose + small life
    const P = POSES[poseName];
    for (const n of BONES) {
      const b = SIT[n] ?? [0, 0, 0], p = P[n] ?? [0, 0, 0];
      target[n].set(b[0] + p[0], b[1] + p[1], b[2] + p[2]);
    }
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
    // the camera: a slow push-in on the key moments, a faint handheld drift
    pushNow += (pushGoal - pushNow) * (1 - Math.exp(-dt * 1.1));
    camPos.lerpVectors(CAM.home, CAM.push, pushNow); camLook.lerpVectors(LOOK.home, LOOK.push, pushNow);
    if (!still) { camPos.x += Math.sin(t * 0.31) * 0.006; camPos.y += Math.sin(t * 0.43 + 1) * 0.004; }
    camera.position.copy(camPos); camera.lookAt(camLook);
    // the ball
    const kk = Math.min(1, dt * 5);
    orbNow.glow += (orbGoal.glow - orbNow.glow) * kk; orbNow.col.lerp(tmpC.setHex(orbGoal.col), kk);
    burstT += dt;
    const glow = orbNow.glow * (1 + 0.08 * Math.sin(t * 2.2)) + (burstT < 0.8 ? (1 - burstT / 0.8) * 1.2 : 0) + (poseName === "reveal" ? 0.25 : 0);
    glass.material.emissive.copy(orbNow.col).multiplyScalar(0.55); glass.material.emissiveIntensity = 0.08 + glow * 0.6;
    halo.material.color.copy(orbNow.col); halo.material.opacity = Math.min(0.75, glow * 0.36); halo.scale.setScalar(R * (3.0 + glow * 1.1));
    ballLight.color.copy(orbNow.col); ballLight.intensity = 0.05 + glow * 0.35;
    face.material.opacity += ((faceOn ? 0.92 : 0) * (orbGoal === ORB.swirl ? 0.3 : 1) - face.material.opacity) * Math.min(1, dt * 10);
    popT += dt;
    const pop = popT < 0.5 ? 1 + Math.sin(Math.min(1, popT / 0.5) * Math.PI) * 0.22 : 1;
    face.scale.setScalar(R * 1.3 * pop);
    // the smoke: rises, drifts, widens, fades; thicker right after a puff
    const bp = bowl.getWorldPosition(camLook.clone());
    for (const sp of puffs) {
      const u = sp.userData;
      u.t += dt * (still ? 0 : 0.22);
      if (u.t >= 1) { u.t -= 1; u.x = (Math.random() - 0.5) * 0.02; }
      const a = u.t;
      sp.position.set(bp.x + u.x + Math.sin(a * 6 + t * 0.8) * 0.035 * a, bp.y + 0.02 + a * 0.5, bp.z - a * 0.06);
      sp.scale.set(0.022 + a * 0.06, 0.05 + a * 0.12, 1);
      sp.material.opacity = (0.09 + puffK * 0.14) * Math.sin(Math.PI * Math.min(1, a * 1.1)) * (1 - a * 0.5);
    }
  });

  return {
    stage: st,
    setPose, orb, face: setFace,
    push: (k = 1) => { pushGoal = Math.max(0, Math.min(1, k)); },
    ballRect: () => st.rectOf(ballAnchor, R),
    attach: el => st.attach(el),
    dispose: () => st.dispose(),
    get pose() { return poseName; },
  };
}
