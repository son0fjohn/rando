// Rando house parties.
//
// A party is a player-hosted Room (net.js) with metadata: a name, a vibe
// label, and a player cap. Players join by 4-character code or by link
// (?party=CODE). There is NO proximity check this pass — anyone with the code
// is in, from anywhere.
//
// The vibe (chill / chaotic / sporty) is a LABEL ONLY: it picks the lobby
// backdrop and nothing else. It does not filter the game catalog.
//
// Public parties — announcing to the shared directory so strangers nearby can
// browse and join — sit behind FLAGS.PUBLIC_PARTIES, which is OFF. With it
// off nothing is announced and the "parties nearby" list is hidden; every
// party is code-only.
//
// The host picks a game directly from the catalog (no spinner, no group vote
// — both are out of scope). The chosen game runs on the shared HostGame kit.
import { Room, directory } from "./net.js";
import { world3d } from "./world3d.js";
import { beacon, sfx, buzz } from "./fx.js";
import { rooms } from "./rooms.js";
import { PARTY_CATALOG, gameById } from "./partycatalog.js";
import { FLAGS, PARTY } from "./hpconfig.js";
import { avatarHtml, esc, trash } from "./hpkit.js";
import { shareText } from "./gamekit.js";

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

export const party = {
  get me() { return rooms.me; },
  current: null,      // { room, meta, launched, chat }
  nearby: [],
  form: { name: "", vibe: "chill", cap: PARTY.CAP_DEFAULT },
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
      room, launched: false, chat: [],
      meta: { name, vibe, cap, code, hostId: this.me.id, hostName: this.me.handle },
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
      room, launched: false, chat: [],
      // with no directory entry (code join) we start with placeholders and let
      // the host's `meta` broadcast fill in the real name / vibe / cap
      meta: {
        name: ann?.name ?? meta?.name ?? "house party", vibe: ann?.vibe ?? meta?.vibe ?? "chill",
        cap: ann?.cap ?? meta?.cap ?? PARTY.CAP_MAX, code: id.slice(6),
        hostId: ann?.hostId ?? null, hostName: ann?.hostName ?? "the host",
      },
    };
    this._wire(room);
    try { await room.join(); }
    catch (e) { this.current = null; this.err("couldn't join: " + e.message); return; }
    this.current.room.send("hello", {});       // nudge the host to send meta
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
    c.room.leave();
    this.current = null;
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
      } else if (directory.announcing) directory.stopAnnouncing();
      this.render();
    };
    room.on("hello", () => { if (room.isHost) this._sendMeta(); });
    room.on("meta", m => {
      if (room.isHost) return;
      c.meta = { ...c.meta, name: m.name, vibe: m.vibe, cap: m.cap, hostName: m.hostName };
      this.render();
    });
    room.on("chat", m => {
      c.chat.push({ who: room.presence[m.from]?.handle ?? "someone", text: m.text });
      c.chat = c.chat.slice(-40);
      this.renderChat();
    });
    room.on("launch", m => this._onLaunch(m));
    room.on("full", m => { if (m.id === this.me.id) { this.leave(); this.err(`that party is full (cap ${m.cap})`); } });
  },
  _sendMeta() {
    const c = this.current; if (!c?.room.isHost) return;
    c.room.send("meta", { name: c.meta.name, vibe: c.meta.vibe, cap: c.meta.cap, hostName: this.me.handle });
  },
  // host: anyone past the cap (by join order) is told to leave
  _enforceCap() {
    const c = this.current;
    for (const m of c.room.members.slice(c.meta.cap)) c.room.send("full", { id: m.id, cap: c.meta.cap });
  },

  // ---------------------------------------------------------------- game launch
  playerCount() { return (this.current?.room.members.length ?? 0) + BOTS_N; },
  launch(gameId) {
    const c = this.current;
    if (!c || !c.room.isHost || c.launched) return;
    const g = gameById(gameId);
    if (!g) { this.err(`unknown game "${gameId}"`); return; }
    const n = this.playerCount();
    if (n < (g.minPlayers ?? MIN_PLAYERS)) { this.err(`${g.title} needs ${g.minPlayers ?? MIN_PLAYERS}+ players · ${n} here`); return; }
    c.room.send("launch", { game: gameId, seed: (Date.now() % 1e9) | 0, at: Date.now() + 500 });
  },
  _onLaunch(m) {
    const c = this.current;
    if (!c || c.launched) return;
    const g = gameById(m.game);
    if (!g) { this.err(`unknown game "${m.game}"`); return; }
    c.launched = true;
    $("party-panel").hidden = true;
    const humans = c.room.members.map(x => ({ id: x.id, handle: x.handle, avatar: x.avatar }));
    const ctx = {
      room: c.room, me: this.me, humans, seed: m.seed, isHost: () => c.room.isHost, party: c.meta,
      onEnd: () => this._onGameEnd(c),
    };
    try { g.start(ctx); }
    catch (e) { console.warn("[party] game start", e); c.launched = false; $("party-panel").hidden = false; this.err(`${g.title} failed to start`); return; }
    if (c.room.isHost && FLAGS.PUBLIC_PARTIES) this._announce();
  },
  _onGameEnd(c) {
    if (this.current !== c) return;
    c.launched = false;
    trash.flush("game ended");           // uploaded photos + entries go now
    $("party-panel").hidden = false;
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
  // the lobby: a room screen with the vibe's generated backdrop and everyone
  // in it as a placeholder avatar
  _inHtml() {
    return `<div class="pt-room" id="pt-room">
        <div class="pt-room-head">
          <div><b id="pt-title">party</b><div id="pt-sub" class="rp-sub"></div></div>
          <button id="pt-leave" type="button">leave</button>
        </div>
        <div id="pt-avatars" class="pt-avatars"></div>
      </div>
      <div class="pt-row pt-invite">
        <code id="pt-codebig" class="mono"></code>
        <button id="pt-share" type="button" class="pt-btn">share link</button>
      </div>
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
    p.querySelector("#pt-share")?.addEventListener("click", () => {
      const c = this.current; if (!c) return;
      shareText(`join my party "${c.meta.name}" on Rando — code ${c.meta.code} · ${inviteLink(c.meta.code)}`);
    });
    p.querySelector("#pt-chat-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const inp = $("pt-chat-input"), text = inp.value.trim().slice(0, 160);
      if (text && this.current) { this.current.room.send("chat", { text }); inp.value = ""; }
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
    const room = $("pt-room");
    const bg = LOBBY_BG[c.meta.vibe] ?? LOBBY_BG.chill;
    if (room && room.dataset.bg !== bg) { room.dataset.bg = bg; room.style.backgroundImage = `url(${bg})`; }
    const host = c.room.presence[c.room.hostId]?.handle ?? c.meta.hostName;
    $("pt-title").textContent = c.meta.name;
    $("pt-sub").textContent = `${c.meta.vibe} · ${host} is hosting · ${c.room.members.length}/${c.meta.cap}${BOTS_N ? ` (+${BOTS_N} bots)` : ""}`;
    $("pt-codebig").textContent = c.meta.code;

    const av = $("pt-avatars");
    const sig = c.room.members.map(m => `${m.id}:${m.handle}`).join("|") + `|${c.room.hostId}`;
    if (av.dataset.sig !== sig) {
      av.dataset.sig = sig;
      av.innerHTML = c.room.members.map(m => `<div class="pt-seat">
        ${avatarHtml(m, { size: 56, ring: m.id === c.room.hostId ? "gold" : "" })}
        <span class="pt-seat-name">${esc(m.handle)}${m.id === c.room.hostId ? " ★" : ""}</span>
      </div>`).join("");
    }
    this._renderSel();
  },

  // host: pick a game directly. (Random spin and group vote are out of scope.)
  _renderSel() {
    const c = this.current; const el = $("pt-sel"); if (!c || !el) return;
    const isHost = c.room.isHost, host = c.room.presence[c.room.hostId]?.handle ?? "the host";
    const n = this.playerCount();
    const sig = `${isHost ? 1 : 0}:${n}:${host}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    if (!isHost) {
      el.innerHTML = `<div class="pt-note">waiting for ${esc(host)} to pick a game · ${n} here</div>`;
      return;
    }
    el.innerHTML = `<div class="rl-h">Pick a game</div>
      <div class="pt-games">${PARTY_CATALOG.map(g => {
        const min = g.minPlayers ?? MIN_PLAYERS;
        const ok = n >= min;
        return `<button type="button" class="pt-game" data-launch="${g.id}" ${ok ? "" : "disabled"}>
          <b>${esc(g.title)}</b>
          <span>${esc(g.blurb)}</span>
          <small>${min}+ players · ${esc(g.length ?? "")}${ok ? "" : ` · needs ${min - n} more`}</small>
        </button>`;
      }).join("")}</div>`;
    el.querySelectorAll("[data-launch]").forEach(b => b.onclick = () => this.launch(b.dataset.launch));
  },

  renderChat() {
    const c = this.current; const feed = $("pt-chat-feed"); if (!c || !feed) return;
    feed.innerHTML = c.chat.map(l => `<div class="lc-msg"><b>${esc(l.who)}</b>${esc(l.text)}</div>`).join("");
    feed.scrollTop = feed.scrollHeight;
  },
};
