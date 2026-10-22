// The party room's art, drawn in code: a bare late-night lo-fi apartment in
// 3/4 top-down pixel art. 176x300 art pixels (the room's backdrop units are
// 4 per art pixel, so 704x1200 — see roomdefs.js `apartment`).
//
// Layers, bottom to top (hplobby.js stacks them):
//   background   walls, floor planks, baseboard; flat things on the floor
//                (rug, cushion) are drawn into it from their slots
//   window       the big back window: night city, lit windows, neon signs —
//                its own canvas, animated (windows flick on and off, neon buzz)
//   light        moonlight / neon spill on the floor and the lamp's pool,
//                blended over the floor
//   furniture    standing pieces (CRT TV, lamp) as their own sprites, depth
//                sorted with the people by where they meet the floor
//   characters   (hplobby.js)
//   foreground   the front wall's top edge and a soft vignette
//
// Furniture lives in named SLOTS (roomdefs.js); each slot names an ITEM from
// the catalog below, so a future "customize your room" only swaps item ids.
// The vibe only tints the neon.
export const ART_W = 176, ART_H = 300;

export const NEON = {
  chill: { a: "#4de8c8", b: "#a98bff", sky: ["#0b0a26", "#16123f", "#25185a"] },
  chaotic: { a: "#ff5d8a", b: "#ffc84d", sky: ["#14081f", "#2a0f3a", "#3f1446"] },
  sporty: { a: "#7dff5e", b: "#4da6ff", sky: ["#071622", "#0d2440", "#123257"] },
};
const neonFor = vibe => NEON[vibe] ?? NEON.chill;

// geometry, in art pixels
export const GEO = {
  wallTop: 8, wallBot: 92, floorTop: 94, floorBot: 292, side: 6,
  window: { x: 18, y: 15, w: 140, h: 64 },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.imageSmoothingEnabled = false; return [c, g]; }
const R = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

// ---------------------------------------------------------------- items
// each: { w, h, draw(g, vibe) } in art pixels; `flat` items go into the
// background, the rest stand in the room as sprites
export const ITEMS = {
  crt: {
    w: 34, h: 36, draw(g, vibe) {
      const n = neonFor(vibe);
      // low stand
      R(g, "#2a1e33", 1, 27, 32, 7); R(g, "#3d2c48", 1, 27, 32, 2); R(g, "#1a1222", 3, 34, 4, 2); R(g, "#1a1222", 27, 34, 4, 2);
      R(g, "#1a1222", 4, 30, 26, 1);
      // the set: chunky grey box
      R(g, "#0d0b1e", 3, 4, 28, 24); R(g, "#7d82a3", 4, 5, 26, 22); R(g, "#9aa0c2", 4, 5, 26, 2); R(g, "#5b5f80", 4, 25, 26, 2);
      // screen
      R(g, "#0d0b1e", 6, 7, 18, 15); R(g, "#123a40", 7, 8, 16, 13);
      for (let y = 9; y < 21; y += 2) R(g, "#16484f", 7, y, 16, 1);
      R(g, n.a, 9, 11, 6, 1); R(g, n.a, 9, 13, 10, 1); R(g, n.b, 9, 15, 4, 1); R(g, "#cffff5", 8, 9, 3, 1);
      // knobs + grille
      R(g, "#ff5d8a", 26, 9, 2, 2); R(g, "#ffc84d", 26, 13, 2, 2); R(g, "#3b3e58", 25, 17, 4, 1); R(g, "#3b3e58", 25, 19, 4, 1);
      // antenna
      R(g, "#0d0b1e", 12, 1, 1, 3); R(g, "#0d0b1e", 11, 0, 1, 1); R(g, "#0d0b1e", 21, 1, 1, 3); R(g, "#0d0b1e", 22, 0, 1, 1); R(g, "#0d0b1e", 13, 3, 8, 1);
    },
  },
  lamp: {
    w: 16, h: 54, draw(g) {
      R(g, "#0d0b1e", 3, 0, 10, 1); R(g, "#ffe3a3", 2, 1, 12, 9); R(g, "#ffd27a", 2, 6, 12, 4); R(g, "#c9954a", 2, 9, 12, 1); R(g, "#fff2cf", 4, 2, 3, 3);
      R(g, "#26213f", 7, 10, 2, 40); R(g, "#3a3560", 7, 10, 1, 40);
      R(g, "#0d0b1e", 3, 50, 10, 3); R(g, "#2a2547", 4, 50, 8, 1);
    },
  },
  rug: {
    w: 96, h: 50, flat: true, draw(g, vibe) {
      const n = neonFor(vibe);
      // a round-cornered woven rug
      R(g, "#2a1430", 4, 0, 88, 50); R(g, "#2a1430", 0, 4, 96, 42); R(g, "#2a1430", 2, 2, 92, 46);
      R(g, "#5a2a5c", 5, 4, 86, 42); R(g, "#5a2a5c", 3, 6, 90, 38);
      R(g, "#7a3a72", 9, 8, 78, 34);
      for (let x = 12; x < 84; x += 8) for (let y = 11; y < 39; y += 8) { R(g, "#943f84", x, y, 4, 4); R(g, "#5a2a5c", x + 1, y + 1, 2, 2); }
      R(g, n.b, 9, 8, 78, 1); R(g, n.b, 9, 41, 78, 1);
      for (let x = 2; x < 94; x += 4) { R(g, "#d8c7a0", x, 48, 2, 2); }   // fringe
    },
  },
  cushion: {
    w: 22, h: 14, flat: true, draw(g) {
      R(g, "#5c1f3a", 1, 3, 20, 11); R(g, "#ff8fab", 1, 1, 20, 10); R(g, "#ffb3c6", 2, 1, 18, 2); R(g, "#d9637f", 1, 9, 20, 2);
      R(g, "#5c1f3a", 0, 2, 1, 9); R(g, "#5c1f3a", 21, 2, 1, 9); R(g, "#b34a68", 10, 5, 2, 2);
    },
  },
};

