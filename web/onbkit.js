// The onboarding's pure parts (no DOM, no three.js), for onboard.js and the tests.
import { STARTER_OUTFITS4, randomAvatar4, normalizeAvatar4, PART_OPTIONS4, isFree4, clash4 } from "./items4.js";
import { lang } from "./i18n.js";

// a random cool starter look: one of the six starter outfits, with a random skin tone, hair and eyes
export function starterLook(rng = Math.random) {
  const base = randomAvatar4(rng);
  const { id, name, ...outfit } = STARTER_OUTFITS4[Math.floor(rng() * STARTER_OUTFITS4.length)];
  return normalizeAvatar4({ skin: base.skin, eyes: base.eyes, iris: base.iris, hairColor: base.hairColor, hair: base.hair === "none" ? "middle-part" : base.hair, ...outfit });
}

// Who gets the setup card: a guest account starts with a placeholder handle
// (rando-xxxxxx, backend.js) and no character. A player with a real name AND
// a character is a returning player: Start, Join, an invite and Explore all
// go straight in; the start screen shows their chip instead.
export const AUTO_HANDLE = /^rando-[0-9a-f]{6}$/;
export function needsSetup(p) { return !p || !p.handle || AUTO_HANDLE.test(p.handle) || !p.avatar; }

// The setup card's essentials, one tap each: the next skin tone, hairstyle,
// hair colour, eye shape, starter outfit or hat (free things only; the whole
// wardrobe is the Style screen's). Every result is a valid look
// (normalizeAvatar4 settles what can't be worn together).
export const ESSENTIALS = ["skin", "hair", "color", "eyes", "outfit", "hat"];
const freeOf = k => PART_OPTIONS4[k].filter(v => v !== "none" && isFree4(k, v));
// (only what fits with the rest of the look: a tap never knocks something else off)
const fitsOf = (cur, slot, list) => list.filter(v => v === "none" || !clash4(cur, slot, v));
const after = (list, cur, dir) => list[(((list.indexOf(cur) + dir) % list.length) + list.length) % list.length];
export function cycleLook(look, key, dir = 1) {
  const cur = normalizeAvatar4(look);
  switch (key) {
    case "skin": return normalizeAvatar4({ ...cur, skin: after(PART_OPTIONS4.skin, cur.skin, dir) });
    case "hair": return normalizeAvatar4({ ...cur, hair: after(fitsOf(cur, "hair", freeOf("hair")), cur.hair, dir) });
    case "color": return normalizeAvatar4({ ...cur, hairColor: after(freeOf("hairColor"), cur.hairColor, dir) });
    case "eyes": return normalizeAvatar4({ ...cur, eyes: after(PART_OPTIONS4.eyes, cur.eyes, dir) });
    case "hat": return normalizeAvatar4({ ...cur, head: after(fitsOf(cur, "head", ["none", ...freeOf("head")]), cur.head, dir) });
    case "outfit": {
      const n = STARTER_OUTFITS4.length;
      const i = STARTER_OUTFITS4.findIndex(o => o.top === cur.top && o.bottom === cur.bottom && o.shoes === cur.shoes);
      const { id, name, ...outfit } = STARTER_OUTFITS4[(((i + dir) % n) + n) % n];
      return normalizeAvatar4({ ...cur, ...outfit });
    }
    default: return cur;
  }
}
// a phone number as the server wants it (+country...). Korean numbers typed
// the local way (010-1234-5678) become +82; so do the half-international
// ways people write them (+82 010…, 0082 10…, 82 10…): a trunk 0 after +82
// would send the code to a number that doesn't exist. null if it can't be one.
export function e164(raw, l = lang) {
  let d = String(raw ?? "").replace(/[^\d+]/g, "");
  if (/^00[1-9]/.test(d)) d = `+${d.slice(2)}`;
  if (/^82(1\d|[2-6]\d|70)\d{7,8}$/.test(d)) d = `+${d}`;
  if (/^\+820\d{8,10}$/.test(d)) d = `+82${d.slice(4)}`;
  if (/^\+\d{8,15}$/.test(d)) return d;
  if (/^0\d{9,10}$/.test(d) && (l === "ko" || d.startsWith("010"))) return `+82${d.slice(1)}`;
  if (/^\d{10}$/.test(d) && l === "en") return `+1${d}`;
  return null;
}

// asking for codes: one every 30 s, at most 5 an hour from this phone (the
// server has its own limits too; `until` is a wait it asked for)
export const OTP = { COOLDOWN_S: 30, MAX_PER_HOUR: 5 };
export function otpWait({ sent = [], until = 0 } = {}, now = Date.now()) {
  const recent = sent.filter(t => now - t < 3600e3).sort((a, b) => a - b);
  let wait = Math.max(0, until - now);
  if (recent.length >= OTP.MAX_PER_HOUR) wait = Math.max(wait, recent[recent.length - OTP.MAX_PER_HOUR] + 3600e3 - now);
  if (recent.length) wait = Math.max(wait, recent[recent.length - 1] + OTP.COOLDOWN_S * 1000 - now);
  return Math.ceil(wait / 1000);
}
// what went wrong asking for or checking a code, as one of a few reasons
// (analytics get only the reason, never the server's message)
export function otpError(msg) {
  const m = String(msg ?? "");
  const wait = /after (\d+) seconds?/i.exec(m);
  if (wait) return { reason: "rate_limited", wait: +wait[1] };
  if (/rate limit|too many/i.test(m)) return { reason: "rate_limited", wait: 60 };
  if (/already (been )?registered|already exists|already in use/i.test(m)) return { reason: "taken" };
  if (/invalid (phone|format)|phone.*(invalid|format)|unsupported phone/i.test(m)) return { reason: "bad_number" };
  if (/sms|provider|twilio|messagebird|vonage|sending|deliver/i.test(m)) return { reason: "provider" };
  if (/expired|invalid|token|otp/i.test(m)) return { reason: "bad_code" };
  return { reason: "other" };
}

