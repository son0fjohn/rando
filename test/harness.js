// House-party logic harness.
//
// Supabase Realtime and the esm.sh CDN are both unreachable from the build
// sandbox, so the real page can't boot there. This runs the REAL game modules
// (HostGame, the round machines, the scoring) against:
//   * a fake Room bus — N in-process clients on one shared broadcast list,
//     with the same "host = earliest joined present member" election
//   * a virtual clock — Date.now / performance.now / timers / rAF are all
//     driven by advance(), so a 15-minute Manhunt plays out in milliseconds
//
// Renders run for real against a real (if minimal) DOM, so a render that
// throws is caught by HostGame and shows up in client.errs — which the specs
// assert on. Every client renders into the same #game-panel and stomps the
// others; that's fine, we assert on game state, not pixels.

// ---------------------------------------------------------------- virtual clock
export function installClock(t0 = 1770000000000) {
  let now = t0, seq = 1;
  const timers = new Map();      // id -> { at, fn, every|null }
  let rafq = [];

  const realDateNow = Date.now;
  Date.now = () => Math.floor(now);
  performance.now = () => now - t0;
  window.setTimeout = (fn, ms = 0) => { const id = seq++; timers.set(id, { at: now + ms, fn, every: null }); return id; };
  window.setInterval = (fn, ms = 0) => { const id = seq++; timers.set(id, { at: now + ms, fn, every: Math.max(1, ms) }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = fn => { const id = seq++; rafq.push({ id, fn }); return id; };
  window.cancelAnimationFrame = id => { rafq = rafq.filter(r => r.id !== id); };

  function flush() {
    const q = rafq; rafq = [];
    for (const r of q) { try { r.fn(now - t0); } catch (e) { console.warn("[raf]", e); } }
    const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
    for (const [id, t] of due) {
      if (t.every) t.at = now + t.every; else timers.delete(id);
      try { t.fn(); } catch (e) { console.warn("[timer]", e); }
    }
  }
  return {
    get now() { return now; },
    // advance virtual time in `step` slices, flushing callbacks each slice
    advance(ms, step = 100) {
      const end = now + ms;
      while (now < end) { now = Math.min(end, now + step); flush(); }
    },
    restore() { Date.now = realDateNow; },
  };
}

// ---------------------------------------------------------------- fake room bus
export function makeBus() {
  const clients = new Set();
  return {
    clients,
    join(c) { clients.add(c); sync(clients); },
    drop(c) { clients.delete(c); sync(clients); },
    deliver(payload) { for (const c of [...clients]) c._dispatch(payload); },
  };
}
function sync(clients) {
  const metas = {};
  for (const c of clients) metas[c.me.id] = { id: c.me.id, handle: c.me.handle, avatar: c.me.avatar, joined_at: c.joinedAt };
  for (const c of clients) { c.presence = metas; c.onPresence?.(c.members); }
}

// Mirrors web/net.js Room: presence-based host election, self-delivering
// broadcast, same on/off/send surface.
export class FakeRoom {
  constructor(id, me, bus, joinedAt) {
    this.id = id; this.me = me; this.bus = bus;
    this.joinedAt = joinedAt ?? Date.now();
    this.handlers = {}; this.presence = {}; this.onPresence = null; this.alive = true;
    this.sent = 0;
  }
  join() { this.bus.join(this); return this; }
  leave() { this.alive = false; this.bus.drop(this); }
  get members() {
    return Object.values(this.presence).sort((a, b) => (a.joined_at - b.joined_at) || (a.id < b.id ? -1 : 1));
  }
  get hostId() { const m = this.members; return m.length ? m[0].id : null; }
  get isHost() { return this.hostId === this.me.id; }
  send(type, payload = {}) {
    if (!this.alive) return;
    this.sent++;
    this.bus.deliver(JSON.parse(JSON.stringify({ type, from: this.me.id, t: Date.now(), ...payload })));
  }
  on(type, fn) { (this.handlers[type] ??= []).push(fn); return this; }
  off(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); }
  _dispatch(p) {
    if (!this.alive) return;
    for (const fn of this.handlers[p.type] || []) { try { fn(p); } catch (e) { console.warn("[room]", p.type, e); } }
  }
}

// ---------------------------------------------------------------- table
// Seat n players, start `gamedef` for each, and hand back handles. Everyone
// runs the real game module; exactly one of them is the host.
export function seatTable(gamedef, n, { seed = 42, ids = null, options = {}, party = null, session = null } = {}) {
  const bus = makeBus();
  const t0 = Date.now();
  const players = (ids ?? Array.from({ length: n }, (_, i) => `p${i + 1}`)).map((id, i) => ({
    id, handle: id, avatar: {}, joinedAt: t0 + i,
  }));
  const humans = players.map(p => ({ id: p.id, handle: p.handle, avatar: p.avatar }));
  const clients = players.map(p => {
    const room = new FakeRoom("party-TEST", p, bus, p.joinedAt);
    room.join();
    return { me: p, room, ended: false };
  });
  for (const c of clients) {
    const ctx = {
      room: c.room, me: c.me, humans, seed,
      isHost: () => c.room.isHost,
      party: party ?? { name: "test party", vibe: "chill", cap: 12, code: "TEST", privacy: "private", settings: { adult: false, diaryMax: null } },
      options,
      session: session ?? {},
      onEnd: () => { c.ended = true; },
    };
    gamedef.start(ctx);
    c.game = window.__game;          // HostGame publishes itself for debugging
  }
  return {
    bus, clients,
    get host() { return clients.find(c => c.room.isHost); },
    // the host's state is the authoritative one
    get s() { return clients.find(c => c.room.isHost)?.game?.s ?? null; },
    byId(id) { return clients.find(c => c.me.id === id); },
    // what a given client last received / rendered from
    stateOf(id) { return this.byId(id)?.game?.s ?? null; },
    input(id, type, payload = {}) { this.byId(id).game.input(type, payload); },
    drop(id) { const c = this.byId(id); c.room.leave(); c.dropped = true; },
    errors() {
      return clients.flatMap(c => (c.game?.errs ?? []).map(e => `${c.me.id}: ${e.where}: ${e.msg.split("\n")[0]}`));
    },
    allEnded() { return clients.every(c => c.ended || c.dropped); },
  };
}
