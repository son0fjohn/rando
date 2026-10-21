// Side Quest (3+) — a wizard fortune teller hands out real-life dares.
//
// Each turn the wizard's crystal ball reveals a quest, then spins through
// everyone's faces and lands on whoever has to do it (random but fair — see
// fairpick.js). They get 3 minutes, out in the world, while the others film
// on their own phones. Then they tap Done (the room rates 1-5 stars: "how
// hard did they commit?") or Give up (an automatic 0, no vote). Points are
// the average stars x SIDEQUEST.POINTS_PER_STAR.
//
// Before the first turn the host sees the quest pool grouped by category,
// everything on; they can switch single quests or whole categories off and
// set the number of turns (default: everyone once), or just tap Start.
// Unhinged quests only exist for parties that allow 18+ content.
//
// The quests live in web/data/side_quests.json; their ids are permanent.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { SIDEQUEST } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";
import { fairPick } from "./../fairpick.js";
import { typeDialog } from "./../retro.js";
import { spriteFace } from "./../partyboard.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const SETUP_MS = 5 * 60 * 1000;   // nobody taps Start: go with what's on
const WIZARD_MS = 4200;
const QUEST_MS = 5600;
const SWIRL_MS = 1700;            // of QUEST_MS: the ball swirls, then the card
const SPIN_MS = 5200;
const SPIN_LAND_MS = 3200;        // of SPIN_MS: faces flick past, then it lands
const RESULT_MS = 8000;
const END_MS = 22000;
const STARS = SIDEQUEST.STARS, PPS = SIDEQUEST.POINTS_PER_STAR;
const WIZARD_LINE = "The spirits have chosen your quest...";

// ---------------------------------------------------------------- the pool
let POOL = null, CATS = [];
const poolReady = fetch(new URL(`../${SIDEQUEST.POOL_URL}`, import.meta.url))
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => {
    CATS = (j.categories || []).filter(c => c && c.id);
    POOL = (j.quests || []).filter(q => q && q.id && q.text && CATS.some(c => c.id === q.category));
    return POOL;
  })
  .catch(e => { console.warn("[sidequest] couldn't load the quest pool", e); POOL = []; return POOL; });
export const questPool = () => poolReady.then(() => ({ quests: POOL, categories: CATS }));

// what this party may draw from: unhinged quests need the party's 18+ setting
export const questsFor = (pool, meta = {}) => pool.filter(q => q.level !== "unhinged" || !!meta?.settings?.adult);
// average stars -> points
export const questPoints = avg => Math.round((avg ?? 0) * PPS);

