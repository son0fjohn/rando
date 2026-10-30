// Text contrast as drawn (WCAG), for the browser tests: every piece of text,
// placeholder and icon inside the given roots is compared with the median of
// what's behind its own box, from a shot with all their ink made invisible
// (the glass over the map, a gold button…). Text needs 4.5:1; large text
// (24px, or 18.67px bold), symbols and icons 3:1.
//   const rows = await measure(page, [".glass", "#party-panel:not(.pt-lobby)"])
//   -> [{ key, ratio, need, ink, bg, size }]
// Used by test/glass_contrast.mjs and test/glass_shots.mjs --contrast.

async function cdpShot(pg) {
  const cdp = await pg.context().newCDPSession(pg);
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  await cdp.detach().catch(() => {});
  return r.data;
}

export async function measure(pg, roots) {
  await pg.evaluate(() => {
    if (document.getElementById("__hide-ink-css")) return;
    const st = document.createElement("style"); st.id = "__hide-ink-css";
    st.textContent = `.__hide-ink, .__hide-ink * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
      .__hide-ink svg, .__hide-ink svg * { fill: transparent !important; stroke: transparent !important; } .__hide-ink *::placeholder { color: transparent !important; }`;
    document.head.appendChild(st);
  });
  const items = await pg.evaluate(roots => {
    const vis = el => { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && el.getClientRects().length > 0; };
    const Rs = [...new Set(roots.flatMap(sel => [...document.querySelectorAll(sel)]))].filter(vis)
      .filter((r, _, all) => !all.some(o => o !== r && o.contains(r)));               // (outermost only)
    const out = [], seen = new Set();
    const label = el => (el.id ? `#${el.id}` : "") + (el.className && typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).filter(c => !c.startsWith("__")).slice(0, 2).join(".") : "") || el.tagName.toLowerCase();
    const alphaOf = el => { let a = 1; for (let e = el; e; e = e.parentElement) a *= +getComputedStyle(e).opacity; return a; };
    // what's measured: on top where it's drawn (not under a scrim or a sheet), not
    // disabled (WCAG leaves inactive controls out), not an emoji, not the map
    // data's credit line
    const onTop = (el, box) => { const h = document.elementFromPoint(box[0] + box[2] / 2, box[1] + box[3] / 2); return !!h && (h === el || el.contains(h) || h.contains(el)); };
    const skip = el => !!el.closest(":disabled, [aria-disabled='true'], .short, .st-credit, #osm-credit, .hp-av");     // (.hp-av: a player's own colour, their initial)
    const EMOJI = /\p{Extended_Pictographic}/u;
    for (const R of Rs) {
      const path = el => { const p = []; for (let e = el; e && p.length < 3; e = e.parentElement) { p.unshift(label(e)); if (e === R) break; } return p.join(" > "); };
      for (const el of [R, ...R.querySelectorAll("*")]) {
        if (!vis(el) || seen.has(el)) continue;
        seen.add(el);
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        const txt = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(" ");
        if (skip(el)) continue;
        if (txt && !EMOJI.test(txt)) {
          const range = document.createRange(); range.selectNodeContents([...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()));   // (its own text, not a child's pill)
          const rr = [...range.getClientRects()].find(q => q.width > 2 && q.height > 2) ?? r;
          const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700;
          const glyph = [...txt].length <= 2 && !/[\p{L}\p{N}]/u.test(txt);      // (✕, ◀, ☾: a symbol, an icon: 3:1)
          const box = [rr.left, rr.top, rr.width, rr.height];
          if (onTop(el, box)) out.push({ key: `${path(el)} "${txt.slice(0, 24)}"`, color: s.color, alpha: alphaOf(el), box, large: glyph || size >= 24 || (size >= 18.66 && bold), size: `${size}px ${s.fontWeight}${glyph ? " glyph" : ""}` });
        }
        if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.type !== "hidden" && el.type !== "file") {
          const ph = getComputedStyle(el, "::placeholder");
          const size = parseFloat(s.fontSize);
          if ((el.value || el.placeholder) && onTop(el, [r.left, r.top, r.width, r.height]))
            out.push({ key: `${path(el)} ${el.value ? `"${el.value.slice(0, 16)}"` : `placeholder "${el.placeholder.slice(0, 16)}"`}`, color: el.value ? s.color : ph.color, alpha: alphaOf(el),
              box: [r.left + 10, r.top + r.height * .25, Math.min(r.width - 20, 120), r.height * .5], large: size >= 24, size: `${size}px ${s.fontWeight}` });
        }
        if (el.tagName.toLowerCase() === "svg") {
          const fill = getComputedStyle(el).fill, stroke = getComputedStyle(el).stroke;
          const col = fill && fill !== "none" && !fill.startsWith("url") ? fill : stroke;
          // (a QR code, or a game's channel art, is a picture, not an icon on the glass)
          if (!el.closest(".pt-empty-qr, .onb-qr, .onb-inv-qr, .pv-art") && onTop(el.parentElement ?? el, [r.left, r.top, r.width, r.height]))
            out.push({ key: `${path(el.parentElement ?? el)} icon`, color: col, alpha: alphaOf(el), box: [r.left, r.top, r.width, r.height], large: true, size: `${Math.round(r.width)}px icon`, icon: true });
        }
      }
      R.classList.add("__hide-ink");
    }
    window.__inkRoots = Rs;
    return out;
  }, roots);
  await new Promise(r => setTimeout(r, 250));
  const bgShot = await cdpShot(pg);
  await pg.evaluate(() => { for (const R of window.__inkRoots ?? []) R.classList.remove("__hide-ink"); window.__inkRoots = null; });
  return pg.evaluate(async ({ png, items }) => {
    const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const parse = col => { let m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/.exec(col ?? ""); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] == null ? 1 : +m[4]];
      m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(col ?? ""); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const lum = ([r, gg, b]) => .2126 * lin(r) + .7152 * lin(gg) + .0722 * lin(b);
    return items.map(it => {
      const [x, y, w, h] = it.box.map(v => Math.round(v * k));
      const need = it.large ? 3 : 4.5;
      if (w < 1 || h < 1) return { ...it, need, ratio: null };
      const x0 = Math.max(0, x), y0 = Math.max(0, y);
      const d = g.getImageData(x0, y0, Math.max(1, Math.min(w, c.width - x0)), Math.max(1, Math.min(h, c.height - y0))).data;
      const ls = [];
      for (let i = 0; i < d.length; i += 4) ls.push([d[i], d[i + 1], d[i + 2]]);
      ls.sort((a, b) => lum(a) - lum(b));
      const bg = ls[ls.length >> 1];
      const fg = parse(it.color);
      if (!fg || !bg) return { ...it, need, ratio: null };
      const a = fg[3] * it.alpha;
      const col = [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
      const [L1, L2] = [lum(col), lum(bg)].sort((p, q) => q - p);
      return { key: it.key, size: it.size, need, alpha: it.alpha, bg: `rgb(${bg.join(", ")})`, ink: `rgb(${col.map(Math.round).join(", ")})`, ratio: +((L1 + .05) / (L2 + .05)).toFixed(2) };
    });
  }, { png: bgShot, items });
}
