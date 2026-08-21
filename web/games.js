// Catalog minigames for player-hosted rooms, organized by archetype lane
// (sporty = bodies in space, chaos = nerve & bluff, chill = talk & reveal).
// Final lineup = simulation ranking x design review x the user's picks.
// All host-authoritative with bots filling seats; nothing ever requires
// touching another person - proximity, taps and votes only.
import * as THREE from "https://esm.sh/three@0.160.0";
import { world3d } from "./world3d.js";
import { arena, m2u } from "./arena.js";
import { HostGame, makeBots, gauss, ui, shareText } from "./gamekit.js";
import { sfx, buzz, flash, shake, celebrate } from "./fx.js";
import { CAPTION_POOL, IMPOSTER_WORDS, IMPOSTER_HINTS, GENERIC_HINTS, SPLITCLUE_COLORS, DRAW_WORDS, RECEIPT_POOL, MAJORITY_PROMPTS } from "./bots.js";

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
  id: "timebomb", title: "Timebomb", arch: "chaos", blurb: "hold it when it blows and you lose. get close to toss.", minPlayers: 2, maxPlayers: 12, length: "3 × 45 s",
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
  id: "deathtag", title: "Death Tag", arch: "sporty", blurb: "one tagger. tagged players join the chase. last runner wins.", minPlayers: 3, maxPlayers: 16, length: "~3 min",
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
  id: "caption", title: "Caption This", arch: "chill", blurb: "a random photo. everyone writes a caption. funniest wins the vote.", minPlayers: 3, maxPlayers: 12, length: "3 rounds · ~5 min",
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
  id: "imposter", title: "Catch the Imposter", arch: "chaos", blurb: "everyone gets the word except one. one hint each, talk, vote.", minPlayers: 4, maxPlayers: 12, length: "3 rounds · ~6 min",
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
  id: "splitclue", title: "Split Clue", arch: "chill", blurb: "you and a partner each see half of a 3×3 colour code. talk to fill it.", minPlayers: 2, maxPlayers: 12, length: "~2 min",
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
  id: "draw", title: "Draw My Thing", arch: "chill", blurb: "one draws, everyone guesses against the clock.", minPlayers: 3, maxPlayers: 10, length: "~4 min",
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


// ====================================================================
// COIN RAIN — arena · sporty. coins drop, sprint and scoop.
// ====================================================================
const COINRAIN = {
  id: "coinrain", title: "Coin Rain", blurb: "coins drop all over the ring for 90 s. scoop more than everyone else.", arch: "sporty", minPlayers: 2, maxPlayers: 16, length: "90 s",
  RADIUS: 48, GRAB: m2u(3.5), T: 90000,
  start(ctx) {
    const center = myCenter(); center.y = 0;
    arena.enter({ room: ctx.room, me: ctx.me, center, radius: this.RADIUS, visRange: m2u(70) });
    arena.fullRadar = true;
    ui.show(); ui.theme("sporty");
    const G = this;
    let lastHud = 0, seq = 0, spawnAcc = 0;
    const meshes = new Map();   // coinId -> mesh (client-side)
    const coinMat = { 1: new THREE.MeshBasicMaterial({ color: 0xffd60a }), 3: new THREE.MeshBasicMaterial({ color: 0xffb020 }), 10: new THREE.MeshBasicMaterial({ color: 0xff7a00 }) };
    const coinGeo = new THREE.CylinderGeometry(1, 1, 0.6, 14);
    const game = new HostGame(ctx, {
      hostInit(s) { s.players = seed(ctx, game.rng, 6, center); s.coins = []; s.left = G.T; s.phase = "play"; },
      hostTick(s, dt) {
        if (s.phase === "end") { s.left -= dt * 1000; if (s.left <= 0) game.finish(); return; }
        s.left -= dt * 1000; syncHumans(s, ctx);
        // spawn: ~1/s, doubled in the last 15 s ("the jackpot minute")
        spawnAcc += dt * (s.left < 15000 ? 2.2 : 1.1);
        while (spawnAcc > 1) {
          spawnAcc -= 1;
          const r = game.rng(), v = r < 0.7 ? 1 : r < 0.94 ? 3 : 10;
          const a = game.rng() * Math.PI * 2, rr = game.rng() * (s.radius - 4);
          const c = { id: "c" + (++seq), x: center.x + Math.cos(a) * rr, z: center.z + Math.sin(a) * rr, v, ttl: 12000 };
          s.coins.push(c);
          if (v === 10) game.emit("gold", { x: c.x, z: c.z });
        }
        for (const c of s.coins) c.ttl -= dt * 1000;
        s.coins = s.coins.filter(c => c.ttl > 0);
        // bots: sprint at the juiciest close coin
        for (const p of Object.values(s.players)) {
          if (!p.isBot) continue;
          const best = s.coins.map(c => ({ c, u: c.v / (8 + dist2(c, p)) })).sort((a, b) => b.u - a.u)[0];
          if (best) moveTo(p, best.c, 12 + p.skill * 8, dt, center, s.radius);
        }
        // grabs (host authoritative, first body on it takes it)
        for (const c of [...s.coins]) {
          const g = Object.values(s.players).find(p => dist2(p, c) < G.GRAB);
          if (g) { g.score += c.v; s.coins = s.coins.filter(x => x !== c); game.emit("grab", { who: g.id, v: c.v, x: c.x, z: c.z }); }
        }
        if (s.left <= 0) { s.phase = "end"; s.left = 12000; game.emit("finish", {}); }
      },
      render(s) {
        arena.setEntities(ents(s));
        // client-side coin meshes from state
        const live = new Set();
        for (const c of s.coins) {
          live.add(c.id);
          let mh = meshes.get(c.id);
          if (!mh) { mh = new THREE.Mesh(coinGeo, coinMat[c.v] ?? coinMat[1]); mh.scale.setScalar(c.v === 10 ? 2.2 : c.v === 3 ? 1.5 : 1); mh.position.set(c.x, 1.2, c.z); world3d.scene.add(mh); meshes.set(c.id, mh); }
          mh.rotation.y += 0.08; mh.position.y = 1.2 + Math.sin(performance.now() / 300 + c.x) * 0.35;
        }
        for (const [id, mh] of meshes) if (!live.has(id)) { world3d.scene.remove(mh); meshes.delete(id); }
        const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
        const me = s.players[ctx.me.id];
        const top = Object.values(s.players).sort((a, b) => b.score - a.score)[0];
        ui.hud(`<div class="hq"><b>COIN RAIN</b><span class="clk ${s.left < 15000 ? "urgent" : ""}">${ui.clock(s.left)}</span><span>💰 ${me?.score ?? 0}</span><span>top: ${top?.handle} ${top?.score}</span></div>`);
        if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("coin count", s.players, "Coin Rain", "score", "coins"); return; }
        ui.once("play", () => ui.panel(`<div class="ab-sub">run over coins to scoop them — orange are 3, big ones 10. the last 15 s rains double.</div>`, "bottom"));
      },
      onEvent(m) {
        const s = game.s; if (!s) return;
        if (m.ev === "grab" && m.who === ctx.me.id) { sfx.pop(); buzz(30); }
        if (m.ev === "gold") { sfx.ping(); ui.toast("💰 a BIG coin dropped", "phase"); }
        if (m.ev === "finish") { sfx.win(); celebrate(center.clone().add(new THREE.Vector3(0, 12, 0))); }
      },
    }, { hz: 6 });
    game.start({ phase: "play", left: this.T, radius: this.RADIUS, players: {}, coins: [] });
    wrapEnd(ctx, game, () => { for (const mh of meshes.values()) world3d.scene.remove(mh); meshes.clear(); arena.leave(); });
  },
};