// ---------------------------------------------------------------- the wizard
// a 16x18 pixel fortune teller, hood and beard; the crystal ball is a
// separate element in front of his hands so it can swirl
const WIZ = [
  ".......kk.......",
  "......kpyk......",
  "......kppk......",
  ".....kpppdk.....",
  ".....kpyppk.....",
  "....kpppppdk....",
  "....kppppydk....",
  "..kkkkkkkkkkkk..",
  "....kssssssk....",
  "....ksesseskk...",
  "....kwsssswk....",
  "...kwwwwwwwwk...",
  "..kpwwwwwwwwpk..",
  "..kppwwwwwwppk..",
  ".kpppwwwwwwpppk.",
  ".kpphhpwwphhpdk.",
  ".kppppppppppddk.",
  "kkkkkkkkkkkkkkkk",
];
const WIZ_COL = { k: "#140c22", p: "#6b3fd6", d: "#4a2a9e", y: "#ffd23f", s: "#f2c29b", e: "#140c22", w: "#f2f4ff", h: "#f2c29b" };
const WIZ_SVG = (() => {
  let r = "";
  WIZ.forEach((row, y) => [...row].forEach((ch, x) => { if (WIZ_COL[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${WIZ_COL[ch]}"/>`; }));
  return `<svg class="sq-wiz-art" viewBox="0 0 16 18" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
})();
const wizardHtml = (inBall = "", cls = "") => `<div class="sq-wizard ${cls}">
    ${WIZ_SVG}
    <div class="sq-ball"><div class="sq-swirl"></div><div class="sq-in">${inBall}</div><i class="sq-shine"></i></div>
    <div class="sq-stand"></div>
  </div>`;
const cardHtml = (q, cls = "") => `<div class="sq-card ${cls}"><div class="sq-kicker">SIDE QUEST:</div><div class="sq-text">${esc(q?.text ?? "…")}</div>${q?.level && q.level !== "mild" ? `<em class="sq-lv ${esc(q.level)}">${esc(q.level)}</em>` : ""}</div>`;
const starsHtml = (fill, cls = "") => `<div class="sq-stars ${cls}" style="--fill:${Math.max(0, Math.min(1, fill)) * 100}%"><span class="sq-st-bg">${"★".repeat(STARS)}</span><span class="sq-st-fg">${"★".repeat(STARS)}</span></div>`;

export const SIDE_QUEST = {
  id: "sidequest", title: "Side Quest",
  blurb: "the wizard hands out a real-life dare. one player has 3 minutes to do it — everyone films and rates how hard they committed.",
  minPlayers: 3, maxPlayers: 12, length: "~4 min per turn",
  describe: meta => (meta?.settings?.adult ? "unhinged quests on" : ""),

  start(ctx) {
    if (!POOL) { ui.show(); ui.stage("Side Quest", `<p class="ab-sub">consulting the spirits…</p>`, "loading"); poolReady.then(() => this._start(ctx)); return; }
    this._start(ctx);
  },

  _start(ctx) {
    ui.show(); ui.theme("chaos");
    const room = ctx.room;
    const meta = ctx.party ?? {};
    const AVAIL = questsFor(POOL, meta);
    const cats = CATS.filter(c => AVAIL.some(q => q.category === c.id));
    let lastHud = 0, lastTurn = null, myVote = null, giveUpArmed = 0, openCats = new Set(), spinTok = 0, dlg = null;
    trash.add(() => { myVote = null; dlg?.close(); dlg = null; });

    const turn = s => s.turn ?? null;
    const isMe = s => turn(s)?.who === ctx.me.id;
    const voters = s => active(s).filter(p => p.id !== turn(s)?.who);
    const avatarOf = id => room.members.find(m => m.id === id)?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? {};

    const rounds = new Rounds([
      { name: "setup", ms: SETUP_MS, done: s => !!s.setup.go, next: s => { begin(s); return "wizard"; } },
      { name: "wizard", ms: WIZARD_MS, enter: s => deal(s), next: () => "quest" },
      { name: "quest", ms: QUEST_MS, next: () => "spin" },
      { name: "spin", ms: SPIN_MS, next: () => "do" },
      {
        name: "do", ms: SIDEQUEST.DO_MS,
        done: s => !!turn(s)?.status,
        next: s => (turn(s)?.status === "gaveup" ? (tally(s), "result") : (turn(s).status ??= "timeup", "vote")),
      },
      {
        name: "vote", ms: SIDEQUEST.VOTE_MS,
        done: s => voters(s).every(p => turn(s)?.votes[p.id] !== undefined),
        next: s => { tally(s); return "result"; },
      },
      { name: "result", ms: RESULT_MS, next: s => (s.ti + 1 < s.turns ? (s.ti++, "wizard") : "end") },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "wizard") sfx.open();
        if (name === "quest") sfx.whoosh();
        if (name === "do") { sfx.now(); buzz([30, 40, 30]); }
        if (name === "vote") sfx.tick();
        if (name === "result") sfx.pop();
        if (name === "end") sfx.win();
      },
    });

    const seat = (id, handle, isBot, avatar = null) => ({ id, handle, isBot, score: 0, gone: false, ...(isBot && avatar ? { avatar } : {}) });

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true, b.avatar);
        s.setup = { off: [], turns: null, go: false };
        s.weights = {}; s.deck = []; s.used = []; s.ti = 0; s.turns = 0; s.turn = null;
        rounds.enter(s, "setup");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const t = turn(s);
        // the player on the quest left: skip the turn, nobody scores it
        if (t && s.players[t.who]?.gone && ["wizard", "quest", "spin", "do"].includes(s.phase)) {
          t.skipped = true; t.pts = 0;
          rounds.enter(s, "result");
          return;
        }
        if (t && s.phase === "do" && s.players[t.who]?.isBot && !t.status && game.rng() < dt * 0.1) {
          t.status = game.rng() < 0.2 ? "gaveup" : "done";
          t.doneAt = Date.now();
        }
        if (t && s.phase === "vote")
          for (const p of voters(s))
            if (p.isBot && t.votes[p.id] === undefined && game.rng() < dt * 0.6) t.votes[p.id] = 2 + Math.floor(game.rng() * 4);
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        const fromHost = m.from === room.hostId;
        if (m.in === "skip" && fromHost) { s.left = 0; return; }
        if (s.phase === "setup" && fromHost) {
          const off = new Set(s.setup.off);
          if (m.in === "sq-q" && AVAIL.some(q => q.id === m.id)) { if (m.on) off.delete(m.id); else off.add(m.id); }
          if (m.in === "sq-cat") for (const q of AVAIL) if (q.category === m.cat) { if (m.on) off.delete(q.id); else off.add(q.id); }
          if (m.in === "sq-all") { if (m.on) off.clear(); }
          s.setup.off = [...off];
          if (m.in === "sq-turns") { const n = Math.round(Number(m.n)); if (Number.isFinite(n)) s.setup.turns = Math.max(1, Math.min(SIDEQUEST.MAX_TURNS, n)); }
          if (m.in === "sq-go" && enabled(s).length) s.setup.go = true;
          return;
        }
        const t = turn(s), p = s.players[m.from];
        if (!t || !p) return;
        if ((m.in === "done" || m.in === "giveup") && s.phase === "do" && m.from === t.who && !t.status) {
          t.status = m.in === "done" ? "done" : "gaveup";
          t.doneAt = Date.now();
        }
        if (m.in === "rate" && s.phase === "vote" && m.from !== t.who) {
          const v = Math.round(Number(m.v));
          if (v >= 1 && v <= STARS) t.votes[p.id] = v;
        }
      },
      render(s) { renderSQ(s); },
      onEvent() {},
    }, { hz: 4 });

    const enabled = s => { const off = new Set(s.setup.off); return AVAIL.filter(q => !off.has(q.id)); };

    // setup's done: lock in the deck and the number of turns
    function begin(s) {
      let qs = enabled(s);
      if (!qs.length) qs = AVAIL;
      s.deck = shuffle(game.rng, qs.map(q => q.id));
      s.turns = s.setup.turns ?? Math.max(1, active(s).length);
      s.ti = 0;
    }
    // a new turn: the next quest off the deck, and the fair pick of who does it
    function deal(s) {
      if (!s.deck.length) s.deck = shuffle(game.rng, (enabled(s).length ? enabled(s) : AVAIL).map(q => q.id));
      const qid = s.deck.shift();
      const q = AVAIL.find(x => x.id === qid) ?? AVAIL[0];
      const { id, weights } = fairPick(s.weights, active(s).map(p => p.id), game.rng);
      s.weights = weights;
      s.used.push(q.id);
      s.turn = { no: s.ti + 1, quest: { id: q.id, text: q.text, category: q.category, level: q.level }, who: id, status: null, doneAt: 0, votes: {}, avg: null, n: 0, pts: 0, skipped: false };
    }
    // the stars -> points; giving up is 0 and nobody votes
    function tally(s) {
      const t = turn(s);
      if (!t) return;
      if (t.status === "gaveup") { t.avg = 0; t.n = 0; t.pts = 0; }
      else {
        const vs = Object.values(t.votes).filter(v => Number.isFinite(v));
        t.n = vs.length;
        t.avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
        t.pts = questPoints(t.avg);
      }
      const p = s.players[t.who];
      if (p) p.score += t.pts;
    }

    // ---- the face reel: flick through everyone, slow down, land on `target`
    function spin(el, ids, target, elapsed) {
      const tok = ++spinTok;
      if (!el || !ids.length) return;
      const faces = new Map(ids.map(id => { const f = spriteFace(avatarOf(id), 3); f.dataset.id = id; return [id, f]; }));
      el.replaceChildren(...faces.values());
      const show = id => { for (const [k, f] of faces) f.hidden = k !== id; };
      // the schedule: steps that get slower, ending exactly on the target
      const steps = [];
      let t = 0, d = 60, i = Math.floor(Math.random() * ids.length);
      while (t + d < SPIN_LAND_MS) { steps.push([t, ids[i++ % ids.length]]); t += d; d *= 1.16; }
      steps.push([SPIN_LAND_MS, target]);
      const landed = () => { el.closest(".sq-wizard")?.classList.add("landed"); $("sq-who")?.classList.add("on"); };
      if (elapsed >= SPIN_LAND_MS) { show(target); landed(); return; }
      for (const [at, id] of steps) {
        if (at < elapsed) continue;
        setTimeout(() => {
          if (tok !== spinTok) return;
          show(id);
          if (id === target && at === SPIN_LAND_MS) { landed(); sfx.chime(); if (target === ctx.me.id) buzz([60, 40, 120]); }
          else sfx.cursor();
        }, at - elapsed);
      }
      show(steps.find(([at]) => at >= elapsed)?.[1] ?? target);
    }

    // ---- render ----
    function renderSQ(s) {
      // per-turn local state resets on every phone, keyed off the state
      const tk = `${s.ti}:${s.phase}`;
      if (tk !== lastTurn) { lastTurn = tk; if (s.phase !== "vote") myVote = null; giveUpArmed = 0; if (s.phase !== "wizard") { dlg?.close(); dlg = null; } }
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const t = turn(s), who = s.players?.[t?.who]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : s.phase === "setup" ? "setup" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || "?"}`;
      ui.hud(`<div class="hq"><b>SIDE QUEST</b><span>${step}</span><span class="clk ${s.left < 10000 && !["end", "setup"].includes(s.phase) ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);

      if (s.phase === "setup") {
        const isHost = ctx.isHost();
        const off = new Set(s.setup?.off ?? []);
        const n = active(s).length, turns = s.setup?.turns ?? n;
        if (!ui.once(`su:${isHost ? 1 : 0}:${[...off].sort().join(",")}:${turns}:${[...openCats].join(",")}:${n}`, () => {})) return;
        if (!isHost) {
          ui.stage("Side Quest", wizardHtml("", "idle") + `<p class="ab-sub">the host is choosing tonight's quests…</p>`, "the wizard awaits");
          return;
        }
        const on = AVAIL.filter(q => !off.has(q.id)).length;
        ui.stage("choose the quests", `
          <div class="sq-setup">
            <button type="button" class="pt-btn pt-primary sq-go" id="sq-go" ${on ? "" : "disabled"}>start · ${on} quest${on === 1 ? "" : "s"}</button>
            <div class="sq-turns"><span>turns</span>
              <button type="button" class="sq-step" data-turns="${turns - 1}" ${turns <= 1 ? "disabled" : ""}>−</button>
              <b>${turns}</b>
              <button type="button" class="sq-step" data-turns="${turns + 1}" ${turns >= SIDEQUEST.MAX_TURNS ? "disabled" : ""}>+</button>
              <small>${s.setup?.turns == null || turns === n ? "everyone once" : `${n} players`}</small></div>
            ${cats.map(c => {
              const qs = AVAIL.filter(q => q.category === c.id), k = qs.filter(q => !off.has(q.id)).length, open = openCats.has(c.id);
              return `<section class="sq-cat ${k ? "" : "off"}">
                <header><button type="button" class="sq-chk ${k === qs.length ? "on" : k ? "some" : ""}" data-cat="${esc(c.id)}" aria-label="all ${esc(c.label)} quests"></button>
                  <button type="button" class="sq-cat-name" data-open="${esc(c.id)}"><b>${esc(c.label)}</b><small>${k}/${qs.length} · ${esc(c.hint ?? "")}</small><i>${open ? "▴" : "▾"}</i></button></header>
                ${open ? `<ul>${qs.map(q => `<li><button type="button" class="sq-q ${off.has(q.id) ? "" : "on"}" data-q="${esc(q.id)}"><i class="sq-chk-s"></i><span>${esc(q.text)}</span>${q.level !== "mild" ? `<em class="sq-lv ${esc(q.level)}">${esc(q.level)}</em>` : ""}</button></li>`).join("")}</ul>` : ""}
              </section>`;
            }).join("")}
            ${meta?.settings?.adult ? "" : `<p class="ab-sub">unhinged quests appear when the party allows 18+</p>`}
          </div>`, "the wizard's book");
        const panel = $("game-panel");
        $("sq-go").onclick = () => { sfx.confirm(); game.input("sq-go"); };
        panel.querySelectorAll("[data-turns]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("sq-turns", { n: +b.dataset.turns }); });
        panel.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("sq-cat", { cat: b.dataset.cat, on: !b.classList.contains("on") }); });
        panel.querySelectorAll("[data-open]").forEach(b => b.onclick = () => { const id = b.dataset.open; if (openCats.has(id)) openCats.delete(id); else openCats.add(id); sfx.cursor(); ui.resetKey(); });
        panel.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("sq-q", { id: b.dataset.q, on: !b.classList.contains("on") }); });
        return;
      }

      if (s.phase === "wizard") {
        if (!ui.once(`w:${s.ti}`, () => {})) return;
        ui.stage("", wizardHtml("", "glow") + `<div class="sq-dlg-host" id="sq-dlg"></div>${hostSkip(ctx)}`, `turn ${t?.no ?? ""}`);
        dlg?.close();
        dlg = typeDialog($("sq-dlg"), { name: "WIZARD", text: WIZARD_LINE, blip: () => sfx.blip(), sticky: true, cls: "sq-dlg" });
        bindHostSkip(game);

      } else if (s.phase === "quest") {
        if (!ui.once(`q:${s.ti}`, () => {})) return;
        const elapsed = QUEST_MS - s.left;
        ui.stage("", wizardHtml("", "swirl") + `<div class="sq-card-slot" id="sq-slot"></div>${hostSkip(ctx)}`, `turn ${t?.no ?? ""}`);
        const put = () => { const el = $("sq-slot"); if (el && !el.firstChild) { el.innerHTML = cardHtml(t.quest, "pop"); sfx.ping(); } };
        if (elapsed >= SWIRL_MS) put(); else setTimeout(put, SWIRL_MS - elapsed);
        bindHostSkip(game);

      } else if (s.phase === "spin") {
        if (!ui.once(`s:${s.ti}`, () => {})) return;
        ui.stage("", cardHtml(t.quest, "small") + wizardHtml(`<div class="sq-reel" id="sq-reel"></div>`, "spin")
          + `<div class="sq-who" id="sq-who">${isMe(s) ? "it's YOU!" : `${esc(who)}!`}</div>${hostSkip(ctx)}`, "who's it going to be…");
        const ids = P.filter(p => !p.gone).map(p => p.id);
        spin($("sq-reel"), ids.length ? ids : [t.who], t.who, SPIN_MS - s.left);
        bindHostSkip(game);

      } else if (s.phase === "do") {
        const mine = isMe(s);
        if (ui.once(`d:${s.ti}:${t.status ?? "-"}:${mine ? 1 : 0}:${giveUpArmed ? 1 : 0}`, () => {})) {
          if (mine) {
            ui.stage(t.status ? "nice. hold on…" : "go. now.", cardHtml(t.quest) + `<div class="sq-clock" id="sq-clock">${ui.clock(s.left)}</div>`
              + (t.status ? `<p class="ab-sub">the room is about to rate you</p>` : `<div class="sq-btns">
                  <button type="button" class="sq-giveup ${giveUpArmed ? "armed" : ""}" id="sq-giveup">${giveUpArmed ? "tap again to give up" : "give up"}</button>
                  <button type="button" class="pt-btn pt-primary sq-done" id="sq-done">done ✓</button></div>
                  <p class="ab-sub">your friends are filming · give up = 0 points</p>`)
              + hostSkip(ctx), "your side quest");
            const d = $("sq-done"); if (d) d.onclick = () => { game.input("done"); sfx.confirm(); buzz(40); };
            const g = $("sq-giveup");
            if (g) g.onclick = () => {
              if (giveUpArmed && performance.now() - giveUpArmed < 3500) { game.input("giveup"); sfx.back(); giveUpArmed = 0; return; }
              giveUpArmed = performance.now(); ui.resetKey();
              setTimeout(() => { if (giveUpArmed && performance.now() - giveUpArmed >= 3400) { giveUpArmed = 0; ui.resetKey(); } }, 3500);
            };
          } else {
            ui.stage(`${esc(who)} is on a side quest`, cardHtml(t.quest) + `<div class="sq-clock" id="sq-clock">${ui.clock(s.left)}</div>
              <p class="sq-film">● REC — film it on your phone</p>
              <p class="ab-sub">${t.status === "done" ? `${esc(who)} says they did it` : t.status === "gaveup" ? `${esc(who)} gave up` : "you'll rate how hard they committed"}</p>${hostSkip(ctx)}`, "watch · film · judge");
          }
          bindHostSkip(game);
        }
        // the big timer ticks in place (rebuilding would eat taps)
        const c = $("sq-clock");
        if (c) { c.textContent = ui.clock(s.left); c.classList.toggle("urgent", s.left < 30000); }

      } else if (s.phase === "vote") {
        const mine = isMe(s);
        const held = t.votes[ctx.me.id] ?? myVote;
        if (ui.once(`v:${s.ti}:${mine ? 1 : 0}:${held ?? "-"}`, () => {})) {
          if (mine) {
            ui.stage("the room is rating you", cardHtml(t.quest, "small") + `<p class="ab-sub"><b id="sq-vcount"></b> · nothing you can do now</p>${hostSkip(ctx)}`, "the verdict");
          } else {
            ui.stage(`how hard did ${esc(who)} commit?`, cardHtml(t.quest, "small") + `<div class="sq-rate">${Array.from({ length: STARS }, (_, i) =>
                `<button type="button" class="sq-star ${held && i < held ? "on" : ""}" data-star="${i + 1}" aria-label="${i + 1} star${i ? "s" : ""}">★</button>`).join("")}</div>
              <p class="sq-rate-lbl">${held ? ["barely", "a little", "decent", "properly", "FULL SEND"][held - 1] : "tap the stars"}</p>
              <p class="ab-sub"><b id="sq-vcount"></b>${held ? " · tap again to change" : ""}</p>${hostSkip(ctx)}`, `rate · ${ui.clock(s.left)}`);
            $("game-panel").querySelectorAll("[data-star]").forEach(b => b.onclick = () => {
              myVote = +b.dataset.star; game.input("rate", { v: myVote }); sfx.pop(); ui.resetKey();
            });
          }
          bindHostSkip(game);
        }
        const vc = $("sq-vcount");
        if (vc) vc.textContent = `${Object.keys(t.votes).length}/${voters(s).length} rated`;

      } else if (s.phase === "result") {
        if (!ui.once(`r:${s.ti}`, () => {})) return;
        const board = P.slice().sort((a, b) => b.score - a.score).map(p => `<li class="${p.id === t.who ? "me" : ""}"><b>${esc(p.handle)}</b><span>${p.score}</span></li>`).join("");
        if (t.skipped) {
          ui.stage(`${esc(who)} left`, cardHtml(t.quest, "small") + `<p class="ab-sub">nobody scores this one</p><ol class="sq-board">${board}</ol>${hostSkip(ctx)}`, "no verdict");
        } else if (t.status === "gaveup") {
          ui.stage(`${esc(who)} gave up`, cardHtml(t.quest, "small") + `<div class="sq-stamp">GAVE UP</div>${starsHtml(0)}<div class="mh-big">+0</div>
            <ol class="sq-board">${board}</ol>${hostSkip(ctx)}`, "the verdict");
        } else {
          const avg = Math.round((t.avg ?? 0) * 10) / 10;
          ui.stage(`${esc(who)}`, cardHtml(t.quest, "small") + `${starsHtml(0, "fill")}
            <div class="sq-avg"><b id="sq-avg">0.0</b><span>/ ${STARS}</span></div>
            <div class="mh-big sq-pts" id="sq-pts">+${t.pts}</div>
            <p class="ab-sub">${t.n ? `average of ${t.n} rating${t.n === 1 ? "" : "s"} × ${PPS}` : "nobody rated it"}</p>
            <ol class="sq-board">${board}</ol>${hostSkip(ctx)}`, "the verdict");
          // the dramatic bit: the stars fill to the average, the number counts up
          const st = $("game-panel").querySelector(".sq-stars.fill"), av = $("sq-avg");
          requestAnimationFrame(() => requestAnimationFrame(() => { if (st) st.style.setProperty("--fill", `${(t.avg ?? 0) / STARS * 100}%`); }));
          const t0 = performance.now();
          const up = n => { const k = Math.min(1, (n - t0) / 1600); if (av) av.textContent = (avg * k).toFixed(1); if (k < 1) requestAnimationFrame(up); else { $("sq-pts")?.classList.add("on"); if (t.pts) sfx.chime(); } };
          requestAnimationFrame(up);
        }
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        showResults(P, { title: "Side Quest", sub: "final scores", note: `average stars × ${PPS} per quest · give up = 0` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    trash.add(() => { spinTok++; game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "setup", left: SETUP_MS, players: {}, setup: { off: [], turns: null, go: false }, weights: {}, deck: [], used: [], ti: 0, turns: 0, turn: null });
    const o = ctx.onEnd;
    ctx.onEnd = r => { spinTok++; dlg?.close(); game.stop(); ui.hide(); o(r); };
  },
};
