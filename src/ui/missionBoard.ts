/**
 * MISSION CONTROL board, in two steps with one tap each:
 *
 *   STEP 1 · FIND IT   the vehicles are lit, the routes dimmed. Tap a vehicle:
 *                      its card shows the clues it fits and the looks you can
 *                      take. LOOK, or MARK it as the truck. Marking ends the step.
 *   STEP 2 · WAY OUT   the routes are lit, the vehicles dimmed. Tap a route to
 *                      fly it home; tap a ? on it to scout it. LOCK THE PLAN.
 *
 * The clock runs the whole time, in real seconds. Nothing here changes the
 * game: every action goes back through the handlers.
 */
import type { AssetId, BoardEvent, CellTruth, ClueCheck, ControlResult, ExitTier, Target } from '../control/board';
import { CELL_LABEL } from '../control/board';
import type { ExitLine, ExitProfile } from '../control/exit';
import { TIER_LABEL } from '../control/exit';
import type { OperationsArea } from '../mission/missionDef';
import type { ReturnId } from '../mission/mission01';
import { RIVER, ROADS, type Pt } from '../world/worldData';

export type BoardStep = 'find' | 'exit';

export interface BoardAction {
  /** 'asset' takes seconds off the clock; 'mark' calls the truck. */
  kind: 'asset' | 'mark';
  asset?: AssetId;
  label: string;
  cost?: number;
  ok: boolean;
  reason: string;
  /** Doing this runs the clock out. */
  front?: boolean;
}

export interface BoardReturn {
  id: ReturnId;
  x: number;
  z: number;
  moving: boolean;
  status: 'unknown' | 'fits' | 'out' | 'truck' | 'wrong' | 'barge';
  traits: string[];
  checks: ClueCheck[];
  photo: { url: string; thermal: boolean } | null;
  actions: BoardAction[];
}

export interface BoardCell {
  id: string;
  corridor: string;
  corridorLabel: string;
  x: number;
  z: number;
  belief: CellTruth | null;
  possible: CellTruth[];
  forecast: CellTruth;
  contradicted: boolean;
  actions: BoardAction[];
}

export interface BoardCorridor {
  id: string;
  label: string;
  short: string;
  note: string;
  path: { x: number; z: number }[];
  selected: boolean;
  known: number;
  total: number;
}

export interface BoardAsset {
  id: AssetId;
  label: string;
  icon: string;
  cost: number;
  left: number | null;
  ok: boolean;
  reason: string;
  note: string;
  target: 'return' | 'cell' | 'none';
  /** Valid targets right now, as keys ('r:C', 'c:N1'). */
  targets: string[];
}

/** An action that belongs to the step, not to a target (SIGINT on every radio; SHADOW the marked truck). */
export interface StepAction extends BoardAction {
  target: Target;
}

export interface BoardFrame {
  /** The clock, in real seconds. */
  seconds: number;
  maxSeconds: number;
  fuelSeconds: number;
  control: string;
  step: BoardStep;
  /** The truck is marked (step 1 is done for good). */
  marked: boolean;
  stepActions: StepAction[];
  returns: BoardReturn[];
  cells: BoardCell[];
  corridors: BoardCorridor[];
  aircraft: { x: number; z: number; yaw: number };
  orbit: { x: number; z: number; r: number } | null;
  base: { x: number; z: number };
  area: OperationsArea;
  landing: { x: number; z: number; label: string } | null;
  assets: BoardAsset[];
  pending: { asset: AssetId; target: Target; k: number; from: { x: number; z: number } } | null;
  forecast: { rank: string; tier: ExitTier; total: number; lines: ExitLine[] } | null;
  canExecute: boolean;
  executeHint: string;
  executed: boolean;
}

export interface BoardHandlers {
  onUse(asset: AssetId, target: Target): void;
  onMark(id: ReturnId): void;
  onCorridor(id: string): void;
  onStep(step: BoardStep): void;
  onExecute(): void;
  onFlyOut(): void;
  onPause(): void;
  onTap(): void;
}

const key = (t: Target | null): string => (!t ? '' : t.kind === 'return' ? `r:${t.id}` : t.kind === 'cell' ? `c:${t.id}` : 'none');
const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const C = { ph: '#7cff9a', amber: '#f2a93b', warn: '#ff5a3c', ice: '#8fd0ff', dim: 'rgba(232,243,234,0.45)', ink: '#04120a' };
const TRUTH_COLOR: Record<CellTruth, string> = { clear: C.ph, storm: C.warn, cloud: '#c9d1d9', radar: C.warn, cache: C.ice };
const STATUS_LABEL: Record<BoardReturn['status'], string> = { unknown: 'UNCHECKED', fits: 'FITS SO FAR', out: 'RULED OUT', truck: 'THE TRUCK', wrong: 'NOT THE TRUCK', barge: 'THE BARGE' };

