// End-to-end party test: three "phones" (pages in one browser context) form a
// real party over the BroadcastChannel stub and play through the lobby and
// three games by clicking and typing in the real UI. Real party.js, net.js,
// hplobby.js, game modules and the app's real CSS (injected from
// web/index.html). Saves phone-sized screenshots for eyeballing the layout.
//
//   node test/party_e2e.mjs [screenshot-dir] [--browser=webkit]
//
// Runs in real time (≈2 min): it's the one place the party flow is exercised
// as a whole, so it trades speed for realism.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium, webkit, devices } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const SHOTS = process.argv.slice(2).find(a => !a.startsWith("--")) ?? null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".json": "application/json" };

// the app's real stylesheet, lifted out of index.html
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

// --browser=webkit runs the same party on Safari's engine with Playwright's
// iPhone profile (viewport, touch, Mobile Safari user agent). It's the closest
// thing to iOS Safari that runs on Linux — CI runs both.
const ENGINE = (process.argv.find(a => a.startsWith("--browser="))?.split("=")[1]) ?? "chromium";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = ENGINE === "webkit"
  ? await webkit.launch()
  : await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox"] });
const ctx = ENGINE === "webkit"
  ? await browser.newContext({ ...devices["iPhone 15"] })
  : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
console.log(`engine: ${ENGINE}${ENGINE === "webkit" ? " (iPhone 15 profile)" : ""}`);

