"""Fetch the Itaewon layer data (subway exits, pedestrian crossings,
street lamps) from Overpass into web/data/itaewon_layers.json.

Spec calls for scripts/fetch_itaewon_layers.mjs — implemented in Python
because this build machine has no Node runtime; the output contract is
identical. Each feature also carries lat/lng so the renderer can place
through the world's shared geoPos projection (guaranteed alignment),
with SW-corner local meters kept as x,z per the spec schema.

    py -3 scripts/fetch_itaewon_layers.py
"""
import json
import math
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data", "itaewon_layers.json")

SOUTH, WEST, NORTH, EAST = 37.5320, 126.9910, 37.5365, 126.9975
BBOX = f"{SOUTH},{WEST},{NORTH},{EAST}"

QUERY = f"""[out:json][timeout:60];
(
  node["railway"="subway_entrance"]({BBOX});
  way["highway"="footway"]["footway"="crossing"]({BBOX});
  node["highway"="crossing"]({BBOX});
  node["highway"="street_lamp"]({BBOX});
);
out geom;"""

# Itaewon Station (Line 6) exit labels, keyed by OSM ref — verified set
EXIT_LABELS = {
    "1": "Hamilton Hotel",
    "2": "Embassies (Pakistan/Egypt/Ecuador/Argentina)",
    "3": "Bogwang Elementary School",
    "4": "Itaewon Market",
}

M_PER_LAT = 110540.0
M_PER_LNG = 111320.0 * math.cos(math.radians(SOUTH))

def local(lat, lng):
    return ((lng - WEST) * M_PER_LNG, (lat - SOUTH) * M_PER_LAT)

def overpass():
    mirrors = ["https://overpass-api.de/api/interpreter",
               "https://overpass.kumi.systems/api/interpreter",
               "https://lz4.overpass-api.de/api/interpreter"]
    last = None
    for url in mirrors:
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": QUERY}).encode(),
                headers={"User-Agent": "rando-world-builder/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:  # try the next mirror
            last = e
    raise SystemExit(f"all Overpass mirrors failed: {last}")

def main():
    data = overpass()
    exits, crossings, lamps = [], [], []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "node":
            lat, lng = el["lat"], el["lon"]
            x, z = local(lat, lng)
            if tags.get("railway") == "subway_entrance":
                ref = tags.get("ref")
                exits.append({"id": el["id"], "ref": ref,
                              "label": EXIT_LABELS.get(ref),
                              "lat": lat, "lng": lng,
                              "x": round(x, 2), "z": round(z, 2)})
            elif tags.get("highway") == "crossing":
                crossings.append({"id": el["id"], "lat": lat, "lng": lng,
                                  "x": round(x, 2), "z": round(z, 2),
                                  "bearingDeg": None, "length": 0})
            elif tags.get("highway") == "street_lamp":
                lamps.append({"id": el["id"], "lat": lat, "lng": lng,
                              "x": round(x, 2), "z": round(z, 2),
                              "source": "osm"})
        elif el["type"] == "way" and tags.get("footway") == "crossing":
            geom = el.get("geometry") or []
            if len(geom) < 2:
                continue
            pts = [local(g["lat"], g["lon"]) for g in geom]
            (x0, z0), (x1, z1) = pts[0], pts[-1]
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            mlat = (geom[0]["lat"] + geom[-1]["lat"]) / 2
            mlng = (geom[0]["lon"] + geom[-1]["lon"]) / 2
            crossings.append({
                "id": el["id"], "lat": mlat, "lng": mlng,
                "x": round(mx, 2), "z": round(mz, 2),
                "bearingDeg": round(math.degrees(math.atan2(z1 - z0, x1 - x0)), 1),
                "length": round(math.hypot(x1 - x0, z1 - z0), 2)})

    out = {"origin": {"lat": SOUTH, "lng": WEST},
           "exits": exits, "crossings": crossings, "lamps": lamps}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"-> {OUT}")
    print(f"exits: {len(exits)}, crossings: {len(crossings)}, lamps: {len(lamps)}")
    for e in exits:
        print(f"  exit ref={e['ref']} label={e['label']} @ {e['lat']:.6f},{e['lng']:.6f}")

if __name__ == "__main__":
    main()
