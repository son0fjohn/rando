// Catalog minigames for player-hosted rooms (demo build). Six from the top of
// the simulation ranking: two arena chase games, three talk/party games, and
// the drawing game. All host-authoritative with bots filling seats.
import * as THREE from "https://esm.sh/three@0.160.0";
import { world3d } from "./world3d.js";
import { arena, m2u } from "./arena.js";
import { HostGame, makeBots, ui, shareText } from "./gamekit.js";
import { sfx, buzz, flash, shake, celebrate } from "./fx.js";
import { CAPTION_POOL, IMPOSTER_WORDS, IMPOSTER_HINTS, GENERIC_HINTS, SPLITCLUE_COLORS, DRAW_WORDS } from "./bots.js";

const $ = id => document.getElementById(id);
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function seed(ctx, rng, targetN, center, extra = () => ({})) {
  const players = {};
  const around = () => center ? { x: center.x + (rng() - 0.5) * 20, z: center.z + (rng() - 0.5) * 20 } : { x: 0, z: 0 };
  for (const h of ctx.humans) players[h.id] = { id: h.id, handle: h.handle, avatar: h.avatar, isBot: false, skill: 0.5, ...around(), score: 0, ...extra() };
  for (const b of makeBots(Math.max(0, targetN - ctx.humans.length), rng, new Set(Object.keys(players)))) players[b.id] = { ...b, ...around(), score: 0, brain: { wp: null }, ...extra() };
  return players;
}
function syncHumans(s, ctx) {
  for (const p of Object.values(s.players)) {
    if (p.isBot) continue;
    if (p.id === ctx.me.id) { const q = arena.myPos(); p.x = q.x; p.z = q.z; }
    else { const e = arena.entities.get(p.id); if (e) { p.x = e.x; p.z = e.z; } }
  }
}
function moveTo(p, t, sp, dt, center, radius) {
  const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz); if (d < 0.4) return true;
  const k = Math.min(1, sp * dt / d); p.x += dx * k; p.z += dz * k;
  const cx = p.x - center.x, cz = p.z - center.z, cd = Math.hypot(cx, cz);
  if (cd > radius - 1) { p.x = center.x + cx / cd * (radius - 1); p.z = center.z + cz / cd * (radius - 1); }
  return d < 1.2;
}
function flee(p, from, sp, dt, center, radius, rng) {
  const ang = Math.atan2(p.z - from.z, p.x - from.x) + (rng() - 0.5) * 0.8;
  return moveTo(p, { x: p.x + Math.cos(ang) * 6, z: p.z + Math.sin(ang) * 6 }, sp, dt, center, radius);
}
const ents = s => Object.values(s.players).map(p => ({ id: p.id, handle: p.handle, avatar: p.avatar, isBot: p.isBot, x: p.x, z: p.z, alive: p.alive !== false, role: p.role }));
function finishBoard(title, players, sub, scoreKey = "score", unit = "pts") {
  const ranked = Object.values(players).sort((a, b) => (b[scoreKey] ?? 0) - (a[scoreKey] ?? 0));
  ui.stage(title, `<ol class="podium">${ranked.map(p => `<li><b>${p.handle}</b><span>${p[scoreKey] ?? 0} ${unit}</span></li>`).join("")}</ol><p class="ab-sub">back to the room in a moment</p>`, sub);
}
function wrapEnd(ctx, game, extra) { const o = ctx.onEnd; ctx.onEnd = () => { game.stop(); extra?.(); ui.hide(); o(); }; }
function myCenter() { return world3d.player?.api.group.position.clone() ?? new THREE.Vector3(0, 0, 0); }

