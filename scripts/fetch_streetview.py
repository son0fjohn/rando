"""Fetch multi-angle Street View reference images for hero buildings.

For each target in sv_spots.json this probes a ring of points around the
building, snaps each probe to the nearest real panorama via the FREE
metadata endpoint, dedupes panoramas, aims every camera at the target,
and downloads up to max_views images (billed ~$0.007 each).

TERMS: images are momentary references for generating our own stylized
3D art. They are written ONLY to a temp folder outside the repo, must be
fed into the reconstruction step promptly, and purged afterwards:

    py -3 scripts/fetch_streetview.py            # fetch all spots
    py -3 scripts/fetch_streetview.py --purge    # delete every fetched ref

Key: GOOGLE_MAPS_API_KEY=... in .env (never committed).
"""
import json
import math
import os
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPOTS = os.path.join(ROOT, "scripts", "sv_spots.json")
OUTDIR = os.path.join(tempfile.gettempdir(), "rando_sv_refs")

META = "https://maps.googleapis.com/maps/api/streetview/metadata"
IMG = "https://maps.googleapis.com/maps/api/streetview"

def key():
    for line in open(os.path.join(ROOT, ".env")).read().splitlines():
        if line.startswith("GOOGLE_MAPS_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("GOOGLE_MAPS_API_KEY not found in .env — see the "
                     "Google Cloud walkthrough in the session notes")

def offset(lat, lng, north_m, east_m):
    dlat = north_m / 110540.0
    dlng = east_m / (111320.0 * math.cos(math.radians(lat)))
    return lat + dlat, lng + dlng

def bearing(lat1, lng1, lat2, lng2):
    """Initial bearing from point 1 to point 2, degrees clockwise from N."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def get_json(url, params):
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}?{q}", timeout=30) as r:
        return json.loads(r.read())

def main():
    if "--purge" in sys.argv:
        shutil.rmtree(OUTDIR, ignore_errors=True)
        print(f"purged {OUTDIR}")
        return
    k = key()
    spots = json.load(open(SPOTS))["spots"]
    os.makedirs(OUTDIR, exist_ok=True)
    manifest = {}
    for s in spots:
        sdir = os.path.join(OUTDIR, s["id"])
        os.makedirs(sdir, exist_ok=True)
        # ring probes every 45 degrees; metadata is free, so probe broadly
        panos = {}
        for ang in range(0, 360, 45):
            rad = math.radians(ang)
            plat, plng = offset(s["lat"], s["lng"],
                                s["ring_m"] * math.cos(rad),
                                s["ring_m"] * math.sin(rad))
            meta = get_json(META, {"location": f"{plat},{plng}",
                                   "source": "outdoor", "key": k})
            if meta.get("status") != "OK":
                continue
            pid = meta["pano_id"]
            loc = meta["location"]
            if pid not in panos:
                panos[pid] = (loc["lat"], loc["lng"])
        views = []
        for i, (pid, (clat, clng)) in enumerate(list(panos.items())[: s["max_views"]]):
            hd = round(bearing(clat, clng, s["lat"], s["lng"]), 1)
            q = urllib.parse.urlencode({
                "size": "640x640", "pano": pid, "heading": hd,
                "fov": s["fov"], "pitch": s["pitch"], "key": k,
            })
            path = os.path.join(sdir, f"view{i}.jpg")
            urllib.request.urlretrieve(f"{IMG}?{q}", path)
            views.append({"file": path, "pano": pid, "heading": hd,
                          "cam": [clat, clng]})
            print(f"  {s['id']} view{i}: pano {pid[:12]}… heading {hd}")
        manifest[s["id"]] = {"target": [s["lat"], s["lng"]], "views": views}
        print(f"{s['id']}: {len(views)} views")
    with open(os.path.join(OUTDIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"\nrefs in {OUTDIR} — EPHEMERAL: feed into reconstruction now,")
    print("then run with --purge. Do not copy into the repo or any archive.")

if __name__ == "__main__":
    main()
