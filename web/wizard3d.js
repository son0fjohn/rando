// Side Quest's wizard in 3D: an old fortune teller from the same cast as the
// Art Gallery's dealer (Higgsfield views -> Tripo -> Meshy rig, see
// docs/wizard_assets.md). One WebGL canvas, moved into whichever
// `.sq-wizard` the game just drew; the pixel wizard stays underneath as the
// fallback and is hidden only once the 3D one has actually drawn a frame.
//
// The crystal ball stays the HTML one in front of his hands (it holds the
// face reel, and text never goes into the canvas). The model brings its idle
// clip; on top of it, in code: a slow sway, the beard bobbing with the head,
// hands waving over the ball while it glows / swirls / spins, and a small
// nod when the quest is revealed.
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
const CAST = "models/wizard/wizard_cast.glb";   // optional: a hands-over-the-ball clip on the same rig
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
  const loader = new GLTFLoader();
  const base = new URL("./", import.meta.url);
  const gltf = await loader.loadAsync(new URL(MODEL, base).href);
  const cast = FORCE === "dealer" ? null : await loader.loadAsync(new URL(CAST, base).href).catch(() => null);
  return new Wizard(THREE, gltf, cast?.animations?.[0] ?? null);
}

class Wizard {
  constructor(THREE, gltf, castClip) {
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
    o.traverse(m => { if (m.isMesh) { m.frustumCulled = false; if (m.material) m.material.envMapIntensity = 0; } });

    const bone = re => { let b = null; o.traverse(n => { if (!b && n.isBone && re.test(n.name)) b = n; }); return b; };
    this.bones = { head: bone(/^head$/i), neck: bone(/^neck$/i), spine: bone(/^spine0?2$/i) ?? bone(/^spine$/i),
      lArm: bone(/^leftarm$/i), rArm: bone(/^rightarm$/i), lFore: bone(/^leftforearm$/i), rFore: bone(/^rightforearm$/i) };
    for (const b of Object.values(this.bones)) if (b) b.userData.rest = b.quaternion.clone();

    this.mixer = gltf.animations.length || castClip ? new THREE.AnimationMixer(o) : null;
    this.idle = gltf.animations[0] ? this.mixer.clipAction(gltf.animations[0]) : null;
    this.cast = castClip ? this.mixer.clipAction(castClip) : null;
    this.idle?.play();

    this.scene = new THREE.Scene();
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xdfe4ff, 0x3a2a5a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(1.2, 2, 2.5); this.scene.add(key);
    this.ballLight = new THREE.PointLight(0xb08cff, 0, 1.4); this.ballLight.position.set(0, 0.3, 0.45); this.scene.add(this.ballLight);
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
    this.camera.position.set(0, 0.62, 2.55); this.camera.lookAt(0, 0.5, 0);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "sq-w3d";
    this.canvas.setAttribute("aria-hidden", "true");

    this.mode = "idle"; this.wave = 0; this.nodAt = -1e9; this.raf = 0; this.last = 0;
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler();
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
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.cast) {
      const on = WAVING.has(mode);
      (on ? this.cast : this.idle)?.reset().fadeIn(0.35).play();
      (on ? this.idle : this.cast)?.fadeOut(0.35);
    }
  }
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

  // a small extra rotation on a bone, on top of whatever the clip set
  turn(b, x, y, z) {
    if (!b) return;
    b.quaternion.multiply(this.q.setFromEuler(this.e.set(x, y, z)));
  }

  tick(now) {
    this.raf = 0;
    if (!this.canvas.isConnected) { this.detach(); return; }
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const t = now / 1000, B = this.bones;
    // back to rest first: the clip overwrites the bones it animates, the
    // others would otherwise pile up the turns below frame after frame
    for (const b of Object.values(B)) if (b) b.quaternion.copy(b.userData.rest);
    this.mixer?.update(dt);

    // idle sway, a little hunched; the beard rides the head's slow bob
    this.root.rotation.z = Math.sin(t * 0.9) * 0.025;
    this.root.rotation.y = Math.sin(t * 0.45) * 0.08;
    this.turn(B.head ?? B.neck, Math.sin(t * 1.8) * 0.045, 0, Math.sin(t * 0.9) * 0.03);
    // hands over the ball (procedural when there's no cast clip)
    this.wave += ((WAVING.has(this.mode) && !this.cast ? 1 : 0) - this.wave) * Math.min(1, dt * 4);
    if (this.wave > 0.01) {
      // (Meshy rig: an arm's z swings it in toward the ball, mirrored left /
      // right; a forearm's x bends it in)
      const a = this.wave, s1 = Math.sin(t * 4.2), s2 = Math.sin(t * 4.2 + 1.7);
      this.turn(B.lArm, 0, 0, a * (0.22 + 0.14 * s1));
      this.turn(B.rArm, 0, 0, -a * (0.22 + 0.14 * s2));
      this.turn(B.lFore, a * (0.2 + 0.25 * s2), 0, 0);
      this.turn(B.rFore, a * (0.2 + 0.25 * s1), 0, 0);
    }
    // the nod: down and back up over ~0.7 s
    const p = (now - this.nodAt) / 700;
    if (p >= 0 && p < 1) this.turn(B.head ?? B.neck, Math.sin(p * Math.PI) * 0.22, 0, 0);
    // the ball lights his face from below while it's busy
    const glow = this.mode === "swirl" ? 2.2 : this.mode === "landed" ? 1.8 : WAVING.has(this.mode) ? 1.3 : 0.5;
    this.ballLight.intensity += (glow * (0.85 + 0.15 * Math.sin(t * 6)) - this.ballLight.intensity) * Math.min(1, dt * 5);

    this.renderer.render(this.scene, this.camera);
    this.shown?.classList.add("w3d-on");    // only now hide the pixel wizard
    this.raf = requestAnimationFrame(this.tick);
  }
}