// ====================================================================
// TIMEBOMB / HOT POTATO — arena
// ====================================================================
const TIMEBOMB = {
  id: "timebomb", title: "Timebomb", blurb: "hold it when it blows and you lose. get close to toss.", minPlayers: 2, maxPlayers: 12, length: "3 × 45 s",
  RADIUS: 55, TOSS: m2u(7), ROUND: 45000,
  start(ctx) {
    const center = myCenter(); center.y = 0;
    arena.enter({ room: ctx.room, me: ctx.me, center, radius: this.RADIUS, visRange: m2u(60) });
    arena.fullRadar = true;   // a party game: everyone sees everyone
    ui.show(); ui.theme("chaos");
    const G = this;
    let lastHud = 0;
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, 6, center, () => ({ strikes: 0 }));
        s.holder = pick(game.rng, Object.keys(s.players)); s.round = 1; s.left = G.ROUND; s.phase = "play"; s.cool = 0; s.log = [];
        game.emit("holder", { id: s.holder, round: s.round });
      },
      hostTick(s, dt) {
        if (s.phase === "end") { s.left -= dt * 1000; if (s.left <= 0) { game.finish(); } return; }
        s.left -= dt * 1000; s.cool = Math.max(0, s.cool - dt * 1000);
        syncHumans(s, ctx);
        const P = Object.values(s.players);
        for (const p of P) {
          if (!p.isBot) continue;
          const sp = 13 + p.skill * 6;
          if (p.id === s.holder) {
            const t = P.filter(o => o.id !== p.id).sort((a, b) => dist2(a, p) - dist2(b, p))[0];
            if (t) { moveTo(p, t, sp * 1.05, dt, center, s.radius); if (s.cool <= 0 && dist2(p, t) < G.TOSS) toss(s, p.id, t.id); }
          } else {
            const h = s.players[s.holder];
            if (h && dist2(h, p) < m2u(14)) flee(p, h, sp, dt, center, s.radius, game.rng);
            else if (!p.brain.wp || dist2(p, p.brain.wp) < 2) p.brain.wp = { x: center.x + (game.rng() - 0.5) * s.radius * 1.6, z: center.z + (game.rng() - 0.5) * s.radius * 1.6 };
            else moveTo(p, p.brain.wp, sp * 0.7, dt, center, s.radius);
          }
        }
        if (s.left <= 0) {
          const l = s.players[s.holder]; l.strikes++; s.log.push(`round ${s.round}: ${l.handle} blew up`);
          game.emit("boom", { id: s.holder, round: s.round });
          if (s.round >= 3) { s.phase = "end"; s.left = 12000; game.emit("finish", {}); return; }
          s.round++; s.left = G.ROUND; s.holder = pick(game.rng, Object.keys(s.players)); s.cool = 2000;
          game.emit("holder", { id: s.holder, round: s.round });
        }
      },
      hostInput(s, m) { if (m.in === "toss" && m.from === s.holder && s.cool <= 0) { const a = s.players[m.from], b = s.players[m.target]; if (a && b && dist2(a, b) < G.TOSS * 1.3) toss(s, a.id, b.id); } },
      render(s) { renderTB(s); },
      onEvent(m) {
        const s = game.s; if (!s) return;
        if (m.ev === "toss") { sfx.whoosh(); if (m.to === ctx.me.id) { buzz(80); flash("#ff2a4a", 120); ui.toast("YOU'VE GOT IT — run!", "rip"); } }
        if (m.ev === "boom") { sfx.boom(); shake(600, 3); flash("#ff2a4a", 400); ui.toast(`💥 ${s.players[m.id]?.handle} blew up`, "rip"); }
        if (m.ev === "holder") { ui.toast(`round ${m.round} — ${s.players[m.id]?.handle ?? "?"} holds the bomb`, "phase"); sfx.tick(); }
        if (m.ev === "finish") celebrate(center.clone().add(new THREE.Vector3(0, 12, 0)));
      },
    }, { hz: 6 });
    function toss(s, from, to) { s.holder = to; s.cool = 2500; s.log.push(`${s.players[from].handle} → ${s.players[to].handle}`); game.emit("toss", { from, to }); }
    game.start({ phase: "play", left: this.ROUND, radius: this.RADIUS, players: {}, holder: null, round: 1, cool: 0, log: [] });
    function renderTB(s) {
      arena.setEntities(ents(s));
      // holder glows: reuse role field for radar class
      for (const e of arena.entities.values()) e.role = e.id === s.holder ? "hunter" : undefined;
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const me = s.players[ctx.me.id];
      const holder = s.players[s.holder];
      ui.hud(`<div class="hq"><b>TIMEBOMB r${s.round}/3</b><span class="clk ${s.left < 10000 ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${s.holder === ctx.me.id ? "🧨 YOU HOLD IT" : `🧨 ${holder?.handle ?? "?"}`}</span><span>${me?.strikes ?? 0} strikes</span></div>`);
      if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("fewest strikes wins", s.players, "Timebomb", "strikes", "strikes"); return; }
      if (s.holder === ctx.me.id) {
        const t = arena.near(G.TOSS)[0];
        const can = t && s.cool <= 0;
        if (!ui.once(`h:${can ? 1 : 0}:${t?.id ?? ""}`, () => {})) return;
        ui.panel(`<div class="actionbar"><button id="toss-btn" class="big ${can ? "hot" : ""}" ${can ? "" : "disabled"}>${t ? `TOSS to ${t.handle}` : "chase someone down"}</button></div>`, "bottom");
        $("toss-btn").onclick = () => { if (can) game.input("toss", { target: t.id }); };
      } else ui.once(`r:${s.round}`, () => ui.panel(`<div class="ab-sub">stay away from ${holder?.handle ?? "the holder"}</div>`, "bottom"));
    }
    wrapEnd(ctx, game, () => arena.leave());
  },
};

