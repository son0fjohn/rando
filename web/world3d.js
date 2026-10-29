// Rando 3D world: low-poly flat-shaded scene with an orbit camera locked
// to your avatar (PoGo-style: rotate, tilt, zoom — the avatar keeps its
// screen spot, the world moves). Characters are billboards of the same
// relit renders used everywhere else. DOM bubbles/tags anchor to 3D
// points via projection each tick.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { makeCharacter, makeGLBCharacter, makeGLBCharacterSync, loadGLBTemplate } from "./character3d.js";
import { makeHumanCharacter, makeHumanCharacterSync, loadHumanTemplate,
         makeAnimatedCharacter } from "./avatar4.js";
import { staticize, matteify } from "./avatar3.js";
import { THEME } from "./theme.js";
import { CityTiles, cityUniforms, lodTree, treePools, fillPools } from "./citytiles.js";
import { worldHeight, itaewonHill } from "./citygen.js";
import { startDaylight, lightOverride, sunlight } from "./daylight.js";
import { lightAt, sunNow, sunPosition, sunClockFast, localClock, shadowSweep as shadowDir } from "./sun.js";

// generated GLB characters are the default; ?glb=0 falls back to procedural
// character system: the avatar4 clay character by default; ?legacy=glb keeps the old
// animated Tripo GLB, ?legacy=blob the procedural blob (?glb=0 kept as an
// alias of blob for old links)
const LEGACY_CHAR = (() => {
  const q = new URLSearchParams(location.search);
  if (q.get("legacy") === "glb") return "glb";
  if (q.get("legacy") === "blob" || q.get("glb") === "0") return "blob";
  return null;
})();
const GLB_MODE = LEGACY_CHAR === "glb";
// Animated player is the DEFAULT: Tripo-retargeted idle/walk clips with
// runtime weight-transfer garments, wired to movement (walking flag drives
// the crossfade). ?anim=0 falls back to the static bob.
const ANIM_CHAR = new URLSearchParams(location.search).get("anim") !== "0";

export const CHAR_H = 15;

// Geographic world: coordinates ARE real Itaewon geography, projected the
// same way scripts/fetch_roads.py bakes the OSM roads.
const GEO_CENTER = [37.5346, 126.9946]; // Itaewon station (city mode: wherever you are)
const GEO_SCALE = 0.55;                 // world units per metre
// City mode: the map is streamed as procedural city chunks (citytiles.js)
// around wherever you are, instead of the hand-baked Itaewon. ?city=tiles
// turns it on; the first position (or ?at=lat,lng) becomes the origin.
const CITY_Q = new URLSearchParams(location.search);
export const CITY_MODE = CITY_Q.get("city") === "tiles";
const CITY_URL = CITY_Q.get("tiles") || "tiles/cities.pmtiles";
// (a game can switch the map to city mode and back mid-session:
// world3d.enterCity / exitCity; Manhunt plays on the real streets)
let cityOn = CITY_MODE;
const ITAEWON = [GEO_CENTER[0], GEO_CENTER[1]];
// The city anywhere the archive has no chunk: OpenFreeMap's worldwide
// OpenMapTiles (OpenStreetMap, free, no key; web/cityomt.js). ?omt=<TileJSON
// or a {z}/{x}/{y} url> points it elsewhere, ?omt=0 turns it off.
const OMT_URL = CITY_Q.get("omt") === "0" ? null : CITY_Q.get("omt") || "https://tiles.openfreemap.org/planet";
// Near Itaewon the hand-made map stays and the procedural city fills in round
// it (where the hand-made buildings / roads end, world units); further away
// the whole map is the procedural city, centred where you are.
const ITAEWON_KEEP_M = 3000;
const BLEND = { b: 820, r: 1420 };
const metresFrom = (lat, lng, [lat0, lng0]) => Math.hypot((lat - lat0) * 110540, (lng - lng0) * 111320 * Math.cos(lat0 * Math.PI / 180));
let WORLD_EDGE = CITY_MODE ? 12000 : 1050; // far positions clamp to this radius

// world x,z -> [lat, lng] (geoPos's inverse, inside the edge)
export function geoInv(x, z) {
  const mLat = 110540.0, mLng = 111320.0 * Math.cos(GEO_CENTER[0] * Math.PI / 180);
  return [GEO_CENTER[0] - z / (mLat * GEO_SCALE), GEO_CENTER[1] + x / (mLng * GEO_SCALE)];
}

