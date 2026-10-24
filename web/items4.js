// The avatar4 wardrobe: every look option, every item (its slot, file, what
// it hides on the body, how it tints), free vs shop (rarity, price) and the
// six starter outfits. No three.js here, so bots, tests and the shop logic
// can read it. Prices and rarity are LABELS: the shop's real prices live in
// SQL (shop_items, migrations/016) and buying goes through buy_item().

// light -> deep
export const SKIN4_RGB = {
  1: [250, 224, 204], 2: [242, 204, 176], 3: [228, 182, 146], 4: [204, 152, 112],
  5: [176, 122, 86], 6: [144, 94, 64], 7: [108, 70, 48], 8: [74, 50, 36],
};
export const HAIR4_RGB = {
  black: [40, 38, 44], darkbrown: [78, 54, 42], lightbrown: [150, 110, 76], platinum: [232, 226, 214],
  blonde: [236, 196, 112], red: [196, 66, 52], pink: [240, 150, 186], mint: [150, 222, 196],
  navy: [44, 58, 112], purple: [130, 88, 186],
};
export const IRIS4 = {
  lightblue: [126, 176, 222], brown: [120, 84, 60], black: [44, 40, 44], green: [92, 150, 96],
  gray: [128, 126, 124], amber: [200, 140, 52], violet: [146, 108, 200], pink: [222, 128, 168],
};
export const EYE_SHAPES = ["sharp", "round", "sleepy", "narrow", "sparkly", "tired", "cat", "droopy"];
export const EYE_NAMES = { sharp: "Sharp", round: "Round", sleepy: "Sleepy", narrow: "Narrow", sparkly: "Sparkly", tired: "Tired", cat: "Cat-eye", droopy: "Soft" };
export const EMOTES4 = ["anger", "zzz", "hearts", "spiral", "sparkles", "sweat", "question", "exclaim"];

export const RARITY4 = { common: { glow: "#9fb4d8" }, rare: { glow: "#5fb8ff" }, epic: { glow: "#c77dff" } };
// shop tiers: label prices (SQL holds the real ones)
const RARE = { rarity: "rare", price: 80 }, EPIC = { rarity: "epic", price: 150 };

// whole-texture tint (hair): every pixel moves to the colour, keeping its light and dark
const hairTint = key => cfg => [[key, HAIR4_RGB[cfg.hairColor] ?? HAIR4_RGB.black]];
// a key colour moved to a variant colour (one mesh, many colours)
const recolor = (key, to) => [[key, to]];

