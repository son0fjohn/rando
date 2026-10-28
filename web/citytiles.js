// City chunks, on the map: streams procedural city chunks around the camera
// target (the player, or wherever you've panned in Explore). Data is one
// PMTiles archive of z16 chunks (scripts/bake_city_tiles.py; web/tiles/ for
// tests, a worldwide build on R2 in production); geometry is built in a
// worker (citygen.worker.js -> citygen.js) and mounted here with shared
// materials that follow STYLE.md (web/style.js): Itaewon's four painted
// window tiles whose night lights are picked per building in the shader (six
// variants, 12 % lit), flat roofs, the baked shadow film, awnings, sign
// panels, bins, asphalt, the lawn tile, water, and instanced street lights,
// power poles with wires and lanterns, and the painted GLB trees.
//
// Rings: chunks within NEAR tiles of the target get full detail (the street
// pass, lamps, poles, outlines); out to FAR they're walls + roofs + shadows
// + parks; beyond that they're dropped. Everything is deterministic per
// chunk, so a chunk you left looks the same when you come back.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { buildChunk, projector, lngLatToTile, FLOOR_U } from "./citygen.js";
import { STYLE } from "./style.js";
import { PMTiles } from "./pmtiles.js";
import { THEME } from "./theme.js";

const Z = 16;
const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const NEAR = 1, FAR = 2, DROP = 3;
const MAX_INFLIGHT = 3;

function canvas(w, h, draw) {
  const c = typeof OffscreenCanvas !== "undefined" && !globalThis.document
    ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  draw(c.getContext("2d"), w, h);
  return c;
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 5.4: Itaewon's painted window tile per class. 256 px is 13 u across and
// 10.4 u up, on a uniform cell grid (cols × rows) so the night shader lights
// whole windows: the map (the wall field, dark glass with a pale band), and
// the mask (white where there's glass, a pixel larger: the light bleeds)
export function facadeTile(cls) {
  const W = 256, [cols, rows] = STYLE.cells[cls];
  const cw = W / cols, rh = W / rows, R = Math.round;
  const cells = [];
  const map = canvas(W, W, g => {
    g.fillStyle = STYLE.wallField; g.fillRect(0, 0, W, W);
    const win = (x, y, w, h) => { g.fillStyle = STYLE.glass; g.fillRect(x, y, w, h); g.fillStyle = STYLE.glassBand; g.fillRect(x, R(y + h * 0.38), w, 4); cells.push([x, y, w, h]); };
    if (cls === "shop") {           // two rows of windows over a sign band and a glass storefront
      for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) win(R(c * cw + 11), R(r * rh + 22), 42, 40);
      const y2 = R(2 * rh);
      g.fillStyle = STYLE.shop.signBand; g.fillRect(8, y2 + 2, W - 16, 18);
      g.fillStyle = STYLE.shop.storefront; g.fillRect(8, y2 + 24, W - 16, W - y2 - 28); cells.push([8, y2 + 24, W - 16, W - y2 - 28]);
    } else if (cls === "office") {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) win(R(c * cw + 8), R(r * rh + 10), 36, 30);
    } else if (cls === "res") {     // a balcony rail under each window
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { win(R(c * cw + 20), R(r * rh + 20), 46, 42); g.fillStyle = STYLE.res.rail; g.fillRect(R(c * cw + 12), R(r * rh + 68), 60, 4); }
    } else {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) win(R(c * cw + 11), R(r * rh + 9), 42, 34);
    }
  });
  const mask = canvas(W, W, m => { m.fillStyle = "#000"; m.fillRect(0, 0, W, W); m.fillStyle = "#fff"; for (const [x, y, w, h] of cells) m.fillRect(x - 1, y - 1, w + 2, h + 2); });
  return { map, mask, cols, rows, cells };
}
// pixel art stays crisp up close (nearest), mipmapped further away
function pixelTex(c, srgb = true) { const t = tex(c, srgb); t.magFilter = THREE.NearestFilter; return t; }

