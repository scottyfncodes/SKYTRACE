/**
 * The three phases every SKYTRACE mission is played in, whatever the story:
 *
 *   01 RECON    "What is happening?"        find it
 *   02 EXECUTE  "What do I do about it?"    do the thing
 *   03 ESCAPE   "What went wrong? Get out." fly home through the reaction
 *
 * The operation's stages map onto them (outbound rings and Mission Control
 * are recon, the drop run is execute, the timed rings home are escape), so
 * the HUD, the cards and the debrief all speak the same three words. Pure.
 */
import type { Stage } from './operation';

export type Phase = 'recon' | 'execute' | 'escape';

export const PHASES: readonly { id: Phase; n: string; label: string }[] = [
  { id: 'recon', n: '01', label: 'RECON' },
  { id: 'execute', n: '02', label: 'EXECUTE' },
  { id: 'escape', n: '03', label: 'ESCAPE' },
];

/** What the player is told about each phase: a title and one short line. */
export interface PhaseCopy {
  title: string;
  line: string;
}

/** A mission's story, told in its three phases. */
export interface MissionStory {
  /** One line: something is happening. */
  hook: string;
  /** One or two words per phase for the title card strip ("FIND IT"). */
  verbs: Record<Phase, string>;
  recon: PhaseCopy;
  execute: PhaseCopy;
  escape: PhaseCopy;
  /** What the execute phase delivers ("TRACKER"). */
  payload: string;
}

export function phaseOf(stage: Stage): Phase | null {
  if (stage === 'outbound' || stage === 'recon') return 'recon';
  if (stage === 'execute') return 'execute';
  if (stage === 'return') return 'escape';
  return null;
}

export type ExecResult = 'tagged' | 'missed' | 'skipped' | null;
export type PhaseMark = 'done' | 'failed' | 'now' | 'todo';

/** The three dots: where the player is, and how the phases behind them went. */
export function phaseMarks(stage: Stage, exec: ExecResult): PhaseMark[] {
  const now = phaseOf(stage);
  const at = now ? PHASES.findIndex((p) => p.id === now) : stage === 'debrief' ? 3 : -1;
  return PHASES.map((p, i) => {
    if (i === at) return 'now';
    if (i > at) return 'todo';
    if (p.id === 'execute' && (exec === 'missed' || exec === 'skipped')) return 'failed';
    return 'done';
  });
}

export function phaseInfo(p: Phase): { n: string; label: string } {
  const d = PHASES.find((x) => x.id === p)!;
  return { n: d.n, label: d.label };
}
