// How to play, told in the game itself: before the first turn the game's
// host explains it in the game's own dialog box, two to four short lines,
// each with a small gesture (the Prophet shows the ball, the Boss holds up a
// capsule, Bunny presents the frame, the Hunter taps his tracker), and the
// room stays on screen. Mask Off and Secret Diary have no host: the same
// lines come up in their dialog box, in the same place.
//
// The first time on this phone it's the whole thing; after that one short
// line, with a "How to play" button that plays the whole thing again.
//
// It's a phase of the game ("howto", host-authoritative, drop-safe): it ends
// once every present player has heard it (bots have), when its clock runs
// out, or when the host skips it.
//
//   host:   phase { name: "howto", ms: HOWTO_MS, enter: s => { s.howto = {} }, done: howtoDone }
//           hostInput: if (howtoInput(s, m)) return;
//   phone:  const how = howto("sidequest", { dlg, gesture: act => ..., send: v => game.input(v) });
//           in render: s.phase === "howto" ? how.render(s, actionEl) : how.stop();
import { active, esc } from "./hpkit.js";
import { lang } from "./i18n.js";
import { sfx } from "./fx.js";

export const HOWTO_MS = 40000;          // the backstop; normally it ends when everyone's heard it
const PAUSE_MS = 1500;                  // a beat after each line (a tap moves on)
const KEY = id => `rando-howto-${id}`;