const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const glslColor = hex => `vec3(${[16, 8, 0].map(sh => lin(((hex >> sh) & 255) / 255).toFixed(4)).join(", ")})`;
// 5.5 the six lit-window variants as a nested ternary on the variant number
const variantGlsl = key => STYLE.lit.map((v, i) => i < STYLE.lit.length - 1 ? `var < ${i}.5 ? ${v[key].toFixed(2)} : ` : v[key].toFixed(2)).join("");
const pick3 = (name, hexes) => `vec3 ${name} = h3 < 0.3333 ? ${glslColor(hexes[0])} : h3 < 0.6667 ? ${glslColor(hexes[1])} : ${glslColor(hexes[2])};`;

// the shared night uniform: every city material reads it, so a hero model,
// a tower and a street lamp all light up together
export const cityUniforms = {
  uNight: { value: 0 },
  uNightWall: { value: new THREE.Color(...STYLE.moon) },   // 2: the moonlight on everything lit
  uWet: { value: 0 },
  // the see-through cut: buildings between the camera and you dither away
  uCutA: { value: new THREE.Vector3(0, 1e6, 0) },
  uCutB: { value: new THREE.Vector3(0, 1e6, 0) },
  uCutR: { value: 15 },
};

// splice the see-through cut into any material's shaders
function cut(sh) {
  Object.assign(sh.uniforms, { uCutA: cityUniforms.uCutA, uCutB: cityUniforms.uCutB, uCutR: cityUniforms.uCutR });
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vCutPos;")
    .replace("#include <project_vertex>", "#include <project_vertex>\nvCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vCutPos;\nuniform vec3 uCutA;\nuniform vec3 uCutB;\nuniform float uCutR;")
    .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
      {
        vec3 ab = uCutB - uCutA;
        float t = clamp(dot(vCutPos - uCutA, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
        float d = length(vCutPos - (uCutA + ab * t));
        if (t < 0.97 && vCutPos.y > uCutB.y + 1.2) {
          float chk = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
          if (d < uCutR * 0.75 || (d < uCutR && chk < 0.5)) discard;
        }
      }`);
}

function patch(mat, { facade = false, cells = null, panel = false, darken = true } = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, cityUniforms);
    if (cells) sh.uniforms.uCells = { value: new THREE.Vector2(cells[0], cells[1]) };
    cut(sh);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float seed;\nvarying float vSeed;\nvarying vec2 vCellUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvSeed = seed;\nvCellUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec3 uNightWall;\nuniform float uWet;\nuniform vec2 uCells;\nvarying float vSeed;\nvarying vec2 vCellUv;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" +
        (darken ? "diffuseColor.rgb *= mix(vec3(1.0), uNightWall, uNight);\ndiffuseColor.rgb *= 1.0 - uWet * 0.12;\n"
          : panel ? `diffuseColor.rgb *= mix(1.0, ${STYLE.panel.nightMul.toFixed(2)}, uNight);\n` : ""))
      .replace("#include <emissivemap_fragment>", facade ? `
        #ifdef USE_EMISSIVEMAP
          vec4 emC = texture2D( emissiveMap, vEmissiveMapUv );
          // the seed carries the building's lit variant (whole part) and its
          // own hash (fraction, rounded back to an integer so nothing flickers)
          float var = floor(vSeed + 0.0005);
          float sq = floor(fract(vSeed) * 997.0 + 0.5);
          vec2 cell = mod(floor(vCellUv * uCells) + vec2(sq * 13.0, sq * 7.0), 289.0);
          float hh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float h2 = fract(hh * 7.13);
          float h3 = fract(hh * 3.71);
          float p = ${variantGlsl("p")};
          float ws = ${variantGlsl("w")};
          float e = ${variantGlsl("e")};
          ${pick3("warm", STYLE.warm)}
          ${pick3("cool", STYLE.cool)}
          vec3 wc = h2 < ws ? warm : cool;
          totalEmissiveRadiance = emC.rgb * wc * step(hh, p) * e * uNight;
        #endif` : panel ? `
          totalEmissiveRadiance = vColor * ${STYLE.panel.glow.toFixed(2)} * uNight;` : "#include <emissivemap_fragment>");
  };
  mat.customProgramCacheKey = () => `city-${facade ? "f" + cells.join("x") : panel ? "p" : "n"}${darken ? "d" : ""}`;
  return mat;
}

// 5.9 the painted trees, loaded once: scaled to their height, feet at y 0,
// texture desaturated to 80 %, the body dimmed at night
let treeLib = null;
function loadTreeLib(night) {
  if (treeLib) return treeLib;
  const loader = new GLTFLoader();
  const one = async (url, h) => {
    const g = await loader.loadAsync(new URL(url, import.meta.url).href);
    g.scene.updateWorldMatrix(true, true);
    let mesh = null;
    g.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const k = h / size.y;
    geo.applyMatrix4(new THREE.Matrix4().makeScale(k, k, k));
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
    geo.computeBoundingSphere();
    const mat = mesh.material.clone();
    if (mat.map?.image) {
      const im = mat.map.image;
      const c = document.createElement("canvas");
      c.width = c.height = Math.min(1024, im.width);
      const cc = c.getContext("2d");
      cc.filter = `saturate(${STYLE.tree.desaturate})`;
      cc.drawImage(im, 0, 0, c.width, c.height);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
      mat.map = t;
    }
    return { geo, mat };   // (its night tint: setLight)
  };
  treeLib = Promise.all([one(STYLE.tree.glb, STYLE.tree.h), one(STYLE.tree.palm, STYLE.tree.palmH)])
    .then(([tree, palm]) => ({ tree, palm }))
    .catch(e => { console.warn("city trees: the painted models didn't load, keeping the stand-ins", e); return null; });
  return treeLib;
}

export class CityTiles {
  // world: world3d (scene, labels, needsRender, loadImage, mirrorBlockTex)
  constructor(world, { url, origin, night = false, heroes = [], exclude = null, omt = null }) {
    this.world = world;
    this.url = url;
    this.exclude = exclude;    // round the origin: the hand-made Itaewon map's own (citygen.js)
    this.omt = omt;            // the worldwide fallback's TileJSON (cityomt.js), or null
    this.origin = origin;
    this.P = projector(origin);
    this.heroes = heroes;
    this.group = new THREE.Group();
    this.group.name = "city";
    world.scene.add(this.group);
    this.chunks = new Map();   // "x,y" -> { lod, meshes, labels, want }
    this.queue = [];           // requests not yet sent
    this.inflight = new Map(); // id -> { key, lod, t0 }
    this.ready = [];           // results waiting to be mounted
    this.nextId = 1;
    this.center = null;
    this.log = [];             // per-chunk timings (tests, the report)
    this.firstRing = null;     // { t0, done }
    this.labelNames = new Map();
    cityUniforms.uNight.value = night ? 1 : 0;
    this.makeMaterials(night);
    this.startWorker();
  }

  makeMaterials(night) {
    const M = this.mats = {};
    // 5.3-5.5 the walls: one material per class, the cream from the vertex colour
    for (const cls of STYLE.classes) {
      const f = facadeTile(cls);
      M["wall_" + cls] = patch(new THREE.MeshLambertMaterial({ map: pixelTex(f.map), emissiveMap: pixelTex(f.mask), emissive: 0xffffff, vertexColors: true }), { facade: true, cells: [f.cols, f.rows] });
    }
    M.roof = patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    // 5.6 outlines and the shadow film
    M.lines = new THREE.LineBasicMaterial({ color: night ? STYLE.outline.night : STYLE.outline.day, transparent: true, opacity: STYLE.outline.opacity });
    M.lines.onBeforeCompile = cut;
    M.shadow = new THREE.MeshBasicMaterial({ color: STYLE.shadow.color, transparent: true, opacity: STYLE.shadow.opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    // 5.7 the street pass
    M.ac = patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    M.awn = patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    M.clutter = patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    M.panel = patch(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffffff }), { panel: true, darken: false });
    // 3 the ground: the lawn tile on parks (the paving plane is the map's own)
    M.grass = patch(new THREE.MeshLambertMaterial({ color: night ? THEME.world.grassNight : THEME.world.grassDay, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { darken: false });
    this.world.loadImage?.("world2/road_grass.jpg").then(img => {
      M.grass.map = this.world.mirrorBlockTex(img, [0.03, 0.03, 0.30, 0.30]);
      M.grass.needsUpdate = true; this.world.needsRender = true;
    }).catch(() => {});
    // 4 the map's asphalt: the same crop of the painted road texture, tinted
    M.road = patch(new THREE.MeshLambertMaterial({ color: night ? THEME.world.roadNight : THEME.world.roadDay,
      emissive: night ? 0x272e48 : 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { darken: false });
    this.world.loadImage?.("world2/road_grass.jpg").then(img => {
      const t = tex(canvas(256, 256, g => g.drawImage(img, 0.545 * img.width, 0.75 * img.height, 0.027 * img.width, 0.20 * img.height, 0, 0, 256, 256)));
      M.road.map = t; M.road.needsUpdate = true; this.world.needsRender = true;
    }).catch(() => {});
    // landmarks with no model yet: their crown band, the placeholder tower's ring
    M.glow = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    M.glow.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uNight: cityUniforms.uNight });
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.75 + uNight * 0.9;");
    };
    M.water = new THREE.MeshPhongMaterial({ color: night ? 0x2b4a77 : 0x86bcd9, specular: night ? 0x334466 : 0x9fb8c8, shininess: 70,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    // 5.8 the power poles' wires
    M.wires = new THREE.LineBasicMaterial({ color: STYLE.pole.wire, transparent: true, opacity: STYLE.pole.wireOpacity });
    // instanced bits
    const P = STYLE.pole, L = STYLE.lamp;
    this.treeGeo = new THREE.IcosahedronGeometry(2.6, 0);     // a stand-in until the painted trees load
    this.treeGeo.translate(0, 5.2, 0);
    this.trunkGeo = new THREE.CylinderGeometry(0.28, 0.38, 3.2, 5);
    this.trunkGeo.translate(0, 1.6, 0);
    M.tree = new THREE.MeshLambertMaterial({ color: night ? 0x3d5c40 : 0x6d9450, flatShading: true });
    M.trunk = new THREE.MeshLambertMaterial({ color: 0x7a5b43 });
    this.postGeo = new THREE.BoxGeometry(...L.post);
    this.postGeo.translate(0, L.post[1] / 2, 0);
    this.headGeo = new THREE.BoxGeometry(...L.head);
    this.headGeo.translate(0, L.headY, 0);
    M.pole = new THREE.MeshLambertMaterial({ color: night ? L.postNight : L.postDay, flatShading: true });
    M.head = new THREE.MeshLambertMaterial({ color: L.headColor, flatShading: true, emissive: night ? L.headGlow : 0x000000, emissiveIntensity: night ? L.headGlowK : 0 });
    this.poleGeo = new THREE.CylinderGeometry(P.r[0], P.r[1], P.h, 6);
    this.poleGeo.translate(0, P.h / 2, 0);
    M.ppole = new THREE.MeshLambertMaterial({ color: night ? P.night : P.day });
    this.plampGeo = new THREE.SphereGeometry(P.lampR, 8, 6);
    this.plampGeo.translate(0, P.lampY, 0);
    M.plamp = new THREE.MeshLambertMaterial({ color: night ? P.lampNight : P.lampDay, emissive: night ? P.lampGlow : 0x000000, emissiveIntensity: night ? P.lampGlowK : 0 });
    this.lanternGeo = new THREE.SphereGeometry(P.lanternR, 8, 6);
    this.lanternGeo.scale(1, P.lanternTall, 1);
    M.lantern = new THREE.MeshLambertMaterial({ color: night ? P.lanternNight : P.lanternDay, emissive: night ? P.lanternGlow : 0x000000, emissiveIntensity: night ? P.lanternGlowK : 0 });
    this.poolGeo = new THREE.CircleGeometry(P.poolR, 20);
    this.poolGeo.rotateX(-Math.PI / 2);
    this.poolGeo.translate(0, 0.62, 0);
    M.pool = new THREE.MeshBasicMaterial({ color: P.pool, transparent: true, opacity: P.poolOpacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    // every flat material's day and night, for setLight(t): a sunset while
    // you watch (the walls, windows and panels follow uNight in the shader)
    this.dn = [
      [M.lines, { color: [STYLE.outline.day, STYLE.outline.night] }],
      [M.grass, { color: [THEME.world.grassDay, THEME.world.grassNight] }],
      [M.road, { color: [THEME.world.roadDay, THEME.world.roadNight], emissive: [0x000000, 0x272e48] }],
      [M.water, { color: [0x86bcd9, 0x2b4a77], specular: [0x9fb8c8, 0x334466] }],
      [M.tree, { color: [0x6d9450, 0x3d5c40] }],
      [M.pole, { color: [L.postDay, L.postNight] }],
      [M.head, { emissive: [0x000000, L.headGlow], emissiveIntensity: [0, L.headGlowK] }],
      [M.ppole, { color: [P.day, P.night] }],
      [M.plamp, { color: [P.lampDay, P.lampNight], emissive: [0x000000, P.lampGlow], emissiveIntensity: [0, P.lampGlowK] }],
      [M.lantern, { color: [P.lanternDay, P.lanternNight], emissive: [0x000000, P.lanternGlow], emissiveIntensity: [0, P.lanternGlowK] }],
    ].map(([mat, pairs]) => [mat, Object.fromEntries(Object.entries(pairs).map(([k, [d, n]]) => [k, k === "emissiveIntensity" ? [d, n] : [new THREE.Color(d), new THREE.Color(n)]]))]);
    this.light = night ? 0 : 1;
    this.shared = new Set([this.treeGeo, this.trunkGeo, this.postGeo, this.headGeo, this.poleGeo, this.plampGeo, this.lanternGeo, this.poolGeo]);
    this.treeMeshes = new Set();
    this.trees = null;
    loadTreeLib(night).then(lib => {
      if (!lib) return;
      this.trees = lib;
      this.shared.add(lib.tree.geo).add(lib.palm.geo);
      for (const k of ["tree", "palm"]) this.dn.push([lib[k].mat, { color: [new THREE.Color(0xffffff), new THREE.Color(STYLE.tree.night)] }]);
      this.setLight(this.light, true);
      for (const im of this.treeMeshes) {   // the stand-ins already on the map become the painted trees
        const k = im.userData.treeKind;
        if (!k) { im.visible = false; continue; }   // a stand-in's trunk
        im.geometry = lib[k].geo; im.material = lib[k].mat;
      }
      this.world.needsRender = true;
    });
  }

  startWorker() {
    const heroes = this.heroes.map(({ id, lat, lng, clear, fp, osm, glb, shape, h, glow, radius, landmark }) => ({ id, lat, lng, clear, fp, osm, glb: !!glb, shape, h, glow, radius, landmark: !!landmark }));
    const init = { type: "init", url: this.url, base: document.baseURI, origin: this.origin, heroes, clearAt: this.exclude ? 0 : 14,
      exclude: this.exclude, omt: this.omt ? new URL(this.omt, document.baseURI).href : null };
    const onMsg = m => {
      if (m.type === "meta") { this.bounds = m.bounds; return; }
      if (m.type === "error") { this.error = m.error; console.warn("city tiles:", m.error); return; }
      if (m.type === "chunk") this.ready.push(m);
    };
    try {
      if (new URLSearchParams(location.search).get("cityworker") === "0") throw new Error("off");
      this.worker = new Worker(new URL("./citygen.worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = e => onMsg(e.data);
      this.worker.onerror = e => { console.warn("city worker failed, building on the page", e.message); this.worker = null; this.inline(init, onMsg); };
      this.worker.postMessage(init);
    } catch {
      this.inline(init, onMsg);
    }
  }

  // no worker (or it failed): the same pipeline on the page
  inline(init, onMsg) {
    const src = new PMTiles(new URL(init.url, init.base).href);
    src.header().then(h => onMsg({ type: "meta", bounds: h.bounds }), err => onMsg({ type: "error", error: String(err) }));
    this.post = async m => {
      const t0 = performance.now();
      try {
        const bytes = await src.tile(m.z, m.x, m.y);
        const t1 = performance.now();
        if (!bytes) return onMsg({ type: "chunk", id: m.id, empty: true, t: { fetch: t1 - t0, build: 0 } });
        const out = buildChunk(JSON.parse(new TextDecoder().decode(bytes)), { z: m.z, x: m.x, y: m.y, origin: init.origin, lod: m.lod, heroes: init.heroes, clearAt: init.clearAt });
        onMsg({ type: "chunk", id: m.id, ...out, t: { fetch: t1 - t0, build: performance.now() - t1 } });
      } catch (err) { onMsg({ type: "chunk", id: m.id, error: String(err) }); }
    };
    for (const [id, r] of this.inflight) this.post({ type: "chunk", id, z: Z, x: r.x, y: r.y, lod: r.lod });
  }

  send(m) { if (this.worker) this.worker.postMessage(m); else this.post?.(m); }

  // the tile under a world point
  tileAt(v) {
    const [lng, lat] = this.P.inv(v.x, v.z);
    const [fx, fy] = lngLatToTile(lng, lat, Z);
    return [Math.floor(fx), Math.floor(fy), fx, fy];
  }

  // call every tick with the camera target
  update(target) {
    const cam = this.world.camera;
    if (cam) { cityUniforms.uCutA.value.copy(cam.position); cityUniforms.uCutB.value.copy(target); }
    const [cx, cy, fx, fy] = this.tileAt(target);
    if (!this.center || this.center[0] !== cx || this.center[1] !== cy) {
      this.center = [cx, cy];
      this.retarget(cx, cy, fx, fy);
    }
    this.pump();
    // mount at most two finished chunks per tick so a frame never stalls
    for (let n = 0; n < 2 && this.ready.length; n++) this.mount(this.ready.shift());
    const now = performance.now();
    for (const c of this.chunks.values()) {
      if (!c.rise) continue;
      const k = Math.min(1, (now - c.rise) / 520), e = 1 - (1 - k) ** 3;
      for (const mesh of c.meshes) { mesh.scale.y = Math.max(0.02, e); mesh.updateMatrix(); }
      if (k >= 1) c.rise = 0;
      this.world.needsRender = true;
    }
  }

  retarget(cx, cy, fx, fy) {
    const want = new Map();
    for (let dy = -FAR; dy <= FAR; dy++) {
      for (let dx = -FAR; dx <= FAR; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        want.set(`${cx + dx},${cy + dy}`, { x: cx + dx, y: cy + dy, lod: d <= NEAR ? 0 : 1, dist: Math.hypot(cx + dx + 0.5 - fx, cy + dy + 0.5 - fy) });
      }
    }
    if (!this.firstRing) this.firstRing = { t0: performance.now(), need: new Set([...want.keys()]), done: null };
    // drop what's well out of range
    for (const [k, c] of this.chunks) {
      const [x, y] = k.split(",").map(Number);
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) >= DROP) this.drop(k);
    }
    this.queue = [];
    for (const [k, w] of want) {
      const c = this.chunks.get(k);
      if (c && (c.lod === w.lod || c.pending === w.lod)) continue;
      if ([...this.inflight.values()].some(r => r.key === k && r.lod === w.lod)) continue;
      this.queue.push({ key: k, ...w });
    }
    this.queue.sort((a, b) => a.lod - b.lod || a.dist - b.dist);
  }

  pump() {
    while (this.inflight.size < MAX_INFLIGHT && this.queue.length) {
      const r = this.queue.shift();
      const id = this.nextId++;
      this.inflight.set(id, { ...r, t0: performance.now() });
      const c = this.chunks.get(r.key);
      if (c) c.pending = r.lod;
      this.send({ type: "chunk", id, z: Z, x: r.x, y: r.y, lod: r.lod });
    }
  }

  mount(m) {
    const r = this.inflight.get(m.id);
    this.inflight.delete(m.id);
    if (!r) return;
    const t1 = performance.now();
    const old = this.chunks.get(r.key);
    // a stale answer (we moved on and it's out of range now): drop it
    if (this.center && Math.max(Math.abs(r.x - this.center[0]), Math.abs(r.y - this.center[1])) >= DROP) return;
    const rec = { lod: r.lod, meshes: [], labels: [], empty: !!m.empty };
    if (!m.empty && !m.error) {
      for (const [k, g] of Object.entries(m.groups)) {
        const mat = this.mats[k];
        if (!mat) continue;
        if (g.lines) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
          geo.computeBoundingSphere();
          const ls = new THREE.LineSegments(geo, mat);
          ls.matrixAutoUpdate = false;
          rec.meshes.push(ls);
          continue;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(g.nrm, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(g.uv, 2));
        geo.setAttribute("color", new THREE.BufferAttribute(g.col, 3));
        geo.setAttribute("seed", new THREE.BufferAttribute(g.seed, 1));
        geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        rec.meshes.push(mesh);
      }
      this.instanced(rec, m);
      for (const l of m.labels || []) this.label(rec, l);
    }
    if (m.error) console.warn("city chunk", r.key, m.error);
    if (old) this.drop(r.key);
    // a chunk seen for the first time rises out of the ground (a LOD swap doesn't)
    else if (!m.empty && !REDUCED) { rec.rise = performance.now(); for (const mesh of rec.meshes) { mesh.scale.y = 0.02; mesh.updateMatrix(); } }
    for (const mesh of rec.meshes) this.group.add(mesh);
    this.chunks.set(r.key, rec);
    this.log.push({ key: r.key, lod: r.lod, ms: t1 - r.t0, fetch: m.t?.fetch ?? 0, build: m.t?.build ?? 0,
      mount: performance.now() - t1, cached: m.cached ?? null, buildings: m.stats?.buildings ?? 0, empty: rec.empty });
    if (this.firstRing && !this.firstRing.done) {
      this.firstRing.need.delete(r.key);
      if (!this.firstRing.need.size) this.firstRing.done = performance.now() - this.firstRing.t0;
    }
    this.world.needsRender = true;
  }

  // the light 0 (night) .. 1 (day): the flat materials lerp, the lamps'
  // pools show once it's dark (world3d.js applyLight drives it)
  setLight(t, force = false) {
    if (t === this.light && !force) return;
    this.light = t;
    const n = 1 - t;
    for (const [mat, pairs] of this.dn) for (const [k, [d, nv]] of Object.entries(pairs)) {
      if (typeof d === "number") mat[k] = d + (nv - d) * n;
      else mat[k].copy(d).lerp(nv, n);
    }
    for (const rec of this.chunks.values()) for (const mesh of rec.meshes) if (mesh.userData.pool) mesh.visible = t < 0.5;
    this.world.needsRender = true;
  }

  instanced(rec, m) {
    const gy = this.exclude && this.world.groundY ? (x, z) => this.world.groundY(x, z) : () => 0;
    const dummy = new THREE.Object3D();
    const inst = (geo, mat, n) => { const im = new THREE.InstancedMesh(geo, mat, n); im.matrixAutoUpdate = false; return im; };
    // 5.9 trees: the painted models (or their stand-ins until they load), palms 7 %
    const t = m.trees, nt = t ? t.length / 4 : 0;
    if (nt) {
      const kinds = { tree: [], palm: [] };
      for (let i = 0; i < nt; i++) kinds[t[i * 4 + 3] ? "palm" : "tree"].push(i);
      for (const [kind, idx] of Object.entries(kinds)) {
        if (!idx.length) continue;
        const lib = this.trees?.[kind];
        const im = inst(lib ? lib.geo : this.treeGeo, lib ? lib.mat : this.mats.tree, idx.length);
        im.userData.treeKind = kind;
        const trunk = lib ? null : inst(this.trunkGeo, this.mats.trunk, idx.length);
        idx.forEach((i, k) => {
          dummy.position.set(t[i * 4], gy(t[i * 4], t[i * 4 + 1]), t[i * 4 + 1]);
          dummy.rotation.set(0, i * 1.7, 0);
          dummy.scale.setScalar(t[i * 4 + 2]);
          dummy.updateMatrix();
          im.setMatrixAt(k, dummy.matrix);
          trunk?.setMatrixAt(k, dummy.matrix);
        });
        rec.meshes.push(im); this.treeMeshes.add(im);
        if (trunk) { rec.meshes.push(trunk); this.treeMeshes.add(trunk); }
      }
    }
    // 5.8 street lights: a post and a lit head, no pool
    const L = m.lamps, nl = L ? L.length / 3 : 0;
    if (nl) {
      const post = inst(this.postGeo, this.mats.pole, nl), head = inst(this.headGeo, this.mats.head, nl);
      for (let i = 0; i < nl; i++) {
        dummy.position.set(L[i * 3], gy(L[i * 3], L[i * 3 + 1]), L[i * 3 + 1]);
        dummy.rotation.set(0, L[i * 3 + 2] + Math.PI / 2, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        post.setMatrixAt(i, dummy.matrix); head.setMatrixAt(i, dummy.matrix);
      }
      rec.meshes.push(post, head);
    }
    // 5.8 power poles; a lamp on every third, with a warm pool at night
    const Pp = m.poles, np = Pp ? Pp.length / 3 : 0;
    if (np) {
      const lit = []; for (let i = 0; i < np; i++) if (Pp[i * 3 + 2]) lit.push(i);
      const pole = inst(this.poleGeo, this.mats.ppole, np);
      const lamp = lit.length ? inst(this.plampGeo, this.mats.plamp, lit.length) : null;
      const pool = lit.length ? inst(this.poolGeo, this.mats.pool, lit.length) : null;
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      for (let i = 0; i < np; i++) {
        dummy.position.set(Pp[i * 3], gy(Pp[i * 3], Pp[i * 3 + 1]), Pp[i * 3 + 1]);
        dummy.updateMatrix();
        pole.setMatrixAt(i, dummy.matrix);
      }
      lit.forEach((i, k) => {
        dummy.position.set(Pp[i * 3], gy(Pp[i * 3], Pp[i * 3 + 1]), Pp[i * 3 + 1]);
        dummy.updateMatrix();
        lamp.setMatrixAt(k, dummy.matrix); pool?.setMatrixAt(k, dummy.matrix);
      });
      rec.meshes.push(pole);
      if (lamp) rec.meshes.push(lamp);
      if (pool) { pool.renderOrder = 2; pool.userData.pool = true; pool.visible = this.light < 0.5; rec.meshes.push(pool); }
    }
    // 5.8 paper lanterns under the wires
    const La = m.lanterns, nn = La ? La.length / 3 : 0;
    if (nn) {
      const im = inst(this.lanternGeo, this.mats.lantern, nn);
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      for (let i = 0; i < nn; i++) {
        dummy.position.set(La[i * 3], La[i * 3 + 1] + gy(La[i * 3], La[i * 3 + 2]), La[i * 3 + 2]);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      rec.meshes.push(im);
    }
  }

  label(rec, l) {
    if (!this.world.addLabel) return;
    const prev = this.labelNames.get(l.text);
    if (prev && prev.some(p => Math.hypot(p.x - l.x, p.z - l.z) < 260)) return;
    const pos = new THREE.Vector3(l.x, FLOOR_U * 0.8, l.z);
    const lr = this.world.addLabel(l.text, l.poi ? "district" : "street", l.poi ? 2 : 1, () => pos, null, { city: true });
    lr.at = l;
    rec.labels.push(lr);
    this.labelNames.set(l.text, [...(prev || []), l]);
  }

  drop(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    for (const mesh of c.meshes) {
      this.group.remove(mesh);
      this.treeMeshes.delete(mesh);
      if (!this.shared.has(mesh.geometry)) mesh.geometry.dispose();
      if (mesh.isInstancedMesh) mesh.dispose();
    }
    for (const lr of c.labels) {
      this.world.removeLabel?.(lr);
      const arr = (this.labelNames.get(lr.at.text) || []).filter(p => p !== lr.at);
      if (arr.length) this.labelNames.set(lr.at.text, arr); else this.labelNames.delete(lr.at.text);
    }
    this.chunks.delete(key);
    this.world.needsRender = true;
  }

  stats() {
    const live = [...this.chunks.values()];
    let tris = 0, draws = 0;
    for (const c of live) for (const m of c.meshes) {
      draws++;
      const g = m.geometry;
      const t = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      tris += m.isInstancedMesh ? t * m.count : t;
    }
    return {
      chunks: live.length, near: live.filter(c => c.lod === 0).length, draws, tris: Math.round(tris),
      inflight: this.inflight.size, queued: this.queue.length, firstRingMs: this.firstRing?.done ?? null,
      log: this.log.slice(), error: this.error ?? null, bounds: this.bounds ?? null,
    };
  }

  dispose() {
    for (const k of [...this.chunks.keys()]) this.drop(k);
    this.worker?.terminate();
    this.world.scene.remove(this.group);
  }
}
