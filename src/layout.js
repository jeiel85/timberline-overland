// Hand-placed layout of the valley: trails, the tarn, the summit knoll and the
// expedition landmarks. World units are metres; north is -z, east is +x.

export const LAKE = { x: -60, z: 110, rx: 70, rz: 50, depth: 8 };

export const KNOLL = { x: 70, z: -452, r: 70, h: 40 };

// Each trail is a Catmull-Rom spline through these points. Profiles are
// smoothed and grade-limited, then carved into the terrain.
export const TRAILS = [
  {
    id: 'main',
    width: 2.9,
    maxGrade: 0.25,
    points: [
      [25, 412], [25, 395], [40, 355], [70, 315], [80, 270], [55, 225], [20, 190], [-5, 150],
      [-8, 112], [5, 70], [30, 30], [60, -10], [50, -55], [10, -90], [-25, -120], [-50, -160],
      [-55, -195], [4, -208], [16, -219], [4, -230], [-98, -254], [-110, -265], [-98, -276],
      [0, -300], [12, -311], [0, -322], [-96, -346], [-108, -357], [-96, -368], [-40, -396],
      [-30, -415],
    ],
  },
  {
    id: 'mine',
    width: 2.5,
    maxGrade: 0.26,
    points: [[60, -10], [100, 5], [140, 22]],
  },
  {
    id: 'summit',
    width: 2.4,
    maxGrade: 0.32,
    points: [[-30, -415], [15, -405], [65, -392], [110, -410], [128, -445], [115, -475], [85, -482], [58, -472], [55, -455], [70, -452]],
  },
];

// The water in the trail across the tarn's east lobe sits this deep.
export const FORD_DEPTH = 0.35;

// pad: radius flattened for buildings (0 = leave the ground alone).
// r: discovery radius. counted: part of the expedition log.
export const LANDMARKS = [
  { id: 'basecamp', x: 36, z: 424, pad: 18, r: 20, counted: false },
  { id: 'cabin', x: -30, z: 330, pad: 10, r: 20, counted: true },
  { id: 'tarn', x: -100, z: 64, pad: 9, r: 20, counted: true },
  { id: 'mine', x: 146, z: 24, pad: 9, r: 20, counted: true },
  { id: 'larch', x: 98, z: -50, pad: 0, r: 26, counted: true },
  { id: 'gully', x: -25, z: -122, pad: 0, r: 18, counted: true },
  { id: 'hut', x: -124, z: -358, pad: 10, r: 20, counted: true },
  { id: 'col', x: -30, z: -420, pad: 11, r: 20, counted: true },
  { id: 'beacon', x: 70, z: -452, pad: 7, r: 16, counted: true },
];

// The trail section that is strewn with rocks to crawl over.
export const GULLY = { zMin: -150, zMax: -100 };

export const SPAWN = { x: 25, z: 400, heading: 0 };
