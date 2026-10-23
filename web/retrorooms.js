// The game scenes' rooms on the retro look kit (retrolook.js), each with its
// own mood and the same DNA as the world map and Side Quest's nook:
//
//   tent   — Humiliation Ritual: a little circus tent at night, warm stage
//            spotlights and a cool blue fill, string lights, confetti
//   study  — Secret Diary: a cozy bedroom/study late at night, a warm desk
//            lamp and moonlight through the window, floating dust
//   lounge — Mask Off: a dim lounge, one overhead light, deep reds and
//            purples, smoke haze
//
//   const room = await retroRoom("tent", hostEl);   // a canvas filling hostEl
//   room.stage   // the kit's stage (scene, camera, onFrame, attach, dispose)
//
// Props are generated low-poly meshes (web/games/rooms/<room>/*.glb, logged
// in docs/npc_scenes.md); walls, floors, lights and particles are built here.
import { retroStage, THREE, flat, bakeAO, pixelModel, lambertize, motes, flicker, breathe, blobShadow, mirrorDom, litCardMaterial } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const ROOMS = new URL("./games/rooms/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const MOODS = {
  tent: {
    bg: 0x0b0814,
    fog: { color: 0x1a1030, near: 5, far: 13 },
    ambient: { sky: 0x4a3070, ground: 0x1a0c10, intensity: 0.55 },
    key: { color: 0xffb070, intensity: 0.5, pos: [0, 4, 4] },
    fill: { color: 0x3c6cff, intensity: 0.9, pos: [-3, 2.5, -2] },
    bloom: { threshold: 0.68, strength: 1.0 },
    grade: { tint: [1.07, 0.97, 0.94], sat: 0.95, contrast: 1.08, lift: 0.02 },
  },
  study: {
    fps: 30,                 // behind the cards: ambient, no need for more
    bg: 0x0a0c18,
    fog: { color: 0x141a34, near: 4, far: 11 },
    ambient: { sky: 0x3a4a80, ground: 0x1a1210, intensity: 0.55 },
    key: { color: 0xffb36a, intensity: 0.35, pos: [-2, 3, 3] },
    fill: { color: 0x5a7cff, intensity: 0.85, pos: [2.5, 2.5, -1] },      // moonlight through the window
    bloom: { threshold: 0.7, strength: 0.95 },
    grade: { tint: [1.05, 0.98, 0.95], sat: 0.92, contrast: 1.06, lift: 0.025 },
  },
  lounge: {
    fps: 30,
    bg: 0x0c0508,
    fog: { color: 0x2a0c1a, near: 3.5, far: 10 },
    ambient: { sky: 0x4a1830, ground: 0x0e0408, intensity: 0.45 },
    key: { color: 0xff7a5a, intensity: 0.25, pos: [0, 4, 2] },
    fill: { color: 0x8a3cff, intensity: 0.55, pos: [3, 2, -2] },
    bloom: { threshold: 0.66, strength: 1.1 },
    grade: { tint: [1.08, 0.94, 0.97], sat: 0.95, contrast: 1.1, lift: 0.015 },
  },
};

