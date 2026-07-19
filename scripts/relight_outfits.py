"""Relight every outfit render (assets/player/outfits) to match the day
scene and crop to the feet, producing web/lit/outfits/<key>.png where
<key> is the filename minus its number prefix (e.g. 20_red-tank -> red-tank).
Same treatment as scripts/relight.py applies to the base five characters."""
from PIL import Image, ImageEnhance, ImageChops
import os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "assets", "player", "outfits")
OUT = os.path.join(BASE, "web", "lit", "outfits")
os.makedirs(OUT, exist_ok=True)

def relight(im):
    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Brightness(rgb).enhance(1.06)
    rgb = ImageEnhance.Color(rgb).enhance(0.88)
    rgb = ImageEnhance.Contrast(rgb).enhance(0.93)
    rgb = ImageChops.screen(rgb, Image.new("RGB", rgb.size, (30, 40, 56)))
    return Image.merge("RGBA", (*rgb.split(), a))

for f in sorted(os.listdir(SRC)):
    if not f.lower().endswith(".png"):
        continue
    key = re.sub(r"^\d+_", "", f[:-4])
    im = Image.open(os.path.join(SRC, f)).convert("RGBA")
    im = im.crop(im.split()[3].getbbox())
    relight(im).save(os.path.join(OUT, key + ".png"))
    print(key)
print("done ->", OUT)
