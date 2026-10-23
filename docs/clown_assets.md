# Humiliation Ritual clown — 3D asset log

The Ritual's host: a goofy, friendly party clown. He shares the Art Gallery
dealer's and Side Quest wizard's **render style** (chibi, about 3 heads tall,
chunky low-poly shapes, matte hand-painted texture, soft shading) and nothing
else: round and a little chubby, white face paint, rosy cheeks, simple happy
eyes, a big round red nose, a bald top with two puffy orange curly tufts at
the sides, a tiny tilted gold hat, a big white ruffled collar with hot pink
edges, a baggy teal jumpsuit with gold and pink polka dots and pom-pom
buttons, oversized white gloves, huge floppy red shoes. Not creepy: no sharp
teeth, no dark makeup. An original design; no existing clown is named in any
prompt. As black silhouettes the three NPCs are a round head on a suit, a
tall cone, and two puffy side tufts over big flat shoes.

Pipeline: `gpt_image_2_5` turnaround views → Tripo H3.1 multi-view → `.glb`
→ turned to face +Z (baked into the vertices with `@gltf-transform`) →
rigged (`3d_rigging`, 1 m tall). Every view passes images, not just text:
the front view had five image inputs, the dealer render (`58bfe7df-…`), the
wizard's front view (`950e05d2-…`), a render of the players' base character
(`fec42003-…`, uploaded from `web/avatar3`) and the two style references
(`913b0391-…`, `f132764c-…`); the other views had the front view plus the
base render and the two style references. Max 3 attempts per step.

| Step | Job | Attempt | Credits | Kept? |
| --- | --- | --- | --- | --- |
| Base character render (uploaded media, the image input) | `fec42003-3303-451c-a9b1-7e04ef6d6fe1` | — | 0 | input |
| Front view (3:4, high, 5 image inputs) | `82a84f0c-327b-49a6-960a-9d7dd11ac92a` | 1 | 1.5 | kept |
| Left view (facing left) | `f567a928-4527-4655-ac4a-26c8300e7b9f` | 1 | 1.5 | kept |
| Back view | `2f885493-a34b-4c57-bb72-10ab0cf68b3a` | 1 | 1.5 | kept |
| Right view (facing right) | `ba8c143e-e2bd-4550-b32e-cf1504651c4c` | 1 | 1.5 | kept |
| Tripo H3.1 multi-view → GLB (20k faces, detailed texture, `align_image`) | `6b4bc70b-11f5-408b-a4a7-e96d26a669bc` | 1 | 12 | kept, after a −90° turn baked in (it faced +X) |
| Front-facing mesh (uploaded media) | `79f86801-d3a5-4c31-b4df-e771de5446ae` | — | 0 | the rig's input |
| Rig, 1 m tall | `134d9756-dcd9-456e-9673-8ffa126786ea` | 1 | 8 | kept (its stock clip isn't used) |

Total: 26 credits.

The model: one skinned mesh, 19,424 triangles, 24 joints (`Hips` … `Head`,
`headfront`, arms, legs). As delivered it's 9.1 MB (three 4K textures);
`scripts/fetch_clown.sh` ships it at 1.14 MB (textures at 1024 px WebP,
geometry untouched) as `web/models/clown/clown.glb`.

## In the app

`web/clown3d.js` draws him with soft cel shading (his own base colour through
a 4-step toon ramp; hemisphere + key + a pink rim light), from a slight
three-quarter angle. All motion is in code, on the rig's rest pose, timed off
the game clock: an idle bounce; juggling a cascade of up to 5 gacha capsules
(a pale see-through top, a bottom in the player's colour, a sticker with the
player's pixel face and name; with more players the faces cycle on each
catch); one tossed high and caught in his mouth (head back, gulp, cheeks
puffed); spat into his hands and held up big; then either twisted open (the
top pops off, on the performer's phone) or peeked into, a gasp, a wink (his
left eye repainted closed in a copy of his own texture, swapped in for the
wink) and a "shhh" with a hand at his mouth (everyone else); a bow on the
results. The 2D capsules (HTML) stay until a 3D frame is up, and whenever
WebGL or the model isn't there; `?clown=2d` pins them.

Arm poses, the mouth point and the eye's texture patch were measured on the
rig: `node test/clown3d_shots.mjs <dir>` loads him, checks the triangle
budget, the bones and the wink texture, and shoots every beat at set moments.
