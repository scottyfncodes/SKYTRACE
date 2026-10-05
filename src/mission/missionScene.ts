import * as THREE from 'three';
import { box } from '../world/props';
import type { HeightField } from '../world/terrain';
import { TruckMesh } from '../world/truck';
import { WATER_LEVEL } from '../world/worldData';
import { SmokeTrail, StormCell } from '../world/weatherFx';
import type { GateStatus, HazardDef, Ring, Route } from '../operation/gates';
import { RETURNS, type ReturnDef, type ReturnId, type Sector } from './mission01';
import type { MissionState } from './mission';
import type { RouteMover } from './vehicles';

const AMBER = 0xf2a93b;

/** Translucent amber curtain standing on the sector boundary, visible from anywhere in the basin. */
function sectorCurtain(s: Sector, hf: HeightField): THREE.Group {
  const g = new THREE.Group();
  const corners: [number, number][] = [
    [s.x0, s.z0],
    [s.x1, s.z0],
    [s.x1, s.z1],
    [s.x0, s.z1],
    [s.x0, s.z0],
  ];
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 20);
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  pts.push(corners[0]);
  const H = 28;
  const pos: number[] = [];
  const alpha: number[] = [];
  const idx: number[] = [];
  pts.forEach(([x, z], i) => {
    const y = hf.sample(x, z);
    pos.push(x, y - 1, z, x, y + H, z);
    alpha.push(0.42, 0);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('alpha', new THREE.Float32BufferAttribute(alpha, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(AMBER) } },
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA); }',
  });
  g.add(new THREE.Mesh(geo, mat));
  // ground line
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, hf.sample(x, z) + 1.5, z))),
    new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9 }),
  );
  g.add(line);
  // corner posts
  for (const [x, z] of corners.slice(0, 4)) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 6), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.55 }));
    post.position.set(x, hf.sample(x, z) + 30, z);
    g.add(post);
  }
  return g;
}

/** Three light 4x4s in a column. */
class ScoutMesh {
  readonly group = new THREE.Group();
  private cars: THREE.Group[] = [];
  constructor() {
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Group();
      const body = box(4, 1.3, 2, 0x56603f);
      body.position.y = 0.9;
      const top = box(2, 0.9, 1.8, 0x485236);
      top.position.set(-0.4, 1.9, 0);
      car.add(body, top);
      this.cars.push(car);
      this.group.add(car);
    }
  }
  setPose(x: number, z: number, heading: number, hf: HeightField): void {
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    this.cars.forEach((c, i) => {
      const cx = x - fx * i * 10;
      const cz = z - fz * i * 10;
      c.position.set(cx, hf.sample(cx, cz) + 0.1, cz);
      c.rotation.y = heading + Math.PI / 2;
    });
  }
}

/** River barge moored at the landing. */
class BargeMesh {
  readonly group = new THREE.Group();
  constructor() {
    const hull = box(24, 2.2, 7, 0x4b3a2c);
    hull.position.y = 0.6;
    const deck = box(16, 1.6, 6, 0x6a5a44);
    deck.position.set(-2, 2.4, 0);
    const cabin = box(4, 3.4, 5, 0x8a8478);
    cabin.position.set(9, 3.2, 0);
    this.group.add(hull, deck, cabin);
  }
  setPose(x: number, z: number, _heading: number, hf: HeightField): void {
    this.group.position.set(x, Math.max(hf.sample(x, z), WATER_LEVEL) + 0.2, z);
    this.group.rotation.y = 0.55;
  }
}

const RING_RED = new THREE.Color(0xff5a3c);
const RING_AMBER = new THREE.Color(AMBER);
const RING_DIM = new THREE.Color(0xf4f1e8);

