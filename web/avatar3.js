// Rando avatar v3 — articulated humanoid base (3.5등신, PS2-matte) replacing
// the procedural blob for players/remotes. One rigged body mesh + code
// tints (5 skin tones recolor the shared texture, never separate meshes),
// 9 hair meshes × 5 texture recolors, 6 face designs × 6 iris decals
// (offline-extracted PNGs on a curved patch), and attachable top/bottom/
// shoe meshes that share the body's fit transform. The rig (34 tripo
// joints) ships in the GLB for future clip retargeting; runtime motion is
// the same procedural bob contract the blob used, so world code and feel
// are unchanged. API mirrors character3d: { group, config, setConfig,
// walking, phase, tick }.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "https://esm.sh/three@0.160.0/examples/jsm/utils/SkeletonUtils.js";

// ?body=v4 swaps in the low-poly chibi base (web/avatar4: Tripo v2.5 rig +
// preset idle/walk). Opt-in until its wardrobe is rebuilt — v3 pieces were
// cut for a 3.5-head body and do not fit a 3-head one, so v4 carries its own
// (initially empty) catalog and keeps its BAKED face: the half-lidded eyes
// are the character, and the v3 decals would paint over them.
const V4 = new URLSearchParams(location.search).get("body") === "v4";
const BASE = V4 ? "avatar4" : "avatar3";
const FACE_BASE = "avatar3"; // face decal PNGs are shared
const V4_CATALOG = {
  hair: ["short-cropped", "medium-fringe", "long-straight", "curly-volume", "buzz", "messy-shag"],
  top: ["hoodie-maroon", "tee-black", "jacket-olive", "bomber-black"],
  bottom: ["pants-baggy-black", "trousers-wide-olive", "shorts-cargo-grey"],
  shoes: [],
};
const CHAR_H = 15;

// palette sampled offline from the generated variant sheets (avatar3_prep):
// skin ladder reordered light -> dark by luminance.
export const SKIN_RGB = {
  1: [238, 196, 156], 2: [205, 170, 147], 3: [192, 135, 91],
  4: [155, 99, 65], 5: [89, 60, 44],
};
const SKIN_BASE = [226, 189, 173]; // baked tone in body.glb's texture
export const HAIR_RGB = {
  black: [53, 52, 57], brown: [115, 82, 70], yellow: [225, 185, 122],
  red: [206, 55, 58], white: [225, 210, 200],
};
export const IRIS3_HEX = { // UI swatches only; decals carry the real color
  black: "#262a30", navy: "#2e4468", current: "#4a4e57",
  brown: "#8a6a52", blue: "#3f7fd1", green: "#5d9c53",
};

export const HAIR_STYLES = V4 ? V4_CATALOG.hair
  : ["f1", "f2", "f3", "f4", "f5", "m1", "m2", "m3", "m5"];
export const PART_OPTIONS3 = {
  skin: ["1", "2", "3", "4", "5"],
  hair: ["none", ...HAIR_STYLES],
  hairColor: Object.keys(HAIR_RGB),
  face: ["f1", "f2", "f3", "f4", "f5", "f6"],
  iris: Object.keys(IRIS3_HEX),
  // crop-pink / ringer-white / shirt-open-white exist as assets but their
  // FRONT panels fused into the body mesh in this segmentation roll —
  // listed again once a cleaner gen lands (see rando-wardrobe-pipeline)
  top: ["none", "tee-baggy-black", "tee-white-graphic", "hoodie-maroon"],
  bottom: ["none", "cargo-black", "jeans-baggy-blue", "cargo-khaki",
           "track-navy", "camo", "loose-brown", "skirt-denim-grey",
           "skirt-pleated-black", "shorts-green", "shorts-blue"],
  shoes: ["none", "sneaker-hitop-black", "loafer-black", "sneaker-white-lowtop",
          "boot-work-tan", "clog-pink", "sneaker-white-stripe"],
};

if (V4) {
  for (const k of ["top", "bottom", "shoes"]) PART_OPTIONS3[k] = ["none", ...V4_CATALOG[k]];
}

export const DEFAULT_AVATAR3 = {
  skin: "1", hair: V4 ? (V4_CATALOG.hair[0] ?? "none") : "f1", hairColor: "black",
  face: "f1", iris: "current", top: "none", bottom: "none", shoes: "none",
};

// old blob configs ({ body, eyes, iris, head }) carry no mappable meaning
// here — any unknown/legacy value falls back per-key to the default, which
// is exactly the requested migration (skin 1, hair f1 black, default eyes).
export function normalizeAvatar3(raw) {
  const cfg = { ...DEFAULT_AVATAR3 };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_AVATAR3)) {
      const v = raw[k] != null ? String(raw[k]) : null;
      if (v && PART_OPTIONS3[k].includes(v)) cfg[k] = v;
    }
  }
  return cfg;
}

// ---------------- template load ----------------
const loader = new GLTFLoader();
let templatePromise = null;
let T = null; // resolved template

// face decal PNGs load independently of the body GLB so 2D thumbs
// (avatarThumb3) can resolve even in legacy modes that never load the
// humanoid template. Callers that render a thumb early can await this and
// re-render (see backend.setAvatarThumb).
const DECALS = {}; // "face_iris" -> HTMLImageElement
let decalsPromise = null;
export function loadFaceDecals() {
  decalsPromise ??= Promise.all(PART_OPTIONS3.face.flatMap(de => PART_OPTIONS3.iris.map(ir =>
    new Promise(res => {
      const im = new Image();
      im.onload = () => { DECALS[`${de}_${ir}`] = im; res(); };
      im.onerror = () => res();
      im.src = `${FACE_BASE}/faces/${de}_${ir}.png`;
    }))));
  return decalsPromise;
}

// The runtime never drives the skeleton (motion is group-level, blob-style),
// and Tripo's rigs carry mesh-node transforms that make bind-pose skinning
// fragile — so render the body as a STATIC mesh: same geometry, same node
// transform, bones ignored. The rig stays in the GLB for future animation.
export function staticize(src) {
  const swaps = [];
  src.traverse(o => { if (o.isSkinnedMesh) swaps.push(o); });
  for (const sm of swaps) {
    const mesh = new THREE.Mesh(sm.geometry, sm.material);
    mesh.name = sm.name;
    mesh.position.copy(sm.position);
    mesh.quaternion.copy(sm.quaternion);
    mesh.scale.copy(sm.scale);
    sm.parent.add(mesh);
    sm.parent.remove(sm);
  }
}

