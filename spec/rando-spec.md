# Rando — Product Spec (v5)
*Seoul, July 2026 — design session summary*

## One-line pitch
A gamified social app that gets strangers interacting offline and building genuine connections — friends, hobbies, business, dating, all valid, not romance-limited.
**The promise: never feel alone in a new city.**

## Design principle
Every mechanic exists to remove one specific barrier to a stranger saying hi. Nothing exists to keep people inside the app longer than that. The app's job ends the moment two people are actually talking.

**The core test for any new feature:** *if this were the only thing someone ever did in the app, would they still want to go outside?* If a feature is satisfying enough to be a whole evening on its own, cut it or weaken it — a self-sufficient virtual world is the single biggest threat to the mission (see "World model" below).

---

## World model — the Map is back (PS1/PS2-rendered, zone-safe)

The lobby-only model (no map at all) was the interim answer while the location-safety problem was unsolved. **It's been resolved, not abandoned — the map is back**, because a static/lobby-only world was tested directly this session and found to lack the "alive, real people nearby" feeling that's core to the promise. The fix was a real, specific safety mechanism, not just reverting the decision.

**The safety mechanism (final, not a placeholder):**
- **Coarse shared zones, not personalized fuzzy points.** Characters are snapped to one of a fixed set of named zones across the neighborhood — everyone physically present in the same real-world area shows up clustered at the *same* zone marker, indistinguishable from one another. This is different from (and stronger than) offsetting each person's own position by a random blur — a shared bucket has no "center near you" to reverse-engineer at all.
- **Infrequent refresh (~15 minutes), not live/continuous.** Positions update in slow snapshots, not real-time movement. This kills the live-triangulation risk (someone walking around watching a dot creep closer) that made the original literal map unsafe.
- **Together, these two properties are what make it safe** — slow refresh alone isn't enough (a patient attacker could still collect precise snapshots over days/weeks, the Strava-pattern risk); coarse zones alone isn't enough if updated live (still enables real-time approach-tracking). Both together close both failure modes identified this session.
- No position history is retained per-identity beyond what's needed for the current session's zone display.

