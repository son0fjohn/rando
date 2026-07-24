// Rando 3D world: low-poly flat-shaded scene with an orbit camera locked
// to your avatar (PoGo-style: rotate, tilt, zoom — the avatar keeps its
// screen spot, the world moves). Characters are billboards of the same
// relit renders used everywhere else. DOM bubbles/tags anchor to 3D
// points via projection each tick.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { makeCharacter, makeGLBCharacter, makeGLBCharacterSync, loadGLBTemplate } from "./character3d.js";
import { THEME } from "./theme.js";

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
  return new THREE.Vector3(x, terrainY(x, z), z);
}

// ---- hillside terrain (grocery-street reference): Namsan rises to the
// north-west, ground falls gently south toward the river, light rolling
// noise elsewhere. Gameplay plazas blend flat so gathering areas stay level.
const sstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
function rawTerrain(x, z) {
  const nw = (-z) * 0.8 + (-x) * 0.5;
  let h = 34 * sstep((nw - 260) / 480);
  h -= 14 * sstep((z - 320) / 420);
  h += 5 * Math.sin(x * 0.0055 + 1.7) * Math.sin(z * 0.0047 - 0.4);
  return h;
}
let TERRAIN_ANCHORS = null; // lazy: ZONE_FLAVOR is declared further down
export function terrainY(x, z) {
  TERRAIN_ANCHORS ??= ZONE_FLAVOR.map(f => {
    const mLat = 110540.0, mLng = 111320.0 * Math.cos(GEO_CENTER[0] * Math.PI / 180);
    return { x: (f.lng - GEO_CENTER[1]) * mLng * GEO_SCALE,
             z: -(f.lat - GEO_CENTER[0]) * mLat * GEO_SCALE };
  });
  let h = rawTerrain(x, z);
  for (const a of TERRAIN_ANCHORS) {
    const d = Math.hypot(x - a.x, z - a.z);
    if (d < 110) {
      const t = sstep(d / 110);
      h = rawTerrain(a.x, a.z) * (1 - t) + h * t;
    }
  }
  return h;
}

// NPCs at real spots: one pair in Gyeongnidan, one by Itaewon station.
const NPC_DEFS = [
  { id: "npc-silver",  name: "Rae",  lat: 37.5390, lng: 126.9884, partner: "npc-dreads",
    preset: { body: "grey",   eyes: "sleepy",  head: "floppyears" } },
  { id: "npc-dreads",  name: "Miro", lat: 37.5389, lng: 126.9892, partner: "npc-silver",
    preset: { body: "navy",   eyes: "default", iris: "brown", head: "teardrop" } },
  { id: "npc-buzzcut", name: "Jun",  lat: 37.5349, lng: 126.9951, partner: "npc-cans",
    preset: { body: "red",    eyes: "anime",   iris: "orange", head: "smallspikes" } },
  { id: "npc-cans",    name: "Koa",  lat: 37.5347, lng: 126.9958, partner: "npc-buzzcut",
    preset: { body: "orange", eyes: "spiral",  head: "notailspike" } },
];

// day/night mode: auto from local time, ?mode=night|day overrides.
// Palettes are the law from assets/world/STYLE.md.
const modeParam = new URLSearchParams(location.search).get("mode");
const hourNow = new Date().getHours();
export const NIGHT = modeParam === "night" ||
  (modeParam !== "day" && (hourNow >= 19 || hourNow < 6.5));
