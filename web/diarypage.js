// Secret Diary: answers laid out on the open diary's two pages, always fitting.
//
// A "spread" is the open diary drawn big (diary3d's tight "spread" still, or
// a CSS book when 3D can't run) with the text flowing over its two pages as
// two columns: the left page, then the right. The same layout is used while
// you write (the pages are the text box) and when a diary is read on reveal,
// so an answer looks the same in both places.
//
// Fitting: the font shrinks a step at a time until the text fits one spread,
// down to FIT_MIN. Past that it keeps FIT_MIN and flows onto a second spread
// (CSS columns overflow sideways): a small page-turn arrow flips between them.
// Shelf diaries are too small for that, so their preview shrinks further and
// fades out with a "…" (tap the diary to read it big).
export const ANSWER_MAX = 150;
export const FIT_MIN = 14;
const FIT_MAX = 24;

// the open diary + its text area. `text` is plain text (escaped here);
// `edit` makes the pages the text box (contenteditable, plain text only).
export function spreadHtml({ hex, text = "", edit = null, cls = "" }) {
  const body = esc(text);
  const flow = edit
    ? `<div class="sd-sp-flow sd-in" contenteditable="plaintext-only" role="textbox" aria-multiline="true" spellcheck="false" autocapitalize="sentences" enterkeyhint="next"
        data-k="${edit.k}" data-ph="${esc(edit.placeholder ?? "write it here…")}" aria-label="${esc(edit.label ?? "your answer")}">${body}</div>`
    : `<div class="sd-sp-flow">${body}</div>`;
  return `<div class="sd-spread ${cls}" style="--dc:${hex}">
      <div class="sd-sp-vis"><i class="sd-sp-book"></i></div>
      <div class="sd-sp-text">${flow}</div>
      <button type="button" class="sd-sp-turn prev" aria-label="previous page" hidden>&#9664;</button>
      <button type="button" class="sd-sp-turn next" aria-label="next page" hidden>&#9654;</button>
      <span class="sd-sp-pg" hidden></span>
    </div>`;
}

// draw the diary still into every spread under `root` (3D kit or CSS book)
export function paintSpreads(root, kit) {
  root.querySelectorAll(".sd-spread").forEach(sp => {
    const v = sp.querySelector(".sd-sp-vis");
    if (!kit || v.querySelector("img")) return;
    try {
      const hex = sp.style.getPropertyValue("--dc").trim();
      v.insertAdjacentHTML("afterbegin", `<img alt="" src="${kit.snapshot("spread", hex, 640, 0)}">`);
      sp.classList.add("has-img");
    } catch (e) { console.warn("[diary] spread still failed, CSS book instead", e); }
  });
}

// lay out one spread: biggest font that fits one spread, else FIT_MIN and
// pages. Safe to call again any time (typing, resize, fonts arriving).
export function fitSpread(sp) {
  const box = sp.querySelector(".sd-sp-text"), flow = sp.querySelector(".sd-sp-flow");
  if (!styled() || !box || !flow || !box.clientWidth) return { size: null, pages: 1 };
  // biggest size where it all fits one spread without breaking a word
  // (words longer than a whole page line still break, at FIT_MIN)
  const colW = (box.clientWidth - gapPx(flow)) / 2;
  const words = textOf(flow).split(/\s+/).filter(Boolean);
  let size = FIT_MIN;
  for (let px = FIT_MAX; px > FIT_MIN; px--) {
    flow.style.fontSize = `${px}px`;
    if (spreadsOf(box, flow) <= 1 && longestWord(flow, words, px) <= colW) { size = px; break; }
  }
  flow.style.fontSize = `${size}px`;
  const pages = spreadsOf(box, flow);
  sp.dataset.pages = String(pages);
  sp.dataset.size = String(size);
  let page = Math.min(+sp.dataset.page || 0, pages - 1);
  if (flow.isContentEditable && document.activeElement === flow) page = caretPage(sp) ?? page;
  turnTo(sp, page);
  return { size, pages };
}

// how many two-page spreads the text needs at the current size
function spreadsOf(box, flow) {
  box.scrollLeft = 0;
  const gap = gapPx(flow);
  const w = box.clientWidth;
  return Math.max(1, Math.ceil((flow.scrollWidth + gap - 2) / (w + gap)));
}

// the column gap in px (it's a % of the text box in CSS)
function gapPx(flow) {
  const g = getComputedStyle(flow).columnGap;
  return g.endsWith("%") ? parseFloat(g) / 100 * flow.clientWidth : parseFloat(g) || 0;
}
let measure = null;
function longestWord(flow, words, px) {
  if (!words.length) return 0;
  const st = getComputedStyle(flow);
  measure ??= document.createElement("canvas").getContext("2d");
  measure.font = `${st.fontStyle} ${st.fontWeight} ${px}px ${st.fontFamily}`;
  return Math.max(...words.map(w => measure.measureText(w).width));
}