// ====================================================================
// DEATH TAG — arena, snowball
// ====================================================================
const DEATHTAG = {
  id: "deathtag", title: "Death Tag", blurb: "one tagger. tagged players join the chase. last runner wins.", minPlayers: 3, maxPlayers: 16, length: "~3 min",
  RADIUS: 70, TAG: m2u(4.5), T: 180000,
  start(ctx) {
    const center = myCenter(); center.y = 0;
    arena.enter({ room: ctx.room, me: ctx.me, center, radius: this.RADIUS, visRange: m2u(45) });
    arena.fullRadar = true;
    ui.show(); ui.theme("sporty");
    const G = this; let lastHud = 0;
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, 7, center, () => ({ role: "runner", tagged: 0 }));
        const it = pick(game.rng, Object.keys(s.players)); s.players[it].role = "tagger"; s.left = G.T; s.phase = "play"; s.log = [];
        game.emit("it", { id: it });
      },
      hostTick(s, dt) {
        if (s.phase === "end") { s.left -= dt * 1000; if (s.left <= 0) { game.finish(); } return; }
        s.left -= dt * 1000; syncHumans(s, ctx);
        const P = Object.values(s.players), taggers = P.filter(p => p.role === "tagger"), runners = P.filter(p => p.role === "runner");
        for (const p of P) {
          if (!p.isBot) continue;
          const sp = 12 + p.skill * 7;
          if (p.role === "tagger") { const t = runners.sort((a, b) => dist2(a, p) - dist2(b, p))[0]; if (t) moveTo(p, t, sp * 1.03, dt, center, s.radius); }
          else { const t = taggers.sort((a, b) => dist2(a, p) - dist2(b, p))[0]; if (t && dist2(t, p) < m2u(18)) flee(p, t, sp, dt, center, s.radius, game.rng); else if (!p.brain.wp || dist2(p, p.brain.wp) < 2) p.brain.wp = { x: center.x + (game.rng() - 0.5) * s.radius * 1.6, z: center.z + (game.rng() - 0.5) * s.radius * 1.6 }; else moveTo(p, p.brain.wp, sp * 0.6, dt, center, s.radius); }
        }
        for (const t of taggers) for (const r of runners) if (r.role === "runner" && dist2(t, r) < G.TAG) { r.role = "tagger"; r.tagged = Date.now(); r.by = t.id; s.log.push(`${t.handle} tagged ${r.handle}`); game.emit("tag", { by: t.id, who: r.id }); }
        const left = P.filter(p => p.role === "runner");
        if (left.length <= 1 || s.left <= 0) { s.phase = "end"; s.winner = left[0]?.id ?? null; s.left = 12000; for (const p of P) p.score = p.role === "runner" ? 3 : Math.max(0, 2 - Math.floor((Date.now() - (p.tagged || Date.now())) / 60000)); game.emit("finish", { winner: s.winner }); }
      },
      render(s) {
        arena.setEntities(ents(s));
        const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
        const me = s.players[ctx.me.id]; const runners = Object.values(s.players).filter(p => p.role === "runner").length;
        ui.hud(`<div class="hq"><b>DEATH TAG</b><span class="clk">${ui.clock(s.left)}</span><span>${runners} running</span><span>${me?.role === "tagger" ? "🔴 you're IT" : "🟢 run"}</span></div>`);
        if (s.phase === "end") { if (ui.once("end", () => {})) ui.stage(s.winner ? `${s.players[s.winner]?.handle} outran everyone` : "everyone got tagged", `<ul class="story">${s.log.map(l => `<li>${l}</li>`).join("")}</ul>`, "Death Tag"); return; }
        ui.once(`p:${me?.role}`, () => ui.panel(`<div class="ab-sub">${me?.role === "tagger" ? "touch a runner to tag (get within ~4 m)" : "red blips are taggers — tagged players join them"}</div>`, "bottom"));
      },
      onEvent(m) { const s = game.s; if (!s) return; if (m.ev === "tag") { sfx.rip(); if (m.who === ctx.me.id) { flash("#ff2a4a", 200); buzz(80); ui.toast("TAGGED — you're a tagger now", "rip"); } else ui.toast(`${s.players[m.by]?.handle} tagged ${s.players[m.who]?.handle}`, "rip"); } if (m.ev === "it") ui.toast(`${s.players[m.id]?.handle} is IT`, "phase"); if (m.ev === "finish") celebrate(center.clone().add(new THREE.Vector3(0, 12, 0))); },
    }, { hz: 6 });
    game.start({ phase: "play", left: this.T, radius: this.RADIUS, players: {}, log: [] });
    wrapEnd(ctx, game, () => arena.leave());
  },
};