// [line, gesture]; the gesture names are each host's own (the game maps them)
export const HOWTO = {
  sidequest: {
    en: {
      full: [["Sit. My ball picks one of you.", "ball"], ["Then it hands you a quest. A real one, out there.", "card"],
        ["Three minutes. Everyone else films you.", "point"], ["Then they rate how hard you committed. One to five stars.", "nod"]],
      short: ["The ball picks. You do the quest. They rate it.", "ball"],
    },
    ko: {
      full: [["앉아. 내 구슬이 한 명을 골라.", "ball"], ["그리고 퀘스트를 줘. 진짜로, 밖에서 하는 거.", "card"],
        ["3분. 나머지는 널 찍어.", "point"], ["그리고 얼마나 진심이었는지 별점을 매겨. 1점부터 5점.", "nod"]],
      short: ["구슬이 고르고, 넌 하고, 다들 평가해.", "ball"],
    },
  },
  ritual: {
    en: {
      full: [["One of you gets a capsule. Only you see what's inside.", "capsule"], ["Act it out. No words. No spelling.", "shh"],
        ["Everyone else types guesses. Faster pays more.", "point"], ["The performer taps the right guess. Not me. Them.", "nod"]],
      short: ["Capsule. Act it out. They guess. You know the drill.", "capsule"],
    },
    ko: {
      full: [["한 명이 캡슐을 받아. 안에 뭐가 있는지는 너만 봐.", "capsule"], ["연기해. 말 없이. 철자도 안 돼.", "shh"],
        ["나머지는 정답을 쳐. 빠를수록 많이 받아.", "point"], ["맞는 답은 연기한 사람이 골라. 내가 아니라.", "nod"]],
      short: ["캡슐, 연기, 정답. 알지?", "capsule"],
    },
  },
  artgallery: {
    en: {
      full: [["Everyone gives me three photos. Anything. I've seen worse.", "frame"], ["Then you title a few. Someone else titles the same one.", "present"],
        ["I hang each with two titles. Pick the one that fits.", "gavel"], ["Your title earns a share of the votes. Make me laugh.", "judge"]],
      short: ["Photos. Titles. Votes. Make me laugh.", "frame"],
    },
    ko: {
      full: [["다들 사진 세 장씩 주세요. 뭐든요. 더한 것도 봤어요.", "frame"], ["그다음 몇 장에 제목을 붙여요. 같은 사진에 다른 사람도 붙여요.", "present"],
        ["제목 두 개를 걸어 둘게요. 더 어울리는 걸 고르세요.", "gavel"], ["표를 받은 만큼 점수예요. 절 웃겨 보세요.", "judge"]],
      short: ["사진. 제목. 투표. 절 웃겨 보세요.", "frame"],
    },
  },
  "manhunt.runner": {
    en: {
      full: [["You're a runner. Hide inside the gold zone.", "tap"], ["Every few minutes I show the hunters a fuzzy circle. Never your spot.", "point"],
        ["On foot only. Watch traffic. No going inside homes or shops.", "warn"], ["Need a break? SAFE hides you and stops your clock.", "nod"]],
      short: ["Runner. Stay in the zone, on foot. Watch traffic.", "tap"],
    },
    ko: {
      full: [["넌 러너야. 금색 구역 안에 숨어.", "tap"], ["몇 분마다 헌터들한테 흐릿한 원을 보여 줘. 정확한 위치는 절대 아니야.", "point"],
        ["걸어서만. 차 조심. 집이나 가게 안으로 들어가지 마.", "warn"], ["쉬고 싶으면 SAFE. 숨겨 주고 시간도 멈춰.", "nod"]],
      short: ["러너. 구역 안에서, 걸어서. 차 조심.", "tap"],
    },
  },
  "manhunt.hunter": {
    en: {
      full: [["You're a hunter. Every few minutes I show you roughly where they were.", "tap"], ["Find them on foot. Tag them in person; they confirm on their phone.", "point"],
        ["On foot only. Watch traffic. No going inside homes or shops.", "warn"], ["Keep your screen on. Then go get them.", "nod"]],
      short: ["Hunter. On foot, in person. Watch traffic.", "tap"],
    },
    ko: {
      full: [["넌 헌터야. 몇 분마다 그들이 대충 어디 있었는지 보여 줄게.", "tap"], ["걸어서 찾아. 직접 터치하면 상대가 폰에서 확인해.", "point"],
        ["걸어서만. 차 조심. 집이나 가게 안으로 들어가지 마.", "warn"], ["화면은 켜 둬. 그럼 잡으러 가.", "nod"]],
      short: ["헌터. 걸어서, 직접. 차 조심.", "tap"],
    },
  },
  mask_off: {
    en: {
      full: [["Pick someone. Ask them a card from your hand.", null], ["They answer out loud, or pass. Passing is fine.", null],
        ["Tap Same when it's you too. Nobody sees who tapped.", null], ["No points tonight. Just masks off.", null]],
      short: ["Ask a card. Answer out loud, or pass. Tap Same.", null],
    },
    ko: {
      full: [["한 명을 골라. 손에 든 카드로 질문해.", null], ["소리 내서 답하거나 패스해. 패스해도 괜찮아.", null],
        ["나도 그렇다면 \"나도\"를 눌러. 누가 눌렀는지는 아무도 몰라.", null], ["오늘은 점수 없어. 가면만 벗는 거야.", null]],
      short: ["카드로 질문해. 소리 내서 답하거나 패스. \"나도\".", null],
    },
  },
  secretdiary: {
    en: {
      full: [["Everyone answers the same questions, in secret.", null], ["Then the diaries open, one question at a time. No names on them.", null],
        ["Guess who wrote what. A point for every right guess.", null], ["Nobody ever finds out for sure. Not even at the end.", null]],
      short: ["Answer in secret. Then guess who wrote what.", null],
    },
    ko: {
      full: [["다들 같은 질문에 몰래 답해요.", null], ["그다음 일기장이 하나씩 열려요. 이름은 없어요.", null],
        ["누가 뭘 썼는지 맞혀요. 맞힐 때마다 1점.", null], ["정답은 아무도 몰라요. 끝까지요.", null]],
      short: ["몰래 답하고, 누가 썼는지 맞혀요.", null],
    },
  },
};
const BTN = {
  en: { got: "Got it", go: "Let's go", how: "How to play", wait: "waiting for everyone…" },
  ko: { got: "알겠어", go: "시작", how: "게임 방법", wait: "다들 기다리는 중…" },
};
// does this game start with the how-to? (always, in the app; the logic
// specs turn it off with ctx.howto = false)
export const howtoOn = ctx => ctx?.howto !== false;
export const howtoLines = id => (HOWTO[id]?.[lang] ?? HOWTO[id]?.en);

