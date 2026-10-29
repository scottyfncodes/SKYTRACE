import * as THREE from 'three';
import { mat } from '../world/props';
import type { AircraftState } from './aircraft';

const blk = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/**
 * The Trail Bike, in the same chunky style as the rest of the fleet: knobbly
 * wheels, an orange tank and number board, long forks, and Sam riding it in
 * a white helmet. The hiker you pick up rides on the back. Front toward -Z;
 * the back wheel is exposed for the dust.
 */
export class BikeMesh {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private pillion: THREE.Group;
  private rider: THREE.Group;
  private spin = 0;
  /** The back wheel's contact patch, in body space. */
  readonly rear = new THREE.Object3D();

  constructor() {
    this.group.add(this.body);
    const orange = mat(0xff6a1a);
    const dark = mat(0x22272d);
    const grey = mat(0x9aa3ab);
    const white = mat(0xf6f4ef);
    const tyre = mat(0x1b1f24);
    for (const z of [-0.75, 0.75]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 12), tyre);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, 0.42, z);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 8), grey);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(w.position);
      this.wheels.push(w);
      this.body.add(w, hub);
    }
    // the frame, the engine, the tank and seat, the forks and bars
    const engine = blk(0.32, 0.35, 0.5, dark);
    engine.position.set(0, 0.58, 0.05);
    const tank = blk(0.42, 0.28, 0.55, orange);
    tank.position.set(0, 0.95, -0.2);
    const seat = blk(0.3, 0.12, 0.85, dark);
    seat.position.set(0, 1.0, 0.35);
    const tail = blk(0.3, 0.12, 0.45, orange);
    tail.position.set(0, 0.95, 0.85);
    tail.rotation.x = -0.25;
    const fender = blk(0.22, 0.06, 0.6, white);
    fender.position.set(0, 0.95, -0.95);
    fender.rotation.x = 0.2;
    const board = blk(0.36, 0.3, 0.05, white);
    board.position.set(0, 1.08, -0.62);
    board.rotation.x = 0.3;
    this.body.add(engine, tank, seat, tail, fender, board);
    for (const s of [-1, 1]) {
      const fork = blk(0.06, 0.75, 0.06, grey);
      fork.position.set(s * 0.13, 0.78, -0.65);
      fork.rotation.x = 0.35;
      this.body.add(fork);
    }
    const bars = blk(0.75, 0.05, 0.05, dark);
    bars.position.set(0, 1.18, -0.5);
    const swing = blk(0.08, 0.08, 0.75, grey);
    swing.position.set(0.12, 0.5, 0.4);
    this.body.add(bars, swing);
    // Sam, leaning over the bars
    this.rider = figure(0xff6a1a, 0xffffff, 0.05);
    this.rider.position.set(0, 1.0, 0.15);
    // the hiker, on the back once she is aboard
    this.pillion = figure(0x8a5cff, 0x3a8f3a, -0.1);
    this.pillion.position.set(0, 0.92, 0.7);
    this.pillion.scale.setScalar(0.9);
    this.pillion.visible = false;
    this.body.add(this.rider, this.pillion);
    this.rear.position.set(0, 0.05, 0.85);
    this.body.add(this.rear);
    this.group.scale.setScalar(1.25);
  }

  setPillion(on: boolean): void {
    this.pillion.visible = on;
  }

  /** `speed` turns the wheels. */
  sync(a: AircraftState, dt: number, speed: number): void {
    this.group.position.set(a.x, a.y, a.z);
    this.group.rotation.set(0, a.yaw, 0);
    this.body.rotation.set(a.pitch, 0, -a.roll, 'YXZ');
    this.spin += (speed / 0.42) * dt;
    for (const w of this.wheels) w.rotation.x = -this.spin;
    // the rider stands up a little when the bike is in the air
    this.rider.position.y = 1.0 + Math.min(0.2, a.agl * 0.1);
  }

  rearWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.rear.getWorldPosition(out);
  }
}

/** A rider: legs astride, a jacket, arms forward, a helmet. */
function figure(jacket: number, helmet: number, lean: number): THREE.Group {
  const g = new THREE.Group();
  const legs = blk(0.5, 0.35, 0.3, mat(0x2f3a4a));
  legs.position.y = 0.1;
  const body = blk(0.42, 0.62, 0.3, mat(jacket));
  body.position.set(0, 0.55, 0);
  body.rotation.x = lean - 0.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6), mat(helmet));
  head.position.set(0, 1.0, -0.12);
  for (const s of [-1, 1]) {
    const arm = blk(0.12, 0.12, 0.5, mat(jacket));
    arm.position.set(s * 0.25, 0.7, -0.25);
    arm.rotation.x = 0.4;
    g.add(arm);
  }
  g.add(legs, body, head);
  return g;
}