// ====================================================================
// TILE WARS — arena · sporty. stand on tiles to paint them.
// ====================================================================
const TILEWARS = {
  id: "tilewars", title: "Tile Wars", blurb: "two teams. walk on tiles to paint them your colour. most tiles when the clock dies.", arch: "sporty", minPlayers: 2, maxPlayers: 16, length: "~3 min",
  N: 7, TILE: 8, T: 170000, LOCK_AT: 45000,
  start(ctx) {
    const center = myCenter(); center.y = 0;
    const G = this;
    const span = G.N * G.TILE;
    arena.enter({ room: ctx.room, me: ctx.me, center, radius: span * 0.72, visRange: m2u(80) });
    arena.fullRadar = true;
    ui.show(); ui.theme("sporty");
    let lastHud = 0;
    const tileMeshes = [];   // client-side, built once
    const COL = { 0: 0x39404d, red: 0xff4d6d, blue: 0x4da6ff };
    function tileCenter(i) { const gx = i % G.N, gz = Math.floor(i / G.N); return { x: center.x + (gx - (G.N - 1) / 2) * G.TILE, z: center.z + (gz - (G.N - 1) / 2) * G.TILE }; }
    function tileAt(p) { const gx = Math.round((p.x - center.x) / G.TILE + (G.N - 1) / 2), gz = Math.round((p.z - center.z) / G.TILE + (G.N - 1) / 2); return gx >= 0 && gx < G.N && gz >= 0 && gz < G.N ? gz * G.N + gx : -1; }
    const isEdge = i => { const gx = i % G.N, gz = Math.floor(i / G.N); return gx === 0 || gz === 0 || gx === G.N - 1 || gz === G.N - 1; };
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, 8, center);
        const ids = Object.values(s.players).sort((a, b) => (a.isBot - b.isBot));
        ids.forEach((p, i) => { p.team = i % 2 === 0 ? "red" : "blue"; p.claims = 0; });
        s.tiles = Array(G.N * G.N).fill(0);
        s.power = []; while (s.power.length < 3) { const i = Math.floor(game.rng() * G.N * G.N); if (!s.power.includes(i) && !isEdge(i)) s.power.push(i); }
        s.left = G.T; s.phase = "play"; s.locked = false;
      },
      hostTick(s, dt) {
        if (s.phase === "end") { s.left -= dt * 1000; if (s.left <= 0) game.finish(); return; }
        s.left -= dt * 1000; syncHumans(s, ctx);
        if (!s.locked && s.left <= G.LOCK_AT) { s.locked = true; game.emit("lock", {}); }
        for (const p of Object.values(s.players)) {
          if (p.isBot) {
            if (!p.brain.wp || game.rng() < dt * 0.4) {
              const want = s.tiles.map((t, i) => ({ t, i })).filter(o => o.t !== p.team && !(s.locked && isEdge(o.i)));
              const scored = want.map(o => { const c = tileCenter(o.i); return { c, u: (s.power.includes(o.i) ? 3 : 1) / (10 + dist2(c, p)) }; }).sort((a, b) => b.u - a.u)[0];
              if (scored) p.brain.wp = scored.c;
            }
            if (p.brain.wp) moveTo(p, p.brain.wp, 11 + p.skill * 7, dt, center, s.radius);
          }
          const i = tileAt(p);
          if (i >= 0 && s.tiles[i] !== p.team && !(s.locked && isEdge(i))) { s.tiles[i] = p.team; p.claims++; }
        }
        if (s.left <= 0) {
          s.phase = "end"; s.left = 12000;
          const count = t => s.tiles.reduce((n, o, i) => n + (o === t ? (s.power.includes(i) ? 3 : 1) : 0), 0);
          s.final = { red: count("red"), blue: count("blue") };
          for (const p of Object.values(s.players)) p.score = p.claims;
          game.emit("finish", s.final);
        }
      },
      render(s) {
        arena.setEntities(ents(s).map(e => ({ ...e, role: s.players[e.id]?.team === "red" ? "hunter" : undefined })));
        if (!tileMeshes.length && s.tiles?.length) {
          const geo = new THREE.PlaneGeometry(G.TILE * 0.92, G.TILE * 0.92);
          for (let i = 0; i < G.N * G.N; i++) {
            const c = tileCenter(i);
            const mh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COL[0], transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }));
            mh.rotation.x = -Math.PI / 2; mh.position.set(c.x, 0.25, c.z);
            world3d.scene.add(mh); tileMeshes.push(mh);
          }
        }
        for (let i = 0; i < tileMeshes.length; i++) {
          const own = s.tiles[i];
          const mh = tileMeshes[i];
          mh.material.color.setHex(own === 0 ? COL[0] : COL[own]);
          mh.material.opacity = s.power.includes(i) ? 0.8 : (s.locked && isEdge(i) ? 0.12 : 0.42);
        }
        const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
        const me = s.players[ctx.me.id];
        const cnt = t => s.tiles.filter(o => o === t).length;
        ui.hud(`<div class="hq"><b>TILE WARS</b><span class="clk ${s.left < 20000 ? "urgent" : ""}">${ui.clock(s.left)}</span><span style="color:#ff8ba0">■ ${cnt("red")}</span><span style="color:#8ec8ff">■ ${cnt("blue")}</span><span>you: ${me?.team ?? "?"}</span></div>`);
        if (s.phase === "end") {
          if (!ui.once("end", () => {})) return;
          const w = s.final.red === s.final.blue ? null : s.final.red > s.final.blue ? "red" : "blue";
          const mvp = Object.values(s.players).sort((a, b) => b.claims - a.claims)[0];
          ui.stage(w ? `team ${w} takes the floor` : "dead heat", `<p class="bignum" style="color:${w === "red" ? "#ff4d6d" : "#4da6ff"}">${s.final.red} : ${s.final.blue}</p><p class="ab-sub">bright tiles counted 3× · MVP: <b>${mvp?.handle}</b> with ${mvp?.claims} paints</p>`, "Tile Wars");
          return;
        }
        ui.once(`play:${me?.team}:${s.locked ? 1 : 0}`, () => ui.panel(`<div class="ab-sub">you're team <b style="color:${me?.team === "red" ? "#ff4d6d" : "#4da6ff"}">${me?.team}</b> — walk on tiles to paint them. bright tiles are worth 3.${s.locked ? " <b>outer ring is LOCKED — fight for the middle.</b>" : ""}</div>`, "bottom"));
      },
      onEvent(m) {
        if (m.ev === "lock") { sfx.klaxon(); shake(400, 2); ui.toast("outer ring LOCKED — inner tiles only", "phase"); }
        if (m.ev === "finish") { sfx.win(); celebrate(center.clone().add(new THREE.Vector3(0, 12, 0))); }
      },
    }, { hz: 6 });
    game.start({ phase: "play", left: this.T, radius: span * 0.72, players: {}, tiles: [], power: [], locked: false });
    wrapEnd(ctx, game, () => { for (const mh of tileMeshes) { world3d.scene.remove(mh); mh.material.dispose(); } tileMeshes.length = 0; arena.leave(); });
  },
};

