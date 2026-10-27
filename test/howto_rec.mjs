// Each game's host explaining it (howto.js), the first time: a fresh phone
// (+ bots), the game started, the host's how-to played through in full, his
// gestures and the dialog box, then "Let's go" / "How to play" right above
// it. Recorded per game; a screenshot mid-way and at the end.
//
//   node test/howto_rec.mjs <dir> [sidequest,ritual,artgallery,mask_off,secretdiary] [--ko]   (FFMPEG=... for mp4s)
// (Manhunt's Hunter: test/manhunt_rec.mjs, on the real app page with a map.)
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/howto_rec.mjs <dir> [games] [--ko]"); process.exit(2); }
const pickArg = args.find(a => a !== OUT && !a.startsWith("--"));
const GAMES = pickArg ? pickArg.split(",") : ["sidequest", "ritual", "artgallery", "mask_off", "secretdiary"];
const KO = args.includes("--ko");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true).catch(() => false);
const click = (pg, sel) => pg.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel);
const LOOK = { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" };
const setup = { sidequest: "#sq-go", mask_off: "#mo-go", secretdiary: "#sd-send" };
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };

for (const game of GAMES) {
  console.log(`\n${game}`);
  const raw = join(OUT, `${game}-raw`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: KO ? "ko-KR" : "en-US", recordVideo: { dir: raw, size: { width: 390, height: 844 } } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", e => errors.push(e.message));
  if (KO) await pg.addInitScript(() => { try { localStorage.setItem("rando-lang", "ko"); } catch {} });
  await pg.goto(`${base}/test/hpparty.html?me=alice&bots=3&real3d=1&av=${encodeURIComponent(JSON.stringify(LOOK))}`);
  await pg.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await pg.click("#party-btn"); await pg.fill("#pt-name", "Saturday night"); await pg.click("#pt-create");
  await sleep(1500);
  await pg.click("#pt-vote"); await sleep(700);
  await pg.click(`[data-game="${game}"] .pv-t > b`);
  if (setup[game]) { await until(pg, sel => !!document.querySelector(sel), setup[game]); await sleep(1200); await click(pg, setup[game]); }
  ok(await until(pg, () => window.__game?.s?.phase === "howto" && !!document.querySelector("[data-how]"), null, 40000), "the how-to comes first");
  // the whole thing, in full (a first game on this phone): no taps. With
  // only bots at the table it starts by itself once the last line is said
  const lines = [];
  const t0 = Date.now();
  let shot = false;
  while (Date.now() - t0 < 40000) {
    const st = await pg.evaluate(() => ({ phase: window.__game?.s?.phase, text: [...document.querySelectorAll(".dlg-text")].find(t => t.getClientRects().length)?.textContent ?? "", done: [...document.querySelectorAll(".dlg-box")].some(b => b.classList.contains("done")) }));
    if (st.phase !== "howto") break;
    if (st.done && st.text && lines.at(-1) !== st.text) lines.push(st.text);
    if (!shot && lines.length === 2) { shot = true; await pg.screenshot({ path: join(OUT, `${game}-1-explaining.png`) }); }
    await sleep(200);
  }
  ok(lines.length >= 2 && lines.length <= 4, `the host says it in ${lines.length} lines: ${lines.map(l => `“${l}”`).join(" ")}`);
  ok(await until(pg, () => window.__game?.s?.phase !== "howto", null, 8000), `everyone's heard it: the game starts (${await pg.evaluate(() => window.__game?.s?.phase)})`);
  await sleep(3500);
  // the next time on this phone: one line, Let's go and How to play
  await click(pg, "#hp-end"); await sleep(400); await click(pg, "#hp-ask-yes");
  await until(pg, () => !window.party?.current?.launched, null, 15000);
  await sleep(1500);
  await pg.click("#pt-vote"); await sleep(700);
  await pg.click(`[data-game="${game}"] .pv-t > b`);
  if (setup[game]) { await until(pg, sel => !!document.querySelector(sel), setup[game]); await sleep(800); await click(pg, setup[game]); }
  ok(await until(pg, () => !!document.querySelector('[data-how="go"]') && !!document.querySelector('[data-how="more"]'), null, 30000), "the next time: one line, then Let's go and How to play");
  await sleep(1500);
  await pg.screenshot({ path: join(OUT, `${game}-2-next-time.png`) });
  const short = await pg.evaluate(() => [...document.querySelectorAll(".dlg-text")].find(t => t.getClientRects().length)?.textContent ?? "");
  await click(pg, '[data-how="more"]');
  await sleep(2500);
  ok(await pg.evaluate(s => { const t = [...document.querySelectorAll(".dlg-text")].find(t => t.getClientRects().length)?.textContent ?? ""; return t && t !== s; }, short), `(“${short}”) How to play: the whole thing again`);
  await click(pg, '[data-how="skip"]'); await sleep(300); await click(pg, '[data-how="go"]');
  ok(await until(pg, () => window.__game?.s?.phase !== "howto", null, 15000), "Let's go: the game starts");
  await sleep(1500);
  ok(!errors.length, errors.length ? `page errors: ${errors.slice(0, 2).join(" | ")}` : "no page errors");
  await ctx.close();
  const vids = (await readdir(raw).catch(() => [])).filter(f => f.endsWith(".webm"));
  if (vids[0]) {
    await rename(join(raw, vids[0]), join(OUT, `${game}.webm`)); await rm(raw, { recursive: true, force: true });
    if (process.env.FFMPEG) { execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-i", join(OUT, `${game}.webm`), "-pix_fmt", "yuv420p", "-crf", "26", join(OUT, `${game}.mp4`)]); console.log(`  wrote ${game}.mp4`); }
  }
}
await browser.close(); close();
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