function turnTo(sp, page) {
  const box = sp.querySelector(".sd-sp-text"), flow = sp.querySelector(".sd-sp-flow");
  const pages = +sp.dataset.pages || 1;
  page = Math.max(0, Math.min(pages - 1, page));
  const prevPage = +sp.dataset.page || 0;
  sp.dataset.page = String(page);
  const gap = gapPx(flow);
  flow.style.transform = page ? `translateX(${-page * (box.clientWidth + gap)}px)` : "";
  box.scrollLeft = 0;
  const pv = sp.querySelector(".sd-sp-turn.prev"), nx = sp.querySelector(".sd-sp-turn.next"), pg = sp.querySelector(".sd-sp-pg");
  pv.hidden = page === 0;
  nx.hidden = page >= pages - 1;
  pg.hidden = pages < 2;
  pg.textContent = `${page + 1}/${pages}`;
  if (page !== prevPage) { sp.classList.remove("turned"); void sp.offsetWidth; sp.classList.add("turned"); }
}

// which spread the text caret is on (writing), or null when it can't tell
function caretPage(sp) {
  const sel = window.getSelection?.();
  if (!sel || !sel.rangeCount) return null;
  const box = sp.querySelector(".sd-sp-text"), flow = sp.querySelector(".sd-sp-flow");
  if (!flow.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0).getClientRects()[0];
  if (!r) return null;
  const gap = gapPx(flow);
  const cur = (+sp.dataset.page || 0) * (box.clientWidth + gap);
  const x = r.left - box.getBoundingClientRect().left + cur;
  return Math.max(0, Math.floor(x / (box.clientWidth + gap)));
}

// wire the page-turn arrows (and, for a writing spread, keep the caret's page
// in view and the text under ANSWER_MAX). onText(text) gets every edit.
export function bindSpread(sp, { onText = null, onEnter = null } = {}) {
  sp.querySelector(".sd-sp-turn.prev").onclick = e => { e.stopPropagation(); turnTo(sp, (+sp.dataset.page || 0) - 1); };
  sp.querySelector(".sd-sp-turn.next").onclick = e => { e.stopPropagation(); turnTo(sp, (+sp.dataset.page || 0) + 1); };
  const box = sp.querySelector(".sd-sp-text");
  box.addEventListener("scroll", () => { if (box.scrollLeft) box.scrollLeft = 0; });   // paging is ours, not the browser's
  const flow = sp.querySelector(".sd-sp-flow");
  if (flow.isContentEditable || flow.getAttribute("contenteditable")) {
    // Firefox before plaintext-only: fall back to a plain editable box
    if (!flow.isContentEditable) flow.setAttribute("contenteditable", "true");
    flow.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); onEnter?.(); }
    });
    flow.addEventListener("paste", e => {
      e.preventDefault();
      const t = (e.clipboardData?.getData("text/plain") ?? "").replace(/\s+/g, " ");
      document.execCommand("insertText", false, t.slice(0, Math.max(0, ANSWER_MAX - textOf(flow).length)));
    });
    flow.addEventListener("input", () => {
      let t = textOf(flow);
      if (t.length > ANSWER_MAX || /\n/.test(flow.innerText ?? "") || flow.children.length) {
        t = t.replace(/\s+/g, " ").slice(0, ANSWER_MAX);
        flow.textContent = t;
        placeCaretAtEnd(flow);
      }
      sp.classList.toggle("empty", !t);
      fitSpread(sp);
      onText?.(t);
    });
    followCaret();
    sp.classList.toggle("empty", !textOf(flow));
  }
}

// one listener for the whole page: the focused writing spread keeps its
// caret's page in view
let following = false;
function followCaret() {
  if (following) return;
  following = true;
  document.addEventListener("selectionchange", () => {
    const flow = document.activeElement;
    if (!flow?.classList?.contains("sd-sp-flow")) return;
    const sp = flow.closest(".sd-spread"); if (!sp) return;
    const p = caretPage(sp);
    if (p !== null && p !== (+sp.dataset.page || 0)) turnTo(sp, p);
  });
}

export const textOf = flow => (flow.textContent ?? "").replace(/ /g, " ");

function placeCaretAtEnd(el) {
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

// refit every spread under root now, once the fonts are in, and on resize
// is the diary CSS on this page? (not on the logic-test page, where every
// render would otherwise force a style recalc for nothing). Checked once.
let cssOn = null;
function styled() {
  if (cssOn === null) {
    const d = document.createElement("div"); d.className = "sd-sp-text";
    document.body.appendChild(d); cssOn = getComputedStyle(d).position === "absolute"; d.remove();
  }
  return cssOn;
}

export function fitAll(root) {
  if (!styled()) return;
  const run = () => root.querySelectorAll(".sd-spread").forEach(fitSpread);
  run();
  document.fonts?.ready?.then(() => { if (root.isConnected) run(); });
  if (typeof ResizeObserver === "function") {
    // refit when a spread's width changes (rotation, keyboard), not on every
    // size wobble — fitting changes the text, never the spread's width
    const ro = new ResizeObserver(entries => {
      if (!root.isConnected) { ro.disconnect(); return; }
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        if (e.target._fitW !== w) { e.target._fitW = w; fitSpread(e.target); }
      }
    });
    root.querySelectorAll(".sd-spread").forEach(sp => ro.observe(sp));
  }
}

// a shelf diary's preview: shrink to fit its little page, or fade out with "…"
export function fitPreview(el, { max = 13, min = 9 } = {}) {
  if (!el.clientHeight) return;
  el.classList.remove("more");
  for (let px = max; px >= min; px--) {
    el.style.fontSize = `${px}px`;
    if (el.scrollHeight <= el.clientHeight + 1) return;
  }
  el.classList.add("more");
}

// same as hpkit's esc(); kept local so this module loads without the party stack
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
