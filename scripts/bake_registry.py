"""Digital twin bake: reconcile the official building registry into the
field the engine renders (web/buildings.json).

Per registry building inside the city bbox:
- Project the exact registry footprint into world coordinates (same
  CENTER/SCALE/north=-z convention as every other bake).
- Match against the existing field by centroid distance.
- MATCH: replace the OSM footprint with the registry footprint
  (simplified with the same RDP tolerance the OSM bake used) and set
  height from, in order: measured 3D-Tiles height (kept — photogrammetry
  beats registry paperwork), registry heightM, registry floors*3.2,
  else leave as-is. hsrc records the winning source.
- NO MATCH (registry building OSM never had): append it — this is where
  the twin gains real coverage.

Heights convert with the world's vertical convention (SCALE * VEXAG),
keeping RELATIVE truth inside the stylized scale.

    py -3 scripts/bake_registry.py [--dry-run]
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = os.path.join(ROOT, "web", "data", "registry_buildings.json")
BUILDINGS = os.path.join(ROOT, "web", "buildings.json")

CENTER = (37.5346, 126.9946)
SCALE = 0.55
VEXAG = 2.4
LEVEL_M = 3.2
MATCH_R = 5.0      # world units (~9 m) centroid tolerance
SIMPLIFY = 0.8     # RDP tolerance in world units (matches field density)

def project(lat, lng):
    m_lat = 110540.0
    m_lng = 111320.0 * math.cos(math.radians(CENTER[0]))
    return ((lng - CENTER[1]) * m_lng * SCALE,
            -(lat - CENTER[0]) * m_lat * SCALE)

def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    dmax, idx = 0, 0
    x1, z1 = pts[0]; x2, z2 = pts[-1]
    dx, dz = x2 - x1, z2 - z1
    L = math.hypot(dx, dz) or 1e-9
    for i in range(1, len(pts) - 1):
        d = abs(dx * (z1 - pts[i][1]) - (x1 - pts[i][0]) * dz) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        a = rdp(pts[:idx + 1], eps)
        b = rdp(pts[idx:], eps)
        return a[:-1] + b
    return [pts[0], pts[-1]]

def main():
    if not os.path.exists(REG):
        print("registry data missing — run fetch_bldg_registry.py first")
        return 0
    reg = json.load(open(REG))
    bdata = json.load(open(BUILDINGS))
    dry = "--dry-run" in sys.argv

    field = []
    for b in bdata["buildings"]:
        cx = sum(p[0] for p in b["p"]) / len(b["p"])
        cz = sum(p[1] for p in b["p"]) / len(b["p"])
        field.append([cx, cz, b])

    replaced = appended = height_only = skipped = 0
    def simplify_ring(ring, eps):
        # closed rings need a split before RDP: with first==last the
        # baseline is degenerate and the whole ring collapses (same fix
        # as fetch_buildings.py's closed-ring split)
        if len(ring) < 5:
            return ring
        k = len(ring) // 2
        a = rdp(ring[:k + 1], eps)
        b = rdp(ring[k:] + [ring[0]], eps)
        return a[:-1] + b[:-1]

    for rb in reg:
        ring = [project(lat, lng) for lng, lat in rb["footprint"]]
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        simp = simplify_ring(ring, SIMPLIFY)
        if len(simp) < 3:
            skipped += 1
            continue
        cx = sum(p[0] for p in simp) / len(simp)
        cz = sum(p[1] for p in simp) / len(simp)
        if math.hypot(cx, cz) > 1050:
            skipped += 1
            continue

        hM = rb.get("heightM") or (rb["floors"] * LEVEL_M if rb.get("floors") else None)
        best, bd = None, MATCH_R * MATCH_R
        for rec in field:
            d2 = (rec[0] - cx) ** 2 + (rec[1] - cz) ** 2
            if d2 < bd:
                bd, best = d2, rec
        poly = [[round(x, 1), round(z, 1)] for x, z in simp]
        if best is not None:
            b = best[2]
            b["p"] = poly
            if b.get("hsrc") == "tiles":
                height_only += 1   # measured height wins; footprint updated
            elif hM:
                b["h"] = round(hM * SCALE * VEXAG, 1)
                b["hsrc"] = "registry"
            b["use"] = rb.get("use")
            replaced += 1
            best[0], best[1] = cx, cz
        else:
            # appended = coverage OSM never had; gate out sheds/annexes so
            # the field gains real buildings, not clutter (~26 m² floor)
            area = abs(sum(simp[i][0] * simp[(i + 1) % len(simp)][1] -
                           simp[(i + 1) % len(simp)][0] * simp[i][1]
                           for i in range(len(simp)))) / 2
            if area < 8:
                skipped += 1
                continue
            nb = {"p": poly, "h": round((hM or 11.0) * SCALE * VEXAG, 1),
                  "hsrc": "registry" if hM else "registry-default"}
            bdata["buildings"].append(nb)
            field.append([cx, cz, nb])
            appended += 1

    print(f"registry reconcile: {replaced} footprints replaced "
          f"({height_only} kept measured tiles heights), "
          f"{appended} new buildings appended, {skipped} skipped")
    if dry:
        print("(dry-run — nothing written)")
        return 0
    json.dump(bdata, open(BUILDINGS, "w"))
    print(f"-> {BUILDINGS} now {len(bdata['buildings'])} buildings")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
