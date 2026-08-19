"""Rando wordmark options — written as SVG (outlined paths via fontTools, so
the marks are exact everywhere), each with a live-text twin for editing.

Direction: one idea, no decoration. Single typeface, single weight per
option, tight confident tracking, black on transparent.

    py -3 brand/tools/wordmark.py

Outputs brand/wordmark/{A..D}-<slug>.svg (outlined), *-live.svg (text),
sizes.png (app-store vs badge/favicon read), and a lockup preview per option.
"""
import os
import re

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "brand", "wordmark")
ICON = os.path.join(ROOT, "brand", "icon", "rando-silhouette-front.svg")
os.makedirs(OUT, exist_ok=True)
FONTS = "C:/Windows/Fonts/"

# id, slug, font file, text, tracking (em fraction, negative = tighter),
# per-pair manual kerning (em), rationale
OPTIONS = [
    ("A", "geometric-lower", "GOTHIC.TTF", "rando", -0.035,
     {("r", "a"): -0.012, ("d", "o"): -0.006},
     "Century Gothic Regular · lowercase · geometric",
     "Perfect circles in a, d, o echo the round head of the icon. Lowercase keeps it soft and "
     "approachable — the app is about meeting people, not a brand shouting. Weakest at 16 px: "
     "thin strokes vanish."),
    ("B", "humanist-title", "seguisb.ttf", "Rando", -0.045,
     {("R", "a"): -0.022},
     "Segoe UI Semibold · Title case · humanist sans",
     "The closest thing on this machine to the SF-Pro restraint of the brief. Title case reads "
     "as a product name on an app-store page. Semibold survives the badge sizes; R–a tightened "
     "so the cap doesn't float off the word."),
    ("C", "din-caps", "bahnschrift.ttf:600", "RANDO", -0.015,
     {},
     "Bahnschrift SemiBold (DIN) · caps · tight",
     "All caps, engineered DIN forms — the most legible at 16–24 px of the four, and the most "
     "'signage' in feel (fits a city/venue product). Least warm; pairs with the icon for the "
     "softness."),
    ("D", "grotesque-lower", "FRADM.TTF", "rando", -0.04,
     {("r", "a"): -0.014},
     "Franklin Gothic Demi · lowercase · grotesque",
     "Heavy, compact, confident. Holds its weight in a 32 px badge better than A or B; the "
     "double-storey a gives it more character than the geometric option. Slight risk of feeling "
     "'sports/retail' rather than 'Apple-quiet'."),
]


def load_font(spec):
    if ":" in spec:
        f, w = spec.split(":")
        t = TTFont(FONTS + f)
        t = instancer.instantiateVariableFont(t, {"wght": int(w)})
        return t
    return TTFont(FONTS + spec)


def outline(tt, text, tracking, pairs, cap_px=200.0):
    """Return (path_d, width, ascent, descent) with cap height scaled to cap_px."""
    upm = tt["head"].unitsPerEm
    os2 = tt["OS/2"]
    cap = getattr(os2, "sCapHeight", 0) or int(upm * 0.7)
    scale = cap_px / cap
    cmap = tt.getBestCmap()
    gs = tt.getGlyphSet()
    hmtx = tt["hmtx"]
    x = 0.0
    d = []
    prev = None
    for ch in text:
        gname = cmap[ord(ch)]
        adj = (pairs.get((prev, ch), 0.0) if prev else 0.0) * upm
        x += adj
        pen = SVGPathPen(gs)
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x * scale, 0))
        gs[gname].draw(tpen)
        d.append(re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.1f}", pen.getCommands()))
        x += hmtx[gname][0] + tracking * upm
        prev = ch
    width = (x - tracking * upm) * scale
    asc = tt["hhea"].ascent * scale
    desc = -tt["hhea"].descent * scale
    return " ".join(d), width, asc, desc, cap * scale


