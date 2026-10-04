import * as THREE from 'three';
import { box } from './props';
import type { HeightField } from './terrain';
import { TRUCK_ROUTE, TRUCK_SPEED } from './worldData';

/**
 * The unmarked flatbed: a scripted vehicle running a circuit. Pure state in
 * `TruckSim` (testable), visuals in `TruckMesh`.
 */
export class TruckSim {
  seg = 0;
  t = 0; // 0..1 along the segment
  wait = 0;
  x = TRUCK_ROUTE[0].p[0];
  z = TRUCK_ROUTE[0].p[1];
  heading = 0;
  hidden = true;
  moving = false;

  constructor(startSeg = 0) {
    this.seg = startSeg;
    this.wait = TRUCK_ROUTE[startSeg].wait ?? 0;
    this.x = TRUCK_ROUTE[startSeg].p[0];
    this.z = TRUCK_ROUTE[startSeg].p[1];
    this.hidden = !!TRUCK_ROUTE[startSeg].hidden;
  }

  step(dt: number): void {
    const n = TRUCK_ROUTE.length;
    if (this.wait > 0) {
      this.wait -= dt;
      this.moving = false;
      const wp = TRUCK_ROUTE[this.seg];
      this.hidden = !!wp.hidden;
      return;
    }
    const a = TRUCK_ROUTE[this.seg];
    const b = TRUCK_ROUTE[(this.seg + 1) % n];
    const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    this.t += (TRUCK_SPEED * dt) / Math.max(1, len);
    this.moving = true;
    if (this.t >= 1) {
      this.t = 0;
      this.seg = (this.seg + 1) % n;
      this.wait = TRUCK_ROUTE[this.seg].wait ?? 0;
      this.x = TRUCK_ROUTE[this.seg].p[0];
      this.z = TRUCK_ROUTE[this.seg].p[1];
      return;
    }
    this.x = a.p[0] + (b.p[0] - a.p[0]) * this.t;
    this.z = a.p[1] + (b.p[1] - a.p[1]) * this.t;
    this.heading = Math.atan2(-(b.p[0] - a.p[0]), -(b.p[1] - a.p[1]));
    // hidden on segments whose both ends are under cover, blend at the ends
    const ha = !!a.hidden;
    const hb = !!b.hidden;
    this.hidden = ha && hb ? true : ha ? this.t < 0.35 : hb ? this.t > 0.65 : false;
  }
}

export class TruckMesh {
  readonly group: THREE.Group;
  constructor() {
    this.group = new THREE.Group();
    const bed = box(7, 0.6, 2.6, 0x4a4a40);
    bed.position.y = 1.2;
    const cab = box(2.2, 2.2, 2.4, 0x3b4a50);
    cab.position.set(3.8, 1.2, 0);
    const load = box(4.6, 1.5, 2.2, 0x5f6b47);
    load.position.set(-0.6, 1.5, 0);
    for (const [x, z] of [
      [3, 1.2],
      [3, -1.2],
      [-1.5, 1.2],
      [-1.5, -1.2],
      [-3, 1.2],
      [-3, -1.2],
    ]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x1e1e1c }));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.55, z);
      this.group.add(w);
    }
    this.group.add(bed, cab, load);
  }
  /** Place the mesh directly (mission vehicles drive their own routes). */
  setPose(x: number, z: number, heading: number, hf: HeightField): void {
    this.group.position.set(x, hf.sample(x, z) + 0.1, z);
    this.group.rotation.y = heading + Math.PI / 2;
    this.group.visible = true;
  }
  sync(sim: TruckSim, hf: HeightField): void {
    this.group.position.set(sim.x, hf.sample(sim.x, sim.z) + 0.1, sim.z);
    this.group.rotation.y = sim.heading + Math.PI / 2;
    // inside the adit the truck is not rendered at all
    this.group.visible = !(sim.seg === 0 && sim.wait > 0);
  }
}
