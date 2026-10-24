// Screenshot test/faces.html: every eye shape × expression on the player
// character's head, the iris tints, and each shape at 3/4.
//   node test/faces_shots.mjs <dir>
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/faces_shots.mjs <dir>"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 1240, height: 900 } });
const errs = [];
pg.on("pageerror", e => errs.push(e.message));
pg.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text()); });
await pg.goto(`${base}/test/faces.html`);
await pg.waitForFunction(() => window.__done, null, { timeout: 1200000 });
await pg.screenshot({ path: join(OUT, "eyes.png"), fullPage: true });
console.log(`eyes.png in ${OUT}`, errs.length ? `\n${errs.slice(0, 8).join("\n")}` : "");
await browser.close(); close();
process.exit(errs.length ? 1 : 0);
