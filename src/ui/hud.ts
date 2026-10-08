/**
 * The flight HUD: one objective, one arrow, who is aboard, fuel, radio
 * subtitles, the big moments, the speed lever (which becomes the winch in a
 * hover), the context button, and a round minimap that turns into the hoist
 * scope over the rescue.
 */
import type { RadioLine } from '../core/radio';
import { MAP_PX, valleyImage } from './valleyMap';
import { WORLD_HALF } from '../world/worldData';
import type { SurvivorState } from '../rescue/hoist';

export interface MapFrame {
  mode: 'flight' | 'hoist';
  x: number;
  z: number;
  yaw: number;
  target: { x: number; z: number; kind: 'search' | 'site' | 'pad' } | null;
  search: { x: number; z: number; r: number } | null;
  site: { x: number; z: number } | null;
  pads: { x: number; z: number; hospital: boolean }[];
  hoist?: {
    reach: number;
    site: { x: number; z: number };
    people: { x: number; z: number; state: SurvivorState }[];
    basket: { x: number; z: number; grounded: boolean; len: number };
    winch: { x: number; z: number };
    wind: { x: number; z: number };
  };
}

export type ActionState = { kind: 'hidden' } | { kind: 'hover' } | { kind: 'fly'; label: string } | { kind: 'wait'; label: string };

interface Banner {
  text: string;
  sub: string;
  cls: string;
  t: number;
}

export class Hud {
  private el: Record<string, HTMLElement> = {};
  private map: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private banners: Banner[] = [];
  private shown: Banner | null = null;
  private last: Record<string, string> = {};
  private actionKey = '';

  constructor(root: HTMLElement) {
    for (const id of ['objective', 'obj-icon', 'obj-title', 'obj-detail', 'nav', 'nav-arrow', 'nav-dist', 'nav-label', 'people', 'fuel-fill', 'radio', 'radio-who', 'radio-text', 'banner', 'banner-text', 'banner-sub', 'warn', 'hint', 'readout', 'throttle', 'thr-fill', 'thr-handle', 'thr-basket', 'thr-label', 'thr-hint', 'btn-action', 'stick-label']) {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      this.el[id] = e;
    }
    this.map = root.querySelector<HTMLCanvasElement>('#minimap')!;
    this.mctx = this.map.getContext('2d')!;
  }

  private text(id: string, v: string): void {
    if (this.last[id] === v) return;
    this.last[id] = v;
    this.el[id].textContent = v;
  }

  objective(icon: string, title: string, detail: string): void {
    const key = `${icon}|${title}`;
    if (this.last['obj'] !== key && this.last['obj'] !== undefined) {
      this.el['objective'].classList.remove('obj-pop');
      void this.el['objective'].offsetWidth;
      this.el['objective'].classList.add('obj-pop');
    }
    this.last['obj'] = key;
    this.text('obj-icon', icon);
    this.text('obj-title', title);
    this.text('obj-detail', detail);
  }

