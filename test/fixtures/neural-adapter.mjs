import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [mode, behavior = "pass", authoringPath, tracePath] = process.argv.slice(2);
if (mode === "escaped-descendant" || mode === "escaped-overflow") {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `${mode === "escaped-overflow" ? "process.stdout.write('x'.repeat(2048));" : ""}setTimeout(() => {}, 60000)`,
    ],
    { detached: true, stdio: ["ignore", process.stdout, process.stderr] },
  );
  await writeFile(behavior, String(child.pid));
  child.unref();
  process.exit(0);
}
if (mode === "verify") {
  assert.equal(await readFile("BUILD.txt", "utf8"), "implemented by fixture\n");
  process.exit(behavior === "fail" ? 1 : 0);
}
if (mode === "timeout") await new Promise((resolve) => setTimeout(resolve, 60_000));
if (mode === "overflow") {
  process.stdout.write("x".repeat(2048));
  process.exit(0);
}
if (mode === "stderr-overflow") {
  process.stderr.write("x".repeat(2048));
  process.exit(0);
}
if (mode === "nonzero") {
  process.stdout.write("stdout-must-not-appear");
  process.stderr.write("executor diagnostic");
  process.exit(7);
}
if (mode === "malformed") {
  process.stdout.write("not json");
  process.exit(0);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
assert.equal(request.protocolVersion, "1.0");
if (tracePath)
  await appendFile(
    tracePath,
    `${JSON.stringify({ mode, behavior, cwd: process.cwd(), ...(mode === "context" ? { paths: request.paths, profile: request.profile, budget: request.budget } : {}), ...(mode === "execute" ? { memory: request.memory } : {}) })}\n`,
  );
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const signed = (value) => ({ ...value, digest: digest(value) });
const personas = [
  {
    id: "architect",
    description: "Design",
    stages: ["spec", "plan"],
    skills: ["design"],
  },
  {
    id: "developer",
    description: "Implement",
    stages: ["build"],
    skills: ["implement"],
  },
  {
    id: "qa",
    description: "Review",
    stages: ["spec-review", "plan-review", "build-review"],
    skills: ["review"],
  },
  {
    id: "release",
    description: "Prepare release",
    stages: ["ship"],
    skills: ["release"],
  },
];
if (behavior === "oversize-plan")
  personas[0].skills = Array.from({ length: 64 }, (_, index) => `design-${index}`);
const profiles = ["general", "react", "python", "mcp"].map((id) => ({
  id,
  description: `${id} profile`,
  signals: id === "react" ? ["react", "tsx", "jsx"] : [id],
  skills: [`${id}-skill`],
}));
if (behavior === "amplified") {
  for (let index = 0; index < 252; index++) {
    personas.push({
      id: `persona-${String(index).padStart(3, "0")}`,
      description: "Extra eligible persona",
      stages: ["build"],
      skills: ["implement"],
    });
    profiles.push({
      id: `profile-${String(index).padStart(3, "0")}`,
      description: "Extra matching profile",
      signals: ["react"],
      skills: ["general-skill"],
    });
  }
}
const authoring = authoringPath
  ? await readFile(authoringPath, "utf8")
  : "original authoring";
const activeSkills = [
  ...new Set([...personas, ...profiles].flatMap((item) => item.skills)),
]
  .sort()
  .map((id) => ({
    id,
    instructions:
      behavior === "oversize-plan" && id.startsWith("design-")
        ? "x".repeat(90_000)
        : `Use ${id}: ${authoring}.\n`,
  }));
const catalogDigest = digest({ personas, profiles, skills: activeSkills });
let response;
if (mode === "memory") {
  if (tracePath)
    await appendFile(
      tracePath,
      `${JSON.stringify({ memory: request.task ? "recall" : "remember", root: request.root, store: request.store })}\n`,
    );
  response = request.task
    ? signed({
        protocolVersion: "1.0",
        store: request.store,
        intent: "general",
        insights: [],
        diagnostics: [],
        stats: { activeInsights: 0, selectedInsights: 0, truncated: false },
      })
    : signed({
        protocolVersion: "1.0",
        store: request.store,
        id: "00000000-0000-4000-8000-000000000001",
        action: "added",
        edgesCreated: { temporal: 0, entity: 0, causal: 0, semantic: 0 },
        candidates: [],
        autoPrunedIds: [],
        effectiveImportance: 1,
      });
} else if (mode === "catalog")
  response = {
    protocolVersion: "1.0",
    catalogVersion: "1.0.0",
    contentDigest: catalogDigest,
    personas,
    profiles,
  };
else if (mode === "resolve") {
  const selected = [...new Set(request.profiles)].sort();
  const skills = [
    ...new Set([
      ...personas.find((p) => p.id === request.persona).skills,
      ...selected.flatMap((id) => profiles.find((p) => p.id === id).skills),
    ]),
  ].map((id) => activeSkills.find((skill) => skill.id === id));
  response = signed({
    protocolVersion: "1.0",
    catalogVersion: "1.0.0",
    catalogDigest,
    persona: request.persona,
    profiles: selected,
    skills,
    instructions: `Act as ${request.persona}.\n`,
  });
} else if (mode === "context") {
  assert.equal(request.root, process.cwd());
  const built = await readFile(join(request.root, "BUILD.txt"), "utf8").catch(() => "");
  const source = await readFile(join(request.root, "source.tsx"), "utf8").catch(
    () => "",
  );
  const spec = await readFile("spec.md", "utf8").catch(() => "");
  const plan = await readFile("plan.md", "utf8").catch(() => "");
  const python = await readFile("new.py", "utf8").catch(() => "");
  assert.ok(request.paths.length <= 100);
  assert.equal(new Set(request.paths).size, request.paths.length);
  const files = source
    ? [
        {
          path: "source.tsx",
          language: "typescript",
          score: 1,
          reasons: ["fixture seed"],
          excerpt: source,
        },
      ]
    : [];
  for (const [path, excerpt] of [
    ["spec.md", spec],
    ["plan.md", plan],
    ["BUILD.txt", built],
  ]) {
    if (excerpt && request.paths.includes(path))
      files.push({
        path,
        language: "text",
        score: 1,
        reasons: ["artifact seed"],
        excerpt,
      });
  }
  response = signed({
    protocolVersion: "1.0",
    profile: request.profile,
    snapshot: digest({ built, source, spec, plan, python }),
    signals: [...(python ? ["python"] : []), "react", "typescript"],
    files,
    graph: {
      nodes: files.map((file) => file.path),
      edges: [],
      cycles: [],
      impacted: [],
    },
    diagnostics: [],
    stats: {
      scannedFiles: files.length,
      selectedFiles: files.length,
      truncated: false,
    },
  });
} else if (mode === "execute") {
  assert.equal(request.workspace, process.cwd());
  assert.ok(request.workspace.includes(".codepatrol/v1/workspaces/"));
  const stages = [
    "spec",
    "spec-review",
    "plan",
    "plan-review",
    "build",
    "build-review",
    "ship",
  ];
  assert.deepEqual(
    request.previous.map((item) => item.stage),
    stages.slice(0, stages.indexOf(request.stage)),
  );
  await appendFile(
    "execution.jsonl",
    `${JSON.stringify({ stage: request.stage, workspace: request.workspace, snapshot: request.context.snapshot })}\n`,
  );
  if (request.stage === "build")
    await writeFile("BUILD.txt", "implemented by fixture\n");
  if (request.stage === "spec" || request.stage === "plan")
    await writeFile(`${request.stage}.md`, `Actual ${request.stage} evidence\n`);
  if (behavior === "evolving" && request.stage === "plan")
    await writeFile("new.py", "print('new stack signal')\n");
  if (behavior === "drift" && request.stage === "spec")
    await writeFile(authoringPath, "changed skill instructions");
  const extraArtifacts = Array.from(
    { length: 110 },
    (_, index) => `artifact-${index}.md`,
  );
  if (behavior === "artifact-seeds" && request.stage === "spec") {
    await symlink(authoringPath, "escape.md");
    await Promise.all(extraArtifacts.map((path) => writeFile(path, "safe artifact\n")));
    for (const directory of [
      "dist",
      "build",
      "coverage",
      ".next",
      ".codepatrol",
      "node_modules",
      "vendor",
    ]) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "generated.md"), "generated artifact\n");
    }
  }
  if (behavior === "slow" && request.stage === "spec")
    await new Promise((resolve) => setTimeout(resolve, 400));
  response = {
    protocolVersion: "1.0",
    status: behavior === `fail-${request.stage}` ? "failed" : "passed",
    summary: `Fixture ${request.stage}`,
    artifacts:
      request.stage === "build"
        ? ["BUILD.txt"]
        : ["spec", "plan"].includes(request.stage)
          ? [`${request.stage}.md`]
          : [],
    ...(request.stage.endsWith("-review") && behavior !== "missing-approved"
      ? { approved: behavior !== `reject-${request.stage}` }
      : {}),
    ...(behavior === "reject-ship" && request.stage === "ship"
      ? { approved: false }
      : {}),
    ...(behavior === "usage"
      ? { usage: { inputTokens: 12, outputTokens: 5, costUsd: 0.001 } }
      : {}),
    ...(behavior === "memory" && request.stage === "spec"
      ? {
          memories: [
            {
              content: "The fixture established a durable CodePatrol memory boundary.",
              category: "decision",
              importance: 4,
              tags: ["fixture"],
              entities: ["CodePatrol"],
            },
          ],
        }
      : {}),
  };
  if (behavior === "artifact-seeds" && request.stage === "spec")
    response.artifacts = [
      "spec.md",
      "escape.md",
      "../outside.md",
      "C:evil",
      "a*b",
      "missing.md",
      "dist/generated.md",
      "build/generated.md",
      "coverage/generated.md",
      ".next/generated.md",
      ".codepatrol/generated.md",
      "node_modules/generated.md",
      "vendor/generated.md",
      ...extraArtifacts,
    ];
} else if (mode === "echo") response = request;
else throw new Error(`Unknown fixture mode: ${mode}`);
if (behavior === "bad-version") response.protocolVersion = "2.0";
if (behavior === "bad-digest") response.digest = "0".repeat(64);
process.stdout.write(JSON.stringify(response));
