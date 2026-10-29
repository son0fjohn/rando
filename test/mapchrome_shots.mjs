// The world screen's chrome on the REAL app page (offline, test/appserve.mjs):
// the round buttons (Home top-left, Friends top-right, the note button
// bottom-right), the plaza chat over the map, "Back to me" and the bottom bar,
// by night, sunset and day, at 320 / 375 / 390 / 430 px wide. Asserts:
//   - Home and Friends: the same size, the same top, the same distance from
//     their screen edge, and the same CSS top (both off env(safe-area-inset-top));
//   - the note button: as big as the other round map buttons, liquid glass,
//     bottom-right, clear of the nav bar, the chat lines, the chat row (open
//     or closed) and "Back to me";
//   - the plaza chat: no box behind a line, a text shadow instead;
//   - the bar: navy (#0F1A3A) at night, the day map's sand (#9E9075) by day;
//     its labels: contrast >= 4.5:1 on the bar (every light); by day navy
//     labels and the active tab's gold pill behind a navy icon (>= 4.5:1).
// Screenshots in <dir>/<prefix>-<light>-<width>-*.png, the numbers in
// <dir>/<prefix>-mapchrome.json.
//
//   node test/mapchrome_shots.mjs <dir> [--prefix=after] [--lights=night,sunset,day] [--widths=320,375,390,430]
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/mapchrome_shots.mjs <dir> [--prefix=after] [--lights=night,sunset,day] [--widths=320,375,390,430]"); process.exit(2); }
const PREFIX = args.find(a => a.startsWith("--prefix="))?.slice(9) ?? "shot";
const LIGHTS = args.find(a => a.startsWith("--lights="))?.slice(9).split(",") ?? ["night", "sunset", "day"];
const WIDTHS = (args.find(a => a.startsWith("--widths="))?.slice(9).split(",") ?? ["320", "375", "390", "430"]).map(Number);
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true).catch(() => false);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const LOOK = { skin: "3", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-hitop-black" };
const LINES = [["mina", "anyone at the station?"], ["jae", "the taco place on the corner is packed tonight, worth the wait though"],
  ["sol", "ㅋㅋㅋ 이태원 오늘 사람 많다"], ["haru", "party at the rooftop in 10, come say hi"]];
// (page.screenshot can wait on fonts in this sandbox: straight from CDP)
async function shot(pg, name) {
  const cdp = await pg.context().newCDPSession(pg);
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  await cdp.detach().catch(() => {});
  await writeFile(join(OUT, `${PREFIX}-${name}.png`), Buffer.from(r.data, "base64"));
}
const report = {};

for (const light of LIGHTS) {
  console.log(`\n${light}`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); localStorage.setItem("rando-lang", "en"); } catch {} });
  const pg = await ctx.newPage();
  await pg.goto(`${base}/app.html?onb=0&me=tony&av=${encodeURIComponent(JSON.stringify(LOOK))}&devlat=37.5347&devlng=126.9945&light=${light}`);
  await pg.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 60000 });
  await until(pg, () => !document.getElementById("navbar")?.hidden, null, 60000);
  ok(await until(pg, () => document.body.classList.contains("notes-on") && !!document.getElementById("notes-leave"), null, 60000), "the note button is on the world screen");
  // what a returning player sees: Home (shown once onboarding hides), Friends
  // (once the friends list loads), the plaza chat with a few lines, Back to me
  await pg.evaluate(lines => {
    document.getElementById("nav-home").hidden = false;
    document.getElementById("friends-btn").hidden = false;
    document.getElementById("pubchat").hidden = false;
    const feed = document.getElementById("pubchat-feed");
    for (const [h, m] of lines) { const d = document.createElement("div"); d.className = "pub-line"; const b = document.createElement("b"); b.textContent = h; d.append(b, document.createTextNode(m)); feed.appendChild(d); }
  }, LINES);
  // "Back to me" (it shows once you've panned away; held on, after backend.js's own check each frame)
  await pg.evaluate(() => import("/web/world3d.js").then(W => W.world3d.tickHooks.push(() => { document.getElementById("nav-backtome").hidden = false; })));
  await sleep(6000);                                    // the world streams in, --day settles
  report[light] = {};
  for (const w of WIDTHS) {
    await pg.setViewportSize({ width: w, height: 844 });
    await sleep(1200);
    const g = await pg.evaluate(() => {
      const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(2), t: +r.top.toFixed(2), r: +r.right.toFixed(2), b: +r.bottom.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
      const frame = document.querySelector(".frame").getBoundingClientRect();
      const $ = id => document.getElementById(id);
      const lines = [...document.querySelectorAll("#pubchat-feed .pub-line")].map(R);
      const cs = el => getComputedStyle(el);
      const ruleTop = sel => { for (const s of document.styleSheets) { let rules; try { rules = s.cssRules; } catch { continue; } for (const r of rules) if (r.selectorText === sel && r.style.top) return r.style.top; } return null; };
      const note = $("notes-leave"), ns = note && cs(note);
      const line = document.querySelector("#pubchat-feed .pub-line");
      const bar = $("navbar");
      // (colours as rgb: color-mix() computes to color(srgb …))
      const rgb = c => { const m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(c); return m ? `rgb(${m.slice(1).map(v => Math.round(v * 255)).join(", ")})` : c; };
      const lbl = [...bar.querySelectorAll(".nav-tab")].map(t => { const icon = t.querySelector(":scope > svg"); return { id: t.id, on: t.classList.contains("on"), color: rgb(cs(t).color),
        icon: icon ? rgb(cs(icon).color) : null, pill: icon ? cs(icon).backgroundColor : null }; });
      return { frame: { l: frame.left, r: frame.right, t: frame.top, b: frame.bottom, w: frame.width }, home: R($("nav-home")), friends: R($("friends-btn")), note: R(note),
        noteText: note?.textContent.trim(), noteCls: note?.className, noteBlur: ns?.backdropFilter, noteRadius: ns?.borderRadius,
        back: R($("nav-backtome")), nav: R(bar), row: R($("pubchat-row")), chatOpen: R($("pubchat-open")), lines,
        homeTop: ruleTop("#nav-home"), friendsTop: ruleTop("#side-actions"),
        lineBg: line && cs(line).backgroundColor, lineShadow: line && cs(line).textShadow, lineBlur: line && cs(line).backdropFilter, nameColor: line && cs(line.querySelector("b")).color,
        barBg: cs(bar).backgroundColor, lbl, day: cs(document.documentElement).getPropertyValue("--day").trim() };
    });
    const tag = `${light} ${w}px`;
    const hit = (a, b, pad = 0) => a && b && a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
    // top buttons
    const hL = g.home.l - g.frame.l, fR = g.frame.r - g.friends.r;
    ok(g.home.w === g.friends.w && g.home.h === g.friends.h, `${tag}: Home and Friends the same size (${g.home.w}×${g.home.h} / ${g.friends.w}×${g.friends.h})`);
    ok(g.home.t === g.friends.t, `${tag}: …the same top (${g.home.t} / ${g.friends.t})`);
    ok(Math.abs(hL - fR) < 0.01, `${tag}: …the same distance from their edge (${hL} / ${fR})`);
    ok(Math.abs(hL - (g.home.t - g.frame.t)) < 0.01, `${tag}: …as far from the top as from the side (${g.home.t - g.frame.t} / ${hL})`);
    ok(g.homeTop && g.homeTop === g.friendsTop && /safe-area-inset-top/.test(g.homeTop), `${tag}: …both from the top safe area in CSS (${g.homeTop} / ${g.friendsTop})`);
    // the note button
    if (g.note) {
      const nR = g.frame.r - g.note.r;
      ok(g.note.w === g.friends.w && g.note.h === g.friends.h, `${tag}: the note button is the round map buttons' size (${g.note.w}×${g.note.h})`);
      ok(/📝/.test(g.noteText ?? "") && /glass-icon/.test(g.noteCls ?? "") && /blur/.test(g.noteBlur ?? "") && parseFloat(g.noteRadius) >= g.note.w / 2 - 1, `${tag}: …round liquid glass with 📝 (${g.noteCls}, ${g.noteBlur})`);
      ok(Math.abs(nR - fR) < 0.01, `${tag}: …bottom-right, the same side margin as Friends (${nR})`);
      ok(!hit(g.note, g.nav), `${tag}: …clear of the nav bar (note bottom ${g.note.b}, bar top ${g.nav.t})`);
      ok(!g.lines.some(l => hit(g.note, l, 4)), `${tag}: …clear of the chat lines`);
      ok(!hit(g.note, g.chatOpen, 4), `${tag}: …clear of the chat button`);
      ok(!hit(g.note, g.back, 4), `${tag}: …clear of Back to me (note top ${g.note.t}, Back to me bottom ${g.back?.b})`);
    }
    report[light][w] = g;
    await shot(pg, `${light}-${w}-map`);
  }
  // the chat open (its field across the row) at the narrowest width
  await pg.setViewportSize({ width: WIDTHS[0], height: 844 }); await sleep(600);
  await pg.evaluate(() => document.getElementById("pubchat-open").click()); await sleep(600);
  const open = await pg.evaluate(() => { const R = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const n = document.getElementById("notes-leave"); return { note: n && R(n), form: R(document.getElementById("pubchat-form")), send: R(document.getElementById("pubchat-send")) }; });
  const hit = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  if (open.note) ok(!hit(open.note, open.form) && !hit(open.note, open.send), `${light} ${WIDTHS[0]}px: chat open, the field and Send stop short of the note button`);
  await shot(pg, `${light}-${WIDTHS[0]}-chat-open`);
  await pg.evaluate(() => { document.getElementById("pubchat-form").hidden = true; document.getElementById("pubchat-open").hidden = false; });
  // the chat and the bar close up, at 390
  await pg.setViewportSize({ width: 390, height: 844 }); await sleep(800);
  const g = report[light][390] ?? report[light][WIDTHS[0]];
  ok(g.lineBg === "rgba(0, 0, 0, 0)" && g.lineBlur === "none" && g.lineShadow !== "none", `${light}: the chat lines have no box, a text shadow (${g.lineBg}, ${g.lineShadow.slice(0, 40)}…)`);
  const lum = c => { const [r, gg, b] = c.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * gg + .0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const cr = g.lbl.map(l => ({ ...l, cr: +contrast(l.color, g.barBg).toFixed(2) }));
  report[light].bar = { bg: g.barBg, labels: cr, day: g.day };
  console.log(`    bar ${g.barBg} (--day ${g.day}): ` + cr.map(l => `${l.id}${l.on ? " (on)" : ""} ${l.color} ${l.cr}:1`).join(" · "));
  ok(cr.every(l => l.cr >= 4.5), `${light}: every bar label ≥ 4.5:1 on the bar`);
  const BAR = { night: "rgb(15, 26, 58)", day: "rgb(158, 144, 117)" };
  if (BAR[light]) ok(g.barBg === BAR[light], `${light}: the bar is ${light === "day" ? "the day map's sand, #9E9075" : "navy, #0F1A3A"} (${g.barBg})`);
  if (light === "day") {
    ok(cr.every(l => l.color === "rgb(15, 26, 58)"), `day: navy labels (${cr.map(l => l.color).join(" · ")})`);
    const on = cr.find(l => l.on && l.pill);
    ok(on && on.pill === "rgb(255, 200, 61)" && on.icon === "rgb(15, 26, 58)" && contrast(on.icon, on.pill) >= 4.5,
      `day: the active tab (${on?.id}) a gold pill behind a navy icon (${on?.pill} / ${on?.icon}, ${on ? contrast(on.icon, on.pill).toFixed(2) : "?"}:1)`);
  }
  if (light === "night") {
    const on = cr.find(l => l.on);
    ok(on && on.color === "rgb(255, 200, 61)" && /rgba\(0, 0, 0, 0\)|transparent|rgba\(255, 200, 61, 0\)/.test(on.pill ?? "rgba(0, 0, 0, 0)"), `night: the active tab gold, no pill (${on?.color}, ${on?.pill})`);
  }
  const nav = await pg.evaluate(() => { const r = document.getElementById("navbar").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  const cdp = await pg.context().newCDPSession(pg);
  const clip = async (name, c) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...c, scale: 2 } }); await writeFile(join(OUT, `${PREFIX}-${name}.png`), Buffer.from(r.data, "base64")); };
  await clip(`${light}-bar`, { x: 0, y: nav.y - 70, width: nav.width, height: nav.height + 70 });
  const fb = await pg.evaluate(() => { const r = document.getElementById("pubchat").getBoundingClientRect(); return { x: 0, y: r.top - 150, width: innerWidth, height: r.height + 150 }; });
  await clip(`${light}-chat`, fb);
  await clip(`${light}-top`, { x: 0, y: 0, width: 390, height: 90 });
  await cdp.detach().catch(() => {});
  await ctx.close();
}
await writeFile(join(OUT, `${PREFIX}-mapchrome.json`), JSON.stringify(report, null, 1));
await browser.close(); close();
console.log(`\n${pass} passed, ${fail} failed · shots in ${OUT}`);
process.exit(fail ? 1 : 0);
