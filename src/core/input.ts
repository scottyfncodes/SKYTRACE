/**
 * Unified input: keyboard for desktop, a virtual stick + buttons for touch.
 * Produces normalised axes every frame and edge-triggered actions.
 */
import { applyVerticalMode, type VerticalMode } from './settings';

export type Action = 'scan' | 'mark' | 'drop' | 'map' | 'pause' | 'rtb';

export interface InputState {
  roll: number;
  pitch: number;
  throttleDelta: number;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private throttleTouch: { id: number; startY: number; startValue: number } | null = null;
  readonly isTouch: boolean;
  /** Player preference: sign applied to the vertical flight axis (stick and keyboard). */
  verticalMode: VerticalMode = 'standard';
  /** Touch throttle sets this directly (0..1) instead of a delta. */
  touchThrottle: number | null = null;
  private throttleRef = 0.55;
  readonly stickEl: HTMLElement;
  readonly stickKnob: HTMLElement;
  private readonly actionHandlers = new Map<Action, () => void>();

  constructor(stickZone: HTMLElement, stickKnob: HTMLElement, throttleEl: HTMLElement | null) {
    this.isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    this.stickEl = stickZone;
    this.stickKnob = stickKnob;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());

    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickVec = { x: 0, y: 0 };
      stickZone.setPointerCapture(e.pointerId);
      stickZone.classList.add('active');
      stickKnob.style.left = `${e.clientX - stickZone.getBoundingClientRect().left}px`;
      stickKnob.style.top = `${e.clientY - stickZone.getBoundingClientRect().top}px`;
      e.preventDefault();
    });
    const moveStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      const R = 54;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      this.stickVec = { x: dx / R, y: dy / R };
      stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      e.preventDefault();
    };
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      stickKnob.style.transform = 'translate(-50%, -50%)';
      stickZone.classList.remove('active');
    };
    stickZone.addEventListener('pointermove', moveStick);
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);

    if (throttleEl) {
      throttleEl.addEventListener('pointerdown', (e) => {
        this.throttleTouch = { id: e.pointerId, startY: e.clientY, startValue: this.throttleRef };
        throttleEl.setPointerCapture(e.pointerId);
        this.applyThrottleFromPointer(e, throttleEl);
        e.preventDefault();
      });
      throttleEl.addEventListener('pointermove', (e) => {
        if (this.throttleTouch?.id !== e.pointerId) return;
        this.applyThrottleFromPointer(e, throttleEl);
        e.preventDefault();
      });
      const end = (e: PointerEvent) => {
        if (this.throttleTouch?.id === e.pointerId) this.throttleTouch = null;
      };
      throttleEl.addEventListener('pointerup', end);
      throttleEl.addEventListener('pointercancel', end);
    }
  }

  private applyThrottleFromPointer(e: PointerEvent, el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const v = 1 - (e.clientY - r.top) / r.height;
    this.touchThrottle = Math.max(0, Math.min(1, v));
    this.throttleRef = this.touchThrottle;
  }

  /** Keep the touch throttle slider in sync with the simulated throttle. */
  syncThrottle(v: number): void {
    this.throttleRef = v;
  }

  /**
   * Instant actions fire on pointerdown for responsiveness. Actions that open
   * another screen fire on click, otherwise the browser's synthesised click
   * after a touch lands on whatever the new screen put under the finger.
   */
  bindButton(el: HTMLElement, action: Action, on: 'pointerdown' | 'click' = 'pointerdown'): void {
    const fire = (e: Event) => {
      e.preventDefault();
      this.trigger(action);
    };
    if (on === 'pointerdown') {
      el.addEventListener('pointerdown', fire);
      el.addEventListener('click', (e) => e.preventDefault());
    } else {
      el.addEventListener('click', fire);
    }
  }

  onAction(action: Action, fn: () => void): void {
    this.actionHandlers.set(action, fn);
  }

  trigger(action: Action): void {
    this.pressed.add(action);
    const h = this.actionHandlers.get(action);
    if (h) h();
  }

  consume(action: Action): boolean {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (down && !e.repeat) {
      const map: Record<string, Action> = { ' ': 'scan', m: 'mark', e: 'drop', Tab: 'map', i: 'map', Escape: 'pause', p: 'pause', r: 'rtb' };
      const a = map[k];
      if (a) {
        this.trigger(a);
        e.preventDefault();
      }
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  read(): InputState {
    const k = this.keys;
    let roll = 0;
    let pitch = 0;
    let throttleDelta = 0;
    if (k.has('ArrowLeft') || k.has('a')) roll -= 1;
    if (k.has('ArrowRight') || k.has('d')) roll += 1;
    if (k.has('ArrowUp') || k.has('w')) pitch += 1;
    if (k.has('ArrowDown') || k.has('s')) pitch -= 1;
    if (k.has('Shift') || k.has('q')) throttleDelta += 1;
    if (k.has('Control') || k.has('z')) throttleDelta -= 1;
    if (this.stickId !== null) {
      roll = this.stickVec.x;
      pitch = -this.stickVec.y; // stick up = climb
      // small dead zone
      if (Math.abs(roll) < 0.08) roll = 0;
      if (Math.abs(pitch) < 0.08) pitch = 0;
    }
    return applyVerticalMode({ roll, pitch, throttleDelta }, this.verticalMode);
  }
}
