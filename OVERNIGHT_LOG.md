# OVERNIGHT_LOG — UX/legibility pass (branch: `overnight-ux`)

Session start: 2026-07-25, off `4cd1e08` (= deployed shoot build; untouched).
Rules honored: branch-only, no push, build-verified per step, art direction locked.

---

## 1 · Self-audit (ranked)

Confirmed the known issues and found more. Ranked by impact on the
"where am I / who's near me / where do we meet" read:

1. **No onboarding at all.** First launch drops you into the world with
   zero instruction. Nothing says "tap a person", "walk to a venue",
   or what the glowing buildings are. Biggest single "what do I do" gap.
2. **Presence is invisible.** Nearby players exist in the world but
   nothing *frames* them — no count ("4 people in Itaewon now"), no
   visual differentiation between a real person, an NPC, and scenery at
   a glance. The social loop's first beat ("someone's around") never
   fires unless you happen to pan across someone.
3. **Districts unnamed.** The six zones have in-world labels, but the
   *neighborhoods* people actually navigate by — Hooker Hill, World
   Food Street, Antique Furniture Street, the main drag — don't exist.
   "Meet me on World Food Street" is how Itaewon is actually spoken.
4. **Label system is static.** No distance scaling, no fade, no
   collision handling. Zoomed out, hero labels + zone labels + nametags
   overlap into noise; zoomed in, far labels are illegibly small.
   All-white pills = players, venues and zones all read the same.
5. **Lighting/uniformity** — largely addressed on main already (sparse
   windows now 6 variants, lamp pooling, road night lift), but the
   night scene still has uniform *label* brightness and no visual
   hierarchy between waypoint (venue) and ambient (zone) text.
6. **Chat readability.** Public feed is 11px white-on-55%-black — hard
   to read on phone over a bright day scene; buttons at 34px are under
   Apple's 44px tap-target floor. Match card buttons similarly small.
7. **Proportions at street level.** Character is intentionally
   oversized (locked decision — not touching). Consequence: 2-storey
   venues read ~1.2× character height. Normalizer fixed *relative*
   building truth; the char-vs-world ratio is a design decision for
   daytime review, not an overnight change. Flagged only.

## 2 · Work log

*(newest at bottom; every entry build-verified before commit)*

- `843fe1d` housekeeping: heights-capture session fix (pre-pass, carried
  onto branch so the tree is clean).
- `f3b82c5` **Crisp DOM label layer** (your added priority — pulled early
  because it's the foundation the district labels sit on). Diagnosis: no
  canvas-texture fix could ever work here — the WHOLE WebGL canvas renders
  at 0.5× with `image-rendering: pixelated` (the locked console look), so
  sprite text inherits that ceiling at any texture resolution. Fix is the
  one you preferred: an HTML overlay (`#label-layer`) projected per frame
  through the same path the chat bubbles already use. SF Pro, vector-crisp
  at any zoom. Distance scale + far-fade + screen-space decluttering
  (priority: district > zone > hero > player > exit; nearest wins ties).
  Player/NPC name pills are now Apple-blue = "that's a person" at a
  glance. Verified live: 23 labels registered, declutter working, console
  clean. *Phone/retina check still needed on your side — DOM text should
  now be device-native sharp by construction.*

- `eb6d511` **Districts + hero beacons** (priority 2). Four named
  districts — World Food Street, Hooker Hill, Antique Furniture St,
  Itaewon-ro — each with a big tracked-out uppercase label (highest
  declutter priority, longest view distance) and a faint terrain-hugging
  color wash so the street reads as a distinct place even before the
  label resolves. Glow heroes (Jack's, Opry, Soap, Danco, Waikiki ×2,
  Agave, station) get a soft additive light column at night: waypoints
  read across the map. Verified: 27 labels registered, all four
  districts present, console clean, day mode unaffected (beams are
  night-only, washes are 0.05 opacity by day).
- `3915a85` **Presence + first-run hint + chat readability**
  (priorities 4 & 6). Zone chip now carries "N people around — say hi"
  — a zone-coarse count wired display-only off the existing remotes
  list; no distances, no coordinates, no history, per the safety model.
  First-run hint card (localStorage-gated, pure UI) teaches the three
  beats: beams = venues, blue name = person, eye = go open. Public
  chat: 12.5px lines on darker pills, 158px feed, 42px tap targets.
  Verified live including the hint's first-run path.

Both modes (`?mode=night`, `?mode=day`) boot clean after every commit —
console error-free, all 9 heroes placed, layers intact.

## 3 · Done vs open

**Done:**
- Crisp DOM labels for everything (venues, zones, players, exits,
  districts) with distance scale/fade + collision decluttering (P3 +
  your crisp-labels addendum — the full fix, not the canvas workaround).
- District recognizability layer + hero venue beacons (P2).
- Presence framing ("N people around"), first-run onboarding, chat
  readability + tap targets (P4 + P6 first slice).
- P5 (roads-vs-buildings, lighting variety) — the heavy lifting shipped
  on main earlier today (260 street lamps with pooled light, 6-variant
  windows, road night lift); I judged further overnight changes here
  riskier than valuable without eyes on a phone. Nothing added tonight.

**Open / needs your call:**
- District label positions are my best-knowledge anchors of real
  Itaewon geography (World Food St behind Hamilton, Hooker Hill off
  Usadan-ro, Antique St along Bogwang-ro). Eyeball them against your
  mental map and nudge coords in `web/world3d.js` DISTRICTS if any feel
  off — they're one-line edits.
- Character-vs-building proportion (audit #7): intentional oversize vs
  venue readability tension. Decide whether venues should scale up
  ~1.3× beyond footprint-true, or characters down. Not touched.
- **Phone check** (your side): DOM labels should be retina-crisp by
  construction, but the collision boxes use an estimated glyph width —
  if pills overlap oddly on the narrow phone frame, say so and I'll
  switch to measured `getBoundingClientRect` widths.
- **Hint copy**: three lines are my draft — tighten to taste in
  `index.html` (#hint-card).
- **3D-Tiles capture thread** (interleaved, non-UX): session propagation
  fixed; full zone traversal works; heights landed for only 19 buildings
  because the tileset bottoms out at a coarse LOD through my traversal.
  A depth probe (STOP 6 → 2 → 0.8) is still running in the background;
  if it finds street LOD, the recapture + rebake is two commands
  (`capture_heights_reference.py --tiles`, `bake_heights.py`). Data
  files on this branch only — nothing pushed.
- **Not pushed anywhere**: this entire branch. `main`/Vercel untouched
  for the shoot. Merge is your call: `git merge overnight-ux` when
  you've reviewed.
