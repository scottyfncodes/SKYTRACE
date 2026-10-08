/**
 * The wildfire: a living fire on a grid of cells laid over the terrain.
 *
 * Not a scientific model, a readable one. Every cell has fuel (forest burns
 * hot and fast, meadow slowly, water and bare rock not at all). A burning
 * cell heats its neighbours; the wind pushes that heat downwind, slopes pull
 * it uphill. A cell that has soaked up enough heat catches. It burns for a
 * while and leaves ash.
 *
 * What the aircraft add: retardant coats cells so the fire cannot take them
 * (a line the front stops at), and water knocks burning cells down and wets
 * the ground around them for a while. Strong wind throws embers ahead of the
 * front: spot fires.
 *
 * The question every mission asks, "can the fire still reach the town?", is
 * a flood fill from the fire through everything that can still burn. When it
 * cannot get there, the fire is contained.
 *
 * Pure and deterministic: a fixed step and a seeded random source.
 */
import { clamp } from '../core/math';

export const UNBURNT = 0;
export const BURNING = 1;
export const BURNT = 2;
/** Put out by water before it burned through. */
export const OUT = 3;

/** The sim always advances in steps of this (s). */
export const FIRE_STEP = 0.25;
/** Cells per side. */
export const FIRE_N = 64;

export interface Threat {
  name: string;
  icon: string;
  x: number;
  z: number;
  /** The fire reaching any cell this close is a loss (m). */
  r: number;
}

export interface Ignition {
  x: number;
  z: number;
  r: number;
}

/** How a scenario's fire behaves. Plain data on the mission. */
export interface FireSpec {
  /** The square of ground the fire lives on: centre and side (m). */
  area: { x: number; z: number; size: number };
  ignitions: readonly Ignition[];
  threats: readonly Threat[];
  /** How quickly fire takes a neighbour (scales everything). */
  spread: number;
  /** Spot-fire chance (0: none). */
  embers: number;
  /** The fire has been burning this long when the call comes in (s). */
  head: number;
}

export interface TerrainSampler {
  height(x: number, z: number): number;
  forest(x: number, z: number): number;
}

export interface FireWind {
  /** Where the air is going (m/s, world x and z). */
  x: number;
  z: number;
}

export interface FireState {
  spec: FireSpec;
  n: number;
  /** World x, z of the grid's north-west corner and the cell size (m). */
  x0: number;
  z0: number;
  cell: number;
  height: Float32Array;
  fuel: Float32Array;
  state: Uint8Array;
  /** Unburnt: heat soaked up (catches at 1). Burning: intensity 0..1. */
  heat: Float32Array;
  /** Seconds of burning left. */
  life: Float32Array;
  retardant: Float32Array;
  wet: Float32Array;
  /** Cells that can burn at all. */
  burnable: number;
  t: number;
  /** Time not yet stepped (s). */
  acc: number;
  seed: number;
  /** Spot fires so far, newest last (world x, z, time). */
  spots: { x: number; z: number; t: number }[];
  /** Cells retardant has stopped the fire taking (counted once each). */
  held: Uint8Array;
}

// ---------------------------------------------------------------- set-up
export function fuelAt(T: TerrainSampler, x: number, z: number, step: number): number {
  const h = T.height(x, z);
  if (h < 0.5) return 0; // water
  const slope = Math.max(Math.abs(T.height(x + step, z) - T.height(x - step, z)), Math.abs(T.height(x, z + step) - T.height(x, z - step))) / (2 * step);
  if (h > 320) return 0; // snow
  const grass = 0.22 * (1 - clamp((h - 220) / 90, 0, 1));
  const f = T.forest(x, z);
  const fuel = Math.max(grass, f);
  // bare crags do not carry fire
  return slope > 0.9 ? fuel * 0.2 : fuel;
}

