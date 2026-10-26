// Onboarding analytics, privacy-safe: a random id for this install (not the
// account), the event's name, a few whitelisted numbers / labels, the app
// language. Never a location, a name, a party code or anything typed.
// Events go to the insert-only `events` table (migrations/017_events.sql);
// backend.js plugs in the sink, so offline pages and tests just collect them
// (window.__events).
//
//   import { track } from "./analytics.js";
//   track("invite_sent", { channel: "qr" });
import { lang } from "./i18n.js";

export const EVENTS = [
  "app_open", "party_link_opened", "joined_party", "name_set", "character_shuffled", "character_confirmed",
  "first_game_started", "first_game_finished", "recap_shown", "recap_shared", "own_party_created", "invite_sent",
  "verification_prompted", "verification_completed", "permission_prompted", "permission_granted", "permission_declined",
];
// the only props an event can carry, and what they may hold
const PROPS = {
  source: v => ["invite_link", "organic"].includes(v),
  channel: v => ["share", "sms", "copy", "qr", "contacts", "kakao", "recap"].includes(v),
  trigger: v => ["host", "public", "friends", "coins", "save", "recap"].includes(v),
  permission: v => ["location", "notifications", "contacts", "camera"].includes(v),
  game: v => /^[a-z_]{2,20}$/.test(v),
  count: v => Number.isInteger(v) && v >= 0 && v < 1e4,
  ms: v => Number.isFinite(v) && v >= 0 && v < 1e10,
  returning: v => typeof v === "boolean",
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
// this install: a random id and when it first opened
export const device = store.get("rando-device") ?? (() => {
  const id = globalThis.crypto?.randomUUID?.() ?? `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  store.set("rando-device", id);
  return id;
})();
export const firstOpen = +(store.get("rando-first-open") ?? (() => { const t = Date.now(); store.set("rando-first-open", String(t)); return t; })());
export const sinceFirstOpen = () => Date.now() - firstOpen;

const queue = [];
let sink = null, timer = null;
(globalThis.__events ??= []);

export function clean(props = {}) {
  const out = {};
  for (const [k, v] of Object.entries(props)) if (PROPS[k]?.(v)) out[k] = v;
  return out;
}
export function track(name, props = {}) {
  if (!EVENTS.includes(name)) { console.warn("[analytics] unknown event", name); return; }
  const row = { device, name, props: clean(props), lang, at: new Date().toISOString() };
  globalThis.__events.push(row);
  queue.push(row);
  schedule();
}
// a once-per-install event (first_game_started, recap_shown…)
export function trackOnce(name, props = {}) {
  const k = `rando-ev-${name}`;
  if (store.get(k)) return false;
  store.set(k, "1");
  track(name, props);
  return true;
}
function schedule() {
  if (!sink || timer) return;
  timer = setTimeout(flush, 1500);
}
export async function flush() {
  timer = null;
  if (!sink || !queue.length) return;
  const rows = queue.splice(0, 50);
  try { await sink(rows); }
  catch (e) { console.warn("[analytics] not sent:", e?.message ?? e); sink = null; }   // (table not there yet: stop trying)
  if (queue.length) schedule();
}
// backend.js: rows -> Promise (throws on failure)
export function setSink(fn) { sink = fn; schedule(); }
globalThis.addEventListener?.("pagehide", () => { flush(); });
