// House-party config: feature flags, prompt pools, Manhunt geography.
//
// Everything a human should curate lives in this one file. Prompt pools are
// tagged mild | spicy; only mild is served unless SPICY is turned on, and the
// pools below are PLACEHOLDER DRAFTS — see the DRAFT banners. Replace the
// text, keep the shape.

// ---------------------------------------------------------------- flags
export const FLAGS = {
  // Public parties: the host can pick "public" when throwing a party; it's
  // then listed nearby and shown on the map as a neon house in its ZONE
  // (never the host's spot). Invite-only stays the default. false hides the
  // choice: every party is code/link only and nothing is announced.
  PUBLIC_PARTIES: true,
  // Spicy prompts are OFF by default. Flipping this to true serves the spicy
  // entries alongside the mild ones in every pool.
  SPICY: false,
  // No proximity check this pass: anyone with the code can join from anywhere.
  GATE_BY_GPS: false,
  // Phone verification for the stranger features only: making a party
  // public, joining public parties, adding friends, earning and spending
  // coins (docs/onboarding.md). Private parties with friends never ask.
  // It's on only where the Supabase project can verify someone (its Phone
  // provider, or Kakao: a Kakao account counts). false switches every gate
  // off: guests can do everything.
  PHONE_VERIFY: true,
};

export const PARTY = {
  VIBES: ["chill", "chaotic", "sporty"],   // label only — does not filter games
  MIN_PLAYERS: 3,
  CAP_MIN: 3,
  CAP_MAX: 12,
  CAP_DEFAULT: 6,
  NAME_MAX: 28,
  // a party is a SET of games: the host picks each one from the TV, everyone
  // comes back to the room between them, and after the last the party
  // results (podium) — then a new set, or the end of the party
  GAMES_PER_SET: 3,
};

// Badges on the game list's rows (the host's Game votes sheet): per game id,
// the i18n keys of its badges, in order. `fresh: true` shows a badge only to
// a new group (first set, nothing played yet). Add a game here to badge it.
export const GAME_BADGES = {
  artgallery: [{ key: "room.firstGame", fresh: true }],
  sidequest: [{ key: "room.friendGroups" }],
};

// The room leaderboard: each completed game turns into party points by
// finishing place (ties share a place), so a 100-point game and a 6-point
// game count the same. Everyone who finished gets at least the last value.
export const LEADERBOARD = {
  PLACE_POINTS: [100, 80, 65, 50, 40, 30, 25, 20],
};

// Coins: the earned currency (separate from future paid gems). These are the
// numbers the SERVER uses (supabase/migrations/013_coins_shop.sql repeats
// them; that copy is the one that counts — keep the two in step). The app
// only uses these to label things.
export const COINS = {
  PLACE: [30, 20, 12],        // 1st, 2nd, 3rd in a completed game
  FINISH: 5,                  // everyone else who finished it
  HOST_SET: 50,               // the host, when a set of 3 completes...
  HOST_MIN_PLAYERS: 4,        // ...with at least 4 players in all 3 games
  DAILY_CAP: 300,             // most coins one player can earn per day (UTC)
  HOST_DAILY_CAP: 3,          // most host rewards one player can get per day
};

