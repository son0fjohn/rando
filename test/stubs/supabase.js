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
};
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
      out = T.filter(match); out.forEach(r => Object.assign(r, this.patch));
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

const RPC = {
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
    rpc: async (name, args) => RPC[name] ? { data: RPC[name](args ?? {}), error: null } : { data: null, error: { message: `rpc ${name} not stubbed` } },
    channel: (name, cfg) => new StubChannel(name, cfg),
    removeChannel: ch => ch.close(),
  };
}