// face analysis on the body texture: find the two baked dark eye clusters
// on the face front, erase a box covering eyes+mouth, remember where the
// face points so the decal patch can aim there.
function analyzeFace(src) {
  let sm = null;
  src.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  if (!sm || !sm.material.map?.image) return null;
  const img = sm.material.map.image;
  const cv = document.createElement("canvas");
  const scale = Math.min(1, 2048 / img.width);
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const pos = sm.geometry.attributes.position;
  const uv = sm.geometry.attributes.uv;
  // geometry attributes live in the mesh's local/bind space; measure in the
  // scene frame (the same frame the garment pieces share) via matrixWorld
  sm.updateWorldMatrix(true, false);
  const W = sm.matrixWorld.clone();
  const wp = (i, out) => out.fromBufferAttribute(pos, i).applyMatrix4(W);
  const lumAt = (u, v) => {
    const x = Math.min(cv.width - 1, Math.max(0, Math.round(u * cv.width)));
    const y = Math.min(cv.height - 1, Math.max(0, Math.round(v * cv.height)));
    const i = (y * cv.width + x) * 4;
    return (px[i] + px[i + 1] + px[i + 2]) / 3;
  };
  // facing-agnostic: gather every dark head-band vertex regardless of the
  // rig's export heading (Tripo bodies face ±X as often as ±Z)
  const v0 = new THREE.Vector3();
  const geoBox = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) geoBox.expandByPoint(wp(i, v0));
  const height = geoBox.max.y - geoBox.min.y;
  const darks = [];
  for (let i = 0; i < pos.count; i++) {
    if (wp(i, v0).y < geoBox.min.y + height * 0.55) continue; // head band
    if (lumAt(uv.getX(i), uv.getY(i)) > 95) continue;
    darks.push(i);
  }
  if (darks.length < 12) return null;
  const v = new THREE.Vector3();
  // head sphere least-squares fit on the crown
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const B = [0, 0, 0, 0];
  const yCap = geoBox.min.y + height * 0.72;
  for (let i = 0; i < pos.count; i++) {
    wp(i, v);
    if (v.y < yCap) continue;
    const x = v.x, y = v.y, z = v.z;
    const row = [2 * x, 2 * y, 2 * z, 1];
    const rhs = x * x + y * y + z * z;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
      B[r] += row[r] * rhs;
    }
  }
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [B[col], B[piv]] = [B[piv], B[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < 4; c++) A[r][c] -= f * A[col][c];
      B[r] -= f * B[col];
    }
  }
  const sol = B.map((b, i) => b / A[i][i]);
  const C = new THREE.Vector3(sol[0], sol[1], sol[2]);
  const R = Math.sqrt(Math.max(1e-8, sol[3] + C.lengthSq()));
  // face direction + erase box across BOTH eyes, extended down over the
  // mouth (the decal replaces the whole feature set)
  const ub = { u0: 1, v0: 1, u1: 0, v1: 0 };
  const mid = new THREE.Vector3();
  for (const i of darks) {
    mid.add(wp(i, v));
    ub.u0 = Math.min(ub.u0, uv.getX(i)); ub.u1 = Math.max(ub.u1, uv.getX(i));
    ub.v0 = Math.min(ub.v0, uv.getY(i)); ub.v1 = Math.max(ub.v1, uv.getY(i));
  }
  mid.divideScalar(darks.length);
  let rMax = 0;
  for (const i of darks) {
    rMax = Math.max(rMax, wp(i, v).sub(C).length());
  }
  // patch must clear the whole skull, not just the eye bumps
  const sphereR = Math.max(R, rMax);
  const dir = mid.clone().sub(C).setY(0).normalize(); // horizontal facing
  dir.add(new THREE.Vector3(0, 0.07, 0)).normalize();
  // sample a fill color beside the box, then erase (box + mouth margin)
  const padU = 0.015, padV = 0.012;
  const bx = Math.floor((ub.u0 - padU) * cv.width);
  const by = Math.floor((ub.v0 - padV) * cv.height);
  const bw = Math.ceil((ub.u1 - ub.u0 + 2 * padU) * cv.width);
  const bh = Math.ceil((ub.v1 - ub.v0 + 2 * padV + 0.05) * cv.height);
  let fill = [226, 189, 173], best = 0;
  for (const [sx, sy] of [[bx - 9, by + bh / 2], [bx + bw + 9, by + bh / 2], [bx + bw / 2, by - 9]]) {
    const i = ((Math.max(0, Math.min(cv.height - 1, Math.round(sy)))) * cv.width +
               (Math.max(0, Math.min(cv.width - 1, Math.round(sx))))) * 4;
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
    if (l > best) { best = l; fill = [px[i], px[i + 1], px[i + 2]]; }
  }
  if (!V4) { // v4 keeps its baked eyes (see V4 note at the top)
    ctx.fillStyle = `rgb(${fill[0]},${fill[1]},${fill[2]})`;
    ctx.fillRect(bx, by, bw, bh);
  }
  img.close?.();
  return { canvas: cv, C, R: sphereR, dir };
}

// classify skin pixels once; tone changes then only rewrite those pixels.
// KNOWN FLAW (content, not code): the body texture has small skin-colored
// patches painted onto the tank back — they recolor with the skin because
// they genuinely are skin-colored. Needs an offline repaint of body.glb's
// texture; heuristics here misfire (atlas background is also white).
function buildSkinMask(cv) {
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const mask = new Uint8Array(cv.width * cv.height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    // strict warmth: the tank/shorts whites carry a slight warm cast in
    // shadow (r-g ≈ 10-22) and must NOT be treated as skin
    if (r > 150 && r - g >= 26 && r - g <= 85 && g - b >= 6 && g - b <= 55) mask[i] = 1;
  }
  return mask;
}

// median colour of the masked skin — the v4 texture's baked tone (v3 keeps
// its hand-sampled SKIN_BASE so shipped tones do not shift)
function skinBaseOf(cv, mask) {
  if (!V4) return SKIN_BASE;
  const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
  const rs = [], gs = [], bs = [];
  for (let i = 0; i < mask.length; i += 7) {
    if (!mask[i]) continue;
    rs.push(d[i * 4]); gs.push(d[i * 4 + 1]); bs.push(d[i * 4 + 2]);
  }
  if (rs.length < 50) return SKIN_BASE;
  const med = a => a.sort((x, y) => x - y)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

function recolorCanvas(srcCv, mask, gains) {
  const out = document.createElement("canvas");
  out.width = srcCv.width; out.height = srcCv.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(srcCv, 0, 0);
  const id = ctx.getImageData(0, 0, out.width, out.height);
  const d = id.data;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue;
    d[p] = Math.min(255, d[p] * gains[0]);
    d[p + 1] = Math.min(255, d[p + 1] * gains[1]);
    d[p + 2] = Math.min(255, d[p + 2] * gains[2]);
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

const texFromCanvas = cv => {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  return t;
};

// flatten any PBR into the world's matte look, keep the map
export function matteify(root) {
  root.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const src = o.material;
    o.material = new THREE.MeshLambertMaterial({ map: src.map ?? null });
    o.material.map && (o.material.map.colorSpace = THREE.SRGBColorSpace);
    o.frustumCulled = false;
  });
}

