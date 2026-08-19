# Rando mechanics — combined ranking (simulation × design review)

Sim columns are from `sim/RESULTS.md` (best headcount). Design review columns are the two persona verdicts from `verdicts.json` (JB = Jackbox-style, MP = Mario Party-style). The sim verdict is mechanical: ZERO-INTERACTION ⇒ cut; unresolved/degenerate/silent/long ⇒ rework; else keep.

| # | Mechanic | Tier / lane | Best n | Duration | p2p / player / min | Resolve | Degenerate | Flags | **Sim** | **JB** | **MP** | Agreement |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Timebomb / Hot Potato** | catalog / chaos | 4 | 45 s | 9.57 | 100% | 0% | — | **keep** | keep | keep | all agree |
| 2 | **Team Challenge (2p coop physical)** | superseded / sporty | 4 | 70 s | 10.0 | 100% | 0% | — | **keep** | tweak | tweak | designers both say tweak, sim says keep |
| 3 | **Split Clue** | catalog / any | 2 | 72 s | 7.5 | 100% | 0% | — | **keep** | keep | keep | all agree |
| 4 | **Infection Zones** | catalog / sporty | 8 | 2.3 min | 9.04 | 100% | 24% | — | **keep** | cut | keep | sim + MP keep, JB cut |
| 5 | **Tile Wars** | catalog / sporty | 16 | 3.0 min | 6.61 | 98% | 2% | zero-interaction possible at 2p | **keep** | cut | keep | sim + MP keep, JB cut |
| 6 | **Performance** | catalog / any | 16 | 12.0 min | 6.13 | 89% | 10% | unresolved 10% | **rework** | tweak | tweak | all agree |
| 7 | **Sheep Raid** | signature / sporty | 8 | 6.0 min | 4.84 | 100% | 19% | — | **keep** | keep | keep | all agree |
| 8 | **Death Tag / Cops & Robbers** | catalog / sporty | 2 | 28 s | 4.36 | 100% | 6% | — | **keep** | tweak | keep | sim + MP keep, JB tweak |
| 9 | **Consensus (debate to agree)** | superseded / chill | 4 | 49 s | 3.96 | 99% | 3% | zero-interaction possible at 2p | **keep** | tweak | cut | three-way split |
| 10 | **Split or Steal** | signature / chaos | 2 | 42 s | 3.83 | 100% | 53% | silent-completable; degenerate 53% (both_split_no_prize); sit-out at 16p | **rework** | tweak | tweak | all agree |
| 11 | **Race / Manhunt-Tag** | superseded / sporty | 2 | 28 s | 2.36 | 100% | 6% | — | **keep** | cut | cut | designers both say cut, sim says keep |
| 12 | **Order Up** | signature / chill | 16 | 3.4 min | 5.12 | 54% | 45% | silent-completable; unresolved 45%; degenerate 45% (tie_no_tiebreak); needs 3+ | **rework** | tweak | tweak | all agree |
| 13 | **Liar Game / Mafia** | unshaped / chaos | 16 | 4.2 min | 0.72 | 94% | 5% | needs 3+ | **keep** | keep | tweak | sim + JB keep, MP tweak |
| 14 | **Guess the Number (timing imposter)** | unshaped / chaos | 16 | 70 s | 1.48 | 100% | 0% | silent-completable; needs 3+ | **rework** | tweak | tweak | all agree |
| 15 | **Catch the Imposter** | unshaped / chaos | 8 | 80 s | 1.45 | 96% | 3% | silent-completable; needs 3+ | **rework** | keep | keep | designers both say keep, sim says tweak |
| 16 | **Draw My Thing** | catalog / any | 4 | 2.6 min | 1.84 | 75% | 24% | unresolved 24%; needs 3+ | **rework** | keep | tweak | sim + MP tweak, JB keep |
| 17 | **Caption This (제목 짓기)** | catalog / any | 4 | 73 s | 1.17 | 77% | 22% | silent-completable; unresolved 22%; needs 3+ | **rework** | keep | keep | designers both say keep, sim says tweak |
| 18 | **Tee Game (photo + slogan)** | unshaped / chill | 4 | 70 s | 1.45 | 73% | 26% | silent-completable; unresolved 26%; needs 3+ | **rework** | keep | keep | designers both say keep, sim says tweak |
| 19 | **Truth or Dare** | unshaped / chaos | 2 | 1.5 min | 1.73 | 0% | 100% | unresolved 100%; degenerate 100% (no_win_condition); needs 3+ | **rework** | tweak | cut | sim + JB tweak, MP cut |
| 20 | **Boss Fight** | catalog / any | 2 | 52 s | 1.45 | 100% | 0% | ZERO-INTERACTION | **cut** | cut | tweak | sim + JB cut, MP tweak |
| 21 | **Scavenger (planted object)** | superseded / chill | 16 | 2.0 min | 0.67 | 100% | 0% | ZERO-INTERACTION | **cut** | cut | cut | all agree |
| 22 | **Accuracy / Long Jump** | superseded / sporty | 16 | 12.0 min | 0.66 | 100% | 0% | ZERO-INTERACTION; low agency at 4,8,16p; skill-deterministic (87% top-skill wins) | **cut** | cut | cut | all agree |
| 23 | **Five Buttons** | unshaped / chaos | 16 | 12 s | 1.1 | 100% | 18% | ZERO-INTERACTION; sit-out at 8,16p | **cut** | tweak | tweak | designers both say tweak, sim says cut |
| 24 | **Rival Teams (generic)** | superseded / sporty | 16 | 2.0 min | 0.68 | 100% | 5% | ZERO-INTERACTION; skill-deterministic (77% top-skill wins) | **cut** | cut | cut | all agree |
| 25 | **Trivia (first to 3)** | catalog / any | 8 | 74 s | 0.47 | 100% | 0% | ZERO-INTERACTION | **cut** | cut | tweak | sim + JB cut, MP tweak |
| 26 | **Hide and Seek** | superseded / sporty | 2 | 2.6 min | 0.16 | 100% | 16% | ZERO-INTERACTION; low agency at 16p | **cut** | cut | cut | all agree |
| 27 | **31 (Nim)** | unshaped / any | 2 | 65 s | 0.53 | 100% | 30% | ZERO-INTERACTION | **cut** | cut | cut | all agree |
| 28 | **Trivia: Higher or Lower** | catalog / any | 2 | 50 s | 0.51 | 86% | 14% | ZERO-INTERACTION; unresolved 14% | **cut** | cut | tweak | sim + JB cut, MP tweak |
| 29 | **Trivia: Majority Rules** | catalog / any | 4 | 87 s | 0.68 | 39% | 79% | ZERO-INTERACTION; unresolved 60%; degenerate 79% (tie_or_timeout); needs 3+ | **cut** | keep | keep | designers both say keep, sim says cut |

