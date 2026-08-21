// Rando lobby system (demo build).
//
//  * NPC raid lobbies — one per archetype, tied to the NPC's real venue, on a
//    shared RARE schedule (net.raidStatus). While a window is open the NPC's
//    tag shows a live countdown, a beacon stands at the venue, and tapping
//    the NPC joins the raid lobby. When the countdown hits zero the lobby's
//    host launches the signature quest (bots fill empty seats).
//  * Player-hosted rooms — anyone hosts, picks a catalog game directly, and
//    the room is announced to the directory so people nearby see it (list +
//    a beacon at the host's spot with one orbiting dot per member).
import { Room, directory, raidStatus, fmtClock, RAID } from "./net.js";
import { world3d, ARCH_NPC_DEFS, geoPos } from "./world3d.js";
import { beacon, sfx, buzz, reveal } from "./fx.js";
import { CATALOG } from "./games.js";
import { QUESTS } from "./quests.js";

const $ = id => document.getElementById(id);
const ARCH_COLOR = { chill: 0x7dd3a0, chaos: 0xff4d6d, sporty: 0x4da6ff };

export const rooms = {
  me: null,                 // { id, handle, avatar } — set by backend after sign-in
  current: null,            // { room, kind, arch?, gameId?, launched }
  nearby: [],               // directory list
  _pinged: new Set(),       // windows we've already pinged for
  _raidTimer: null,

  init() {
    directory.start();
    directory.onChange(list => { this.nearby = list; this.renderList(); this.syncBeacons(); });
    $("rooms-btn").addEventListener("click", () => this.togglePanel());
    $("rooms-close").addEventListener("click", () => this.togglePanel(false));
    $("host-btn").addEventListener("click", () => this.showHostSheet(true));
    $("host-close").addEventListener("click", () => this.showHostSheet(false));
    $("room-leave").addEventListener("click", () => this.leave());
    $("room-start").addEventListener("click", () => this.startNow());
    $("room-chat-form").addEventListener("submit", e => {
      e.preventDefault();
      const inp = $("room-chat-input");
      if (inp.value.trim() && this.current) { this.current.room.send("chat", { text: inp.value.trim().slice(0, 160) }); inp.value = ""; }
    });
    // catalog picker
    const grid = $("host-grid");
    grid.innerHTML = "";
    const LANES = [["sporty", "SPORTY · bodies in space"], ["chaos", "CHAOS · nerve & bluff"], ["chill", "CHILL · talk & reveal"]];
    for (const [arch, label] of LANES) {
      const h = document.createElement("div");
      h.className = `lane-h lane-${arch}`; h.textContent = label;
      grid.appendChild(h);
      for (const g of CATALOG.filter(g => g.arch === arch)) {
        const b = document.createElement("button");
        b.type = "button"; b.className = `host-card hc-${arch}`;
        b.innerHTML = `<b>${g.title}</b><span>${g.blurb}</span><em>${g.minPlayers}–${g.maxPlayers} · ${g.length}</em>`;
        b.addEventListener("click", () => { this.showHostSheet(false); this.host(g.id); });
        grid.appendChild(b);
      }
    }
    clearInterval(this._raidTimer);
    this._raidTimer = setInterval(() => this.raidTick(), 500);
    this.raidTick();
  },

  // ---------------------------------------------------------------- NPC raids
  raidTick() {
    for (const def of ARCH_NPC_DEFS) {
      const st = raidStatus(def.arch);
      const q = QUESTS[def.arch];
      let txt;
      if (st.phase === "open") txt = `▶ ${q.title} · starts ${fmtClock(st.msToStart)}`;
      else if (st.phase === "live") txt = `● LIVE · ${q.title}`;
      else txt = `next ${fmtClock(st.msToOpen)}`;
      world3d.setNpcTimer(def.id, txt);
      // ping once when a window opens (sound + buzz) — attention, not a toast
      const key = `${def.arch}:${st.windowId}`;
      if (st.phase === "open" && !this._pinged.has(key)) { this._pinged.add(key); sfx.open(); buzz([30, 40, 30]); }
    }
    this.syncBeacons();
    if (this.current?.kind === "npc") this.renderRoom();
    if (!$("rooms-panel").hidden) this.renderList();
  },

  syncBeacons() {
    for (const def of ARCH_NPC_DEFS) {
      const st = raidStatus(def.arch);
      const rec = world3d.archRecs[def.id];
      if (!rec) continue;
      const id = `npc-${def.arch}`;
      const live = st.phase === "live";
      if (st.phase === "open" || live) {
        const ann = this.nearby.find(r => r.id === `npc-${st.windowId}`);
        const count = ann?.count ?? (this.current?.arch === def.arch ? this.current.room.members.length : 0);
        beacon.set(id, rec.api.group.position, { count, color: ARCH_COLOR[def.arch], live,
          label: live ? `${def.name} · LIVE` : `${def.name} · ${fmtClock(st.msToStart)}` });
      } else beacon.clear(id);
    }
    // player rooms: beacon where the host stands
    const seen = new Set();
    for (const r of this.nearby) {
      if (r.kind !== "player" || r.x === undefined) continue;
      seen.add(r.id);
      beacon.set(`room-${r.id}`, { x: r.x, y: r.y ?? 0, z: r.z }, { count: r.count, color: 0xffd60a, live: r.state === "playing",
        label: `${r.hostName} · ${CATALOG.find(g => g.id === r.game)?.title ?? r.game} · ${r.count}` });
    }
    // (beacon ids for rooms that vanished get cleared lazily)
    for (const id of this._roomBeacons || []) if (!seen.has(id)) beacon.clear(`room-${id}`);
    this._roomBeacons = [...seen];
  },

  // tapping an NPC in the world
  onNpcTap(def) {
    const st = raidStatus(def.arch);
    const q = QUESTS[def.arch];
    $("npc-portrait").src = `npcs/${def.arch}_portrait.jpg`;
    $("npc-name").textContent = def.name;
    $("npc-venue").textContent = q.venue;
    const line = st.phase === "open" ? q.lineOpen : st.phase === "live" ? q.lineLive : q.lineDark;
    $("npc-line").textContent = `${line}\n\n${q.title} — ${q.tagline}`;
    const yes = $("npc-yes"), no = $("npc-no"), dev = $("npc-dev");
    if (st.phase === "open") { yes.hidden = false; yes.textContent = `join · starts ${fmtClock(st.msToStart)}`; }
    else { yes.hidden = true; }
    no.textContent = st.phase === "dark" ? `next window in ${fmtClock(st.msToOpen)}` : st.phase === "live" ? `running now · next in ${fmtClock(st.msToOpen ?? 0)}` : "not now";
    dev.hidden = st.phase !== "dark";
    dev.onclick = () => { RAID._devOpen[def.arch] = Date.now() + 3000; $("npc-card").hidden = true; this.raidTick(); };
    yes.onclick = () => { $("npc-card").hidden = true; this.joinNpc(def.arch); };
    no.onclick = () => { $("npc-card").hidden = true; };
    $("npc-card").hidden = false;
  },

  async joinNpc(arch) {
    const st = raidStatus(arch);
    if (st.phase === "dark") return;
    if (st.phase === "live" && !this.current) {
      // mid-quest joining (spectating) isn't built yet — say so instead of stranding them in a lobby
      const { ui } = await import("./gamekit.js");
      ui.show(); ui.toast(`${QUESTS[arch].title} is already running — next window opens in ${fmtClock(st.msToOpen ?? 0)}`, "phase");
      setTimeout(() => { if (!this.current) ui.hide(); }, 3600);
      return;
    }
    await this.leave();
    const id = `npc-${st.windowId}`;
    const room = new Room(id, this.me);
    this.current = { room, kind: "npc", arch, launched: false, startAt: st.startAt };
    this._wire(room);
    await room.join();
    $("room-panel").hidden = false;
    this.renderRoom();
    // the NPC notices you: small reveal when the first person arrives
    if (room.members.length === 1) reveal(arch);
    this._announce();
  },

  // ---------------------------------------------------------------- player rooms
  async host(gameId) {
    await this.leave();
    const id = `p-${this.me.id.slice(0, 6)}-${Date.now().toString(36)}`;
    const room = new Room(id, this.me);
    this.current = { room, kind: "player", gameId, launched: false };
    this._wire(room);
    await room.join();
    $("room-panel").hidden = false;
    this.togglePanel(false);
    this.renderRoom();
    this._announce();
  },
  async join(id, info) {
    await this.leave();
    const room = new Room(id, this.me);
    this.current = { room, kind: "player", gameId: info.game, launched: false };
    this._wire(room);
    await room.join();
    $("room-panel").hidden = false;
    this.togglePanel(false);
    this.renderRoom();
  },

  _announce() {
    const c = this.current;
    directory.announce(() => {
      const p = world3d.player?.api.group.position;
      return c.kind === "npc"
        ? { id: c.room.id, kind: "npc", arch: c.arch, count: c.room.members.length, state: c.launched ? "playing" : "lobby" }
        : { id: c.room.id, kind: "player", game: c.gameId, hostName: this.me.handle, count: c.room.members.length,
            state: c.launched ? "playing" : "lobby", x: p ? +p.x.toFixed(1) : undefined, y: p ? +p.y.toFixed(1) : 0, z: p ? +p.z.toFixed(1) : undefined };
    });
  },

  _wire(room) {
    room.onPresence = () => {
      this.renderRoom();
      // host election can change; only the host announces
      if (room.isHost && !directory.announcing) this._announce();
      if (!room.isHost && directory.announcing) directory.stopAnnouncing();
    };
    room.on("chat", m => this.appendChat(m));
    room.on("launch", m => this._onLaunch(m));
  },

  // ---------------------------------------------------------------- launch
  startNow() {
    const c = this.current;
    if (!c || !c.room.isHost || c.launched) return;
    const seed = (Date.now() % 1e9) | 0;
    c.room.send("launch", { game: c.kind === "npc" ? `quest:${c.arch}` : c.gameId, seed, at: Date.now() + 1500 });
  },
  _onLaunch(m) {
    const c = this.current;
    if (!c || c.launched) return;
    c.launched = true;
    $("room-panel").hidden = true;
    const humans = c.room.members.map(x => ({ id: x.id, handle: x.handle, avatar: x.avatar }));
    const ctx = {
      room: c.room, me: this.me, humans, seed: m.seed, isHost: () => c.room.isHost,
      onEnd: () => this._onGameEnd(),
    };
    if (m.game.startsWith("quest:")) {
      const arch = m.game.split(":")[1];
      QUESTS[arch].start(ctx);
    } else {
      const g = CATALOG.find(x => x.id === m.game);
      g?.start(ctx);
    }
    if (c.room.isHost) this._announce();
  },
  _onGameEnd() {
    const c = this.current;
    if (!c) return;
    c.launched = false;
    if (c.kind === "npc") { this.leave(); return; }   // raid window is over
    $("room-panel").hidden = false;
    this.renderRoom();
    if (c.room.isHost) this._announce();
  },

  async leave() {
    const c = this.current;
    if (!c) return;
    directory.stopAnnouncing(c.room.id);
    c.room.leave();
    this.current = null;
    $("room-panel").hidden = true;
    $("room-chat-feed").innerHTML = "";
  },

  // ---------------------------------------------------------------- UI
  togglePanel(force) {
    const p = $("rooms-panel");
    p.hidden = force === undefined ? !p.hidden : !force;
    if (!p.hidden) this.renderList();
  },
  showHostSheet(on) { $("host-sheet").hidden = !on; },

  renderList() {
    const el = $("rooms-list");
    if (!el) return;
    let h = `<div class="rl-h">NPC quests · raid windows</div>`;
    for (const def of ARCH_NPC_DEFS) {
      const st = raidStatus(def.arch); const q = QUESTS[def.arch];
      const ann = this.nearby.find(r => r.id === `npc-${st.windowId}`);
      const cnt = ann ? `${ann.count} waiting` : "";
      const status = st.phase === "open" ? `<b class="open">OPEN · starts ${fmtClock(st.msToStart)}</b>`
        : st.phase === "live" ? `<b class="live">LIVE</b>` : `<span>next in ${fmtClock(st.msToOpen)}</span>`;
      h += `<div class="rl-row arch-${def.arch}"><img src="npcs/${def.arch}_portrait.jpg" alt=""><div><b>${q.title}</b><span>${def.name} · ${q.venue}</span><span>${status} ${cnt}</span></div>`
        + (st.phase !== "dark" ? `<button data-npc="${def.arch}">join</button>` : `<button data-devopen="${def.arch}" class="ghost">open now</button>`) + `</div>`;
    }
    const prs = this.nearby.filter(r => r.kind === "player");
    h += `<div class="rl-h">Player rooms nearby ${prs.length ? "" : "· none yet"}</div>`;
    for (const r of prs) {
      const g = CATALOG.find(x => x.id === r.game);
      h += `<div class="rl-row"><div class="rl-dot"></div><div><b>${g?.title ?? r.game}</b><span>hosted by ${r.hostName} · ${r.count} in · ${r.state}</span></div><button data-join="${r.id}" data-game="${r.game}">join</button></div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll("button[data-npc]").forEach(b => b.onclick = () => { this.togglePanel(false); this.joinNpc(b.dataset.npc); });
    el.querySelectorAll("button[data-devopen]").forEach(b => b.onclick = () => { RAID._devOpen[b.dataset.devopen] = Date.now() + 3000; this.raidTick(); this.renderList(); });
    el.querySelectorAll("button[data-join]").forEach(b => b.onclick = () => { this.join(b.dataset.join, { game: b.dataset.game }); });
  },

  renderRoom() {
    const c = this.current;
    if (!c) return;
    const ms = c.room.members;
    let title, sub, cd = "";
    if (c.kind === "npc") {
      const q = QUESTS[c.arch]; const st = raidStatus(c.arch);
      title = q.title; sub = `${q.venue} · ${q.tagline}`;
      cd = st.phase === "open" ? `starts in ${fmtClock(st.msToStart)}` : st.phase === "live" ? "LIVE — host can launch" : "window closed";
      // auto-launch: host fires when the countdown hits zero
      if (st.phase === "live" && c.room.isHost && !c.launched && !c._autoFired) { c._autoFired = true; this.startNow(); }
    } else {
      const g = CATALOG.find(x => x.id === c.gameId);
      title = g?.title ?? c.gameId; sub = g?.blurb ?? "";
      cd = `${ms.length} in the room · needs ${g?.minPlayers ?? 2}+ (bots fill the rest)`;
    }
    $("room-title").textContent = title;
    $("room-sub").textContent = sub;
    $("room-countdown").textContent = cd;
    $("room-members").innerHTML = ms.map(m => `<span class="rm ${m.id === c.room.hostId ? "host" : ""}">${m.handle}${m.id === c.room.hostId ? " ★" : ""}</span>`).join("");
    const start = $("room-start");
    start.hidden = !c.room.isHost;
    start.textContent = c.kind === "npc" ? "launch now (host)" : "start";
  },
  appendChat(m) {
    const feed = $("room-chat-feed");
    const div = document.createElement("div");
    div.className = "lc-msg";
    const who = this.current?.room.presence[m.from]?.handle ?? "someone";
    div.innerHTML = `<b></b>`; div.querySelector("b").textContent = who; div.appendChild(document.createTextNode(m.text));
    feed.appendChild(div); feed.scrollTop = feed.scrollHeight;
    while (feed.children.length > 60) feed.firstChild.remove();
  },
};

// keep the NPC world positions for quest centres
export function npcCenter(arch) {
  const def = ARCH_NPC_DEFS.find(d => d.arch === arch);
  return geoPos(def.lat, def.lng);
}
