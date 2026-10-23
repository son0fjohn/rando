// Humiliation Ritual's host: a goofy 3D clown, in the same render style as
// the Art Gallery's dealer and Side Quest's wizard but his own character
// (Higgsfield views -> Tripo -> rig, see docs/clown_assets.md). One WebGL
// canvas, moved into whichever `.hr-show` the game just drew; the 2D
// capsules there stay underneath until the 3D clown has drawn a frame.
//
// The balls he juggles are gacha capsules (a clear-ish top, a coloured
// bottom) with a player's face and name on them. All motion is in code, on
// the rig's rest pose, played from the synced game clock so every phone sees
// the same beat:
//   juggle  a cascade of up to 5 capsules, faces cycling through everyone
//   toss    one capsule goes up high, he catches it in his mouth (gulp,
//           cheeks puff), spits it into his hands and holds it up, big
//   open    (the performer's phone) he twists it open: the top pops off
//   peek    (everyone else) he peeks inside, gasps, winks and goes "shhh"
//   bow     a little bow
// Text (the dialog, the slip with the prompt) stays HTML; the names on the
// capsules are drawn into their textures.
//
// Loaded lazily by the game (dynamic import): a failure here can never stop
// the Ritual from running. ?clown=2d pins the 2D capsules.

const THREE_URL = "https://esm.sh/three@0.160.0";
const params = new URLSearchParams(location.search);
const FORCE = params.get("clown");
const MODEL = "models/clown/clown.glb";
const BALLS_MAX = 5;

let kitP = null;
// resolves to the kit, or null when 3D isn't possible here. Never rejects.
export function clownKit() {
  if (FORCE === "2d") return Promise.resolve(null);
  return kitP ??= makeKit().catch(e => { console.warn("[clown3d] keeping the 2D capsules:", e?.message ?? e); return null; });
}

async function makeKit() {
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no WebGL");
  const [THREE, { GLTFLoader }] = await Promise.all([import(THREE_URL), import(`${THREE_URL}/examples/jsm/loaders/GLTFLoader.js`)]);
  const gltf = await new GLTFLoader().loadAsync(new URL(MODEL, new URL("./", import.meta.url)).href);
  return new Clown(THREE, gltf);
}

// ---------------------------------------------------------------- helpers
const clamp01 = x => Math.max(0, Math.min(1, x));
const ease = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const span = (t, a, b) => ease((t - a) / (b - a));          // 0 before a, 1 after b
const hueOf = id => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };

class Clown {
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
    // soft cel shading: his own colours through a 4-step toon ramp, lit like
    // the players' characters and the wizard
    const ramp = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 175, 175, 175, 255, 222, 222, 222, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
    this.ramp = ramp;
    o.traverse(m => {
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const src = m.material;
      if (!src || Array.isArray(src)) return;
      m.material = new THREE.MeshToonMaterial({ map: src.map ?? null, color: src.color ?? 0xffffff, gradientMap: ramp, side: src.side });
      this.skin = m;
      src.dispose?.();
    });

    const bone = re => { let b = null; o.traverse(n => { if (!b && n.isBone && re.test(n.name)) b = n; }); return b; };
    this.bones = {
      hips: bone(/^hips$/i), spine: bone(/^spine$/i), spine1: bone(/^spine01$/i), neck: bone(/^neck$/i), head: bone(/^head$/i),
      lArm: bone(/^leftarm$/i), rArm: bone(/^rightarm$/i), lFore: bone(/^leftforearm$/i), rFore: bone(/^rightforearm$/i),
      lHand: bone(/^lefthand$/i), rHand: bone(/^righthand$/i),
    };
    for (const b of Object.values(this.bones)) if (b) { b.userData.rest = b.quaternion.clone(); b.userData.restS = b.scale.clone(); }
    // the mouth, measured on the rest pose (model space, 1 unit tall), kept
    // in the head bone's space so it follows the head
    this.root.updateMatrixWorld(true);
    this.mouthLocal = this.bones.head ? this.bones.head.worldToLocal(new THREE.Vector3(...MOUTH)) : null;

