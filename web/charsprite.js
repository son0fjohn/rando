// Top-down 2D sprites of each player's own character, for the party room.
//
// The player's real 3D avatar (avatar3.js: their hair, colors, outfit) is
// posed and rendered through an orthographic camera tilted down from a 3/4
// angle, into a small canvas at 4x, then flattened:
//   * unlit solid colors: skin and hair from the avatar palette, each
//     garment its median texture color (Tripo textures are too noisy to
//     keep), every pixel snapped to that palette and reduced 4x4 -> 1
//   * stray specks removed, then a 1px outline in a deep shade of whatever
//     color it borders (never pure black)
//   * eyes painted at their projected spot, 2x3 with a white highlight,
//     so they read as big and open at this size
// Shown with nearest-neighbor scaling at whole multiples, so it stays crisp.
//
// One sheet per look: rows = down, left, up (the room flips left for right),
// columns = [stand, walk 1-4]. Walk frames come from the rig's walk clip;
// without it all five columns are the standing pose and the room bobs the
// sprite instead. Idle breathing is CSS.
//
// Sheets are cached per look (memory + sessionStorage) and rebuilt only when
// the look changes. If 3D can't render at all, the fallback is a little
// pixel figure in the player's own skin, hair and outfit colors.
const W = 32, H = 40;                        // sprite pixels per frame
const SS = 4;                                // rendered at 4x, reduced per 4x4 block
const COLS = 5, FACINGS = ["down", "left", "up"];
const VERSION = 3;
export const SPRITE = { W, H, COLS, FACINGS };

const EYE = [34, 28, 52], WHITE = [252, 252, 255];
const WORDS = { black: [44, 44, 52], white: [238, 240, 236], maroon: [128, 38, 56], blue: [70, 112, 196], navy: [44, 58, 104],
  khaki: [190, 166, 104], camo: [104, 118, 72], brown: [124, 88, 60], grey: [146, 150, 158], green: [84, 150, 86], pink: [240, 140, 176], tan: [196, 152, 98] };
const FALLBACK_SKIN = { 1: [238, 196, 156], 2: [205, 170, 147], 3: [192, 135, 91], 4: [155, 99, 65], 5: [89, 60, 44] };
const FALLBACK_HAIR = { black: [53, 52, 57], brown: [115, 82, 70], yellow: [225, 185, 122], red: [206, 55, 58], white: [225, 210, 200] };
const FALLBACK_IRIS = { black: "#262a30", navy: "#2e4468", current: "#4a4e57", brown: "#8a6a52", blue: "#3f7fd1", green: "#5d9c53" };

const mem = new Map();                        // look key -> Promise<sheet>
const lookKey = cfg => `v${VERSION}:` + ["skin", "hair", "hairColor", "face", "iris", "top", "bottom", "shoes"].map(k => cfg?.[k] ?? "").join("|");

// ---------------------------------------------------------------- public
// Resolves to { url, anim, fallback }. Never rejects.
export function spriteFor(avatar) {
  const key = lookKey(avatar);
  if (!mem.has(key)) {
    let cached = null;
    try { cached = sessionStorage.getItem("rando-spr:" + key); } catch {}
    mem.set(key, cached ? Promise.resolve(JSON.parse(cached)) : queue(() => build(avatar)).then(sheet => {
      try { if (!sheet.fallback) sessionStorage.setItem("rando-spr:" + key, JSON.stringify(sheet)); } catch {}
      return sheet;
    }));
  }
  return mem.get(key);
}
// synchronous: what to show before (or instead of) the 3D sheet
const figCache = new Map();
export function silhouetteFor(avatar) {
  const key = lookKey(avatar);
  if (figCache.has(key)) return figCache.get(key);
  const sheet = document.createElement("canvas");
  sheet.width = W * COLS; sheet.height = H * FACINGS.length;
  const sg = sheet.getContext("2d");
  FACINGS.forEach((f, r) => { for (let c = 0; c < COLS; c++) sg.drawImage(flatten(figure(avatar, f, c)), c * W, r * H); });
  const out = { url: sheet.toDataURL(), anim: true, fallback: true };
  figCache.set(key, out);
  return out;
}

// one build at a time: building a skinned avatar is real CPU work on a phone
let chain = Promise.resolve();
function queue(fn) {
  const p = chain.then(() => new Promise(r => setTimeout(r, 30))).then(fn);
  chain = p.catch(() => {});
  return p;
}
async function build(avatar) {
  try { return await render3d(avatar); }
  catch (e) { console.warn("[charsprite] 3D sprite failed, using the pixel figure", e); return silhouetteFor(avatar); }
}

