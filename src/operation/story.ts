/**
 * The case file: the bigger story, told one line per operation. Each line
 * is a page, and each page is an operation of its own (`mission/operations.ts`):
 * the same RECON → EXECUTE → ESCAPE rhythm, pushed a little further every
 * time. A clean operation on the newest page (target found, pass made, home
 * safe) turns the next one. Pages already turned stay open to replay for a
 * better board, a cleaner escape, a better grade. No exposition: a single
 * line on the title card and in the debrief, and the player fills in the rest.
 */
import type { Career } from './career';

export const CASE_FILE: readonly string[] = [
  'A supply truck went dark in Sector 7.',
  'The tracker stopped at the river. A barge was waiting.',
  'The tower forecast was wrong. Every time. On purpose?',
  'The barge answers on a military band.',
  'Someone flew this route before you. Their log ends in Sector 7.',
];

/** The last page, turned: what the log said. */
export const CASE_CLOSED = "Their log ends: 'The tower sent me in.' It is signed with your callsign.";

/** The newest page the squadron has reached (0-based). */
export function casePage(c: Pick<Career, 'caseFile'>): number {
  return Math.max(0, Math.min(CASE_FILE.length - 1, c.caseFile ?? 0));
}

/** How many pages are open to fly (the newest, and every one before it). */
export function pagesOpen(c: Pick<Career, 'caseFile'>): number {
  return casePage(c) + 1;
}

/** The line an operation opens on: the page being flown (the newest unless chosen). */
export function currentLead(c: Pick<Career, 'caseFile' | 'caseClosed'>, page = casePage(c)): { page: number; total: number; text: string; closed: boolean } {
  const p = Math.max(0, Math.min(CASE_FILE.length - 1, page));
  return { page: p + 1, total: CASE_FILE.length, text: CASE_FILE[p], closed: !!c.caseClosed };
}

/**
 * A clean operation on the newest page turns it: returns the new line (or
 * the closing line of the log on the last page), null otherwise. Replaying
 * an earlier page never moves the story.
 */
export function advanceCaseFile(c: Career, clean: boolean, page = casePage(c)): string | null {
  if (!clean || page !== casePage(c)) return null;
  if (page >= CASE_FILE.length - 1) {
    if (c.caseClosed) return null;
    c.caseClosed = true;
    return CASE_CLOSED;
  }
  c.caseFile = page + 1;
  return CASE_FILE[c.caseFile];
}
