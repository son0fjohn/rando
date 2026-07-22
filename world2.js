// World 2 assembly — WarioWare-style globe built from /world2 assets:
// grass+road tile wrapped over a ground dome, concrete plaza decal at the
// center intersection (scaled so road widths match), Tripo GLB buildings
// and trees placed per the composition reference, image-backed sky with a
// day/night slot. Standalone review scene: no backend, no characters.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { makeGLBCharacter } from "./character3d.js";

const R = 800;          // ground dome radius
const CELL = 150;       // road grid spacing (one tile = one cell)
const PLAZA = 103;      // plaza decal size: 103 * .32 == 150 * .22 (roads align)
const CHAR_H = 15;      // reference character height (for scale sanity)

// target world heights per model (character = 15)
const MODELS = {
  bldg_store:    { url: "world2/bldg_store.glb",    h: 22 },
  bldg_brick:    { url: "world2/bldg_brick.glb",    h: 48 },
  bldg_pastel:   { url: "world2/bldg_pastel.glb",   h: 55 },
  bldg_urban:    { url: "world2/bldg_urban.glb",    h: 40 },
  bldg_tower:    { url: "world2/bldg_tower.glb",    h: 75 },
  bldg_highrise: { url: "world2/bldg_highrise.glb", h: 110 },
  bldg_station:  { url: "world2/bldg_station.glb",  h: 46 }, // arcade landmark
  tree_green:    { url: "world2/tree_green.glb",    h: 22 },
  tree_palm:     { url: "world2/tree_palm.glb",     h: 26 },
};

// composition per the reference: landmark station on the back rise flanked
// by palms, tall glass at the back corners, mid-rises on the middle ring,
// storefronts hugging the plaza, trees in the open blocks. yaw faces front.
const PLACEMENTS = [
  // radial layout: arms at N / NE / NW / SE / SW / S, hex ring at r=300.
  // landmark arcade crowns the north arm, skyline behind the back ring,
  // storefronts in the gaps around the plaza, trees filling the wedges.
  { kind: "bldg_station",  x: 0,    z: -345, yaw: 0 },
  { kind: "tree_palm",     x: -44,  z: -330, yaw: 0.6 },
  { kind: "tree_palm",     x: 46,   z: -332, yaw: -0.5 },
  { kind: "bldg_tower",    x: -140, z: -262, yaw: 0.25 },
  { kind: "bldg_highrise", x: 148,  z: -260, yaw: -0.25 },
  { kind: "bldg_highrise", x: -286, z: -168, yaw: 0.55 },
  { kind: "bldg_tower",    x: 288,  z: -172, yaw: -0.5 },

  { kind: "bldg_pastel",   x: -178, z: -78,  yaw: 1.05 },
  { kind: "bldg_brick",    x: 182,  z: -80,  yaw: -1.05 },
  { kind: "bldg_urban",    x: -128, z: -138, yaw: 0.55 },
  { kind: "bldg_brick",    x: -195, z: 132,  yaw: 2.05 },
  { kind: "bldg_urban",    x: 198,  z: 128,  yaw: -2.05 },
  { kind: "bldg_pastel",   x: 118,  z: 172,  yaw: -2.5 },

  { kind: "bldg_store",    x: 44,   z: -76,  yaw: -0.55 },
  { kind: "bldg_store",    x: -46,  z: -74,  yaw: 0.55 },
  { kind: "bldg_store",    x: -44,  z: 78,   yaw: 2.6 },
  { kind: "bldg_store",    x: 46,   z: 76,   yaw: -2.6 },

  { kind: "tree_green", x: -105, z: 28 },   { kind: "tree_green", x: 108, z: 25 },
  { kind: "tree_green", x: -170, z: -8 },   { kind: "tree_green", x: 172, z: -12 },
  { kind: "tree_green", x: -95,  z: -195 }, { kind: "tree_green", x: 98,  z: -198 },
  { kind: "tree_green", x: -120, z: 175 },  { kind: "tree_green", x: 68,  z: 205 },
  { kind: "tree_green", x: -35,  z: 240 },  { kind: "tree_green", x: 150, z: 250 },
  { kind: "tree_palm",  x: -245, z: 55 },   { kind: "tree_palm",  x: 248, z: 52 },
];

