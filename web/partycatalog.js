// The house-party games. Each entry is { id, title, blurb, minPlayers,
// maxPlayers, length, start(ctx) }. `start` gets the ctx party.js builds
// (room, me, humans, seed, isHost, party, onEnd) and drives its own HostGame.
//
// The party's vibe is a LABEL ONLY this pass — it does not filter this list.
// Every game is offered to every party; the host picks.
import { ART_GALLERY } from "./artgallery.js";
import { SECRET_DIARY } from "./hpgames/secretdiary.js";

export const PARTY_CATALOG = [
  SECRET_DIARY,
  ART_GALLERY,
];

export const gameById = id => PARTY_CATALOG.find(g => g.id === id) ?? null;
export const gameTitle = id => gameById(id)?.title ?? id;
