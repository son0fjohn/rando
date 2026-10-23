# Rando — instructions for coding agents

Read by Codex (including Codex code review), Claude Code (via `CLAUDE.md`),
and whatever agents you run through T3 Code. Keep it short and true; when a
rule here stops matching the code, fix the rule.

## What this is

Rando is a **mobile web app** — no native build, no bundler, no build step.
Everything the browser loads is static files in `web/`, deployed by Vercel
from `main` (`vercel.json` publishes `web/`). Every merge to `main` goes live
at randoirl.vercel.app; pushes to other branches get Vercel preview URLs.

- **Backend:** Supabase (auth, Realtime channels, a few tables). Client config
  is `web/config.js`; the anon key there is meant to be public.
- **Multiplayer:** Supabase Realtime broadcast + presence (`web/net.js`). No
  database tables for game state: rooms, games and chat die with the room.
- **Map chrome:** `web/backend.js` (auth, presence, the navy bottom bar on
  the world screen only: Explore / Host / Style, flat against the map; Host
  is the gold-ringed house, "My party" while you're in one; pull-to-refresh,
  the style screen, NPC dialog),
  `web/partybeacon.js` (public parties as neon houses over their ZONE),
  `web/charview.js` (a character in 3D, alive: drag to spin, pinch to zoom,
  double-tap to reset, Idle/Walk preview; the Style screen's lit stage),
  `web/avatar3.js` (the player character: body.glb with faces painted into
  the head through a face UV set, flat-painted body regions, a rebuilt rig
  with procedural swagger idle/walk, hair/clothes fitted at load),
  `web/face3.js` (faces drawn in code: 6 eye styles × 6 expressions),
  `web/cel.js` (the one cel shader every character mesh uses),
  `web/retro.js` (DS-style typing dialog, mute toggle, wipes; sounds are
  synthesized in `web/fx.js`), `web/theme.css` (the theme: system font (SF Pro, Apple SD Gothic Neo
  for Korean) and frosted-glass panels; pixel art only in the room art and
  sprites, never in text, buttons or panels).
- **House party:** `web/party.js` (party + lobby: chat, players vote for the
  next game, the host's "Game votes" sheet starts one; the TV opens the same
  sheet), `web/hplobby.js` (the
  top-down room: tap-to-walk with pathfinding, depth sorting, the TV),
  `web/roomart.js` (the apartment drawn in code, layer by layer, furniture
  items), `web/roomdefs.js` (each room's floor, blocks, furniture slots and
  TV, in backdrop pixels), `web/charsprite.js` (players' own 3D characters
  flattened to pixel sprites, cached per look), `web/profilecard.js` (tap
  someone: 3D card, wave, report, block), `web/hpkit.js` (round machine, results screen, cleanup),
  `web/gamekit.js` (`HostGame`: host-authoritative state + snapshots; its
  `finish()` hands the final standings to the party),
  `web/hpgames/*.js` and `web/artgallery.js` (the games), `web/npcscene.js`
  (Side Quest's wizard and the Ritual's clown, built like the Art Gallery:
  painted backdrop, NPC pose cutouts, props on gravity arcs, a prop that
  flies up to become the card; art in `web/games/sidequest|ritual/`, see
  `docs/npc_scenes.md`), `web/retrolook.js` (the retro look kit
  every game scene's 3D layer uses: mood lights, fog, emissive bloom,
  low-res nearest upscale, grade + dither + vignette + grain, quality tiers),
  `web/sqnook.js` (Side Quest's 3D fortune-teller nook on that kit;
  `SIDEQUEST.NOOK_3D`, `?nook=0` pins the painted parlour), `web/retrorooms.js`
  (the other rooms on the kit: the Ritual's circus tent, with the clown and
  props mirrored in from the DOM; Secret Diary's study and Mask Off's lounge
  behind their cards via `roomBackdrop()`; `RITUAL.TENT_3D`, `?tent=0`,
  `?rooms=0`), `web/charrender.js` (players' own 3D characters as
  pictures for those scenes, warmed in the lobby), `web/hpconfig.js`
  (flags, prompt pools, Manhunt geo, diary colors, party/coin/game numbers),
  `web/partyset.js` (a party is a set of 3 games: places → party points),
  `web/partyboard.js` (the podium, coin bursts; its room board is hidden),
  `web/fairpick.js` (random-but-fair "who's next" for Side Quest and the Ritual),
  `web/data/diary_prompts.json` (Secret Diary's prompt pool),
  `web/data/side_quests.json` (Side Quest's quests),
  `web/data/mask_off_cards.json` (Mask Off's truth cards by level, a draft),
  `web/data/ritual_prompts.json` (Humiliation Ritual's charades prompts, a draft), `web/diary3d.js` + `web/models/diary/` (Secret
  Diary's tinted 3D diaries, with sprite and CSS fallbacks; see
  `docs/diary_assets.md`), `web/diarypage.js` (answers written on and read
  off the open diary's pages: auto-fit, page turns, the 150-character limit).
- **Migrations:** `supabase/migrations/`, applied by hand with
  `scripts/apply_migration.py` (needs `SUPABASE_ACCESS_TOKEN` in `.env`).
- **Ritual prompts:** `015_ritual_prompts.sql`: `ritual_draw()` deals the
  performer's phone its prompt; the prompts mirror
  `web/data/ritual_prompts.json` (the SQL test checks they match).
- **Coins and the shop:** `013_coins_shop.sql`. Balances, payouts and purchases
  happen only in SQL functions (`report_game`, `confirm_game`, `buy_item`);
  the client only displays them.

## Run and test

```
npm ci && npx playwright install chromium   # once
npm run serve              # http://localhost:8743
npm test                   # logic suites: all games + "you + 3 bots", then the coin + ritual SQL in PGlite (≈1 min)
npm run test:sql           # just the coin/shop + ritual_draw migrations, run in an embedded Postgres
npm run test:e2e           # 3 phones play a whole party, then 5 play Secret Diary, through the real UI (≈5 min)
npm run test:e2e:iphone    # same, on WebKit with an iPhone profile (needs: npx playwright install webkit)
node test/diary3d_shots.mjs [dir]   # the 3D diary models: load, triangle budget, a live shelf unlock (+ screenshots)
node test/diary_e2e.mjs [dir] --diary=3d|sprite|css   # pin how the diaries are drawn
node test/nook_shots.mjs <dir>       # Side Quest's 3D nook on its own: loads, every beat of a turn
node test/rooms_shots.mjs <dir> [tent,study,lounge]   # the other game rooms on their own: each loads, a shot each
node test/charsprite_shots.mjs <dir>   # 3 test characters as room sprites, every facing + walk frame
node test/charturn_shots.mjs <dir> [--hair=none,f2,m1] [--scale=2] [--only=close-up|motion]   # the player character turned 360° at map / Style / close-up zoom, live idle + walk, with an outfit
node test/combos_shots.mjs <dir>       # every top × bottom (idle + walk) and hairstyle × top, for clipping
node test/style_rec.mjs <dir>          # the Style screen on the real app page: try-on, buy, preview, randomize, save, live party update (FFMPEG=... for style.mp4)
test/faces.html                        # every eye style × expression, flat (open it on npm run serve)
node test/room_rec.mjs <dir>           # 5 phones in the party room: walk, TV -> game votes, profile card (FFMPEG=... for an mp4)
node test/games_rec.mjs <dir> [sidequest|maskoff|ritual|artgallery|party]   # phones playing Side Quest / Mask Off (+ each reveal frame by frame) / a Ritual turn / an Art Gallery piece / a full 3-game set + shop, recorded side by side
node test/nav_shots.mjs <dir>          # the world screen's bottom bar: flat edge, the gold Host ring, tap -> host flow, "My party", reduced motion (FFMPEG=... for ring.mp4)
node test/diary_fit.mjs [dir] [--video] # longest KO/EN answers fit the diary page on 320/375px phones
node test/app_shots.mjs <dir> [--video] # the REAL app page offline: map, bar, explore, NPC, style, host, room, beacon
```

The test pages swap the network, 3D and audio modules for stubs in
`test/stubs/`, so they run offline. `test/appserve.mjs` also serves the real
app as `/app.html` with Supabase faked in memory (`test/stubs/supabase.js`,
channels over BroadcastChannel) and three.js from `node_modules`. The real page needs Supabase and esm.sh;
if your sandbox can't reach them, say so — don't claim you tested it.

Run `npm test` before every PR. Run `npm run test:e2e` too when you touch
`party.js`, `hplobby.js`, `gamekit.js`, a game's render code, or CSS.
For anything only a real phone can show (geolocation, camera, Wake Lock, the
keyboard, safe areas) see `docs/dev-stack.md` → device testing.

## How the games work (read before changing one)

- **Host-authoritative.** The earliest-joined player is host; their phone runs
  the game and broadcasts snapshots. Everyone else only renders and sends
  inputs. If the host leaves, the next player continues from the snapshot.
- **`Rounds` hooks (`onPhase`, `enter`, `exit`) run on the host only.** Never
  reset a player's local UI state there — guests keep last round's. Reset it in
  `render`, keyed off something in the synced state (round, phase).
- **Never rebuild a panel that contains a text box because of someone else's
  action.** `ui.once(key)` keys must not include counts that change when
  *others* submit; patch those numbers in place. Otherwise half-typed answers
  get wiped.
- **Drop-safety:** "is everyone done?" checks use `active(s)` (present
  players). A player who leaves must never stall a phase.
- **Cleanup:** anything a game keeps (photos, answers, caches) registers a
  disposer with `trash` so it dies when the game or party ends.
- **Backdrop:** a game def with `backdrop: "room"` (the Ritual, Mask Off) is played
  over the dimmed party room (`#party-panel.pt-behind`) instead of the map.
- **Ratings (Side Quest, Mask Off):** open as soon as the turn starts, one tap
  locks a rating, and the turn ends once every watcher has rated; the clock
  only ends it if they haven't. Giving up / skipping the card scores 0 and
  skips ratings. Mask Off: honesty 1–5, points = average × `MASKOFF.POINTS_PER_STAR`.
- **Styling:** the page declares `color-scheme: dark`, so any `<button>` with
  no explicit `color` renders white text. Set colors on buttons inside game
  cards (`.stage`).

## Code Review Rules

Repo-specific invariants. A change that breaks one is a P1 at least.

### Privacy and hidden information
- Secret Diary must never show who wrote an answer, who said yes, or which
  guesses were right — on any screen, including results. The points screen
  after each question shows per-player point totals only (`s.pts`), never
  per-guess results. Yes/no counts go through `countLine()` (softened at 0–1
  and all/all-but-one), and when a count is softened the YES/NO stamps are
  never sent (`q.stamps = null`): exact stamps would give the number away.
- Secret Diary colors are a deduction mechanic, not a label: each batch every
  player is dealt one color (`s.colorOf`, no two alike, reshuffled next batch)
  and keeps it for the writing diary and every reveal of that batch. Nobody
  picks one, and no screen ever pairs a color (or its shape) with a name:
  no color by names, avatars, name tags, results or the host's deal screen.
  Per question, colors stay a list aligned with the unsigned diaries.
- A public party's map beacon is placed from its host's presence ZONE only
  (zone centre + an offset from the party id). The announce carries the zone,
  never the host's position or an address; invite-only parties are never
  announced at all.
- Explore mode reads your location on the phone only (and only if location
  is already allowed) to bound panning; it's never sent anywhere.
- Manhunt must never send a coordinate off the phone. Only grid cells leave
  the device, and per-player cells stay out of the synced state.
- The prompt log (`diary_prompt_log`) must never contain user ids, handles or
  answer text.
- Friendships only ever come from a verified in-person meetup (server-side).
  There is no client "add friend" action; the profile card only shows status.
- Reports (`reports`) are insert-only from clients and carry no message text.

### Coins
- Never trust the client with coins. No table holding balances, ledger rows or
  owned items is writable from the client; every change goes through a
  `security definer` function that checks the caller.
- A game pays only when the host's report and the player's own confirmation
  agree, once per (session, set, game, player). Games cut short pay nothing
  (`finalResults().completed`).
- The host reward needs 4+ players who were in all 3 games of the set. Daily
  caps (total per player, host rewards per host) are enforced in SQL; the
  numbers in `hpconfig.js` `COINS` are labels only.

### Safety and content
- Unhinged Secret Diary content requires the party's 18+ setting
  (`maxLevelFor()`); a public party defaults to mild.
- Prompt ids in `web/data/diary_prompts.json`, `side_quests.json`,
  `ritual_prompts.json` and `mask_off_cards.json` are permanent: never renumber or reuse one (logs
  reference them).
- Side Quest's quests are exactly the supplied list; unhinged ones only appear
  when the party's 18+ setting is on (`questsFor()`). Humiliation Ritual's
  prompts go up to `maxLevelFor()` (public parties: mild).
- Mask Off's cards are exactly the supplied (draft) list, escalating
  level 1 → 2 → 3 over a game (`levelFor()`). Answers are spoken out loud,
  never typed, sent or stored.
- Humiliation Ritual: the prompt only ever reaches the performer's phone. That
  phone draws it (`ritual_draw`, server-side; offline: from the pool on that
  phone); the host's game state never carries a prompt or a prompt id, and
  the answer is revealed only after the turn, sent by the performer's phone.
  Only the performer decides which guess is right; the close-guess matcher
  runs on the performer's phone and is a hint, never a verdict. New or edited
  prompts need a migration that upserts them into `ritual_prompts` too.

### Correctness
- Any user-provided text rendered with `innerHTML` goes through `esc()`.
- The host-only / drop-safety / no-rebuild-while-typing rules above.
- Secrets never in the repo: no `.env`, no Supabase `service_role` key, no API
  keys in `web/` (everything in `web/` ships to every browser).

## Review guidelines

- Flag P0/P1 only: bugs a player would hit, privacy leaks, broken rules above,
  security issues, failing tests. Skip style and naming nits.
- This is a fast-moving demo: favour "does it play, on a phone, for 3–6
  people" over architecture. Don't ask for refactors, abstractions or extra
  test layers unless they fix a real bug.
- If a change touches game flow but adds no test for it in `test/specs.js` (or
  `test/party_e2e.mjs` / `test/diary_e2e.mjs` for UI), say so once.

## Conventions

- Plain ES modules, no framework, no build. Match the file you're in.
- Commit messages say what changed and why; one logical change per commit.
- Work on a branch and open a PR; `main` deploys to production on merge.
- Don't merge before Codex's review of the **latest push** has landed (👍 or
  comments) and CI is green. If Codex hasn't reacted to the latest push
  within ~10 minutes, don't wait on it forever — ask a human whether to merge.
