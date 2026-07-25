"""Digital twin, geometry layer: fetch the official Korean building
registry (건물통합정보, VWorld Data API dataset LT_C_SPBD) for the city
bbox — exact footprints, ground-floor counts, and registered heights for
every building. This is the authoritative replacement for OSM's patchy
Itaewon coverage. Open API with a free key — NOT scraping.

Key: VWORLD_API_KEY in .env (signup ~5 min, see NAVER_SETUP.md § VWorld).
No key => prints one line and exits 0 (established graceful pattern).

    py -3 scripts/fetch_bldg_registry.py

Output: web/data/registry_buildings.json
  [{ id, footprint: [[lng,lat]...], floors, ug_floors, heightM, use,
     road_addr }]
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data", "registry_buildings.json")

# city bbox (matches fetch_buildings.py coverage)
S, W, N, E = 37.529, 126.986, 37.541, 127.001
API = "https://api.vworld.kr/req/data"
DATASET = "LT_C_SPBD"   # 건물통합정보 (GIS integrated building info)
PAGE_SIZE = 1000

def env(name):
    try:
        for line in open(os.path.join(ROOT, ".env")).read().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return os.environ.get(name)

def fetch_page(key, page):
    q = urllib.parse.urlencode({
        "service": "data", "request": "GetFeature", "data": DATASET,
        "key": key, "format": "json", "size": PAGE_SIZE, "page": page,
        "geomFilter": f"BOX({W},{S},{E},{N})",
        "crs": "EPSG:4326",
    })
    req = urllib.request.Request(f"{API}?{q}",
                                 headers={"User-Agent": "rando-twin/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def parse_float(v):
    try:
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None

def main():
    key = env("VWORLD_API_KEY")
    if not key or "your_vworld" in key:
        print("vworld: key missing — registry fetch skipped "
              "(see NAVER_SETUP.md § VWorld)")
        return 0

    buildings, page = [], 1
    while True:
        d = fetch_page(key, page)
        resp = d.get("response", {})
        status = resp.get("status")
        if status == "ERROR":
            err = resp.get("error", {})
            print(f"vworld ERROR: {err.get('code')} {err.get('text')}")
            return 1
        feats = (resp.get("result", {}).get("featureCollection", {})
                 .get("features", []))
        for f in feats:
            props = f.get("properties", {})
            geom = f.get("geometry", {})
            coords = geom.get("coordinates")
            if not coords:
                continue
            # MultiPolygon -> first polygon's outer ring; Polygon -> outer
            ring = coords[0][0] if geom.get("type") == "MultiPolygon" \
                else coords[0]
            if len(ring) < 4:
                continue
            buildings.append({
                "id": props.get("bd_mgt_sn") or props.get("gis_idntfc_no")
                      or f.get("id"),
                "footprint": [[round(x, 7), round(y, 7)] for x, y in ring],
                "floors": parse_float(props.get("grnd_flr") or props.get("gro_flo_co")),
                "ug_floors": parse_float(props.get("ugrnd_flr") or props.get("und_flo_co")),
                "heightM": parse_float(props.get("buld_hg") or props.get("height")),
                "use": props.get("buld_prpos_nm") or props.get("main_prpos_nm"),
                "road_addr": props.get("rn_adres") or props.get("road_addr"),
            })
        total = resp.get("record", {}).get("total")
        got = len(feats)
        print(f"  page {page}: +{got} (total so far {len(buildings)}"
              f"{' / ' + str(total) if total else ''})")
        if got < PAGE_SIZE:
            break
        page += 1
        time.sleep(0.3)  # be polite to the public API

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(buildings, open(OUT, "w"), ensure_ascii=False)
    n_fl = sum(1 for b in buildings if b["floors"])
    n_h = sum(1 for b in buildings if b["heightM"])
    print(f"-> {OUT}")
    print(f"registry buildings: {len(buildings)} "
          f"(floors: {n_fl}, heightM: {n_h})")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
