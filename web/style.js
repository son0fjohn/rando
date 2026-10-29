// The Itaewon style as numbers: assets/world/STYLE.md in code. The
// procedural city (citygen.js in the worker, citytiles.js on the page)
// draws from these and nothing else, and the specs read them too. No
// three.js here. Units: world units; 1 m = 0.55 u across, building heights
// 1 m = 1.32 u (× 2.4). Colours are sRGB hex.
export const STYLE = {
  SCALE: 0.55,            // world units per metre
  VEXAG: 2.4,             // building heights, up to KNEE_M
  KNEE_M: 50,             // above this a metre adds less (towers)
  ABOVE_KNEE: 1.45,
  LEVEL_M: 3.2,           // a floor, when only floors are known

  // 5.3 walls: six creams for every class, by position; roofs are the wall × 0.8
  walls: [0xf2efe7, 0xe8e2d4, 0xdcd5c5, 0xe6dccb, 0xebdfd6, 0xd6cfc3],
  roofMul: 0.8,
  // 2 night: everything lit is multiplied by the moonlight
  moon: [0.36, 0.42, 0.60],

  // 5.2 facade classes, and 5.4 their window tiles (13 × 10.4 u, cells across × up)
  classes: ["mixed", "shop", "office", "res"],
  tile: { u: 13, v: 10.4 },
  cells: { mixed: [4, 4], shop: [4, 3], office: [5, 5], res: [3, 3] },
  wallField: "#ffffff", glass: "#59606c", glassBand: "rgba(255,255,255,0.3)",
  shop: { storefront: "#4a5666", signBand: "#9aa0a8" },
  res: { rail: "#7d8288" },
  // 5.5 lit windows: six variants, cycling with the wall colour
  lit: [
    { p: 0.20, w: 0.85, e: 0.92 }, { p: 0.10, w: 0.55, e: 0.78 },
    { p: 0.05, w: 0.75, e: 0.72 }, { p: 0.15, w: 0.95, e: 0.95 },
    { p: 0.08, w: 0.35, e: 0.80 }, { p: 0.13, w: 0.70, e: 0.86 },
  ],
  warm: [0xffd98f, 0xffc76a, 0xffe7b0],
  cool: [0xc8ddff, 0xaecbf2, 0xdfe9ff],
  nightField: "rgba(9,12,20,0.86)",

  // 5.6 outlines and the baked shadow
  outline: { day: 0x6b675e, night: 0x39435c, opacity: 0.5 },
  shadow: { color: 0x241c12, opacity: 0.32, y: 0.5, dir: [-0.52, 0.34], kMax: 52, k0: 6, kPerU: 0.95 },

  // 4 roads (Itaewon draws streets about 1.6× their real width)
  roads: {
    primary: 24, motorway: 24, trunk: 24, secondary: 19, tertiary: 15,
    residential: 11, unclassified: 11, living_street: 9, service: 7, track: 7,
    pedestrian: 8, footway: 4, path: 4, cycleway: 4, steps: 4,
  },
  roadRepeat: 26,         // the asphalt strip repeats every 26 u along
  grassRepeat: 79,        // one mirrored block of the lawn tile
  pavingRepeat: 80,

  // 5.7 on and around each building
  ac: { chance: 2 / 3, size: [2.0, 1.3, 1.6], day: 0xb9bcc0, night: 0x5a5f6a, minArea: 9 },
  awning: { chance: 0.6, maxLen: 24, lenMul: 0.86, size: [0.45, 3.1], pitch: 0.24, y: 6.8, out: 1.5, roadWithin: 45,
    colors: [0x4f9d8f, 0xc95f4e, 0xd9a83c, 0xe8e2d4], nightMul: 0.5 },
  panel: { chance: 0.55, minH: 12, size: [0.35, 3.6, 2.1], y0: 9.5, out: 0.4,
    colors: [0x3f8f82, 0xd97b3c, 0xe0c33a, 0xba4a44, 0x5a7fa8], nightMul: 0.65, glow: 0.28 },
  clutter: { chance: 0.1, binShare: 0.6, bin: { r: [1.0, 0.9], h: 2.4, day: 0x4c6a80, night: 0x3a4a62 },
    cone: { r: 0.7, h: 1.7, day: 0xe07b35, night: 0x8a4a20 } },

  // 5.8 along the roads
  pole: { minRoad: 11, spacing: 80, out: 2.2, r: [0.32, 0.40], h: 23, day: 0x5d564c, night: 0x2c2a26, maxPerChunk: 8,
    wireY: [22.2, 20.6], sag: 2.6, segs: 7, maxSpan: 130, wire: 0x2f2b26, wireOpacity: 0.75,
    lampEvery: 3, lampY: 21.8, lampR: 1.15, lampDay: 0xf2ead8, lampNight: 0xfff0c0, lampGlow: 0xffd685, lampGlowK: 1.3,
    poolR: 9, pool: 0xffb95e, poolOpacity: 0.14,
    lanternEvery: 3, lanternR: 0.95, lanternTall: 1.25, lanternDrop: 1.4, lanternDay: 0xf4e4c8, lanternNight: 0xffe2a0, lanternGlow: 0xffc96e, lanternGlowK: 1.5 },
  lamp: { minRoad: 8, spacing: 25, out: 2.2, post: [0.34, 6.8, 0.34], head: [0.95, 0.5, 0.95], headY: 6.9, maxPerChunk: 40,
    postDay: 0x6d7076, postNight: 0x3c4356, headColor: 0xd8cba8, headGlow: 0xffc87d, headGlowK: 1.0 },

  // 5.9 trees: the painted models, sparse
  tree: { glb: "world2/tree_green.glb", h: 22, palm: "world2/tree_palm.glb", palmH: 26, palmShare: 0.07,
    scale: [0.85, 1.3], step: 40, forestStep: 30, maxNear: 12, maxFar: 4, desaturate: 0.8, night: 0x76879c },
};

// 5.1 height in world units from metres: linear to the knee, gentler above
export function worldHeight(m) {
  const { SCALE, VEXAG, KNEE_M, ABOVE_KNEE } = STYLE;
  return m <= KNEE_M ? m * SCALE * VEXAG : (KNEE_M * VEXAG + (m - KNEE_M) * ABOVE_KNEE) * SCALE;
}

// 5.2 the facade class from what the data has: floors, footprint area
// (world u²), whether the lot fronts a main road
export function styleClass({ floors, area, main }) {
  if (floors >= 6) return "office";
  if (main && floors <= 4) return "shop";
  if (floors <= 2 && area < 55) return "res";
  return "mixed";
}

// 5.1 floors when the data has none: by class prior, then by area, jittered by seed
export const GUESS_FLOORS = { res: 2, shop: 3, mixed: 4, office: 8 };

export const wallIndex = (cx, cz) => Math.abs(Math.round(cx * 7 + cz * 13)) % STYLE.walls.length;
