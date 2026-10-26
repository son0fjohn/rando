"""City tiles, bake step: turn the per-area GeoParquet from
scripts/fetch_overture.py into one PMTiles archive of map chunks that
web/citytiles.js streams around the player.

A chunk is one z16 web-mercator tile (~485 m across in Seoul). Its payload
is gzipped JSON, coordinates as integers in the tile's 4096 extent (the MVT
convention, so the same archive layout works for a worldwide build):

  { "v": 1,
    "b": [{ "p": [x,y, x,y, ...],      outer ring of the footprint, open
            "h": 21.5,                  height in metres (measured or default)
            "f": 6,                     floors
            "k": "c",                   type: h house, a apartment, c commercial,
                                        o office, v civic, i industrial, s shed
            "r": "f",                   roof: f flat, g gabled, h hipped, p pyramidal
            "m": 1,                     1 when the height was measured / registered
            "o": "w123",                OSM way id when known (hero matching)
            "fc": "#c8b8a0" }, ...],    facade colour when the data has one
    "r": [{ "c": "primary", "p": [...], "n": "Itaewon-ro" }],
    "a": [{ "k": "park", "p": [...] }] }   park | forest | plaza | water | ocean

Buildings go to the tile holding their centroid (never clipped, never
duplicated); roads and areas are clipped to the tile.

Height when the data has none (deterministic per building, floors × 3.2 m):
houses 2-4 floors, apartments 10-20, commercial 3-6, offices 8-20, civic
3-5, industrial 1-3, sheds 1. A building with no type gets one from its
size, shape and whether it fronts a main road. In Korea the official
registry wins where we have it (an area's "registry" in city_areas.json).

    python scripts/bake_city_tiles.py [--out web/tiles/cities.pmtiles] [--only itaewon]
"""
import argparse
import warnings
import gzip
import hashlib
import json
import math
import os

import mercantile
import pyarrow.parquet as pq
import shapely
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, box
from shapely.ops import transform

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "overture_cache")
Z = 16
warnings.filterwarnings("ignore", category=DeprecationWarning)
EXTENT = 4096
LEVEL_M = 3.2

HOUSE = {"house", "detached", "semidetached_house", "terrace", "bungalow", "hut", "cabin", "farm",
         "static_caravan", "villa"}
APART = {"apartments", "dormitory"}
COMM = {"commercial", "retail", "kiosk", "supermarket", "mall", "shop"}
OFFICE = {"office", "hotel", "government"}
CIVIC = {"school", "university", "college", "kindergarten", "hospital", "church", "temple", "shrine",
         "civic", "public", "train_station", "transportation", "religious", "cathedral", "mosque",
         "chapel", "fire_station", "library", "museum", "stadium", "sports_hall", "sports_centre"}
INDUS = {"industrial", "warehouse", "factory", "manufacture", "service"}
SHED = {"garage", "garages", "shed", "carport", "toilets", "storage_tank", "outbuilding"}
SKIP = {"roof", "shelter", "construction", "ruins", "bridge"}
FLOORS = {"h": (2, 4), "a": (10, 20), "c": (3, 6), "o": (8, 20), "v": (3, 5), "i": (1, 3), "s": (1, 1)}
MAIN = {"motorway", "trunk", "primary", "secondary", "tertiary"}
ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "living_street",
         "unclassified", "service", "pedestrian", "footway", "cycleway", "path", "steps", "track"}
GREEN = {("park", "park"), ("managed", "grass"), ("horticulture", "garden"), ("recreation", "pitch"),
         ("recreation", "playground"), ("recreation", "golf_course"), ("recreation", "recreation_ground"),
         ("agriculture", "meadow"), ("cemetery", "cemetery"), ("park", "dog_park"), ("park", "village_green")}
PLAZA = {("pedestrian", "plaza"), ("pedestrian", "pedestrian")}
FOREST = {("forest", "forest"), ("forest", "wood"), ("shrub", "scrub"), ("grass", "grass"), ("wetland", "wetland")}


def h32(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)


def local_proj(lat0, lng0):
    """lng/lat -> local metres (east, north) around an origin, and back."""
    mlat = 110540.0
    mlng = 111320.0 * math.cos(math.radians(lat0))
    fwd = lambda x, y, z=None: ((x - lng0) * mlng, (y - lat0) * mlat)
    inv = lambda x, y, z=None: (x / mlng + lng0, y / mlat + lat0)
    return fwd, inv


def in_korea(lat, lng):
    return 33 < lat < 39 and 124 < lng < 131


