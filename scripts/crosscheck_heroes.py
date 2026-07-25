"""Cross-check hero placement against the VWorld registry, and emit
street-name label data from the same source.

1. Heroes: for each placed landmark, find the registry building whose
   footprint CONTAINS the pin (that building's name/road is what the
   twin thinks stands there). Pins on the street report the nearest
   building + distance instead. Nothing is auto-moved — output is a
   review table (the engine's own normalizer snaps at load time).
2. Streets: roads with >= 12 registry buildings get a label anchor at
   their buildings' mean position -> web/data/street_labels.json.

    py -3 scripts/crosscheck_heroes.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = json.load(open(os.path.join(ROOT, "web", "data", "registry_buildings.json")))
LM = json.load(open(os.path.join(ROOT, "web", "landmarks.json")))
OUT = os.path.join(ROOT, "web", "data", "street_labels.json")

M_LAT = 110540.0
M_LNG = 111320.0 * math.cos(math.radians(37.5346))

def inside(lat, lng, fp):
    ins = False
    n = len(fp)
    for i in range(n):
        x1, y1 = fp[i]          # [lng, lat]
        x2, y2 = fp[(i + 1) % n]
        if (y1 > lat) != (y2 > lat) and \
           lng < (x2 - x1) * (lat - y1) / ((y2 - y1) or 1e-12) + x1:
            ins = not ins
    return ins

def centroid(fp):
    return (sum(p[1] for p in fp) / len(fp), sum(p[0] for p in fp) / len(fp))

print("== hero pins vs registry buildings ==")
for l in LM["landmarks"]:
    if not l.get("glb") or l.get("lat") is None:
        continue
    host = next((b for b in REG if inside(l["lat"], l["lng"], b["footprint"])), None)
    if host:
        nm = host.get("name") or "(unnamed)"
        rd = f"{host.get('road') or '?'} {host.get('road_no') or ''}".strip()
        fl = host.get("floors")
        print(f"  {l['id']:20s} INSIDE  {nm:14s} {rd:18s} {int(fl) if fl else '?'}F")
    else:
        best, bd = None, 1e18
        for b in REG:
            clat, clng = centroid(b["footprint"])
            d = math.hypot((clat - l["lat"]) * M_LAT, (clng - l["lng"]) * M_LNG)
            if d < bd:
                bd, best = d, b
        rd = f"{best.get('road') or '?'} {best.get('road_no') or ''}".strip()
        nm = best.get("name") or "(unnamed)"
        print(f"  {l['id']:20s} street  nearest {bd:4.0f}m: {nm} {rd}")

# ---- street labels from real road names ----
roads = {}
for b in REG:
    rd = b.get("road")
    if not rd:
        continue
    clat, clng = centroid(b["footprint"])
    roads.setdefault(rd, []).append((clat, clng))

labels = []
for rd, pts in sorted(roads.items(), key=lambda kv: -len(kv[1])):
    if len(pts) < 12:
        continue
    labels.append({
        "name": rd,
        "lat": round(sum(p[0] for p in pts) / len(pts), 6),
        "lng": round(sum(p[1] for p in pts) / len(pts), 6),
        "n": len(pts)})
labels = labels[:14]
json.dump(labels, open(OUT, "w"))
print(f"-> {OUT}: {len(labels)} street labels "
      f"({', '.join(l['name'] for l in labels[:6])} ...)")
