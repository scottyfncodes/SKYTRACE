import { approach, clamp, damp, wrapAngle } from '../core/math';

export interface AircraftState {
  x: number;
  y: number;
  z: number;
  /** yaw: 0 faces -Z (north), positive turns toward -X (west) i.e. counter-clockwise seen from above */
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number; // 0..1
  agl: number;
  terrainWarning: boolean;
  boundaryWarning: boolean;
}

export interface FlightInput {
  roll: number; // -1..1 (positive = bank right)
  pitch: number; // -1..1 (positive = climb)
  throttleDelta: number; // -1..1 per second
}

/** Performance profile. Aircraft differ by profile; the default is the original SKYTRACE aircraft. */
export interface FlightPerf {
  minSpeed: number;
  maxSpeed: number;
  maxRoll: number;
  maxPitch: number;
  rollRate: number;
  pitchRate: number;
  turnGain: number;
  accel: number;
  ceiling: number;
  floorAgl: number;
  bounds: number;
}

export const FLIGHT: FlightPerf = {
  minSpeed: 32,
  maxSpeed: 92,
  maxRoll: 1.05, // ~60 deg
  maxPitch: 0.55, // ~31 deg
  rollRate: 2.6,
  pitchRate: 1.6,
  turnGain: 0.95, // yaw rate per unit sin(roll)
  accel: 0.9,
  ceiling: 820,
  floorAgl: 14,
  bounds: 1180,
};

export function initialAircraft(x: number, y: number, z: number, yaw: number): AircraftState {
  return { x, y, z, yaw, pitch: 0, roll: 0, speed: 58, throttle: 0.55, agl: 0, terrainWarning: false, boundaryWarning: false };
}

export function forwardVector(a: Pick<AircraftState, 'yaw' | 'pitch'>): [number, number, number] {
  const cp = Math.cos(a.pitch);
  return [-Math.sin(a.yaw) * cp, Math.sin(a.pitch), -Math.cos(a.yaw) * cp];
}

/** One simulation step. Pure, deterministic, frame-rate independent. */
export function stepAircraft(a: AircraftState, inp: FlightInput, dt: number, terrainHeight: (x: number, z: number) => number, P: FlightPerf = FLIGHT): AircraftState {
  const s: AircraftState = { ...a };
  dt = clamp(dt, 0, 0.05);

  // throttle
  s.throttle = clamp(s.throttle + inp.throttleDelta * 0.6 * dt, 0, 1);

  // attitude: bank follows stick, nose follows stick, both self-centre
  const targetRoll = clamp(inp.roll, -1, 1) * P.maxRoll;
  s.roll = approach(s.roll, targetRoll, P.rollRate * dt);
  const targetPitch = clamp(inp.pitch, -1, 1) * P.maxPitch;
  s.pitch = approach(s.pitch, targetPitch, P.pitchRate * dt);

  // banking turns the aircraft (positive roll = right bank = clockwise from above = yaw decreases)
  s.yaw = wrapAngle(s.yaw - Math.sin(s.roll) * P.turnGain * dt);

  // speed: throttle sets the target, pitch trades energy
  const targetSpeed = P.minSpeed + (P.maxSpeed - P.minSpeed) * s.throttle;
  s.speed = damp(s.speed, targetSpeed, P.accel, dt) - Math.sin(s.pitch) * 9.8 * 0.35 * dt;
  s.speed = clamp(s.speed, P.minSpeed * 0.8, P.maxSpeed * 1.15);

  // integrate
  const f = forwardVector(s);
  s.x += f[0] * s.speed * dt;
  s.y += f[1] * s.speed * dt;
  s.z += f[2] * s.speed * dt;

  // ceiling
  if (s.y > P.ceiling) {
    s.y = P.ceiling;
    if (s.pitch > 0) s.pitch = 0;
  }

  // terrain: forgiving — push the aircraft up and warn, never crash
  const ground = terrainHeight(s.x, s.z);
  s.agl = s.y - ground;
  s.terrainWarning = false;
  if (s.agl < P.floorAgl) {
    s.y = ground + P.floorAgl;
    s.agl = P.floorAgl;
    if (s.pitch < 0.12) s.pitch = 0.12;
    s.terrainWarning = true;
  } else if (s.agl < 45) {
    // look ahead: rising ground forces a gentle climb
    const aheadGround = terrainHeight(s.x + f[0] * 90, s.z + f[2] * 90);
    if (aheadGround + P.floorAgl > s.y) {
      s.terrainWarning = true;
      if (s.pitch < 0.2) s.pitch = approach(s.pitch, 0.2, P.pitchRate * 1.5 * dt);
    }
  }

  // boundary: steer back toward the centre
  const r = Math.hypot(s.x, s.z);
  s.boundaryWarning = Math.max(Math.abs(s.x), Math.abs(s.z)) > P.bounds - 120;
  if (Math.max(Math.abs(s.x), Math.abs(s.z)) > P.bounds) {
    // forward is (-sin yaw, -cos yaw); to point at the centre we need (-x, -z)/r
    const want = Math.atan2(s.x / r, s.z / r);
    s.yaw = wrapAngle(s.yaw + wrapAngle(want - s.yaw) * clamp(2.5 * dt, 0, 1));
    const k = P.bounds / Math.max(Math.abs(s.x), Math.abs(s.z));
    s.x *= k;
    s.z *= k;
  }
  return s;
}
