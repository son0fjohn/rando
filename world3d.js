// Rando 3D world: low-poly flat-shaded scene with an orbit camera locked
// to your avatar (PoGo-style: rotate, tilt, zoom — the avatar keeps its
// screen spot, the world moves). Characters are billboards of the same
// relit renders used everywhere else. DOM bubbles/tags anchor to 3D
// points via projection each tick.
import * as THREE from "https://esm.sh/three@0.160.0";

const PCT = 5.2; // world units per art-% (zone marker coords come as %)
const CHAR_H = 15;
const NPC_DEFS = [
  { id: "npc-silver",  src: "lit/npc-silver.png",  mx: 17, my: 50, mirror: false },
  { id: "npc-dreads",  src: "lit/npc-dreads.png",  mx: 28, my: 51.5, mirror: false },
  { id: "npc-buzzcut", src: "lit/npc-buzzcut.png", mx: 71, my: 63, mirror: true },
  { id: "npc-cans",    src: "lit/npc-cans.png",    mx: 84, my: 65, mirror: false },
];

function groundPos(mx, my) {
  return new THREE.Vector3((mx - 50) * PCT, 0, (my - 60) * PCT);
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const texCache = new Map();
function loadTex(src, cb) {
  if (texCache.has(src)) { cb(texCache.get(src)); return; }
  new THREE.TextureLoader().load(src, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    texCache.set(src, tex);
    cb(tex);
  });
}

