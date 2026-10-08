/**
 * Art detail, within a phone's budget: two distinct rescue helicopters with
 * working details, a patchwork of fields that stays off the airfield, the
 * forests and the steep ground, and instanced countryside inside its counts.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HelicopterMesh, type HeliStyle } from '../src/flight/helicopterMesh';
import { initialAircraft } from '../src/flight/aircraft';
import { buildCountryside, fieldAt, fieldCell, FIELD_KINDS, isFarmland } from '../src/world/countryside';
import { forestAt, getHeightField } from '../src/world/terrain';
import { BASE, RUNWAY } from '../src/world/worldData';

const hf = getHeightField();
const slope = (x: number, z: number) => 1 - hf.normal(x, z)[1];

describe('the helicopters', () => {
  const styles: HeliStyle[] = ['rescue', 'heavy'];

  it('each has its own silhouette, inside the phone budget', () => {
    const stats = styles.map((s) => new HelicopterMesh(s).stats());
    expect(stats[0].triangles).not.toBe(stats[1].triangles);
    for (const s of stats) {
      expect(s.triangles).toBeLessThan(8000);
      expect(s.meshes).toBeLessThan(120);
    }
  });

  it('red light to port, green to starboard, a strobe that blinks', () => {
    for (const s of styles) {
      const m = new HelicopterMesh(s);
      const lights: THREE.Mesh[] = [];
      m.group.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh && mm.geometry.type === 'SphereGeometry' && (mm.material as THREE.MeshBasicMaterial).type === 'MeshBasicMaterial') lights.push(mm);
      });
      const hex = (o: THREE.Mesh) => (o.material as THREE.MeshBasicMaterial).color.getHex();
      expect(lights.find((l) => hex(l) === 0xff3b30)!.position.x).toBeLessThan(0);
      expect(lights.find((l) => hex(l) === 0x34e05a)!.position.x).toBeGreaterThan(0);
      const strobe = lights.find((l) => hex(l) === 0xffffff)!;
      const seen = new Set<boolean>();
      const a = initialAircraft(0, 100, 0, 0);
      for (let t = 0; t < 2.4; t += 0.02) {
        m.sync(a, t, 0.02, 0, 1);
        seen.add(strobe.visible);
      }
      expect(seen).toEqual(new Set([true, false]));
    }
  });

  it('the winch hangs off the right-hand side, and follows the helicopter', () => {
    const m = new HelicopterMesh('rescue');
    const a = initialAircraft(50, 100, -20, 0);
    m.sync(a, 0, 0.016, 0, 1);
    const w = m.winchWorld(new THREE.Vector3());
    expect(w.x).toBeGreaterThan(50 + 1.5); // heading north, right is east
    expect(w.y).toBeLessThan(102);
    a.yaw = Math.PI; // heading south: right is west
    m.sync(a, 0, 0.016, 0, 1);
    expect(m.winchWorld(new THREE.Vector3()).x).toBeLessThan(50 - 1.5);
  });

  it('every part is drawable geometry, and switching style rebuilds it', () => {
    const m = new HelicopterMesh('rescue');
    const k = m.stats().triangles;
    m.setStyle('heavy');
    expect(m.style).toBe('heavy');
    expect(m.stats().triangles).not.toBe(k);
    m.group.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) expect(mm.geometry.attributes.position.count).toBeGreaterThan(0);
    });
  });
});

describe('the countryside', () => {
  it('fields are a stable grid', () => {
    expect(fieldCell(123, 456)).toEqual(fieldCell(123, 456));
    const a = fieldCell(0, 0);
    expect(a.u).toBeGreaterThanOrEqual(0);
    expect(a.u).toBeLessThan(1);
  });

  it('never on the airfield, in the forests, on the steep ground or in the water', () => {
    for (let x = RUNWAY.x1; x <= RUNWAY.x2; x += 20) expect(isFarmland(x, RUNWAY.z, hf.sample(x, RUNWAY.z), slope(x, RUNWAY.z))).toBe(false);
    expect(isFarmland(BASE.x, BASE.z, hf.sample(BASE.x, BASE.z), 0)).toBe(false);
    let forest = 0;
    for (let x = -1100; x <= 1100; x += 37)
      for (let z = -1100; z <= 1100; z += 37) {
        const h = hf.sample(x, z);
        const s = slope(x, z);
        const f = fieldAt(x, z, h, s);
        if (!f) continue;
        expect(h).toBeGreaterThan(5);
        expect(s).toBeLessThanOrEqual(0.05);
        if (forestAt(x, z) > 0.06) forest++;
      }
    expect(forest).toBe(0);
  });

  it('a real patchwork: a good share of the open lowland, several crops', () => {
    let land = 0;
    let farmed = 0;
    const kinds = new Set<string>();
    for (let x = -1100; x <= 1100; x += 25)
      for (let z = -1100; z <= 1100; z += 25) {
        const h = hf.sample(x, z);
        if (h < 6) continue;
        land++;
        const f = fieldAt(x, z, h, slope(x, z));
        if (f) {
          farmed++;
          kinds.add(f);
        }
      }
    expect(farmed / land).toBeGreaterThan(0.08);
    expect(farmed / land).toBeLessThan(0.6);
    expect(kinds.size).toBe(new Set(FIELD_KINDS).size);
  });

  it('hedgerows, trees, boulders and poles, all inside the instance budget', () => {
    const c = buildCountryside(hf);
    expect(c.counts.hedges).toBeGreaterThan(300);
    expect(c.counts.broadleaf).toBeGreaterThan(300);
    expect(c.counts.boulders).toBeGreaterThan(100);
    expect(c.counts.poles).toBeGreaterThan(20);
    const total = c.counts.hedges + c.counts.broadleaf + c.counts.boulders + c.counts.poles;
    expect(total).toBeLessThan(12000);
    // instanced: a handful of draw calls, not thousands
    expect(c.group.children.length).toBeLessThan(8);
    // every part is real geometry the renderer can draw
    c.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.LineSegments).isLineSegments) {
        expect(m.geometry, o.type).toBeTruthy();
        expect(m.geometry.attributes.position.count, o.type).toBeGreaterThan(0);
      }
    });
  });
});
