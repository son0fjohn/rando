// World 2 assembly — WarioWare-style globe built from /world2 assets:
// grass+road tile wrapped over a ground dome, concrete plaza decal at the
// center intersection (scaled so road widths match), Tripo GLB buildings
// and trees placed per the composition reference, image-backed sky with a
// day/night slot. Standalone review scene: no backend, no characters.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

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
  { kind: "bldg_station",  x: 0,    z: -285, yaw: 0 },
  { kind: "tree_palm",     x: -50,  z: -276, yaw: 0.6 },
  { kind: "tree_palm",     x: 52,   z: -278, yaw: -0.5 },
  { kind: "bldg_tower",    x: -168, z: -290, yaw: 0.3 },
  { kind: "bldg_highrise", x: 162,  z: -295, yaw: -0.25 },
  { kind: "bldg_highrise", x: -278, z: -190, yaw: 0.6 },
  { kind: "bldg_tower",    x: 275,  z: -195, yaw: -0.55 },

  { kind: "bldg_pastel",   x: -190, z: -180, yaw: 0.5 },
  { kind: "bldg_brick",    x: 195,  z: -185, yaw: -0.5 },
  { kind: "bldg_urban",    x: -195, z: -35,  yaw: 1.35 },
  { kind: "bldg_brick",    x: 198,  z: -40,  yaw: -1.35 },
  { kind: "bldg_urban",    x: -280, z: 40,   yaw: 1.2 },
  { kind: "bldg_pastel",   x: 282,  z: 35,   yaw: -1.2 },

  { kind: "bldg_store",    x: -68,  z: -70,  yaw: 0.8 },
  { kind: "bldg_store",    x: 72,   z: -68,  yaw: -0.8 },
  { kind: "bldg_store",    x: -70,  z: 72,   yaw: 2.3 },
  { kind: "bldg_store",    x: 74,   z: 70,   yaw: -2.3 },

  { kind: "bldg_brick",    x: -180, z: 165,  yaw: 2.1 },
  { kind: "bldg_urban",    x: 185,  z: 160,  yaw: -2.1 },

  { kind: "tree_green", x: -120, z: -120 }, { kind: "tree_green", x: 118, z: -125 },
  { kind: "tree_green", x: -235, z: -110 }, { kind: "tree_green", x: 240, z: -105 },
  { kind: "tree_green", x: -110, z: 108 },  { kind: "tree_green", x: 115, z: 105 },
  { kind: "tree_green", x: -230, z: 170 },  { kind: "tree_green", x: 235, z: 175 },
  { kind: "tree_green", x: -90,  z: 210 },  { kind: "tree_green", x: 95,  z: 215 },
  { kind: "tree_palm",  x: -300, z: -60 },  { kind: "tree_palm",  x: 302, z: -65 },
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

    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x8fa3b8, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.2);
    sun.position.set(160, 300, 180);
    this.scene.add(sun);

    const loads = [this.buildGround(), this.setSky("day"), this.placeModels()];
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
    const loop = () => { requestAnimationFrame(loop); this.renderer.render(this.scene, this.camera); };
    loop();
    setInterval(() => this.renderer.render(this.scene, this.camera), 120); // throttled-tab fallback
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
    // dome cap with planar-projected UVs so the grass+road tile repeats on a
    // CELL grid; roads land on x ≡ 0 (mod CELL), z ≡ 0 (mod CELL)
    const cap = new THREE.SphereGeometry(R, 160, 80, 0, Math.PI * 2, 0, 0.72);
    cap.translate(0, -R, 0);
    const pos = cap.attributes.position;
    const uv = cap.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) / CELL) + 0.5, (pos.getZ(i) / CELL) + 0.5);
    }
    const grass = await this.loadTex("world2/road_grass.jpg");
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.anisotropy = 8;
    this.scene.add(new THREE.Mesh(cap, new THREE.MeshLambertMaterial({ map: grass })));

    // concrete plaza decal, feathered into the grass, roads width-matched
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = "world2/road_plaza.jpg";
    });
    const cv = document.createElement("canvas");
    cv.width = cv.height = img.width;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const feather = ctx.createRadialGradient(
      cv.width / 2, cv.height / 2, cv.width * 0.483,
      cv.width / 2, cv.height / 2, cv.width * 0.498);
    feather.addColorStop(0, "rgba(0,0,0,1)");
    feather.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = feather;
    ctx.fillRect(0, 0, cv.width, cv.height);
    const plazaTex = new THREE.CanvasTexture(cv);
    plazaTex.colorSpace = THREE.SRGBColorSpace;
    plazaTex.anisotropy = 8;
    const pg = new THREE.PlaneGeometry(PLAZA, PLAZA, 24, 24);
    pg.rotateX(-Math.PI / 2);
    const pp = pg.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      pp.setY(i, domeY(pp.getX(i), pp.getZ(i)) + 0.35); // hug the dome curve
    }
    pg.computeVertexNormals();
    this.scene.add(new THREE.Mesh(pg, new THREE.MeshLambertMaterial({
      map: plazaTex, transparent: true, depthWrite: false,
    })));
  },

  async setSky(mode) {
    // day is present; night image not delivered yet — same slot, drop-in later
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
        // cap the cylinder with the sky's zenith color so looking up stays clean
        const cap = new THREE.Mesh(new THREE.CircleGeometry(1900, 72),
          new THREE.MeshBasicMaterial({ color: 0x1e6fd8 }));
        cap.rotation.x = Math.PI / 2;
        cap.position.y = 1725;
        this.scene.add(cap);
      }
      this.sky.material.map = tex;
      this.sky.material.needsUpdate = true;
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
