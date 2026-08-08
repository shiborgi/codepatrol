import { fail } from "../../core/errors.js";
import type { Initiative } from "../../core/initiative.js";
import type { Wave } from "../../core/wave.js";
import { waveStatusOf } from "../../core/wave-status.js";
import type { Attempt, Work } from "../../core/work.js";

/**
 * How local state appears on GitHub: markers, titles, labels and the managed
 * sections of every projected body. Nothing here reads or writes anything —
 * the projection decides what to send, this decides what it looks like.
 */

export function initiativeMarker(id: string): string {
  return `<!-- codepatrol:initiative:${id} -->`;
}

export function waveMarker(id: string): string {
  return `<!-- codepatrol:wave:${id} -->`;
}

export function workMarker(id: string): string {
  return `<!-- codepatrol:work:${id} -->`;
}

export function runMarker(runId: string): string {
  return `<!-- codepatrol:run:${runId} -->`;
}

export const WORK_SECTION_START = "<!-- codepatrol:work:start -->";
export const WORK_SECTION_END = "<!-- codepatrol:work:end -->";
export const INITIATIVES_SECTION_START = "<!-- codepatrol:initiatives:start -->";
export const INITIATIVES_SECTION_END = "<!-- codepatrol:initiatives:end -->";

export function initiativeTitle(initiative: Initiative): string {
  return `${initiative.id}: ${initiative.definitionState === "defined" ? initiative.title : initiative.id}`;
}

export function waveTitle(wave: Wave): string {
  return `${wave.id}: ${wave.title}`;
}

export function wikiPageName(initiative: Initiative): string {
  return initiative.id;
}

export function renderInitiativesIndex(initiatives: Initiative[]): string {
  const lines = [
    "# Initiatives",
    "",
    "CodePatrol Initiatives projected from authoritative local state.",
    "",
    "## Index",
    "",
  ];
  for (const initiative of initiatives) lines.push(`- [[${wikiPageName(initiative)}]]: ${initiativeTitle(initiative)}`);
  return lines.join("\n").trimEnd();
}

export function spliceInitiativesSection(body: string, managed: string): string {
  const section = `${INITIATIVES_SECTION_START}\n${managed}\n${INITIATIVES_SECTION_END}`;
  const start = body.indexOf(INITIATIVES_SECTION_START);
  const end = body.indexOf(INITIATIVES_SECTION_END);
  if (start === -1 || end === -1 || end < start) {
    const outside = body.trimEnd();
    return outside === "" ? `${section}\n` : `${outside}\n\n${section}\n`;
  }
  return `${body.slice(0, start)}${section}${body.slice(end + INITIATIVES_SECTION_END.length)}`;
}

export function workTitle(work: Work): string {
  return `${work.id}: ${work.title}`;
}

export function workTypeLabel(work: Work): string {
  return `codepatrol:type/${work.workType}`;
}

export function workPriorityLabel(work: Work): string {
  return `codepatrol:priority/${work.priority}`;
}

export function isManagedLabel(label: string): boolean {
  return label.startsWith("codepatrol:type/") || label.startsWith("codepatrol:priority/");
}

export const LABEL_COLORS: Record<string, string> = {
  "codepatrol:type/bug": "d73a4a",
  "codepatrol:type/feature": "a2eeef",
  "codepatrol:type/task": "c5def5",
  "codepatrol:priority/p0": "b60205",
  "codepatrol:priority/p1": "d93f0b",
  "codepatrol:priority/p2": "fbca04",
  "codepatrol:priority/p3": "0e8a16",
};

export function renderWaveSection(wave: Wave, works: Work[]): string {
  const status = waveStatusOf(wave, works);
  const lines = [waveMarker(wave.id), "", `Initiative: ${wave.initiative}`, "", wave.intent, ""];
  if (status.works.length > 0) {
    lines.push("## Works", "");
    for (const work of works) lines.push(`- ${work.id}: ${work.title}`);
    lines.push("");
  }
  lines.push(`Complete: ${status.complete ? "yes" : "no"}`, "");
  if (status.verdict !== null) {
    lines.push(`Verdict: ${status.verdict.outcome} (${status.verdict.authority})`, "");
  }
  return lines.join("\n").trimEnd();
}

