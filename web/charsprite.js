// Top-down 2D sprites of each player's own character, for the party room,
// in the classic small-RPG style: ~20x30 pixels, flat colors with one shade
// each, a pure black 1px outline, a round chunky head and big shoes.
//
// So cosmetics just work, every sprite is made from the player's real 3D
// avatar (avatar4.js), posed and rendered through the room's 3/4 camera:
//   * the head and feet bones are scaled up a little first (chunky head,
//     readable shoes)
//   * an ID pass says which part each pixel is (skin, hair, top, bottom,
//     shoes); a plain lit pass says whether it faces the light or away
//   * each 4x4 block becomes one sprite pixel: its part's flat color, or that
//     color's single shade. Skin and hair come from the avatar palette, each
//     garment is its texture's median color.
//   * stray pixels go, then the black outline goes around the silhouette
//   * the face is never sampled: the eyes (2px tall, a white highlight; no
//     mouth, like the 3D characters) are a fixed pixel overlay on the head,
//     so every face comes out clean
// Shown with nearest-neighbor scaling at whole multiples (the room's pixel
// scale), so it stays crisp.
//
// One sheet per look: rows = down, left, up (the room flips left for right),
// columns = [idle, step A, step B]; the room plays A, idle, B, idle as a
// bouncy walk. Sheets are cached per look (memory + sessionStorage) and
// rebuilt only when the look changes. If 3D can't render at all, the
// fallback is a little pixel figure in the player's own colors.
const W = 20, H = 30;                        // sprite pixels per frame
const SS = 4;                                // rendered at 4x, reduced per 4x4 block
const COLS = 3, FACINGS = ["down", "left", "up"];
const VERSION = 5;
export const SPRITE = { W, H, COLS, FACINGS };

const BLACK = [12, 10, 18], WHITE = [255, 255, 255];
const WORDS = { black: [44, 44, 52], white: [238, 240, 236], maroon: [128, 38, 56], blue: [70, 112, 196], navy: [44, 58, 104],
  khaki: [190, 166, 104], camo: [104, 118, 72], brown: [124, 88, 60], grey: [146, 150, 158], green: [84, 150, 86], pink: [240, 140, 176], tan: [196, 152, 98] };
const FALLBACK_SKIN = { 1: [238, 196, 156], 2: [205, 170, 147], 3: [192, 135, 91], 4: [155, 99, 65], 5: [89, 60, 44] };
const FALLBACK_HAIR = { black: [53, 52, 57], brown: [115, 82, 70], yellow: [225, 185, 122], red: [206, 55, 58], white: [225, 210, 200] };
// the one shade per color: darker and a touch cooler, like night light
const shadeOf = c => [Math.round(c[0] * 0.66), Math.round(c[1] * 0.64), Math.round(c[2] * 0.72 + 12)];
const PARTS = ["body", "hair", "top", "bottom", "shoes", "head", "facewear", "neck"];