// a generated prop: Lambert, small nearest textures, scaled to a height, its
// base on the floor, with baked AO and a blob shadow
async function prop(st, room, name, { pos, rot = 0, height, ao = true, shadow = 0 }) {
  try {
    const g = await new GLTFLoader().loadAsync(`${ROOMS}${room}/${name}.glb`);
    const m = lambertize(pixelModel(g.scene, 256));
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    m.scale.setScalar(height / size.y);
    const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -b.min.y, -c.z);
    const holder = new THREE.Group();
    holder.add(m); holder.position.set(...pos); holder.rotation.y = rot;
    st.scene.add(holder);
    if (ao) bakeAO(holder, { floor: pos[1], reach: Math.min(1, height), strength: 0.45 });
    if (shadow) { const s = blobShadow(shadow, shadow * 0.6, 0.45); s.position.set(pos[0], pos[1] + 0.005, pos[2]); st.scene.add(s); }
    return holder;
  } catch (e) { console.warn("[retrorooms] no", room, name, e?.message ?? e); return null; }
}
const canvasTex = (w, h, draw) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
let softTex = null;
const soft = () => softTex ??= (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const glowSprite = (color, size, opacity = 0.9) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size); return s;
};
// a soft volumetric cone of light (additive), from `from` toward `to`
function beam(st, from, to, { radius = 0.9, color = 0xffd8a0, opacity = 0.09 } = {}) {
  const len = from.distanceTo(to);
  const g = new THREE.ConeGeometry(radius, len, 18, 1, true); g.translate(0, -len / 2, 0);
  // soft: brightest along the axis where you look through the most light,
  // fading to nothing at the silhouette and toward the far end
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, len: { value: len } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vY = -position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float opacity, len; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.5); float a = opacity * f * (1.0 - smoothstep(0.35, 1.0, vY / len)) * smoothstep(0.0, 0.08, vY / len);
        gl_FragColor = vec4(color * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  }));
  m.position.copy(from); m.lookAt(to); m.rotateX(-Math.PI / 2);
  st.scene.add(m); return m;
}
// a string of little bulbs hanging in a curve between two points
function stringLights(st, a, b, { n = 9, sag = 0.35, color = 0xffd27a } = {}) {
  const g = new THREE.Group(), pts = [];
  for (let i = 0; i <= 24; i++) { const k = i / 24, p = a.clone().lerp(b, k); p.y -= Math.sin(k * Math.PI) * sag; pts.push(p); }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1a1210 })));
  const bulbs = [];
  for (let i = 1; i < n; i++) {
    const k = i / n, p = a.clone().lerp(b, k); p.y -= Math.sin(k * Math.PI) * sag + 0.04;
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 0), new THREE.MeshBasicMaterial({ color }));
    bulb.position.copy(p); g.add(bulb);
    const halo = glowSprite(color, 0.22, 0.55); halo.position.copy(p); g.add(halo); bulbs.push(halo);
  }
  st.scene.add(g);
  if (!reduce()) st.onFrame(t => bulbs.forEach((h, i) => { h.material.opacity = 0.45 + 0.15 * Math.sin(t * 2 + i * 1.3); }));
  return g;
}

