// Side Quest's host, The Prophet (web/prophet.js): loads, then each beat of a
// turn shot at the reference's phone size, with the dialog box (dialog.js).
// node test/prophet_shots.mjs <dir> [only]
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
const [OUT, ONLY] = process.argv.slice(2);
if (!OUT) { console.error("usage: node test/prophet_shots.mjs <dir> [only]"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 376, height: 672 }, deviceScaleFactor: 2 });
const errs = [];
pg.on("pageerror", e => errs.push(e.message));
pg.on("response", r => { if (r.status() >= 400 && !/favicon/.test(r.url())) console.log("  [" + r.status() + "]", r.url()); });
pg.on("console", m => { if (m.type() === "error" || /prophet|retro/.test(m.text())) console.log("  [page]", m.text()); });
await pg.goto(`${base}/test/prophet.html?retro=high`);
await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 90000 });
const failed = await pg.evaluate(() => window.__failed);
if (failed) { console.log("✗ the scene failed:", failed); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, fn, wait = 1200) => {
  if (ONLY && !name.startsWith(ONLY)) return;
  if (fn) await pg.evaluate(fn); await sleep(wait); await pg.screenshot({ path: join(OUT, `${name}.png`) }); console.log("  shot", name);
};
// a stand-in face for the ball (in the game it's the player's own render)
await pg.evaluate(() => { window.dot = c => { const k = document.createElement("canvas"); k.width = k.height = 64; const g = k.getContext("2d"); g.fillStyle = c; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill(); g.fillStyle = "#222"; g.fillRect(20, 26, 6, 8); g.fillRect(38, 26, 6, 8); return k.toDataURL(); }; });
await shot("1-idle", () => { __dlg.say("Relax. The ball already knows who's next.", { instant: true }); }, 2500);
await shot("2-reveal", () => { __p.setPose("reveal"); __p.orb("spin"); __p.push(1); __dlg.say("...", { instant: true }); }, 1500);
await shot("3-point", () => { __p.setPose("point"); __p.face(dot("#e9a"), true); __p.orb("landed"); __dlg.say("Relax. The ball already knows who's next... alice.", { instant: true }); }, 1500);
await shot("4-nod", () => { __p.setPose("nod"); __p.push(0); __dlg.say("SIDE QUEST: Get a stranger to teach you a dance move", { instant: true }); }, 500);
await shot("5-choice", async () => { __p.setPose("idle"); __dlg.say("Do you accept?", { instant: true }); __dlg.choose([{ label: "Accept", value: 1 }, { label: "Give up", value: 0, cls: "warn" }]); }, 1500);
await shot("6-korean", () => { __dlg.say("진정해. 공은 이미 다음이 누군지 알고 있어.", { instant: true, name: "예언자" }); }, 1200);
console.log("  ball on screen:", JSON.stringify(await pg.evaluate(() => __p.ballRect())));
console.log(errs.length ? `✗ page errors: ${errs.join(" | ")}` : "✓ no page errors");
await browser.close(); close();
process.exit(errs.length ? 1 : 0);
