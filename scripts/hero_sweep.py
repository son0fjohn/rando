"""Hero venue sweep: find NIGHT Street View imagery for Itaewon nightlife
spots, or flag the ones that only have daytime coverage.

Street View has no time-of-day filter, so this probes each venue's
surrounding panoramas and classifies fetched candidates by pixel
statistics (dark mean + bright point highlights = night). Probe images
are billed (~$0.007 each) but capped per venue.

    py -3 scripts/hero_sweep.py

Output: per-venue verdict + night refs kept in the ephemeral temp dir
for the reconstruction step. Nothing is archived.
"""
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_streetview import OUTDIR, META, IMG, offset, bearing, get_json  # noqa: E402
from landmark_pipeline import env  # noqa: E402

try:
    from PIL import Image
except ImportError:
    raise SystemExit("pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_CACHE = os.path.join(ROOT, "scripts", "venue_geocode_cache.json")
BBOX = (37.529, 126.986, 37.541, 127.001)
MAX_PROBES = 4          # billed image fetches per venue, hard cap
RING_M = 26

VENUES = [
    {"name": "Itaewon Station", "lat": 37.53462, "lng": 126.99455},  # known
    {"name": "Grand Ole Opry"},
    {"name": "Soap"},
    {"name": "Bolero"},
    {"name": "Waikiki"},
    {"name": "Danco"},
    {"name": "Grainhaus"},
    {"name": "Agave"},
    {"name": "Juntas"},
    {"name": "Jacks Bar"},
]

def overpass(q):
    mirrors = ["https://overpass-api.de/api/interpreter",
               "https://overpass.kumi.systems/api/interpreter",
               "https://lz4.overpass-api.de/api/interpreter"]
    for url in mirrors:
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": q}).encode(),
                headers={"User-Agent": "rando-world-builder/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
    raise last

def geocode(name):
    cache = {}
    if os.path.exists(GEO_CACHE):
        cache = json.load(open(GEO_CACHE))
    if name in cache:
        return cache[name]
    # escape regex specials, case-insensitive contains-match in the bbox
    safe = "".join(("\\" + c) if c in r".^$*+?()[]{}|\\" else c for c in name)
    q = (f'[out:json][timeout:30];'
         f'nwr["name"~"{safe}",i]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});'
         f'out center 6;')
    data = overpass(q)
    hit = None
    for el in data.get("elements", []):
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lng = el.get("lon") or el.get("center", {}).get("lon")
        if lat and lng:
            hit = {"lat": lat, "lng": lng,
                   "osm_name": el.get("tags", {}).get("name", "?"),
                   "kind": el.get("tags", {}).get("amenity")
                           or el.get("tags", {}).get("shop")
                           or el.get("tags", {}).get("leisure") or "?"}
            break
    cache[name] = hit
    json.dump(cache, open(GEO_CACHE, "w"), indent=1)
    return hit

def classify(path):
    """Night if dark overall but with bright point lights."""
    im = Image.open(path).convert("L").resize((80, 80))
    px = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") else list(im.getdata())
    mean = sum(px) / len(px)
    bright = sum(1 for v in px if v > 205) / len(px)
    is_night = mean < 78 and bright > 0.004
    return {"mean": round(mean, 1), "bright_frac": round(bright, 4), "night": is_night}

def sweep(v, gkey):
    lat, lng = v["lat"], v["lng"]
    panos = {}
    for ang in range(0, 360, 30):
        rad = math.radians(ang)
        plat, plng = offset(lat, lng, RING_M * math.cos(rad), RING_M * math.sin(rad))
        meta = get_json(META, {"location": f"{plat},{plng}",
                               "source": "default", "key": gkey})
        if meta.get("status") != "OK":
            continue
        pid = meta["pano_id"]
        if pid not in panos:
            loc = meta["location"]
            panos[pid] = {"loc": (loc["lat"], loc.get("lng", loc.get("lon"))),
                          "date": meta.get("date", "?")}
    sdir = os.path.join(OUTDIR, v["slug"])
    os.makedirs(sdir, exist_ok=True)
    probes = []
    night_ref = None
    for i, (pid, info) in enumerate(list(panos.items())[:MAX_PROBES]):
        clat, clng = info["loc"]
        hd = round(bearing(clat, clng, lat, lng), 1)
        q = urllib.parse.urlencode({"size": "640x420", "pano": pid, "heading": hd,
                                    "fov": 72, "pitch": 8, "key": gkey})
        path = os.path.join(sdir, f"probe{i}.jpg")
        urllib.request.urlretrieve(f"{IMG}?{q}", path)
        c = classify(path)
        probes.append({"pano": pid[:12], "date": info["date"], **c})
        if c["night"] and night_ref is None:
            night_ref = path
    return {"panos_found": len(panos), "probes": probes, "night_ref": night_ref}

def main():
    gkey = env("GOOGLE_MAPS_API_KEY")
    if not gkey:
        raise SystemExit("GOOGLE_MAPS_API_KEY missing")
    report = []
    for v in VENUES:
        v["slug"] = v["name"].lower().replace(" ", "-").replace("'", "")
        print(f"== {v['name']}")
        if "lat" not in v:
            g = geocode(v["name"])
            if not g:
                print("   GEOCODE MISS — not in OSM for this area")
                report.append({"venue": v["name"], "status": "no-geocode"})
                continue
            v["lat"], v["lng"] = g["lat"], g["lng"]
            print(f"   osm: {g['osm_name']} ({g['kind']}) @ {g['lat']:.5f},{g['lng']:.5f}")
        r = sweep(v, gkey)
        status = "NIGHT-REF-FOUND" if r["night_ref"] else \
                 ("day-only" if r["probes"] else "no-panos")
        print(f"   panos={r['panos_found']} -> {status}")
        for pr in r["probes"]:
            print(f"     {pr['pano']} {pr['date']} mean={pr['mean']} "
                  f"bright={pr['bright_frac']} night={pr['night']}")
        report.append({"venue": v["name"], "slug": v["slug"], "status": status,
                       "lat": v.get("lat"), "lng": v.get("lng"),
                       "night_ref": r["night_ref"], "probes": r["probes"]})
    out = os.path.join(OUTDIR, "hero_sweep_report.json")
    json.dump(report, open(out, "w"), indent=1)
    print(f"\nreport -> {out}")
    print("verdicts:", {x["venue"]: x["status"] for x in report})

if __name__ == "__main__":
    main()
