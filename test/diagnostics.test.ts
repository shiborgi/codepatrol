import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { stderrLogger } from "../src/run-context.js";
import { fixture } from "./helpers.js";

function captureStderr(action: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    action();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

test("stderrLogger emits only messages at or above the threshold", () => {
  const silent = captureStderr(() => {
    const logger = stderrLogger("silent");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("hidden");
    logger.error("hidden");
  });
  assert.equal(silent, "");

  const warnOnly = captureStderr(() => {
    const logger = stderrLogger("warn");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("shown-warn");
    logger.error("shown-error");
  });
  assert.equal(
    warnOnly,
    "[codepatrol] warn: shown-warn\n[codepatrol] error: shown-error\n",
  );

  const verbose = captureStderr(() => {
    const logger = stderrLogger("debug");
    logger.debug("shown-debug");
    logger.info("shown-info");
  });
  assert.equal(
    verbose,
    "[codepatrol] debug: shown-debug\n[codepatrol] info: shown-info\n",
  );
});

async function captureStderrAround(action: () => Promise<void>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    await action();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

test("default CLI output stays byte-identical while --verbose adds stderr only", async () => {
  const { root } = fixture();
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "Diagnostics",
  ]);
  assert.equal(created.exitCode, 0, created.stderr);
  const plain = await runCli(["node", "codepatrol", "--workspace", root, "doctor"]);
  const verbose = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "--verbose",
    "doctor",
  ]);
  assert.equal(plain.exitCode, 0, plain.stderr);
  assert.equal(verbose.exitCode, 0, verbose.stderr);
  assert.equal(verbose.stdout, plain.stdout);
  assert.equal(plain.stderr, "");

  const cleanup = await runCli(["node", "codepatrol", "--workspace", root, "cleanup"]);
  assert.equal(cleanup.exitCode, 0, cleanup.stderr);
  assert.equal(cleanup.stderr, "");
  let verboseCleanup: { exitCode: number; stdout: string; stderr: string } | undefined;
  const verboseLog = await captureStderrAround(async () => {
    verboseCleanup = await runCli([
      "node",
      "codepatrol",
      "--workspace",
      root,
      "--verbose",
      "cleanup",
    ]);
  });
  assert.ok(verboseCleanup);
  assert.equal(verboseCleanup.exitCode, 0);
  assert.equal(verboseCleanup.stdout, cleanup.stdout);
  assert.equal(verboseCleanup.stderr, "");
  assert.match(verboseLog, /\[codepatrol\] debug: cleanup git worktree prune/);
});

test("--quiet keeps error JSON on stderr and rejects --verbose together", async () => {
  const { root } = fixture();
  const quiet = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "--quiet",
    "remote",
    "bogus",
  ]);
  assert.equal(quiet.exitCode, 2);
  assert.equal(quiet.stdout, "");
  const parsed = JSON.parse(quiet.stderr) as { error: string; message: string };
  assert.equal(parsed.error, "USAGE");
  assert.match(parsed.message, /invalid subaction bogus for remote/);

  const both = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "--verbose",
    "--quiet",
    "doctor",
  ]);
  assert.equal(both.exitCode, 2);
  assert.match(
    (JSON.parse(both.stderr) as { message: string }).message,
    /--verbose and --quiet cannot be combined/,
  );
});

test("loadConfig separates missing, malformed, and schema-invalid files", () => {
  const missingRoot = mkdtempSync(resolve(tmpdir(), "codepatrol-config-missing-"));
  assert.throws(
    () => loadConfig(missingRoot),
    (error: unknown) => {
      const failure = error as { code?: string; message?: string; exitCode?: number };
      return (
        failure.code === "CONFIG_INVALID" &&
        failure.exitCode === 2 &&
        /missing configuration file/.test(failure.message as string) &&
        /create codepatrol\.json/.test(failure.message as string)
      );
    },
  );

  const malformedRoot = mkdtempSync(resolve(tmpdir(), "codepatrol-config-malformed-"));
  writeFileSync(resolve(malformedRoot, "codepatrol.json"), "{ not json");
  assert.throws(
    () => loadConfig(malformedRoot),
    (error: unknown) => {
      const failure = error as { code?: string; message?: string; exitCode?: number };
      return (
        failure.code === "CONFIG_INVALID" &&
        failure.exitCode === 2 &&
        /cannot parse valid JSON/.test(failure.message as string)
      );
    },
  );

  const invalidRoot = mkdtempSync(resolve(tmpdir(), "codepatrol-config-invalid-"));
  writeFileSync(
    resolve(invalidRoot, "codepatrol.json"),
    JSON.stringify({ schemaVersion: 1, baseBranch: "main" }),
  );
  assert.throws(
    () => loadConfig(invalidRoot),
    (error: unknown) => {
      const failure = error as { code?: string; message?: string; exitCode?: number };
      return (
        failure.code === "CONFIG_INVALID" &&
        failure.exitCode === 2 &&
        /verification/.test(failure.message as string)
      );
    },
  );
});
