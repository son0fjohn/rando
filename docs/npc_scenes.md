# NPC scenes: Side Quest's Prophet, the Ritual's Boss

Both games' hosts are rigged low-poly 3D characters, lit live, in a room
that is real geometry painted with an approved picture (camera mapping), so
the default view looks almost exactly like that picture and you can still
look around. They share:

- `web/npcstage.js`: the look-around camera (one component, one set of
  settings: -24° to the left, 35° to the right, a little up and down, pinch
  to zoom in a bit, momentum, home ~4 s after the last touch; never locked,
  not even during a pick or a reveal), tap picking,
  the head that follows the camera, the shader bits that put a live-lit
  character into a painted room (`encode`, `underTable`), the smoke wisp.
- `web/projroom.js`: the camera mapping (the projector, its depth map, the
  painted material with its fallback tile, `crop()`, `onPlane()`), with up
  to two side projectors: the same room seen from the camera orbited 45°
  round the table to the left and the right (`left.webp`, `right.webp`,
  Nano Banana Pro from the approved picture). The front paints whatever it
  sees (so the default view is still exactly the picture); side walls,
  corners and what it sees almost edge-on take the side views, blended by
  how squarely each one sees the surface.
  Each side view's alpha masks out the table and what's on it (they never
  line up with the room's own props).
  **Layers** (the basement): the room's shell (walls, floor, ceiling, the
  door, the shelves) is painted from `empty.webp`, the approved picture with
  the table, chair, lamp and what's on the table taken out (Nano Banana Pro,
  edited from the picture itself; pixel-aligned with it), using depth maps
  that leave the furniture out; the furniture is painted from the picture.
  So looking around, nothing of the table, the cup or the chair legs is ever
  smeared on the floor or the wall behind them (the "ghost doubles" the
  orbit used to show). Sides of furniture no picture saw take a tile of the
  picture (its cardboard, its table top) in its own tones.
  The orbit stops at -24° on the left (further, the table lamp stands in
  front of the Boss's box and the Prophet's ball) and 35° on the right.
- `web/dialog.js`: the dialog box (below).
- `web/npcscene.js`: the DOM side: `Beats` (beats fired off the synced game
  clock), `flyFrom` (a card flying out of the scene to where it lives),
  `confetti`.
- **UI layering:** HUD on top, a status pill under it, a title at 100px, the
  big card on the wall, the panel (the clock, the guess box, the feed) above
  the dialog box at the bottom, the host's skip just over it. The scene stays
  up behind every phase of a turn.

## Side Quest: The Prophet in the rooftop room (`web/prophet.js`, `web/rooftop.js`)

The wizard is gone. Side Quest's host is The Prophet: a big puffy purple
jacket, a starry purple hat over a black durag with long tails, small round
dark shades, a gray goatee, a gold chain and a pipe, sitting cross-legged on
the floor behind a low table in a rooftop room (옥탑방) at night that teens
have taken over. The approved picture is the target: the default view (before
anyone moves the camera) looks almost exactly like it.

- **The room is real geometry, painted with the picture** (camera mapping).
  The default camera was solved from the picture's perspective (`PROJ` in
  `rooftop.js`: 1.02 m up, 11.7° down, 46° vertical field at 9:16; the door
  wall 3.3 m behind him), then every piece was placed by unprojecting where
  it sits in the picture onto its plane: the walls and the doorway, the TV and
  its cabinet, the couch and the teddy bear, the fridge, the shelf, the
  rooftop outside (its floor, the parapet, the city as a far backdrop), the
  low table and everything on it, the lamp. A shader projects the picture
  from that camera onto them, so from the default view the room is the
  picture; look around and the same paint sits on the 3D shapes.
  - **Occlusion:** a depth map from the projector (once, at load) says which
    surfaces the picture actually saw; the rest (behind the couch, the side
    walls, past the picture's edges) falls back to a tile cut from it (graffiti
    for walls, the rug for the floor) or a flat colour with a simple soft
    light, plus posters and tags cut from the picture, more string lights and
    a few props (crates, a beanbag, a floor mattress, a speaker), so every
    allowed angle looks finished.
  - **The clean plate:** where he, the ball and the dialog box are in the
    picture, the paint comes from a version of it with them painted out, so
    they're never painted onto the room behind his live model.
  - **Light:** the paint carries the picture's light, so the room is unlit;
    the lamp shade, the TV and the string-light bulbs get a little animation
    on top. He's lit live by lights where the picture's are: a pink-purple
    ambient, a warm key from the front left, a violet fill, the lamp, the
    TV's pink, the door's night blue, the string lights. Under the table his
    legs are in its shadow.
  - **Colour:** the stage is `encoded` (`retrolook.js`): the buffer holds
    display-ready colour, the paint is written as the picture's own pixels
    and his materials encode to sRGB themselves, so darks don't band and the
    picture comes through unchanged (no grade, no bloom). Drawn at 1× CSS
    pixels and softly upscaled with 4× MSAA.