    this.scene = new THREE.Scene();
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2440, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(1.2, 2.2, 2.6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff7ab0, 0.9); rim.position.set(-1.8, 1.4, -1.6); this.scene.add(rim);
    // a slight three-quarter view from a little above, so he reads as 3D
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.camBase = new THREE.Vector3(0.42, 0.78, 2.55);
    this.camera.position.copy(this.camBase); this.camera.lookAt(0, 0.56, 0);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "hr-c3d";
    this.canvas.setAttribute("aria-hidden", "true");

    this.balls = []; this.people = []; this.chosen = null;
    this.beatName = "idle"; this.beatT0 = performance.now(); this.raf = 0; this.last = 0;
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler();
    this.v = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3();
    this.hl = new THREE.Vector3(); this.hr = new THREE.Vector3();
    this.tick = this.tick.bind(this);
    this.buildWink();
  }

  // ---------------------------------------------------------------- the capsules
  // a capsule: top dome (pale, a little see-through, tinted), bottom bowl
  // (the player's colour), a thin band, and a sticker with face + name that
  // always faces the camera
  makeBall() {
    const T = this.THREE, r = 0.07;
    const g = new T.Group();
    const top = new T.Mesh(new T.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new T.MeshToonMaterial({ color: 0xffffff, gradientMap: this.ramp, transparent: true, opacity: 0.55, depthWrite: false }));
    const bot = new T.Mesh(new T.SphereGeometry(r, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new T.MeshToonMaterial({ color: 0xff5d8a, gradientMap: this.ramp }));
    const band = new T.Mesh(new T.TorusGeometry(r * 1.005, r * 0.08, 6, 24), new T.MeshToonMaterial({ color: 0xffffff, gradientMap: this.ramp }));
    band.rotation.x = Math.PI / 2;
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256;
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
    // the sticker sits just in front of the capsule, toward the camera (see
    // stickers()), so it shows through the clear top but not through his head
    const sticker = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sticker.scale.setScalar(r * 2.3); sticker.renderOrder = 5;
    const lid = new T.Group(); lid.add(top);   // the top pops off as one piece
    g.add(lid, bot, band, sticker);
    return { g, lid, top, bot, sticker, cv, tex, who: null, r };
  }
  paintBall(b, p) {
    if (!p || b.who === p.id) return;
    b.who = p.id;
    const hue = hueOf(p.id);
    b.bot.material.color.setHSL(hue / 360, 0.75, 0.55);
    b.top.material.color.setHSL(hue / 360, 0.6, 0.88);
    const draw = img => {
      if (b.who !== p.id) return;
      const g = b.cv.getContext("2d");
      g.clearRect(0, 0, 256, 256);
      // the face: the head of the player's pixel sprite (front-facing, frame 0)
      if (img) {
        g.imageSmoothingEnabled = false;
        const fw = img.width / (p.cols ?? 4), fh = img.height / (p.rows ?? 4);
        const hw = fw, hh = fh * 0.5;
        g.save(); g.beginPath(); g.arc(128, 96, 70, 0, Math.PI * 2); g.clip();
        g.fillStyle = `hsl(${hue} 70% 92%)`; g.fillRect(40, 10, 180, 180);
        const s = 150 / Math.max(hw, hh);
        g.drawImage(img, 0, 0, hw, hh, 128 - hw * s / 2, 100 - hh * s / 2 + 10, hw * s, hh * s);
        g.restore();
        g.lineWidth = 6; g.strokeStyle = "#fff"; g.beginPath(); g.arc(128, 96, 70, 0, Math.PI * 2); g.stroke();
      }
      // the name, on a pill
      const name = String(p.handle ?? "?").slice(0, 14);
      g.font = "900 34px system-ui, -apple-system, sans-serif";
      const w = Math.min(240, g.measureText(name).width + 28);
      g.fillStyle = "rgba(20,12,34,.9)"; roundRect(g, 128 - w / 2, 180, w, 50, 25); g.fill();
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(name, 128, 206, 230);
      b.tex.needsUpdate = true;
    };
    draw(null);
    const load = url => { const img = new Image(); img.onload = () => draw(img); img.src = url; };
    if (p.face) load(p.face);
    else if (p.avatar) {
      // the player's own pixel sprite (charsprite.js): its quick silhouette
      // now, the real one when it's ready
      import("./charsprite.js").then(({ spriteFor, silhouetteFor, SPRITE }) => {
        p.cols = SPRITE.COLS; p.rows = SPRITE.FACINGS.length;
        load(silhouetteFor(p.avatar).url);
        spriteFor(p.avatar).then(sh => { if (sh?.url && b.who === p.id) load(sh.url); }).catch(() => {});
      }).catch(() => {});
    }
  }
  // people: [{ id, handle, avatar }] (or { face: sprite sheet url, cols,
  // rows }), all of them; up to 5 capsules fly at once and the faces cycle
  // through everyone
  setCast(people) {
    const key = people.map(p => p.id).join(",");
    if (key === this.castKey) return;
    this.castKey = key;
    this.people = people.slice();
    const n = Math.max(1, Math.min(BALLS_MAX, people.length));
    while (this.balls.length < n) { const b = this.makeBall(); this.balls.push(b); this.root.add(b.g); }
    this.balls.forEach((b, i) => { b.g.visible = i < n; b.k = i; b.next = i; b.who = null; if (i < n) this.paintBall(b, people[i % people.length]); });
    this.nBalls = n;
    this.turnFace = n;    // the next person to rotate onto a capsule
  }

  // ---------------------------------------------------------------- the wink
  // the left eye's patch of the texture, repainted closed: swapped in for the
  // wink (the face stays in the model's own texture, nothing floats in front)
  buildWink() {
    const m = this.skin?.material, img = m?.map?.image;
    if (!img) return;
    try {
      const W = img.width, H = img.height;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      // where the eye is in the texture (measured: EYE_UV)
      const x = EYE_UV[0] * W, y = (m.map.flipY ? 1 - EYE_UV[1] : EYE_UV[1]) * H, rx = W * EYE_R[0], ry = H * EYE_R[1];
      // the face paint around it: the brightest of a few samples just outside the eye
      const px = [[2.2, 0], [-2.2, 0], [0, 2.4], [1.6, 1.6], [-1.6, 1.6]].map(([a, c]) => g.getImageData(Math.round(x + rx * a), Math.round(y + ry * c), 1, 1).data)
        .reduce((a, c) => (c[0] + c[1] + c[2] > a[0] + a[1] + a[2] ? c : a));
      g.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
      g.beginPath(); g.ellipse(x, y, rx * 1.25, ry * 1.25, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#3a2420"; g.lineWidth = Math.max(2, rx * 0.32); g.lineCap = "round";
      g.beginPath(); g.ellipse(x, y - ry * 0.1, rx * 0.9, ry * 0.55, 0, Math.PI * 0.08, Math.PI * 0.92); g.stroke();
      const t = new this.THREE.CanvasTexture(cv);
      t.flipY = m.map.flipY; t.colorSpace = this.THREE.SRGBColorSpace; t.wrapS = m.map.wrapS; t.wrapT = m.map.wrapT;
      this.winkMap = t; this.baseMap = m.map;
    } catch (e) { console.warn("[clown3d] no wink texture:", e?.message ?? e); }
  }
  setWink(on) {
    const m = this.skin?.material;
    if (!m || !this.winkMap) return;
    const want = on ? this.winkMap : this.baseMap;
    if (m.map !== want) { m.map = want; m.needsUpdate = true; }
  }

  // ---------------------------------------------------------------- the stage
  attach(el) {
    if (!el?.isConnected) return;
    if (this.canvas.parentNode !== el) {
      el.prepend(this.canvas);
      el.classList.remove("c3d-on");
      this.shown = el;
      this.fit(el);
    }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  }
  fit(el) {
    const w = this.canvas.clientWidth || el.clientWidth || 320, h = this.canvas.clientHeight || el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  detach() {
    // (the old stage keeps .c3d-on: it's about to be replaced, and dropping
    // it would flash the 2D capsules for a frame)
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.shown = null;
    this.canvas.remove();
    this.setWink(false);
  }
  // play `name` as if it started `elapsed` ms ago
  beat(name, elapsed = 0, { chosen = null } = {}) {
    this.beatName = name;
    this.beatT0 = performance.now() - elapsed;
    if (chosen) this.chosen = chosen;
  }

  // keep in step with the game clock: re-start the beat if it has drifted
  sync(name, elapsed, opts = {}) {
    const mine = performance.now() - this.beatT0;
    if (name !== this.beatName || Math.abs(mine - elapsed) > 350) this.beat(name, elapsed, opts);
  }

  // a small extra rotation on a bone, on top of its rest pose
  turn(b, x, y, z) {
    if (!b) return;
    b.quaternion.multiply(this.q.setFromEuler(this.e.set(x, y, z)));
  }
  handPos(i, out) { return (i ? this.bones.rHand : this.bones.lHand).getWorldPosition(out); }
  mouthPos(out) { return this.mouthLocal ? this.bones.head.localToWorld(out.copy(this.mouthLocal)) : out.set(...MOUTH); }
  // each capsule's sticker, nudged out of the capsule toward the camera
  stickers() {
    const T = this.THREE;
    for (const b of this.balls) {
      if (!b.g.visible) continue;
      const d = this.v.copy(this.camera.position).sub(b.g.getWorldPosition(this.v2)).normalize();
      d.applyQuaternion(b.g.getWorldQuaternion(this.q).invert());
      b.sticker.position.copy(d.multiplyScalar(b.r * 1.02));
      b.sticker.material.depthTest = true;
    }
    void T;
  }

  // ---------------------------------------------------------------- poses
  // arm poses as [arm x, arm y, arm z, forearm x, forearm y, forearm z], for
  // the left arm; the right one is mirrored (y and z flip)
  arms(L, R) {
    const B = this.bones;
    this.turn(B.lArm, L[0], L[1], L[2]); this.turn(B.lFore, L[3], L[4], L[5]);
    this.turn(B.rArm, R[0], -R[1], -R[2]); this.turn(B.rFore, R[3], -R[4], -R[5]);
  }

  tick(now) {
    this.raf = 0;
    if (!this.canvas.isConnected) { this.detach(); return; }
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.shown && (this.canvas.clientWidth !== this.canvas.width / this.renderer.getPixelRatio())) this.fit(this.shown);
    this.pose(now / 1000, (now - this.beatT0) / 1000, dt);
    this.renderer.render(this.scene, this.camera);
    this.shown?.classList.add("c3d-on");    // only now hide the 2D capsules
    this.raf = requestAnimationFrame(this.tick);
  }

  // everything that moves, for beat time t (s) and wall time T (s)
  pose(T, t, dt = 0.016) {
    const B = this.bones, beat = this.beatName;
    for (const b of Object.values(B)) if (b) { b.quaternion.copy(b.userData.rest); b.scale.copy(b.userData.restS); }
    this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    let wink = false;
    // a goofy idle bounce under everything
    const bounce = Math.abs(Math.sin(T * 3.6));
    this.root.position.y = bounce * 0.012;
    this.turn(B.spine, 0, Math.sin(T * 1.1) * 0.05, Math.sin(T * 1.8) * 0.03);
    this.turn(B.head ?? B.neck, Math.sin(T * 3.6) * 0.03, Math.sin(T * 0.9) * 0.08, Math.sin(T * 1.3) * 0.05);

    if (beat === "juggle") this.juggle(T, t);
    else if (beat === "toss") this.toss(T, t);
    else if (beat === "open") this.present(T, t, { open: true });
    else if (beat === "peek") wink = this.peek(T, t);
    else if (beat === "bow") this.bow(T, t);
    else { this.arms(IDLE_ARM, IDLE_ARM); this.balls.forEach(b => { b.g.visible = false; }); }
    this.setWink(wink);
    this.root.updateMatrixWorld(true);
    this.placeBalls?.(T, t);
    this.placeBalls = null;
    this.root.updateMatrixWorld(true);
    this.stickers();
  }

  // the cascade: throws alternate hands every P seconds; ball k is thrown on
  // throws k, k + n, k + 2n... (odd n: across, even n: each hand its own)
  juggle(T, t) {
    const n = this.nBalls || 1, P = 0.36, dwell = 0.55 * P;
    const B = this.bones;
    // both forearms up, hands scooping in turn
    const sL = Math.sin((t / (2 * P)) * Math.PI * 2), sR = Math.sin((t / (2 * P)) * Math.PI * 2 + Math.PI);
    this.arms(addPose(JUGGLE_ARM, [0, 0, 0, sL * 0.16, 0, 0]), addPose(JUGGLE_ARM, [0, 0, 0, sR * 0.16, 0, 0]));
    this.turn(B.head ?? B.neck, -0.18, 0, 0);    // eyes up on the balls
    this.placeBalls = () => {
      const hand = [this.handPos(0, this.v.set(0, 0, 0)).clone(), this.handPos(1, this.v.set(0, 0, 0)).clone()];
      hand.forEach(h => { h.y += 0.03; h.z += 0.05; });
      const i = Math.floor(t / P);
      this.balls.forEach((b, k) => {
        if (k >= n) { b.g.visible = false; return; }
        b.g.visible = true; b.g.scale.setScalar(1);
        b.lid.position.set(0, 0, 0); b.lid.rotation.set(0, 0, 0); b.sticker.material.opacity = 1;
        // the last throw of this ball at or before throw i
        let j = i - (((i - k) % n) + n) % n;
        let since = t - j * P;
        const from = ((j % 2) + 2) % 2, to = n % 2 ? 1 - from : from;
        const flight = n * P - dwell;
        if (since > flight) {
          // in the catching hand until it's thrown again
          b.g.position.copy(hand[to]);
          if (!b.caught) { b.caught = true; this.rotateFace(b); }
        } else {
          b.caught = false;
          const k01 = since / flight;
          const a = hand[from], c = hand[to];
          b.g.position.set(a.x + (c.x - a.x) * k01 + (n % 2 ? 0 : (from ? 0.08 : -0.08) * Math.sin(k01 * Math.PI)),
            a.y + (c.y - a.y) * k01 + (0.12 + 0.03 * n) * 4 * k01 * (1 - k01), a.z + (c.z - a.z) * k01);
        }
        b.g.rotation.set(t * 5 + k, t * 3, 0);
      });
    };
  }
  rotateFace(b) {
    if (this.people.length <= this.nBalls) return;
    const p = this.people[this.turnFace++ % this.people.length];
    if (p.id !== this.chosen) this.paintBall(b, p);
  }
  chosenBall() {
    const p = this.people.find(x => x.id === this.chosen) ?? this.people[0];
    const b = this.balls[0];
    if (p) this.paintBall(b, p);
    return b;
  }

  // up it goes, into his mouth, gulp, spit, hold it up
  toss(T, t) {
    const B = this.bones;
    const up = span(t, 0.4, 0.9) * (1 - span(t, 1.05, 1.25));          // head back to look up / catch
    const puff = span(t, 1.1, 1.25) * (1 - span(t, 1.75, 1.95));        // cheeks full
    const show = span(t, 1.9, 2.4);                                     // hands up, holding it out
    this.arms(mixPose(JUGGLE_ARM, PRESENT_ARM, show), mixPose(addPose(JUGGLE_ARM, [0, 0, 0, -0.3 * (1 - span(t, 0, 0.3)), 0, 0]), PRESENT_ARM, show));
    this.turn(B.head ?? B.neck, -0.5 * up + 0.12 * puff + 0.06 * show, 0, 0);
    this.turn(B.spine, -0.1 * up, 0, 0);
    if (B.head && puff > 0) {
      const w = 1 + puff * (0.24 + 0.04 * Math.sin(T * 30));
      B.head.scale.set(B.head.userData.restS.x * w, B.head.userData.restS.y * (1 - puff * 0.08), B.head.userData.restS.z * (1 + puff * 0.12));
    }
    if (show > 0) this.present(T, t - 2.4, { arms: false });
    const b = this.chosenBall();
    this.placeBalls = () => {
      const rh = this.handPos(1, this.v.set(0, 0, 0)).clone(); rh.y += 0.03; rh.z += 0.05;
      const mouth = this.mouthPos(this.v2);
      // the others drop out of sight (into his pockets)
      this.balls.forEach((o, k) => {
        if (o === b || k >= this.nBalls) { if (o !== b) o.g.visible = false; return; }
        const f = span(t, 0, 0.5);
        o.g.visible = f < 1;
        o.g.scale.setScalar(1 - f);
        o.g.position.y -= 0.01;
      });
      b.lid.position.set(0, 0, 0); b.lid.rotation.set(0, 0, 0); b.sticker.material.opacity = 1;
      if (t < 1.1) {
        // up from the right hand, high, and down into the mouth
        const k = clamp01(t / 1.1), apex = mouth.y + 0.32;
        const y = k < 0.5 ? rh.y + (apex - rh.y) * Math.sin(k * Math.PI) : mouth.y + (apex - mouth.y) * Math.sin(k * Math.PI);
        b.g.visible = true; b.g.scale.setScalar(1);
        b.g.position.set(rh.x + (mouth.x - rh.x) * k, y, rh.z + (mouth.z - rh.z) * k);
        b.g.rotation.set(t * 9, t * 4, 0);
      } else if (t < 1.9) {
        b.g.visible = false;                         // gulp
      } else if (t < 2.4) {
        // spat out, down into his hands, growing as it comes to the camera
        const k = span(t, 1.9, 2.4);
        const held = this.heldPos(this.v3);
        b.g.visible = true;
        b.g.position.set(mouth.x + (held.x - mouth.x) * k, mouth.y + (held.y - mouth.y) * k + 0.08 * Math.sin(k * Math.PI), mouth.z + (held.z - mouth.z) * k);
        b.g.scale.setScalar(1 + k * (HELD_SCALE - 1));
        b.g.rotation.set((1 - k) * 6, 0, 0);
      } else {
        this.holdBall(b, T, t - 2.4);
      }
    };
  }
  // between his hands, out in front
  heldPos(out) {
    this.handPos(0, this.hl); this.handPos(1, this.hr);
    return out.copy(this.hl).add(this.hr).multiplyScalar(0.5).add(this.hr.set(0, 0.02, 0.08));
  }
  holdBall(b, T, t) {
    const held = this.heldPos(this.v3);
    b.g.visible = true;
    b.g.position.copy(held); b.g.position.y += Math.sin(T * 3) * 0.006;
    b.g.scale.setScalar(HELD_SCALE);
    b.g.rotation.set(0, 0, Math.sin(T * 2) * 0.05);
  }
  // holding the capsule up; with open: twist the top, pop, gone
  present(T, t, { open = false, arms = true } = {}) {
    if (arms) this.arms(PRESENT_ARM, PRESENT_ARM);
    if (!open) return;
    this.turn(this.bones.head ?? this.bones.neck, 0.05 + 0.08 * span(t, 0.75, 1.0), 0, 0);
    const b = this.chosenBall();
    this.balls.forEach(o => { if (o !== b) o.g.visible = false; });
    this.placeBalls = () => {
      this.holdBall(b, T, t);
      const twist = span(t, 0, 0.7), pop = span(t, 0.7, 1.3);
      b.lid.rotation.set(-pop * 1.4, twist * Math.PI * 1.5 + pop * 4, pop * 0.8);
      b.lid.position.set(pop * 0.05, twist * 0.01 + pop * 0.16, pop * 0.04);
      b.top.material.opacity = 0.55 * (1 - pop);
      b.sticker.material.opacity = 1 - span(t, 0.7, 0.9);
      b.g.rotation.y = twist * 0.4 * Math.sin(t * 30) * (1 - pop);    // the shake as it twists
    };
  }
  // the peek, the gasp, the wink and the "shhh"
  peek(T, t) {
    const B = this.bones;
    const look = span(t, 0.5, 0.9) * (1 - span(t, 1.25, 1.4));
    const gasp = span(t, 1.3, 1.45) * (1 - span(t, 1.8, 2.0));
    const shh = span(t, 1.8, 2.2);
    // the right hand comes up to his mouth for the "shhh"; the left keeps the capsule
    this.arms(mixPose(PRESENT_ARM, GASP_ARM, gasp), mixPose(mixPose(PRESENT_ARM, GASP_ARM, gasp), SHH_ARM, shh));
    this.turn(B.head ?? B.neck, 0.42 * look - 0.3 * gasp + 0.05 * shh, 0, 0.16 * shh);
    this.turn(B.spine, 0.12 * look - 0.12 * gasp, 0, 0);
    const b = this.chosenBall();
    this.balls.forEach(o => { if (o !== b) o.g.visible = false; });
    this.placeBalls = () => {
      // the capsule turns its opening toward him and cracks open, a little
      const held = this.heldPos(this.v2);
      const l = this.handPos(0, this.v3);
      const k = shh;
      b.g.visible = true;
      b.g.position.set(held.x + (l.x + 0.02 - held.x) * k, held.y + (l.y + 0.06 - held.y) * k, held.z + (l.z + 0.06 - held.z) * k);
      b.g.scale.setScalar(HELD_SCALE * (1 - 0.35 * k));
      const crack = span(t, 0.2, 0.6) * (1 - span(t, 1.3, 1.4));
      b.g.rotation.set(-0.9 * crack, 0, 0);
      b.lid.rotation.set(-0.9 * crack, 0, 0); b.lid.position.set(0, 0.02 * crack, -0.03 * crack);
      b.top.material.opacity = 0.55; b.sticker.material.opacity = 1;
    };
    return t > 2.0;
  }
  bow(T, t) {
    t %= 4.5;    // again every few seconds
    const B = this.bones, k = span(t, 0.2, 0.7) * (1 - span(t, 1.6, 2.1));
    this.arms(mixPose(IDLE_ARM, BOW_ARM, k), mixPose(IDLE_ARM, BOW_ARM, k));
    this.turn(B.spine, 0.45 * k, 0, 0);
    this.turn(B.spine1, 0.2 * k, 0, 0);
    this.turn(B.head ?? B.neck, 0.2 * k, 0, 0);
    this.balls.forEach(o => { o.g.visible = false; });
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const addPose = (a, b) => a.map((v, i) => v + b[i]);
const mixPose = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// ---------------------------------------------------------------- tuning
// arm poses (left arm; see arms()). Measured on the rig with
// test/clown3d.html; the rig's rest pose is an A-pose.
const IDLE_ARM = [0, 0, -0.25, 0.3, 0, 0];
const JUGGLE_ARM = [0.4, 0, -0.35, 1.3, 0, 0];
const PRESENT_ARM = [0.6, 0.5, -0.3, 1.5, 0, 0];
const GASP_ARM = [0, 0, 0.9, 1.6, 0, 0];
const SHH_ARM = [0.5, 0.65, -0.5, 2.4, 0, 0];
const BOW_ARM = [0.3, 0.4, -0.4, 1.1, 0, 0];
const HELD_SCALE = 2.1;
// measured on the rest pose with test/clown3d.html (a front render, then
// rays): the mouth (model space, a little in front of the lips so a capsule
// "in" it sits there), and his left eye's patch of the texture (uv centre,
// radius as a fraction of the texture)
const MOUTH = [-0.01, 0.705, 0.17];
const EYE_UV = [0.574, 0.405];
const EYE_R = [0.014, 0.017];

// dev hook (test/clown3d.html): pose by hand and read positions
export const __dev = { tune: { IDLE_ARM, JUGGLE_ARM, PRESENT_ARM, GASP_ARM, SHH_ARM, BOW_ARM, MOUTH, EYE_UV, EYE_R } };
