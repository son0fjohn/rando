// Side Quest's host, The Prophet (web/prophet.js): loads, then each beat of a
// turn shot at the reference's phone size, with the dialog box (dialog.js);
// then looking around and the taps, driven with real pointer input:
//   - a drag orbits the camera, it glides home ~3 s after letting go
//   - hold(true) keeps it home (a drag does nothing)
//   - a pinch zooms in a bit
//   - taps on him, the ball and the lamp reach onTap
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
const pg = await browser.newPage({ viewport: { width: 376, height: 672 }, deviceScaleFactor: 2, hasTouch: true });
const errs = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
pg.on("pageerror", e => errs.push(e.message));
pg.on("response", r => { if (r.status() >= 400 && !/favicon/.test(r.url())) console.log("  [" + r.status() + "]", r.url()); });
pg.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) console.log("  [page]", m.text()); });
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
await shot("0-default", () => { __dlg.say("Relax. The ball already knows who's next.", { instant: true }); }, 2500);
await shot("1-idle", () => { __dlg.say("Relax. The ball already knows who's next.", { instant: true }); }, 1500);
await shot("2-reveal", () => { __p.setPose("reveal"); __p.orb("spin"); __p.push(1); __dlg.say("...", { instant: true }); }, 1500);
await shot("3-point", () => { __p.setPose("point"); __p.face(dot("#e9a"), true); __p.orb("landed"); __dlg.say("Relax. The ball already knows who's next... alice.", { instant: true }); }, 1500);
await shot("4-nod", () => { __p.setPose("nod"); __p.push(0); __dlg.say("SIDE QUEST: Get a stranger to teach you a dance move", { instant: true }); }, 500);
await shot("5-choice", async () => { __p.setPose("idle"); __dlg.say("Do you accept?", { instant: true }); __dlg.choose([{ label: "Accept", value: 1 }, { label: "Give up", value: 0, cls: "warn" }]); }, 1500);
await shot("6-korean", () => { __dlg.say("진정해. 공은 이미 다음이 누군지 알고 있어.", { instant: true, name: "예언자" }); }, 1200);
await pg.evaluate(() => { __dlg.clearChoices(); __dlg.say("Relax. The ball already knows who's next.", { instant: true, name: "The Prophet" }); __p.orb("idle"); __p.face(null); });
console.log("  ball on screen:", JSON.stringify(await pg.evaluate(() => __p.ballRect())));

if (!ONLY || ONLY.startsWith("7")) {
  // ---- looking around (real pointer input on the canvas)
  const view = () => pg.evaluate(() => ({ ...__p.debug.view }));
  const drag = async (x0, y0, x1, y1, steps = 12) => { await pg.mouse.move(x0, y0); await pg.mouse.down(); for (let i = 1; i <= steps; i++) { await pg.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await pg.mouse.up(); };
  await drag(300, 200, 80, 230);
  await sleep(700);
  const v1 = await view();
  ok(v1.yaw > 0.4, `a drag to the left orbits the camera round (yaw ${v1.yaw.toFixed(2)})`);
  await pg.screenshot({ path: join(OUT, "7-orbit.png") }); console.log("  shot 7-orbit");
  await drag(80, 200, 380, 200); await sleep(200); await drag(80, 200, 380, 200); await sleep(200); await drag(80, 200, 380, 200);
  await sleep(900);
  const v2 = await view();
  ok(v2.yaw >= -1.06 && v2.yaw <= 1.06, `it stops at about ±60° (yaw ${v2.yaw.toFixed(2)})`);
  await pg.screenshot({ path: join(OUT, "7-orbit-left.png") }); console.log("  shot 7-orbit-left");
  await sleep(4500);
  const v3 = await view();
  ok(Math.abs(v3.yaw) < 0.08 && Math.abs(v3.pitch) < 0.05, `~3 s after letting go it glides back home (yaw ${v3.yaw.toFixed(3)})`);
  await pg.evaluate(() => __p.hold(true));
  await drag(300, 200, 60, 200); await sleep(600);
  const v4 = await view();
  ok(Math.abs(v4.yaw) < 0.05, "while held (the pick, the reveal) a drag doesn't move it");
  await pg.evaluate(() => __p.hold(false));
  // a pinch: two touch points moving apart
  const cdp = await pg.context().newCDPSession(pg);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch("touchStart", [[160, 250], [220, 250]]);
  for (let i = 1; i <= 10; i++) { await touch("touchMove", [[160 - i * 8, 250], [220 + i * 8, 250]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(600);
  const v5 = await view();
  ok(v5.zoom < 0.95 && v5.zoom >= 0.71, `a pinch zooms in a bit (zoom ${v5.zoom.toFixed(2)})`);
  await pg.screenshot({ path: join(OUT, "7-pinch.png") }); console.log("  shot 7-pinch");
  await sleep(4500);
  // ---- taps
  await pg.evaluate(() => { window.__taps = []; __p.onTap = k => { __taps.push(k); if (k === "prophet") __dlg.quip("Patience."); return true; }; });
  const ball = await pg.evaluate(() => __p.ballRect());
  await pg.mouse.click(ball.left + ball.width / 2, ball.top + ball.height / 2); await sleep(250);
  await pg.screenshot({ path: join(OUT, "8-tap-ball.png") }); console.log("  shot 8-tap-ball");
  await pg.mouse.click(12, 300); await sleep(200);           // the lamp's shade, at the left edge
  await pg.mouse.click(190, 290); await sleep(500);          // his chest
  await pg.screenshot({ path: join(OUT, "8-tap-him.png") }); console.log("  shot 8-tap-him");
  const taps = await pg.evaluate(() => __taps);
  ok(taps.includes("ball"), "tap the ball: it pulses and swirls");
  ok(taps.includes("lamp"), "tap the lamp: it flickers");
  ok(taps.includes("prophet"), "tap him: onTap('prophet') (a line and a nod or a puff)");
  ok(await pg.evaluate(() => document.querySelector(".dlg-text").textContent === "Patience."), "his quip shows in the dialog box");
  await sleep(2900);
  ok(await pg.evaluate(() => document.querySelector(".dlg-text").textContent.startsWith("Relax.")), "…then the line it interrupted comes back");
}
console.log(errs.length ? `✗ page errors: ${errs.join(" | ")}` : "✓ no page errors");
await browser.close(); close();
process.exit(errs.length || fails ? 1 : 0);
