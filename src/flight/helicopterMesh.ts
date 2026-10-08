import * as THREE from 'three';
import { mat } from '../world/props';
import type { AircraftState } from './aircraft';

export type HeliStyle = 'rescue' | 'heavy' | 'fire';

const blk = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cylZ = (rt: number, rb: number, len: number, seg: number, m: THREE.Material) => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m);
  c.rotation.x = Math.PI / 2;
  return c;
};

/**
 * The rescue helicopters, built from chunky primitives with clear
 * silhouettes: a red-and-white Rescue Helicopter (one big rotor, a bubble
 * nose, a hoist arm over the right-hand door) and an orange tandem-rotor
 * Heavy Rescue Helicopter. Rotors spin with power, nav lights and a strobe
 * blink, and the winch point is exposed for the cable.
 */
export class HelicopterMesh {
  readonly group = new THREE.Group();
  /** Tilt group: the body leans with acceleration inside the heading group. */
  private body = new THREE.Group();
  style: HeliStyle = 'rescue';
  private rotors: THREE.Object3D[] = [];
  private tailRotors: THREE.Object3D[] = [];
  private discs: THREE.Mesh[] = [];
  private strobe: THREE.Mesh[] = [];
  /** Where the cable leaves the hoist, in body space. */
  readonly winch = new THREE.Object3D();
  private spin = 0;
  /** The firefighting bucket on its long line (hidden unless carried). */
  readonly bucket = new THREE.Group();
  private bucketWater: THREE.Mesh;
  private bucketSwing = { x: 0, z: 0, vx: 0, vz: 0 };
  /** Line length under the belly (m). */
  static readonly BUCKET_LINE = 8;

