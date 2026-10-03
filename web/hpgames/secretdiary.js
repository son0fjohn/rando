// Secret Diary (3+) — house party game 1.
//
// A round is several prompts (5 by default, DIARY.PROMPTS in hpconfig.js)
// about tonight and the people in the room. Everyone privately writes a
// sentence or two for each one. Only once every prompt is answered do the
// entries appear — all at once, unattributed, in random order, grouped under
// their prompt. Each player then privately matches every entry to a player,
// one prompt at a time. Score is correct matches.
//
// The answers are never revealed: no screen in this game ever shows who wrote
// an entry — not during the round, not on the results screen, not to the
// winner.
//
// AUTHORSHIP, honestly: "never revealed" is a UI promise, not a cryptographic
// one. Rooms are Supabase Realtime broadcast channels, so every snapshot
// reaches every member; the host has to know who wrote what in order to
// score, which means authorship is in the state and anyone with devtools open
// could read it. That is true of every hidden-information game in this
// codebase (Art Gallery included) and is fine for a disposable party demo on
// phones. Making it actually secret would need per-player encryption or a
// server authority — neither is in scope. `p.mine` is the author link.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { DIARY_PROMPTS, DIARY_BOT_ENTRIES, DIARY, pool } from "./../hpconfig.js";
import { Rounds, syncGone, allDone, esc, pick, shuffle, showResults, hostSkip, bindHostSkip, trash, tally } from "./../hpkit.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));
const ENTRY_MAX = 180;
const N_PROMPTS = DIARY.PROMPTS;
const WRITE_MS = DIARY.WRITE_MS_PER_PROMPT * N_PROMPTS;
const MATCH_MS = DIARY.MATCH_MS;
const END_MS = 22000;
// reveal is long enough to actually read the lot: a base plus time per entry
const revealMs = s => Math.max(15000, Math.min(75000, 8000 + 1500 * (s.entries?.length ?? 0)));

