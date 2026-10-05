import * as THREE from 'three';
import { mat } from '../world/props';
import type { AircraftState } from './aircraft';

export type AircraftStyle = 'kestrel' | 'heron' | 'albatross';

/** Livery per airframe: body, accent, under-side. */
const LIVERY: Record<AircraftStyle, { body: number; accent: number; belly: number }> = {
  kestrel: { body: 0x6e7052, accent: 0xe0622c, belly: 0x9aa08a },
  heron: { body: 0x7d8a93, accent: 0x2f6f9a, belly: 0xc4ccd0 },
  albatross: { body: 0xd9d6cc, accent: 0xb8352a, belly: 0x9aa1a3 },
};

const cyl = (rt: number, rb: number, len: number, seg: number, m: THREE.Material) => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m);
  c.rotation.x = Math.PI / 2;
  return c;
};
const blk = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/**
 * The three airframes, built from primitives, each with its own silhouette:
 *   KESTREL   single-seat twin-boom pusher-puller, fast and small
 *   HERON     high-wing twin, long body, one tall fin
 *   ALBATROSS big four-engine patrol aircraft with a T-tail
 * Details: spinning propeller blades and disc, wheels, roundels, an antenna
 * mast, and blinking navigation lights (red port, green starboard, white tail).
 */
export class AircraftMesh {
  readonly group = new THREE.Group();
  style: AircraftStyle = 'kestrel';
  private props: THREE.Object3D[] = [];
  private strobe: THREE.Mesh[] = [];
  private navs: THREE.Mesh[] = [];

  constructor(style: AircraftStyle = 'kestrel') {
    this.setStyle(style);
  }

