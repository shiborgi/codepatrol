import { fail } from "../core/errors.js";
import type { Git } from "./git.js";

export interface CheckoutObservation {
  commit: string;
  clean: boolean;
  changes: string[];
}

export interface CheckoutPort {
  observe(): Promise<CheckoutObservation>;
}

export class GitCheckout implements CheckoutPort {
  constructor(private readonly git: Git) {}

  async observe(): Promise<CheckoutObservation> {
    const head = await this.git.exec(["rev-parse", "HEAD"], { allowFailure: true });
    if (head.code !== 0) {
      fail("INVALID_STATE", "cannot observe HEAD; run inside a git checkout with at least one commit");
    }
    const status = await this.git.exec(["status", "--porcelain=v1", "--untracked-files=all"]);
    const changes = status.stdout.split("\n").filter((line) => line.trim() !== "");
    return { commit: head.stdout.trim(), clean: changes.length === 0, changes };
  }
}

export function requireClean(observation: CheckoutObservation, context: string): void {
  if (!observation.clean) {
    fail(
      "INVALID_STATE",
      `${context} requires a clean checkout; changes: ${observation.changes.slice(0, 5).join(", ")}${observation.changes.length > 5 ? ", ..." : ""}`,
    );
  }
}
