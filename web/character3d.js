// Rando modular character, v2 — matches the organized reference set in
// "rando avatar v2": 10 body colors, 6 eye styles (2 with a colorable
// iris), 8 head shapes, mouthless face. Bodies are single-tint; eyes are
// canvas-drawn decals so linework styles (spiral, hollow, lines) render
// exactly. API (makeCharacter -> { group, config, setConfig, tick }) is
// the contract a future rigged GLB base can implement as a drop-in swap.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "https://esm.sh/three@0.160.0/examples/jsm/utils/SkeletonUtils.js";
import { THEME } from "./theme.js";

export const BODY_HEX = THEME.body; // muted palette lives in theme.js
export const IRIS_HEX = { // muted family, matching the reference eyes
  blue: "#5b7ca6", black: "#262a30", grey: "#9aa3ae", brown: "#8a6a52",
  red:  "#b06258", orange: "#c98d5e", green: "#6f9e85",
};
// eye styles with a distinct iris shape to tint; linework styles are not
export const IRIS_CAPABLE = ["default", "anime"];

export const PART_OPTIONS = {
  body: Object.keys(BODY_HEX),
  eyes: ["default", "anime", "hollowoval", "lineblush", "sleepy", "spiral"],
  iris: Object.keys(IRIS_HEX),
  head: ["none", "teardrop", "catears", "devilhorns", "floppyears", "twinhorns", "smallspikes", "notailspike"],
};

export const DEFAULT_AVATAR = { body: "white", eyes: "default", iris: "black", head: "none" };

export function normalizeAvatar(raw) {
  const cfg = { ...DEFAULT_AVATAR };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_AVATAR)) {
      if (PART_OPTIONS[k].includes(raw[k])) cfg[k] = raw[k];
    }
  }
  return cfg;
}

const DARK = "#2b2f36";

function sphere(r, mat, sx = 1, sy = 1, sz = 1, seg = 20) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), mat);
  m.scale.set(sx, sy, sz);
  return m;
}
function cone(r, h, mat, seg = 10) {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
}

// teardrop via lathe: pointed tip at y=0, round bulge above — the v2 set's
// arm/ear silhouette. profile bulge/height tweakable per use.
function teardrop(mat, bulge = 1, height = 3.2) {
  const pts = [];
  const P = [[0.02, 0], [0.42, 0.35], [0.78, 0.95], [0.97, 1.75], [0.88, 2.45], [0.5, 2.95], [0.02, 3.2]];
  for (const [x, y] of P) pts.push(new THREE.Vector2(x * bulge, y * (height / 3.2)));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 14), mat);
}

// head: wider than tall, flattened face, tapered chin (vertex-sculpted)
function headGeometry() {
  const geo = new THREE.SphereGeometry(5.2, 30, 24);
  const pos = geo.attributes.position;
  const r = 5.2;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // gently flatten the face front
    if (z > r * 0.62) z = r * 0.62 + (z - r * 0.62) * 0.55;
    // mild chin taper
    if (y < 0) {
      const t = -y / r;
      x *= 1 - 0.12 * t;
      z *= 1 - 0.06 * t;
    }
    x *= 1.06;   // a touch wider than tall
    y *= 0.98;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// spherical face patch so eye decals curve WITH the head
function eyePatch(tex, side) {
  const geo = new THREE.SphereGeometry(5.26, 16, 16,
    Math.PI / 2 - 0.23, 0.46,   // phi: patch centered on +Z
    Math.PI * 0.355, Math.PI * 0.23);
  const mesh = new THREE.Mesh(geo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, side: THREE.FrontSide }));
  mesh.rotation.y = side * 0.34;
  mesh.scale.set(1.06, 0.98, 1); // follow the head sculpt
  return mesh;
}

