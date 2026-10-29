# Notes on the map

Short notes anywhere public, the feel of Elden Ring's messages: a line of
text, a photo or a meme, left where you stand, found on the map, read only
when you're there. Votes decide how long a note lives; the best become
permanent landmarks. Busy places (the spots the app already knows) gather
notes into small hubs.

Code: `web/notes.js` (the button, markers, the composer, an opened note),
`web/notegeo.js` (snapping, distances, the public-places rule, spots, the
lifespan numbers: pure), `web/notefilter.js` (the text filter: pure),
`web/noteimage.js` (photos and memes: strip, redraw, re-encode),
`supabase/migrations/019_notes.sql` (every rule that counts),
`supabase/functions/moderate-note/` (the image check),
`test/stubs/notes_stub.js` (the offline server). Hooked in with one line at
the end of `web/backend.js`; strings in their own block at the end of
`web/i18n.js`; styles in the "Notes" section at the end of `web/theme.css`.
`?notes=0` turns it off.

## Leaving a note

- **Leave a note** (a round glass 📝 button bottom-right of the world screen, the size of
  the map's other round buttons, level with the plaza chat's button; day / night like the rest) → the verification gate (a stranger-facing feature: a verified
  number or a Kakao-linked account, `onboard.requireVerified("notes")`; the
  SQL refuses unverified accounts too) → your location (a pre-prompt the
  first time) → the spot check → the composer.
- **Text** (200 characters), **Photo** (camera or library, an optional line)
  or **Meme** (a picture with top / bottom captions in white Impact with a
  black outline, drawn on a canvas, live as you type).
- **Where:** your position is snapped on the phone to the ~20 m grid
  (`notegeo.js snap`: rows of 20 m from the equator, columns of 20 m along
  the row's latitude) and only the cell's centre is sent; `leave_note`
  snaps it again (`note_snap_lat` / `note_snap_lng`, the same maths; the SQL
  test checks they agree on 400 points in 5 cities).
- **Public places only:** never on a house or an apartment block. Decided on
  the phone from the map data round the snapped cell: Itaewon's hand-made
  `buildings.json` (`cls: "res"`), the procedural city's chunks (baked
  archive, else the worldwide OpenMapTiles tiles: building kinds `h` house,
  `a` apartments) and a residential land-use area if the data has one. The
  cell's centre and 8 points 7 m round it are each "home" or not: refused
  if the centre is, or 5 of the 9 are (a yard between apartment towers), or
  the phone itself stands inside a home. Streets, parks, plazas, shops,
  offices and civic buildings are fine. Refused: "Notes can't be left here"
  / "여기에는 쪽지를 남길 수 없어요". The server can't check this (it has no
  map data); it's the phone's rule. If the map data can't be read at all,
  the phone says so and doesn't post.
- **5 a day** per player (UTC day), in SQL.
- **The text filter** (`notefilter.js`), as you type and again on the
  server: phone numbers (9+ digits in a run), emails (also "(at)/(dot)"),
  slurs (EN + KO: whole words and their plurals, the unmistakable ones
  inside squashed text; leetspeak, zero-width characters and spacing undone),
  full names (a common first name + a capitalised word, Mr / Dr + a name, a
  Korean surname + given name + 씨 / 님 / a job title) and company names
  (a list + Inc / Ltd / 주식회사 / (주)). The SQL (`note_text_problem`) is
  the authority for phone, email and slurs; its slur rows must equal the JS
  lists (checked). A spot's own name is allowed at it ("Lotte" at Lotte
  World Tower).
- **Photos:** decoded (EXIF rotation applied), redrawn on a canvas, re-encoded
  as a fresh JPEG (≤ 1280 px long side, quality 0.8), then every APP1-15 and
  COM segment is dropped (`stripSegments`; the browser's encoder adds its own
  sRGB ICC profile as APP2: nothing personal, dropped anyway): no EXIF, no
  GPS, no XMP. `hasMetadata()` reads the JPEG's segments and the app refuses
  to upload if anything but APP0 is left. Uploaded to the private
  `note-uploads` bucket in your own folder (`<user id>/<uuid>.jpg`); the note
  starts `pending`: only its author sees it (marked, dashed) until
  `moderate-note` passes it. Then a copy goes to the public `notes` bucket
  as `<note id>.jpg` (no user id in the name) and everyone sees it.
  Rejected: never shown to anyone else; the author sees "didn't pass".

## Finding and reading

- **Markers** for every live note in the box the map is showing
  (`notes_in_box`: the screen's corners cast onto the street, at most
  ~20 km across, 300 notes), from anywhere: text / photo / meme icons on
  small glass discs, a gold star for landmarks, a dot on your own.
- **Hubs:** zoomed out (camera distance > 270), a spot's 2+ notes fold into
  one marker with the count and the spot's name; tap it to zoom in.
- **80 m:** within 80 m of a note (your snapped cell to its cell) its marker
  gets a soft glowing gold ring and opens on a tap; farther away a tap says
  "Get closer to read this". The server checks again (`open_note`,
  `vote_note`, `react_note`, `report_note` take your phone-snapped position,
  snap it again, compare, and keep nothing of it).
