import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isWaveId, isWorkId } from "../core/identifiers.js";
import { parseAttemptResult, parseTodoList } from "../core/work.js";
import { DOCUMENT_TYPE, parseDocument, type SpecDocument } from "../index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function validDocument(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: DOCUMENT_TYPE,
    initiative: { id: "INIT-1", title: "Title", intent: "Intent" },
    waves: [{ id: "WAVE-1.1", title: "Wave", intent: "Wave intent" }],
    works: [
      {
        id: "WORK-1.1.1",
        wave: "WAVE-1.1",
        title: "Work",
        description: "Description",
        workType: "task",
        priority: "p2",
        delivery: "no-code",
        acceptance: ["criterion"],
        blockedBy: [],
      },
    ],
  };
}

function withWork(patch: Record<string, unknown>): Record<string, unknown> {
  const document = validDocument();
  document.works = [{ ...(document.works as Record<string, unknown>[])[0], ...patch }];
  return document;
}

test("the published parser accepts a complete document", () => {
  const parsed: SpecDocument = parseDocument(validDocument());
  assert.equal(parsed.initiative.id, "INIT-1");
  assert.equal(parsed.waves[0]?.id, "WAVE-1.1");
  assert.equal(parsed.works[0]?.wave, "WAVE-1.1");
  assert.equal(parsed.works[0]?.delivery, "no-code");
});

test("delivery is required", () => {
  const document = withWork({ delivery: undefined });
  delete (document.works as Record<string, unknown>[])[0]?.delivery;
  assert.throws(() => parseDocument(document), /delivery must be/);
});

const REJECTIONS: { rule: string; document: unknown; message: RegExp }[] = [
  { rule: "not an object", document: 42, message: /spec document/ },
  {
    rule: "unsupported schemaVersion",
    document: { ...validDocument(), schemaVersion: 2 },
    message: /unsupported schemaVersion/,
  },
  { rule: "wrong type", document: { ...validDocument(), type: "something-else" }, message: /document\.type must be/ },
  {
    rule: "initiative not an object",
    document: { ...validDocument(), initiative: "INIT-1" },
    message: /spec document\.initiative/,
  },
  {
    rule: "initiative id missing",
    document: { ...validDocument(), initiative: { title: "t", intent: "i" } },
    message: /initiative\.id is required/,
  },
  {
    rule: "initiative title empty",
    document: { ...validDocument(), initiative: { id: "INIT-1", title: "  ", intent: "i" } },
    message: /initiative\.title/,
  },
  {
    rule: "initiative intent missing",
    document: { ...validDocument(), initiative: { id: "INIT-1", title: "t" } },
    message: /initiative\.intent/,
  },
  { rule: "waves not an array", document: { ...validDocument(), waves: {} }, message: /waves must be an array/ },
  {
    rule: "wave without title",
    document: { ...validDocument(), waves: [{ id: "WAVE-1.1", intent: "i" }] },
    message: /waves\[0\]\.title/,
  },
  { rule: "works not an array", document: { ...validDocument(), works: "none" }, message: /works must be an array/ },
  { rule: "work id missing", document: withWork({ id: "" }), message: /works\[0\]\.id is required/ },
  { rule: "work wave missing", document: withWork({ wave: undefined }), message: /works\[0\]\.wave/ },
  { rule: "work description empty", document: withWork({ description: "" }), message: /works\[0\]\.description/ },
  {
    rule: "unknown workType",
    document: withWork({ workType: "chore" }),
    message: /workType must be bug\|feature\|task/,
  },
  { rule: "unknown priority", document: withWork({ priority: "p9" }), message: /priority must be p0\|p1\|p2\|p3/ },
  { rule: "unknown delivery", document: withWork({ delivery: "partial" }), message: /delivery must be code\|no-code/ },
  { rule: "empty acceptance criterion", document: withWork({ acceptance: [" "] }), message: /acceptance\[0\]/ },
  { rule: "empty blocker", document: withWork({ blockedBy: [""] }), message: /blockedBy\[0\]/ },
  { rule: "unknown top-level field", document: { ...validDocument(), typo: true }, message: /unknown field/ },
  { rule: "missing acceptance", document: withWork({ acceptance: undefined }), message: /acceptance must be an array/ },
  { rule: "missing blockedBy", document: withWork({ blockedBy: undefined }), message: /blockedBy must be an array/ },
];

for (const rejection of REJECTIONS) {
  test(`the published parser rejects: ${rejection.rule}`, () => {
    assert.throws(() => parseDocument(rejection.document), rejection.message);
  });
}

test("the published example document is accepted by the parser it illustrates", () => {
  const example = JSON.parse(readFileSync(join(repoRoot, "examples", "initiative.json"), "utf8"));
  const parsed = parseDocument(example);
  assert.ok(parsed.waves.length > 0, "the example declares its waves");
  for (const work of parsed.works) {
    assert.ok(isWorkId(work.id), `${work.id} is a canonical Work id`);
    assert.ok(isWaveId(work.wave), `${work.wave} is a canonical Wave id`);
    assert.ok(
      parsed.waves.some((wave) => wave.id === work.wave),
      `${work.id} refers to a wave the example declares`,
    );
    for (const blocker of work.blockedBy) {
      assert.ok(isWorkId(blocker), `${blocker} is a canonical Work id`);
    }
  }
});

test("every published example is valid input for the command it illustrates", () => {
  const todo = JSON.parse(readFileSync(join(repoRoot, "examples", "todo.json"), "utf8")) as { todo: unknown };
  assert.ok(parseTodoList(todo.todo, "todo").length > 0, "the todo example parses");

  for (const name of ["result-continue", "result-return", "result-verify", "result-accept"]) {
    const result = JSON.parse(readFileSync(join(repoRoot, "examples", `${name}.json`), "utf8"));
    assert.doesNotThrow(() => parseAttemptResult(result), `${name}.json parses as an attempt result`);
  }
});

test("only one implementation of the document parser exists in the source tree", () => {
  const marker = "spec document.waves must be an array";
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(repoRoot, relative), { withFileTypes: true })) {
      const child = join(relative, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test") continue;
        walk(child);
      } else if (entry.name.endsWith(".ts") && readFileSync(join(repoRoot, child), "utf8").includes(marker)) {
        found.push(child);
      }
    }
  };
  walk("src");
  assert.deepEqual(
    found,
    [join("src", "application", "spec-service.ts")],
    "exactly one module validates the document schema",
  );
  assert.ok(statSync(join(repoRoot, "src", "cli", "run-cli.ts")).isFile());
});
