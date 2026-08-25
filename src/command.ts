import { spawnSync } from "node:child_process";

export type CommandResult =
  | {
      status: "succeeded";
      exitCode: 0;
      stdout: string;
      stderr: string;
      error?: undefined;
    }
  | {
      status: "failed";
      exitCode: number;
      stdout: string;
      stderr: string;
      error?: undefined;
    }
  | {
      status: "unavailable";
      exitCode: 127;
      stdout: string;
      stderr: string;
      error: Error;
    };

export function stableEnv(envAll: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...envAll,
    LC_ALL: "C",
    LANG: "C",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") && !["GIT_TERMINAL_PROMPT"].includes(key)) {
      delete env[key];
    }
  }
  return env;
}

export function execute(
  command: string,
  args: string[],
  cwd: string,
  input?: string,
  timeout = 120_000,
  env?: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    env,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error) {
    return {
      status: "unavailable",
      exitCode: 127,
      stdout,
      stderr,
      error: result.error,
    };
  }
  if (result.status === 0) {
    return { status: "succeeded", exitCode: 0, stdout, stderr };
  }
  return { status: "failed", exitCode: result.status ?? 1, stdout, stderr };
}

export function describeCommand(result: CommandResult): string {
  if (result.status === "succeeded") return "ok";
  if (result.status === "unavailable") return result.error.message;
  return `exit ${result.exitCode}: ${result.stderr.trim()}`;
}