// ---------- eye decal drawing (256x256 canvas per eye) ----------
function eyeTexture(style, irisHex, side) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const cx = 128, cy = 118;
  const el = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };

  if (style === "default") {
    // reference look: slim dark rim, iris fills the eye, soft small catch
    el(cx, cy, 62, 92); g.fillStyle = DARK; g.fill();
    el(cx, cy + 2, 54, 82); g.fillStyle = irisHex; g.fill();
    el(cx, cy + 12, 30, 48); g.fillStyle = "#15181d"; g.fill();
    el(cx - 18, cy - 34, 11, 15); g.fillStyle = "rgba(255,255,255,0.75)"; g.fill();
  } else if (style === "anime") {
    el(cx, cy, 66, 96); g.fillStyle = DARK; g.fill();
    const grad = g.createLinearGradient(0, cy - 80, 0, cy + 88);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.28, irisHex);
    grad.addColorStop(1, "#0c0e12");
    el(cx, cy + 3, 54, 84); g.fillStyle = grad; g.fill();
    el(cx - 22, cy - 44, 17, 24); g.fillStyle = "rgba(255,255,255,0.95)"; g.fill();
    el(cx + 22, cy + 44, 9, 12); g.fillStyle = "rgba(255,255,255,0.55)"; g.fill();
  } else if (style === "hollowoval") {
    // reference: one slim dark outline, faint halo only for dark bodies
    el(cx, cy, 52, 80); g.lineWidth = 22; g.strokeStyle = "rgba(255,255,255,0.4)"; g.stroke();
    el(cx, cy, 52, 80); g.lineWidth = 14; g.strokeStyle = DARK; g.stroke();
  } else if (style === "lineblush") {
    g.lineCap = "round";
    g.lineWidth = 22; g.strokeStyle = "rgba(255,255,255,0.5)";
    g.beginPath(); g.moveTo(cx - 44, cy - 8); g.lineTo(cx + 44, cy - 8); g.stroke();
    g.lineWidth = 13; g.strokeStyle = DARK;
    g.beginPath(); g.moveTo(cx - 44, cy - 8); g.lineTo(cx + 44, cy - 8); g.stroke();
    // blush on the outer cheek (mirrored per side)
    el(cx + side * 44, cy + 84, 36, 20);
    g.fillStyle = "rgba(240,150,165,0.8)"; g.fill();
  } else if (style === "sleepy") {
    g.lineCap = "round";
    g.lineWidth = 34; g.strokeStyle = "rgba(255,255,255,0.85)";
    g.beginPath(); g.arc(cx, cy - 34, 58, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.lineWidth = 22; g.strokeStyle = DARK;
    g.beginPath(); g.arc(cx, cy - 34, 58, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
  } else if (style === "spiral") {
    // reference: bare dark spiral on the body color, no white fill
    g.lineWidth = 9; g.strokeStyle = "rgba(255,255,255,0.35)";
    el(cx, cy, 56, 84); g.stroke();
    g.lineWidth = 8; g.strokeStyle = DARK;
    for (const s of [1, 0.66, 0.38, 0.14]) {
      el(cx, cy, 56 * s, 84 * s); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// head shapes as an attachable group in head-center space (head radius
// 5.2): shared by the procedural character and the GLB hybrid overlay
function buildHeadParts(H, mat) {
  const g = new THREE.Group();
  if (H === "teardrop") {
    // reference: soft rounded drop rising from the crown
    const p = teardrop(mat, 1.55, 4.6);
    p.position.set(0, 4.4, -0.2);
    g.add(p);
  } else if (H === "catears") {
    // reference: wide rounded ears set low on the head sides
    for (const s of [-1, 1]) {
      const e = cone(1.7, 3.3, mat, 14);
      e.position.set(s * 2.7, 4.6, 0);
      e.rotation.z = -s * 0.3;
      g.add(e);
    }
  } else if (H === "devilhorns") {
    for (const s of [-1, 1]) {
      const h = cone(1.0, 2.8, mat);
      h.position.set(s * 2.7, 4.6, 0);
      h.rotation.z = -s * 0.55;
      g.add(h);
    }
  } else if (H === "floppyears") {
    // reference bunny: thick long lobes draping from the top sides
    for (const s of [-1, 1]) {
      const e = teardrop(mat, 1.7, 8.2);
      e.position.set(s * 4.6, -1.6, -0.4);
      e.rotation.z = s * 0.85;
      g.add(e);
    }
  } else if (H === "twinhorns") {
    // reference: two solid horns angled outward from the crown
    for (const s of [-1, 1]) {
      const h = cone(1.0, 3.2, mat);
      h.position.set(s * 2.0, 4.9, 0);
      h.rotation.z = -s * 0.5;
      g.add(h);
    }
  } else if (H === "smallspikes") {
    for (const s of [-1, 1]) {
      const sp = cone(0.7, 1.8, mat);
      sp.position.set(s * 1.9, 5.15, 0);
      sp.rotation.z = -s * 0.22;
      g.add(sp);
    }
  } else if (H === "notailspike") {
    const center = cone(1.15, 4.3, mat);
    center.position.set(0, 5.9, -0.2);
    center.rotation.x = -0.12;
    g.add(center);
    for (const s of [-1, 1]) {
      const sp = cone(0.85, 2.5, mat);
      sp.position.set(s * 2.7, 4.7, 0);
      sp.rotation.z = -s * 0.45;
      g.add(sp);
    }
  }
  return g;
}

export function makeCharacter(rawCfg) {
  const group = new THREE.Group();
  const refs = {};
  let cfg = normalizeAvatar(rawCfg);

  function build() {
    group.clear();
    const bodyHex = BODY_HEX[cfg.body];
    const mat = new THREE.MeshLambertMaterial({ color: bodyHex });

    // egg body: slightly wider low, narrower at the neck
    const body = sphere(3.15, mat, 1, 1.12, 0.95);
    const bpos = body.geometry.attributes.position;
    for (let i = 0; i < bpos.count; i++) {
      const y = bpos.getY(i);
      const w = 1 + 0.16 * Math.max(0, -y / 3.15);
      bpos.setX(i, bpos.getX(i) * w);
      bpos.setZ(i, bpos.getZ(i) * w);
    }
    body.geometry.computeVertexNormals();
    body.position.y = 3.9;
    group.add(body);

    // rounded-wedge feet: long, flat, slight toe
    refs.feet = [];
    for (const s of [-1, 1]) {
      const foot = sphere(1.5, mat, 1.05, 0.52, 1.6);
      const fpos = foot.geometry.attributes.position;
      for (let i = 0; i < fpos.count; i++) {
        const z = fpos.getZ(i);
        if (z > 0) fpos.setY(i, fpos.getY(i) * (1 - 0.28 * (z / 1.5))); // toe slims
      }
      foot.geometry.computeVertexNormals();
      foot.position.set(s * 1.75, 0.8, 0.8);
      group.add(foot);
      refs.feet.push(foot);
    }

    // hanging teardrop arms, pointed tips down, pivot at the shoulder
    refs.arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 3.0, 6.1, 0);
      const arm = teardrop(mat, 0.95, 3.4);
      arm.position.y = -3.5; // lathe tip at pivot-3.5, bulge up toward shoulder
      pivot.add(arm);
      pivot.rotation.z = s * 0.24;
      group.add(pivot);
      refs.arms.push(pivot);
    }

    // head (mouthless, per the v2 set): sculpted wide/flat-faced/chin-tapered
    const headG = new THREE.Group();
    headG.position.y = 10.3;
    refs.head = headG;
    headG.add(new THREE.Mesh(headGeometry(), mat));

    // eyes: canvas decals on spherical patches that curve with the face
    const irisHex = IRIS_HEX[cfg.iris];
    for (const s of [-1, 1]) {
      headG.add(eyePatch(eyeTexture(cfg.eyes, irisHex, s), s));
    }

    // head shapes (all tinted the body color, like the reference sheets)
    headG.add(buildHeadParts(cfg.head, mat));
    group.add(headG);
  }

  build();

  const api = {
    group,
    get config() { return { ...cfg }; },
    setConfig(next) {
      cfg = normalizeAvatar({ ...cfg, ...next });
      build();
    },
    walking: false,
    phase: Math.random() * Math.PI * 2,
    tick(t) {
      const p = t * (this.walking ? 9 : 2) + this.phase;
      const s = Math.sin(p);
      if (this.walking) {
        group.position.y = Math.abs(Math.sin(p)) * 0.55;
        group.rotation.z = Math.sin(p) * 0.07;
        refs.arms[0].rotation.x = s * 0.7;
        refs.arms[1].rotation.x = -s * 0.7;
        refs.feet[0].position.y = 0.85 + Math.max(0, s) * 0.7;
        refs.feet[1].position.y = 0.85 + Math.max(0, -s) * 0.7;
      } else {
        group.position.y = s * 0.16;
        group.rotation.z = 0;
        refs.arms[0].rotation.x = s * 0.06;
        refs.arms[1].rotation.x = -s * 0.06;
        refs.feet[0].position.y = 0.85;
        refs.feet[1].position.y = 0.85;
        refs.head.rotation.z = Math.sin(p * 0.7) * 0.03;
      }
    },
  };
  return api;
}

// dev harness: render configs at front/3-quarter/side angles into one
// JPEG sheet (data URL) so shapes can be reviewed against the references
export function characterSheet(cfgs, cell = 200) {
  const angles = [0, 0.7, Math.PI / 2];
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(cell, cell);
  const out = document.createElement("canvas");
  out.width = cell * angles.length;
  out.height = cell * cfgs.length;
  const g2 = out.getContext("2d");
  g2.fillStyle = "#a9a9a9";
  g2.fillRect(0, 0, out.width, out.height);
  cfgs.forEach((cfg, row) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa9a9a9);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x999999, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(40, 60, 50);
    scene.add(sun);
    const ch = makeCharacter(cfg);
    scene.add(ch.group);
    angles.forEach((a, col) => {
      ch.group.rotation.y = -a;
      const cam = new THREE.PerspectiveCamera(32, 1, 1, 300);
      cam.position.set(0, 9.5, 34);
      cam.lookAt(0, 8.2, 0);
      r.render(scene, cam);
      g2.drawImage(r.domElement, col * cell, row * cell, cell, cell);
    });
  });
  r.dispose();
  return out.toDataURL("image/jpeg", 0.78);
}

