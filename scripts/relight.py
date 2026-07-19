"""Relight character renders to match the day-scene world bg, and build a
full composite preview with cast shadows + atmospheric haze."""
from PIL import Image, ImageEnhance, ImageChops, ImageFilter, ImageDraw
import os

BASE = r"E:\rando"
OUT_LIT = os.path.join(BASE, "web", "lit")
os.makedirs(OUT_LIT, exist_ok=True)

def relight(im):
    """Match the bright, cool, diffuse daylight of the world scene."""
    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Brightness(rgb).enhance(1.06)
    rgb = ImageEnhance.Color(rgb).enhance(0.88)
    rgb = ImageEnhance.Contrast(rgb).enhance(0.93)
    # screen a dark sky-blue: lifts the pure-black outlines toward the
    # scene's ambient so characters stop reading as stickers
    rgb = ImageChops.screen(rgb, Image.new("RGB", rgb.size, (30, 40, 56)))
    return Image.merge("RGBA", (*rgb.split(), a))

def haze(im, f, color=(205, 218, 232)):
    """Atmospheric perspective for distant characters."""
    if f <= 0:
        return im
    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb = Image.blend(rgb, Image.new("RGB", rgb.size, color), f)
    return Image.merge("RGBA", (*rgb.split(), a))

def cast_shadow_mask(char, squash=0.22, shear=0.55, blur=12, opacity=0.28):
    """Character-shaped ground shadow: squashed, flipped toward camera,
    sheared down-left (sun high, slightly right). Returns (L mask, pad, sw)."""
    a = char.split()[3]
    w, h = a.size
    sh = a.resize((w, max(1, int(h * squash))))
    sh = sh.transpose(Image.FLIP_TOP_BOTTOM)
    sw, shh = sh.size
    pad = int(shear * shh) + 4
    canvas = Image.new("L", (sw + pad, shh), 0)
    canvas.paste(sh, (pad, 0))
    # output(x,y) samples input(x + shear*y, y): rows shift left as y grows
    canvas = canvas.transform(canvas.size, Image.AFFINE,
                              (1, shear, 0, 0, 1, 0), resample=Image.BILINEAR)
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur))
    canvas = canvas.point(lambda p: int(p * opacity))
    return canvas, pad, sw

def contact_shadow(w, h, opacity=0.32, blur=10):
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([0, 0, w - 1, h - 1], fill=int(255 * opacity))
    return m.filter(ImageFilter.GaussianBlur(blur))

# --- generate lit assets (full res, haze NOT baked — CSS handles depth) ---
chars = {
    "player":      r"\assets\player\outfits\20_red-tank.png",
    "npc-dreads":  r"\assets\npcs\hf_20260717_142524_794c6754-d667-40a7-bc70-cbe2934d89fe.png",
    "npc-buzzcut": r"\assets\npcs\hf_20260717_142524_6735cfaf-2fe0-4bf9-987b-6a7e4615315d.png",
    "npc-silver":  r"\assets\npcs\hf_20260717_142524_dcb284f4-acf3-4d77-9e5f-352abbbe4bb9.png",
    "npc-cans":    r"\assets\npcs\hf_20260717_142524_172cf767-7783-4212-8b90-82c1e7580df8.png",
}
lit = {}
for name, rel in chars.items():
    im = Image.open(BASE + rel).convert("RGBA")
    # crop transparent padding so image bottom == feet (anchor point)
    bbox = im.split()[3].getbbox()
    im = im.crop(bbox)
    out = relight(im)
    out.save(os.path.join(OUT_LIT, name + ".png"))
    lit[name] = out
print("lit assets saved to", OUT_LIT)

# --- composite preview matching the CSS layout ---
bg = Image.open(BASE + r"\assets\world\hf_20260718_115457_9b653ec4-b79e-4856-829c-87b2bd18f1bd.png").convert("RGBA")
W, H = bg.size
canvas = bg.copy()

# name, cx, feet_y, height_pct, haze_f  (back-to-front paint order)
placements = [
    ("npc-silver",  0.17, 0.49, 0.14, 0.11),
    ("npc-buzzcut", 0.73, 0.58, 0.17, 0.08),
    ("npc-dreads",  0.26, 0.66, 0.20, 0.045),
    ("npc-cans",    0.81, 0.77, 0.24, 0.02),
    ("player",      0.50, 0.86, 0.30, 0.0),
]

for name, lx, ty, hpct, hz in placements:
    im = haze(lit[name], hz)
    th = int(H * hpct)
    tw = int(im.width * th / im.height)
    im_r = im.resize((tw, th), Image.LANCZOS)
    cx, feet_y = int(W * lx), int(H * ty)
    px, py = cx - tw // 2, feet_y - th

    # contact shadow (ellipse pooled at feet)
    ew, eh = int(tw * 0.52), int(th * 0.045)
    ell = contact_shadow(ew, eh)
    black = Image.new("RGBA", (ew, eh), (10, 14, 20, 255))
    canvas.paste(black, (cx - ew // 2, feet_y - eh // 2), ell)

    # character cast shadow, slightly tucked under the feet
    mask, pad, sw = cast_shadow_mask(im_r)
    sblack = Image.new("RGBA", mask.size, (12, 18, 28, 255))
    canvas.paste(sblack, (cx - (pad + sw // 2), feet_y - int(th * 0.012)), mask)

    canvas.alpha_composite(im_r, (px, py))

out = canvas.convert("RGB")
out_path = r"C:\Users\Admin\AppData\Local\Temp\claude\E--rando-characters\d25e27b1-8375-4331-bf26-b1a55fb111a1\scratchpad\preview2.png"
out.save(out_path, quality=90)
print("saved", out_path)
