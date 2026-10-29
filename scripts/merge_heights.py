"""Merge every height source we have for Itaewon's hand-made map into
web/buildings.json, one decision per building, deterministically.

Sources (all files already in the repo; nothing is fetched):

  google    Google Photorealistic 3D Tiles, measured offline by
            scripts/capture_heights_reference.py: web/data/itaewon_heights.json
            + itaewon_heights_sources.json ("tiles" entries only; its
            "default" rows are a placeholder, not a measurement), keyed by
            the OSM way id of web/data/itaewon_layers.json, whose footprints
            are the join.
  vworld    the official building registry (VWorld LT_C_SPBD),
            web/data/registry_buildings.json: ground-floor counts only,
            FLOOR_M (3.3 m) per floor.
  osm       OpenStreetMap tags: height / building:levels from the layers
            file, else Overture's building theme for the area
            (scripts/overture_cache/itaewon.building.parquet, OSM-derived).
  estimated nothing above: the median of the sourced buildings within
            EST_R_M, else a class default, with a deterministic jitter.

Joins are by footprint overlap (intersection / the smaller area >= OVERLAP),
never by id, so the registry-shaped footprints bake_registry.py wrote still
find their Google / OSM twins.

The rule, per building (the product owner's, written out):

  both google and vworld
    |g - v| <= max(AGREE_ABS, AGREE_REL * v)      -> google ("agree")
    g below v                                     -> vworld: a registered
        floor can't be scanned away, so the scan sampled a courtyard, a
        lower wing or the street. Exception: OSM agrees with Google
        (the registry is the outdated one) -> google.
    g above v
        a neighbour within NEAR_M whose own height matches g (within
        MERGE_TOL) and stands above v                -> vworld (the scan
                                                      merged the two)
        OSM has a height: the one nearer to OSM wins -> google or vworld
        excess <= ROOFTOP_M (two floors)             -> google (rooftop
                                                      floors, parapets,
                                                      a sloping lot)
        a small lot (<= 2 floors or < SMALL_M2)      -> vworld (trees and
                                                      the hill inflate a
                                                      small scan)
        else                                          -> google
  google and osm only: the same comparison with OSM as the second opinion.
  vworld and osm only: vworld, unless the registry row has <= PODIUM_FLOORS
    floors and OSM maps the block at twice that or more (a podium / lot
    record on an apartment block) -> osm.
  one source: that one. None: estimated (the median of the sourced
    neighbours within EST_R_M, capped by the lot's size, else a class
    default; a deterministic +-15 % jitter so a street doesn't read as one
    slab).

hsrc on every building is one of google / vworld / osm / estimated. h stays
in world units: metres * SCALE * VEXAG. Footprints, cls and nm are kept.

    python3 scripts/merge_heights.py                 # rewrite web/buildings.json
    python3 scripts/merge_heights.py --dry-run       # the report only
    python3 scripts/merge_heights.py --report out.json [--out other.json]

Runs after bake_registry.py (footprints), replacing bake_heights.py.
Needs shapely and pyarrow (the same as bake_city_tiles.py).
"""
import json
import math
import os
import statistics
import sys

import pyarrow.parquet as pq
import shapely
from shapely.geometry import Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDINGS = os.path.join(ROOT, "web", "buildings.json")
REG = os.path.join(ROOT, "web", "data", "registry_buildings.json")
LAYERS = os.path.join(ROOT, "web", "data", "itaewon_layers.json")
HEIGHTS = os.path.join(ROOT, "web", "data", "itaewon_heights.json")
SOURCES = os.path.join(ROOT, "web", "data", "itaewon_heights_sources.json")
OVERTURE = os.path.join(ROOT, "scripts", "overture_cache", "itaewon.building.parquet")

# world projection (must match fetch_buildings.py / bake_registry.py)
CENTER = (37.5346, 126.9946)
SCALE = 0.55
VEXAG = 2.4
M_LAT = 110540.0
M_LNG = 111320.0 * math.cos(math.radians(CENTER[0]))
U2M = 1.0 / SCALE                 # world units -> metres (horizontal)
M2_PER_U2 = U2M * U2M