// ---------------------------------------------------------------- 3D
let R = null;                                 // { THREE, A, renderer, scene, cam, camDir }
async function rig() {
  if (R) return R;
  const THREE = await import("https://esm.sh/three@0.160.0");
  const A = await import("./avatar3.js");
  if (!A.makeHumanCharacter) throw new Error("no avatar renderer here");
  const canvas = document.createElement("canvas");
  canvas.width = W * SS; canvas.height = H * SS;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W * SS, H * SS, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // 3/4 overworld view: tilted 30 degrees down at a 15-unit-tall character
  const halfH = 7.6, halfW = halfH * W / H, elev = Math.PI / 6;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 120);
  const target = new THREE.Vector3(0, 7.3, 0);
  cam.position.set(0, target.y + Math.sin(elev) * 60, Math.cos(elev) * 60);
  cam.lookAt(target);
  const camDir = cam.position.clone().sub(target).normalize();
  R = { THREE, A, renderer, scene, cam, camDir };
  return R;
}

const medCache = new WeakMap();               // texture image -> [r,g,b]
function medianColor(img) {
  if (!img) return null;
  if (medCache.has(img)) return medCache.get(img);
  const cv = document.createElement("canvas");
  const s = Math.min(1, 128 / Math.max(img.width, img.height));
  cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, cv.width, cv.height);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const ch = [[], [], []];
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] < 200) continue;
    if (d[p] + d[p + 1] + d[p + 2] < 12) continue;     // atlas gutters
    ch[0].push(d[p]); ch[1].push(d[p + 1]); ch[2].push(d[p + 2]);
  }
  const med = a => a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 128;
  const c = ch.map(med);
  medCache.set(img, c);
  return c;
}

async function render3d(avatar) {
  const { THREE, A, renderer, scene, cam, camDir } = await rig();
  const cfg = A.normalizeAvatar3(avatar);
  // the rigged body brings a walk cycle; the static body is the fallback
  let ch = null, anim = false;
  try { ch = await withTimeout(A.makeAnimatedCharacter(cfg), 15000); anim = !!ch.pose; }
  catch (e) { console.warn("[charsprite] no walk rig, standing pose only", e); }
  if (!ch) ch = await A.makeHumanCharacter(cfg);
  await withTimeout(ch.ready ?? Promise.resolve(), 15000).catch(() => {});

  const skin = A.SKIN_RGB?.[cfg.skin] ?? FALLBACK_SKIN[1];
  const hair = A.HAIR_RGB?.[cfg.hairColor] ?? FALLBACK_HAIR.black;
  const iris = hexRgb(A.IRIS3_HEX?.[cfg.iris]) ?? EYE;
  const palette = [skin, EYE, WHITE];
  const col = rgb => new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  const swaps = [], faces = [];
  ch.group.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const part = o.userData.part ?? "body";
    if (part === "face") { faces.push(o); o.visible = false; return; }   // eyes are painted
    const rgb = part === "body" ? skin : part === "hair" ? hair : (medianColor(o.material.map?.image) ?? [128, 128, 128]);
    palette.push(rgb);
    const mat = new THREE.MeshBasicMaterial({ color: col(rgb), side: THREE.DoubleSide });
    // clothes and hair sit a hair's breadth off the skin: pull them in front
    // so the body never speckles through (units are depth-buffer steps)
    if (part !== "body") Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -40000 });
    swaps.push(mat);
    o.material = mat;
  });

  scene.add(ch.group);
  const sheet = document.createElement("canvas");
  sheet.width = W * COLS; sheet.height = H * FACINGS.length;
  const sg = sheet.getContext("2d");
  const yaw = { down: 0, left: -Math.PI / 2, up: Math.PI };
  const walkT = anim ? ch.clipLength("walk") : 0;
  try {
    FACINGS.forEach((f, row) => {
      ch.group.rotation.y = yaw[f];
      for (let c = 0; c < COLS; c++) {
        if (anim) ch.pose(c === 0 ? "idle" : "walk", c === 0 ? 0 : (c - 1) / 4 * walkT);
        ch.group.updateMatrixWorld(true);
        renderer.render(scene, cam);
        const fr = flatten(renderer.domElement, palette);
        if (f !== "up") paintEyes(fr, faces, cam, camDir, iris, THREE);
        sg.drawImage(fr, c * W, row * H);
      }
    });
  } finally {
    scene.remove(ch.group);
    ch.dispose?.();
    for (const m of swaps) m.dispose();
  }
  return { url: sheet.toDataURL(), anim, fallback: false };
}

