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
    grassDay:   0xe6e6d4, grassNight:  0x5c6472,
    pavingDay:  0xefeae0, pavingNight: 0x7b7d90,
    roadDay:    0xd8d3c8, roadNight:   0x8b8c9d,
    curbDay:    0xe7e2d8, curbNight:   0x9c9daf,
  },

  // ONE lighting rig for every scene (world, world2, previews): warm key
  // sun + warm-sky/-earth hemisphere by day, cool moonlight by night
  lighting: {
    day: {
      hemiSky: 0xfff3dd, hemiGround: 0xb0a690, hemiInt: 1.08,
      sunCol: 0xffe9c2, sunInt: 1.2, fog: 0xe9e4d6,
    },
    night: {
      hemiSky: 0x4a5f8a, hemiGround: 0x272536, hemiInt: 0.72,
      sunCol: 0xa8c2e8, sunInt: 0.5, fog: 0x232c45,
    },
  },

  // auto-generated building walls: warm desaturated family
  walls: [0xf2efe7, 0xe8e2d4, 0xdcd5c5, 0xe6dccb, 0xebdfd6, 0xd6cfc3],
};
