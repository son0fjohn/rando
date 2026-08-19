"""Cut the Rando icon silhouette from the ACTUAL player rig (web/avatar3/body.glb).

Orthographic projection of every triangle of the base body -> union raster at
high resolution -> contour trace -> simplified SVG path. No illustration
step, no stock art: the shape IS the 3.5-head base rig (bald base body in
tank + shorts, arms at sides — gender-neutral by construction).

Outputs (brand/icon/):
  rando-silhouette-front.svg / -3q.svg   single flat fill, no stroke/gradient/shadow
  *.png previews at 1024 and at 64/32/16 (nearest-neighbour downsample, for the
  favicon read), plus contact.png for review.

    py -3 brand/tools/silhouette.py
"""
import math
import os

import numpy as np
import trimesh
from PIL import Image, ImageDraw
from skimage import measure

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BODY = os.path.join(ROOT, "web", "avatar3", "body.glb")
OUT = os.path.join(ROOT, "brand", "icon")
os.makedirs(OUT, exist_ok=True)

RES = 2400          # raster height in px (silhouette is traced from this)
PAD = 0.04          # padding fraction around the figure
FACE_YAW_DEG = 97.0 # the rig's face heading measured at runtime (avatar3 analyzeFace)


def load_tris():
    sc = trimesh.load(BODY, force="scene")
    tris = []
    for node in sc.graph.nodes_geometry:
        T, gname = sc.graph[node]
        g = sc.geometry[gname]
        v = trimesh.transform_points(g.vertices, T)
        tris.append(v[g.faces])           # (F, 3, 3)
    return np.concatenate(tris, axis=0)


def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def project(tris, view_yaw_deg):
    """Rotate the model so the face points +Z, then yaw by view angle and
    project onto the XY plane (camera looking down -Z)."""
    R = rot_y(-FACE_YAW_DEG) @ np.eye(3)   # face -> +Z
    R = rot_y(view_yaw_deg) @ R
    p = tris.reshape(-1, 3) @ R.T
    return p.reshape(-1, 3, 3)[:, :, :2]   # drop depth


def raster(tris2d):
    lo = tris2d.reshape(-1, 2).min(0)
    hi = tris2d.reshape(-1, 2).max(0)
    size = hi - lo
    h = RES
    scale = (h * (1 - 2 * PAD)) / size[1]
    w = int(round(size[0] * scale + 2 * PAD * h))
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    ox = PAD * h - lo[0] * scale
    oy = h - PAD * h + lo[1] * scale   # flip Y (image y down)
    for tri in tris2d:
        pts = [(float(x * scale + ox), float(oy - y * scale)) for x, y in tri]
        d.polygon(pts, fill=255)
    return img


def trace_svg(img, path, label):
    a = np.asarray(img, dtype=np.float32) / 255.0
    # tiny blur softens raster stair-steps before contouring (still exact to <1px)
    from scipy.ndimage import gaussian_filter
    a = gaussian_filter(a, 1.2)
    contours = measure.find_contours(a, 0.5)
    w, h = img.size
    d = []
    kept = 0
    for c in contours:
        c = measure.approximate_polygon(c, tolerance=1.6)
        if len(c) < 12:
            continue
        area = 0.5 * abs(np.dot(c[:, 1], np.roll(c[:, 0], 1)) - np.dot(c[:, 0], np.roll(c[:, 1], 1)))
        if area < (h * 0.004) ** 2:   # drop specks
            continue
        kept += 1
        d.append("M" + " L".join(f"{x:.1f},{y:.1f}" for y, x in c) + "Z")
    # normalise to a 1000-unit-high viewBox
    s = 1000.0 / h
    vb_w = round(w * s)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w} 1000" width="{vb_w}" height="1000" '
           f'role="img" aria-label="Rando — {label}">\n'
           f'  <!-- silhouette cut from web/avatar3/body.glb (the 3.5-head base rig), {label} view; '
           f'single flat fill, no stroke -->\n'
           f'  <g transform="scale({s:.6f})">\n'
           f'    <path fill="#000" fill-rule="evenodd" d="{" ".join(d)}"/>\n'
           f'  </g>\n</svg>\n')
    open(path, "w", encoding="utf-8").write(svg)
    return kept, vb_w


def previews(img, stem):
    big = img.resize((img.width * 1024 // img.height, 1024), Image.LANCZOS)
    # black on transparent
    rgba = Image.new("RGBA", big.size, (0, 0, 0, 0))
    rgba.putalpha(big)
    rgba.save(os.path.join(OUT, f"{stem}-1024.png"))
    for sz in (64, 32, 16):
        # icon-badge read: square canvas, figure fitted with a little margin
        sq = Image.new("L", (1024, 1024), 0)
        sq.paste(big, ((1024 - big.width) // 2, 0))
        small = sq.resize((sz, sz), Image.LANCZOS)
        out = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
        out.putalpha(small)
        out.save(os.path.join(OUT, f"{stem}-{sz}.png"))
    return rgba


def main():
    tris = load_tris()
    print(f"body.glb: {len(tris)} triangles")
    sheet = Image.new("RGB", (1900, 1120), (245, 244, 240))
    dr = ImageDraw.Draw(sheet)
    x = 40
    for label, yaw in (("front", 0.0), ("3q", 38.0), ("3q-left", -38.0)):
        t2 = project(tris, yaw)
        img = raster(t2)
        stem = f"rando-silhouette-{label}"
        kept, vbw = trace_svg(img, os.path.join(OUT, f"{stem}.svg"), label)
        rgba = previews(img, stem)
        print(f"  {label:8s} -> {stem}.svg ({kept} contours, viewBox {vbw}x1000)")
        # contact sheet: big + the three small badges
        bigp = rgba.resize((rgba.width * 900 // rgba.height, 900), Image.LANCZOS)
        sheet.paste(Image.new("RGB", bigp.size, (0, 0, 0)), (x, 60), bigp.split()[-1])
        dr.text((x, 20), f"{label}  (yaw {yaw:+.0f}°)", fill=(40, 40, 40))
        sx = x
        for sz in (64, 32, 16):
            ic = Image.open(os.path.join(OUT, f"{stem}-{sz}.png")).convert("RGBA")
            up = ic.resize((sz * 2, sz * 2), Image.NEAREST)
            sheet.paste(Image.new("RGB", up.size, (0, 0, 0)), (sx, 980), up.split()[-1])
            dr.text((sx, 980 + sz * 2 + 4), f"{sz}px", fill=(90, 90, 90))
            sx += sz * 2 + 30
        x += bigp.width + 120
    sheet.save(os.path.join(OUT, "contact.png"))
    print("contact sheet ->", os.path.join(OUT, "contact.png"))


if __name__ == "__main__":
    main()
