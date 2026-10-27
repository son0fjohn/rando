// Manhunt (3+ players), the party's sixth game: hide-and-seek / chase on
// foot round the real neighbourhood, on the 3D map. The host draws the play
// zone on the map; hunters chase runners; every few minutes the hunters get
// a ping: a fuzzy circle where each runner WAS. Tags happen in person and
// the runner confirms them. The host: The Hunter, in his elevator
// (hunter.js, mhscene.js).
//
// PRIVACY (AGENTS.md, Manhunt): your position never leaves your phone as is.
//   * Your phone reads its own GPS only while the hunt (or the head start)
//     is on and you're in it; it stops when the round ends.
//   * At a ping, a runner's phone sends a fuzzy circle (G.fuzz): at least
//     25 m, centred up to 0.8 r away from where you are in a random direction
//     and snapped to a 10 m grid; a fresh draw every time. Those go out as a
//     broadcast ("mh-pos") that phones keep in memory until the game ends;
//     they are never in the synced state and never stored.
//   * Teammates see each other as the same kind of fuzzy circle, end-to-end
//     encrypted to the team (mhcrypt.js): the other team's phones, the
//     host's included, only ever get ciphertext. Runners never see hunters;
//     Sprint Alert sends a runner the hunters' fuzzy circles, sealed to
//     that runner's phone, which only buzzes (no direction, nothing shown).
//   * The synced state holds roles, tags, flags (outside the zone, SAFE,
//     signal lost) and the zone itself (a place, not a person) — never a
//     player's position.
//   * Out of the zone for 30 s: your circle (25 m) goes out every 5 s so the
//     hunters see you live until you're back; 2 minutes out and you're out.
//   * Alerts vibrate; no sound unless you turn it on (a ding could give a
//     hiding spot away).
//
// Dev: ?mhsim=1 walks a simulated phone round the zone (no GPS needed);
// ?mhfast=N makes a minute last 60/N seconds; ?mh3d=0 skips the elevator 3D.
import { HostGame, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { MANHUNT as M } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, showResults, trash, avatarHtml } from "./../hpkit.js";
import * as G from "./../mhgeo.js";
import { teamBox } from "./../mhcrypt.js";
import { mhMap, majorRoads } from "./../mhmap.js";
import { mhScene } from "./../mhscene.js";
import { renderLook } from "./../charrender.js";
import { askPermission } from "./../permissions.js";
import { t } from "./../i18n.js";
import { howto } from "./../howto.js";

const params = new URLSearchParams(location.search);
const SIM = params.get("mhsim");
const FAST = Math.max(1, +params.get("mhfast") || 1);
export const MIN = 60000 / FAST;                    // one "minute" of the game's clock
const $ = id => document.getElementById(id);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";   // (a portrait still rendering)
const mmss = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

