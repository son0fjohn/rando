// Rando house parties.
//
// A party is a player-hosted Room (net.js) with metadata: a name, a vibe
// label, and a player cap. Players join by 4-character code or by link
// (?party=CODE), or from the map (a public party's house). There is NO
// proximity check — anyone with the code is in, from anywhere; joining a
// public party from the map asks only for phone verification (hooks.gate).
//
// Inside, the party is a full-screen 2D room (hplobby.js): everyone walks
// around the vibe's generated backdrop while the lobby fills up, and comes
// back to it between games. The vibe (chill / chaotic / sporty) is a LABEL
// ONLY: it picks that backdrop and nothing else.
//
// The host picks the next game from a picker overlay they can open and close
// at will. Picking QUEUES the game ("up next") — it doesn't need the player
// minimum to be met yet, so the host can set it up while people arrive. Games
// can declare options (e.g. the Ritual: everyone once / twice);
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
// Public parties: the host picks "invite only" (default) or "public", and can
// switch it later in the party settings. A public party is announced to the
// shared directory (partyhouse.js announceFor: name, vibe, cap, count,
// lobby / which game and round, the host's name and look, the host's ZONE —
// never the host's position: parties are often at someone's home). Every
// phone stands the host's character in that zone with a house floating over
// their head (partybeacon.js), the whole time the party runs, games
// included. Tap it, see the party card, join: mid-game you wait in the lobby
// and come in at the next round (a game with `lateJoin`) or the next game.
// Invite-only parties are never announced anywhere: switching to invite only
// takes the house off the map at once. FLAGS.PUBLIC_PARTIES switches the
// whole public option off.
import { Room, directory, mulberry } from "./net.js";
import { world3d } from "./world3d.js";
import { sfx, buzz } from "./fx.js";
import { rooms } from "./rooms.js";
import { PARTY_CATALOG, gameById, gameTitle } from "./partycatalog.js";
import { FLAGS, PARTY, DIARY } from "./hpconfig.js";
import { esc, trash } from "./hpkit.js";
import { makeBots, shareText, ui as gameUi } from "./gamekit.js";
import { LobbyRoom } from "./hplobby.js";
import { openCard, close as closeCard } from "./profilecard.js";
import { mountCharView } from "./charview.js";
import { partyBeacons } from "./partybeacon.js";
import { announceFor, housesFrom, statusText, joinState } from "./partyhouse.js";
import { muteButton, popIn } from "./retro.js";
import { newSet, addGame, addPartial, standings, nextGameNo } from "./partyset.js";
import { showPodium, closePodium, showCoins, coinBurst } from "./partyboard.js";
import { warmLooks } from "./charrender.js";
import { t } from "./i18n.js";
import { qrSvg } from "./qr.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

export const VIBES = PARTY.VIBES;
const MIN_PLAYERS = PARTY.MIN_PLAYERS;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));   // dev: bots count toward the minimum
// vibe -> generated lobby backdrop (web/lobbies/)
const LOBBY_BG = { chill: "lobbies/chill.png", chaotic: "lobbies/chaos.png", sporty: "lobbies/sporty.png" };

// the picker's Wii-channel tiles: a little pixel icon per game
const px = (d, fill) => `<path d="${d}" fill="${fill}"/>`;
const CHANNEL_ART = {
  secretdiary: `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">${px("M3 2h9v12H3z", "#ff5d8a")}${px("M4 3h7v10H4z", "#ffd3e0")}${px("M3 2h1v12H3z", "#b02a55")}${px("M10 7h3v3h-3z", "#ffc84d")}${px("M11 6h1v1h-1z", "#8a8fa8")}</svg>`,
  mask_off: `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">${px("M2 3h12v6H2zM3 9h10v2H3zM5 11h6v2H5z", "#f2f4ff")}${px("M4 5h3v2H4zM9 5h3v2H9z", "#0b0d24")}${px("M6 10h4v1H6z", "#ff5d8a")}${px("M1 4h1v2H1zM14 4h1v2h-1z", "#ffc84d")}${px("M7 3h2v1H7z", "#b9a6ff")}</svg>`,
  // the Ritual: the Boss himself — white face paint, sleepy painted eyes with
  // blue diamonds, a round red nose, a smudged red smile, gray hair
  ritual: `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">${px("M2 3h2v5H2zM12 3h2v5H12zM4 1h8v1H4z", "#b9b9c2")}${px("M5 2h6v1H5zM4 3h8v1H4zM3 4h10v7H3zM4 11h8v2H4zM5 13h6v1H5z", "#f4f1e8")}${px("M5 3h1v1H5zM10 3h1v1H10zM5 8h1v2H5zM10 8h1v2H10z", "#3d6fe6")}${px("M4 5h3v1H4zM9 5h3v1H9z", "#2a2238")}${px("M4 6h1v1H4zM6 6h1v1H6zM9 6h1v1H9zM11 6h1v1H11z", "#ffffff")}${px("M5 6h1v1H5zM10 6h1v1H10z", "#5a3a24")}${px("M7 7h2v2H7zM3 9h1v1H3zM12 9h1v1H12zM4 10h8v1H4zM5 11h6v1H5z", "#e3342b")}${px("M7 7h1v1H7z", "#ff8f86")}${px("M5 10h6v1H5z", "#8e1a1a")}</svg>`,
  sidequest: `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">${px("M7 0h2v2H7zM6 2h4v2H6zM5 4h6v2H5z", "#6b3fd6")}${px("M7 2h1v1H7z", "#ffd23f")}${px("M3 6h10v1H3z", "#140c22")}${px("M5 9h6v5H5zM4 10h8v3H4z", "#b9a6ff")}${px("M6 10h2v1H6z", "#fff")}${px("M4 14h8v2H4z", "#6b3a1c")}</svg>`,
  artgallery: `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">${px("M1 3h14v10H1z", "#ffc84d")}${px("M3 5h10v6H3z", "#4da6ff")}${px("M3 9h4v2H3zM7 8h3v3H7z", "#7dff5e")}${px("M11 6h1v1h-1z", "#fff")}</svg>`,
  manhunt: `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">${px("M2 2h12v12H2z", "#0a3a24")}${px("M8 2h1v12H8zM2 8h12v1H2z", "#3ce68c")}${px("M10 4h2v2h-2z", "#ff4d5e")}${px("M5 10h1v1H5z", "#3ce68c")}</svg>`,
};

// people you've blocked: hidden in party rooms and their chat dropped, on
// this phone only (localStorage), across parties
const BLOCK_KEY = "rando-blocked";
function loadBlocked() { try { return new Set(JSON.parse(localStorage.getItem(BLOCK_KEY) ?? "[]")); } catch { return new Set(); } }
function saveBlocked(set) { try { localStorage.setItem(BLOCK_KEY, JSON.stringify([...set].slice(-200))); } catch {} }