/** The clock turns red with this much left. */
export const URGENT_SECONDS = 15;

/** Which step the board is on: marking the truck ends step 1 for good; a player who cannot find it may go on without. */
export function boardStep(marked: boolean, skipped: boolean): BoardStep {
  return marked || skipped ? 'exit' : 'find';
}

/** Map bounds (world metres): the sector, the three routes and the runway. */
const BOUNDS = { x0: -920, x1: 1060, z0: -330, z1: 830 };

export class MissionBoard {
  readonly root: HTMLElement;
  private h: BoardHandlers;
  private map: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private el: Record<string, HTMLElement> = {};
  private last: BoardFrame | null = null;
  private selected: Target | null = null;
  private keys: Record<string, string> = {};
  private toasts: { ev: BoardEvent; t: number }[] = [];
  private flashes = new Map<string, number>();
  private active = false;
  private resultTimers: number[] = [];
  /** The live telephoto view (Game draws into it while a look plays). */
  readonly feed: HTMLCanvasElement;

  constructor(root: HTMLElement, h: BoardHandlers) {
    this.root = root;
    this.h = h;
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['mb-control', 'mb-bar-fill', 'mb-min', 'mb-fuel', 'mb-forecast', 'mb-step', 'mb-card-head', 'mb-card-body', 'mb-vf', 'mb-vf-img', 'mb-routes', 'mb-preview', 'btn-execute', 'mb-exec-hint', 'mb-toast', 'mb-result', 'btn-mb-pause', 'mb-plan-head']) this.el[id] = q(id);
    this.map = q('mb-map') as HTMLCanvasElement;
    this.ctx = this.map.getContext('2d')!;
    this.feed = q('mb-feed') as HTMLCanvasElement;

