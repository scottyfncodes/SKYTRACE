import * as THREE from 'three';
import { mat } from '../world/props';
import type { HeightField } from '../world/terrain';

/**
 * A dropped sensor package: ballistic for a moment, then under a parachute,
 * then a landed beacon. Pure physics in `step`, visuals in the group.
 */
export class SensorPackage {
  readonly group = new THREE.Group();
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age = 0;
  landed = false;
  /** Set once registered in the investigation state. */
  id: string | null = null;
  private chute: THREE.Mesh;
  private led: THREE.Mesh;

  constructor(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), mat(0xd7b54a));
    body.position.y = 0.5;
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4), mat(0x333333));
    antenna.position.y = 2;
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), new THREE.MeshBasicMaterial({ color: 0x5bff6a }));
    this.led.position.y = 3.3;
    this.chute = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf1e7cf, side: THREE.DoubleSide }));
    this.chute.position.y = 6;
    this.chute.visible = false;
    const lines = new THREE.Mesh(new THREE.ConeGeometry(3.1, 5.5, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xcccccc, wireframe: true, transparent: true, opacity: 0.4 }));
    lines.position.y = 3.3;
    lines.visible = false;
    this.chute.userData.lines = lines;
    this.group.add(body, antenna, this.led, this.chute, lines);
    this.group.position.set(x, y, z);
  }

  /** Landed sensors from a previous sortie are placed directly. */
  static landedAt(x: number, z: number, hf: HeightField, id: string): SensorPackage {
    const p = new SensorPackage(x, hf.sample(x, z), z, 0, 0, 0);
    p.landed = true;
    p.id = id;
    p.age = 999;
    p.group.position.set(x, hf.sample(x, z), z);
    return p;
  }

  step(dt: number, hf: HeightField, t: number): boolean {
    if (!this.landed) {
      this.age += dt;
      const chuteOpen = this.age > 1.1;
      this.chute.visible = chuteOpen;
      (this.chute.userData.lines as THREE.Mesh).visible = chuteOpen;
      const drag = chuteOpen ? 1.6 : 0.08;
      this.vy -= 9.8 * dt;
      if (chuteOpen && this.vy < -11) this.vy = Math.max(this.vy, -11) + (-11 - this.vy) * 0.2;
      this.vx -= this.vx * drag * dt;
      this.vz -= this.vz * drag * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      const g = hf.sample(this.x, this.z);
      if (this.y <= g) {
        this.y = g;
        this.landed = true;
        this.chute.visible = false;
        (this.chute.userData.lines as THREE.Mesh).visible = false;
        this.group.position.set(this.x, this.y, this.z);
        return true; // just landed
      }
      this.group.position.set(this.x, this.y, this.z);
      this.group.rotation.z = Math.sin(t * 2) * 0.1;
    } else {
      (this.led.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(t * 2) % 2 === 0 ? 0x5bff6a : 0x1d4d22);
    }
    return false;
  }
}