// ---------------------------------------------------------------- the tent
async function tent(st) {
  const { scene } = st;
  // the tent: a ring of red and cream canvas panels and a striped roof cone
  const stripes = canvasTex(64, 8, (x, w, h) => { for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? "#e9d8b8" : "#a8283a"; x.fillRect(i * 4, 0, 4, h); } });
  stripes.wrapS = THREE.RepeatWrapping; stripes.repeat.set(2, 1);
  const wallG = new THREE.CylinderGeometry(4.2, 4.6, 3.4, 32, 1, true, Math.PI * 0.55, Math.PI * 0.9);
  const wall = new THREE.Mesh(wallG, new THREE.MeshLambertMaterial({ map: stripes, side: THREE.BackSide, flatShading: true, emissive: 0x2a0c14 }));
  wall.position.set(0, 1.7, 0.6); scene.add(bakeAO(wall, { reach: 2, strength: 0.5 }));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.4, 32, 1, true), new THREE.MeshLambertMaterial({ map: stripes, side: THREE.BackSide, flatShading: true }));
  roof.position.set(0, 4.6, 0.6); scene.add(roof);
  // a warm wash on the back canvas so the stripes read
  const wash = new THREE.PointLight(0xff9a60, 1.4, 6, 1.5); wash.position.set(0, 2.6, -1.4); scene.add(wash);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 6, 6), flat(0x6a4630)); pole.position.set(0, 3, -2.9); scene.add(pole);
  // the floor: dark boards, the round stage on it
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 30), flat(0x2e1c18)); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const stageTop = canvasTex(64, 64, (x) => {
    x.fillStyle = "#7a2a30"; x.beginPath(); x.arc(32, 32, 31, 0, 7); x.fill();
    x.strokeStyle = "#e0b24a"; x.lineWidth = 3; x.beginPath(); x.arc(32, 32, 27, 0, 7); x.stroke();
    x.fillStyle = "#e0b24a"; for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; x.fillRect(32 + Math.cos(a) * 20 - 1.5, 32 + Math.sin(a) * 20 - 1.5, 3, 3); }
  });
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.28, 24), [flat(0x8a2a34), new THREE.MeshLambertMaterial({ map: stageTop }), flat(0x4a1418)]);
  stage.position.set(0, 0.14, -0.4); scene.add(bakeAO(stage, { reach: 0.3, strength: 0.4 }));
  // props
  await Promise.all([
    prop(st, "tent", "spot", { pos: [-0.82, 0, 1.3], rot: 0.9, height: 0.9, shadow: 0.6 }),
    prop(st, "tent", "spot", { pos: [0.85, 0, 1.2], rot: -2.3, height: 0.88, shadow: 0.6 }),
    prop(st, "tent", "crates", { pos: [-1.35, 0, -1.9], rot: 0.4, height: 1.05, shadow: 0.9 }),
  ]);
  // the stage spotlights: warm cones from the lamps onto the stage
  const target = new THREE.Object3D(); target.position.set(0, 0.3, -0.2); scene.add(target);
  for (const [x, z] of [[-1.0, 1.25], [1.05, 1.15]]) {
    const sp = new THREE.SpotLight(0xffc27a, 3.2, 9, 0.42, 0.55, 1.4);
    sp.position.set(x, 0.85, z); sp.target = target; scene.add(sp);
    flicker(st, sp, { amount: 0.06, speed: 3 });
    beam(st, new THREE.Vector3(x * 0.95, 0.85, z), new THREE.Vector3(x * 0.1, 0.5, -0.5), { radius: 0.5, opacity: 0.16 });
  }
  // string lights across the top
  stringLights(st, new THREE.Vector3(-3, 3.1, -1.5), new THREE.Vector3(3, 3.1, -1.5), { n: 11, sag: 0.45 });
  stringLights(st, new THREE.Vector3(-2.6, 3.4, 0.6), new THREE.Vector3(2.6, 3.3, 0.4), { n: 9, sag: 0.35, color: 0xff9ac8 });
  // confetti, drifting down
  const N = 90, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), C = [0xffc83d, 0xff5d8a, 0x3ee0d0, 0xffffff, 0x8ab4ff];
  for (let i = 0; i < N; i++) { pos.set([(Math.random() - 0.5) * 5, Math.random() * 3.6, (Math.random() - 0.5) * 3], i * 3); new THREE.Color(C[i % C.length]).toArray(col, i * 3); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.85 })));
  if (!reduce()) st.onFrame((t, dt) => { for (let i = 0; i < N; i++) { let y = pos[i * 3 + 1] - dt * (0.12 + (i % 5) * 0.03); if (y < 0) y += 3.6; pos[i * 3 + 1] = y; pos[i * 3] += Math.sin(t + i) * dt * 0.05; } cg.attributes.position.needsUpdate = true; });
  st.camera.fov = 44;
  st.camera.position.set(0, 1.6, 6.4);
  breathe(st, { amp: 0.012, target: new THREE.Vector3(0, 1.45, 0) });
  // the game's stage pieces (the clown, the machine, the capsules) as cards
  // in the tent: the spotlights' warm key, the night's blue on their far
  // edges, a little warm bounce from the stage
  const mirror = root => mirrorDom(st, root, {
    distance: 6.2, fog: 0.12,
    material: () => { const m = litCardMaterial(st.mood, { key: 0xffc890, rim: 0x5a7cff, ambient: 0x5a4a7a }); m.uniforms.glowAmt.value = 0.25; m.uniforms.glow.value.setHex(0xffa860); return m; },
  });
  return { stageTarget: target, mirror };
}

