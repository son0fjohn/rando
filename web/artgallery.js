// Art Gallery — the first house-party game (placeholder visuals, full logic).
//
// Setup: every player fills 3 picture frames (camera or camera roll). Photos
// are shrunk on-device and shared over the room channel as data URLs —
// nothing is uploaded anywhere; they die with the room. A subset of the pool
// is dealt so that each dealt photo gets exactly two competing titles from
// two different players (never the photo's owner when avoidable), written on
// a timer without knowing who else got the same photo.
// Gallery: frames come up on the wall covered; the art dealer unveils each
// one and both titles appear at once; everyone except the two writers votes;
// each writer scores their share of the vote (100 pts split by votes).
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

const DEALER = {
  cover: ["Collectors, gather round. The next piece is still under cloth.", "Patience. Great art is worth the wait.", "Ahem. Eyes on the wall, please.", "This one caused quite a stir in the back room."],
  unveil: ["Behold. Two titles, one truth. Which speaks to you?", "The artist is anonymous. The titles are not — but you'll never know who wrote them.", "Vote with your heart. Or your spite. Both are valid here.", "I have my favourite. I am, of course, forbidden to say."],
  result: ["The room has spoken.", "A decisive verdict.", "Art is subjective. Points are not.", "Sold — to the crowd."],
};

// photo id -> data URL (humans) — outside the game state on purpose
const photos = new Map();

