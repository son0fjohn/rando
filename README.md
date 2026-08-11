# Rando

A gamified social app that gets strangers interacting offline — friends, hobbies,
business, dating, all valid. **The promise: never feel alone in a new city.**
Launch test market: Itaewon, Seoul.

Full product spec: [spec/rando-spec.md](spec/rando-spec.md)

## The world

A static, no-build 3D world demo (`web/`): real Itaewon geography — OSM roads,
~4,470 VWorld registry buildings with class-driven facades, hillside terrain
rising toward Namsan — with presence, matching, chat, and encounters backed by
Supabase (phone-OTP/guest auth, coarse zone presence, mutual tap-confirm).

**Characters** are customizable humanoids (`web/avatar3.js`): one rigged Tripo
body, 5 skin tones and 5 hair colors as runtime texture recolors, 6 face
designs × 6 iris colors as decals, and hair/top/bottom/shoe GLB pieces sharing
a single fit transform. Ambient NPCs stay procedural blobs for variety.

**Archetype NPCs** stand at their real venues — Nabi the halo bunny at Ikovox
cafe, Nalli the chaos imp at Grand Ole Opry, Dali the sporty fox at the Namsan
exercise park. Their dynamic idles play while you're physically in range
(on-device GPS check, same privacy pattern as meetup confirm). Tap one, accept
the quest, and the screen drops into that archetype's **2D pixel lobby** — a
9:16 16-bit room where you walk around as a runtime-pixelated sprite of your
actual avatar.

## Running it

Any static file server from the repo root:

```
py -3 -m http.server 8743
```

then open http://localhost:8743/web/index.html

Dev flags (query params):

| Flag | Effect |
|---|---|
| `?mode=day` / `?mode=night` | force the lighting mode (default: local time) |
| `?legacy=blob` / `?legacy=glb` | old procedural blob / old animated GLB players |
| `?anim=1` | opt-in skinned idle/walk clips on the player (review) |
| `?devnpc=1` | force all archetype NPCs "in range" |
| `?devlat=&devlng=` | spoof device GPS |
| `?devzone=` | force a presence zone |
| `?acct=2` | second auth session in another tab |

Dev harness: `web/avatar3_test.html` renders an avatar QC grid.

## Deploy

Static deploy of `web/` only (the repo also carries art sources and pipeline
scripts that never need to ship): `vercel.json` and `netlify.toml` are both
configured. Supabase URL + anon key live in `web/config.js` (public client
values). Secrets (`TRIPO_API_KEY` etc.) live in `.env` — gitignored, used only
by local pipeline scripts, never needed in production.

## Layout

| Path | What it is |
|---|---|
| `web/` | The app: `index.html`, `backend.js` (Supabase), `world3d.js` (3D world), `avatar3.js` + `avatar3/` (character system), `lobby.js` + `lobbies/` (pixel lobbies), `npcs/` (mascots) |
| `assets/` | Generated art sources (world, player pieces, NPC refs) |
| `scripts/` | Python pipelines (Tripo v3 client, road/building fetch, asset prep) |
| `supabase/` | SQL migrations (profiles, presence, matching, messages, encounters, friends) |
| `spec/` | Product spec |
| `pitch/` | Pitch deck + design handoff |
