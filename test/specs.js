// House-party specs. Plays every game end to end on the fake bus + virtual
// clock and asserts the rules the brief actually names.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY, diaryPool, maxLevelFor, capAt, yesnoTarget, countLine } from "/web/hpgames/secretdiary.js";
import * as CONFIG from "/web/hpconfig.js";
import { promptLog } from "/web/hplog.js";
import { TODAYS_MISSION } from "/web/hpgames/mission.js";
import { HUMILIATION_RITUAL, judge } from "/web/hpgames/ritual.js";
import { MANHUNT_GAME } from "/web/hpgames/manhunt.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { MANHUNT, DIARY, MISSION } from "/web/hpconfig.js";
import { resultsHtml, trash, Rounds } from "/web/hpkit.js";

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (cls, msg) => { const s = document.createElement("span"); s.className = cls; s.textContent = (cls === "head" ? "" : cls === "pass" ? "  ✓ " : "  ✗ ") + msg + "\n"; out.appendChild(s); };
const ok = (cond, msg) => { if (cond) { pass++; log("pass", msg); } else { fail++; log("fail", msg); } };
const group = name => log("head", "\n" + name);

// the diary's prompt pool is fetched at import; have it before any clock tricks
const POOL = await diaryPool();
const clock = installClock();
// HostGame caps dt at 0.25 s per tick, so advancing in slices bigger than that
// makes game time run SLOWER than virtual time. Every advance here uses 200 ms
// slices so game time and virtual time stay 1:1.
const STEP = 200;
const adv = ms => clock.advance(ms, STEP);
// run a game to completion: advance until everyone's onEnd fired, bounded
function runOut(t, maxMs = 25 * 60 * 1000) {
  let spent = 0;
  while (!t.allEnded() && spent < maxMs) { adv(2000); spent += 2000; }
  return t.allEnded();
}
// advance until the host state reaches `phase` (or give up)
function waitPhase(t, phase, maxMs = 5 * 60 * 1000) {
  let spent = 0;
  while (t.s?.phase !== phase && spent < maxMs) { adv(STEP); spent += STEP; }
  return t.s?.phase === phase;
}

// ===================================================================== 1
// The exact list the brief supplied (type, level, text). The pool must be
// this and nothing else.
const SUPPLIED = [
  ["written", "mild", "My first impression of"],
  ["written", "mild", "The person here I'd want with me in a zombie apocalypse, and who I'd leave behind"],
  ["written", "mild", "If I were trapped on an island for 30 years, who am I bringing with me"],
  ["written", "mild", "The person you noticed first tonight"],
  ["written", "mild", "The number of people here you could beat in a fight"],
  ["written", "mild", "Who here would you eat first in a survival situation?"],
  ["written", "mild", "Your most embarrassing childhood crush?"],
  ["written", "mild", "How would your high school classmates describe you back in high school?"],
  ["written", "mild", "The weirdest thing I've searched this month"],
  ["written", "mild", "An unpopular opinion I'd defend to the death"],
  ["written", "mild", "Who here could I trust hiding a body with?"],
  ["written", "mild", "The worst thing you've done in school?"],
  ["written", "mild", "Weirdest thing I've talked to ChatGPT about?"],
  ["written", "mild", "Longest ongoing internet/celebrity crush?"],
  ["written", "mild", "Most cringe thing you've done"],
  ["written", "mild", "Who here looks like they peaked in high school"],
  ["written", "mild", "Who here would be a cult leader"],
  ["written", "mild", "Who here would get scammed first"],
  ["written", "mild", "Who here would snitch first?"],
  ["written", "mild", "Whose outfit would you swap with here?"],
  ["written", "mild", "Who would you room with here?"],
  ["written", "mild", "Who do you think showered the least amount of times this month?"],
  ["written", "mild", "Who here is the greatest green flag?"],
  ["written", "mild", "Person you'd most let date a sibling?"],
  ["written", "mild", "What's your favorite word?"],
  ["written", "mild", "What's your snap score?"],
  ["written", "mild", "What celebrity would you make the president?"],
  ["written", "mild", "Who is the most attractive athlete?"],
  ["written", "spicy", "Person here I have to kiss if I had to"],
  ["written", "spicy", "Most unethical thing you've done"],
  ["written", "spicy", "Most downbad thing you've done"],
  ["written", "spicy", "The most illegal thing you've done"],
  ["written", "spicy", "Craziest thing I've done drunk"],
  ["written", "spicy", "What are you secretly into?"],
  ["written", "spicy", "Your biggest regret?"],
  ["written", "spicy", "The most questionable person you've ever kissed?"],
  ["written", "spicy", "Most delusional I've been about someone"],
  ["written", "spicy", "The most recent person I've stalked on IG"],
  ["written", "spicy", "Worst reason someone rejected/broke up with me"],
  ["written", "spicy", "Whose parents here do you think you would want to date?"],
  ["written", "spicy", "Who here would I bring home to meet my parents?"],
  ["written", "spicy", "Who here would I not bring home to meet my parents?"],
  ["written", "spicy", "What's your greatest red flag?"],
  ["written", "spicy", "Who here is the greatest red flag?"],
  ["written", "spicy", "The most disappointing thing I've done to my parents?"],
  ["written", "spicy", "Person you'd least let date a sibling?"],
  ["written", "spicy", "A memory you'd like to erase from your head?"],
  ["written", "unhinged", "The most toxic thing you've done in a relationship"],
  ["written", "unhinged", "The worst thing I've done out of jealousy"],
  ["written", "unhinged", "Who here looks like they have daddy issues?"],
  ["written", "unhinged", "Who here looks like they have mommy issues?"],
  ["written", "unhinged", "Who here do you think has shot their shot with the most amount of people?"],
  ["written", "unhinged", "What is the most disturbing thought you've had"],
  ["yesno", "mild", "I've gone over 3 days without showering before"],
  ["yesno", "spicy", "I've been on a date in the last month"],
  ["yesno", "spicy", "Have asked for someone you just met's number before?"],
  ["yesno", "spicy", "Have you been ghosted in the last month"],
  ["yesno", "spicy", "Have you ghosted someone in the last month?"],
  ["yesno", "spicy", "Have you had a secret crush this month?"],
  ["yesno", "spicy", "I've slid into someone's DMs this month"],
  ["yesno", "spicy", "I've looked at my ex's photos this year"],
  ["yesno", "spicy", "I've kissed someone I just met"],
  ["yesno", "spicy", "Have you had a crush on someone in this room?"],
  ["yesno", "spicy", "Made out with someone in the last week?"],
  ["yesno", "spicy", "Have you ever drunk texted an ex?"],
  ["yesno", "spicy", "Have you gotten back with an ex?"],
  ["yesno", "unhinged", "Have dated someone just because you were lonely?"],
  ["yesno", "unhinged", "Have cheated before?"],
  ["yesno", "unhinged", "Have you lied about being single?"],
  ["yesno", "unhinged", "Have you made a fake account to stalk someone?"],
  ["yesno", "unhinged", "I've been the side piece"],
];

