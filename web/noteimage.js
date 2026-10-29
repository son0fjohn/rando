// Notes: photos and memes, on the phone. Every picture is decoded, redrawn
// on a canvas and re-encoded as a fresh JPEG (at most 1280 px on its long
// side, quality 0.8) before it goes anywhere, so nothing of the original
// file survives: no EXIF, no GPS, no camera serial, no XMP, no thumbnail.
// hasMetadata() reads a JPEG's segments, so the app (and the tests) can
// check the bytes that are about to be uploaded.
//
//   const jpeg = await cleanImage(file)                       -> Blob (image/jpeg)
//   const meme = await cleanImage(file, { top, bottom })      -> the meme, drawn in
//   hasMetadata(new Uint8Array(await jpeg.arrayBuffer()))     -> { any: false, … }
//
// The meme maker is the classic: Impact (or the nearest heavy sans the phone
// has), white, a black outline, upper case, top and bottom, shrunk to fit
// in two lines.

export const MAX_SIDE = 1280;
export const QUALITY = 0.8;

// decode with the photo's own orientation applied (EXIF rotation is the one
// thing worth keeping, so it's baked into the pixels before the tags go)
export async function decode(blob) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function fitSize(w, h, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

const MEME_FONT = `Impact, Haettenschweiler, "Anton", "Arial Narrow Bold", "Arial Black", "Apple SD Gothic Neo", sans-serif`;
// wrap words into lines that fit `w` at the context's current font
function wrap(g, text, w) {
  const words = text.split(/\s+/).filter(Boolean), lines = [];
  let cur = "";
  for (const word of words) {
    const t = cur ? `${cur} ${word}` : word;
    if (g.measureText(t).width <= w || !cur) cur = t; else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  // a single word wider than the line (Korean has few spaces): break it by characters
  return lines.flatMap(l => {
    if (g.measureText(l).width <= w) return [l];
    const out = []; let c = "";
    for (const ch of l) { if (g.measureText(c + ch).width > w && c) { out.push(c); c = ch; } else c += ch; }
    if (c) out.push(c);
    return out;
  });
}
// one caption, top or bottom: as big as it can be in at most 2 lines
export function drawCaption(g, text, W, H, where) {
  text = String(text ?? "").trim().toUpperCase();
  if (!text) return;
  const pad = Math.round(W * 0.04), maxW = W - pad * 2;
  let size = Math.round(Math.min(W, H) * 0.13), lines;
  for (;;) {
    g.font = `900 ${size}px ${MEME_FONT}`;
    lines = wrap(g, text, maxW);
    if ((lines.length <= 2 && lines.every(l => g.measureText(l).width <= maxW)) || size <= 12) break;
    size = Math.round(size * 0.9);
  }
  g.textAlign = "center";
  g.textBaseline = where === "top" ? "top" : "bottom";
  g.lineJoin = "round";
  g.miterLimit = 2;
  g.lineWidth = Math.max(2, size / 7);
  g.strokeStyle = "#000";
  g.fillStyle = "#fff";
  const lh = size * 1.05;
  lines.forEach((l, i) => {
    const y = where === "top" ? pad + i * lh : H - pad - (lines.length - 1 - i) * lh;
    g.strokeText(l, W / 2, y);
    g.fillText(l, W / 2, y);
  });
}

// draw the picture (and a meme's captions) onto a canvas of the right size
export function render(img, { top = "", bottom = "", max = MAX_SIDE, canvas = null } = {}) {
  const w0 = img.width ?? img.naturalWidth, h0 = img.height ?? img.naturalHeight;
  const [W, H] = fitSize(w0, h0, max);
  const c = canvas ?? document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);       // (a transparent PNG: black, not a JPEG's grey)
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, W, H);
  drawCaption(g, top, W, H, "top");
  drawCaption(g, bottom, W, H, "bottom");
  return c;
}

const toBlob = (c, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("couldn't encode the picture")), "image/jpeg", q));

// file in, a clean JPEG out (decode -> redraw -> re-encode -> drop every
// APPn but APP0, and COM: a browser's encoder adds its own sRGB ICC profile
// as APP2, nothing personal, but nothing is kept that needn't be); throws if
// anything is somehow left
export async function cleanImage(blob, { top = "", bottom = "", max = MAX_SIDE, quality = QUALITY } = {}) {
  const img = await decode(blob);
  const enc = await toBlob(render(img, { top, bottom, max }), quality);
  img.close?.();
  const bytes = stripSegments(new Uint8Array(await enc.arrayBuffer()));
  if (hasMetadata(bytes).any) throw new Error("the picture still had metadata in it");
  return new Blob([bytes], { type: "image/jpeg" });
}

