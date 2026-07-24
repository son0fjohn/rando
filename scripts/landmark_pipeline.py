"""Fully automated Street View -> 3D landmark pipeline.

    py -3 scripts/landmark_pipeline.py itaewon-station
    py -3 scripts/landmark_pipeline.py itaewon-station --dry-run

Per spot (from scripts/sv_spots.json):
  1. fetch 4-6 Street View views aimed at the target (ephemeral temp refs)
  2. pick the 4 best-separated views (both 3D APIs cap at 4)
  3. submit to Tripo multiview-to-3D (TRIPO_API_KEY) or Meshy
     multi-image-to-3D (MESHY_API_KEY) — whichever key exists, Tripo first
  4. poll, download the GLB into web/world2/landmarks/<spot>.glb
  5. point the spot's web/landmarks.json entry at the file (the engine
     applies the locked low-poly material pass + outline at load and
     suppresses the generic prisms on that plot)
  6. PURGE the Street View refs (one-time reference use, never archived)

Keys in .env: GOOGLE_MAPS_API_KEY (required), TRIPO_API_KEY or
MESHY_API_KEY (one required for reconstruction).
"""
import base64
import json
import math
import os
import shutil
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from fetch_streetview import OUTDIR, META, IMG, offset, bearing, get_json  # noqa: E402

LANDMARKS = os.path.join(ROOT, "web", "landmarks.json")
OUT_GLB_DIR = os.path.join(ROOT, "web", "world2", "landmarks")

TRIPO = "https://api.tripo3d.ai/v2/openapi"
MESHY = "https://api.meshy.ai/openapi/v1"

def env(name):
    for line in open(os.path.join(ROOT, ".env")).read().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return None

def http(url, data=None, headers=None, method=None, timeout=120):
    h = {"User-Agent": "rando-landmark-pipeline/1.0", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:600]
        raise SystemExit(f"HTTP {e.code} from {url}\n{body}")

def fetch_views(spot, gkey):
    """Ring-probe panoramas around the target; return up to max_views files."""
    sdir = os.path.join(OUTDIR, spot["id"])
    os.makedirs(sdir, exist_ok=True)
    # refs already fetched this session (e.g. a retry after a billing
    # hiccup): reuse rather than re-billing — they're purged on success
    existing = sorted(
        os.path.join(sdir, f) for f in os.listdir(sdir) if f.endswith(".jpg"))
    if len(existing) >= 2:
        print(f"  reusing {len(existing)} refs already fetched this session")
        return existing
    panos = {}
    for ang in range(0, 360, 30):
        rad = math.radians(ang)
        plat, plng = offset(spot["lat"], spot["lng"],
                            spot["ring_m"] * math.cos(rad),
                            spot["ring_m"] * math.sin(rad))
        meta = get_json(META, {"location": f"{plat},{plng}",
                               "source": "outdoor", "key": gkey})
        if meta.get("status") != "OK":
            continue
        pid = meta["pano_id"]
        if pid not in panos:
            loc = meta["location"]
            panos[pid] = (loc["lat"], loc["lng"])
    views = []
    for pid, (clat, clng) in panos.items():
        hd = bearing(clat, clng, spot["lat"], spot["lng"])
        ang_around = bearing(spot["lat"], spot["lng"], clat, clng)
        views.append({"pano": pid, "cam": (clat, clng), "heading": hd,
                      "around": ang_around})
    # pick 4 well-separated camera angles around the target
    views.sort(key=lambda v: v["around"])
    picked = views
    if len(views) > 4:
        picked, used = [], []
        for want in (0, 90, 180, 270):
            best = min(views, key=lambda v: min(
                abs(v["around"] - want), 360 - abs(v["around"] - want))
                + (1e9 if v["pano"] in used else 0))
            picked.append(best)
            used.append(best["pano"])
    for i, v in enumerate(picked):
        q = urllib.parse.urlencode({
            "size": "640x640", "pano": v["pano"],
            "heading": round(v["heading"], 1), "fov": spot.get("fov", 78),
            "pitch": spot.get("pitch", 10), "key": gkey})
        path = os.path.join(sdir, f"view{i}.jpg")
        urllib.request.urlretrieve(f"{IMG}?{q}", path)
        v["file"] = path
        print(f"  view{i}: pano {v['pano'][:10]}… around={v['around']:.0f} deg")
    return [v["file"] for v in picked]