def obb(poly):
    """Oriented bounding box of a footprint: (long side, short side, fill)."""
    r = poly.minimum_rotated_rectangle
    if r.geom_type != "Polygon":
        return 1, 1, 1
    c = list(r.exterior.coords)
    a = math.dist(c[0], c[1])
    b = math.dist(c[1], c[2])
    return max(a, b), max(min(a, b), 0.1), poly.area / max(r.area, 1e-6)


def classify(cls, sub, area, elong, fronts_main, korea):
    c = (cls or "").lower()
    if c in SKIP:
        return None
    if c in HOUSE:
        return "h"
    if c in APART:
        return "a"
    if c == "residential":
        return "a" if area > 700 else "h"
    if c in COMM:
        return "c"
    if c in OFFICE:
        return "o"
    if c in CIVIC:
        return "v"
    if c in INDUS:
        return "i"
    if c in SHED:
        return "s"
    s = (sub or "").lower()
    if s == "residential":
        return "a" if area > 700 else "h"
    if s == "commercial":
        return "o" if area > 1500 else "c"
    if s in ("education", "religious", "civic", "medical", "transportation"):
        return "v"
    if s == "industrial":
        return "i"
    if s == "outbuilding":
        return "s"
    # nothing known: guess from size and shape
    if area < 25:
        return "s"
    if area < 150:
        return "c" if fronts_main else "h"
    if area < 700:
        return "c" if fronts_main or area >= 300 else "h"
    if korea and elong >= 2.2 and area < 3500 and not fronts_main:
        return "a"  # Korean slab apartments: long, narrow, set back from the road
    if fronts_main or area >= 2500:
        return "o"
    return "c"


def roof_for(kind, shape, area, fill, korea, seed):
    s = (shape or "").lower()
    if s in ("gabled", "saltbox", "gambrel", "mansard"):
        return "g"
    if s in ("hipped", "half-hipped"):
        return "h"
    if s in ("pyramidal",):
        return "p"
    if s:
        return "f"
    if kind not in ("h", "v", "s") or area > 420 or fill < 0.72:
        return "f"
    pitched = 0.45 if korea else 0.7
    if kind == "v":
        pitched = 0.3
    if (seed % 1000) / 1000 >= pitched:
        return "f"
    return "g" if (seed >> 10) % 3 else "h"


def to_tile(lng, lat, t):
    """lng/lat -> integer coords in tile t's 4096 extent."""
    x, y = mercantile.xy(lng, lat)  # web mercator metres
    b = mercantile.xy_bounds(t)
    fx = (x - b.left) / (b.right - b.left)
    fy = (b.top - y) / (b.top - b.bottom)
    return round(fx * EXTENT), round(fy * EXTENT)


def flat_coords(coords, t, closed=True):
    pts = list(coords)
    if closed and len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    out, last = [], None
    for lng, lat in pts:
        p = to_tile(lng, lat, t)
        if p != last:
            out.extend(p)
            last = p
    return out


def polys(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in polys(x)]
    return []


def lines(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, MultiLineString):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in lines(x)]
    return []


def osm_id(sources):
    for s in sources or []:
        if s.get("dataset") == "OpenStreetMap" and s.get("record_id"):
            return s["record_id"].split("@")[0]
    return None


def name_of(names):
    if not names:
        return None
    return names.get("primary")


def read(aid, theme):
    p = os.path.join(CACHE, f"{aid}.{theme}.parquet")
    if not os.path.exists(p):
        return []
    t = pq.read_table(p)
    rows = t.drop_columns(["geometry"]).to_pylist()
    geoms = shapely.from_wkb(t.column("geometry").to_pylist())
    for r, g in zip(rows, geoms):
        r["geometry"] = g
    return rows


