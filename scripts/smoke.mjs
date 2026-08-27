import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary =
  process.env.CODEPATROL_BIN ?? resolve(packageRoot, "bin", "codepatrol.js");
const root = mkdtempSync(resolve(tmpdir(), "codepatrol-smoke-"));
const home = mkdtempSync(resolve(tmpdir(), "codepatrol-smoke-home-"));
const env = { ...process.env, CODEPATROL_HOME: home };
const resolver = resolve(home, "agent-resolver.mjs");
const contextProvider = resolve(home, "context-provider.mjs");
writeFileSync(
  resolver,
  `import { createHash } from "node:crypto";
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const instructions = "Smoke agent " + request.reference + "@" + request.version;
  const digest = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
  process.stdout.write(JSON.stringify({ schemaVersion: 1, agent: { reference: request.reference, name: "Smoke", version: request.version, digest: digest(request.reference) }, instructionsDigest: digest(instructions), instructions }));
});
`,
);
writeFileSync(
  contextProvider,
  `import { createHash } from "node:crypto";
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const stable = (value) => Array.isArray(value) ? "[" + value.map(stable).join(",") + "]" : value && typeof value === "object" ? "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ":" + stable(item)).join(",") + "}" : JSON.stringify(value);
  const digest = (value) => "sha256:" + createHash("sha256").update(stable(value)).digest("hex");
  const report = { schemaVersion: 1, provider: { name: "contextpatrol", version: "1.0.0" }, requestDigest: digest(request), target: { kind: request.target.kind, commit: request.target.kind === "commit" ? request.target.oid : "working-tree", dirtyDigest: digest([]), contentDigest: digest([]) }, budget: { maxOutputBytes: request.maxOutputBytes, outputBytes: 512, limited: false } };
  report.reportDigest = digest(report);
  process.stdout.write(JSON.stringify(report));
});
`,
);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function command(args, input) {
  const result = spawnSync(binary, ["--workspace", root, ...args], {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    env,
  });
  if (result.status !== 0) throw new Error(result.stderr || `${args.join(" ")} failed`);
  return JSON.parse(result.stdout);
}

function open(stage, subjectFlag, subjectId) {
  const result = command([
    stage,
    "open",
    subjectFlag,
    subjectId,
    "--harness",
    "smoke",
    ...(["spec", "plan", "build"].includes(stage)
      ? ["--agents", "agentpatrol/smoke@1.0.0"]
      : []),
  ]);
  const envelope = "tasks" in result ? result.tasks[0] : result;
  return { ...envelope.task, contextSnapshot: envelope.contextSnapshot };
}

function submit(taskId, result) {
  return command(["task", "submit", "--task", taskId, "--result", "-"], result).task;
}

function commitCandidate(workspace, value) {
  writeFileSync(resolve(workspace, "result.txt"), `${value}\n`);
  git(workspace, ["add", "result.txt"]);
  git(workspace, [
    "-c",
    "user.name=Smoke",
    "-c",
    "user.email=smoke@example.com",
    "commit",
    "-m",
    value,
  ]);
}

git(root, ["init", "-b", "main"]);
writeFileSync(resolve(root, "README.md"), "smoke\n");
writeFileSync(
  resolve(root, "codepatrol.json"),
  JSON.stringify({
    schemaVersion: 1,
    baseBranch: "main",
    verification: {
      argv: [process.execPath, "-e", "process.exit(0)"],
      timeoutMs: 10_000,
    },
    maxReviewReturns: 3,
    agentCatalog: {
      argv: [process.execPath, resolver],
      timeoutMs: 10_000,
      defaults: {},
    },
    contextPatrol: {
      argv: [process.execPath, contextProvider],
      timeoutMs: 10_000,
      profiles: {
        smoke: {
          facets: ["structure"],
          maxOutputBytes: 8_192,
        },
      },
      defaults: {
        spec: "smoke",
      },
    },
  }),
);
git(root, ["add", "."]);
git(root, [
  "-c",
  "user.name=Smoke",
  "-c",
  "user.email=smoke@example.com",
  "commit",
  "-m",
  "initial",
]);

