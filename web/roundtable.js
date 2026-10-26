// Mask Off's room: a warm, quiet room at night, a round wooden table under
// one low hanging lamp, a few candles, a window onto the city's lights. No
// host: the players themselves sit round the table, each their own 3D
// character (avatar4.js) in their current outfit, on chairs, evenly spaced
// (up to 8 seats), every one in a plain cream masquerade mask.
//
// Every phone sees the table from its own seat, first person (npcstage.js
// firstPerson: drag to turn your head about ±80°, a little up and down, it
// glides back to the table ~4 s after you let go). Your own character isn't
// drawn: your hands and cards are the page's, at the bottom of the screen.
//
//   const rt = await roundTable(hostEl);
//   rt.seat([{ id, name, avatar }, ...], meId);   // in turn order round the table (clockwise)
//   rt.state({ asker, who, picking, fresh: [ids], talker, off: [ids] });
//   rt.card(text, level) / rt.card(null);          // the asked card, face up in the middle of the table
//   rt.same(n);                                    // this turn's "Same" count: a warm glow rises for each new one
//   rt.end(true);                                  // the camera lifts above the table, every mask off
//   rt.onTap = id => ...;                          // a tap on someone at the table (never a drag)
//   rt.screen(id) -> { x, y, top, visible }        // where someone's head is on screen (CSS px), for name chips
//   rt.home(); rt.attach(el); rt.dispose();
//
// No 3D characters here (the test pages' stubs): each seat gets a simple
// rounded stand-in in the player's own colours, mask and all.
import { retroStage, THREE } from "./retrolook.js";
import { firstPerson, orbitCamera, pickTap, softDot } from "./npcstage.js";
import { ITEMS4, SKIN4_RGB, HAIR4_RGB, normalizeAvatar4 } from "./items4.js";

const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the room's light: warm, low, soft; a smooth (not pixelated) render like the hosts' rooms
export const TABLE_MOOD = {
  scale: Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1)), maxW: 720, smooth: true, msaa: 4,
  bg: 0x120b0c,
  fog: { color: 0x1a1012, near: 5, far: 14 },
  ambient: { sky: 0x6a5a78, ground: 0x2a1610, intensity: 0.55 },
  key: { color: 0xffc890, intensity: 0.35, pos: [0, 4, 0.5] },
  fill: { color: 0x8a9cff, intensity: 0.22, pos: [0, 2, -4] },        // the city through the window
  bloom: false,                                                        // (the candles' and the lamp's glows are their own)
  grade: { tint: [1.04, 0.99, 0.94], sat: 0.96, contrast: 1.04, lift: 0.02 },
  levels: 255, dither: 0, vignette: 0.3, grain: 0,
};

// the table and the seats (metres)
export const TABLE = { r: 1.02, h: 0.62, seatR: 1.32, seatH: 0.38, eye: 1.06, maxSeats: 8 };
const CHAR_H = 1.3, CHAR_UNITS = 15;          // a player's height; avatar4's own units
const ROOM = { w: 7.2, d: 7.2, h: 3.6 };

const mat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
const cTex = (w, h, draw, srgb = true) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
};
const rgbHex = a => a ? (a[0] << 16) | (a[1] << 8) | a[2] : 0x888888;
const FONT = `-apple-system, "SF Pro Text", "SF Pro Display", system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif`;

// ---------------------------------------------------------------- the mask
// a plain cream masquerade eye mask: a wide band with two almond eye holes
// and the corners swept up a little, drawn on a canvas and bent round the face
const MASK_W = 0.3, MASK_H = 0.13;
function maskGeometry(w = MASK_W, h = MASK_H, bend = 0.13) {
  const g = new THREE.PlaneGeometry(w, h, 18, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), a = x / bend; p.setXYZ(i, Math.sin(a) * bend, p.getY(i), Math.cos(a) * bend - bend); }
  g.computeVertexNormals();
  return g;
}
function maskTexture() {
  return cTex(512, 222, (x, W, H) => {
    const shape = () => {
      x.beginPath();
      x.moveTo(8, 30);
      x.bezierCurveTo(W * 0.2, 70, W * 0.36, 12, W * 0.5, 46);
      x.bezierCurveTo(W * 0.64, 12, W * 0.8, 70, W - 8, 30);
      x.bezierCurveTo(W - 2, 120, W * 0.86, H - 14, W * 0.68, H - 20);
      x.bezierCurveTo(W * 0.58, H - 22, W * 0.55, H * 0.66, W * 0.5, H * 0.64);
      x.bezierCurveTo(W * 0.45, H * 0.66, W * 0.42, H - 22, W * 0.32, H - 20);
      x.bezierCurveTo(W * 0.14, H - 14, 2, 120, 8, 30);
      x.closePath();
    };
    shape();
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#fbf4e6"); g.addColorStop(1, "#e4d4b6");
    x.fillStyle = g; x.fill();
    x.lineWidth = 6; x.strokeStyle = "#c8b28a"; x.stroke();
    // the eye holes
    x.globalCompositeOperation = "destination-out";
    for (const cx of [W * 0.29, W * 0.71]) {
      x.beginPath(); x.moveTo(cx - 62, H * 0.5);
      x.quadraticCurveTo(cx, H * 0.14, cx + 62, H * 0.47);
      x.quadraticCurveTo(cx, H * 0.78, cx - 62, H * 0.5); x.fill();
    }
    x.globalCompositeOperation = "source-over";
    x.lineWidth = 4; x.strokeStyle = "rgba(160,130,90,.7)";
    for (const cx of [W * 0.29, W * 0.71]) {
      x.beginPath(); x.moveTo(cx - 62, H * 0.5);
      x.quadraticCurveTo(cx, H * 0.14, cx + 62, H * 0.47);
      x.quadraticCurveTo(cx, H * 0.78, cx - 62, H * 0.5); x.stroke();
    }
  });
}
let MASK_GEO = null, MASK_TEX = null;
const maskMat = () => new THREE.MeshLambertMaterial({ map: MASK_TEX ??= maskTexture(), alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0x3a3226 });

