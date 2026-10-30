// The multiplayer suite's world: one browser, one context per phone (its own
// guest session, storage, geolocation), the real app page on each.
//
// Offline (the default): test/appserve.mjs serves the REAL app as /app.html
// with Supabase faked in memory (test/stubs/supabase.js). Realtime channels
// ride on BroadcastChannel, which only spans one context, so this relays
// every "sbstub:" message between contexts (as test/leave_rec.mjs does), and
// the tables everyone shares (presence, world chat, profiles, notes, coins)
// live here in the runner behind window.__mpdb (test/stubs/mpshared.js): one
// fake server for every phone.
//
// Against a deployment (BASE_URL / --base): the phones are real guests on
// that deployment's Supabase (anonymous sign-in, as a person opening the
// link), nothing is relayed or faked.
//
// A dropped connection: offline, the phone's relay and server calls are cut
// and, after `presenceTimeoutMs` (Realtime noticing a dead socket), the
// others hear its presence leave; on a deployment, the context goes offline
// and its sockets go silent (no close frame), so the server times it out.
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export class NotImplemented extends Error { constructor(m) { super(`not implemented: ${m}`); this.notImplemented = true; } }
export class Fail extends Error {}

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
// spots (lat, lng). NEAR: one Itaewon block by the station, on a street
// (notes can't be left on a home); a phone each a few metres apart.
export const SPOT = { lat: 37.5347, lng: 126.9945 };
export const offset = (p, north, east) => ({ lat: p.lat + north / 110540, lng: p.lng + east / (111320 * Math.cos(p.lat * Math.PI / 180)) });
export const distM = (a, b) => { const R = 6371000, r = d => d * Math.PI / 180; const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
export const GANGNAM = { lat: 37.4979, lng: 127.0276 };      // ~8 km away: another area entirely
export const NAMES = ["ana", "ben", "cy", "dee", "eli", "fay", "gus", "hal"];

export class World {
  constructor(o) {
    Object.assign(this, { fps: 8, video: false, presenceTimeoutMs: 60000, viewport: { width: 390, height: 844 } }, o);
    this.phones = [];
    this.state = { coins: null, tables: {} };      // the one fake server (offline)
    this.version = 0;
    this.log = o.log ?? (() => {});
  }
  static async create(o) {
    const w = new World(o);
    w.browser = await chromium.launch({
      executablePath: existsSync(CHROME) ? CHROME : undefined,
      args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
    });
    return w;
  }

  async phone(name, { at = SPOT, tag = "" } = {}) {
    const ctx = await this.browser.newContext({
      viewport: this.viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: "en-US",
      geolocation: { latitude: at.lat, longitude: at.lng, accuracy: 10 }, permissions: ["geolocation"],
      ...(this.video ? { recordVideo: { dir: join(this.out, "video-tmp"), size: { width: 390, height: 844 } } } : {}),
    });
    const ph = new Phone(this, ctx, name, at);
    ctx.__phone = ph;
    await ctx.addInitScript(({ fps }) => {
      window.__RANDO_E2E = true;
      try { localStorage.setItem("rando-lang", "en"); localStorage.setItem("rando-hint-v1", "1"); } catch {}
      // the app's own slow-phone mode from the start (lite glass: no live blur behind the panels, fewer frames)
      globalThis.__sceneryForceSlow = true;
      // a software-GL phone draws at `fps`: eight live 3D maps on a few CPU cores otherwise starve each other
      window.__mpFps = fps;      // (the runner can change it on the fly)
      if (fps > 0) {
        const raf0 = window.requestAnimationFrame.bind(window);
        let batch = new Map(), id = 0, armed = false;
        window.requestAnimationFrame = cb => {
          const i = ++id; batch.set(i, cb);
          if (!armed) { armed = true; setTimeout(() => raf0(ts => { armed = false; const b = batch; batch = new Map(); for (const f of b.values()) { try { f(ts); } catch (e) { setTimeout(() => { throw e; }); } } }), Math.max(0, 1000 / (window.__mpFps || 60) - 16)); }
          return i;
        };
        window.cancelAnimationFrame = i => { batch.delete(i); };
      }
      // the network can drop (a deployment run): sockets go silent, no close frame
      window.__mpNet = { down: false };
      const WS = window.WebSocket;
      if (WS) window.WebSocket = class extends WS {
        constructor(...a) { super(...a); this.addEventListener("message", e => { if (window.__mpNet.down) e.stopImmediatePropagation(); }); }
        send(d) { if (!window.__mpNet.down) super.send(d); }
      };
      // offline: every realtime message also goes to the runner, which hands it to the other phones
      const post = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (d) {
        post.call(this, d);
        if (!this.__relayed && this.name.startsWith("sbstub:") && window.__relay) window.__relay(this.name, d);
      };
    }, { fps: this.fps });
    if (this.offline) {
      await ctx.exposeBinding("__relay", (_src, name, d) => this._relay(ph, name, d));
      // the one fake server: read the state at a version; a write lands only on the version it read
      await ctx.exposeBinding("__mpdb", (_src, op, arg) => {
        if (ph.dropped) return { offline: true };
        const st = (this.stats ??= { reads: 0, writes: 0, conflicts: 0 });
        if (op === "get") { st.reads++; return { version: this.version, state: this.state }; }
        if (op === "put") {
          if (arg?.version !== this.version) { st.conflicts++; return { ok: false }; }
          this.state = arg.state; this.version++; st.writes++;
          return { ok: true };
        }
        return {};
      });
    }
    this.phones.push(ph);
    return ph;
  }

  _relay(from, name, d) {
    if (from.dropped) return;
    // remember which presence keys this phone holds on which channel (a drop: the server times them out)
    if (d && (d.k === "join" || d.k === "here") && d.key) (from.presenceKeys[name] ??= new Set()).add(d.key);
    if (d && d.k === "leave" && d.key) from.presenceKeys[name]?.delete(d.key);
    for (const ph of this.phones) if (ph !== from && !ph.dropped && !ph.closed) ph._deliver(name, d);
  }

  // a phone loses its connection (no goodbye)
  async drop(ph) {
    ph.dropped = true;
    ph.droppedAt = Date.now();
    if (!this.offline) {
      await ph.page.evaluate(() => { window.__mpNet.down = true; }).catch(() => {});
      await ph.ctx.setOffline(true).catch(() => {});
      return;
    }
    const keys = Object.entries(ph.presenceKeys).flatMap(([name, set]) => [...set].map(key => ({ name, key })));
    ph._dropTimer = setTimeout(() => {
      for (const { name, key } of keys) for (const o of this.phones) if (o !== ph && !o.dropped && !o.closed) o._deliver(name, { k: "leave", key });
    }, this.presenceTimeoutMs);
  }

  async close() {
    for (const ph of this.phones) clearTimeout(ph._dropTimer);
    for (const ph of this.phones) await ph.ctx.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}

export class Phone {
  constructor(world, ctx, name, at) {
    Object.assign(this, { world, ctx, name, at, page: null, dropped: false, closed: false, presenceKeys: {}, console: [], errors: [] });
  }
  get label() { return this.name; }
  _deliver(name, d) {
    if (!this.page || this.page.isClosed()) return;
    this.page.evaluate(([name, d]) => { const bc = new BroadcastChannel(name); bc.__relayed = true; bc.postMessage(d); setTimeout(() => bc.close(), 50); }, [name, d]).catch(() => {});
  }
  async open(url) {
    if (!this.page) {
      this.page = await this.ctx.newPage();
      this.page.on("pageerror", e => { this.errors.push(e.message); this.console.push(`[pageerror] ${e.message}`); });
      this.page.on("console", m => { const t = m.text(); if (this.console.length < 4000) this.console.push(`[${m.type()}] ${t.slice(0, 400)}`); });
      this.page.on("dialog", d => { this.console.push(`[dialog] ${d.message()}`); d.accept().catch(() => {}); });
    }
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    return this;
  }
  // in the page: fn(arg) with window.__rando as R
  // (a frozen or wedged page never answers: give up after `ms`)
  r(fn, arg, ms = 120000) {
    let to;
    return Promise.race([
      this.page.evaluate(`(async () => { const R = window.__rando; const arg = ${JSON.stringify(arg ?? null)}; return (${fn.toString()})(R, arg); })()`),
      new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`${this.name}: no answer in ${ms / 1000} s`)), ms); }),
    ]).finally(() => clearTimeout(to));
  }
  async until(fn, arg = null, ms = 30000, poll = 300) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < ms) {
      try { last = await this.r(fn, arg); if (last) return last; } catch (e) { last = e.message; }
      await sleep(poll);
    }
    return false;
  }
  tap(sel) { return this.page.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel); }
  // (straight from CDP: page.screenshot waits on fonts / a stable frame, which software GL here can hold up for minutes)
  async shot(file) {
    try {
      const cdp = await this.ctx.newCDPSession(this.page);
      const r = await Promise.race([cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 70 }), sleep(60000).then(() => null)]);
      await cdp.detach().catch(() => {});
      if (r) { await writeFile(file, Buffer.from(r.data, "base64")); return true; }
    } catch {}
    return false;
  }
  // the app is closed (swiped away): its socket closes, so the server drops its presence at once
  async close() {
    this.closed = true;
    await this.page?.close().catch(() => {});
    if (this.world.offline) for (const [name, set] of Object.entries(this.presenceKeys)) for (const key of set)
      for (const o of this.world.phones) if (o !== this && !o.dropped && !o.closed) o._deliver(name, { k: "leave", key });
  }
}

