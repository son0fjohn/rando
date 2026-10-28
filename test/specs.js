// House-party specs. Plays every game end to end on the fake bus + virtual
// clock and asserts the rules the brief actually names.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY, diaryPool, maxLevelFor, capAt, yesnoTarget, countLine, shelfPages } from "/web/hpgames/secretdiary.js";
import * as CONFIG from "/web/hpconfig.js";
import { promptLog } from "/web/hplog.js";
import { HUMILIATION_RITUAL, judge, ritualPool, ritualPromptsFor, ritualPoints, PICK_MS, OPEN_MS } from "/web/hpgames/ritual.js";
import { SIDE_QUEST, questPool, questsFor, questPoints } from "/web/hpgames/sidequest.js";
import { MASK_OFF, maskPool, nextAsker, canAsk, notAskedYet } from "/web/hpgames/maskoff.js";
import { fairPick, chances } from "/web/fairpick.js";
import { newSet, places, addGame, addPartial, standings, fullParticipants, nextGameNo } from "/web/partyset.js";
import { MANHUNT_GAME } from "/web/hpgames/manhunt.js";
import * as G from "/web/mhgeo.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { MANHUNT, DIARY, RITUAL, SIDEQUEST, MASKOFF, LEADERBOARD } from "/web/hpconfig.js";
import { resultsHtml, trash, Rounds } from "/web/hpkit.js";
import { ui, finalResults } from "/web/gamekit.js";
import { HOWTO, HOWTO_MS } from "/web/howto.js";
import { findPath, walkable } from "/web/hplobby.js";
import { ROOMS } from "/web/roomdefs.js";
import { PMTiles, zxyToTileId } from "/web/pmtiles.js";
import { buildChunk, lngLatToTile, worldHeight, earcut, orientedBox, ringArea } from "/web/citygen.js";
import { decodeMVT, ringArea as mvtArea } from "/web/mvt.js";
import { omtChunks } from "/web/cityomt.js";
import { dayness, setDay, getDay } from "/web/daylight.js";
import { STRINGS, NAME_PARTS, suggestName, t as tr, setLang, lang as lang0 } from "/web/i18n.js";
import { EVENTS, clean, track } from "/web/analytics.js";
import { starterLook, e164, otpWait, otpError, OTP } from "/web/onbkit.js";
import { invitePage } from "/api/invite.mjs";
import { STARTER_OUTFITS4, normalizeAvatar4 } from "/web/items4.js";

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (cls, msg) => { const s = document.createElement("span"); s.className = cls; s.textContent = (cls === "head" ? "" : cls === "pass" ? "  ✓ " : "  ✗ ") + msg + "\n"; out.appendChild(s); };
const ok = (cond, msg) => { if (cond) { pass++; log("pass", msg); } else { fail++; log("fail", msg); } };
const group = name => { log("head", "\n" + name); console.info(`[spec] ${name}`); };

// the diary's prompt pool is fetched at import; have it before any clock tricks
const POOL = await diaryPool();
const HR_POOL = await ritualPool();
const SQ = await questPool();
const MO = await maskPool();
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
// let promises settle (the faked clock doesn't run them; the page must yield)
const settle = async () => { for (let i = 0; i < 20; i++) await null; };
function waitPhase(t, phase, maxMs = 5 * 60 * 1000) {
  let spent = 0;
  while (t.s?.phase !== phase && spent < maxMs) { adv(STEP); spent += STEP; }
  return t.s?.phase === phase;
}

// The suite runs in three page loads (run.mjs: ?part=1, 2, 3): each
// is one long synchronous stretch, and Chromium only frees the DOM garbage
// of all the panel rebuilds when the page yields — in one go the renderer
// grew past 6 GB and CI's Chromium 131 ran out of memory. No ?part = all.
const PART = new URLSearchParams(location.search).get("part");
if (!PART || PART === "1") {
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

group("Secret Diary — the timers");
{
  const t = seatTable(SECRET_DIARY, 4);
  adv(300);
  ok(t.s.phase === "deal" && t.s.left > DIARY.DEAL_MS - 1000, "the deal has its own clock (it sends by itself)");
  t.input("p1", "send"); adv(400);
  const n = t.s.batch.length;
  ok(t.s.phase === "answer" && Math.abs(t.s.left - DIARY.ANSWER_MS_PER_Q * n) < 1500 && DIARY.ANSWER_MS_PER_Q === 45000, `answering: one clock for the batch, 45 s a question (${n} → ${Math.round(t.s.left / 1000)} s)`);
  const before = t.s.left;
  t.input("p2", "more"); adv(100);
  ok(t.s.left < before, "only the host can add time");
  t.input("p1", "more"); adv(100);
  const after = t.s.left;
  ok(after > before + DIARY.MORE_MS - 1000, "the host's +30s adds 30 seconds");
  t.input("p1", "more"); adv(100);
  ok(t.s.left < after, "…once per phase");
  const who = SD_IDS(t);
  answerAll(t, who, { yes: id => +id.slice(1) % 2 === 0 });
  who.forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), "everyone submitted: it ends early");
  ok(t.s.left <= DIARY.GUESS_MS + 500 && DIARY.GUESS_MS === 45000, `guessing: 45 s a question (${Math.round(t.s.left / 1000)} s)`);
  const g0 = t.s.left;
  t.input("p1", "more"); adv(100);
  ok(t.s.left > g0 + DIARY.MORE_MS - 1000, "+30s is there again for each question's guessing");
  ok(waitPhase(t, "points", DIARY.GUESS_MS_MAX + 40000), "nobody guessed: the clock runs out and the question moves on (their guesses are skipped)");
  ok(t.s.left <= DIARY.POINTS_MS && DIARY.POINTS_MS === 6000, "the points screen: 6 s, then on");
  adv(DIARY.POINTS_MS + 1500);
  ok(t.s.phase === "reveal" || t.s.phase === "end", `…and it moves on by itself (${t.s.phase})`);
  ok(DIARY.URGENT_MS === 10000, "the last 10 s go red and tick");
  for (const c of t.clients) c.game?.stop();
  trash.flush("spec");
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

