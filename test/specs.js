// House-party specs. Plays every game end to end on the fake bus + virtual
// clock and asserts the rules the brief actually names.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY, diaryPool, maxLevelFor, capAt, yesnoTarget, countLine, shelfPages } from "/web/hpgames/secretdiary.js";
import * as CONFIG from "/web/hpconfig.js";
import { promptLog } from "/web/hplog.js";
import { TODAYS_MISSION } from "/web/hpgames/mission.js";
import { HUMILIATION_RITUAL, judge, ritualPool, ritualPromptsFor, ritualPoints } from "/web/hpgames/ritual.js";
import { SIDE_QUEST, questPool, questsFor, questPoints } from "/web/hpgames/sidequest.js";
import { fairPick, chances } from "/web/fairpick.js";
import { newSet, places, addGame, standings, fullParticipants } from "/web/partyset.js";
import { MANHUNT_GAME } from "/web/hpgames/manhunt.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { MANHUNT, DIARY, MISSION, RITUAL, SIDEQUEST, LEADERBOARD } from "/web/hpconfig.js";
import { resultsHtml, trash, Rounds } from "/web/hpkit.js";
import { ui } from "/web/gamekit.js";
import { findPath, walkable } from "/web/hplobby.js";
import { ROOMS } from "/web/roomdefs.js";

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (cls, msg) => { const s = document.createElement("span"); s.className = cls; s.textContent = (cls === "head" ? "" : cls === "pass" ? "  ✓ " : "  ✗ ") + msg + "\n"; out.appendChild(s); };
const ok = (cond, msg) => { if (cond) { pass++; log("pass", msg); } else { fail++; log("fail", msg); } };
const group = name => { log("head", "\n" + name); console.info(`[spec] ${name}`); };

