/**
 * The Rescue Boat: an arcade jet boat. Fast, loose at the back so it slides
 * through a bend, up on the plane at speed, and it flies off the rapids.
 * The same stick and lever as the aircraft: the stick steers (and pushing it
 * forward opens the throttle), the lever is the throttle. The river's current
 * carries it; the banks stop it. Pure, tested.
 *
 * It drives an `AircraftState` so the camera, the minimap, the nav arrow and
 * the route all work on it unchanged: `y` is the hull on the water, `agl` its
 * height above the surface (above zero only in the air off a rapid).
 */
import { clamp, damp, wrapAngle } from '../core/math';
import type { AircraftState } from '../flight/aircraft';
import { WATER_LEVEL } from '../world/worldData';
import { DEEP } from './river';

export interface BoatPerf {
  /** Top speed (m/s). */
  maxSpeed: number;
  /** Acceleration and braking (m/s²). */
  accel: number;
  brake: number;
  /** Turn rate at full lock (rad/s). */
  turn: number;
  /** How quickly the hull's travel swings round to its nose (1/s): lower slides more. */
  grip: number;
}

export const RESCUE_BOAT: BoatPerf = { maxSpeed: 26, accel: 9, brake: 14, turn: 1.75, grip: 2.6 };

/** The hull sits this far above the water (m). */
export const HULL = 0.45;
/** Off a rapid at speed the boat leaves the water: launch speed per m/s of speed, and gravity. */
export const LAUNCH = 0.36;
const GRAVITY = 20;
/** Above this speed (m/s) a rapid launches the boat. */
export const JUMP_SPEED = 11;

export interface BoatInput {
  /** -1..1, positive steers right. */
  steer: number;
  /** -1..1 per second on the throttle (keys, or the stick pushed forward / pulled back). */
  throttleDelta: number;
}

export interface BoatEnv {
  height(x: number, z: number): number;
  current(x: number, z: number): { x: number; z: number };
  /** Is there a rapid here (a ledge of white water that throws the boat)? */
  rapid?(x: number, z: number): boolean;
}

export interface BoatState extends AircraftState {
  /** Vertical speed off a rapid (m/s). */
  vy: number;
  /** Just landed back on the water this step, this hard (m/s down). 0: no. */
  landed: number;
  /** Just left the water off a rapid. */
  launched: boolean;
  /** Time on the water since the last launch (s): one rapid throws you once. */
  wet: number;
}

export function newBoat(x: number, z: number, yaw: number): BoatState {
  return { x, y: WATER_LEVEL + HULL, z, yaw, pitch: 0, roll: 0, speed: 0, throttle: 0, agl: 0, terrainWarning: false, boundaryWarning: false, vx: 0, vz: 0, contact: false, vy: 0, landed: 0, launched: false, wet: 1 };
}

const isWater = (env: BoatEnv, x: number, z: number) => env.height(x, z) < DEEP;

/** One step of the boat. */
export function stepBoat(b: BoatState, inp: BoatInput, dt: number, env: BoatEnv, perf: BoatPerf = RESCUE_BOAT): BoatState {
  const s: BoatState = { ...b, contact: false, landed: 0, launched: false };
  const air = s.agl > 0.05;
  s.throttle = clamp(s.throttle + inp.throttleDelta * 1.1 * dt, 0, 1);
  // speed along the nose: the throttle sets a target, the hull gets there
  const target = s.throttle * perf.maxSpeed;
  if (!air) {
    const rate = target > s.speed ? perf.accel * (1 - 0.5 * (s.speed / perf.maxSpeed)) : perf.brake * 0.6;
    s.speed = s.speed + clamp(target - s.speed, -rate * dt, rate * dt);
  }
  // steering: needs way on, and is a touch lazier flat out
  const way = clamp(s.speed / 6, 0, 1) * (1 - 0.25 * clamp((s.speed - 18) / 8, 0, 1));
  if (!air) s.yaw = wrapAngle(s.yaw - inp.steer * perf.turn * way * dt);
  // travel swings round to the nose: loose, so the stern slides out in a hard turn
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  const c = env.current(s.x, s.z);
  let vx = (s.vx ?? fx * s.speed) - c.x;
  let vz = (s.vz ?? fz * s.speed) - c.z;
  if (!air) {
    const k = 1 - Math.exp(-perf.grip * (0.6 + 0.4 * (1 - Math.abs(inp.steer) * way)) * dt);
    vx += (fx * s.speed - vx) * k;
    vz += (fz * s.speed - vz) * k;
  }
  vx += c.x;
  vz += c.z;
  // the banks: the hull will not climb out of the water; it glances off and loses speed
  let nx = s.x + vx * dt;
  let nz = s.z + vz * dt;
  if (!isWater(env, nx, nz)) {
    const e = 1.5;
    const gx = env.height(nx + e, nz) - env.height(nx - e, nz);
    const gz = env.height(nx, nz + e) - env.height(nx, nz - e);
    const gl = Math.hypot(gx, gz) || 1;
    // the bank's outward normal points down its slope, back toward the water
    const ox = -gx / gl;
    const oz = -gz / gl;
    const into = vx * ox + vz * oz;
    const hit = -into;
    if (into < 0) {
      vx -= 1.4 * into * ox;
      vz -= 1.4 * into * oz;
    }
    vx *= 0.6;
    vz *= 0.6;
    s.speed *= 0.55;
    s.contact = hit > 4;
    nx = s.x + vx * dt;
    nz = s.z + vz * dt;
    if (!isWater(env, nx, nz)) {
      nx = s.x;
      nz = s.z;
    }
  }
  s.x = nx;
  s.z = nz;
  s.vx = vx;
  s.vz = vz;
  // off a rapid at speed: into the air
  s.wet += dt;
  if (!air && s.wet > 0.6 && s.speed > JUMP_SPEED && env.rapid?.(s.x, s.z)) {
    s.vy = s.speed * LAUNCH;
    s.launched = true;
    s.wet = 0;
  }
  if (s.vy !== 0 || air) {
    s.vy -= GRAVITY * dt;
    s.agl = Math.max(0, s.agl + s.vy * dt);
    if (s.agl <= 0 && s.vy < 0) {
      s.landed = -s.vy;
      s.vy = 0;
      s.agl = 0;
      s.speed *= 0.92;
    }
  }
  // how it sits: up on the plane at speed, nose up in the air, leaning into the turn, a little chop
  const chop = Math.sin(s.x * 0.21 + s.z * 0.17) * Math.sin(s.x * 0.07 - s.z * 0.13);
  const planing = clamp(s.speed / perf.maxSpeed, 0, 1);
  const pitch = s.agl > 0 ? clamp(s.vy * 0.05, -0.25, 0.3) : 0.08 * planing - 0.04 * (target < s.speed - 2 ? 1 : 0) + chop * 0.03 * planing;
  s.pitch = damp(s.pitch, pitch, 6, dt);
  s.roll = damp(s.roll, air ? s.roll : inp.steer * way * 0.32 + chop * 0.03, 5, dt);
  s.y = WATER_LEVEL + HULL + s.agl + chop * 0.12 * planing;
  s.terrainWarning = false;
  return s;
}

/** Speed over the water, whatever the nose is doing (m/s). */
export const boatSpeed = (b: BoatState): number => Math.hypot(b.vx ?? 0, b.vz ?? 0);
