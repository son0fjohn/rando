# Side Quest wizard — 3D asset log

An old wizard / fortune teller from the same cast as the Art Gallery's
dealer (`web/games/artgallery/dealer_*.png`, `dealer.glb`): chibi, about 3
heads tall, chunky low-poly faceted shapes, matte hand-painted texture. Long
white beard, bushy eyebrows, tall droopy star hat, a robe with stars and
moons, slightly hunched.

The crystal ball is **not** in the model. It's the HTML ball in front of his
hands (`.sq-ball`: glow, swirl, the face reel), so his hands can wave over it
and the names inside it stay HTML.

Pipeline: the dealer renders, imported into Higgsfield from the live site,
anchor `gpt_image_2_5` turnaround views → Tripo H3.1 multi-view → `.glb` →
Meshy rig (same skeleton as `dealer.glb`). Max 3 attempts per view.

## v2: old wizard, the dealer's sibling (current)

| Step | Job | Attempt | Credits | Kept? |
| --- | --- | --- | --- | --- |
| Dealer idle render (import) | `58bfe7df-1245-4a3a-a516-0bb9f60f4655` | — | 0 | reference |
| Dealer unveil render (import) | `0014e3b4-42cb-4611-9476-142af828782f` | — | 0 | reference |
| Front view (3:4, high, both dealer renders as reference) | `383d9cb8-c25e-4413-821b-dd0083790a72` | 1 | 1.5 | kept (pending your review) |
| Left view (facing left) | `b8597f93-5679-4f67-9b1f-5452a2ca3670` | 1 | 1.5 | kept (pending your review) |
| Back view | `99c1eba1-ec75-40d1-b649-31ea9363af2e` | 1 | 1.5 | kept (pending your review) |
| Right view (facing right) | `d053de46-08f0-432d-ad8a-796487c59f76` | 1 | 1.5 | kept (pending your review) |
| Tripo H3.1 multi-view → GLB (front, left, back, right; 20k faces, detailed texture) | `f39083a4-fa1c-408d-b1ca-f1af2fa78c83` | 1 | 12 | kept (pending your review) |
| Meshy rig + Idle clip (0), 1 m tall | `35f421dd-5038-45be-815a-a3a53f0b553b` | 1 | 8 | kept (pending your review) |

v2 total: 26 credits. The waving, beard bob, sway and nod are done in code
(`wizard3d.js`), so no extra clip was bought.

GLBs (under `https://d8j0ntlcm91z4.cloudfront.net/user_3Ei5h1HOK7Uxrcue448ZmRc0GqQ/`):
- mesh: `hf_20261022_035016_f39083a4-fa1c-408d-b1ca-f1af2fa78c83.glb`
- rigged + idle: `hf_20261022_035608_35f421dd-5038-45be-815a-a3a53f0b553b.glb` → `web/models/wizard/wizard.glb`

## v1: young hooded fortune teller (rejected: replaced by v2)

Front `ebf7a891-…`, right `3957a534-…`, back `1f6ae332-…`, left
`fde92b52-…` (1.5 each), Tripo mesh `2591c85e-…` (12), rigs with Idle
`47cd5a76-…` and Magic_Genie `0ce100a8-…` (8 each). 34 credits.

## In the app

`web/wizard3d.js` draws the model behind the HTML ball: the rig's idle clip,
plus in code a slow sway, the beard bobbing with the head, hands waving over
the ball while it glows / swirls / spins (or a `wizard_cast.glb` clip, if
there is one), and a small nod when the quest card appears and when the reel
lands. The arm and head axes were measured on the dealer's rig (`?wizard=dealer`),
which has the same bone names (Hips / Spine / neck / Head / LeftArm …); check them
again on the wizard's own rig. The pixel wizard stays until a 3D frame is up, and whenever WebGL or
the model isn't there.

It's off until the model is in: `SIDEQUEST.WIZARD_3D` in `hpconfig.js`.
`?wizard=dealer` runs it on the dealer's rig (same skeleton) to test it now;
`node test/wizard3d_shots.mjs <dir> [--model=dealer|3d] [--video]` checks it
loads, fits the frame, hides the pixel wizard, and shoots every mode.

To finish: download the rigged GLB from Higgsfield's CDN
(`d8j0ntlcm91z4.cloudfront.net`, blocked in the dev sandbox), save it as
`web/models/wizard/wizard.glb` (and an optional `wizard_cast.glb`), and set
`WIZARD_3D: true`.