export const SECRET_DIARY = {
  id: "secretdiary", title: "Secret Diary",
  blurb: `answer ${N_PROMPTS} secret prompts. every entry appears unsigned. guess who wrote which.`,
  minPlayers: 3, maxPlayers: 12, length: "~10 min",

  start(ctx) {
    ui.show(); ui.theme("chill");
    const room = ctx.room;

    // entry id -> author id, derived from the state (p.mine). Rebuilt rather
    // than trusted so a host handover mid-round can still score the game.
    const authorOf = s => {
      const m = new Map();
      for (const p of Object.values(s.players || {})) for (const eid of Object.values(p.mine || {})) m.set(eid, p.id);
      return m;
    };
    const myEids = p => new Set(Object.values(p?.mine || {}));
    // which entries a player has to match: everything except their own
    // (their own are shown, locked, labelled "yours" — free points otherwise)
    const toMatch = (s, p) => (s.entries || []).filter(e => !myEids(p).has(e.eid));
    const answered = p => (p.texts || []).filter(Boolean).length;

    // client-local
    let myTexts = [], myGuesses = {}, myPage = 0, lastHud = 0;
    trash.add(() => { myGuesses = {}; myTexts = []; myPage = 0; });

    const rounds = new Rounds([
      {
        name: "write", ms: WRITE_MS,
        done: s => allDone(s, p => answered(p) >= N_PROMPTS),
        next: () => "reveal",
        exit: s => collect(s),
      },
      { name: "reveal", ms: revealMs, next: s => s.entries.length >= 2 ? "match" : "end" },
      {
        name: "match", ms: MATCH_MS,
        done: s => allDone(s, p => toMatch(s, p).every(e => p.guesses[e.eid])),
        next: s => { score(s); return "end"; },
      },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "reveal") { sfx.chime(); buzz(40); }
        if (name === "match") { myPage = 0; sfx.ping(); }
        if (name === "end") sfx.win();
      },
    });

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true);
        const names = Object.values(s.players).map(p => p.handle);
        // N distinct prompts; {{player}} filled with a random handle
        const deck = shuffle(game.rng, pool(DIARY_PROMPTS));
        s.prompts = Array.from({ length: N_PROMPTS }, (_, i) =>
          (deck[i % deck.length]?.text ?? "Write about tonight.").replace(/\{\{player\}\}/g, names.length ? pick(game.rng, names) : "someone here"));
        s.entries = []; s.why = null;
        rounds.enter(s, "write");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        if (s.phase === "write") {
          for (const p of Object.values(s.players)) {
            if (!p.isBot || answered(p) >= N_PROMPTS) continue;
            if (game.rng() < dt * 0.6) {
              const pi = p.texts.findIndex(t => !t);
              p.texts[pi] = DIARY_BOT_ENTRIES[(Math.abs(hash(p.id)) + pi * 3) % DIARY_BOT_ENTRIES.length];
            }
          }
        }
        if (s.phase === "match") {
          const ids = Object.keys(s.players);
          for (const p of Object.values(s.players)) {
            if (!p.isBot) continue;
            for (const e of toMatch(s, p))
              if (!p.guesses[e.eid] && game.rng() < dt * 0.4) p.guesses[e.eid] = pick(game.rng, ids);
          }
        }
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const p = s.players[m.from];
        if (!p) return;
        if (m.in === "write" && s.phase === "write" && Number.isInteger(m.pi) && m.pi >= 0 && m.pi < N_PROMPTS)
          p.texts[m.pi] = String(m.text ?? "").trim().slice(0, ENTRY_MAX);
        if (m.in === "guess" && s.phase === "match") {
          const e = (s.entries || []).find(x => x.eid === m.eid);
          if (e && !myEids(p).has(e.eid) && s.players[m.who]) p.guesses[m.eid] = m.who;
        }
      },
      render(s) { renderSD(s); },
      onEvent() {},
    }, { hz: 3 });

    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false, texts: Array(N_PROMPTS).fill(""), guesses: {}, mine: {}, correct: 0 });
    function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }

    // ---- host: turn written text into anonymous, shuffled entries ----
    // Per prompt, shuffle the writers, then assign ids AFTER the shuffle, so
    // neither the id nor the display order tracks join order.
    function collect(s) {
      s.entries = [];
      for (let pi = 0; pi < N_PROMPTS; pi++) {
        const writers = shuffle(game.rng, Object.values(s.players).filter(p => p.texts[pi]));
        writers.forEach((p, i) => {
          const eid = `e${pi}-${i}`;
          s.entries.push({ eid, pi, text: p.texts[pi] });
          p.mine[pi] = eid;
        });
      }
      // the text now lives only in s.entries; one home, not two that can drift
      for (const p of Object.values(s.players)) p.texts = [];
      if (s.entries.length < 2) s.why = "not enough entries to play — everyone needs to write";
    }
    function score(s) {
      const by = authorOf(s);
      for (const p of Object.values(s.players)) {
        let n = 0;
        for (const e of toMatch(s, p)) if (p.guesses[e.eid] && p.guesses[e.eid] === by.get(e.eid)) n++;
        p.correct = n; p.score = n;
      }
    }

    // ---- render (everyone) ----
    function renderSD(s) {
      const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const label = s.phase === "write" ? "writing" : s.phase === "reveal" ? "the entries" : s.phase === "match" ? "matching" : "final";
      ui.hud(`<div class="hq"><b>SECRET DIARY</b><span>${label}</span><span class="clk ${s.left < 10000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span>${s.phase === "end" ? `<span>${me?.score ?? 0} pts</span>` : ""}</div>`);

      if (s.phase === "write") {
        // the next prompt this player hasn't answered (local copy wins so the
        // screen moves on the instant you submit, not one snapshot later)
        const done = i => !!(myTexts[i] || me?.texts?.[i]);
        const cur = (s.prompts || []).findIndex((_, i) => !done(i));
        const nDone = (s.prompts || []).filter((_, i) => done(i)).length;
        const ready = tally(s, p => answered(p) >= N_PROMPTS);
        // The "N finished" count is NOT in the key: someone else finishing
        // must never rebuild this panel, or it would wipe what this player is
        // halfway through typing. It's patched in place instead.
        if (!ui.once(`w:${cur}`, () => {})) { const r = $("sd-ready"); if (r && r.textContent !== ready) r.textContent = ready; return; }
        const dots = `<div class="sd-dots">${(s.prompts || []).map((_, i) => `<i class="${done(i) ? "on" : ""} ${i === cur ? "cur" : ""}"></i>`).join("")}</div>`;
        if (cur >= 0) {
          ui.stage(`prompt ${cur + 1} of ${N_PROMPTS}`, dots + `<div class="sd-prompt">${esc(s.prompts[cur])}</div>`
            + ui.prompt("a sentence or two…", text => { myTexts[cur] = text; game.input("write", { pi: cur, text }); sfx.pop(); ui.resetKey(); }, { maxlength: ENTRY_MAX, submitLabel: cur + 1 < N_PROMPTS ? "next" : "lock it in" })
            + `<p class="ab-sub">nobody sees your name next to any of these — ever · <span id="sd-ready">${ready}</span> players finished</p>${hostSkip(ctx)}`, `writing · ${ui.clock(s.left)}`);
        } else {
          ui.stage("all locked in", dots + `<p class="ab-sub">${nDone}/${N_PROMPTS} answered · waiting on the others (<span id="sd-ready">${ready}</span> finished)</p>${hostSkip(ctx)}`, `writing · ${ui.clock(s.left)}`);
        }
        bindHostSkip(game);

      } else if (s.phase === "reveal") {
        if (!ui.once(`r:${s.entries.length}`, () => {})) return;
        const groups = (s.prompts || []).map((pr, pi) => {
          const es = s.entries.filter(e => e.pi === pi);
          if (!es.length) return "";
          return `<div class="sd-group"><div class="sd-prompt">${esc(pr)}</div>${es.map(e => `<div class="sd-entry">${esc(e.text)}</div>`).join("")}</div>`;
        }).join("");
        ui.stage(`${s.entries.length} entries`, groups
          + `<p class="ab-sub">unsigned, in random order. read them properly — you're about to guess.</p>${hostSkip(ctx)}`, `the diary · ${ui.clock(s.left)}`);
        bindHostSkip(game);

      } else if (s.phase === "match") {
        const mine = myEids(me);
        const pages = (s.prompts || []).map((_, pi) => (s.entries || []).filter(e => e.pi === pi)).filter(es => es.length);
        const pageIdx = (s.prompts || []).map((_, pi) => pi).filter(pi => (s.entries || []).some(e => e.pi === pi));
        if (myPage >= pageIdx.length) myPage = 0;
        const g = eid => myGuesses[eid] ?? me?.guesses?.[eid] ?? null;
        const todo = toMatch(s, me ?? {});
        const nAns = todo.filter(e => g(e.eid)).length;
        const pageDone = i => pages[i].every(e => mine.has(e.eid) || g(e.eid));
        const ready = tally(s, p => toMatch(s, p).every(e => p.guesses[e.eid]));
        if (!ui.once(`m:${myPage}:${nAns}:${ready}`, () => {})) return;
        const pi = pageIdx[myPage], es = pages[myPage] ?? [];
        // within one prompt each player wrote exactly one entry, so names
        // already used on this page are dimmed — a hint, not a lock
        const used = new Set(es.map(e => g(e.eid)).filter(Boolean));
        const tabs = `<div class="sd-tabs">${pageIdx.map((_, i) => `<button type="button" class="${i === myPage ? "cur" : ""} ${pageDone(i) ? "done" : ""}" data-page="${i}">${i + 1}</button>`).join("")}</div>`;
        const rows = es.map(e => {
          if (mine.has(e.eid)) return `<div class="sd-match"><div class="sd-entry">${esc(e.text)}</div><div class="pt-note">yours — not scored</div></div>`;
          const cur = g(e.eid);
          return `<div class="sd-match"><div class="sd-entry">${esc(e.text)}</div>
            <div class="sd-who">${P.map(p => `<button type="button" class="${cur === p.id ? "on" : ""} ${cur !== p.id && used.has(p.id) ? "used" : ""}" data-eid="${e.eid}" data-who="${esc(p.id)}">${esc(p.handle)}</button>`).join("")}</div></div>`;
        }).join("");
        const nextBtn = myPage + 1 < pageIdx.length
          ? `<button type="button" class="pt-btn pt-primary" id="sd-next">next prompt →</button>`
          : `<p class="ab-sub">that's the last prompt — tap any number above to go back</p>`;
        ui.stage("who wrote which?", tabs + `<div class="sd-prompt">${esc(s.prompts[pi])}</div>` + rows + nextBtn
          + `<p class="ab-sub">${nAns}/${todo.length} matched · change your mind any time until the clock runs out · ${ready} players done</p>${hostSkip(ctx)}`,
          `matching · ${ui.clock(s.left)}`);
        const panel = $("game-panel");
        panel.querySelectorAll("[data-eid]").forEach(b => b.onclick = () => {
          myGuesses[b.dataset.eid] = b.dataset.who;
          game.input("guess", { eid: b.dataset.eid, who: b.dataset.who });
          sfx.tick(); ui.resetKey();
        });
        panel.querySelectorAll("[data-page]").forEach(b => b.onclick = () => { myPage = +b.dataset.page; ui.resetKey(); panel.scrollTop = 0; });
        const nb = $("sd-next"); if (nb) nb.onclick = () => { myPage++; ui.resetKey(); panel.scrollTop = 0; };
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const total = toMatch(s, me ?? {}).length;
        showResults(P, {
          title: "Secret Diary", sub: "correct matches",
          note: s.why || `out of ${total} · who wrote what stays secret — nobody finds out, not even the winner`,
        }, `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging, which would otherwise keep
    // every entry, title and photo id alive after the party ended
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "write", left: WRITE_MS, players: {}, entries: [], prompts: [], why: null });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); o(); };
  },
};
