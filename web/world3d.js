// Rando 3D world: low-poly flat-shaded scene with an orbit camera locked
// to your avatar (PoGo-style: rotate, tilt, zoom — the avatar keeps its
// screen spot, the world moves). Characters are billboards of the same
// relit renders used everywhere else. DOM bubbles/tags anchor to 3D
// points via projection each tick.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { makeCharacter, makeGLBCharacter, makeGLBCharacterSync, loadGLBTemplate } from "./character3d.js";

// generated GLB characters are the default; ?glb=0 falls back to procedural
const GLB_MODE = new URLSearchParams(location.search).get("glb") !== "0";

const CHAR_H = 15;

// Geographic world: coordinates ARE real Itaewon geography, projected the
// same way scripts/fetch_roads.py bakes the OSM roads.
const GEO_CENTER = [37.5346, 126.9946]; // Itaewon station
const GEO_SCALE = 0.55;                 // world units per metre
const WORLD_EDGE = 1050;                // far positions clamp to this radius

function geoPos(lat, lng) {
  const mLat = 110540.0, mLng = 111320.0 * Math.cos(GEO_CENTER[0] * Math.PI / 180);
  let x = (Number(lng) - GEO_CENTER[1]) * mLng * GEO_SCALE;
  let z = -(Number(lat) - GEO_CENTER[0]) * mLat * GEO_SCALE; // north = -z
  const d = Math.hypot(x, z);
  if (d > WORLD_EDGE) { // visitors far outside Itaewon appear at the map
    x *= WORLD_EDGE / d; // edge in their true real-world direction
    z *= WORLD_EDGE / d;
  }
  return new THREE.Vector3(x, 0, z);
}

// NPCs at real spots: one pair in Gyeongnidan, one by Itaewon station.
const NPC_DEFS = [
  { id: "npc-silver",  lat: 37.5390, lng: 126.9884, partner: "npc-dreads",
    preset: { body: "grey",   eyes: "sleepy",  head: "floppyears" } },
  { id: "npc-dreads",  lat: 37.5389, lng: 126.9892, partner: "npc-silver",
    preset: { body: "navy",   eyes: "default", iris: "brown", head: "teardrop" } },
  { id: "npc-buzzcut", lat: 37.5349, lng: 126.9951, partner: "npc-cans",
    preset: { body: "red",    eyes: "anime",   iris: "orange", head: "smallspikes" } },
  { id: "npc-cans",    lat: 37.5347, lng: 126.9958, partner: "npc-buzzcut",
    preset: { body: "orange", eyes: "spiral",  head: "notailspike" } },
];

// day/night mode: auto from local time, ?mode=night|day overrides.
// Palettes are the law from assets/world/STYLE.md.
const modeParam = new URLSearchParams(location.search).get("mode");
const hourNow = new Date().getHours();
export const NIGHT = modeParam === "night" ||
  (modeParam !== "day" && (hourNow >= 19 || hourNow < 6.5));
const M = NIGHT ? {
  skyTop: "#0b1a38", skyMid: "#23406e", skyHor: "#547499",
  fog: 0x1c2c49, hemiSky: 0x4a5f8a, hemiGround: 0x1c2438, hemiInt: 0.72,
  sunCol: 0xa8c2e8, sunInt: 0.5, cloudBody: "#d8e2f2", cloudShade: "#8fa0bd",
  cloudTint: 0xc2cfe2, cloudOp: 0.8, grass: 0x3d5c40, road: 0x474c59,
  winCol: 0x2e2a22, winEmis: 0xffc86e,
} : {
  skyTop: "#2f83d2", skyMid: "#6cb2e6", skyHor: "#e2f1fa",
  fog: 0xdcebf6, hemiSky: 0xeaf6ff, hemiGround: 0x8fa3b8, hemiInt: 1.15,
  sunCol: 0xfff2d9, sunInt: 1.15, cloudBody: "#ffffff", cloudShade: "#c9dff0",
  cloudTint: 0xffffff, cloudOp: 0.95, grass: 0x79b356, road: 0x9599a2,
  winCol: 0x9db4c8, winEmis: 0x000000,
};

