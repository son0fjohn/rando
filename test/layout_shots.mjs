// Every game's screens, one phone (+ bots), real 3D, for the shared layout:
// a shot every few seconds through each game, and where the layout's parts
// sit on each one (the header bar, the status pill, the action area, the
// dialog box), so a part that wanders shows up in numbers too.
//
//   node test/layout_shots.mjs <dir> [sidequest,ritual,artgallery,mask_off,secretdiary,manhunt,lobby] [--secs=40]
// Writes <dir>/<game>-NN.png and <dir>/layout.json.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/layout_shots.mjs <dir> [games] [--secs=40]"); process.exit(2); }
const ALL = ["lobby", "sidequest", "ritual", "artgallery", "mask_off", "secretdiary", "manhunt"];
const pickArg = args.find(a => a !== OUT && !a.startsWith("--"));
const GAMES = pickArg ? pickArg.split(",") : ALL;
const SECS = +(args.find(a => a.startsWith("--secs="))?.slice(7) ?? 40);
await mkdir(OUT, { recursive: true });
const ROOT = new URL("..", import.meta.url).pathname;
const { base, close } = await serve({ realAvatars: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true).catch(() => false);
const errors = [];
const LOOKS = {
  alice: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  bob: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  cy: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "none", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
};
const layout = {};

// where the layout's parts are on screen right now
const measure = pg => pg.evaluate(() => {
  const vis = el => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width && r.height && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05 ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; };
  const first = sel => [...document.querySelectorAll(sel)].map(vis).find(Boolean) ?? null;
  return {
    header: first("#game-hud .hq, #game-hud > *"),
    pill: first(".gs-pill, .np-pill"),
    dialog: first(".gs-dialog .dlg-box, .dlg-box"),
    action: first(".gs-action > *, .dlg-choices:not([hidden])"),
    card: first("#game-panel .stage"),
  };
});

async function phone(name, qs = "", ctx = null) {
  ctx ??= await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await pg.goto(`${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}&real3d=1${qs}`);
  await pg.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  return { pg, ctx };
}
async function host(qs = "&bots=3") {
  const { pg, ctx } = await phone("alice", qs);
  await pg.click("#party-btn");
  await pg.fill("#pt-name", "Saturday night");
  await pg.click("#pt-create");
  await until(pg, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? ""));
  return { pg, ctx, code: (await pg.locator("#pt-code-chip").innerText()).trim() };
}
async function queue(pg, game) {
  await pg.click("#pt-vote");
  await pg.locator(`[data-game="${game}"] .pv-t > b`).waitFor({ state: "visible" });
  await sleep(700);
  await pg.click(`[data-game="${game}"] .pv-t > b`);
}
async function tour(game, pg, act) {
  layout[game] = [];
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < SECS * 1000; i++) {
    await act?.(pg).catch(() => {});
    await sleep(1200);
    const n = String(i).padStart(2, "0");
    await pg.screenshot({ path: join(OUT, `${game}-${n}.png`) }).catch(() => {});
    layout[game].push({ shot: `${game}-${n}.png`, phase: await pg.evaluate(() => window.__game?.s?.phase ?? null), ...(await measure(pg)) });
    await sleep(3000);
  }
}
const click = (pg, sel) => pg.evaluate(sel => { const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent || e.getClientRects().length); el?.click(); return !!el; }, sel);
const photo = i => join(ROOT, `web/games/captions/c${i % 8}.jpg`);

for (const game of GAMES) {
  console.log(`\n${game}`);
  if (game === "lobby") {
    const { pg, ctx } = await host();
    await sleep(4000);
    await tour("lobby", pg, null).catch(e => console.log("  ✗", e.message));
    await ctx.close(); continue;
  }
  if (game === "manhunt") {
    // no bots in Manhunt: three phones in one browser (simulated GPS, a fast clock)
    const h = await host("&mhsim=1&mhfast=6");
    for (const n of ["bob", "cy"]) await phone(n, `&party=${h.code}&mhsim=1&mhfast=6`, h.ctx);
    await until(h.pg, () => document.querySelectorAll(".lr-av").length >= 3, null, 30000);
    await queue(h.pg, "manhunt");
    const others = h.ctx.pages().slice(1);
    await tour("manhunt", h.pg, async pg => {
      await click(pg, "#mh-go");
      for (const p of [pg, ...others]) await click(p, '#mh-ready, [data-how="go"], [data-how="skip"]').catch(() => {});
    }).catch(e => console.log("  ✗", e.message));
    await h.ctx.close(); continue;
  }
  const { pg, ctx } = await host();
  await queue(pg, game);
  let sent = 0;
  const act = {
    sidequest: async pg => { await click(pg, "#sq-go"); await click(pg, ".dlg-choices .dlg-choice"); },
    ritual: async pg => {},
    artgallery: async pg => {
      if (sent < 3 && await pg.evaluate(() => window.__game?.s?.phase === "photos")) { await pg.setInputFiles("#ag-file", [photo(sent), photo(sent + 1), photo(sent + 2)].slice(0, 3 - sent)); sent = 3; }
      if (await pg.locator("#gp-in").count()) { await pg.fill("#gp-in", "a very serious title"); await click(pg, "#gp-go, .gp-go, form button"); }
      await click(pg, ".ag-pl:not(.mine):not([disabled])");
    },
    mask_off: async pg => { await click(pg, "#mo-go"); await click(pg, ".mo-chip.can"); await click(pg, "#mo-hand [data-card]"); await click(pg, "#mo-ask, #mo-answer"); },
    secretdiary: async pg => { await click(pg, "#sd-send"); await click(pg, '#sd-submit'); await click(pg, '#sd-lock'); },
  }[game];
  // past the host's how-to-play: "Let's go" (or "Got it" the first time)
  await tour(game, pg, async pg => { await click(pg, '[data-how="go"], [data-how="skip"]'); await act?.(pg); }).catch(e => console.log("  ✗", e.message));
  await ctx.close();
}
await writeFile(join(OUT, "layout.json"), JSON.stringify(layout, null, 1));
console.log(errors.length ? `\n✗ page errors: ${[...new Set(errors)].slice(0, 6).join(" | ")}` : "\n✓ no page errors");
await browser.close(); close();
