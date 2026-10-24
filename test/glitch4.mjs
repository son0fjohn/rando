// The avatar4 glitch grid: every hairstyle × headwear, every top × hair,
// every top × bottom, neck items × tops and face items × headwear, front /
// 3/4 / side / back, idle + walk, each cell checked for poke-through,
// z-fighting, flicker and gaps (test/glitch4.html), one labelled sheet per
// item plus summary.json / summary.md.
//   node test/glitch4.mjs <dir> [--only=hats,tophair,topbottom,neck,face] [--item=<id>] [--jobs=3]
// Exits 1 if any cell is over the limit (--max=<px>, default 12). --mod=<url>
// renders another build of avatar4.js (a before/after).
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
import { ITEMS4, PART_OPTIONS4, SLOTS4, clash4 } from "../web/items4.js";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/glitch4.mjs <dir> [--only=...] [--item=id] [--jobs=3]"); process.exit(2); }
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.split("=")[1];
const ONLY = opt("only")?.split(","), ITEM = opt("item"), JOBS = +(opt("jobs") ?? 3), MAX = +(opt("max") ?? 12);
await mkdir(OUT, { recursive: true });

const P = PART_OPTIONS4, real = l => l.filter(x => x !== "none");
const name = id => ITEMS4[id]?.name ?? id;
const BASE = { skin: "3", hair: "none", head: "none", face: "none", top: "none", bottom: "none", shoes: "skate-blue", neck: "none", hairColor: "darkbrown" };
const sheets = [];
// a combination the wardrobe blocks (items4 blocks) is shown as blocked, not rendered without one of them
const blocked = cfg => SLOTS4.find(s => cfg[s] !== "none" && clash4(cfg, s, cfg[s]));
const add = (group, id, title, frame, rows) => {
  rows.forEach(r => { const s = blocked(r.cfg); if (s) r.blocked = `blocked: ${ITEMS4[r.cfg[s]].name} + ${ITEMS4[clash4(r.cfg, s, r.cfg[s])].name}`; }); if ((!ONLY || ONLY.includes(group)) && (!ITEM || rows.some(r => Object.values(r.cfg).includes(ITEM)) || ITEM === id)) sheets.push({ group, id, spec: { title, frame, rows } }); };
for (const hat of real(P.head))
  add("hats", hat, `headwear: ${name(hat)} × every hairstyle (tee)`, "head",
    P.hair.map(hair => ({ label: hair === "none" ? "no hair" : name(hair), cfg: { ...BASE, head: hat, hair, top: "tee-white" } })));
for (const top of real(P.top))
  add("tophair", top, `top: ${name(top)} × every hairstyle`, "upper",
    real(P.hair).map(hair => ({ label: name(hair), cfg: { ...BASE, top, hair } })));
for (const top of real(P.top))
  add("topbottom", top, `top: ${name(top)} × every bottom`, "body",
    real(P.bottom).map(bottom => ({ label: name(bottom), cfg: { ...BASE, top, bottom } })));
for (const neck of real(P.neck))
  add("neck", neck, `neck: ${name(neck)} × every top (middle part hair)`, "upper",
    real(P.top).map(top => ({ label: name(top), cfg: { ...BASE, neck, top, hair: "middle-part" } })));
for (const face of real(P.face).filter(f => ITEMS4[f].file || ITEMS4[f].code === "hoops"))
  add("face", face, `face: ${name(face)} × every headwear (middle part hair)`, "head",
    P.head.map(head => ({ label: head === "none" ? "no headwear" : name(head), cfg: { ...BASE, face, head, hair: "middle-part", top: "tee-white" } })));

const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errs = [], all = [];
let next = 0;
async function worker() {
  const pg = await browser.newPage({ viewport: { width: 400, height: 300 } });
  pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text()); });
  await pg.goto(`${base}/test/glitch4.html${opt("mod") ? "?mod=" + encodeURIComponent(opt("mod")) : ""}`);
  await pg.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  while (next < sheets.length) {
    const s = sheets[next++], t0 = Date.now();
    const { png, cells } = await pg.evaluate(spec => window.sheet(spec), s.spec);
    const file = `${s.group}_${s.id}.png`;
    await writeFile(join(OUT, file), Buffer.from(png.split(",")[1], "base64"));
    for (const c of cells) all.push({ group: s.group, item: s.id, file, ...c });
    console.log(`${file}  ${cells.filter(c => Object.entries(c.counts).some(([k, n]) => n >= MAX && !k.startsWith("(info)"))).length}/${cells.length} flagged  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await pg.close();
}
await Promise.all(Array.from({ length: Math.min(JOBS, sheets.length) }, worker));
await browser.close(); close();

// summary: per group, per label, how many cells and which combos
await writeFile(join(OUT, "summary.json"), JSON.stringify(all, null, 1));
const md = ["# avatar4 glitch grid", "", `limit: ${MAX} px per label per cell (analysis resolution)`, ""];
let bad = 0;
for (const group of [...new Set(all.map(c => c.group))]) {
  const cells = all.filter(c => c.group === group);
  const by = {};
  for (const c of cells) for (const [k, n] of Object.entries(c.counts)) if (n >= MAX) (by[k] ??= []).push(c);
  const flagged = cells.filter(c => Object.entries(c.counts).some(([k, n]) => n >= MAX && !k.startsWith("(info)")));
  bad += flagged.length;
  const blk = [...new Set(cells.filter(c => c.blocked).map(c => `${name(c.item)} + ${c.row}`))];
  md.push(`## ${group}: ${flagged.length} of ${cells.length} cells flagged${blk.length ? `, ${blk.length} combos blocked` : ""}`, "");
  if (blk.length) md.push(`- **blocked** (the Style screen won't put them together): ${blk.join("; ")}`);
  for (const [k, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    const combos = {};
    for (const c of list) { const key = `${name(c.item)} + ${c.row}`; (combos[key] ??= []).push(`${c.view} ${c.pose} ${c.counts[k]}`); }
    md.push(`- **${k}**: ${list.length} cells, ${Object.keys(combos).length} combos`);
    for (const [combo, where] of Object.entries(combos)) md.push(`  - ${combo}: ${where.join(", ")}`);
  }
  md.push("");
}
await writeFile(join(OUT, "summary.md"), md.join("\n"));
console.log(`${bad} flagged cells; summary.md in ${OUT}`);
if (errs.length) console.log(errs.slice(0, 8).join("\n"));
process.exit(bad || errs.length ? 1 : 0);
