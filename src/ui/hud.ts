import { headingDeg } from '../core/math';
import type { AircraftState } from '../flight/aircraft';
import type { SaveState } from '../intel/state';
import { gridRef, BASE } from '../world/worldData';

export interface ScopeContact {
  x: number;
  z: number;
  r: number; // uncertainty radius
  kind: 'detected' | 'observed' | 'resolved' | 'fresh' | 'sensor';
  label: string;
  marked: boolean;
}

export interface HudFrame {
  a: AircraftState;
  scanning: boolean;
  footprint: number;
  quality: number;
  fuel: number; // 0..1
  fuelSeconds: number;
  sensorsLeft: number;
  sortie: number;
  contacts: ScopeContact[];
  sensors: { x: number; z: number; id: string; linked: boolean }[];
  waypoint: { x: number; z: number; label: string } | null;
  nearBase: boolean;
  signal: { bearing: number; strength: number } | null;
  nearContact: { codename: string; label: string; grid: string; confidence: number; canMark: boolean; status: string; traits?: string[]; action?: string } | null;
  sweepAngle: number;
  /** Replaces "SORTIE n" (mission mode). */
  sortieLabel?: string;
  /** Mission objective indicator; null hides it (open case). */
  objective?: { kicker?: string; title: string; detail: string; progress: number | null; done: boolean } | null;
  /** Small status chips under the nav strip (weather, cloud clearance). */
  chips?: { text: string; cls?: string }[];
  /** Mission warning shown when nothing more urgent is (e.g. IN CLOUD). */
  warning?: string;
  /** Storm cells drawn on the scope. */
  storms?: { x: number; z: number; r: number }[];
  /** Search area outlined on the scope. */
  sector?: { x0: number; z0: number; x1: number; z1: number } | null;
}

interface Banner {
  kicker: string;
  text: string;
  cls: string;
  t: number;
}

export class Hud {
  private el: Record<string, HTMLElement> = {};
  private scope: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private msgs: { text: string; t: number; cls: string }[] = [];
  private afterglow: { x: number; z: number; t: number }[] = [];
  private lastWarn = '';
  private banners: Banner[] = [];
  private bannerShown: Banner | null = null;
  private lastObjective = '';
  private lastChips = '';

