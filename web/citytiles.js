// City chunks, on the map: streams procedural city chunks around the camera
// target (the player, or wherever you've panned in Explore). Data is one
// PMTiles archive of z16 chunks (scripts/bake_city_tiles.py; web/tiles/ for
// tests, a worldwide build on R2 in production); geometry is built in a
// worker (citygen.worker.js -> citygen.js) and mounted here with shared
// materials: per-type window facades whose night lights are picked per
// building in the shader, roofs, shopfronts and abstract lit signs,
// asphalt, ground, water, instanced trees and street lamps.
//
// Rings: chunks within NEAR tiles of the target get full detail (shopfronts,
// signs, rooftop boxes, lamps, lane marks); out to FAR they're walls + roofs
// + ground; beyond that they're dropped. Everything is deterministic per
// chunk, so a chunk you left looks the same when you come back.
import * as THREE from "https://esm.sh/three@0.160.0";
import { buildChunk, projector, lngLatToTile, FLOOR_U } from "./citygen.js";
import { PMTiles } from "./pmtiles.js";
import { THEME } from "./theme.js";

const Z = 16;
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

// one storey x two bays of facade per kind: the map (wall white, so the
// vertex colour tints it; glass dark) and the window mask (white glass)
const FACADES = {
  h: (g, m, W, H) => { for (const bx of [0, W / 2]) win(g, m, bx + 18, 18, 28, 30, 3); sill(g, W, H); },
  a: (g, m, W, H) => {
    for (const bx of [0, W / 2]) win(g, m, bx + 6, 14, 52, 34, 2);
    g.fillStyle = "#d8d6d0"; g.fillRect(0, 52, W, 5); g.fillStyle = "#c9c7c0";
    for (let x = 4; x < W; x += 8) g.fillRect(x, 48, 2, 6);
    g.fillStyle = "#bdbab2"; g.fillRect(0, H - 4, W, 4);
  },
  c: (g, m, W, H) => {
    for (const bx of [0, W / 2]) win(g, m, bx + 8, 14, 48, 40, 3);
    g.fillStyle = "#cfc7b8"; g.fillRect(0, H - 8, W, 8);
  },
  o: (g, m, W, H) => {
    g.fillStyle = "#71849a"; g.fillRect(0, 0, W, H - 12);
    g.fillStyle = "#8ea0b4"; g.fillRect(0, 0, W, 18);
    m.fillStyle = "#fff"; m.fillRect(0, 0, W, H - 12);
    g.fillStyle = "#c5cdd6"; for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 2, H);
    m.fillStyle = "#000"; for (let x = 0; x < W; x += 16) m.fillRect(x, 0, 2, H);
    g.fillStyle = "#dfe4e9"; g.fillRect(0, H - 12, W, 12);
  },
  v: (g, m, W, H) => { for (const bx of [0, W / 4, W / 2, (3 * W) / 4]) win(g, m, bx + 9, 10, 14, 52, 2); sill(g, W, H); },
  i: (g, m, W, H) => {
    win(g, m, 8, 8, W - 16, 12, 2);
    g.fillStyle = "#d2d2cc"; for (let x = 0; x < W; x += 12) g.fillRect(x, 26, 1, H - 26);
  },
  s: (g, m, W, H) => { g.fillStyle = "#d9d5cc"; for (let x = 0; x < W; x += 10) g.fillRect(x, 0, 1, H); },
  g: (g, m, W, H) => { for (const bx of [0, W / 2]) win(g, m, bx + 10, 16, 44, 36, 2); },
};
function win(g, m, x, y, w, h, f) {
  g.fillStyle = "#d6d1c6"; g.fillRect(x - f, y - f, w + f * 2, h + f * 2);
  g.fillStyle = "#8696a6"; g.fillRect(x, y, w, h);
  g.fillStyle = "#a4b2bf"; g.fillRect(x, y, w, Math.max(2, h * 0.3));
  m.fillStyle = "#fff"; m.fillRect(x, y, w, h);
}
function sill(g, W, H) { g.fillStyle = "#d3cdc0"; g.fillRect(0, H - 6, W, 6); }

function makeFacade(kind) {
  const W = 128, H = 80;
  let mctx;
  const mask = canvas(W, H, (m) => { m.fillStyle = "#000"; m.fillRect(0, 0, W, H); mctx = m; });
  const map = canvas(W, H, (g) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H); FACADES[kind](g, mctx, W, H); });
  return { map: tex(map), mask: tex(mask) };
}

