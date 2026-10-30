# The Itaewon style — rules for the whole world

Everything the map draws, anywhere on Earth, must look like our hand-made
Itaewon: the same artist, the same palette, the same shapes. This file is
the law. It was extracted from the hand-made map's code and data
(`web/world3d.js` loadWorld, `web/theme.js`, `web/buildings.json`,
`scripts/bake_registry.py`, `web/world2/*.jpg`) on 2026-10-28; where a
number here and the code disagree, fix the code. The procedural city
(`web/citygen.js`, `web/citytiles.js`, `web/cityomt.js`) is checked
against it in `test/specs.js` and by eye in `test/style_shots.mjs`.

Units: **1 m = 0.55 world units** horizontally (`GEO_SCALE`). Building
heights are exaggerated **2.4×**: **1 m of height = 1.32 u**. Props,
roads and the ground are given in world units as drawn. The character is
15 u tall (deliberately oversized: about a 2-storey building).

## 1. Rendering

- Render at **half the screen's resolution** (pixel ratio 0.5), no
  antialiasing, upscaled with hard pixels (`image-rendering: pixelated`).
  This is the "console render" look: it softens every hard edge below.
- **Lambert only** on the world (no PBR, no specular, no tone mapping).
  Flat shading on props and landmarks; building walls are flat per face.
- No shadow maps. Shadows are **baked** (section 5.6).
- Camera: fov 50, near 1, far 2500. Home view: elevation 0.58 rad, 175 u
  from the target, looking straight at it. Pinch zooms 70–420 u, two
  fingers moved up / down tilt it 0.22–1.25 rad, a twist (or one finger,
  locked on you) orbits; a recenter eases back to the home view
  (`world3d.js` `ZOOM`, `bindControls`).
- Text is never in the canvas (labels are DOM on top).

## 2. Lighting, sky and fog (`web/theme.js` lighting)

One rig for day, one for night; nothing else lights the world. By day
the sun comes from where the real sun is over the place on screen
(`web/sun.js`: its bearing, and its height, at least 12°); at night, and
when the light is forced, from (120, 200, 80) relative to the scene (the
moonlight), blended through dusk.

| | Day | Night |
|---|---|---|
| Hemisphere sky / ground / intensity | `#fff0d6` / `#9b8f7a` / 0.95 | `#5b6fa0` / `#2e3048` / 0.9 |
| Sun colour / intensity | `#ffdfae` / 1.45 | `#aec6ee` / 0.65 |
| Fog colour | `#e9dcc3` (cream haze) | `#2a3452` (navy) |
| Fog | on the map: by ground distance from you, clear to 0.65 × far, total at far = 5 × the camera's distance, 850–1750 u (home view: clear to 570 u ≈ 1 km, total at 875 u ≈ 1.6 km; 10 % further at night); a band in the fog colour hides where the ground meets the sky; on the start screen 340 / 1250 u from the camera | same |
| Sky | painted cylinder `world2/sky_day.jpg`, cap `#3072c7` | `world2/sky_night.jpg`, cap `#030b25` |
| Everything lit at night | walls multiplied by **(0.36, 0.42, 0.60)** blue moonlight; props use their own night colours below | |

