// The avatar4 wardrobe's rules, no browser: eye shapes, item metadata, and
// combinations that can't be worn together (blocks).
//   node test/wardrobe.mjs
import { ITEMS4, EYE_SHAPES, EYE_NAMES, LAYER4, PART_OPTIONS4, SLOTS4, normalizeAvatar4, randomAvatar4, clash4 } from "../web/items4.js";

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };

ok(EYE_SHAPES.length >= 16 && EYE_SHAPES.every(e => EYE_NAMES[e]), `${EYE_SHAPES.length} eye shapes, each with a name`);
ok(new Set(EYE_SHAPES).size === EYE_SHAPES.length, "no eye shape twice");
ok(EYE_SHAPES.every(e => normalizeAvatar4({ eyes: e }).eyes === e), "a saved look keeps any eye shape");

const HIDES = new Set(["tee", "shorts", "arms", "legs", "ears", "below", "above"]);
const items = Object.entries(ITEMS4);
ok(items.every(([, d]) => LAYER4[d.cat] != null), "every item's slot has a layer");
ok(items.every(([, d]) => Object.keys(d.hides ?? {}).every(k => HIDES.has(k))), "every item only hides known body parts");
ok(items.every(([, d]) => (d.hidesHair ?? []).every(h => ITEMS4[h]?.cat === "hair")), "hidesHair lists hairstyles");
ok(items.every(([id, d]) => (d.blocks ?? []).every(b => ITEMS4[b] && ITEMS4[b].cat !== d.cat)), "blocks name items in other slots");
ok(!items.some(([, d]) => "hairCut" in d), "no item uses the old hairCut line (hat hair is fitted)");

// a block works both ways, and saved / random looks never carry one
const hat = "earmuffs", hair = "afro-puff";
const saved = ITEMS4[hat].blocks;
ITEMS4[hat].blocks = [hair];
ok(clash4({ head: hat }, "hair", hair) === hat, "a hair that doesn't fit with the hat on: clash4 names the hat");
ok(clash4({ hair }, "head", hat) === hair, "…and the other way round");
ok(clash4({ head: hat }, "hair", "buzz") === null, "anything else fits");
ok(normalizeAvatar4({ head: hat, hair }).hair === "none" || normalizeAvatar4({ head: hat, hair }).head === "none", "a saved look with a clash drops one of the two");
let rnd = 0;
for (let i = 0; i < 2000; i++) { const a = randomAvatar4(Math.random, () => true); if (SLOTS4.some(s => a[s] !== "none" && clash4(a, s, a[s]))) rnd++; }
ok(rnd === 0, `random looks never clash (${rnd} of 2000)`);
ITEMS4[hat].blocks = saved;
ok(PART_OPTIONS4.eyes.length === EYE_SHAPES.length, "the Style screen lists every eye shape");

console.log(`\n${fails ? fails + " failed" : "all passed"}`);
process.exit(fails ? 1 : 0);
