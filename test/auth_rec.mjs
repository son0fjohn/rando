// Accounts on the real app page (Supabase faked, test/stubs/supabase.js),
// fresh phones each in their own browser context, in English and Korean:
//
//   A  a guest joins from an invite with a name and a character, no phone,
//      no email; hosting a private party asks for nothing either
//   B  saving the account with Kakao from the first party's recap: the same
//      account comes back from Kakao, still in the party, verified; a Kakao
//      account that's already someone's: the sign-in-instead sheet
//   C  the phone prompt when making a party public: the reason line, the
//      code step's "Didn't get it? Try again in 30s or sign in with Kakao",
//      this phone's own 30 s limit, Send it again, verified -> public; the
//      provider refusing to text: the error and the Kakao way round
//   D  a new phone: "Already have an account? Sign in" -> Kakao -> Home as
//      that account
//
//   node test/auth_rec.mjs <dir> [en|ko|both] [--only=ABCD]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/auth_rec.mjs <dir> [en|ko|both]"); process.exit(2); }
const pick = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "both";
const ONLY = process.argv.find(a => a.startsWith("--only="))?.slice(7) ?? "ABCD";   // --only=C: one part
const LANGS = pick === "both" ? ["en", "ko"] : [pick];
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
// (a sheet or screen on its way out is still in the page for a moment: never the one tapped)
const tap = (pg, sel) => pg.evaluate(sel => { const el = [...document.querySelectorAll(sel)].find(e => !e.closest(".onb-sheet.out, .onb-screen.out")); el?.click(); return !!el; }, sel);
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const shot = async (pg, lang, n, what) => { await pg.screenshot({ path: join(OUT, `${lang}-${n}.png`), timeout: 120000 }).catch(e => console.log("  (shot failed)", n, e.message)); console.log(`  shot ${lang}-${n} · ${what}`); };
const LOOKS = {
  jae: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  dana: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
};
const appUrl = (q = "") => `${base}/app.html?devlat=37.5347&devlng=126.9945${q}`;
const screenIs = (pg, id, ms = 60000) => until(pg, id => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === id, id, ms);
const sheetIs = (pg, id, ms = 30000) => until(pg, id => !!document.querySelector(`.onb-sheet[data-sheet="${id}"]:not(.out)`), id, ms);
const toastHas = (pg, re, ms = 15000) => until(pg, src => [...document.querySelectorAll(".onb-toast, .perm-toast, [class*=toast]")].some(t => new RegExp(src).test(t.textContent)), re.source, ms);
const events = pg => pg.evaluate(() => (window.__events ?? []).map(e => `${e.name}${e.props.trigger ? `:${e.props.trigger}` : ""}${e.props.provider ? `:${e.props.provider}` : ""}${e.props.reason ? `:${e.props.reason}` : ""}`));

