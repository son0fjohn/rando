// Day and night glass (web/daylight.js, theme.css "day and night"): the start
// screen and the map's chrome on the real app page, offline, at night, at
// sunset and by day (?light=), plus the brightest stretch of each: the panel
// over bright sky by day, over the city lights at night. Checks the glass
// really changed (its fill and text colour) and the text stays readable
// (contrast of the panel's text against what's behind the panel).
//   node test/light_shots.mjs <dir> [night,sunset,day,auto]   (auto: the real sun over Itaewon right now)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/light_shots.mjs <dir> [night,sunset,day]"); process.exit(2); }
const LIGHTS = (process.argv[3] ?? "night,sunset,day").split(",");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const snap = async (pg, path) => { const c = await pg.context().newCDPSession(pg); const r = await c.send("Page.captureScreenshot", { format: "png" }); await writeFile(path, Buffer.from(r.data, "base64")); await c.detach(); };
const LOOK = encodeURIComponent(JSON.stringify({ skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" }));
const errors = [];
const seen = {};

for (const light of LIGHTS) {
  console.log(`\n${light}`);
  // 1. the start screen
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "en-US" });
  await ctx.addInitScript(() => { globalThis.__sceneryNoSlow = true; try { localStorage.setItem("rando-lang", "en"); } catch {} });
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${light}: ${e.message}`));
  await pg.goto(`${base}/app.html?devlat=37.5347&devlng=126.9945&me=mina&av=${LOOK}` + (light === "auto" ? "" : `&light=${light}`));
  await pg.waitForFunction(() => document.body.classList.contains("scenery-live"), null, { timeout: 180000, polling: 300 }).catch(() => {});
  await sleep(4000);
  const st = await pg.evaluate(() => {
    const p = document.querySelector(".st-panel"), cs = p && getComputedStyle(p);
    return { day: getComputedStyle(document.documentElement).getPropertyValue("--day").trim(), bg: cs?.backgroundColor, ink: cs && getComputedStyle(p.querySelector(".st-line")).color,
      logo: cs && getComputedStyle(p.querySelector(".st-logo")).color, gold: cs && getComputedStyle(p.querySelector(".glass-btn.gold")).boxShadow };
  });
  seen[light] = st;
  console.log(`    --day ${st.day} · panel ${st.bg} · text ${st.ink} · logo ${st.logo}`);
  await snap(pg, join(OUT, `start-${light}.png`));
  // the panel without its glass, to see what it's over
  await pg.evaluate(() => document.querySelector(".st-panel").style.visibility = "hidden");
  await sleep(600);
  await snap(pg, join(OUT, `start-${light}-bare.png`));
  await ctx.close();
  // 2. the map's chrome (nav bar, chat, NPC) by the same light
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "en-US" });
  await m.addInitScript(() => { try { localStorage.setItem("rando-lang", "en"); localStorage.setItem("rando-hint-v1", "1"); } catch {} });
  const mp = await m.newPage();
  mp.on("pageerror", e => errors.push(`${light} map: ${e.message}`));
  await mp.goto(`${base}/app.html?onb=0&devlat=37.5347&devlng=126.9945&me=mina&av=${LOOK}` + (light === "auto" ? "" : `&light=${light}`));
  await mp.waitForFunction(() => !!document.querySelector("#navbar:not([hidden])"), null, { timeout: 180000, polling: 300 }).catch(() => {});
  await sleep(9000);
  await snap(mp, join(OUT, `map-${light}.png`));
  await m.close();
}

if (seen.night && seen.day) {
  ok(seen.night.day === "0" && seen.day.day === "1" && (!seen.sunset || seen.sunset.day === "0.5"), "--day: 0 at night, 0.5 at sunset, 1 by day");
  ok(seen.night.bg !== seen.day.bg, "the glass changes between night and day");
  ok(/255, 255, 255|242, 244, 255/.test(seen.night.ink.replace(/rgba?\(/, "")) || /^rgba\(242, 244, 255/.test(seen.night.ink), `night text is light (${seen.night.ink})`);
  ok(/^rgba?\(15, 26, 58/.test(seen.day.ink), `day text is navy #0F1A3A (${seen.day.ink})`);
  ok(seen.night.gold === seen.day.gold ? false : true, "the gold button's shadow adapts");
}
ok(!errors.length, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
console.log(`\n${fails ? "✗" : "✓"} ${fails} failures`);
await browser.close(); close();
process.exit(fails ? 1 : 0);
