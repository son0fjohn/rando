// Realtime channels recreated under the same topic, on the REAL app page with
// the stub in strict mode (?strictrt=1, test/stubs/bcchannel.js
// strictRealtime): channel() hands back a channel still in the list, and a
// removed one stays there, deaf, until its leave comes back. Every place the
// app drops a channel and opens it again must still hear the other side:
//   - the invite link through the UI, on a phone whose leave takes 2.5 s
//   - an invite link: peekRoom(room) and straight after it Room.join(room)
//     gets the room's presence (and the "once more" second peek answers)
//   - a Room leaving and joining the same room again
//   - the plaza chat after INITIAL_SESSION + a token refresh (re-sign-ins)
//   - a match / friend thread reopened, the raid lobby's chat re-entered
//   node test/realtime_strict.mjs
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
// (polled with evaluate, so an async predicate is awaited: waitForFunction
// would take its promise for a yes)
async function until(pg, fn, arg, ms = 15000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise(r => setTimeout(r, 150)))
    if (await pg.evaluate(fn, arg).catch(() => false)) return true;
  return false;
}
let fails = 0, passes = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (c) passes++; else fails++; };
const errors = [];
const LOOK = { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" };
const av = `&av=${encodeURIComponent(JSON.stringify(LOOK))}`;
const appUrl = (me, q = "") => `${base}/app.html?strictrt=1&devlat=37.5347&devlng=126.9945&me=${me}${av}${q}`;

// one browser context: its pages share BroadcastChannel, so they're one "server"
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "en-US" });
await ctx.addInitScript(() => { try { localStorage.setItem("rando-lang", "en"); localStorage.setItem("rando-hint-v1", "1"); } catch {} globalThis.__sceneryNoSlow = true; });
async function page(url, label) {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${label}: ${e.message}`));
  pg.on("console", m => { if (/cannot add `|room join timeout/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  pg.on("dialog", d => d.accept());
  await pg.goto(url);
  return pg;
}
// backend.js has signed in (and pubchat with it): INITIAL_SESSION came and went
const booted = pg => until(pg, async () => !!(await import("/web/backend.js")).pubchat.myId, null, 60000);

