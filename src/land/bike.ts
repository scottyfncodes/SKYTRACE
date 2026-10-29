/**
 * The Trail Bike: an arcade dirt bike. Quick off the line, fastest on the
 * trail, slowed by the brush off it, the back steps out on loose ground,
 * hills slow it going up and push it going down, and it leaves the ground
 * over crests and off the ramps. The same stick and lever as everything
 * else: the stick steers (pushed forward it opens the throttle), the lever
 * is the throttle. Pure, tested.
 *
 * It drives the same state as the boat (an `AircraftState` the camera,
 * minimap and route already understand): `y` is the wheels, `agl` how far
 * they are off the ground.
 */
import { clamp, damp, wrapAngle } from '../core/math';
import type { BoatInput, BoatState } from '../water/boat';

/** The bike's state: the boat's, on land. */
export type BikeState = BoatState;
export type BikeInput = BoatInput;

export interface BikePerf {
  /** Top speed on the trail (m/s). */
  maxSpeed: number;
  accel: number;
  brake: number;
  /** Turn rate at full lock (rad/s). */
  turn: number;
  /** Grip on the trail and off it (1/s): lower slides more. */
  grip: number;
  looseGrip: number;
}

export const TRAIL_BIKE: BikePerf = { maxSpeed: 28, accel: 11, brake: 18, turn: 2.1, grip: 6, looseGrip: 3.2 };

const GRAVITY = 20;
/** Off a ramp at speed: launch speed per m/s of speed. */
export const RAMP_LAUNCH = 0.32;
/** Over this the bike will not climb (rise over run). */
const WALL = 0.85;
/** Landing harder than this (m/s down) is a knock. */
export const HARD_LANDING = 11;

export interface BikeEnv {
  height(x: number, z: number): number;
  /** 0..1: how thick the brush is (forest). */
  brush(x: number, z: number): number;
  /** 0..1: how much of the trail (or a road) is under the wheels. */
  trail(x: number, z: number): number;
  /** Is there a ramp here? */
  ramp?(x: number, z: number): boolean;
  /** Deep water (the bike stops at the edge). */
  water?(x: number, z: number): boolean;
}

export function newBike(x: number, z: number, yaw: number, ground: number): BikeState {
  return { x, y: ground, z, yaw, pitch: 0, roll: 0, speed: 0, throttle: 0, agl: 0, terrainWarning: false, boundaryWarning: false, vx: 0, vz: 0, contact: false, vy: 0, landed: 0, launched: false, wet: 1 };
}

/** Top speed here: the trail is fast, grass slower, the brush slowest. */
export function topSpeed(env: BikeEnv, x: number, z: number, perf: BikePerf = TRAIL_BIKE): number {
  const t = env.trail(x, z);
  const off = 0.72 - 0.5 * env.brush(x, z);
  return perf.maxSpeed * (t + (1 - t) * off);
}

