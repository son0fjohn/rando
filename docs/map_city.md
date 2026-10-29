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
- **Anywhere else**: the procedural city, centred where you are. It
  re-centres when you go more than 2.5 km from its origin.
- The spot is the player's (presence) or Explore's (read on the phone, only
  if location is allowed; never sent). While the start screen is up the
  world is held on Itaewon (its still image is Itaewon) and catches up when
  it closes.
- `?city=tiles` is the old city-only mode (Manhunt's zones, tests); `?blend=0`
  turns the Itaewon blend off.

## Data

1. **The baked archive** (`web/tiles/cities.pmtiles`, ~1.6 MB): z16 chunks
   for the areas in `scripts/city_areas.json` (Itaewon, Hongdae, Gangnam,
   Yeonhui, Busan Haeundae, Tokyo Shibuya, Jamsil, COEX, Namsan, downtown
   Calgary, downtown Edmonton). Built by `scripts/fetch_overture.py` (Overture
   Maps on S3: OpenStreetMap + Microsoft / Google footprints, anonymous, no
   key) and `scripts/bake_city_tiles.py`. In Korea the official building
   registry wins for Itaewon. Add an area: a line in `city_areas.json`, then
   `python scripts/fetch_overture.py --only <id>` and
   `python scripts/bake_city_tiles.py`.
2. **Anywhere else: OpenFreeMap** (`web/cityomt.js`, `web/mvt.js`): the free,
   worldwide OpenMapTiles vector tiles (OpenStreetMap; no key, no per-user
   cost, https://openfreemap.org). Where the archive has no chunk, the
   worker reads the z14 tile and turns it into our 16 z16 chunks: buildings
   (`render_height`; OpenMapTiles' 5 m filler counts as unknown), roads by
   class (no tunnels), water, parks, woods, grass, the names of main roads and
   of major places. A chunk at the edge of a baked area fills in what lies
   outside the area's circle from there too, so baked areas fade into the
   world instead of stopping at a ring. If the server can't be reached the
   map keeps what it has and tries again a minute later. `?omt=<TileJSON or
   {z}/{x}/{y} url>` points it elsewhere (a self-hosted copy for heavy
   traffic), `?omt=0` turns it off.
3. **Attribution** in the map's corner: "© OpenStreetMap contributors ·
   Overture Maps Foundation · OpenMapTiles" whenever the procedural city is
   on; "roads © OpenStreetMap contributors" on the hand-made map; the start
   screen has its own line.

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

- Chunks stream round the camera target: full detail within one chunk
  (≈0.5 km), walls and roofs only out to two, dropped past three; fog hides
  the edge. Built in a worker, at most two mounted per frame, nearest first
  (the near ring before the far one); a new chunk rises out of the ground
  (half a second) instead of popping.
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
  test).
- `node test/world_shots.mjs <dir>`: Gangnam, Itaewon, Itaewon's edge,
  Hongdae, Calgary, Edmonton, Lotte World Tower: a top-down shot next to a
  plan of the same square drawn from the raw data (`scripts/plan_map.py`),
  street and wide shots at night, load times cold and from the cache; plus
  Calgary from the worldwide tiles alone (`scripts/omt_fixture.py calgary`
  writes OpenMapTiles-style tiles from Overture for that, since a sandbox may
  not reach OpenFreeMap).
- `node test/city_shots.mjs <dir> [--phone]`: the city-only mode per baked
  area, and what a frame at the map's zoom draws against the budget
  (`--phone`: the main thread slowed 4×).
