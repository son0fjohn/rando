#!/usr/bin/env bash
# Pull Side Quest's 3D wizard (v3, see docs/wizard_assets.md) into
# web/models/wizard/wizard.glb, shrunk for phones: textures down to 1024 px
# WebP (the toon shader only reads the base color), geometry untouched.
#
# Needed because the dev sandbox's network policy blocks the Higgsfield asset
# CDN. Run from anywhere with network access; needs curl and node (npx).
# Then: node test/wizard3d_shots.mjs <dir> --model=3d, and set
# SIDEQUEST.WIZARD_3D: true in web/hpconfig.js.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../web/models/wizard"
URL="https://d8j0ntlcm91z4.cloudfront.net/user_3Ei5h1HOK7Uxrcue448ZmRc0GqQ/hf_20261022_062556_eb724420-a625-495f-b149-1c692d4d8ea5.glb"
SHA="c633f73460a5d36d31da5c4d7421ee5dd1789046500fb39b956a43007884c8eb"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"
curl -fsS -o "$TMP/raw.glb" "$URL"
echo "$SHA  $TMP/raw.glb" | sha256sum -c -
npx -y @gltf-transform/cli@4 optimize "$TMP/raw.glb" "$OUT/wizard.glb" \
  --compress false --simplify false --texture-compress webp --texture-size 1024
ls -l "$OUT/wizard.glb"
