// The Art Gallery's host, Bunny: the hostess of Seoul's most exclusive
// secret masquerade, where the only art on display is people's real camera
// rolls. A white rabbit half-mask with tall ears and gold around the eyes,
// long straight black hair, a black off-the-shoulder lace-and-tulle dress,
// long black satin gloves, a pearl choker, black heels; a wooden gavel in
// her right hand, a champagne flute in her left. Thin, lanky, completely
// deadpan. One rigged low-poly mesh (games/artgallery/bunny/bunny.glb, see
// docs/npc_scenes.md), standing in the gala (gala.js), lit live by its
// candlelight. Animations are procedural on the bones (aimed limbs, blended
// quickly, no float):
//   idle      slow breathing, small head tilts, now and then a sip
//   unveil    she turns to the frame and presents it with the gavel
//   gavel     two raps of the gavel on the marble pedestal beside her
//   judge     a slow head tilt toward the photo, one slow nod
//   applause  two slow, sarcastic claps
//   sip       a sip of champagne; nod: a slow nod
// The mask's ears are rigid (they're the head's); her hair and the tulle
// skirt sway a little on their own bones.
//
// Look around: the same camera as the Prophet's and the Boss's
// (npcstage.js): drag to orbit, pinch, it glides home ~4 s after the last
// touch, never locked. Her head follows the camera a little.
//
//   const b = await bunnyScene(hostEl);
//   b.room.photo(url); b.room.drape(false); b.room.spot(1); b.play("gavel");
//   b.onTap = kind => ...;   // "bunny" | "frame" | "candle" | "plaque0" | "plaque1" (true: she reacts)
//   b.onBang = () => ...;    // the gavel hits the pedestal; b.onClap: her hands meet
//   b.room.plaque(i, {...}); b.room.plaqueState({...}); b.home();   // (gala.js)
//   b.plaqueRects(); b.attach(otherEl); b.dispose();
import { retroStage, THREE } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { galaRoom, PROJ, picFloor, FRAME_CENTRE } from "./gala.js";
import { viewFrom, orbitCamera, pickTap, headFollow, encode, screenBox } from "./npcstage.js";

const ART = new URL("./games/artgallery/bunny/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the stage: display-ready colour (the room's paint is the picture itself),
// warm candlelight, no bloom (the Prophet's and the Boss's settings)
export const BUNNY_MOOD = {
  // (more pixels than the other hosts' rooms: the plaques' titles are text
  // and stay sharp; the stage still steps down on a phone that can't keep up)
  scale: Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1)), maxW: 720, smooth: true, msaa: 4, encoded: true,
  bg: 0x1a0c0c,
  fog: { color: 0x1a0c0c, near: 30, far: 60 },
  ambient: { sky: 0xd8c8e8, ground: 0x4a2a24, intensity: 1.25 },
  key: { color: 0xffd6a8, intensity: 1.0, pos: [1.6, 2.6, 2.4] },
  fill: { color: 0xb8a8e0, intensity: 0.45, pos: [-2.2, 1.6, 1.6] },
  bloom: false,
  grade: { tint: [1, 1, 1], sat: 1, contrast: 1, lift: 0 },
  levels: 255, dither: 0, vignette: 0, grain: 0,
};

// the default view: the picture's camera, orbiting a point between her and
// the back wall (so the frame and its plaques stay in view however far you
// look); the gala is built wide (gala.js), so it goes further than the
// other hosts' rooms: ±40°
export const VIEW = viewFrom(PROJ, 5.2, { yawRange: [-1.05, 1.05] });

// where she stands (her feet, in the picture), her turn, her height to the
// ear tips; the marble pedestal by her right hand
const FEET = picFloor(0.19, 0.815);
export const SPOT = { x: FEET.x, z: FEET.z, turn: 0.22, height: 1.86 };
export const PEDESTAL = { x: FEET.x - 0.34, z: FEET.z - 0.32, h: 0.84 };

