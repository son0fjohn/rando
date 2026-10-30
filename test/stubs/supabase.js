// Offline stand-in for "https://esm.sh/@supabase/supabase-js@2", so the REAL
// app page (web/index.html + backend.js + the 3D map) runs with no network.
// test/map.html-style harnesses map the CDN URL here with an importmap.
//
//   auth      always signed in as ?me=<handle> (id u-<handle>)
//   tables    in-memory, seeded with the six launch zones, your profile
//             (?av=<avatar JSON>) and a few plaza chat lines
//   get_world ?crowd=N strangers spread over the zones (default 5), plus you
//             while you're open
//   realtime  channels ride on BroadcastChannel (bcchannel.js), so tabs in one
//             browser context form real parties through the real net.js
//   coins     the coin + shop RPCs of migrations/013, same rules, kept in
//             localStorage so every tab of the context shares one "server"
//             (the real SQL is tested by test/coins_sql.mjs); ?coins=N starts
//             you with N coins
//   ritual    ritual_draw (migrations/015): a prompt for the caller only, no
//             repeats per room on this phone (the real SQL: test/coins_sql.mjs)
//   fresh     no ?me=: a new guest, like a real first open (anonymous
//             sign-in): an id kept in this browser context's storage, an
//             auto handle (rando-xxxxxx), no look yet: the onboarding runs
//   phone     ?verify=1 (or localStorage stub-verify=1): the server "has SMS",
//             so verification gates are on; the code is always 123456;
//             +821000000000 is "already registered"
//   events    the onboarding's analytics land in db.events (window.__db)
//   oauth     ?oauth=kakao,apple,google (or localStorage stub-oauth): those
//             one-tap sign-ins are "switched on". linkIdentity adds the
//             provider to this same account and comes straight back to
//             redirectTo (no provider page); ?oauthTaken=1 (stub-oauth-taken)
//             makes it come back with identity_already_exists instead.
//             signInWithOAuth switches this browser to that provider's
//             account (u-guest-<provider>acct), a returning player.
//   sms fails ?smsFail=provider (stub-sms-fail): the provider refuses to text
//             (Twilio's region error, as Supabase passes it on); =rate: the
//             server's "only request this after 53 seconds"
//   strict    ?strictrt=1: realtime-js's real channel bookkeeping
//             (bcchannel.js strictRealtime: channel() reuses a topic still in
//             the list, removeChannel() waits for the leave, subscribe() on a
//             leaving channel does nothing, late .on("presence") throws),
//             postgres_changes for rows inserted here (every tab), and auth as
//             supabase-js does it: INITIAL_SESSION on each onAuthStateChange;
//             &rtleave=MS: how long a leave takes to come back (default 300)
//   auth      window.__authEvent(event = "TOKEN_REFRESHED"): that auth event,
//             to every listener (a token refresh, a tab coming back)
import { StubChannel, open, strictRealtime, pgInsert, pgListen } from "./bcchannel.js";
import { ITEMS4, HAIRCOLOR_SHOP, STARTER_OUTFITS4 } from "/web/items4.js";
import { notesStub } from "./notes_stub.js";   // notes on the map (migrations/019): RPCs, buckets, a fake moderator

const q = new URLSearchParams(location.search);
const strictRt = q.get("strictrt") === "1";
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const fresh = !q.get("me");
const freshId = fresh ? (ls.get("stub-guest") ?? (() => { const h = Math.random().toString(16).slice(2, 8).padEnd(6, "0"); ls.set("stub-guest", h); return h; })()) : null;
const handle = q.get("me") || `rando-${freshId}`;
const myId = q.get("me") ? `u-${handle}` : `u-guest-${freshId}`;
let myAvatar = {};
try { myAvatar = JSON.parse(q.get("av") || "{}"); } catch {}

