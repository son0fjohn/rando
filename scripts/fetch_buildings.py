"""Fetch real building footprints for the Itaewon area from OpenStreetMap
and bake them into web/buildings.json in world coordinates.

Same projection as fetch_roads.py (CENTER anchor, 0.55 u/m, north = -z).
Heights come from OSM tags (building:levels / height) with sensible
defaults per building class, exaggerated to the toy scale.

Run once:  py -3 scripts/fetch_buildings.py
Data (c) OpenStreetMap contributors, ODbL. Attribution shown in-app.
"""
import json
import math
import os
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "buildings.json")
CACHE = os.path.join(ROOT, "scripts", "osm_cache_buildings.json")

BBOX = (37.526, 126.985, 37.545, 127.005)
CENTER = (37.5346, 126.9946)
SCALE = 0.55
MIN_AREA_M2 = 30.0        # skip sheds/kiosks
SIMPLIFY_M = 1.0          # Douglas-Peucker tolerance in metres (2.2 turned
                          # small rectangular plots into triangles)
MAX_WORLD_H = 60.0

# squat stylization: real Itaewon plots are small at 0.55 u/m, so tall
# floors made every building a thin slab tower. Chibi-giant proportions
# (player as tall as ~5 floors) keep the city readable.
FLOOR_U = 2.6
BASE_U = 5.0

DEFAULT_LEVELS = {
    "house": 2, "detached": 2, "residential": 3, "apartments": 5,
    "commercial": 3, "retail": 2, "office": 6, "hotel": 8, "school": 3,
    "yes": 3,
}

def project(lat, lng):
    m_lat = 110540.0
    m_lng = 111320.0 * math.cos(math.radians(CENTER[0]))
    x = (lng - CENTER[1]) * m_lng * SCALE
    z = -(lat - CENTER[0]) * m_lat * SCALE
    return x, z

def fetch():
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            return json.load(f)
    q = (f'[out:json][timeout:90];'
         f'(way["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}););out geom;')
    mirrors = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
    ]
    last = None
    for url in mirrors:
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": q}).encode(),
                headers={"User-Agent": "rando-world-builder/1.0"})
            with urllib.request.urlopen(req, timeout=150) as r:
                data = json.loads(r.read())
            with open(CACHE, "w") as f:
                json.dump(data, f)
            return data
        except Exception as e:
            print(f"  mirror failed ({url}): {e}")
            last = e
    raise last

def rdp(pts, eps):
    """Douglas-Peucker on an open point list (metres space)."""
    if len(pts) < 3:
        return pts
    ax, az = pts[0]
    bx, bz = pts[-1]
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        px, pz = pts[i]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1e-9
        d = abs(dx * (az - pz) - (ax - px) * dz) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax <= eps:
        return [pts[0], pts[-1]]
    left = rdp(pts[:idx + 1], eps)
    right = rdp(pts[idx:], eps)
    return left[:-1] + right

def ring_area_m2(pts):
    s = 0.0
    for (x1, z1), (x2, z2) in zip(pts, pts[1:] + pts[:1]):
        s += x1 * z2 - x2 * z1
    return abs(s) / 2.0

def height_units(tags, seed):
    lv = None
    if tags.get("building:levels"):
        try:
            lv = float(tags["building:levels"])
        except ValueError:
            lv = None
    if lv is None and tags.get("height"):
        try:
            lv = max(1.0, float(str(tags["height"]).replace("m", "").strip()) / 3.0)
        except ValueError:
            lv = None
    if lv is None:
        # untagged: default per class + deterministic ±1 floor so the
        # skyline doesn't read as one uniform slab height
        lv = DEFAULT_LEVELS.get(tags.get("building", "yes"), 3) + (seed % 3) - 1
        lv = max(1, lv)
    return round(min(MAX_WORLD_H, BASE_U + lv * FLOOR_U), 1)

def main():
    data = fetch()
    out = []
    skipped = 0
    for way in data.get("elements", []):
        if way.get("type") != "way":
            continue
        geom = way.get("geometry") or []
        if len(geom) < 4:
            continue
        tags = way.get("tags", {})
        b = tags.get("building", "yes")
        if b in ("roof", "wall", "no", "construction"):
            continue
        # metres-space ring (drop the duplicate closing point)
        m_lat = 110540.0
        m_lng = 111320.0 * math.cos(math.radians(CENTER[0]))
        ring = [((g["lon"] - CENTER[1]) * m_lng, -(g["lat"] - CENTER[0]) * m_lat)
                for g in geom[:-1]]
        if ring_area_m2(ring) < MIN_AREA_M2:
            skipped += 1
            continue
        # closed rings can't go through RDP directly (first==last makes a
        # zero-length baseline): split at the farthest vertex from p0 and
        # simplify the two open halves
        if len(ring) <= 5:
            simp = ring
        else:
            far = max(range(1, len(ring)),
                      key=lambda i: (ring[i][0] - ring[0][0]) ** 2 +
                                    (ring[i][1] - ring[0][1]) ** 2)
            a = rdp(ring[:far + 1], SIMPLIFY_M)
            bseg = rdp(ring[far:] + [ring[0]], SIMPLIFY_M)
            simp = a[:-1] + bseg[:-1]
        if len(simp) < 3:
            simp = ring
        pts = [[round(x * SCALE, 1), round(z * SCALE, 1)] for x, z in simp]
        seed = abs(hash((round(ring[0][0]), round(ring[0][1]))))
        out.append({"p": pts, "h": height_units(tags, seed)})
    payload = {
        "attribution": "Building data (c) OpenStreetMap contributors (ODbL)",
        "buildings": out,
    }
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    pts_total = sum(len(b["p"]) for b in out)
    print(f"saved {OUT}: {len(out)} buildings, {pts_total} pts, "
          f"{os.path.getsize(OUT) // 1024}KB (skipped {skipped} tiny)")

if __name__ == "__main__":
    main()