  constructor(root: HTMLElement) {
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['alt', 'spd', 'hdg', 'compass', 'fuel-fill', 'fuel-txt', 'sensors', 'sortie', 'msgs', 'warn', 'nav', 'contact-card', 'cc-code', 'cc-label', 'cc-grid', 'cc-conf', 'cc-status', 'radar-state', 'btn-mark', 'btn-scan', 'btn-drop', 'btn-rtb', 'signal', 'thr-fill', 'objective', 'obj-title', 'obj-detail', 'obj-progress', 'banner', 'banner-kicker', 'banner-text', 'cc-traits', 'cc-action', 'obj-kicker', 'chips']) {
      this.el[id] = q(id);
    }
    this.scope = q('scope') as HTMLCanvasElement;
    this.ctx = this.scope.getContext('2d')!;
  }

  message(text: string, cls = ''): void {
    this.msgs.unshift({ text, t: 5.5, cls });
    if (this.msgs.length > 4) this.msgs.length = 4;
    this.renderMsgs();
  }

  private renderMsgs(): void {
    this.el['msgs'].innerHTML = this.msgs.map((m) => `<div class="msg ${m.cls}" style="opacity:${Math.min(1, m.t)}">${m.text}</div>`).join('');
  }

  /**
   * Large centred announcement (objective changes). Queued so that
   * "OBJECTIVE COMPLETE" is always read before "NEW OBJECTIVE".
   */
  banner(kicker: string, text: string, cls = '', seconds = 2.8): void {
    this.banners.push({ kicker, text, cls, t: seconds });
    if (!this.bannerShown) this.nextBanner();
  }

  clearBanners(): void {
    this.banners = [];
    this.bannerShown = null;
    this.el['banner'].classList.remove('on');
    this.el['msgs'].style.visibility = '';
  }

  /** Banners outlive the flight HUD: they also announce objectives in Mission Control. */
  tickBanners(dt: number): void {
    if (!this.bannerShown) return;
    this.bannerShown.t -= dt;
    if (this.bannerShown.t <= 0) this.nextBanner();
  }

  get bannerActive(): boolean {
    return this.bannerShown !== null;
  }

  private nextBanner(): void {
    const b = this.banners.shift() ?? null;
    this.bannerShown = b;
    const el = this.el['banner'];
    // the feed would sit under the banner: hold it back while one is up
    this.el['msgs'].style.visibility = b ? 'hidden' : '';
    if (!b) {
      el.classList.remove('on');
      return;
    }
    this.el['banner-kicker'].textContent = b.kicker;
    this.el['banner-text'].textContent = b.text;
    el.className = `banner on ${b.cls}`;
  }

  blip(x: number, z: number): void {
    this.afterglow.push({ x, z, t: 2.2 });
  }

  update(f: HudFrame, dt: number): void {
    const a = f.a;
    this.el['alt'].textContent = `${Math.round(a.agl)}`;
    this.el['spd'].textContent = `${Math.round(a.speed * 3.6)}`;
    const hdg = headingDeg(a.yaw);
    this.el['hdg'].textContent = `${String(Math.round(hdg) % 360).padStart(3, '0')}`;
    this.el['compass'].style.setProperty('--hdg', `${hdg}`);
    this.el['fuel-fill'].style.width = `${Math.max(0, f.fuel * 100)}%`;
    this.el['fuel-fill'].classList.toggle('low', f.fuel < 0.2);
    this.el['fuel-txt'].textContent = `${Math.max(0, Math.floor(f.fuelSeconds / 60))}:${String(Math.max(0, Math.floor(f.fuelSeconds % 60))).padStart(2, '0')}`;
    this.el['sensors'].textContent = `${f.sensorsLeft}`;
    this.el['sortie'].textContent = f.sortieLabel ?? `SORTIE ${f.sortie}`;

    // objective indicator
    const ob = f.objective ?? null;
    this.el['objective'].classList.toggle('hidden', !ob);
    if (ob) {
      this.el['obj-kicker'].textContent = ob.kicker ?? '';
      const key = `${ob.title}|${ob.detail}|${ob.done}`;
      if (key !== this.lastObjective) {
        this.lastObjective = key;
        this.el['obj-title'].textContent = ob.done ? `\u2713 ${ob.title}` : ob.title;
        this.el['obj-detail'].textContent = ob.detail;
        this.el['objective'].classList.toggle('done', ob.done);
        this.el['objective'].classList.remove('flash');
        void this.el['objective'].offsetWidth; // restart the flash animation
        this.el['objective'].classList.add('flash');
      }
      this.el['objective'].classList.toggle('has-progress', ob.progress !== null);
      this.el['obj-progress'].style.width = `${Math.round((ob.progress ?? 0) * 100)}%`;
    } else this.lastObjective = '';

    this.tickBanners(dt);
    this.el['thr-fill'].style.height = `${a.throttle * 100}%`;

    // warnings
    let warn = '';
    if (a.terrainWarning) warn = 'TERRAIN';
    else if (a.boundaryWarning) warn = 'EDGE OF AREA';
    else if (f.warning) warn = f.warning;
    else if (f.fuel < 0.12) warn = 'FUEL — RETURN TO BASE';
    if (warn !== this.lastWarn) {
      this.el['warn'].textContent = warn;
      this.el['warn'].classList.toggle('on', !!warn);
      this.lastWarn = warn;
    }

    // navigation strip
    const navParts: string[] = [];
    const bearingTo = (x: number, z: number) => {
      const b = Math.atan2(x - a.x, -(z - a.z)); // compass bearing
      let rel = ((b * 180) / Math.PI - hdg + 540) % 360 - 180;
      return { abs: ((b * 180) / Math.PI + 360) % 360, rel };
    };
    const arrow = (rel: number) => (Math.abs(rel) < 12 ? '▲' : rel < 0 ? '◀' : '▶');
    const fmtDist = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);
    if (f.waypoint) {
      const d = Math.hypot(f.waypoint.x - a.x, f.waypoint.z - a.z);
      const b = bearingTo(f.waypoint.x, f.waypoint.z);
      navParts.push(`<span class="wp">${arrow(b.rel)} ${f.waypoint.label} ${fmtDist(d)}</span>`);
    }
    const db = Math.hypot(BASE.x - a.x, BASE.z - a.z);
    const bb = bearingTo(BASE.x, BASE.z);
    navParts.push(`<span class="base">${arrow(bb.rel)} BASE ${fmtDist(db)}</span>`);
    this.el['nav'].innerHTML = navParts.join('');

    // signal analyser
    if (f.signal) {
      const rel = ((f.signal.bearing - hdg + 540) % 360) - 180;
      this.el['signal'].innerHTML = `SIG ${arrow(rel)} ${String(Math.round(f.signal.bearing)).padStart(3, '0')}° <i style="width:${Math.round(f.signal.strength * 40)}px"></i>`;
      this.el['signal'].classList.add('on');
    } else this.el['signal'].classList.remove('on');

    // weather / constraint chips
    const chips = (f.chips ?? []).map((c) => `<span class="chip ${c.cls ?? ''}">${c.text}</span>`).join('');
    if (chips !== this.lastChips) {
      this.lastChips = chips;
      this.el['chips'].innerHTML = chips;
    }

    // radar state
    const res = f.quality > 0.72 ? 'HIGH' : f.quality > 0.45 ? 'MEDIUM' : 'LOW';
    const narrow = window.innerWidth < 900;
    this.el['radar-state'].textContent = f.scanning ? (narrow ? `RADAR · ${Math.round(f.footprint)} m · ${res}` : `RADAR ACTIVE · FOOTPRINT ${Math.round(f.footprint)} m · RESOLUTION ${res}`) : 'RADAR STANDBY';
    this.el['radar-state'].classList.toggle('active', f.scanning);
    this.el['btn-scan'].classList.toggle('active', f.scanning);
    this.el['btn-drop'].classList.toggle('disabled', f.sensorsLeft <= 0);
    this.el['btn-rtb'].classList.toggle('on', f.nearBase);

    // contact card
    const card = this.el['contact-card'];
    if (f.nearContact) {
      card.classList.add('on');
      this.el['cc-code'].textContent = f.nearContact.codename;
      this.el['cc-label'].textContent = f.nearContact.label;
      this.el['cc-grid'].textContent = f.nearContact.grid;
      this.el['cc-conf'].textContent = `${Math.round(f.nearContact.confidence * 100)}%`;
      this.el['cc-status'].textContent = f.nearContact.status;
      const traits = f.nearContact.traits ?? [];
      this.el['cc-traits'].innerHTML = traits.map((t) => `<span>${t}</span>`).join('');
      this.el['cc-action'].textContent = f.nearContact.action ?? '';
      card.classList.toggle('mission', traits.length > 0);
      card.parentElement?.classList.add('card-on');
      this.el['btn-mark'].classList.toggle('ready', f.nearContact.canMark);
    } else {
      card.classList.remove('on');
      this.el['btn-mark'].classList.remove('ready');
      card.parentElement?.classList.remove('card-on');
    }

    // messages
    let changed = false;
    for (const m of this.msgs) {
      m.t -= dt;
      changed = true;
    }
    const before = this.msgs.length;
    this.msgs = this.msgs.filter((m) => m.t > 0);
    if (changed || this.msgs.length !== before) this.renderMsgs();

    this.drawScope(f, dt);
  }

  private drawScope(f: HudFrame, dt: number): void {
    const c = this.scope;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = c.clientWidth;
    if (c.width !== size * dpr || c.height !== size * dpr) {
      c.width = size * dpr;
      c.height = size * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = size / 2;
    const range = 650; // metres shown edge to centre
    const k = (R - 6) / range;
    const a = f.a;
    const sy = Math.sin(a.yaw);
    const cy = Math.cos(a.yaw);
    // world -> scope (heading up)
    const toScope = (x: number, z: number): [number, number] => {
      const dx = x - a.x;
      const dz = z - a.z;
      // rotate so aircraft forward (-sin yaw, -cos yaw) points up
      const fx = -sy;
      const fz = -cy;
      const fwd = dx * fx + dz * fz; // along forward
      const right = dx * -fz + dz * fx; // perpendicular
      return [R + right * k, R - fwd * k];
    };

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = f.scanning ? '#061a0c' : '#04120a';
    ctx.fillRect(0, 0, size, size);

    // range rings + heading lines
    ctx.strokeStyle = 'rgba(110,255,150,0.18)';
    ctx.lineWidth = 1;
    for (const rr of [range / 3, (range * 2) / 3, range]) {
      ctx.beginPath();
      ctx.arc(R, R, rr * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(R, 4);
    ctx.lineTo(R, size - 4);
    ctx.moveTo(4, R);
    ctx.lineTo(size - 4, R);
    ctx.stroke();

    // footprint
    if (f.scanning) {
      ctx.fillStyle = 'rgba(110,255,150,0.08)';
      ctx.beginPath();
      ctx.arc(R, R, f.footprint * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(110,255,150,0.45)';
      ctx.stroke();
      // sweep
      const ang = f.sweepAngle;
      const grd = ctx.createConicGradient ? ctx.createConicGradient(ang - Math.PI / 2, R, R) : null;
      if (grd) {
        grd.addColorStop(0, 'rgba(120,255,160,0.0)');
        grd.addColorStop(0.75, 'rgba(120,255,160,0.0)');
        grd.addColorStop(1, 'rgba(120,255,160,0.35)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(R, R, R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(160,255,190,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(R, R);
      ctx.lineTo(R + Math.cos(ang - Math.PI / 2) * R, R + Math.sin(ang - Math.PI / 2) * R);
      ctx.stroke();
    }

    // search sector
    if (f.sector) {
      const s = f.sector;
      ctx.strokeStyle = 'rgba(242,169,59,0.85)';
      ctx.fillStyle = 'rgba(242,169,59,0.07)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const cs: [number, number][] = [
        [s.x0, s.z0],
        [s.x1, s.z0],
        [s.x1, s.z1],
        [s.x0, s.z1],
      ];
      cs.forEach(([x, z], i) => {
        const [px, py] = toScope(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // storm cells
    for (const st of f.storms ?? []) {
      const [sx, sz] = toScope(st.x, st.z);
      ctx.fillStyle = 'rgba(255,90,60,0.16)';
      ctx.strokeStyle = 'rgba(255,90,60,0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx, sz, st.r * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // base
    const [bx, bz] = toScope(BASE.x, BASE.z);
    ctx.strokeStyle = 'rgba(200,255,220,0.8)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx - 4, bz - 4, 8, 8);

    // sensors
    for (const s of f.sensors) {
      const [x, y] = toScope(s.x, s.z);
      ctx.strokeStyle = s.linked ? 'rgba(255,220,120,0.95)' : 'rgba(255,200,90,0.6)';
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.stroke();
    }

    // afterglow blips
    for (const g of this.afterglow) {
      g.t -= dt;
      const [x, y] = toScope(g.x, g.z);
      ctx.fillStyle = `rgba(170,255,200,${Math.max(0, g.t / 2.2) * 0.9})`;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    this.afterglow = this.afterglow.filter((g) => g.t > 0);

    // known contacts
    ctx.font = '10px ui-monospace, Menlo, monospace';
    for (const ct of f.contacts) {
      const [x, y] = toScope(ct.x, ct.z);
      if (ct.kind === 'detected' || ct.kind === 'fresh') {
        ctx.strokeStyle = ct.kind === 'fresh' ? 'rgba(180,255,200,0.9)' : 'rgba(120,255,160,0.55)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(5, ct.r * k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(160,255,190,0.8)';
        ctx.fillText('?', x - 3, y + 4);
      } else {
        ctx.fillStyle = ct.kind === 'sensor' ? 'rgba(255,230,150,0.95)' : ct.kind === 'resolved' ? 'rgba(220,255,230,0.95)' : 'rgba(170,255,200,0.75)';
        ctx.beginPath();
        if (ct.kind === 'observed') {
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x + 5, y + 4);
          ctx.lineTo(x - 5, y + 4);
          ctx.closePath();
        } else ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ct.marked) {
        ctx.strokeStyle = 'rgba(255,120,80,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = 'rgba(190,255,210,0.85)';
      ctx.fillText(ct.label, x + 8, y - 6);
    }
    // waypoint
    if (f.waypoint) {
      const [x, y] = toScope(f.waypoint.x, f.waypoint.z);
      ctx.strokeStyle = 'rgba(255,190,80,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x - 6, y + 6);
      ctx.stroke();
    }
    // ownship
    ctx.fillStyle = '#d8ffe4';
    ctx.beginPath();
    ctx.moveTo(R, R - 6);
    ctx.lineTo(R + 4, R + 5);
    ctx.lineTo(R, R + 2);
    ctx.lineTo(R - 4, R + 5);
    ctx.closePath();
    ctx.fill();
    // scanlines (restrained)
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < size; y += 3) ctx.fillRect(0, y, size, 1);
    ctx.restore();
    // bezel
    ctx.strokeStyle = 'rgba(140,200,160,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function contactLabelFor(s: SaveState, id: string, x: number, z: number): string {
  const c = s.contacts[id];
  return `${c.codename} ${gridRef(x, z)}`;
}
