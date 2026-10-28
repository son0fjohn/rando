# Map data: where the city comes from, and what it may say

What the 3D world is built from, under what licence, and what we credit.
The engine side is in `docs/map_city.md`; the look is `assets/world/STYLE.md`.

## Sources, by place

| What | Where | Source | Licence | In the app |
|---|---|---|---|---|
| Buildings, roads, parks, water | the baked areas (`scripts/city_areas.json`) | **Overture Maps** buildings + transportation (release 2026-10-21.0, from S3, no key) — OpenStreetMap plus, in Korea, the East-Asia footprints dataset (Zenodo 8174931, CC BY 4.0); in Canada Microsoft ML footprints | ODbL 1.0 | `web/tiles/cities.pmtiles` (`scripts/fetch_overture.py` → `scripts/bake_city_tiles.py`) |
| Buildings, roads, parks, water | anywhere else | **OpenFreeMap** (OpenMapTiles schema, OpenStreetMap data), z14 tiles read in the browser | ODbL (data), OpenMapTiles credit (CC BY 4.0 design) | `web/cityomt.js` + `web/mvt.js`, in the chunk worker |
| Heights / floors, Korea | Itaewon (baked), the other Korean areas (to do, see below) | **VWorld** (국토교통부): `LT_C_SPBD` (도로명주소 건물: floors) today, `LT_C_BLDGINFO` (GIS건물통합정보: height, floors, use) next | 공공누리 제1유형 (attribution) | `scripts/fetch_bldg_registry.py`, `scripts/merge_heights.py` → `web/buildings.json` |
| Heights, Itaewon | the hand-made map | **Google Photorealistic 3D Tiles**, measured (`scripts/capture_heights_reference.py`, `web/data/itaewon_heights.json`) | Google Maps Platform terms — see "Google, Naver, Kakao" | `scripts/merge_heights.py` picks per building |
| Heights, elsewhere | everywhere | Overture/OSM `height` or `building:levels` where present, else **estimated** from the building's class, footprint area and its neighbours (`scripts/bake_city_tiles.py`, `web/cityomt.js`) | — | every building carries its source |
| Landmarks | `web/data/heroes.json` | hand-placed (lat/lng from OSM), models ours | — | `web/world3d.js` `cityHeroes` |

Every building in `web/buildings.json` and in the baked chunks carries a
source tag (`hsrc`: `google` / `vworld` / `overture` / `osm` / `estimated`)
so the mix can be audited; `scripts/merge_heights.py` prints the counts and
the disagreements it had to settle.

## Attribution

What the licences ask, and where we show it:

- **Map corner, always** (`web/world3d.js` `credit()`, `#osm-credit`): each
  name a link — `© OpenStreetMap contributors` (to the OSM copyright page,
  which is how ODbL's "make the licence clear" is met) · `Overture Maps
  Foundation` · `© OpenMapTiles` (its site, as OpenMapTiles' design licence
  asks) · `국토교통부 브이월드` where Korean registry heights show. On the
  hand-made Itaewon map: `roads © OpenStreetMap contributors · buildings
  국토교통부 브이월드`.
- **The archive** (`web/tiles/cities.pmtiles`): its metadata carries the
  same line as HTML, `license: ODbL-1.0`, and `web/tiles/NOTICE.txt` sits
  next to it with the per-source list (Overture's own contributors, the CC
  BY 4.0 datasets, Microsoft, TomTom), the KOGL sentence for VWorld, the
  modifications made, and the archive's own download URL — ODbL wants a
  derivative database to be offered under ODbL with a machine-readable copy,
  which the public file is.
- **OpenFreeMap** asks for `OpenFreeMap © OpenMapTiles Data from
  OpenStreetMap`; the OpenFreeMap part is optional and we show OpenMapTiles
  and OpenStreetMap. It is free, no key, commercial use allowed, no SLA: the
  baked archive is the safety net for the key areas.

## Google, Naver, Kakao

Their terms don't allow extracting map geometry, storing their content, or
showing their content on a non-Google / non-Naver / non-Kakao map:

- **No footprints, roads or names** are taken from any of them. The only
  Google-derived data in the repo is the measured Itaewon heights
  (`web/data/itaewon_heights.json`, 163 buildings from Photorealistic 3D
  Tiles), kept by the owner's decision because the scan beats the registry
  for actual height; `scripts/merge_heights.py` compares them with VWorld
  per building and records which won. Google's Maps Platform terms
  (§3.2.3(c)) read as forbidding making 3D models from their content, so
  this is a known risk the owner accepted; swapping those 163 buildings to
  VWorld floors × 3.25 m is one flag in `merge_heights.py`.
- **Naver / Kakao**: nothing from them is in the shipped app. The venue
  address file (`web/data/naver_addresses.json`) is a research artefact, not
  read by any page; Naver's API terms don't allow storing results beyond a
  day on a device, so it should go once the venue names are confirmed from
  OpenStreetMap.
- Street View imagery (`scripts/fetch_streetview.py`) was only ever used as
  ephemeral reference for hand-made models; nothing shipped derives from it.

## Korea: VWorld heights beyond Itaewon (to do, needs a key)

VWorld's data API needs a free key tied to a registered domain
(`VWORLD_API_KEY` in `.env`), and vworld.kr isn't reachable from the coding
sandbox, so this runs on a machine of ours:

1. `python scripts/fetch_bldg_registry.py --area gangnam` (and hongdae,
   jamsil, coex, namsan, yeonhui) — switch the layer to `LT_C_BLDGINFO`
   (fields `height`, `grnd_flr`, `ugrnd_flr`, `usability`) and keep
   `LT_C_SPBD` for names and floors where BLDGINFO has none.
2. `python scripts/bake_city_tiles.py` merges per building: BLDGINFO height
   when > 0 and 2–8 m per floor; else floors × 3.25 m; else Overture/OSM;
   else the estimate. Tag the source.
3. The research notes behind these choices (API limits, the two KOGL-1
   datasets vs the CC BY-NC-ND one that must not be shipped, the storage
   clause in VWorld's platform terms that still wants a written OK for
   API-fetched data) are in the session's data report; the bulk file
   (데이터마켓 GIS건물통합정보, monthly, 6.6 GB) is the clean redistribution
   path if VWorld won't confirm the API one.

## Height estimation (no source)

`scripts/bake_city_tiles.py` and `web/cityomt.js`: floors by class (house
2–4, apartment 10–20, commercial 3–6, office 8–20) seeded by the building's
id, nudged by footprint area (big footprints lean taller within their
class), and pulled toward the median of the known heights within ~60 m so a
guessed building sits in its street. 3.2 m a floor. The spec in
`test/specs.js` ("buildings with no height in the data get one by type")
pins the ranges.
