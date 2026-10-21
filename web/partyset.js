// A house party is a SET of games (PARTY.GAMES_PER_SET, 3). This is the pure
// bookkeeping for it — no DOM, no network — so it's easy to test:
//   * each completed game becomes party points by finishing place
//     (LEADERBOARD.PLACE_POINTS; ties share a place), so games with very
//     different scoring scales count the same
//   * the leaderboard is the running total per player across the set
//   * a game that didn't complete (cut short, not enough players) isn't
//     added at all: it doesn't count toward the 3 and earns nothing
// The host owns the set and shares it in its party meta; everyone renders it.
import { PARTY, LEADERBOARD } from "./hpconfig.js";

export const newSet = (no = 1, session = null) => ({ no, session, games: [], done: false });

// finishing places for one game's results: [{ id, place }] — 1 is best;
// equal scores share a place; bots are left out (they never earn anything)
export function places(results) {
  const ps = (results?.players ?? []).filter(p => !p.bot && !p.gone).slice().sort((a, b) => b.score - a.score);
  let place = 0, prev = null;
  return ps.map((p, i) => { if (p.score !== prev) { place = i + 1; prev = p.score; } return { id: p.id, handle: p.handle, score: p.score, place }; });
}

// party points per player for one game
export function placePoints(results) {
  const T = LEADERBOARD.PLACE_POINTS;
  return Object.fromEntries(places(results).map(p => [p.id, T[Math.min(p.place, T.length) - 1]]));
}

// add a finished game to the set (the host does this). Returns a new set.
export function addGame(set, gameId, results) {
  if (!results?.completed || set.done) return set;
  const pp = placePoints(results);
  const handles = Object.fromEntries((results.players ?? []).map(p => [p.id, p.handle]));
  const games = [...set.games, { idx: set.games.length + 1, game: gameId, points: pp, places: places(results).map(p => ({ id: p.id, place: p.place })), handles }];
  return { ...set, games, done: games.length >= PARTY.GAMES_PER_SET };
}

// the leaderboard: [{ id, handle, total, last }] best first; `last` is what
// the most recent game added (for the ticking animation)
export function standings(set, members = []) {
  const rows = new Map();
  for (const m of members) rows.set(m.id, { id: m.id, handle: m.handle, avatar: m.avatar, total: 0, last: 0, here: true });
  set.games.forEach((g, gi) => {
    for (const [id, pts] of Object.entries(g.points)) {
      const r = rows.get(id) ?? { id, handle: g.handles[id] ?? "someone", total: 0, last: 0, here: false };
      r.total += pts;
      if (gi === set.games.length - 1) r.last = pts;
      rows.set(id, r);
    }
  });
  return [...rows.values()].sort((a, b) => b.total - a.total || a.handle.localeCompare(b.handle));
}

// players who were in every game of the set (the host reward needs 4+)
export function fullParticipants(set) {
  if (!set.games.length) return [];
  const sets = set.games.map(g => new Set(Object.keys(g.points)));
  return [...sets[0]].filter(id => sets.every(s => s.has(id)));
}

// "Game 2 of 3": the number of the game being picked / played next
export const nextGameNo = set => Math.min(set.games.length + 1, PARTY.GAMES_PER_SET);