// ---- GLB path (?glb=1): the rigged + animated Tripo model in place of
// the procedural body. animations.glb carries 12 unnamed clips; indices
// identified by motion fingerprinting (foot alternation / yaw / travel).
// Tint = material color multiplied over the baked near-white texture.
// idle #11: measured steadiest of the idle-like clips (yaw wobble 4-6°,
// head height constant). #8 turns while looking around, #2 crouches into
// a ball mid-clip — both fought app-controlled facing / read as "looking
// at the ground".
const GLB_CLIPS = { walk: 3, run: 9, idle: 11, spin: 0, hop: 1, wave: 7 };
let glbTemplate = null;
let glbResolved = null;   // resolved template for the sync path
const depth = n => { let d = 0; while (n.parent) { d++; n = n.parent; } return d; };
export function loadGLBTemplate(url = "models/animations.glb") {
  if (!glbTemplate) {
    glbTemplate = new GLTFLoader().loadAsync(url).then(g => {
      const src = g.scene;
      // Tripo exports identity bone transforms (rest pose lives only in the
      // inverse-bind matrices) — rebuild each bone's local TRS from them so
      // the model stands upright and joints pivot at their true positions.
      src.updateWorldMatrix(true, true);
      src.traverse(o => {
        if (!o.isSkinnedMesh) return;
        const skel = o.skeleton;
        const bindWorld = skel.boneInverses.map(m => m.clone().invert());
        const order = [...skel.bones.keys()].sort((a, b) => depth(skel.bones[a]) - depth(skel.bones[b]));
        for (const i of order) {
          const b = skel.bones[i];
          b.parent.updateWorldMatrix(true, false);
          new THREE.Matrix4().copy(b.parent.matrixWorld).invert()
            .multiply(bindWorld[i])
            .decompose(b.position, b.quaternion, b.scale);
          b.updateMatrixWorld(true);
        }
      });
      // facing belongs to the app, not the clips: several clips yaw the
      // Root bone while "looking around", which spun characters to random
      // headings (each clone starts at a random clip time). Strip Root's
      // rotation track; limbs/spine/head animation is untouched.
      for (const clip of g.animations) {
        clip.tracks = clip.tracks.filter(t => !/(^|[./])Root\.quaternion$/.test(t.name));
      }
      // normalization lives on an unnamed wrapper the clips can't target
      const fit = new THREE.Group();
      fit.add(src);
      fit.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(fit);
      const size = new THREE.Vector3();
      box.getSize(size);
      fit.scale.setScalar(15 / size.y); // normalize to CHAR_H
      fit.updateWorldMatrix(true, true);
      const box2 = new THREE.Box3().setFromObject(fit);
      fit.position.y -= box2.min.y;     // feet on the ground
      fit.position.x -= (box2.min.x + box2.max.x) / 2;
      fit.position.z -= (box2.min.z + box2.max.z) / 2;
      const holder = new THREE.Group();
      holder.add(fit);
      const face = analyzeFace(holder, src);
      glbResolved = { holder, clips: g.animations, face };
      return glbResolved;
    });
  }
  return glbTemplate;
}