// ---------------------------------------------------------------- the room
function buildRoom(scene) {
  const { w, d, h } = ROOM;
  const wood = cTex(256, 256, (x, W, H) => {
    for (let i = 0; i < 8; i++) {
      const k = 0.82 + ((i * 37) % 7) / 30;
      x.fillStyle = `rgb(${Math.round(92 * k)},${Math.round(56 * k)},${Math.round(38 * k)})`; x.fillRect(0, i * H / 8, W, H / 8);
      x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, i * H / 8, W, 2);
      x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(((i * 97) % W), i * H / 8, 2, H / 8);
    }
  });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(5, 5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xffffff, { map: wood })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // a round rug under the table
  const rugT = cTex(256, 256, (x, W) => {
    const g = x.createRadialGradient(W / 2, W / 2, 10, W / 2, W / 2, W / 2);
    g.addColorStop(0, "#7a3b34"); g.addColorStop(0.75, "#6a2e2a"); g.addColorStop(0.8, "#c99a5a"); g.addColorStop(0.84, "#6a2e2a"); g.addColorStop(1, "#5a2622");
    x.fillStyle = g; x.beginPath(); x.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); x.fill();
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(2.0, 48), mat(0xffffff, { map: rugT })); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.004; scene.add(rug);
  // walls: warm plaster above a dark wood wainscot; the ceiling
  const wallM = mat(0x5a3e3a), wainM = mat(0x3a2219), ceilM = mat(0x2a1c1a);
  const wall = (W, x, z, ry) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const up = new THREE.Mesh(new THREE.PlaneGeometry(W, h - 0.9), wallM); up.position.y = 0.9 + (h - 0.9) / 2; g.add(up);
    const lo = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.9), wainM); lo.position.y = 0.45; g.add(lo);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.04), mat(0x4a2c20)); rail.position.set(0, 0.9, 0.02); g.add(rail);
    return g;
  };
  const back = wall(w, 0, -d / 2, 0); wall(w, 0, d / 2, Math.PI); wall(d, -w / 2, 0, Math.PI / 2); const right = wall(d, w / 2, 0, -Math.PI / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilM); ceil.rotation.x = Math.PI / 2; ceil.position.y = h; scene.add(ceil);

  // the window onto the city: night sky, towers, lit windows, a few soft lights
  const city = cTex(512, 512, (x, W, H) => {
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0b0f2a"); g.addColorStop(0.55, "#2a2050"); g.addColorStop(1, "#5a3a5a");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let layer = 0; layer < 2; layer++) {
      for (let bx = -10; bx < W;) {
        const bw = 30 + rnd() * 50, bh = (layer ? 120 : 200) + rnd() * (layer ? 160 : 220);
        x.fillStyle = layer ? "#120f22" : "#1d1834"; x.fillRect(bx, H - bh, bw, bh);
        for (let wy = H - bh + 8; wy < H - 6; wy += 11) for (let wx = bx + 5; wx < bx + bw - 6; wx += 9)
          if (rnd() < (layer ? 0.32 : 0.18)) { x.fillStyle = rnd() < 0.8 ? "rgba(255,206,120,.9)" : "rgba(170,210,255,.8)"; x.fillRect(wx, wy, 4, 5); }
        bx += bw + 2;
      }
    }
    for (let i = 0; i < 18; i++) {
      const bx = rnd() * W, by = H * (0.55 + rnd() * 0.4), r = 6 + rnd() * 14;
      const b = x.createRadialGradient(bx, by, 0, bx, by, r); b.addColorStop(0, "rgba(255,190,120,.55)"); b.addColorStop(1, "rgba(255,190,120,0)");
      x.fillStyle = b; x.fillRect(bx - r, by - r, r * 2, r * 2);
    }
  });
  const win = new THREE.Group(); win.position.set(0, 0, 0.01); back.add(win);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.55), new THREE.MeshBasicMaterial({ map: city, color: 0xc8c0d8, fog: false }));
  glass.position.y = 1.75; win.add(glass);
  const frameM = mat(0x2a1a14);
  for (const [fw, fh, x, y] of [[2.32, 0.07, 0, 2.55], [2.32, 0.07, 0, 0.95], [0.07, 1.62, -1.13, 1.75], [0.07, 1.62, 1.13, 1.75], [0.05, 1.55, 0, 1.75], [2.2, 0.04, 0, 1.85]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.06), frameM); f.position.set(x, y, 0.03); win.add(f);
  }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 0.22), frameM); sill.position.set(0, 0.92, 0.1); win.add(sill);
  // soft curtains each side
  const curtM = mat(0x7a4a4a);
  for (const sx of [-1, 1]) {
    const cg = new THREE.PlaneGeometry(0.6, 2.4, 12, 1), cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 26) * 0.04);
    cg.computeVertexNormals();
    const c = new THREE.Mesh(cg, curtM); c.position.set(sx * 1.45, 1.6, 0.12); win.add(c);
  }
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3.3, 8), mat(0xb08a4a)); rod.rotation.z = Math.PI / 2; rod.position.set(0, 2.82, 0.14); win.add(rod);

  // a bookshelf on the right wall, a small framed picture, a plant in the corner
  const shelf = new THREE.Group(); shelf.position.set(0.6, 0, 0.18); right.add(shelf);
  const shelfM = mat(0x3a2418);
  const sb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.8, 0.32), shelfM); sb.position.y = 0.9; shelf.add(sb);
  const bookCols = [0x8a3a3a, 0x3a5a7a, 0xc8a050, 0x4a6a4a, 0x6a4a7a, 0xd8c8a8, 0x2a3a5a];
  for (let row = 0; row < 3; row++) for (let i = 0, x = -0.56; x < 0.52; i++) {
    const bw = 0.04 + ((i * 7 + row * 3) % 4) * 0.012, bh = 0.24 + ((i * 5 + row) % 3) * 0.04;
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.22), mat(bookCols[(i + row * 2) % bookCols.length])); b.position.set(x + bw / 2, 0.28 + row * 0.55 + bh / 2, 0.06); shelf.add(b);
    x += bw + 0.008;
  }
  const pic = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.04), mat(0x2a1a14)); pic.position.set(-1.6, 1.85, 0.03); right.add(pic);
  const picIn = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.46), mat(0x6a7a8a)); picIn.position.set(-1.6, 1.85, 0.06); right.add(picIn);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.34, 12), mat(0x8a5a3a)); pot.position.set(-2.9, 0.17, -2.9); scene.add(pot);
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(0x3a5a34)); leaf.scale.set(0.6, 1.4, 0.35);
    const a = i / 9 * Math.PI * 2; leaf.position.set(-2.9 + Math.cos(a) * 0.12, 0.6 + (i % 3) * 0.12, -2.9 + Math.sin(a) * 0.12);
    leaf.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5); scene.add(leaf);
  }
  return { dispose: () => { wood.dispose(); rugT.dispose(); city.dispose(); } };
}

