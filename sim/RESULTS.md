# Rando mechanic simulation — results

300 rounds per mechanic per headcount per population (mixed / antisocial). Interaction = player-to-player actions only (msg / tap / prox); acting on the game itself never counts. `inter/pl/min` = p2p actions per player per minute at the mechanic's best headcount; `max` = best across headcounts. `zero-p2p` = share of ANTISOCIAL rounds that completed with no p2p action (≥5% ⇒ hard flag).

## Ranked table

| # | Mechanic | Tier | Best n | Duration (best n) | Range 2→16 | inter/round | inter/pl/min | max | Resolve | Degenerate | zero-p2p | Flags | Sim verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Timebomb / Hot Potato** | catalog | 4 | 45 s | 45 s–45 s | 28.7 | 9.57 | 18.03 | 100% | 0% | 0% | — | **keep** |
| 2 | **Team Challenge (2p coop physical)** | superseded | 4 | 70 s | 57 s–79 s | 46.6 | 10.0 | 10.0 | 100% | 0% | 0% | — | **keep** |
| 3 | **Split Clue** | catalog | 2 | 72 s | 52 s–72 s | 17.9 | 7.5 | 7.5 | 100% | 0% | 0% | — | **keep** |
| 4 | **Infection Zones** | catalog | 8 | 2.3 min | 1.9 min–2.8 min | 169.7 | 9.04 | 9.04 | 100% | 24% | 0% | — | **keep** |
| 5 | **Tile Wars** | catalog | 16 | 3.0 min | 3.0 min–3.0 min | 317.4 | 6.61 | 6.61 | 98% | 2% | 6% | zero-interaction possible at 2p | **keep** |
| 6 | **Performance** | catalog | 16 | 12.0 min | 1.5 min–12.0 min | 1177.9 | 6.13 | 6.13 | 89% | 10% | 0% | unresolved 10% | **rework** |
| 7 | **Sheep Raid** | signature | 8 | 6.0 min | 6.0 min–6.0 min | 232.3 | 4.84 | 4.84 | 100% | 19% | 0% | — | **keep** |
| 8 | **Death Tag / Cops & Robbers** | catalog | 2 | 28 s | 28 s–2.4 min | 4.1 | 4.36 | 4.36 | 100% | 6% | 2% | — | **keep** |
| 9 | **Consensus (debate to agree)** | superseded | 4 | 49 s | 34 s–1.5 min | 13.0 | 3.96 | 4.06 | 99% | 3% | 25% | zero-interaction possible at 2p | **keep** |
| 10 | **Split or Steal** | signature | 2 | 42 s | 42 s–42 s | 5.4 | 3.83 | 3.83 | 100% | 53% | 0% | silent-completable; degenerate 53% (both_split_no_prize); sit-out at 16p | **rework** |
| 11 | **Race / Manhunt-Tag** | superseded | 2 | 28 s | 28 s–2.6 min | 2.2 | 2.36 | 2.36 | 100% | 6% | 2% | — | **keep** |
| 12 | **Order Up** | signature | 16 | 3.4 min | 2.5 min–3.4 min | 278.7 | 5.12 | 5.12 | 54% | 45% | 0% | silent-completable; unresolved 45%; degenerate 45% (tie_no_tiebreak); needs 3+ | **rework** |
| 13 | **Liar Game / Mafia** | unshaped | 16 | 4.2 min | 84 s–4.2 min | 48.4 | 0.72 | 2.16 | 94% | 5% | 0% | needs 3+ | **keep** |
| 14 | **Guess the Number (timing imposter)** | unshaped | 16 | 70 s | 70 s–70 s | 27.5 | 1.48 | 1.48 | 100% | 0% | 0% | silent-completable; needs 3+ | **rework** |
| 15 | **Catch the Imposter** | unshaped | 8 | 80 s | 80 s–80 s | 15.5 | 1.45 | 1.45 | 96% | 3% | 0% | silent-completable; needs 3+ | **rework** |
| 16 | **Draw My Thing** | catalog | 4 | 2.6 min | 1.8 min–8.1 min | 19.0 | 1.84 | 2.12 | 75% | 24% | 0% | unresolved 24%; needs 3+ | **rework** |
| 17 | **Caption This (제목 짓기)** | catalog | 4 | 73 s | 69 s–1.6 min | 5.7 | 1.17 | 1.29 | 77% | 22% | 0% | silent-completable; unresolved 22%; needs 3+ | **rework** |
| 18 | **Tee Game (photo + slogan)** | unshaped | 4 | 70 s | 70 s–70 s | 6.7 | 1.45 | 1.45 | 73% | 26% | 0% | silent-completable; unresolved 26%; needs 3+ | **rework** |
| 19 | **Truth or Dare** | unshaped | 2 | 1.5 min | 1.5 min–12.0 min | 5.2 | 1.73 | 1.73 | 0% | 100% | 0% | unresolved 100%; degenerate 100% (no_win_condition); needs 3+ | **rework** |
| 20 | **Boss Fight** | catalog | 2 | 52 s | 36 s–52 s | 2.5 | 1.45 | 1.45 | 100% | 0% | 100% | ZERO-INTERACTION | **cut** |
| 21 | **Scavenger (planted object)** | superseded | 16 | 2.0 min | 2.0 min–3.3 min | 21.1 | 0.67 | 0.67 | 100% | 0% | 100% | ZERO-INTERACTION | **cut** |
| 22 | **Accuracy / Long Jump** | superseded | 16 | 12.0 min | 1.5 min–12.0 min | 126.3 | 0.66 | 0.66 | 100% | 0% | 100% | ZERO-INTERACTION; low agency at 4,8,16p; skill-deterministic (87% top-skill wins) | **cut** |
| 23 | **Five Buttons** | unshaped | 16 | 12 s | 12 s–12 s | 3.6 | 1.1 | 1.14 | 100% | 18% | 100% | ZERO-INTERACTION; sit-out at 8,16p | **cut** |
| 24 | **Rival Teams (generic)** | superseded | 16 | 2.0 min | 2.0 min–2.0 min | 21.6 | 0.68 | 0.68 | 100% | 5% | 100% | ZERO-INTERACTION; skill-deterministic (77% top-skill wins) | **cut** |
| 25 | **Trivia (first to 3)** | catalog | 8 | 74 s | 72 s–1.8 min | 4.7 | 0.47 | 0.51 | 100% | 0% | 100% | ZERO-INTERACTION | **cut** |
| 26 | **Hide and Seek** | superseded | 2 | 2.6 min | 2.6 min–4.6 min | 0.8 | 0.16 | 0.21 | 100% | 16% | 17% | ZERO-INTERACTION; low agency at 16p | **cut** |
| 27 | **31 (Nim)** | unshaped | 2 | 65 s | 65 s–66 s | 1.2 | 0.53 | 0.57 | 100% | 30% | 100% | ZERO-INTERACTION | **cut** |
| 28 | **Trivia: Higher or Lower** | catalog | 2 | 50 s | 36 s–50 s | 0.9 | 0.51 | 0.6 | 86% | 14% | 100% | ZERO-INTERACTION; unresolved 14% | **cut** |
| 29 | **Trivia: Majority Rules** | catalog | 4 | 87 s | 63 s–2.1 min | 4.0 | 0.68 | 0.74 | 39% | 79% | 100% | ZERO-INTERACTION; unresolved 60%; degenerate 79% (tie_or_timeout); needs 3+ | **cut** |

