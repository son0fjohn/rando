// Screenshot test/charturn.html: the player character turned through 360°
// at map distance, on the Style screen and close up, for a few hairstyles.
//   node test/charturn_shots.mjs <dir> [--hair=f2,f3,m1] [--angles=8] [--scale=2] [--only=close-up]
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/charturn_shots.mjs <dir> [--hair=f2,f3,m1] [--angles=8] [--scale=2] [--only=close-up]"); process.exit(2); }
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.split("=")[1];
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errs = [];
pg.on("pageerror", e => errs.push(e.message));
pg.on("console", m => { if (m.type() === "warning" || m.type() === "error") errs.push(m.text()); });
pg.on("response", r => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
const qs = new URLSearchParams(Object.fromEntries(["hair", "angles", "scale", "only", "hc", "rot"].filter(opt).map(k => [k, opt(k)])));
await pg.goto(`${base}/test/charturn.html?${qs}`);
await pg.waitForFunction(() => window.__done, null, { timeout: 300000 });
await pg.screenshot({ path: join(OUT, "turntable.png"), fullPage: true });
console.log(`turntable.png in ${OUT}`, errs.length ? `\n${errs.slice(0, 8).join("\n")}` : "");
await browser.close(); close();
