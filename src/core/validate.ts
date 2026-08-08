import { fail } from "./errors.js";
import { assertAcyclic } from "./graph.js";
import type { Initiative } from "./initiative.js";
import { assertReconstructionMatches } from "./reconstruct.js";
import type { Wave } from "./wave.js";
import { activeAttempt, type Work } from "./work.js";

export function validateState(
  initiatives: ReadonlyMap<string, Initiative>,
  waves: ReadonlyMap<string, Wave>,
  works: ReadonlyMap<string, Work>,
): void {
  for (const wave of waves.values()) {
    if (!initiatives.has(wave.initiative)) {
      fail("STATE_CORRUPT", `${wave.id} refers to missing initiative ${wave.initiative}`);
    }
  }
  for (const work of works.values()) {
    if (!initiatives.has(work.initiative)) {
      fail("STATE_CORRUPT", `${work.id} refers to missing initiative ${work.initiative}`);
    }
    const wave = waves.get(work.wave);
    if (wave === undefined) {
      fail("STATE_CORRUPT", `${work.id} refers to missing wave ${work.wave}`);
    }
    if (wave.initiative !== work.initiative) {
      fail(
        "STATE_CORRUPT",
        `${work.id} wave ${work.wave} belongs to initiative ${wave.initiative}, not ${work.initiative}`,
      );
    }
    for (const blocker of work.blockedBy) {
      const blockerWork = works.get(blocker);
      if (blockerWork === undefined) {
        fail("STATE_CORRUPT", `${work.id} depends on missing work ${blocker}`);
      }
      if (blockerWork.initiative !== work.initiative) {
        fail("STATE_CORRUPT", `${work.id} depends on ${blocker} from another initiative`);
      }
    }
    assertReconstructionMatches(work);
  }

  assertAcyclic([...works.values()]);

  // Concurrency is scoped to a Wave: many Works may be active at once, but
  // they all belong to the same Wave. State showing two Waves executing is
  // corrupt, not merely unusual.
  const activeWorks = [...works.values()].filter((work) => activeAttempt(work) !== undefined);
  const activeWaves = new Set(activeWorks.map((work) => work.wave));
  if (activeWaves.size > 1) {
    fail(
      "STATE_CORRUPT",
      `works of different waves have active attempts: ${activeWorks.map((work) => `${work.id} (${work.wave})`).join(", ")}`,
    );
  }

  const runIds = new Set<string>();
  for (const work of works.values()) {
    for (const attempt of work.attempts) {
      if (runIds.has(attempt.runId)) {
        fail("STATE_CORRUPT", `run id ${attempt.runId} appears more than once`);
      }
      if (attempt.runId.trim() === "") {
        fail("STATE_CORRUPT", `${work.id} has an attempt with an empty run id`);
      }
      runIds.add(attempt.runId);
    }
  }

  validateInitiatives(initiatives, works, runIds, activeWorks.length);
}

