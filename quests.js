// The three NPC signature quests (demo build). Each is a multi-stage,
// host-authoritative, countdown-timed raid tied to its venue. Bots fill
// empty seats so a solo tester gets the whole arc; humans and bots are
// indistinguishable to the rules.
//
//   sporty · Namsan Park   · 이름표 뜯기 — Name Tag Rip (Running Man)
//   chaos  · Grand Ole Opry· 추격전 — Opry Manhunt (hunters vs runners, hidden roles)
//   chill  · Ikovox        · Telepathy → Whose Cup? → The Tab (quiet 무한도전 formats)
import * as THREE from "https://esm.sh/three@0.160.0";
import { world3d, CHAR_H } from "./world3d.js";
import { arena, m2u } from "./arena.js";
import { HostGame, makeBots, gauss, ui, shareText } from "./gamekit.js";
import { sfx, buzz, flash, shake, reveal, celebrate } from "./fx.js";
import { npcCenter } from "./rooms.js";
import { GHOST_TIPS, TELEPATHY_Q, CUP_PROMPTS, CUP_BOT_LINES } from "./bots.js";

const $ = id => document.getElementById(id);
const pickOne = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------- shared: players + movement
function seedPlayers(ctx, rng, center, targetN, extra = () => ({})) {
  const players = {};
  const around = () => { const a = rng() * Math.PI * 2, r = 6 + rng() * 10; return { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r }; };
  for (const h of ctx.humans) {
    players[h.id] = { id: h.id, handle: h.handle, avatar: h.avatar, isBot: false, ...around(), alive: true,
      skill: 0.5, reaction: 330, ...extra(h) };
  }
  const bots = makeBots(Math.max(0, targetN - ctx.humans.length), rng, new Set(Object.keys(players)));
  for (const b of bots) {
    players[b.id] = { ...b, ...around(), alive: true, brain: { wp: null, until: 0, mode: "wander" }, ...extra(b) };
  }
  return players;
}
// host: copy human positions from the arena (my own from the world)
function syncHumanPositions(s, ctx) {
  for (const p of Object.values(s.players)) {
    if (p.isBot) continue;
    if (p.id === ctx.me.id) { const q = arena.myPos(); p.x = q.x; p.z = q.z; }
    else { const e = arena.entities.get(p.id); if (e) { p.x = e.x; p.z = e.z; } }
  }
}
function moveBot(p, target, speed, dt, center, radius) {
  const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
  if (d < 0.5) return true;
  const k = Math.min(1, speed * dt / d);
  p.x += dx * k; p.z += dz * k;
  // stay inside the circle
  const cx = p.x - center.x, cz = p.z - center.z, cd = Math.hypot(cx, cz);
  if (cd > radius - 2) { p.x = center.x + cx / cd * (radius - 2); p.z = center.z + cz / cd * (radius - 2); }
  return d < 1.5;
}
function randomInCircle(rng, center, radius, minR = 0) {
  const a = rng() * Math.PI * 2, r = minR + rng() * (radius - minR);
  return { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r };
}
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function entitiesFrom(s, extra = () => ({})) {
  return Object.values(s.players).map(p => ({ id: p.id, handle: p.handle, avatar: p.avatar, isBot: p.isBot, x: p.x, z: p.z, alive: p.alive, role: p.role, ...extra(p) }));
}

// ---------------------------------------------------------------- shared: reaction duels (host side)
// duel = { id, a (attacker), b (defender), delay, startedAt, taps: {id: ms}, done }
function duelKit(game, s, ctx, onResolve) {
  const kit = {
    open(a, b) {
      // pair cooldown: no instant rematches
      const key = a < b ? a + "|" + b : b + "|" + a;
      s.pairCool ??= {};
      if ((s.pairCool[key] || 0) > performance.now()) return;
      s.pairCool[key] = performance.now() + 9000;
      const id = `d${(s.duelSeq = (s.duelSeq || 0) + 1)}`;
      const delay = 900 + Math.floor(game.rng() * 1500);
      const d = { id, a, b, delay, startedAt: performance.now(), taps: {}, done: false };
      s.duels[id] = d;
      s.players[a].duel = id; s.players[b].duel = id;
      game.emit("duel", { id, a, b, delay });
      // bots tap by themselves
      for (const pid of [a, b]) {
        const p = s.players[pid];
        if (p.isBot) {
          const early = game.rng() < 0.06;
          const ms = early ? -(50 + game.rng() * 200) : Math.max(120, gauss(game.rng, p.reaction, 80));
          d.taps[pid] = ms;  // applied at flash time; host just records it now
        }
      }
    },
    tap(m) {
      const d = s.duels[m.duel]; if (!d || d.done) return;
      if (m.from !== d.a && m.from !== d.b) return;
      if (d.taps[m.from] === undefined) d.taps[m.from] = m.ms;
    },
    tick() {
      for (const d of Object.values(s.duels)) {
        if (d.done) continue;
        const since = performance.now() - d.startedAt - d.delay;
        const both = d.taps[d.a] !== undefined && d.taps[d.b] !== undefined;
        if (!both && since < 2800) continue;
        d.done = true;
        const ta = d.taps[d.a] ?? 9999, tb = d.taps[d.b] ?? 9999;
        // too early = foul (loses); otherwise faster wins; attacker needs to beat the defender
        let winner;
        if (ta < 0 && tb < 0) winner = d.b;
        else if (ta < 0) winner = d.b;
        else if (tb < 0) winner = d.a;
        else winner = ta < tb ? d.a : d.b;
        delete s.players[d.a].duel; delete s.players[d.b].duel;
        game.emit("duel_end", { id: d.id, a: d.a, b: d.b, winner, ta: Math.round(ta), tb: Math.round(tb) });
        onResolve(d, winner);
      }
    },
  };
  return kit;
}
// client side: show the overlay for my duels
function duelClientHandlers(game, ctx, { verbA = "RIP", verbB = "DODGE" } = {}) {
  return {
    duel(m, players) {
      const me = ctx.me.id;
      const a = players[m.a]?.handle ?? "?", b = players[m.b]?.handle ?? "?";
      if (m.a === me || m.b === me) {
        const role = m.a === me ? "attacker" : "defender";
        sfx.whoosh(); buzz(40);
        $("duel-verb").dataset.verb = role === "attacker" ? verbA : verbB;
        arena.duel.start({ id: m.id, role, delayMs: m.delay, a, b, onTap: (id, ms) => game.input("tap", { duel: id, ms: Math.round(ms) }) });
      } else {
        ui.toast(`${a} goes for ${b}!`, "duel");
      }
    },
    duel_end(m, players, myId) {
      const w = players[m.winner]?.handle ?? "?";
      if (m.a === myId || m.b === myId) {
        const iWon = m.winner === myId;
        arena.duel.result(iWon ? (m.a === myId ? "RIPPED!" : "DODGED!") : (m.a === myId ? "they dodged" : "you got ripped"), iWon);
        if (iWon) { sfx.rip(); flash("#ffd60a", 180); } else { sfx.lose(); flash("#ff2a4a", 260); shake(500, 2); }
      }
      return w;
    },
  };
}

