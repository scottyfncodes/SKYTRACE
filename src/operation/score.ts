/**
 * The mission report: how well the operation was executed, what it earned,
 * and what the recon established. Pure, so the numbers are tested.
 */
import { evidenceGrade, intelligence, secondaries, type MissionState, type Secondary } from '../mission/mission';
import type { MissionDef } from '../mission/missionDef';
import { missedCount, totalExposure } from './gates';
import { damageGrade, type OperationState } from './operation';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ReportRow {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}

export interface Report {
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
  const missed = missedCount(op.outbound) + missedCount(op.ret);
  const storm = totalExposure(op.outbound, def.outbound, 'storm') + totalExposure(op.ret, def.return, 'storm');
  const cloud = totalExposure(op.ret, def.return, 'ceiling');
  const pts = 100 - 15 * missed - (op.outbound.detected ? 20 : 0) - 2 * storm - 1.5 * cloud;
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

export function buildReport(m: MissionState, op: OperationState, def: MissionDef, fuelFraction: number, timeOnStation: number): Report {
  const landed = op.outcome === 'landed';
  const sec = secondaries(m, op.outbound.detected);
  const secDone = sec.filter((s) => s.done).length;
  const idPct = m.targetIdentified ? Math.max(25, 100 - 25 * m.falsePositives) : 0;
  const discipline = disciplineScore(op, def);
  const fuel = Math.max(0, Math.min(1, fuelFraction));
  let score = (m.primaryComplete ? 400 : 0) + 150 * secDone + 200 * m.photos.truck + 2 * discipline + 100 * fuel - 75 * m.falsePositives - 150 * op.damage;
  score = Math.max(0, Math.round(landed ? score : score * 0.25));
  const grade = gradeFor(score, landed, m.primaryComplete);
  const success = landed && m.primaryComplete;
  const headline = success ? 'MISSION COMPLETE' : !landed ? (op.outcome === 'fuel' ? 'AIRCRAFT LOST · FUEL EXHAUSTED' : 'OPERATION ABORTED') : 'RETURNED · PRIMARY INCOMPLETE';
  const truck = evidenceGrade(m.photos.truck);
  const rows: ReportRow[] = [
    { label: 'Primary objective', value: m.primaryComplete ? 'COMPLETE' : 'INCOMPLETE', tone: m.primaryComplete ? 'good' : 'bad' },
    { label: 'Secondary objectives', value: `${secDone}/${sec.length}`, tone: secDone === sec.length ? 'good' : undefined },
    { label: 'Target identification', value: `${idPct}%`, tone: idPct === 100 ? 'good' : idPct ? undefined : 'bad' },
    { label: 'Evidence quality', value: truck, tone: truck === 'EXCELLENT' || truck === 'GOOD' ? 'good' : truck === 'NONE' || truck === 'POOR' ? 'bad' : undefined },
    { label: 'Flight discipline', value: disciplineGrade(discipline), tone: discipline >= 70 ? 'good' : discipline < 45 ? 'bad' : undefined },
    { label: 'Fuel remaining', value: `${Math.round(fuel * 100)}%`, tone: fuel < 0.1 ? 'bad' : undefined },
    { label: 'Equipment damage', value: damageGrade(op.damage), tone: op.damage < 0.02 ? 'good' : op.damage >= 0.25 ? 'bad' : undefined },
    { label: 'Flight time', value: `${mmss(op.time)} · ${mmss(timeOnStation)} on station` },
  ];
  return { headline, success, grade, score, rows, secondaries: sec, intelligence: intelligence(m), credits: Math.round(score / 5), xp: Math.round(score / 4) };
}
