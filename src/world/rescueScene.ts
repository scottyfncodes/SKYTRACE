import * as THREE from 'three';
import { rng } from '../core/math';
import type { HeightField } from './terrain';
import { box, gable, mat, place } from './props';
import { PADS, type PadId } from './worldData';
import type { SurvivorLook } from '../rescue/missions';
import type { SurvivorState } from '../rescue/hoist';

/**
 * Everything the rescue adds to the valley: helipads, the hospital, the
 * rescue base, the people waiting on the mountain, the basket and its cable,
 * and the signals and markers that make the job readable from the air.
 */

// ---------------------------------------------------------------- textures
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function padTexture(color: string): THREE.CanvasTexture {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = '#3d4248';
    c.beginPath();
    c.arc(128, 128, 126, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 14;
    c.strokeStyle = color;
    c.beginPath();
    c.arc(128, 128, 104, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = 'bold 150px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('H', 128, 136);
  });
}

function pinTexture(fill: string, glyph: 'person' | 'h' | 'search'): THREE.CanvasTexture {
  return canvasTex(128, 160, (c) => {
    c.fillStyle = fill;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 8;
    c.beginPath();
    c.arc(64, 60, 52, Math.PI * 0.82, Math.PI * 0.18);
    c.lineTo(64, 152);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = '#ffffff';
    if (glyph === 'person') {
      c.beginPath();
      c.arc(64, 40, 13, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(42, 90);
      c.quadraticCurveTo(44, 58, 64, 58);
      c.quadraticCurveTo(84, 58, 86, 90);
      c.closePath();
      c.fill();
    } else if (glyph === 'h') {
      c.font = 'bold 64px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('H', 64, 64);
    } else {
      c.lineWidth = 9;
      c.strokeStyle = '#ffffff';
      c.beginPath();
      c.arc(58, 54, 20, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(72, 68);
      c.lineTo(90, 86);
      c.stroke();
    }
  });
}

function crossTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (c) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#e23d28';
    c.fillRect(46, 18, 36, 92);
    c.fillRect(18, 46, 92, 36);
  });
}

// ---------------------------------------------------------------- props
export interface RescueProps {
  group: THREE.Group;
  /** Pad beacons, keyed by pad: shown when that pad is where to go. */
  padBeacon: Record<PadId, THREE.Mesh>;
  /** Blue lights on the ambulance. */
  ambulanceLights: THREE.Mesh[];
  /** Where the ambulance waits (world). */
  ambulance: THREE.Vector3;
}

