# The map anywhere: the procedural city, Itaewon, landmarks

Wherever the player is, the map is a 3D city in our low-poly style built
from real map data: buildings with their real footprints and heights (or a
good guess), streets with sidewalks, parks with trees, water, street names,
famous landmarks. Itaewon keeps its hand-made map.

## Which world, where (`web/world3d.js` `worldAt`)

- **Near Itaewon** (within 3 km of the station): the hand-made map, with the
  procedural city filling in round its edges. The procedural chunks share
  its origin and leave its middle alone, by the hand-made map's own shape
  (`world3d.js` `handmadeSrc`, worked out in the chunk worker by
  `citygen.js` `handmadeMask` and `handmade`): how far its
  buildings reach in each of 64 directions (450–790 world units: it isn't a
  circle), and a 4 u grid of what its buildings and roads cover. Inside
  that reach nothing procedural; outside it the procedural city fills in
  right up to the hand-made buildings, leaving out a building the
  hand-made map already has (its middle, or most of its corners, on a
  hand-made footprint) and a street it already draws (most of its length on
  a hand-made road). (It used to be one circle each: no building within
  820, no road within 1420, which left an empty ring of up to 370 u between
  the two in most directions and the streets missing out to 1420.) The
  hand-made hills flatten out toward the edge so the two meet on flat
  ground. The procedural ground follows the same hills, just under the
  hand-made one (flat, it used to cover the hand-made map's south side,
  roads and all, where the hills fall toward the river) (`world3d.js`
  `blendGround`). The hand-made grass stays grass: repaving it turned
  Namsan into paving, since the baked data has no park outline there.
  When the blend starts, the world reaches out to 3.75 km and you (and
  Explore's spot, and the others) are placed again: before, someone 1.9–3
  km out (Yongsan Station, Huam-dong, Oksu) stood at the hand-made map's
  old edge, up to 800 m from where they were, among another neighbourhood's
  streets.
- **Anywhere else**: the procedural city, centred where you are. It
  re-centres when you go more than 2.5 km from its origin.
- The spot is the player's (presence) or Explore's (read on the phone, only
  if location is allowed; never sent). While the start screen is up the
  world is held on Itaewon (its still image is Itaewon) and catches up when
  it closes.
- `?city=tiles` is the old city-only mode (Manhunt's zones, tests); `?blend=0`
  turns the Itaewon blend off.

## Data

A chunk comes from the first of these that has it (`web/citygen.worker.js`):

1. **The areas' archive** (`web/tiles/cities.pmtiles`, ~1.6 MB): z16 chunks
   for the circles in `scripts/city_areas.json` "areas" (Itaewon, Hongdae,
   Gangnam, Yeonhui, Busan Haeundae, Tokyo Shibuya, Jamsil, COEX, Namsan,
   downtown Calgary, downtown Edmonton). Built by `scripts/fetch_overture.py`
   (Overture Maps on S3: OpenStreetMap + the East-Asia / Microsoft ML
   footprints, anonymous, no key) and `scripts/bake_city_tiles.py`. In Korea
   the official building registry wins for Itaewon. Add an area: a line in
   `city_areas.json`, then `python scripts/fetch_overture.py --only <id>`
   and `python scripts/bake_city_tiles.py --only <every area id>`.
2. **The region archives** (`web/tiles/regions.json` lists them, in
   `city_areas.json` "regions" order): whole cities as boxes, one archive
   each, from the same Overture data. The capital area and Busan:

   | Archive | Box | Buildings | Chunks | Size |
   |---|---|---|---|---|
   | `kr-seoul.pmtiles` | all of Seoul (126.76–127.19 E, 37.41–37.72 N) | 493k | 5,460 | 19.8 MB |
   | `kr-capital-w.pmtiles` | Incheon, Bucheon, Gimpo | 170k | 5,269 | 8.6 MB |
   | `kr-capital-s.pmtiles` | Gwangmyeong, Anyang, Gwacheon, Seongnam, Bundang, north Suwon | 203k | 5,285 | 9.9 MB |
   | `kr-capital-e.pmtiles` | Hanam, Guri, west Namyangju | 47k | 2,640 | 2.9 MB |
   | `kr-capital-n.pmtiles` | Goyang, Uijeongbu | 40k | 1,501 | 2.1 MB |
   | `kr-busan.pmtiles` | central Busan | 126k | | 5.2 MB |

   Read where the areas' archive has no chunk, or only the part inside its
   circle (the region fills the rest of that chunk). A region keeps only
   the chunks wholly inside its box, so each is whole and needs nothing
   from the worldwide tiles; neighbouring boxes overlap by ~1 km so a chunk
   on one's edge is whole in the next (the worker tries every region whose
   box holds the chunk, in order).
   **Why:** OpenStreetMap, all the worldwide tiles carry, maps only a
   fraction of Korea's houses (Mangwon-dong: 22 of 287 buildings in the
   chunk round the station; south of Itaewon 22 of 158); Overture adds the
   East-Asia machine-learned footprints for the rest. Add a region: a line
   in `city_areas.json` "regions" (`id`, `label`, `bbox`, `archive`), then
   `python scripts/fetch_overture.py --only <id>` and `python
   scripts/bake_city_tiles.py --only <id>` (Seoul: ~1 min a theme to fetch,
   6 min to bake). ~40 bytes a building with its roads and parks. Keep each
   archive under ~50 MB (GitHub warns past 50, refuses past 100). They're
   static files on Vercel, which answers byte ranges, so a phone only ever
   downloads the chunks it needs (~2 KB each, gzipped) plus a directory
   page now and then; nothing is downloaded whole. Each re-bake adds the
   archive's size to the git history again, so re-bake when the data
   matters (a new Overture release, a new region), not on every change.
