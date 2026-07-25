"""Task 1b — offline building-height reference for the Itaewon zone.

Primary source: Google Photorealistic 3D Tiles (Map Tiles API), OFFLINE
one-time capture; never shipped to or streamed by the client. As of the
last run the key's project has Map Tiles API DISABLED (HTTP 403), so the
script uses the spec's authorized fallback chain and flags every
building for later hand-correction / re-capture:

    OSM height tag -> building:levels * 3.2 -> per-block default 11.0 m

Outputs (public data dir):
  web/data/itaewon_heights.json          { "<buildingId>": heightM }
  web/data/itaewon_heights_sources.json  { "<buildingId>": "osm-height" |
                                            "osm-levels" | "default" |
                                            "tiles" }

When Map Tiles API is enabled, re-run with --tiles to attempt the real
capture (root tileset fetch is implemented; the tile traversal + roof
raycast is the heavy part and remains TODO — the fallback keeps the
downstream contract intact either way).

    py -3 scripts/capture_heights_reference.py [--tiles]
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = os.path.join(ROOT, "web", "data", "itaewon_layers.json")
OUT_H = os.path.join(ROOT, "web", "data", "itaewon_heights.json")
OUT_S = os.path.join(ROOT, "web", "data", "itaewon_heights_sources.json")

LEVEL_M = 3.2
DEFAULT_M = 11.0  # Itaewon core is dominated by 2-4 storey mixed blocks

def env(name):
    for line in open(os.path.join(ROOT, ".env")).read().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return None

def tiles_available(key):
    req = urllib.request.Request(
        f"https://tile.googleapis.com/v1/3dtiles/root.json?key={key}",
        headers={"User-Agent": "rando-heights-capture/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            json.loads(r.read())
        return True
    except Exception:
        return False

def main():
    layers = json.load(open(LAYERS))
    use_tiles = "--tiles" in sys.argv
    if use_tiles:
        key = env("GOOGLE_MAPS_API_KEY")
        if not tiles_available(key):
            print("Map Tiles API not enabled on this key — falling back")
            use_tiles = False
        else:
            # Root tileset reachable. Full traversal + per-centroid roof
            # raycast is intentionally not implemented yet (draco-compressed
            # glTF tile decode); run stays on the fallback until then.
            print("Map Tiles API reachable — raycast capture TODO; "
                  "using fallback for now")
            use_tiles = False

    heights, sources = {}, {}
    for b in layers["buildings"]:
        bid = str(b["id"])
        if b.get("heightM") is not None:
            heights[bid] = round(b["heightM"], 1)
            sources[bid] = "osm-height"
        elif b.get("levels"):
            heights[bid] = round(b["levels"] * LEVEL_M, 1)
            sources[bid] = "osm-levels"
        else:
            heights[bid] = DEFAULT_M
            sources[bid] = "default"

    json.dump(heights, open(OUT_H, "w"), indent=0)
    json.dump(sources, open(OUT_S, "w"), indent=0)
    counts = {}
    for s in sources.values():
        counts[s] = counts.get(s, 0) + 1
    print(f"-> {OUT_H}")
    print(f"heights: {len(heights)} buildings; sources: {counts}")

if __name__ == "__main__":
    main()
