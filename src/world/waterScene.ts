/**
 * The water rescue made visible: the rafts (falling under a little chute,
 * then bobbing on the river), the upturned canoe, the boat station with its
 * jetty and ambulance, the rapids as bands of white water, the spray off the
 * boat, and the rings that show where a raft will land and how close it has
 * to be.
 */
import * as THREE from 'three';
import { mat } from './props';
import type { HeightField } from './terrain';
import { WATER_LEVEL } from './worldData';
import { riverPoint } from '../water/river';
import type { Raft, WaterOps, WaterSpec } from '../water/waterRun';

const blk = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

function raftMesh(): { group: THREE.Group; chute: THREE.Group } {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.42, 8, 20), mat(0xff6a1a));
  ring.rotation.x = Math.PI / 2;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.15, 18), mat(0x2b3138));
  floor.position.y = -0.15;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(0xffd23f));
  canopy.position.set(0, 0.2, 0.5);
  canopy.scale.set(1, 0.7, 0.6);
  g.add(ring, floor, canopy);
  // the chute it falls under
  const chute = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xff6a1a, side: THREE.DoubleSide }));
  dome.position.y = 5;
  dome.scale.y = 0.55;
  chute.add(dome);
  for (const [x, z] of [
    [1.6, 0],
    [-1.6, 0],
    [0, 1.6],
    [0, -1.6],
  ]) {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 5.2, 3), mat(0xffffff));
    line.position.set(x / 2, 2.6, z / 2);
    line.rotation.set(z * 0.18, 0, -x * 0.18);
    chute.add(line);
  }
  g.add(chute);
  return { group: g, chute };
}

/** The rafts in the air and on the river. */
export class RaftView {
  readonly group = new THREE.Group();
  private items: { group: THREE.Group; chute: THREE.Group }[] = [];

  clear(): void {
    for (const r of this.items) this.group.remove(r.group);
    this.items = [];
  }

  update(rafts: readonly Raft[], t: number): void {
    while (this.items.length < rafts.length) {
      const m = raftMesh();
      this.items.push(m);
      this.group.add(m.group);
    }
    rafts.forEach((r, i) => {
      const m = this.items[i];
      const bob = r.state === 'floating' ? Math.sin(t * 2.2 + i) * 0.12 : 0;
      m.group.position.set(r.x, r.y + bob, r.z);
      m.group.rotation.set(r.state === 'floating' ? Math.sin(t * 1.7 + i) * 0.05 : 0, r.yaw, r.state === 'falling' ? Math.sin(t * 3) * 0.08 : Math.cos(t * 1.3 + i) * 0.05);
      m.chute.visible = r.state === 'falling';
    });
  }
}

/** An upturned canoe, drifting just upstream of the people. */
export function buildCanoe(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 5, 10, 1, false, 0, Math.PI), mat(0xe23d28));
  hull.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  hull.position.y = 0.05;
  hull.scale.set(1, 1, 0.75);
  const paddle = blk(0.12, 0.05, 2.2, mat(0xc9a36a));
  paddle.position.set(1.6, 0.05, 2.4);
  paddle.rotation.y = 0.7;
  g.add(hull, paddle);
  return g;
}

/** The boat station: a jetty out from the bank, a boathouse, the ambulance waiting, and a beam when it is time to come home. */
export class StationView {
  readonly group = new THREE.Group();
  beacon: THREE.Mesh | null = null;
  private lights: THREE.Mesh[] = [];
  /** Where the ambulance stands (world). */
  ambulance = new THREE.Vector3();
  /** The end of the jetty, where the boat ties up, and the shore end (world). */
  jettyEnd = new THREE.Vector3();
  jettyShore = new THREE.Vector3();

