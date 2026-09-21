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

### Rigged + animated (`3d/rigged/`) — Tripo API, 2026-09-21

`scripts/tripo_rig.py` (new): vertex-level yaw fix -> `/files` ->
`/animations/rig-check` -> `/animations/rig` -> `/animations/retarget`.

| File | What |
|---|---|
| `_input_yawfixed.glb` | the multiview mesh rotated -98 deg **in the vertex data** so it faces +Z |
| `body_rigged.glb` | Tripo rig **v2.5-20260210**, `rig_type: biped`, `spec: tripo` — 19 bones, `tripoRoot / tripoSpine_0 / tripoHead_0 ...` (same family as `web/avatar3/body.glb`) |
| `idle.glb` | `preset:idle`, 15.4 s, baked, in place |
| `walk.glb` | `preset:walk`, 2.4 s, baked, in place |

What it took (so nobody repeats it):
1. **Rig model matters.** The default `v1.0-20240301` rig (41 bones,
   `Root/Hip/Pelvis...`) mislocates a chibi's hips and knees — every
   retarget kicked a leg out sideways, idle included. `v2.5-20260210` is
   the rigger that made the current avatar, and it is clean here too.
2. **Tripo ignores node transforms.** A root-node yaw changes nothing on
   their side; rotate positions/normals/tangents instead (`yaw_glb`).
3. The raw multiview mesh faces ~+98 deg from +Z (found empirically —
   PCA and mirror-symmetry estimates were both ~25 deg off because the
   A-pose arms are angled forward).
4. Output still sits ~20 deg off +Z after Tripo's pass; correct with a
   group rotation at load, as `avatar3.js` already does for fit.

Meshy's `3d_rigging` refused the Tripo GLB every time (no error detail);
`base_meshy-rigged-20k.glb` is a Mixamo-named fallback only.

### Still to do before this replaces `web/avatar3/body.glb`

- Re-fit hair / tops / bottoms / shoes: the v3 pieces were cut for a
  3.5-head body; this is ~3 heads, so they will float or clip.
- Skin-tone masks and face decals are keyed to the old body's UVs.
- The archetype gesture motion in `world3d.js` is procedural (group-level
  bob/sway) and needs no clips.