// Secret Diary helpers
const SD_IDS = t => t.clients.map(c => c.me.id);
const lvRank = c => DIARY.LEVELS.indexOf(c.level);
const escalates = b => b.every((c, i) => !i || lvRank(b[i - 1]) <= lvRank(c));
const ynCount = b => b.filter(c => c.type === "yesno").length;
// every listed player answers every question (skip(id, k) -> true leaves it blank)
function answerAll(t, who, { skip = () => false, yes = id => id === "p1" || id === "p2" } = {}) {
  for (const id of who) t.s.batch.forEach((c, k) => {
    if (skip(id, k)) return;
    t.input(id, "ans", c.type === "written" ? { k, text: `${id} wrote q${k}` } : { k, yn: yes(id) ? "yes" : "no" });
  });
}
// advance until the reveal moves past question k (or the game ends)
function pastQuestion(t, k, maxMs) {
  let spent = 0;
  while (t.s.phase === "reveal" && t.s.qi === k && spent < maxMs) { adv(STEP); spent += STEP; }
  return !(t.s.phase === "reveal" && t.s.qi === k);
}
// everyone locks in on every question, with no guesses, until the end
function lockThrough(t, who) {
  let g = 0;
  while (t.s.phase === "reveal" && g++ < 40) { const k = t.s.qi; who.forEach(id => t.input(id, "lock")); pastQuestion(t, k, 5000); }
  return t.s.phase === "end";
}

group("Secret Diary — the prompt pool is exactly the supplied list");
{
  ok(POOL.length === SUPPLIED.length && SUPPLIED.length === 71, `the pool is exactly the ${SUPPLIED.length} supplied prompts (got ${POOL.length})`);
  const key = (t, l, x) => `${t}|${l}|${x}`;
  const have = new Set(POOL.map(p => key(p.type, p.level, p.text)));
  const want = new Set(SUPPLIED.map(s => key(...s)));
  ok(SUPPLIED.every(s => have.has(key(...s))), "every supplied prompt is in the pool, with its type and level");
  ok(POOL.every(p => want.has(key(p.type, p.level, p.text))), "nothing else is in the pool — every old/placeholder prompt is gone");
  ok(new Set(POOL.map(p => p.id)).size === POOL.length, "every prompt has a unique id");
  ok(POOL.every(p => p.id.startsWith(`${p.type === "written" ? "w" : "yn"}-${p.level}-`)), "every id names its type and level");
  const by = (t, l) => POOL.filter(p => p.type === t && p.level === l).length;
  ok(by("written", "mild") === 28 && by("written", "spicy") === 19 && by("written", "unhinged") === 6, "written: 28 mild, 19 spicy, 6 unhinged");
  ok(by("yesno", "mild") === 1 && by("yesno", "spicy") === 12 && by("yesno", "unhinged") === 5, "yes/no: 1 mild, 12 spicy, 5 unhinged");
  const raw = await (await fetch("/web/data/diary_prompts.json")).json();
  ok(Array.isArray(raw._retired) && raw._retired.every(id => !POOL.some(p => p.id === id)), `retired ids stay retired (${(raw._retired ?? []).join(", ")})`);
  ok(!("DIARY_PROMPTS" in CONFIG) && !("DIARY_BOT_ENTRIES" in CONFIG), "the old placeholder pool and its filler are gone from the config");
  ok(!("ROUNDS" in DIARY) && !("PREVIEW_MS" in DIARY), "the one-question-at-a-time settings are gone");
}

group("Secret Diary — levels, escalation, softened counts");
{
  ok(maxLevelFor({ privacy: "public" }) === "mild", "public party defaults to mild");
  ok(maxLevelFor({ privacy: "private" }) === "spicy", "private party defaults to spicy");
  ok(maxLevelFor({ privacy: "private", settings: { diaryMax: "unhinged", adult: false } }) === "spicy", "unhinged without 18+ falls back to spicy");
  ok(maxLevelFor({ privacy: "private", settings: { diaryMax: "unhinged", adult: true } }) === "unhinged", "unhinged with 18+ is allowed");
  ok(maxLevelFor({ privacy: "private", settings: { diaryMax: "mild" } }) === "mild", "the host can lower it");
  const caps = (n, max) => Array.from({ length: n }, (_, i) => capAt(i, n, max)).join(",");
  ok(caps(5, "unhinged") === "mild,mild,spicy,spicy,unhinged", `a batch of 5 climbs: ${caps(5, "unhinged")}`);
  ok(caps(8, "unhinged") === "mild,mild,mild,spicy,spicy,spicy,unhinged,unhinged", `a batch of 8 climbs: ${caps(8, "unhinged")}`);
  ok(caps(3, "spicy") === "mild,spicy,spicy" && caps(5, "mild") === "mild,mild,mild,mild,mild", "…never above the host's max");
  ok(yesnoTarget(3) === 1 && yesnoTarget(5) === 2 && yesnoTarget(6) === 2 && yesnoTarget(8) === 3, "about 1 in 3 is yes/no (3→1, 5→2, 8→3)");
  ok(countLine(3, 8) === "3 of 8 said yes", "a middling count is shown exactly");
  ok(countLine(0, 8) === countLine(1, 8) && /nobody or almost nobody/.test(countLine(0, 8)), "0 and 1 share 'nobody or almost nobody' — so the soft wording never pins it to 0");
  ok(countLine(8, 8) === countLine(7, 8) && /everyone or almost everyone/.test(countLine(8, 8)), "all and all-but-one share 'everyone or almost everyone'");
}