## Per-headcount detail

### Timebomb / Hot Potato  ·  catalog / chaos  ·  rules allow 2–16  ·  target 45-60 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 45 s | 45 s | 100% | 0% (zero_toss 0%) | 0.0 | 7.3 | 19.7 | 18.03 | 0% | 100% | 100% | 100% | — |
| 2 | antisocial | 45 s | 45 s | 100% | 1% (zero_toss 1%) | 0.0 | 7.4 | 19.6 | 18.01 | 0% | 100% | 100% | 100% | — |
| 4 | mixed | 45 s | 45 s | 100% | 0% | 0.0 | 7.5 | 21.2 | 9.57 | 0% | 100% | 100% | 100% | — |
| 4 | antisocial | 45 s | 45 s | 100% | 0% (zero_toss 0%) | 0.0 | 7.5 | 21.0 | 9.49 | 0% | 100% | 100% | 100% | — |
| 8 | mixed | 45 s | 45 s | 100% | 0% | 0.0 | 7.5 | 22.6 | 5.01 | 0% | 100% | 100% | 100% | — |
| 8 | antisocial | 45 s | 45 s | 100% | 0% | 0.0 | 7.6 | 23.1 | 5.11 | 0% | 100% | 100% | 100% | — |
| 16 | mixed | 45 s | 45 s | 100% | 0% | 0.0 | 7.8 | 25.6 | 2.79 | 0% | 100% | 100% | 100% | — |
| 16 | antisocial | 45 s | 45 s | 100% | 0% | 0.0 | 8.2 | 25.4 | 2.8 | 0% | 100% | 100% | 100% | — |

### Team Challenge (2p coop physical)  ·  superseded / sporty  ·  rules allow 2–16  ·  target 1-2 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 79 s | 1.7 min | 96% | 3% (timeout 3%) | 13.2 | 0.0 | 13.2 | 10.0 | 0% | 0% | 100% | 100% | 100% |
| 2 | antisocial | 78 s | 1.7 min | 96% | 3% (timeout 3%) | 13.0 | 0.0 | 13.0 | 10.0 | 0% | 0% | 100% | 100% | 100% |
| 4 | mixed | 70 s | 84 s | 100% | 0% | 23.3 | 0.0 | 23.3 | 10.0 | 0% | 0% | 100% | 100% | 55% |
| 4 | antisocial | 71 s | 1.5 min | 99% | 0% (timeout 0%) | 23.6 | 0.0 | 23.6 | 10.0 | 0% | 0% | 100% | 100% | 58% |
| 8 | mixed | 61 s | 72 s | 100% | 0% | 40.7 | 0.0 | 40.7 | 10.0 | 0% | 0% | 100% | 100% | 35% |
| 8 | antisocial | 63 s | 78 s | 100% | 0% | 41.8 | 0.0 | 41.8 | 10.0 | 0% | 0% | 100% | 100% | 28% |
| 16 | mixed | 57 s | 66 s | 100% | 0% | 75.7 | 0.0 | 75.7 | 10.0 | 0% | 0% | 100% | 100% | 19% |
| 16 | antisocial | 57 s | 66 s | 100% | 0% | 75.7 | 0.0 | 75.7 | 10.0 | 0% | 0% | 100% | 100% | 17% |

### Split Clue  ·  catalog / any  ·  rules allow 2–16  ·  target 1.5-2.5 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 72 s | 1.6 min | 100% | 0% | 17.9 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 100% |
| 2 | antisocial | 73 s | 1.6 min | 99% | 0% (no_pair_solved_timeout 0%) | 18.2 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 100% |
| 4 | mixed | 62 s | 80 s | 100% | 0% | 31.1 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 59% |
| 4 | antisocial | 62 s | 80 s | 100% | 0% | 30.9 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 64% |
| 8 | mixed | 55 s | 64 s | 100% | 0% | 55.3 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 33% |
| 8 | antisocial | 56 s | 64 s | 100% | 0% | 55.9 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 41% |
| 16 | mixed | 52 s | 56 s | 100% | 0% | 103.4 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 21% |
| 16 | antisocial | 52 s | 56 s | 100% | 0% | 102.9 | 0.0 | 0.0 | 7.5 | 0% | 0% | 100% | 100% | 21% |

### Infection Zones  ·  catalog / sporty  ·  rules allow 2–16  ·  target 3-4 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 1.9 min | 4.0 min | 100% | 18% (timeout_many_survivors 18%) | 0.0 | 0.0 | 16.3 | 4.28 | 0% | 100% | 100% | 99% | — |
| 2 | antisocial | 2.0 min | 4.0 min | 100% | 20% (timeout_many_survivors 20%) | 0.0 | 0.0 | 17.4 | 4.31 | 0% | 100% | 100% | 99% | — |
| 4 | mixed | 2.3 min | 4.0 min | 100% | 22% (timeout_many_survivors 22%) | 0.0 | 0.0 | 49.1 | 5.25 | 0% | 100% | 100% | 79% | — |
| 4 | antisocial | 2.2 min | 4.0 min | 100% | 19% (timeout_many_survivors 19%) | 0.0 | 0.0 | 45.3 | 5.13 | 0% | 100% | 100% | 80% | — |
| 8 | mixed | 2.3 min | 4.0 min | 100% | 24% (timeout_many_survivors 24%) | 0.0 | 0.0 | 169.7 | 9.04 | 0% | 100% | 100% | 65% | — |
| 8 | antisocial | 2.5 min | 4.0 min | 100% | 25% (timeout_many_survivors 25%) | 0.0 | 0.0 | 166.5 | 8.25 | 0% | 100% | 100% | 62% | — |
| 16 | mixed | 2.8 min | 4.0 min | 100% | 30% (timeout_many_survivors 30%) | 0.0 | 0.0 | 399.7 | 8.82 | 0% | 100% | 100% | 51% | — |
| 16 | antisocial | 2.9 min | 4.0 min | 100% | 30% (timeout_many_survivors 30%) | 0.0 | 0.0 | 402.4 | 8.82 | 0% | 100% | 100% | 51% | — |

