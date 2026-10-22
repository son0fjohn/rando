// Recordings of the party games, played on several "phones" through the real
// UI (test/hpparty.html, real characters), for review:
//   sidequest  4 phones: the host's setup, the wizard + crystal ball, a full
//              turn (timer, Done, star votes, points) and a Give-up turn
//   ritual     3 phones: one full charades turn — the performer's prompt and
//              live guess feed, a guesser typing, the performer tapping it
//   maskoff    4 phones: two Mask Off turns — the pick, the truth card, the
//              room rating honesty, the mask reveal (MASK OFF, then MASK ON)
//   party      4 phones: a full set of 3 games (skipped through) ending on the
//              podium with coins, then a shop purchase in the real app
//
//   node test/games_rec.mjs <dir> [sidequest|ritual|maskoff|party ...]
// Every phone is screencast; with FFMPEG=/path/to/ffmpeg each scene is also
// written as <dir>/<scene>.mp4, the phones side by side on one timeline.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--") && !["sidequest", "ritual", "maskoff", "party"].includes(a));
if (!OUT) { console.error("usage: node test/games_rec.mjs <dir> [sidequest|ritual|party ...]"); process.exit(2); }
const WIZARD = process.env.WIZARD ? `&wizard=${process.env.WIZARD}` : "";   // WIZARD=dealer: the 3D wizard on the dealer's rig
const SCENES = args.filter(a => ["sidequest", "ritual", "maskoff", "party"].includes(a));
if (!SCENES.length) SCENES.push("sidequest", "ritual", "maskoff", "party");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const LOOKS = {
  alice: { skin: "2", hair: "f1", hairColor: "brown", face: "f1", iris: "blue", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-white-stripe" },
  bob: { skin: "4", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "tee-white-graphic", bottom: "jeans-baggy-blue", shoes: "sneaker-hitop-black" },
  cy: { skin: "1", hair: "f2", hairColor: "red", face: "f2", iris: "green", top: "tee-baggy-black", bottom: "skirt-pleated-black", shoes: "clog-pink" },
  dee: { skin: "3", hair: "m3", hairColor: "white", face: "f5", iris: "navy", top: "none", bottom: "track-navy", shoes: "boot-work-tan" },
};
const until = (pg, fn, arg, ms = 20000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- recording
async function screencast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast").catch(() => {}) };
}
// write each phone's frames on a shared timeline [t0, t1], then put them side by side
async function writeScene(name, casts) {
  await Promise.all(casts.map(c => c.stop()));
  const all = casts.flatMap(c => c.frames.map(f => f.t));
  if (!all.length) return;
  const t0 = Math.min(...all), t1 = Math.max(...all) + 0.5;
  const dirs = [];
  for (const [k, c] of casts.entries()) {
    const dir = join(OUT, name, `phone${k + 1}`);
    await mkdir(dir, { recursive: true });
    let list = "ffconcat version 1.0\n";
    const fr = c.frames;
    for (let i = 0; i < fr.length; i++) {
      const n = `f${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(dir, n), Buffer.from(fr[i].data, "base64"));
      // the first frame also covers the time before this phone's cast began
      const start = i === 0 ? t0 : fr[i].t, end = fr[i + 1]?.t ?? t1;
      list += `file ${n}\nduration ${Math.max(0.016, end - start).toFixed(3)}\n`;
    }
    await writeFile(join(dir, "frames.ffconcat"), list);
    dirs.push(dir);
  }
  if (!process.env.FFMPEG) return;
  const inputs = dirs.flatMap(d => ["-f", "concat", "-i", join(d, "frames.ffconcat")]);
  const scale = dirs.map((_, i) => `[${i}:v]fps=30,scale=390:844,setsar=1[v${i}]`).join(";");
  const stack = dirs.length > 1 ? `${dirs.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${dirs.length}[out]` : "[v0]null[out]";
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${scale};${stack}`, "-map", "[out]", "-pix_fmt", "yuv420p", "-crf", "26", join(OUT, `${name}.mp4`)]);
  log(`  wrote ${name}.mp4 (${dirs.length} phones, ${Math.round(t1 - t0)} s)`);
}

// ---------------------------------------------------------------- phones
// Each phone gets its own window: a background TAB doesn't render, so its
// screencast would freeze. Same context, so they share the BroadcastChannel
// "network" and the coin stub's storage.
let browserCdp = null;
async function newWindow(ctx) {
  browserCdp ??= await browser.newBrowserCDPSession();
  if (!ctx._cid) {
    const first = await ctx.newPage();
    const s = await ctx.newCDPSession(first);
    ctx._cid = (await s.send("Target.getTargetInfo")).targetInfo.browserContextId;
    return first;
  }
  const made = ctx.waitForEvent("page");
  await browserCdp.send("Target.createTarget", { url: "about:blank", browserContextId: ctx._cid, newWindow: true, background: false });
  const pg = await made;
  await pg.setViewportSize({ width: 390, height: 844 });
  return pg;
}
async function phones(names, { coins = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
  const pages = {};
  const open = async (name, qs = "") => {
    const pg = await newWindow(ctx);
    pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
    pg.on("console", m => { if (/\[wizard3d\]/.test(m.text())) log(`    [${name}] ${m.text()}`); });
    if (process.env.DEBUG_REC) pg.on("console", m => { if (/\[party\]|coin/i.test(m.text())) log(`    [${name}] ${m.text()}`); });
    await pg.goto(`${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}${coins ? "&coinhook=1" : ""}${WIZARD}${qs}`);
    await pg.waitForFunction(() => window.__ready);
    pg.label = name;
    return pg;
  };
  const host = pages[names[0]] = await open(names[0]);
  await host.click("#party-btn");
  await host.fill("#pt-name", "Saturday night");
  await host.click("#pt-create");
  await until(host, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? ""));
  const code = (await host.locator("#pt-code-chip").innerText()).trim();
  for (const n of names.slice(1)) pages[n] = await open(n, `&party=${code}`);
  await until(host, n => document.querySelectorAll(".lr-av").length === n, names.length, 30000);
  return { ctx, pages, list: names.map(n => pages[n]), host };
}
const idOf = pg => `u-${pg.label}`;
const stateOn = pg => pg.evaluate(() => { const s = window.__game?.s; return s ? JSON.parse(JSON.stringify(s)) : null; });
const phaseIs = (pg, ph, ms = 30000) => until(pg, ph => window.__game?.s?.phase === ph, ph, ms);
async function queue(host, game) {
  await host.click("#pt-vote");
  const title = host.locator(`[data-game="${game}"] .pv-t > b`);
  await title.waitFor({ state: "visible" });
  await sleep(700);                                       // the sheet slides up
  await title.scrollIntoViewIfNeeded().catch(() => {});
  await title.click({ timeout: 10000 }).catch(() => title.evaluate(b => b.click()));
}
const skip = pg => pg.locator("#hp-skip").first().click().catch(() => {});
const backInRoom = pg => until(pg, () => !document.getElementById("party-panel").hidden, null, 40000);

// ---------------------------------------------------------------- Side Quest
async function sidequest() {
  log("\nSide Quest");
  const P = await phones(["alice", "bob", "cy", "dee"]);
  const casts = await Promise.all(P.list.map(screencast));
  const A = P.host;
  await sleep(1500);
  await queue(A, "sidequest");
  await until(A, () => !!document.getElementById("sq-go"));
  await sleep(1500);
  await A.click('[data-open="anywhere"]'); await sleep(1200);
  await A.locator(".sq-q").nth(5).click(); await sleep(900);          // one quest off
  await A.locator(".sq-q").nth(5).click(); await sleep(700);          // …and back on
  await A.click('[data-cat="strangers"]'); await sleep(1200);         // a whole category off
  await A.click('[data-cat="strangers"]'); await sleep(900);          // …and on
  await A.click('[data-open="anywhere"]'); await sleep(500);
  for (let i = 0; i < 2; i++) { await A.locator('[data-turns]').first().click(); await sleep(500); }   // 4 → 2 turns
  await sleep(800);
  await A.click("#sq-go");
  for (let turn = 1; turn <= 2; turn++) {
    // first who: the ball lands on a face and the wizard names them; then what
    await phaseIs(A, "spin", 40000);
    const whoId = (await stateOn(A)).turn.who;
    const picked = P.list.find(pg => idOf(pg) === whoId);
    const other = P.list.find(pg => pg !== picked);
    await until(other, () => !!document.querySelector("#sq-dlg .y-dlg.done"), null, 15000);
    if (turn === 1) await other.screenshot({ path: join(OUT, "sidequest-1-player-reveal.png") }), await picked.screenshot({ path: join(OUT, "sidequest-2-player-reveal-chosen.png") });
    await phaseIs(A, "quest", 15000);
    await until(other, () => !!document.querySelector("#sq-slot .sq-card"), null, 10000);
    await sleep(700);
    if (turn === 1) await other.screenshot({ path: join(OUT, "sidequest-3-quest-reveal.png") });
    await phaseIs(A, "do", 40000);
    const s = await stateOn(A);
    const perf = P.list.find(pg => idOf(pg) === s.turn.who);
    log(`  turn ${turn}: ${perf.label} — ${s.turn.quest.text}`);
    await sleep(6000);
    if (turn === 1) {
      // the room rates while the quest is on; the turn ends once all three have
      const stars = [5, 4, 4];
      for (const [k, pg] of P.list.filter(pg => pg !== perf).entries()) { await pg.locator(`[data-star="${stars[k]}"]`).click(); await sleep(1400); }
    } else {
      await perf.click("#sq-giveup"); await sleep(1200);
      await perf.click("#sq-giveup");
    }
    await phaseIs(A, "result", 10000);
    const r = (await stateOn(A)).turn;
    log(`    ${r.status}: avg ${r.avg} → +${r.pts}`);
    await sleep(8500);
  }
  await phaseIs(A, "end", 15000);
  await sleep(4000);
  await writeScene("sidequest", casts);
  await P.ctx.close();
}

// ---------------------------------------------------------------- Mask Off
// two full turns on 4 phones: the pick, the card flipping up, the room rating
// (one turn honest -> MASK OFF, one fake -> MASK ON), the reveal, the points
async function maskoff() {
  log("\nMask Off");
  const P = await phones(["alice", "bob", "cy", "dee"]);
  const casts = await Promise.all(P.list.map(screencast));
  const A = P.host;
  await sleep(1500);
  await queue(A, "mask_off");
  const snaps = [];
  // three turns, one of each verdict: 4–5 MASK OFF, 3 SUS, 1–2 MASK ON
  for (const [turn, stars] of [[1, [5, 4, 5]], [2, [3, 3, 4]], [3, [1, 2, 2]]]) {
    await phaseIs(A, "talk", 30000);
    const s = await stateOn(A);
    const who = P.list.find(pg => idOf(pg) === s.turn.who);
    log(`  turn ${turn}: ${who.label} — level ${s.turn.card.level}: ${s.turn.card.text}`);
    await sleep(3500);                                   // they answer out loud
    const raters = P.list.filter(pg => pg !== who);
    if (turn === 1) await raters[0].screenshot({ path: join(OUT, "maskoff-1-card-rater.png") }), await who.screenshot({ path: join(OUT, "maskoff-2-card-answering.png") });
    for (const [k, pg] of raters.entries()) { await pg.locator(`[data-honest="${stars[k]}"]`).click(); await sleep(1200); }
    if (turn === 1) await raters[0].screenshot({ path: join(OUT, "maskoff-3-rated.png") });
    await phaseIs(A, "reveal", 10000);
    const snap = snapReveal(who);
    await sleep(2600);                                   // the verdict plays out live
    await who.screenshot({ path: join(OUT, `maskoff-${turn + 3}-reveal.png`) });
    const r = (await stateOn(A)).turn;
    log(`    ${r.status}: avg ${r.avg?.toFixed(2)} → ${r.verdict} +${r.pts}`);
    snaps.push([`maskoff-reveal-${turn}`, await snap]);
    await sleep(3000);
  }
  await writeScene("maskoff", casts);
  await P.ctx.close();
  for (const [name, snap] of snaps) await filmReveal(snap, name);
}

// The reveal is short and the software renderer drops frames, so it is also
// filmed frame by frame: the moment the verdict lands on the performer's
// phone, the verdict panel (its DOM, the sprite and the page's CSS) is copied;
// after the scene the reveal is replayed in a light page of its own and
// stepped at 15 fps. Same markup, same CSS; only the dimmed room is left out.
async function snapReveal(pg) {
  const verdict = await pg.waitForFunction(() => ["off", "sus", "on"].find(v => document.getElementById("mo-reveal")?.classList.contains(v)), null, { timeout: 15000 }).then(h => h.jsonValue());
  const snap = await pg.evaluate(async () => {
    const stage = document.querySelector(".stage"), face = stage.querySelector(".pb-face");
    const clone = stage.cloneNode(true);
    clone.querySelector("#mo-reveal").classList.remove("off", "sus", "on");
    clone.querySelector("#mo-stamp")?.classList.remove("show");
    clone.querySelector("#mo-pts")?.classList.remove("on");
    const bg = face && getComputedStyle(face).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1];
    if (bg) {
      const blob = await (await fetch(bg)).blob();
      const data = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
      clone.querySelector(".pb-face").style.backgroundImage = `url("${data}")`;
    }
    let html = clone.outerHTML;
    for (let el = stage.parentElement; el && el !== document.body; el = el.parentElement)
      html = `<${el.tagName.toLowerCase()} id="${el.id}" class="${el.className}" style="position:static;display:block">${html}</${el.tagName.toLowerCase()}>`;
    const css = [...document.styleSheets].map(sh => { try { return [...sh.cssRules].map(r => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
    const r = stage.getBoundingClientRect();
    return { html, css, body: document.body.className, w: innerWidth, avg: window.__game?.s?.turn?.avg ?? 0 };
  });
  return { ...snap, verdict };
}
async function filmReveal(snap, name) {
  const verdict = snap.verdict;
  const fctx = await browser.newContext({ deviceScaleFactor: 2 });
  const film = await fctx.newPage();
  await film.setViewportSize({ width: snap.w, height: 520 });
  await film.setContent(`<!doctype html><html><head><style>${snap.css}</style></head><body class="${snap.body}" style="background:#0a0b1e;margin:0;padding-top:12px">${snap.html}</body></html>`);
  await film.waitForTimeout(400);
  const box = await film.locator(".stage").boundingBox();
  const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 480) };
  const FPS = 15, frames = [];
  const shoot = async () => frames.push(await film.screenshot({ clip }));
  // add a class to one element, hold its new animations at 0; then step them
  const play = (cls, sel) => film.evaluate(([cls, sel]) => { const el = document.querySelector(sel); el.classList.add(cls); el.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = 0; }); }, [cls, sel]);
  const at = (sel, ms) => film.evaluate(([sel, ms]) => document.querySelector(sel).getAnimations({ subtree: true }).forEach(a => { a.currentTime = ms; }), [sel, ms]);
  // the score counts up alongside, as in the game (1.3 s), then the points pop
  const count = ms => film.evaluate(([avg, ms]) => { const k = Math.min(1, ms / 1300); const av = document.getElementById("mo-avg"); if (av) av.textContent = (avg * k).toFixed(1); if (k >= 1) document.getElementById("mo-pts")?.classList.add("on"); }, [snap.avg, ms]);
  await count(0);
  for (let i = 0; i < 8; i++) await shoot();                           // the beat before
  await play(verdict, "#mo-reveal");
  for (let ms = 0; ms <= 1700; ms += 1000 / FPS) { await at("#mo-reveal", ms); await count(ms); await shoot(); }
  await play("show", "#mo-stamp");
  for (let ms = 0; ms <= 400; ms += 1000 / FPS) { await at("#mo-stamp", ms); await shoot(); }
  for (let i = 0; i < 20; i++) await shoot();                          // hold on the verdict
  await fctx.close();
  const dir = join(OUT, name);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < frames.length; i++) await writeFile(join(dir, `f${String(i).padStart(4, "0")}.png`), frames[i]);
  if (process.env.FFMPEG) execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"),
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", join(OUT, `${name}-${verdict}.mp4`)]);
  log(`    filmed the ${verdict} reveal (${frames.length} frames)`);
  return verdict;
}