group("Secret Diary — the deal: host-only, swap, resize (4 players)");
{
  window.__logRows = [];
  const t = seatTable(SECRET_DIARY, 4);
  adv(300);
  ok(t.s.phase === "deal", "the game opens on the host's deal");
  ok(t.s.batch.length === DIARY.BATCH, `it deals a batch of ${DIARY.BATCH}`);
  ok(t.s.maxLevel === "spicy" && t.s.visibility === "private", "a private party defaults to spicy");
  ok(escalates(t.s.batch) && t.s.batch[0].level === "mild", `mild first, spicier later (${t.s.batch.map(c => c.level).join(",")})`);
  ok(ynCount(t.s.batch) === 2, "2 of the 5 are yes/no");
  ok(t.s.left > DIARY.DEAL_MS - 2000, `the host gets ~${DIARY.DEAL_MS / 1000}s before it sends by itself`);
  const sig = () => t.s.batch.map(c => c.id).join(",");
  const before = sig();
  t.input("p2", "swap", { i: 0 }); t.input("p2", "size", { n: 8 }); t.input("p2", "send"); t.input("p2", "skip");
  adv(600);
  ok(t.s.phase === "deal" && sig() === before, "only the host can swap, resize or send");
  const old = t.s.batch[3];
  t.input("p1", "swap", { i: 3 });
  adv(300);
  const fresh = t.s.batch.find(c => !before.split(",").includes(c.id));
  ok(t.s.batch.length === 5 && !t.s.batch.some(c => c.id === old.id) && !!fresh, "Swap replaces that one card");
  ok(fresh?.type === old.type, `…with another ${old.type} card`);
  ok(fresh?.level === old.level, `…at the same level when there's one left (${old.level} → ${fresh?.level})`);
  ok(escalates(t.s.batch), "the batch still escalates");
  ok(t.s.swapped.includes(old.id), "the swapped card is remembered");
  const row = window.__logRows.find(r => r.prompt_id === old.id);
  ok(row && row.skipped === true && row.answered === null, "swaps are logged as skipped");
  for (let i = 0; i < 6; i++) { t.input("p1", "swap", { i: i % 5 }); adv(250); }
  ok(!t.s.batch.some(c => t.s.swapped.includes(c.id)) && t.s.swapped.length === 7, "swapped cards never come back");
  t.input("p1", "size", { n: 8 }); adv(300);
  ok(t.s.batch.length === 8 && ynCount(t.s.batch) === 3 && escalates(t.s.batch), "8 questions: 3 yes/no, still escalating");
  t.input("p1", "size", { n: 3 }); adv(300);
  ok(t.s.batch.length === 3 && ynCount(t.s.batch) === 1 && escalates(t.s.batch), "3 questions: 1 yes/no");
  t.input("p1", "size", { n: 1 }); adv(300);
  ok(t.s.batch.length === 3, "never fewer than 3");
  t.input("p1", "size", { n: 40 }); adv(300);
  ok(t.s.batch.length === 8, "never more than 8");
  t.input("p1", "size", { n: 5 }); adv(300);
  ok(t.s.batch.length === 5 && ynCount(t.s.batch) === 2, "back to 5");
  ok(new Set(t.s.batch.map(c => c.id)).size === 5 && !t.s.batch.some(c => t.s.swapped.includes(c.id)), "no duplicates, no swapped cards");
  ok(t.s.phase === "deal", "nothing reaches the players until Send");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Secret Diary — a full game: answer the batch, reveal one by one, scoring, logging (4 players)");
{
  window.__logRows = [];
  const t = seatTable(SECRET_DIARY, 4);
  adv(300);
  const batch = t.s.batch.map(c => ({ ...c }));
  t.input("p1", "send");
  adv(400);
  ok(t.s.phase === "answer", "Send hands everyone the whole batch at once");
  ok(t.stateOf("p3").phase === "answer" && t.stateOf("p3").batch.length === 5, "a guest's phone has all 5 questions");
  ok(t.s.left <= 5 * DIARY.ANSWER_MS_PER_Q && t.s.left > 5 * DIARY.ANSWER_MS_PER_Q - 2000, `the window is ~${5 * DIARY.ANSWER_MS_PER_Q / 60000} min for 5 questions`);
  const W = batch.map((c, k) => k).filter(k => batch[k].type === "written");
  const skipK = W[0];
  answerAll(t, ["p1", "p2", "p3", "p4"], { skip: (id, k) => id === "p4" && k === skipK });
  adv(600);
  ok(t.s.phase === "answer", "answering doesn't close the window — Submit does");
  ok(Object.keys(t.s.players.p2.answers).length === 5 && Object.keys(t.s.players.p4.answers).length === 4, "every answer is saved as it's given (p4 left one blank)");
  t.input("p2", "ans", { k: W[1], text: "   " });
  adv(300);
  ok(t.s.players.p2.answers[W[1]] === undefined, "clearing a written answer un-answers it");
  t.input("p2", "ans", { k: W[1], text: `p2 wrote q${W[1]}` });
  ["p1", "p2", "p3"].forEach(id => t.input(id, "submit"));
  adv(800);
  ok(t.s.phase === "answer", "one player still going: still waiting");
  t.input("p3", "ans", { k: 0, text: "changed my mind" });
  adv(200);
  t.input("p4", "submit");
  ok(waitPhase(t, "reveal", 4000), "everyone submitted: the reveal starts");
  ok(Object.values(t.s.players).every(p => !Object.keys(p.answers).length), "raw answers leave the state once the window closes");
  ok(t.s.qi === 0, "it starts with the first question");

  const expect = { p1: 0, p2: 0, p3: 0, p4: 0 };
  const revealed = [];
  let hudLeak = false, first = true;
  while (t.s.phase === "reveal" && revealed.length < 10) {
    const k = t.s.qi, c = t.s.batch[k], q = t.s.qs[k], key = t.s.keys[k];
    revealed.push(k);
    if (c.type === "written") {
      ok(q.entries.length === (k === skipK ? 3 : 4), `q${k + 1} written: ${q.entries.length} answers (blanks are skipped)`);
      ok(q.entries.every(e => Object.keys(e).sort().join() === "eid,text"), `q${k + 1}: answers are unsigned — just text`);
      if (k === W[0]) ok(!q.entries.some(e => e.text === "changed my mind"), "an answer sent after Submit is ignored");
      const own = id => Object.keys(key).find(e => key[e] === id);
      for (const e of q.entries) if (e.eid !== own("p1")) t.input("p1", "guess", { eid: e.eid, who: key[e.eid] });
      for (const e of q.entries) if (e.eid !== own("p2")) t.input("p2", "guess", { eid: e.eid, who: "p1" });
      t.input("p3", "guess", { eid: own("p3"), who: "p1" });                // can't match your own
      if (k === skipK) t.input("p3", "guess", { eid: own("p1"), who: "p4" }); // p4 didn't answer this one
      adv(300);
      ok(!t.s.players.p3.guesses[own("p3")] && (k !== skipK || !Object.keys(t.s.players.p3.guesses).length), `q${k + 1}: you can't match your own answer, or a player who didn't answer`);
      expect.p1 += q.entries.length - 1; expect.p2 += 1;
    } else {
      ok(q.countLabel === "2 of 4 said yes", `q${k + 1} yes/no: only the count — "${q.countLabel}"`);
      ok(!q.entries.length, `q${k + 1}: no answers on show, just the number`);
      t.input("p1", "pick", { who: "p2", on: true }); t.input("p1", "pick", { who: "p1", on: true });
      t.input("p2", "pick", { who: "p3", on: true }); t.input("p2", "pick", { who: "p3", on: false });
      adv(300);
      ok(!t.s.players.p1.guesses.p1 && !t.s.players.p2.guesses.p3, `q${k + 1}: you can't pick yourself; un-picking works`);
      expect.p1 += 3; expect.p2 += 2;
    }
    t.input("p1", "lock"); t.input("p2", "lock");
    adv(1000);
    if (/pts|score/i.test(document.getElementById("game-hud").innerHTML)) hudLeak = true;
    if (first) {
      first = false;
      const t0 = clock.now;
      ok(pastQuestion(t, k, DIARY.GUESS_MS + 5000), `q${k + 1}: two players never lock in — the clock moves it on`);
      ok(clock.now - t0 >= DIARY.GUESS_MS - 4000, `…after ~${DIARY.GUESS_MS / 1000}s`);
    } else {
      t.input("p3", "lock"); t.input("p4", "lock");
      if (c.type === "yesno") { expect.p3 += 1; expect.p4 += 1; }   // locked with no picks: read the other "no" right
      ok(pastQuestion(t, k, 3000), `q${k + 1}: everyone locked in — straight to the next one`);
    }
    ok(t.s.keys[k] === null && !t.s.qs[k].entries.length, `q${k + 1}: once scored, nothing in the state ties anyone to it`);
  }
  ok(revealed.join() === "0,1,2,3,4", `all 5 questions revealed, in order (${revealed.join(",")})`);
  ok(t.s.phase === "end", "after the last question, the results");
  ok(!hudLeak, "no score is shown during the game — only at the end");
  ok(SD_IDS(t).every(id => t.s.players[id].score === expect[id]), `scores: ${SD_IDS(t).map(id => `${id} ${t.s.players[id].score}/${expect[id]}`).join(", ")}`);
  adv(1500);
  const panel = document.getElementById("game-panel").innerHTML;
  ok(/p1 wins/.test(panel), "the results name the winner");
  ok((panel.match(/hp-av/g) ?? []).length >= 4, "…with everyone's avatar");
  ok(!/wrote q\d/.test(panel) && !panel.includes("sd-entry") && !panel.includes("sd-count") && !/\d of \d said yes/.test(panel), "the results screen shows totals only — no answers, no counts");
  ok(t.s.keys.every(x => x === null) && t.s.qs.every(q => !q.entries.length), "no answers left in the state at the end");

  const rows = window.__logRows.filter(r => r.game_id === t.s.gameId);
  ok(rows.length === 5 && rows.every(r => r.skipped === false), `one log row per question sent (${rows.length})`);
  const keys = ["prompt_id", "level", "type", "party_size", "bots", "visibility", "skipped", "round", "answered", "avg_submit_ms", "avg_answer_len", "game_id"];
  ok(rows.every(r => keys.every(k => k in r)), "each row has id, level, type, party size, public/private, skipped, avg submit time, avg answer length");
  ok(rows.every(r => r.party_size === 4 && r.bots === 0 && r.visibility === "private" && r.answered === (r.round - 1 === skipK ? 3 : 4)), "party size, visibility and answered are right");
  ok(rows.map(r => r.round).join() === "1,2,3,4,5" && rows.every((r, i) => r.prompt_id === batch[i].id), "rows follow the batch order");
  ok(rows.every(r => typeof r.avg_submit_ms === "number" && r.avg_submit_ms >= 0), "average submit time is recorded");
  ok(rows.filter(r => r.type === "written").every(r => r.avg_answer_len > 0) && rows.filter(r => r.type === "yesno").every(r => r.avg_answer_len === null), "average answer length for written, none for yes/no");
  ok(rows.every(r => !/wrote|changed/.test(JSON.stringify(r)) && !("handle" in r) && !("user_id" in r) && !/"p\d"/.test(JSON.stringify(r))), "rows carry no answer text and no player identity");
  ok(runOut(t), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Secret Diary — drop-safety, timers, a host who leaves, nobody tapping anything");
{
  const t = seatTable(SECRET_DIARY, 4);
  adv(300); t.input("p1", "send"); adv(400);
  answerAll(t, ["p1", "p2", "p3"]);
  answerAll(t, ["p4"], { skip: (id, k) => k > 1 });          // p4 answers 2 of 5…
  adv(400);
  t.drop("p4");                                               // …and closes the tab without submitting
  ["p1", "p2", "p3"].forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), "a player who drops mid-answer stops being waited on");
  ok(t.s.qs[0].cands.includes("p4") && t.s.qs[1].cands.includes("p4"), "the answers they gave before leaving still count");
  ok(t.s.qs.slice(2).every(q => !q.cands.includes("p4")), "and the ones they never got to are skipped");
  ok(lockThrough(t, ["p1", "p2", "p3"]), "they don't block a single reveal");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(SECRET_DIARY, 3);
  adv(300); t.input("p1", "send"); adv(400);
  const t0 = clock.now;
  answerAll(t, ["p1", "p2"]);
  ok(waitPhase(t, "reveal", 5 * DIARY.ANSWER_MS_PER_Q + 5000), "nobody presses Submit: the window closes on its own");
  ok(clock.now - t0 >= 5 * DIARY.ANSWER_MS_PER_Q - 3000, `…after ~${5 * DIARY.ANSWER_MS_PER_Q / 60000} min`);
  ok(t.s.qs.every(q => q.cands.join() === "p1,p2"), "and every answer given still counts");
}
{
  const t = seatTable(SECRET_DIARY, 3);
  adv(300); t.input("p1", "send"); adv(400);
  answerAll(t, ["p1"]);
  ["p1", "p2", "p3"].forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "end", 4000), "only one person answered anything: nothing to guess, straight to the results");
  ok(/not enough answers/.test(t.s.why ?? ""), `…and it says why ("${t.s.why}")`);
}
{
  const t = seatTable(SECRET_DIARY, 4);
  adv(300); t.input("p1", "send"); adv(400);
  answerAll(t, ["p1", "p2", "p3", "p4"]);
  t.input("p1", "submit");
  adv(400);
  t.drop("p1");                                               // the host leaves
  adv(600);
  ok(t.host?.me.id === "p2", "the next player takes over as host");
  ["p2", "p3", "p4"].forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), "the new host carries on from the snapshot");
  ok(t.s.qs[0].cands.includes("p1"), "the old host's answers still count");
  ok(lockThrough(t, ["p2", "p3", "p4"]), "and plays every reveal through to the results");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  window.__logRows = [];
  const t = seatTable(SECRET_DIARY, 3);
  ok(runOut(t, 40 * 60 * 1000), "with zero taps from anyone the game still runs to the end (the deal sends itself)");
  const rows = window.__logRows.filter(r => r.game_id === t.s.gameId);
  ok(rows.length === 5 && rows.every(r => r.answered === 0), "every question was still sent (and logged), with no answers");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Secret Diary — odd counts and a full room (5 and 12 players)");