### Tile Wars  ·  catalog / sporty  ·  rules allow 2–16  ·  target 3 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 3.0 min | 3.0 min | 96% | 8% (teams_never_met 5%) | 0.0 | 0.0 | 14.4 | 2.4 | 5% | 100% | 100% | 100% | — |
| 2 | antisocial | 3.0 min | 3.0 min | 97% | 9% (teams_never_met 6%) | 0.0 | 0.0 | 14.6 | 2.43 | 6% | 100% | 100% | 100% | — |
| 4 | mixed | 3.0 min | 3.0 min | 99% | 1% (tie 1%) | 0.0 | 0.0 | 38.7 | 3.23 | 0% | 100% | 100% | 100% | — |
| 4 | antisocial | 3.0 min | 3.0 min | 99% | 1% (tie 1%) | 0.0 | 0.0 | 41.2 | 3.43 | 0% | 100% | 100% | 100% | — |
| 8 | mixed | 3.0 min | 3.0 min | 97% | 4% (tie 2%) | 0.0 | 0.0 | 104.8 | 4.37 | 0% | 100% | 100% | 100% | — |
| 8 | antisocial | 3.0 min | 3.0 min | 97% | 4% (tie 2%) | 0.0 | 0.0 | 106.1 | 4.42 | 0% | 100% | 100% | 100% | — |
| 16 | mixed | 3.0 min | 3.0 min | 98% | 2% (tie 1%) | 0.0 | 0.0 | 317.4 | 6.61 | 0% | 100% | 100% | 100% | — |
| 16 | antisocial | 3.0 min | 3.0 min | 99% | 1% (runaway 0%) | 0.0 | 0.0 | 312.8 | 6.52 | 0% | 100% | 100% | 100% | — |

notes: tiles 100-123; tiles 100-148; tiles 100-156; tiles 101-107; tiles 101-125; tiles 101-149; tiles 101-151; tiles 101-154; tiles 101-155; tiles 102-154; tiles 103-119

### Performance  ·  catalog / any  ·  rules allow 2–16  ·  target per-performer 45 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 1.5 min | 1.5 min | 70% | 30% (tie 30%) | 9.8 | 0.0 | 0.0 | 3.27 | 0% | 0% | 100% | 100% | 68% |
| 2 | antisocial | 1.5 min | 1.5 min | 72% | 28% (tie 28%) | 9.8 | 0.0 | 0.0 | 3.26 | 0% | 0% | 100% | 100% | 69% |
| 4 | mixed | 3.0 min | 3.0 min | 79% | 20% (tie 20%) | 58.9 | 0.0 | 0.0 | 4.91 | 0% | 0% | 100% | 100% | 46% |
| 4 | antisocial | 3.0 min | 3.0 min | 75% | 24% (tie 24%) | 58.6 | 0.0 | 0.0 | 4.88 | 0% | 0% | 100% | 100% | 46% |
| 8 | mixed | 6.0 min | 6.0 min | 81% | 19% (tie 19%) | 274.5 | 0.0 | 0.0 | 5.72 | 0% | 0% | 100% | 100% | 47% |
| 8 | antisocial | 6.0 min | 6.0 min | 84% | 15% (tie 15%) | 274.7 | 0.0 | 0.0 | 5.72 | 0% | 0% | 100% | 100% | 42% |
| 16 | mixed | 12.0 min | 12.0 min | 89% | 10% (tie 10%) | 1177.9 | 0.0 | 0.0 | 6.13 | 0% | 0% | 100% | 100% | 38% |
| 16 | antisocial | 12.0 min | 12.0 min | 87% | 12% (tie 12%) | 1175.7 | 0.0 | 0.0 | 6.12 | 0% | 0% | 100% | 100% | 41% |

### Sheep Raid  ·  signature / sporty  ·  rules allow 4–8  ·  target 5-8 min fixed

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | — | n/a | | | | | | | | | | | | |
| 4 | mixed | 6.0 min | 6.0 min | 100% | 16% (tie 16%) | 0.0 | 0.0 | 61.6 | 2.57 | 0% | 100% | 100% | 100% | 49% |
| 4 | antisocial | 6.0 min | 6.0 min | 100% | 13% (tie 13%) | 0.0 | 0.0 | 63.0 | 2.62 | 0% | 100% | 100% | 100% | 51% |
| 8 | mixed | 6.0 min | 6.0 min | 100% | 19% (tie 18%) | 0.0 | 0.0 | 232.3 | 4.84 | 0% | 100% | 100% | 100% | 49% |
| 8 | antisocial | 6.0 min | 6.0 min | 100% | 20% (tie 20%) | 0.0 | 0.0 | 232.8 | 4.85 | 0% | 100% | 100% | 100% | 51% |
| 16 | — | n/a | | | | | | | | | | | | |

notes: final 11-34; final 13-32; final 14-31; final 15-28; final 15-29; final 15-30; final 15-31; final 16-29

### Death Tag / Cops & Robbers  ·  catalog / sporty  ·  rules allow 2–16  ·  target 2-4 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 28 s | 24 s | 100% | 6% (timeout_survivors 4%) | 0.0 | 0.0 | 4.1 | 4.36 | 1% | 100% | 100% | 94% | — |
| 2 | antisocial | 36 s | 2.5 min | 100% | 9% (timeout_survivors 7%) | 0.0 | 0.0 | 4.7 | 3.91 | 2% | 100% | 100% | 94% | — |
| 4 | mixed | 67 s | 4.0 min | 100% | 12% (timeout_survivors 11%) | 0.0 | 0.0 | 10.5 | 2.36 | 1% | 100% | 100% | 98% | — |
| 4 | antisocial | 67 s | 4.0 min | 100% | 11% (timeout_survivors 11%) | 0.0 | 0.0 | 10.4 | 2.33 | 0% | 100% | 100% | 98% | — |
| 8 | mixed | 1.6 min | 4.0 min | 100% | 11% (timeout_survivors 9%) | 0.0 | 0.0 | 23.7 | 1.89 | 1% | 100% | 100% | 99% | — |
| 8 | antisocial | 1.6 min | 4.0 min | 100% | 11% (timeout_survivors 9%) | 0.0 | 0.0 | 23.9 | 1.86 | 1% | 100% | 100% | 99% | — |
| 16 | mixed | 2.4 min | 4.0 min | 100% | 13% (timeout_survivors 12%) | 0.0 | 0.0 | 52.0 | 1.38 | 1% | 100% | 100% | 99% | — |
| 16 | antisocial | 2.4 min | 4.0 min | 100% | 13% (timeout_survivors 11%) | 0.0 | 0.0 | 50.8 | 1.33 | 1% | 100% | 100% | 99% | — |

