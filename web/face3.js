// Player faces, drawn in code: eyes, brows and mouth composited into one
// transparent 512 px canvas per (eye style, iris, brow color, expression).
// avatar3 maps it onto the head's own material through a second UV set
// (see faceUvw in avatar3.js), so the face is lit, shaded and skinned with
// the head — never a separate plane. Textures are cached and shared by
// every character with the same look; mipmaps keep it calm at map distance.
import * as THREE from "https://esm.sh/three@0.160.0";

export const FACE_SIZE = 512;
export const EXPRESSIONS = ["neutral", "smile", "smirk", "surprised", "wink", "laugh"];
export const IRIS_RGB = {
  black: [38, 42, 48], navy: [46, 68, 104], current: [84, 90, 104],
  brown: [138, 98, 70], blue: [63, 127, 209], green: [83, 156, 83],
};

// where the features sit on the canvas (fractions of FACE_SIZE). avatar3
// lines EYE_Y / EYE_DX up with the eyes it found on the head, so every
// style and expression lands in the same place.
export const EYE_Y = 0.44;
export const EYE_DX = 0.175;

// eye styles. All wide open and round (never narrow): they differ in
// lashes, liner, highlights and extras.
const STYLES = {
  f1: { rx: 0.082, ry: 0.094, lash: 0.022, flick: 0.5, shine: "dots" },
  f2: { rx: 0.085, ry: 0.098, lash: 0.02, flick: 0.35, shine: "big", lower: true },
  f3: { rx: 0.084, ry: 0.096, lash: 0.022, flick: 0.5, shine: "star" },
  f4: { rx: 0.086, ry: 0.088, lash: 0.026, flick: 0.8, shine: "dots", tilt: 0.12 },
  f5: { rx: 0.08, ry: 0.092, lash: 0.02, flick: 0.4, shine: "dots", freckles: true },
  f6: { rx: 0.084, ry: 0.094, lash: 0.03, flick: 1.1, shine: "big", wing: true },
};

const rgb = (c, k = 1) => `rgb(${c.map(v => Math.round(Math.min(255, v * k))).join(",")})`;
const LINE = "#2a1c22";