const hexRgb = h => /^#[0-9a-f]{6}$/i.test(h ?? "") ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// ---------------------------------------------------------------- flatten
// Every rendered pixel snaps to the palette; each SSxSS block becomes one
// sprite pixel (solid if half the block is, in its most common color).
// Then stray specks go, and the silhouette gets its shaded outline.
function flatten(src, palette = null) {
  const sw = src.width, k = Math.max(1, Math.round(sw / W));
  const big = document.createElement("canvas");
  big.width = sw; big.height = src.height;
  const bg = big.getContext("2d", { willReadFrequently: true });
  bg.imageSmoothingEnabled = false;
  bg.drawImage(src, 0, 0);
  const sd = bg.getImageData(0, 0, sw, src.height).data;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  const im = g.createImageData(W, H), d = im.data;
  const solid = new Uint8Array(W * H);
  const snap = p => {
    let best = 0, bd = Infinity;
    for (let j = 0; j < palette.length; j++) {
      const c = palette[j];
      const e = (sd[p] - c[0]) ** 2 * 0.3 + (sd[p + 1] - c[1]) ** 2 * 0.59 + (sd[p + 2] - c[2]) ** 2 * 0.11;
      if (e < bd) { bd = e; best = j; }
    }
    return best;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const votes = new Map(); let n = 0, lastP = 0;
    for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) {
      const p = ((y * k + yy) * sw + (x * k + xx)) * 4;
      if (sd[p + 3] < 128) continue;
      n++; lastP = p;
      if (palette) { const c = snap(p); votes.set(c, (votes.get(c) ?? 0) + 1); }
    }
    if (n * 2 < k * k) continue;
    const i = y * W + x, q = i * 4;
    solid[i] = 1; d[q + 3] = 255;
    if (!palette) { d[q] = sd[lastP]; d[q + 1] = sd[lastP + 1]; d[q + 2] = sd[lastP + 2]; continue; }
    let best = 0, bv = -1;
    for (const [c, v] of votes) if (v > bv) { bv = v; best = c; }
    const c = palette[best];
    d[q] = c[0]; d[q + 1] = c[1]; d[q + 2] = c[2];
  }
  if (palette) despeckle(d, solid);
  outline(d, solid);
  g.putImageData(im, 0, 0);
  return cv;
}

// a deep shade of the color it borders: darker and a little bluer, so the
// outline reads as part of each area instead of a black cartoon line
const shade = c => [Math.round(c[0] * 0.42), Math.round(c[1] * 0.42), Math.round(c[2] * 0.5 + 14)];
function outline(d, solid) {
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (solid[i]) continue;
    // prefer the neighbor below, then the sides, then above
    const n = [y < H - 1 && i + W, x > 0 && i - 1, x < W - 1 && i + 1, y > 0 && i - W].find(j => j !== false && solid[j]);
    if (n === undefined) continue;
    out.push([i, shade([d[n * 4], d[n * 4 + 1], d[n * 4 + 2]])]);
  }
  for (const [i, c] of out) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
}

// stray 1-2 pixel specks (skin through a garment seam, scalp between hair
// spikes) take the most common color around them
function despeckle(d, solid) {
  const key = i => (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!solid[i]) continue;
      const counts = new Map(); let same = 0, open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = i + dy * W + dx;
        if (!solid[j]) { open++; continue; }
        if (key(j) === key(i)) same++;
        else counts.set(key(j), (counts.get(key(j)) ?? 0) + 1);
      }
      if (same > 2 || open > 2) continue;     // a real shape, or the silhouette edge
      let best = null, bv = 0;
      for (const [kk, v] of counts) if (v > bv) { bv = v; best = kk; }
      if (best !== null && bv >= 4) out.push([i, best]);
    }
    for (const [i, kk] of out) { d[i * 4] = kk >> 16; d[i * 4 + 1] = (kk >> 8) & 255; d[i * 4 + 2] = kk & 255; }
  }
}

