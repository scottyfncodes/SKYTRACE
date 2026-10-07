/**
 * The mission report: how well the operation was executed, what it earned,
 * and what the recon established. Pure, so the numbers are tested.
 */
import { evidenceGrade, intelligence, secondaries, type MissionState, type Secondary } from '../mission/mission';
import type { MissionDef } from '../mission/missionDef';
import { bonusTaken, missedCount, ringTally, totalExposure } from './gates';
import { damageGrade, type OperationState } from './operation';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ReportRow {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}

/** One line per phase: did it go well, in one word. */
export interface StageResult {
  id: 'recon' | 'execute' | 'escape';
  label: string;
  ok: boolean;
  word: string;
}

/**
 * The debrief scorecard, one line per phase. RECON is the flight in and the
 * board (spotted on the way in, or a poor board, and it is not a tick);
 * EXECUTE is the drop; ESCAPE is the flight home.
 */
export function stageResults(m: MissionState, op: OperationState, def: MissionDef, control?: ControlSummary): StageResult[] {
  void def;
  const R = op.routes;
  const retRough = totalExposure(op.ret, R.return, 'storm') + totalExposure(op.ret, R.return, 'ceiling');
  const out = ringTally(op.outbound, R.outbound);
  const ret = ringTally(op.ret, R.return);
  const rings = (t: { hit: number; total: number }) => `${t.hit}/${t.total} RINGS`;
  const landed = op.outcome === 'landed';
  const evidence = evidenceGrade(m.photos.truck);
  const goodBoard = !control || control.rank === 'ACE' || control.rank === 'SOLID';
  const reconWord = !m.primaryComplete ? 'NOT FOUND' : op.outbound.detected ? 'SPOTTED' : out.total - out.hit > 1 ? rings(out) : control ? control.rank : evidence;
  const x = op.execResult;
  const reached = op.stage === 'debrief' && (op.outcome === 'landed' || x !== null);
  return [
    { id: 'recon', label: 'RECON', ok: m.primaryComplete && !op.outbound.detected && out.total - out.hit <= 1 && goodBoard, word: reconWord },
    { id: 'execute', label: 'EXECUTE', ok: x === 'tagged', word: x === 'tagged' ? 'TAGGED' : x === 'missed' ? 'MISSED' : x === 'skipped' ? 'NO TARGET' : reached ? 'NOT FLOWN' : '—' },
    { id: 'escape', label: 'ESCAPE', ok: landed && retRough <= 3 && ret.total - ret.hit <= 1, word: !landed ? 'LOST' : ret.hit < ret.total ? rings(ret) : retRough > 3 ? 'ROUGH' : 'CLEAN' },
  ];
}

/** What Mission Control scored (the board between the flights). */
export interface ControlSummary {
  total: number;
  rank: string;
}

/** Points for a clean drop (the tracker on the target). */
export const DROP_POINTS = 150;

/** Points per opportunity ring flown on the way home. */
export const OPPORTUNITY_POINTS = 120;

export interface Report {
  stages: StageResult[];
  headline: string;
  success: boolean;
  grade: Grade;
  score: number;
  rows: ReportRow[];
  secondaries: Secondary[];
  intelligence: string[];
  credits: number;
  xp: number;
}

export function disciplineScore(op: OperationState, def: MissionDef): number {
  void def;
  const R = op.routes;
  const missed = missedCount(op.outbound, R.outbound) + missedCount(op.ret, R.return);
  const storm = totalExposure(op.outbound, R.outbound, 'storm') + totalExposure(op.ret, R.return, 'storm');
  const cloud = totalExposure(op.ret, R.return, 'ceiling');
  const pts = 100 - 6 * missed - (op.outbound.detected ? 20 : 0) - 2 * storm - 1.5 * cloud;
  return Math.max(0, Math.min(100, Math.round(pts)));
}

export function disciplineGrade(p: number): string {
  if (p >= 90) return 'EXCELLENT';
  if (p >= 70) return 'GOOD';
  if (p >= 45) return 'FAIR';
  return 'POOR';
}

