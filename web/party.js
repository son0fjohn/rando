// Rando house parties.
//
// A party is a player-hosted Room (net.js) with metadata: a name, a vibe
// label, and a player cap. Players join by 4-character code or by link
// (?party=CODE). There is NO proximity check this pass — anyone with the code
// is in, from anywhere.
//
// Inside, the party is a full-screen 2D room (hplobby.js): everyone walks
// around the vibe's generated backdrop while the lobby fills up, and comes
// back to it between games. The vibe (chill / chaotic / sporty) is a LABEL
// ONLY: it picks that backdrop and nothing else.
//
// The host picks the next game from a picker overlay they can open and close
// at will. Picking QUEUES the game ("up next") — it doesn't need the player
// minimum to be met yet, so the host can set it up while people arrive. Games
// can declare options (e.g. Today's Mission: quick start vs players choose);
// those are set in the picker and travel with the launch. Start is a separate
// tap, enabled once there are enough players.
//
// Party settings (host-only, in the picker; nobody has to touch them):
//   * 18+ party — off by default. The host turns it on, confirming everyone
//     here is an adult; it's what unlocks "unhinged" content.
//   * Secret Diary max level — defaults to mild for public parties and spicy
//     for private ones; unhinged only with 18+ on.
// Settings, the party's public/private flag and the session's used-prompt set
// ride on the host's `meta` broadcast, so whoever hosts the next game has
// them. Prompts never repeat within a party session (ctx.session).
//
// Public parties — announcing to the shared directory so strangers nearby can
// browse and join — sit behind FLAGS.PUBLIC_PARTIES, which is OFF, so every
// party is private this build.
import { Room, directory, mulberry } from "./net.js";
import { world3d } from "./world3d.js";
import { beacon, sfx, buzz } from "./fx.js";
import { rooms } from "./rooms.js";
import { PARTY_CATALOG, gameById } from "./partycatalog.js";
import { FLAGS, PARTY, DIARY } from "./hpconfig.js";
import { esc, trash } from "./hpkit.js";
import { makeBots, shareText } from "./gamekit.js";
import { LobbyRoom } from "./hplobby.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

export const VIBES = PARTY.VIBES;
const MIN_PLAYERS = PARTY.MIN_PLAYERS;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PARTY_COLOR = 0xff8c42;
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));   // dev: bots count toward the minimum
// vibe -> generated lobby backdrop (web/lobbies/)
const LOBBY_BG = { chill: "lobbies/chill.png", chaotic: "lobbies/chaos.png", sporty: "lobbies/sporty.png" };

