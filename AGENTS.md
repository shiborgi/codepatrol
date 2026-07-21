# AGENTS.md — Codepatrol development policy

> **Scope:** every harness working in this repository
> **Development model:** one canonical project, portable artifacts, and native workflow memory

## Sources of truth

- `README.md` is the functional product contract. Keep product behavior, public workflows, installation, and skill composition there.
- This file contains instructions for harnesses developing or using Codepatrol. Do not add product promises here that are absent from the README.
- `skills/catalog.yaml` is authoritative for primary/support roles, invocation edges, inputs, outputs, and mutation policy.
- `.codepatrol/packages/<work-id>/` is the durable interface between primary workflows. Decisions required by another harness belong in this package, not in conversation history.
- `.codepatrol/workflows/ledger.json` is resumable operational memory. It may be reconstructed from an artifact package and never replaces its governing specification, plan, review, or implementation journal.

Do not create or maintain a root progress file. Record active work, decisions, evidence, blockers, and safe next actions with the native workflow commands.

## Choose the primary workflow

Select exactly one entry point from the user's current intent:

| Intent | Primary workflow | Owned artifacts | Production mutation |
|---|---|---|---|
| New project, feature, architecture scan, or bug correction | `codepatrol-plan` | `handoff.yaml`, `spec.md`, `plan.md`, optional `evidence/` | never |
| Proposal package, diff, branch, or implemented change | `codepatrol-review` | `review.md`; auditable corrections to `spec.md`/`plan.md` when allowed | never production code |
| Approved current package revision | `codepatrol-apply` | `implementation.md`, production changes, refreshed project artifacts | authorized by approval |
| Implemented package awaiting a delivery verdict | `codepatrol-verify` | `verification.md`, manifest verification metadata | never production code |

Every primary workflow produces or updates its owned artifact before returning. Supporting skills do not create competing top-level workflows: they add evidence or bounded content to the package owned by the invoking primary workflow.

If the user explicitly requests an end-to-end result, execute the primary workflows in lifecycle order and honor every gate. A producer does not silently implement; review does not edit production code; implementation does not redesign an approved package.

## Canonical development model

Work in the repository and branch supplied by the user or environment. Do not create provider branches, harness-specific worktrees, duplicate candidate trees, freeze rounds, or comparison reports merely because a different harness performs a step. Harness identity does not determine filesystem layout or Git topology.

Different harnesses collaborate through the versioned artifact package and Git history. The same harness may perform several steps when requested, or separate harnesses may perform proposal, review, and implementation. The artifact contract is identical in both cases.

Native delegation is optional. Delegate only bounded units with explicit scope, dependencies, access mode, inputs, and evidence-bearing outputs. Independent read-only work or non-overlapping implementation tasks may run concurrently; otherwise use the sequential fallback. The coordinator verifies results at the barrier before synthesis.

## Artifact lifecycle

Use one directory per independently reviewable change:

```text
.codepatrol/packages/<work-id>/
├── handoff.yaml
├── spec.md
├── plan.md
├── review.md
├── implementation.md
└── evidence/
```

Use `<YYYY-MM-DD>-<slug>` and a numeric suffix on collision. Never select a package by recency when the user or governing artifact identifies one explicitly.

Lifecycle:

```text
draft → ready-for-review → approved → implementing → implemented
              ↘ changes-requested ↗       ↘ blocked
```

- Producers write a decision-complete `spec.md` and context-free `plan.md`, record hashes, validate the review stage, then stop at `ready-for-review`.
- Review validates incoming hashes before analysis. Any governing correction is recorded in `review.md`, increments the revision, and is reviewed as part of the resulting package.
- Approval applies only to the exact current revision with verdict `merge` and a matching `reviewed_revision`.
- Implementation validates the implementation stage before every new or resumed mutation session. A semantic deviation returns to review; it is never hidden in `implementation.md`.
- Run `artifact record` after intentional artifact changes and `artifact validate` at the relevant handoff gate. Never refresh hashes merely to conceal unexpected drift.

## Native memory and resume

At the start of known or potentially interrupted work, run:

```bash
codepatrol workflow prime --workspace "$PWD" --format json
```

Pass `--workflow-id` when the package or prior output provides one. Reconcile the result with Git and referenced artifacts; files and Git win over stale memory. If no ledger exists, create a workflow root and bounded tasks derived from the current objective or approved plan.

Checkpoint after meaningful decisions, verified evidence, blockers, artifact publication, test results, and before interruption. Keep the current item updated with a concrete `nextAction`. Use dependencies to expose the ready frontier, `workflow claim` before mutation, and `workflow close` only after acceptance and verification pass.

There are no mandatory phases or checkpoint counts. Do not store secrets, raw conversation, large logs, or full delegated responses. Store concise conclusions and paths to durable evidence. Another checkout may receive only the artifact package, so memory must never be the sole location of a governing decision.

## Investigation, design, and implementation rules

- Read applicable files and trace the real flow before proposing or changing it. Use graph impact/neighbors and wiki evidence where available; verify every cited location directly.
- For external technologies or GitHub references, pin the consulted revision, separate facts from inference and recommendation, and adapt concepts to the target project. Integration, dependencies, copied schemas, and compatible protocols require an explicit target-project decision.
- Prefer the earliest sufficient solution while preserving acceptance criteria and the safety floor. Record expected and actual surface delta rather than invented savings.
- During review, keep contract, code, simplicity, verification, and artifact-drift findings distinct. Return exactly one of `merge`, `fix-first`, or `rework`.
- Production changes require an approved package. Follow its task ownership and dependency order, establish a red-capable or characterization loop before mutation, run affected and broader gates, and append concise evidence to `implementation.md`.
- Preserve unrelated user changes. Do not use destructive Git or filesystem operations unless explicitly requested and the exact target has been verified.

## Completion

A producer is complete when the recorded package validates for review and contains no material ambiguity. A review is complete when its artifacts, revision, verdict, and next action are recorded and the appropriate validation passes. An implementation is complete when every acceptance criterion has passing evidence, actual surface delta is reconciled, relevant graph/wiki/domain artifacts are refreshed, the package is recorded, and status is `implemented`.

Before reporting completion, run every applicable typecheck, test, build, skill lint, package, and smoke gate. State commands actually run, residual risks, and the artifact package path. Commit, push, branch changes, releases, and external publication occur only when the user or repository policy explicitly requests them.

<!-- codepatrol:wiki:begin -->
## Project wiki

Start at `docs/wiki/index.md`. Use `codepatrol wiki status --format json` before trusting freshness.
<!-- codepatrol:wiki:end -->