export function loadHumanTemplate() {
  if (templatePromise) return templatePromise;
  templatePromise = (async () => {
    const g = await loader.loadAsync(`${BASE}/body.glb`);
    const src = g.scene;
    src.updateWorldMatrix(true, true);
    const face = analyzeFace(src);
    staticize(src);
    // the rig exports facing wherever Tripo felt like — yaw the source so
    // the detected face points +Z (the app's forward), and remember the
    // yaw + source frame center so attachments can be matched to it
    let yaw = 0;
    if (face) {
      yaw = Math.atan2(face.dir.x, face.dir.z);
      src.rotation.y = -yaw;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      face.dir.applyQuaternion(q);
      face.C.applyQuaternion(q);
    }
    src.updateWorldMatrix(true, true);
    const srcBox = new THREE.Box3().setFromObject(src);
    const srcCenter = new THREE.Vector3();
    srcBox.getCenter(srcCenter); // garment frames are centered on origin
    // fit wrapper: normalize to CHAR_H, feet on ground, centered — the SAME
    // numbers are applied to every attachment (all pieces share the body's
    // Tripo-normalized source frame, so one transform fits all)
    const fit = new THREE.Group();
    fit.add(src);
    fit.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(fit);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = CHAR_H / size.y;
    fit.scale.setScalar(s);
    fit.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(fit);
    const off = new THREE.Vector3(
      -(box2.min.x + box2.max.x) / 2, -box2.min.y, -(box2.min.z + box2.max.z) / 2);
    fit.position.copy(off);
    let skinMask = null;
    if (face) skinMask = buildSkinMask(face.canvas);
    await loadFaceDecals(); // all 36 face decal PNGs, ready for sync assembly
    T = {
      fit, face, skinMask, decals: DECALS,
      skinBase: face ? skinBaseOf(face.canvas, skinMask) : SKIN_BASE,
      fitScale: s, fitOffset: off, yaw, srcCenter,
      skinTex: {},          // tone -> THREE.Texture
      pieces: {},           // "cat/id" -> template scene (matte)
      pieceLoads: {},       // in-flight piece loads
      cover: {},            // v4: "cat/id" -> hidden body-triangle flags
      hairCv: {},           // style -> { canvas, base }  (neutral texture)
      hairTex: {},          // "style_color" -> THREE.Texture
    };
    return T;
  })();
  return templatePromise;
}

// drop triangles whose three root-frame vertices ALL satisfy dropFn
function cropTris(root, dropFn) {
  root.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    const drop = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      drop[i] = dropFn(v) ? 1 : 0;
    }
    const idx = geo.index;
    const tri = idx ? idx.array : null;
    const triCount = (tri ? tri.length : pos.count) / 3;
    const kept = [];
    for (let t = 0; t < triCount; t++) {
      const a = tri ? tri[t * 3] : t * 3;
      const b = tri ? tri[t * 3 + 1] : t * 3 + 1;
      const c = tri ? tri[t * 3 + 2] : t * 3 + 2;
      if (drop[a] && drop[b] && drop[c]) continue;
      kept.push(a, b, c);
    }
    geo.setIndex(kept);
  });
}

// drop triangles whose vertices sit entirely above yLimit (root frame)
const cropAboveY = (root, yLimit) => cropTris(root, v => v.y > yLimit);

// tone textures bake lazily (2048² recolor is real CPU work on phones)
function getSkinTex(tone) {
  if (!T.face || !T.skinMask) return null;
  if (!T.skinTex[tone]) {
    const gains = SKIN_RGB[tone].map((t, i) => t / T.skinBase[i]);
    T.skinTex[tone] = texFromCanvas(recolorCanvas(T.face.canvas, T.skinMask, gains));
  }
  return T.skinTex[tone];
}

function pieceUrl(cat, id) {
  const sub = { hair: "hair", top: "tops", bottom: "bottoms", shoes: "shoes" }[cat];
  return `${BASE}/${sub}/${id}.glb`;
}

// load (and cache) an attachment template; resolves to a matte scene
function loadPiece(cat, id) {
  const key = `${cat}/${id}`;
  if (T.pieces[key]) return Promise.resolve(T.pieces[key]);
  if (!T.pieceLoads[key]) {
    T.pieceLoads[key] = loader.loadAsync(pieceUrl(cat, id)).then(g => {
      matteify(g.scene);
      // segmentation left some bottoms with hidden inner surfaces reaching
      // the chest (invisible on the source model, visible worn) — crop any
      // face fully above the waistline of the shared source frame
      if (cat === "bottom") cropAboveY(g.scene, 0.22);
      const trim = PIECE_TRIM[key];
      if (trim) {
        // raw-frame front/side axes: inner.rotation.y = -T.yaw maps raw to
        // scene, so raw "front" is scene +Z rotated by +T.yaw
        const f = new THREE.Vector3(Math.sin(T.yaw), 0, Math.cos(T.yaw));
        const s = new THREE.Vector3(Math.cos(T.yaw), 0, -Math.sin(T.yaw));
        cropTris(g.scene, v =>
          v.y < trim.yBelow && v.dot(f) > trim.front &&
          Math.abs(v.dot(s)) < trim.halfWidth);
      }
      if (cat === "hair") {
        // remember the neutral texture canvas + its median color once
        let map = null;
        g.scene.traverse(o => { if (!map && o.material?.map?.image) map = o.material.map; });
        if (map) {
          const im = map.image;
          const cv = document.createElement("canvas");
          const sc = Math.min(1, 1024 / im.width);
          cv.width = Math.round(im.width * sc);
          cv.height = Math.round(im.height * sc);
          const ctx = cv.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(im, 0, 0, cv.width, cv.height);
          const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
          const rs = [], gs = [], bs = [];
          for (let p = 0; p < d.length; p += 16) {
            rs.push(d[p]); gs.push(d[p + 1]); bs.push(d[p + 2]);
          }
          const med = a => a.sort((x, y) => x - y)[a.length >> 1];
          T.hairCv[id] = { canvas: cv, base: [med(rs), med(gs), med(bs)] };
        }
      }
      T.pieces[key] = g.scene;
      delete T.pieceLoads[key];
      return g.scene;
    });
  }
  return T.pieceLoads[key];
}

