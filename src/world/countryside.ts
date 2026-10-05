import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, fbm, rng } from '../core/math';
import { forestAt, type HeightField } from './terrain';
import { BASE, FLATS, ROADS, WORLD_HALF } from './worldData';

/**
 * The lived-in land between the landmarks: a patchwork of fields with
 * hedgerows, broadleaf trees along the hedges and at the forest edges,
 * boulders on the steep ground, and telegraph poles down the main road.
 * Everything heavy is instanced so it stays cheap on a phone.
 */

// ---------------- fields (pure: terrain colouring and hedge placement read the same layout)
export const FIELD_ANGLE = 0.38;
export const CELL_W = 120;
export const CELL_D = 85;
const COS = Math.cos(FIELD_ANGLE);
const SIN = Math.sin(FIELD_ANGLE);

export type FieldKind = 'wheat' | 'pasture' | 'ploughed' | 'fallow' | 'rapeseed';
export const FIELD_KINDS: readonly FieldKind[] = ['wheat', 'pasture', 'ploughed', 'fallow', 'rapeseed', 'pasture', 'wheat'] as const;
export const FIELD_COLOR: Record<FieldKind, number> = { wheat: 0xc9b36a, pasture: 0x7ea446, ploughed: 0x7d6142, fallow: 0x9ea45c, rapeseed: 0xd8c84a };

/** Field-grid coordinates: cell indices and position inside the cell (0..1). */
export function fieldCell(x: number, z: number): { i: number; j: number; u: number; v: number } {
  const a = (x * COS + z * SIN) / CELL_W;
  const b = (-x * SIN + z * COS) / CELL_D;
  const i = Math.floor(a);
  const j = Math.floor(b);
  return { i, j, u: a - i, v: b - j };
}

const hash = (i: number, j: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Is this ground farmed? Low, gentle, open land away from the airfield and the landmarks. */
export function isFarmland(x: number, z: number, h: number, slope: number): boolean {
  if (h < 6 || h > 72 || slope > 0.05) return false;
  if (forestAt(x, z) > 0.06) return false;
  if (Math.hypot(x - BASE.x, z - BASE.z) < 230) return false;
  for (const f of FLATS.slice(1)) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.8) return false;
  // farms come in clusters, not wall to wall
  return fbm(x / 520 + 3.1, z / 520 - 1.7, 2) > -0.08;
}

/** Which crop a cell grows (null: not farmland). */
export function fieldAt(x: number, z: number, h: number, slope: number): FieldKind | null {
  if (!isFarmland(x, z, h, slope)) return null;
  const c = fieldCell(x, z);
  return FIELD_KINDS[Math.floor(hash(c.i, c.j) * FIELD_KINDS.length)];
}

/** Terrain colour for a farmed vertex: the crop, a little furrow banding, per-field brightness. */
export function fieldTint(x: number, z: number, kind: FieldKind, out: THREE.Color): THREE.Color {
  const c = fieldCell(x, z);
  out.setHex(FIELD_COLOR[kind]);
  const furrow = kind === 'ploughed' || kind === 'wheat' ? 0.94 + 0.06 * Math.sin(c.u * CELL_W * 0.9) : 1;
  return out.multiplyScalar(furrow * (0.9 + 0.2 * hash(c.j, c.i)));
}

// ---------------- instanced props
function instanced(geo: THREE.BufferGeometry, material: THREE.Material, items: { x: number; y: number; z: number; s: [number, number, number]; r: number; c: THREE.Color }[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.r);
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(...it.s));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, it.c);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function colored(geo: THREE.BufferGeometry, r: number, g: number, b: number): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, g, b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

export interface Countryside {
  group: THREE.Group;
  counts: { hedges: number; broadleaf: number; boulders: number; poles: number };
}

