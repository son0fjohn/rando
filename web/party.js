// Rando house parties (MVP slice — placeholder visuals, real logic).
//
// A party is a player-hosted Room (net.js) with extra metadata — vibe,
// public/private, player cap — announced to the directory so nearby players
// see "[host] is throwing a [vibe] house party" (list + world beacon) and can
// tap to join. Joining is gated by the same on-device GPS proximity pattern
// the NPC quests and meetup confirm use (readDeviceCoords + haversine): the
// host's coordinates ride on the announcement, the joiner compares locally,
// and only the pass/fail decides anything. ?devparty=1 (or ?devnpc=1)
// bypasses the gate for desk testing.
//
// From inside the party the host picks how the game gets chosen — random
// spinner, direct pick, or a binding group vote — over the party's vibe
// catalog (artgallery.js). The chosen game runs on the shared HostGame kit.
import { Room, directory, mulberry, fmtClock } from "./net.js";
import { world3d } from "./world3d.js";
import { beacon, sfx, buzz } from "./fx.js";
import { rooms } from "./rooms.js";
import { readDeviceCoords, presence } from "./backend.js";
import { PARTY_CATALOG, partyGames } from "./artgallery.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const VIBES = ["chill", "chaotic", "sporty"];
const RANGE_M = 150;                 // venue-scale, same as archQuests.RANGE_M
const GATE_BY_GPS = true;
const DEV_BYPASS = params.get("devparty") === "1" || params.get("devnpc") === "1";
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));   // dev: bots count toward the player minimum
const MIN_PLAYERS = 3;
const VOTE_MS = 20000, SPIN_MS = 2500;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PARTY_COLOR = 0xff8c42;