- **Him:** the same rigged mesh (below), posed cross-legged (thighs and shins
  solved on the rig), elbows out on the table's back edge, fists by the ball;
  sleeves, fists, hat and jacket a little bigger to match the picture's
  proportions (bone scales). Poses: idle (breathing, a slight head tilt, a
  pipe puff), reveal (leans in, hands out over the ball, ball brighter),
  point (right arm out at the camera), nod. Pipe smoke, the ball's glow, a
  slow camera push-in on the key moments.
- **Look around** (`npcstage.js`, the same camera as the Boss's): drag to
  orbit (-24° … 35°, a little up and down; pinch to zoom in a bit), eased with
  a little momentum, gliding home ~4 s after the last touch, never mid-drag
  and never locked. His head turns a little toward the camera. A slight tilt parallax where the browser allows it without
  a prompt (`?tilt=0` turns it off).
- **Taps:** him (between beats: a short line in the dialog box and a nod or a
  pipe puff), the ball (pulse and swirl), the lamp (flicker), the TV (a burst
  of static). None of them touch the game state.
- **Dialog box** (`web/dialog.js`, shared with the Ritual's Boss; the map
  NPCs are next): navy at ~86%, a thin light bevelled border, the speaker's
  name on a tab (semibold), big regular text in the app's font (SF Pro,
  Apple SD Gothic Neo for Korean) typed letter by letter with a soft blip
  (tap to skip), a blinking ▼, choices as boxes in the same style (stacked, or
  a row for a rating). His lines are in English or Korean by the phone's
  language; while the host picks the quests: "Sit down, kid. Fate's got a job
  for you."
- **The pick** (`hpgames/sidequest.js`, ~4.7 s): faces flick through the
  ball like a slot machine, fast then slowing, a tick each over a drumroll
  (~3 s). It lands: a flash from the ball, a light shake, a chime, and the
  name slams onto everyone else's screen in big gold letters (~1.5 s) with a
  "[Name] got picked" banner; the chosen player's own phone goes gold, "THE
  BALL PICKED YOU", with a strong buzz. Their own 3D character pops in
  (a puff) sitting cross-legged on a floor cushion at his table's right end,
  just behind its back corner, turned ~45° toward him, under a warm light
  (`guestSpot` in `npcstage.js`), surprised; they stay for the turn, looking
  between him and the camera now and then, and pop out the same way; he points at them (`aim`): "Relax. The
  ball already knows who's next... [Name]."
- **The reveal** (~5 s): he takes a big drag and blows a swirl of smoke over
  the ball that gathers into a glowing card, flips round to the camera
  (`smokeCard()`) and becomes the quest card; "SIDE QUEST" is stamped on it
  with a thud and a puff of dust. Then 3, 2, 1, GO; the clock starts and
  their character cheers. The host's skip button reads "skip ▸▸" during both.
- **No 3D:** if WebGL or the room can't load, the screen is plain with a
  simple glowing ball; never the old wizard, never a picture of him.

`node test/prophet_shots.mjs <dir>` shoots every pose and the default view
(`0-default.png`, for the side-by-side with the picture) and checks looking
around and the taps with real pointer input; `node test/games_rec.mjs <dir>
sidequest` records turns.

### The rooftop room's assets (`web/games/sidequest/rooftop/`)

- `plate.webp` (752×1344): the approved picture, with the clean plate where
  he, the ball and the dialog box were (a hand-drawn mask, dilated and
  feathered).
- The clean plate: Flux Kontext (`flux_kontext`) edit of the picture
  (uploaded as `238ae258-f930-4f3e-aa9d-fbae59b80413`): job
  `0af534b1-1285-47e9-b445-aa132901bd09`, used (a second variant from the
  same request, `2ec8879c-d395-49c2-a36a-78368d2fa484`, dropped the table
  clutter). 3 credits. It came back 3% taller; it was registered back onto
  the picture (scale + offset fitted on the areas he never covers).
