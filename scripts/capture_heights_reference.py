"""Task 1b — offline building-height reference for the Itaewon zone.

Primary source: Google Photorealistic 3D Tiles (Map Tiles API), OFFLINE
one-time capture — never streamed by the client. Traverses the tileset
down to street LOD inside the zone bbox, decodes the draco-compressed
glTF tiles into an ECEF point cloud, converts to a local ENU frame, and
derives each building's height as roof(6 m around centroid) minus
ground(5th percentile within 25 m). Differencing cancels any absolute
frame offset. Buildings the cloud can't answer fall back to:

    OSM height tag -> building:levels * 3.2 -> 11.0 m default

Outputs:
  web/data/itaewon_heights.json          { "<buildingId>": heightM }
  web/data/itaewon_heights_sources.json  { "<buildingId>": "tiles" |
                     "osm-height" | "osm-levels" | "default" }

    py -3 scripts/capture_heights_reference.py            # fallback only
    py -3 scripts/capture_heights_reference.py --tiles    # real capture
"""
import io
import json
import math
import os
import struct
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = os.path.join(ROOT, "web", "data", "itaewon_layers.json")
OUT_H = os.path.join(ROOT, "web", "data", "itaewon_heights.json")
OUT_S = os.path.join(ROOT, "web", "data", "itaewon_heights_sources.json")

LEVEL_M = 3.2
DEFAULT_M = 11.0
S, W, N, E = 37.5320, 126.9910, 37.5365, 126.9975
TILE_HOST = "https://tile.googleapis.com"
MAX_TILES = 500          # hard budget on fetched glbs
STOP_GEOM_ERR = 6.0      # descend while geometricError is above this

# ---------------- geodesy ----------------
WGS_A, WGS_F = 6378137.0, 1 / 298.257223563
WGS_E2 = WGS_F * (2 - WGS_F)

def ecef(lat, lng, h=0.0):
    la, lo = math.radians(lat), math.radians(lng)
    n = WGS_A / math.sqrt(1 - WGS_E2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo),
            (n + h) * math.cos(la) * math.sin(lo),
            (n * (1 - WGS_E2) + h) * math.sin(la))

def enu_frame(lat, lng):
    """Rows of the ECEF->ENU rotation at the given origin."""
    la, lo = math.radians(lat), math.radians(lng)
    sl, cl = math.sin(la), math.cos(la)
    so, co = math.sin(lo), math.cos(lo)
    east = (-so, co, 0.0)
    north = (-sl * co, -sl * so, cl)
    up = (cl * co, cl * so, sl)
    return east, north, up

# ---------------- http ----------------
def http(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "rando-heights/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        raise RuntimeError(
            f"HTTP {e.code} for ...{url.split('/files/')[-1][:60]} :: {body}")

SESSION = [None]  # root-issued session; deep tile URIs omit it

def with_key(uri, key):
    """Resolve a tileset-relative URI; carry key AND the root session —
    Google stamps ?session= only on root's immediate children and expects
    the client to propagate it to every deeper request."""
    url = urllib.parse.urljoin(TILE_HOST, uri)
    if "session=" in url and SESSION[0] is None:
        SESSION[0] = urllib.parse.parse_qs(
            urllib.parse.urlparse(url).query)["session"][0]
    sep = "&" if "?" in url else "?"
    url = f"{url}{sep}key={key}"
    if "session=" not in url and SESSION[0]:
        url += f"&session={SESSION[0]}"
    return url

# ---------------- tileset traversal ----------------
def region_hits(bv):
    """Does this boundingVolume intersect the zone? Coarse accept."""
    if "region" in bv:
        w, s, e, n = (math.degrees(v) for v in bv["region"][:4])
        return not (e < W or w > E or n < S or s > N)
    if "box" in bv:
        cx, cy, cz = bv["box"][:3]
        ax = bv["box"][3:6]; ay = bv["box"][6:9]; az = bv["box"][9:12]
        r = math.sqrt(sum(v * v for v in ax)) + \
            math.sqrt(sum(v * v for v in ay)) + \
            math.sqrt(sum(v * v for v in az))
        zx, zy, zz = ecef((S + N) / 2, (W + E) / 2)
        zr = 600.0  # zone half-diagonal with slack
        d = math.dist((cx, cy, cz), (zx, zy, zz))
        return d <= r + zr
    return True

