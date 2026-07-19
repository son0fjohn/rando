from PIL import Image

BASE = r"E:\rando"
bg = Image.open(BASE + r"\assets\world\hf_20260718_115457_9b653ec4-b79e-4856-829c-87b2bd18f1bd.png").convert("RGBA")
W, H = bg.size

sprites = [
    (BASE + r"\assets\player\outfits\20_red-tank.png", 0.50, 0.86, 0.30),
    (BASE + r"\assets\npcs\hf_20260717_142524_794c6754-d667-40a7-bc70-cbe2934d89fe.png", 0.26, 0.66, 0.20),
    (BASE + r"\assets\npcs\hf_20260717_142524_6735cfaf-2fe0-4bf9-987b-6a7e4615315d.png", 0.73, 0.58, 0.17),
    (BASE + r"\assets\npcs\hf_20260717_142524_dcb284f4-acf3-4d77-9e5f-352abbbe4bb9.png", 0.17, 0.49, 0.14),
    (BASE + r"\assets\npcs\hf_20260717_142524_172cf767-7783-4212-8b90-82c1e7580df8.png", 0.81, 0.77, 0.24),
]

canvas = bg.copy()

for path, lx, ty, hpct in sprites:
    im = Image.open(path).convert("RGBA")
    target_h = int(H * hpct)
    scale = target_h / im.height
    target_w = int(im.width * scale)
    im_r = im.resize((target_w, target_h), Image.LANCZOS)
    cx = int(W * lx)
    bottom_y = int(H * ty)
    px = cx - target_w // 2
    py = bottom_y - target_h
    canvas.alpha_composite(im_r, (px, py))

out = canvas.convert("RGB")
out_path = r"C:\Users\Admin\AppData\Local\Temp\claude\E--rando-characters\d25e27b1-8375-4331-bf26-b1a55fb111a1\scratchpad\preview.png"
out.save(out_path, quality=90)
print("saved", out_path, out.size)
