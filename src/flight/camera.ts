import * as THREE from 'three';
import { damp } from '../core/math';
import type { AircraftState } from './aircraft';

export interface CameraFocus {
  /** 0: chase behind the helicopter. 1: the hoist view, high and looking down at the basket. */
  hoist: number;
  /** What the hoist view looks at (the basket, or the people under it). */
  look?: THREE.Vector3;
  /** Back the hoist view off by this much (m), to keep a wandering basket in frame. */
  pull?: number;
  /** Chase from further back (a big tanker: 2), and this much higher (m), to see the ground ahead. */
  dist?: number;
  lift?: number;
  /** An overview: the camera circles high over this point (the fire, at the end). */
  orbit?: { x: number; y: number; z: number; r: number; t: number; a0: number };
}

/**
 * Chase camera: communicates speed, altitude and bank without nausea. In a
 * hover it rises and tips down over the helicopter's shoulder so the basket,
 * the people and the ground between them are all in view.
 */
export class ChaseCamera {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov = 62;
  private blend = 0;
  private initialised = false;

  update(cam: THREE.PerspectiveCamera, a: AircraftState, dt: number, terrainAt: (x: number, z: number) => number, focus: CameraFocus = { hoist: 0 }): void {
    this.blend = damp(this.blend, focus.hoist, 2.2, dt);
    const h = this.blend;
    const sy = Math.sin(a.yaw);
    const cy = Math.cos(a.yaw);
    const back = 21 * (focus.dist ?? 1);
    const height = 6.5 * (focus.dist ?? 1) + (focus.lift ?? 0);
    const chasePos = new THREE.Vector3(a.x + sy * back, a.y + height, a.z + cy * back);
    // the hoist view: down by the people, behind and to the winch side, looking at the basket
    const hoistLook = focus.look ?? new THREE.Vector3(a.x, a.y - 18, a.z);
    const k = 1 + (focus.pull ?? 0) / 18;
    const hoistPos = new THREE.Vector3(hoistLook.x + (sy * 15 + cy * 8) * k, hoistLook.y + 12 * k, hoistLook.z + (cy * 15 - sy * 8) * k);
    const desired = chasePos.lerp(hoistPos, h);
    if (focus.orbit) {
      const o = focus.orbit;
      const ang = o.a0 + o.t * 0.16;
      desired.set(o.x + Math.sin(ang) * o.r, o.y + o.r * 0.55, o.z + Math.cos(ang) * o.r);
    }
    const ground = terrainAt(desired.x, desired.z) + 5;
    if (desired.y < ground) desired.y = ground;
    const lookAhead = 16 + a.speed * 0.35;
    const chaseLook = new THREE.Vector3(a.x - sy * lookAhead, a.y - 2 + Math.sin(a.pitch) * 6, a.z - cy * lookAhead);
    const desiredLook = focus.orbit ? new THREE.Vector3(focus.orbit.x, focus.orbit.y, focus.orbit.z) : chaseLook.lerp(hoistLook, h);
    if (!this.initialised) {
      this.pos.copy(desired);
      this.look.copy(desiredLook);
      this.initialised = true;
    }
    this.pos.lerp(desired, 1 - Math.exp(-dt * (focus.orbit ? 1.4 : 5)));
    this.look.lerp(desiredLook, 1 - Math.exp(-dt * (focus.orbit ? 2 : 7)));
    // the camera leans a little with the bank (not in the hover)
    const rollTilt = focus.orbit ? 0 : -a.roll * 0.3 * (1 - h);
    cam.position.copy(this.pos);
    cam.up.set(Math.sin(rollTilt) * cy, Math.cos(rollTilt), -Math.sin(rollTilt) * sy);
    cam.lookAt(this.look);
    const targetFov = 60 + a.speed * 0.18 + h * 6;
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  reset(): void {
    this.initialised = false;
    this.blend = 0;
  }
}