// ====================================================================
// INFECTION ZONES — arena · sporty. safe zones with capacity, shrinking odds.
// ====================================================================
const INFECTION = {
  id: "infection", title: "Infection Zones", blurb: "one infected. safe zones hold 3 people and keep moving. survive 2½ minutes.", arch: "sporty", minPlayers: 4, maxPlayers: 16, length: "~2.5 min",
  RADIUS: 60, TAG: m2u(3), ZONE_R: m2u(6.5), ZONE_MS: 18000, CAP: 3, T: 150000,
  start(ctx) {
    const center = myCenter(); center.y = 0;
    arena.enter({ room: ctx.room, me: ctx.me, center, radius: this.RADIUS, visRange: m2u(60) });
    arena.fullRadar = true;
    ui.show(); ui.theme("sporty");
    const G = this;
    let lastHud = 0, zoneMarks = new Map();
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, 8, center, () => ({ role: "clean", safe: false, surv: 0, cool: 0 }));
        // scatter WIDE — clustered spawns let patient zero chain the whole lobby
        for (const p of Object.values(s.players)) { const a = game.rng() * Math.PI * 2, rr = 12 + game.rng() * (G.RADIUS * 0.75 - 12); p.x = center.x + Math.cos(a) * rr; p.z = center.z + Math.sin(a) * rr; }
        const bots = Object.values(s.players).filter(p => p.isBot);
        const z0 = bots.length ? pick(game.rng, bots) : pick(game.rng, Object.values(s.players));
        z0.role = "infected"; s.zero = z0.id;
        s.zones = []; s.zseq = 0; s.left = G.T; s.phase = "play"; s.grace = 8000;
        game.emit("zero", { id: z0.id });
      },
      hostTick(s, dt) {
        if (s.phase === "end") { s.left -= dt * 1000; if (s.left <= 0) game.finish(); return; }
        s.left -= dt * 1000; syncHumans(s, ctx);
        if (s.grace > 0) s.grace -= dt * 1000;
        const now = Date.now();
        // keep two zones alive
        s.zones = s.zones.filter(z => z.until > now);
        while (s.zones.length < 3) {
          const pos = { x: center.x + (game.rng() - 0.5) * s.radius * 1.5, z: center.z + (game.rng() - 0.5) * s.radius * 1.5 };
          s.zones.push({ id: "z" + (++s.zseq), ...pos, until: now + G.ZONE_MS + game.rng() * 6000 });
          game.emit("zone", {});
        }
        const P = Object.values(s.players);
        const clean = P.filter(p => p.role === "clean"), inf = P.filter(p => p.role === "infected");
        // capacity: nearest CAP clean players inside each zone are safe
        for (const p of clean) p.safe = false;
        for (const z of s.zones) {
          clean.filter(p => dist2(p, z) < G.ZONE_R).sort((a, b) => dist2(a, z) - dist2(b, z)).slice(0, G.CAP).forEach(p => p.safe = true);
        }
        for (const p of clean) p.surv += dt * 1000;
        // bots
        for (const p of P) {
          if (!p.isBot) continue;
          const sp = 12 + p.skill * 7;
          if (p.role === "infected") {
            const t = clean.filter(o => !o.safe).sort((a, b) => dist2(a, p) - dist2(b, p))[0] ?? clean.sort((a, b) => dist2(a, p) - dist2(b, p))[0];
            if (t) moveTo(p, t, sp * 0.92, dt, center, s.radius);
          } else {
            const danger = inf.sort((a, b) => dist2(a, p) - dist2(b, p))[0];
            const heat = danger ? dist2(danger, p) : 1e9;
            if (p.safe) { /* hold the zone */ }
            else if (heat < m2u(35)) {
              // proactively book a zone with a free slot; flee raw only if none reachable
              const open = s.zones.map(z => ({ z, d: dist2(z, p), n: clean.filter(o => o.safe && dist2(o, z) < G.ZONE_R).length })).filter(o => o.n < G.CAP).sort((a, b) => a.d - b.d)[0];
              if (open && (open.d < heat * 1.6 || heat > m2u(12))) moveTo(p, open.z, sp, dt, center, s.radius);
              else flee(p, danger, sp, dt, center, s.radius, game.rng);
            } else if (!p.brain.wp || dist2(p, p.brain.wp) < 2) p.brain.wp = { x: center.x + (game.rng() - 0.5) * s.radius * 1.5, z: center.z + (game.rng() - 0.5) * s.radius * 1.5 };
            else moveTo(p, p.brain.wp, sp * 0.6, dt, center, s.radius);
          }
        }
        // tags: only after the grace window, and each infected needs a beat between tags
        for (const p of P) if (p.cool > 0) p.cool -= dt * 1000;
        if (s.grace <= 0) for (const t of inf) for (const r of clean) {
          if (r.role === "clean" && !r.safe && t.cool <= 0 && dist2(t, r) < G.TAG) { r.role = "infected"; r.cool = 4000; t.cool = 2200; game.emit("infect", { by: t.id, who: r.id }); }
        }
        const still = P.filter(p => p.role === "clean");
        if (!still.length || s.left <= 0) {
          s.phase = "end"; s.left = 12000;
          for (const p of P) p.score = p.role === "clean" ? 3 : (p.id === s.zero ? 1 : Math.round(p.surv / 60000));
          s.survivors = still.map(p => p.id);
          game.emit("finish", { survivors: s.survivors });
        }
      },
      render(s) {
        arena.setEntities(ents(s).map(e => ({ ...e, role: s.players[e.id]?.role === "infected" ? "hunter" : undefined })));
        // zone marks
        const live = new Set(s.zones.map(z => z.id));
        for (const z of s.zones) if (!zoneMarks.has(z.id)) zoneMarks.set(z.id, arena.mark(z, 0x35d07a, G.ZONE_R));
        for (const [id, mk] of zoneMarks) if (!live.has(id)) { arena.unmark(mk); zoneMarks.delete(id); }
        const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
        const me = s.players[ctx.me.id];
        const clean = Object.values(s.players).filter(p => p.role === "clean").length;
        ui.hud(`<div class="hq"><b>INFECTION</b><span class="clk ${s.left < 20000 ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${clean} clean</span><span>${s.grace > 0 ? "⏳ " + Math.ceil(s.grace / 1000) + "s grace" : me?.role === "infected" ? "🧟 infected" : me?.safe ? "🛡 SAFE" : "🟢 run"}</span></div>`);
        if (s.phase === "end") {
          if (!ui.once("end", () => {})) return;
          const sv = (s.survivors ?? []).map(id => s.players[id]?.handle).join(", ");
          ui.stage(sv ? `${sv} never got caught` : "the infection took everyone", `<p class="ab-sub">patient zero: <b>${s.players[s.zero]?.handle}</b></p>`, "Infection Zones");
          return;
        }
        ui.once(`p:${me?.role}`, () => ui.panel(`<div class="ab-sub">${me?.role === "infected" ? "tag the clean — you can't touch anyone standing safe in a green zone" : "green zones hold 3 people max and keep moving. never stop running."}</div>`, "bottom"));
      },
      onEvent(m) {
        const s = game.s; if (!s) return;
        if (m.ev === "zero" && m.id === ctx.me.id) { ui.toast("YOU are patient zero — go", "rip"); buzz(120); }
        if (m.ev === "infect") { sfx.rip(); if (m.who === ctx.me.id) { flash("#7bffb0", 250); buzz(90); ui.toast("INFECTED — turn the rest", "rip"); } else ui.toast(`${s.players[m.who]?.handle} got infected`, "rip"); }
        if (m.ev === "zone") sfx.ping();
        if (m.ev === "finish") { sfx.win(); celebrate(center.clone().add(new THREE.Vector3(0, 12, 0))); }
      },
    }, { hz: 6 });
    game.start({ phase: "play", left: this.T, radius: this.RADIUS, players: {}, zones: [] });
    wrapEnd(ctx, game, () => { for (const mk of zoneMarks.values()) arena.unmark(mk); zoneMarks.clear(); arena.leave(); });
  },
};

