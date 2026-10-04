import type { Orbit } from '../flight/autopilot';
import type { OperationsArea } from '../mission/missionDef';
import type { ReturnId } from '../mission/mission01';
import { RIVER, ROADS, type Pt } from '../world/worldData';

export type OpsTool = 'radar' | 'camera';

export interface OpsReturn {
  id: ReturnId;
  x: number;
  z: number;
  traits: string[];
  verdict: 'none' | 'correct' | 'wrong';
  resolved: boolean;
}

export interface OpsFrame {
  tool: OpsTool;
  objective: { title: string; detail: string; progress: number | null };
  orbit: Orbit;
  aircraft: { x: number; z: number; yaw: number; agl: number };
  footprint: number;
  sweep: number;
  fuelSeconds: number;
  timeOnStation: number;
  area: OperationsArea;
  /** Detected returns only. */
  returns: OpsReturn[];
  selected: ReturnId | null;
  camera: { label: string; acquire: number | null };
  canMark: boolean;
  hint: string;
  displayHint: string;
}

export interface OpsHandlers {
  onTool(t: OpsTool): void;
  onSelect(id: ReturnId): void;
  onMark(): void;
  onRetask(x: number, z: number): void;
  onTakeControls(): void;
  onPause(): void;
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const NOTES: Record<OpsTool, string> = {
  radar: 'Finds vehicles and shows whether they move. Cannot tell what they are. Tap the display to send the orbit there.',
  camera: 'Shows what a vehicle is: size, count, road. Select a return to slew the camera; the orbit follows it.',
};

/**
 * The operator's station. Nothing here flies the aircraft: the controls are
 * sensors, target selection, marking and re-tasking the autopilot's orbit.
 */
export class OpsConsole {
  readonly root: HTMLElement;
  readonly display: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private radar: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private last: OpsFrame | null = null;
  private listHtml = '';
  private active = false;

  constructor(root: HTMLElement, private h: OpsHandlers) {
    this.root = root;
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['ops-orbit', 'ops-fuel', 'ops-time', 'ops-obj-title', 'ops-obj-detail', 'ops-obj-progress', 'ops-cam', 'ops-cam-label', 'ops-cam-acq', 'ops-display-hint', 'ops-tool-note', 'ops-returns', 'btn-ops-mark', 'ops-hint', 'btn-take', 'btn-ops-pause']) this.el[id] = q(id);
    this.display = q('ops-display');
    this.radar = q('ops-radar') as HTMLCanvasElement;
    this.ctx = this.radar.getContext('2d')!;

