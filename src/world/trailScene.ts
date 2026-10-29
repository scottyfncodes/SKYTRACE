/**
 * The trail rescue made visible: dirt ramps across the track, the trailhead
 * the bike sets off from, the ambulance waiting at the end with a beam to
 * find it by, and the dust the bike kicks up.
 */
import * as THREE from 'three';
import { mat } from './props';
import type { HeightField } from './terrain';
import { Spray } from './waterScene';
import type { HandoffSpec } from '../rescue/handoff';

const blk = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/** A dirt kicker: a wedge across the track, rising the way you ride. */
function ramp(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(4.2, 0);
  shape.lineTo(4.2, 1.1);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false });
  g.translate(-2.1, 0, -3);
  return new THREE.Mesh(g, mat(0x9a7448));
}

export class TrailView {
  readonly group = new THREE.Group();
  readonly dust: Spray;
  beacon: THREE.Mesh | null = null;
  private lights: THREE.Mesh[] = [];
  /** Where the ambulance waits, and where the hiker walks to (world). */
  ambulance = new THREE.Vector3();

  constructor(private hf: HeightField) {
    this.dust = new Spray(0xb89a6a, (x, z) => hf.sample(x, z));
    this.group.add(this.dust.group);
    this.group.visible = false;
  }

  setup(spec: HandoffSpec): void {
    this.clear();
    const hf = this.hf;
    for (const r of spec.ramps ?? []) {
      const m = ramp();
      m.position.set(r.x, hf.sample(r.x, r.z) - 0.05, r.z);
      // the wedge's rise runs along +X: turn it to rise along the riding direction
      m.rotation.y = r.yaw + Math.PI / 2;
      this.group.add(m);
    }
    // the trailhead: a post and a flag where the bike sets off
    const st = spec.start;
    const sx = st.x + Math.cos(st.yaw) * 6;
    const sz = st.z - Math.sin(st.yaw) * 6;
    const post = blk(0.2, 4, 0.2, mat(0x5a4630));
    post.position.set(sx, hf.sample(sx, sz) + 2, sz);
    const flag = blk(0.05, 0.8, 1.4, mat(0xff6a1a));
    flag.position.set(sx, hf.sample(sx, sz) + 3.5, sz + 0.7);
    this.group.add(post, flag);
    // the ambulance at the end of the ride, beside the track
    const h = spec.home;
    const ax = h.x + Math.cos(h.yaw) * 9;
    const az = h.z - Math.sin(h.yaw) * 9;
    const ay = hf.sample(ax, az);
    const amb = new THREE.Group();
    const body = blk(2.4, 2.4, 5.2, mat(0xffffff));
    body.position.y = 1.6;
    const stripe = blk(2.45, 0.4, 5.25, mat(0xe23d28));
    stripe.position.y = 1.4;
    amb.add(body, stripe);
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.3), new THREE.MeshBasicMaterial({ color: 0x3aa0ff }));
      l.position.set(s * 0.6, 2.95, -2);
      this.lights.push(l);
      amb.add(l);
    }
    amb.position.set(ax, ay, az);
    amb.rotation.y = h.yaw;
    this.group.add(amb);
    this.ambulance.set(ax - Math.cos(h.yaw) * 2.5, ay, az + Math.sin(h.yaw) * 2.5);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 220, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x6dff9a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.set(h.x, ay + 110, h.z);
    beam.visible = false;
    this.beacon = beam;
    this.group.add(beam);
    this.group.visible = true;
  }

  update(t: number, dt: number, home: boolean): void {
    if (this.beacon) this.beacon.visible = home;
    const k = Math.floor(t * 4) % 2;
    this.lights.forEach((l, i) => (l.material as THREE.MeshBasicMaterial).color.setHex((i + k) % 2 ? 0x3aa0ff : 0x0d2a55));
    this.dust.update(dt);
  }

  clear(): void {
    for (const c of [...this.group.children]) if (c !== this.dust.group) this.group.remove(c);
    this.dust.clear();
    this.lights = [];
    this.beacon = null;
    this.group.visible = false;
  }
}
