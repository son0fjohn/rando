#!/usr/bin/env bash
# Pull the four generated house-party assets into web/games/ and downscale
# them to shipping sizes. Run from anywhere; paths are resolved from this file.
#
# Needed because the build sandbox's egress policy blocks the Higgsfield asset
# CDN (403 at CONNECT), so the images could not be committed from there.
# Requires: curl, python3 with Pillow.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "$HERE/../../web" && pwd)"
RAW="$HERE/raw"
U="https://d8j0ntlcm91z4.cloudfront.net/user_3Ei5h1HOK7Uxrcue448ZmRc0GqQ"

mkdir -p "$RAW" "$WEB/games/mission" "$WEB/games/manhunt" "$WEB/games/ritual"

get () { # get <remote-name> <local-name>
  if [ ! -s "$RAW/$2" ]; then
    echo "fetching $2"
    curl -fsS -o "$RAW/$2" "$U/$1"
  fi
}

get hf_20261003_044027_8ebbe168-6ffc-48ac-89dc-3712706d744a.png mission-card.png
get hf_20261003_044028_b134e086-90c9-4100-9e30-cf7bc0cdb710.png radar.png
get hf_20261003_044027_e4873a39-2e2e-41e9-a957-048a6b609abf.png bomb.png
get hf_20261003_044028_b418264a-bbf8-48fa-ad2e-975e58e60fa4.png ritual-stage.png

python3 - "$RAW" "$WEB" <<'PY'
import sys
from PIL import Image
raw, web = sys.argv[1], sys.argv[2]

def jpg(src, dst, width, q=74):
    im = Image.open(f"{raw}/{src}").convert("RGB")
    h = round(im.height * width / im.width)
    im.resize((width, h), Image.LANCZOS).save(f"{web}/{dst}", "JPEG", quality=q, optimize=True, progressive=True)
    print(dst, f"{width}x{h}")

# backgrounds: sized for a ~420 px panel at 2x, under a dark scrim
jpg("mission-card.png", "games/mission/card.jpg", 840)
jpg("ritual-stage.png", "games/ritual/stage.jpg", 840)
jpg("radar.png",        "games/manhunt/radar.jpg", 720)

# bomb: trimmed to its alpha, square, 128 px (displayed at 26 px CSS)
im = Image.open(f"{raw}/bomb.png").convert("RGBA")
im = im.crop(im.getchannel("A").getbbox())
s = 128 / max(im.size)
im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
out = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
out.paste(im, ((128 - im.width) // 2, (128 - im.height) // 2))
out.save(f"{web}/games/manhunt/bomb.png", optimize=True)
print("games/manhunt/bomb.png 128x128")
PY

echo
echo "done. now LOOK at them — all four are still unreviewed:"
echo "  $WEB/games/mission/card.jpg      (must have no baked-in text)"
echo "  $WEB/games/ritual/stage.jpg      (must be an empty stage)"
echo "  $WEB/games/manhunt/radar.jpg     (must be an empty screen)"
echo "  $WEB/games/manhunt/bomb.png      (must have clean alpha, no shadow)"