// ====================================================================
// LAST TAP — panel · chaos. hold your nerve, release before the hidden bell.
// ====================================================================
const LASTTAP = {
  id: "lasttap", title: "Last Tap", blurb: "a hidden bell. release as LATE as you dare — still holding when it rings and you bust.", arch: "chaos", minPlayers: 2, maxPlayers: 16, length: "3 rounds · ~2 min",
  ROUNDS: 3,
  start(ctx) {
    ui.show(); ui.theme("chaos");
    let lastHud = 0, holdT0 = 0, released = false, tickTimer = null;
    const bells = {};    // host-only secret: round -> bell ms
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, 5, null, () => ({ ms: null, bust: false, pts: 0 }));
        s.round = 1; s.phase = "get"; s.left = 3500; s.reveal = null;
      },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        if (s.phase === "hold") {
          const bell = bells[s.round];
          for (const b of P) if (b.isBot && b.ms === null && b.plan !== undefined && (bell - s.left) >= b.plan) { b.ms = b.plan; }
          if (P.every(p => p.ms !== null)) s.left = Math.min(s.left, 300);
        }
        if (s.left > 0) return;
        if (s.phase === "get") {
          const bell = 3000 + Math.floor(game.rng() * 3500);
          bells[s.round] = bell;
          for (const b of P) { b.ms = null; b.bust = false; if (b.isBot) { const plan = Math.round(bell * (0.74 + game.rng() * 0.30)); b.plan = plan > bell ? null : plan; } }
          s.phase = "hold"; s.left = bell; game.emit("hold", { round: s.round });
        } else if (s.phase === "hold") {
          const bell = bells[s.round];
          for (const p of P) if (p.ms === null) { p.bust = true; p.ms = 0; }
          const ok = P.filter(p => !p.bust).sort((a, b) => b.ms - a.ms);
          ok.slice(0, 3).forEach((p, i) => p.pts += [3, 2, 1][i]);
          s.reveal = { bell, rows: P.map(p => ({ id: p.id, ms: p.bust ? null : p.ms })).sort((a, b) => (b.ms ?? -1) - (a.ms ?? -1)), winner: ok[0]?.id ?? null };
          s.phase = "reveal"; s.left = 7000; game.emit("bell", { round: s.round, bell });
        } else if (s.phase === "reveal") {
          if (s.round >= LASTTAP.ROUNDS) { s.phase = "end"; s.left = 12000; game.emit("finish", {}); }
          else { s.round++; s.phase = "get"; s.left = 3000; game.emit("get", { round: s.round }); }
        } else if (s.phase === "end") game.finish();
      },
      hostInput(s, m) {
        if (m.in === "rel" && s.phase === "hold") { const p = s.players[m.from]; if (p && p.ms === null) p.ms = Math.max(0, Math.min(m.ms, bells[s.round] + 500)); }
      },
      render(s) {
        const now = performance.now(); if (now - lastHud < 100) return; lastHud = now;
        const me = s.players[ctx.me.id];
        ui.hud(`<div class="hq"><b>LAST TAP r${s.round}/${LASTTAP.ROUNDS}</b><span>${me?.pts ?? 0} pts</span><span>${Object.values(s.players).length} in</span></div>`);
        if (s.phase === "get") { ui.once(`get:${s.round}`, () => ui.stage(`round ${s.round}`, `<p>when the hand appears, <b>everyone is holding the wire</b>.<br>let go as LATE as you dare. still holding when the hidden bell rings — <b>BUST</b>.</p>`, "nerve check")); return; }
        if (s.phase === "hold") {
          if (ui.once(`hold:${s.round}:${released ? 1 : 0}`, () => {
            if (!released) {
              ui.panel(`<div class="holdwrap"><button id="rel-btn" class="big hot holdbtn">HOLDING…<br><small>tap to let go</small></button><div class="ab-sub">the bell is hidden. latest release wins.</div></div>`, "center");
              const b = $("rel-btn");
              b.onclick = () => { released = true; const ms = Math.round(performance.now() - holdT0); game.input("rel", { ms }); ui.panel(`<div class="bignum">${(ms / 1000).toFixed(2)}s</div><div class="ab-sub" style="text-align:center">released — pray the bell was later</div>`, "center"); sfx.pop(); buzz(40); };
            }
          })) {}
          return;
        }
        if (s.phase === "reveal") {
          if (!ui.once(`rev:${s.round}`, () => {})) return;
          const r = s.reveal;
          const rows = r.rows.map(o => `<div class="rev-row ${o.id === r.winner ? "win" : ""}"><span>${s.players[o.id]?.handle}</span><b>${o.ms === null ? "💥 BUST" : (o.ms / 1000).toFixed(2) + "s"}</b></div>`).join("");
          ui.stage(`bell rang at ${(r.bell / 1000).toFixed(2)}s`, `${rows}`, r.winner ? `${s.players[r.winner]?.handle} held longest` : "everyone busted");
          return;
        }
        if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("nerves of steel", s.players, "Last Tap", "pts", "pts"); }
      },
      onEvent(m) {
        if (m.ev === "hold") { holdT0 = performance.now(); released = false; ui.resetKey(); sfx.tick(); buzz(30); clearInterval(tickTimer); tickTimer = setInterval(() => sfx.tick(), 900); }
        if (m.ev === "bell") { clearInterval(tickTimer); sfx.klaxon(); flash("#ff2a4a", 220); shake(300, 2); }
        if (m.ev === "get") { clearInterval(tickTimer); sfx.pop(); ui.resetKey(); }
        if (m.ev === "finish") { clearInterval(tickTimer); sfx.win(); }
      },
    }, { hz: 5 });
    game.start({ phase: "get", left: 3500, players: {}, round: 1, reveal: null });
    wrapEnd(ctx, game, () => clearInterval(tickTimer));
  },
};

