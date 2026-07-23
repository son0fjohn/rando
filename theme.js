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

  // world material tints (multiplied over the baked textures)
  world: {
    grassDay:   0xdfe8e2, grassNight:  0x55687c,
    pavingDay:  0xe8edf0, pavingNight: 0x747f99,
    roadDay:    0xcdd5dd, roadNight:   0x848da3,
    curbDay:    0xe0e4e7, curbNight:   0x99a1b4,
  },
};
