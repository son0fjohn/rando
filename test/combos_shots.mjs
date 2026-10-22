// Screenshot test/combos.html: every top × bottom (idle + walk) and every
// hairstyle × top on the animated character, to catch clipping.
//   node test/combos_shots.mjs <dir>
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/combos_shots.mjs <dir>"); process.exit(2); }
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
await pg.goto(`${base}/test/combos.html?${qs}`);
await pg.waitForFunction(() => window.__done, null, { timeout: 300000 });
await pg.screenshot({ path: join(OUT, "combos.png"), fullPage: true });
console.log(`combos.png in ${OUT}`, errs.length ? `\n${errs.slice(0, 8).join("\n")}` : "");
await browser.close(); close();
