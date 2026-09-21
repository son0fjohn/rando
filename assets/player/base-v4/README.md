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

## 3D (`3d/`)

| File | Tool | Tris | Rig | Notes |
|---|---|---|---|---|
| `base_tripo-multiview-20k.glb` | Tripo H3.1 multiview (front/left/back), `face_limit 20000` | 18.5 k | no | **pick** — wide round head, clean A-pose, ears intact. Comes in yawed +90° (front faces +X): load with `rotation.y = -Math.PI / 2` |
| `base_tripo-single-20k.glb` | Tripo H3.1 single image (front) | ~19 k | no | fine, slightly narrower head in profile, arms closer to the body |

### Rig status — read before wiring this in

The live avatar's clips (`web/avatar3/anims/idle.glb`, `walk.glb`) are
Tripo **`preset:idle` / `preset:walk`** animations baked onto Tripo's own
auto-rig (`tripo::Root`, `tripo::Spine_0`, …). They are produced per
model by Tripo's rig + retarget API, which Higgsfield does not expose —
its catalog only has Tripo *mesh* generation. Meshy's `3d_rigging`
refused this Tripo GLB (3 attempts across two characters, no error
detail), and a Meshy rig would use Mixamo-style bone names that the
existing clips cannot drive anyway.

To finish the rig the way the current body was done: put a
`TRIPO_API_KEY` in `.env` and run Tripo `animate_rig` then
`animate_retarget` (`preset:idle`, `preset:walk`) on
`base_tripo-multiview-20k.glb`, the same path that produced
`web/avatar3/body.glb` + `anims/`. The archetype "gesture" motion in
`world3d.js` is procedural (group-level bob/sway), so it needs no clips.