// ====================================================================
// SPORTY — 이름표 뜯기 · Name Tag Rip @ Namsan Park
// ====================================================================
const SPORTY = {
  title: "이름표 뜯기 — Name Tag Rip",
  venue: "Namsan Park · 산스장",
  tagline: "everyone wears a tag. last tag standing wins. ripped players become ghosts who see everything — and whisper.",
  lineOpen: "the bars are warm and so am I. tags are on the table — grab one before the whistle.",
  lineLive: "it's ON up there. you can still come watch from the ghost side.",
  lineDark: "I'm between sets. the next name-tag run is on the clock — be here for it.",
  RADIUS: 130, RIP_RANGE: m2u(11), PHASES: { brief: 20000, scatter: 30000, hunt: 480000, sudden: 90000, end: 45000 },

  start(ctx) {
    const center = npcCenter("sporty");
    arena.enter({ room: ctx.room, me: ctx.me, center, radius: this.RADIUS, visRange: m2u(28) });
    ui.show(); ui.theme("sporty");
    reveal("sporty");
    const Q = this;
    let myRole = "alive";
    let lastTipAt = 0, lastHud = 0;
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seedPlayers(ctx, game.rng, center, 7, p => ({ tags: [p.id], stun: 0, boost: 0, lastRip: -99, ghostTipAt: 0 }));
        for (const p of Object.values(s.players)) p.brain ??= { wp: null, until: 0, mode: "wander" };
      },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const now = performance.now();
        syncHumanPositions(s, ctx);
        const alive = Object.values(s.players).filter(p => p.alive);
        // phase transitions
        if (s.left <= 0) {
          if (s.phase === "brief") { s.phase = "scatter"; s.left = Q.PHASES.scatter; game.emit("phase", { phase: "scatter" }); }
          else if (s.phase === "scatter") { s.phase = "hunt"; s.left = Q.PHASES.hunt; game.emit("phase", { phase: "hunt" }); }
          else if (s.phase === "hunt") { s.phase = "sudden"; s.left = Q.PHASES.sudden; s.r0 = s.radius; game.emit("phase", { phase: "sudden" }); }
          else if (s.phase === "sudden") { finish(s); }
          else if (s.phase === "end") { game.finish(); return; }
        }
        if (s.phase === "sudden") {
          s.radius = Math.max(14, s.r0 * (s.left / Q.PHASES.sudden) + 14 * (1 - s.left / Q.PHASES.sudden));
          for (const p of alive) {
            const out = dist2(p, center) > s.radius + 1;
            p.outSince = out ? (p.outSince ?? now) : undefined;
            if (out && now - p.outSince > 3000) { eliminate(s, p, null, "circle"); }
          }
        }
        if (alive.length <= 1 && (s.phase === "hunt" || s.phase === "sudden")) finish(s);
        // bots
        if (s.phase === "scatter" || s.phase === "hunt" || s.phase === "sudden") {
          for (const p of Object.values(s.players)) {
            if (!p.isBot || !p.alive || p.duel) continue;
            botBrain(s, p, dt, now);
          }
          // ghost bots whisper occasionally
          for (const p of Object.values(s.players)) {
            if (!p.isBot || p.alive) continue;
            if (now - p.ghostTipAt > 40000 + game.rng() * 30000) {
              p.ghostTipAt = now;
              const humans = alive.filter(x => !x.isBot); if (!humans.length) continue;
              const to = pickOne(game.rng, humans);
              const about = alive.filter(x => x.id !== to.id).sort((a, b) => dist2(a, to) - dist2(b, to))[0];
              if (about) { const text = pickOne(game.rng, GHOST_TIPS).replace("{x}", about.handle); s.tips.push({ from: p.id, to: to.id, text, t: Date.now() }); game.emit("tip", { from: p.id, to: to.id, text }); }
            }
          }
        }
        duels.tick();
        for (const p of Object.values(s.players)) { if (p.stun > 0) p.stun -= dt * 1000; if (p.boost > 0) p.boost -= dt * 1000; }
      },
      hostInput(s, m) {
        if (m.in === "rip") {
          const a = s.players[m.from], b = s.players[m.target];
          if (!a || !b || !a.alive || !b.alive || a.duel || b.duel || a.stun > 0) return;
          if (!(s.phase === "hunt" || s.phase === "sudden")) return;
          if (dist2(a, b) > Q.RIP_RANGE * 1.25) return;   // host-side check with slack for latency
          if (performance.now() - a.lastRip < 4000) return;
          a.lastRip = performance.now();
          duels.open(a.id, b.id);
        } else if (m.in === "tap") duels.tap(m);
        else if (m.in === "tip") {
          const from = s.players[m.from], to = s.players[m.to];
          if (!from || from.alive || !to || !to.alive) return;
          s.tips.push({ from: m.from, to: m.to, text: m.text, t: Date.now() });
          game.emit("tip", { from: m.from, to: m.to, text: m.text });
        }
      },
      render(s) { renderSporty(s); },
      onEvent(m) {
        const s = game.s; if (!s) return;
        if (m.ev === "duel") dc.duel(m, s.players);
        else if (m.ev === "duel_end") {
          const w = dc.duel_end(m, s.players, ctx.me.id);
          const loser = m.winner === m.a ? m.b : m.a;
          if (m.winner === m.a) ui.toast(`${s.players[m.a]?.handle} RIPPED ${s.players[m.b]?.handle}'s tag`, "rip");
          else ui.toast(`${s.players[m.b]?.handle} dodged ${s.players[m.a]?.handle}`, "dodge");
          if (loser === ctx.me.id && m.winner === m.a) { myRole = "ghost"; arena.fullRadar = true; }
        }
        else if (m.ev === "tip") { if (m.to === ctx.me.id) { ui.toast(`👻 ${s.players[m.from]?.handle}: "${m.text}"`, "tip"); sfx.ping(); } }
        else if (m.ev === "phase") {
          if (m.phase === "scatter") { ui.toast("SCATTER — 30 s, no ripping yet", "phase"); sfx.whistle(); buzz(60); }
          if (m.phase === "hunt") { ui.toast("HUNT — tags are live", "phase"); sfx.klaxon(); flash("#4da6ff", 200); buzz([60, 40, 60]); }
          if (m.phase === "sudden") { ui.toast("SUDDEN DEATH — the circle is closing", "phase"); sfx.klaxon(); shake(500, 2); }
        }
        else if (m.ev === "elim") { ui.toast(`${s.players[m.who]?.handle} is out (${m.why === "circle" ? "outside the circle" : "ripped"})`, "rip"); if (m.who === ctx.me.id) { myRole = "ghost"; arena.fullRadar = true; flash("#ff2a4a", 300); } }
        else if (m.ev === "finish") { celebrate(center.clone().add(new THREE.Vector3(0, CHAR_H, 0))); reveal("sporty"); }
      },
    }, { hz: 5 });
    const dc = duelClientHandlers(game, ctx);

    function eliminate(s, p, by, why) {
      if (!p.alive) return;
      p.alive = false;
      if (by) { by.tags.push(...p.tags); p.tags = []; }
      s.log.push({ t: Date.now(), type: why, who: p.id, by: by?.id ?? null });
      game.emit("elim", { who: p.id, by: by?.id ?? null, why });
    }
    const duels = {};
    function finish(s) {
      if (s.phase === "end") return;
      const alive = Object.values(s.players).filter(p => p.alive);
      let winner = null;
      if (alive.length === 1) winner = alive[0].id;
      else {
        const ranked = Object.values(s.players).sort((a, b) => (b.tags.length - a.tags.length) || (b.alive - a.alive));
        winner = ranked[0]?.id ?? null;
      }
      s.winner = winner; s.phase = "end"; s.left = Q.PHASES.end;
      game.emit("finish", { winner });
    }
    function botBrain(s, p, dt, now) {
      const sp = 13 + p.skill * 6 + (p.boost > 0 ? 4 : 0);
      const others = Object.values(s.players).filter(o => o.id !== p.id && o.alive);
      if (s.phase === "scatter") {
        if (!p.brain.wp || dist2(p, p.brain.wp) < 2) p.brain.wp = randomInCircle(game.rng, center, s.radius, s.radius * 0.5);
        moveBot(p, p.brain.wp, sp, dt, center, s.radius); return;
      }
      if (p.stun > 0) return;
      const near = others.map(o => ({ o, d: dist2(o, p) })).sort((a, b) => a.d - b.d)[0];
      const hunting = near && near.d < m2u(32) && (p.aggro > 0.35 || s.phase === "sudden");
      if (hunting) {
        moveBot(p, near.o, sp, dt, center, s.radius);
        if (near.d < Q.RIP_RANGE * 0.9 && now - p.lastRip > 6000 + (1 - p.aggro) * 6000 && !near.o.duel) {
          p.lastRip = now; duels.open(p.id, near.o.id);
        }
        return;
      }
      if (near && near.d < m2u(18) && p.aggro <= 0.35) {  // cautious: back away
        const away = { x: p.x + (p.x - near.o.x), z: p.z + (p.z - near.o.z) };
        moveBot(p, away, sp, dt, center, s.radius); return;
      }
      if (!p.brain.wp || dist2(p, p.brain.wp) < 2 || now > p.brain.until) {
        p.brain.wp = randomInCircle(game.rng, center, s.radius * 0.9); p.brain.until = now + 6000 + game.rng() * 8000;
      }
      moveBot(p, p.brain.wp, sp * 0.8, dt, center, s.radius);
    }
    // host-side duel kit needs the live state object: re-create once started
    const initial = { phase: "brief", left: this.PHASES.brief, radius: this.RADIUS, players: {}, duels: {}, log: [], tips: [], winner: null, duelSeq: 0 };
    Object.assign(duels, duelKit(game, initial, ctx, (d, winner) => {
      const s = game.s;
      const a = s.players[d.a], b = s.players[d.b];
      if (winner === d.a) { eliminate(s, b, a, "rip"); }
      else { a.stun = 6000; b.boost = 4000; s.log.push({ t: Date.now(), type: "dodge", who: b.id, by: a.id }); }
    }));
    game.start(initial);

    // ---- render (everyone)
    function renderSporty(s) {
      arena.setEntities(entitiesFrom(s, p => ({ tag: p.tags?.length })));
      arena.setRadius(s.radius);
      const me = s.players[ctx.me.id];
      const alive = Object.values(s.players).filter(p => p.alive);
      const now = performance.now();
      if (now - lastHud < 150) return;
      lastHud = now;
      const phaseName = { brief: "BRIEFING", scatter: "SCATTER", hunt: "HUNT", sudden: "SUDDEN DEATH", end: "RESULT" }[s.phase];
      const mine = me ? (me.alive ? `🏷 ${me.tags.length} tag${me.tags.length === 1 ? "" : "s"}` : "👻 ghost") : "spectating";
      ui.hud(`<div class="hq"><b>${phaseName}</b><span class="clk">${ui.clock(s.left)}</span><span>${alive.length} alive</span><span>${mine}</span></div>`);
      if (s.phase === "brief") {
        ui.once("brief", () => ui.stage("이름표 뜯기", `<img class="photo" src="quests/nametag.jpg" alt="" style="max-height:120px;object-fit:cover"><p>Everyone here wears a <b>name tag</b>. Get close to someone and hit <b>RIP</b> — a reaction duel decides it.<br>Lose your tag and you're a <b>ghost</b>: you see <i>everyone</i> on the radar, and you can whisper tips to the living. Alliances, betrayals, your call.</p>
          <p class="st-list">${Object.values(s.players).map(p => `<span class="tagchip ${p.isBot ? "bot" : ""}">${p.handle}</span>`).join("")}</p>`, `Namsan Park · the whistle is coming`));
        return;
      }
      if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const w = s.players[s.winner];
        const ranked = Object.values(s.players).sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0));
        const story = s.log.map(l => l.type === "rip" ? `${s.players[l.by]?.handle} ripped ${s.players[l.who]?.handle}` : l.type === "dodge" ? `${s.players[l.who]?.handle} dodged ${s.players[l.by]?.handle}` : `${s.players[l.who]?.handle} fell outside the circle`);
        const tips = s.tips.map(t => `👻 ${s.players[t.from]?.handle} → ${s.players[t.to]?.handle}: "${t.text}"`);
        ui.stage(`${w?.handle ?? "nobody"} keeps the tag`, `
          <ol class="podium">${ranked.slice(0, 5).map(p => `<li><b>${p.handle}</b> <span>${p.tags?.length ?? 0} tags${p.alive ? " · alive" : ""}</span></li>`).join("")}</ol>
          <div class="story"><b>How it went down</b>${story.length ? "<ul>" + story.map(x => `<li>${x}</li>`).join("") + "</ul>" : "<p>nobody ripped anybody. peaceful hike.</p>"}</div>
          ${tips.length ? `<div class="story"><b>The ghosts were talking</b><ul>${tips.map(x => `<li>${x}</li>`).join("")}</ul></div>` : ""}
          <button class="share" id="share-btn">share the story</button>`, `Name Tag Rip · Namsan Park`);
        $("share-btn")?.addEventListener("click", () => shareText(`Name Tag Rip @ Namsan — ${w?.handle} won with ${w?.tags?.length} tags.\n` + story.join("\n")));
        return;
      }
      // live HUD panel: rip button / ghost tools
      if (me && me.alive) {
        const inRange = arena.near(Q.RIP_RANGE).filter(e => e.alive !== false);
        const t = inRange.sort((a, b) => arena.distTo(a) - arena.distTo(b))[0];
        const can = (s.phase === "hunt" || s.phase === "sudden") && t && !(me.stun > 0) && !me.duel;
        if (!ui.once(`rip:${s.phase}:${can ? 1 : 0}:${t?.id ?? ""}:${me.stun > 0 ? 1 : 0}`, () => {})) return;
        ui.panel(`<div class="actionbar">
            <button id="rip-btn" class="big ${can ? "hot" : ""}" ${can ? "" : "disabled"}>${me.stun > 0 ? "stunned…" : t ? `RIP ${t.handle}` : (s.phase === "scatter" ? "scatter!" : "get closer")}</button>
            <div class="ab-sub">${s.phase === "sudden" ? "circle closing — stay inside" : "other players show up within ~28 m"}</div></div>`, "bottom");
        $("rip-btn").onclick = () => { if (can) { game.input("rip", { target: t.id }); sfx.pop(); } };
      } else if (me && !me.alive) {
        const living = alive.filter(p => p.id !== ctx.me.id);
        const cd = Math.max(0, 45000 - (now - lastTipAt));
        if (!ui.once(`ghost:${living.map(p => p.id).join(",")}:${cd > 0 ? Math.ceil(cd / 1000) : 0}`, () => {})) return;
        ui.panel(`<div class="ghost"><b>👻 you're a ghost — you see everything.</b> whisper to someone living:
          <div class="ghost-row">${living.map(p => `<button class="ch small" data-to="${p.id}" ${cd > 0 ? "disabled" : ""}>${p.handle}</button>`).join("")}</div>
          <div class="ghost-row">${GHOST_TIPS.slice(0, 4).map((t, i) => `<label><input type="radio" name="tip" value="${i}" ${i === 0 ? "checked" : ""}> ${t.replace("{x}", "…")}</label>`).join("")}</div>
          <div class="ab-sub">${cd > 0 ? `next whisper in ${Math.ceil(cd / 1000)} s` : "pick a person, then a line"}</div></div>`, "bottom");
        $("game-panel").querySelectorAll("button[data-to]").forEach(b => b.onclick = () => {
          const to = b.dataset.to;
          const i = +($("game-panel").querySelector("input[name=tip]:checked")?.value ?? 0);
          // the whisper names the person nearest to the target (ghosts can see)
          const target = s.players[to];
          const about = alive.filter(x => x.id !== to).sort((a, b) => dist2(a, target) - dist2(b, target))[0];
          const text = GHOST_TIPS[i].replace("{x}", about?.handle ?? "someone");
          game.input("tip", { to, text }); lastTipAt = performance.now(); sfx.ping();
        });
      } else {
        ui.once("spec", () => ui.panel(`<div class="ab-sub">spectating</div>`, "bottom"));
      }
    }
    // cleanup when the game ends (onEnd is called by host tick; everyone leaves via rooms)
    const origEnd = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); arena.leave(); ui.hide(); arena.duel.end(); origEnd(); };
  },
};

