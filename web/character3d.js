// Rando modular character, v2 — matches the organized reference set in
// "rando avatar v2": 10 body colors, 6 eye styles (2 with a colorable
// iris), 8 head shapes, mouthless face. Bodies are single-tint; eyes are
// canvas-drawn decals so linework styles (spiral, hollow, lines) render
// exactly. API (makeCharacter -> { group, config, setConfig, tick }) is
// the contract a future rigged GLB base can implement as a drop-in swap.
import * as THREE from "https://esm.sh/three@0.160.0";

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
    el(cx, cy, 54, 84); g.lineWidth = 20; g.strokeStyle = DARK; g.stroke();
  } else if (style === "lineblush") {
    g.lineWidth = 22; g.lineCap = "round"; g.strokeStyle = DARK;
    g.beginPath(); g.moveTo(cx - 52, cy - 10); g.lineTo(cx + 52, cy - 10); g.stroke();
    // blush on the outer cheek (mirrored per side)
    el(cx + side * 46, cy + 74, 40, 22);
    g.fillStyle = "rgba(255,138,160,0.75)"; g.fill();
  } else if (style === "sleepy") {
    g.lineWidth = 22; g.lineCap = "round"; g.strokeStyle = DARK;
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

    // body + feet
    const body = sphere(3.4, mat, 1, 1.05, 1);
    body.position.y = 3.8;
    group.add(body);
    refs.feet = [];
    for (const s of [-1, 1]) {
      const foot = sphere(1.55, mat, 1.1, 0.55, 1.45);
      foot.position.set(s * 1.7, 0.85, 0.7);
      group.add(foot);
      refs.feet.push(foot);
    }

    // stub arms (fixed style in v2), pivot at shoulder for the waddle
    refs.arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 3.1, 5.6, 0);
      const arm = sphere(1.35, mat, 0.62, 1.25, 0.62);
      arm.position.y = -1.5;
      pivot.add(arm);
      pivot.rotation.z = s * 0.35;
      group.add(pivot);
      refs.arms.push(pivot);
    }

    // head (mouthless, per the v2 set)
    const headG = new THREE.Group();
    headG.position.y = 10.1;
    refs.head = headG;
    headG.add(sphere(5.1, mat, 1, 0.96, 0.98));

    // eyes: canvas decals hugging the face
    const irisHex = IRIS_HEX[cfg.iris];
    for (const s of [-1, 1]) {
      const tex = eyeTexture(cfg.eyes, irisHex, s);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(2.5, 2.5),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02 }));
      plane.position.set(s * 1.85, 0.55, 4.42);
      plane.rotation.y = s * 0.28;
      headG.add(plane);
    }

    // head shapes (all tinted the body color, like the reference sheets)
    const H = cfg.head;
    if (H === "teardrop") {
      const p = cone(1.25, 3.1, mat);
      p.position.set(0, 4.9, -0.2);
      p.rotation.x = -0.12;
      headG.add(p);
    } else if (H === "catears") {
      for (const s of [-1, 1]) {
        const e = cone(1.35, 2.7, mat);
        e.position.set(s * 2.9, 4.4, 0);
        e.rotation.z = -s * 0.3;
        headG.add(e);
      }
    } else if (H === "devilhorns") {
      for (const s of [-1, 1]) {
        const h = cone(0.85, 2.3, mat);
        h.position.set(s * 2.7, 4.35, 0);
        h.rotation.z = -s * 0.55;
        headG.add(h);
      }
    } else if (H === "floppyears") {
      for (const s of [-1, 1]) {
        const e = sphere(1.6, mat, 0.55, 1.6, 0.7);
        e.position.set(s * 3.7, 1.1, 0);
        e.rotation.z = s * 0.95;
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
        const sp = cone(0.7, 1.7, mat);
        sp.position.set(s * 1.9, 4.85, 0);
        sp.rotation.z = -s * 0.25;
        headG.add(sp);
      }
    } else if (H === "notailspike") {
      const center = cone(1.1, 3.7, mat);
      center.position.set(0, 5.1, -0.3);
      center.rotation.x = -0.14;
      headG.add(center);
      for (const s of [-1, 1]) {
        const sp = cone(0.75, 2.1, mat);
        sp.position.set(s * 2.5, 4.3, 0);
        sp.rotation.z = -s * 0.5;
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