export function buildRescueProps(hf: HeightField): RescueProps {
  const g = new THREE.Group();
  const padBeacon = {} as Record<PadId, THREE.Mesh>;
  for (const p of Object.values(PADS)) {
    const y = hf.sample(p.x, p.z);
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 1.2, p.r + 1.6, 1.2, 32), mat(0xd9d4c7));
    slab.position.set(p.x, y + 0.2, p.z);
    const top = new THREE.Mesh(new THREE.CircleGeometry(p.r, 40), new THREE.MeshLambertMaterial({ map: padTexture(p.id === 'hospital' ? '#e23d28' : '#ffd23f') }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(p.x, y + 0.82, p.z);
    g.add(slab, top);
    // edge lights
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: p.id === 'hospital' ? 0x6dff9a : 0xffd23f }));
      l.position.set(p.x + Math.cos(a) * (p.r + 0.9), y + 1.0, p.z + Math.sin(a) * (p.r + 0.9));
      g.add(l);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.8, p.r, 260, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x6dff9a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.set(p.x, y + 130, p.z);
    beam.visible = false;
    g.add(beam);
    padBeacon[p.id] = beam;
  }

  // Varrow Hospital: white blocks, red crosses, a red stripe
  const H = PADS.hospital;
  const hosp = new THREE.Group();
  hosp.add(box(30, 10, 16, 0xf3f1ea));
  const wing = box(14, 14, 14, 0xf3f1ea);
  wing.position.set(-10, 0, 0);
  hosp.add(wing);
  const stripe = box(30.2, 1.4, 16.2, 0xe23d28);
  stripe.position.y = 7.5;
  hosp.add(stripe);
  const glassBand = box(30.3, 1.6, 16.3, 0x7fc4e6);
  glassBand.position.y = 3.2;
  hosp.add(glassBand);
  const crossMat = new THREE.MeshLambertMaterial({ map: crossTexture() });
  for (const [x, y, z, ry] of [
    [-10, 10, 7.1, 0],
    [-10, 10, -7.1, Math.PI],
    [15.1, 6, 0, Math.PI / 2],
  ] as const) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), crossMat);
    sign.position.set(x, y, z);
    sign.rotation.y = ry;
    hosp.add(sign);
  }
  const roofCross = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), crossMat);
  roofCross.rotation.x = -Math.PI / 2;
  roofCross.position.set(-10, 14.05, 0);
  hosp.add(roofCross);
  g.add(place(hosp, hf, H.x + 34, H.z - 6, 0.12, 0.3));

  // the ambulance waiting by the pad
  const amb = new THREE.Group();
  const bodyA = box(5.2, 2.4, 2.4, 0xffffff);
  bodyA.position.y = 0.6;
  const cab = box(1.6, 1.8, 2.3, 0xffffff);
  cab.position.set(-3.2, 0.6, 0);
  const band = box(6.9, 0.45, 2.45, 0xe23d28);
  band.position.set(-0.8, 1.6, 0);
  const ws = box(0.1, 0.9, 2.0, 0x7fc4e6);
  ws.position.set(-4.0, 1.7, 0);
  amb.add(bodyA, cab, band, ws);
  for (const [x, z] of [
    [-3, -1.2],
    [-3, 1.2],
    [1.6, -1.2],
    [1.6, 1.2],
  ]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 10), mat(0x24272b));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.5, z);
    amb.add(w);
  }
  const ambulanceLights: THREE.Mesh[] = [];
  for (const z of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), new THREE.MeshBasicMaterial({ color: 0x3aa0ff }));
    l.position.set(-2.8, 3.15, z);
    amb.add(l);
    ambulanceLights.push(l);
  }
  const ambPos = new THREE.Vector3(H.x + 6, 0, H.z + 18);
  g.add(place(amb, hf, ambPos.x, ambPos.z, 0.4, 0));
  ambPos.y = hf.sample(ambPos.x, ambPos.z);

  // the rescue base: a red-roofed crew building and a fuel bowser by the pad
  const B = PADS.base;
  const crewHut = new THREE.Group();
  crewHut.add(box(16, 5, 9, 0xf3f1ea));
  const r = gable(16.6, 3, 9.6, 0xe23d28);
  r.position.y = 5;
  crewHut.add(r);
  const door = box(3, 3.4, 0.2, 0xe23d28);
  door.position.set(0, 0, 4.6);
  crewHut.add(door);
  g.add(place(crewHut, hf, B.x + 26, B.z - 18, -0.1));
  const bowser = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 5, 12), mat(0xffd23f));
  tank.rotation.z = Math.PI / 2;
  tank.position.y = 1.6;
  bowser.add(tank, box(1.6, 1.8, 2.2, 0xe23d28));
  bowser.children[1].position.x = -3.3;
  g.add(place(bowser, hf, B.x - 20, B.z + 14, 0.7));

  return { group: g, padBeacon, ambulanceLights, ambulance: ambPos };
}

/** A camp on a ledge: a tent and a pile of kit, so the spot reads as "people are here". */
export function buildCamp(hf: HeightField, x: number, z: number, look: SurvivorLook): THREE.Group {
  const g = new THREE.Group();
  const r = rng(Math.round(x * 13 + z));
  const tent = gable(3.2, 1.8, 2.6, look === 'hiker' ? 0x7a5cff : 0xff8a1f);
  const tx = x + 4.2;
  const tz = z - 3.4;
  tent.position.set(tx, hf.sample(tx, tz) - 0.1, tz);
  tent.rotation.y = r() * Math.PI;
  g.add(tent);
  const pack = box(0.8, 1.1, 0.5, 0x2e7dd1);
  g.add(place(pack, hf, x - 3, z + 2.5, r() * 3));
  if (look === 'climber') {
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 6, 14), mat(0xffd23f));
    rope.rotation.x = -Math.PI / 2;
    g.add(place(rope, hf, x - 2, z - 2.8, 0, -0.1));
  }
  return g;
}

