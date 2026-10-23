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
import { StubChannel } from "./bcchannel.js";

const q = new URLSearchParams(location.search);
const handle = q.get("me") || "tester";
const myId = `u-${handle}`;
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

const LOOKS = [
  { skin: "2", hair: "f1", hairColor: "brown", face: "f1", iris: "blue", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-white-stripe" },
  { skin: "4", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "tee-white-graphic", bottom: "jeans-baggy-blue", shoes: "sneaker-hitop-black" },
  { skin: "1", hair: "f2", hairColor: "red", face: "f2", iris: "green", top: "tee-baggy-black", bottom: "skirt-pleated-black", shoes: "clog-pink" },
  { skin: "3", hair: "m3", hairColor: "white", face: "f5", iris: "navy", top: "none", bottom: "track-navy", shoes: "boot-work-tan" },
  { skin: "5", hair: "f4", hairColor: "yellow", face: "f6", iris: "blue", top: "tee-white-graphic", bottom: "shorts-green", shoes: "sneaker-white-lowtop" },
];
const NAMES = ["mina", "jae", "sol", "haru", "dana", "kit", "yuna", "rio", "bo", "lux", "ari", "noa"];
const crowd = Math.max(0, Math.min(12, q.get("crowd") === null ? 5 : +q.get("crowd")));
const strangers = Array.from({ length: crowd }, (_, i) => ({
  user_id: `u-${NAMES[i]}`, handle: NAMES[i], avatar: LOOKS[i % LOOKS.length],
  zone_id: ZONES[[0, 0, 1, 4, 2, 0, 5, 3, 1, 4, 0, 2][i]].id,
}));

const db = {
  zones: ZONES,
  profiles: [{ id: myId, handle, avatar: myAvatar }, ...strangers.map(s => ({ id: s.user_id, handle: s.handle, avatar: s.avatar }))],
  presence: [],
  public_messages: [
    { id: 1, sender: "u-mina", handle: "mina", body: "anyone at hamilton rn?", zone_id: "hamilton-alley", created_at: "2026-10-21T10:00:00Z" },
    { id: 2, sender: "u-jae", handle: "jae", body: "coffee line is insane lol", zone_id: "itaewon-station", created_at: "2026-10-21T10:01:00Z" },
  ],
  matches: [], match_queue: [], messages: [], friend_messages: [], encounter_confirms: [], reports: [], diary_prompt_log: [],
  shop_items: [
    ["top-hoodie-maroon", "top", "hoodie-maroon", "maroon hoodie", 150], ["bottom-camo", "bottom", "camo", "camo pants", 100],
    ["bottom-skirt-pleated", "bottom", "skirt-pleated-black", "pleated skirt", 100], ["bottom-shorts-blue", "bottom", "shorts-blue", "blue shorts", 60],
    ["shoes-clog-pink", "shoes", "clog-pink", "pink clogs", 90], ["shoes-boot-work-tan", "shoes", "boot-work-tan", "tan work boots", 120],
    ["haircolor-red", "hairColor", "red", "red hair dye", 80], ["haircolor-white", "hairColor", "white", "white hair dye", 80],
  ].map(([id, slot, value, name, price]) => ({ id, slot, value, name, price })),
};

// ---- the coin "server", shared by every tab: IndexedDB (localStorage writes
// reach other tabs' processes late, so concurrent calls lost each other's
// updates), one call at a time across tabs (a Web Lock), like the real one's
// transactions. window.__coins() reads it, for tests.
let CUR = null, dirty = false;
const idb = () => new Promise((res, rej) => { const r = indexedDB.open("stub-coins", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
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

const session = { user: { id: myId }, access_token: "stub" };
const authListeners = new Set();
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(cb) { authListeners.add(cb); return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } }; },
      signInAnonymously: async () => ({ data: { session }, error: null }),
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
    from: t => new Query(t),
    rpc: async (name, args) => {
      if (!RPC[name]) return { data: null, error: { message: `rpc ${name} not stubbed` } };
      return withCoins(() => { try { return { data: RPC[name](args ?? {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } });
    },
    channel: (name, cfg) => new StubChannel(name, cfg),
    removeChannel: ch => ch.close(),
  };
}
