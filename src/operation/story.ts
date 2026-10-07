/**
 * The case file: the bigger story, told one line per operation. Each
 * mission stands on its own; a clean one (target found, drop on target,
 * home safe) turns over the next page. No exposition: a single line on the
 * title card and in the debrief, and the player fills in the rest.
 */
import type { Career } from './career';

export const CASE_FILE: readonly string[] = [
  'A supply truck went dark in Sector 7.',
  'The tracker stopped at the river. A barge was waiting.',
  'The tower forecast was wrong. Every time. On purpose?',
  'The barge answers on a military band.',
  'Someone flew this route before you. Their log ends in Sector 7.',
];

/** The page the squadron is on (0-based). */
export function casePage(c: Pick<Career, 'caseFile'>): number {
  return Math.max(0, Math.min(CASE_FILE.length - 1, c.caseFile ?? 0));
}

/** The line the next operation opens on. */
export function currentLead(c: Pick<Career, 'caseFile'>): { page: number; total: number; text: string } {
  const page = casePage(c);
  return { page: page + 1, total: CASE_FILE.length, text: CASE_FILE[page] };
}

/** A clean operation turns the page: returns the new line, or null. */
export function advanceCaseFile(c: Career, clean: boolean): string | null {
  if (!clean || (c.caseFile ?? 0) >= CASE_FILE.length - 1) return null;
  c.caseFile = (c.caseFile ?? 0) + 1;
  return CASE_FILE[c.caseFile];
}
