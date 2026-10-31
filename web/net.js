// Rando multiplayer plumbing for the demo build: rooms over Supabase Realtime.
//
// A Room = one Realtime channel with PRESENCE (who's here, joined_at) and
// BROADCAST (events). No database tables: lobbies, game state and chat are
// ephemeral by design (they die with the room — fine for a demo, and it
// means no migrations to ship).
//
// Authority model (simple, robust enough for a demo):
//   * the HOST is the earliest-joined present member; if they vanish the
//     next one takes over (everyone computes the same answer from presence)
//   * the host runs the game loop + bots and broadcasts `state` snapshots
//   * clients send `input` events to the host and render the last snapshot
//   * each client owns its OWN position and broadcasts it (no prediction
//     needed for anyone else — we only ever show coarse proximity)
//
// The DIRECTORY is one shared channel where hosts announce their rooms every
// few seconds; listeners keep a live, expiring list (nearby lobbies, world
// beacons).
import { sb } from "./backend.js";

const DIR_CHANNEL = "rooms-directory-v1";
const ANNOUNCE_MS = 2500;
const EXPIRE_MS = 8000;
// liveness: every phone in a room says it's still here every HEARTBEAT_MS.
// Presence alone can take a minute or more to notice a phone whose network
// died (no goodbye: the server has to time the socket out), and a game
// waiting on that player would sit there all that time; a member not heard
// from for STALE_MS is treated as gone by the games (hpkit syncGone) until
// they're heard from again.
export const HEARTBEAT_MS = 5000;
export const STALE_MS = 30000;

export class Room {
  constructor(id, me) {
    this.id = id;
    this.me = me;                 // { id, handle, avatar }
    this.ch = null;
    this.handlers = {};
    this.presence = {};           // userId -> meta (from presence sync)
    this.joinedAt = Date.now();
    this.onPresence = null;       // fn(members)
    this.alive = false;
    this.seen = {};               // userId -> when we last heard from them (any message, or their arrival)
  }

  async join() {
    this.ch = sb.channel(`room-${this.id}`, {
      config: { broadcast: { self: true, ack: false }, presence: { key: this.me.id } },
    });
    this.ch.on("broadcast", { event: "msg" }, ({ payload }) => this._dispatch(payload));
    this.ch.on("presence", { event: "sync" }, () => {
      const st = this.ch.presenceState();
      const p = {};
      for (const [key, metas] of Object.entries(st)) {
        if (metas && metas.length) p[key] = metas[0];
      }
      this.presence = p;
      for (const id of Object.keys(p)) this.seen[id] ??= Date.now();
      this.onPresence?.(this.members);
    });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error("room join timeout")), 8000);
      this.ch.subscribe(async status => {
        if (status === "SUBSCRIBED") {
          await this.ch.track({ id: this.me.id, handle: this.me.handle, avatar: this.me.avatar,
                                joined_at: this.joinedAt });
          this.alive = true;
          this._hb = setInterval(() => this.send("hb"), HEARTBEAT_MS);
          clearTimeout(to);
          res();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(to);
          rej(new Error("room " + status));
        }
      });
    });
    return this;
  }

  // a new look mid-party: re-track presence (same join time, so the host
  // election doesn't move); everyone's lobby rebuilds that sprite
  async updateMe(patch) {
    Object.assign(this.me, patch);
    if (!this.ch || !this.alive) return;
    await this.ch.track({ id: this.me.id, handle: this.me.handle, avatar: this.me.avatar, joined_at: this.joinedAt });
  }

  leave() {
    this.alive = false;
    clearInterval(this._hb);
    if (this.ch) { try { sb.removeChannel(this.ch); } catch {} }
    this.ch = null;
  }

  // members sorted by join order (stable host election)
  get members() {
    return Object.values(this.presence).sort((a, b) => (a.joined_at - b.joined_at) || (a.id < b.id ? -1 : 1));
  }
  get hostId() { const m = this.members; return m.length ? m[0].id : null; }
  get isHost() { return this.hostId === this.me.id; }
  // not heard from in STALE_MS (their phone dropped off the network, or stopped running)
  stale(id, now = Date.now()) { return id !== this.me.id && this.seen[id] != null && now - this.seen[id] > STALE_MS; }

  // -> the channel's answer ("ok" / "error" / "timed out"), for callers that care (a big photo)
  send(type, payload = {}) {
    if (!this.ch || !this.alive) return Promise.resolve("closed");
    return Promise.resolve(this.ch.send({ type: "broadcast", event: "msg", payload: { type, from: this.me.id, t: Date.now(), ...payload } })).catch(() => "error");
  }
  on(type, fn) { (this.handlers[type] ??= []).push(fn); return this; }
  off(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); }
  _dispatch(p) {
    if (p?.from) this.seen[p.from] = Date.now();
    for (const fn of this.handlers[p.type] || []) { try { fn(p); } catch (e) { console.warn("[room] handler", p.type, e); } }
    for (const fn of this.handlers["*"] || []) { try { fn(p); } catch (e) { console.warn("[room] handler *", e); } }
  }
}

