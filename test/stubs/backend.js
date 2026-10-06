// Test stub for web/backend.js — the real one boots auth, the 3D world and a
// Supabase client from a CDN, none of which a logic test needs.

// the prompt logger inserts here. Rows land on window.__logRows; set
// window.__logFail = true to simulate the table not existing yet.
const from = () => ({
  insert: async rows => {
    if (window.__logFail) return { error: { message: "relation \"diary_prompt_log\" does not exist" } };
    (window.__logRows ??= []).push(...rows);
    return { error: null };
  },
});
export const sb = { from, channel: () => ({ on: () => {}, subscribe: () => {}, send: () => {}, track: async () => {}, presenceState: () => ({}) }), removeChannel: () => {} };

export async function readDeviceCoords() { return { lat: 0, lng: 0 }; }

export const presence = {
  // real haversine — Manhunt's zone and boundary maths depend on it
  haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = d => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },
  zones: [], myZone: null,
};
