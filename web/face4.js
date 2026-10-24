// The new player faces (avatar4.js), drawn in code: big sharp almond anime
// eyes with a tinted iris, no mouth, no brows. One transparent canvas per
// (eye shape, iris, expression), mapped onto the head's own material through
// its face UV set (TEXCOORD_1), so it's lit and skinned with the head: never
// a floating plane. Expressions live in the eyes only.
import * as THREE from "https://esm.sh/three@0.160.0";
import { EYE_SHAPES, IRIS4 } from "./items4.js";
export { EYE_SHAPES, IRIS4 };

export const FACE4_SIZE = 512;
// the face UV box on the base head: u 0..1 = x -0.1..0.1, v 0..1 = y 0.76..0.96
// (model units). The eyes sit at x ±0.04, y 0.864.
const EYE_U = 0.3, EYE_V = 0.52;

export const EXPRESSIONS4 = ["neutral", "blink", "happy", "angry", "surprised", "sleepy", "sad", "wink"];
// older callers ask for these
export const EXPR_ALIAS = { smile: "happy", laugh: "happy", shock: "surprised", tired: "sleepy" };

// per shape (canvas fractions): w / h half width and height of the eye,
// tilt (inner corner down, outer corner up), lash (lid line thickness at
// the outer end), wing (flick length past the outer corner), lid (a heavy
// lid covering the top, 0..1), low (how round the lower edge is), extras
const SHAPES = {
  sharp:   { w: 0.13, h: 0.06, tilt: 0.022, lash: 0.05, wing: 0.065, lid: 0.0, low: 1.0 },
  round:   { w: 0.12, h: 0.078, tilt: 0.006, lash: 0.022, wing: 0.025, lid: 0.0, low: 1.15 },
  sleepy:  { w: 0.13, h: 0.06, tilt: 0.008, lash: 0.026, wing: 0.035, lid: 0.45, low: 1.0 },
  narrow:  { w: 0.135, h: 0.042, tilt: 0.02, lash: 0.03, wing: 0.055, lid: 0.0, low: 0.85 },
  sparkly: { w: 0.125, h: 0.078, tilt: 0.01, lash: 0.024, wing: 0.03, lid: 0.0, low: 1.15, sparkle: true },
  tired:   { w: 0.128, h: 0.058, tilt: 0.004, lash: 0.024, wing: 0.02, lid: 0.28, low: 1.0, bags: true },
  cat:     { w: 0.132, h: 0.058, tilt: 0.04, lash: 0.032, wing: 0.09, lid: 0.0, low: 0.95, lashes: true },
  droopy:  { w: 0.128, h: 0.06, tilt: -0.024, lash: 0.024, wing: 0.022, lid: 0.18, low: 1.05 },
  // the second set: iris (iris size), pupil (pupil size), glance (both
  // irises shifted toward the canvas' right, in eye widths), flat (a
  // straight lid line), brow (an angled brow stroke), lowLash (a lower lash
  // line), glints (extra highlights)
  keen:    { w: 0.138, h: 0.036, tilt: 0.03, lash: 0.042, wing: 0.085, lid: 0.0, low: 0.8, iris: 0.95 },
  wide:    { w: 0.135, h: 0.074, tilt: 0.026, lash: 0.05, wing: 0.07, lid: 0.0, low: 1.05 },
  cool:    { w: 0.134, h: 0.058, tilt: 0.016, lash: 0.04, wing: 0.06, lid: 0.4, low: 0.95, flat: true },
  fox:     { w: 0.13, h: 0.05, tilt: 0.058, lash: 0.036, wing: 0.11, lid: 0.0, low: 0.85 },
  soft:    { w: 0.118, h: 0.082, tilt: 0.0, lash: 0.018, wing: 0.008, lid: 0.0, low: 1.2, iris: 1.05 },
  lashy:   { w: 0.13, h: 0.064, tilt: 0.022, lash: 0.06, wing: 0.07, lid: 0.0, low: 1.0, lashes: 5, lowLash: true },
  glance:  { w: 0.13, h: 0.058, tilt: 0.024, lash: 0.045, wing: 0.065, lid: 0.12, low: 0.95, glance: 0.42 },
  baggy:   { w: 0.128, h: 0.056, tilt: 0.01, lash: 0.03, wing: 0.035, lid: 0.32, low: 1.0, bags: 2 },
  fierce:  { w: 0.132, h: 0.054, tilt: 0.03, lash: 0.05, wing: 0.07, lid: 0.12, low: 0.9, brow: true },
  dreamy:  { w: 0.13, h: 0.062, tilt: -0.03, lash: 0.03, wing: 0.03, lid: 0.42, low: 1.1 },
  starry:  { w: 0.126, h: 0.076, tilt: 0.014, lash: 0.03, wing: 0.04, lid: 0.0, low: 1.12, sparkle: true, glints: true },
  serious: { w: 0.132, h: 0.056, tilt: 0.024, lash: 0.044, wing: 0.06, lid: 0.08, low: 0.95, iris: 0.66, pupil: 0.55 },
};
const LINE = "#17121a";
const rgb = (c, k = 1) => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(255, v * k)))).join(",")})`;

// one eye. side: -1 = the eye on the canvas' left (the character's right),
// +1 the other; "outer" is toward the side of the head.
function drawEye(g, cx, cy, S, st, iris, side, expr) {
  const w = st.w * S, h = st.h * S, tl = st.tilt * S;
  const X = f => cx + side * f * w;               // f: -1 inner corner .. +1 outer
  const inner = [X(-1), cy + h * 0.35 + tl], outer = [X(1), cy - h * 0.25 - tl];
  let lid = st.lid;
  if (expr === "sleepy") lid = Math.max(lid, 0.5);
  if (expr === "angry") lid = Math.max(lid, 0.3);
  const wide = expr === "surprised" ? 1.3 : 1;
  const top = cy - h * 1.05 * wide, bot = cy + h * 0.95 * st.low * wide;
  // the upper lid: rises fast from the inner corner, then runs almost flat
  const upper = (ctx, dy = 0) => {
    ctx.moveTo(inner[0], inner[1] + dy);
    if (st.flat) ctx.bezierCurveTo(X(-0.8), top + h * 0.25 + dy, X(0.4), top + h * 0.1 + dy, outer[0], outer[1] + dy);
    else ctx.bezierCurveTo(X(-0.85), top + dy, X(0.35), top - h * 0.05 + dy, outer[0], outer[1] + dy);
  };
  g.lineCap = "round"; g.lineJoin = "round";
  if (expr === "blink" || (expr === "wink" && side > 0)) {
    // shut: the lash line, bowed down, still winged
    g.fillStyle = LINE; g.beginPath();
    g.moveTo(inner[0], inner[1]);
    g.quadraticCurveTo(cx, cy + h * 0.75, outer[0], outer[1] + h * 0.15);
    g.lineTo(outer[0] + side * st.wing * S * 0.9, outer[1] - st.wing * S * 0.35);
    g.lineTo(outer[0] - side * w * 0.05, outer[1] - h * 0.05);
    g.quadraticCurveTo(cx, cy + h * 0.75 - st.lash * S * 0.8, inner[0], inner[1] - h * 0.12);
    g.closePath(); g.fill();
    return;
  }
  if (expr === "happy") {
    // ^ ^ : the lid line arched up
    g.strokeStyle = LINE; g.lineWidth = st.lash * S * 0.75;
    g.beginPath(); g.moveTo(inner[0], cy + h * 0.45); g.quadraticCurveTo(cx, cy - h * 1.25, outer[0], cy + h * 0.25); g.stroke();
    return;
  }
  const shape = () => {
    g.beginPath(); upper(g);
    g.bezierCurveTo(X(0.75), bot, X(-0.45), bot, inner[0], inner[1]);
    g.closePath();
  };
  g.save();
  shape(); g.fillStyle = "#f6f3ee"; g.fill(); g.clip();
  // iris: big, a little toward the nose, tucked under the upper lid
  const ir = Math.max(h * 1.12 * (st.iris ?? 1), S * 0.04) * (expr === "surprised" ? 0.78 : 1);
  const ix = X(-0.12) + (st.glance ?? 0) * w, iy = cy + h * 0.12;
  const grd = g.createRadialGradient(ix, iy + ir * 0.25, ir * 0.15, ix, iy, ir);
  grd.addColorStop(0, rgb(iris, 1.3)); grd.addColorStop(0.6, rgb(iris, 1.0)); grd.addColorStop(0.92, rgb(iris, 0.55)); grd.addColorStop(1, rgb(iris, 0.35));
  g.fillStyle = grd; g.beginPath(); g.arc(ix, iy, ir, 0, Math.PI * 2); g.fill();
  g.fillStyle = rgb(iris, 0.22); g.beginPath(); g.arc(ix, iy, ir * 0.45 * (st.pupil ?? 1), 0, Math.PI * 2); g.fill();
  // the upper lid's shadow on the eye
  g.fillStyle = "rgba(40,24,30,.26)"; g.fillRect(cx - w * 1.4, top - h, w * 2.8, h * 1.5);
  // highlights
  g.fillStyle = "#ffffff";
  g.beginPath(); g.arc(ix - side * ir * 0.32, iy - ir * 0.36, ir * 0.24, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(ix + side * ir * 0.35, iy + ir * 0.4, ir * 0.09, 0, Math.PI * 2); g.fill();
  if (st.sparkle) {
    g.beginPath(); g.arc(ix + side * ir * 0.05, iy + ir * 0.02, ir * 0.12, 0, Math.PI * 2); g.fill();
    star(g, ix + side * ir * 0.5, iy - ir * 0.5, ir * 0.22);
  }
  if (st.glints) {
    star(g, ix - side * ir * 0.45, iy + ir * 0.42, ir * 0.16);
    g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.arc(ix, iy + ir * 0.62, ir * 0.3, Math.PI * 1.1, Math.PI * 1.9); g.fill();
  }
  // a heavy lid: skin comes down over the top of the eye
  let lidY = null;
  if (lid > 0) {
    lidY = top + (bot - top) * lid * 0.85;
    g.globalCompositeOperation = "destination-out";
    g.fillRect(cx - w * 1.4, top - h, w * 2.8, lidY - top + h);
    g.globalCompositeOperation = "source-over";
  }
  g.restore();
  // the lash line: a filled band along the upper lid, thin at the inner
  // corner, thick at the outer end, then the wing
  const T = st.lash * S, wl = st.wing * S;
  g.fillStyle = LINE; g.beginPath();
  if (lidY != null) {
    const y0 = Math.max(lidY, inner[1] - h * 0.3);
    g.moveTo(inner[0], y0 + T * 0.2);
    g.quadraticCurveTo(cx, lidY - T * 0.1, outer[0], Math.max(outer[1], lidY - h * 0.1));
    g.lineTo(outer[0] + side * wl, outer[1] - wl * 0.42);
    g.lineTo(outer[0] - side * w * 0.1, Math.max(outer[1], lidY - h * 0.1) - T);
    g.quadraticCurveTo(cx, lidY - T * 1.1, inner[0], y0 - T * 0.3);
  } else {
    upper(g);
    g.lineTo(outer[0] + side * wl, outer[1] - wl * 0.42);
    g.lineTo(outer[0] - side * w * 0.12, outer[1] - T * 0.95);
    g.bezierCurveTo(X(0.35), top - T * 0.75, X(-0.85), top - T * 0.25, inner[0] - side * w * 0.04, inner[1] - T * 0.35);
  }
  g.closePath(); g.fill();
  const nl = st.lashes === true ? 3 : st.lashes ?? 0;
  for (let k = 0; k < nl; k++) {
    const f = 0.25 + k * 0.75 / nl, x0 = X(f), y0 = top - T * 0.4 + (outer[1] - top) * f * f;
    g.strokeStyle = LINE; g.lineWidth = T * 0.35;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + side * S * 0.018, y0 - S * 0.024); g.stroke();
  }
  // the lower lid: a faint line under the outer half
  g.lineWidth = T * 0.22; g.strokeStyle = "rgba(23,18,26,.55)";
  g.beginPath(); g.moveTo(X(0.05), bot - h * 0.04); g.quadraticCurveTo(X(0.65), bot - h * 0.12, X(0.95), outer[1] + h * 0.35); g.stroke();
  if (st.lowLash) {
    // a lower lash line and a few short lashes under the outer half
    g.lineWidth = T * 0.4; g.strokeStyle = LINE;
    g.beginPath(); g.moveTo(X(0.2), bot - h * 0.08); g.quadraticCurveTo(X(0.7), bot - h * 0.14, X(0.98), outer[1] + h * 0.3); g.stroke();
    g.lineWidth = T * 0.22;
    for (const f of [0.45, 0.68, 0.88]) { const x0 = X(f), y0 = bot - h * (0.1 + f * 0.2); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + side * S * 0.008, y0 + S * 0.016); g.stroke(); }
  }
  if (st.bags || expr === "sleepy") {
    g.strokeStyle = "rgba(90,50,60,.38)"; g.lineWidth = T * 0.3;
    g.beginPath(); g.moveTo(X(-0.55), bot + h * 0.35); g.quadraticCurveTo(cx, bot + h * 0.7, X(0.6), bot + h * 0.25); g.stroke();
    if (st.bags === 2) {
      // tired: a shadow under the eye and a second crease
      g.fillStyle = "rgba(110,60,80,.16)"; g.beginPath(); g.ellipse(cx + side * w * 0.05, bot + h * 0.45, w * 0.7, h * 0.4, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(X(-0.35), bot + h * 0.85); g.quadraticCurveTo(cx, bot + h * 1.15, X(0.4), bot + h * 0.75); g.stroke();
    }
  }
  if (st.brow && expr !== "angry" && expr !== "sad") {
    // determined: a short tapered brow, low at the nose, rising outward
    const by = top - h * 0.75 - (expr === "surprised" ? h * 0.4 : 0);
    g.fillStyle = LINE; g.beginPath();
    g.moveTo(X(-0.95), by + h * 0.25);
    g.lineTo(X(0.75), by - h * 0.45);
    g.lineTo(X(0.7), by - h * 0.1);
    g.lineTo(X(-0.9), by + h * 0.55);
    g.closePath(); g.fill();
  }
  // angry / sad: doodled marks over the eye, never brows on the head
  if (expr === "angry") {
    g.strokeStyle = LINE; g.lineWidth = T * 0.7;
    g.beginPath(); g.moveTo(X(-1.05), top + h * 0.1); g.lineTo(X(0.55), top - h * 0.8); g.stroke();
  }
  if (expr === "sad") {
    g.strokeStyle = LINE; g.lineWidth = T * 0.5;
    g.beginPath(); g.moveTo(X(-0.9), top - h * 0.9); g.lineTo(X(0.5), top - h * 0.35); g.stroke();
  }
}
function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}

// face accessories drawn on the face layer (they move and light with the head)
// u, v in the face UV box; canvas y = (1 - v)
function drawDecal(g, S, id) {
  const P = (u, v) => [u * S, (1 - v) * S];
  g.save();
  if (id === "band-aid") {
    const [x, y] = P(0.8, 0.33);
    g.translate(x, y); g.rotate(-0.5);
    g.fillStyle = "#f2c79a"; g.strokeStyle = "rgba(120,80,50,.45)"; g.lineWidth = S * 0.004;
    g.beginPath(); g.roundRect(-S * 0.085, -S * 0.03, S * 0.17, S * 0.06, S * 0.03); g.fill(); g.stroke();
    g.fillStyle = "#e7b384"; g.fillRect(-S * 0.03, -S * 0.026, S * 0.06, S * 0.052);
    g.fillStyle = "rgba(150,100,60,.5)";
    for (const dx of [-0.015, 0, 0.015]) for (const dy of [-0.01, 0.01]) { g.beginPath(); g.arc(dx * S, dy * S, S * 0.0035, 0, 7); g.fill(); }
  } else if (id === "star-sticker") {
    const [x, y] = P(0.25, 0.36), r = S * 0.04;
    g.translate(x, y); g.fillStyle = "#ffd23f"; g.strokeStyle = "#fff6c8"; g.lineWidth = S * 0.006;
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.fill(); g.stroke();
  } else if (id === "nose-ring") {
    const [x, y] = P(0.545, 0.31);
    g.strokeStyle = "#d8dde6"; g.lineWidth = S * 0.009;
    g.beginPath(); g.arc(x, y, S * 0.018, -0.3, Math.PI + 0.3, false); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = S * 0.003;
    g.beginPath(); g.arc(x, y, S * 0.018, 0.5, 1.2); g.stroke();
  }
  g.restore();
}

// the face, drawn into a 2D context of size S (also used for 2D thumbs)
export function drawFace4(g, S, { eyes = "sharp", iris = "gray", expr = "neutral", decal = null } = {}) {
  const st = SHAPES[eyes] ?? SHAPES.sharp, ic = IRIS4[iris] ?? IRIS4.gray;
  const cy = (1 - EYE_V) * S;
  expr = EXPR_ALIAS[expr] ?? expr;
  drawEye(g, EYE_U * S, cy, S, st, ic, -1, expr);
  drawEye(g, (1 - EYE_U) * S, cy, S, st, ic, 1, expr);
  if (decal) drawDecal(g, S, decal);
}

const cache = new Map();
export function faceTexture4(look = {}, expr = "neutral", decal = null) {
  const key = `${look.eyes}|${look.iris}|${expr}|${decal}`;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement("canvas");
  cv.width = cv.height = FACE4_SIZE;
  drawFace4(cv.getContext("2d"), FACE4_SIZE, { eyes: look.eyes, iris: look.iris, expr, decal });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