function hairTexture(style, color) {
  const key = `${style}_${color}`;
  if (T.hairTex[key]) return T.hairTex[key];
  const rec = T.hairCv[style];
  if (!rec) return null;
  const target = HAIR_RGB[color];
  const gains = target.map((t, i) => t / Math.max(8, rec.base[i]));
  const all = new Uint8Array(rec.canvas.width * rec.canvas.height).fill(1);
  T.hairTex[key] = texFromCanvas(recolorCanvas(rec.canvas, all, gains));
  return T.hairTex[key];
}

// single curved patch carrying the whole face decal, aimed at the face.
// texture/geometry/material are per-build GPU resources — they register in
// `owned` so rebuild()/dispose() can free them. `face` defaults to the
// static template's analysis; the animated template passes its own (the
// rigged export re-bakes the atlas, so face position/UVs differ).
function facePatch(cfg, owned, face = T.face) {
  if (V4) return null; // baked face (see V4 note at the top)
  const img = T.decals[`${cfg.face}_${cfg.iris}`];
  if (!img || !face) return null;
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext("2d");
  // inset the decal source 14% per side: the offline extraction leaves ear
  // stroke fragments at the extreme edges (9% still let them peek through
  // beside the eyes on f1/f2)
  const ix = img.width * 0.14;
  const sw = img.width - ix * 2;
  const ar = sw / img.height;
  const w = 236, h = Math.min(210, w / ar);
  ctx.drawImage(img, ix, 0, sw, img.height, (256 - w) / 2, (256 - h) / 2, w, h);
  // ear strokes reach further inboard than any safe crop (they'd take the
  // eye corners with them) — erase pale FLESH-toned pixels in the outer
  // bands. The r-g floor keeps pure-white eye highlights (r≈g≈b) safe;
  // connectivity tricks don't work here because the decals carry a
  // semi-opaque skin-tone backing that connects every feature.
  const id = ctx.getImageData(0, 0, 256, 256);
  const px = id.data;
  const band = Math.round(256 * 0.27);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      if (x >= band && x < 256 - band) continue;
      const p = (y * 256 + x) * 4;
      if (px[p + 3] === 0) continue;
      const r = px[p], g = px[p + 1], b = px[p + 2];
      if (r > 165 && g > 105 && b > 95 && r - b < 110 &&
          Math.max(r, g, b) - Math.min(r, g, b) < 85) {
        px[p + 3] = 0;
      }
    }
  }
  ctx.putImageData(id, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const angH = 0.62, angV = 0.44;
  // 1.05: hug the skull — at 1.12 the decal visibly floated clear of the
  // head silhouette in profile views
  const geo = new THREE.SphereGeometry(face.R * 1.05, 24, 24,
    Math.PI / 2 - angH, angH * 2, Math.PI / 2 - angV, angV * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.03, side: THREE.FrontSide }));
  owned.push(tex, geo, mesh.material);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.dir);
  const holder = new THREE.Group();
  holder.position.copy(face.C);
  holder.add(mesh);
  return holder;
}

// ---- v4: hide the base outfit under a garment ----
// The v4 base wears its own tee/shorts/sneakers, as bulky as any garment, so
// they poke through whatever is worn on top. Hide every NON-SKIN body triangle
// that sits within COVER_R of a garment vertex (skin is never hidden: a V-neck
// still shows the tee, cuffs still show wrists). Body geometry is shared
// across characters, so each character gets a shallow geometry (same
// attribute buffers, its own index).
const COVER_R = 0.62; // world units at CHAR_H 15 (~3.5 % of height)
function coveredTris(bodyMesh, srcGeo, mask, mw, mh, garmentRoot, R = COVER_R, skinned = false) {
  // srcGeo, not bodyMesh.geometry: once one garment is on, the mesh carries the
  // re-packed shallow index, and flags computed in THAT order hide random
  // triangles when applied in source order (speckled heads with top + bottom)
  const pos = srcGeo.attributes.position, uv = srcGeo.attributes.uv;
  const idx = srcGeo.index.array;
  const cell = R, grid = new Map();
  const v = new THREE.Vector3();
  let gLo = Infinity, gHi = -Infinity; // only hide INSIDE the garment's own height span,
  garmentRoot.updateWorldMatrix(true, true);   // or the radius nibbles shorts below a hem
  garmentRoot.traverse(o => {
    if (!o.isMesh) return;
    const gp = o.geometry.attributes.position;
    const used = o.geometry.index ? new Set(o.geometry.index.array) : null; // referenced verts only
    for (let i = 0; i < gp.count; i++) {
      if (used && !used.has(i)) continue;
      v.fromBufferAttribute(gp, i).applyMatrix4(o.matrixWorld);
      gLo = Math.min(gLo, v.y); gHi = Math.max(gHi, v.y);
      const k = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
      let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(v.x, v.y, v.z);
    }
  });
  bodyMesh.updateWorldMatrix(true, false);
  const isSkin = i => {
    if (!mask || !uv) return false;
    const x = Math.min(mw - 1, Math.max(0, Math.round(uv.getX(i) * mw)));
    const y = Math.min(mh - 1, Math.max(0, Math.round(uv.getY(i) * mh)));
    return mask[y * mw + x] === 1;
  };
  const skinV = skinned ? (bodyMesh.applyBoneTransforms ?? bodyMesh.boneTransform).bind(bodyMesh) : null;
  // "covered" = a garment vertex sits OUTSIDE this body vertex, roughly along
  // its normal — not merely nearby. An open coat's lapels are near the tee
  // they frame without covering it; a plain radius test ate ragged holes into
  // everything visible through the opening.
  const nrm = srcGeo.attributes.normal, nv = new THREE.Vector3(), dv = new THREE.Vector3();
  const nMat = new THREE.Matrix3().getNormalMatrix(bodyMesh.matrixWorld);
  const near = i => {
    v.fromBufferAttribute(pos, i);
    if (skinV) skinV(i, v);
    v.applyMatrix4(bodyMesh.matrixWorld);
    if (v.y < gLo || v.y > gHi) return false;
    if (nrm) nv.fromBufferAttribute(nrm, i).applyMatrix3(nMat).normalize();
    const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
      for (let j = 0; j < a.length; j += 3) {
        dv.set(a[j] - v.x, a[j + 1] - v.y, a[j + 2] - v.z);
        const d2 = dv.lengthSq();
        if (d2 >= R * R) continue;
        if (!nrm) return true;
        const along = dv.dot(nv);                       // + = garment is outside
        // lateral tolerance ~ one garment vertex spacing: low-poly pieces are sparse,
        // and at 0.6 R parts of the tee found no vertex above them and poked through
        if (along > -0.25 * R && d2 - along * along < (0.95 * R) ** 2) return true;
      }
    }
    return false;
  };
  const vertHide = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) vertHide[i] = !isSkin(i) && near(i) ? 1 : 0;
  const hide = new Uint8Array(idx.length / 3);
  for (let t = 0; t < hide.length; t++) hide[t] = vertHide[idx[t * 3]] && vertHide[idx[t * 3 + 1]] && vertHide[idx[t * 3 + 2]] ? 1 : 0;
  return hide;
}
// One shallow geometry per character: the template's attribute buffers by
// reference, its OWN index copy. Hidden triangles are handled by packing the
// kept ones to the front and shrinking the draw range — same-size index, so
// nothing is reallocated per outfit change. NEVER dispose() one of these:
// three frees the GPU buffers of every attribute it holds, and the template
// plus every other character still point at them (it showed up as white
// speckle all over the head as soon as a second garment re-applied covers).
function shallowBodyGeometry(srcGeo) {
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(srcGeo.attributes)) g.setAttribute(k, srcGeo.attributes[k]);
  g.setIndex(new THREE.BufferAttribute(srcGeo.index.array.slice(), 1));
  g.boundingBox = srcGeo.boundingBox; g.boundingSphere = srcGeo.boundingSphere;
  return g;
}
function applyCovers(g, srcGeo, hideSets) {
  const src = srcGeo.index.array, dst = g.index.array;
  let w = 0;
  for (let t = 0; t < src.length / 3; t++) {
    if (hideSets.some(h => h[t])) continue;
    dst[w++] = src[t * 3]; dst[w++] = src[t * 3 + 1]; dst[w++] = src[t * 3 + 2];
  }
  g.index.needsUpdate = true;
  g.setDrawRange(0, w);
}

