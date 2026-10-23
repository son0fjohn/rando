// Side Quest's fortune-teller nook, drawn in 3D with the retro look kit
// (retrolook.js): a low-poly room at night (draped fabric, a round window
// with stars and drifting clouds, potion shelves, hanging star lanterns,
// floating candles, dust in the light), the wizard behind his table and the
// crystal ball on it. The ball is a light source: it glows violet and pulses
// on the reveals.
//
// The wizard is the same pose cutouts as before, on a card standing in the
// room and lit by it (the candle's amber from the left, the violet fill on
// his right edge, the ball's glow from below, the room's fog). The players'
// 3D looks (charrender.js) float inside the ball, tinted by its light.
//
//   const nook = await sqNook(hostEl);
//   nook.setPose("wizard_conj"); nook.orb("spin"); nook.face(url, pop);
//   nook.ballRect();  // the ball on screen, for the card to rise out of
//   nook.attach(otherEl); nook.dispose();
//
// Everything game-related stays in sidequest.js; this only draws.
import { retroStage, THREE, flat, bakeAO, blobShadow, pixelTex, pixelModel, lambertize, motes, flicker, breathe } from "./retrolook.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const ART = new URL("./games/sidequest/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the nook's mood: candle amber against deep violet and a cool moonlit teal
export const NOOK_MOOD = {
  scale: 0.42, maxW: 380,
  bg: 0x0d0918,
  fog: { color: 0x2a1a4c, near: 3.8, far: 10 },
  ambient: { sky: 0x5a44a0, ground: 0x1c1020, intensity: 0.72 },
  key: { color: 0xffa860, intensity: 0.95, pos: [-2.2, 3, 3] },     // the candles, broadly
  fill: { color: 0x5a6cff, intensity: 0.85, pos: [2.5, 2.2, -2.5] }, // moonlight through the window, from behind right
  bloom: { threshold: 0.7, strength: 1.05 },
  grade: { tint: [1.07, 0.97, 0.92], sat: 0.9, contrast: 1.08, lift: 0.02 },
  levels: 26, dither: 0.7, vignette: 0.5, grain: 0.035,
};

const POSES = ["wizard_idle", "wizard_conj", "wizard_rev"];
const loadTex = (loader, url) => new Promise((res, rej) => loader.load(url, t => res(t), undefined, rej));
const gltf = url => new GLTFLoader().loadAsync(url);

