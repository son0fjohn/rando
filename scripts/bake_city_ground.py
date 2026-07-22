"""Bake a world2-style ground texture from real OSM street data.

Experiment: prove the dome world generalizes beyond Itaewon.
Usage:  py -3 scripts/bake_city_ground.py calgary
Cities are defined in CITIES below; output lands in web/world2/ground_<city>.jpg
Road data (c) OpenStreetMap contributors (ODbL) — attribution shown in-app.
"""
import json
import math
import os
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE = os.path.join(ROOT, "..", "rando avatar v2", "world2", "road wrapper",
                    "hf_20260722_175313_8cf699d4-a497-4181-b616-3b92b3b3829b.png")

SIZE = 4096
SPAN = 800.0          # world units across the canvas
PXU = SIZE / SPAN
SCALE = 0.55          # world units per metre (same toy scale as Itaewon)
HALF_M = (SPAN / 2) / SCALE  # metres covered from center to edge

CITIES = {
    "calgary": {"center": (51.0462, -114.0631)},  # Stephen Ave / downtown core
}

# road corridor widths in world units per OSM class (stylized, not to scale;
# dense downtown grids need narrower roads than the radial toy world)
WIDTHS = {"primary": 26, "secondary": 22, "tertiary": 18, "residential": 15}
ASPHALT = (108, 107, 108)
CURB = (203, 200, 197)
DASH = (232, 232, 228)

def fetch(center):
    dlat = HALF_M / 110540.0
    dlng = HALF_M / (111320.0 * math.cos(math.radians(center[0])))
    bbox = (center[0] - dlat, center[1] - dlng, center[0] + dlat, center[1] + dlng)
    q = f'[out:json][timeout:60];(way["highway"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}););out geom;'
    mirrors = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
    ]
    last = None
    for url in mirrors:
        try:
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({"data": q}).encode(),
                headers={"User-Agent": "rando-world-builder/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f"  mirror failed ({url}): {e}")
            last = e
    raise last

def project(center, lat, lng):
    m_lat = 110540.0
    m_lng = 111320.0 * math.cos(math.radians(center[0]))
    x = (lng - center[1]) * m_lng * SCALE
    z = -(lat - center[0]) * m_lat * SCALE
    return SIZE / 2 + x * PXU, SIZE / 2 + z * PXU  # canvas px (v = +z south)

def grass_canvas():
    b = Image.open(TILE).convert("RGB")
    f = (150 * PXU) / b.width
    bs = b.resize((int(b.width * f), int(b.height * f)), Image.LANCZOS)
    s = bs.width
    g = bs.crop((int(s*0.03), int(s*0.03), int(s*0.30), int(s*0.30)))
    gw, gh = g.size
    block = Image.new("RGB", (gw*2, gh*2))
    block.paste(g, (0, 0)); block.paste(ImageOps.mirror(g), (gw, 0))
    block.paste(ImageOps.flip(g), (0, gh)); block.paste(ImageOps.flip(ImageOps.mirror(g)), (gw, gh))
    cv = Image.new("RGB", (SIZE, SIZE))
    for x in range(0, SIZE, block.width):
        for y in range(0, SIZE, block.height):
            cv.paste(block, (x, y))
    return cv

def draw_dashes(d, pts, width):
    dash, gap, acc = 3.5 * PXU, 5.0 * PXU, 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        seg = math.hypot(x2 - x1, y2 - y1)
        if seg < 1e-6:
            continue
        ux, uy = (x2 - x1) / seg, (y2 - y1) / seg
        t = -acc if acc < dash else gap - (acc - dash)
        # walk the segment placing alternating dash/gap
        pos = -acc
        while pos < seg:
            a, b = max(0.0, pos), min(seg, pos + dash)
            if b > a:
                d.line([(x1 + ux*a, y1 + uy*a), (x1 + ux*b, y1 + uy*b)],
                       fill=DASH, width=max(2, int(0.9 * PXU)))
            pos += dash + gap
        acc = (acc + seg) % (dash + gap)

def main():
    city = sys.argv[1] if len(sys.argv) > 1 else "calgary"
    center = CITIES[city]["center"]
    cache = os.path.join(ROOT, "scripts", f"osm_cache_{city}.json")
    if os.path.exists(cache):
        with open(cache) as f:
            data = json.load(f)
    else:
        data = fetch(center)
        with open(cache, "w") as f:
            json.dump(data, f)
    roads = []
    for way in data.get("elements", []):
        kind = way.get("tags", {}).get("highway")
        if kind is None:
            continue
        base = kind.split("_")[0]
        if base not in WIDTHS:
            continue
        pts = [project(center, g["lat"], g["lon"]) for g in way.get("geometry", [])]
        if len(pts) >= 2:
            roads.append((base, pts))

    cv = grass_canvas()
    d = ImageDraw.Draw(cv)
    order = ["pedestrian", "unclassified", "residential", "tertiary", "secondary", "primary"]
    roads.sort(key=lambda r: order.index(r[0]))
    for base, pts in roads:          # curb pass
        w = WIDTHS[base] * PXU
        d.line(pts, fill=CURB, width=int(w + 3 * PXU), joint="curve")
    for base, pts in roads:          # asphalt pass
        w = WIDTHS[base] * PXU
        d.line(pts, fill=ASPHALT, width=int(w), joint="curve")
    for base, pts in roads:          # centerline dashes on the bigger classes
        if base in ("primary", "secondary", "tertiary"):
            draw_dashes(d, pts, WIDTHS[base])

    out = os.path.join(ROOT, "web", "world2", f"ground_{city}.jpg")
    cv.save(out, quality=90)
    cv.resize((900, 900), Image.LANCZOS).save(
        os.path.join(ROOT, "..", "rando avatar v2", "world2-review", f"ground_{city}_preview.jpg"), quality=85)
    print(f"{city}: {len(roads)} ways baked -> {out} ({os.path.getsize(out)//1024}KB)")

if __name__ == "__main__":
    main()