// zone character: density weight for buildings (urban) vs greenery
const ZONE_FLAVOR = [
  { lat: 37.5346, lng: 126.9946, build: 1.0,  green: 0.05 }, // Itaewon station
  { lat: 37.5349, lng: 126.9941, build: 0.95, green: 0.05 }, // Hamilton Alley
  { lat: 37.5392, lng: 126.9887, build: 0.7,  green: 0.3 },  // Gyeongnidan
  { lat: 37.5340, lng: 126.9868, build: 0.55, green: 0.35 }, // Noksapyeong
  { lat: 37.5418, lng: 126.9882, build: 0.3,  green: 0.9 },  // Haebangchon
  { lat: 37.5289, lng: 126.9944, build: 0.25, green: 0.85 }, // Bogwang
];

// minimal studio env for PMREM: warm key overhead, cool sky fill, ground
// bounce — approximates a model-viewer's IBL without an extra module
function makeEnvScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x9db8cc);
  const panel = (color, intensity, w, h, pos, lookAt) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }),
    );
    m.position.set(...pos);
    m.lookAt(...lookAt);
    s.add(m);
  };
  panel(0xfff2d9, 6, 10, 10, [0, 14, 6], [0, 0, 0]);    // warm key, high front
  panel(0xdfeeff, 2.2, 14, 8, [-12, 6, -6], [0, 0, 0]); // cool fill, back-left
  panel(0xdfeeff, 1.6, 14, 8, [12, 4, -4], [0, 0, 0]);  // soft fill, right
  panel(0xb8c9a8, 1.2, 20, 20, [0, -8, 0], [0, 0, 0]);  // grass bounce below
  return s;
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const world3d = {
  scene: null, camera: null, renderer: null, frame: null,
  cam: { theta: 0, elev: 0.58, dist: 175 },
  CAM_DEFAULT: { theta: 0, elev: 0.58, dist: 175 },
  camGoal: null,               // eased recenter target
  target: new THREE.Vector3(0, 0, 0),
  followPos: null,
  observing: false,            // true after a pan: camera roams free
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
    this.scene.background = new THREE.Color(M.skyTop);
    this.scene.fog = new THREE.Fog(M.fog, 340, 1250);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 2500);

    // IBL for the GLB characters (PBR materials only — the Lambert world
    // ignores scene.environment, so the locked style is untouched)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(makeEnvScene(), 0.04).texture;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(M.hemiSky, M.hemiGround, M.hemiInt));
    const sun = new THREE.DirectionalLight(M.sunCol, M.sunInt);
    sun.position.set(120, 200, 80);
    this.scene.add(sun);

    this.buildTerrain();
    this.scene.add(this.zoneRings);
    this.remoteGroup = new THREE.Group();
    this.scene.add(this.remoteGroup);
    const spawnNpcs = () => {
      for (const n of NPC_DEFS) {
        const pos = geoPos(n.lat, n.lng);
        const api = GLB_MODE ? makeGLBCharacterSync(n.preset) ?? undefined : undefined;
        const rec = this.makeChar(n.preset, pos, this.scene, api);
        const partner = NPC_DEFS.find(d => d.id === n.partner);
        if (partner) {
          const pp = geoPos(partner.lat, partner.lng);
          rec.api.group.rotation.y = Math.atan2(pp.x - pos.x, pp.z - pos.z);
        }
      }
      this.needsRender = true;
    };
    // in GLB mode wait for the shared template so NPCs clone synchronously
    if (GLB_MODE) loadGLBTemplate().then(spawnNpcs, spawnNpcs);
    else spawnNpcs();
    this.loadWorld(); // async: real roads + zone-flavored buildings/trees

    this.bindControls();
    window.addEventListener("resize", () => this.resize());

    // interval-driven ticks (works even in throttled tabs) + rAF when live
    setInterval(() => this.tick(), 90);
    const loop = () => { requestAnimationFrame(loop); this.tick(); };
    loop();
    this.applyCamera();
  },

  // canvas-generated texture helper
  canvasTex(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },

  // Palette + design from the original painted world: pale tiled ground,
  // slate-blue roads with light sidewalk borders, white flat-roofed
  // buildings with dark window bands, blue sky and clouds. No trees.
  buildTerrain() {
    // sky: the painted world2 backdrop image on a tall cylinder (day or
    // night file per mode), mirrored wrap so the seam never shows
    this.texIfExists(NIGHT ? "world2/sky_night.jpg" : "world2/sky_day.jpg", tex => {
      tex.wrapS = THREE.MirroredRepeatWrapping;
      tex.repeat.x = 2;
      const sky = new THREE.Mesh(
        new THREE.CylinderGeometry(1900, 1900, 2600, 72, 1, true),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
      sky.position.y = 430;
      sky.rotation.y = Math.PI / 2;
      this.scene.add(sky);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(1900, 72),
        new THREE.MeshBasicMaterial({ color: NIGHT ? 0x02092c : 0x1e6fd8, fog: false }));
      cap.rotation.x = Math.PI / 2;
      cap.position.y = 1725;
      this.scene.add(cap);
    });

    // ground: world2 grass extracted from the road-wrapper tile, mirror-
    // tiled into a seam-free block and repeated across the plane
    const groundMat = new THREE.MeshLambertMaterial({ color: M.grass });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1500, 48), groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.loadImage("world2/road_grass.jpg").then(img => {
      const tex = this.mirrorBlockTex(img, [0.03, 0.03, 0.30, 0.30]);
      tex.repeat.set(38, 38); // block ≈ 80u of ground per repeat
      groundMat.map = tex;
      groundMat.color.set(NIGHT ? 0x5a6d80 : 0xffffff);
      groundMat.needsUpdate = true;
      this.needsRender = true;
    }).catch(() => {});
  },

  loadImage(url) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
  },

  // seam-free texture from an image region: crop, then mirror into a 2x2
  // block so RepeatWrapping never shows a hard tile edge
  mirrorBlockTex(img, [x0, y0, x1, y1]) {
    const w = Math.round((x1 - x0) * img.width), h = Math.round((y1 - y0) * img.height);
    const c = document.createElement("canvas");
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext("2d");
    const sx = x0 * img.width, sy = y0 * img.height;
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      g.save();
      g.translate(fx ? w * 2 : 0, fy ? h * 2 : 0);
      g.scale(fx ? -1 : 1, fy ? -1 : 1);
      g.drawImage(img, sx, sy, w, h, 0, 0, w, h);
      g.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  // optional generated texture: applied when present, silent when absent
  texIfExists(url, onload) {
    new THREE.TextureLoader().load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      onload(tex);
      this.needsRender = true;
    }, undefined, () => {});
  },

  // Real Itaewon: roads baked from OpenStreetMap (scripts/fetch_roads.py),
  // buildings placed along actual road frontage with density driven by
  // zone character (urban clusters), trees filling the green zones.
  async loadWorld() {
    let data;
    try {
      data = await (await fetch("roads.json")).json();
    } catch { return; }
    const rand = mulberry32(4207);
    const WID = { primary: 24, secondary: 19, tertiary: 15, residential: 11, pedestrian: 8, unclassified: 11 };

    const roadGeos = [];
    const jointGeos = [];
    const occupied = new Set(); // 25u cells covered by roads/buildings
    const mark = (x, z) => occupied.add(Math.round(x / 25) + "," + Math.round(z / 25));
    const candidates = [];
    for (const road of data.roads) {
      const w = WID[road.t] ?? 11;
      const pts = road.p;
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        if (i < pts.length - 1) {
          const [x2, z2] = pts[i + 1];
          const dx = x2 - x, dz = z2 - z;
          const len = Math.hypot(dx, dz);
          if (len < 0.5) continue;
          const ang = Math.atan2(dx, dz);
          const g = new THREE.BoxGeometry(w, 0.5, len);
          // scale v so the asphalt texture repeats every ~26u along the road
          const uv = g.attributes.uv;
          for (let ui = 0; ui < uv.count; ui++) uv.setY(ui, uv.getY(ui) * (len / 26));
          g.applyMatrix4(new THREE.Matrix4().makeRotationY(ang)
            .setPosition((x + x2) / 2, 0.25, (z + z2) / 2));
          roadGeos.push(g);
          const steps = Math.max(1, Math.floor(len / 22));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps, px = x + dx * t, pz = z + dz * t;
            mark(px, pz);
            if (road.t !== "pedestrian") candidates.push({ x: px, z: pz, ang, w });
          }
        }
        if (i > 0 && i < pts.length - 1) {
          // sits a hair above the ribbons: separate material would z-fight
          const jg = new THREE.CylinderGeometry(w / 2, w / 2, 0.56, 10);
          jg.applyMatrix4(new THREE.Matrix4().setPosition(x, 0.27, z));
          jointGeos.push(jg);
        }
      }
    }
    // ribbons carry the tile's road-strip art (curbs + dashes run along v);
    // junction discs stay flat asphalt so the strip never smears radially
    const roadMat = new THREE.MeshLambertMaterial({ color: M.road });
    this.scene.add(new THREE.Mesh(mergeGeometries(roadGeos), roadMat));
    const jointMat = new THREE.MeshLambertMaterial({ color: M.road });
    this.scene.add(new THREE.Mesh(mergeGeometries(jointGeos), jointMat));
    this.loadImage("world2/road_grass.jpg").then(img => {
      const c = document.createElement("canvas");
      const sx = 0.36 * img.width, sw = 0.28 * img.width;
      const sy = 0.72 * img.height, sh = 0.275 * img.height;
      c.width = 256; c.height = 256;
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      roadMat.map = tex;
      roadMat.color.set(NIGHT ? 0x8a93a8 : 0xffffff);
      roadMat.needsUpdate = true;
      // junction discs: plain-asphalt crop from the same image, so their
      // brightness matches the ribbons exactly (no hand-picked grey)
      const jc = document.createElement("canvas");
      jc.width = jc.height = 128;
      jc.getContext("2d").drawImage(img,
        0.52 * img.width, 0.78 * img.height, 0.07 * img.width, 0.07 * img.height,
        0, 0, 128, 128);
      const jtex = new THREE.CanvasTexture(jc);
      jtex.colorSpace = THREE.SRGBColorSpace;
      jtex.wrapS = jtex.wrapT = THREE.RepeatWrapping;
      jointMat.map = jtex;
      jointMat.color.set(NIGHT ? 0x8a93a8 : 0xffffff);
      jointMat.needsUpdate = true;
      this.needsRender = true;
    }).catch(() => {});

    // zone flavor fields (gaussian falloff around zone centers)
    const flavors = ZONE_FLAVOR.map(f => ({ p: geoPos(f.lat, f.lng), build: f.build, green: f.green }));
    const fieldAt = (x, z, key) => {
      let v = 0;
      for (const f of flavors) {
        const d2 = (x - f.p.x) ** 2 + (z - f.p.z) ** 2;
        v = Math.max(v, f[key] * Math.exp(-d2 / (2 * 260 * 260)));
      }
      return v;
    };

    // buildings + trees: the world2 GLB models, instanced per type (one
    // draw call per model) along real road frontage. Geometry is baked to
    // target height with feet at y=0 so instance matrices are just
    // yaw+scale+position.
    const loader = new GLTFLoader();
    const loadPiece = async (url, h, glow) => {
      const g = await loader.loadAsync(url);
      g.scene.updateWorldMatrix(true, true);
      let mesh = null;
      g.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      const size = geo.boundingBox.getSize(new THREE.Vector3());
      const s = h / size.y;
      geo.applyMatrix4(new THREE.Matrix4().makeScale(s, s, s));
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
        -(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2));
      const mat = mesh.material.clone();
      if (NIGHT) { // baked day textures: dim down; buildings keep a soft
        mat.color = new THREE.Color(glow ? 0x93a0b5 : 0x76879c); // window glow
        if (glow) {
          mat.emissive = new THREE.Color(0xffffff);
          mat.emissiveMap = mat.map;
          mat.emissiveIntensity = 0.22;
        }
      }
      geo.computeBoundingBox();
      const fp = geo.boundingBox;
      const radius = Math.hypot(fp.max.x - fp.min.x, fp.max.z - fp.min.z) / 2;
      return { geo, mat, radius };
    };
    let lib = null;
    try {
      const defs = {
        store:    ["world2/bldg_store.glb", 22, true],
        urban:    ["world2/bldg_urban.glb", 40, true],
        brick:    ["world2/bldg_brick.glb", 48, true],
        pastel:   ["world2/bldg_pastel.glb", 55, true],
        tower:    ["world2/bldg_tower.glb", 75, true],
        highrise: ["world2/bldg_highrise.glb", 110, true],
        arcade:   ["world2/bldg_station.glb", 46, true],
        tree:     ["world2/tree_green.glb", 22, false],
        palm:     ["world2/tree_palm.glb", 26, false],
      };
      lib = Object.fromEntries(await Promise.all(Object.entries(defs).map(
        async ([k, [u, h, gl]]) => [k, await loadPiece(u, h, gl)])));
    } catch (e) {
      console.warn("world2 models missing — world renders roads/ground only", e);
    }
    // true collision: placed footprint circles, bucketed for fast lookup
    const placed = new Map(); // "bx,bz" -> [{x, z, r}]
    const BUCKET = 64;
    const collides = (x, z, r) => {
      const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
      for (let i = bx - 1; i <= bx + 1; i++) {
        for (let j = bz - 1; j <= bz + 1; j++) {
          for (const p of placed.get(i + "," + j) ?? []) {
            const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
            if (d2 < (r + p.r + 2) ** 2) return true;
          }
        }
      }
      return false;
    };
    const occupy = (x, z, r) => {
      const k = Math.floor(x / BUCKET) + "," + Math.floor(z / BUCKET);
      if (!placed.has(k)) placed.set(k, []);
      placed.get(k).push({ x, z, r });
    };
    // gathering plazas: keep zone centers clear of structures
    const nearZoneCenter = (x, z, rad) =>
      flavors.some(f => (x - f.p.x) ** 2 + (z - f.p.z) ** 2 < rad * rad);
    // placement: same frontage walk, but each lot picks a model type from
    // zone density (towers only in the urban core, low-rise near plazas).
    // Capped so mobile GPUs stay comfortable with the 4-5k-tri models.
    const inst = { store: [], urban: [], brick: [], pastel: [], tower: [], highrise: [] };
    const MAX_BUILDINGS = 220;
    let placedCount = 0;
    if (lib) for (const c of candidates) {
      if (placedCount >= MAX_BUILDINGS) break;
      const D = fieldAt(c.x, c.z, "build");
      if (rand() > D * 0.34) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const off = c.w / 2 + 12 + rand() * 14;
      const px = c.x + Math.cos(c.ang) * off * side;
      const pz = c.z - Math.sin(c.ang) * off * side;
      if (nearZoneCenter(px, pz, 78)) continue;
      const lowOnly = nearZoneCenter(px, pz, 170);
      const r = rand();
      let t;
      if (!lowOnly && D > 0.42 && r < 0.14) t = rand() < 0.5 ? "tower" : "highrise";
      else if (r < 0.42) t = "store";
      else if (r < 0.62) t = "urban";
      else if (r < 0.84) t = "brick";
      else t = "pastel";
      if (lowOnly && t !== "store" && t !== "urban") t = rand() < 0.5 ? "store" : "urban";
      const s = 0.9 + rand() * 0.25;
      const rad = lib[t].radius * s;
      if (collides(px, pz, rad)) continue;
      occupy(px, pz, rad);
      mark(px, pz);
      // face the road the lot fronts onto
      const yaw = Math.atan2(-Math.cos(c.ang) * side, Math.sin(c.ang) * side);
      const m = new THREE.Matrix4().makeRotationY(yaw)
        .scale(new THREE.Vector3(s, s, s));
      m.setPosition(px, 0, pz);
      inst[t].push(m);
      placedCount++;
    }
    if (lib) {
      for (const [t, list] of Object.entries(inst)) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(lib[t].geo, lib[t].mat, list.length);
        list.forEach((mm, i) => im.setMatrixAt(i, mm));
        this.scene.add(im);
      }
      // the arcade landmark takes the station plaza rim, facing the center
      const st = flavors.reduce((a, b) => (a.p.lengthSq() < b.p.lengthSq() ? a : b));
      for (let k = 0; k < 12; k++) {
        const ang = -Math.PI / 2 + k * 0.52;
        const px = st.p.x + Math.cos(ang) * 86;
        const pz = st.p.z + Math.sin(ang) * 86;
        if (collides(px, pz, lib.arcade.radius)) continue;
        occupy(px, pz, lib.arcade.radius);
        const landmark = new THREE.Mesh(lib.arcade.geo, lib.arcade.mat);
        landmark.position.set(px, 0, pz);
        landmark.rotation.y = Math.atan2(st.p.x - px, st.p.z - pz);
        this.scene.add(landmark);
        break;
      }
    }

    // paved gathering plazas: world2 concrete-tile paving
    this.loadImage("world2/road_plaza.jpg").then(img => {
      const tex = this.mirrorBlockTex(img, [0.05, 0.05, 0.27, 0.27]);
      tex.repeat.set(4, 4);
      const plazaMat = new THREE.MeshLambertMaterial({
        map: tex, color: NIGHT ? 0x8a93a8 : 0xffffff });
      for (const f of flavors) {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(52, 36), plazaMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(f.p.x, 0.22, f.p.z);
        this.scene.add(disc);
      }
      this.needsRender = true;
    }).catch(() => {});

    // trees: instanced world2 GLB trees, green-zone weighted as before
    if (lib) {
      const tinst = { tree: [], palm: [] };
      const MAX_TREES = 150;
      for (let i = 0; i < 1500 && tinst.tree.length + tinst.palm.length < MAX_TREES; i++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 1000;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (occupied.has(Math.round(x / 25) + "," + Math.round(z / 25))) continue;
        if (nearZoneCenter(x, z, 40)) continue;
        const G = fieldAt(x, z, "green") + 0.06;
        if (rand() > G * 0.75) continue;
        const t = rand() < 0.07 ? "palm" : "tree";
        const s = 0.85 + rand() * 0.45;
        const m = new THREE.Matrix4().makeRotationY(rand() * Math.PI * 2)
          .scale(new THREE.Vector3(s, s, s));
        m.setPosition(x, 0, z);
        tinst[t].push(m);
      }
      for (const [t, list] of Object.entries(tinst)) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(lib[t].geo, lib[t].mat, list.length);
        list.forEach((mm, i) => im.setMatrixAt(i, mm));
        this.scene.add(im);
      }
    }

    this.needsRender = true;
  },

  registerZones(zones) {
    this.zoneRings.clear();
    for (const z of zones.filter(z => z.kind !== "auto")) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(11, 13.5, 40),
        new THREE.MeshBasicMaterial({ color: 0x8fc2ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      const p = geoPos(z.lat, z.lng);
      ring.position.set(p.x, 0.35, p.z);
      this.zoneRings.add(ring);
    }
    this.needsRender = true;
  },

  chars: new Set(),      // every live modular character (for animation)
  remoteRecs: [],

  makeChar(avatarCfg, pos, parent, apiOverride) {
    const api = apiOverride ?? makeCharacter(avatarCfg);
    api.group.position.copy(pos);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.25 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(5.4, 2.6, 1);
    shadow.position.set(pos.x, 0.42, pos.z);
    parent.add(api.group);
    parent.add(shadow);
    const rec = { api, shadow, walkTarget: null };
    this.chars.add(rec);
    return rec;
  },

  removeChar(rec, parent) {
    parent.remove(rec.api.group);
    parent.remove(rec.shadow);
    this.chars.delete(rec);
  },

  setPlayer(opts) { // { avatar, lat, lng } | null
    const prevPos = this.player ? this.player.api.group.position.clone() : null;
    if (this.player) {
      this.removeChar(this.player, this.scene);
      this.player = null;
    }
    if (opts) {
      const pos = geoPos(opts.lat, opts.lng);
      // zone change while already in world: walk there instead of teleporting
      const spawnAt = prevPos && prevPos.distanceTo(pos) > 1 ? prevPos : pos;
      const install = api => {
        this.player = this.makeChar(opts.avatar, spawnAt, this.scene, api);
        if (!spawnAt.equals(pos)) this.player.walkTarget = pos.clone();
        this.followPos = this.player.api.group.position; // live ref: camera tracks walking
        this.observing = false; // going open snaps attention back to you
        this.needsRender = true;
      };
      if (GLB_MODE) {
        const token = (this._glbToken = (this._glbToken ?? 0) + 1);
        makeGLBCharacter(opts.avatar).then(api => {
          if (token !== this._glbToken) return;
          if (this.player) { this.removeChar(this.player, this.scene); this.player = null; }
          install(api);
        }).catch(() => install(undefined)); // fall back to procedural
      } else {
        install(undefined);
      }
    } else {
      this.followPos = null;
    }
    this.needsRender = true;
  },

  setRemotes(list) { // [{ avatar, lat, lng, slot }]
    for (const rec of this.remoteRecs) this.removeChar(rec, this.remoteGroup);
    this.remoteRecs = [];
    this.remoteGroup.clear();
    for (const r of list) {
      const dx = (r.slot % 2 ? -1 : 1) * Math.ceil((r.slot + 1) / 2) * 9;
      const dz = ((r.slot % 3) - 1) * 5;
      const pos = geoPos(r.lat, r.lng).add(new THREE.Vector3(dx, 0, dz));
      const api = GLB_MODE ? makeGLBCharacterSync(r.avatar) ?? undefined : undefined;
      const rec = this.makeChar(r.avatar, pos, this.remoteGroup, api);
      // face roughly inward toward the cluster for a hanging-out feel
      rec.api.group.rotation.y = Math.atan2(-dx, 6);
      this.remoteRecs.push(rec);
    }
    this.needsRender = true;
  },

  // ---- DOM overlays pinned to 3D points ----
  anchor(el, getPos) {
    this.anchors.push({ el, getPos });
    this.placeAnchor(this.anchors[this.anchors.length - 1]);
  },
  anchorAtZone(el, lat, lng, headY = CHAR_H + 1) {
    const p = geoPos(lat, lng);
    this.anchor(el, () => new THREE.Vector3(p.x, headY, p.z));
  },
  anchorAtNpc(el, npcId) {
    const n = NPC_DEFS.find(n => n.id === npcId);
    if (!n) return;
    this.anchorAtZone(el, n.lat, n.lng);
  },
  anchorAtPlayer(el, headY = CHAR_H + 1) {
    this.anchor(el, () =>
      this.player ? this.player.api.group.position.clone().setY(headY) : null);
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
    this.observing = false;
    this.camGoal = { ...this.CAM_DEFAULT };
  },

  // One-finger drag PANS (free observer); two fingers pinch-zoom, twist to
  // rotate, move vertically together to tilt. Desktop: drag pans, wheel
  // zooms, right-click or Ctrl+drag orbits. Recenter returns to follow.
  bindControls() {
    const el = this.renderer.domElement;
    const pointers = new Map();
    let gesture = null;
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("pointerdown", e => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch {}
      this.camGoal = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = {
          type: "two",
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          a0: Math.atan2(b.y - a.y, b.x - a.x),
          midY0: (a.y + b.y) / 2,
          dist0: this.cam.dist, theta0: this.cam.theta, elev0: this.cam.elev,
        };
      } else if (pointers.size === 1) {
        // locked on your character while open: one finger orbits around
        // you (no ghost/spectator pan); free pan only while invisible
        gesture = { type: this.followPos ? "orbit"
          : (e.button === 2 || e.ctrlKey) ? "orbit" : "pan" };
      }
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", e => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture && gesture.type === "two" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.cam.dist = Math.min(420, Math.max(70, gesture.dist0 * (gesture.d0 / d)));
        this.cam.theta = gesture.theta0 + (ang - gesture.a0);
        this.cam.elev = Math.min(1.25, Math.max(0.22,
          gesture.elev0 + ((a.y + b.y) / 2 - gesture.midY0) * 0.004));
        this.applyCamera();
      } else if (gesture && gesture.type === "orbit") {
        this.cam.theta -= (e.clientX - prev.x) * 0.006;
        this.cam.elev = Math.min(1.25, Math.max(0.22, this.cam.elev + (e.clientY - prev.y) * 0.004));
        this.applyCamera();
      } else if (gesture && gesture.type === "pan") {
        this.observing = true; // free observer mode until recenter
        const k = this.cam.dist * 0.0016;
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        const sin = Math.sin(this.cam.theta), cos = Math.cos(this.cam.theta);
        this.target.x += (-cos * dx - sin * dy) * k;
        this.target.z += (sin * dx - cos * dy) * k;
        this.target.x = Math.max(-1100, Math.min(1100, this.target.x));
        this.target.z = Math.max(-1100, Math.min(1100, this.target.z));
        this.applyCamera();
      }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && gesture && gesture.type === "two") {
        gesture = pointers.size === 1 ? { type: "pan" } : null;
      }
      if (!pointers.size) {
        gesture = null;
        el.style.cursor = "grab";
      }
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

  lastT: 0,

  tick() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.2, t - this.lastT || 0.016);
    this.lastT = t;

    // animate characters: walking movement + idle/waddle cycles
    if (this.chars.size) this.needsRender = true;
    for (const rec of this.chars) {
      if (rec.walkTarget) {
        const gp = rec.api.group.position;
        const d = new THREE.Vector3().subVectors(rec.walkTarget, gp);
        d.y = 0;
        const dist = d.length();
        if (dist < 0.4) {
          rec.walkTarget = null;
          rec.api.walking = false;
        } else {
          rec.api.walking = true;
          rec.api.group.rotation.y = Math.atan2(d.x, d.z);
          d.normalize().multiplyScalar(Math.min(dist, dt * 16));
          gp.add(d);
        }
      }
      rec.api.tick(t);
      rec.shadow.position.set(rec.api.group.position.x, 0.42, rec.api.group.position.z);
    }

    // glide the camera target home — unless the user is roaming free
    if (!this.observing) {
      const goal = this.followPos ?? new THREE.Vector3(0, 0, 0);
      if (this.target.distanceTo(goal) > 0.5) {
        this.target.lerp(goal, 0.18);
        this.applyCamera();
      }
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
