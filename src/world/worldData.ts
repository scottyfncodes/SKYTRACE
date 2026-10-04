/**
 * Handcrafted layout of the Varrow Basin. Everything here is plain data so the
 * terrain, the simulation and the tests all share one source of truth.
 *
 * Coordinates: x grows east, z grows south (Three.js -Z is north). Metres.
 */
export const WORLD_HALF = 1200; // world spans [-1200, 1200] on both axes
export const WORLD_SIZE = WORLD_HALF * 2;
export const WATER_LEVEL = 0;
export const GRID_CELL = 200; // intelligence grid cell size (A1..L12)

export type Pt = readonly [number, number];

export const BASE = { x: -820, z: 760, heading: -Math.PI / 2 /* yaw facing east: forward = (-sin yaw, -cos yaw) */ } as const;
export const RUNWAY = { x1: -930, x2: -690, z: 760, width: 26 } as const;

/** Flat regions blended into the terrain. */
export const FLATS: ReadonlyArray<{ x: number; z: number; r: number; blend: number; lift?: number }> = [
  { x: BASE.x, z: BASE.z, r: 170, blend: 120 },
  { x: -350, z: 650, r: 120, blend: 90 }, // village
  { x: 720, z: 380, r: 130, blend: 90 }, // quarry
  { x: 240, z: -170, r: 70, blend: 50 }, // forest clearing
  { x: 520, z: 500, r: 28, blend: 22 }, // dock
  { x: 680, z: -420, r: 45, blend: 50 }, // mine portal
  { x: -120, z: -640, r: 30, blend: 30 }, // tower
  { x: -600, z: 150, r: 50, blend: 40 }, // standing stones
];

export const RIDGE: readonly Pt[] = [
  [-1300, -430],
  [-700, -520],
  [-300, -600],
  [100, -700],
  [700, -860],
  [1300, -950],
];

export const RIVER: readonly Pt[] = [
  [-1300, -420],
  [-1050, -330],
  [-750, -180],
  [-480, 20],
  [-250, 160],
  [-50, 240],
  [150, 330],
  [450, 520],
  [750, 700],
  [1000, 800],
  [1300, 880],
];

export const LAKE = { x: -850, z: 250, r: 130 } as const;

/** Forest blobs (centre, radius, strength). */
export const FORESTS: ReadonlyArray<{ x: number; z: number; r: number; s: number }> = [
  { x: 260, z: -120, r: 340, s: 1 }, // Keld Forest (hides the clearing)
  { x: 60, z: -300, r: 200, s: 0.9 },
  { x: -550, z: -250, r: 220, s: 0.7 },
  { x: -1000, z: -50, r: 200, s: 0.8 },
  { x: 950, z: 50, r: 180, s: 0.7 },
  { x: 900, z: 800, r: 220, s: 0.8 },
  { x: -300, z: 1000, r: 220, s: 0.7 },
  { x: 500, z: -1000, r: 300, s: 0.6 },
  { x: -1000, z: -1000, r: 320, s: 0.6 },
];
/** Holes punched in the forest mask. */
export const CLEARINGS: ReadonlyArray<{ x: number; z: number; r: number }> = [
  { x: 240, z: -170, r: 48 },
  { x: 680, z: -420, r: 60 },
  { x: 720, z: 380, r: 160 },
  { x: -120, z: -640, r: 40 },
];

export interface RoadDef {
  id: string;
  pts: readonly Pt[];
  width: number;
  kind: 'road' | 'track' | 'haul';
}

export const ROADS: readonly RoadDef[] = [
  {
    id: 'main',
    kind: 'road',
    width: 9,
    pts: [
      [-700, 760],
      [-520, 720],
      [-350, 650],
      [-150, 620],
      [0, 600],
      [200, 575],
      [350, 555],
      [430, 505],
      [600, 440],
      [700, 380],
    ],
  },
  {
    id: 'mine',
    kind: 'road',
    width: 7,
    pts: [
      [720, 360],
      [770, 160],
      [760, -60],
      [720, -230],
      [690, -400],
    ],
  },
  {
    id: 'haul',
    kind: 'haul',
    width: 7,
    pts: [
      [690, 340],
      [560, 190],
      [430, 30],
      [330, -90],
      [255, -160],
    ],
  },
  {
    id: 'foresttrack',
    kind: 'track',
    width: 5,
    pts: [
      [245, -150],
      [255, 10],
      [320, 160],
      [410, 330],
      [455, 460],
      [520, 495],
    ],
  },
  {
    id: 'dockspur',
    kind: 'track',
    width: 5,
    pts: [
      [430, 505],
      [455, 470],
    ],
  },
];

/** Segments where the vehicle is under tree canopy or inside the mine. */
export const TRUCK_ROUTE: ReadonlyArray<{ p: Pt; wait?: number; hidden?: boolean }> = [
  { p: [690, -412], wait: 28, hidden: true }, // inside the adit
  { p: [720, -230] },
  { p: [760, -60] },
  { p: [770, 160] },
  { p: [720, 360] },
  { p: [690, 340] },
  { p: [560, 190] },
  { p: [430, 30], hidden: true }, // under canopy
  { p: [330, -90], hidden: true },
  { p: [250, -150], wait: 18, hidden: true }, // at the shed
  { p: [255, 10], hidden: true },
  { p: [320, 160] },
  { p: [410, 330] },
  { p: [455, 460] },
  { p: [520, 495], wait: 18 }, // dock
  { p: [455, 460] },
  { p: [430, 505] },
  { p: [600, 440] },
  { p: [700, 380] },
  { p: [770, 160] },
  { p: [760, -60] },
  { p: [720, -230] },
];
export const TRUCK_SPEED = 13; // m/s

export const VILLAGE_HOUSES: readonly Pt[] = [
  [-400, 620],
  [-370, 680],
  [-330, 610],
  [-300, 670],
  [-350, 710],
  [-420, 690],
  [-280, 630],
];

/** Convert a world position into the intelligence grid reference, e.g. "F-7". */
export function gridRef(x: number, z: number): string {
  const cols = 'ABCDEFGHIJKL';
  const cx = Math.max(0, Math.min(11, Math.floor((x + WORLD_HALF) / GRID_CELL)));
  const cz = Math.max(0, Math.min(11, Math.floor((z + WORLD_HALF) / GRID_CELL)));
  return `${cols[cx]}-${cz + 1}`;
}