function validateInitiatives(
  initiatives: ReadonlyMap<string, Initiative>,
  works: ReadonlyMap<string, Work>,
  runIds: Set<string>,
  activeWorkCount: number,
): void {
  let activeSpecInitiative: string | undefined;

  for (const initiative of initiatives.values()) {
    if (initiative.definitionState === "draft") {
      const draft = initiative;
      if (draft.specRevisions.length > 0) {
        fail("STATE_CORRUPT", `${draft.id}: draft initiative must not have spec revisions`);
      }
      if (draft.currentSpecRevision !== null) {
        fail("STATE_CORRUPT", `${draft.id}: draft initiative must have null currentSpecRevision`);
      }
    } else {
      const defined = initiative;
      if (defined.currentSpecRevision === null) {
        fail("STATE_CORRUPT", `${defined.id}: defined initiative must have a currentSpecRevision`);
      }
      const lastRevision = defined.specRevisions[defined.specRevisions.length - 1];
      if (lastRevision === undefined || lastRevision.revision !== defined.currentSpecRevision) {
        fail("STATE_CORRUPT", `${defined.id}: currentSpecRevision does not match last revision`);
      }
      if (defined.specRevisions.length > 0) {
        for (let i = 0; i < defined.specRevisions.length; i += 1) {
          const expected = i + 1;
          if (defined.specRevisions[i]!.revision !== expected) {
            fail("STATE_CORRUPT", `${defined.id}: spec revision sequence gap at ${expected}`);
          }
        }
      }
      const owned = [...works.values()].filter((w) => w.initiative === defined.id);
      validateWorkRevisionInvariants(defined, owned);
    }

    for (const exec of initiative.specExecutions) {
      if (runIds.has(exec.runId)) {
        fail("STATE_CORRUPT", `spec run id ${exec.runId} conflicts with another run id`);
      }
      if (exec.runId.trim() === "") {
        fail("STATE_CORRUPT", `${initiative.id}: spec execution has empty run id`);
      }
      runIds.add(exec.runId);

      if (exec.status === "active") {
        if (exec.finishedAt !== undefined || exec.result !== undefined) {
          fail("STATE_CORRUPT", `${initiative.id}: active spec execution has finishedAt or result`);
        }
        if (exec.documentHash !== undefined || exec.appliedRevision !== undefined) {
          fail("STATE_CORRUPT", `${initiative.id}: active spec execution has documentHash or appliedRevision`);
        }
        if (activeSpecInitiative !== undefined) {
          fail("STATE_CORRUPT", `multiple active spec executions in ${activeSpecInitiative} and ${initiative.id}`);
        }
        activeSpecInitiative = initiative.id;
      } else {
        if (exec.finishedAt === undefined || exec.result === undefined) {
          fail("STATE_CORRUPT", `${initiative.id}: completed spec execution lacks finishedAt or result`);
        }
        if (exec.result.decision === "apply") {
          if (exec.documentHash === undefined || exec.appliedRevision === undefined) {
            fail("STATE_CORRUPT", `${initiative.id}: apply execution lacks documentHash or appliedRevision`);
          }
          const revision = initiative.specRevisions.find(
            (r) => r.runId === exec.runId && r.revision === exec.appliedRevision,
          );
          if (revision === undefined) {
            fail(
              "STATE_CORRUPT",
              `${initiative.id}: apply execution references non-existent revision ${exec.appliedRevision}`,
            );
          }
        } else {
          if (exec.documentHash !== undefined || exec.appliedRevision !== undefined) {
            fail("STATE_CORRUPT", `${initiative.id}: discard execution has documentHash or appliedRevision`);
          }
        }
      }
    }

    for (const revision of initiative.specRevisions) {
      const exec = initiative.specExecutions.find((e) => e.runId === revision.runId);
      if (exec === undefined) {
        fail(
          "STATE_CORRUPT",
          `${initiative.id}: revision ${revision.revision} points to missing execution ${revision.runId}`,
        );
      }
      if (exec.documentHash !== revision.documentHash) {
        fail("STATE_CORRUPT", `${initiative.id}: revision ${revision.revision} documentHash mismatch`);
      }
    }
  }

  if (activeSpecInitiative !== undefined && activeWorkCount > 0) {
    fail("STATE_CORRUPT", `spec and work are both active (initiative ${activeSpecInitiative})`);
  }

  // A Wave under execution counts as one primary method however many of its
  // Works are active; Spec counts as another, and the two never coexist.
  let activeCount = 0;
  if (activeSpecInitiative !== undefined) activeCount += 1;
  if (activeWorkCount > 0) activeCount += 1;
  if (activeCount > 1) {
    fail("STATE_CORRUPT", "multiple primary methods are active");
  }
}

function validateWorkRevisionInvariants(initiative: Initiative, works: Work[]): void {
  for (const work of works) {
    const revision = initiative.specRevisions.find((r) => r.revision === work.specRevision);
    if (revision === undefined) {
      fail("STATE_CORRUPT", `${work.id}: specRevision ${work.specRevision} not found in ${initiative.id} revisions`);
    }
    const workDef = revision.definition.works.find((w) => w.id === work.id);
    if (workDef === undefined) {
      fail("STATE_CORRUPT", `${work.id}: not found in defining revision ${work.specRevision} of ${initiative.id}`);
    }
    if (!workDefMatchesWork(workDef, work)) {
      fail("STATE_CORRUPT", `${work.id}: definition differs from defining revision ${work.specRevision}`);
    }
    const currentRevision = initiative.specRevisions[initiative.specRevisions.length - 1];
    if (currentRevision !== undefined) {
      const currentDef = currentRevision.definition.works.find((w) => w.id === work.id);
      if (currentDef === undefined) {
        fail(
          "STATE_CORRUPT",
          `${work.id}: not found in current revision ${currentRevision.revision} of ${initiative.id}`,
        );
      }
      const hasAttempts = work.attempts.length > 0;
      if (hasAttempts && work.specRevision !== currentRevision.revision) {
        if (!workDefsEqual(currentDef, revision.definition.works.find((w) => w.id === work.id)!)) {
          fail("STATE_CORRUPT", `${work.id}: started work changed in a later revision`);
        }
      }
    }
  }
}

function workDefMatchesWork(
  def: {
    id: string;
    title: string;
    description: string;
    workType: string;
    priority: string;
    delivery: string;
    acceptance: string[];
    blockedBy: string[];
  },
  work: Work,
): boolean {
  return (
    def.title === work.title &&
    def.description === work.description &&
    def.workType === work.workType &&
    def.priority === work.priority &&
    def.delivery === work.delivery &&
    acceptanceOrderEqual(def.acceptance, work.acceptance)
  );
}

function workDefsEqual(
  a: {
    title: string;
    description: string;
    workType: string;
    priority: string;
    delivery: string;
    acceptance: string[];
    blockedBy: string[];
  },
  b: {
    title: string;
    description: string;
    workType: string;
    priority: string;
    delivery: string;
    acceptance: string[];
    blockedBy: string[];
  },
): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.workType === b.workType &&
    a.priority === b.priority &&
    a.delivery === b.delivery &&
    acceptanceOrderEqual(a.acceptance, b.acceptance)
  );
}

function acceptanceOrderEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
