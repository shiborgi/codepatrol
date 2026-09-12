import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension, { featureRequest, runFeature } from "../integrations/pi/index.mjs";

test("Pi extension separates interactive and stage capabilities", () => {
  const previous = process.env.CODEPATROL_STAGE;
  try {
    delete process.env.CODEPATROL_STAGE;
    const interactive = { commands: [], tools: [] };
    extension({
      registerCommand: (name) => interactive.commands.push(name),
      registerTool: (tool) => interactive.tools.push(tool.name),
    });
    assert.deepEqual(interactive, { commands: ["patrol"], tools: [] });

    process.env.CODEPATROL_STAGE = "build";
    const staged = { commands: [], tools: [] };
    extension({
      registerCommand: (name) => staged.commands.push(name),
      registerTool: (tool) => staged.tools.push(tool.name),
    });
    assert.deepEqual(staged, { commands: [], tools: ["codepatrol_result"] });
  } finally {
    if (previous === undefined) delete process.env.CODEPATROL_STAGE;
    else process.env.CODEPATROL_STAGE = previous;
  }
});

test("Pi completion schema is stage-specific and preserves tracked acceptance", () => {
  const savedStage = process.env.CODEPATROL_STAGE;
  const savedKeys = process.env.CODEPATROL_ACCEPTANCE_KEYS;
  try {
    process.env.CODEPATROL_STAGE = "build-review";
    process.env.CODEPATROL_ACCEPTANCE_KEYS = '["streams","tests-pass"]';
    let tool;
    extension({
      registerCommand: () => {},
      registerTool: (value) => {
        tool = value;
      },
    });
    assert(tool.parameters.required.includes("approved"));
    assert(tool.parameters.required.includes("acceptance"));
    assert.equal(tool.parameters.properties.acceptance.minItems, 2);

    process.env.CODEPATROL_STAGE = "spec";
    delete process.env.CODEPATROL_ACCEPTANCE_KEYS;
    extension({
      registerCommand: () => {},
      registerTool: (value) => {
        tool = value;
      },
    });
    assert.equal(tool.parameters.properties.approved, undefined);
    assert.equal(tool.parameters.properties.acceptance, undefined);
  } finally {
    if (savedStage === undefined) delete process.env.CODEPATROL_STAGE;
    else process.env.CODEPATROL_STAGE = savedStage;
    if (savedKeys === undefined) delete process.env.CODEPATROL_ACCEPTANCE_KEYS;
    else process.env.CODEPATROL_ACCEPTANCE_KEYS = savedKeys;
  }
});

test("Pi command builds a closed request and parses durable run state", async () => {
  assert.deepEqual(featureRequest("/repo", "  Add feature  "), {
    protocolVersion: "1.0",
    root: "/repo",
    task: "Add feature",
  });
  assert.throws(() => featureRequest("/repo", "  "), /Usage: \/patrol/);

  const directory = await mkdtemp(join(tmpdir(), "codepatrol-pi-command-"));
  const cli = join(directory, "fake-cli.mjs");
  try {
    await writeFile(
      cli,
      "let input=''; for await (const chunk of process.stdin) input += chunk; const request=JSON.parse(input); process.stdout.write(JSON.stringify({protocolVersion:'1.0',runId:'test-run',root:request.root,input:request,status:'awaiting-approval'}));\n",
    );
    await chmod(cli, 0o700);
    const result = await runFeature(directory, "Test feature", {
      cliPath: cli,
      env: process.env,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.runId, "test-run");
    assert.equal(result.state.input.task, "Test feature");
    assert.equal(result.state.input.root, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pi command delivers progress before the final state and filters it from diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codepatrol-pi-progress-"));
  const cli = join(directory, "fake-progress.mjs");
  const event = {
    protocolVersion: "1.0",
    time: new Date(0).toISOString(),
    runId: randomUUID(),
    kind: "stage_started",
    stage: "spec",
  };
  try {
    await writeFile(
      cli,
      `process.stderr.write('CODEPATROL_EVENT ' + ${JSON.stringify(
        JSON.stringify(event),
      )} + '\\n'); setTimeout(() => process.stdout.write(JSON.stringify({protocolVersion:'1.0',runId:'test-run',status:'awaiting-approval'})), 20);\n`,
    );
    await chmod(cli, 0o700);
    const progress = [];
    const result = await runFeature(directory, "Test progress", {
      cliPath: cli,
      env: process.env,
      onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(progress, [event]);
    assert.equal(result.diagnostics, "");
    assert.equal(result.state.status, "awaiting-approval");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
