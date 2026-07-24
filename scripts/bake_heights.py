"""Bake the resolved zone heights (itaewon_heights.json) into the static
buildings.json the generic field extrudes from.

Scale note: the world runs 0.55 units/meter horizontally with a
deliberate ~2.4x vertical exaggeration (tuned against the oversized
player character — see fetch_buildings.py's 5 + 2.6/level formula vs
real 3.2 m levels). Baking TRUE meter heights would halve the skyline,
so real heights are converted into that established convention:

    h_world = heightM * 0.55 * 2.4

which preserves the stylized scale while making every building's height
RELATIVELY correct — the actual realism gap. Each patched building gets
an "hsrc" flag (osm-height / osm-levels / default) for hand-correction.

    py -3 scripts/bake_heights.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDINGS = os.path.join(ROOT, "web", "buildings.json")
LAYERS = os.path.join(ROOT, "web", "data", "itaewon_layers.json")
HEIGHTS = os.path.join(ROOT, "web", "data", "itaewon_heights.json")
SOURCES = os.path.join(ROOT, "web", "data", "itaewon_heights_sources.json")

# world projection (must match fetch_buildings.py / fetch_roads.py)
CENTER = (37.5346, 126.9946)
SCALE = 0.55
VEXAG = 2.4
MATCH_R = 3.0  # world units (~5.5 m) centroid match tolerance

def project(lat, lng):
    m_lat = 110540.0
    m_lng = 111320.0 * math.cos(math.radians(CENTER[0]))
    return ((lng - CENTER[1]) * m_lng * SCALE,
            -(lat - CENTER[0]) * m_lat * SCALE)

def main():
    bdata = json.load(open(BUILDINGS))
    layers = json.load(open(LAYERS))
    heights = json.load(open(HEIGHTS))
    sources = json.load(open(SOURCES))

    # world-space centroids of the field buildings
    field = []
    for b in bdata["buildings"]:
        cx = sum(p[0] for p in b["p"]) / len(b["p"])
        cz = sum(p[1] for p in b["p"]) / len(b["p"])
        field.append((cx, cz, b))

    patched = {"osm-height": 0, "osm-levels": 0, "default": 0}
    missed = 0
    for zb in layers["buildings"]:
        bid = str(zb["id"])
        hM = heights.get(bid)
        if hM is None:
            continue
        x, z = project(zb["centroid"]["lat"], zb["centroid"]["lng"])
        best, bd = None, MATCH_R * MATCH_R
        for cx, cz, b in field:
            d2 = (cx - x) ** 2 + (cz - z) ** 2
            if d2 < bd:
                bd = d2
                best = b
        if best is None:
            missed += 1
            continue
        h = hM * SCALE * VEXAG
        if sources[bid] == "default":
            # a flat default would UNIFORM the skyline (worse than the old
            # jitter); keep deterministic ±20% variety on flagged buildings
            r = (zb["id"] * 2654435761 % 1000) / 1000
            h *= 0.8 + 0.4 * r
        best["h"] = round(h, 1)
        best["hsrc"] = sources[bid]
        patched[sources[bid]] += 1

    json.dump(bdata, open(BUILDINGS, "w"))
    total = sum(patched.values())
    print(f"patched {total}/{len(layers['buildings'])} zone buildings "
          f"into buildings.json ({patched}), unmatched: {missed}")

if __name__ == "__main__":
    main()
