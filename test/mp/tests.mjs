// The multiplayer tests. Each is async (T) => void, where T carries the
// world, the player count, the run's tag and:
//   T.check(cond, msg)   a check: failed ones fail the test, the run goes on
//   T.need(cond, msg)    a check the rest depends on: fails the test now
//   T.note(msg)          something worth knowing that isn't a failure
//   T.row(id, pass, msg) a sub-result row of its own (each game)
// Test data is marked: every guest is named mpt-<tag>-<name>, chat lines and
// notes start with "[mpt <tag>]", party names say mpt. Each test cleans up
// what a normal client can (its own notes, going hidden); see run.mjs.
import { sleep, Fail, NotImplemented, SPOT, GANGNAM, offset, distM, NAMES } from "./lib.mjs";
import { enterWorld, setVisible, pullRefresh, formParty, allSeeAll, leaveParty, inLobby, moveTo } from "./flows.mjs";
import { GAMES, TITLES, playGame, nextSetIfDone, makePhotos, startGame } from "./games.mjs";

// n phones near each other on one Itaewon block (a few metres apart), named and tagged
const near = i => offset(SPOT, (i % 3) * 4, Math.floor(i / 3) * 4);
async function phones(T, n, { at = near } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await T.w.phone(NAMES[i], { at: at(i) }));
  return out;
}
const handle = (T, ph) => `mpt-${T.tag}-${ph.name}`;
// a few at a time: n software-GL pages booting at once on a small machine time each other out
async function inBatches(list, k, fn) { for (let i = 0; i < list.length; i += k) await Promise.all(list.slice(i, i + k).map(fn)); }
const ids = list => list.map(p => p.id);
const seesAll = async (ph, want) => { const r = new Set((await ph.r(R => R.world.remotes())).map(x => x.userId)); return want.filter(id => !r.has(id)); };

// ================================================================ 1. presence
export async function presence(T) {
  const { n } = T;
  // n ≥ 4: one of them is in another area altogether (Gangnam, ~8 km)
  const farIdx = n >= 4 ? n - 1 : -1;
  const P = await phones(T, n, { at: i => (i === farIdx ? GANGNAM : near(i)) });
  await inBatches(P, 2, ph => enterWorld(ph, handle(T, ph)));
  T.log(`all ${n} on the map`);
  for (const ph of P) await setVisible(ph, true);
  T.log("all visible");
  const zones = await P[0].r(R => R.world.zones());
  // live? (the app re-reads the world every 15 min, or on pull-to-refresh)
  await sleep(12000);
  const live = await seesAll(P[0], ids(P.slice(1)));
  if (live.length) T.note(`not live: ${P[0].name} saw ${n - 1 - live.length}/${n - 1} others before a pull-to-refresh (the world is re-read every 15 min by design)`);
  for (const ph of P) await pullRefresh(ph);
  for (const ph of P) {
    const missing = await seesAll(ph, ids(P.filter(x => x !== ph)));
    T.check(!missing.length, `${ph.name} sees everyone else on the map after a refresh (missing ${missing.map(id => P.find(p => p.id === id)?.name).join(", ") || "none"})`);
  }
  // zone-level positions: everyone shows at a zone's centre, never their own GPS point
  const all = await P[0].r(R => R.world.remotes());
  const zonesNow = await P[0].r(R => R.world.zones());
  for (const ph of P.slice(1)) {
    const r = all.find(x => x.userId === ph.id);
    if (!r) continue;
    const z = zonesNow.find(z => Math.abs(z.lat - r.lat) < 1e-9 && Math.abs(z.lng - r.lng) < 1e-9);
    T.check(!!z, `${ph.name} is shown at a zone's centre (${z?.name ?? `${r.lat},${r.lng}: no zone there`}), not a point of its own`);
    T.check(distM(r, ph.at) > 5, `${ph.name}'s shown position is not their GPS point (${Math.round(distM(r, ph.at))} m off)`);
  }
  const nearOnes = P.filter((_, i) => i !== farIdx).slice(1);
  if (nearOnes.length >= 2) {
    const [a, b] = nearOnes.map(ph => all.find(x => x.userId === ph.id));
    T.check(a && b && a.lat === b.lat && a.lng === b.lng, `two phones a few metres apart share one zone position (${nearOnes[0].name}, ${nearOnes[1].name})`);
  }
  if (farIdx >= 0) {
    const f = all.find(x => x.userId === P[farIdx].id);
    T.check(!!f && distM(f, SPOT) > 3000, `${P[farIdx].name} in Gangnam shows in another area (${f ? Math.round(distM(f, SPOT)) + " m from the block" : "not seen"})`);
    T.check(!!f && distM(f, GANGNAM) > 5 && distM(f, GANGNAM) < 2000, `…at its coarse area cell, not their GPS point (${f ? Math.round(distM(f, GANGNAM)) : "?"} m off)`);
  }
  T.log(`zones: ${zones.length}`);
  // A goes hidden: gone for the others
  const A = P[0];
  await setVisible(A, false);
  for (const ph of P.slice(1)) await pullRefresh(ph);
  for (const ph of P.slice(1)) T.check(!(await ph.r(R => R.world.remotes())).some(x => x.userId === A.id), `${A.name} went hidden: gone from ${ph.name}'s map`);
  // B closes the app: gone for the others too
  if (n >= 2) {
    const B = P[1], rest = P.filter(p => p !== A && p !== B);
    await B.close();
    T.log(`${B.name} closed the app`);
    await sleep(3000);
    const watchers = rest.length ? rest : [A];
    for (const ph of watchers) await pullRefresh(ph);
    for (const ph of watchers) T.check(!(await ph.r(R => R.world.remotes())).some(x => x.userId === B.id), `${B.name} closed the app: gone from ${ph.name}'s map (a closed app that stays on the map is a ghost)`);
  }
  // cleanup: everyone still open goes hidden
  for (const ph of P.filter(p => !p.closed)) await setVisible(ph, false).catch(() => {});
}

