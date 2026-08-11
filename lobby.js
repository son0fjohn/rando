// Rando 2D pixel lobby: the single-scene archetype room entered through an
// NPC quest offer. The 9:16 Higgsfield scene is the whole world — joystick
// movement inside one bounded floor region, no exploration beyond it (locked
// decision). The player appears as a PIXEL SPRITE OF THEIR ACTUAL AVATAR:
// rendered at runtime from the customized 3D model at tiny resolution and
// nearest-neighbor upscaled, so every cosmetic combination is represented
// without pre-generating sprite sheets. (Style-review note: runtime
// pixelation approximates but doesn't perfectly match the hand-pixelled
// scene art — flagged for review; swap makeSpriteSet for baked sheets later
// if wanted.)
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { makeHumanCharacter, staticize, matteify } from "./avatar3.js";

const el = id => document.getElementById(id);

// walkable floor per archetype, normalized to the 9:16 scene (x0,y0,x1,y1).
// Regions eyeballed from the generated art: below the back-wall furniture,
// clear of side fixtures.
const FLOORS = {
  chill:  { x0: 0.10, y0: 0.34, x1: 0.90, y1: 0.86 },
  chaos:  { x0: 0.10, y0: 0.30, x1: 0.72, y1: 0.92 },
  sporty: { x0: 0.10, y0: 0.44, x1: 0.90, y1: 0.93 },
};
// where the NPC sprite stands (normalized), per scene
const NPC_SPOTS = {
  chill:  { x: 0.50, y: 0.38 },
  chaos:  { x: 0.30, y: 0.34 },
  sporty: { x: 0.55, y: 0.50 },
};

// ---- runtime pixel-sprite baking ----------------------------------------
let spriteRenderer = null;
function getSpriteRenderer() {
  if (!spriteRenderer) {
    spriteRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    spriteRenderer.setSize(48, 64);
    spriteRenderer.setClearColor(0x000000, 0);
  }
  return spriteRenderer;
}

// render an Object3D (feet at y=0, ~CHAR_H tall) into 4-direction pixel
// frames; returns { front, back, left, right } canvases at 48x64
function bakeSpriteSet(object, height = 15) {
  const r = getSpriteRenderer();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(30, 60, 50);
  scene.add(sun);
  const holder = new THREE.Group();
  holder.add(object);
  scene.add(holder);
  const cam = new THREE.PerspectiveCamera(24, 48 / 64, 1, 400);
  const dist = height * 3.6;
  cam.position.set(0, height * 0.52, dist);
  cam.lookAt(0, height * 0.46, 0);
  const set = {};
  const dirs = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 };
  for (const [name, yaw] of Object.entries(dirs)) {
    holder.rotation.y = yaw;
    r.render(scene, cam);
    const cv = document.createElement("canvas");
    cv.width = 48; cv.height = 64;
    cv.getContext("2d").drawImage(r.domElement, 0, 0);
    set[name] = cv;
  }
  scene.remove(holder);
  holder.remove(object);
  return set;
}

async function bakePlayerSprites(avatarCfg) {
  const ch = await makeHumanCharacter(avatarCfg ?? {});
  // give async attachments (hair/clothes) a beat to land before baking
  await new Promise(res => setTimeout(res, 1500));
  const set = bakeSpriteSet(ch.group, 15);
  ch.dispose?.();
  return set;
}

const mascotCache = {};
async function bakeMascotSprites(arch) {
  if (mascotCache[arch]) return mascotCache[arch];
  const g = await new GLTFLoader().loadAsync(`npcs/${arch}.glb`);
  const src = g.scene;
  src.updateWorldMatrix(true, true);
  staticize(src);
  matteify(src);
  const holder = new THREE.Group();
  holder.add(src);
  holder.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = new THREE.Vector3();
  box.getSize(size);
  holder.scale.setScalar(11.5 / size.y);
  holder.updateWorldMatrix(true, true);
  const b2 = new THREE.Box3().setFromObject(holder);
  holder.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
  mascotCache[arch] = bakeSpriteSet(holder, 11.5);
  return mascotCache[arch];
}

