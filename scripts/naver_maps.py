"""Naver Cloud Platform Maps — build-time service module.

ARCHITECTURE DECISION (see NAVER_INTEGRATION_LOG.md): the REST Maps APIs
authenticate with a Client SECRET header, so they are server-side APIs.
Rando's client is a static site — the secret must never ship in browser
JS. All Naver access therefore happens here, at build/bake time, exactly
like the Google/Tripo pipelines. Keys absent => every call returns None
with one readable line, so builds never break without credentials.

    py -3 scripts/naver_maps.py --probe      # credential smoke test

Endpoints (Maps subscription on maps.apigw.ntruss.com; the pre-2023 host
naveropenapi.apigw.ntruss.com still resolves for old accounts):
  geocode(addr)            address -> coords (Korea-accurate)
  reverse_geocode(lat,lng) coords  -> Korean road/legal address
  static_map(...)          offline ground-reference image (NOT committed;
                           Naver tile imagery is licensed for display, not
                           for redistribution inside shipped assets)

Free tier: Static Map 3M/mo, Dynamic 6M/mo, geocoding generous. A local
monthly counter (scripts/naver_usage.json, gitignored) makes usage drift
visible; the soft warn threshold is far below any ceiling.
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://maps.apigw.ntruss.com"
USAGE = os.path.join(ROOT, "scripts", "naver_usage.json")
SOFT_WARN = 100_000  # calls/month — far under every free ceiling

def _env(name):
    try:
        for line in open(os.path.join(ROOT, ".env")).read().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return os.environ.get(name)

def _keys():
    cid = _env("NAVER_MAPS_CLIENT_ID")
    sec = _env("NAVER_MAPS_CLIENT_SECRET")
    if not cid or not sec or "your_naver" in (cid + sec):
        return None
    return {"X-NCP-APIGW-API-KEY-ID": cid, "X-NCP-APIGW-API-KEY": sec}

def _count(kind):
    month = datetime.date.today().strftime("%Y-%m")
    data = {}
    if os.path.exists(USAGE):
        try:
            data = json.load(open(USAGE))
        except json.JSONDecodeError:
            data = {}
    m = data.setdefault(month, {})
    m[kind] = m.get(kind, 0) + 1
    json.dump(data, open(USAGE, "w"), indent=1)
    if m[kind] == SOFT_WARN:
        print(f"naver: {kind} passed {SOFT_WARN} calls this month — "
              "check usage in the NCP console")
    return m[kind]

def _get(path, params, kind, binary=False):
    headers = _keys()
    if headers is None:
        print("naver: keys missing — skipping (see NAVER_SETUP.md)")
        return None
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={
        **headers, "User-Agent": "rando-build/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            _count(kind)
            return r.read() if binary else json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        print(f"naver: HTTP {e.code} on {path} :: {body}")
        return None
    except Exception as e:
        print(f"naver: {path} failed :: {e}")
        return None

def geocode(address, bias_lat=None, bias_lng=None):
    """Address -> [{lat, lng, road_address, jibun_address}] (best first)."""
    params = {"query": address}
    if bias_lat is not None:
        params["coordinate"] = f"{bias_lng},{bias_lat}"
    d = _get("/map-geocode/v2/geocode", params, "geocode")
    if not d or d.get("status") != "OK":
        return None
    out = []
    for a in d.get("addresses", []):
        out.append({"lat": float(a["y"]), "lng": float(a["x"]),
                    "road_address": a.get("roadAddress"),
                    "jibun_address": a.get("jibunAddress")})
    return out or None

def reverse_geocode(lat, lng):
    """Coords -> {road, legal} Korean addresses (None fields if unmapped)."""
    d = _get("/map-reversegeocode/v2/gc", {
        "coords": f"{lng},{lat}", "output": "json",
        "orders": "roadaddr,addr"}, "reverse")
    if not d:
        return None
    road = legal = None
    for r in d.get("results", []):
        region = " ".join(filter(None, [
            r.get("region", {}).get(f"area{i}", {}).get("name")
            for i in (1, 2, 3)]))
        land = r.get("land") or {}
        if r.get("name") == "roadaddr":
            road = " ".join(filter(None, [
                region, land.get("name"), land.get("number1")]))
        elif r.get("name") == "addr":
            legal = " ".join(filter(None, [region, land.get("number1")]))
    return {"road": road, "legal": legal}

def static_map(lat, lng, out_path, level=16, w=1024, h=1024, maptype="basic"):
    """Fetch a ground-reference image. REFERENCE ONLY — keep out of the
    repo/app; Naver imagery is licensed for display, not redistribution."""
    data = _get("/map-static/v2/raster", {
        "center": f"{lng},{lat}", "level": level, "w": w, "h": h,
        "maptype": maptype, "format": "png"}, "static", binary=True)
    if data is None:
        return None
    with open(out_path, "wb") as f:
        f.write(data)
    return out_path

# ---------------- VWorld fallback (same key as the registry fetch) ----
# NCP keys are OPTIONAL: with VWORLD_API_KEY present, geocode/reverse run
# against the government address DB instead. Naver remains a drop-in
# upgrade if its keys ever land — call signatures are identical.

def _vworld_key():
    k = _env("VWORLD_API_KEY")
    return k if k and "your_vworld" not in k else None

def vworld_geocode(address):
    key = _vworld_key()
    if not key:
        return None
    q = urllib.parse.urlencode({
        "service": "address", "request": "getcoord", "version": "2.0",
        "crs": "epsg:4326", "address": address, "refine": "true",
        "simple": "false", "format": "json", "type": "road", "key": key})
    try:
        with urllib.request.urlopen(
                f"https://api.vworld.kr/req/address?{q}", timeout=30) as r:
            d = json.loads(r.read())
    except Exception as e:
        print(f"vworld geocode failed :: {e}")
        return None
    res = d.get("response", {})
    if res.get("status") != "OK":
        # road-address miss: retry as jibun (parcel) address
        q2 = q.replace("type=road", "type=parcel")
        try:
            with urllib.request.urlopen(
                    f"https://api.vworld.kr/req/address?{q2}", timeout=30) as r:
                d = json.loads(r.read())
            res = d.get("response", {})
        except Exception:
            return None
        if res.get("status") != "OK":
            return None
    pt = res.get("result", {}).get("point", {})
    return [{"lat": float(pt["y"]), "lng": float(pt["x"]),
             "road_address": res.get("refined", {}).get("text"),
             "jibun_address": None}]

def vworld_reverse(lat, lng):
    key = _vworld_key()
    if not key:
        return None
    q = urllib.parse.urlencode({
        "service": "address", "request": "getAddress", "version": "2.0",
        "crs": "epsg:4326", "point": f"{lng},{lat}", "type": "both",
        "format": "json", "key": key})
    try:
        with urllib.request.urlopen(
                f"https://api.vworld.kr/req/address?{q}", timeout=30) as r:
            d = json.loads(r.read())
    except Exception as e:
        print(f"vworld reverse failed :: {e}")
        return None
    res = d.get("response", {})
    if res.get("status") != "OK":
        return None
    road = legal = None
    for item in res.get("result", []):
        if item.get("type") == "road":
            road = item.get("text")
        elif item.get("type") == "parcel":
            legal = item.get("text")
    return {"road": road, "legal": legal}

def best_geocode(address, **kw):
    """NCP if configured, else VWorld — one call site for venue scripts."""
    return geocode(address, **kw) if _keys() else vworld_geocode(address)

def best_reverse(lat, lng):
    return reverse_geocode(lat, lng) if _keys() else vworld_reverse(lat, lng)

def _probe():
    if _keys() is None:
        print("naver: keys missing — fill NAVER_MAPS_CLIENT_ID / "
              "NAVER_MAPS_CLIENT_SECRET in .env (see NAVER_SETUP.md)")
        return 1
    # Hamilton Hotel's road address — a stable Itaewon landmark
    g = geocode("서울특별시 용산구 이태원로 179")
    if not g:
        print("probe FAILED: geocode returned nothing (check API ticks "
              "on the app registration)")
        return 1
    print(f"credentials OK — geocode(이태원로 179) → "
          f"{g[0]['lat']:.6f},{g[0]['lng']:.6f} ({g[0]['road_address']})")
    rv = reverse_geocode(37.53410, 126.99659)  # Grand Ole Opry hero pin
    print(f"reverse(37.53410,126.99659) → {rv}")
    month = datetime.date.today().strftime("%Y-%m")
    usage = json.load(open(USAGE)) if os.path.exists(USAGE) else {}
    print(f"usage {month}: {usage.get(month, {})}")
    return 0

if __name__ == "__main__":
    if "--probe" in sys.argv:
        raise SystemExit(_probe())
    print(__doc__)
