# Rando — Pitch Deck Design Brief

**For:** Claude Design (visual rewrite/elevation pass)
**From:** Emanuel Kong (CEO) & Tony Kong (CTO), Rando
**Deliverable:** an investor-ready pre-seed deck. Content below is final-draft copy — improve layout, typography, visual rhythm, and slide craft. Do not soften, hype up, or pad the copy; the voice is deliberately concise, confident, matter-of-fact, and mechanism-driven.

---

## 1. What Rando is (context for the designer)

Rando is a real-time social layer over a real city district. Open the app and everyone nearby appears as an anonymous low-poly character inside a 3D digital twin of the neighborhood (currently Itaewon, Seoul — 4,471 real buildings from the Korean government building registry). Location is zone-coarse ("by the crossing"), never precise GPS. Party-game mechanics (co-op GPS quests, venue-tied minigame lobbies) plus chat-before-you-meet turn proximity between strangers into a socially acceptable conversation.

**Key fact that shapes the whole deck: this is a working, deployed product** (randoirl.vercel.app), not a mockup. Every product visual in the assets folder is a real frame from the running app or a real generated game asset. The deck should feel like the product: playful low-poly warmth on top of a serious, precise argument. Never let it look like a template with stock art.

## 2. Structure

16 slides, 16:9. The narrative follows the Airbnb seed-deck skeleton (problem → solution → validation → market → product → business model → adoption → competition → team → ask) fused with Rando's own arc (pain → insight → mechanics → world → honesty about traction). Keep slide order exactly as in section 5.

## 3. Visual direction

