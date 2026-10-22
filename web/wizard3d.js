// Side Quest's wizard in 3D: a sleepy old fortune teller in the same render
// style as the Art Gallery's dealer, but his own character (Higgsfield views
// -> Tripo -> Meshy rig, see docs/wizard_assets.md). One WebGL canvas, moved
// into whichever `.sq-wizard` the game just drew; the pixel wizard stays
// underneath as the fallback and is hidden only once the 3D one has actually
// drawn a frame.
//
// The crystal ball stays the HTML one, floated just above his cupped palms
// (it holds the face reel, and text never goes into the canvas). All motion
// is in code, on the rig's rest pose: a slow sway, the beard bobbing with the
// head, his hands rising and falling over the ball while it glows / swirls /
// spins, and a small nod when the quest is revealed. (The rigger's stock idle
// clip crumples his robe, so it isn't played.)
//
// Loaded lazily by the game (dynamic import): a failure here can never stop
// Side Quest from running. ?wizard=pixel pins the pixel one, ?wizard=dealer
// borrows the dealer's rig (same skeleton) to test this without the model,
// ?wizard=3d tries the real model even while SIDEQUEST.WIZARD_3D is off.
import { SIDEQUEST } from "./hpconfig.js";

const THREE_URL = "https://esm.sh/three@0.160.0";
const params = new URLSearchParams(location.search);
const FORCE = params.get("wizard");
const MODEL = FORCE === "dealer" ? "games/artgallery/dealer.glb" : "models/wizard/wizard.glb";
const WAVING = new Set(["glow", "swirl", "spin"]);

let kitP = null;
// resolves to the kit, or null when 3D isn't possible here. Never rejects.
export function wizardKit() {
  if (FORCE === "pixel" || (!SIDEQUEST.WIZARD_3D && !FORCE)) return Promise.resolve(null);
  return kitP ??= makeKit().catch(e => { console.warn("[wizard3d] keeping the pixel wizard:", e?.message ?? e); return null; });
}

async function makeKit() {
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no WebGL");
  const [THREE, { GLTFLoader }] = await Promise.all([import(THREE_URL), import(`${THREE_URL}/examples/jsm/loaders/GLTFLoader.js`)]);
  const gltf = await new GLTFLoader().loadAsync(new URL(MODEL, new URL("./", import.meta.url)).href);
  return new Wizard(THREE, gltf);
}

class Wizard {
  constructor(THREE, gltf) {
    this.THREE = THREE;
    const o = gltf.scene;
    // normalise: 1 unit tall, feet on the floor, centred
    // (measured posed: a skinned mesh's raw bounds ignore its skeleton)
    o.updateMatrixWorld(true);
    o.traverse(m => m.isSkinnedMesh && m.skeleton.update());
    const box = new THREE.Box3().setFromObject(o, true), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    o.position.set(-c.x, -box.min.y, -c.z);
    this.body = new THREE.Group(); this.body.add(o); this.body.scale.setScalar(1 / size.y);
    this.root = new THREE.Group(); this.root.add(this.body);
    // soft cel shading: his own textures through a 4-step toon ramp, lit
    // like the players' characters (hemisphere + key + a coloured rim)
    const ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 165, 165, 165, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
    o.traverse(m => {
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const src = m.material;
      if (!src || Array.isArray(src)) return;
      m.material = new THREE.MeshToonMaterial({ map: src.map ?? null, color: src.color ?? 0xffffff, gradientMap: ramp,
        transparent: !!src.transparent, alphaTest: src.alphaTest ?? 0, side: src.side });
      src.dispose?.();
    });

    const bone = re => { let b = null; o.traverse(n => { if (!b && n.isBone && re.test(n.name)) b = n; }); return b; };
    this.bones = { head: bone(/^head$/i), neck: bone(/^neck$/i),
      lArm: bone(/^leftarm$/i), rArm: bone(/^rightarm$/i), lFore: bone(/^leftforearm$/i), rFore: bone(/^rightforearm$/i) };
    this.hands = [bone(/^lefthand$/i), bone(/^righthand$/i)];
    for (const b of Object.values(this.bones)) if (b) b.userData.rest = b.quaternion.clone();

    this.scene = new THREE.Scene();
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xdfe4ff, 0x3a2a5a, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1.4, 2, 2.4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9a7bff, 0.9); rim.position.set(-1.6, 1.4, -1.8); this.scene.add(rim);
    this.ballLight = new THREE.PointLight(0xb08cff, 0, 1.4); this.ballLight.position.set(0, 0.3, 0.45); this.scene.add(this.ballLight);
    // a slight three-quarter view from a little above, so he reads as 3D
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
    this.camera.position.set(0.62, 0.8, 2.48); this.camera.lookAt(0, 0.49, 0);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "sq-w3d";
    this.canvas.setAttribute("aria-hidden", "true");