// ====================================================================
// CAPTION THIS — photo, write, vote
// ====================================================================
const CAPTION = {
  id: "caption", title: "Caption This", blurb: "a random photo. everyone writes a caption. funniest wins the vote.", minPlayers: 3, maxPlayers: 12, length: "3 rounds · ~5 min",
  start(ctx) {
    ui.show(); ui.theme("chill");
    let lastHud = 0, myPicked = null;
    const game = new HostGame(ctx, {
      hostInit(s) { s.players = seed(ctx, game.rng, 5, null, () => ({ cap: null, vote: null })); s.photos = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => game.rng() - 0.5).slice(0, 3); s.round = 0; s.phase = "write"; s.left = 40000; s.results = []; },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        if (s.phase === "write") { for (const b of P) if (b.isBot && !b.cap && game.rng() < dt * 0.2) { const used = new Set(P.map(p => p.cap)); b.cap = pick(game.rng, CAPTION_POOL.filter(c => !used.has(c))) ?? pick(game.rng, CAPTION_POOL); } if (P.every(p => p.cap)) s.left = Math.min(s.left, 1500); }
        if (s.phase === "vote") { for (const b of P) if (b.isBot && !b.vote && game.rng() < dt * 0.5) { const o = P.filter(p => p.id !== b.id && p.cap); if (o.length) b.vote = pick(game.rng, o).id; } if (P.every(p => p.vote)) s.left = Math.min(s.left, 1000); }
        if (s.left > 0) return;
        if (s.phase === "write") { s.phase = "vote"; s.left = 25000; s.order = P.filter(p => p.cap).map(p => p.id).sort(() => game.rng() - 0.5); game.emit("phase", { phase: "vote" }); }
        else if (s.phase === "vote") {
          const counts = {}; for (const p of P) if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
          for (const p of P) p.score += (counts[p.id] || 0) * 100;
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          s.results.push({ photo: s.photos[s.round], winner: top?.[0] ?? null, counts });
          s.phase = "reveal"; s.left = 9000; game.emit("phase", { phase: "reveal", winner: top?.[0] ?? null });
        }
        else if (s.phase === "reveal") {
          if (s.round + 1 < s.photos.length) { s.round++; for (const p of P) { p.cap = null; p.vote = null; } s.phase = "write"; s.left = 40000; game.emit("phase", { phase: "write" }); }
          else { s.phase = "end"; s.left = 14000; game.emit("finish", {}); }
        }
        else if (s.phase === "end") { game.finish(); }
      },
      hostInput(s, m) { const p = s.players[m.from]; if (!p) return; if (m.in === "cap" && s.phase === "write") p.cap = String(m.text).slice(0, 90); if (m.in === "vote" && s.phase === "vote" && m.who !== m.from) p.vote = m.who; },
      render(s) {
        const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
        const P = Object.values(s.players); const me = s.players[ctx.me.id];
        ui.hud(`<div class="hq"><b>CAPTION THIS ${s.round + 1}/${s.photos.length}</b><span class="clk">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
        const img = `<img class="photo" src="games/captions/c${s.photos[s.round]}.jpg" alt="">`;
        if (s.phase === "write") {
          if (!ui.once(`w:${s.round}:${me?.cap ? 1 : 0}:${P.filter(p => p.cap).length}`, () => {})) return;
          if (me && !me.cap) ui.stage("caption this", img + ui.prompt("your caption…", text => game.input("cap", { text }), { maxlength: 90, submitLabel: "lock it" }), `write · ${ui.clock(s.left)}`);
          else ui.stage("caption locked", img + `<p class="ab-sub">${P.filter(p => p.cap).length}/${P.length} in</p>`, "write");
        } else if (s.phase === "vote") {
          if (!ui.once(`v:${s.round}:${me?.vote ?? myPicked ?? ""}`, () => {})) return;
          const items = (s.order || []).filter(id => id !== ctx.me.id).map(id => ({ value: id, label: `“${s.players[id]?.cap}”` }));
          ui.stage("vote for the best", img + ui.choices(items, null, { picked: me?.vote ?? myPicked }), `vote · ${ui.clock(s.left)}`);
          ui.bindChoices(v => { myPicked = v; game.input("vote", { who: v }); sfx.pop(); });
        } else if (s.phase === "reveal") {
          if (!ui.once(`r:${s.round}`, () => {})) return;
          const r = s.results[s.results.length - 1];
          const list = (s.order || []).map(id => `<div class="rev-row"><span>${s.players[id]?.handle}: “${s.players[id]?.cap}”</span><b>${r.counts[id] || 0}</b></div>`).join("");
          ui.stage(r.winner ? `${s.players[r.winner]?.handle} takes it` : "no votes?!", img + list, "reveal");
        } else if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("final scores", s.players, "Caption This"); }
      },
      onEvent(m) { myPicked = null; if (m.ev === "phase") { if (m.phase === "vote") { sfx.ping(); } if (m.phase === "reveal") { sfx.chime(); } if (m.phase === "write") sfx.pop(); } if (m.ev === "finish") sfx.win(); },
    }, { hz: 4 });
    game.start({ phase: "write", left: 40000, players: {}, photos: [], round: 0, results: [] });
    wrapEnd(ctx, game);
  },
};

// ====================================================================
// CATCH THE IMPOSTER — hints, talk, vote
// ====================================================================
const IMPOSTER = {
  id: "imposter", title: "Catch the Imposter", blurb: "everyone gets the word except one. one hint each, talk, vote.", minPlayers: 4, maxPlayers: 12, length: "3 rounds · ~6 min",
  start(ctx) {
    ui.show(); ui.theme("chaos");
    let lastHud = 0, myPicked = null;
    const game = new HostGame(ctx, {
      hostInit(s) { s.players = seed(ctx, game.rng, 6, null, () => ({ hint: null, vote: null })); s.round = 0; s.rounds = IMPOSTER_WORDS.slice().sort(() => game.rng() - 0.5).slice(0, 3); s.talk = []; newRound(s); },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        if (s.phase === "hint") { for (const b of P) if (b.isBot && !b.hint && game.rng() < dt * 0.3) b.hint = b.id === s.imposter ? pick(game.rng, GENERIC_HINTS) : pick(game.rng, IMPOSTER_HINTS[s.word] || GENERIC_HINTS); if (P.every(p => p.hint)) s.left = Math.min(s.left, 1000); }
        if (s.phase === "talk") { for (const b of P) if (b.isBot && game.rng() < dt * 0.08) { const lines = b.id === s.imposter ? ["yeah same", "that's what I was thinking", "hmm who's being vague", "mine's obvious tbh"] : [`${pick(game.rng, P.filter(p => p.id !== b.id)).handle}'s hint is… a choice`, "pretty clear to me", "sus", "ok I have a guess", "who said that one?"]; s.talk.push({ who: b.handle, text: pick(game.rng, lines) }); s.talk = s.talk.slice(-10); } }
        if (s.phase === "vote") { for (const b of P) if (b.isBot && !b.vote && game.rng() < dt * 0.5) { const others = P.filter(p => p.id !== b.id); b.vote = (b.id !== s.imposter && game.rng() < 0.45 ? s.players[s.imposter] : pick(game.rng, others)).id; } if (P.every(p => p.vote)) s.left = Math.min(s.left, 1000); }
        if (s.left > 0) return;
        if (s.phase === "hint") { s.phase = "talk"; s.left = 35000; game.emit("phase", { phase: "talk" }); }
        else if (s.phase === "talk") { s.phase = "vote"; s.left = 20000; game.emit("phase", { phase: "vote" }); }
        else if (s.phase === "vote") {
          const counts = {}; for (const p of P) if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1]); const caught = top.length && top[0][0] === s.imposter && (top.length === 1 || top[0][1] > top[1][1]);
          if (caught) { for (const p of P) if (p.id !== s.imposter) p.score += 100; } else s.players[s.imposter].score += 300;
          s.results.push({ word: s.word, imposter: s.imposter, caught, counts });
          s.phase = "reveal"; s.left = 9000; game.emit("phase", { phase: "reveal", caught });
        }
        else if (s.phase === "reveal") { if (s.round + 1 < s.rounds.length) { s.round++; newRound(s); game.emit("phase", { phase: "hint" }); } else { s.phase = "end"; s.left = 14000; game.emit("finish", {}); } }
        else if (s.phase === "end") { game.finish(); }
      },
      hostInput(s, m) { const p = s.players[m.from]; if (!p) return; if (m.in === "hint" && s.phase === "hint") p.hint = String(m.text).slice(0, 24); if (m.in === "say" && s.phase === "talk") { s.talk.push({ who: p.handle, text: String(m.text).slice(0, 120) }); s.talk = s.talk.slice(-10); } if (m.in === "vote" && s.phase === "vote" && m.who !== m.from) p.vote = m.who; },
      render(s) {
        const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
        const P = Object.values(s.players); const me = s.players[ctx.me.id]; const imp = ctx.me.id === s.imposter;
        ui.hud(`<div class="hq"><b>IMPOSTER ${s.round + 1}/${s.rounds.length}</b><span class="clk">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
        const card = imp ? `<p class="role hunter">you are the IMPOSTER — category: <b>${s.cat}</b>. blend in.</p>` : `<p class="role runner">the word is <b>${s.word}</b> (${s.cat}). one of you doesn't know it.</p>`;
        const hints = P.filter(p => p.hint).map(p => `<div class="rev-row"><span>${p.handle}</span><b>${s.phase === "hint" && !ui._revealHints ? "…" : p.hint}</b></div>`).join("");
        if (s.phase === "hint") {
          if (!ui.once(`h:${s.round}:${me?.hint ? 1 : 0}:${P.filter(p => p.hint).length}`, () => {})) return;
          ui.stage("one-word hint", card + (me && !me.hint ? ui.prompt("one word…", text => game.input("hint", { text }), { maxlength: 24, submitLabel: "drop it" }) : `<p class="ab-sub">${P.filter(p => p.hint).length}/${P.length} hints in</p>`), `hint · ${ui.clock(s.left)}`);
        } else if (s.phase === "talk") {
          if (ui.once(`t:${s.round}`, () => {})) { ui.stage("talk it out", card + `<div class="hints">${P.map(p => `<div class="rev-row"><span>${p.handle}</span><b>${p.hint ?? "—"}</b></div>`).join("")}</div>` + ui.chatHtml(s.talk, "accuse, defend, bluff…"), `talk · ${ui.clock(s.left)}`); ui.bindChat(t => game.input("say", { text: t })); }
          else ui.updateChat(s.talk);
        } else if (s.phase === "vote") {
          if (!ui.once(`v:${s.round}:${me?.vote ?? myPicked ?? ""}`, () => {})) return;
          ui.stage("who's faking?", `<div class="hints">${P.map(p => `<div class="rev-row"><span>${p.handle}</span><b>${p.hint ?? "—"}</b></div>`).join("")}</div>` + ui.choices(P.filter(p => p.id !== ctx.me.id).map(p => ({ value: p.id, label: p.handle })), null, { picked: me?.vote ?? myPicked }), `vote · ${ui.clock(s.left)}`);
          ui.bindChoices(v => { myPicked = v; game.input("vote", { who: v }); sfx.pop(); });
        } else if (s.phase === "reveal") {
          if (!ui.once(`r:${s.round}`, () => {})) return;
          const r = s.results[s.results.length - 1];
          ui.stage(r.caught ? `caught — it was ${s.players[r.imposter]?.handle}` : `${s.players[r.imposter]?.handle} got away with it`, `<p>the word was <b>${r.word}</b></p>` + Object.entries(r.counts).map(([id, n]) => `<div class="rev-row"><span>${s.players[id]?.handle}</span><b>${n} vote${n === 1 ? "" : "s"}</b></div>`).join(""), "reveal");
        } else if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("final scores", s.players, "Catch the Imposter"); }
      },
      onEvent(m) { myPicked = null; if (m.ev === "phase") { if (m.phase === "talk") sfx.ping(); if (m.phase === "vote") sfx.klaxon(); if (m.phase === "reveal") { if (m.caught) sfx.win(); else sfx.lose(); } } if (m.ev === "finish") sfx.win(); },
    }, { hz: 4 });
    function newRound(s) { const [w, c] = s.rounds[s.round]; s.word = w; s.cat = c; s.imposter = pick(game.rng, Object.keys(s.players)); for (const p of Object.values(s.players)) { p.hint = null; p.vote = null; } s.talk = []; s.phase = "hint"; s.left = 20000; }
    game.start({ phase: "hint", left: 20000, players: {}, round: 0, rounds: [], results: [], talk: [] });
    wrapEnd(ctx, game);
  },
};

