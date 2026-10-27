"""Test tiles for the city's worldwide fallback (web/cityomt.js), offline.

The live fallback reads OpenFreeMap's OpenMapTiles vector tiles, which a
sandbox may not reach. This writes tiles in the same schema (z14 MVT:
building with render_height, transportation with class/subclass/brunnel,
transportation_name, water, park, landcover) from an area's Overture data
(scripts/fetch_overture.py's cache), plus a TileJSON pointing at them, so
the browser tests can run the whole fallback path: test/appserve.mjs serves
them, and ?omt=/test/.omt/tiles.json points the map there.

Like OpenMapTiles, a building with no height gets render_height 5.

    python scripts/omt_fixture.py calgary [--out test/.omt]
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
    args = ap.parse_args()
    feats = {"building": [], "transportation": [], "transportation_name": [], "water": [], "park": [], "landcover": []}
    for r in rows(args.area, "building"):
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

    allg = [g for fs in feats.values() for g, _ in fs]
    x0, y0, x1, y1 = shapely.union_all([shapely.envelope(g) for g in allg[:4000]]).bounds
    tdir = os.path.join(args.out, str(Z))
    n = 0
    for t in mercantile.tiles(x0, y0, x1, y1, Z):
        b = mercantile.bounds(t)
        tb = box(b.west, b.south, b.east, b.north)
        layers = []
        for name, fs in feats.items():
            out = []
            for g, props in fs:
                if not g.intersects(tb):
                    continue
                out.append({"geometry": g.intersection(tb.buffer(0.0003)).wkt, "properties": props})
            if out:
                layers.append({"name": name, "features": out})
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


if __name__ == "__main__":
    main()