// per-style correction table (raw garment-frame units; pieces are
// zero-centered, body is 1.0 tall). lift: f2 rides low. yaw: f5's GLB
// exports facing backwards — its curtain hung over the face. trim: f2's
// fringe hangs to the nose — clip the central fringe triangles below brow
// height in the raw frame (raw "front" is the +T.yaw direction).
const PIECE_LIFT = { "hair/f2": 0.02 };
const PIECE_YAW = { "hair/f5": Math.PI };
const PIECE_TRIM = { "hair/f2": { yBelow: 0.335, front: 0.03, halfWidth: 0.12 } };

function attachWrapper(scene, pieceKey) {
  const clone = scene.clone(true);
  clone.traverse(o => {
    if (o.isMesh) o.material = o.material.clone();
  });
  // garment GLBs live in a zero-centered Tripo frame; the rigged body's
  // frame may be offset — move pieces into the body's frame, then match
  // its yaw so they turn with the face
  const inner = new THREE.Group();
  inner.add(clone);
  inner.rotation.y = -T.yaw + (PIECE_YAW[pieceKey] ?? 0);
  inner.position.copy(T.srcCenter); // then step into the body's frame
  inner.position.y += PIECE_LIFT[pieceKey] ?? 0;
  const wrap = new THREE.Group();
  wrap.scale.setScalar(T.fitScale);
  wrap.position.copy(T.fitOffset);
  wrap.add(inner);
  return wrap;
}

function buildHumanApi(cfg) {
  const group = new THREE.Group();
  let disposed = false;
  // Every rebuild bumps the epoch; async attachment loads capture theirs and
  // bail if another rebuild happened meanwhile. (A config-VALUE compare is
  // not enough: an A→B→A flip lets the stale in-flight A-load attach twice.)
  let epoch = 0;
  // per-build GPU resources we created (materials, face-patch tex/geo) —
  // freed on the next rebuild and on dispose. Shared template resources
  // (piece geometries, skin/hair texture caches, decals) are never freed.
  let owned = [];
  const disposeOwned = () => { for (const r of owned) r.dispose?.(); owned = []; };

  const rebuild = () => {
    const myEpoch = ++epoch;
    disposeOwned();
    group.clear();
    // body (static clone of the template) — swap in the tone texture.
    // castShadow is set HERE, not just by the world at spawn: rebuild()
    // replaces the meshes, so spawn-time flags are lost on outfit changes.
    const body = T.fit.clone(true);
    let bodyMesh = null, bodySrcGeo = null;
    const covers = []; // v4: hidden-triangle sets, one per attached garment
    body.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.material = new THREE.MeshLambertMaterial({
          map: getSkinTex(cfg.skin) ?? o.material.map ?? null });
        o.frustumCulled = false;
        o.castShadow = true;
        owned.push(o.material); // map is the shared tone cache — material only
        if (!bodyMesh) { bodyMesh = o; bodySrcGeo = o.geometry; }
      }
    });
    group.add(body);
    // face decal rides inside the body's source frame (bone-space ≈ source
    // frame at rest since we bob the whole group, not the bones)
    const fp = facePatch(cfg, owned);
    if (fp) {
      const wrap = new THREE.Group();
      wrap.scale.setScalar(T.fitScale);
      wrap.position.copy(T.fitOffset);
      wrap.add(fp);
      fp.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(wrap);
    }
    // attachments — async-load then attach if this build is still current
    const want = [];
    if (cfg.hair !== "none") want.push(["hair", cfg.hair]);
    if (cfg.top !== "none") want.push(["top", cfg.top]);
    if (cfg.bottom !== "none") want.push(["bottom", cfg.bottom]);
    if (cfg.shoes !== "none") want.push(["shoes", cfg.shoes]);
    for (const [cat, id] of want) {
      loadPiece(cat, id).then(scene => {
        if (disposed || myEpoch !== epoch) return;
        const wrap = attachWrapper(scene, `${cat}/${id}`);
        if (cat === "hair") {
          const tex = hairTexture(id, cfg.hairColor);
          if (tex) wrap.traverse(o => { if (o.isMesh) { o.material.map = tex; o.material.needsUpdate = true; } });
        }
        wrap.traverse(o => {
          if (o.isMesh) { o.castShadow = true; owned.push(o.material); }
        });
        group.add(wrap);
        if (V4 && cat !== "hair" && bodyMesh && bodySrcGeo.index) {
          // same body + same piece => same answer for every character
          const key = `${cat}/${id}`;
          // rigid placement of the character does not change distances; only a
          // group scale would, so the radius follows it
          group.updateWorldMatrix(true, true);
          const gs = group.getWorldScale(new THREE.Vector3()).x || 1;
          T.cover[key] ??= coveredTris(bodyMesh, bodySrcGeo, T.skinMask, T.face?.canvas.width ?? 0,
                                       T.face?.canvas.height ?? 0, wrap, COVER_R * gs);
          covers.push(T.cover[key]);
          if (bodyMesh.geometry === bodySrcGeo) bodyMesh.geometry = shallowBodyGeometry(bodySrcGeo);
          applyCovers(bodyMesh.geometry, bodySrcGeo, covers);
        }
      }).catch(e => console.warn("[avatar] attach", cat, id, e));
    }
  };
  rebuild();

  return {
    group,
    get config() { return { ...cfg }; },
    setConfig(next) {
      cfg = normalizeAvatar3({ ...cfg, ...next });
      rebuild();
    },
    dispose() {
      disposed = true;
      epoch++;          // orphan any in-flight attachment loads
      disposeOwned();
      group.clear();
    },
    walking: false,
    phase: Math.random() * Math.PI * 2,
    tick(t) { // same body language contract as the blob
      const p = t * (this.walking ? 9 : 2) + this.phase;
      const s = Math.sin(p);
      if (this.walking) {
        group.position.y = Math.abs(s) * 0.5;
        group.rotation.z = s * 0.05;
      } else {
        group.position.y = s * 0.14;
        group.rotation.z = 0;
      }
    },
  };
}