Day and night follow the real sun over the place on screen (`web/sun.js`,
whatever the phone's clock or time zone), blended live through golden hour
and dusk: every material with a day and a night value lerps between them
(`world3d.js` `dn()`), and the glass UI follows (`web/daylight.js`).

## 3. Ground

- **Paving** everywhere between buildings in a city (Itaewon: a 720 u
  disc; the procedural city: the whole ground): the paving-stone crop of
  `world2/road_plaza.jpg` (the square at 5–27 % of the image), tiled with
  mirrored blocks about **80 u** per repeat, tinted `#efeae0` by day /
  `#6a7390` at night. Sits 0.14 u above the grass.
- **Grass** outside the city and in parks: the lawn crop of
  `world2/road_grass.jpg` (3–30 %), mirrored blocks about 79 u per repeat,
  tinted `#e6e6d4` by day / `#6b7c9c` at night (lifted from `#49536b`: a park read as a black hole at night).
- **Terrain**: Itaewon has its hills (`citygen.js` `itaewonHill`); the
  procedural city is flat and, in the blend, follows the same hills.
- There is no separate sidewalk geometry: the paving *is* the sidewalk.
  Curbs exist only as a pale ring where the Itaewon paving meets grass.

## 4. Roads

- Flat **box ribbons 0.5 u thick** on the centreline, top at +0.5 u, with
  round joint discs at every bend so slopes never show a seam.
- Widths (world units; Itaewon draws streets about 1.6× their real
  width so they read):

  | class | width | | class (not in Itaewon, proposed) | width |
  |---|---|---|---|---|
  | primary | 24 | | motorway, trunk | 24 |
  | secondary | 19 | | living street | 9 |
  | tertiary | 15 | | service | 7 |
  | residential, unclassified, anything else | 11 | | footway, path, cycleway, steps | 4 |
  | pedestrian | 8 | | | |

- Material: the **plain asphalt strip** cropped from `world2/road_grass.jpg`
  (x 54.5 %, y 75 %, 2.7 % × 20 % of the image), repeated every **26 u**
  along the road, straight repeat (never mirrored). Tint `#d8d3c8` by day;
  at night `#bcc3dc` plus emissive `#272e48` so the walkable path reads
  against the dark blocks. **No lane lines, no dashes.**
- Crosswalks (where the data has them): instanced white bars
  4.2 × 0.06 × 0.55 u at 1.1 u pitch, `#f0f2ee`, opacity 0.68 day / 0.42
  night, 0.74 u above the road.

## 5. Buildings

### 5.1 Footprints and height
- Real footprints, simplified to a handful of points (Itaewon: median 5),
  extruded straight up. Walls are flat vertical quads, no bevel, no
  rounding, no setbacks. The base is sunk **1.2 u below the ground** so
  slopes never open a gap.
- Height: `h = metres × 0.55 × 2.4` (1.32 u per metre), from the
  building's real height or floors × 3.2 m. Above 50 m the extra rises at
  1.45 u per metre (so a 500 m tower doesn't swallow the screen; Itaewon
  has nothing over 48 m, so inside its range the rule is exactly linear).
- Itaewon's spread, for calibration: 4,471 buildings, median 10.2 u
  (7.7 m), 90th percentile 16.9 u, tallest 63.4 u.
- Missing heights are guessed from the facade class (5.2): res 2 floors,
  shop 3, mixed 4, office 8, then jittered ±1 by the building's seed.

### 5.2 Facade class (from floors, area, road; there is no use field)
```
floors >= 6                               -> office
on a main road  and floors <= 4           -> shop
floors <= 2     and footprint < 55 u^2    -> res
otherwise                                 -> mixed
```
Itaewon's mix: shop 50 %, mixed 13 %, res 11 %, office 1 %, unknown 25 %
(unknown = OSM-only buildings; they draw as mixed, every third as res).

### 5.3 Wall colour
Six warm creams only, picked by a position hash, the same list for every
class (offices are not grey): `#f2efe7 #e8e2d4 #dcd5c5 #e6dccb #ebdfd6
#d6cfc3` (`THEME.walls`). At night the colour is multiplied by the
moonlight (0.36, 0.42, 0.60).

### 5.4 Windows (one painted tile per class, pixel art, no mipmap blur)
A 256 × 256 px canvas is one tile of **13 u across × 10.4 u up**; it
repeats along the wall (u starts at a per-building offset so neighbours
never line up) and climbs with the height. Wall field `#f2efe8`, glass
`#59606c` with a 4 px pale band (`rgba(255,255,255,.3)`) 38 % down each
window. Nearest-neighbour magnification: the pixels stay crisp.

| class | grid | window (u) | pitch across × up (u) | extras |
|---|---|---|---|---|
| mixed | 4 × 4 | 2.13 × 1.38 | 3.15 × 2.52 | — |
| shop | 4 across × 2 rows, over a sign band and a glass storefront | 2.13 × 1.62 | 3.15 × 2.68 | sign band `#9aa0a8` 0.73 u tall; storefront glass `#4a5666` full width, 2.36 u tall, at the foot of every tile |
| office | 5 × 5 | 1.83 × 1.22 | 2.49 × 1.99 | — |
| res | 3 × 3 | 2.34 × 1.71 | 3.96 × 3.17 | balcony rail `#7d8288` 3.05 × 0.16 u under each window |

(The grid is denser than real floors on purpose: about 1.7 window rows
per storey. That is the look.)

### 5.5 Lit windows at night
The emissive map is the day tile under a near-black field
(`rgba(9,12,20,.86)`) with some windows painted lit, each 1 px larger
than its opening. Six variants cycle with the wall colour, so every
building has its own share of lights:

| variant | lit share | warm share | emissive intensity |
|---|---|---|---|
| 1 | 20 % | 85 % | 0.92 |
| 2 | 10 % | 55 % | 0.78 |
| 3 | 5 % | 75 % | 0.72 |
| 4 | 15 % | 95 % | 0.95 |
| 5 | 8 % | 35 % | 0.80 |
| 6 | 13 % | 70 % | 0.86 |

Mean **12 % of windows lit** (never above 20 %), **69 % of them warm**.
Warm `#ffd98f #ffc76a #ffe7b0`; cool `#c8ddff #aecbf2 #dfe9ff`.

### 5.6 Roofs, outlines, shadows
- **Flat roofs only**: the footprint capped at the top, coloured
  **wall × 0.8** (and × moonlight at night). No parapets, no pitched
  roofs, no roof colours. (Pitched roofs are not in the Itaewon
  vocabulary; adding them for suburbs is a deliberate extension, off
  unless asked.)
- **Outlines** on the walls (not roofs): edges sharper than 40°, line
  colour `#6b675e` day / `#39435c` night at 50 % opacity.
- **Baked shadow**: the footprint swept by (−0.52 k, −0.34 k) with
  k = min(52, 6 + 0.95 h), filled `#241c12` at 32 % opacity, 0.5 u above
  the ground, drawn under everything (no depth write). On the hand-made
  map, by day, the sweep falls away from the real sun instead, 0.6–2.2×
  as long as it sinks (`sun.js` `shadowSweep`, in 10° steps, re-swept a
  slice a frame), fading out and back through dusk; at night the classic
  sweep. The procedural city's chunks fall the same way: swept in the
  worker (`citygen.js` `shadow`) with the same sweep, built again a few a
  frame when it steps (`citytiles.js` `setShadow`), fading the same.

### 5.7 On and around each building (the "street density pass")
Deterministic from the lot's position; `road-facing edge` = the footprint
edge whose middle is nearest a road within 45 u.

| prop | where | shape (u) | colour day / night |
|---|---|---|---|
| rooftop AC box | 2 of every 3 buildings, jittered off centre | 2.0 × 1.3 × 1.6, turned ±0.4 rad | `#b9bcc0` / `#5a5f6a`, flat shaded |
| awning | 60 % of lots with a road-facing edge (cap 520) | min(0.86 × edge, 24) × 0.45 × 3.1, pitched 0.24 rad, at +6.8, 1.5 out from the wall | `#4f9d8f` teal, `#c95f4e` coral, `#d9a83c` mustard, `#e8e2d4` cream / × 0.5 |
| sign panel (a plain box, no text) | 55 % of lots taller than 12 u | 0.35 × 3.6 × 2.1 on the road face, between 9.5 u and the top | `#3f8f82 #d97b3c #e0c33a #ba4a44 #5a7fa8` / × 0.65 plus the same colour emissive × 0.28 |
| bin / cone | 10 % of lots, at the road edge | cylinder r 1.0→0.9 h 2.4 (60 %) or cone r 0.7 h 1.7 (40 %) | bin `#4c6a80` / `#3a4a62`; cone `#e07b35` / `#8a4a20` |

### 5.8 Street furniture (along roads)
| prop | where | shape (u) | colour day / night |
|---|---|---|---|
| power pole | roads ≥ 11 u wide, at least 80 u apart (cap 220 per map), 2.2 u outside the road edge | cylinder r 0.32→0.40, 23 tall | `#5d564c` / `#2c2a26` |
| wires | between poles under 130 u apart: two catenaries at 22.2 and 20.6 u, 2.6 u of sag, 7 segments | lines | `#2f2b26` at 75 % |
| pole lamp | every 3rd pole, at 21.8 u | sphere r 1.15 | `#f2ead8` / `#fff0c0` emissive `#ffd685` × 1.3, plus a ground pool r 9, `#ffb95e` additive 14 % (night only) |
| paper lantern | the middle of every 3rd span, hung 1.4 u under the wire | sphere r 0.95 stretched 1.25 tall | `#f4e4c8` / `#ffe2a0` emissive `#ffc96e` × 1.5 |
| street light | roads ≥ 8 u wide, every 25 u, alternating sides, 2.2 u outside the edge (cap 260), never within 14 u of a pole lamp | post 0.34 × 6.8 × 0.34, head 0.95 × 0.5 × 0.95 at 6.9 | post `#6d7076` / `#3c4356`; head `#d8cba8`, night emissive `#ffc87d` × 1.0 (no pool) |
| subway exit | at the entrance | canopy 5.4 × 0.4 × 3.6 at 3.2, four posts 0.3 × 3.2, panel 5.0 × 1.15 × 0.22 | canopy `#9aa1ab` / `#6d7890`; posts `#767d88` / `#4c5468`; panel Seoul-line ochre `#b07c3a` / `#8a5c24` emissive `#7a4d16` × 0.9; label "Exit N" |

### 5.9 Trees
The painted GLB trees, never geometric blobs: `world2/tree_green.glb`
22 u tall (93 %) and `world2/tree_palm.glb` 26 u (7 %), scaled 0.85–1.3,
textures desaturated to 80 %, at most 150 in view, in green areas and
never on a road or a roof.

### 5.10 Landmarks
A hand-made `.glb` at a lat/lng (`web/data/heroes.json`) replaces the
procedural building(s) under it: textures posterised to flat blocks,
flat shaded, outlined (34°, the same line colours), fitted to the real
footprint and height. At night the bright or saturated pixels glow
(× 0.9) and a venue grounds a pool of its own colour (radius 1.7 × its
clear radius). Until a model exists, a landmark is its real building
grown to its height with a glowing crown, or a placeholder tower.

## 6. Where the procedural city departs from this today (Step 3 fixes)

Checked against `web/citygen.js` / `citytiles.js` / `cityomt.js` as of
2026-10-28. ✓ already matches · ✗ to fix.

| rule | procedural city now | |
|---|---|---|
| 5.3 six creams for every class | its own palette per type: offices cool grey, civic tan, industrial grey | ✗ |
| 5.4 Itaewon's four window tiles at 13 × 10.4 u | its own 8 tiles (128 × 80 px, one storey × two bays, sills, pale frames, blue-grey glass) | ✗ |
| 5.5 12 % lit (5–20 % per building), 69 % warm, 6 variants | 34 % lit everywhere, one warm colour | ✗ |
| 2 moonlight (0.36, 0.42, 0.60) | (0.42, 0.46, 0.62) | ✗ |
| 5.6 flat roofs, wall × 0.8 | flat roofs in greys and Seoul green, plus gabled / hipped / pyramid roofs on houses, rooftop boxes and tanks | ✗ |
| 5.6 outlines `#6b675e` / `#39435c` at 50 % | `#3a332a` / `#0b0e18` at 40 % / 55 % | ✗ |
| 5.6 baked swept shadows | none | ✗ |
| 5.1 height 1.32 u/m, knee at 50 m | 1.32 u/m, knee at 25 m (a 48 m building is 20 % short) | ✗ |
| 4 road widths | about 55 % of Itaewon's (primary 13 vs 24) | ✗ |
| 4 no lane marks, no sidewalk ribbons | sidewalk ribbons and lane dashes on main roads | ✗ |
| 4 asphalt crop, tints, night emissive | the same crop and tints | ✓ |
| 3 paving ground | the same crop and tints | ✓ |
| 3 parks are the grass texture | flat `#b4c98c` / `#93b179` | ✗ |
| 5.9 painted GLB trees, 22 u | icosahedron blobs about 8 u tall | ✗ |
| 5.7 AC boxes, awnings, sign panels, bins | textured shopfront bands and textured neon sign faces; no awnings, AC boxes or bins | ✗ |
| 5.8 poles, wires, lanterns | none | ✗ |
| 5.8 street lights | thinner post, smaller head, a pool under every one | ✗ |
| 5.10 landmark override | the same heroes.json system | ✓ |
| 2 lighting rig, fog colour, sky | the same rig; fog 300 / 980 in the far city | ✓ |
| 1 half-res pixel render, Lambert | the same | ✓ |

## 7. How to check a city against this file

- `node test/style_shots.mjs <dir>`: each test spot (Itaewon's edge,
  Gangnam, Hongdae, Calgary, Edmonton) at street level and from above,
  day and night, next to Itaewon at the same camera; and next to a plan
  of the real layout.
- `npm test` "The Itaewon style": every wall colour is one of the six,
  roofs are flat and wall × 0.8, the lit share of a chunk's windows is
  5–20 % per building and about 12 % overall, road widths match the
  table, the height curve matches, trees are the GLB.

## Appendix: the original reference art

The look was first set by generated reference images (Higgsfield, master
reference `world-style-locked_globe-smooth.png`: a smooth soft-shaded
toy-town, white and cream buildings with coral, teal and yellow accents,
a curved horizon). The painted ground and sky tiles in `web/world2/` and
the facade textures in `assets/world/textures/` came from that recipe.
The engine has since moved to the rules above (real footprints, pixel
windows, the street pass); anything new is judged against this file, not
the reference images.