// ================================================================ 2. world chat
export async function chat(T) {
  const P = await phones(T, T.n);
  await inBatches(P, 2, ph => enterWorld(ph, handle(T, ph)));
  for (const ph of P) await setVisible(ph, true);   // (speaking needs being visible on the map)
  const [A, ...rest] = P;
  const say = async (ph, text) => { T.need(await ph.r((R, t) => R.chat.send(t), text), `${ph.name}: the chat form is there`); };
  const hears = (ph, text, ms = 15000) => ph.until((R, t) => R.chat.lines().some(l => l.text.includes(t)), text, ms, 250);
  const line = `[mpt ${T.tag}] hi from ${A.name}`;
  const t0 = Date.now();
  await say(A, line);
  const got = await Promise.all(rest.map(ph => hears(ph, line)));
  for (const [i, ph] of rest.entries()) T.check(got[i], `${ph.name} receives ${A.name}'s line in real time${got[i] ? "" : " (not within 15 s)"}`);
  T.log(`delivered to all in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  T.check(await hears(A, line, 8000), `${A.name} sees their own line`);
  const who = await rest[0]?.r((R, t) => R.chat.lines().find(l => l.text.includes(t))?.who, line);
  if (rest[0]) T.check(who === A.handle, `the line is signed with the sender's name (${who})`);
  if (rest.length >= 2) {
    const reply = `[mpt ${T.tag}] ${rest[0].name} back`;
    await say(rest[0], reply);
    const got2 = await Promise.all(P.filter(p => p !== rest[0]).map(ph => hears(ph, reply)));
    T.check(got2.every(Boolean), `a reply from ${rest[0].name} reaches all ${P.length - 1} others`);
  }
  // a hidden player can't speak in the plaza (and isn't heard)
  await setVisible(A, false);
  const hush = `[mpt ${T.tag}] hidden ${A.name}`;
  await say(A, hush);
  T.check(await A.until(() => !!document.querySelector("#pubchat-ask [data-no]"), null, 15000), `${A.name}, hidden, is asked to show themselves first`);
  await A.tap("#pubchat-ask [data-no]");
  await sleep(4000);
  if (rest[0]) T.check(!(await rest[0].r((R, t) => R.chat.lines().some(l => l.text.includes(t)), hush)), "a hidden player's line doesn't reach the plaza");
  for (const ph of P) await setVisible(ph, false).catch(() => {});
  T.note("world chat lines can't be deleted by their sender (no delete policy on public_messages): a deployment run leaves its [mpt …] lines in the table");
}

// ================================================================ 3. hosting and joining
export async function hosting(T) {
  const P = await phones(T, T.n);
  const party = await formParty(T.w, P, P.map(p => handle(T, p)), T.log);
  T.check(/^[A-Z0-9]{4}$/.test(party.code), `${P[0].name} hosts: a 4-character code (${party.code})`);
  T.check(P.length < 2 || party.how.some(h => h.endsWith(":link")), `a friend joins by the invite link (${party.how.join(", ")})`);
  if (P.length >= 3) T.check(party.how.some(h => h.endsWith(":code")), "a friend joins by typing the code");
  else T.note("2 players: one joiner, by the invite link only");
  const bad = await allSeeAll(P);
  T.check(!bad.length, `everyone sees everyone in the lobby (${P.length}): ${bad.join("; ") || "all agree"}`);
  const hosts = await Promise.all(P.map(ph => ph.r(R => R.party()?.hostId)));
  T.check(hosts.every(h => h === P[0].id), "everyone agrees who the host is");
  const names = await Promise.all(P.map(ph => ph.r(R => R.party()?.name)));
  T.check(new Set(names).size === 1, `everyone has the party's name (${names[0]})`);
  T.party = party;
}

// ================================================================ 4. playing the games
export async function games(T) {
  const P = await phones(T, T.n);
  // 2 players: every game needs 3, so the host's phone adds one bot (?bots=1, the app's own dev seat)
  if (T.n < 3) { T.w.hostQuery = { bots: 1 }; T.note("2 players: + 1 bot on the host's phone (?bots=1): every game needs 3"); }
  await formParty(T.w, P, P.map(p => handle(T, p)), T.log);
  { const bad = await allSeeAll(P); T.need(!bad.length, `everyone is in the lobby${bad.length ? `: ${bad.join("; ")}` : ""}`); }
  const photos = await makePhotos(P[0], `${T.w.out}/tmp/photos-${T.tag}`);
  const list = T.opts.games ?? GAMES;
  for (const g of list) {
    const id = `game:${g}`;
    if (g === "manhunt") { T.row(id, null, "not driven: Manhunt needs a zone drawn on the live map and simulated walking (test/manhunt_rec.mjs covers it)"); continue; }
    try {
      await nextSetIfDone(P[0], T.log);
      const seen = await playGame(g, P, { log: T.log, ctx: { photoFiles: photos }, maxMs: (T.opts.gameMin ?? 14) * 60000, onTick: syncWatch(T, P) });
      const fails = [];
      if (!seen.ended) fails.push(`didn't end within ${T.opts.gameMin ?? 14} min (last ${seen.phases.slice(-1)[0]})`);
      if (!seen.endedEverywhere) fails.push(`not everyone got back to the lobby (${seen.notBack.join(", ")})`);
      const humans = P.filter(p => !p.dropped).map(p => p.id);
      if (["sidequest", "mask_off", "ritual"].includes(g)) {
        const subj = new Set(seen.subjects);
        const missed = humans.filter(id => !subj.has(id));
        if (missed.length) fails.push(`turns didn't reach everyone (no turn for ${missed.map(id => P.find(p => p.id === id)?.name).join(", ")})`);
        if (seen.subjects.length > 1 && seen.subjects.every(x => x === seen.subjects[0])) fails.push("the turn never moved on");
      }
      const scores = seen.scores ?? {};
      if (!Object.values(scores).some(v => v > 0)) fails.push(`no score moved (${JSON.stringify(scores)})`);
      const recorded = seen.sets.filter(s => s?.games?.some(x => x.game === g || x.game === TITLES[g]));
      if (seen.ended && recorded.length !== seen.sets.length) fails.push(`the set's leaderboard has it on ${recorded.length}/${seen.sets.length} phones`);
      if (seen.errors.length) fails.push(`game errors: ${seen.errors.slice(0, 3).join(" | ")}`);
      const lag = T._lag?.[g];
      if (lag) fails.push(lag);
      T.row(id, !fails.length, fails.join("; ") || `${seen.turns} steps, ${Math.round(seen.ms / 1000)} s, scores ${Object.values(scores).join("/")}`);
      if (!seen.ended) await endGame(P[0], T);
    } catch (e) {
      T.row(id, false, e.message);
      await endGame(P[0], T).catch(() => {});
    }
  }
}
// a guest's phase trailing the host's for long = out of sync
function syncWatch(T, P) {
  const behind = {};
  return async (hs, host) => {
    const g = await host.r(R => R.party()?.playing).catch(() => null);
    for (const ph of P.filter(p => p !== host && !p.dropped && !p.closed)) {
      const s = await ph.r(R => { const g = R.game(); return g ? `${g.phase}:${g.ti}` : null; }).catch(() => null);
      const k = `${hs.phase}:${hs.ti ?? null}`;
      if (s && s !== k) { behind[ph.name] = (behind[ph.name] ?? 0) + 1; if (behind[ph.name] === 12) (T._lag ??= {})[g] = `${ph.name} out of sync with the host for ~10 s (host ${k}, ${ph.name} ${s})`; }
      else behind[ph.name] = 0;
    }
  };
}
async function endGame(H, T) {
  if (!(await H.r(R => R.party()?.launched))) return;
  await H.tap("#hp-end"); await sleep(500); await H.tap("#hp-ask-yes");
  await H.until(R => !R.party()?.launched, null, 20000);
  T.log("the host ended the game to move on");
}

// ================================================================ 5. host controls
export async function hostcontrols(T) {
  const P = await phones(T, T.n);
  if (T.n < 3) T.w.hostQuery = { bots: 1 };
  await formParty(T.w, P, P.map(p => handle(T, p)), T.log);
  const H = P[0];
  await startGame(H, "sidequest");
  await H.until(R => R.game()?.phase === "setup", null, 30000);
  await H.tap("#sq-go");
  T.need(await H.until(R => ["spin", "quest", "do", "howto"].includes(R.game()?.phase), null, 40000), "Side Quest is under way");
  // through how-to-play, to a turn
  for (const ph of P) await ph.r(R => R.input("howto-ok"));
  await H.until(R => ["quest", "do"].includes(R.game()?.phase), null, 40000);
  const problems = [];
  // ---- pause / resume
  const controls = await H.r(R => R.hostControls());
  T.log(`host controls mid-game: ${controls.join(", ")}`);
  const pause = controls.find(c => /pause/.test(c));
  if (!pause) problems.push(new NotImplemented(`no pause / resume for the host mid-game (looked for #hp-pause or [data-testid=host-pause]; the host has: ${controls.join(", ")})`));
  else {
    await H.tap(`#${pause}`);
    const paused = await Promise.all(P.map(ph => ph.until(R => R.game()?.paused && !!document.getElementById("hp-paused"), null, 10000)));
    T.check(paused.every(Boolean), `pause reaches every phone, the paused sheet on each (${paused.filter(Boolean).length}/${P.length})`);
    const l0 = await H.r(R => R.game()?.left); await sleep(4000); const l1 = await H.r(R => R.game()?.left);
    T.check(Math.abs(l0 - l1) < 200, `the clock stands still while paused (${Math.round(l0)} -> ${Math.round(l1)} ms left)`);
    // ---- kicking a player mid-game (from the host's paused sheet)
    const X = P.length >= 2 ? P[P.length - 1] : null;
    if (X) {
      const kick = await H.r((R, id) => { const el = document.querySelector(`[data-kick="${id}"]`); el?.click(); return !!el; }, X.id);
      if (!kick) problems.push(new NotImplemented(`no way for the host to remove a player mid-game (looked for [data-kick] on the paused sheet)`));
      else {
        T.check(await X.until(R => !R.party() && R.screen().map, null, 40000), `${X.name} is removed: out of the party, on the map`);
        X.closed = true;      // (out of the game: the drivers leave it be)
        const gone = await Promise.all(P.filter(p => p !== X).map(ph => ph.until((R, id) => !R.party()?.members.some(m => m.id === id), X.id, 20000)));
        T.check(gone.every(Boolean), "…gone from everyone's party");
      }
    }
    await H.tap("#hp-resume");
    const live = P.filter(p => !p.closed);
    const resumed = await Promise.all(live.map(ph => ph.until(R => R.game() && !R.game().paused && !document.getElementById("hp-paused"), null, 10000)));
    T.check(resumed.every(Boolean), "resume reaches every phone");
    // the game goes on: the turn ends (everyone left rates) and the next one starts
    const k0 = await H.r(R => R.game()?.ti);
    let moved = false;
    for (let i = 0; i < 60 && !moved; i++) {
      for (const ph of live) await ph.r(R => { const g = R.game(); if (g?.phase === "do" && g.turn?.who !== R.me().id) R.input("rate", { v: 4 }); });
      moved = (await H.r(R => R.game()?.ti)) !== k0;
      if (!moved) await sleep(1500);
    }
    T.check(moved, "the game keeps going after the resume (and without whoever was removed)");
  }
  if (problems.length) { const e = new NotImplemented(problems.map(p => p.message.replace(/^not implemented: /, "")).join(" · ")); throw e; }
}

// ================================================================ 6. leaving
export async function leaving(T) {
  const P = await phones(T, T.n);
  await formParty(T.w, P, P.map(p => handle(T, p)), T.log);
  { const bad = await allSeeAll(P); T.need(!bad.length, `everyone is in the lobby${bad.length ? `: ${bad.join("; ")}` : ""}`); }
  const X = P[P.length - 1], rest = P.filter(p => p !== X);
  await leaveParty(X);
  const out = await X.until(R => { const s = R.screen(); return !R.party() && s.map && !s.onboarding && !s.lobby; }, null, 40000);
  const where = await X.r(R => ({ screen: R.screen(), party: !!R.party() }));
  T.check(out, `${X.name} lands on the explore map (${JSON.stringify(where.screen)})`);
  T.check(!where.screen.onboarding, `…not the home / start screen (${where.screen.onboarding ?? "none"})`);
  const seen = await Promise.all(rest.map(ph => ph.until((R, id) => { const p = R.party(); return p && !p.members.some(m => m.id === id) && !p.inRoom.includes(id); }, X.id, 30000)));
  for (const [i, ph] of rest.entries()) T.check(seen[i], `${ph.name} sees ${X.name} leave (the members and the room)`);
  // with 3+: the host leaves too: the next one is host, nobody's stuck
  if (rest.length >= 3) {
    const H = rest[0], left = rest.slice(1);
    await leaveParty(H);
    T.check(await H.until(R => !R.party() && R.screen().map, null, 40000), `the host (${H.name}) leaves: on the map too`);
    const newHost = await Promise.all(left.map(ph => ph.until(R => R.party()?.hostId, null, 20000)));
    T.check(new Set(newHost).size === 1 && newHost[0] === left[0].id, `the next to have joined (${left[0].name}) is host for everyone`);
  }
}

// ================================================================ 7. notes
export async function notes(T) {
  const { n } = T;
  // A leaves it; the near ones are within a few metres; the far ones > 1 km away
  const nearN = Math.max(1, Math.ceil((n - 1) / 2));
  const far = i => offset(SPOT, 1100 + i * 30, 300);
  const P = await phones(T, n, { at: i => (i === 0 ? SPOT : i <= nearN && n > 2 ? near(i) : i <= nearN ? near(1) : far(i)) });
  await inBatches(P, 2, ph => enterWorld(ph, handle(T, ph)));
  const A = P[0];
  const text = `[mpt ${T.tag}] note from ${A.name}`;
  await A.tap("#notes-leave");
  T.need(await A.until(() => !!document.querySelector(".note-compose .ns-text"), null, 60000), `${A.name}: Leave a note opens the composer (${await A.r(async R => R.notes.step())})`);
  await A.page.evaluate(t => { const i = document.querySelector(".note-compose .ns-text"); i.value = t; i.dispatchEvent(new Event("input", { bubbles: true })); }, text);
  await sleep(500);
  await A.tap(".note-compose .ns-post");
  T.need(await A.until(() => !document.querySelector(".note-compose"), null, 30000), `${A.name} posts the note (${await A.page.evaluate(() => document.querySelector(".ns-err")?.textContent ?? "").catch(() => "")})`);
  const mine = await A.until(async R => (await R.notes.markers()).find(m => m.mine), null, 20000);
  T.need(!!mine, `${A.name}'s note is on their map`);
  T.log(`note ${mine.id}`);
  const open = async (ph) => {
    await ph.r(R => R.draw(true));
    try { return await openIt(ph); } finally { if (T.w.pauseIdle) await ph.r(R => R.draw(false)).catch(() => {}); }
  };
  const openIt = async (ph) => {
    await ph.r((R, s) => R.lookAt(s.lat, s.lng, 110), SPOT);
    await sleep(1500);
    await ph.r(R => R.notes.refresh());
    const m = await ph.until(async (R, id) => (await R.notes.markers()).find(m => m.id === id), mine.id, 25000);
    if (!m) return { marker: false };
    const pin = await ph.until((R, id) => R.notes.pin(id), mine.id, 10000);
    await ph.page.evaluate(() => document.querySelectorAll(".glass-toast").forEach(t => t.remove()));
    if (pin) await ph.page.mouse.click(pin.x, pin.y); else await ph.tap(`.note-pin[data-id="${mine.id}"]`);
    // the card, or a toast saying why not (a toast lasts ~2.6 s: read it while it's up)
    const got = await ph.until(() => { const c = document.querySelector(".note-open .nc-text")?.textContent; const t = [...document.querySelectorAll(".glass-toast")].map(t => t.textContent).join(" | "); return c || t ? { c: c ?? null, t } : null; }, null, 12000, 150);
    const card = got?.c ?? null, toast = got?.t ?? "";
    await ph.tap(".note-open .nc-x");
    return { marker: true, card, toast, near: m.near };
  };
  for (const ph of P.slice(1)) {
    const isFar = distM(ph.at, SPOT) > 500;
    const r = await open(ph);
    T.check(r.marker, `${ph.name} (${isFar ? "far, " : "near, "}${Math.round(distM(ph.at, SPOT))} m) sees the note's marker`);
    if (!r.marker) continue;
    if (isFar) T.check(!r.card && /closer/i.test(r.toast), `…but can't open it from there ("${r.toast || "no message"}")`);
    else T.check(r.card?.includes(text), `…and opens it: "${(r.card ?? "nothing").slice(0, 60)}"`);
  }
  // 2 players: B walks away (> 1 km) and tries again
  if (n === 2) {
    const B = P[1];
    await moveTo(B, offset(SPOT, 1200, 300));
    await sleep(4000);
    const r = await open(B);
    T.check(r.marker && !r.card && /closer/i.test(r.toast), `${B.name} walks 1.2 km away: still sees the marker, can't open it ("${r.toast || "no message"}")`);
    T.note("2 players: the far check is the same phone after walking 1.2 km");
  }
  // cleanup: the author takes it down (remove_my_note)
  const removed = await A.r(async R => R.notes.removeMine());
  T.log(`cleanup: removed ${removed} note(s)`);
  T.check(removed >= 1, "the test's note is removed by its author afterwards");
}

// ================================================================ 8. disconnects
export async function disconnect(T) {
  const P = await phones(T, T.n);
  if (T.n < 3) { T.w.hostQuery = { bots: 1 }; T.note("2 players: + 1 bot on the host's phone"); }
  await formParty(T.w, P, P.map(p => handle(T, p)), T.log);
  { const bad = await allSeeAll(P); T.need(!bad.length, `everyone is in the lobby${bad.length ? `: ${bad.join("; ")}` : ""}`); }
  const H = P[0];
  // a guest's network dies (no goodbye) just before a turn they have to rate:
  // everyone else rates at once, so the turn can only end by giving up on them
  const X = P[P.length - 1];
  let droppedTi = null, overAfter = null, nextAfter = null;
  const seen = await playGame("sidequest", P, {
    log: T.log, maxMs: 14 * 60000,
    onTick: async (hs) => {
      const t = hs.turn;
      if (!X.dropped && ["spin", "quest"].includes(hs.phase) && t && t.who !== X.id) {
        droppedTi = hs.ti; await T.w.drop(X); T.log(`${X.name} drops (turn ${hs.ti}, ${hs.phase}; ${t.who === H.id ? H.name : t.who} is up)`);
      }
      if (X.dropped && overAfter === null && hs.ti === droppedTi && hs.phase === "result") {
        overAfter = (Date.now() - X.droppedAt) / 1000;
        T.log(`turn ${droppedTi} over ${overAfter.toFixed(1)} s after the drop (status ${hs.turn?.status}, ${hs.turn?.n} ratings)`);
      }
      if (X.dropped && nextAfter === null && hs.ti > droppedTi) nextAfter = (Date.now() - X.droppedAt) / 1000;
    },
  });
  T.need(X.dropped, `${X.name} dropped out of a turn someone else was on`);
  const want = T.opts.skipS ?? 30;
  T.check(overAfter !== null && overAfter <= want + 15, `the game stops waiting for ${X.name} within ~${want} s (${overAfter === null ? "never" : overAfter.toFixed(1) + " s"}; the server notices a dead socket only after ${Math.round(T.w.presenceTimeoutMs / 1000)} s here)`);
  T.check(nextAfter !== null, `the game moves on to the next turn (${nextAfter === null ? "never" : nextAfter.toFixed(1) + " s after the drop"})`);
  T.check(seen.ended && seen.endedEverywhere, `the game still ends for everyone left (${seen.ended ? "ended" : "didn't end"}${seen.notBack?.length ? `; stuck: ${seen.notBack.join(", ")}` : ""})`);
}

export const TESTS = { presence, chat, hosting, games, hostcontrols, leaving, notes, disconnect };
