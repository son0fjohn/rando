# Rando — instructions for coding agents

Read by Codex (including Codex code review), Claude Code (via `CLAUDE.md`),
and whatever agents you run through T3 Code. Keep it short and true; when a
rule here stops matching the code, fix the rule.

## What this is

Rando is a **mobile web app** — no native build, no bundler, no build step.
Everything the browser loads is static files in `web/`, deployed by Vercel
from `main` (`vercel.json` publishes `web/`). The one exception is
`api/invite.mjs`, a tiny Vercel function behind `/p/CODE` (an invite link's
preview, then on to `/?party=CODE`). Every merge to `main` goes live
at randoirl.vercel.app; pushes to other branches get Vercel preview URLs.

- **Backend:** Supabase (auth, Realtime channels, a few tables). Client config
  is `web/config.js`; the anon key there is meant to be public.
- **Multiplayer:** Supabase Realtime broadcast + presence (`web/net.js`). No
  database tables for game state: rooms, games and chat die with the room.
- **Onboarding** (see `docs/onboarding.md`): `web/onboard.js` (first open
  to playing in under a minute: the start screen on every open, a glass
  panel (Start a party / Join a party) over our 3D Itaewon at night,
  drifting (`web/scenery.js`: pure scenery, the drift, the dive into the
  party's building, the glide down for Explore the world, slow phones ->
  lite glass; `web/start/night.jpg` its still first frame), an invite link straight in,
  first-timers' setup card (the same panel: a random name to keep, the
  character in 3D or as the room's 2D sprite, Randomize, one tap per
  essential, Let's go; returning players skip it and get a chip to edit;
  `onbkit.js` `needsSetup` / `cycleLook`), Home,
  the invite sheet with its QR; accounts: a guest first,
  "Save your account" with Kakao / Apple / Google (`linkIdentity`, the same
  account), sign in on a new phone; phone verification only for the
  stranger features (`FLAGS.PHONE_VERIFY` in `hpconfig.js`), Settings, the safety card before a first game, a game
  one-time hints, the first party's recap),
  `web/onbkit.js` (its pure parts), `web/i18n.js` (English and Korean, the
  device's language, switchable), `web/permissions.js` (a pre-prompt before
  every system permission dialog), `web/analytics.js` (privacy-safe events
  -> `017_events.sql`), `web/qr.js` + `web/vendor/qrcode.js`, `web/stats.html`
  (the admin-only dashboard). `?onb=0` turns it off.
