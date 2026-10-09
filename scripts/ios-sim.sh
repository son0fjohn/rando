#!/usr/bin/env bash
# Play a house party on several iOS Simulators at once — macOS + Xcode only.
#
# Each simulator is its own iPhone running real Mobile Safari, and the app
# signs each one in as its own guest automatically, so N simulators = N
# players with no phone numbers needed.
#
#   scripts/ios-sim.sh up [N] [URL]   create/boot N iPhones ("Rando 1".."Rando N"), open URL in each
#                                     (default N=3, URL=https://randoirl.vercel.app/)
#   scripts/ios-sim.sh join CODE [URL] open the party invite link in phones 2..N
#                                     (throw the party on "Rando 1", then join the rest)
#   scripts/ios-sim.sh open URL       open URL in every Rando phone
#   scripts/ios-sim.sh where LAT,LNG  set every phone's GPS near LAT,LNG (spread ~40 m apart) — Manhunt
#   scripts/ios-sim.sh shot [DIR]     screenshot every Rando phone (default DIR=sim-shots)
#   scripts/ios-sim.sh down           shut the Rando phones down
#   scripts/ios-sim.sh delete         delete them
#
# Testing local changes instead of production:
#   npm run serve                      # http://localhost:8743 on the Mac
#   scripts/ios-sim.sh up 3 http://localhost:8743/
# (inside a simulator, localhost is the Mac.)
#
# Env: DEVICE="iPhone 16" to pick the model (default: newest base iPhone installed).
set -euo pipefail

command -v xcrun >/dev/null || { echo "needs macOS with Xcode (xcrun not found)"; exit 1; }

PROD="https://randoirl.vercel.app/"
PREFIX="Rando"

# newest base-model iPhone type available, unless DEVICE is set
device_type() {
  if [ -n "${DEVICE:-}" ]; then echo "$DEVICE"; return; fi
  xcrun simctl list devicetypes | grep -E '^iPhone [0-9]+ \(' | tail -1 | sed -E 's/ \(.*$//'
}

# UDID of the simulator named "$PREFIX $1", or empty
udid() {
  xcrun simctl list devices | grep -F "    $PREFIX $1 (" | head -1 | grep -Eo '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}' || true
}

# every existing Rando phone, in order
all_udids() {
  xcrun simctl list devices | grep -E "^    $PREFIX [0-9]+ \(" | sort -t' ' -k6 -n \
    | grep -Eo '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}'
}

booted() { xcrun simctl list devices booted | grep -q "$1"; }

up() {
  local n="${1:-3}" url="${2:-$PROD}" type
  type="$(device_type)"
  [ -n "$type" ] || { echo "no iPhone simulator types installed — open Xcode > Settings > Components and add an iOS runtime"; exit 1; }
  open -a Simulator
  for i in $(seq 1 "$n"); do
    local id; id="$(udid "$i")"
    if [ -z "$id" ]; then
      echo "creating $PREFIX $i ($type)"
      id="$(xcrun simctl create "$PREFIX $i" "$type")"
    fi
    if ! booted "$id"; then echo "booting $PREFIX $i"; xcrun simctl boot "$id"; fi
    xcrun simctl bootstatus "$id" -b >/dev/null
    xcrun simctl openurl "$id" "$url"
  done
  echo "up: $n phones on $url"
  echo "next: throw a party on '$PREFIX 1', then: scripts/ios-sim.sh join <CODE>${2:+ $url}"
}

join() {
  local code="${1:?usage: ios-sim.sh join CODE [URL]}" url="${2:-$PROD}" i=0
  case "$url" in *\?*) url="$url&party=$code" ;; *) url="$url?party=$code" ;; esac
  for id in $(all_udids); do
    i=$((i + 1))
    [ "$i" -eq 1 ] && continue          # phone 1 is the host
    if booted "$id"; then xcrun simctl openurl "$id" "$url"; echo "phone $i -> $url"; fi
  done
}

open_all() {
  local url="${1:?usage: ios-sim.sh open URL}"
  for id in $(all_udids); do if booted "$id"; then xcrun simctl openurl "$id" "$url"; fi; done
}

where() {
  local ll="${1:?usage: ios-sim.sh where LAT,LNG}" i=0
  local lat="${ll%,*}" lng="${ll#*,}"
  for id in $(all_udids); do
    booted "$id" || continue
    # ~40 m apart going east (0.0005 deg of longitude is roughly 35-55 m)
    local plng; plng="$(awk -v a="$lng" -v k="$i" 'BEGIN { printf "%.6f", a + k * 0.0005 }')"
    xcrun simctl location "$id" set "$lat,$plng"
    echo "phone $((i + 1)) at $lat,$plng"
    i=$((i + 1))
  done
}

shot() {
  local dir="${1:-sim-shots}" i=0
  mkdir -p "$dir"
  for id in $(all_udids); do
    i=$((i + 1))
    booted "$id" || continue
    xcrun simctl io "$id" screenshot "$dir/phone-$i.png" >/dev/null
    echo "$dir/phone-$i.png"
  done
}

down()   { for id in $(all_udids); do if booted "$id"; then xcrun simctl shutdown "$id"; fi; done; echo "down"; }
delete() { down; for id in $(all_udids); do xcrun simctl delete "$id"; done; echo "deleted"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  up) up "$@" ;;
  join) join "$@" ;;
  open) open_all "$@" ;;
  where) where "$@" ;;
  shot) shot "$@" ;;
  down) down ;;
  delete) delete ;;
  *) sed -n '2,25p' "$0"; exit 1 ;;
esac
