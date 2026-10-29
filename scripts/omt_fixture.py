"""Test tiles for the city's worldwide fallback (web/cityomt.js), offline.

The live fallback reads OpenFreeMap's OpenMapTiles vector tiles, which a
sandbox may not reach. This writes tiles in the same schema (z14 MVT:
building with render_height, transportation with class/subclass/brunnel,
transportation_name, water, park, landcover) from an area's Overture data
(scripts/fetch_overture.py's cache), plus a TileJSON pointing at them, so
the browser tests can run the whole fallback path: test/appserve.mjs serves
them, and ?omt=/test/.omt/tiles.json points the map there.

Like OpenMapTiles, a building with no height gets render_height 5.
--osm-only keeps the buildings whose footprint came from OpenStreetMap (what
OpenFreeMap carries: in Korea that leaves out the East-Asia ML footprints
Overture adds); --around lat,lng[;lat,lng...] writes only the z14 tiles
round those spots (3 x 3 each); --cache reads another directory of
fetch_overture.py-style parquet; --ovt FILE also writes a PMTiles of z14
tiles in the schema of Overture's own building tiles ("building" layer:
height, num_floors, class, subtype, roof_shape, min_height, is_underground,
every footprint), for trying the worker's ?ovt= path offline.

    python scripts/omt_fixture.py calgary [--out test/.omt] [--osm-only] [--around 37.556,126.901] [--cache DIR]
"""
import argparse
import json
import os

import mapbox_vector_tile
import mercantile
import pyarrow.parquet as pq
import shapely
from shapely.geometry import box, mapping

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "overture_cache")
Z = 14
CLASS = {"motorway": "motorway", "trunk": "trunk", "primary": "primary", "secondary": "secondary", "tertiary": "tertiary",
         "residential": "minor", "living_street": "minor", "unclassified": "minor", "service": "service", "track": "track",
         "pedestrian": "path", "footway": "path", "cycleway": "path", "steps": "path", "path": "path"}
GREEN = {"park", "grass", "garden", "pitch", "playground", "golf_course", "recreation_ground", "meadow", "cemetery", "dog_park"}


