/**
 * The case file, as operations. One page, one operation: the same world,
 * the same Mission Control puzzle, the same three phases, each page pushed
 * a little further. Everything that changes is data on the mission def:
 *
 *   page  EXECUTE                                 ESCAPE                 board
 *   01    drop · halts if confirmed                as the board built it  12 min
 *   02    drop on a rolling target                 tighter clocks         11 min · tower lies once
 *   03    drop · 40 s before it reaches cover      haze                   10 min · tower lies twice
 *   04    a 22 m skim to read its radio            contact from ring one  10 min · tower lies twice
 *   05    rolling, 35 s, 30 m, everything at once  the works               9 min · tower lies twice
 *
 * A new kind of mission (fire, rescue, demolition, delivery) is another
 * entry here with its own words, numbers and cast.
 */
import type { ControlDef } from '../control/board';
import { MISSION_01 } from './mission01';
import { CONTROL_01 } from './mission01Control';
import type { MissionDef } from './missionDef';

const control = (minutes: number, wrongForecasts: number): ControlDef => ({ ...CONTROL_01, minutes, wrongForecasts });

const risks = (window: string, extra: string) => [MISSION_01.risks[0], { icon: '📡', text: extra }, { icon: '⏱', text: `Mission Control · ${window} to plan the exit` }];

export const OPERATIONS: readonly MissionDef[] = [
  MISSION_01,
  {
    ...MISSION_01,
    id: 'op2',
    code: 'OPERATION 02',
    page: 1,
    title: 'THE RIVER RUN',
    briefing: { ...MISSION_01.briefing, headline: 'TAG THE TRUCK ON THE MOVE', window: '11 min at Mission Control before the front arrives' },
    risks: risks('11 min', 'It will not stop for you · tag it rolling'),
    story: {
      hook: 'The tracker stopped at the river. A barge was waiting.',
      verbs: { recon: 'FIND IT', execute: 'TAG IT', escape: 'GET OUT' },
      recon: { title: 'FIND THE TRUCK', line: 'Same roads. Fewer minutes. Trust nothing.' },
      execute: { title: 'TAG IT ROLLING', line: 'It will not stop. Hit it on the move.' },
      escape: { title: 'GET OUT', line: 'The barge is waiting. So are they.' },
      payload: 'TRACKER',
    },
    control: control(11, 1),
    execute: { ...MISSION_01.execute, halt: 'never', r: 40 },
    escape: { ...MISSION_01.escape, pace: 38 },
  },
  {
    ...MISSION_01,
    id: 'op3',
    code: 'OPERATION 03',
    page: 2,
    title: 'THE FORECAST',
    briefing: { ...MISSION_01.briefing, headline: 'TAG THE TRUCK BEFORE IT REACHES COVER', window: '10 min at Mission Control before the front arrives' },
    risks: risks('10 min', 'The tower lies twice · one pass, 40 seconds'),
    story: {
      hook: 'The tower forecast was wrong. Every time. On purpose?',
      verbs: { recon: 'FIND IT', execute: 'TAG IT', escape: 'GET OUT' },
      recon: { title: 'FIND THE TRUCK', line: 'The tower lies twice. Check the weather.' },
      execute: { title: 'TAG IT · 40 S', line: 'It reaches the trees in 40 seconds.' },
      escape: { title: 'GET OUT', line: 'The front was never where they said.' },
      payload: 'TRACKER',
    },
    control: control(10, 2),
    execute: { ...MISSION_01.execute, r: 40, window: 40 },
    escape: { ...MISSION_01.escape, pace: 36, visibility: 0.6 },
  },
  {
    ...MISSION_01,
    id: 'op4',
    code: 'OPERATION 04',
    page: 3,
    title: 'THE BAND',
    briefing: { ...MISSION_01.briefing, headline: 'READ THE TRUCK\'S RADIO FROM 22 METRES', window: '10 min at Mission Control before the front arrives' },
    risks: risks('10 min', 'Someone is listening · radar has you from ring one'),
    story: {
      hook: 'The barge answers on a military band.',
      verbs: { recon: 'FIND IT', execute: 'SKIM IT', escape: 'GET OUT' },
      recon: { title: 'FIND THE TRUCK', line: 'Someone is listening. Go in low.' },
      execute: { title: 'SKIM IT', line: 'Under 30 m. Read its radio on the pass.' },
      escape: { title: 'GET OUT', line: 'They heard you listening. Rings close fast.' },
      payload: 'RECEIVER',
    },
    control: control(10, 2),
    execute: { ...MISSION_01.execute, agl: 22, r: 34, drops: false, cue: 'UNDER 30 m', done: { kicker: 'SIGNAL CAPTURED', text: 'MILITARY BAND · LOGGED' }, missed: { kicker: 'TOO HIGH', text: 'NOTHING HEARD' } },
    escape: { ...MISSION_01.escape, pace: 36, contact: true },
  },
  {
    ...MISSION_01,
    id: 'op5',
    code: 'OPERATION 05',
    page: 4,
    title: 'THE LAST PAGE',
    briefing: { ...MISSION_01.briefing, headline: 'FINISH THE RUN THEY NEVER CAME BACK FROM', window: '9 min at Mission Control before the front arrives' },
    risks: risks('9 min', 'Rolling target · 35 seconds · radar from ring one'),
    story: {
      hook: 'Someone flew this route before you. Their log ends in Sector 7.',
      verbs: { recon: 'FIND IT', execute: 'TAG IT', escape: 'GET OUT' },
      recon: { title: 'FIND THE TRUCK', line: 'Nine minutes. They know the drill now.' },
      execute: { title: 'FINISH IT', line: 'Their run ended here. Yours will not.' },
      escape: { title: 'GET OUT', line: 'Everything they have. Fly it clean.' },
      payload: 'TRACKER',
    },
    control: control(9, 2),
    execute: { ...MISSION_01.execute, halt: 'never', agl: 30, r: 36, window: 35 },
    escape: { ...MISSION_01.escape, pace: 33, contact: true, visibility: 0.5 },
  },
];

/** The operation for a page of the case file. */
export function operationFor(page: number): MissionDef {
  return OPERATIONS[Math.max(0, Math.min(OPERATIONS.length - 1, page))];
}
