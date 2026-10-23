# Side Quest wizard — 3D asset log

A sleepy old grandpa wizard / fortune teller. He shares the Art Gallery
dealer's **render style** (chibi, about 3 heads tall, chunky low-poly faceted
shapes, matte hand-painted texture, soft shading) and nothing else: a round
soft face, sleepy eyes under huge bushy brows, a big round nose, no
mustache-only face but a long beard past his belt, a tall droopy midnight-blue
star hat (taller than his head), a deep purple robe to the floor with a blue
star-and-moon mantle, slightly hunched, palms cupped in front. As solid black
silhouettes the two are a round-headed suit versus a tall cone.

The crystal ball is **not** in the model. It's the HTML ball (`.sq-ball`:
glow, swirl, the face reel), floated just above his palms by `wizard3d.js`,
so the names inside it stay HTML.

Pipeline: `gpt_image_2_5` turnaround views (the dealer render as a style-only
reference for the front; the other views from the front only) → Tripo H3.1
multi-view → `.glb` → turned to face +Z in the Higgsfield sandbox
(`@gltf-transform`, baked into the vertices) → Meshy rig. Max 3 attempts per
view.

## v3: sleepy grandpa wizard (current)

| Step | Job | Attempt | Credits | Kept? |
| --- | --- | --- | --- | --- |
| Front view (3:4, high, dealer idle render as style reference) | `950e05d2-86cd-4f9d-a84b-69357ba3e160` | 1 | 1.5 | kept |
| Left view (facing left, from the front view) | `ea9c721d-3b18-4171-a994-5d22b004bd6d` | 1 | 1.5 | kept |
| Back view | `042e4fd1-9e19-49f4-b3aa-1f794b716434` | 1 | 1.5 | kept |
| Right view (facing right) | `fed8448f-5feb-4a0d-9c37-01ac55cb861c` | 1 | 1.5 | kept |
| Tripo H3.1 multi-view → GLB (20k faces, detailed texture) | `398c34b2-e472-4119-a20f-57c329507bd6` | 1 | 12 | rejected: exported side-on (+X) |
| Meshy rig of that mesh | `6b828384-7ece-4778-9863-85a512f23cc6` | 1 | 8 | rejected: rigged side-on, arms swing sideways |
| Tripo H3.1 again, `orientation: align_image` | `0a409507-19af-498c-b541-d0de8c9f7bdb` | 2 | 12 | kept, after a -90° turn baked in (still +X) |
| Front-facing mesh (uploaded media) | `28888a2d-9190-42c3-bc7d-da16ed0f588e` | — | 0 | the rig's input |
| Meshy rig + Idle clip (0), 1 m tall | `eb724420-a625-495f-b149-1c692d4d8ea5` | 1 | 8 | kept (the clip isn't used: it crumples the robe) |

v3 total: 46 credits.

GLB to ship (under `https://d8j0ntlcm91z4.cloudfront.net/user_3Ei5h1HOK7Uxrcue448ZmRc0GqQ/`):
`hf_20261022_062556_eb724420-a625-495f-b149-1c692d4d8ea5.glb` → `web/models/wizard/wizard.glb`

## Rejected earlier designs

- **v2, old wizard as the dealer's "sibling"** (26 credits): came out as the
  dealer in a hat (same face, side tufts, mustache, silhouette). Views
  `383d9cb8-…`, `b8597f93-…`, `99c1eba1-…`, `d053de46-…`; mesh `f39083a4-…`;
  rig `35f421dd-…`.
- **v1, young hooded fortune teller** (34 credits): front `ebf7a891-…`, right
  `3957a534-…`, back `1f6ae332-…`, left `fde92b52-…`, mesh `2591c85e-…`, rigs
  `47cd5a76-…` and `0ce100a8-…`.

## In the app

`web/wizard3d.js` draws the model with soft cel shading (his own base-color
texture through a 4-step toon ramp; hemisphere + key + a violet rim light,
like the players' characters), from a slight three-quarter angle a little
above. It draws the model on its rest pose; all motion is in code: a
slow sway, the beard bobbing with a sleepy head bob, his forearms rising and
falling in turn over the ball while it glows / swirls / spins, and a nod when
the quest card appears and when the reel lands. The ball follows his palms
(eased, held still while his hands wave). The pixel wizard stays until a 3D
frame is up, and whenever WebGL or the model isn't there.

Checked on the real v3 rig with the shipped `wizard3d.js`: every mode
renders front-on, intact, the ball over his palms
(`node test/wizard3d_shots.mjs <dir> --model=3d`, 5 checks).

It's on: the model is in `web/models/wizard/wizard.glb` and
`SIDEQUEST.WIZARD_3D` in `hpconfig.js` is `true` (set it `false` to go back
to the pixel wizard).
`?wizard=dealer` runs it on the dealer's rig (same bone names) to test without
the model; `node test/wizard3d_shots.mjs <dir> [--model=dealer|3d] [--video]`
checks it loads, fits the frame, hides the pixel wizard, and shoots every mode.

The model: one skinned mesh, 18,976 triangles, 11,435 vertices, 24 joints.
As delivered it's 7.8 MB (three 2K textures); `scripts/fetch_wizard.sh`
ships it at 1.07 MB (textures at 1024 px WebP, geometry untouched;
checked: it renders the same).

To finish: run `scripts/fetch_wizard.sh` somewhere that can reach
`d8j0ntlcm91z4.cloudfront.net` (the dev sandbox's network policy blocks it),
then `node test/wizard3d_shots.mjs <dir> --model=3d`, and set `WIZARD_3D: true`.
