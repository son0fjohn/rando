# The player character (avatar4) and its wardrobe

One shared, gender-neutral base: big round head, lanky (~4 heads), long
neck, narrow shoulders, thin arms and legs (15% slimmer than the first cut,
`slim4.mjs`), mitten hands, a bald body in a gray tee + shorts
underlayer. Soft rounded clay, matte, no outlines. Big sharp almond eyes (20 shapes), a
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
| `scripts/avatar4/` | the pipeline: `split.mjs` (decimate), `regions.py` (region mask), `base4.mjs` (rig), `slim4.mjs` (the slimmer body), `item4.mjs` + `items.manifest` + `run_items.sh` (items), `refit4.mjs` (refit to the slim body, the relaxed fit, clean cut edges) |

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
  regions, arms, legs, ears, feet below a height); the body discards those
  pixels, so nothing pokes through in any pose. The tee and shorts regions
  are only hidden where the top / bottom actually covers them (a cover map
  round the body's axis), so a wide collar or a short hem never opens a
  see-through hole.
- **Layer shells** (`avatar4.js`, all in rest space, once per item or pair):
  layers never share a surface and the outer one always wins.
  - The head shell: the scalp's radius round the head centre, measured per
    direction from the base mesh at load.
  - Hats sit on it, pushed out to at least `HAT_GAP` off the scalp; masks
    and shades sit `FACE_GAP` off the face.
  - Hat hair: wherever a hat covers the head (its cover map, measured from
    the hat itself), the hair is pressed down to within `HAIR_IN` of the
    scalp; what the hat doesn't cover (bangs, sides, the back, a ponytail's
    tail) stays. This works for every hat × every hairstyle with no
    per-pair tuning, and the beanie + headphones too (ears hide under the
    cups).
  - Hair always stands `HAIR_MIN` off the scalp (a buzz cut never
    flickers).
  - Hair lies over a top's collar and over neck items, lifted a little
    more further down the back. Neck items and a hood's neck lie over the
    top. A top's hem goes over the bottom's waistband (the waistband is
    pressed in).
  - A hood hides the hair behind the head (`hairBack`) and the hairstyles
    in its `hidesHair`.
  - Layer order (`LAYER4`: bottom, shoes < top < neck < hair < face <
    head) sets polygon offsets, so wherever two layers still touch, the
    outer one wins the depth test.
  - Per-item metadata in `items4.js`: `hides`, `hidesHair`, `hairBack`,
    `shell` (opt out), `liftsHair`, `tucks`, `blocks` (a combination that
    can't work: the Style screen dims the tile and says "doesn't fit with
    this hat"; saved and random looks drop the clash). Blocked today: the
    sling, the backpack, the skateboard and the scarf with the bulkiest
    jackets (they were made over a tee and can't sit over those); the hood
    hides long hair with bangs.
- **Under plain hair** the scalp takes the hair colour; under a hat, the
  hat's.
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
5. `refit4.mjs` (old base, slim base, item, out): follow the slimmer body
   (tight things: leggings, the baby tee, socks, chains), the relaxed fit
   for tops and bottoms (dropped shoulders, wide puffy sleeves, longer
   hems, a boxy body; wide legs that stack on the shoes; per-item numbers
   in its `FIT` table), and clean cut edges (the zigzag edge loops are
   smoothed, and edge vertices get the colour of the cloth just inside
   them, `_EDGECOL`).
6. Check it: `node test/glitch4.mjs <dir> --item=<id>` (every combination
   it's in, front / 3/4 / side / back, idle + walk, poke-through, z-fight
   and gaps labelled) and `node test/combos_shots.mjs <dir>`.

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

### Fixes round (Oct 2026)

No new items were generated: the slimmer body, the relaxed fit and the
edge clean-up are geometry (`slim4.mjs`, `refit4.mjs`) and the layering is
code. The eye shapes are code (`face4.js`, 20 shapes). The orbit rooms' side
views cost 4 images (8 credits, below).

## Free vs shop

Starter-outfit items and the basics are free (common). Shop: **rare** 80
coins, **epic** 150 (labels in `items4.js`, real prices in SQL). Hair dyes:
platinum / red / navy rare, pink / mint / purple epic. Old avatar3 shop
rows stay in SQL for people's inventories but the client no longer lists
them.

Old saved looks keep their skin tone; everything else becomes the default
(middle-part hair, the starter 1 outfit without the hat).
