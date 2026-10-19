// Test stub for web/rooms.js — party.js only needs the signed-in identity
// and the "one lobby at a time" hooks. Identity comes from ?me=<handle>,
// the character from ?av=<url-encoded avatar3 JSON> (optional).
const q = new URLSearchParams(location.search);
const handle = q.get("me") || "tester";
let avatar = {};
try { avatar = JSON.parse(q.get("av") || "{}"); } catch {}
export const rooms = {
  me: { id: `u-${handle}`, handle, avatar },
  onBeforeJoin: null,
  async leave() {},
};