for (const n of [5, 12]) {
  const t = seatTable(SECRET_DIARY, n);
  adv(300); t.input("p1", "send"); adv(400);
  const who = SD_IDS(t);
  answerAll(t, who, { yes: id => +id.slice(1) % 2 === 0 });
  who.forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), `${n} players: everyone in, the reveal starts`);
  const k = t.s.qi;
  if (t.s.batch[k].type === "written") ok(t.s.qs[k].entries.length === n, `${n} unsigned answers`);
  else ok(/said yes/.test(t.s.qs[k].countLabel), `the count: "${t.s.qs[k].countLabel}"`);
  if (n === 12) {
    while (t.s.phase === "reveal" && t.s.batch[t.s.qi].type !== "written") { who.forEach(id => t.input(id, "lock")); pastQuestion(t, t.s.qi, 5000); }
    adv(600);
    ok(!!document.querySelector("#game-panel .sd-sel"), "with 11 people to choose from, matching uses a dropdown instead of a wall of chips");
  }
  ok(lockThrough(t, who), `${n} players: all the way to the results`);
  ok(Object.values(t.s.players).length === n, `${n} on the scoreboard`);
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Secret Diary — content levels and the 18+ gate");
{
  const pub = seatTable(SECRET_DIARY, 3, { party: { privacy: "public", settings: {} } });
  adv(300);
  ok(pub.s.maxLevel === "mild" && pub.s.batch.every(c => c.level === "mild"), `a public party deals mild only (${pub.s.batch.map(c => c.level).join(",")})`);
  ok(ynCount(pub.s.batch) === 1, "…with the one mild yes/no in it (that's all there is at mild)");
  const noAdult = seatTable(SECRET_DIARY, 3, { party: { privacy: "private", settings: { diaryMax: "unhinged", adult: false } } });
  adv(300);
  ok(noAdult.s.maxLevel === "spicy" && !noAdult.s.batch.some(c => c.level === "unhinged"), "asking for unhinged without 18+ gets spicy");
  const adult = seatTable(SECRET_DIARY, 3, { party: { privacy: "private", settings: { diaryMax: "unhinged", adult: true } } });
  adv(300);
  const b = adult.s.batch, lv = b.map(c => c.level);
  ok(adult.s.maxLevel === "unhinged", "18+ on: unhinged is allowed");
  ok(escalates(b) && lv.filter(l => l === "mild").length >= 2 && lv.filter(l => l === "unhinged").length <= 1, `…but the batch still climbs (${lv.join(",")})`);
  adult.input("p1", "size", { n: 8 }); adv(300);
  const lv8 = adult.s.batch.map(c => c.level);
  ok(escalates(adult.s.batch) && lv8.slice(0, 3).every(l => l === "mild") && lv8.filter(l => l === "unhinged").length <= 2, `8 questions climb too (${lv8.join(",")})`);
}