try {
  // the host: a light page (test/hpparty.html) with a party
  const H = await page(`${base}/test/hpparty.html?me=jae${av}`, "jae");
  await until(H, () => window.__ready === true);
  await H.evaluate(() => party.create());
  ok(await until(H, () => !!party.current?.meta.code), "jae hosts a party");
  const code = await H.evaluate(() => party.current.meta.code);
  const room = `party-${code}`;

  console.log("an invite link, through the UI (a 2.5 s leave)");
  const G = await page(appUrl("tony", `&party=${code}&rtleave=2500`), "tony");
  const inLobby = await until(G, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor") && !document.querySelector("#onb .onb-screen:not(.out)"), null, 90000);
  ok(inLobby, "tony: the invite link, the start screen, the dive, the lobby");
  if (!inLobby) console.log("    (tony:", await G.evaluate(() => JSON.stringify({ screen: document.querySelector(".onb-screen:not(.out)")?.dataset.screen, panel: document.querySelector(".st-panel")?.innerText.slice(0, 160), err: document.getElementById("pt-err")?.textContent })).catch(e => e.message), ")");
  ok(await until(G, async () => (await import("/web/party.js")).party.current?.room.members.some(m => m.handle === "jae"), null, 10000), "…with jae there (the room's presence)");
  ok(await until(H, () => party.current.room.members.some(m => m.handle === "tony"), null, 10000), "…and jae sees tony");
  await G.close();

  console.log("net.js, strict realtime");
  const M = await page(appUrl("mina", "&onb=0"), "mina");
  ok(await booted(M), "mina's app is up");
  const peekJoin = await M.evaluate(async room => {
    const { peekRoom, Room } = await import("/web/net.js");
    const info = await peekRoom(room);
    const r = new Room(room, { id: "u-peeker", handle: "peeker", avatar: {} });
    let joined = false;
    try { await r.join(); joined = true; } catch {}
    const t0 = Date.now();
    while (joined && !r.members.some(m => m.handle === "jae") && Date.now() - t0 < 5000) await new Promise(res => setTimeout(res, 100));
    const out = { info: info?.hostName ?? null, joined, members: r.members.map(m => m.handle) };
    window.__r = r;
    return out;
  }, room);
  ok(peekJoin.info === "jae", `the peek reads the party (host: ${peekJoin.info})`);
  ok(peekJoin.joined && peekJoin.members.includes("jae"), `a join straight after the peek gets the room's presence (${peekJoin.joined ? peekJoin.members.join(", ") : "join failed"})`);
  ok(await until(H, () => party.current.room.members.some(m => m.handle === "peeker"), null, 5000), "…and the host sees the joiner");

  await M.evaluate(() => window.__r.leave());
  await new Promise(r => setTimeout(r, 1000));      // (that leave is through: a room joined from scratch)
  const rejoin = await M.evaluate(async room => {
    const { Room } = await import("/web/net.js");
    const r0 = new Room(room, { id: "u-peeker", handle: "peeker", avatar: {} });
    await r0.join();
    const t1 = Date.now();
    while (!r0.members.some(m => m.handle === "jae") && Date.now() - t1 < 5000) await new Promise(res => setTimeout(res, 100));
    r0.leave();
    const r = new Room(room, { id: "u-peeker", handle: "peeker", avatar: {} });
    let joined = false;
    try { await r.join(); joined = true; } catch {}
    const t0 = Date.now();
    while (joined && !r.members.some(m => m.handle === "jae") && Date.now() - t0 < 5000) await new Promise(res => setTimeout(res, 100));
    window.__r = r;
    return { joined, members: r.members.map(m => m.handle) };
  }, room);
  ok(rejoin.joined && rejoin.members.includes("jae"), `leaving a room and joining it again straight away: presence (${rejoin.joined ? rejoin.members.join(", ") : "join failed"})`);
  const hostHears = H.evaluate(() => new Promise(res => { party.current.room.on("rt-check", () => res(true)); setTimeout(() => res(false), 4000); }));
  await M.evaluate(() => window.__r.send("rt-check", {}));
  ok(await hostHears, "…and its broadcasts reach the host");
  await M.evaluate(() => window.__r.leave());

  const twice = await M.evaluate(async room => {
    const { peekRoom } = await import("/web/net.js");
    const a = await peekRoom(room), b = await peekRoom(room, { timeout: 4000 });
    return [a?.hostName ?? null, b?.hostName ?? null];
  }, room);
  ok(twice[0] === "jae" && twice[1] === "jae", `two peeks back to back both answer (${twice.join(", ")})`);

  console.log("backend.js, strict realtime");
  const S = await page(appUrl("sol", "&onb=0"), "sol");
  ok(await booted(S), "sol's app is up");
  // re-sign-ins: a token refresh re-runs refreshStatus -> pubchat.onSignedIn
  await M.evaluate(() => window.__authEvent("TOKEN_REFRESHED"));
  await M.evaluate(() => window.__authEvent("SIGNED_IN"));
  await new Promise(r => setTimeout(r, 1500));
  await S.evaluate(async () => (await import("/web/backend.js")).pubchat.send("hello plaza"));
  ok(await until(M, () => [...document.querySelectorAll("#pubchat-feed .pub-line")].some(l => l.textContent.includes("hello plaza")), null, 5000),
    "the plaza chat hears sol after INITIAL_SESSION and two more auth events");
  const pubs = await M.evaluate(async () => {
    const { sb } = await import("/web/backend.js");
    return { lines: [...document.querySelectorAll("#pubchat-feed .pub-line")].filter(l => l.textContent.includes("hello plaza")).length, chans: sb.getChannels().filter(c => c.name.startsWith("pubchat")).length };
  });
  ok(pubs.lines === 1 && pubs.chans === 1, `…once, on one channel (${pubs.lines} line(s), ${pubs.chans} channel(s))`);

  // a match thread and a friend thread, reopened (subscribe() drops the old one first)
  await M.evaluate(async () => {
    const { chat, friendChat } = await import("/web/backend.js");
    chat.current = { id: "m-rt" }; chat.subscribe(); chat.unsubscribe(); chat.subscribe();
    friendChat.friendshipId = "fs-rt"; friendChat.subscribe(); friendChat.subscribe();
  });
  await new Promise(r => setTimeout(r, 600));
  await S.evaluate(async () => {
    const { sb } = await import("/web/backend.js");
    await sb.from("messages").insert({ id: "msg-rt", match_id: "m-rt", sender: "u-sol", body: "hey match" });
    await sb.from("friend_messages").insert({ id: "fm-rt", friendship_id: "fs-rt", sender: "u-sol", body: "hey friend" });
  });
  ok(await until(M, async () => (await import("/web/backend.js")).chat.seen.has("msg-rt"), null, 5000), "a match thread reopened hears the next message");
  ok(await until(M, async () => (await import("/web/backend.js")).friendChat.seen.has("fm-rt"), null, 5000), "a friend thread reopened hears the next message");
  await M.evaluate(async () => { const { chat, friendChat } = await import("/web/backend.js"); chat.unsubscribe(); friendChat.unsubscribe(); });

  // the raid lobby's chat: out and straight back in
  await M.evaluate(async () => { const { lobby } = await import("/web/lobby.js"); lobby.onEnter("chill"); lobby.onExit(); lobby.onEnter("chill"); });
  await S.evaluate(async () => { const { lobby } = await import("/web/lobby.js"); lobby.onEnter("chill"); });
  await new Promise(r => setTimeout(r, 900));
  await S.evaluate(() => { document.getElementById("lobby-chat-input").value = "lobby hi"; document.getElementById("lobby-chat-form").requestSubmit(); });
  ok(await until(M, () => [...document.querySelectorAll("#lobby-chat-feed .lc-msg")].filter(l => l.textContent.includes("lobby hi")).length === 1, null, 5000), "the lobby chat, left and re-entered, hears sol (once)");
  await M.evaluate(async () => (await import("/web/lobby.js")).lobby.onExit());
  await S.evaluate(async () => (await import("/web/lobby.js")).lobby.onExit());
  await S.close(); await M.close();
} catch (e) {
  console.error(e); fails++;
} finally {
  for (const e of errors) console.log("  ! " + e);
  if (errors.length) fails++;
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close(); await close();
  process.exit(fails ? 1 : 0);
}