3. **Anywhere else: OpenFreeMap** (`web/cityomt.js`, `web/mvt.js`): the free,
   worldwide OpenMapTiles vector tiles (OpenStreetMap; no key, no per-user
   cost, https://openfreemap.org). Where the archives have no chunk, the
   worker reads the z14 tile and turns it into our 16 z16 chunks: buildings
   (`render_height`; OpenMapTiles' 5 m filler counts as unknown), roads by
   class (no tunnels), water, parks, woods, grass, the names of main roads and
   of major places. A chunk at the edge of a baked area fills in what lies
   outside the area's circle from there too, so baked areas fade into the
   world instead of stopping at a ring. `?omt=<TileJSON or {z}/{x}/{y} url>`
   points it elsewhere (a self-hosted copy for heavy traffic), `?omt=0`
   turns it off. Outside the regions this is OpenStreetMap's buildings only.
4. **Unreachable data is asked for again.** A chunk whose archive or
   worldwide tile couldn't be reached (offline, blocked, a server error)
   comes back marked `retry` with whatever did arrive; `citytiles.js` asks
   for it again after 15 s, then 30, 60, 120 (it used to stay empty for
   good: one failed tile left a ring of bare paving round you). The worker
   leaves the worldwide tiles alone for 10 s after a failure. An archive
   that isn't there at all (404) counts as no archive, not a failure.
   The device cache is keyed by each archive's size, so a re-baked archive
   is never read from an old copy.
5. **Attribution** in the map's corner: "© OpenStreetMap contributors ·
   Overture Maps Foundation · OpenMapTiles" whenever the procedural city is
   on; "roads © OpenStreetMap contributors" on the hand-made map; the start
   screen has its own line.

`?regions=0` leaves the region archives out (what the map was before them:
the areas' archive and the worldwide tiles).

## Worldwide Overture buildings (ready, off)

The same fix everywhere (machine-learned footprints wherever OpenStreetMap
is thin, not just in the baked cities) needs Overture's buildings as tiles
the phone can read. The worker can already use them: `?ovt=<url of an
Overture buildings PMTiles>` (or `OVT_URL` in `web/citytiles.js`) makes the
worldwide fallback's buildings come from that archive's z14 tiles ("building"
layer: `height`, `num_floors`, `class`, `subtype`, `roof_shape`,
`min_height`, `is_underground`; `cityomt.js` maps them as the baker does,
and estimates the rest) while roads, parks and water stay OpenMapTiles'.
With OpenMapTiles unreachable the buildings still come. What's missing is a
copy we can rely on:

- Overture publishes one per release at
  `https://tiles.overturemaps.org/<release>/buildings.pmtiles` (the explore
  site reads it in the browser; Planetiler, z14 max, `overture-tiles`
  profile). Unverified from the coding sandbox (the host is blocked there):
  check it answers byte ranges with `Access-Control-Allow-Origin` for our
  origin. Release folders are dated and old ones are removed, so the app
  would need the current release name (or a redirect of our own).
- Or host our own: `pmtiles extract <that url> korea.pmtiles --bbox=...`
  (or the whole planet, ~100+ GB) on Cloudflare R2 (no egress fees) or S3
  + CloudFront, with CORS for randoirl.vercel.app and byte ranges. A Korea
  extract is a few hundred MB: too big for Vercel's static files, fine for R2.
- `scripts/omt_fixture.py` can write test tiles in that schema later; the
  spec "with Overture's building tiles the buildings come from them" pins
  the conversion.

## Buildings

- Each footprint (simplified to 0.5 m, cleaned) extruded; walls, roofs and
  window grids per type, warm lit windows at night (picked per building in
  the shader), shopfronts and abstract lit signs on commercial streets,
  rooftop boxes, outlines; gabled / hipped / pyramidal roofs on houses.
- Height: measured height, or floors × 3.2 m, when the data has one.
  Otherwise a type (from the data's class, else from size, shape and
  whether it fronts a main road; Korean slab apartments get spotted by
  shape) and floors per type, deterministic per building: houses 2–4,
  apartments 10–20, commercial 3–6, offices 8–20, civic 3–5, industrial 1–3,
  sheds 1. Heights go up 2.4× to 25 m and more gently above, so a 500 m
  tower doesn't swallow the screen.
- A building goes to the chunk holding its centroid (never split, never
  twice); worldwide-tile footprints are clipped to their z14 tile so two
  halves meet exactly.

## Heights (Itaewon's hand-made map)

Every building in `web/buildings.json` carries `h` (world units: metres ×
0.55 × 2.4) and `hsrc`, one of `google` / `vworld` / `osm` / `estimated`,
written by `scripts/merge_heights.py` from files already in the repo
(`python3 scripts/merge_heights.py`, `--dry-run --report out.json` for the
decisions; runs after `bake_registry.py`, which only shapes footprints). The
sources, joined to the footprints by overlap: Google 3D Tiles measured
offline (`web/data/itaewon_heights.json`, the "tiles" rows), the official
registry's floor counts (`web/data/registry_buildings.json`, 3.3 m a
floor), OpenStreetMap tags (`itaewon_layers.json`, then Overture's
`scripts/overture_cache/itaewon.building.parquet`). Where Google and the
registry both speak and roughly agree (a floor or 30 %), Google; where
Google is below the registered floors it sampled a courtyard or the street
and the registry wins; above them, the registry wins when a neighbour
explains the number (a merged scan) or the lot is small (trees, the hill),
Google when the excess is under two floors (rooftop floors). A registry
row of 1–2 floors on a block OSM maps far taller is a podium record and
OSM wins. Nothing at all: the sourced neighbours' median, capped by the
lot's size, else a class default, with a fixed jitter. The script prints
how often each source won and warns when the Google capture doesn't track
the registry (the committed capture doesn't: its heights all sit at 2–9 m).

## Landmarks (`web/data/heroes.json`)

A list of places with a lat/lng, a height and, once it exists, a `.glb`
(from the Tripo pipeline): the model replaces the procedural building(s)
under it (`clear` metres round the pin, or the OSM way / footprint), fitted
to `h`, turned by `rot`, nudged by `offset`. Entries marked
`"landmark": true` stand out before their model is in: their building grows
to `h` with a glowing crown in the entry's `glow` colour, or, with
`"shape": "tower"`, a placeholder tower (shaft, lit pod, mast) stands at the
pin. Each gets a label. First list: Lotte World Tower, N Seoul Tower (tower),
COEX, Gangnam Station, Calgary Tower (tower), Muttart Conservatory, Rogers
Place. To add a model: put the glb under `web/` and set `glb` (and `status:
"live"`).

## Loading and speed (`web/citytiles.js`)

- **The view** (`world3d.js` `ZOOM`, `FOG`): the classic orbit camera,
  175 u from you at 0.58 rad, looking straight at you; pinch 70–420 u,
  two fingers up / down tilt 0.22–1.25 rad, a twist orbits. The city is
  clear round you: the haze is a fog by ground distance from you (not
  depth from the camera: three's fog chunks are patched for a Fog with a
  negative near), clear to 0.65 × its far edge, and the far edge grows
  with the zoom (`fogFar`: 5 × the camera's distance, 850–1750 u, 10 %
  further at night): at the home view clear for ~1.1 km round you,
  zoomed all the way out ~2.2 km, so everything but the band at the top
  of the screen (where the classic camera's view reaches the horizon) is
  clear, and that band is a light haze. A band in the fog's colour stands
  where the ground meets the sky, so there's never a hard edge. Names,
  notes, beacons and labels fade where the haze is all but total
  (`rangeFade`); a party beacon past it is pinned to the edge, pointing
  the way. The start screen's drift keeps its wide view (`mapView` false)
  and a game that frames the map itself (Manhunt's zone overview) asks for
  a free view (`setFreeView`): its own fog, zoom out to 1500 u.
- Chunks stream round the camera target, as far as the map says
  (`world3d.js` `viewRange`, `RANGE`): every chunk within 300 u of you
  (so turning round finds the city there), and out to the haze those the
  camera sees (within 110 u of the ground on screen, cast and cut at the
  haze), not the city behind you. Full detail within 330 u, walls +
  roofs + shadows + parks to 700 u, past that the simple far chunks
  (`citygen.js` lod 2: footprints as their oriented box when they nearly
  fill it, no baked shadows, a quarter of the trees). Past the haze
  they're kept but not drawn; out of view they stay until more than 40
  are kept (the furthest go first), and go 140 u past the range. A wider
  camera (the scenery, a free view, the tests' top-down shots) loads a
  circle as far as it sees the ground, up to 720 u. Built in a worker, at
  most two mounted per frame, missing ones first, nearest first; a new
  chunk rises out of the ground (half a second) instead of popping.
- **Draw calls.** A chunk is a handful of meshes: the worker
  (`citygen.js` `packChunk`) merges what shares a material, so the four
  facade classes are one wall mesh (one texture array, a class byte per
  vertex) and roofs, AC boxes, awnings and kerb clutter one roof mesh; the
  walls, roofs, shadow, roads, parks and water, plus the sign panels,
  outlines and wires up close. The instanced props (trees, street lights,
  power poles, their lamps and pools, lanterns) aren't per chunk at all:
  one InstancedMesh a kind for the whole map (`Pool`), refilled when a
  chunk comes or goes or the camera moves, with what's outside the view
  left out.
- **Triangles.** The painted trees are 5,000 triangles each: beyond 300 u
  from the camera a tree is its light version (`lodTree`: the model
  clustered on a 20-cell grid, its painting baked into vertex colours, a
  fifth of the triangles), on the hand-made map too. The baked shadow
  sweeps only the walls that face the sun's way (the rest is covered
  anyway). Budget at the map's own zoom: 150 draw calls and 300k
  triangles; `test/city_shots.mjs` checks it.
- **Never blank.** The paving, the sky and the fog are up before any chunk.
  The city for a spot can be built ahead, out of sight (`world3d.js`
  `warmCity`): while the start screen or the hand-made map is still up,
  the spot's chunks stream in a hidden city, and it goes on the map whole.
  The start screen's way out waits for that city's near ring (2.5 s at
  most, under its navy veil) before it swaps in; a city the start screen
  covers stays built out of sight and comes back at once; and a re-centre
  (you've gone more than 2.5 km) keeps the old city on screen until the new
  one's near ring is in. `?warm=0` turns it off.
- The device cache (Cache API) keeps chunks and worldwide tiles you've seen.
- `?fps=1` shows frames per second, draws, triangles and chunk timings in a
  corner: the way to check it on a phone.

## Testing

- `npm test`: the archive, heights by type, roofs, detail rings,
  landmarks and their placeholders, the Itaewon exclusion, edge markers,
  the MVT decoder and the OpenMapTiles conversion (a tile encoded in the
  test), Overture's building tiles in its place, the region archives
  (Mangwon-dong and Seongsu-dong whole, every building with a height).
- `node test/world_shots.mjs <dir>`: Gangnam, Itaewon, Itaewon's edge,
  Hongdae, Calgary, Edmonton, Lotte World Tower, and from the Seoul region
  Mangwon-dong, Seongsu-dong, Jongno 3-ga and Huam-dong (the blend ring),
  each with what stands within 500 m (`city.countNear`): a top-down shot next to a
  plan of the same square drawn from the raw data (`scripts/plan_map.py`),
  street and wide shots at night, load times cold and from the cache; plus
  Calgary from the worldwide tiles alone (`scripts/omt_fixture.py calgary`
  writes OpenMapTiles-style tiles from Overture for that, since a sandbox may
  not reach OpenFreeMap). For the before/after of a region: `python
  scripts/omt_fixture.py kr-seoul --osm-only --around <lat,lng;...> --out
  test/.omt/seoul-osm` stands in for OpenFreeMap (OpenStreetMap's buildings
  only), then `test/city.html?at=<spot>&regions=0&omt=/test/.omt/seoul-osm/tiles.json`
  is the map without the region; `--ovt test/.omt/seoul-ovt.pmtiles` also
  writes Overture-schema building tiles for trying `?ovt=`.
- `node test/city_shots.mjs <dir> [--phone]`: the city-only mode per baked
  area, and what a frame at the map's zoom draws against the budget
  (`--phone`: the main thread slowed 4×).