// ---------------------------------------------------------------- game settings
export const DIARY = {
  // The prompt pool is a separate, editable JSON file: web/data/diary_prompts.json
  // ({ id, text, type: "written" | "yesno", level: "mild" | "spicy" | "unhinged" }).
  POOL_URL: "data/diary_prompts.json",
  LEVELS: ["mild", "spicy", "unhinged"],
  // Default max level when the host never touches the setting. Unhinged is
  // never a default and needs the party's 18+ setting on.
  DEFAULT_MAX: { public: "mild", private: "spicy" },
  // A game is one batch: the host deals BATCH questions (BATCH_MIN..BATCH_MAX),
  // everyone answers them all at once, then they're revealed one at a time.
  BATCH: 5, BATCH_MIN: 3, BATCH_MAX: 8,
  // Escalation inside a batch: the cap for a card at position i of n is set
  // by how far through the batch it is, never above the host's max. Cards
  // are then sorted mild -> spicy -> unhinged so the reveal escalates.
  CURVE: [{ upTo: 0.4, cap: "mild" }, { upTo: 0.8, cap: "spicy" }, { upTo: Infinity, cap: "max" }],
  // Inside a card's cap, how often to serve the cap level itself rather than
  // something milder — so the curve is felt, but not every card is maxed.
  CAP_BIAS: 0.6,
  // About 1 card in 3 is yes/no, when there are yes/no prompts left at the level.
  YESNO_SHARE: 1 / 3,
  DEAL_MS: 90000,                // host's deal screen; sends by itself after this
  ANSWER_MS_PER_Q: 45000,        // answer window: 45 s per question, one clock for the batch (5 -> 3:45)
  GUESS_MS: 45000,               // each question's matching / guessing window
  GUESS_MS_PER_EXTRA: 5000,      // + this per written answer beyond 6 (big rooms)
  GUESS_MS_MAX: 75000,
  POINTS_MS: 6000,               // the points screen after each question (the host can skip it)
  MORE_MS: 30000,                // the host's "+30s": once per phase (per question while guessing)
  URGENT_MS: 10000,              // the last 10 s: the countdown goes red and ticks softly
  // Diary colors: one per player for a whole batch. When the host sends the
  // batch, every player is dealt a color (no two alike in the room) and keeps
  // it for the writing diary and every reveal in that batch, so you can track
  // a color from question to question and work out whose it is. Nobody picks
  // one, nothing ever shows which color is whose, and the next batch
  // reshuffles them. 12 colors (the party cap) that differ in brightness as
  // well as hue, each with its own shape on the diary for colorblind players.
  // One model, tinted in code.
  COLORS: ["#e63946", "#ffd23f", "#1d3a8a", "#8ecae6", "#2a9d8f", "#a7e163",
           "#6a1b9a", "#ff8fab", "#f77f00", "#5c3a21", "#f4f1e8", "#2b2d42"],
  // shape per color, same order (see .sd-sym in index.html)
  SHAPES: ["circle", "star", "square", "triangle", "diamond", "plus",
           "heart", "flower", "bolt", "moon", "ring", "cross"],
};
// Mask Off: round a table, clockwise. The asker picks someone and a card
// from their hand; the card flips up for everyone; the one asked answers out
// loud (their mask slides off) or passes. "Same" and "Go deeper" while they
// talk. No ratings, no points (maskoff.js).
export const MASKOFF = {
  POOL_URL: "data/mask_off_cards.json",
  HAND: 5,                      // cards in each private hand
  LEVELS_DEFAULT: [1, 2],       // light + real; the host can add deep
  ROUNDS_DEFAULT: 2,            // everyone asks twice
  MAX_ROUNDS: 3,
  SETUP_MS: 3 * 60 * 1000,      // nobody taps deal: go with what's set
  PICK_MS: 2600,                // "[asker]'s turn"
  CHOOSE_MS: 45000,             // pick someone, browse your hand; then the deck picks for you
  NUDGE_MS: 10000,              // the gentle nudge, this long before that
  TALK_MS: 5 * 60 * 1000,       // only a backstop: the answerer taps Done
  AFTER_MS: 5500,               // "3 people felt this too"
  END_MS: 20000,
  // "Go deeper": the follow-ups, in turn; at most DEEPER_MAX per answer
  DEEPER: ["What happened after?", "How did that change you?", "What did that feel like?", "Do you still think about it?", "Who was there with you?", "What would you tell them now?"],
  DEEPER_MAX: 2,
};

export const RITUAL = {
  // charades: the performer acts, everyone else types guesses, and the
  // performer taps the right one in the live feed. Close guesses are only
  // highlighted for the performer; the performer always decides.
  POOL_URL: "data/ritual_prompts.json",
  ACT_MS: 60000,
  // a correct guess at second t of ACT_MS pays the guesser
  // GUESS_PTS + GUESS_SPEED * (1 - t/ACT_MS) and the performer
  // PERFORM_PTS + PERFORM_SPEED * (1 - t/ACT_MS). Nobody gets it: 0 for all.
  GUESS_PTS: 100, GUESS_SPEED: 100,
  PERFORM_PTS: 50, PERFORM_SPEED: 50,
};

// Side Quest: the Prophet hands out a real-life dare, one player does it, the
// room rates how hard they committed. Points = average stars x POINTS_PER_STAR.
export const SIDEQUEST = {
  POOL_URL: "data/side_quests.json",
  DO_MS: 3 * 60 * 1000,        // the quest's timer; the room rates during it, and the turn ends early once all have
  STARS: 5,
  POINTS_PER_STAR: 20,         // 5 stars = 100
  MAX_TURNS: 30,
};

