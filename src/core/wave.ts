import { fail } from "./errors.js";
import { initiativeIdOf, parseWaveId } from "./identifiers.js";
import { rejectUnknown, requireRecord, requireText } from "./initiative.js";

const WAVE_TYPE = "codepatrol-wave";

const WAVE_VERDICTS = ["keep", "adjust", "rollback", "inconclusive"] as const;

export type WaveVerdictOutcome = (typeof WAVE_VERDICTS)[number];

export interface WaveVerdict {
  outcome: WaveVerdictOutcome;
  authority: string;
  summary: string;
  finalizedAt: string;
}

export interface Wave {
  schemaVersion: 1;
  type: typeof WAVE_TYPE;
  id: string;
  initiative: string;
  title: string;
  intent: string;
  verdict: WaveVerdict | null;
  createdAt: string;
  updatedAt: string;
}

export function createWave(input: { id: string; title: string; intent: string; now: string }): Wave {
  const id = parseWaveId(input.id);
  return {
    schemaVersion: 1,
    type: WAVE_TYPE,
    id,
    initiative: initiativeIdOf(id),
    title: requireText(input.title, "title"),
    intent: requireText(input.intent, "intent"),
    verdict: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function parseWave(value: unknown, context = "wave"): Wave {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    ["schemaVersion", "type", "id", "initiative", "title", "intent", "verdict", "createdAt", "updatedAt"],
    context,
  );
  if (record.schemaVersion !== 1) {
    fail("STATE_CORRUPT", `${context}: unsupported schemaVersion ${JSON.stringify(record.schemaVersion)}`);
  }
  if (record.type !== WAVE_TYPE) fail("STATE_CORRUPT", `${context}: unsupported type`);
  const id = parseWaveId(record.id, `${context}.id`);
  const initiative = requireText(record.initiative, `${context}.initiative`);
  if (initiative !== initiativeIdOf(id)) {
    fail("STATE_CORRUPT", `${context}: initiative ${initiative} does not match id ${id}`);
  }
  return {
    schemaVersion: 1,
    type: WAVE_TYPE,
    id,
    initiative,
    title: requireText(record.title, `${context}.title`),
    intent: requireText(record.intent, `${context}.intent`),
    verdict:
      record.verdict === undefined || record.verdict === null
        ? null
        : parseVerdict(record.verdict, `${context}.verdict`),
    createdAt: requireText(record.createdAt, `${context}.createdAt`),
    updatedAt: requireText(record.updatedAt, `${context}.updatedAt`),
  };
}

export function parseVerdict(value: unknown, context = "verdict"): WaveVerdict {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["outcome", "authority", "summary", "finalizedAt"], context);
  const outcome = record.outcome;
  if (typeof outcome !== "string" || !(WAVE_VERDICTS as readonly string[]).includes(outcome)) {
    fail(
      "INVALID_INPUT",
      `${context}.outcome must be one of ${WAVE_VERDICTS.join("|")}, got ${JSON.stringify(outcome)}`,
    );
  }
  return {
    outcome: outcome as WaveVerdictOutcome,
    authority: requireText(record.authority, `${context}.authority`),
    summary: requireText(record.summary, `${context}.summary`),
    finalizedAt: requireText(record.finalizedAt, `${context}.finalizedAt`),
  };
}
