// Rando visual theme — single locked source of truth for color + shading,
// matched to the muted-futuristic reference (pale mint, soft white, dusty
// blue, restrained accents; soft gradient/specular shading; cool ambient
// ground light). Anything added later should pull from here so the look
// stays consistent automatically.

export const THEME = {
  // character body palette. KEYS ARE FROZEN (saved avatar configs point at
  // them) — only the hex values move with the theme.
  body: {
    white:   "#f2f4f3", // soft white
    black:   "#4b5158", // slate (softened from pure black)
    grey:    "#c3c9cc", // pale grey
    navy:    "#6e86aa", // dusty blue
    skyblue: "#aacfdf", // powder blue
    green:   "#bcd9ca", // pale mint
    orange:  "#e6c8a8", // soft apricot
    pink:    "#e3c2cb", // muted pink
    purple:  "#b7add0", // soft lavender
    red:     "#d69c96", // dusty rose
  },

  // soft-gloss shading for the PBR character models
  character: {
    roughness: 0.38,
    envMapIntensity: 1.15,
  },

  // world material tints (multiplied over the baked textures). Style lock:
  // warm, slightly desaturated (grocery-street reference) — greys lean
  // cream/tan rather than blue.
  world: {
    grassDay:   0xe6e6d4, grassNight:  0x49536b,
    pavingDay:  0xefeae0, pavingNight: 0x6a7390,
    roadDay:    0xd8d3c8, roadNight:   0xbcc3dc,
    curbDay:    0xe7e2d8, curbNight:   0xaab0c6,
  },

  // ONE lighting rig for every scene (world, world2, previews), anchored
  // to the grocery-street reference (rando avatar v2/world reference):
  // strong warm sun with real cast shadows, warm bounce, cream haze
  lighting: {
    day: {
      hemiSky: 0xfff0d6, hemiGround: 0x9b8f7a, hemiInt: 0.95,
      sunCol: 0xffdfae, sunInt: 1.45, fog: 0xe9dcc3,
    },
    night: {
      // blue moonlight bright enough that textures stay readable
      hemiSky: 0x5b6fa0, hemiGround: 0x2e3048, hemiInt: 0.9,
      sunCol: 0xaec6ee, sunInt: 0.65, fog: 0x2a3452,
    },
  },

  // auto-generated building walls: warm desaturated family
  walls: [0xf2efe7, 0xe8e2d4, 0xdcd5c5, 0xe6dccb, 0xebdfd6, 0xd6cfc3],
};