**Visual direction: PS1/PS2-era rendered world**, not a literal street map or a flat neutral lobby. Low-poly faceted 3D geometry, hard cel-shading, bold black outlines, grainy early-2000s console rendering texture — see Character & art direction below for the full style spec and reference images used. World scenes generated so far: a rooftop/backyard deck party at night, dense layered city backdrop (tangled wires, mismatched building heights — mood and texture only, no readable signage/text, so it's not tied to one literal real city). Day/morning/sunset lighting variants of the same locked scene are in progress, generated from the same base for consistency rather than as separate environments.

**Public world**
- Single Itaewon-flavored world for this launch phase — not a neighborhood picker, not city-wide.
- Real players' characters and NPCs are visible throughout, positioned at their zone.
- If/when this expands to other cities, each gets its own separate instance with the same visual language — not one world stretched thinner across a wider area.

**Personal Home**
- A private space, earned progressively, that only becomes meaningful once someone has real (IRL-verified) friends — friends can visit.
- Your own music, a bio/self-intro space for people to learn about you, room for cosmetics/decor unlocked through play.
- Can host events / networking among your real-world-verified friend circle.
- **Does not undermine the core mission** — because reaching it requires having already gone outside and met people for real. It's the reward space, not a substitute for the map/world.

---

## Core loop

1. **Toggle "open"** → appear in the world at your zone. No keyword, no setup step.
2. **See other real players' characters and NPCs** positioned throughout the world (zone-snapped, ~15-min refresh — see World model).
3. **Match with someone nearby** (real-world proximity handled invisibly on the backend, consistent with the zone-safety model above).
4. **Quick 1v1 microgame** — WarioWare-style: fast (5–10 sec), universally understood with zero rules explanation, no romantic framing. Win/lose a point. The game is the icebreaker, not the destination. **Not yet built in the current prototype/demo** — NPCs and their game spots are being placed in the world now; actual minigame logic is a deferred build step.
5. **Public + private chat already open** — no separate unlock step. Chat bubbles styled as familiar rounded message bubbles (iMessage-style blue/grey bubble shape), built directly in code rather than as an image asset. You can also view their **animated character-story** (a short intro sequence showing personality/interests) before or after playing.
6. **From there it's up to the two people** — talk, meet up, or don't. No app-imposed obligation.
7. **Add as friend** — only possible after a real IRL encounter. This is the big reward, gated entirely behind a real-world meeting, and it's the door into each other's Personal Home.

---

## NPCs — solving cold start without faking connection

- **NPCs are placed throughout the world**, not confined to one arcade zone — part of what makes the map feel populated and alive even at low real-user density.
- **NPC minigames are 1-vs-many**, not a solo copy of the 1v1 real-player game. Scales naturally — 1v1 if no one's around, up to 1v5+ if a crowd's active. **Not yet coded** — NPC characters and their world placement are being built first; the minigame mechanic itself is a deferred build step, same as the real-player microgame.
- Visually and functionally distinct from real players at all times (clear "guide" marker) — the app never blurs who's real.
- Different prize track than real-player games: bigger shared point pools / rarer cosmetics, since it doesn't carry the friend-add payoff.
- NPC hosts have light personality/flavor (chill, chaotic, competitive) — game-show energy, not a generic bot voice, and **deliberately shallow, not deep lore.** Mobile is a poor medium for sustained narrative (short attention spans, high interruption), and — more importantly — rich NPC storylines risk making the world satisfying enough on its own that people stop needing the real-world payoff. NPCs are seasoning, not a destination.
- **First 4 NPC designs generated this session**, matching the locked character art style: dreads/orange tee/olive cargo with skateboard; silver shaggy-haired woman with tattoos, low sunglasses, art notebook; buzz cut/white tank/cargo pants with skateboard; curly-permed hair/beige tee/headphones with skateboard.
- **Why it matters:** low real-user density on a slow night still *feels* like a live, populated world instead of an empty one. Also produces good early content/footage for a low-turnout launch night.

---


## Progression & incentives

**Point hierarchy (small → large reward):**
1. NPC 1vMany games — modest points / cosmetic odds
2. Real 1v1 microgame win — solid points
3. **Adding a friend via a real IRL encounter — the largest payout by far.** This is deliberate: the biggest reward in the app is only reachable through a real offline connection.
4. **Adding a friend via a Personal Home party invite (friend-of-friend, never met in person) — zero points.** Full friend status and full home access either way, but no payout when the underlying real-world encounter didn't happen. This closes the obvious farming loophole (throwing parties to mass-generate friend-adds without ever going outside) while still allowing genuine friend-of-friend networking to work. The point ledger stays an honest signal: points on a friendship mean you built it in person; no points doesn't mean the friendship is lesser, just that it started differently.

**Personal goals**
- A standing, longer-term preference — e.g. "meet more founders," "meet more runners." Shapes matching and notifications over time rather than per-session.
- **Public or private, user's choice** — public makes you discoverable as "the type someone's looking for"; private just quietly improves your own matches.
- **World matching becomes algorithmic over time** — as real usage data accumulates (who you've clicked with, your own post-encounter reflections, your Da Vinci Wheel shape), the app can weight who you're shown toward your actual pattern, not just raw proximity. **Deliberately keep some randomness in the mix** — over-optimizing for "your type" removes the actual value of a stranger-encounter app, which is that some of the best connections are the ones you wouldn't have picked yourself.

**The Da Vinci Wheel — six-sided personal growth chart**
- Grows based on the *type* and diversity of real interactions, weighted toward personal goals, not just raw activity count.
- Reframes progress from a single XP number into a personal shape — encourages well-roundedness ("renaissance person") over grinding one easy category.
- Doubles as an optional leaderboard axis ("most balanced individual") alongside a raw-points leaderboard.

**Cosmetics as the reward currency**
- Earned through play (Club Penguin model: participation, not purchase) for the **public world** — status in front of strangers stays earned-only, never pay-to-look-better, to avoid turning the shared space into a status economy.
- Applies to the character system already built: skin tone, hair, outfit, accent color — expandable cosmetic slots unlock with points.

**Notifications**
- The one legitimate proactive nudge: "someone matching what you're looking for is nearby right now."
- Honest and specific rather than generic re-engagement bait — respects the "algorithm says no more often than yes" principle.

---

## Personal Home & friend networking

- A private space, earned/unlocked progressively, visitable only by real friends (see friend-add rules above).
- Your own music, a bio/self-intro space for people to learn about you, room for cosmetics/decor unlocked through play.
- **Hosting parties** — time-boxed (parties end, mirroring real life, creating urgency rather than a standing open door), invite-only or selective, run by the host (host-presence expected for v1, not a fire-and-forget standing invite).
- **Function:** lets people already in your real-world-verified circle meet and friend *each other* without needing to have met in person themselves — the host's real relationship with each guest is what's doing the vouching, similar to how real-world social graphs already work (trusting a friend's judgment about who else is worth knowing).
- Can also host structured events — an AMA, a webinar, a networking mixer among your circle — not just casual hangouts.
- **Does not undermine the core mission** — reaching a Personal Home at all requires having already met people for real; it's a reward/utility space layered on top of real connections, not a substitute for making them.

---

## Monetization

- **Cosmetics (lobby) stay earned-only, never paid** — protects the public space from becoming a status-for-sale economy.
- **Primary paid angle: the Personal Home.** Bigger/fancier home layouts, higher guest capacity for hosting, premium decor sets, special hosting themes/effects. This is paying for utility and space, not for status in front of strangers — a meaningfully different (and easier to justify) purchase than a cosmetic shop.
- Business/venue sponsorship (flagged earlier, still v2) remains a separate, likely larger revenue line once the core loop is proven — venues paying for placement/events has clearer ROI than betting on individual cosmetic spend at low user counts.

---

## Character & art direction

- **Visual style: Jet Set Radio × early-2000s PS1/PS2-era 3D** — cel-shaded, bold flat color, thick black outlines, low-poly faceted geometry, grainy console-render texture. Chosen over a smoother/rounder MapleStory-Zepeto blend because it's distinctly urban and youth-culture-coded (fits Itaewon's actual energy better), carries built-in nostalgia for the core demographic, is not currently oversaturated by competitors, and is genuinely cheaper to produce well than photorealistic 3D.
- **Style anchored to two locked reference images** (a low-poly grocery-store street scene and a low-poly action scene) — every generated asset (player character, NPCs, world/background) is produced by re-anchoring to these two references each time, not by chaining off previous generations, to avoid style drift. This session confirmed that text-only style descriptions ("PS1 style," "low-poly") reliably drift toward smooth/painterly output without a real image reference to hold against.
- **Player character system:** base body + swappable layers (skin tone, eyes, hair, outfit, accessories), generated via Higgsfield, background-removed, organized into a layer folder. Hair/outfit color is applied as a runtime tint in code, not baked into separate images per color — one shape asset per style, colored programmatically (same principle validated in the original prototype's `hsl()`-based recoloring).
- Deliberately no realistic anatomy or facial detail — removes both the catfishing risk and any path toward sexualized customization; the low-poly/cel-shaded style reinforces this rather than fighting it.
- **4 NPC designs generated and locked** (see NPCs section) — visually distinct personalities, same style anchor, natural relaxed poses rather than the player character's neutral T-pose (NPCs aren't decomposed into swappable layers, so no pose-alignment constraint applies to them).
- **Chat bubbles are built in code, not as generated image assets** — simple rounded-rectangle bubble shapes styled in the app's own palette (deliberately not a literal recreation of Apple's iMessage bubble design/color, to avoid both a derivative look and unnecessary trademark proximity) — color/shape choices left to implementation.
- **World background art:** generated via the same locked style references. Current locked scene: rooftop/backyard deck party at night, layered dense city backdrop for mood/texture (no readable signage or text — keeps it evocative of East Asian street density without being tied to one literal city). Morning/day/sunset lighting variants to be generated from this same locked scene for consistency.
- Same character renders consistently across the world, chat, character-story animation, and Personal Home.

---

## Safety architecture (non-negotiable, carried through every version tonight)

- **No live/continuous position display, no personalized fuzzy points, no per-identity location history, ever.** The map's safety comes from two combined properties (see World model): coarse shared zones (everyone in the same real area shows at the same marker — nothing to reverse-engineer back to one person) and infrequent refresh (~15 min, not live). Neither alone is sufficient; both together close the live-triangulation risk (Zenly's failure mode) and the accumulated-pattern-over-time risk (Strava's failure mode) identified directly this session.
- **No persistent identifying features** — avatar only, never a real name or photo.
- **Graduated visibility** — new accounts earn exposure gradually through good encounters.
- **Mutual reveal only** — nothing shown until matched.
- **Quiet deflection over banning** — problem accounts are shown "nothing nearby" rather than publicly flagged.
- **Algorithm says no more than yes, by design** — refusal protects quality and safety; this is a stated principle, not a bug to optimize away later.
- **Phone number verification (SMS) at signup** — one verified number per account; the main friction point against fake-account farming of the high-value friend-add reward. Note: Zenly's own account-takeover/phone-exposure bugs (2021, patched) came from friend-list and friend-request endpoints leaking data regardless of accept/reject status — a direct implementation lesson: any endpoint touching phone numbers or friend lists needs a real security review before launch, not just a good spec.
- **Mutual tap-confirm** required for any completion event that pays out points or unlocks friend-adding — no single-party self-report counts for anything that matters.
- **Implementation note:** the zone-snap + slow-refresh mechanism must be built correctly to hold this guarantee — e.g. zones need to be coarse enough that a single zone isn't ever occupied by just one identifiable person, and refresh timing shouldn't be user-triggerable more often than the stated interval. Worth a real security review of this specific mechanism before launch, not just before general launch.

---

## What's explicitly *not* in v1 (current demo build)

- **Minigames are not yet coded** — both the real-player 1v1 microgame and the NPC 1vMany games are designed and specced but not built. Current build priority is getting characters, NPCs, and the world itself working first.
- **No paid cosmetics yet** — earned-only for v1; monetization via cosmetics purchases or venue/business sponsorship is a later-stage question, not a launch requirement.
- **No live audio/video recording of in-person meetups.** Any "memory" layer is a private, optional post-encounter reflection (voice note or similar), never a recording of the conversation itself.
- **No deep NPC lore/questlines.** Light flavor only — see NPCs section above for why.
- **Business/venue layer (in-chat ordering, FAQ bot, sponsored events) — deferred to v2.** Real, promising, not required to test the core thesis.
- **Auto-translation layer — deferred to v2**, but flagged as a strong differentiator for a mixed-language neighborhood like Itaewon; worth prioritizing early post-launch.
- **Location-tied physical quests are not a core feature.** They may exist later as occasional seasoning (sponsored venue events, club-specific challenges) but are not part of the default loop.
- **The differential-privacy/geo-indistinguishability version of location safety (calibrated noise instead of zone-snapping) is a future upgrade, not v1.** Zone-snap + slow-refresh is the real, buildable v1 answer; the more mathematically rigorous version is worth pursuing once there's a developer with real privacy engineering experience.

---

## Comps referenced this session

- **룸의정석** — proves the "wingman/icebreaker mechanic" works IRL at a bar scale.
- **Zenly** — proves a live map + cute avatars is genuinely fun and viral, but its always-on precise location, plus real shipped vulnerabilities (phone numbers exposed via friend-request/friend-list endpoints regardless of accept status), directly informed the decision to drop the map entirely rather than just fuzz it. Folded after Snap acquisition — also a durability caution.
- **Strava** — its 2018 global heatmap incident revealed military base locations from aggregated user routes, and separate research has shown individual public profiles can reveal home/work addresses from consistent run start/end points. Key lesson pulled from this: the risk isn't only live position (Zenly's failure mode) — accumulated historical patterns are their own, separate leak vector. Rando's spec commits to not retaining per-user location history in any form, including for stats/trust-graph purposes.
- **Zepeto** — proves the avatar/cosmetics economy works at scale in Korea; virtual-only, no real-world stranger-contact layer (the thing Rando adds, and the thing that adds the most risk).
- **Niantic / Pokémon Go** — proves location-based, real-world-anchored play drives genuine foot traffic; caution that most players solo the loop, which is why NPC games are structurally 1-vs-many rather than a pure solo copy.
- **Nomadtable** — closest direct competitor (real-time nearby-traveler meetups); own user reviews show open browsing + messaging breaks down into unwanted approaches — direct validation for gating contact behind a match + shared activity rather than open browsing.
- **Yubo** — cautionary comp on stranger-proximity apps with live maps; reinforces why no persistent identity and no live position display are non-negotiable rather than nice-to-haves.
- **Club Penguin** — the explicit model for tone (playful, low-stakes, inherently non-sexualizable character style) and the explicit cautionary tale for mission drift: a self-sufficient virtual world is fun enough on its own that it doesn't need the real world at all, which is the opposite of Rando's job. Every world-building decision this session was tested against this comparison.

---

## Status

World model resolved (map is back, PS1/PS2-rendered, zone-snap + slow-refresh safety mechanism). Character system, 4 NPCs, and a locked world background have been generated and processed (background-removed, organized). **Current build priority:** get the world, characters, and NPCs actually working and populated on screen — minigames (both real-player 1v1 and NPC 1vMany) are specced but deliberately not yet coded, so the immediate demo will show a populated, alive world without functioning games yet. Near-term focus remains **design and UI polish + content/marketing**, not fundraising, until the local proof-of-concept is testable. Launch test market: **Itaewon, Seoul.**
