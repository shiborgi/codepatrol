import assert from "node:assert/strict";
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