FLOOR_M = 3.3        # a registry / OSM floor, in metres (owner: 3-3.5)
OVERLAP = 0.5        # footprint intersection / smaller area to call it the same building
AGREE_ABS = 3.5      # google and vworld "roughly agree" within one floor...
AGREE_REL = 0.30     # ...or 30 %
ROOFTOP_M = 2 * FLOOR_M   # rooftop floors the registry may not count
NEAR_M = 25.0        # a neighbour the scan may have merged
MERGE_TOL = 0.15     # ... when its height matches google's within 15 %
SMALL_M2 = 150.0     # a small lot: trees / the hill inflate its scan
PODIUM_FLOORS = 2    # a registry row this low on a block OSM maps far taller is a podium / lot record
EST_R_M = 60.0       # neighbourhood for estimates
EST_MIN_N = 3
EST_MIN_M, EST_MAX_M = 3.0, 40.0
EST_LOT_CAP = ((60, 3), (200, 5), (500, 8))   # (lot m2, floors at most) for estimates
CLASS_FLOORS = {"house": 2, "detached": 2, "residential": 3, "apartments": 5,
                "commercial": 3, "retail": 2, "office": 6, "hotel": 8,
                "school": 4, "hospital": 5, "church": 3, "kindergarten": 2}
CLS_FLOORS = {"res": 2, "shop": 3, "mixed": 3, "office": 6}


def project(lat, lng):
    return ((lng - CENTER[1]) * M_LNG * SCALE, -(lat - CENTER[0]) * M_LAT * SCALE)


def poly(pts):
    if len(pts) < 3:
        return None
    try:
        p = Polygon(pts)
        if not p.is_valid:
            p = p.buffer(0)
        return p if not p.is_empty else None
    except Exception:
        return None


def to_m(h_world):
    return h_world / (SCALE * VEXAG)


def to_world(m):
    return round(m * SCALE * VEXAG, 1)


class Field:
    """The hand-made map's buildings and footprint joins against it."""

    def __init__(self, buildings):
        self.b = buildings
        self.polys = [poly(x["p"]) for x in buildings]
        self.tree = shapely.STRtree([p if p is not None else Polygon() for p in self.polys])
        self.area_m2 = [(p.area if p is not None else 0.0) * M2_PER_U2 for p in self.polys]
        self.cent = [(p.centroid.x, p.centroid.y) if p is not None else
                     (sum(q[0] for q in x["p"]) / len(x["p"]), sum(q[1] for q in x["p"]) / len(x["p"]))
                     for p, x in zip(self.polys, buildings)]

    def match(self, src):
        """Index of the field building the source footprint is, by overlap."""
        if src is None or src.is_empty:
            return None, 0.0
        best, bs = None, 0.0
        for i in sorted(int(k) for k in self.tree.query(src, predicate="intersects")):
            fp = self.polys[i]
            if fp is None:
                continue
            s = src.intersection(fp).area / max(1e-9, min(src.area, fp.area))
            if s > bs:
                bs, best = s, i
        return (best, bs) if bs >= OVERLAP else (None, bs)

    def near(self, i, radius_m):
        """Other buildings whose footprint comes within radius_m of this one."""
        p = self.polys[i]
        if p is None:
            return []
        ring = p.buffer(radius_m * SCALE)
        return sorted(int(k) for k in self.tree.query(ring, predicate="intersects") if int(k) != i)


def join_best(field, items):
    """items: (source_poly, payload). One payload per field index: the best
    overlap wins; a tie keeps the first (stable)."""
    out, score = {}, {}
    for src, payload in items:
        i, s = field.match(src)
        if i is None or s <= score.get(i, 0.0):
            continue
        out[i], score[i] = payload, s
    return out