group("Secret Diary — no repeats in a party session, and running dry");
{
  const session = {};
  const g1 = seatTable(SECRET_DIARY, 3, { session });
  adv(300);
  g1.input("p1", "swap", { i: 0 }); adv(300);
  const a = [...g1.s.batch.map(c => c.id), ...g1.s.swapped];
  runOut(g1, 40 * 60 * 1000);
  ok(a.every(id => session.diaryUsed.has(id)), "the session remembers what was sent and swapped");
  const g2 = seatTable(SECRET_DIARY, 3, { session });
  adv(300);
  ok(!g2.s.batch.some(c => a.includes(c.id)), "the next game never deals any of them again");
  runOut(g2, 40 * 60 * 1000);

  const pubSession = {}, seen = [];
  let last = null, games = 0;
  for (; games < 9; games++) {
    const g = seatTable(SECRET_DIARY, 3, { session: pubSession, party: { privacy: "public", settings: {} } });
    adv(300);
    seen.push(...g.s.batch.map(c => c.id));
    last = g;
    if (!g.s.batch.length) break;
    runOut(g, 40 * 60 * 1000);
  }
  ok(new Set(seen).size === seen.length, `a public party works through all ${seen.length} mild prompts with no repeats`);
  ok(seen.length === POOL.filter(p => p.level === "mild").length, "…every one of them");
  ok(last.s.phase === "end" && /no questions left/.test(last.s.why ?? ""), `then says so instead of breaking ("${last.s.why}")`);
}