- **An opened note:** the text / picture, when ("3 h ago"), views (unique
  players who opened it; the author doesn't count), the score (trust-
  weighted net votes, rounded), up / down, Agree / Disagree with both
  counts, how long it has left ("fades in 6 d", or "here for good"),
  Report. Never who wrote it: the author is stored server-side only (for the
  limit, bans and coins) and no function returns it. Your own note says
  "Your note" and has Take it down instead of the votes.

## Reactions and lifespan (the numbers are `019_notes.sql`'s; `notegeo.js NOTE_RULES` repeats them for labels)

| | |
| --- | --- |
| a new note lives | 7 days; **10 at a spot** |
| each weighted net vote | ±1 day (never past now: a note voted under now is gone) |
| landmark (permanent) | weighted net ≥ 25; **at a spot, net × 1.25** (20 votes) |
| agree / disagree | counted, shown, no effect on life |
| votes / reactions | one each per player per note, changeable (0 takes it back), never on your own note |
| who can vote / react | within 80 m, like reading |

**Trust-weighted votes** (`_note_trust`, server-side only, stored with each
vote, never shown per voter): 1.0; 1.5 for a verified account older than
30 days; 2.0 for that with 3+ confirmed games (`game_receipts`); 0.5 for an
account under 3 days old; 0 for anyone with an upheld report (a note of
theirs removed) or a ban. Life, score, landmark and coins all use the
weighted total.

**Spots** (`note_spots` = `notegeo.js NOTE_SPOTS`): the NPC venues of
`world3d.js` (Ikovox Cafe, Grand Ole Opry, Namsan 산스장) and every place in
`web/data/heroes.json`. A note within 60 m of one belongs to it. Party
beacons aren't spots: parties live in no table, so the server couldn't know
them. Add a place to heroes.json → add it to `NOTE_SPOTS` and the migration's
rows (the SQL test fails until all three agree).

## Coins

The author earns 1 coin per 5 weighted net upvotes (each step once: taking a
vote back and giving it again pays nothing), at most 10 a day from notes and
inside 013's 300 a day, only if verified and not banned (`_note_pay`, a
`security definer` function nobody can call directly; ledger reason
`note`).

## Safety

- **Report** on every note (with a confirm): hidden at once, for everyone
  (the author too), until an admin reviews it. Reports need the 80 m too (no
  hiding a whole city from home), 20 a day per player, carry no text, and
  keep the reporter (false reporting can be caught).
- **Review** (admins, `admins` table of 017): `note_reports_queue()`, then
  `review_note(id, 'restore' | 'remove' | 'ban')`. Restored notes stay up
  (later reports still queue). Removed = an upheld report: the author's votes
  weigh 0. Ban: removed, and `leave_note` refuses them (`note_bans`).
- **Images** stay pending until `moderate-note` passes them (fails closed:
  no key, provider down → still pending).

## Privacy (the AGENTS.md rules)

- A note's position is stored snapped to 20 m; the phone snaps before it
  sends anything and the server snaps again.
- A reader's position reaches the server already snapped, is used for the
  80 m check and forgotten: no table has a column for it.
- Markers come from the visible box, never "near me".
- The author is never returned to other clients (the public image name is
  the note's id, not the upload path, which has the user id in it).
- Images are stripped on the phone and moderated before they're public.
- Reported notes are hidden at once.
- Notes send no analytics events (nothing about a note, its place or its
  text reaches `events`).

## Set up (the owner)

1. Apply the migration: `python3 scripts/apply_migration.py supabase/migrations/019_notes.sql`
   (after 013 and 017 / 018). It creates the two buckets and their policies
   when Supabase Storage is there.
2. Deploy the image check: `supabase functions deploy moderate-note`, and set
   a key: `supabase secrets set OPENAI_API_KEY=sk-…` (omni-moderation), or
   `supabase secrets set MODERATION_PROVIDER=google GOOGLE_VISION_KEY=…`
   (Cloud Vision SafeSearch). Without one, pictures stay pending.
3. Optional safety net: a cron (Supabase scheduled function or pg_cron +
   pg_net) POSTing `{ "sweep": true }` to the function every few minutes
   re-checks anything left pending.
4. Leaving notes needs a way to verify people (the Phone provider or Kakao):
   the SQL refuses unverified accounts. Reading needs nothing.
5. Add yourself to `admins` to review reports.

## Testing

- `node test/notes_specs.mjs`: the filter (EN + KO, blocked and fine), the
  snapping, distances, the public-places rule, the lifespan maths, the JPEG
  metadata reader on a hand-built EXIF + GPS segment.
- `node test/notes_sql.mjs`: 019 in PGlite: snapping (JS = SQL), the 5 a day,
  80 m in / out, one vote per player, lifespan + landmark + spots, trust
  weights, reports, bans, pending images, the text filter (JS = SQL), the
  coin cap, the author never returned, no client access.
- `node test/notes_rec.mjs <dir>`: the real app page offline (Supabase faked,
  `test/stubs/notes_stub.js`; its fake moderator passes a picture after
  2.5 s unless it's mostly magenta): a text note, a photo (with EXIF GPS put
  in by the test: the uploaded bytes are checked for APP1 / Exif / GPS) and
  a meme; markers from far away; walking closer until the ring shows and
  opening one; a second player upvoting, agreeing, the view count; a report
  and the note gone; "Notes can't be left here" on a residential spot; "Get
  closer to read this". `FFMPEG=…` for an mp4, else frame strips.
