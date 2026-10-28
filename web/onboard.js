// First open -> playing with friends in under a minute. Everything here is a
// layer over the map (#onb), in English or Korean (i18n.js):
//
//   Every open: the start screen, our 3D Itaewon at night drifting behind
//     one glass panel (scenery.js): the logo, Start a party, Join a party
//     (a code, friends' parties, the map), Explore the world. Either one
//     ends in the camera diving from the sky into the party's building,
//     then the lobby. A first open sets up a name and a character on the
//     way (a guest): the setup card, the same panel with its insides
//     swapped (the character on a small stage in 3D or as the room's 2D
//     sprite, Randomize, one tap per essential, a random name to keep or
//     replace, Let's go: ~10 seconds, nothing to read). A returning player
//     (a real name and a character) goes straight in; the panel shows their
//     chip on top, and tapping it opens the same card to edit.
//   An invite link (?party=CODE, or /p/CODE via api/invite.mjs): the same
//     screen with the party's name instead of the buttons, then (the setup
//     card ->) the same dive straight into its lobby and a "you're in!"
//     moment. The code is kept on the phone until they're in, so a reload,
//     a sign-in or an interrupted install comes back to the same party. An
//     ended or full party says so and offers the buttons.
//   Home (the "you" button): your character, Style, friends' parties,
//     what's new.
//
// Accounts: everyone is a guest first (no phone, no email), kept on this
// phone. "Save your account" links Kakao / Apple / Google to that same
// account (after the first party's recap, in Settings, and "Already have an
// account? Sign in" for a new phone). Phone verification only for the
// stranger features: making a party public, joining public parties, adding
// friends, earning and spending coins (a Kakao account counts).
//
// Later moments, each once: the invite sheet when you throw a party, permissions with a pre-prompt
// (permissions.js), a one-tap safety card before the first game, a game's
// host saying what to do the first time you play it, one-time hints, and the
// first party's recap (share it, throw your own).
//
// backend.js hands in what needs the server (onboard.start(env)):
//   env.profile() -> { handle, avatar | null } · env.saveName(name) ·
//   env.saveAvatar(look) · env.openMap() · env.openStyle() · env.account
//   ({ providers, user, linked, isGuest, link, signIn }) · env.verify
//   ({ available, sms, isVerified, phone, send, confirm, signInSend, signInConfirm })
//   · env.friendParties() -> [{ id, name, hostName, count }]
import { t, lang, setLang, onLang, suggestName } from "./i18n.js";
import { track, trackOnce, sinceFirstOpen } from "./analytics.js";
import { askPermission, prePrompt, permState, toast } from "./permissions.js";
import { starterLook, e164, otpWait, otpError, needsSetup, AUTO_HANDLE, ESSENTIALS, cycleLook } from "./onbkit.js";
import { mountCharView, mountLookView } from "./charview.js";
import { renderLook, warmLooks } from "./charrender.js";
import { spriteFor, silhouetteFor, SPRITE } from "./charsprite.js";
import { normalizeAvatar4 } from "./items4.js";
import { qrSvg } from "./qr.js";
import { sfx, buzz } from "./fx.js";
import { esc } from "./hpkit.js";
import { peekRoom } from "./net.js";
import { party } from "./party.js";
import { world3d } from "./world3d.js";
import { scenery } from "./scenery.js";

const params = new URLSearchParams(location.search);
// ?onb=0: no onboarding at all (the older real-page tests, which start on the map)
const OFF = params.get("onb") === "0";
const KEY = "rando-onb-v1";
const PENDING_MS = 12 * 60 * 60 * 1000;      // an invite kept on the phone this long
const $ = id => document.getElementById(id);

// what's new (Home shows each until it's tapped away)
const WHATS_NEW = [
  { id: "manhunt-1", en: "New game: Manhunt, on the real streets", ko: "새 게임: 맨헌트, 진짜 거리에서" },
  { id: "outfits-1", en: "New outfits in Style", ko: "스타일에 새 옷이 나왔어요" },
];