group("Secret Diary — logging survives a missing table");
{
  const before = promptLog.queued();
  window.__logFail = true;
  await promptLog.log({ prompt_id: "w-mild-01", level: "mild", type: "written", party_size: 3, bots: 0, visibility: "private", skipped: false, round: 1, answered: 3, avg_submit_ms: 1000, avg_answer_len: 12, game_id: "spec" });
  ok(promptLog.queued() === before + 1, "if the insert fails the row is queued on the phone");
  window.__logFail = false;
  window.__logRows = [];
  await promptLog.log({ prompt_id: "w-mild-02", level: "mild", type: "written", party_size: 3, bots: 0, visibility: "private", skipped: false, round: 2, answered: 3, avg_submit_ms: 1000, avg_answer_len: 12, game_id: "spec" });
  for (let i = 0; i < 10; i++) await null;      // let the background flush settle (setTimeout is faked here)
  ok(promptLog.queued() === 0 && window.__logRows.some(r => r.prompt_id === "w-mild-01"), "…and flushed on the next successful write");
}

// ===================================================================== 2
group("Today's Mission — quick start, rated 0-10");
{
  const t = seatTable(TODAYS_MISSION, 4);
  adv(500);
  ok(t.s.mode === "quick", "quick start is the default");
  ok(t.s.phase === "card", "quick start goes straight to the first card");
  ok(Object.values(t.s.missions).every(m => m.task && m.task.length > 10), "every player was dealt a mission");

  const performer = t.s.order[0];
  const voters = t.s.order.filter(x => x !== performer);
  ok(waitPhase(t, "do"), "the card rolls into doing it");
  t.input(performer, "claim");
  adv(3000);
  ok(t.s.phase === "vote", "claiming done advances to the rating");
  t.input(performer, "rate", { v: 10 });
  adv(400);
  ok(t.s.missions[performer].ratings[performer] === undefined, "the performer cannot rate themselves");
  [10, 8, 6].forEach((v, i) => t.input(voters[i], "rate", { v }));
  adv(3000);
  ok(t.s.phase === "result", "all ratings in ends the vote");
  const m = t.s.missions[performer];
  ok(m.avg === 8, `the score is the average rating (got ${m.avg})`);
  ok(m.pts === 80, `average 8/10 -> 80 points (got ${m.pts})`);
  ok(t.s.players[performer].score === 80, "points land on the performer");

  ok(waitPhase(t, "vote", 200000), "next mission reaches its rating");
  const p2 = t.s.order[1];
  const v2 = t.s.order.filter(x => x !== p2);
  t.input(v2[0], "rate", { v: 15 }); t.input(v2[1], "rate", { v: -3 }); t.input(v2[2], "rate", { v: 0 });
  adv(400);
  ok(t.s.missions[p2].ratings[v2[0]] === 10 && t.s.missions[p2].ratings[v2[1]] === 0, "ratings are clamped to the 0-10 scale");
  t.input(v2[0], "rate", { v: 4 });
  adv(3000);
  ok(t.s.missions[p2].ratings[v2[0]] === 4 || t.s.phase === "result", "a rater can change their mind before the vote closes");
  ok(t.s.missions[p2].pts === Math.round(100 * (4 + 0 + 0) / 3 / 10), `a low average scores low (got ${t.s.missions[p2].pts})`);

  ok(runOut(t), "all four missions play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 2b
group("Today's Mission — players choose");
{
  const t = seatTable(TODAYS_MISSION, 4, { options: { mode: "choose" } });
  adv(500);
  ok(t.s.mode === "choose", "the host's choice reaches the game");
  ok(t.s.phase === "pick", "choose mode opens on picking");
  const hands = Object.values(t.s.offers).map(o => o.hand);
  ok(hands.every(h => h.length === MISSION.CHOICES && new Set(h).size === h.length), `everyone is offered ${MISSION.CHOICES} different cards`);
  t.input("p1", "pick", { idx: 2 }); t.input("p2", "pick", { idx: 0 }); t.input("p4", "pick", { idx: 1 });
  t.input("p4", "pick", { idx: 9 });          // out of range: ignored
  adv(3000);
  ok(t.s.phase === "pick", "it waits while someone is still choosing");
  ok(t.s.offers.p4.picked === 1, "an out-of-range pick is ignored");
  ok(waitPhase(t, "card", MISSION.PICK_MS + 5000), "the clock closes picking for the straggler");
  ok(t.s.missions.p1.task === t.s.offers.p1.hand[2], "you do the mission you picked");
  ok(t.s.offers.p3.hand.includes(t.s.missions.p3.task) && t.s.missions.p3.autoPicked, "a player who didn't pick gets one from their own hand");
  ok(runOut(t), "the game plays out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(TODAYS_MISSION, 3, { options: { mode: "choose" } });
  adv(500);
  for (const id of ["p1", "p2", "p3"]) t.input(id, "pick", { idx: 0 });
  adv(3000);
  ok(t.s.phase === "card", "everyone picking moves on without waiting for the clock");
}

// ===================================================================== 2c
group("Today's Mission — performer drops mid-mission");
{
  const t = seatTable(TODAYS_MISSION, 4);
  adv(500);
  const performer = t.s.order[0];
  t.drop(performer);
  adv(4000);
  ok(t.s.missions[performer].skipped === true, "a performer who leaves is skipped, not waited on");
  ok(runOut(t), "game still finishes");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 3
group("Humiliation Ritual — the automatic judge");
{
  const R = (answer, alt = []) => ({ answer, alt });
  const penguin = R("penguin", ["lost penguin", "sad penguin"]);
  ok(judge("penguin", penguin) === "correct", "exact answer");
  ok(judge("a PENGUIN!", penguin) === "correct", "case, punctuation and filler words don't matter");
  ok(judge("penguins", penguin) === "correct", "plurals");
  ok(judge("penquin", penguin) === "correct", "a one-letter typo");
  ok(judge("a penguin that lost its egg", penguin) === "correct", "the answer inside a longer guess");
  ok(judge("a horse", penguin) === "wrong", "a different thing");
  ok(judge("pen", penguin) === "wrong", "a fragment of the word is not enough");
  const dog = R("walking a dog", ["dog walk", "strong dog", "dog pulling"]);
  ok(judge("walking the dog", dog) === "correct", "different filler word");
  ok(judge("dog walking", dog) === "correct", "word order and -ing");
  ok(judge("a dog", dog) === "close", "half the answer is close, not correct");
  const bat = R("low battery", ["phone dying", "1 percent", "battery"]);
  ok(judge("battery", bat) === "correct", "an accepted alternate");
  ok(judge("my phone is dying", bat) === "correct", "an alternate in a longer guess");
  ok(judge("", bat) === "wrong" && judge("the", bat) === "wrong", "empty and filler-only guesses are wrong");
}

group("Humiliation Ritual (4 players)");
{
  const t = seatTable(HUMILIATION_RITUAL, 4);
  adv(500);
  ok(t.s.order.length === 4, "performers rotate through everyone");
  const r0 = t.s.rounds[0], perf = r0.performer;
  ok(waitPhase(t, "act"), "prep rolls into acting");
  const [g1, g2] = t.s.order.filter(x => x !== perf);
  t.input(g1, "guess", { text: "completely wrong" });
  adv(600);
  ok(t.s.rounds[0].guesses[0].verdict === "wrong", "a wrong guess is judged wrong");
  ok(t.s.phase === "act", "and the turn carries on");
  t.input(perf, "guess", { text: r0.answer });
  adv(300);
  ok(t.s.rounds[0].guesses.length === 1, "the performer can't guess their own prompt");
  t.input(g2, "guess", { text: r0.answer });
  adv(2000);
  ok(t.s.rounds[0].won?.by === g2 && t.s.rounds[0].won.how === "typed", "a correct typed guess wins on its own");
  ok(t.s.phase === "result", "the turn ends without the performer touching their phone");
  ok(t.s.players[g2].score === 100, `the guesser scores 100 (got ${t.s.players[g2].score})`);
  ok(t.s.players[perf].score > 60, `the performer scores 60 + speed bonus (got ${t.s.players[perf].score})`);

  // out loud: only the performer can confirm, never naming themselves
  ok(waitPhase(t, "act"), "next performer is up");
  const r1 = t.s.rounds[t.s.ri], perf1 = r1.performer;
  const other = t.s.order.find(x => x !== perf1);
  t.input(other, "heard", { who: other });
  adv(300);
  ok(!t.s.rounds[t.s.ri].won, "a guesser can't confirm an out-loud answer (they don't know the prompt)");
  t.input(perf1, "heard", { who: perf1 });
  adv(300);
  ok(!t.s.rounds[t.s.ri].won, "the performer can't credit themselves");
  t.input(perf1, "heard", { who: other });
  adv(2000);
  ok(t.s.rounds[1].won?.by === other && t.s.rounds[1].won.how === "out loud", "the performer confirms who said it out loud");
  ok(t.s.phase === "result", "and the turn ends");

  ok(runOut(t), "all four turns play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 4
group("The Art Gallery (4 players)");
{
  const t = seatTable(ART_GALLERY, 4);
  adv(500);
  ok(t.s.phase === "photos", "opens on filling frames");
  for (const c of t.clients) for (let i = 0; i < 3; i++) t.input(c.me.id, "photo", { pid: `${c.me.id}-${i}` });
  adv(4000);
  ok(t.s.phase === "title", "all photos in advances to titling");
  // every dealt photo gets exactly two titles from two DIFFERENT players
  const counts = {};
  for (const p of Object.values(t.s.players)) for (const pid of p.assigned) (counts[pid] ??= new Set()).add(p.id);
  ok(t.s.dealt.length > 0, `photos were dealt (${t.s.dealt.length})`);
  ok(t.s.dealt.every(pid => counts[pid]?.size === 2), "every dealt photo has exactly 2 writers");
  ok(t.s.dealt.every(pid => !counts[pid].has(t.s.pool[pid].owner)), "nobody titles their own photo");

  for (const p of Object.values(t.s.players)) for (const pid of p.assigned) t.input(p.id, "title", { pid, text: `title by ${p.id}` });
  adv(4000);
  ok(t.s.phase === "gallery", "titles in opens the gallery");
  ok(t.s.frames.length > 0 && t.s.frames.length <= 8, `frames are capped (${t.s.frames.length} <= 8)`);

  // vote through one frame: writers are excluded
  adv(5000);
  const f = t.s.frames[t.s.fi];
  const writers = f.titles.map(x => x.by);
  const voters = Object.keys(t.s.players).filter(x => !writers.includes(x));
  for (const v of voters) t.input(v, "vote", { idx: 0 });
  adv(4000);
  ok(t.s.frames[0].counts?.[0] === voters.length, "votes land on the chosen title");
  ok(t.s.frames[0].pts?.[0] === 100, "a clean sweep is worth the full 100");

  ok(runOut(t), "the gallery plays out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 5
group("Manhunt (5 players)");
{
  const t = seatTable(MANHUNT_GAME, 5);
  adv(500);
  const P = Object.values(t.s.players);
  const hunters = P.filter(p => p.role === "hunter"), runners = P.filter(p => p.role === "runner");
  ok(hunters.length === 1, `~1 hunter per 4-5 players (5 players -> ${hunters.length})`);
  ok(runners.length === 4, "everyone else runs");
  ok(t.s.phase === "headstart", "runners get a head start");
  ok(t.s.sites.length === MANHUNT.SITES.length, "bomb sites come from config");

  // the state must never carry a coordinate — cells only
  const json = JSON.stringify(t.s);
  ok(!/"lat"|"lng"/.test(json), "no lat/lng anywhere in the broadcast state");
  ok(!/"cell"/.test(json) || !t.s.players[runners[0].id].cell, "per-player cells are not in the state");

  adv(MANHUNT.HEADSTART_MS + 2000);
  ok(t.s.phase === "hunt", "the hunt opens after the head start");

  // defusing: a runner reports standing in a zone, 20 s fills the bar
  const r0 = runners[0].id, site = t.s.sites[0].id;
  for (let i = 0; i < 12; i++) { t.input(r0, "zone", { site }); adv(2000); }
  ok(t.s.sites[0].defused === true, "standing in a zone for ~20 s defuses the bomb");
  ok(t.s.radar.pings.length > 0, "defusing pings the site's cell to the hunters");
  ok(t.s.sites[0].by === r0, "the defuser is credited");

  // leaving the zone resets an unfinished defuse
  const site2 = t.s.sites[1].id;
  t.input(runners[1].id, "zone", { site: site2 }); adv(4000);
  const partial = t.s.sites[1].progress;
  ok(partial > 0 && partial < 1, `partial progress accrues (${partial.toFixed(2)})`);
  t.input(runners[1].id, "zone", { site: null }); adv(8000);
  ok(t.s.sites[1].progress === 0, "walking away resets the progress bar");

  // tagging: hunter nominates, runner confirms, runner becomes a hunter
  t.input(hunters[0].id, "tag", { target: r0 });
  adv(500);
  ok(t.s.pending?.target === r0, "the tag waits on the runner's confirmation");
  t.input(runners[1].id, "tagack", { yes: true });
  adv(500);
  ok(t.s.players[r0].tagged === false, "only the targeted runner can answer");
  t.input(r0, "tagack", { yes: false });
  adv(500);
  ok(t.s.pending === null && t.s.players[r0].tagged === false, "saying no clears the tag and keeps them running");
  t.input(hunters[0].id, "tag", { target: r0 });
  adv(300);
  t.input(r0, "tagack", { yes: true });
  adv(500);
  ok(t.s.players[r0].tagged === true && t.s.players[r0].role === "hunter", "a tagged runner joins the hunters");

  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 5b
group("Manhunt — win conditions");
{
  // runners win: every bomb defused
  const t = seatTable(MANHUNT_GAME, 5);
  adv(MANHUNT.HEADSTART_MS + 2000);
  const runners = Object.values(t.s.players).filter(p => p.role === "runner");
  for (const site of t.s.sites.map(x => x.id)) {
    for (let i = 0; i < 12; i++) { t.input(runners[0].id, "zone", { site }); adv(2000); }
  }
  ok(t.s.winner === "runners", `all bombs defused -> runners win (got ${t.s.winner})`);
  ok(t.s.phase === "end", "the game ends on the win");
  ok(runOut(t), "results close out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // hunters win: every runner tagged
  const t = seatTable(MANHUNT_GAME, 5);
  adv(MANHUNT.HEADSTART_MS + 2000);
  const hunter = Object.values(t.s.players).find(p => p.role === "hunter").id;
  for (const r of Object.values(t.s.players).filter(p => p.role === "runner").map(p => p.id)) {
    t.input(hunter, "tag", { target: r }); adv(400);
    t.input(r, "tagack", { yes: true }); adv(400);
  }
  ok(t.s.winner === "hunters", `all runners tagged -> hunters win (got ${t.s.winner})`);
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // hunters win on the clock with a bomb still live
  const t = seatTable(MANHUNT_GAME, 5);
  adv(MANHUNT.HEADSTART_MS + 2000);
  adv(MANHUNT.GAME_MS + 5000);
  ok(t.s.winner === "hunters", `clock out with a live bomb -> hunters win (got ${t.s.winner})`);
  ok(/bomb still live/.test(t.s.why ?? ""), "the reason is reported");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // works from 4 for testing
  const t = seatTable(MANHUNT_GAME, 4);
  adv(500);
  ok(Object.values(t.s.players).filter(p => p.role === "hunter").length === 1, "4 players still yields a hunter");
  ok(Object.values(t.s.players).filter(p => p.role === "runner").length === 3, "and three runners");
}

// ===================================================================== kit
group("Shared kit");
{
  const html = resultsHtml([
    { id: "a", handle: "ana", score: 120 },
    { id: "b", handle: "bo", score: 300 },
    { id: "c", handle: "cy", score: 50, gone: true },
  ], { title: "Test", sub: "final", note: "note" });
  ok(html.indexOf("bo") < html.indexOf("ana"), "results are ranked by score");
  ok((html.match(/hp-av/g) ?? []).length === 3, "every player gets an avatar");
  ok(/300/.test(html) && /120/.test(html), "scores are shown");
  ok(/hp-left/.test(html), "a player who left is marked");

  // regression: the bootstrap enter() must not fire the first phase's exit
  let exits = 0;
  const R = new Rounds([{ name: "a", ms: 1000, exit: () => exits++, next: () => "b" }, { name: "b", ms: 1000, next: () => null }]);
  const st = { phase: "a" };                  // a game's initial state names its first phase
  R.enter(st, "a");
  ok(exits === 0, "entering the first phase doesn't run its exit hook");
  R.hostStep(st, 1.5);
  ok(st.phase === "b" && exits === 1, "leaving it does — exactly once");
  const handover = JSON.parse(JSON.stringify({ ...st, phase: "a", _rp: "a" }));
  R.enter(handover, "b");
  ok(exits === 2, "and still does after a host handover (the marker travels in the state)");

  let cleaned = 0;
  window.__hpTrashLog = false;
  trash.add(() => cleaned++);
  trash.add(() => cleaned++);
  trash.flush("spec");
  ok(cleaned === 2, "cleanup runs every registered disposer");
  trash.flush("spec again");
  ok(cleaned === 2, "flushing twice does not re-run disposers");
}

// ===================================================================== cleanup
group("Cleanup — nothing survives the party");
{
  // party.js flushes the bin when a game ends and when you leave the party.
  // Everything a game wrote must be gone afterwards, including the state on
  // HostGame's debug handle.
  const t = seatTable(SECRET_DIARY, 3);
  adv(300); t.input("p1", "send");
  waitPhase(t, "answer", 3000);
  for (const c of t.clients) t.s.batch.forEach((q, k) => t.input(c.me.id, "ans", q.type === "written" ? { k, text: `secret of ${c.me.id}` } : { k, yn: "yes" }));
  adv(600);
  const host = t.host;
  ok(Object.values(host.game.s.players).some(p => Object.keys(p.answers).length), "answers exist while the game is running");
  ok(window.__game !== null, "the debug handle is live during play");
  trash.flush("spec: party ended");
  ok(host.game.s === null, "the game state is dropped on cleanup");
  ok(window.__game === null, "the debug handle no longer pins the state");
}

log("head", `\n${pass} passed, ${fail} failed`);
window.__done = { pass, fail };