  setup(spec: WaterSpec, hf: HeightField): void {
    this.clear();
    const st = spec.station;
    // the shore: walk out from the station across the flow until the ground rises
    const right = { x: -Math.cos(st.yaw), z: Math.sin(st.yaw) };
    // `right` here is the right bank's side of the station when facing upstream: find whichever side is nearer land
    let side = 1;
    let reach = 0;
    for (let d = 2; d < 60; d += 1) {
      if (hf.sample(st.x + right.x * d, st.z + right.z * d) > 0.6) {
        reach = d;
        side = 1;
        break;
      }
      if (hf.sample(st.x - right.x * d, st.z - right.z * d) > 0.6) {
        reach = d;
        side = -1;
        break;
      }
    }
    const ox = right.x * side;
    const oz = right.z * side;
    const len = Math.max(6, reach + 3);
    this.jettyEnd.set(st.x - ox * 1.5, WATER_LEVEL + 0.9, st.z - oz * 1.5);
    this.jettyShore.set(st.x + ox * len, WATER_LEVEL + 0.9, st.z + oz * len);
    const wood = mat(0x8a6a44);
    const deck = blk(3, 0.3, len + 1.5, wood);
    deck.position.set((this.jettyEnd.x + this.jettyShore.x) / 2, WATER_LEVEL + 0.9, (this.jettyEnd.z + this.jettyShore.z) / 2);
    deck.rotation.y = Math.atan2(ox, oz);
    this.group.add(deck);
    for (let k = 0; k <= len; k += 3) {
      for (const s of [-1, 1]) {
        const post = blk(0.3, 4, 0.3, mat(0x5a4630));
        const px = this.jettyEnd.x + ox * k + oz * s * 1.3;
        const pz = this.jettyEnd.z + oz * k - ox * s * 1.3;
        post.position.set(px, WATER_LEVEL - 1, pz);
        this.group.add(post);
      }
    }
    // the boathouse and the ambulance, up on the bank behind the jetty
    const bx = st.x + ox * (len + 9);
    const bz = st.z + oz * (len + 9);
    const by = hf.sample(bx, bz);
    const house = new THREE.Group();
    const walls = blk(8, 4, 6, mat(0xf3f1ea));
    walls.position.y = 2;
    const roof = blk(8.6, 0.6, 6.6, mat(0x1f5fae));
    roof.position.y = 4.3;
    const door = blk(3.4, 3, 0.1, mat(0xff6a1a));
    door.position.set(0, 1.5, 3.05);
    house.add(walls, roof, door);
    house.position.set(bx, by, bz);
    house.rotation.y = Math.atan2(-ox, -oz);
    this.group.add(house);
    const ax = bx + oz * 9;
    const az = bz - ox * 9;
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
    amb.rotation.y = Math.atan2(ox, oz);
    this.group.add(amb);
    this.ambulance.set(ax - ox * 3, ay, az - oz * 3);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 220, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x6dff9a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.set(st.x, 110, st.z);
    beam.visible = false;
    this.beacon = beam;
    this.group.add(beam);
  }

  update(t: number, home: boolean): void {
    if (this.beacon) this.beacon.visible = home;
    const k = Math.floor(t * 4) % 2;
    this.lights.forEach((l, i) => (l.material as THREE.MeshBasicMaterial).color.setHex((i + k) % 2 ? 0x3aa0ff : 0x0d2a55));
  }

  clear(): void {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.lights = [];
    this.beacon = null;
  }
}

/** The rapids: a churned band of white water right across the river, with rocks at the edges. */
export class RapidsView {
  readonly group = new THREE.Group();
  private foam: THREE.Mesh[] = [];

  setup(spec: WaterSpec): void {
    this.clear();
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    const rock = mat(0x6d6a63);
    for (const s of spec.rapids) {
      const c = riverPoint(s, 0);
      const yaw = Math.atan2(c.dx, c.dz);
      for (let k = -2; k <= 2; k++) {
        const band = new THREE.Mesh(new THREE.PlaneGeometry(58, 1.6 + Math.abs(k) * 0.2), white.clone());
        band.rotation.set(-Math.PI / 2, 0, yaw);
        const p = riverPoint(s + k * 2.4, 0);
        band.position.set(p.x, WATER_LEVEL + 0.06 + (k === 0 ? 0.04 : 0), p.z);
        this.foam.push(band);
        this.group.add(band);
      }
      for (const side of [-27, -22, 22, 27]) {
        const p = riverPoint(s + (side > 0 ? 1.5 : -1.5), side);
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4 + Math.abs(side) * 0.03, 0), rock);
        r.position.set(p.x, WATER_LEVEL + 0.2, p.z);
        r.rotation.set(side, side * 0.3, 0);
        this.group.add(r);
      }
    }
  }

  update(t: number): void {
    this.foam.forEach((m, i) => ((m.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 6 + i * 1.3))));
  }

  clear(): void {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.foam = [];
  }
}