function makeCode() { let c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
const inviteLink = code => `${location.origin}${location.pathname}?party=${code}`;
const minFor = g => g?.minPlayers ?? MIN_PLAYERS;
// a game's options with defaults filled in
function defaultsFor(g) {
  const o = {};
  for (const opt of g?.options ?? []) o[opt.key] = opt.default ?? opt.choices?.[0]?.value;
  return o;
}
// per-party-session memory games share across games (e.g. used prompts)
const newSession = () => ({ diaryUsed: new Set() });
function optionsLabel(g, options) {
  return (g?.options ?? []).map(opt => opt.choices.find(c => c.value === options?.[opt.key])?.label).filter(Boolean).join(" · ");
}

export const party = {
  get me() { return rooms.me; },
  current: null,      // { room, meta, launched, chat, queue, lobby }
  nearby: [],
  form: { name: "", vibe: "chill", cap: PARTY.CAP_DEFAULT },
  pickerOpen: false,
  chatOpen: false,
  _view: null,
  _inited: false,

  init() {
    directory.start();
    directory.onChange(list => {
      this.nearby = FLAGS.PUBLIC_PARTIES ? list.filter(r => r.kind === "party") : [];
      this.syncBeacons();
      if (!this.current) this._renderList();
    });
    $("party-btn").addEventListener("click", () => this.togglePanel());
    // one lobby at a time: joining a room/raid drops the party and vice versa
    rooms.onBeforeJoin = () => this.leave();
    this.render();
    // ?party=CODE — join straight from a shared link
    const code = params.get("party");
    if (code) { this.togglePanel(true); setTimeout(() => this.joinByCode(code), 600); }
  },

  // ---------------------------------------------------------------- host / join / leave
  async create() {
    const { vibe } = this.form;
    const cap = Math.max(PARTY.CAP_MIN, Math.min(PARTY.CAP_MAX, +this.form.cap || PARTY.CAP_DEFAULT));
    const name = (this.form.name || "").trim().slice(0, PARTY.NAME_MAX) || `${this.me.handle}'s party`;
    this.err("");
    await rooms.leave(); await this.leave();
    const code = makeCode();
    const room = new Room(`party-${code}`, this.me);
    this.current = {
      room, launched: false, chat: [], queue: null, lobby: null, session: newSession(),
      meta: {
        name, vibe, cap, code, hostId: this.me.id, hostName: this.me.handle,
        privacy: FLAGS.PUBLIC_PARTIES ? "public" : "private",
        settings: { adult: false, diaryMax: null },
      },
    };
    this._wire(room);
    try { await room.join(); }
    catch (e) { this.current = null; this.err("couldn't open the party: " + e.message); return; }
    if (FLAGS.PUBLIC_PARTIES) this._announce();
    sfx.open(); buzz([30, 40, 30]);
    this.render();
  },

  async join(id, meta = null) {
    this.err("");
    const ann = directory.rooms.get(id);
    if (ann) {
      if (ann.count >= ann.cap) { this.err("that party is full"); return; }
      if (ann.state === "playing") { this.err("they're mid-game — try again when the round ends"); return; }
    }
    await rooms.leave(); await this.leave();
    const room = new Room(id, this.me);
    this.current = {
      room, launched: false, chat: [], queue: null, lobby: null, session: newSession(),
      // with no directory entry (code join) we start with placeholders and let
      // the host's `meta` broadcast fill in the real name / vibe / cap
      meta: {
        name: ann?.name ?? meta?.name ?? "house party", vibe: ann?.vibe ?? meta?.vibe ?? "chill",
        cap: ann?.cap ?? meta?.cap ?? PARTY.CAP_MAX, code: id.slice(6),
        hostId: ann?.hostId ?? null, hostName: ann?.hostName ?? "the host",
        privacy: ann?.privacy ?? "private", settings: { adult: false, diaryMax: null },
      },
    };
    this._wire(room);
    try { await room.join(); }
    catch (e) { this.current = null; this.err("couldn't join: " + e.message); return; }
    this.current.room.send("hello", {});       // nudge the host to send meta + queue
    sfx.ping();
    this.render();
  },
  joinByCode(code) {
    code = String(code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { this.err("codes are 4 characters"); return; }
    return this.join(`party-${code}`);
  },

  async leave() {
    const c = this.current;
    if (!c) return;
    directory.stopAnnouncing(c.room.id);
    c.lobby?.destroy();
    c.room.leave();
    this.current = null;
    this.pickerOpen = false; this.chatOpen = false;
    trash.flush("left the party");          // photos + entries die with the party
    this.render();
  },

  _announce() {
    const c = this.current;
    if (!FLAGS.PUBLIC_PARTIES) return;
    directory.announce(() => {
      const p = world3d.player?.api.group.position;
      return {
        id: c.room.id, kind: "party", hostId: this.me.id, hostName: this.me.handle,
        name: c.meta.name, vibe: c.meta.vibe, cap: c.meta.cap, count: c.room.members.length,
        state: c.launched ? "playing" : "lobby",
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
        if (FLAGS.PUBLIC_PARTIES && !directory.announcing) this._announce();
        this._sendMeta();
        this._enforceCap();
      } else {
        if (directory.announcing) directory.stopAnnouncing();
        this.pickerOpen = false;               // only the host has a picker
      }
      this.render();
    };
    room.on("hello", () => { if (room.isHost) this._sendMeta(); });
    room.on("meta", m => {
      if (room.isHost) return;
      c.meta = { ...c.meta, name: m.name, vibe: m.vibe, cap: m.cap, hostName: m.hostName, privacy: m.privacy ?? c.meta.privacy, settings: { ...c.meta.settings, ...(m.settings ?? {}) } };
      c.queue = m.queue ?? null;
      for (const id of m.diaryUsed ?? []) c.session.diaryUsed.add(id);
      this.render();
    });
    // the host's "up next" changed
    // only the host's word counts — a stray message from anyone else is ignored
    room.on("queue", m => { if (m.from !== room.hostId) return; c.queue = m.queue ?? null; this._renderNext(); this._renderPicker(); });
    room.on("chat", m => {
      c.chat.push({ who: room.presence[m.from]?.handle ?? "someone", text: m.text });
      c.chat = c.chat.slice(-40);
      c.lobby?.say(m.from, m.text);
      this.renderChat();
    });
    room.on("launch", m => this._onLaunch(m));
    room.on("full", m => { if (m.id === this.me.id) { this.leave(); this.err(`that party is full (cap ${m.cap})`); } });
  },
  _sendMeta() {
    const c = this.current; if (!c?.room.isHost) return;
    c.room.send("meta", {
      name: c.meta.name, vibe: c.meta.vibe, cap: c.meta.cap, hostName: this.me.handle, queue: c.queue,
      privacy: c.meta.privacy, settings: c.meta.settings, diaryUsed: [...c.session.diaryUsed],
    });
  },
  // host: anyone past the cap (by join order) is told to leave
  _enforceCap() {
    const c = this.current;
    for (const m of c.room.members.slice(c.meta.cap)) c.room.send("full", { id: m.id, cap: c.meta.cap });
  },

  // ---------------------------------------------------------------- queue + launch
  playerCount() { return (this.current?.room.members.length ?? 0) + BOTS_N; },
  // host: put a game up next. Allowed with any number of players — starting
  // it is what needs the minimum, not choosing it.
  queue(gameId, options = null) {
    const c = this.current;
    if (!c || !c.room.isHost) return;
    const g = gameById(gameId);
    if (!g) return;
    const keep = c.queue?.game === gameId ? c.queue.options : null;
    c.queue = { game: gameId, options: { ...defaultsFor(g), ...(keep ?? {}), ...(options ?? {}) } };
    c.room.send("queue", { queue: c.queue });
    sfx.pop();
    this._renderNext(); this._renderPicker();
  },
  setOption(key, value) {
    const c = this.current;
    if (!c?.queue || !c.room.isHost) return;
    this.queue(c.queue.game, { [key]: value });
  },
  clearQueue() {
    const c = this.current;
    if (!c || !c.room.isHost) return;
    c.queue = null;
    c.room.send("queue", { queue: null });
    this._renderNext(); this._renderPicker();
  },
  // host-only party settings. Turning 18+ on asks first.
  setSetting(key, value) {
    const c = this.current;
    if (!c || !c.room.isHost) return;
    if (key === "adult" && value && !window.confirm("Turn on 18+ content?\n\nOnly do this if everyone at this party is 18 or older. It unlocks the 'unhinged' prompts.")) return;
    c.meta.settings = { ...c.meta.settings, [key]: value };
    this._sendMeta();
    sfx.pop();
    this._renderNext(); this._renderPicker();
  },
  launch() {
    const c = this.current;
    if (!c || !c.room.isHost || c.launched || !c.queue) return;
    const g = gameById(c.queue.game);
    if (!g) { this.err(`unknown game "${c.queue.game}"`); return; }
    const n = this.playerCount();
    if (n < minFor(g)) { this.err(`${g.title} needs ${minFor(g)}+ players · ${n} here`); return; }
    this.pickerOpen = false;
    c.room.send("launch", { game: g.id, options: c.queue.options ?? {}, seed: (Date.now() % 1e9) | 0, at: Date.now() + 500 });
  },
  _onLaunch(m) {
    const c = this.current;
    if (!c || c.launched) return;
    const g = gameById(m.game);
    if (!g) { this.err(`unknown game "${m.game}"`); return; }
    c.launched = true;
    this.pickerOpen = false;
    $("party-panel").hidden = true;
    const humans = c.room.members.map(x => ({ id: x.id, handle: x.handle, avatar: x.avatar }));
    const ctx = {
      room: c.room, me: this.me, humans, seed: m.seed, isHost: () => c.room.isHost, party: c.meta,
      options: { ...defaultsFor(g), ...(m.options ?? {}) },
      session: c.session,
      onEnd: () => this._onGameEnd(c),
    };
    try { g.start(ctx); }
    catch (e) { console.warn("[party] game start", e); c.launched = false; $("party-panel").hidden = false; this.err(`${g.title} failed to start`); return; }
    if (c.room.isHost && FLAGS.PUBLIC_PARTIES) this._announce();
  },
  // back to the lobby room between games; the queue survives so the host
  // can run the same game again or pick the next one
  _onGameEnd(c) {
    if (this.current !== c) return;
    c.launched = false;
    trash.flush("game ended");           // uploaded photos + entries go now
    $("party-panel").hidden = false;
    if (c.room.isHost) this._sendMeta();  // shares the session's used prompts
    this.render();
    if (c.room.isHost && FLAGS.PUBLIC_PARTIES) this._announce();
  },

  // ---------------------------------------------------------------- world beacons
  syncBeacons() {
    // only public parties ever get a world beacon; with the flag off this
    // clears any beacon left from a previous session and does nothing else
    if (!FLAGS.PUBLIC_PARTIES) {
      for (const id of this._beacons ?? []) beacon.clear(`party-${id}`);
      this._beacons = new Set();
      return;
    }
    const seen = new Set();
    for (const r of this.nearby) {
      if (r.x === undefined) continue;
      seen.add(r.id);
      beacon.set(`party-${r.id}`, { x: r.x, y: r.y ?? 0, z: r.z }, {
        count: r.count, color: PARTY_COLOR, live: r.state === "playing",
        label: `${r.name ?? r.hostName + "'s party"} · ${r.count}/${r.cap}`,
      });
    }
    for (const id of this._beacons ?? []) if (!seen.has(id)) beacon.clear(`party-${id}`);
    this._beacons = seen;
  },
  _beacons: new Set(),

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
    if (this._view !== view) {
      this._view = view;
      p.innerHTML = c ? this._inHtml() : this._outHtml();
      p.classList.toggle("pt-lobby", !!c);
      this._bind();
      if (c) {
        // the walkable room lives as long as you're in this party
        const bots = BOTS_N ? makeBots(BOTS_N, mulberry(7)).map(b => ({ id: b.id, handle: b.handle })) : [];
        c.lobby = new LobbyRoom($("pt-floor"), c.room, this.me, { bots: c.room.isHost ? bots : [] });
      }
    }
    if (c) { this._renderLobby(); this.renderChat(); }
    else this._renderList();
  },

  _outHtml() {
    const f = this.form;
    return `<div class="rp-head"><b>House party</b><button id="pt-close" type="button" aria-label="Close">&#10005;</button></div>
      <div class="pt-sec"><div class="rl-h">Throw a house party</div>
        <div class="pt-lbl">party name</div>
        <div class="pt-row"><input id="pt-name" maxlength="${PARTY.NAME_MAX}" placeholder="${esc(this.me?.handle ?? "my")}'s party" value="${esc(f.name)}"></div>
        <div class="pt-lbl">vibe (a label for the room — every game is available either way)</div>
        <div class="pt-row" id="pt-vibe">${VIBES.map(v => `<button type="button" class="pt-btn ${f.vibe === v ? "on" : ""}" data-vibe="${v}">${v}</button>`).join("")}</div>
        <div class="pt-lbl">player cap</div>
        <div class="pt-row"><input id="pt-cap" type="number" min="${PARTY.CAP_MIN}" max="${PARTY.CAP_MAX}" value="${f.cap}"></div>
        <button id="pt-create" class="pt-btn pt-primary" type="button">throw the party</button>
        <div id="pt-err" class="pt-err"></div>
      </div>
      ${FLAGS.PUBLIC_PARTIES ? `<div class="pt-sec"><div class="rl-h">Parties nearby</div><div id="pt-list"></div></div>` : ""}
      <div class="pt-sec"><div class="rl-h">Got an invite code?</div>
        <form id="pt-code-form" class="pt-row"><input id="pt-code" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off"><button type="submit" class="pt-btn">join</button></form>
        ${FLAGS.PUBLIC_PARTIES ? "" : `<div class="pt-note">parties are invite-only this build — share the code or the link</div>`}
      </div>`;
  },
  // the lobby: a full-screen room you walk around in, with the up-next bar
  // underneath and the host's picker as an overlay on top
  _inHtml() {
    return `<div class="pt-top">
        <div class="pt-top-main"><b id="pt-title">party</b><div id="pt-sub" class="rp-sub"></div></div>
        <button id="pt-code-chip" type="button" class="pt-code-chip mono" title="share the invite"></button>
        <button id="pt-hide" type="button" class="pt-icon" aria-label="Back to the map">&#8964;</button>
        <button id="pt-leave" type="button" class="pt-leave">leave</button>
      </div>
      <div class="pt-floor-wrap">
        <div id="pt-floor"></div>
        <div id="pt-chat-feed" class="pt-chat-float"></div>
      </div>
      <div class="pt-bottom">
        <div id="pt-next" class="pt-next"></div>
        <div id="pt-err" class="pt-err"></div>
        <form id="pt-chat-form"><input id="pt-chat-input" maxlength="160" placeholder="say something&hellip;" autocomplete="off"><button type="submit">&#8593;</button></form>
      </div>
      <div id="pt-picker" class="pt-picker" hidden></div>`;
  },
  _bind() {
    const p = $("party-panel");
    p.querySelector("#pt-close")?.addEventListener("click", () => this.togglePanel(false));
    p.querySelector("#pt-hide")?.addEventListener("click", () => this.togglePanel(false));
    p.querySelector("#pt-leave")?.addEventListener("click", () => this.leave());
    p.querySelector("#pt-name")?.addEventListener("input", e => { this.form.name = e.target.value; });
    p.querySelectorAll("[data-vibe]").forEach(b => b.onclick = () => {
      this.form.vibe = b.dataset.vibe;
      p.querySelectorAll("[data-vibe]").forEach(x => x.classList.toggle("on", x === b));
    });
    p.querySelector("#pt-cap")?.addEventListener("change", e => { this.form.cap = +e.target.value; });
    p.querySelector("#pt-create")?.addEventListener("click", () => {
      this.form.name = $("pt-name")?.value ?? "";
      this.form.cap = +($("pt-cap").value || PARTY.CAP_DEFAULT);
      this.create();
    });
    p.querySelector("#pt-code-form")?.addEventListener("submit", e => { e.preventDefault(); this.joinByCode($("pt-code").value); });
    p.querySelector("#pt-code-chip")?.addEventListener("click", () => {
      const c = this.current; if (!c) return;
      shareText(`join my party "${c.meta.name}" on Rando — code ${c.meta.code} · ${inviteLink(c.meta.code)}`);
    });
    p.querySelector("#pt-chat-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const inp = $("pt-chat-input"), text = inp.value.trim().slice(0, 160);
      if (text && this.current) { this.current.room.send("chat", { text }); inp.value = ""; inp.blur(); }
    });
  },

  _renderList() {
    const el = $("pt-list"); if (!el) return;
    const sig = this.nearby.map(r => `${r.id}:${r.name}:${r.count}/${r.cap}:${r.state}`).join("|");
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    if (!this.nearby.length) { el.innerHTML = `<div class="pt-empty">none right now</div>`; return; }
    el.innerHTML = this.nearby.map(r => `<div class="rl-row"><div class="rl-dot pt-dot"></div><div><b>${esc(r.name ?? r.hostName)}</b><span>${r.count}/${r.cap} in · ${r.state}</span></div><button type="button" data-join="${esc(r.id)}" ${r.count >= r.cap || r.state === "playing" ? "disabled" : ""}>join</button></div>`).join("");
    el.querySelectorAll("button[data-join]").forEach(b => b.onclick = () => this.join(b.dataset.join));
  },

  _renderLobby() {
    const c = this.current;
    const host = c.room.presence[c.room.hostId]?.handle ?? c.meta.hostName;
    $("pt-title").textContent = c.meta.name;
    $("pt-sub").textContent = `${c.meta.vibe} · ${host} is hosting · ${c.room.members.length}/${c.meta.cap}${BOTS_N ? ` (+${BOTS_N} bots)` : ""}`;
    $("pt-code-chip").textContent = c.meta.code;
    c.lobby?.setBackground(LOBBY_BG[c.meta.vibe] ?? LOBBY_BG.chill);
    c.lobby?.sync();
    this._renderNext();
    this._renderPicker();
  },

  // the "up next" bar under the room
  _renderNext() {
    const c = this.current; const el = $("pt-next"); if (!c || !el) return;
    const isHost = c.room.isHost, host = c.room.presence[c.room.hostId]?.handle ?? "the host";
    const n = this.playerCount();
    const g = c.queue ? gameById(c.queue.game) : null;
    const opts = g ? [optionsLabel(g, c.queue.options), g.describe?.(c.meta)].filter(Boolean).join(" · ") : "";
    const need = g ? Math.max(0, minFor(g) - n) : 0;
    const sig = `${isHost ? 1 : 0}:${n}:${host}:${c.queue?.game ?? "-"}:${opts}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const card = g
      ? `<div class="pt-next-card"><small>up next</small><b>${esc(g.title)}</b>${opts ? `<span>${esc(opts)}</span>` : ""}</div>`
      : `<div class="pt-next-card empty"><small>up next</small><b>${isHost ? "no game picked yet" : `${esc(host)} hasn't picked a game`}</b></div>`;
    if (isHost) {
      el.innerHTML = card + `<div class="pt-next-btns">
          <button type="button" class="pt-btn" id="pt-open-picker">${g ? "change" : "pick a game"}</button>
          ${g ? `<button type="button" class="pt-btn pt-go" id="pt-start" ${need ? "disabled" : ""}>${need ? `needs ${need} more` : "start ▶"}</button>` : ""}
        </div>`;
      $("pt-open-picker").onclick = () => { this.pickerOpen = true; this._renderPicker(); };
      const st = $("pt-start"); if (st) st.onclick = () => this.launch();
    } else {
      el.innerHTML = card + `<div class="pt-next-wait">${g ? (need ? `waiting for ${need} more` : `waiting for ${esc(host)} to start`) : "hang out — walk around"}</div>`;
    }
  },

  // host-only overlay: tap a game to queue it, set its options, close any time
  _renderPicker() {
    const c = this.current; const el = $("pt-picker"); if (!c || !el) return;
    const open = this.pickerOpen && c.room.isHost && !c.launched;
    el.hidden = !open;
    if (!open) { el.dataset.sig = ""; return; }
    const n = this.playerCount();
    const sig = `${n}:${c.queue?.game ?? "-"}:${JSON.stringify(c.queue?.options ?? {})}:${JSON.stringify(c.meta.settings)}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const st = c.meta.settings ?? {};
    const dflt = DIARY.DEFAULT_MAX[c.meta.privacy === "public" ? "public" : "private"];
    const effMax = (st.diaryMax === "unhinged" && !st.adult) ? "spicy" : (st.diaryMax || dflt);
    const settingsHtml = `<div class="pt-settings">
        <div class="rl-h">party settings <small>— optional, defaults are fine</small></div>
        <div class="pt-opt"><span>18+ party</span><div class="pt-row">
          <button type="button" class="pt-btn ${st.adult ? "" : "on"}" data-set="adult" data-val="0">off</button>
          <button type="button" class="pt-btn ${st.adult ? "on" : ""}" data-set="adult" data-val="1">on — everyone's 18+</button></div>
          <small>unlocks unhinged content</small></div>
        <div class="pt-opt"><span>Secret Diary max level</span><div class="pt-row">${DIARY.LEVELS.map(l => {
          const locked = l === "unhinged" && !st.adult;
          return `<button type="button" class="pt-btn ${effMax === l ? "on" : ""}" data-set="diaryMax" data-val="${l}" ${locked ? "disabled" : ""}>${l}${l === dflt ? " (default)" : ""}</button>`;
        }).join("")}</div>
          <small>${st.adult ? "" : "unhinged needs 18+ on · "}levels still build up: rounds 1-2 mild, 3-4 up to spicy, then up to this</small></div>
      </div>`;
    el.innerHTML = `<div class="pt-picker-sheet">
        <div class="pt-picker-head"><b>pick the next game</b><button type="button" class="pt-icon" id="pt-picker-x" aria-label="Close">&#10005;</button></div>
        <div class="pt-games">${PARTY_CATALOG.map(g => {
          const on = c.queue?.game === g.id;
          const need = Math.max(0, minFor(g) - n);
          const opts = on ? (g.options ?? []).map(opt => `<div class="pt-opt"><span>${esc(opt.label)}</span><div class="pt-row">${opt.choices.map(ch =>
            `<button type="button" class="pt-btn ${c.queue.options?.[opt.key] === ch.value ? "on" : ""}" data-opt="${esc(opt.key)}" data-val="${esc(ch.value)}" title="${esc(ch.hint ?? "")}">${esc(ch.label)}</button>`).join("")}</div>
            ${opt.choices.find(ch => ch.value === c.queue.options?.[opt.key])?.hint ? `<small>${esc(opt.choices.find(ch => ch.value === c.queue.options?.[opt.key]).hint)}</small>` : ""}</div>`).join("") : "";
          return `<div class="pt-game ${on ? "on" : ""}" data-queue="${g.id}" role="button" tabindex="0">
            <b>${esc(g.title)}${on ? ' <em>✓ up next</em>' : ""}</b>
            <span>${esc(g.blurb)}</span>
            <small>${minFor(g)}+ players · ${esc(g.length ?? "")}${need ? ` · needs ${need} more to start` : ""}</small>
            ${opts}
          </div>`;
        }).join("")}${settingsHtml}</div>
        <div class="pt-picker-foot">
          ${c.queue ? `<button type="button" class="pt-btn" id="pt-unqueue">clear</button>` : ""}
          <button type="button" class="pt-btn pt-go" id="pt-picker-done">${c.queue ? "done" : "close"}</button>
        </div>
      </div>`;
    const close = () => { this.pickerOpen = false; this._renderPicker(); };
    $("pt-picker-x").onclick = close;
    $("pt-picker-done").onclick = close;
    el.onclick = e => { if (e.target === el) close(); };          // tap the dimmed backdrop to close
    const un = $("pt-unqueue"); if (un) un.onclick = () => this.clearQueue();
    el.querySelectorAll("[data-queue]").forEach(card => card.onclick = e => {
      if (e.target.closest("[data-opt]")) return;
      this.queue(card.dataset.queue);
    });
    el.querySelectorAll("[data-opt]").forEach(b => b.onclick = e => { e.stopPropagation(); this.setOption(b.dataset.opt, b.dataset.val); });
    el.querySelectorAll("[data-set]").forEach(b => b.onclick = () => {
      const k = b.dataset.set, v = b.dataset.val;
      this.setSetting(k, k === "adult" ? v === "1" : v);
    });
  },

  renderChat() {
    const c = this.current; const feed = $("pt-chat-feed"); if (!c || !feed) return;
    feed.innerHTML = c.chat.slice(-4).map(l => `<div class="lc-msg"><b>${esc(l.who)}</b>${esc(l.text)}</div>`).join("");
  },
};
