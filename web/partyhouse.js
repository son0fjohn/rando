// A public party's house on the map: the pure parts (no three.js, so the
// specs and the bots read them). partybeacon.js draws it; party.js announces
// it and opens its card.
//
// What a public party announces (announceFor) is all anyone else ever learns
// about it from the map: its name, vibe, cap and count, whether it's in the
// lobby or which game and round is on, the host's name and look (the same
// look presence already shows on the map), and the host's presence ZONE (the
// on-device zone snap: a launch zone or a ~2 km cell). Never the host's
// position, an address or a guest. Each phone stands the host's character at
// that zone's centre plus a fixed offset from the party id (beaconSpot) and
// floats the house over their head. A private party announces nothing.
import { normalizeAvatar4 } from "./items4.js";

export function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// where a party's host stands on everyone's map: in the zone's plaza, where
// presence puts people (its centre), nudged 15-35 m (any direction) by the
// party id so two parties in one zone don't stack. The same on every phone,
// and derived from public things only (the zone's own centre and the party
// id): never where the host really is.
export const SPOT_M = [15, 35];
export function beaconSpot(zone, partyId) {
  const h = hash(partyId);
  const ang = (h % 360) * Math.PI / 180, m = SPOT_M[0] + ((h >>> 9) % (SPOT_M[1] - SPOT_M[0] + 1));
  const dLat = Math.cos(ang) * m / 110540, dLng = Math.sin(ang) * m / (111320 * Math.cos(zone.lat * Math.PI / 180));
  return { lat: zone.lat + dLat, lng: zone.lng + dLng };
}

// which round of the running game, from the host's game state: the turn
// (Side Quest, the Ritual, Mask Off) or the question (Secret Diary); none
// while it's being set up or explained, at its results, or for a game
// without rounds (Manhunt)
export function roundOf(s) {
  if (!s || ["setup", "howto", "end", "deal", "rules"].includes(s.phase)) return null;
  const i = Number.isFinite(s.ti) ? s.ti : Number.isFinite(s.qi) ? s.qi : null;
  return i == null ? null : i + 1;
}

// the host's directory announce for a public party (null: nothing to say).
// `c` is party.js's current party; `me` the host ({ id, handle, avatar }).
export function announceFor(c, me) {
  if (!c || c.meta?.privacy !== "public") return null;
  const playing = !!c.launched;
  const z = c.zone;
  return {
    id: c.room.id, kind: "party", privacy: "public",
    hostId: me.id, hostName: me.handle, look: normalizeAvatar4(me.avatar ?? {}),
    name: c.meta.name, vibe: c.meta.vibe, cap: c.meta.cap, count: c.room.members.length,
    state: playing ? "playing" : "lobby",
    game: playing ? c.playingId ?? null : null,
    round: playing ? roundOf(c.ctx?.hostGame?.s) : null,
    zone: z && Number.isFinite(+z.lat) && Number.isFinite(+z.lng) ? { id: z.id, lat: +z.lat, lng: +z.lng } : null,
  };
}

// the directory's list -> the houses to draw: public parties with a zone,
// one per host (their newest announce), each keyed by party AND host, so a
// hand-off to a new host is the old house going and the new one arriving
export function housesFrom(list) {
  const byHost = new Map();
  for (const r of list ?? []) {
    if (r?.kind !== "party" || r.privacy !== "public" || r.gone || !r.hostId) continue;
    if (!r.zone || !Number.isFinite(+r.zone.lat) || !Number.isFinite(+r.zone.lng)) continue;
    const prev = byHost.get(r.hostId);
    if (!prev || (r.seenAt ?? 0) >= (prev.seenAt ?? 0)) byHost.set(r.hostId, r);
  }
  return [...byHost.values()].map(r => ({ ...r, key: houseKey(r), full: isFull(r) }));
}
export const houseKey = r => `${r.id}|${r.hostId}`;
export const isFull = r => Number(r?.count) >= Number(r?.cap);

// what changed between the houses on screen and the new list: which pop in,
// which stay (and get updated), which pop out
export function diffHouses(shownKeys, houses) {
  const next = new Set(houses.map(h => h.key)), shown = new Set(shownKeys);
  return {
    add: houses.filter(h => !shown.has(h.key)).map(h => h.key),
    keep: houses.filter(h => shown.has(h.key)).map(h => h.key),
    remove: [...shown].filter(k => !next.has(k)),
  };
}

// the card's status line: "In lobby" / "Playing Side Quest · round 2"
export function statusText(r, t, titleOf = id => id) {
  if (r?.state !== "playing") return t("ph.lobby");
  const game = r.game ? titleOf(r.game) : null;
  if (!game) return t("ph.playingAny");
  return r.round ? t("ph.playingRound", { game, n: r.round }) : t("ph.playing", { game });
}

// joining from the map: who can. Full or already in: no. A game on: yes,
// into the lobby; they come in at the next round (a game that seats late
// joiners, `lateJoin`) or the next game.
export function joinState(r, { mine = false, lateJoin = false } = {}) {
  if (mine) return { can: false, why: "mine" };
  if (isFull(r)) return { can: false, why: "full" };
  if (r?.state === "playing") return { can: true, why: lateJoin ? "nextRound" : "nextGame" };
  return { can: true, why: null };
}
