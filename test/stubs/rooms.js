// Test stub for web/rooms.js — party.js only needs the signed-in identity
// and the "one lobby at a time" hooks. Identity comes from ?me=<handle>.
const handle = new URLSearchParams(location.search).get("me") || "tester";
export const rooms = {
  me: { id: `u-${handle}`, handle, avatar: {} },
  onBeforeJoin: null,
  async leave() {},
};
