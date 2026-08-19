// Bot helpers: random avatar configs from the real avatar3 catalog, and
// text pools for the talk-type games. Kept in one place so the demo's
// "fake people" are at least consistently fake.
import { PART_OPTIONS3 } from "./avatar3.js";

export function avatar3Random(rng) {
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const p = PART_OPTIONS3;
  return {
    skin: pick(p.skin), hair: pick(p.hair.filter(x => x !== "none")), hairColor: pick(p.hairColor),
    face: pick(p.face), iris: pick(p.iris),
    top: rng() < 0.7 ? pick(p.top.filter(x => x !== "none")) : "none",
    bottom: pick(p.bottom.filter(x => x !== "none")), shoes: pick(p.shoes.filter(x => x !== "none")),
  };
}

export const CAPTION_POOL = [
  "when the group chat finally agrees on a place", "me after one (1) coffee", "POV: you said 'just one more round'",
  "my sleep schedule, visualized", "this is what 'almost there' looks like", "found the main character",
  "nobody: … my brain at 3am:", "the vibe was immaculate, actually", "she's not wrong though", "security footage of my willpower",
  "mood for the rest of the week", "this is the Itaewon experience", "plot twist: it was load-bearing", "the audacity. the confidence.",
  "every Tuesday ever", "tell me you're not okay without telling me", "small. unbothered. iconic.", "we stan a confident king",
];
export const IMPOSTER_WORDS = [
  ["pizza", "food"], ["subway", "transport"], ["Namsan Tower", "landmark"], ["soju", "drink"], ["cat", "animal"],
  ["umbrella", "object"], ["beach", "place"], ["karaoke", "activity"], ["ramen", "food"], ["bicycle", "transport"],
  ["moon", "sky"], ["library", "place"], ["hoodie", "clothing"], ["dentist", "person"], ["volcano", "nature"],
];
export const IMPOSTER_HINTS = {
  pizza: ["cheesy", "slice", "round", "delivery", "Friday"], subway: ["underground", "card", "rush", "line 6", "doors"],
  "Namsan Tower": ["tall", "locks", "view", "hike", "cable car"], soju: ["green", "shots", "cheap", "bottle", "regret"],
  cat: ["whiskers", "judgy", "nap", "box", "meow"], umbrella: ["rain", "lost", "folded", "wind", "shared"],
  beach: ["sand", "waves", "sun", "towel", "salty"], karaoke: ["mic", "room", "tambourine", "screaming", "2am"],
  ramen: ["broth", "late", "noodles", "spicy", "slurp"], bicycle: ["pedal", "helmet", "river", "chain", "bell"],
  moon: ["night", "phase", "round", "silver", "tide"], library: ["quiet", "shelves", "cards", "whisper", "overdue"],
  hoodie: ["cozy", "pocket", "strings", "oversized", "warm"], dentist: ["drill", "chair", "floss", "dread", "brave"],
  volcano: ["lava", "smoke", "island", "boom", "mountain"],
};
export const GENERIC_HINTS = ["classic", "popular", "everyday", "vibes", "you know", "honestly", "kind of", "sometimes", "often", "it depends"];
export const TELEPATHY_Q = [
  { q: "Coffee or tea?", opts: ["coffee", "tea"] },
  { q: "Window seat or counter?", opts: ["window", "counter"] },
  { q: "Ice or hot, right now?", opts: ["ice", "hot"] },
  { q: "What does this group order first?", opts: ["latte", "americano", "something sweet", "tea"] },
  { q: "Where does this table go after?", opts: ["walk", "another cafe", "home", "bar"] },
  { q: "One word for tonight so far", opts: ["calm", "awkward", "promising", "loud"] },
  { q: "Who talks first when it gets quiet?", opts: ["me", "not me"] },
];
export const CUP_PROMPTS = [
  "the last thing you googled", "a food you secretly dislike", "your most-used emoji", "what you wanted to be at 8",
  "a song you'd never admit to loving", "your go-to karaoke song", "the app you open first in the morning",
];
export const CUP_BOT_LINES = {
  "the last thing you googled": ["how late does the subway run", "is it rude to leave a group chat", "can dogs eat grapes", "hangover cure korean", "why do cats knead"],
  "a food you secretly dislike": ["cilantro", "oysters", "tteokbokki (sorry)", "raw onion", "pineapple on anything"],
  "your most-used emoji": ["😭", "🫠", "😂", "👍", "🙃"],
  "what you wanted to be at 8": ["a vet", "an astronaut", "a pokemon trainer", "a chef", "a singer"],
  "a song you'd never admit to loving": ["a nursery rhyme", "Baby Shark", "anything by my ex's band", "a ringtone", "elevator jazz"],
  "your go-to karaoke song": ["Bohemian Rhapsody", "Cherry Bomb", "Hotel California", "Tears", "Gangnam Style (ironically)"],
  "the app you open first in the morning": ["instagram", "kakao", "the weather", "youtube", "the bank app, sadly"],
};
export const SPLITCLUE_COLORS = ["red", "blue", "green", "yellow", "pink", "black"];
export const DRAW_WORDS = ["umbrella", "cat", "pizza", "subway", "tower", "bicycle", "ghost", "snowman", "guitar", "rocket", "ice cream", "crown", "octopus", "ladder", "mushroom"];
export const GHOST_TIPS = ["{x} is right behind you", "{x} is circling the west side", "{x} just ripped someone — they're slow for 5 s", "{x} is camping by the NPC", "run east, nobody's there", "{x} is hunting YOU"];
