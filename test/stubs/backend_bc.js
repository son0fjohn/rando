// Test stub for web/backend.js that makes multiplayer REAL across browser
// tabs: a Supabase-Realtime-shaped `sb` whose channels ride on
// BroadcastChannel, so several Playwright pages in one browser context form
// an actual party — real party.js, real net.js Room, real DOM and CSS.
//
// Mirrors the surface net.js uses: channel(name, config).on("broadcast" |
// "presence", …).subscribe(cb) / track(meta) / presenceState() / send(),
// and sb.removeChannel(ch). Presence is gossip: on join you announce
// yourself, everyone already there answers with their own meta, and leave
// (explicit or on pagehide) removes you everywhere.
const open = new Set();

class StubChannel {
  constructor(name, cfg) {
    this.name = name;
    this.cfg = cfg?.config ?? {};
    this.key = this.cfg.presence?.key ?? null;
    this.handlers = [];
    this.state = {};
    this.mine = null;
    this.bc = null;
  }
  on(type, filter, cb) { this.handlers.push({ type, event: filter?.event, cb }); return this; }
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


// the prompt logger inserts here. Rows land on window.__logRows; set
// window.__logFail = true to simulate the table not existing yet.
const from = () => ({
  insert: async rows => {
    if (window.__logFail) return { error: { message: "relation \"diary_prompt_log\" does not exist" } };
    (window.__logRows ??= []).push(...rows);
    return { error: null };
  },
});
export const sb = {
  from,
  channel: (name, cfg) => new StubChannel(name, cfg),
  removeChannel: ch => ch.close(),
};
window.addEventListener("pagehide", () => { for (const ch of [...open]) ch.close(); });

export async function readDeviceCoords() { return { lat: 0, lng: 0 }; }
export const presence = {
  haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = d => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },
  zones: [], myZone: null,
};
