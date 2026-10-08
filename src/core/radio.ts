/**
 * Radio chatter: short lines from dispatch, the crew and the people on the
 * ground. Shown as a subtitle (always) and spoken by the device's voice (if
 * it has one and the player has not turned it off). One line at a time.
 */
export type Speaker = 'DISPATCH' | 'CREW' | 'GROUND' | 'HOSPITAL';

export interface RadioLine {
  who: Speaker;
  text: string;
}

export class Radio {
  private queue: RadioLine[] = [];
  private current: { line: RadioLine; t: number } | null = null;
  voice = true;
  constructor(
    private show: (line: RadioLine | null) => void,
    private squelch: () => void,
  ) {}

  say(who: Speaker, text: string, urgent = false): void {
    if (!text) return;
    const line = { who, text };
    if (urgent) {
      this.queue = [line];
      this.current = null;
      this.cancelVoice();
    } else this.queue.push(line);
  }

  clear(): void {
    this.queue = [];
    this.current = null;
    this.cancelVoice();
    this.show(null);
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  update(dt: number): void {
    if (this.current) {
      this.current.t -= dt;
      if (this.current.t > 0) return;
      this.current = null;
      this.show(null);
    }
    const next = this.queue.shift();
    if (!next) return;
    const words = next.text.split(/\s+/).length;
    this.current = { line: next, t: Math.max(2.6, 0.9 + words * 0.36) };
    this.squelch();
    this.show(next);
    this.speak(next);
  }

  private speak(l: RadioLine): void {
    if (!this.voice || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(l.text);
      u.rate = 1.08;
      u.pitch = l.who === 'GROUND' ? 1.15 : l.who === 'CREW' ? 1.05 : 0.95;
      u.volume = 0.85;
      speechSynthesis.speak(u);
    } catch {
      /* no voice on this device */
    }
  }

  private cancelVoice(): void {
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}