export function itemSprite(id, vibe) {
  const it = ITEMS[id]; if (!it) return null;
  const [c, g] = canvas(it.w, it.h);
  it.draw(g, vibe);
  return { url: c.toDataURL(), w: it.w, h: it.h };
}

// ---------------------------------------------------------------- background
export function paintBackground(vibe, slots = {}) {
  const [c, g] = canvas(ART_W, ART_H);
  const { wallTop, wallBot, floorTop, floorBot, side } = GEO;
  // ceiling shadow + back wall
  R(g, "#0a0818", 0, 0, ART_W, ART_H);
  R(g, "#1b1838", 0, wallTop, ART_W, wallBot - wallTop);
  for (let y = wallTop; y < wallBot; y += 6) R(g, "#1e1a3e", 0, y, ART_W, 3);          // faint wallpaper stripe
  R(g, "#0d0b1e", 0, wallTop, ART_W, 2);
  // baseboard
  R(g, "#120f26", 0, wallBot - 2, ART_W, 4); R(g, "#2a2552", 0, wallBot - 2, ART_W, 1);
  // floor: warm wooden planks running away from you, staggered joints
  const r = rng(7);
  const plank = ["#5a3c4a", "#61424f", "#553846", "#5e3f4c", "#684855"];
  const PW = 9;
  for (let x = side, col = 0; x < ART_W - side; x += PW, col++) {
    let y = floorTop - Math.floor(r() * 40);
    while (y < floorBot) {
      const len = 34 + Math.floor(r() * 40);
      R(g, plank[Math.floor(r() * plank.length)], x, y, PW, len);
      R(g, "#74545f", x, y, 1, len);                     // lit edge
      R(g, "#3a2632", x + PW - 1, y, 1, len);            // gap
      R(g, "#3a2632", x, y + len - 1, PW, 1);            // joint
      for (let k = 0; k < 2; k++) if (r() < 0.6) R(g, "#4f3542", x + 2 + Math.floor(r() * (PW - 4)), y + 3 + Math.floor(r() * (len - 8)), 1, 3 + Math.floor(r() * 5));   // grain
      y += len;
    }
  }
  R(g, "#120f26", 0, floorTop, ART_W, 1);
  // side walls (thin, 3/4 view)
  for (const x0 of [0, ART_W - side]) {
    R(g, "#14112c", x0, wallTop, side, floorBot - wallTop);
    R(g, "#221e48", x0 === 0 ? side - 1 : x0, wallTop, 1, floorBot - wallTop);
  }
  // floor gets darker toward the front corners
  const vg = g.createRadialGradient(ART_W / 2, 150, 40, ART_W / 2, 170, 190);
  vg.addColorStop(0, "rgba(10,8,24,0)"); vg.addColorStop(1, "rgba(10,8,24,.55)");
  g.fillStyle = vg; g.fillRect(side, floorTop, ART_W - side * 2, floorBot - floorTop);
  // window recess (the city canvas sits on top of it)
  const W = GEO.window;
  R(g, "#0d0b1e", W.x - 3, W.y - 3, W.w + 6, W.h + 6);
  R(g, "#3a3570", W.x - 4, W.y + W.h + 2, W.w + 8, 3); R(g, "#4e489a", W.x - 4, W.y + W.h + 2, W.w + 8, 1);   // sill
  // flat furniture from its slots
  for (const s of Object.values(slots)) {
    const it = ITEMS[s.item];
    if (!it?.flat) continue;
    const [ic, ig] = canvas(it.w, it.h);
    it.draw(ig, vibe);
    g.drawImage(ic, Math.round(s.x - it.w / 2), Math.round(s.y - it.h));
  }
  return c.toDataURL();
}