const mem = new Map();                        // look key -> Promise<sheet>
const lookKey = cfg => `v${VERSION}:` + ["skin", "eyes", "hair", "hairColor", "head", "face", "top", "bottom", "shoes", "neck"].map(k => cfg?.[k] ?? "").join("|");

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
  FACINGS.forEach((f, r) => { for (let c = 0; c < COLS; c++) sg.drawImage(figure(avatar, f, c), c * W, r * H); });
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
let R = null;                                 // { THREE, A, renderer, scene, cam, light }
async function rig() {
  if (R) return R;
  const THREE = await import("https://esm.sh/three@0.160.0");
  const A = await import("./avatar4.js");
  if (!A.makeHumanCharacter) throw new Error("no avatar renderer here");
  const canvas = document.createElement("canvas");
  canvas.width = W * SS; canvas.height = H * SS;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W * SS, H * SS, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // ID colors must come out exact
  const scene = new THREE.Scene();
  // the room's 3/4 view: tilted 30 degrees down; a 1px margin all round for the outline
  const halfH = 8.7, halfW = halfH * W / H, elev = Math.PI / 6;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 120);
  const target = new THREE.Vector3(0, 7.9, 0);
  cam.position.set(0, target.y + Math.sin(elev) * 60, Math.cos(elev) * 60);
  cam.lookAt(target);
  // the lit pass: light from the upper left, in front
  const amb = new THREE.AmbientLight(0xffffff, 0.8);
  const light = new THREE.DirectionalLight(0xffffff, 3.0);
  light.position.set(-8, 14, 12);
  R = { THREE, A, renderer, scene, cam, amb, light };
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
  const { THREE, A, renderer, scene, cam, amb, light } = await rig();
  const cfg = A.normalizeAvatar(avatar);
  // the rigged body brings a walk cycle; the static body is the fallback
  let ch = null, anim = false;
  try { ch = await withTimeout(A.makeAnimatedCharacter(cfg), 15000); anim = !!ch.pose; }
  catch (e) { console.warn("[charsprite] no walk rig, standing pose only", e); }
  if (!ch) ch = await A.makeHumanCharacter(cfg);
  await withTimeout(ch.ready ?? Promise.resolve(), 15000).catch(() => {});

  // flat colors: skin + hair from the avatar palette, garments by texture
  const colors = {
    body: A.SKIN_RGB?.[cfg.skin] ?? FALLBACK_SKIN[1],
    hair: A.HAIR_RGB?.[cfg.hairColor] ?? FALLBACK_HAIR.black,
  };
  // ID colors in linear space, rendered linear: they come out exact
  const idMats = PARTS.map((p, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB((i + 1) * 28 / 255, 0, 0, THREE.LinearSRGBColorSpace), side: THREE.DoubleSide }));
  const litMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const meshes = [];
  ch.group.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const part = o.userData.part ?? "body";
    if (part === "face") { o.visible = false; return; }     // the face is drawn, not sampled
    if (!colors[part]) colors[part] = medianColor(o.material.map?.image) ?? [128, 128, 128];
    meshes.push({ o, part });
  });
  // chunky head, readable shoes
  const bones = {};
  ch.group.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const head = bones.head ?? bones.tripoHead_1 ?? bones.tripoHead_0;
  const feet = [bones.foot_L ?? bones.tripo1_Left_Limb_2, bones.foot_R ?? bones.tripo1_Right_Limb_2].filter(Boolean);
  // classic-RPG proportions: a big round head, a stockier body, big shoes
  const bigger = () => { head?.scale.setScalar(1.55); feet.forEach(f => f.scale.setScalar(1.35)); ch.group.scale.set(1.3, 0.9, 1.3); };

  scene.add(ch.group, amb, light);
  const sheet = document.createElement("canvas");
  sheet.width = W * COLS; sheet.height = H * FACINGS.length;
  const sg = sheet.getContext("2d");
  const yaw = { down: 0, left: -Math.PI / 2, up: Math.PI };
  const walkT = anim ? ch.clipLength("walk") : 0;
  const ids = new Uint8Array(W * SS * H * SS), lit = new Uint8Array(W * SS * H * SS);
  const gl = renderer.getContext();
  const px = new Uint8Array(W * SS * H * SS * 4);
  const grab = (into, fn) => {
    renderer.render(scene, cam);
    gl.readPixels(0, 0, W * SS, H * SS, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let y = 0; y < H * SS; y++) for (let x = 0; x < W * SS; x++) {
      const s = ((H * SS - 1 - y) * W * SS + x) * 4;          // GL rows are bottom-up
      into[y * W * SS + x] = fn(px, s);
    }
  };
  try {
    FACINGS.forEach((f, row) => {
      ch.group.rotation.y = yaw[f];
      for (let c = 0; c < COLS; c++) {
        if (anim) ch.pose(c === 0 ? "idle" : "walk", c === 0 ? 0 : (c === 1 ? 0.15 : 0.65) * walkT);
        bigger();
        ch.group.updateMatrixWorld(true);
        meshes.forEach(m => { m.o.material = idMats[PARTS.indexOf(m.part)] ?? idMats[0]; });
        grab(ids, (d, s) => d[s + 3] < 128 ? 0 : Math.round(d[s] / 28));
        meshes.forEach(m => { m.o.material = litMat; });
        grab(lit, (d, s) => d[s]);
        const headAt = head ? project(head, cam, THREE) : null;
        const fr = flatten(ids, lit, colors, headAt, f);
        // walking frames sit a pixel higher: the bounce
        sg.drawImage(fr, c * W, row * H - (c ? 1 : 0));
      }
    });
  } finally {
    ch.group.scale.set(1, 1, 1);
    scene.remove(ch.group, amb, light);
    ch.dispose?.();
    idMats.forEach(m => m.dispose()); litMat.dispose();
  }
  return { url: sheet.toDataURL(), anim, fallback: false };
}

