// Side Quest's 3D nook (web/sqnook.js, the retro look kit): loads, then each
// beat of a turn shot at phone size. node test/nook_shots.mjs <dir>
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/nook_shots.mjs <dir>"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
pg.on("pageerror", e => errs.push(e.message));
pg.on("requestfailed", r => console.log("  [req failed]", r.url()));
pg.on("response", r => { if (r.status() >= 400) console.log("  [" + r.status() + "]", r.url()); });
pg.on("console", m => { if (m.type() === "error" || /sqnook|retro/.test(m.text())) console.log("  [page]", m.text()); });
await pg.goto(`${base}/test/nook.html`);
await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 60000 });
const failed = await pg.evaluate(() => window.__failed);
if (failed) { console.log("✗ the nook failed:", failed); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, fn, wait = 900) => { if (fn) await pg.evaluate(fn); await sleep(wait); await pg.screenshot({ path: join(OUT, `${name}.png`) }); console.log("  shot", name); };
await shot("1-idle", null, 2000);
await shot("2-spin", () => { __nook.setPose("wizard_conj"); __nook.orb("spin"); __nook.face("/web/games/sidequest/ball.webp"); });
await shot("3-landed", () => { __nook.setPose("wizard_idle"); __nook.orb("landed"); __nook.face("/web/games/sidequest/ball.webp", true); });
await shot("4-swirl", () => { __nook.setPose("wizard_conj"); __nook.orb("swirl"); });
await shot("5-reveal", () => { __nook.setPose("wizard_rev"); __nook.orb("burst"); }, 300);
console.log("  ball on screen:", JSON.stringify(await pg.evaluate(() => __nook.ballRect())));
console.log(errs.length ? `✗ page errors: ${errs.join(" | ")}` : "✓ no page errors");
await browser.close(); close();
