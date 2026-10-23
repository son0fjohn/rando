# NPC scenes: Side Quest's wizard, the Ritual's clown

Side Quest and Humiliation Ritual are built the way the Art Gallery is
(`web/artgallery.js`), with `web/npcscene.js` as the shared kit:

- **Scene:** a painted 9:16 backdrop (`.np-room`, a centred portrait
  column, `width: min(100%, 56.25dvh)`), one fixed front-on camera, no camera
  moves. The NPC and the props live in one group (`.np-group`) placed in its
  own units, so a prop in a hand stays in the hand on every phone.
- **Lighting:** baked into the generated images (same style block as the
  gallery: low-poly PS2-era render, faceted, flat matte shading, film grain,
  muted palette). Players' 3D characters (`web/charrender.js`) are rendered
  with a warm key from the upper left, a soft fill and a gold rim, to sit in
  that light.
- **The NPC:** pose cutouts (600x800 canvases, feet on the same line) that
  crossfade (opacity .14s) with a springy squash/stretch bump, like the
  dealer's idle → unveil. A slow breathe loop under everything.
- **Motion:** few strong beats, each anticipation → action → hold, fired off
  the synced game clock (`Beats`). Thrown things fly real gravity arcs
  (`arcTo`) and land on a set moment; a prop that becomes UI flies from where
  it is in the scene to where the card lives, as the same element (`flyFrom`).
- **UI layering:** HUD on top, a status pill under it, a title at 100px, the
  big card on the wall, the plaque (ratings, the guess box, the feed) at the
  bottom above the safe area, the host's skip bottom right. The NPC scene
  stays up behind every phase of a turn.

## Side Quest (`web/games/sidequest/`)

The wizard (idle / conjure / reveal) behind a velvet table, the crystal ball
on it under his hands. The ball flicks through everyone's 3D heads and lands
on the chosen one; the quest card rises out of the ball onto the wall and is
that turn's card; the rating plaque sits over the table.

## Humiliation Ritual (`web/games/ritual/`)

The clown (idle, twist, catch, hold, open, peek, shh) next to a gacha machine
on a circus drum. Everyone's capsule is in the globe (their 3D head inside
the dome). He grabs the dial and cranks it two turns, the globe rattles, the
performer's capsule drops into the works and pops out of the chute on an arc
into his hands, and he holds it up: "[Name], you're up!". On the performer's
phone he cracks it open, the lid flies off and the slip unrolls out of the
cup and flies up to become the ACT IT OUT card. Everyone else sees him peek,
wink and go "shhh" with the capsule shut. While they act, the performer's own
3D character stands in a spotlight where the machine was. At the reveal he
cracks it open for everyone and the answer flies up onto the wall.

A juggling pick was tried first (two pose frames, `clown_jugA/B`, with the
capsules on gravity arcs between the palms in a cascade). With two drawn
frames the hands snap and the capsules jump from palm to palm, so it read as
a flipbook; the gacha machine shipped instead.

## Asset log

Every image is `gpt_image_2_5` (1.5 credits each), one attempt each, with
image inputs, never text only. The inputs:

- `f0d6fa18…`: the Art Gallery's `gallery.jpg` (the style and camera)
- `2c0f6b4b…`: the gallery dealer's unveil pose (the pose-cutout style)
- `950e05d2…`: the wizard's front view
- `82a84f0c…`: the clown's front view
- `fec42003…`: a render of the players' base character
- `913b0391…`, `f132764c…`: the two style references

| Asset | Job | Image inputs | Credits |
| --- | --- | --- | --- |
| `sidequest/parlour.jpg` | `ff28c8de-3b4d-4209-858a-b96d8c8ece2f` | gallery, wizard, base, both refs | 1.5 |
| `ritual/stage.jpg` | `cd2fb916-31c1-4b74-8c20-a0db028fdfb2` | gallery, clown, base, both refs | 1.5 |
| `sidequest/ball.webp` | `b00ba863-a6c4-4325-8b61-0f1049870965` | gallery, wizard, both refs | 1.5 |
| `sidequest/table.webp` | `4c269bc7-d692-4f64-863d-cc04d06fcce0` | gallery, wizard, both refs | 1.5 |
| `ritual/gacha.webp` (+ `dial.webp` cut from it) | `aa130ba6-f1ff-4306-ae3c-fc6f0245bf04` | gallery, clown, both refs | 1.5 |
| `ritual/capsule.webp` (+ `capsule_top.webp`) | `a5bbead7-c686-446a-98c5-efd85095ba79` | gallery, clown, ref | 1.5 |
| `ritual/capsule_bottom.webp` | `b34e3141-d095-431c-8cf2-67ae7982c278` | gallery, clown, ref | 1.5 |
| `wizard_idle` | `fe25ad6c-4c21-42ef-8521-219e1e28e73e` | wizard, dealer, base, both refs | 1.5 |
| `wizard_conj` | `dc988128-20ad-4ce3-bb95-ecb56dd977ca` | wizard, dealer, base, both refs | 1.5 |
| `wizard_rev` | `57702bdd-58ff-4f28-b8a3-e5178623d5eb` | wizard, dealer, base, both refs | 1.5 |
| `clown_idle` | `4583df0a-b97b-4660-adbb-3ab31ae79ec3` | clown, dealer, base, both refs | 1.5 |
| `clown_jugA` (not shipped) | `625ae300-265b-4167-add1-48dcf90bbb7e` | clown, dealer, base, both refs | 1.5 |
| `clown_jugB` (not shipped) | `3833c0ed-1983-482c-af6c-69109dc26b2f` | clown, dealer, base, both refs | 1.5 |
| `clown_hold` | `7e7c5a42-77e1-4419-addc-0dee28acf821` | clown, capsule, dealer, base, both refs | 1.5 |
| `clown_open` | `1f8d795e-42d9-4da7-8735-b6956e50fd7f` | clown, capsule bottom, dealer, base, both refs | 1.5 |
| `clown_peek` | `15ae5984-a9e2-4264-833d-471cc1023544` | clown, capsule, dealer, base, both refs | 1.5 |
| `clown_shh` | `6d74aed7-23a2-4188-b041-14f3ce8e4933` | clown, capsule, dealer, base, both refs | 1.5 |
| `clown_twist` | `d762bcd7-2ce3-46c9-82db-1e459d022130` | clown, gacha, dealer, base, both refs | 1.5 |
| `clown_catch` | `87a6cc77-0618-4a3d-b139-f059f3a3b75a` | clown, dealer, base, both refs | 1.5 |
| `ritual/pedestal.webp` | `1c0080e1-ff85-430a-bd4e-c7e4c37d5576` | gacha, gallery, clown, ref | 1.5 |

Total: 30 credits.

The poses were normalized onto 600x800 canvases (figure 740 tall, shoes
centred at the bottom; the catch pose at the idle's scale), their alpha
cleaned (cut at 60, 120 for two with a white halo) and saved as WebP. Hand,
cup, dial and chute positions were measured on the cutouts; they're the
constants at the top of `web/hpgames/ritual.js` and `sidequest.js`.

The 3D wizard and clown (`wizard3d.js`, `clown3d.js`, their GLBs and logs)
are retired; their generation logs are in git history.
