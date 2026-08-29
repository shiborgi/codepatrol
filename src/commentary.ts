import { auditContextSnapshot } from "./context-provider.js";
import type { Operation, PlanDocument, Source, State, Task, Wave } from "./core.js";

export type CommentKind = "todo" | "summary";
type CommentaryOperation = Operation | "ship";

export interface ProjectedCommentary {
  workId: string;
  kind: CommentKind;
  operation: CommentaryOperation;
  subject: string;
  round: number;
  body: string;
}

export function commentMarker(
  kind: CommentKind,
  operation: CommentaryOperation,
  subject: string,
  round: number,
): string {
  return `<!-- codepatrol:comment:${kind}:${operation}:${subject}:r${round} -->`;
}

export function renderTodo(
  operation: Operation,
  subject: string,
  round: number,
  lines: string[],
  next: string,
  sources: Source[],
): string {
  return [
    commentMarker("todo", operation, subject, round),
    `## CodePatrol ${stepName(operation)} - Round ${round}`,
    "Status: **Todo**",
    "",
    "### Todo",
    ...lines.flatMap((line) =>
      line.split("\n").map((part, index) => `${index === 0 ? "- [ ] " : "  "}${part}`),
    ),
    ...renderSources(sources),
    "",
    "### Next",
    `- ${next}`,
    "",
  ].join("\n");
}

export function renderSummary(
  operation: CommentaryOperation,
  subject: string,
  round: number,
  status: string,
  done: string[],
  next: string,
  sources: Source[],
): string {
  return [
    commentMarker("summary", operation, subject, round),
    `## CodePatrol ${stepName(operation)} - Round ${round}`,
    `Status: **${status}**`,
    "",
    "### Done",
    ...done.map((line) => `- ${line}`),
    ...renderSources(sources),
    "",
    "### Next",
    `- ${next}`,
    "",
  ].join("\n");
}

export function canonicalCommentary(state: State): ProjectedCommentary[] {
  const groups = new Map<
    string,
    {
      kind: CommentKind;
      operation: CommentaryOperation;
      subject: string;
      round: number;
      tasks: Task[];
    }
  >();
  for (const task of state.tasks) {
    const kinds: CommentKind[] = [];
    if (["plan", "build"].includes(task.operation)) kinds.push("todo");
    if (!["open", "preparing", "blocked"].includes(task.status)) kinds.push("summary");
    for (const kind of kinds) {
      const key = `${kind}:${task.operation}:${task.subjectId}:r${task.round}`;
      const group = groups.get(key) ?? {
        kind,
        operation: task.operation,
        subject: task.subjectId,
        round: task.round,
        tasks: [],
      };
      group.tasks.push(task);
      groups.set(key, group);
    }
  }
  for (const wave of state.waves) {
    if (!wave.ship) continue;
    const key = `summary:ship:${wave.id}:r${wave.buildRounds.at(-1)?.number ?? 1}`;
    groups.set(key, {
      kind: "summary",
      operation: "ship",
      subject: wave.id,
      round: wave.buildRounds.at(-1)?.number ?? 1,
      tasks: [],
    });
  }

  const result: ProjectedCommentary[] = [];
  for (const group of [...groups.values()].sort((a, b) =>
    `${a.kind}:${a.operation}:${a.subject}:r${a.round}`.localeCompare(
      `${b.kind}:${b.operation}:${b.subject}:r${b.round}`,
    ),
  )) {
    const tasks = [...group.tasks].sort(
      (a, b) =>
        a.id.localeCompare(b.id) ||
        (a.proposalId ?? "").localeCompare(b.proposalId ?? ""),
    );
    const waves = state.waves.filter(
      (wave) => wave.id === group.subject || wave.initId === group.subject,
    );
    const workIds = [...new Set(waves.flatMap((wave) => wave.workIds))];
    if (group.operation === "ship") {
      const wave = waves.find((candidate) => candidate.id === group.subject);
      if (!wave?.ship) continue;
      const body = renderSummary(
        "ship",
        wave.id,
        group.round,
        wave.ship.decision === "accept" ? "Accepted" : "Rolled Back",
        [
          `Ship decision: ${wave.ship.decision}.`,
          `Commit: ${wave.ship.candidateCommit}.`,
        ],
        wave.ship.decision === "accept"
          ? "Continue to the next Wave."
          : "Review the rollback and resume planning if needed.",
        [],
      );
      for (const workId of workIds) result.push(project(group, workId, body));
      continue;
    }
    const task = tasks[0];
    if (!task) continue;
    if (group.kind === "todo") {
      for (const wave of waves) {
        const plan = task.operation === "build" ? selectedPlan(state, wave) : undefined;
        const lines = wave.workIds.map((workId) => {
          const work = state.works.find((candidate) => candidate.id === workId);
          if (!work) return workId;
          if (plan) {
            const entry = plan.works.find((candidate) => candidate.workId === workId);
            return [
              `Work ${work.key}: ${work.title}`,
              ...(entry?.steps.map(
                (step) =>
                  `Step: ${step.summary} (Acceptance: ${step.acceptanceIds.join(", ")})`,
              ) ?? ["Step: no plan steps"]),
            ].join("\n");
          }
          return `${work.key}: ${work.title} (${work.acceptance.length} acceptance criteria)`;
        });
        const body = renderTodo(
          task.operation as "plan" | "build",
          group.subject,
          group.round,
          lines,
          task.operation === "plan" ? "plan-review" : "build-review",
          tasks.map((candidate) => candidate.source),
        );
        for (const workId of wave.workIds) result.push(project(group, workId, body));
      }
      continue;
    }
    const done = tasks.flatMap((candidate) => summaryDone(state, candidate));
    const resultValue = task.result as Record<string, unknown> | null;
    const decision =
      typeof resultValue?.decision === "string" ? resultValue.decision : "submitted";
    const next = nextStep(task.operation, decision);
    const body = renderSummary(
      task.operation,
      group.subject,
      group.round,
      "Submitted",
      done,
      next,
      tasks.map((candidate) => candidate.source),
    );
    for (const workId of workIds) result.push(project(group, workId, body));
  }
  return result;
}