let pass = 0, fail = 0;
// On GitHub Actions a failure is also written as an ::error annotation, so it
// shows on the PR's checks (and through the API) without opening the log.
const annotate = m => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=party e2e (${ENGINE})::${m.replace(/\n/g, " ")}`); };
let section = "start", lastCheck = "none yet";
const ok = (c, m) => { lastCheck = m; if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); annotate(`${section}: ${m}`); } };
const head = m => { section = m; console.log("\n" + m); };
// A stuck wait must fail the run with a reason, not sit until the CI job's
// 20-minute limit kills it with no output.
setTimeout(() => {
  const m = `timed out after 17 min in "${section}" (last check: ${lastCheck})`;
  console.log("  ✗ " + m); annotate(m); process.exit(1);
}, 17 * 60_000).unref();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
async function phone(name, qs = "") {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  pg.on("console", m => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await pg.goto(`${base}/test/hpparty.html?me=${name}${qs}`);
  await pg.waitForFunction(() => window.__ready);
  pg.label = name;
  return pg;
}
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const text = (pg, sel) => pg.locator(sel).first().innerText().catch(() => "");
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const stageTitle = pg => text(pg, "#game-panel .stage h2, #game-panel .hp-res-title");
// the host taps "skip ahead" until `done(title)` holds on `watch`
async function skipUntil(host, watch, done, tries = 12) {
  for (let i = 0; i < tries; i++) {
    if (done(await stageTitle(watch))) return true;
    const b = host.locator("#hp-skip");
    if (await b.count()) await b.first().click().catch(() => {});
    await sleep(900);
  }
  return done(await stageTitle(watch));
}

try {
  // ------------------------------------------------------------------ create
  head("Party: create, join by link, join by code");
  const A = await phone("alice");
  await A.click("#party-btn");
  await A.fill("#pt-name", "Saturday night");
  await A.click('[data-vibe="chaotic"]');
  await A.click("#pt-create");
  ok(await until(A, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? "")), "host creates a party and gets a 4-character code");
  const code = await text(A, "#pt-code-chip");
  ok((await text(A, "#pt-title")) === "Saturday night", "the party has the name the host gave it");
  ok(await A.locator("#party-panel.pt-lobby").isVisible(), "the lobby is a full-screen room");
  ok(await until(A, () => getComputedStyle(document.querySelector("#pt-floor .lr-stage")).backgroundImage.includes("lobbies/chaos.png")), "the chaotic vibe picks the chaotic backdrop");

  const B = await phone("bob", `&party=${code}`);
  ok(await until(B, () => document.querySelectorAll(".lr-av").length === 2, null, 20000), "a friend joins straight from the share link");
  ok(await until(A, () => document.querySelectorAll(".lr-av").length === 2), "the host sees them arrive in the room");
  ok(await until(B, () => document.getElementById("pt-title")?.textContent === "Saturday night"), "the joiner gets the party name from the host");

  // ------------------------------------------------------------------ queue with too few
  head("Lobby: host queues a game before the room is full");
  await A.click("#pt-open-picker");
  ok(await A.locator("#pt-picker").isVisible(), "the host opens the game picker");
  ok(!(await B.locator("#pt-open-picker").count()), "guests don't get a picker");
  await A.click('[data-queue="mission"]');
  ok(await until(A, () => /up next/.test(document.querySelector('[data-queue="mission"]')?.textContent ?? "")), "tapping a game queues it");
  await A.click('[data-opt="mode"][data-val="choose"]');
  await sleep(300);
  await shot(A, "01-host-picker");
  await A.click("#pt-picker-x");
  ok(await A.locator("#pt-picker").isHidden(), "the host closes the picker");
  ok(/needs 1 more/.test(await text(A, "#pt-start")), "start waits for the minimum: 'needs 1 more'");
  ok(await until(B, () => /Today's Mission/.test(document.getElementById("pt-next")?.textContent) && /players choose/.test(document.getElementById("pt-next")?.textContent)), "guests see what's up next, options included");
  await A.click("#pt-open-picker");
  ok(await A.locator("#pt-picker").isVisible(), "the host can reopen it");
  await A.locator("#pt-picker").click({ position: { x: 20, y: 30 } });
  ok(await A.locator("#pt-picker").isHidden(), "tapping the dimmed backdrop closes it too");

  const C = await phone("cy");
  await C.click("#party-btn");
  await C.fill("#pt-code", code);
  await C.press("#pt-code", "Enter");
  ok(await until(C, () => document.querySelectorAll(".lr-av").length === 3, null, 20000), "a third friend joins by typing the code");
  ok(await until(A, () => /start/.test(document.getElementById("pt-start")?.textContent) && !document.getElementById("pt-start")?.disabled), "with 3 players, start unlocks");

  // ------------------------------------------------------------------ walk + chat
  head("Lobby: walking around and talking");
  // the room is the backdrop at its own aspect; positions are backdrop pixels
  const standing = (pg, id) => pg.evaluate(id => window.party.current.lobby.where(id), id);
  const before = await standing(B, "u-alice");
  const sb = await A.locator("#pt-floor .lr-stage").boundingBox();
  const target = [380, 1150];                         // open floor near the front of the bar
  await A.mouse.click(sb.x + sb.width * target[0] / 752, sb.y + sb.height * target[1] / 1344);
  ok(await until(B, () => window.party.current.lobby.where("u-alice")?.walking), "a tap walks you, and the others see you walking");
  await sleep(6000);
  // a background tab may not draw frames at all (WebKit); look at bob's
  // phone the way bob would, in front
  await B.bringToFront(); await sleep(400);
  const onB = await standing(B, "u-alice");
  await A.bringToFront();
  const onA = await standing(A, "u-alice");
  ok(Math.hypot(onA.x - target[0], onA.y - target[1]) < 40, `you walk to where you tapped (${Math.round(before.x)},${Math.round(before.y)} -> ${Math.round(onA.x)},${Math.round(onA.y)})`);
  ok(Math.hypot(onA.x - onB.x, onA.y - onB.y) < 2, "everyone sees you end up in the same spot");
  await B.fill("#pt-chat-input", "who's ready??");
  await B.press("#pt-chat-input", "Enter");
  ok(await until(A, () => { const b = document.querySelector('.lr-av[data-id="u-bob"] .lr-bubble'); return b && !b.hidden && /ready/.test(b.textContent); }), "chat shows as a speech bubble over the speaker");
  await sleep(1400);
  await shot(A, "02-lobby-host");
  await shot(B, "03-lobby-guest");

  // ------------------------------------------------------------------ Today's Mission, players choose
  head("Today's Mission — players choose, rated 0-10");
  await A.click("#pt-start");
  ok(await until(B, () => !document.getElementById("game-layer").hidden && /pick your mission/.test(document.querySelector("#game-panel h2")?.textContent)), "everyone lands on 'pick your mission'");
  ok(await A.locator("#party-panel").isHidden(), "the lobby steps aside during the game");
  await shot(B, "04-mission-pick");
  for (const pg of [A, B, C]) await pg.locator("[data-pick]").nth(1).click();
  ok(await until(A, () => /turn|your turn/.test(document.querySelector("#game-panel h2")?.textContent ?? ""), null, 10000), "once everyone picks, the first card comes up");
  // get the first mission to its rating, find a phone that rates
  let rater = null;
  for (let i = 0; i < 6 && !rater; i++) {
    for (const pg of [A, B, C]) if (await pg.locator("#tm-slider").count()) { rater = pg; break; }
    if (!rater) { await A.locator("#hp-skip").first().click().catch(() => {}); await sleep(900); }
  }
  ok(!!rater, "the room reaches the rating screen");
  if (rater) {
    await rater.locator("#tm-slider").evaluate(e => { e.value = 8; e.dispatchEvent(new Event("input", { bubbles: true })); });
    ok((await text(rater, "#tm-val")) === "8" && /nailed|got it/.test(await text(rater, "#tm-label")), "the slider shows the number and its label as you drag");
    await shot(rater, "05-mission-rate");
    await rater.click("#tm-lock");
    ok(await until(rater, () => /you gave/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "locking in shows your rating");
  }
  ok(await skipUntil(A, A, t => /\/ 10|nobody rated/.test(t)), "the verdict shows the average out of 10");
  await shot(A, "06-mission-verdict");
  ok(await skipUntil(A, A, t => /Today's Mission/.test(t), 20), "missions play through to the results screen");
  await shot(A, "07-mission-results");
  await A.locator("#hp-skip").first().click().catch(() => {});
  ok(await until(B, () => !document.getElementById("party-panel").hidden && document.querySelectorAll(".lr-av").length === 3, null, 15000), "everyone is back in the walkable lobby");
  ok(/Today's Mission/.test(await text(B, "#pt-next")), "the queue survives, ready to run again or change");

  // ------------------------------------------------------------------ Humiliation Ritual
  head("Humiliation Ritual — the performer barely touches the phone");
  await A.click("#pt-open-picker");
  await A.click('[data-queue="ritual"]');
  await A.click("#pt-picker-done");
  await A.click("#pt-start");
  ok(await until(A, () => !document.getElementById("game-layer").hidden), "the ritual starts");
  let performer = null;
  for (let i = 0; i < 8 && !performer; i++) {
    for (const pg of [A, B, C]) if (/act it out/.test(await stageTitle(pg))) { performer = pg; break; }
    if (!performer) { await A.locator("#hp-skip").first().click().catch(() => {}); await sleep(900); }
  }
  ok(!!performer, "one phone becomes the performer");
  if (performer) {
    const guesser = [A, B, C].find(pg => pg !== performer);
    ok(!(await performer.locator(".hr-guess").count()), "the performer's screen has no guess feed to read");
    ok(await performer.locator("#hr-heard").isVisible(), "just one big 'someone said it out loud' button");
    await shot(performer, "08-ritual-performer");
    await guesser.fill("#gp-in", "a broken toaster");
    await guesser.click("#game-panel .gp-form button");
    ok(await until(guesser, () => /toaster/.test(document.getElementById("hr-feed")?.textContent ?? "")), "typed guesses show in the guessers' feed");
    ok(!(await guesser.locator("#gp-in").isDisabled()), "you can keep guessing after one");
    await shot(guesser, "09-ritual-guesser");
    await performer.click("#hr-heard");
    await performer.locator("[data-heard]").first().click();
    ok(await until(guesser, () => /got it/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "one tap by the performer credits an out-loud answer");
  }
  ok(await skipUntil(A, A, t => /Humiliation Ritual/.test(t), 25), "the ritual plays through to results");
  await A.locator("#hp-skip").first().click().catch(() => {});
  ok(await until(A, () => !document.getElementById("party-panel").hidden, null, 15000), "back to the lobby");

  // ------------------------------------------------------------------ Secret Diary
  head("Party settings: 18+ gate and Secret Diary max level");
  await A.click("#pt-open-picker");
  await A.locator(".pt-settings").scrollIntoViewIfNeeded();
  ok(await A.locator('[data-set="diaryMax"][data-val="unhinged"]').isDisabled(), "unhinged is locked until the party is 18+");
  ok(/default/.test(await text(A, '[data-set="diaryMax"].on')) && /spicy/.test(await text(A, '[data-set="diaryMax"].on')), "a private party defaults to spicy, marked (default)");
  await shot(A, "10-settings");
  let asked = null;
  A.once("dialog", d => { asked = d.message(); d.accept(); });
  await A.click('[data-set="adult"][data-val="1"]');
  ok(/18 or older/.test(asked ?? ""), "turning on 18+ asks the host to confirm everyone's an adult");
  ok(await until(A, () => !document.querySelector('[data-set="diaryMax"][data-val="unhinged"]')?.disabled), "unhinged unlocks");
  await A.click('[data-set="diaryMax"][data-val="unhinged"]');
  await A.click('[data-queue="secretdiary"]');
  await A.click("#pt-picker-done");
  ok(await until(B, () => /Secret Diary/.test(document.getElementById("pt-next")?.textContent) && /up to unhinged/.test(document.getElementById("pt-next")?.textContent)), "guests see the queued game and its level");

  head("Secret Diary — deal, answer the batch, reveal one by one (3 phones; diary_e2e.mjs plays it with 5)");
  await A.click("#pt-start");
  ok(await until(A, () => document.querySelectorAll(".sd-card").length === 5), "the host is dealt a batch of 5, with Swap");
  ok(await until(B, () => /is picking/.test(document.querySelector(".sd-incoming")?.textContent ?? "")), "everyone else waits while the host picks");
  await shot(A, "11-diary-deal");
  const firstCard = await text(A, ".sd-card .sd-ctext > div:last-child");
  await A.locator("[data-swap]").first().click();
  ok(await until(A, t => (document.querySelector(".sd-card .sd-ctext > div:last-child")?.textContent ?? "") !== t, firstCard), "Swap deals a different card");
  await A.click("#sd-send");
  ok((await Promise.all([A, B, C].map(pg => until(pg, () => document.querySelectorAll(".sd-q").length === 5)))).every(Boolean), "everyone gets the whole batch at once");
  const qTypes = await B.locator(".sd-q").evaluateAll(qs => qs.map(q => q.classList.contains("yesno") ? "yesno" : "written"));
  const w0 = qTypes.indexOf("written");
  // cy is mid-sentence while the others submit: it must survive
  await C.locator(".sd-q").nth(w0).locator(".sd-in").fill("half a thou");
  await shot(B, "12-diary-answer");
  for (const pg of [A, B]) {
    for (let k = 0; k < qTypes.length; k++) {
      const q = pg.locator(".sd-q").nth(k);
      if (qTypes[k] === "written") await q.locator(".sd-in").fill(`${pg.label} answer ${k + 1}`);
      else await q.locator(`[data-yn="${pg === A ? "yes" : "no"}"]`).click();
    }
    await pg.click("#sd-submit");
  }
  await sleep(900);
  ok((await C.locator(".sd-q").nth(w0).locator(".sd-in").inputValue()) === "half a thou", "others submitting doesn't wipe what you're typing");
  for (let k = 0; k < qTypes.length; k++) {
    const q = C.locator(".sd-q").nth(k);
    if (qTypes[k] === "written") await q.locator(".sd-in").fill(`cy answer ${k + 1}`);
    else await q.locator('[data-yn="yes"]').click();
  }
  await C.click("#sd-submit");
  ok(await until(B, () => /question 1 of 5/.test(document.querySelector(".sd-qcount")?.textContent ?? ""), null, 15000), "everyone submitted: question 1 of 5 is revealed");
  ok(!/pts/.test(await text(B, "#game-hud")), "no score on screen mid-game");
  const seenTypes = new Set();
  for (let k = 0; k < 5; k++) {
    ok(await until(B, k => new RegExp(`question ${k + 1} of 5`).test(document.querySelector(".sd-qcount")?.textContent ?? ""), k, 20000), `question ${k + 1}`);
    const yn = (await B.locator(".sd-count").count()) > 0;
    if (!seenTypes.has(yn)) {
      seenTypes.add(yn);
      if (yn) {
        ok((await B.locator(".sd-dcell").count()) === 3, "yes/no gets the diaries too: three locked, one per answer");
        ok(await until(B, () => !document.querySelector(".sd-count.sealed") && document.querySelectorAll(".sd-dcell.open").length === 3, null, 10000), "they unlock, then the count appears");
        ok(/nobody or almost nobody|everyone or almost everyone|\d of \d said yes/.test(await text(B, ".sd-count")), `only the count: "${await text(B, ".sd-count")}"`);
        // 2 of 3 said yes here: softened, so the stamps stay blurred
        ok((await B.locator(".sd-dcell .sd-stamp.blur").count()) === 3, "a softened count keeps every stamp blurred");
        await shot(B, "14-diary-yesno");
      }
      else {
        ok((await B.locator(".sd-dcell").count()) === 3, "three closed, locked diaries on the shelf");
        ok(await until(B, () => !document.querySelector(".sd-matchlist.sealed") && document.querySelectorAll(".sd-dcell.open").length === 3, null, 10000), "they unlock, and the answers can be matched");
        ok((await B.locator(".sd-entry").count()) === 3, "three unsigned answers");
        ok((await B.locator(".sd-who").first().locator("button").count()) === 2, "you match against the other writers only");
        await B.locator(".sd-who button").first().click(); await shot(B, "13-diary-written");
      }
    }
    for (const pg of [A, B, C]) await pg.click("#sd-lock").catch(() => {});
    // after every question: the points screen
    ok(await until(B, () => document.querySelectorAll(".sd-pts .sd-pt-row").length === 3, null, 20000), `after question ${k + 1}: points for all three`);
    if (k === 0) {
      ok(!(await B.locator("#sd-next").count()) && (await A.locator("#sd-next").count()) === 1, "only the host gets 'next question'");
      await sleep(1600); await shot(B, "15-diary-points");
      await A.click("#sd-next");
    }
  }
  ok(seenTypes.size === 2, "both written and yes/no questions came up");
  ok(await until(A, () => /Secret Diary/.test(document.querySelector(".hp-res-title")?.textContent ?? ""), null, 20000), "the diary reaches its results screen");
  await shot(A, "18-diary-results");
  ok(await A.evaluate(() => (window.__logRows ?? []).length) >= 5 && await A.evaluate(() => window.__logRows.some(r => r.skipped)), "the host's phone logged the questions, including the swap");

  head("Art Gallery — the dealer unveils the titles on wall plaques");
  for (let i = 0; i < 20 && await A.locator("#party-panel").isHidden(); i++) { await A.evaluate(() => document.getElementById("hp-skip")?.click()); await sleep(600); }
  ok(await until(A, () => !document.getElementById("party-panel").hidden, null, 15000), "back in the lobby");
  await A.click("#pt-open-picker"); await A.click('[data-queue="artgallery"]'); await A.click("#pt-picker-done"); await A.click("#pt-start");
  ok(await until(B, () => /fill your 3 frames/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "everyone fills 3 frames");
  for (const [k, pg] of [A, B, C].entries()) for (let i = 0; i < 3; i++) {
    await until(pg, () => !!document.getElementById("ag-file"));
    await pg.setInputFiles("#ag-file", join(ROOT, `web/games/captions/c${(k * 3 + i) % 8}.jpg`));
    await sleep(500);
  }
  ok(await until(A, () => window.__game?.s?.phase === "title", null, 30000), "all 9 photos in, titling opens");
  // wait for each phone to draw its title screen before deciding it has
  // nothing to title — on a slow machine it may still show the photo step
  const titleStep = () => /title this piece|titles locked|nothing to title/.test(document.querySelector("#game-panel h2")?.textContent ?? "") || !!document.querySelector(".ag-room");
  for (const pg of [A, B, C]) for (let k = 0; k < 6; k++) {
    await until(pg, titleStep);
    const t = await stageTitle(pg);
    if (!/title this piece/.test(t)) break;
    await until(pg, () => document.getElementById("gp-in") && !document.getElementById("gp-in").disabled);
    await pg.fill("#gp-in", `${pg.label} title ${k + 1}`); await pg.click("#game-panel .gp-form button");
    await until(pg, t => (document.querySelector("#game-panel h2")?.textContent ?? "") !== t, t, 5000);
  }
  const inRoom = await until(B, () => !!document.querySelector("#game-panel.ag-full .ag-room"), null, 30000);
  const where = inRoom ? "" : ` — host at ${await A.evaluate(() => `${window.__game?.s?.phase}/${window.__game?.s?.sub}`)}; screens: ${(await Promise.all([A, B, C].map(stageTitle))).join(" | ")}`;
  ok(inRoom, "the gallery is a full-screen room, no white card" + where);
  ok(await B.locator("#game-panel .stage").count() === 0, "the vote step has no stage card");
  ok(await until(A, () => document.querySelectorAll(".ag-room.covered .ag-pl-cloth").length === 2), "both title plaques start under cloth");
  // screenshot first: a screenshot stalls animations in the other tabs, so
  // nothing else may run while the unveil is being timed (the cover lasts ~3 s)
  await shot(B, "19-gallery-covered");
  await A.bringToFront();   // after a screenshot the other tabs can stop drawing frames
  // measured on the host's phone (A), where a late reset once rebuilt the room
  // mid-unveil, from the moment the room flips to revealed
  const seq = await A.evaluate(() => new Promise(res => {
    const op = () => [...document.querySelectorAll(".ag-pl-cloth")].map(c => +getComputedStyle(c).opacity);
    const t0 = Date.now();
    const watch = () => {
      const room = document.querySelector(".ag-room");
      if (!room || !room.classList.contains("revealed")) return Date.now() - t0 > 15000 ? res({}) : setTimeout(watch, 20);
      const out = {}; [400, 1150, 2400].forEach(t => setTimeout(() => { out[t] = op(); }, t)); setTimeout(() => res(out), 2500);
    };
    watch();
  }));
  ok(seq[400]?.every(o => o > 0.9), `the painting goes first: plaques still covered at 0.4 s (${JSON.stringify(seq[400])})`);
  ok(seq[1150]?.[0] < 0.9 && seq[1150]?.[1] > 0.9, `then plaque I, then plaque II — one by one (${JSON.stringify(seq[1150])} at 1.15 s)`);
  ok(seq[2400]?.every(o => o < 0.05), "both plaques unveiled within ~2.5 s");
  // with 3 players each frame has 2 writers, so exactly one phone gets to vote
  let voter = null;
  for (let i = 0; i < 20 && !voter; i++) { for (const pg of [A, B, C]) if (await pg.locator(".ag-pl[data-v]").count() === 2) voter = pg; if (!voter) await sleep(250); }
  ok(!!voter, "the non-writer's plaques are tappable");
  if (voter) {
    const writer = [A, B, C].find(pg => pg !== voter);
    ok(await writer.locator(".ag-pl[data-v]").count() === 0 && /yours/.test(await text(writer, "#ag-pill")), "writers see the plaques but can't vote, and are told one is theirs");
    await voter.locator('.ag-pl[data-v="1"]').click();
    ok(await until(voter, () => document.querySelector('.ag-pl[data-v="1"]')?.classList.contains("on") && document.querySelector(".ag-room")?.classList.contains("picked")), "tapping a plaque marks it with the red dot");
    await shot(voter, "20-gallery-voted");
    // a title that wraps must not make its plaque bigger than the other one
    const hs = await voter.evaluate(() => {
      const t = document.querySelector(".ag-pl .ag-pl-t"), was = t.textContent;
      t.textContent = "“a much longer title that wraps onto three lines on a phone”";
      const h = [...document.querySelectorAll(".ag-pl")].map(p => p.offsetHeight);
      t.textContent = was;
      return h;
    });
    ok(hs.length === 2 && hs[0] === hs[1], `both plaques are the same size, even when one title wraps (${hs.join(" / ")} px)`);
    ok(await until(A, () => Object.keys(window.__game?.s?.frames?.[window.__game.s.fi]?.votes ?? {}).length >= 1 || window.__game?.s?.sub === "result"), "the vote reaches the host");
  }
  ok(await until(A, () => document.querySelectorAll(".ag-room .ag-pl-n").length === 2, null, 20000), "the result shows authors and votes on the same plaques");
  ok(await A.locator(".ag-pl-by").count() === 2, "each plaque names its author once the votes are in");
  await sleep(900);
  const ws = await A.evaluate(() => [...document.querySelectorAll(".ag-pl")].map(p => Math.round(p.getBoundingClientRect().width)));
  ok(ws.length === 2 && Math.abs(ws[0] - ws[1]) <= 1, `the winning plaque settles back to the same size (${ws.join(" / ")} px wide)`);
  await shot(A, "21-gallery-result");
  // the host skips each remaining vote rather than waiting out its 25 s timer;
  // cover and result still run (~10 s a frame), so allow up to ~90 s
  for (let i = 0; i < 120 && !/Art Gallery/.test(await A.evaluate(() => document.querySelector(".hp-res-title")?.textContent ?? "")); i++) {
    await A.evaluate(() => document.getElementById("ag-skip")?.click()); await sleep(600);
  }
  ok(await until(A, () => /Art Gallery/.test(document.querySelector(".hp-res-title")?.textContent ?? ""), null, 30000), "the gallery plays out to its results screen");
} catch (e) {
  ok(false, "crashed: " + (e.stack || e).toString().split("\n").slice(0, 3).join(" | "));
}

ok(errors.length === 0, "no page errors" + (errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
