import { fail } from "./errors.js";
import type { Wave, WaveVerdict } from "./wave.js";
import type { Work } from "./work.js";

export interface WaveStatus {
  id: string;
  initiative: string;
  title: string;
  works: string[];
  complete: boolean;
  verdict: WaveVerdict | null;
}

export function worksOfWave(waveId: string, works: Iterable<Work>): Work[] {
  return [...works].filter((work) => work.wave === waveId).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Completion is derived, never stored: a Wave is complete when every one of its
 * Works is terminal. A Wave with no Works is not complete.
 */
export function isWaveComplete(waveId: string, works: Iterable<Work>): boolean {
  const owned = worksOfWave(waveId, works);
  return owned.length > 0 && owned.every((work) => work.completion !== null);
}

export function waveStatusOf(wave: Wave, works: Iterable<Work>): WaveStatus {
  const owned = worksOfWave(wave.id, works);
  return {
    id: wave.id,
    initiative: wave.initiative,
    title: wave.title,
    works: owned.map((work) => work.id),
    complete: owned.length > 0 && owned.every((work) => work.completion !== null),
    verdict: wave.verdict,
  };
}

/**
 * A verdict is an explicit human judgment. It is never inferred from the
 * outcomes of the Wave's Works: a Wave with two accepted Works and one
 * rolled-back Work may legitimately be `adjust`.
 */
export function recordWaveVerdict(wave: Wave, works: Iterable<Work>, verdict: WaveVerdict, now: string): Wave {
  if (!isWaveComplete(wave.id, works)) {
    fail("INVALID_STATE", `${wave.id} is not complete; every work must be terminal before a verdict is recorded`);
  }
  if (wave.verdict !== null) {
    if (wave.verdict.outcome !== verdict.outcome) {
      fail("RESULT_CONFLICT", `${wave.id} already has verdict ${wave.verdict.outcome}`);
    }
    return wave;
  }
  return { ...wave, verdict, updatedAt: now };
}