// ---- the lobby scene ------------------------------------------------------
export const lobby = {
  active: null,        // archetype id while open
  raf: null,
  player: null,        // { x, y, dir, moving, sprites }
  npc: null,           // { x, y, sprites, phase }
  stick: { dx: 0, dy: 0, on: false },
  onEnter: null,   // backend hooks lobby-scoped chat here
  onExit: null,

  async enter(arch, avatarCfg, npcName) {
    if (this.active) this.exit();
    this.active = arch;
    el("lobby-bg").src = `lobbies/${arch}.png`;
    el("lobby-title").textContent = npcName ? `${npcName}'s spot` : arch;
    el("lobby").hidden = false;
    const floor = FLOORS[arch];
    this.player = {
      x: (floor.x0 + floor.x1) / 2, y: floor.y1 - 0.04,
      dir: "back", moving: false, sprites: null,
    };
    this.npc = { ...NPC_SPOTS[arch], sprites: null, phase: Math.random() * 6 };
    this.bindOnce();
    this.loop();
    this.onEnter?.(arch);
    // sprites bake in the background; simple shadow discs render meanwhile
    bakePlayerSprites(avatarCfg).then(s => { if (this.active === arch) this.player.sprites = s; });
    bakeMascotSprites(arch).then(s => { if (this.active === arch) this.npc.sprites = s; });
  },

  exit() {
    this.active = null;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.timer = null;
    el("lobby").hidden = true;
    this.onExit?.();
  },

  bound: false,
  bindOnce() {
    if (this.bound) return;
    this.bound = true;
    el("lobby-exit").addEventListener("click", () => this.exit());
    // joystick: pointer events on the pad, nub follows within radius
    const pad = el("lobby-stick"), nub = el("lobby-nub");
    const setNub = (dx, dy) => {
      nub.style.transform = `translate(calc(-50% + ${dx * 30}px), calc(-50% + ${dy * 30}px))`;
    };
    const from = e => {
      const r = pad.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      return { dx, dy };
    };
    pad.addEventListener("pointerdown", e => {
      try { pad.setPointerCapture(e.pointerId); } catch {}
      this.stick.on = true;
      Object.assign(this.stick, from(e));
      setNub(this.stick.dx, this.stick.dy);
    });
    pad.addEventListener("pointermove", e => {
      if (!this.stick.on) return;
      Object.assign(this.stick, from(e));
      setNub(this.stick.dx, this.stick.dy);
    });
    const end = () => { this.stick.on = false; this.stick.dx = this.stick.dy = 0; setNub(0, 0); };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
    // desktop: arrows / WASD — but never while typing (lobby chat input)
    this.keys = new Set();
    const typing = e => /^(INPUT|TEXTAREA)$/.test(e.target?.tagName ?? "");
    window.addEventListener("keydown", e => {
      if (!this.active || typing(e)) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === "Escape") this.exit();
    });
    window.addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
  },

  keys: new Set(),
  lastT: 0,
  lastRaf: 0,
  timer: null,

  loop() {
    const cv = el("lobby-canvas");
    const frame = el("lobby-frame");
    const tick = () => {
      if (!this.active) return;
      const t = performance.now() / 1000;
      const dt = Math.min(0.05, t - this.lastT || 0.016);
      this.lastT = t;
      // resolution follows the frame
      const W = frame.clientWidth, H = frame.clientHeight;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      // input: joystick beats keys
      let dx = this.stick.dx, dy = this.stick.dy;
      if (!this.stick.on) {
        dx = (this.keys.has("arrowright") || this.keys.has("d") ? 1 : 0) -
             (this.keys.has("arrowleft") || this.keys.has("a") ? 1 : 0);
        dy = (this.keys.has("arrowdown") || this.keys.has("s") ? 1 : 0) -
             (this.keys.has("arrowup") || this.keys.has("w") ? 1 : 0);
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
      }
      const p = this.player;
      p.moving = Math.hypot(dx, dy) > 0.12;
      if (p.moving) {
        const SPEED = 0.22; // normalized units/second
        const floor = FLOORS[this.active];
        p.x = Math.min(floor.x1, Math.max(floor.x0, p.x + dx * SPEED * dt));
        p.y = Math.min(floor.y1, Math.max(floor.y0, p.y + dy * SPEED * dt * 0.82));
        p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left")
                                            : (dy > 0 ? "front" : "back");
      }
      this.draw(cv.getContext("2d"), W, H, t);
    };
    // rAF for smoothness + interval fallback so the lobby keeps ticking in
    // throttled/hidden tabs (same pattern as world3d)
    const pump = () => {
      if (!this.active) return;
      this.raf = requestAnimationFrame(pump);
      this.lastRaf = performance.now();
      tick();
    };
    this.lastT = 0;
    pump();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.active && performance.now() - this.lastRaf > 200) tick();
    }, 90);
  },

  draw(g, W, H, t) {
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    const actors = [];
    if (this.npc) actors.push({ kind: "npc", ...this.npc });
    if (this.player) actors.push({ kind: "player", ...this.player });
    actors.sort((a, b) => a.y - b.y); // painter's order: lower = in front
    for (const a of actors) {
      // depth cue: sprites grow slightly toward the bottom of the scene
      const scale = 0.72 + a.y * 0.55;
      const w = 48 * scale * (W / 420), h = 64 * scale * (W / 420);
      const x = a.x * W, yBase = a.y * H;
      // soft contact shadow
      g.fillStyle = "rgba(10,14,20,0.28)";
      g.beginPath();
      g.ellipse(x, yBase, w * 0.32, h * 0.07, 0, 0, Math.PI * 2);
      g.fill();
      let bobY = 0, img = null;
      if (a.kind === "npc") {
        bobY = Math.abs(Math.sin(t * 2.2 + a.phase)) * h * 0.03;
        img = a.sprites ? (this.player && this.player.x < a.x ? a.sprites.left
              : this.player && this.player.x > a.x + 0.18 ? a.sprites.right
              : a.sprites.front) : null;
      } else {
        bobY = a.moving ? Math.abs(Math.sin(t * 9)) * h * 0.04 : 0;
        img = a.sprites?.[a.dir] ?? null;
      }
      if (img) {
        g.drawImage(img, x - w / 2, yBase - h - bobY, w, h);
      } else { // sprites still baking: neutral capsule placeholder
        g.fillStyle = a.kind === "npc" ? "rgba(255,255,255,0.85)" : "rgba(140,170,220,0.9)";
        g.beginPath();
        g.ellipse(x, yBase - h * 0.4, w * 0.22, h * 0.4, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
};
