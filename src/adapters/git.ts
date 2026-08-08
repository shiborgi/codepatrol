import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { CodepatrolError } from "../core/errors.js";

export interface Git {
  exec(
    args: string[],
    options?: { input?: string; env?: Record<string, string>; allowFailure?: boolean },
  ): Promise<GitResult>;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const NEUTRAL_ENV = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
]);

export function localGit(cwd: string): Git {
  return {
    exec(args, options = {}) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (action: () => void): void => {
          if (settled) return;
          settled = true;
          action();
        };
        let child: ChildProcessByStdio<Writable, Readable, Readable>;
        try {
          const env: Record<string, string> = {};
          for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && !NEUTRAL_ENV.has(key)) env[key] = value;
          }
          Object.assign(env, options.env);
          child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
        } catch (error) {
          settle(() => reject(new CodepatrolError("INVALID_STATE", `failed to spawn git: ${messageOf(error)}`)));
          return;
        }
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (error) => {
          settle(() =>
            reject(new CodepatrolError("INVALID_STATE", `failed to run git ${args.join(" ")}: ${messageOf(error)}`)),
          );
        });
        child.on("close", (code) => {
          settle(() => {
            const result: GitResult = {
              code: code ?? 1,
              stdout: Buffer.concat(stdout).toString("utf8"),
              stderr: Buffer.concat(stderr).toString("utf8"),
            };
            if (result.code !== 0 && options.allowFailure !== true) {
              reject(new CodepatrolError("INVALID_STATE", `git ${args.join(" ")} failed: ${result.stderr.trim()}`));
              return;
            }
            resolve(result);
          });
        });
        try {
          if (options.input !== undefined) child.stdin.write(options.input);
          child.stdin.end();
        } catch (error) {
          settle(() =>
            reject(new CodepatrolError("INVALID_STATE", `failed to write to git stdin: ${messageOf(error)}`)),
          );
        }
      });
    },
  };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