group("Secret Diary — a phone that reloads mid-game is put back in, not waited on");
{
  // iOS reloads a backgrounded tab: same id, back in presence, but the page
  // never saw the launch. It must get the game back and be able to finish,
  // so the round still ends the moment everyone's done, not on its timer.
  const t = seatTable(SECRET_DIARY, 3);
  adv(300); t.input("p1", "send"); adv(400);
  ok(t.host.game.seated("p3") && !t.host.game.seated("stranger"), "the host knows who's seated in the game (and who isn't)");
  answerAll(t, ["p1", "p2"]);
  answerAll(t, ["p3"], { skip: (id, k) => k > 1 });          // p3 answers 2 of 5…
  adv(400);
  ok(t.rejoin("p3"), "…then p3's page reloads: the host re-launches the game for them");
  adv(1000);
  ok(t.stateOf("p3")?.phase === "answer" && t.stateOf("p3").batch.length === 5, "the reloaded phone renders the live answer window from the next snapshot");
  ok(t.s.players.p3.gone === false && Object.keys(t.s.players.p3.answers).length === 2, "they're present, and the answers they gave before the reload are still saved");
  answerAll(t, ["p3"], { skip: (id, k) => k <= 1 });
  ["p1", "p2", "p3"].forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), "they finish and submit: the reveal starts at once, not when the window runs out");
  ok(t.s.qs.every(q => q.cands.includes("p3")), "all of p3's answers count");
  adv(400);
  ok(t.rejoin("p2"), "p2 reloads mid-reveal");
  adv(1000);
  ok(t.stateOf("p2")?.phase === t.s.phase && t.stateOf("p2")?.qi === t.s.qi, "and is back on the same question");
  ok(lockThrough(t, ["p1", "p2", "p3"]), "every reveal still moves on as soon as all three lock in");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // the host's own page reloads: hosting passes on, and the new host puts them back in
  const t = seatTable(SECRET_DIARY, 3);
  adv(300); t.input("p1", "send"); adv(400);
  answerAll(t, ["p1", "p2", "p3"]);
  adv(400);                                                   // (the next snapshot carries the answers, as when a host leaves)
  ok(t.rejoin("p1"), "the host's page reloads mid-answer: the next player hosts and re-launches the game for them");
  adv(1000);
  ok(t.host?.me.id === "p2" && t.stateOf("p1")?.phase === "answer", "p2 carries the game on; p1 is back in it as a player");
  ["p1", "p2", "p3"].forEach(id => t.input(id, "submit"));
  ok(waitPhase(t, "reveal", 4000), "everyone submits, the old host too: the reveal starts at once");
  ok(t.s.qs[0].cands.length === 3, "and every answer, the old host's included, counts");
  ok(lockThrough(t, ["p1", "p2", "p3"]), "and plays through to the results");
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

}
if (!PART || PART === "2") {
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
  // the server stand-in: who asked, for which turn, and what it dealt them
  const asked = [];
  const SECRET = HR_POOL.find(p => p.text === "Kid throwing a tantrum");
  const t = seatTable(HUMILIATION_RITUAL, 4, { drawPrompt: async (args, me) => { asked.push({ ...args, me }); return { id: SECRET.id, text: SECRET.text }; } });
  const leaks = () => [...Object.keys(t.s.players)].some(id => { const j = JSON.stringify(t.stateOf(id) ?? {}); return HR_POOL.some(p => j.includes(p.text) || j.includes(p.id)); });
  adv(500);
  ok(t.s.turns === 4, "default: everyone performs once (4 turns)");
  ok(t.s.phase === "pick", "each turn opens with the Boss's pick");
  const r0 = t.s.turn, perf = r0.performer;
  ok(!!perf && /^[0-9a-f]{24}$/.test(r0.key), "a performer is picked, and the turn gets a random key");
  ok(Array.isArray(r0.cast) && r0.cast.length === 4 && r0.cast.includes(perf), "the turn's cast: up to 5 players, the performer among them");
  ok(!("prompt" in r0) && !r0.answer && !leaks(), "the synced state carries no prompt and no prompt id, on any phone");
  for (let i = 0; i < 6; i++) { adv(400); await settle(); }
  ok(asked.length === 1 && asked[0].me === perf && asked[0].turn === r0.key && asked[0].room === "party-TEST" && asked[0].level === "spicy",
    `only the performer's phone asks the server for the prompt (${asked.map(a => a.me).join(",")} for ${asked[0]?.level})`);
  ok(waitPhase(t, "open") && !leaks(), "he twists the capsule open; still nothing in the state");
  ok(waitPhase(t, "act"), "then the acting starts");
  const [g1, g2] = Object.keys(t.s.players).filter(x => x !== perf);
  t.input(g1, "guess", { text: "completely wrong" });
  t.input(g2, "guess", { text: "a toddler having a meltdown" });
  t.input(perf, "guess", { text: "me me me" });
  t.input(perf, "answer", { key: r0.key, text: "spoiler" });
  t.input(g1, "answer", { key: r0.key, text: "spoiler" });
  adv(600);
  ok(t.s.turn.guesses.length === 2, "guesses reach the performer's feed; the performer can't guess");
  ok(t.s.turn.guesses.every(g => !("hint" in g)), "the host adds no hints (it doesn't know the answer); the performer's phone works them out");
  ok(!t.s.turn.answer && !leaks(), "nobody can reveal the answer mid-turn, not even the performer");
  ok(t.s.phase === "act" && !t.s.turn.won, "a guess does NOT end the turn by itself — the performer decides");
  const right = t.s.turn.guesses.find(g => g.by === g2);
  t.input(g1, "pick", { gid: right.gid });
  adv(400);
  ok(!t.s.turn.won, "a guesser can't call a guess right");
  t.input(perf, "pick", { gid: right.gid });
  adv(2000);
  ok(t.s.turn.won?.by === g2 && t.s.phase === "result", "the performer taps the right guess and the turn ends");
  ok(t.s.players[g2].score > t.s.players[perf].score && t.s.players[perf].score > 0 && t.s.players[g1].score === 0, `the guesser scores more than the performer (${t.s.players[g2].score} vs ${t.s.players[perf].score}); nobody else scores`);
  for (let i = 0; i < 5; i++) adv(400);
  ok(t.s.turn.answer === SECRET.text, `once it's over, the performer's phone reveals it to everyone ("${t.s.turn.answer}")`);
  t.input(g1, "answer", { key: r0.key, text: "fake" });
  adv(400);
  ok(t.s.turn.answer === SECRET.text, "and only the performer's answer counts");

  // nobody gets it: time runs out, nobody scores, the answer is shown
  ok(waitPhase(t, "act"), "the next performer is up");
  await settle();
  ok(asked.length === 2 && asked[1].me === t.s.turn.performer && asked[1].turn === t.s.turn.key && asked[1].turn !== r0.key, "the next performer's phone asks for theirs, for the new turn");
  const before = Object.fromEntries(Object.values(t.s.players).map(p => [p.id, p.score]));
  ok(waitPhase(t, "result", RITUAL.ACT_MS + 5000), "time runs out");
  ok(!t.s.turn.won && Object.values(t.s.players).every(p => p.score === before[p.id]), "nobody scores when time runs out");
  ok(runOut(t), "all turns play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // no server hook (the offline pages): the performer's own phone draws it
  const t = seatTable(HUMILIATION_RITUAL, 3, { options: { rounds: "2" } });
  adv(500);
  ok(t.s.turns === 6, "the host can set everyone twice (3 players: 6 turns)");
  await settle();
  ok(waitPhase(t, "result", PICK_MS + OPEN_MS + RITUAL.ACT_MS + 5000), "with no server, a turn still plays out");
  for (let i = 0; i < 5; i++) adv(400);
  ok(HR_POOL.some(p => p.text === t.s.turn.answer), `…the performer's phone drew from the pool and reveals it at the end ("${t.s.turn.answer}")`);
  ok(waitPhase(t, "act"), "into the next act");
  const gone = t.s.turn.performer;
  t.drop(gone);
  adv(4000);
  ok(t.s.turn.skipped === true || t.s.phase !== "act", "a performer who leaves ends their turn, nobody waits");
  ok(!t.s.turn.answer, "…and their prompt stays a secret");
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
  ok(t.s.phase === "spin" && t.s.turns === 3, "start: the wizard's ball spins first; the host's 3 turns stick");
  ok(!!t.s.turn.who && t.s.turn.quest === null, "the player is picked first, before any quest is drawn");
  const picked = t.s.turn.who;
  ok(waitPhase(t, "quest", 10000) && !!t.s.turn.quest && t.s.turn.who === picked, "then the ball reveals their quest (same player)");
  const q0 = t.s.turn.quest;
  ok(q0.category === "anywhere" && q0.id !== SQ.quests[0].id || q0.id === one.id, "the quest comes from what's switched on");
  ok(waitPhase(t, "do", 20000), "the ball reveals the quest, spins and lands; the timer starts");
  ok(t.s.left > SIDEQUEST.DO_MS - 1500, "3 minutes on the clock");
  const who = t.s.turn.who, voters = Object.keys(t.s.players).filter(x => x !== who);
  // rating is open from the first second of the turn
  t.input(who, "rate", { v: 5 });
  t.input(voters[0], "rate", { v: 5 }); t.input(voters[1], "rate", { v: 3 }); t.input(voters[1], "rate", { v: 1 });
  adv(400);
  ok(t.s.phase === "do" && t.s.turn.votes[voters[0]] === 5, "the room rates while the quest is on");
  ok(t.s.turn.votes[who] === undefined, "you can't rate your own quest");
  ok(t.s.turn.votes[voters[1]] === 3, "one tap locks a rating in: a second tap doesn't change it");
  t.input(voters[2], "rate", { v: 9 });
  adv(300);
  ok(t.s.turn.votes[voters[2]] === undefined && t.s.phase === "do", "ratings are 1-5 stars, and the turn waits for everyone");
  const clockLeft = t.s.left;
  t.input(voters[2], "rate", { v: 4 });
  ok(waitPhase(t, "result", 3000), "everyone has rated: the turn ends at once");
  ok(clockLeft > SIDEQUEST.DO_MS - 10000, `…with most of the 3 minutes still on the clock (${Math.round(clockLeft / 1000)} s left)`);
  ok(t.s.turn.avg === 4 && t.s.turn.pts === 80 && t.s.players[who].score === 80, `average 4 → 80 points (got ${t.s.turn.pts})`);

  // the next turn: someone gives up
  ok(waitPhase(t, "do", 30000), "next turn: a new quest, a new pick");
  ok(t.s.turn.quest.id !== q0.id, "a different quest");
  const w2 = t.s.turn.who, before = t.s.players[w2].score;
  const other = Object.keys(t.s.players).find(x => x !== w2);
  t.input(other, "rate", { v: 5 });
  adv(300);
  t.input(w2, "giveup");
  ok(waitPhase(t, "result", 4000), "give up → straight to the result");
  ok(t.s.turn.pts === 0 && t.s.turn.n === 0 && t.s.players[w2].score === before, "give up = an automatic fail: 0, and the ratings are skipped");
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
  const who = t.s.turn.who, raters = Object.keys(t.s.players).filter(x => x !== who);
  t.input(raters[0], "rate", { v: 4 });
  adv(1000);
  ok(t.s.phase === "do", "not everyone has rated: the quest keeps going");
  ok(waitPhase(t, "result", SIDEQUEST.DO_MS + 2000), "the timer ends the turn if people haven't finished rating");
  ok(t.s.turn.n === 1 && t.s.turn.pts === 80, "the ratings that came in count (one 4 → 80)");
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
  waitPhase(t, "quest", 10000);
  ok(t.s.turn?.quest?.level === "unhinged", "an 18+ party can play unhinged quests only");
  // this one doesn't play out: stop it, or it keeps running (and drawing
  // into the shared game panel) under every spec after it
  for (const c of t.clients) c.game?.stop();
  ui.hide();
}

group("Mask Off — the deck");
{
  const ids = MO.map(c => c.id);
  const deck = await (await fetch("/web/data/mask_off_cards.json")).json();
  ok(MO.length === 93, `93 cards (${MO.length})`);
  ok([[1, 30], [2, 29], [3, 34]].every(([l, n]) => MO.filter(c => c.level === l).length === n), "30 light, 29 real, 34 deep");
  ok(new Set(ids).size === ids.length && ids.every(id => /^mo-[123]\d\d$/.test(id)), "every card has its own permanent id");
  ok(deck.retired?.length === 21 && !deck.retired.some(id => ids.includes(id)), "the old cards' ids are retired, never reused");
  ok(MO.find(c => c.id === "mo-101")?.text === "What's something that always makes you feel like a kid again?"
    && MO.find(c => c.id === "mo-224")?.text === "What's something you've stopped telling people because they don't get it?"
    && MO.find(c => c.id === "mo-324")?.text === "What would it take for you to feel truly at peace?", "the supplied deck, in order");
  ok(!MO.some(c => /\bmask (on|off)\b|honesty|\brate\b/i.test(c.text)), "no leftover cards from the old game");
  // the turn rules: round the table, never yourself, never the one just asked
  const P = ["a", "b", "c", "d"];
  ok([0, 1, 2, 3, 4].map(i => nextAsker(P, i, P).id).join("") === "abcda", "the asker goes round the table, clockwise");
  ok(nextAsker(P, 1, ["a", "c", "d"]).id === "c", "…skipping whoever left");
  ok(canAsk(P, "a", "b").join() === "c,d", "the asker can't pick themselves, or whoever was asked last turn");
  ok(canAsk(["a", "b"], "a", "b").join() === "b", "…unless that leaves nobody");
  ok(notAskedYet({ a: 1, b: 0, c: 1, d: 0 }, P).join() === "b,d", "whoever hasn't been asked yet glows");
}

// through the setup and into turn 1 (4 players unless said otherwise)
function moTable(n = 4, setup = []) {
  const t = seatTable(MASK_OFF, n);
  adv(500);
  for (const [k, v] of setup) t.input("p1", k, v);
  adv(400);
  t.input("p1", "mo-go");
  return t;
}

group("Mask Off — the host's setup");
{
  const t = seatTable(MASK_OFF, 4);
  adv(500);
  ok(t.s.phase === "setup" && MASK_OFF.hostSetup.includes("setup"), "opens on the host's setup screen (Back like every setup)");
  ok(t.s.setup.levels.join() === "1,2" && t.s.setup.rounds === 2, "default: light + real, everyone asks twice");
  t.input("p2", "mo-lv", { l: 3, on: true }); t.input("p2", "mo-go");
  adv(400);
  ok(t.s.phase === "setup" && t.s.setup.levels.join() === "1,2", "only the host can change the deck or deal");
  t.input("p1", "mo-lv", { l: 3, on: true }); t.input("p1", "mo-lv", { l: 1, on: false });
  adv(400);
  ok(t.s.setup.levels.join() === "2,3", "the host picks the levels (real + deep)");
  t.input("p1", "mo-lv", { l: 2, on: false }); t.input("p1", "mo-lv", { l: 3, on: false });
  adv(400);
  ok(t.s.setup.levels.join() === "3", "at least one level stays in");
  t.input("p1", "mo-rounds", { n: 1 }); t.input("p1", "mo-rounds", { n: 9 });
  adv(400);
  ok(t.s.setup.rounds === 1, "the host sets the rounds (1-3)");
  t.input("p1", "mo-go");
  ok(waitPhase(t, "pick", 3000), "deal → the first turn");
  ok(t.s.turns === 4, `everyone once: 4 turns (${t.s.turns})`);
  const hands = Object.values(t.s.hands), all = hands.flat();
  ok(hands.length === 4 && hands.every(h => h.length === 5), "everyone is dealt a hand of 5");
  ok(new Set(all).size === all.length, "no card is in two hands");
  ok(all.every(id => MO.find(c => c.id === id)?.level === 3), "every card is from the chosen level");
  ok(all.every(x => typeof x === "string" && /^mo-\d{3}$/.test(x)), "hands are card ids only: no card text in the state until it's asked");
}

group("Mask Off — a turn: pick someone, ask, answer, same, go deeper");
{
  const t = moTable(4);
  ok(waitPhase(t, "pick", 3000), "deal → the first turn: whose turn it is");
  const asker = t.s.turn.asker;
  ok(asker === t.s.order[0] && !t.s.turn.who, `the first one round the table asks (${asker}), nobody picked yet`);
  ok(waitPhase(t, "choose", 6000), "they pick someone and a card");
  ok(t.s.left > MASKOFF.CHOOSE_MS - 1000, "a 45-second pick");
  const hand = t.s.hands[asker].slice(), others = t.s.order.filter(id => id !== asker);
  t.input(asker, "ask", { id: hand[0] });
  adv(400);
  ok(t.s.phase === "choose" && !t.s.turn.card, "no card goes before someone's picked");
  t.input(asker, "who", { who: asker });
  t.input(others[0], "who", { who: others[1] });
  adv(400);
  ok(!t.s.turn.who, "nobody can pick themselves, and only the asker picks");
  t.input(asker, "who", { who: others[1] });
  adv(300);
  ok(t.s.turn.who === others[1], "the asker taps someone at the table: picked (everyone sees it)");
  t.input(asker, "who", { who: others[0] });
  adv(300);
  const who = others[0];
  ok(t.s.turn.who === who, "…and can change their mind until they ask");
  t.input(others[1], "ask", { id: t.s.hands[others[1]][0], who });
  t.input(asker, "ask", { id: MO.find(c => !hand.includes(c.id)).id, who });
  adv(400);
  ok(t.s.phase === "choose" && !t.s.turn.card, "only the asker, and only a card from their own hand");
  t.input(asker, "ask", { id: hand[2], who });
  ok(waitPhase(t, "talk", 3000), "Ask: the card flips up in the middle of the table for everyone");
  ok(t.s.turn.card.id === hand[2] && !t.s.hands[asker].includes(hand[2]) && !t.s.turn.auto, "the card leaves their hand");
  ok(t.s.hands[asker].length === 5, "…and they draw a new one: always 5 in hand");
  const L = Object.keys(t.s.players).filter(id => id !== who);
  t.input(L[0], "same");
  adv(400);
  ok(t.s.turn.same === 0, "nobody can tap Same before the answer starts");
  t.input(L[0], "answer");
  adv(400);
  ok(!t.s.turn.status, "only the one asked can start the answer");
  t.input(who, "answer");
  adv(400);
  ok(t.s.turn.status === "answering", "Answer: their mask comes off");
  t.input(L[0], "same"); t.input(L[0], "same"); t.input(L[1], "same"); t.input(who, "same");
  adv(400);
  ok(t.s.turn.same === 2, `Same: one each, never the answerer's own (${t.s.turn.same})`);
  ok(L.filter(id => id !== asker).every(id => !JSON.stringify(t.s.turn).includes(id)), "only the count is in the state, never who tapped");
  t.input(L[2], "deeper"); t.input(L[1], "deeper");
  adv(400);
  ok(t.s.turn.deeper?.text === MASKOFF.DEEPER[0] && t.s.turn.deepers === 1, "Go deeper: one gentle follow-up at a time");
  t.input(L[2], "deeper-take");
  adv(300);
  ok(!t.s.turn.deeper.state, "only the answerer takes it or passes");
  t.input(who, "deeper-take");
  adv(300);
  ok(t.s.turn.deeper.state === "took", "they take it");
  t.input(L[1], "deeper"); adv(300); t.input(who, "deeper-pass"); adv(300); t.input(L[0], "deeper"); adv(300);
  ok(t.s.turn.deepers === MASKOFF.DEEPER_MAX && t.s.turn.deeper.state === "passed", `…or pass it; at most ${MASKOFF.DEEPER_MAX} per answer`);
  t.input(who, "done");
  ok(waitPhase(t, "after", 3000), "Done ends the turn (the mask goes back on)");
  ok(t.s.players[who].score === 1 && t.s.sameTotal === 2, "an answer counts (no points beyond that); the Same taps add up");
  // the next one round the table; the one just asked can't be picked
  ok(waitPhase(t, "choose", 12000), "next turn");
  const t2 = t.s.turn;
  ok(t2.asker === t.s.order[1], "the turn passes clockwise");
  t.input(t2.asker, "who", { who });
  adv(300);
  ok(!t.s.turn.who && t.s.lastWho === who, "the one just asked can't be picked again straight away");
  const w2 = t.s.order.find(id => id !== t2.asker && id !== who);
  t.input(t2.asker, "ask", { id: t.s.hands[t2.asker][0], who: w2 });
  ok(waitPhase(t, "talk", 3000) && t.s.turn.who === w2, "asked (picking and asking in one tap works too)");
  const before = t.s.players[w2].score;
  t.input(w2, "pass");
  ok(waitPhase(t, "after", 3000) && t.s.turn.status === "passed", "Pass: the mask stays on, the turn moves on");
  ok(t.s.players[w2].score === before && t.s.turn.same === 0, "no penalty, nothing counted");
  // the clock picks: someone who hasn't been asked yet, and a card
  ok(waitPhase(t, "choose", 12000), "next turn");
  const a3 = t.s.turn.asker, h3 = t.s.hands[a3].slice(), fresh = notAskedYet(t.s.asked, canAsk(t.s.order, a3, t.s.lastWho));
  ok(waitPhase(t, "talk", MASKOFF.CHOOSE_MS + 2000), "nobody taps: after 45 s…");
  ok(t.s.turn.auto && h3.includes(t.s.turn.card.id) && fresh.includes(t.s.turn.who), "…the deck picks someone who hasn't been asked yet, and a card from their hand");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Mask Off — a whole game");
{
  const t = moTable(4, [["mo-lv", { l: 3, on: true }]]);
  const asks = [], cards = [], whos = [];
  let self = 0, twice = 0;
  while (!t.allEnded()) {
    const q = t.s?.turn;
    if (!q) { adv(1000); continue; }
    if (t.s.phase === "choose" && !q.card) {
      // the asker picks whoever's been asked least (as the glow suggests)
      const ok2 = canAsk(t.s.order, q.asker, t.s.lastWho), pick = notAskedYet(t.s.asked, ok2)[0];
      t.input(q.asker, "ask", { id: t.s.hands[q.asker][0], who: pick });
    }
    if (t.s?.phase === "talk" && !q._seen) {
      q._seen = true; asks.push(q.asker); whos.push(q.who); cards.push(q.card.id);
      if (q.asker === q.who) self++;
      if (whos.length > 1 && whos.at(-1) === whos.at(-2)) twice++;
      t.input(q.who, q.who === "p4" ? "pass" : "answer");
    }
    if (t.s?.phase === "talk" && q.status === "answering") t.input(q.who, "done");
    adv(1000);
  }
  const counts = id => asks.filter(x => x === id).length;
  ok(cards.length === 8 && ["p1", "p2", "p3", "p4"].every(id => counts(id) === 2), `everyone asks twice, in turn round the table: 8 turns (${asks.join(" ")})`);
  ok(self === 0 && twice === 0, "nobody asks themselves, nobody is asked twice in a row");
  ok(["p1", "p2", "p3", "p4"].every(id => whos.filter(x => x === id).length === 2), `picking whoever glows, everyone's asked twice (${whos.join(" ")})`);
  ok(new Set(cards).size === cards.length, "no card comes round twice");
  const r = t.host.results;
  ok(r?.completed, "it completes: one of the party's 3 games");
  ok(r.players.every(p => p.score === (p.id === "p4" ? 0 : 1)), "no winner: everyone who answered gets the same (p4 only passed)");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = moTable(3);
  ok(waitPhase(t, "talk", 60000), "into the first card");
  t.input(t.s.turn.who, "answer");
  adv(400);
  t.drop(t.s.turn.who);
  adv(3000);
  ok(t.s.phase !== "talk", "the answerer leaves: the turn ends, nobody waits");
  ok(runOut(t, 60 * 60 * 1000), "and the game still finishes (nobody taps: every turn runs to its backstop)");
}
{
  const t = moTable(4);
  ok(waitPhase(t, "choose", 10000), "a turn");
  const { asker } = t.s.turn, who = t.s.order.find(id => id !== asker);
  t.input(asker, "who", { who });
  adv(300);
  t.drop(who);
  adv(3000);
  ok(t.s.phase === "choose" && !t.s.turn.who, "the one picked leaves before the card: the asker just picks someone else");
}

group("The party set: 3 games, places, standings");
{
  const R = (scores, completed = true) => ({ completed, players: Object.entries(scores).map(([id, score]) => ({ id, handle: id, score, gone: false, bot: id.startsWith("bot") })) });
  let set = newSet(1, "sess");
  ok(places(R({ a: 50, b: 50, c: 10, bot1: 99 })).map(p => `${p.id}${p.place}`).join() === "a1,b1,c3", "ties share a place; bots are left out");
  set = addGame(set, "mask_off", R({ a: 300, b: 200, c: 100 }));
  set = addGame(set, "ritual", R({ a: 0, b: 0, c: 0 }, false));
  ok(set.games.length === 1, "a game that didn't complete doesn't count toward the 3");
  set = addGame(set, "ritual", R({ a: 10, b: 900, c: 40 }));
  set = addGame(set, "sidequest", R({ b: 5, c: 9 }));
  ok(set.done && set.games.length === 3, "after 3 completed games the set is done");
  ok(addGame(set, "mask_off", R({ a: 1 })).games.length === 3, "nothing is added after the set is done");
  const rows = standings(set, [{ id: "a", handle: "a" }, { id: "b", handle: "b" }, { id: "c", handle: "c" }]);
  const P = LEADERBOARD.PLACE_POINTS;
  ok(rows[0].id === "b" && rows[0].total === P[1] + P[0] + P[1], `standings total the place points (b: ${rows[0].total})`);
  ok(rows.find(r => r.id === "a").last === 0 && rows.find(r => r.id === "c").last === P[0], "`last` is what the latest game added");
  ok(fullParticipants(set).join() === "b,c", "full participants: only those in all 3 games");
  // a game the host ended mid-way
  const E = (scores, extra = {}) => ({ ...R(scores, false), ended: true, ...extra });
  let s2 = addGame(newSet(1, "s2"), "mask_off", R({ a: 30, b: 20, c: 10 }));
  s2 = addPartial(s2, "ritual", E({ a: 0, b: 40, c: 15 }));
  ok(s2.games.length === 1 && !s2.done && s2.extra.length === 1, "an ended game isn't one of the 3 games");
  const r2 = Object.fromEntries(standings(s2, []).map(r => [r.id, r.total]));
  ok(r2.b === P[1] + P[0] && r2.c === P[2] + P[1] && r2.a === P[0], `…but what was earned still counts on the board, by place among those who'd scored (a ${r2.a}, b ${r2.b}, c ${r2.c})`);
  ok(addPartial(s2, "ritual", E({ a: 0, b: 0 })).extra.length === 1, "an ended game where nobody had scored adds nothing");
  ok(addPartial(s2, "sidequest", E({ a: 5 }, { backout: true })).extra.length === 1, "backing out of a setup screen adds nothing");
  ok(fullParticipants(s2).join() === "a,b,c" && nextGameNo(s2) === 2, "ended games don't change who played the set or which game is next");
}

group("The host's controls: End game anytime, Back out of a setup screen");
{
  const t = moTable(4);
  ok(waitPhase(t, "choose", 10000), "a Mask Off turn is on");
  const { asker } = t.s.turn, who = t.s.order.find(id => id !== asker);
  t.input(asker, "ask", { id: t.s.hands[asker][0], who });
  ok(waitPhase(t, "talk", 3000), "asked");
  t.input(who, "answer"); adv(300); t.input(who, "done");
  ok(waitPhase(t, "after", 4000) && t.s.players[who].score === 1, "someone has answered");
  const guest = t.clients.find(c => !c.room.isHost);
  guest.game.endByHost();
  adv(300);
  ok(!guest.ended && t.s?.phase === "after", "a player can't end the game");
  t.host.game.endByHost();
  adv(300);
  ok(t.clients.every(c => c.ended), "the host ends it: everyone is out at once");
  const r = t.host.results, rg = guest.results;
  ok(r?.ended && !r.completed && rg?.ended && !rg.completed, "it counts as ended, not completed (no coins, not one of the 3)");
  ok(r.players.find(p => p.id === who)?.score === 1, "the standings so far go with it, for the party board");
  ok(t.clients.every(c => c.game.s === null), "every phone drops the game's state (hands, cards, timers)");
}
{
  const t = seatTable(SIDE_QUEST, 4);
  adv(500);
  ok(t.s.phase === "setup" && SIDE_QUEST.hostSetup.includes("setup"), "Side Quest's quest picking is a host setup screen");
  t.host.game.endByHost({ backout: true });
  adv(300);
  ok(t.clients.every(c => c.ended && c.results?.backout && !c.results.completed), "Back: out of the setup, nothing started, nothing counted");
  ok(SECRET_DIARY.hostSetup.includes("deal") && MASK_OFF.hostSetup.includes("setup"), "Secret Diary's deal and Mask Off's deck are host setup screens too");
}

}
if (!PART || PART === "3") {
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
// Manhunt: a phone is "at" wherever its test hook puts it (__mhPhones[id].setPos)
const MH = { c: [37.5346, 126.9946] };
const mhAt = (east, north) => [MH.c[0] + north / 110540, MH.c[1] + east / (111320 * Math.cos(MH.c[0] * Math.PI / 180))];
const mhPhone = id => window.__mhPhones?.[id];
window.__mh3dOff = true;   // many phones in one page: the elevator plays as a card
// (party.js empties the bin when a game ends; the harness doesn't: do it here,
// so a host scene an earlier table was still loading doesn't render on behind us)
trash.flush("spec: next game");
// a table's done: end it for everyone, so its phones stop (timers, crypto, location)
const mhDone = t => { t.host?.game?.endByHost(); adv(400); };
// WebCrypto (the team channel) settles on real turns of the page, not on the fake clock
const mhTurn = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const mhSettle = async (n = 40) => { for (let i = 0; i < n; i++) { await mhTurn(); adv(50); } };
function mhTable(n = 5, { teams = { p2: "hunter" }, round = 10, ping = 2, head = 1, powers = true, join = true } = {}) {
  const t = seatTable(MANHUNT_GAME, n);
  const sent = [];
  const deliver = t.bus.deliver.bind(t.bus);
  t.bus.deliver = m => { if (/^mh-|^ev$|^input$/.test(m.type)) sent.push(m); deliver(m); };
  t.sent = sent;
  adv(300);
  t.input("p1", "mh-zonedef", { zone: { type: "circle", c: MH.c, r: 600 } });
  for (const [k, v] of Object.entries({ round, ping, head, powers, join })) t.input("p1", "mh-set", { k, v });
  for (const [id, team] of Object.entries(teams)) t.input("p1", "mh-team", { id, team });
  t.input("p1", "mh-go"); adv(1600);
  return t;
}
const mhHunt = t => {
  for (const id of Object.keys(t.s.players)) t.input(id, "mh-ready");
  adv(1600 + MANHUNT.ELEVATOR_MS + t.s.setup.head * 60000 + 400);
};
const runnersOf = t => Object.values(t.s.players).filter(p => p.wasRunner).map(p => p.id);

group("Manhunt — setup: the host draws the zone, sets the clock, picks the teams");
{
  const t = seatTable(MANHUNT_GAME, 5);
  adv(300);
  ok(t.s.phase === "setup" && MANHUNT_GAME.hostSetup.includes("setup") && MANHUNT_GAME.map, "it opens on the host's setup, played on the live map");
  const S = () => t.s.setup;
  ok(S().round === MANHUNT.ROUND.def && S().ping === MANHUNT.PING.def && S().head === MANHUNT.HEADSTART.def && S().shrink && S().powers && S().join,
    `defaults: ${S().round} min round, a ping every ${S().ping} min, ${S().head} min head start, shrinking zone, powers, tagged runners join the hunters`);
  t.input("p1", "mh-go"); adv(200);
  ok(!S().go && /zone/.test(S().err), `no zone, no start ("${S().err}")`);
  t.input("p1", "mh-zonedef", { zone: { type: "circle", c: MH.c, r: 60 } }); t.input("p1", "mh-go"); adv(200);
  ok(!S().go && /bigger/.test(S().err), "a zone smaller than a few blocks is refused");
  t.input("p1", "mh-zonedef", { zone: { type: "circle", c: MH.c, r: 5000 } }); t.input("p1", "mh-go"); adv(200);
  ok(!S().go && /smaller/.test(S().err), "a zone over ~3 km across is refused");
  t.input("p1", "mh-zonedef", { zone: { type: "poly", pts: [mhAt(-400, -300), mhAt(400, -300), mhAt(400, 300), mhAt(-400, 300)] } }); adv(200);
  ok(G.zoneOk(S().zone)[0], "a drawn shape works too");
  t.input("p1", "mh-set", { k: "round", v: 500 }); t.input("p1", "mh-set", { k: "round", v: 45 }); t.input("p1", "mh-set", { k: "ping", v: 0 }); t.input("p1", "mh-set", { k: "head", v: 0 }); adv(200);
  ok(S().round === 45 && S().ping === MANHUNT.PING.def && S().head === 0, "settings stay inside their ranges (10 min–2 h, 1–15 min, 0–10 min)");
  t.input("p3", "mh-set", { k: "round", v: 10 }); t.input("p3", "mh-go"); adv(200);
  ok(S().round === 45 && !S().go, "only the host sets things up");
  for (const id of ["p2", "p3", "p4"]) t.input("p1", "mh-team", { id, team: "hunter" });
  t.input("p1", "mh-go"); adv(200);
  ok(!S().go && /lopsided/.test(S().err), `badly lopsided teams don't start ("${S().err}")`);
  t.input("p1", "mh-team", { id: "p3", team: "random" }); t.input("p1", "mh-team", { id: "p4", team: "runner" });
  t.input("p1", "mh-go"); adv(1600);
  ok(t.s.phase === "rules", "fixed teams start");
  const roles = Object.values(t.s.players).map(p => p.role);
  ok(roles.filter(r => r === "hunter").length === 1 && t.s.players.p2.role === "hunter", "Random fills the smaller team (1 hunter, 4 runners)");
  const t3 = seatTable(MANHUNT_GAME, 2); adv(300);
  t3.input("p1", "mh-zonedef", { zone: { type: "circle", c: MH.c, r: 600 } }); t3.input("p1", "mh-go"); adv(200);
  ok(!t3.s.setup.go && /3 players/.test(t3.s.setup.err), "at least 3 players");
  ok(t.errors().length === 0 && t3.errors().length === 0, "no errors: " + (t.errors()[0] ?? t3.errors()[0] ?? "none"));
  mhDone(t); mhDone(t3);
}

group("Manhunt — the rules card, the Hunter's opening, the head start");
{
  const t = mhTable(5, { head: 1 });
  ok(t.s.phase === "rules", "everyone gets the rules card");
  for (const id of ["p1", "p2", "p3", "p4"]) t.input(id, "mh-ready");
  adv(2000);
  ok(t.s.phase === "rules", "it waits for everyone to tap in");
  t.input("p5", "mh-ready"); adv(1600);
  ok(t.s.phase === "intro", "then the elevator opens on the Hunter");
  adv(MANHUNT.ELEVATOR_MS + 200);
  ok(t.s.phase === "headstart", "then the head start");
  adv(60000 + 400);
  ok(t.s.phase === "hunt" && t.s.hunt.len === 10 * 60000, "then the hunt, for the round's length");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
  mhDone(t);
}

group("Manhunt — privacy: positions stay on the phone; pings are fuzzy circles, never kept in the state");
{
  const t = mhTable(5, { ping: 2 });
  await mhSettle();
  mhHunt(t);
  const R = runnersOf(t), H = "p2";
  const truth = { p1: mhAt(120, 80), p3: mhAt(-200, 40), p4: mhAt(30, -250), p5: mhAt(260, 210) };
  for (const [id, pos] of Object.entries(truth)) mhPhone(id).setPos(pos);
  mhPhone(H).setPos(mhAt(0, 0));
  adv(2 * 60000 + 1000);
  ok(t.s.hunt.no === 1, "a ping on schedule");
  const pos = t.sent.filter(m => m.type === "mh-pos" && m.no === 1);
  ok(pos.length === R.length && pos.every(m => R.includes(m.from)), `every runner's phone sent a circle (${pos.length}); no hunter's did`);
  const off = pos.map(m => G.dist(m.c, truth[m.from]));
  ok(pos.every((m, i) => m.r >= MANHUNT.FUZZ.MIN_M && m.r <= MANHUNT.FUZZ.START_M && off[i] <= m.r), `each circle is 25–50 m and contains its runner (radii ${pos.map(m => m.r).join(", ")})`);
  ok(off.some(d => d > 5), `the circles are moved off the runner, not centred on them (offsets ${off.map(d => d.toFixed(0)).join(", ")} m)`);
  ok(pos.every(m => Math.abs(Math.round(m.c[0] * 110540 / 10) * 10 - m.c[0] * 110540) < 0.6), "circle centres are snapped to a 10 m grid");
  // the synced state: the zone is the only place in it
  const st = JSON.parse(JSON.stringify(t.s)); delete st.zone; delete st.setup.zone;
  const coord = /37\.5\d{2}|126\.9\d{2}/;
  ok(!coord.test(JSON.stringify(st)), "the synced state carries no player's position (only the zone)");
  ok(!t.sent.some(m => m.type === "input" && m.in !== "mh-zonedef" && coord.test(JSON.stringify(m))), "no phone ever sends its position to the host (only the host's zone, a place)");
  // the hunter sees the circles; a runner only their own
  ok(mhPhone(H).pings.size === R.length, "the hunter's phone has every runner's circle");
  // a second ping: fresh draws (the exact spot can't be averaged back out of one fixed offset)
  adv(2 * 60000 + 1000);
  const pos2 = t.sent.filter(m => m.type === "mh-pos" && m.no === 2);
  ok(pos2.length === R.length && pos2.some(m => { const a = pos.find(x => x.from === m.from); return a && (a.c[0] !== m.c[0] || a.c[1] !== m.c[1]); }), "each ping is a fresh fuzzy draw");
  ok(pos2.every(m => m.r <= pos.find(x => x.from === m.from).r), "the circles tighten as the round goes on");
  // teammates: sealed to the team; the other team can't open them
  adv(25000); await mhSettle(); adv(21000); await mhSettle();
  const team = t.sent.filter(m => m.type === "mh-team");
  ok(team.length > 0 && team.every(m => Object.keys(m.box).every(id => t.s.players[id].role === t.s.players[m.from].role)), `team positions go out sealed, only to teammates (${team.length} messages)`);
  ok(team.every(m => !coord.test(JSON.stringify(m.box))), "and as ciphertext: no coordinates readable on the wire");
  ok(mhPhone("p1").mates.size >= 1 && ![...mhPhone("p1").mates.keys()].includes(H), "a runner sees teammates (fuzzy), never a hunter");
  ok(![...mhPhone(H).mates.keys()].some(id => R.includes(id)), "a hunter's team view has no runners");
  // a locked screen: that phone sends nothing at the ping; the hunters see "no signal"
  mhPhone("p3").me.asleep = true; t.input("p3", "mh-asleep", { on: true });
  const at = t.s.hunt.next; adv(at - t.s.hunt.t + 1000);
  const no3 = t.s.hunt.no;
  ok(!t.sent.some(m => m.type === "mh-pos" && m.no === no3 && m.from === "p3") && t.sent.some(m => m.type === "mh-pos" && m.no === no3 && m.from === "p1"), "a locked phone sends nothing at a ping (the others do)");
  ok(t.s.players.p3.asleep && !t.s.players.p1.asleep, "the state only says that phone went quiet (no place)");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
  mhDone(t);
}

group("Manhunt — leaving the zone: live to the hunters after 30 s, out after 2 minutes");
{
  const t = mhTable(5, { ping: 15 });
  mhHunt(t);
  mhPhone("p3").setPos(mhAt(0, 0)); adv(1000);
  mhPhone("p3").setPos(mhAt(900, 0)); adv(1000);
  ok(t.s.players.p3.outside && !t.s.players.p3.live, "out of the zone: flagged, not yet live");
  adv(31000); mhPhone("p3").setPos(mhAt(905, 0)); adv(6000); mhPhone("p3").setPos(mhAt(910, 0)); adv(500);
  const live = t.sent.filter(m => m.type === "mh-pos" && m.from === "p3" && m.live);
  ok(t.s.players.p3.live && live.length >= 1 && live.every(m => m.r === MANHUNT.FUZZ.MIN_M), `after 30 s the hunters see them live (a 25 m circle, ${live.length} sent)`);
  mhPhone("p3").setPos(mhAt(100, 0)); adv(1000);
  ok(!t.s.players.p3.outside && !t.s.players.p3.live, "back inside: not live any more");
  mhPhone("p4").setPos(mhAt(1200, 0)); adv(2 * 60000 + 2000);
  ok(t.s.players.p4.out && !t.s.players.p4.tagged, "2 minutes outside: out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
  mhDone(t);
}

group("Manhunt — tags (in person, the runner confirms), SAFE, powers");
{
  const t = mhTable(5, { ping: 3 });
  await mhSettle();
  mhHunt(t);
  for (const [id, e] of [["p1", 100], ["p3", -150], ["p4", 50], ["p5", 220], ["p2", 0]]) mhPhone(id).setPos(mhAt(e, 40));
  t.input("p3", "mh-tag", { target: "p4" }); adv(300);
  ok(!t.s.pending, "only a hunter can tag");
  t.input("p2", "mh-tag", { target: "p4" }); adv(300);
  ok(t.s.pending?.target === "p4", "a hunter's tag waits on the runner");
  t.input("p5", "mh-tagack", { yes: true }); adv(300);
  ok(!t.s.players.p4.tagged, "only that runner can answer");
  t.input("p4", "mh-tagack", { yes: false }); adv(300);
  ok(!t.s.pending && !t.s.players.p4.tagged, "'no' and it doesn't count");
  t.input("p2", "mh-tag", { target: "p4" }); adv(MANHUNT.TAG_CONFIRM_MS + 1000);
  ok(!t.s.pending && !t.s.players.p4.tagged, "no answer in 45 s: it doesn't count");
  t.input("p2", "mh-tag", { target: "p4" }); adv(300); t.input("p4", "mh-tagack", { yes: true }); adv(400);
  ok(t.s.players.p4.tagged && t.s.players.p4.role === "hunter" && t.s.tags.length === 1, "'yes': caught, and they hunt now");
  // SAFE: hidden, can't be tagged, the clock stops for them; the host is told
  t.input("p5", "mh-safe", { on: true }); adv(300);
  t.input("p2", "mh-tag", { target: "p5" }); adv(300);
  ok(t.s.players.p5.safe && !t.s.pending, "SAFE: can't be tagged");
  const before = t.sent.filter(m => m.type === "mh-pos" && m.from === "p5").length;
  adv(3 * 60000 + 500);
  ok(t.sent.filter(m => m.type === "mh-pos" && m.from === "p5").length === before, "SAFE: no circle at the ping");
  ok(t.sent.some(m => m.type === "ev" && m.ev === "mh-safe" && m.id === "p5" && m.on), "everyone (the host too) hears about it");
  t.input("p5", "mh-safe", { on: false }); adv(300);
  ok(!t.s.players.p5.safe && t.s.players.p5.safeMs >= 3 * 60000, "back in: their clock had stopped");
  // powers: one each
  const truthP1 = mhAt(100, 40);
  t.input("p1", "mh-power", { p: "ghost" }); mhPhone("p1").me.ghost = true;     // (the button does both)
  t.input("p3", "mh-power", { p: "decoy" }); mhPhone("p3").me.decoy = true;
  t.input("p2", "mh-power", { p: "lockon", target: "p5" }); adv(300);
  const no0 = t.s.hunt.no;
  t.input("p2", "mh-power", { p: "radar" }); adv(500);
  ok(t.s.hunt.no === no0 + 1, "Radar: everyone pings right now");
  const radar = t.sent.filter(m => m.type === "mh-pos" && m.no === t.s.hunt.no);
  ok(radar.find(m => m.from === "p1")?.none, "Ghost: skipped at the next ping");
  ok(G.dist(radar.find(m => m.from === "p3").c, mhAt(-150, 40)) > 150, "Decoy: the circle lands somewhere else");
  ok(radar.find(m => m.from === "p5")?.r === MANHUNT.POWERS.lockon.M, "Lock-on: that runner's next circle is ~20 m");
  t.input("p2", "mh-power", { p: "radar" }); adv(500);
  ok(t.s.hunt.no === no0 + 1, "a power works once a game");
  t.input("p1", "mh-power", { p: "radar" }); adv(300);
  ok(!t.s.players.p1.used.radar, "runners can't use hunters' powers");
  // Sprint Alert: the hunters' phones send that runner their fuzzy circle, sealed to that phone only
  t.input("p5", "mh-power", { p: "sprint" }); adv(300);
  mhPhone("p2").setPos(mhAt(210, 40)); adv(6000); await mhSettle(); mhPhone("p2").setPos(mhAt(212, 41)); adv(500); await mhSettle();
  const near = t.sent.filter(m => m.type === "mh-near");
  ok(near.length >= 1 && near.every(m => Object.keys(m.box).join() === "p5"), `Sprint Alert: the hunters' circles go only to that runner (${near.length})`);
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
  mhDone(t);
}

group("Manhunt — the end: who wins, points, the location stops");
{
  const t = mhTable(5, { round: 10, ping: 2 });
  mhHunt(t);
  for (const id of ["p1", "p3", "p4", "p5"]) mhPhone(id).setPos(mhAt(50, 50));
  adv(3 * 60000);
  for (const r of ["p1", "p3", "p4"]) { t.input("p2", "mh-tag", { target: r }); adv(300); t.input(r, "mh-tagack", { yes: true }); adv(300); }
  adv(60000);
  t.input("p2", "mh-tag", { target: "p5" }); adv(300); t.input("p5", "mh-tagack", { yes: true }); adv(1600);
  ok(t.s.verdict === "hunters" && t.s.phase === "end", "every runner caught: the hunters win");
  ok(t.s.last === "p5", "the last one caught is the Last Survivor");
  ok(t.s.players.p2.score >= 4 * MANHUNT.POINTS.TAG && t.s.players.p2.score > t.s.players.p1.score, `the hunter's tags score, faster ones more (${t.s.players.p2.score})`);
  ok(t.s.players.p5.score > t.s.players.p1.score, "lasting longer scores more");
  const fr = finalResults(t.s);
  ok(fr.completed, "it counts as a played game (one of the party's 3; coins)");
  ok(["p1", "p2", "p3", "p4", "p5"].every(id => !mhPhone(id)?.me.pos && !mhPhone(id)?.me.watch), "every phone stopped reading its location");
  ok(runOut(t), "the results close out");
  const t2 = mhTable(4, { round: 10, ping: 5 });
  mhHunt(t2);
  adv(10 * 60000 + 3000);
  ok(t2.s.verdict === "runners" && Object.values(t2.s.players).filter(p => p.wasRunner).every(p => p.score >= MANHUNT.POINTS.UNCAUGHT), "time's up with runners free: the runners win, and the free ones score");
  ok(t.errors().length === 0 && t2.errors().length === 0, "no errors: " + (t.errors()[0] ?? t2.errors()[0] ?? "none"));
  mhDone(t2);
}

// ===================================================================== rejoin
group("How to play — the host explains it first, then the game starts");
{
  ok(Object.entries(HOWTO).every(([id, L]) => ["en", "ko"].every(l => L[l] && L[l].full.length >= 2 && L[l].full.length <= 4 && L[l].full.every(([t]) => t.length <= 80) && L[l].short?.[0])),
    "every game's lines: 2–4 short ones in full, one short one, in English and Korean");
  ok(["sidequest", "ritual", "artgallery", "mask_off", "secretdiary", "manhunt.runner", "manhunt.hunter"].every(id => HOWTO[id]), "…for every game (Manhunt: runners and hunters)");
  // into each game's how-to: Side Quest and Mask Off after the host's setup, the Diary after the deal
  const into = {
    sidequest: t => { t.input("p1", "sq-go"); adv(1500); },
    ritual: () => {},
    artgallery: () => {},
    mask_off: t => { t.input("p1", "mo-go"); adv(1500); },
    secretdiary: t => { t.input("p1", "send"); adv(1500); },
  };
  const first = { sidequest: "spin", ritual: "pick", artgallery: "photos", mask_off: "pick", secretdiary: "answer" };
  for (const [id, def] of [["sidequest", SIDE_QUEST], ["ritual", HUMILIATION_RITUAL], ["artgallery", ART_GALLERY], ["mask_off", MASK_OFF], ["secretdiary", SECRET_DIARY]]) {
    const t = seatTable(def, 4, { howto: true });
    adv(500); into[id](t);
    ok(t.s.phase === "howto", `${id}: the how-to comes first`);
    t.input("p2", "howto-ok"); t.input("p3", "howto-ok"); t.input("p4", "skip"); adv(3000);
    ok(t.s.phase === "howto", `${id}: …it waits for everyone (a guest can't skip it)`);
    t.drop("p4"); t.input("p1", "howto-ok"); adv(3000);
    ok(t.s.phase === first[id], `${id}: once everyone still here has heard it, the game starts (${t.s.phase})`);
    ok(t.errors().length === 0, `${id}: no errors: ` + (t.errors()[0] ?? "none"));
  }
  {
    const t = seatTable(HUMILIATION_RITUAL, 3, { howto: true });
    adv(500); t.input("p1", "skip"); adv(2000);
    ok(t.s.phase === "pick", "the host can skip it");
  }
  {
    const t = seatTable(ART_GALLERY, 3, { howto: true });
    adv(500); t.input("p2", "howto-ok"); t.input("p2", "howto-more"); t.input("p1", "howto-ok"); t.input("p3", "howto-ok"); adv(3000);
    ok(t.s.phase === "howto", "someone tapping How to play again is waited for");
    adv(HOWTO_MS);
    ok(t.s.phase === "photos", "…but never longer than its clock");
  }
}

group("Every game — a phone that reloads mid-game picks the game back up");
for (const [g, n] of [[SECRET_DIARY, 3], [SIDE_QUEST, 3], [HUMILIATION_RITUAL, 3], [MASK_OFF, 3], [ART_GALLERY, 3], [MANHUNT_GAME, 4]]) {
  const t = seatTable(g, n);
  adv(6000);
  const phase = t.s.phase;
  const back = t.rejoin("p2");
  adv(2000);
  ok(back && t.stateOf("p2")?.phase === t.s.phase && t.s.players.p2.gone === false, `${g.title}: re-launched, rendering the host's ${phase} phase, counted as present`);
  ok(t.errors().length === 0, `${g.title}: no errors: ` + (t.errors()[0] ?? "none"));
  ok(runOut(t, 40 * 60 * 1000), `${g.title}: plays out`);
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


group("The map — city chunks: the archive, heights, roofs, heroes, detail rings");
{
  const buf = new Uint8Array(await (await fetch("/web/tiles/cities.pmtiles")).arrayBuffer());
  // a server that honours byte ranges (R2, Vercel), and one that doesn't
  let ranges = 0;
  const ranged = new PMTiles("x", { fetch: async (u, o) => { ranges++; const [, a, b] = /bytes=(\d+)-(\d+)/.exec(o.headers.Range); return new Response(buf.slice(+a, +b + 1), { status: 206 }); } });
  const whole = new PMTiles("x", { fetch: async () => new Response(buf.slice(), { status: 200 }) });
  const meta = await ranged.metadata();
  ok(["itaewon", "gangnam", "hongdae", "calgary", "edmonton", "jamsil", "coex", "namsan"].every(id => meta.areas?.some(a => a.id === id)) && /OpenStreetMap/.test(meta.attribution),
    `the test archive: ${meta.areas.map(a => a.id).join(", ")}, with attribution`);
  ok(zxyToTileId(0, 0, 0) === 0 && zxyToTileId(1, 0, 0) === 1 && zxyToTileId(16, 55886, 25386) === 4875776909, "tile ids follow the PMTiles Hilbert order");
  const at = (lat, lng) => lngLatToTile(lng, lat, 16).map(Math.floor);
  const [ix, iy] = at(37.5346, 126.9946);
  const a1 = await ranged.tile(16, ix, iy), a2 = await whole.tile(16, ix, iy);
  ok(a1 && a2 && a1.length === a2.length && ranges >= 2, `Itaewon's centre chunk reads the same over byte ranges (${ranges} requests) and from a whole-file reply`);
  ok(await ranged.tile(16, ix + 400, iy) === null, "a chunk the archive doesn't have is null, not an error");
  const chunk = JSON.parse(new TextDecoder().decode(a1));
  ok(chunk.b.length > 300 && chunk.r.length > 20, `Itaewon's centre chunk: ${chunk.b.length} buildings, ${chunk.r.length} road pieces`);
  const floorsOk = { h: [2, 4], a: [10, 20], c: [3, 6], o: [8, 20], v: [3, 5], i: [1, 3], s: [1, 1] };
  const all = [];
  for (const a of meta.areas) { const [x, y] = at(a.lat, a.lng); const t = await ranged.tile(16, x, y); if (t) all.push(...JSON.parse(new TextDecoder().decode(t)).b); }
  const guessed = all.filter(b => !b.m), bad = guessed.filter(b => b.f < floorsOk[b.k][0] || b.f > floorsOk[b.k][1]);
  ok(guessed.length > 100 && !bad.length, `buildings with no height in the data get one by type: houses 2-4 floors, apartments 10-20, commercial 3-6, offices 8-20 (${guessed.length} checked)`);
  ok(all.some(b => b.m) && all.every(b => b.h > 2 && b.h < 650), "measured and registry heights are kept as they are");
  const kinds = new Set(all.map(b => b.k)), roofs = new Set(all.map(b => b.r));
  ok(["h", "a", "c", "o"].every(k => kinds.has(k)) && roofs.has("f") && (roofs.has("g") || roofs.has("h")), `types ${[...kinds].join("")} and roofs ${[...roofs].join("")} (flat, gabled, hipped)`);
  ok(worldHeight(25) === 25 * 0.55 * 2.4 && worldHeight(200) < 200 * 0.55 * 2.4 && worldHeight(200) > worldHeight(100), "the map's 2.4x vertical up to 25 m, gentler above, never shrinking");
  // geometry
  const tri = earcut([[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]]);
  ok(tri.length === 9, "a concave footprint triangulates into n-2 triangles");
  const ob = orientedBox([[0, 0], [20, 10], [15, 20], [-5, 10]]);
  ok(ob && Math.abs(ob.L * ob.S - Math.abs(ringArea([[0, 0], [20, 10], [15, 20], [-5, 10]]))) < 1, "a rotated rectangle's oriented box is the rectangle itself");
  const origin = [37.5346, 126.9946];
  const near = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 0 });
  const far = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1 });
  const tris = o => Object.values(o.groups).reduce((n, g) => n + (g.idx ? g.idx.length / 3 : 0), 0);
  ok(near.groups.shop && near.groups.sign && near.lamps.length > 0 && near.groups.lines, `up close: shopfronts (${near.stats.shops}), lit signs (${near.stats.signs}), lamps (${near.stats.lamps}), outlines`);
  ok(!far.groups.shop && !far.groups.sign && !far.lamps.length && far.groups.wall_g && tris(far) < tris(near) * 0.7, `further out: walls and roofs only, ${tris(far)} triangles vs ${tris(near)}`);
  const again = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 0 });
  ok(again.groups.roof.pos.length === near.groups.roof.pos.length && again.groups.roof.pos.every((v, i) => v === near.groups.roof.pos[i]), "a chunk builds the same every time (you come back to the same street)");
  const floats = Object.values(near.groups).flatMap(g => [g.pos]).every(p => p.every(Number.isFinite));
  ok(floats, "no NaN or Infinity in any vertex");
  // a hero model hides the procedural building under it; a label-only hero doesn't
  const hero = { lat: 37.534673, lng: 126.994076, clear: 12, glb: "x.glb" };
  const hid = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1, heroes: [hero] });
  ok(hid.stats.hidden > 0 && hid.stats.buildings === far.stats.buildings - hid.stats.hidden, `a hero with a model hides the procedural building(s) at its spot (${hid.stats.hidden})`);
  const clr = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1, clearAt: 14 });
  ok(clr.stats.hidden > 0, "nothing stands on the spot you stand on");
  const heroes = (await (await fetch("/web/data/heroes.json")).json()).heroes;
  ok(heroes.length >= 12 && heroes.every(h => h.id && h.label && Number.isFinite(h.lat) && Number.isFinite(h.lng) && "glb" in h && Array.isArray(h.offset)), "data/heroes.json: every hero has an id, a label, a spot, a model slot and an offset");
  ok(heroes.every(h => !h.fp || h.fp.every(([lng, lat]) => Math.abs(lng - h.lng) < 0.002 && Math.abs(lat - h.lat) < 0.002)), "hero footprints are lng/lat around their own pin");
  const famous = ["lotte-world-tower", "n-seoul-tower", "coex", "gangnam-station", "calgary-tower", "muttart-conservatory", "rogers-place"];
  ok(famous.every(id => heroes.some(h => h.id === id && h.landmark && h.glow)), "the landmark list: Lotte World Tower, N Seoul Tower, COEX, Gangnam Station, Calgary Tower, Muttart, Rogers Place");
  // a landmark with no model yet still stands out; a bar's label-only entry doesn't
  const tallest = o => Math.max(...[...o.groups.roof.pos].filter((_, i) => i % 3 === 1));
  const plain = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1 });
  const lm = { lat: 37.534673, lng: 126.994076, h: 300, landmark: true, glow: "#9fd4ff" };
  const boosted = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1, heroes: [lm] });
  ok(boosted.groups.glow && tallest(boosted) > tallest(plain) * 2 && boosted.stats.buildings === plain.stats.buildings,
    `a landmark with no model: its building grows to its height with a glowing crown (top ${tallest(plain).toFixed(0)} -> ${tallest(boosted).toFixed(0)})`);
  const bar = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1, heroes: [{ ...lm, landmark: false }] });
  ok(!bar.groups.glow && tallest(bar) === tallest(plain), "…a venue's label-only entry leaves its building as it is");
  const tw = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1, heroes: [{ ...lm, shape: "tower", h: 236, clear: 30 }] });
  ok(tw.groups.glow && tw.stats.hidden > 0 && tallest(tw) > worldHeight(236) * 0.95, `"tower": a placeholder tower stands at the pin (${tallest(tw).toFixed(0)} units), the buildings under it cleared`);
  // a lake inside its park's outline (Seokchon Lake): the water shows, no trees on it
  const sq = (a, b) => [a, a, b, a, b, b, a, b];
  const lake = buildChunk({ b: [], r: [], a: [{ k: "park", p: sq(100, 4000) }, { k: "water", p: sq(1200, 2900) }] }, { z: 16, x: ix, y: iy, origin, lod: 0 });
  const ys = g => new Set([...g.pos].filter((_, i) => i % 3 === 1));
  const inLake = (() => { const r = buildChunk({ b: [], r: [], a: [{ k: "water", p: sq(1200, 2900) }] }, { z: 16, x: ix, y: iy, origin, lod: 0 }).groups.water.pos;
    const xs = [...r].filter((_, i) => i % 3 === 0), zs = [...r].filter((_, i) => i % 3 === 2);
    return (x, z) => x > Math.min(...xs) && x < Math.max(...xs) && z > Math.min(...zs) && z < Math.max(...zs); })();
  let wetTrees = 0; for (let k = 0; k < lake.trees.length; k += 4) if (inLake(lake.trees[k], lake.trees[k + 1])) wetTrees++;
  ok(Math.min(...ys(lake.groups.water)) > Math.max(...ys(lake.groups.ground)) && lake.trees.length > 0 && lake.trees.length % 4 === 0 && !wetTrees,
    `a lake inside its park: the water drawn above the park, ${lake.trees.length / 4} trees round it and none on it`);
  // near Itaewon the hand-made map keeps its own middle
  const ex = buildChunk(chunk, { z: 16, x: ix, y: iy, origin, lod: 1, exclude: { b: 820, r: 1420 } });
  ok(ex.stats.buildings === 0 && !ex.groups.road, "round Itaewon the procedural city leaves the hand-made map's middle alone (no buildings, no roads there)");
  // a chunk the area only partly covers says so (the worldwide tiles fill the rest)
  const [ex1, ey1] = lngLatToTile(126.9946 + 0.0145, 37.5346, 16).map(Math.floor);
  const edge = JSON.parse(new TextDecoder().decode(await ranged.tile(16, ex1, ey1) ?? new Uint8Array([123, 125])));
  ok(Array.isArray(edge.cut) && edge.cut[0].length === 3, "a chunk at an area's edge carries the circle it was cut by");
}

