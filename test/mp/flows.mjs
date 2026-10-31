// How a person gets somewhere in the app, through its real screens: open the
// link, the start screen, the setup card (a first open: a name, a look), Explore
// the world / Start a party / Join a party / an invite link, the lobby.
import { sleep, Fail } from "./lib.mjs";

// the app's address for a phone. Its location: the context's geolocation (Playwright), and,
// unless --real-gps, the app's own ?devlat=&devlng= override too (AGENTS.md: "lets any of them be
// tested without GPS"): on a starved test machine the page can be too busy to answer the
// geolocation call inside the app's 10 s timeout ("Timeout expired")
export const appUrl = (w, ph = null, extra = {}) => {
  const u = new URL(w.offline ? `${w.base}/app.html` : `${w.base}/`);
  if (ph && !w.realGps) { u.searchParams.set("devlat", ph.at.lat); u.searchParams.set("devlng", ph.at.lng); }
  for (const [k, v] of Object.entries({ ...(w.query ?? {}), ...extra })) u.searchParams.set(k, v);
  return u.href;
};
// a phone walks somewhere else
export async function moveTo(ph, at) {
  ph.at = at;
  await ph.ctx.setGeolocation({ latitude: at.lat, longitude: at.lng, accuracy: 10 });
  if (!ph.world.realGps) await ph.page.evaluate(p => { const u = new URL(location.href); u.searchParams.set("devlat", p.lat); u.searchParams.set("devlng", p.lng); history.replaceState(history.state, "", u); }, at);
}

const onStart = ph => ph.until(() => { const s = document.querySelector(".onb-screen:not(.out)"); return s?.dataset.screen === "start" && !!document.querySelector(".st-panel [data-start], .st-panel [data-setup], .st-panel .st-invite") && !!window.__rando; }, null, 300000 * (ph.world.slow ?? 1), 500);

export async function boot(ph, url = null) {
  await ph.open(url ?? appUrl(ph.world, ph));
  if (!(await onStart(ph))) throw new Fail(`${ph.name}: the start screen never came up`);
  ph.world.log(`${ph.name}: the start screen`);
  await sleep(800);
}

// the setup card (a first open): type the name over the suggested one, Let's go
export async function setupCard(ph, handle) {
  const up = await ph.until(() => !!document.querySelector(".st-panel [data-setup] #su-name"), null, 60000);
  if (!up) return false;
  // (the card can redraw while it settles, which resets a half-typed field: type, then check it took)
  for (let i = 0; i < 5; i++) {
    await ph.page.evaluate(() => { const i = document.querySelector("#su-name"); if (!i) return; i.focus(); i.select(); });
    await ph.page.keyboard.type(handle, { delay: 15 });
    await sleep(600);
    if (await ph.page.evaluate(h => document.querySelector("#su-name")?.value === h, handle)) break;
  }
  await ph.tap(".st-panel [data-go]");
  ph.world.log(`${ph.name}: setup card -> ${handle}`);
  return true;
}

export async function enterWorld(ph, handle) {
  await boot(ph);
  await ph.tap(".st-panel [data-explore]");
  await setupCard(ph, handle);
  const ok = await ph.until(R => R.signedIn() && R.screen().map, null, 360000 * (ph.world.slow ?? 1), 1000);
  if (!ok) throw new Fail(`${ph.name}: Explore the world never reached the map (${JSON.stringify(await ph.r(R => R.screen()).catch(e => e.message))})`);
  const me = await ph.r(R => R.me());
  ph.id = me.id; ph.handle = me.handle;
  ph.world.log(`${ph.name}: on the map (${me.id})`);
  // (offline on one machine: the map stops drawing until a test needs to look at it; its state runs on)
  if (ph.world.pauseIdle) await ph.r(R => R.draw(false)).catch(() => {});
  return me;
}

// the bar's left button: hidden -> visible on the map (and back)
export async function setVisible(ph, on) {
  const slow = ph.world.slow ?? 1;
  for (let i = 0; i < 2; i++) {
    const now = !!(await ph.r(R => R.world.visible()));
    if (now === on) return;
    // (the button is disabled while a tap is still going through: wait for it, don't tap twice)
    if (!(await ph.page.evaluate(() => document.getElementById("nav-explore")?.disabled))) await ph.r(R => R.world.toggle());
    if (await ph.until((R, on) => !!R.world.visible() === on, on, 90000 * slow, 1000)) return;
  }
  throw new Fail(`${ph.name}: couldn't go ${on ? "visible" : "hidden"} (${await ph.page.evaluate(() => document.getElementById("zone-name")?.textContent).catch(() => "?")})`);
}

// pull the bar down to refresh (the app's own gesture)
export async function pullRefresh(ph) {
  const b = await ph.page.evaluate(() => { const r = document.getElementById("navbar")?.getBoundingClientRect(); return r && r.height ? { x: r.left + r.width * 0.5, y: r.top + 6 } : null; });
  if (!b) { await ph.r(R => R.world.refresh()); return; }
  await ph.page.mouse.move(b.x, b.y);
  await ph.page.mouse.down();
  for (let i = 1; i <= 6; i++) { await ph.page.mouse.move(b.x, b.y + i * 10); await sleep(30); }
  await ph.page.mouse.up();
  await sleep(1500);
}

