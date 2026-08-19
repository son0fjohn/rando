# Rando mechanics — expert design review

Two functional review personas, each a composite of a studio's *public* design philosophy (not real named people):

- **JB — the Jackbox-style party designer.** Tests: does it need zero rules explanation? does failure stay funny rather than embarrassing? is there a genuine "everyone reacts to one person's answer" moment? would strangers who've never met play it?
- **MP — the Mario Party-style designer.** Tests: is the win condition readable within one second of watching? does luck level the field between mismatched players? is there a physical/visual payoff beat on win/lose? does it scale from small to large groups without breaking?

Verdicts per mechanic live in `verdicts.json` and are merged with the simulation into `COMBINED.md` / the report. This file is the reasoning.

---

## JB — Jackbox-style review

### Cut immediately
| Mechanic | Why |
|---|---|
| Trivia (first to 3), Higher or Lower | No room in it. Nobody reacts to anyone; knowing the capital of Peru is not a personality. Trivia questions are only a vehicle — pour them into Majority Rules where the answer is *a person*. |
| Boss Fight | A tap-fest. No answer to react to, no reveal, no loser. (If it must live: make each player's typed answer the attack and let the room vote which one lands.) |
| 31 (Nim), Rival Teams, Scavenger, Manhunt-Tag, Accuracy/Long Jump, Hide and Seek | Respectively: solved and silent; a framework not a game; needs pre-setup and has no reveal; identical to Death Tag but with bored benched players; a skill show-off that embarrasses the less athletic stranger; long, sit-out, and a safety problem with strangers in a city. |
| Tile Wars, Infection Zones | Not ours — map games with no "look at what *they* said" beat. (MP will disagree; that's fine.) |

### Keep as-is
Caption This, Tee Game, Split Clue, Liar Game / Mafia, Catch the Imposter, Majority Rules, Draw My Thing, Timebomb, Sheep Raid (grudgingly — "not our genre but it's one sentence of rules and failure is funny").

### Tweak — and the specific tweak
| Mechanic | Tweak |
|---|---|
| **Order Up** | The conversation round is the whole game and right now it's optional (the sim's antisocial pass completes it in silence). Make it structured: every player gets a 10-second *"defend your order"* turn before guesses lock, then reveal one drink at a time so the room reacts to each person. Speed tiebreak. |
| **Split or Steal** | The only outcome on the list that humiliates: stolen from by a stranger → eliminated. Make stakes comedic — loser wears a badge / does a 10-second dare / buys the ₩1,000 thing — and give the 14 watchers a job (predict split/steal). Keeps the spectacle, removes the sting. |
| **Performance** | Best spectator beat on the list, but forced performing crushes shy strangers. Opt-in per round, or flip it: the room *dubs* a 10-second mime (the captions are the joke, not the acting). |
| **Majority Rules** | Show answers *with names* on the reveal ("who said gorilla?!"), add a bonus for guessing a specific person's answer. That turns a room-guess into a person-guess — and, not incidentally, flips the sim's zero-interaction flag. |
| **Five Buttons** | Not a game — a 20-second *decider*. Everyone watches one person press; the buzz is the laugh. Use it between games to pick who goes first / who pays. |
| **Truth or Dare** | As-is there's no win. Jackbox form: everyone answers the truth question anonymously, the room votes who said it. Dares strictly opt-in with strangers. |
| **Guess the Number** | The imposter half is the interesting half and it already exists as Catch the Imposter; merge it there. The timing-stop alone is a fine 15-second palate cleanser. |
| **Death Tag** | Tag by phone proximity, never by touch — contact with strangers is the comfort line. |
| **Team Challenge / Consensus** | Undefined / not a game. Define a task or drop; Consensus becomes a game only with a secret dissenter. |

### Three new mechanics in the JB spirit
1. **Receipts** — everyone writes one "fact" about themselves (true or not). Cards come up anonymously; the room votes true/false; the reveal is the *person*. Two-truths-and-a-lie with a scoreboard. Zero rules, strangers-safe (you control what you reveal), every card is a spectator beat, and every vote is aimed at a specific person.
2. **Hot Take Dial** — a spicy-but-safe prompt ("pineapple on pizza", "window or aisle"); everyone slides a dial privately; the room sees the anonymous spread, then everyone points at who they think is the extreme. Reveal. The guess is directed at a person; the laugh is the outlier.
3. **Dub This** — one player mimes for 10 seconds; the others type what they're "saying"; the room votes the best dub. Performance without the performance anxiety: the performer can't fail, the writers carry the joke.

---

## MP — Mario Party-style review

### Cut immediately
| Mechanic | Why |
|---|---|
| 31 (Nim) | Perfect play decides it (the sim's top-skill player wins), three-plus is kingmaking. |
| Truth or Dare, Consensus | No win condition, nothing to read on the screen. |
| Rival Teams, Scavenger | A framework, and a game with no visible win state that needs pre-setup. |
| Race / Manhunt-Tag, Hide and Seek | Players sit out. That is the cardinal sin — Death Tag supersedes Manhunt precisely because tagged players *join*. |
| Accuracy / Long Jump | Pure skill; the sim says the most athletic player wins 87% of the time. Cut unless a random multiplier hides it. |

### Keep as-is
Timebomb ("best minigame on the list: readable, luck-ish, loud payoff, any headcount"), Death Tag, Infection Zones, Tile Wars, Sheep Raid ("our favourite of the signature three"), Caption This, Tee Game, Split Clue, Majority Rules, Catch the Imposter.

### Tweak — and the specific tweak
| Mechanic | Tweak |
|---|---|
| **Order Up** | Needs a live scoreboard so "most right" is readable; cap at 8 (sixteen drinks is a spreadsheet); speed tiebreak; reveal with a check/cross rain per guess. |
| **Split or Steal** | Run as a bracket so everyone gets a chair; audience bets for coins fix the sit-out the sim found (2 of 16 active); invest in the reveal animation — that IS the payoff. |
| **Sheep Raid** | Add a **golden sheep** worth 3 in the last minute (the comeback beat), and a shared countdown everyone can see. |
| **Trivia / Higher-Lower** | Knowledge decides it → mismatched players never win. Keep only as filler with a luck layer (double-or-nothing final, random steals, shared-screen reveal). |
| **Draw My Thing** | Drawing skill dominates. Handicap rounds (non-dominant hand, 8-second limit, eyes closed) level it *and* are funnier. Points to drawer and guesser. |
| **Performance** | Score the guessers too; 3 random performers per game, not everyone (16 performers = 12 minutes, per the sim). |
| **Boss Fight** | The dying HP bar is very us, but nobody loses and nobody's MVP. Last-hit bonus, random power-up turns, contribution podium. |
| **Liar Game** | Put a visible 45-second timer on the discussion and a vote-count reveal — the middle is otherwise unreadable. |
| **Five Buttons** | Pure Chance Time — keep as the tiebreaker/interstitial, never as a headline game. |
| **Guess the Number** | Stop-at-5.00 is a classic reflex minigame — ship *that* alone; drop the discussion/vote layer that slows it. |
| **Team Challenge** | Synced button-mash / mirror-move is a classic two-player minigame — pick the actual task. |

### Three new mechanics in the MP spirit
1. **Coin Rain** — for 30 seconds, coins drop at random spots on the shared map (GPS). Run and tap to grab; values are random (1/3/10). Readable, luck-heavy, physical, scales 2–16, a loud tally at the end.
2. **Hot Seat Shuffle** — musical chairs: fewer "seats" (map spots) than players; when the music cuts (random), be standing on one. Eliminated players become the DJ (they pick when it stops) so nobody sits out.
3. **Last Tap** — everyone holds a button; let go as late as you dare before the hidden 3-second bell. Latest release without going over wins. Ten seconds, pure nerve, any headcount, one giant number on screen. (The sim would flag it zero-interaction — MP does not care; this is a decider, like Five Buttons.)

---

## Where the sim and the designers disagree — and why
- **Majority Rules / Higher or Lower / Boss Fight / Five Buttons / Guess the Number**: the sim hard-flags them (a round can complete with no action aimed at another player); JB and MP keep several of them because the *room reveal* or the *luck-decider* role has value the sim's metric can't see. The reconciling move is the same every time: **aim the action at a person** (guess *who* said it, bet on *which* player, vote) — that preserves the beat and satisfies the rule. Where no such tweak exists (Higher or Lower), the designers agree with the cut in spirit: "filler at best".
- **Tile Wars / Infection Zones**: the sim ranks them high (forced proximity, clean resolution); JB cuts them (no laugh beat), MP keeps them. Archetype answers it: they're sporty-lane games and the sporty lane isn't trying to be Jackbox.
- **Team Challenge**: ranks #2 in the sim purely because the model *assumes* forced coordination. Both designers call it what it is — a placeholder whose concrete forms are already on the list.
- **Split or Steal**: the sim flags 53% "flat" outcomes (both split, nothing happens) and the 14-of-16 sit-out; both designers independently reach the same fix (audience participation + non-humiliating stakes).
- **Order Up**: sim says 45% ties and silent-completable; JB's structured "defend your order" turn and MP's speed tiebreak fix both numbers at once.

---

## The architecture split: NPC signature vs. catalog
The split itself is right — one high-polish, higher-commitment game per archetype is how the NPCs earn their personality, and a browsable, player-hosted catalog of 1–3-minute games is how groups keep going. Three things the quest-loop simulation says about it:

1. **Signature minimums don't fill organically.** At a single venue with ~25 arrivals/hour, Order Up (min 3) ran 2.7×/hour with ~2 minutes of dead air per player; Sheep Raid (min 4) ran 0.7×/hour and 60% of hours saw **zero** games; at low density (~5 arrivals/hour) nothing but Split or Steal ever starts. Fix: **the NPC seeds the lobby** (Nabi sits in Order Up; the chaos imp takes the second chair in Split or Steal; sporty bots fill Sheep Raid teams) and/or lobbies pool across the three venues.
2. **Dead air needs a game in it.** Two-minute lobby waits are where Five Buttons / Timebomb / Last Tap belong — 20–45-second catalog games *inside the lobby* turn the worst part of the funnel into the MP "interstitial". This is also the honest home for the decider-type mechanics the sim hard-flags.
3. **Split or Steal's audience is the product.** At 16 in a lobby, two play and fourteen watch; without audience bets the catalog game has a better ratio than the signature game. Build the watchers' job before building more Split or Steal polish.

---

## Recommendation — the strongest 3–5 per archetype
(sim rank · designer verdicts · reasoning)

**Chill** — *conversation is the mechanic.*
1. **Order Up** (signature) — with the structured "defend your order" turn + speed tiebreak. Sim: rework → keep once fixed.
2. **Caption This** — sim keep-after-tiebreak, JB keep, MP keep. The safest stranger game on the list.
3. **Tee Game** — random pairing is luck; JB's home turf; needs 4+.
4. **Split Clue** — #3 in the sim (7.5 p2p actions/player/min), both designers keep; pairs of strangers talking is exactly the product.
5. **Draw My Thing (simultaneous variant)** — fixes the 16-player duration and ties.

**Chaos** — *tension, bluff, and the room watching.*
1. **Split or Steal** (signature) — reworked stakes + audience prediction; keep the reveal animation as the centrepiece.
2. **Catch the Imposter** — merge Guess the Number's timing round into it as a sub-round; force a sentence each before the vote.
3. **Timebomb / Hot Potato** — #1 in the sim, both designers keep; also the lobby filler.
4. **Liar Game / Mafia** — with a visible timer.
5. **Dub This** (new, JB) — Performance's spectator beat without the anxiety.

**Sporty** — *bodies in space, everyone stays in.*
1. **Sheep Raid** (signature) — keep; add the golden-sheep comeback beat; solve the min-4 fill with bots or cross-venue lobbies.
2. **Death Tag** — snowball keeps everyone playing; tag by proximity.
3. **Infection Zones** — #4 in the sim after retuning (shrinking zones with capacity are the mechanic); MP keep.
4. **Tile Wars** — team coverage, readable; add power tiles / shrinking map so 1v1 can't end without contact.
5. **Coin Rain** (new, MP) — 30-second luck-heavy physical filler.

**Cut for good** (sim and both designers agree): 31 (Nim), Rival Teams, Scavenger, Race/Manhunt-Tag, Accuracy/Long Jump, Hide and Seek. **Demote to decider/interstitial**: Five Buttons, Guess the Number's timing round, (new) Last Tap. **Rework or cut**: Trivia standard, Higher or Lower, Boss Fight, Truth or Dare, Consensus, Team Challenge (define it).