// ---------------------------------------------------------------- the study
async function study(st) {
  const { scene } = st;
  const wallTex = canvasTex(32, 32, (x) => { x.fillStyle = "#3a3458"; x.fillRect(0, 0, 32, 32); x.fillStyle = "#433c66"; for (let i = 0; i < 32; i += 8) x.fillRect(i, 0, 4, 32); });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping; wallTex.repeat.set(6, 3);
  const wallM = new THREE.MeshLambertMaterial({ map: wallTex });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.4), wallM); back.position.set(0, 1.7, -2.2); scene.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4), wallM); left.position.set(-3.1, 1.7, 0.2); left.rotation.y = Math.PI / 2; scene.add(left);
  const right = left.clone(); right.position.x = 3.1; right.rotation.y = -Math.PI / 2; scene.add(right);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), flat(0x4a3428)); floor.rotation.x = -Math.PI / 2; floor.position.z = 0.6; scene.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), flat(0x8a4a6a)); rug.rotation.x = -Math.PI / 2; rug.position.set(0.2, 0.006, 0.4); scene.add(rug);
  // the window: night sky (the world map's), a moon, moonlight coming in
  const win = new THREE.Group(); win.position.set(-0.9, 2.0, -2.18);
  const sky = await new Promise(res => new THREE.TextureLoader().load(new URL("./world2/sky_night.jpg", import.meta.url).href, res, undefined, () => res(null)));
  if (sky) { sky.colorSpace = THREE.SRGBColorSpace; sky.magFilter = THREE.NearestFilter; sky.repeat.set(0.25, 0.5); sky.offset.set(0.4, 0.45); sky.wrapS = THREE.RepeatWrapping; }
  win.add(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.1), new THREE.MeshBasicMaterial({ map: sky, color: 0xa8b8ff, fog: false })));
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false })); moon.position.set(0.32, 0.25, 0.01); win.add(moon);
  const mh = glowSprite(0xdde4ff, 0.6, 0.5); mh.position.set(0.32, 0.25, 0.02); win.add(mh);
  for (const [w, h, x, y] of [[1.42, 0.07, 0, 0.58], [1.42, 0.07, 0, -0.58], [0.07, 1.22, -0.68, 0], [0.07, 1.22, 0.68, 0], [0.05, 1.1, 0, 0], [1.3, 0.05, 0, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), flat(0xd8c8a8)); b.position.set(x, y, 0.03); win.add(b);
  }
  scene.add(win);
  if (sky && !reduce()) st.onFrame((t, dt) => { sky.offset.x += dt * 0.003; });
  beam(st, new THREE.Vector3(-0.9, 2.0, -2.1), new THREE.Vector3(-0.1, 0, -0.2), { radius: 0.6, color: 0x8aa0ff, opacity: 0.16 });
  // props
  const [desk] = await Promise.all([
    prop(st, "study", "desk", { pos: [-0.95, 0, -1.55], rot: 0.35, height: 1.3, shadow: 1.3 }),
    prop(st, "study", "bed", { pos: [1.05, 0, -1.3], rot: -0.45, height: 1.0, shadow: 1.6 }),
  ]);
  // shelves with books on the back wall
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.25), flat(0x6a4a34)); shelf.position.set(1.15, 2.25, -2.08); scene.add(shelf);
  const BK = [0xc0566a, 0x4a6ab0, 0xd8b04a, 0x5aa080, 0x9a5ab0, 0xe08a4a];
  for (let i = 0; i < 9; i++) { const h = 0.2 + (i % 3) * 0.05, b = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.18), flat(BK[i % BK.length])); b.position.set(0.66 + i * 0.1, 2.275 + h / 2, -2.06); b.rotation.z = i === 7 ? 0.3 : 0; scene.add(b); }
  // posters, fairy lights over the bed
  for (const [x, y, c, w, h] of [[0.15, 2.0, 0xff8aa8, 0.42, 0.56], [0.68, 1.62, 0x7ad0e0, 0.34, 0.34]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat(c)); p.position.set(x, y, -2.19); scene.add(p); }
  stringLights(st, new THREE.Vector3(1.0, 2.0, -2.1), new THREE.Vector3(3.0, 2.1, -0.5), { n: 10, sag: 0.25, color: 0xffd6a0 });
  // the desk lamp: the room's warm light
  const lampP = new THREE.Vector3(-1.3, 1.25, -1.6);
  const lamp = new THREE.PointLight(0xffb060, 2.6, 4.5, 1.5); lamp.position.copy(lampP); scene.add(lamp);
  const lg = glowSprite(0xffc070, 0.55, 0.85); lg.position.copy(lampP); scene.add(lg);
  flicker(st, lamp, { amount: 0.05, speed: 2 });
  motes(st, { count: 60, box: [3, 2.2, 2.2], center: [-0.3, 1.3, -0.4], color: 0xcfd6ff, size: 0.028 });
  st.camera.fov = 58;
  st.camera.position.set(0.1, 1.55, 3.6);
  breathe(st, { amp: 0.01, target: new THREE.Vector3(0, 1.3, -1.2) });
  return {};
}