# ---------------- Tripo ----------------
def tripo_upload(key, path):
    boundary = "----randoform"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="file"; filename="{os.path.basename(path)}"\r\n'
            f"Content-Type: image/jpeg\r\n\r\n").encode() + \
        open(path, "rb").read() + f"\r\n--{boundary}--\r\n".encode()
    r = json.loads(http(f"{TRIPO}/upload", data=body, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}"}))
    return r["data"]["image_token"]

def tripo_generate(key, files):
    # order: front, left, back, right (missing views padded with front)
    tokens = [tripo_upload(key, f) for f in files]
    while len(tokens) < 4:
        tokens.append(tokens[0])
    task = {"type": "multiview_to_model",
            "files": [{"type": "jpg", "file_token": t} for t in tokens[:4]]}
    r = json.loads(http(f"{TRIPO}/task", data=json.dumps(task).encode(),
                        headers={"Authorization": f"Bearer {key}",
                                 "Content-Type": "application/json"}))
    tid = r["data"]["task_id"]
    print(f"  tripo task {tid}")
    while True:
        time.sleep(8)
        s = json.loads(http(f"{TRIPO}/task/{tid}",
                            headers={"Authorization": f"Bearer {key}"}))
        st = s["data"]["status"]
        print(f"  … {st} ({s['data'].get('progress', '?')}%)")
        if st == "success":
            out = s["data"]["output"]
            return out.get("pbr_model") or out.get("model")
        if st in ("failed", "cancelled", "banned"):
            raise SystemExit(f"tripo task {st}: {s['data']}")

# ---------------- Meshy ----------------
def meshy_generate(key, files):
    uris = ["data:image/jpeg;base64," +
            base64.b64encode(open(f, "rb").read()).decode() for f in files[:4]]
    r = json.loads(http(f"{MESHY}/multi-image-to-3d",
                        data=json.dumps({"image_urls": uris,
                                         "should_texture": True}).encode(),
                        headers={"Authorization": f"Bearer {key}",
                                 "Content-Type": "application/json"}))
    tid = r["result"]
    print(f"  meshy task {tid}")
    while True:
        time.sleep(10)
        s = json.loads(http(f"{MESHY}/multi-image-to-3d/{tid}",
                            headers={"Authorization": f"Bearer {key}"}))
        print(f"  … {s['status']} ({s.get('progress', '?')}%)")
        if s["status"] == "SUCCEEDED":
            return s["model_urls"]["glb"]
        if s["status"] in ("FAILED", "CANCELED"):
            raise SystemExit(f"meshy task failed: {s}")

def main():
    spot_id = next((a for a in sys.argv[1:] if not a.startswith("-")), None)
    dry = "--dry-run" in sys.argv
    spots = json.load(open(os.path.join(ROOT, "scripts", "sv_spots.json")))["spots"]
    spot = next((s for s in spots if s["id"] == spot_id), None)
    if not spot:
        raise SystemExit(f"unknown spot {spot_id!r}; add it to scripts/sv_spots.json")
    gkey = env("GOOGLE_MAPS_API_KEY")
    tkey, mkey = env("TRIPO_API_KEY"), env("MESHY_API_KEY")
    if dry:
        print(f"DRY RUN {spot['id']}: google={'ok' if gkey else 'MISSING'} "
              f"tripo={'ok' if tkey else 'no'} meshy={'ok' if mkey else 'no'}")
        return
    if not gkey:
        raise SystemExit("GOOGLE_MAPS_API_KEY missing from .env")
    if not (tkey or mkey):
        raise SystemExit("need TRIPO_API_KEY or MESHY_API_KEY in .env")

    print(f"[1/4] street view refs for {spot['id']}")
    files = fetch_views(spot, gkey)
    if len(files) < 2:
        raise SystemExit("fewer than 2 usable panoramas — pick another spot")

    print(f"[2/4] reconstruction via {'tripo' if tkey else 'meshy'}")
    glb_url = tripo_generate(tkey, files) if tkey else meshy_generate(mkey, files)

    print("[3/4] download + place")
    os.makedirs(OUT_GLB_DIR, exist_ok=True)
    out_path = os.path.join(OUT_GLB_DIR, f"{spot['id']}.glb")
    urllib.request.urlretrieve(glb_url, out_path)
    lm = json.load(open(LANDMARKS))
    entry = next((l for l in lm["landmarks"] if l["id"] == spot["id"]), None)
    if entry is None:
        entry = {"id": spot["id"], "lat": spot["lat"], "lng": spot["lng"],
                 "yaw": 0, "h": 30, "clear": 34, "glb": None}
        lm["landmarks"].append(entry)
    entry["glb"] = f"world2/landmarks/{spot['id']}.glb"
    with open(LANDMARKS, "w") as f:
        json.dump(lm, f, indent=2)
    print(f"  {out_path} ({os.path.getsize(out_path) // 1024}KB) -> landmarks.json")

    print("[4/4] purge street view refs (one-time use)")
    shutil.rmtree(os.path.join(OUTDIR, spot["id"]), ignore_errors=True)
    print("done — engine applies the low-poly material pass at load")

if __name__ == "__main__":
    main()