// ---- the host
export function howtoInput(s, m) {
  if (m.in !== "howto-ok" && m.in !== "howto-more") return false;
  if (s.phase !== "howto" || !s.players?.[m.from]) return true;
  s.howto ??= {};
  if (m.in === "howto-ok") s.howto[m.from] = 1; else delete s.howto[m.from];
  return true;
}
const listeners = s => active(s).filter(p => !p.isBot);
export const howtoDone = s => listeners(s).every(p => s.howto?.[p.id]);
// "2/4 ready"
export const howtoTally = s => `${listeners(s).filter(p => s.howto?.[p.id]).length}/${listeners(s).length}`;

// ---- the phone: plays the lines in `dlg`, the buttons go in the game's action area
// (`auto: false`: nobody's counted in until they tap `go`, e.g. Manhunt's
// "I'm in", which asks for location; `note`: a line of fine print under the buttons)
export function howto(id, { dlg, gesture = () => {}, send, name = null, auto = true, go = null, note = "" } = {}) {
  let seen = false;
  try { seen = !!localStorage.getItem(KEY(id)); } catch {}
  let mode = null, at = null, tok = 0, i = 0, sent = false, skipNext = null, phaseKey = null;
  const B = () => BTN[lang] ?? BTN.en;
  const markSeen = () => { try { localStorage.setItem(KEY(id), "1"); } catch {} seen = true; };
  const ready = () => { if (!sent) { sent = true; send("howto-ok"); } paint(); };
  function paint() {
    if (!at?.isConnected) return;
    const b = B();
    const html = (mode === "full" && i < (howtoLines(id)?.full.length ?? 0)
      ? `<div class="gs-row"><button type="button" class="gs-btn" data-how="skip">${esc(b.got)}</button></div>`
      : `<div class="gs-row">${sent ? `<span class="gs-wait">${esc(b.wait)}</span>` : `<button type="button" class="gs-btn gold" data-how="go">${esc(go ?? b.go)}</button>`}<button type="button" class="gs-btn" data-how="more">${esc(b.how)}</button></div>`)
      + (note ? `<p class="gs-note">${note}</p>` : "");
    if (at.dataset.how === html) return;
    at.dataset.how = html; at.innerHTML = html;
    at.querySelectorAll("[data-how]").forEach(el => el.onclick = e => {
      e.stopPropagation();
      const k = el.dataset.how;
      sfx.cursor?.();
      if (k === "skip") { tok++; i = Infinity; markSeen(); if (auto) ready(); else paint(); dlg.set?.(howtoLines(id).short[0]); }
      if (k === "go") ready();
      if (k === "more") { if (sent) { sent = false; send("howto-more"); } play("full"); }
    });
  }
  async function play(m) {
    const my = ++tok;
    mode = m; i = 0;
    const L = howtoLines(id);
    if (!L) { ready(); return; }
    const list = m === "full" ? L.full : [L.short];
    globalThis.__howto = { id, mode: m };           // (tests)
    paint();
    for (; i < list.length; i++) {
      if (my !== tok) return;
      const [text, act] = list[i];
      try { gesture(act, i); } catch (e) { console.warn("[howto]", e); }
      dlg.show?.();
      if (name !== null) await dlg.say(text, { name }); else await dlg.say(text);
      if (my !== tok) return;
      // a beat to read it; a tap on the dialog moves on
      await new Promise(res => { const t = setTimeout(res, PAUSE_MS + text.length * 18); skipNext = () => { clearTimeout(t); res(); }; });
      skipNext = null;
    }
    if (my !== tok) return;
    i = list.length;
    if (m === "full") markSeen();
    if (auto) ready(); else paint();
  }
  dlg.el?.addEventListener("click", () => { if (dlg.done) skipNext?.(); });
  return {
    // every render while s.phase === "howto": `el` is the game's action area
    render(s, el) {
      const k = `${s.gameId ?? ""}:${s.ti ?? 0}`;
      if (k !== phaseKey) { phaseKey = k; sent = false; play(seen ? "short" : "full"); }
      if (el !== at) { at = el; if (at) at.dataset.how = ""; }
      paint();
    },
    stop() { if (mode === null && phaseKey === null) return; tok++; mode = null; phaseKey = null; skipNext = null; if (at?.isConnected && at.dataset.how) { at.innerHTML = ""; at.dataset.how = ""; } at = null; },
    get playing() { return mode !== null; },
  };
}
