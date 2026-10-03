# House-party assets — generation log (2026-10-03)

Four new assets for the house-party games. Style block matches
`assets/artgallery/README.md` so the whole party set reads as one look —
see that file for the Art Gallery assets and the world-vs-game style split.

## Status: GENERATED, NOT YET IN THE REPO — and NOT VISUALLY REVIEWED

All four generated successfully on the **first attempt** (cap was 3). They are
in the Higgsfield workspace at the URLs below.

They are **not committed** because this build sandbox's egress policy blocks
`d8j0ntlcm91z4.cloudfront.net` (the Higgsfield asset CDN) with a 403 at
CONNECT, so the bytes could not be fetched here. For the same reason **nobody
has looked at them yet** — treat all four as unreviewed, not as accepted.

Run `./fetch.sh` from a machine that can reach the CDN to drop them into place
(see below). Then actually look at them, and if any is generic, keep it as a
placeholder and flag it rather than burning the remaining 2 attempts blind.

Until they land, every one of them degrades cleanly: the mission card, the
charades stage and the radar all sit on CSS gradients, and the bomb icon
layers over a CSS sphere, so a missing file costs polish and nothing else.

## Style block (appended verbatim to every prompt)

> Low-poly PS2-era 3D render, faceted angular geometry, flat matte shading,
> no smooth gradients, no soft lighting, subtle film grain, muted slightly
> desaturated retro palette.

## Files

Model `gpt_image_2_5` (variant flare), `quality: high`, `resolution: 1k`.

| # | Ships as | Job ID | Size | Attempts | Kept? |
|---|---|---|---|---|---|
| 1 | `web/games/mission/card.jpg` | `8ebbe168-6ffc-48ac-89dc-3712706d744a` | 1024×688 (3:2) | 1 of 3 | generated, unreviewed |
| 2 | `web/games/manhunt/radar.jpg` | `b134e086-90c9-4100-9e30-cf7bc0cdb710` | 1024×1024 (1:1) | 1 of 3 | generated, unreviewed |
| 3 | `web/games/manhunt/bomb.png` | `e4873a39-2e2e-41e9-a957-048a6b609abf` | 1024×1024 (1:1), `background: transparent` | 1 of 3 | generated, unreviewed |
| 4 | `web/games/ritual/stage.jpg` | `b418264a-bbf8-48fa-ad2e-975e58e60fa4` | 1168×880 (4:3) | 1 of 3 | generated, unreviewed |

### Prompt subjects

1. **Mission card** — blank indigo briefing card, gold pinstripe border,
   vignetted corners, wax seal, empty centre panel, one hard overhead
   spotlight. Prompt insists on no text anywhere: the UI draws
   "TODAY'S MISSION:" and the task over it, so any baked-in lettering is a
   reject.
2. **Radar** — top-down tactical display, dark green-black, concentric range
   rings, thin square grid, scuffed metal bezel, scanlines. Deliberately
   empty: the live cells are DOM elements over the top.
3. **Bomb icon** — single faceted bomb on transparent background, stubby
   fuse with one lit spark, dull red warning band. No ground shadow, so it
   sits on a light list row.
4. **Charades stage** — empty small performance stage, plank floor, faceted
   dark red curtain, two clip lights pooling on centre stage, speaker boxes.
   Empty on purpose — the performer is a real person in the room.

## Not generated this run

* **Lobby background** — already in the repo as `web/lobbies/{chill,chaos,sporty}.png`
  from earlier work, in the same style. Reused as-is, not regenerated.
* **Gallery room, empty frame, cloth-covered frame, art dealer NPC** — already
  in `web/games/artgallery/`. Reused as-is; see `assets/artgallery/README.md`.
* **Characters / avatars** — out of scope this run by instruction. The lobby
  and results screens use the CSS placeholder avatar in `web/hpkit.js`
  (deterministic hue per player id plus their initial).
* **Tripo / 3D** — nothing needed it. All four of these are flat UI surfaces
  that a 2D image renders correctly, and the brief limits Tripo to props where
  a flat image won't work.

## Credits

**6 credits** (899 → 893) for four `high`/`1k` images. No retries, no 3D,
no video. The other 2 attempts per asset are unspent.