// a JPEG without its APP1-APP15 and COM segments (everything up to the image data walked)
export function stripSegments(bytes) {
  if (!(bytes?.[0] === 0xff && bytes[1] === 0xd8)) return bytes;
  const keep = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const m = bytes[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xda || m === 0xd9) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (!((m >= 0xe1 && m <= 0xef) || m === 0xfe)) keep.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  keep.push(bytes.subarray(i));
  const out = new Uint8Array(keep.reduce((a, k) => a + k.length, 0));
  let o = 0;
  for (const k of keep) { out.set(k, o); o += k.length; }
  return out;
}

// A JPEG's segments up to the image data: which carry metadata? APP1 (EXIF,
// with its GPS block, and XMP), APP2-APP15 (ICC, Photoshop IRB, maker
// notes…) and COM. APP0 (JFIF, what a canvas writes) is just the format.
export function hasMetadata(bytes) {
  const out = { jpeg: false, app1: false, exif: false, gps: false, xmp: false, other: [], any: false };
  if (!(bytes?.[0] === 0xff && bytes[1] === 0xd8)) return out;
  out.jpeg = true;
  const ascii = (o, n) => String.fromCharCode(...bytes.subarray(o, Math.min(bytes.length, o + n)));
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;                 // lost sync: stop (the image data starts at SOS anyway)
    const m = bytes[i + 1];
    if (m === 0xff) { i++; continue; }           // fill byte
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    if (m === 0xda || m === 0xd9) break;          // start of scan / end of image
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const body = i + 4;
    if (m === 0xe1) {
      out.app1 = true;
      if (ascii(body, 6) === "Exif\0\0") {
        out.exif = true;
        // the GPS IFD pointer (tag 0x8825) in IFD0, either byte order
        const t = body + 6, le = ascii(t, 2) === "II";
        const u16 = o => le ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1];
        const u32 = o => le ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0 : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
        const ifd = t + u32(t + 4), n = u16(ifd);
        for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= body + len - 2; k++) if (u16(ifd + 2 + k * 12) === 0x8825) out.gps = true;
      } else if (ascii(body, 28).startsWith("http://ns.adobe.com/xap/1.0/")) out.xmp = true;
    } else if ((m >= 0xe2 && m <= 0xef) || m === 0xfe) out.other.push(m === 0xfe ? "COM" : `APP${m - 0xe0}`);
    i = body + len - 2;
  }
  out.any = out.app1 || out.exif || out.gps || out.xmp || out.other.length > 0;
  return out;
}

// A test helper (and a positive control for hasMetadata): put a hand-built
// EXIF APP1 segment with a GPS block (37.5347 N, 126.9945 E) right after a
// JPEG's SOI marker, the way a phone camera writes it.
export function withExifGps(jpeg) {
  const le = [];
  const u16 = v => le.push(v & 255, (v >> 8) & 255);
  const u32 = v => le.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  // TIFF header, IFD0 with one entry: the GPS IFD pointer
  le.push(0x49, 0x49); u16(42); u32(8);
  u16(1); u16(0x8825); u16(4); u32(1); u32(26); u32(0);
  // the GPS IFD at 26: LatitudeRef N, Latitude, LongitudeRef E, Longitude
  const rationals = 26 + 2 + 4 * 12 + 4;
  u16(4);
  u16(1); u16(2); u32(2); le.push(0x4e, 0, 0, 0);                 // 'N'
  u16(2); u16(5); u32(3); u32(rationals);
  u16(3); u16(2); u32(2); le.push(0x45, 0, 0, 0);                 // 'E'
  u16(4); u16(5); u32(3); u32(rationals + 24);
  u32(0);
  for (const [d, m, s] of [[37, 32, 4.92], [126, 59, 40.2]]) { u32(d); u32(1); u32(m); u32(1); u32(Math.round(s * 100)); u32(100); }
  const tiff = Uint8Array.from(le);
  const head = [0x45, 0x78, 0x69, 0x66, 0, 0];                    // "Exif\0\0"
  const len = 2 + head.length + tiff.length;
  const seg = Uint8Array.from([0xff, 0xe1, len >> 8, len & 255, ...head, ...tiff]);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0); out.set(seg, 2); out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}
