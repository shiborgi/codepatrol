/**
 * The published API. CodePatrol is a CLI: what a consumer legitimately needs is
 * to run it, to recognise its errors, to validate an Initiative document before
 * handing it over, and to read the JSON it emits. Everything else is internal —
 * exporting it would freeze implementation detail into a contract.
 */

export type { SpecDocument } from "./application/spec-service.js";
export { DOCUMENT_TYPE, parseDocument } from "./application/spec-service.js";
export type { CliIO, RunCliOptions } from "./cli/run-cli.js";
export { runCli } from "./cli/run-cli.js";
export type { ErrorCode } from "./core/errors.js";
export { CodepatrolError } from "./core/errors.js";
export type { TodoItem } from "./core/execution.js";
export {
  initiativeIdOf,
  isInitiativeId,
  isWaveId,
  isWorkId,
  parseInitiativeId,
  parseWaveId,
  parseWorkId,
  waveIdOf,
} from "./core/identifiers.js";
export type { ImprovementReport } from "./core/improvement.js";
export type { WorkDefinition } from "./core/initiative.js";
export type { AttemptResult, Stage, Work } from "./core/work.js";