group("The map anywhere — vector tiles (MVT) and OpenMapTiles -> chunks");
{
  // a tiny MVT, encoded here: one building, a main road with its name, a park, a tunnel
  const enc = (() => {
    const vint = (a, v) => { while (v > 127) { a.push((v & 127) | 128); v = Math.floor(v / 128); } a.push(v); };
    const zz = v => (v << 1) ^ (v >> 31);
    const field = (a, f, w) => vint(a, (f << 3) | w);
    const bytes = (a, f, b) => { field(a, f, 2); vint(a, b.length); a.push(...b); };
    const str = s => [...new TextEncoder().encode(s)];
    const packed = (a, f, vs) => { const b = []; for (const v of vs) vint(b, v); bytes(a, f, b); };
    const geom = (type, rings) => {
      const c = []; let x = 0, y = 0;
      for (const r of rings) {
        const pts = type === 3 ? r.slice(0, -1) : r;
        c.push((1 & 7) | (1 << 3), zz(pts[0][0] - x), zz(pts[0][1] - y)); x = pts[0][0]; y = pts[0][1];
        c.push((2 & 7) | ((pts.length - 1) << 3));
        for (const p of pts.slice(1)) { c.push(zz(p[0] - x), zz(p[1] - y)); x = p[0]; y = p[1]; }
        if (type === 3) c.push(7 | (1 << 3));
      }
      return c;
    };
    return layers => {
      const tile = [];
      for (const [name, feats] of Object.entries(layers)) {
        const L = [], keys = [], vals = [];
        bytes(L, 1, str(name));
        const fbufs = feats.map(f => {
          const F = [], tags = [];
          for (const [k, v] of Object.entries(f.props)) {
            let ki = keys.indexOf(k); if (ki < 0) { keys.push(k); ki = keys.length - 1; }
            let vi = vals.findIndex(o => o === v); if (vi < 0) { vals.push(v); vi = vals.length - 1; }
            tags.push(ki, vi);
          }
          packed(F, 2, tags); field(F, 3, 0); vint(F, f.type); packed(F, 4, geom(f.type, f.geom));
          return F;
        });
        for (const F of fbufs) bytes(L, 2, F);
        for (const k of keys) bytes(L, 3, str(k));
        for (const v of vals) { const V = []; if (typeof v === "string") bytes(V, 1, str(v)); else { field(V, 5, 0); vint(V, v); } bytes(L, 4, V); }
        field(L, 5, 0); vint(L, 4096);
        bytes(tile, 3, L);
      }
      return new Uint8Array(tile);
    };
  })();
  const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const bytes = enc({
    building: [{ type: 3, props: { render_height: 42 }, geom: [sq(100, 100, 60, 40)] },
               { type: 3, props: { render_height: 5 }, geom: [sq(300, 100, 12, 10)] },
               { type: 3, props: { render_height: 5 }, geom: [sq(2100, 2100, 40, 30)] }],
    transportation: [{ type: 2, props: { class: "primary" }, geom: [[[0, 200], [4096, 200]]] },
                     { type: 2, props: { class: "minor", brunnel: "tunnel" }, geom: [[[0, 900], [900, 900]]] }],
    transportation_name: [{ type: 2, props: { class: "primary", name: "Test-ro" }, geom: [[[100, 200], [900, 200]]] }],
    park: [{ type: 3, props: { class: "park" }, geom: [sq(1500, 1500, 1200, 1200)] }],
  });
  const L = decodeMVT(bytes);
  ok(L.building?.features.length === 3 && L.building.features[0].props.render_height === 42 && L.building.extent === 4096 && L.transportation_name.features[0].props.name === "Test-ro",
    "an MVT decodes: layers, properties, geometry");
  ok(mvtArea(L.building.features[0].geom[0]) > 0, "…outer rings keep the spec's winding");
  const m = omtChunks(bytes, 13976, 6346);
  const all = [...m.values()];
  ok(m.size === 16, "one z14 tile -> its 16 chunks");
  const bs = all.flatMap(c => c.b);
  ok(bs.length === 3 && bs.some(b => b.m && b.h === 42) && bs.filter(b => !b.m).length === 2, "a height the map has is kept; OpenMapTiles' 5 m filler counts as unknown");
  const small = bs.find(b => !b.m && b.f <= 4);
  ok(small && ["s", "h", "c"].includes(small.k), `…and is guessed from size, shape and the road (a small one off the main road: ${small?.k})`);
  const rd = all.flatMap(c => c.r);
  ok(rd.length >= 4 && rd.every(r => r.c === "primary"), `roads are clipped into each chunk they cross (${rd.length} pieces); tunnels are left out`);
  ok(all.some(c => c.l.some(l => l.t === "Test-ro")) && all.flatMap(c => c.a).filter(a => a.k === "park").length === 4, "main road names and parks come along");
  const ch = m.get(`${13976 * 4},${6346 * 4}`), built = buildChunk(ch, { z: 16, x: 13976 * 4, y: 6346 * 4, origin: [37.5, 127], lod: 0 });
  ok(built.stats.buildings === 2 && built.groups.road && built.labels.some(l => l.text === "Test-ro"), "…and build like a baked chunk");
}
}
group("Day and night glass — one light for every panel, blending at sunrise and sunset");
{
  const at = h => dayness(h);
  ok(at(2) === 0 && at(5.9) === 0 && at(12) === 1 && at(18.4) === 1 && at(20) === 0, "night until 6:00, day from 7:00 to 18:30, night from 19:30");
  const up = [6, 6.25, 6.5, 6.75, 7].map(at), down = [18.5, 18.75, 19, 19.25, 19.5].map(at);
  ok(up.every((v, i) => !i || v > up[i - 1]) && down.every((v, i) => !i || v < down[i - 1]), "sunrise and sunset blend in steps, never a jump");
  ok(Math.abs(at(6.5) - .5) < 1e-9 && Math.abs(at(19) - .5) < 1e-9, "halfway at the map's own switch (6:30 and 19:00)");
  let worst = 0; for (let m = 0; m < 24 * 60; m++) worst = Math.max(worst, Math.abs(at((m + 1) / 60) - at(m / 60)));
  ok(worst < .05, `no minute changes the light by more than 5% (${(worst * 100).toFixed(1)}%)`);
  setDay(.73); const v = getComputedStyle(document.documentElement).getPropertyValue("--day").trim();
  ok(getDay() === .73 && v === "0.73" && document.documentElement.classList.contains("is-day"), "the light goes on the page root as --day");
  setDay(0);
}

