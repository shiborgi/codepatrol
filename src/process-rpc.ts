import { spawn, spawnSync } from "node:child_process";

export interface JsonProcessOptions {
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxErrorBytes: number;
  unavailableCode: string;
  failedCode: string;
  timeoutCode: string;
  tooLargeCode: string;
  unavailableMessage: (message: string) => string;
  failedMessage: (stderr: string, status: number | null) => string;
  timeoutMessage: (timeoutMs: number) => string;
  tooLargeMessage: (maxBytes: number) => string;
  error: (code: string, message: string) => Error;
}

export interface JsonProcessFailure {
  code: string;
  message: string;
}

export async function invokeJsonProcess(
  command: string,
  args: string[],
  request: unknown,
  options: JsonProcessOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let failure: JsonProcessFailure | undefined;
    let timedOut = false;
    let settled = false;
    const terminate = (): void => {
      if (process.platform === "win32" && child.pid) {
        const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        if (result.status === 0) return;
      }
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {}
      }
      child.kill("SIGKILL");
    };
    const rejectTimeout = (): void => {
      if (settled) return;
      settled = true;
      reject(
        options.error(options.timeoutCode, options.timeoutMessage(options.timeoutMs)),
      );
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
      rejectTimeout();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxOutputBytes) {
        failure = {
          code: options.tooLargeCode,
          message: options.tooLargeMessage(options.maxOutputBytes),
        };
        terminate();
      } else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const bounded = chunk.subarray(
        0,
        Math.max(0, options.maxErrorBytes - errorBytes),
      );
      errors.push(bounded);
      errorBytes += bounded.length;
    });
    child.on("error", (error) => {
      failure = {
        code: options.unavailableCode,
        message: options.unavailableMessage(error.message),
      };
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (timedOut)
        reject(
          options.error(options.timeoutCode, options.timeoutMessage(options.timeoutMs)),
        );
      else if (failure) reject(options.error(failure.code, failure.message));
      else if (status !== 0)
        reject(
          options.error(
            options.failedCode,
            options.failedMessage(
              Buffer.concat(errors).toString("utf8").trim(),
              status,
            ),
          ),
        );
      else resolve(Buffer.concat(output).toString("utf8"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