// ---------------------------------------------------------------- people
const JACKETS: Record<SurvivorLook, number[]> = { climber: [0xff7a1a, 0x1fb5a8, 0xffd23f, 0xe23d6b], hiker: [0x8a5cff], skier: [0x2e7dd1, 0xff4d6d] };
const HATS: Record<SurvivorLook, number[]> = { climber: [0xffd23f, 0xe23d28, 0x2e7dd1, 0xffffff], hiker: [0x3a8f3a], skier: [0xffffff, 0x222222] };

/**
 * A stranded person, built big and bright (a third over life size) so they
 * read from the air: they wave while they wait, walk to the basket, and sit
 * in it on the way up.
 */
export class SurvivorMesh {
  readonly group = new THREE.Group();
  private armL: THREE.Group;
  private armR: THREE.Group;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private torso = new THREE.Group();
  private phase: number;

  constructor(look: SurvivorLook, i: number) {
    const jacket = mat(JACKETS[look][i % JACKETS[look].length]);
    const hat = mat(HATS[look][i % HATS[look].length]);
    const skin = mat([0xf2c9a0, 0xc68a5c, 0x8d5a3b, 0xe8b48a][i % 4]);
    const trousers = mat(0x2f3a4a);
    this.phase = i * 1.7;
    this.group.scale.setScalar(1.6);
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.28), trousers);
    this.legL.geometry.translate(0, -0.4, 0);
    this.legL.position.set(-0.15, 0.82, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.15;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.38), jacket);
    body.position.y = 1.18;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.26), mat(0x3b4a5c));
    pack.position.set(0, 1.2, 0.3);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), skin);
    head.position.y = 1.78;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat);
    helmet.position.y = 1.82;
    const arm = () => {
      const a = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.66, 0.2), jacket);
      m.position.y = -0.3;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), skin);
      hand.position.y = -0.66;
      a.add(m, hand);
      return a;
    };
    this.armL = arm();
    this.armL.position.set(-0.4, 1.48, 0);
    this.armR = arm();
    this.armR.position.set(0.4, 1.48, 0);
    this.torso.add(body, pack, head, helmet, this.armL, this.armR);
    this.group.add(this.legL, this.legR, this.torso);
  }

  /** Pose for a state. `face`: the yaw to look toward. */
  update(state: SurvivorState, x: number, y: number, z: number, face: number, t: number): void {
    this.group.visible = state !== 'aboard' && state !== 'delivered';
    if (!this.group.visible) return;
    this.group.position.set(x, y, z);
    this.group.rotation.y = face;
    const p = t * 6 + this.phase;
    this.torso.position.y = 0;
    this.legL.visible = this.legR.visible = state !== 'basket';
    if (state === 'waiting') {
      // big two-armed waves: "over here!"
      this.armL.rotation.set(0, 0, Math.PI - 0.5 + Math.sin(p) * 0.45);
      this.armR.rotation.set(0, 0, -Math.PI + 0.5 + Math.sin(p + 1) * 0.45);
      this.legL.rotation.x = this.legR.rotation.x = 0;
      this.torso.position.y = Math.abs(Math.sin(p * 0.5)) * 0.06;
    } else if (state === 'walking') {
      const k = Math.sin(t * 9 + this.phase);
      this.legL.rotation.x = k * 0.6;
      this.legR.rotation.x = -k * 0.6;
      this.armL.rotation.set(-k * 0.5, 0, 0.1);
      this.armR.rotation.set(k * 0.5, 0, -0.1);
    } else if (state === 'boarding') {
      this.legL.rotation.x = -0.9;
      this.legR.rotation.x = 0.2;
      this.armL.rotation.set(-2.6, 0, 0.2);
      this.armR.rotation.set(-2.6, 0, -0.2);
    } else {
      // in the basket: sat down, holding on, a thumbs up now and then
      this.torso.position.y = -0.55;
      this.armL.rotation.set(-0.4, 0, 0.5);
      this.armR.rotation.set(0, 0, -Math.PI + 0.3 + Math.sin(p * 0.6) * 0.2);
    }
  }
}

// ---------------------------------------------------------------- basket + cable
export class BasketMesh {
  readonly group = new THREE.Group();
  readonly cable: THREE.Mesh;
  /** A dark spot on the ground under the basket: depth at a glance. */
  readonly shadow: THREE.Mesh;

