// Recordings of the party games, played on several "phones" through the real
// UI (test/hpparty.html, real characters), for review:
//   sidequest  3 phones (2 in the video): the host's setup, the Prophet
//              and his crystal ball, a full turn (Accept, timer, ratings,
//              verdict, his nod) and a Give-up turn
//   ritual     3 phones (2 in the video): one full charades turn — the Boss
//              reaches into his box, holds a capsule up ("[Name]. You're
//              up."), twists it open (the slip on the performer's phone,
//              peek/smirk/"Shhh." on a guesser's), the live guess feed, a
//              guesser typing, the performer tapping it, his nod
//   maskoff    3 phones: the deck setup, a full Mask Off turn (hand, card,
//              mask off, Same, Go deeper), a Pass turn, the "masks off" end
//   party      4 phones: a full set of 3 games (skipped through) ending on the
//              podium with coins, then a shop purchase in the real app
//   turns      2 phones + 3 bots: 10 Side Quest turns and 10 Ritual turns
//              skipped through, looking around on both phones every turn,
//              checking the chosen player (right one, one at a time)
//
//   node test/games_rec.mjs <dir> [sidequest|ritual|maskoff|party|turns ...]
// Every phone is screencast; with FFMPEG=/path/to/ffmpeg each scene is also
// written as <dir>/<scene>.mp4, the phones side by side on one timeline.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--") && !["sidequest", "ritual", "maskoff", "artgallery", "party", "turns"].includes(a));
if (!OUT) { console.error("usage: node test/games_rec.mjs <dir> [sidequest|ritual|party ...]"); process.exit(2); }
const SCENES = args.filter(a => ["sidequest", "ritual", "maskoff", "artgallery", "party", "turns"].includes(a));
if (!SCENES.length) SCENES.push("sidequest", "ritual", "maskoff", "artgallery", "party");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const LOOKS = {
  alice: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  bob: { skin: "4", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "bucket", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  cy: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "star-sticker", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
  dee: { skin: "3", eyes: "keen", iris: "gray", hairColor: "platinum", hair: "buzz", head: "durag", face: "shades-round", top: "track-purple", bottom: "track-pants", shoes: "combat", neck: "none" },
};
const until = (pg, fn, arg, ms = 20000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 80 }).then(() => true).catch(() => false);
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- recording
async function screencast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast").catch(() => {}) };
}
// write each phone's frames on a shared timeline [t0, t1], then put them side by side
// from: drop what came before this moment (epoch seconds), keeping the frame
// that was on screen then
async function writeScene(name, casts, { from = 0 } = {}) {
  await Promise.all(casts.map(c => c.stop()));
  if (from) for (const c of casts) { const k = c.frames.findLastIndex(f => f.t <= from); if (k > 0) c.frames.splice(0, k); if (c.frames[0] && c.frames[0].t < from) c.frames[0].t = from; }
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
async function phones(names, { coins = false, dpr = 2, qs: extra = {}, hostQs = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
  const pages = {};
  const open = async (name, qs = "") => {
    const pg = await newWindow(ctx);
    pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
    pg.on("console", m => { if (/\[charrender\]/.test(m.text())) log(`    [${name}] ${m.text()}`); });
    if (process.env.DEBUG_REC) pg.on("console", m => { if (/\[party\]|coin/i.test(m.text())) log(`    [${name}] ${m.text()}`); });
    await pg.goto(`${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}${coins ? "&coinhook=1" : ""}${qs}`);
    await pg.waitForFunction(() => window.__ready);
    pg.label = name;
    return pg;
  };
  const host = pages[names[0]] = await open(names[0], hostQs);
  await host.click("#party-btn");
  await host.fill("#pt-name", "Saturday night");
  await host.click("#pt-create");
  await until(host, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? ""));
  const code = (await host.locator("#pt-code-chip").innerText()).trim();
  for (const n of names.slice(1)) pages[n] = await open(n, `&party=${code}${extra[n] ?? ""}`);
  await until(host, n => document.querySelectorAll(".lr-av").length >= n, names.length, 30000);
  return { ctx, pages, list: names.map(n => pages[n]), host };
}
const idOf = pg => `u-${pg.label}`;
const stateOn = pg => pg.evaluate(() => { const s = window.__game?.s; return s ? JSON.parse(JSON.stringify(s)) : null; });
const phaseIs = (pg, ph, ms = 30000) => until(pg, ph => window.__game?.s?.phase === ph, ph, ms);
async function queue(host, game, opts = {}) {
  await host.click("#pt-vote");
  const title = host.locator(`[data-game="${game}"] .pv-t > b`);
  await title.waitFor({ state: "visible" });
  await sleep(700);                                       // the sheet slides up
  for (const [k, v] of Object.entries(opts)) await host.locator(`[data-for="${game}"][data-opt="${k}"][data-val="${v}"]`).click().catch(() => {});
  await title.scrollIntoViewIfNeeded().catch(() => {});
  await title.click({ timeout: 10000 }).catch(() => title.evaluate(b => b.click()));
}
const skip = pg => pg.locator("#hp-skip").first().click().catch(() => {});
const backInRoom = pg => until(pg, () => !document.getElementById("party-panel").hidden, null, 40000);

// ---------------------------------------------------------------- Side Quest
async function sidequest() {
  log("\nSide Quest");
  const P = await phones(["alice", "bob", "cy"], { dpr: 1 })   // (3 phones of software GL on one CPU: keep them light);
  // the lobby renders everyone's 3D look while they hang out (charrender.js);
  // three phones doing that in software GL on one CPU take a while
  await Promise.all(P.list.map(pg => pg.evaluate(() => import("/web/charrender.js").then(m => m.warmLooks([])))));
  const casts = await Promise.all(P.list.map(screencast));
  const A = P.host;
  await sleep(1500);
  await queue(A, "sidequest");
  await until(A, () => !!document.getElementById("sq-go"));
  await until(A, () => !!document.querySelector(".sq-room.r3d"), null, 30000);
  await sleep(1500);
  await A.screenshot({ path: join(OUT, "sidequest-0-setup.png") });    // the list over his rooftop
  await A.click('[data-open="anywhere"]'); await sleep(1200);
  await A.screenshot({ path: join(OUT, "sidequest-0b-setup-open.png") });
  await A.locator(".sq-q").nth(5).click(); await sleep(900);          // one quest off
  await A.locator(".sq-q").nth(5).click(); await sleep(700);          // …and back on
  await A.click('[data-open="anywhere"]'); await sleep(500);
  await A.locator('[data-turns]').first().click(); await sleep(800);  // 3 → 2 turns
  await A.click("#sq-go");
  let first = null;
  for (let turn = 1; turn <= 2; turn++) {
    // first who: the ball lands on a face, the Prophet points and names them;
    // then what: the card rises out of the ball
    await phaseIs(A, "spin", 40000);
    const whoId = (await stateOn(A)).turn.who;
    const picked = P.list.find(pg => idOf(pg) === whoId);
    const other = P.list.find(pg => pg !== picked);
    first ??= [picked, other];
    // the ball lands: their name slams in on everyone else's phone, theirs goes gold
    if (turn === 1) {
      await Promise.all([until(other, () => !!document.querySelector(".np-slam"), null, 15000), until(picked, () => !!document.querySelector(".np-take"), null, 15000)]);
      await sleep(350);
      await other.screenshot({ path: join(OUT, "sidequest-1-player-reveal.png") }); await picked.screenshot({ path: join(OUT, "sidequest-2-player-reveal-chosen.png") });
    }
    await until(other, () => { const d = document.querySelector(".sq-room .dlg-box.done .dlg-text"); return d && /\.\.\. \S/.test(d.textContent); }, null, 15000);
    if (turn === 1) await other.screenshot({ path: join(OUT, "sidequest-1b-picked-in-room.png") });
    await phaseIs(A, "quest", 15000);
    await until(other, () => !!document.querySelector("#sq-wall .sq-card"), null, 10000);
    if (turn === 1) {
      await until(other, () => !!document.querySelector("#sq-wall .np-stamp"), null, 6000); await sleep(250);
      await other.screenshot({ path: join(OUT, "sidequest-3-quest-reveal.png") });
      await until(other, () => !!document.querySelector(".np-count"), null, 6000);
      await other.screenshot({ path: join(OUT, "sidequest-3b-countdown.png") });
    }
    await phaseIs(A, "do", 40000);
    const s = await stateOn(A);
    const perf = P.list.find(pg => idOf(pg) === s.turn.who);
    log(`  turn ${turn}: ${perf.label} — ${s.turn.quest.text}`);
    await sleep(2500);
    if (turn === 1) {
      // someone watching looks around the room (drag), then pokes him (tap): he answers between beats
      const watcher = P.list.find(pg => pg !== perf);
      const drag = async (pg, x0, x1, y) => { await pg.mouse.move(x0, y); await pg.mouse.down(); for (let i = 1; i <= 14; i++) { await pg.mouse.move(x0 + (x1 - x0) * i / 14, y); await sleep(20); } await pg.mouse.up(); };
      await drag(watcher, 320, 120, 330); await sleep(1600);
      await drag(watcher, 100, 330, 300); await sleep(1400);
      await watcher.mouse.click(195, 300); await sleep(1500);
      await watcher.screenshot({ path: join(OUT, "sidequest-4b-poke.png") });
      await perf.locator(".sq-room .dlg-choice:not(.warn)").click(); await sleep(2500);   // Accept
      await perf.screenshot({ path: join(OUT, "sidequest-4-accepted.png") });
      // the room rates while the quest is on; the turn ends once both have
      const stars = [5, 4];
      for (const [k, pg] of P.list.filter(pg => pg !== perf).entries()) {
        if (k === 0) await pg.screenshot({ path: join(OUT, "sidequest-5-rate.png") });
        await pg.locator(".sq-room .dlg-choice.sq-star").nth(stars[k] - 1).click(); await sleep(1800);
      }
    } else {
      await perf.locator(".sq-room .dlg-choice.warn").click(); await sleep(1200);
      await perf.locator(".sq-room .dlg-choice.warn").click();
    }
    await phaseIs(A, "result", 10000);
    const r = (await stateOn(A)).turn;
    log(`    ${r.status}: avg ${r.avg} → +${r.pts}`);
    await sleep(1500);
    if (turn === 1) await other.screenshot({ path: join(OUT, "sidequest-6-verdict.png") });
    await sleep(7000);
  }
  await phaseIs(A, "end", 15000);
  await sleep(4000);
  // two phones side by side: turn 1's chosen player and someone watching
  await Promise.all(casts.filter((c, i) => !first.includes(P.list[i])).map(c => c.stop()));
  await writeScene("sidequest", first.map(pg => casts[P.list.indexOf(pg)]));
  await P.ctx.close();
}

// ---------------------------------------------------------------- Mask Off
// 3 phones: the host's deck setup, then a full turn (the asker browsing their
// hand and tapping a card, the card flipping up, the answerer's mask sliding
// off, Same taps, a Go deeper taken), a Pass turn, one more, and the calm
// "masks off" end. Stills come from the screencast (page screenshots can
// stall with several WebGL windows open).
async function maskoff() {
  log("\nMask Off");
  const P = await phones(["alice", "bob", "cy"]);
  const casts = await Promise.all(P.list.map(screencast));
  const A = P.host, castOf = pg => casts[P.list.indexOf(pg)];
  // the lobby renders everyone's 3D look while they hang out (charrender.js)
  await Promise.all(P.list.map(pg => pg.evaluate(() => import("/web/charrender.js").then(m => m.warmLooks([])))));
  const still = async (pg, name) => { const f = castOf(pg).frames.at(-1); if (f) await writeFile(join(OUT, `${name}.jpg`), Buffer.from(f.data, "base64")); };
  const tap = (pg, sel) => pg.locator(sel).first().click({ timeout: 8000 }).catch(e => log(`    (couldn't tap ${sel} on ${pg.label}: ${e.message.split("\n")[0]})`));
  await sleep(1500);
  await queue(A, "mask_off");
  if (!await phaseIs(A, "setup", 8000)) await A.locator('[data-game="mask_off"] .pv-t > b').evaluate(b => b.click()).catch(() => {});   // a hint over the title took the tap
  if (!await phaseIs(A, "setup", 20000)) throw new Error("Mask Off didn't start");
  await sleep(1800);
  await until(A, () => !!document.querySelector('[data-rounds="1"]'), null, 20000);
  await still(A, "maskoff-0-setup");
  if (process.env.DEBUG_MO) log(await A.evaluate(() => JSON.stringify({ panel: document.getElementById("game-panel")?.outerHTML.slice(0, 600), layerHidden: document.getElementById("game-layer").hidden, partyHidden: document.getElementById("party-panel").hidden, body: document.body.className, phase: window.__game?.s?.phase, host: window.__game?.hosting })));
  await A.locator('[data-rounds="1"]').click({ timeout: 30000 });
  if (!await until(A, () => window.__game?.s?.setup?.rounds === 1, null, 10000)) log("    (rounds didn't stick)");
  await tap(A, "#mo-go");
  const turnOn = async n => {
    await until(A, n => window.__game?.s?.ti === n && window.__game?.s?.phase === "choose", n, 40000);
    const s = await stateOn(A);
    return { s, asker: P.list.find(pg => idOf(pg) === s.turn.asker), who: P.list.find(pg => idOf(pg) === s.turn.who) };
  };
  // turn 1: the full turn
  {
    await phaseIs(A, "pick", 30000);
    await sleep(2600);
    await still(A, "maskoff-1a-pick");
    const { asker, who } = await turnOn(0);
    log(`  turn 1: ${asker.label} → asking ${who.label}`);
    await sleep(2600);                                   // browsing the hand
    await still(asker, "maskoff-1-hand");
    await tap(asker, "[data-ask] >> nth=1");
    await phaseIs(A, "talk", 10000);
    log(`    "${(await stateOn(A)).turn.card.text}"`);
    await sleep(2400);
    await still(who, "maskoff-2-card-answerer");
    await tap(who, "#mo-answer");
    await sleep(2000);
    const listeners = P.list.filter(pg => pg !== who);
    for (const pg of listeners) { await tap(pg, "#mo-same"); await sleep(700); }
    await sleep(1200);
    await still(listeners[0], "maskoff-3-listener-same");
    await tap(listeners[1], "#mo-deep");
    await sleep(1800);
    await still(who, "maskoff-4-go-deeper");
    await tap(who, "#mo-dtake");
    await sleep(3000);
    await tap(who, "#mo-done");
    await phaseIs(A, "after", 8000);
    await sleep(2400);
    await still(who, "maskoff-5-same-count");
    const t = (await stateOn(A)).turn;
    log(`    ${t.status} · ${t.same} felt this too · go deeper: ${t.deeper?.text} (${t.deeper?.state})`);
  }
  // turn 2: a pass
  {
    const { asker, who } = await turnOn(1);
    log(`  turn 2: ${asker.label} → asking ${who.label}`);
    await sleep(1800);
    await tap(asker, "[data-ask] >> nth=0");
    await phaseIs(A, "talk", 10000);
    await sleep(2400);
    await tap(who, "#mo-pass");
    await phaseIs(A, "after", 8000);
    await sleep(1800);
    await still(who, "maskoff-6-pass");
    log(`    ${(await stateOn(A)).turn.status}`);
  }
  // turn 3: quickly
  {
    const { asker, who } = await turnOn(2);
    log(`  turn 3: ${asker.label} → asking ${who.label}`);
    await sleep(1200);
    await tap(asker, "[data-ask] >> nth=3");
    await phaseIs(A, "talk", 10000);
    await sleep(1500);
    await tap(who, "#mo-answer");
    await sleep(1500);
    await tap(P.list.find(pg => pg !== who), "#mo-same");
    await sleep(2000);
    await tap(who, "#mo-done");
  }
  await phaseIs(A, "end", 20000);
  await sleep(6000);
  await still(A, "maskoff-7-end");
  const s = await stateOn(A);
  log(`  the end: ${s.sameTotal} moments you weren't alone · scores ${Object.values(s.players).map(p => `${p.handle}:${p.score}`).join(" ")}`);
  await writeScene("maskoff", casts);
  await P.ctx.close();
}

// ---------------------------------------------------------------- Humiliation Ritual
async function ritual() {
  log("\nHumiliation Ritual");
  const P = await phones(["alice", "bob", "cy"], { dpr: 1 })   // (3 phones of software GL on one CPU: keep them light);
  const A = P.host;
  await sleep(1000);
  // film every phone from the start (the Boss's pick, the capsule, the
  // open), then keep the performer's and one guesser's side by side
  const all = new Map();
  // the lobby renders everyone's 3D look while they hang out (charrender.js)
  await Promise.all(P.list.map(pg => pg.evaluate(() => import("/web/charrender.js").then(m => m.warmLooks([])))));
  await sleep(6000);
  for (const pg of P.list) all.set(pg, await screencast(pg));
  await queue(A, "ritual");
  await until(A, () => !document.getElementById("game-layer").hidden, null, 20000);
  const from = Date.now() / 1000 - 0.3;
  await phaseIs(A, "pick", 15000);
  const s = await stateOn(A);
  const perf = P.list.find(pg => idOf(pg) === s.turn.performer);
  const [g1, g2] = P.list.filter(pg => pg !== perf);
  log(`  performer: ${perf.label} (the state carries no prompt: ${!JSON.stringify(s).includes("prompt")})`);
  // the capsule lands: the name slams in on a guesser's phone, the performer's goes to a red spotlight
  await Promise.all([until(g1, () => !!document.querySelector(".np-slam"), null, 15000), until(perf, () => !!document.querySelector(".np-take"), null, 15000)]);
  await sleep(350);
  await g1.screenshot({ path: join(OUT, "ritual-1-pick.png") }); await perf.screenshot({ path: join(OUT, "ritual-2-pick-performer.png") });
  await sleep(1600);
  await g1.screenshot({ path: join(OUT, "ritual-3-on-stage.png") });
  // the open: the slip fills the performer's screen, ACT IT OUT stamped on it; "Shhh." for the rest
  await until(perf, () => !!document.querySelector(".hr-wall.full .hr-kick"), null, 10000); await sleep(400);
  await perf.screenshot({ path: join(OUT, "ritual-4-slip.png") });
  await until(g1, () => /^Shhh\.$/.test(document.querySelector(".hr-room .dlg-text")?.textContent ?? ""), null, 8000);
  await g1.screenshot({ path: join(OUT, "ritual-5-shhh.png") });
  await phaseIs(A, "act", 20000);
  await sleep(900);
  await g1.screenshot({ path: join(OUT, "ritual-6-guess.png") });
  const prompt = await perf.locator(".hr-card .hr-prompt").textContent();
  log(`  the performer's phone shows: ${prompt}`);
  await sleep(2500);
  const wrong = ["a horse", "sneezing", "swimming"];
  for (const w of wrong.slice(0, 2)) { await g1.fill("#gp-in", w); await g1.press("#gp-in", "Enter"); await sleep(1600); }
  await g2.fill("#gp-in", "crying baby"); await g2.press("#gp-in", "Enter"); await sleep(1800);
  const word = prompt.split(/[\s-]+/).slice(-1)[0].toLowerCase();
  await g1.fill("#gp-in", word); await g1.press("#gp-in", "Enter"); await sleep(1800);       // close
  await g2.fill("#gp-in", prompt.toLowerCase()); await g2.press("#gp-in", "Enter"); await sleep(2500);   // right
  const feed = await perf.evaluate(() => [...document.querySelectorAll("#hr-feed .hr-g")].map(b => `${b.className.replace("hr-g", "").trim() || "-"}: ${b.querySelector("span")?.textContent}`));
  log(`  the performer's feed: ${feed.join(" | ")}`);
  await perf.locator("#hr-feed .hr-g.match").first().click({ timeout: 5000 }).catch(e => log(`  (no right guess to tap: ${e.message.split("\n")[0]})`));
  await phaseIs(A, "result", 8000);
  await sleep(1500);
  const r = (await stateOn(A)).turn;
  await sleep(6000);
  await writeScene("ritual", [all.get(perf), all.get(g1)], { from });
  await all.get(g2).stop();
  log(`  ${r.won ? `got it: +${r.pts} guesser, +${r.perfPts} performer in ${r.secs}s; revealed "${r.answer}"` : "nobody got it"}`);
  await P.ctx.close();
}

// ---------------------------------------------------------------- the chosen player, 10 turns
// Side Quest and the Ritual, 10 turns each, on 2 phones with 3 bots (5
// players), looking around on both phones during every turn. On both
// phones, each turn: the chosen player shows up, the right person, and only
// one at a time (the last one gone before the next pops in), never two
// characters in the room. Each game's first full turn is recorded on both
// phones (turns-sidequest, turns-ritual).
async function guestTurns() {
  let fails = 0;
  const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) { fails++; errors.push(`turns: ${m}`); } };
  for (const game of ["sidequest", "ritual"]) {
    log(`\nThe chosen player, 10 turns: ${game === "sidequest" ? "Side Quest" : "the Ritual"}`);
    const P = await phones(["alice", "bob"], { dpr: 1, hostQs: "&bots=3" });
    const A = P.host;
    await Promise.all(P.list.map(pg => pg.evaluate(() => import("/web/charrender.js").then(m => m.warmLooks([])))));
    // every 60 ms, on each phone: who's on stage, how many characters are in the room
    await Promise.all(P.list.map(pg => pg.evaluate(() => {
      window.__gs = [];
      setInterval(() => {
        const sc = window.__prophet ?? window.__boss, s = window.__game?.s;
        if (!sc || !s) return;
        let bodies = 0;
        sc.debug.scene.traverse(o => { if (o.userData?.part === "body" && o.visible) bodies++; });
        window.__gs.push({ key: sc.guest.key, count: sc.guest.count(), bodies, ti: s.ti, who: s.turn?.who ?? s.turn?.performer ?? null, phase: s.phase });
      }, 60);
    })));
    const casts = await Promise.all(P.list.map(screencast));
    await queue(A, game, game === "ritual" ? { rounds: "2" } : {});
    if (game === "sidequest") {
      await until(A, () => !!document.getElementById("sq-go"));
      for (let i = 0; i < 12 && (await A.locator(".sq-turns b").innerText().catch(() => "")) !== "10"; i++) { await A.locator('[data-turns]').last().click().catch(() => {}); await sleep(400); }
      await A.click("#sq-go");
    }
    await until(A, () => window.__game?.s?.turns > 0, null, 30000);
    const turns = (await stateOn(A)).turns;
    log(`  ${turns} turns, ${Object.keys((await stateOn(A)).players).length} players`);
    const from = Date.now() / 1000 - 0.3;
    let recorded = false, lastSkip = 0, side = 1;
    const t0 = Date.now();
    while (Date.now() - t0 < 15 * 60000) {
      const s = await stateOn(A);
      if (!s || s.phase === "end") break;
      // the first turn, start to finish, on both phones
      if (!recorded && s.ti >= 1) { recorded = true; await writeScene(`turns-${game}`, casts, { from }); }
      // look around on both phones (a drag across the room, left then right)
      side = -side;
      await Promise.all(P.list.map(pg => (async () => {
        await pg.mouse.move(195 + side * 120, 260); await pg.mouse.down();
        for (let i = 1; i <= 8; i++) { await pg.mouse.move(195 + side * 120 - side * 30 * i, 260 + (i % 3) * 6); await sleep(20); }
        await pg.mouse.up();
      })()));
      await sleep(900);
      // the host moves things on, but gives every step a few seconds on screen
      if (Date.now() - lastSkip > 3200) { lastSkip = Date.now(); await A.locator("#hp-skip").first().click({ timeout: 1000 }).catch(() => {}); }
    }
    if (!recorded) await writeScene(`turns-${game}`, casts, { from });
    const end = await stateOn(A);
    ok(end?.phase === "end", `${game}: played through all ${turns} turns to the end`);
    for (const pg of P.list) {
      const g = await pg.evaluate(() => window.__gs);
      ok(g.length > 100 && g.every(x => x.count <= 1 && x.bodies <= 1), `${game} · ${pg.label}: never more than one character in the room (${g.length} samples, max ${Math.max(...g.map(x => x.bodies))})`);
      let jumps = 0, wrong = 0;
      for (let i = 1; i < g.length; i++) {
        if (g[i].key && g[i - 1].key && g[i].key !== g[i - 1].key) jumps++;            // a new one in without the last one gone first
        if (g[i].key && g[i].key !== g[i].who && g[i - 1].key !== g[i].key) wrong++;  // someone other than the turn's player popping in
      }
      ok(!jumps, `${game} · ${pg.label}: each one gone before the next pops in (${jumps} straight swaps)`);
      ok(!wrong, `${game} · ${pg.label}: only ever the turn's own player pops in (${wrong} wrong)`);
      const seen = new Set(g.filter(x => x.key && x.key === x.who).map(x => x.ti));
      ok(seen.size >= Math.min(10, turns), `${game} · ${pg.label}: the chosen player was on stage in ${seen.size} of ${turns} turns`);
    }
    await P.ctx.close();
  }
  if (fails) log(`  ${fails} failed`);
}

