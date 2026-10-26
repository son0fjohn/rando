// Manhunt end to end, five phones, simulated GPS (?mhsim=1) and a fast clock
// (?mhfast=6: a game minute lasts 10 s). The host (a hunter) and one runner
// run the REAL app page (the live 3D map, the Hunter's elevator); the other
// three run the light party page. Records the host and the runner side by
// side: the setup on the map, the Hunter's opening, the head start, a ping
// on the map, a tag (the runner confirms), a screen locked through a ping,
// SAFE, the results board. Checks what goes over the wire on the way.
//   node test/manhunt_rec.mjs <dir>          (FFMPEG=/path/to/ffmpeg for manhunt.mp4)
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/manhunt_rec.mjs <dir>"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const FAST = 6, MIN = 60000 / FAST;
const { base, close } = await serve({ realAvatars: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const LOOKS = {
  tony: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  mina: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  jae: { skin: "4", eyes: "keen", iris: "gray", hairColor: "platinum", hair: "buzz", head: "durag", face: "none", top: "track-purple", bottom: "track-pants", shoes: "combat", neck: "none" },
  sol: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "none", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
  haru: { skin: "5", eyes: "cool", iris: "brown", hairColor: "black", hair: "bob", head: "bucket", face: "none", top: "varsity", bottom: "wide-jeans", shoes: "hightop", neck: "none" },
};
const MH = `&mhsim=1&mhfast=${FAST}`;

// ---- windows (a background tab doesn't render; each phone gets a window)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, geolocation: { latitude: 37.5347, longitude: 126.9945 }, permissions: ["geolocation"] });
await ctx.addInitScript(() => {
  try { localStorage.setItem("rando-hint-v1", "1"); } catch {}
  // everything this phone puts on the wire (the stub channels ride on BroadcastChannel)
  window.__sent = [];
  const post = BroadcastChannel.prototype.postMessage;
  BroadcastChannel.prototype.postMessage = function (d) { if (this.name.startsWith("sbstub:") && d?.k === "bc") window.__sent.push({ ch: this.name, event: d.event, payload: d.payload }); return post.call(this, d); };
});
const bcdp = await browser.newBrowserCDPSession();
let cid = null;
async function win() {
  if (!cid) { const p = await ctx.newPage(); cid = (await (await ctx.newCDPSession(p)).send("Target.getTargetInfo")).targetInfo.browserContextId; return p; }
  const made = ctx.waitForEvent("page");
  await bcdp.send("Target.createTarget", { url: "about:blank", browserContextId: cid, newWindow: true, background: false });
  const pg = await made; await pg.setViewportSize({ width: 390, height: 844 }); return pg;
}
async function phone(name, qs = "", light = false) {
  const pg = await win();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  pg.on("console", m => { if (/manhunt|mhmap|city/i.test(m.text()) && m.type() !== "log") console.log(`  [${name}] ${m.text().slice(0, 300)}`); });
  pg.on("dialog", d => d.accept());
  pg.label = name;
  const av = encodeURIComponent(JSON.stringify(LOOKS[name]));
  if (light) { await pg.goto(`${base}/test/hpparty.html?me=${name}&av=${av}${qs}${MH}&mh3d=0`); await pg.waitForFunction(() => window.__ready); }
  else { await pg.goto(`${base}/app.html?onb=0&me=${name}&av=${av}&devlat=37.5347&devlng=126.9945${qs}${MH}`); await pg.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 60000 }); }
  return pg;
}
async function cast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 78, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast").catch(() => {}) };
}
async function writeVideo(name, casts) {
  await Promise.all(casts.map(c => c.stop()));
  const all = casts.flatMap(c => c.frames.map(f => f.t)); if (!all.length) return;
  const t0 = Math.min(...all), t1 = Math.max(...all) + 0.5, dirs = [];
  for (const [k, c] of casts.entries()) {
    const dir = join(OUT, name, `phone${k + 1}`); await mkdir(dir, { recursive: true });
    let list = "ffconcat version 1.0\n";
    for (let i = 0; i < c.frames.length; i++) {
      const n = `f${String(i).padStart(5, "0")}.jpg`;
      await writeFile(join(dir, n), Buffer.from(c.frames[i].data, "base64"));
      const st = i === 0 ? t0 : c.frames[i].t, en = c.frames[i + 1]?.t ?? t1;
      list += `file ${n}\nduration ${Math.max(0.016, en - st).toFixed(3)}\n`;
    }
    await writeFile(join(dir, "frames.ffconcat"), list); dirs.push(dir);
  }
  if (!process.env.FFMPEG) return;
  const inputs = dirs.flatMap(d => ["-f", "concat", "-i", join(d, "frames.ffconcat")]);
  const scale = dirs.map((_, i) => `[${i}:v]fps=24,scale=390:844,setsar=1[v${i}]`).join(";");
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${scale};${dirs.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${dirs.length}[out]`, "-map", "[out]", "-pix_fmt", "yuv420p", "-crf", "27", join(OUT, `${name}.mp4`)]);
  console.log(`  wrote ${name}.mp4 (${Math.round(t1 - t0)} s)`);
}
const shot = async (pg, n) => { await pg.screenshot({ path: join(OUT, `${n}.png`), timeout: 120000 }).catch(e => console.log("  (shot failed)", n, e.message)); console.log("  shot", n); };
// a tap through the DOM (two live 3D maps on one CPU: Playwright's "stable" checks can starve)
const tap = (pg, sel) => pg.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel);
const S = pg => pg.evaluate(() => { const s = window.__game?.s; return s ? JSON.parse(JSON.stringify(s)) : null; });

// ---- the party
console.log("\nThe party: 5 phones");
const A = await phone("tony");                 // the host, a hunter (real app)
await A.click("#nav-host").catch(() => A.click("#party-btn")); await sleep(800);
if (await A.locator("#party-btn").isVisible().catch(() => false)) await A.click("#party-btn");
await A.locator("#pt-name").fill("Manhunt night");
await A.click("#pt-create");
await until(A, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? ""));
const code = (await A.locator("#pt-code-chip").innerText()).trim();
const B = await phone("mina", `&party=${code}`);             // a runner (real app)
const L = [];
for (const n of ["jae", "sol", "haru"]) L.push(await phone(n, `&party=${code}`, true));
ok(await until(A, () => document.querySelectorAll(".lr-av").length >= 5, null, 60000), "5 phones in the party room");
const casts = [await cast(A), await cast(B)];

// ---- setup: the host draws the zone on the map
console.log("\nSetup");
await A.bringToFront();
await A.evaluate(() => document.getElementById("pt-vote").click()); const title = A.locator('[data-game="manhunt"] .pv-t > b'); await title.waitFor({ state: "visible" }); await sleep(800);
await A.evaluate(() => document.querySelector('[data-game="manhunt"] .pv-t > b').click());
ok(await until(A, () => !!document.getElementById("mh-go"), null, 30000), "the host gets the setup sheet");
ok(await until(A, () => !!window.__mh?.map?.live && document.querySelector(".mh-catch"), null, 90000), "over the live 3D map, in city mode");
await sleep(5000);
await shot(A, "01-setup-map");
// tap the map to move the circle, set the size
const box = await A.locator(".mh-catch").boundingBox();
await A.mouse.click(box.x + box.width * 0.52, box.y + box.height * 0.6); await sleep(1500);
await A.evaluate(() => { const r = document.getElementById("mh-r"); r.value = "450"; r.dispatchEvent(new Event("input")); }); await sleep(1200);
// settings: 10 min round, a ping every minute, 1 min head start
for (let i = 0; i < 3; i++) { await tap(A, '[data-step="round"][data-d="-1"]'); await sleep(150); }
for (let i = 0; i < 4; i++) { await tap(A, '[data-step="ping"][data-d="-1"]'); await sleep(150); }
for (let i = 0; i < 2; i++) { await tap(A, '[data-step="head"][data-d="-1"]'); await sleep(150); }
await tap(A, '[data-pid="u-tony"][data-team="hunter"]'); await tap(A, '[data-pid="u-sol"][data-team="hunter"]'); await sleep(800);
await A.evaluate(() => document.getElementById("mh-sheet").scrollTop = 0); await sleep(600);
await shot(A, "02-setup-drawn");
await A.evaluate(() => document.getElementById("mh-sheet").scrollTop = 9999); await sleep(600);
await shot(A, "03-setup-teams");
const st0 = await S(A);
ok(st0.setup.zone?.type === "circle" && st0.setup.zone.r === 450 && st0.setup.round === 15 && st0.setup.ping === 1 && st0.setup.head === 1, `zone drawn (${st0.setup.zone?.r} m), 15 min round, a ping a minute, 1 min head start`);
await tap(A, "#mh-go");
ok(await until(A, () => window.__game?.s?.phase === "rules", null, 240000), "Start: the rules card");

// ---- rules: everyone taps in
await sleep(1500); await shot(A, "04-rules-hunter"); await B.bringToFront(); await sleep(800); await shot(B, "04b-rules-runner");
for (const pg of [A, B, ...L]) await tap(pg, "#mh-ready");
ok(await until(A, () => ["intro", "headstart", "hunt"].includes(window.__game?.s?.phase), null, 240000), "everyone's in: the elevator");
await A.bringToFront();
await sleep(4500); await shot(A, "05-elevator-intro");
ok(await until(A, () => ["headstart", "hunt"].includes(window.__game?.s?.phase), null, 240000), "the head start");
// haru's screen locks in the head start, through the first ping
await L[2].evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
console.log("  (haru's phone:", await L[2].evaluate(() => JSON.stringify({ vis: document.visibilityState, asleep: window.__mh?.me.asleep, phase: window.__game?.s?.phase })), ")");
await sleep(1500); await shot(A, "06-hunter-no-peeking"); await B.bringToFront(); await sleep(800); await shot(B, "06b-runner-headstart");
ok(await until(A, () => window.__game?.s?.phase === "hunt", null, 240000), "the hunt");
// ---- a ping on the map
const roles = Object.fromEntries(Object.values((await S(A)).players).map(p => [p.handle, p.role]));
ok(roles.tony === "hunter" && roles.sol === "hunter" && roles.mina === "runner", `teams: ${JSON.stringify(roles)}`);
await A.bringToFront();
ok(await until(A, () => !document.querySelector(".mh-elev")?.hidden && document.querySelector(".mh-elev")?.classList.contains("small"), null, 2 * MIN), "a ping: the small elevator window over the map");
await sleep(1200); await shot(A, "07-ping-window");
ok(await until(A, () => window.__mh?.pings.size >= 1 && document.querySelector(".mh-elev")?.hidden, null, 20000), "then the circles on the map");
await sleep(2500); await shot(A, "08-ping-on-map");
const ps = await A.evaluate(() => [...window.__mh.pings.entries()].map(([id, p]) => ({ id, r: p.r, none: p.none, no: p.no })));
ok(ps.some(p => p.id === "u-mina" && p.r >= 25 && p.r <= 50), `the hunter sees fuzzy circles (${ps.filter(p => !p.none).map(p => `${p.id.slice(2)} ${p.r} m`).join(", ")})`);
const lastNo = Math.max(...ps.map(p => p.no ?? 0)), haru = ps.find(p => p.id === "u-haru");
ok(!haru || haru.none || haru.no < lastNo, `the locked phone sent nothing at that ping (haru's last circle: ping ${haru?.no ?? "none"}, the latest: ${lastNo})`);
ok(await A.evaluate(() => /haru/.test(document.querySelector(".mh-nosig")?.textContent ?? "")), "the hunters see \"no signal: haru\"");
await L[2].evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await B.bringToFront(); await sleep(1000); await shot(B, "08b-runner-map");
// ---- a tag: the hunter picks mina, mina confirms
await A.bringToFront();
await tap(A, '[data-open="tag"]'); await sleep(900); await shot(A, "09-tag-pick");
await tap(A, '[data-who="u-mina"]');
ok(await until(B, () => !!document.getElementById("mh-yes"), null, 60000), "the runner is asked to confirm");
await B.bringToFront(); await sleep(800); await shot(B, "10-tag-confirm");
await tap(B, "#mh-yes");
ok(await until(A, () => window.__game?.s?.players?.["u-mina"]?.tagged, null, 60000), "confirmed: caught");
await sleep(1500); await tap(A, '[data-open="wanted"]'); await sleep(1500); await shot(A, "11-wanted-caught");
await tap(A, "#mh-x");
// SAFE on a light phone
await L[0].evaluate(() => document.getElementById("mh-safe").click());
ok(await until(A, () => window.__game?.s?.players?.["u-jae"]?.safe, null, 60000), "SAFE: jae is paused, the host told");
await until(L[0], () => !!document.getElementById("mh-resume"), null, 30000);
await L[0].evaluate(() => document.getElementById("mh-resume")?.click());
await until(A, () => !window.__game?.s?.players?.["u-jae"]?.safe, null, 60000);
// ---- the rest of the runners: tagged by sol (a light phone); the host's phone up front for the end
await A.bringToFront();
for (const [who, pg] of [["u-jae", L[0]], ["u-haru", L[2]]]) {
  await L[1].evaluate(w => { document.querySelector('[data-open="tag"]')?.click(); setTimeout(() => document.querySelector(`[data-who="${w}"]`)?.click(), 400); }, who);
  await until(pg, () => !!document.getElementById("mh-yes") && !document.getElementById("mh-modal").hidden, null, 60000);
  await pg.evaluate(() => document.getElementById("mh-yes")?.click());
  await until(A, w => window.__game?.s?.players?.[w]?.tagged, who, 60000);
}
ok(await until(A, () => window.__game?.s?.phase === "end", null, 240000), "every runner caught: the end");
await sleep(2500); await shot(A, "12-results-elevator");
await sleep(5000); await shot(A, "13-results-board");
const fin = await S(A);
ok(fin.verdict === "hunters" && fin.last, `${fin.verdict} win; Last Survivor: ${fin.last}`);
// what went over the wire (every phone's own outbox, from the start of the game)
const sentAll = (await Promise.all([A, B, ...L].map(pg => pg.evaluate(() => window.__sent.splice(0))))).flat();
await writeFile(join(OUT, "wire.json"), JSON.stringify(sentAll.slice(-400), null, 1));
const coord = /37\.53\d|126\.99\d/;
const J = m => JSON.stringify(m.payload);
const others = sentAll.filter(m => !/mh-pos|mh-zonedef/.test(J(m)) && !/"zone"|"setup"/.test(J(m)));
ok(!others.some(m => coord.test(J(m))), `nothing but fuzzy circles and the zone carried a coordinate (${sentAll.length} messages)`);
ok(sentAll.filter(m => /mh-team|mh-near/.test(J(m))).every(m => !coord.test(J(m))), `team / sprint messages are ciphertext (${sentAll.filter(m => /mh-team/.test(J(m))).length})`);
const locOff = await Promise.all([A, B, ...L].map(pg => pg.evaluate(() => !window.__mh || (!window.__mh.me.pos && !window.__mh.me.sim && window.__mh.me.watch == null))));
ok(locOff.every(Boolean), "every phone stopped reading its location");
await writeVideo("manhunt", casts);
console.log(errors.length ? `✗ page errors: ${errors.slice(0, 5).join(" | ")}` : "✓ no page errors");
await browser.close(); close();
process.exit(errors.length || fails ? 1 : 0);