// a party session id: the coin ledger keys a party's games by it (codes repeat)
const sessionId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
function makeCode() { let c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
// an invite link: on the app itself /p/CODE (api/invite.mjs: a link preview
// with the party's name and how many are in, then on to ?party=CODE); the
// name and count ride in the link because parties live in no table
export const inviteLink = (code, { name = "", count = 0 } = {}) => {
  if (!/^\/(index\.html|app\.html)?$/.test(location.pathname)) return `${location.origin}${location.pathname}?party=${code}`;
  const q = new URLSearchParams();
  if (name) q.set("n", name.slice(0, 40));
  if (count) q.set("c", String(count));
  return `${location.origin}/p/${code}${q.size ? `?${q}` : ""}`;
};
// the game suggested to a new group (a "Great first game" badge on its row)
export const FIRST_GAME = "ritual";
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
  form: { name: "", vibe: "chill", cap: PARTY.CAP_DEFAULT, privacy: "private" },
  pickerOpen: false,
  chatOpen: false,
  blocked: loadBlocked(),
  // backend.js fills these in (kept out of this module so tests run offline):
  //   isFriend(id) -> bool · report(id, reason) -> Promise<bool>
  //   beaconZone() -> Promise<{ id, lat, lng }> — the host's presence zone,
  //   snapped on the phone; a public party's beacon goes there
  //   coins: { reportGame(g), confirmGame(g), partyCoins(set) } — the
  //   server-side coin ledger (migrations/013); null = no coins here
  //   ritualDraw({ room, turn, level }) -> { id, text }: Humiliation Ritual's
  //   prompt, drawn on the server and sent to the calling (performer's) phone
  //   only (migrations/015); null = the performer's phone draws it itself
  //   onboarding (onboard.js, real app only; every one optional):
  //   holdInvite(code) -> true: the invite landing takes this link over
  //   gate(trigger) -> Promise<bool>: phone verification for the stranger
  //   features only ("public": making a party public or joining one,
  //   "coins": collecting what a game paid); false = don't. Private parties
  //   with friends are never behind it.
  //   canEarn() -> Promise<bool>: may this phone collect coins now (false: a
  //   game's coins wait, unclaimed, until it's verified)
  //   invite(c) -> the invite sheet · joined(c) · beforeGame(g, c) ·
  //   gameEnded(c, g, results) · setEnded(c, rows)
  //   left({ why, code, drop }) -> Promise: out of the party to the map
  //   (exit() below): calls drop() (the room goes) under its transition
  hooks: { isFriend: null, report: null, beaconZone: null, coins: null, ritualDraw: null,
    holdInvite: null, gate: null, canEarn: null, invite: null, joined: null, beforeGame: null, gameEnded: null, setEnded: null, left: null },
  _view: null,
  _inited: false,

  init() {
    directory.start();
    directory.onChange(list => {
      this.nearby = FLAGS.PUBLIC_PARTIES ? list.filter(r => r.kind === "party" && r.privacy === "public") : [];
      this.syncBeacons();
      if (!this.current) this._renderList();
    });
    partyBeacons.onTap(r => this.showCard(r));
    $("party-btn")?.addEventListener("click", () => this.togglePanel());
    // one lobby at a time: joining a room/raid drops the party and vice versa
    rooms.onBeforeJoin = () => this.leave();
    // the phone's / browser's Back (Android back, iOS swipe-back, the
    // browser's button) in a party is the lobby's own back: "Leave the
    // party?", never off the page. A party keeps one history entry of its
    // own (_armBack); Back pops it, so it goes straight back on.
    addEventListener("popstate", () => {
      if (this._popOwn) { this._popOwn = false; return; }
      const c = this.current;
      if (!c) return;
      this._armBack(true);
      if (c.launched || this._exiting || $("party-panel").hidden) return;     // (mid-game: a game has its own ways out)
      sfx.back(); this.confirmLeave();
    });
    this.render();
    // ?party=CODE — join straight from a shared link
    const code = params.get("party");
    if (code && !this.hooks.holdInvite?.(code)) { this.togglePanel(true); setTimeout(() => this.joinByCode(code), 600); }
  },

  // ---------------------------------------------------------------- host / join / leave
  async create() {
    const { vibe } = this.form;
    const privacy = FLAGS.PUBLIC_PARTIES && this.form.privacy === "public" ? "public" : "private";
    // phone verification only for a public party (strangers); a private one with friends needs none
    if (privacy === "public" && this.hooks.gate && !(await this.hooks.gate("public"))) return false;
    const cap = Math.max(PARTY.CAP_MIN, Math.min(PARTY.CAP_MAX, +this.form.cap || PARTY.CAP_DEFAULT));
    const name = (this.form.name || "").trim().slice(0, PARTY.NAME_MAX) || `${this.me.handle}'s party`;
    this.err("");
    await rooms.leave(); await this.leave();
    const code = makeCode();
    const room = new Room(`party-${code}`, this.me);
    this.current = {
      room, launched: false, chat: [], queue: null, votes: {}, gameOpts: {}, lobby: null, session: newSession(),
      set: newSet(1, sessionId()), coins: {},
      meta: {
        name, vibe, cap, code, hostId: this.me.id, hostName: this.me.handle,
        privacy,
        settings: { adult: false, diaryMax: null },
      },
    };
    this._wire(room);
    try { await room.join(); }
    catch (e) { this.current = null; this.err("couldn't open the party: " + e.message); return; }
    if (privacy === "public") await this._findZone();
    this._announce();
    sfx.open(); buzz([30, 40, 30]);
    this.render();
    this._armBack();
    return true;
  },

  async join(id, meta = null) {
    this.err("");
    const ann = directory.rooms.get(id);
    // full: no. A game on: in, to the lobby; the game takes you at its next
    // round (or the next game), never mid-turn
    if (ann && ann.count >= ann.cap) { this.err("that party is full"); return; }
    await rooms.leave(); await this.leave();
    const room = new Room(id, this.me);
    this.current = {
      room, launched: false, chat: [], queue: null, votes: {}, gameOpts: {}, lobby: null, session: newSession(),
      set: newSet(1, null), coins: {},
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
    this._armBack();
    if (ann?.state === "playing") this._toast(t(gameById(ann.game)?.lateJoin ? "ph.nextRound" : "ph.nextGame"));
    this.hooks.joined?.(this.current);
    return true;
  },
  joinByCode(code) {
    code = String(code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { this.err("codes are 4 characters"); return; }
    return this.join(`party-${code}`);
  },

  // "Leave the party?" over the room; leaving goes to the map (exit)
  confirmLeave() {
    const p = $("party-panel");
    if (!this.current || p.querySelector(".pt-confirm")) return;
    const el = document.createElement("div");
    el.className = "pt-confirm glass-scrim";
    el.innerHTML = `<div class="pt-confirm-card glass glass-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pt-confirm-t">
        <b id="pt-confirm-t">${esc(t("leave.title"))}</b><p>${esc(t("leave.sub"))}</p>
        <div class="glass-row"><button type="button" class="glass-btn clear sm" data-no>${esc(t("leave.no"))}</button><button type="button" class="glass-btn gold sm" data-yes>${esc(t("leave.yes"))}</button></div>
      </div>`;
    const close = () => el.remove();
    el.onclick = e => { if (e.target === el) { sfx.back(); close(); } };
    el.querySelector("[data-no]").onclick = () => { sfx.back(); close(); };
    el.querySelector("[data-yes]").onclick = () => { close(); sfx.back(); this.exit("leave"); };
    p.appendChild(el);
    sfx.open();
    el.querySelector("[data-no]").focus();
  },

  // Every way out of a party to the world lands the same: Leave, the host
  // ending the party (after the set's podium), the host turning you away
  // (the cap). Straight onto the explore map, on you: no host menu, no start
  // screen, no Home, no error card over it (the hook's transition: the
  // camera pulls out of the party's building, onboard.js toWorld). Joining
  // another party or a room calls leave() alone: that's not out to the map.
  async exit(why = "leave") {
    const c = this.current;
    if (!c || this._exiting) return;
    this._exiting = true;
    const drop = async () => {
      const p = $("party-panel");
      p.hidden = true; p.classList.remove("pt-behind");      // (before leave() redraws it as the host menu)
      // nothing of the party left behind: a game still on this phone, the
      // host's controls, the sheets, the host menu's open state
      if (c.launched) { try { c.ctx?.hostGame?.stop(); } catch {} gameUi.hide(); }
      clearInterval(c.watch);
      this._hostCtl(null);
      document.body.classList.remove("hp-setup-wait", "hp-on-map", "hp-room3d");
      this.pickerOpen = false; this.settingsOpen = false; this.chatOpen = false;
      if (this.current === c) await this.leave();
      this.err("");
      this._view = null; this.render();                      // (the host menu, fresh, for the next time it's opened)
      this._syncPause();
      this._disarmBack();
    };
    try {
      if (this.hooks.left) await this.hooks.left({ why, code: c.meta.code, drop });
      else await drop();
    } catch (e) { console.warn("[party] exit", e); await drop(); }
    finally { this._exiting = false; }
  },

  // the party's own history entry (Back = the lobby's back, above); gone
  // with the party, so Back on the map is the page's own again
  _armBack(force = false) {
    if (!this.current || (!force && history.state?.randoParty)) return;
    try { history.pushState({ randoParty: this.current.meta.code }, ""); } catch {}
  },
  _disarmBack() {
    if (!history.state?.randoParty) return;
    this._popOwn = true;
    try { history.back(); } catch { this._popOwn = false; }
  },

  async leave() {
    const c = this.current;
    if (!c) return;
    closePartyCard();
    directory.stopAnnouncing(c.room.id);
    c.lobby?.destroy();
    closeCard($("party-panel"), true);
    c.room.leave();
    this.current = null;
    this.pickerOpen = false; this.chatOpen = false;
    trash.flush("left the party");          // photos + entries die with the party
    this.render();
    this._syncPause();
  },

  // public parties only. The announce (partyhouse.js announceFor) carries
  // the party's ZONE (id + the zone's own centre, which is public), never
  // where the host is; it's re-read every few seconds, so the count, the
  // game and its round stay current.
  _announce() {
    const c = this.current;
    if (!FLAGS.PUBLIC_PARTIES || c?.meta.privacy !== "public") return;
    directory.announce(() => (this.current === c && c.meta.privacy === "public" ? announceFor(c, this.me) : { id: c.room.id, gone: true }));
  },
  // host: public <-> invite only, from the party settings. Going invite only
  // takes the house off everyone's map now (the directory's "gone"); going
  // public asks for verification first, like throwing a public party.
  async setPrivacy(privacy) {
    const c = this.current;
    if (!c?.room.isHost || !FLAGS.PUBLIC_PARTIES || c.meta.privacy === privacy) return;
    if (privacy === "public") {
      if (this.hooks.gate && !(await this.hooks.gate("public"))) return;
      if (this.current !== c || !c.room.isHost) return;
      c.meta.privacy = "public";
      if (!c.zone) await this._findZone();
      this._announce();
    } else {
      c.meta.privacy = "private";
      directory.stopAnnouncing(c.room.id);
    }
    sfx.pop();
    this._sendMeta();
    this._renderPicker();
  },
  // the host's presence zone, snapped on this phone (backend.js); a new host
  // after a hand-off looks up their own
  async _findZone() {
    const c = this.current; if (!c) return;
    try { const z = await this.hooks.beaconZone?.(); if (z && this.current === c) c.zone = z; }
    catch (e) { console.warn("[party] no zone for the beacon (still listed, no map house)", e?.message ?? e); }
  },

  _wire(room) {
    const c = this.current;
    room.onPresence = () => {
      if (this.current !== c) return;
      const here = new Set(room.members.map(x => x.id));
      const arrived = [...here].filter(id => !c.here?.has(id));
      c.here = here;
      if (room.isHost) {
        c.meta.hostId = this.me.id; c.meta.hostName = this.me.handle;
        c.votes = Object.fromEntries(Object.entries(c.votes ?? {}).filter(([id]) => here.has(id)));
        if (c.meta.privacy === "public" && !directory.announcing) { if (!c.zone) this._findZone().then(() => this._announce()); else this._announce(); }
        this._sendMeta();
        this._enforceCap();
        for (const id of arrived) this._resume(id);
      } else {
        if (directory.announcing) directory.stopAnnouncing();
        this.pickerOpen = false;               // only the host has a picker
      }
      this.render();
    };
    room.on("hello", m => { if (room.isHost) { this._sendMeta(); this._resume(m.from); } });
    // someone looking at an invite link (net.js peekRoom): who's here, what's on.
    // Only what joining would show them anyway.
    room.on("peek", m => {
      if (!room.isHost || !/^peek-/.test(m.from ?? "")) return;
      const ms = room.members;
      room.send("peekinfo", { to: m.from, info: {
        name: c.meta.name, hostName: this.me.handle, vibe: c.meta.vibe, cap: c.meta.cap, count: ms.length,
        members: ms.slice(0, 8).map(x => ({ id: x.id, handle: x.handle, avatar: x.avatar })),
        playing: c.launched ? c.playing ?? null : null,
      } });
    });
    room.on("meta", m => {
      if (room.isHost) return;
      c.meta = { ...c.meta, name: m.name, vibe: m.vibe, cap: m.cap, hostName: m.hostName, privacy: m.privacy ?? c.meta.privacy, settings: { ...c.meta.settings, ...(m.settings ?? {}) }, playing: m.playing ?? null, playingId: m.playingId ?? null };
      c.queue = m.queue ?? null;
      if (m.votes) c.votes = m.votes;
      if (m.set) c.set = m.set;
      for (const id of m.diaryUsed ?? []) c.session.diaryUsed.add(id);
      this.render();
    });
    // the host's "up next" changed
    // only the host's word counts — a stray message from anyone else is ignored
    room.on("queue", m => { if (m.from !== room.hostId) return; c.queue = m.queue ?? null; this._renderNext(); this._renderPicker(); });
    room.on("vote", m => this._onVote(m));
    room.on("chat", m => {
      if (this.blocked.has(m.from)) return;
      c.chat.push({ from: m.from, who: room.presence[m.from]?.handle ?? "someone", text: m.text });
      c.chat = c.chat.slice(-40);
      c.lobby?.say(m.from, m.text);
      this.renderChat();
    });
    room.on("launch", m => this._onLaunch(m));
    // someone waved (from their profile card of you, or anyone's)
    room.on("wave", m => {
      if (this.blocked.has(m.from)) return;
      c.lobby?.wave(m.from);
      if (m.to === this.me.id) { sfx.ping(); buzz(30); c.lobby?.say(m.from, `👋 hi ${this.me.handle}!`); }
    });
    // the host ended the party, or turned this phone away (past the cap): out to the map
    room.on("partyend", m => { if (m.from === room.hostId && !room.isHost && this.current === c) this.exit("ended"); });
    room.on("full", m => { if (m.id === this.me.id && this.current === c) this.exit("full"); });
  },
  _sendMeta() {
    const c = this.current; if (!c?.room.isHost) return;
    c.room.send("meta", {
      name: c.meta.name, vibe: c.meta.vibe, cap: c.meta.cap, hostName: this.me.handle, queue: c.queue,
      privacy: c.meta.privacy, settings: c.meta.settings, diaryUsed: [...c.session.diaryUsed],
      // a game in progress: someone who joins now waits in the lobby for the next one
      playing: c.launched ? c.playing ?? null : null,
      playingId: c.launched ? c.playingId ?? null : null,
      set: c.set, votes: c.votes ?? {},
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
    if (!c || !c.room.isHost || c.launched || !c.queue || c.set.done) return;
    const g = gameById(c.queue.game);
    if (!g) { this.err(`unknown game "${c.queue.game}"`); return; }
    const n = this.playerCount();
    if (n < minFor(g)) { this.err(`${g.title} needs ${minFor(g)}+ players · ${n} here`); return; }
    this.pickerOpen = false;
    c.votes = {};
    c.room.send("launch", { game: g.id, options: c.queue.options ?? {}, seed: (Date.now() % 1e9) | 0, at: Date.now() + 500 });
  },
  // host: put a member who's seated in the running game back into it. A phone
  // whose page reloaded mid-game (iOS does this to backgrounded tabs) comes
  // back with the same id, so presence counts it as here and every "is
  // everyone done?" check waits on it — but it never saw the launch, so it
  // can't play and each phase would run its full timer. Called when a member
  // arrives in presence and on their "hello" (either can be missed); a phone
  // already running the game ignores the spare launch. Only a seat in this
  // game gets back in: anyone new still waits for the next one.
  _resume(id) {
    const c = this.current;
    if (!c?.room.isHost || !c.launched || !c.launchMsg || !id || id === this.me.id) return;
    if (!c.ctx?.hostGame?.seated(id)) return;
    c.room.send("launch", { ...c.launchMsg, to: id });
  },
  _onLaunch(m) {
    const c = this.current;
    if (!c || c.launched) return;
    if (m.to && m.to !== this.me.id) return;     // a re-launch meant for one returning phone
    const g = gameById(m.game);
    if (!g) { this.err(`unknown game "${m.game}"`); return; }
    c.launched = true;
    // every phone keeps it: whoever is host when a phone comes back re-sends it
    c.launchMsg = { game: m.game, options: m.options ?? {}, seed: m.seed, at: m.at };
    c.votes = {};
    c.playing = g.title;
    c.playingId = g.id;
    this.pickerOpen = false;
    // most games cover the map; a game that asks for the room keeps the party
    // room on screen behind it, dimmed (the room's own bars and chat hide)
    const behind = g.backdrop === "room";
    $("party-panel").hidden = !behind;
    $("party-panel").classList.toggle("pt-behind", behind);
    if (behind) { this.pickerOpen = false; this._renderPicker(); }
    const humans = c.room.members.map(x => ({ id: x.id, handle: x.handle, avatar: x.avatar }));
    c.inGame = new Set(humans.map(x => x.id));   // (who has the launch: late seats get theirs in _watchGame)
    const ctx = {
      room: c.room, me: this.me, humans, seed: m.seed, isHost: () => c.room.isHost, party: c.meta,
      options: { ...defaultsFor(g), ...(m.options ?? {}) },
      session: c.session,
      drawPrompt: this.hooks.ritualDraw,
      onEnd: results => this._onGameEnd(c, results),
      // host, from a game's results: run it again straight away (a new batch,
      // and anyone who joined meanwhile is in)
      again: () => { c.again = true; },
    };
    c.ctx = ctx;
    this.hooks.beforeGame?.(g, c);
    c.setupPhases = g.hostSetup ?? [];
    c.behind = behind;
    try { g.start(ctx); }
    catch (e) { console.warn("[party] game start", e); trash.flush("game failed to start"); c.launched = false; c.launchMsg = null; $("party-panel").hidden = false; $("party-panel").classList.remove("pt-behind"); this.err(`${g.title} failed to start`); return; }
    if (c.room.isHost) this._announce();
    this._watchGame(c);
    this._syncPause();
  },

  // ---------------------------------------------------------------- host controls in a game
  // While a game runs: during the host's own setup screens (a game's
  // `hostSetup` phases: Side Quest's quest picking, Secret Diary's deal) the
  // host gets Back (top-left) and everyone else simply stays in the lobby, so
  // backing out changes nothing for them; in every other phase the host gets
  // End game (top-right), which asks first.
  _watchGame(c) {
    clearInterval(c.watch);
    const tick = () => {
      if (this.current !== c || !c.launched) { clearInterval(c.watch); this._hostCtl(null); return; }
      const phase = c.ctx?.hostGame?.s?.phase ?? null, host = c.room.isHost;
      const setup = !!phase && c.setupPhases.includes(phase);
      // someone who joined mid-game: once the game gives them a seat (a
      // `lateJoin` game, at its next round) they get the launch, like a phone
      // coming back from a reload, and start from the next snapshot
      if (host && c.ctx?.hostGame) for (const m of c.room.members) {
        if (c.inGame?.has(m.id) || !c.ctx.hostGame.seated(m.id)) continue;
        c.inGame?.add(m.id);
        this._resume(m.id);
      }
      this._hostCtl(host ? (setup ? "back" : "end") : null);
      const wait = !host && setup;
      if (wait !== !!c.setupWait) {
        c.setupWait = wait;
        document.body.classList.toggle("hp-setup-wait", wait);
        this._syncPause();
        $("party-panel").hidden = !wait && !c.behind;
        $("party-panel").classList.toggle("pt-behind", !wait && c.behind);
        this._renderNext();
      }
    };
    c.watch = setInterval(tick, 250);
    tick();
  },
  _hostCtl(mode) {
    const layer = $("game-layer");
    if (layer && !$("hp-back")) {
      layer.insertAdjacentHTML("beforeend", `<button type="button" id="hp-back" class="hp-ctl" hidden aria-label="Back to the lobby">&#8249; Back</button><button type="button" id="hp-end" class="hp-ctl" hidden>End game</button>`);
      $("hp-back").onclick = () => this.backOut();
      $("hp-end").onclick = () => this.askEnd();
    }
    const back = $("hp-back"), end = $("hp-end");
    if (back) back.hidden = mode !== "back";
    if (end) end.hidden = mode !== "end";
    document.body.classList.toggle("hp-ctl-back", mode === "back");
    document.body.classList.toggle("hp-ctl-end", mode === "end");
    if (mode !== "end") $("hp-end-ask")?.remove();
  },
  // host: leave a setup screen without starting anything
  backOut() {
    const c = this.current;
    if (!c?.launched || !c.room.isHost) return;
    sfx.back();
    c.ctx?.hostGame?.endByHost({ backout: true });
  },
  // host: "End this game for everyone?" first
  askEnd() {
    const c = this.current;
    if (!c?.launched || !c.room.isHost || $("hp-end-ask")) return;
    sfx.cursor();
    const ask = document.createElement("div");
    ask.id = "hp-end-ask"; ask.className = "hp-ask glass-scrim";
    ask.innerHTML = `<div class="hp-ask-card glass glass-dialog" role="alertdialog" aria-labelledby="hp-ask-t"><b id="hp-ask-t">End this game for everyone?</b>
      <p>Points so far still count on the party board. It won't count as one of the 3 games, and nobody gets coins for it.</p>
      <div class="hp-ask-btns"><button type="button" class="glass-btn clear sm" id="hp-ask-no">Cancel</button><button type="button" class="glass-btn gold sm hp-ask-yes" id="hp-ask-yes">End game</button></div></div>`;
    $("game-layer").appendChild(ask);
    $("hp-ask-no").onclick = () => { sfx.back(); ask.remove(); };
    ask.onclick = e => { if (e.target === ask) { sfx.back(); ask.remove(); } };
    $("hp-ask-yes").onclick = () => {
      ask.remove();
      const g = c.ctx?.hostGame;
      if (!g || this.current !== c || !c.launched) return;
      // already on its results: that's a normal finish, not a cut
      if (g.s?.phase === "end") g.finish(); else g.endByHost();
    };
  },
  _toast(text) {
    const wrap = document.querySelector("#party-panel .pt-floor-wrap") ?? $("party-panel"); if (!wrap) return;
    const t = document.createElement("div");
    t.className = "pt-toast glass-toast"; t.textContent = text;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  },
  // back to the lobby room between games; the queue survives so the host
  // can run the same game again or pick the next one
  _onGameEnd(c, results = null) {
    if (this.current !== c) return;
    this._lastGame = c.playingId;
    if (results?.completed) (c.played ??= []).push({ game: c.playingId, highlight: results.highlight ?? null, with: results.players.filter(p => !p.bot && !p.gone && p.id !== this.me.id).map(p => p.handle) });
    // the set: a completed game counts (party points, coins); a game cut
    // short doesn't. The host owns the set and shares it with the meta.
    if (results?.completed && !c.set.done) {
      const idx = c.set.games.length + 1, game = c.playingId;
      if (c.room.isHost) {
        c.set = addGame(c.set, game, results);
        this.hooks.coins?.reportGame({ session: c.set.session, set: c.set.no, idx, game, results }).catch(e => console.warn("[party] coin report", e?.message ?? e));
      }
      this._confirmPlayed(c, results, idx);
    }
    // the host ended it mid-way: what was earned still counts on the board;
    // no coins, and it isn't one of the set's 3 games
    if (results?.ended && !results.backout && c.room.isHost) c.set = addPartial(c.set, c.playingId, results);
    clearInterval(c.watch);
    this._hostCtl(null);
    c.setupWait = false;
    document.body.classList.remove("hp-setup-wait");
    c.ctx = null;
    c.launched = false;
    c.launchMsg = null;
    c.playing = null;
    trash.flush("game ended");           // uploaded photos + entries go now
    $("party-panel").hidden = false;
    $("party-panel").classList.remove("pt-behind");
    if (c.room.isHost) this._sendMeta();  // shares the session's used prompts
    this.render();
    if (results?.ended && !results.backout) this._toast(c.room.isHost ? "You ended the game." : "The host ended the game.");
    if (c.again) { c.again = false; if (c.room.isHost) setTimeout(() => { if (this.current === c && !c.launched) this.launch(); }, 400); }
    this.hooks.gameEnded?.(c, gameById(this._lastGame), results);
    if (c.room.isHost) this._announce();
    this._syncPause();
  },

  // I played this game: tell the coin ledger (it pays out only when the
  // host's report and my own confirmation agree), then show what I got
  async _confirmPlayed(c, results, idx) {
    const coins = this.hooks.coins;
    const mine = results.players.find(p => p.id === this.me.id && !p.gone && !p.bot);
    if (!coins || !mine) return;
    // a guest learns the set's session from the host's meta, which can trail the end by a moment
    for (let i = 0; i < 20 && !c.set.session && this.current === c; i++) await new Promise(r => setTimeout(r, 250));
    const g = { session: c.set.session, set: c.set.no, idx };
    if (!g.session) return;
    // earning coins needs a verified number: until then the game waits, unclaimed
    if (this.hooks.canEarn && !(await this.hooks.canEarn())) {
      (c.unclaimed ??= []).some(u => u.session === g.session && u.set === g.set && u.idx === g.idx) || c.unclaimed.push(g);
      if (this.current === c) this._claimToast(c);
      return;
    }
    await this._claim(c, g);
  },
  async _claim(c, g) {
    const coins = this.hooks.coins;
    try {
      await coins.confirmGame(g);
      await new Promise(r => setTimeout(r, 1800));      // let the host's report land
      const total = await coins.partyCoins(g);
      const before = c.coins[g.set] ?? 0;
      c.coins[g.set] = total;
      if (this.current === c && total > before) this._coinToast(total - before);
    } catch (e) { console.warn("[party] coin confirm", e?.message ?? e); }
  },
  // the games this phone played but couldn't collect yet: verify, then collect them all
  async claimUnclaimed(c = this.current) {
    if (!c?.unclaimed?.length || !this.hooks.gate || !(await this.hooks.gate("coins"))) return false;
    const list = c.unclaimed.splice(0);
    for (const g of list) await this._claim(c, g);
    return true;
  },
  _claimToast(c) {
    const wrap = document.querySelector("#party-panel .pt-floor-wrap"); if (!wrap || wrap.querySelector(".pt-claim")) return;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "pt-cointoast pt-claim glass-toast";
    el.innerHTML = `<i class="coin"></i><span>${esc(t("coins.claim"))}</span><b>${esc(t("coins.verify"))}</b>`;
    el.onclick = async () => { el.remove(); await this.claimUnclaimed(c); };
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 9000);
  },
  _coinToast(n) {
    const wrap = document.querySelector("#party-panel .pt-floor-wrap"); if (!wrap) return;
    const t = document.createElement("div");
    t.className = "pt-cointoast glass-toast";
    t.innerHTML = `<i class="coin"></i><b>+${n}</b> coins`;
    wrap.appendChild(t);
    coinBurst(t, 8);
    sfx.chime?.();
    setTimeout(() => t.remove(), 2600);
  },

  // ---------------------------------------------------------------- the set's end
  // after the last game: the podium for everyone; the host starts a new set
  // or ends the party
  _renderSetEnd() {
    const c = this.current; const host = $("party-panel"); if (!c || !host) return;
    if (!c.set.done || c.launched) { if (c._podium) { c._podium = null; closePodium(host); } return; }
    const key = `${c.set.session}:${c.set.no}`;
    if (c._podium === key) return;
    c._podium = key;
    const avatars = Object.fromEntries(c.room.members.map(m => [m.id, m.avatar]));
    const rows = standings(c.set, c.room.members.map(m => ({ id: m.id, handle: m.handle, avatar: m.avatar })));
    showPodium(host, c.set, rows, {
      me: this.me.id, avatars, isHost: c.room.isHost,
      onNewSet: () => { if (!c.room.isHost) return; sfx.confirm(); c.set = newSet(c.set.no + 1, c.set.session); c.queue = null; this._sendMeta(); this.render(); },
      onEnd: () => { if (!c.room.isHost) return; sfx.back(); c.room.send("partyend", {}); setTimeout(() => { if (this.current === c) this.exit("closed"); }, 300); },
    });
    sfx.win?.();
    this.hooks.setEnded?.(c, rows);
    // what I earned this party, from the server's ledger. The host reward
    // lands when the last player confirms game 3, which can trail the
    // podium, so look again a couple of times and update if it grew.
    const coins = this.hooks.coins;
    if (coins && c.set.session) {
      let shown = -1;
      const look = async () => {
        try {
          const total = await coins.partyCoins({ session: c.set.session, set: c.set.no });
          if (c._podium !== key || total === shown) return;
          showCoins($("pp-coins"), total, { note: total ? (shown >= 0 && c.room.isHost ? "incl. the host reward" : "") : "no coins this time (daily cap reached, or not in every game)" });
          shown = total;
        } catch (e) { console.warn("[party] coins", e?.message ?? e); }
      };
      for (const ms of [2600, 6000, 11000]) setTimeout(look, ms);
    }
  },

  // ---------------------------------------------------------------- the houses on the map
  // only public parties ever get a house (over their host, placed by zone:
  // partybeacon.js); it goes when the host stops announcing (the party's
  // over, it went invite only, the host left) or the entry expires, and
  // moves when a new host takes over and announces
  syncBeacons() {
    const houses = FLAGS.PUBLIC_PARTIES ? housesFrom(this.nearby) : [];
    partyBeacons.sync(houses, { me: this.me?.id ?? null });
    const open = this._card && houses.find(r => r.id === this._card);
    if (this._card && !open) closePartyCard();
    else if (open) this._patchCard(open);
  },
  // the bar's pull-to-refresh
  async refreshNearby() { this.syncBeacons(); if (!this.current) this._renderList(); },

  // tapped a house (or its host): the party card slides up — the host and
  // their character, the vibe, how many are in, what's on, Join. Joining is
  // the same as anywhere else (no proximity check; a public party asks for
  // phone verification, hooks.gate). Mid-game you go to the lobby and come
  // in at the next round or game; full: no.
  showCard(r) {
    const el = $("party-card"); if (!el || !r) return;
    closePartyCard();
    this._card = r.id;
    const name = r.name || t("ph.partyOf", { host: r.hostName ?? "" });
    el.innerHTML = `<div class="pc-sheet glass glass-sheet" role="dialog" aria-modal="true" aria-labelledby="pc-name">
        <div class="y-card-grip"></div>
        <div class="pc-head"><div class="pc-char" id="pc-char" aria-hidden="true"></div>
          <div class="pc-who"><b id="pc-name">${esc(name)}</b>
          <small><i class="lr-crown" aria-label="host"></i>${esc(t("room.hosting", { host: r.hostName ?? "" }))}</small>
          <div class="pc-stats">${VIBES.includes(r.vibe) ? `<span class="pc-vibe v-${esc(r.vibe)}">${esc(t(`ph.vibe.${r.vibe}`))}</span>` : ""}<span class="pc-count"></span></div></div></div>
        <div class="pc-status"><i class="pc-dot" aria-hidden="true"></i><span></span></div>
        <div class="pc-next" hidden></div>
        <button type="button" class="glass-btn gold pc-join" id="pc-join"></button>
        <button type="button" class="glass-btn clear sm pc-later" id="pc-close">${esc(t("ph.later"))}</button>
        <div class="pc-note">${esc(t("ph.note"))}</div>
      </div>`;
    el.hidden = false;
    sfx.open();
    this._cardView = r.look ? mountCharView($("pc-char"), r.look, { yaw: 0.45 }) : null;
    this._patchCard(r);
    $("pc-close").onclick = () => { sfx.back(); closePartyCard(); };
    $("pc-join").onclick = async () => {
      const cur = housesFrom(this.nearby).find(x => x.id === r.id) ?? r;
      if (!this._joinState(cur).can) return;
      if (this.hooks.gate && !(await this.hooks.gate("public"))) return;
      closePartyCard(); this.togglePanel(true); this.join(r.id);
    };
    el.onclick = e => { if (e.target === el) { sfx.back(); closePartyCard(); } };
  },
  _joinState(r) { return joinState(r, { mine: this.current?.room.id === r.id, lateJoin: !!gameById(r.game)?.lateJoin }); },
  // the card's live parts, patched in place as the announce changes (count,
  // lobby / game and round, full)
  _patchCard(r) {
    const el = $("party-card"); if (!el || el.hidden) return;
    const js = this._joinState(r), q = s => el.querySelector(s);
    const set = (s, text) => { const n = q(s); if (n && n.textContent !== text) n.textContent = text; };
    set(".pc-count", t("ph.players", { n: r.count, cap: r.cap }));
    q(".pc-count")?.classList.toggle("full", js.why === "full");
    set(".pc-status span", statusText(r, t, gameTitle));
    q(".pc-status")?.classList.toggle("live", r.state === "playing");
    const next = q(".pc-next");
    if (next) { next.hidden = !(js.why === "nextRound" || js.why === "nextGame"); set(".pc-next", next.hidden ? "" : t(js.why === "nextRound" ? "ph.nextRound" : "ph.nextGame")); }
    const btn = q("#pc-join");
    if (btn) { btn.disabled = !js.can; set("#pc-join", js.why === "mine" ? t("ph.mine") : js.why === "full" ? t("ph.full") : t("ph.join")); }
  },
  _card: null,

  // the map underneath stops drawing while the party room or a game covers it
  _syncPause() {
    const c = this.current, shown = !$("party-panel").hidden;
    // a game played on the map (Manhunt) keeps it running under the game
    const onMap = !!c?.launched && !!gameById(c.playingId)?.map && !c.setupWait;
    world3d.setPaused?.(!!c && (c.launched || shown) && !onMap);
    document.body.classList.toggle("hp-on-map", onMap);
    // the map's bar and chat stay out of the party room (and its games);
    // the Host tab is lit while the host-a-party menu is open, and while
    // you're in a party it's "My party" (its gold ring filled): it goes back
    // to the room
    document.body.classList.toggle("in-lobby", !!c && (c.launched || shown));
    const host = document.getElementById("nav-host");
    if (host) {
      host.classList.toggle("on", !c && shown);
      host.classList.toggle("hosting", !!c);
      host.querySelector(".nav-lbl").textContent = c ? "My party" : "Host";
      host.setAttribute("aria-label", c ? "Back to my party" : "Host a party");
    }
  },

  // ---------------------------------------------------------------- UI
  togglePanel(force) {
    const p = $("party-panel");
    const was = p.hidden;
    p.hidden = force === undefined ? !p.hidden : !force;
    if (!p.hidden) { this.render(); if (was) { p.classList.remove("y-in-wipe"); void p.offsetWidth; p.classList.add("y-in-wipe"); } }
    this._syncPause();
  },
  err(msg) { const el = $("pt-err"); if (el) el.textContent = msg || ""; if (msg) $("party-panel").hidden = false; },
  // the host form again (its "<name>'s party" once the name is set)
  refreshForm() { if (!this.current) { this._view = null; this.render(); } },

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
        const bots = BOTS_N ? makeBots(BOTS_N, mulberry(7)).map(b => ({ id: b.id, handle: b.handle, avatar: b.avatar })) : [];
        c.lobby = new LobbyRoom($("pt-floor"), c.room, this.me, {
          bots: c.room.isHost ? bots : [], vibe: c.meta.vibe,
          onTV: () => this._onTV(), onPerson: id => this.openProfile(id),
        });
        c.lobby.hide(this.blocked);
      }
    }
    if (c) { this._renderLobby(); this.renderChat(); }
    else this._renderList();
  },

  // host a party: a dark console menu (drifting glow particles), big tiles,
  // one glossy button. Joining by code sits under it.
  _outHtml() {
    const f = this.form;
    const VIBE_ART = { chill: "☾", chaotic: "✦", sporty: "➶" };
    return `<div class="pt-menu">
      <div class="pt-mhead"><b>host a party</b><span id="pt-mute"></span><button id="pt-close" class="glass-icon sm" type="button" aria-label="Close">&#10005;</button></div>
      <label class="pt-lbl" for="pt-name">party name</label>
      <input id="pt-name" class="y-input" maxlength="${PARTY.NAME_MAX}" placeholder="${esc(this.me?.handle ?? "my")}'s party" value="${esc(f.name)}" autocomplete="off">
      <div class="pt-lbl">vibe <small>— picks the room's neon, every game works with any vibe</small></div>
      <div class="pt-tiles three" id="pt-vibe">${VIBES.map(v => `<button type="button" class="pt-tile v-${v} ${f.vibe === v ? "on" : ""}" data-vibe="${v}"><i aria-hidden="true">${VIBE_ART[v] ?? "★"}</i>${v}</button>`).join("")}</div>
      <div class="pt-lbl">players</div>
      <div class="pt-step"><button type="button" class="glass-btn clear xs fit" data-cap="-1" aria-label="fewer">&#9664;</button><b class="pt-capv" id="pt-capv">${f.cap}</b><span>max</span><button type="button" class="glass-btn clear xs fit" data-cap="1" aria-label="more">&#9654;</button>
        <input id="pt-cap" type="hidden" value="${f.cap}"></div>
      ${FLAGS.PUBLIC_PARTIES ? `<div class="pt-lbl">who can come</div>
      <div class="pt-tiles two" id="pt-priv">
        <button type="button" class="pt-tile ${f.privacy !== "public" ? "on" : ""}" data-priv="private"><i aria-hidden="true">✉</i>invite only<small>code or link</small></button>
        <button type="button" class="pt-tile ${f.privacy === "public" ? "on" : ""}" data-priv="public"><i aria-hidden="true">⌂</i>public<small>a house on the map</small></button></div>` : ""}
      <button id="pt-create" class="glass-btn gold pt-big" type="button">throw the party &#9654;</button>
      <div id="pt-err" class="pt-err"></div>
      ${FLAGS.PUBLIC_PARTIES ? `<div class="pt-sep"><span>parties nearby</span></div><div id="pt-list"></div>` : ""}
      <div class="pt-sep"><span>got an invite code?</span></div>
      <form id="pt-code-form" class="pt-codeform"><input id="pt-code" class="y-input pt-codein" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off" spellcheck="false"><button type="submit" class="glass-btn clear sm fit">join</button></form>
      ${FLAGS.PUBLIC_PARTIES ? "" : `<div class="pt-note">parties are invite-only this build — share the code or the link</div>`}
    </div>`;
  },
  // the lobby: a full-screen room you walk around in, with the up-next bar
  // underneath and the host's picker as an overlay on top
  _inHtml() {
    return `<div class="pt-top">
        <div class="pt-top-row">
          <button id="pt-back" type="button" class="pt-icon glass-icon pt-back" aria-label="${esc(t("room.back"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg></button>
          <b id="pt-title">party</b>
          <span id="pt-mute"></span>
          <button id="pt-hostmenu" type="button" class="pt-icon glass-icon" hidden aria-label="${esc(t("room.hostMenu"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg></button>
        </div>
        <div class="pt-top-row">
          <div id="pt-sub" class="rp-sub"></div>
          <span class="pt-invite">${t("room.invite")}</span><button id="pt-code-chip" type="button" class="pt-code-chip" title="share the invite" aria-label="invite code — tap to share"></button>
        </div>
      </div>
      <div class="pt-floor-wrap">
        <div id="pt-floor"></div>
        <div id="pt-chat-feed" class="pt-chat-float"></div>
        <div id="pt-empty" class="pt-empty-card" hidden></div>
      </div>
      <div class="pt-bottom">
        <div id="pt-next" class="pt-next"></div>
        <div id="pt-err" class="pt-err"></div>
        <form id="pt-chat-form"><input id="pt-chat-input" maxlength="160" placeholder="${t("room.say")}" autocomplete="off"><button type="submit" class="glass-icon" aria-label="send">&#8593;</button><button type="button" id="pt-vote" class="glass-btn gold xs pt-vote"></button></form>
      </div>
      <div id="pt-picker" class="pt-picker" hidden></div>`;
  },
  _bind() {
    const p = $("party-panel");
    p.querySelector("#pt-mute")?.replaceChildren(muteButton());
    p.querySelector("#pt-close")?.addEventListener("click", () => { sfx.back(); this.togglePanel(false); });
    // one way out of the lobby: back, top left, after a "Leave the party?"
    p.querySelector("#pt-back")?.addEventListener("click", () => { sfx.back(); this.confirmLeave(); });
    // the host's menu: the game votes sheet with the party's settings
    p.querySelector("#pt-hostmenu")?.addEventListener("click", () => { const c = this.current; if (!c || c.launched || c.set.done) return; this.settingsOpen = true; this._onTV(); });
    p.querySelector("#pt-name")?.addEventListener("input", e => { this.form.name = e.target.value; });
    p.querySelectorAll("[data-vibe]").forEach(b => b.onclick = () => {
      this.form.vibe = b.dataset.vibe; sfx.cursor();
      p.querySelectorAll("[data-vibe]").forEach(x => x.classList.toggle("on", x === b));
    });
    p.querySelectorAll("[data-priv]").forEach(b => b.onclick = async () => {
      // going public asks for a verified number right here (with its reason); no = stays invite only
      if (b.dataset.priv === "public" && this.hooks.gate && !(await this.hooks.gate("public"))) return;
      this.form.privacy = b.dataset.priv; sfx.cursor();
      p.querySelectorAll("[data-priv]").forEach(x => x.classList.toggle("on", x === b));
    });
    p.querySelectorAll("[data-cap]").forEach(b => b.onclick = () => {
      this.form.cap = Math.max(PARTY.CAP_MIN, Math.min(PARTY.CAP_MAX, (+this.form.cap || PARTY.CAP_DEFAULT) + +b.dataset.cap));
      $("pt-capv").textContent = this.form.cap; $("pt-cap").value = this.form.cap; sfx.cursor();
    });
    p.querySelector("#pt-create")?.addEventListener("click", () => {
      this.form.name = $("pt-name")?.value ?? "";
      this.form.cap = +($("pt-cap").value || PARTY.CAP_DEFAULT);
      sfx.confirm();
      this.create();
    });
    p.querySelector("#pt-code-form")?.addEventListener("submit", e => { e.preventDefault(); this.joinByCode($("pt-code").value); });
    p.querySelector("#pt-code-chip")?.addEventListener("click", () => this.invite());
    p.querySelector("#pt-vote")?.addEventListener("click", () => { this.pickerOpen = true; sfx.open(); this._renderPicker(); });
    p.querySelector("#pt-chat-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const inp = $("pt-chat-input"), text = inp.value.trim().slice(0, 160);
      if (text && this.current) { this.current.room.send("chat", { text }); inp.value = ""; inp.blur(); }
    });
  },

  // the invite: the sheet (onboard.js: share, messages, copy, QR, contacts),
  // or the phone's share sheet where there's none
  invite() {
    const c = this.current; if (!c) return;
    if (this.hooks.invite) { this.hooks.invite(c); return; }
    shareText(`${t("inv.msg", { name: c.meta.name, url: this.link(c) })} (${c.meta.code})`);
  },
  link(c = this.current) { return c ? inviteLink(c.meta.code, { name: c.meta.name, count: c.room.members.length }) : ""; },

  // alone in your own party: the invite, big, with the QR for friends right here
  _renderEmpty() {
    const c = this.current, el = $("pt-empty"); if (!c || !el) return;
    const alone = c.room.isHost && c.room.members.length + BOTS_N < 2 && !c.launched && !c.set.done && !c.emptyDismissed;
    if (el.hidden === !alone && el.dataset.code === c.meta.code) return;
    el.hidden = !alone; el.dataset.code = c.meta.code;
    if (!alone) { el.innerHTML = ""; return; }
    el.classList.add("glass", "glass-dialog");
    el.innerHTML = `<button type="button" class="pt-empty-x glass-icon sm" aria-label="Close">&#10005;</button>
      <b>${esc(t("room.empty"))}</b>
      <div class="pt-empty-qr">${qrSvg(this.link(c))}</div>
      <p>${esc(t("inv.qr"))}</p>
      <button type="button" class="glass-btn gold sm pt-empty-inv">${esc(t("room.invite"))}</button>`;
    el.querySelector(".pt-empty-x").onclick = () => { c.emptyDismissed = true; sfx.back(); this._renderEmpty(); };
    el.querySelector(".pt-empty-inv").onclick = () => { sfx.confirm(); this.invite(); };
  },

  _renderList() {
    const el = $("pt-list"); if (!el) return;
    const sig = this.nearby.map(r => `${r.id}:${r.name}:${r.count}/${r.cap}:${r.state}:${r.game}:${r.round}`).join("|");
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    if (!this.nearby.length) { el.innerHTML = `<div class="pt-empty">none right now</div>`; return; }
    el.innerHTML = this.nearby.map(r => `<div class="rl-row"><div class="rl-dot pt-dot"></div><div><b>${esc(r.name ?? r.hostName)}</b><span>${r.count}/${r.cap} · ${esc(statusText(r, t, gameTitle))}</span></div><button type="button" data-join="${esc(r.id)}" ${this._joinState(r).can ? "" : "disabled"}>join</button></div>`).join("");
    el.querySelectorAll("button[data-join]").forEach(b => b.onclick = async () => {
      if (this.hooks.gate && !(await this.hooks.gate("public"))) return;
      this.join(b.dataset.join);
    });
  },

  _renderLobby() {
    const c = this.current;
    const host = c.room.presence[c.room.hostId]?.handle ?? c.meta.hostName;
    $("pt-title").textContent = c.meta.name;
    $("pt-hostmenu").hidden = !c.room.isHost;
    $("pt-sub").textContent = `${c.meta.vibe} · ${t("room.hosting", { host })} · ${c.room.members.length}/${c.meta.cap}${BOTS_N ? ` (+${BOTS_N} bots)` : ""}`;
    const chip = $("pt-code-chip");
    if (chip.textContent !== c.meta.code) chip.innerHTML = [...c.meta.code].map(ch => `<span>${esc(ch)}</span>`).join("");
    c.lobby?.setBackground(LOBBY_BG[c.meta.vibe] ?? LOBBY_BG.chill);
    c.lobby?.setVibe(c.meta.vibe);
    c.lobby?.sync();
    // everyone's 3D look, rendered while the room hangs out: the game scenes
    // (Side Quest's ball, the Ritual's capsules) show them without a wait
    warmLooks(c.room.members.map(m => m.avatar ?? {}));
    this._renderNext();
    this._renderPicker();
    this._renderSetEnd();
    this._renderEmpty();
  },

  // under the room: one status line, then chat + the vote button
  _renderNext() {
    const c = this.current; const el = $("pt-next"); if (!c || !el) return;
    const isHost = c.room.isHost, host = c.room.presence[c.room.hostId]?.handle ?? "the host";
    const playing = !isHost && c.meta.playing;      // a game started before you got here
    const late = playing && gameById(c.meta.playingId)?.lateJoin;   // …which takes you at its next round
    const nVotes = Object.keys(c.votes ?? {}).length, mine = c.votes?.[this.me.id];
    const gameNo = t("room.gameNo", { n: nextGameNo(c.set), of: PARTY.GAMES_PER_SET });
    const line = c.setupWait ? t("room.lineSetup", { host, game: c.playing ?? "the next game" })
      : playing ? t(late ? "room.lineNextRound" : "room.linePlaying", { game: playing })
      : isHost ? (nVotes ? t("room.lineHostVotes", { gameNo, votes: nVotes === 1 ? t("room.votes1") : t("room.votesN", { n: nVotes }) }) : t("room.lineHost", { gameNo }))
      : mine ? t("room.lineVoted", { gameNo, game: gameTitle(mine), host }) : t("room.lineGuest", { gameNo, host });
    if (el.textContent !== line) el.textContent = line;
    const btn = $("pt-vote");
    if (btn) {
      const label = isHost ? `${t("room.votes")}${nVotes ? ` · ${nVotes}` : ""}` : mine ? t("room.voted") : t("room.voteNext");
      if (btn.textContent !== label) btn.textContent = label;
      btn.disabled = !!(c.launched || c.set.done);
    }
  },

  // ---------------------------------------------------------------- votes
  // Players vote for the next game (one each, changeable until the host
  // starts one). The host keeps the tally and shares it in the meta.
  vote(gameId) {
    const c = this.current; if (!c || c.room.isHost || c.launched || !gameById(gameId)) return;
    c.votes = { ...(c.votes ?? {}), [this.me.id]: gameId };          // shown at once; the host's meta confirms it
    c.room.send("vote", { game: gameId });
    sfx.cursor(); buzz(15);
    this._renderNext(); this._renderPicker();
  },
  _onVote(m) {
    const c = this.current;
    if (!c?.room.isHost || c.launched || !c.room.members.some(x => x.id === m.from) || !gameById(m.game)) return;
    c.votes = { ...(c.votes ?? {}), [m.from]: m.game };
    this._sendMeta();
    this._renderNext(); this._renderPicker();
  },
  // host: the per-game options (the Ritual's rounds), chosen in the votes sheet
  gameOption(gameId, key, value) {
    const c = this.current; if (!c?.room.isHost) return;
    c.gameOpts = { ...(c.gameOpts ?? {}), [gameId]: { ...(c.gameOpts?.[gameId] ?? {}), [key]: value } };
    sfx.cursor();
    this._renderPicker();
  },
  // host: tap a game in the votes sheet to start it
  startGame(gameId) {
    const c = this.current; const g = gameById(gameId);
    if (!c?.room.isHost || !g || c.launched || c.set.done) return;
    const need = Math.max(0, minFor(g) - this.playerCount());
    if (need) { const e = $("pv-err"); if (e) e.textContent = `${g.title} needs ${need} more ${need === 1 ? "player" : "players"}`; sfx.back?.(); return; }
    sfx.confirm();
    this.queue(gameId, c.gameOpts?.[gameId] ?? null);
    this.launch();
  },

  // the game list, as a sheet over the room: players vote, the host sees the
  // live tally (the leader marked) and taps a game to start it
  _renderPicker() {
    const c = this.current; const el = $("pt-picker"); if (!c || !el) return;
    const open = this.pickerOpen && !c.launched && !c.set.done;
    el.hidden = !open;
    if (!open) { el.dataset.sig = ""; el.dataset.shown = ""; return; }
    const isHost = c.room.isHost, n = this.playerCount();
    const votes = c.votes ?? {}, mine = votes[this.me.id];
    const count = id => Object.values(votes).filter(v => v === id).length;
    const sig = `${isHost ? 1 : 0}:${n}:${JSON.stringify(votes)}:${JSON.stringify(c.gameOpts ?? {})}:${JSON.stringify(c.meta.settings)}:${this.settingsOpen ? 1 : 0}:${c.meta.privacy}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const host = c.room.presence[c.room.hostId]?.handle ?? "the host";
    const total = Object.keys(votes).length;
    // always the catalog's order (one list, every screen); the host sees the
    // leader marked instead of the list re-sorting under their thumb
    const games = PARTY_CATALOG.map((g, i) => ({ g, i, v: count(g.id) }));
    const top = Math.max(0, ...games.map(x => x.v));
    const optsFor = g => {
      if (!isHost || !(g.options ?? []).length) return "";
      const cur = { ...defaultsFor(g), ...(c.gameOpts?.[g.id] ?? {}) };
      return `<span class="pv-opts">${g.options.map(opt => opt.choices.map(ch =>
        `<button type="button" class="pv-chip ${cur[opt.key] === ch.value ? "on" : ""}" data-opt="${esc(opt.key)}" data-val="${esc(ch.value)}" data-for="${g.id}">${esc(ch.label)}</button>`).join("")).join("")}</span>`;
    };
    const rows = games.map(({ g, v }) => {
      const need = Math.max(0, minFor(g) - n);
      const attr = isHost ? `data-game="${g.id}"` : `data-vote="${g.id}"`;
      return `<div class="pv-row ${mine === g.id ? "mine" : ""} ${need && isHost ? "short" : ""} ${isHost && v && v === top ? "lead" : ""}" ${attr} role="button" tabindex="0" aria-label="${esc(g.title)}${v ? `, ${v} vote${v === 1 ? "" : "s"}` : ""}">
          <span class="pv-art" aria-hidden="true">${CHANNEL_ART[g.id] ?? ""}</span>
          <span class="pv-t"><b>${esc(g.title)}</b>${g.id === FIRST_GAME && !c.set.games.length && c.set.no === 1 ? `<em class="pv-first">${esc(t("room.firstGame"))}</em>` : ""}<small>${mine === g.id ? "✓ your vote · " : ""}${need ? `needs ${need} more` : `${minFor(g)}+ players · ${esc(g.length ?? "")}`}</small>${optsFor(g)}</span>
          <span class="pv-n ${v ? "" : "zero"}">${v}<i>${v === 1 ? "vote" : "votes"}</i></span>
        </div>`;
    }).join("");
    const st = c.meta.settings ?? {};
    const dflt = DIARY.DEFAULT_MAX[c.meta.privacy === "public" ? "public" : "private"];
    const effMax = (st.diaryMax === "unhinged" && !st.adult) ? "spicy" : (st.diaryMax || dflt);
    const pub = c.meta.privacy === "public";
    const privHtml = FLAGS.PUBLIC_PARTIES ? `<div class="pt-opt"><span>${esc(t("ph.who"))}</span><div class="pt-row">
          <button type="button" class="pt-btn ${pub ? "" : "on"}" data-privacy="private">${esc(t("ph.private"))}</button>
          <button type="button" class="pt-btn ${pub ? "on" : ""}" data-privacy="public">${esc(t("ph.public"))}</button></div>
          <small>${esc(t(pub ? "ph.publicSub" : "ph.privateSub"))}</small></div>` : "";
    const settingsHtml = !isHost ? "" : `<div class="pt-settings pv-settings">
        <button type="button" class="pv-settings-h" id="pv-settings-h">Party settings <span>${this.settingsOpen ? "▴" : "▾"}</span></button>
        ${this.settingsOpen ? `${privHtml}<div class="pt-opt"><span>18+ party</span><div class="pt-row">
          <button type="button" class="pt-btn ${st.adult ? "" : "on"}" data-set="adult" data-val="0">Off</button>
          <button type="button" class="pt-btn ${st.adult ? "on" : ""}" data-set="adult" data-val="1">On — everyone's 18+</button></div>
          <small>unlocks unhinged content</small></div>
        <div class="pt-opt"><span>Secret Diary max level</span><div class="pt-row">${DIARY.LEVELS.map(l => {
          const locked = l === "unhinged" && !st.adult;
          return `<button type="button" class="pt-btn ${effMax === l ? "on" : ""}" data-set="diaryMax" data-val="${l}" ${locked ? "disabled" : ""}>${l}${l === dflt ? " (default)" : ""}</button>`;
        }).join("")}</div>
          <small>${st.adult ? "" : "unhinged needs 18+ on · "}levels still build up: rounds 1-2 mild, 3-4 up to spicy, then up to this</small></div>` : ""}
      </div>`;
    el.classList.add("glass-scrim");
    el.innerHTML = `<div class="pt-picker-sheet pv-sheet glass glass-sheet">
        <div class="pt-picker-head"><button type="button" class="pt-back glass-btn clear xs fit" id="pt-picker-back" aria-label="Back to the lobby">&#8249; Back</button><b>${esc(isHost ? t("room.pickHost") : t("room.pickGuest"))}</b><button type="button" class="pt-icon glass-icon sm" id="pt-picker-x" aria-label="Close">&#10005;</button></div>
        <p class="pv-sub">Game ${nextGameNo(c.set)} of ${PARTY.GAMES_PER_SET} · ${isHost ? `${total} vote${total === 1 ? "" : "s"} so far · tap a game to start it` : `one vote each — you can change it until ${esc(host)} starts a game`}</p>
        <div id="pv-err" class="pv-err"></div>
        <div class="pv-list">${rows}</div>
        ${settingsHtml}
      </div>`;
    if (!el.dataset.shown) { el.dataset.shown = "1"; popIn(el.querySelector(".pt-picker-sheet"), "pop"); }
    const close = () => { this.pickerOpen = false; sfx.back(); this._renderPicker(); };
    $("pt-picker-x").onclick = close;
    $("pt-picker-back").onclick = close;
    el.onclick = e => { if (e.target === el) close(); };          // tap the dimmed backdrop to close
    el.querySelectorAll("[data-vote]").forEach(r => r.onclick = () => this.vote(r.dataset.vote));
    el.querySelectorAll("[data-game]").forEach(r => r.onclick = e => { if (e.target.closest("[data-opt]")) return; this.startGame(r.dataset.game); });
    el.querySelectorAll("[data-opt]").forEach(b => b.onclick = e => { e.stopPropagation(); this.gameOption(b.dataset.for, b.dataset.opt, b.dataset.val); });
    const sh = $("pv-settings-h"); if (sh) sh.onclick = () => { this.settingsOpen = !this.settingsOpen; sfx.cursor(); this._renderPicker(); };
    el.querySelectorAll("[data-set]").forEach(b => b.onclick = () => {
      const k = b.dataset.set, v = b.dataset.val;
      this.setSetting(k, k === "adult" ? v === "1" : v);
    });
    el.querySelectorAll("[data-privacy]").forEach(b => b.onclick = () => this.setPrivacy(b.dataset.privacy));
  },

  // walked up to the TV: the same game list as the vote button
  _onTV() {
    const c = this.current; if (!c || c.launched || c.set.done) return;
    this.pickerOpen = true; sfx.open(); this._renderPicker();
  },

  // tapped someone in the room
  openProfile(id) {
    const c = this.current; if (!c) return;
    const m = c.room.members.find(x => x.id === id);
    const bot = !m && /^bot-/.test(id) ? c.lobby?.bots.find(b => b.id === id) : null;
    const person = m ?? bot; if (!person) return;
    sfx.pop();
    openCard($("party-panel"), { id, handle: person.handle, avatar: person.avatar ?? {}, status: person.status ?? "", badges: person.badges ?? [] }, {
      me: this.me, isHost: id === c.room.hostId,
      friend: !!this.hooks.isFriend?.(id), blocked: this.blocked.has(id),
      onWave: () => { c.room.send("wave", { to: id }); c.lobby?.wave(this.me.id); sfx.ping(); },
      onBlock: () => {
        const now = !this.blocked.has(id);
        if (now) this.blocked.add(id); else this.blocked.delete(id);
        saveBlocked(this.blocked); c.lobby?.hide(this.blocked); this.renderChat();
        return now;
      },
      onReport: reason => this.hooks.report ? this.hooks.report(id, reason, { party: c.meta.code }) : false,
    });
  },

  renderChat() {
    const c = this.current; const feed = $("pt-chat-feed"); if (!c || !feed) return;
    feed.innerHTML = c.chat.filter(l => !this.blocked.has(l.from)).slice(-4).map(l => `<div class="lc-msg"><b>${esc(l.who)}</b>${esc(l.text)}</div>`).join("");
  },
};

function closePartyCard() {
  const el = document.getElementById("party-card");
  party._cardView?.dispose(); party._cardView = null;
  if (el) { el.hidden = true; el.innerHTML = ""; }
  party._card = null;
}
