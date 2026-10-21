// Random-but-fair turn picking (Side Quest, Humiliation Ritual). Pure: the
// host keeps the weights in the game state and passes the rng.
//   * everyone starts at PICKER.START
//   * picked: their weight drops to PICKER.FLOOR (never 0)
//   * not picked: their weight grows by PICKER.GROW
// So the longer someone waits, the likelier they're next.
import { PICKER } from "./hpconfig.js";

// ids: who can be picked now (present players). Returns { id, weights } —
// a fresh weights object; ids missing from it start at START.
export function fairPick(weights, ids, rng, { start = PICKER.START, grow = PICKER.GROW, floor = PICKER.FLOOR } = {}) {
  const w = { ...(weights ?? {}) };
  for (const id of ids) if (!(w[id] > 0)) w[id] = start;
  if (!ids.length) return { id: null, weights: w };
  const total = ids.reduce((a, id) => a + w[id], 0);
  let r = rng() * total, id = ids[ids.length - 1];
  for (const x of ids) { r -= w[x]; if (r < 0) { id = x; break; } }
  for (const x of ids) w[x] = x === id ? floor : w[x] + grow;
  return { id, weights: w };
}

// each id's chance of being picked next, for tests and the curious
export function chances(weights, ids, { start = PICKER.START } = {}) {
  const w = ids.map(id => (weights?.[id] > 0 ? weights[id] : start));
  const t = w.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(ids.map((id, i) => [id, w[i] / t]));
}