const domeY = (x, z) => Math.sqrt(Math.max(0, R * R - x * x - z * z)) - R;

export const world2 = {
  scene: null, camera: null, renderer: null,
  sky: null, ready: null,
  cam: { theta: 0, elev: 0.34, dist: 520 },

  init(frameEl) {
    const w = frameEl.clientWidth, h = frameEl.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setSize(w, h);
    frameEl.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbcd9ee); // pale horizon fallback
    this.camera = new THREE.PerspectiveCamera(46, w / h, 1, 6000);

    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x8fa3b8, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d9, 1.2);
    this.sun.position.set(160, 300, 180);
    this.scene.add(this.sun);

    // IBL so the GLB characters get their model-viewer sheen here too
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x9db8cc);
    const panel = (color, intensity, pw, ph, p) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
      m.position.set(...p);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(0xfff2d9, 6, 10, 10, [0, 14, 6]);
    panel(0xdfeeff, 2.2, 14, 8, [-12, 6, -6]);
    panel(0xdfeeff, 1.6, 14, 8, [12, 4, -4]);
    panel(0xb8c9a8, 1.2, 20, 20, [0, -8, 0]);
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();

    const params = new URLSearchParams(location.search);
    const mode = params.get("sky") === "night" ? "night" : "day";
    // ?city=<name> loads a baked real-city ground map (OSM) instead of the
    // radial toy layout; building placements are radial-specific, so skip
    this.city = params.get("city");
    if (this.city) {
      const hud = document.getElementById("hud");
      if (hud) hud.textContent += ` — ${this.city} · road data © OpenStreetMap contributors`;
    }
    const loads = [this.buildGround(), this.setSky(mode), this.placeCharacters()];
    if (!this.city) loads.push(this.placeModels());
    this.ready = Promise.all(loads);

    // simple orbit for review
    let drag = null;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; });
    addEventListener("pointermove", e => {
      if (!drag) return;
      this.cam.theta -= (e.clientX - drag.x) * 0.005;
      this.cam.elev = Math.min(1.25, Math.max(0.1, this.cam.elev + (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
      this.applyCamera();
    });
    addEventListener("pointerup", () => { drag = null; });
    el.addEventListener("wheel", e => {
      this.cam.dist = Math.min(1400, Math.max(160, this.cam.dist * (1 + e.deltaY * 0.001)));
      this.applyCamera();
    }, { passive: true });

    this.applyCamera();
    const frame = () => {
      const t = performance.now() / 1000;
      this.tickChars(t);
      this.renderer.render(this.scene, this.camera);
    };
    const loop = () => { requestAnimationFrame(loop); frame(); };
    loop();
    setInterval(frame, 120); // throttled-tab fallback
  },

  chars: [],
  async placeCharacters() {
    // a few residents so scale and motion read; walker orbits the plaza
    const defs = [
      { body: "white",   x: 16,  z: 14 },
      { body: "pink",    x: -30, z: -78 },
      { body: "skyblue", walker: true },
    ];
    for (const d of defs) {
      const c = await makeGLBCharacter({ body: d.body });
      if (!d.walker) c.group.position.set(d.x, domeY(d.x, d.z), d.z);
      c.walkerDef = d;
      this.scene.add(c.group);
      this.chars.push(c);
    }
  },

  tickChars(t) {
    for (const c of this.chars) {
      if (c.walkerDef?.walker) {
        const a = t * 0.16;
        const r = 46;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        c.walking = true;
        c.group.position.set(x, domeY(x, z), z);
        c.group.rotation.y = a + Math.PI / 2; // face along the path
      }
      c.tick(t);
    }
  },

  applyCamera() {
    const { theta, elev, dist } = this.cam;
    this.camera.position.set(
      dist * Math.sin(theta) * Math.cos(elev),
      40 + dist * Math.sin(elev),
      dist * Math.cos(theta) * Math.cos(elev));
    this.camera.lookAt(0, 30, -60);
  },

  loadTex(url) {
    return new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, rej));
  },

  async buildGround() {
    // dome cap with planar UVs over the single baked radial map (composited
    // from the two road-wrapper tiles: 6 arms, hex ring, paved plaza)
    const cap = new THREE.SphereGeometry(R, 160, 80, 0, Math.PI * 2, 0, 0.72);
    cap.translate(0, -R, 0);
    const pos = cap.attributes.position;
    const uv = cap.attributes.uv;
    const SPAN = 800;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / SPAN + 0.5, pos.getZ(i) / SPAN + 0.5);
    }
    const map = await this.loadTex(this.city
      ? `world2/ground_${this.city}.jpg`
      : "world2/ground_radial.jpg");
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping; // edges are pure grass
    map.anisotropy = 8;
    this.scene.add(new THREE.Mesh(cap, new THREE.MeshLambertMaterial({ map })));
  },

  async setSky(mode) {
    const LOOKS = {
      day:   { cap: 0x1e6fd8, bg: 0xbcd9ee, hemi: 1.1,  sun: 1.2,
               hemiSky: 0xeaf6ff, hemiGnd: 0x8fa3b8, sunCol: 0xfff2d9 },
      night: { cap: 0x02092c, bg: 0x0a1230, hemi: 0.5,  sun: 0.4,
               hemiSky: 0x4a5f8a, hemiGnd: 0x1c2438, sunCol: 0xa8c2e8 },
    };
    const look = LOOKS[mode] ?? LOOKS.day;
    try {
      const tex = await this.loadTex(`world2/sky_${mode}.jpg`);
      tex.wrapS = THREE.MirroredRepeatWrapping; // seam-free wrap of the backdrop
      tex.repeat.x = 2;
      if (!this.sky) {
        // tall so the image's pale horizon band covers below eye level too
        const geo = new THREE.CylinderGeometry(1900, 1900, 2600, 72, 1, true);
        this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
        this.sky.position.y = 430;
        this.sky.rotation.y = Math.PI / 2; // park the mirror axis behind the camera
        this.scene.add(this.sky);
        this.skyCap = new THREE.Mesh(new THREE.CircleGeometry(1900, 72),
          new THREE.MeshBasicMaterial({ color: look.cap }));
        this.skyCap.rotation.x = Math.PI / 2;
        this.skyCap.position.y = 1725;
        this.scene.add(this.skyCap);
      }
      this.sky.material.map = tex;
      this.sky.material.needsUpdate = true;
      this.skyCap.material.color.set(look.cap);
      this.scene.background = new THREE.Color(look.bg);
      this.hemi.color.set(look.hemiSky);
      this.hemi.groundColor.set(look.hemiGnd);
      this.hemi.intensity = look.hemi;
      this.sun.color.set(look.sunCol);
      this.sun.intensity = look.sun;
    } catch {
      console.warn(`world2: sky_${mode}.jpg missing — keeping current sky`);
    }
  },

  async placeModels() {
    const loader = new GLTFLoader();
    const lib = {};
    await Promise.all(Object.entries(MODELS).map(async ([k, def]) => {
      const g = await loader.loadAsync(def.url);
      const src = g.scene;
      const box = new THREE.Box3().setFromObject(src);
      const size = box.getSize(new THREE.Vector3());
      const s = def.h / size.y;
      src.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(src);
      src.position.y -= box2.min.y;
      src.position.x -= (box2.min.x + box2.max.x) / 2;
      src.position.z -= (box2.min.z + box2.max.z) / 2;
      const holder = new THREE.Group();
      holder.add(src);
      lib[k] = holder;
    }));
    const up = new THREE.Vector3(0, 1, 0);
    const n = new THREE.Vector3();
    for (const p of PLACEMENTS) {
      const inst = lib[p.kind].clone(true);
      const y = domeY(p.x, p.z);
      inst.position.set(p.x, y, p.z);
      // trees lean fully with the globe; buildings only half-lean so tall
      // facades don't read as toppling at the rim (matches the reference)
      const lean = p.kind.startsWith("tree") ? 1 : 0.5;
      n.set(p.x * lean, y * lean + R, p.z * lean).normalize();
      inst.quaternion.setFromUnitVectors(up, n);
      inst.rotateY(p.yaw ?? Math.random() * Math.PI * 2);
      this.scene.add(inst);
    }
  },
};
