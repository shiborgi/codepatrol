import { fail } from "./errors.js";
import { activeAttempt, type Work } from "./work.js";

export function assertAcyclic(works: readonly Work[]): void {
  const byId = new Map(works.map((work) => [work.id, work]));
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      fail("CYCLE", `dependency cycle detected: ${[...path, id].join(" -> ")}`);
    }
    const work = byId.get(id);
    if (work === undefined) return;
    visiting.add(id);
    for (const blocker of work.blockedBy) {
      visit(blocker, [...path, id]);
    }
    visiting.delete(id);
    done.add(id);
  };

  for (const work of works) visit(work.id, []);
}

export function unresolvedBlockers(work: Work, byId: ReadonlyMap<string, Work>): Work[] {
  const unresolved: Work[] = [];
  for (const blockerId of work.blockedBy) {
    const blocker = byId.get(blockerId);
    if (blocker === undefined) {
      fail("INVALID_STATE", `${work.id} depends on unknown work ${blockerId}`);
    }
    if (blocker.completion?.outcome !== "accepted") unresolved.push(blocker);
  }
  return unresolved;
}

export function assertBuildUnblocked(work: Work, byId: ReadonlyMap<string, Work>): void {
  const unresolved = unresolvedBlockers(work, byId);
  if (unresolved.length > 0) {
    const list = unresolved
      .map((blocker) => `${blocker.id} (${blocker.completion?.outcome ?? blocker.workflow.state})`)
      .join(", ");
    fail("BLOCKED", `${work.id} cannot build until blockers are accepted: ${list}`);
  }
}

/**
 * Execution is exclusive to one Wave at a time. Any number of Works inside the
 * Wave being executed may hold an active attempt simultaneously; a Work of a
 * different Wave may not start while that Wave holds the execution. The Work
 * itself is still limited to one active attempt, which `activeAttempt` decides
 * before this check runs.
 */
export function assertWaveScopedConcurrency(works: readonly Work[], starting: Work): void {
  for (const work of works) {
    if (work.id === starting.id) continue;
    if (activeAttempt(work) === undefined) continue;
    if (work.wave === starting.wave) continue;
    fail(
      "INVALID_STATE",
      `wave ${work.wave} holds the active execution (${work.id}); ${starting.id} belongs to ${starting.wave} and cannot start until it finishes`,
    );
  }
}