// ---------------------------------------------------------------- the poses
// Spine, neck and head as Euler offsets on the rest pose; arms and legs as
// directions (her own frame: +x her left, +y up, +z forward) for the upper
// and lower bone, the hand as an Euler twist. STAND is the picture's pose;
// the others say only what they change.
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
export const STAND = {
  hips: [0, 0, 0.02], spine: [0.02, 0.06, -0.02], chest: [0, 0.04, 0], neck: [0, 0, 0.03], head: [0.04, -0.08, 0.06],
  // her right: the elbow down by her side, the fist up by her collarbone, the gavel over her shoulder
  armR: { up: V(-0.18, -0.95, 0.22), fore: V(0.12, 0.85, 0.5), hand: [0.2, 0.2, -0.3] },
  // her left: the fist on her hip, elbow out, the flute upright in it
  armL: { up: V(0.8, -0.58, -0.12), fore: V(-0.72, -0.42, 0.56), hand: [0, 0, 0.2] },
  legR: { up: V(0.04, -1, 0.02), low: V(0.02, -1, -0.02) },
  legL: { up: V(0.3, -0.95, 0.1), low: V(0.34, -0.93, 0.08) },
  // the props' directions: the gavel's handle (its head at the top), the flute (upright)
  gavel: V(-0.5, 0.82, 0.28), flute: V(0, 1, 0),
};
// the gavel's head on the pedestal's block (solved for the block behind her right hip)
const STRIKE = { up: V(-0.83, -0.42, -0.34), fore: V(0.557, -0.646, -0.519), gavel: V(-0.09, -0.56, -0.82) };
export const POSES = {
  idle: {},
  // presenting the frame: turned toward it, the gavel held out at it
  unveil: { spine: [0, 0.32, 0], chest: [0, 0.2, 0], head: [-0.06, 0.25, 0.02],
    armR: { up: V(0.55, -0.1, 0.83), fore: V(0.88, 0.22, 0.42), hand: [0.4, 0, -0.2] }, gavel: V(0.8, 0.5, 0.33) },
  // the gavel raised over the pedestal (the raps are animated)
  gavel: { spine: [0.04, -0.2, -0.04], head: [0.16, -0.32, 0],
    armR: { up: V(-0.75, -0.35, -0.25), fore: V(-0.1, 0.85, -0.35), hand: [0, 0, 0] }, gavel: V(-0.25, 0.45, -0.86) },
  // judging: the head tilted toward the photo
  judge: { head: [-0.12, 0.3, -0.18], neck: [0, 0.12, -0.05] },
  // hands together in front of her chest (the claps are animated)
  applause: { armR: { up: V(-0.2, -0.75, 0.62), fore: V(0.55, 0.45, 0.7), hand: [0, 0, 0] },
    armL: { up: V(0.2, -0.75, 0.62), fore: V(-0.55, 0.45, 0.7), hand: [0, 0, 0] }, gavel: V(-0.2, 0.95, 0.2) },
};
const EULER_BONES = ["hips", "spine", "chest", "neck", "head"];

