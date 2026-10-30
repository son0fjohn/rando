// One fake "server" for several browser contexts (the multiplayer suite,
// test/mp/). Normally the offline stub (supabase.js) keeps its tables in the
// page and its coin + notes state in the context's IndexedDB, so only tabs
// of ONE browser context share them. test/mp/ gives every phone its own
// context (its own guest session, storage and geolocation) and exposes
// window.__mpdb, a binding into the test runner, which holds the state for
// all of them.
//
//   mpShared.tx(st => …)   st = { coins, tables: { presence, public_messages, profiles } }
//                          runs fn on a copy of the shared state and writes
//                          it back if it changed; if another phone wrote in
//                          between, it runs again on the new state (like a
//                          serializable transaction: no lock is held while a
//                          slow page thinks)
//   (no __mpdb: mpShared is null and supabase.js works as it always has)
//
// A phone the runner has cut off (a dropped connection) gets an error back,
// as a phone with no network would.
export const SHARED_TABLES = ["presence", "public_messages", "profiles"];

export const mpShared = typeof window.__mpdb === "function" ? {
  async tx(fn) {
    for (let i = 0; i < 40; i++) {
      const { version, state, offline } = await window.__mpdb("get");
      if (offline) throw Object.assign(new Error("Failed to fetch"), { offline: true });
      const before = JSON.stringify(state);
      const out = await fn(state);
      if (JSON.stringify(state) === before) return out;       // read only: nothing to write
      const r = await window.__mpdb("put", { version, state });
      if (r?.offline) throw Object.assign(new Error("Failed to fetch"), { offline: true });
      if (r?.ok) return out;
      await new Promise(res => setTimeout(res, 20 + Math.random() * 80 * (i + 1)));   // someone wrote first: again
    }
    throw new Error("the server is busy");
  },
} : null;
