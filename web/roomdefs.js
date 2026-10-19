// Party room layouts, one per vibe backdrop (web/lobbies/*.png, 752x1344).
// All numbers are backdrop pixels; hplobby.js scales them to the screen.
//
//   walk      the floor rectangle feet may stand in
//   block     furniture footprints feet can't enter (pathfinding goes around)
//   front     tall props drawn OVER anyone standing behind them: a slice of
//             the backdrop re-drawn above the people layer, sorted by `base`
//             (the y where the prop meets the floor)
//   door      where people appear when they join
//   tv        where the TV prop stands, and `at`, the spot you walk to
//             before the game picker opens
export const ROOM_W = 752, ROOM_H = 1344;

export const ROOMS = {
  chill: {
    walk: { x0: 40, y0: 300, x1: 715, y1: 1195 },
    block: [
      [0, 0, 752, 315],           // back counter, door wall
      [575, 230, 650, 330],       // potted tree
      [0, 380, 150, 625],         // window bench
      [20, 545, 95, 665],         // plant by the bench
      [640, 440, 752, 670],       // sideboard
      [125, 560, 300, 630], [450, 560, 625, 630],     // tables + chairs, row 1
      [90, 745, 285, 815], [485, 745, 675, 815],      // row 2
      [80, 935, 275, 1015], [470, 935, 665, 1015],    // row 3
      [655, 860, 728, 945],       // plant, right
      [40, 1110, 132, 1200], [615, 1110, 708, 1200],  // plants, front corners
    ],
    front: [
      { r: [125, 520, 300, 640], base: 630 }, { r: [450, 520, 625, 640], base: 630 },
      { r: [90, 700, 285, 820], base: 815 }, { r: [485, 700, 675, 820], base: 815 },
      { r: [80, 890, 275, 1020], base: 1015 }, { r: [470, 890, 665, 1020], base: 1015 },
      { r: [645, 810, 730, 948], base: 945 },
      { r: [40, 1050, 135, 1205], base: 1200 }, { r: [610, 1050, 710, 1205], base: 1200 },
      { r: [20, 545, 95, 668], base: 665 },
    ],
    door: [500, 340],
    tv: { x: 300, y: 300, at: [300, 360] },
  },
  chaotic: {
    walk: { x0: 30, y0: 330, x1: 735, y1: 1320 },
    block: [
      [0, 0, 752, 335],           // back wall
      [100, 280, 415, 445],       // stage
      [0, 0, 45, 1000],           // left wall
      [535, 430, 752, 980],       // the bar
      [485, 495, 570, 935],       // bar stools
      [0, 445, 235, 935],         // tables + stools, left
      [0, 950, 75, 1095],         // plant
      [0, 1115, 205, 1344],       // table, front left
      [565, 1050, 752, 1235],     // table, front right
    ],
    front: [
      { r: [480, 490, 572, 940], base: 935 },
      { r: [0, 440, 240, 940], base: 935 },
      { r: [0, 945, 78, 1098], base: 1095 },
      { r: [0, 1110, 210, 1344], base: 1344 },
      { r: [560, 1045, 752, 1240], base: 1235 },
    ],
    door: [515, 365],
    tv: { x: 265, y: 345, at: [280, 480] },
  },
  sporty: {
    walk: { x0: 60, y0: 560, x1: 700, y1: 1300 },
    block: [
      [0, 0, 752, 565],           // trees, the hill
      [70, 575, 325, 655],        // pull-up bars
      [340, 520, 490, 615],       // bench, back
      [30, 595, 110, 740],        // fountain
      [400, 640, 705, 840],       // parallel bars
      [40, 745, 325, 950],        // bench press
      [405, 870, 645, 1130],      // shoulder press
      [70, 1025, 360, 1305],      // leg machine
      [455, 1120, 630, 1285],     // bench, front
      [0, 560, 60, 1344], [700, 560, 752, 1344],    // bushes, rocks
    ],
    front: [
      { r: [70, 420, 330, 660], base: 655 },
      { r: [30, 595, 110, 742], base: 740 },
      { r: [400, 630, 705, 845], base: 840 },
      { r: [40, 740, 325, 955], base: 950 },
      { r: [405, 860, 645, 1135], base: 1130 },
      { r: [70, 1020, 360, 1310], base: 1305 },
      { r: [455, 1115, 630, 1290], base: 1285 },
    ],
    door: [620, 600],
    tv: { x: 560, y: 565, at: [560, 612] },
  },
};
