import { fail } from "./errors.js";

const INITIATIVE_ID = /^INIT-([1-9]\d*)$/;
const WAVE_ID = /^WAVE-([1-9]\d*)\.([1-9]\d*)$/;
const WORK_ID = /^WORK-([1-9]\d*)\.([1-9]\d*)\.([1-9]\d*)$/;

export function isInitiativeId(value: string): boolean {
  return INITIATIVE_ID.test(value);
}

export function isWorkId(value: string): boolean {
  return WORK_ID.test(value);
}

export function isWaveId(value: string): boolean {
  return WAVE_ID.test(value);
}

export function parseInitiativeId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !INITIATIVE_ID.test(value)) {
    fail("INVALID_INPUT", `${field} must match INIT-<number>, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseWorkId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !WORK_ID.test(value)) {
    fail("INVALID_INPUT", `${field} must match WORK-<initiative>.<wave>.<position>, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseWaveId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !WAVE_ID.test(value)) {
    fail("INVALID_INPUT", `${field} must match WAVE-<initiative>.<wave>, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function initiativeIdOf(id: string): string {
  const wave = WAVE_ID.exec(id);
  if (wave) return `INIT-${wave[1]}`;
  const work = WORK_ID.exec(id);
  if (work) return `INIT-${work[1]}`;
  fail("INVALID_INPUT", `cannot derive initiative from ${JSON.stringify(id)}`);
}

export function waveIdOf(workId: string): string {
  const match = WORK_ID.exec(workId);
  if (!match) fail("INVALID_INPUT", `cannot derive wave from ${JSON.stringify(workId)}`);
  return `WAVE-${match[1]}.${match[2]}`;
}

export function waveNumberOf(waveId: string): number {
  const match = WAVE_ID.exec(waveId);
  if (!match) fail("INVALID_INPUT", `invalid wave id ${JSON.stringify(waveId)}`);
  return Number(match[2]);
}

export function workPositionOf(workId: string): number {
  const match = WORK_ID.exec(workId);
  if (!match) fail("INVALID_INPUT", `invalid work id ${JSON.stringify(workId)}`);
  return Number(match[3]);
}
