/**
 * Route guidance in the world: the escape gates, a ribbon of chevrons in the
 * sky toward wherever you are going next, the aircraft's shadow on the
 * ground (how high am I?), and the contacts recon has to check.
 */
import * as THREE from 'three';
import type { Gate, GateResult } from '../rescue/route';
import type { Contact, ScanState } from '../rescue/recon';
import type { HeightField } from './terrain';
import { pinTexture } from './rescueScene';
import { blink, buildVehicle, placeVehicle, type VehicleView } from './vehicles';

const NEXT = new THREE.Color(0xffb321);
const AFTER = new THREE.Color(0xffffff);
const DONE = new THREE.Color(0x6dff9a);
const MISS = new THREE.Color(0xff5a3c);

/** The escape gates: the next one bright and pulsing, the one after it faint, the rest hidden until they matter. */
export class GateView {
  readonly group = new THREE.Group();
  private rings: { ring: THREE.Mesh; stalk: THREE.Mesh; mat: THREE.MeshBasicMaterial; flash: number; hit: boolean }[] = [];

  setup(gates: Gate[], hf: HeightField): void {
    this.clear();
    for (const g of gates) {
      const mat = new THREE.MeshBasicMaterial({ color: AFTER, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(g.r, 0.9, 8, 40), mat);
      ring.position.set(g.x, g.y, g.z);
      ring.rotation.y = Math.atan2(g.nx, g.nz);
      ring.renderOrder = 12;
      const h = g.y - g.r - hf.sample(g.x, g.z);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, Math.max(1, h), 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
      stalk.position.set(g.x, g.y - g.r - Math.max(1, h) / 2, g.z);
      this.group.add(ring, stalk);
      this.rings.push({ ring, stalk, mat, flash: 0, hit: false });
    }
    this.group.visible = false;
  }

  clear(): void {
    for (const r of this.rings) {
      r.ring.geometry.dispose();
      r.mat.dispose();
      r.stalk.geometry.dispose();
      (r.stalk.material as THREE.Material).dispose();
      this.group.remove(r.ring, r.stalk);
    }
    this.rings = [];
  }

  /** A gate was just flown (or missed): a quick burst of colour. */
  flash(i: number, hit: boolean): void {
    const r = this.rings[i];
    if (!r) return;
    r.flash = 1;
    r.hit = hit;
  }

  update(active: boolean, next: number, result: readonly GateResult[], t: number, dt: number): void {
    this.group.visible = active || this.rings.some((r) => r.flash > 0);
    this.rings.forEach((r, i) => {
      if (r.flash > 0) {
        r.flash = Math.max(0, r.flash - dt * 1.6);
        r.ring.visible = true;
        r.stalk.visible = false;
        r.mat.color.copy(r.hit ? DONE : MISS);
        r.mat.opacity = r.flash;
        r.ring.scale.setScalar(1 + (1 - r.flash) * 0.6);
        return;
      }
      r.ring.scale.setScalar(1);
      const show = active && result[i] === 'pending' && i <= next + 2;
      r.ring.visible = r.stalk.visible = show;
      if (!show) return;
      if (i === next) {
        r.mat.color.copy(NEXT);
        r.mat.opacity = 0.85 + 0.15 * Math.sin(t * 5);
      } else {
        r.mat.color.copy(AFTER);
        r.mat.opacity = i === next + 1 ? 0.55 : 0.25;
      }
    });
  }
}

/**
 * A ribbon of chevrons in the air from the aircraft toward the next target,
 * so after any change of view (out of the hover, off the pad) the way on is
 * obvious at a glance. Stronger when you are pointing the wrong way.
 */
export class RouteRibbon {
  readonly mesh: THREE.InstancedMesh;
  private readonly n = 7;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private mat: THREE.MeshBasicMaterial;

