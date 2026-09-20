# Art Gallery assets — generation log (2026-09-20)

Sources for `web/games/artgallery/`. Generated through Higgsfield
(model `gpt_image_2_5`, quality high, `background: transparent` for the
cutouts) and converted to 3D with Tripo H3.1. Shipped copies are
downscaled with `sips` (frames 640 px, dealer sprites 720 px tall,
gallery 1600 px tall JPEG).

## Style block (appended verbatim to every prompt)

> Low-poly PS2-era 3D render, faceted angular geometry, flat matte
> shading, no smooth gradients, no soft lighting, subtle film grain, muted
> slightly desaturated retro palette.

NOTE: this is the brief for the *game* assets. `assets/world/STYLE.md`
locks the *world* to smooth soft shading with "NO faceted low-poly" — the
two are deliberately different looks; don't re-anchor one to the other.

## Files

| Source (hf_*) | Shipped as | Prompt subject |
|---|---|---|
| `…612d1555_gallery.png` (1520×2688, 9:16) | `gallery.jpg` | gallery interior, flat front-on, cream walls, plank floor, track lights, empty centre wall |
| `…e9c8da9e_frame.png` (1024², alpha) | `frame.png` | ornate gold frame, empty transparent centre |
| `…6f285acf_frame-cloth.png` (1024², alpha) | `cloth.png` | the same frame (reference = frame job) draped in a white cloth |
| `…61149a76_dealer-idle.png` (880×1168, alpha) | `dealer_idle.png` | chibi 3-heads curator, hands clasped |
| `…84c921bb_dealer-unveil.png` (880×1168, alpha) | `dealer_unveil.png` | same character (reference = idle job), presenting arm out |
| `…751f7450_dealer-apose-front.png` | — (3D input) | same character, A-pose front |
| `…b28b9678_dealer-apose-left.png` | — (3D input) | same character, A-pose left side |
| `…cd69bf19_dealer-apose-back.png` | — (3D input) | same character, A-pose back |

Consistency: every dealer pose was generated with the idle (or A-pose
front) job attached as `image_references` and the full character
description restated; never chained off a later pose.

## Frame opening

`frame.png`'s transparent opening, measured from its alpha (percent of
each edge): left 22.8 · top 20.5 · right 23.0 · bottom 21.1. This is
`FRAME_INSET` in `web/artgallery.js` — re-measure if the frame changes.

## 3D (Tripo H3.1 via Higgsfield)

The clasped-hands idle is a bad rigging pose (hands fuse), so the 3D
conversion uses a dedicated A-pose. Two runs: single-image
(`tripo_h3_1_image_to_3d`, front) and 3-view
(`tripo_h3_1_multiview_to_3d`, ordered front / left / back). Rigging is
a separate pass on the chosen GLB (`3d_rigging`). See the commit message
for which one shipped as `dealer.glb`.