  constructor(style: HeliStyle = 'rescue') {
    this.group.add(this.body);
    this.setStyle(style);
    // a bambi bucket: orange, a little wider at the top, a dark line up to the belly hook
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, HelicopterMesh.BUCKET_LINE, 4), mat(0x1d1f22));
    line.position.y = HelicopterMesh.BUCKET_LINE / 2;
    const pail = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.75, 1.4, 14, 1, true), new THREE.MeshLambertMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }));
    pail.position.y = -0.7;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 6, 16), mat(0x333333));
    rim.rotation.x = Math.PI / 2;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.75, 14), mat(0xd85a10));
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -1.4;
    this.bucketWater = new THREE.Mesh(new THREE.CircleGeometry(0.98, 14), new THREE.MeshLambertMaterial({ color: 0x3aa0e6, emissive: 0x0d3a5e }));
    this.bucketWater.rotation.x = -Math.PI / 2;
    this.bucketWater.position.y = -0.15;
    const hang = new THREE.Group();
    hang.add(line, pail, rim, bottom, this.bucketWater);
    hang.position.y = -HelicopterMesh.BUCKET_LINE;
    this.bucket.add(hang);
    this.bucket.position.y = -1.5;
    this.bucket.visible = false;
    this.group.add(this.bucket);
  }

  /** Show the bucket (`full`: water in it). */
  setBucket(on: boolean, full = false): void {
    this.bucket.visible = on;
    this.bucketWater.visible = full;
  }

  /** The bucket's mouth in world space. */
  bucketWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.bucket.children[0].getWorldPosition(out);
  }

  setStyle(style: HeliStyle): void {
    this.style = style;
    for (const c of [...this.body.children]) this.body.remove(c);
    this.rotors = [];
    this.tailRotors = [];
    this.discs = [];
    this.strobe = [];
    const red = mat(style === 'rescue' ? 0xe23d28 : style === 'fire' ? 0xc92a1a : 0xff8a1f);
    // the fire helicopter: red over a yellow belly
    const white = mat(style === 'fire' ? 0xffc21a : 0xf6f4ef);
    const yellow = mat(0xffd23f);
    const dark = mat(0x2a2e33);
    const grey = mat(0x9aa3ab);
    const glass = new THREE.MeshLambertMaterial({ color: 0x8fd6f2, transparent: true, opacity: 0.85, emissive: 0x1a4a5e });
    const add = (...o: THREE.Object3D[]) => this.body.add(...o);

    const rotor = (x: number, y: number, z: number, r: number, blades: number) => {
      const g = new THREE.Group();
      for (let i = 0; i < blades; i++) {
        const b = blk(r * 2, 0.08, 0.42, dark);
        b.rotation.y = (i * Math.PI) / blades;
        g.add(b);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 10), grey);
      g.add(hub);
      g.position.set(x, y, z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x1b1f24, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, y + 0.02, z);
      this.rotors.push(g);
      this.discs.push(disc);
      add(g, disc);
    };
    const light = (x: number, y: number, z: number, color: number, strobe = false) => {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial({ color }));
      l.position.set(x, y, z);
      if (strobe) this.strobe.push(l);
      add(l);
    };
    const skids = (len: number, half: number, y: number, z: number) => {
      for (const s of [-1, 1]) {
        const rail = cylZ(0.12, 0.12, len, 6, dark);
        rail.position.set(s * half, y, z);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), dark);
        tip.position.set(s * half, y + 0.1, z - len / 2);
        add(rail, tip);
        for (const zz of [-len * 0.28, len * 0.28]) {
          const strut = blk(0.1, Math.abs(y) * 0.9, 0.1, dark);
          strut.position.set(s * half * 0.8, y / 2, z + zz);
          strut.rotation.z = -s * 0.3;
          add(strut);
        }
      }
    };

    if (style !== 'heavy') {
      const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.7, 18, 12), red);
      cabin.scale.set(1, 0.95, 1.55);
      cabin.position.set(0, 0.3, -0.4);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(1.62, 18, 12), white);
      belly.scale.set(1.02, 0.6, 1.5);
      belly.position.set(0, -0.35, -0.35);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 10), glass);
      nose.scale.set(1.05, 0.9, 1.05);
      nose.position.set(0, 0.55, -1.95);
      const stripe = cylZ(1.72, 1.72, 0.45, 18, yellow);
      stripe.scale.set(1, 0.95, 1);
      stripe.position.set(0, 0.3, 0.9);
      const door = blk(0.06, 1.3, 1.5, white);
      door.position.set(1.66, 0.35, 0.1);
      const boom = cylZ(0.22, 0.55, 5.6, 10, red);
      boom.position.set(0, 0.75, 3.9);
      const fin = blk(0.18, 1.9, 1.1, red);
      fin.position.set(0, 1.55, 6.45);
      fin.rotation.x = -0.35;
      const finTip = blk(0.2, 0.4, 0.9, white);
      finTip.position.set(0, 2.35, 6.75);
      finTip.rotation.x = -0.35;
      const stab = blk(2.0, 0.12, 0.6, white);
      stab.position.set(0, 0.85, 5.6);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 0.9, 10), grey);
      mast.position.set(0, 1.95, -0.2);
      const engine = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), white);
      engine.scale.set(0.9, 0.55, 1.6);
      engine.position.set(0, 1.55, 0.5);
      add(cabin, belly, nose, stripe, door, boom, fin, finTip, stab, mast, engine);
      rotor(0, 2.45, -0.2, 6.2, 4);
      // tail rotor on the left of the fin
      const tr = new THREE.Group();
      for (let i = 0; i < 2; i++) {
        const b = blk(0.06, 1.9, 0.22, dark);
        b.rotation.x = (i * Math.PI) / 2;
        tr.add(b);
      }
      tr.position.set(-0.25, 1.75, 6.55);
      this.tailRotors.push(tr);
      add(tr);
      skids(4.6, 1.25, -1.45, -0.2);
      // hoist arm over the right-hand door
      const arm = blk(1.4, 0.2, 0.25, grey);
      arm.position.set(2.15, 1.25, -0.2);
      const head = blk(0.4, 0.4, 0.4, yellow);
      head.position.set(2.8, 1.15, -0.2);
      add(arm, head);
      this.winch.position.set(2.8, 0.9, -0.2);
      light(-1.7, 0.2, -0.6, 0xff3b30);
      light(1.7, 0.2, -0.6, 0x34e05a);
      light(0, 2.6, 6.9, 0xffffff, true);
      light(0, -1.0, -0.8, 0xff4433, true);
    } else {
      // Heavy: a long box fuselage, two pylons, two counter-rotating rotors
      const hull = blk(3.4, 3.0, 11, red);
      hull.position.set(0, 0.6, 0.4);
      const roof = blk(3.0, 0.5, 10.6, white);
      roof.position.set(0, 2.3, 0.4);
      const noseB = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 10), red);
      noseB.scale.set(1, 0.9, 0.9);
      noseB.position.set(0, 0.5, -5.1);
      const glassB = new THREE.Mesh(new THREE.SphereGeometry(1.45, 16, 10), glass);
      glassB.scale.set(1.05, 0.7, 0.8);
      glassB.position.set(0, 1.05, -5.4);
      const band = blk(3.46, 0.5, 11, white);
      band.position.set(0, -0.2, 0.4);
      const stripeB = blk(3.5, 0.3, 11.02, yellow);
      stripeB.position.set(0, 0.45, 0.4);
      const fwdPylon = blk(1.4, 1.0, 1.6, red);
      fwdPylon.position.set(0, 2.9, -4.1);
      const aftPylon = blk(1.6, 2.2, 2.4, red);
      aftPylon.position.set(0, 3.0, 5.1);
      const ramp = blk(3.2, 0.3, 1.6, dark);
      ramp.position.set(0, -0.6, 6.3);
      ramp.rotation.x = 0.35;
      for (const s of [-1, 1]) {
        const pod = cylZ(0.5, 0.5, 3.2, 10, white);
        pod.position.set(s * 1.85, -0.4, 0.6);
        add(pod);
        for (const zz of [-3.2, 3.6]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.35, 10), dark);
          w.rotation.z = Math.PI / 2;
          w.position.set(s * 1.4, -1.25, zz);
          add(w);
        }
      }
      add(hull, roof, noseB, glassB, band, stripeB, fwdPylon, aftPylon, ramp);
      rotor(0, 3.55, -4.1, 6.6, 3);
      rotor(0, 4.25, 5.1, 6.6, 3);
      const arm = blk(1.3, 0.22, 0.25, grey);
      arm.position.set(2.3, 1.9, -1.8);
      const head = blk(0.45, 0.45, 0.45, yellow);
      head.position.set(2.95, 1.8, -1.8);
      add(arm, head);
      this.winch.position.set(2.95, 1.5, -1.8);
      light(-1.75, 0.3, -2, 0xff3b30);
      light(1.75, 0.3, -2, 0x34e05a);
      light(0, 4.3, 6.4, 0xffffff, true);
      light(0, -0.95, -1, 0xff4433, true);
    }
    this.body.add(this.winch);
  }

  /**
   * Place and animate. `tilt` leans the nose down (radians) as it speeds up;
   * `power` 0..1 spins the rotors (0: stopped, 1: flying).
   */
  sync(a: AircraftState, t: number, dt: number, tilt: number, power: number): void {
    this.group.position.set(a.x, a.y, a.z);
    this.group.rotation.set(0, a.yaw, 0);
    this.body.rotation.set(-tilt, 0, -a.roll, 'YXZ');
    this.spin += dt * (2 + power * 34);
    this.rotors.forEach((r, i) => (r.rotation.y = (i % 2 ? -1 : 1) * this.spin + i * 0.5));
    for (const tr of this.tailRotors) tr.rotation.x = this.spin * 2.2;
    for (const d of this.discs) d.visible = power > 0.5;
    // the bucket trails behind as you speed up and swings a little
    if (this.bucket.visible && dt > 0) {
      const sw = this.bucketSwing;
      const want = { x: a.roll * 0.5, z: -Math.min(0.55, a.speed * 0.012) };
      sw.vx += ((want.x - sw.x) * 6 - sw.vx * 1.6) * dt;
      sw.vz += ((want.z - sw.z) * 6 - sw.vz * 1.6) * dt;
      sw.x += sw.vx * dt;
      sw.z += sw.vz * dt;
      this.bucket.rotation.set(sw.z, 0, sw.x);
    }
    const k = (t % 1.1) / 1.1;
    const on = k < 0.05 || (k > 0.12 && k < 0.17);
    for (const s of this.strobe) s.visible = on;
  }

  /** The winch point in world space. */
  winchWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.winch.getWorldPosition(out);
  }

  stats(): { meshes: number; triangles: number } {
    let meshes = 0;
    let triangles = 0;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const g = m.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { meshes, triangles };
  }
}