export const inLobby = (ph, ms = 300000 * (ph.world.slow ?? 1)) => ph.until(R => { const s = R.screen(), p = R.party(); return s.lobby && !s.onboarding && !!p; }, null, ms, 500);

// Start a party from the start screen; returns { code, link } from the invite sheet
export async function hostParty(ph, handle) {
  await boot(ph, appUrl(ph.world, ph, ph.world.hostQuery ?? {}));
  await ph.tap(".st-panel [data-start]");
  await setupCard(ph, handle);
  if (!(await inLobby(ph))) throw new Fail(`${ph.name}: Start a party never reached the lobby`);
  const inv = await ph.until(() => { const b = document.querySelector('.onb-sheet[data-sheet="invite"] [data-share]'); return b ? { link: b.dataset.link, code: [...document.querySelectorAll(".onb-inv-code span")].map(s => s.textContent).join("") } : null; }, null, 20000);
  if (!inv) throw new Fail(`${ph.name}: no invite sheet after starting the party`);
  await ph.tap('.onb-sheet[data-sheet="invite"] [data-close]');
  const me = await ph.r(R => R.me());
  ph.id = me.id; ph.handle = me.handle;
  return inv;
}

// Join a party from the start screen with the code
export async function joinByCode(ph, handle, code) {
  await boot(ph);
  await ph.tap(".st-panel [data-join]");
  if (!(await ph.until(() => !!document.querySelector("#st-code input"), null, 10000))) throw new Fail(`${ph.name}: Join a party has no code field`);
  await ph.page.evaluate(() => document.querySelector("#st-code input").focus());
  await ph.page.keyboard.type(code, { delay: 20 });
  await ph.page.evaluate(() => document.querySelector("#st-code").requestSubmit());
  await setupCard(ph, handle);
  if (!(await inLobby(ph))) throw new Fail(`${ph.name}: joining with the code never reached the lobby (${await ph.page.evaluate(() => document.querySelector(".st-panel")?.innerText.slice(0, 120)).catch(() => "?")})`);
  const me = await ph.r(R => R.me());
  ph.id = me.id; ph.handle = me.handle;
}

// Join a party from the invite link the host shared (the link's own page, then the app)
export async function joinByLink(ph, handle, link) {
  // (the link names the deployment it was made on; offline that's this same server)
  await ph.open(link);
  if (!(await onStart(ph))) throw new Fail(`${ph.name}: the invite link never reached the start screen`);
  await setupCard(ph, handle);
  if (!(await inLobby(ph))) throw new Fail(`${ph.name}: the invite link never reached the lobby`);
  const me = await ph.r(R => R.me());
  ph.id = me.id; ph.handle = me.handle;
}

// a whole party: the first phone hosts, the rest join (alternately by link and by code)
export async function formParty(w, phones, handles, log) {
  const [H, ...rest] = phones;
  const inv = await hostParty(H, handles[0]);
  log(`${H.name} hosts ${inv.code} (${inv.link})`);
  const how = [];
  for (const [i, ph] of rest.entries()) {
    const byLink = i % 2 === 0;
    if (byLink) await joinByLink(ph, handles[i + 1], inv.link); else await joinByCode(ph, handles[i + 1], inv.code);
    how.push(`${ph.name}:${byLink ? "link" : "code"}`);
    log(`${ph.name} joined by ${byLink ? "link" : "code"}`);
  }
  return { ...inv, how };
}

// everyone sees everyone (the members list and the room's characters)
export async function allSeeAll(phones, ms = 40000) {
  const ids = phones.map(p => p.id).sort();
  const res = await Promise.all(phones.map(ph => ph.until((R, ids) => { const p = R.party(); if (!p) return false; const m = p.members.map(x => x.id).sort(), r = p.inRoom.filter(id => !/^bot-/.test(id)).sort(); return JSON.stringify(m) === JSON.stringify(ids) && JSON.stringify(r) === JSON.stringify(ids); }, ids, ms)));
  const bad = [];
  for (const [i, ok] of res.entries()) if (!ok) bad.push(`${phones[i].name} sees ${JSON.stringify(await phones[i].r(R => { const p = R.party(); return p ? { members: p.members.map(m => m.handle), room: p.inRoom } : null; }).catch(e => e.message))}`);
  return bad;
}

// leave through the lobby's back button -> "Leave the party?" -> Leave
export async function leaveParty(ph) {
  await ph.tap("#pt-back");
  if (!(await ph.until(() => !!document.querySelector(".pt-confirm [data-yes]"), null, 8000))) throw new Fail(`${ph.name}: no "Leave the party?" after back`);
  await sleep(400);
  await ph.tap(".pt-confirm [data-yes]");
}