export function createFire(spec: FireSpec, T: TerrainSampler, n = FIRE_N): FireState {
  const cell = spec.area.size / n;
  const x0 = spec.area.x - spec.area.size / 2;
  const z0 = spec.area.z - spec.area.size / 2;
  const N = n * n;
  const f: FireState = {
    spec,
    n,
    x0,
    z0,
    cell,
    height: new Float32Array(N),
    fuel: new Float32Array(N),
    state: new Uint8Array(N),
    heat: new Float32Array(N),
    life: new Float32Array(N),
    retardant: new Float32Array(N),
    wet: new Float32Array(N),
    burnable: 0,
    t: 0,
    acc: 0,
    seed: 1234567,
    spots: [],
    held: new Uint8Array(N),
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = x0 + (i + 0.5) * cell;
      const z = z0 + (j + 0.5) * cell;
      f.height[k] = T.height(x, z);
      f.fuel[k] = fuelAt(T, x, z, cell);
      if (f.fuel[k] > 0.05) f.burnable++;
    }
  // the places people live and work do not burn (the fire reaching them is the loss)
  for (const th of spec.threats) forCells(f, th.x, th.z, th.r * 0.6, (k) => (f.fuel[k] = Math.min(f.fuel[k], 0.3)));
  for (const ig of spec.ignitions) forCells(f, ig.x, ig.z, ig.r, (k) => ignite(f, k, 1));
  return f;
}

/** Every cell whose centre is within `r` of (x, z). */
export function forCells(f: FireState, x: number, z: number, r: number, fn: (k: number, d: number) => void): void {
  const n = f.n;
  const i0 = Math.max(0, Math.floor((x - r - f.x0) / f.cell));
  const i1 = Math.min(n - 1, Math.floor((x + r - f.x0) / f.cell));
  const j0 = Math.max(0, Math.floor((z - r - f.z0) / f.cell));
  const j1 = Math.min(n - 1, Math.floor((z + r - f.z0) / f.cell));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const cx = f.x0 + (i + 0.5) * f.cell;
      const cz = f.z0 + (j + 0.5) * f.cell;
      const d = Math.hypot(cx - x, cz - z);
      if (d <= r) fn(j * n + i, d);
    }
}

export function cellAt(f: FireState, x: number, z: number): number {
  const i = Math.floor((x - f.x0) / f.cell);
  const j = Math.floor((z - f.z0) / f.cell);
  if (i < 0 || j < 0 || i >= f.n || j >= f.n) return -1;
  return j * f.n + i;
}

export const cellX = (f: FireState, k: number): number => f.x0 + ((k % f.n) + 0.5) * f.cell;
export const cellZ = (f: FireState, k: number): number => f.z0 + (Math.floor(k / f.n) + 0.5) * f.cell;

/** Is (x, z) over the fire's ground (with a margin, m)? */
export function inArea(f: FireState, x: number, z: number, margin = 0): boolean {
  const s = f.n * f.cell;
  return x > f.x0 - margin && x < f.x0 + s + margin && z > f.z0 - margin && z < f.z0 + s + margin;
}

function ignite(f: FireState, k: number, intensity: number): void {
  if (f.state[k] !== UNBURNT || f.fuel[k] <= 0.05) return;
  f.state[k] = BURNING;
  f.heat[k] = intensity;
  f.life[k] = 22 + 38 * f.fuel[k];
}