## Persona notes per mechanic

**Timebomb / Hot Potato** — JB (keep): Zero explanation, the loser's phone going off is the laugh, proximity toss means no touching. Keep.  
MP (keep): Readable, luck-ish, loud payoff (the boom), any headcount. Best catalog minigame on the list.

**Team Challenge (2p coop physical)** — JB (tweak): Undefined. Its concrete forms are already on the list (Split Clue for talk, Sheep Raid for bodies). Define a task or drop the placeholder.  
MP (tweak): Two-player synced button-mash / mirror-move is a classic minigame — but pick the actual task; as a framework it can't ship.

**Split Clue** — JB (keep): Keep-Talking energy: the whole game is two strangers talking, and miscommunication is funny. One sentence of rules. Low spectator value but that's fine for a catalog pick.  
MP (keep): Readable (first pair done). Rotate puzzle difficulty randomly so the same pair doesn't always win.

**Infection Zones** — JB (cut): Physical, no laugh beat, requires a map. Not ours.  
MP (keep): Inside/outside a shrinking circle is instantly readable, zone placement is luck, elimination is drama, 4–16 scales. Keep.

**Tile Wars** — JB (cut): Needs a map and an explanation; no moment where the room reacts to a person. Not ours.  
MP (keep): Coverage is readable, teams scale, add random power tiles and a shrinking-map endgame so the 1v1 'teams never met' case can't happen.