def load_sources(field):
    # registry -> floors
    reg = json.load(open(REG))
    reg_items = []
    for r in reg:
        ring = [project(lat, lng) for lng, lat in r["footprint"]]
        reg_items.append((poly(ring), r))
    vworld = join_best(field, reg_items)

    # google layers -> measured height (tiles) + OSM tags
    layers = json.load(open(LAYERS))
    heights = json.load(open(HEIGHTS))
    sources = json.load(open(SOURCES))
    olat, olng = layers["origin"]["lat"], layers["origin"]["lng"]
    lay_items = []
    for zb in layers["buildings"]:
        ring = [project(olat + zn / M_LAT, olng + xe / M_LNG) for xe, zn in zb["footprint"]]
        bid = str(zb["id"])
        lay_items.append((poly(ring), {
            "id": zb["id"],
            "google": heights.get(bid) if sources.get(bid) == "tiles" else None,
            "osm_h": zb.get("heightM"), "osm_levels": zb.get("levels")}))
    layer = join_best(field, lay_items)
    n_tiles = sum(1 for s in sources.values() if s == "tiles")

    # overture (OSM-derived) -> height / floors / class
    ov_items = []
    if os.path.exists(OVERTURE):
        t = pq.read_table(OVERTURE, columns=["id", "names", "height", "num_floors", "class", "geometry"]).to_pylist()
        for r in t:
            g = shapely.from_wkb(r["geometry"])
            g = shapely.transform(g, lambda a: [[*project(y, x)] for x, y in a[:, :2]])
            nm = (r.get("names") or {}).get("primary") if r.get("names") else None
            ov_items.append((g, {"osm_h": r["height"], "osm_levels": r["num_floors"],
                                 "class": r["class"], "name": nm}))
    overture = join_best(field, ov_items)
    return vworld, layer, overture, {"registry": len(reg), "layers": len(layers["buildings"]),
                                     "tiles": n_tiles, "overture": len(ov_items)}


def candidates(i, vworld, layer, overture):
    """Per building: google m, vworld m (+ floors), osm m (+ where from)."""
    g = layer.get(i, {}).get("google")
    r = vworld.get(i)
    floors = r.get("floors") if r else None
    v = floors * FLOOR_M if floors else None
    o, okind = None, None
    for src, tag in ((layer.get(i, {}), "layers"), (overture.get(i, {}), "overture")):
        if src.get("osm_h"):
            o, okind = float(src["osm_h"]), f"{tag} height"
            break
        if src.get("osm_levels"):
            o, okind = float(src["osm_levels"]) * FLOOR_M, f"{tag} levels"
            break
    return g, v, floors, o, okind


def decide(i, field, cands, all_cands):
    """-> (metres, hsrc, why) or (None, 'estimated', why)."""
    g, v, floors, o, okind = cands
    if g is not None and v is not None:
        return compare(i, field, g, v, "vworld", o, floors, all_cands)
    if g is not None and o is not None:
        return compare(i, field, g, o, "osm", None, floors, all_cands)
    if g is not None:
        return g, "google", "google only"
    if v is not None and o is not None:
        return registry_vs_osm(v, floors, o, okind)
    if v is not None:
        return v, "vworld", f"vworld only ({floors:g} floors)"
    if o is not None:
        return o, "osm", f"osm only ({okind})"
    return None, "estimated", "no source"


def registry_vs_osm(v, floors, o, okind):
    """No scan, two statements: the registry's floors and OSM's tag."""
    if abs(v - o) <= max(AGREE_ABS, AGREE_REL * max(v, o)):
        return v, "vworld", f"vworld ({floors:g} floors), OSM ({o:.1f} m, {okind}) agrees"
    if floors <= PODIUM_FLOORS and o >= 2 * v:
        return o, "osm", (f"the registry row says {floors:g} floor(s) on a block OSM maps at {o:.1f} m "
                          f"({okind}): a podium / lot record, so OSM")
    return v, "vworld", f"vworld ({floors:g} floors) over OSM ({o:.1f} m, {okind}): the registry counts floors"


