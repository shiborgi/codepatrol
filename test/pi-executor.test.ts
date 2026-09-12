import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { ExecutorRequest } from "../src/executor.js";
import { parsePiEvents, piPrompt } from "../src/executors/pi.js";

function request(stage: ExecutorRequest["stage"] = "build"): ExecutorRequest {
  return {
    protocolVersion: "1.0",
    runId: randomUUID(),
    stage,
    task: "Implement the requested change",
    workspace: process.cwd(),
    agent: {
      protocolVersion: "1.0",
      catalogVersion: "1.0.0",
      catalogDigest: "a".repeat(64),
      persona: stage.endsWith("-review") ? "qa" : "developer",
      profiles: ["general"],
      skills: [],
      instructions: "Follow repository guidance",
      digest: "b".repeat(64),
    },
    context: {
      protocolVersion: "1.0",
      profile: stage === "build" ? "implementation" : "review",
      snapshot: "c".repeat(64),
      signals: [],
      files: [],
      graph: { nodes: [], edges: [], cycles: [], impacted: [] },
      diagnostics: [],
      stats: { scannedFiles: 0, selectedFiles: 0, truncated: false },
      digest: "d".repeat(64),
    },
    previous: [],
  };
}

function line(value: unknown) {
  return JSON.stringify(value);
}

test("Pi executor accepts one completion tool and derives authoritative usage", () => {
  const proposed = {
    protocolVersion: "1.0",
    status: "passed",
    summary: "Implemented the change",
    artifacts: ["src/change.ts"],
    usage: { inputTokens: 999999 },
  };
  const output = [
    line({ type: "session", version: 3 }),
    line({
      type: "message_update",
      usage: { input: 12, output: 4, cost: { total: 0.01 } },
    }),
    line({
      type: "tool_execution_start",
      toolCallId: "result-1",
      toolName: "codepatrol_result",
      args: proposed,
    }),
    line({
      type: "tool_execution_end",
      toolCallId: "result-1",
      toolName: "codepatrol_result",
      isError: false,
    }),
  ].join("\n");
  assert.deepEqual(parsePiEvents(output), {
    protocolVersion: "1.0",
    status: "passed",
    summary: "Implemented the change",
    artifacts: ["src/change.ts"],
    usage: { inputTokens: 12, outputTokens: 4, costUsd: 0.01 },
  });
});

test("Pi executor accepts an exact JSON fallback and fails closed on ambiguity", () => {
  const result = {
    protocolVersion: "1.0",
    status: "passed",
    summary: "Review passed",
    artifacts: [],
    approved: true,
  };
  const fallback = line({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify(result) }],
    },
  });
  assert.deepEqual(parsePiEvents(fallback), result);
  assert.throws(
    () =>
      parsePiEvents(
        [
          fallback,
          line({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: `Result: ${JSON.stringify(result)}` }],
            },
          }),
        ].join("\n"),
      ),
    /exact JSON/,
  );
  assert.throws(() => parsePiEvents("not-json"), /malformed JSONL \(line: not-json\)/);
});

test("Pi executor errors include bounded events, tools and assistant text", () => {
  assert.throws(
    () => parsePiEvents(""),
    /Pi did not submit a CodePatrol result \(events: none; tools: none\)$/,
  );
  assert.throws(
    () =>
      parsePiEvents(
        [
          line({ type: "session", version: 3 }),
          line({
            type: "tool_execution_start",
            toolCallId: "read-1",
            toolName: "read",
            args: { path: "README.md" },
          }),
          line({
            type: "tool_execution_end",
            toolCallId: "read-1",
            toolName: "read",
            isError: false,
          }),
          line({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Here is a prose spec.\nNext steps." }],
            },
          }),
        ].join("\n"),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /^Pi did not submit an exact JSON CodePatrol result \(events: session,tool_execution_start,tool_execution_end,message_end; tools: read; text: Here is a prose spec\. Next steps\.\)$/,
      );
      return true;
    },
  );
  const long = `HEAD${"x".repeat(600)}TAIL-MARKER`;
  assert.throws(
    () =>
      parsePiEvents(
        line({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `Result: ${long}` }],
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Pi did not submit an exact JSON CodePatrol result/);
      assert.match(error.message, /text: /);
      assert.match(error.message, /TAIL-MARKER\)$/);
      assert.equal(error.message.includes("HEAD"), false);
      const text = error.message.slice(error.message.indexOf("text: ") + 6, -1);
      assert.equal(text.length, 500);
      return true;
    },
  );
});

test("Pi prompt grants writes only to build and preserves the closed request", () => {
  const build = request("build");
  const review = request("build-review");
  assert.match(piPrompt(build), /implement the requested change/);
  assert.match(piPrompt(review), /read and analyze only; do not modify files/);
  assert.match(piPrompt(review), new RegExp(review.runId));
  assert.match(piPrompt(review), /codepatrol_result exactly once/);
  assert.match(piPrompt(review), /empty assistant turn or prose/);
});
