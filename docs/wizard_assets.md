# Side Quest wizard — 3D asset log

An original hooded fortune teller (violet robe with stars and moons, gold
trim, teal sash, white high-top sneakers), drawn in the same chibi
street-anime style as the characters. The crystal ball is **not** in the
model: it's drawn in code (a glowing, swirling sphere) so it can pulse and
swirl on the quest reveal.

Pipeline: Higgsfield `gpt_image_2_5` turnaround views → Tripo H3.1
multi-view → `.glb` → Meshy rigging with library clips. Max 3 attempts per
view.

| Step | Job | Attempt | Credits | Kept? |
| --- | --- | --- | --- | --- |
| Front view (3:4, high) | `ebf7a891-2586-4834-9b4f-601e36d99a03` | 1 | 1.5 | kept |
| Right view (facing right, 1:1) | `3957a534-d566-4ec7-bfcd-24ee417d0bd7` | 1 | 1.5 | kept |
| Back view (1:1) | `1f6ae332-2316-46fe-aeea-1b306be502e9` | 1 | 1.5 | kept |
| Left view (facing left, 1:1) | `fde92b52-7e22-4630-91c8-5dcc00c0ff0b` | 1 | 1.5 | kept |
| Tripo H3.1 multi-view → GLB (front, left, back, right; 20k faces, detailed texture) | `2591c85e-dda2-409c-951e-aa36c7b1be55` | 1 | 12 | kept |
| Rig + Idle (clip 0) | `47cd5a76-868a-4c73-8c83-adfe9d8a0987` | 1 | 8 | done (unreviewed) |
| Rig + Magic_Genie (clip 77): hands over the ball | `0ce100a8-1f1b-4711-92de-2b3e2319add8` | 1 | 8 | done (unreviewed) |

Total so far: 34 credits (4 × 1.5 views + 12 mesh + 2 × 8 rigs).

## Not yet in the app

The outputs live on Higgsfield's CDN (`d8j0ntlcm91z4.cloudfront.net`),
which this dev sandbox's network policy blocks, so the `.glb` files can't be
pulled into `web/models/wizard/` yet. Until they are, Side Quest keeps the
pixel wizard. Once the host is allowed (or the files are dropped in by
hand), the plan is:

- `web/models/wizard/wizard_idle.glb` and `wizard_cast.glb` (decimated to
  the same budget as the diaries; see `docs/diary_assets.md`).
- A small `web/wizard3d.js` like `diary3d.js`: idle loop while waiting, the
  cast clip during the reveal, the code-made ball between the hands
  (emissive sphere + a swirl shader that speeds up on reveal), falling back
  to the pixel wizard when WebGL or the model isn't available.

GLB URLs (Higgsfield CDN):
- mesh: `hf_20261022_032236_2591c85e-dda2-409c-951e-aa36c7b1be55.glb`
- idle: `hf_20261022_032608_47cd5a76-868a-4c73-8c83-adfe9d8a0987.glb`
- cast: `hf_20261022_032609_0ce100a8-1f1b-4711-92de-2b3e2319add8.glb`

(all under `https://d8j0ntlcm91z4.cloudfront.net/user_3Ei5h1HOK7Uxrcue448ZmRc0GqQ/`)