**Performance** — JB (tweak): Best spectator moment on the list, but forced performing humiliates shy strangers. Make it opt-in per round, or pair performers, or flip it: the room DUBS a 10-second mime (the captions are the joke, not the acting).  
MP (tweak): Score the guessers too so the performer isn't the only one on the hook; 3 random performers per game, not everyone — 16 performers is 12 minutes.

**Sheep Raid** — JB (keep): Not our genre, but it works: rules fit in one sentence ('grab sheep, pen them, raid theirs'), failure is funny (your pen gets robbed), strangers can play it without talking.  
MP (keep): Pen counts are the score — readable. Add a golden sheep (worth 3) in the last 60 s as the comeback beat, and a shared countdown everyone can see. Our favourite of the signature three.

**Death Tag / Cops & Robbers** — JB (tweak): Not our genre. Physical contact with strangers is the comfort issue — tag by phone proximity (the app already has it), never by touch.  
MP (keep): Readable, everyone stays in (snowball), great at 8–16, last-survivor drama. Exactly what we'd ship.

**Consensus (debate to agree)** — JB (tweak): A conversation starter, not a game. Give it a twist — one secret dissenter who wins by steering the group wrong — and it becomes a game.  
MP (cut): No winner, no readable state. Cut.

**Split or Steal** — JB (tweak): Zero rules explanation and the best spectator moment on the list — but 'stolen from by a stranger, eliminated' is the one outcome that humiliates rather than amuses. Make stakes comedic (loser wears a badge / does a 10-second dare), and give the 14 watchers a job: predict the outcome.  
MP (tweak): Instantly readable (two buttons). Run as a bracket so everyone gets a chair; audience bets for coins fix the sit-out; the reveal animation IS the payoff — invest there.

**Race / Manhunt-Tag** — JB (cut): Death Tag does the same thing without the tagged players sitting out bored.  
MP (cut): Sit-out is the cardinal sin. Death Tag supersedes it.

**Order Up** — JB (tweak): Icebreaker DNA is perfect for strangers; the conversation round must be structured, not optional — give every player a 10-second 'defend your order' turn before guesses, and reveal one drink at a time so the room reacts to each person.  
MP (tweak): Win state ('most right') needs a live scoreboard and a speed tiebreak; cap at 8 (16 drinks is unreadable). Reveal beat: big check/cross rain per guess.

**Liar Game / Mafia** — JB (keep): Fibbage / Fakin' It DNA. Time-box the discussion, give the liar a category hint, reveal with a drumroll.  
MP (tweak): Readable only at the vote; the middle is talk. Put a visible 45-second timer on the discussion and a vote-count reveal.

**Guess the Number (timing imposter)** — JB (tweak): The imposter layer is the interesting half and it belongs with Catch the Imposter. The timing-stop alone is a fine 15-second palate cleanser.  
MP (tweak): Stop-at-5.00 is a classic reflex minigame — readable, quick, luck-ish. Ship that alone; the discussion/vote layer slows it down.

**Catch the Imposter** — JB (keep): Fakin' It shape. Force one sentence from each player before the vote (answers shown with names) so strangers can't sit silent — fixes the sim's 'silent-completable' flag.  
MP (keep): Readable at the vote, luck in who's imposter, scales to 16 with two imposters. Keep.