// the diary's prompt pool is fetched at import; have it before any clock tricks
const POOL = await diaryPool();
const HR_POOL = await ritualPool();
const SQ = await questPool();
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
// sit through the points screen that follows every question
function throughPoints(t, maxMs = DIARY.POINTS_MS + 2000) {
  let spent = 0;
  while (t.s.phase === "points" && spent < maxMs) { adv(STEP); spent += STEP; }
  return t.s.phase !== "points";
}
// everyone locks in on every question, with no guesses, until the end
function lockThrough(t, who) {
  let g = 0;
  while ((t.s.phase === "reveal" || t.s.phase === "points") && g++ < 60) {
    if (t.s.phase === "points") { throughPoints(t); continue; }
    const k = t.s.qi; who.forEach(id => t.input(id, "lock")); pastQuestion(t, k, 5000);
  }
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

group("Secret Diary — the shelf: 3 to 6 diaries at a time");
{
  const P = n => shelfPages(n).map(([a, b]) => b - a);
  ok(P(3).join() === "3" && P(6).join() === "6", "up to 6 answers sit on one shelf");
  ok(P(7).join() === "4,3" && P(9).join() === "5,4" && P(12).join() === "6,6" && P(13).join() === "5,4,4", "more than 6 are paged in even groups");
  ok([...Array(28).keys()].slice(3).every(n => { const pg = shelfPages(n); return pg[0][0] === 0 && pg.at(-1)[1] === n && pg.every(([a, b], i) => b - a >= 3 && b - a <= 6 && (i === 0 || pg[i - 1][1] === a)); }),
    "every page holds 3-6 diaries and the pages cover every answer once (3-30)");
}

group("Secret Diary — diary colors: one per player for the whole batch, never two alike, reshuffled next batch");
for (const n of [4, 12]) {
  const t = seatTable(SECRET_DIARY, n);
  adv(300); t.input("p1", "send"); adv(400);
  const who = SD_IDS(t);
  answerAll(t, who, { yes: id => +id.slice(1) % 2 === 0 });
  who.forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), `${n} players: into the reveal`);
  // every playable question, written or yes/no, has one color per diary
  const Q = t.s.qs.map((q, k) => ({ q, k, type: t.s.batch[k].type })).filter(x => x.q.playable);
  const fine = Q.every(({ q, type }) => {
    const m = type === "written" ? q.entries.length : q.countOf;
    return Array.isArray(q.colors) && q.colors.length === m && new Set(q.colors).size === m && q.colors.every(i => Number.isInteger(i) && i >= 0 && i < DIARY.COLORS.length);
  });
  ok(fine, `${n} players: every question — written and yes/no — gives each diary its own palette color`);
  const col = t.s.colorOf ?? {};
  ok(who.every(id => Number.isInteger(col[id])) && new Set(who.map(id => col[id])).size === n, `${n} players: everyone is dealt a batch color, no two alike`);
  // every diary is in its writer's batch color, on every question
  const steady = Q.every(({ q, k, type }) => type === "written"
    ? q.entries.every((e, i) => q.colors[i] === col[t.s.keys[k][e.eid]])
    : q.colors.every(c => Object.keys(t.s.keys[k]).some(id => col[id] === c)));
  ok(steady, `${n} players: a diary keeps its writer's color on every question of the batch`);
  ok(Q.every(({ q }) => !Object.keys(q).some(k => /color/i.test(k) && k !== "colors")) && !("colors" in (t.s.players.p1 ?? {})), "each question's colors are a list beside the unsigned diaries — nothing per question is keyed by player");
  ok(lockThrough(t, who), `${n} players: the game closes out`);
}
{
  // the next batch reshuffles: deal two batches with the same seat and compare
  const deal = seed => { const t = seatTable(SECRET_DIARY, 12, { seed }); adv(300); t.input("p1", "send"); adv(400); const c = { ...t.s.colorOf }; trash.flush("spec"); return c; };
  const a = deal(11), b = deal(12);
  ok(Object.keys(a).some(id => a[id] !== b[id]), "a new batch deals the colors again (12 players: different from the last batch)");
  ok(DIARY.COLORS.length >= 12 && DIARY.SHAPES.length === DIARY.COLORS.length && new Set(DIARY.COLORS).size === DIARY.COLORS.length, "12 distinct colors, each with its own shape, for up to 12 players");
  // colorblind: the palette spans light to dark, not just hues
  const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const lum = h => { const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const L = DIARY.COLORS.map(lum).sort((x, y) => x - y);
  ok(L[0] < 0.05 && L.at(-1) > 0.8 && L.filter(x => x < 0.08).length >= 3 && L.filter(x => x > 0.5).length >= 3, `brightness varies too (relative luminance ${L.map(x => x.toFixed(2)).join(" ")})`);
}

group("Secret Diary — yes/no stamps: blurred when the count is softened");
{
  const t = seatTable(SECRET_DIARY, 4);
  adv(300); t.input("p1", "send"); adv(400);
  answerAll(t, SD_IDS(t), { yes: () => false });               // everyone says no
  SD_IDS(t).forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), "into the reveal");
  const yq = t.s.qs.filter((q, j) => t.s.batch[j].type === "yesno");
  ok(yq.length > 0 && yq.every(q => q.soft && q.stamps === null && /nobody or almost nobody/.test(q.countLabel) && q.colors.length === 4),
    "all four said no: four diaries, no stamps sent, just 'nobody or almost nobody'");
  while (t.s.phase === "reveal" && t.s.batch[t.s.qi].type !== "yesno") { SD_IDS(t).forEach(id => t.input(id, "lock")); pastQuestion(t, t.s.qi, 5000); throughPoints(t); }
  if (t.s.phase === "reveal") {
    adv(4000);                                                  // let the unlock finish
    const p = document.getElementById("game-panel").innerHTML;
    ok((p.match(/sd-dcell/g) ?? []).length === 4 && (p.match(/sd-stamp blur/g) ?? []).length === 4 && !/>YES<|>NO</.test(p), "the opened diaries show blurred stamps — no YES or NO anywhere on the page");
  }
  ok(lockThrough(t, SD_IDS(t)), "the game closes out");
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
  const revealed = [], colorsOf = {}, prev = {};
  let hudLeak = false, first = true;
  while (t.s.phase === "reveal" && revealed.length < 10) {
    const k = t.s.qi, c = t.s.batch[k], q = t.s.qs[k], key = t.s.keys[k];
    revealed.push(k);
    if (c.type === "written") {
      ok(q.entries.length === (k === skipK ? 3 : 4), `q${k + 1} written: ${q.entries.length} answers (blanks are skipped)`);
      ok(q.entries.every(e => Object.keys(e).sort().join() === "eid,text"), `q${k + 1}: answers are unsigned — just text`);
      if (k === W[0]) ok(!q.entries.some(e => e.text === "changed my mind"), "an answer sent after Submit is ignored");
      ok(Array.isArray(q.colors) && q.colors.length === q.entries.length && new Set(q.colors).size === q.colors.length
        && q.colors.every(i => Number.isInteger(i) && i >= 0 && i < DIARY.COLORS.length), `q${k + 1}: each diary gets its own palette color`);
      q.entries.forEach((e, i) => (colorsOf[key[e.eid]] ??= []).push(q.colors[i]));
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
      ok(!q.soft && Array.isArray(q.stamps) && q.stamps.length === 4 && q.stamps.filter(x => x === "yes").length === 2 && q.stamps.every(x => x === "yes" || x === "no"),
        `q${k + 1}: four diaries open on stamps, 2 YES and 2 NO, in a list that names nobody`);
      ok(q.colors.length === 4 && new Set(q.colors).size === 4, `q${k + 1}: yes/no diaries are in their writers' colors too`);
      ok(q.stamps.every((v, i) => Object.keys(key).some(id => t.s.colorOf[id] === q.colors[i] && (key[id] ? "yes" : "no") === v)), `q${k + 1}: each diary's stamp is its writer's answer`);
      t.input("p1", "pick", { who: "p2", on: true }); t.input("p1", "pick", { who: "p1", on: true });
      t.input("p2", "pick", { who: "p3", on: true }); t.input("p2", "pick", { who: "p3", on: false });
      adv(300);
      ok(!t.s.players.p1.guesses.p1 && !t.s.players.p2.guesses.p3, `q${k + 1}: you can't pick yourself; un-picking works`);
      expect.p1 += 3; expect.p2 += 2;
    }
    t.input("p1", "lock"); t.input("p2", "lock");
    adv(1000);
    if (/pts|score|points/i.test(document.getElementById("game-hud").innerHTML) || document.querySelector("#game-panel .sd-pts")) hudLeak = true;
    if (first) {
      first = false;
      const t0 = clock.now;
      ok(pastQuestion(t, k, DIARY.GUESS_MS + 5000), `q${k + 1}: two players never lock in — the clock moves it on`);
      ok(clock.now - t0 >= DIARY.GUESS_MS - 4000, `…after ~${DIARY.GUESS_MS / 1000}s`);
    } else {
      t.input("p3", "lock"); t.input("p4", "lock");
      if (c.type === "yesno") { expect.p3 += 1; expect.p4 += 1; }   // locked with no picks: read the other "no" right
      ok(pastQuestion(t, k, 3000), `q${k + 1}: everyone locked in — straight to the points`);
    }
    ok(t.s.keys[k] === null && !t.s.qs[k].entries.length && !t.s.qs[k].colors?.length && !t.s.qs[k].stamps, `q${k + 1}: once scored, nothing in the state ties anyone to it`);
    // the points screen: each player's points on this question and their total
    ok(t.s.phase === "points" && t.s.pts?.qi === k, `q${k + 1}: a points screen follows`);
    const d = t.s.pts?.delta ?? {};
    ok(SD_IDS(t).every(id => d[id] === expect[id] - (prev[id] ?? 0)), `q${k + 1}: points this question — ${SD_IDS(t).map(id => `${id} +${d[id]}`).join(", ")}`);
    adv(600);
    const pp = document.getElementById("game-panel").innerHTML;
    const rowsN = (pp.match(/sd-pt-row/g) ?? []).length;
    ok(rowsN === 4 && (pp.match(/hp-av/g) ?? []).length >= 4 && new RegExp(`\\+${d.p1}`).test(pp), `q${k + 1}: every player, with avatar, +points and total`);
    ok(!/wrote q\d|said yes|sd-entry|sd-stamp|sd-dcell/.test(pp), `q${k + 1}: the points screen shows numbers only — no answers, stamps or right/wrong`);
    const tp = clock.now;
    if (k === 1) { t.input("p2", "skip"); adv(400); ok(t.s.phase === "points", "only the host can skip the points screen"); t.input("p1", "skip"); adv(400); ok(t.s.phase !== "points", "the host taps next question"); }
    else { ok(throughPoints(t) && clock.now - tp >= DIARY.POINTS_MS - 1500, `q${k + 1}: it moves on by itself after ~${DIARY.POINTS_MS / 1000}s`); }
    Object.assign(prev, expect);
  }
  ok(revealed.join() === "0,1,2,3,4", `all 5 questions revealed, in order (${revealed.join(",")})`);
  // a writer keeps one color through the batch — that's the deduction
  const multi = Object.values(colorsOf).filter(cs => cs.length > 1);
  ok(multi.length > 0 && multi.every(cs => new Set(cs).size === 1), `every writer keeps one color through the batch (${multi.length} tracked)`);
  ok(t.s.phase === "end", "after the last question, the results");
  ok(!hudLeak, "no score while guessing — points only on the screen after each question");
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
  // softened counts never send the stamps (they'd give the exact number away)
  const yq = t.s.qs.filter((q, j) => t.s.batch[j].type === "yesno" && q.playable);
  ok(yq.every(q => q.soft ? q.stamps === null && !/ of /.test(q.countLabel) : q.stamps.length === q.countOf), `${n} players: stamps only when the count is exact; soft counts send none`);
  if (n === 12) {
    while ((t.s.phase === "reveal" && t.s.batch[t.s.qi].type !== "written") || t.s.phase === "points") {
      if (t.s.phase === "points") { throughPoints(t); continue; }
      who.forEach(id => t.input(id, "lock")); pastQuestion(t, t.s.qi, 5000);
    }
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
group("Humiliation Ritual — the prompt pool (draft)");
{
  const SUPPLIED_HR = [["Peeing dog", "mild"], ["Ex-boyfriend", "mild"], ["Kid throwing a tantrum", "mild"], ["Constipated person", "mild"], ["Person with diarrhea", "mild"], ["Masochist", "spicy"], ["Sydney Sweeney", "mild"], ["Michael Jordan", "mild"], ["Jake Paul", "mild"], ["Mike Tyson", "mild"], ["IShowSpeed", "mild"], ["Alysa Liu", "mild"]];
  const raw = await (await fetch("/web/data/ritual_prompts.json")).json();
  ok(raw._draft === true, "the pool is marked as a draft");
  ok(HR_POOL.length === SUPPLIED_HR.length && SUPPLIED_HR.every(([t, l]) => HR_POOL.some(p => p.text === t && p.level === l)), `exactly the ${SUPPLIED_HR.length} supplied prompts, with their levels`);
  ok(new Set(HR_POOL.map(p => p.id)).size === HR_POOL.length && HR_POOL.every(p => p.id.startsWith(`hr-${p.level}-`)), "unique ids that name their level");
  ok(!ritualPromptsFor(HR_POOL, { privacy: "public" }).some(p => p.level !== "mild"), "a public party only gets mild prompts");
  ok(ritualPromptsFor(HR_POOL, { privacy: "private" }).some(p => p.text === "Masochist"), "a private party gets the spicy one too");
}

group("Humiliation Ritual — the close-guess hint (the performer still decides)");
{
  const R = answer => ({ answer, alt: [] });
  ok(judge("peeing dog", R("Peeing dog")) === "match" && judge("a dog peeing", R("Peeing dog")) === "match", "the answer, in any order, looks right");
  ok(judge("dog", R("Peeing dog")) === "close", "half of it is close");
  ok(judge("sidney sweeny", R("Sydney Sweeney")) === "match", "typos still look right");
  ok(judge("speed", R("IShowSpeed")) === "close" && judge("i show speed", R("IShowSpeed")) === "match", "part of a one-word name is close; the name with spaces looks right");
  ok(judge("my ex", R("Ex-boyfriend")) === "close", "a hyphenated answer splits into words");
  ok(judge("a horse", R("Peeing dog")) === "wrong" && judge("", R("Peeing dog")) === "wrong" && judge("the", R("Mike Tyson")) === "wrong", "unrelated, empty and filler-only guesses get no hint");
  const p0 = ritualPoints(0), pEnd = ritualPoints(RITUAL.ACT_MS), pMid = ritualPoints(RITUAL.ACT_MS / 2);
  ok(p0.guesser > p0.performer && pMid.guesser > pMid.performer, "the guesser always scores more than the performer");
  ok(p0.guesser > pMid.guesser && pMid.guesser > pEnd.guesser && p0.performer > pEnd.performer, `faster = more (guesser ${p0.guesser} → ${pMid.guesser} → ${pEnd.guesser})`);
}

group("Humiliation Ritual (4 players)");
{
  const t = seatTable(HUMILIATION_RITUAL, 4);
  adv(500);
  ok(t.s.turns === 4, "default: everyone performs once (4 turns)");
  const r0 = t.s.turn, perf = r0.performer;
  ok(!!perf && r0.prompt && HR_POOL.some(p => p.text === r0.prompt), "a performer is picked and dealt a prompt from the pool");
  ok(waitPhase(t, "act"), "prep rolls into acting");
  const [g1, g2] = Object.keys(t.s.players).filter(x => x !== perf);
  t.input(g1, "guess", { text: "completely wrong" });
  t.input(g2, "guess", { text: r0.prompt });
  t.input(perf, "guess", { text: "me me me" });
  adv(600);
  ok(t.s.turn.guesses.length === 2, "guesses reach the performer's feed; the performer can't guess");
  ok(t.s.turn.guesses.find(g => g.by === g2).hint === "match" && t.s.turn.guesses.find(g => g.by === g1).hint === "wrong", "each guess carries its hint");
  ok(t.s.phase === "act" && !t.s.turn.won, "a right guess does NOT end the turn by itself — the performer decides");
  const right = t.s.turn.guesses.find(g => g.by === g2);
  t.input(g1, "pick", { gid: right.gid });
  adv(400);
  ok(!t.s.turn.won, "a guesser can't call a guess right");
  t.input(perf, "pick", { gid: right.gid });
  adv(2000);
  ok(t.s.turn.won?.by === g2 && t.s.phase === "result", "the performer taps the right guess and the turn ends");
  ok(t.s.players[g2].score > t.s.players[perf].score && t.s.players[perf].score > 0 && t.s.players[g1].score === 0, `the guesser scores more than the performer (${t.s.players[g2].score} vs ${t.s.players[perf].score}); nobody else scores`);

  // nobody gets it: time runs out, nobody scores, the answer is shown
  ok(waitPhase(t, "act"), "the next performer is up");
  const before = Object.fromEntries(Object.values(t.s.players).map(p => [p.id, p.score]));
  ok(waitPhase(t, "result", RITUAL.ACT_MS + 5000), "time runs out");
  ok(!t.s.turn.won && Object.values(t.s.players).every(p => p.score === before[p.id]), "nobody scores when time runs out");
  ok(runOut(t), "all turns play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(HUMILIATION_RITUAL, 3, { options: { rounds: "2" } });
  adv(500);
  ok(t.s.turns === 6, "the host can set everyone twice (3 players: 6 turns)");
  ok(waitPhase(t, "act"), "into the act");
  t.drop(t.s.turn.performer);
  adv(4000);
  ok(t.s.turn.skipped === true || t.s.phase !== "act", "a performer who leaves ends their turn, nobody waits");
  ok(runOut(t), "and the game still finishes");
}

group("The fair picker");
{
  let rng = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
  const ids = ["a", "b", "c", "d", "e"];
  let w = {}, last = null, repeats = 0;
  const count = Object.fromEntries(ids.map(i => [i, 0]));
  for (let k = 0; k < 5000; k++) {
    const r = fairPick(w, ids, rng);
    w = r.weights; count[r.id]++;
    if (r.id === last) repeats++;
    last = r.id;
  }
  ok(ids.every(i => Math.abs(count[i] / 5000 - 0.2) < 0.03), `everyone is picked about as often (${ids.map(i => count[i]).join(" / ")})`);
  ok(repeats > 0 && repeats / 5000 < 0.06, `a repeat right away is rare but possible (${(repeats / 50).toFixed(1)}%)`);
  ok(Object.values(w).every(x => x > 0), "nobody's chance is ever 0");
  const c1 = chances({}, ids), r1 = fairPick({}, ids, () => 0.01), c2 = chances(r1.weights, ids);
  ok(c2[r1.id] < c1[r1.id] && ids.filter(i => i !== r1.id).every(i => c2[i] > c1[i]), "picked: your chance drops; not picked: it rises");
  let wait = {}, ce = [chances(wait, ids).e];
  for (let k = 0; k < 3; k++) { wait = fairPick(wait, ids, () => 0).weights; ce.push(chances(wait, ids).e); }
  ok(ce.every((c, i) => i === 0 || c > ce[i - 1]), "every turn you're skipped, your chance grows");
}

group("Side Quest — the quest pool");
{
  const ids = new Set(SQ.quests.map(q => q.id));
  const by = (c, l) => SQ.quests.filter(q => q.category === c && q.level === l).length;
  ok(SQ.quests.length === 47 && by("anywhere", "mild") === 7 && by("strangers", "mild") === 22 && by("strangers", "spicy") === 15 && by("unhinged", "unhinged") === 3, `47 quests: 7 anywhere, 22 + 15 strangers (mild/spicy), 3 unhinged (got ${SQ.quests.length})`);
  ok(ids.size === SQ.quests.length && SQ.quests.every(q => q.id.startsWith(`sq-${q.category}-${q.level}-`)), "unique ids that name category and level");
  ok(SQ.quests.some(q => q.text === "Crash out and throw a tantrum in COMPLETE SILENCE") && SQ.quests.some(q => q.text === "Take a selfie with a stranger and caption it \"hard launch 😝\""), "texts are exactly as supplied");
  ok(!questsFor(SQ.quests, { settings: { adult: false } }).some(q => q.level === "unhinged"), "no unhinged quests without 18+");
  ok(questsFor(SQ.quests, { settings: { adult: true } }).filter(q => q.level === "unhinged").length === 3, "18+ parties get them");
  ok(questPoints(5) === 100 && questPoints(3.5) === 70 && questPoints(0) === 0, "points = average stars × 20");
}

group("Side Quest (4 players)");
{
  const t = seatTable(SIDE_QUEST, 4);
  adv(500);
  ok(t.s.phase === "setup", "opens on the host's setup");
  const host = t.host.me.id, guest = Object.keys(t.s.players).find(x => x !== host);
  t.input(guest, "sq-go"); t.input(guest, "sq-cat", { cat: "anywhere", on: false });
  adv(400);
  ok(t.s.phase === "setup" && !t.s.setup.off.length, "only the host can change the setup or start");
  t.input(host, "sq-cat", { cat: "strangers", on: false });
  adv(300);
  const strangers = SQ.quests.filter(q => q.category === "strangers").length;
  ok(t.s.setup.off.length === strangers, "the host can switch a whole category off");
  const one = SQ.quests.find(q => q.category === "strangers");
  t.input(host, "sq-q", { id: one.id, on: true });
  t.input(host, "sq-q", { id: SQ.quests[0].id, on: false });
  adv(300);
  ok(!t.s.setup.off.includes(one.id) && t.s.setup.off.includes(SQ.quests[0].id), "…or single quests on and off");
  t.input(host, "sq-turns", { n: 3 });
  t.input(host, "sq-go");
  adv(2000);
  ok(t.s.phase === "wizard" && t.s.turns === 3, "start: the wizard appears; the host's 3 turns stick");
  const q0 = t.s.turn.quest;
  ok(q0.category === "anywhere" && q0.id !== SQ.quests[0].id || q0.id === one.id, "the quest comes from what's switched on");
  ok(waitPhase(t, "do", 20000), "the ball reveals the quest, spins and lands; the timer starts");
  ok(t.s.left > SIDEQUEST.DO_MS - 1500, "3 minutes on the clock");
  const who = t.s.turn.who, voters = Object.keys(t.s.players).filter(x => x !== who);
  t.input(voters[0], "done");
  adv(400);
  ok(!t.s.turn.status, "only the player on the quest can say they're done");
  t.input(who, "done");
  ok(waitPhase(t, "vote", 4000), "Done → the room rates it");
  t.input(who, "rate", { v: 5 });
  t.input(voters[0], "rate", { v: 5 }); t.input(voters[1], "rate", { v: 4 }); t.input(voters[1], "rate", { v: 3 });
  adv(400);
  ok(t.s.turn.votes[who] === undefined, "you can't rate your own quest");
  ok(t.s.phase === "vote", "the vote waits for everyone");
  t.input(voters[2], "rate", { v: 9 });
  adv(300);
  ok(t.s.turn.votes[voters[2]] === undefined, "votes are 1-5 stars");
  t.input(voters[2], "rate", { v: 4 });
  ok(waitPhase(t, "result", 3000), "everyone voted → the result");
  ok(t.s.turn.avg === 4 && t.s.turn.pts === 80 && t.s.players[who].score === 80, `average 4 (5,3 changed from 4,4) → 80 points (got ${t.s.turn.pts})`);

  // the next turn: someone gives up
  ok(waitPhase(t, "do", 30000), "next turn: a new quest, a new pick");
  ok(t.s.turn.quest.id !== q0.id, "a different quest");
  const w2 = t.s.turn.who, before = t.s.players[w2].score;
  t.input(w2, "giveup");
  ok(waitPhase(t, "result", 4000), "give up → straight to the result, no vote");
  ok(t.s.turn.pts === 0 && t.s.turn.n === 0 && t.s.players[w2].score === before, "give up = 0, nobody votes");
  ok(runOut(t), "all 3 turns play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(SIDE_QUEST, 5);
  adv(500);
  t.input(t.host.me.id, "sq-go");
  adv(2000);
  ok(t.s.turns === 5, "default length: everyone once (5 players, 5 turns)");
  ok(waitPhase(t, "do", 20000), "into the quest");
  const who = t.s.turn.who;
  t.input(who, "done");
  ok(waitPhase(t, "vote", 4000), "the vote opens");
  const sk = t.s.left;
  ok(sk <= SIDEQUEST.VOTE_MS && waitPhase(t, "result", SIDEQUEST.VOTE_MS + 2000), "the vote closes on its own ~30 s after Done");
  ok(t.s.turn.n === 0 && t.s.turn.pts === 0, "no votes: no points");
  ok(waitPhase(t, "do", 30000), "next turn");
  t.drop(t.s.turn.who);
  adv(3000);
  ok(t.s.turn.skipped && t.s.phase !== "do", "the player on the quest leaves: the turn is skipped, nobody waits");
  ok(runOut(t), "and the game still finishes");
}
{
  const adult = { name: "x", privacy: "private", settings: { adult: true } };
  const t = seatTable(SIDE_QUEST, 3, { party: adult });
  adv(500);
  for (const c of ["anywhere", "strangers"]) t.input(t.host.me.id, "sq-cat", { cat: c, on: false });
  t.input(t.host.me.id, "sq-go");
  adv(2000);
  ok(t.s.turn?.quest.level === "unhinged", "an 18+ party can play unhinged quests only");
  // this one doesn't play out: stop it, or it keeps running (and drawing
  // into the shared game panel) under every spec after it
  for (const c of t.clients) c.game?.stop();
  ui.hide();
}

group("The party set: 3 games, places, standings");
{
  const R = (scores, completed = true) => ({ completed, players: Object.entries(scores).map(([id, score]) => ({ id, handle: id, score, gone: false, bot: id.startsWith("bot") })) });
  let set = newSet(1, "sess");
  ok(places(R({ a: 50, b: 50, c: 10, bot1: 99 })).map(p => `${p.id}${p.place}`).join() === "a1,b1,c3", "ties share a place; bots are left out");
  set = addGame(set, "mission", R({ a: 300, b: 200, c: 100 }));
  set = addGame(set, "ritual", R({ a: 0, b: 0, c: 0 }, false));
  ok(set.games.length === 1, "a game that didn't complete doesn't count toward the 3");
  set = addGame(set, "ritual", R({ a: 10, b: 900, c: 40 }));
  set = addGame(set, "sidequest", R({ b: 5, c: 9 }));
  ok(set.done && set.games.length === 3, "after 3 completed games the set is done");
  ok(addGame(set, "mission", R({ a: 1 })).games.length === 3, "nothing is added after the set is done");
  const rows = standings(set, [{ id: "a", handle: "a" }, { id: "b", handle: "b" }, { id: "c", handle: "c" }]);
  const P = LEADERBOARD.PLACE_POINTS;
  ok(rows[0].id === "b" && rows[0].total === P[1] + P[0] + P[1], `standings total the place points (b: ${rows[0].total})`);
  ok(rows.find(r => r.id === "a").last === 0 && rows.find(r => r.id === "c").last === P[0], "`last` is what the latest game added");
  ok(fullParticipants(set).join() === "b,c", "full participants: only those in all 3 games");
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
group("Party room — every room's spots are reachable, and paths go around the furniture");
{
  const inBlock = (R, x, y) => R.block.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);
  for (const [vibe, R] of Object.entries(ROOMS)) {
    ok(walkable(vibe, ...R.door), `${vibe}: the door spot is on the floor`);
    ok(walkable(vibe, ...R.tv.at), `${vibe}: the spot in front of the TV is on the floor`);
    // corner to corner, through the furniture: every sampled point stays off it
    const from = R.door, to = [R.walk.x0 + 30, R.walk.y1 - 30];
    const path = findPath(vibe, from, to);
    let clear = true, at = from;
    for (const p of path) {
      for (let i = 0; i <= 20; i++) { const x = at[0] + (p[0] - at[0]) * i / 20, y = at[1] + (p[1] - at[1]) * i / 20; if (inBlock(R, x, y)) clear = false; }
      at = p;
    }
    ok(path.length > 0 && clear, `${vibe}: door to the far corner walks around every table and prop (${path.length} legs)`);
    const tvPath = findPath(vibe, to, R.tv.at), end = tvPath.at(-1);
    ok(Math.hypot(end[0] - R.tv.at[0], end[1] - R.tv.at[1]) < 1, `${vibe}: you can always walk to the TV`);
  }
  const R = ROOMS.chill, [bx0, by0, bx1, by1] = R.block[5];
  const end = findPath("chill", R.door, [(bx0 + bx1) / 2, (by0 + by1) / 2]).at(-1);
  ok(!inBlock(R, ...end), "tapping on a table walks you to the nearest free spot next to it");
}

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
