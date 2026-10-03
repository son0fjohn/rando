// Bot specs: one real player plus ?bots=3, the way you'd test alone on the
// live site. The page is loaded as /test/hpbots.html?bots=3 so every game
// module reads BOTS_N = 3 exactly as it would in the browser.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY } from "/web/hpgames/secretdiary.js";
import { TODAYS_MISSION } from "/web/hpgames/mission.js";
import { HUMILIATION_RITUAL } from "/web/hpgames/ritual.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { DIARY } from "/web/hpconfig.js";

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (cls, msg) => { const s = document.createElement("span"); s.className = cls; s.textContent = (cls === "head" ? "" : cls === "pass" ? "  ✓ " : "  ✗ ") + msg + "\n"; out.appendChild(s); };
const ok = (c, m) => { if (c) { pass++; log("pass", m); } else { fail++; log("fail", m); } };
const group = n => log("head", "\n" + n);

const clock = installClock();
const adv = ms => clock.advance(ms, 200);
const ME = "me";
const bots = s => Object.values(s.players).filter(p => p.isBot);

ok(new URLSearchParams(location.search).get("bots") === "3", "page loaded with ?bots=3");

// ===================================================================== 1
group("Secret Diary — you + 3 bots");
{
  const t = seatTable(SECRET_DIARY, 1, { ids: [ME] });
  adv(500);
  ok(bots(t.s).length === 3, "three bots take seats");
  for (let pi = 0; pi < DIARY.PROMPTS; pi++) t.input(ME, "write", { pi, text: `my secret ${pi}` });
  let guard = 0;
  while (t.s.phase === "write" && guard++ < 3000) adv(200);
  ok(t.s.entries.length === 4 * DIARY.PROMPTS, `bots answer every prompt too (${t.s.entries.length} in the pool)`);
  while (t.s.phase !== "match" && guard++ < 6000) adv(200);
  // match every entry to the right author, so the human score is checkable
  const author = eid => Object.values(t.s.players).find(p => Object.values(p.mine).includes(eid))?.id;
  for (const e of t.s.entries.filter(e => !Object.values(t.s.players[ME].mine).includes(e.eid))) t.input(ME, "guess", { eid: e.eid, who: author(e.eid) });
  while (t.s.phase !== "end" && guard++ < 9000) adv(200);
  ok(t.s.phase === "end", "bots finish matching and the round ends");
  ok(t.s.players[ME].score === 3 * DIARY.PROMPTS, `your all-correct matching scores ${3 * DIARY.PROMPTS} (got ${t.s.players[ME].score})`);
  ok(bots(t.s).every(b => Object.keys(b.guesses).length > 0), "every bot made guesses");
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 2
group("Today's Mission — you + 3 bots");
{
  const t = seatTable(TODAYS_MISSION, 1, { ids: [ME] });
  adv(500);
  ok(t.s.order.length === 4, "you and the bots all get a mission");
  let guard = 0, botJudged = 0, myJudged = false;
  while (t.s.phase !== "end" && guard++ < 20000) {
    const cur = t.s.order[t.s.mi];
    if (t.s.phase === "do" && cur === ME && !t.s.missions[ME].claimed) t.input(ME, "claim");
    // you rate every bot's mission a 9
    if (t.s.phase === "vote" && cur !== ME && t.s.missions[cur].ratings[ME] === undefined) t.input(ME, "rate", { v: 9 });
    if (t.s.phase === "result") {
      if (cur === ME) myJudged = true;
      else if (t.s.missions[cur].n > 0) botJudged++;
    }
    adv(200);
  }
  ok(t.s.phase === "end", "all four missions play out");
  ok(myJudged && t.s.missions[ME].n === 3, `the bots rated your mission (${t.s.missions[ME].n}/3 ratings)`);
  ok(t.s.missions[ME].pts > 0, `bot ratings turn into points (${t.s.missions[ME].pts})`);
  ok(botJudged > 0, "bot missions get rated");
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 3
group("Humiliation Ritual — you + 3 bots");
{
  const t = seatTable(HUMILIATION_RITUAL, 1, { ids: [ME] });
  adv(500);
  ok(t.s.order.length === 4, "you and the bots all take a turn performing");
  let guard = 0, guessedThisTurn = -1;
  const outcomes = [];
  while (t.s.phase !== "end" && guard++ < 20000) {
    const r = t.s.rounds[t.s.ri];
    if (t.s.phase === "act") {
      if (r.performer === ME) {
        // you're performing: hands off — bots' correct typed guesses win on their own
      } else if (guessedThisTurn !== t.s.ri) {
        // a bot is performing: you guess its answer once
        t.input(ME, "guess", { text: r.answer });
        guessedThisTurn = t.s.ri;
      }
    }
    if (t.s.phase === "result" && outcomes.length === t.s.ri) outcomes.push({ perf: r.performer, won: r.won?.by ?? null });
    adv(200);
  }
  ok(t.s.phase === "end", "all four turns play out");
  const botTurns = outcomes.filter(o => o.perf !== ME);
  ok(botTurns.length === 3 && botTurns.every(o => o.won === ME), "your typed answer wins a bot's turn automatically");
  const mine = outcomes.find(o => o.perf === ME);
  ok(mine && mine.won && mine.won !== ME, "on your turn a bot's correct guess wins without you touching the phone");
  ok(t.s.players[ME].score > 0, `you scored (${t.s.players[ME].score})`);
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 4
group("The Art Gallery — you + 3 bots");
{
  const t = seatTable(ART_GALLERY, 1, { ids: [ME] });
  adv(500);
  for (let i = 0; i < 3; i++) t.input(ME, "photo", { pid: `me-${i}` });
  let guard = 0;
  while (t.s.phase === "photos" && guard++ < 2000) adv(200);
  ok(Object.keys(t.s.pool).length === 12, `bots add their 3 photos each (${Object.keys(t.s.pool).length} in the pool)`);
  ok(t.s.phase === "title", "titling opens");
  for (const pid of t.s.players[ME].assigned) t.input(ME, "title", { pid, text: "my title" });
  while (t.s.phase === "title" && guard++ < 4000) adv(200);
  ok(t.s.phase === "gallery" && t.s.frames.length > 0, `bots title theirs and the gallery opens (${t.s.frames.length} frames)`);
  while (t.s.phase !== "end" && guard++ < 20000) {
    const f = t.s.frames[t.s.fi];
    if (t.s.sub === "reveal" && f && !f.titles.some(x => x.by === ME) && f.votes[ME] === undefined) t.input(ME, "vote", { idx: 0 });
    adv(200);
  }
  ok(t.s.phase === "end", "every frame is unveiled and voted on");
  ok(t.s.frames.every(f => (f.counts?.[0] ?? 0) + (f.counts?.[1] ?? 0) > 0), "every frame got votes");
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

log("head", `\n${pass} passed, ${fail} failed`);
window.__done = { pass, fail };
