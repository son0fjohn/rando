"""Style-match sheets from test/style_shots.mjs's shots: one tall image per
spot, the hand-made Itaewon on the left and the procedural city on the right
at the same camera (day street, day wide, night street, night wide), then the
spot's top-down next to the plan of the real layout (scripts/plan_map.py).

    python3 scripts/style_sheet.py <dir> <out.png> [spot[,spot...]]

<dir> holds the shots: <spot>-<day|night>-<street|wide>.png, <spot>-day-top.png
and <spot>-plan.png, plus itaewon-*.png, the reference. When <out.png> is a
directory every spot gets <out>/sheet-<spot>.png; a file name takes the one
spot given. Every shot is 420 px tall, the top-down and the plan 420 x 420.
A shot that isn't there leaves a marked gap (and a warning, and exit 1).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

SPOTS = ["itaewon-edge", "gangnam", "hongdae", "calgary", "edmonton"]
REF = "itaewon"
NAMES = {"itaewon": "Itaewon", "itaewon-edge": "Itaewon edge", "gangnam": "Gangnam", "hongdae": "Hongdae",
         "calgary": "Calgary", "edmonton": "Edmonton", "jamsil": "Jamsil"}
ROWS = [("day", "street"), ("day", "wide"), ("night", "street"), ("night", "wide")]
H = 420                      # every shot this tall
PAD, GUT, CAP, TITLE = 18, 12, 24, 34
BG, STRIP, INK, GAP = (58, 58, 63), (26, 26, 30), (240, 236, 228), (84, 66, 66)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        try:
            return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
        except OSError:
            return ImageFont.load_default()


def name(spot):
    return NAMES.get(spot) or spot.replace("-", " ").title()


def shot(path, square, missing):
    """The shot at path 420 px tall (420 x 420 when square), or a marked gap."""
    if os.path.exists(path):
        im = Image.open(path).convert("RGB")
        size = (H, H) if square else (max(1, round(im.width * H / im.height)), H)
        return im.resize(size, Image.Resampling.LANCZOS)
    print(f"  missing: {path}", file=sys.stderr)
    missing.append(path)
    im = Image.new("RGB", (H, H) if square else (round(390 * H / 844), H), GAP)
    d = ImageDraw.Draw(im)
    text(d, (6, H // 2 - 20), im.width - 12, "missing", 13)
    text(d, (6, H // 2 + 2), im.width - 12, os.path.basename(path), 11)
    return im


def text(d, xy, w, s, size, fill=INK):
    """s at xy in DejaVu Sans Bold, shrunk until it fits w px (then cut)."""
    x, y = xy
    while True:
        f = font(size)
        bb = d.textbbox((0, 0), s, font=f)
        if bb[2] - bb[0] <= w or size <= 8:
            break
        size -= 1
    while bb[2] - bb[0] > w and len(s) > 2:
        s = s[:-2] + "…"
        bb = d.textbbox((0, 0), s, font=f)
    d.text((x - bb[0], y - bb[1]), s, fill=fill, font=f)
    return bb[3] - bb[1]


def cell(sheet, d, x, y, im, label):
    """A caption strip, then the shot under it."""
    d.rectangle([x, y, x + im.width - 1, y + CAP - 1], fill=STRIP)
    text(d, (x + 6, y + 6), im.width - 12, label, 13)
    sheet.paste(im, (x, y + CAP))


def sheet(d, spot):
    """The spot's sheet: rows of [Itaewon | the spot], then [top-down | plan]."""
    missing = []
    rows = []
    for mode, view in ROWS:
        rows.append([(shot(os.path.join(d, f"{REF}-{mode}-{view}.png"), False, missing), f"{name(REF)} · {mode} {view}"),
                     (shot(os.path.join(d, f"{spot}-{mode}-{view}.png"), False, missing), f"{name(spot)} · {mode} {view}")])
    rows.append([(shot(os.path.join(d, f"{spot}-day-top.png"), True, missing), f"{name(spot)} · top-down, day"),
                 (shot(os.path.join(d, f"{spot}-plan.png"), True, missing), f"{name(spot)} · plan (the real layout)")])
    # one gutter down the middle: the reference stacks on its left, the spot on its right
    left = max(r[0][0].width for r in rows)
    right = max(r[1][0].width for r in rows)
    W = PAD + left + GUT + right + PAD
    Ht = PAD + TITLE + len(rows) * (CAP + H + GUT) - GUT + PAD
    img = Image.new("RGB", (W, Ht), BG)
    dr = ImageDraw.Draw(img)
    text(dr, (PAD, PAD + 4), W - 2 * PAD, f"{name(spot)} next to {name(REF)} · style match", 16)
    y = PAD + TITLE
    mid = PAD + left
    for (a, la), (b, lb) in rows:
        cell(img, dr, mid - a.width, y, a, la)
        cell(img, dr, mid + GUT, y, b, lb)
        y += CAP + H + GUT
    return img, missing


def main(argv):
    if len(argv) < 3:
        print(__doc__.strip().split("\n\n")[1].strip(), file=sys.stderr)
        return 2
    d, out = argv[1], argv[2]
    spots = argv[3].split(",") if len(argv) > 3 else SPOTS
    as_dir = os.path.isdir(out) or out.endswith(os.sep) or not out.lower().endswith(".png")
    if not as_dir and len(spots) != 1:
        print("one spot for a single file (or give a directory for a sheet per spot)", file=sys.stderr)
        return 2
    if as_dir:
        os.makedirs(out, exist_ok=True)
    missing = 0
    for spot in spots:
        img, gaps = sheet(d, spot)
        path = os.path.join(out, f"sheet-{spot}.png") if as_dir else out
        img.save(path)
        print(path + (f"  ({len(gaps)} missing)" if gaps else ""))
        missing += len(gaps)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