def collect_glbs(key):
    """Walk root.json down to street LOD inside the zone; return glb urls."""
    glbs, seen, budget = [], set(), [0]

    def walk(tile, base_uri):
        if budget[0] >= MAX_TILES:
            return
        bv = tile.get("boundingVolume", {})
        if bv and not region_hits(bv):
            return
        ge = tile.get("geometricError", 0)
        children = tile.get("children") or []
        content = tile.get("content") or {}
        uri = content.get("uri") or content.get("url")
        if uri and uri.split("?")[0].endswith(".json"):
            # external subtree: recurse into it
            full = with_key(urllib.parse.urljoin(base_uri, uri), key)
            if full not in seen:
                seen.add(full)
                try:
                    sub = json.loads(http(full))
                    walk(sub["root"], urllib.parse.urljoin(base_uri, uri))
                except Exception as ex:
                    print(f"  subtree fetch failed: {ex}")
            return
        if children and ge > STOP_GEOM_ERR:
            for ch in children:
                walk(ch, base_uri)
            return
        if uri:
            full = with_key(urllib.parse.urljoin(base_uri, uri), key)
            if full not in seen:
                seen.add(full)
                glbs.append(full)
                budget[0] += 1

    root = json.loads(http(f"{TILE_HOST}/v1/3dtiles/root.json?key={key}"))
    walk(root["root"], "/v1/3dtiles/root.json")
    return glbs

# ---------------- glb -> ECEF points ----------------
def mat_mul(a, b):
    return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4))
            for r in range(4) for c in range(4)]

def mat_apply(m, x, y, z):
    return (m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11])

IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
# glTF +Y-up -> 3D Tiles +Z-up (ECEF)
YUP2ZUP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]

def node_matrix(node):
    if "matrix" in node:
        m = node["matrix"]  # column-major in glTF
        return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13],
                m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]]
    m = IDENT[:]
    t = node.get("translation")
    s = node.get("scale")
    q = node.get("rotation")
    if q:
        x, y, z, w = q
        m = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
             2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
             2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
             0, 0, 0, 1]
    if s:
        for c in range(3):
            for r in range(3):
                m[r * 4 + c] *= s[c]
    if t:
        m[3], m[7], m[11] = t
    return m