// Hybrid customization prep: find the baked eyes (mesh vertices whose UVs
// sample dark texture pixels on the face front), erase them from the
// texture, and measure the head so decal eyes + head parts can attach to
// the Head bone in its local space.
function analyzeFace(holder, src) {
  let sm = null;
  src.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  const head = src.getObjectByName("Head");
  if (!sm || !head || !sm.material.map?.image) return null;
  const img = sm.material.map.image;
  // work at 2048 max: full 4096 canvases + pixel reads blow phone-browser
  // memory limits (the "app crashes on mobile" class of failure)
  const cv = document.createElement("canvas");
  const scale = Math.min(1, 2048 / img.width);
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const pos = sm.geometry.attributes.position;
  const uv = sm.geometry.attributes.uv;
  // glTF textures use flipY=false: v maps straight to pixel rows
  const lumAt = (u, v) => {
    const x = Math.min(cv.width - 1, Math.max(0, Math.round(u * cv.width)));
    const y = Math.min(cv.height - 1, Math.max(0, Math.round(v * cv.height)));
    const i = (y * cv.width + x) * 4;
    return (px[i] + px[i + 1] + px[i + 2]) / 3;
  };
  const geoBox = new THREE.Box3().setFromBufferAttribute(pos);
  const height = geoBox.max.y - geoBox.min.y;
  const sides = { [-1]: [], 1: [] };
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) < 0) continue;              // face front only
    if (pos.getY(i) < geoBox.min.y + height * 0.45) continue;
    if (lumAt(uv.getX(i), uv.getY(i)) > 95) continue;
    sides[pos.getX(i) < 0 ? -1 : 1].push(i);
  }
  if (!sides[-1].length || !sides[1].length) return null;
  // head sphere via least-squares fit on the crown only (top 28% — below
  // that the chibi shoulders/arms pollute the fit and shrink the radius)
  const v = new THREE.Vector3();
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const B = [0, 0, 0, 0];
  const yCap = geoBox.min.y + height * 0.72;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < yCap) continue;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const row = [2 * x, 2 * y, 2 * z, 1];
    const rhs = x * x + y * y + z * z;
    for (let r = 0; r < 4; r++) {
      for (let cc = 0; cc < 4; cc++) A[r][cc] += row[r] * row[cc];
      B[r] += row[r] * rhs;
    }
  }
  // solve the 4x4 normal equations (Gaussian elimination, no pivning needed
  // for this well-conditioned fit)
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [B[col], B[piv]] = [B[piv], B[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let cc = col; cc < 4; cc++) A[r][cc] -= f * A[col][cc];
      B[r] -= f * B[col];
    }
  }
  const sol = B.map((b, i) => b / A[i][i]);
  const C = new THREE.Vector3(sol[0], sol[1], sol[2]);
  const R = Math.sqrt(Math.max(1e-8, sol[3] + C.lengthSq()));
  // per-eye: center, direction from head center, angular radius, UV box.
  // directions live in WORLD axes (the anchor is world-axis aligned), so
  // the 180° rig flip is accounted for automatically.
  holder.updateWorldMatrix(true, true);
  const toWorld = p => sm.localToWorld(p.clone());
  const eyes = [];
  for (const s of [-1, 1]) {
    const list = sides[s];
    const ec = new THREE.Vector3();
    const ub = { u0: 1, v0: 1, u1: 0, v1: 0 };
    for (const i of list) {
      ec.add(v.fromBufferAttribute(pos, i));
      ub.u0 = Math.min(ub.u0, uv.getX(i)); ub.u1 = Math.max(ub.u1, uv.getX(i));
      ub.v0 = Math.min(ub.v0, uv.getY(i)); ub.v1 = Math.max(ub.v1, uv.getY(i));
    }
    ec.divideScalar(list.length);
    const dirRaw = ec.clone().sub(C).normalize();
    const dir = toWorld(ec).sub(toWorld(C)).normalize();
    let ang = 0, rMax = 0;
    for (const i of list) {
      const d = v.fromBufferAttribute(pos, i).sub(C);
      ang = Math.max(ang, d.clone().normalize().angleTo(dirRaw));
      rMax = Math.max(rMax, d.length()); // outermost point of the eye bump
    }
    // per-eye radius from the FARTHEST eye vertex: the mean sits under the
    // face surface and buries the decal inside the head.
    // distances stay in raw units (bone-local space); dir is world-axis.
    // dirs pulled toward face-front: the reference variants wear their
    // eyes closer together than the animation base's wide-set baked ones
    dir.add(new THREE.Vector3(0, 0.02, 0.45)).normalize();
    eyes.push({ side: dir.x < 0 ? -1 : 1, dir, r: rMax,
                ang: Math.min(0.62, Math.max(0.3, ang * 1.12)) });
    // erase this eye from the texture: expanded box filled with the pale
    // body color sampled beside it
    const pad = 0.012;
    const bx = Math.floor((ub.u0 - pad) * cv.width), by = Math.floor((ub.v0 - pad) * cv.height);
    const bw = Math.ceil((ub.u1 - ub.u0 + 2 * pad) * cv.width), bh = Math.ceil((ub.v1 - ub.v0 + 2 * pad) * cv.height);
    let fill = [230, 230, 230], best = 0;
    for (const [sx, sy] of [[bx - 8, by + bh / 2], [bx + bw + 8, by + bh / 2], [bx + bw / 2, by - 8], [bx + bw / 2, by + bh + 8]]) {
      const i = ((Math.max(0, Math.min(cv.height - 1, Math.round(sy)))) * cv.width +
                 (Math.max(0, Math.min(cv.width - 1, Math.round(sx))))) * 4;
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      if (l > best) { best = l; fill = [px[i], px[i + 1], px[i + 2]]; }
    }
    ctx.fillStyle = `rgb(${fill[0]},${fill[1]},${fill[2]})`;
    ctx.fillRect(bx, by, bw, bh);
  }
  const eyeless = new THREE.CanvasTexture(cv);
  eyeless.colorSpace = THREE.SRGBColorSpace;
  eyeless.flipY = false;
  sm.material.map = eyeless;
  sm.material.needsUpdate = true;
  img.close?.(); // free the decoded 4096 original (67MB on phones)
  // anchor: head-center position in Head-bone local space, axes kept
  // aligned to the WORLD (so parts built "y-up" sit upright and decal
  // directions can be world-axis vectors)
  const anchorWorld = new THREE.Matrix4().setPosition(toWorld(C));
  const anchorLocal = head.matrixWorld.clone().invert().multiply(anchorWorld);
  const anchorPos = new THREE.Vector3();
  const anchorQuat = new THREE.Quaternion();
  anchorLocal.decompose(anchorPos, anchorQuat, new THREE.Vector3());
  // sizes measured in anchor space (raw model units)
  return { anchorPos, anchorQuat, R, eyes, partScale: R / 5.2 };
}