export const MANHUNT_GAME = {
  id: "manhunt", title: "Manhunt",
  blurb: "hunters chase, runners hide — on foot, on the real streets. fuzzy pings, no live tracking.",
  minPlayers: M.MIN_PLAYERS, maxPlayers: 16, length: "you pick (30 min)",
  hostSetup: ["setup"],
  map: true,   // played on the live map (party.js keeps it running)

  start(ctx) {
    ui.show();
    const room = ctx.room, meId = ctx.me.id;
    const layer = $("game-layer");
    layer.classList.add("mh-on");
    // ---- this phone's own things (never in the state)
    const me = { pos: null, watch: null, sim: null, inside: null, asleep: false, decoy: false, ghost: false, lastLive: 0, lastTeam: 0, box: null, sentKey: false };
    const pings = new Map();     // runner id -> { c, r, at, no, live, none } (as the last ping showed them)
    const mates = new Map();     // teammate id -> { c, r, at } (decrypted, fuzzy)
    const near = new Map();      // hunter id -> { c, r, at } (Sprint Alert only, never drawn)
    const chat = [];             // my team's lines
    // the live map, when this page has one (the party page does; a logic test page doesn't)
    let world3d = null, map = mhMap(null), hasMap = false;
    import("./../world3d.js").then(m => {
      if (!m.world3d?.scene) return;
      world3d = m.world3d; map = mhMap(world3d); hasMap = map.live; hook.map = map;
      // other people on the world map stay off it (runners never see hunters)
      if (world3d.remoteGroup) { world3d.remoteGroup.visible = false; trash.add(() => { world3d.remoteGroup.visible = true; world3d.needsRender = true; }); }
      lastSheetKey = null;   // (the setup sheet adds its tap catcher once there's a map)
      if (game.s) render(game.s);
    }).catch(e => console.warn("[manhunt] no map:", e?.message ?? e));
    const elev = mhScene(layer);
    elev.onTap = () => elev.quip(pick(M.LINES.tap));
    let drawn = null, draftCorners = [], drawMode = "circle", drawR = M.ZONE.defR, seenPing = 0, seenTagAsk = null, lastHud = 0;
    let sheet = null, lastSheetKey = null, endShown = 0, cityAt = null, playFocus = false, roadsWarn = null, roadsFor = null;
    trash.add(() => { pings.clear(); mates.clear(); near.clear(); chat.length = 0; me.pos = null; me.box?.forget(); });

    // ---- the screen: a top bar, a bottom bar, a sheet, a modal (the map shows through)
    layer.insertAdjacentHTML("beforeend", `<div class="mh-ui" id="mh-ui">
      <div class="mh-top" id="mh-top" hidden></div>
      <div class="mh-powers" id="mh-powers" hidden></div>
      <div class="mh-bottom" id="mh-bottom" hidden></div>
      <div class="mh-sheet" id="mh-sheet" hidden></div>
      <div class="mh-modal" id="mh-modal" hidden></div>
      <div class="mh-safe-cover" id="mh-safe-cover" hidden></div>
    </div>`);
    const ui$ = { top: $("mh-top"), powers: $("mh-powers"), bottom: $("mh-bottom"), sheet: $("mh-sheet"), modal: $("mh-modal"), safe: $("mh-safe-cover") };

    const P = s => s.players?.[meId];
    const isRunner = s => P(s)?.role === "runner" && !P(s)?.tagged && !P(s)?.out;
    const isHunter = s => P(s)?.role === "hunter";
    const free = s => Object.values(s.players).filter(p => p.wasRunner && !p.tagged && !p.out && !p.gone);
    const name = (s, id) => (id === meId ? "you" : esc(s.players?.[id]?.handle ?? "someone"));
    const avatarOf = id => room.members.find(m => m.id === id)?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? {};
    const huntFrac = s => (s.hunt?.len ? Math.min(1, s.hunt.t / s.hunt.len) : 0);
    const zoneNow = s => G.zoneAt(s.zone, s.zoneK ?? 1);

    // ================================================================ the host
    const rounds = new Rounds([
      // (a setup nobody finished in 20 minutes ends the game: no zone, no hunt)
      { name: "setup", ms: 20 * 60 * 1000, done: s => !!s.setup.go, next: s => { if (!s.setup.go) { s.aborted = true; return "end"; } begin(s); return "rules"; } },
      { name: "rules", ms: M.RULES_MS, done: s => active(s).every(p => p.ready), next: () => "intro" },
      { name: "intro", ms: M.ELEVATOR_MS, next: s => (s.setup.head > 0 ? "headstart" : "hunt") },
      { name: "headstart", ms: s => s.setup.head * MIN, next: () => "hunt" },
      {
        name: "hunt", ms: s => s.setup.round * MIN,
        enter: s => { s.hunt = { t: 0, len: s.setup.round * MIN, every: s.setup.ping * MIN, next: s.setup.ping * MIN, no: 0 }; },
        done: s => !!s.verdict,
        next: s => { if (!s.verdict) end(s, free(s).length ? "runners" : "hunters"); return "end"; },
      },
      { name: "end", ms: M.END_MS, next: () => null },
    ], { onPhase: () => ui.resetKey() });

    function begin(s) {
      const ids = active(s).map(p => p.id);
      const { roles } = G.teams(ids, s.setup.teams, game.rng);
      for (const p of Object.values(s.players)) {
        p.role = roles[p.id] ?? "runner";
        p.wasRunner = p.role === "runner";
        Object.assign(p, { tagged: false, out: false, safe: false, safeMs: 0, endAt: null, by: null, pings: 0, used: {}, outside: false, outsideAt: null, live: false, asleep: false, ready: false });
      }
      s.zone = s.setup.zone;
      s.zoneK = 1;
      s.tags = [];
    }
    function end(s, who) {
      if (s.verdict) return;
      s.verdict = who;   // "hunters" | "runners" (not `why`: that would mark the game aborted)
      const huntMs = s.hunt?.t ?? 0;
      const players = Object.values(s.players).map(p => ({ id: p.id, wasRunner: p.wasRunner, tagged: p.tagged, out: p.out, endAt: p.endAt != null ? p.endAt - (p.safeMs ?? 0) : huntMs - (p.safeMs ?? 0) }));
      const { points, last } = G.points(players, s.tags, huntMs);
      for (const p of Object.values(s.players)) p.score = points[p.id] ?? 0;
      s.last = last;
      game.emit("mh-end", { who });
    }

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = { id: h.id, handle: h.handle, isBot: false, score: 0, gone: false, role: "runner", wasRunner: true };
        s.setup = { zone: null, round: M.ROUND.def, ping: M.PING.def, head: M.HEADSTART.def, shrink: true, powers: true, join: true, teams: {}, go: false, err: "" };
        rounds.enter(s, "setup");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        rounds.hostStep(s, dt);
        if (s.phase === "hunt") huntTick(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        const fromHost = m.from === room.hostId, p = s.players[m.from];
        if (m.in === "skip" && fromHost && s.phase !== "setup") { s.left = 0; return; }
        if (s.phase === "setup") { if (fromHost) setupInput(s, m); return; }
        if (!p) return;
        if (m.in === "mh-ready" && s.phase === "rules") { p.ready = true; return; }
        if (m.in === "mh-asleep") { p.asleep = !!m.on; return; }
        if (m.in === "mh-safe") {
          if (!!m.on === !!p.safe || s.phase !== "hunt" && s.phase !== "headstart") return;
          p.safe = !!m.on;
          if (p.safe) p.safeAt = s.hunt?.t ?? 0; else p.safeMs = (p.safeMs ?? 0) + Math.max(0, (s.hunt?.t ?? 0) - (p.safeAt ?? 0));
          if (s.pending && (s.pending.target === p.id || s.pending.by === p.id) && p.safe) s.pending = null;
          game.emit("mh-safe", { id: p.id, on: p.safe });
          return;
        }
        if (s.phase !== "hunt") return;
        const t = s.hunt.t;
        if (m.in === "mh-zone" && p.wasRunner && !p.tagged && !p.out) {
          const out = !!m.out;
          if (out && !p.outside) { p.outside = true; p.outsideAt = t; }
          if (!out && p.outside) { p.outside = false; p.outsideAt = null; if (p.live) { p.live = false; game.emit("mh-live", { id: p.id, on: false }); } }
          return;
        }
        if (m.in === "mh-tag") {
          const tg = s.players[m.target];
          if (p.role !== "hunter" || p.safe || !tg || !tg.wasRunner || tg.tagged || tg.out || tg.safe || tg.gone || s.pending) return;
          s.pending = { by: p.id, target: tg.id, until: t + M.TAG_CONFIRM_MS };
          game.emit("mh-tagask", { by: p.id, target: tg.id });
          return;
        }
        if (m.in === "mh-tagack" && s.pending && m.from === s.pending.target) {
          const { by, target } = s.pending, tg = s.players[target];
          s.pending = null;
          if (!m.yes) { game.emit("mh-denied", { by, target }); return; }
          tg.tagged = true; tg.endAt = t; tg.by = by;
          if (tg.safe) tg.safe = false;
          s.tags.push({ by, target, at: t });
          if (s.setup.join) tg.role = "hunter";
          game.emit("mh-tagged", { by, target, at: t });
          if (!free(s).length) end(s, "hunters");
          return;
        }
        if (m.in === "mh-power" && s.setup.powers) {
          const pw = M.POWERS[m.p];
          if (!pw || p.used?.[m.p] || p.safe || p.tagged || p.out) return;
          if (pw.team !== p.role || (pw.team === "runner" && !p.wasRunner)) return;
          if (m.p === "lockon") { const tg = s.players[m.target]; if (!tg || !tg.wasRunner || tg.tagged || tg.out) return; s.lockon = { ...(s.lockon ?? {}), [tg.id]: p.id }; }
          p.used = { ...p.used, [m.p]: true };
          // radar: everybody pings now (off the schedule); sprint: the hunters'
          // phones start sending that runner their sealed fuzzy circles
          if (m.p === "radar") ping(s, true);
          if (m.p === "sprint") game.emit("mh-sprint", { id: p.id, until: t + pw.MS });
          // decoy and ghost are the runner's phone's own business: nobody else hears of them
          if (m.p === "radar" || m.p === "lockon") game.emit("mh-power", { by: p.id, p: m.p });
        }
      },
      render: s => render(s),
      onEvent: m => onEvent(m),
    }, { hz: 4 });

    function setupInput(s, m) {
      const S = s.setup, num = (k, R) => { const v = Math.round(Number(m.v)); if (v >= R.min && v <= R.max) S[k] = v; };
      if (m.in === "mh-zonedef") { S.zone = m.zone ?? null; S.err = ""; }
      if (m.in === "mh-set") {
        if (m.k === "round") num("round", M.ROUND);
        if (m.k === "ping") num("ping", M.PING);
        if (m.k === "head") num("head", M.HEADSTART);
        if (["shrink", "powers", "join"].includes(m.k)) S[m.k] = !!m.v;
      }
      if (m.in === "mh-team" && s.players[m.id] && ["hunter", "runner", "random"].includes(m.team)) S.teams = { ...S.teams, [m.id]: m.team };
      if (m.in === "mh-go") {
        const n = active(s).length;
        const [zok, zwhy] = G.zoneOk(S.zone);
        const warn = G.teams(active(s).map(p => p.id), S.teams, () => 0.5).warn;
        S.err = n < M.MIN_PLAYERS ? `at least ${M.MIN_PLAYERS} players` : !zok ? zwhy : warn ? `teams: ${warn} (about 1 hunter per 3–4 runners)` : "";
        if (!S.err) S.go = true;
      }
    }

    function ping(s, radar = false) {
      s.hunt.no++;
      for (const p of Object.values(s.players)) if (p.wasRunner && !p.tagged && !p.out && !p.safe) p.pings = (p.pings ?? 0) + 1;
      game.emit("mh-ping", { no: s.hunt.no, t: s.hunt.t, radar, lockon: s.lockon ?? {} });
      s.lockon = {};
    }
    function huntTick(s, dt) {
      const h = s.hunt;
      h.t += dt * 1000;
      // the zone shrinks in steps, each announced a minute before
      const { k, next } = G.shrinkAt(h.t / h.len, s.setup.shrink);
      if (k !== s.zoneK) { s.zoneK = k; s.warn = null; game.emit("mh-shrink", { k }); }
      if (next && !s.warn && h.t >= next.at * h.len - M.SHRINK.WARN_MS * (MIN / 60000)) { s.warn = { k: next.k, at: next.at * h.len }; game.emit("mh-warn", { k: next.k }); }
      if (h.t >= h.next) { h.next += h.every; ping(s); }
      // outside the zone: live after 30 s, out after 2 minutes
      for (const p of Object.values(s.players)) {
        if (!p.wasRunner || p.tagged || p.out || p.safe || !p.outside) continue;
        const away = (h.t - p.outsideAt) / (MIN / 60000);
        if (away >= M.OUTSIDE.OUT_MS) { p.out = true; p.endAt = h.t; p.live = false; game.emit("mh-out", { id: p.id }); }
        else if (away >= M.OUTSIDE.LIVE_MS && !p.live) { p.live = true; game.emit("mh-live", { id: p.id, on: true }); }
      }
      if (s.pending && h.t > s.pending.until) { game.emit("mh-denied", { ...s.pending, timeout: true }); s.pending = null; }
      // a tag nobody can answer (they left) clears; everyone caught or gone: the hunters have it
      if (s.pending && s.players[s.pending.target]?.gone) s.pending = null;
      const runners = Object.values(s.players).filter(p => p.wasRunner);
      if (runners.length && !free(s).length) end(s, "hunters");
      // no hunter left in the party: the runners have it
      if (!Object.values(s.players).some(p => p.role === "hunter" && !p.gone)) end(s, "runners");
    }

    // ================================================================ this phone
    // ---- location: only while the head start or the hunt is on, and you're in it
    function startGeo() {
      if (me.watch || me.sim) return;
      if (SIM) { me.sim = simWalker(); return; }
      if (!navigator.geolocation) return;
      me.watch = navigator.geolocation.watchPosition(p => onPos([p.coords.latitude, p.coords.longitude]), () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    }
    function stopGeo() {
      if (me.watch != null) { navigator.geolocation?.clearWatch(me.watch); me.watch = null; }
      if (me.sim) { clearInterval(me.sim); me.sim = null; }
      me.pos = null; me.inside = null;
    }
    // a pretend phone for desk testing: walks round inside the zone
    function simWalker() {
      const s = game.s, z = s?.zone; if (!z) return null;
      let h = 0; for (const c of meId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
      const c = G.zoneCentre(z), R = G.zoneRadius(z) * 0.6;
      let pos = G.offset(c, (rnd() - 0.5) * R, (rnd() - 0.5) * R), goal = null;
      onPos(pos);
      return setInterval(() => {
        if (window.__mhSimPos) { onPos(window.__mhSimPos); return; }   // a test pins this phone somewhere
        if (!goal || G.dist(pos, goal) < 8) goal = SIM === "out" ? G.offset(c, R * 3, 0) : G.offset(c, (rnd() - 0.5) * R * 1.6, (rnd() - 0.5) * R * 1.6);
        const d = G.dist(pos, goal), step = Math.min(d, 1.6 * FAST);
        pos = [pos[0] + (goal[0] - pos[0]) * step / d, pos[1] + (goal[1] - pos[1]) * step / d];
        onPos(pos);
      }, 1000);
    }
    function onPos(p) {
      const s = game.s;
      me.pos = p;
      if (hasMap) world3d.movePlayer?.(p[0], p[1]);
      if (!s?.zone || !P(s)) return;
      // the zone check happens here, on the phone: only "in" / "out" goes to the host
      if (s.phase === "hunt" && isRunner(s) && !P(s).safe) {
        const inside = G.inZone(zoneNow(s), p);
        if (inside !== me.inside) { me.inside = inside; game.input("mh-zone", { out: !inside }); if (!inside) { buzz([200, 100, 200]); ui.toast("You're outside the zone: get back in!", "bad"); } }
      }
      phoneTick();
    }
    // what this phone sends on its own clock (a phone standing still gets no
    // GPS fixes, so this runs every second, from the last position it has)
    function phoneTick() {
      const s = game.s, p = me.pos;
      if (!s?.zone || !P(s) || !p || !["headstart", "hunt"].includes(s.phase)) return;
      // live while outside (after 30 s): a tight circle every 5 s
      if (s.phase === "hunt" && isRunner(s) && P(s).live && !P(s).safe && Date.now() - me.lastLive >= M.OUTSIDE.EVERY_MS * (MIN / 60000)) { me.lastLive = Date.now(); sendPos(s, { live: true }); }
      // teammates: my fuzzy circle, sealed to them, now and then (not while I'm SAFE)
      if (!P(s).safe && Date.now() - me.lastTeam >= M.TEAM_EVERY_MS * (MIN / 60000)) { me.lastTeam = Date.now(); sendTeam(s, { pos: G.fuzz(p, G.fuzzRadius(huntFrac(s))) }); }
      // Sprint Alert (hunters' side): my circle, sealed to that runner only
      if (isHunter(s) && s.phase === "hunt") for (const [id, until] of sprints) {
        if ((s.hunt?.t ?? 0) > until) { sprints.delete(id); continue; }
        if (Date.now() - (sprintSent.get(id) ?? 0) >= 5000 * (MIN / 60000)) { sprintSent.set(id, Date.now()); me.box?.seal({ near: G.fuzz(p, M.FUZZ.START_M) }, [id]).then(box => room.send("mh-near", { box })); }
      }
    }
    const phoneTimer = setInterval(phoneTick, 1000);
    const sprints = new Map(), sprintSent = new Map();
    // a ping: my fuzzy circle (or my decoy, or nothing if I'm a ghost)
    function sendPos(s, { no = 0, live = false, lockon = false } = {}) {
      if (!me.pos) { room.send("mh-pos", { no, none: true, why: "no signal" }); return; }
      const r = live ? M.FUZZ.MIN_M : lockon ? M.POWERS.lockon.M : G.fuzzRadius(huntFrac(s));
      let circle;
      if (!live && me.ghost) { me.ghost = false; room.send("mh-pos", { no, none: true }); return; }
      if (!live && me.decoy) { me.decoy = false; circle = G.decoy(me.pos, r, zoneNow(s)); }
      else circle = G.fuzz(me.pos, r);
      room.send("mh-pos", { no, c: circle.c, r: circle.r, live });
    }
    async function sendTeam(s, obj) {
      if (!me.box || !P(s)) return;
      const mine = P(s).role, ids = Object.values(s.players).filter(p => p.id !== meId && p.role === mine && !p.gone && me.box.has(p.id)).map(p => p.id);
      if (!ids.length) return;
      room.send("mh-team", { box: await me.box.seal(obj, ids) });
    }
    // keys for the team channel: everyone shares a public key once
    teamBox().then(b => { me.box = b; if (b) { room.send("mh-key", { pub: b.pub }); me.sentKey = true; } });
    const onKey = m => { if (m.from === meId || !me.box) return; const had = me.box.has(m.from); me.box.peer(m.from, m.pub); if (!had && me.sentKey) room.send("mh-key", { pub: me.box.pub }); };
    const onPosMsg = m => {
      const s = game.s; if (!s?.players?.[m.from]) return;
      pings.set(m.from, { c: m.c, r: m.r, at: performance.now(), no: m.no, live: !!m.live, none: !!m.none });
      drawPings(s);
    };
    const onTeam = async m => {
      if (m.from === meId || !me.box) return;
      const o = await me.box.open(m.from, m.box?.[meId]);
      if (!o) return;
      if (o.pos) { mates.set(m.from, { ...o.pos, at: performance.now() }); drawMates(game.s); }
      if (o.chat) { chat.push({ from: m.from, text: String(o.chat).slice(0, 200), at: Date.now() }); if (chat.length > 60) chat.shift(); patchChat(game.s); buzz(30); }
    };
    const onNear = async m => {
      if (!me.box || !me.pos) return;
      const o = await me.box.open(m.from, m.box?.[meId]);
      if (!o?.near) return;
      // a buzz, nothing on screen: no name, no direction
      if (G.dist(o.near.c, me.pos) < M.POWERS.sprint.M + o.near.r) { buzz([120, 60, 120, 60, 300]); ui.toast("Sprint Alert: a hunter is close.", "bad"); }
    };
    room.on("mh-key", onKey); room.on("mh-pos", onPosMsg); room.on("mh-team", onTeam); room.on("mh-near", onNear);

    function drawPings(s) {
      if (!s?.players) return;
      const list = [];
      for (const [id, p] of pings) {
        const pl = s.players[id];
        if (!pl || p.none || !p.c) continue;
        // hunters see every runner's circle; a runner sees their own (what the hunters saw)
        if (!(isHunter(s) || id === meId)) continue;
        if (pl.tagged || pl.out) continue;
        list.push({ key: id, name: `${pl.handle}${p.live ? " · outside!" : ""}`, c: p.c, r: p.r, at: p.at, kind: p.live ? "live" : "ping" });
      }
      map.pings(list, { fade: (s.hunt?.every ?? 5 * MIN) * 1.05 });
    }
    function drawMates(s) {
      if (!s?.players) return;
      const list = [];
      for (const [id, m] of mates) { const pl = s.players[id]; if (pl && !pl.gone && pl.role === P(s)?.role) list.push({ key: id, name: `${pl.handle}`, c: m.c, r: m.r, at: m.at, kind: "mate" }); }
      map.mates(list);
    }

    // ---- events from the host
    function onEvent(m) {
      const s = game.s;
      if (m.ev === "mh-ping") {
        if (m.no <= seenPing) return;
        seenPing = m.no;
        // runners: send my circle now (the lock-on makes it tight)
        if (s && isRunner(s) && !P(s).safe && !me.asleep) sendPos(s, { no: m.no, lockon: !!m.lockon?.[meId] });
        if (s && isRunner(s)) { buzz([80, 60, 80]); ui.toast(m.radar ? "Radar! The hunters just pinged everyone." : "Ping: the hunters saw roughly where you were.", ""); }
        if (s && isHunter(s)) { buzz(60); elev.ping(m.radar ? M.LINES.power.radar : pick(M.LINES.ping), m.no); }
        if (s && P(s)?.wasRunner && P(s).tagged) { /* spectating */ }
        if (m.lockon?.[meId]) ui.toast("Locked on: that ping was a tight circle.", "bad");
      }
      if (m.ev === "mh-tagged" && s) {
        buzz([200, 80, 200]);
        sfx.stamp?.();
        if (m.target === meId) ui.toast(`Caught by ${name(s, m.by)}.${s.setup.join ? " You hunt now." : ""}`, "bad");
        else ui.toast(`${name(s, m.target)} was caught by ${name(s, m.by)}.`, "");
        elev.quip(pick(M.LINES.tag));
        pings.delete(m.target); drawPings(s);
      }
      if (m.ev === "mh-denied" && s && m.by === meId) ui.toast(m.timeout ? "No answer: the tag didn't count." : "They say it wasn't a tag.", "bad");
      if (m.ev === "mh-shrink") { buzz([100, 50, 100]); ui.toast("The zone just got smaller.", "bad"); }
      if (m.ev === "mh-warn" && s) { buzz([300, 100, 300]); ui.toast("The zone shrinks in 1 minute. Move.", "bad"); if (isHunter(s)) elev.ping(M.LINES.shrink[0]); }
      if (m.ev === "mh-live" && s) { if (m.id === meId && m.on) { buzz([400, 100, 400]); ui.toast("You've been outside 30 s: the hunters can see you live.", "bad"); } if (!m.on) { pings.delete(m.id); drawPings(s); } }
      if (m.ev === "mh-out" && s) ui.toast(m.id === meId ? "Two minutes outside the zone: you're out." : `${name(s, m.id)} left the zone too long: out.`, "bad");
      if (m.ev === "mh-safe" && s) { if (room.isHost && m.id !== meId) ui.toast(`${name(s, m.id)} pressed SAFE${m.on ? "" : " off: back in"}.`, ""); if (m.on) { pings.delete(m.id); drawPings(s); } }
      if (m.ev === "mh-sprint" && s) { if (isHunter(s)) sprints.set(m.id, m.until); if (m.id === meId) elev.quip(M.LINES.power.sprint); }
      if (m.ev === "mh-power" && s && isHunter(s) && m.by !== meId) ui.toast(`${name(s, m.by)} used ${M.POWERS[m.p].label}.`, "");
      if (m.ev === "mh-end") { stopGeo(); }
    }

    // ---- going to sleep (the screen locks): the web stops the GPS, so say so
    const onVis = () => {
      const s = game.s; if (!s || !["hunt", "headstart"].includes(s.phase)) return;
      const hidden = document.visibilityState === "hidden";
      if (hidden !== me.asleep) { me.asleep = hidden; game.input("mh-asleep", { on: hidden }); }
      if (!hidden) requestWake();
    };
    document.addEventListener("visibilitychange", onVis);
    let wake = null;
    async function requestWake() { try { wake = await navigator.wakeLock?.request("screen"); } catch {} }

    // ================================================================ render
    function render(s) {
      if (!s?.players) return;
      const p = P(s);
      const phase = s.phase;
      // the map: city mode round the zone, the zone drawn, the camera on it
      if (hasMap && (s.zone || drawn)) mapFor(s);
      // location runs only while it matters
      // (a caught runner keeps it only to hunt; out of the game, or spectating: off)
      if (p && (phase === "headstart" || phase === "hunt") && !p.out && !(p.tagged && !s.setup.join)) { startGeo(); requestWake(); }
      else stopGeo();
      layer.dataset.phase = phase;
      layer.dataset.role = p?.role ?? "";
      // the header bar while the host sets up and the Hunter explains; on the map, the hunt's own bar
      if (phase !== "setup" && phase !== "rules" && document.getElementById("game-hud")?.innerHTML) ui.hud("");
      if (phase === "setup") return renderSetup(s);
      if (phase === "rules") return renderRules(s);
      if (phase === "intro") return renderIntro(s);
      if (phase === "headstart" || phase === "hunt") return renderHunt(s);
      if (phase === "end") return renderEnd(s);
    }

    // ---- the map for the zone (all phones)
    function mapFor(s) {
      const z = s.zone ?? drawn;
      const c = G.zoneCentre(z);
      if (!cityAt || G.dist(cityAt, c) > 1500) { cityAt = c; world3d.enterCity?.(c[0], c[1]).then(() => { map.zone(z, s.zoneK ?? 1, { instant: true }); map.focus(z); }); }
      map.zone(z, s.zoneK ?? 1);
      map.next(s.warn?.k ?? null);
      // the host's camera aimed above the setup sheet: the whole zone again once it's on
      if (s.phase !== "setup" && !playFocus && Array.isArray(cityAt)) { playFocus = true; map.focus(z); }
    }

    // ---- setup (the host; everyone else waits in the lobby)
    function sheetHtml(key, html, cls = "wait") {
      if (lastSheetKey === key) return;
      lastSheetKey = key;
      ui$.top.hidden = ui$.bottom.hidden = ui$.powers.hidden = true;
      ui$.sheet.hidden = false; ui$.sheet.className = `mh-sheet ${cls}`; ui$.sheet.innerHTML = html;
    }
    function renderSetup(s) {
      ui.hud(`<div class="hq"><b>MANHUNT</b><span>setup</span></div>`);
      if (!room.isHost) { sheetHtml("wait", `<div class="mh-card"><b>The host is drawing the zone…</b></div>`); return; }
      const S = s.setup;
      // the host's map: city mode where the party is, before anything's drawn
      if (!cityAt && hasMap) {
        cityAt = "pending";
        hereNow().then(c => { cityAt = c; world3d.enterCity?.(c[0], c[1]).then(() => { if (!drawn) { drawn = { type: "circle", c, r: drawR }; game.input("mh-zonedef", { zone: drawn }); } map.draft(drawn, draftCorners); map.focus(drawn, { cover: 0.5 }); }); });
      }
      const ids = active(s).map(x => x.id);
      const key = `setup|${ids.join(",")}|${drawMode}`;
      if (lastSheetKey !== key) {
        lastSheetKey = key;
        ui$.sheet.hidden = false; ui$.top.hidden = ui$.bottom.hidden = ui$.powers.hidden = true;
        ui$.sheet.className = "mh-sheet setup";
        ui$.sheet.innerHTML = `<div class="mh-setup">
          <div class="mh-h">Draw the zone</div>
          <div class="mh-seg" role="group"><button type="button" data-draw="circle" class="${drawMode === "circle" ? "on" : ""}">Circle</button><button type="button" data-draw="poly" class="${drawMode === "poly" ? "on" : ""}">Shape</button></div>
          <p class="mh-hint">${drawMode === "circle" ? "Tap the map to move the centre; the slider sets the size." : "Tap the map at each corner (3 to 12)."}</p>
          ${drawMode === "circle" ? `<label class="mh-row">Size <input type="range" id="mh-r" min="${M.ZONE.minR}" max="${M.ZONE.maxR}" step="50" value="${drawR}"><b id="mh-rv">${(drawR * 2 / 1000).toFixed(1)} km across</b></label>` : `<div class="mh-row"><button type="button" class="mh-btn ghost" id="mh-undo">Undo</button><button type="button" class="mh-btn ghost" id="mh-clear">Clear</button><b id="mh-np">${draftCorners.length} corners</b></div>`}
          <div class="mh-h">Settings</div>
          ${stepper("round", "Round", "min")}${stepper("ping", "Ping every", "min")}${stepper("head", "Head start", "min")}
          ${toggle("shrink", "Shrinking zone")}${toggle("powers", "Powers")}${toggle("join", "Tagged runners join the hunters")}
          <div class="mh-h">Teams</div>
          <div class="mh-teams">${ids.map(id => `<div class="mh-team-row" data-id="${esc(id)}"><span class="mh-tn">${avatarHtml(s.players[id], { size: 26 })}${name(s, id)}</span><span class="mh-seg sm">${["hunter", "runner", "random"].map(t => `<button type="button" data-team="${t}" data-pid="${esc(id)}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</span></div>`).join("")}</div>
          <p class="mh-warn" id="mh-warn"></p>
          <button type="button" class="mh-btn go" id="mh-go">Start the hunt</button>
        </div>`;
        ui$.sheet.querySelectorAll("[data-draw]").forEach(b => b.onclick = () => { drawMode = b.dataset.draw; if (drawMode === "poly") { draftCorners = []; } lastSheetKey = null; render(game.s); });
        const r = $("mh-r");
        if (r) r.oninput = () => { drawR = +r.value; $("mh-rv").textContent = `${(drawR * 2 / 1000).toFixed(1)} km across`; if (drawn?.type === "circle") { drawn = { ...drawn, r: drawR }; map.draft(drawn); sendZone(); } };
        if ($("mh-undo")) $("mh-undo").onclick = () => { draftCorners.pop(); polyFromCorners(); };
        if ($("mh-clear")) $("mh-clear").onclick = () => { draftCorners = []; polyFromCorners(); };
        ui$.sheet.querySelectorAll("[data-step]").forEach(b => b.onclick = () => { const k = b.dataset.step, R = { round: M.ROUND, ping: M.PING, head: M.HEADSTART }[k]; game.input("mh-set", { k, v: Math.max(R.min, Math.min(R.max, game.s.setup[k] + (+b.dataset.d) * R.step)) }); sfx.cursor?.(); });
        ui$.sheet.querySelectorAll("[data-tog]").forEach(b => b.onclick = () => { game.input("mh-set", { k: b.dataset.tog, v: !game.s.setup[b.dataset.tog] }); sfx.cursor?.(); });
        ui$.sheet.querySelectorAll("[data-team]").forEach(b => b.onclick = () => { game.input("mh-team", { id: b.dataset.pid, team: b.dataset.team }); sfx.cursor?.(); });
        $("mh-go").onclick = () => { sfx.confirm?.(); game.input("mh-go"); };
        catchTaps(true);
      }
      // patch the live bits in place
      for (const k of ["round", "ping", "head"]) { const v = ui$.sheet.querySelector(`[data-val="${k}"]`); if (v) v.textContent = S[k]; }
      for (const k of ["shrink", "powers", "join"]) ui$.sheet.querySelector(`[data-tog="${k}"]`)?.classList.toggle("on", !!S[k]);
      ui$.sheet.querySelectorAll(".mh-team-row").forEach(row => { const t = S.teams[row.dataset.id] ?? "random"; row.querySelectorAll("[data-team]").forEach(b => b.classList.toggle("on", b.dataset.team === t)); });
      const [zok, zwhy] = G.zoneOk(S.zone);
      const warn = S.err || (!zok ? zwhy : G.teams(ids, S.teams, () => 0.5).warn);
      if (S.zone && roadsFor !== JSON.stringify(S.zone)) { roadsFor = JSON.stringify(S.zone); majorRoads?.(world3d, S.zone).then(r => { roadsWarn = r; render(game.s); }); }
      const roads = roadsWarn?.length ? `Heads up: the zone crosses ${roadsWarn.slice(0, 3).map(esc).join(", ")}${roadsWarn.length > 3 ? " and more" : ""}. Big roads aren't part of the game: tell everyone.` : "";
      const w = $("mh-warn"); if (w) w.innerHTML = [warn && `⚠ ${esc(warn)}`, roads && esc(roads)].filter(Boolean).join("<br>");
      const np = $("mh-np"); if (np) np.textContent = `${draftCorners.length} corners`;
    }
    const stepper = (k, label, unit) => `<div class="mh-row"><span>${label}</span><span class="mh-step"><button type="button" data-step="${k}" data-d="-1" aria-label="less">−</button><b data-val="${k}"></b> ${unit}<button type="button" data-step="${k}" data-d="1" aria-label="more">+</button></span></div>`;
    const toggle = (k, label) => `<button type="button" class="mh-row mh-tog" data-tog="${k}"><span>${label}</span><i></i></button>`;
    function sendZone() { clearTimeout(sendZone.t); sendZone.t = setTimeout(() => game.input("mh-zonedef", { zone: drawn }), 120); }
    function polyFromCorners() {
      drawn = draftCorners.length >= 3 ? { type: "poly", pts: draftCorners.slice() } : (draftCorners.length ? null : drawn);
      map.draft(drawn, draftCorners);
      if (drawn) sendZone(); else game.input("mh-zonedef", { zone: null });
      const np = $("mh-np"); if (np) np.textContent = `${draftCorners.length} corners`;
    }
    // taps on the map while drawing: a transparent catcher over the map above the sheet
    let catcher = null;
    function catchTaps(on) {
      if (!on) { catcher?.remove(); catcher = null; return; }
      if (catcher || !hasMap) return;
      catcher = document.createElement("div"); catcher.className = "mh-catch";
      layer.querySelector(".mh-ui").prepend(catcher);
      let down = null;
      catcher.onpointerdown = e => { down = [e.clientX, e.clientY, performance.now()]; };
      catcher.onpointerup = e => {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 12) { down = null; return; }
        down = null;
        const at = map.pick(e.clientX, e.clientY); if (!at) return;
        if (drawMode === "circle") { drawn = { type: "circle", c: at, r: drawR }; map.draft(drawn); sendZone(); }
        else if (draftCorners.length < M.ZONE.maxPts) { draftCorners.push(at); polyFromCorners(); }
        sfx.cursor?.();
      };
    }
    // where the party is, on the host's phone (for the first draft of the zone)
    function hereNow() {
      return new Promise(res => {
        // (no answer, or a permission prompt left open: where your character stands on the map)
        const pl = world3d.player?.position;
        const fallback = () => res(world3d.city?.origin ?? (pl ? world3d.ungeo(pl.x, pl.z) : [37.5346, 126.9946]));
        if (SIM && window.__mhSimPos) return res(window.__mhSimPos);
        if (!navigator.geolocation) return fallback();
        const t = setTimeout(fallback, 4000);
        navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); res([p.coords.latitude, p.coords.longitude]); }, () => { clearTimeout(t); fallback(); }, { timeout: 8000, maximumAge: 60000 });
      });
    }

    // ---- the rules, from the Hunter (everyone taps in): the elevator doors
    // open on him, he says them in his dialog box (howto.js: in full the
    // first time, one line after that), "I'm in" right above it
    const hows = {};
    let howNow = null;
    const GESTURE = { tap: "tap", point: "point", warn: "tie", nod: "nod" };
    function renderRules(s) {
      catchTaps(false);
      const p = P(s), inN = active(s).filter(x => x.ready).length, all = active(s).length;
      const role = p?.role === "hunter" ? "hunter" : "runner";
      if (lastSheetKey !== "rules") {
        lastSheetKey = "rules";
        ui$.top.hidden = ui$.bottom.hidden = ui$.powers.hidden = ui$.sheet.hidden = true;
        elev.explain();
      }
      const id = `manhunt.${role}`;
      if (howNow && howNow !== hows[id]) howNow.stop();
      howNow = hows[id] ??= howto(id, {
        dlg: elev.dlg, auto: false, go: "I'm in",
        gesture: g => elev.play(GESTURE[g] ?? "nod"),
        send: v => { if (v === "howto-ok" && !P(game.s)?.ready) { sfx.confirm?.(); game.input("mh-ready"); askLocation(); } },
        note: "Your location stays on your phone. Others get a fuzzy circle (25–50 m), never your spot; nothing is saved. Keep your screen on.",
      });
      howNow.render({ gameId: "mh", ti: 0, howto: {} }, elev.act);
      ui.hud(`<div class="hq"><b>MANHUNT</b><span>how to play</span></div>`);
      elev.pill(`you're a <b>${role === "hunter" ? "HUNTER" : "RUNNER"}</b> · ${inN}/${all} in`);
    }
    // ask for location now (a tap), so the hunt doesn't stall on a prompt later
    function askLocation() { if (!SIM) askPermission("location", { body: t("perm.loc.mh") }).then(ok => { if (!ok) ui.toast("Location is off: you'll show as 'no signal' at pings.", "bad"); }); }

    // ---- the Hunter's opening (once)
    let introShown = false;
    function renderIntro(s) {
      if (lastSheetKey === "rules") { howNow?.stop(); ui.hud(""); elev.pill(""); }
      ui$.sheet.hidden = true; lastSheetKey = "intro";
      if (!introShown) { introShown = true; elev.intro([M.LINES.start[0], "Every few minutes, I'll know roughly where you were. Fuzzy. Not exact.", M.LINES.start[1]]); }
    }

    // ---- the hunt (and the head start)
    function renderHunt(s) {
      const p = P(s);
      ui$.sheet.hidden = !sheet;
      const head = s.phase === "headstart";
      // hunters in the head start: no peeking (the elevator, doors shut, the counter)
      if (head && isHunter(s)) {
        const txt = `Runners are hiding. You're let out in ${mmss(s.left)}.`;
        if (lastSheetKey !== "wait") { lastSheetKey = "wait"; elev.wait(txt); }
        else elev.waitText(txt, String(Math.ceil(s.left / MIN)));
      } else if (lastSheetKey === "wait") { lastSheetKey = null; elev.hide(); }
      map.show(!(head && isHunter(s)));
      // the top bar
      ui$.top.hidden = false;
      const left = head ? s.left : s.hunt ? s.hunt.len - s.hunt.t : 0;
      const nextPing = s.hunt ? Math.max(0, s.hunt.next - s.hunt.t) : null;
      const runners = Object.values(s.players).filter(x => x.wasRunner), freeN = free(s).length;
      ui$.top.innerHTML = `<span class="mh-pill ${p?.role ?? ""}">${p?.tagged ? "CAUGHT" : p?.out ? "OUT" : p?.role === "hunter" ? "HUNTER" : "RUNNER"}</span>
        <span class="mh-stat"><small>${head ? "head start" : "time left"}</small><b>${mmss(left)}</b></span>
        ${s.hunt ? `<span class="mh-stat"><small>next ping</small><b>${mmss(nextPing)}</b></span>` : ""}
        <span class="mh-stat"><small>runners</small><b>${freeN}/${runners.length}</b></span>`;
      // hunters: runners whose last ping didn't come (a locked screen, no GPS, or a Ghost: they all look the same)
      if (isHunter(s) && s.hunt) {
        const quiet = free(s).filter(x => !x.safe && (x.asleep || pings.get(x.id)?.none)).map(x => esc(x.handle));
        if (quiet.length) ui$.top.insertAdjacentHTML("beforeend", `<span class="mh-nosig">no signal: ${quiet.join(", ")}</span>`);
      }
      // powers (one of each per game)
      if (s.setup.powers && p && !p.out && !(p.tagged && !s.setup.join)) {
        const mine = Object.entries(M.POWERS).filter(([, w]) => w.team === (p.wasRunner && !p.tagged ? "runner" : "hunter"));
        const key = mine.map(([k]) => k + (p.used?.[k] ? 1 : 0)).join(",") + s.phase + me.decoy + me.ghost;
        if (ui$.powers.dataset.key !== key) {
          ui$.powers.dataset.key = key;
          ui$.powers.hidden = false;
          ui$.powers.innerHTML = mine.map(([k, w]) => `<button type="button" class="mh-pw ${p.used?.[k] || (k === "decoy" && me.decoy) || (k === "ghost" && me.ghost) ? "used" : ""}" data-pw="${k}" ${p.used?.[k] || head ? "disabled" : ""} title="${esc(w.what)}">${esc(w.label)}</button>`).join("");
          ui$.powers.querySelectorAll("[data-pw]").forEach(b => b.onclick = () => usePower(b.dataset.pw));
        }
      } else ui$.powers.hidden = true;
      // the bottom bar
      const bkey = `${p?.role}|${p?.tagged}|${p?.out}|${p?.safe}`;
      if (ui$.bottom.dataset.key !== bkey) {
        ui$.bottom.dataset.key = bkey;
        ui$.bottom.hidden = false;
        ui$.bottom.innerHTML = `<button type="button" class="mh-bb" data-open="wanted">Bounties</button>
          <button type="button" class="mh-bb" data-open="chat">Team chat</button>
          ${isHunter(s) && !p?.out ? `<button type="button" class="mh-bb tag" data-open="tag">Tag</button>` : ""}
          <button type="button" class="mh-bb safe ${p?.safe ? "on" : ""}" id="mh-safe">${p?.safe ? "Resume" : "SAFE"}</button>`;
        ui$.bottom.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openSheet(b.dataset.open));
        $("mh-safe").onclick = () => { const on = !P(game.s)?.safe; if (on && !confirm("SAFE: you're hidden from the hunters and your clock stops until you resume. The host is told.")) return; game.input("mh-safe", { on }); };
      }
      // SAFE: covers the screen with a resume card
      ui$.safe.hidden = !p?.safe;
      if (p?.safe && !ui$.safe.firstChild) { ui$.safe.innerHTML = `<div class="mh-card"><b>You're safe.</b><p>Hidden from the hunters, your clock stopped. Take your time.</p><button type="button" class="mh-btn go" id="mh-resume">I'm back in</button></div>`; $("mh-resume").onclick = () => game.input("mh-safe", { on: false }); }
      if (!p?.safe) ui$.safe.innerHTML = "";
      // a tag to answer
      const pend = s.pending;
      if (pend && pend.target === meId && seenTagAsk !== `${pend.by}:${pend.until}`) {
        seenTagAsk = `${pend.by}:${pend.until}`;
        buzz([300, 100, 300, 100, 300]);
        ui$.modal.hidden = false;
        ui$.modal.innerHTML = `<div class="mh-card tagq"><b>Did ${name(s, pend.by)} just tag you?</b><p>Only if they touched you, in person.</p>
          <div class="mh-row2"><button type="button" class="mh-btn bad" id="mh-yes">Yes, I'm caught</button><button type="button" class="mh-btn ghost" id="mh-no">No</button></div></div>`;
        $("mh-yes").onclick = () => { game.input("mh-tagack", { yes: true }); ui$.modal.hidden = true; };
        $("mh-no").onclick = () => { game.input("mh-tagack", { yes: false }); ui$.modal.hidden = true; };
      }
      if (!pend || pend.target !== meId) { if (seenTagAsk && !ui$.modal.hidden) ui$.modal.hidden = true; seenTagAsk = pend ? seenTagAsk : null; }
      if (sheet) patchSheet(s);
      drawPings(s); drawMates(s);
    }
    function usePower(k) {
      const s = game.s, p = P(s); if (!p || p.used?.[k]) return;
      if (k === "lockon") { openSheet("lockon"); return; }
      if (k === "decoy") me.decoy = true;
      if (k === "ghost") me.ghost = true;
      game.input("mh-power", { p: k });
      elev.quip(M.LINES.power[k]); ui.toast(`${M.POWERS[k].label}: ${M.POWERS[k].what}.`, "");
      sfx.confirm?.();
    }

    // ---- sheets: the WANTED board, team chat, tag, lock-on
    function openSheet(kind) { sheet = sheet === kind ? null : kind; lastSheetKey = null; patchSheet(game.s, true); }
    function patchSheet(s, force = false) {
      if (!sheet) { ui$.sheet.hidden = true; return; }
      ui$.sheet.hidden = false;
      const key = sheet + (sheet === "wanted" ? JSON.stringify(Object.values(s.players).map(p => [p.tagged, p.out, p.pings])) : sheet === "tag" || sheet === "lockon" ? free(s).map(p => p.id + p.safe).join() : "");
      if (!force && lastSheetKey === key) return;
      lastSheetKey = key;
      ui$.sheet.className = `mh-sheet ${sheet}`;
      const close = `<button type="button" class="mh-x" id="mh-x" aria-label="Close">✕</button>`;
      if (sheet === "wanted") ui$.sheet.innerHTML = `${close}<div class="mh-h">WANTED</div>${board(s)}`;
      if (sheet === "chat") {
        ui$.sheet.innerHTML = `${close}<div class="mh-h">Team chat <small>(${P(s)?.role === "hunter" ? "hunters" : "runners"} only, end-to-end encrypted)</small></div><div class="mh-chat" id="mh-chat"></div>
          <form class="mh-say" id="mh-say"><input id="mh-in-t" maxlength="200" autocomplete="off" placeholder="say something to your team"><button class="mh-btn">Send</button></form>`;
        $("mh-say").onsubmit = e => { e.preventDefault(); const t = $("mh-in-t").value.trim(); if (!t) return; $("mh-in-t").value = ""; chat.push({ from: meId, text: t, at: Date.now() }); patchChat(s); sendTeam(s, { chat: t }); };
        patchChat(s);
      }
      if (sheet === "tag" || sheet === "lockon") {
        const list = free(s).filter(p => p.id !== meId && !p.safe);
        ui$.sheet.innerHTML = `${close}<div class="mh-h">${sheet === "tag" ? "Tag who? (in person only)" : "Lock-on: whose next ping?"}</div>
          <div class="mh-pick">${list.map(p => `<button type="button" class="mh-pick-row" data-who="${esc(p.id)}">${avatarHtml(p, { size: 34 })}<b>${esc(p.handle)}</b></button>`).join("") || "<p>Nobody to pick.</p>"}</div>`;
        ui$.sheet.querySelectorAll("[data-who]").forEach(b => b.onclick = () => {
          const who = b.dataset.who;
          if (sheet === "tag") { if (!confirm(`Tag ${game.s.players[who].handle}? Only if you touched them in person: they'll be asked to confirm.`)) return; game.input("mh-tag", { target: who }); ui.toast("Asked them to confirm the tag…", ""); }
          else { game.input("mh-power", { p: "lockon", target: who }); elev.quip(M.LINES.power.lockon); }
          sheet = null; patchSheet(game.s);
        });
      }
      $("mh-x").onclick = () => { sheet = null; patchSheet(game.s); };
    }
    function patchChat(s) {
      const el = $("mh-chat"); if (!el || !s) return;
      el.innerHTML = chat.map(c => `<div class="mh-line ${c.from === meId ? "me" : ""}"><b>${name(s, c.from)}</b> ${esc(c.text)}</div>`).join("") || `<p class="mh-fine">Nothing yet.</p>`;
      el.scrollTop = el.scrollHeight;
    }
    // the posters: every runner's portrait, name, bounty; CAUGHT / OUT stamps
    const portraits = new Map();
    function portrait(id) {
      if (!portraits.has(id)) { portraits.set(id, null); renderLook(avatarOf(id), { frame: "head" }).then(u => { portraits.set(id, u); document.querySelectorAll(`img[data-portrait="${CSS.escape(id)}"]`).forEach(i => { i.src = u; }); }); }
      return portraits.get(id) ?? "";
    }
    function board(s, { final = false } = {}) {
      const runners = Object.values(s.players).filter(p => p.wasRunner);
      const tagOf = id => s.tags?.find(t => t.target === id);
      return `<div class="mh-board">${runners.map(p => {
        const t = tagOf(p.id);
        const stamp = p.tagged ? `<i class="mh-stamp">CAUGHT<small>${mmss(t?.at ?? 0)} · ${name(s, t?.by)}</small></i>` : p.out ? `<i class="mh-stamp">OUT<small>left the zone</small></i>` : final ? `<i class="mh-stamp free">ESCAPED</i>` : "";
        return `<div class="mh-poster ${p.tagged || p.out ? "caught" : ""} ${final && s.last === p.id ? "last" : ""}">
          <div class="mh-wanted">WANTED</div>
          <img data-portrait="${esc(p.id)}" src="${portrait(p.id) || BLANK}" alt="">
          <div class="mh-pn">${esc(p.handle)}</div>
          <div class="mh-bounty">${G.won(G.bounty(p.pings ?? 0))}</div>
          ${stamp}${final && s.last === p.id ? `<span class="mh-badge">Last Survivor</span>` : ""}
          ${final ? `<div class="mh-pts">${p.score ?? 0} pts</div>` : ""}
        </div>`;
      }).join("")}</div>`;
    }

    // ---- the end: the Hunter holds the posters, then the full board + points
    function renderEnd(s) {
      catchTaps(false);
      stopGeo();
      ui$.top.hidden = ui$.bottom.hidden = ui$.powers.hidden = true; ui$.modal.hidden = true; ui$.safe.hidden = true;
      if (!endShown) {
        endShown = 1;
        sheet = null; ui$.sheet.hidden = true;
        map.show(false);
        elev.results(s.verdict === "hunters" ? M.LINES.hunters[0] : M.LINES.runners[0], board(s, { final: true }));
        setTimeout(() => { endShown = 2; render(game.s); }, 6500);
        return;
      }
      if (endShown === 2) {
        endShown = 3;
        elev.hide();
        const players = Object.values(s.players).map(p => ({ ...p, avatar: avatarOf(p.id) }));
        showResults(players, { title: s.verdict === "hunters" ? "the hunters win" : "the runners win", sub: s.last ? `Last Survivor: ${s.players[s.last]?.handle}` : "", note: "Location stopped when the round ended. Nothing was saved." }, `<div class="mh-final">${board(s, { final: true })}</div>`);
      }
    }

    // ---- start
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    // test hooks: this phone by id (the logic tests run several phones in one page)
    const hook = { setPos: p => { window.__mhSimPos = p; onPos(p); }, map, elev, pings, mates, me, get chat() { return chat; } };
    window.__mh = hook;
    (window.__mhPhones ??= {})[meId] = hook;
    game.start({ phase: "setup", left: 0, players: {}, setup: {}, zone: null, zoneK: 1, hunt: null, tags: [], pending: null, lockon: {}, verdict: null, last: null, warn: null });
    const o = ctx.onEnd;
    ctx.onEnd = r => {
      game.stop(); stopGeo(); clearInterval(phoneTimer);
      try { wake?.release?.(); } catch {}
      document.removeEventListener("visibilitychange", onVis);
      room.off("mh-key", onKey); room.off("mh-pos", onPosMsg); room.off("mh-team", onTeam); room.off("mh-near", onNear);
      catchTaps(false);
      map.dispose(); elev.dispose();
      if (hasMap) world3d?.exitCity?.();
      $("mh-ui")?.remove();
      layer.classList.remove("mh-on"); delete layer.dataset.phase; delete layer.dataset.role;
      window.__mh = null; window.__mhSimPos = null; if (window.__mhPhones) delete window.__mhPhones[meId];
      ui.hide(); o(r);
    };
  },
};