export const ART_GALLERY = {
  id: "artgallery", title: "Art Gallery",
  // NOTE: tagged for every vibe for this build so any party can run it; the
  // vibe filter (partyGames) is real and narrows once more games land.
  vibes: ["chill", "chaotic", "sporty"],
  blurb: "fill 3 frames with photos. title each other's. the room votes on the better title.",
  minPlayers: 3, maxPlayers: 12, length: "~8 min",

  start(ctx) {
    ui.show(); ui.theme("chill");
    const room = ctx.room;
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
    // ---- gallery scene (generated assets + code-driven tweens) ----
    // The wall: gallery.jpg backdrop, the frame hung centre, the photo masked
    // to the frame's measured opening, the cloth sprite on top, and the
    // dealer sprite (idle / unveil crossfade) at the floor. `animate` plays
    // the reveal tween (cloth slides off, dealer swaps pose) once per frame;
    // rebuilds of the same frame render the settled state so votes coming in
    // never replay it.
    const framed = (pid, s, cls = "") => {
      const src = srcOf(pid, s);
      const inset = `top:${FRAME_INSET.t}%;right:${FRAME_INSET.r}%;bottom:${FRAME_INSET.b}%;left:${FRAME_INSET.l}%`;
      return `<div class="ag-hang ${cls}"><div class="ag-photo" style="${inset}">${src ? `<img src="${src}" alt="">` : "<span>photo loading…</span>"}</div><img class="ag-frameimg" src="${ASSET}frame.png" alt=""><img class="ag-clothimg" src="${ASSET}cloth.png" alt=""></div>`;
    };
    const scene = (pid, s, { covered = false, unveil = false, animate = false, line = "" } = {}) =>
      `<div class="ag-scene ${covered ? "covered" : "revealed"} ${unveil ? "unveil" : ""} ${animate ? "ag-anim" : ""}">
        ${framed(pid, s)}
        <div class="ag-dealer"><img class="ag-pose ag-idle" src="${ASSET}dealer_idle.png" alt=""><img class="ag-pose ag-unveil" src="${ASSET}dealer_unveil.png" alt=""></div>
        ${line ? `<div class="ag-bubble">${line}</div>` : ""}
      </div>`;
    // reveal tween: the scene is built covered, then flipped on the next
    // frame so the CSS transitions (cloth off, dealer pose) actually run
    const revealed = new Set();
    function playReveal(fi) {
      const el = $("game-panel").querySelector(".ag-scene");
      if (!el) return;
      revealed.add(fi);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.remove("covered"); el.classList.add("revealed", "unveil"); }));
    }
    // numeric count-up tween for the points
    function countUp() {
      const t0 = performance.now();
      const els = [...$("game-panel").querySelectorAll("[data-count]")];
      if (!els.length) return;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 800), e = 1 - Math.pow(1 - k, 3);
        for (const el of els) el.textContent = `+${Math.round(+el.dataset.count * e)}`;
        if (k < 1 && $("game-panel").contains(els[0])) requestAnimationFrame(step);
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
        if (m.ev === "phase") { sfx.ping(); ui.toast("photos are in — now title them", "phase"); ui.resetKey(); }
        if (m.ev === "cover") { myVote = null; sfx.tick(); ui.resetKey(); }
        if (m.ev === "reveal") { sfx.chime(); buzz(40); ui.resetKey(); }
        if (m.ev === "result") { sfx.pop(); ui.resetKey(); }
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
        const ready = active.filter(p => p.photos.length >= PHOTOS_PER).length;
        if (!ui.once(`p:${mine.length}:${ready}:${active.length}:${busy ? 1 : 0}`, () => {})) return;
        const inset = `top:${FRAME_INSET.t}%;right:${FRAME_INSET.r}%;bottom:${FRAME_INSET.b}%;left:${FRAME_INSET.l}%`;
        const frames = [0, 1, 2].map(i => {
          const pid = mine[i];
          const inner = pid ? `<img src="${photos.get(pid)}" alt="">` : `<span>${busy && i === mine.length ? "loading…" : "tap to add a photo"}</span>`;
          return `<div class="pt-box ag-frame ${pid ? "" : "ag-empty"}" data-i="${i}"><div class="ag-hang"><div class="ag-photo" style="${inset}">${inner}</div><img class="ag-frameimg" src="${ASSET}frame.png" alt=""></div></div>`;
        }).join("");
        ui.stage("fill your 3 frames", `<div class="ag-frames">${frames}</div><input type="file" id="ag-file" accept="image/*" hidden>
          <p class="ab-sub">${mine.length}/${PHOTOS_PER} of yours in · ${ready}/${active.length} players ready · take a photo or pick one from your camera roll</p>${skipBtn()}`, `setup · ${ui.clock(s.left)}`);
        const inp = $("ag-file");
        $("game-panel").querySelectorAll(".ag-empty").forEach(b => b.onclick = () => { if (!busy && mine.length < PHOTOS_PER) inp.click(); });
        inp.onchange = e => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); };
        bindSkip();
      } else if (s.phase === "title") {
        const assigned = me?.assigned ?? [];
        const todo = assigned.filter(pid => !me.titles[pid] && !myTitles[pid]);
        const cur = todo[0];
        const done = active.filter(p => p.assigned.every(pid => p.titles[pid])).length;
        const has = cur ? !!srcOf(cur, s) : 0;
        if (!ui.once(`t:${cur ?? "-"}:${has ? 1 : 0}:${done}:${active.length}`, () => {})) return;
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
        if (s.sub === "covered") {
          if (!ui.once(`c:${s.fi}`, () => {})) return;
          srcOf(f.pid, s);   // warm the cache (asks the room now if we're missing it)
          ui.stage(`piece ${s.fi + 1} of ${s.frames.length}`, scene(f.pid, s, { covered: true, line: `“${DEALER.cover[s.fi % DEALER.cover.length]}”` }), "gallery");
        } else if (s.sub === "reveal") {
          const writer = f.titles.some(t => t.by === ctx.me.id);
          const voted = f.votes[ctx.me.id] ?? myVote;
          const has = !!srcOf(f.pid, s);
          const eligible = active.filter(p => !f.titles.some(t => t.by === p.id)).length;
          const votesIn = Object.keys(f.votes).length;
          if (!ui.once(`v:${s.fi}:${voted ?? "-"}:${writer ? 1 : 0}:${has ? 1 : 0}:${votesIn}`, () => {})) return;
          const first = !revealed.has(s.fi);          // play the reveal tween once per frame
          const titles = f.titles.map((t, i) => ({ value: i, label: `“${esc(t.text)}”` }));
          const body = scene(f.pid, s, { covered: first, unveil: !first, animate: first, line: `“${DEALER.unveil[s.fi % DEALER.unveil.length]}”` })
            + `<div class="ag-cards">` + (writer
              ? `<div class="choices">${titles.map(t => `<div class="ag-tcard">${t.label}</div>`).join("")}</div>`
              : ui.choices(titles, null, { picked: voted })) + `</div>`
            + (writer ? `<p class="ab-sub">you wrote one of these — the room decides</p>` : "")
            + `<p class="ab-sub">${votesIn}/${eligible} votes in</p>${skipBtn()}`;
          ui.stage("which title wins?", body, `vote · ${ui.clock(s.left)}`);
          if (first) playReveal(s.fi);
          if (!writer) ui.bindChoices(v => { myVote = +v; game.input("vote", { idx: +v }); sfx.pop(); ui.resetKey(); });
          bindSkip();
        } else if (s.sub === "result") {
          const has = !!srcOf(f.pid, s);
          if (!ui.once(`r:${s.fi}:${has ? 1 : 0}`, () => {})) return;
          const c = f.counts || [0, 0], pts = f.pts || [0, 0];
          const top = c[0] === c[1] ? null : (c[0] > c[1] ? 0 : 1);
          const rows = f.titles.map((t, i) => `<div class="rev-row ${top === i ? "win" : ""}"><span>“${esc(t.text)}” <small>— ${esc(s.players[t.by]?.handle ?? "?")}</small></span><b>${c[i]} vote${c[i] === 1 ? "" : "s"} · <span data-count="${pts[i]}">+0</span></b></div>`).join("");
          const head = top === null ? "split decision" : `${esc(s.players[f.titles[top].by]?.handle ?? "?")} takes it`;
          ui.stage(head, scene(f.pid, s, { unveil: true, line: `“${DEALER.result[s.fi % DEALER.result.length]}”` }) + `<div class="ag-result">${rows}</div><p class="ab-sub">photo by ${esc(owner)}</p>`, "result");
          countUp();
        }
      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const ranked = P.slice().sort((a, b) => b.score - a.score);
        ui.stage("final scores", `<ol class="podium">${ranked.map(p => `<li><b>${esc(p.handle)}</b><span>${p.score} pts</span></li>`).join("")}</ol>
          ${s.why ? `<p class="ab-sub">${esc(s.why)}</p>` : ""}${s.dropped ? `<p class="ab-sub">${s.dropped} piece${s.dropped === 1 ? "" : "s"} left in storage (frame cap ${MAX_FRAMES})</p>` : ""}
          <p class="ab-sub">back to the party in a moment</p>${skipBtn()}`, "Art Gallery");
        bindSkip();
      }
    }

    game.start({ phase: "photos", left: PHOTO_MS, players: {}, pool: {}, dealt: [], frames: [], fi: 0, sub: null, why: null, dropped: 0 });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); room.off("agphoto", onPhoto); room.off("agneed", onNeed); ui.hide(); o(); };
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

// party catalog: add games here; partyGames() narrows by the party's vibe
export const PARTY_CATALOG = [ART_GALLERY];
export function partyGames(vibe) { return PARTY_CATALOG.filter(g => g.vibes.includes(vibe)); }