  constructor() {
    const orange = mat(0xff6a1a);
    const W = 1.5;
    const D = 1.0;
    const H = 0.8;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, D), orange);
    floor.position.y = 0.06;
    this.group.add(floor);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), orange);
        post.position.set((sx * W) / 2, H / 2, (sz * D) / 2);
        this.group.add(post);
      }
    for (const y of [H * 0.5, H]) {
      for (const sz of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, 0.08), orange);
        rail.position.set(0, y, (sz * D) / 2);
        this.group.add(rail);
      }
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, D), orange);
        rail.position.set((sx * W) / 2, y, 0);
        this.group.add(rail);
      }
    }
    // bridle to the hook
    const bridleMat = mat(0x333333);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 4), bridleMat);
        b.position.set((sx * W) / 4, H + 0.45, (sz * D) / 4);
        b.rotation.set(sz * 0.55, 0, -sx * 0.75);
        this.group.add(b);
      }
    const hook = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mat(0xffd23f));
    hook.position.y = H + 0.95;
    this.group.add(hook);
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), mat(0x1d1f22));
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
  }

  /** Basket at (x, y, z) facing `yaw`; cable from the winch to the hook. */
  update(x: number, y: number, z: number, yaw: number, winch: THREE.Vector3, groundY: number, len: number): void {
    const show = len > 0.05;
    this.group.visible = this.cable.visible = true;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    const top = new THREE.Vector3(x, y + 1.75, z);
    const d = winch.clone().sub(top);
    const L = Math.max(0.01, d.length());
    this.cable.visible = show;
    this.cable.position.copy(top).addScaledVector(d, 0.5);
    this.cable.scale.set(1, L, 1);
    this.cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.shadow.visible = show && y - groundY > 0.5;
    this.shadow.position.set(x, groundY + 0.25, z);
    const k = Math.min(1, (y - groundY) / 30);
    this.shadow.scale.setScalar(1 + k * 0.6);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 - k * 0.22;
  }
}

// ---------------------------------------------------------------- markers + signals
/** A pin floating over a place, a soft beam under it. Bobs; scales with distance so it stays readable. */
export class Marker {
  readonly group = new THREE.Group();
  private pin: THREE.Sprite;
  private beam: THREE.Mesh;
  private kind: 'person' | 'h' | 'search' = 'person';
  private mats: Record<'person' | 'h' | 'search', THREE.SpriteMaterial>;

  constructor() {
    this.mats = {
      person: new THREE.SpriteMaterial({ map: pinTexture('#ff6a1a', 'person'), depthTest: false, transparent: true }),
      h: new THREE.SpriteMaterial({ map: pinTexture('#22b35e', 'h'), depthTest: false, transparent: true }),
      search: new THREE.SpriteMaterial({ map: pinTexture('#2e7dd1', 'search'), depthTest: false, transparent: true }),
    };
    this.pin = new THREE.Sprite(this.mats.person);
    this.pin.center.set(0.5, 0);
    this.pin.renderOrder = 20;
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.group.add(this.pin, this.beam);
  }

  set(kind: 'person' | 'h' | 'search'): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.pin.material = this.mats[kind];
    (this.beam.material as THREE.MeshBasicMaterial).color.setHex(kind === 'h' ? 0x6dff9a : kind === 'search' ? 0x5fb0ff : 0xff8a3a);
  }

  /** `height`: how high the pin floats over the ground point. */
  update(x: number, groundY: number, z: number, cam: THREE.Camera, t: number, height = 24): void {
    const d = cam.position.distanceTo(new THREE.Vector3(x, groundY, z));
    const s = Math.max(5, d * 0.045);
    const lift = height + Math.max(0, (d - 150) * 0.04);
    this.pin.position.set(x, groundY + lift + Math.sin(t * 2.4) * s * 0.08, z);
    this.pin.scale.set(s * 0.8, s, 1);
    this.beam.position.set(x, groundY + lift / 2, z);
    this.beam.scale.set(Math.max(1, s * 0.12), lift, Math.max(1, s * 0.12));
  }
}

/** A see-through drum standing over the search area: "they are somewhere in here". */
export function searchArea(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x5fb0ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 3;
  return m;
}

/** A ring on the ground around the people: drop the basket inside it. */
export function reachRing(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 15;
  return m;
}

