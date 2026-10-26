// Manhunt's elevator moments (the Hunter: hunter.js), one scene reused:
//   intro(lines)     full screen: the doors open on him, he says the rules
//                    in a few short lines, the doors close
//   ping(line, n)    a small window slides up over the map: the floor
//                    counter ticks 3... 2... 1..., ding, the doors open, a
//                    short line, then it slides away
//   wait(text)       the hunters' "no peeking" screen in the head start:
//                    the doors shut, the counter showing the minutes left
//   results(line, posterHtml)   the doors open one last time: him and the
//                    WANTED posters
// Vibration only by default (a ding could give a hiding spot away): the
// ding plays only when `sound` is on. Where WebGL won't start (or ?mh3d=0)
// the same moments play as a card with his dialog box.
import { dialogBox } from "./dialog.js";
import { sfx, buzz } from "./fx.js";

const params = new URLSearchParams(location.search);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function mhScene(layer) {
  const el = document.createElement("div");
  el.className = "mh-elev";
  el.hidden = true;
  el.innerHTML = `<div class="mh-elev-stage"></div><div class="mh-elev-over"></div><div class="mh-elev-dlg"></div>`;
  layer.appendChild(el);
  const stageEl = el.querySelector(".mh-elev-stage"), over = el.querySelector(".mh-elev-over");
  const dlg = dialogBox(el.querySelector(".mh-elev-dlg"), { name: "The Hunter", blip: () => sfx.blip?.() });
  let h = null, loading = null, failed = params.get("mh3d") === "0", token = 0;
  const api = { sound: false, onTap: null };
  function scene() {
    if (globalThis.__mh3dOff) failed = true;   // (the logic tests: many phones, one page, no 3D)
    if (h || failed) return Promise.resolve(h);
    loading ??= import("./hunter.js").then(m => m.hunterScene(stageEl)).then(x => {
      h = x;
      h.onTap = kind => {
        if (kind === "panel") { if (api.sound) sfx.blip?.(); buzz?.(20); return true; }
        if (kind === "hunter") { api.onTap?.("hunter"); return true; }
        if (kind === "light" || kind === "counter") return true;
        return false;
      };
      return h;
    }).catch(e => { console.warn("[manhunt] the elevator didn't start:", e?.message ?? e); failed = true; el.classList.add("flat"); return null; });
    return loading;
  }
  const show = mode => { el.hidden = false; el.className = `mh-elev ${mode}${failed ? " flat" : ""}`; };
  const hide = () => { el.hidden = true; over.innerHTML = ""; dlg.hide?.(); };
  const ding = () => { if (api.sound) sfx.ding?.(); buzz?.([60, 40, 60]); };
  async function say(line) { dlg.show?.(); await dlg.say(line); await sleep(900); }

  return Object.assign(api, {
    el, preload: scene,
    get scene() { return h; },
    get flat() { return failed; },
    async intro(lines = []) {
      const my = ++token;
      show("full");
      const s = await scene();
      s?.room.doors(false, { instant: true }); s?.room.counter("1");
      await sleep(600);
      s?.room.doors(true); ding();
      s?.play("smirk");
      for (const l of lines) { if (my !== token) return; await say(l); }
      if (my !== token) return;
      s?.room.doors(false);
      await sleep(1200);
      if (my === token) hide();
    },
    async ping(line, n = 1) {
      const my = ++token;
      show("small");
      const s = await scene();
      s?.room.doors(false, { instant: true });
      over.innerHTML = `<div class="mh-elev-count"></div>`;
      const cnt = over.firstChild;
      for (const k of [3, 2, 1]) { if (my !== token) return; s?.room.counter(String(k)); cnt.textContent = `${k}`; await sleep(700); }
      cnt.remove();
      s?.room.counter("PING"); ding();
      s?.room.doors(true); s?.play("tap");
      await say(line);
      if (my !== token) return;
      s?.room.doors(false);
      await sleep(900);
      if (my === token) hide();
      return n;
    },
    async wait(text) {
      ++token;
      show("full wait");
      const s = await scene();
      s?.room.doors(false);
      over.innerHTML = `<div class="mh-wait"><b>No peeking.</b><span class="mh-wait-t">${text}</span></div>`;
      dlg.hide?.();
    },
    waitText(text, counter) { const t = over.querySelector(".mh-wait-t"); if (t) t.textContent = text; if (counter) h?.room.counter(counter); },
    async results(line, posterHtml = "") {
      ++token;
      show("full results");
      const s = await scene();
      s?.room.doors(false, { instant: true });
      await sleep(400);
      s?.room.doors(true); ding();
      s?.play("point");
      over.innerHTML = `<div class="mh-held">${posterHtml}</div>`;
      await say(line);
    },
    quip(line) { if (!el.hidden) dlg.quip?.(line); },
    hide() { ++token; hide(); },
    dispose() { ++token; h?.dispose(); dlg.dispose?.(); el.remove(); },
  });
}
