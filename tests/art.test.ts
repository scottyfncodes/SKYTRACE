/**
 * Art detail, within a phone's budget: three distinct airframes with working
 * details, a patchwork of fields that stays off the airfield, the forests and
 * the steep ground, and instanced countryside that stays inside its counts.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AircraftMesh, type AircraftStyle } from '../src/flight/aircraftMesh';
import { initialAircraft } from '../src/flight/aircraft';
import { buildCountryside, fieldAt, fieldCell, FIELD_KINDS, isFarmland } from '../src/world/countryside';
import { forestAt, getHeightField } from '../src/world/terrain';
import { BASE, RUNWAY } from '../src/world/worldData';

const hf = getHeightField();
const slope = (x: number, z: number) => 1 - hf.normal(x, z)[1];

describe('the aircraft', () => {
  const styles: AircraftStyle[] = ['kestrel', 'heron', 'albatross'];

  it('each airframe has its own silhouette, inside the triangle budget', () => {
    const stats = styles.map((s) => new AircraftMesh(s).stats());
    expect(new Set(stats.map((s) => s.triangles)).size).toBe(3);
    for (const s of stats) {
      expect(s.triangles).toBeLessThan(8000);
      expect(s.meshes).toBeLessThan(120);
    }
    // bigger aircraft, more engines
    expect(stats[2].triangles).toBeGreaterThan(stats[0].triangles);
  });

  it('red light to port, green to starboard, a white strobe that blinks', () => {
    for (const s of styles) {
      const m = new AircraftMesh(s);
      const hex = (o: THREE.Object3D) => ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color?.getHex();
      const lights = m.group.children.filter((c) => (c as THREE.Mesh).geometry?.type === 'SphereGeometry');
      const red = lights.find((l) => hex(l) === 0xff3b30)!;
      const green = lights.find((l) => hex(l) === 0x34e05a)!;
      expect(red.position.x).toBeLessThan(0);
      expect(green.position.x).toBeGreaterThan(0);
      const a = initialAircraft(0, 100, 0, 0);
      const seen = new Set<boolean>();
      const strobe = lights.find((l) => hex(l) === 0xffffff)!;
      for (let t = 0; t < 2.4; t += 0.02) {
        m.sync(a, t);
        seen.add(strobe.visible);
      }
      expect(seen).toEqual(new Set([true, false]));
    }
  });

  it('every part of every airframe is drawable geometry', () => {
    for (const s of styles)
      new AircraftMesh(s).group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) expect(m.geometry?.attributes.position.count, s).toBeGreaterThan(0);
      });
  });

  it('switching airframe rebuilds the model', () => {
    const m = new AircraftMesh('kestrel');
    const k = m.stats().triangles;
    m.setStyle('albatross');
    expect(m.style).toBe('albatross');
    expect(m.stats().triangles).not.toBe(k);
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