// ---------------------------------------------------------------- spread
function rand(f: FireState): number {
  // mulberry32
  let t = (f.seed = (f.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const NB: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** How strongly the wind pushes fire along a direction (unit dx, dz). */
export function windFactor(w: FireWind, dx: number, dz: number): number {
  return Math.exp(0.14 * (w.x * dx + w.z * dz));
}

/** Advance the fire by `dt` seconds (in fixed steps). Returns new spot fires. */
export function stepFire(f: FireState, wind: FireWind, dt: number): { x: number; z: number }[] {
  f.acc += dt;
  const spots: { x: number; z: number }[] = [];
  while (f.acc >= FIRE_STEP) {
    f.acc -= FIRE_STEP;
    tick(f, wind, FIRE_STEP, spots);
  }
  return spots;
}

function tick(f: FireState, wind: FireWind, dt: number, spots: { x: number; z: number }[]): void {
  const n = f.n;
  const N = n * n;
  f.t += dt;
  const ws = Math.hypot(wind.x, wind.z);
  const base = f.spec.spread * 0.03 * dt;
  const toIgnite: number[] = [];
  for (let k = 0; k < N; k++) {
    if (f.wet[k] > 0) f.wet[k] = Math.max(0, f.wet[k] - dt / 45);
    if (f.state[k] !== BURNING) continue;
    const I = f.heat[k];
    // burning cells flare up to full intensity, then burn through their fuel
    f.heat[k] = Math.min(1, I + dt * 0.25);
    f.life[k] -= dt;
    if (f.life[k] <= 0) {
      f.state[k] = BURNT;
      f.heat[k] = 0;
      continue;
    }
    const i = k % n;
    const j = (k - i) / n;
    for (const [di, dj, dist] of NB) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const q = jj * n + ii;
      if (f.state[q] !== UNBURNT || f.fuel[q] <= 0.05) continue;
      const wf = windFactor(wind, di / dist, dj / dist);
      // uphill runs, downhill creeps
      const sf = clamp(Math.exp((3 * (f.height[q] - f.height[k])) / (dist * f.cell)), 0.45, 3);
      const block = (1 - 0.985 * f.retardant[q]) * (1 - 0.9 * f.wet[q]);
      if (f.retardant[q] > 0.5 && !f.held[q]) f.held[q] = 1;
      f.heat[q] += (base * I * f.fuel[q] * wf * sf * block) / dist;
      if (f.heat[q] >= 1) toIgnite.push(q);
    }
    // embers: strong wind throws them ahead of the hottest fire
    if (f.spec.embers > 0 && I > 0.85 && ws > 5 && rand(f) < f.spec.embers * dt * (ws - 5) * 0.0001) {
      const d = (2.5 + rand(f) * 2.5) * f.cell;
      const sx = cellX(f, k) + (wind.x / ws) * d + (rand(f) - 0.5) * 2 * f.cell;
      const sz = cellZ(f, k) + (wind.z / ws) * d + (rand(f) - 0.5) * 2 * f.cell;
      const q = cellAt(f, sx, sz);
      // a retardant line catches embers as well as flames
      if (q >= 0 && !crossesLine(f, cellX(f, k), cellZ(f, k), sx, sz) && f.state[q] === UNBURNT && f.fuel[q] > 0.4 && f.retardant[q] < 0.3 && f.wet[q] < 0.3) {
        toIgnite.push(q);
        spots.push({ x: sx, z: sz });
        f.spots.push({ x: sx, z: sz, t: f.t });
      }
    }
  }
  for (const q of toIgnite) ignite(f, q, 0.35);
}

/** Does the straight path from a to b pass over retardant? */
function crossesLine(f: FireState, ax: number, az: number, bx: number, bz: number): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (f.cell * 0.5));
  for (let s = 1; s <= steps; s++) {
    const q = cellAt(f, ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
    if (q >= 0 && f.retardant[q] > 0.5) return true;
  }
  return false;
}

// ---------------------------------------------------------------- what the aircraft do
/**
 * A swath of retardant along a segment: everything within `width / 2` is
 * coated. Fire already burning under it is knocked back.
 */
export function dropRetardant(f: FireState, ax: number, az: number, bx: number, bz: number, width: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz;
  const half = width / 2;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  let coated = 0;
  forCells(f, mx, mz, Math.sqrt(L2) / 2 + half, (k) => {
    const cx = cellX(f, k);
    const cz = cellZ(f, k);
    const t = L2 > 0 ? clamp(((cx - ax) * dx + (cz - az) * dz) / L2, 0, 1) : 0;
    const d = Math.hypot(cx - (ax + dx * t), cz - (az + dz * t));
    if (d > half) return;
    const amt = d < half * 0.7 ? 1 : 1 - (d - half * 0.7) / (half * 0.3);
    if (amt > f.retardant[k]) {
      if (f.retardant[k] < 0.5 && amt >= 0.5) coated++;
      f.retardant[k] = amt;
    }
    if (f.state[k] === BURNING) {
      f.heat[k] *= 0.35;
      f.life[k] *= 0.6;
    }
  });
  return coated;
}

/** A bucket of water on (x, z): burning cells knocked down or out, the ground around soaked. */
export function dropWater(f: FireState, x: number, z: number, r: number): number {
  let out = 0;
  forCells(f, x, z, r, (k, d) => {
    const k1 = d < r * 0.6 ? 1 : 1 - (d - r * 0.6) / (r * 0.4);
    f.wet[k] = Math.max(f.wet[k], k1);
    if (f.state[k] === BURNING) {
      f.heat[k] -= 1.3 * k1;
      if (f.heat[k] <= 0.08) {
        f.state[k] = OUT;
        f.heat[k] = 0;
        out++;
      }
    } else if (f.state[k] === UNBURNT) f.heat[k] = 0;
  });
  return out;
}

// ---------------------------------------------------------------- reading it
export interface FireStats {
  burning: number;
  burnt: number;
  /** Burned and burning, as a share of everything that could burn (0..1). */
  spread: number;
}

export function fireStats(f: FireState): FireStats {
  let burning = 0;
  let burnt = 0;
  for (let k = 0; k < f.state.length; k++) {
    const s = f.state[k];
    if (s === BURNING) burning++;
    else if (s === BURNT || s === OUT) burnt++;
  }
  return { burning, burnt, spread: f.burnable ? (burning + burnt) / f.burnable : 0 };
}

/** Distance from the nearest burning cell to the edge of a threatened place (m; Infinity: none burning). */
export function frontDistance(f: FireState, th: Threat): number {
  let best = Infinity;
  for (let k = 0; k < f.state.length; k++) {
    if (f.state[k] !== BURNING) continue;
    const d = Math.hypot(cellX(f, k) - th.x, cellZ(f, k) - th.z) - th.r;
    if (d < best) best = d;
  }
  return Math.max(0, best);
}

/** The fire has reached the place: a burning cell inside its radius. */
export function breached(f: FireState, th: Threat): boolean {
  let hit = false;
  forCells(f, th.x, th.z, th.r, (k) => {
    if (f.state[k] === BURNING) hit = true;
  });
  return hit;
}

/** A cell the fire could still move through. */
const passable = (f: FireState, k: number) => f.state[k] === UNBURNT && f.fuel[k] > 0.05 && f.retardant[k] < 0.5;

/**
 * Can the fire, as it is now, still burn its way to this place? A flood fill
 * from every burning cell through ground that can still burn. Retardant and
 * fuel breaks (water, rock, ash) stop it; embers are ignored.
 */
export function canReach(f: FireState, th: Threat): boolean {
  const n = f.n;
  const seen = new Uint8Array(n * n);
  const queue: number[] = [];
  for (let k = 0; k < seen.length; k++)
    if (f.state[k] === BURNING) {
      seen[k] = 1;
      queue.push(k);
    }
  const target = new Uint8Array(n * n);
  forCells(f, th.x, th.z, th.r, (k) => (target[k] = 1));
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    if (target[k]) return true;
    const i = k % n;
    const j = (k - i) / n;
    for (const [di, dj] of NB) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const q = jj * n + ii;
      if (seen[q]) continue;
      seen[q] = 1;
      if (passable(f, q) || target[q]) queue.push(q);
    }
  }
  return false;
}

/** A copy to run forward (a forecast, or the fire nobody fought). */
export function cloneFire(f: FireState): FireState {
  return {
    ...f,
    height: f.height,
    fuel: f.fuel,
    state: f.state.slice(),
    heat: f.heat.slice(),
    life: f.life.slice(),
    retardant: f.retardant.slice(),
    wet: f.wet.slice(),
    spots: [...f.spots],
    held: f.held.slice(),
  };
}

/**
 * When the fire, left alone, first reaches a place (s from now; null if it
 * does not within `horizon`).
 */
export function timeToReach(f: FireState, th: Threat, wind: FireWind, horizon = 600): number | null {
  const g = cloneFire(f);
  g.acc = 0;
  for (let t = 0; t < horizon; t += 1) {
    stepFire(g, wind, 1);
    if (breached(g, th)) return t + 1;
    if (t % 10 === 0 && fireStats(g).burning === 0) return null;
  }
  return null;
}