const ZONES = [
  ["itaewon-station", "Itaewon Station", 37.5346, 126.9946],
  ["hamilton-alley", "Hamilton Alley", 37.5349, 126.9941],
  ["gyeongnidan", "Gyeongnidan", 37.5392, 126.9887],
  ["haebangchon", "Haebangchon", 37.5418, 126.9882],
  ["noksapyeong", "Noksapyeong", 37.5340, 126.9868],
  ["bogwang", "Bogwang", 37.5289, 126.9944],
].map(([id, name, lat, lng]) => ({ id, name, lat, lng, kind: "fixed" }));

// the strangers wear the starter outfits (the new wardrobe), with some hair and colour
const LOOKS = STARTER_OUTFITS4.map(({ id, name, ...o }, i) => ({ skin: String(1 + (i * 3) % 8), eyes: ["sharp", "round", "cat", "sleepy", "sparkly", "narrow"][i], iris: ["brown", "lightblue", "green", "amber", "violet", "gray"][i],
  hair: o.hair ?? ["middle-part", "buzz", "bob", "wolf", "twin-buns", "slicked"][i], hairColor: ["darkbrown", "black", "blonde", "lightbrown", "black", "red"][i], ...o }));
const NAMES = ["mina", "jae", "sol", "haru", "dana", "kit", "yuna", "rio", "bo", "lux", "ari", "noa"];
const crowd = Math.max(0, Math.min(12, q.get("crowd") === null ? 5 : +q.get("crowd")));
const strangers = Array.from({ length: crowd }, (_, i) => ({
  user_id: `u-${NAMES[i]}`, handle: NAMES[i], avatar: LOOKS[i % LOOKS.length],
  zone_id: ZONES[[0, 0, 1, 4, 2, 0, 5, 3, 1, 4, 0, 2][i]].id,
}));

const db = {
  zones: ZONES,
  profiles: [{ id: myId, handle: ls.get(`stub-handle-${myId}`) ?? handle, avatar: JSON.parse(ls.get(`stub-avatar-${myId}`) ?? "null") ?? myAvatar }, ...strangers.map(s => ({ id: s.user_id, handle: s.handle, avatar: s.avatar }))],
  presence: [],
  public_messages: [
    { id: 1, sender: "u-mina", handle: "mina", body: "anyone at hamilton rn?", zone_id: "hamilton-alley", created_at: "2026-10-21T10:00:00Z" },
    { id: 2, sender: "u-jae", handle: "jae", body: "coffee line is insane lol", zone_id: "itaewon-station", created_at: "2026-10-21T10:01:00Z" },
  ],
  events: [],
  matches: [], match_queue: [], messages: [], friend_messages: [], encounter_confirms: [], reports: [], diary_prompt_log: [],
  // the shop as migrations/016 makes it
  shop_items: [
    ...Object.entries(ITEMS4).filter(([, d]) => d.price > 0).map(([v, d]) => ({ id: `a4-${v}`, slot: d.cat, value: v, name: d.name.toLowerCase(), price: d.price, rarity: d.rarity })),
    ...Object.entries(HAIRCOLOR_SHOP).map(([c, t]) => ({ id: `a4-haircolor-${c}`, slot: "hairColor", value: c, name: `${c} hair dye`, price: t.price, rarity: t.rarity })),
  ],
};

