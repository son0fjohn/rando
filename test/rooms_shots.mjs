// The game scenes' rooms (web/retrorooms.js): each loads and is shot at
// phone size. node test/rooms_shots.mjs <dir> [tent,study,lounge]
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/rooms_shots.mjs <dir> [tent,study,lounge]"); process.exit(2); }
const ROOMS = (process.argv[3] ?? "tent,study,lounge").split(",");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let bad = 0;
for (const room of ROOMS) {
  const pg = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if (/retrorooms|retro/.test(m.text())) console.log("  [page]", m.text()); });
  await pg.goto(`${base}/test/rooms.html?room=${room}&retro=high`);
  await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 60000 });
  const failed = await pg.evaluate(() => window.__failed);
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: join(OUT, `${room}.png`) });
  const ok = !failed && !errs.length;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${room}${failed ? `: ${failed}` : ""}${errs.length ? ` errors: ${errs.join(" | ")}` : ""}`);
  await pg.close();
}
await browser.close(); close();
process.exit(bad ? 1 : 0);
