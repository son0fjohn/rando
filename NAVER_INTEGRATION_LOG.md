# NAVER_INTEGRATION_LOG — branch `naver-basemap`

## Decisions

**1 · Which Naver product, and where it runs.**
Chose **Geocoding + Reverse Geocoding** as the primary integration and
**Static Map** as an offline reference fetcher; skipped **Dynamic Map**.
Rationale:

- We render our own 3D world — an interactive vector basemap (Dynamic
  Map) underneath it is overkill and a second map engine to fight. The
  spec's own read matches.
- The REST Maps APIs authenticate with `X-NCP-APIGW-API-KEY` — a
  **client secret**. Rando's client is a static site (no server), so the
  secret can never appear in browser JS. Therefore the whole integration
  is **build-time Python** (`scripts/naver_maps.py`), the same layer as
  the Google/Tripo pipelines. The client is untouched — which also makes
  the no-keys fallback trivial: bake scripts print one line and no-op.
- **Static Map imagery is licensed for display, not redistribution** —
  so it's wired as a reference fetcher (art/texture comparison, saved
  outside the repo), NOT baked into shipped assets. OSM remains the
  geometry source; Naver is additive, exactly per spec.

**2 · Geocoding scope caveat (flagged for you).**
NCP Maps *Geocoding* is **address → coordinates**. Venue-NAME lookup
("Jack's Bar") is a different product — **Naver Search/Local API** on
developers.naver.com with separate keys. So:
- Placed venues are cross-checked via **reverse** geocoding (pin → road
  address, human-checkable, saved to `web/data/naver_addresses.json`).
- Pending venues (Bolero, Grainhaus) get pins the moment an `addr`
  field is pasted into their landmarks.json entries —
  `naver_verify_venues.py --apply` writes the proposed coordinates.
- If you want POI-by-name truth, say so and I'll add the Local API as a
  second module (needs its own keys from developers.naver.com).

**3 · Usage tracking.** Local monthly counter in
`scripts/naver_usage.json` (gitignored), soft-warn at 100k calls/month —
far under the 3M/6M ceilings; our bakes use a handful of calls.

## State

- `NAVER_SETUP.md` — exact console walkthrough (account → Maps subscribe
  → app registration → API ticks → URL whitelist → copy keys → `.env`).
- `.env.example` — placeholder keys for every secret the repo uses.
- `scripts/naver_maps.py` — service module (geocode / reverse / static
  map, auth headers, error-body capture, usage counter, graceful no-key
  path). `--probe` smoke-tests credentials.
- `scripts/naver_verify_venues.py` — venue cross-check (dry-run default,
  `--apply` to write pending pins).

## Blocked on you (Task 4)

Provision the keys per `NAVER_SETUP.md`, then:

```
py -3 scripts/naver_maps.py --probe
py -3 scripts/naver_verify_venues.py
```

The first prints a live geocode of 이태원로 179 (Hamilton Hotel) plus the
usage counter; the second writes the address inventory for all placed
heroes. Phone test is unaffected — this branch changes zero client code
(verified: app boots identically).