// cat: hair | head | face | top | bottom | shoes | neck
// file: avatar4/items/<file> (a glb skinned to the base's joints); code: drawn in code
// hides: tee / shorts (underlayer regions), arms, legs, below / above (rest heights, base height 1)
// hairCut (head): hair above this height is clipped under the hat
// hidesHair (head): hairstyles that would poke through it aren't drawn under it
// group: items that are colour variants of one mesh (shown as swatches)
// scalp (hair): the head under the hair takes the hair colour; scalp: [rgb] (hats): the head under it takes that
const I = (cat, name, more) => ({ cat, name, rarity: "common", price: 0, doubleSide: true, ...more });
export const ITEMS4 = {
  // ---- hair (14), tinted to the 10 hair colours
  "middle-part": I("hair", "Messy middle part", { file: "hair_middlepart.glb", tint: hairTint([107, 78, 63]), scalp: true }),
  "buzz": I("hair", "Buzz cut", { file: "hair_buzz.glb", tint: hairTint([82, 63, 56]), scalp: true }),
  "bowl": I("hair", "Bowl cut", { file: "hair_bowl.glb", tint: hairTint([16, 15, 15]), scalp: true }),
  "twists": I("hair", "Short twists", { file: "hair_twists.glb", tint: hairTint([18, 15, 13]), scalp: true }),
  "slicked": I("hair", "Slicked back", { file: "hair_slicked.glb", tint: hairTint([63, 43, 13]), scalp: true }),
  "bob": I("hair", "Bob", { file: "hair_bob.glb", tint: hairTint([18, 13, 9]), scalp: true }),
  "locs": I("hair", "Locs", { file: "hair_locs.glb", tint: hairTint([18, 13, 11]), scalp: true }),
  "long-bangs": I("hair", "Long with bangs", { file: "hair_long_bangs.glb", tint: hairTint([51, 21, 21]), scalp: true }),
  "twin-buns": I("hair", "Twin buns", { file: "hair_twinbuns.glb", tint: hairTint([59, 21, 14]), scalp: true }),
  "wolf": I("hair", "Wolf cut", { file: "hair_wolf.glb", tint: hairTint([43, 22, 10]), scalp: true, ...RARE }),
  "pigtails": I("hair", "Pigtails", { file: "hair_pigtails.glb", tint: hairTint([163, 120, 99]), scalp: true, ...RARE }),
  "ponytail": I("hair", "High ponytail", { file: "hair_ponytail.glb", tint: hairTint([53, 23, 8]), scalp: true, ...RARE }),
  "spiky": I("hair", "Spiky bleached tips", { file: "hair_spiky.glb", tint: hairTint([132, 115, 90]), scalp: true, ...EPIC }),
  "afro-puff": I("hair", "High puff", { file: "hair_afro.glb", tint: hairTint([8, 5, 4]), scalp: true, ...EPIC }),
  // ---- headwear (10)
  "beanie-phones": I("head", "Beanie + headphones", { file: "head_beanie_phones.glb", scalp: [105, 105, 117], hairCut: 0.9 }),
  "beanie-goggles": I("head", "Goggles on beanie", { file: "head_beanie_goggles.glb", scalp: [40, 38, 43], hairCut: 0.9 }),
  "durag": I("head", "Durag", { file: "head_durag.glb", scalp: [24, 22, 24], hairCut: 0.88 }),
  "bucket": I("head", "Bucket hat", { file: "head_bucket.glb", scalp: [164, 125, 85], hairCut: 0.92 }),
  "cap-back": I("head", "Backwards cap", { file: "head_cap_back.glb", scalp: [32, 31, 29], hairCut: 0.93 }),
  "trucker": I("head", "Trucker cap", { file: "head_trucker.glb", scalp: [45, 40, 74], hairCut: 0.93, ...RARE }),
  "bandana-band": I("head", "Bandana headband", { file: "head_bandana.glb", ...RARE }),
  "beanie-pixel": I("head", "Pixel beanie", { file: "head_beanie_pixel.glb", scalp: [24, 22, 22], hairCut: 0.9, ...RARE }),
  "earmuffs": I("head", "Earmuffs", { file: "head_earmuffs.glb", ...EPIC }),
  "hood": I("head", "Hood up", { file: "head_hood.glb", scalp: [104, 102, 104], hairCut: 0.86, hidesHair: ["pigtails", "ponytail", "twin-buns", "afro-puff"], ...EPIC }),
  // ---- face (8)
  "mask-black": I("face", "Face mask", { file: "face_mask_black.glb" }),
  "shades-round": I("face", "Round shades", { file: "face_shades_round.glb" }),
  "band-aid": I("face", "Band-aid", { code: "decal" }),
  "star-sticker": I("face", "Star sticker", { code: "decal", ...RARE }),
  "nose-ring": I("face", "Nose ring", { code: "decal", ...RARE }),
  "hoops": I("face", "Hoop earrings", { code: "hoops", ...RARE }),
  "shades-wrap": I("face", "Wraparound shades", { file: "face_shades_wrap.glb", ...EPIC }),
  "bandana-mask": I("face", "Bandana mask", { file: "face_bandana_mask.glb", ...EPIC }),
  // ---- tops (12)
  "sweat-babyblue": I("top", "Baby blue sweatshirt", { file: "top_sweat_babyblue.glb", hides: { tee: 1, arms: 1 }, tint: recolor([160, 177, 195], [172, 206, 246]) }),
  "puffer-black": I("top", "Black puffer", { file: "top_puffer_black.glb", hides: { tee: 1, arms: 1 } }),
  "track-purple": I("top", "Velvet track jacket", { file: "top_track_purple.glb", hides: { tee: 1, arms: 1 } }),
  "bomber-olive": I("top", "Olive bomber", { file: "top_bomber_olive.glb", hides: { arms: 1 } }),
  "cardigan-cream": I("top", "Cream cardigan", { file: "top_cardigan_cream.glb", hides: { arms: 1 } }),
  "varsity": I("top", "Varsity jacket", { file: "top_varsity.glb", hides: { arms: 1 } }),
  "tee-white": I("top", "Oversized white tee", { file: "top_tee_oversized.glb", hides: { tee: 1 }, group: "tee" }),
  "tee-black": I("top", "Black tee", { file: "top_tee_oversized.glb", hides: { tee: 1 }, group: "tee", tint: recolor([186, 186, 185], [46, 44, 48]) }),
  "zip-hoodie": I("top", "Gray zip hoodie", { file: "top_zip_hoodie.glb", hides: { tee: 1, arms: 1 }, ...RARE }),
  "baby-tee": I("top", "Baby tee", { file: "top_baby_tee.glb", hides: { tee: 1 }, ...RARE }),
  "denim-jacket": I("top", "Denim jacket", { file: "top_denim_jacket.glb", hides: { arms: 1 }, ...EPIC }),
  "crop-flannel": I("top", "Crop top + flannel", { file: "top_crop_flannel.glb", hides: { arms: 1 }, ...EPIC }),
  // ---- bottoms (10)
  "cargo-chain": I("bottom", "Baggy cargos + chain", { file: "bottom_cargo_chain.glb", hides: { shorts: 1, legs: 1 } }),
  "snow-pants": I("bottom", "Puffy snow pants", { file: "bottom_snowpants.glb", hides: { shorts: 1, legs: 1 } }),
  "track-pants": I("bottom", "Track pants", { file: "bottom_track_purple.glb", hides: { shorts: 1, legs: 1 } }),
  "wide-jeans": I("bottom", "Wide-leg jeans", { file: "bottom_jeans_wide.glb", hides: { shorts: 1, legs: 1 } }),
  "plaid-wide": I("bottom", "Plaid wide pants", { file: "bottom_plaid_wide.glb", hides: { shorts: 1, legs: 1 } }),
  "cargo-shorts": I("bottom", "Cargo shorts", { file: "bottom_cargo_shorts.glb", hides: { shorts: 1 } }),
  "sweatpants": I("bottom", "Sweatpants", { file: "bottom_sweatpants.glb", hides: { shorts: 1, legs: 1 } }),
  "skirt-pleated": I("bottom", "Pleated skirt", { file: "bottom_skirt_pleated.glb", hides: { shorts: 1 }, ...RARE }),
  "mini-leggings": I("bottom", "Mini skirt + leggings", { file: "bottom_mini_leggings.glb", hides: { shorts: 1, legs: 1 }, ...RARE }),
  "skirt-long": I("bottom", "Long flowy skirt", { file: "bottom_skirt_long.glb", hides: { shorts: 1, legs: 1 }, ...EPIC }),
  // ---- shoes (8)
  "skate-blue": I("shoes", "Chunky skate shoes", { file: "shoes_skate_blue.glb", hides: { below: 0.085 } }),
  "white-chunky": I("shoes", "Chunky white sneakers", { file: "shoes_white_chunky.glb", hides: { below: 0.085 } }),
  "combat": I("shoes", "Combat boots", { file: "shoes_combat.glb", hides: { below: 0.13 } }),
  "snowboard": I("shoes", "Snowboard boots", { file: "shoes_snowboard.glb", hides: { below: 0.13 } }),
  "hightop": I("shoes", "High-top canvas", { file: "shoes_hightop.glb", hides: { below: 0.12 } }),
  "slides": I("shoes", "Slides + socks", { file: "shoes_slides.glb", hides: { below: 0.07 } }),
  "maryjanes": I("shoes", "Mary Janes + socks", { file: "shoes_maryjanes.glb", hides: { below: 0.06 }, ...RARE }),
  "platform": I("shoes", "Platform sneakers", { file: "shoes_platform.glb", hides: { below: 0.09 }, ...EPIC }),
  // ---- neck / back (6)
  "chain-silver": I("neck", "Silver chain", { file: "neck_chain.glb", group: "chain", tint: recolor([162, 134, 69], [200, 204, 212]) }),
  "chain-gold": I("neck", "Gold chain", { file: "neck_chain.glb", group: "chain", ...RARE }),
  "scarf": I("neck", "Chunky scarf", { file: "neck_scarf.glb", ...RARE }),
  "sling": I("neck", "Sling bag", { file: "neck_sling.glb", ...RARE }),
  "backpack": I("neck", "Small backpack", { file: "neck_backpack.glb", ...EPIC }),
  "skateboard": I("neck", "Skateboard on back", { file: "neck_skateboard.glb", ...EPIC }),
};
// hair colours in the shop
export const HAIRCOLOR_SHOP = { platinum: RARE, red: RARE, navy: RARE, pink: EPIC, mint: EPIC, purple: EPIC };

