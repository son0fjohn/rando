"""Fetch real Itaewon street geometry from OpenStreetMap (Overpass API)
and bake it into web/roads.json as local world coordinates.

Run once (or whenever the area should refresh):  py -3 scripts/fetch_roads.py
The app never calls OSM at runtime — it loads the committed JSON.
Data (c) OpenStreetMap contributors, ODbL. Attribution shown in-app.
"""
import json
import math
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "roads.json")

# Itaewon bounding box and projection anchor (Itaewon station)
BBOX = (37.526, 126.985, 37.545, 127.005)
CENTER = (37.5346, 126.9946)
SCALE = 0.55           # world units per meter (toy-town scale)
MIN_PT_DIST = 10.0     # metres — thin dense polylines
KEEP = {
    "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "residential", "unclassified", "pedestrian",
}

def project(lat, lng):
    m_per_deg_lat = 110540.0
    m_per_deg_lng = 111320.0 * math.cos(math.radians(CENTER[0]))
    x = (lng - CENTER[1]) * m_per_deg_lng * SCALE
    z = -(lat - CENTER[0]) * m_per_deg_lat * SCALE  # north = -z (up-screen)
    return x, z

q = f'[out:json][timeout:60];(way["highway"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}););out geom;'
req = urllib.request.Request(
    "https://overpass-api.de/api/interpreter",
    data=urllib.parse.urlencode({"data": q}).encode(),
    headers={"User-Agent": "rando-world-builder/1.0"})
with urllib.request.urlopen(req, timeout=90) as r:
    data = json.loads(r.read())

roads = []
total_pts = 0
for way in data.get("elements", []):
    if way.get("type") != "way":
        continue
    kind = way.get("tags", {}).get("highway")
    if kind not in KEEP:
        continue
    pts = []
    last = None
    geom = way.get("geometry", [])
    for i, g in enumerate(geom):
        x, z = project(g["lat"], g["lon"])
        if last is not None and i < len(geom) - 1:
            d = math.hypot(x - last[0], z - last[1]) / SCALE
            if d < MIN_PT_DIST:
                continue
        pts.append([round(x, 1), round(z, 1)])
        last = (x, z)
    if len(pts) >= 2:
        base = kind.split("_")[0]  # fold _link into the parent class
        roads.append({"t": base, "p": pts})
        total_pts += len(pts)

out = {
    "attribution": "Road data (c) OpenStreetMap contributors (ODbL)",
    "center": CENTER,
    "scale": SCALE,
    "roads": roads,
}
with open(OUT, "w") as f:
    json.dump(out, f, separators=(",", ":"))

kinds = {}
for r_ in roads:
    kinds[r_["t"]] = kinds.get(r_["t"], 0) + 1
print(f"saved {OUT}: {len(roads)} roads, {total_pts} pts, {os.path.getsize(OUT)//1024}KB")
print("by class:", kinds)