// ---------------------------------------------------------------- window
// the night city through the glass; call frame(t) to animate it
export function windowArt(vibe) {
  const W = GEO.window, n = neonFor(vibe);
  const [c, g] = canvas(W.w, W.h);
  const r = rng(11);
  // buildings: far row then near row, each with a grid of windows
  const far = [], near = [];
  for (let x = 0; x < W.w;) { const w = 8 + Math.floor(r() * 12), h = 20 + Math.floor(r() * 26); far.push({ x, w, h }); x += w + 1; }
  for (let x = -4; x < W.w;) { const w = 12 + Math.floor(r() * 16), h = 14 + Math.floor(r() * 30); near.push({ x, w, h }); x += w + 2 + Math.floor(r() * 3); }
  const lights = [];
  for (const b of [...far, ...near]) for (let y = W.h - b.h + 3; y < W.h - 2; y += 3) for (let x = b.x + 2; x < b.x + b.w - 1; x += 3) {
    if (r() < 0.55) lights.push({ x, y, near: near.includes(b), c: r() < 0.7 ? "#ffd27a" : r() < 0.5 ? "#ff9ec4" : "#8ff3ff", on: r() < 0.8 });
  }
  const signs = [
    { x: (near[1]?.x ?? 18) + 2, y: W.h - (near[1]?.h ?? 30) + 4, w: 12, h: 3, c: n.a },
    { x: (near[3]?.x ?? 66) + 3, y: W.h - (near[3]?.h ?? 30) + 5, w: 3, h: 12, c: n.b },
    { x: (near[5]?.x ?? 104) + 2, y: W.h - (near[5]?.h ?? 30) + 3, w: 10, h: 3, c: n.a },
    { x: (near[7]?.x ?? 126) + 2, y: W.h - (near[7]?.h ?? 30) + 8, w: 3, h: 8, c: "#ffc84d" },
  ];
  const stars = Array.from({ length: 16 }, () => ({ x: Math.floor(r() * W.w), y: Math.floor(r() * 18) }));
  let tick = 0;
  function frame() {
    tick++;
    // sky bands, dithered
    const [s0, s1, s2] = n.sky;
    R(g, s0, 0, 0, W.w, W.h);
    R(g, s1, 0, 22, W.w, W.h); R(g, s2, 0, 40, W.w, W.h);
    for (let x = 0; x < W.w; x += 2) { R(g, s1, x + (tick & 0 ? 1 : 0), 21, 1, 1); R(g, s2, x + 1, 39, 1, 1); }
    for (const s of stars) if ((s.x + tick) % 23) R(g, "#cfd3ff", s.x, s.y, 1, 1);
    R(g, "#f4f0d8", 112, 6, 7, 7); R(g, s0, 116, 5, 5, 5);          // a crescent moon
    g.globalAlpha = 0.35; R(g, n.b, 0, W.h - 26, W.w, 26); g.globalAlpha = 0.25; R(g, n.a, 0, W.h - 14, W.w, 14); g.globalAlpha = 1;
    for (const b of far) R(g, "#120f2c", b.x, W.h - b.h - 6, b.w, b.h + 6);
    for (const b of near) R(g, "#1c1840", b.x, W.h - b.h, b.w, b.h);
    // windows flick on and off now and then
    if (tick % 3 === 0) { const L = lights[Math.floor(r() * lights.length)]; if (L) L.on = !L.on; }
    for (const L of lights) if (L.on) R(g, L.near ? L.c : "#7c6a8f", L.x, L.y, L.near ? 2 : 1, 1);
    // neon signs buzz
    signs.forEach((s, i) => { if ((tick + i * 7) % 29 > 1) { R(g, s.c, s.x, s.y, s.w, s.h); g.globalAlpha = 0.25; R(g, s.c, s.x - 1, s.y - 1, s.w + 2, s.h + 2); g.globalAlpha = 1; } });
    // glass: mullion, transom, a soft glare line
    R(g, "#0d0b1e", W.w / 2 - 1, 0, 2, W.h); R(g, "#0d0b1e", 0, 30, W.w, 2);
    g.globalAlpha = 0.18; for (let i = 0; i < 18; i++) R(g, "#ffffff", 8 + i, 26 - i, 1, 1); for (let i = 0; i < 10; i++) R(g, "#ffffff", 80 + i, 58 - i, 1, 1); g.globalAlpha = 1;
  }
  frame();
  return { canvas: c, frame };
}