- Current pass (included: `rando-pitch-deck.html`) uses: night-navy `#0d1220` background, panel `#151c30`, ink `#f2f4f8` / `#aab3c7` / `#6b7590`, amber accent `#f5b34a` (streetlight), mint `#7fd4c1` (the app's own UI accent). These echo the app's night-city mood — keep the family, refine freely.
- The product's aesthetic: rounded low-poly, flat matte PS2-era shading, pixelated console render. Design cues welcome (subtle pixel motifs, chunky rounded corners), but the deck must stay adult and investor-grade — game-flavored, not childish.
- Photography/renders should dominate the product slides; typography should dominate the argument slides (problem/insight/model).
- One accent color for emphasis; numbers in stat tiles, not charts. No decorative charts — the only quantitative visual is the market-size formula row and it must stay a formula, not a fake graph.
- `[ ... ]` amber dashed chips mark **deliberate placeholders** (see section 6). Style them as obviously-unfinished — they must not pass as final numbers.

## 4. Asset manifest (in `assets/`)

| File | What it is | Where used |
|---|---|---|
| `shot_default.jpg` | Live app frame — wide three-quarter over the district, characters in plaza | Cover bg, close bg |
| `shot_street2.jpg` | Live app frame — street level, pink character in foreground | Solution slide |
| `shot_aerial.jpg` | Live app frame — aerial of full district (Itaewon-ro + alleys) | World slide |
| `customize_strip.jpg` | 5 skin tones + 4 hair colors on the base character (real generated assets) | Identity slide |
| `outfit_strip.jpg` | Wardrobe variants on the base character (real generated assets) | Identity slide |
| `tripo_char.jpg` | Auto-rigged 3D character render (34-joint skeleton) | Identity slide |
| `logo_sky.jpg` | "rando" wordmark on sky (app icon art) | Optional cover/close treatment |

All app frames were captured from the deployed product on 2026-08-11. If higher-res or additional angles are needed, they can be re-captured on request — do not substitute stock or AI-generated city imagery.

## 5. Slide-by-slide copy (final draft — layout intent in *italics*)

### 01 · Cover
*Full-bleed `shot_default.jpg`, heavy dark gradient, wordmark huge.*
- Kicker: `PRE-SEED · 2026`
- Wordmark: `rando`
- Line: **Meet the people around you** — a live social layer over the real city.
- Chip (live-status style, mint): `● Live demo — randoirl.vercel.app · Itaewon, Seoul`
- Footer note: `every visual in this deck is the running product`

### 02 · Problem
*Typographic. Three beats, rule of three.*
- H: **Social media promised connection. It delivered scrolling.**
- We are surrounded by people and talk to none of them. A full bar, a full café, a full street — everyone on their phone, including you.
- Meeting someone new in real life has become genuinely rare. Not because people stopped wanting it — third places lost their social scripts, and cold-approaching a stranger now reads as strange.
- No easy way exists to turn "we're in the same place" into a conversation. Dating apps skip the room you're standing in. Social media shows you people you'll never stand near.

### 03 · Insight
*The thesis slide. Biggest type in the deck.*
- H: **The problem was never a lack of people. It's a lack of permission.**
- Every crowded district already has the supply — hundreds of people within a five-minute walk who would say yes to a conversation. What's missing is a socially acceptable *reason* to start one. Give two strangers a shared context and the approach stops being weird.
- **Rando manufactures that context, on location, in real time.**

### 04 · Solution
*`shot_street2.jpg` left, three bullets right.*
- H: **See who's nearby. Talk. Then walk over.**
- Open the app, see who's around. Everyone nearby appears as an anonymous character in a 3D twin of the district.
- Zone-level, never precise. Location snaps to a named zone ("by the crossing"), never GPS coordinates. Visibility is opt-in and one tap to kill.
- Talk before you meet. Public feed and 1-to-1 chat mean the first face-to-face moment is a continuation, not a cold open.
- Caption under shot: `Live product — street level in 3D Itaewon. The characters are people who are actually there.`

### 05 · How it works
*Three mechanic cards.*
- H: **Borrowed party-game mechanics, played in the real world**
- **QUESTS — Mario Party, but in real life.** GPS-triggered missions strangers complete together — two-person tasks that only fire when you're both standing in the same place. The quest is the icebreaker; nobody has to invent an opening line.
- **LOBBIES — Jackbox, but in real life.** Themed 2D rooms tied to real venues. A group gathers in the lobby, a randomized minigame reveals itself, and the shared-room energy of a party game plays out — except the room is an actual bar or bookstore.
- **CHAT FIRST — Warm intros, not cold approaches.** In-app chat runs before, during, and after. You've already exchanged messages with the person across the room — walking over is step two, not step one.

### 06 · The world
*`shot_aerial.jpg` dominant, facts right.*
- H: **A digital twin of the district — not a map with pins**
- 4,471 real buildings from the Korean government building registry — true footprints, floor counts, and heights, not procedural filler.
- Named venues & districts with day/night cycle matched to Seoul time.
- Archetype NPCs — Chill, Chaos, Sporty — keep streets alive between users; more archetypes planned.
- Venue-special quests — a real bar hands out a QR code as proof you finished its quest. The world is built to keep absorbing the real city.
- Caption: `The live world from above: Itaewon-ro and its alley network, rendered from government registry data.`

### 07 · Identity (product depth)
*Three image cells: customize_strip (wide), outfit_strip, tripo_char.*
- H: **Identity you own: one base character, endless variants**
- Lead: A full customization catalog is generated and already converted to rigged 3D: one skeleton, swappable hair / tops / bottoms / shoes, with color handled as material tints. All of it runs in the deployed app's engine.
- Captions: `Skin tones and hair colors — texture swaps on shared base meshes` / `Wardrobe: 10 bottoms, 6 shoes, tops` / `Auto-rigged 3D conversion (34-joint skeleton)`

### 08 · Market validation
*Three proof cards (Airbnb slide-4 pattern: adjacent markets prove the behavior).*
- H: **Every piece of this behavior already exists at scale**
- **LOCATION LAYERS WORK.** Pokémon GO proved hundreds of millions of people will walk city streets directed by a game layer — and that venues will pay to be part of it (sponsored PokéStops). Rando keeps the layer and makes the other players the point.
- **PEOPLE PAY TO MEET STRANGERS.** Stranger-dinner apps (Timeleft), Bumble BFF, running crews — a fast-growing category of products whose only job is introducing strangers offline. Demand is proven; they all schedule it days ahead. Rando does it live, where you already are.
- **THE PROBLEM IS INSTITUTIONAL.** Loneliness is now policy: the US Surgeon General's 2023 advisory, loneliness ministers in the UK and Japan. The gap between connectivity and connection is the defining social problem of this decade.

### 09 · Market size
*Airbnb slide-5 pattern: non-standard unit, bottom-up formula, sources. Formula row, not a chart.*
- H: **Counted in nights out, not ad impressions**
- Lead: Bottom-up from the unit we actually operate: one nightlife district. Each district is a contained market on both sides — people going out, and venues competing for them.
- Formula boxes: `[ # ] nightlife districts in target metros (Seoul alone: Itaewon, Hongdae, Seongsu, Gangnam…)` × `[ # ] weekly nightlife visitors per district` × `[ ₩ ] venue + cosmetic revenue per active district per month` = `[ TAM ] annual opportunity`
- Note (keep, restyle): **Deliberately unfilled.** Airbnb's seed deck cited sources for every market number — we hold ourselves to the same bar and will not invent figures. The structure is the claim: districts are repeatable units, and the win condition in one district prices all of them.

### 10 · Business model
*Airbnb slide-7 pattern: one hero line, then mechanics.*
- H (hero, accent): **Venues pay for verified foot traffic.**
- **Sponsored quests.** A bar buys a quest slot; completing it requires being physically inside and scanning the venue's QR code. The venue pays for provable bodies in the room — not impressions.
- **District priority.** Venues pay for placement in a district's quest rotation and labeled presence in the 3D world (their building, their name, their glow).
- **Cosmetics, later.** The character system (slide 07) is the consumer monetization surface — outfits and archetype skins — switched on once density is proven, never before.
- Example unit line (placeholders): `[ # venues ] per district × [ ₩/month ] sponsorship = [ ₩ district-month ] — priced against what venues already spend on promoters and portal ads.`

### 11 · Traction — first field test
*Stat tiles left + real chat transcript right, honesty block below. The transcript is verbatim production data — design it like the app's chat UI, do not edit the messages.*
- H: **10 strangers, one night, zero prompting**
- Tiles: `10 — real strangers live in Itaewon in one night` / `1st — session produced organic public chat` / `Shared — users showed the app to friends unprompted, in person`
- Chat transcript (verbatim, keep handles): status `"sketching by the crossing, come say hi"`; rando-b64b44: `first real public message!`; rando-9b9b3b: `yo from bogwang, can you hear me?`; rando-c70313: `Sup`; rando-3db7db: `What's up mfs`; Emanuelkong: `Yoooo hi guys`; Malone: `Hello 🤣🔥`; WhiteMonkey: `yoo`
- Honesty block (keep prominent — this is a trust move, not a footnote): **What hasn't happened yet: in-person meetups converting from the app.** That's a density problem, not a demand problem — with a handful of users spread across a district, no two are reliably in the same zone at the same time. It's exactly the gap the Itaewon-only launch is designed to close.

### 12 · Competition
*2×2 matrix left (axes: On a screen ↔ In the room / Scheduled ↔ Live-spontaneous), advantages right.*
- H: **Everyone else schedules it, screens it, or skips it**
- Matrix dots: Social media (screen/feed) · Dating apps (screen) · Meetup & Timeleft (in the room, scheduled days ahead) · Pokémon GO (live, but solo-first) · **rando** (in the room, live — alone in that quadrant, highlighted)
- Advantages: **Density playbook, not a waitlist** (one district at a time with on-the-ground launch ops — the only strategy that survives the cold-start) · **The world is a moat** (registry-data digital-twin pipeline rebuilds any city in days; competitors ship map pins) · **Safety by architecture** (zone-coarse presence, anonymous handles, identity-verification (본인인증) scaffold already built) · **In-house distribution** (a founder who has grown audiences to 60k+ — launch content is a core competency, not a spend line).

### 13 · Adoption strategy
*Three phase cards (Airbnb slide-8 spirit: concrete go-to-market, named places).*
- H: **Win one district, then copy the playbook**
- **PHASE 1 — NOW. Itaewon only.** Concentrate every user in one nightlife district to hit real zone density. Weekly launch nights, venue-partner quests with QR proof, FXIENDS-style short-form content aimed at the district's actual crowd. Success metric: strangers meeting in person from the app, every week.
- **PHASE 2. Seoul's districts.** Repeat district-by-district — Hongdae, Seongsu, Gangnam — each a contained density problem with its own venues and quest set. Same mechanics, new geography.
- **PHASE 3. Any city.** The stack is already city-agnostic: the world builds from public building-registry and OSM data, and quests/lobbies are templated per venue. District playbook + local content partner = a new city launch.

### 14 · Team
*Two cards. Keep the numbers bold.*
- H: **Two brothers: distribution and product**
- **CEO — Emanuel Kong, Growth & content.** Built Kingmaker Marketing from zero to $7k+/month across 10+ clients. Built FXIENDS to 60k+ TikTok and 29k+ YouTube followers — knows how to make a local scene show up.
- **CTO — Tony Kong, All of engineering.** Sole builder of everything in this deck: the 3D registry-twin engine, real-time presence and chat on Supabase, the safety/verification stack, and the generative character pipeline. Ships daily; the demo is deployed and live right now.

### 15 · The ask
*Rows, not pie charts. Amount is a placeholder by intent.*
- H: **Raising `[amount — TBD]` to prove the loop in one district**
- **Launch operations** — Weekly Itaewon launch nights, venue partnerships, on-the-ground community seeding until zone density sustains itself.
- **Trust & safety** — Korean identity verification (본인인증) integration and moderation — the foundation is built; the provider contract needs funding.
- **Product velocity** — Quest/lobby content system, more archetypes, iOS/Android wrappers over the deployed web engine.
- **Milestone** — **Recurring stranger-to-stranger meetups every week in Itaewon** — the number that unlocks district #2 and prices the market-size formula on slide 09.

### 16 · Close
*Mirror of cover, calmer.*
- Wordmark: `rando`
- Line: **Proximity is permission.**
- Chip: `● randoirl.vercel.app — open it tonight, someone might be by the crossing`
- Footer: `Emanuel Kong · Tony Kong`

## 6. Placeholder inventory (must remain visibly unfinished)

1. Slide 09: all four formula values + their sources.
2. Slide 10: example unit economics (venue count, monthly price, district-month revenue).
3. Slide 15: the raise amount.

Everything else is final copy. Do not invent numbers for these; the founders will supply sourced figures.

## 7. Hard don'ts

- No stock photography, no AI-generated city or people imagery — product frames only.
- No "transforming human connection" / "revolutionizing" language. If a sentence could appear in any startup's deck, it's wrong for this one.
- Don't cut the honesty block on slide 11 or the "deliberately unfilled" note on slide 09 — they are positioning, not gaps.
- Don't turn the market formula into a pie/TAM-circles graphic.
- Keep the verbatim chat messages untouched (including slang).
