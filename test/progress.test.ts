import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PROGRESS_PREFIX, parseProgressLine } from "../src/progress.js";

test("progress JSONL accepts bounded protocol events and rejects untrusted shapes", () => {
  const event = {
    protocolVersion: "1.0",
    time: new Date().toISOString(),
    runId: randomUUID(),
    kind: "stage_decided",
    stage: "spec",
    elapsedMs: 123,
    message: "Decisão concluída",
  };
  assert.deepEqual(
    parseProgressLine(`${PROGRESS_PREFIX}${JSON.stringify(event)}`),
    event,
  );
  assert.equal(
    parseProgressLine(
      `${PROGRESS_PREFIX}${JSON.stringify({ ...event, kind: "unknown" })}`,
    ),
    undefined,
  );
  assert.equal(
    parseProgressLine(
      `${PROGRESS_PREFIX}${JSON.stringify({ ...event, secret: "no" })}`,
    ),
    undefined,
  );
  assert.equal(parseProgressLine("ordinary diagnostic"), undefined);
});