// ---------------------------------------------------------------- Humiliation Ritual
async function ritual() {
  log("\nHumiliation Ritual");
  const P = await phones(["alice", "bob", "cy"]);
  const A = P.host;
  await sleep(1000);
  await queue(A, "ritual");
  await phaseIs(A, "prep", 15000);
  const s = await stateOn(A);
  const perf = P.list.find(pg => idOf(pg) === s.turn.performer);
  const [g1, g2] = P.list.filter(pg => pg !== perf);
  // record the performer and one guesser, side by side
  const casts = [await screencast(perf), await screencast(g1)];
  log(`  performer: ${perf.label} — ${s.turn.prompt}`);
  await phaseIs(A, "act", 15000);
  await sleep(2500);
  const wrong = ["a horse", "sneezing", "swimming"];
  for (const w of wrong.slice(0, 2)) { await g1.fill("#gp-in", w); await g1.press("#gp-in", "Enter"); await sleep(1600); }
  await g2.fill("#gp-in", "crying baby"); await g2.press("#gp-in", "Enter"); await sleep(1800);
  const word = s.turn.prompt.split(/[\s-]+/).slice(-1)[0].toLowerCase();
  await g1.fill("#gp-in", word); await g1.press("#gp-in", "Enter"); await sleep(1800);       // close
  await g2.fill("#gp-in", s.turn.prompt.toLowerCase()); await g2.press("#gp-in", "Enter"); await sleep(2500);   // right
  await perf.locator("#hr-feed .hr-g.match").first().click();
  await phaseIs(A, "result", 8000);
  await sleep(7500);
  await writeScene("ritual", casts);
  const r = (await stateOn(A)).turn;
  log(`  ${r.won ? `got it: +${r.pts} guesser, +${r.perfPts} performer in ${r.secs}s` : "nobody got it"}`);
  await P.ctx.close();
}