### Consensus (debate to agree)  ·  superseded / chill  ·  rules allow 2–16  ·  target 1-3 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 34 s | 70 s | 97% | 30% (instant_agreement 28%) | 4.0 | 0.0 | 0.0 | 3.53 | 28% | 28% | 100% | 100% | — |
| 2 | antisocial | 76 s | 3.0 min | 81% | 44% (instant_agreement 25%) | 5.2 | 0.0 | 0.0 | 2.06 | 25% | 25% | 100% | 100% | — |
| 4 | mixed | 49 s | 1.8 min | 99% | 3% (instant_agreement 2%) | 13.0 | 0.0 | 0.0 | 3.96 | 2% | 2% | 100% | 100% | — |
| 4 | antisocial | 1.9 min | 3.0 min | 74% | 28% (no_consensus_timeout 26%) | 15.7 | 0.0 | 0.0 | 2.1 | 2% | 2% | 100% | 100% | — |
| 8 | mixed | 72 s | 2.3 min | 95% | 4% (no_consensus_timeout 4%) | 38.7 | 0.0 | 0.0 | 4.03 | 0% | 0% | 100% | 100% | — |
| 8 | antisocial | 2.4 min | 3.0 min | 64% | 36% (no_consensus_timeout 36%) | 40.0 | 0.0 | 0.0 | 2.11 | 0% | 0% | 100% | 100% | — |
| 16 | mixed | 1.5 min | 2.7 min | 93% | 7% (no_consensus_timeout 7%) | 99.8 | 0.0 | 0.0 | 4.06 | 0% | 0% | 100% | 100% | — |
| 16 | antisocial | 2.8 min | 3.0 min | 34% | 65% (no_consensus_timeout 65%) | 93.3 | 0.0 | 0.0 | 2.09 | 0% | 0% | 100% | 100% | — |

notes: coop: no winner

### Split or Steal  ·  signature / chaos  ·  rules allow 2–16  ·  target 45 s / pair

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 42 s | 42 s | 100% | 53% (both_split_no_prize 37%) | 3.4 | 2.0 | 0.0 | 3.83 | 0% | 7% | 100% | 100% | 76% |
| 2 | antisocial | 42 s | 42 s | 100% | 49% (both_split_no_prize 34%) | 0.0 | 2.0 | 0.0 | 1.43 | 0% | 100% | 100% | 100% | 71% |
| 4 | mixed | 42 s | 42 s | 100% | 51% (both_split_no_prize 36%) | 4.0 | 2.0 | 0.0 | 2.13 | 0% | 3% | 64% | 50% | 34% |
| 4 | antisocial | 42 s | 42 s | 100% | 45% (both_split_no_prize 27%) | 0.0 | 2.0 | 0.0 | 0.71 | 0% | 100% | 50% | 50% | 36% |
| 8 | mixed | 42 s | 42 s | 100% | 55% (both_split_no_prize 42%) | 5.7 | 2.0 | 0.0 | 1.37 | 0% | 1% | 50% | 25% | 17% |
| 8 | antisocial | 42 s | 42 s | 100% | 52% (both_split_no_prize 34%) | 0.0 | 2.0 | 0.0 | 0.36 | 0% | 100% | 25% | 25% | 16% |
| 16 | mixed | 42 s | 42 s | 100% | 57% (both_split_no_prize 39%) | 9.2 | 2.0 | 0.0 | 1.0 | 0% | 0% | 41% | 12% | 11% |
| 16 | antisocial | 42 s | 42 s | 100% | 57% (both_split_no_prize 38%) | 0.0 | 2.0 | 0.0 | 0.18 | 0% | 100% | 12% | 12% | 6% |

notes: tournament of 2 pairs ~ 84 s; tournament of 4 pairs ~ 168 s; tournament of 8 pairs ~ 336 s

### Race / Manhunt-Tag  ·  superseded / sporty  ·  rules allow 2–16  ·  target 2-4 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 28 s | 24 s | 100% | 6% (timeout_survivors 4%) | 0.0 | 0.0 | 2.2 | 2.36 | 1% | 100% | 100% | 91% | — |
| 2 | antisocial | 36 s | 2.5 min | 100% | 9% (timeout_survivors 7%) | 0.0 | 0.0 | 2.9 | 2.42 | 2% | 100% | 100% | 92% | — |
| 4 | mixed | 2.2 min | 4.0 min | 100% | 42% (timeout_survivors 41%) | 0.0 | 0.0 | 8.1 | 0.9 | 1% | 100% | 100% | 67% | — |
| 4 | antisocial | 2.2 min | 4.0 min | 100% | 40% (timeout_survivors 38%) | 0.0 | 0.0 | 8.4 | 0.94 | 1% | 100% | 100% | 68% | — |
| 8 | mixed | 2.0 min | 4.0 min | 100% | 26% (timeout_survivors 26%) | 0.0 | 0.0 | 15.9 | 0.99 | 0% | 100% | 100% | 62% | — |
| 8 | antisocial | 2.2 min | 4.0 min | 100% | 31% (timeout_survivors 31%) | 0.0 | 0.0 | 15.5 | 0.88 | 0% | 100% | 100% | 61% | — |
| 16 | mixed | 2.6 min | 4.0 min | 100% | 30% (timeout_survivors 30%) | 0.0 | 0.0 | 32.7 | 0.78 | 0% | 100% | 100% | 55% | — |
| 16 | antisocial | 2.6 min | 4.0 min | 100% | 27% (timeout_survivors 27%) | 0.0 | 0.0 | 32.1 | 0.78 | 0% | 100% | 100% | 55% | — |

### Order Up  ·  signature / chill  ·  rules allow 2–16  ·  target 3-5 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 2.5 min | 2.5 min | 0% | 100% (trivial_2p 100%) | 3.6 | 2.0 | 0.0 | 1.09 | 0% | 3% | 100% | 100% | 100% |
| 2 | antisocial | 2.5 min | 2.5 min | 0% | 100% (trivial_2p 100%) | 0.0 | 2.0 | 0.0 | 0.39 | 0% | 100% | 100% | 100% | 100% |
| 4 | mixed | 2.6 min | 2.6 min | 40% | 60% (tie_no_tiebreak 60%) | 7.5 | 12.0 | 0.0 | 1.87 | 0% | 0% | 100% | 100% | 48% |
| 4 | antisocial | 2.6 min | 2.6 min | 57% | 42% (tie_no_tiebreak 42%) | 0.0 | 12.0 | 0.0 | 1.15 | 0% | 100% | 100% | 100% | 45% |
| 8 | mixed | 3.2 min | 3.2 min | 41% | 58% (tie_no_tiebreak 58%) | 19.6 | 56.0 | 0.0 | 2.95 | 0% | 0% | 100% | 100% | 37% |
| 8 | antisocial | 3.2 min | 3.2 min | 53% | 47% (tie_no_tiebreak 47%) | 0.0 | 56.0 | 0.0 | 2.19 | 0% | 100% | 100% | 100% | 33% |
| 16 | mixed | 3.4 min | 3.4 min | 54% | 45% (tie_no_tiebreak 45%) | 38.7 | 240.0 | 0.0 | 5.12 | 0% | 0% | 100% | 100% | 24% |
| 16 | antisocial | 3.4 min | 3.4 min | 61% | 38% (tie_no_tiebreak 38%) | 0.0 | 240.0 | 0.0 | 4.41 | 0% | 100% | 100% | 100% | 23% |

