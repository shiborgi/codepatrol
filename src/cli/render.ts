import type { Work } from "../core/work.js";

/**
 * Presentation for the CLI: how a value is shown, never what it means. Nothing
 * here reads state, decides policy, or writes anything.
 */

export function renderImprovementReport(report: Record<string, unknown>): string {
  const scope = report.scope as Record<string, unknown>;
  const scopeText =
    Object.keys(scope).length > 0
      ? ` (${Object.entries(scope)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")})`
      : "";

  const works = report.works as Record<string, number>;
  const attempts = report.attemptsByStage as Record<string, number>;
  const returns = report.returns as Record<string, number>;
  const repeated = report.repeatedAttempts as { work: string; stage: string; attempts: number }[];
  const durations = report.durations as Record<string, { samples: number; averageMs: number; medianMs: number }>;

  let lines = `Improvement report${scopeText}\n`;
  lines += `Observed at: ${report.observedAt as string}\n\n`;

  lines += `Works\n`;
  lines += `  scoped:             ${works.scoped}\n`;
  lines += `  withActivity:       ${works.withActivity}\n`;
  lines += `  acceptedInWindow:   ${works.acceptedInWindow}\n`;
  lines += `  rolledBackInWindow: ${works.rolledBackInWindow}\n`;
  lines += `  currentlyActive:    ${works.currentlyActive}\n\n`;

  lines += `Attempts by stage\n`;
  for (const stage of ["plan", "review", "build", "verify", "ship"]) {
    lines += `  ${stage}: ${attempts[stage] ?? 0}\n`;
  }
  lines += "\n";

  lines += `Returns\n`;
  for (const key of ["reviewToPlan", "buildToPlan", "verifyToBuild", "verifyToPlan"]) {
    lines += `  ${key}: ${returns[key] ?? 0}\n`;
  }
  lines += "\n";

  if (repeated.length > 0) {
    lines += `Repeated attempts\n`;
    for (const entry of repeated) {
      lines += `  ${entry.work} ${entry.stage}: ${entry.attempts} attempts\n`;
    }
    lines += "\n";
  }

  if (Object.keys(durations).length > 0) {
    lines += `Durations\n`;
    for (const stage of ["plan", "review", "build", "verify", "ship"]) {
      const entry = durations[stage];
      if (entry !== undefined) {
        lines += `  ${stage}: ${entry.samples} samples, avg ${entry.averageMs}ms, median ${entry.medianMs}ms\n`;
      }
    }
    lines += "\n";
  }

  return lines;
}

export function summarizeWork(work: Work): Record<string, unknown> {
  return {
    id: work.id,
    title: work.title,
    workType: work.workType,
    priority: work.priority,
    state: work.workflow.state,
    stage: work.workflow.stage,
    specRevision: work.specRevision,
    blockedBy: work.blockedBy,
    completion: work.completion,
  };
}
