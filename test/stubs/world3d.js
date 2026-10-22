// Test stub for web/world3d.js — party.js reads the player position and
// pauses the map while the party room covers it; partybeacon.js needs a
// frame and a camera to draw beacons (no frame here, so it draws nothing).
export const world3d = { player: null, frame: null, camera: null, tickHooks: [], setPaused() {} };
export function geoPos() { return { x: 0, y: 0, z: 0, clone() { return { ...this }; } }; }