// ---- phones: each its own context (its own storage); BroadcastChannel relayed between them
const contexts = [];
async function phone(lang, { stub = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: lang === "ko" ? "ko-KR" : "en-US" });
  await ctx.addInitScript(({ lang, stub }) => {
    try {
      if (!localStorage.getItem("rando-lang")) localStorage.setItem("rando-lang", lang);
      for (const [k, v] of Object.entries(stub)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    } catch {}
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (d) {
      post.call(this, d);
      if (!this.__relayed && this.name.startsWith("sbstub:") && window.__relay) window.__relay(this.name, d);
    };
  }, { lang, stub: { "stub-verify": "1", "stub-oauth": "kakao,apple,google", ...stub } });
  await ctx.exposeBinding("__relay", async ({ context }, name, d) => {
    for (const other of contexts) {
      if (other === context) continue;
      const pg = other.pages().find(p => !p.isClosed());
      pg?.evaluate(([name, d]) => { const bc = new BroadcastChannel(name); bc.__relayed = true; bc.postMessage(d); setTimeout(() => bc.close(), 50); }, [name, d]).catch(() => {});
    }
  });
  contexts.push(ctx);
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(e.message));
  pg.on("dialog", d => d.accept());
  return { ctx, pg };
}
const done = async ctx => { if (!ctx || !contexts.includes(ctx)) return; contexts.splice(contexts.indexOf(ctx), 1); await ctx.close(); };
// a first open: the start screen, then the guest setup on its own (name,
// character), without the party Start a party would open after it
async function toName(pg) {
  await pg.goto(appUrl());
  await screenIs(pg, "start", 120000);
  await pg.evaluate(() => { window.__onb.setup(); });
  return cardIs(pg, 60000);
}
// the setup card on the start panel: the name (a random one, selected), the character, Let's go
const cardIs = (pg, ms = 30000) => until(pg, () => !!document.querySelector(".st-panel [data-setup] #su-name"), null, ms);
async function throughCard(pg, name) { await setField(pg, "#su-name", name); await sleep(300); await tap(pg, ".st-panel [data-go]"); }
// (set from the page: a fill/click would wait on a "stable" element, which the live city behind the glass never is on software GL)
const setField = (pg, sel, v) => pg.evaluate(([sel, v]) => { const i = document.querySelector(sel); if (!i) return; i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
const setUp = pg => until(pg, () => !!JSON.parse(localStorage.getItem("rando-onb-v1") ?? "{}").done, null, 60000);

for (const lang of LANGS) {
  console.log(`\n==== ${lang}`);

  if (/[AB]/.test(ONLY)) {
  console.log("\nA  a guest from an invite: a name and a character, no phone");
  const { ctx: hctx, pg: H } = await phone(lang);
  await H.goto(appUrl(`&me=jae&av=${encodeURIComponent(JSON.stringify(LOOKS.jae))}`));
  ok(await screenIs(H, "start"), `${lang}: the host is on the start screen`);
  await sleep(1500);
  await tap(H, ".st-panel [data-start]");
  ok(await sheetIs(H, "invite"), `${lang}: Start a party -> the party and its invite sheet`);
  ok(await H.evaluate(() => !document.querySelector('.onb-sheet[data-sheet="verify"]')), `${lang}: …a private party asks for no phone`);
  const link = (await H.evaluate(() => document.querySelector("[data-share]")?.dataset.link)).replace(/^https?:\/\/[^/]+/, base);
  await tap(H, '.onb-sheet[data-sheet="invite"] [data-close]');

  const { ctx: nctx, pg: N } = await phone(lang);
  await N.goto(link);
  ok(await screenIs(N, "start"), `${lang}: the invite opens the start screen, the party's name on it`);
  await sleep(1500);
  await shot(N, lang, "A1-invite", "an invite: the party's name on the glass");
  ok(await cardIs(N), `${lang}: straight on -> the setup card: a name and a character`);
  ok(await until(N, () => !!document.querySelector("[data-have]"), null, 10000), `${lang}: …with "Already have an account? Sign in" for a returning player`);
  await until(N, () => !!document.querySelector("#su-stage canvas"), null, 30000); await sleep(1500);
  await setField(N, "#su-name", lang === "ko" ? "민지" : "Sam"); await sleep(300);
  await shot(N, lang, "A2-card", "just a name and a character (no phone, no email)");
  await tap(N, ".st-panel [data-go]");
  ok(await until(N, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor"), null, 40000), `${lang}: -> straight into the party`);
  ok(await until(N, () => !!document.querySelector(".onb-in") || window.__youreIn, null, 20000), `${lang}: "You're in!"`);
  await sleep(1200);
  await shot(N, lang, "A4-youre-in", "in the party, as a guest");
  const evA = await events(N);
  ok(!evA.some(e => e.startsWith("verification_")), `${lang}: no phone asked anywhere on the way (${evA.filter(e => !e.startsWith("permission")).join(", ")})`);
  const guestId = await N.evaluate(() => localStorage.getItem("stub-guest"));

  if (ONLY.includes("B")) {
  console.log("\nB  saving the account with Kakao");
  ok(await N.evaluate(async () => !(await window.__onb.party.hooks.canEarn())), `${lang}: a guest's coins wait for a verified number`);
  await N.evaluate(() => { const p = window.__onb.party; p._claimToast(p.current); });
  await sleep(700);
  await shot(N, lang, "B0-coins-wait", "a game's coins: wait for a verified number (tap to verify)");
  await N.evaluate(() => document.querySelector(".pt-claim")?.remove());
  await N.evaluate(() => { const o = window.__onb, c = o.party.current; c.played = [
    { game: "ritual", highlight: null, with: ["jae"] },
    { game: "sidequest", highlight: { kind: "quest", text: "Compliment a stranger's shoes like it's a wedding toast", by: "jae" }, with: ["jae"] },
    { game: "artgallery", highlight: null, with: ["jae"] }]; o.recapPreview(c); });
  ok(await sheetIs(N, "recap"), `${lang}: the first party's recap`);
  ok(await until(N, () => !!document.querySelector('[data-sheet="recap"] [data-save]'), null, 10000), `${lang}: …offers "Save your account"`);
  await sleep(3500);
  await shot(N, lang, "B1-recap", "the recap: Save your account");
  await tap(N, '[data-sheet="recap"] [data-save]');
  ok(await sheetIs(N, "save"), `${lang}: Save your account: Kakao, Apple, Google`);
  ok(await N.evaluate(() => [...document.querySelectorAll('[data-sheet="save"] [data-oauth]')].map(b => b.dataset.oauth).join() === "kakao,apple,google"), `${lang}: …Kakao first`);
  await sleep(500);
  await shot(N, lang, "B2-save", "Save your account");
  const nav = N.waitForNavigation({ timeout: 20000 }).catch(() => null);
  await tap(N, '[data-sheet="save"] [data-oauth="kakao"]');
  await nav;
  ok(await until(N, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor") && !!window.__onb?.party?.current, null, 120000), `${lang}: back from Kakao: still in the party`);
  ok(await toastHas(N, lang === "ko" ? /카카오/ : /Kakao/), `${lang}: "Saved with Kakao"`);
  await sleep(600);
  await shot(N, lang, "B3-saved", "back from Kakao, still in the party: Saved with Kakao");
  ok(await N.evaluate(id => localStorage.getItem("stub-guest") === id && JSON.parse(localStorage.getItem(`stub-ids-u-guest-${id}`) ?? "[]").includes("kakao"), guestId), `${lang}: the same account (u-guest-${guestId}), now with Kakao: nothing lost`);
  ok(await N.evaluate(async () => await window.__onb.party.hooks.canEarn()), `${lang}: a Kakao account counts as verified: coins are collected`);
  const evB = await events(N);
  ok(evB.includes("account_saved:recap:kakao") || evB.some(e => e.startsWith("account_saved")), `${lang}: analytics: account_saved (provider: kakao)`);
  await N.evaluate(() => window.__onb.settings());
  ok(await sheetIs(N, "settings"), `${lang}: Settings`);
  ok(await N.evaluate(() => /Kakao|카카오/.test(document.querySelector('[data-sheet="settings"]').textContent)), `${lang}: …Account: Saved · Kakao`);
  await sleep(500);
  await shot(N, lang, "B4-settings", "Settings: saved with Kakao, phone verified for stranger features");
  await tap(N, '[data-sheet="settings"] [data-close]');

  await done(nctx); await done(hctx);
  // a Kakao account that already has a Rando account
  const { ctx: tctx, pg: T } = await phone(lang, { stub: { "stub-oauth-taken": "1" } });
  await T.goto(appUrl(`&me=dana&av=${encodeURIComponent(JSON.stringify(LOOKS.dana))}`));
  ok(await screenIs(T, "start"), `${lang}: another guest on the start screen`);
  await T.evaluate(() => window.__onb.saveSheet("save"));
  ok(await sheetIs(T, "save"), `${lang}: Save your account`);
  const nav2 = T.waitForNavigation({ timeout: 20000 }).catch(() => null);
  await tap(T, '[data-sheet="save"] [data-oauth="kakao"]');
  await nav2;
  ok(await sheetIs(T, "taken", 120000), `${lang}: that Kakao account is already someone's: sign in with it instead, or keep playing as a guest`);
  ok(await T.evaluate(() => !location.hash.includes("error")), `${lang}: …and the address is cleaned up`);
  await sleep(600);
  await shot(T, lang, "B5-taken", "a Kakao account that already has a Rando account");
  await done(tctx);

  }
  await done(nctx); await done(hctx);     // (their 3D rooms would slow every page after)
  }

  if (ONLY.includes("C")) {
  console.log("\nC  the phone prompt when making a party public");
  const { ctx: gctx, pg: G } = await phone(lang);
  ok(await toName(G), `${lang}: a first open: the setup card`);
  await sleep(1500); await throughCard(G, lang === "ko" ? "하루" : "Haru");
  ok(await setUp(G), `${lang}: a new guest, set up`);
  // the map's Host button: the party form, with invite only / public
  await G.evaluate(() => { window.__onb.hide(); window.__onb.party.togglePanel(true); });
  ok(await until(G, () => !!document.querySelector('[data-priv="public"]'), null, 60000), `${lang}: the party form: invite only or public`);
  ok(await G.evaluate(n => document.getElementById("pt-name")?.placeholder.startsWith(n), lang === "ko" ? "하루" : "Haru"), `${lang}: …named after them ("${await G.evaluate(() => document.getElementById("pt-name")?.placeholder)}")`);
  await tap(G, '[data-priv="public"]');
  ok(await sheetIs(G, "verify"), `${lang}: Public asks for a verified number first`);
  const why = await G.evaluate(() => document.querySelector('.onb-sheet[data-sheet="verify"]:not(.out) .onb-sub')?.textContent ?? "");
  ok(lang === "ko" ? /근처 사람들/.test(why) : /Verify your number to play with people nearby\. Keeps everyone safe\./.test(why), `${lang}: …with the one-line reason ("${why}")`);
  ok(await G.evaluate(() => !!document.querySelector('[data-sheet="verify"] [data-oauth="kakao"]')), `${lang}: …and Kakao as the other way`);
  await sleep(500);
  await shot(G, lang, "C1-public-prompt", "making a party public: verify your number (or Kakao)");
  await G.fill('.onb-sheet:not(.out) #onb-phone', "+82 010-1234-5678");
  await tap(G, '.onb-sheet:not(.out) [data-send]');
  ok(await until(G, () => !!document.querySelector('.onb-sheet:not(.out) #onb-otp')), `${lang}: the code step`);
  ok(await G.evaluate(() => /\+821012345678/.test(document.querySelector('.onb-sheet[data-sheet="verify"]:not(.out) .onb-sub').textContent)), `${lang}: "+82 010…" goes out as +821012345678 (no trunk 0)`);
  const line = await G.evaluate(() => document.querySelector('.onb-sheet:not(.out) #onb-again')?.textContent ?? "");
  ok(lang === "ko" ? /안 왔나요.*초.*카카오/.test(line) : /Didn't get it\? Try again in \d+s or sign in with Kakao\./.test(line), `${lang}: "${line}"`);
  ok(await G.evaluate(() => document.querySelector('.onb-sheet:not(.out) [data-again]').hidden), `${lang}: …no Send again until the 30 s are up`);
  await sleep(800);
  await shot(G, lang, "C2-code", "the code: Didn't get it? Try again in 30s or sign in with Kakao");
  // this phone's own limit: a different number right away still waits
  await tap(G, '[data-sheet="verify"] [data-back]');
  await until(G, () => !!document.querySelector('.onb-sheet:not(.out) #onb-phone'));
  await G.evaluate(() => { const o = JSON.parse(localStorage.getItem("rando-otp")); o.sent = [Date.now() - 5000]; localStorage.setItem("rando-otp", JSON.stringify(o)); });   // asked 5 s ago
  await G.fill('.onb-sheet:not(.out) #onb-phone', "010-9876-5432"); await tap(G, '.onb-sheet:not(.out) [data-send]');
  ok(await until(G, () => /\d/.test(document.querySelector('.onb-sheet:not(.out) #onb-ver-err')?.textContent ?? "")), `${lang}: asking again within 30 s: "${await G.evaluate(() => document.querySelector('.onb-sheet:not(.out) #onb-ver-err')?.textContent)}"`);
  await shot(G, lang, "C3-wait", "asking again too soon: wait");
  if (lang === LANGS[0]) {
    await G.evaluate(() => { const o = JSON.parse(localStorage.getItem("rando-otp")); o.sent = o.sent.map(t => t - 31000); localStorage.setItem("rando-otp", JSON.stringify(o)); });
    await G.fill('.onb-sheet:not(.out) #onb-phone', "010-1234-5678"); await tap(G, '.onb-sheet:not(.out) [data-send]');
    ok(await until(G, () => !!document.querySelector('.onb-sheet:not(.out) #onb-otp')), `${lang}: 30 s later: a new code`);
    await G.evaluate(() => { const o = JSON.parse(localStorage.getItem("rando-otp")); o.sent = o.sent.map(t => t - 31000); localStorage.setItem("rando-otp", JSON.stringify(o)); });
    ok(await until(G, () => !document.querySelector('.onb-sheet:not(.out) [data-again]')?.hidden, null, 5000), `${lang}: …then "Send it again"`);
    await shot(G, lang, "C4-again", "Didn't get it? Send it again, or sign in with Kakao");
  } else {
    await G.evaluate(() => { const o = JSON.parse(localStorage.getItem("rando-otp")); o.sent = o.sent.map(t => t - 31000); localStorage.setItem("rando-otp", JSON.stringify(o)); });
    await G.fill('.onb-sheet:not(.out) #onb-phone', "010-1234-5678"); await tap(G, '.onb-sheet:not(.out) [data-send]');
    await until(G, () => !!document.querySelector('.onb-sheet:not(.out) #onb-otp'));
  }
  await G.fill('.onb-sheet:not(.out) #onb-otp', "123456");
  ok(await until(G, () => !document.querySelector('.onb-sheet[data-sheet="verify"]:not(.out)') && document.querySelector('[data-priv="public"]')?.classList.contains("on"), null, 90000), `${lang}: verified -> the party is public`);
  await sleep(600);
  await shot(G, lang, "C5-public", "verified: Public chosen");
  ok(await G.evaluate(async () => await window.__onb.party.hooks.canEarn()), `${lang}: …and coins can be collected now`);
  const evC = await events(G);
  ok(["verification_prompted:public", "verification_code_sent:public", "verification_completed:public"].every(n => evC.includes(n)) && evC.includes("verification_failed:public:rate_limited") === false,
    `${lang}: analytics: prompted, code sent, completed (${evC.filter(e => e.startsWith("verification")).join(", ")})`);
  await done(gctx);
  // the provider won't text: say so, and offer Kakao
  const { ctx: fctx, pg: F } = await phone(lang, { stub: { "stub-sms-fail": "provider" } });
  await F.goto(appUrl(`&me=dana&av=${encodeURIComponent(JSON.stringify(LOOKS.dana))}`));
  await screenIs(F, "start");
  await F.evaluate(() => { window.__onb.requireVerified("friends"); });
  ok(await sheetIs(F, "verify"), `${lang}: adding a friend asks too`);
  await F.fill('.onb-sheet:not(.out) #onb-phone', "010-1234-5678"); await tap(F, '.onb-sheet:not(.out) [data-send]');
  const fe = await F.evaluate(() => new Promise(r => setTimeout(() => r(document.querySelector('.onb-sheet:not(.out) #onb-ver-err')?.textContent ?? ""), 800)));
  ok(lang === "ko" ? /문자를 보낼 수 없어요.*카카오/.test(fe) : /couldn't text that number.*Kakao/.test(fe), `${lang}: the provider refused: "${fe}"`);
  ok((await events(F)).includes("verification_failed:friends:provider"), `${lang}: analytics: verification_failed (reason: provider), never the number`);
  await shot(F, lang, "C6-provider-fail", "the SMS provider refused: try Kakao");
  await done(fctx);

  }

  if (ONLY.includes("D")) {
  console.log("\nD  a new phone: sign in with Kakao");
  const { ctx: sctx, pg: S } = await phone(lang);
  ok(await toName(S), `${lang}: a first open on a new phone: the name`);
  ok(await until(S, () => !!document.querySelector("[data-have]"), null, 10000), `${lang}: "Already have an account? Sign in"`);
  await tap(S, "[data-have]");
  ok(await sheetIs(S, "signin"), `${lang}: Sign in: Kakao, Apple, Google, or a phone number`);
  await sleep(500);
  await shot(S, lang, "D1-signin", "a new phone: sign in");
  const nav3 = S.waitForNavigation({ timeout: 20000 }).catch(() => null);
  await tap(S, '[data-sheet="signin"] [data-oauth="kakao"]');
  await nav3;
  ok(await screenIs(S, "start", 120000), `${lang}: back from Kakao: the start screen, no setup again`);
  await tap(S, ".st-corner [data-me]");
  ok(await until(S, () => /minji/.test(document.querySelector(".onb-hi")?.textContent ?? "")), `${lang}: …as that account (minji, on Home)`);
  await sleep(3000);
  await shot(S, lang, "D2-signed-in", "signed in on a new phone: their own character");
  await done(sctx);
  }
}

console.log(errors.length ? `\n✗ page errors: ${[...new Set(errors)].slice(0, 6).join(" | ")}` : "\n✓ no page errors");
await browser.close(); close();
process.exit(errors.length || fails ? 1 : 0);
