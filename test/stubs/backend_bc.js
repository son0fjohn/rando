// Test stub for web/backend.js that makes multiplayer REAL across browser
// tabs: a Supabase-Realtime-shaped `sb` whose channels ride on
// BroadcastChannel, so several Playwright pages in one browser context form
// an actual party — real party.js, real net.js Room, real DOM and CSS.
//
// Mirrors the surface net.js uses: channel(name, config).on("broadcast" |
// "presence", …).subscribe(cb) / track(meta) / presenceState() / send(),
// and sb.removeChannel(ch). Presence is gossip: on join you announce
// yourself, everyone already there answers with their own meta, and leave
// (explicit or on pagehide) removes you everywhere.
import { StubChannel } from "./bcchannel.js";

// the prompt logger inserts here. Rows land on window.__logRows; set
// window.__logFail = true to simulate the table not existing yet.
const from = () => ({
  insert: async rows => {
    if (window.__logFail) return { error: { message: "relation \"diary_prompt_log\" does not exist" } };
    (window.__logRows ??= []).push(...rows);
    return { error: null };
  },
});
export const sb = {
  from,
  channel: (name, cfg) => new StubChannel(name, cfg),
  removeChannel: ch => ch.close(),
};

export async function readDeviceCoords() { return { lat: 0, lng: 0 }; }
export const presence = {
  haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = d => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },
  zones: [], myZone: null,
};