// ====================================================================
// CHAOS — 추격전 · Opry Manhunt (hidden roles)
// ====================================================================
const CHAOS = {
  title: "추격전 — Opry Manhunt",
  venue: "Grand Ole Opry · the alley",
  tagline: "two of you are hunters and nobody knows who. runners plant three stickers and make it back to the door.",
  lineOpen: "SOMEONE in this alley is a hunter. could be you. stickers are on the wall — go go GO.",
  lineLive: "they're already running. come haunt the alley.",
  lineDark: "the wall's quiet… for now. next manhunt is on the clock.",
  RADIUS: 95, CATCH: m2u(10), PHASES: { brief: 30000, hunt: 420000, final: 90000, end: 45000 },

  start(ctx) {
    const center = npcCenter("chaos");
    arena.enter({ room: ctx.room, me: ctx.me, center, radius: this.RADIUS, visRange: m2u(26) });
    ui.show(); ui.theme("chaos");
    reveal("chaos");
    const Q = this;
    const spots = [0, 1, 2].map(i => { const a = (i / 3) * Math.PI * 2 + 0.4; return { x: center.x + Math.cos(a) * 48, z: center.z + Math.sin(a) * 48, name: ["the sign", "the back door", "the corner"][i] }; });
    const spotMarks = spots.map(sp => arena.mark(sp, 0xff4d6d, 7));
    const doorMark = arena.mark(center, 0xffd60a, 9);
    let lastHud = 0, pingMarks = [];
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seedPlayers(ctx, game.rng, center, 7, () => ({ role: "runner", stickers: [], lastRip: -99, stun: 0, progress: 0, at: null }));
        const ids = Object.keys(s.players);
        const nH = ids.length >= 6 ? 2 : 1;
        const shuffled = [...ids].sort(() => game.rng() - 0.5);
        for (let i = 0; i < nH; i++) s.players[shuffled[i]].role = "hunter";
        for (const p of Object.values(s.players)) p.brain ??= { wp: null, until: 0 };
      },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const now = performance.now();
        syncHumanPositions(s, ctx);
        const runners = Object.values(s.players).filter(p => p.role === "runner");
        if (s.left <= 0) {
          if (s.phase === "brief") { s.phase = "hunt"; s.left = Q.PHASES.hunt; game.emit("phase", { phase: "hunt" }); }
          else if (s.phase === "hunt") { s.phase = "final"; s.left = Q.PHASES.final; game.emit("phase", { phase: "final" }); }
          else if (s.phase === "final") finish(s, "hunters");
          else if (s.phase === "end") { game.finish(); return; }
        }
        if (s.phase === "hunt" || s.phase === "final") {
          // sticker planting: stand inside a spot ring for 6 s
          for (const p of runners) {
            const sp = spots.findIndex(q => dist2(p, q) < 6.5);
            if (sp >= 0 && !p.stickers.includes(sp)) {
              if (p.at !== sp) { p.at = sp; p.progress = 0; }
              p.progress += dt * 1000;
              if (p.progress >= 6000) { p.stickers.push(sp); p.progress = 0; p.at = null; s.log.push({ t: Date.now(), type: "sticker", who: p.id, spot: sp }); game.emit("ping", { who: p.id, spot: sp, x: spots[sp].x, z: spots[sp].z }); }
            } else { p.at = null; p.progress = 0; }
            // win: three stickers and at the door
            if (p.stickers.length >= 3 && dist2(p, center) < 9) { finish(s, "runners", p.id); return; }
          }
          if (!runners.length) { finish(s, "hunters"); return; }
          for (const p of Object.values(s.players)) { if (p.isBot && !p.duel) botBrain(s, p, dt, now); if (p.stun > 0) p.stun -= dt * 1000; }
        }
        duels.tick();
      },
      hostInput(s, m) {
        if (m.in === "catch") {
          const a = s.players[m.from], b = s.players[m.target];
          if (!a || !b || a.role !== "hunter" || b.role !== "runner" || a.duel || b.duel || a.stun > 0) return;
          if (!(s.phase === "hunt" || s.phase === "final")) return;
          if (dist2(a, b) > Q.CATCH * 1.25) return;
          if (performance.now() - a.lastRip < 4000) return;
          a.lastRip = performance.now(); duels.open(a.id, b.id);
        } else if (m.in === "tap") duels.tap(m);
      },
      render(s) { renderChaos(s); },
      onEvent(m) {
        const s = game.s; if (!s) return;
        if (m.ev === "duel") dc.duel(m, s.players);
        else if (m.ev === "duel_end") {
          dc.duel_end(m, s.players, ctx.me.id);
          if (m.winner === m.a) ui.toast(`${s.players[m.a]?.handle} CAUGHT ${s.players[m.b]?.handle} — they hunt now`, "rip");
          else ui.toast(`${s.players[m.b]?.handle} slipped away from ${s.players[m.a]?.handle}`, "dodge");
        }
        else if (m.ev === "ping") {
          const mine = s.players[ctx.me.id];
          if (mine?.role === "hunter") { ui.toast(`📍 a sticker was planted at ${spots[m.spot].name}`, "tip"); sfx.ping(); const mk = arena.mark({ x: m.x, z: m.z }, 0xff2a4a, 10); pingMarks.push(mk); setTimeout(() => arena.unmark(mk), 6000); }
          else if (m.who === ctx.me.id) { ui.toast(`sticker planted (${mine.stickers?.length ?? "?"}/3) — hunters just felt that`, "phase"); sfx.stamp(); buzz(50); }
        }
        else if (m.ev === "phase") {
          if (m.phase === "hunt") { ui.toast("HUNT — runners, plant your stickers", "phase"); sfx.klaxon(); flash("#ff2a4a", 220); buzz([60, 40, 60]); }
          if (m.phase === "final") { ui.toast("FINAL 90 s — runners to the DOOR", "phase"); sfx.klaxon(); shake(500, 2); }
        }
        else if (m.ev === "finish") { celebrate(center.clone().add(new THREE.Vector3(0, CHAR_H, 0))); reveal("chaos"); }
      },
    }, { hz: 5 });
    const dc = duelClientHandlers(game, ctx, { verbA: "CATCH", verbB: "SLIP" });
    const duels = {};
    function finish(s, side, hero = null) {
      if (s.phase === "end") return;
      s.phase = "end"; s.left = Q.PHASES.end; s.winnerSide = side; s.hero = hero;
      game.emit("finish", { side, hero });
    }
    function botBrain(s, p, dt, now) {
      const sp = 12 + p.skill * 6;
      if (p.stun > 0) return;
      if (p.role === "runner") {
        const next = [0, 1, 2].find(i => !p.stickers.includes(i));
        const target = next === undefined ? center : spots[next];
        // hunters visible nearby? sidestep
        const hunters = Object.values(s.players).filter(o => o.role === "hunter" && dist2(o, p) < m2u(20));
        if (hunters.length && game.rng() < 0.6 && next !== undefined) {
          const h = hunters[0]; const away = { x: p.x + (p.x - h.x), z: p.z + (p.z - h.z) };
          moveBot(p, away, sp, dt, center, s.radius); return;
        }
        if (dist2(p, target) > 3.5) moveBot(p, target, sp, dt, center, s.radius);   // then stand still to plant
      } else {
        const runners = Object.values(s.players).filter(o => o.role === "runner");
        const near = runners.map(o => ({ o, d: dist2(o, p) })).sort((a, b) => a.d - b.d)[0];
        if (near && near.d < m2u(30)) {
          moveBot(p, near.o, sp * 1.05, dt, center, s.radius);
          if (near.d < Q.CATCH * 0.9 && now - p.lastRip > 6000 && !near.o.duel) { p.lastRip = now; duels.open(p.id, near.o.id); }
          return;
        }
        // patrol between sticker spots and the door
        if (!p.brain.wp || dist2(p, p.brain.wp) < 3 || now > p.brain.until) { p.brain.wp = pickOne(game.rng, [...spots, center]); p.brain.until = now + 9000; }
        moveBot(p, p.brain.wp, sp * 0.85, dt, center, s.radius);
      }
    }
    const initial = { phase: "brief", left: this.PHASES.brief, radius: this.RADIUS, players: {}, duels: {}, log: [], winnerSide: null, hero: null, duelSeq: 0 };
    Object.assign(duels, duelKit(game, initial, ctx, (d, winner) => {
      const s = game.s; const a = s.players[d.a], b = s.players[d.b];
      if (winner === d.a) { b.role = "hunter"; b.caughtBy = a.id; s.log.push({ t: Date.now(), type: "catch", who: b.id, by: a.id }); }
      else { a.stun = 5000; s.log.push({ t: Date.now(), type: "slip", who: b.id, by: a.id }); }
    }));
    game.start(initial);

    function renderChaos(s) {
      arena.setEntities(entitiesFrom(s));
      const me = s.players[ctx.me.id];
      const now = performance.now();
      if (now - lastHud < 150) return;
      lastHud = now;
      const runners = Object.values(s.players).filter(p => p.role === "runner");
      const phaseName = { brief: "BRIEFING", hunt: "HUNT", final: "FINAL DASH", end: "RESULT" }[s.phase];
      const role = me ? (me.role === "hunter" ? "🔴 HUNTER" : `🟢 RUNNER · ${me.stickers?.length ?? 0}/3`) : "spectating";
      ui.hud(`<div class="hq"><b>${phaseName}</b><span class="clk">${ui.clock(s.left)}</span><span>${runners.length} runners left</span><span>${role}</span></div>`);
      if (s.phase === "brief") {
        if (!ui.once(`brief:${me?.role ?? ""}`, () => {})) return;
        const card = me?.role === "hunter"
          ? `<p class="role hunter">You are a <b>HUNTER</b>. Nobody knows. Catch runners — get close and hit CATCH (reaction duel). Every sticker they plant <b>pings</b> you with its location.</p>`
          : `<p class="role runner">You are a <b>RUNNER</b>. Plant stickers at the three marked spots (stand in the ring 6 s), then get back to the Opry door. Every sticker you plant pings the hunters. Caught runners <b>become hunters</b>.</p>`;
        ui.stage("추격전 · Opry Manhunt", `${card}<p class="st-list">${Object.values(s.players).map(p => `<span class="tagchip ${p.isBot ? "bot" : ""}">${p.handle}</span>`).join("")}</p><p class="ab-sub">bluff in the lobby chat if you like. nobody can check.</p>`, `Grand Ole Opry · ${ui.clock(s.left)} to the siren`);
        return;
      }
      if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const hunters = Object.values(s.players).filter(p => p.role === "hunter");
        const story = s.log.map(l => l.type === "catch" ? `${s.players[l.by]?.handle} caught ${s.players[l.who]?.handle}` : l.type === "slip" ? `${s.players[l.who]?.handle} slipped ${s.players[l.by]?.handle}` : `${s.players[l.who]?.handle} planted a sticker at ${spots[l.spot].name}`);
        const title = s.winnerSide === "runners" ? `${s.players[s.hero]?.handle} made it to the door` : "the hunters took the alley";
        ui.stage(title, `<div class="story"><b>The hunters were</b><p>${hunters.map(h => h.handle + (h.caughtBy ? ` (turned by ${s.players[h.caughtBy]?.handle})` : " (original)")).join(" · ")}</p></div>
          <div class="story"><b>The chase</b>${story.length ? "<ul>" + story.map(x => `<li>${x}</li>`).join("") + "</ul>" : "<p>quiet night.</p>"}</div>
          <button class="share" id="share-btn">share the chase</button>`, "Opry Manhunt");
        $("share-btn")?.addEventListener("click", () => shareText(`Opry Manhunt — ${title}.\n` + story.join("\n")));
        return;
      }
      if (!me) { ui.once("spec", () => ui.panel(`<div class="ab-sub">spectating</div>`, "bottom")); return; }
      if (me.role === "hunter") {
        const t = arena.near(Q.CATCH).filter(e => e.role === "runner").sort((a, b) => arena.distTo(a) - arena.distTo(b))[0];
        const can = t && !(me.stun > 0) && !me.duel;
        if (!ui.once(`catch:${can ? 1 : 0}:${t?.id ?? ""}:${me.stun > 0 ? 1 : 0}`, () => {})) return;
        ui.panel(`<div class="actionbar"><button id="catch-btn" class="big ${can ? "hot" : ""}" ${can ? "" : "disabled"}>${me.stun > 0 ? "stunned…" : t ? `CATCH ${t.handle}` : "hunt — pings show on the radar"}</button><div class="ab-sub">runners show up within ~26 m · stickers ping you</div></div>`, "bottom");
        $("catch-btn").onclick = () => { if (can) { game.input("catch", { target: t.id }); sfx.pop(); } };
      } else {
        const next = [0, 1, 2].find(i => !me.stickers.includes(i));
        const goal = next === undefined ? "all stickers planted — get to the DOOR (gold ring)" : `plant at ${spots[next].name} (red ring ${Math.round(dist2(arena.myPos(), spots[next]) / 0.55)} m away)`;
        const planting = me.at !== null && me.at !== undefined;
        ui.resetKey();   // progress bar is live; cheap to rebuild
        ui.panel(`<div class="actionbar"><div class="ab-sub">${goal}</div>${planting ? ui.bar(me.progress / 6000, "plant") + `<div class="ab-sub">planting… stay in the ring</div>` : ""}</div>`, "bottom");
      }
    }
    const origEnd = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); arena.leave(); ui.hide(); arena.duel.end(); origEnd(); };
  },
};