// ---- what this phone remembers
function load() { try { return { hints: {}, played: {}, seenNew: [], ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { hints: {}, played: {}, seenNew: [] }; } }
const st = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

let env = null, root = null, screen = null, homeView = null, pending = null;
let canSignIn = false;     // this server offers a sign-in (Kakao / Apple / Google / phone): the name screen says so

export const onboard = {
  get state() { return st; },
  // party.js asks while it starts: an invite link is ours to show first
  holdInvite(code) {
    if (OFF) return false;
    code = String(code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return false;
    pending = { code, name: params.get("n") ?? "", count: +params.get("c") || 0, at: Date.now() };
    st.pending = pending; save();
    return true;
  },

  start(e) {
    env = e;
    root = OFF ? null : $("onb");
    if (!root) return;
    onLang(() => { if (screen?.redraw) screen.redraw(); });
    Promise.all([env.account?.providers?.().catch(() => []) ?? [], env.verify?.sms?.().catch(() => false)]).then(([p, sms]) => {
      canSignIn = p.length > 0 || !!sms;
      if (canSignIn && screen?.id === "name") screen.redraw?.();
    });
    // back from Kakao / Apple / Google: say how it went, and go back into the party they were in
    const back = this._back();
    if (back) {
      setTimeout(() => this._afterOAuth(back), 900);
      if (back.party && !needsSetup(env.profile())) {
        if (pending?.code === back.party) clearPending();
        hide(); party.togglePanel(true);
        party.joinByCode(back.party);
        return;
      }
    }
    // a code kept from an earlier open (reload, sign-in, install) still counts
    if (!pending && st.pending && Date.now() - st.pending.at < PENDING_MS) pending = st.pending;
    const source = pending ? "invite_link" : "organic";
    track("app_open", { source, returning: !!st.done });
    if (pending) { track("party_link_opened"); return this.startScreen({ invite: pending }); }
    if (params.get("home") === "0") { unboot(); return; }
    this.startScreen();
  },

  // ================================================================ the start screen
  // Every open: our night city drifting behind one glass panel (scenery.js):
  // the logo, Start a party, Join a party. An invite link skips the buttons
  // and goes straight in. Starting or joining ends in the dive from the sky
  // into the party's building, then the lobby.
  startScreen({ invite = null, view = "main", err = "" } = {}) {
    if (!env || !root) return;
    unboot();
    scenery.on();
    let mode = invite ? "invite" : view, info = null, looking = !!invite, msg = err;
    const panel = () => {
      const friends = env.friendParties?.() ?? [];
      const logo = `<div class="st-logo">rando</div>`;
      const p = env.profile();
      // a returning player's chip: their room sprite and name; tap to edit
      const chip = !needsSetup(p) ? `<button type="button" class="st-me" data-me-chip aria-label="${esc(t("setup.edit"))}"><i class="st-me-av" id="st-me-av"></i><b>${esc(p.handle)}</b><span aria-hidden="true">✎</span></button>` : "";
      if (mode === "setup" && this._su) {
        const su = this._su;
        return `${su.edit ? `<button type="button" class="st-back" data-back>‹ ${esc(t("start.back"))}</button>` : ""}
          <div class="su" data-setup>
            <div class="su-stage" id="su-stage"><button type="button" class="glass-btn clear su-random" data-random><span class="onb-dice" aria-hidden="true">🎲</span>${esc(t("setup.random"))}</button></div>
            <div class="su-cyc">${ESSENTIALS.map(k => `<button type="button" class="su-chip" data-cycle="${k}"><span>${esc(t(`setup.${k}`))}</span><i aria-hidden="true">›</i></button>`).join("")}</div>
            <input id="su-name" class="glass-field su-name" maxlength="20" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" placeholder="${esc(t("setup.name"))}" aria-label="${esc(t("setup.name"))}" value="${esc(su.name)}">
            <p class="onb-err" id="su-err"></p>
            <button type="button" class="glass-btn gold" data-go>${esc(t(su.edit ? "setup.save" : "setup.go"))}</button>
            ${canSignIn && !su.edit ? `<button type="button" class="st-explore su-have" data-have>${esc(t("acct.haveOne"))}</button>` : ""}
          </div>`;
      }
      if (mode === "invite") {
        const name = info?.name || invite.name || (info?.hostName ? t("land.party", { host: info.hostName }) : "");
        const gone = !looking && !info, full = !!info && info.count >= (info.cap ?? 99);
        if (gone || full) return `${logo}
          <div class="st-invite"><small>${esc(t("land.invited"))}</small><b>${esc(t(gone ? "land.gone" : "land.full"))}</b>${gone ? `<span>${esc(t("land.goneSub"))}</span>` : ""}</div>
          <button type="button" class="glass-btn gold" data-start>${esc(t("start.start"))}</button>
          <button type="button" class="glass-btn clear" data-join>${esc(t("start.join"))}</button>`;
        return `${logo}
          <div class="st-invite"><small>${esc(t("land.invited"))}</small><b>${esc(name || "…")}</b><span>${esc(t(looking ? "land.looking" : "start.joining"))}</span></div>
          <div class="st-spin" aria-hidden="true"></div>`;
      }
      if (mode.startsWith("busy")) return `${logo}<div class="st-invite"><span>${esc(t(mode === "busy-start" ? "start.starting" : "start.joining"))}</span></div><div class="st-spin" aria-hidden="true"></div>`;
      if (mode === "join") return `
        <button type="button" class="st-back" data-back>‹ ${esc(t("start.back"))}</button>
        <span class="st-sub">${esc(t("start.code"))}</span>
        <form class="st-code" id="st-code"><input maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="ABCD" aria-label="${esc(t("start.code"))}"><button class="glass-btn gold sm">${esc(t("home.codeJoin"))}</button></form>
        <p class="onb-err" id="st-err">${esc(msg)}</p>
        ${friends.length ? `<span class="st-sub">${esc(t("home.friends"))}</span>${friends.map(f => `<div class="st-fp"><b>${esc(f.name)}</b><span>${esc(t("land.inside", { n: f.count }))}</span><button type="button" class="glass-btn clear sm" data-fjoin="${esc(f.id)}">${esc(t("home.join"))}</button></div>`).join("")}` : ""}
        <button type="button" class="glass-btn clear sm" data-nearby>${esc(t("home.nearby"))}</button>`;
      return `${chip}${logo}<p class="st-line">${esc(t("start.tag"))}</p>
        <button type="button" class="glass-btn gold" data-start>${esc(t("start.start"))}</button>
        <button type="button" class="glass-btn clear" data-join>${esc(t("start.join"))}</button>
        <button type="button" class="st-explore" data-explore><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 3.8 6.6v12.9L9 17.4l6 2.1 5.2-2.1V4.5L15 6.6z"/><path d="M9 4.5v12.9M15 6.6v12.9"/></svg>${esc(t("start.explore"))}</button>
        <p class="onb-err">${esc(msg)}</p>`;
    };
    const bindPanel = el => {
      const pn = el.querySelector(".st-panel");
      pn.dataset.view = mode;
      const av = pn.querySelector("#st-me-av");
      if (av) av.appendChild(faceTile(env.profile().avatar));
      pn.querySelector("[data-me-chip]")?.addEventListener("click", async () => {
        sfx.open?.(); buzz(8);
        await this.setup({ edit: true });
        if (screen?.id === "start" && mode === "setup") { mode = "main"; redraw(); }
      });
      if (mode === "setup" && this._su) this._bindSetup(pn);
      pn.querySelector("[data-start]")?.addEventListener("click", () => { sfx.confirm?.(); buzz(15); clearPending(); this.go("start"); });
      pn.querySelector("[data-join]")?.addEventListener("click", () => { sfx.cursor?.(); clearPending(); mode = "join"; msg = ""; redraw(); setTimeout(() => pn.querySelector("#st-code input")?.focus(), 60); });
      pn.querySelector("[data-back]")?.addEventListener("click", () => { sfx.back?.(); mode = "main"; msg = ""; redraw(); });
      pn.querySelector("[data-nearby]")?.addEventListener("click", () => { sfx.cursor?.(); this.nearby(); });
      pn.querySelector("[data-explore]")?.addEventListener("click", () => { sfx.cursor?.(); this.explore(); });
      pn.querySelectorAll("[data-fjoin]").forEach(b => b.onclick = async () => {
        if (!(await this.requireVerified("public"))) return;
        this.go("id", b.dataset.fjoin);
      });
      const form = pn.querySelector("#st-code");
      if (form) form.onsubmit = ev => {
        ev.preventDefault();
        const code = form.querySelector("input").value.trim().toUpperCase();
        if (!/^[A-Z0-9]{4}$/.test(code)) { pn.querySelector("#st-err").textContent = t("home.codeBad"); sfx.back?.(); return; }
        form.querySelector("input").blur();
        this.go("code", code);
      };
    };
    // a new view swaps the panel's insides; the city and the corners stay put
    const redraw = () => {
      const el = screen?.id === "start" ? screen.el : null;
      if (!el) return draw();
      this._su?.view?.dispose();
      el.querySelector(".st-panel").innerHTML = panel();
      bindPanel(el);
    };
    const draw = () => show("start", `
        <div class="st-corner l">${langToggle()}</div>
        <div class="st-corner r">
          <button type="button" class="glass-icon" data-me aria-label="${esc(t("start.you"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20.2c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4"/></svg></button>
          <button type="button" class="glass-icon" data-settings aria-label="${esc(t("home.settings"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/></svg></button>
        </div>
        <div class="st-panel glass">${panel()}</div>
        <div class="st-credit">roads &copy; OpenStreetMap contributors</div>`, { cls: "start", redraw: draw, bind: el => {
      bindLang(el);
      el.querySelector("[data-me]").onclick = () => { sfx.open?.(); this.home(); };
      el.querySelector("[data-settings]").onclick = () => { sfx.open?.(); this.settings(); };
      bindPanel(el);
    } });
    this._startView = v => { mode = v; redraw(); };
    draw();
    if (!invite) return;
    // an invite: is the party still on? then name + character (a first open) and straight in
    new Image().src = "lobbies/chill.png";      // (the room's backdrop, loading meanwhile)
    (async () => {
      info = await peekRoom(`party-${invite.code}`).catch(() => null);
      if (!info && screen?.id === "start") info = await peekRoom(`party-${invite.code}`).catch(() => null);   // (a slow host: once more before calling it over)
      looking = false;
      if (screen?.id !== "start" || mode !== "invite") return;
      redraw();
      if (!info || info.count >= (info.cap ?? 99)) return;
      if (info.members) warmLooks(info.members.map(m => m.avatar ?? {}));
      await scenery.wait(1200);    // (long enough to read whose party it is)
      if (screen?.id === "start" && mode === "invite") this.go("code", invite.code);
    })();
  },

  // Start / Join from the start screen: a first open sets up a name and a
  // character first, then the party opens with its panel still hidden, the
  // camera dives into the building and the lobby comes up
  async go(kind, arg) {
    if (this._going) return;
    this._going = true;
    try {
      const busy = kind === "start" ? "busy-start" : "busy";
      if (needsSetup(env.profile()) && !(await this.setup())) return false;
      if (screen?.id === "start") this._startView(busy);
      else this.startScreen({ view: busy });
      // a phone still building the city: no dive then, so the 3D rests and the party comes first
      if (!scenery.live) world3d.setPaused(true);
      const ok = kind === "start" ? await party.create() : kind === "id" ? await party.join(arg) : await party.joinByCode(arg);
      if (ok !== true || !party.current) {
        // couldn't (full, mid-game, no connection, verification declined): say so on the glass
        const why = $("pt-err")?.textContent || "";
        $("party-panel").hidden = true;
        this.startScreen({ view: kind === "start" ? "main" : "join", err: why });
        return false;
      }
      if (kind === "start") track("own_party_created");
      else { clearPending(); track("joined_party"); }
      await this.dive(party.current.meta.code);
      if (kind === "start") setTimeout(() => this.invite(party.current), 350);
      else youreIn();
      return true;
    } finally { this._going = false; }
  },

  // Explore the world: no party, the map itself. The panel fades, the camera
  // glides down to where you are (read on this phone, only if location is
  // allowed; else Itaewon), the bar slides in and the spots and pins fade in.
  // Somewhere far from Itaewon, the city there swaps in under a quick navy
  // blink first.
  async explore() {
    if (this._going) return;
    this._going = true;
    try {
      // a first open: the setup card first, then the panel's main view fades out under the glide
      if (needsSetup(env.profile())) { if (!(await this.setup())) return; this._startView?.("main"); await scenery.wait(120); }
      await askPermission("location");       // (a pre-prompt; "not now" is fine)
      const spot = (await env.exploreHome?.().catch(() => null)) ?? { lat: 37.5346, lng: 126.9946 };
      const el = screen?.id === "start" ? screen.el : null;
      el?.classList.add("going");
      sfx.open?.();
      const veil = document.getElementById("dive-veil") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "dive-veil" }));
      const away = world3d.isAway?.(spot.lat, spot.lng);
      if (away) { veil.classList.add("on"); await scenery.wait(380); }
      await world3d.releaseWorld?.([spot.lat, spot.lng]);
      if (away) await scenery.wait(250);
      veil.classList.remove("on");
      if (scenery.live) await scenery.glide(world3d.geo(spot.lat, spot.lng));
      hide();
      env.openMap?.();
      document.body.classList.add("world-arrive");
      setTimeout(() => document.body.classList.remove("world-arrive"), 2200);
    } finally { this._going = false; document.getElementById("dive-veil")?.classList.remove("on"); }
  },

  // the panel fades and scales away while the camera dives (~1.5 s) from the
  // sky into the party's building; navy for a beat, then the lobby. If the
  // 3D isn't drawing yet, no dive: nobody waits on it.
  async dive(code) {
    const el = screen?.id === "start" ? screen.el : null;
    el?.classList.add("going");
    sfx.open?.();
    const veil = document.getElementById("dive-veil") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "dive-veil" }));
    const DIVE = 1500;
    const live = el && await scenery.whenLive(250);
    if (live) {
      let dived = false;
      scenery.wait(DIVE - 330).then(() => { if (!dived) veil.classList.add("on"); });
      await scenery.dive(code, DIVE);
      dived = true;
    }
    veil.classList.add("on");
    await scenery.wait(live ? 40 : 330);
    hide();
    party.togglePanel(true);
    // (the room wipes in under the navy, then the navy lifts)
    await scenery.wait(260);
    veil.classList.remove("on");
  },

  // ================================================================ the setup card
  // A first open (Start, Join, an invite, Explore): the start panel's insides
  // become the card, over the same drifting city: the character on a small
  // stage (3D, or the room's 2D sprite, remembered), Randomize, one tap per
  // essential (skin, hair, colour, eyes, outfit, hat), the name (a random
  // one, selected: keep it with one tap or just type), Let's go. Nothing to
  // read. Returning players never see it unless they tap their chip (edit:
  // the same card, Save, Back). Resolves true once saved, false if left.
  setup({ edit = false } = {}) {
    if (this._su) return this._su.promise;
    const p = env.profile();
    const auto = !p.handle || AUTO_HANDLE.test(p.handle);
    const su = this._su = { edit, look: p.avatar ? normalizeAvatar4(p.avatar) : starterLook(), name: auto ? suggestName() : p.handle, typed: false, shuffles: 0, view: null, res: null };
    su.promise = new Promise(res => { su.res = res; });
    if (screen?.id === "start" && this._startView) this._startView("setup"); else this.startScreen({ view: "setup" });
    import("./avatar4.js").catch(() => {});      // (the 3D, loading meanwhile)
    return su.promise;
  },
  _endSetup(ok) {
    const su = this._su; if (!su) return;
    this._su = null;
    su.view?.dispose(); su.view = null;
    su.res?.(ok);
  },
  _bindSetup(pn) {
    const su = this._su, stage = pn.querySelector("#su-stage"), inp = pn.querySelector("#su-name"), err = pn.querySelector("#su-err");
    su.view?.dispose();
    su.view = mountLookView(stage, su.look, { yaw: 0.5, toggle: true });
    const swap = next => { su.look = next; su.shuffles++; su.view.setAvatar(next); sfx.pop?.(); buzz(8); };
    pn.querySelectorAll("[data-cycle]").forEach(b => b.onclick = () => swap(cycleLook(su.look, b.dataset.cycle)));
    pn.querySelector("[data-random]").onclick = e => {
      swap(starterLook());
      const b = e.currentTarget; b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin");
      sparkle(stage);
    };
    inp.oninput = () => { su.name = inp.value; su.typed = true; err.textContent = ""; };
    setTimeout(() => { if (!inp.isConnected) return; inp.focus({ preventScroll: true }); if (!su.edit) inp.select(); }, 220);
    pn.querySelector("[data-have]")?.addEventListener("click", () => { sfx.cursor?.(); this.signInSheet(); });
    pn.querySelector("[data-back]")?.addEventListener("click", () => { sfx.back?.(); this._endSetup(false); });
    const go = async () => {
      if (this._su !== su) return;
      const name = inp.value.trim(), p = env.profile();
      if (name.length < 2 || name.length > 20) { err.textContent = t("name.len"); sfx.back?.(); return; }
      const btn = pn.querySelector("[data-go]"); btn.disabled = true;
      if (name !== p.handle) {
        const r = await env.saveName(name);
        if (r?.error) {
          btn.disabled = false;
          const taken = /duplicate|unique|taken/i.test(r.error);
          err.textContent = taken ? t("name.taken") : r.error;
          if (taken && !su.typed) { su.name = inp.value = suggestName(); inp.focus(); inp.select(); }   // (a taken default: another one, ready)
          sfx.back?.(); return;
        }
        track("name_set");
      }
      if (!p.avatar || JSON.stringify(normalizeAvatar4(p.avatar)) !== JSON.stringify(su.look)) {
        const r = await env.saveAvatar(su.look);
        if (r?.error) { btn.disabled = false; err.textContent = r.error; sfx.back?.(); return; }
        track("character_shuffled", { count: su.shuffles });
        track("character_confirmed");
      }
      st.done = true; save();
      sfx.win?.(); buzz([20, 40, 20]);
      sparkle(stage, 14);
      inp.blur();
      this._endSetup(true);
    };
    pn.querySelector("[data-go]").onclick = go;
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); go(); } };
  },

  // a code from Home: the same way in as from the start screen
  joinFromInvite(inv) { return this.go("code", inv.code); },

  // ================================================================ Home
  home() {
    if (!env) return;
    unboot();
    scenery.off();
    st.done = true; save();
    const draw = () => {
      const p = env.profile(), inParty = !!party.current;
      const friends = env.friendParties?.() ?? [];
      const news = WHATS_NEW.filter(n => !st.seenNew.includes(n.id));
      show("home", `
        <div class="onb-home">
          <div class="onb-home-top">
            <button type="button" class="onb-logo sm onb-home-back" data-startscreen aria-label="${esc(t("start.back"))}">‹ rando</button>
            <span class="onb-home-r">${langToggle()}<button type="button" class="glass-icon onb-icon" data-settings aria-label="${esc(t("home.settings"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/></svg></button></span>
          </div>
          <b class="onb-hi">${esc(t("home.hi", { name: p.handle ?? "" }))}</b>
          <div class="onb-stage home" id="onb-home-stage"><div class="onb-plat"></div><button type="button" class="glass-btn clear fit onb-chip" data-style>✦ ${esc(t("home.style"))}</button></div>
          ${news.length ? `<div class="onb-news">${news.map(n => `<button type="button" class="onb-new" data-new="${n.id}"><i>${esc(t("home.new"))}</i>${esc(n[lang] ?? n.en)}<span aria-hidden="true">✕</span></button>`).join("")}</div>` : ""}
          ${friends.length ? `<div class="onb-friends"><small>${esc(t("home.friends"))}</small>${friends.map(f => `<div class="onb-fp"><b>${esc(f.name)}</b><span>${esc(t("land.inside", { n: f.count }))}</span><button type="button" class="glass-btn clear xs fit" data-fjoin="${esc(f.id)}">${esc(t("home.join"))}</button></div>`).join("")}</div>` : ""}
          <div class="onb-home-acts">
            ${inParty ? `<button type="button" class="glass-btn gold" data-back>${esc(t("home.myParty"))}</button>`
              : `<button type="button" class="glass-btn gold col throw" data-throw><span>${esc(t("home.throw"))}</span><small>${esc(t("home.throwSub"))}</small></button>`}
            <button type="button" class="glass-btn clear" data-nearby>${esc(t("home.nearby"))}</button>
            <form class="onb-code" id="onb-code"><label>${esc(t("home.code"))}</label><input maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD"><button class="glass-btn clear xs fit">${esc(t("home.codeJoin"))}</button></form>
          </div>
        </div>`, { cls: "home", redraw: draw, bind: el => {
        bindLang(el);
        homeView?.dispose();
        homeView = mountCharView(el.querySelector("#onb-home-stage"), p.avatar ?? {}, { stage: true, yaw: 0.4 });
        el.querySelector("[data-throw]")?.addEventListener("click", () => { sfx.confirm?.(); buzz(15); this.throwParty(); });
        el.querySelector("[data-back]")?.addEventListener("click", () => { sfx.confirm?.(); hide(); party.togglePanel(true); });
        el.querySelector("[data-nearby]").onclick = () => { sfx.cursor?.(); this.nearby(); };
        el.querySelector("[data-startscreen]").onclick = () => { sfx.back?.(); this.startScreen(); };
        el.querySelector("[data-style]").onclick = () => { sfx.open?.(); hide(); env.openStyle(); };
        el.querySelector("[data-settings]").onclick = () => { sfx.open?.(); this.settings(); };
        el.querySelectorAll("[data-new]").forEach(b => b.onclick = () => { st.seenNew.push(b.dataset.new); save(); b.remove(); });
        el.querySelectorAll("[data-fjoin]").forEach(b => b.onclick = async () => {
          if (!(await this.requireVerified("public"))) return;
          hide(); party.togglePanel(true); party.join(b.dataset.fjoin).then(ok => { if (ok === true) { track("joined_party"); youreIn(); } });
        });
        el.querySelector("#onb-code").onsubmit = ev => {
          ev.preventDefault();
          const code = ev.target.querySelector("input").value.trim().toUpperCase();
          if (!/^[A-Z0-9]{4}$/.test(code)) { toast(t("home.codeBad")); return; }
          this.joinFromInvite({ code });
        };
      } });
    };
    draw();
    $("nav-home") && ($("nav-home").hidden = true);
  },

  throwParty() { return this.go("start"); },

  async nearby() {
    hide();
    await askPermission("location");
    env.openMap();
  },

  // ================================================================ the invite sheet
  invite(c = party.current) {
    if (!c) return;
    if (!root) { navigator.share?.({ text: t("inv.msg", { name: c.meta.name, url: party.link(c) }) }).catch(() => {}); return; }
    const link = party.link(c), msg = t("inv.msg", { name: c.meta.name, url: link });
    const contacts = "contacts" in navigator && "ContactsManager" in globalThis;
    const sent = channel => track("invite_sent", { channel });
    sheet("invite", `
      <b class="onb-h">${esc(t("inv.title"))}</b>
      <div class="onb-inv-code"><small>${esc(t("inv.code"))}</small>${[...c.meta.code].map(ch => `<span>${esc(ch)}</span>`).join("")}</div>
      <div class="onb-inv-btns">
        <button type="button" class="glass-btn gold col" data-share data-link="${esc(link)}"><span>${esc(t("inv.share"))}</span><small>${esc(t("inv.shareSub"))}</small></button>
        <div class="onb-row2"><a class="glass-btn clear sm" data-sms href="sms:?&body=${encodeURIComponent(msg)}">${esc(t("inv.sms"))}</a><button type="button" class="glass-btn clear sm" data-copy>${esc(t("inv.copy"))}</button></div>
        ${contacts ? `<button type="button" class="glass-btn clear sm" data-contacts>${esc(t("inv.contacts"))}</button>` : ""}
      </div>
      <div class="onb-qr">${qrSvg(link)}<p>${esc(t("inv.qr"))}</p></div>
      <button type="button" class="onb-btn text" data-close>${esc(t("inv.done"))}</button>`, el => {
      el.querySelector("[data-share]").onclick = async () => {
        try {
          if (navigator.share) { await navigator.share({ title: c.meta.name, text: msg, url: link }); sent("share"); }
          else { await navigator.clipboard.writeText(msg); toast(t("inv.copied")); sent("copy"); }
        } catch {}
      };
      el.querySelector("[data-sms]").onclick = () => sent("sms");
      el.querySelector("[data-copy]").onclick = async () => { try { await navigator.clipboard.writeText(link); toast(t("inv.copied")); buzz(10); sent("copy"); } catch {} };
      // the contact picker opens from the tap on the card's yes itself (it needs a real tap)
      const pick = async () => {
        try {
          const picked = await navigator.contacts.select(["tel"], { multiple: true });
          const tels = picked.flatMap(p => p.tel?.slice(0, 1) ?? []);
          if (!tels.length) return;
          track("permission_granted", { permission: "contacts" });
          sent("contacts");
          location.href = `sms:${tels.join(",")}?&body=${encodeURIComponent(msg)}`;
        } catch { track("permission_declined", { permission: "contacts" }); }
      };
      el.querySelector("[data-contacts]")?.addEventListener("click", () => prePrompt("contacts", { onYes: pick }));
      el.querySelector("[data-close]").onclick = () => closeSheet();
      // tap the code to show it big to the people in the room
      const qr = el.querySelector(".onb-qr");
      qr.onclick = () => { qr.classList.toggle("big"); if (qr.classList.contains("big") && !qr.dataset.sent) { qr.dataset.sent = "1"; sent("qr"); } };
    });
  },

  // ================================================================ phone verification: the stranger features only
  // (making a party public, joining public parties, adding friends, earning
  // and spending coins). Private parties with friends never wait on it.
  // Resolves true when they may go on (verified, or verification is off).
  async requireVerified(trigger) {
    if (!env?.verify) return true;
    if (!(await env.verify.available())) return true;
    if (await env.verify.isVerified()) return true;
    track("verification_prompted", { trigger });
    return this.verifySheet(trigger);
  },
  // may this phone do a stranger feature right now, without asking (coins after a game)
  async verifiedOrUngated() {
    if (!env?.verify || !(await env.verify.available())) return true;
    return env.verify.isVerified();
  },
  async verifySheet(trigger, { signIn = false } = {}) {
    const sms = await env.verify.sms?.() ?? true;
    const kakao = !signIn && (await env.account?.providers?.().catch(() => []) ?? []).includes("kakao");
    return new Promise(res => {
      let phone = null, tick = null;
      const finish = ok => { clearInterval(tick); res(ok); };
      const viaKakao = el => el.querySelector("[data-oauth]")?.addEventListener("click", () => { clearInterval(tick); this.oauth("link", "kakao", trigger); });
      // ask for a code: this phone's own limit first, then the server's
      const ask = async (btn, err) => {
        const wait = otpWait(otpLog());
        if (wait) { err.textContent = t("ver.wait", { t: waitText(wait) }); sfx.back?.(); return false; }
        btn.disabled = true;
        try { await (signIn ? env.verify.signInSend(phone) : env.verify.send(phone)); }
        catch (x) {
          btn.disabled = false;
          const e = otpError(x?.message);
          track("verification_failed", { trigger, reason: e.reason });
          if (e.wait) otpHold(e.wait);
          err.textContent = e.reason === "rate_limited" ? t("ver.wait", { t: waitText(e.wait) }) : e.reason === "taken" ? t("ver.taken")
            : e.reason === "bad_number" ? t("ver.badPhone") : t(kakao ? "ver.cantSendK" : "ver.cantSend");
          sfx.back?.();
          return false;
        }
        otpMark();
        track("verification_code_sent", { trigger });
        btn.disabled = false;
        return true;
      };
      const stepPhone = () => sheet("verify", `
          <b class="onb-h">${esc(t("ver.title"))}</b>
          <p class="onb-sub">${esc(t(signIn ? "set.signin" : `ver.why.${trigger}`))}</p>
          ${sms ? `<input id="onb-phone" class="glass-field onb-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="${lang === "ko" ? "010-1234-5678" : "+1 555 123 4567"}" aria-label="${esc(t("ver.phone"))}" value="${esc(phone ?? "")}">
          <p class="onb-err" id="onb-ver-err"></p>
          <button type="button" class="glass-btn gold" data-send>${esc(t("ver.send"))}</button>` : ""}
          ${kakao ? `${sms ? `<div class="onb-or"><span>${esc(t("acct.or"))}</span></div>` : ""}${oauthBtn("kakao")}` : ""}
          <button type="button" class="onb-btn text" data-later>${esc(t("ver.later"))}</button>
          <p class="onb-fine">${esc(t(kakao ? "ver.noteK" : "ver.note"))}</p>`, el => {
        const inp = el.querySelector("#onb-phone"), err = el.querySelector("#onb-ver-err");
        if (inp) setTimeout(() => inp.focus(), 250);
        viaKakao(el);
        el.querySelector("[data-later]").onclick = () => { closeSheet(); finish(false); };
        el.querySelector("[data-send]")?.addEventListener("click", async e => {
          phone = e164(inp.value);
          if (!phone) { err.textContent = t("ver.badPhone"); sfx.back?.(); return; }
          if (await ask(e.currentTarget, err)) stepCode();
        });
      }, { onClose: () => finish(false) });
      const stepCode = () => sheet("verify", `
          <b class="onb-h">${esc(t("ver.title"))}</b>
          <p class="onb-sub">${esc(t("ver.sent", { phone }))}</p>
          <input id="onb-otp" class="glass-field onb-input otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="${esc(t("ver.code"))}">
          <p class="onb-err" id="onb-ver-err"></p>
          <button type="button" class="glass-btn gold" data-verify>${esc(t("ver.verify"))}</button>
          <p class="onb-fine onb-again" id="onb-again" aria-live="polite"></p>
          <button type="button" class="glass-btn clear sm" data-again hidden>${esc(t("ver.again"))}</button>
          ${kakao ? oauthBtn("kakao") : ""}
          <button type="button" class="onb-btn text" data-back>${esc(t("ver.resend"))}</button>`, el => {
        const inp = el.querySelector("#onb-otp"), err = el.querySelector("#onb-ver-err"), again = el.querySelector("[data-again]"), line = el.querySelector("#onb-again");
        setTimeout(() => inp.focus(), 250);
        viaKakao(el);
        // "Didn't get it? Try again in 30s (or sign in with Kakao)", then a Send again button
        const count = () => {
          const w = otpWait(otpLog());
          line.textContent = w ? t(kakao ? "ver.noCodeK" : "ver.noCode", { t: waitText(w) }) : t(kakao ? "ver.noCodeNowK" : "ver.noCodeNow");
          again.hidden = !!w;
        };
        clearInterval(tick); tick = setInterval(count, 1000); count();
        again.onclick = async () => { if (await ask(again, err)) { err.textContent = ""; toast(t("ver.sentAgain")); } count(); };
        el.querySelector("[data-back]").onclick = () => { clearInterval(tick); stepPhone(); };
        const go = async () => {
          const code = inp.value.trim();
          if (!/^\d{4,8}$/.test(code)) { err.textContent = t("ver.badCode"); return; }
          el.querySelector("[data-verify]").disabled = true;
          try { await (signIn ? env.verify.signInConfirm(phone, code) : env.verify.confirm(phone, code)); }
          catch (x) { el.querySelector("[data-verify]").disabled = false; err.textContent = t("ver.badCode"); track("verification_failed", { trigger, reason: otpError(x?.message).reason }); sfx.back?.(); return; }
          track("verification_completed", { trigger });
          sfx.win?.(); buzz([20, 40, 20]);
          toast(t("ver.done"));
          closeSheet();
          finish(true);
        };
        el.querySelector("[data-verify]").onclick = go;
        inp.oninput = () => { if (inp.value.trim().length === 6) go(); };
      }, { onClose: () => finish(false) });
      stepPhone();
    });
  },

  // ================================================================ the account: a guest, saved with one tap
  // Save: link Kakao / Apple / Google to this same guest account (nothing is
  // lost). Sign in: on another phone, or after a reinstall. Both go to the
  // provider and come back here; st.oauth remembers why and which party.
  async saveSheet(trigger = "save") {
    const provs = await env.account?.providers?.().catch(() => []) ?? [];
    const linked = await env.account.linked();
    const offer = provs.filter(p => !linked.includes(p) && !(p === "google" && inAppBrowser()));
    if (!offer.length) { toast(t("acct.none")); return; }
    track("account_save_prompted", { trigger });
    sheet("save", `
      <b class="onb-h">${esc(t("acct.title"))}</b>
      <p class="onb-sub">${esc(t("acct.sub"))}</p>
      <div class="onb-oauth">${offer.map(oauthBtn).join("")}</div>
      <button type="button" class="onb-btn text" data-have>${esc(t("acct.haveOne"))}</button>
      <button type="button" class="onb-btn text" data-close>${esc(t("ver.later"))}</button>
      <p class="onb-fine">${esc(t("acct.note"))}</p>`, el => {
      el.querySelectorAll("[data-oauth]").forEach(b => b.onclick = () => this.oauth("link", b.dataset.oauth, trigger));
      el.querySelector("[data-have]").onclick = () => this.signInSheet();
      el.querySelector("[data-close]").onclick = () => closeSheet();
    });
  },
  async signInSheet() {
    const provs = (await env.account?.providers?.().catch(() => []) ?? []).filter(p => !(p === "google" && inAppBrowser()));
    const sms = await env.verify?.sms?.();
    const guest = await env.account?.isGuest?.(), progress = guest && !needsSetup(env.profile());
    sheet("signin", `
      <b class="onb-h">${esc(t("acct.signinTitle"))}</b>
      <p class="onb-sub">${esc(t("acct.signinSub"))}</p>
      <div class="onb-oauth">${provs.map(oauthBtn).join("")}</div>
      ${sms ? `<button type="button" class="glass-btn clear sm" data-phone>${esc(t("acct.phone"))}</button>` : ""}
      ${progress ? `<p class="onb-fine">${esc(t("acct.guestLost"))}</p>` : ""}
      <button type="button" class="onb-btn text" data-close>${esc(t("set.close"))}</button>`, el => {
      el.querySelectorAll("[data-oauth]").forEach(b => b.onclick = () => this.oauth("signin", b.dataset.oauth));
      el.querySelector("[data-phone]")?.addEventListener("click", async () => { if (await this.verifySheet("save", { signIn: true })) location.reload(); });
      el.querySelector("[data-close]").onclick = () => closeSheet();
    });
  },
  async oauth(mode, provider, trigger = "save") {
    const c = party.current;
    st.oauth = { mode, provider, trigger, at: Date.now(), party: c ? c.room.id.replace(/^party-/, "") : null }; save();
    buzz(15);
    try { await (mode === "link" ? env.account.link(provider, backUrl()) : env.account.signIn(provider, backUrl())); }
    catch (e) {
      delete st.oauth; save();
      console.warn("[onboard] oauth", e?.message ?? e);
      toast(/manual linking/i.test(e?.message ?? "") ? t("acct.none") : t("acct.failed", { p: providerName(provider) }));
    }
  },
  // back from the provider: what happened (or null), the address cleaned up
  _back() {
    const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const code = q.get("error_code") ?? h.get("error_code"), error = q.get("error") ?? h.get("error");
    if (code || error) {
      const u = new URL(location.href);
      for (const k of ["error", "error_code", "error_description"]) u.searchParams.delete(k);
      if (h.get("error")) u.hash = "";
      history.replaceState(null, "", u);
    }
    const o = st.oauth;
    if (!o) return null;
    delete st.oauth; save();
    if (Date.now() - o.at > 30 * 60e3) return null;
    return { ...o, error: code || error || null };
  },
  async _afterOAuth(b) {
    const name = providerName(b.provider);
    if (b.error === "identity_already_exists") {
      sheet("taken", `
        <b class="onb-h">${esc(t("acct.taken", { p: name }))}</b>
        <p class="onb-sub">${esc(t("acct.takenSub"))}</p>
        ${oauthBtn(b.provider).replace(esc(t(`acct.${b.provider}`)), esc(t("acct.useIt")))}
        <button type="button" class="onb-btn text" data-close>${esc(t("acct.keepGuest"))}</button>`, el => {
        el.querySelector("[data-oauth]").onclick = () => this.oauth("signin", b.provider);
        el.querySelector("[data-close]").onclick = () => closeSheet();
      });
      return;
    }
    if (b.error) { toast(b.error === "access_denied" ? t("acct.cancelled") : t("acct.failed", { p: name })); return; }
    if (b.mode === "link") {
      if (!(await env.account.linked()).includes(b.provider)) { toast(t("acct.failed", { p: name })); return; }
      track("account_saved", { provider: b.provider, trigger: b.trigger });
      if (b.provider === "kakao" && ["public", "friends", "coins"].includes(b.trigger)) track("verification_completed", { trigger: b.trigger });
      toast(t("acct.saved", { p: name }));
    } else {
      track("account_signed_in", { provider: b.provider });
      toast(t("acct.signedIn", { p: name }));
    }
    sfx.win?.(); buzz([20, 40, 20]);
  },

  // ================================================================ settings
  async settings() {
    const v = env?.verify, a = env?.account;
    const [loc, notif, gated, verified, phone, provs, linked, guest, sms] = await Promise.all([permState("location"), permState("notifications"),
      v?.available() ?? false, v?.isVerified() ?? false, v?.phone?.() ?? "", a?.providers?.().catch(() => []) ?? [], a?.linked?.() ?? [], a?.isGuest?.() ?? true, v?.sms?.() ?? false]);
    const row = (label, state, kind) => `<div class="onb-set-row"><span>${esc(label)}</span>${state === "granted" ? `<em class="on">${esc(t("set.on"))}</em>`
      : state === "denied" ? `<em class="off" title="${esc(t("set.blocked"))}">${esc(t("set.off"))}</em>` : state === "unsupported" ? `<em class="off">—</em>`
      : `<button type="button" class="glass-btn clear xs fit" data-perm="${kind}">${esc(t("set.turnOn"))}</button>`}</div>`;
    const canSave = provs.some(p => !linked.includes(p)) && (guest || !linked.length);
    sheet("settings", `
      <b class="onb-h">${esc(t("set.title"))}</b>
      <div class="onb-set-row"><span>${esc(t("set.lang"))}</span>${langToggle()}</div>
      ${row(t("set.location"), loc, "location")}
      ${row(t("set.notif"), notif, "notifications")}
      ${loc === "denied" || notif === "denied" ? `<p class="onb-fine">${esc(t("set.blocked"))}</p>` : ""}
      <div class="onb-set-row"><span>${esc(t("set.account"))}</span><em class="${linked.length || !guest ? "on" : ""}">${esc(linked.length ? t("set.savedWith", { p: linked.map(providerName).join(", ") }) : guest ? t("set.guest") : t("set.saved"))}</em></div>
      ${gated ? `<div class="onb-set-row"><span>${esc(t("set.phone"))}<small>${esc(t("set.phoneWhy"))}</small></span>${verified ? `<em class="on">${esc(phone ? t("set.verified", { phone: `•••${phone.slice(-4)}` }) : t("set.verifiedKakao"))}</em>` : `<button type="button" class="glass-btn clear xs fit" data-verify>${esc(t("set.verifyBtn"))}</button>`}</div>` : ""}
      ${canSave ? `<button type="button" class="glass-btn gold sm" data-save>${esc(t("acct.title"))}</button>` : ""}
      ${provs.length || sms ? `<button type="button" class="onb-btn text" data-signin>${esc(t(guest ? "acct.haveOne" : "set.switch"))}</button>` : ""}
      <button type="button" class="onb-btn text" data-close>${esc(t("set.close"))}</button>`, el => {
      bindLang(el, () => this.settings());
      el.querySelectorAll("[data-perm]").forEach(b => b.onclick = async () => { closeSheet(); await askPermission(b.dataset.perm); this.settings(); });
      el.querySelector("[data-save]")?.addEventListener("click", () => this.saveSheet("save"));
      el.querySelector("[data-verify]")?.addEventListener("click", async () => { track("verification_prompted", { trigger: "save" }); await this.verifySheet("save"); this.settings(); });
      el.querySelector("[data-signin]")?.addEventListener("click", () => this.signInSheet());
      el.querySelector("[data-close]").onclick = () => closeSheet();
    });
  },

  // ================================================================ party moments (party.js hooks)
  beforeGame(g) {
    if (!g || OFF) return;
    trackOnce("first_game_started", { ms: sinceFirstOpen(), game: g.id });
    buzz([15, 30, 15]);
    // (how to play is the game's own: its host explains it in the game, howto.js)
    if (!st.safety) safetyCard(() => {});
  },
  gameEnded(c, g, results) {
    if (!results?.completed || OFF) return;
    if (trackOnce("first_game_finished", { game: g?.id })) {
      // right after the first finished game: party alerts (once)
      setTimeout(() => { if (!st.notifAsked && !party.current?.launched) { st.notifAsked = true; save(); askPermission("notifications"); } }, 2600);
    }
  },
  setEnded(c) {
    if (OFF) return;
    if (st.recap || !(c.played?.length)) return;
    setTimeout(() => { if (party.current === c && !c.launched) recap(c); }, 7000);
  },
  joined(c) {
    if (OFF) return;
    // a first-time hint on the vote button (players) once the room's up and
    // showing (joining from the start screen, it shows after the dive)
    const t0 = Date.now(), wait = setInterval(() => {
      if (party.current !== c || c.launched || Date.now() - t0 > 30000) return clearInterval(wait);
      if ($("party-panel").hidden || document.getElementById("dive-veil")?.classList.contains("on")) return;
      clearInterval(wait);
      setTimeout(() => {
        if (party.current !== c || c.launched) return;
        if (c.room.isHost) { if (c.room.members.length > 1) hint("start", $("pt-vote"), t("hint.start")); }
        else hint("vote", $("pt-vote"), t("hint.vote"));
      }, 2200);
    }, 200);
  },
};

