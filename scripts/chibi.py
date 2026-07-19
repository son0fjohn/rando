"""Chibi-proportion pass: continuous warp of the lit character renders —
head zone magnified, body/legs compressed — no slice seams, no new art.
Mirrors the intent of the ChibiTestCharacter wrapper (headScale 1.35,
bodyScale 0.8, legs 0.8*0.85) for flat single-image characters."""
from PIL import Image
import numpy as np
import os

BASE = r"E:\rando"
LIT = os.path.join(BASE, "web", "lit")
OUT = os.path.join(BASE, "web", "chibi")
os.makedirs(OUT, exist_ok=True)

HEAD_V = 1.35   # vertical head magnification
HEAD_H = 1.30   # horizontal head magnification (hair reads too wide at 1.35)
BODY_V = 0.80
LEGS_V = 0.68   # 0.8 * 0.85, per the wrapper
BAND = 0.05     # smoothstep transition width (fraction of height)

# neck / hip lines as fraction of cropped image height, per character
# (long hair pushes the visual neck line down)
ZONES = {
    "player":      (0.28, 0.58),
    "npc-dreads":  (0.33, 0.60),
    "npc-buzzcut": (0.24, 0.58),
    "npc-silver":  (0.36, 0.62),
    "npc-cans":    (0.30, 0.58),
}

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def scale_profiles(h, neck_f, hip_f):
    """Per-source-row vertical and horizontal scale factors."""
    y = np.arange(h) / h
    t_neck = smoothstep(neck_f - BAND, neck_f + BAND, y)   # 0 in head, 1 below
    t_hip = smoothstep(hip_f - BAND, hip_f + BAND, y)
    v = HEAD_V * (1 - t_neck) + (BODY_V * (1 - t_hip) + LEGS_V * t_hip) * t_neck
    s = HEAD_H * (1 - t_neck) + 1.0 * t_neck
    return v, s

def warp(im, neck_f, hip_f):
    arr = np.asarray(im, dtype=np.float32)
    h, w = arr.shape[:2]
    v, s = scale_profiles(h, neck_f, hip_f)

    # figure axis: alpha centroid x of the head zone (robust to skateboards)
    head_rows = arr[: int(h * neck_f), :, 3]
    xs = np.arange(w)
    wsum = head_rows.sum()
    cx = float((head_rows * xs[None, :]).sum() / wsum) if wsum > 0 else w / 2

    # vertical remap: cumulative output height per source row
    C = np.concatenate([[0], np.cumsum(v)])
    out_h = int(C[-1])
    # source row for each output row
    src_y = np.searchsorted(C, np.arange(out_h) + 0.5) - 1
    src_y = np.clip(src_y, 0, h - 1)

    out_w = int(w * HEAD_H) + 8
    cx_out = cx * out_w / w  # keep axis proportionally placed
    x_out = np.arange(out_w, dtype=np.float32)

    out = np.zeros((out_h, out_w, 4), dtype=np.float32)
    for j in range(out_h):
        i = src_y[j]
        x_src = cx + (x_out - cx_out) / s[i]
        for c in range(4):
            out[j, :, c] = np.interp(x_src, xs, arr[i, :, c], left=0, right=0)

    result = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
    bbox = result.split()[3].getbbox()
    return result.crop(bbox)

for name, (neck_f, hip_f) in ZONES.items():
    im = Image.open(os.path.join(LIT, name + ".png")).convert("RGBA")
    out = warp(im, neck_f, hip_f)
    out.save(os.path.join(OUT, name + ".png"))
    print(name, im.size, "->", out.size)
print("chibi assets saved to", OUT)
