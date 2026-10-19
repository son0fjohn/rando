// Secret Diary end-to-end: FIVE "phones" (pages in one browser context) form
// a real party over the BroadcastChannel stub and play a whole batch through
// the real UI — the host's deal (swap, resize, send), everyone answering the
// batch at once, every reveal, the results. Along the way one phone drops
// mid-answer and a sixth joins late (and waits for the next batch). Saves
// phone-sized screenshots of each phase.
//
//   node test/diary_e2e.mjs [screenshot-dir] [--browser=webkit] [--diary=3d|sprite|css] [--video]
//
// --diary pins how the diaries are drawn (default: whatever the phone picks).
// --video (Chromium, needs a screenshot dir) screencasts bob's phone through
// the first written reveal — the unlock — into <dir>/unlock/ as JPEG frames
// plus an ffconcat list; with FFMPEG=/path/to/ffmpeg set it also writes unlock.mp4.
//
// Same stack as party_e2e.mjs: real party.js, net.js, game module and CSS;
// only the network, 3D and audio leaves are stubbed.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium, webkit, devices } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const SHOTS = process.argv.slice(2).find(a => !a.startsWith("--")) ?? null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".json": "application/json" };

const indexHtml = await readFile(join(ROOT, "web/index.html"), "utf8");
const CSS = indexHtml.slice(indexHtml.indexOf("<style>"), indexHtml.indexOf("</style>") + "</style>".length);
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    let body = await readFile(p);
    if (p.endsWith("test/hpparty.html")) body = Buffer.from(body.toString().replace("<!--INDEX_CSS-->", CSS));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const ENGINE = (process.argv.find(a => a.startsWith("--browser="))?.split("=")[1]) ?? "chromium";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = ENGINE === "webkit"
  ? await webkit.launch()
  : await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox"] });
const DIARY_MODE = process.argv.find(a => a.startsWith("--diary="))?.split("=")[1] ?? null;
const VIDEO = process.argv.includes("--video") && SHOTS && ENGINE === "chromium";
const ctx = ENGINE === "webkit"
  ? await browser.newContext({ ...devices["iPhone 15"] })
  : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
// screencast one phone over CDP: frames land in memory until stop() writes them
async function screencast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  return async dir => {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await mkdir(dir, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    let list = "ffconcat version 1.0\n";
    for (let i = 0; i < frames.length; i++) {
      const name = `f${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(dir, name), Buffer.from(frames[i].data, "base64"));
      list += `file ${name}\nduration ${Math.max(0.016, (frames[i + 1]?.t ?? frames[i].t + 0.5) - frames[i].t).toFixed(3)}\n`;
    }
    await writeFile(join(dir, "frames.ffconcat"), list);
    if (process.env.FFMPEG) {
      const { execFileSync } = await import("node:child_process");
      execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-i", join(dir, "frames.ffconcat"), "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", join(dir, "..", "unlock.mp4")]);
    }
    return frames.length;
  };
}
console.log(`engine: ${ENGINE}${ENGINE === "webkit" ? " (iPhone 15 profile)" : ""}`);

let pass = 0, fail = 0;
const annotate = m => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=diary e2e (${ENGINE})::${m.replace(/\n/g, " ")}`); };
let section = "start", lastCheck = "none yet";
const ok = (c, m) => { lastCheck = m; if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); annotate(`${section}: ${m}`); } };
const head = m => { section = m; console.log("\n" + m); };
setTimeout(() => {
  const m = `timed out after 12 min in "${section}" (last check: ${lastCheck})`;
  console.log("  ✗ " + m); annotate(m); process.exit(1);
}, 12 * 60_000).unref();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
async function phone(name, qs = "") {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  pg.on("console", m => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await pg.goto(`${base}/test/hpparty.html?me=${name}${qs}${DIARY_MODE ? `&diary=${DIARY_MODE}` : ""}`);
  await pg.waitForFunction(() => window.__ready);
  pg.label = name;
  return pg;
}
// Screenshots need the page in front, and a page in the background gets its
// timers throttled. The host's phone runs every clock in the game, so it
// goes straight back to the front after each shot — otherwise a phase that
// should end in a second can take many on a slow CI runner.
const shot = async (pg, name) => {
  if (!SHOTS) return;
  await pg.bringToFront(); await sleep(150);
  await pg.screenshot({ path: join(SHOTS, `${name}.png`) });
  if (A && pg !== A) await A.bringToFront();
};
const text = (pg, sel) => pg.locator(sel).first().innerText().catch(() => "");
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const h2 = pg => text(pg, "#game-panel .stage h2, #game-panel .hp-res-title");
const all = (pgs, fn) => Promise.all(pgs.map(fn));
// nothing on the page is wider than the phone
const fits = pg => pg.evaluate(() => {
  const w = document.documentElement.clientWidth;
  return [...document.querySelectorAll("#game-panel *")].every(e => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= -1 && r.right <= w + 1); });
});
// the host's view, for assertions and for failure messages: phase, question,
// and who's done / locked / gone
const hostState = () => A.evaluate(() => {
  const s = window.__game?.s;
  if (!s) return null;
  const who = Object.values(s.players ?? {}).map(p => `${p.handle}:${p.done ? "d" : ""}${p.locked ? "l" : ""}${p.gone ? "g" : ""}`).join(" ");
  return { phase: s.phase, qi: s.qi, n: s.batch?.length, type: s.batch?.[s.qi]?.type, left: Math.round(s.left), who };
});