### Liar Game / Mafia  ·  unshaped / chaos  ·  rules allow 2–16  ·  target 2-4 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 84 s | 84 s | 0% | 100% (two_player_coinflip 100%) | 4.1 | 2.0 | 0.0 | 2.16 | 0% | 0% | 100% | 100% | — |
| 2 | antisocial | 84 s | 84 s | 0% | 100% (two_player_coinflip 100%) | 2.0 | 2.0 | 0.0 | 1.43 | 0% | 0% | 100% | 100% | — |
| 4 | mixed | 1.8 min | 1.8 min | 80% | 19% (vote_tie 19%) | 8.2 | 4.0 | 0.0 | 1.7 | 0% | 0% | 100% | 100% | — |
| 4 | antisocial | 1.8 min | 1.8 min | 82% | 18% (vote_tie 18%) | 4.0 | 4.0 | 0.0 | 1.11 | 0% | 0% | 100% | 100% | — |
| 8 | mixed | 2.6 min | 2.6 min | 83% | 17% (vote_tie 17%) | 16.2 | 8.0 | 0.0 | 1.16 | 0% | 0% | 100% | 100% | — |
| 8 | antisocial | 2.6 min | 2.6 min | 80% | 20% (vote_tie 20%) | 8.0 | 8.0 | 0.0 | 0.77 | 0% | 0% | 100% | 100% | — |
| 16 | mixed | 4.2 min | 4.2 min | 94% | 5% (vote_tie 5%) | 32.4 | 16.0 | 0.0 | 0.72 | 0% | 0% | 100% | 100% | — |
| 16 | antisocial | 4.2 min | 4.2 min | 92% | 7% (vote_tie 7%) | 16.0 | 16.0 | 0.0 | 0.48 | 0% | 0% | 100% | 100% | — |

### Guess the Number (timing imposter)  ·  unshaped / chaos  ·  rules allow 2–16  ·  target ~75 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 70 s | 70 s | 0% | 100% (two_player_coinflip 100%) | 1.4 | 2.0 | 0.0 | 1.47 | 0% | 28% | 100% | 100% | — |
| 2 | antisocial | 70 s | 70 s | 0% | 100% (two_player_coinflip 100%) | 0.0 | 2.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |
| 4 | mixed | 70 s | 70 s | 87% | 12% (vote_tie 12%) | 2.9 | 4.0 | 0.0 | 1.48 | 0% | 7% | 100% | 100% | — |
| 4 | antisocial | 70 s | 70 s | 82% | 18% (vote_tie 18%) | 0.0 | 4.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |
| 8 | mixed | 70 s | 70 s | 99% | 1% (vote_tie 1%) | 5.9 | 8.0 | 0.0 | 1.48 | 0% | 1% | 100% | 100% | — |
| 8 | antisocial | 70 s | 70 s | 89% | 10% (vote_tie 10%) | 0.0 | 8.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |
| 16 | mixed | 70 s | 70 s | 100% | 0% | 11.5 | 16.0 | 0.0 | 1.48 | 0% | 0% | 100% | 100% | — |
| 16 | antisocial | 70 s | 70 s | 99% | 0% (vote_tie 0%) | 0.0 | 16.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |

notes: imposter not the worst timer

### Catch the Imposter  ·  unshaped / chaos  ·  rules allow 2–16  ·  target ~90 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 80 s | 80 s | 0% | 100% (two_player_coinflip 100%) | 1.7 | 2.0 | 0.0 | 1.4 | 0% | 21% | 100% | 100% | — |
| 2 | antisocial | 80 s | 80 s | 0% | 100% (two_player_coinflip 100%) | 0.0 | 2.0 | 0.0 | 0.75 | 0% | 100% | 100% | 100% | — |
| 4 | mixed | 80 s | 80 s | 82% | 17% (vote_tie 17%) | 3.7 | 4.0 | 0.0 | 1.45 | 0% | 2% | 100% | 100% | — |
| 4 | antisocial | 80 s | 80 s | 80% | 20% (vote_tie 20%) | 0.0 | 4.0 | 0.0 | 0.75 | 0% | 100% | 100% | 100% | — |
| 8 | mixed | 80 s | 80 s | 96% | 3% (vote_tie 3%) | 7.5 | 8.0 | 0.0 | 1.45 | 0% | 0% | 100% | 100% | — |
| 8 | antisocial | 80 s | 80 s | 92% | 7% (vote_tie 7%) | 0.0 | 8.0 | 0.0 | 0.75 | 0% | 100% | 100% | 100% | — |
| 16 | mixed | 80 s | 80 s | 88% | 12% (vote_tie 12%) | 14.6 | 16.0 | 0.0 | 1.43 | 0% | 0% | 100% | 100% | — |
| 16 | antisocial | 80 s | 80 s | 84% | 15% (vote_tie 15%) | 0.0 | 16.0 | 0.0 | 0.75 | 0% | 100% | 100% | 100% | — |

### Draw My Thing  ·  catalog / any  ·  rules allow 2–16  ·  target per-drawer 60 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 1.8 min | 2.5 min | 28% | 71% (tie 67%) | 7.8 | 0.0 | 0.0 | 2.12 | 0% | 0% | 100% | 100% | 83% |
| 2 | antisocial | 1.8 min | 2.5 min | 25% | 75% (tie 72%) | 7.3 | 0.0 | 0.0 | 2.05 | 0% | 0% | 100% | 100% | 85% |
| 4 | mixed | 2.6 min | 3.1 min | 75% | 24% (tie 24%) | 19.0 | 0.0 | 0.0 | 1.84 | 0% | 0% | 100% | 100% | 40% |
| 4 | antisocial | 2.6 min | 3.2 min | 71% | 28% (tie 28%) | 19.3 | 0.0 | 0.0 | 1.85 | 0% | 0% | 100% | 100% | 45% |
| 8 | mixed | 4.4 min | 4.7 min | 57% | 42% (tie 42%) | 38.3 | 0.0 | 0.0 | 1.1 | 0% | 0% | 100% | 100% | 24% |
| 8 | antisocial | 4.3 min | 4.6 min | 54% | 45% (tie 45%) | 37.4 | 0.0 | 0.0 | 1.08 | 0% | 0% | 100% | 100% | 26% |
| 16 | mixed | 8.1 min | 8.3 min | 72% | 27% (tie 27%) | 75.6 | 0.0 | 0.0 | 0.58 | 0% | 0% | 100% | 100% | 13% |
| 16 | antisocial | 8.1 min | 8.3 min | 67% | 32% (tie 32%) | 77.3 | 0.0 | 0.0 | 0.59 | 0% | 0% | 100% | 100% | 9% |

