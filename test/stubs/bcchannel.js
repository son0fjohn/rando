// A Supabase-Realtime-shaped channel that rides on BroadcastChannel, so
// several Playwright pages in one browser context really talk to each other.
// Shared by backend_bc.js (party test page) and supabase.js (the real app
// page, offline). Mirrors what net.js and backend.js use:
// channel(name, config).on("broadcast" | "presence" | "postgres_changes", …)
// .subscribe(cb) / track(meta) / presenceState() / send(), and close().
// Presence is gossip: on join you announce yourself, everyone already there
// answers with their own meta, and leave (explicit or on pagehide) removes you.
// strictRealtime() below adds realtime-js's own channel bookkeeping on top.
export const open = new Set();

export class StubChannel {
  constructor(name, cfg) {
    this.name = name;
    this.cfg = cfg?.config ?? {};
    this.key = this.cfg.presence?.key ?? null;
    this.handlers = [];
    this.state = {};
    this.mine = null;
    this.bc = null;
  }
  on(type, filter, cb) { this.handlers.push({ type, event: filter?.event, filter, cb }); return this; }
  subscribe(cb) {
    this.bc = new BroadcastChannel(`sbstub:${this.name}`);
    this.bc.onmessage = e => this._rx(e.data);
    open.add(this);
    setTimeout(() => cb?.("SUBSCRIBED"), 5);
    return this;
  }
  async track(meta) {
    this.mine = meta;
    this.state[this.key] = [meta];
    this.bc?.postMessage({ k: "join", key: this.key, meta });
    this._emit("presence", "sync", {});
  }
  presenceState() { return this.state; }
  send({ event, payload }) {
    this.bc?.postMessage({ k: "bc", event, payload });
    if (this.cfg.broadcast?.self) setTimeout(() => this._emit("broadcast", event, { payload }), 0);
    return Promise.resolve("ok");
  }
  close() {
    if (this.mine && this.bc) this.bc.postMessage({ k: "leave", key: this.key });
    this.bc?.close(); this.bc = null; this.mine = null;
    open.delete(this);
  }
  _rx(d) {
    if (d.k === "bc") return this._emit("broadcast", d.event, { payload: d.payload });
    if (d.k === "join") {
      this.state[d.key] = [d.meta];
      if (this.mine) this.bc.postMessage({ k: "here", key: this.key, meta: this.mine });
    } else if (d.k === "here") this.state[d.key] = [d.meta];
    else if (d.k === "leave") delete this.state[d.key];
    this._emit("presence", "sync", {});
  }
  _emit(type, event, arg) {
    for (const h of this.handlers) if (h.type === type && h.event === event) { try { h.cb(arg); } catch (e) { console.warn("[sbstub]", e); } }
  }
}

// ?strictrt=1 (supabase.js): what realtime-js (2.11+) really does with
// channels, which the plain stub glosses over:
//   channel(topic)    hands back the channel already in the client's list
//                     under that topic, if there is one (its config ignored)
//   removeChannel(ch) a joined channel leaves first and only drops out of the
//                     list when the leave comes back (leaveMs later); it hears
//                     nothing meanwhile
//   subscribe()       joins a closed channel only: on a joining, joined or
//                     leaving one it does nothing (no callback, ever)
//   .on("presence" | "postgres_changes") on a joining / joined one throws
//   track()           only on a joined channel
//   send()            off a channel that isn't joined: REST, still delivered
// So a channel recreated right after its removal is the dying one, and deaf.
// postgres_changes: an INSERT (pgInsert, from the stub's tables) reaches every
// open channel with a matching binding (table, event, "col=eq.value"), in
// every tab.
export function strictRealtime({ leaveMs = 300 } = {}) {
  const list = [];
  const unlist = ch => { const i = list.indexOf(ch); if (i >= 0) list.splice(i, 1); };
  class StrictChannel extends StubChannel {
    st = "closed";
    on(type, filter, cb) {
      if ((type === "presence" || type === "postgres_changes") && (this.st === "joining" || this.st === "joined"))
        throw new Error(`cannot add \`${type}\` callbacks for realtime:${this.name} after \`subscribe()\`.`);
      return super.on(type, filter, cb);
    }
    subscribe(cb) {
      if (this.st !== "closed") return this;
      this.st = "joining";
      return super.subscribe(status => { if (this.st !== "joining") return; this.st = "joined"; cb?.(status); });
    }
    track(meta) { return this.st === "joined" ? super.track(meta) : Promise.resolve("timed out"); }
    send(msg) {
      if (this.st === "joined") return super.send(msg);
      const bc = new BroadcastChannel(`sbstub:${this.name}`);
      bc.postMessage({ k: "bc", event: msg.event, payload: msg.payload }); bc.close();
      return Promise.resolve("ok");
    }
  }
  return {
    channel(name, cfg) {
      let ch = list.find(c => c.name === name);
      if (!ch) list.push(ch = new StrictChannel(name, cfg));
      return ch;
    },
    async removeChannel(ch) {
      if (ch.st === "leaving") return ch.leaving;
      if (ch.st === "closed") { unlist(ch); return "ok"; }
      ch.st = "leaving";
      ch.close();
      return (ch.leaving = new Promise(res => setTimeout(() => { ch.st = "closed"; unlist(ch); res("ok"); }, leaveMs)));
    },
    getChannels: () => [...list],
  };
}

// postgres_changes, in strict mode: a row inserted into a stub table, to every tab
let pgBus = null;
function pgDeliver({ table, row }) {
  for (const ch of open) for (const h of ch.handlers) {
    const f = h.filter;
    if (h.type !== "postgres_changes" || f?.table !== table || !["INSERT", "*"].includes(f.event)) continue;
    const m = f.filter && /^(\w+)=eq\.(.+)$/.exec(f.filter);
    if (f.filter && (!m || String(row[m[1]]) !== m[2])) continue;
    try { h.cb({ eventType: "INSERT", schema: "public", table, new: row, old: {} }); } catch (e) { console.warn("[sbstub]", e); }
  }
}
export function pgListen() {
  if (!pgBus) { pgBus = new BroadcastChannel("sbstub:pg"); pgBus.onmessage = e => pgDeliver(e.data); }
}
export function pgInsert(table, row) {
  pgListen();
  pgBus.postMessage({ table, row });
  pgDeliver({ table, row });
}

window.addEventListener("pagehide", () => { for (const ch of [...open]) ch.close(); });
