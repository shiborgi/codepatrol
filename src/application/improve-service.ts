import type { StateStore } from "../adapters/state-store.js";
import { fail } from "../core/errors.js";
import { deriveReport, type ImprovementReport } from "../core/improvement.js";

export class ImproveService {
  constructor(
    private readonly store: StateStore,
    private readonly now: () => string,
  ) {}

  async inspect(input: { initiative?: string; since?: string }): Promise<ImprovementReport> {
    const snapshot = await this.store.read();

    if (input.initiative !== undefined && !snapshot.initiatives.has(input.initiative)) {
      fail("NOT_FOUND", `initiative ${input.initiative} does not exist`);
    }

    if (input.since !== undefined) {
      const date = new Date(input.since);
      if (Number.isNaN(date.getTime())) {
        fail("INVALID_INPUT", `--since must be a valid ISO date, got ${JSON.stringify(input.since)}`);
      }
    }

    const works = [...snapshot.works.values()];
    return deriveReport(works, {
      ...(input.initiative !== undefined ? { initiative: input.initiative } : {}),
      ...(input.since !== undefined ? { since: input.since } : {}),
      now: this.now(),
    });
  }
}