/** One step of the bike. */
export function stepBike(b: BikeState, inp: BikeInput, dt: number, env: BikeEnv, perf: BikePerf = TRAIL_BIKE): BikeState {
  const s: BikeState = { ...b, contact: false, landed: 0, launched: false };
  const air = s.agl > 0.05;
  s.throttle = clamp(s.throttle + inp.throttleDelta * 1.1 * dt, 0, 1);
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  const g0 = env.height(s.x, s.z);
  // the slope along the nose: up slows it, down speeds it
  const ahead = env.height(s.x + fx * 2, s.z + fz * 2);
  const slope = (ahead - g0) / 2;
  if (!air) {
    const top = topSpeed(env, s.x, s.z, perf);
    const target = s.throttle * top;
    const rate = target > s.speed ? perf.accel * (1 - 0.45 * (s.speed / perf.maxSpeed)) : perf.brake * (s.throttle < 0.05 ? 1 : 0.5);
    s.speed += clamp(target - s.speed, -rate * dt, rate * dt);
    s.speed -= GRAVITY * 0.35 * clamp(slope, -0.6, 0.6) * dt;
    // too fast for the brush: it drags you down
    if (s.speed > top) s.speed = damp(s.speed, top, 2.5, dt);
    s.speed = Math.max(0, s.speed);
    // steering: needs a little speed, and is calmer flat out
    const way = clamp(s.speed / 4, 0, 1) * (1 - 0.3 * clamp((s.speed - 18) / 10, 0, 1));
    s.yaw = wrapAngle(s.yaw - inp.steer * perf.turn * way * dt);
  }
  // travel follows the nose: tight on the trail, the back steps out on loose ground
  const nfx = -Math.sin(s.yaw);
  const nfz = -Math.cos(s.yaw);
  let vx = s.vx ?? nfx * s.speed;
  let vz = s.vz ?? nfz * s.speed;
  if (!air) {
    const t = env.trail(s.x, s.z);
    const grip = perf.looseGrip + (perf.grip - perf.looseGrip) * t;
    const k = 1 - Math.exp(-grip * (1 - 0.35 * Math.abs(inp.steer)) * dt);
    vx += (nfx * s.speed - vx) * k;
    vz += (nfz * s.speed - vz) * k;
  }
  // walls of rock and the river's edge stop it: it glances off and loses speed
  let nx = s.x + vx * dt;
  let nz = s.z + vz * dt;
  const g1 = env.height(nx, nz);
  const step = Math.hypot(nx - s.x, nz - s.z) || 1e-6;
  const blocked = (!air && (g1 - g0) / step > WALL) || env.water?.(nx, nz);
  if (blocked) {
    const e = 1.5;
    const gx = env.height(nx + e, nz) - env.height(nx - e, nz);
    const gz = env.height(nx, nz + e) - env.height(nx, nz - e);
    const gl = Math.hypot(gx, gz) || 1;
    // push back down the slope (or back from the water's edge)
    const ox = env.water?.(nx, nz) ? gx / gl : -gx / gl;
    const oz = env.water?.(nx, nz) ? gz / gl : -gz / gl;
    const into = vx * ox + vz * oz;
    if (into < 0) {
      vx -= 1.3 * into * ox;
      vz -= 1.3 * into * oz;
    }
    s.contact = -into > 4;
    vx *= 0.5;
    vz *= 0.5;
    s.speed *= 0.45;
    nx = s.x + vx * dt;
    nz = s.z + vz * dt;
    if (env.water?.(nx, nz) || (env.height(nx, nz) - g0) / (Math.hypot(nx - s.x, nz - s.z) || 1e-6) > WALL) {
      nx = s.x;
      nz = s.z;
    }
  }
  s.x = nx;
  s.z = nz;
  s.vx = vx;
  s.vz = vz;
  // up and down: the wheels follow the ground until it drops away faster than gravity can pull the bike down
  const g = env.height(s.x, s.z);
  s.wet += dt;
  if (!air) {
    const follow = (g - g0) / dt;
    if (s.wet > 0.5 && s.speed > JUMP_MIN && env.ramp?.(s.x, s.z)) {
      s.vy = s.speed * RAMP_LAUNCH;
      s.launched = true;
      s.wet = 0;
    } else if (s.speed > JUMP_MIN && follow < s.vy - GRAVITY * dt * 1.5 && s.vy > 1.5) {
      // over a crest with some lift: airborne
      s.launched = true;
      s.wet = 0;
    } else s.vy = clamp(follow, -30, 30);
  }
  if (s.launched || air) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= g) {
      s.landed = Math.max(0.01, -s.vy + (g - g0) / dt);
      s.y = g;
      s.vy = 0;
      s.speed *= 0.95;
      if (s.landed > HARD_LANDING) s.contact = true;
    }
  } else s.y = g;
  s.agl = Math.max(0, s.y - g);
  // how it sits: along the slope on the ground, nose following the arc in the air, leaning into the turn
  const pitch = s.agl > 0.05 ? clamp(s.vy * 0.04, -0.4, 0.35) : Math.atan(clamp(slope, -1, 1));
  s.pitch = damp(s.pitch, pitch, 8, dt);
  const way = clamp(s.speed / 4, 0, 1);
  s.roll = damp(s.roll, s.agl > 0.05 ? s.roll : inp.steer * way * 0.55, 6, dt);
  s.terrainWarning = false;
  return s;
}

/** Below this speed (m/s) the bike never leaves the ground. */
export const JUMP_MIN = 9;

/** Speed over the ground (m/s). */
export const bikeSpeed = (b: BikeState): number => Math.hypot(b.vx ?? 0, b.vz ?? 0);