function drawEye(g, cx, cy, S, st, iris, side, mode) {
  const rx = st.rx * S, ry = st.ry * S;
  if (mode === "closed" || mode === "happy") {
    // closed: a lash arc (down for a blink/wink, up ^ for a laugh)
    g.strokeStyle = LINE; g.lineCap = "round"; g.lineWidth = st.lash * S * 0.9;
    g.beginPath();
    if (mode === "happy") { g.moveTo(cx - rx, cy + ry * 0.15); g.quadraticCurveTo(cx, cy - ry * 0.95, cx + rx, cy + ry * 0.15); }
    else { g.moveTo(cx - rx, cy - ry * 0.05); g.quadraticCurveTo(cx, cy + ry * 0.7, cx + rx, cy - ry * 0.05); }
    g.stroke();
    // outer lash flick
    g.beginPath(); g.moveTo(cx + side * rx * 0.95, cy - ry * 0.02);
    g.lineTo(cx + side * rx * (1.25 + st.flick * 0.1), cy - ry * (0.35 + st.flick * 0.1)); g.stroke();
    return;
  }
  const wide = mode === "wide" ? 1.12 : 1;
  const ery = ry * wide;
  g.save();
  // the eye's outline (slightly flatter on top for the tilted style)
  const tilt = (st.tilt ?? 0) * side;
  g.beginPath();
  g.ellipse(cx, cy, rx * wide, ery, tilt, 0, Math.PI * 2);
  g.fillStyle = "#fbfbff"; g.fill();
  g.clip();
  // iris: a gradient disc, darker at the top where the lid shades it
  const ir = rx * 0.82 * wide, iy = cy + ery * 0.12;
  const grad = g.createLinearGradient(0, iy - ir, 0, iy + ir);
  grad.addColorStop(0, rgb(iris, 0.45));
  grad.addColorStop(0.55, rgb(iris, 1));
  grad.addColorStop(1, rgb(iris, 1.35));
  g.fillStyle = grad;
  g.beginPath(); g.arc(cx, iy, ir, 0, Math.PI * 2); g.fill();
  g.strokeStyle = rgb(iris, 0.35); g.lineWidth = S * 0.006;
  g.stroke();
  // pupil
  g.fillStyle = "#15121a";
  g.beginPath(); g.ellipse(cx, iy, ir * 0.45, ir * 0.5, 0, 0, Math.PI * 2); g.fill();
  // lid shadow across the top of the eye
  const sh = g.createLinearGradient(0, cy - ery, 0, cy - ery * 0.35);
  sh.addColorStop(0, "rgba(40,20,40,0.35)"); sh.addColorStop(1, "rgba(40,20,40,0)");
  g.fillStyle = sh; g.fillRect(cx - rx * 1.3, cy - ery * 1.1, rx * 2.6, ery);
  g.restore();
  // highlights: always the light's side (upper left), never mirrored
  g.fillStyle = "#ffffff";
  const hx = cx - ir * 0.38, hy = iy - ir * 0.42;
  if (st.shine === "star") {
    const r = ir * 0.42;
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, rr = k % 2 ? r * 0.32 : r;
      g.lineTo(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  } else {
    g.beginPath(); g.arc(hx, hy, ir * (st.shine === "big" ? 0.36 : 0.28), 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.arc(cx + ir * 0.36, iy + ir * 0.38, ir * 0.13, 0, Math.PI * 2); g.fill();
  // the thick upper lash line, over the top of the eye, with an outer flick
  g.strokeStyle = LINE; g.lineCap = "round"; g.lineJoin = "round";
  g.lineWidth = st.lash * S;
  g.beginPath();
  g.ellipse(cx, cy, rx * wide, ery, tilt, Math.PI * 1.06, Math.PI * 1.94);
  g.stroke();
  const ox = cx + side * rx * wide * 0.97, oy = cy - ery * 0.3 + tilt * ery;
  g.beginPath(); g.moveTo(ox, oy);
  g.lineTo(ox + side * rx * (0.25 + st.flick * 0.22), oy - ery * (0.18 + st.flick * 0.12));
  g.stroke();
  if (st.wing) {
    g.beginPath(); g.moveTo(ox - side * rx * 0.1, oy + ery * 0.12);
    g.lineTo(ox + side * rx * 0.55, oy - ery * 0.32);
    g.lineWidth = st.lash * S * 0.7; g.stroke();
  }
  // a light lower line
  g.lineWidth = S * 0.007; g.strokeStyle = "rgba(42,28,34,0.55)";
  g.beginPath(); g.ellipse(cx, cy, rx * wide, ery, tilt, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
  if (st.lower) {
    g.lineWidth = S * 0.006;
    for (const k of [-0.45, 0, 0.45]) {
      const a = Math.PI / 2 + k * side;
      const x0 = cx + Math.cos(a) * rx, y0 = cy + Math.sin(a) * ery;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + side * S * 0.004, y0 + S * 0.018); g.stroke();
    }
  }
}

function drawBrow(g, cx, cy, S, side, lift, angle, color) {
  // a short soft stroke; side +1 = the character's left (canvas right)
  g.strokeStyle = color; g.lineCap = "round";
  g.lineWidth = S * 0.026;
  const y = cy - S * (0.145 + lift);
  const w = S * 0.072;
  const inner = cx - side * w, outer = cx + side * w;
  g.beginPath();
  g.moveTo(inner, y + angle * S);
  g.quadraticCurveTo(cx, y - S * 0.018, outer, y + S * 0.01 - angle * S * 0.3);
  g.stroke();
}

function drawMouth(g, S, expr) {
  const cx = S / 2, cy = S * 0.6; // above the chin's turn, so open mouths stay on the face
  g.strokeStyle = LINE; g.lineCap = "round"; g.lineJoin = "round";
  g.lineWidth = S * 0.016;
  const open = (w, h, smile) => {
    // an open mouth: flat-ish top, round bottom, tongue
    g.beginPath();
    g.moveTo(cx - w, cy - smile);
    g.quadraticCurveTo(cx, cy + smile * 0.2, cx + w, cy - smile);
    g.quadraticCurveTo(cx + w * 0.8, cy + h, cx, cy + h);
    g.quadraticCurveTo(cx - w * 0.8, cy + h, cx - w, cy - smile);
    g.closePath();
    g.fillStyle = "#7a2632"; g.fill();
    g.save(); g.clip();
    g.fillStyle = "#e3727a";
    g.beginPath(); g.ellipse(cx, cy + h * 0.95, w * 0.62, h * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff";
    g.fillRect(cx - w, cy - smile - h, w * 2, h * 0.3 + smile * 0.8);
    g.restore();
    g.stroke();
  };
  switch (expr) {
    case "smile":
      g.beginPath(); g.moveTo(cx - S * 0.06, cy - S * 0.012);
      g.quadraticCurveTo(cx, cy + S * 0.05, cx + S * 0.06, cy - S * 0.012); g.stroke();
      break;
    case "smirk":
      g.beginPath(); g.moveTo(cx - S * 0.045, cy + S * 0.012);
      g.quadraticCurveTo(cx + S * 0.01, cy + S * 0.022, cx + S * 0.058, cy - S * 0.02); g.stroke();
      break;
    case "surprised":
      g.beginPath(); g.ellipse(cx, cy + S * 0.012, S * 0.03, S * 0.04, 0, 0, Math.PI * 2);
      g.fillStyle = "#7a2632"; g.fill(); g.stroke();
      break;
    case "laugh": open(S * 0.068, S * 0.058, S * 0.012); break;
    case "wink": open(S * 0.045, S * 0.032, S * 0.008); break;
    default: // neutral: a small relaxed curve
      g.beginPath(); g.moveTo(cx - S * 0.035, cy);
      g.quadraticCurveTo(cx, cy + S * 0.018, cx + S * 0.035, cy); g.stroke();
  }
}

// draw one face into a 2D context of side S (transparent background)
export function drawFace(g, S, { style = "f1", iris = "current", brow = [60, 44, 40], expr = "neutral" } = {}) {
  const st = STYLES[style] ?? STYLES.f1;
  const ic = IRIS_RGB[iris] ?? IRIS_RGB.current;
  const ey = S * EYE_Y, dx = S * EYE_DX;
  const browCol = rgb(brow, 0.8);
  // cheeks
  for (const s of [-1, 1]) {
    const cg = g.createRadialGradient(S / 2 + s * S * 0.215, S * 0.575, 0, S / 2 + s * S * 0.215, S * 0.575, S * 0.07);
    cg.addColorStop(0, `rgba(240,110,120,${expr === "laugh" || expr === "smile" ? 0.42 : 0.28})`);
    cg.addColorStop(1, "rgba(240,110,120,0)");
    g.fillStyle = cg; g.fillRect(0, 0, S, S);
  }
  if (st.freckles) {
    g.fillStyle = "rgba(150,85,60,0.55)";
    for (const s of [-1, 1]) for (const [fx, fy] of [[0.17, 0.555], [0.2, 0.575], [0.235, 0.56], [0.215, 0.545], [0.255, 0.58]]) {
      g.beginPath(); g.arc(S / 2 + s * S * fx, S * fy, S * 0.006, 0, Math.PI * 2); g.fill();
    }
  }
  // brows: lift and angle per expression
  const brows = {
    neutral: [[0, 0.004], [0, 0.004]], smile: [[0.008, 0], [0.008, 0]],
    smirk: [[-0.006, 0.012], [0.02, -0.006]], surprised: [[0.035, -0.004], [0.035, -0.004]],
    wink: [[0.012, -0.002], [-0.01, 0.01]], laugh: [[0.016, -0.004], [0.016, -0.004]],
  }[expr] ?? [[0, 0], [0, 0]];
  // index 0 = character's right eye (canvas left, side -1)
  const eyeMode = side => {
    if (expr === "laugh") return "happy";
    if (expr === "wink" && side === 1) return "closed";
    if (expr === "blink") return "closed";
    if (expr === "surprised") return "wide";
    return "open";
  };
  [-1, 1].forEach((side, k) => {
    const cx = S / 2 + side * dx;
    drawBrow(g, cx, ey, S, side, brows[k][0], brows[k][1], browCol);
    drawEye(g, cx, ey, S, st, ic, side, eyeMode(side));
  });
  drawMouth(g, S, expr === "blink" ? "neutral" : expr);
}

const cache = new Map();
// shared texture for a look; never disposed by callers (cache-owned)
export function faceTexture(look) {
  const key = `${look.style}_${look.iris}_${look.brow?.join(".")}_${look.expr}`;
  let tex = cache.get(key);
  if (tex) return tex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = FACE_SIZE;
  drawFace(cv.getContext("2d"), FACE_SIZE, look);
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.premultiplyAlpha = false;
  cache.set(key, tex);
  return tex;
}
