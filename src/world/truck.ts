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
  private lampMat: THREE.MeshBasicMaterial;
  private tailMat: THREE.MeshBasicMaterial;
  constructor() {
    this.group = new THREE.Group();
    const bed = box(7, 0.6, 2.6, 0x4a4a40);
    bed.position.y = 1.2;
    const cab = box(2.2, 2.2, 2.4, 0x3b4a50);
    cab.position.set(3.8, 1.2, 0);
    // a canvas tilt over the load: a half-round cover on hoops
    const load = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 4.8, 10, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x5f6b47, flatShading: true }));
    load.rotation.z = Math.PI / 2;
    load.rotation.y = Math.PI / 2;
    load.position.set(-0.6, 1.5, 0);
    const sides = box(4.8, 1.0, 2.3, 0x56603f);
    sides.position.set(-0.6, 2.0, 0);
    for (const x of [-2.6, -0.6, 1.4]) {
      const hoop = box(0.12, 0.2, 2.35, 0x3f4632);
      hoop.position.set(x, 3.0, 0);
      this.group.add(hoop);
    }
    const glass = new THREE.MeshLambertMaterial({ color: 0x23323a, emissive: 0x0b1418 });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 2.0), glass);
    screen.position.set(4.92, 1.75, 0);
    const sideWin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 2.46), glass);
    sideWin.position.set(4.1, 1.75, 0);
    const grille = box(0.1, 0.7, 1.8, 0x22231f);
    grille.position.set(4.95, 0.75, 0);
    const bumper = box(0.25, 0.25, 2.6, 0x2b2b27);
    bumper.position.set(5.0, 0.35, 0);
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
    this.lampMat = lamp;
    for (const z of [-0.95, 0.95]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.32), lamp);
      l.position.set(5.0, 0.8, z);
      this.group.add(l);
    }
    // tail lamps: dark until the driver hits the brakes and runs
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x3a1a16 });
    for (const z of [-1.1, 1.1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.3), this.tailMat);
      l.position.set(-3.52, 0.95, z);
      this.group.add(l);
    }
    for (const x of [3, -2.25]) {
      const guard = box(x > 0 ? 1.4 : 2.6, 0.12, 2.9, 0x2e2f2a);
      guard.position.set(x, 1.12, 0);
      this.group.add(guard);
    }
    this.group.add(sides, screen, sideWin, grille, bumper);
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
  /** Headlamps and tail lamps on (the truck is running) or off. */
  setLights(on: boolean): void {
    this.lampMat.color.setHex(on ? 0xffffff : 0xfff1c4);
    this.tailMat.color.setHex(on ? 0xff2a1a : 0x3a1a16);
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
