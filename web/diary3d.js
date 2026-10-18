// Secret Diary's diaries: three low-poly models (closed diary, padlock, open
// diary) made in Higgsfield -> Tripo, loaded once and reused for every diary
// on screen, each tinted in code (one model, many colors).
//
// Three ways to draw them, picked per device:
//   "3d"     — one live WebGL canvas behind the shelf; padlocks shake, click
//              and drop, diaries swap to the open model
//   "sprite" — the same models rendered ONCE to images, animated with CSS.
//              For phones where the live scene runs slow
//   "css"    — no WebGL or no models: CSS-drawn diaries, same animation
// The DOM layout (cells, text, taps) is the same in every mode; only what's
// behind it changes. Answer text is always HTML over the page, never baked in.
//
// Loaded lazily by the game (dynamic import), so a failure here can never
// stop Secret Diary from running.
import { DIARY } from "./hpconfig.js";

const THREE_URL = "https://esm.sh/three@0.160.0";
const MODELS = { closed: "models/diary/diary_closed.glb", open: "models/diary/diary_open.glb", lock: "models/diary/padlock.glb" };
const params = new URLSearchParams(location.search);
const FORCE = params.get("diary");            // ?diary=3d|sprite|css to pin a mode (testing)
export const UNLOCK = { STAGGER: 300, SHAKE: 420, CLICK: 520, DROP: 1100, OPEN: 1150, POP: 1400 };

let kitP = null;
// resolves to the kit, or null when 3D isn't possible here (no WebGL, the
// models or three.js didn't load). Never rejects.
export function diaryKit() {
  if (FORCE === "css") return Promise.resolve(null);
  return kitP ??= makeKit().catch(e => { console.warn("[diary3d] falling back to CSS diaries:", e?.message ?? e); return null; });
}

async function makeKit() {
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no WebGL");
  const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import(THREE_URL),
    import(`${THREE_URL}/examples/jsm/loaders/GLTFLoader.js`),
    import(`${THREE_URL}/examples/jsm/libs/meshopt_decoder.module.js`),
  ]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const base = new URL("./", import.meta.url);
  const load = async k => {
    const g = await loader.loadAsync(new URL(MODELS[k], base).href);
    // normalise: centred, longest side 1
    const o = g.scene;
    const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    o.position.sub(c);
    const wrap = new THREE.Group(); wrap.add(o); wrap.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
    let tris = 0, map = null;
    o.traverse(m => { if (m.isMesh) { tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; map ??= m.material.map; } });
    return { wrap, tris, map };
  };
  const [closed, open, lock] = await Promise.all([load("closed"), load("open"), load("lock")]);
  return new Kit(THREE, { closed, open, lock });
}

// the leather picks up the tint, the paper and brass mostly don't: tint by
// how dark the texel is (the generated texture has the shading baked in)
function tintMaterial(THREE, map, hex) {
  const m = new THREE.MeshLambertMaterial({ map, flatShading: true });
  if (hex == null) return m;
  m.userData.tint = new THREE.Color(hex);
  m.onBeforeCompile = sh => {
    sh.uniforms.uTint = { value: m.userData.tint };
    sh.fragmentShader = "uniform vec3 uTint;\n" + sh.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec4 texel = texture2D( map, vMapUv );
        float lum = dot( texel.rgb, vec3( 0.299, 0.587, 0.114 ) );
        float paper = smoothstep( 0.24, 0.42, lum );
        vec3 dyed = uTint * ( 0.45 + 2.2 * lum );
        diffuseColor.rgb *= mix( dyed, texel.rgb, paper );
      #endif`);
  };
  m.customProgramCacheKey = () => "diary-tint";
  return m;
}

