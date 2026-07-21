---
name: codepatrol-apply
description: (codepatrol) Implement a Codepatrol artifact package only after review approved its current revision. Validate the handoff, execute its plan test-first, record evidence and deviations, and support interruption-safe resume.
---

# Codepatrol Apply

Execute an approved proposal without inheriting the producer's conversation. Act as the **Implementer** defined in [ROLES.md](../_shared/ROLES.md): own bounded test-first mutation, never redesign the approved contract. The artifact package is the contract; operational workflow memory is rebuilt or resumed execution state.

Follow the [artifact handoff contract](../_shared/ARTIFACTS.md), [workflow memory contract](../_shared/WORKFLOW.md), and [portable execution protocol](../_shared/EXECUTION.md). Use [execute-change](../execute-change/SKILL.md) for each bounded mutation.

## Stop rule (mandatory)

This skill is the implementer. After sealing the `implementation.md` journal with status `implemented` and recording the artifact, **do NOT automatically invoke the next workflow** (`codepatrol-verify` or any other downstream skill). Stop and await user instruction. The decision to verify, and the choice of which harness runs the verification, belongs to the user.

## Validate before mutation

Identify the explicit `.codepatrol/packages/<work-id>/handoff.yaml`; never choose the newest package. Start with `codepatrol status` to list open approved work when the user has not named a work id. On every new or resumed session run:

```bash
codepatrol artifact validate --manifest .codepatrol/packages/<work-id>/handoff.yaml --stage implementation --workspace "$PWD" --format json
```

Stop before production edits unless all declared hashes match, status is `approved`, `implementing`, or resumable `blocked`, approval verdict is `approve` (or its deprecated alias `merge`), `approval.reviewed_revision` equals the manifest `revision`, and `review.md` is present. If status is `implemented`, report the existing result rather than execute twice. If resuming a verify-returned `implementing` package, read `verification.md`, validate the implementation stage, and rebuild only the affected workflow items; do not reopen the approved contract.

Read `spec.md`, `plan.md`, `review.md`, and governing evidence completely. Reconcile their target baseline with the current checkout, graph, dependencies, and affected tests. Material source drift, an invalid path/interface, a missing acceptance mapping, or an unresolved decision sets `changes-requested` and returns to `codepatrol-review`. This skill must not redesign the proposal.

## Establish resumable execution

Run `workflow prime` when the manifest's workflow id is available. If the ledger is absent or belongs to another harness, create a workflow root for this work id and translate every plan task into a bounded item with its dependencies, acceptance criteria, file ownership, and verification. The approved plan remains the source of truth.

For every deferred constraint whose later discovery matters, create a `deferred` workflow task that references its `DC-N` in `spec.md` and repeats the known ceiling, observable trigger, and bounded upgrade path. It must not enter the ready frontier until evidence shows that trigger occurred. The spec remains authoritative; this ledger item is only resumable operational memory, not a second debt contract.

Create `.codepatrol/packages/<work-id>/implementation.md` using [IMPLEMENTATION-FORMAT.md](IMPLEMENTATION-FORMAT.md), declare it in the manifest, set status `implementing`, record `steps.apply` with your harness, model when known, and the ISO completion time, then run `artifact record`. Do not modify approved `spec.md`, `plan.md`, producer evidence, or `review.md`.

## Execute the approved frontier

Query `workflow ready`, claim one item per actor, and invoke `execute-change`. Preserve task order and interface handoffs from the plan. Independent tasks may run concurrently only when their dependencies are closed and their write scopes do not overlap; sequential execution must produce the same artifacts and gates.

For behavior changes, observe the specified red signal before the minimum implementation and then green. For behavior-preserving work, record characterization evidence before refactoring. After each task, assess contract and code quality, run graph-identified affected checks, append concise red/green evidence and changed paths to `implementation.md`, close the workflow item, and re-record artifact hashes.

Do not opportunistically expand scope. A bounded mechanical deviation that preserves the contract is recorded in the journal. A semantic deviation, infeasible plan step, or correction to acceptance/interfaces changes status to `changes-requested`, records the evidence and safe next action, and stops for `codepatrol-review`. An external/environmental blocker sets `blocked` without discarding the approval.

## Complete honestly

After all tasks, map the per-task implementation and verification evidence to every `AC-N`. Re-run the graph-identified affected checks once as a closing signal, inspect the working tree for accidental leftovers such as temporary files or debug output, sync the graph, and refresh affected wiki/domain artifacts through the supporting execution workflow when required by the approved package.

Do not run the plan's final verification task and do not declare the change commit-ready. The full project gate, the final-diff and surface-delta audit, the blast-radius and regression sweep, and the commit decision belong to [codepatrol-verify](../codepatrol-verify/SKILL.md), which judges this work independently of the session that produced it.

Set `implementation.md` status and manifest status to `implemented` only when every accepted outcome has its per-task passing evidence and no blocking finding remains. Record the completed `steps.apply` stamp with the sealing time, run `artifact record`, close the workflow with artifact paths and evidence summary, and report delivered scope, deviations, commands/results, residual risks, and the package path. Stop with a recommendation to run `codepatrol-verify`; `implemented` is not a commit authorization.