let A;
try {
  // ------------------------------------------------------------------ party
  head("Five phones make a party");
  A = await phone("alice");
  await A.click("#party-btn");
  await A.fill("#pt-name", "Diary night");
  await A.click("#pt-create");
  ok(await until(A, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? "")), "alice hosts a party");
  const code = await text(A, "#pt-code-chip");
  const guests = [];
  for (const name of ["bob", "cy", "dee", "eve"]) guests.push(await phone(name, `&party=${code}`));
  const [B, C, D, E] = guests;
  ok(await until(A, () => document.querySelectorAll(".lr-av").length === 5, null, 25000), "bob, cy, dee and eve join from the link — 5 in the room");
  await A.click("#pt-open-picker");
  await A.click('[data-queue="secretdiary"]');
  await A.click("#pt-picker-done");
  ok(await until(E, () => /Secret Diary/.test(document.getElementById("pt-next")?.textContent ?? "") && /up to spicy/.test(document.getElementById("pt-next")?.textContent ?? "")), "everyone sees Secret Diary up next, up to spicy (private default)");
  await A.click("#pt-start");

  // ------------------------------------------------------------------ deal
  head("Deal — the host picks the batch");
  ok(await until(A, () => document.querySelectorAll(".sd-card").length === 5), "the host is dealt 5 cards");
  ok(await until(B, () => /alice is picking/.test(document.querySelector(".sd-incoming")?.textContent ?? "")), "everyone else waits: 'alice is picking the questions…'");
  ok(!(await B.locator(".sd-card").count()), "guests can't see the cards");
  const levels = await A.locator(".sd-card .sd-level").allInnerTexts();
  const rank = l => ["mild", "spicy", "unhinged"].indexOf(l.toLowerCase());
  ok(levels.every((l, i) => !i || rank(levels[i - 1]) <= rank(l)) && rank(levels[0]) === 0, `mild first, spicier later (${levels.join(", ")})`);
  ok((await A.locator(".sd-card.yesno").count()) === 2, "2 of the 5 are yes/no");
  await shot(A, "01-deal-host");
  await shot(B, "02-deal-guest");
  const before = await A.locator(".sd-card .sd-ctext > div:last-child").allInnerTexts();
  await A.locator("[data-swap]").nth(2).click();
  ok(await until(A, b => { const now = [...document.querySelectorAll(".sd-card .sd-ctext > div:last-child")].map(e => e.textContent); return now.length === 5 && now.some(t => !b.includes(t)); }, before), "Swap replaces one card");
  const afterSwap = await A.locator(".sd-card .sd-ctext > div:last-child").allInnerTexts();
  ok(afterSwap.filter(t => !before.includes(t)).length === 1 && before.filter(t => !afterSwap.includes(t)).length === 1, "…just that one");
  await A.locator('[data-size]').last().click();
  ok(await until(A, () => document.querySelectorAll(".sd-card").length === 6), "+ makes it 6");
  await A.locator('[data-size]').first().click();
  ok(await until(A, () => document.querySelectorAll(".sd-card").length === 5), "− back to 5");
  ok(await fits(A), "the deal screen fits the phone");
  // what really left the deck: the 5 sent, and the one swapped out (a card the
  // − button dropped was never sent, so it may come back later)
  const sent = await A.locator(".sd-card .sd-ctext > div:last-child").allInnerTexts();
  const swappedOut = before.filter(t => !afterSwap.includes(t));
  await A.click("#sd-send");

  // ------------------------------------------------------------------ answer
  head("Answer — everyone gets the whole batch at once");
  const players = [A, B, C, D, E];
  ok((await all(players, pg => until(pg, () => document.querySelectorAll(".sd-q").length === 5))).every(Boolean), "all 5 phones show all 5 questions on one screen");
  ok(/0\/5/.test(await text(B, "#sd-mine")), `progress starts at "${await text(B, ".sd-prog")}"`);
  ok(await fits(B), "the answer screen fits the phone");
  await shot(B, "03-answer-empty");
  // a sixth phone turns up now: they wait for the next batch
  const F = await phone("fay", `&party=${code}`);
  ok(await until(F, () => /Secret Diary is on — you're in the next one/.test(document.getElementById("pt-wait")?.textContent ?? ""), null, 20000), "fay joins mid-game: the lobby tells her she's in the next one");
  ok(!(await F.locator(".sd-q").count()), "…and she doesn't get this batch");
  await shot(F, "04-late-joiner");

  const types = await B.locator(".sd-q").evaluateAll(qs => qs.map(q => q.classList.contains("yesno") ? "yesno" : "written"));
  const yesBy = { alice: [1], bob: [], cy: [1], dee: [], eve: [0, 1] };     // which yes/no (by order) each says yes to
  async function answer(pg, { only = null, skipSubmit = false } = {}) {
    let yn = 0;
    for (let k = 0; k < types.length; k++) {
      if (only && !only.includes(k)) { if (types[k] === "yesno") yn++; continue; }
      const q = pg.locator(".sd-q").nth(k);
      if (types[k] === "written") await q.locator(".sd-in").fill(`${pg.label} answer ${k + 1}`);
      else await q.locator(`[data-yn="${(yesBy[pg.label] ?? []).includes(yn++) ? "yes" : "no"}"]`).click();
    }
    await pg.locator(".sd-in").first().blur().catch(() => {});
    if (!skipSubmit) await pg.click("#sd-submit");
  }
  // eve is halfway through a sentence while the others submit: it must survive
  const firstW = types.indexOf("written");
  await E.locator(".sd-q").nth(firstW).locator(".sd-in").fill("half a thou");
  await answer(B);
  ok(await until(B, () => /5 answers locked in/.test(document.getElementById("game-panel")?.textContent ?? "")), "bob submits all 5");
  await shot(B, "05-answer-sent");
  await answer(C);
  // dee answers 3 of 5, then her phone dies before she submits
  await answer(D, { only: [0, 1, 2], skipSubmit: true });
  ok(/3\/5/.test(await text(D, "#sd-mine")), "dee's progress shows 3/5");
  await sleep(1200);          // her answers are saved as she goes
  // a phone that dies: leave the room the way a closing page does (some
  // headless builds skip pagehide on close; on a real phone presence times out)
  await D.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await D.close();
  ok((await E.locator(".sd-q").nth(firstW).locator(".sd-in").inputValue()) === "half a thou", "others submitting doesn't wipe what eve is typing");
  await E.locator(".sd-q").nth(firstW).locator(".sd-in").fill("");
  await answer(E, { skipSubmit: true });
  await shot(E, "06-answer-filled");
  ok(/5\/5/.test(await text(E, "#sd-mine")), "progress reads 5/5 once everything's filled");
  await E.click("#sd-submit");
  ok(await until(E, () => /answers? locked in/.test(document.getElementById("game-panel")?.textContent ?? "")), "one Submit for the whole batch");
  ok(await until(A, () => !!document.getElementById("sd-submit")), "alice hasn't submitted yet — the room waits for her");
  await answer(A);

  // ------------------------------------------------------------------ reveal
  head("Reveal — one question at a time");
  const live = [A, B, C, E];
  await A.bringToFront();
  const opened = await until(B, () => /question 1 of 5/.test(document.querySelector(".sd-qcount")?.textContent ?? ""), null, 30000);
  ok(opened, "dee dropped, everyone else submitted: question 1 opens" + (opened ? "" : ` — host at ${JSON.stringify(await hostState())}`));
  let shotW = false, shotY = false, cast = VIDEO ? await screencast(B) : null;
  for (let k = 0; k < 5; k++) {
    const at = await until(B, k => new RegExp(`question ${k + 1} of 5`).test(document.querySelector(".sd-qcount")?.textContent ?? ""), k, 20000);
    const hs = await hostState();
    ok(at, `question ${k + 1} of 5` + (at ? "" : ` — host at ${JSON.stringify(hs)}`));
    if (!at) break;
    if (hs?.type === "written") {
      const n = await B.locator(".sd-entry").count();
      ok(n === (k <= 2 ? 5 : 4), `${n} unsigned answers${k <= 2 ? " (dee's still count)" : " (dee never got to this one)"}`);
      ok((await B.locator(".sd-dcell").count()) === n && (await B.locator(".sd-dcell.open").count()) < n, `${n} closed, locked diaries on the shelf, one per answer`);
      const dcs = await B.locator(".sd-dcell").evaluateAll(cs => cs.map(c => c.style.getPropertyValue("--dc")));
      ok(new Set(dcs).size === n, "each diary its own color");
      if (!shotW) { await sleep(1100); await shot(B, "07a-reveal-unlocking"); }
      const unsealed = await Promise.all(live.map(pg => until(pg, () => !document.querySelector(".sd-matchlist.sealed"), null, 12000)));
      ok(unsealed.every(Boolean), "the padlocks drop and the diaries open on every phone");
      ok(await until(B, n => document.querySelectorAll(".sd-dcell.open").length === n, n), "every diary on the shelf is open, its answer on the page");
      if (!shotW) { await B.evaluate(() => document.getElementById("game-panel").scrollTo(0, 0)); await sleep(400); await shot(B, "07-reveal-open"); }
      if (cast) { await sleep(800); console.log(`  · screencast: ${await cast(join(SHOTS, "unlock"))} frames of the unlock`); cast = null; }
      ok((await B.locator(".sd-match.mine").count()) === 1 && !(await B.locator(".sd-match.mine .sd-who").count()), "your own answer is marked 'yours' and isn't matched");
      const texts = await B.locator(".sd-entry").allInnerTexts();
      ok(!texts.some(t => /^(alice|bob|cy|dee|eve)$/.test(t)), "no names on the answers");
      for (const pg of live) {
        const rows = pg.locator(".sd-match:has(.sd-who)");
        const m = await rows.count();
        for (let i = 0; i < m; i++) await rows.nth(i).locator(".sd-who button").nth(i % 3).click();
      }
      ok(/\d+\/\d+/.test(await text(B, "#sd-matched")) && (await text(B, "#sd-matched")).split("/")[0] === (await text(B, "#sd-matched")).split("/")[1], `bob matched them all (${await text(B, "#sd-matched")})`);
      if (!shotW) {
        shotW = true; await shot(B, "07c-reveal-matched");
        // tap a diary that isn't yours: it opens big, with its matching chips
        const i = await B.locator(".sd-dcell").evaluateAll(cs => cs.findIndex(c => !c.querySelector(".sd-dyours")));
        const want = await B.locator(".sd-dcell .sd-dtext").nth(i).evaluate(e => e.textContent.trim());
        await B.locator(".sd-dcell").nth(i).click();
        ok(await until(B, () => !!document.querySelector(".sd-zoom .sd-ztext")), "tap a diary: it opens up to read");
        const got = await B.locator(".sd-zoom .sd-ztext").evaluate(e => e.textContent.trim());
        ok(got === want, `the zoomed diary shows that answer ("${got}")`);
        ok((await B.locator(".sd-zoom .sd-who button, .sd-zoom .sd-sel").count()) >= 1, "…with its who-wrote-it chips");
        await shot(B, "07b-reveal-zoom");
        await B.click(".sd-zclose");
        ok(!(await B.locator(".sd-zoom").count()), "back to the shelf");
      }
    } else {
      const line = await text(B, ".sd-count");
      ok(/^(nobody or almost nobody said yes|everyone or almost everyone said yes|\d of \d said yes)$/.test(line), `only the count: "${line}"`);
      ok(!(await B.locator(".sd-entry").count()), "no answers on show for yes/no");
      for (const pg of live) await pg.locator("[data-pick]").first().click();
      if (!shotY) { shotY = true; ok(await fits(B), "the yes/no reveal fits the phone"); await shot(B, "08-reveal-yesno"); }
    }
    ok(!/pts|score/i.test(await text(B, "#game-hud")), "no score on screen mid-game");
    for (const pg of live) await pg.click("#sd-lock");
    ok(/locked in/.test(await text(C, "#game-panel")), "lock in");
  }

  // ------------------------------------------------------------------ results
  head("Results");
  ok(await until(B, () => /Secret Diary/.test(document.querySelector(".hp-res-title")?.textContent ?? ""), null, 20000), "after question 5: the results");
  const res = await text(B, ".hp-results");
  ok(/wins|tie|no winner/i.test(await text(B, ".hp-res-sub")), `the winner: "${await text(B, ".hp-res-sub")}"`);
  ok((await B.locator(".hp-results .hp-av").count()) === 5, "everyone's avatar, dee included (marked left)");
  ok(/left/.test(res), "dee is marked as having left");
  ok(!/answer \d|half a thou|\d of \d said yes|almost (nobody|everyone)/i.test(res), "totals only — no answers, no counts, no who-said-what");
  ok(await fits(B), "the results card fits the phone");
  await shot(B, "09-results");

  // ------------------------------------------------------------------ next batch
  head("Next batch — the late joiner is in");
  ok(await until(A, () => !document.getElementById("party-panel").hidden, null, 40000), "back to the lobby");
  ok(await until(F, () => !/you're in the next one/.test(document.getElementById("pt-wait")?.textContent ?? ""), null, 10000), "fay's 'next one' notice clears");
  await A.click("#pt-start");
  ok(await until(A, () => document.querySelectorAll(".sd-card").length === 5), "a fresh deal");
  const second = await A.locator(".sd-card .sd-ctext > div:last-child").allInnerTexts();
  ok(!second.some(t => sent.includes(t) || swappedOut.includes(t)), "no card from the first game (sent or swapped) comes back");
  await A.click("#sd-send");
  ok(await until(F, () => document.querySelectorAll(".sd-q").length === 5, null, 15000), "fay gets the batch this time");
  ok(errors.length === 0, "no page errors: " + (errors[0] ?? "none"));
} catch (e) {
  ok(false, `crashed: ${e.message.split("\n")[0]}`);
}
console.log(`\n${pass} passed, ${fail} failed${SHOTS ? ` · screenshots in ${SHOTS}` : ""}`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