    for (const b of root.querySelectorAll<HTMLElement>('[data-tool]')) b.addEventListener('click', () => h.onTool(b.dataset.tool as OpsTool));
    this.el['btn-ops-mark'].addEventListener('click', () => h.onMark());
    this.el['btn-take'].addEventListener('click', () => h.onTakeControls());
    this.el['btn-ops-pause'].addEventListener('click', () => h.onPause());
    this.el['ops-returns'].addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (row) h.onSelect(row.dataset.id as ReturnId);
    });
    this.radar.addEventListener('pointerdown', (e) => this.onDisplayTap(e));
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === '1') h.onTool('radar');
      else if (k === '2') h.onTool('camera');
      else if (['a', 'b', 'c', 'd'].includes(k) && this.last?.returns.some((r) => r.id === k.toUpperCase())) h.onSelect(k.toUpperCase() as ReturnId);
    });
  }

  show(): void {
    this.active = true;
    this.listHtml = '';
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.active = false;
    this.root.classList.add('hidden');
  }

  /** Screen rectangle of the sensor display, for rendering the camera feed into it. */
  displayRect(): DOMRect {
    return this.display.getBoundingClientRect();
  }

  // ------------------------------------------------------------------ map projection
  private view(f: OpsFrame): { x0: number; z0: number; s: number; ox: number; oy: number } {
    const w = this.radar.clientWidth;
    const hgt = this.radar.clientHeight;
    const m = 280;
    const x0 = f.area.x0 - m;
    const x1 = f.area.x1 + m;
    const z0 = f.area.z0 - m;
    const z1 = f.area.z1 + m;
    const s = Math.min(w / (x1 - x0), hgt / (z1 - z0));
    return { x0, z0, s, ox: (w - (x1 - x0) * s) / 2, oy: (hgt - (z1 - z0) * s) / 2 };
  }

  private onDisplayTap(e: PointerEvent): void {
    const f = this.last;
    if (!f) return;
    e.preventDefault();
    const r = this.radar.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const v = this.view(f);
    // a tap on a return selects it; anywhere else re-tasks the orbit
    for (const ret of f.returns) {
      const sx = v.ox + (ret.x - v.x0) * v.s;
      const sy = v.oy + (ret.z - v.z0) * v.s;
      if (Math.hypot(sx - px, sy - py) < 26) {
        this.h.onSelect(ret.id);
        return;
      }
    }
    this.h.onRetask(v.x0 + (px - v.ox) / v.s, v.z0 + (py - v.oy) / v.s);
  }

  update(f: OpsFrame): void {
    this.last = f;
    this.el['ops-orbit'].textContent = `ORBIT ${Math.round(f.aircraft.agl)} m`;
    this.el['ops-fuel'].textContent = `FUEL ${mmss(f.fuelSeconds)}`;
    this.el['ops-time'].textContent = `ON STATION ${mmss(f.timeOnStation)}`;
    this.el['ops-obj-title'].textContent = f.objective.title;
    this.el['ops-obj-detail'].textContent = f.objective.detail;
    this.el['ops-obj-progress'].parentElement!.classList.toggle('on', f.objective.progress !== null);
    this.el['ops-obj-progress'].style.width = `${Math.round((f.objective.progress ?? 0) * 100)}%`;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-tool]')) {
      const on = b.dataset.tool === f.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    this.root.classList.toggle('tool-camera', f.tool === 'camera');
    this.el['ops-tool-note'].textContent = NOTES[f.tool];
    this.el['ops-cam'].classList.toggle('hidden', f.tool !== 'camera');
    this.el['ops-cam-label'].textContent = f.camera.label;
    this.el['ops-cam-acq'].parentElement!.classList.toggle('on', f.camera.acquire !== null);
    this.el['ops-cam-acq'].style.width = `${Math.round((f.camera.acquire ?? 0) * 100)}%`;
    this.el['ops-display-hint'].textContent = f.displayHint;
    this.el['ops-hint'].textContent = f.hint;
    this.el['btn-ops-mark'].classList.toggle('disabled', !f.canMark);
    this.el['btn-ops-mark'].toggleAttribute('disabled', !f.canMark);

    const html = f.returns.length
      ? f.returns
          .map((r) => {
            const tag = r.verdict === 'correct' ? '<em class="v ok">TRUCK</em>' : r.verdict === 'wrong' ? '<em class="v no">NOT THE TRUCK</em>' : '';
            return `<button type="button" class="ret${r.id === f.selected ? ' sel' : ''} ${r.verdict}" data-id="${r.id}"><b>${r.id}</b><span>${r.traits.map((t) => `<i>${t}</i>`).join('')}</span>${tag}</button>`;
          })
          .join('')
      : '<p class="none">No returns yet. Sweep the roads with the radar.</p>';
    if (html !== this.listHtml) {
      this.listHtml = html;
      this.el['ops-returns'].innerHTML = html;
    }
    if (f.tool === 'radar') this.drawRadar(f);
  }

  private drawRadar(f: OpsFrame): void {
    const c = this.radar;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = this.view(f);
    const P = (x: number, z: number): [number, number] => [v.ox + (x - v.x0) * v.s, v.oy + (z - v.z0) * v.s];
    ctx.fillStyle = '#04120a';
    ctx.fillRect(0, 0, w, hgt);
    // grid
    ctx.strokeStyle = 'rgba(110,255,150,0.07)';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(v.x0 / 200) * 200; gx < v.x0 + w / v.s; gx += 200) {
      const [x] = P(gx, 0);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, hgt);
      ctx.stroke();
    }
    for (let gz = Math.ceil(v.z0 / 200) * 200; gz < v.z0 + hgt / v.s; gz += 200) {
      const [, y] = P(0, gz);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const line = (pts: readonly Pt[], style: string, width: number, dash: number[] = []) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach(([x, z], i) => {
        const [px, py] = P(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(RIVER, 'rgba(110,190,255,0.35)', 3);
    for (const r of ROADS) line(r.pts, r.kind === 'road' ? 'rgba(200,255,215,0.45)' : 'rgba(200,255,215,0.28)', r.kind === 'road' ? 2 : 1.5, r.kind === 'road' ? [] : [4, 3]);
    // operations area
    const a = f.area;
    const [ax0, az0] = P(a.x0, a.z0);
    const [ax1, az1] = P(a.x1, a.z1);
    ctx.strokeStyle = 'rgba(242,169,59,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ax0, az0, ax1 - ax0, az1 - az0);
    ctx.fillStyle = 'rgba(242,169,59,0.85)';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText(a.label, ax0 + 4, az0 + 12);
    // orbit + footprint
    const [ocx, ocy] = P(f.orbit.x, f.orbit.z);
    ctx.strokeStyle = 'rgba(242,169,59,0.6)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(ocx, ocy, f.orbit.r * v.s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ocx - 5, ocy);
    ctx.lineTo(ocx + 5, ocy);
    ctx.moveTo(ocx, ocy - 5);
    ctx.lineTo(ocx, ocy + 5);
    ctx.stroke();
    const [acx, acy] = P(f.aircraft.x, f.aircraft.z);
    ctx.fillStyle = 'rgba(110,255,150,0.08)';
    ctx.strokeStyle = 'rgba(110,255,150,0.5)';
    ctx.beginPath();
    ctx.arc(acx, acy, f.footprint * v.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170,255,200,0.85)';
    ctx.beginPath();
    ctx.moveTo(acx, acy);
    ctx.lineTo(acx + Math.cos(f.sweep) * f.footprint * v.s, acy + Math.sin(f.sweep) * f.footprint * v.s);
    ctx.stroke();
    // aircraft
    ctx.save();
    ctx.translate(acx, acy);
    ctx.rotate(-f.aircraft.yaw);
    ctx.fillStyle = '#d8ffe4';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // returns
    ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
    for (const r of f.returns) {
      const [x, y] = P(r.x, r.z);
      const col = r.verdict === 'correct' ? '#f2a93b' : r.verdict === 'wrong' ? '#ff5a3c' : r.resolved ? '#e8f3ea' : '#7cff9a';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      if (r.id === f.selected) {
        ctx.strokeStyle = '#f2a93b';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 11, y - 11, 22, 22);
        ctx.lineWidth = 1;
      }
      ctx.fillText(r.id, x + 9, y - 7);
    }
  }
}