/** Signal flares and smoke columns: soft puffs that rise, spread and fade. */
export class Signals {
  readonly group = new THREE.Group();
  private puffs: { m: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number; grow: number }[] = [];
  private flares: { head: THREE.Mesh; light: THREE.Sprite; vy: number; t: number; x: number; y: number; z: number }[] = [];
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);
  private glow = new THREE.SpriteMaterial({ map: canvasTex(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.25, 'rgba(255,90,40,0.9)');
    g.addColorStop(1, 'rgba(255,40,20,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  }), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  private smokeIn = 0;

  /** Fire a flare straight up from a ground point. */
  flare(x: number, y: number, z: number): void {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b20 }));
    const light = new THREE.Sprite(this.glow);
    light.scale.setScalar(26);
    this.group.add(head, light);
    this.flares.push({ head, light, vy: 46, t: 0, x, y: y + 1.5, z });
  }

  private puff(x: number, y: number, z: number, color: number, size: number, life: number, vy: number, wind: { x: number; z: number }): void {
    const m = new THREE.Mesh(this.puffGeo, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, flatShading: true }));
    m.position.set(x, y, z);
    m.scale.setScalar(size);
    this.group.add(m);
    this.puffs.push({ m, vx: wind.x * 0.5 + (Math.random() - 0.5), vy, vz: wind.z * 0.5 + (Math.random() - 0.5), life, max: life, grow: size * 1.4 });
  }

  /** `smokeAt`: a campfire to keep smoking (or null). */
  update(dt: number, wind: { x: number; z: number }, smokeAt: THREE.Vector3 | null): void {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t += dt;
      f.vy = Math.max(-2.5, f.vy - 22 * dt);
      f.y += f.vy * dt;
      f.x += wind.x * 0.4 * dt;
      f.z += wind.z * 0.4 * dt;
      f.head.position.set(f.x, f.y, f.z);
      f.light.position.copy(f.head.position);
      const fade = f.t < 9 ? 1 : Math.max(0, 1 - (f.t - 9) / 2);
      f.light.scale.setScalar((22 + Math.sin(f.t * 30) * 4) * fade + 0.01);
      if (Math.random() < dt * 30) this.puff(f.x, f.y, f.z, 0xffb0a0, 1.6, 4, 1, wind);
      if (f.t > 11) {
        this.group.remove(f.head, f.light);
        this.flares.splice(i, 1);
      }
    }
    if (smokeAt) {
      this.smokeIn -= dt;
      if (this.smokeIn <= 0) {
        this.smokeIn = 0.22;
        this.puff(smokeAt.x + (Math.random() - 0.5) * 1.5, smokeAt.y + 1, smokeAt.z + (Math.random() - 0.5) * 1.5, 0xe9e6df, 2.2, 9, 7, wind);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.vx += wind.x * 0.15 * dt;
      p.vz += wind.z * 0.15 * dt;
      const k = 1 - p.life / p.max;
      p.m.scale.setScalar(p.grow * (0.7 + k * 2.6));
      (p.m.material as THREE.MeshLambertMaterial).opacity = 0.65 * (1 - k);
      if (p.life <= 0) {
        this.group.remove(p.m);
        (p.m.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const p of this.puffs) {
      this.group.remove(p.m);
      (p.m.material as THREE.Material).dispose();
    }
    for (const f of this.flares) this.group.remove(f.head, f.light);
    this.puffs = [];
    this.flares = [];
  }

  /** Flares in the air right now (for the camera to glance at, and tests). */
  get flaresUp(): number {
    return this.flares.length;
  }
}

/** Confetti-like sparkles when someone is secured: a short burst of bright bits. */
export class Burst {
  readonly group = new THREE.Group();
  private bits: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private geo = new THREE.BoxGeometry(0.35, 0.35, 0.08);
  fire(at: THREE.Vector3): void {
    const colors = [0xffd23f, 0x6dff9a, 0xffffff, 0xff6a1a, 0x5fb0ff];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
      m.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 7;
      this.bits.push({ m, v: new THREE.Vector3(Math.cos(a) * s, 5 + Math.random() * 8, Math.sin(a) * s), life: 1.4 + Math.random() * 0.6 });
      this.group.add(m);
    }
  }
  update(dt: number): void {
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= dt;
      b.v.y -= 14 * dt;
      b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += dt * 9;
      b.m.rotation.y += dt * 7;
      (b.m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, b.life * 2);
      if (b.life <= 0) {
        this.group.remove(b.m);
        (b.m.material as THREE.Material).dispose();
        this.bits.splice(i, 1);
      }
    }
  }
}