// ====================================================================
// STOP AT 5.00 — panel · chaos. the clock hides after 1.5 s.
// ====================================================================
const STOPFIVE = {
  id: "stopfive", title: "Stop at 5.00", blurb: "the stopwatch hides after 1.5 s. stop it at exactly 5.00 in your head.", arch: "chaos", minPlayers: 2, maxPlayers: 16, length: "3 rounds · ~2 min",
  ROUNDS: 3, TARGET: 5000,
  start(ctx) {
    ui.show(); ui.theme("chaos");
    let lastHud = 0, runT0 = 0, stopped = false, uiTimer = null;
    const game = new HostGame(ctx, {
      hostInit(s) { s.players = seed(ctx, game.rng, 5, null, () => ({ ms: null, pts: 0 })); s.round = 1; s.phase = "get"; s.left = 3000; s.reveal = null; },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        if (s.phase === "run") {
          for (const b of P) if (b.isBot && b.ms === null && (8000 - s.left) >= b.plan) b.ms = b.plan;
          if (P.every(p => p.ms !== null)) s.left = Math.min(s.left, 300);
        }
        if (s.left > 0) return;
        if (s.phase === "get") {
          for (const b of P) { b.ms = null; if (b.isBot) b.plan = Math.max(2500, Math.round(gauss(game.rng, 5000, 350 + (1 - b.skill) * 400))); }
          s.phase = "run"; s.left = 8000; game.emit("run", { round: s.round });
        } else if (s.phase === "run") {
          for (const p of P) if (p.ms === null) p.ms = 8000;
          const ranked = [...P].sort((a, b) => Math.abs(a.ms - STOPFIVE.TARGET) - Math.abs(b.ms - STOPFIVE.TARGET));
          ranked.slice(0, 3).forEach((p, i) => p.pts += [3, 2, 1][i]);
          s.reveal = { rows: ranked.map(p => ({ id: p.id, ms: p.ms })), winner: ranked[0]?.id ?? null };
          s.phase = "reveal"; s.left = 7000; game.emit("reveal", { round: s.round });
        } else if (s.phase === "reveal") {
          if (s.round >= STOPFIVE.ROUNDS) { s.phase = "end"; s.left = 12000; game.emit("finish", {}); }
          else { s.round++; s.phase = "get"; s.left = 2500; game.emit("get", { round: s.round }); }
        } else if (s.phase === "end") game.finish();
      },
      hostInput(s, m) { if (m.in === "stop" && s.phase === "run") { const p = s.players[m.from]; if (p && p.ms === null) p.ms = Math.max(0, Math.min(m.ms, 8000)); } },
      render(s) {
        const now = performance.now(); if (now - lastHud < 100) return; lastHud = now;
        const me = s.players[ctx.me.id];
        ui.hud(`<div class="hq"><b>STOP AT 5.00 r${s.round}/${STOPFIVE.ROUNDS}</b><span>${me?.pts ?? 0} pts</span></div>`);
        if (s.phase === "get") { ui.once(`get:${s.round}`, () => ui.stage(`round ${s.round}`, `<p>a stopwatch starts. it <b>disappears at 1.50</b>.<br>keep counting in your head and hit STOP at exactly <b>5.00</b>.</p>`, "internal clock check")); return; }
        if (s.phase === "run") {
          ui.once(`run:${s.round}`, () => {
            ui.panel(`<div class="holdwrap"><div class="bignum" id="sw">0.00</div><button id="stop-btn" class="big hot">STOP</button></div>`, "center");
            clearInterval(uiTimer);
            uiTimer = setInterval(() => { const el = $("sw"); if (!el) return; const t = performance.now() - runT0; el.textContent = t < 1500 ? (t / 1000).toFixed(2) : "?.??"; }, 50);
            $("stop-btn").onclick = () => {
              if (stopped) return; stopped = true; clearInterval(uiTimer);
              const ms = Math.round(performance.now() - runT0); game.input("stop", { ms });
              ui.panel(`<div class="bignum">${(ms / 1000).toFixed(2)}</div><div class="ab-sub" style="text-align:center">locked in</div>`, "center"); sfx.pop(); buzz(40);
            };
          });
          return;
        }
        if (s.phase === "reveal") {
          if (!ui.once(`rev:${s.round}`, () => {})) return;
          const rows = s.reveal.rows.map(o => { const d = o.ms - STOPFIVE.TARGET; return `<div class="rev-row ${o.id === s.reveal.winner ? "win" : ""}"><span>${s.players[o.id]?.handle}</span><b>${(o.ms / 1000).toFixed(2)} <small>(${d > 0 ? "+" : ""}${(d / 1000).toFixed(2)})</small></b></div>`; }).join("");
          ui.stage(`${s.players[s.reveal.winner]?.handle} nailed it`, rows, "closest to 5.00");
          return;
        }
        if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("best internal clock", s.players, "Stop at 5.00", "pts", "pts"); }
      },
      onEvent(m) {
        if (m.ev === "run") { runT0 = performance.now(); stopped = false; ui.resetKey(); sfx.ping(); }
        if (m.ev === "reveal") { clearInterval(uiTimer); sfx.chime(); }
        if (m.ev === "get") { clearInterval(uiTimer); ui.resetKey(); sfx.pop(); }
        if (m.ev === "finish") { clearInterval(uiTimer); sfx.win(); }
      },
    }, { hz: 5 });
    game.start({ phase: "get", left: 3000, players: {}, round: 1, reveal: null });
    wrapEnd(ctx, game, () => clearInterval(uiTimer));
  },
};

