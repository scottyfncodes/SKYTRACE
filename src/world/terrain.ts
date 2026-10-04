import { clamp, fbm, lerp, polylineDist, smoothstep } from '../core/math';
import { CLEARINGS, FLATS, FORESTS, LAKE, RIDGE, RIVER, WORLD_HALF, WORLD_SIZE } from './worldData';

/** Raw (unflattened) terrain height. */
function rawHeight(x: number, z: number): number {
  const e1 = (fbm(x / 650, z / 650, 4) + 1) / 2;
  const e2 = (fbm(x / 160 + 7.3, z / 160 + 3.1, 3) + 1) / 2;
  let h = 8 + 70 * Math.pow(e1, 1.6) + 14 * e2;
  // ridge line
  const dr = polylineDist(x, z, RIDGE);
  const ridgeNoise = 0.8 + 0.3 * fbm(x / 300 + 11, z / 300 + 5, 2);
  h += 150 * Math.exp(-(dr * dr) / (240 * 240)) * ridgeNoise;
  // eastern hills behind the quarry
  const dq = Math.hypot(x - 1000, z - 420);
  h += 40 * Math.exp(-(dq * dq) / (330 * 330));
  return h;
}

export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);
  // lake
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = lerp(h, -6, smoothstep(LAKE.r + 60, LAKE.r - 30, dl));
  // river valley
  const dRiver = polylineDist(x, z, RIVER);
  h = lerp(h, h * 0.5, smoothstep(340, 70, dRiver)); // broad valley
  h = lerp(h, -4, smoothstep(78, 16, dRiver)); // river bed with soft banks
  // flat regions
  for (const f of FLATS) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r + f.blend) {
      const target = flatTarget(f);
      h = lerp(h, target, smoothstep(f.r + f.blend, f.r, d));
    }
  }
  return h;
}

const flatCache = new Map<string, number>();
function flatTarget(f: { x: number; z: number; lift?: number }): number {
  const key = `${f.x},${f.z}`;
  let v = flatCache.get(key);
  if (v === undefined) {
    let h = rawHeight(f.x, f.z);
    const dRiver = polylineDist(f.x, f.z, RIVER);
    h = lerp(h, h * 0.55, smoothstep(320, 80, dRiver));
    v = Math.max(h, 6) + (f.lift ?? 0);
    flatCache.set(key, v);
  }
  return v;
}

/** 0..1 forest density. */
export function forestAt(x: number, z: number): number {
  let m = 0;
  for (const f of FORESTS) {
    const d = Math.hypot(x - f.x, z - f.z);
    const edge = f.r * (0.85 + 0.25 * fbm(x / 120 + f.x, z / 120 + f.z, 2));
    m = Math.max(m, f.s * smoothstep(edge, edge * 0.6, d));
  }
  for (const c of CLEARINGS) {
    const d = Math.hypot(x - c.x, z - c.z);
    m *= smoothstep(c.r * 0.7, c.r * 1.15, d);
  }
  const dRiver = polylineDist(x, z, RIVER);
  m *= smoothstep(25, 60, dRiver);
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  m *= smoothstep(LAKE.r + 10, LAKE.r + 50, dl);
  if (m <= 0.001) return 0;
  const h = heightAt(x, z);
  if (h <= 3) return 0;
  // thin out above the ridge crest
  m *= 1 - smoothstep(170, 230, h);
  return clamp(m, 0, 1);
}

/**
 * Cached height grid for fast lookups at runtime (flight, props, radar).
 * Resolution is independent from the render mesh.
 */
export class HeightField {
  readonly n: number;
  readonly step: number;
  readonly data: Float32Array;
  constructor(n = 201) {
    this.n = n;
    this.step = WORLD_SIZE / (n - 1);
    this.data = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.data[j * n + i] = heightAt(-WORLD_HALF + i * this.step, -WORLD_HALF + j * this.step);
      }
    }
  }
  sample(x: number, z: number): number {
    const fx = clamp((x + WORLD_HALF) / this.step, 0, this.n - 1.001);
    const fz = clamp((z + WORLD_HALF) / this.step, 0, this.n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const n = this.n;
    const a = this.data[j * n + i];
    const b = this.data[j * n + i + 1];
    const c = this.data[(j + 1) * n + i];
    const d = this.data[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  /** Approximate surface normal (y-up) via central differences. */
  normal(x: number, z: number): [number, number, number] {
    const e = this.step;
    const hx = this.sample(x + e, z) - this.sample(x - e, z);
    const hz = this.sample(x, z + e) - this.sample(x, z - e);
    const nx = -hx;
    const ny = 2 * e;
    const nz = -hz;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
}

let shared: HeightField | null = null;
export function getHeightField(): HeightField {
  if (!shared) shared = new HeightField();
  return shared;
}
