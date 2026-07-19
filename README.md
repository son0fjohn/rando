# Rando

A gamified social app that gets strangers interacting offline — friends, hobbies,
business, dating, all valid. **The promise: never feel alone in a new city.**
Launch test market: Itaewon, Seoul.

Full product spec: [spec/rando-spec.md](spec/rando-spec.md)

## World demo

A static, no-build demo of the populated world: map background, player + 4 NPCs
with matched lighting and cast shadows, zone/GPS chip, looping public (grey) /
private (blue) chat bubbles, and a tap-an-NPC private chat thread view.

Run it with any static file server from the repo root, e.g.:

```
py -3 -m http.server 8743
```

then open http://localhost:8743/web/index.html

- `?chibi=1` starts in the chibi-proportion test (also toggleable in the UI)
- Minigames are deliberately not built yet (see spec) — the demo shows the
  world, characters, and chat visual systems.

## Layout

| Path | What it is |
|---|---|
| `assets/` | Generated art: world background, NPC renders, player character system |
| `web/` | The demo page (`index.html`) |
| `web/lit/` | Characters relit to match the day scene, cropped to feet (generated) |
| `web/chibi/` | Chibi-proportion warped variants (generated) |
| `scripts/` | Python pipeline that produces `web/lit` and `web/chibi` |
| `spec/` | Product spec |

## Regenerating derived assets

Requires Python 3 with Pillow + numpy:

```
py -3 scripts/relight.py   # assets -> web/lit  (lighting match + feet crop)
py -3 scripts/chibi.py     # web/lit -> web/chibi  (proportion warp)
```

Note: script output paths assume the repo lives at `E:\rando`; adjust the
`BASE` constant at the top of each script if it lives elsewhere.