def svg_doc(path_d, width, asc, desc, cap, meta, font_family, text, tracking_em, live=False):
    # viewBox: tight to the glyph box (cap height + descender), generous side padding
    pad = cap * 0.08
    top = -asc if live else -cap * 1.05
    h = (asc + desc) if live else cap * 1.05 + cap * 0.28
    vb = f"{-pad:.1f} {top:.1f} {width + 2 * pad:.1f} {h:.1f}"
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{width + 2 * pad:.0f}" '
            f'height="{h:.0f}" role="img" aria-label="Rando">\n  <!-- {meta} -->\n')
    if live:
        body = (f'  <text x="0" y="0" font-family="{font_family}" font-size="{cap / 0.7:.1f}" '
                f'letter-spacing="{tracking_em:.3f}em" fill="#000">{text}</text>\n')
    else:
        body = f'  <path fill="#000" d="{path_d}"/>\n'
    return head + body + "</svg>\n"


def pil_font(spec, px):
    f = spec.split(":")[0]
    try:
        font = ImageFont.truetype(FONTS + f, px)
        if ":" in spec:
            try:
                font.set_variation_by_axes([int(spec.split(":")[1])])
            except Exception:
                pass
        return font
    except Exception:
        return ImageFont.load_default()


def draw_tracked(draw, xy, text, font, tracking_em, pairs, fill=(0, 0, 0)):
    x, y = xy
    prev = None
    size = font.size
    for ch in text:
        if prev and (prev, ch) in pairs:
            x += pairs[(prev, ch)] * size
        draw.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + tracking_em * size
        prev = ch
    return x


def main():
    results = []
    for oid, slug, spec, text, tracking, pairs, meta, why in OPTIONS:
        tt = load_font(spec)
        fam = tt["name"].getDebugName(1)
        d, w, asc, desc, cap = outline(tt, text, tracking, pairs)
        base = os.path.join(OUT, f"{oid}-{slug}")
        open(base + ".svg", "w", encoding="utf-8").write(
            svg_doc(d, w, asc, desc, cap, meta + " — outlined (exact)", fam, text, tracking))
        open(base + "-live.svg", "w", encoding="utf-8").write(
            svg_doc(d, w, asc, desc, cap, meta + " — live text (editable; needs the font installed)",
                    fam, text, tracking, live=True))
        results.append((oid, slug, spec, text, tracking, pairs, meta, why, w / cap))
        print(f"{oid} {meta}  (width {w/cap:.2f} cap-heights)")

    # ---- size sheet: large / 48 / 24 / 16 px cap-height-ish rows, per option
    W, H = 1800, 260 * len(OPTIONS) + 80
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    y = 30
    label_font = pil_font("segoeui.ttf", 16)
    for oid, slug, spec, text, tracking, pairs, meta, why, _ in results:
        dr.text((30, y), f"{oid} · {meta}", font=label_font, fill=(110, 110, 110))
        # large (app store header): 120 px font
        big = pil_font(spec, 150)
        draw_tracked(dr, (30, y + 30), text, big, tracking, pairs)
        # small column: 48 / 24 / 16 px FONT size (≈ 34 / 17 / 11 px cap height)
        sx = 1080
        for px in (48, 24, 16):
            f = pil_font(spec, px)
            draw_tracked(dr, (sx, y + 40), text, f, tracking, pairs)
            dr.text((sx - 70, y + 40 + px * 0.15), f"{px}px", font=label_font, fill=(170, 170, 170))
            sx += 260
        y += 260
    sheet.save(os.path.join(OUT, "sizes.png"))

    # ---- index
    lines = ["# Rando wordmark — first pass\n",
             "Single typeface, single weight per option. Tight tracking. Black on transparent. "
             "Each option ships as an OUTLINED svg (exact, font-independent) and a LIVE-text twin "
             "(editable — needs the font installed).\n",
             "| # | Treatment | Files | Why | Width (cap-heights) |", "|---|---|---|---|---|"]
    for oid, slug, spec, text, tracking, pairs, meta, why, wr in results:
        lines.append(f"| {oid} | {meta} | `{oid}-{slug}.svg`, `{oid}-{slug}-live.svg` | {why} | {wr:.2f} |")
    lines.append("\n`sizes.png` shows each at display size and at 48 / 24 / 16 px font size "
                 "(the 16 px row approximates a favicon-adjacent label — the icon alone carries the favicon).")
    open(os.path.join(OUT, "README.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