// Eyes are painted, not sampled: at this size a face decal's eyes are a
// pixel or less. Each eye facing the camera gets a 2x3 block at its
// projected spot (lash row, iris, white highlight), only on the face.
function paintEyes(cv, faces, cam, camDir, iris, THREE) {
  const g = cv.getContext("2d", { willReadFrequently: true });
  const v = new THREE.Vector3(), ctr = new THREE.Vector3(), n = new THREE.Vector3();
  const im = g.getImageData(0, 0, W, H).data;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && im[(y * W + x) * 4 + 3] === 255 && !edge(im, x, y);
  for (const mesh of faces) {
    const r = mesh.geometry?.parameters?.radius;
    if (!r) continue;
    mesh.updateMatrixWorld(true);
    ctr.set(0, 0, 0).applyMatrix4(mesh.matrixWorld);
    for (const side of [-1, 1]) {
      const ex = 0.3 * side, ey = -0.05;
      v.set(ex * r, ey * r, Math.sqrt(1 - ex * ex - ey * ey) * r).applyMatrix4(mesh.matrixWorld);
      n.copy(v).sub(ctr).normalize();
      if (n.dot(camDir) < 0.45) continue;      // turned away
      v.project(cam);
      const x = Math.round((v.x + 1) / 2 * W) - 1, y = Math.round((1 - v.y) / 2 * H) - 1;
      if (![[x, y], [x + 1, y], [x, y + 2], [x + 1, y + 2]].every(([a, b]) => inside(a, b))) continue;
      eye(g, x, y, iris, side);
    }
  }
}
// the outline ring: solid pixels that touch transparency
function edge(im, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H || im[(yy * W + xx) * 4 + 3] === 0) return true;
  }
  return false;
}
function eye(g, x, y, iris, side) {
  const px = (c, xx, yy) => { g.fillStyle = `rgb(${c})`; g.fillRect(xx, yy, 1, 1); };
  for (const xx of [x, x + 1]) { px(EYE, xx, y); px(iris, xx, y + 1); px(iris, xx, y + 2); }
  px(WHITE, side < 0 ? x + 1 : x, y + 1);
}

// ---------------------------------------------------------------- fallback
// A little pixel figure in the player's own colors — never a letter. Big
// head, 3/4 view, the same facings and a two-step walk.
function figure(avatar, facing, col) {
  const skin = FALLBACK_SKIN[avatar?.skin] ?? FALLBACK_SKIN[1];
  const hair = FALLBACK_HAIR[avatar?.hairColor] ?? FALLBACK_HAIR.black;
  const iris = hexRgb(FALLBACK_IRIS[avatar?.iris]) ?? [63, 127, 209];
  const word = id => WORDS[String(id ?? "").split("-").find(w => WORDS[w])] ?? null;
  const top = word(avatar?.top) ?? [92, 108, 170], bottom = word(avatar?.bottom) ?? [60, 66, 96], shoes = word(avatar?.shoes) ?? [44, 44, 52];
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const rect = (c, x, y, w, h) => { g.fillStyle = `rgb(${c})`; g.fillRect(x, y, w, h); };
  const step = col === 0 ? 0 : (col % 2 ? 1 : -1);          // walk: legs alternate
  const bob = col === 0 ? 0 : (col % 2 ? -1 : 0);
  const y0 = 2 + bob;
  const side = facing === "left";
  // legs + shoes
  if (side) { rect(bottom, 13 - step, 27 + bob, 3, 7); rect(bottom, 16 + step, 27 + bob, 3, 7); rect(shoes, 11 - step, 34 + bob, 5, 3); rect(shoes, 15 + step, 34 + bob, 5, 3); }
  else { rect(bottom, 11, 27 + bob, 4, 7 - Math.max(0, step)); rect(bottom, 17, 27 + bob, 4, 7 - Math.max(0, -step)); rect(shoes, 10, 33 + bob - Math.max(0, step), 6, 3); rect(shoes, 16, 33 + bob - Math.max(0, -step), 6, 3); }
  // body + arms
  rect(top, 10, 19 + y0, 12, 9);
  if (side) rect(skin, 14 + step, 21 + y0, 3, 7);
  else { rect(skin, 7, 20 + y0, 3, 7); rect(skin, 22, 20 + y0, 3, 7); }
  // head (big) + hair
  rect(skin, 7, y0, 18, 18);
  if (avatar?.hair !== "none") {
    if (facing === "up") rect(hair, 6, y0 - 1, 20, 18);
    else if (side) { rect(hair, 7, y0 - 1, 18, 6); rect(hair, 15, y0 + 4, 10, 10); }
    else { rect(hair, 6, y0 - 1, 20, 6); rect(hair, 6, y0 + 4, 3, 9); rect(hair, 23, y0 + 4, 3, 9); }
  }
  if (facing === "down") { eye(g, 10, y0 + 8, iris, -1); eye(g, 20, y0 + 8, iris, 1); }
  if (side) eye(g, 8, y0 + 8, iris, -1);
  return cv;
}