/** One hoop of the route: a bright tube, a soft halo, a faint fill so it reads as a doorway. */
class RingMesh {
  readonly group = new THREE.Group();
  readonly tube: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly fill: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  /** Seconds since it was passed or missed (animates the pop / the fade). */
  fx = -1;
  constructor(readonly ring: Ring) {
    const r = ring.r;
    const mat = (o: number, add = false) => new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: o, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.tube = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(1.4, r * 0.06), 8, 48), mat(1));
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.16, 6, 48), mat(0.25, true));
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat(0.06, true));
    this.group.add(this.tube, this.halo, this.fill);
    this.group.position.set(ring.x, ring.y, ring.z);
    // the hoop faces along the route
    this.group.rotation.y = Math.atan2(ring.nx, ring.nz);
    this.group.renderOrder = 2;
  }
  dispose(): void {
    for (const m of [this.tube, this.halo, this.fill]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

/**
 * The next ring's look: a steady hoop (it only changes size as a contact clock
 * closes it, smoothly) and a slow breathing glow. Urgency shows as colour and
 * the closing hoop, never as shaking.
 */
export function activeRingLook(scale: number, t: number): { scale: number; halo: number } {
  return { scale, halo: 0.3 + 0.15 * Math.sin(t * 2.4) };
}

interface Pose {
  setPose(x: number, z: number, heading: number, hf: HeightField): void;
  group: THREE.Group;
}

/** Everything the mission adds to the world. Built once, shown only in mission mode. */
export class MissionScene {
  readonly group = new THREE.Group();
  private vehicles = new Map<ReturnId, Pose>();
  private pins = new Map<ReturnId, THREE.Group>();
  readonly destinationMarker: THREE.Mesh;
  private storms = new Map<string, StormCell>();
  readonly smoke = new SmokeTrail();
  private deck: THREE.Mesh;
  private waypoint: THREE.Mesh;
  private rings: RingMesh[] = [];
  private routeLine: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial> | null = null;

  constructor(sector: Sector, private hf: HeightField) {
    this.group.add(sectorCurtain(sector, hf));
    this.setCast(RETURNS);
    this.destinationMarker = new THREE.Mesh(new THREE.RingGeometry(26, 30, 40), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.destinationMarker.rotation.x = -Math.PI / 2;
    this.destinationMarker.visible = false;
    this.group.add(this.destinationMarker);
    // weather + route markers (shown per leg)
    this.deck = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    this.deck.rotation.x = -Math.PI / 2;
    this.deck.visible = false;
    this.group.add(this.deck);
    this.waypoint = new THREE.Mesh(new THREE.CylinderGeometry(6, 10, 520, 10, 1, true), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    this.waypoint.visible = false;
    this.group.add(this.waypoint);
    this.group.add(this.smoke.group);
    this.group.visible = false;
  }

  /** Build the vehicles (and their marker pins) for this operation's cast. */
  setCast(cast: readonly ReturnDef[]): void {
    for (const v of this.vehicles.values()) this.group.remove(v.group);
    for (const p of this.pins.values()) this.group.remove(p);
    this.vehicles.clear();
    this.pins.clear();
    for (const r of cast) {
      const m: Pose = r.kind === 'vessel' ? new BargeMesh() : r.size === 'small' ? new ScoutMesh() : new TruckMesh();
      this.vehicles.set(r.id, m);
      this.group.add(m.group);
      const pin = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 60, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 34;
      beam.name = 'beam';
      const ring = new THREE.Mesh(new THREE.RingGeometry(12, 14.5, 32), new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.6;
      ring.name = 'ring';
      pin.add(beam, ring);
      pin.visible = false;
      this.pins.set(r.id, pin);
      this.group.add(pin);
    }
  }

  /** Show exactly these hazards (storm cells, cloud deck). */
  setHazards(hazards: readonly HazardDef[]): void {
    const want = new Set<string>();
    this.deck.visible = false;
    for (const h of hazards) {
      if (h.kind === 'ceiling') {
        this.deck.visible = true;
        this.deck.position.y = h.y;
        continue;
      }
      want.add(h.id);
      if (!this.storms.has(h.id)) {
        const m = new StormCell(h.r, this.storms.size + 11);
        m.group.position.set(h.x, this.hf.sample(h.x, h.z), h.z);
        this.storms.set(h.id, m);
        this.group.add(m.group);
      }
      this.storms.get(h.id)!.group.visible = true;
    }
    for (const [id, m] of this.storms) if (!want.has(id)) m.group.visible = false;
  }

  setWaypoint(p: { x: number; z: number } | null): void {
    this.waypoint.visible = !!p;
    if (p) this.waypoint.position.set(p.x, this.hf.sample(p.x, p.z) + 260, p.z);
  }

  /** Build the hoops for a route (replacing the previous route's). */
  setRoute(route: Route | null): void {
    for (const r of this.rings) {
      this.group.remove(r.group);
      r.dispose();
    }
    this.rings = [];
    if (this.routeLine) {
      this.group.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      this.routeLine.material.dispose();
      this.routeLine = null;
    }
    if (!route) return;
    for (const g of route.gates) {
      if (g.kind !== 'ring') continue;
      const m = new RingMesh(g);
      this.rings.push(m);
      this.group.add(m.group);
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.rings.map((r) => new THREE.Vector3(r.ring.x, r.ring.y, r.ring.z))),
      new THREE.LineDashedMaterial({ color: AMBER, dashSize: 10, gapSize: 9, transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
    );
    line.computeLineDistances();
    this.routeLine = line;
    this.group.add(line);
  }

  /**
   * The route as the pilot sees it: the next ring bright and pulsing, the two
   * after it fading out ahead, passed rings pop and vanish, missed rings flash
   * red and drop away. Under contact the next ring shrinks and reddens as its
   * clock runs.
   */
  updateRoute(index: number, status: Record<string, GateStatus>, scale: number, urgency: number, dt: number, t: number): void {
    let n = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const m = this.rings[i];
      const st = status[m.ring.id];
      const k = i - this.ringIndex(index);
      if (st !== 'pending') {
        if (m.fx < 0) m.fx = 0;
        m.fx += dt;
        const f = Math.min(1, m.fx / (st === 'passed' ? 0.45 : 0.9));
        m.group.visible = f < 1;
        if (!m.group.visible) continue;
        m.group.scale.setScalar(st === 'passed' ? 1 + f * 0.7 : 1 - f * 0.3);
        if (st === 'missed') m.group.position.y = m.ring.y - f * 25;
        m.tube.material.color.copy(st === 'passed' ? RING_AMBER : RING_RED);
        m.tube.material.opacity = 1 - f;
        m.halo.material.opacity = 0.5 * (1 - f);
        m.fill.material.opacity = st === 'passed' ? 0.25 * (1 - f) : 0;
        continue;
      }
      m.fx = -1;
      m.group.position.y = m.ring.y;
      const show = k >= 0 && k <= 2;
      m.group.visible = show;
      if (!show) continue;
      if (k === 0) {
        const look = activeRingLook(scale, t);
        m.group.scale.setScalar(look.scale);
        m.tube.material.color.copy(RING_AMBER).lerp(RING_RED, urgency);
        m.halo.material.color.copy(m.tube.material.color);
        m.fill.material.color.copy(m.tube.material.color);
        m.tube.material.opacity = 1;
        m.halo.material.opacity = look.halo;
        m.fill.material.opacity = 0.07;
      } else {
        m.group.scale.setScalar(1);
        m.tube.material.color.copy(RING_DIM);
        m.halo.material.color.copy(RING_DIM);
        m.tube.material.opacity = k === 1 ? 0.55 : 0.28;
        m.halo.material.opacity = 0.06;
        m.fill.material.opacity = 0;
      }
      n++;
    }
    if (this.routeLine) {
      // the dashed line runs from the next ring onward: the route ahead, never behind
      const from = this.ringIndex(index);
      this.routeLine.visible = n > 1;
      this.routeLine.geometry.setDrawRange(Math.max(0, from), this.rings.length - Math.max(0, from));
    }
  }

  /** Route index (which may count a landing gate) → ring index. */
  private ringIndex(index: number): number {
    return Math.min(index, this.rings.length);
  }

  animate(t: number, dt: number): void {
    for (const m of this.storms.values()) if (m.group.visible) m.animate(t, dt);
  }

  /** Lightning from the nearest storm cell into the aircraft. */
  strikeAt(x: number, y: number, z: number): void {
    let best: StormCell | null = null;
    let bd = Infinity;
    for (const m of this.storms.values()) {
      if (!m.group.visible) continue;
      const d = Math.hypot(m.group.position.x - x, m.group.position.z - z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) best.strike({ x: x - best.group.position.x, y: y - best.group.position.y, z: z - best.group.position.z });
  }

  sync(movers: Map<ReturnId, RouteMover>, m: MissionState, t: number): void {
    for (const [id, mv] of movers) {
      this.vehicles.get(id)!.setPose(mv.x, mv.z, mv.heading, this.hf);
      const st = m.returns[id];
      const pin = this.pins.get(id)!;
      pin.visible = st.detected;
      if (!st.detected) continue;
      pin.position.set(mv.x, this.hf.sample(mv.x, mv.z), mv.z);
      const color = st.verdict === 'correct' ? 0xf2a93b : st.verdict === 'wrong' ? 0xff5a3c : st.resolved ? 0xf4f1e8 : 0x7cff9a;
      for (const n of ['beam', 'ring']) (pin.getObjectByName(n) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(color);
      pin.getObjectByName('ring')!.scale.setScalar(st.verdict === 'correct' ? 1 + 0.12 * Math.sin(t * 4) : 1);
    }
  }

  /** Render something without the world markers (the sensor camera sees the vehicles, not our pins). */
  withoutPins(fn: () => void): void {
    const was = [...this.pins.values()].map((p) => p.visible);
    for (const p of this.pins.values()) p.visible = false;
    const dest = this.destinationMarker.visible;
    const wp = this.waypoint.visible;
    this.destinationMarker.visible = false;
    this.waypoint.visible = false;
    fn();
    [...this.pins.values()].forEach((p, i) => (p.visible = was[i]));
    this.destinationMarker.visible = dest;
    this.waypoint.visible = wp;
  }

  showDestination(x: number, z: number, on: boolean): void {
    this.destinationMarker.visible = on;
    if (on) this.destinationMarker.position.set(x, this.hf.sample(x, z) + 1.8, z);
  }
}