// ====================================================================
// RECEIPTS — panel · chill. one "fact" each, true or cap. the reveal is the person.
// ====================================================================
const RECEIPTS = {
  id: "receipts", title: "Receipts", blurb: "everyone writes one fact about themselves — true or a lie. the room votes. the reveal is you.", arch: "chill", minPlayers: 3, maxPlayers: 10, length: "~5 min",
  start(ctx) {
    ui.show(); ui.theme("chill");
    let lastHud = 0, myPicked = null, myCard = null;
    let deck = [];   // host-only: [{author, text, truth}] — never broadcast before reveal
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, 5, null, () => ({ vote: null }));
        for (const p of Object.values(s.players)) if (p.isBot) { const c = pick(game.rng, RECEIPT_POOL); p.sub = { text: c.t, truth: c.truth }; }
        s.phase = "write"; s.left = 45000; s.cardIdx = -1; s.cur = null; s.results = [];
      },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        if (s.phase === "write" && P.every(p => p.sub)) s.left = Math.min(s.left, 1500);
        if (s.phase === "vote") {
          const card = deck[s.cardIdx];
          for (const b of P) if (b.isBot && b.vote === null && b.id !== card.author && game.rng() < dt * 0.5) b.vote = game.rng() < 0.55;
          if (P.filter(p => p.id !== card.author).every(p => p.vote !== null)) s.left = Math.min(s.left, 1000);
        }
        if (s.left > 0) return;
        if (s.phase === "write") {
          deck = P.filter(p => p.sub).map(p => ({ author: p.id, text: p.sub.text, truth: !!p.sub.truth })).sort(() => game.rng() - 0.5).slice(0, 6);
          for (const p of P) delete p.sub;   // keep truths out of the broadcast state
          if (!deck.length) { s.phase = "end"; s.left = 8000; return; }
          nextCard(s);
        } else if (s.phase === "vote") {
          const card = deck[s.cardIdx];
          const votes = P.filter(p => p.id !== card.author && p.vote !== null).map(p => ({ id: p.id, v: p.vote }));
          const right = votes.filter(v => v.v === card.truth);
          for (const v of right) s.players[v.id].score += 100;
          const fooled = votes.length && right.length <= votes.length / 2;
          if (fooled) s.players[card.author].score += 150;
          s.results.push({ text: card.text, author: card.author, truth: card.truth, votes, fooled });
          s.phase = "reveal"; s.left = 9000;
          game.emit("flip", { author: card.author, truth: card.truth, fooled });
        } else if (s.phase === "reveal") {
          if (s.cardIdx + 1 < deck.length) nextCard(s);
          else { s.phase = "end"; s.left = 14000; game.emit("finish", {}); }
        } else if (s.phase === "end") game.finish();
        function nextCard(s) {
          s.cardIdx++;
          for (const p of P) p.vote = null;
          s.cur = { text: deck[s.cardIdx].text, n: s.cardIdx + 1, total: deck.length };
          s.phase = "vote"; s.left = 18000; game.emit("card", { n: s.cur.n });
        }
      },
      hostInput(s, m) {
        const p = s.players[m.from]; if (!p) return;
        if (m.in === "sub" && s.phase === "write") p.sub = { text: String(m.text).slice(0, 90), truth: !!m.truth };
        if (m.in === "vote" && s.phase === "vote" && deck[s.cardIdx]?.author !== m.from) p.vote = !!m.v;
      },
      render(s) {
        const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
        const P = Object.values(s.players); const me = s.players[ctx.me.id];
        ui.hud(`<div class="hq"><b>RECEIPTS ${s.cur ? s.cur.n + "/" + s.cur.total : ""}</b><span class="clk">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
        if (s.phase === "write") {
          if (!ui.once(`w:${myCard ? 1 : 0}`, () => {})) return;
          if (!myCard) {
            ui.stage("your receipt", `<p class="ab-sub">one fact about yourself. true — or a complete lie. the room decides.</p>` + ui.prompt("I once…", () => {}, { maxlength: 90, submitLabel: "…" }), "write");
            const f = $("game-panel").querySelector(".gp-form");
            if (f) { f.innerHTML += `<div class="choices"><button class="ch" data-t="1">submit as TRUE ✅</button><button class="ch" data-t="0">submit as CAP 🧢</button></div>`;
              f.onsubmit = e => e.preventDefault();
              f.querySelectorAll("button.ch").forEach(b => b.onclick = e => { e.preventDefault(); const v = $("gp-in").value.trim(); if (!v) return; myCard = v; game.input("sub", { text: v, truth: b.dataset.t === "1" }); sfx.pop(); ui.resetKey(); });
            }
          } else ui.stage("receipt filed", `<p class="ab-sub">poker face from here on. waiting for the table…</p>`, "write");
          return;
        }
        if (s.phase === "vote" && s.cur) {
          const isMine = myCard && s.cur.text === myCard;
          if (!ui.once(`v:${s.cardIdx}:${myPicked ?? ""}:${isMine}`, () => {})) return;
          const card = `<div class="receipt-card">“${s.cur.text}”</div>`;
          if (isMine) ui.stage("your card is up", card + `<p class="ab-sub">say nothing. blink normally.</p>`, `card ${s.cur.n}/${s.cur.total}`);
          else {
            ui.stage("true — or cap?", card + ui.choices([{ value: "1", label: "TRUE ✅" }, { value: "0", label: "CAP 🧢" }], null, { picked: myPicked }), `card ${s.cur.n}/${s.cur.total}`);
            ui.bindChoices(v => { myPicked = v; game.input("vote", { v: v === "1" }); sfx.pop(); ui.resetKey(); });
          }
          return;
        }
        if (s.phase === "reveal") {
          if (!ui.once(`r:${s.cardIdx}`, () => {})) return;
          const r = s.results[s.results.length - 1]; if (!r) return;
          const who = s.players[r.author]?.handle ?? "?";
          const t = P.filter(p => r.votes.find(v => v.id === p.id && v.v)).map(p => p.handle);
          const f = P.filter(p => r.votes.find(v => v.id === p.id && !v.v)).map(p => p.handle);
          ui.stage(`${who} — it was ${r.truth ? "TRUE ✅" : "CAP 🧢"}`, `<div class="receipt-card">“${r.text}”</div>
            <div class="rev-row"><span>said TRUE</span><b>${t.join(", ") || "—"}</b></div>
            <div class="rev-row"><span>said CAP</span><b>${f.join(", ") || "—"}</b></div>
            ${r.fooled ? `<p class="ab-sub">💸 ${who} fooled the room (+150)</p>` : ""}`, "the reveal");
          return;
        }
        if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("most receipts", s.players, "Receipts"); }
      },
      onEvent(m) {
        if (m.ev === "card") { myPicked = null; ui.resetKey(); sfx.ping(); }
        if (m.ev === "flip") { sfx.stamp(); if (m.author === ctx.me.id && m.fooled) { sfx.chime(); ui.toast("you fooled the room 💸", "phase"); } }
        if (m.ev === "finish") sfx.win();
      },
    }, { hz: 4 });
    game.start({ phase: "write", left: 45000, players: {}, cardIdx: -1, cur: null, results: [] });
    wrapEnd(ctx, game);
  },
};

// ====================================================================
// MAJORITY RULES — panel · chill. side with the room, read one person.
// ====================================================================
const MAJORITY = {
  id: "majority", title: "Majority Rules", blurb: "pick the side the room will pick — and call which way the spotlight player leans.", arch: "chill", minPlayers: 3, maxPlayers: 16, length: "5 rounds · ~4 min",
  ROUNDS: 5,
  start(ctx) {
    ui.show(); ui.theme("chill");
    let lastHud = 0, myPick = null, myCall = null;
    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = seed(ctx, game.rng, 5, null, () => ({ pick: null, call: null }));
        s.prompts = [...Array(MAJORITY_PROMPTS.length).keys()].sort(() => game.rng() - 0.5).slice(0, MAJORITY.ROUNDS);
        const ids = Object.values(s.players).sort((a, b) => a.isBot - b.isBot).map(p => p.id);
        s.spots = Array.from({ length: MAJORITY.ROUNDS }, (_, i) => ids[i % ids.length]);
        s.round = 0; s.phase = "vote"; s.left = 18000; s.results = [];
      },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        const P = Object.values(s.players);
        const spot = s.spots[s.round];
        if (s.phase === "vote") {
          for (const b of P) if (b.isBot) {
            if (b.pick === null && game.rng() < dt * 0.5) b.pick = game.rng() < 0.5 ? "a" : "b";
            if (b.call === null && b.id !== spot && game.rng() < dt * 0.5) b.call = game.rng() < 0.5 ? "a" : "b";
          }
          if (P.every(p => p.pick !== null && (p.id === spot || p.call !== null))) s.left = Math.min(s.left, 1000);
        }
        if (s.left > 0) return;
        if (s.phase === "vote") {
          const a = P.filter(p => p.pick === "a"), b = P.filter(p => p.pick === "b");
          const maj = a.length === b.length ? null : a.length > b.length ? "a" : "b";
          if (maj) for (const p of P) if (p.pick === maj) p.score += 100;
          const spotPick = s.players[spot]?.pick;
          for (const p of P) if (p.id !== spot && p.call && p.call === spotPick) p.score += 50;
          s.results.push({ q: s.prompts[s.round], a: a.map(p => p.id), b: b.map(p => p.id), maj, spot, spotPick });
          s.phase = "reveal"; s.left = 9000; game.emit("tally", { maj, spot, spotPick });
        } else if (s.phase === "reveal") {
          if (s.round + 1 < MAJORITY.ROUNDS) { s.round++; for (const p of P) { p.pick = null; p.call = null; } s.phase = "vote"; s.left = 18000; game.emit("next", { round: s.round }); }
          else { s.phase = "end"; s.left = 14000; game.emit("finish", {}); }
        } else if (s.phase === "end") game.finish();
      },
      hostInput(s, m) {
        const p = s.players[m.from]; if (!p || s.phase !== "vote") return;
        if (m.in === "pick") p.pick = m.v === "a" ? "a" : "b";
        if (m.in === "call" && m.from !== s.spots[s.round]) p.call = m.v === "a" ? "a" : "b";
      },
      render(s) {
        const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
        const me = s.players[ctx.me.id];
        const pr = MAJORITY_PROMPTS[s.prompts[s.round]];
        const spot = s.spots[s.round], spotName = s.players[spot]?.handle ?? "?";
        ui.hud(`<div class="hq"><b>MAJORITY ${s.round + 1}/${MAJORITY.ROUNDS}</b><span class="clk">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
        if (s.phase === "vote" && pr) {
          if (!ui.once(`v:${s.round}:${myPick ?? ""}:${myCall ?? ""}`, () => {})) return;
          const callBlock = spot === ctx.me.id
            ? `<p class="ab-sub">🔦 YOU are the spotlight this round — everyone is calling your pick.</p>`
            : `<p class="q2">🔦 and which way does <b>${spotName}</b> lean?</p>` + ui.choices([{ value: "ca", label: pr.a }, { value: "cb", label: pr.b }], null, { picked: myCall });
          ui.stage(pr.q, ui.choices([{ value: "a", label: pr.a }, { value: "b", label: pr.b }], null, { picked: myPick }) + callBlock, "side with the majority");
          ui.bindChoices(v => {
            if (v === "a" || v === "b") { myPick = v; game.input("pick", { v }); }
            else { myCall = v.slice(1); game.input("call", { v: myCall }); }
            sfx.pop(); ui.resetKey();
          });
          return;
        }
        if (s.phase === "reveal") {
          if (!ui.once(`r:${s.round}`, () => {})) return;
          const r = s.results[s.results.length - 1]; if (!r) return;
          const q = MAJORITY_PROMPTS[r.q];
          const names = ids => ids.map(i => s.players[i]?.handle).join(", ") || "—";
          ui.stage(r.maj ? `“${q[r.maj]}” wins the room` : "dead split — no points", `
            <div class="rev-row ${r.maj === "a" ? "win" : ""}"><span>${q.a} (${r.a.length})</span><b>${names(r.a)}</b></div>
            <div class="rev-row ${r.maj === "b" ? "win" : ""}"><span>${q.b} (${r.b.length})</span><b>${names(r.b)}</b></div>
            <p class="ab-sub">🔦 ${s.players[r.spot]?.handle} went “${r.spotPick ? q[r.spotPick] : "…"}” — right callers +50</p>`, q.q);
          return;
        }
        if (s.phase === "end") { if (ui.once("end", () => {})) finishBoard("read the room best", s.players, "Majority Rules"); }
      },
      onEvent(m) {
        if (m.ev === "next") { myPick = null; myCall = null; ui.resetKey(); sfx.ping(); }
        if (m.ev === "tally") sfx.chime();
        if (m.ev === "finish") sfx.win();
      },
    }, { hz: 4 });
    game.start({ phase: "vote", left: 18000, players: {}, round: 0, results: [], prompts: [], spots: [] });
    wrapEnd(ctx, game);
  },
};

// lane order: sporty, chaos, chill - the host sheet groups by `arch`.
export const CATALOG = [
  COINRAIN, DEATHTAG, INFECTION, TILEWARS,          // sporty
  TIMEBOMB, IMPOSTER, LASTTAP, STOPFIVE,            // chaos
  CAPTION, RECEIPTS, MAJORITY, SPLITCLUE, DRAW,     // chill
];