/** Spray and wake off the boat (and the splash of a landing). */
export class Spray {
  readonly group = new THREE.Group();
  private bits: { m: THREE.Mesh; v: THREE.Vector3; life: number; max: number; grow: number }[] = [];
  private geo = new THREE.IcosahedronGeometry(0.5, 0);
  private matBase = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });

  emit(at: THREE.Vector3, vx: number, vy: number, vz: number, size = 1, life = 0.9, grow = 1.6): void {
    if (this.bits.length > 240) return;
    const m = new THREE.Mesh(this.geo, this.matBase.clone());
    m.position.copy(at);
    m.scale.setScalar(size);
    this.bits.push({ m, v: new THREE.Vector3(vx, vy, vz), life, max: life, grow });
    this.group.add(m);
  }

  /** A burst of white water (landing off a rapid, a raft hitting the water). */
  splash(at: THREE.Vector3, n = 18, power = 1): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = (2 + Math.random() * 3) * power;
      this.emit(at, Math.cos(a) * s, (3 + Math.random() * 4) * power, Math.sin(a) * s, 0.6 + Math.random() * 0.5, 0.8 + Math.random() * 0.3, 0.5);
    }
  }

  update(dt: number): void {
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= dt;
      b.v.y -= 9 * dt;
      b.m.position.addScaledVector(b.v, dt);
      if (b.m.position.y < WATER_LEVEL) {
        b.m.position.y = WATER_LEVEL;
        b.v.set(b.v.x * 0.5, 0, b.v.z * 0.5);
      }
      if (b.m.scale.x < 2.5) b.m.scale.multiplyScalar(1 + b.grow * dt);
      (b.m.material as THREE.MeshBasicMaterial).opacity = 0.6 * Math.max(0, b.life / b.max) ** 1.5;
      if (b.life <= 0) {
        this.group.remove(b.m);
        (b.m.material as THREE.Material).dispose();
        this.bits.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const b of this.bits) {
      this.group.remove(b.m);
      (b.m.material as THREE.Material).dispose();
    }
    this.bits = [];
  }
}

/** A flat ring on the water: where the raft will land (orange), or how close it must be (white). */
export function waterRing(color: number, r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.9, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 10;
  m.visible = false;
  return m;
}

/** Everything the scene needs to show a water rescue, kept together so the game can set it up and clear it in one go. */
export class WaterView {
  readonly group = new THREE.Group();
  readonly rafts = new RaftView();
  readonly station = new StationView();
  readonly rapids = new RapidsView();
  readonly spray = new Spray();
  readonly canoe = buildCanoe();
  /** Where the raft will land if let go now. */
  readonly aim = waterRing(0xff8a1a, 7);
  /** How close it has to land to them. */
  readonly reach = waterRing(0xffffff, 30);
  private aimDot = new THREE.Mesh(new THREE.CircleGeometry(1.6, 16), new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));

  constructor() {
    this.aimDot.rotation.x = -Math.PI / 2;
    this.aimDot.renderOrder = 10;
    this.aim.add(this.aimDot);
    this.aimDot.rotation.x = 0;
    this.group.add(this.rafts.group, this.station.group, this.rapids.group, this.spray.group, this.canoe, this.aim, this.reach);
    this.group.visible = false;
  }

  setup(ops: WaterOps, hf: HeightField): void {
    this.clear();
    this.station.setup(ops.spec, hf);
    this.rapids.setup(ops.spec);
    this.reach.geometry.dispose();
    this.reach.geometry = new THREE.RingGeometry(ops.spec.reach - 1, ops.spec.reach, 56);
    this.group.visible = true;
    this.canoe.visible = true;
  }

  clear(): void {
    this.rafts.clear();
    this.station.clear();
    this.rapids.clear();
    this.spray.clear();
    this.aim.visible = false;
    this.reach.visible = false;
    this.group.visible = false;
  }
}