// Who goes next (Side Quest, Humiliation Ritual): random but fair. Everyone
// starts at weight START; each turn a player isn't picked their weight grows
// by GROW, and the one picked drops to FLOOR — never 0, so nobody is ever
// safe, but a repeat right away is rare.
export const PICKER = { START: 1, GROW: 1, FLOOR: 0.25 };

// (Humiliation Ritual's pool lives in web/data/ritual_prompts.json.)


// ---------------------------------------------------------------- Manhunt
// Hunters chase runners through real streets inside a zone the host draws
// on the map. Privacy (AGENTS.md): your position never leaves your phone
// as is. What leaves it, only while a round is on and never stored: a fuzzy
// circle (FUZZ: at least MIN_M wide, its centre moved at random on your
// phone and snapped to GRID_M), at ping time and (for your team, end-to-end
// encrypted) now and then. The timings below are the setup screen's range
// and default.
export const MANHUNT = {
  MIN_PLAYERS: 3,
  ROUND: { min: 10, max: 120, step: 5, def: 30 },        // minutes
  PING: { min: 1, max: 15, step: 1, def: 5 },            // minutes between pings
  HEADSTART: { min: 0, max: 10, step: 1, def: 3 },       // minutes runners get first
  ZONE: { minR: 150, maxR: 1500, defR: 600, maxPts: 12 }, // radius, metres (300 m to 3 km across); a drawn shape's corners
  // the zone shrinks in steps (at this share of the round, to this share of
  // its size), each announced a minute before
  SHRINK: { steps: [{ at: 0.5, k: 0.8 }, { at: 0.7, k: 0.65 }, { at: 0.85, k: 0.5 }], WARN_MS: 60 * 1000 },
  FUZZ: { START_M: 50, MIN_M: 25, GRID_M: 10 },          // ping circles: 50 m wide, tightening to 25 m
  TEAM_EVERY_MS: 20 * 1000,                              // teammates see you (fuzzy) this often
  OUTSIDE: { LIVE_MS: 30 * 1000, OUT_MS: 2 * 60 * 1000, EVERY_MS: 5000 },   // outside the zone: live after 30 s, out after 2 min
  POWERS: {
    decoy: { team: "runner", label: "Decoy", what: "your next ping lands somewhere else" },
    ghost: { team: "runner", label: "Ghost", what: "you skip the next ping" },
    sprint: { team: "runner", label: "Sprint Alert", what: "a buzz if a hunter gets within 100 m (60 s)", M: 100, MS: 60 * 1000 },
    radar: { team: "hunter", label: "Radar", what: "everyone pings right now" },
    lockon: { team: "hunter", label: "Lock-on", what: "one runner's next ping is a tight ~20 m circle", M: 20 },
  },
  TAG_CONFIRM_MS: 45 * 1000,     // the runner has this long to say "yes, I was tagged"
  ELEVATOR_MS: 9000,             // the Hunter's opening
  RULES_MS: 60 * 1000,           // the rules card: until everyone's in, or this
  END_MS: 45 * 1000,             // the WANTED board
  // points (they rank the game; coins come from the place, in SQL): a tag is
  // worth TAG plus up to FAST more the earlier in the round it lands;
  // runners get SURVIVE_MIN a minute free, UNCAUGHT for lasting to the end,
  // LAST_SURVIVOR for the last one standing
  POINTS: { TAG: 100, FAST: 100, SURVIVE_MIN: 10, UNCAUGHT: 150, LAST_SURVIVOR: 100 },
  // the WANTED posters' bounty (for show): it grows with every ping survived
  BOUNTY: { START: 50000, PER_PING: 10000 },
  // the Hunter's lines (the dialog box)
  LINES: {
    start: ["Going down. Runners, you have a head start.", "Everybody runs. Nobody hides forever."],
    ping: ["Ping in three... two... one.", "Found you. Sort of.", "Getting warmer."],
    tag: ["Bounty collected.", "Another one."],
    shrink: ["The city's getting smaller. Move."],
    hunters: ["Told you. Nobody hides forever."],
    runners: ["...Fine. Respect."],
    tap: ["Everybody runs. Nobody hides forever.", "Relax. It's sauce. Probably.", "I've never lost. Don't make it weird."],
    power: { decoy: "Cute. A decoy.", ghost: "Gone dark? Bold.", sprint: "Run, rabbit.", radar: "Everybody, smile.", lockon: "Locked on." },
  },
};
