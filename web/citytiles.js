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
// Range: the map says how far round the target to go (world3d.js
// viewRange, world units: the haze's radius plus a buffer in the map's
// Pokémon GO view). Chunks reaching within `near` of the target get full
// detail (the street pass, lamps, poles, outlines); out to `load` they're
// walls + roofs + shadows + parks; past `show` they're kept but not drawn
// (all haze), and well past `load` they're dropped. With no range given:
// rings of 1 and 2 tiles, as it used to be. Everything is deterministic per
// chunk, so a chunk you left looks the same when you come back.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { buildChunk, packChunk, handmadeMask, projector, lngLatToTile, FLOOR_U } from "./citygen.js";
import { STYLE } from "./style.js";
import { PMTiles } from "./pmtiles.js";
import { THEME } from "./theme.js";

const Z = 16;
const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Overture's worldwide building tiles (a buildings PMTiles, z14 MVT, its
// "building" layer): where set, the worldwide fallback's buildings come
// from it instead of OpenMapTiles' (OpenStreetMap only). Off until a copy
// we can rely on is hosted (docs/map_city.md "Worldwide Overture
// buildings"); ?ovt=<url> tries one.
const OVT_URL = new URLSearchParams(globalThis.location?.search ?? "").get("ovt") || null;
const RINGS = { near: 1.2, load: 2.2 };   // tiles, when the map gives no range
const DROP_U = 140;                        // world units past `load` before a chunk is dropped
const RETARGET_U = 24;                     // re-pick the chunks every this far the target moves
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
// the four facade tiles as one texture array (one wall material, one draw a
// chunk), each layer exactly the canvas a pixelTex would upload (flipped as
// a CanvasTexture is, sRGB, nearest up close, mipmapped further away)
function pixelArray(canvases) {
  const W = canvases[0].width, H = canvases[0].height, data = new Uint8Array(W * H * 4 * canvases.length);
  canvases.forEach((c, l) => {
    const px = c.getContext("2d").getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++) data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), (l * H + y) * W * 4);
  });
  const t = new THREE.DataArrayTexture(data, W, H, canvases.length);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4; t.unpackAlignment = 4;
  t.needsUpdate = true;
  return t;
}

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

// facade: { map, mask } texture arrays (pixelArray) with a layer per class
// in STYLE.classes order, picked by the vertex's "cls" byte (citygen.js packChunk)
function patch(mat, { facade = null, panel = false, darken = true } = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, cityUniforms);
    if (facade) Object.assign(sh.uniforms, { uFacade: { value: facade.map }, uFacadeMask: { value: facade.mask } });
    cut(sh);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float seed;\nvarying float vSeed;\nvarying vec2 vCellUv;" + (facade ? "\nattribute float cls;\nvarying float vCls;" : ""))
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvSeed = seed;\nvCellUv = uv;" + (facade ? "\nvCls = cls;" : ""));
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec3 uNightWall;\nuniform float uWet;\nvarying float vSeed;\nvarying vec2 vCellUv;" +
        (facade ? "\nuniform sampler2DArray uFacade;\nuniform sampler2DArray uFacadeMask;\nvarying float vCls;" : ""))
      .replace("#include <map_fragment>", facade ? `#include <map_fragment>
        float layer = floor(vCls + 0.5);
        diffuseColor *= texture(uFacade, vec3(vCellUv, layer));
        vec2 uCells = ${STYLE.classes.map((c, i) => i < STYLE.classes.length - 1 ? `layer < ${i}.5 ? vec2(${STYLE.cells[c][0]}.0, ${STYLE.cells[c][1]}.0) : ` : `vec2(${STYLE.cells[c][0]}.0, ${STYLE.cells[c][1]}.0)`).join("")};` : "#include <map_fragment>")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" +
        (darken ? "diffuseColor.rgb *= mix(vec3(1.0), uNightWall, uNight);\ndiffuseColor.rgb *= 1.0 - uWet * 0.12;\n"
          : panel ? `diffuseColor.rgb *= mix(1.0, ${STYLE.panel.nightMul.toFixed(2)}, uNight);\n` : ""))
      .replace("#include <emissivemap_fragment>", facade ? `
        {
          vec4 emC = texture(uFacadeMask, vec3(vCellUv, layer));
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
        }` : panel ? `
          totalEmissiveRadiance = vColor * ${STYLE.panel.glow.toFixed(2)} * uNight;` : "#include <emissivemap_fragment>");
  };
  mat.customProgramCacheKey = () => `city-${facade ? "fa" : panel ? "p" : "n"}${darken ? "d" : ""}`;
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
    // and its far version: a fifth of the triangles, the painting baked into vertex colours
    const lo = lodTree(geo, mat.map?.image);
    const loMat = mat.clone(); loMat.map = null; loMat.vertexColors = true;
    return { geo, mat, lo, loMat };   // (their night tint: setLight)
  };
  treeLib = Promise.all([one(STYLE.tree.glb, STYLE.tree.h), one(STYLE.tree.palm, STYLE.tree.palmH)])
    .then(([tree, palm]) => ({ tree, palm }))
    .catch(e => { console.warn("city trees: the painted models didn't load, keeping the stand-ins", e); return null; });
  return treeLib;
}

