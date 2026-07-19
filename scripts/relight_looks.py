"""Relight the pose-consistent (arms-down) player renders into
web/lit/looks/<category>__<key>.png. These are the ONLY renders offered by
the in-app picker; T-pose renders are excluded until the art is
regenerated in the natural pose (or as true compositable layers).

Diff analysis (2026-07-19) showed renders differ globally (~60% of pixels
even for an eye-color change), so layer extraction is impossible — each
look is a complete baked character."""
from PIL import Image, ImageEnhance, ImageChops
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "web", "lit", "looks")
os.makedirs(OUT, exist_ok=True)

# category__key -> source render (arms-down poses only)
LOOKS = {
    "outfits__red-tank":          r"assets\player\outfits\20_red-tank.png",
    "outfits__varsity-jacket":    r"assets\player\outfits\19_varsity-jacket.png",
    "outfits__green-hoodie":      r"assets\player\outfits\21_green-hoodie.png",
    "outfits__navy-shirt-jacket": r"assets\player\outfits\23_navy-shirt-jacket.png",
    "outfits__red-plaid-flannel": r"assets\player\outfits\24_red-plaid-flannel.png",
    "hair__asymmetric-spiky":     r"assets\player\hair\13_asymmetric-spiky.png",
    "hair__bob-straight-bangs":   r"assets\player\hair\15_bob-straight-bangs.png",
    "hair__bob-side-swept":       r"assets\player\hair\16_bob-side-swept.png",
    "hair__long-straight-2":      r"assets\player\hair\38_long-straight-2.png",
    "skin__medium-tan":           r"assets\player\skin-tones\05_medium-tan.png",
    "extras__headphones":         r"assets\player\accessories\16_headphones.png",
    "extras__glasses":            r"assets\player\accessories\18_glasses.png",
}

def relight(im):
    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Brightness(rgb).enhance(1.06)
    rgb = ImageEnhance.Color(rgb).enhance(0.88)
    rgb = ImageEnhance.Contrast(rgb).enhance(0.93)
    rgb = ImageChops.screen(rgb, Image.new("RGB", rgb.size, (30, 40, 56)))
    return Image.merge("RGBA", (*rgb.split(), a))

for key, rel in LOOKS.items():
    im = Image.open(os.path.join(BASE, rel)).convert("RGBA")
    im = im.crop(im.split()[3].getbbox())
    relight(im).save(os.path.join(OUT, key + ".png"))
    print(key)
print("done ->", OUT)