// ---------------------------------------------------------------- the lounge
async function lounge(st) {
  const { scene } = st;
  const wallTex = canvasTex(32, 64, (x) => { x.fillStyle = "#3a1220"; x.fillRect(0, 0, 32, 64); x.fillStyle = "#4a1a2c"; for (let i = 0; i < 32; i += 8) x.fillRect(i, 0, 3, 40); x.fillStyle = "#24080f"; x.fillRect(0, 40, 32, 24); x.fillStyle = "#b08840"; x.fillRect(0, 40, 32, 2); });
  wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(5, 1);
  const wallG = new THREE.CylinderGeometry(3.6, 3.6, 3.4, 28, 1, true, Math.PI * 0.55, Math.PI * 0.9);
  const wall = new THREE.Mesh(wallG, new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.BackSide, flatShading: true })); wall.position.set(0, 1.7, 0.4);
  scene.add(bakeAO(wall, { reach: 2.2, strength: 0.5 }));
  const floorTex = canvasTex(32, 32, (x) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#1a0a10" : "#2e1220"; x.fillRect(i * 8, j * 8, 8, 8); } });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(6, 6);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 28), new THREE.MeshLambertMaterial({ map: floorTex })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  await Promise.all([
    prop(st, "lounge", "sofa", { pos: [0, 0, -1.45], height: 0.95, shadow: 2.6 }),
    prop(st, "lounge", "sidetable", { pos: [-1.0, 0, -0.35], rot: 0.4, height: 0.8, shadow: 0.6 }),
    prop(st, "lounge", "sidetable", { pos: [1.05, 0, -0.3], rot: -0.6, height: 0.76, shadow: 0.6 }),
  ]);
  // the one overhead light: a pendant shade, a hard cone of light down onto the booth
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.26, 10, 1, true), flat(0x1a0a0a, { side: THREE.DoubleSide })); shade.position.set(0, 2.85, -0.7); scene.add(shade);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.2, 4), flat(0x0a0404)); cord.position.set(0, 3.55, -0.7); scene.add(cord);
  const bulbG = glowSprite(0xffb070, 0.5, 0.95); bulbG.position.set(0, 2.72, -0.7); scene.add(bulbG);
  const over = new THREE.SpotLight(0xffa070, 4.2, 6, 0.55, 0.6, 1.3); over.position.set(0, 2.7, -0.7);
  const tgt = new THREE.Object3D(); tgt.position.set(0, 0, -0.9); scene.add(tgt); over.target = tgt; scene.add(over);
  beam(st, new THREE.Vector3(0, 2.7, -0.7), new THREE.Vector3(0, 0, -0.9), { radius: 0.7, color: 0xffa080, opacity: 0.07 });
  // candles on the side tables
  for (const [x, z] of [[-1.0, -0.35], [1.05, -0.3]]) {
    const c = new THREE.PointLight(0xff6a40, 0.9, 2.2, 1.8); c.position.set(x, 0.95, z); scene.add(c); flicker(st, c, { amount: 0.3, speed: 9 });
    const g = glowSprite(0xff7a40, 0.32, 0.8); g.position.set(x, 0.92, z); scene.add(g);
  }
  // smoke haze: big soft sprites drifting slowly
  const smoke = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: 0x8a5a7a, transparent: true, opacity: 0.025, depthWrite: false }));
    s.scale.set(2.4 + Math.random() * 1.6, 0.9 + Math.random() * 0.6, 1); s.position.set((Math.random() - 0.5) * 4, 0.8 + Math.random() * 2, -1.5 + Math.random() * 2);
    s.userData = { x: s.position.x, ph: Math.random() * 6 }; scene.add(s); smoke.push(s);
  }
  if (!reduce()) st.onFrame(t => smoke.forEach(s => { s.position.x = s.userData.x + Math.sin(t * 0.07 + s.userData.ph) * 0.6; s.material.rotation = t * 0.02 + s.userData.ph; }));
  motes(st, { count: 40, box: [2.5, 2.4, 2], center: [0, 1.3, -0.8], color: 0xffb0a0, size: 0.025 });
  st.camera.fov = 54;
  st.camera.position.set(0, 1.5, 3.7);
  breathe(st, { amp: 0.01, target: new THREE.Vector3(0, 1.2, -0.9) });
  return {};
}

const BUILD = { tent, study, lounge };
export async function retroRoom(kind, host) {
  const st = await retroStage(host, MOODS[kind] ?? {});
  const extra = await BUILD[kind](st);
  st.camera.updateProjectionMatrix();
  return { stage: st, ...extra, dispose: () => st.dispose() };
}
