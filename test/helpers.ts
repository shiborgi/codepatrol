import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Config } from "../src/config.js";
import { Repository } from "../src/git.js";
import { CodePatrolService } from "../src/service.js";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export function fixture(
  agentCatalog?: Config["agentCatalog"],
  sharedPaths?: string[],
): {
  root: string;
  home: string;
  repo: Repository;
  service: CodePatrolService;
  config: Config;
} {
  const root = mkdtempSync(resolve(tmpdir(), "codepatrol-test-repo-"));
  const home = mkdtempSync(resolve(tmpdir(), "codepatrol-test-home-"));
  git(root, ["init", "-b", "main"]);
  writeFileSync(resolve(root, "README.md"), "fixture\n");
  writeFileSync(
    resolve(root, "codepatrol.json"),
    JSON.stringify({
      schemaVersion: 1,
      baseBranch: "main",
      verification: {
        argv: [process.execPath, "-e", "process.exit(0)"],
        timeoutMs: 10_000,
        ...(sharedPaths ? { sharedPaths } : {}),
      },
      maxReviewReturns: 3,
      ...(agentCatalog ? { agentCatalog } : {}),
    }),
  );
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "initial",
  ]);
  process.env.CODEPATROL_HOME = home;
  const config: Config = {
    schemaVersion: 1,
    baseBranch: "main",
    verification: {
      argv: [process.execPath, "-e", "process.exit(0)"],
      timeoutMs: 10_000,
      ...(sharedPaths ? { sharedPaths } : {}),
    },
    maxReviewReturns: 3,
    ...(agentCatalog ? { agentCatalog } : {}),
  };
  const repo = new Repository(root);
  return { root, home, repo, service: new CodePatrolService(repo, config), config };
}

export function commitCandidate(workspace: string, content: string): void {
  writeFileSync(resolve(workspace, "result.txt"), `${content}\n`);
  git(workspace, ["add", "result.txt"]);
  git(workspace, [
    "-c",
    "user.name=Builder",
    "-c",
    "user.email=builder@example.com",
    "commit",
    "-m",
    `candidate ${content}`,
  ]);
}

const SCORECARD_CATEGORIES: Record<string, string[]> = {
  "spec-review": [
    "intent-alignment",
    "scope-completeness",
    "work-slicing",
    "acceptance-testability",
    "domain-fit",
    "architectural-fit",
  ],
  "plan-review": [
    "acceptance-traceability",
    "executability",
    "technical-feasibility",
    "verification-strategy",
    "minimality",
    "architectural-fit",
  ],
  "build-review": [
    "acceptance-fulfillment",
    "plan-fidelity",
    "test-quality",
    "verification-evidence",
    "minimality",
    "repository-fit",
  ],
};

export function scorecardFor(
  operation: "spec-review" | "plan-review" | "build-review",
  proposalId: string,
  level = 50,
): {
  rubricVersion: string;
  assessments: Array<{
    category: string;
    level: number;
    rationale: string;
    evidenceRefs: string[];
  }>;
} {
  const categories = SCORECARD_CATEGORIES[operation];
  if (!categories) throw new Error(`no scorecard categories for ${operation}`);
  return {
    rubricVersion: `${operation.replace("-review", "")}-v1`,
    assessments: categories.map((category) => ({
      category,
      level,
      rationale: `Assessed ${category}`,
      evidenceRefs: [`proposal:${proposalId}`],
    })),
  };
}
