import { fail } from "./errors.js";
import { assertAcyclic } from "./graph.js";
import { activeAttempt, type Stage, type Work } from "./work.js";

/**
 * Orders Work ids canonically: initiative, then wave, then position. Every
 * component is compared numerically so `WORK-1.1.10` follows `WORK-1.1.2`.
 */
export function compareWorkIdsCanonically(a: string, b: string): number {
  const parts = (id: string): [number, number, number] => {
    const [, initiative, wave, position] = /^WORK-(\d+)\.(\d+)\.(\d+)$/.exec(id) ?? [];
    if (initiative === undefined || wave === undefined || position === undefined) {
      fail("INVALID_INPUT", `cannot order non-canonical work id ${JSON.stringify(id)}`);
    }
    return [Number(initiative), Number(wave), Number(position)];
  };
  const [ai, aw, ap] = parts(a);
  const [bi, bw, bp] = parts(b);
  return ai - bi || aw - bw || ap - bp;
}

function isTerminal(work: Work): boolean {
  return work.completion !== null;
}

function isAccepted(work: Work): boolean {
  return work.completion?.outcome === "accepted";
}

/**
 * Partitions the Works of a Wave into execution layers. Works in the same
 * layer have no dependency between them and may run simultaneously; layers are
 * serialized against each other.
 *
 * A blocker outside the Wave is a precondition, not a layer: no ordering
 * inside the Wave can satisfy it, so an unaccepted one refuses the whole
 * partition. Terminal Works belong to no layer — there is nothing left to run.
 */
export function waveExecutionLayers(waveId: string, works: Iterable<Work>): Work[][] {
  const all = [...works];
  const byId = new Map(all.map((work) => [work.id, work]));
  const inWave = all.filter((work) => work.wave === waveId).sort((a, b) => compareWorkIdsCanonically(a.id, b.id));
  if (inWave.length === 0) fail("NOT_FOUND", `wave ${waveId} has no works`);

  assertAcyclic(inWave);

  const pending = inWave.filter((work) => !isTerminal(work));
  const insideWave = new Set(inWave.map((work) => work.id));

  for (const work of pending) {
    for (const blockerId of work.blockedBy) {
      if (insideWave.has(blockerId)) continue;
      const blocker = byId.get(blockerId);
      if (blocker === undefined) fail("INVALID_STATE", `${work.id} depends on unknown work ${blockerId}`);
      if (!isAccepted(blocker)) {
        fail(
          "BLOCKED",
          `${work.id} cannot be layered: blocker ${blockerId} is outside wave ${waveId} and is ${blocker.completion?.outcome ?? blocker.workflow.state}`,
        );
      }
    }
  }

  const layers: Work[][] = [];
  const placed = new Set<string>();
  let remaining = pending;

  while (remaining.length > 0) {
    const layer = remaining.filter((work) =>
      work.blockedBy.every((blockerId) => {
        if (!insideWave.has(blockerId)) return true;
        if (placed.has(blockerId)) return true;
        const blocker = byId.get(blockerId) as Work;
        if (isAccepted(blocker)) return true;
        if (isTerminal(blocker)) {
          fail(
            "BLOCKED",
            `${work.id} cannot be layered: blocker ${blockerId} is terminal with outcome ${blocker.completion?.outcome}`,
          );
        }
        return false;
      }),
    );
    if (layer.length === 0) fail("CYCLE", `wave ${waveId} cannot be layered: its remaining works block each other`);
    for (const work of layer) placed.add(work.id);
    layers.push(layer);
    remaining = remaining.filter((work) => !placed.has(work.id));
  }

  return layers;
}

/**
 * The first layer that still has work to do at the given stage: the layer the
 * next wave-scoped command operates on.
 */
export function currentWaveLayer(waveId: string, works: Iterable<Work>, stage: Stage): Work[] {
  for (const layer of waveExecutionLayers(waveId, works)) {
    // A Work stands at the stage its attempt is running, or — when idle — at
    // the stage it waits for. A sibling running another stage belongs to that
    // stage's layer, never to this one.
    const pending = layer.filter((work) => {
      const live = activeAttempt(work);
      return live === undefined ? work.workflow.stage === stage : live.stage === stage;
    });
    if (pending.length > 0) return pending;
  }
  return [];
}

/** Exposed for reporting: the layer index each Work of the Wave sits in. */
export function waveLayerIndex(waveId: string, works: Iterable<Work>): Map<string, number> {
  const index = new Map<string, number>();
  waveExecutionLayers(waveId, works).forEach((layer, position) => {
    for (const work of layer) index.set(work.id, position);
  });
  return index;
}
