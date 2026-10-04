import * as THREE from 'three';
import { box } from '../world/props';
import type { HeightField } from '../world/terrain';
import { TruckMesh } from '../world/truck';
import { RETURNS, type ReturnId, type Sector } from './mission01';
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

  constructor(sector: Sector, private hf: HeightField) {
    this.group.add(sectorCurtain(sector, hf));
    for (const r of RETURNS) {
      const m: Pose = r.size === 'small' ? new ScoutMesh() : new TruckMesh();
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
    this.destinationMarker = new THREE.Mesh(new THREE.RingGeometry(26, 30, 40), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.destinationMarker.rotation.x = -Math.PI / 2;
    this.destinationMarker.visible = false;
    this.group.add(this.destinationMarker);
    this.group.visible = false;
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

  showDestination(x: number, z: number, on: boolean): void {
    this.destinationMarker.visible = on;
    if (on) this.destinationMarker.position.set(x, this.hf.sample(x, z) + 1.8, z);
  }
}