  /** Bearing to the target relative to the nose (radians, + right), distance in metres. */
  nav(rel: number | null, dist: number, label: string, kind: string): void {
    const n = this.el['nav'];
    n.style.visibility = rel === null ? 'hidden' : 'visible';
    if (rel === null) return;
    this.el['nav-arrow'].style.transform = `rotate(${rel}rad)`;
    this.text('nav-dist', dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist / 10) * 10} m`);
    this.text('nav-label', label);
    if (this.last['navk'] !== kind) {
      this.last['navk'] = kind;
      n.className = `nav ${kind}`;
    }
  }

  people(states: SurvivorState[]): void {
    const key = states.join(',');
    if (this.last['people'] === key) return;
    this.last['people'] = key;
    this.el['people'].innerHTML = states.map((s) => `<i class="${s === 'aboard' ? 'aboard' : s === 'delivered' ? 'delivered' : ''}"></i>`).join('');
  }

  fuel(f: number): void {
    const w = `${Math.max(0, Math.min(1, f)) * 100}%`;
    if (this.last['fuel'] === w) return;
    this.last['fuel'] = w;
    this.el['fuel-fill'].style.width = w;
    this.el['fuel-fill'].classList.toggle('low', f < 0.25);
  }

  radio(l: RadioLine | null): void {
    this.el['radio'].classList.toggle('on', !!l);
    if (!l) return;
    this.el['radio-who'].textContent = l.who;
    this.el['radio-text'].textContent = l.text;
  }

  banner(text: string, sub = '', cls = '', seconds = 2.4): void {
    this.banners.push({ text, sub, cls, t: seconds });
    if (!this.shown) this.nextBanner();
  }

  clearBanners(): void {
    this.banners = [];
    this.shown = null;
    this.el['banner'].className = 'banner';
  }

  private nextBanner(): void {
    const b = this.banners.shift() ?? null;
    this.shown = b;
    const el = this.el['banner'];
    if (!b) {
      el.className = 'banner';
      return;
    }
    this.el['banner-text'].textContent = b.text;
    this.el['banner-sub'].textContent = b.sub;
    el.className = 'banner';
    void el.offsetWidth;
    el.className = `banner on ${b.cls}`;
  }

  tick(dt: number): void {
    if (!this.shown) return;
    this.shown.t -= dt;
    if (this.shown.t <= 0) this.nextBanner();
  }

  warn(s: string): void {
    if (this.last['warn'] === s) return;
    this.last['warn'] = s;
    this.el['warn'].textContent = s;
    this.el['warn'].classList.toggle('on', !!s);
  }

  hint(s: string): void {
    this.text('hint', s);
  }

  readout(s: string): void {
    this.text('readout', s);
  }

  stickLabel(s: string): void {
    this.text('stick-label', s);
  }

  /** The speed lever (0..1). */
  lever(throttle: number): void {
    this.el['throttle'].classList.remove('winch');
    const p = `${Math.round(throttle * 1000) / 10}%`;
    this.el['thr-fill'].style.height = p;
    this.el['thr-fill'].style.top = '';
    this.el['thr-handle'].style.top = `${100 - Math.round(throttle * 1000) / 10}%`;
    this.text('thr-label', 'SPEED');
    this.text('thr-hint', throttle < 0.04 ? 'HOVER' : '');
  }

  /** The winch: `cmd` and `actual` as fractions of the cable (0 stowed, 1 all the way out). */
  winch(cmd: number, actual: number, label: string): void {
    this.el['throttle'].classList.add('winch');
    this.el['thr-fill'].style.top = '0';
    this.el['thr-fill'].style.height = `${actual * 100}%`;
    this.el['thr-handle'].style.top = `${cmd * 100}%`;
    this.el['thr-basket'].style.top = `${actual * 100}%`;
    this.text('thr-label', '▲ REEL IN');
    this.text('thr-hint', label);
  }

  action(a: ActionState): void {
    const key = JSON.stringify(a);
    if (key === this.actionKey) return;
    this.actionKey = key;
    const b = this.el['btn-action'];
    b.classList.toggle('hidden', a.kind === 'hidden');
    b.classList.toggle('fly', a.kind === 'fly');
    b.classList.toggle('wait', a.kind === 'wait');
    b.textContent = a.kind === 'hover' ? '🛟 HOVER & HOIST' : a.kind === 'fly' || a.kind === 'wait' ? a.label : '';
  }

  // ---------------------------------------------------------------- minimap
  drawMap(f: MapFrame): void {
    const cv = this.map;
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = Math.max(1, Math.round(rect.width * dpr));
    if (cv.width !== S) {
      cv.width = cv.height = S;
    }
    const ctx = this.mctx;
    const R = S / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    // world (relative to the centre) → screen, heading up
    const toScreen = (x: number, z: number, cx: number, cz: number, scale: number) => {
      const dx = x - cx;
      const dz = z - cz;
      return { x: R + (dx * c - dz * s) * scale, y: R + (dx * s + dz * c) * scale };
    };
    if (f.mode === 'flight') {
      const range = 900;
      const scale = R / range;
      ctx.save();
      ctx.translate(R, R);
      ctx.rotate(f.yaw);
      ctx.scale(scale, scale);
      ctx.translate(-f.x, -f.z);
      ctx.drawImage(valleyImage(), -WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2, WORLD_HALF * 2);
      ctx.restore();
      void MAP_PX;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, 0, S, S);
      if (f.search) {
        const p = toScreen(f.search.x, f.search.z, f.x, f.z, scale);
        ctx.fillStyle = 'rgba(46,125,209,0.22)';
        ctx.strokeStyle = '#2e7dd1';
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.search.r * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const pad of f.pads) {
        const p = toScreen(pad.x, pad.z, f.x, f.z, scale);
        ctx.fillStyle = pad.hospital ? '#e23d28' : '#ffb400';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (f.site) {
        const p = toScreen(f.site.x, f.site.z, f.x, f.z, scale);
        ctx.fillStyle = '#ff6a1a';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // the target, pinned to the rim when it is further than the map shows
      if (f.target) {
        let p = toScreen(f.target.x, f.target.z, f.x, f.z, scale);
        const d = Math.hypot(p.x - R, p.y - R);
        const max = R - 9 * dpr;
        if (d > max) p = { x: R + ((p.x - R) / d) * max, y: R + ((p.y - R) / d) * max };
        ctx.fillStyle = f.target.kind === 'pad' ? '#22b35e' : f.target.kind === 'site' ? '#ff6a1a' : '#2e7dd1';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // you: a helicopter arrow
      ctx.fillStyle = '#12263f';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(R, R - 9 * dpr);
      ctx.lineTo(R + 7 * dpr, R + 7 * dpr);
      ctx.lineTo(R, R + 3 * dpr);
      ctx.lineTo(R - 7 * dpr, R + 7 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (f.hoist) {
      // the hoist scope: a close-up straight down, centred on the winch
      const h = f.hoist;
      const range = 15;
      const scale = R / range;
      ctx.fillStyle = '#e9f3e1';
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(18,38,63,0.15)';
      ctx.lineWidth = 1 * dpr;
      for (const k of [5, 10]) {
        ctx.beginPath();
        ctx.arc(R, R, k * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      const site = toScreen(h.site.x, h.site.z, h.winch.x, h.winch.z, scale);
      const bs = toScreen(h.basket.x, h.basket.z, h.winch.x, h.winch.z, scale);
      const inReach = Math.hypot(h.basket.x - h.site.x, h.basket.z - h.site.z) <= h.reach + 2.2;
      ctx.fillStyle = inReach ? 'rgba(34,179,94,0.25)' : 'rgba(255,138,31,0.18)';
      ctx.strokeStyle = inReach ? '#22b35e' : '#ff8a1f';
      ctx.lineWidth = 3 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.arc(site.x, site.y, (h.reach + 2.2) * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of h.people) {
        if (p.state === 'aboard' || p.state === 'delivered' || p.state === 'basket') continue;
        const q = toScreen(p.x, p.z, h.winch.x, h.winch.z, scale);
        ctx.fillStyle = '#ff6a1a';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // cable from the winch to the basket
      if (h.basket.len > 0.3) {
        ctx.strokeStyle = 'rgba(18,38,63,0.6)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(R, R);
        ctx.lineTo(bs.x, bs.y);
        ctx.stroke();
      }
      ctx.fillStyle = h.basket.grounded ? '#ff6a1a' : 'rgba(255,106,26,0.35)';
      ctx.strokeStyle = '#ff6a1a';
      ctx.lineWidth = 3 * dpr;
      const b = 7 * dpr;
      ctx.fillRect(bs.x - b, bs.y - b * 0.7, b * 2, b * 1.4);
      ctx.strokeRect(bs.x - b, bs.y - b * 0.7, b * 2, b * 1.4);
      // the ring off the edge of the scope: point the way
      const ds = Math.hypot(site.x - R, site.y - R);
      if (ds > R - 6 * dpr) {
        const ux = (site.x - R) / ds;
        const uy = (site.y - R) / ds;
        const tip = R - 8 * dpr;
        ctx.fillStyle = '#ff8a1f';
        ctx.beginPath();
        ctx.moveTo(R + ux * tip, R + uy * tip);
        ctx.lineTo(R + ux * (tip - 14 * dpr) - uy * 8 * dpr, R + uy * (tip - 14 * dpr) + ux * 8 * dpr);
        ctx.lineTo(R + ux * (tip - 14 * dpr) + uy * 8 * dpr, R + uy * (tip - 14 * dpr) - ux * 8 * dpr);
        ctx.closePath();
        ctx.fill();
      }
      // the wind: which way it is pushing you
      const ws = Math.hypot(h.wind.x, h.wind.z);
      if (ws > 0.5) {
        const wx = (h.wind.x * c - h.wind.z * s) / ws;
        const wy = (h.wind.x * s + h.wind.z * c) / ws;
        const bx = R - wx * R * 0.55;
        const by = R - wy * R * 0.55;
        const len = R * 0.32;
        ctx.strokeStyle = 'rgba(46,125,209,0.85)';
        ctx.fillStyle = 'rgba(46,125,209,0.85)';
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + wx * len, by + wy * len);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx + wx * (len + 7 * dpr), by + wy * (len + 7 * dpr));
        ctx.lineTo(bx + wx * len - wy * 5 * dpr, by + wy * len + wx * 5 * dpr);
        ctx.lineTo(bx + wx * len + wy * 5 * dpr, by + wy * len - wx * 5 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.font = `900 ${Math.round(8 * dpr)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('WIND', bx - wx * 9 * dpr, by - wy * 9 * dpr + 3 * dpr);
      }
      // the winch: a crosshair
      ctx.strokeStyle = '#12263f';
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(R - 9 * dpr, R);
      ctx.lineTo(R + 9 * dpr, R);
      ctx.moveTo(R, R - 9 * dpr);
      ctx.lineTo(R, R + 9 * dpr);
      ctx.stroke();
      ctx.fillStyle = '#12263f';
      ctx.font = `900 ${Math.round(9 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('▲ AHEAD', R, 13 * dpr);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(R, R, R - 1.5 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
}
