"""Bind every hero asset to ONE specific VWorld registry building.

The pin-guessing era (EXIF spots, nearest-footprint snapping) put heroes
on wrong neighbors — agave on Hamilton's plot, the Danco/Waikiki corner
shuffled, Hamilton squished by a bad photogrammetry sample. This makes
the registry authoritative per hero:

  landmarks.json gains, per bound hero:
    fp   — the building's exact footprint in world units
    lat/lng — recentered to the building centroid
    h    — floors * 3.2 m in world convention (registry truth)
    reg  — the registry id (bd_mgt_sn) for provenance

Bindings resolve by explicit address (road + number), by registry name
(Hamilton, the station structure), or by nearest-candidate rules for
the photo-pinned venues (excluding already-bound buildings). The engine
prefers fp when present — zero searching at load.

    py -3 scripts/bind_heroes.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = json.load(open(os.path.join(ROOT, "web", "data", "registry_buildings.json")))
LMP = os.path.join(ROOT, "web", "landmarks.json")
LM = json.load(open(LMP, encoding="utf-8"))

CENTER = (37.5346, 126.9946)
SCALE = 0.55
VEXAG = 2.4
LEVEL_M = 3.2
M_LAT = 110540.0
M_LNG = 111320.0 * math.cos(math.radians(CENTER[0]))

def project(lat, lng):
    return ((lng - CENTER[1]) * M_LNG * SCALE,
            -(lat - CENTER[0]) * M_LAT * SCALE)

def centroid_ll(b):
    fp = b["footprint"]
    return (sum(p[1] for p in fp) / len(fp), sum(p[0] for p in fp) / len(fp))

def dist_m(lat1, lng1, lat2, lng2):
    return math.hypot((lat1 - lat2) * M_LAT, (lng1 - lng2) * M_LNG)

def by_addr(road, no):
    return next((b for b in REG if b.get("road") == road
                 and str(b.get("road_no") or "") == str(no)), None)

def by_name(frag):
    return next((b for b in REG if frag in (b.get("name") or "")), None)

def nearest(lat, lng, cand):
    best, bd = None, 1e18
    for b in cand:
        cl, cg = centroid_ll(b)
        d = dist_m(lat, lng, cl, cg)
        if d < bd:
            bd, best = d, b
    return best, bd

taken = set()

def bind(hero_id, building, rule):
    if building is None:
        print(f"  {hero_id:20s} UNRESOLVED ({rule})")
        return
    e = next(l for l in LM["landmarks"] if l["id"] == hero_id)
    cl, cg = centroid_ll(building)
    fp = [[round(x, 1), round(z, 1)] for x, z in
          (project(p[1], p[0]) for p in building["footprint"])]
    fl = building.get("floors")
    e["lat"], e["lng"] = round(cl, 6), round(cg, 6)
    e["fp"] = fp
    e["reg"] = building["id"]
    if fl:
        e["h"] = round(fl * LEVEL_M * SCALE * VEXAG, 1)
    taken.add(building["id"])
    rd = f"{building.get('road') or '?'} {building.get('road_no') or ''}".strip()
    nm = building.get("name") or "-"
    print(f"  {hero_id:20s} -> {rd:20s} {nm:12s} "
          f"{int(fl) if fl else '?'}F  h={e.get('h')}  ({rule})")

print("== binding heroes to registry buildings ==")
# explicit, confirmed bindings first
bind("hamilton-hotel", by_name("해밀톤관광호텔"), "registry name")
bind("itaewon-station", by_name("이태원역"), "registry name (Line 6 structure)")
bind("grand-ole-opry", by_addr("우사단로14길", "16"), "audited address")
bind("jacks-bar", by_addr("이태원로27가길", "52"), "audited address")
bind("danco", by_addr("이태원로27가길", "13"), "audited address")
bind("bolero", by_addr("이태원로", "220"), "user address")
bind("grainhaus", by_addr("우사단로", "40"), "user address (킹클럽 building)")

# soap: exact number first, else nearest on its street to the OSM pin
soap_b = by_addr("보광로60길", "14") or nearest(
    37.533591, 126.994917,
    [b for b in REG if b.get("road") == "보광로60길"])[0]
bind("soap", soap_b, "street-constrained")

# waikiki: the corner complex NEXT to danco on 27가길 (danco—Off The
# Record—waikiki are one connected block face). Candidates: same street,
# not yet taken, within 40 m of the photo spot; nearest wins.
wk = nearest(37.534733, 126.994461,
             [b for b in REG if b.get("road") == "이태원로27가길"
              and b["id"] not in taken])
bind("waikiki", wk[0], f"27가길 adjacency ({wk[1]:.0f}m from photo)")

# beach-pub: nearest strip building to its photo spot, not taken
bp = nearest(37.534972, 126.993394,
             [b for b in REG if b.get("road") in ("이태원로27가길", "이태원로")
              and b["id"] not in taken])
bind("waikiki-beach-pub", bp[0], f"strip nearest ({bp[1]:.0f}m from photo)")

# agave: perpendicular alley off the cluster — nearest to its photo spot
# that is NOT on 이태원로 (excludes Hamilton's plot) and not taken
ag = nearest(37.534953, 126.994194,
             [b for b in REG if b.get("road") not in (None, "이태원로")
              and b["id"] not in taken])
bind("agave", ag[0], f"non-main-road nearest ({ag[1]:.0f}m from photo)")

json.dump(LM, open(LMP, "w"), indent=2)
print("-> landmarks.json (fp/reg/h per bound hero)")