// a bone's position in sprite pixels
function project(bone, cam, THREE) {
  const v = new THREE.Vector3();
  bone.getWorldPosition(v);
  v.project(cam);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// ---------------------------------------------------------------- flatten
// ids: part per render pixel (0 = empty, 1.. = PARTS), lit: brightness.
// Each SSxSS block -> one sprite pixel: the most common part (if at least
// half the block is filled), shaded if most of that part's pixels are dark.
function flatten(ids, lit, colors, headAt, facing) {
  const RW = W * SS;
  const part = new Uint8Array(W * H), dark = new Uint8Array(W * H);
  // "dark" = clearly darker than that part's typical brightness (so one
  // shade per color, wherever the light falls on it)
  const hist = PARTS.map(() => []);
  for (let i = 0; i < ids.length; i++) if (ids[i]) hist[ids[i] - 1].push(lit[i]);
  const cut = hist.map(h => { if (!h.length) return 0; h.sort((a, b) => a - b); return h[Math.floor(h.length * 0.6)] * 0.78; });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const votes = new Array(PARTS.length + 1).fill(0), darks = new Array(PARTS.length + 1).fill(0);
    for (let yy = 0; yy < SS; yy++) for (let xx = 0; xx < SS; xx++) {
      const i = (y * SS + yy) * RW + x * SS + xx, p = ids[i];
      votes[p]++; if (p && lit[i] < cut[p - 1]) darks[p]++;
    }
    if (votes[0] * 2 > SS * SS) continue;
    let best = 1; for (let p = 2; p <= PARTS.length; p++) if (votes[p] > votes[best]) best = p;
    part[y * W + x] = best;
    dark[y * W + x] = darks[best] * 2 > votes[best] ? 1 : 0;
  }
  despeckle(part, dark);
  smoothShade(part, dark);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const im = g.createImageData(W, H), d = im.data;
  const put = (i, c) => { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; };
  for (let i = 0; i < W * H; i++) {
    if (!part[i]) continue;
    const base = colors[PARTS[part[i] - 1]] ?? [128, 128, 128];
    put(i, dark[i] ? shadeOf(base) : base);
  }
  // the black outline, all the way round
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (part[i]) continue;
    if ((x > 0 && part[i - 1]) || (x < W - 1 && part[i + 1]) || (y > 0 && part[i - W]) || (y < H - 1 && part[i + W])) put(i, BLACK);
  }
  if (facing !== "up") face(put, part, colors, dark, facing);
  g.putImageData(im, 0, 0);
  return cv;
}

// lone pixels of another part (or of shade) take their neighbors' value
function despeckle(part, dark) {
  for (let pass = 0; pass < 2; pass++) {
    const fixP = [], fixD = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!part[i]) continue;
      const nb = [i - 1, i + 1, i - W, i + W].filter(j => part[j]);
      const same = nb.filter(j => part[j] === part[i]).length;
      if (same === 0 && nb.length >= 3) {
        const counts = new Map(); for (const j of nb) counts.set(part[j], (counts.get(part[j]) ?? 0) + 1);
        fixP.push([i, [...counts].sort((a, b) => b[1] - a[1])[0][0]]);
      }
      const sameD = nb.filter(j => part[j] === part[i] && dark[j] === dark[i]).length;
      if (sameD === 0 && nb.filter(j => part[j] === part[i]).length >= 2) fixD.push(i);
    }
    for (const [i, p] of fixP) part[i] = p;
    for (const i of fixD) dark[i] ^= 1;
  }
}

// shade in blobs, not freckles: each pixel takes the majority shade of the
// same-part pixels around it
function smoothShade(part, dark) {
  const next = dark.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!part[i]) continue;
    let n = 0, d = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx; if (part[j] !== part[i]) continue;
      n++; d += dark[j];
    }
    next[i] = d * 2 > n ? 1 : d * 2 < n ? 0 : dark[i];
  }
  dark.set(next);
}

