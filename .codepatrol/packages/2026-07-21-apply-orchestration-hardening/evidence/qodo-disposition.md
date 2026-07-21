# Qodo review disposition — 2026-07-21

This file records the disposition for each comment raised by the Qodo review of the v1.0 release PR. Items are classified as `accept` (will be corrected by this package), `reject` (false positive against the current contract; recorded to prevent regression), or `reinterpret` (the original Qodo concern is valid but the correction is different from what Qodo proposed). The class is bound to the specific verified location and to the planned correction; nothing here changes the verdict vocabulary or the parser contract.

| # | Qodo concern | Verified location | Class | Planned correction | Corrected by |
|---|---|---|---|---|---|
| 1.1 | Orphan lock when write fails after open | `src/shared/lock.ts:30-69` | accept | Refactor lock to expose an internal `acquireLock` seam with an injected `LockIo`; cleanup branch unlinks only the current attempt's lock path on non-`EEXIST` failures; another owner's lock is never unlinked. | T1 |
| 1.2 | `symlinkSync` always uses `"dir"` even for files | `scripts/install-lib.mjs:178,237` | accept | Derive `linkType` from `lstat(source)`; thread through create, relink, uninstall, and rollback. Reject unsupported source kinds explicitly. | T2 |
| 2.1 | `nextAction?: string` should be required | `src/workflow/types.ts:37` | reinterpret (Qodo partially right, partially wrong) | Add a conditional runtime invariant: every non-closed item must carry a non-empty `nextAction`; closed items may omit it. Implemented as a single `assertNextActionInvariant` helper shared by the ledger validator and the create/update paths. Closing still removes the field. Closed records without `nextAction` remain valid. | T3 |
| 2.2 | `docs/wiki/` referenced as existing directory | `AGENTS.md`, `README.md`, `docs/smoke-tests.md` | reinterpret | Wiki is generated; the canonical guidance is "if the wiki is absent, run `codepatrol wiki status` and then `codepatrol wiki generate`." Reject the suggestion to commit a placeholder `index.md`. | T5 |
| 2.3 | Invalid finding categories | `REVIEW-FORMAT.md:20` | reject | The current `REVIEW-FORMAT.md` does not enumerate finding categories; `src/artifact/review-check.ts` does not parse them. Qodo's complaint references an older contract. | none (regression tombstone in `skills/skills-contract.test.mjs`) |
| 2.4 | `approve` verdict classified as violation | `REVIEW-FORMAT.md`, `src/artifact/review-check.ts` | reject | `approve` is the canonical verdict; `merge` is a deprecated compatibility alias. Weakening the parser to satisfy Qodo's external rule would silently change the contract. | none |
| 3.1 | Unpinned GitHub inspiration URLs | `skills/diagnose-bug/SKILL.md`, `skills/domain-modeling/SKILL.md`, `skills/grilling/SKILL.md` | accept | Pin to the exact revisions consulted on 2026-07-21 (`mattpocock/skills` `ed37663cc5fbef691ddfecd080dff42f7e7e350d`, `obra/superpowers` `d884ae04edebef577e82ff7c4e143debd0bbec99`, `Ponytail` `bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324`). | T5 |
| 3.2 | `peerDependencies: "*"` | `package.json:58-60` | accept | Narrow to `^0.80.8` (compatible with the installed dev version). | T5 |
| 4.1 | `Distribution Adapter` includes repository paths | `CONTEXT.md` | accept | Shorten to functional role; remove the `scripts/install-local.mjs`/`.pi/` references from the definition. | T5 |
| 4.2 | Missing `_Avoid_` on `Fix-first` and `Rework` | `CONTEXT.md` | accept | Add `_Avoid_` annotation with `reject`/`changes-requested` style names so each verdict carries its recommended-forbidden vocabulary. | T5 |

## Resolved Qodo items in this package

- 1.1: T1 corrects the orphan-lock failure path.
- 1.2: T2 corrects the symlink type derivation.
- 2.1: T3 enforces the conditional `nextAction` invariant without claiming a closed-record invariant that the type system cannot enforce uniformly.
- 2.2: T5 updates `README.md`/`AGENTS.md` guidance to reflect the wiki generation contract.
- 3.1: T5 pins the four external revisions to exact commit URLs.
- 3.2: T5 narrows the peer dependency.
- 4.1, 4.2: T5 corrects the glossary definition and adds the `_Avoid_` annotations.

## Rejected Qodo items

- 2.3 and 2.4 are rejected as false positives against the current parser and format. They are recorded in `review.md` and in the contract test for regression; do not change the parser or the verdict vocabulary.

## Resolved by this disposition, not the implementation

- 2.2's `AGENTS.md` is corrected; the product contract in `README.md` already documents the generation requirement, so the guidance change is a clarification, not a behavior change.
- The OpenCode command templates (`.opencode/commands/codepatrol-plan.md`, `codepatrol-review.md`) were corrected in T4 to use `.codepatrol/packages/` and `approve`/`fix-first`/`rework`; T5's linter rule for command-template coherence preserves this.
