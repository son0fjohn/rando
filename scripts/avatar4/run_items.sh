#!/bin/bash
# Cut every item in items.manifest out of its 3D figure and fit it to the
# base. Needs the figures (Tripo glbs, named by their source id) in $FIGS and
# the rigged base; dev tools: npm i --no-save @gltf-transform/core
# @gltf-transform/functions @gltf-transform/extensions meshoptimizer sharp
#   FIGS=/path/to/figures BASE=web/avatar4/base.glb OUT=web/avatar4/items scripts/avatar4/run_items.sh [only-file]
set -e
cd "$(dirname "$0")"
: "${FIGS:?set FIGS}"; BASE=${BASE:-../../web/avatar4/base.glb}; OUT=${OUT:-../../web/avatar4/items}
grep -v '^#' items.manifest | while read -r src cat file tgt rest; do
  [ -n "$1" ] && [ "$1" != "$file" ] && continue
  env $rest node --max-old-space-size=6000 item4.mjs "$FIGS/$src.glb" "$BASE" "$cat" "$OUT/$file.glb" "$tgt"
done