// ONE lighting rig for every scene, from theme.js — plus per-mode extras
const L = NIGHT ? THEME.lighting.night : THEME.lighting.day;
const M = {
  ...L,
  grass: NIGHT ? 0x3f4a42 : 0x8a9a6a,
  road: NIGHT ? 0x474c59 : 0x9d998e,
  winCol: NIGHT ? 0x2e2a22 : 0x9db4c8,
  winEmis: NIGHT ? 0xffc86e : 0x000000,
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
    // console-render pixel look (grocery-street reference): render at a
    // fraction of native res and upscale with hard pixels. ?pix=0 disables.
    const PIX = new URLSearchParams(location.search).get("pix") !== "0";
    this.renderer = new THREE.WebGLRenderer({ antialias: !PIX });
    this.renderer.setPixelRatio(PIX ? 0.5 : Math.min(2, devicePixelRatio));
    this.renderer.setSize(w, h);
    if (PIX) this.renderer.domElement.style.imageRendering = "pixelated";
    // NOTE: real shadow mapping is disabled — it renders in isolated
    // scenes but never from a cold boot of the full app scene (unresolved
    // three.js state issue). Crisp BAKED shadows below match the cel
    // reference deterministically on every device instead.
    this.renderer.shadowMap.enabled = false;
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
    this.sun = sun;

    this.buildTerrain();
    this.scene.add(this.zoneRings);
    this.remoteGroup = new THREE.Group();
    this.scene.add(this.remoteGroup);
    const spawnNpcs = () => {
      for (const n of NPC_DEFS) {
        const pos = geoPos(n.lat, n.lng);
        const api = GLB_MODE ? makeGLBCharacterSync(n.preset) ?? undefined : undefined;
        const rec = this.makeChar(n.preset, pos, this.scene, api, n.name);
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
        new THREE.MeshBasicMaterial({ color: NIGHT ? 0x030b25 : 0x3072c7, fog: false }));
      cap.rotation.x = Math.PI / 2;
      cap.position.y = 1725;
      this.scene.add(cap);
    });

    // ground: concrete paving within Itaewon proper (the reference's urban
    // floor), grass outside. The paved disc sits a hair above the grass
    // plane with a pale curb ring marking the transition.
    const PAVED_R = 720;
    const groundMat = new THREE.MeshLambertMaterial({ color: M.grass });
    const gg = new THREE.PlaneGeometry(3000, 3000, 100, 100);
    gg.rotateX(-Math.PI / 2);
    const gp = gg.attributes.position;
    for (let i = 0; i < gp.count; i++) gp.setY(i, terrainY(gp.getX(i), gp.getZ(i)));
    gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, groundMat);
    this.scene.add(ground);
    this.loadImage("world2/road_grass.jpg").then(img => {
      const tex = this.mirrorBlockTex(img, [0.03, 0.03, 0.30, 0.30]);
      tex.repeat.set(38, 38); // block ≈ 80u of ground per repeat
      groundMat.map = tex;
      groundMat.color.set(NIGHT ? THEME.world.grassNight : THEME.world.grassDay);
      groundMat.needsUpdate = true;
      this.needsRender = true;
    }).catch(() => {});
    this.loadImage("world2/road_plaza.jpg").then(img => {
      const tex = this.mirrorBlockTex(img, [0.05, 0.05, 0.27, 0.27]);
      // polar-grid disc with per-vertex terrain height (a CircleGeometry
      // fan can't follow slopes)
      const rings = 30, segs = 80;
      const pos = [], uvs = [], idx = [];
      for (let r = 0; r <= rings; r++) {
        for (let sgi = 0; sgi <= segs; sgi++) {
          const a = (sgi / segs) * Math.PI * 2, rr = (r / rings) * PAVED_R;
          const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          pos.push(x, terrainY(x, z) + 0.14, z);
          uvs.push(x / PAVED_R * 26 + 0.5, z / PAVED_R * 26 + 0.5);
        }
      }
      for (let r = 0; r < rings; r++) {
        for (let sgi = 0; sgi < segs; sgi++) {
          const a = r * (segs + 1) + sgi, b = a + segs + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const pgeo = new THREE.BufferGeometry();
      pgeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      pgeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      pgeo.setIndex(idx);
      pgeo.computeVertexNormals();
      const paved = new THREE.Mesh(pgeo, new THREE.MeshLambertMaterial({ map: tex,
        color: NIGHT ? THEME.world.pavingNight : THEME.world.pavingDay }));
      this.scene.add(paved);
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
          const y1 = terrainY(x, z), y2 = terrainY(x2, z2);
          const slopeLen = Math.hypot(len, y2 - y1);
          const g = new THREE.BoxGeometry(w, 0.5, slopeLen);
          // scale v so the asphalt texture repeats every ~26u along the road
          const uv = g.attributes.uv;
          for (let ui = 0; ui < uv.count; ui++) uv.setY(ui, uv.getY(ui) * (len / 26));
          const pitch = Math.asin((y2 - y1) / slopeLen);
          g.applyMatrix4(new THREE.Matrix4().makeRotationY(ang)
            .multiply(new THREE.Matrix4().makeRotationX(-pitch))
            .setPosition((x + x2) / 2, (y1 + y2) / 2 + 0.25, (z + z2) / 2));
          roadGeos.push(g);
          const steps = Math.max(1, Math.floor(len / 22));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps, px = x + dx * t, pz = z + dz * t;
            mark(px, pz);
            if (road.t !== "pedestrian") candidates.push({ x: px, z: pz, ang, w });
          }
        }
        if (i > 0 && i < pts.length - 1) {
          // taller joint bridges slope seams between tilted segments
          const jg = new THREE.CylinderGeometry(w / 2, w / 2, 2.4, 10);
          jg.applyMatrix4(new THREE.Matrix4().setPosition(x, terrainY(x, z) - 0.6, z));
          jointGeos.push(jg);
        }
      }
    }
    // ribbons carry the tile's road-strip art (curbs + dashes run along v);
    // junction discs stay flat asphalt so the strip never smears radially
    const roadMat = new THREE.MeshLambertMaterial({ color: M.road });
    const roadMesh = new THREE.Mesh(mergeGeometries(roadGeos), roadMat);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);
    const jointMat = new THREE.MeshLambertMaterial({ color: M.road });
    this.scene.add(new THREE.Mesh(mergeGeometries(jointGeos), jointMat));
    // plain asphalt for ribbons and junctions alike — no painted lines,
    // one dash-free crop shared so brightness always matches (straight
    // repeat: mirroring asphalt grain makes herringbone streaks)
    this.loadImage("world2/road_grass.jpg").then(img => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img,
        0.545 * img.width, 0.75 * img.height, 0.027 * img.width, 0.20 * img.height,
        0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      for (const mat of [roadMat, jointMat]) {
        mat.map = tex;
        mat.color.set(NIGHT ? THEME.world.roadNight : THEME.world.roadDay);
        if (NIGHT) { // walkable path must read instantly against dark blocks
          mat.emissive = new THREE.Color(0x272e48);
          mat.emissiveIntensity = 1;
        }
        mat.needsUpdate = true;
      }
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
    const loadPiece = async (url, h, glow, theme = true) => {
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
      // theme pass: desaturate + gently lift every model's baked texture so
      // warm/saturated assets fall in line with the muted cool palette
      // (buildings get a stronger pull than trees)
      if (theme && mat.map?.image) {
        // 1024 cap: full-res processed copies of every model texture
        // exhaust mobile browser memory (crash-on-phone class of bug)
        const im = mat.map.image;
        const c = document.createElement("canvas");
        c.width = c.height = Math.min(1024, im.width);
        const cc = c.getContext("2d");
        cc.filter = glow ? "saturate(0.74) brightness(1.05)" : "saturate(0.8)";
        cc.drawImage(im, 0, 0, c.width, c.height);
        const themed = new THREE.CanvasTexture(c);
        themed.colorSpace = THREE.SRGBColorSpace;
        themed.flipY = false;
        mat.map = themed;
        im.close?.(); // free the decoded original (tens of MB per model)
      }
      if (NIGHT) {
        // dim the body, then glow ONLY the bright texture areas (windows,
        // glass, signage) via a contrast-crushed warm emissive map — walls
        // fall dark, windows read lit, giving the night skyline depth
        mat.color = new THREE.Color(glow ? 0x6f7c92 : 0x76879c);
        if (glow && mat.map?.image) {
          const im = mat.map.image;
          const c = document.createElement("canvas");
          c.width = c.height = 512; // soft glow needs no detail; keep RAM low
          const cc = c.getContext("2d");
          // windows/glass are the DARK pixels on these models — invert so
          // they glow and the pale walls stay unlit
          cc.filter = "grayscale(1) invert(1) contrast(2.6) brightness(0.62)";
          cc.drawImage(im, 0, 0, c.width, c.height);
          const em = new THREE.CanvasTexture(c);
          em.colorSpace = THREE.SRGBColorSpace;
          em.flipY = false;
          mat.emissive = new THREE.Color(0xffd9a0);
          mat.emissiveMap = em;
          mat.emissiveIntensity = 0.85;
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
    // ---- real Itaewon: OSM building footprints extruded as flat-shaded
    // low-poly prisms with bold outlines. ~25 tris per building merged
    // into one mesh per color bucket, so 2000 real buildings cost less
    // than ten of the smooth GLB models did. GLB heroes stay as landmarks.
    // hero landmarks (Street View -> Tripo reconstructions). Loaded first
    // so their clear-radius suppresses the generic prisms beneath them.
    let landmarks = [];
    try {
      landmarks = (await (await fetch("landmarks.json")).json()).landmarks
        .filter(l => l.lat != null && l.lng != null) // pending-pin entries stay parked
        .map(l => ({ ...l, pos: geoPos(l.lat, l.lng) }));
    } catch { /* optional */ }
    const nearLandmark = (x, z) => landmarks.some(l =>
      l.glb && (x - l.pos.x) ** 2 + (z - l.pos.z) ** 2 < l.clear * l.clear);

    let footprints = 0;
    try {
      const bdata = await (await fetch("buildings.json")).json();
      const wallCols = THEME.walls; // warm desaturated family (style lock)
      const wallGeos = wallCols.map(() => []);
      const roofGeos = wallCols.map(() => []);
      const shadowGeos = [];
      const decorLots = []; // road-facing lots for the decoration pass
      for (const b of bdata.buildings) {
        const poly = b.p;
        let cx = 0, cz = 0;
        for (const [x, z] of poly) { cx += x; cz += z; }
        cx /= poly.length; cz /= poly.length;
        if (nearZoneCenter(cx, cz, 58)) continue; // keep gathering plazas open
        if (nearLandmark(cx, cz)) continue;       // hero model owns this plot
        let rad = 0;
        for (const [x, z] of poly) rad = Math.max(rad, Math.hypot(x - cx, z - cz));
        occupy(cx, cz, Math.min(rad, 40));
        // stamp all covered cells so trees never sprout through roofs
        for (let mx = cx - rad; mx <= cx + rad; mx += 25) {
          for (let mz = cz - rad; mz <= cz + rad; mz += 25) mark(mx, mz);
        }
        const v2s = poly.map(([x, z]) => new THREE.Vector2(x, -z));
        if (THREE.ShapeUtils.area(v2s) < 0) v2s.reverse(); // CCW: walls face out
        const baseY = terrainY(cx, cz) - 1.2;
        const bi = Math.abs(Math.round(cx * 7 + cz * 13)) % wallCols.length;
        // walls as explicit quads: u follows the contour (one texture tile
        // per ~13u = 4 windows), v climbs floors — so the window grid tiles
        // at true scale and doubles as the night lit-window emissive map
        {
          const wpos = [], wuv = [];
          let u0 = (cx + cz) * 0.07; // desync the grid between buildings
          for (let e = 0; e < v2s.length; e++) {
            const a = v2s[e], c2 = v2s[(e + 1) % v2s.length];
            const ax = a.x, az = -a.y, bx2 = c2.x, bz2 = -c2.y;
            const u1 = u0 + Math.hypot(bx2 - ax, bz2 - az) / 13;
            const vTop = b.h / 10.4;
            wpos.push(ax, baseY, az, bx2, baseY, bz2, bx2, baseY + b.h, bz2,
                      ax, baseY, az, bx2, baseY + b.h, bz2, ax, baseY + b.h, az);
            wuv.push(u0, 0, u1, 0, u1, vTop, u0, 0, u1, vTop, u0, vTop);
            u0 = u1;
          }
          const wg = new THREE.BufferGeometry();
          wg.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3));
          wg.setAttribute("uv", new THREE.Float32BufferAttribute(wuv, 2));
          wallGeos[bi].push(wg);
        }
        {
          const tris = THREE.ShapeUtils.triangulateShape(v2s, []);
          const rpos = [];
          for (const t of tris) {
            for (const vi of t) rpos.push(v2s[vi].x, baseY + b.h, -v2s[vi].y);
          }
          const rg = new THREE.BufferGeometry();
          rg.setAttribute("position", new THREE.Float32BufferAttribute(rpos, 3));
          roofGeos[bi].push(rg);
        }
        decorLots.push({ poly, cx, cz, h: b.h });
        // baked cast shadow: footprint swept along the sun direction by a
        // height-scaled offset (crisp cel-style shadow, zero runtime cost)
        {
          const k = Math.min(52, 6 + b.h * 0.95);
          const off = [-0.52 * k, -0.34 * k]; // sun from (+x,+z) high east
          const base = poly.map(([x, z]) => new THREE.Vector2(x, -z));
          if (THREE.ShapeUtils.area(base) < 0) base.reverse();
          const quads = [];
          const shv = (X, Z) => { quads.push(X, terrainY(X, Z) + 0.5, Z); };
          for (let e = 0; e < base.length; e++) {
            const a = base[e], b2 = base[(e + 1) % base.length];
            shv(a.x, -a.y); shv(b2.x, -b2.y); shv(b2.x + off[0], -b2.y - off[1]);
            shv(a.x, -a.y); shv(b2.x + off[0], -b2.y - off[1]); shv(a.x + off[0], -a.y - off[1]);
          }
          const capTris = THREE.ShapeUtils.triangulateShape(
            base.map(v => new THREE.Vector2(v.x + off[0], v.y + off[1])), []);
          for (const t of capTris) {
            for (const vi of t) shv(base[vi].x + off[0], -base[vi].y - off[1]);
          }
          const sg = new THREE.BufferGeometry();
          sg.setAttribute("position", new THREE.Float32BufferAttribute(quads, 3));
          shadowGeos.push(sg);
        }
        footprints++;
      }
      if (shadowGeos.length) {
        const sm = new THREE.Mesh(mergeGeometries(shadowGeos),
          new THREE.MeshBasicMaterial({ color: 0x241c12, transparent: true,
            opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
        this.scene.add(sm); // heights baked per-vertex against the terrain
      }
      const lineMat = new THREE.LineBasicMaterial({
        color: NIGHT ? 0x39435c : 0x6b675e, transparent: true, opacity: 0.5 });
      // window-grid facade: near-white walls (bucket color multiplies) with
      // dark glass by day; at night the same grid becomes the emissive map
      // with a random warm subset of windows lit (Splatoon-square mood)
      const facade = (() => {
        const day = document.createElement("canvas");
        day.width = day.height = 256;
        const gd = day.getContext("2d");
        gd.fillStyle = "#f2efe8";
        gd.fillRect(0, 0, 256, 256);
        const night = document.createElement("canvas");
        night.width = night.height = 256;
        const gn = night.getContext("2d");
        gn.fillStyle = "#05070d";
        gn.fillRect(0, 0, 256, 256);
        const wrand = mulberry32(515);
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const wx = 10 + c * 62, wy = 8 + r * 62;
            gd.fillStyle = "#59606c";
            gd.fillRect(wx, wy, 42, 34);
            gd.fillStyle = "rgba(255,255,255,0.3)";
            gd.fillRect(wx, wy + 13, 42, 4);
            gn.fillStyle = "#10141f";
            gn.fillRect(wx, wy, 42, 34);
          }
        }
        // sparse lit-window variants: lighting should be purposeful, not a
        // uniform glow — most windows stay dark, a few glow per building
        const mkNight = prob => {
          const c = document.createElement("canvas");
          c.width = c.height = 256;
          const g3 = c.getContext("2d");
          g3.drawImage(night, 0, 0);
          for (let r = 0; r < 4; r++) {
            for (let cc = 0; cc < 4; cc++) {
              if (wrand() < prob) {
                g3.fillStyle = ["#ffd98f", "#ffc76a", "#ffe7b0"][Math.floor(wrand() * 3)];
                g3.fillRect(10 + cc * 62 - 1, 8 + r * 62 - 1, 44, 36);
              }
            }
          }
          return c;
        };
        const nightA = mkNight(0.17), nightB = mkNight(0.06);
        const mk = c => {
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.magFilter = THREE.NearestFilter;
          return t;
        };
        return { day: mk(day), nightA: mk(nightA), nightB: mk(nightB) };
      })();
      const NIGHT_WALL = new THREE.Color(0.36, 0.42, 0.60); // blue moonlight
      const risers = [];
      wallGeos.forEach((arr, i) => {
        if (!arr.length) return;
        const merged = mergeGeometries(arr);
        merged.computeVertexNormals();
        const col = new THREE.Color(wallCols[i]);
        if (NIGHT) col.multiply(NIGHT_WALL);
        const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({
          color: col, map: facade.day, side: THREE.DoubleSide,
          emissive: NIGHT ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
          emissiveMap: i % 2 ? facade.nightB : facade.nightA,
          emissiveIntensity: NIGHT ? 0.85 : 0,
        }));
        this.scene.add(mesh);
        const rmerged = mergeGeometries(roofGeos[i]);
        rmerged.computeVertexNormals();
        const rcol = new THREE.Color(wallCols[i]).multiplyScalar(0.8);
        if (NIGHT) rcol.multiply(NIGHT_WALL);
        const roof = new THREE.Mesh(rmerged, new THREE.MeshLambertMaterial({
          color: rcol, side: THREE.DoubleSide }));
        this.scene.add(roof);
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 40), lineMat);
        this.scene.add(outline);
        risers.push([mesh, outline], [roof, roof]);
      });
      // loading flourish: each bucket rises from the ground, staggered.
      // Driven from tick() (interval-backed) so it also completes in
      // throttled tabs; costs ~1.5s of scale updates, nothing afterwards.
      risers.forEach(([m, o]) => { m.scale.y = 0.001; o.scale.y = 0.001; });
      this.risers = { t0: performance.now(), items: risers };
      console.log(`[rando] OSM footprints: ${footprints} buildings`);

      // ---- street density pass (grocery-street reference): awnings,
      // abstract sign panels (no text), rooftop ACs, power poles with
      // sagging wires, bins/cones. Everything deterministic + merged.
      const drand = mulberry32(9107);
      // coarse index of road points for nearest-road lookups
      const roadIdx = new Map();
      const RCELL = 40;
      for (const c of candidates) {
        const k = Math.floor(c.x / RCELL) + "," + Math.floor(c.z / RCELL);
        if (!roadIdx.has(k)) roadIdx.set(k, []);
        roadIdx.get(k).push(c);
      }
      const nearestRoad = (x, z) => {
        let best = null, bd = 1e9;
        const bx = Math.floor(x / RCELL), bz = Math.floor(z / RCELL);
        for (let i = bx - 1; i <= bx + 1; i++) {
          for (let j = bz - 1; j <= bz + 1; j++) {
            for (const c of roadIdx.get(i + "," + j) ?? []) {
              const d = (c.x - x) ** 2 + (c.z - z) ** 2;
              if (d < bd) { bd = d; best = c; }
            }
          }
        }
        return bd < 45 * 45 ? best : null;
      };
      const AWN_COLS = [0x4f9d8f, 0xc95f4e, 0xd9a83c, 0xe8e2d4];
      const SIGN_COLS = [0x3f8f82, 0xd97b3c, 0xe0c33a, 0xba4a44, 0x5a7fa8];
      const awnGeos = AWN_COLS.map(() => []);
      const signGeos = SIGN_COLS.map(() => []);
      const acGeos = [];
      const poleGeos = [];
      const lampGeos = [];
      const lanternGeos = [];
      const poolGeos = [];
      const wirePts = [];
      const clutterGeos = { bin: [], cone: [] };
      let awnings = 0;
      for (const lot of decorLots) {
        const road = nearestRoad(lot.cx, lot.cz);
        const seed = Math.abs(Math.round(lot.cx * 3 + lot.cz * 11));
        // rooftop AC boxes on most buildings
        if (seed % 3 !== 0) {
          const jx = ((seed % 7) - 3) * 0.6, jz = ((seed % 5) - 2) * 0.6;
          const ac = new THREE.BoxGeometry(2.0, 1.3, 1.6);
          ac.applyMatrix4(new THREE.Matrix4().makeRotationY(seed % 2 ? 0.4 : -0.2)
            .setPosition(lot.cx + jx, terrainY(lot.cx, lot.cz) - 1.2 + lot.h + 0.65, lot.cz + jz));
          acGeos.push(ac);
        }
        if (!road || awnings > 520) continue;
        // road-facing edge: polygon edge whose midpoint is closest to road
        let edge = null, ed = 1e9;
        for (let i = 0; i < lot.poly.length; i++) {
          const [x1, z1] = lot.poly[i], [x2, z2] = lot.poly[(i + 1) % lot.poly.length];
          const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
          const d = (mx - road.x) ** 2 + (mz - road.z) ** 2;
          if (d < ed) { ed = d; edge = [x1, z1, x2, z2, mx, mz]; }
        }
        const [x1, z1, x2, z2, mx, mz] = edge;
        const elen = Math.hypot(x2 - x1, z2 - z1);
        if (elen < 5) continue;
        const eang = Math.atan2(x2 - x1, z2 - z1);
        // outward = from centroid toward edge midpoint
        let ox = mx - lot.cx, oz = mz - lot.cz;
        const on = Math.hypot(ox, oz) || 1;
        ox /= on; oz /= on;
        // awning: sloped strip over the storefront
        if (drand() < 0.6) {
          awnings++;
          const aw = new THREE.BoxGeometry(Math.min(elen * 0.86, 24), 0.45, 3.1);
          const m = new THREE.Matrix4().makeRotationY(eang)
            .multiply(new THREE.Matrix4().makeRotationX(0.24));
          m.setPosition(mx + ox * 1.5, terrainY(mx, mz) + 6.8, mz + oz * 1.5);
          aw.applyMatrix4(m);
          awnGeos[seed % AWN_COLS.length].push(aw);
        }
        // abstract sign panel on the upper face (no text, accent color)
        if (lot.h > 12 && drand() < 0.55) {
          const sg = new THREE.BoxGeometry(0.35, 3.6, 2.1);
          const t = (drand() - 0.5) * elen * 0.5;
          const sx = mx + Math.sin(eang) * t + ox * 0.4;
          const sz = mz + Math.cos(eang) * t + oz * 0.4;
          const m = new THREE.Matrix4().makeRotationY(eang);
          m.setPosition(sx, terrainY(sx, sz) + 9.5 + drand() * (lot.h - 11), sz);
          sg.applyMatrix4(m);
          signGeos[seed % SIGN_COLS.length].push(sg);
        }
        // street clutter near the road edge
        if (drand() < 0.1) {
          const cx2 = road.x + ox * (road.w / 2 + 1.5), cz2 = road.z + oz * (road.w / 2 + 1.5);
          if (drand() < 0.6) {
            const bin = new THREE.CylinderGeometry(1.0, 0.9, 2.4, 8);
            bin.applyMatrix4(new THREE.Matrix4().setPosition(cx2, terrainY(cx2, cz2) + 1.2, cz2));
            clutterGeos.bin.push(bin);
          } else {
            const cone = new THREE.ConeGeometry(0.7, 1.7, 8);
            cone.applyMatrix4(new THREE.Matrix4().setPosition(cx2, terrainY(cx2, cz2) + 0.85, cz2));
            clutterGeos.cone.push(cone);
          }
        }
      }
      // power poles + sagging wires along roads
      const polesPlaced = [];
      const farFromPoles = (x, z) => polesPlaced.every(p => (p.x - x) ** 2 + (p.z - z) ** 2 > 80 * 80);
      for (const c of candidates) {
        if (c.w < 11 || !farFromPoles(c.x, c.z) || polesPlaced.length > 220) continue;
        const px = c.x + Math.cos(c.ang) * (c.w / 2 + 2.2);
        const pz = c.z - Math.sin(c.ang) * (c.w / 2 + 2.2);
        const py = terrainY(px, pz);
        const pole = new THREE.CylinderGeometry(0.32, 0.4, 23, 6);
        pole.applyMatrix4(new THREE.Matrix4().setPosition(px, py + 11.5, pz));
        poleGeos.push(pole);
        // street lamp head on alternating poles + warm light pool at night
        if (polesPlaced.length % 3 === 0) {
          const head = new THREE.SphereGeometry(1.15, 8, 6);
          head.applyMatrix4(new THREE.Matrix4().setPosition(px, py + 21.8, pz));
          lampGeos.push(head);
          const pool = new THREE.CircleGeometry(9, 20);
          pool.rotateX(-Math.PI / 2);
          pool.translate(px, py + 0.62, pz);
          poolGeos.push(pool);
        }
        // wire to the nearest earlier pole within reach, with sag
        let near = null, nd = 1e9;
        for (const p of polesPlaced) {
          const d = (p.x - px) ** 2 + (p.z - pz) ** 2;
          if (d < nd) { nd = d; near = p; }
        }
        if (near && nd < 130 * 130) {
          const nearY = terrainY(near.x, near.z);
          // paper lanterns: only some spans, one per span — sparse on purpose
          for (const lt of (polesPlaced.length % 3 === 1 ? [0.5] : [])) {
            const lx = px + (near.x - px) * lt, lz = pz + (near.z - pz) * lt;
            const ly = 22.2 + py + (nearY - py) * lt - Math.sin(lt * Math.PI) * 2.6 - 1.4;
            const lg = new THREE.SphereGeometry(0.95, 8, 6);
            lg.scale(1, 1.25, 1);
            lg.translate(lx, ly, lz);
            lanternGeos.push(lg);
            wirePts.push(lx, ly + 1.1, lz, lx, ly + 2.4, lz); // string
          }
          for (const wy of [22.2, 20.6]) {
            const SEG = 7;
            for (let s = 0; s < SEG; s++) {
              const t0 = s / SEG, t1 = (s + 1) / SEG;
              const sag = t => wy + py + (nearY - py) * t - Math.sin(t * Math.PI) * 2.6;
              wirePts.push(
                px + (near.x - px) * t0, sag(t0), pz + (near.z - pz) * t0,
                px + (near.x - px) * t1, sag(t1), pz + (near.z - pz) * t1);
            }
          }
        }
        polesPlaced.push({ x: px, z: pz });
      }
      const addMerged = (arr, mat) => {
        if (arr.length) this.scene.add(new THREE.Mesh(mergeGeometries(arr), mat));
      };
      awnGeos.forEach((arr, i) => addMerged(arr, new THREE.MeshLambertMaterial({
        color: NIGHT ? new THREE.Color(AWN_COLS[i]).multiplyScalar(0.5) : AWN_COLS[i], flatShading: true })));
      signGeos.forEach((arr, i) => addMerged(arr, new THREE.MeshLambertMaterial({
        color: NIGHT ? new THREE.Color(SIGN_COLS[i]).multiplyScalar(0.65) : SIGN_COLS[i],
        emissive: NIGHT ? SIGN_COLS[i] : 0x000000, emissiveIntensity: NIGHT ? 0.28 : 0 })));
      addMerged(acGeos, new THREE.MeshLambertMaterial({ color: NIGHT ? 0x5a5f6a : 0xb9bcc0, flatShading: true }));
      addMerged(poleGeos, new THREE.MeshLambertMaterial({ color: NIGHT ? 0x2c2a26 : 0x5d564c }));
      addMerged(lampGeos, new THREE.MeshLambertMaterial({
        color: NIGHT ? 0xfff0c0 : 0xf2ead8,
        emissive: NIGHT ? 0xffd685 : 0x000000, emissiveIntensity: NIGHT ? 1.3 : 0 }));
      addMerged(lanternGeos, new THREE.MeshLambertMaterial({
        color: NIGHT ? 0xffe2a0 : 0xf4e4c8,
        emissive: NIGHT ? 0xffc96e : 0x000000, emissiveIntensity: NIGHT ? 1.5 : 0 }));
      if (NIGHT && poolGeos.length) {
        this.scene.add(new THREE.Mesh(mergeGeometries(poolGeos),
          new THREE.MeshBasicMaterial({ color: 0xffb95e, transparent: true,
            opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })));
      }
      addMerged(clutterGeos.bin, new THREE.MeshLambertMaterial({ color: NIGHT ? 0x3a4a62 : 0x4c6a80 }));
      addMerged(clutterGeos.cone, new THREE.MeshLambertMaterial({ color: NIGHT ? 0x8a4a20 : 0xe07b35 }));
      if (wirePts.length) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute("position", new THREE.Float32BufferAttribute(wirePts, 3));
        this.scene.add(new THREE.LineSegments(wg,
          new THREE.LineBasicMaterial({ color: 0x2f2b26, transparent: true, opacity: 0.75 })));
      }
      console.log(`[rando] decor: ${awnings} awnings, ${acGeos.length} ACs, ${polesPlaced.length} poles`);
    } catch (e) {
      console.warn("buildings.json unavailable — generic placement fallback", e);
    }

    // landmark texture treatment: reconstructed Street View textures are
    // photographic (real signage, photo grain). Posterize to flat color
    // blocks + soften fine detail so signs become illegible abstract
    // patches in the locked cel style. No generation step, no credits.
    const celTexture = (tex) => {
      if (!tex?.image) return tex;
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const cc = c.getContext("2d");
      // stylize-then-reconstruct landmarks already carry the locked
      // palette — soften + posterize only, no further desaturation
      cc.filter = "blur(1.2px)";
      cc.drawImage(tex.image, 0, 0, c.width, c.height);
      cc.filter = "none";
      const id = cc.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {   // 6-level posterize
        d[i] = Math.round(d[i] / 42.5) * 42.5;
        d[i + 1] = Math.round(d[i + 1] / 42.5) * 42.5;
        d[i + 2] = Math.round(d[i + 2] / 42.5) * 42.5;
      }
      cc.putImageData(id, 0, 0);
      const out = new THREE.CanvasTexture(c);
      out.colorSpace = THREE.SRGBColorSpace;
      out.flipY = tex.flipY;
      return out;
    };

    // place hero landmark models at their real coordinates. The low-poly
    // style is a MATERIAL pass on the reconstructed geometry: flatten
    // normals (faceted shading) + cel-posterized texture + outline.
    for (const l of landmarks) {
      if (!l.glb || !lib) continue;
      try {
        const piece = await loadPiece(l.glb, l.h, true, false);
        piece.mat.map = celTexture(piece.mat.map);
        const geo = piece.geo.clone();
        // faceted shading: drop smooth normals, let flatShading rebuild
        geo.deleteAttribute("normal");
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
          map: piece.mat.map, flatShading: true,
          color: piece.mat.color ?? 0xffffff,
        }));
        mesh.position.copy(l.pos);
        mesh.rotation.y = (l.yaw ?? 0) * Math.PI / 180;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 34),
          new THREE.LineBasicMaterial({ color: NIGHT ? 0x2b3441 : 0x5d6b76, transparent: true, opacity: 0.5 }));
        outline.position.copy(mesh.position);
        outline.rotation.copy(mesh.rotation);
        this.scene.add(outline);
        occupy(l.pos.x, l.pos.z, l.clear);
        // nightlife venues ground their light: warm additive pool tinting
        // the street around the hero at night (color from landmarks.json)
        if (NIGHT && l.glow) {
          const R2 = l.clear * 1.7;
          const gcv = document.createElement("canvas");
          gcv.width = gcv.height = 128;
          const gctx = gcv.getContext("2d");
          const grad = gctx.createRadialGradient(64, 64, 6, 64, 64, 64);
          grad.addColorStop(0, l.glow);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          gctx.fillStyle = grad;
          gctx.fillRect(0, 0, 128, 128);
          const gtex = new THREE.CanvasTexture(gcv);
          const rings2 = 10, segs2 = 40, gpos = [], guv = [], gidx = [];
          for (let r = 0; r <= rings2; r++) {
            for (let sg2 = 0; sg2 <= segs2; sg2++) {
              const a = (sg2 / segs2) * Math.PI * 2, rr = (r / rings2) * R2;
              const x = l.pos.x + Math.cos(a) * rr, z = l.pos.z + Math.sin(a) * rr;
              gpos.push(x, terrainY(x, z) + 0.7, z);
              guv.push(0.5 + Math.cos(a) * (r / rings2) * 0.5,
                       0.5 + Math.sin(a) * (r / rings2) * 0.5);
            }
          }
          for (let r = 0; r < rings2; r++) {
            for (let sg2 = 0; sg2 < segs2; sg2++) {
              const a = r * (segs2 + 1) + sg2, b2 = a + segs2 + 1;
              gidx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
            }
          }
          const gg2 = new THREE.BufferGeometry();
          gg2.setAttribute("position", new THREE.Float32BufferAttribute(gpos, 3));
          gg2.setAttribute("uv", new THREE.Float32BufferAttribute(guv, 2));
          gg2.setIndex(gidx);
          this.scene.add(new THREE.Mesh(gg2, new THREE.MeshBasicMaterial({
            map: gtex, transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false })));
        }
        console.log(`[rando] landmark placed: ${l.id}`);
      } catch (e) {
        console.warn(`landmark ${l.id} failed to load`, e);
      }
    }

    // placement: same frontage walk, but each lot picks a model type from
    // zone density (towers only in the urban core, low-rise near plazas).
    // Runs only as a FALLBACK when real footprints are unavailable.
    const inst = { store: [], urban: [], brick: [], pastel: [], tower: [], highrise: [] };
    const MAX_BUILDINGS = 220;
    let placedCount = 0;
    if (lib && !footprints) for (const c of candidates) {
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

    // (zone plazas need no discs now — the whole inner area is paved)

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
        m.setPosition(x, terrainY(x, z) - 0.3, z);
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

  // crisp camera-facing text sprite (labels, name tags) — code-rendered,
  // no assets; scaled in world units, drawn above depth so always legible
  textSprite(text, { size = 15, pad = 10, fg = "#fff", bg = "rgba(24,22,28,0.62)", scale = 1 } = {}) {
    const c = document.createElement("canvas");
    const g2 = c.getContext("2d");
    const font = `600 ${size * 4}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
    g2.font = font;
    const tw = Math.ceil(g2.measureText(text).width);
    c.width = tw + pad * 8;
    c.height = size * 4 + pad * 5;
    const g3 = c.getContext("2d");
    g3.font = font;
    const r = c.height / 2;
    g3.fillStyle = bg;
    g3.beginPath();
    g3.roundRect(0, 0, c.width, c.height, r);
    g3.fill();
    g3.fillStyle = fg;
    g3.textAlign = "center";
    g3.textBaseline = "middle";
    g3.fillText(text, c.width / 2, c.height / 2 + size * 0.28);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, fog: false }));
    sp.renderOrder = 90;
    sp.scale.set((c.width / c.height) * 4.6 * scale, 4.6 * scale, 1);
    return sp;
  },

  registerZones(zones) {
    this.zoneRings.clear();
    for (const z of zones.filter(z => z.kind !== "auto")) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(11, 13.5, 40),
        new THREE.MeshBasicMaterial({ color: 0x8fc2ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      const p = geoPos(z.lat, z.lng);
      ring.position.set(p.x, p.y + 0.35, p.z);
      this.zoneRings.add(ring);
      // floating location label (code text, always faces the camera)
      const label = this.textSprite(z.name ?? z.id, {
        fg: "#ffe9c4", bg: "rgba(30,26,20,0.7)", scale: 1.9 });
      label.position.set(p.x, p.y + 34, p.z);
      this.zoneRings.add(label);
    }
    this.needsRender = true;
  },

  chars: new Set(),      // every live modular character (for animation)
  remoteRecs: [],

  makeChar(avatarCfg, pos, parent, apiOverride, handle) {
    const api = apiOverride ?? makeCharacter(avatarCfg);
    api.group.traverse(o => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = true; });
    if (handle) { // floating username tag above the head
      const tag = this.textSprite(handle, { scale: 0.85 });
      tag.position.set(0, 20.5, 0);
      api.group.add(tag);
    }
    api.group.position.copy(pos);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.25 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(5.4, 2.6, 1);
    shadow.position.set(pos.x, pos.y + 0.42, pos.z);
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
      const rec = this.makeChar(r.avatar, pos, this.remoteGroup, api, r.handle);
      // face roughly inward toward the cluster for a hanging-out feel
      rec.api.group.rotation.y = Math.atan2(-dx, 6);
      rec.meta = { userId: r.userId, handle: r.handle, avatar: r.avatar };
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
  // tap-to-chat: short, drag-free press on a remote character fires
  // onCharTap(meta). Set by backend.js; meta = { userId, handle, avatar }.
  onCharTap: null,
  tryCharTap(clientX, clientY) {
    if (!this.onCharTap || !this.remoteRecs.length) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.remoteRecs.map(x => x.api.group), true);
    if (!hits.length) return;
    let node = hits[0].object;
    while (node) {
      const rec = this.remoteRecs.find(x => x.api.group === node);
      if (rec?.meta?.userId) { this.onCharTap(rec.meta); return; }
      node = node.parent;
    }
  },

  bindControls() {
    const el = this.renderer.domElement;
    const pointers = new Map();
    let gesture = null;
    let press = null;
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("pointerup", e => {
      if (press && pointers.size <= 1 &&
          performance.now() - press.t < 380 &&
          Math.hypot(e.clientX - press.x, e.clientY - press.y) < 9) {
        this.tryCharTap(e.clientX, e.clientY);
      }
      press = null;
    });
    el.addEventListener("pointerdown", e => {
      if (pointers.size === 0) press = { x: e.clientX, y: e.clientY, t: performance.now() };
      else press = null;
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
          gp.y = terrainY(gp.x, gp.z); // hug the hillside mid-walk
        }
      }
      rec.api.tick(t);
      rec.shadow.position.set(rec.api.group.position.x,
        terrainY(rec.api.group.position.x, rec.api.group.position.z) + 0.42,
        rec.api.group.position.z);
    }


    // buildings-rise loading animation (see loadWorld); self-removes when done
    if (this.risers) {
      const RISE = 620, STAG = 110;
      const ease = k => 1 - Math.pow(1 - k, 3);
      const now = performance.now();
      let done = true;
      this.risers.items.forEach(([m, o], i) => {
        const k = Math.min(1, Math.max(0, (now - this.risers.t0 - i * STAG) / RISE));
        const s = Math.max(0.001, ease(k));
        m.scale.y = s;
        o.scale.y = s;
        if (k < 1) done = false;
      });
      this.needsRender = true;
      if (done) this.risers = null;
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
