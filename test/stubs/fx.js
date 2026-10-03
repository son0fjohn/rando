// Test stub for web/fx.js — audio, haptics and world beacons are no-ops here.
const noop = () => {};
export const sfx = new Proxy({}, { get: () => noop });
export const buzz = noop;
export const flash = noop;
export const shake = noop;
export const celebrate = noop;
export const beacon = { set: noop, clear: noop };