def rows(aid, theme):
    p = os.path.join(CACHE, f"{aid}.{theme}.parquet")
    if not os.path.exists(p) and "*" in aid:
        return [r for a in sorted(f.split(".")[0] for f in os.listdir(CACHE) if f.endswith(f".{theme}.parquet")) for r in rows(a, theme)]
    if not os.path.exists(p):
        return []
    t = pq.read_table(p).to_pylist()
    for r in t:
        r["geometry"] = shapely.from_wkb(r["geometry"]) if isinstance(r.get("geometry"), (bytes, bytearray)) else r.get("geometry")
    return [r for r in t if r["geometry"] is not None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("area")
    ap.add_argument("--out", default=os.path.join(ROOT, "test", ".omt"))
    ap.add_argument("--osm-only", action="store_true")
    ap.add_argument("--around", default="")
    ap.add_argument("--cache", default="")
    ap.add_argument("--ovt", default="")
    args = ap.parse_args()
    global CACHE
    if args.cache:
        CACHE = args.cache
    feats = {"building": [], "transportation": [], "transportation_name": [], "water": [], "park": [], "landcover": []}
    ovt = []
    for r in rows(args.area, "building"):
        if args.ovt:
            ovt.append((r["geometry"], {k: r[k] for k in ("height", "num_floors", "class", "subtype", "roof_shape", "min_height", "is_underground", "facade_color") if r.get(k) not in (None, "")}))
        if args.osm_only and not any(x.get("dataset") == "OpenStreetMap" and x.get("property") in ("", None, "properties/geometry") for x in r.get("sources") or []):
            continue
        h = r.get("height") or ((r.get("num_floors") or 0) * 3.66) or 5
        feats["building"].append((r["geometry"], {"render_height": round(max(5, h), 1)}))
    for r in rows(args.area, "segment"):
        c = CLASS.get(r.get("class"))
        if r.get("subtype") != "road" or not c:
            continue
        props = {"class": c}
        if c == "minor":
            props["subclass"] = r["class"]
        if c == "path":
            props["subclass"] = r["class"]
        flags = r.get("road_flags") or []
        if any("is_tunnel" in (x.get("values") or []) for x in flags):
            props["brunnel"] = "tunnel"
        feats["transportation"].append((r["geometry"], props))
        nm = ((r.get("names") or {}).get("primary") if isinstance(r.get("names"), dict) else None)
        if nm and c in ("motorway", "trunk", "primary", "secondary", "tertiary"):
            feats["transportation_name"].append((r["geometry"], {"class": c, "name": nm}))
    for r in rows(args.area, "water"):
        feats["water"].append((r["geometry"], {"class": "ocean" if r.get("subtype") == "ocean" else "lake"}))
    for r in rows(args.area, "land_use"):
        if r.get("class") in GREEN:
            feats["park" if r.get("class") == "park" else "landcover"].append((r["geometry"], {"class": "park" if r.get("class") == "park" else "grass"}))
    for r in rows(args.area, "land"):
        if r.get("class") in ("forest", "wood"):
            feats["landcover"].append((r["geometry"], {"class": "wood"}))

    if args.around:
        tiles = set()
        for spot in args.around.split(";"):
            lat, lng = map(float, spot.split(","))
            c = mercantile.tile(lng, lat, Z)
            tiles |= {mercantile.Tile(c.x + i, c.y + j, Z) for i in (-1, 0, 1) for j in (-1, 0, 1)}
    else:
        allg = [g for fs in feats.values() for g, _ in fs]
        x0, y0, x1, y1 = shapely.union_all([shapely.envelope(g) for g in allg[:4000]]).bounds
        tiles = mercantile.tiles(x0, y0, x1, y1, Z)
    trees = {name: shapely.STRtree([g for g, _ in fs]) for name, fs in feats.items() if fs}
    ovt_tree = shapely.STRtree([g for g, _ in ovt]) if ovt else None
    ovt_tiles = {}
    tdir = os.path.join(args.out, str(Z))
    n = 0
    for t in tiles:
        b = mercantile.bounds(t)
        tb = box(b.west, b.south, b.east, b.north)
        layers = []
        for name, fs in feats.items():
            out = []
            for i in (trees[name].query(tb) if name in trees else []):
                g, props = fs[i]
                if not g.intersects(tb):
                    continue
                out.append({"geometry": g.intersection(tb.buffer(0.0003)).wkt, "properties": props})
            if out:
                layers.append({"name": name, "features": out})
        if ovt_tree is not None:
            out = [{"geometry": ovt[i][0].intersection(tb.buffer(0.0003)).wkt, "properties": ovt[i][1]} for i in ovt_tree.query(tb) if ovt[i][0].intersects(tb)]
            if out:
                ovt_tiles[(t.z, t.x, t.y)] = mapbox_vector_tile.encode([{"name": "building", "features": out}], default_options={"quantize_bounds": (b.west, b.south, b.east, b.north), "extents": 4096})
        if not layers:
            continue
        data = mapbox_vector_tile.encode(layers, default_options={"quantize_bounds": (b.west, b.south, b.east, b.north), "extents": 4096})
        os.makedirs(os.path.join(tdir, str(t.x)), exist_ok=True)
        with open(os.path.join(tdir, str(t.x), f"{t.y}.pbf"), "wb") as f:
            f.write(data)
        n += 1
    with open(os.path.join(args.out, "tiles.json"), "w") as f:
        json.dump({"tilejson": "3.0.0", "tiles": ["{z}/{x}/{y}.pbf"], "minzoom": 0, "maxzoom": Z,
                   "attribution": "fixture from Overture Maps (OpenStreetMap contributors), OpenMapTiles schema"}, f)
    print(f"{n} z{Z} tiles -> {os.path.relpath(args.out, ROOT)}")
    if args.ovt:
        import gzip
        from pmtiles.tile import Compression, TileType, zxy_to_tileid
        from pmtiles.writer import Writer
        with open(args.ovt, "wb") as f:
            w = Writer(f)
            for k in sorted(ovt_tiles, key=lambda k: zxy_to_tileid(*k)):
                w.write_tile(zxy_to_tileid(*k), gzip.compress(ovt_tiles[k]))
            ks = list(ovt_tiles)
            bs = [mercantile.bounds(mercantile.Tile(x, y, z)) for z, x, y in ks]
            w.finalize({"tile_type": TileType.MVT, "tile_compression": Compression.GZIP, "min_zoom": Z, "max_zoom": Z,
                        "min_lon_e7": int(min(b.west for b in bs) * 1e7), "min_lat_e7": int(min(b.south for b in bs) * 1e7),
                        "max_lon_e7": int(max(b.east for b in bs) * 1e7), "max_lat_e7": int(max(b.north for b in bs) * 1e7),
                        "center_zoom": Z, "center_lon_e7": 0, "center_lat_e7": 0},
                       {"name": "overture-buildings-fixture", "attribution": "Overture Maps Foundation (ODbL)"})
        print(f"{len(ovt_tiles)} z{Z} Overture-schema building tiles -> {args.ovt}")


if __name__ == "__main__":
    main()