export const world3d = {
  scene: null, camera: null, renderer: null, frame: null,
  cam: { theta: 0, elev: 0.58, dist: 175 },
  CAM_DEFAULT: { theta: 0, elev: 0.58, dist: 175 },
  camGoal: null,               // eased recenter target
  target: new THREE.Vector3(0, 0, 0),
  followPos: null,
  player: null, playerShadow: null,
  remoteGroup: null,
  zoneRings: new THREE.Group(),
  anchors: [],                 // { el, getPos } DOM overlays following 3D points
  needsRender: true,

  init(frameEl) {
    this.frame = frameEl;
    const w = frameEl.clientWidth, h = frameEl.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setSize(w, h);
    Object.assign(this.renderer.domElement.style, {
      position: "absolute", inset: "0", touchAction: "none", cursor: "grab",
    });
    frameEl.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7fc4ef);
    this.scene.fog = new THREE.Fog(0xcfe3f2, 300, 1100);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 2500);

    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x8fa3b8, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.15);
    sun.position.set(120, 200, 80);
    this.scene.add(sun);

    this.buildTerrain();
    this.scene.add(this.zoneRings);
    this.remoteGroup = new THREE.Group();
    this.scene.add(this.remoteGroup);
    NPC_DEFS.forEach(n => this.addCharacter(n.src, groundPos(n.mx, n.my), n.mirror));

    this.bindControls();
    window.addEventListener("resize", () => this.resize());

    // interval-driven ticks (works even in throttled tabs) + rAF when live
    setInterval(() => this.tick(), 90);
    const loop = () => { requestAnimationFrame(loop); this.tick(); };
    loop();
    this.applyCamera();
  },

  buildTerrain() {
    const flat = { flatShading: true };
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1400, 48),
      new THREE.MeshLambertMaterial({ color: 0xccd4dd }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(130, 40),
      new THREE.MeshLambertMaterial({ color: 0xc2cbd6 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.15;
    this.scene.add(plaza);

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x71809b });
    const mkRoad = (len, wdt, x, z, rotY) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, wdt), roadMat);
      r.position.set(x, 0.2, z);
      r.rotation.y = rotY;
      this.scene.add(r);
    };
    mkRoad(1500, 26, 0, 40, 0);
    mkRoad(1500, 26, -50, 0, Math.PI / 2);
    mkRoad(1100, 20, 150, -120, 0.5);

    const rand = mulberry32(20260719);
    const shades = [0xf2f5f8, 0xe6ebf1, 0xdfe6ee, 0xd8e0e9];
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const r = 190 + rand() * 420;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 110 && Math.abs(z) < 110) continue;
      const bw = 34 + rand() * 60, bh = 24 + rand() * 95, bd = 34 + rand() * 60;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        new THREE.MeshLambertMaterial({ color: shades[i % shades.length], ...flat }));
      b.position.set(x, bh / 2, z);
      b.rotation.y = (rand() - 0.5) * 0.6;
      this.scene.add(b);
    }
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      const r = 90 + rand() * 260;
      const t = new THREE.Mesh(
        new THREE.ConeGeometry(7 + rand() * 5, 16 + rand() * 10, 7),
        new THREE.MeshLambertMaterial({ color: 0x4d7d5a, ...flat }));
      t.position.set(Math.cos(a) * r, 9, Math.sin(a) * r);
      this.scene.add(t);
    }
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(90 + rand() * 80, 24 + rand() * 18), cloudMat);
      c.position.set((rand() - 0.5) * 1400, 330 + rand() * 130, (rand() - 0.5) * 1400);
      c.rotation.x = -Math.PI / 2;
      this.scene.add(c);
    }
  },

  registerZones(zones) {
    this.zoneRings.clear();
    for (const z of zones.filter(z => z.kind !== "auto")) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(11, 13.5, 40),
        new THREE.MeshBasicMaterial({ color: 0x8fc2ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      const p = groundPos(Number(z.marker_x), Number(z.marker_y));
      ring.position.set(p.x, 0.3, p.z);
      this.zoneRings.add(ring);
    }
    this.needsRender = true;
  },

  addCharacter(src, pos, mirror = false, parent = this.scene) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.05 }));
    sprite.center.set(0.5, 0); // feet anchor
    sprite.position.copy(pos);
    loadTex(src, tex => {
      sprite.material.map = tex;
      sprite.material.needsUpdate = true;
      const aspect = tex.image.width / tex.image.height;
      sprite.scale.set(CHAR_H * aspect * (mirror ? -1 : 1), CHAR_H, 1);
      this.needsRender = true;
    });
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.25 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(CHAR_H * 0.34, CHAR_H * 0.15, 1);
    shadow.position.set(pos.x, 0.4, pos.z);
    parent.add(sprite);
    parent.add(shadow);
    return { sprite, shadow };
  },

  setPlayer(opts) { // { src, mx, my } | null
    if (this.player) {
      this.scene.remove(this.player.sprite);
      this.scene.remove(this.player.shadow);
      this.player = null;
    }
    if (opts) {
      const pos = groundPos(Number(opts.mx), Number(opts.my));
      this.player = this.addCharacter(opts.src, pos);
      this.followPos = pos.clone();
    } else {
      this.followPos = null;
    }
    this.needsRender = true;
  },

  setRemotes(list) { // [{ src, mx, my, slot }]
    this.remoteGroup.clear();
    for (const r of list) {
      const dx = (r.slot % 2 ? -1 : 1) * Math.ceil((r.slot + 1) / 2) * 7;
      const dz = ((r.slot % 3) - 1) * 4;
      const pos = groundPos(Number(r.mx), Number(r.my)).add(new THREE.Vector3(dx, 0, dz));
      this.addCharacter(r.src, pos, r.slot % 2 === 1, this.remoteGroup);
    }
    this.needsRender = true;
  },

  // ---- DOM overlays pinned to 3D points ----
  anchor(el, getPos) {
    this.anchors.push({ el, getPos });
    this.placeAnchor(this.anchors[this.anchors.length - 1]);
  },
  anchorAtZone(el, mx, my, headY = CHAR_H + 1) {
    const p = groundPos(Number(mx), Number(my));
    this.anchor(el, () => new THREE.Vector3(p.x, headY, p.z));
  },
  anchorAtNpc(el, npcId) {
    const n = NPC_DEFS.find(n => n.id === npcId);
    if (!n) return;
    this.anchorAtZone(el, n.mx, n.my);
  },
  anchorAtPlayer(el, headY = CHAR_H + 1) {
    this.anchor(el, () =>
      this.player ? this.player.sprite.position.clone().setY(headY) : null);
  },
  placeAnchor(a) {
    if (!a.el.isConnected) return false;
    const pos = a.getPos();
    if (!pos) { a.el.style.display = "none"; return true; }
    const v = pos.project(this.camera);
    if (v.z > 1) { a.el.style.display = "none"; return true; }
    a.el.style.display = "";
    a.el.style.left = ((v.x * 0.5 + 0.5) * this.frame.clientWidth) + "px";
    a.el.style.top = ((-v.y * 0.5 + 0.5) * this.frame.clientHeight) + "px";
    return true;
  },

  // ---- camera ----
  applyCamera() {
    const t = this.target;
    const { theta, elev, dist } = this.cam;
    this.camera.position.set(
      t.x + dist * Math.sin(theta) * Math.cos(elev),
      t.y + dist * Math.sin(elev),
      t.z + dist * Math.cos(theta) * Math.cos(elev));
    this.camera.lookAt(t.x, t.y + CHAR_H + 4, t.z);
    this.needsRender = true;
  },

  recenter() {
    this.camGoal = { ...this.CAM_DEFAULT };
  },

  bindControls() {
    const el = this.renderer.domElement;
    const pointers = new Map();
    let pinch0 = null;
    el.addEventListener("pointerdown", e => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.cam.dist };
      }
      el.style.cursor = "grabbing";
      this.camGoal = null;
    });
    el.addEventListener("pointermove", e => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch0 && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.dist = Math.min(420, Math.max(70, pinch0.dist * (pinch0.d / d)));
      } else if (pointers.size === 1) {
        this.cam.theta -= (e.clientX - prev.x) * 0.006;
        this.cam.elev = Math.min(1.25, Math.max(0.22, this.cam.elev + (e.clientY - prev.y) * 0.004));
      }
      this.applyCamera();
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch0 = null;
      if (!pointers.size) el.style.cursor = "grab";
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", e => {
      e.preventDefault();
      this.cam.dist = Math.min(420, Math.max(70, this.cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      this.applyCamera();
    }, { passive: false });
  },

  resize() {
    const w = this.frame.clientWidth, h = this.frame.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  },

  tick() {
    // glide the camera target toward the followed position
    const goal = this.followPos ?? new THREE.Vector3(0, 0, 0);
    if (this.target.distanceTo(goal) > 0.5) {
      this.target.lerp(goal, 0.18);
      this.applyCamera();
    }
    if (this.camGoal) {
      const c = this.cam, g = this.camGoal;
      c.theta += (g.theta - c.theta) * 0.2;
      c.elev += (g.elev - c.elev) * 0.2;
      c.dist += (g.dist - c.dist) * 0.2;
      if (Math.abs(g.theta - c.theta) < 0.005 && Math.abs(g.dist - c.dist) < 1) this.camGoal = null;
      this.applyCamera();
    }
    this.anchors = this.anchors.filter(a => this.placeAnchor(a));
    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  },
};