notes: long at 16

### Caption This (제목 짓기)  ·  catalog / any  ·  rules allow 2–16  ·  target ~90 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 69 s | 69 s | 0% | 100% (always_tie_2p 100%) | 1.0 | 2.0 | 0.0 | 1.29 | 0% | 39% | 100% | 100% | 100% |
| 2 | antisocial | 69 s | 69 s | 0% | 100% (always_tie_2p 100%) | 0.0 | 2.0 | 0.0 | 0.87 | 0% | 100% | 100% | 100% | 100% |
| 4 | mixed | 73 s | 73 s | 77% | 22% (tie 22%) | 1.7 | 4.0 | 0.0 | 1.17 | 0% | 19% | 100% | 100% | 46% |
| 4 | antisocial | 73 s | 73 s | 72% | 28% (tie 28%) | 0.0 | 4.0 | 0.0 | 0.82 | 0% | 100% | 100% | 100% | 50% |
| 8 | mixed | 81 s | 81 s | 64% | 35% (tie 35%) | 3.6 | 8.0 | 0.0 | 1.08 | 0% | 3% | 100% | 100% | 36% |
| 8 | antisocial | 81 s | 81 s | 60% | 40% (tie 40%) | 0.0 | 8.0 | 0.0 | 0.74 | 0% | 100% | 100% | 100% | 32% |
| 16 | mixed | 1.6 min | 1.6 min | 62% | 37% (tie 37%) | 7.3 | 16.0 | 0.0 | 0.9 | 0% | 0% | 100% | 100% | 29% |
| 16 | antisocial | 1.6 min | 1.6 min | 64% | 36% (tie 36%) | 0.0 | 16.0 | 0.0 | 0.62 | 0% | 100% | 100% | 100% | 20% |

### Tee Game (photo + slogan)  ·  unshaped / chill  ·  rules allow 2–16  ·  target ~90 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 70 s | 70 s | 0% | 100% (always_tie_2p 100%) | 1.3 | 2.0 | 0.0 | 1.41 | 0% | 31% | 100% | 100% | — |
| 2 | antisocial | 70 s | 70 s | 0% | 100% (always_tie_2p 100%) | 0.0 | 2.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |
| 4 | mixed | 70 s | 70 s | 73% | 26% (tie 26%) | 2.7 | 4.0 | 0.0 | 1.45 | 0% | 8% | 100% | 100% | — |
| 4 | antisocial | 70 s | 70 s | 71% | 28% (tie 28%) | 0.0 | 4.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |
| 8 | mixed | 70 s | 70 s | 60% | 39% (tie 39%) | 5.3 | 8.0 | 0.0 | 1.43 | 0% | 0% | 100% | 100% | — |
| 8 | antisocial | 70 s | 70 s | 61% | 38% (tie 38%) | 0.0 | 8.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |
| 16 | mixed | 70 s | 70 s | 65% | 34% (tie 34%) | 10.9 | 16.0 | 0.0 | 1.44 | 0% | 0% | 100% | 100% | — |
| 16 | antisocial | 70 s | 70 s | 63% | 36% (tie 36%) | 0.0 | 16.0 | 0.0 | 0.86 | 0% | 100% | 100% | 100% | — |

### Truth or Dare  ·  unshaped / chaos  ·  rules allow 2–16  ·  target per-turn 45 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 1.5 min | 1.5 min | 0% | 100% (no_win_condition 100%) | 5.2 | 0.0 | 0.0 | 1.73 | 0% | 0% | 100% | 100% | — |
| 2 | antisocial | 1.5 min | 1.5 min | 0% | 100% (no_win_condition 100%) | 4.0 | 0.0 | 0.0 | 1.33 | 0% | 0% | 100% | 100% | — |
| 4 | mixed | 3.0 min | 3.0 min | 0% | 100% (no_win_condition 100%) | 15.2 | 0.0 | 0.0 | 1.26 | 0% | 0% | 100% | 100% | — |
| 4 | antisocial | 3.0 min | 3.0 min | 0% | 100% (no_win_condition 100%) | 8.0 | 0.0 | 0.0 | 0.67 | 0% | 0% | 100% | 100% | — |
| 8 | mixed | 6.0 min | 6.0 min | 0% | 100% (no_win_condition 100%) | 50.2 | 0.0 | 0.0 | 1.05 | 0% | 0% | 100% | 100% | — |
| 8 | antisocial | 6.0 min | 6.0 min | 0% | 100% (no_win_condition 100%) | 16.0 | 0.0 | 0.0 | 0.33 | 0% | 0% | 100% | 100% | — |
| 16 | mixed | 12.0 min | 12.0 min | 0% | 100% (no_win_condition 100%) | 180.0 | 0.0 | 0.0 | 0.94 | 0% | 0% | 100% | 100% | — |
| 16 | antisocial | 12.0 min | 12.0 min | 0% | 100% (no_win_condition 100%) | 32.0 | 0.0 | 0.0 | 0.17 | 0% | 0% | 100% | 100% | — |

### Boss Fight  ·  catalog / any  ·  rules allow 2–16  ·  target 30-90 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 52 s | 58 s | 100% | 0% | 2.5 | 0.0 | 0.0 | 1.45 | 13% | 13% | 100% | 100% | — |
| 2 | antisocial | 52 s | 57 s | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | — |
| 4 | mixed | 45 s | 49 s | 100% | 0% | 4.3 | 0.0 | 0.0 | 1.44 | 1% | 1% | 100% | 100% | — |
| 4 | antisocial | 46 s | 49 s | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | — |
| 8 | mixed | 40 s | 42 s | 100% | 0% | 7.1 | 0.0 | 0.0 | 1.33 | 0% | 0% | 100% | 100% | — |
| 8 | antisocial | 40 s | 43 s | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | — |
| 16 | mixed | 36 s | 37 s | 100% | 0% | 12.7 | 0.0 | 0.0 | 1.34 | 0% | 0% | 100% | 100% | — |
| 16 | antisocial | 36 s | 37 s | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | — |

notes: coop: no loser

