// Rando modular character, v2 — matches the organized reference set in
// "rando avatar v2": 10 body colors, 6 eye styles (2 with a colorable
// iris), 8 head shapes, mouthless face. Bodies are single-tint; eyes are
// canvas-drawn decals so linework styles (spiral, hollow, lines) render
// exactly. API (makeCharacter -> { group, config, setConfig, tick }) is
// the contract a future rigged GLB base can implement as a drop-in swap.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "https://esm.sh/three@0.160.0/examples/jsm/utils/SkeletonUtils.js";

export const BODY_HEX = {
  white:  "#e7e7e7", black: "#212120", grey:   "#848483", navy: "#21365f",
  skyblue:"#91dcfb", green: "#b3e8b1", orange: "#fa7a12", pink: "#fdbed0",
  purple: "#9b62d1", red:   "#fb4b49",
};
export const IRIS_HEX = {
  blue: "#4a7dd6", black: "#23272e", grey: "#9aa3ae", brown: "#7a4f2b",
  red:  "#c8452c", orange: "#e8842c", green: "#3f9e5f",
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
    el(cx, cy, 62, 92); g.fillStyle = DARK; g.fill();
    el(cx, cy + 4, 48, 76); g.fillStyle = irisHex; g.fill();
    el(cx, cy + 14, 26, 42); g.fillStyle = "#15181d"; g.fill();
    el(cx - 20, cy - 38, 14, 20); g.fillStyle = "rgba(255,255,255,0.92)"; g.fill();
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
    // light halo behind the dark stroke so linework reads on dark bodies
    el(cx, cy, 54, 84); g.lineWidth = 32; g.strokeStyle = "rgba(255,255,255,0.85)"; g.stroke();
    el(cx, cy, 54, 84); g.lineWidth = 20; g.strokeStyle = DARK; g.stroke();
  } else if (style === "lineblush") {
    g.lineCap = "round";
    g.lineWidth = 34; g.strokeStyle = "rgba(255,255,255,0.85)";
    g.beginPath(); g.moveTo(cx - 52, cy - 10); g.lineTo(cx + 52, cy - 10); g.stroke();
    g.lineWidth = 22; g.strokeStyle = DARK;
    g.beginPath(); g.moveTo(cx - 52, cy - 10); g.lineTo(cx + 52, cy - 10); g.stroke();
    // blush on the outer cheek (mirrored per side)
    el(cx + side * 46, cy + 74, 40, 22);
    g.fillStyle = "rgba(255,138,160,0.85)"; g.fill();
  } else if (style === "sleepy") {
    g.lineCap = "round";
    g.lineWidth = 34; g.strokeStyle = "rgba(255,255,255,0.85)";
    g.beginPath(); g.arc(cx, cy - 34, 58, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.lineWidth = 22; g.strokeStyle = DARK;
    g.beginPath(); g.arc(cx, cy - 34, 58, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
  } else if (style === "spiral") {
    el(cx, cy, 60, 88); g.fillStyle = "#f4f4f4"; g.fill();
    g.lineWidth = 12; g.strokeStyle = DARK;
    el(cx, cy, 60, 88); g.stroke();
    for (const s of [0.62, 0.36, 0.13]) {
      el(cx, cy, 60 * s, 88 * s); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
    const H = cfg.head;
    if (H === "teardrop") {
      const p = cone(1.5, 3.9, mat);
      p.position.set(0, 5.35, -0.2);
      p.rotation.x = -0.12;
      headG.add(p);
    } else if (H === "catears") {
      for (const s of [-1, 1]) {
        const e = cone(1.25, 2.6, mat);
        e.position.set(s * 2.25, 5.2, 0);
        e.rotation.z = -s * 0.14;
        headG.add(e);
      }
    } else if (H === "devilhorns") {
      for (const s of [-1, 1]) {
        const h = cone(0.85, 2.3, mat);
        h.position.set(s * 2.6, 4.7, 0);
        h.rotation.z = -s * 0.5;
        headG.add(h);
      }
    } else if (H === "floppyears") {
      for (const s of [-1, 1]) {
        // big hanging teardrop lobes draping from high on the head
        const e = teardrop(mat, 1.35, 6.6);
        e.position.set(s * 5.5, -4.2, 0);
        e.rotation.z = s * 0.55;
        headG.add(e);
      }
    } else if (H === "twinhorns") {
      for (const s of [-1, 1]) {
        const h = sphere(1.0, mat, 0.8, 1.5, 0.8);
        h.position.set(s * 1.6, 4.9, 0);
        h.rotation.z = -s * 0.2;
        headG.add(h);
      }
    } else if (H === "smallspikes") {
      for (const s of [-1, 1]) {
        const sp = cone(0.7, 1.8, mat);
        sp.position.set(s * 1.9, 5.15, 0);
        sp.rotation.z = -s * 0.22;
        headG.add(sp);
      }
    } else if (H === "notailspike") {
      const center = cone(1.15, 4.3, mat);
      center.position.set(0, 5.9, -0.2);
      center.rotation.x = -0.12;
      headG.add(center);
      for (const s of [-1, 1]) {
        const sp = cone(0.85, 2.5, mat);
        sp.position.set(s * 2.7, 4.7, 0);
        sp.rotation.z = -s * 0.45;
        headG.add(sp);
      }
    }
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

// ---- GLB path (?glb=1): the rigged Tripo/Meshy model in place of the
// procedural body. walking.glb ships a 33-joint skeleton but no baked
// clips, so tick() drives the bones directly (sine walk/idle cycles).
// Tint = material color multiplied over the baked near-white texture.
let glbTemplate = null;
const depth = n => { let d = 0; while (n.parent) { d++; n = n.parent; } return d; };
export function loadGLBTemplate(url = "models/walking.glb") {
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
      const box = new THREE.Box3().setFromObject(src);
      const size = new THREE.Vector3();
      box.getSize(size);
      src.scale.setScalar(15 / size.y); // normalize to CHAR_H
      const box2 = new THREE.Box3().setFromObject(src);
      src.position.y -= box2.min.y;     // feet on the ground
      src.position.x -= (box2.min.x + box2.max.x) / 2;
      src.position.z -= (box2.min.z + box2.max.z) / 2;
      const holder = new THREE.Group();
      holder.add(src);
      return holder;
    });
  }
  return glbTemplate;
}

// NOTE: this export's skin weights are ~100% on Root (Tripo rig-only
// download), so bone animation cannot move limbs. Until the animated
// export (real weights + walk clip) is dropped in, tick() does a
// whole-body waddle; swap to AnimationMixer when that file lands.
export async function makeGLBCharacter(rawCfg) {
  const cfg = normalizeAvatar(rawCfg);
  const template = await loadGLBTemplate();
  const group = SkeletonUtils.clone(template);
  const tint = new THREE.Color(BODY_HEX[cfg.body]);
  group.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.material = o.material.clone();
      o.material.color = tint.clone();
      o.frustumCulled = false; // bind-pose bounds lie once bones move
    }
  });
  return {
    group,
    get config() { return { ...cfg }; },
    setConfig() {}, // evaluation build only
    walking: false,
    phase: Math.random() * Math.PI * 2,
    tick(t) {
      const inner = group.children[0];
      if (this.walking) {
        const p = t * 9 + this.phase;
        const s = Math.sin(p);
        group.position.y = Math.abs(s) * 0.5;
        inner.rotation.z = s * 0.09;
        inner.rotation.x = Math.abs(Math.cos(p)) * 0.06;
      } else {
        const p = t * 2 + this.phase;
        group.position.y = Math.sin(p) * 0.16;
        inner.rotation.z = 0;
        inner.rotation.x = 0;
      }
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