// a tree far from the camera, where the painting is a few pixels: the model
// clustered on a coarse grid (vertices in a cell merge, triangles that
// collapse go), each cell's colour the mean of the texture under its
// vertices. The same silhouette, trunk and all, at a fifth of the triangles.
export function lodTree(geo, img, N = 20) {
  const pos = geo.attributes.position, uv = geo.attributes.uv, nrm = geo.attributes.normal;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3()), cell = Math.max(size.x, size.y, size.z) / N;
  let px = null, W = 0, H = 0;
  try {
    if (img && uv) {   // (read at 128 px: a cell's colour is a mean anyway, and a 1024 px read is slow on a phone)
      const c = document.createElement("canvas");
      c.width = c.height = W = H = 128;
      c.getContext("2d").drawImage(img, 0, 0, W, H);
      px = c.getContext("2d").getImageData(0, 0, W, H).data;
    }
  } catch { px = null; }
  const cells = new Map(), acc = [], id = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.floor((x - bb.min.x) / cell) + Math.floor((y - bb.min.y) / cell) * 64 + Math.floor((z - bb.min.z) / cell) * 4096;
    let k = cells.get(key);
    if (k === undefined) { k = acc.length / 10; cells.set(key, k); acc.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0); }
    id[i] = k;
    const a = k * 10;
    acc[a] += x; acc[a + 1] += y; acc[a + 2] += z;
    if (nrm) { acc[a + 3] += nrm.getX(i); acc[a + 4] += nrm.getY(i); acc[a + 5] += nrm.getZ(i); }
    if (px) {
      const u = uv.getX(i) - Math.floor(uv.getX(i)), v = uv.getY(i) - Math.floor(uv.getY(i));
      const o = ((Math.min(H - 1, v * H | 0)) * W + Math.min(W - 1, u * W | 0)) * 4;
      acc[a + 6] += px[o] / 255; acc[a + 7] += px[o + 1] / 255; acc[a + 8] += px[o + 2] / 255;
    } else { acc[a + 6] += 0.42; acc[a + 7] += 0.58; acc[a + 8] += 0.31; }
    acc[a + 9]++;
  }
  const n = acc.length / 10, P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), C = new Float32Array(n * 3);
  const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  for (let k = 0; k < n; k++) {
    const a = k * 10, m = acc[a + 9];
    P[k * 3] = acc[a] / m; P[k * 3 + 1] = acc[a + 1] / m; P[k * 3 + 2] = acc[a + 2] / m;
    const l = Math.hypot(acc[a + 3], acc[a + 4], acc[a + 5]) || 1;
    Nn[k * 3] = acc[a + 3] / l; Nn[k * 3 + 1] = acc[a + 4] / l; Nn[k * 3 + 2] = acc[a + 5] / l;
    C[k * 3] = lin(acc[a + 6] / m); C[k * 3 + 1] = lin(acc[a + 7] / m); C[k * 3 + 2] = lin(acc[a + 8] / m);
  }
  const src = geo.index ? geo.index.array : null, nt = (src ? src.length : pos.count) / 3, seen = new Set(), I = [];
  for (let t = 0; t < nt; t++) {
    const a = id[src ? src[t * 3] : t * 3], b = id[src ? src[t * 3 + 1] : t * 3 + 1], c = id[src ? src[t * 3 + 2] : t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((p, q) => p - q), key = (s[0] * n + s[1]) * n + s[2];
    if (seen.has(key)) continue;
    seen.add(key); I.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(Nn, 3));
  g.setAttribute("color", new THREE.BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

// The instanced props (trees, street lights, power poles and their lamps,
// pools and lanterns) pooled across chunks: one InstancedMesh a kind for the
// whole map instead of one a chunk, refilled when a chunk comes or goes,
// while one rises, or when the camera moves. Instances outside the view are
// left out (the pool has no chunk to cull by), and trees far from the camera
// take the light version (lodTree).
export const TREE_LOD_U = +(new URLSearchParams(globalThis.location?.search ?? "").get("treelod") || 300);   // world units from the camera (?treelod= to compare)
export class Pool {
  constructor(group, geo, mat, { order = 0, src, far = null } = {}) {
    Object.assign(this, { group, geo, mat, order, src, far, cap: 0, mesh: null, hidden: false });
    this.setGeo(geo);
  }
  setGeo(geo) {
    this.geo = geo;
    geo.computeBoundingSphere();
    this.cy = geo.boundingSphere.center.y; this.r = geo.boundingSphere.radius;
    if (this.mesh) this.mesh.geometry = geo;
  }
  fill(recs, frustum, cam, sphere, range = null) {
    let n = 0;
    for (const rec of recs) for (const k of this.src) n += rec.inst?.[k] ? rec.inst[k].length / 16 : 0;
    if (n > this.cap) {
      const cap = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
      if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); }
      this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.matrixAutoUpdate = false; this.mesh.renderOrder = this.order;
      this.mesh.frustumCulled = false;   // (culled per instance here)
      this.group.add(this.mesh);
      this.cap = cap;
    }
    if (!this.mesh) return;
    const out = this.mesh.instanceMatrix.array;
    let c = 0;
    for (const rec of recs) {
      const e = rec.riseE ?? 1;
      for (const k of this.src) {
        const a = rec.inst?.[k];
        if (!a) continue;
        for (let i = 0; i < a.length; i += 16) {
          const s = Math.hypot(a[i], a[i + 1], a[i + 2]);
          sphere.center.set(a[i + 12], a[i + 13] + this.cy * s * e, a[i + 14]);
          sphere.radius = this.r * s;
          if (!frustum.intersectsSphere(sphere)) continue;
          if (range && Math.hypot(a[i + 12] - range.x, a[i + 14] - range.z) > range.r + sphere.radius) continue;   // (all haze)
          if (this.far !== null) {
            const d = Math.hypot(a[i + 12] - cam.x, a[i + 14] - cam.z);
            if (this.far ? d < TREE_LOD_U : d >= TREE_LOD_U) continue;
          }
          const o = c * 16;
          for (let q = 0; q < 16; q++) out[o + q] = a[i + q];
          if (e < 1) { out[o + 1] *= e; out[o + 5] *= e; out[o + 9] *= e; out[o + 13] *= e; }
          c++;
        }
      }
    }
    this.mesh.count = c;
    this.mesh.visible = c > 0 && !this.hidden;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  stats() { return this.mesh?.visible ? { draws: 1, tris: (this.geo.index ? this.geo.index.count : this.geo.attributes.position.count) / 3 * this.mesh.count } : { draws: 0, tris: 0 }; }
  dispose() { if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); } }
}
// refill pools from recs ({ inst: { kind: Float32Array of matrices }, riseE })
// if the camera moved since the last call on this state, or force; true if it
// did. range { x, z, r }: leave out what's further than r from x,z (the haze)
export function fillPools(pools, recs, cam, state, force = false, range = null) {
  cam.updateMatrixWorld();
  const e = state.cam ??= new Float32Array(32);
  const rk = range ? `${range.x.toFixed(1)},${range.z.toFixed(1)},${range.r.toFixed(1)}` : "";
  let moved = force || rk !== state.range;
  state.range = rk;
  for (let i = 0; i < 16; i++) {
    if (e[i] !== cam.matrixWorld.elements[i]) { moved = true; e[i] = cam.matrixWorld.elements[i]; }
    if (e[16 + i] !== cam.projectionMatrix.elements[i]) { moved = true; e[16 + i] = cam.projectionMatrix.elements[i]; }
  }
  if (!moved) return false;
  state.frustum ??= new THREE.Frustum(); state.sphere ??= new THREE.Sphere(); state.m4 ??= new THREE.Matrix4();
  state.frustum.setFromProjectionMatrix(state.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  for (const p of Object.values(pools)) p.fill(recs, state.frustum, cam.position, state.sphere, range);
  return true;
}
// painted trees ({ tree: { geo, mat, lo, loMat }, palm }) near the camera,
// their light versions further out: two pools a kind
export function treePools(group, lib, kinds = ["tree", "palm"]) {
  const out = {};
  for (const k of kinds) {
    out[k] = new Pool(group, lib[k].geo, lib[k].mat, { src: [k], far: false });
    out[k + "Far"] = new Pool(group, lib[k].lo, lib[k].loMat, { src: [k], far: true });
  }
  return out;
}

export class CityTiles {
  // world: world3d (scene, labels, needsRender, loadImage, mirrorBlockTex)
  // hidden: built ahead out of sight (world3d.js warmCity), show() puts it on the map
  constructor(world, { url, origin, night = false, heroes = [], exclude = null, omt = null, hidden = false }) {
    this.world = world;
    this.url = url;
    this.exclude = exclude;    // round the origin: the hand-made Itaewon map's own (citygen.js)
    this.omt = omt;            // the worldwide fallback's TileJSON (cityomt.js), or null
    this.origin = origin;
    this.P = projector(origin);
    this.heroes = heroes;
    this.group = new THREE.Group();
    this.group.name = "city";
    this.hidden = hidden;
    this.group.visible = !hidden;
    world.scene.add(this.group);
    this.chunks = new Map();   // "x,y" -> { lod, meshes, labels, want }
    this.queue = [];           // requests not yet sent
    this.inflight = new Map(); // id -> { key, lod, t0 }
    this.ready = [];           // results waiting to be mounted
    this.nextId = 1;
    this.center = null;
    this.log = [];             // per-chunk timings (tests, the report)
    this.firstRing = null;     // { t0, done }
    this.t0 = performance.now();
    this.shownAt = hidden ? null : this.t0;   // when it went on the map
    this.labelNames = new Map();
    cityUniforms.uNight.value = night ? 1 : 0;
    this.makeMaterials(night);
    this.startWorker();
  }

  makeMaterials(night) {
    const M = this.mats = {};
    // 5.3-5.5 the walls: one material for the four classes (a texture array,
    // the class per vertex), the cream from the vertex colour
    const tiles = STYLE.classes.map(facadeTile);
    M.wall = patch(new THREE.MeshLambertMaterial({ vertexColors: true }), { facade: { map: pixelArray(tiles.map(f => f.map)), mask: pixelArray(tiles.map(f => f.mask)) } });
    // the roofs, and on them and round them the AC boxes, awnings and kerb
    // clutter (5.7): one plain vertex-coloured material, one mesh a chunk
    M.roof = patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    // 5.6 outlines and the shadow film
    M.lines = new THREE.LineBasicMaterial({ color: night ? STYLE.outline.night : STYLE.outline.day, transparent: true, opacity: STYLE.outline.opacity });
    M.lines.onBeforeCompile = cut;
    // overlapping shadows (a downtown block of towers) darken a pixel once,
    // not once per building: the stencil marks it the first time
    M.shadow = new THREE.MeshBasicMaterial({ color: STYLE.shadow.color, transparent: true, opacity: STYLE.shadow.opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    // 5.7 the street pass's sign panels (they glow at night)
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
    // the pools (one draw a kind for the whole map; the trees' stand-ins until the painted ones load)
    const G = this.group;
    this.pools = {
      tree: new Pool(G, this.treeGeo, M.tree, { src: ["tree", "palm"] }),
      trunk: new Pool(G, this.trunkGeo, M.trunk, { src: ["tree", "palm"] }),
      post: new Pool(G, this.postGeo, M.pole, { src: ["lamp"] }),
      head: new Pool(G, this.headGeo, M.head, { src: ["lamp"] }),
      pole: new Pool(G, this.poleGeo, M.ppole, { src: ["pole"] }),
      plamp: new Pool(G, this.plampGeo, M.plamp, { src: ["plit"] }),
      pool: new Pool(G, this.poolGeo, M.pool, { src: ["plit"], order: 2 }),
      lantern: new Pool(G, this.lanternGeo, M.lantern, { src: ["lantern"] }),
    };
    this.pools.pool.hidden = this.light >= 0.5;
    this.poolsDirty = true;
    this.trees = null;
    loadTreeLib(night).then(lib => {
      if (!lib || this.disposed) return;
      this.trees = lib;
      this.shared.add(lib.tree.geo).add(lib.palm.geo).add(lib.tree.lo).add(lib.palm.lo);
      for (const k of ["tree", "palm"]) for (const m of [lib[k].mat, lib[k].loMat]) this.dn.push([m, { color: [new THREE.Color(0xffffff), new THREE.Color(STYLE.tree.night)] }]);
      this.setLight(this.light, true);
      // the stand-ins become the painted trees: near the camera the models, further out their light versions
      for (const k of ["tree", "trunk"]) { this.pools[k].dispose(); delete this.pools[k]; }
      Object.assign(this.pools, treePools(G, lib));
      this.poolsDirty = true;
      this.world.needsRender = true;
    });
  }

  startWorker() {
    const heroes = this.heroes.map(({ id, lat, lng, clear, fp, osm, glb, shape, h, glow, radius, landmark }) => ({ id, lat, lng, clear, fp, osm, glb: !!glb, shape, h, glow, radius, landmark: !!landmark }));
    const init = { type: "init", url: this.url, base: document.baseURI, origin: this.origin, heroes, clearAt: this.exclude ? 0 : 14,
      exclude: this.exclude, omt: this.omt ? new URL(this.omt, document.baseURI).href : null,
      regions: new URLSearchParams(location.search).get("regions") !== "0",   // (?regions=0: the areas' archive and the worldwide tiles only)
      ovt: OVT_URL ? new URL(OVT_URL, document.baseURI).href : null };
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
    if (init.exclude?.src) init = { ...init, exclude: handmadeMask(init.exclude) };
    const src = new PMTiles(new URL(init.url, init.base).href);
    src.header().then(h => onMsg({ type: "meta", bounds: h.bounds }), err => onMsg({ type: "error", error: String(err) }));
    this.post = async m => {
      const t0 = performance.now();
      try {
        const bytes = await src.tile(m.z, m.x, m.y);
        const t1 = performance.now();
        if (!bytes) return onMsg({ type: "chunk", id: m.id, empty: true, t: { fetch: t1 - t0, build: 0 } });
        const out = packChunk(buildChunk(JSON.parse(new TextDecoder().decode(bytes)), { z: m.z, x: m.x, y: m.y, origin: init.origin, lod: m.lod, heroes: init.heroes, clearAt: init.clearAt, exclude: init.exclude }));
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

  // world units across one tile here
  get tileU() { return this._tileU ??= this.P.fwd(360 / 2 ** Z, 0)[0] - this.P.fwd(0, 0)[0]; }
  // how far a tile is from the target's tile position (fx, fy), world units (0: under it)
  tileDist(x, y, fx, fy) { return Math.hypot(Math.max(0, x - fx, fx - (x + 1)), Math.max(0, y - fy, fy - (y + 1))) * this.tileU; }

  // call every tick with the camera target and the range round it to
  // load ({ load, near, show } world units; world3d.js viewRange)
  update(target, range = null) {
    const cam = this.world.camera;
    if (cam && !this.hidden) { cityUniforms.uCutA.value.copy(cam.position); cityUniforms.uCutB.value.copy(target); }
    const [cx, cy, fx, fy] = this.tileAt(target);
    const R = range ?? { load: RINGS.load * this.tileU, near: RINGS.near * this.tileU, show: Infinity };
    const L = this._at;
    if (!L || L.cx !== cx || L.cy !== cy || Math.hypot(target.x - L.x, target.z - L.z) > RETARGET_U ||
        Math.abs(R.load - L.load) > 8 || Math.abs(R.near - L.near) > 8 || Math.abs(R.show - L.show) > 8) {
      this._at = { cx, cy, fx, fy, x: target.x, z: target.z, load: R.load, near: R.near, show: R.show };
      this.center = [cx, cy];
      this.retarget(cx, cy, fx, fy, R);
    } else if (this.retryDue && performance.now() > this.retryDue) {
      // chunks whose data couldn't be reached: asked for again
      this.retryDue = 0;
      this.retarget(cx, cy, fx, fy, R);
    }
    this._range = R.show < Infinity ? { x: target.x, z: target.z, r: R.show } : null;
    this.pump();
    // mount at most two finished chunks per tick so a frame never stalls
    for (let n = 0; n < 2 && this.ready.length; n++) this.mount(this.ready.shift());
    const now = performance.now();
    for (const c of this.chunks.values()) {
      if (!c.rise) continue;
      const k = Math.min(1, (now - c.rise) / 520), e = 1 - (1 - k) ** 3;
      for (const mesh of c.meshes) { mesh.scale.y = Math.max(0.02, e); mesh.updateMatrix(); }
      c.riseE = k >= 1 ? 1 : Math.max(0.02, e);
      if (c.inst) this.poolsDirty = true;
      if (k >= 1) c.rise = 0;
      this.world.needsRender = true;
    }
    this.fillPools();
  }

  retarget(cx, cy, fx, fy, R) {
    const want = new Map(), n = Math.ceil(R.load / this.tileU) + 1;
    for (let dy = -n; dy <= n; dy++) {
      for (let dx = -n; dx <= n; dx++) {
        const x = cx + dx, y = cy + dy, d = this.tileDist(x, y, fx, fy);
        if (d > R.load) continue;
        want.set(`${x},${y}`, { x, y, lod: d <= R.near ? 0 : 1, dist: Math.hypot(x + 0.5 - fx, y + 0.5 - fy) });
      }
    }
    if (!this.firstRing) this.firstRing = { t0: performance.now(), need: new Set([...want.keys()]), near: new Set([...want].filter(([, w]) => !w.lod).map(([k]) => k)), done: null, nearDone: null };
    // drop what's well out of range; past what shows (all haze), keep but don't draw
    for (const [k, c] of this.chunks) {
      const [x, y] = k.split(",").map(Number), d = this.tileDist(x, y, fx, fy);
      if (d > R.load + DROP_U) { this.drop(k); continue; }
      const vis = d <= R.show;
      if (c.shown !== vis) { c.shown = vis; for (const m of c.meshes) m.visible = vis; this.world.needsRender = true; }
    }
    this.queue = [];
    for (const [k, w] of want) {
      const c = this.chunks.get(k);
      if (c && !c.retry && (c.lod === w.lod || c.pending === w.lod)) continue;
      if (c?.retry && c.pending === w.lod) continue;
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
    const A = this._at;
    const away = A ? this.tileDist(r.x, r.y, A.fx, A.fy) : 0;
    if (A && away > A.load + DROP_U) return;
    const rec = { lod: r.lod, meshes: [], labels: [], empty: !!m.empty };
    // part of its data couldn't be reached (offline, a server error): ask again,
    // 15 s, then longer each time (citygen.worker.js marks it)
    if (m.retry) {
      rec.retry = (old?.retry ?? 0) + 1;
      const due = performance.now() + Math.min(120e3, 15e3 * 2 ** (rec.retry - 1));
      this.retryDue = this.retryDue ? Math.min(this.retryDue, due) : due;
    }
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
        if (g.cls) geo.setAttribute("cls", new THREE.BufferAttribute(g.cls, 1));
        geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        rec.meshes.push(mesh);
      }
      this.instanced(rec, m);
      rec.centres = m.centres ?? null;
      for (const l of m.labels || []) this.label(rec, l);
    }
    if (m.error) console.warn("city chunk", r.key, m.error);
    if (old) this.drop(r.key);
    // a chunk seen for the first time rises out of the ground (a LOD swap doesn't)
    if ((!old || old.empty) && !m.empty && !REDUCED) { rec.rise = performance.now(); rec.riseE = 0.02; for (const mesh of rec.meshes) { mesh.scale.y = 0.02; mesh.updateMatrix(); } }
    rec.shown = !A || away <= A.show;
    for (const mesh of rec.meshes) { mesh.visible = rec.shown; this.group.add(mesh); }
    this.chunks.set(r.key, rec);
    this.log.push({ key: r.key, lod: r.lod, at: t1, ms: t1 - r.t0, fetch: m.t?.fetch ?? 0, build: m.t?.build ?? 0,
      mount: performance.now() - t1, cached: m.cached ?? null, buildings: m.stats?.buildings ?? 0, empty: rec.empty, src: m.stats?.src ?? null, retry: !!m.retry });
    if (this.firstRing && !this.firstRing.done) {
      this.firstRing.need.delete(r.key); this.firstRing.near.delete(r.key);
      if (!this.firstRing.near.size && !this.firstRing.nearDone) this.firstRing.nearDone = performance.now() - this.firstRing.t0;
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
    this.pools.pool.hidden = t >= 0.5;
    this.poolsDirty = true;
    this.world.needsRender = true;
  }

  // the chunk's props as instance matrices per kind (the pools draw them)
  instanced(rec, m) {
    const gy = this.exclude && this.world.groundY ? (x, z) => this.world.groundY(x, z) : () => 0;
    const dummy = new THREE.Object3D(), inst = rec.inst = {};
    const put = (kind, n, set) => {
      if (!n) return;
      const a = inst[kind] = new Float32Array(n * 16);
      for (let i = 0; i < n; i++) { set(i); dummy.updateMatrix(); dummy.matrix.toArray(a, i * 16); }
    };
    // 5.9 trees: the painted models (or their stand-ins until they load), palms 7 %
    const t = m.trees, nt = t ? t.length / 4 : 0;
    for (const [kind, palm] of [["tree", 0], ["palm", 1]]) {
      const idx = [];
      for (let i = 0; i < nt; i++) if (!!t[i * 4 + 3] === !!palm) idx.push(i);
      put(kind, idx.length, k => {
        const i = idx[k];
        dummy.position.set(t[i * 4], gy(t[i * 4], t[i * 4 + 1]), t[i * 4 + 1]);
        dummy.rotation.set(0, i * 1.7, 0);
        dummy.scale.setScalar(t[i * 4 + 2]);
      });
    }
    // 5.8 street lights: a post and a lit head, no pool
    const L = m.lamps;
    put("lamp", L ? L.length / 3 : 0, i => {
      dummy.position.set(L[i * 3], gy(L[i * 3], L[i * 3 + 1]), L[i * 3 + 1]);
      dummy.rotation.set(0, L[i * 3 + 2] + Math.PI / 2, 0);
      dummy.scale.setScalar(1);
    });
    // 5.8 power poles; a lamp on every third, with a warm pool at night
    const Pp = m.poles, np = Pp ? Pp.length / 3 : 0;
    const at = (x, z) => { dummy.position.set(x, gy(x, z), z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); };
    put("pole", np, i => at(Pp[i * 3], Pp[i * 3 + 1]));
    const lit = []; for (let i = 0; i < np; i++) if (Pp[i * 3 + 2]) lit.push(i);
    put("plit", lit.length, k => at(Pp[lit[k] * 3], Pp[lit[k] * 3 + 1]));
    // 5.8 paper lanterns under the wires
    const La = m.lanterns;
    put("lantern", La ? La.length / 3 : 0, i => { at(La[i * 3], La[i * 3 + 2]); dummy.position.y += La[i * 3 + 1]; });
    if (Object.keys(inst).length) this.poolsDirty = true;
  }

  // refill the pools: a chunk came or went or is rising, or the camera moved
  fillPools() {
    const cam = this.world.camera;
    if (!cam || this.hidden) return;
    this._fill ??= {};
    if (fillPools(this.pools, [...this.chunks.values()], cam, this._fill, this.poolsDirty, this._range)) this.world.needsRender = true;
    this.poolsDirty = false;
  }

  label(rec, l) {
    if (!this.world.addLabel) return;
    if (this.hidden) { (rec.later ??= []).push(l); return; }
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
      if (!this.shared.has(mesh.geometry)) mesh.geometry.dispose();
    }
    if (c.inst) this.poolsDirty = true;
    for (const lr of c.labels) {
      this.world.removeLabel?.(lr);
      const arr = (this.labelNames.get(lr.at.text) || []).filter(p => p !== lr.at);
      if (arr.length) this.labelNames.set(lr.at.text, arr); else this.labelNames.delete(lr.at.text);
    }
    this.chunks.delete(key);
    this.world.needsRender = true;
  }

  // out of sight (kept, still streaming round its own spot) and back
  hide() {
    if (this.hidden) return;
    this.hidden = true;
    this.group.visible = false;
    for (const rec of this.chunks.values()) {
      for (const lr of rec.labels) { this.world.removeLabel?.(lr); (rec.later ??= []).push(lr.at); }
      rec.labels = [];
    }
    this.labelNames.clear();
    this.world.needsRender = true;
  }
  show() {
    if (!this.hidden) return;
    this.hidden = false;
    this.shownAt = performance.now();
    this.group.visible = true;
    for (const rec of this.chunks.values()) { const later = rec.later ?? []; rec.later = null; for (const l of later) this.label(rec, l); }
    this.poolsDirty = true;
    this.world.needsRender = true;
  }
  // how many buildings stand within r world units of (x, z) (tests, ?fps=1)
  countNear(x, z, r) {
    let n = 0;
    for (const c of this.chunks.values()) {
      const a = c.centres;
      if (a) for (let i = 0; i < a.length; i += 2) if ((a[i] - x) ** 2 + (a[i + 1] - z) ** 2 < r * r) n++;
    }
    return n;
  }
  // the chunks round the spot (the near ring) are in: enough to show
  get nearDone() { return !!this.firstRing?.nearDone; }

  stats() {
    const live = [...this.chunks.values()];
    let tris = 0, draws = 0;
    for (const c of live) for (const m of c.meshes) {
      if (!m.visible) continue;   // (kept, all haze: not drawn)
      draws++;
      const g = m.geometry;
      tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
    for (const p of Object.values(this.pools)) { const s = p.stats(); draws += s.draws; tris += s.tris; }
    return {
      chunks: live.length, near: live.filter(c => c.lod === 0).length, draws, tris: Math.round(tris),
      inflight: this.inflight.size, queued: this.queue.length, firstRingMs: this.firstRing?.done ?? null, nearRingMs: this.firstRing?.nearDone ?? null, t0: this.t0, shownAt: this.shownAt,
      log: this.log.slice(), error: this.error ?? null, bounds: this.bounds ?? null,
    };
  }

  dispose() {
    this.disposed = true;
    for (const k of [...this.chunks.keys()]) this.drop(k);
    for (const p of Object.values(this.pools)) p.dispose();
    this.worker?.terminate();
    this.world.scene.remove(this.group);
  }
}