def compare(i, field, g, alt, alt_src, o, floors, all_cands):
    tol = max(AGREE_ABS, AGREE_REL * alt)
    if abs(g - alt) <= tol:
        return g, "google", "agree"
    if g < alt:
        if o is not None and abs(g - o) <= max(AGREE_ABS, AGREE_REL * o):
            return g, "google", f"google below the registry but OSM ({o:.1f} m) agrees with it: the registry is outdated"
        return alt, alt_src, (f"google ({g:.1f} m) is below the {alt_src} floors ({alt:.1f} m): "
                              "the scan sampled a courtyard, a lower wing or the street")
    # google higher
    for j in field.near(i, NEAR_M):
        gj, vj, fj, oj, _ = all_cands[j]
        hn = vj if vj is not None else oj
        if hn is None or hn <= alt + tol:
            continue
        if abs(hn - g) <= MERGE_TOL * g:
            nb = field.b[j].get("nm") or f"#{j}"
            return alt, alt_src, (f"google ({g:.1f} m) matches the neighbour {nb} ({hn:.1f} m): "
                                  f"the scan merged the two; {alt_src} {alt:.1f} m")
    if o is not None:
        pick = ("google", g) if abs(g - o) <= abs(alt - o) else (alt_src, alt)
        return pick[1], pick[0], f"google {g:.1f} vs {alt_src} {alt:.1f}; OSM ({o:.1f} m) sides with {pick[0]}"
    if g - alt <= ROOFTOP_M:
        return g, "google", (f"google {g:.1f} m over {alt_src} {alt:.1f} m by under two floors: "
                             "rooftop floors / parapet / a sloping lot")
    if (floors is not None and floors <= 2) or field.area_m2[i] < SMALL_M2:
        return alt, alt_src, (f"google {g:.1f} m far over {alt_src} {alt:.1f} m on a small lot: "
                              "trees or the hill in the scan")
    return g, "google", f"google {g:.1f} m far over {alt_src} {alt:.1f} m on a big building: the registry undercounts"


def jitter(cx, cz):
    """Deterministic 0.85-1.15 off the footprint's centroid."""
    k = (int(round(cx * 10)) * 2654435761 + int(round(cz * 10)) * 40503) % 1000
    return 0.85 + 0.30 * k / 1000.0


def estimate(i, field, resolved, overture):
    """Median of the sourced neighbours within EST_R_M, else a class default."""
    hs = sorted(resolved[j][0] for j in field.near(i, EST_R_M)
                if resolved[j][0] is not None and resolved[j][1] != "estimated")
    if len(hs) >= EST_MIN_N:
        m, why = statistics.median(hs), f"median of {len(hs)} sourced neighbours"
    else:
        cls = (overture.get(i, {}).get("class") or "")
        fl = CLASS_FLOORS.get(cls) or CLS_FLOORS.get(field.b[i].get("cls") or "", 3)
        m, why = fl * FLOOR_M, f"class default ({cls or field.b[i].get('cls') or 'none'}: {fl} floors)"
    for lot_m2, max_floors in EST_LOT_CAP:   # a small lot never gets its neighbours' tower
        if field.area_m2[i] < lot_m2:
            m = min(m, max_floors * FLOOR_M)
            break
    cx, cz = field.cent[i]
    m = min(EST_MAX_M, max(EST_MIN_M, m * jitter(cx, cz)))
    return m, why


def spearman(xs, ys):
    def ranks(a):
        order = sorted(range(len(a)), key=lambda k: a[k])
        r = [0.0] * len(a)
        k = 0
        while k < len(order):
            j = k
            while j + 1 < len(order) and a[order[j + 1]] == a[order[k]]:
                j += 1
            for q in range(k, j + 1):
                r[order[q]] = (k + j) / 2 + 1
            k = j + 1
        return r
    if len(xs) < 3:
        return None
    rx, ry = ranks(xs), ranks(ys)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) or 1e-9
    return num / den


