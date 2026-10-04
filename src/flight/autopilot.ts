import { clamp, wrapAngle } from '../core/math';
import { FLIGHT, type AircraftState, type FlightInput, type FlightPerf } from './aircraft';

/**
 * Orbit autopilot. While the player is the operator, this produces the
 * stick and throttle input, and the unchanged flight model flies it. Nothing
 * about the aircraft is faked: it banks, turns and holds height with the same
 * physics the pilot uses.
 */
export interface Orbit {
  /** Centre the aircraft circles (moves when the operator re-tasks it). */
  x: number;
  z: number;
  /** Orbit radius, metres. */
  r: number;
  /** Height above ground to hold, metres. */
  agl: number;
  /** Throttle setting to hold, 0..1. */
  throttle: number;
}

/** Clockwise (seen from above) orbit guidance: tangent course plus a radial correction. */
export function orbitInput(a: AircraftState, o: Orbit, terrainAt: (x: number, z: number) => number, P: FlightPerf = FLIGHT): FlightInput {
  const dx = a.x - o.x;
  const dz = a.z - o.z;
  const dist = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / dist;
  const uz = dz / dist;
  // clockwise tangent in the x-east / z-south plane
  const tx = uz;
  const tz = -ux;
  // steer back onto the circle: inward when outside, outward when inside
  const k = clamp(((o.r - dist) / o.r) * 1.6, -2.5, 1.2);
  const wx = tx + ux * k;
  const wz = tz + uz * k;
  // forward is (-sin yaw, -cos yaw)
  const wantYaw = Math.atan2(-wx, -wz);
  const err = wrapAngle(wantYaw - a.yaw);
  // positive roll turns clockwise (yaw decreases)
  const roll = clamp(-err * 1.4, -0.85, 0.85);

  // height: hold AGL over the higher of the ground below and the ground ahead
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  const ground = Math.max(terrainAt(a.x, a.z), terrainAt(a.x + fx * 120, a.z + fz * 120));
  const wantY = ground + o.agl;
  const wantPitch = clamp((wantY - a.y) / 140, -0.22, 0.32);
  const pitch = clamp(wantPitch / P.maxPitch, -1, 1);

  const throttleDelta = clamp((o.throttle - a.throttle) * 4, -1, 1);
  return { roll, pitch, throttleDelta };
}