// ---------------- animated-body mode (opt-in) ----------------
// Tripo-retargeted clips (avatar3/anims/idle.glb + walk.glb — same rig as
// body.glb). The idle scene IS the body; garments follow the skeleton via
// runtime skin-weight transfer from the nearest body vertex, so every
// cosmetic combination animates without per-outfit rigging. Kept opt-in
// (?anim=1 in world3d) until visually signed off; the static bob stays the
// shipped default.
let animPromise = null;
let AT = null; // { scene, clips: {idle, walk}, bodyMesh }

export function loadAnimTemplate() {
  if (animPromise) return animPromise;
  animPromise = (async () => {
    await loadHumanTemplate(); // skin masks / decals / piece cache
    const [gi, gw] = await Promise.all([
      loader.loadAsync(`${BASE}/anims/idle.glb`),
      loader.loadAsync(`${BASE}/anims/walk.glb`),
    ]);
    const scene = gi.scene;
    scene.updateWorldMatrix(true, true);
    let bodyMesh = null;
    scene.traverse(o => { if (o.isSkinnedMesh && !bodyMesh) bodyMesh = o; });
    if (!bodyMesh) throw new Error("anim idle.glb has no skinned mesh");
    // the rigged export re-bakes its own atlas — the static template's
    // face-erase/skin-mask coordinates don't apply. Run the same analysis
    // on THIS texture.
    const face = analyzeFace(scene);
    const skinMask = face ? buildSkinMask(face.canvas) : null;
    AT = {
      scene,
      clips: { idle: gi.animations[0] ?? null, walk: gw.animations[0] ?? null },
      bodyMesh, face, skinMask,
      skinBase: face ? skinBaseOf(face.canvas, skinMask) : SKIN_BASE,
      skinTex: {}, // tone -> texture, lazy (same recolor as the static path)
    };
    return AT;
  })();
  return animPromise;
}

