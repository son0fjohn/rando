// Mask Off round the table (web/hpgames/maskoff.js, web/roundtable.js),
// through the real party page: two phones and some bots, everyone their own
// 3D character (?real3d=1). Shoots the table first person from both phones'
// seats, a pick and a raised card, the card on the table, and the end (the
// camera lifted, every mask off); then a big party (10) checks the table
// seats 8 and the rest are in the seat bar.
// node test/maskoff_shots.mjs <dir> [--bots=4]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const argv = process.argv.slice(2);
const OUT = argv.find(a => !a.startsWith("--"));
const BOTS = +(argv.find(a => a.startsWith("--bots="))?.slice(7) ?? 4);
if (!OUT) { console.error("usage: node test/maskoff_shots.mjs <dir> [--bots=4]"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const browser = await chromium.launch({ args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 20000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true).catch(() => false);
let fails = 0;
const errs = [];
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const LOOKS = {
  alice: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  bob: { skin: "4", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "bucket", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
};

async function party({ bots, real3d, dpr = 2 }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
  const open = async (name, qs) => {
    const pg = await ctx.newPage();
    pg.on("pageerror", e => errs.push(`${name}: ${e.message}`));
    await pg.goto(`${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}${real3d ? "&real3d=1" : ""}${qs}`);
    await pg.waitForFunction(() => window.__ready);
    return pg;
  };
  const A = await open("alice", `&bots=${bots}`);
  await A.click("#party-btn"); await A.fill("#pt-name", "Saturday night"); await A.click("#pt-create");
  await until(A, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? ""));
  const code = (await A.locator("#pt-code-chip").innerText()).trim();
  const B = await open("bob", `&party=${code}`);
  await until(A, () => document.querySelectorAll(".lr-av").length >= 2, null, 30000);
  await A.click("#pt-vote");
  const title = A.locator('[data-game="mask_off"] .pv-t > b');
  await title.waitFor({ state: "visible" }); await sleep(700);
  await title.click({ timeout: 10000 }).catch(() => title.evaluate(b => b.click()));
  await until(A, () => !!document.getElementById("mo-go"), null, 20000);
  await A.click('[data-rounds="1"]'); await sleep(300);
  await A.click("#mo-go");
  return { ctx, A, B };
}
const state = pg => pg.evaluate(() => JSON.parse(JSON.stringify(window.__game?.s ?? null)));

// ---- two phones and some bots, real characters
{
  console.log(`\nThe table: 2 phones + ${BOTS} bots, everyone their own character`);
  const { ctx, A, B } = await party({ bots: BOTS, real3d: true });
  for (const pg of [A, B]) ok(await until(pg, n => window.__table?.info().chars >= n, BOTS + 2, 90000), "everyone sits down: their own characters, in masks");
  await until(A, () => window.__game?.s?.phase === "choose", null, 30000);
  await sleep(2500);
  // a human's turn: wait for one (the bots take theirs)
  let s = await state(A);
  for (let i = 0; i < 40 && !(["u-alice", "u-bob"].includes(s.turn?.asker) && s.phase === "choose" && !s.turn.card); i++) { await sleep(1000); s = await state(A); }
  const asker = s.turn.asker === "u-alice" ? A : B, other = asker === A ? B : A;
  await A.screenshot({ path: join(OUT, "1-seat-alice.png") }); await B.screenshot({ path: join(OUT, "2-seat-bob.png") });
  console.log("  shot 1-seat-alice, 2-seat-bob");
  const info = await asker.evaluate(() => window.__table.info());
  ok(info.seated.length === BOTS + 2 && info.masks === BOTS + 1, `${info.seated.length} round the table, ${info.masks} masks in view (yours is first person)`);
  ok(await asker.evaluate(() => document.querySelectorAll("#mo-hand [data-card]").length === 5 && !!document.querySelector(".mo-handwrap.turn")), "your turn: your hand of 5 glows");
  // pick someone in view, raise a card
  const ids = await asker.evaluate(() => window.__table.info().seated.filter(id => id !== window.__table.info().me));
  let picked = null;
  for (const id of ids) {
    const p = await asker.evaluate(id => window.__table.screen(id), id);
    const can = await asker.evaluate(id => !!document.querySelector(`.mo-chip.can[data-who="${id}"]`), id);
    if (p?.visible && !p.side && can) { await asker.mouse.click(p.x, p.y + 46); picked = id; break; }
  }
  ok(picked && await until(A, id => window.__game.s.turn.who === id, picked, 5000), `a tap on someone at the table picks them (${picked})`);
  await sleep(1200);
  await asker.locator("#mo-hand [data-card]").nth(2).dispatchEvent("click");
  await sleep(900);
  await asker.screenshot({ path: join(OUT, "3-picked-card-raised.png") }); console.log("  shot 3-picked-card-raised");
  await other.screenshot({ path: join(OUT, "3b-others-see-the-pick.png") }); console.log("  shot 3b-others-see-the-pick");
  await asker.click("#mo-ask");
  ok(await until(other, () => !!window.__table.info().card && !!document.querySelector(".mo-center .mo-text"), null, 8000), "Ask: the card lands on the table, big on every screen");
  await sleep(1800);
  await other.screenshot({ path: join(OUT, "4-card-on-the-table.png") }); console.log("  shot 4-card-on-the-table");
  // look round: a drag turns your head; it glides back
  const v0 = await other.evaluate(() => window.__table.view.yaw);
  await other.mouse.move(330, 420); await other.mouse.down();
  for (let i = 1; i <= 12; i++) { await other.mouse.move(330 - i * 24, 420); await sleep(16); }
  await other.mouse.up(); await sleep(700);
  const v1 = await other.evaluate(() => window.__table.view.yaw);
  ok(v1 - v0 > 0.5, `a drag turns your head round the table (yaw ${v1.toFixed(2)})`);
  await other.screenshot({ path: join(OUT, "5-looking-round.png") }); console.log("  shot 5-looking-round");
  ok(await until(other, () => Math.abs(window.__table.view.yaw) < 0.06, null, 9000), "~4 s after letting go it glides back to the table");
  // to the end
  for (let i = 0; i < 60 && (await state(A))?.phase !== "end"; i++) { await A.locator("#hp-skip").first().click().catch(() => {}); await sleep(600); }
  ok(await until(A, () => window.__table.info().ending && /weren't alone|thank you/.test(document.querySelector(".mo-end")?.textContent ?? ""), null, 15000), "the end: the camera lifts, every mask off");
  await sleep(4000);
  await A.screenshot({ path: join(OUT, "6-end.png") }); console.log("  shot 6-end");
  await ctx.close();
}

// ---- a big party: 8 at the table, the rest in the seat bar
{
  console.log("\nA big party: 2 phones + 8 bots");
  const { ctx, A } = await party({ bots: 8, real3d: false, dpr: 1 });
  ok(await until(A, () => window.__table?.info().seated.length === 8 && document.querySelectorAll("#mo-seatbar .mo-chip").length === 2, null, 40000), "the table seats 8; the other 2 are in the seat bar at the top");
  await sleep(1500);
  await A.screenshot({ path: join(OUT, "7-ten-players.png") }); console.log("  shot 7-ten-players");
  await ctx.close();
}

console.log(errs.length ? `✗ page errors: ${errs.join(" | ")}` : "✓ no page errors");
await browser.close(); close();
process.exit(errs.length || fails ? 1 : 0);