class Kit {
  constructor(THREE, models) {
    this.THREE = THREE;
    this.models = models;
    this.tris = { closed: models.closed.tris, open: models.open.tris, lock: models.lock.tris };
    this._snaps = new Map();
    this.renderer = null;
  }
  _renderer() {
    if (this.renderer) return this.renderer;
    const r = new this.THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
    r.outputColorSpace = this.THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    return r;
  }
  _scene() {
    const T = this.THREE, s = new T.Scene();
    s.add(new T.AmbientLight(0xffffff, 1.6));
    const d = new T.DirectionalLight(0xffffff, 1.5); d.position.set(-0.4, 0.8, 1); s.add(d);
    return s;
  }
  // one diary as a ready-to-place object: closed + lock + open, swappable
  diary(hex) {
    const T = this.THREE, { closed, open, lock } = this.models;
    const g = new T.Group();
    const c = closed.wrap.clone(true), o = open.wrap.clone(true), l = lock.wrap.clone(true);
    const cm = tintMaterial(T, closed.map, hex), om = tintMaterial(T, open.map, hex);
    const lm = new T.MeshLambertMaterial({ map: lock.map, flatShading: true, transparent: true });
    c.traverse(m => { if (m.isMesh) m.material = cm; });
    o.traverse(m => { if (m.isMesh) m.material = om; });
    l.traverse(m => { if (m.isMesh) m.material = lm; });
    // the closed model lies cover-up with the clasp on its far edge: stand it
    // up, clasp on the right, turned a little to show the spine
    const cs = new T.Group(); c.rotation.x = Math.PI / 2; cs.add(c); cs.rotation.z = -Math.PI / 2;
    const closedPose = new T.Group(); closedPose.add(cs); closedPose.rotation.set(0.12, -0.42, 0);
    // the padlock hangs off the clasp (right edge, middle, cover side)
    const lockPose = new T.Group(); lockPose.add(l); l.scale.setScalar(0.42);
    lockPose.position.set(0.44, -0.05, 0.3);
    closedPose.add(lockPose);
    // the open diary lies pages-up: lay it across, tilted toward the camera
    const os = new T.Group(); o.rotation.x = Math.PI / 2; os.add(o); os.rotation.z = Math.PI / 2;
    const openPose = new T.Group(); openPose.add(os); openPose.rotation.set(-0.55, 0, 0); openPose.visible = false;
    g.add(closedPose, openPose);
    return { g, closedPose, openPose, lockPose, lockMat: lm, mats: [cm, om, lm] };
  }
  // a still image of one diary (closed with lock / open / lock alone), cached
  // per kind+color+size — the "sprite" mode and the writing-screen diary
  snapshot(kind, hex, w, h) {
    const key = `${kind}:${hex}:${w}x${h}`;
    if (this._snaps.has(key)) return this._snaps.get(key);
    const T = this.THREE, r = this._renderer();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    r.setPixelRatio(dpr); r.setSize(w, h, false);
    const scene = this._scene();
    const d = this.diary(hex);
    if (kind === "open") { d.closedPose.visible = false; d.openPose.visible = true; }
    if (kind === "closed") d.lockPose.visible = false;
    if (kind === "lock") { d.closedPose.children[0].visible = false; d.lockPose.position.set(0, 0, 0); d.lockPose.scale.setScalar(2); }
    scene.add(d.g);
    const cam = new T.OrthographicCamera(-w / h / 2 * 1.15, w / h / 2 * 1.15, 0.575, -0.575, -10, 10);
    r.render(scene, cam);
    const url = r.domElement.toDataURL("image/png");
    d.mats.forEach(m => m.dispose());
    this._snaps.set(key, url);
    return url;
  }
  // where the padlock sits on a w x h "closed" still, in % of that image —
  // so the sprite mode can lay the lock("lock", 60x60) image over it
  lockSpot(w, h) {
    const key = `spot:${w}x${h}`;
    if (this._snaps.has(key)) return this._snaps.get(key);
    const d = this.diary(null);
    d.g.updateMatrixWorld(true);
    const p = d.lockPose.getWorldPosition(new this.THREE.Vector3());
    d.mats.forEach(m => m.dispose());
    // the lock still is a square 0.575 world units wide (scale 2 in a ±0.575 frame)
    const a = w / h / 2 * 1.15, side = 0.575;
    const wp = side / (2 * a) * 100, hp = side / 1.15 * 100;
    const spot = { x: (p.x + a) / (2 * a) * 100 - wp / 2, y: (0.575 - p.y) / 1.15 * 100 - hp / 2, w: wp };
    this._snaps.set(key, spot);
    return spot;
  }
  // how long one frame of a full 6-diary shelf takes here, in ms
  benchmark(w = 360, h = 260) {
    const T = this.THREE, r = this._renderer();
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(w, h, false);
    const scene = this._scene();
    const ds = DIARY.COLORS.slice(0, 6).map((hex, i) => { const d = this.diary(hex); d.g.position.set((i % 3) * 120 + 60, -(Math.floor(i / 3) * 130 + 65), 0); d.g.scale.setScalar(110); scene.add(d.g); return d; });
    const cam = new T.OrthographicCamera(0, w, 0, -h, -1000, 1000);
    const gl = r.getContext(), px = new Uint8Array(4);
    // reading a pixel back waits for the GPU, so this times real frames, not just the submit
    const frame = i => { ds.forEach(d => { d.lockPose.rotation.z = Math.sin(i); }); r.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    frame(0);                                   // compile shaders outside the timing
    const t0 = performance.now();
    for (let i = 1; i <= 6; i++) frame(i);
    const ms = (performance.now() - t0) / 6;
    ds.forEach(d => d.mats.forEach(m => m.dispose()));
    return ms;
  }
  // the live shelf: a canvas behind `host`, a diary centred on each cell
  shelf(host, cells) { return new Shelf(this, host, cells); }
}

class Shelf {
  constructor(kit, host, cells) {
    const T = kit.THREE;
    this.kit = kit; this.host = host; this.cells = cells;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "sd-shelf-gl";
    host.prepend(this.canvas);
    this.r = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.r.outputColorSpace = T.SRGBColorSpace;
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.r.setClearColor(0x000000, 0);
    this.scene = kit._scene();
    this.cam = new T.OrthographicCamera(0, 1, 0, -1, -1000, 1000);
    this.ds = cells.map(c => { const d = kit.diary(c.hex); this.scene.add(d.g); return d; });
    this.anim = null; this.frames = []; this.dead = false;
    this.layout();
    this._onResize = () => { this.layout(); this.render(); };
    window.addEventListener("resize", this._onResize);
    this.render();
  }
  layout() {
    const hr = this.host.getBoundingClientRect();
    const w = Math.max(1, hr.width), h = Math.max(1, hr.height);
    this.r.setSize(w, h, false);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    Object.assign(this.cam, { left: 0, right: w, top: 0, bottom: -h }); this.cam.updateProjectionMatrix();
    this.cells.forEach((c, i) => {
      const r = c.el.getBoundingClientRect();
      const d = this.ds[i];
      // same box as the sprite/CSS modes (.sd-dvis): a square 80% of the
      // cell's height, 4% from its top, framing ±0.575 units like a still
      const box = Math.min(r.width, r.height * 0.8);
      d.g.position.set(r.left - hr.left + r.width / 2, -(r.top - hr.top + r.height * 0.04 + box / 2), 0);
      d.g.scale.setScalar(box / 1.15);
    });
  }
  render() { if (!this.dead) this.r.render(this.scene, this.cam); }
  // jump straight to the end state (already unlocked on this phone)
  setOpen() { this.ds.forEach(d => { d.lockPose.visible = false; d.closedPose.visible = false; d.openPose.visible = true; d.openPose.scale.setScalar(1); }); this.render(); }
  // the unlock: each lock shakes, clicks, drops; then the diary opens.
  // onEach(i, stage) fires at "click" and "open" so the page can play a
  // sound and show that diary's text.
  unlock(onEach = () => {}) {
    const n = this.ds.length, t0 = performance.now(), fired = new Set();
    const ease = x => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);   // easeOutBack
    return new Promise(done => {
      let last = t0;
      const step = now => {
        if (this.dead) return done();
        this.frames.push(now - last); last = now;
        let busy = false;
        this.ds.forEach((d, i) => {
          const t = now - t0 - i * UNLOCK.STAGGER;
          if (t < 0) { busy = true; return; }
          const L = d.lockPose;
          if (t < UNLOCK.SHAKE) { L.rotation.z = Math.sin(t / 22) * 0.28 * (1 - t / UNLOCK.SHAKE); busy = true; }
          else if (t < UNLOCK.CLICK) { if (!fired.has(`c${i}`)) { fired.add(`c${i}`); onEach(i, "click"); } L.rotation.z = 0; L.scale.setScalar(1 + 0.15 * Math.sin((t - UNLOCK.SHAKE) / (UNLOCK.CLICK - UNLOCK.SHAKE) * Math.PI)); busy = true; }
          else if (t < UNLOCK.DROP) { const k = (t - UNLOCK.CLICK) / (UNLOCK.DROP - UNLOCK.CLICK); L.position.y = -0.05 - 1.4 * k * k; L.rotation.z = -1.2 * k; d.lockMat.opacity = 1 - k; busy = true; }
          else if (t < UNLOCK.OPEN) { L.visible = false; busy = true; }
          else if (t < UNLOCK.POP) {
            if (!fired.has(`o${i}`)) { fired.add(`o${i}`); onEach(i, "open"); }
            d.closedPose.visible = false; d.openPose.visible = true;
            d.openPose.scale.setScalar(0.7 + 0.3 * ease((t - UNLOCK.OPEN) / (UNLOCK.POP - UNLOCK.OPEN))); busy = true;
          } else { d.openPose.visible = true; d.closedPose.visible = false; d.openPose.scale.setScalar(1); }
        });
        this.render();
        if (busy) this.anim = requestAnimationFrame(step); else { this.anim = null; done(); }
      };
      this.anim = requestAnimationFrame(step);
    });
  }
  fps() { const f = this.frames.slice(2); return f.length ? 1000 / (f.reduce((a, b) => a + b, 0) / f.length) : null; }
  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.anim);
    window.removeEventListener("resize", this._onResize);
    this.ds.forEach(d => d.mats.forEach(m => m.dispose()));
    this.r.dispose(); this.r.forceContextLoss?.();
    this.canvas.remove();
  }
}

// ---------------------------------------------------------------- mode
// Which way to draw on this phone. Decided once per session: the live scene
// if a full shelf renders in under ~22 ms a frame, sprites if it's slower.
let modeP = null;
// the live shelf measured its own unlock: if it ran under ~28 fps on this
// phone, draw the rest of this session's shelves with sprites instead
export function reportFps(fps) {
  if (fps == null || fps >= 28 || FORCE === "3d") return;
  modeP?.then(m => { if (m.mode === "3d") { m.mode = "sprite"; m.fps = fps; console.info(`[diary3d] live shelf ran at ${fps.toFixed(0)} fps — sprites from now on`); } });
}
export function diaryMode() {
  return modeP ??= diaryKit().then(kit => {
    if (!kit) return { mode: "css", kit: null, ms: null };
    if (FORCE === "sprite") return { mode: "sprite", kit, ms: null };
    if (FORCE === "3d") return { mode: "3d", kit, ms: null };
    let ms = Infinity;
    try { ms = kit.benchmark(); } catch (e) { console.warn("[diary3d] benchmark", e); }
    return { mode: ms <= 22 ? "3d" : "sprite", kit, ms };
  });
}
