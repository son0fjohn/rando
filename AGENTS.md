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
- **House party:** `web/party.js` (party + lobby), `web/hplobby.js` (the
  top-down room: tap-to-walk with pathfinding, depth sorting, the TV),
  `web/roomdefs.js` (each vibe room's floor, furniture and TV, in backdrop
  pixels), `web/charsprite.js` (players' own 3D characters flattened to pixel
  sprites, cached per look), `web/profilecard.js` (tap someone: 3D card, wave,
  report, block), `web/hpkit.js` (round machine, results screen, cleanup),
  `web/gamekit.js` (`HostGame`: host-authoritative state + snapshots),
  `web/hpgames/*.js` and `web/artgallery.js` (the games), `web/hpconfig.js`
  (flags, prompt pools, Manhunt geo, diary colors), `web/data/diary_prompts.json`
  (Secret Diary's prompt pool), `web/diary3d.js` + `web/models/diary/` (Secret
  Diary's tinted 3D diaries, with sprite and CSS fallbacks; see
  `docs/diary_assets.md`).
- **Migrations:** `supabase/migrations/`, applied by hand with
  `scripts/apply_migration.py` (needs `SUPABASE_ACCESS_TOKEN` in `.env`).

## Run and test

```
npm ci && npx playwright install chromium   # once
npm run serve              # http://localhost:8743
npm test                   # logic suites: all games + "you + 3 bots" (≈1 min)
npm run test:e2e           # 3 phones play a whole party, then 5 play Secret Diary, through the real UI (≈5 min)
npm run test:e2e:iphone    # same, on WebKit with an iPhone profile (needs: npx playwright install webkit)
node test/diary3d_shots.mjs [dir]   # the 3D diary models: load, triangle budget, a live shelf unlock (+ screenshots)
node test/diary_e2e.mjs [dir] --diary=3d|sprite|css   # pin how the diaries are drawn
node test/charsprite_shots.mjs <dir>   # 3 test characters as room sprites, every facing + walk frame
node test/room_rec.mjs <dir>           # 5 phones in the party room: walk, TV -> picker, profile card (FFMPEG=... for an mp4)
```

The test pages swap the network, 3D and audio modules for stubs in
`test/stubs/`, so they run offline. The real page needs Supabase and esm.sh;
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
- Secret Diary colors never point at a player: nobody picks one, the writing
  diary's color is random on each phone and never sent, and reveal colors are
  dealt fresh per question (`dealColors()`, no two alike), stored as a list
  aligned with the unsigned diaries — never keyed by player.
- Manhunt must never send a coordinate off the phone. Only grid cells leave
  the device, and per-player cells stay out of the synced state.
- The prompt log (`diary_prompt_log`) must never contain user ids, handles or
  answer text.
- Friendships only ever come from a verified in-person meetup (server-side).
  There is no client "add friend" action; the profile card only shows status.
- Reports (`reports`) are insert-only from clients and carry no message text.

### Safety and content
- Today's Mission prompts may only embarrass the player who drew them —
  nothing that involves, names, ranks or touches another person.
- Unhinged Secret Diary content requires the party's 18+ setting
  (`maxLevelFor()`); a public party defaults to mild.
- Prompt ids in `web/data/diary_prompts.json` are permanent: never renumber or
  reuse one (logs reference them).

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