**Draw My Thing** — JB (keep): Proven format; bad drawings are the joke, so failure is funny and strangers relax. Fix the scale problem the sim found by drawing SIMULTANEOUSLY then guessing round-robin on phone — 16 players no longer means 8 minutes.  
MP (tweak): Drawing skill dominates. Handicap rounds (non-dominant hand, 8-second limit, draw with eyes closed) level it and are funnier. Points to drawer AND guesser, speed tiebreak.

**Caption This (제목 짓기)** — JB (keep): Quiplash-shaped: zero explanation, the reveal is everyone reacting to one answer, strangers are safe behind anonymity until the vote. Minimum 3 (2 always ties — sim agrees).  
MP (keep): Readable (votes). Use a head-to-head bracket vote instead of plurality to kill the ties the sim found, and animate the vote count.

**Tee Game (photo + slogan)** — JB (keep): Tee K.O. is literally ours. Minimum 4 so pairings stay surprising; bracket vote to kill ties.  
MP (keep): Random pairing is luck — levels the field. Readable. Keep.

**Truth or Dare** — JB (tweak): As-is it's not a game (no win). Its Jackbox form: everyone answers the truth question anonymously, the room votes who said it. Dares opt-in only with strangers.  
MP (cut): No win condition, nothing to read. Cut unless scored.

**Boss Fight** — JB (cut): Tap-fest with no personality and no reveal. If it survives: make each player's ANSWER the attack (type an insult; the room votes; the best one does the damage).  
MP (tweak): The spectacle (a shared HP bar dying) is very us, but nobody loses and nobody's MVP. Add last-hit bonus, random power-up turns, and a contribution podium.

**Scavenger (planted object)** — JB (cut): Physical pre-setup, no room, no reveal. Cut.  
MP (cut): No readable win state, slow, doesn't scale. Cut (handcrafted-quest tier only).

**Accuracy / Long Jump** — JB (cut): A skill show-off that embarrasses the less athletic stranger. Cut.  
MP (cut): Pure skill, the top athlete always wins (sim: 87%). Cut unless a random multiplier hides it.

**Five Buttons** — JB (tweak): Not a game — a 20-second DECIDER. Everyone watches one person press; the buzz is the laugh. Use it between games to pick who goes first / who pays. The sim is right that it's zero-interaction as a game.  
MP (tweak): Pure Chance Time. Keep it as the tiebreaker / interstitial, never as a headline game.

**Rival Teams (generic)** — JB (cut): A framework, not a game — nothing to react to until a task exists.  
MP (cut): Superseded by Sheep Raid, which is the concrete version. Cut.

**Trivia (first to 3)** — JB (cut): No room in it: nobody reacts to anyone. Trivia is only a vehicle — fold the questions into Majority Rules / 'who's most likely to' where the answer is a person.  
MP (tweak): Readable and fast, but knowledge decides it — mismatched players never win. Needs a luck layer (double-or-nothing final, random steals) or it's a filler only.

**Hide and Seek** — JB (cut): Long, sit-out, and a safety problem with strangers in a city. Cut.  
MP (cut): Sit-out plus a win state you can't see. Cut.

**31 (Nim)** — JB (cut): Solved, two-player, silent. Cut.  
MP (cut): Skill decides it with perfect play and three-plus players is kingmaking. Cut.

**Trivia: Higher or Lower** — JB (cut): Pure knowledge, no reveal, no people. Cut.  
MP (tweak): Fine 10-second filler on a shared screen if everyone answers together and the reveal is loud — but as a standalone game it has no payoff.

**Trivia: Majority Rules** — JB (keep): This is our bread and butter — 'what would the room say' is a personality reveal. Show the answers WITH names on the reveal ('who said gorilla?!') and it becomes about people. The sim's zero-interaction flag is about direction, not value: add a bonus for guessing a specific person's answer and the flag disappears.  
MP (keep): Readable, luck-heavy (guessing the room levels the field), scales to 16. Needs a minimum of 3 and an odd-count or tiebreak rule for even splits.