// ---------------------------------------------------------------- full set + coins + shop
async function partySet() {
  log("\nA full party: 3 games → podium → coins → shop");
  const P = await phones(["alice", "bob", "cy", "dee"], { coins: true });
  const casts = [await screencast(P.host), await screencast(P.pages.bob)];
  const A = P.host;
  await sleep(2500);
  for (const game of (process.env.DEBUG_REC === "1" ? ["mask_off"] : ["mask_off", "ritual", "sidequest"])) {
    await queue(A, game);
    await until(A, () => !document.getElementById("game-layer").hidden);
    await sleep(2500);
    if (game === "sidequest") { await A.click("#sq-go").catch(() => {}); }
    // play it out quickly: the host skips each phase; guests rate / guess where asked
    for (let i = 0; i < 80; i++) {
      const s = await stateOn(A);
      if (!s || s.phase === "end") break;
      for (const pg of P.list) {
        if (await pg.locator('[data-honest="4"]:not([disabled])').count()) await pg.locator('[data-honest="4"]').click().catch(() => {});
        if (await pg.locator('[data-star="4"]').count()) await pg.locator('[data-star="4"]').click().catch(() => {});
        if (game === "ritual" && s.phase === "act" && await pg.locator("#gp-in").count()) { await pg.fill("#gp-in", s.turn.prompt).catch(() => {}); await pg.press("#gp-in", "Enter").catch(() => {}); }
        if (await pg.locator("#hr-feed .hr-g.match").count()) await pg.locator("#hr-feed .hr-g.match").first().click().catch(() => {});
      }
      await sleep(1100);
      if (["pick", "reveal", "prep", "wizard", "quest", "spin", "result"].includes(s.phase) || (["do", "talk"].includes(s.phase) && i % 3 === 2)) await skip(A);
    }
    await sleep(3000);
    await skip(A);
    await backInRoom(A);
    log(`  ${game}: done, back in the room`);
    await sleep(5000);
  }
  await until(A, () => !!document.getElementById("pp"), null, 15000);
  await sleep(9000);              // the podium, then the coins burst
  const coins = await A.evaluate(() => document.getElementById("pp-coins")?.innerText ?? "");
  log(`  podium up; host's coins: ${coins.replace(/\s+/g, " ")}`);
  const st = await A.evaluate(() => window.__coins?.());
  if (st) {
    for (const [k, g] of Object.entries(st.games)) log(`    ${k.split("|").slice(1).join(".")} ${g.game}: ranking ${g.ranking.map(e => `${e.id}#${e.place}`).join(" ")} · receipts ${(st.receipts[k] ?? []).join(" ")}`);
    log(`    ledger: ${st.ledger.map(l => `${l.user}${l.delta > 0 ? "+" : ""}${l.delta}(${l.reason})`).join(" ")}`);
  }
  await writeScene("party", casts);

  // the shop: same browser storage, so the coins the stub "server" paid are there
  const app = await newWindow(P.ctx);
  app.on("pageerror", e => errors.push(`app: ${e.message}`));
  await app.goto(`${base}/app.html?me=alice&av=${encodeURIComponent(JSON.stringify(LOOKS.alice))}&devlat=37.5347&devlng=126.9945`);
  await app.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 40000 });
  const shop = [await screencast(app)];
  await sleep(5000);
  await app.click("#nav-style"); await sleep(3500);
  await app.locator("#outfit-tabs button", { hasText: /shop/i }).click(); await sleep(2000);
  const bal = await app.locator("#style-coins").innerText();
  const buy = app.locator("[data-buy]:not([disabled])").last();     // the dearest thing we can afford
  log(`  shop: balance ${bal.trim()}; items ${(await app.locator("[data-buy]").evaluateAll(bs => bs.map(b => b.textContent.trim() + (b.disabled ? "x" : "")))).join(" ")}`);
  await buy.scrollIntoViewIfNeeded(); await sleep(1200);
  await buy.click(); await sleep(3500);
  log(`  bought: balance now ${(await app.locator("#style-coins").innerText()).trim()}`);
  await sleep(2000);
  await writeScene("shop", shop);
  await P.ctx.close();
}

for (const s of SCENES) {
  try { await ({ sidequest, ritual, maskoff, party: partySet })[s](); }
  catch (e) { errors.push(`${s}: ${e.message}`); console.log(`  ✗ ${s}: ${e.message}`); }
}
if (errors.length) console.log("page errors:\n" + errors.slice(0, 20).join("\n"));
await browser.close(); close();
process.exit(errors.length ? 1 : 0);