// four shopfront designs stacked: glass, door, mullions, a kick plate
function makeShop() {
  const W = 128, H = 256, R = H / 4;
  let mctx;
  const mask = canvas(W, H, m => { m.fillStyle = "#000"; m.fillRect(0, 0, W, H); mctx = m; });
  const map = canvas(W, H, g => {
    const frames = ["#2d2f36", "#6b4a32", "#e8e4dc", "#38506a"];
    for (let k = 0; k < 4; k++) {
      const y = k * R;
      g.fillStyle = frames[k]; g.fillRect(0, y, W, R);
      g.fillStyle = "#34404f"; g.fillRect(6, y + 8, W - 12, R - 18);
      g.fillStyle = "#4f6178"; g.fillRect(6, y + 8, W - 12, (R - 18) * 0.35);
      mctx.fillStyle = k === 2 ? "#ffe9c8" : "#fff"; mctx.fillRect(6, y + 8, W - 12, R - 18);
      g.fillStyle = frames[k];
      const door = k % 2 ? 14 : W - 40;
      g.fillRect(door, y + 8, 3, R - 10); g.fillRect(door + 22, y + 8, 3, R - 10);
      g.fillRect(W / 2 - 1, y + 8, 2, R - 18);
      g.fillStyle = "#1e2026"; g.fillRect(0, y + R - 10, W, 10);
      mctx.fillStyle = "#000"; mctx.fillRect(W / 2 - 1, y + 8, 2, R - 18);
    }
  });
  return { map: tex(map), mask: tex(mask) };
}

// eight abstract sign faces (no text): blocks, bars, rings, an arrow — the
// colour comes from the vertex, the texture gives the shapes and a frame
function makeSigns() {
  const W = 96, H = 256, R = H / 8;
  return tex(canvas(W, H, g => {
    for (let k = 0; k < 8; k++) {
      const y = k * R;
      g.fillStyle = "#3a3a3a"; g.fillRect(0, y, W, R);
      g.fillStyle = "#9a9a9a"; g.fillRect(2, y + 2, W - 4, R - 4);
      g.fillStyle = "#ffffff";
      const cy = y + R / 2;
      if (k === 0) { for (let x = 10; x < W - 10; x += 18) g.fillRect(x, cy - 7, 12, 14); }
      if (k === 1) { g.fillRect(10, cy - 3, W - 20, 6); g.fillRect(10, cy - 10, 30, 4); }
      if (k === 2) { for (let x = 16; x < W; x += 28) { g.beginPath(); g.arc(x, cy, 8, 0, 7); g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke(); } }
      if (k === 3) { g.beginPath(); g.moveTo(14, cy - 8); g.lineTo(W - 24, cy - 8); g.lineTo(W - 10, cy); g.lineTo(W - 24, cy + 8); g.lineTo(14, cy + 8); g.fill(); }
      if (k === 4) { for (let x = 8; x < W - 8; x += 10) g.fillRect(x, cy - (x % 20 ? 9 : 4), 6, x % 20 ? 18 : 8); }
      if (k === 5) { g.fillRect(8, y + 6, 24, R - 12); for (let x = 40; x < W - 8; x += 14) g.fillRect(x, cy - 5, 9, 10); }
      if (k === 6) { g.fillRect(6, cy - 9, W - 12, 4); g.fillRect(6, cy + 5, W - 12, 4); g.fillRect(W / 2 - 14, cy - 4, 28, 8); }
      if (k === 7) { for (let x = 12; x < W - 8; x += 22) { g.fillRect(x, cy - 9, 4, 18); g.fillRect(x, cy - 2, 14, 4); g.fillRect(x + 10, cy - 9, 4, 18); } }
    }
  }));
}

