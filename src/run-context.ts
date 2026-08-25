import { homedir } from "node:os";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function stderrLogger(threshold: LogLevel | "silent"): Logger {
  if (threshold === "silent") return noopLogger;
  const emit = (level: LogLevel, message: string): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
    process.stderr.write(`[codepatrol] ${level}: ${message}\n`);
  };
  return {
    debug: (message) => emit("debug", message),
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    error: (message) => emit("error", message),
  };
}

export interface RunContext {
  readonly log: Logger;
  now(): Date;
  readStdin(): Promise<string>;
  env(name: string): string | undefined;
  envAll(): NodeJS.ProcessEnv;
  homeDir(): string;
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface SystemRunContextOptions {
  log?: Logger;
}

export function systemRunContext(options: SystemRunContextOptions = {}): RunContext {
  const log = options.log ?? noopLogger;
  return {
    log,
    now: () => new Date(),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString("utf8");
    },
    env: (name) => process.env[name],
    envAll: () => process.env,
    homeDir: () => homedir(),
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
  };
}