  constructor() {
    const shape = new THREE.Shape();
    // a flat chevron pointing along +z
    shape.moveTo(0, 2.4);
    shape.lineTo(3.2, -0.8);
    shape.lineTo(2.1, -1.9);
    shape.lineTo(0, 0.2);
    shape.lineTo(-2.1, -1.9);
    shape.lineTo(-3.2, -0.8);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);
    geo.rotateY(Math.PI);
    this.mat = new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.n);
    this.mesh.renderOrder = 11;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** `from`: the aircraft. `to`: the target (null hides it). `yaw`: the aircraft's heading. */
  update(from: { x: number; y: number; z: number }, yaw: number, to: { x: number; y: number; z: number } | null, t: number, color = 0x9fe4ff): void {
    if (!to) {
      this.mesh.visible = false;
      return;
    }
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 70) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const ux = dx / d;
    const uz = dz / d;
    // how far off the nose the target is: 0 dead ahead, 1 behind
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const off = (1 - (ux * fx + uz * fz)) / 2;
    this.mat.color.setHex(color);
    this.mat.opacity = 0.32 + off * 0.5;
    const heading = Math.atan2(ux, uz);
    const span = Math.min(d - 30, 200);
    const flow = (t * 30) % 28;
    for (let i = 0; i < this.n; i++) {
      const s = Math.min(span, 26 + i * 28 + flow);
      const k = s / d;
      const y = from.y - 3 + (to.y - from.y) * Math.min(1, k) * 0.6;
      this.e.set(0, heading, 0);
      this.q.setFromEuler(this.e);
      const fade = i === this.n - 1 ? 1 - flow / 28 : i === 0 ? flow / 28 : 1;
      const sc = s >= span ? 0.001 : 0.8 + 0.6 * fade;
      this.m.compose(new THREE.Vector3(from.x + ux * s, y, from.z + uz * s), this.q, new THREE.Vector3(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** A soft dark shadow on the ground under the aircraft: shrinks and darkens as it comes down. */
export class GroundShadow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
  }

  update(x: number, z: number, agl: number, groundY: number, yaw: number, size: number): void {
    const k = Math.max(0, 1 - agl / 140);
    this.mesh.visible = k > 0.02;
    if (!this.mesh.visible) return;
    this.mesh.position.set(x, groundY + 0.4, z);
    this.mesh.rotation.z = yaw;
    const s = size * (1 + agl / 60);
    this.mesh.scale.set(s, s * 1.2, 1);
    this.mat.opacity = 0.55 * k;
  }
}

/** The vehicles recon has to check, with a "?" over each one not yet identified and a ✓ over the ones cleared. */
export class ContactView {
  readonly group = new THREE.Group();
  private items: { v: VehicleView; pin: THREE.Sprite; c: Contact }[] = [];
  private query = new THREE.SpriteMaterial({ map: pinTexture('#ffb321', 'query'), depthTest: false, transparent: true });
  private check = new THREE.SpriteMaterial({ map: pinTexture('#7b8794', 'check'), depthTest: false, transparent: true });
  private scanRing: THREE.Mesh;

  constructor() {
    this.scanRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffb321, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.scanRing.rotation.x = -Math.PI / 2;
    this.scanRing.renderOrder = 14;
    this.group.add(this.scanRing);
  }

  setup(contacts: readonly Contact[], hf: HeightField): void {
    this.clear();
    for (const c of contacts) {
      const v = buildVehicle(c.kind);
      placeVehicle(v, c, hf);
      const pin = new THREE.Sprite(this.query);
      pin.center.set(0.5, 0);
      pin.renderOrder = 20;
      this.group.add(v.group, pin);
      this.items.push({ v, pin, c });
    }
  }

  clear(): void {
    for (const it of this.items) this.group.remove(it.v.group, it.pin);
    this.items = [];
    this.scanRing.visible = false;
  }

  update(scan: ScanState | null, spotted: boolean, hf: HeightField, cam: THREE.Camera, t: number): void {
    this.scanRing.visible = false;
    this.items.forEach((it, i) => {
      blink(it.v, t + i * 0.3);
      const id = scan?.identified[i] ?? false;
      // once they are found the pins step aside for the rescue marker
      it.pin.visible = !!scan && !spotted && !(id && it.c.target);
      if (!it.pin.visible) return;
      it.pin.material = id ? this.check : this.query;
      const gy = hf.sample(it.c.x, it.c.z);
      const d = cam.position.distanceTo(new THREE.Vector3(it.c.x, gy, it.c.z));
      const s = Math.max(4, d * (id ? 0.03 : 0.04));
      it.pin.position.set(it.c.x, gy + 10 + s * 0.4 + (id ? 0 : Math.sin(t * 3 + i) * s * 0.06), it.c.z);
      it.pin.scale.set(s * 0.8, s, 1);
      if (scan && scan.looking === i) {
        const p = scan.progress[i];
        this.scanRing.visible = true;
        this.scanRing.position.set(it.c.x, gy + 0.6, it.c.z);
        this.scanRing.scale.setScalar(16 - p * 7);
        (this.scanRing.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * p;
      }
    });
  }
}
