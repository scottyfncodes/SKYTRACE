import { clamp, damp, wrapAngle } from '../core/math';

/**
 * Ease toward a target: fast when far, gentle as it arrives (no snap at
 * either end), and never faster than `maxRate` per second.
 */
export function easeTo(cur: number, target: number, k: number, maxRate: number, dt: number): number {
  const d = (target - cur) * (1 - Math.exp(-k * dt));
  const m = maxRate * dt;
  return cur + (d > m ? m : d < -m ? -m : d);
}

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
  /** Ground velocity (m/s). The helicopter carries momentum in it; the aeroplane's follows its nose. */
  vx?: number;
  vz?: number;
  /** This step the aircraft was pushed off the ground it was flying into (a scrape). */
  contact?: boolean;
}

/** What the world does to the aircraft this step (the wind's push, already eased by the hover assist). */
export interface FlightEnv {
  drift?: { x: number; z: number };
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
  /**
   * Rotorcraft: the stick's vertical axis sets a climb rate (m/s at full
   * stick) instead of pointing the nose, travel stays level, and the throttle
   * runs from a hover (0) to full forward speed (1). Same stick, same
   * throttle, same terrain and boundary rules as the fixed-wing model.
   */
  climbRate?: number;
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
export function stepAircraft(a: AircraftState, inp: FlightInput, dt: number, terrainHeight: (x: number, z: number) => number, P: FlightPerf = FLIGHT, env: FlightEnv = {}): AircraftState {
  if (P.climbRate) return stepRotor(a, inp, dt, terrainHeight, P, P.climbRate, env);
  const s: AircraftState = { ...a };
  dt = clamp(dt, 0, 0.05);

  // throttle
  s.throttle = clamp(s.throttle + inp.throttleDelta * 0.6 * dt, 0, 1);

  // attitude: bank and nose ease toward the stick and self-centre, quick to answer and soft to settle
  const targetRoll = clamp(inp.roll, -1, 1) * P.maxRoll;
  s.roll = easeTo(s.roll, targetRoll, 5.5, P.rollRate, dt);
  const targetPitch = clamp(inp.pitch, -1, 1) * P.maxPitch;
  s.pitch = easeTo(s.pitch, targetPitch, 5, P.pitchRate, dt);

  // banking turns the aircraft (positive roll = right bank = clockwise from above = yaw decreases);
  // a slower aeroplane turns a little tighter for the same bank
  const slow = 1 - clamp((s.speed - P.minSpeed) / Math.max(1, P.maxSpeed - P.minSpeed), 0, 1);
  s.yaw = wrapAngle(s.yaw - Math.sin(s.roll) * P.turnGain * (1 + 0.18 * slow) * dt);

  // speed: throttle sets the target, pitch trades energy, a hard turn bleeds a little
  const targetSpeed = P.minSpeed + (P.maxSpeed - P.minSpeed) * s.throttle;
  s.speed = damp(s.speed, targetSpeed, P.accel, dt) - Math.sin(s.pitch) * 9.8 * 0.35 * dt - Math.abs(Math.sin(s.roll)) * 1.6 * dt;
  s.speed = clamp(s.speed, P.minSpeed * 0.8, P.maxSpeed * 1.15);

  // integrate
  const f = forwardVector(s);
  s.x += f[0] * s.speed * dt;
  s.y += f[1] * s.speed * dt;
  s.z += f[2] * s.speed * dt;
  s.vx = f[0] * s.speed;
  s.vz = f[2] * s.speed;

  // ceiling
  if (s.y > P.ceiling) {
    s.y = P.ceiling;
    if (s.pitch > 0) s.pitch = 0;
  }

  // terrain: forgiving — push the aircraft up and warn, never crash
  const ground = terrainHeight(s.x, s.z);
  s.agl = s.y - ground;
  s.terrainWarning = false;
  s.contact = false;
  if (s.agl < P.floorAgl) {
    // flown into the ground (not just skimming along the floor)
    s.contact = f[1] * s.speed < -3;
    s.y = ground + P.floorAgl;
    s.agl = P.floorAgl;
    s.pitch = easeTo(s.pitch, Math.max(s.pitch, 0.16), 8, P.pitchRate * 2, dt);
    s.terrainWarning = true;
  } else if (s.agl < 60) {
    // look ahead: rising ground eases the nose up before it gets close
    const aheadGround = terrainHeight(s.x + f[0] * 90, s.z + f[2] * 90);
    if (aheadGround + P.floorAgl > s.y) {
      s.terrainWarning = true;
      if (s.pitch < 0.2) s.pitch = easeTo(s.pitch, 0.2, 4, P.pitchRate * 1.5, dt);
    }
  }

  keepInBounds(s, dt, P);
  return s;
}

/**
 * The rotorcraft step: the same stick and throttle, flown as a helicopter.
 * Bank still turns (and still turns at a standstill, so it pivots in a
 * hover); the vertical stick is the collective; the lever is how fast it
 * goes forward, down to a hover.
 *
 * The helicopter carries momentum: its ground velocity eases toward where
 * the nose and the lever want it (so a fast turn carves and slides a
 * little), brakes harder than it accelerates (a flare), and the wind leans
 * on it more the slower it goes.
 */
function stepRotor(a: AircraftState, inp: FlightInput, dt: number, terrainHeight: (x: number, z: number) => number, P: FlightPerf, climbRate: number, env: FlightEnv): AircraftState {
  const s: AircraftState = { ...a };
  dt = clamp(dt, 0, 0.05);
  s.throttle = clamp(s.throttle + inp.throttleDelta * 0.6 * dt, 0, 1);
  s.roll = easeTo(s.roll, clamp(inp.roll, -1, 1) * P.maxRoll, 6, P.rollRate, dt);
  s.pitch = easeTo(s.pitch, clamp(inp.pitch, -1, 1) * P.maxPitch, 7, P.pitchRate, dt);
  s.yaw = wrapAngle(s.yaw - Math.sin(s.roll) * P.turnGain * dt);
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  // velocity: old saves of the state carry only a speed along the nose
  let vx = s.vx ?? 0;
  let vz = s.vz ?? 0;
  if (vx === 0 && vz === 0 && s.speed > 0) {
    vx = fx * s.speed;
    vz = fz * s.speed;
  }
  const target = P.minSpeed + (P.maxSpeed - P.minSpeed) * s.throttle;
  const cur = Math.hypot(vx, vz);
  const lean = 1 - Math.min(1, cur / 30) * 0.6;
  const wantX = fx * target + (env.drift?.x ?? 0) * lean;
  const wantZ = fz * target + (env.drift?.z ?? 0) * lean;
  // along the nose: accelerate, or flare harder than you accelerate
  const ex = wantX - vx;
  const ez = wantZ - vz;
  const along = ex * fx + ez * fz;
  const side = ex * -fz + ez * fx;
  const braking = target < cur - 0.5;
  const kA = braking ? P.accel * 2.6 : P.accel * 1.35;
  const aA = braking ? 7 + 8 * P.accel : 4 + 6 * P.accel;
  // across the nose: the rotor grips, so a turn carves with only a little slide
  const kS = 2.2 + P.accel * 2;
  const aS = 14 + 16 * P.accel;
  const lim = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);
  const dA = lim(along * (1 - Math.exp(-kA * dt)), aA * dt);
  const dS = lim(side * (1 - Math.exp(-kS * dt)), aS * dt);
  const dx = fx * dA - fz * dS;
  const dz = fz * dA + fx * dS;
  vx += dx;
  vz += dz;
  s.vx = vx;
  s.vz = vz;
  s.speed = Math.min(Math.hypot(vx, vz), P.maxSpeed);
  s.x += vx * dt;
  s.z += vz * dt;
  s.y += (s.pitch / P.maxPitch) * climbRate * dt;
  if (s.y > P.ceiling) s.y = P.ceiling;
  // terrain: forgiving, as for the aeroplane. Never crash; rising ground ahead lifts you
  const ground = terrainHeight(s.x, s.z);
  s.agl = s.y - ground;
  s.terrainWarning = false;
  s.contact = false;
  if (s.agl < P.floorAgl) {
    s.contact = s.speed > 15 && s.pitch < -0.1;
    s.y = ground + P.floorAgl;
    s.agl = P.floorAgl;
    s.terrainWarning = s.speed > 4;
  } else if (s.speed > 4) {
    const look = 12 + s.speed * 1.6;
    const ahead = terrainHeight(s.x + (vx / Math.max(1, s.speed)) * look, s.z + (vz / Math.max(1, s.speed)) * look);
    if (ahead + P.floorAgl + 4 > s.y) {
      s.terrainWarning = true;
      s.y += climbRate * 0.9 * dt;
    }
  }
  keepInBounds(s, dt, P);
  return s;
}

/** Boundary: steer back toward the centre. */
function keepInBounds(s: AircraftState, dt: number, P: FlightPerf): void {
  const r = Math.hypot(s.x, s.z);
  s.boundaryWarning = Math.max(Math.abs(s.x), Math.abs(s.z)) > P.bounds - 120;
  if (Math.max(Math.abs(s.x), Math.abs(s.z)) > P.bounds) {
    // forward is (-sin yaw, -cos yaw); to point at the centre we need (-x, -z)/r
    const want = Math.atan2(s.x / r, s.z / r);
    s.yaw = wrapAngle(s.yaw + wrapAngle(want - s.yaw) * clamp(2.5 * dt, 0, 1));
    const k = P.bounds / Math.max(Math.abs(s.x), Math.abs(s.z));
    s.x *= k;
    s.z *= k;
    // the helicopter's momentum turns with it
    if (s.vx !== undefined && s.vz !== undefined && P.climbRate) {
      const sp = Math.hypot(s.vx, s.vz);
      s.vx = -Math.sin(s.yaw) * sp;
      s.vz = -Math.cos(s.yaw) * sp;
    }
  }
}