// A look into a room before joining it (an invite link's landing screen):
// listen on its channel without joining its presence, ask the host for a
// summary, and read who's there. Resolves { name, hostName, count, members,
// playing, cap } or null if nobody answers in time (an ended party).
export function peekRoom(id, { timeout = 7000 } = {}) {
  const me = `peek-${Math.random().toString(36).slice(2, 10)}`;
  const ch = sb.channel(`room-${id}`, { config: { broadcast: { self: false, ack: false }, presence: { key: me } } });
  return new Promise(res => {
    let done = false, seen = null;
    const finish = v => { if (done) return; done = true; clearTimeout(to); try { sb.removeChannel(ch); } catch {} res(v); };
    // presence alone (an older host, or the host's answer lost): who's there, no name
    const fromPresence = () => {
      const st = ch.presenceState?.() ?? {};
      const members = Object.values(st).map(m => m?.[0]).filter(m => m?.id).sort((a, b) => a.joined_at - b.joined_at);
      return members.length ? { name: null, hostName: members[0].handle, count: members.length, members: members.map(m => ({ id: m.id, handle: m.handle, avatar: m.avatar })), playing: null } : null;
    };
    const to = setTimeout(() => finish(seen ?? fromPresence()), timeout);
    ch.on("broadcast", { event: "msg" }, ({ payload: p }) => { if (p?.type === "peekinfo" && p.to === me) finish(p.info); });
    ch.on("presence", { event: "sync" }, () => { seen = fromPresence() ?? seen; });
    ch.subscribe(status => {
      if (status !== "SUBSCRIBED") return;
      const send = () => !done && ch.send({ type: "broadcast", event: "msg", payload: { type: "peek", from: me, t: Date.now() } });
      send(); setTimeout(send, 1200); setTimeout(send, 3500);      // again, in case one went out before the host was listening
    });
  });
}

// Joining from the map: knock first. Send the host your (fuzzed, joinrange.js)
// circle on the room's channel without joining it; the host's phone answers
// { ok } or { ok: false, km }. Resolves that, or null when nobody answers in
// time (the caller lets you in rather than block on silence).
export function knockRoom(id, from, circle, { timeout = 6000 } = {}) {
  const me = `knock-${Math.random().toString(36).slice(2, 10)}`;
  const ch = sb.channel(`room-${id}`, { config: { broadcast: { self: false, ack: false }, presence: { key: me } } });
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; clearTimeout(to); try { sb.removeChannel(ch); } catch {} res(v); };
    const to = setTimeout(() => finish(null), timeout);
    ch.on("broadcast", { event: "msg" }, ({ payload: p }) => {
      if (p?.type === "knockreply" && p.to === me) finish({ ok: !!p.ok, km: p.km ?? null });
    });
    ch.subscribe(status => {
      if (status !== "SUBSCRIBED") return;
      const send = () => !done && ch.send({ type: "broadcast", event: "msg", payload: { type: "knock", from: me, who: from, circle, t: Date.now() } });
      send(); setTimeout(send, 1500);           // again, in case one went out before the host was listening
    });
  });
}