- **Map chrome:** `web/backend.js` (auth, presence, the bottom bar on
  the world screen only (solid navy at every light, light icons, the
  active tab gold; it never follows `--day`):
  Explore / Host / Style, flat against the map; Host
  is the gold-ringed house, "My party" while you're in one; pull-to-refresh,
  the style screen, NPC dialog),
  `web/partybeacon.js` (public parties as neon houses over their ZONE),
  the city map, everywhere (see `docs/map_city.md`): near Itaewon its
  hand-made map with the procedural city round its edges, anywhere else the
  procedural city centred where you are (`world3d.worldAt`; `?city=tiles`
  the city only, what Manhunt plays on): `web/citytiles.js`
  (chunks of buildings, roads, parks and water streamed round the camera
  from `web/tiles/cities.pmtiles`, then the whole-city region archives
  in `web/tiles/regions.json` (Seoul and the capital area, central Busan: Overture's
  ML footprints, which OpenStreetMap lacks for most Korean houses), built
  in `web/citygen.worker.js` off
  `web/citygen.js`, cached on the device by `web/citycache.js`; LOD rings,
  lit windows at night, the see-through cut), `web/pmtiles.js` (the archive
  reader), `web/data/heroes.json` (hand-made landmark glbs and where they
  stand); baked by `scripts/fetch_overture.py` + `scripts/bake_city_tiles.py`
  for the areas and regions in `scripts/city_areas.json`; anywhere else the worldwide
  OpenFreeMap tiles, `web/cityomt.js` + `web/mvt.js` (OpenMapTiles -> our
  chunks, in the worker); landmarks and their placeholders in
  `web/data/heroes.json`; `?fps=1` for a phone's numbers,
  `web/charview.js` (a character in 3D, alive: drag to spin, pinch to zoom,
  double-tap to reset, Idle/Walk preview; the Style screen's lit stage;
  `mountLookView`: the same box behind a 3D / 2D toggle, 2D being the party
  room's own pixel sprite big and crisp (`charsprite.js`), the choice kept
  on the phone),
  `web/avatar4.js` (the player character: one shared clay base,
  `web/avatar4/base.glb`, a 20-joint rig with procedural idle/walk; skin,
  the tee/shorts underlayer and items are code tints; the eyes are a
  canvas on the head's own face UV set; items are glbs skinned offline to
  the same joints, `web/avatar4/items/`; layer shells: hats on a measured
  head shell, hat hair, hair over collars, hems over waistbands, layer
  polygon offsets; emote marks, item thumbnails), `web/items4.js` (the wardrobe: every item, what it hides,
  how it tints, free vs shop with rarity and label prices, the six starter
  outfits; no three.js, so bots and tests read it), `web/face4.js` (the
  eyes drawn in code: 20 shapes × 8 iris tints, expressions, no mouth; the
  face-layer accessories), see `docs/avatar4.md`. (`avatar3.js`, `face3.js`
  and `cel.js` are the old character, kept only for `staticize`/`matteify`.)
  `web/retro.js` (DS-style typing dialog, mute toggle, wipes; sounds are
  synthesized in `web/fx.js`), `web/theme.css` (the theme: system font (SF Pro, Apple SD Gothic Neo
  for Korean) and liquid glass everywhere: `.glass` (a panel), `.glass-dialog`,
  `.glass-sheet`, `.glass-scrim`, `.glass-btn` (`.gold` the one primary
  action / `.clear`), `.glass-icon`, `.glass-seg`, `.glass-field`,
  `.glass-toast` are THE shared surfaces (clear tint, blur, specular rim,
  12px buttons; lite on slow phones): every new dialog, sheet, popup or
  button takes them, and `node test/glass_shots.mjs` shoots them all; the
  party room's pixel speech bubbles and the games' `.dlg-*` box stay as
  they are; one accent, gold `--color-accent`
  with navy `--color-on-accent` text, never a hardcoded accent hex; pixel art only in the room art and
  sprites, never in text, buttons or panels; day and night: every glass surface over the map
  follows `--day` (0 night, 1 day, blended at sunrise/sunset) through the
  tokens in theme.css "day and night", set by `web/daylight.js` from the map's
  light; indoor scenes pin it to night; `?light=day|sunset|night` or the
  `?dev=1` chip force it).
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
  `web/hpgames/*.js` and `web/artgallery.js` (the games; Manhunt also
  `web/mhgeo.js`: zone, shrink, fuzzy circles, teams, points; `web/mhmap.js`:
  the zone wall and the circles on the live map; `web/mhcrypt.js`: the team
  channel; `web/mhscene.js` + `web/hunter.js` + `web/elevator.js`: its host,
  The Hunter, in a camera-mapped elevator), `web/npcscene.js`
  (the game hosts' DOM beats: `Beats` off the synced clock, a card flying out
  of the scene, confetti), `web/npcstage.js` (what both hosts' 3D scenes
  share: the look-around camera, one component and one set of settings, tap
  picking, the head that follows the camera, the shader bits for a live-lit
  character in a painted room, the smoke wisp), `web/projroom.js` (camera
  mapping: low-poly geometry painted by projecting an approved picture from
  its camera, a depth map for what it saw, a tile for what it didn't),
  `web/prophet.js` (Side Quest's host, The Prophet: a rigged low-poly 3D
  model, `web/games/sidequest/prophet/prophet.glb`, sitting cross-legged
  behind a low table, lit live; procedural idle / reveal / point / nod, the
  crystal ball; drag to orbit the camera, pinch to zoom, it glides home and
  holds still for the pick and the reveal; tap him / the ball / the lamp /
  the TV; the chosen player sits on a cushion at his table's right end,
  `npcstage.js` `guestSpot`), `web/rooftop.js` (his rooftop room, camera-mapped, a clean plate
  where he, the ball and the dialog were; assets in
  `web/games/sidequest/rooftop/`, see `docs/npc_scenes.md`), `web/boss.js`
  (the Ritual's host, The Boss: a rigged low-poly 3D model,
  `web/games/ritual/boss/boss.glb`, sitting back behind a folding table, lit
  live; procedural idle with cigar drags / reach / hold / twist / peek /
  shhh / nod / sip, the capsule with the player's face and name, the cigar
  and finger props; the same look-around as the Prophet; tap him / the box /
  the cup / the lamp), `web/basement.js` (his gray basement, camera-mapped,
  haze, the lamp's flicker; assets in `web/games/ritual/basement/`),
  `web/bunny.js` (the Art Gallery's host, Bunny: a rigged low-poly 3D model,
  `web/games/artgallery/bunny/bunny.glb`, a white rabbit half-mask, black
  lace-and-tulle dress, standing in the gala, lit live by its candles;
  aimed-limb procedural idle with sips / unveil / gavel raps on a marble
  pedestal / judge / two sarcastic claps; the gavel and the flute ride her
  palms; the same look-around, ±60° here; tap her / the frame / a candle
  sconce), `web/gala.js` (her candlelit gallery,
  camera-mapped from the approved picture widened to a square, no guests,
  no chandelier; the photo in the gold frame, the velvet drape, the
  spotlight, candle glows; 3D title plaques it can hang on the wall, which
  the Art Gallery hides (`showPlaques(false)`): its titles are floating
  cream cards in the action area, voted by a tap (gold glow, wax seal);
  assets in `web/games/artgallery/gala/`),
  `web/dialog.js` (the shared NPC dialog box: navy, name tab, text typed in
  the app font with a blip, ▼, always the same size, choice boxes above it,
  `quip()` for a passing line; styles `.dlg-*` in theme.css),
  `web/howto.js` (how to play, told by each game's host in its own dialog
  box before the first turn: 2–4 lines with gestures the first time, then
  one line + "How to play"; a host-authoritative "howto" phase), `web/retrolook.js`
  (the retro look kit every game scene's 3D layer uses: mood lights, fog,
  emissive bloom, low-res nearest upscale, grade + dither + vignette +
  grain, quality tiers; `smooth` + `msaa` for a soft look, `encoded` for a
  display-ready buffer, as the camera-mapped rooms need),
  `web/retrorooms.js`
  (the other rooms on the kit: Secret Diary's study behind its cards via
  `roomBackdrop()`, and Mask Off's lounge if its table can't run; `?rooms=0`),
  `web/roundtable.js` (Mask Off's room: no host, the players themselves,
  each their own 3D character on a chair round a table under one low lamp,
  candles, a window on the city; cream masks that slide off onto the table;
  every phone first person from its own seat, `npcstage.js` `firstPerson`;
  the picked one's spotlight, the "not asked yet" glow, the asked card on
  the table, Same glows, the end lifting above the table), `web/charrender.js` (players' own 3D characters as
  pictures for those scenes, warmed in the lobby), `web/hpconfig.js`
  (flags, prompt pools, Manhunt geo, diary colors, party/coin/game numbers),
  `web/partyset.js` (a party is a set of 3 games: places → party points),
  `web/partyboard.js` (the podium, coin bursts; its room board is hidden),
  `web/fairpick.js` (random-but-fair "who's next" for Side Quest and the Ritual),
  `web/data/diary_prompts.json` (Secret Diary's prompt pool),
  `web/data/side_quests.json` (Side Quest's quests),
  `web/data/mask_off_cards.json` (Mask Off's deck: light / real / deep),
  `web/data/ritual_prompts.json` (Humiliation Ritual's charades prompts, a draft), `web/diary3d.js` + `web/models/diary/` (Secret
  Diary's tinted 3D diaries, with sprite and CSS fallbacks; see
  `docs/diary_assets.md`), `web/diarypage.js` (answers written on and read
  off the open diary's pages: auto-fit, page turns, the 150-character limit).
- **Migrations:** `supabase/migrations/`, applied by hand with
  `scripts/apply_migration.py` (needs `SUPABASE_ACCESS_TOKEN` in `.env`).
- **Ritual prompts:** `015_ritual_prompts.sql`: `ritual_draw()` deals the
  performer's phone its prompt; the prompts mirror
  `web/data/ritual_prompts.json` (the SQL test checks they match).
- **Analytics:** `017_events.sql`: the insert-only `events` table and the
  admin-only `onboarding_stats()` (the dashboard, `web/stats.html`; admins are
  rows in `admins`, added by hand). `018_account_events.sql` allows the
  account and SMS-code events; a new event name needs the check list there.
- **Coins and the shop:** `013_coins_shop.sql`. Balances, payouts and purchases
  happen only in SQL functions (`report_game`, `confirm_game`, `buy_item`);
  the client only displays them. `016_wardrobe4.sql` is the new wardrobe's
  shop (head / face / neck slots, rarity); its rows must match
  `web/items4.js` (the SQL test checks).

## Run and test

```
npm ci && npx playwright install chromium   # once
npm run serve              # http://localhost:8743
npm run serve:test         # offline, no Supabase: http://localhost:8744/test/hpparty.html?me=alice (more tabs: ?me=bob&party=CODE), /app.html
npm test                   # logic suites: all games + "you + 3 bots", the wardrobe rules, then the coin + ritual SQL in PGlite (≈1 min)
npm run test:sql           # just the coin/shop + ritual_draw migrations, run in an embedded Postgres
npm run test:e2e           # 3 phones play a whole party, then 5 play Secret Diary, through the real UI (≈5 min)
npm run test:e2e:iphone    # same, on WebKit with an iPhone profile (needs: npx playwright install webkit)
node test/diary3d_shots.mjs [dir]   # the 3D diary models: load, triangle budget, a live shelf unlock (+ screenshots)
node test/diary_e2e.mjs [dir] --diary=3d|sprite|css   # pin how the diaries are drawn
node test/prophet_shots.mjs <dir> [only]   # Side Quest's Prophet on his own: every pose, the dialog box (EN + KO), drag-to-orbit / glide home / hold / pinch, taps
node test/boss_shots.mjs <dir> [only] [--video]   # the Ritual's Boss on his own: every beat, the dialog box (EN + KO), drag-to-orbit / glide home / hold / pinch, taps (--video + FFMPEG: orbit.mp4)
node test/rooms_shots.mjs <dir> [study,lounge]   # the other game rooms on their own: each loads, a shot each
node test/charsprite_shots.mjs <dir>   # 3 test characters as room sprites, every facing + walk frame
node test/charturn_shots.mjs <dir> [--hair=none,bob,wolf] [--scale=2] [--only=close-up|motion]   # the player character turned 360° at map / Style / close-up zoom, live idle + walk, with an outfit
node test/combos_shots.mjs <dir> [--only=tops|hats]   # every top × bottom (idle + walk) and every headwear × hairstyle, for clipping
node test/glitch4.mjs <dir> [--only=hats,tophair,topbottom,neck,face] [--item=id]   # the glitch grid: every hair × headwear, top × hair, top × bottom, neck × top, face × headwear, 4 views × idle/walk, poke-through / z-fight / gaps labelled (≈35 min for all)
node test/faces_shots.mjs <dir>        # every eye shape × expression on the 3D head, the iris tints
node test/orbit_shots.mjs <dir> [prophet|boss]   # both hosts' rooms at the orbit's far left / mid / centre / far right, zoomed, high and low
node test/guest_shots.mjs <dir> [prophet|boss] [--outfits=puffer,long,beanie,plain]   # the chosen player in both hosts' rooms (sitting on the rooftop, standing in the basement): each outfit at the default view and the orbit's ends; clear of the host, the ball / box and the dialog box; one at a time
node test/bunny_shots.mjs <dir> [only] [--photo=<url>]   # the Art Gallery's Bunny on her own: every beat (covered, unveil, gavel, judge, sold, applause, sip), the dialog box (EN + KO), the 3D plaques (covers, glow + wax seal, winner lit, long / Korean titles), the orbit's ends (±60°), drag / glide home / home() / pinch, taps (a plaque, the frame, a sconce, her)
test/pose4.html                        # the player character sitting and standing, front / 3/4 / side / back (open it on npm run serve:test)
node test/style_rec.mjs <dir>          # the Style screen on the real app page: try-on, buy, preview, randomize, save, live party update (FFMPEG=... for style.mp4)
test/faces.html                        # every eye style × expression, flat (open it on npm run serve)
node test/room_rec.mjs <dir>           # 5 phones in the party room: walk, TV -> game votes, profile card (FFMPEG=... for an mp4)
node test/maskoff_shots.mjs <dir> [--bots=4]   # Mask Off round the table with real characters: first person from two seats, a pick by tapping someone, a raised card, the card on the table, looking round / glide back, the end; a 10-player party seats 8 + the seat bar
node test/games_rec.mjs <dir> [sidequest|maskoff|ritual|artgallery|party|turns]   # phones playing Side Quest / Mask Off (round the table, real characters: a pick, a card, an answer, Same, Go deeper, a pass, the end) / a Ritual turn / an Art Gallery piece (Bunny: unveil → gavel → a tap on a 3D plaque → sold → result) / a full 3-game set + shop / 10 turns of each host game on 2 phones + 3 bots, orbiting, checking the chosen player; recorded side by side
node test/leave_rec.mjs <dir> [--only=1,2,3,4] [--video]   # every way out of a party on the real app page (Leave, turned away past the cap, the party ended after the set's podium + recap, the host closing it): straight onto the explore map on you, nothing over it, the camera pulled out of the building (--video + FFMPEG: frame-stepped mp4s)
node test/nav_shots.mjs <dir>          # the world screen's bottom bar: flat edge, the gold Host ring, tap -> host flow, "My party", reduced motion (FFMPEG=... for ring.mp4)
node test/mapchrome_shots.mjs <dir> [--prefix=after] [--lights=night,sunset,day] [--widths=320,375,390,430]   # the map's round buttons (Home / Friends aligned, measured; the 📝 note button clear of the chat, the bar and Back to me), the plaza chat (no boxes), the bar's colour + label contrast, by night / sunset / day
node test/diary_fit.mjs [dir] [--video] # longest KO/EN answers fit the diary page on 320/375px phones
node test/layout_shots.mjs <dir> [games] [--secs=40]   # every game's screens, and where the header / pill / action area / dialog box sit on each (layout.json)
node test/howto_rec.mjs <dir> [games] [--ko]   # each host explaining their game: in full the first time, one line + How to play the next (FFMPEG=... for mp4s)
node test/upload_rec.mjs <dir> [chromium|webkit|both|iphone-profile]   # Art Gallery photos on the real app page: the camera card on top, 3 picked at once, "Uploading 2/3…"
node test/app_shots.mjs <dir> [--video] # the REAL app page offline: map, bar, explore, NPC, style, host, room, beacon
node test/start_rec.mjs <dir> [--quick] | --still   # the start screen on the real app page: the still, the live drift, Start -> the dive -> the lobby, an invite link (no buttons, the same dive), Join with a code, back -> Leave the party?, the glass over the brightest stretch, a 6x-throttled phone (lite glass), Start before the 3D is up; --still re-shoots web/start/night.jpg (FFMPEG=... for the mp4s)
node test/start_film.mjs <dir> [start|invite]   # the start screen filmed frame by frame for machines without a GPU: the scenery's clock stepped, each 3D frame read out of WebGL, the page's own glass/UI layered on in a canvas page (blur included); Start -> the dive -> the lobby, and an invite link -> name -> character -> the dive (FFMPEG=... for the mp4s)
node test/onboard_rec.mjs <dir> [en|ko|both] [--quick]   # the onboarding on the real app page, fresh phones each in their own browser context: a returning player (the chip, straight in), Path A (invite link -> the start screen with the party's name -> the setup card (3D / 2D) -> room -> first game) and Path B (the start screen -> Start a party -> the setup card -> invite) recorded, every screen in EN + KO, a declined location, an interrupted install, a guest verifying mid-party, tap -> first game for 5 fresh phones (FFMPEG=... for the mp4s)
node test/glass_shots.mjs <dir> [--prefix=before] [--only=a,b,c,d]   # every dialog, sheet, popup and button surface on the real app page (the setup card, sheets, confirms, toasts, Home, the recap, the votes sheet, the lobby, a profile card, End game?, the results, the host menu, Style, the shop, a beacon's card): before/after a change to the shared glass
node test/auth_rec.mjs <dir> [en|ko|both]   # accounts: a guest from an invite (no phone), Save your account with Kakao (same account, back in the party), a Kakao account that's taken, the phone prompt when going public (reason, 30 s, Send it again), the SMS provider refusing, a new phone signing in
node test/manhunt_rec.mjs <dir>        # Manhunt on 5 phones (2 on the real app page, simulated GPS, a fast clock): setup on the map, the Hunter's opening, a ping, a tag, a locked screen, SAFE, the results; what went over the wire (FFMPEG=... for manhunt.mp4)
node test/city_shots.mjs <dir> [areas]  # the city map: day/night shots per area, chunk fetch/build/mount times, the device cache, fps
node test/world_shots.mjs <dir> [places]  # the map anywhere: Gangnam, Itaewon (+ its edge), Hongdae, Calgary, Edmonton, Lotte World Tower: top-down next to a plan from the raw data (scripts/plan_map.py), street + wide at night, load times cold / cached; Calgary from the worldwide tiles alone (scripts/omt_fixture.py)
node test/light_shots.mjs <dir> [night,sunset,day]   # day and night glass: the start screen and the map's chrome at night, sunset and day (?light=), the panel over what's behind it, the text colours
test/hunter.html                       # Manhunt's Hunter on his own: poses, doors, counter, orbit (open it on npm run serve:test)
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

- **One screen layout** (theme.css "the shared game screen"): header bar on
  top (one line), one status pill under it, big reveals in the band under
  the pill, the dialog box at the bottom (always the same size), the action
  area (choices, stars, inputs, cards, votes) right above it. A game with a
  room puts `.np-pill` + `.gs-low` in it; one without uses `ui.screen()`.
  Instructions go in the dialog box, statuses in the pill.
- **How to play:** every game starts with a `howto` phase (howto.js) unless
  `ctx.howto === false` (the logic specs). Manhunt's is its rules phase.

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
- **Reloads:** a phone whose page reloads mid-game comes back with the same
  id; the host re-sends it the launch (`party.js` `_resume`) and it starts the
  game cold from the next snapshot. So a game's local UI state must be
  rebuildable from the synced state (e.g. Art Gallery's own photos come from
  `s.players[me].photos`).
- **Cleanup:** anything a game keeps (photos, answers, caches) registers a
  disposer with `trash` so it dies when the game or party ends.
- **Backdrop:** a game def with `backdrop: "room"` (the Ritual, Mask Off) is played
  over the dimmed party room (`#party-panel.pt-behind`) instead of the map.
- **Ratings (Side Quest):** open as soon as the turn starts, one tap
  locks a rating, and the turn ends once every watcher has rated; the clock
  only ends it if they haven't. Giving up scores 0 and skips ratings.
- **Mask Off has no scoring:** no ratings, no points, no winner. Everyone who
  answered at least once scores 1 (so they share first place and the same
  coins), everyone else 0. Its deck and rounds are the host's setup screen
  (`hostSetup`), not options in the votes sheet.
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
- Manhunt never sends a player's position off the phone. Location is read
  only during the head start and the hunt. At a ping (and every 5 s while
  live, 30 s outside the zone) a runner's phone sends only a fuzzy circle
  (`mhgeo.js` `fuzz`: 25–50 m, the centre moved a random way and snapped to
  a 10 m grid, a fresh draw each time); teammates' circles and team chat are
  end-to-end encrypted to the team (`mhcrypt.js`); Sprint Alert is sealed to
  that runner and only buzzes. Circles are broadcast and kept in memory,
  never in the synced state, never stored. The zone check runs on the
  phone: only "in" / "out" goes to the host.
- The prompt log (`diary_prompt_log`) must never contain user ids, handles or
  answer text.
- Analytics (`events`, `web/analytics.js`) carry a random per-install id,
  never a user id, and only whitelisted props: never a location, a name, a
  party code or anything typed. Clients can only insert; the numbers are
  admin-only (`onboarding_stats()`).
- An invite link carries the party's name and how many are in (parties live
  in no table), never anyone's handle or location.
- Accounts: anyone plays as a guest with just a name and a character; no
  phone or email to open the app, follow an invite, or host / join a private
  party. Phone verification (or a linked Kakao account) is asked only for the
  stranger features: making a party public, joining public parties, adding
  friends, earning and spending coins. Saving an account links a provider to
  the same user id (`linkIdentity`), never a new account; the phone number is
  never shown to anyone or sent to analytics.
- Friendships only ever come from a verified in-person meetup (server-side).
  There is no client "add friend" action; the profile card only shows status.
- Reports (`reports`) are insert-only from clients and carry no message text.
- Notes on the map (`web/notes.js`, `019_notes.sql`, `docs/notes.md`): a
  note's position is stored snapped to the 20 m grid (the phone snaps before
  sending, the server snaps again), never the author's GPS point. A reader's
  position reaches open / vote / react / report already snapped on the
  phone, is used for the 80 m check and is never stored, logged or
  returned; markers come from the visible map's box, never "near me". The
  author is tied to the note server-side only and never returned to anyone
  (the public image is named after the note, not the upload path).
  Photos / memes are redrawn and re-encoded on the phone (no EXIF / GPS)
  and stay pending, seen only by their author, until the moderation
  function passes them. A reported note is hidden at once, for everyone,
  until an admin reviews it. Notes are never left on a home (the phone's
  map-data check).

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
- Mask Off's deck is exactly the supplied list (light, real, deep); the host
  picks the levels (light + real by default). Hands are private: only each
  player's own phone ever shows their hand, and hands go in the state as card
  ids only. No card is dealt twice in a game. Answers are spoken out loud,
  never typed, sent or stored. "Same" taps are counted, never attributed: the
  host keeps who tapped to itself and only the count is synced or shown (the
  table's Same glows rise from its middle, never from anyone's seat; only
  your own phone shows your own glow).
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