export async function bunnyScene(host) {
  const st = await retroStage(host, BUNNY_MOOD);
  const { scene, camera } = st;
  camera.near = 0.05; camera.far = 30;
  const room = await galaRoom(st);

  // her light: the candles' warmth from the front right, the windows' cool
  // light behind her left, the frame's spotlight
  const warm = new THREE.PointLight(0xffc890, 1.4, 4.5, 1.4); warm.position.set(SPOT.x + 1.2, 2.1, SPOT.z + 1.2); scene.add(warm);
  const rim = new THREE.PointLight(0xc0b0ff, 0.9, 3.5, 1.6); rim.position.set(SPOT.x - 0.9, 1.9, SPOT.z - 0.9); scene.add(rim);

  // ---- her: the rigged mesh, lit live
  const g = await new GLTFLoader().loadAsync(`${ART}bunny.glb`);
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
  const holder = new THREE.Group(); holder.position.set(SPOT.x, 0, SPOT.z); holder.rotation.y = SPOT.turn; holder.add(model); scene.add(holder);
  const rest = {}, restDir = {};
  for (const n of Object.keys(bone)) rest[n] = bone[n].quaternion.clone();
  // each limb bone's direction at rest (her frame): toward its child joint
  const wp = n => { const v = new THREE.Vector3(); bone[n].getWorldPosition(v); return holder.worldToLocal(v); };
  model.updateMatrixWorld(true);
  for (const [a, b] of [["upperarm_R", "forearm_R"], ["forearm_R", "hand_R"], ["upperarm_L", "forearm_L"], ["forearm_L", "hand_L"], ["thigh_R", "shin_R"], ["shin_R", "foot_R"], ["thigh_L", "shin_L"], ["shin_L", "foot_L"]])
    restDir[a] = wp(b).sub(wp(a)).normalize();

  // ---- props: the gavel (right hand), the flute (left), the pedestal
  const lit = (color, o = {}) => { const m = new THREE.MeshLambertMaterial({ color, ...o }); m.onBeforeCompile = encode; return m; };
  // (the props ride her hands in world space: placed at the palm each frame,
  // aimed along the pose's direction for them; metres)
  const gavel = new THREE.Group();
  const wood = lit(0x5a2e16), woodDark = lit(0x3a1c0c), brass = lit(0xc89a40, { emissive: 0x2a1a04 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.26, 8), wood); handle.position.y = 0.06; gavel.add(handle);
  const head = new THREE.Group(); head.position.y = 0.19; gavel.add(head);
  const gh = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.11, 12), woodDark); gh.rotation.z = Math.PI / 2; head.add(gh);
  for (const s of [-1, 1]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12), brass); band.rotation.z = Math.PI / 2; band.position.x = s * 0.04; head.add(band); }
  scene.add(gavel);
  const flute = new THREE.Group();
  const glassM = new THREE.MeshLambertMaterial({ color: 0xf4f0ff, transparent: true, opacity: 0.5, depthWrite: false }); glassM.onBeforeCompile = encode;
  const wineM = lit(0xf0d080, { emissive: 0x6a5018, transparent: true, opacity: 0.9 });
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [0.016, 0.01], [0.022, 0.06], [0.024, 0.11]].map(([x, y]) => new THREE.Vector2(x, y)), 12), glassM);
  bowl.position.y = 0.09; flute.add(bowl);
  const wine = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [0.014, 0.01], [0.019, 0.07], [0.0005, 0.07]].map(([x, y]) => new THREE.Vector2(x, y)), 12), wineM);
  wine.position.y = 0.092; flute.add(wine);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.09, 6), glassM); stem.position.y = 0.045; flute.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.003, 12), glassM); flute.add(foot);
  scene.add(flute);
  // the pedestal: a black marble column (gold veins) with a square top, her gavel's block on it
  const marble = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
    x.fillStyle = "#262220"; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = "rgba(200,170,120,.4)"; x.lineWidth = 1;
    for (let i = 0; i < 7; i++) { x.beginPath(); let px = Math.random() * 128, py = 0; x.moveTo(px, py); while (py < 128) { px += (Math.random() - 0.5) * 18; py += 8 + Math.random() * 10; x.lineTo(px, py); } x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const marbleM = lit(0xffffff, { map: marble });
  const ped = new THREE.Group(); ped.position.set(PEDESTAL.x, 0, PEDESTAL.z); scene.add(ped);
  const pedH = PEDESTAL.h;
  const addP = (geo, y, m = marbleM) => { const o = new THREE.Mesh(geo, m); o.position.y = y; ped.add(o); return o; };
  addP(new THREE.BoxGeometry(0.34, 0.06, 0.34), 0.03);
  addP(new THREE.CylinderGeometry(0.1, 0.12, pedH - 0.14, 14), (pedH - 0.14) / 2 + 0.06);
  addP(new THREE.BoxGeometry(0.36, 0.06, 0.36), pedH - 0.05);
  const block = addP(new THREE.CylinderGeometry(0.07, 0.075, 0.035, 16), pedH - 0.005, woodDark);
  const pedHits = []; ped.traverse(o => o.isMesh && pedHits.push(o));

  // ---- looking around (npcstage.js, shared with the Prophet and the Boss)
  const orbit = orbitCamera(st, VIEW, { onTap: (x, y) => tap(x, y) });
  const { view, want } = orbit;

  // ---- taps: her, the frame, a candle, the plaques
  const targets = [...room.targets, { kind: "bunny", objs: [...hitMeshes, gavel, flute, ...pedHits] }];
  const api = { onTap: null, onBang: null, onClap: null };
  function tap(cx, cy) {
    const best = pickTap(st, targets, cx, cy);
    if (!best) return;
    const ok = api.onTap?.(best.kind);
    room.poke(best.kind, best.point);
    if (best.kind === "bunny" && ok) play(Math.random() < 0.5 ? "sip" : "nod");
  }

  // ---- poses: targets per bone, blended quickly (critically damped, no float)
  let poseName = "idle";
  const cur = {}, tgt = {};
  const arr = v => (v?.isVector3 ? v.toArray() : v);
  const clonePose = p => JSON.parse(JSON.stringify(p, (k, v) => (v?.isVector3 ? [v.x, v.y, v.z] : v)));
  const base = clonePose(STAND);
  for (const n of EULER_BONES) { cur[n] = new THREE.Vector3(...base[n]); tgt[n] = new THREE.Vector3(); }
  const LIMBS = { armR: ["upperarm_R", "forearm_R", "hand_R"], armL: ["upperarm_L", "forearm_L", "hand_L"], legR: ["thigh_R", "shin_R", null], legL: ["thigh_L", "shin_L", null] };
  for (const k of Object.keys(LIMBS)) {
    const b = base[k];
    cur[k] = { a: new THREE.Vector3(...b.up), b: new THREE.Vector3(...(b.fore ?? b.low)), h: new THREE.Vector3(...(b.hand ?? [0, 0, 0])) };
    tgt[k] = { a: new THREE.Vector3(), b: new THREE.Vector3(), h: new THREE.Vector3() };
  }
  cur.gavel = new THREE.Vector3(...base.gavel); cur.flute = new THREE.Vector3(...base.flute); tgt.gavel = new THREE.Vector3(); tgt.flute = new THREE.Vector3();
  function setPose(name) { if (!POSES[name]) name = "idle"; poseName = name; }
  // one-off animations on top of the pose
  const acts = new Map();
  const LEN = { sip: 3.0, nod: 1.6, gavel: 1.7, applause: 2.2, judge: 3.2, unveil: 2.6 };
  function play(name) { if (!LEN[name]) return; acts.set(name, 0); if (name === "gavel") bangs = [0.42, 0.72]; if (name === "applause") claps = [0.35, 0.65]; }
  let bangs = [], claps = [], blockT = 9;
  const env = (k, a = 0.25, b = 0.25) => Math.max(0, Math.min(1, k / a, (1 - k) / b));
  const ease = k => k * k * (3 - 2 * k);
  let nextSip = 6 + Math.random() * 5;
  const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), qW = new THREE.Quaternion(), qa = new THREE.Quaternion(), qInv = new THREE.Quaternion();
  const dirA = new THREE.Vector3(), dirB = new THREE.Vector3();
  const mixDir = (out, from, to, k) => out.copy(from).lerp(to, k).normalize();
  // aim a limb: the upper bone along `a`, the lower along `b` (her frame)
  function aimLimb([up, low, hand], a, b, h, parentW) {
    if (!bone[up]) return;
    qa.setFromUnitVectors(restDir[up], a);
    qInv.copy(parentW).invert();
    bone[up].quaternion.copy(rest[up]).premultiply(qInv.clone().multiply(qa));   // local = inv(parent) * world-aim
    const upW = qW.copy(parentW).multiply(bone[up].quaternion);
    qa.setFromUnitVectors(restDir[low], b);
    bone[low].quaternion.copy(upW.clone().invert().multiply(qa));
    if (hand && bone[hand]) bone[hand].quaternion.copy(rest[hand]).multiply(tmpQ.setFromEuler(tmpE.set(h.x, h.y, h.z)));
  }
  // a prop in a hand: at the palm (a little along the hand from the wrist),
  // its +y along `dir` (her frame), held `back` metres below its origin, `fwd` in front
  const hq = new THREE.Quaternion(), bq = new THREE.Quaternion(), palm = new THREE.Vector3(), hd = new THREE.Vector3();
  const px = new THREE.Vector3(), py = new THREE.Vector3(), pz = new THREE.Vector3(), FWD = new THREE.Vector3(0, 0, 1), basis = new THREE.Matrix4();
  const handTip = { hand_R: V(-0.032, -0.055, 0.01), hand_L: V(0.032, -0.055, 0.01) };
  function placeProp(obj, hand, dir, back, fwd = 0) {
    const b = bone[hand]; if (!b) return;
    holder.getWorldQuaternion(hq); b.getWorldQuaternion(bq); b.getWorldPosition(palm);
    palm.addScaledVector(hd.copy(handTip[hand]).applyQuaternion(bq), 0.05);
    py.copy(dir).applyQuaternion(hq).normalize();
    pz.copy(FWD).applyQuaternion(hq);
    px.crossVectors(py, pz).normalize(); pz.crossVectors(px, py);
    obj.quaternion.setFromRotationMatrix(basis.makeBasis(px, py, pz));
    obj.position.copy(palm).addScaledVector(py, -back).addScaledVector(pz, fwd);
  }

  st.onFrame((t, dt) => {
    const still = reduce();
    orbit.update(t, dt);
    // ---- targets: the stance + this pose
    const P = POSES[poseName];
    for (const n of EULER_BONES) { const b = base[n], p = P[n] ?? [0, 0, 0]; tgt[n].set(b[0] + p[0], b[1] + p[1], b[2] + p[2]); }
    for (const k of Object.keys(LIMBS)) {
      const src = P[k] ?? {}, b = base[k];
      tgt[k].a.set(...arr(src.up ?? b.up));
      tgt[k].b.set(...arr(src.fore ?? src.low ?? b.fore ?? b.low));
      tgt[k].h.set(...arr(src.hand ?? b.hand ?? [0, 0, 0]));
    }
    tgt.gavel.set(...arr(P.gavel ?? base.gavel)); tgt.flute.set(...arr(P.flute ?? base.flute));
    headFollow(tgt, view);
    for (const [name, a] of acts) { const k = a + dt / LEN[name]; if (k >= 1) acts.delete(name); else acts.set(name, k); }
    if (!still) {
      const br = Math.sin(t * 1.05);                                   // breathing, slow
      tgt.chest.x += br * 0.014; tgt.spine.x += br * 0.006;
      if (poseName === "idle") {
        tgt.head.z += Math.sin(t * 0.31) * 0.05 * Math.max(0, Math.sin(t * 0.13));   // a small tilt now and then
        tgt.head.y += Math.sin(t * 0.19 + 1) * 0.04;
        nextSip -= dt;
        if (nextSip < 0) { nextSip = 10 + Math.random() * 8; if (!acts.size) play("sip"); }
      }
    }
    // a sip: the flute up to under her mask, a small tilt back, down again
    if (acts.has("sip")) {
      const k = acts.get("sip"), e = ease(env(k, 0.3, 0.3));
      mixDir(tgt.armL.a, tgt.armL.a, V(0.35, -0.8, 0.45), e); mixDir(tgt.armL.b, tgt.armL.b, V(-0.6, 0.62, 0.5), e);
      tgt.armL.h.z -= 0.6 * e; tgt.head.x -= 0.1 * ease(env(k, 0.45, 0.3));
    }
    // a slow nod: one dip, then settle
    if (acts.has("nod")) { const k = acts.get("nod"); tgt.head.x += Math.sin(k * Math.PI) * 0.2; tgt.neck.x += Math.sin(k * Math.PI) * 0.06; }
    // judging: a slow tilt toward the photo, then the single slow nod
    if (acts.has("judge")) {
      const k = acts.get("judge"), e = ease(env(k, 0.3, 0.2));
      tgt.head.y += 0.45 * e; tgt.head.z -= 0.28 * e; tgt.head.x -= 0.14 * e; tgt.neck.y += 0.12 * e;
      if (k > 0.55 && k < 0.85) tgt.head.x += Math.sin((k - 0.55) / 0.3 * Math.PI) * 0.22;
    }
    // the gavel: raised, then two raps on the pedestal's block
    if (acts.has("gavel")) {
      const k = acts.get("gavel"), e = ease(env(k, 0.18, 0.2)), G = POSES.gavel;
      const rap = Math.max(...[0.42, 0.72].map(c => Math.max(0, 1 - Math.abs(k - c) / 0.11) ** 0.7));
      mixDir(tgt.armR.a, tgt.armR.a, dirA.copy(G.armR.up).lerp(STRIKE.up, rap), e);
      mixDir(tgt.armR.b, tgt.armR.b, dirB.copy(G.armR.fore).lerp(STRIKE.fore, rap), e);
      mixDir(tgt.gavel, tgt.gavel, dirA.copy(G.gavel).lerp(STRIKE.gavel, rap), e);
      tgt.spine.y += G.spine[1] * e; tgt.head.y += G.head[1] * e; tgt.head.x += G.head[0] * e;
      while (bangs.length && k >= bangs[0]) { bangs.shift(); api.onBang?.(); blockT = 0; }
    }
    // the applause: two slow claps in front of her chest
    if (acts.has("applause")) {
      const k = acts.get("applause"), e = ease(env(k, 0.2, 0.2));
      const prog = Math.max(0, Math.min(1, (k - 0.2) / 0.6));
      const clap = Math.max(0, Math.sin(prog * Math.PI * 4 - Math.PI / 2)) ** 1.5, inward = 0.3 + clap * 0.45;
      mixDir(tgt.armR.a, tgt.armR.a, V(-0.25, -0.7, 0.65), e); mixDir(tgt.armR.b, tgt.armR.b, V(inward, 0.4, 0.7), e);
      mixDir(tgt.armL.a, tgt.armL.a, V(0.25, -0.7, 0.65), e); mixDir(tgt.armL.b, tgt.armL.b, V(-inward, 0.4, 0.7), e);
      tgt.head.x -= 0.06 * e; tgt.head.z += 0.08 * e;
      while (claps.length && k >= claps[0]) { claps.shift(); api.onClap?.(); }
    }
    // ---- blend toward the targets
    const kb = 1 - Math.exp(-dt * 8);
    for (const n of EULER_BONES) cur[n].lerp(tgt[n], kb);
    mixDir(cur.gavel, cur.gavel, tgt.gavel, kb); mixDir(cur.flute, cur.flute, tgt.flute, kb);
    for (const k of Object.keys(LIMBS)) { mixDir(cur[k].a, cur[k].a, tgt[k].a, kb); mixDir(cur[k].b, cur[k].b, tgt[k].b, kb); cur[k].h.lerp(tgt[k].h, kb); }
    // ---- apply: the spine chain by Euler, the limbs aimed in her frame
    for (const n of EULER_BONES) if (bone[n]) bone[n].quaternion.copy(rest[n]).multiply(tmpQ.setFromEuler(tmpE.set(cur[n].x, cur[n].y, cur[n].z)));
    const hipsW = bone.hips.quaternion.clone();
    const chestW = hipsW.clone().multiply(bone.spine.quaternion).multiply(bone.chest.quaternion);
    aimLimb(LIMBS.armR, cur.armR.a, cur.armR.b, cur.armR.h, chestW.clone().multiply(bone.shoulder_R.quaternion));
    aimLimb(LIMBS.armL, cur.armL.a, cur.armL.b, cur.armL.h, chestW.clone().multiply(bone.shoulder_L.quaternion));
    aimLimb(LIMBS.legR, cur.legR.a, cur.legR.b, cur.legR.h, hipsW);
    aimLimb(LIMBS.legL, cur.legL.a, cur.legL.b, cur.legL.h, hipsW);
    // ---- the props at her palms
    model.updateMatrixWorld(true);
    placeProp(gavel, "hand_R", cur.gavel, 0);
    placeProp(flute, "hand_L", cur.flute, 0.045, 0.05);
    // the hair and the tulle: a little sway of their own
    if (bone.hair) bone.hair.quaternion.copy(rest.hair).multiply(tmpQ.setFromEuler(tmpE.set(still ? 0 : Math.sin(t * 0.9) * 0.025 - cur.head.x * 0.4, 0, still ? 0 : Math.sin(t * 0.7 + 1) * 0.02 - cur.head.z * 0.5)));
    if (bone.skirt) bone.skirt.quaternion.copy(rest.skirt).multiply(tmpQ.setFromEuler(tmpE.set(still ? 0 : Math.sin(t * 0.8 + 2) * 0.012, still ? 0 : Math.sin(t * 0.5) * 0.04, still ? 0 : Math.sin(t * 0.65) * 0.015)));
    // ---- the gavel's block jumps a hair when it's hit
    blockT += dt;
    block.position.y = pedH - 0.005 + (blockT < 0.15 ? Math.sin(blockT / 0.15 * Math.PI) * 0.006 : 0);
    room.update(t, dt);
  });

  Object.defineProperty(api, "pose", { get: () => poseName });
  return Object.assign(api, {
    stage: st, room,
    setPose, play,
    playing: name => acts.has(name),
    push: orbit.push,
    home: orbit.home,
    plaqueRects: () => room.plaqueRects(),
    attach: el => st.attach(el),
    dispose: () => { orbit.dispose(); room.dispose(); marble.dispose(); st.dispose(); },
    // for tests and tuning
    debug: { hostRect: () => screenBox(st, model), frameRect: () => screenBox(st, room.photoMesh), scene, camera, model, holder, bone, view, want, STAND, POSES, VIEW, SPOT, PEDESTAL, T: orbit.T, tap, rest, restDir, room, gavel, flute, ped, acts, cur, lights: { warm, rim, hemi: st.lights.hemi }, FRAME_CENTRE },
  });
}