const init = command(["init", "create", "--title", "Smoke", "--brief", "Full flow"]);
const specDocument = (name) => ({
  title: name,
  intent: "Complete the installed smoke test",
  waves: [
    {
      key: "delivery",
      title: "Delivery",
      works: [
        {
          key: "implementation",
          title: "Implementation",
          description: "Create the result",
          acceptance: ["The selected candidate reaches main"],
          blockedBy: [],
        },
      ],
    },
  ],
});
const specTaskA = open("spec", "--init", init.id);
if (specTaskA.contextSnapshot?.report?.budget?.maxOutputBytes !== 8_192)
  throw new Error("ContextPatrol snapshot was not attached to the task");
const specA = submit(specTaskA.id, specDocument("Spec A")).proposalId;
const specB = submit(
  open("spec", "--init", init.id).id,
  specDocument("Spec B"),
).proposalId;
const specReviewEnvelope = command([
  "spec-review",
  "open",
  "--init",
  init.id,
  "--harness",
  "smoke",
]);
const specAProposal = specReviewEnvelope.input.proposals.find(
  (proposal) => proposal.id === specA,
);
if (specAProposal?.contextProfile !== "smoke")
  throw new Error("submitted proposal did not record contextProfile provenance");
submit(specReviewEnvelope.task.id, {
  decision: "approve",
  selectedProposalId: specB,
  summary: "Select B",
  candidates: [
    { proposalId: specA, status: "passed", summary: "Valid" },
    { proposalId: specB, status: "passed", summary: "Best" },
  ],
});

const wave = command(["wave", "list"])[0];
const work = command(["work", "list"])[0];
const planDocument = (name) => ({
  works: [
    {
      workId: work.id,
      summary: name,
      steps: [{ summary: "Implement", acceptanceIds: [work.acceptance[0].id] }],
    },
  ],
  verification: "Run the configured command",
  openQuestions: [],
});
const planA = submit(
  open("plan", "--wave", wave.id).id,
  planDocument("Plan A"),
).proposalId;
const planB = submit(
  open("plan", "--wave", wave.id).id,
  planDocument("Plan B"),
).proposalId;
submit(open("plan-review", "--wave", wave.id).id, {
  decision: "approve",
  selectedProposalId: planB,
  summary: "Select B",
  candidates: [
    { proposalId: planA, status: "passed", summary: "Valid" },
    { proposalId: planB, status: "passed", summary: "Best" },
  ],
});

const buildTaskA = open("build", "--wave", wave.id);
commitCandidate(buildTaskA.workspace, "candidate-a");
const buildA = submit(buildTaskA.id, {
  summary: "Candidate A",
  works: [{ workId: work.id, summary: "Implemented" }],
}).proposalId;
const buildTaskB = open("build", "--wave", wave.id);
commitCandidate(buildTaskB.workspace, "candidate-b");
const buildB = submit(buildTaskB.id, {
  summary: "Candidate B",
  works: [{ workId: work.id, summary: "Implemented" }],
}).proposalId;
submit(open("build-review", "--wave", wave.id).id, {
  decision: "approve",
  selectedProposalId: buildB,
  summary: "Select B",
  candidates: [
    { proposalId: buildA, status: "passed", summary: "Valid" },
    { proposalId: buildB, status: "passed", summary: "Best" },
  ],
  acceptance: [{ id: work.acceptance[0].id, status: "passed", summary: "Verified" }],
});
command(["ship", "accept", "--wave", wave.id, "--confirm", "accept"]);

if (readFileSync(resolve(root, "result.txt"), "utf8") !== "candidate-b\n") {
  throw new Error("Ship did not select candidate B");
}
if (git(root, ["status", "--porcelain"]) !== "")
  throw new Error("Ship left main dirty");
process.stdout.write("CodePatrol smoke passed\n");