// ====================================================================
// SPLIT CLUE — pairs, each sees half a colour grid, talk to fill it
// ====================================================================
const SPLITCLUE = {
  id: "splitclue", title: "Split Clue", blurb: "you and a partner each see half of a 3×3 colour code. talk to fill it.", minPlayers: 2, maxPlayers: 12, length: "~2 min",
  start(ctx) {
    ui.show(); ui.theme("chill");
    let lastHud = 0;
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, ctx.humans.length % 2 === 0 ? ctx.humans.length : ctx.humans.length + 1, null, () => ({ grid: Array(9).fill(null), known: [] }));
        const ids = Object.keys(s.players).sort(() => game.rng() - 0.5);
        s.pairs = []; for (let i = 0; i + 1 < ids.length; i += 2) s.pairs.push([ids[i], ids[i + 1]]);
        s.answer = Array.from({ length: 9 }, () => pick(game.rng, SPLITCLUE_COLORS));
        for (const [a, b] of s.pairs) { const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => game.rng() - 0.5); s.players[a].known = cells.slice(0, 5); s.players[b].known = cells.slice(5); for (const id of [a, b]) for (const c of s.players[id].known) s.players[id].grid[c] = s.answer[c]; }
        s.phase = "play"; s.left = 150000; s.talk = []; s.solved = null;
      },
      hostTick(s, dt) {
        if (s.phase === "end") { s.left -= dt * 1000; if (s.left <= 0) { game.finish(); } return; }
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        // bots: say their known cells one by one, and fill unknown cells from their partner's grid (they "listen")
        for (const b of P) {
          if (!b.isBot) continue;
          b.sayAt ??= 4000 + game.rng() * 3000; b.sayAt -= dt * 1000;
          if (b.sayAt <= 0) {
            b.sayAt = 6000 + game.rng() * 4000;
            const pair = s.pairs.find(pr => pr.includes(b.id)); const partner = s.players[pair.find(x => x !== b.id)];
            const unsaid = b.known.filter(c => !(b.said ||= []).includes(c));
            if (unsaid.length) { const c = unsaid[0]; b.said.push(c); s.talk.push({ who: b.handle, text: `${["top-left", "top", "top-right", "left", "middle", "right", "bottom-left", "bottom", "bottom-right"][c]} is ${s.answer[c]}` }); s.talk = s.talk.slice(-12); }
            // listen: copy partner's filled cells slowly (a real partner would say them)
            for (const c of partner.known) if (b.grid[c] === null && game.rng() < 0.5 + b.skill * 0.4) b.grid[c] = partner.grid[c];
          }
        }
        for (const [a, b] of s.pairs) { if (!s.solved && (s.players[a].grid.every((v, i) => v === s.answer[i]) || s.players[b].grid.every((v, i) => v === s.answer[i]))) { s.solved = [a, b]; s.players[a].score += 100; s.players[b].score += 100; } }
        if (s.solved || s.left <= 0) { s.phase = "end"; s.left = 14000; game.emit("finish", { solved: s.solved }); }
      },
      hostInput(s, m) { const p = s.players[m.from]; if (!p) return; if (m.in === "cell" && s.phase === "play" && !p.known.includes(m.i)) p.grid[m.i] = m.c; if (m.in === "say") { s.talk.push({ who: p.handle, text: String(m.text).slice(0, 120) }); s.talk = s.talk.slice(-12); } },
      render(s) {
        const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
        const me = s.players[ctx.me.id]; const pair = s.pairs.find(pr => pr.includes(ctx.me.id)); const partner = pair && s.players[pair.find(x => x !== ctx.me.id)];
        ui.hud(`<div class="hq"><b>SPLIT CLUE</b><span class="clk">${ui.clock(s.left)}</span><span>partner: ${partner?.handle ?? "—"}</span><span>${s.pairs.length} pairs racing</span></div>`);
        if (s.phase === "end") { if (ui.once("end", () => {})) { const w = s.solved ? `${s.players[s.solved[0]]?.handle} + ${s.players[s.solved[1]]?.handle} cracked it` : "nobody cracked it"; ui.stage(w, `<div class="grid3 big">${s.answer.map(c => `<i style="background:${c}"></i>`).join("")}</div><p class="ab-sub">the code</p>`, "Split Clue"); } return; }
        if (!me) { ui.once("spec", () => ui.stage("watching", `<p class="ab-sub">pairs are talking</p>`)); return; }
        if (ui.once(`play:${JSON.stringify(me.grid)}`, () => {})) {
          const cells = me.grid.map((c, i) => `<button class="cell ${me.known.includes(i) ? "known" : "unk"}" data-i="${i}" style="background:${c || "transparent"}">${me.known.includes(i) ? "" : (c ? "" : "?")}</button>`).join("");
          const palette = SPLITCLUE_COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}"></button>`).join("");
          ui.stage("fill the 3×3 code", `<p class="ab-sub">you see ${me.known.length} cells, ${partner?.handle ?? "your partner"} sees the rest. talk — out loud or here.</p><div class="grid3">${cells}</div><div class="palette">${palette}</div>` + ui.chatHtml(s.talk, "top-left is red…"), `${ui.clock(s.left)}`);
          let selColor = null;
          $("game-panel").querySelectorAll(".sw").forEach(b => b.onclick = () => { selColor = b.dataset.c; $("game-panel").querySelectorAll(".sw").forEach(x => x.classList.toggle("on", x === b)); });
          $("game-panel").querySelectorAll(".cell.unk").forEach(b => b.onclick = () => { if (selColor) { game.input("cell", { i: +b.dataset.i, c: selColor }); sfx.pop(); } });
          ui.bindChat(t => game.input("say", { text: t }));
        } else ui.updateChat(s.talk);
      },
      onEvent(m) { if (m.ev === "finish") { if (m.solved) sfx.win(); else sfx.lose(); } },
    }, { hz: 4 });
    game.start({ phase: "play", left: 150000, players: {}, pairs: [], answer: [], talk: [], solved: null });
    wrapEnd(ctx, game);
  },
};

