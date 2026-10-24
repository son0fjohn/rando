// Side Quest's host, The Prophet, in his back room: a plain gray storeroom
// (folding table, folding chair, a metal shelf with cardboard boxes and a
// yellow bin, a gray door, a table lamp) built from simple primitives in flat
// colours, him seated behind the table, and the crystal ball on its stand in
// front of him. Soft, even light with gentle ambient occlusion, no bloom, no
// outlines; drawn a little under the screen's resolution and softly
// upscaled (retrolook.js, smooth mood). The default view is the reference
// image's: camera, room and props solved from its perspective (VIEW).
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
// Look around: drag on the scene to orbit the camera around him and the
// table (about ±60° each way, a little up and down, pinch to zoom in a bit),
// with easing and a little momentum; ~3 s after the last touch it glides
// back to the default view. hold(true) glides it home and keeps it there
// (the game does that for the pick and the reveal). His head turns a little
// toward the camera. On phones that report their tilt without asking, a
// very slight parallax (?tilt=0 turns it off). Tap him (onTap("prophet")
// decides whether he reacts: a nod or a pipe puff), the ball (it pulses and
// swirls) or the lamp (it flickers).
//
//   const p = await prophetScene(hostEl);
//   p.setPose("reveal"); p.orb("spin"); p.face(url, pop); p.push(1); p.hold(true);
//   p.onTap = kind => kind === "prophet" && canTalk();   // "prophet" | "ball" | "lamp"
//   p.ballRect();  // the ball on screen, for the card to rise out of
//   p.attach(otherEl); p.dispose();
import { retroStage, THREE, bakeAO, blobShadow } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const ART = new URL("./games/sidequest/prophet/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the back room's light: soft and even from the upper left, gray walls
export const PROPHET_MOOD = {
  scale: 1.5, maxW: 760, smooth: true, msaa: 4,
  bg: 0x6c6c6c,
  fog: { color: 0x6c6c6c, near: 8, far: 18 },
  ambient: { sky: 0xe2dedd, ground: 0x5e5a5a, intensity: 0.8 },
  key: { color: 0xf6f0ee, intensity: 0.78, pos: [-1.6, 3.2, 2.6] },
  fill: { color: 0xe8ecf4, intensity: 0.22, pos: [2.6, 1.8, 2.0] },
  bloom: false,
  grade: { tint: [1.0, 0.985, 0.985], sat: 0.9, contrast: 0.98, lift: 0.01 },
  levels: 255, dither: 0, vignette: 0.12, grain: 0,
};

// the default view (the reference's framing) and how far you can look away
// from it. The camera orbits `target` at `dist`; yaw 0 is straight on, pitch
// is how far above the target it sits. `fov` is the vertical field of view
// at 9:16; a taller screen keeps the same width in view.
export const VIEW = {
  target: [0, 0.932, -0.17], dist: 3.0, yaw: 0, pitch: 0.2007, fov: 39.4, aspect: 9 / 16,
  yawRange: [-1.05, 1.05],        // ±60°
  pitchRange: [-0.1, 0.16],       // a little lower (never under the table top), a little higher
  zoomRange: [0.72, 1.0],         // pinch: in a bit, never out past the default
  push: 0.84,                     // the push-in: distance × this
  idleMs: 3000,                   // after the last touch, glide home
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
export const SIT = {
  thigh_L: [-1.57, 0, 0.06], thigh_R: [-1.57, 0, -0.06], shin_L: [1.5, 0, 0], shin_R: [1.5, 0, 0],
  spine: [0.1, 0, 0], chest: [0.02, 0, 0], neck: [-0.1, 0, 0], head: [-0.02, 0, 0],   // leaning on the table, head up
  // forearms resting on the table, fists by the ball
  // (solved on the rig for the reference's elbows and fists)
  upperarm_L: [-0.699, -0.614, 0.264], upperarm_R: [-0.56, 0.528, -0.089],
  forearm_L: [-0.204, -0.568, 0.3], forearm_R: [-1.274, 0.333, 0.444],
  hand_L: [0.45, 0, 0.1], hand_R: [0.45, 0, -0.1],
};
export const POSES = {
  idle: {},
  // leans in over the table, both hands hovering over the ball (solved on the rig)
  reveal: { spine: [0.22, 0, 0], chest: [0.1, 0, 0], head: [-0.06, 0, 0],
    upperarm_L: [-1.188, 0.376, -0.44], upperarm_R: [-1.308, -0.331, 0.486], forearm_L: [-0.021, 0.431, -0.373], forearm_R: [0.88, -0.239, -0.276],
    hand_L: [-0.45, 0, 0], hand_R: [-0.45, 0, 0] },
  // his right arm straight out at the camera: at you
  point: { spine: [0.1, 0, 0], chest: [0, -0.12, 0], head: [-0.02, -0.08, -0.06],
    upperarm_R: [-1.278, -0.308, 0.348], forearm_R: [1.028, -0.283, -0.458], hand_R: [-0.2, 0, 0] },
  // the nod itself is animated; this is its lean back
  nod: { spine: [-0.02, 0, 0], chest: [-0.04, 0, 0] },
};
const BONES = ["hips", "spine", "chest", "neck", "head", "upperarm_L", "upperarm_R", "forearm_L", "forearm_R", "hand_L", "hand_R", "thigh_L", "thigh_R", "shin_L", "shin_R"];

// where he sits (left of the ball, turned a little toward the camera)
export const SEAT = { x: -0.12, z: -0.5, turn: 0.16, scale: 1.86, wide: 1.07, seatY: 0.615 };

export async function prophetScene(host) {
  const st = await retroStage(host, PROPHET_MOOD);
  const { scene, camera, canvas } = st;
  camera.near = 0.05; camera.far = 30;

  // ---- the room: a closed box (every allowed angle sees a finished room):
  // gray walls, a ceiling, a gray floor, a door, a shelf, boxes
  const WALL = 0x7a7a7a, FLOOR = 0xa49c9c;
  const RW = 3.2, RB = -5.0, RF = 3.6, RH = 2.75;         // half width, back, front, height
  const plane = (w, h, c, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); scene.add(m); return m; };
  plane(RW * 2, RF - RB, FLOOR, 0, 0, (RF + RB) / 2, 0, -Math.PI / 2);
  plane(RW * 2, RF - RB, 0x5e5e5f, 0, RH, (RF + RB) / 2, 0, Math.PI / 2);
  plane(RW * 2, RH, WALL, 0, RH / 2, RB);
  plane(RF - RB, RH, 0x737374, -RW, RH / 2, (RF + RB) / 2, Math.PI / 2);
  plane(RF - RB, RH, 0x737374, RW, RH / 2, (RF + RB) / 2, -Math.PI / 2);
  plane(RW * 2, RH, WALL, 0, RH / 2, RF, Math.PI);
  // a bulkhead along the top of the back wall, skirting at the bottom
  const beam = box(RW * 2, 0.43, 0.4, 0x858585); beam.position.set(0, RH - 0.215, RB + 0.2); scene.add(beam);
  for (const [w, x, z, ry] of [[RW * 2, 0, RB + 0.02, 0], [RF - RB, -RW + 0.02, (RF + RB) / 2, Math.PI / 2], [RF - RB, RW - 0.02, (RF + RB) / 2, Math.PI / 2]]) {
    const sk = box(w, 0.08, 0.03, 0x666667); sk.position.set(x, 0.04, z); sk.rotation.y = ry; scene.add(sk);
  }
  // the door (back wall, right): frame, slab, a small window, a round knob
  const door = new THREE.Group();
  const frame = box(0.85, 2.04, 0.08, 0x55595f); frame.position.y = 1.02; door.add(frame);
  const slab = softBox(0.74, 1.97, 0.06, 0.012, 0x5f646a); slab.position.set(0, 0.985, 0.05); door.add(slab);
  const win = box(0.2, 0.44, 0.02, 0x3b3e43); win.position.set(0.06, 1.45, 0.09); door.add(win);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0x9a9da2)); knob.position.set(0.27, 0.98, 0.11); door.add(knob);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), mat(0x8a8d92)); rose.rotation.x = Math.PI / 2; rose.position.set(0.27, 0.98, 0.085); door.add(rose);
  door.position.set(1.05, 0, RB + 0.02); scene.add(door);
  // the metal shelf (back wall, left) with cardboard boxes and a yellow bin
  const card = 0xa4825a, cardDark = 0x8f704c;
  const cbox = (g, w, h, d, x, y, z, c = card) => { const b = softBox(w, h, d, 0.01, c); b.position.set(x, y + h / 2, z); g.add(b); const t = box(w * 0.98, 0.012, 0.05, 0x7c5f3e); t.position.set(x, y + h + 0.002, z); g.add(t); };
  const shelf = new THREE.Group();
  const post = (x, z) => { const p = box(0.045, 2.12, 0.045, 0x4c4f53); p.position.set(x, 1.06, z); shelf.add(p); };
  post(-0.65, -0.22); post(0.65, -0.22); post(-0.65, 0.22); post(0.65, 0.22);
  for (const y of [0.08, 0.42, 0.89, 1.57]) { const b = box(1.34, 0.04, 0.48, 0x55585c); b.position.y = y; shelf.add(b); }
  cbox(shelf, 0.62, 0.48, 0.42, 0.3, 1.59, 0); cbox(shelf, 0.5, 0.4, 0.4, -0.32, 1.59, 0.01, cardDark);
  cbox(shelf, 0.58, 0.39, 0.42, 0.33, 0.44, 0, cardDark); cbox(shelf, 0.5, 0.36, 0.4, -0.3, 0.44, 0.01);
  cbox(shelf, 0.6, 0.32, 0.4, 0.0, 0.1, 0);
  const bin = softBox(0.6, 0.42, 0.44, 0.03, 0xc9b23c); bin.position.set(0.32, 0.91 + 0.21, 0); shelf.add(bin);
  const lid = box(0.62, 0.035, 0.46, 0xbba432); lid.position.set(0.32, 0.91 + 0.43, 0); shelf.add(lid);
  cbox(shelf, 0.48, 0.34, 0.4, -0.33, 0.91, 0.01, cardDark);
  shelf.position.set(-1.535, 0, RB + 0.26); scene.add(shelf);
  // a stack of boxes against the back wall, behind his left shoulder
  const stack = new THREE.Group();
  cbox(stack, 0.56, 0.36, 0.46, 0, 0, 0, cardDark); cbox(stack, 0.48, 0.31, 0.4, 0.03, 0.36, 0.02);
  stack.position.set(0.26, 0, RB + 0.3); stack.rotation.y = -0.05; scene.add(stack);
  // the side walls (seen when you look around): another shelf of boxes on
  // the left, a stack of boxes and a fuse box on the right
  const shelf2 = shelf.clone(); shelf2.position.set(-RW + 0.3, 0, -2.2); shelf2.rotation.y = Math.PI / 2; scene.add(shelf2);
  const stack2 = new THREE.Group();
  cbox(stack2, 0.6, 0.44, 0.5, 0, 0, 0); cbox(stack2, 0.52, 0.4, 0.44, 0.02, 0.44, 0, cardDark); cbox(stack2, 0.56, 0.42, 0.5, 0.62, 0, 0.05, cardDark);
  stack2.position.set(RW - 0.4, 0, -2.6); stack2.rotation.y = -Math.PI / 2 + 0.08; scene.add(stack2);
  const fuse = softBox(0.42, 0.56, 0.12, 0.015, 0x6c6f73); fuse.position.set(RW - 0.06, 1.55, -0.9); fuse.rotation.y = -Math.PI / 2; scene.add(fuse);
  const conduit = box(0.04, 1.2, 0.04, 0x5a5d61); conduit.position.set(RW - 0.03, 2.4, -0.9); scene.add(conduit);
  bakeAO(shelf, { floor: 0, reach: 1.2, strength: 0.45 }); bakeAO(stack, { floor: 0, reach: 0.8, strength: 0.4 }); bakeAO(stack2, { floor: 0, reach: 0.8, strength: 0.4 });
  bakeAO(door, { floor: 0, reach: 0.9, strength: 0.35 });

  // ---- the folding chair behind him
  const chair = new THREE.Group();
  const seat = softBox(0.46, 0.05, 0.42, 0.015, 0x45474b); seat.position.y = 0.58; chair.add(seat);
  const backrest = softBox(0.46, 0.24, 0.04, 0.012, 0x45474b); backrest.position.set(0, 1.0, -0.2); chair.add(backrest);
  for (const sx of [-1, 1]) {
    const leg = box(0.03, 1.1, 0.03, 0x36383b); leg.position.set(sx * 0.21, 0.55, -0.2); leg.rotation.x = 0.06; chair.add(leg);
    const leg2 = box(0.03, 0.6, 0.03, 0x36383b); leg2.position.set(sx * 0.21, 0.28, 0.17); leg2.rotation.x = -0.14; chair.add(leg2);
  }
  chair.position.set(SEAT.x - 0.2, 0, SEAT.z - 0.3); chair.rotation.y = SEAT.turn + 0.3; scene.add(chair);

  // ---- the folding table, the lamp, the ball on its stand
  const TABLE_Y = 0.76, TX = 0.05, TZ = -0.11, THX = 1.15, THZ = 0.44;   // its top's height, centre, half extents
  const table = new THREE.Group();
  const top = softBox(2.3, 0.055, 0.88, 0.02, 0x7a7576); top.position.y = TABLE_Y - 0.0275; table.add(top);
  const apron = box(2.2, 0.05, 0.8, 0x6a6a6c); apron.position.y = TABLE_Y - 0.08; table.add(apron);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {   // folding legs, splayed
    const l = box(0.035, 0.74, 0.035, 0x343538); l.position.set(sx * 0.92, 0.36, sz * 0.26); l.rotation.x = sz * 0.26; table.add(l);
  }
  for (const sx of [-1, 1]) { const brace = box(0.025, 0.025, 0.52, 0x343538); brace.position.set(sx * 0.92, 0.3, 0); table.add(brace); }
  table.position.set(TX, 0, TZ); scene.add(table);
  const tableShadow = blobShadow(2.5, 1.1, 0.35); tableShadow.position.set(TX, 0.004, TZ); scene.add(tableShadow);
  const lamp = new THREE.Group();
  const lbase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.075, 14), mat(0x3c3e42)); lbase.position.y = 0.0375; lamp.add(lbase);
  const lstem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.18, 10), mat(0x45474b)); lstem.position.y = 0.16; lamp.add(lstem);
  const shadeMat = mat(0xe4d0b0, { side: THREE.DoubleSide, emissive: 0x8a7458, emissiveIntensity: 0.75 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.145, 0.24, 4, 1, true), shadeMat);
  shade.rotation.y = Math.PI / 4; shade.position.y = 0.355; lamp.add(shade);
  const shadeCap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.004, 4), shadeMat); shadeCap.rotation.y = Math.PI / 4; shadeCap.position.y = 0.473; lamp.add(shadeCap);
  lamp.position.set(-0.497, TABLE_Y, 0.25); scene.add(lamp);
  // looking round from the left, the lamp would stand in front of the ball: it fades out of the way
  const lampMats = [lbase.material, lstem.material, shadeMat];
  for (const m of lampMats) m.transparent = true;
  let lampFade = 1;
  const lampLight = new THREE.PointLight(0xffe2b0, 0.2, 2.4, 2); lampLight.position.set(-0.49, TABLE_Y + 0.3, 0.25); scene.add(lampLight);

  const R = 0.1, BALL = new THREE.Vector3(0.042, 0.89, 0.17);
  const stand = new THREE.Group();
  const sb = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.09, 0.052, 16), mat(0x3a2e4a)); sb.position.y = 0.026; stand.add(sb);
  const sr = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.012, 6, 18), mat(0x2e2440)); sr.rotation.x = Math.PI / 2; sr.position.y = 0.054; stand.add(sr);
  stand.position.set(BALL.x, TABLE_Y, BALL.z); scene.add(stand);
  const glass = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 1), new THREE.MeshLambertMaterial({ color: 0xa898d8, emissive: 0x6a50c0, emissiveIntensity: 0.1, flatShading: true, transparent: true, opacity: 0.92 }));
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
  // under the table top it's in the table's shadow (no shadow maps: the
  // table's footprint and height are known, so whatever is under it, him,
  // the floor, the chair, the legs, darkens there, softly at the edges)
  const underTable = sh => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorldU;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWorldU = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorldU;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
      float inX = 1.0 - smoothstep(${(THX - 0.12).toFixed(2)}, ${(THX + 0.08).toFixed(2)}, abs(vWorldU.x - ${TX.toFixed(3)}));
      // the key light comes from the front: the shadow reaches back behind the table, under him and the chair
      float dz = vWorldU.z - (${TZ.toFixed(3)});
      float inZ = dz > 0.0 ? 1.0 - smoothstep(${(THZ - 0.06).toFixed(2)}, ${(THZ + 0.12).toFixed(2)}, dz) : 1.0 - smoothstep(${(THZ + 1.6).toFixed(2)}, ${(THZ + 2.6).toFixed(2)}, -dz);
      float below = 1.0 - smoothstep(${(TABLE_Y - 0.17).toFixed(3)}, ${(TABLE_Y - 0.05).toFixed(3)}, vWorldU.y);
      float shadeU = 0.84 * inX * inZ * below;   // (linear light: about 0.43 of the lit value once on screen)
      float lumU = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lumU), 0.25 * shadeU) * (1.0 - shadeU) + vec3(0.008, 0.007, 0.01) * shadeU;`);
  };
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
      o.material = new THREE.MeshLambertMaterial({ map: m.map ?? null, color: 0xd4cfd2 });   // a touch darker and cooler, as in the reference
      hitMeshes.push(o);
    }
  });
  // seated: the hips down to the chair's seat
  const hipsRest = 0.42 * SEAT.scale;
  model.position.set(SEAT.x, SEAT.seatY - hipsRest, SEAT.z); model.rotation.y = SEAT.turn;
  model.scale.x *= SEAT.wide;                            // the jacket's puff, as wide as the reference's
  scene.add(model);
  // the table's shadow on everything under it
  scene.traverse(o => { if (o.isMesh && o.material?.isMeshLambertMaterial && o.material !== shadeMat && o !== glass) { o.material.onBeforeCompile = underTable; o.material.needsUpdate = true; } });
  const meShadow = blobShadow(0.9, 0.6, 0.35); meShadow.position.set(SEAT.x, 0.006, SEAT.z + 0.1); scene.add(meShadow);
  const rest = {};
  for (const n of BONES) if (bone[n]) rest[n] = bone[n].quaternion.clone();
  for (const n of ["hand_L", "hand_R"]) bone[n]?.scale.setScalar(1.35);   // big blocky fists, as in the reference
  bone.head?.scale.setScalar(1.08);                                          // and the head and hat as big as there
  // the pipe's bowl, in the head bone's space (the model's rest coordinates)
  const bowl = new THREE.Object3D(); bowl.position.set(0.062, 0.732 - 0.715, 0.15);
  bone.head?.add(bowl);

  // ---- smoke: a thin wisp from the bowl, looping
  const puffs = [];
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xe8e8ec, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
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

  // ---- looking around: orbit offsets from the default view, eased
  const V = VIEW, T = new THREE.Vector3(...V.target);
  const view = { yaw: 0, pitch: 0, zoom: 1 };              // what's shown (eased toward `want`)
  const want = { yaw: 0, pitch: 0, zoom: 1 };              // where the finger put it
  const vel = { yaw: 0, pitch: 0 };                        // momentum after a flick (rad/s)
  const tilt = { yaw: 0, pitch: 0 };                       // device tilt parallax
  let held = false, lastTouch = -1e9;
  const ptrs = new Map();
  let drag = null, pinch = null;
  const clampView = () => {
    want.yaw = Math.max(V.yawRange[0], Math.min(V.yawRange[1], want.yaw));
    want.pitch = Math.max(V.pitchRange[0], Math.min(V.pitchRange[1], want.pitch));
    want.zoom = Math.max(V.zoomRange[0], Math.min(V.zoomRange[1], want.zoom));
  };
  const free = () => !held;
  canvas.style.touchAction = "none";
  canvas.style.pointerEvents = "auto";
  const onDown = e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture?.(e.pointerId);
    lastTouch = performance.now();
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), lt: performance.now(), moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: want.zoom }; if (drag) drag.moved = 99; }
    vel.yaw = vel.pitch = 0;
  };
  const onMove = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastTouch = performance.now();
    if (ptrs.size >= 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      if (free()) { want.zoom = pinch.z * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)); clampView(); }
      return;
    }
    if (!drag) return;
    const now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, now - drag.lt) / 1000;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
    drag.x = e.clientX; drag.y = e.clientY; drag.lt = now;
    if (!free() || drag.moved < 6) return;
    const k = 2.2 / Math.max(240, canvas.clientWidth);   // a swipe across the screen ≈ the whole range
    want.yaw -= dx * k; want.pitch += dy * k * 0.6; clampView();
    vel.yaw = vel.yaw * 0.6 + (-dx * k / dt) * 0.4; vel.pitch = vel.pitch * 0.6 + (dy * k * 0.6 / dt) * 0.4;
  };
  const onUp = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    lastTouch = performance.now();
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0 && drag) {
      if (drag.moved < 8 && performance.now() - drag.t0 < 450) tap(e.clientX, e.clientY);
      if (performance.now() - drag.lt > 80) vel.yaw = vel.pitch = 0;   // held still before letting go: no flick
      drag = null;
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  // a tiny parallax from the phone's tilt, where the browser gives it
  // without a permission prompt (not iOS); its slow-moving average is "level"
  let tiltBase = null;
  const onTilt = e => {
    if (e.gamma == null || e.beta == null) return;
    if (!tiltBase) tiltBase = { g: e.gamma, b: e.beta };
    tiltBase.g += (e.gamma - tiltBase.g) * 0.02; tiltBase.b += (e.beta - tiltBase.b) * 0.02;
    tilt.yaw = Math.max(-0.05, Math.min(0.05, (e.gamma - tiltBase.g) * 0.003));
    tilt.pitch = Math.max(-0.03, Math.min(0.03, (e.beta - tiltBase.b) * 0.002));
  };
  const tiltOn = !reduce() && typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission !== "function"
    && new URLSearchParams(location.search).get("tilt") !== "0";
  if (tiltOn) addEventListener("deviceorientation", onTilt);

  // ---- taps: him, the ball, the lamp
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const targets = [{ kind: "ball", objs: [glass, stand] }, { kind: "lamp", objs: [lamp] }, { kind: "prophet", objs: hitMeshes }];
  let ballPokeT = 9, lampPokeT = 9, spinV = 0;
  const api = { onTap: null };
  function tap(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null;
    for (const t of targets) {
      const hit = ray.intersectObjects(t.objs, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { kind: t.kind, d: hit.distance };
    }
    // the ball is small on screen: a near miss still counts
    if (!best || best.kind !== "ball") {
      const b = st.rectOf(ballAnchor, R * 1.8);
      if (cx > b.left && cx < b.left + b.width && cy > b.top && cy < b.top + b.height) best = { kind: "ball" };
    }
    if (!best) return;
    const ok = api.onTap?.(best.kind);
    if (best.kind === "ball") { ballPokeT = 0; spinV = 9; }
    if (best.kind === "lamp") lampPokeT = 0;
    if (best.kind === "prophet" && ok) { if (Math.random() < 0.5) nodT = 0; else { puffK = 1; puffT = 5 + Math.random() * 4; } }
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
  const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), tmpC = new THREE.Color(), camPos = new THREE.Vector3(), bp = new THREE.Vector3();
  const deg = Math.PI / 180;

  st.onFrame((t, dt) => {
    const still = reduce();
    poseT += dt;
    // ---- the camera: momentum, then home after a while (or when held)
    const now = performance.now();
    if (!drag && !pinch && (Math.abs(vel.yaw) > 1e-4 || Math.abs(vel.pitch) > 1e-4)) {
      want.yaw += vel.yaw * dt; want.pitch += vel.pitch * dt; clampView();
      const f = Math.exp(-dt * 4.5); vel.yaw *= f; vel.pitch *= f;
    }
    const idle = ptrs.size === 0 && now - lastTouch > V.idleMs;
    if (held || idle) {
      const k = 1 - Math.exp(-dt * (held ? 3 : 1.8));
      want.yaw -= want.yaw * k; want.pitch -= want.pitch * k; want.zoom += (1 - want.zoom) * k;
      vel.yaw = vel.pitch = 0;
    }
    const ke = still ? 1 : 1 - Math.exp(-dt * 10);
    view.yaw += (want.yaw - view.yaw) * ke; view.pitch += (want.pitch - view.pitch) * ke; view.zoom += (want.zoom - view.zoom) * ke;
    pushNow += (pushGoal - pushNow) * (1 - Math.exp(-dt * 1.1));
    // swinging round to the left, the camera rises a little to look over the lamp
    const yaw = V.yaw + view.yaw + tilt.yaw, pitch = V.pitch + view.pitch + tilt.pitch + Math.max(0, -view.yaw - 0.35) * 0.32;
    const d = V.dist * view.zoom * (1 - pushNow * (1 - V.push));
    camPos.set(T.x + d * Math.sin(yaw) * Math.cos(pitch), T.y + d * Math.sin(pitch), T.z + d * Math.cos(yaw) * Math.cos(pitch));
    if (!still) { camPos.x += Math.sin(t * 0.31) * 0.005; camPos.y += Math.sin(t * 0.43 + 1) * 0.003; }
    camera.position.copy(camPos); camera.lookAt(T);
    // the same width in view on any screen as at 9:16
    const a = camera.aspect || V.aspect;
    const fov = a < V.aspect ? 2 * Math.atan(Math.tan(V.fov * deg / 2) * V.aspect / a) / deg : V.fov;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    // ---- him: targets are the seated base + this pose + small life
    const P = POSES[poseName];
    for (const n of BONES) {
      const b = SIT[n] ?? [0, 0, 0], p = P[n] ?? [0, 0, 0];
      target[n].set(b[0] + p[0], b[1] + p[1], b[2] + p[2]);
    }
    // he keeps half an eye on you: the head turns a little toward the camera
    target.head.y += Math.max(-0.4, Math.min(0.4, view.yaw * 0.45)); target.neck.y += Math.max(-0.2, Math.min(0.2, view.yaw * 0.2));
    target.head.x -= view.pitch * 0.4;
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
    // ---- the lamp: out of the way when it's in front of the ball; a tap: it flickers
    const lp = bp.copy(lamp.position); lp.y += 0.3;
    const lampD = lp.distanceTo(camera.position), ballD = BALL.distanceTo(camera.position);
    lp.project(camera); const bq = BALL.clone().project(camera);
    const sep = Math.hypot((lp.x - bq.x) * camera.aspect, lp.y - bq.y);
    const fadeTo = lampD < ballD && sep < 0.42 ? 0.18 + Math.max(0, sep - 0.2) * 2 : 1;
    lampFade += (Math.min(1, fadeTo) - lampFade) * Math.min(1, dt * 6);
    for (const m of lampMats) { m.opacity = lampFade; m.depthWrite = lampFade > 0.98; }
    lampPokeT += dt;
    const fl = lampPokeT < 0.9 && !still ? (Math.floor(lampPokeT * 16) % 3 === 1 ? 0.15 : 0.6 + 0.4 * Math.random()) : 1;
    lampLight.intensity = 0.2 * fl; shadeMat.emissiveIntensity = 0.75 * fl;
    // ---- the smoke: rises, drifts, widens, fades; thicker right after a puff
    bowl.getWorldPosition(bp);
    for (const sp of puffs) {
      const u = sp.userData;
      u.t += dt * (still ? 0 : 0.22);
      if (u.t >= 1) { u.t -= 1; u.x = (Math.random() - 0.5) * 0.02; }
      const a2 = u.t;
      sp.position.set(bp.x + u.x + Math.sin(a2 * 6 + t * 0.8) * 0.035 * a2, bp.y + 0.02 + a2 * 0.5, bp.z - a2 * 0.06);
      sp.scale.set(0.022 + a2 * 0.06, 0.05 + a2 * 0.12, 1);
      sp.material.opacity = (0.045 + puffK * 0.12) * Math.sin(Math.PI * Math.min(1, a2 * 1.1)) * (1 - a2 * 0.5);
    }
  });

  return Object.assign(api, {
    stage: st,
    setPose, orb, face: setFace,
    push: (k = 1) => { pushGoal = Math.max(0, Math.min(1, k)); },
    // glide back to the default view and stay there (the key moments)
    hold: (on = true) => { held = !!on; },
    ballRect: () => st.rectOf(ballAnchor, R),
    attach: el => st.attach(el),
    dispose: () => { if (tiltOn) removeEventListener("deviceorientation", onTilt); st.dispose(); },
    get pose() { return poseName; },
    // for tests and tuning: the scene's parts
    debug: { scene, camera, model, bone, view, want, SIT, POSES, VIEW, SEAT, T, tap, rest, lamp, table, door, shelf, stack, chair, glass, stand },
  });
}
