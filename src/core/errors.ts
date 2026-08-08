export type ErrorCode =
  | "USAGE"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "INVALID_INPUT"
  | "STATE_CORRUPT"
  | "CONFLICT"
  | "RESULT_CONFLICT"
  | "CYCLE"
  | "BLOCKED"
  | "GITHUB";

const EXIT_CODES: Record<ErrorCode, number> = {
  USAGE: 2,
  INVALID_INPUT: 2,
  NOT_FOUND: 1,
  INVALID_STATE: 1,
  STATE_CORRUPT: 1,
  CONFLICT: 1,
  RESULT_CONFLICT: 1,
  CYCLE: 1,
  BLOCKED: 1,
  GITHUB: 1,
};

export class CodepatrolError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CodepatrolError";
    this.code = code;
    this.exitCode = EXIT_CODES[code];
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new CodepatrolError(code, message);
}
