// The text on the glass windows, measured as drawn (WCAG contrast) on the
// REAL app page (offline, test/appserve.mjs), by night, sunset and day
// (?light=): each window is opened over the live map, shot once with every
// text and icon made invisible (what's behind them: the glass over the map,
// a gold button…), and each piece of text / icon is compared with the median
// of what's behind its own box. Text needs 4.5:1, large text (24px, or
// 18.67px bold) and icons 3:1.
//   node test/glass_contrast.mjs <dir> [--lights=night,sunset,day,chip-day] [--only=host] [--prefix=after]
// (chip-day: no ?light=, the dev chip's choice instead, as ?dev=1 leaves it
// on the phone: localStorage rando-light = day, then the page opened)
// Writes <dir>/<prefix>-contrast.json and .md (one row per element: night /
// sunset / day ratios) and a shot of each window in each light.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
import { measure } from "./contrastkit.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/glass_contrast.mjs <dir> [--lights=night,sunset,day] [--only=host] [--prefix=after]"); process.exit(2); }
const LIGHTS = args.find(a => a.startsWith("--lights="))?.slice(9).split(",") ?? ["night", "sunset", "day", "chip-day"];
const PREFIX = args.find(a => a.startsWith("--prefix="))?.slice(9) ?? "shot";
const ONLY = args.find(a => a.startsWith("--only="))?.slice(7).split(",") ?? null;
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOOK = { skin: "3", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-hitop-black" };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// the windows: how to open each on the world screen, and its root
const WINDOWS = {
  host: { root: "#party-panel", open: async pg => { await pg.evaluate(() => document.getElementById("nav-host").click()); await pg.waitForSelector("#pt-create", { state: "visible", timeout: 15000 }); } },
};

async function cdpShot(pg) {
  const cdp = await pg.context().newCDPSession(pg);
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  await cdp.detach().catch(() => {});
  return r.data;
}

const table = {};       // key -> { what, size, need, [light]: ratio }
for (const light of LIGHTS) {
  console.log(`\n${light}`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const chip = light.startsWith("chip-") ? light.slice(5) : null;
  await ctx.addInitScript(chip => { try { localStorage.setItem("rando-hint-v1", "1"); localStorage.setItem("rando-lang", "en"); if (chip) { localStorage.setItem("rando-light", chip); localStorage.setItem("rando-dev", "1"); } } catch {} }, chip);
  const pg = await ctx.newPage();
  await pg.goto(`${base}/app.html?onb=0&me=tony&av=${encodeURIComponent(JSON.stringify(LOOK))}&devlat=37.5347&devlng=126.9945${chip ? "&dev=1" : `&light=${light}`}`);
  await pg.waitForFunction(() => !document.getElementById("navbar")?.hidden, null, { timeout: 60000 });
  await sleep(6000);                                    // the world streams in, --day settles
  const st = await pg.evaluate(() => ({ day: getComputedStyle(document.documentElement).getPropertyValue("--day").trim(), chip: document.getElementById("dev-light")?.textContent ?? null }));
  console.log(`  --day ${st.day}${st.chip ? `, the dev chip reads "${st.chip}"` : ""}`);
  if (chip) ok(st.day === "1" && /day/.test(st.chip ?? ""), `the dev chip set to Day: --day ${st.day} (${st.chip})`);
  for (const [name, w] of Object.entries(WINDOWS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    await w.open(pg);
    await sleep(1500);
    await pg.evaluate(() => import("/web/world3d.js").then(W => W.world3d.setPaused?.(true)));   // (hold the map's frame still)
    await sleep(400);
    await writeFile(join(OUT, `${PREFIX}-${name}-${light}.png`), Buffer.from(await cdpShot(pg), "base64"));
    const res = await measure(pg, [w.root]);
    for (const r of res) {
      if (r.ratio == null || r.alpha < 0.05) continue;
      const need = r.need;
      const k = `${name}: ${r.key}`;
      (table[k] ??= { size: r.size, need })[light] = r.ratio;
      ok(r.ratio >= need, `${light} ${k}: ${r.ratio}:1 (${r.ink} on ${r.bg}, ${r.size}, needs ${need})`);
    }
    await pg.evaluate(() => import("/web/world3d.js").then(W => W.world3d.setPaused?.(false)));
  }
  await ctx.close();
}
await writeFile(join(OUT, `${PREFIX}-contrast.json`), JSON.stringify(table, null, 1));
const md = ["| element | size | needs | " + LIGHTS.join(" | ") + " |", "|---|---|---|" + LIGHTS.map(() => "---").join("|") + "|",
  ...Object.entries(table).map(([k, v]) => `| ${k.replace(/\|/g, "/")} | ${v.size} | ${v.need} | ${LIGHTS.map(l => v[l] == null ? "–" : `${v[l]}${v[l] < v.need ? " ✗" : ""}`).join(" | ")} |`)];
await writeFile(join(OUT, `${PREFIX}-contrast.md`), md.join("\n") + "\n");
await browser.close(); close();
console.log(`\n${pass} passed, ${fail} failed · ${OUT}/${PREFIX}-contrast.md`);
process.exit(fail ? 1 : 0);