  setStyle(style: AircraftStyle): void {
    this.style = style;
    for (const c of [...this.group.children]) this.group.remove(c);
    this.props = [];
    this.strobe = [];
    this.navs = [];
    const L = LIVERY[style];
    const body = mat(L.body);
    const accent = mat(L.accent);
    const belly = mat(L.belly);
    const dark = mat(0x26282a);
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fd2e8, transparent: true, opacity: 0.8, emissive: 0x16323d });
    const add = (...o: THREE.Object3D[]) => this.group.add(...o);

    /** A propeller: two (or three) blades, a spinner and a faint blur disc, spinning in its own group. */
    const propeller = (x: number, y: number, z: number, r: number, blades = 2) => {
      const p = new THREE.Group();
      for (let i = 0; i < blades; i++) {
        const b = blk(0.16, r * 2, 0.05, dark);
        b.rotation.z = (i * Math.PI) / blades;
        p.add(b);
      }
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.18, r * 0.45, 8), accent);
      spinner.rotation.x = -Math.PI / 2;
      spinner.position.z = -0.15;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      p.add(spinner, disc);
      p.position.set(x, y, z);
      this.props.push(p);
      add(p);
    };
    const roundel = (x: number, y: number, z: number, r: number, up = true) => {
      const outer = new THREE.Mesh(new THREE.CircleGeometry(r, 16), mat(0x1f3a5a));
      const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.55, 16), mat(0xf2efe6));
      const dot = new THREE.Mesh(new THREE.CircleGeometry(r * 0.25, 12), accent);
      for (const [m, lift] of [
        [outer, 0],
        [inner, 0.01],
        [dot, 0.02],
      ] as const) {
        m.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
        m.position.set(x, y + (up ? lift : -lift), z);
        add(m);
      }
    };
    const nav = (x: number, y: number, z: number, color: number, strobe = false) => {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), new THREE.MeshBasicMaterial({ color }));
      l.position.set(x, y, z);
      (strobe ? this.strobe : this.navs).push(l);
      add(l);
    };
    const wheel = (x: number, y: number, z: number, r = 0.32) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 10), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, y, z);
      const leg = blk(0.1, Math.abs(y) * 0.9, 0.1, body);
      leg.position.set(x, y / 2, z);
      add(w, leg);
    };

    if (style === 'kestrel') {
      const fuselage = cyl(0.55, 0.9, 6.2, 12, body);
      fuselage.position.z = 0.4;
      const stripe = cyl(0.92, 0.92, 0.35, 12, accent);
      stripe.position.z = -1.9;
      const cowl = cyl(0.88, 0.9, 1.2, 12, dark);
      cowl.position.z = -3;
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 8), glass);
      canopy.scale.set(1, 0.7, 1.6);
      canopy.position.set(0, 0.6, -1.4);
      const wing = blk(11.5, 0.22, 1.9, body);
      wing.position.set(0, 0.25, -0.6);
      const under = blk(11.3, 0.05, 1.8, belly);
      under.position.set(0, 0.12, -0.6);
      const tipL = blk(1.4, 0.26, 1.9, accent);
      tipL.position.set(-5.2, 0.25, -0.6);
      const tipR = tipL.clone();
      tipR.position.x = 5.2;
      const boomL = cyl(0.18, 0.22, 5.5, 8, body);
      boomL.position.set(-2.4, 0.2, 2.3);
      const boomR = boomL.clone();
      boomR.position.x = 2.4;
      const hTail = blk(5.4, 0.18, 1.1, body);
      hTail.position.set(0, 0.9, 4.9);
      const finL = blk(0.18, 1.6, 1.3, accent);
      finL.position.set(-2.4, 1.2, 4.9);
      const finR = finL.clone();
      finR.position.x = 2.4;
      const mast = blk(0.06, 0.7, 0.18, dark);
      mast.position.set(0, 1.0, 0.6);
      add(fuselage, stripe, cowl, canopy, wing, under, tipL, tipR, boomL, boomR, hTail, finL, finR, mast);
      propeller(0, 0, -3.75, 1.25);
      roundel(-3.6, 0.37, -0.6, 0.55);
      roundel(3.6, 0.37, -0.6, 0.55);
      wheel(0, -0.95, -2.5);
      wheel(-1.2, -0.75, 0.2);
      wheel(1.2, -0.75, 0.2);
      nav(-5.95, 0.25, -0.6, 0xff3b30);
      nav(5.95, 0.25, -0.6, 0x34e05a);
      nav(0, 1.05, 5.45, 0xffffff, true);
    } else if (style === 'heron') {
      const fuselage = cyl(0.7, 0.85, 8.4, 12, body);
      fuselage.position.z = 0.6;
      const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 12), body);
      tailCone.rotation.x = Math.PI / 2;
      tailCone.position.z = 6.1;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8), body);
      nose.scale.set(1, 0.9, 1.3);
      nose.position.z = -3.6;
      const glazing = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 8), glass);
      glazing.scale.set(1.05, 0.65, 1.2);
      glazing.position.set(0, 0.45, -3.1);
      const stripe = blk(0.02, 0.3, 7.5, accent);
      const stripeL = stripe.clone();
      stripe.position.set(0.86, 0, 0.6);
      stripeL.position.set(-0.86, 0, 0.6);
      const wing = blk(15, 0.24, 1.8, body);
      wing.position.set(0, 1.05, -0.8);
      const strutL = blk(0.08, 1.2, 0.12, dark);
      strutL.position.set(-2.2, 0.35, -0.8);
      strutL.rotation.z = 0.9;
      const strutR = strutL.clone();
      strutR.position.x = 2.2;
      strutR.rotation.z = -0.9;
      const fin = blk(0.16, 2.4, 1.8, accent);
      fin.position.set(0, 1.6, 6.3);
      const hTail = blk(4.6, 0.16, 1.2, body);
      hTail.position.set(0, 0.5, 6.4);
      add(fuselage, tailCone, nose, glazing, stripe, stripeL, wing, strutL, strutR, fin, hTail);
      for (const x of [-2.9, 2.9]) {
        const nac = cyl(0.42, 0.36, 2.6, 10, body);
        nac.position.set(x, 0.85, -1.3);
        const ring = cyl(0.44, 0.44, 0.3, 10, accent);
        ring.position.set(x, 0.85, -2.45);
        add(nac, ring);
        propeller(x, 0.85, -2.75, 1.25, 3);
      }
      roundel(-5.3, 1.18, -0.8, 0.6);
      roundel(5.3, 1.18, -0.8, 0.6);
      wheel(0, -1.1, -3);
      wheel(-1.3, -1.0, 0.4, 0.38);
      wheel(1.3, -1.0, 0.4, 0.38);
      nav(-7.55, 1.05, -0.8, 0xff3b30);
      nav(7.55, 1.05, -0.8, 0x34e05a);
      nav(0, 2.85, 6.8, 0xffffff, true);
    } else {
      // ALBATROSS: long and broad, four engines, T-tail
      const fuselage = cyl(1.0, 1.15, 11, 14, body);
      fuselage.position.z = 0.8;
      const belly2 = blk(1.7, 0.4, 9.5, belly);
      belly2.position.set(0, -0.85, 0.6);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 10), body);
      nose.scale.set(1, 0.95, 1.4);
      nose.position.z = -4.8;
      const radome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), dark);
      radome.position.set(0, -0.9, -4.2);
      const glazing = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8), glass);
      glazing.scale.set(1.1, 0.55, 1.1);
      glazing.position.set(0, 0.55, -4.4);
      const tailCone = new THREE.Mesh(new THREE.ConeGeometry(1.0, 3.4, 14), body);
      tailCone.rotation.x = Math.PI / 2;
      tailCone.position.z = 8;
      const wing = blk(19, 0.3, 2.3, body);
      wing.position.set(0, 0.4, -0.6);
      const cheat = blk(19, 0.32, 0.25, accent);
      cheat.position.set(0, 0.4, -1.8);
      const fin = blk(0.2, 3.2, 2.2, body);
      fin.position.set(0, 2.3, 8.2);
      const finBand = blk(0.22, 0.6, 2.2, accent);
      finBand.position.set(0, 2.6, 8.2);
      const tTail = blk(6.2, 0.2, 1.4, body);
      tTail.position.set(0, 3.9, 8.6);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), glass);
      dome.position.set(0, 1.05, 1.5);
      add(fuselage, belly2, nose, radome, glazing, tailCone, wing, cheat, fin, finBand, tTail, dome);
      for (const x of [-6.2, -3.2, 3.2, 6.2]) {
        const nac = cyl(0.42, 0.36, 2.8, 10, body);
        nac.position.set(x, 0.25, -1.6);
        const ring = cyl(0.44, 0.44, 0.3, 10, accent);
        ring.position.set(x, 0.25, -2.85);
        add(nac, ring);
        propeller(x, 0.25, -3.15, 1.15, 3);
      }
      roundel(-7.6, 0.56, -0.6, 0.7);
      roundel(7.6, 0.56, -0.6, 0.7);
      wheel(0, -1.5, -3.8, 0.4);
      wheel(-1.6, -1.45, 0.8, 0.5);
      wheel(1.6, -1.45, 0.8, 0.5);
      nav(-9.55, 0.4, -0.6, 0xff3b30);
      nav(9.55, 0.4, -0.6, 0x34e05a);
      nav(0, 4.05, 9.3, 0xffffff, true);
    }
  }

  sync(a: AircraftState, t: number): void {
    this.group.position.set(a.x, a.y, a.z);
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(a.yaw);
    this.group.rotateX(a.pitch);
    this.group.rotateZ(-a.roll);
    const spin = t * 40 * (0.5 + a.throttle);
    this.props.forEach((p, i) => (p.rotation.z = spin + i * 0.7));
    // anti-collision strobe: a double flash every 1.2 s; nav lights steady
    const k = (t % 1.2) / 1.2;
    const on = k < 0.05 || (k > 0.12 && k < 0.17);
    for (const s of this.strobe) s.visible = on;
  }

  /** Mesh count and triangle count (for the phone budget). */
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
