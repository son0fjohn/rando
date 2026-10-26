// Art Gallery — the first house-party game (placeholder visuals, full logic).
//
// Setup: every player fills 3 picture frames (camera or camera roll). Photos
// are shrunk on-device and shared over the room channel as data URLs —
// nothing is uploaded anywhere; they die with the room. A subset of the pool
// is dealt so that each dealt photo gets exactly two competing titles from
// two different players (never the photo's owner when avoidable), written on
// a timer without knowing who else got the same photo.
// Gallery: a candlelit masquerade gala (gala.js) hosted by Bunny (bunny.js),
// deadpan in a white rabbit mask: each photo hangs in the big gold frame
// under red velvet; she unveils it, bangs her gavel, and both titles are on
// the plaques under it; everyone except the two writers votes; "Sold. To no
// one." Each writer scores their share of the vote (100 pts split by votes).
// Frames per round are capped so big parties don't drag.
//
// Runs on the HostGame kit: the host owns the state and broadcasts
// snapshots; clients render and send inputs. Photo bytes stay OUT of the
// state — the state only carries photo ids, each client keeps a local
// id -> data URL cache, and anyone missing one asks the room to resend.
// ?bots=N seats N bots (stock photos + canned titles) for desk testing.
import { HostGame, makeBots, ui } from "./gamekit.js";
import { sfx, buzz } from "./fx.js";
import { CAPTION_POOL } from "./bots.js";
import { trash, showResults, hostSkip, bindHostSkip } from "./hpkit.js";
import { dialogBox } from "./dialog.js";
import { Beats } from "./npcscene.js";
import { prePrompt } from "./permissions.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const PHOTOS_PER = 3;          // frames each player fills
const TITLE_LEN = 60;
const PHOTO_MS = 180000, TITLE_MS = 90000, COVER_MS = 3500, VOTE_MS = 25000, RESULT_MS = 6000, END_MS = 20000;
const MAX_FRAMES = 8;          // gallery cap so big parties don't drag
const MAX_EDGE = 640, MAX_CHARS = 180000;   // shrunk photo: longest edge px / data-URL length budget
const STOCK = [0, 1, 2, 3, 4, 5, 6, 7].map(i => `games/captions/c${i}.jpg`);   // bot photos
const ASSET = "games/artgallery/";
// transparent opening of frame.png, measured from its alpha (% of each edge)
const FRAME_INSET = { l: 22.8, t: 20.5, r: 23.0, b: 21.1 };
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

// What Bunny says, in English or Korean (the phone's language): deadpan,
// every terrible photo a priceless masterpiece. {n} is the exhibit's number.
const KO = /^ko\b/i.test(globalThis.navigator?.language ?? "");
const LINES = {
  en: {
    name: "Bunny",
    open: "Welcome to the gallery. Masks on. Judge everything.",
    cover: ["Exhibit {n}. Still under velvet. Contain yourselves.", "Next. Lower your expectations. Lower.", "Another acquisition. Try to look cultured."],
    unveil: ["Exhibit {n}. Note the brushwork. Breathtaking.", "The artist was clearly going through something.", "Note the thumb over the lens. A bold choice.", "Priceless. Literally. No one would pay for it.", "A masterpiece of poor decisions."],
    vote: "Two titles. One truth. Choose wisely.",
    close: "Sold. To no one.",
    result: ["The people have spoken. Tragically.", "Correct. You have taste. Barely."],
    split: "A tie. How very modern.",
    quips: ["Don't touch the art. Or me.", "I've seen worse. Not often.", "Shh. Appreciate."],
  },
  ko: {
    name: "버니",
    open: "갤러리에 오신 걸 환영해요. 가면 쓰고. 전부 심사하세요.",
    cover: ["{n}번 작품. 아직 벨벳 아래에. 진정하세요.", "다음. 기대는 낮추세요. 더 낮게.", "새 소장품이에요. 교양 있는 척해 보세요."],
    unveil: ["{n}번 작품. 붓터치를 보세요. 숨이 막히네요.", "작가가 분명 뭔가를 겪고 있었네요.", "렌즈를 가린 엄지를 보세요. 과감한 선택이에요.", "값을 매길 수 없죠. 진짜로요. 아무도 안 살 테니까.", "잘못된 선택들의 걸작이에요."],
    vote: "제목은 둘. 진실은 하나. 잘 고르세요.",
    close: "낙찰. 아무에게도.",
    result: ["대중이 결정했어요. 비극적이게도.", "정답. 안목이 있네요. 겨우."],
    split: "동점. 참 현대적이네요.",
    quips: ["작품 만지지 마세요. 저도요.", "더 나쁜 것도 봤어요. 자주는 아니고.", "쉿. 감상하세요."],
  },
};
const T = KO ? LINES.ko : LINES.en;
export const bunnyLines = LINES;
const fillN = (line, n) => line.replace("{n}", n);
// where the photo's opening and the plaques are in the approved picture
// (gala.js), for the room without 3D: the plate fitted to the room
const FRAME_OPEN = { fx: [0.354, 0.655], fy: [0.214, 0.452] };
const PLQ = { fx: [0.343, 0.777], fy: [0.548, 0.672] };