export function buildCountryside(hf: HeightField): Countryside {
  const g = new THREE.Group();
  const r = rng(9090);
  const slopeAt = (x: number, z: number) => 1 - hf.normal(x, z)[1];
  const col = (hex: number, jitter = 0.15) => new THREE.Color(hex).multiplyScalar(1 - jitter / 2 + r() * jitter);

  // hedgerows: low bushes along field edges, with a tree every so often
  const hedges: Parameters<typeof instanced>[2] = [];
  const broadleaf: Parameters<typeof instanced>[2] = [];
  const lim = WORLD_HALF - 20;
  for (let i = -16; i <= 16; i++) {
    for (let j = -22; j <= 22; j++) {
      // walk the two edges of this cell that start at its corner
      for (const edge of [0, 1]) {
        const len = edge === 0 ? CELL_W : CELL_D;
        for (let s = 0; s < len; s += 7) {
          const a = edge === 0 ? i * CELL_W + s : i * CELL_W;
          const b = edge === 0 ? j * CELL_D : j * CELL_D + s;
          const x = a * COS - b * SIN;
          const z = a * SIN + b * COS;
          if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
          const h = hf.sample(x, z);
          if (!isFarmland(x, z, h, slopeAt(x, z))) continue;
          // not every boundary is hedged: gaps and gates
          if (hash(i * 3 + edge, j * 7) < 0.25 || r() < 0.12) continue;
          hedges.push({ x, y: h + 0.4, z, s: [3 + r() * 1.5, 1.6 + r() * 1.2, 3 + r() * 1.5], r: r() * 6, c: col(0x3f6a2c, 0.3) });
          if (r() < 0.08) broadleaf.push({ x, y: h - 0.2, z, s: [0, 0, 0], r: r() * 6, c: col(0x557f34, 0.35) });
        }
      }
    }
  }
  // size the hedgerow trees
  for (const t of broadleaf) {
    const k = 7 + r() * 6;
    t.s = [k * 0.75, k, k * 0.75];
  }
  // broadleaf trees softening the forest edges
  for (let k = 0; k < 6000; k++) {
    const x = (r() - 0.5) * 2 * lim;
    const z = (r() - 0.5) * 2 * lim;
    const f = forestAt(x, z);
    if (f < 0.02 || f > 0.5) continue;
    const h = hf.sample(x, z);
    if (h < 3) continue;
    const s = 6 + r() * 7;
    broadleaf.push({ x, y: h - 0.2, z, s: [s * 0.8, s, s * 0.8], r: r() * 6, c: col(r() < 0.15 ? 0x8a8a34 : 0x4f7a30, 0.35) });
  }
  const leafy = mergeGeometries([colored(new THREE.CylinderGeometry(0.06, 0.09, 0.45, 5).translate(0, 0.22, 0), 0.36, 0.27, 0.18), colored(new THREE.IcosahedronGeometry(0.42, 0).translate(0, 0.62, 0), 1, 1, 1)], false)!;
  const lambert = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  g.add(instanced(new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.4, 0), new THREE.MeshLambertMaterial({ flatShading: true }), hedges));
  g.add(instanced(leafy, lambert, broadleaf));

  // boulders on steep ground
  const boulders: Parameters<typeof instanced>[2] = [];
  for (let k = 0; k < 20000 && boulders.length < 900; k++) {
    const x = (r() - 0.5) * 2 * lim;
    const z = (r() - 0.5) * 2 * lim;
    const h = hf.sample(x, z);
    if (h < 8 || slopeAt(x, z) < 0.1 || forestAt(x, z) > 0.5) continue;
    const s = 1.2 + r() * r() * 5;
    boulders.push({ x, y: h + s * 0.15, z, s: [s * (0.8 + r() * 0.5), s * (0.5 + r() * 0.4), s], r: r() * 6, c: col(0x8a8378, 0.3) });
  }
  g.add(instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), boulders));

  // telegraph poles and wires down the main road
  const main = ROADS.find((x) => x.kind === 'road')!;
  const poles: Parameters<typeof instanced>[2] = [];
  const tops: THREE.Vector3[] = [];
  let carry = 0;
  for (let k = 0; k < main.pts.length - 1; k++) {
    const [ax, az] = main.pts[k];
    const [bx, bz] = main.pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    for (let s = carry; s < len; s += 48) {
      const x = ax + ((bx - ax) * s) / len + nx * 9;
      const z = az + ((bz - az) * s) / len + nz * 9;
      const h = hf.sample(x, z);
      poles.push({ x, y: h, z, s: [1, 1, 1], r: Math.atan2(bx - ax, bz - az), c: new THREE.Color(0x5b4632) });
      tops.push(new THREE.Vector3(x, h + 9.4, z));
      carry = s + 48 - len;
    }
  }
  const pole = mergeGeometries([new THREE.CylinderGeometry(0.16, 0.22, 10, 6).translate(0, 5, 0), new THREE.BoxGeometry(2.4, 0.18, 0.18).translate(0, 9.4, 0)], false)!;
  g.add(instanced(pole, new THREE.MeshLambertMaterial(), poles));
  const wire: number[] = [];
  for (let k = 0; k < tops.length - 1; k++) {
    const a = tops[k];
    const b = tops[k + 1];
    for (const off of [-1, 1]) {
      // a gentle sag between poles
      let prev: THREE.Vector3 | null = null;
      for (let t = 0; t <= 1.0001; t += 0.25) {
        const p = new THREE.Vector3().lerpVectors(a, b, t);
        p.x += off * 1.1;
        p.y -= Math.sin(t * Math.PI) * 1.2;
        if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
  }
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: 0x2a2a28, transparent: true, opacity: 0.6 }));
  g.add(wires);

  return { group: g, counts: { hedges: hedges.length, broadleaf: broadleaf.length, boulders: boulders.length, poles: poles.length } };
}

/** Terrain vertex colour hook: farmed ground takes its crop's colour, mostly. */
export function tintFarmland(x: number, z: number, h: number, slope: number, base: THREE.Color, scratch: THREE.Color): void {
  const kind = fieldAt(x, z, h, slope);
  if (!kind) return;
  base.lerp(fieldTint(x, z, kind, scratch), clamp(0.72 - slope * 6, 0, 0.72));
}