### Scavenger (planted object)  ·  superseded / chill  ·  rules allow 2–16  ·  target 5-10 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 3.3 min | 4.8 min | 99% | 0% (nobody_found_it 0%) | 2.7 | 0.0 | 0.0 | 0.4 | 10% | 10% | 100% | 100% | 53% |
| 2 | antisocial | 3.3 min | 4.7 min | 99% | 0% (nobody_found_it 0%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 54% |
| 4 | mixed | 2.7 min | 3.6 min | 100% | 0% | 5.0 | 0.0 | 0.0 | 0.47 | 1% | 1% | 100% | 100% | 30% |
| 4 | antisocial | 2.7 min | 3.8 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 28% |
| 8 | mixed | 2.2 min | 2.9 min | 100% | 0% | 10.3 | 0.0 | 0.0 | 0.57 | 0% | 0% | 100% | 100% | 16% |
| 8 | antisocial | 2.2 min | 2.9 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 13% |
| 16 | mixed | 2.0 min | 2.4 min | 100% | 0% | 21.1 | 0.0 | 0.0 | 0.67 | 0% | 0% | 100% | 100% | 9% |
| 16 | antisocial | 1.9 min | 2.3 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 11% |

notes: needs physical pre-setup

### Accuracy / Long Jump  ·  superseded / sporty  ·  rules allow 2–16  ·  target per-player 45 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 1.5 min | 1.5 min | 100% | 0% | 2.0 | 0.0 | 0.0 | 0.65 | 18% | 18% | 100% | 50% | 93% |
| 2 | antisocial | 1.5 min | 1.5 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 50% | 92% |
| 4 | mixed | 3.0 min | 3.0 min | 100% | 0% | 7.8 | 0.0 | 0.0 | 0.65 | 0% | 0% | 100% | 25% | 87% |
| 4 | antisocial | 3.0 min | 3.0 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 25% | 85% |
| 8 | mixed | 6.0 min | 6.0 min | 100% | 0% | 31.3 | 0.0 | 0.0 | 0.65 | 0% | 0% | 100% | 12% | 81% |
| 8 | antisocial | 6.0 min | 6.0 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 12% | 77% |
| 16 | mixed | 12.0 min | 12.0 min | 100% | 0% | 126.3 | 0.0 | 0.0 | 0.66 | 0% | 0% | 100% | 6% | 71% |
| 16 | antisocial | 12.0 min | 12.0 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 6% | 68% |

### Five Buttons  ·  unshaped / chaos  ·  rules allow 2–16  ·  target <30 s

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 12 s | 20 s | 100% | 23% (instant_first_press 23%) | 0.4 | 0.0 | 0.0 | 0.94 | 70% | 70% | 88% | 88% | — |
| 2 | antisocial | 12 s | 20 s | 100% | 16% (instant_first_press 16%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 92% | 92% | — |
| 4 | mixed | 12 s | 20 s | 100% | 19% (instant_first_press 19%) | 0.9 | 0.0 | 0.0 | 1.14 | 43% | 43% | 70% | 70% | — |
| 4 | antisocial | 12 s | 20 s | 100% | 21% (instant_first_press 21%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 71% | 71% | — |
| 8 | mixed | 12 s | 20 s | 100% | 21% (instant_first_press 21%) | 1.7 | 0.0 | 0.0 | 1.12 | 20% | 20% | 36% | 36% | — |
| 8 | antisocial | 12 s | 20 s | 100% | 23% (instant_first_press 23%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 37% | 37% | — |
| 16 | mixed | 12 s | 20 s | 100% | 18% (instant_first_press 18%) | 3.6 | 0.0 | 0.0 | 1.1 | 7% | 7% | 18% | 18% | — |
| 16 | antisocial | 12 s | 20 s | 100% | 20% (instant_first_press 20%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 18% | 18% | — |

### Rival Teams (generic)  ·  superseded / sporty  ·  rules allow 4–16  ·  target 2 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | — | n/a | | | | | | | | | | | | |
| 4 | mixed | 2.0 min | 2.0 min | 100% | 33% (runaway_by_skill_sum 24%) | 5.4 | 0.0 | 0.0 | 0.67 | 1% | 1% | 100% | 100% | 77% |
| 4 | antisocial | 2.0 min | 2.0 min | 100% | 38% (runaway_by_skill_sum 27%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 78% |
| 8 | mixed | 2.0 min | 2.0 min | 100% | 19% (runaway_by_skill_sum 11%) | 10.2 | 0.0 | 0.0 | 0.64 | 0% | 0% | 100% | 100% | 75% |
| 8 | antisocial | 2.0 min | 2.0 min | 100% | 20% (runaway_by_skill_sum 14%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 76% |
| 16 | mixed | 2.0 min | 2.0 min | 100% | 5% (tie 3%) | 21.6 | 0.0 | 0.0 | 0.68 | 0% | 0% | 100% | 100% | 65% |
| 16 | antisocial | 2.0 min | 2.0 min | 100% | 7% (tie 4%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 63% |

notes: framework, not a mechanic

### Trivia (first to 3)  ·  catalog / any  ·  rules allow 2–16  ·  target 1-3 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 1.8 min | 3.0 min | 87% | 36% (runaway_3_0 23%) | 1.9 | 0.0 | 0.0 | 0.51 | 23% | 23% | 100% | 100% | 77% |
| 2 | antisocial | 1.8 min | 3.0 min | 86% | 33% (runaway_3_0 20%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 75% |
| 4 | mixed | 89 s | 2.2 min | 98% | 2% (timeout 1%) | 2.8 | 0.0 | 0.0 | 0.48 | 11% | 11% | 100% | 100% | 51% |
| 4 | antisocial | 90 s | 2.2 min | 98% | 5% (runaway_3_0 3%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 55% |
| 8 | mixed | 74 s | 2.0 min | 100% | 0% | 4.7 | 0.0 | 0.0 | 0.47 | 2% | 2% | 100% | 100% | 42% |
| 8 | antisocial | 75 s | 1.8 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 37% |
| 16 | mixed | 72 s | 1.8 min | 100% | 0% | 8.7 | 0.0 | 0.0 | 0.45 | 0% | 0% | 100% | 100% | 26% |
| 16 | antisocial | 69 s | 1.8 min | 100% | 0% | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 27% |

### Hide and Seek  ·  superseded / sporty  ·  rules allow 2–16  ·  target 4-6 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 2.6 min | 5.0 min | 100% | 16% (nobody_found 16%) | 0.0 | 0.0 | 0.8 | 0.16 | 16% | 100% | 100% | 70% | — |
| 2 | antisocial | 2.6 min | 5.0 min | 100% | 17% (nobody_found 17%) | 0.0 | 0.0 | 0.8 | 0.16 | 17% | 100% | 100% | 71% | — |
| 4 | mixed | 3.9 min | 5.0 min | 100% | 43% (timeout_hiders_win 43%) | 0.0 | 0.0 | 2.5 | 0.16 | 0% | 100% | 100% | 59% | — |
| 4 | antisocial | 4.0 min | 5.0 min | 100% | 42% (timeout_hiders_win 42%) | 0.0 | 0.0 | 2.5 | 0.15 | 0% | 100% | 100% | 60% | — |
| 8 | mixed | 4.6 min | 5.0 min | 100% | 69% (timeout_hiders_win 69%) | 0.0 | 0.0 | 5.8 | 0.16 | 0% | 100% | 100% | 50% | — |
| 8 | antisocial | 4.7 min | 5.0 min | 100% | 75% (timeout_hiders_win 75%) | 0.0 | 0.0 | 5.7 | 0.15 | 0% | 100% | 100% | 51% | — |
| 16 | mixed | 4.1 min | 5.0 min | 100% | 34% (timeout_hiders_win 34%) | 0.0 | 0.0 | 13.6 | 0.21 | 0% | 100% | 100% | 36% | — |
| 16 | antisocial | 4.1 min | 5.0 min | 100% | 36% (timeout_hiders_win 36%) | 0.0 | 0.0 | 13.6 | 0.2 | 0% | 100% | 100% | 37% | — |

### 31 (Nim)  ·  unshaped / any  ·  rules allow 2–16  ·  target ~1 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 65 s | 72 s | 100% | 30% (solved_game_perfect_play 30%) | 1.2 | 0.0 | 0.0 | 0.53 | 36% | 36% | 100% | 100% | 63% |
| 2 | antisocial | 65 s | 72 s | 100% | 29% (solved_game_perfect_play 29%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 59% |
| 4 | mixed | 66 s | 72 s | 100% | 100% (kingmaking_multiplayer 100%) | 2.5 | 0.0 | 0.0 | 0.57 | 9% | 9% | 100% | 100% | — |
| 4 | antisocial | 65 s | 76 s | 100% | 100% (kingmaking_multiplayer 100%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | — |
| 8 | mixed | 66 s | 76 s | 100% | 100% (kingmaking_multiplayer 100%) | 4.6 | 0.0 | 0.0 | 0.53 | 2% | 2% | 100% | 100% | — |
| 8 | antisocial | 66 s | 76 s | 100% | 100% (kingmaking_multiplayer 100%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | — |
| 16 | mixed | 65 s | 72 s | 100% | 100% (kingmaking_multiplayer 100%) | 9.4 | 0.0 | 0.0 | 0.54 | 0% | 0% | 97% | 97% | — |
| 16 | antisocial | 65 s | 72 s | 100% | 100% (kingmaking_multiplayer 100%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 97% | 97% | — |

### Trivia: Higher or Lower  ·  catalog / any  ·  rules allow 2–16  ·  target 1-2 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 50 s | 72 s | 86% | 14% (simultaneous_finish_tie 14%) | 0.9 | 0.0 | 0.0 | 0.51 | 43% | 43% | 100% | 100% | 58% |
| 2 | antisocial | 51 s | 72 s | 86% | 13% (simultaneous_finish_tie 13%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 57% |
| 4 | mixed | 43 s | 60 s | 67% | 33% (simultaneous_finish_tie 33%) | 1.6 | 0.0 | 0.0 | 0.55 | 21% | 21% | 100% | 100% | 32% |
| 4 | antisocial | 44 s | 60 s | 66% | 34% (simultaneous_finish_tie 34%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 36% |
| 8 | mixed | 38 s | 48 s | 39% | 60% (simultaneous_finish_tie 60%) | 3.1 | 0.0 | 0.0 | 0.6 | 5% | 5% | 100% | 100% | 21% |
| 8 | antisocial | 39 s | 48 s | 47% | 53% (simultaneous_finish_tie 53%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 16% |
| 16 | mixed | 36 s | 36 s | 15% | 85% (simultaneous_finish_tie 85%) | 5.3 | 0.0 | 0.0 | 0.55 | 1% | 1% | 100% | 100% | 8% |
| 16 | antisocial | 37 s | 36 s | 13% | 86% (simultaneous_finish_tie 86%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 12% |

### Trivia: Majority Rules  ·  catalog / any  ·  rules allow 2–16  ·  target 1-3 min

| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | mixed | 2.1 min | 3.3 min | 0% | 100% (no_majority_2p 100%) | 2.6 | 0.0 | 0.0 | 0.62 | 14% | 14% | 100% | 100% | — |
| 2 | antisocial | 2.2 min | 3.3 min | 0% | 100% (no_majority_2p 100%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | — |
| 4 | mixed | 87 s | 2.1 min | 39% | 79% (tie_or_timeout 60%) | 4.0 | 0.0 | 0.0 | 0.68 | 4% | 4% | 100% | 100% | 40% |
| 4 | antisocial | 1.5 min | 2.4 min | 56% | 67% (tie_or_timeout 43%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 28% |
| 8 | mixed | 71 s | 1.5 min | 13% | 90% (tie_or_timeout 86%) | 7.0 | 0.0 | 0.0 | 0.73 | 0% | 0% | 100% | 100% | 22% |
| 8 | antisocial | 71 s | 1.5 min | 24% | 81% (tie_or_timeout 75%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 25% |
| 16 | mixed | 63 s | 1.5 min | 0% | 99% (tie_or_timeout 99%) | 12.6 | 0.0 | 0.0 | 0.74 | 0% | 0% | 100% | 100% | 0% |
| 16 | antisocial | 64 s | 1.5 min | 2% | 98% (tie_or_timeout 98%) | 0.0 | 0.0 | 0.0 | 0.0 | 100% | 100% | 100% | 100% | 16% |

## NPC quest loop (approach → lobby fill → game → resolution)

| archetype / density | game | min | arrivals/h | games/h | players served/h | stuck lobbies/h | declined/h | abandoned/h | fill time | dead air mean | dead air p90 | avg size | spectator share | hours with 0 games |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chill/low | Order Up | 3 | 5.2 | 0.07 | 0.2 | 2.6 | 2.0 | 3.0 | 2.3 min | 2.7 min | 2.8 min | 3.0 | — | 93% |
| chill/high | Order Up | 3 | 24.9 | 2.73 | 8.8 | 6.0 | 9.9 | 9.3 | 1.8 min | 2.2 min | 3.6 min | 3.1 | — | 15% |
| chaos/low | Split or Steal | 2 | 5.2 | 0.53 | 1.1 | 2.52 | 2.0 | 2.5 | 1.7 min | 2.3 min | 2.5 min | 2.0 | 0.01 | 67% |
| chaos/high | Split or Steal | 2 | 24.9 | 7.38 | 15.5 | 5.22 | 9.9 | 5.2 | 84 s | 72 s | 2.9 min | 2.1 | 0.03 | 0% |
| sporty/low | Sheep Raid | 4 | 5.2 | 0.0 | 0.0 | 2.65 | 2.0 | 3.2 | — | 2.8 min | 2.9 min | — | — | 100% |
| sporty/high | Sheep Raid | 4 | 24.9 | 0.7 | 3.0 | 6.43 | 9.9 | 13.2 | 2.4 min | 2.8 min | 4.0 min | 4.2 | — | 60% |
