import { spawn } from "node:child_process";
import type { z } from "zod";
import { argvSchema, type Config, limitsSchema } from "./contracts.js";

export type ProcessOptions = {
  cwd: string;
  limits: Config["limits"];
  input?: string;
  env?: NodeJS.ProcessEnv;
};

/** Execute exact argv. Both pipes and stdin are bounded; no shell or write retry. */
export async function runProcess(
  argv: string[],
  options: ProcessOptions,
): Promise<string> {
  argvSchema.parse(argv);
  const limits = limitsSchema.parse(options.limits);
  const input = options.input ?? "";
  if (Buffer.byteLength(input) > limits.maxOutputBytes)
    throw new Error("Process input exceeds byte limit");
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0] as string, argv.slice(1), {
      cwd: options.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, output = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      chunks.length = 0;
      if (error) reject(error);
      else resolve(output);
    };
    const stop = (error: Error) => {
      if (settled) return;
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* The process may already have exited. */
      }
      // Escaped descendants may retain inherited pipes. Never wait for their close event.
      child.unref();
      finish(error);
    };
    timer = setTimeout(() => stop(new Error("Process timed out")), limits.timeoutMs);
    for (const pipe of [child.stdout, child.stderr]) {
      pipe.on("data", (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > limits.maxOutputBytes)
          stop(new Error("Process output exceeds byte limit"));
        else if (pipe === child.stdout) chunks.push(chunk);
      });
      pipe.on("error", stop);
    }
    child.on("error", stop);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") stop(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) finish(new Error(`Process exited ${code ?? signal}`));
      else finish(undefined, Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(input);
  });
}

export async function rpc<T>(
  argv: string[],
  input: unknown,
  schema: z.ZodType<T>,
  options: Omit<ProcessOptions, "input">,
): Promise<T> {
  const output = await runProcess(argv, { ...options, input: JSON.stringify(input) });
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Process returned malformed JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    throw new Error(
      `Invalid protocol response: ${result.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`.slice(0, 500))
        .join("; ")}`,
    );
  return result.data;
}