def distribution(ms):
    ms = sorted(ms)
    n = len(ms)
    return {"n": n, "min": round(ms[0], 1), "p50": round(ms[n // 2], 1),
            "mean": round(sum(ms) / n, 1), "p95": round(ms[int(n * 0.95)], 1),
            "max": round(ms[-1], 1), "over30m": sum(1 for m in ms if m > 30),
            "over60m": sum(1 for m in ms if m > 60), "under3m": sum(1 for m in ms if m < 3)}


def main(argv):
    dry = "--dry-run" in argv
    out_path = argv[argv.index("--out") + 1] if "--out" in argv else BUILDINGS
    rep_path = argv[argv.index("--report") + 1] if "--report" in argv else None

    bdata = json.load(open(BUILDINGS))
    field = Field(bdata["buildings"])
    before = [to_m(b["h"]) for b in field.b]
    vworld, layer, overture, totals = load_sources(field)

    all_cands = [candidates(i, vworld, layer, overture) for i in range(len(field.b))]
    resolved = [decide(i, field, all_cands[i], all_cands) for i in range(len(field.b))]
    # estimates last: they lean on the sourced neighbours
    for i, (m, src, why) in enumerate(resolved):
        if m is None:
            m, why = estimate(i, field, resolved, overture)
            resolved[i] = (m, "estimated", why)

    # ---- report ----
    won = {}
    disagreements = []
    both = []
    for i, (m, src, why) in enumerate(resolved):
        won[src] = won.get(src, 0) + 1
        g, v, floors, o, okind = all_cands[i]
        if g is not None and v is not None:
            both.append((g, v))
        if g is not None and (v is not None or o is not None) and why != "agree":
            r = vworld.get(i) or {}
            disagreements.append({
                "index": i, "name": r.get("name") or overture.get(i, {}).get("name"),
                "road": " ".join(x for x in (r.get("road"), r.get("road_no")) if x) or None,
                "google_m": g, "vworld_m": None if v is None else round(v, 1),
                "vworld_floors": floors, "osm_m": None if o is None else round(o, 1),
                "osm_from": okind, "area_m2": round(field.area_m2[i]),
                "chosen": src, "chosen_m": round(m, 1), "why": why})
    agree = sum(1 for (m, s, w) in resolved if w == "agree")
    gv_corr = spearman([g for g, v in both], [v for g, v in both])
    by_floor = {}
    for g, v in both:
        by_floor.setdefault(round(v / FLOOR_M), []).append(g)
    report = {
        "inputs": totals,
        "joined": {"vworld": len(vworld), "layers": len(layer),
                   "google_measured": sum(1 for c in all_cands if c[0] is not None),
                   "overture": len(overture),
                   "osm_with_height_or_floors": sum(1 for c in all_cands if c[3] is not None)},
        "won": dict(sorted(won.items())),
        "google_vs_vworld": {"both": len(both), "agree": agree,
                             "spearman": None if gv_corr is None else round(gv_corr, 2),
                             "google_median_by_vworld_floors": {
                                 str(k): round(statistics.median(vs), 1) for k, vs in sorted(by_floor.items())}},
        "disagreements": disagreements,
        "before": distribution(before),
        "after": distribution([m for m, s, w in resolved]),
        "after_by_source": {s: distribution([m for m, s2, w in resolved if s2 == s]) for s in sorted(won)},
        "biggest_moves": sorted(({"index": i, "name": field.b[i].get("nm"), "before_m": round(before[i], 1),
                                  "after_m": round(m, 1), "hsrc": s, "why": w}
                                 for i, (m, s, w) in enumerate(resolved)),
                                key=lambda d: -abs(d["after_m"] - d["before_m"]))[:25],
    }
    print(f"inputs: {totals}")
    print(f"joined to the field: {report['joined']}")
    print(f"won: {report['won']}")
    print(f"google vs vworld: {report['google_vs_vworld']}")
    if gv_corr is not None and len(both) >= 30 and gv_corr < 0.3:
        print(f"WARNING: the Google capture does not track the registry's floors "
              f"(Spearman {gv_corr:.2f} over {len(both)} buildings): it only wins where it "
              "lands within a floor of them. Re-capture before trusting it further.")
    print(f"before: {report['before']}")
    print(f"after:  {report['after']}")
    print(f"{len(disagreements)} disagreements (see --report)")
    if rep_path:
        json.dump(report, open(rep_path, "w"), indent=1, ensure_ascii=False)
        print(f"-> {rep_path}")
    if dry:
        print("(dry-run: nothing written)")
        return 0

    for b, (m, src, why) in zip(field.b, resolved):
        b["h"] = to_world(m)
        b["hsrc"] = src
    json.dump(bdata, open(out_path, "w"))
    print(f"-> {out_path}: {len(field.b)} buildings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
