// House-party config: feature flags, prompt pools, Manhunt geography.
//
// Everything a human should curate lives in this one file. Prompt pools are
// tagged mild | spicy; only mild is served unless SPICY is turned on, and the
// pools below are PLACEHOLDER DRAFTS — see the DRAFT banners. Replace the
// text, keep the shape.

// ---------------------------------------------------------------- flags
export const FLAGS = {
  // Public parties (a browsable directory of nearby parties) are OFF for this
  // pass. With this false, parties are code/link only and nothing is
  // announced to the shared directory.
  PUBLIC_PARTIES: false,
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
};

// ---------------------------------------------------------------- game settings
export const DIARY = {
  PROMPTS: 5,                    // prompts answered before anything is revealed
  WRITE_MS_PER_PROMPT: 60000,    // writing window = this x PROMPTS
  MATCH_MS: 300000,              // matching window for the whole round
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
  // guesses are judged automatically by the answer matcher, so the performer
  // never has to read a feed. For guesses shouted out loud, the performer
  // gets one big "someone said it" button.
  ACT_MS: 90000,
};

// ---------------------------------------------------------------- prompt pools
// Shape: { text, spice: "mild" | "spicy" }
// `{{player}}` is substituted with a random other player's handle at deal time.

/* ======================= DRAFT — NEEDS CURATION =======================
 * Secret Diary. One prompt per round, about tonight and the people here.
 * Aim: specific enough to be guessable from someone's phrasing, open enough
 * that everyone has an answer. Keep them about the room, not the internet.
 * ===================================================================== */
export const DIARY_PROMPTS = [
  { text: "Write the diary entry for tonight that you'd never read aloud.", spice: "mild" },
  { text: "What's the most suspicious thing you've seen happen in this room tonight?", spice: "mild" },
  { text: "Who here is having a completely different night than they're pretending to?", spice: "mild" },
  { text: "Describe tonight as if you were writing a police report.", spice: "mild" },
  { text: "What did you think was going to happen tonight that absolutely has not?", spice: "mild" },
  { text: "Which person here would you call first in an actual emergency, and why?", spice: "mild" },
  { text: "What's the unspoken rule everyone in this room is following right now?", spice: "mild" },
  { text: "Write the group chat message you drafted tonight and deleted.", spice: "mild" },
  { text: "What's something you noticed about {{player}} tonight that they don't know you noticed?", spice: "mild" },
  { text: "If tonight had a title card, what would it say?", spice: "mild" },
  { text: "What's the pettiest thought you've had in the last hour?", spice: "spicy" },
  { text: "Who here are you quietly judging, and for what?", spice: "spicy" },
];

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

/* ======================= DRAFT — NEEDS CURATION =======================
 * Humiliation Ritual. Charades-style: one performer acts it out in public
 * while everyone else types guesses. Must be ACTABLE without props and
 * GUESSABLE in a word or two — the typed guess has to be able to match.
 * `answer` is what guesses are checked against; `alt` are accepted variants.
 * ===================================================================== */
export const RITUAL_PROMPTS = [
  { text: "A penguin realising it has lost its egg", answer: "penguin", alt: ["lost penguin", "sad penguin"], spice: "mild" },
  { text: "Someone discovering their phone is at 1%", answer: "low battery", alt: ["phone dying", "1 percent", "battery"], spice: "mild" },
  { text: "A vending machine eating your money", answer: "vending machine", alt: ["vending", "machine ate money"], spice: "mild" },
  { text: "A cat knocking things off a table, one by one", answer: "cat", alt: ["cat knocking things", "annoying cat"], spice: "mild" },
  { text: "Trying to look busy when your boss walks past", answer: "looking busy", alt: ["pretending to work", "boss walking by"], spice: "mild" },
  { text: "An inflatable tube man outside a car dealership", answer: "tube man", alt: ["inflatable man", "air dancer", "wacky waving man"], spice: "mild" },
  { text: "Waking up and immediately regretting last night", answer: "hangover", alt: ["regret", "hungover"], spice: "mild" },
  { text: "A GPS telling you to make a U-turn, repeatedly", answer: "gps", alt: ["u turn", "navigation", "make a u-turn"], spice: "mild" },
  { text: "Getting dragged by a dog that is much stronger than you", answer: "walking a dog", alt: ["dog walk", "strong dog", "dog pulling"], spice: "mild" },
  { text: "Someone who has just walked into a glass door", answer: "glass door", alt: ["walked into glass", "sliding door"], spice: "mild" },
  { text: "A broken robot slowly powering down", answer: "robot", alt: ["broken robot", "robot shutting down"], spice: "mild" },
  { text: "Trying to fold a fitted bedsheet", answer: "folding a sheet", alt: ["fitted sheet", "laundry", "folding laundry"], spice: "mild" },
  { text: "Realising mid-wave that they weren't waving at you", answer: "awkward wave", alt: ["wrong wave", "waving at nobody"], spice: "spicy" },
];

/* ======================= DRAFT — bot filler (desk testing only) ===========
 * What ?bots=N writes in Secret Diary. Never shown in a real party unless
 * someone passes ?bots=, so curation here matters least.
 * ===================================================================== */
export const DIARY_BOT_ENTRIES = [
  "I have been nodding along to a conversation I lost ten minutes ago.",
  "Someone moved my drink and I have been too polite to ask who.",
  "I came for twenty minutes. That was two hours ago.",
  "I am the only person here who knows what's in the punch.",
  "I keep checking my phone so I look busy, there is nothing on it.",
  "I told everyone I ate already. I did not eat already.",
  "I have decided I like it here, which is annoying, I had plans to leave.",
  "There is a photo of me from earlier tonight that must never surface.",
  "I laughed at a joke I did not hear and will not be asking for it again.",
  "I am quietly timing how long until someone suggests we go somewhere else.",
];

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