export const SLOTS4 = ["hair", "head", "face", "top", "bottom", "shoes", "neck"];
const catOf = cat => Object.keys(ITEMS4).filter(id => ITEMS4[id].cat === cat);
export const PART_OPTIONS4 = {
  skin: Object.keys(SKIN4_RGB),
  eyes: EYE_SHAPES,
  iris: Object.keys(IRIS4),
  hairColor: Object.keys(HAIR4_RGB),
  ...Object.fromEntries(SLOTS4.map(s => [s, ["none", ...catOf(s)]])),
};
export const LOOK_KEYS4 = ["skin", "eyes", "iris", "hairColor", ...SLOTS4];

// the six starter outfits (all free)
export const STARTER_OUTFITS4 = [
  { id: "cozy", name: "Cozy", head: "beanie-phones", top: "sweat-babyblue", bottom: "cargo-chain", shoes: "skate-blue", face: "none", neck: "none" },
  { id: "snow", name: "Snow day", head: "beanie-goggles", face: "mask-black", top: "puffer-black", bottom: "snow-pants", shoes: "snowboard", neck: "none" },
  { id: "track", name: "Tracksuit", head: "durag", face: "shades-round", top: "track-purple", bottom: "track-pants", shoes: "white-chunky", neck: "none" },
  { id: "bucket", name: "Weekend", head: "bucket", top: "bomber-olive", bottom: "wide-jeans", shoes: "white-chunky", face: "none", neck: "none" },
  { id: "buns", name: "Knit", hair: "twin-buns", head: "none", top: "cardigan-cream", bottom: "plaid-wide", shoes: "combat", face: "none", neck: "none" },
  { id: "varsity", name: "Varsity", head: "cap-back", top: "varsity", bottom: "cargo-shorts", shoes: "hightop", face: "none", neck: "none" },
];