// a run's output: per failure, every phone's screen + console + the test's log (+ videos)
export async function saveArtifacts(world, dir, { log = [], why = "" } = {}) {
  await mkdir(dir, { recursive: true });
  for (const ph of world.phones) {
    if (ph.page && !ph.page.isClosed()) await ph.shot(join(dir, `${ph.name}.jpg`));
    let state = null;
    try { state = ph.page && !ph.page.isClosed() ? await Promise.race([ph.page.evaluate(() => { const R = window.__rando; if (!R) return { noHooks: true, url: location.href }; return { url: location.href, me: R.me(), screen: R.screen(), visible: R.world.visible(), remotes: R.world.remotes(), party: R.party(), game: R.game(), chat: R.chat.lines().slice(-12) }; }), sleep(45000).then(() => "timed out")]) : "closed"; } catch (e) { state = String(e.message); }
    await writeFile(join(dir, `${ph.name}.log.txt`), [`phone ${ph.name} at ${JSON.stringify(ph.at)}${ph.dropped ? " (dropped)" : ""}`, `state: ${JSON.stringify(state, null, 1)}`, "", "--- console (last 300)", ...ph.console.slice(-300)].join("\n"));
  }
  await writeFile(join(dir, "trace.txt"), [`why: ${why}`, `fake server: ${JSON.stringify(world.stats ?? null)}`, "", ...log].join("\n"));
}
export async function keepVideos(world, dir, keep) {
  if (!world.video) return;
  for (const ph of world.phones) {
    const v = ph.page?.video();
    if (!v) continue;
    const p = await v.path().catch(() => null);
    if (!p) continue;
    if (keep) { await mkdir(dir, { recursive: true }); await rename(p, join(dir, `${ph.name}.webm`)).catch(() => {}); }
    else await rm(p, { force: true }).catch(() => {});
  }
}
