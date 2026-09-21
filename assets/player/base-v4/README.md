# Player base v4 — low-poly chibi set (2026-09-21)

Higgsfield `gpt_image_2_5`, quality high, 3:4, `background: transparent`.
Every variant carries the base job as `image_references` and restates the
locked traits; nothing is chained off a later variant.

## Base

`01_base_tee-shorts.png` — job `de4e1c07-a6a6-4b80-83ca-f21d9b2da669`.
Picked from three first-pass candidates (`_candidates/`): symmetrical
stance with both arms free, attitude carried by the half-lidded deadpan
eyes instead of a pose. Rejected: `a008e442` (angry brows read "cross
kid"), `5004ce6c` (hands hidden behind the body — bad base/rig reference).

## Core prompt (verbatim in every request)

> Low-poly PS2-era 3D rendered chibi character, standing idle,
> front-facing, centered, isolated on transparent background.
> Proportions: very large head taking up roughly one third of total body
> height, short compressed torso, short stubby rounded limbs with no
> visible elbow or knee articulation, small simple feet. Faceted angular
> geometry with visible polygon edges, flat matte shading, no smooth
> gradients or soft lighting, subtle film grain. Muted slightly
> desaturated retro game palette. Confident relaxed stance, slight
> attitude. Simple minimal facial features — small eyes, no detailed
> mouth. Gender-neutral silhouette. Retro game character asset, clean
> silhouette readable at small size.

Variant prefix: "The identical original character from the reference
image — same body shape, same head size and head-to-body ratio, same
face with the same half-lidded deadpan eyes, … — only the outfit /
hairstyle changes: now …".

## Set

| # | File | Swap |
|---|---|---|
| 1 | `01_base_tee-shorts.png` | plain white tee, simple shorts (default) |
| 2 | `02_hoodie-baggy.png` | oversized hoodie, baggy pants, hands in pockets |
| 3 | `03_cropped-jacket-wideleg.png` | cropped jacket, wide-leg trousers |
| 4 | `04_bomber-jeans.png` | bomber jacket, straight jeans |
| 5 | `05_tank-cargo.png` | tank top, cargo shorts |
| 6 | `06_longcoat-fitted.png` | long coat, fitted pants |
| 7 | `07_hair-short-cropped.png` | short cropped |
| 8 | `08_hair-medium-fringe.png` | medium with fringe |
| 9 | `09_hair-long-straight.png` | long straight |
| 10 | `10_hair-curly-volume.png` | curly volume |
| 11 | `11_hair-buzz.png` | buzz cut |
| 12 | `12_hair-messy-shag.png` | messy shag |

## Drift check (measured from alpha, 880×1168 canvas)

Neck = narrowest opaque row in the 38–62 % band; body = neck → feet.

| | total height px | body px (base 505) |
|---|---|---|
| outfits 02–06 | 1042–1058 (base 1038, ≤ +2 %) | 511–545 — collars/hoods move the detected neck row up; silhouettes overlay cleanly |
| hair 07–12 | n/a (hair changes the top) | 486–504 (≤ 4 %) |

No variant needed a regenerate on proportions, shading or facet density.
`_sheet.html` is a contact sheet of the 12 on neutral gray.

## 3D inputs (`3d-input/`)

A-pose front / left / back, all referenced off the base, **bald on
purpose**: avatar v3 treats hair as a separate mesh (`hair: "none"` is a
valid config), so hair must not be fused into the body.

## 3D + wardrobe — what is actually in the game (`web/avatar4/`, opt-in `?body=v4`)

**Canonical body** = `wardrobe/_body/dressed.glb`: Tripo v3.1 multiview (front /
left / back) with **`model_seed: 7`**, rigged with Tripo **v2.5** (`biped`,
`spec: tripo`) after a vertex-level yaw fix, `preset:idle` + `preset:walk`
baked in place -> `3d/rigged_seeded/` -> `web/avatar4/body.glb` + `anims/`.
(`3d/base_*.glb` are the earlier unseeded meshes; `base_meshy-rigged-20k.glb`
is a Mixamo-named fallback that the Tripo clips cannot drive.)

**Shipped wardrobe (13 pieces):** tops hoodie-maroon, tee-black, jacket-olive,
bomber-black · bottoms pants-baggy-black, trousers-wide-olive,
shorts-cargo-grey · hair short-cropped, medium-fringe, long-straight,
curly-volume, buzz, messy-shag (generated light grey, tinted by the engine).
`lineup_in-engine.png` is a render of all of it through the real engine.

**Shelved (sources kept in `wardrobe/`):** coat-charcoal,
jeans-straight-blue, pants-fitted-charcoal. Not an extraction bug — the base
body wears baggy shorts, and these sit INSIDE or against them, so the engine
cannot treat them as covering the shorts and gaps open up.

### Pipeline (`scripts/`)

1. Higgsfield: the bare A-pose body (front / left / back renders in
   `3d-input/`) WEARING one item — each view referenced off the matching bare
   view, "ONE change", so framing matches to a few pixels.
2. `tripo_wardrobe.py mesh <dir>` -> `dressed.glb` (30 cr).
3. `wardrobe_server.py` + `wardrobe_extract.html`: `window.extract({dir, cat,
   id})` registers the dressed mesh on the bare body and keeps only what
   changed -> `web/avatar4/<cat>/<id>.glb`. Add the id to `V4_CATALOG` in
   `web/avatar3.js`.

`tripo_wardrobe.py segment` (40 cr) is NOT needed any more and the extractor
ignores its output: Tripo's semantic parts are clean but its grouping is not
trustworthy (coat tails filed under "legs", a sleeve under "arm"), so the
extractor takes the whole mesh and decides per triangle.

### What it took (so nobody pays for it twice)

- **Fixed `model_seed`.** Three views never show the far arm; unseeded, Tripo
  resolves it differently per mesh and a sleeve lands 40 deg off the arm. A
  mirrored 4th view pins the arm but projects arm skin down the chest.
- **Rig model v2.5, not the v1.0 default** — v1.0 misplaces a chibi's hips and
  every retarget kicks a leg out sideways. Tripo also ignores node transforms:
  rotate the vertex data.
- **Registration.** Garments: head-sphere anchor + brute-force yaw over the
  regions the item cannot change. Hair: eyes for yaw + position, tee-collar
  height for scale (a nearest-point cost cannot find scale — it always
  improves as the figure shrinks toward its anchor).
- **"What changed" filter.** Drop a triangle if it sits on the bare body AND
  has the body's colour there (brightness *and* hue), never counting the base
  item the category replaces (tee for tops, shorts for bottoms); then crop to
  the category's height band, drop skin, drop base-outfit colour scraps, drop
  small fragments judged against the whole piece, compact the vertex buffer
  (the engine reads coverage from garment VERTICES), puff along
  position-merged normals.
- **Engine (v4 only).** Hides every non-skin body triangle a garment covers
  (garment must sit OUTSIDE the surface along its normal, within the garment's
  height span); one never-disposed draw-range geometry per character;
  animated bounds via `updateMatrixWorld`; garment skinning against SKINNED
  body positions with the matched vertex's skin matrix inverted; hair bound
  rigidly to the head.

### The real fix for everything shelved

Regenerate the base body in plain fitted underwear (like avatar v3) instead of
a tee + shorts. Every conflict above — poke-through, the replace/scrap colour
rules, tight bottoms, long coats — exists only because the base is already
dressed. The pipeline would run unchanged and most of its special cases
could be deleted.