export const DEFAULT_AVATAR4 = {
  skin: "3", eyes: "sharp", iris: "gray", hairColor: "black",
  hair: "middle-part", head: "none", face: "none", top: "sweat-babyblue", bottom: "cargo-chain", shoes: "skate-blue", neck: "none",
};
// old saved looks (avatar3: face f1.., hair f1.., skin 1-5) keep what still
// means something (the skin tone); everything else falls back to the default
export function normalizeAvatar4(raw) {
  const cfg = { ...DEFAULT_AVATAR4 };
  if (raw && typeof raw === "object") for (const k of LOOK_KEYS4) {
    const v = raw[k] != null ? String(raw[k]) : null;
    if (v && PART_OPTIONS4[k].includes(v)) cfg[k] = v;
  }
  return cfg;
}

// is this option free? (shop items and dyes aren't; the server has the final say)
export const isFree4 = (k, v) => k === "hairColor" ? !HAIRCOLOR_SHOP[v] : !(ITEMS4[v]?.price > 0);

// a random look (bots, Randomize); by default from the free things; rng() in [0, 1)
export function randomAvatar4(rng = Math.random, ok = isFree4) {
  const pick = (k, pNone = 0) => {
    const vs = PART_OPTIONS4[k].filter(v => v !== "none" && ok(k, v));
    return !vs.length || rng() < pNone ? "none" : vs[Math.floor(rng() * vs.length)];
  };
  return {
    skin: pick("skin"), eyes: pick("eyes"), iris: pick("iris"), hairColor: pick("hairColor"),
    hair: pick("hair", 0.08), head: pick("head", 0.55), face: pick("face", 0.7), top: pick("top"),
    bottom: pick("bottom"), shoes: pick("shoes"), neck: pick("neck", 0.7),
  };
}