function makeCode() { let c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
function seededPick(arr, seed) { const rng = mulberry(seed); return arr[Math.floor(rng() * arr.length)]; }
const gameTitle = id => PARTY_CATALOG.find(g => g.id === id)?.title ?? id;

export const party = {
  get me() { return rooms.me; },
  current: null,      // { room, meta, launched, sel, votes, chat }
  nearby: [],
  form: { vibe: "chill", privacy: "public", cap: 6 },
  _view: null,
  _tick: null,
  _spin: null,
  _beacons: new Set(),
  _inited: false,

  init() {
    directory.start();
    directory.onChange(list => {
      this.nearby = list.filter(r => r.kind === "party");
      this.syncBeacons();
      if (!this.current) this._renderList();
    });
    $("party-btn").addEventListener("click", () => this.togglePanel());
    // one lobby at a time: joining a room/raid drops the party and vice versa
    rooms.onBeforeJoin = () => this.leave();
    clearInterval(this._tick);
    this._tick = setInterval(() => this.tick(), 300);
    this.render();
  },

  // ---------------------------------------------------------------- location gate
  async locate() {
    if (!GATE_BY_GPS || DEV_BYPASS) return null;
    try { return await readDeviceCoords(); }
    catch { throw new Error("location is needed for house parties — allow location access and try again"); }
  },
  async checkNear(ann) {
    let coords;
    try { coords = await this.locate(); } catch (e) { return e.message; }
    if (!coords) return true;                       // dev bypass
    if (ann.lat == null || ann.lng == null) return "the host has no location on record, so you can't be verified as nearby";
    const d = presence.haversine(coords.lat, coords.lng, ann.lat, ann.lng);
    if (d > RANGE_M) return `you're ~${Math.round(d)} m from ${ann.hostName} — get within ${RANGE_M} m to join`;
    return true;
  },

  // ---------------------------------------------------------------- host / join / leave
  async create() {
    const { vibe, privacy } = this.form;
    const cap = Math.max(MIN_PLAYERS, Math.min(12, +this.form.cap || 6));
    this.err("");
    let coords = null;
    try { coords = await this.locate(); } catch (e) { this.err(e.message); return; }
    await rooms.leave(); await this.leave();
    const code = makeCode();
    const room = new Room(`party-${code}`, this.me);
    this.current = {
      room, launched: false, sel: null, votes: {}, chat: [],
      meta: { vibe, privacy, cap, code, hostId: this.me.id, hostName: this.me.handle, lat: coords?.lat ?? null, lng: coords?.lng ?? null },
    };
    this._wire(room);
    try { await room.join(); }
    catch (e) { this.current = null; this.err("couldn't open the party: " + e.message); return; }
    this._announce();
    sfx.open(); buzz([30, 40, 30]);
    this.render();
  },

  async join(id) {
    this.err("");
    const ann = directory.rooms.get(id);
    if (!ann || ann.kind !== "party") { this.err("that party isn't open right now"); return; }
    if (ann.count >= ann.cap) { this.err("that party is full"); return; }
    if (ann.state === "playing") { this.err("they're mid-game — try again when the round ends"); return; }
    const near = await this.checkNear(ann);
    if (near !== true) { this.err(near); return; }
    await rooms.leave(); await this.leave();
    const room = new Room(id, this.me);
    this.current = {
      room, launched: false, sel: null, votes: {}, chat: [],
      meta: { vibe: ann.vibe, privacy: ann.privacy, cap: ann.cap, code: id.slice(6), hostId: ann.hostId, hostName: ann.hostName, lat: ann.lat, lng: ann.lng },
    };
    this._wire(room);
    try { await room.join(); }
    catch (e) { this.current = null; this.err("couldn't join: " + e.message); return; }
    sfx.ping();
    this.render();
  },
  joinByCode(code) {
    code = String(code || "").trim().toUpperCase();
    if (code.length !== 4) { this.err("codes are 4 characters"); return; }
    return this.join(`party-${code}`);
  },

  async leave() {
    const c = this.current;
    if (!c) return;
    directory.stopAnnouncing(c.room.id);
    c.room.leave();
    this.current = null;
    clearInterval(this._spin); this._spin = null;
    this.render();
  },

  _announce() {
    const c = this.current;
    directory.announce(() => {
      const p = world3d.player?.api.group.position;
      return {
        id: c.room.id, kind: "party", hostId: this.me.id, hostName: this.me.handle,
        vibe: c.meta.vibe, privacy: c.meta.privacy, cap: c.meta.cap, count: c.room.members.length,
        state: c.launched ? "playing" : "lobby", lat: c.meta.lat, lng: c.meta.lng,
        x: p ? +p.x.toFixed(1) : undefined, y: p ? +p.y.toFixed(1) : 0, z: p ? +p.z.toFixed(1) : undefined,
      };
    });
  },

  _wire(room) {
    const c = this.current;
    room.onPresence = () => {
      if (this.current !== c) return;
      if (room.isHost) {
        c.meta.hostId = this.me.id; c.meta.hostName = this.me.handle;
        if (!directory.announcing) this._announce();
        this._enforceCap();
      } else if (directory.announcing) directory.stopAnnouncing();
      this.render();
    };
    room.on("chat", m => { c.chat.push({ who: room.presence[m.from]?.handle ?? "someone", text: m.text }); c.chat = c.chat.slice(-40); this.renderChat(); });
    room.on("sel", m => this._onSel(m));
    room.on("vote", m => { if (c.sel?.mode === "vote" && !c.sel.result && c.sel.shortlist.includes(m.game)) { c.votes[m.from] = m.game; this._renderSel(); } });
    room.on("selres", m => { if (!c.sel) return; c.sel.result = m.game; c.sel.counts = m.counts; this._renderSel(); sfx.ping(); });
    room.on("launch", m => this._onLaunch(m));
    room.on("full", m => { if (m.id === this.me.id) { this.leave(); this.err(`that party is full (cap ${m.cap})`); } });
  },
  // host: anyone past the cap (by join order) is told to leave
  _enforceCap() {
    const c = this.current;
    const over = c.room.members.slice(c.meta.cap);
    for (const m of over) c.room.send("full", { id: m.id, cap: c.meta.cap });
  },

  // ---------------------------------------------------------------- game selection
  playerCount() { return (this.current?.room.members.length ?? 0) + BOTS_N; },
  openSel(mode) {
    const c = this.current;
    if (!c || !c.room.isHost || c.launched || c.sel) return;
    if (this.playerCount() < MIN_PLAYERS) { this.err(`needs ${MIN_PLAYERS}+ players`); return; }
    const games = partyGames(c.meta.vibe).map(g => g.id);
    if (!games.length) { this.err(`no games in the ${c.meta.vibe} catalog yet`); return; }
    const seed = (Date.now() % 1e9) | 0;
    if (mode === "direct") c.room.send("sel", { mode, shortlist: games, seed });
    else if (mode === "random") c.room.send("sel", { mode, shortlist: games, seed, endsAt: Date.now() + SPIN_MS });
    else if (mode === "vote") c.room.send("sel", { mode, shortlist: games.slice(0, 3), seed, endsAt: Date.now() + VOTE_MS });
  },
  cancelSel() {
    const c = this.current;
    if (!c || !c.room.isHost || !c.sel || c.sel.result) return;
    c.room.send("sel", { mode: null });
  },
  _onSel(m) {
    const c = this.current; if (!c || c.launched) return;
    clearInterval(this._spin); this._spin = null;
    c.votes = {};
    if (!m.mode) { c.sel = null; this._renderSel(); return; }
    c.sel = { mode: m.mode, shortlist: m.shortlist, seed: m.seed, endsAt: m.endsAt, result: null, counts: null, fired: false };
    if (m.mode === "random") { c.sel.result = seededPick(m.shortlist, m.seed); this._spinStart(); }
    sfx.pop();
    this._renderSel();
  },
  vote(gameId) {
    const c = this.current;
    if (!c?.sel || c.sel.mode !== "vote" || c.sel.result) return;
    c.room.send("vote", { game: gameId });
  },
  _resolveVote() {
    const c = this.current;
    const counts = {};
    for (const g of c.sel.shortlist) counts[g] = 0;
    for (const g of Object.values(c.votes)) if (counts[g] !== undefined) counts[g]++;
    const max = Math.max(...Object.values(counts));
    const tied = c.sel.shortlist.filter(g => counts[g] === max);
    const result = seededPick(tied, c.sel.seed);      // ties break deterministically, still binding
    c.sel.result = result;
    c.room.send("selres", { game: result, counts });
    setTimeout(() => { if (this.current === c && !c.launched) this.launch(result); }, 1500);
  },
  launch(gameId) {
    const c = this.current;
    if (!c || !c.room.isHost || c.launched) return;
    c.room.send("launch", { game: gameId, seed: c.sel?.seed ?? ((Date.now() % 1e9) | 0), at: Date.now() + 800 });
  },
  _spinStart() {
    const c = this.current;
    const names = c.sel.shortlist.map(gameTitle);
    let i = 0;
    clearInterval(this._spin);
    this._spin = setInterval(() => {
      const el = $("pt-spin"); if (!el) return;
      if (Date.now() < c.sel.endsAt) el.textContent = `[spinner] ${names[i++ % names.length]}`;
      else { el.textContent = `→ ${gameTitle(c.sel.result)}!`; clearInterval(this._spin); this._spin = null; }
    }, 90);
  },
  // 300 ms: countdowns for everyone; the host resolves timed selections
  tick() {
    const c = this.current;
    if (!c || !c.sel || c.launched) return;
    const left = (c.sel.endsAt ?? 0) - Date.now();
    const cd = $("pt-cd"); if (cd) cd.textContent = fmtClock(left);
    if (!c.room.isHost) return;
    if (c.sel.mode === "random" && !c.sel.fired && left <= -600) { c.sel.fired = true; this.launch(c.sel.result); }
    if (c.sel.mode === "vote" && !c.sel.result) {
      const all = c.room.members.every(m => c.votes[m.id]);
      if (left <= 0 || all) this._resolveVote();
    }
  },

  // ---------------------------------------------------------------- launch / end
  _onLaunch(m) {
    const c = this.current;
    if (!c || c.launched) return;
    const g = PARTY_CATALOG.find(x => x.id === m.game);
    if (!g) { this.err(`unknown game "${m.game}"`); return; }
    c.launched = true; c.sel = null; c.votes = {};
    clearInterval(this._spin); this._spin = null;
    $("party-panel").hidden = true;
    const humans = c.room.members.map(x => ({ id: x.id, handle: x.handle, avatar: x.avatar }));
    const ctx = {
      room: c.room, me: this.me, humans, seed: m.seed, isHost: () => c.room.isHost, party: c.meta,
      onEnd: () => this._onGameEnd(c),
    };
    g.start(ctx);
    if (c.room.isHost) this._announce();
  },
  _onGameEnd(c) {
    if (this.current !== c) return;
    c.launched = false;
    $("party-panel").hidden = false;
    this.render();
    if (c.room.isHost) this._announce();
  },

  // ---------------------------------------------------------------- world beacons
  syncBeacons() {
    const seen = new Set();
    for (const r of this.nearby) {
      if (r.privacy !== "public" || r.x === undefined) continue;
      seen.add(r.id);
      beacon.set(`party-${r.id}`, { x: r.x, y: r.y ?? 0, z: r.z }, {
        count: r.count, color: PARTY_COLOR, live: r.state === "playing",
        label: `${r.hostName} is throwing a ${r.vibe} house party · ${r.count}/${r.cap}`,
      });
    }
    for (const id of this._beacons) if (!seen.has(id)) beacon.clear(`party-${id}`);
    this._beacons = seen;
  },

  // ---------------------------------------------------------------- UI
  togglePanel(force) {
    const p = $("party-panel");
    p.hidden = force === undefined ? !p.hidden : !force;
    if (!p.hidden) this.render();
  },
  err(msg) { const el = $("pt-err"); if (el) el.textContent = msg || ""; if (msg) $("party-panel").hidden = false; },

  render() {
    const p = $("party-panel"); if (!p) return;
    const c = this.current;
    const view = c ? `in:${c.room.id}` : "out";
    if (this._view !== view) { this._view = view; p.innerHTML = c ? this._inHtml() : this._outHtml(); this._bind(); }
    if (c) { this._renderHead(); this._renderMembers(); this._renderSel(); this.renderChat(); }
    else this._renderList();
  },

  _outHtml() {
    const f = this.form;
    return `<div class="rp-head"><b>House party</b><button id="pt-close" type="button" aria-label="Close">&#10005;</button></div>
      <div class="pt-sec"><div class="rl-h">Throw a house party</div>
        <div class="pt-lbl">vibe (decides which games are on the table)</div>
        <div class="pt-row" id="pt-vibe">${VIBES.map(v => `<button type="button" class="pt-btn ${f.vibe === v ? "on" : ""}" data-vibe="${v}">${v}</button>`).join("")}</div>
        <div class="pt-lbl">who can join</div>
        <div class="pt-row" id="pt-priv">
          <button type="button" class="pt-btn ${f.privacy === "public" ? "on" : ""}" data-priv="public">public · anyone nearby</button>
          <button type="button" class="pt-btn ${f.privacy === "private" ? "on" : ""}" data-priv="private">private · code only</button>
        </div>
        <div class="pt-lbl">player cap</div>
        <div class="pt-row"><input id="pt-cap" type="number" min="${MIN_PLAYERS}" max="12" value="${f.cap}"></div>
        <button id="pt-create" class="pt-btn pt-primary" type="button">throw the party</button>
        <div id="pt-err" class="pt-err"></div>
      </div>
      <div class="pt-sec"><div class="rl-h">Parties nearby</div><div id="pt-list"></div></div>
      <div class="pt-sec"><div class="rl-h">Got an invite code?</div>
        <form id="pt-code-form" class="pt-row"><input id="pt-code" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off"><button type="submit" class="pt-btn">join</button></form>
      </div>`;
  },
  _inHtml() {
    return `<div class="rp-head"><b id="pt-title">party</b><button id="pt-leave" type="button">leave</button></div>
      <div id="pt-sub" class="rp-sub"></div>
      <div id="pt-members" class="pt-row"></div>
      <div id="pt-sel" class="pt-sec"></div>
      <div id="pt-err" class="pt-err"></div>
      <div class="pt-sec">
        <div id="pt-chat-feed"></div>
        <form id="pt-chat-form"><input id="pt-chat-input" maxlength="160" placeholder="say something&hellip;" autocomplete="off"><button type="submit">&#8593;</button></form>
      </div>`;
  },
  _bind() {
    const p = $("party-panel");
    p.querySelector("#pt-close")?.addEventListener("click", () => this.togglePanel(false));
    p.querySelector("#pt-leave")?.addEventListener("click", () => this.leave());
    p.querySelectorAll("[data-vibe]").forEach(b => b.onclick = () => { this.form.vibe = b.dataset.vibe; p.querySelectorAll("[data-vibe]").forEach(x => x.classList.toggle("on", x === b)); });
    p.querySelectorAll("[data-priv]").forEach(b => b.onclick = () => { this.form.privacy = b.dataset.priv; p.querySelectorAll("[data-priv]").forEach(x => x.classList.toggle("on", x === b)); });
    p.querySelector("#pt-cap")?.addEventListener("change", e => { this.form.cap = +e.target.value; });
    p.querySelector("#pt-create")?.addEventListener("click", () => { this.form.cap = +($("pt-cap").value || 6); this.create(); });
    p.querySelector("#pt-code-form")?.addEventListener("submit", e => { e.preventDefault(); this.joinByCode($("pt-code").value); });
    p.querySelector("#pt-chat-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const inp = $("pt-chat-input"), text = inp.value.trim().slice(0, 160);
      if (text && this.current) { this.current.room.send("chat", { text }); inp.value = ""; }
    });
  },

  _renderList() {
    const el = $("pt-list"); if (!el) return;
    const pub = this.nearby.filter(r => r.privacy === "public");
    // the directory pings every 2.5 s; only touch the DOM when the list changed
    const sig = pub.map(r => `${r.id}:${r.hostName}:${r.vibe}:${r.count}/${r.cap}:${r.state}`).join("|");
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    if (!pub.length) { el.innerHTML = `<div class="pt-empty">none right now</div>`; return; }
    el.innerHTML = pub.map(r => `<div class="rl-row"><div class="rl-dot pt-dot"></div><div><b>${esc(r.hostName)} is throwing a ${esc(r.vibe)} house party</b><span>${r.count}/${r.cap} in · ${r.state}</span></div><button type="button" data-join="${esc(r.id)}" ${r.count >= r.cap || r.state === "playing" ? "disabled" : ""}>join</button></div>`).join("");
    el.querySelectorAll("button[data-join]").forEach(b => b.onclick = () => this.join(b.dataset.join));
  },
  _renderHead() {
    const c = this.current;
    const host = c.room.presence[c.room.hostId]?.handle ?? c.meta.hostName;
    $("pt-title").textContent = `${host}'s ${c.meta.vibe} house party`;
    $("pt-sub").textContent = `${c.meta.privacy} · code ${c.meta.code} · ${c.room.members.length}/${c.meta.cap} players${BOTS_N ? ` (+${BOTS_N} bots)` : ""}`;
  },
  _renderMembers() {
    const c = this.current;
    $("pt-members").innerHTML = c.room.members.map(m => `<span class="rm ${m.id === c.room.hostId ? "host" : ""}">${esc(m.handle)}${m.id === c.room.hostId ? " ★" : ""}</span>`).join("");
  },
  _renderSel() {
    const c = this.current; const el = $("pt-sel"); if (!c || !el) return;
    const isHost = c.room.isHost, host = c.room.presence[c.room.hostId]?.handle ?? "the host";
    const n = this.playerCount(), ok = n >= MIN_PLAYERS;
    const games = partyGames(c.meta.vibe);
    let h;
    if (!c.sel) {
      h = isHost
        ? `<div class="rl-h">Start a game</div><div class="pt-row">
             <button type="button" class="pt-btn" data-mode="random" ${ok ? "" : "disabled"}>random spin</button>
             <button type="button" class="pt-btn" data-mode="direct" ${ok ? "" : "disabled"}>pick one</button>
             <button type="button" class="pt-btn" data-mode="vote" ${ok ? "" : "disabled"}>group vote</button></div>
           <div class="pt-note">${ok ? `${games.length} game${games.length === 1 ? "" : "s"} in the ${c.meta.vibe} catalog: ${games.map(g => g.title).join(", ")}` : `needs ${MIN_PLAYERS}+ players · ${n} here`}</div>`
        : `<div class="pt-note">waiting for ${esc(host)} to start a game · ${n} here</div>`;
    } else if (c.sel.mode === "direct") {
      h = isHost
        ? `<div class="rl-h">Pick a game</div><div class="pt-row">${c.sel.shortlist.map(id => `<button type="button" class="pt-btn" data-launch="${id}">${esc(gameTitle(id))}</button>`).join("")}</div><button type="button" class="pt-btn" data-cancel>back</button>`
        : `<div class="pt-note">${esc(host)} is picking a game…</div>`;
    } else if (c.sel.mode === "random") {
      h = `<div class="rl-h">Random spin</div><div class="pt-box" id="pt-spin">[spinner]</div><div class="pt-note">catalog: ${c.sel.shortlist.map(gameTitle).join(", ")}</div>`;
    } else if (c.sel.mode === "vote") {
      const counts = {}; for (const g of Object.values(c.votes)) counts[g] = (counts[g] || 0) + 1;
      const mine = c.votes[this.me.id];
      const done = !!c.sel.result;
      h = `<div class="rl-h">Group vote · <span id="pt-cd">${fmtClock((c.sel.endsAt ?? 0) - Date.now())}</span></div>
        <div class="pt-row">${c.sel.shortlist.map(id => `<button type="button" class="pt-btn ${mine === id ? "on" : ""} ${done && c.sel.result === id ? "win" : ""}" data-vote="${id}" ${done ? "disabled" : ""}>${esc(gameTitle(id))} · ${(done ? c.sel.counts?.[id] : counts[id]) || 0}</button>`).join("")}</div>
        <div class="pt-note">${done ? `the room picked ${esc(gameTitle(c.sel.result))} — starting` : `${Object.keys(c.votes).length}/${c.room.members.length} voted · result is binding`}</div>
        ${isHost && !done ? `<button type="button" class="pt-btn" data-cancel>cancel vote</button>` : ""}`;
    }
    el.innerHTML = h;
    el.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => this.openSel(b.dataset.mode));
    el.querySelectorAll("[data-launch]").forEach(b => b.onclick = () => this.launch(b.dataset.launch));
    el.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => this.vote(b.dataset.vote));
    el.querySelectorAll("[data-cancel]").forEach(b => b.onclick = () => this.cancelSel());
  },
  renderChat() {
    const c = this.current; const feed = $("pt-chat-feed"); if (!c || !feed) return;
    feed.innerHTML = c.chat.map(l => `<div class="lc-msg"><b>${esc(l.who)}</b>${esc(l.text)}</div>`).join("");
    feed.scrollTop = feed.scrollHeight;
  },
};