group("Onboarding — English and Korean, guest setup, invite links, analytics");
{
  const en = Object.keys(STRINGS.en), ko = Object.keys(STRINGS.ko);
  const miss = en.filter(k => !(k in STRINGS.ko)), extra = ko.filter(k => !(k in STRINGS.en));
  ok(!miss.length && !extra.length, `every string in both languages (${en.length} keys)${miss.length ? ` · no Korean: ${miss.join(", ")}` : ""}${extra.length ? ` · extra: ${extra.join(", ")}` : ""}`);
  const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
  ok(en.every(k => vars(STRINGS.en[k]) === vars(STRINGS.ko[k])), "the same {placeholders} in both languages");
  ok(["sidequest", "ritual", "artgallery", "secretdiary", "mask_off", "manhunt"].every(g => STRINGS.en[`host.${g}`] && STRINGS.ko[`host.${g}`]), "every game's host (or table) has a name, in both languages");
  const rng = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const names = Array.from({ length: 300 }, () => suggestName(rng, "en")).concat(Array.from({ length: 300 }, () => suggestName(rng, "ko")));
  ok(names.every(n => n.length >= 2 && n.length <= 20 && n === n.trim()), "name suggestions always fit the server's rule (2–20, trimmed)");
  ok(new Set(names).size > 150, `…and vary (${new Set(names).size} different in 600)`);
  setLang("ko"); const k = tr("recap.with", { n: 3, names: tr.list(["재", "미나", "솔"]) }); setLang("en");
  ok(k === "재, 미나, 솔랑 게임 3개를 했어요" && tr.list(["Jae", "Mina", "Sol"]) === "Jae, Mina and Sol", "lists and numbers read right in both");
  setLang(lang0);
  const looks = Array.from({ length: 60 }, () => starterLook(rng));
  ok(looks.every(l => STARTER_OUTFITS4.some(o => o.top === l.top && o.bottom === l.bottom && o.shoes === l.shoes)), "a new character always wears one of the six starter outfits");
  ok(looks.every(l => JSON.stringify(normalizeAvatar4(l)) === JSON.stringify(l)) && new Set(looks.map(l => l.skin)).size > 3 && new Set(looks.map(l => l.eyes)).size > 3, "…with a random skin, hair and eyes, and nothing that clashes");
  ok(e164("010-1234-5678", "en") === "+821012345678" && e164("01012345678", "ko") === "+821012345678" && e164("+1 (555) 123-4567") === "+15551234567" && e164("5551234567", "en") === "+15551234567" && e164("12", "en") === null,
    "phone numbers: Korean local -> +82, international kept, junk refused");
  ok(["+82 010-1234-5678", "+82 10 1234 5678", "0082 10 1234 5678", "82 10-1234-5678", "8210 1234 5678"].every(n => e164(n, "en") === "+821012345678"),
    "…and the half-international ways Koreans write theirs (+82 010…, 0082…, 82 10…): never a trunk 0 after +82");
  const now = 1e12, min = 60e3;
  ok(otpWait({}, now) === 0 && otpWait({ sent: [now - 10e3] }, now) === OTP.COOLDOWN_S - 10 && otpWait({ sent: [now - OTP.COOLDOWN_S * 1000] }, now) === 0,
    `asking for codes: one every ${OTP.COOLDOWN_S} s`);
  ok(otpWait({ sent: [50, 40, 30, 20, 10].map(m => now - m * min) }, now) === 10 * 60 && otpWait({ until: now + 45e3 }, now) === 45,
    `…at most ${OTP.MAX_PER_HOUR} an hour, and the server's own wait is kept`);
  ok(otpError("For security purposes, you can only request this after 53 seconds.").wait === 53 && otpError("Token has expired or is invalid").reason === "bad_code"
    && otpError("Error sending confirmation OTP to provider: Permission to send an SMS has not been enabled for the region").reason === "provider" && otpError("Phone number already registered").reason === "taken",
    "a failed code request becomes one reason (rate limited / provider / bad code / taken), never the server's text");
  const page = invitePage({ code: "ab12", name: `Jae's <b>party</b>"`, count: 4 });
  ok(/og:title" content="Jae&#39;s &lt;b&gt;party&lt;\/b&gt;&quot; · 4 inside"/.test(page) && !/<b>party/.test(page), "the invite link's preview: the party's name and who's in, escaped");
  ok(/url=\/\?party=AB12&amp;from=invite/.test(page) && invitePage({ code: "bad!" }) === null, "…then on to the party (a bad code goes nowhere)");
  ok(/파티 초대|참여 중/.test(invitePage({ code: "AB12", count: 2, lang: "ko-KR" })), "a Korean phone gets the Korean preview");
  // analytics: only known events, only whitelisted props, no names, codes or places
  const before = window.__events.length;
  track("joined_party", { source: "invite_link", code: "ABCD", name: "Jae", lat: 37.5, ms: 1200, channel: "smoke-signal" });
  track("made_up_event", {});
  const row = window.__events.slice(before);
  ok(row.length === 1 && JSON.stringify(Object.keys(row[0].props)) === JSON.stringify(["source", "ms"]) && row[0].device && !("user" in row[0]), "an event keeps only whitelisted props (no code, name or place), with an install id, no account");
  ok(EVENTS.length === 22 && JSON.stringify(clean({ permission: "location", trigger: "public", count: 3 })) === JSON.stringify({ permission: "location", trigger: "public", count: 3 }), "the 22 onboarding events, and their props");
  ok(JSON.stringify(clean({ provider: "kakao", reason: "provider" })) === JSON.stringify({ provider: "kakao", reason: "provider" }) && !("provider" in clean({ provider: "naver" })) && !("reason" in clean({ reason: "Error sending to +821012345678" })), "accounts and SMS codes: only the provider and a fixed reason, never a number");
}
log("head", `\n${pass} passed, ${fail} failed`);
window.__done = { pass, fail };