- `wall.webp`, `rug.webp`: tiles cut from the plate (graffiti; the rug).
- `left.webp`, `right.webp`: the side views (Nano Banana Pro, the plate as
  the image reference: "the same room, camera orbited 45° left / right
  round the table, no people"), jobs `2203279f-80c7-4f92-9125-b302b83137fc`
  and `87dd029a-3894-4bf4-8f4c-4df32195e7a6`, 2 credits each; resized to
  752×1344 and the table masked out in their alpha. The basement's are
  `2ab552b1-414a-420f-8914-1563a19d36aa` and
  `67683532-f403-4877-953a-6f587af3d60a` (`web/games/ritual/basement/`).

The Prophet model itself was not regenerated: it is the one built from the
same turnaround (below).

### The Prophet's model

Tripo H3.1 multi-view to 3D (`tripo_h3_1_multiview_to_3d`, no PBR, 12k face
limit, 12 credits each), from the supplied turnaround sheet cut into views
(front `65f7f38f-a22c-4bd1-bc76-34ea470e5b12`, back
`31f74ba4-d7cf-4432-80c8-779d1dadf95d`, left `633f0c6c-4f40-4708-9ef1-e9a9d6640484`,
right `99576e4e-0d4d-49d9-93bd-6ce1ed7416db`):

| Attempt | Job | Views | Result | Credits |
| --- | --- | --- | --- | --- |
| 1 | `f93c742e-626a-4917-96f1-59a2a6b233be` | front, side (`ea7a0ac0-d42a-4d4d-bcb5-c420208204bf`, unmirrored), back | a second face and pipe on the back of the head: the side view faced the wrong way for the "left" slot | 12 |
| 2 | `1a63c5f5-45c4-4d2c-8558-be66b349c0a9` | front, left (the side view mirrored), back, right | used | 12 |

Total: 24 credits, 2 of the 3 allowed attempts. Cleanup (scripted, not by
hand): welded and simplified to 4,600 triangles (meshoptimizer); the texture posterized to a flat palette (nearest colour in Lab,
per body region) except a face mask painted from the UV layout, so only the
face keeps its texture; then rigged in code with procedural skin weights by
region and distance to each bone segment.

To match the reference the face was repainted: the texture went to 2048 px,
a straight-on orthographic render of the head was made from it (the mesh
rasterized in UV space, so every texel knows its 3D spot), the half-lidded
anime eyes and the small round shades low on the nose were painted in that
front view, and the paint was projected back onto only the texels of the
visible front of the face (so it sits right from every angle). The hat's
stars went from bright gold to the reference's muted tan (the chain keeps its
gold). In the scene his hands and head are scaled up a little (the
reference's big fists and hat) and the jacket 7% wider. 406 KB.

## Humiliation Ritual: The Boss in the basement (`web/boss.js`, `web/basement.js`)

The clown is gone (his pose cutouts, the gacha machine and the circus tent
were deleted; they're in git history). The Ritual's host is The Boss: an old
mafia boss whose only clown is his face paint (white base, heavy-lidded eyes
with blue diamonds, a round red nose, a smudged red smile), slicked-back gray
hair, a cream pinstripe suit with wide lapels, a burgundy shirt open at the
chest, gold chains, rings and a watch, a cigar with a thin wisp of smoke. He
sits back in a folding chair behind a gray folding table in a plain gray
basement. The approved picture is the target: the default view looks almost
exactly like it, without its crystal ball.

- **The room** (`basement.js`) is camera-mapped like the rooftop: the
  picture's camera solved from the door, the floor line, the table's edge and
  the shelf (`PROJ`: 1.53 m up, 11.5° down, 39.4° vertical field at 9:16; the
  back wall 8.1 m from the camera), the walls, the bulkhead, the door, the
  metal shelf with its boxes and yellow bin, the folding chair, the folding
  table and on it the box of capsules, the glass ashtray, the paper cup and
  the lamp, all placed by unprojecting where they sit in the picture. The
  walls the picture never saw use its own concrete as a tile; a second shelf,
  stacked boxes and a fuse box finish the sides. Small life: a slow haze
  drifting through the light, a very subtle lamp flicker.
  - **The clean plate:** a Flux Kontext edit of the picture with him, the
    ball and the dialog box removed (an empty chair where he sat), registered
    back onto the picture and composited under a hand-drawn mask (his outline,
    the smoke, the ball, his legs under the table, the dialog).
- **Him** (`boss.js`): the rigged mesh (below), posed sitting back in the
  chair, his right forearm resting on the box's edge, the cigar up by his face
  in his left hand (both arms solved on the rig for the picture's elbows and
  wrists), a bigger body and smaller head than the turnaround's (the
  picture's proportions). Lit soft and even (a bright neutral ambient, a weak
  key from the front left, the lamp's warmth), in the table's shadow below its
  top; colours checked patch by patch against the picture. The cigar (with
  its ember), two gold rings and, for "shhh", a raised index finger are small
  meshes riding his hands; the capsule rides his right hand but always turns
  its dome to the camera, the player's own 3D face inside it and their name
  under it.
- **Animations** (procedural, on the bones, blended quickly, no float): idle
  (slow breathing, now and then a slow drag on the cigar and an exhale from
  his mouth, a slight head tilt), reach (leans in, hand into the box), hold
  (the capsule up to the camera), twist (the wrist turns, the lid pops off
  and flies), peek (head down over it) with a smirk (a head cock), shhh (fist
  under his chin, a finger to his painted lips), nod (slow, approving), sip
  (the cup tap). His head follows the camera a little.
- **The turn** (`hpgames/ritual.js`, the same game logic): "Pick a capsule.
  Any capsule." He reaches into the box and comes out with a capsule, holds
  it up to the camera with the performer's face and name: "[Name]. You're
  up." Held up, the capsule spins with players' faces flicking through it
  like a slot machine, slowing over a drumroll, and lands on the performer's:
  a flash, a light shake, the name slams in (everyone else also gets "[Name]
  is performing"); the performer's phone goes to a red spotlight, "YOU'RE
  UP", with a strong buzz. Their own 3D character pops in (a puff) standing
  at his table's right end, back by the door, turned ~45° toward him under a
  soft spotlight, and stays for the turn, looking between him and the camera; he takes a slow drag on his cigar. Then he twists the capsule open,
  pop, confetti. On the performer's phone the slip unrolls out of it and
  flies at the camera, filling the screen, and a red ACT IT OUT stamp slams
  onto it; everyone else sees him peek, smirk and go "Shhh.", then the guess
  box slides up. Pick + reveal ≈ 8 s (the host can skip). Never locked: the
  name, the stamps and the cards are screen-space overlays (`npcscene.js`),
  readable from any angle. While they act he sits back with his cigar; a
  slow approving nod and a line close the turn. Lines in English or Korean
  by the phone's language.
- **Taps** (never during the pick or the open, never in the game state): him
  (a line: "Patience. Business takes time." / "You owe me a laugh, kid." /
  "Nobody leaves until somebody performs.", and a drag on the cigar or a slow
  nod), the box (the capsules rattle), the cup (he takes a sip), the lamp (it
  flickers).
- **No 3D:** if WebGL or the room can't load, the room is plain gray with the
  dialog box; never the old clown, never a picture of him.

`node test/boss_shots.mjs <dir> [--video]` shoots every beat and the default
view (`0-default.png`) and checks looking around and the taps with real
pointer input (`--video` with `FFMPEG=...` films the look-around and the
taps); `node test/games_rec.mjs <dir> ritual` records a turn on two phones.

### The basement's assets (`web/games/ritual/basement/`)

- `plate.webp` (752×1344): the approved picture with the clean plate
  composited where he, his smoke, the ball and the dialog box were.
- The clean plate: Flux Kontext edit of the picture (uploaded as
  `d1c71847-f818-487e-b7df-06222e2e4aa6`): job
  `1d53f20e-7f26-4254-b5a3-ae8454a13245`, used (the other variant,
  `d8312406-c92c-4296-b11c-dc58d06531ca`, dropped the box of capsules).
  Counted in the Boss's total below. It came back 752×1392; registered back onto the picture
  (scale 1.01 × 0.9675, offset 8, 2).

### The Boss's model (`web/games/ritual/boss/boss.glb`)

Tripo H3.1 multi-view to 3D (`tripo_h3_1_multiview_to_3d`, no PBR, detailed
texture, 12k face limit, 12 credits each), from the supplied turnaround
sheet cut into views (front `10097f49-78ba-4552-9906-ee897a642a50`, his
right side `20ee521a-317b-4aac-bb3c-2c6cd7812d4d`, back
`0197516c-aea2-4078-ad0b-cb6f4053fe28`):

| Attempt | Job | Views | Result | Credits |
| --- | --- | --- | --- | --- |
| 1 | `c04ae68c-75f6-4316-8d82-9dbc7fcbf43e` | front, left (the side view mirrored, `0898032e…`), back, right | a good mesh, but his right hand is fused into his trouser pocket and the arm into the jacket: any pose that brings that arm forward (resting on the table, reaching, holding the capsule up, "shhh") tears the cloth | 12 |
| 2 | `2ce28dab-b468-41ae-95f3-fabad9cf7b5e` | the same views edited first: both arms hanging a little away from the body, hands open, no cigar (front `9a05664b…`, back `9b007775…`, side `92e81755…` and its mirror `94d10176…`) | used: clean arm gaps; the cigar is a prop in his hand | 12 |

The view edits are Flux Kontext (`flux_kontext`):
an attempt at a true left-side view (`c13132d7…`, `f4cfd68f…`, both came
back facing the wrong way, not used), the arms-down front and back
(`26cb2930…`, `9a05664b…`, `67adcf72…`, `9b007775…`) and side (`aafdb20b…`,
`92e81755…`). Total for the Boss, the edits and the clean plate: 43 credits
(the balance went from 635 to 592: 24 for Tripo, 19 for the Flux edits);
2 of the 3 allowed Tripo attempts.

Cleanup (scripted, not by hand): welded and simplified to 4,600 triangles
(meshoptimizer); the texture posterized to a flat palette (nearest colour in
Lab: cream, a stripe colour kept as thin pinstripes, the burgundy shirt,
skin, gray hair, the shoes, gold), the face kept as painted (the face paint
is part of the face texture, a touch whiter); smooth normals; a skeleton at
the model's own joints with skin weights by distance along the surface
(geodesic, seeded on each bone's own limb), so a sleeve never drags the
jacket beside it. 4,600 triangles, 3,546 vertices, 20 joints, a 2048 px
WebP texture: 427 KB.

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
| `sidequest/parlour.jpg` (retired) | `ff28c8de-3b4d-4209-858a-b96d8c8ece2f` | gallery, wizard, base, both refs | 1.5 |
| `ritual/stage.jpg` (retired) | `cd2fb916-31c1-4b74-8c20-a0db028fdfb2` | gallery, clown, base, both refs | 1.5 |
| `sidequest/ball.webp` (retired) | `b00ba863-a6c4-4325-8b61-0f1049870965` | gallery, wizard, both refs | 1.5 |
| `sidequest/table.webp` (retired) | `4c269bc7-d692-4f64-863d-cc04d06fcce0` | gallery, wizard, both refs | 1.5 |
| `ritual/gacha.webp` (+ `dial.webp` cut from it) (retired) | `aa130ba6-f1ff-4306-ae3c-fc6f0245bf04` | gallery, clown, both refs | 1.5 |
| `ritual/capsule.webp` (+ `capsule_top.webp`) (retired) | `a5bbead7-c686-446a-98c5-efd85095ba79` | gallery, clown, ref | 1.5 |
| `ritual/capsule_bottom.webp` (retired) | `b34e3141-d095-431c-8cf2-67ae7982c278` | gallery, clown, ref | 1.5 |
| `wizard_idle` (retired) | `fe25ad6c-4c21-42ef-8521-219e1e28e73e` | wizard, dealer, base, both refs | 1.5 |
| `wizard_conj` (retired) | `dc988128-20ad-4ce3-bb95-ecb56dd977ca` | wizard, dealer, base, both refs | 1.5 |
| `wizard_rev` (retired) | `57702bdd-58ff-4f28-b8a3-e5178623d5eb` | wizard, dealer, base, both refs | 1.5 |
| `clown_idle` (retired) | `4583df0a-b97b-4660-adbb-3ab31ae79ec3` | clown, dealer, base, both refs | 1.5 |
| `clown_jugA` (not shipped) | `625ae300-265b-4167-add1-48dcf90bbb7e` | clown, dealer, base, both refs | 1.5 |
| `clown_jugB` (not shipped) | `3833c0ed-1983-482c-af6c-69109dc26b2f` | clown, dealer, base, both refs | 1.5 |
| `clown_hold` (retired) | `7e7c5a42-77e1-4419-addc-0dee28acf821` | clown, capsule, dealer, base, both refs | 1.5 |
| `clown_open` (retired) | `1f8d795e-42d9-4da7-8735-b6956e50fd7f` | clown, capsule bottom, dealer, base, both refs | 1.5 |
| `clown_peek` (retired) | `15ae5984-a9e2-4264-833d-471cc1023544` | clown, capsule, dealer, base, both refs | 1.5 |
| `clown_shh` (retired) | `6d74aed7-23a2-4188-b041-14f3ce8e4933` | clown, capsule, dealer, base, both refs | 1.5 |
| `clown_twist` (retired) | `d762bcd7-2ce3-46c9-82db-1e459d022130` | clown, gacha, dealer, base, both refs | 1.5 |
| `clown_catch` (retired) | `87a6cc77-0618-4a3d-b139-f059f3a3b75a` | clown, dealer, base, both refs | 1.5 |
| `ritual/pedestal.webp` (retired) | `1c0080e1-ff85-430a-bd4e-c7e4c37d5576` | gacha, gallery, clown, ref | 1.5 |

Total: 30 credits.

The poses were normalized onto 600x800 canvases (figure 740 tall, shoes
centred at the bottom; the catch pose at the idle's scale), their alpha
cleaned (cut at 60, 120 for two with a white halo) and saved as WebP. Hand,
cup, dial and chute positions were measured on the cutouts; they're the
constants at the top of `web/hpgames/ritual.js`. The wizard's and the
clown's art (marked retired above) left with them; it's in git history.

The 3D wizard and clown (`wizard3d.js`, `clown3d.js`, their GLBs and logs)
are retired; their generation logs are in git history.

## The retro look

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

Side Quest's fortune-teller nook (`web/sqnook.js`) was the pilot for the
kit. It and its props (`nook/shelf|table|lantern|books.glb`, image jobs
`d8739fdc…`, `42c46e08…`, `92cc8ea3…`, `7857b47d…`, mesh jobs `4f71d886…`,
`1fbd6684…`, `a45e5ccf…`, `e1e4abc7…`, 42 credits) are retired with the
wizard; the Prophet's back room above uses the kit's smooth mood instead.

## The other rooms (`web/retrorooms.js`)

The same kit, each with its own mood:

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

Same pipeline as the (retired) nook: `gpt_image_2_5` with image inputs (the night map
`c28d4940…`, the two style references `913b0391…`/`f132764c…`, plus the
circus stage `cd2fb916…` for the tent props and the base character render
`fec42003…` for the study props), Tripo H3.1 image-to-3D without PBR, then
textures cut to 256 px. One attempt each.

| Asset | Image job | Mesh job | Credits |
| --- | --- | --- | --- |
| `rooms/tent/spot.glb` (stage spotlight, retired with the tent) | `f2cbc5a1-153f-4da1-bf57-85c158474fcc` | `73c8f092-1b13-4bfd-8587-092fff7c206d` | 1.5 + 9 |
| `rooms/tent/crates.glb` (circus crates, retired with the tent) | `795404e2-c51b-4b8e-9058-198ceee91762` | `cffd8443-4038-463e-aec6-546ab513c9e4` | 1.5 + 9 |
| `rooms/study/desk.glb` (desk + lamp) | `76e34eda-b135-4d42-a80b-05ea7e896f8d` | `b63cda12-13d7-45a7-bbc2-d1d209476127` | 1.5 + 9 |
| `rooms/study/bed.glb` (bed + quilt) | `5a63c3f0-4414-4716-9c71-dd2d32be92d0` | `b517cf9d-439d-47e5-b4e4-73727dd56908` | 1.5 + 9 |
| `rooms/lounge/sofa.glb` (velvet booth) | `2c94a863-6675-420d-978a-513faab09ef0` | `12ce1f6e-f2db-4e31-80e0-a351f8dae9f4` | 1.5 + 9 |
| `rooms/lounge/sidetable.glb` (side table + candle) | `5a606173-b08d-4d75-89e3-e05998a6d56a` | `417cf732-b355-4feb-abab-a8c16179b1c5` | 1.5 + 9 |

Total: 63 credits.
