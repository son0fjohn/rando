// The avatar4 wardrobe: every item, its slot, file, what it hides on the
// body, how it tints, and whether it's free or in the shop (rarity, price).
// Prices are labels: buying goes through buy_item() in SQL.
export const HAIR4_RGB = {
  black: [40, 38, 44], darkbrown: [78, 54, 42], lightbrown: [150, 110, 76], platinum: [232, 226, 214],
  blonde: [236, 196, 112], red: [196, 66, 52], pink: [240, 150, 186], mint: [150, 222, 196],
  navy: [44, 58, 112], purple: [130, 88, 186],
};
// key color in each hair texture (its mean); the shader moves the whole
// texture to HAIR4_RGB, keeping its light and dark
const hairTint = key => cfg => [[key, HAIR4_RGB[cfg.hairColor] ?? HAIR4_RGB.black]];

export const RARITY4 = { common: { glow: "#9fb4d8" }, rare: { glow: "#5fb8ff" }, epic: { glow: "#c77dff" } };

// hides: tee / shorts (the underlayer regions), arms, legs, below / above
// (rest-pose heights, base height 1). hairCut: a hat clips hair above it.
// scalp: the head under the hair takes the hair colour.
export const ITEMS4 = {
  "middle-part": { cat: "hair", name: "Messy middle part", file: "hair_middlepart.glb", doubleSide: true, scalp: true,
    tint: hairTint([107, 78, 63]), rarity: "common", price: 0 },
  "sweat-babyblue": { cat: "top", name: "Baby blue sweatshirt", file: "top_sweat_babyblue.glb", hides: { tee: 1, arms: 1 }, doubleSide: true,
    tint: [[[160, 177, 195], [172, 206, 246]]], rarity: "common", price: 0 },
  "skate-blue": { cat: "shoes", name: "Chunky skate shoes", file: "shoes_skate_blue.glb", hides: { below: 0.085 }, doubleSide: true,
    rarity: "common", price: 0 },
};