export function gradeFor(score: number, landed: boolean, primary: boolean): Grade {
  if (!landed) return 'F';
  if (!primary) return score >= 500 ? 'C' : 'D';
  if (score >= 1150) return 'S';
  if (score >= 950) return 'A';
  if (score >= 750) return 'B';
  if (score >= 500) return 'C';
  return 'D';
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function buildReport(m: MissionState, op: OperationState, def: MissionDef, fuelFraction: number, timeOnStation: number, control?: ControlSummary): Report {
  const landed = op.outcome === 'landed';
  const sec = secondaries(m, op.outbound.detected);
  const secDone = sec.filter((s) => s.done).length;
  const idPct = m.targetIdentified ? Math.max(25, 100 - 25 * m.falsePositives) : 0;
  const discipline = disciplineScore(op, def);
  const fuel = Math.max(0, Math.min(1, fuelFraction));
  const taken = bonusTaken(op.ret, op.routes.return).length;
  // Mission Control counts toward the operation: a twenty-fifth of its score, plus every opportunity it opened and you flew
  let score = (m.primaryComplete ? 400 : 0) + 150 * secDone + 200 * m.photos.truck + 2 * discipline + 100 * fuel - 75 * m.falsePositives - 150 * op.damage + (control ? control.total / 25 : 0) + OPPORTUNITY_POINTS * taken + (op.execResult === 'tagged' ? DROP_POINTS : 0);
  score = Math.max(0, Math.round(landed ? score : score * 0.25));
  const grade = gradeFor(score, landed, m.primaryComplete);
  const success = landed && m.primaryComplete;
  const headline = success ? 'MISSION COMPLETE' : !landed ? (op.outcome === 'fuel' ? 'AIRCRAFT LOST · FUEL EXHAUSTED' : op.outcome === 'destroyed' ? 'AIRCRAFT LOST · STORM DAMAGE' : 'OPERATION ABORTED') : 'RETURNED · PRIMARY INCOMPLETE';
  const truck = evidenceGrade(m.photos.truck);
  const rows: ReportRow[] = [
    { label: 'Primary objective', value: m.primaryComplete ? 'COMPLETE' : 'INCOMPLETE', tone: m.primaryComplete ? 'good' : 'bad' },
    ...(control ? [{ label: 'Mission Control', value: `${control.total.toLocaleString('en-US')} · ${control.rank}`, tone: control.rank === 'ACE' ? 'good' : control.rank === 'SCRAMBLE' ? 'bad' : undefined } as ReportRow] : []),
    ...(taken ? [{ label: 'Opportunities taken', value: String(taken), tone: 'good' } as ReportRow] : []),
    { label: 'Drop', value: op.execResult === 'tagged' ? 'ON TARGET' : op.execResult === 'missed' ? 'MISSED' : 'NOT FLOWN', tone: op.execResult === 'tagged' ? 'good' : 'bad' },
    { label: 'Secondary objectives', value: `${secDone}/${sec.length}`, tone: secDone === sec.length ? 'good' : undefined },
    { label: 'Target identification', value: `${idPct}%`, tone: idPct === 100 ? 'good' : idPct ? undefined : 'bad' },
    { label: 'Evidence quality', value: truck, tone: truck === 'EXCELLENT' || truck === 'GOOD' ? 'good' : truck === 'NONE' || truck === 'POOR' ? 'bad' : undefined },
    { label: 'Flight discipline', value: disciplineGrade(discipline), tone: discipline >= 70 ? 'good' : discipline < 45 ? 'bad' : undefined },
    { label: 'Fuel remaining', value: `${Math.round(fuel * 100)}%`, tone: fuel < 0.1 ? 'bad' : undefined },
    { label: 'Airframe damage', value: op.outcome === 'destroyed' ? 'DESTROYED' : damageGrade(op.damage), tone: op.damage < 0.02 ? 'good' : op.damage >= 0.25 ? 'bad' : undefined },
    { label: 'Flight time', value: `${mmss(op.time)} · ${mmss(timeOnStation)} on station` },
  ];
  return { stages: stageResults(m, op, def, control), headline, success, grade, score, rows, secondaries: sec, intelligence: intelligence(m), credits: Math.round(score / 5), xp: Math.round(score / 4) };
}