export function renderInitiativePage(initiative: Initiative, waves: Wave[], works: Work[]): string {
  const lines = [initiativeMarker(initiative.id), "", `# ${initiativeTitle(initiative)}`, ""];
  if (initiative.definitionState === "defined") {
    lines.push(initiative.intent, "");
    lines.push(`Spec revision: ${initiative.currentSpecRevision}`, "");
  }
  lines.push("## Waves", "");
  for (const wave of waves) {
    const owned = works.filter((work) => work.wave === wave.id);
    const done = owned.filter((work) => work.completion !== null).length;
    lines.push(`### ${waveTitle(wave)}`, "", wave.intent, "", `Works: ${done}/${owned.length} terminal`, "");
    if (wave.verdict !== null) lines.push(`Verdict: ${wave.verdict.outcome} (${wave.verdict.authority})`, "");
    for (const work of owned) lines.push(`- ${work.id}: ${work.title}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function renderManagedSection(work: Work): string {
  const lines = [
    workMarker(work.id),
    "",
    `Initiative: ${work.initiative}`,
    `Wave: ${work.wave}`,
    "",
    work.description,
    "",
  ];
  lines.push(`Spec revision: ${work.specRevision}`, "");
  if (work.acceptance.length > 0) {
    lines.push("## Acceptance criteria", "");
    for (const criterion of work.acceptance) lines.push(`- ${criterion}`);
    lines.push("");
  }
  if (work.blockedBy.length > 0) {
    lines.push(`Blocked by: ${work.blockedBy.join(", ")}`, "");
  }
  return lines.join("\n").trimEnd();
}

export function spliceManagedSection(body: string, managed: string): string {
  const section = `${WORK_SECTION_START}\n${managed}\n${WORK_SECTION_END}`;
  const start = body.indexOf(WORK_SECTION_START);
  const end = body.indexOf(WORK_SECTION_END);
  if (start === -1 || end === -1 || end < start) {
    const outside = body.trimEnd();
    return outside === "" ? `${section}\n` : `${outside}\n\n${section}\n`;
  }
  return `${body.slice(0, start)}${section}${body.slice(end + WORK_SECTION_END.length)}`;
}

export function renderRunComment(attempt: Attempt): string {
  const lines = [runMarker(attempt.runId), "", `### ${attempt.stage} attempt ${attempt.attempt}`, "", "#### Todo", ""];
  const results = new Map((attempt.result?.todo ?? []).map((entry) => [entry.id, entry]));
  for (const item of attempt.todo) {
    const result = results.get(item.id);
    const check = result?.status === "done" ? "x" : " ";
    const note = result?.note !== undefined ? ` — ${result.note}` : "";
    lines.push(`- [${check}] ${item.id}: ${item.title}${note}`);
  }
  if (attempt.result !== undefined) {
    lines.push("", "#### Result", "");
    lines.push(`- Decision: ${attempt.result.decision}`);
    if (attempt.result.returnTo !== undefined) lines.push(`- Return to: ${attempt.result.returnTo}`);
    if (attempt.evidence?.candidateCommit !== undefined) lines.push(`- Candidate: ${attempt.evidence.candidateCommit}`);
    if (attempt.result.acceptance !== undefined) {
      lines.push("", "#### Acceptance", "");
      for (const entry of attempt.result.acceptance) {
        lines.push(`- [${entry.status}] criterion ${entry.index}: ${entry.summary}`);
      }
    }
    lines.push("", attempt.result.summary, "");
  }
  return lines.join("\n");
}

export function findByMarker<T extends { body: string; number?: unknown; id?: unknown }>(
  objects: T[],
  marker: string,
  kind: string,
): T | undefined {
  const matches = objects.filter((candidate) => candidate.body.includes(marker));
  if (matches.length > 1) {
    const ids = matches
      .map((candidate) => {
        const id =
          typeof candidate.number === "number"
            ? candidate.number
            : typeof candidate.id === "number"
              ? candidate.id
              : undefined;
        return id !== undefined ? String(id) : "?";
      })
      .join(", ");
    fail(
      "CONFLICT",
      `multiple ${kind} carry marker ${marker} (${kind === "comments" ? "ids" : "numbers"} ${ids}); refusing to choose`,
    );
  }
  return matches[0];
}

export function assertNoDuplicateMarkers<T extends { body: string }>(objects: T[], marker: string, kind: string): void {
  findByMarker(objects, marker, kind);
}
