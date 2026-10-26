// A QR code as an SVG string (the invite sheet, the empty party room): dark
// navy modules on white with a quiet zone, so phone cameras read it in a
// dim bar. Error correction M: a little dirt or glare is fine.
//   el.innerHTML = qrSvg("https://randoirl.vercel.app/p/ABCD");
import qrcode from "./vendor/qrcode.js";

export function qrSvg(text, { dark = "#0F1A3A", light = "#ffffff", quiet = 3, label = "QR code" } = {}) {
  const q = qrcode(0, "M");
  q.addData(String(text));
  q.make();
  const n = q.getModuleCount(), size = n + quiet * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
