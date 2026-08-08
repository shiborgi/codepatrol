import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../application/sync-service.js";
import { fail } from "../core/errors.js";

/**
 * Optional repository configuration. Absent or disabled means the GitHub
 * Project projection is simply skipped; nothing else depends on it.
 */
export function loadProjectConfig(cwd: string): ProjectConfig | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(cwd, "codepatrol.json"), "utf8");
  } catch {
    return undefined;
  }
  const parsed = JSON.parse(raw) as { github?: { enabled?: boolean; project?: { owner?: unknown; number?: unknown } } };
  const github = parsed.github;
  if (github === undefined || github.enabled === false) return undefined;
  const project = github.project;
  if (project === undefined) return undefined;
  const owner = project.owner;
  const number = project.number;
  if (typeof owner !== "string" || owner.trim() === "" || typeof number !== "number" || !Number.isInteger(number)) {
    fail("INVALID_INPUT", "codepatrol.json: github.project requires a string owner and an integer number");
  }
  return { owner, number };
}