// ---------------------------------------------------------------- directory
export const directory = {
  ch: null,
  rooms: new Map(),     // id -> { ...announce, seenAt }
  listeners: new Set(),
  announcing: null,     // { fn: () => payload, timer }
  started: false,

  start() {
    if (this.started) return;
    this.started = true;
    this.ch = sb.channel(DIR_CHANNEL, { config: { broadcast: { self: true } } });
    this.ch.on("broadcast", { event: "room" }, ({ payload }) => {
      if (!payload?.id) return;
      if (payload.gone) { this.rooms.delete(payload.id); }
      else this.rooms.set(payload.id, { ...payload, seenAt: Date.now() });
      this._notify();
    });
    this.ch.subscribe();
    setInterval(() => {
      let changed = false;
      for (const [id, r] of this.rooms) {
        if (Date.now() - r.seenAt > EXPIRE_MS) { this.rooms.delete(id); changed = true; }
      }
      if (changed) this._notify();
    }, 2000);
  },
  onChange(fn) { this.listeners.add(fn); fn(this.list()); return () => this.listeners.delete(fn); },
  _notify() { const l = this.list(); for (const fn of this.listeners) fn(l); },
  list() { return [...this.rooms.values()]; },
  // hosts call this with a function returning the current announce payload
  announce(fn) {
    this.stopAnnouncing();
    const tick = () => { if (this.ch) this.ch.send({ type: "broadcast", event: "room", payload: fn() }); };
    tick();
    this.announcing = { fn, timer: setInterval(tick, ANNOUNCE_MS) };
  },
  stopAnnouncing(id) {
    if (this.announcing) { clearInterval(this.announcing.timer); this.announcing = null; }
    if (id && this.ch) this.ch.send({ type: "broadcast", event: "room", payload: { id, gone: true } });
  },
};

// ---------------------------------------------------------------- raid schedule
// NPC signature quests are RARE, raid-style windows. Every client derives the
// same schedule from the wall clock, so nobody coordinates anything:
//   cycle = 24 min; each archetype opens once per cycle, staggered 8 min apart;
//   a window = JOIN_MS of lobby (visible countdown to start), then the quest
//   runs; the NPC is dark the rest of the cycle.
// ?raid=<arch> (dev) opens that archetype's window right now.
export const RAID = {
  CYCLE_MS: 24 * 60 * 1000,           // each NPC: 3 min open, ~9 min live, 12 min dark
  JOIN_MS: 3 * 60 * 1000,
  OFFSETS: { sporty: 0, chaos: 8 * 60 * 1000, chill: 16 * 60 * 1000 },   // never two open at once
  _devOpen: {},     // arch -> openAt (ms), from ?raid=
};
{
  const q = new URLSearchParams(location.search);
  const r = q.get("raid");
  if (r) {
    const now = Date.now();
    for (const a of r.split(",")) {
      if (RAID.OFFSETS[a] !== undefined) RAID._devOpen[a] = now + 5000; // opens 5 s after load
    }
  }
}

export function raidStatus(arch, now = Date.now()) {
  if (RAID._devOpen[arch] !== undefined) {
    const openAt = RAID._devOpen[arch];
    const startAt = openAt + RAID.JOIN_MS;
    if (now < openAt) return { phase: "dark", openAt, startAt, msToOpen: openAt - now, windowId: `dev-${arch}` };
    if (now < startAt) return { phase: "open", openAt, startAt, msToStart: startAt - now, windowId: `dev-${arch}` };
    if (now < startAt + 9 * 60 * 1000) return { phase: "live", openAt, startAt, since: now - startAt, windowId: `dev-${arch}` };
    delete RAID._devOpen[arch];   // the demo window is over: back to the real schedule
  }
  const off = RAID.OFFSETS[arch] ?? 0;
  const cycleIdx = Math.floor((now - off) / RAID.CYCLE_MS);
  const openAt = cycleIdx * RAID.CYCLE_MS + off;
  const startAt = openAt + RAID.JOIN_MS;
  const windowId = `${arch}-${cycleIdx}`;
  if (now < startAt) return { phase: "open", openAt, startAt, msToStart: startAt - now, windowId };
  // quest live window: quests last up to ~10 min after start
  if (now < startAt + 9 * 60 * 1000) {
    const nextOpen = openAt + RAID.CYCLE_MS;
    return { phase: "live", openAt, startAt, since: now - startAt, windowId, nextOpenAt: nextOpen, msToOpen: nextOpen - now };
  }
  const nextOpen = openAt + RAID.CYCLE_MS;
  return { phase: "dark", openAt: nextOpen, startAt: nextOpen + RAID.JOIN_MS, msToOpen: nextOpen - now, windowId: `${arch}-${cycleIdx + 1}` };
}

export function fmtClock(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// tiny seeded rng for bots (deterministic per room)
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