// photo id -> data URL (humans) — outside the game state on purpose
const photos = new Map();

export const ART_GALLERY = {
  id: "artgallery", title: "Art Gallery",
  // The party's vibe is a label only this pass, so nothing filters on this;
  // kept because it is still the right tagging if a filter ever returns.
  vibes: ["chill", "chaotic", "sporty"],
  blurb: "fill 3 frames with photos. title each other's. the room votes on the better title.",
  minPlayers: 3, maxPlayers: 12, length: "~8 min",

  start(ctx) {
    ui.show(); ui.theme("chill");
    const room = ctx.room;
    // the gallery's wall behind every card (photos, titles, results), not
    // the map; the gallery steps draw the full room over it
    const wall = document.createElement("div");
    wall.className = "game-bg ag-bg";
    $("game-layer")?.prepend(wall);
    void wall.offsetWidth;          // styled at opacity 0 first, so it fades in
    wall.classList.add("on");
    trash.add(() => wall.remove());
    // every photo anyone shared dies when the party does (cleanup contract)
    trash.add(() => { photos.clear(); mine.length = 0; });
    let lastHud = 0, mine = [], myTitles = {}, myVote = null, busy = false;
    const needAsked = {};
    const G = this;

    // ---- photo transport (room-level, not game state) ----
    const onPhoto = m => { if (m.pid && typeof m.data === "string") photos.set(m.pid, m.data); };
    const onNeed = m => { if ((ctx.isHost() || mine.includes(m.pid)) && photos.has(m.pid)) room.send("agphoto", { pid: m.pid, data: photos.get(m.pid) }); };
    room.on("agphoto", onPhoto); room.on("agneed", onNeed);
    function srcOf(pid, s) {
      const src = s.pool?.[pid]?.src ?? photos.get(pid);
      if (src) return src;
      const now = Date.now();
      if (now - (needAsked[pid] || 0) > 4000) { needAsked[pid] = now; room.send("agneed", { pid }); }
      return null;
    }
    // ---- the title cards: the photo in the gold frame (frame.png)
    const framed = (pid, s, cls = "") => {
      const src = srcOf(pid, s);
      const inset = `top:${FRAME_INSET.t}%;right:${FRAME_INSET.r}%;bottom:${FRAME_INSET.b}%;left:${FRAME_INSET.l}%`;
      return `<div class="ag-hang ${cls}"><div class="ag-photo" style="${inset}">${src ? `<img src="${src}" alt="">` : "<span>photo loading…</span>"}</div><img class="ag-frameimg" src="${ASSET}frame.png" alt=""></div>`;
    };
    const scene = (pid, s) => `<div class="ag-scene">${framed(pid, s)}</div>`;

    // ---- the gala (bunny.js + gala.js): one Bunny and one dialog box for
    // the whole game, moved into the room when it's (re)built. She loads
    // (model, room, shaders) as the game starts, while photos go up.
    let bunny = null, bunnyP = null, dlgKey = null, quipN = Math.floor(Math.random() * 3), plaqueKey = null, track = 0;
    const holder = document.createElement("div");
    const dlg = dialogBox(document.createElement("div"), { name: T.name, blip: () => sfx.blip() });
    const beats = new Beats();
    const loadBunny = () => (bunnyP ??= import("./bunny.js").then(m => m.bunnyScene(holder)).then(b => {
      bunny = b;
      b.onBang = () => { sfx.thud(); buzz(18); };
      b.onClap = () => sfx.pop();
      b.onTap = onTap;
      globalThis.__bunny = b;                             // for the tests
      return b;
    }).catch(e => { console.warn("[artgallery] no 3D gala, the painted room stays:", e?.message ?? e); return null; }));
    loadBunny();
    trash.add(() => { cancelAnimationFrame(track); dlg.dispose(); bunnyP?.then(b => b?.dispose()); bunny = null; bunnyP = null; if (globalThis.__bunny) globalThis.__bunny = null; });
    // what the scene should show; re-applied whenever she's (re)mounted
    const want = { drape: true, spot: 0, photo: null, plaques: null, plState: { covered: true, picked: null, top: null } };
    const room$ = () => $("ag-room");
    // taps in the scene: a plaque (a vote, while voting's open), and between
    // her lines: her (a line, and a sip or a slow nod), the frame (its
    // spotlight flickers), a candle sconce (it flickers)
    const onTap = kind => {
      if (kind === "plaque0" || kind === "plaque1") return castVote(+kind.slice(-1));
      if (kind === "frame") { sfx.tick(); return true; }
      if (kind === "candle") { sfx.cursor(); return true; }
      if (kind !== "bunny" || !dlg.done || dlg.el.hidden) return false;
      dlg.quip(T.quips[quipN++ % T.quips.length]);
      sfx.blip(); buzz(12);
      return true;
    };
    // the room: the 3D gala behind everything; the pill, the plaques on the
    // wall under the frame, the dialog box at the bottom
    function ensureRoom() {
      if (room$()) return false;
      dlgKey = null; plaqueKey = null;
      ui.panel(`<div class="np-room ag-room covered" id="ag-room">
          <div class="ag-3d" id="ag-3d"></div>
          <div class="ag-photo2d" id="ag-photo2d"></div>
          <div class="np-pill ag-pill" id="ag-pill"></div>
          <div class="ag-plaques" id="ag-plaques"></div>
          <div class="ag-low">${skipBtn()}<div class="ag-dlg" id="ag-dlg"></div></div>
        </div>`, "np-full ag-full");
      bindSkip();
      dlg.attach($("ag-dlg"));
      loadBunny().then(b => {
        const at = $("ag-3d");
        if (!b || !at) return;
        const first = !b.stage.canvas.isConnected;
        if (first) b.stage.canvas.style.opacity = "0";   // the first time: fade in over the painted room
        b.attach(at);
        b.room.drape(want.drape, { instant: true }); b.room.spot(want.spot); b.room.photo(want.photo);
        want.plaques?.forEach((c, i) => b.room.plaque(i, c)); b.room.plaqueState({ ...want.plState, instant: true });
        requestAnimationFrame(() => requestAnimationFrame(() => { b.stage.canvas.style.opacity = ""; room$()?.classList.add("r3d"); }));
      });
      cancelAnimationFrame(track);
      const follow = () => { if (!room$()) return; placePlaques(); track = requestAnimationFrame(follow); };
      track = requestAnimationFrame(follow);
      return true;
    }
    // The plaques are the 3D wall's (gala.js): drawn in the scene, voted on
    // by tapping them there. The DOM plaques under #ag-plaques are the room
    // without 3D (where the picture has them, side by side); with the 3D
    // wall they're invisible, sit exactly over the 3D ones and only mirror
    // their state (keyboard, screen readers, tests).
    function placePlaques() {
      const rm = room$(), pl = $("ag-plaques");
      if (!rm || !pl) return;
      const R = rm.getBoundingClientRect();
      const in3d = !!bunny && rm.classList.contains("r3d");
      pl.classList.toggle("in3d", in3d);
      if (in3d) {
        Object.assign(pl.style, { left: "0px", top: "0px", width: `${Math.round(R.width)}px`, height: `${Math.round(R.height)}px` });
        bunny.plaqueRects().forEach((r, i) => {
          const el = pl.children[i];
          if (el) Object.assign(el.style, { left: `${Math.round(r.left - R.left)}px`, top: `${Math.round(r.top - R.top)}px`, width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px` });
        });
        return;
      }
      for (const el of pl.children) el.style.cssText = "";
      const fit = picBox(R);
      const x0 = fit.x + PLQ.fx[0] * fit.w, x1 = fit.x + PLQ.fx[1] * fit.w, y0 = fit.y + PLQ.fy[0] * fit.h;
      // (never narrower than readable, kept on screen)
      const w = Math.max(x1 - x0, R.width * 0.5), cx = Math.max(w / 2 + 8, Math.min(R.width - w / 2 - 8, (x0 + x1) / 2));
      Object.assign(pl.style, { left: `${Math.round(cx - w / 2)}px`, top: `${Math.round(Math.max(90, Math.min(R.height * 0.66, y0)))}px`, width: `${Math.round(w)}px`, height: "" });
    }
    // the approved picture (9:16) fitted to cover the room, like its plate
    const picBox = R => { const h = Math.max(R.height, R.width * 16 / 9), w = h * 9 / 16; return { x: (R.width - w) / 2, y: 0, w, h }; };
    // the room without 3D: the photo in the painted frame
    function photo2d(src) {
      const el = $("ag-photo2d"), rm = room$();
      if (!el || !rm) return;
      const fit = picBox(rm.getBoundingClientRect());
      Object.assign(el.style, { left: `${fit.x + FRAME_OPEN.fx[0] * fit.w}px`, top: `${FRAME_OPEN.fy[0] * fit.h}px`, width: `${(FRAME_OPEN.fx[1] - FRAME_OPEN.fx[0]) * fit.w}px`, height: `${(FRAME_OPEN.fy[1] - FRAME_OPEN.fy[0]) * fit.h}px` });
      if (src && el.dataset.src !== src) { el.dataset.src = src; el.innerHTML = `<img src="${src}" alt="">`; }
    }
    // the scene's state, on her and on the painted room alike
    const drape = (on, instant = false) => { want.drape = on; bunny?.room.drape(on, { instant }); room$()?.classList.toggle("draped", on); };
    const spot = v => { want.spot = v; bunny?.room.spot(v); };
    const setPhoto = src => { if (!src) return; want.photo = src; bunny?.room.photo(src); photo2d(src); };
    // what she says, once per key: `late` (arrived mid-beat) shows it at once
    const line = (key, text, { late = false } = {}) => {
      if (dlgKey === key) return;
      dlgKey = key;
      dlg.show(); dlg.say(text, { instant: late });
    };
    // the two titles as plaques: Title I / II, a velvet cover on each that
    // comes off one after the other right after the frame's; voting = tapping
    // one; the result shows authors and points on the same plaques
    const ROMAN = ["I", "II"];
    const plaquesHtml = (f, s, mode) => {
      const c = f.counts || [0, 0], pts = f.pts || [0, 0];
      const top = mode === "result" && c[0] !== c[1] ? (c[0] > c[1] ? 0 : 1) : null;
      return f.titles.map((t, i) => {
        const body = `<span class="ag-pl-eye">Title ${ROMAN[i]}</span><span class="ag-pl-t">“${esc(t.text)}”</span>` + (mode === "result"
          ? `<span class="ag-pl-by">— ${esc(s.players[t.by]?.handle ?? "?")}</span><span class="ag-pl-n">${c[i]} vote${c[i] === 1 ? "" : "s"} · <b data-count="${pts[i]}">+0</b></span>${top === i ? `<i class="ag-pl-win">winner</i>` : ""}`
          : `<i class="ag-pl-dot">✓</i>`);
        const cls = `ag-pl ${top === i ? "win" : ""} ${top !== null && top !== i ? "lose" : ""}`;
        return mode === "vote"
          ? `<button type="button" class="${cls}" data-v="${i}">${body}<i class="ag-pl-cloth"></i></button>`
          : `<div class="${cls}">${body}<i class="ag-pl-cloth"></i></div>`;
      }).join("");
    };
    const setPlaques = (key, html) => { if (plaqueKey === key) return false; plaqueKey = key; const p = $("ag-plaques"); if (p) p.innerHTML = html; placePlaques(); return true; };
    // ...and on the 3D wall: what each says (k: how far the points have counted up)
    const plaques3d = (f, s, mode, k = 1) => {
      const c = f.counts || [0, 0], pts = f.pts || [0, 0];
      want.plaques = f.titles.map((t, i) => ({
        label: `TITLE ${ROMAN[i]}`, title: t.text,
        ...(mode === "result" ? { by: `— ${s.players[t.by]?.handle ?? "?"}`, votes: `${c[i]} vote${c[i] === 1 ? "" : "s"} · +${Math.round(pts[i] * k)}` } : {}),
      }));
      want.plaques.forEach((p, i) => bunny?.room.plaque(i, p));
    };
    const plState = (st, instant = false) => { Object.assign(want.plState, st); bunny?.room.plaqueState({ ...st, instant }); };
    // a vote: a tap on a plaque in the scene (or the DOM one without 3D);
    // writers can't, and only while voting's open
    function castVote(i) {
      const s = game.s;
      if (!s || s.phase !== "gallery" || s.sub !== "reveal") return false;
      const f = s.frames[s.fi];
      if (!f || f.titles.some(t => t.by === ctx.me.id)) return false;
      myVote = i; game.input("vote", { idx: i }); sfx.pop(); buzz(15); lastHud = 0; renderAG(s);
      return true;
    }
    const pill = html => { const p = $("ag-pill"); if (p && p.innerHTML !== html) p.innerHTML = html; };

    // reveal tween: the room flips from covered to revealed on the next frame
    // so the plaques' covers actually transition off (frame first, then I, II)
    const revealed = new Set();
    function playReveal(fi) {
      const el = room$();
      if (!el) return;
      revealed.add(fi);
      el.classList.add("ag-anim");
      const flip = () => { void el.offsetWidth; el.classList.remove("covered"); el.classList.add("revealed"); };
      requestAnimationFrame(() => requestAnimationFrame(flip));
      // frames don't come in a tab that isn't drawing; a timer still runs, so
      // the unveil can't get stuck under the cloth
      setTimeout(flip, 150);
    }
    // numeric count-up tween for the points
    // (on the 3D plaques too: `draw(k)` redraws them part way)
    function countUp(draw = null) {
      const t0 = performance.now();
      const els = [...$("game-panel").querySelectorAll("[data-count]")];
      if (!els.length) return;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 800), e = 1 - Math.pow(1 - k, 3);
        for (const el of els) el.textContent = `+${Math.round(+el.dataset.count * e)}`;
        draw?.(e);
        if (k < 1 && $("game-panel").contains(els[0])) requestAnimationFrame(step);
        else draw?.(1);
      };
      requestAnimationFrame(step);
    }

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = { id: h.id, handle: h.handle, isBot: false, score: 0, photos: [], assigned: [], titles: {}, gone: false };
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = { id: b.id, handle: b.handle, isBot: true, score: 0, photos: [], assigned: [], titles: {}, gone: false, stock: shuffle(game.rng, STOCK).slice(0, PHOTOS_PER) };
        s.phase = "photos"; s.left = PHOTO_MS; s.pool = {}; s.dealt = []; s.frames = []; s.fi = 0; s.sub = null; s.why = null; s.dropped = 0;
      },
      hostTick(s, dt) {
        s.left -= dt * 1000;
        syncGone(s);
        const P = Object.values(s.players), active = P.filter(p => !p.gone);
        if (s.phase === "photos") {
          for (const b of P) if (b.isBot && b.photos.length < PHOTOS_PER && game.rng() < dt * 0.4) addPhoto(s, b.id, `stock-${b.id}-${b.photos.length}`, b.stock[b.photos.length]);
          if (active.length && active.every(p => p.photos.length >= PHOTOS_PER)) s.left = Math.min(s.left, 1500);
          if (s.left > 0) return;
          deal(s);
          if (!s.dealt.length) { s.phase = "end"; s.left = END_MS; s.why = "not enough photos to hang a show"; game.emit("finish", {}); return; }
          s.phase = "title"; s.left = TITLE_MS; game.emit("phase", { phase: "title" }); return;
        }
        if (s.phase === "title") {
          for (const b of P) if (b.isBot) for (const pid of b.assigned) if (!b.titles[pid] && game.rng() < dt * 0.25) b.titles[pid] = pick(game.rng, CAPTION_POOL);
          if (active.every(p => p.assigned.every(pid => p.titles[pid]))) s.left = Math.min(s.left, 1500);
          if (s.left > 0) return;
          hang(s);
          if (!s.frames.length) { s.phase = "end"; s.left = END_MS; s.why = "no frame got two titles in time"; game.emit("finish", {}); return; }
          s.phase = "gallery"; s.fi = 0; s.sub = "covered"; s.left = COVER_MS; game.emit("cover", { fi: 0 }); return;
        }
        if (s.phase === "gallery") {
          const f = s.frames[s.fi];
          if (s.sub === "covered") {
            if (s.left <= 0) { s.sub = "reveal"; s.left = VOTE_MS; game.emit("reveal", { fi: s.fi }); }
            return;
          }
          if (s.sub === "reveal") {
            const writers = f.titles.map(t => t.by);
            const voters = active.filter(p => !writers.includes(p.id));
            for (const b of voters) if (b.isBot && f.votes[b.id] === undefined && game.rng() < dt * 0.5) f.votes[b.id] = game.rng() < 0.5 ? 0 : 1;
            if (voters.every(p => f.votes[p.id] !== undefined)) s.left = Math.min(s.left, 1200);
            if (s.left > 0) return;
            // share of the vote -> points (100 split by votes; nobody voted -> nothing)
            const counts = [0, 0];
            for (const v of Object.values(f.votes)) if (v === 0 || v === 1) counts[v]++;
            const total = counts[0] + counts[1];
            f.counts = counts; f.pts = counts.map(c => total ? Math.round(100 * c / total) : 0);
            f.titles.forEach((t, i) => { if (s.players[t.by]) s.players[t.by].score += f.pts[i]; });
            // the party's best moment so far (the first party's recap): the most-voted winning title
            const w = counts[0] === counts[1] ? -1 : counts[0] > counts[1] ? 0 : 1;
            if (w >= 0 && (!s.highlight || f.pts[w] > s.highlight.score)) s.highlight = { kind: "title", text: f.titles[w].text, by: s.players[f.titles[w].by]?.handle ?? "", score: f.pts[w] };
            s.sub = "result"; s.left = RESULT_MS; game.emit("result", { fi: s.fi }); return;
          }
          if (s.sub === "result") {
            if (s.left > 0) return;
            if (s.fi + 1 < s.frames.length) { s.fi++; s.sub = "covered"; s.left = COVER_MS; game.emit("cover", { fi: s.fi }); }
            else { s.phase = "end"; s.left = END_MS; game.emit("finish", {}); }
            return;
          }
        }
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        const p = s.players[m.from];
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        if (!p) return;
        if (m.in === "photo" && s.phase === "photos") addPhoto(s, p.id, String(m.pid));
        if (m.in === "title" && s.phase === "title" && p.assigned.includes(m.pid)) p.titles[m.pid] = String(m.text).trim().slice(0, TITLE_LEN) || "untitled";
        if (m.in === "vote" && s.phase === "gallery" && s.sub === "reveal") {
          const f = s.frames[s.fi];
          if (!f.titles.some(t => t.by === p.id) && (m.idx === 0 || m.idx === 1)) f.votes[p.id] = m.idx;
        }
      },
      render(s) { renderAG(s); },
      onEvent(m) {
        // (no resetKey: the title screen has its own keys, and a late reset
        // would rebuild a title box someone already started typing in)
        if (m.ev === "phase") { sfx.ping(); ui.toast("photos are in — now title them", "phase"); }
        if (m.ev === "cover") { myVote = null; sfx.tick(); ui.resetKey(); }
        // no resetKey here: the render keys already change per step, and on the
        // host this event lands after the first render, so a reset would
        // rebuild the room mid-unveil and cut the plaque reveal short
        if (m.ev === "reveal") { sfx.chime(); buzz(40); }
        if (m.ev === "result") { sfx.pop(); }
        if (m.ev === "finish") { sfx.win(); ui.resetKey(); }
      },
    }, { hz: 3 });

    // ---- host helpers ----
    function syncGone(s) {
      const present = new Set(room.members.map(m => m.id));
      for (const p of Object.values(s.players)) if (!p.isBot) p.gone = !present.has(p.id);
    }
    function addPhoto(s, owner, pid, src) {
      const p = s.players[owner];
      if (!p || p.photos.length >= PHOTOS_PER || s.pool[pid]) return;
      p.photos.push(pid);
      s.pool[pid] = src ? { owner, src } : { owner };
    }
    // deal: K = floor(3N/2) photos so 2 titles each = 3 titles per player;
    // interleave owners so everyone gets hung; two distinct writers per
    // photo, never the owner when avoidable, balanced by load
    function deal(s) {
      const P = Object.values(s.players).filter(p => !p.gone);
      for (const p of Object.values(s.players)) p.assigned = [];
      if (P.length < 2) { s.dealt = []; return; }
      const byOwner = P.map(p => shuffle(game.rng, p.photos));
      const ordered = [];
      for (let i = 0; i < PHOTOS_PER; i++) for (const arr of byOwner) if (arr[i]) ordered.push(arr[i]);
      const K = Math.min(ordered.length, Math.floor(PHOTOS_PER * P.length / 2));
      const chosen = shuffle(game.rng, ordered.slice(0, K));
      const load = Object.fromEntries(P.map(p => [p.id, 0]));
      for (const pid of chosen) {
        let cands = P.filter(p => p.id !== s.pool[pid].owner);
        if (cands.length < 2) cands = P.slice();
        cands = shuffle(game.rng, cands).sort((a, b) => load[a.id] - load[b.id]);
        for (const w of cands.slice(0, 2)) { w.assigned.push(pid); load[w.id]++; }
      }
      s.dealt = chosen;
    }
    // hang: only photos that got both titles make the wall; shuffled, capped
    function hang(s) {
      const frames = [];
      for (const pid of s.dealt) {
        const titles = Object.values(s.players).filter(p => p.assigned.includes(pid) && p.titles[pid]).map(p => ({ by: p.id, text: p.titles[pid] }));
        if (titles.length === 2) frames.push({ pid, titles: shuffle(game.rng, titles), votes: {}, counts: null, pts: null });
      }
      s.frames = shuffle(game.rng, frames).slice(0, MAX_FRAMES);
      s.dropped = frames.length - s.frames.length;
    }

    // ---- client: photo capture ----
    async function onFile(file) {
      if (!file || busy || mine.length >= PHOTOS_PER) return;
      busy = true; ui.resetKey();
      try {
        const data = await shrink(file);
        const pid = `${ctx.me.id.slice(0, 6)}-${mine.length}-${Date.now().toString(36)}`;
        photos.set(pid, data); mine.push(pid);
        room.send("agphoto", { pid, data });
        game.input("photo", { pid });
        sfx.pop();
      } catch (e) { console.warn("[artgallery] photo", e); ui.toast("couldn't read that photo — try another", "rip"); }
      busy = false; ui.resetKey();
    }

    // ---- render (everyone) ----
    const skipBtn = () => ctx.isHost() ? `<button type="button" class="pt-btn ag-skip" id="ag-skip">host: skip ahead</button>` : "";
    const bindSkip = () => { const b = $("ag-skip"); if (b) b.onclick = () => { game.input("skip"); sfx.tick(); }; };
    function renderAG(s) {
      const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {}), active = P.filter(p => !p.gone);
      const label = s.phase === "photos" ? "setup · photos" : s.phase === "title" ? "setup · titles" : s.phase === "gallery" ? `gallery · ${s.fi + 1}/${s.frames.length}` : "final";
      ui.hud(`<div class="hq"><b>ART GALLERY</b><span>${label}</span><span class="clk ${s.left < 8000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);

      if (s.phase === "photos") {
        // a phone that reloaded mid-game lost its local list: the host's
        // state still has the photos it sent (and the host resends the bytes)
        for (const pid of me?.photos ?? []) if (!mine.includes(pid) && mine.length < PHOTOS_PER) mine.push(pid);
        const ready = active.filter(p => p.photos.length >= PHOTOS_PER).length;
        const shown = mine.filter(pid => srcOf(pid, s)).length;
        if (!ui.once(`p:${mine.length}:${shown}:${ready}:${active.length}:${busy ? 1 : 0}`, () => {})) return;
        const inset = `top:${FRAME_INSET.t}%;right:${FRAME_INSET.r}%;bottom:${FRAME_INSET.b}%;left:${FRAME_INSET.l}%`;
        const frames = [0, 1, 2].map(i => {
          const pid = mine[i], src = pid && srcOf(pid, s);
          const inner = pid ? (src ? `<img src="${src}" alt="">` : "<span>photo loading…</span>") : `<span>${busy && i === mine.length ? "loading…" : "tap to add a photo"}</span>`;
          return `<div class="pt-box ag-frame ${pid ? "" : "ag-empty"}" data-i="${i}"><div class="ag-hang"><div class="ag-photo" style="${inset}">${inner}</div><img class="ag-frameimg" src="${ASSET}frame.png" alt=""></div></div>`;
        }).join("");
        ui.stage("fill your 3 frames", `<div class="ag-frames">${frames}</div><input type="file" id="ag-file" accept="image/*" hidden>
          <p class="ab-sub">${mine.length}/${PHOTOS_PER} of yours in · ${ready}/${active.length} players ready · take a photo or pick one from your camera roll</p>${skipBtn()}`, `setup · ${ui.clock(s.left)}`);
        const inp = $("ag-file");
        $("game-panel").querySelectorAll(".ag-empty").forEach(b => b.onclick = async () => {
          if (busy || mine.length >= PHOTOS_PER) return;
          // the first time on this phone: what the photos are for, then the picker
          if (!localStorage.getItem("rando-perm-camera")) { if (!(await prePrompt("camera"))) return; try { localStorage.setItem("rando-perm-camera", "1"); } catch {} }
          inp.click();
        });
        inp.onchange = e => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); };
        bindSkip();
      } else if (s.phase === "title") {
        const assigned = me?.assigned ?? [];
        const todo = assigned.filter(pid => !me.titles[pid] && !myTitles[pid]);
        const cur = todo[0];
        const done = active.filter(p => p.assigned.every(pid => p.titles[pid])).length;
        const has = cur ? !!srcOf(cur, s) : 0;
        // while there's a title box, only my own progress rebuilds it: other
        // players finishing, or the photo arriving late, must not wipe a
        // half-typed title (the photo is dropped into the frame in place)
        if (!ui.once(cur ? `t:${cur}` : `t:-:${done}:${active.length}`, () => {})) {
          const ph = cur && has ? $("game-panel").querySelector(".ag-photo") : null;
          if (ph && !ph.querySelector("img")) ph.innerHTML = `<img src="${srcOf(cur, s)}" alt="">`;
          return;
        }
        if (cur) {
          const n = assigned.length - todo.length + 1;
          ui.stage(`title this piece (${n}/${assigned.length})`, scene(cur, s) + ui.prompt("give it a title…", text => { myTitles[cur] = text; game.input("title", { pid: cur, text }); sfx.pop(); ui.resetKey(); }, { maxlength: TITLE_LEN, submitLabel: "lock it" })
            + `<p class="ab-sub">someone else is titling this exact photo too — you're competing</p>${skipBtn()}`, `titles · ${ui.clock(s.left)}`);
          bindSkip();
        } else {
          ui.stage(assigned.length ? "titles locked" : "nothing to title", `<p class="ab-sub">${done}/${active.length} players done — the gallery opens when everyone's in</p>${skipBtn()}`, `titles · ${ui.clock(s.left)}`);
          bindSkip();
        }
      } else if (s.phase === "gallery") {
        const f = s.frames[s.fi]; if (!f) return;
        const owner = s.players[s.pool?.[f.pid]?.owner]?.handle ?? "?";
        const fresh = ensureRoom();
        const room = room$();
        const src = srcOf(f.pid, s);              // (asks the room for it if we're missing it)
        setPhoto(src);
        const n = s.fi + 1, pk = `${s.sub}:${s.fi}`;
        const lineOf = (pool, k = 0) => pool[(s.fi + k) % pool.length];
        if (s.sub === "covered") {
          // under velvet; she opens the show (or announces the next one)
          const el = COVER_MS - s.left;
          beats.at("cover", pk, 0, el, late => {
            drape(true, late || fresh); spot(0); bunny?.setPose("idle");
            room.classList.remove("revealed", "picked", "ag-anim"); room.classList.add("covered");
            line(pk, s.fi === 0 ? T.open : fillN(lineOf(T.cover), n), { late });
          });
          if (setPlaques(`c:${s.fi}`, plaquesHtml(f, s, "read"))) { plaques3d(f, s, "read"); plState({ covered: true, picked: null, top: null }, true); }
          pill(`piece <b>${n}</b> of ${s.frames.length}`);
        } else if (s.sub === "reveal") {
          const writer = f.titles.some(t => t.by === ctx.me.id);
          // my own tap wins over a host snapshot that hasn't caught up yet
          const voted = myVote ?? f.votes[ctx.me.id] ?? null;
          const eligible = active.filter(p => !f.titles.some(t => t.by === p.id)).length;
          const votesIn = Object.keys(f.votes).length;
          const el = VOTE_MS - s.left;
          // the unveil: the velvet slides off, the spotlight snaps on, she
          // presents it with the gavel; then the gavel: voting is open
          beats.at("unveil", pk, 0, el, late => {
            drape(false, late); spot(1);
            // voting opens with it: the camera glides back to face the plaques
            bunny?.home();
            if (!late) { bunny?.setPose("unveil"); sfx.whoosh(); }
            line(`${pk}:u`, fillN(lineOf(T.unveil), n), { late });
          });
          beats.at("gavel", pk, 2300, el, late => { bunny?.setPose("idle"); if (!late) bunny?.play("gavel"); line(`${pk}:g`, T.vote, { late }); });
          beats.at("judge", pk, 9000, el, late => { if (!late) bunny?.play("judge"); });
          // Built once per piece: other people's votes, my own tap and a photo
          // that lands late are all patched in place below, so none of them
          // cut the unveil short.
          if (setPlaques(`v:${s.fi}:${writer ? 1 : 0}`, plaquesHtml(f, s, writer ? "read" : "vote"))) {
            plaques3d(f, s, "read");
            // the 3D plaques' covers come off after the frame's (unless we
            // arrived after that)
            plState({ covered: false, top: null }, revealed.has(s.fi) || el > 2500);
            if (!revealed.has(s.fi)) playReveal(s.fi);
            else { room.classList.remove("covered"); room.classList.add("revealed"); }
            if (!writer) $("ag-plaques").querySelectorAll("[data-v]").forEach(b => b.onclick = () => castVote(+b.dataset.v));
          }
          room.classList.toggle("picked", voted !== null);
          room.querySelectorAll(".ag-pl").forEach((el, i) => el.classList.toggle("on", voted === i));
          if (want.plState.picked !== voted) plState({ picked: voted });
          pill(writer ? `one of these is yours · <b>${votesIn}/${eligible}</b> votes in`
            : voted === null ? `tap a title to vote · <b>${votesIn}/${eligible}</b> votes in`
            : `<b>✓ voted</b> · ${votesIn}/${eligible} in · tap the other to switch`);
        } else if (s.sub === "result") {
          const el = RESULT_MS - s.left;
          const c = f.counts || [0, 0];
          const top = c[0] === c[1] ? null : (c[0] > c[1] ? 0 : 1);
          // the gavel: voting's closed. Then two slow, sarcastic claps
          beats.at("sold", pk, 0, el, late => { drape(false, true); spot(1); bunny?.setPose("idle"); if (!late) bunny?.play("gavel"); line(`${pk}:s`, T.close, { late }); });
          beats.at("clap", pk, 2200, el, late => {
            if (!late) bunny?.play("applause");
            line(`${pk}:r`, top === null ? T.split : lineOf(T.result), { late });
          });
          if (setPlaques(`r:${s.fi}`, plaquesHtml(f, s, "result"))) {
            room.classList.remove("covered", "picked", "ag-anim"); room.classList.add("revealed");
            // the winner lights up, the other dims; my seal stays on my vote
            plState({ covered: false, top, picked: myVote ?? f.votes[ctx.me.id] ?? null }, true);
            countUp(k => plaques3d(f, s, "result", k));
          }
          pill(`photo by <b>${esc(owner)}</b>`);
        }
      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const note = s.why || (s.dropped ? `${s.dropped} piece${s.dropped === 1 ? "" : "s"} left in storage (frame cap ${MAX_FRAMES})` : "");
        showResults(P, { title: "Art Gallery", sub: "final scores", note },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging, which would otherwise keep
    // every entry, title and photo id alive after the party ended
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "photos", left: PHOTO_MS, players: {}, pool: {}, dealt: [], frames: [], fi: 0, sub: null, why: null, dropped: 0 });
    const o = ctx.onEnd;
    ctx.onEnd = r => { game.stop(); room.off("agphoto", onPhoto); room.off("agneed", onNeed); ui.hide(); o(r); };
  },
};

// shrink on-device: longest edge MAX_EDGE, JPEG, quality stepped down until
// the data URL fits the budget (keeps every broadcast comfortably small)
async function shrink(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  const sc = Math.min(1, MAX_EDGE / Math.max(w, h));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * sc)); cv.height = Math.max(1, Math.round(h * sc));
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  img.close?.();
  let q = 0.6, out = cv.toDataURL("image/jpeg", q);
  while (out.length > MAX_CHARS && q > 0.3) { q -= 0.1; out = cv.toDataURL("image/jpeg", q); }
  return out;
}

// The catalog lives in partycatalog.js — this module just exports the game.
