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
  ANSWER_MS_PER_Q: 36000,        // answer window: 36 s per question (5 -> 3 min)
  GUESS_MS: 60000,               // each question's matching / guessing window
  GUESS_MS_PER_EXTRA: 5000,      // + this per written answer beyond 6 (big rooms)
  GUESS_MS_MAX: 90000,
  POINTS_MS: 6000,               // the points screen after each question (the host can skip it)
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
export const MISSION = {
  // How missions reach players. The host picks per game in the lobby:
  //   quick  — the game deals one mission card each, straight into play
  //   choose — everyone is offered CHOICES cards and picks the one they'll do
  MODES: ["quick", "choose"],
  DEFAULT_MODE: "quick",
  CHOICES: 3,
  PICK_MS: 45000,
  // the room rates each attempt on a 0..SCALE spectrum; points = average
  // rating as a share of MAX_PTS
  SCALE: 10,
  MAX_PTS: 100,
  // labels shown under the slider, low to high
  LABELS: ["didn't even try", "half-hearted", "got it done", "nailed it", "legendary"],
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

// Side Quest: the wizard hands out a real-life dare, one player does it, the
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

// ---------------------------------------------------------------- prompt pools
// Shape: { text, spice: "mild" | "spicy" }
// (Secret Diary's pool is NOT here — it lives in web/data/diary_prompts.json.)

/* ======================= DRAFT — NEEDS CURATION =======================
 * Today's Mission. Absurd task, done in the next couple of minutes, in view
 * of the room. HARD RULE: a mission may only embarrass the player who drew
 * it. Nothing that requires touching, naming, ranking, or using another
 * person — bystanders are never the joke and never the prop.
 * ===================================================================== */
export const MISSION_PROMPTS = [
  { text: "Deliver a 20-second TED talk on something in this room nobody asked about.", spice: "mild" },
  { text: "Narrate everything you do like a nature documentary until the timer ends.", spice: "mild" },
  { text: "Convince the room you've just returned from space. Stay in character.", spice: "mild" },
  { text: "Do your best impression of your own phone's notification sound, repeatedly, with feeling.", spice: "mild" },
  { text: "Invent and demonstrate a signature dance move. Name it.", spice: "mild" },
  { text: "Give an emotional acceptance speech for an award you just made up.", spice: "mild" },
  { text: "Walk across the room as if the floor were lava, but stay dignified.", spice: "mild" },
  { text: "Read the nearest text out loud — label, screen, anything — as dramatic poetry.", spice: "mild" },
  { text: "Become a sports commentator for the next 30 seconds of absolutely nothing.", spice: "mild" },
  { text: "Perform a one-person interpretive dance of your day.", spice: "mild" },
  { text: "Sing your last text message as an opera.", spice: "mild" },
  { text: "Do a full catwalk strut, turn, and pose. Commit completely.", spice: "mild" },
  { text: "Deliver a villain monologue explaining your evil plan for this party.", spice: "spicy" },
  { text: "Loudly apologise to an inanimate object for something you did to it.", spice: "spicy" },
];

// (Humiliation Ritual's pool lives in web/data/ritual_prompts.json.)

// serve a pool, filtered by the spice flag
export function pool(list, { spicy = FLAGS.SPICY } = {}) {
  return list.filter(p => spicy || p.spice === "mild");
}

// ---------------------------------------------------------------- Manhunt geo
/* ======================= PLACEHOLDER COORDINATES =======================
 * Every lat/lng below is a FAKE placeholder centred on an arbitrary point.
 * Do NOT play on these. Replace with vetted public off-road spots:
 *   - BOUNDARY: one fixed play area for the whole game.
 *   - SITES: 3+ bomb zones, 30-40 m radius, inside the boundary.
 * The code reads radius_m per site, so odd shapes are fine as long as the
 * radius covers the walkable part.
 * ==================================================================== */
export const MANHUNT = {
  PLACEHOLDER_GEO: true,        // flips the in-game "demo coordinates" warning

  // One fixed play-area boundary. Circle: centre + radius.
  BOUNDARY: { lat: 53.5232, lng: -113.5263, radius_m: 400, label: "PLACEHOLDER play area" },

  // Bomb sites. Runners see these; hunters never do.
  SITES: [
    { id: "s1", label: "PLACEHOLDER site A", lat: 53.5248, lng: -113.5281, radius_m: 35 },
    { id: "s2", label: "PLACEHOLDER site B", lat: 53.5219, lng: -113.5225, radius_m: 35 },
    { id: "s3", label: "PLACEHOLDER site C", lat: 53.5241, lng: -113.5232, radius_m: 30 },
  ],

  GAME_MS: 15 * 60 * 1000,      // runners must defuse everything before this
  HEADSTART_MS: 60 * 1000,      // runners move, hunters held
  DEFUSE_MS: 20 * 1000,         // stand in the zone this long
  RADAR_MS: 60 * 1000,          // hunter radar refresh
  CELL_M: 80,                   // radar cell size — coarse on purpose
  HUNTER_RATIO: 4.5,            // ~1 hunter per 4-5 players
  TAG_CONFIRM_MS: 45 * 1000,    // runner has this long to answer "were you tagged?"
};