function lightPool() {
  const t = tex(canvas(64, 64, g => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,214,150,0.85)"); gr.addColorStop(0.45, "rgba(255,190,120,0.3)"); gr.addColorStop(1, "rgba(255,180,110,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// the shared night uniform: every city material reads it, so a hero model,
// a tower and a street lamp all light up together
export const cityUniforms = {
  uNight: { value: 0 },
  uLit: { value: 0.34 },
  uNightWall: { value: new THREE.Color(0.42, 0.46, 0.62) },
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

function patch(mat, { facade = false, sign = false, shop = false, darken = true } = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, cityUniforms);
    cut(sh);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float seed;\nvarying float vSeed;\nvarying vec2 vCellUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvSeed = seed;\nvCellUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform float uLit;\nuniform vec3 uNightWall;\nuniform float uWet;\nvarying float vSeed;\nvarying vec2 vCellUv;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" +
        (darken ? "diffuseColor.rgb *= mix(vec3(1.0), uNightWall, uNight);\ndiffuseColor.rgb *= 1.0 - uWet * 0.12;\n" : ""))
      .replace("#include <emissivemap_fragment>", facade ? `
        #ifdef USE_EMISSIVEMAP
          vec4 emC = texture2D( emissiveMap, vEmissiveMapUv );
          // one draw per window: integer cell + the building's seed rounded
          // back to an integer (an interpolated float would flicker per pixel)
          float sq = floor(vSeed * 997.0 + 0.5);
          vec2 cell = mod(floor(vCellUv * vec2(2.0, 1.0)) + vec2(sq * 13.0, sq * 7.0), 289.0);
          float hh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float lit = step(hh, uLit);
          vec3 wc = mix(vec3(1.0, 0.76, 0.46), vec3(0.78, 0.88, 1.0), step(0.8, fract(hh * 7.13)));
          wc *= 0.6 + 0.4 * fract(hh * 3.7);
          totalEmissiveRadiance *= emC.rgb * wc * lit * uNight;
        #endif` : sign ? `
        #ifdef USE_EMISSIVEMAP
          vec4 emC = texture2D( emissiveMap, vEmissiveMapUv );
          totalEmissiveRadiance = vColor * emC.rgb * (0.22 + uNight * 1.9);
        #endif` : shop ? `
        #ifdef USE_EMISSIVEMAP
          vec4 emC = texture2D( emissiveMap, vEmissiveMapUv );
          totalEmissiveRadiance *= emC.rgb * (0.05 + uNight * 1.15);
        #endif` : "#include <emissivemap_fragment>");
  };
  mat.customProgramCacheKey = () => `city-${facade ? "f" : sign ? "s" : shop ? "p" : "n"}${darken ? "d" : ""}`;
  return mat;
}

export class CityTiles {
  // world: world3d (scene, labels, needsRender, loadImage, mirrorBlockTex)
  constructor(world, { url, origin, night = false, heroes = [] }) {
    this.world = world;
    this.url = url;
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
    for (const k of ["h", "a", "c", "o", "v", "i", "s", "g"]) {
      const f = makeFacade(k);
      M["wall_" + k] = patch(new THREE.MeshLambertMaterial({ map: f.map, emissiveMap: f.mask, emissive: 0xffffff, vertexColors: true }), { facade: true });
    }
    M.lines = new THREE.LineBasicMaterial({ color: night ? 0x0b0e18 : 0x3a332a, transparent: true, opacity: night ? 0.55 : 0.4 });
    M.lines.onBeforeCompile = cut;
    M.roof = patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const shop = makeShop();
    M.shop = patch(new THREE.MeshLambertMaterial({ map: shop.map, emissiveMap: shop.mask, emissive: 0xffd9a0 }), { shop: true });
    const signs = makeSigns();
    M.sign = patch(new THREE.MeshLambertMaterial({ map: signs, emissiveMap: signs, emissive: 0xffffff, vertexColors: true }), { sign: true, darken: false });
    M.ground = patch(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    // the map's asphalt: the same crop of the painted road texture, tinted
    M.road = patch(new THREE.MeshLambertMaterial({ color: night ? THEME.world.roadNight : THEME.world.roadDay,
      emissive: night ? 0x272e48 : 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { darken: false });
    this.world.loadImage?.("world2/road_grass.jpg").then(img => {
      const t = tex(canvas(256, 256, g => g.drawImage(img, 0.545 * img.width, 0.75 * img.height, 0.027 * img.width, 0.20 * img.height, 0, 0, 256, 256)));
      M.road.map = t; M.road.needsUpdate = true; this.world.needsRender = true;
    }).catch(() => {});
    M.water = new THREE.MeshPhongMaterial({ color: night ? 0x2b4a77 : 0x86bcd9, specular: night ? 0x334466 : 0x9fb8c8, shininess: 70,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    // instanced bits
    this.treeGeo = new THREE.IcosahedronGeometry(2.6, 0);
    this.treeGeo.translate(0, 5.2, 0);
    this.trunkGeo = new THREE.CylinderGeometry(0.28, 0.38, 3.2, 5);
    this.trunkGeo.translate(0, 1.6, 0);
    M.tree = new THREE.MeshLambertMaterial({ flatShading: true });
    M.trunk = new THREE.MeshLambertMaterial({ color: 0x7a5b43 });
    this.poleGeo = new THREE.CylinderGeometry(0.11, 0.14, 6.2, 5);
    this.poleGeo.translate(0, 3.1, 0);
    this.headGeo = new THREE.BoxGeometry(0.5, 0.28, 1.1);
    this.headGeo.translate(0, 6.15, 0.35);
    M.pole = new THREE.MeshLambertMaterial({ color: 0x4d5560 });
    M.head = new THREE.MeshLambertMaterial({ color: 0xe8e2d0, emissive: night ? 0xffd9a0 : 0x000000, emissiveIntensity: 1.2 });
    this.poolGeo = new THREE.PlaneGeometry(10, 10);
    this.poolGeo.rotateX(-Math.PI / 2);
    this.poolGeo.translate(0, 0.3, 0);
    M.pool = new THREE.MeshBasicMaterial({ map: lightPool(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  }

  startWorker() {
    const init = { type: "init", url: this.url, base: document.baseURI, origin: this.origin, heroes: this.heroes.filter(h => h.glb), clearAt: 14 };
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

  instanced(rec, m) {
    const t = m.trees, n = t ? t.length / 4 : 0;
    const dummy = new THREE.Object3D();
    if (n) {
      const crown = new THREE.InstancedMesh(this.treeGeo, this.mats.tree, n);
      const trunk = new THREE.InstancedMesh(this.trunkGeo, this.mats.trunk, n);
      const greens = [0x7fa35e, 0x6d9450, 0x93b56c].map(c => new THREE.Color(c));
      for (let i = 0; i < n; i++) {
        dummy.position.set(t[i * 4], 0, t[i * 4 + 1]);
        dummy.rotation.set(0, i * 1.7, 0);
        dummy.scale.setScalar(t[i * 4 + 2]);
        dummy.updateMatrix();
        crown.setMatrixAt(i, dummy.matrix); trunk.setMatrixAt(i, dummy.matrix);
        crown.setColorAt(i, greens[t[i * 4 + 3] | 0]);
      }
      rec.meshes.push(crown, trunk);
    }
    const L = m.lamps, nl = L ? L.length / 3 : 0;
    if (nl) {
      const pole = new THREE.InstancedMesh(this.poleGeo, this.mats.pole, nl);
      const head = new THREE.InstancedMesh(this.headGeo, this.mats.head, nl);
      const pool = cityUniforms.uNight.value > 0.5 ? new THREE.InstancedMesh(this.poolGeo, this.mats.pool, nl) : null;
      for (let i = 0; i < nl; i++) {
        dummy.position.set(L[i * 3], 0, L[i * 3 + 1]);
        dummy.rotation.set(0, L[i * 3 + 2] + Math.PI / 2, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        pole.setMatrixAt(i, dummy.matrix); head.setMatrixAt(i, dummy.matrix);
        if (pool) pool.setMatrixAt(i, dummy.matrix);
      }
      rec.meshes.push(pole, head);
      if (pool) { pool.renderOrder = 2; rec.meshes.push(pool); }
    }
  }

  label(rec, l) {
    if (!this.world.addLabel) return;
    const prev = this.labelNames.get(l.text);
    if (prev && prev.some(p => Math.hypot(p.x - l.x, p.z - l.z) < 260)) return;
    const pos = new THREE.Vector3(l.x, FLOOR_U * 0.8, l.z);
    const lr = this.world.addLabel(l.text, "street", 1, () => pos);
    lr.at = l;
    rec.labels.push(lr);
    this.labelNames.set(l.text, [...(prev || []), l]);
  }

  drop(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    for (const mesh of c.meshes) {
      this.group.remove(mesh);
      mesh.geometry !== this.treeGeo && mesh.geometry !== this.trunkGeo && mesh.geometry !== this.poleGeo &&
        mesh.geometry !== this.headGeo && mesh.geometry !== this.poolGeo ? mesh.geometry.dispose() : mesh.dispose?.();
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