def bake_area(a, tiles):
    lat0, lng0 = a["lat"], a["lng"]
    fwd, inv = local_proj(lat0, lng0)
    korea = in_korea(lat0, lng0)
    circle = transform(inv, shapely.Point(0, 0).buffer(a["r"], 64))
    area_tiles = list(mercantile.tiles(*circle.bounds, Z))
    for t in area_tiles:
        tiles.setdefault((t.z, t.x, t.y), {"b": [], "r": [], "a": [], "_seen": set()})

    # roads first: buildings ask which of them front a main road
    main_lines = []
    road_rows = []
    for r in read(a["id"], "segment"):
        if r["subtype"] != "road" or r["class"] not in ROADS:
            continue
        lv = r.get("level_rules") or []
        if any((x.get("value") or 0) < 0 and not x.get("between") for x in lv):
            continue  # tunnels and underpasses
        flags = r.get("road_flags") or []
        if any("is_tunnel" in (x.get("values") or []) and not x.get("between") for x in flags):
            continue
        g = r["geometry"]
        if g is None or g.is_empty:
            continue
        road_rows.append(r)
        if r["class"] in MAIN:
            main_lines.append(transform(fwd, g))
    main_tree = shapely.STRtree(main_lines) if main_lines else None

    # buildings: the registry (Korea) where we have it, Overture elsewhere
    reg_cover = None
    reg_rows = []
    if a.get("registry"):
        for r in json.load(open(os.path.join(ROOT, a["registry"]))):
            fp = r.get("footprint")
            if not fp or len(fp) < 4:
                continue
            try:
                g = Polygon(fp)
            except Exception:
                continue
            if not g.is_valid:
                g = g.buffer(0)
            reg_rows.append({"id": "reg" + str(r["id"]), "geometry": g, "num_floors": r.get("floors"),
                             "height": r.get("heightM"), "class": None, "subtype": None, "roof_shape": None,
                             "names": {"primary": r["name"]} if r.get("name") else None, "sources": None, "reg": True})
        if reg_rows:
            reg_cover = shapely.union_all([x["geometry"] for x in reg_rows]).convex_hull
    ov = read(a["id"], "building")
    ov_local = [transform(fwd, r["geometry"]) for r in ov]
    ov_tree = shapely.STRtree(ov_local) if ov_local else None
    rows = []
    for r in ov:
        if r.get("is_underground"):
            continue
        if reg_cover is not None and reg_cover.contains(r["geometry"].centroid):
            continue
        rows.append(r)
    for r in reg_rows:
        # the registry has floors for most buildings; borrow the rest from Overture
        if ov_tree is not None:
            lg = transform(fwd, r["geometry"])
            for i in ov_tree.query(lg.centroid):
                o = ov[i]
                if not ov_local[i].contains(lg.centroid):
                    continue
                r["class"] = r["class"] or o.get("class")
                r["subtype"] = r["subtype"] or o.get("subtype")
                r["roof_shape"] = r["roof_shape"] or o.get("roof_shape")
                if not r["num_floors"] and not r["height"]:
                    r["height"], r["num_floors"] = o.get("height"), o.get("num_floors")
                r["sources"] = o.get("sources")
                break
        rows.append(r)

    stats = {"buildings": 0, "measured": 0, "roads": 0, "areas": 0}
    for r in rows:
        g = r["geometry"]
        ps = polys(g)
        if not ps:
            continue
        p = max(ps, key=lambda q: q.area)
        lp = transform(fwd, p)
        if lp.area < 12:
            continue
        lp = lp.simplify(0.5, preserve_topology=True)
        if lp.is_empty or lp.geom_type != "Polygon":
            continue
        c = p.centroid
        if not circle.contains(c):
            continue
        t = mercantile.tile(c.x, c.y, Z)
        key = (t.z, t.x, t.y)
        if key not in tiles:
            continue
        rid = str(r.get("id"))
        if rid in tiles[key]["_seen"]:
            continue
        tiles[key]["_seen"].add(rid)
        seed = h32(rid)
        long_, short, fill = obb(lp)
        fronts = bool(main_tree is not None and len(main_tree.query(lp.buffer(22))) > 0)
        kind = classify(r.get("class"), r.get("subtype"), lp.area, long_ / short, fronts, korea)
        if kind is None:
            continue
        measured = 0
        hgt = r.get("height")
        fl = r.get("num_floors")
        if hgt and hgt > 2:
            fl = fl or max(1, round(hgt / LEVEL_M))
            measured = 1
        elif fl and fl > 0:
            hgt = fl * LEVEL_M + 1.0
            measured = 1
        else:
            lo, hi = FLOORS[kind]
            fl = lo + seed % (hi - lo + 1)
            hgt = fl * LEVEL_M + (1.0 if kind != "s" else 0.4)
        hgt = max(2.6, min(float(hgt), 600.0))
        roof = roof_for(kind, r.get("roof_shape"), lp.area, fill, korea, seed)
        ring = transform(inv, lp).exterior.coords
        b = {"p": flat_coords(ring, t), "h": round(hgt, 1), "f": int(fl), "k": kind, "r": roof}
        if len(b["p"]) < 6:
            continue
        if measured:
            b["m"] = 1
            stats["measured"] += 1
        oid = osm_id(r.get("sources"))
        if oid:
            b["o"] = oid
        if r.get("facade_color"):
            b["fc"] = r["facade_color"]
        tiles[key]["b"].append(b)
        stats["buildings"] += 1

    def clip_into(geom, make, kind_lines=False):
        for t in area_tiles:
            key = (t.z, t.x, t.y)
            bb = mercantile.bounds(t)
            tb = box(bb.west, bb.south, bb.east, bb.north)
            if not geom.intersects(tb):
                continue
            part = geom.intersection(tb)
            for piece in (lines(part) if kind_lines else polys(part)):
                coords = piece.coords if kind_lines else piece.exterior.coords
                fc = flat_coords(coords, t, closed=not kind_lines)
                if len(fc) >= (4 if kind_lines else 6):
                    tiles[key]["r" if kind_lines else "a"].append(make(fc))

    for r in road_rows:
        g = transform(inv, transform(fwd, r["geometry"]).simplify(0.8))
        g = g.intersection(circle.buffer(0.004))
        nm = name_of(r.get("names")) if r["class"] in MAIN else None
        def mk(fc, c=r["class"], nm=nm):
            o = {"c": c, "p": fc}
            if nm:
                o["n"] = nm
            return o
        clip_into(g, mk, kind_lines=True)
        stats["roads"] += 1

    area_rows = []
    for r in read(a["id"], "land_use"):
        k = (r["subtype"], r["class"])
        if k in GREEN:
            area_rows.append(("park", r["geometry"]))
        elif k in PLAZA:
            area_rows.append(("plaza", r["geometry"]))
    for r in read(a["id"], "land"):
        if (r["subtype"], r["class"]) in FOREST:
            area_rows.append(("forest", r["geometry"]))
    for r in read(a["id"], "water"):
        if r["subtype"] == "ocean" or r["class"] in ("ocean", "sea"):
            area_rows.append(("ocean", r["geometry"]))
        elif r["subtype"] not in ("spring", "physical") and r["class"] != "swimming_pool":
            area_rows.append(("water", r["geometry"]))
    for k, g in area_rows:
        if g is None or g.is_empty or not polys(g):
            continue
        g = transform(inv, transform(fwd, g).simplify(1.2))
        g = g.intersection(circle.buffer(0.004))
        clip_into(g, lambda fc, k=k: {"k": k, "p": fc})
        stats["areas"] += 1
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "tiles", "cities.pmtiles"))
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    areas = json.load(open(os.path.join(ROOT, "scripts", "city_areas.json")))["areas"]
    if args.only:
        keep = set(args.only.split(","))
        areas = [a for a in areas if a["id"] in keep]
    tiles = {}
    report = {}
    for a in areas:
        report[a["id"]] = bake_area(a, tiles)
        print(a["id"], report[a["id"]])
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    order = sorted(tiles, key=lambda k: zxy_to_tileid(*k))
    sizes = []
    with open(args.out, "wb") as f:
        w = Writer(f)
        for k in order:
            t = tiles[k]
            t.pop("_seen", None)
            if not (t["b"] or t["r"] or t["a"]):
                continue
            body = gzip.compress(json.dumps({"v": 1, **t}, separators=(",", ":"), ensure_ascii=False).encode(), 9)
            sizes.append(len(body))
            w.write_tile(zxy_to_tileid(*k), body)
        lons = [a["lng"] for a in areas]
        lats = [a["lat"] for a in areas]
        w.finalize({
            "tile_type": TileType.UNKNOWN, "tile_compression": Compression.GZIP,
            "min_zoom": Z, "max_zoom": Z,
            "min_lon_e7": int((min(lons) - 0.05) * 1e7), "min_lat_e7": int((min(lats) - 0.05) * 1e7),
            "max_lon_e7": int((max(lons) + 0.05) * 1e7), "max_lat_e7": int((max(lats) + 0.05) * 1e7),
            "center_zoom": Z, "center_lon_e7": int(areas[0]["lng"] * 1e7), "center_lat_e7": int(areas[0]["lat"] * 1e7),
        }, {"name": "rando-city", "format": "rando-chunk-v1", "extent": EXTENT,
            "attribution": "© OpenStreetMap contributors, Overture Maps Foundation (ODbL); building registry © VWorld",
            "areas": [{k: a[k] for k in ("id", "label", "lat", "lng", "r")} for a in areas]})
    sizes.sort()
    print(f"{len(sizes)} tiles, {sum(sizes) / 1024:.0f} KB total, median {sizes[len(sizes) // 2] / 1024:.1f} KB, "
          f"max {sizes[-1] / 1024:.1f} KB -> {os.path.relpath(args.out, ROOT)}")


if __name__ == "__main__":
    main()
