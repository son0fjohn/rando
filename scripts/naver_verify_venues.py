"""Cross-check hero venue pins against Naver's Korea-accurate map data.

Two passes, both build-time and read-only by default:

1. Every PLACED landmark: reverse-geocode its pin to a Korean road
   address — a human-checkable "does this pin sit on the right street?"
   report, and the address inventory for future label work. Written to
   web/data/naver_addresses.json (data only, no imagery).
2. Every PENDING landmark (bolero, grainhaus) that carries an "addr"
   field (paste one into landmarks.json pending entries): forward-
   geocode the address to a proposed pin. Dry-run prints the proposal;
   --apply writes lat/lng into the pending entry (it stays pending until
   the engine-side placement is reviewed).

Keys absent => prints one line and exits 0 (build never breaks).

    py -3 scripts/naver_verify_venues.py [--apply]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import naver_maps  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANDMARKS = os.path.join(ROOT, "web", "landmarks.json")
OUT = os.path.join(ROOT, "web", "data", "naver_addresses.json")

def main():
    if naver_maps._keys() is None and naver_maps._vworld_key() is None:
        print("no geocoder keys (Naver or VWorld) — verification skipped")
        return 0
    lm = json.load(open(LANDMARKS))
    apply_pins = "--apply" in sys.argv

    addresses = {}
    print("== placed landmarks: pin -> Korean road address ==")
    for l in lm["landmarks"]:
        if l.get("lat") is None or not l.get("glb"):
            continue
        rv = naver_maps.best_reverse(l["lat"], l["lng"])
        addr = (rv or {}).get("road") or (rv or {}).get("legal")
        addresses[l["id"]] = {"name": l.get("name"), "lat": l["lat"],
                              "lng": l["lng"], "address": addr}
        print(f"  {l['id']:22s} {addr or '(unmapped)'}")

    print("== pending landmarks: address -> proposed pin ==")
    changed = False
    for p in lm.get("pending", []):
        addr = p.get("addr")
        if not addr:
            print(f"  {p['id']:22s} no 'addr' field — paste one into "
                  "landmarks.json pending entry to geocode it")
            continue
        g = naver_maps.best_geocode(addr)
        if not g:
            print(f"  {p['id']:22s} geocode MISS for {addr!r}")
            continue
        best = g[0]
        print(f"  {p['id']:22s} {addr!r} → {best['lat']:.6f},"
              f"{best['lng']:.6f} ({best['road_address']})"
              f"{'  [APPLIED]' if apply_pins else '  [dry-run]'}")
        if apply_pins:
            p["lat"], p["lng"] = best["lat"], best["lng"]
            changed = True

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(addresses, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"-> {OUT} ({len(addresses)} addresses)")
    if changed:
        json.dump(lm, open(LANDMARKS, "w"), indent=2)
        print("-> landmarks.json pending pins updated (still pending; "
              "review then move to landmarks[] to place)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
