// Test stub for web/avatar4.js: the party test pages draw players without
// 3D (charsprite.js falls back to its pixel figure when there's no renderer).
export { normalizeAvatar4 as normalizeAvatar, SKIN4_RGB as SKIN_RGB, HAIR4_RGB as HAIR_RGB, PART_OPTIONS4, DEFAULT_AVATAR4 } from "../../web/items4.js";
export const avatarThumb = () => "";
// (what the real map, web/world3d.js, imports: the specs load it for its sun, never draw a character)
export const makeHumanCharacter = () => null, makeHumanCharacterSync = () => null, loadHumanTemplate = async () => {}, makeAnimatedCharacter = () => null;
