/**
 * Station-keeping over the rescue: in a hover the stick moves the
 * helicopter forward, back and sideways (as seen from behind it), the
 * altitude holds itself, and the wind keeps pushing. Holding still is the
 * skill. Pure, frame-rate independent.
 */
import { clamp, damp } from '../core/math';
import type { AircraftState } from '../flight/aircraft';

export interface HoverVel {
  vx: number;
  vz: number;
  /** Where the hover is holding (set when the stick is let go). */
  ax?: number;
  az?: number;
}

export interface HoverParams {
  /** Fastest the stick can move it (m/s). */
  maxSpeed: number;
  /** How quickly it answers the stick (1/s). */
  response: number;
  /** The push of the wind on this airframe (m/s, already scaled). */
  drift: { x: number; z: number };
  /** The height to hold (m, world y). */
  holdY: number;
  /** Never closer to the ground under it than this (m). */
  clearance: number;
  /**
   * Position hold (1/s): with the stick let go, the hover eases back to the
   * spot where it was released. 0: no hold, it only stops.
   */
  hold?: number;
}

/** Forward and right on the ground for a heading. */
export function headingAxes(yaw: number): { fx: number; fz: number; rx: number; rz: number } {
  return { fx: -Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw) };
}

/**
 * One hover step. `stick.x` right, `stick.y` forward, both -1..1.
 * Returns the new aircraft state; `v` is updated in place.
 */
export function stepHover(a: AircraftState, v: HoverVel, stick: { x: number; y: number }, P: HoverParams, ground: (x: number, z: number) => number, dt: number): AircraftState {
  dt = clamp(dt, 0, 0.05);
  const s: AircraftState = { ...a };
  const ax = headingAxes(s.yaw);
  const sx = clamp(stick.x, -1, 1);
  const sy = clamp(stick.y, -1, 1);
  let wantX = (ax.fx * sy + ax.rx * sx) * P.maxSpeed + P.drift.x;
  let wantZ = (ax.fz * sy + ax.rz * sx) * P.maxSpeed + P.drift.z;
  const idle = Math.abs(sx) < 0.05 && Math.abs(sy) < 0.05;
  if (!idle || v.ax === undefined || v.az === undefined || !P.hold) {
    v.ax = s.x;
    v.az = s.z;
  } else {
    // stick let go: come back to where it was let go, gently
    const cx = clamp((v.ax - s.x) * P.hold, -2.5, 2.5);
    const cz = clamp((v.az - s.z) * P.hold, -2.5, 2.5);
    wantX += cx;
    wantZ += cz;
  }
  const k = 1 - Math.exp(-P.response * dt);
  v.vx += (wantX - v.vx) * k;
  v.vz += (wantZ - v.vz) * k;
  s.x += v.vx * dt;
  s.z += v.vz * dt;
  const floor = ground(s.x, s.z) + P.clearance;
  // ease toward the hold height, never faster than a gentle 8 m/s
  const want = Math.max(P.holdY, floor);
  s.y += clamp((want - s.y) * 1.6, -8, 8) * dt;
  if (s.y < floor - 3) s.y = floor - 3;
  s.agl = s.y - ground(s.x, s.z);
  s.speed = Math.hypot(v.vx, v.vz);
  s.vx = v.vx;
  s.vz = v.vz;
  // the rotor disc tips the way it is going (drawn by the mesh)
  const side = (v.vx * ax.rx + v.vz * ax.rz) / P.maxSpeed;
  s.roll = damp(s.roll, clamp(side, -1, 1) * 0.22, 4, dt);
  s.pitch = 0;
  s.throttle = 0;
  s.terrainWarning = false;
  return s;
}

/** The forward tilt the mesh should show for this hover velocity (radians, nose down positive). */
export function hoverTilt(yaw: number, v: HoverVel, maxSpeed: number): number {
  const ax = headingAxes(yaw);
  return clamp((v.vx * ax.fx + v.vz * ax.fz) / maxSpeed, -1, 1) * 0.18;
}