// ---------------------------------------------------------------- a stand-in
// (no 3D characters on this page): a rounded figure in the player's colours
function standIn(avatar) {
  const a = normalizeAvatar4(avatar ?? {});
  const skin = rgbHex(SKIN4_RGB[a.skin]), hair = rgbHex(HAIR4_RGB[a.hairColor]), top = rgbHex(ITEMS4[a.top]?.rgb) || 0x6a6a8a;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 6, 14), mat(top)); body.position.y = 0.32; body.scale.z = 0.8; g.add(body);
  const head = new THREE.Group(); head.position.y = 0.78; g.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), mat(skin)));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.137, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair)); cap.rotation.x = -0.25; head.add(cap);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.28, 4, 8), mat(top)); arm.position.set(sx * 0.19, 0.38, 0.14); arm.rotation.x = 1.25; g.add(arm); }
  return { group: g, head, standIn: true, tick() {}, gaze: 0, tilt: 0, dispose() { g.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); } };
}

// ---------------------------------------------------------------- the scene
export async function roundTable(host, { mood = {} } = {}) {
  const st = await retroStage(host, { ...TABLE_MOOD, ...mood });
  const { scene, camera } = st;
  const room = buildRoom(scene);
  // (a soft falloff: a glow, never a disc)
  const dot = softDot([[0, "rgba(255,255,255,1)"], [0.18, "rgba(255,255,255,.45)"], [0.45, "rgba(255,255,255,.12)"], [1, "rgba(255,255,255,0)"]]);
  const glowMat = (color, opacity = 0) => new THREE.SpriteMaterial({ map: dot, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  // ---- the table: a round wooden top, a thick edge, a pedestal and feet
  const T = TABLE;
  const tableWood = mat(0x6a3e26), tableDark = mat(0x4a2a18);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(T.r, T.r, 0.05, 64), tableWood); top.position.y = T.h - 0.025; scene.add(top);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(T.r, 0.022, 8, 64), tableDark); edge.rotation.x = Math.PI / 2; edge.position.y = T.h - 0.03; scene.add(edge);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, T.h - 0.1, 16), tableDark); ped.position.y = (T.h - 0.1) / 2 + 0.05; scene.add(ped);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.09), tableDark); f.position.y = 0.04; f.rotation.y = i * Math.PI / 4 * 2 + Math.PI / 4; scene.add(f); }
  // the lamp's pool of light on the table top
  const pool = new THREE.Mesh(new THREE.CircleGeometry(T.r * 0.95, 48), new THREE.MeshBasicMaterial({ map: dot, color: 0xffc070, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = T.h + 0.002; scene.add(pool);

  // ---- the lamp: low over the table, warm, it breathes a little
  const lamp = new THREE.Group(); lamp.position.set(0, 2.15, 0); scene.add(lamp);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.24, 0.2, 24, 1, true), mat(0x2a1a12, { side: THREE.DoubleSide, emissive: 0x1a0c04 })); lamp.add(shade);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.23, 0.195, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb860, side: THREE.BackSide })); lamp.add(inner);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff0d0 })); bulb.position.y = -0.06; lamp.add(bulb);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, ROOM.h - 2.1, 6), mat(0x111111)); cord.position.y = (ROOM.h - 2.1) / 2 + 0.12; lamp.add(cord);
  const lampLight = new THREE.PointLight(0xffc888, 6.5, 7, 1.6); lampLight.position.set(0, 2.02, 0); scene.add(lampLight);
  const halo = new THREE.Sprite(glowMat(0xffc070, 0.55)); halo.scale.setScalar(0.45); halo.position.set(0, 2.04, 0); scene.add(halo);

  // ---- candles on the table (off the middle, where the card lands)
  const flames = [];
  const waxM = mat(0xf2e6cc, { emissive: 0x3a2a14 });
  for (const [a, r, hgt] of [[0.6, 0.5, 0.14], [2.4, 0.48, 0.1], [4.3, 0.52, 0.17]]) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, hgt, 12), waxM); c.position.set(x, T.h + hgt / 2, z); scene.add(c);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.012, 16), mat(0xb08a4a)); plate.position.set(x, T.h + 0.006, z); scene.add(plate);
    const f = new THREE.Sprite(glowMat(0xffb050, 0.85)); f.position.set(x, T.h + hgt + 0.035, z); f.scale.set(0.05, 0.08, 1); scene.add(f);
    const g = new THREE.Sprite(glowMat(0xff9a40, 0.25)); g.position.copy(f.position); g.scale.setScalar(0.2); scene.add(g);
    flames.push({ f, g, ph: a * 3 });
  }
  const candleLight = new THREE.PointLight(0xff9a50, 0.9, 3, 2); candleLight.position.set(0, T.h + 0.25, 0); scene.add(candleLight);

  // ---- the asked card, face up in the middle of the table
  let cardTex = null;
  const cardM = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a3020, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), cardM); cardMesh.rotation.x = -Math.PI / 2; cardMesh.position.y = T.h + 0.012; scene.add(cardMesh);
  const cardBack = cTex(256, 170, (x, W, H) => { x.fillStyle = "#2a2440"; x.fillRect(0, 0, W, H); x.strokeStyle = "#ffc83d"; x.lineWidth = 6; x.strokeRect(10, 10, W - 20, H - 20); });
  let cardNow = { text: null, at: 0 };
  function drawCard(text, level) {
    cardTex?.dispose();
    cardTex = cTex(1024, 682, (x, W, H) => {
      x.fillStyle = "#f6efe0"; x.fillRect(0, 0, W, H);
      x.strokeStyle = "#c9a45a"; x.lineWidth = 10; x.strokeRect(22, 22, W - 44, H - 44);
      x.fillStyle = "#8a6a3a"; x.font = `700 44px ${FONT}`; x.textAlign = "center"; x.fillText(["", "LIGHT", "REAL", "DEEP"][level] ?? "", W / 2, 96);
      x.fillStyle = "#2a2030";
      let size = 76, lines;
      const wrap = sz => { x.font = `600 ${sz}px ${FONT}`; const out = []; let cur = ""; for (const w of String(text).split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width > W - 140 && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; };
      for (; size > 34; size -= 4) { lines = wrap(size); if (lines.length * size * 1.25 < H - 220) break; }
      const y0 = H / 2 + 30 - (lines.length - 1) * size * 1.25 / 2;
      lines.forEach((l, i) => x.fillText(l, W / 2, y0 + i * size * 1.25));
    });
    cardM.map = cardTex; cardM.needsUpdate = true;
  }

  // ---- the "Same" glows: warm motes rising off the table, one per tap
  const motes = Array.from({ length: 16 }, () => { const s = new THREE.Sprite(glowMat(0xffc070, 0)); s.scale.setScalar(0.12); scene.add(s); return { s, t: 9, x: 0, z: 0 }; });
  let sameN = 0, moteI = 0;
  const rise = () => {
    const m = motes[moteI++ % motes.length], a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.35;
    Object.assign(m, { t: 0, x: Math.cos(a) * r, z: Math.sin(a) * r });
  };

  // ---- the spotlight on whoever is picked, and the gentle "not asked yet" glow
  const spot = new THREE.SpotLight(0xfff0d8, 0, 4, 0.36, 0.7, 1.2); spot.position.set(0, 2.6, 0); scene.add(spot, spot.target);
  const beamM = new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beamG = new THREE.CylinderGeometry(0.03, 0.42, 1, 24, 1, true); beamG.translate(0, -0.5, 0);
  const beam = new THREE.Mesh(beamG, beamM); beam.renderOrder = 5; scene.add(beam);

  // ---- the seats
  const seats = new Map();      // id -> seat
  let me = null, order = [], fpView = null, orbit = null, lifted = 0, ending = false;
  const chairM = mat(0x4a2c1c), chairCush = mat(0x7a4a3a);
  function chair() {
    const g = new THREE.Group();
    const seatB = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.42), chairM); seatB.position.y = T.seatH - 0.03; g.add(seatB);
    const cush = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.38), chairCush); cush.position.y = T.seatH + 0.01; g.add(cush);
    const backB = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.05), chairM); backB.position.set(0, T.seatH + 0.28, -0.2); g.add(backB);
    for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, T.seatH, 0.04), chairM); l.position.set(x, T.seatH / 2, z); g.add(l); }
    return g;
  }
  const hitM = new THREE.MeshBasicMaterial({ visible: false });
  function makeSeat(p) {
    const root = new THREE.Group(); scene.add(root);
    const ch = chair(); root.add(ch);
    const body = new THREE.Group(); body.position.set(0, T.seatH, -0.02); root.add(body);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 10), hitM); hit.position.y = T.seatH + 0.45; root.add(hit);
    const glow = new THREE.Sprite(glowMat(0xffc83d, 0)); glow.scale.set(0.9, 1.1, 1); glow.position.set(0, T.seatH + 0.62, -0.18); root.add(glow);
    const mask = new THREE.Mesh(MASK_GEO ??= maskGeometry(), maskMat()); mask.visible = false; scene.add(mask);
    const S = { id: p.id, name: p.name, avatar: p.avatar, root, body, hit, glow, mask, ch: null, anchor: null, theta: 0,
      off: false, offT: 0, maskFrom: null, gazeAt: 0, gazeId: null, tok: 0 };
    loadChar(S);
    return S;
  }
  async function loadChar(S) {
    const my = ++S.tok;
    let c = null;
    try {
      const A = await import("./avatar4.js");
      if (A.makeCharacter4) { c = await A.makeCharacter4(S.avatar ?? {}); await Promise.race([c.ready ?? Promise.resolve(), new Promise(r => setTimeout(r, 12000))]); }
    } catch (e) { console.warn("[roundtable] a player's character didn't load, a stand-in sits in:", e?.message ?? e); c = null; }
    if (my !== S.tok || !seats.has(S.id)) { c?.dispose?.(); return; }
    if (!c) c = standIn(S.avatar);
    else { c.group.scale.setScalar(CHAR_H / CHAR_UNITS); c.unit = CHAR_H / CHAR_UNITS; c.stance = "chair"; c.tick?.(0); }
    if (S.ch) { S.body.remove(S.ch.group); S.ch.dispose?.(); }
    S.ch = c; S.body.add(c.group);
    anchorMask(S);
    S.mask.visible = S.id !== me;
  }
  // where the mask sits from the head bone (metres, in the character's frame)
  const MASK_AT = { up: 0.13, fwd: 0.17, scale: 1 };
  // the mask's place on the face: in front of the head, at the eyes (it rides the head bone)
  function anchorMask(S) {
    const c = S.ch;
    S.anchor?.parent?.remove(S.anchor);
    S.anchor = new THREE.Object3D();
    if (c.standIn) { S.anchor.position.set(0, 0.015, 0.12); S.anchor.scale.setScalar(0.6); c.head.add(S.anchor); return; }
    const hb = c.head; S.root.updateMatrixWorld(true);
    const hp = new THREE.Vector3(); hb.getWorldPosition(hp);
    const q = new THREE.Quaternion(); S.body.getWorldQuaternion(q);
    const want = new THREE.Matrix4().compose(hp.clone().add(new THREE.Vector3(0, MASK_AT.up, MASK_AT.fwd).applyQuaternion(q)), q, new THREE.Vector3().setScalar(MASK_AT.scale));
    const local = new THREE.Matrix4().copy(hb.matrixWorld).invert().multiply(want);
    local.decompose(S.anchor.position, S.anchor.quaternion, S.anchor.scale);
    hb.add(S.anchor);
  }

  function layout() {
    // round the table, clockwise from above: the next in turn sits on your left
    const n = order.length, mi = Math.max(0, order.indexOf(me));
    order.forEach((id, i) => {
      const S = seats.get(id); if (!S) return;
      const th = -((i - mi) / n) * Math.PI * 2;
      S.theta = th;
      S.root.position.set(Math.sin(th) * T.seatR, 0, Math.cos(th) * T.seatR);
      S.root.rotation.y = th + Math.PI;
      S.root.visible = id !== me;
      S.mask.visible = id !== me && !!S.ch;
    });
    const th = 0;
    // (sitting back in the chair: a phone held upright is narrow, and from
    // there the table and the people either side are in view)
    const eye = [Math.sin(th) * (T.seatR + 0.3), T.eye + 0.24, Math.cos(th) * (T.seatR + 0.3)];
    // (fewer people sit further round to the sides: a wider view to keep them in it)
    const fov = n <= 3 ? 98 : n === 4 ? 92 : 86;
    fpView = firstPerson({ eye, yaw: -th, pitch: -0.36, fov, yawRange: [-1.4, 1.4] });
    orbit?.dispose();
    orbit = orbitCamera(st, fpView, { onTap: (x, y) => tap(x, y) });
  }
  function seat(players, meId) {
    const list = players.slice(0, 64);
    me = meId;
    // more than 8: the table seats you and the next 7 in turn; the rest are in the page's seat bar
    let shown = list;
    if (list.length > T.maxSeats) {
      const mi = Math.max(0, list.findIndex(p => p.id === meId));
      shown = Array.from({ length: T.maxSeats }, (_, k) => list[(mi + k) % list.length]);
    }
    const ids = shown.map(p => p.id);
    for (const [id, S] of seats) if (!ids.includes(id)) { S.tok++; scene.remove(S.root, S.mask); S.ch?.dispose?.(); seats.delete(id); }
    for (const p of shown) if (!seats.has(p.id)) seats.set(p.id, makeSeat(p));
    // keep their table order (the turn order)
    order = list.map(p => p.id).filter(id => ids.includes(id));
    layout();
  }

  // ---- what's going on
  let ST = { asker: null, who: null, picking: false, fresh: [], talker: null, off: [] };
  function state(s) {
    ST = { ...ST, ...s };
    for (const S of seats.values()) {
      const off = ST.off.includes(S.id) || ending;
      if (off !== S.off) { S.off = off; S.offT = performance.now(); }
    }
  }
  function card(text, level = 1) {
    if (!text) { cardNow = { text: null, at: performance.now() }; return; }
    if (text === cardNow.text) return;
    drawCard(text, level); cardNow = { text, at: performance.now() };
  }
  function same(n) {
    if (n > sameN) for (let i = sameN; i < Math.min(n, sameN + 6); i++) setTimeout(rise, (i - sameN) * 180);
    sameN = n;
  }
  const sameReset = () => { sameN = 0; };

  // ---- taps: someone at the table
  const api = { onTap: null };
  function tap(cx, cy) {
    if (ending) return;
    const targets = [...seats.values()].filter(S => S.id !== me).map(S => ({ kind: S.id, objs: [S.hit] }));
    const best = pickTap(st, targets, cx, cy);
    if (best) api.onTap?.(best.kind);
  }

  // ---- every frame
  const v = new THREE.Vector3(), w = new THREE.Vector3(), hq = new THREE.Quaternion();
  const tablePos = (S, k = 0.35) => new THREE.Vector3(Math.sin(S.theta) * (T.r - k), T.h + 0.012, Math.cos(S.theta) * (T.r - k));
  const headOf = S => { const o = S.anchor ?? S.root; o.getWorldPosition(v); return v.clone(); };
  st.onFrame((t, dt) => {
    const still = reduce(), now = performance.now();
    if (!ending) orbit?.update(t, dt);
    // the lamp breathes; the candles flicker
    const lf = still ? 1 : 0.94 + 0.04 * Math.sin(t * 2.1) + 0.02 * Math.sin(t * 7.3);
    lampLight.intensity = 6.5 * lf; halo.material.opacity = 0.5 * lf;
    for (const c of flames) {
      const k = still ? 1 : 0.8 + 0.12 * Math.sin(t * 9 + c.ph) + 0.08 * Math.sin(t * 23 + c.ph * 2);
      c.f.material.opacity = 0.85 * k; c.f.scale.set(0.05, 0.08 * (0.9 + 0.2 * k), 1); c.g.material.opacity = 0.22 * k;
    }
    candleLight.intensity = still ? 0.9 : 0.8 + 0.15 * Math.sin(t * 8.3);
    // the card: flips down onto the table
    const ck = cardNow.text ? Math.min(1, (now - cardNow.at) / 600) : 0;
    cardM.opacity = cardNow.text ? Math.min(1, ck * 3) : Math.max(0, cardM.opacity - dt * 3);
    cardMesh.visible = cardM.opacity > 0.01;
    const e = 1 - Math.pow(1 - ck, 3);
    cardMesh.position.y = T.h + 0.012 + (1 - e) * 0.35;
    cardMesh.rotation.set(-Math.PI / 2 + (1 - e) * Math.PI, 0, (1 - e) * 0.6);
    // the Same motes rise and fade
    for (const m of motes) {
      m.t += dt;
      const k = m.t / 2.4;
      m.s.material.opacity = k < 1 ? Math.sin(k * Math.PI) * 0.9 : 0;
      m.s.position.set(m.x + Math.sin(m.t * 3 + m.x * 9) * 0.03, T.h + 0.1 + k * 1.0, m.z);
      m.s.scale.setScalar(0.1 + k * 0.06);
    }
    // the picked one: a soft spotlight on them; not-yet-asked: a gentle glow
    const picked = ST.who ? seats.get(ST.who) : null;
    const target = picked && picked.id !== me ? picked : null;
    spot.intensity += ((target ? 10 : 0) - spot.intensity) * Math.min(1, dt * 6);
    beamM.opacity += ((target ? 0.035 : 0) - beamM.opacity) * Math.min(1, dt * 6);
    if (target) {
      target.root.getWorldPosition(w); w.y = T.seatH + 0.5;
      spot.target.position.copy(w); spot.position.set(w.x * 0.35, 2.6, w.z * 0.35);
      beam.position.copy(spot.position); beam.scale.set(1, spot.position.distanceTo(w) + 0.3, 1);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), w.clone().sub(spot.position).normalize());
    }
    beam.visible = beamM.opacity > 0.005;
    for (const S of seats.values()) {
      const fresh = ST.picking && ST.fresh.includes(S.id) && S.id !== ST.who;
      const gw = fresh ? 0.28 + (still ? 0 : 0.1 * Math.sin(t * 2.2 + S.theta * 3)) : S.id === ST.who ? 0.5 : 0;
      S.glow.material.opacity += (gw - S.glow.material.opacity) * Math.min(1, dt * 5);
      S.glow.material.color.setHex(S.id === ST.who ? 0xfff0d8 : 0xffc83d);
      if (!S.ch) continue;
      // where they look: whoever's talking, or deciding, now and then someone else
      const talker = ST.talker && ST.talker !== S.id ? ST.talker : null;
      if (now > S.gazeAt) {
        const ids = [...seats.keys(), me].filter(x => x && x !== S.id);
        S.gazeId = talker && Math.random() < 0.75 ? talker : ids[Math.floor(Math.random() * ids.length)];
        S.gazeAt = now + 2200 + Math.random() * 3200;
      }
      let gx = 0, gy = 0;
      if (!still && S.gazeId) {
        const o = S.gazeId === me ? camera.position : seats.get(S.gazeId)?.root.position;
        if (o) {
          S.root.getWorldPosition(w);
          let a = Math.atan2(o.x - w.x, o.z - w.z) - S.root.rotation.y;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          gx = Math.max(-1, Math.min(1, a));
        }
      }
      if (ending) { gx = 0; gy = -0.15; }
      S.ch.gaze = gx; S.ch.tilt = gy;
      if (S.ch.standIn) { S.ch.head.rotation.y += (gx * 0.8 - S.ch.head.rotation.y) * Math.min(1, dt * 3); S.ch.head.position.y = 0.78 + (still ? 0 : Math.sin(t * 1.3 + S.theta) * 0.006); }
      else S.ch.tick?.(t);
      // the mask: on the face, or slid off and lying on the table in front of them
      if (!S.anchor) continue;
      const k = Math.min(1, (now - S.offT) / 900), ek = k * k * (3 - 2 * k);
      S.anchor.updateWorldMatrix(true, false);
      const face = new THREE.Vector3(), fq = new THREE.Quaternion(), fs = new THREE.Vector3();
      S.anchor.matrixWorld.decompose(face, fq, fs);
      S.mask.scale.copy(fs).multiplyScalar(1 + 0.25 * (S.off ? ek : 1 - ek));
      // (on the table it leans back a little, face up, so it reads as a mask from across the room)
      const lay = tablePos(S), lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, S.root.rotation.y + Math.PI, 0, "YXZ"));
      lay.y += 0.05;
      const [from, to, fqa, tqa] = S.off ? [face, lay, fq, lq] : [lay, face, lq, fq];
      const p = from.clone().lerp(to, ek);
      p.y += Math.sin(ek * Math.PI) * (S.off ? 0.18 : 0.12);
      S.mask.position.copy(p);
      S.mask.quaternion.copy(fqa).slerp(tqa, ek);
      if (!S.off && k >= 1) { S.mask.position.copy(face); S.mask.quaternion.copy(fq); }
      if (S.off && k >= 1) { S.mask.position.copy(lay); S.mask.quaternion.copy(lq); }
    }
    // the end: the camera lifts above the table, a slow turn
    if (ending) {
      lifted = Math.min(1, lifted + dt / 2.2);
      const k = lifted * lifted * (3 - 2 * lifted);
      // (high above your seat, looking down over the table, a slow drift: the whole ring in view)
      const a = (still ? 0 : Math.sin(t * 0.08) * 0.25);
      const endPos = new THREE.Vector3(Math.sin(a) * 1.75, 3.45, Math.cos(a) * 1.75);
      camera.position.copy(fpView ? new THREE.Vector3(...fpView.eye) : endPos).lerp(endPos, k);
      camera.lookAt(0, T.h + 0.15 - 0.3 * k, -0.45 * k);
      const want = 78; if (Math.abs(camera.fov - want) > 0.05) { camera.fov += (want - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
    }
  });

  // (where you're looking: getters, so they follow the camera rebuilt by seat())
  Object.defineProperty(api, "view", { get: () => orbit?.view });
  Object.defineProperty(api, "want", { get: () => orbit?.want });
  return Object.assign(api, {
    stage: st, seat, state, card, same, sameReset,
    end(on = true) {
      if (ending === !!on) return;
      ending = !!on; lifted = 0;
      // everyone together, you too (your own seat's character shows as the camera lifts)
      const mine = seats.get(me);
      if (mine) { mine.root.visible = ending; mine.mask.visible = !!mine.ch; }
      for (const S of seats.values()) { S.off = ending || ST.off.includes(S.id); S.offT = performance.now(); }
    },
    home: () => orbit?.home(),
    screen(id) {
      const S = seats.get(id); if (!S || id === me) return null;
      const r = st.canvas.getBoundingClientRect();
      S.root.getWorldPosition(v); v.y = T.seatH + 1.08;
      const ahead = v.clone().sub(camera.position).dot(camera.getWorldDirection(w)) > 0;
      v.project(camera);
      const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
      // off screen: which side to turn to (-1 left, 1 right)
      const side = !ahead ? (v.x > 0 ? -1 : 1) : v.x < -1 ? -1 : v.x > 1 ? 1 : 0;
      return { x, y, visible: ahead && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05, side };
    },
    // tests: everyone at the table, their masks, the card
    info: () => ({ seated: [...seats.keys()], me, chars: [...seats.values()].filter(S => S.ch).length, standIns: [...seats.values()].filter(S => S.ch?.standIn).length,
      off: [...seats.values()].filter(S => S.off).map(S => S.id), masks: [...seats.values()].filter(S => S.mask.visible).length, card: cardNow.text, who: ST.who, spot: +spot.intensity.toFixed(2), same: sameN, ending }),
    attach: el => st.attach(el),
    debug: { seats, camera, MASK_AT, reanchor: () => { for (const S of seats.values()) if (S.ch) anchorMask(S); }, stopOrbit: () => { orbit?.dispose(); orbit = null; } },
    dispose() { orbit?.dispose(); room.dispose(); for (const S of seats.values()) S.ch?.dispose?.(); seats.clear(); cardTex?.dispose(); cardBack.dispose(); dot.dispose(); st.dispose(); },
  });
}