// the wizard's card: his pose cutouts, lit by the room. A cross-fade between
// two poses, the candle's light from the left, a violet rim on the right
// edge (read off the cutout's alpha), the ball's glow from below, fog.
function wizardMaterial(fogColor, near, far) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: {
      mapA: { value: null }, mapB: { value: null }, mixAB: { value: 1 },
      ambient: { value: new THREE.Color(0x56429a) }, key: { value: new THREE.Color(0xffc088) }, rim: { value: new THREE.Color(0x7a74ff) },
      glow: { value: new THREE.Color(0x9a7cff) }, glowAmt: { value: 0.25 }, flick: { value: 1 },
      fogColor: { value: new THREE.Color(fogColor) }, fogNear: { value: near }, fogFar: { value: far },
      texel: { value: new THREE.Vector2(1 / 300, 1 / 400) },
    },
    vertexShader: `varying vec2 vUv; varying float vDepth;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D mapA, mapB; uniform float mixAB, glowAmt, flick, fogNear, fogFar;
      uniform vec3 ambient, key, rim, glow, fogColor; uniform vec2 texel; varying vec2 vUv; varying float vDepth;
      vec4 tex(vec2 uv){ return mix(texture2D(mapA, uv), texture2D(mapB, uv), mixAB); }
      void main(){
        vec4 c = tex(vUv);
        if (c.a < 0.4) discard;
        // how much of this pixel faces right / up: alpha falls off toward the edges
        float aR = tex(vUv + vec2(texel.x * 3.0, 0.0)).a, aL = tex(vUv - vec2(texel.x * 3.0, 0.0)).a;
        float edgeR = clamp(c.a - aR, 0.0, 1.0), edgeL = clamp(c.a - aL, 0.0, 1.0);
        vec3 col = pow(c.rgb, vec3(2.2));
        float keyAmt = mix(0.95, 0.55, vUv.x) * flick;                  // the candles are to his right (screen left)
        vec3 light = ambient + key * keyAmt + key * edgeL * 0.8;
        light += rim * edgeR * 1.6;                                       // moonlit rim on the far side
        float near = smoothstep(0.62, 0.35, vUv.y) * (1.0 - abs(vUv.x - 0.5) * 1.6);
        light += glow * glowAmt * max(near, 0.0) * 1.4;                   // the ball lights his hands, beard and sleeves from below
        col *= light;
        float f = smoothstep(fogNear, fogFar, vDepth);
        col = mix(col, pow(fogColor, vec3(2.2)), f);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export async function sqNook(host) {
  const st = await retroStage(host, NOOK_MOOD);
  const { scene, camera } = st;
  camera.fov = 40; camera.near = 0.1; camera.far = 20;
  camera.position.set(0, 1.5, 4.85);
  const target = new THREE.Vector3(0, 1.32, 0);
  camera.lookAt(target); camera.updateProjectionMatrix();
  const texL = new THREE.TextureLoader();

  // ---- the room: a curved wall of draped violet fabric, a wooden floor and a rug
  const drapeG = new THREE.CylinderGeometry(2.7, 2.7, 3.6, 46, 6, true, Math.PI * 0.62, Math.PI * 0.76);
  const p = drapeG.attributes.position;
  for (let i = 0; i < p.count; i++) {                // folds: a ripple around, a little sag toward the top
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i), a = Math.atan2(x, z);
    const k = 1 + 0.035 * Math.sin(a * 26) + 0.012 * Math.sin(a * 61) - 0.02 * Math.max(0, y / 1.8);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  drapeG.computeVertexNormals();
  const drape = new THREE.Mesh(drapeG, flat(0x4a2a6e, { side: THREE.BackSide }));
  drape.position.set(0, 1.8, 0.7);
  scene.add(bakeAO(drape, { floor: 0, reach: 1.4, strength: 0.6 }));
  // a pelmet of gold-trimmed fabric along the top
  const pel = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.07, 4, 40, Math.PI * 0.76), flat(0xb8862f));
  pel.rotation.set(Math.PI / 2, 0, Math.PI * 0.62 + Math.PI / 2); pel.position.set(0, 3.25, 0.7);
  scene.add(pel);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 28), flat(0x3b2722));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const rugTex = new THREE.CanvasTexture((() => {
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
    x.fillStyle = "#4a2350"; x.beginPath(); x.arc(64, 64, 63, 0, 7); x.fill();
    x.strokeStyle = "#b8862f"; x.lineWidth = 4; x.beginPath(); x.arc(64, 64, 56, 0, 7); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.arc(64, 64, 40, 0, 7); x.stroke();
    x.fillStyle = "#c99a40"; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.beginPath(); x.arc(64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48, 2.5, 0, 7); x.fill(); }
    return c;
  })());
  pixelTex(rugTex, 128);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), new THREE.MeshLambertMaterial({ map: rugTex, transparent: true }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.006, 0.2);
  scene.add(rug);

  // ---- the round window: stars and slow clouds (the world map's night sky)
  const win = new THREE.Group();
  win.position.set(-0.62, 2.28, -1.75);
  win.rotation.y = 0.28;
  const sky = await loadTex(texL, new URL("./world2/sky_night.jpg", import.meta.url).href).catch(() => null);
  if (sky) { pixelTex(sky, 256); sky.wrapS = THREE.RepeatWrapping; sky.repeat.set(0.22, 0.42); sky.offset.set(0.3, 0.5); }
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.44, 20), new THREE.MeshBasicMaterial({ map: sky, color: sky ? 0xb8c4ff : 0x1a2a6a, fog: false }));
  win.add(pane);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.06, 5, 20), flat(0x5a3a28));
  win.add(frame);
  const mull = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.03), flat(0x5a3a28)); mull.position.z = 0.02; win.add(mull);
  const mull2 = mull.clone(); mull2.rotation.z = Math.PI / 2; win.add(mull2);
  scene.add(win);
  // a soft moonbeam from the window
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.6), new THREE.MeshBasicMaterial({ color: 0x6070c0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  beam.position.set(-0.35, 1.35, -1.1); beam.rotation.set(-0.35, 0.25, 0.45);
  scene.add(beam);
  if (sky && !reduce()) st.onFrame((t, dt) => { sky.offset.x += dt * 0.004; });

  // ---- props, generated and converted to low-poly meshes
  const prop = async (name, { pos, rot = 0, height, ao = true }) => {
    try {
      const g = await gltf(`${ART}nook/${name}.glb`);
      const m = lambertize(pixelModel(g.scene, 256));
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
      const k = height / size.y;
      m.scale.setScalar(k);
      const b2 = new THREE.Box3().setFromObject(m), c = b2.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      m.position.set(-c.x, -b2.min.y, -c.z);
      holder.add(m); holder.position.set(...pos); holder.rotation.y = rot;
      scene.add(holder);
      if (ao) bakeAO(holder, { floor: 0, reach: Math.min(1, height), strength: 0.45 });
      return holder;
    } catch (e) { console.warn("[sqnook] no", name, e?.message ?? e); return null; }
  };
  const [table] = await Promise.all([
    prop("table", { pos: [0, 0, 0.25], height: 0.86 }),
    prop("shelf", { pos: [0.98, 1.05, -1.25], rot: -0.42, height: 0.95, ao: false }),
    prop("books", { pos: [-0.86, 0, -0.55], rot: 0.5, height: 0.55 }),
    prop("lantern", { pos: [-0.72, 2.55, -0.85], height: 0.42, ao: false }).then(l => l && glowUp(l)),
    prop("lantern", { pos: [0.78, 2.72, -1.55], rot: 0.6, height: 0.36, ao: false }).then(l => l && glowUp(l)),
  ]);
  // lanterns: their amber panes glow (and catch the bloom)
  function glowUp(l) { l.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff9a40); o.material.emissiveIntensity = 0.55; } }); return l; }
  const shelfLight = new THREE.PointLight(0xff9a50, 0.6, 3, 2); shelfLight.position.set(0.7, 2.4, -1.2); scene.add(shelfLight);
  flicker(st, shelfLight, { amount: 0.25, speed: 7 });

  // ---- the wizard, on his card behind the table
  const tex = {};
  await Promise.all(POSES.map(async n => { const t = await loadTex(texL, `${ART}${n}.webp`); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; tex[n] = t; }));
  const wizMat = wizardMaterial(NOOK_MOOD.fog.color, NOOK_MOOD.fog.near, NOOK_MOOD.fog.far);
  wizMat.uniforms.mapA.value = wizMat.uniforms.mapB.value = tex.wizard_idle;
  const WH = 1.78, WW = WH * 600 / 800;
  const wizard = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), wizMat);
  const wizHome = new THREE.Vector3(0, 0.47 + WH / 2, -0.32);
  wizard.position.copy(wizHome);
  scene.add(wizard);
  const wizShadow = blobShadow(1.1, 0.45, 0.45); wizShadow.position.set(0, 0.005, -0.3); scene.add(wizShadow);
  let poseName = "wizard_idle", fadeT = 1, bumpT = 9;
  function setPose(name, { bump = true } = {}) {
    if (!tex[name] || name === poseName) return;
    wizMat.uniforms.mapA.value = tex[poseName]; wizMat.uniforms.mapB.value = tex[name];
    poseName = name; fadeT = 0; if (bump) bumpT = 0;
  }

  // ---- the crystal ball: the room's second light
  // it sits in the brass ring on top of the table
  const top = table ? new THREE.Box3().setFromObject(table).max.y : 0.86;
  const R = 0.165, BALL = new THREE.Vector3(0, top - 0.09 + R, 0.25);
  const ballLight = new THREE.PointLight(0x9a7cff, 0.9, 2.4, 2); ballLight.position.copy(BALL); scene.add(ballLight);
  const face = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xd8ccff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  face.scale.setScalar(R * 1.75); face.position.copy(BALL); face.renderOrder = 2; scene.add(face);
  const swirlTex = new THREE.CanvasTexture((() => {
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
    const g = x.createConicGradient ? x.createConicGradient(0, 32, 32) : null;
    if (g) { g.addColorStop(0, "rgba(255,90,200,.0)"); g.addColorStop(0.2, "rgba(255,90,200,.8)"); g.addColorStop(0.45, "rgba(110,200,255,.0)"); g.addColorStop(0.6, "rgba(110,200,255,.8)"); g.addColorStop(0.85, "rgba(255,210,90,.7)"); g.addColorStop(1, "rgba(255,90,200,0)"); x.fillStyle = g; }
    else x.fillStyle = "rgba(200,160,255,.6)";
    x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
    return c;
  })());
  const swirl = new THREE.Sprite(new THREE.SpriteMaterial({ map: swirlTex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  swirl.scale.setScalar(R * 1.9); swirl.position.copy(BALL); swirl.renderOrder = 3; scene.add(swirl);
  const glass = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 2), new THREE.MeshLambertMaterial({ color: 0xbfb4ff, emissive: 0x5a3cc8, emissiveIntensity: 0.35, flatShading: true, transparent: true, opacity: 0.42, depthWrite: false }));
  glass.position.copy(BALL); glass.renderOrder = 4; scene.add(glass);
  const haloTex = new THREE.CanvasTexture((() => {
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(200,170,255,.5)"); g.addColorStop(1, "rgba(120,90,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
  })());
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0x9a80ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.scale.setScalar(R * 4.2); halo.position.copy(BALL); halo.renderOrder = 1; scene.add(halo);
  const ballAnchor = new THREE.Object3D(); ballAnchor.position.copy(BALL); scene.add(ballAnchor);

  // the ball's moods: idle (a slow swirl), spin (fast, faces flicking), swirl
  // (very fast, the quest coming), landed (a held gold glow), burst (a flash)
  const ORB = {
    idle: { glow: 0.5, swirl: 0.2, spin: 0.6, col: 0x9a7cff },
    spin: { glow: 0.9, swirl: 0.65, spin: 4, col: 0xa98cff },
    swirl: { glow: 1.25, swirl: 1, spin: 9, col: 0xc0a0ff },
    landed: { glow: 1.0, swirl: 0.15, spin: 0.8, col: 0xffc878 },
    burst: { glow: 2.2, swirl: 0.6, spin: 3, col: 0xffe0a0 },
    dim: { glow: 0.3, swirl: 0.05, spin: 0.3, col: 0x7060b0 },
  };
  let orbNow = { ...ORB.idle, colC: new THREE.Color(ORB.idle.col) }, orbGoal = ORB.idle, burstT = 9, faceOn = 0, popT = 9;
  function orb(mode) { orbGoal = ORB[mode] ?? ORB.idle; if (mode === "burst") burstT = 0; }
  function setFace(url, pop) {
    if (!url) { faceOn = 0; return; }
    if (face.material.map?.userData.url !== url) {
      texL.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.userData.url = url; const old = face.material.map; face.material.map = t; face.material.needsUpdate = true; if (old && old !== t) old.dispose(); });
    }
    faceOn = 1; if (pop) popT = 0;
  }

  // ---- floating candles, each bobbing on its own, one shared warm light
  const candles = new THREE.Group();
  const flameTex = haloTex;
  const spots = [[-0.62, 1.95, 0.35], [0.58, 2.05, 0.2], [-0.95, 1.55, -0.2], [0.92, 1.6, -0.35], [-0.32, 2.35, -0.5], [0.3, 2.4, -0.9]];
  for (const [i, s] of spots.entries()) {
    const c = new THREE.Group();
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.14 + (i % 3) * 0.03, 6), flat(0xeadcc0));
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0xffb050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    fl.scale.set(0.07, 0.11, 1); fl.position.y = 0.1 + (i % 3) * 0.015;
    c.add(wax, fl); c.position.set(...s); c.userData = { y: s[1], ph: i * 1.7, fl };
    candles.add(c);
  }
  scene.add(candles);
  const candleLight = new THREE.PointLight(0xffa050, 1.6, 4.5, 1.6); candleLight.position.set(-0.55, 1.95, 0.75); scene.add(candleLight);
  flicker(st, candleLight, { amount: 0.22, speed: 8 });
  motes(st, { count: 70, box: [2.4, 2.4, 1.8], center: [0, 1.4, -0.2], color: 0xffd0a0, size: 0.03 });
  const cam = breathe(st, { amp: 0.014, speed: 0.33, target });

  // ---- per frame: the ball's light and swirl, the wizard's cross-fade and bump, the candles
  const tmpC = new THREE.Color();
  st.onFrame((t, dt) => {
    const k = Math.min(1, dt * 4);
    orbNow.glow += (orbGoal.glow - orbNow.glow) * k; orbNow.swirl += (orbGoal.swirl - orbNow.swirl) * k; orbNow.spin += (orbGoal.spin - orbNow.spin) * k;
    orbNow.colC.lerp(tmpC.setHex(orbGoal.col), k);
    burstT += dt;
    const pulse = 1 + 0.12 * Math.sin(t * 2.4) + (burstT < 0.7 ? (1 - burstT / 0.7) * 1.4 : 0);
    const g = orbNow.glow * pulse;
    ballLight.color.copy(orbNow.colC); ballLight.intensity = 0.6 + g * 0.9;
    halo.material.color.copy(orbNow.colC); halo.material.opacity = Math.min(0.9, 0.18 + g * 0.3);
    halo.scale.setScalar(R * (3.6 + g * 0.8));
    glass.material.emissive.copy(orbNow.colC).multiplyScalar(0.45); glass.material.emissiveIntensity = 0.4 + g * 0.35;
    swirl.material.opacity = orbNow.swirl; swirl.material.rotation += dt * orbNow.spin;
    face.material.opacity += ((faceOn ? 0.95 : 0) * (orbGoal === ORB.swirl ? 0.25 : 1) - face.material.opacity) * Math.min(1, dt * 10);
    face.material.color.copy(orbNow.colC).lerp(tmpC.setHex(0xffffff), 0.55);
    popT += dt;
    const pop = popT < 0.6 ? 1 + Math.sin(Math.min(1, popT / 0.6) * Math.PI) * 0.25 - (popT < 0.15 ? 0.4 * (1 - popT / 0.15) : 0) : 1;
    face.scale.setScalar(R * 1.75 * pop);
    wizMat.uniforms.glow.value.copy(orbNow.colC); wizMat.uniforms.glowAmt.value = 0.15 + g * 0.35;
    wizMat.uniforms.flick.value = candleLight.intensity / 1.6;
    // pose: a quick cross-fade, and a squash-then-stretch bump
    fadeT += dt; wizMat.uniforms.mixAB.value = Math.min(1, fadeT / 0.14);
    bumpT += dt;
    const b = bumpT < 0.48 ? bumpT / 0.48 : 1;
    const sy = b < 1 ? (b < 0.22 ? 1 - 0.045 * (b / 0.22) : b < 0.58 ? 0.955 + 0.075 * ((b - 0.22) / 0.36) : 1.03 - 0.03 * ((b - 0.58) / 0.42)) : 1 + (reduce() ? 0 : 0.006 * Math.sin(t * 1.85));
    const sx = 1 + (1 - sy) * 0.7;
    wizard.scale.set(sx, sy, 1);
    wizard.position.y = wizHome.y - (1 - sy) * WH / 2;
    if (!reduce()) for (const c of candles.children) {
      c.position.y = c.userData.y + Math.sin(t * 0.8 + c.userData.ph) * 0.035;
      const f = 0.85 + 0.15 * Math.sin(t * 11 + c.userData.ph * 5) + 0.1 * Math.sin(t * 23 + c.userData.ph);
      c.userData.fl.scale.set(0.07 * f, 0.11 * (0.9 + 0.2 * f), 1);
    }
  });

  return {
    stage: st,
    setPose, orb, face: setFace,
    ballRect: () => st.rectOf(ballAnchor, R),
    attach: el => st.attach(el),
    dispose: () => st.dispose(),
    camera: cam,
  };
}