def glb_points(data, np):
    """Decode a GLB into an Nx3 float64 array of ECEF points (subsampled)."""
    import DracoPy
    if data[:4] != b"glTF":
        return None
    jlen, jtype = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    binbuf = b""
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        if ctype == 0x004E4942:  # BIN
            binbuf = data[off + 8:off + 8 + clen]
            break
        off += 8 + clen
    rtc = (gltf.get("extensions", {}).get("CESIUM_RTC", {}).get("center")
           or [0, 0, 0])
    bviews = gltf.get("bufferViews", [])
    accs = gltf.get("accessors", [])

    # world matrix per node (flatten hierarchy)
    nodes = gltf.get("nodes", [])
    world = [None] * len(nodes)
    def resolve(idx, parent):
        m = mat_mul(parent, node_matrix(nodes[idx]))
        world[idx] = m
        for ch in nodes[idx].get("children", []):
            resolve(ch, m)
    scene = gltf.get("scenes", [{}])[gltf.get("scene", 0)]
    for r in scene.get("nodes", []):
        resolve(r, IDENT)

    pts = []
    for ni, node in enumerate(nodes):
        if "mesh" not in node or world[ni] is None:
            continue
        m = mat_mul(YUP2ZUP, world[ni])
        mesh = gltf["meshes"][node["mesh"]]
        for prim in mesh.get("primitives", []):
            dra = prim.get("extensions", {}).get("KHR_draco_mesh_compression")
            arr = None
            if dra is not None:
                bv = bviews[dra["bufferView"]]
                s0 = bv.get("byteOffset", 0)
                blob = binbuf[s0:s0 + bv["byteLength"]]
                try:
                    dec = DracoPy.decode(blob)
                    arr = np.asarray(dec.points, dtype=np.float64)
                except Exception:
                    continue
            else:
                ai = prim.get("attributes", {}).get("POSITION")
                if ai is None:
                    continue
                acc = accs[ai]
                bv = bviews[acc["bufferView"]]
                s0 = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
                cnt = acc["count"]
                arr = np.frombuffer(binbuf, dtype=np.float32,
                                    count=cnt * 3, offset=s0)
                arr = arr.reshape(-1, 3).astype(np.float64)
            if arr is None or not len(arr):
                continue
            if len(arr) > 20000:  # massing needs no full density
                arr = arr[:: max(1, len(arr) // 20000)]
            # apply matrix
            rot = np.array([[m[0], m[1], m[2]], [m[4], m[5], m[6]],
                            [m[8], m[9], m[10]]])
            trn = np.array([m[3], m[7], m[11]])
            pts.append(arr @ rot.T + trn + np.array(rtc))
    if not pts:
        return None
    return np.vstack(pts)

# ---------------- capture ----------------
def env(name):
    for line in open(os.path.join(ROOT, ".env")).read().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return None

def capture_tiles(layers):
    import numpy as np
    key = env("GOOGLE_MAPS_API_KEY")
    print("collecting tile list ...")
    glbs = collect_glbs(key)
    print(f"  {len(glbs)} tiles at street LOD in zone")
    if not glbs:
        return None

    olat, olng = (S + N) / 2, (W + E) / 2
    east, north, up = enu_frame(olat, olng)
    o = np.array(ecef(olat, olng))
    R = np.array([east, north, up])

    clouds = []
    fetched = bytes_total = 0
    for i, url in enumerate(glbs):
        try:
            blob = http(url)
        except Exception as ex:
            print(f"  tile {i} fetch failed: {ex}")
            continue
        bytes_total += len(blob)
        p = glb_points(blob, np)
        if p is None:
            continue
        loc = (p - o) @ R.T  # ENU: x east, y north, z up
        # keep only points inside the zone (+ margin)
        m = (np.abs(loc[:, 0]) < 700) & (np.abs(loc[:, 1]) < 700)
        if m.any():
            clouds.append(loc[m])
        fetched += 1
        if i % 40 == 39:
            print(f"  ... {i + 1}/{len(glbs)} tiles, {bytes_total // 2**20}MB")
    if not clouds:
        return None
    cloud = np.vstack(clouds)
    print(f"  cloud: {len(cloud):,} pts from {fetched} tiles "
          f"({bytes_total // 2**20}MB)")
    zs = cloud[:, 2]
    print(f"  sanity: z p5={np.percentile(zs, 5):.1f} "
          f"p50={np.percentile(zs, 50):.1f} p95={np.percentile(zs, 95):.1f} "
          f"(expect a few tens of meters spread)")

    m_lat = 110540.0
    m_lng = 111320.0 * math.cos(math.radians(olat))
    heights = {}
    for b in layers["buildings"]:
        c = b["centroid"]
        bx = (c["lng"] - olng) * m_lng
        by = (c["lat"] - olat) * m_lat
        d2 = (cloud[:, 0] - bx) ** 2 + (cloud[:, 1] - by) ** 2
        roof_sel = zs[d2 < 6 ** 2]
        gnd_sel = zs[d2 < 25 ** 2]
        if len(roof_sel) < 12 or len(gnd_sel) < 60:
            continue
        roof = np.percentile(roof_sel, 97)   # robust roof
        gnd = np.percentile(gnd_sel, 5)      # local ground
        h = float(roof - gnd)
        if 2.0 < h < 150.0:
            heights[str(b["id"])] = round(h, 1)
    return heights

def main():
    layers = json.load(open(LAYERS))
    tiles_heights = None
    if "--tiles" in sys.argv:
        try:
            tiles_heights = capture_tiles(layers)
        except Exception as ex:
            print(f"tiles capture failed ({ex}) — falling back")
    heights, sources = {}, {}
    for b in layers["buildings"]:
        bid = str(b["id"])
        if tiles_heights and bid in tiles_heights:
            heights[bid] = tiles_heights[bid]
            sources[bid] = "tiles"
        elif b.get("heightM") is not None:
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
    for s2 in sources.values():
        counts[s2] = counts.get(s2, 0) + 1
    print(f"-> {OUT_H}")
    print(f"heights: {len(heights)} buildings; sources: {counts}")

if __name__ == "__main__":
    main()