// the face overlay, the same on everyone: a clean patch of skin where the
// face is (bangs never hide it), two eyes 2px tall with a white highlight,
// and no mouth (the characters have none). One eye in profile; nothing from behind. The head is
// found from the sprite's own silhouette (its top rows).
function face(put, part, colors, dark, facing) {
  const SKIN = 1;
  let top = -1;
  for (let y = 0; y < H && top < 0; y++) for (let x = 0; x < W; x++) if (part[y * W + x]) { top = y; break; }
  if (top < 0) return;
  let sx = 0, n = 0;
  for (let y = top; y < Math.min(H, top + 9); y++) for (let x = 0; x < W; x++) if (part[y * W + x]) { sx += x; n++; }
  const cx = Math.round(sx / n), ey = top + 6;
  const skin = colors.body;
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && part[y * W + x];
  const fill = (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solid(x, y) && solid(x - 1, y) && solid(x + 1, y)) { part[y * W + x] = SKIN; put(y * W + x, skin); } };
  if (facing === "down") {
    fill(cx - 3, cx + 2, ey - 1, ey + 3);
    for (const x of [cx - 3, cx + 1]) { put(ey * W + x, WHITE); put(ey * W + x + 1, BLACK); put((ey + 1) * W + x, BLACK); put((ey + 1) * W + x + 1, BLACK); }
  } else if (facing === "left") {
    fill(cx - 4, cx - 1, ey - 1, ey + 3);
    put(ey * W + cx - 3, WHITE); put((ey + 1) * W + cx - 3, BLACK); put(ey * W + cx - 2, BLACK); put((ey + 1) * W + cx - 2, BLACK);
  }
}

// ---------------------------------------------------------------- fallback
// A little pixel figure in the player's own colors, the same style: round
// head, simple body, big shoes, black outline, painted eyes.
function figure(avatar, facing, col) {
  const skin = FALLBACK_SKIN[avatar?.skin] ?? FALLBACK_SKIN[1];
  const hair = FALLBACK_HAIR[avatar?.hairColor] ?? FALLBACK_HAIR.black;
  const word = id => WORDS[String(id ?? "").split("-").find(w => WORDS[w])] ?? null;
  const top = word(avatar?.top) ?? [92, 108, 170], bottom = word(avatar?.bottom) ?? [60, 66, 96], shoes = word(avatar?.shoes) ?? [44, 44, 52];
  const part = new Uint8Array(W * H), dark = new Uint8Array(W * H);
  const rect = (p, x, y, w, h, sh = 0) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) { part[yy * W + xx] = p; dark[yy * W + xx] = sh; } };
  const step = col === 0 ? 0 : (col === 1 ? 1 : -1), bob = col ? -1 : 0, side = facing === "left";
  const y0 = 2 + bob;
  // legs + big shoes
  if (side) { rect(4, 8 - step, 21 + bob, 2, 4); rect(4, 10 + step, 21 + bob, 2, 4, 1); rect(5, 6 - step, 25 + bob, 5, 3); rect(5, 9 + step, 25 + bob, 5, 3, 1); }
  else { rect(4, 6, 21 + bob, 3, 4 - Math.max(0, step)); rect(4, 11, 21 + bob, 3, 4 - Math.max(0, -step), 1); rect(5, 5, 25 + bob - Math.max(0, step), 5, 3); rect(5, 10, 25 + bob - Math.max(0, -step), 5, 3, 1); }
  // body + arms
  rect(3, 6, 14 + y0, 8, 7); rect(3, 6, 18 + y0, 8, 3, 1);
  if (!side) { rect(1, 4, 15 + y0, 2, 5); rect(1, 14, 15 + y0, 2, 5, 1); } else rect(1, 9 + step, 15 + y0, 2, 5);
  // round head
  rect(1, 4, y0 + 1, 12, 11); rect(1, 5, y0, 10, 13); rect(1, 4, y0 + 9, 12, 3, 1);
  if (avatar?.hair !== "none") {
    if (facing === "up") { rect(2, 4, y0, 12, 11); rect(2, 5, y0 - 1, 10, 13); }
    else if (side) { rect(2, 5, y0 - 1, 11, 4); rect(2, 11, y0 + 3, 5, 6, 1); }
    else { rect(2, 5, y0 - 1, 10, 4); rect(2, 4, y0 + 1, 2, 6, 1); rect(2, 14, y0 + 1, 2, 6, 1); }
  }
  const colors = { body: skin, hair, top, bottom, shoes };
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const im = g.createImageData(W, H), d = im.data;
  const put = (i, c) => { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; };
  for (let i = 0; i < W * H; i++) if (part[i]) { const b = colors[PARTS[part[i] - 1]]; put(i, dark[i] ? shadeOf(b) : b); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!part[i] && ((x > 0 && part[i - 1]) || (x < W - 1 && part[i + 1]) || (y > 0 && part[i - W]) || (y < H - 1 && part[i + W]))) put(i, BLACK);
  }
  if (facing !== "up") face(put, part, colors, dark, facing);
  g.putImageData(im, 0, 0);
  return cv;
}
