# Artifact handoff

Codepatrol separates the work of deciding, reviewing, implementing, and verifying so each step can run in a different harness or session. The portable boundary is one version-controlled directory:

```text
docs/codepatrol/<work-id>/
├── handoff.yaml
├── spec.md
├── plan.md
├── review.md
├── implementation.md
├── verification.md
└── evidence/
```

`codepatrol-plan` creates the normalized `spec.md` and `plan.md` contract. `codepatrol-review` validates it, makes auditable artifact corrections when one safe answer is supported, and approves an exact revision. `codepatrol-apply` refuses to execute anything other than a currently approved revision and records execution separately. `codepatrol-verify` then re-verifies that implementation independently and records a `commit` or `improve` verdict.

The spec carries a `Simplicity decision` so this intent also survives a harness handoff. It identifies the earliest solution rung that satisfies the acceptance criteria, evidence against earlier rungs, the retained safety floor, and expected surface delta. A deliberately deferred constraint is valid only with a stable id, known ceiling, observable trigger, and bounded upgrade path. The plan preserves that choice per task, review assesses it on a separate simplicity axis, and implementation reconciles actual surface delta without claiming unmeasured savings.

This package is deliberately independent of `.codepatrol/workflows/ledger.json`. The ledger is local operational memory and can be missing from a receiving checkout or session; the approved plan must contain enough information to reconstruct implementation tasks and dependencies.

## Why a directory per change

Flat date-named proposal, plan, and review files make consumers guess which files belong together. A review-only overlay forces the implementer to reconcile two competing specifications. Silent reviewer edits lose provenance. The chosen package keeps related files together, makes the manifest authoritative, and combines direct correction with an explicit review audit.

The `work-id` is `<YYYY-MM-DD>-<slug>` with a numeric suffix on collision. A package represents one independently reviewable change. A repository-wide architecture analysis can rank multiple candidates in `evidence/analysis.md`, but only one selected correction enters that package's `spec.md` and `plan.md`.

## Manifest and integrity

`handoff.yaml` schema v1 records:

- work id, producer skill, and producer mode;
- lifecycle status and governing revision;
- optional workflow id and target baseline metadata;
- paths and SHA-256 hashes for the spec, plan, review, implementation journal, verification report, and evidence;
- review verdict, reviewer, timestamp, and reviewed revision;
- verification verdict, verifier, timestamp, and verified revision.

The CLI provides two deterministic operations, `record` and `validate`, the latter across three stages:

```bash
codepatrol artifact record --manifest docs/codepatrol/<work-id>/handoff.yaml --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage review --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage implementation --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage verification --workspace "$PWD" --format json
```

`record` validates the package boundary and atomically writes hashes. `validate` is read-only. Review validation requires a complete, unchanged producer handoff. Implementation validation additionally requires `review.md`, verdict `merge`, and `approval.reviewed_revision` equal to the current governing revision. Verification validation requires status `implemented`, a declared `implementation.md`, and that same intact approval. Absolute paths, traversal, duplicate declarations, missing files, package-escaping symlinks, stale hashes, and invalid lifecycle data fail explicitly.

## Lifecycle and revision

```text
draft → ready-for-review → approved → implementing → implemented → verified
              ↘ changes-requested (from review or verification failure) ↗
              ↘ blocked
```

The governing revision covers `spec.md`, `plan.md`, and producer evidence. A reviewer who changes those files increments the revision and describes every change in `review.md`. Adding the review or implementation journal does not itself revise the proposal. The implementation harness treats every approved governing artifact as immutable.

`changes-requested` routes failed review or verification corrections back to Plan. `blocked` retains a valid approval while execution waits for an environmental or external condition. `implementation.md` is the append-only task, red/green evidence, deviation, and acceptance account; the approved plan contains no mutable progress checkboxes.

## Cross-harness example

1. Claude runs `codepatrol-plan`, commits `docs/codepatrol/2026-07-18-cache/`, and hands off status `ready-for-review`.
2. Codex validates hashes, reviews code evidence, corrects an interface and its task, increments revision 1 to 2, writes `review.md`, and commits status `approved` with `reviewed_revision: 2`.
3. Pi validates the approved package, reconstructs workflow tasks from `plan.md`, creates `implementation.md`, and executes only the ready dependency frontier.
4. If Pi finds material baseline drift, it records the evidence and returns the package to `changes-requested`; it does not redesign the interface locally.

Exact templates and harness rules live in [the shared artifact contract](../skills/_shared/ARTIFACTS.md).