// ---------------------------------------------------------------- light + foreground
// neon/moon spill through the window onto the floor, and the lamp's pool
export function paintLight(vibe, lampAt) {
  const [c, g] = canvas(ART_W, ART_H), n = neonFor(vibe), W = GEO.window;
  g.globalAlpha = 0.16; g.fillStyle = n.a;
  g.beginPath(); g.moveTo(W.x + 6, GEO.floorTop); g.lineTo(W.x + W.w / 2 - 4, GEO.floorTop); g.lineTo(W.x + W.w / 2 + 14, 210); g.lineTo(W.x + 2, 210); g.fill();
  g.fillStyle = n.b;
  g.beginPath(); g.moveTo(W.x + W.w / 2 + 4, GEO.floorTop); g.lineTo(W.x + W.w - 6, GEO.floorTop); g.lineTo(W.x + W.w + 6, 210); g.lineTo(W.x + W.w / 2 + 22, 210); g.fill();
  g.globalAlpha = 1;
  if (lampAt) {
    const lg = g.createRadialGradient(lampAt.x, lampAt.y, 2, lampAt.x, lampAt.y, 46);
    lg.addColorStop(0, "rgba(255,210,122,.42)"); lg.addColorStop(1, "rgba(255,210,122,0)");
    g.fillStyle = lg; g.fillRect(lampAt.x - 50, lampAt.y - 50, 100, 100);
  }
  return c.toDataURL();
}
export function paintForeground() {
  const [c, g] = canvas(ART_W, ART_H);
  R(g, "#0a0818", 0, GEO.floorBot, ART_W, ART_H - GEO.floorBot);
  R(g, "#221e48", 0, GEO.floorBot, ART_W, 1);
  return c.toDataURL();
}