export function geoPos(lat, lng) {
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

// a spot's world x/z with no clamping at the map's edge
function geoPosRaw(lat, lng) {
  const mLat = 110540.0, mLng = 111320.0 * Math.cos(GEO_CENTER[0] * Math.PI / 180);
  return { x: (Number(lng) - GEO_CENTER[1]) * mLng * GEO_SCALE, z: -(Number(lat) - GEO_CENTER[0]) * mLat * GEO_SCALE };
}

// ---- hillside terrain (grocery-street reference): Namsan rises to the
// north-west, ground falls gently south toward the river, light rolling
// noise elsewhere. Gameplay plazas blend flat so gathering areas stay level.
// (the shape itself is citygen.js itaewonHill: the procedural city round
// Itaewon stands on the same hills)
const sstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const rawTerrain = itaewonHill;
let TERRAIN_ANCHORS = null; // lazy: ZONE_FLAVOR is declared further down
// Named districts — how Itaewon is actually navigated ("meet me on World
// Food Street"). Anchors are best-knowledge centers of the real streets;
// nudge coords here if any feel off against the real map.
const DISTRICTS = [
  { name: "World Food Street",    lat: 37.53535, lng: 126.99345, tint: 0xff9a5e },
  { name: "Hooker Hill",          lat: 37.53390, lng: 126.99530, tint: 0xff5d8a },
  { name: "Antique Furniture St", lat: 37.53300, lng: 126.99250, tint: 0xc8a05e },
  { name: "Itaewon-ro",           lat: 37.53460, lng: 126.99420, tint: 0x8ab4ff },
];

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) &&
        x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function terrainY(x, z) {
  if (cityOn) return 0; // no elevation data for the whole world (yet): flat
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

// Archetype quest NPCs — the three mascots, each locked to its real venue.
// Static in place (no roaming); their dynamic idle plays only while the
// player is physically in range (GPS proximity, resolved by backend.js via
// the meetup-confirm readDeviceCoords pattern). glb files are the rigged
// Tripo MVP mascots; rendering is static-mesh + group-level motion, same
// contract as every other character system here.
export const ARCH_NPC_DEFS = [
  { id: "arch-chill",  arch: "chill",  name: "Nabi",
    glb: "npcs/chill.glb",  lat: 37.5349347, lng: 126.9920648, // Ikovox cafe
    idle: "sway",   yaw: 0 },
  { id: "arch-chaos",  arch: "chaos",  name: "Nalli",
    glb: "npcs/chaos.glb",  lat: 37.534086,  lng: 126.996588,  // Grand Ole Opry
    idle: "bounce", yaw: 0 },
  { id: "arch-sporty", arch: "sporty", name: "Dali",
    glb: "npcs/sporty.glb", lat: 37.5496508, lng: 126.9933311, // Namsan 산스장
    idle: "jog",    yaw: 0 },
];

// The ambient blob NPC pairs are retired (user call 2026-08-11): the three
// archetype mascots above are the only NPCs in the world now.

// Day and night: the real sun over the place on screen (sun.js: the spot
// under the camera, whichever world it is: Itaewon, its blend, the city
// anywhere), so Seoul is lit by Seoul's sun and Calgary by Calgary's,
// whatever the phone's clock or time zone says. NIGHT is only the palette
// materials start in (the sun over the first spot: Itaewon, or
// ?devlat/devlng); every day/night material signs up in the dn() registry
// and takes the live light the moment it's made, and sunTick() re-reads the
// sun every few seconds (and at once when the world moves), so applyLight()
// lerps the materials, the lights, the fog and the sky through golden hour
// and dusk: a sunset happens live while the app is open. The sun's
// direction moves the key light and the hand-made map's baked shadows too.
// ?mode=night|day pins it for the tests; ?light= / the dev chip
// (daylight.js) pin it for a look; ?sunat= / ?sunspeed= move the sun's
// clock (sun.js sunNow). Palettes are the law from assets/world/STYLE.md.
const modeParam = new URLSearchParams(location.search).get("mode");
const Q0 = new URLSearchParams(location.search);
const SPOT0 = [Number(Q0.get("devlat")) || 37.5346, Number(Q0.get("devlng")) || 126.9946];
const lightOv = lightOverride();
const FORCED = lightOv != null || modeParam === "night" || modeParam === "day";
const light0 = lightOv != null ? lightOv : modeParam === "night" ? 0 : modeParam === "day" ? 1 : lightAt(SPOT0[0], SPOT0[1]);
export const NIGHT = light0 < 0.5;
// the app's glass follows the map's light (theme.css, --day)
startDaylight({ night: NIGHT, forced: modeParam === "day" || modeParam === "night" });
// ONE lighting rig for every scene, from theme.js — plus per-mode extras;
// the dusk rig is the golden hour between them
const L = NIGHT ? THEME.lighting.night : THEME.lighting.day;
const DUSK = { hemiSky: 0xe0a882, hemiGround: 0x5c4a58, hemiInt: 0.85, sunCol: 0xff9d5c, sunInt: 1.0, fog: 0xd6a98f };
const M = {
  ...L,
  grass: NIGHT ? 0x3f4a42 : 0x8a9a6a,
  road: NIGHT ? 0x474c59 : 0x9d998e,
  winCol: NIGHT ? 0x2e2a22 : 0x9db4c8,
  winEmis: NIGHT ? 0xffc86e : 0x000000,
};
// the day/night registry: every material with a day value and a night
// value signs up here; applyLight(t) lerps them (colours through sRGB hex,
// numbers straight). dn() returns what the current palette wants so the
// material is right from the start
const DN = [];
const dnHex = c => new THREE.Color(c);
const dnLight = () => world3d.light ?? light0;   // the light right now (a material made later starts in it)
function dnSet({ mat, pairs }, t) {
  const n = 1 - t;
  for (const [k, [d, nv]] of Object.entries(pairs)) {
    if (typeof d === "number") mat[k] = d + (nv - d) * n;
    else mat[k].copy(d).lerp(nv, n);
  }
}
function dn(mat, pairs) {
  const e = { mat, pairs: {} };
  for (const [k, [d, n]] of Object.entries(pairs)) e.pairs[k] = typeof d === "number" && typeof n === "number" && (k === "opacity" || k === "emissiveIntensity" || k === "intensity") ? [d, n] : [dnHex(d), dnHex(n)];
  DN.push(e);
  dnSet(e, dnLight());
  return mat;
}
const DN_FN = [];          // (t) => void: the bits that can't be lerped (texture swaps, visibility)
const dnFn = f => { DN_FN.push(f); f(dnLight()); };
const lerpRig = (t) => {   // the rig at light t: night -> dusk -> day
  const out = {};
  const [a, b, k] = t < 0.5 ? [THEME.lighting.night, DUSK, t * 2] : [DUSK, THEME.lighting.day, (t - 0.5) * 2];
  for (const key of ["hemiSky", "hemiGround", "sunCol", "fog"]) out[key] = dnHex(a[key]).lerp(dnHex(b[key]), k);
  for (const key of ["hemiInt", "sunInt"]) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
};

// the key light at night and when the light is forced (STYLE.md 2): high, from the south-east
const CLASSIC_SUN = new THREE.Vector3(120, 200, 80).normalize();

// The map's view, Pokémon GO style: the camera tilted, looking a little
// ahead so you stand in the lower middle of the screen, more top-down as
// you zoom out and lower toward the horizon as you zoom in; and you see
// about 270 m round you whatever the zoom: past half that the world fades
// into the haze (a fog by distance from you, not from the camera: the
// fog_* shader chunks below), and nothing is loaded or drawn much beyond.
// The start screen's scenery keeps its own wide view (mapView false), and
// a game that frames the map itself (Manhunt's zone overview) asks for a
// free view (freeView).
export const VIEW = { R: 150, start: 0.5, buffer: 60 };   // world units: clear to R·start, gone at R, chunks to R + buffer
export const ZOOM = { min: 70, max: 230, elevMin: 0.5, elevMax: 1.0, ahead: 0.2 };
const elevFor = d => { const f = Math.min(1, Math.max(0, (d - ZOOM.min) / (ZOOM.max - ZOOM.min))); return ZOOM.elevMin + (ZOOM.elevMax - ZOOM.elevMin) * f * f; };
// The fog round you: three's fog chunks, patched once for every material.
// A Fog with a negative near is the map's: fogNear = -(how far the camera
// stands back from you, along the ground), fogFar = the radius where the
// fog is total; the fog then goes by the ground distance from you (the
// camera's ground point moved that far along its heading), clear up to
// fogFar·VIEW.start. Any other fog (the start screen, the game rooms) is
// three's own depth fog, untouched.
{
  const C = THREE.ShaderChunk;
  if (!C.fog_vertex.includes("vFogRel")) {
    C.fog_pars_vertex = C.fog_pars_vertex.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying vec2 vFogRel;\n\tuniform float fogNear;");
    C.fog_vertex = C.fog_vertex.replace("vFogDepth = - mvPosition.z;", `vFogDepth = - mvPosition.z;
\tvFogRel = vec2(0.0);
\tif (fogNear < 0.0) {
\t\tvec3 fogWorld = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
\t\tvec2 fogFwd = -vec2(viewMatrix[0][2], viewMatrix[2][2]);
\t\tfloat fogL = length(fogFwd);
\t\tvFogRel = fogWorld.xz - (fogL > 1e-4 ? fogFwd / fogL : vec2(0.0)) * (-fogNear);
\t}`);
    C.fog_pars_fragment = C.fog_pars_fragment.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying vec2 vFogRel;");
    C.fog_fragment = C.fog_fragment.replace("float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );",
      `float fogFactor = fogNear < 0.0 ? smoothstep( fogFar * ${VIEW.start.toFixed(2)}, fogFar, length( vFogRel ) ) : smoothstep( fogNear, fogFar, vFogDepth );`);
  }
}

// zone character: density weight for buildings (urban) vs greenery
const ZONE_FLAVOR = [
  // plaza: building-clear radius. The station/alley crossroads are the
  // DENSEST real blocks in Itaewon — a 58u void there read as a bald spot
  // (user report, confirmed against the registry). Green zones keep it.
  { lat: 37.5346, lng: 126.9946, build: 1.0,  green: 0.05, plaza: 6 },  // Itaewon station
  { lat: 37.5349, lng: 126.9941, build: 0.95, green: 0.05, plaza: 6 },  // Hamilton Alley
  { lat: 37.5392, lng: 126.9887, build: 0.7,  green: 0.3,  plaza: 34 }, // Gyeongnidan
  { lat: 37.5340, lng: 126.9868, build: 0.55, green: 0.35, plaza: 34 }, // Noksapyeong
  { lat: 37.5418, lng: 126.9882, build: 0.3,  green: 0.9,  plaza: 58 }, // Haebangchon
  { lat: 37.5289, lng: 126.9944, build: 0.25, green: 0.85, plaza: 58 }, // Bogwang
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
  cam: { theta: 0, elev: elevFor(175), dist: 175 },
  CAM_DEFAULT: { theta: 0, elev: elevFor(175), dist: 175 },
  ZOOM, VIEW, elevFor,
  mapView: true,               // the map's own view (looking ahead, the haze round you); the start screen's scenery turns it off
  freeView: false,             // a game framing the map itself (Manhunt's overview): its own fog and camera
  fogR: VIEW.R,                // where the haze is total right now (it closes in after the scenery)
  camGoal: null,               // eased recenter target
  target: new THREE.Vector3(0, 0, 0),
  followPos: null,
  observing: false,            // true after a pan: camera roams free
  homePos: null,               // explore mode (invisible): where "back to me"
  exploreR: null,              // returns, and how far you can pan from it
  paused: false,               // a full-screen screen covers the map: don't draw it
  player: null, playerShadow: null,
  remoteGroup: null,
  zoneRings: new THREE.Group(),
  anchors: [],                 // { el, getPos } DOM overlays following 3D points
  labels: [],                  // crisp DOM labels (see addLabel) — text must
  labelLayer: null,            // live OUTSIDE the pixelated WebGL canvas
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
    // crisp text layer: the 0.5x console render pixelates anything drawn
    // inside the canvas, so ALL floating text renders as DOM on top
    this.labelLayer = document.createElement("div");
    this.labelLayer.id = "label-layer";
    frameEl.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(M.skyTop);
    this.scene.fog = CITY_MODE ? new THREE.Fog(M.fog, 300, 980) : new THREE.Fog(M.fog, 340, 1250);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 2500);

    // IBL for the GLB characters (PBR materials only — the Lambert world
    // ignores scene.environment, so the locked style is untouched)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(makeEnvScene(), 0.04).texture;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(M.hemiSky, M.hemiGround, M.hemiInt);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(M.sunCol, M.sunInt);
    sun.position.set(120, 200, 80);
    this.scene.add(sun);
    this.sun = sun;

    // the hand-baked Itaewon (terrain, roads, buildings, decor) lives in
    // one group, so city mode can hide it and bring it back
    this.worldRoot = new THREE.Group();
    this.worldRoot.name = "itaewon";
    this.scene.add(this.worldRoot);
    this.buildTerrain();
    // the horizon's haze (the map's view): a band of the fog's own colour
    // round the far ground, fading up into the sky, so the painted sky
    // never meets the hazy ground at a hard line
    {
      const c = document.createElement("canvas"); c.width = 4; c.height = 64;
      const g = c.getContext("2d"), gr = g.createLinearGradient(0, 64, 0, 0);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
      const haze = new THREE.Mesh(new THREE.CylinderGeometry(1800, 1800, 560, 48, 1, true),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: M.fog, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      haze.position.y = 140;     // 140 under the ground to 420 over it
      haze.visible = false;
      this.scene.add(haze);
      this.haze = haze;
    }
    this.scene.add(this.zoneRings);
    this.remoteGroup = new THREE.Group();
    this.scene.add(this.remoteGroup);
    this.spawnArchNpcs();
    // humanoid template loads in the background; once ready, rebuild any
    // characters that spawned as blob fallbacks in the meantime
    if (!LEGACY_CHAR) {
      loadHumanTemplate().then(() => this.refreshChars(), () => {});
    }
    if (CITY_MODE) {
      // the origin is the first place we're told about; ?at= pins it for tests
      const at = (CITY_Q.get("at") || "").split(",").map(Number);
      if (at.length === 2 && at.every(Number.isFinite)) this.startCity(at[0], at[1]);
      else setTimeout(() => this.startCity(GEO_CENTER[0], GEO_CENTER[1]), 2500);
    } else {
      // async: real roads + zone-flavored buildings/trees. The world only
      // moves (worldAt) once it's in: its labels and heights are Itaewon's
      this.itaewonLoading = this.loadWorld().catch(e => console.warn("[rando] Itaewon map", e)).finally(() => { this.itaewonLoading = null; });
    }

    this.bindControls();
    window.addEventListener("resize", () => this.resize());
    if (CITY_Q.get("fps") === "1") this.fpsMeter();

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
      this.sky = sky;
      // the other sky loads too, for a sunset that happens while you watch:
      // the painting swaps at the flip, its tint fades through dusk
      const skies = { [NIGHT ? "night" : "day"]: tex };
      this.texIfExists(NIGHT ? "world2/sky_day.jpg" : "world2/sky_night.jpg", other => {
        other.wrapS = THREE.MirroredRepeatWrapping; other.repeat.x = 2;
        skies[NIGHT ? "day" : "night"] = other;
      });
      dnFn(t => {
        const want = skies[t < 0.5 ? "night" : "day"];
        if (want && sky.material.map !== want) { sky.material.map = want; sky.material.needsUpdate = true; }
        const dusk = 1 - Math.abs(t - 0.5) * 2;        // 1 at the flip, 0 by full day / night
        sky.material.color.setRGB(1, 1, 1).lerp(dnHex(0xd9a27a), dusk * 0.55);
      });
      const cap = new THREE.Mesh(new THREE.CircleGeometry(1900, 72),
        dn(new THREE.MeshBasicMaterial({ color: NIGHT ? 0x030b25 : 0x3072c7, fog: false }), { color: [0x3072c7, 0x030b25] }));
      cap.rotation.x = Math.PI / 2;
      cap.position.y = 1725;
      this.scene.add(cap);
      this.skyCap = cap;
    });

    // ground: concrete paving within Itaewon proper (the reference's urban
    // floor), grass outside. The paved disc sits a hair above the grass
    // plane with a pale curb ring marking the transition.
    if (CITY_MODE) { this.buildCityGround(); return; }
    const PAVED_R = 720;
    const groundMat = dn(new THREE.MeshLambertMaterial({ color: M.grass }), { color: [0x8a9a6a, 0x3f4a42] });
    const gg = new THREE.PlaneGeometry(3000, 3000, 100, 100);
    gg.rotateX(-Math.PI / 2);
    const gp = gg.attributes.position;
    for (let i = 0; i < gp.count; i++) gp.setY(i, terrainY(gp.getX(i), gp.getZ(i)));
    gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, groundMat);
    this.worldRoot.add(ground);
    this.handGround = ground;
    this.loadImage("world2/road_grass.jpg").then(img => {
      const tex = this.mirrorBlockTex(img, [0.03, 0.03, 0.30, 0.30]);
      tex.repeat.set(38, 38); // block ≈ 80u of ground per repeat
      groundMat.map = tex;
      dn(groundMat, { color: [THEME.world.grassDay, THEME.world.grassNight] });
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
      const paved = new THREE.Mesh(pgeo, dn(new THREE.MeshLambertMaterial({ map: tex,
        color: NIGHT ? THEME.world.pavingNight : THEME.world.pavingDay }), { color: [THEME.world.pavingDay, THEME.world.pavingNight] }));
      this.worldRoot.add(paved);
      this.needsRender = true;
    }).catch(() => {});
  },

  // city mode: one flat paved plane that follows the camera (snapped to its
  // texture period so the paving never swims); parks, water and roads are
  // drawn over it by the chunks
  buildCityGround() {
    const SIZE = 6000, REP = 72;
    this.groundPeriod = SIZE / REP;
    const mat = dn(new THREE.MeshLambertMaterial({ color: NIGHT ? THEME.world.pavingNight : THEME.world.pavingDay }), { color: [THEME.world.pavingDay, THEME.world.pavingNight] });
    const g = new THREE.PlaneGeometry(SIZE, SIZE);
    g.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(g, mat);
    this.scene.add(this.ground);
    this.loadImage("world2/road_plaza.jpg").then(img => {
      const tex = this.mirrorBlockTex(img, [0.05, 0.05, 0.27, 0.27]);
      tex.repeat.set(REP, REP);
      mat.map = tex;
      mat.needsUpdate = true;
      this.needsRender = true;
    }).catch(() => {});
  },

  // The blend's ground. The city's paving follows Itaewon's hills (0.6 under
  // the hand-made ground: flat, it buried the hand-made map's south side,
  // where the hills fall below it toward the river, roads and all), and the
  // hand-made map's grass outside its paved disc is paved with the city's
  // own paving, lined up with it, so the procedural city round it stands on
  // the same ground as everywhere else and the two meet with no edge. The
  // hand-made map on its own (the start screen) keeps its grass.
  blendGround(on) {
    const g = this.ground;
    if (on && g && !this._hillGeo) {
      const S = 6000, N = 150;   // 40 u: the hills' curve within 0.2 u
      this._flatGeo = g.geometry;
      this._hillGeo = new THREE.PlaneGeometry(S, S, N, N);
      this._hillGeo.rotateX(-Math.PI / 2);
      this._hillAt = null;
    }
    if (g && this._hillGeo) { g.geometry = on ? this._hillGeo : this._flatGeo; this._hillAt = null; }
    this._hillOn = !!on && !!this._hillGeo;
    // (the hand-made grass stays grass round the edges: repaving it turned
    // Namsan, which the baked data has no park outline for, into paving)
    this.needsRender = true;
  },

  // city mode: pin the map's origin and start streaming chunks around it.
  // Everything already placed against the old origin is placed again. A
  // game can call it mid-session (Manhunt plays on the real streets of its
  // zone) and exitCity() brings the Itaewon map back.
  async enterCity(lat, lng) {
    if (this.city) {
      const [a0, b0] = this.city.origin;
      if (Math.hypot((lat - a0) * 110540, (lng - b0) * 111320 * Math.cos(a0 * Math.PI / 180)) < 2500) return this.city;
      this.city.dispose(); this.city = null;
    }
    if (this._cityStarting) return this._cityStarting;
    let done;
    this._cityStarting = new Promise(r => { done = r; });
    // built ahead out of sight (warmCity)? then it's on the map at once, at its own origin
    const warm = this.takeWarm(false, lat, lng);
    if (warm) [lat, lng] = warm.origin;
    cityOn = true; WORLD_EDGE = 12000; this.groundLevel = 0; this.blendGround(false);
    GEO_CENTER[0] = lat; GEO_CENTER[1] = lng;
    TERRAIN_ANCHORS = null;
    if (this.worldRoot) this.worldRoot.visible = false;
    for (const L of this.labels) if (L.old) L.hidden = true;
    if (!this.ground) this.buildCityGround(); else this.ground.visible = true;
    this.scene.fog = new THREE.Fog(M.fog, 300, 980);
    this.target.set(0, 0, 0); this.applyCamera();
    this.replaceAll();
    const near = warm ? warm.heroes : await this.heroesFor(false, [lat, lng]);
    if (warm) { this.city = warm.city; this.city.show(); }
    else { this.dropWarm(); this.city = new CityTiles(this, { url: CITY_URL, origin: [lat, lng], night: NIGHT, heroes: near, omt: OMT_URL }); }
    this.city.heroList = near;
    this.relight();
    this.cityHeroes(near);
    this._cityStarting = null;
    this.credit();
    done(this.city);
    this.needsRender = true;
    return this.city;
  },
  startCity(lat, lng) { return this.enterCity(lat, lng); },
  // back to the hand-baked Itaewon (only when the session didn't start in city
  // mode); keep: the city stays built out of sight, to come back at once
  exitCity(keep = false) {
    if (!this.city || CITY_MODE) return;
    if (keep) this.stashCity(); else { this.city.dispose(); this.city = null; }
    this.cityHeroes([]);
    this.blending = false;
    cityOn = false; WORLD_EDGE = 1050;
    GEO_CENTER[0] = ITAEWON[0]; GEO_CENTER[1] = ITAEWON[1];
    TERRAIN_ANCHORS = null;
    if (this.worldRoot) this.worldRoot.visible = true;
    for (const L of this.labels) if (L.old) L.hidden = false;
    if (this.ground) this.ground.visible = false;
    this.blendGround(false);
    this.scene.fog = new THREE.Fog(M.fog, 340, 1250);
    this.relight();
    this.target.set(0, 0, 0); this.applyCamera();
    this.replaceAll();
    this.credit();
    this.needsRender = true;
  },
  get cityOn() { return cityOn; },
  // the ground's height at a world point (the hills round Itaewon, flat in a city)
  groundY(x, z) { return terrainY(x, z); },

  // The world for a spot on Earth (the player's, or Explore's): near
  // Itaewon its hand-made map with the procedural city round its edges,
  // anywhere else the procedural city centred there. Cheap to call often:
  // it only acts when the answer changes. While the start screen's scenery
  // holds the world (scenery.js), the spot waits until it lets go.
  worldAt(lat, lng) {
    if (lat == null || lng == null) return Promise.resolve(null);
    this._spot = [lat, lng];
    if (CITY_MODE) return this.city || this._cityStarting ? Promise.resolve(this.city) : this.enterCity(lat, lng);
    // (the world can't move yet: the spot's city starts building out of sight meanwhile)
    if (this.holdWorld) { this._wantWorld = [lat, lng]; this.warmCity(lat, lng); return Promise.resolve(null); }
    if (this.itaewonLoading) { this.warmCity(lat, lng); return this.itaewonLoading.then(() => { const w = this._spot; return w ? this.worldAt(...w) : null; }); }
    if (metresFrom(lat, lng, ITAEWON) < ITAEWON_KEEP_M) {
      if (cityOn) this.exitCity();
      return this.blendCity();
    }
    if (cityOn && this.city && metresFrom(lat, lng, this.city.origin) < 2500) return Promise.resolve(this.city);
    // a new spot far from the city on screen: that one stays until the new one's near ring is in
    if (this.city) return this.recentre(lat, lng);
    return this.enterCity(lat, lng);
  },
  // A city built ahead, out of sight (citytiles.js hidden): its chunks stream
  // round the spot while the start screen or the Itaewon map is still up, or
  // while the old city stays on screen during a re-centre, and enterCity /
  // blendCity put it on the map at once instead of starting from bare
  // paving. One at a time; ?warm=0 turns it off.
  _warm: null,
  warmCity(lat, lng) {
    if (CITY_MODE || CITY_Q.get("warm") === "0") return null;
    const blend = metresFrom(lat, lng, ITAEWON) < ITAEWON_KEEP_M;
    if (blend && (CITY_Q.get("blend") === "0" || !this.handmadeSrc())) return null;   // (the blend waits for the hand-made map)
    const w = this._warm;
    if (w && w.blend === blend && (blend || metresFrom(lat, lng, w.origin) < 2500)) { w.spot = [lat, lng]; return w; }
    this.dropWarm();
    const origin = blend ? [...ITAEWON] : [lat, lng];
    const warm = this._warm = { blend, origin, spot: [lat, lng], city: null };
    warm.ready = this.heroesFor(blend, origin).then(heroes => {
      if (this._warm !== warm) return null;
      warm.heroes = heroes;
      warm.city = new CityTiles(this, { url: CITY_URL, origin, night: NIGHT, heroes, omt: OMT_URL, exclude: blend ? this.handmadeSrc() : null, hidden: true });
      return warm;
    });
    return warm;
  },
  dropWarm() { this._warm?.city?.dispose(); this._warm = null; },
  // the warm city, if it's the one for this world (and built)
  takeWarm(blend, lat, lng) {
    const w = this._warm;
    if (!w?.city || w.blend !== blend || (!blend && metresFrom(lat, lng, w.origin) >= 2500)) return null;
    this._warm = null;
    return w;
  },
  // the city on screen goes out of sight, kept as the warm one
  stashCity() {
    const c = this.city;
    if (!c) return;
    this.dropWarm();
    c.hide();
    this._warm = { blend: !!this.blending, origin: c.origin, spot: this._spot ?? c.origin, city: c, heroes: c.heroList ?? [] };
    this._warm.ready = Promise.resolve(this._warm);
    this.city = null;
  },
  // resolves once the warm city's near ring is in (or after ms)
  whenWarm(w, ms) {
    return (w?.ready ?? Promise.resolve(null)).then(() => new Promise(res => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (this._warm !== w || !w.city || w.city.nearDone || performance.now() - t0 > ms) { clearInterval(iv); res(this._warm === w && !!w.city?.nearDone); }
      }, 60);
    }));
  },
  recentre(lat, lng) {
    const w = this.warmCity(lat, lng);
    const swap = () => {
      if (this.blending) { this.city?.dispose(); this.city = null; this.blending = false; }
      const s = this._spot ?? [lat, lng];
      return this.enterCity(...s);
    };
    if (!w) return swap();
    return (w.swap ??= this.whenWarm(w, 8000).then(() => this._warm === w ? swap() : this.city));
  },
  // what the hand-made map covers, for the blend: its buildings' footprints
  // and its roads, flat (cheap to hand to the chunk worker, which works out
  // the mask from them off this thread: citygen.js handmadeMask / handmade).
  // The procedural city fills in from where the hand-made buildings stop
  // (not from one circle for all directions), and leaves out what the
  // hand-made map already has further out.
  handmadeSrc() {
    const H = this._handmade;
    if (!H?.buildings?.length) return null;
    if (H.src) return H.src;
    const flat = (list, pts) => {
      let n = 0; for (const p of list) n += pts(p).length;
      const xy = new Float32Array(n * 2), at = new Uint32Array(list.length + 1);
      let k = 0;
      list.forEach((p, i) => { at[i] = k; for (const [x, z] of pts(p)) { xy[k * 2] = x; xy[k * 2 + 1] = z; k++; } });
      at[list.length] = k;
      return { xy, at };
    };
    const b = flat(H.buildings, x => x.p), r = flat(H.roads, x => x.p);
    return (H.src = { b: BLEND.b, r: BLEND.r, src: { bxy: b.xy, bat: b.at, rxy: r.xy, rat: r.at, rhw: Float32Array.from(H.roads, x => (H.wid[x.t] ?? 11) / 2 + 2) } });
  },
  // the landmarks for a world (data/heroes.json): round its origin, and for
  // the blend only those outside the hand-made map (it has its own)
  heroesFor(blend, origin) {
    this.heroes ??= (async () => { try { return (await (await fetch("data/heroes.json")).json()).heroes; } catch { return []; } })();
    return this.heroes.then(hs => hs.filter(h => blend
      ? metresFrom(h.lat, h.lng, ITAEWON) < 15000 && Math.hypot(...Object.values(geoPosRaw(h.lat, h.lng))) > BLEND.b
      : metresFrom(h.lat, h.lng, origin) < 15000));
  },
  holdWorld: false,
  // the start screen shows Itaewon (its still image is Itaewon): hand-made
  // map only while it's up, whatever world you were in
  hold() {
    if (CITY_MODE) return;
    this.holdWorld = true;
    // (the city goes out of sight but stays built: back at once when it lets go)
    if (cityOn) this.exitCity(true);
    else if (this.blending) { this.stashCity(); this.blending = false; this.cityHeroes([]); WORLD_EDGE = 1050; if (this.ground) this.ground.visible = false; this.blendGround(false); this.credit(); }
  },
  // somewhere away from Itaewon the spot's city is given a moment (2.5 s at
  // most) to get its near ring in before it swaps in, so it arrives built
  // (the start screen's navy veil covers the wait), not as bare paving
  releaseWorld(spot = null) {
    if (!this.holdWorld) return Promise.resolve(null);
    this.holdWorld = false;
    const w = spot ?? this._wantWorld ?? this._spot; this._wantWorld = null;
    if (!w) return Promise.resolve(null);
    const warm = this.isAway(...w) ? this.warmCity(...w) : null;
    return warm ? this.whenWarm(warm, 2500).then(() => this.holdWorld ? null : this.worldAt(...(this._spot ?? w))) : this.worldAt(...w);
  },
  // is a spot far enough from Itaewon to get the procedural city of its own?
  isAway(lat, lng) { return !CITY_MODE && metresFrom(lat, lng, ITAEWON) >= ITAEWON_KEEP_M; },
  // Itaewon's hand-made map, and the procedural city past its edges
  async blendCity() {
    if (this.blending || this._blendStarting || cityOn || CITY_Q.get("blend") === "0") return this.city;
    this._blendStarting = true;
    try {
      const warm = this.takeWarm(true);
      const heroes = warm ? warm.heroes : await this.heroesFor(true);   // (the hand-made map has its own)
      if (cityOn || this.blending) { if (warm) { this._warm = warm; } return this.city; }
      const edge0 = WORLD_EDGE;
      WORLD_EDGE = ITAEWON_KEEP_M * GEO_SCALE * 1.25;
      // you (and the others) were placed against the hand-made map's edge: a
      // spot in the blend ring stood at that edge, up to 800 m from where it
      // is, with the city streaming round the wrong place. Placed again now
      // the world reaches that far.
      const far = o => o?.lat != null && Math.hypot(...Object.values(geoPosRaw(o.lat, o.lng))) > edge0;
      if (far(this._lastPlayerOpts) || (this._lastExplore && far({ lat: this._lastExplore[0], lng: this._lastExplore[1] }))) this.replaceAll();
      else if (this._lastRemotes) this.setRemotes(this._lastRemotes);
      if (!this.ground) this.buildCityGround();
      this.ground.visible = true;
      this.groundLevel = -0.6;           // under the hand-made ground where they overlap
      this.blendGround(true);
      if (warm) { this.city = warm.city; this.city.show(); }
      else { this.dropWarm(); this.city = new CityTiles(this, { url: CITY_URL, origin: [...ITAEWON], night: NIGHT, heroes, omt: OMT_URL, exclude: this.handmadeSrc() ?? BLEND }); }
      this.city.heroList = heroes;
      this.relight();
      this.blending = true;
      this.cityHeroes(heroes);
      this.credit();
      this.needsRender = true;
      return this.city;
    } finally { this._blendStarting = false; }
  },
  // ?fps=1: frames per second, what's drawn, and how the city's chunks are
  // loading, in a corner (for trying it on a real phone)
  fpsMeter() {
    const el = Object.assign(document.createElement("div"), { id: "fps-meter" });
    el.style.cssText = "position:fixed;right:6px;top:calc(env(safe-area-inset-top) + 6px);z-index:9999;padding:5px 7px;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:600 11px/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre";
    document.body.appendChild(el);
    let n = 0, t0 = performance.now();
    const loop = () => {
      n++;
      const t = performance.now();
      if (t - t0 >= 1000) {
        const info = this.renderer.info.render, st = this.city?.stats();
        const cold = st?.log.filter(l => !l.empty) ?? [];
        const last = cold[cold.length - 1];
        el.textContent = `${Math.round(n * 1000 / (t - t0))} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris` +
          (st ? `\ncity: ${st.chunks} chunks (${st.inflight + st.queued} loading) · ring ${st.firstRingMs ? (st.firstRingMs / 1000).toFixed(1) + " s" : "…"}` +
            (last ? `\nlast chunk ${last.ms.toFixed(0)} ms (fetch ${last.fetch.toFixed(0)}, build ${last.build.toFixed(0)})${last.cached ? " · " + last.cached : ""}` : "") +
            `\n${this.blending ? "Itaewon + city" : cityOn ? "city" : "Itaewon"}` : "") +
          // where the chunks round you came from, and how many buildings stand
          // within 300 m (the phone's own answer to "why is it empty here")
          (st ? (() => {
            const by = {}; let retry = 0;
            for (const l of st.log.slice(-25)) { if (!l.empty) by[l.src ?? "?"] = (by[l.src ?? "?"] ?? 0) + 1; if (l.retry) retry++; }
            return `\n${this.city.countNear(this.target.x, this.target.z, 300 * GEO_SCALE)} buildings within 300 m · ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")}${retry ? ` · ${retry} retrying` : ""}`;
          })() : "");
        n = 0; t0 = t;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  // the small print for whatever map data is on screen
  // the map's corner credit (docs/map_data.md): each source linked, which is
  // what their licences ask (ODbL: the OSM copyright page; OpenMapTiles: its
  // site), and the Korean building registry where its heights show
  credit() {
    const el = document.getElementById("osm-credit");
    if (!el) return;
    const a = (text, href) => { const l = document.createElement("a"); l.href = href; l.target = "_blank"; l.rel = "noopener"; l.textContent = text; l.style.cssText = "color:inherit;text-decoration:none"; return l; };
    const parts = this.city
      ? [a("© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"), a("Overture Maps Foundation", "https://overturemaps.org"), a("© OpenMapTiles", "https://openmaptiles.org/"), a("국토교통부 브이월드", "https://www.vworld.kr")]
      : [a("roads © OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"), a("buildings 국토교통부 브이월드", "https://www.vworld.kr")];
    el.replaceChildren(...parts.flatMap((l, i) => i ? [" · ", l] : [l]));
  },
  geo: (lat, lng) => geoPos(lat, lng),
  ungeo: (x, z) => geoInv(x, z),
  // your own character to where you really are (a game reading your GPS on
  // your phone: Manhunt). It walks there, or jumps if it's far.
  movePlayer(lat, lng) {
    const rec = this.player;
    if (!rec) return;
    const p = geoPos(lat, lng), gp = rec.api.group.position;
    if (gp.distanceTo(p) > 60) { gp.copy(p); rec.baseY = p.y; rec.walkTarget = null; rec.api.walking = false; }
    else rec.walkTarget = p;
    this.needsRender = true;
  },
  // the origin moved: put back everything that has a place on the map
  replaceAll() {
    if (this._lastZones) this.registerZones(this._lastZones);
    if (this._lastRemotes) this.setRemotes(this._lastRemotes);
    // (a new origin: you're there at once, not walking over from the old one)
    if (this.player) { this.removeChar(this.player, this.scene); this.player = null; this.followPos = null; }
    if (this._lastPlayerOpts) this.setPlayer(this._lastPlayerOpts);
    if (this._lastExplore) this.setExplore(...this._lastExplore);
    for (const def of ARCH_NPC_DEFS) {
      const rec = this.archRecs?.[def.id];
      if (rec) { const p = geoPos(def.lat, def.lng); rec.api.group.position.copy(p); rec.baseY = p.y; }
    }
  },

  // the landmarks round the map's origin (data/heroes.json): a label each,
  // and the model where there is one, fitted to its height, turned and
  // offset as the entry says, lit by the procedural city's night uniform.
  // One without a model still stands out: the chunk makes its building
  // taller with a glowing crown, or raises a placeholder tower (citygen.js).
  // Called again when the origin moves: the old ones go first.
  cityHeroes(heroes) {
    for (const o of this._heroObjs ?? []) { if (o.isObject3D) this.scene.remove(o); else this.removeLabel(o); }
    this._heroObjs = [];
    const loader = new GLTFLoader();
    for (const h of heroes) {
      const pos = geoPos(h.lat, h.lng);
      if (h.label) {
        const top = new THREE.Vector3(pos.x, worldHeight(h.h ?? 30) + 6, pos.z);
        this._heroObjs.push(this.addLabel(h.label, "hero", 3, () => top, h.glow, { city: true }));
      }
      if (!h.glb) continue;
      const objs = this._heroObjs;
      loader.load(h.glb, gltf => {
        if (this._heroObjs !== objs) return;   // the origin moved on meanwhile
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const k = worldHeight(h.h ?? 12) / Math.max(0.001, size.y) * (h.scale ?? 1);
        obj.scale.setScalar(k);
        const off = h.offset || [0, 0, 0];
        obj.position.set(pos.x + off[0] * GEO_SCALE, -box.min.y * k + off[1] * GEO_SCALE * 2.4, pos.z - off[2] * GEO_SCALE);
        obj.rotation.y = ((h.rot ?? 0) * Math.PI) / 180;
        obj.traverse(o => {
          if (!o.isMesh) return;
          const old = o.material;
          const mat = new THREE.MeshLambertMaterial({ map: old.map ?? null, color: old.color ?? 0xffffff, flatShading: true,
            emissive: h.glow ? new THREE.Color(h.glow) : new THREE.Color(0), emissiveMap: old.emissiveMap ?? null });
          mat.onBeforeCompile = sh => {
            Object.assign(sh.uniforms, cityUniforms);
            sh.fragmentShader = sh.fragmentShader
              .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec3 uNightWall;")
              .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), uNightWall, uNight);")
              .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.6 * uNight;");
          };
          o.material = mat;
        });
        this.scene.add(obj);
        objs.push(obj);
        this.needsRender = true;
      }, undefined, err => console.warn("hero", h.id, err?.message || err));
    }
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
    this._loadingOld = true;   // its labels belong to the Itaewon map (city mode hides them)
    let data;
    try {
      data = await (await fetch("roads.json")).json();
    } catch { return; }
    const rand = mulberry32(4207);
    const WID = { primary: 24, secondary: 19, tertiary: 15, residential: 11, pedestrian: 8, unclassified: 11 };
    this._handmade = { roads: data.roads, wid: WID, buildings: null };   // (the blend's mask: handmadeSrc)

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
    const roadMat = dn(new THREE.MeshLambertMaterial({ color: M.road }), { color: [0x9d998e, 0x474c59] });
    const roadMesh = new THREE.Mesh(mergeGeometries(roadGeos), roadMat);
    roadMesh.receiveShadow = true;
    this.worldRoot.add(roadMesh);
    const jointMat = dn(new THREE.MeshLambertMaterial({ color: M.road }), { color: [0x9d998e, 0x474c59] });
    this.worldRoot.add(new THREE.Mesh(mergeGeometries(jointGeos), jointMat));
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
        // at night the walkable path must read instantly against dark blocks
        mat.emissiveIntensity = 1;
        dn(mat, { color: [THEME.world.roadDay, THEME.world.roadNight], emissive: [0x000000, 0x272e48] });
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
      {
        // at night: dim the body, then glow ONLY the bright texture areas
        // (windows, glass, signage) via a contrast-crushed warm emissive map
        // — walls fall dark, windows read lit, giving the night skyline
        // depth (made by day too: a sunset lights them live)
        const day = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
        dn(mat, { color: [day, glow ? 0x6f7c92 : 0x76879c] });
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
          dn(mat, { emissiveIntensity: [0, 0.85] });
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
    // per-zone clearing (buildings only): each zone's own plaza radius
    const inPlaza = (x, z) => flavors.some(f => {
      const r = f.plaza ?? 40;
      return (x - f.p.x) ** 2 + (z - f.p.z) ** 2 < r * r;
    });
    // ---- real Itaewon: OSM building footprints extruded as flat-shaded
    // low-poly prisms with bold outlines. ~25 tris per building merged
    // into one mesh per color bucket, so 2000 real buildings cost less
    // than ten of the smooth GLB models did. GLB heroes stay as landmarks.
    // hero landmarks (Street View -> Tripo reconstructions). Loaded first
    // so their clear-radius suppresses the generic prisms beneath them.
    let landmarks = [];
    try {
      // data/heroes.json is in metres and lng/lat; this loader works in
      // world units (footprint, height, clear radius), so convert
      landmarks = (await (await fetch("data/heroes.json")).json()).heroes
        .filter(l => l.lat != null && l.lng != null && l.status !== "proposed" && metresFrom(l.lat, l.lng, ITAEWON) < 1800)
        .map(l => ({ ...l, name: l.label, yaw: l.rot ?? undefined, pos: geoPos(l.lat, l.lng),
          h: (l.h ?? 12) * GEO_SCALE * 2.4, clear: (l.clear ?? 20) * GEO_SCALE,
          fp: l.fp ? l.fp.slice(0, l.fp.length > 3 && l.fp[0][0] === l.fp.at(-1)[0] && l.fp[0][1] === l.fp.at(-1)[1] ? -1 : undefined)
            .map(([lng, lat]) => { const q = geoPos(lat, lng); return [q.x, q.z]; }) : undefined }));
    } catch { /* optional */ }
    const nearLandmark = (x, z) => landmarks.some(l =>
      l.glb && (x - l.pos.x) ** 2 + (z - l.pos.z) ** 2 < l.clear * l.clear);

    let footprints = 0;
    let fpList = [];         // raw OSM footprints — hero scale normalizer
    const decorLampPts = []; // decor lamp heads — street-light dedupe
    try {
      const bdata = await (await fetch("buildings.json")).json();
      fpList = bdata.buildings;
      this._handmade.buildings = bdata.buildings;
      const wallCols = THEME.walls; // warm desaturated family (style lock)
      // facade family: class comes from the registry bake (b.cls —
      // shop/office/res/mixed from real floors+area+road); buckets are
      // class x color so merged draw calls stay tiny (24 + 24 + outlines)
      const FCLASSES = ["mixed", "shop", "office", "res"];
      const wallGeos = Array.from({ length: FCLASSES.length * wallCols.length }, () => []);
      const roofGeos = Array.from({ length: FCLASSES.length * wallCols.length }, () => []);
      const shadowGeos = [];
      const decorLots = []; // road-facing lots for the decoration pass
      for (const b of bdata.buildings) {
        const poly = b.p;
        let cx = 0, cz = 0;
        for (const [x, z] of poly) { cx += x; cz += z; }
        cx /= poly.length; cz /= poly.length;
        if (inPlaza(cx, cz)) continue; // per-zone plaza radius
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
        let ci = FCLASSES.indexOf(b.cls);
        if (ci < 0) { // OSM-only buildings (no registry match): quiet mix
          ci = Math.abs(Math.round(cx * 3 + cz * 11)) % 3 === 0 ? 3 : 0;
        }
        const wi = ci * wallCols.length + bi;
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
          wallGeos[wi].push(wg);
        }
        {
          const tris = THREE.ShapeUtils.triangulateShape(v2s, []);
          const rpos = [];
          for (const t of tris) {
            for (const vi of t) rpos.push(v2s[vi].x, baseY + b.h, -v2s[vi].y);
          }
          const rg = new THREE.BufferGeometry();
          rg.setAttribute("position", new THREE.Float32BufferAttribute(rpos, 3));
          roofGeos[wi].push(rg);
        }
        decorLots.push({ poly, cx, cz, h: b.h });
        // baked cast shadow: the footprint swept away from the sun by a
        // height-scaled offset (crisp cel-style shadow, no shadow maps);
        // kept as footprint + length so bakeShadows() can sweep it again
        // when the sun moves
        {
          const base = poly.map(([x, z]) => new THREE.Vector2(x, -z));
          if (THREE.ShapeUtils.area(base) < 0) base.reverse();
          shadowGeos.push({ ring: base.map(v => [v.x, -v.y]), k: Math.min(52, 6 + b.h * 0.95), tris: THREE.ShapeUtils.triangulateShape(base, []) });
        }
        footprints++;
      }
      if (shadowGeos.length) {
        this._shadowSrc = shadowGeos;
        this._shadowKey = null;
        this.shadowMesh = new THREE.Mesh(new THREE.BufferGeometry(),
          new THREE.MeshBasicMaterial({ color: 0x241c12, transparent: true,
            opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
        this.worldRoot.add(this.shadowMesh); // heights baked per-vertex against the terrain
        if (this._sun) this.applySun(this._sun);   // (the sun's sweep, the opacity for the light)
        this.bakeShadows(true);
        this.bakeStep(Infinity);                    // the first sweep at once: the map is loading anyway
      }
      const lineMat = dn(new THREE.LineBasicMaterial({
        color: NIGHT ? 0x39435c : 0x6b675e, transparent: true, opacity: 0.5 }), { color: [0x6b675e, 0x39435c] });
      // window-grid facade: near-white walls (bucket color multiplies) with
      // dark glass by day; at night the same grid becomes the emissive map
      // with a random warm subset of windows lit (Splatoon-square mood)
      // facade FAMILY: one texture per class, windows recorded as cells so
      // the night pass lights the REAL openings of each layout. Near-white
      // walls take the bucket tint; features stay neutral. All texture is
      // procedural — the registry has no appearance data; class comes from
      // its real floors/area/road, so variety follows the actual city.
      const facades = (() => {
        const wrand = mulberry32(515);
        const WARM = ["#ffd98f", "#ffc76a", "#ffe7b0"];
        const COOL = ["#c8ddff", "#aecbf2", "#dfe9ff"];
        const NIGHT_VARIANTS = [
          { p: 0.20, w: 0.85, e: 0.92 }, { p: 0.10, w: 0.55, e: 0.78 },
          { p: 0.05, w: 0.75, e: 0.72 }, { p: 0.15, w: 0.95, e: 0.95 },
          { p: 0.08, w: 0.35, e: 0.80 }, { p: 0.13, w: 0.70, e: 0.86 },
        ];
        const mk = c => {
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.magFilter = THREE.NearestFilter;
          return t;
        };
        const mkDay = cls => {
          const c = document.createElement("canvas");
          c.width = c.height = 256;
          const g = c.getContext("2d");
          g.fillStyle = "#f2efe8";
          g.fillRect(0, 0, 256, 256);
          const cells = [];
          const win = (x, y, w, h) => {
            g.fillStyle = "#59606c";
            g.fillRect(x, y, w, h);
            g.fillStyle = "rgba(255,255,255,0.3)";
            g.fillRect(x, y + h * 0.38, w, 4);
            cells.push([x, y, w, h]);
          };
          if (cls === "shop") {
            // glass storefront + sign band, two window rows above
            g.fillStyle = "#4a5666";
            g.fillRect(8, 190, 240, 58);
            cells.push([8, 190, 240, 58]);
            g.fillStyle = "#9aa0a8";
            g.fillRect(8, 164, 240, 18);
            for (let r = 0; r < 2; r++)
              for (let cc = 0; cc < 4; cc++)
                win(14 + cc * 62, 22 + r * 66, 42, 40);
          } else if (cls === "office") {
            for (let r = 0; r < 5; r++)
              for (let cc = 0; cc < 5; cc++)
                win(10 + cc * 49, 12 + r * 49, 36, 30);
          } else if (cls === "res") {
            for (let r = 0; r < 3; r++)
              for (let cc = 0; cc < 3; cc++) {
                win(20 + cc * 78, 20 + r * 78, 46, 42);
                g.fillStyle = "#7d8288"; // balcony rail line
                g.fillRect(12 + cc * 78, 68 + r * 78, 60, 4);
              }
          } else {
            for (let r = 0; r < 4; r++)
              for (let cc = 0; cc < 4; cc++)
                win(10 + cc * 62, 8 + r * 62, 42, 34);
          }
          return { c, cells };
        };
        const mkNight = (dayCanvas, cells, prob, warmFrac) => {
          const c = document.createElement("canvas");
          c.width = c.height = 256;
          const g = c.getContext("2d");
          g.drawImage(dayCanvas, 0, 0);
          g.fillStyle = "rgba(9,12,20,0.86)"; // near-black field: only lit
          g.fillRect(0, 0, 256, 256);         // cells contribute emissive
          for (const [x, y, w, h] of cells) {
            if (wrand() < prob) {
              const pal = wrand() < warmFrac ? WARM : COOL;
              g.fillStyle = pal[Math.floor(wrand() * 3)];
              g.fillRect(x - 1, y - 1, w + 2, h + 2);
            }
          }
          return c;
        };
        const out = {};
        for (const cls of FCLASSES) {
          const { c, cells } = mkDay(cls);
          out[cls] = {
            day: mk(c),
            // the night canvases too (24 small ones): a sunset lights them live
            variants: NIGHT_VARIANTS.map(v => ({
              tex: mk(mkNight(c, cells, v.p, v.w)), e: v.e })),
          };
        }
        return out;
      })();
      const NIGHT_WALL = new THREE.Color(0.36, 0.42, 0.60); // blue moonlight
      const risers = [];
      wallGeos.forEach((arr, i) => {
        if (!arr.length) return;
        const clsIdx = Math.floor(i / wallCols.length);
        const colIdx = i % wallCols.length;
        const fac = facades[FCLASSES[clsIdx]];
        const merged = mergeGeometries(arr);
        merged.computeVertexNormals();
        const dayCol = new THREE.Color(wallCols[colIdx]), nightCol = dayCol.clone().multiply(NIGHT_WALL);
        const col = NIGHT ? nightCol : dayCol;
        const variant = fac.variants[colIdx];
        const mesh = new THREE.Mesh(merged, dn(new THREE.MeshLambertMaterial({
          color: col, map: fac.day, side: THREE.DoubleSide,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: NIGHT ? variant.e : 0,
          emissiveMap: variant.tex,
        }), { color: [dayCol, nightCol], emissiveIntensity: [0, variant.e] }));
        this.worldRoot.add(mesh);
        if (!roofGeos[i].length) { // class bucket may hold walls only
          const outline0 = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 40), lineMat);
          this.worldRoot.add(outline0);
          risers.push([mesh, outline0]);
          return;
        }
        const rmerged = mergeGeometries(roofGeos[i]);
        rmerged.computeVertexNormals();
        const rday = new THREE.Color(wallCols[colIdx]).multiplyScalar(0.8), rnight = rday.clone().multiply(NIGHT_WALL);
        const roof = new THREE.Mesh(rmerged, dn(new THREE.MeshLambertMaterial({
          color: NIGHT ? rnight : rday, side: THREE.DoubleSide }), { color: [rday, rnight] }));
        this.worldRoot.add(roof);
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 40), lineMat);
        this.worldRoot.add(outline);
        risers.push([mesh, outline], [roof, roof]);
      });
      // loading flourish: each bucket rises from the ground, staggered.
      // Driven from tick() (interval-backed) so it also completes in
      // throttled tabs; costs ~1.5s of scale updates, nothing afterwards.
      risers.forEach(([m, o]) => { m.scale.y = 0.001; o.scale.y = 0.001; });
      this.risers = { t0: performance.now(), items: risers };
      this.lots = decorLots;      // (the start screen dives into one of them)
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
          decorLampPts.push({ x: px, z: pz });
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
        if (arr.length) this.worldRoot.add(new THREE.Mesh(mergeGeometries(arr), mat));
      };
      awnGeos.forEach((arr, i) => addMerged(arr, dn(new THREE.MeshLambertMaterial({
        color: NIGHT ? new THREE.Color(AWN_COLS[i]).multiplyScalar(0.5) : AWN_COLS[i], flatShading: true }),
        { color: [AWN_COLS[i], new THREE.Color(AWN_COLS[i]).multiplyScalar(0.5)] })));
      signGeos.forEach((arr, i) => addMerged(arr, dn(new THREE.MeshLambertMaterial({
        color: NIGHT ? new THREE.Color(SIGN_COLS[i]).multiplyScalar(0.65) : SIGN_COLS[i],
        emissive: SIGN_COLS[i], emissiveIntensity: NIGHT ? 0.28 : 0 }),
        { color: [SIGN_COLS[i], new THREE.Color(SIGN_COLS[i]).multiplyScalar(0.65)], emissiveIntensity: [0, 0.28] })));
      addMerged(acGeos, dn(new THREE.MeshLambertMaterial({ color: NIGHT ? 0x5a5f6a : 0xb9bcc0, flatShading: true }), { color: [0xb9bcc0, 0x5a5f6a] }));
      addMerged(poleGeos, dn(new THREE.MeshLambertMaterial({ color: NIGHT ? 0x2c2a26 : 0x5d564c }), { color: [0x5d564c, 0x2c2a26] }));
      addMerged(lampGeos, dn(new THREE.MeshLambertMaterial({
        color: NIGHT ? 0xfff0c0 : 0xf2ead8,
        emissive: 0xffd685, emissiveIntensity: NIGHT ? 1.3 : 0 }), { color: [0xf2ead8, 0xfff0c0], emissiveIntensity: [0, 1.3] }));
      addMerged(lanternGeos, dn(new THREE.MeshLambertMaterial({
        color: NIGHT ? 0xffe2a0 : 0xf4e4c8,
        emissive: 0xffc96e, emissiveIntensity: NIGHT ? 1.5 : 0 }), { color: [0xf4e4c8, 0xffe2a0], emissiveIntensity: [0, 1.5] }));
      if (poolGeos.length) {   // the lamps' pools of light: only once it's dark
        const pools = new THREE.Mesh(mergeGeometries(poolGeos),
          new THREE.MeshBasicMaterial({ color: 0xffb95e, transparent: true,
            opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }));
        dnFn(t => { pools.visible = t < 0.5; });
        this.worldRoot.add(pools);
      }
      addMerged(clutterGeos.bin, dn(new THREE.MeshLambertMaterial({ color: NIGHT ? 0x3a4a62 : 0x4c6a80 }), { color: [0x4c6a80, 0x3a4a62] }));
      addMerged(clutterGeos.cone, dn(new THREE.MeshLambertMaterial({ color: NIGHT ? 0x8a4a20 : 0xe07b35 }), { color: [0xe07b35, 0x8a4a20] }));
      if (wirePts.length) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute("position", new THREE.Float32BufferAttribute(wirePts, 3));
        this.worldRoot.add(new THREE.LineSegments(wg,
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
        // Task 2 — scale normalizer: Tripo exports land at arbitrary scale,
        // so fit each hero to its real OSM footprint bbox (uniform factor =
        // avg of the X/Z ratios), then take final height from the footprint
        // (already OSM height/levels-derived). Subway entrances clamp to 4u
        // so they never extrude to building height.
        geo.computeBoundingBox();
        const msz = geo.boundingBox.getSize(new THREE.Vector3());
        // bound heroes (bind_heroes.py): the registry building is
        // AUTHORITATIVE — its exact footprint + floor height, no searching
        let fp = l.fp ? { p: l.fp, h: l.h } : null;
        if (!fp) fp = fpList.find(b => pointInPoly(l.pos.x, l.pos.z, b.p));
        if (!fp) {
          // unbound photo pins anchor where the CAMERA stood (street side)
          // — fall back to the nearest footprint and recenter onto it
          let best = null, bd = 22 * 22;
          for (const b of fpList) {
            let cx = 0, cz = 0;
            for (const [fx, fz] of b.p) { cx += fx; cz += fz; }
            cx /= b.p.length; cz /= b.p.length;
            const d2 = (cx - l.pos.x) ** 2 + (cz - l.pos.z) ** 2;
            if (d2 < bd) { bd = d2; best = { b, cx, cz }; }
          }
          if (best) {
            fp = best.b;
            l.pos.set(best.cx, terrainY(best.cx, best.cz), best.cz);
          }
        }
        if (fp && l.fp && !l.yaw) {
          // face the model along the footprint's longest edge (bbox fit
          // has no rotation; a diagonal-street building read as twisted).
          // An explicit rot in data/heroes.json overrides per venue.
          let bl = 0, bang = 0;
          for (let e2 = 0; e2 < fp.p.length; e2++) {
            const [ax, az] = fp.p[e2], [bx3, bz3] = fp.p[(e2 + 1) % fp.p.length];
            const el = (bx3 - ax) ** 2 + (bz3 - az) ** 2;
            if (el > bl) { bl = el; bang = Math.atan2(bz3 - az, bx3 - ax); }
          }
          l._autoYaw = -bang; // three Y-rotation: +CCW viewed from above
        }
        if (fp) {
          let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
          for (const [fx, fz] of fp.p) {
            x0 = Math.min(x0, fx); x1 = Math.max(x1, fx);
            z0 = Math.min(z0, fz); z1 = Math.max(z1, fz);
          }
          const s2 = ((x1 - x0) / msz.x + (z1 - z0) / msz.z) / 2;
          geo.applyMatrix4(new THREE.Matrix4().makeScale(s2, s2, s2));
          geo.computeBoundingBox();
          const cur = geo.boundingBox.getSize(new THREE.Vector3());
          let targetH = fp.h || cur.y;
          if (l.id === "itaewon-station") targetH = Math.min(targetH, 4);
          geo.applyMatrix4(new THREE.Matrix4().makeScale(1, targetH / cur.y, 1));
        } else if (l.id === "itaewon-station") {
          const s3 = 4 / msz.y; // no footprint mapped — clamp uniformly
          geo.applyMatrix4(new THREE.Matrix4().makeScale(s3, s3, s3));
        }
        geo.computeBoundingBox();
        const bbN = geo.boundingBox;
        geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
          -(bbN.min.x + bbN.max.x) / 2, -bbN.min.y, -(bbN.min.z + bbN.max.z) / 2));
        const placedH = geo.boundingBox.max.y - geo.boundingBox.min.y;
        // faceted shading: drop smooth normals, let flatShading rebuild
        geo.deleteAttribute("normal");
        // night: the neon/signs live in the ALBEDO (baked from the night
        // refs) so under dim blue moonlight the whole model goes black.
        // Self-light it: bright/saturated pixels (neon, lit windows) glow
        // full-strength, the rest keeps a faint floor for silhouette.
        let emis = null;
        if (piece.mat.map?.image) {
          const src = piece.mat.map.image;
          const ec = document.createElement("canvas");
          ec.width = src.width; ec.height = src.height;
          const eg = ec.getContext("2d");
          eg.drawImage(src, 0, 0);
          const d = eg.getImageData(0, 0, ec.width, ec.height);
          const px = d.data;
          for (let i = 0; i < px.length; i += 4) {
            const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            const sat = Math.max(px[i], px[i + 1], px[i + 2]) -
                        Math.min(px[i], px[i + 1], px[i + 2]);
            if (!(lum > 150 || (sat > 70 && lum > 90))) {
              px[i] *= 0.22; px[i + 1] *= 0.22; px[i + 2] *= 0.22;
            }
          }
          eg.putImageData(d, 0, 0);
          emis = new THREE.CanvasTexture(ec);
          emis.colorSpace = THREE.SRGBColorSpace;
          emis.flipY = piece.mat.map.flipY; // glTF uses flipY=false — must match
        }
        // no mask => emissive must stay BLACK, or the whole model glows
        // solid white (also silences THREE's undefined-emissiveMap warn)
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
          map: piece.mat.map, flatShading: true,
          color: piece.mat.color ?? 0xffffff,
          emissive: emis ? 0xffffff : 0x000000,
          emissiveIntensity: 0,
          ...(emis ? { emissiveMap: emis } : {}),
        }));
        if (emis) dn(mesh.material, { emissiveIntensity: [0, 0.9] });
        mesh.position.copy(l.pos);
        mesh.rotation.y = l.yaw != null
          ? l.yaw * Math.PI / 180
          : (l._autoYaw ?? 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.worldRoot.add(mesh);
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 34),
          dn(new THREE.LineBasicMaterial({ color: NIGHT ? 0x2b3441 : 0x5d6b76, transparent: true, opacity: 0.5 }), { color: [0x5d6b76, 0x2b3441] }));
        outline.position.copy(mesh.position);
        outline.rotation.copy(mesh.rotation);
        this.worldRoot.add(outline);
        occupy(l.pos.x, l.pos.z, l.clear);
        // nightlife venues ground their light: warm additive pool tinting
        // the street around the hero at night (color from data/heroes.json)
        if (l.glow) {
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
          const glowPool = new THREE.Mesh(gg2, dn(new THREE.MeshBasicMaterial({
            map: gtex, transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false }), { opacity: [0, 0.5] }));
          dnFn(t => { glowPool.visible = t < 0.98; });
          this.worldRoot.add(glowPool);
        }
        console.log(`[rando] landmark placed: ${l.id}`);
      } catch (e) {
        console.warn(`landmark ${l.id} failed to load`, e);
      }
    }

    // ---- venue labels: independent of any 3D hero model. Venues render
    // as regular registry buildings (consistent field); the LABEL is the
    // venue layer — anchored at the building's registry height, tinted by
    // the venue's glow color.
    for (const l of landmarks) {
      if (!l.name || l.lat == null) continue;
      const vp = new THREE.Vector3(l.pos.x, l.pos.y + (l.h ?? 12) + 6, l.pos.z);
      this.addLabel(l.name, "hero", 3, () => vp, l.glow ?? null);
    }

    // ---- OSM layers (Task 3): subway exits, crosswalks, street lights ----
    try {
      const layers = await (await fetch("data/itaewon_layers.json")).json();
      // EXITS — low stair-head canopies (clamped 3-4u) + code-text labels.
      // Where a hero model already stands on the exit (station), keep just
      // the label so the structures don't double up.
      const exitRoof = [], exitPost = [], exitPanel = [];
      for (const ex of layers.exits) {
        const p = geoPos(ex.lat, ex.lng);
        const heroClose = landmarks.some(l => l.glb &&
          (p.x - l.pos.x) ** 2 + (p.z - l.pos.z) ** 2 < 100);
        if (!heroClose) {
          const roof = new THREE.BoxGeometry(5.4, 0.4, 3.6);
          roof.translate(p.x, p.y + 3.2, p.z);
          exitRoof.push(roof);
          for (const [ox, oz] of [[-2.4, -1.5], [2.4, -1.5], [-2.4, 1.5], [2.4, 1.5]]) {
            const post = new THREE.BoxGeometry(0.3, 3.2, 0.3);
            post.translate(p.x + ox, p.y + 1.6, p.z + oz);
            exitPost.push(post);
          }
          const panel = new THREE.BoxGeometry(5.0, 1.15, 0.22);
          panel.translate(p.x, p.y + 0.85, p.z - 1.55);
          exitPanel.push(panel);
        }
        const xp = new THREE.Vector3(p.x, p.y + 4.6, p.z);
        this.addLabel(`Exit ${ex.ref ?? "?"}${ex.label ? " · " + ex.label : ""}`,
          "exit", 1.2, () => xp);
      }
      const addM = (geos, mat) => {
        if (!geos.length) return;
        const m = new THREE.Mesh(mergeGeometries(geos), mat);
        m.castShadow = false; m.receiveShadow = true;
        this.worldRoot.add(m);
      };
      addM(exitRoof, dn(new THREE.MeshLambertMaterial({ flatShading: true }), { color: [0x9aa1ab, 0x6d7890] }));
      addM(exitPost, dn(new THREE.MeshLambertMaterial({ flatShading: true }), { color: [0x767d88, 0x4c5468] }));
      addM(exitPanel, dn(new THREE.MeshLambertMaterial({
        // Seoul Line-6 ochre — instant "subway exit" recognition
        flatShading: true, emissiveIntensity: 0.9 }), { color: [0xb07c3a, 0x8a5c24], emissive: [0x000000, 0x7a4d16] }));

      // CROSSWALKS — instanced white zebra bars flat on the road surface.
      // bearingDeg was computed in the fetch's east/north meter frame, so
      // re-derive the axis in WORLD space via two projected points.
      const bars = [];
      for (const cr of layers.crossings) {
        const b = ((cr.bearingDeg ?? 0) * Math.PI) / 180;
        const p0 = geoPos(cr.lat, cr.lng);
        const p1 = geoPos(
          cr.lat + Math.sin(b) / 110540,
          cr.lng + Math.cos(b) / (111320 * Math.cos((cr.lat * Math.PI) / 180)));
        const ang = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        const dirX = Math.sin(ang), dirZ = Math.cos(ang);
        const n = Math.max(4, Math.min(14, Math.round((cr.length || 6) / 1.1)));
        for (let i = 0; i < n; i++) {
          const t = (i - (n - 1) / 2) * 1.1;
          bars.push({ x: p0.x + dirX * t, z: p0.z + dirZ * t, ang });
        }
      }
      if (bars.length) {
        // z-fight fix (station report): the big intersection stacks junction
        // pads + several sloped road boxes; bars at +0.56 sat inside flicker
        // range of their tops. Ride clearly above (+0.74) with polygonOffset
        // so the depth test never lands coplanar with asphalt.
        const barGeo = new THREE.BoxGeometry(4.2, 0.06, 0.55);
        const barMesh = new THREE.InstancedMesh(barGeo,
          dn(new THREE.MeshBasicMaterial({ color: 0xf0f2ee, transparent: true,
            opacity: NIGHT ? 0.42 : 0.68, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -4,
            polygonOffsetUnits: -4 }), { opacity: [0.68, 0.42] }), bars.length);
        const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(),
              UP = new THREE.Vector3(0, 1, 0), SC = new THREE.Vector3(1, 1, 1);
        bars.forEach((bar, i) => {
          Q.setFromAxisAngle(UP, bar.ang);
          M4.compose(new THREE.Vector3(bar.x, terrainY(bar.x, bar.z) + 0.74, bar.z), Q, SC);
          barMesh.setMatrixAt(i, M4);
        });
        barMesh.renderOrder = 3;
        this.worldRoot.add(barMesh);
      }

      // STREET LIGHTS — OSM lamps first (zone returned none; array kept for
      // when coverage improves), then procedural fill: walk every road
      // centerline at ~25u, offset to the sidewalk side, skipping spots the
      // decor pass already lit. Real point lights go to the N closest to the
      // nightlife core — mobile fragment-uniform budgets make unbounded
      // PointLight counts a real phone-crash risk — the rest glow via the
      // additive ground pools that already define the look.
      const lampPts = layers.lamps.map(lm => {
        const lp = geoPos(lm.lat, lm.lng);
        return { x: lp.x, z: lp.z };
      });
      const nearPts = (arr, x, z, r) =>
        arr.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < r * r);
      for (const road of data.roads) {
        const w = WID[road.t] ?? 11;
        if (w < 8) continue;
        let carry = 12, side = 1;
        for (let i = 0; i < road.p.length - 1; i++) {
          const [ax, az] = road.p[i], [bx2, bz2] = road.p[i + 1];
          const dx = bx2 - ax, dz = bz2 - az;
          const len = Math.hypot(dx, dz);
          if (len < 0.5) continue;
          const ang = Math.atan2(dx, dz);
          let d = carry;
          while (d < len) {
            const px = ax + (dx / len) * d, pz = az + (dz / len) * d;
            const off = w / 2 + 2.2;
            const lx = px + Math.cos(ang) * off * side;
            const lz = pz - Math.sin(ang) * off * side;
            side = -side;
            if (Math.hypot(lx, lz) < 1000 &&
                !nearPts(lampPts, lx, lz, 18) &&
                !nearPts(decorLampPts, lx, lz, 14) &&
                lampPts.length < 260) {
              lampPts.push({ x: lx, z: lz, source: "procedural" });
            }
            d += 25;
          }
          carry = d - len;
        }
      }
      if (lampPts.length) {
        const postGeo = new THREE.BoxGeometry(0.34, 6.8, 0.34);
        const headGeo = new THREE.BoxGeometry(0.95, 0.5, 0.95);
        const postM = new THREE.InstancedMesh(postGeo,
          dn(new THREE.MeshLambertMaterial({ flatShading: true }), { color: [0x6d7076, 0x3c4356] }), lampPts.length);
        const headM = new THREE.InstancedMesh(headGeo,
          dn(new THREE.MeshLambertMaterial({ color: 0xd8cba8, flatShading: true, emissive: 0xffc87d }),
            { emissiveIntensity: [0, 1.0] }), lampPts.length);
        const M4 = new THREE.Matrix4();
        lampPts.forEach((q, i) => {
          const y = terrainY(q.x, q.z);
          M4.identity().setPosition(q.x, y + 3.4, q.z);
          postM.setMatrixAt(i, M4);
          M4.identity().setPosition(q.x, y + 6.9, q.z);
          headM.setMatrixAt(i, M4);
        });
        this.worldRoot.add(postM, headM);
        {
          // warm pools under every lamp (additive, cheap), once it's dark
          const pcv = document.createElement("canvas");
          pcv.width = pcv.height = 128;
          const pg = pcv.getContext("2d");
          const grad = pg.createRadialGradient(64, 64, 4, 64, 64, 64);
          grad.addColorStop(0, "rgba(255,200,125,0.55)");
          grad.addColorStop(1, "rgba(255,200,125,0)");
          pg.fillStyle = grad;
          pg.fillRect(0, 0, 128, 128);
          const ptex = new THREE.CanvasTexture(pcv);
          const poolGeo = new THREE.PlaneGeometry(14, 14);
          poolGeo.rotateX(-Math.PI / 2);
          const poolM = new THREE.InstancedMesh(poolGeo,
            dn(new THREE.MeshBasicMaterial({ map: ptex, transparent: true,
              blending: THREE.AdditiveBlending, depthWrite: false }), { opacity: [0, 1] }),
            lampPts.length);
          lampPts.forEach((q, i) => {
            M4.identity().setPosition(q.x, terrainY(q.x, q.z) + 0.6, q.z);
            poolM.setMatrixAt(i, M4);
          });
          poolM.renderOrder = 3;
          dnFn(t => { poolM.visible = t < 0.98; });
          this.worldRoot.add(poolM);
          // real point lights: budgeted to the nightlife core
          const core = geoPos(37.5346, 126.9937);
          const ranked = [...lampPts].sort((a, b2) =>
            ((a.x - core.x) ** 2 + (a.z - core.z) ** 2) -
            ((b2.x - core.x) ** 2 + (b2.z - core.z) ** 2));
          // (off by day: lights coming and going recompile the
          // materials once, at the turn of dusk, not every frame)
          for (const q of ranked.slice(0, 14)) {
            const pl = dn(new THREE.PointLight(0xffd2a0, 1.15, 25, 1.8), { intensity: [0, 1.15] });
            pl.position.set(q.x, terrainY(q.x, q.z) + 6.6, q.z);
            dnFn(t => { pl.visible = t < 0.98; });
            this.worldRoot.add(pl);
          }
        }
      }
      // street-name labels: real road names anchored at the mean of each
      // road's registry buildings (crosscheck_heroes.py emits the data)
      try {
        const streets = await (await fetch("data/street_labels.json")).json();
        for (const st of streets) {
          const sp = geoPos(st.lat, st.lng);
          const slp = new THREE.Vector3(sp.x, sp.y + 30, sp.z);
          this.addLabel(st.name, "street", 4, () => slp);
        }
        console.log(`[rando] street labels: ${streets.length}`);
      } catch { /* optional layer */ }
      console.log(`[rando] layers: ${layers.exits.length} exits, ` +
        `${layers.crossings.length} crossings, ${lampPts.length} lamps ` +
        `(${layers.lamps.length} osm)`);
    } catch (e) {
      console.warn("[rando] itaewon layers skipped", e);
    }

    // ---- districts: nameable neighborhoods (recognizability layer) ----
    // A big tracked-out label + a faint terrain-hugging color wash per
    // district, so each street reads as a distinct "place" at a glance.
    const mkWash = (cx, cz, R, tint, op) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      const g2 = cv.getContext("2d");
      const col = new THREE.Color(tint);
      const grad = g2.createRadialGradient(64, 64, 8, 64, 64, 64);
      grad.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},${op})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 128, 128);
      const rings = 8, segs = 30, posA = [], uvA = [], idxA = [];
      for (let r = 0; r <= rings; r++) {
        for (let sg = 0; sg <= segs; sg++) {
          const a = (sg / segs) * Math.PI * 2, rr = (r / rings) * R;
          const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
          posA.push(x, terrainY(x, z) + 0.5, z);
          uvA.push(0.5 + Math.cos(a) * (r / rings) * 0.5,
                   0.5 + Math.sin(a) * (r / rings) * 0.5);
        }
      }
      for (let r = 0; r < rings; r++) {
        for (let sg = 0; sg < segs; sg++) {
          const a = r * (segs + 1) + sg, b2 = a + segs + 1;
          idxA.push(a, b2, a + 1, b2, b2 + 1, a + 1);
        }
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute("position", new THREE.Float32BufferAttribute(posA, 3));
      gg.setAttribute("uv", new THREE.Float32BufferAttribute(uvA, 2));
      gg.setIndex(idxA);
      const tex = new THREE.CanvasTexture(cv);
      const m2 = new THREE.Mesh(gg, dn(new THREE.MeshBasicMaterial({
        map: tex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false }), { opacity: [0.05 / 0.085, 1] }));
      m2.renderOrder = 1;
      this.worldRoot.add(m2);
    };
    for (const d of DISTRICTS) {
      const dp = geoPos(d.lat, d.lng);
      mkWash(dp.x, dp.z, 88, d.tint, 0.085);   // (by day 0.05: the material's opacity)
      const lp = new THREE.Vector3(dp.x, dp.y + 40, dp.z);
      this.addLabel(d.name, "district", 5, () => lp);
    }

    // ---- hero venue beacons: soft vertical light column at night so
    // waypoint venues read from across the map ("meet me by Jack's") ----
    {   // (made by day too, unseen: a sunset lights them live)
      const beamCv = document.createElement("canvas");
      beamCv.width = 32; beamCv.height = 128;
      const bg2 = beamCv.getContext("2d");
      const bgrad = bg2.createLinearGradient(0, 128, 0, 0);
      bgrad.addColorStop(0, "rgba(255,255,255,0.55)");
      bgrad.addColorStop(1, "rgba(255,255,255,0)");
      bg2.fillStyle = bgrad;
      bg2.fillRect(0, 0, 32, 128);
      const beamTex = new THREE.CanvasTexture(beamCv);
      for (const l of landmarks) {
        if (!l.glb || !l.glow) continue;
        const hgt = 46;
        const bgeo = new THREE.PlaneGeometry(2.0, hgt);
        const bmat = dn(new THREE.MeshBasicMaterial({
          map: beamTex, color: l.glow, transparent: true, opacity: 0.34,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide }), { opacity: [0, 0.34] });
        const beam = new THREE.Group();
        for (const ry of [0, Math.PI / 2]) {
          const pl = new THREE.Mesh(bgeo, bmat);
          pl.rotation.y = ry;
          beam.add(pl);
        }
        beam.position.set(l.pos.x, l.pos.y + hgt / 2 + 2, l.pos.z);
        beam.renderOrder = 4;
        dnFn(t => { beam.visible = t < 0.98; });
        this.worldRoot.add(beam);
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
        this.worldRoot.add(im);
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
        this.worldRoot.add(landmark);
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
      // near the camera the painted models, further out their light
      // versions (citytiles.js lodTree, as in the city round it): 150
      // painted trees were most of this map's triangles
      const rec = { inst: {} }, kinds = [];
      for (const [t, list] of Object.entries(tinst)) {
        if (!list.length) continue;
        kinds.push(t);
        const a = rec.inst[t] = new Float32Array(list.length * 16);
        list.forEach((mm, i) => mm.toArray(a, i * 16));
        if (!lib[t].lo) { lib[t].lo = lodTree(lib[t].geo, lib[t].mat.map?.image); lib[t].loMat = lib[t].mat.clone(); lib[t].loMat.map = null; lib[t].loMat.emissiveMap = null; lib[t].loMat.vertexColors = true; }
      }
      this.handTrees = { pools: treePools(this.worldRoot, lib, kinds), recs: [rec], state: {} };
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

  // ---- crisp DOM labels ----
  // Canvas-texture sprites inherit the world's 0.5x pixelation (that IS the
  // locked look for the WORLD — but pixelated text reads as a bug). Labels
  // are DOM nodes projected to screen per frame: vector-crisp glyphs at any
  // zoom, distance scale/fade, and priority-based decluttering in px space.
  // opts.city: the procedural city's own (a street of a chunk, a landmark);
  // anything else of these kinds once the hand-made map has loaded is
  // Itaewon's, hidden while the map is a city elsewhere
  addLabel(text, kind, pri, getPos, accent, opts = {}) {
    const el = document.createElement("div");
    el.className = `wlabel wl-${kind}`;
    if (accent) {
      const dot = document.createElement("i");
      dot.style.background = accent;
      el.appendChild(dot);
      if (kind === "hero") {
        const c = new THREE.Color(accent).lerp(new THREE.Color("#ffffff"), 0.55);
        el.style.color = `#${c.getHexString()}`;
      }
    }
    el.appendChild(document.createTextNode(text));
    this.labelLayer.appendChild(el);
    const rec = { el, getPos, pri, kind, len: text.length };
    if (this._loadingOld && !opts.city && ["street", "district", "hero", "exit"].includes(kind)) { rec.old = true; rec.hidden = cityOn; }
    this.labels.push(rec);
    return rec;
  },
  removeLabel(rec) {
    rec.el.remove();
    this.labels = this.labels.filter(l => l !== rec);
  },
  placeLabels() {
    if (!this.labelLayer || !this.labels.length) return;
    const W = this.frame.clientWidth, H = this.frame.clientHeight;
    const placed = [];
    for (const L of this.labels) {
      if (L.hidden) { L.el.style.display = "none"; continue; }
      const pos = L.getPos();
      if (!pos) { L.el.style.display = "none"; continue; }
      const v = pos.clone().project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) {
        L.el.style.display = "none"; continue;
      }
      const dist = this.camera.position.distanceTo(pos);
      // npc tags never fade, shrink, or distance-cull — always readable
      // while they're in view (past the haze they go with everything else;
      // a game's pings always show)
      const far = L.kind === "npc" ? Infinity
        : L.kind === "ping" ? 2600 : L.kind === "district" ? 980 : L.kind === "zone" ? 640 : 460;
      const fade = L.kind === "ping" ? 1 : this.rangeFade(pos);
      if (dist > far || fade <= 0.02) { L.el.style.display = "none"; continue; }
      const s = L.kind === "npc" || L.kind === "ping" ? 1 : Math.max(0.6, Math.min(1.22, 170 / dist));
      const op = fade * (L.kind === "npc" ? 1 : L.kind === "ping" ? (L.alpha ?? 1)
        : Math.max(0, Math.min(1, (far - dist) / (far * 0.22))));
      placed.push({ L, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H,
                    s, op, dist });
    }
    // declutter: high priority first, then nearest; losers hide entirely
    placed.sort((a, b) => (b.L.pri - a.L.pri) || (a.dist - b.dist));
    const kept = [];
    for (const c of placed) {
      const w = (c.L.len * 7.2 + 24) * c.s, h = 26 * c.s;
      const clash = kept.some(k => {
        const kw = (k.L.len * 7.2 + 24) * k.s, kh = 26 * k.s;
        return Math.abs(c.x - k.x) < (w + kw) / 2 &&
               Math.abs(c.y - k.y) < (h + kh) / 2;
      });
      if (clash) { c.L.el.style.display = "none"; continue; }
      kept.push(c);
      const el = c.L.el;
      el.style.display = "";
      el.style.opacity = c.op.toFixed(2);
      el.style.left = c.x + "px";
      el.style.top = c.y + "px";
      el.style.transform = `translate(-50%,-100%) scale(${c.s.toFixed(3)})`;
    }
  },

  registerZones(zones) {
    this._lastZones = zones;
    this.zoneRings.clear();
    for (const rec of this.labels.filter(l => l.kind === "zone")) this.removeLabel(rec);
    for (const z of zones.filter(z => z.kind !== "auto")) {
      // rings removed (user call): two glowing circles at the core anchors
      // read as designated empty plazas — zone identity is the LABEL now
      const p = geoPos(z.lat, z.lng);
      const zp = new THREE.Vector3(p.x, p.y + 26, p.z);
      this.addLabel(z.name ?? z.id, "zone", 3.5, () => zp);
    }
    this.needsRender = true;
  },

  chars: new Set(),      // every live modular character (for animation)
  remoteRecs: [],
  tickHooks: [],         // fn(t, dt) called every frame (arena engine, fx)

  // ---- archetype quest NPCs (static mascots at their locked venues) ----
  archRecs: {},          // id -> char rec (rec.meta.archId set)
  onArchNpcTap: null,    // set by backend.js; receives the ARCH_NPC_DEFS entry

  // per-archetype dynamic idles (group-level, same bob contract as every
  // character: tick writes an ABSOLUTE bob y; world tick re-adds terrain).
  // Only animated while rec.active — out of range they hold a static pose.
  ARCH_IDLES: {
    sway: (g, t, p, faceYaw) => {        // chill: slow calm float + lean
      g.position.y = Math.sin(t * 1.5 + p) * 0.10 + 0.10;
      g.rotation.z = Math.sin(t * 0.75 + p) * 0.06;
      g.rotation.y = faceYaw + Math.sin(t * 0.5 + p) * 0.05;
    },
    bounce: (g, t, p, faceYaw) => {      // chaos: restless hops, looks around
      g.position.y = Math.abs(Math.sin(t * 4.6 + p)) * 1.0;
      g.rotation.z = Math.sin(t * 9.2 + p) * 0.07;
      g.rotation.y = faceYaw + Math.sin(t * 2.3 + p) * 0.18;
    },
    jog: (g, t, p, faceYaw) => {         // sporty: quick light jog-in-place
      g.position.y = Math.abs(Math.sin(t * 7 + p)) * 0.5;
      g.rotation.x = 0.05 + Math.sin(t * 14 + p) * 0.02;
      g.rotation.y = faceYaw;
    },
  },

  spawnArchNpcs() {
    const loader = new GLTFLoader();
    for (const def of ARCH_NPC_DEFS) {
      loader.loadAsync(def.glb).then(g => {
        const src = g.scene;
        src.updateWorldMatrix(true, true);
        staticize(src);   // Tripo rig renders as static mesh (avatar3 rule)
        matteify(src);
        // normalize: chibi mascots stand a bit shorter than players
        const holder = new THREE.Group();
        holder.add(src);
        holder.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(holder);
        const size = new THREE.Vector3();
        box.getSize(size);
        const s = CHAR_H / size.y; // same stature as players/old blobs —
        holder.scale.setScalar(s); // chibi-short mascots vanished at map zoom
        holder.updateWorldMatrix(true, true);
        const b2 = new THREE.Box3().setFromObject(holder);
        holder.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
        const group = new THREE.Group();
        group.add(holder);
        group.rotation.y = def.yaw;
        const idle = this.ARCH_IDLES[def.idle] ?? this.ARCH_IDLES.sway;
        const api = {
          group,
          active: !!this.archActive[def.id], // sticky GPS proximity state
          walking: false,
          phase: Math.random() * Math.PI * 2,
          tick(t) {
            if (!this.active) {    // static pose out of range
              group.position.y = 0;
              group.rotation.z = 0;
              group.rotation.x = 0;
              group.rotation.y = def.yaw;
              return;
            }
            idle(group, t, this.phase, def.yaw);
          },
        };
        const pos = geoPos(def.lat, def.lng);
        const rec = this.makeChar(def, pos, this.scene, api, null);
        rec.meta = { archId: def.id, arch: def.arch, name: def.name };
        // dedicated always-readable tag (name · archetype) with a reserved
        // slot above for a future lobby countdown — see setNpcTimer
        rec.label = this.addNpcTag(def,
          () => rec.api.group.position.clone().setY(rec.api.group.position.y + CHAR_H + 3));
        this.archRecs[def.id] = rec;
        this.needsRender = true;
      }).catch(e => console.warn("[rando] arch npc load failed:", def.id, e));
    }
  },

  // NPC nametag: a stacked DOM label — hidden countdown slot on top (the
  // future "lobby active nearby" timer mounts there without relayout),
  // name · archetype pill below. Kind "npc" opts out of distance
  // fade/scale/decluttering in placeLabels: always visible, always
  // readable.
  addNpcTag(def, getPos) {
    const el = document.createElement("div");
    el.className = "wlabel wl-npc";
    const timer = document.createElement("div");
    timer.className = "npc-timer";
    timer.hidden = true;
    const name = document.createElement("div");
    name.className = "npc-name";
    name.textContent = def.name;
    const arch = document.createElement("span");
    arch.className = "npc-arch";
    arch.textContent = " · " + def.arch.toUpperCase();
    name.appendChild(arch);
    el.appendChild(timer);
    el.appendChild(name);
    this.labelLayer.appendChild(el);
    const rec = { el, getPos, pri: 6, kind: "npc", len: def.name.length + def.arch.length + 3, timer };
    this.labels.push(rec);
    return rec;
  },

  // future-lobby hook: text shows a countdown chip above the NPC's name,
  // null hides it. Layout is already reserved — nothing shifts.
  setNpcTimer(id, text) {
    const rec = this.archRecs[id]?.label;
    if (!rec?.timer) return;
    rec.timer.hidden = text == null;
    rec.timer.textContent = text ?? "";
    this.needsRender = true;
  },

  // GPS proximity result from backend: in range -> dynamic idle runs.
  // Sticky: the backend may report before the async GLB finishes loading,
  // so the desired state is kept and applied at spawn.
  archActive: {},
  setArchNpcActive(id, active) {
    this.archActive[id] = active;
    const rec = this.archRecs[id];
    if (rec) { rec.api.active = active; this.needsRender = true; }
  },

  makeChar(avatarCfg, pos, parent, apiOverride, handle) {
    const api = apiOverride
      ?? (LEGACY_CHAR ? undefined : makeHumanCharacterSync(avatarCfg) ?? undefined)
      ?? makeCharacter(avatarCfg);
    api.group.traverse(o => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = true; });
    api.group.position.copy(pos);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.25,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(5.4, 2.6, 1);
    // hug the ground: the old +0.42 lift read as a ring around the shins
    // and made everyone look airborne at map zoom
    shadow.position.set(pos.x, pos.y + 0.08, pos.z);
    parent.add(api.group);
    parent.add(shadow);
    // character tick()s write group.position.y as an ABSOLUTE bob offset
    // (blob/humanoid contract), which flattened everyone onto y≈0 — floating
    // at the station plaza (terrain ≈ −2), sunk to the knees uphill. The
    // world owns the terrain base; tick() re-adds it after the bob (below).
    const rec = { api, shadow, walkTarget: null, baseY: terrainY(pos.x, pos.z) };
    if (handle) { // crisp DOM name pill following the head (a PERSON cue)
      rec.label = this.addLabel(handle, "player", 2,
        () => api.group.position.clone().setY(api.group.position.y + 21.5));
    }
    this.chars.add(rec);
    return rec;
  },

  removeChar(rec, parent) {
    parent.remove(rec.api.group);
    parent.remove(rec.shadow);
    rec.api.dispose?.();            // frees per-instance materials/textures
    rec.shadow.geometry.dispose();  // shadow disc is minted per character
    rec.shadow.material.dispose();
    if (rec.label) this.removeLabel(rec.label);
    this.chars.delete(rec);
  },

  refreshChars() { // re-issue last placements (e.g. once a template lands)
    if (this._lastRemotes) this.setRemotes(this._lastRemotes);
    if (this._lastPlayerOpts) this.setPlayer(this._lastPlayerOpts);
    this.needsRender = true;
  },

  setPlayer(opts) { // { avatar, lat, lng } | null
    if (opts) this.worldAt(opts.lat, opts.lng);
    this._lastPlayerOpts = opts || null;
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
      } else if (!LEGACY_CHAR) {
        const token = (this._glbToken = (this._glbToken ?? 0) + 1);
        const arrive = api => {
          if (token !== this._glbToken) return;
          if (this.player) { this.removeChar(this.player, this.scene); this.player = null; }
          install(api);
        };
        (ANIM_CHAR ? makeAnimatedCharacter : makeHumanCharacter)(opts.avatar)
          .then(api => api.ready.then(() => arrive(api)))
          // anim clips missing/broken -> static humanoid -> blob
          .catch(() => makeHumanCharacter(opts.avatar).then(arrive)
            .catch(() => install(undefined)));
      } else {
        install(undefined);
      }
    } else {
      this.followPos = null;
    }
    this.needsRender = true;
  },

  setRemotes(list) { // [{ avatar, lat, lng, slot }]
    this._lastRemotes = list;
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
    const p = geoPos(lat, lng); // p.y is the terrain height at the zone
    this.anchor(el, () => new THREE.Vector3(p.x, p.y + headY, p.z));
  },
  anchorAtNpc(el, npcId) {
    const n = ARCH_NPC_DEFS.find(n => n.id === npcId);
    if (!n) return;
    this.anchorAtZone(el, n.lat, n.lng);
  },
  anchorAtPlayer(el, headY = CHAR_H + 1) {
    this.anchor(el, () => {
      if (!this.player) return null;
      const p = this.player.api.group.position;
      return new THREE.Vector3(p.x, this.player.baseY + headY, p.z);
    });
  },
  placeAnchor(a) {
    if (!a.el.isConnected) return false;
    const pos = a.getPos();
    if (!pos) { a.el.style.display = "none"; return true; }
    const fade = this.rangeFade(pos);
    const v = pos.project(this.camera);
    if (v.z > 1 || fade <= 0.02) { a.el.style.display = "none"; return true; }
    a.el.style.display = "";
    a.el.style.opacity = fade >= 0.99 ? "" : fade.toFixed(2);
    a.el.style.left = ((v.x * 0.5 + 0.5) * this.frame.clientWidth) + "px";
    a.el.style.top = ((-v.y * 0.5 + 0.5) * this.frame.clientHeight) + "px";
    return true;
  },

  // ---- camera ----
  applyCamera() {
    const { pos, look } = this.camPose(this.target, this.cam);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this._viewAt = null;
    this.needsRender = true;
  },
  // where the camera stands and what it looks at for a target and a
  // { theta, elev, dist }: in the map's view it looks a little ahead of you
  // (you in the lower middle of the screen, Pokémon GO style); the
  // scenery and a free view look straight at the target
  camPose(t, { theta, elev, dist }, map = this.rangeOn) {
    const ahead = map ? dist * ZOOM.ahead * Math.cos(elev) : 0;
    return {
      pos: new THREE.Vector3(t.x + dist * Math.sin(theta) * Math.cos(elev), t.y + dist * Math.sin(elev), t.z + dist * Math.cos(theta) * Math.cos(elev)),
      look: new THREE.Vector3(t.x - Math.sin(theta) * ahead, t.y + CHAR_H + 4, t.z - Math.cos(theta) * ahead),
    };
  },
  // a game that frames the map itself (Manhunt's zone overview) sets its own
  // fog and camera: the map's haze and look-ahead step aside until it's done
  setFreeView(on) {
    on = !!on;
    if (on === this.freeView) return;
    this.freeView = on;
    this.restoreFog();
    this.applyCamera();
  },
  // the classic depth fog (STYLE.md), for the scenery and a free view
  restoreFog() {
    const f = this.scene?.fog;
    if (f && f.near < 0) { f.near = cityOn ? 300 : 340; f.far = cityOn ? 980 : 1250; }
    this._rangeWas = false;
    this.needsRender = true;
  },
  // the map's view range, every tick: the haze round you (a fog by ground
  // distance from you, see the fog chunks up top), easing in after the
  // scenery so it never pops
  updateRange(dt) {
    const f = this.scene?.fog;
    if (!f) return;
    if (this.haze) { this.haze.visible = this.rangeOn; this.haze.position.set(this.target.x, 140, this.target.z); }
    if (!this.rangeOn) { if (this._rangeWas) this.restoreFog(); return; }
    if (!this._rangeWas) { this._rangeWas = true; this.fogR = Math.max(VIEW.R, 640); }
    if (this.fogR !== VIEW.R) { this.fogR += (VIEW.R - this.fogR) * Math.min(1, dt * 2.5); if (Math.abs(this.fogR - VIEW.R) < 0.5) this.fogR = VIEW.R; }
    const back = Math.max(0.01, this.cam.dist * Math.cos(this.cam.elev));
    if (f.near !== -back || f.far !== this.fogR) { f.near = -back; f.far = this.fogR; this.needsRender = true; }
  },
  get rangeOn() { return this.mapView && !this.freeView && !!this.scene?.fog; },
  // how much of a world point is out of the haze (1 clear .. 0 gone): DOM
  // things pinned to the map (names, notes, beacons, labels) fade with it
  rangeFade(p) {
    if (!this.rangeOn || !p) return 1;
    const d = Math.hypot(p.x - this.target.x, p.z - this.target.z), R = this.fogR;
    return 1 - sstep((d - 0.7 * R) / (0.2 * R));
  },
  // what to load and draw round the target (world units): in the map's view
  // the haze's radius plus a buffer; otherwise (the scenery, a free view,
  // the tests' top-down shots) as far as the camera can see the ground
  viewRange() {
    if (this.rangeOn) return { load: Math.max(this.fogR, VIEW.R) + VIEW.buffer, near: VIEW.R, show: this.fogR + 12 };
    const key = `${this.camera.position.x},${this.camera.position.y},${this.camera.position.z},${this.target.x},${this.target.z},${this.scene.fog?.far}`;
    if (this._viewAt !== key) {
      this._viewAt = key;
      const cam = this.camera, T = this.target, f = this.scene.fog;
      cam.updateMatrixWorld();
      const fwd = cam.getWorldDirection(new THREE.Vector3()), d = new THREE.Vector3();
      let r = 0;
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
        d.set(i / 4 - 1, j / 4 - 1, 0.5).unproject(cam).sub(cam.position).normalize();
        let k = d.y < -1e-4 ? (T.y - cam.position.y) / d.y : Infinity;
        const kMax = Math.min(cam.far, f && f.near >= 0 ? f.far / Math.max(0.05, d.dot(fwd)) : Infinity);
        k = Math.min(k, kMax);
        r = Math.max(r, Math.hypot(cam.position.x + d.x * k - T.x, cam.position.z + d.z * k - T.z));
      }
      this._viewR = Math.min(720, Math.max(VIEW.R + VIEW.buffer, r + 40));
    }
    return { load: this._viewR, near: this._viewR * 0.55, show: Infinity };
  },

  recenter() {
    this.observing = false;
    this.camGoal = { ...this.CAM_DEFAULT };
  },

  // explore mode: while invisible you can look around within radiusM metres
  // of your real location (read on this phone, never sent); null turns it off
  setExplore(lat, lng, radiusM = 1500) {
    if (lat == null || lng == null) { this.homePos = null; this.exploreR = null; this._lastExplore = null; return; }
    this.worldAt(lat, lng);
    this._lastExplore = [lat, lng, radiusM];
    this.homePos = geoPos(lat, lng);
    this.exploreR = radiusM * GEO_SCALE;
    this.clampTarget();
    this.needsRender = true;
  },
  clampTarget() {
    if (this.homePos && this.exploreR) {
      const dx = this.target.x - this.homePos.x, dz = this.target.z - this.homePos.z, d = Math.hypot(dx, dz);
      if (d > this.exploreR) { this.target.x = this.homePos.x + dx / d * this.exploreR; this.target.z = this.homePos.z + dz / d * this.exploreR; }
    }
    const box = cityOn ? 8000 : this.blending ? 2000 : 1100;
    this.target.x = Math.max(-box, Math.min(box, this.target.x));
    this.target.z = Math.max(-box, Math.min(box, this.target.z));
  },
  // how far the camera has wandered from where it would rest (world units)
  awayFromHome() {
    const goal = this.followPos ?? this.homePos ?? new THREE.Vector3(0, 0, 0);
    return Math.hypot(this.target.x - goal.x, this.target.z - goal.z);
  },
  setPaused(on) { this.paused = !!on; if (!on) this.needsRender = true; },
  // the buildings are up (loaded and risen): the start screen's still image
  // can give way to the live city
  built: false,
  _builtFns: [],
  whenBuilt() { return this.built ? Promise.resolve() : new Promise(r => this._builtFns.push(r)); },
  // skip the rise: everything at full height now
  finishRise() {
    if (!this.risers) return;
    for (const [m, o] of this.risers.items) { m.scale.y = 1; o.scale.y = 1; }
    this.risers.t0 = -1e9;
    this.needsRender = true;
  },
  maxFps: 0,                   // 0 = every frame; the start screen draws at 30
  _lastDraw: 0,

  // One-finger drag PANS (free observer); two fingers pinch-zoom, twist to
  // rotate, move vertically together to tilt. Desktop: drag pans, wheel
  // zooms, right-click or Ctrl+drag orbits. Recenter returns to follow.
  // tap-to-chat: short, drag-free press on a remote character fires
  // onCharTap(meta). Set by backend.js; meta = { userId, handle, avatar }.
  onCharTap: null,
  tryCharTap(clientX, clientY) {
    const archList = Object.values(this.archRecs);
    if ((!this.onCharTap || !this.remoteRecs.length) &&
        (!this.onArchNpcTap || !archList.length)) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets = [
      ...this.remoteRecs.map(x => x.api.group),
      ...archList.map(x => x.api.group),
    ];
    const hits = ray.intersectObjects(targets, true);
    if (!hits.length) return;
    let node = hits[0].object;
    while (node) {
      const rec = this.remoteRecs.find(x => x.api.group === node);
      if (rec?.meta?.userId) { this.onCharTap?.(rec.meta); return; }
      const arch = archList.find(x => x.api.group === node);
      if (arch?.meta?.archId) {
        const def = ARCH_NPC_DEFS.find(d => d.id === arch.meta.archId);
        if (def) this.onArchNpcTap?.(def, arch.api.active);
        return;
      }
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
          tilt0: this.cam.elev - elevFor(this.cam.dist),   // your own tilt on top of the zoom's
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
        // zoom out: higher and more top-down; zoom in: lower, toward the horizon
        this.cam.dist = Math.min(this.freeView ? 1500 : ZOOM.max, Math.max(ZOOM.min, gesture.dist0 * (gesture.d0 / d)));
        this.cam.theta = gesture.theta0 + (ang - gesture.a0);
        const tilt = Math.min(0.35, Math.max(-0.35, gesture.tilt0 + ((a.y + b.y) / 2 - gesture.midY0) * 0.004));
        this.cam.elev = Math.min(1.25, Math.max(0.22, elevFor(this.cam.dist) + tilt));
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
        this.clampTarget();
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
      const tilt = this.cam.elev - elevFor(this.cam.dist);
      this.cam.dist = Math.min(this.freeView ? 1500 : ZOOM.max, Math.max(ZOOM.min, this.cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      this.cam.elev = Math.min(1.25, Math.max(0.22, elevFor(this.cam.dist) + tilt));
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

  // the light right now for the place the map shows, applied to everything
  // that has a day and a night: the rig, the fog, the sky, the registry, the
  // city chunks' uniforms, and the page's glass (--day)
  applyLight(t, force = false) {
    if (t === this.light && !force) return;
    this.light = t;
    const n = 1 - t;
    for (const { mat, pairs } of DN) for (const [k, [d, nv]] of Object.entries(pairs)) {
      if (typeof d === "number") mat[k] = d + (nv - d) * n;
      else mat[k].copy(d).lerp(nv, n);
    }
    for (const f of DN_FN) f(t);
    const rig = lerpRig(t);
    if (this.hemi) { this.hemi.color.copy(rig.hemiSky); this.hemi.groundColor.copy(rig.hemiGround); this.hemi.intensity = rig.hemiInt; }
    if (this.sun) { this.sun.color.copy(rig.sunCol); this.sun.intensity = rig.sunInt; }
    if (this.scene?.fog) this.scene.fog.color.copy(rig.fog);
    this.haze?.material.color.copy(rig.fog);
    if (this.scene?.background?.isColor) this.scene.background.copy(rig.fog);
    cityUniforms.uNight.value = n;
    this.city?.setLight?.(t);
    this.needsRender = true;
  },
  // the sun over the place on screen, re-read every 5 s (every tick while a
  // test runs the sun's clock fast), and at once when the world moves (a
  // dev override or a forced mode pins the light, daylight.js)
  sunTick(force = false) {
    const now = performance.now();
    if (!force && this.light != null && now - (this._sunAt || 0) < (sunClockFast() ? 80 : 5000)) return;
    this._sunAt = now;
    const [lat, lng] = this.shownSpot(), date = sunNow();
    const t = sunlight(lat, lng, date);
    this._sun = { lat, lng, date, t, ...sunPosition(lat, lng, date) };
    this.applySun(this._sun);
    this.applyLight(t, force);
  },
  relight() { this.sunTick(true); },
  // the place on screen: the ground under the camera's target, in whichever
  // world is up (its origin is GEO_CENTER: Itaewon, or the city's own)
  shownSpot() { return geoInv(this.target.x, this.target.z); },
  // for the tests and the dev chip: the sun over the place on screen
  sunInfo() {
    const s = this._sun;
    if (!s) return null;
    const c = localClock(s.lat, s.lng, s.date);
    return { lat: s.lat, lng: s.lng, at: s.date.toISOString(), alt: s.altitude, bearing: s.bearing, light: s.t, clock: c.text, zone: c.zone, shadow: shadowDir(this.shadowSun).map(v => v.toFixed(3)).join(","), key: this.keyDir };
  },
  // the key light comes from the real sun (by day; from the classic high
  // moonlight at night, blended through dusk; a forced light keeps the
  // classic one), and the hand-made map's shadows fall away from it
  applySun({ altitude, bearing, t }) {
    const k = FORCED ? 0 : sstep((t - 0.35) / 0.3);
    const a = Math.max(12, altitude) * Math.PI / 180, b = bearing * Math.PI / 180;
    const v = new THREE.Vector3(Math.cos(a) * Math.sin(b), Math.sin(a), -Math.cos(a) * Math.cos(b));
    const d = CLASSIC_SUN.clone().lerp(v, k).normalize();
    this.keyDir = d.toArray();
    this.sun?.position.copy(d).multiplyScalar(300);
    this.shadowSun = FORCED || t < 0.5 ? null : { altitude, bearing };
    this.bakeShadows();
    if (this.shadowMesh) { this.shadowMesh.material.opacity = 0.32 * (FORCED ? 1 : sstep(Math.abs(t - 0.5) / 0.2)); this.shadowMesh.visible = this.shadowMesh.material.opacity > 0.005; }
  },
  // the hand-made map's baked shadows (STYLE.md 5.6): each footprint swept
  // away from the sun, by k = min(52, 6 + 0.95 h) times a length from the
  // sun's height (the classic sweep at night or when the light is forced).
  // Re-swept only when the sun has moved a step (10° round, or its height
  // changed the length a tenth): about every 40 minutes, a few ms
  bakeShadows(now = false) {
    const src = this._shadowSrc;
    if (!src) return;
    const dir = shadowDir(this.shadowSun);
    const key = `${dir[0].toFixed(3)},${dir[1].toFixed(3)}`;
    if (key === this._shadowKey) return;
    this._shadowKey = key;
    let n = 0;
    for (const { ring, tris } of src) n += ring.length * 6 + tris.length * 3;
    // (a re-sweep runs a slice a tick, 4 ms at most, and swaps in when done:
    // ~4,000 footprints are 30-100 ms of work, never one frame's)
    this._bake = { dir, pos: new Float32Array(n * 3), i: 0, b: 0, ms: 0 };
    this.bakeStep(now ? Infinity : 4);
  },
  bakeStep(budget) {
    const J = this._bake, src = this._shadowSrc;
    if (!J || !src) return;
    const t0 = performance.now(), { dir, pos } = J;
    let i = J.i, yo = this._bakeYo ??= new Float32Array(64);
    // (the ground's height once a corner: the footprint's kept, the swept one's per sweep)
    const put = (X, y, Z) => { pos[i++] = X; pos[i++] = y + 0.5; pos[i++] = Z; };
    while (J.b < src.length) {
      const s = src[J.b++];
      const { ring, k, tris } = s, m = ring.length, ox = dir[0] * k, oz = dir[1] * k;
      const yb = s.yb ??= Float32Array.from(ring, ([x, z]) => terrainY(x, z));
      if (yo.length < m) yo = this._bakeYo = new Float32Array(m * 2);
      for (let e = 0; e < m; e++) yo[e] = terrainY(ring[e][0] + ox, ring[e][1] + oz);
      for (let e = 0; e < m; e++) {
        const f = (e + 1) % m, [ax, az] = ring[e], [bx, bz] = ring[f];
        put(ax, yb[e], az); put(bx, yb[f], bz); put(bx + ox, yo[f], bz + oz);
        put(ax, yb[e], az); put(bx + ox, yo[f], bz + oz); put(ax + ox, yo[e], az + oz);
      }
      for (const tr of tris) for (const vi of tr) put(ring[vi][0] + ox, yo[vi], ring[vi][1] + oz);
      if ((J.b & 63) === 0 && performance.now() - t0 > budget) break;
    }
    J.i = i; J.ms += performance.now() - t0;
    if (J.b < src.length) return;
    this._bake = null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    this.shadowMesh.geometry.dispose();
    this.shadowMesh.geometry = g;
    this.shadowBakeMs = J.ms;
    this.needsRender = true;
  },
  tick() {
    this.sunTick();
    if (this._bake) this.bakeStep(4);
    // covered by a full-screen screen (party room, style): nothing to draw
    if (this.paused) { this.lastT = performance.now() / 1000; return; }
    const t = performance.now() / 1000;
    const dt = Math.min(0.2, t - this.lastT || 0.016);
    this.lastT = t;

    // animate characters: walking movement + idle/waddle cycles
    if (this.chars.size) this.needsRender = true;
    for (const rec of this.chars) {
      // joystick-driven velocity (arena/sim movement): overrides walkTarget
      if (rec.walkVel && (rec.walkVel.x || rec.walkVel.z)) {
        const gp = rec.api.group.position;
        const vx = rec.walkVel.x, vz = rec.walkVel.z;
        rec.walkTarget = null;
        rec.api.walking = true;
        rec.api.group.rotation.y = Math.atan2(vx, vz);
        gp.x += vx * dt; gp.z += vz * dt;
        rec.baseY = terrainY(gp.x, gp.z);
      } else if (rec.walkVel && rec.api.walking && !rec.walkTarget) {
        rec.api.walking = false;
      }
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
          rec.baseY = terrainY(gp.x, gp.z); // hug the hillside mid-walk
        }
      }
      // zero y, let tick() write its absolute bob (GLB clips leave y alone),
      // then lift by the terrain base the world owns
      rec.api.group.position.y = 0;
      rec.api.tick(t);
      rec.api.group.position.y += rec.baseY;
      rec.shadow.position.set(rec.api.group.position.x,
        terrainY(rec.api.group.position.x, rec.api.group.position.z) + 0.08,
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
      if (done) {
        this.risers = null;
        this.built = true;
        for (const f of this._builtFns.splice(0)) f();
      }
    }

    // glide the camera target home — unless the user is roaming free
    if (!this.observing) {
      const goal = this.followPos ?? this.homePos ?? new THREE.Vector3(0, 0, 0);
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
    for (const fn of this.tickHooks) { try { fn(t, dt); } catch (e) { console.warn("[rando] tick hook", e); } }
    this.updateRange(dt);
    const range = this.viewRange();
    // the warm city (built ahead, out of sight) streams round its own spot, for the map's view
    const W = this._warm;
    if (W?.city) { const [x, z] = W.city.P.fwd(W.spot[1], W.spot[0]); (W.at ??= new THREE.Vector3()).set(x, 0, z); W.city.update(W.at, { load: VIEW.R + VIEW.buffer, near: VIEW.R, show: Infinity }); }
    if (this.city) {
      this.city.update(this.target, range);
      // the ground and the sky go where you go (snapped: the paving stays put)
      const P = this.groundPeriod || 80;
      this.ground?.position.set(Math.round(this.target.x / P) * P, this.groundLevel ?? 0, Math.round(this.target.z / P) * P);
      // (round Itaewon the paving follows the hills: heights again when it moves)
      if (this._hillOn && this.ground && this._hillAt !== `${this.ground.position.x},${this.ground.position.z}`) {
        const gp = this.ground.position, pos = this._hillGeo.attributes.position;
        this._hillAt = `${gp.x},${gp.z}`;
        for (let i = 0; i < pos.count; i++) pos.setY(i, itaewonHill(gp.x + pos.getX(i), gp.z + pos.getZ(i)));
        pos.needsUpdate = true;
        this._hillGeo.computeVertexNormals();
        this._hillGeo.computeBoundingSphere();
      }
      this.sky?.position.set(this.target.x, 430, this.target.z);
      this.skyCap?.position.set(this.target.x, 1725, this.target.z);
    }
    // the hand-made map's trees: painted near the camera, light further out
    if (this.handTrees && this.worldRoot?.visible && fillPools(this.handTrees.pools, this.handTrees.recs, this.camera, this.handTrees.state, false, range.show < Infinity ? { x: this.target.x, z: this.target.z, r: range.show } : null)) this.needsRender = true;
    this.anchors = this.anchors.filter(a => this.placeAnchor(a));
    this.placeLabels();
    if (this.needsRender && !(this.maxFps && t - this._lastDraw < 1 / this.maxFps - 0.004)) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
      this._lastDraw = t;
    }
  },
};
