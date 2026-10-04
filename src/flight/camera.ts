import * as THREE from 'three';
import { damp } from '../core/math';
import type { AircraftState } from './aircraft';

/** Chase camera: communicates speed, altitude and bank without nausea. */
export class ChaseCamera {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private fov = 62;
  private scanBlend = 0;
  private initialised = false;

  update(cam: THREE.PerspectiveCamera, a: AircraftState, dt: number, scanning: boolean, terrainAt: (x: number, z: number) => number): void {
    this.scanBlend = damp(this.scanBlend, scanning ? 1 : 0, 3, dt);
    const back = 30 + this.scanBlend * 10;
    const height = 9 + this.scanBlend * 16;
    const sy = Math.sin(a.yaw);
    const cy = Math.cos(a.yaw);
    // forward on the ground plane: (-sin yaw, -cos yaw)
    const desired = new THREE.Vector3(a.x + sy * back, a.y + height - Math.sin(a.pitch) * 8, a.z + cy * back);
    const ground = terrainAt(desired.x, desired.z) + 6;
    if (desired.y < ground) desired.y = ground;
    const lookAhead = 18 + a.speed * 0.25;
    const desiredLook = new THREE.Vector3(a.x - sy * lookAhead, a.y + Math.sin(a.pitch) * lookAhead * 0.6 - this.scanBlend * 10, a.z - cy * lookAhead);
    if (!this.initialised) {
      this.pos.copy(desired);
      this.look.copy(desiredLook);
      this.initialised = true;
    }
    const k = 1 - Math.exp(-dt * 5.5);
    this.pos.lerp(desired, k);
    this.look.lerp(desiredLook, 1 - Math.exp(-dt * 8));
    // the camera leans a little with the bank
    const rollTilt = -a.roll * 0.35;
    this.up.set(Math.sin(rollTilt) * 0.0 + Math.sin(rollTilt), Math.cos(rollTilt), 0);
    // rotate the up vector into the aircraft's heading frame
    const upWorld = new THREE.Vector3(Math.sin(rollTilt) * cy, Math.cos(rollTilt), -Math.sin(rollTilt) * sy);
    cam.position.copy(this.pos);
    cam.up.copy(upWorld);
    cam.lookAt(this.look);
    const targetFov = 60 + (a.speed - 32) * 0.2 + this.scanBlend * 4;
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  reset(): void {
    this.initialised = false;
  }
}