// ---------------------------------------------------------------- Art Gallery
// the template the NPC scenes follow: one piece, from the cover to the
// result, on a voter's phone and a writer's side by side
async function artgallery() {
  log("\nArt Gallery");
  const P = await phones(["alice", "bob", "cy"]);
  const A = P.host;
  await sleep(1000);
  const all = new Map();
  for (const pg of P.list) all.set(pg, await screencast(pg));
  await queue(A, "artgallery");
  for (const [k, pg] of P.list.entries()) for (let i = 0; i < 3; i++) {
    await until(pg, () => !!document.getElementById("ag-file"));
    await pg.setInputFiles("#ag-file", join(ROOT, `web/games/captions/c${(k * 3 + i) % 8}.jpg`));
    await sleep(400);
    if (k === 0 && i === 0) { await sleep(800); await pg.screenshot({ path: join(OUT, "artgallery-0-photos.png") }); }   // the frames card over the gallery wall
  }
  await phaseIs(A, "title", 30000);
  for (const pg of P.list) for (let n = 0; n < 6; n++) {
    await until(pg, () => /title this piece|titles locked|nothing to title/.test(document.querySelector("#game-panel h2")?.textContent ?? "") || !!document.querySelector(".ag-room"));
    const t = await pg.locator("#game-panel h2").first().innerText().catch(() => "");
    if (!/title this piece/.test(t)) break;
    await until(pg, () => document.getElementById("gp-in") && !document.getElementById("gp-in").disabled);
    if (pg === P.host && n === 0) await pg.screenshot({ path: join(OUT, "artgallery-0b-title.png") });
    await pg.fill("#gp-in", ["a sad little sandwich", "my landlord at 3am", "the vibes were off", "museum of regret", "self portrait, monday", "do not perceive me"][(n + pg.label.length) % 6]);
    await pg.click("#game-panel .gp-form button");
    await until(pg, t => (document.querySelector("#game-panel h2")?.textContent ?? "") !== t, t, 5000);
  }
  await until(A, () => !!document.querySelector(".ag-room.covered"), null, 30000);
  const from = Date.now() / 1000 - 0.2;
  let voter = null;
  for (let i = 0; i < 40 && !voter; i++) { for (const pg of P.list) if (await pg.locator(".ag-pl[data-v]").count() === 2) voter = pg; if (!voter) await sleep(250); }
  const writer = P.list.find(pg => pg !== voter);
  // let Bunny unveil it and bang the gavel before the vote comes in (the
  // last vote ends the voting at once)
  await sleep(6500);
  // the vote: a tap on plaque II where it hangs on the 3D wall (the DOM
  // plaque over it is invisible and lets the tap through to the scene)
  if (voter) {
    const b = await voter.locator('.ag-pl[data-v="1"]').boundingBox().catch(() => null);
    if (b) await voter.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    log(`  tapped plaque II in the scene: ${await until(voter, () => document.querySelector('.ag-pl[data-v="1"]')?.classList.contains("on"), null, 3000) ? "voted" : "NOT voted"}`);
  }
  await until(A, () => document.querySelectorAll(".ag-room .ag-pl-n").length === 2, null, 30000);
  await sleep(5200);
  await writeScene("artgallery", [all.get(voter ?? P.list[1]), all.get(writer)], { from });
  for (const [pg, c] of all) if (pg !== voter && pg !== writer) await c.stop();
  log(`  one piece: the voter (${voter?.label}) and a writer (${writer.label})`);
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
        if (game === "ritual" && s.phase === "act" && await pg.locator("#gp-in").count()) {
          // the prompt is only on the performer's phone
          const said = await Promise.all(P.list.map(x => x.locator(".hr-card .hr-prompt").textContent({ timeout: 300 }).catch(() => null))).then(a => a.find(Boolean));
          if (said) { await pg.fill("#gp-in", said).catch(() => {}); await pg.press("#gp-in", "Enter").catch(() => {}); }
        }
        if (await pg.locator("#hr-feed .hr-g.match").count()) await pg.locator("#hr-feed .hr-g.match").first().click().catch(() => {});
      }
      await sleep(1100);
      if (["pick", "open", "reveal", "prep", "wizard", "quest", "spin", "result"].includes(s.phase) || (["do", "talk"].includes(s.phase) && i % 3 === 2)) await skip(A);
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
  try { await ({ sidequest, ritual, maskoff, artgallery, party: partySet, turns: guestTurns })[s](); }
  catch (e) { errors.push(`${s}: ${e.message}`); console.log(`  ✗ ${s}: ${e.message}`); }
}
if (errors.length) console.log("page errors:\n" + errors.slice(0, 20).join("\n"));
await browser.close(); close();
process.exit(errors.length ? 1 : 0);
