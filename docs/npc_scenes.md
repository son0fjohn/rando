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

## The retro look (pilot: Side Quest's nook)

The game scenes are moving from painted backdrops to small low-poly 3D
rooms with the world map's feel. `web/retrolook.js` is the shared kit; a
scene passes it a mood:

- **Lighting:** a warm key, a cool coloured fill/rim, a low ambient tinted to
  the mood (hemisphere). Nothing neutral white. Point lights for candles and
  glowing props, with a flicker.
- **Fog** in the scene's colour, so the back of the room melts away.
- **Glow:** a bright pass + two blur passes at half resolution: only what's
  near white blooms (candle flames, the crystal ball, lanterns, the window),
  not the lit surfaces.
- **Render:** the 3D layer is drawn at 0.5× CSS pixels like the world map
  (capped at 400 px wide, never below 0.36×) and upscaled nearest; then a warm grade, a limited palette with a
  4×4 ordered dither, a vignette and a faint grain. The UI is DOM on top and
  stays sharp.
- **Low-poly helpers:** flat-shaded Lambert, ambient occlusion baked into
  vertex colours, blob shadows, textures at 256 px max with nearest filtering,
  glTF PBR swapped for Lambert.
- **Ambient life:** dust motes, flickering lights, a breathing camera.
- **Performance:** a weak phone (≤3 GB or ≤4 cores, or `?retro=low`) gets
  0.8× the resolution and no bloom or grain; if frames still run slow for a
  few seconds the kit drops the bloom, then the resolution, by itself.

`web/sqnook.js` is the pilot: the wizard's nook at night (draped violet
fabric, a round window onto the world map's night sky with drifting clouds,
a potion shelf, a stack of spell books, star lanterns, floating candles, a
rug), lit by candle amber against violet moonlight. The crystal ball is a
light source that pulses on the reveals. The wizard is his pose cutouts on
a card in the room, lit by it in a small shader: candle light from one side,
a violet rim read off the cutout's edge, the ball's glow from below, the
fog. Players' 3D looks float in the ball, tinted by its light. If WebGL or
the models aren't there, the painted parlour stays (`?nook=0` pins it).
`node test/nook_shots.mjs <dir>` shoots each beat.

### Nook assets

The props are `gpt_image_2_5` images, each with four image inputs: a night
screenshot of our world map (`c28d4940…`, uploaded), the wizard's front view
(`950e05d2…`) and the two style references (`913b0391…`, `f132764c…`). They
were turned into meshes with Tripo H3.1 image-to-3D (no PBR, face limits
1.5–3k), then the 2048 px textures were cut to 256 px (gltf-transform + sharp,
geometry untouched: 1.4–2.7k triangles each). One attempt each.

| Asset | Image job | Mesh job | Credits |
| --- | --- | --- | --- |
| `nook/shelf.glb` (potion shelf) | `d8739fdc-c8ec-4e44-b49e-8fc4c4fc68e9` | `4f71d886-3720-4ba4-ab48-8d61a35fa668` | 1.5 + 9 |
| `nook/table.glb` (draped table + ring stand) | `42c46e08-6fcc-4f17-9368-a4dfca2ae8d8` | `1fbd6684-e68b-430c-92ba-fa40f8293671` | 1.5 + 9 |
| `nook/lantern.glb` (star lantern) | `92cc8ea3-77c4-4954-b388-67f0ae2002cd` | `a45e5ccf-3580-4652-a2a8-12cacbbac930` | 1.5 + 9 |
| `nook/books.glb` (spell books + candle) | `7857b47d-cc08-4b5e-8339-7f04b1ce95c1` | `e1e4abc7-a7cc-434a-ac82-053d15b2da15` | 1.5 + 9 |

Total: 42 credits. The room itself (drapes, window, rug, candles, the ball)
is built in code from low-poly primitives.

## The other rooms (`web/retrorooms.js`)

The same kit, each with its own mood:

- **Humiliation Ritual: a circus tent at night.** Red-and-cream striped
  canvas, a round stage, two stage spotlights with soft light cones, string
  lights, confetti drifting down. The clown, the gacha machine, the capsules
  and the performer's 3D figure are still the DOM elements whose CSS
  transitions and gravity arcs run the show, now hidden: every frame
  `mirrorDom` copies each one's box, rotation, scale and opacity onto a card
  in the tent, lit by it (`litCardMaterial`: the spotlights' warm key, a blue
  rim, a warm bounce from the stage). Choreography and timing are unchanged.
  `RITUAL.TENT_3D`; `?tent=0` pins the painted stage.
- **Secret Diary: a cozy study / bedroom late at night.** A window with the
  moon and the map's night sky, moonlight coming in, a desk under a warm lamp,
  a bed, a bookshelf, posters, fairy lights, floating dust.
- **Mask Off: a dim lounge.** One pendant light over a red velvet booth,
  candles on two side tables, deep reds and purples, slow smoke haze.

Secret Diary and Mask Off play on cards, so their room sits behind them
(`roomBackdrop()` in `hpkit.js`) and the cards stay crisp and frosted on
top; `?rooms=0` turns the rooms off. `node test/rooms_shots.mjs <dir>`
shoots each room.

### Room assets

Same pipeline as the nook: `gpt_image_2_5` with image inputs (the night map
`c28d4940…`, the two style references `913b0391…`/`f132764c…`, plus the
circus stage `cd2fb916…` for the tent props and the base character render
`fec42003…` for the study props), Tripo H3.1 image-to-3D without PBR, then
textures cut to 256 px. One attempt each.

| Asset | Image job | Mesh job | Credits |
| --- | --- | --- | --- |
| `rooms/tent/spot.glb` (stage spotlight) | `f2cbc5a1-153f-4da1-bf57-85c158474fcc` | `73c8f092-1b13-4bfd-8587-092fff7c206d` | 1.5 + 9 |
| `rooms/tent/crates.glb` (circus crates) | `795404e2-c51b-4b8e-9058-198ceee91762` | `cffd8443-4038-463e-aec6-546ab513c9e4` | 1.5 + 9 |
| `rooms/study/desk.glb` (desk + lamp) | `76e34eda-b135-4d42-a80b-05ea7e896f8d` | `b63cda12-13d7-45a7-bbc2-d1d209476127` | 1.5 + 9 |
| `rooms/study/bed.glb` (bed + quilt) | `5a63c3f0-4414-4716-9c71-dd2d32be92d0` | `b517cf9d-439d-47e5-b4e4-73727dd56908` | 1.5 + 9 |
| `rooms/lounge/sofa.glb` (velvet booth) | `2c94a863-6675-420d-978a-513faab09ef0` | `12ce1f6e-f2db-4e31-80e0-a351f8dae9f4` | 1.5 + 9 |
| `rooms/lounge/sidetable.glb` (side table + candle) | `5a606173-b08d-4d75-89e3-e05998a6d56a` | `417cf732-b355-4feb-abab-a8c16179b1c5` | 1.5 + 9 |

Total: 63 credits.
