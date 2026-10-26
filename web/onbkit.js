// The onboarding's pure parts (no DOM, no three.js), for onboard.js and the tests.
import { STARTER_OUTFITS4, randomAvatar4, normalizeAvatar4 } from "./items4.js";
import { lang } from "./i18n.js";

// a random cool starter look: one of the six starter outfits, with a random skin tone, hair and eyes
export function starterLook(rng = Math.random) {
  const base = randomAvatar4(rng);
  const { id, name, ...outfit } = STARTER_OUTFITS4[Math.floor(rng() * STARTER_OUTFITS4.length)];
  return normalizeAvatar4({ skin: base.skin, eyes: base.eyes, iris: base.iris, hairColor: base.hairColor, hair: base.hair === "none" ? "middle-part" : base.hair, ...outfit });
}
// a phone number as the server wants it (+country...). Korean numbers typed
// the local way (010-1234-5678) become +82; null if it can't be a number
export function e164(raw, l = lang) {
  const d = String(raw ?? "").replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(d)) return d;
  if (/^0\d{9,10}$/.test(d) && (l === "ko" || d.startsWith("010"))) return `+82${d.slice(1)}`;
  if (/^\d{10}$/.test(d) && l === "en") return `+1${d}`;
  return null;
}

