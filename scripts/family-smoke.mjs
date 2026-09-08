import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const mode = process.argv[2];

// Only the executor is a fixture. All catalog, skill and context data come from
// the five installed release artifacts, communicating over public boundaries.
if (mode === "execute") {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const request = JSON.parse(text);
  assert.equal(request.protocolVersion, "1.0");
  assert.equal(await realpath(process.cwd()), request.workspace);
  assert.equal(request.memory?.protocolVersion, "1.0");
  assert.equal(request.memory?.store, "codepatrol");
  const names = {
    spec: "architect",
    "spec-review": "qa",
    plan: "architect",
    "plan-review": "qa",
    build: "developer",
    "build-review": "qa",
    ship: "release",
  };
  assert.equal(request.agent.persona, names[request.stage]);
  assert.ok(request.agent.skills.length > 0);
  assert.match(request.agent.catalogDigest, /^[a-f0-9]{64}$/);
  for (const profile of ["react", "python", "mcp"])
    assert.ok(request.agent.profiles.includes(profile));
  const artifacts = [];
  if (request.stage === "spec" || request.stage === "plan") {
    const path = `docs/${request.stage}.md`;
    await mkdir("docs", { recursive: true });
    await writeFile(
      path,
      `# ${request.stage}\n\nRepair React validation and Python MCP service.\n`,
    );
    artifacts.push(path);
  }
  if (request.stage === "build") {
    await writeFile(
      "src/validation.ts",
      "export const valid = (value: string) => value.trim().length > 0;\n",
    );
    artifacts.push("src/validation.ts");
  }
  if (request.stage.endsWith("-review")) {
    const producer = request.previous.at(-1);
    assert.notEqual(request.context.snapshot, producer.context.snapshot);
    for (const path of producer.result.artifacts) {
      const file = request.context.files.find((item) => item.path === path);
      assert.ok(file, `Fresh review context must include ${path}`);
      assert.ok(file.reasons.includes("explicit seed"));
    }
  }
  process.stdout.write(
    JSON.stringify({
      protocolVersion: "1.0",
      status: "passed",
      summary: `Fixture executed ${request.stage}; not model-generated evidence`,
      artifacts,
      ...(request.stage.endsWith("-review")
        ? {
            approved: !(
              process.argv[3] === "reject" && request.stage === "spec-review"
            ),
          }
        : {}),
      ...(request.stage === "build"
        ? { usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } }
        : {}),
      ...(request.stage === "spec"
        ? {
            memories: [
              {
                content:
                  "Repair React validation and Python MCP service uses isolated verified worktrees.",
                category: "decision",
                importance: 4,
                tags: ["integration"],
                entities: ["CodePatrol", "MemoryPatrol"],
              },
            ],
          }
        : {}),
    }),
  );
} else if (mode === "verify") {
  const source = await readFile("src/validation.ts", "utf8");
  assert.match(source, /value\.trim\(\)\.length > 0/);
  if (process.argv[3] === "fail") process.exitCode = 1;
} else {
  assert.ok(
    !mode,
    "Usage: node scripts/family-smoke.mjs (provider paths via environment)",
  );
  const codeRoot = resolve(dirname(self), "..");
  const agentRoot = resolve(
    process.env.AGENTPATROL_ROOT ?? join(codeRoot, "../agentpatrol"),
  );
  const contextRoot = resolve(
    process.env.CONTEXTPATROL_ROOT ?? join(codeRoot, "../contextpatrol"),
  );
  const modelRoot = resolve(
    process.env.MODELPATROL_ROOT ?? join(codeRoot, "../modelpatrol"),
  );
  const memoryRoot = resolve(
    process.env.MEMORYPATROL_ROOT ?? join(codeRoot, "../memorypatrol"),
  );
  for (const root of [codeRoot, agentRoot, contextRoot, modelRoot, memoryRoot])
    await access(join(root, "package.json"));
  const temp = await realpath(await mkdtemp(join(tmpdir(), "patrol-family-v1-")));
  function invoke(argv, options = {}) {
    const { expected = 0, env, ...spawnOptions } = options;
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: temp,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_cache: join(temp, "npm-cache"),
        ...env,
      },
      ...spawnOptions,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, expected, result.stderr || result.stdout);
    return result.stdout;
  }
  try {
    const tarballs = [];
    const releaseRoots = [agentRoot, contextRoot, memoryRoot, modelRoot, codeRoot];
    const dependencyArtifacts = new Map();
    for (const root of releaseRoots) {
      const packed = JSON.parse(
        invoke(["npm", "pack", "--json", "--pack-destination", temp], { cwd: root }),
      );
      tarballs.push(join(temp, packed[0].filename));
      const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      for (const name of Object.keys(manifest.dependencies ?? {})) {
        const dependencyRoot = join(root, "node_modules", ...name.split("/"));
        const dependency = JSON.parse(
          await readFile(join(dependencyRoot, "package.json"), "utf8"),
        );
        const key = `${dependency.name}@${dependency.version}`;
        if (dependencyArtifacts.has(key)) continue;
        const artifact = JSON.parse(
          invoke(
            ["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", temp],
            { cwd: dependencyRoot },
          ),
        );
        dependencyArtifacts.set(key, join(temp, artifact[0].filename));
      }
    }
    invoke([
      "npm",
      "install",
      "--prefix",
      temp,
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...tarballs,
      ...dependencyArtifacts.values(),
    ]);
    const modules = join(temp, "node_modules");
    const cli = join(modules, "codepatrol/bin/codepatrol.js");
    const api = await import(
      pathToFileURL(join(modules, "codepatrol/dist/src/index.js")).href
    );
    const modelApi = await import(
      pathToFileURL(join(modules, "modelpatrol/src/index.mjs")).href
    );
    const memoryApi = await import(
      pathToFileURL(join(modules, "memorypatrol/dist/src/index.js")).href
    );
    assert.equal(typeof modelApi.createGateway, "function");
    assert.equal(typeof memoryApi.recall, "function");
    assert.equal(
      JSON.parse(await readFile(join(modules, "modelpatrol/package.json"), "utf8"))
        .version,
      "1.0.0",
    );
    assert.equal(
      JSON.parse(await readFile(join(modules, "memorypatrol/package.json"), "utf8"))
        .version,
      "1.0.0",
    );
    const env = {
      ...process.env,
      PATH: `${join(modules, ".bin")}:${process.env.PATH ?? ""}`,
    };
    const command = (kind, behavior = "pass") => [
      process.execPath,
      self,
      kind,
      behavior,
    ];
    const provider = (name, subcommand, request, root) =>
      JSON.parse(
        invoke(
          [process.execPath, join(modules, `${name}/bin/${name}.js`), subcommand],
          { input: JSON.stringify(request), cwd: root, env },
        ),
      );
    const catalog = provider(
      "agentpatrol",
      "catalog",
      { protocolVersion: "1.0" },
      temp,
    );
    assert.match(catalog.contentDigest, /^[a-f0-9]{64}$/);
    async function project(name, behavior = "pass", telemetry = true) {
      const root = join(temp, name);
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "service"));
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "family-fixture",
          private: true,
          dependencies: { react: "19.0.0" },
        }),
      );
      await writeFile(
        join(root, "src/validation.ts"),
        "export const valid = (value: string) => value.length > 0;\n",
      );
      await writeFile(
        join(root, "src/Form.tsx"),
        'import { valid } from "./validation.js";\nexport const Form = () => <input aria-invalid={!valid(" ")} />;\n',
      );
      await writeFile(
        join(root, "service/validation.py"),
        "def valid(value):\n    return bool(value.strip())\n",
      );
      await writeFile(
        join(root, "service/server.py"),
        "from .validation import valid\n# MCP service validation\ndef handle(value):\n    return valid(value)\n",
      );
      // Keep config outside the fixture tree: commands and telemetry policies
      // must not become stack evidence or dirty the repository between runs.
      const config = join(temp, `${name}.json`);
      await writeFile(
        config,
        JSON.stringify({
          protocolVersion: "1.0",
          executor: command("execute", behavior),
          verification: command("verify", behavior),
          memorypatrol: {},
          telemetry: { enabled: telemetry },
        }),
      );
      invoke(["git", "init", "-q"], { cwd: root });
      invoke(["git", "add", "."], { cwd: root });
      invoke(
        [
          "git",
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.test",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-qm",
          "fixture",
        ],
        { cwd: root },
      );
      const request = {
        protocolVersion: "1.0",
        root,
        config,
        task: "Repair React validation and Python MCP service",
        paths: ["src/validation.ts", "service/validation.py"],
      };
      const run = (expected = 0) =>
        JSON.parse(
          invoke([process.execPath, cli, "run", "--input", "-"], {
            input: JSON.stringify(request),
            cwd: root,
            expected,
            env,
          }),
        );
      const plan = () =>
        JSON.parse(
          invoke([process.execPath, cli, "plan", "--input", "-"], {
            input: JSON.stringify(request),
            cwd: root,
            env,
          }),
        );
      return { root, request, run, plan };
    }
    const main = await project("main");
    const before = main.plan();
    assert.equal(before.catalogDigest, catalog.contentDigest);
    assert.equal(before.stages.length, 7);
    for (const stage of before.stages) {
      for (const profile of ["react", "python", "mcp"])
        assert.ok(stage.route.profiles.includes(profile));
      assert.equal(stage.agent.catalogDigest, catalog.contentDigest);
      api.validateDigest(stage.agent);
      api.validateDigest(stage.context);
    }
    const graph = before.overview.graph;
    assert.ok(
      graph.edges.some(
        (edge) => edge.from === "src/Form.tsx" && edge.to === "src/validation.ts",
      ),
    );
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.from === "service/server.py" && edge.to === "service/validation.py",
      ),
    );
    assert.ok(graph.impacted.includes("src/Form.tsx"));
    const state = main.run();
    assert.equal(state.status, "awaiting-approval");
    assert.equal(state.stages.length, 7);
    assert.equal(state.stages[4].verification.status, "passed");
    assert.ok(!JSON.stringify(state).includes("uses isolated verified worktrees"));
    const recalled = provider(
      "memorypatrol",
      "recall",
      {
        protocolVersion: "1.0",
        root: main.root,
        store: "codepatrol",
        task: "Repair React validation and Python MCP service",
      },
      main.root,
    );
    const { digest: memoryDigest, ...memoryPayload } = recalled;
    assert.equal(memoryDigest, memoryApi.digest(memoryPayload));
    assert.ok(
      recalled.insights.some((insight) =>
        insight.content.includes("isolated verified worktrees"),
      ),
    );
    assert.match(
      await readFile(join(main.root, "src/validation.ts"), "utf8"),
      /=> value\.length/,
    );
    assert.match(
      await readFile(join(state.workspace, "src/validation.ts"), "utf8"),
      /value\.trim/,
    );
    assert.equal(
      main.plan().overview.snapshot,
      before.overview.snapshot,
      "State and retained worktrees must not pollute context",
    );
    invoke(
      [process.execPath, cli, "approve", "--run", state.runId, "--root", main.root],
      { expected: 1, env },
    );
    const approved = JSON.parse(
      invoke(
        [
          process.execPath,
          cli,
          "approve",
          "--run",
          state.runId,
          "--root",
          main.root,
          "--confirm",
        ],
        { env },
      ),
    );
    assert.equal(approved.status, "approved");
    const history = await api.readTelemetry(main.root);
    assert.equal(history.length, 7);
    assert.equal(history.filter((event) => event.usage !== undefined).length, 1);
    assert.ok(
      history
        .filter((event) => event.route.stage.endsWith("-review"))
        .every((event) => event.feedback === "unknown"),
    );
    const rawTelemetry = await readFile(
      join(main.root, ".codepatrol/v1/telemetry.jsonl"),
      "utf8",
    );
    assert.ok(!rawTelemetry.includes(main.request.task));
    assert.ok(!rawTelemetry.includes("value.trim"));
    const rejected = await project("rejected", "reject");
    for (let attempt = 0; attempt < 3; attempt++) {
      const blocked = rejected.run(1);
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.stages.length, 2);
      invoke(
        [
          process.execPath,
          cli,
          "approve",
          "--run",
          blocked.runId,
          "--root",
          rejected.root,
          "--confirm",
        ],
        { expected: 1, env },
      );
    }
    const learned = rejected.plan();
    assert.deepEqual(
      learned.stages[0].route.profiles,
      ["general"],
      "Three rejected producer outputs must affect routing",
    );
    assert.ok(
      learned.stages[1].route.profiles.includes("react"),
      "Correct rejections must not demote reviewers",
    );
    assert.equal(learned.stages[1].route.adjustment, 0);
    const failed = await project("verification-failed", "fail");
    const blocked = failed.run(1);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.stages.at(-1).stage, "build");
    assert.equal(blocked.stages.at(-1).verification.status, "failed");
    const privateRun = await project("telemetry-disabled", "pass", false);
    assert.equal(privateRun.run().status, "awaiting-approval");
    await assert.rejects(
      access(join(privateRun.root, ".codepatrol/v1/telemetry.jsonl")),
      { code: "ENOENT" },
    );
    process.stdout.write(
      "Family v1 installed integration passed: five real packages, persistent memory, React/Python/MCP routing, import impact, fresh reviews, isolated builds, verification/review gates, approval, private telemetry and adaptive producer selection.\n",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
