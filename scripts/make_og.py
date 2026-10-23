# Link-preview image and icons: the "rando" wordmark (lifted off the white-on-blue
# logo_sky.jpg) glowing on the night sky. Run: python3 scripts/make_og.py
# -> web/og-image.png (1200x630), og-image-square.png (1200x1200), the icons.
from PIL import Image, ImageFilter
import numpy as np
import os
ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "pitch/design-handoff/assets/logo_sky.jpg")
SKY = os.path.join(ROOT, "web/world2/sky_night.jpg")
OUT = os.path.join(ROOT, "web")
a = np.array(Image.open(SRC).convert("RGB")).astype(float)
x0, y0, x1, y1 = 118, 334, 782, 560
al = np.clip((a[y0:y1, x0:x1, 0] - 8) / (245 - 8), 0, 1)       # white text, red-free sky
mark = Image.fromarray((al * 255).astype(np.uint8), "L")


def compose(W, H, crop, logo_w, out):
    sky = Image.open(SKY).convert("RGB").crop(crop).resize((W, H), Image.LANCZOS)
    # a gentle darkening behind the logo so it reads over clouds
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - W / 2) / (W * 0.42)) ** 2 + ((yy - H / 2) / (H * 0.42)) ** 2)
    shade = np.clip(1 - d, 0, 1) ** 1.5 * 0.32
    s = np.array(sky).astype(float) * (1 - shade[..., None])
    sky = Image.fromarray(s.clip(0, 255).astype(np.uint8))
    lw = logo_w; lh = round(mark.height * lw / mark.width)
    m = mark.resize((lw, lh), Image.LANCZOS)
    px, py = (W - lw) // 2, (H - lh) // 2 + round(lh * 0.06)       # optical centre (no descenders)
    canvas = Image.new("L", (W, H), 0); canvas.paste(m, (px, py))
    base = sky.convert("RGBA")
    # glow: a wide soft halo plus a tight one, cool white
    for radius, strength, col in [(60, 0.55, (150, 170, 255)), (22, 0.7, (200, 210, 255)), (6, 0.6, (235, 240, 255))]:
        g = canvas.filter(ImageFilter.GaussianBlur(radius))
        g = Image.fromarray((np.array(g).astype(float) * strength).clip(0, 255).astype(np.uint8), "L")
        layer = Image.new("RGBA", (W, H), col + (0,)); layer.putalpha(g)
        base = Image.alpha_composite(base, layer)
    text = Image.new("RGBA", (W, H), (255, 255, 255, 0)); text.putalpha(canvas)
    base = Image.alpha_composite(base, text)
    # 256 colours, dithered: half the size, looks the same (chat apps cap image sizes)
    base.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(os.path.join(OUT, out), optimize=True)
    print(out, (px, py, lw, lh))

compose(1200, 630, (0, 30, 2688, 30 + 1411), 540, "og-image.png")
compose(1200, 1200, (520, 0, 520 + 1520, 1520), 600, "og-image-square.png")

# icons: the same night sky, the wordmark across most of the width
for size, name in [(180, "apple-touch-icon.png"), (512, "icon-512.png"), (192, "icon-192.png"), (48, "favicon-48.png"), (32, "favicon-32.png")]:
    compose(size, size, (900, 200, 900 + 1100, 200 + 1100), round(size * 0.8), name)
