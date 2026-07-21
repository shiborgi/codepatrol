---
name: codepatrol-plan
description: "(codepatrol) Turn a project or feature idea, architecture assessment, or bug symptom into a self-contained, reviewable Codepatrol artifact package with a specification and executable plan. This skill does not implement production code."
---

# Codepatrol Plan

Turn intent or improvement scope into a decision-complete package. Act as the **Architect** defined in [ROLES.md](../_shared/ROLES.md): own the contract and plan, never implement production code. Produce the implementation contract; never implement it.

Follow the [artifact handoff contract](../_shared/ARTIFACTS.md), [workflow memory contract](../_shared/WORKFLOW.md), and [portable execution protocol](../_shared/EXECUTION.md). Use [codebase-design](../codebase-design/SKILL.md) for modules and seams, [domain-modeling](../domain-modeling/SKILL.md) for project language, and [grilling](../grilling/SKILL.md) for unresolved decisions.

## Establish or resume the proposal

Start with `codepatrol status` to list open work; resume only an explicitly chosen work id or workflow id, otherwise create a new package. Run `workflow prime` when operational memory exists; otherwise create a bounded proposal workflow. Reconcile memory with Git and durable artifacts. Record meaningful decisions, evidence, blockers, and safe next actions rather than fixed phases.

Select the origin mode at entry:

- **Propose codebase** (`origin.skill: propose-codebase`) — choose mode `project` for a new product or `feature` for a bounded addition.
- **Improve codebase** (`origin.skill: improve-codebase`) — choose mode `architecture` for a structural assessment or `bug` for a specific symptom, failure, or regression.

Create a collision-safe `docs/codepatrol/<work-id>/` package with `handoff.yaml` status `draft`. Record the target baseline and optional workflow id.

For codebase improvements (`improve-codebase`), sync the graph once and read the relevant wiki, `CONTEXT.md`, ADRs, modules, callers, and affected tests. For greenfield work (`project`), state assumptions instead of inventing code evidence. If the idea contains independently shippable systems, scope one independently reviewable package and make later systems explicit out-of-scope work.

## Resolve intent and evidence

Follow this evidence order; record an absent substrate rather than silently skipping it:

1. **Resume** — run `codepatrol status`, then `codepatrol workflow prime --workflow-id <id>` when operational memory exists.
2. **Ground truth** — run `codepatrol graph sync`, then `codepatrol wiki status`, then read `CONTEXT.md` and `docs/adr/`. Record the graph revision and wiki state as `present`, `stale`, or `absent` in the spec's Substrate state. For brownfield work, run `codepatrol graph impact --file <path>` on each file the plan intends to touch, `codepatrol graph neighbors --file <path>` on the chosen seam, and carry the affected test set into the spec and plan.
3. **Mode evidence** — invoke [diagnose-bug](../diagnose-bug/SKILL.md) in bug mode; perform the bounded structural assessment in architecture mode; state assumptions in greenfield mode.
4. **Technology evidence** — invoke [research-technology](../research-technology/SKILL.md) only when the user supplies a reference or local evidence cannot settle a choice.
5. **Domain model** — invoke [domain-modeling](../domain-modeling/SKILL.md) when a term is new, contested, or contradicts `CONTEXT.md`.
6. **Codebase design** — invoke [codebase-design](../codebase-design/SKILL.md) whenever the change adds or moves a module, interface, or seam; use design-it-twice for central interfaces.
7. **Design pressure** — invoke [grilling](../grilling/SKILL.md) when a load-bearing decision is still unsettled after step 6.
8. **Simplification** — invoke [solution-simplification](../solution-simplification/SKILL.md) on the recommended approach and each architecture correction candidate.
9. **Invariant cross-check** — state every rule the spec proposes against the `CONTEXT.md` terms it touches and record the result in Decisions and open questions.
10. **Portable package** — write `spec.md`, then invoke [writing-plans](../writing-plans/SKILL.md) to write `plan.md`.
11. **Producer gate** — run `artifact validate --stage plan`, then seal `ready-for-review` and stamp `steps.plan` only after it passes. A green plan-stage check proves structural format rules, not design correctness.

Establish purpose, users, outcomes, constraints, non-goals, failure modes, and observable acceptance criteria. Look up repository facts; ask the user only for decisions. No material question about scope, interface, trust, or acceptance may survive the handoff.

Collect and record the required evidence:

- **Bug mode** — investigate the symptom through [diagnose-bug](../diagnose-bug/SKILL.md), prove the root cause with a red-capable reproduction, minimize it, rank falsifiable hypotheses, and specify the minimum durable correction. Store the proven cause and correction constraints in `evidence/analysis.md`. Do not edit code or tests during diagnosis.
- **Architecture mode** — assess the complete system or a bounded structural scope, identify deepening opportunities, and select exactly one top candidate for correction. Write the modules, interfaces, and candidate ranking in `docs/codepatrol/<work-id>/evidence/analysis.md` using [MARKDOWN-REPORT.md](MARKDOWN-REPORT.md).
- **Technology reference** — when the user supplies a technology or GitHub reference, or local evidence cannot settle a choice, invoke [research-technology](../research-technology/SKILL.md). Store a durable `Reference Concept Analysis` under the package `evidence/` when it governs the design. Adapt concepts to the target project; direct integration or dependency requires its own explicit decision.

## Design the specification

Present two or three genuinely different approaches with trade-offs and a recommendation. Compare module depth, seam placement, data and trust boundaries, reliability, performance, operability, compatibility, accessibility when relevant, and verification cost. Use design-it-twice for central interfaces.

Invoke [solution-simplification](../solution-simplification/SKILL.md) on the recommended approach (and on the correction candidates when in architecture mode). Prefer eliminating or reusing behavior before new modules, dependencies, files, or configuration. Carry its evidence-backed `Simplicity Decision`, safety floor, surface delta, and trigger-bearing deferred constraints into the spec.

Write `docs/codepatrol/<work-id>/spec.md` using [SPEC-FORMAT.md](../_shared/SPEC-FORMAT.md). Record adopted, adapted, and rejected concepts. Remove placeholders, contradictions, ambiguous requirements, undeclared scope, and conversation-only decisions.

## Write the executable plan

Invoke [writing-plans](../writing-plans/SKILL.md) and write `docs/codepatrol/<work-id>/plan.md`. Every acceptance criterion must map to one or more dependency-ordered tasks, exact files and interfaces, red-capable checks, expected results, and final verification. Another harness with only the repository and package must be able to execute it without guessing.

Do not create the implementation task ledger here: `.codepatrol/workflows/` may not travel to the receiving harness. The implementer rebuilds it from the approved plan.

## Seal the handoff and stop

Declare `spec`, `plan`, and governing evidence (`evidence/analysis.md`, reference analyses, or bug reproducer) in `handoff.yaml`. Keep status `draft`, record the draft hashes, and run the deterministic content gate before sealing:

```bash
codepatrol artifact record --manifest docs/codepatrol/<work-id>/handoff.yaml --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage plan --workspace "$PWD" --format json
```

After it passes, set revision `1` and status `ready-for-review`, record `steps.plan` with your harness, model when known, and the ISO completion time, then record and validate the review handoff:

```bash
codepatrol artifact record --manifest docs/codepatrol/<work-id>/handoff.yaml --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage review --workspace "$PWD" --format json
```

Report the package path, work id, baseline, key risks, selected improvement or features, and recommendations to run `codepatrol-review`. `ready-for-review` is not implementation approval, and this skill never invokes execution or edits production code.