// ---- the coin "server", shared by every tab: IndexedDB (localStorage writes
// reach other tabs' processes late, so concurrent calls lost each other's
// updates), one call at a time across tabs (a Web Lock), like the real one's
// transactions. window.__coins() reads it, for tests.
let CUR = null, dirty = false;
// (one connection per page, kept: a new one per call piled up hundreds on a long recording)
let idbConn = null;
const idb = () => (idbConn ??= new Promise((res, rej) => { const r = indexedDB.open("stub-coins", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => { idbConn = null; rej(r.error); }; }));
const idbGet = async () => { const d = await idb(); return new Promise(res => { const g = d.transaction("kv").objectStore("kv").get("state"); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null); }); };
const idbPut = async v => { const d = await idb(); return new Promise(res => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, "state"); t.oncomplete = res; t.onerror = res; }); };
const load = () => CUR;
const save = st => { CUR = st; dirty = true; };
const cstate = () => load() ?? { ledger: [], games: {}, receipts: {}, inventory: {} };
function withCoins(fn) {
  const go = async () => { CUR = await idbGet(); dirty = false; const r = fn(); if (dirty) await idbPut(CUR); return r; };
  return navigator.locks ? navigator.locks.request("stub-coins", go) : go();
}
window.__coins = () => withCoins(() => cstate());
withCoins(() => { if (q.get("coins")) { const st = cstate(); st.ledger.push({ user: myId, delta: +q.get("coins"), reason: "seed", t: Date.now() }); save(st); } });
const balance = (st, u) => st.ledger.filter(l => l.user === u).reduce((a, l) => a + l.delta, 0);
const PLACE = [30, 20, 12], FINISH = 5, HOST = 50, CAP = 300, HOST_CAP = 3;
function earn(st, u, amount, reason, key) {
  const day = new Date().toISOString().slice(0, 10);
  if (st.ledger.some(l => l.user === u && l.reason === reason && l.key === key)) return 0;
  const today = st.ledger.filter(l => l.user === u && l.delta > 0 && l.reason !== "seed" && new Date(l.t).toISOString().slice(0, 10) === day).reduce((a, l) => a + l.delta, 0);
  const pay = Math.min(amount, CAP - today);
  if (pay <= 0) return 0;
  st.ledger.push({ user: u, delta: pay, reason, key, t: Date.now() });
  return pay;
}
function settle(st, gk, u) {
  const g = st.games[gk]; if (!g || !st.receipts[gk]?.includes(u)) return 0;
  const r = g.ranking.find(e => e.id === u); if (!r) return 0;
  return earn(st, u, PLACE[r.place - 1] ?? FINISH, "game", gk);
}
function hostReward(st, session, set) {
  const ks = [1, 2, 3].map(i => `${session}|${set}|${i}`);
  if (!ks.every(k => st.games[k])) return;
  const full = new Set((st.receipts[ks[0]] ?? []).filter(u => ks.every(k => st.receipts[k]?.includes(u) && st.games[k].ranking.some(e => e.id === u))));
  if (full.size < 4) return;
  const h = st.games[ks[2]].host, day = new Date().toISOString().slice(0, 10);
  if (st.ledger.filter(l => l.user === h && l.reason === "host" && new Date(l.t).toISOString().slice(0, 10) === day).length >= HOST_CAP) return;
  earn(st, h, HOST, "host", `${session}|${set}`);
}
const wallet = st => ({ coins: balance(st, myId), owned: st.inventory[myId] ?? [] });
window.__db = db;

