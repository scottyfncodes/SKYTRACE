import * as THREE from 'three';
import { mat } from '../world/props';
import type { AircraftState } from './aircraft';

export type PlaneStyle = 'tanker' | 'spotter';

const blk = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cylZ = (rt: number, rb: number, len: number, seg: number, m: THREE.Material) => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m);
  c.rotation.x = Math.PI / 2;
  return c;
};

/**
 * The fixed-wing fire fleet, in the same chunky style as the helicopters:
 * a big red-and-yellow Fire Tanker (high wing, two engines, a belly tank with
 * drop doors) and a small yellow Fire Spotter. Props spin, the strobes
 * blink, and the belly point is exposed for the drop.
 */
export class PlaneMesh {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private props: THREE.Object3D[] = [];
  private strobe: THREE.Mesh[] = [];
  /** Where the retardant leaves the tank (or the marking smoke the spotter), in body space. */
  readonly belly = new THREE.Object3D();
  style: PlaneStyle = 'tanker';
  private spin = 0;

  constructor(style: PlaneStyle = 'tanker') {
    this.group.add(this.body);
    this.setStyle(style);
  }

  setStyle(style: PlaneStyle): void {
    this.style = style;
    for (const c of [...this.body.children]) this.body.remove(c);
    this.props = [];
    this.strobe = [];
    const add = (...o: THREE.Object3D[]) => this.body.add(...o);
    const dark = mat(0x2a2e33);
    const grey = mat(0x9aa3ab);
    const glass = new THREE.MeshLambertMaterial({ color: 0x8fd6f2, emissive: 0x1a4a5e });
    const light = (x: number, y: number, z: number, color: number, strobe = false) => {
      const l = new THREE.Mesh(new THREE.SphereGeometry(strobe ? 0.3 : 0.22, 6, 4), new THREE.MeshBasicMaterial({ color }));
      l.position.set(x, y, z);
      if (strobe) this.strobe.push(l);
      add(l);
    };
    const prop = (x: number, y: number, z: number, r: number, blades: number) => {
      const g = new THREE.Group();
      for (let i = 0; i < blades; i++) {
        const b = blk(0.22, r * 2, 0.08, dark);
        b.rotation.z = (i * Math.PI) / blades;
        g.add(b);
      }
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 10), grey);
      spinner.rotation.x = -Math.PI / 2;
      spinner.position.z = -0.3;
      g.add(spinner);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: 0x1b1f24, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
      g.add(disc);
      g.position.set(x, y, z);
      this.props.push(g);
      add(g);
    };

    if (style === 'tanker') {
      const red = mat(0xd22b1c);
      const yellow = mat(0xffc21a);
      const white = mat(0xf6f4ef);
      // fuselage: a long rounded body, red on top and yellow below
      const hull = cylZ(1.55, 1.35, 15, 14, red);
      hull.position.set(0, 0.4, 0.5);
      const belly = cylZ(1.5, 1.3, 14.6, 14, yellow);
      belly.scale.set(1, 0.7, 1);
      belly.position.set(0, -0.35, 0.4);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(1.55, 14, 10), red);
      nose.scale.set(1, 0.95, 1.5);
      nose.position.set(0, 0.35, -7.1);
      const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), glass);
      cockpit.scale.set(1.15, 0.6, 1.1);
      cockpit.position.set(0, 1.25, -6.6);
      const tail = cylZ(1.35, 0.45, 5, 12, red);
      tail.position.set(0, 0.9, 10.4);
      const fin = blk(0.3, 4.2, 2.6, red);
      fin.position.set(0, 3.2, 11.6);
      fin.rotation.x = -0.25;
      const finBand = blk(0.32, 0.8, 2.4, yellow);
      finBand.position.set(0, 4.3, 12.0);
      finBand.rotation.x = -0.25;
      const stab = blk(8.6, 0.25, 1.9, white);
      stab.position.set(0, 5.1, 12.6);
      // the high wing, with yellow tips and two engines under it
      const wing = blk(26, 0.5, 3.2, white);
      wing.position.set(0, 2.15, -1.2);
      const stripe = blk(26.05, 0.2, 0.7, red);
      stripe.position.set(0, 2.42, -2.3);
      add(hull, belly, nose, cockpit, tail, fin, finBand, stab, wing, stripe);
      for (const s of [-1, 1]) {
        const tip = blk(2, 0.55, 3.25, yellow);
        tip.position.set(s * 12.1, 2.15, -1.2);
        const nac = cylZ(0.75, 0.6, 4.2, 12, white);
        nac.position.set(s * 4.8, 1.5, -2.2);
        const float = cylZ(0.35, 0.35, 2.4, 8, red);
        float.position.set(s * 10.5, 0.9, -1.0);
        const strut = blk(0.12, 1.0, 0.3, grey);
        strut.position.set(s * 10.5, 1.5, -1.0);
        add(tip, nac, float, strut);
        prop(s * 4.8, 1.5, -4.45, 2.1, 4);
        light(s * 13.1, 2.15, -1.2, s < 0 ? 0xff3b30 : 0x34e05a);
      }
      // the retardant tank and its doors
      const tank = blk(2.2, 0.6, 5.5, dark);
      tank.position.set(0, -1.25, 0.2);
      add(tank);
      this.belly.position.set(0, -1.6, 0.2);
      light(0, 5.3, 13.3, 0xffffff, true);
      light(0, -1.6, -3, 0xff4433, true);
    } else {
      const yellow = mat(0xffd23f);
      const white = mat(0xf6f4ef);
      const red = mat(0xe23d28);
      const hull = blk(1.3, 1.3, 5.2, white);
      hull.position.set(0, 0.2, 0);
      const cowl = blk(1.2, 1.1, 1.4, yellow);
      cowl.position.set(0, 0.15, -3.1);
      const cabin = blk(1.25, 0.8, 2.0, glass);
      cabin.position.set(0, 1.05, -0.9);
      const tail = blk(0.6, 0.7, 3.4, white);
      tail.position.set(0, 0.45, 4.0);
      const fin = blk(0.15, 1.7, 1.3, red);
      fin.position.set(0, 1.4, 5.3);
      fin.rotation.x = -0.25;
      const stab = blk(3.8, 0.12, 0.9, yellow);
      stab.position.set(0, 0.6, 5.4);
      const wing = blk(11.5, 0.22, 1.6, yellow);
      wing.position.set(0, 1.55, -0.6);
      const band = blk(1.32, 0.3, 5.22, red);
      band.position.set(0, 0.1, 0);
      add(hull, cowl, cabin, tail, fin, stab, wing, band);
      for (const s of [-1, 1]) {
        const strut = blk(0.08, 1.4, 0.12, grey);
        strut.position.set(s * 1.9, 0.9, -0.6);
        strut.rotation.z = s * 0.9;
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10), dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(s * 0.9, -0.75, -0.6);
        add(strut, wheel);
        light(s * 5.8, 1.55, -0.6, s < 0 ? 0xff3b30 : 0x34e05a);
      }
      prop(0, 0.15, -3.9, 1.0, 2);
      this.belly.position.set(0, -0.5, 2.6);
      light(0, 2.3, 5.8, 0xffffff, true);
    }
    this.body.add(this.belly);
  }

  sync(a: AircraftState, t: number, dt: number): void {
    this.group.position.set(a.x, a.y, a.z);
    this.group.rotation.set(0, a.yaw, 0);
    this.body.rotation.set(a.pitch, 0, -a.roll, 'YXZ');
    this.spin += dt * 40;
    for (const p of this.props) p.rotation.z = this.spin;
    const k = (t % 1.2) / 1.2;
    for (const s of this.strobe) s.visible = k < 0.06;
  }

  /** The belly point in world space. */
  bellyWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.belly.getWorldPosition(out);
  }
}
