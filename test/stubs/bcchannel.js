// A Supabase-Realtime-shaped channel that rides on BroadcastChannel, so
// several Playwright pages in one browser context really talk to each other.
// Shared by backend_bc.js (party test page) and supabase.js (the real app
// page, offline). Mirrors what net.js and backend.js use:
// channel(name, config).on("broadcast" | "presence" | "postgres_changes", …)
// .subscribe(cb) / track(meta) / presenceState() / send(), and close().
// Presence is gossip: on join you announce yourself, everyone already there
// answers with their own meta, and leave (explicit or on pagehide) removes you.
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
  on(type, filter, cb) {
    // strict (supabase.js ?strictrt=1): realtime-js refuses these on a joining/joined channel
    if (this.strict && this.bc && !this.leaving && (type === "presence" || type === "postgres_changes"))
      throw new Error(`cannot add \`${type}\` callbacks for realtime:${this.name} after \`subscribe()\`.`);
    this.handlers.push({ type, event: filter?.event, table: filter?.table, cb }); return this;
  }
  subscribe(cb) {
    // strict: a channel that's leaving or left doesn't join again (realtime-js only joins a closed one)
    if (this.strict && (this.leaving || this.bc)) return this;
    this.bc = new BroadcastChannel(`sbstub:${this.name}`);
    this.bc.onmessage = e => this._rx(e.data);
    // the server hands a new subscriber the presence state as it is, without
    // its own track(): ask whoever's here (an invite link's peek reads it)
    if (this.cfg.presence) this.bc.postMessage({ k: "who" });
    open.add(this);
    // (strict: the join is a round trip to the server; until it's back the channel is "joining")
    setTimeout(() => { if (this.bc || !this.strict) { this.joined = !!this.bc; cb?.("SUBSCRIBED"); } }, this.strict ? 150 : 5);
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
    this.bc?.close(); this.bc = null; this.mine = null; this.joined = false;
    open.delete(this);
  }
  _rx(d) {
    if (d.k === "bc") return this._emit("broadcast", d.event, { payload: d.payload });
    if (d.k === "who") { if (this.mine) this.bc.postMessage({ k: "here", key: this.key, meta: this.mine }); return; }
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
  // a row change from the "database" (supabase.js): to this channel's
  // postgres_changes listeners for that table, while it's subscribed
  _pg(table, eventType, row) {
    if (!this.bc) return;
    for (const h of this.handlers) if (h.type === "postgres_changes" && (!h.table || h.table === table) && (h.event === "*" || h.event === eventType)) {
      try { h.cb({ schema: "public", table, eventType, new: { ...row }, old: {} }); } catch (e) { console.warn("[sbstub]", e); }
    }
  }
}


window.addEventListener("pagehide", () => { for (const ch of [...open]) ch.close(); });