// ====================================================================
// DRAW MY THING — synced strokes, guesses
// ====================================================================
const DRAW = {
  id: "draw", title: "Draw My Thing", blurb: "one draws, everyone guesses against the clock.", minPlayers: 3, maxPlayers: 10, length: "~4 min",
  start(ctx) {
    ui.show(); ui.theme("chill");
    let lastHud = 0, strokes = [], drawing = false, cur = null, canvasBound = false;
    const game = new HostGame(ctx, {
      hostInit(s) { s.players = seed(ctx, game.rng, 4, null, () => ({ guessed: false })); s.order = Object.keys(s.players).sort(() => game.rng() - 0.5).slice(0, 4); s.turn = 0; s.talk = []; newTurn(s); },
      hostTick(s, dt) {
        if (s.phase === "end") { s.left -= dt * 1000; if (s.left <= 0) { game.finish(); } return; }
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        const drawer = s.players[s.drawer];
        // bot drawer: reveal letters over time (stand-in for a doodle) ; bot guessers: guess with rising probability
        if (drawer?.isBot) { s.revealed = Math.min(s.word.length, Math.floor((60000 - s.left) / 12000)); }
        for (const b of P) if (b.isBot && b.id !== s.drawer && !b.guessed && game.rng() < dt * (0.02 + (60000 - s.left) / 60000 * 0.08 * b.skill)) { const right = game.rng() < 0.5; const g = right ? s.word : pick(game.rng, DRAW_WORDS); guess(s, b, g); }
        if (s.left <= 0 || P.filter(p => p.id !== s.drawer).every(p => p.guessed)) { s.turn++; if (s.turn < s.order.length) { newTurn(s); game.emit("turn", { drawer: s.drawer }); } else { s.phase = "end"; s.left = 14000; game.emit("finish", {}); } }
      },
      hostInput(s, m) {
        const p = s.players[m.from]; if (!p) return;
        if (m.in === "guess" && m.from !== s.drawer && !p.guessed) guess(s, p, String(m.text).slice(0, 30));
        if (m.in === "clear" && m.from === s.drawer) game.emit("clear", {});
      },
      render(s) {
        const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
        const me = s.players[ctx.me.id]; const isDrawer = s.drawer === ctx.me.id;
        ui.hud(`<div class="hq"><b>DRAW ${s.turn + 1}/${s.order.length}</b><span class="clk">${ui.clock(s.left)}</span><span>${isDrawer ? "you draw: " + s.word : s.players[s.drawer]?.handle + " draws"}</span><span>${me?.score ?? 0} pts</span></div>`);
        if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("final scores", s.players, "Draw My Thing"); return; }
        const hint = isDrawer ? s.word : s.word.split("").map((ch, i) => (s.players[s.drawer]?.isBot && i < (s.revealed || 0)) || me?.guessed ? ch : (ch === " " ? " " : "_")).join(" ");
        if (ui.once(`t:${s.turn}:${isDrawer ? 1 : 0}:${me?.guessed ? 1 : 0}`, () => {})) {
          strokes = [];
          ui.stage(isDrawer ? `draw: <b>${s.word}</b>` : `guess: <b class="mono">${hint}</b>`, `<canvas id="draw-cv" width="600" height="420"></canvas>${isDrawer ? `<div class="palette"><button id="draw-clear" class="ch small">clear</button></div>` : (me?.guessed ? `<p class="ab-sub">you got it — watch the others sweat</p>` : ui.prompt("your guess…", text => game.input("guess", { text }), { maxlength: 30, submitLabel: "guess" }))}` + ui.chatHtml(s.talk, ""), `${ui.clock(s.left)}`);
          $("game-panel").querySelector(".gchat-form")?.remove();
          bindCanvas(isDrawer);
          redraw();
        } else { ui.updateChat(s.talk); if (!isDrawer) { const h = $("game-panel").querySelector("h2 b"); if (h) h.textContent = hint; } }
        if (s.players[s.drawer]?.isBot && ui.once2 !== s.turn) { ui.once2 = s.turn; }
      },
      onEvent(m) {
        const s = game.s; if (!s) return;
        if (m.ev === "stroke" && m.from !== ctx.me.id) { strokes.push(m.pts); drawStroke(m.pts); }
        if (m.ev === "clear") { strokes = []; redraw(); }
        if (m.ev === "right") { sfx.win(); if (m.who === ctx.me.id) { flash("#7dd3a0", 160); buzz(50); } ui.toast(`${s.players[m.who]?.handle} got it!`, "dodge"); }
        if (m.ev === "turn") { sfx.ping(); strokes = []; }
        if (m.ev === "finish") sfx.win();
      },
    }, { hz: 4 });
    function guess(s, p, text) { if (text.trim().toLowerCase() === s.word.toLowerCase()) { p.guessed = true; p.score += 100 + Math.round(s.left / 1000); s.players[s.drawer].score += 30; game.emit("right", { who: p.id }); } else { s.talk.push({ who: p.handle, text }); s.talk = s.talk.slice(-8); } }
    function newTurn(s) { s.drawer = s.order[s.turn]; s.word = pick(game.rng, DRAW_WORDS); s.left = 60000; s.revealed = 0; s.talk = []; for (const p of Object.values(s.players)) p.guessed = false; s.phase = "play"; }
    // ---- canvas (drawer sends strokes; everyone replays)
    function cvCtx() { const cv = $("draw-cv"); if (!cv) return null; const c = cv.getContext("2d"); c.lineWidth = 5; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#1b1d20"; return c; }
    function drawStroke(pts) { const c = cvCtx(); if (!c || pts.length < 2) return; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) c.lineTo(x, y); c.stroke(); }
    function redraw() { const cv = $("draw-cv"); if (!cv) return; cvCtx().clearRect(0, 0, cv.width, cv.height); for (const st of strokes) drawStroke(st); }
    function bindCanvas(isDrawer) {
      const cv = $("draw-cv"); if (!cv) return;
      const pt = e => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * cv.width), Math.round((e.clientY - r.top) / r.height * cv.height)]; };
      if (!isDrawer) return;
      let flushT = 0;
      cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); drawing = true; cur = [pt(e)]; };
      cv.onpointermove = e => { if (!drawing) return; cur.push(pt(e)); drawStroke(cur.slice(-2)); if (performance.now() - flushT > 120) { flushT = performance.now(); if (cur.length > 1) { ctx.room.send("ev", { ev: "stroke", pts: cur }); strokes.push(cur); cur = [cur[cur.length - 1]]; } } };
      const up = () => { if (drawing && cur && cur.length > 1) { ctx.room.send("ev", { ev: "stroke", pts: cur }); strokes.push(cur); } drawing = false; cur = null; };
      cv.onpointerup = up; cv.onpointercancel = up;
      $("draw-clear").onclick = () => { game.input("clear", {}); };
    }
    game.start({ phase: "play", left: 60000, players: {}, order: [], turn: 0, talk: [] });
    wrapEnd(ctx, game);
  },
};

export const CATALOG = [TIMEBOMB, CAPTION, IMPOSTER, SPLITCLUE, DEATHTAG, DRAW];
