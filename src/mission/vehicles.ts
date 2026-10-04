import type { Pt } from '../world/worldData';

/**
 * A vehicle driving a polyline. Pure state, no rendering, so the mission
 * logic and the tests share it. Ping-pong routes drive back and forth;
 * one-way routes stop at the last point (`arrived`).
 */
export class RouteMover {
  x = 0;
  z = 0;
  heading = 0;
  moving = false;
  arrived = false;
  private s: number;
  private dir = 1;
  private lens: number[] = [];
  private total = 0;

  constructor(
    private pts: readonly Pt[],
    public speed: number,
    start = 0,
    private pingPong = true,
  ) {
    this.setRoute(pts, pingPong);
    this.s = Math.min(start, this.total);
    this.place();
  }

  setRoute(pts: readonly Pt[], pingPong: boolean): void {
    this.pts = pts;
    this.pingPong = pingPong;
    this.lens = [];
    this.total = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      this.lens.push(l);
      this.total += l;
    }
    this.s = 0;
    this.dir = 1;
    this.arrived = false;
    this.place();
  }

  /** Index of the route segment the vehicle is on. */
  get segment(): number {
    let acc = 0;
    for (let i = 0; i < this.lens.length; i++) {
      if (this.s <= acc + this.lens[i]) return i;
      acc += this.lens[i];
    }
    return Math.max(0, this.lens.length - 1);
  }

  step(dt: number): void {
    if (this.total <= 0 || this.speed <= 0 || this.arrived) {
      this.moving = false;
      return;
    }
    this.moving = true;
    this.s += this.dir * this.speed * dt;
    if (this.s >= this.total) {
      if (this.pingPong) {
        this.s = this.total - (this.s - this.total);
        this.dir = -1;
      } else {
        this.s = this.total;
        this.arrived = true;
        this.moving = false;
      }
    } else if (this.s <= 0) {
      this.s = -this.s;
      this.dir = 1;
    }
    this.place();
  }

  private place(): void {
    const p = this.pts;
    if (p.length === 1 || this.total <= 0) {
      this.x = p[0][0];
      this.z = p[0][1];
      return;
    }
    let acc = 0;
    for (let i = 0; i < this.lens.length; i++) {
      const l = this.lens[i];
      if (this.s <= acc + l || i === this.lens.length - 1) {
        const t = l > 0 ? Math.min(1, Math.max(0, (this.s - acc) / l)) : 0;
        const [ax, az] = p[i];
        const [bx, bz] = p[i + 1];
        this.x = ax + (bx - ax) * t;
        this.z = az + (bz - az) * t;
        const dx = (bx - ax) * this.dir;
        const dz = (bz - az) * this.dir;
        if (dx || dz) this.heading = Math.atan2(-dx, -dz);
        return;
      }
      acc += l;
    }
  }
}
