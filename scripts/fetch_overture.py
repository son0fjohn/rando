"""City tiles, data step: pull buildings, roads, water and land use for the
areas in scripts/city_areas.json straight out of Overture Maps' GeoParquet
release on S3 (anonymous, no key). Overture is OSM plus Microsoft/Google
footprints, with heights and floor counts where anyone measured them, under
ODbL — the same licence OSM is.

One bbox-filtered scan per theme covers every area at once (each scan reads
the parquet footers of the whole release, ~1 min). Output is one GeoParquet
per area and theme in scripts/overture_cache/ (git-ignored), which
scripts/bake_city_tiles.py turns into tiles.

    pip install pyarrow
    python scripts/fetch_overture.py [--release 2026-10-21.0] [--only itaewon,busan]

Behind an HTTPS proxy (HTTPS_PROXY set) the S3 client is pointed at it.
"""
import argparse
import json
import math
import os
import time
from urllib.parse import urlparse

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pfs
import pyarrow.parquet as pq

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "overture_cache")
BUCKET = "overturemaps-us-west-2/release/{rel}/"

THEMES = {
    "building": ("theme=buildings/type=building",
                 ["id", "names", "height", "num_floors", "min_height", "class", "subtype", "roof_shape",
                  "facade_color", "roof_color", "is_underground", "sources", "geometry"]),
    "segment": ("theme=transportation/type=segment",
                ["id", "subtype", "class", "subclass", "road_flags", "level_rules", "geometry"]),
    "water": ("theme=base/type=water", ["id", "subtype", "class", "is_salt", "geometry"]),
    "land_use": ("theme=base/type=land_use", ["id", "subtype", "class", "geometry"]),
    "land": ("theme=base/type=land", ["id", "subtype", "class", "geometry"]),
}


def bbox_of(a, pad=1.15):
    r = a["r"] * pad
    dlat = r / 110540.0
    dlng = r / (111320.0 * math.cos(math.radians(a["lat"])))
    return a["lng"] - dlng, a["lat"] - dlat, a["lng"] + dlng, a["lat"] + dlat


def filesystem():
    kw = dict(anonymous=True, region="us-west-2")
    px = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if px:
        p = urlparse(px)
        kw["proxy_options"] = {"scheme": p.scheme, "host": p.hostname, "port": p.port}
    return pfs.S3FileSystem(**kw)


def bbox_filter(b):
    x0, y0, x1, y1 = b
    return ((pc.field("bbox", "xmin") < x1) & (pc.field("bbox", "xmax") > x0) &
            (pc.field("bbox", "ymin") < y1) & (pc.field("bbox", "ymax") > y0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default="2026-10-21.0")
    ap.add_argument("--only", default="")
    ap.add_argument("--themes", default=",".join(THEMES))
    args = ap.parse_args()
    areas = json.load(open(os.path.join(ROOT, "scripts", "city_areas.json")))["areas"]
    if args.only:
        keep = set(args.only.split(","))
        areas = [a for a in areas if a["id"] in keep]
    os.makedirs(CACHE, exist_ok=True)
    fs = filesystem()
    base = BUCKET.format(rel=args.release)
    for theme in args.themes.split(","):
        path, cols = THEMES[theme]
        t0 = time.time()
        d = ds.dataset(base + path, filesystem=fs, format="parquet")
        cols = [c for c in cols if c in d.schema.names] + ["bbox"]
        boxes = {a["id"]: bbox_of(a) for a in areas}
        f = None
        for b in boxes.values():
            f = bbox_filter(b) if f is None else f | bbox_filter(b)
        tb = d.to_table(filter=f, columns=cols)
        print(f"{theme}: {tb.num_rows} rows in {time.time() - t0:.0f}s")
        for aid, b in boxes.items():
            sub = tb.filter(bbox_filter(b))
            out = os.path.join(CACHE, f"{aid}.{theme}.parquet")
            pq.write_table(sub, out, compression="zstd")
            print(f"  {aid}: {sub.num_rows}")


if __name__ == "__main__":
    main()
