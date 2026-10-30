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
  on(type, filter, cb) { this.handlers.push({ type, event: filter?.event, table: filter?.table, cb }); return this; }
  subscribe(cb) {
    this.bc = new BroadcastChannel(`sbstub:${this.name}`);
    this.bc.onmessage = e => this._rx(e.data);
    // postgres_changes: a table's inserts (pgNotify below), like Realtime's
    this.pg = [...new Set(this.handlers.filter(h => h.type === "postgres_changes" && h.table).map(h => h.table))].map(table => {
      const bc = new BroadcastChannel(`sbstub:pg:${table}`);
      bc.onmessage = e => { for (const h of this.handlers) if (h.type === "postgres_changes" && h.table === table && (!h.event || h.event === "*" || h.event === e.data.type)) { try { h.cb({ eventType: e.data.type, table, new: e.data.row, old: e.data.old ?? {} }); } catch (x) { console.warn("[sbstub]", x); } } };
      return bc;
    });
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
    for (const bc of this.pg ?? []) bc.close();
    this.pg = [];
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


// a row written to a table: every channel listening for its postgres_changes
// hears it (this page's too, as Realtime sends your own inserts back)
export function pgNotify(table, type, row) {
  const bc = new BroadcastChannel(`sbstub:pg:${table}`);
  bc.postMessage({ type, row });
  setTimeout(() => bc.close(), 50);
}

window.addEventListener("pagehide", () => { for (const ch of [...open]) ch.close(); });
