# The player character (avatar4) and its wardrobe

One shared, gender-neutral base: big round head, lanky (~4 heads), long
neck, narrow shoulders, mitten hands, a bald body in a gray tee + shorts
underlayer. Soft rounded clay, matte, no outlines. Big sharp almond eyes, a
tiny nose, **no mouth**; expressions are the eyes plus doodled emote marks.
Only girl-coded clothes and hair (skirts, crop tops, long hair, buns,
pigtails) change the silhouette; nothing is gender-locked.

## Files

| | |
|---|---|
| `web/avatar4.js` | the runtime: the base, materials, items, hat hair, emotes, motion, thumbnails |
| `web/avatar4/base.glb` | the rigged base (4,599 tris, 20 joints, region mask, face UV set) |
| `web/avatar4/items/*.glb` | every item, skinned to the base's joints, in its model space |
| `web/items4.js` | the wardrobe: items, what they hide, tints, free/shop, rarity, label prices, starter outfits |
| `web/face4.js` | the eyes (8 shapes × 8 iris tints, expressions) and the face-layer accessories |
| `supabase/migrations/016_wardrobe4.sql` | the shop's real prices and rarity (must match `items4.js`; the SQL test checks) |
| `scripts/avatar4/` | the pipeline: `split.mjs` (decimate), `regions.py` (region mask), `base4.mjs` (rig), `item4.mjs` + `items.manifest` + `run_items.sh` (items) |

## How it's drawn

- **Skin, tee, shorts:** one region-mask texture (R skin, G tee, B shorts);
  the shader mixes three code colours. 8 skin tones, light to deep.
- **Face:** a canvas drawn in code, mapped onto the head through its own UV
  set (`TEXCOORD_1`, weighted by `_FACEW`): part of the head's surface, lit
  and skinned with it, never a floating plane. Face normals lean on an
  ellipsoid round the head, so the mouthless face shades soft.
- **Items:** glbs skinned offline to the same joints and bound to the
  character's skeleton at load. Hair and head/face items ride the head bone
  rigidly. Tints are code: hair moves its whole texture to the hair colour
  (keeping its light and dark); other items move a key colour (one mesh,
  several colours: white/black tee, silver/gold chain).
- **Hiding under clothes:** items list what they hide (the tee / shorts
  regions, arms, legs, feet below a height); the body discards those
  pixels, so nothing pokes through in any pose.
- **Hat hair:** a hat clips the hair above its line (`hairCut`), and the
  scalp takes the hat's colour; the hood also hides tails and buns
  (`hidesHair`). Under plain hair the scalp takes the hair colour.
- **Motion:** procedural idle (sway, blink, nods) and walk, arms down from
  the A-pose, a slightly wider stance; `react()` is a hop + a sparkle
  emote; `emote(name)` shows a doodled mark by the head (anger, zzz, hearts,
  spiral, sparkles, sweat, question, exclaim).

## Making an item

Every generation uses the approved base image as the image reference
(never text only), front view (back view for things worn on the back),
plain light gray background; no logos, brand names or real text.

1. Nano Banana Pro: the item(s) worn on the base. One picture can carry a
   hair or a hat, a top, a bottom and shoes at once (they're cut apart by
   body zone), which is how the set was made for ~11 credits a picture.
2. Tripo H3.1 image to 3D (standard) → a glb of the dressed figure.
3. `item4.mjs` cuts the item out: lines the figure up with the base on its
   skin, keeps the item's triangles in its zone by colour and distance from
   the bare base, keeps the big pieces, simplifies to 300–1500 tris, smooth
   normals, copies skin weights from the nearest base vertices, writes a
   skinned glb. Options per item are in `items.manifest`.
4. Add it to `items4.js` (and to `016`/a new migration if it's sold).
5. Check it: `node test/combos_shots.mjs <dir>` (every top × bottom and
   headwear × hair, idle + walk).

## Generation log (Oct 2026)

Credits: an image is 2, a 3D model 9 (standard) or 18 (detailed). One try
per picture; re-cuts are free. Total **313 credits** (592 → 279).

| # | picture | items cut from it | credits |
|---|---|---|---|
| — | checkpoint 1 (detailed 3D) | middle-part hair · baby blue sweatshirt · skate shoes | 20 each, 60 |
| 1 | starter 1 | beanie + headphones · cargos with chain | 11 |
| 2 | starter 2 | goggles on beanie · black mask · puffer · snow pants · snowboard boots | 11 |
| 3 | starter 3 | durag · round shades · track jacket · track pants | 11 |
| 4 | starter 4 | bucket hat · olive bomber · wide jeans · white chunky sneakers | 11 |
| 5 | starter 5 | twin buns · cream cardigan · plaid pants · combat boots | 11 |
| 6 | starter 6 | backwards cap · varsity · cargo shorts · high-tops | 11 |
| 7 | | short twists · oversized tee (white + black) · sweatpants · slides | 11 |
| 8 | | buzz cut · gray zip hoodie | 11 |
| 9 | | bowl cut · denim jacket · pleated skirt | 11 |
| 10 | | long with bangs · crop top + flannel · long skirt · Mary Janes | 11 |
| 11 | | pigtails · baby tee · mini skirt + leggings · platforms | 11 |
| 12 | | spiky bleached tips · chain (gold + silver) | 11 |
| 13 | | slicked back · scarf | 11 |
| 14 | | wolf cut · sling bag | 11 |
| 15 | | high puff | 11 |
| 16 | back view | high ponytail · backpack | 11 |
| 17 | | locs | 11 |
| 18 | back view | bob · skateboard | 11 |
| 19 | | pixel beanie · wraparound shades | 11 |
| 20 | | trucker cap · bandana mask | 11 |
| 21 | | earmuffs | 11 |
| 22 | | hood up | 11 |
| 23 | | bandana headband | 11 |
| — | code | band-aid · star sticker · nose ring (face layer) · hoop earrings | 0 |

The pictures and job ids are in the Higgsfield history (`hf_20261024_0944*`,
`hf_20261024_0945*`); the base is `hf_20261024_070557_b4fcc475…` /
`hf_20261024_070812_095bfcd5…`.

## Free vs shop

Starter-outfit items and the basics are free (common). Shop: **rare** 80
coins, **epic** 150 (labels in `items4.js`, real prices in SQL). Hair dyes:
platinum / red / navy rare, pink / mint / purple epic. Old avatar3 shop
rows stay in SQL for people's inventories but the client no longer lists
them.

Old saved looks keep their skin tone; everything else becomes the default
(middle-part hair, the starter 1 outfit without the hat).
