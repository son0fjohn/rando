// The dialog box every game's NPC talks through (Side Quest's Prophet first;
// the Ritual's clown and the map NPCs next): a dark navy box, ~85% opaque,
// with a thin light bevelled border, the speaker's name on a tab at its top
// left, big text in the app's font that types out letter by letter with a
// soft blip, and
// a blinking ▼ when it's done. Tap while it types to show the rest. Choices
// come up as a stack of boxes in the same style.
//
//   const d = dialogBox(hostEl, { name: "The Prophet" });
//   await d.say("Relax. The ball already knows who's next...");   // resolves when typed (or skipped)
//   d.say("Relax. The ball already knows who's next... Mina.", { cont: true });   // types on from where it is
//   const v = await d.choose([{ label: "Accept", value: "ok" }, { label: "Give up", value: "no" }]);
//   d.hide(); d.show(); d.dispose();
//
// Korean and English both: text is typed by grapheme (Intl.Segmenter when
// the browser has it) in the app's system font (SF Pro, Apple SD Gothic Neo
// for Korean). The box's size is reserved up front, so it never grows while
// it types. Styles: theme.css `.dlg-*`.
//
//   d.quip("Patience.");   // a passing remark: shown, then the line before it comes back (choices stay)
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const seg = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const graphemes = s => (seg ? [...seg.segment(s)].map(x => x.segment) : [...s]);

export function dialogBox(host, { name = "", blip = null, cps = 34, cls = "" } = {}) {
  const el = document.createElement("div");
  el.className = `dlg ${cls}`;
  el.innerHTML = `<div class="dlg-name" hidden></div><div class="dlg-box" role="dialog" aria-live="polite"><p class="dlg-text"><span class="dlg-typed"></span><span class="dlg-rest"></span></p><i class="dlg-more" aria-hidden="true"></i></div><div class="dlg-choices" hidden></div>`;
  host.appendChild(el);
  const nameEl = el.querySelector(".dlg-name"), box = el.querySelector(".dlg-box");
  const typed = el.querySelector(".dlg-typed"), rest = el.querySelector(".dlg-rest"), choices = el.querySelector(".dlg-choices");
  let timer = null, done = true, finish = () => {}, line = "", alive = true, quipT = null, quipBack = "";
  const setName = n => { nameEl.textContent = n ?? ""; nameEl.hidden = !n; };
  setName(name);

  // type `text` out; resolves once it's all on screen
  function say(text, { name: who, instant = false, cont = false, keepChoices = false } = {}) {
    if (who !== undefined) setName(who);
    clearInterval(timer); clearTimeout(quipT); quipT = null;
    const was = line;
    line = String(text ?? "");
    const chars = graphemes(line);
    el.hidden = false;
    if (!keepChoices) { choices.hidden = true; choices.innerHTML = ""; }
    box.classList.remove("done");
    typed.textContent = ""; rest.textContent = line;            // the full line reserves its space
    done = false;
    return new Promise(res => {
      finish = () => { clearInterval(timer); typed.textContent = line; rest.textContent = ""; if (!done) { done = true; box.classList.add("done"); res(); } };
      if (instant || reduce() || !chars.length) { finish(); return; }
      // `cont`: the new line starts with the old one, so keep what's typed
      let i = cont && was && line.startsWith(was) ? graphemes(was).length : 0;
      typed.textContent = chars.slice(0, i).join(""); rest.textContent = chars.slice(i).join("");
      timer = setInterval(() => {
        if (!alive) { clearInterval(timer); return; }
        i++;
        typed.textContent = chars.slice(0, i).join("");
        rest.textContent = chars.slice(i).join("");
        if (i % 2 === 1 && !/\s/.test(chars[i - 1])) blip?.();
        if (i >= chars.length) finish();
      }, 1000 / cps);
    });
  }
  // the same line, already on screen (a guest who arrives mid-beat)
  const set = (text, opts = {}) => (line === text && done ? Promise.resolve() : say(text, { ...opts, instant: true }));

  // a stack of choices in the same style; resolves with the picked value
  // `row`: side by side (a 1-5 rating) instead of stacked
  function choose(list, { onPick = null, row = false } = {}) {
    choices.classList.toggle("row", !!row);
    choices.innerHTML = list.map((c, i) => `<button type="button" class="dlg-choice ${c.cls ?? ""}" data-i="${i}">${escapeHtml(c.label)}</button>`).join("");
    choices.hidden = false;
    return new Promise(res => {
      choices.querySelectorAll("button").forEach(b => b.onclick = e => {
        e.stopPropagation();
        const c = list[+b.dataset.i];
        onPick?.(c.value, b);
        if (c.keep) return;                                    // e.g. "tap again to give up"
        choices.hidden = true;
        res(c.value);
      });
    });
  }

  // a passing remark that doesn't take over: the line it interrupted (and
  // its choices) come back after `ms`, unless something new was said
  function quip(text, { ms = 2600 } = {}) {
    const back = quipT ? quipBack : line;      // a second quip still goes back to the real line
    quipBack = back;
    say(text, { keepChoices: true });
    quipT = setTimeout(() => { quipT = null; say(back, { instant: true, keepChoices: true }); }, ms);
  }

  el.addEventListener("click", () => { if (!done) finish(); });
  return {
    el, say, set, choose, quip,
    get quipping() { return !!quipT; },
    get done() { return done; },
    get text() { return line; },
    skip: () => finish(),
    clearChoices() { choices.hidden = true; choices.innerHTML = ""; },
    hide() { el.hidden = true; },
    show() { el.hidden = false; },
    attach(to) { if (to && el.parentNode !== to) to.appendChild(el); },
    dispose() { alive = false; clearInterval(timer); clearTimeout(quipT); el.remove(); },
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
