"""A plain 2D plan of a place from the raw map data (scripts/fetch_overture.py's
cache: Overture = OpenStreetMap + Microsoft / Google footprints), north up,
for checking the 3D city against the real layout side by side
(test/world_shots.mjs pairs it with a top-down shot of the same square).
It's drawn straight from the source data, independent of web/citygen.js.

    python scripts/plan_map.py <area[,area...]> <lat> <lng> <half-size metres> <out.png> [--px 800]
"""
import argparse
import math
import os

import pyarrow.parquet as pq
import shapely
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "overture_cache")
ROAD_W = {"motorway": 16, "trunk": 14, "primary": 12, "secondary": 10, "tertiary": 9, "residential": 6, "living_street": 5,
          "unclassified": 6, "service": 4, "pedestrian": 4, "footway": 2, "cycleway": 2, "path": 2, "steps": 2, "track": 3}
GREEN = {"park", "grass", "garden", "pitch", "playground", "golf_course", "recreation_ground", "meadow", "cemetery", "dog_park", "village_green"}


def rows(aids, theme):
    out, seen = [], set()
    for aid in aids.split(","):
        p = os.path.join(CACHE, f"{aid}.{theme}.parquet")
        if os.path.exists(p):
            for r in pq.read_table(p).to_pylist():
                if r.get("id") in seen:
                    continue
                seen.add(r.get("id"))
                out.append(r)
    return [r for r in map(_geom, out) if r is not None]


def _geom(r):
    g = r.get("geometry")
    if isinstance(g, (bytes, bytearray)):
        g = shapely.from_wkb(g)
    if g is None:
        return None
    r["geometry"] = g
    return r


def polys(g):
    if g.geom_type == "Polygon":
        return [g]
    if g.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for q in g.geoms for p in polys(q)]
    return []


def lines(g):
    if g.geom_type == "LineString":
        return [g]
    if g.geom_type in ("MultiLineString", "GeometryCollection"):
        return [p for q in g.geoms for p in lines(q)]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("area")
    ap.add_argument("lat", type=float)
    ap.add_argument("lng", type=float)
    ap.add_argument("half", type=float)
    ap.add_argument("out")
    ap.add_argument("--px", type=int, default=800)
    a = ap.parse_args()
    S = a.px / (2 * a.half)  # px per metre
    mlat, mlng = 110540.0, 111320.0 * math.cos(math.radians(a.lat))
    P = lambda lng, lat: ((lng - a.lng) * mlng * S + a.px / 2, a.px / 2 - (lat - a.lat) * mlat * S)
    view = shapely.box(a.lng - a.half * 1.1 / mlng, a.lat - a.half * 1.1 / mlat, a.lng + a.half * 1.1 / mlng, a.lat + a.half * 1.1 / mlat)
    img = Image.new("RGB", (a.px, a.px), (236, 231, 220))
    d = ImageDraw.Draw(img)
    pts = lambda coords: [P(x, y) for x, y in coords]
    for r in rows(a.area, "land_use"):
        if r.get("class") in GREEN and r["geometry"].intersects(view):
            for p in polys(r["geometry"]):
                d.polygon(pts(p.exterior.coords), fill=(190, 212, 160))
    for r in rows(a.area, "land"):
        if r.get("class") in ("forest", "wood") and r["geometry"].intersects(view):
            for p in polys(r["geometry"]):
                d.polygon(pts(p.exterior.coords), fill=(160, 192, 138))
    for r in rows(a.area, "water"):
        if r["geometry"].intersects(view):
            for p in polys(r["geometry"]):
                d.polygon(pts(p.exterior.coords), fill=(150, 196, 222))
    segs = [r for r in rows(a.area, "segment") if r.get("subtype") == "road" and r["geometry"].intersects(view)]
    for r in sorted(segs, key=lambda r: ROAD_W.get(r.get("class"), 3)):
        w = max(1, round(ROAD_W.get(r.get("class"), 3) * S * 1.1))
        for l in lines(r["geometry"]):
            d.line(pts(l.coords), fill=(255, 255, 255), width=w, joint="curve")
    for r in rows(a.area, "building"):
        if r.get("is_underground") or not r["geometry"].intersects(view):
            continue
        h = r.get("height") or (r.get("num_floors") or 0) * 3.2
        shade = 150 if not h else max(70, 160 - int(min(h, 150) * 0.6))  # taller = darker
        for p in polys(r["geometry"]):
            d.polygon(pts(p.exterior.coords), fill=(shade, shade - 8, shade - 18), outline=(90, 84, 76))
    # a scale bar and north
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    except OSError:
        f = ImageFont.load_default()
    bar = 200 * S
    d.rectangle([16, a.px - 30, 16 + bar, a.px - 24], fill=(30, 30, 30))
    d.text((16, a.px - 52), "200 m", fill=(30, 30, 30), font=f)
    d.text((a.px - 34, 12), "N ↑", fill=(30, 30, 30), font=f)
    img.save(a.out)
    print(a.out)


if __name__ == "__main__":
    main()