    this.map.addEventListener('pointerdown', (e) => this.onMapTap(e));
    this.el['mb-step'].addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step],[data-global]');
      if (!b || b.disabled || !this.last || this.last.executed) return;
      if (b.dataset.step) {
        this.selected = null;
        h.onStep(b.dataset.step as BoardStep);
        h.onTap();
      } else {
        const a = this.last.stepActions.find((x) => x.asset === b.dataset.global);
        if (a?.ok) h.onUse(a.asset!, a.target);
      }
    });
    this.el['mb-card-body'].addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
      if (!b || b.disabled || !this.selected) return;
      if (b.dataset.act === 'mark' && this.selected.kind === 'return') h.onMark(this.selected.id);
      else if (b.dataset.act) h.onUse(b.dataset.act as AssetId, this.selected);
    });
    this.el['mb-routes'].addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-route]');
      if (b && this.last?.step === 'exit') h.onCorridor(b.dataset.route!);
    });
    this.el['btn-execute'].addEventListener('click', () => {
      if (this.last?.canExecute) h.onExecute();
    });
    this.el['btn-mb-pause'].addEventListener('click', () => h.onPause());
    this.el['mb-result'].addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#btn-fly-out')) h.onFlyOut();
      else this.skipResult();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat) return;
      if (e.key === 'Enter') {
        if (!this.el['mb-result'].classList.contains('hidden')) {
          if (this.el['mb-result'].classList.contains('done')) h.onFlyOut();
          else this.skipResult();
        } else if (this.last?.canExecute) h.onExecute();
      }
    });
  }

  show(): void {
    this.active = true;
    this.selected = null;
    this.keys = {};
    this.toasts = [];
    this.flashes.clear();
    this.el['mb-result'].className = 'mb-result hidden';
    this.el['mb-vf'].classList.add('hidden');
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.active = false;
    for (const t of this.resultTimers) window.clearTimeout(t);
    this.resultTimers = [];
    this.root.classList.add('hidden');
  }

  get isOpen(): boolean {
    return this.active;
  }

  select(t: Target | null): void {
    this.selected = t;
  }

  /** What the board just learned: a pop over the map and a flash on the spot. */
  events(evs: BoardEvent[]): void {
    for (const ev of evs) {
      this.toasts.push({ ev, t: 0 });
      if (ev.target) this.flashes.set(key(ev.target), performance.now());
    }
    if (this.toasts.length > 3) this.toasts.splice(0, this.toasts.length - 3);
    this.renderToasts();
  }

  private renderToasts(): void {
    this.el['mb-toast'].innerHTML = this.toasts.map(({ ev }) => `<div class="tst ${ev.type}"><b>${esc(ev.title)}</b><span>${esc(ev.text)}</span></div>`).join('');
  }

  // ------------------------------------------------------------------ map
  private view(): { s: number; ox: number; oy: number } {
    const w = this.map.clientWidth;
    const hgt = this.map.clientHeight;
    const s = Math.min(w / (BOUNDS.x1 - BOUNDS.x0), hgt / (BOUNDS.z1 - BOUNDS.z0));
    return { s, ox: (w - (BOUNDS.x1 - BOUNDS.x0) * s) / 2, oy: (hgt - (BOUNDS.z1 - BOUNDS.z0) * s) / 2 };
  }

  private P(x: number, z: number): [number, number] {
    const v = this.view();
    return [v.ox + (x - BOUNDS.x0) * v.s, v.oy + (z - BOUNDS.z0) * v.s];
  }

  /** What is under a screen point, on this step: a vehicle (step 1), or a route spot or route line (step 2). */
  private hit(px: number, py: number): { target: Target | null; corridor: string | null } {
    const f = this.last;
    if (!f) return { target: null, corridor: null };
    let best: { t: Target; d: number } | null = null;
    if (f.step === 'find') {
      for (const r of f.returns) {
        const [x, y] = this.P(r.x, r.z);
        const d = Math.hypot(x - px, y - py);
        if (d < 26 && (!best || d < best.d)) best = { t: { kind: 'return', id: r.id }, d };
      }
      return { target: best?.t ?? null, corridor: null };
    }
    for (const c of f.cells) {
      const [x, y] = this.P(c.x, c.z);
      const d = Math.hypot(x - px, y - py);
      if (d < 26 && (!best || d < best.d)) best = { t: { kind: 'cell', id: c.id }, d };
    }
    if (best) return { target: best.t, corridor: null };
    let corridor: string | null = null;
    let cd = 18;
    for (const c of f.corridors) {
      for (let i = 1; i < c.path.length; i++) {
        const [ax, ay] = this.P(c.path[i - 1].x, c.path[i - 1].z);
        const [bx, by] = this.P(c.path[i].x, c.path[i].z);
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(ax + dx * t - px, ay + dy * t - py);
        if (d < cd) {
          cd = d;
          corridor = c.id;
        }
      }
    }
    return { target: null, corridor };
  }

  private onMapTap(e: PointerEvent): void {
    if (!this.last || this.last.executed) return;
    e.preventDefault();
    const r = this.map.getBoundingClientRect();
    const { target, corridor } = this.hit(e.clientX - r.left, e.clientY - r.top);
    if (target) {
      this.selected = target;
      this.h.onTap();
    } else if (corridor) {
      this.selected = null;
      this.h.onCorridor(corridor);
    } else this.selected = null;
  }

  // ------------------------------------------------------------------ frame
  update(f: BoardFrame, dt: number): void {
    this.last = f;
    const set = (k: string, html: string, el: HTMLElement) => {
      if (this.keys[k] === html) return;
      this.keys[k] = html;
      el.innerHTML = html;
    };
    this.root.classList.toggle('step-find', f.step === 'find');
    this.root.classList.toggle('step-exit', f.step === 'exit');
    this.el['mb-control'].textContent = f.control;
    // the clock: a bar that drains, the seconds, red when the front is close
    const left = f.maxSeconds > 0 ? Math.max(0, Math.min(1, f.seconds / f.maxSeconds)) : 0;
    this.el['mb-bar-fill'].style.width = `${(left * 100).toFixed(1)}%`;
    this.el['mb-min'].textContent = mmss(f.seconds);
    this.el['mb-min'].parentElement!.classList.toggle('urgent', f.seconds <= URGENT_SECONDS);
    this.el['mb-fuel'].textContent = mmss(f.fuelSeconds);
    const fc = f.forecast;
    set('fc', fc ? `<small>EXIT · ${fc.rank}</small><b class="t-${fc.tier}">${TIER_LABEL[fc.tier]}</b>` : '<small>EXIT</small><b>NO ROUTE</b>', this.el['mb-forecast']);
    // the step strip: where you are, the one or two actions that belong to the step, and the way to the other step
    const globals = f.stepActions.map((a) => `<button type="button" class="sg" data-global="${a.asset}" ${a.ok ? '' : 'disabled'}><b>${esc(a.label)}</b><small>${a.ok ? `${a.cost} s` : esc(a.reason)}</small></button>`).join('');
    const jump = f.step === 'find' ? `<button type="button" class="sj" data-step="exit">CAN'T FIND IT · WAY OUT ›</button>` : f.marked ? '' : `<button type="button" class="sj" data-step="find">‹ BACK · FIND IT</button>`;
    set('step', `<div class="sn"><small>STEP ${f.step === 'find' ? '1' : '2'} OF 2</small><b>${f.step === 'find' ? 'FIND THE TRUCK' : 'WAY OUT'}</b></div>${globals}${jump}`, this.el['mb-step']);
    this.renderCard(f);
    // routes and the plan
    this.el['mb-plan-head'].textContent = f.step === 'find' ? 'STEP 2 · WAY OUT' : 'WAY OUT';
    set(
      'routes',
      f.corridors.map((c) => `<button type="button" class="rt${c.selected ? ' on' : ''}" data-route="${c.id}" ${f.step === 'find' ? 'disabled' : ''}><b>${c.short}</b><small>${c.known}/${c.total} SCOUTED</small></button>`).join(''),
      this.el['mb-routes'],
    );
    set('preview', fc ? fc.lines.map((l) => `<li class="${l.tone}"><small>${l.label}</small><b>${esc(l.value)}</b></li>`).join('') : `<li class="mb-hint">${f.step === 'find' ? 'Find the truck first. The way out comes next.' : 'Tap a route home. Tap a ? on it to scout it.'}</li>`, this.el['mb-preview']);
    const ex = this.el['btn-execute'] as HTMLButtonElement;
    ex.disabled = !f.canExecute;
    ex.classList.toggle('ready', f.canExecute);
    this.el['mb-exec-hint'].textContent = f.executeHint;
    // toasts age out
    for (const t of this.toasts) t.t += dt;
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.t < 2.6);
    if (this.toasts.length !== before) this.renderToasts();
    this.draw(f);
  }

  private renderCard(f: BoardFrame): void {
    const sel = this.selected;
    const head = this.el['mb-card-head'];
    const body = this.el['mb-card-body'];
    const vf = this.el['mb-vf'];
    const img = this.el['mb-vf-img'] as HTMLImageElement;
    const pend = f.pending && sel && key(f.pending.target) === key(sel) ? f.pending : null;
    const looking = !!pend && pend.target.kind === 'return' && (pend.asset === 'optical' || pend.asset === 'thermal');
    let headHtml = '';
    let bodyHtml = '';
    let photo: BoardReturn['photo'] = null;
    if (sel?.kind === 'return' && f.step === 'find') {
      const r = f.returns.find((x) => x.id === sel.id);
      if (r) {
        photo = r.photo;
        headHtml = `<b>${r.status === 'barge' ? 'BARGE' : `RETURN ${r.id}`}</b><span class="st ${r.status}">${STATUS_LABEL[r.status]}</span>`;
        const checks = r.status === 'barge' ? '' : `<div class="clues">${r.checks.map((c) => `<i class="${c.check === 'yes' ? 'yes' : c.check === 'no' ? 'no' : 'unk'}">${c.check === 'yes' ? '✓' : c.check === 'no' ? '✕' : '?'} ${c.clue}</i>`).join('')}</div>`;
        bodyHtml = `${checks}<div class="traits">${r.traits.map((t) => `<i>${t}</i>`).join('')}</div>${this.actions(r.actions)}`;
      }
    } else if (sel?.kind === 'cell' && f.step === 'exit') {
      const c = f.cells.find((x) => x.id === sel.id);
      if (c) {
        headHtml = `<b>${c.belief ? CELL_LABEL[c.belief] : 'UNKNOWN'}</b><span class="st">${esc(c.corridorLabel)}</span>`;
        const tower = c.contradicted ? `<p class="twr bad">TOWER SAID ${CELL_LABEL[c.forecast]} · WRONG</p>` : !c.belief ? `<p class="twr">TOWER FORECAST: ${CELL_LABEL[c.forecast]}${c.forecast === 'clear' ? '' : '?'}</p>` : '';
        const could = c.belief ? '' : `<div class="could"><small>COULD BE</small>${(['clear', 'storm', 'cloud', 'radar', 'cache'] as CellTruth[]).map((t) => `<i class="${c.possible.includes(t) ? '' : 'gone'} k-${t}">${CELL_LABEL[t]}</i>`).join('')}</div>`;
        const what = c.belief ? `<p class="what">${WHAT[c.belief]}</p>` : '';
        bodyHtml = `${what}${tower}${could}${this.actions(c.actions)}`;
      }
    }
    if (!headHtml) {
      if (f.step === 'find') {
        headHtml = '<b>FIND THE TRUCK</b><span class="st">TAP A VEHICLE</span>';
        bodyHtml = `<ol class="how"><li><b>TAP</b> a vehicle on the map.</li><li><b>LOOK</b> at it, or <b>MARK</b> it as the truck.</li></ol>`;
      } else {
        headHtml = '<b>WAY OUT</b><span class="st">TAP A ROUTE</span>';
        bodyHtml = `<ol class="how"><li><b>TAP</b> a route home.</li><li><b>SCOUT</b> a ? on it, or <b>LOCK</b> the plan.</li></ol>`;
      }
    }
    if (this.keys.cardHead !== headHtml) {
      this.keys.cardHead = headHtml;
      head.innerHTML = headHtml;
    }
    if (this.keys.cardBody !== bodyHtml) {
      this.keys.cardBody = bodyHtml;
      body.innerHTML = bodyHtml;
    }
    // the viewfinder: live while a look plays, then the print
    vf.classList.toggle('hidden', !looking && !photo);
    vf.classList.toggle('thermal', looking ? pend!.asset === 'thermal' : !!photo?.thermal);
    vf.classList.toggle('live', looking);
    this.feed.style.display = looking ? 'block' : 'none';
    img.style.display = !looking && photo ? 'block' : 'none';
    if (photo && img.getAttribute('src') !== photo.url) img.setAttribute('src', photo.url);
  }

  private actions(list: BoardAction[]): string {
    if (!list.length) return '';
    return `<div class="acts">${list
      .map((a) => {
        const cls = a.kind === 'mark' ? 'mark' : a.asset === 'shadow' ? 'shadow' : '';
        const cost = a.cost ? `<small>${a.cost} s${a.front ? ' · LAST' : ''}</small>` : '';
        return `<button type="button" class="act ${cls}" data-act="${a.kind === 'mark' ? 'mark' : a.asset}" ${a.ok ? '' : 'disabled'}><b>${esc(a.label)}</b>${a.ok ? cost : `<small>${esc(a.reason)}</small>`}</button>`;
      })
      .join('')}</div>`;
  }

  private draw(f: BoardFrame): void {
    const c = this.map;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
    }
    const ctx = this.ctx;
    const now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04120a';
    ctx.fillRect(0, 0, w, hgt);
    const v = this.view();
    const P = (x: number, z: number) => this.P(x, z);
    // grid
    ctx.strokeStyle = 'rgba(110,255,150,0.06)';
    ctx.lineWidth = 1;
    for (let gx = -800; gx <= 1000; gx += 200) {
      const [x] = P(gx, 0);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, hgt);
      ctx.stroke();
    }
    for (let gz = -200; gz <= 800; gz += 200) {
      const [, y] = P(0, gz);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const line = (pts: readonly Pt[] | { x: number; z: number }[], style: string, width: number, dash: number[] = []) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [px, py] = Array.isArray(p) ? P(p[0], p[1]) : P((p as { x: number }).x, (p as { z: number }).z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(RIVER, 'rgba(110,190,255,0.28)', 3);
    for (const r of ROADS) line(r.pts, 'rgba(200,255,215,0.16)', r.kind === 'road' ? 1.6 : 1, r.kind === 'road' ? [] : [3, 3]);
    // the sector
    const [ax0, az0] = P(f.area.x0, f.area.z0);
    const [ax1, az1] = P(f.area.x1, f.area.z1);
    ctx.fillStyle = 'rgba(242,169,59,0.05)';
    ctx.fillRect(ax0, az0, ax1 - ax0, az1 - az0);
    ctx.strokeStyle = 'rgba(242,169,59,0.7)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(ax0, az0, ax1 - ax0, az1 - az0);
    ctx.font = '600 9px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(242,169,59,0.85)';
    ctx.fillText(f.area.label, ax0 + 4, az0 + 11);
    // base
    const [bx, by] = P(f.base.x, f.base.z);
    ctx.strokeStyle = C.ph;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx - 14, by);
    ctx.lineTo(bx + 14, by);
    ctx.stroke();
    ctx.fillStyle = C.ph;
    ctx.fillText('BASE', bx - 12, by + 14);
    // the routes home (dimmed while the truck is still being found)
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    const exitStep = f.step === 'exit';
    ctx.save();
    if (!exitStep) ctx.globalAlpha = 0.3;
    for (const cr of f.corridors) {
      const pts = [{ x: (f.area.x0 + f.area.x1) / 2, z: 150 }, ...cr.path];
      if (cr.selected) {
        line(pts, 'rgba(242,169,59,0.25)', 9);
        line(pts, C.amber, 2.5);
      } else line(pts, 'rgba(232,243,234,0.32)', 1.5, [6, 5]);
      const mid = cr.path[Math.floor(cr.path.length / 2)];
      const [mx, my] = P(mid.x, mid.z);
      ctx.font = `${cr.selected ? '700' : '500'} 10px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = cr.selected ? C.amber : 'rgba(232,243,234,0.55)';
      ctx.fillText(cr.short, mx - 16, my + (cr.id === 'north' ? -12 : 18));
    }
    // route spots: on step 2 the unknown ones pulse (tap one to scout it)
    for (const cell of f.cells) {
      const [x, y] = P(cell.x, cell.z);
      const target = exitStep && !cell.belief;
      const fl = this.flashes.get(`c:${cell.id}`);
      const k = fl ? Math.max(0, 1 - (now - fl) / 900) : 0;
      ctx.fillStyle = '#071a0f';
      ctx.strokeStyle = cell.belief ? TRUTH_COLOR[cell.belief] : target ? C.amber : 'rgba(232,243,234,0.6)';
      ctx.lineWidth = target ? 1.5 + pulse * 1.2 : 1.5;
      diamond(ctx, x, y, 12 + k * 8);
      ctx.fill();
      ctx.stroke();
      drawTruth(ctx, cell.belief, x, y);
      if (!cell.belief && !cell.contradicted && cell.forecast !== 'clear') {
        ctx.font = '600 8px ui-monospace, Menlo, monospace';
        ctx.fillStyle = 'rgba(232,243,234,0.7)';
        ctx.fillText(`TWR:${cell.forecast === 'storm' ? 'STORM' : 'CLOUD'}`, x - 18, y - 16);
      }
      if (cell.contradicted) {
        ctx.font = '700 8px ui-monospace, Menlo, monospace';
        ctx.fillStyle = C.warn;
        ctx.fillText('TWR ✕', x - 14, y - 16);
      }
      if (this.selected?.kind === 'cell' && this.selected.id === cell.id) brackets(ctx, x, y, 18);
    }
    ctx.restore();
    // the landing and the barge
    if (f.landing) {
      const [lx, ly] = P(f.landing.x, f.landing.z);
      ctx.strokeStyle = C.ice;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lx, ly, 9 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the aircraft and its orbit
    if (f.orbit) {
      const [ox, oy] = P(f.orbit.x, f.orbit.z);
      ctx.strokeStyle = 'rgba(124,255,154,0.35)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ox, oy, f.orbit.r * v.s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const [px, py] = P(f.aircraft.x, f.aircraft.z);
    ctx.save();
    ctx.translate(px, py);
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
    // vehicles (dimmed on step 2, except the truck and the barge)
    ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
    for (const r of f.returns) {
      const [x, y] = P(r.x, r.z);
      ctx.save();
      if (exitStep && r.status !== 'truck' && r.status !== 'barge') ctx.globalAlpha = 0.3;
      const target = !exitStep && r.status !== 'out' && r.status !== 'wrong' && r.status !== 'barge' && !r.checks.every((c) => c.check === 'yes');
      const col = r.status === 'truck' ? C.amber : r.status === 'wrong' ? C.warn : r.status === 'out' ? 'rgba(232,243,234,0.35)' : r.status === 'barge' ? C.ice : r.status === 'fits' ? '#e8f3ea' : C.ph;
      const fl = this.flashes.get(`r:${r.id}`);
      const k = fl ? Math.max(0, 1 - (now - fl) / 900) : 0;
      if (k > 0) {
        ctx.strokeStyle = `rgba(242,169,59,${k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8 + (1 - k) * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (target && r.status !== 'truck') {
        ctx.strokeStyle = `rgba(232,243,234,${0.15 + 0.25 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 11 + pulse * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r.status === 'truck' ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (r.status === 'out' || r.status === 'wrong') {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 6);
        ctx.lineTo(x + 6, y + 6);
        ctx.moveTo(x + 6, y - 6);
        ctx.lineTo(x - 6, y + 6);
        ctx.stroke();
      }
      if (r.status === 'truck') {
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.fillText(r.status === 'barge' ? 'BARGE' : r.id, x + 8, y - 6);
      if (this.selected?.kind === 'return' && this.selected.id === r.id) brackets(ctx, x, y, 14);
      ctx.restore();
    }
    // the action in progress
    const p = f.pending;
    if (p) {
      const to = p.target.kind === 'return' ? f.returns.find((r) => r.id === (p.target as { id: ReturnId }).id) : p.target.kind === 'cell' ? f.cells.find((c) => c.id === (p.target as { id: string }).id) : null;
      const [fx, fy] = P(p.from.x, p.from.z);
      const k = Math.min(1, p.k);
      if (p.asset === 'listen' && to) {
        // tuning in on one vehicle: rings close in on it
        const [tx, ty] = P(to.x, to.z);
        for (let i = 0; i < 3; i++) {
          const kk = (k * 1.4 + i / 3) % 1;
          ctx.strokeStyle = `rgba(143,208,255,${0.85 * kk})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(tx, ty, 6 + (1 - kk) * 26, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (p.asset === 'sigint') {
        for (let i = 0; i < 3; i++) {
          const kk = (k * 1.6 + i / 3) % 1;
          ctx.strokeStyle = `rgba(143,208,255,${0.8 * (1 - kk)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(fx, fy, kk * Math.max(w, hgt) * 0.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (to) {
        const [tx, ty] = P(to.x, to.z);
        const ease = k * k * (3 - 2 * k);
        ctx.strokeStyle = p.asset === 'shadow' ? C.amber : 'rgba(143,208,255,0.8)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        if (p.asset === 'shadow' && f.landing) {
          const [lx, ly] = P(f.landing.x, f.landing.z);
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx + (lx - tx) * ease, ty + (ly - ty) * ease);
        } else ctx.lineTo(fx + (tx - fx) * ease, fy + (ty - fy) * ease);
        ctx.stroke();
        ctx.setLineDash([]);
        if (p.asset === 'drone' || p.asset === 'scouts') {
          // flown out to a route spot
          ctx.fillStyle = C.ice;
          ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
          ctx.fillText(p.asset === 'drone' ? '✈' : '⌂', fx + (tx - fx) * ease - 6, fy + (ty - fy) * ease + 5);
        } else if (p.asset !== 'shadow') {
          // a camera closing in: brackets tighten on the target
          ctx.strokeStyle = C.amber;
          ctx.lineWidth = 2;
          brackets(ctx, tx, ty, 34 - 20 * ease);
        }
      }
    }
  }

  // ------------------------------------------------------------------ EXECUTE: the score becomes the flight out
  showResult(res: ControlResult, ex: ExitProfile, best: number | null, isBest: boolean, hook: string, next: { n: string; label: string; title: string }): void {
    const R = this.el['mb-result'];
    const lines = res.lines.map((l, i) => `<li style="--i:${i}" class="${l.points < 0 ? 'neg' : l.points > 0 ? 'pos' : ''}"><small>${l.label}</small><span>${esc(l.detail)}</span><b data-to="${l.points}">0</b></li>`).join('');
    // the way out at a glance: what will bite, what is on offer
    const profile = ex.lines.filter((l) => SHOWN.includes(l.label)).map((l, i) => `<li style="--i:${i}" class="${l.tone}"><small>${l.label}</small><b>${esc(l.value)}</b></li>`).join('');
    R.innerHTML = `<div class="mr-card">
      <div class="mr-score"><small>RECON SCORE</small><ul class="mr-lines">${lines}</ul>
        <div class="mr-total"><b id="mr-total">0</b><span class="mr-rank r-${res.rank}">${res.rank}</span></div>
        <p class="mr-best">${isBest ? 'NEW PERSONAL BEST' : best !== null ? `PERSONAL BEST ${best.toLocaleString('en-US')}` : ''}</p></div>
      <div class="mr-exit"><small>YOUR WAY OUT</small><h2 class="t-${ex.tier}">${TIER_LABEL[ex.tier]}</h2><ul>${profile}</ul>
        <p class="mr-hook">${esc(hook)}</p>
        <button id="btn-fly-out" type="button" class="btn big fly"><small>${next.n} ${next.label}</small>${esc(next.title)} ▶</button></div>
    </div>`;
    R.className = 'mb-result on';
    const total = R.querySelector<HTMLElement>('#mr-total')!;
    const step = (ms: number, fn: () => void) => this.resultTimers.push(window.setTimeout(fn, ms));
    // the lines tick up one by one, then the total, then the rank lands, then the exit is read out
    R.querySelectorAll<HTMLElement>('.mr-lines li').forEach((li, i) =>
      step(250 + i * 260, () => {
        li.classList.add('in');
        countTo(li.querySelector('b')!, Number(li.querySelector('b')!.dataset.to), 380, true);
      }),
    );
    const t1 = 250 + res.lines.length * 260;
    step(t1, () => countTo(total, res.total, 700, false));
    step(t1 + 800, () => R.classList.add('ranked'));
    step(t1 + 1300, () => R.classList.add('exit'));
    step(t1 + 1300 + ex.lines.length * 170 + 300, () => R.classList.add('done'));
  }

  private skipResult(): void {
    const R = this.el['mb-result'];
    if (R.classList.contains('done') || R.classList.contains('hidden')) return;
    for (const t of this.resultTimers) window.clearTimeout(t);
    this.resultTimers = [];
    R.querySelectorAll<HTMLElement>('[data-to]').forEach((b) => {
      const v = Number(b.dataset.to);
      b.textContent = `${v > 0 ? '+' : ''}${v.toLocaleString('en-US')}`;
      b.closest('li')?.classList.add('in');
    });
    const tot = R.querySelector<HTMLElement>('#mr-total');
    const sum = [...R.querySelectorAll<HTMLElement>('[data-to]')].reduce((t, b) => t + Number(b.dataset.to), 0);
    if (tot) tot.textContent = Math.max(0, sum).toLocaleString('en-US');
    R.classList.add('ranked', 'exit', 'done');
  }

  /** The rank stamp has landed (Game plays the sound). */
  get resultStage(): 'none' | 'counting' | 'ranked' | 'done' {
    const R = this.el['mb-result'];
    if (R.classList.contains('hidden')) return 'none';
    return R.classList.contains('done') ? 'done' : R.classList.contains('ranked') ? 'ranked' : 'counting';
  }
}

/** The exit lines the result shows (the rest is in the plan panel). */
const SHOWN = ['WEATHER', 'TRAFFIC', 'FUEL', 'OPPORTUNITY'];

const WHAT: Record<CellTruth, string> = {
  clear: 'Nothing in the way. A clean stretch.',
  storm: 'A storm cell. Known, the route bends round it. Unknown, it sits on the rings.',
  cloud: 'A low cloud deck. Fly under it; the rings stay below.',
  radar: 'A radar site. Known, they pick you up late. Unknown, they are waiting from the start.',
  cache: 'A supply cache. Fly this route on a good exit for a photo pass.',
};

function countTo(el: HTMLElement, to: number, ms: number, signed: boolean): void {
  const t0 = performance.now();
  const fmt = (v: number) => `${signed && v > 0 ? '+' : ''}${Math.round(v).toLocaleString('en-US')}`;
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(to * k * (2 - k));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const l = Math.max(4, r * 0.45);
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    ctx.moveTo(x + sx * r, y + sy * (r - l));
    ctx.lineTo(x + sx * r, y + sy * r);
    ctx.lineTo(x + sx * (r - l), y + sy * r);
  }
  ctx.stroke();
}

/** A route spot's icon: what it is, or a question mark. */
function drawTruth(ctx: CanvasRenderingContext2D, t: CellTruth | null, x: number, y: number): void {
  ctx.lineWidth = 1.6;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (t) {
    case null:
      ctx.fillStyle = 'rgba(232,243,234,0.85)';
      ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
      ctx.fillText('?', x, y + 1);
      break;
    case 'clear':
      ctx.strokeStyle = C.ph;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x - 1, y + 4);
      ctx.lineTo(x + 5, y - 4);
      ctx.stroke();
      break;
    case 'storm':
      ctx.fillStyle = C.warn;
      ctx.beginPath();
      ctx.moveTo(x + 2, y - 7);
      ctx.lineTo(x - 4, y + 1);
      ctx.lineTo(x, y + 1);
      ctx.lineTo(x - 2, y + 7);
      ctx.lineTo(x + 4, y - 1);
      ctx.lineTo(x, y - 1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'cloud':
      ctx.fillStyle = '#c9d1d9';
      for (const [dx, dy, r] of [
        [-4, 1, 3.5],
        [0, -2, 4.5],
        [4, 1, 3.5],
      ]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'radar':
      ctx.strokeStyle = C.warn;
      for (const r of [3, 6]) {
        ctx.beginPath();
        ctx.arc(x, y + 3, r, -Math.PI * 0.85, -Math.PI * 0.15);
        ctx.stroke();
      }
      ctx.fillStyle = C.warn;
      ctx.beginPath();
      ctx.arc(x, y + 3, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cache':
      ctx.fillStyle = C.ice;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 2.8 : 6.5;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