// ====================================================================
// CHILL — Ikovox · Telepathy → Whose Cup? → The Tab
// ====================================================================
const CHILL = {
  title: "Telepathy → Whose Cup? → The Tab",
  venue: "Ikovox · the window table",
  tagline: "read the table, write a cup, and somebody picks up the tab by naming everyone. quiet, a little exposing, and you leave knowing people.",
  lineOpen: "the window table's free. sit — we're about to find out who you all are.",
  lineLive: "they're mid-round. slide in quietly.",
  lineDark: "beans are resting. next sitting is on the clock.",
  PHASES: { brief: 15000, ans: 12000, reveal: 5000, cups_write: 45000, cups_guess: 40000, cups_reveal: 15000, tab_vote: 20000, last_call: 40000, pair_vote: 20000, end: 45000 },

  start(ctx) {
    ui.show(); ui.theme("chill");
    $("game-layer").style.backgroundImage = "url(lobbies/chill.png)";
    reveal("chill");
    const Q = this;
    let lastHud = 0, myPicked = null;
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seedPlayers(ctx, game.rng, { x: 0, z: 0 }, 6, () => ({ tab: 0, cup: null, guesses: {}, vote: null, confirm: null, pair: null, score: 0 }));
        s.rounds = TELEPATHY_Q.slice().sort(() => game.rng() - 0.5).slice(0, 5);
        s.cupPrompt = pickOne(game.rng, CUP_PROMPTS);
      },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        const bots = P.filter(p => p.isBot);
        // bots act mid-phase
        if (s.phase === "ans") {
          for (const b of bots) if (b.answers[s.round] === undefined && game.rng() < dt * 0.6) {
            const opts = s.rounds[s.round].opts;
            // lean toward what others already picked (telepathy!) with some independence
            const counts = {}; for (const p of P) { const a = p.answers[s.round]; if (a) counts[a] = (counts[a] || 0) + 1; }
            const lead = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
            b.answers[s.round] = (lead && game.rng() < 0.55) ? lead[0] : pickOne(game.rng, opts);
          }
          if (P.every(p => p.answers[s.round] !== undefined)) s.left = Math.min(s.left, 800);
        } else if (s.phase === "cups_write") {
          for (const b of bots) if (!b.cup && game.rng() < dt * 0.25) b.cup = pickOne(game.rng, CUP_BOT_LINES[s.cupPrompt] || ["hmm"]);
          if (P.every(p => p.cup)) s.left = Math.min(s.left, 1200);
        } else if (s.phase === "cups_guess") {
          for (const b of bots) if (game.rng() < dt * 0.5) {
            const unknown = s.cups.filter(c => b.guesses[c.i] === undefined && c.who !== b.id);
            if (unknown.length) { const c = pickOne(game.rng, unknown); const others = P.filter(p => p.id !== b.id); b.guesses[c.i] = (game.rng() < 0.35 + b.skill * 0.3) ? c.who : pickOne(game.rng, others).id; }
          }
        } else if (s.phase === "tab_vote") {
          for (const b of bots) if (!b.vote && game.rng() < dt * 0.5) { const humans = P.filter(p => !p.isBot); b.vote = (humans.length && game.rng() < 0.6 ? pickOne(game.rng, humans) : pickOne(game.rng, P.filter(p => p.id !== b.id))).id; }
          if (P.every(p => p.vote)) s.left = Math.min(s.left, 1000);
        } else if (s.phase === "last_call") {
          for (const b of bots) if (b.confirm === null && game.rng() < dt * 0.15) b.confirm = game.rng() < 0.8;
        } else if (s.phase === "pair_vote") {
          for (const b of bots) if (!b.pair && game.rng() < dt * 0.5) { const others = P.filter(p => p.id !== b.id); const humans = others.filter(p => !p.isBot); b.pair = (humans.length && game.rng() < 0.5 ? pickOne(game.rng, humans) : pickOne(game.rng, others)).id; }
          if (P.every(p => p.pair)) s.left = Math.min(s.left, 1000);
        }
        if (s.left > 0) return;
        // transitions
        if (s.phase === "brief") { s.phase = "ans"; s.round = 0; s.left = Q.PHASES.ans; game.emit("phase", { phase: "ans", round: 0 }); }
        else if (s.phase === "ans") {
          // score the round: the table syncs if the plurality answer has >= 60%
          const counts = {}; for (const p of P) { const a = p.answers[s.round] ?? "—"; counts[a] = (counts[a] || 0) + 1; }
          const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          const synced = top !== "—" && n / P.length >= 0.6;
          s.results.push({ q: s.rounds[s.round].q, top, n, synced, counts });
          if (synced) { s.streak++; for (const p of P) if (p.answers[s.round] === top) p.score += 1; } else s.streak = 0;
          s.phase = "reveal"; s.left = Q.PHASES.reveal; game.emit("phase", { phase: "reveal", synced, top });
        }
        else if (s.phase === "reveal") {
          if (s.round + 1 < s.rounds.length) { s.round++; s.phase = "ans"; s.left = Q.PHASES.ans; game.emit("phase", { phase: "ans", round: s.round }); }
          else { s.phase = "cups_write"; s.left = Q.PHASES.cups_write; game.emit("phase", { phase: "cups_write" }); }
        }
        else if (s.phase === "cups_write") {
          s.cups = P.filter(p => p.cup).map((p, i) => ({ i, text: p.cup, who: p.id })).sort(() => game.rng() - 0.5).map((c, i) => ({ ...c, i }));
          s.phase = "cups_guess"; s.left = Q.PHASES.cups_guess; game.emit("phase", { phase: "cups_guess" });
        }
        else if (s.phase === "cups_guess") {
          for (const p of P) for (const c of s.cups) if (p.guesses[c.i] === c.who && c.who !== p.id) p.score += 2;
          s.phase = "cups_reveal"; s.left = Q.PHASES.cups_reveal; game.emit("phase", { phase: "cups_reveal" });
        }
        else if (s.phase === "cups_reveal") { s.phase = "tab_vote"; s.left = Q.PHASES.tab_vote; game.emit("phase", { phase: "tab_vote" }); }
        else if (s.phase === "tab_vote") {
          const counts = {}; for (const p of P) if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          s.payer = top ? top[0] : pickOne(game.rng, P).id;
          s.phase = "last_call"; s.left = Q.PHASES.last_call; game.emit("phase", { phase: "last_call", payer: s.payer });
        }
        else if (s.phase === "last_call") {
          const yes = P.filter(p => p.id !== s.payer && p.confirm === true).length, no = P.filter(p => p.id !== s.payer && p.confirm === false).length;
          s.lastCallOk = yes >= no;
          if (s.lastCallOk) s.players[s.payer].score += 3;
          s.phase = "pair_vote"; s.left = Q.PHASES.pair_vote; game.emit("phase", { phase: "pair_vote", ok: s.lastCallOk });
        }
        else if (s.phase === "pair_vote") {
          s.pairs = [];
          for (const p of P) { const q = s.players[p.pair]; if (q && q.pair === p.id && p.id < q.id) s.pairs.push([p.id, q.id]); }
          s.phase = "end"; s.left = Q.PHASES.end; game.emit("finish", {});
        }
        else if (s.phase === "end") { game.finish(); }
      },
      hostInput(s, m) {
        const p = s.players[m.from]; if (!p) return;
        if (m.in === "ans" && s.phase === "ans" && m.round === s.round) p.answers[s.round] = m.v;
        else if (m.in === "cup" && s.phase === "cups_write") p.cup = String(m.text).slice(0, 80);
        else if (m.in === "guess" && s.phase === "cups_guess") p.guesses[m.cup] = m.who;
        else if (m.in === "vote" && s.phase === "tab_vote") p.vote = m.who;
        else if (m.in === "confirm" && s.phase === "last_call") p.confirm = !!m.ok;
        else if (m.in === "pair" && s.phase === "pair_vote") p.pair = m.who;
      },
      render(s) { renderChill(s); },
      onEvent(m) {
        if (m.ev === "phase") {
          myPicked = null;
          if (m.phase === "ans") { sfx.pop(); }
          if (m.phase === "reveal") { if (m.synced) { sfx.chime(); flash("#7dd3a0", 160); } else { sfx.lose(); } }
          if (m.phase === "cups_write") { sfx.ping(); ui.toast("cups out — write one line", "phase"); }
          if (m.phase === "cups_guess") { ui.toast("whose cup is whose?", "phase"); }
          if (m.phase === "tab_vote") { ui.toast("somebody picks up the tab…", "phase"); }
          if (m.phase === "last_call") { sfx.stamp(); buzz(60); }
          if (m.phase === "pair_vote") { sfx.ping(); }
        } else if (m.ev === "finish") { sfx.win(); reveal("chill"); }
      },
    }, { hz: 4 });
    const initial = { phase: "brief", left: this.PHASES.brief, players: {}, round: 0, rounds: [], results: [], streak: 0, cups: [], cupPrompt: "", payer: null, lastCallOk: null, pairs: [] };
    // seedPlayers sets answers? add here
    game.h.hostInit = (orig => s => { orig(s); for (const p of Object.values(s.players)) p.answers = {}; })(game.h.hostInit);
    game.start(initial);

    function renderChill(s) {
      const now = performance.now();
      if (now - lastHud < 150) return;
      lastHud = now;
      const P = Object.values(s.players);
      const me = s.players[ctx.me.id];
      const names = { brief: "SITTING DOWN", ans: "TELEPATHY", reveal: "TELEPATHY", cups_write: "WHOSE CUP?", cups_guess: "WHOSE CUP?", cups_reveal: "WHOSE CUP?", tab_vote: "THE TAB", last_call: "LAST CALL", pair_vote: "ONE MORE COFFEE", end: "RECEIPT" };
      ui.hud(`<div class="hq"><b>${names[s.phase]}</b><span class="clk">${ui.clock(s.left)}</span><span>${P.length} at the table</span><span>streak ${s.streak}</span></div>`);
      if (s.phase === "brief") {
        if (!ui.once("brief", () => {})) return;
        ui.stage("Ikovox · the window table", `<p>Nabi runs the table. Three courses: <b>Telepathy</b> (answer what the table would answer — you score when the table syncs), <b>Whose Cup?</b> (one anonymous line each; guess who wrote what), then <b>The Tab</b> — the table votes who picks it up, and that person has to name everyone and one thing they learned. Then one last coffee: pick a person you'd keep talking to.</p><p class="st-list">${P.map(p => `<span class="tagchip ${p.isBot ? "bot" : ""}">${p.handle}</span>`).join("")}</p>`, `Nabi · ${ui.clock(s.left)}`);
        return;
      }
      if (s.phase === "ans") {
        const q = s.rounds[s.round];
        const mine = me?.answers?.[s.round];
        if (!ui.once(`ans:${s.round}:${mine ?? myPicked ?? ""}`, () => {})) return;
        ui.stage(q.q, ui.choices(q.opts, null, { picked: mine ?? myPicked }) + `<p class="ab-sub">round ${s.round + 1}/${s.rounds.length} · answer what THIS table answers</p>`, `telepathy · ${ui.clock(s.left)}`);
        ui.bindChoices(v => { myPicked = v; game.input("ans", { round: s.round, v }); sfx.pop(); });
        return;
      }
      if (s.phase === "reveal") {
        if (!ui.once(`reveal:${s.results.length}`, () => {})) return;
        const r = s.results[s.results.length - 1];
        const rows = Object.entries(r.counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="rev-row"><span>${k}</span>${ui.bar(n / P.length)}<b>${n}</b></div>`).join("");
        ui.stage(r.synced ? "✓ the table synced" : "✗ scattered", `<p><i>${r.q}</i></p>${rows}<p class="ab-sub">${r.synced ? `+1 for everyone who said "${r.top}"` : "no points — read the room"}</p>`, `round ${s.round + 1}`);
        return;
      }
      if (s.phase === "cups_write") {
        if (!ui.once(`cw:${me?.cup ? 1 : 0}:${P.filter(p => p.cup).length}`, () => {})) return;
        if (me && !me.cup) {
          ui.stage(`your cup: <i>${s.cupPrompt}</i>`, ui.prompt("one honest line…", text => game.input("cup", { text }), { maxlength: 80, submitLabel: "write it" }) + `<p class="ab-sub">anonymous until the guess round</p>`, `whose cup? · ${ui.clock(s.left)}`);
        } else ui.stage("cup written", `<p>${P.filter(p => p.cup).length}/${P.length} cups on the table…</p>`, `whose cup? · ${ui.clock(s.left)}`);
        return;
      }
      if (s.phase === "cups_guess") {
        if (!ui.once(`cg:${JSON.stringify(me?.guesses ?? {})}`, () => {})) return;
        const others = P.filter(p => p.id !== ctx.me.id);
        const html = s.cups.filter(c => c.who !== ctx.me.id).map(c => `<div class="cup"><p>“${c.text}”</p><div class="choices">${others.map(o => `<button class="ch small" data-cup="${c.i}" data-who="${o.id}" ${me?.guesses?.[c.i] === o.id ? 'data-on="1"' : ""}>${o.handle}</button>`).join("")}</div></div>`).join("");
        ui.stage(`<i>${s.cupPrompt}</i> — who wrote which?`, `<div class="cups">${html}</div>`, `whose cup? · ${ui.clock(s.left)}`);
        $("game-panel").querySelectorAll("button[data-cup]").forEach(b => { if (b.dataset.on) b.classList.add("on"); b.onclick = () => { game.input("guess", { cup: +b.dataset.cup, who: b.dataset.who }); sfx.pop(); }; });
        return;
      }
      if (s.phase === "cups_reveal") {
        if (!ui.once("cr", () => {})) return;
        ui.stage("the cups, signed", `<div class="cups">${s.cups.map(c => `<div class="cup"><p>“${c.text}”</p><b>— ${s.players[c.who]?.handle}</b></div>`).join("")}</div>`, "whose cup?");
        return;
      }
      if (s.phase === "tab_vote") {
        if (!ui.once(`tv:${me?.vote ?? myPicked ?? ""}`, () => {})) return;
        ui.stage("who picks up the tab?", `<p class="ab-sub">the one most likely to know everyone's order by now</p>` + ui.choices(P.filter(p => p.id !== ctx.me.id).map(p => ({ value: p.id, label: p.handle })), null, { picked: me?.vote ?? myPicked }), `the tab · ${ui.clock(s.left)}`);
        ui.bindChoices(v => { myPicked = v; game.input("vote", { who: v }); sfx.pop(); });
        return;
      }
      if (s.phase === "last_call") {
        if (!ui.once(`lc:${me?.confirm ?? myPicked ?? ""}`, () => {})) return;
        const payer = s.players[s.payer];
        if (s.payer === ctx.me.id) {
          ui.stage("you've got the tab", `<p>Say it out loud, to the table: <b>everyone's name</b> and <b>one thing you learned</b> about them from their cup. The table confirms.</p><ol>${P.filter(p => p.id !== ctx.me.id).map(p => `<li>${p.handle} — ${s.cups.find(c => c.who === p.id)?.text ?? "…"}</li>`).join("")}</ol>`, `last call · ${ui.clock(s.left)}`);
        } else {
          ui.stage(`${payer?.handle} is naming the table`, `<p>Did they get you right?</p>` + ui.choices([{ value: "yes", label: "✓ they got it" }, { value: "no", label: "✗ nope" }], null, { picked: me?.confirm === true ? "yes" : me?.confirm === false ? "no" : myPicked }), `last call · ${ui.clock(s.left)}`);
          ui.bindChoices(v => { myPicked = v; game.input("confirm", { ok: v === "yes" }); sfx.pop(); });
        }
        return;
      }
      if (s.phase === "pair_vote") {
        if (!ui.once(`pv:${me?.pair ?? myPicked ?? ""}`, () => {})) return;
        ui.stage("one more coffee?", `<p class="ab-sub">pick the person you'd keep talking to. if it's mutual, you'll both know.</p>` + ui.choices(P.filter(p => p.id !== ctx.me.id).map(p => ({ value: p.id, label: p.handle })), null, { picked: me?.pair ?? myPicked }), `${ui.clock(s.left)}`);
        ui.bindChoices(v => { myPicked = v; game.input("pair", { who: v }); sfx.pop(); });
        return;
      }
      if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const ranked = P.slice().sort((a, b) => b.score - a.score);
        const pairs = s.pairs.map(([a, b]) => `${s.players[a]?.handle} ☕ ${s.players[b]?.handle}`);
        const myPair = s.pairs.find(pr => pr.includes(ctx.me.id));
        ui.stage("the receipt", `<div class="receipt">
          <div class="rc-h">IKOVOX · window table · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          ${s.results.map(r => `<div class="rc-row"><span>${r.q}</span><b>${r.synced ? "✓ " + r.top : "✗"}</b></div>`).join("")}
          <div class="rc-row"><span>cups signed</span><b>${s.cups.length}</b></div>
          <div class="rc-row"><span>tab picked up by</span><b>${s.players[s.payer]?.handle} ${s.lastCallOk ? "(named everyone ✓)" : "(missed a few)"}</b></div>
          <div class="rc-row total"><span>top of the table</span><b>${ranked[0]?.handle} · ${ranked[0]?.score} pts</b></div>
          ${pairs.length ? `<div class="rc-row"><span>one more coffee</span><b>${pairs.join(" · ")}</b></div>` : `<div class="rc-row"><span>one more coffee</span><b>no mutual picks — next time</b></div>`}
          ${myPair ? `<div class="rc-note">you and ${s.players[myPair.find(x => x !== ctx.me.id)]?.handle} picked each other. go say so.</div>` : ""}
        </div><button class="share" id="share-btn">share the receipt</button>`, "Ikovox");
        $("share-btn")?.addEventListener("click", () => shareText(`Ikovox receipt — ${s.results.filter(r => r.synced).length}/${s.results.length} telepathy syncs, ${s.players[s.payer]?.handle} picked up the tab, ${pairs.length} mutual coffee(s).`));
      }
    }
    const origEnd = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); $("game-layer").style.backgroundImage = ""; origEnd(); };
  },
};

export const QUESTS = { sporty: SPORTY, chaos: CHAOS, chill: CHILL };