// copy skinIndex/skinWeight from the nearest body vertex onto a garment
// mesh and bind it to the body's skeleton. Both inputs must have live
// world matrices; the garment geometry is rebuilt in the body's LOCAL
// (bind) frame so the skinning math matches the body exactly.
const _acc = new THREE.Matrix4(), _S = new THREE.Matrix4();
function skinToBody(garmentMesh, bodySkinned, rigidToHead = false) {
  const gGeo = garmentMesh.geometry.clone();
  const gPos = gGeo.attributes.position;
  const bGeo = bodySkinned.geometry;
  const bPos = bGeo.attributes.position;
  const bIdx = bGeo.attributes.skinIndex;
  const bWt = bGeo.attributes.skinWeight;
  // body verts to world once, into a coarse spatial hash
  const bWorld = new Float32Array(bPos.count * 3);
  const v = new THREE.Vector3();
  const cell = 0.9; // world units (~15-unit body): fine enough, cheap enough
  const hash = new Map();
  const keyOf = (x, y, z) =>
    `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  // v4: match against where the body actually RENDERS (skinned), not raw
  // geometry x node matrix — on the v2.5 rig those are different places and
  // every garment vertex snapped to the feet
  const skinV = V4 ? (bodySkinned.applyBoneTransforms ?? bodySkinned.boneTransform).bind(bodySkinned) : null;
  for (let i = 0; i < bPos.count; i++) {
    v.fromBufferAttribute(bPos, i);
    if (skinV) skinV(i, v);
    v.applyMatrix4(bodySkinned.matrixWorld);
    bWorld[i * 3] = v.x; bWorld[i * 3 + 1] = v.y; bWorld[i * 3 + 2] = v.z;
    const k = keyOf(v.x, v.y, v.z);
    let arr = hash.get(k);
    if (!arr) hash.set(k, arr = []);
    arr.push(i);
  }
  const nearest = (x, y, z) => {
    let best = -1, bd = Infinity;
    const cx = Math.round(x / cell), cy = Math.round(y / cell), cz = Math.round(z / cell);
    for (let r = 0; r < 4 && best < 0; r++) { // grow the ring until a hit
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const arr = hash.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!arr) continue;
        for (const i of arr) {
          const ddx = bWorld[i * 3] - x, ddy = bWorld[i * 3 + 1] - y, ddz = bWorld[i * 3 + 2] - z;
          const d = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best;
  };
  // hair rides the head RIGIDLY: spikes and long strands sit far from any body
  // vertex, fall out of the nearest-vertex search and used to bind to the root
  // bone (smeared upward for ever). Everything copies the head-top vertex.
  let headTop = -1;
  if (rigidToHead) { let hy = -Infinity; for (let i = 0; i < bPos.count; i++) if (bWorld[i * 3 + 1] > hy) { hy = bWorld[i * 3 + 1]; headTop = i; } }
  const inv = new THREE.Matrix4().copy(bodySkinned.matrixWorld).invert();
  const idx = new Uint16Array(gPos.count * 4);
  const wt = new Float32Array(gPos.count * 4);
  for (let i = 0; i < gPos.count; i++) {
    v.fromBufferAttribute(gPos, i).applyMatrix4(garmentMesh.matrixWorld);
    const n = headTop >= 0 ? headTop : nearest(v.x, v.y, v.z);
    if (n >= 0) {
      for (let c = 0; c < 4; c++) {
        idx[i * 4 + c] = bIdx.getComponent(n, c);
        wt[i * 4 + c] = bWt.getComponent(n, c);
      }
    } else { wt[i * 4] = 1; }
    // rebuild the vertex in the body's local frame
    v.applyMatrix4(inv);
    if (V4 && n >= 0) {
      // exact for ANY pose: undo the matched vertex's skin matrix
      // S = bindInv * sum(w * boneMatrix) * bind, so that S * g lands on v
      const bm = bodySkinned.skeleton.boneMatrices, e = _acc.elements;
      e.fill(0);
      for (let c = 0; c < 4; c++) {
        const w = bWt.getComponent(n, c); if (!w) continue;
        const o = bIdx.getComponent(n, c) * 16;
        for (let k = 0; k < 16; k++) e[k] += bm[o + k] * w;
      }
      _S.copy(bodySkinned.bindMatrixInverse).multiply(_acc).multiply(bodySkinned.bindMatrix).invert();
      v.applyMatrix4(_S);
    }
    gPos.setXYZ(i, v.x, v.y, v.z);
  }
  gGeo.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  gGeo.setAttribute("skinWeight", new THREE.BufferAttribute(wt, 4));
  const sm = new THREE.SkinnedMesh(gGeo, garmentMesh.material);
  sm.frustumCulled = false;
  sm.castShadow = true;
  return sm; // caller binds: sm.bind(skeleton, bindMatrix) + parents it
}

function getAnimSkinTex(tone) {
  if (!AT?.face || !AT.skinMask) return null;
  if (!AT.skinTex[tone]) {
    const gains = SKIN_RGB[tone].map((t, i) => t / AT.skinBase[i]);
    AT.skinTex[tone] = texFromCanvas(recolorCanvas(AT.face.canvas, AT.skinMask, gains));
  }
  return AT.skinTex[tone];
}

function buildAnimApi(cfg) {
  const group = new THREE.Group();
  let disposed = false;
  let epoch = 0;
  let owned = [];
  const disposeOwned = () => { for (const r of owned) r.dispose?.(); owned = []; };

  // fit the animated scene exactly like the static template: same height,
  // feet on ground, face already yawed by the shared T numbers (the anim
  // GLBs come from the same source body, so T's fit transform applies)
  const rig = SkeletonUtils.clone(AT.scene);
  const fit = new THREE.Group();
  fit.add(rig);
  fit.rotation.y = -T.yaw;
  const mixer = new THREE.AnimationMixer(rig);
  const idle = AT.clips.idle ? mixer.clipAction(AT.clips.idle) : null;
  const walk = AT.clips.walk ? mixer.clipAction(AT.clips.walk) : null;
  idle?.play();

  let bodySkinned = null;
  rig.traverse(o => { if (o.isSkinnedMesh && !bodySkinned) bodySkinned = o; });
  const bodySrcGeoA = bodySkinned?.geometry ?? null; // shared template geometry
  let coversA = [];                                   // v4: hidden-triangle sets
  let shallowA = null;                                // v4: this character's body geometry

  // Tripo rigs carry wild mesh-node transforms: a static Box3 measure is
  // off by orders of magnitude vs what the skinning pipeline renders.
  // Measure TRUE skinned world bounds — and note boneMatrices are
  // renderer-updated, so skeleton.update() must be forced per sample.
  const measure = (clipTime) => {
    mixer.setTime(clipTime);
    // v4: updateMatrixWorld (not updateWorldMatrix) — only it refreshes an
    // attached SkinnedMesh's bindMatrixInverse; with a stale one the v4 rig
    // measures ~half a body too high and the character sinks waist-deep.
    // v3 keeps the call its fit numbers were tuned against.
    if (V4) fit.updateMatrixWorld(true); else fit.updateWorldMatrix(true, true);
    bodySkinned.skeleton.update();
    const box = new THREE.Box3();
    const pos = bodySkinned.geometry.attributes.position;
    const v = new THREE.Vector3();
    // r160 names it boneTransform; later releases applyBoneTransforms
    const skinV = (bodySkinned.applyBoneTransforms ?? bodySkinned.boneTransform)
      .bind(bodySkinned);
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i);
      skinV(i, v);
      v.applyMatrix4(bodySkinned.matrixWorld);
      box.expandByPoint(v);
    }
    return box;
  };
  const bb = measure(0); // frame 0: scale + centering
  // ground on the LOWEST foot contact across the idle cycle — presets can
  // hover above their frame-0 pose for most of the loop, which read as
  // "floating above the map"
  let minY = bb.min.y;
  const idleDur = AT.clips.idle?.duration ?? 0;
  for (const f of [0.2, 0.45, 0.7, 0.95]) {
    minY = Math.min(minY, measure(f * idleDur).min.y);
  }
  mixer.setTime(0);
  const size = new THREE.Vector3();
  bb.getSize(size);
  const s = CHAR_H / size.y;
  fit.scale.setScalar(s);
  fit.position.set(-s * (bb.min.x + bb.max.x) / 2, -s * minY,
                   -s * (bb.min.z + bb.max.z) / 2);
  group.add(fit);
  // the rigged body's proportions shift slightly vs the static template —
  // hair jigged with static numbers lands low on this head. Lift it by the
  // measured world-space face-height difference between the two templates.
  const staticFaceY = T.face ? T.face.C.y * T.fitScale + T.fitOffset.y : 0;
  const animFaceY = AT.face ? AT.face.C.y * s + fit.position.y : staticFaceY;
  // +0.3: the rigged head is also marginally smaller — measured delta alone
  // still leaves fringes brushing the eye line
  // v4: no lift. AT.face.C is measured on the clip's UNSKINNED geometry, which on
  // the v2.5 rig is not where the head renders — the 'correction' floated the
  // hair a head-height above the character. Static jig + same world fit suffices.
  const headLift = V4 ? 0 : animFaceY - staticFaceY + 0.3;

  const rebuild = () => {
    const myEpoch = ++epoch;
    disposeOwned();
    // strip previous garments/decals (children tagged as attachments)
    for (const c of [...group.children]) if (c.userData.attachment) group.remove(c);
    for (const c of [...(bodySkinned?.parent?.children ?? [])]) {
      if (c.userData.attachment) c.parent.remove(c);
    }
    if (V4 && bodySkinned && bodySrcGeoA) {
      coversA = [];
      if (shallowA) { applyCovers(shallowA, bodySrcGeoA, coversA); bodySkinned.geometry = shallowA; }
    }
    if (bodySkinned) {
      bodySkinned.material = new THREE.MeshLambertMaterial({
        map: getAnimSkinTex(cfg.skin) ?? bodySkinned.material.map ?? null });
      bodySkinned.frustumCulled = false;
      bodySkinned.castShadow = true;
      owned.push(bodySkinned.material);
    }
    // face decal rides the fit frame (rest-pose aligned; head motion in the
    // idle clip is small — known approximation, review before default-on)
    const fp = facePatch(cfg, owned, AT.face);
    if (fp) {
      const wrap = new THREE.Group();
      wrap.userData.attachment = true;
      wrap.add(fp);
      fp.traverse(o => { if (o.isMesh) o.castShadow = true; });
      fit.add(wrap);
    }
    const want = [];
    if (cfg.hair !== "none") want.push(["hair", cfg.hair]);
    if (cfg.top !== "none") want.push(["top", cfg.top]);
    if (cfg.bottom !== "none") want.push(["bottom", cfg.bottom]);
    if (cfg.shoes !== "none") want.push(["shoes", cfg.shoes]);
    for (const [cat, id] of want) {
      loadPiece(cat, id).then(scene => {
        if (disposed || myEpoch !== epoch) return;
        const wrap = attachWrapper(scene, `${cat}/${id}`);
        if (cat === "hair") {
          const tex = hairTexture(id, cfg.hairColor);
          if (tex) wrap.traverse(o => { if (o.isMesh) { o.material.map = tex; o.material.needsUpdate = true; } });
        }
        // position the wrap inside fit (shares the static template's
        // source-frame math), then convert each mesh to a skinned copy
        // attachWrapper output is already WORLD-fitted (static template
        // numbers) — jig it at group level, NOT under the anim fit, or it
        // double-transforms. Both fits normalize to the same world pose.
        wrap.userData.attachment = true;
        if (cat === "hair") wrap.position.y += headLift;
        group.add(wrap);
        wrap.updateWorldMatrix(true, true);
        bodySkinned.updateWorldMatrix(true, true);
        if (V4) { group.updateMatrixWorld(true); bodySkinned.skeleton.update(); } // fresh bind inverse + bone matrices
        if (V4 && cat !== "hair" && bodySrcGeoA?.index) {
          const key = `${cat}/${id}`;
          const gs = group.getWorldScale(new THREE.Vector3()).x || 1;
          const keep = bodySkinned.geometry;
          bodySkinned.geometry = bodySrcGeoA; // measure on the full body
          AT.cover ??= {};
          AT.cover[key] ??= coveredTris(bodySkinned, bodySrcGeoA, AT.skinMask, AT.face?.canvas.width ?? 0,
                                        AT.face?.canvas.height ?? 0, wrap, COVER_R * gs * 1.3, true); // anim fit differs ~2 % from the static jig
          bodySkinned.geometry = keep;
          coversA.push(AT.cover[key]);
          shallowA ??= shallowBodyGeometry(bodySrcGeoA);
          bodySkinned.geometry = shallowA;
          applyCovers(shallowA, bodySrcGeoA, coversA);
        }
        const skinned = [];
        wrap.traverse(o => {
          if (!o.isMesh) return;
          owned.push(o.material);
          const sm = skinToBody(o, bodySkinned, V4 && cat === "hair");
          owned.push(sm.geometry);
          sm.material = o.material;
          skinned.push(sm);
        });
        for (const sm of skinned) {
          // geometry was baked into the body mesh's LOCAL frame — the
          // garment must render through the SAME node matrix (Tripo rigs
          // carry big mesh-node transforms; a plain sibling would miss
          // them). Copy the body's local matrix verbatim.
          sm.userData.attachment = true;
          sm.matrixAutoUpdate = false;
          sm.matrix.copy(bodySkinned.matrix);
          bodySkinned.parent.add(sm);
          sm.bind(bodySkinned.skeleton, bodySkinned.bindMatrix);
        }
        group.remove(wrap); // static wrap was only a positioning jig
      }).catch(() => {});
    }
  };
  rebuild();

  let wasWalking = false;
  let lastT = null;
  return {
    group,
    get config() { return { ...cfg }; },
    setConfig(next) {
      cfg = normalizeAvatar3({ ...cfg, ...next });
      rebuild();
    },
    dispose() {
      disposed = true;
      epoch++;
      disposeOwned();
      group.clear();
    },
    walking: false,
    phase: Math.random() * Math.PI * 2,
    tick(t) {
      if (walk && this.walking !== wasWalking) {
        const [from, to] = this.walking ? [idle, walk] : [walk, idle];
        to?.reset().fadeIn(0.22).play();
        from?.fadeOut(0.22);
        wasWalking = this.walking;
      }
      const dt = lastT === null ? 0.016 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      mixer.update(dt);
    },
  };
}

export async function makeAnimatedCharacter(rawCfg) {
  await loadAnimTemplate();
  return buildAnimApi(normalizeAvatar3(rawCfg));
}

export const __debugT = () => T; // dev harness introspection only

export async function makeHumanCharacter(rawCfg) {
  await loadHumanTemplate();
  return buildHumanApi(normalizeAvatar3(rawCfg));
}

// sync path for spawn loops; null until the template resolves — callers
// fall back to the procedural blob (same pattern as the GLB mode)
export function makeHumanCharacterSync(rawCfg) {
  return T ? buildHumanApi(normalizeAvatar3(rawCfg)) : null;
}

// 2D identity thumb for chat headers / cards: skin-tone disc + face decal.
// Synchronous; returns a neutral placeholder until decals are loaded.
export function avatarThumb3(rawCfg, size = 128) {
  const cfg = normalizeAvatar3(rawCfg);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const skin = SKIN_RGB[cfg.skin] ?? SKIN_BASE;
  g.fillStyle = `rgb(${skin[0]},${skin[1]},${skin[2]})`;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  g.fill();
  const hair = HAIR_RGB[cfg.hairColor] ?? [90, 80, 76];
  if (cfg.hair !== "none") { // simple cap arc suggests the hair color
    g.fillStyle = `rgb(${hair[0]},${hair[1]},${hair[2]})`;
    g.beginPath();
    g.arc(size / 2, size / 2 - size * 0.04, size * 0.43, Math.PI * 1.05, Math.PI * 1.95);
    g.fill();
  }
  const img = DECALS[`${cfg.face}_${cfg.iris}`];
  if (img) {
    const ar = img.width / img.height;
    const w = size * 0.62, h = w / ar;
    g.drawImage(img, (size - w) / 2, size * 0.44 - h / 2, w, h);
  }
  return cv.toDataURL();
}
