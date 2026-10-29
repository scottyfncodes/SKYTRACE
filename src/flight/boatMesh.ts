import * as THREE from 'three';
import { mat } from '../world/props';
import type { AircraftState } from './aircraft';

const blk = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/**
 * The Rescue Boat, in the same chunky style as the aircraft: a grey-tubed
 * jet boat with an orange deck, a console and windscreen, a blue light bar,
 * and Jo at the wheel. The people you pull in sit on the bench behind her.
 * Bow toward -Z; the stern point is exposed for the wake.
 */
export class BoatMesh {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private lights: THREE.Mesh[] = [];
  private riders: THREE.Group[] = [];
  /** Where the jet leaves the stern, and the bow, in body space. */
  readonly stern = new THREE.Object3D();
  readonly bow = new THREE.Object3D();

  constructor() {
    this.group.add(this.body);
    const orange = mat(0xff6a1a);
    const tube = mat(0x3b434c);
    const white = mat(0xf6f4ef);
    const dark = mat(0x22272d);
    const glass = new THREE.MeshLambertMaterial({ color: 0x8fd6f2, emissive: 0x1a4a5e, transparent: true, opacity: 0.8 });
    // the hull: a deck on two fat side tubes that meet at the bow
    const deck = blk(2.2, 0.5, 6.4, orange);
    deck.position.set(0, 0.1, 0.2);
    const keel = blk(1.2, 0.5, 5.6, white);
    keel.position.set(0, -0.3, 0.4);
    this.body.add(deck, keel);
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 6.2, 10), tube);
      t.rotation.x = Math.PI / 2;
      t.position.set(s * 1.25, 0.25, 0.4);
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.2, 1.8, 10), tube);
      nose.rotation.x = Math.PI / 2;
      nose.rotation.z = s * -0.55;
      nose.position.set(s * 0.8, 0.3, -3.3);
      nose.rotation.order = 'ZXY';
      this.body.add(t, nose);
    }
    const bowCap = blk(1.4, 0.55, 1.2, orange);
    bowCap.position.set(0, 0.2, -3.3);
    this.body.add(bowCap);
    // the console and windscreen, the light bar
    const console_ = blk(1.1, 1.0, 0.9, white);
    console_.position.set(0, 0.85, -0.4);
    const screen = blk(1.15, 0.55, 0.08, glass);
    screen.position.set(0, 1.6, -0.82);
    screen.rotation.x = -0.35;
    const arch = blk(2.0, 0.12, 0.12, dark);
    arch.position.set(0, 2.5, 0.6);
    this.body.add(console_, screen, arch);
    for (const s of [-1, 1]) {
      const leg = blk(0.1, 2.2, 0.1, dark);
      leg.position.set(s * 0.95, 1.45, 0.6);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.2), new THREE.MeshBasicMaterial({ color: 0x3aa0ff }));
      l.position.set(s * 0.5, 2.62, 0.6);
      this.lights.push(l);
      this.body.add(leg, l);
    }
    // the jet at the back
    const jet = blk(0.9, 0.7, 0.8, dark);
    jet.position.set(0, 0.25, 3.7);
    this.body.add(jet);
    // Jo at the wheel
    this.body.add(rider(0xff6a1a, 0xffffff, 0, 0.35, 0.25, true));
    // the bench for the people you pull in
    const bench = blk(1.8, 0.35, 0.6, white);
    bench.position.set(0, 0.5, 1.9);
    this.body.add(bench);
    for (const [i, x] of [-0.5, 0.5].entries()) {
      const r = rider(0xffd23f, [0xe23d28, 0x2e7dd1][i], x, 0.55, 1.95, false);
      r.visible = false;
      this.riders.push(r);
      this.body.add(r);
    }
    this.stern.position.set(0, -0.1, 4.1);
    this.bow.position.set(0, -0.1, -3.6);
    this.body.add(this.stern, this.bow);
  }

  /** How many people are aboard (they sit on the bench). */
  setAboard(n: number): void {
    this.riders.forEach((r, i) => (r.visible = i < n));
  }

  sync(a: AircraftState, t: number): void {
    this.group.position.set(a.x, a.y, a.z);
    this.group.rotation.set(0, a.yaw, 0);
    this.body.rotation.set(a.pitch, 0, -a.roll, 'YXZ');
    const k = Math.floor(t * 5) % 2;
    this.lights.forEach((l, i) => ((l.material as THREE.MeshBasicMaterial).color.setHex((i + k) % 2 ? 0x3aa0ff : 0x0d2a55)));
  }

  sternWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.stern.getWorldPosition(out);
  }

  bowWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.bow.getWorldPosition(out);
  }
}

/** A seated figure: a life jacket, a head, a helmet or a hat. */
function rider(jacket: number, hat: number, x: number, y: number, z: number, standing: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = blk(0.55, standing ? 1.0 : 0.7, 0.4, mat(jacket));
  body.position.y = standing ? 0.9 : 0.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6), mat(0xe8b48a));
  head.position.y = standing ? 1.6 : 1.05;
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(hat));
  lid.position.y = head.position.y + 0.04;
  g.add(body, head, lid);
  g.position.set(x, y, z);
  return g;
}