// ================================================================ helpers
function clearPending() { pending = null; delete st.pending; save(); }

// ---- asking for codes: when this phone asked (and any wait the server asked for)
const OTP_KEY = "rando-otp";
function otpLog() { try { return JSON.parse(localStorage.getItem(OTP_KEY) ?? "{}"); } catch { return {}; } }
function otpSave(o) { try { localStorage.setItem(OTP_KEY, JSON.stringify(o)); } catch {} }
function otpMark() { const o = otpLog(); otpSave({ ...o, sent: [...(o.sent ?? []).filter(x => Date.now() - x < 3600e3), Date.now()] }); }
function otpHold(s) { otpSave({ ...otpLog(), until: Date.now() + s * 1000 }); }
const waitText = s => s > 90 ? t("ver.min", { n: Math.ceil(s / 60) }) : t("ver.sec", { n: s });

// ---- one-tap sign-in buttons, in each provider's own colours (their brand rules, not our accent)
const OAUTH_MARK = {
  kakao: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M12 3.2c-5.3 0-9.6 3.4-9.6 7.6 0 2.7 1.8 5.1 4.5 6.4l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.4 0 .9.1 1.3.1 5.3 0 9.6-3.4 9.6-7.7S17.3 3.2 12 3.2z"/></svg>`,
  apple: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M16.4 12.6c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.3-.1-2.6.8-3.3.8s-1.7-.8-2.9-.8c-1.5 0-2.8.9-3.6 2.2-1.5 2.7-.4 6.6 1.1 8.8.7 1.1 1.6 2.2 2.7 2.2s1.5-.7 2.8-.7 1.7.7 2.9.7 1.9-1.1 2.6-2.1c.8-1.2 1.2-2.4 1.2-2.5 0 0-2.3-.9-2.3-3.6zM14.2 6c.6-.7 1-1.7.9-2.8-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.7-.9 2.7 1 .1 2-.5 2.5-1.2z"/></svg>`,
  google: `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M47 24.6c0-1.6-.2-3.1-.4-4.6H24v9h12.9c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 7.2-10.4 7.2-17.6z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.5 42.6 14.6 48 24 48z"/></svg>`,
};
function oauthBtn(p) { return `<button type="button" class="onb-btn oauth ${p}" data-oauth="${p}">${OAUTH_MARK[p] ?? ""}<span>${esc(t(`acct.${p}`))}</span></button>`; }
const providerName = p => t(`prov.${p}`);
// KakaoTalk / Instagram / Facebook / LINE open links in their own browser; Google refuses to sign in there
const inAppBrowser = () => /KAKAOTALK|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
// where the provider sends them back: here, minus an invite's link bits (the party is in st.oauth)
function backUrl() {
  const u = new URL(location.href);
  for (const k of ["party", "from", "n", "c", "error", "error_code", "error_description"]) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

function langToggle() {
  return `<span class="onb-lang glass-seg" role="group" aria-label="Language"><button type="button" data-lang="en" class="${lang === "en" ? "on" : ""}">EN</button><button type="button" data-lang="ko" class="${lang === "ko" ? "on" : ""}">한</button></span>`;
}
function bindLang(el, after) {
  el.querySelectorAll("[data-lang]").forEach(b => b.onclick = () => { sfx.cursor?.(); setLang(b.dataset.lang); after?.(); });
}

// a sprite sheet's first frame (facing front, standing) as a picture: the
// room's own sprite at 2x, cropped to the head and shoulders (the chip)
function faceTile(avatar) {
  const el = document.createElement("i");
  el.className = "st-face";
  const k = 2;
  el.style.backgroundSize = `${SPRITE.W * SPRITE.COLS * k}px ${SPRITE.H * SPRITE.FACINGS.length * k}px`;
  el.style.backgroundImage = `url(${silhouetteFor(avatar ?? {}).url})`;
  // the real sprite once the start screen has settled (building one is 3D work; the city comes first)
  const later = globalThis.requestIdleCallback ?? (fn => setTimeout(fn, 1500));
  later(() => { if (el.isConnected) spriteFor(avatar ?? {}).then(sh => { if (el.isConnected) el.style.backgroundImage = `url(${sh.url})`; }); }, { timeout: 4000 });
  return el;
}

// a full screen of the onboarding (one at a time)
function show(id, html, { cls = "", redraw = null, bind = null } = {}) {
  if (!root) return;
  root.hidden = false;
  document.body.classList.add("onb-on");
  const old = root.querySelector(".onb-screen");
  if (old && screen?.id !== id) { old.classList.add("out"); setTimeout(() => old.remove(), 260); }
  else old?.remove();
  if (id !== "start") onboard._endSetup?.(false);
  const el = document.createElement("div");
  el.className = `onb-screen ${cls}`;
  el.dataset.screen = id;
  el.innerHTML = html;
  root.prepend(el);
  screen = { id, el, redraw };
  bind?.(el);
  // the city only shows through the start screen: behind every other screen
  // it stops drawing, so the phone's time goes to the screen they're looking at
  world3d.setPaused?.(id !== "start");
  if (id !== "home") { homeView?.dispose(); homeView = null; }
}
function hide() {
  if (!root) return;
  onboard._endSetup?.(false);
  root.querySelector(".onb-screen")?.classList.add("out");
  const el = root.querySelector(".onb-screen");
  setTimeout(() => { el?.remove(); if (!root.querySelector(".onb-sheet, .onb-perm, .onb-screen")) root.hidden = true; }, 260);
  homeView?.dispose(); homeView = null;
  screen = null;
  document.body.classList.remove("onb-on");
  world3d.setPaused?.(false);
  world3d.needsRender = true;
  scenery.off();
  unboot();
  const nh = $("nav-home"); if (nh) nh.hidden = false;
}
onboard.hide = hide;

// a sheet over whatever's showing (the invite, verification, settings)
let sheetClose = null;
function sheet(id, html, bind, { onClose = null } = {}) {
  closeSheet(true);
  root.hidden = false;
  const wrap = document.createElement("div");
  wrap.className = "onb-sheet glass-scrim";
  wrap.dataset.sheet = id;
  wrap.innerHTML = `<div class="onb-sheet-card glass glass-sheet" role="dialog">${html}</div>`;
  root.appendChild(wrap);
  sheetClose = onClose;
  wrap.onclick = e => { if (e.target === wrap) { const f = sheetClose; closeSheet(); f?.(); } };
  bind?.(wrap);
  sfx.open?.();
}
function closeSheet(quiet = false) {
  const w = root?.querySelector(".onb-sheet");
  if (!w) return;
  sheetClose = null;
  w.classList.add("out");
  setTimeout(() => { w.remove(); if (!root.querySelector(".onb-sheet, .onb-perm, .onb-screen")) root.hidden = true; }, 220);
  if (!quiet) sfx.back?.();
}

function sparkle(host, n = 10) {
  if (!host || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("b");
    s.className = "onb-spark";
    s.style.setProperty("--a", `${(360 / n) * i + Math.random() * 20}deg`);
    s.style.setProperty("--d", `${60 + Math.random() * 60}px`);
    host.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

// the start screen's still (index.html) is ours from here
function unboot() { document.documentElement.classList.remove("start-boot"); }

// "you're in!": a burst over the room, everyone already here waves
function youreIn() {
  const c = party.current; if (!c) return;
  globalThis.__youreIn = Date.now();
  buzz([20, 40, 20, 40, 60]);
  sfx.win?.();
  const el = document.createElement("div");
  el.className = "onb-in";
  const host = document.body;     // (over the room's own foreground layer)
  el.innerHTML = `<b>${esc(t("in.title"))}</b>`;
  host.appendChild(el);
  sparkle(el, 18);
  setTimeout(() => el.classList.add("out"), 2800);
  setTimeout(() => el.remove(), 3200);
  setTimeout(() => { for (const m of c.room.members) if (m.id !== party.me?.id) c.lobby?.wave(m.id); }, 500);
}

// the one-tap safety card, before the first game (not before joining)
function safetyCard(then) {
  const layer = document.body;
  const el = document.createElement("div");
  el.className = "onb-safety glass-scrim";
  el.innerHTML = `<div class="onb-safety-card glass glass-dialog" role="dialog" aria-labelledby="onb-safe-t">
      <span class="onb-safe-ico" aria-hidden="true">✌</span>
      <b id="onb-safe-t">${esc(t("safe.title"))}</b>
      <p>${esc(t("safe.body"))}</p>
      <small>${esc(t("safe.report"))}</small>
      <button type="button" class="glass-btn gold">${esc(t("safe.ok"))}</button>
    </div>`;
  layer.appendChild(el);
  el.querySelector("button").onclick = () => {
    st.safety = true; save();
    sfx.confirm?.(); buzz(12);
    el.classList.add("out"); setTimeout(() => el.remove(), 240);
    setTimeout(then, 300);
  };
}

// a first-time hint: a pulsing ring on the thing and a bubble, until it's tapped (once, ever)
function hint(key, target, text) {
  if (!target || st.hints[key] || !target.getClientRects().length) return;
  const r = target.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "onb-hint";
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  el.innerHTML = `<span class="onb-hint-b">${esc(text)}</span><i class="onb-hint-ring" style="width:${r.width + 14}px;height:${r.height + 14}px"></i>`;
  document.body.appendChild(el);
  const done = () => { st.hints[key] = true; save(); el.remove(); target.removeEventListener("click", done, true); };
  target.addEventListener("click", done, true);
  // (until it's used, a game starts, or 45 s: a hint that outstays its place points at nothing)
  const t0 = Date.now(), gone = setInterval(() => { if (!el.isConnected || party.current?.launched || Date.now() - t0 > 45000) { clearInterval(gone); el.remove(); } }, 1000);
}

// ================================================================ the first party's recap
async function recap(c) {
  st.recap = true; save();
  trackOnce("recap_shown");
  const n = c.played.length;
  const names = [...new Set(c.played.flatMap(p => p.with))].slice(0, 6);
  const moment = [...c.played].reverse().find(p => p.highlight)?.highlight ?? null;
  const people = c.room.members.slice(0, 6);
  let coins = 0;
  try { coins = await party.hooks.coins?.partyCoins({ session: c.set.session, set: c.set.no }) ?? 0; } catch {}
  // the natural moment to keep all this: save the account (one tap), and collect coins that wait on a verified number
  const canSave = !!(env?.account && await env.account.isGuest() && (await env.account.providers().catch(() => [])).length);
  const canClaim = !!c.unclaimed?.length;
  const notifAsk = (await permState("notifications")) === "prompt";
  const withLine = names.length ? t("recap.with", { n, names: t.list(names) }) : "";
  sheet("recap", `
    <div class="onb-recap" id="onb-recap">
      <small class="onb-kicker">${esc(t("recap.title"))}</small>
      <div class="onb-recap-people">${people.map((m, i) => `<img data-r="${i}" alt="${esc(m.handle)}" style="--i:${i}">`).join("")}</div>
      <b class="onb-h">${esc(withLine)}</b>
      ${moment ? `<div class="onb-moment"><small>${esc(t("recap.moment"))}</small><q>${esc(moment.text)}</q>${moment.by ? `<span>— ${esc(moment.by)}</span>` : ""}</div>` : ""}
      ${coins ? `<div class="onb-coins"><i class="coin"></i>${esc(t("recap.coins", { n: coins }))}</div>` : ""}
      <button type="button" class="glass-btn gold" data-throw>${esc(t("recap.throw"))}</button>
      <button type="button" class="glass-btn clear sm" data-share>${esc(t("recap.share"))}</button>
      ${notifAsk ? `<button type="button" class="onb-btn text" data-notif>🔔 ${esc(t("perm.notif.title"))}</button>` : ""}
      ${canSave ? `<button type="button" class="glass-btn clear sm" data-save>${esc(t("acct.recap"))}</button>` : ""}
      ${canClaim ? `<button type="button" class="onb-btn text" data-claim>${esc(t("coins.claimRecap"))}</button>` : ""}
      <button type="button" class="onb-btn text" data-close>${esc(t("recap.close"))}</button>
    </div>`, el => {
    const imgs = people.map((m, i) => renderLook(m.avatar ?? {}, { frame: "full" }).then(u => { const im = el.querySelector(`img[data-r="${i}"]`); if (im) im.src = u; return u; }).catch(() => null));
    el.querySelector("[data-throw]").onclick = async () => { closeSheet(); await party.leave(); onboard.throwParty(); };
    el.querySelector("[data-share]").onclick = async () => {
      const urls = (await Promise.all(imgs)).filter(Boolean);
      const blob = await recapImage({ urls, title: t("recap.card", { n }), sub: withLine, moment });
      const url = `${location.origin}/?from=recap`;
      const file = blob && new File([blob], "rando-party.png", { type: "image/png" });
      try {
        if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: `${t("recap.card", { n })} ${url}` });
        else if (navigator.share) await navigator.share({ text: `${t("recap.card", { n })} ${url}`, url });
        else if (blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "rando-party.png"; a.click(); }
        track("recap_shared");
      } catch {}
    };
    el.querySelector("[data-notif]")?.addEventListener("click", async () => { st.notifAsked = true; save(); await askPermission("notifications"); });
    el.querySelector("[data-save]")?.addEventListener("click", () => onboard.saveSheet("recap"));
    el.querySelector("[data-claim]")?.addEventListener("click", async () => { closeSheet(); await party.claimUnclaimed(c); });
    el.querySelector("[data-close]").onclick = () => closeSheet();
  });
}

// the recap as a picture to post (IG story-ish 1080 x 1350): night navy, the
// characters together, the line, the moment, the brand and the link
async function recapImage({ urls, title, sub, moment }) {
  try {
    const W = 1080, H = 1350, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0F1A3A"); bg.addColorStop(1, "#1d1550");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.6})`; g.fillRect(Math.random() * W, Math.random() * H * 0.6, 2, 2); }
    const font = (w, px) => `${w} ${px}px -apple-system, "SF Pro Display", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    g.fillStyle = "#FFC83D"; g.font = font(800, 64); g.textAlign = "center"; g.fillText("Rando", W / 2, 120);
    const ims = await Promise.all(urls.map(u => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = u; })));
    const shown = ims.filter(Boolean), cw = Math.min(300, (W - 120) / Math.max(1, shown.length));
    g.fillStyle = "rgba(255,200,61,.16)"; g.beginPath(); g.ellipse(W / 2, 760, W * 0.42, 70, 0, 0, Math.PI * 2); g.fill();
    shown.forEach((im, i) => { const x = W / 2 + (i - (shown.length - 1) / 2) * cw * 0.82; const h = cw * 1.6; g.drawImage(im, x - cw / 2, 760 - h, cw, h); });
    g.fillStyle = "#fff"; g.font = font(800, 54); wrap(g, title, W / 2, 900, W - 140, 64);
    g.fillStyle = "rgba(255,255,255,.75)"; g.font = font(500, 36); wrap(g, sub, W / 2, 1000, W - 160, 46);
    if (moment?.text) { g.fillStyle = "#FFC83D"; g.font = font(700, 38); wrap(g, `“${moment.text}”`, W / 2, 1120, W - 180, 48); }
    g.fillStyle = "rgba(255,255,255,.6)"; g.font = font(600, 30); g.fillText("randoirl.vercel.app", W / 2, H - 60);
    return await new Promise(r => cv.toBlob(r, "image/png"));
  } catch (e) { console.warn("[onboard] recap image", e); return null; }
}
function wrap(g, text, x, y, maxW, lh) {
  const words = String(text ?? "").split(/(\s+)/); let line = "", yy = y;
  for (const w of words) { const test = line + w; if (g.measureText(test).width > maxW && line.trim()) { g.fillText(line.trim(), x, yy); line = w.trimStart(); yy += lh; } else line = test; }
  if (line.trim()) g.fillText(line.trim(), x, yy);
}

// tests: the flow's pieces on their own (the recap without playing a whole set)
onboard.recapPreview = c => recap(c);
onboard.setupState = () => onboard._su ? { look: onboard._su.look, name: onboard._su.name, mode: onboard._su.view?.mode ?? null, edit: onboard._su.edit } : null;
onboard.party = party;
globalThis.__onb = onboard;