    this.mode = "idle"; this.wave = 0; this.nodAt = -1e9; this.raf = 0; this.last = 0;
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.ballAt = null;
    this.tick = this.tick.bind(this);
  }

  // draw into `el` (a .sq-wizard) in this mode: idle | glow | swirl | spin | landed
  attach(el, mode = "idle") {
    if (!el?.isConnected) return;
    this.setMode(mode);
    if (this.canvas.parentNode !== el) {
      el.prepend(this.canvas);
      this.fit(el);
      el.classList.remove("w3d-on");
      this.shown = el;
    }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  }
  setMode(mode) { this.mode = mode; }
  nod() { this.nodAt = performance.now(); }
  fit(el) {
    const w = this.canvas.clientWidth || el.clientWidth || 240, h = this.canvas.clientHeight || el.clientHeight || 282;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  detach() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.shown?.classList.remove("w3d-on"); this.shown = null;
    this.canvas.remove();
  }

  // the HTML ball floats just above his palms: the hands' midpoint on screen,
  // eased, and held still while the hands wave over it
  placeBall(dt) {
    const [l, r] = this.hands, el = this.shown;
    if (!l || !r || !el) return;
    const v = l.getWorldPosition(this.v).add(r.getWorldPosition(new this.THREE.Vector3())).multiplyScalar(0.5);
    this.ballLight.position.set(v.x, v.y + 0.08, v.z + 0.12);
    v.project(this.camera);
    const c = this.canvas, x = c.offsetLeft + (v.x + 1) / 2 * c.clientWidth, y = c.offsetTop + (1 - v.y) / 2 * c.clientHeight;
    if (!this.ballAt) this.ballAt = { x, y };
    else if (this.wave < 0.05) { const k = Math.min(1, dt * 3); this.ballAt.x += (x - this.ballAt.x) * k; this.ballAt.y += (y - this.ballAt.y) * k; }
    el.style.setProperty("--bx", `${this.ballAt.x.toFixed(1)}px`);
    el.style.setProperty("--by", `${this.ballAt.y.toFixed(1)}px`);
  }

  // a small extra rotation on a bone, on top of its rest pose
  turn(b, x, y, z) {
    if (!b) return;
    b.quaternion.multiply(this.q.setFromEuler(this.e.set(x, y, z)));
  }

  tick(now) {
    this.raf = 0;
    if (!this.canvas.isConnected) { this.detach(); return; }
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const t = now / 1000, B = this.bones;
    for (const b of Object.values(B)) if (b) b.quaternion.copy(b.userData.rest);

    // idle sway, a little hunched; the beard rides the head's slow, sleepy bob
    this.root.rotation.z = Math.sin(t * 0.9) * 0.025;
    this.root.rotation.y = Math.sin(t * 0.45) * 0.08;
    this.turn(B.head ?? B.neck, 0.03 + Math.sin(t * 1.6) * 0.05, 0, Math.sin(t * 0.9) * 0.03);
    // hands over the ball: the forearms rise and fall in turn, the arms ease
    // in a little (Meshy rig: a forearm's x lifts the hand, an arm's z swings
    // it in, mirrored left / right)
    this.wave += ((WAVING.has(this.mode) ? 1 : 0) - this.wave) * Math.min(1, dt * 4);
    if (this.wave > 0.01) {
      const a = this.wave, s1 = Math.sin(t * 4.2), s2 = Math.sin(t * 4.2 + Math.PI);
      this.turn(B.lFore, a * 0.32 * s1, 0, 0);
      this.turn(B.rFore, a * 0.32 * s2, 0, 0);
      this.turn(B.lArm, 0, 0, a * 0.08 * s2);
      this.turn(B.rArm, 0, 0, -a * 0.08 * s1);
    }
    // the nod: down and back up over ~0.7 s
    const p = (now - this.nodAt) / 700;
    if (p >= 0 && p < 1) this.turn(B.head ?? B.neck, Math.sin(p * Math.PI) * 0.26, 0, 0);
    // the ball lights his face from below while it's busy
    const glow = this.mode === "swirl" ? 1.1 : this.mode === "landed" ? 0.9 : WAVING.has(this.mode) ? 0.7 : 0.25;
    this.ballLight.intensity += (glow * (0.85 + 0.15 * Math.sin(t * 6)) - this.ballLight.intensity) * Math.min(1, dt * 5);

    this.renderer.render(this.scene, this.camera);
    this.placeBall(dt);
    this.shown?.classList.add("w3d-on");    // only now hide the pixel wizard
    this.raf = requestAnimationFrame(this.tick);
  }
}