export async function makeGLBCharacter(rawCfg) {
  return buildGLBApi(normalizeAvatar(rawCfg), await loadGLBTemplate());
}

// sync clone once the template has resolved (NPCs/remotes spawn in loops);
// returns null before then — callers fall back to the procedural character
export function makeGLBCharacterSync(rawCfg) {
  return glbResolved ? buildGLBApi(normalizeAvatar(rawCfg), glbResolved) : null;
}

// eye decal as a sphere section around the measured head, aimed at the
// baked eye's direction — curves with the face exactly like the erased art
function glbEyePatch(face, eye, style, irisHex) {
  // 0.45 of the measured cluster angle: the decal canvas pads the ellipse
  // AND the reference variant models wear smaller eyes than the animation
  // base's baked ones — this lands on the reference size
  const angV = Math.min(0.3, Math.max(0.16, eye.ang * 0.45));
  const angH = angV * 0.72;
  const geo = new THREE.SphereGeometry(eye.r * 1.06, 18, 18,
    Math.PI / 2 - angH, angH * 2, Math.PI / 2 - angV, angV * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: eyeTexture(style, irisHex, eye.side),
    transparent: true, alphaTest: 0.02, side: THREE.FrontSide,
  }));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), eye.dir);
  return mesh;
}

function buildGLBApi(cfg, { holder, clips, face }) {
  const group = SkeletonUtils.clone(holder);
  const bodyMats = [];
  group.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.material = o.material.clone();
      o.frustumCulled = false; // bind-pose bounds lie once bones move
      bodyMats.push(o.material);
    }
  });
  const headBone = group.getObjectByName("Head");
  let anchor = null;
  let partMat = null;
  if (face && headBone) {
    anchor = new THREE.Group();
    anchor.position.copy(face.anchorPos);
    anchor.quaternion.copy(face.anchorQuat);
    headBone.add(anchor);
  }
  const apply = () => {
    // normalize so the palette's white maps to exactly 1.0 — higher gain
    // clips lit surfaces flat and erases the hand/feet shading
    const gain = 255 / parseInt(THEME.body.white.slice(3, 5), 16);
    const tint = new THREE.Color(BODY_HEX[cfg.body]).multiplyScalar(gain);
    for (const m of bodyMats) {
      m.color = tint.clone();
      if (m.isMeshStandardMaterial) { // theme soft-gloss shading
        m.roughness = THEME.character.roughness;
        m.envMapIntensity = THEME.character.envMapIntensity;
      }
    }
    if (!anchor) return;
    anchor.clear();
    const irisHex = IRIS_HEX[cfg.iris];
    for (const eye of face.eyes) {
      anchor.add(glbEyePatch(face, eye, cfg.eyes, irisHex));
    }
    partMat = new THREE.MeshLambertMaterial({ color: BODY_HEX[cfg.body] });
    const parts = buildHeadParts(cfg.head, partMat);
    // 1.25: reference variants wear larger features than a straight
    // head-radius conversion suggests
    parts.scale.setScalar(face.partScale * 1.25);
    anchor.add(parts);
  };
  apply();
  const mixer = new THREE.AnimationMixer(group);
  const idle = mixer.clipAction(clips[GLB_CLIPS.idle]);
  const walk = mixer.clipAction(clips[GLB_CLIPS.walk]);
  walk.timeScale = 1.25; // match in-world travel speed
  idle.time = Math.random() * idle.getClip().duration; // desync crowds
  idle.play();
  // the source idle stares at the ground — lift the gaze after each mixer
  // step (rotate about the head-local axis that matches model X)
  let qLift = null;
  if (headBone && face) {
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(face.anchorQuat).normalize();
    qLift = new THREE.Quaternion().setFromAxisAngle(axis, -0.26);
  }
  let wasWalking = false;
  let lastT = null;
  return {
    group,
    get config() { return { ...cfg }; },
    setConfig(next) {
      cfg = normalizeAvatar({ ...cfg, ...next });
      apply();
    },
    walking: false,
    phase: 0,
    tick(t) {
      if (this.walking !== wasWalking) {
        const [from, to] = this.walking ? [idle, walk] : [walk, idle];
        to.reset().fadeIn(0.22).play();
        from.fadeOut(0.22);
        wasWalking = this.walking;
      }
      const dt = lastT === null ? 0.016 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      mixer.update(dt);
      if (qLift) headBone.quaternion.multiply(qLift);
    },
  };
}

// portrait thumbnail for chat headers / match cards (data URL)
let thumbRenderer = null;
export function avatarThumb(rawCfg, size = 128) {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(size, size);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x8fa3b8, 1.3));
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(30, 50, 40);
  scene.add(sun);
  const ch = makeCharacter(rawCfg);
  scene.add(ch.group);
  const cam = new THREE.PerspectiveCamera(35, 1, 1, 200);
  cam.position.set(0, 11.5, 26);
  cam.lookAt(0, 8.6, 0);
  thumbRenderer.render(scene, cam);
  return thumbRenderer.domElement.toDataURL();
}
