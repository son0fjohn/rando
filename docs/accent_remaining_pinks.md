# The accent is gold: what's still pink, and why

The secondary (accent) colour is the gold `--color-accent: #FFC83D`, defined
once in `web/theme.css`. Text and icons on it are navy
`--color-on-accent: #0F1A3A`. The pressed and hover state is
`--color-accent-press: #E6AE1F`, and a disabled control is the accent at 40%
opacity (`--color-accent-disabled`). Every UI accent points at these tokens:
buttons (`.y-btn.accent` / `.gold` / `.host`), the Host ring, selected tiles,
badges, progress dots, crowns, the Side Quest and Ritual cards, Mask Off's
"same" toggle, the Style screen's buy and save buttons, and native controls
(`accent-color`). There are no pink UI accents left, and `--y-pink`,
`--y-gold` and `.y-btn.pink` are gone.

The pink inventory comes from scanning every `.css/.js/.html/.json` in
`web/` for hex, `0x` and `rgb()` colours with a pink or magenta hue (152 hits
before, 115 after; `theme.css` went from 51 to 16, not counting the
`var(--y-pink)` uses, which the scan can't see and are all gone). Every hit still left is in one of the groups below. Most
of them are reds rather than pinks, and are listed only because the scan
can't tell the two apart.

## Kept pink on purpose: art, not UI (your call)

| Where | What | Why it's still pink |
|---|---|---|
| `theme.css` `.lr-stage[data-vibe="chaotic"] .lr-tv` | The TV glow in a "chaotic" party room | Room art (the TV's light) |
| `roomart.js:24, 59, 76–86, 162` | The chaotic vibe's wall colours, the couch, a poster, the window lights | Room art drawn in code |
| `hplobby.js:142` | The TV's pixel knobs | Room art |
| `party.js:64–69` | The game icon SVGs (diary cover, mask's mouth, ritual / manhunt reds) | Pixel-art icons. Each is the game's own picture, not an accent. |
| `world3d.js:68`, `landmarks.json:87, 128, 404` | Landmark glows on the 3D map (one neighbourhood's neon) | Scene lighting on the map |
| `prophet.js:43, 116` | The Prophet's rooftop: the TV light and the sky ambient | Scene lighting (the approved painting has a magenta TV) |
| `fx.js:146, 233–234` | The heart particle, plus the club scene's magenta strobe | Scene effects |
| `avatar4.js:706` | The hearts emote | Hearts are pink |
| `theme.css` `.mo-hearts` → `--art-heart-pink` | Mask Off's floating hearts | Hearts are pink |
| `boss.js:174`, `basement.js:120` | One of the five gacha capsule colours | Props. The capsules are a five-colour set. |
| `retrorooms.js:142, 145` | Book spines and a poster in the study and lounge | Room art |
| `rooftop.js:145` | A floor cushion | Room art |
| `charrender.js:113` | The "pink" hair dye | A character colour, chosen by the player |
| `face3.js`, `character3d.js` | Blush and lips on the old character | Legacy, kept only for `staticize`/`matteify` |
| `rooms.js:18` | The "chaos" arch on the 3D map | Scene art, coloured by vibe |
| `theme.js:20` | The map palette's dusty rose | Map art |

## Kept pink because it's a game mechanic

| Where | What | Why |
|---|---|---|
| `hpconfig.js:93` `#ff8fab` | One of Secret Diary's 12 diary colours | Colours are a deduction mechanic. Players need 12 colours they can tell apart, and pink is one of them. |
| `index.html:1673` `.sd-level.unhinged` | The "unhinged" level pill (dark red on rose) | A content warning, red by meaning. It isn't an accent. |

## Reds (danger, errors, timers, team red): not pink, unchanged

- `--y-red`, `.y-btn.hp-ask-yes`, `.hr-kick`.
- Urgent clocks: `.np-clock.urgent`, `.sq-clock.urgent`, `.hr-clock.urgent`.
- Side Quest's film stamp.
- Error text: `.pv-err` (it was a pink `#ff8aa8` and is now the same red as the other errors), `#nick-error`, `.pt-err`.
- `#hp-end` "end game" (it was pink `#ffb3c4` and is now red, because it's a destructive action).
- Manhunt's hunter role and tag buttons.
- Secret Diary's NO stamp.
- The arena games' red flashes and blips.
- Tile Wars' red team.
- The art-gallery notification dot.

## Untouched by request: the dialog boxes

- `button.dlg-choice.warn` (`#ffd0cc`) and `button.dlg-choice.armed`
  (`rgba(120,26,40)`) are the NPC dialog's "are you sure?" choices. They're
  warning reds inside the dialog box, which was out of scope.

## Dead CSS, never rendered

- `index.html:1394–1403` `.lane-chaos` / `.hc-chaos` / `.sc-chaos`. No
  script uses these class names any more.
