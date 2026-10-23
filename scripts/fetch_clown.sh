#!/usr/bin/env bash
# Pull Humiliation Ritual's 3D clown (see docs/clown_assets.md) into
# web/models/clown/clown.glb, shrunk for phones: textures down to 1024 px
# WebP (the toon shader only reads the base color), geometry untouched.
# Needs curl and node (npx), and network access to the Higgsfield asset CDN.
# Then: node test/clown3d_shots.mjs <dir>
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../web/models/clown"
URL="https://d8j0ntlcm91z4.cloudfront.net/user_3Ei5h1HOK7Uxrcue448ZmRc0GqQ/hf_20261023_030749_134d9756-dcd9-456e-9673-8ffa126786ea.glb"
SHA="70986540ed32c1201ee0b0bda8d8c23e77adf09550b028179ebd355baa03a2f8"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"
curl -fsS -o "$TMP/raw.glb" "$URL"
echo "$SHA  $TMP/raw.glb" | sha256sum -c -
npx -y @gltf-transform/cli@4 optimize "$TMP/raw.glb" "$OUT/clown.glb" \
  --compress false --simplify false --texture-compress webp --texture-size 1024
ls -l "$OUT/clown.glb"
