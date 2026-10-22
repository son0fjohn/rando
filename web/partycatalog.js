// The six house-party games, in play order.
//
// Each entry is { id, title, blurb, minPlayers, maxPlayers, length, start(ctx) }.
// `start` gets the ctx party.js builds (room, me, humans, seed, isHost, party,
// onEnd) and is expected to drive its own HostGame.
//
// The party's vibe is a LABEL ONLY this pass — it does not filter this list.
// Every game is offered to every party; the host picks.
import { ART_GALLERY } from "./artgallery.js";
import { SECRET_DIARY } from "./hpgames/secretdiary.js";
import { MASK_OFF } from "./hpgames/maskoff.js";
import { HUMILIATION_RITUAL } from "./hpgames/ritual.js";
import { SIDE_QUEST } from "./hpgames/sidequest.js";
import { MANHUNT_GAME } from "./hpgames/manhunt.js";

export const PARTY_CATALOG = [
  SECRET_DIARY,
  MASK_OFF,
  HUMILIATION_RITUAL,
  SIDE_QUEST,
  ART_GALLERY,
  MANHUNT_GAME,
];

export const gameById = id => PARTY_CATALOG.find(g => g.id === id) ?? null;
export const gameTitle = id => gameById(id)?.title ?? id;