function project(
  group: {
    kind: CommentKind;
    operation: CommentaryOperation;
    subject: string;
    round: number;
  },
  workId: string,
  body: string,
): ProjectedCommentary {
  return {
    kind: group.kind,
    operation: group.operation,
    subject: group.subject,
    round: group.round,
    workId,
    body,
  };
}

function summaryDone(state: State, task: Task): string[] {
  const result = task.result as Record<string, unknown> | null;
  const proposal = task.proposalId
    ? state.proposals.find((candidate) => candidate.id === task.proposalId)
    : undefined;
  const decision = typeof result?.decision === "string" ? result.decision : "submitted";
  const selected =
    typeof result?.selectedProposalId === "string"
      ? result.selectedProposalId
      : undefined;
  return [
    `Task ${task.id} submitted with ${decision}.`,
    ...(proposal ? [`Proposal ${proposal.id} recorded.`] : []),
    ...(selected ? [`Selected proposal: ${selected}.`] : []),
    ...(Array.isArray(result?.candidates)
      ? [
          `Verdicts: ${(result.candidates as Array<{ proposalId?: string; status?: string }>).map((candidate) => `${candidate.proposalId ?? "unknown"}=${candidate.status ?? "unknown"}`).join(", ")}.`,
        ]
      : []),
    ...(task.verification.length
      ? [`Verification: ${task.verification.map((item) => item.status).join(", ")}.`]
      : []),
    ...(task.fingerprint
      ? [
          `Configuration digest: ${task.fingerprint.configurationDigest}.`,
          ...(task.fingerprint.artifactDigest
            ? [`Artifact digest: ${task.fingerprint.artifactDigest}.`]
            : []),
          ...(task.fingerprint.agentDigest
            ? [`Agent digest: ${task.fingerprint.agentDigest}.`]
            : []),
          ...(task.fingerprint.agentInstructionsDigest
            ? [
                `Agent instructions digest: ${task.fingerprint.agentInstructionsDigest}.`,
              ]
            : []),
          ...(task.fingerprint.contextRequestDigest
            ? [`Context request digest: ${task.fingerprint.contextRequestDigest}.`]
            : []),
          ...(task.fingerprint.contextReportDigest
            ? [`Context report digest: ${task.fingerprint.contextReportDigest}.`]
            : []),
          ...(task.fingerprint.contextSectionDigests
            ? [
                `Context sections: ${task.fingerprint.contextSectionDigests.map((entry) => `${entry.section}=${entry.digest}`).join(", ")}.`,
              ]
            : []),
          ...(task.fingerprint.candidateCommit
            ? [`Candidate commit: ${task.fingerprint.candidateCommit}.`]
            : []),
          ...(task.fingerprint.candidateTree
            ? [`Candidate tree: ${task.fingerprint.candidateTree}.`]
            : []),
          ...(task.fingerprint.verificationOutputDigest
            ? [
                `Verification output digest: ${task.fingerprint.verificationOutputDigest}.`,
              ]
            : []),
        ]
      : []),
    ...(Array.isArray(result?.acceptance)
      ? [`Acceptance evidence: ${result.acceptance.length} item(s).`]
      : []),
    ...(task.contextSnapshots && task.contextSnapshots.length > 1
      ? [
          `Compared profiles: ${task.contextSnapshots.map((snapshot) => snapshot.profile).join(", ")}.`,
          ...task.contextSnapshots.map((snapshot) => {
            const audit = auditContextSnapshot(snapshot);
            return `Profile ${audit.profile}: ${audit.outputBytes} bytes, limited=${audit.limited}, omitted files=${audit.omittedFiles}, relations=${audit.omittedRelations}, snippets=${audit.omittedSnippets}, symbols=${audit.omittedSymbols}.`;
          }),
          ...(typeof result?.contextComparison === "object" &&
          result.contextComparison !== null &&
          typeof (result.contextComparison as { selectedContextProfile?: unknown })
            .selectedContextProfile === "string"
            ? [
                `Advisory context winner: ${(result.contextComparison as { selectedContextProfile: string }).selectedContextProfile}.`,
              ]
            : []),
        ]
      : []),
  ];
}

function selectedPlan(state: State, wave: Wave): PlanDocument | undefined {
  return wave.selectedPlanId
    ? (state.proposals.find((proposal) => proposal.id === wave.selectedPlanId)
        ?.document as PlanDocument | undefined)
    : undefined;
}

function renderSources(sources: Source[]): string[] {
  if (sources.length === 0) return [];
  return [
    "",
    "### Source",
    ...sources.map(
      (source) =>
        `- Harness: ${source.harness}; Model: ${source.model ?? "unspecified"}; Agent: ${source.agent ?? "unspecified"}`,
    ),
  ];
}

function nextStep(operation: Operation, decision: string): string {
  if (decision !== "approve") {
    if (operation === "spec-review") return "spec";
    if (operation === "plan-review") return "plan";
    if (operation === "build-review") return "build";
    return operation;
  }
  if (operation === "spec") return "spec-review";
  if (operation === "spec-review") return "plan";
  if (operation === "plan") return "plan-review";
  if (operation === "plan-review") return "build";
  if (operation === "build") return "build-review";
  return "ship";
}

function stepName(operation: CommentaryOperation): string {
  return operation
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