// a tiny PostgREST-ish query builder: filters, order, limit, single rows
class Query {
  constructor(table) { this.t = table; this.filters = []; this.op = "select"; this.rows = null; this.one = false; this.lim = null; this.ord = null; }
  select() { if (this.op === "select") this.op = "select"; else this.ret = true; return this; }
  eq(k, v) { this.filters.push(r => r[k] === v); return this; }
  in(k, vs) { this.filters.push(r => vs.includes(r[k])); return this; }
  or(expr) {
    const alts = expr.split(",").map(s => s.match(/^(\w+)\.eq\.(.+)$/)).filter(Boolean);
    this.filters.push(r => alts.some(([, k, v]) => String(r[k]) === v));
    return this;
  }
  order(k, o = {}) { this.ord = { k, asc: o.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert(rows) { this.op = "insert"; this.rows = [].concat(rows); return this; }
  upsert(rows) { this.op = "upsert"; this.rows = [].concat(rows); return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  then(res, rej) { return Promise.resolve().then(() => this._run()).then(res, rej); }
  _run() {
    const T = (db[this.t] ??= []);
    const match = r => this.filters.every(f => f(r));
    let out;
    if (this.op === "insert" || this.op === "upsert") {
      out = this.rows.map(r => {
        const row = { id: r.id ?? `${this.t}-${T.length + 1}`, created_at: new Date().toISOString(), ...r };
        if (this.t === "public_messages") Object.assign(row, { sender: myId, handle, zone_id: db.presence.find(p => p.user_id === myId)?.zone_id ?? "itaewon-station" });
        const key = this.t === "presence" ? "user_id" : "id";
        const i = this.op === "upsert" ? T.findIndex(x => x[key] === row[key]) : -1;
        if (i >= 0) T[i] = { ...T[i], ...row }; else T.push(row);
        if (strictRt && this.op === "insert") pgInsert(this.t, { ...row });
        return row;
      });
    } else if (this.op === "update") {
      out = T.filter(match);
      if (this.t === "profiles" && this.patch.avatar) {
        const owned = cstate().inventory[myId] ?? [];
        for (const r of out) for (const it of db.shop_items)
          if (this.patch.avatar[it.slot] === it.value && r.avatar?.[it.slot] !== it.value && !owned.includes(it.id))
            return { data: null, error: { message: `locked: ${it.name} is in the shop (${it.price} coins)` } };
      }
      out.forEach(r => Object.assign(r, this.patch));
      if (this.t === "profiles") for (const r of out) if (r.id === myId) { if (this.patch.handle) ls.set(`stub-handle-${myId}`, this.patch.handle); if (this.patch.avatar) ls.set(`stub-avatar-${myId}`, JSON.stringify(this.patch.avatar)); }
    } else if (this.op === "delete") {
      out = T.filter(match); db[this.t] = T.filter(r => !match(r));
    } else {
      out = T.filter(match);
      if (this.ord) out = [...out].sort((a, b) => (a[this.ord.k] < b[this.ord.k] ? -1 : 1) * (this.ord.asc ? 1 : -1));
      if (this.lim !== null) out = out.slice(0, this.lim);
    }
    out = out.map(r => ({ ...r }));
    return { data: this.one ? out[0] ?? null : out, error: null };
  }
}

const RITUAL_POOL = await fetch(new URL("../../web/data/ritual_prompts.json", import.meta.url)).then(r => r.json()).then(j => j.prompts).catch(() => []);
const ritualDraws = new Map();     // `${room}|${turn}` -> prompt (this phone's draws only)
const RPC = {
  ritual_draw: ({ p_room, p_turn, p_level }) => {
    const lv = ["mild", "spicy", "unhinged"].indexOf(p_level);
    if (lv < 0) throw new Error("bad level");
    const key = `${p_room}|${p_turn}`;
    if (!ritualDraws.has(key)) {
      const used = new Set([...ritualDraws].filter(([k]) => k.startsWith(`${p_room}|`)).map(([, p]) => p.id));
      const ok = RITUAL_POOL.filter(p => ["mild", "spicy", "unhinged"].indexOf(p.level) <= lv);
      const fresh = ok.filter(p => !used.has(p.id));
      const pool = fresh.length ? fresh : ok;
      ritualDraws.set(key, pool[Math.floor(Math.random() * pool.length)]);
    }
    const p = ritualDraws.get(key);
    return p ? { id: p.id, text: p.text } : null;
  },
  get_world: () => [
    ...strangers.map(s => ({ ...s, is_self: false })),
    ...db.presence.filter(p => p.user_id === myId).map(p => ({ user_id: myId, handle, avatar: myAvatar, zone_id: p.zone_id, is_self: true })),
  ],
  list_friends: () => [],
  ensure_auto_zone: ({ p_cell_lat, p_cell_lng }) => {
    const z = { id: `auto-${p_cell_lat}-${p_cell_lng}`, name: `Area ${p_cell_lat}, ${p_cell_lng}`, lat: p_cell_lat, lng: p_cell_lng, kind: "auto" };
    if (!db.zones.some(x => x.id === z.id)) db.zones.push(z);
    return z;
  },
  ensure_dm: ({ p_other }) => `dm-${p_other}`,
  report_game: ({ p_session, p_set, p_idx, p_game, p_ranking }) => {
    const st = cstate(), gk = `${p_session}|${p_set}|${p_idx}`;
    if (st.games[gk] || !p_ranking.some(e => e.id === myId)) return 0;
    st.games[gk] = { host: myId, game: p_game, ranking: p_ranking, t: Date.now() };
    let paid = 0; for (const u of st.receipts[gk] ?? []) paid += settle(st, gk, u);
    if (p_idx === 3) hostReward(st, p_session, p_set);
    save(st); return paid;
  },
  confirm_game: ({ p_session, p_set, p_idx }) => {
    const st = cstate(), gk = `${p_session}|${p_set}|${p_idx}`;
    (st.receipts[gk] ??= []).includes(myId) || st.receipts[gk].push(myId);
    const paid = settle(st, gk, myId);
    if (p_idx === 3) hostReward(st, p_session, p_set);
    save(st); return paid;
  },
  my_party_coins: ({ p_session, p_set }) => cstate().ledger.filter(l => l.user === myId && (l.key ?? "").startsWith(`${p_session}|${p_set}`) && ["game", "host"].includes(l.reason)).reduce((a, l) => a + l.delta, 0),
  my_wallet: () => wallet(cstate()),
  buy_item: ({ p_item }) => {
    const st = cstate(), it = db.shop_items.find(i => i.id === p_item);
    if (!it) throw new Error("no such item");
    if ((st.inventory[myId] ?? []).includes(p_item)) return { ok: true, ...wallet(st) };
    if (balance(st, myId) < it.price) return { ok: false, why: "not enough coins", coins: balance(st, myId) };
    st.ledger.push({ user: myId, delta: -it.price, reason: "purchase", item: p_item, t: Date.now() });
    (st.inventory[myId] ??= []).push(p_item);
    save(st); return { ok: true, ...wallet(st) };
  },
  request_match: () => null,
  encounter_status: () => [{ i_confirmed: false, encounter_complete: false, encounter_verified: false }],
};

const phone0 = ls.get(`stub-phone-${myId}`);
const ids0 = JSON.parse(ls.get(`stub-ids-${myId}`) ?? "[]");
const session = { user: { id: myId, is_anonymous: !phone0 && !ids0.length, phone: phone0 ?? "", phone_confirmed_at: phone0 ? new Date().toISOString() : null,
  identities: ids0.map(provider => ({ provider })), app_metadata: { providers: ids0 } }, access_token: "stub" };
const oauthOn = (q.get("oauth") ?? ls.get("stub-oauth") ?? "").split(",").filter(Boolean);
const oauthTaken = (q.get("oauthTaken") ?? ls.get("stub-oauth-taken")) === "1";
const smsFail = () => ({
  provider: { message: "Error sending confirmation OTP to provider: Permission to send an SMS has not been enabled for the region indicated by the 'To' number" },
  rate: { message: "For security purposes, you can only request this after 53 seconds." },
}[q.get("smsFail") ?? ls.get("stub-sms-fail")] ?? null);
// "the provider" sends the browser back: a real navigation, like the real thing
// (a fresh page load even when only the #fragment differs, as coming back from another site is)
const goBack = (to, hash = "") => setTimeout(() => { history.replaceState(null, "", to.split("#")[0] + hash); location.reload(); }, 250);
const authListeners = new Set();
let pendingPhone = null;
const phoneAuth = (q.get("verify") ?? ls.get("stub-verify")) === "1";
// ---- notes (notes_stub.js): their state rides in the coin "server" above
const NOTES = notesStub({ me: () => myId, cstate, save, withState: withCoins,
  verified: () => !phoneAuth || !!session.user.phone_confirmed_at || (session.user.identities ?? []).some(i => i.provider === "kakao") });
Object.assign(RPC, NOTES.rpc);
window.__authEvent = (event = "TOKEN_REFRESHED") => { for (const cb of authListeners) cb(event, session); };
export function createClient() {
  const rt = strictRt ? strictRealtime({ leaveMs: +(q.get("rtleave") ?? 300) }) : null;
  if (strictRt) pgListen();
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(cb) {
        authListeners.add(cb);
        if (strictRt) setTimeout(() => authListeners.has(cb) && cb("INITIAL_SESSION", session), 0);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } }; },
      signInAnonymously: async () => ({ data: { session }, error: null }),
      signInWithOtp: async ({ phone } = {}) => { if (smsFail()) return { error: smsFail() }; pendingPhone = phone; return { error: null }; },
      // a guest linking a number (type phone_change) keeps its id: nothing is lost
      updateUser: async ({ phone } = {}) => {
        if (!phone) return { data: { user: session.user }, error: null };
        if (smsFail()) return { data: null, error: smsFail() };
        if (phone === "+821000000000") return { data: null, error: { message: "Phone number already registered" } };
        pendingPhone = phone; return { data: { user: session.user }, error: null };
      },
      verifyOtp: async ({ phone, token } = {}) => {
        if (!phoneAuth) return { error: null };
        if (token !== "123456" || phone !== pendingPhone) return { error: { message: "Token has expired or is invalid" } };
        Object.assign(session.user, { phone, phone_confirmed_at: new Date().toISOString(), is_anonymous: false });
        ls.set(`stub-phone-${myId}`, phone);
        for (const cb of authListeners) setTimeout(() => cb("USER_UPDATED", session), 0);
        return { data: { session }, error: null };
      },
      signOut: async () => ({ error: null }),
      // a guest saved with Kakao / Apple / Google: the same id, now with that sign-in
      linkIdentity: async ({ provider, options } = {}) => {
        if (!oauthOn.includes(provider)) return { data: null, error: { message: "Unsupported provider: provider is not enabled" } };
        if (oauthTaken) { goBack(options?.redirectTo ?? location.href, "#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user"); return { data: {}, error: null }; }
        const ids = [...new Set([...ids0, provider])];
        ls.set(`stub-ids-${myId}`, JSON.stringify(ids));
        goBack(options?.redirectTo ?? location.href);
        return { data: {}, error: null };
      },
      // another phone signs in: this browser becomes that provider's (returning) account
      signInWithOAuth: async ({ provider, options } = {}) => {
        if (!oauthOn.includes(provider)) return { data: null, error: { message: "Unsupported provider: provider is not enabled" } };
        const id = `${provider}acct`;
        ls.set("stub-guest", id);
        ls.set(`stub-ids-u-guest-${id}`, JSON.stringify([provider]));
        if (!ls.get(`stub-handle-u-guest-${id}`)) { ls.set(`stub-handle-u-guest-${id}`, "minji"); ls.set(`stub-avatar-u-guest-${id}`, JSON.stringify(STARTER_OUTFITS4[1] ? { skin: "2", eyes: "round", iris: "brown", hairColor: "black", hair: "bob", ...(({ id: _i, name: _n, ...o }) => o)(STARTER_OUTFITS4[1]) } : {})); }
        goBack(options?.redirectTo ?? location.href);
        return { data: {}, error: null };
      },
    },
    from: t => new Query(t),
    storage: NOTES.storage,
    functions: NOTES.functions,
    rpc: async (name, args) => {
      if (!RPC[name]) return { data: null, error: { message: `rpc ${name} not stubbed` } };
      return withCoins(() => { try { return { data: RPC[name](args ?? {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } });
    },
    channel: (name, cfg) => rt ? rt.channel(name, cfg) : new StubChannel(name, cfg),
    __phoneAuth: phoneAuth,
    __authSettings: { phone: phoneAuth, ...Object.fromEntries(oauthOn.map(p => [p, true])) },
    removeChannel: ch => rt ? rt.removeChannel(ch) : ch.close(),
    getChannels: () => rt ? rt.getChannels() : [...open],
  };
}
