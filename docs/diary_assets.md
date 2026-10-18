# Secret Diary 3D assets: kept / rejected log

Three models, loaded once by `web/diary3d.js` and reused for every diary on
screen. Each one is tinted in code; there are no color variants.

| File (`web/models/diary/`) | Triangles | Bytes | What it is |
|---|---|---|---|
| `diary_closed.glb` | 2,642 | 29,436 | closed hardcover diary with clasp, no lock |
| `padlock.glb` | 1,869 | 30,164 | brass padlock, hung on the clasp in code |
| `diary_open.glb` | 2,854 | 33,228 | open diary, two blank pages (answer text is HTML over the page) |

All three are under the ~5k triangle budget; `node test/diary3d_shots.mjs`
fails if one goes over.

## Pipeline

1. **Concept image:** Higgsfield `gpt_image_2_5`, 1:1, two candidates per asset.
2. **Mesh:** Tripo `tripo_p2_image_to_3d` from the kept image, `texture: true`,
   `pbr: false`, `texture_quality: standard`. `face_limit` was 3000 (diaries)
   and 2000 (padlock).
3. **Optimize** (`@gltf-transform/cli` 4):
   - `optimize`
   - `resize` to a 256 px texture
   - `jpeg --quality 82`
   - then a script step: drop normals (the material uses flat shading), quantize, meshopt (`EXT_meshopt_compression` + `KHR_mesh_quantization`)

   About 540 KB raw becomes about 30 KB per model. three.js decodes them
   with `MeshoptDecoder`.

Attempts: **1 per asset** (cap was 3). Each attempt is one image batch of two
candidates, plus one Tripo job.

## Kept / rejected

| Asset | Prompt | Kept image | Rejected image | Tripo job |
|---|---|---|---|---|
| Closed diary | low-poly PS2 era video game prop, small hardcover diary with a leather clasp strap and a brass keyhole plate, faceted geometry, low-resolution crunchy texture, early 2000s console render, plain cover with no text, neutral gray-brown, isolated on plain background, 3/4 view | `b5935e2f` | `8f610b1e` | `258f81be` |
| Padlock | low-poly PS2 era video game prop, small chunky brass padlock, faceted geometry, low-res texture, early 2000s console render, isolated on plain background, front 3/4 view | `556cd6e5` | `22b8b75b` | `0ace6f2e` |
| Open diary | low-poly PS2 era video game prop, small open hardcover diary lying flat, two blank cream pages visible with no writing, leather cover, faceted geometry, low-resolution crunchy texture, early 2000s console render, plain cover with no text, neutral gray-brown, isolated on plain background, 3/4 view from above | `e05d2cbe` | `e431d428` | `41d378f2` |

The rejected images were the other candidate from the same prompt. No mesh
was made from them.

**Why neutral gray-brown:** the tint shader works off luminance. Dark texels
(leather) take the diary color; light texels (paper, brass) mostly keep their
own color.

## Credits

| Item | Count | Each | Credits |
|---|---|---|---|
| `gpt_image_2_5` concept images | 6 | 0.25 | 1.5 |
| `tripo_p2_image_to_3d` meshes | 3 | 34 | 102 |
| **Total** | | | **103.5** |

These match the Higgsfield transaction log for 2026-10-18 (six "GPT Image
2.5 Flare" spends of 0.25, three "Tripo P2 Image to 3D" spends of 34).

## Replacing a model

Keep the file name and run the same optimize steps. Then check
`node test/diary3d_shots.mjs <dir>`: it saves stills and a live shelf
mid-unlock, and prints triangle counts and frame times.

If the new model sits differently, adjust the poses in `Kit.diary()`
(`closedPose`, `lockPose`, `openPose`). The page text boxes in `index.html`
(`.sd-dtext`, `.sd-ztext`) are placed for the current open-diary framing.
