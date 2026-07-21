---
name: codepatrol-review
description: (codepatrol) Review a proposal and plan artifact package or assess a diff, branch, or implemented change; correct governing artifacts when safe, record an auditable verdict, and never edit production code.
---

# Codepatrol Review

Review on contract and evidence axes. Act as the **Gatekeeper** defined in [ROLES.md](../_shared/ROLES.md): own the adversarial verdict and bounded governing-artifact corrections, never production code. Handoff review turns a producer package into an approved or changes-requested package; change review assesses a diff or branch against its governing package. It does not modify production code in either mode.

Follow the [artifact handoff contract](../_shared/ARTIFACTS.md), [workflow memory contract](../_shared/WORKFLOW.md), and [portable execution protocol](../_shared/EXECUTION.md). Start with `codepatrol status` to list open work; review only an explicitly chosen work id or change target, otherwise help the user identify one. Resume or create review memory so scope, evidence, findings, artifact adjustments, and next action survive interruption.

## Bind the review target

State one mode and identify exact inputs from content and user direction, never filename recency:

- **Handoff review** — `.codepatrol/work/<work-id>/handoff.yaml`, `spec.md`, `plan.md`, and declared evidence.
- **Change review** — exact diff, branch, ref range, or project checkout plus its governing artifact package. If no governing artifact exists, state the inferred contract and the resulting confidence limit.

For handoff review, begin with:

```bash
codepatrol artifact validate --manifest .codepatrol/work/<work-id>/handoff.yaml --stage review --workspace "$PWD" --format json
```

A structural or hash failure stops review until provenance is restored. Read the complete spec and plan before exploring code. Reconcile the declared baseline with current source; material drift is a finding.

## Execute in sequence

Follow exactly this eleven-step evidence order for handoff reviews:

1. **Resume** — Trigger: opening a package. Run `codepatrol status`, then `workflow prime` when review memory exists.
2. **Bind the target** — Trigger: target bound. Run `codepatrol artifact validate --stage review`; read `spec.md`, `plan.md`, and declared evidence completely before inspecting code.
3. **Mechanical floor** — Trigger: entering review. Run `codepatrol artifact validate --stage plan`. Every error it reports is a finding to record, not to re-derive. A green result proves format rules only.
4. **Ground truth** — Trigger: plan names paths or seams. Run `codepatrol graph sync`; `codepatrol graph impact --file <path>` on each file the plan names and `codepatrol graph neighbors --file <path>` on the seam it chooses; confirm the paths, interfaces, and tests the plan cites actually exist.
5. **Artifact currency** — Trigger: artifact structure present. Confirm every declared evidence file exists, is non-empty, and is actually cited by the spec; confirm `Substrate state` matches observed reality; confirm the revision was incremented if governing artifacts changed.
6. **External evidence sufficiency** — Trigger: external knowledge relied upon. Answer and record whether the planning gathered enough external input to specify this work. External evidence is required when the spec names a third-party technology, library, protocol, or service; adopts or adapts a pattern originating outside this repository; selects among externally-defined alternatives; claims that no existing solution fits; or a user-supplied reference exists. Record one of exactly three outcomes: `not required` (with reason), `required and sufficient` (naming the governing Reference Concept Analysis and the load-bearing claims checked), or `required and missing` (a finding). When a governing Reference Concept Analysis exists, invoke [research-technology](../research-technology/SKILL.md) to check its load-bearing claims against primary sources rather than inheriting them. When a trigger fired and no analysis exists, that is a finding, not a stylistic gap.
7. **Independent assessment** — Trigger: ready to evaluate. Invoke [assess-change](../assess-change/SKILL.md) for the full contract, code, and simplicity axes.
8. **Invariant cross-check** — Trigger: rules proposed. Independently state every rule the spec proposes against the `CONTEXT.md` terms it touches. Do not reuse the producer's cross-check.
9. **Executability audit** — Trigger: plan maps tasks. Per-`AC-N` acceptance coverage: unambiguous in spec, mapped to tasks, red-capable verification.
10. **Bounded corrections** — Trigger: safe fix known. Invoke [writing-plans](../writing-plans/SKILL.md) only when the evidence determines one safe answer; record every adjustment and increment the revision.
11. **Record and decide** — Trigger: all evidence gathered. Write `review.md` per format including a mandatory residual-concerns record (what you could not check and why any noted concern does not block). Choose one verdict, `artifact record`, then run `codepatrol artifact validate --stage implementation` as the exit gate.

## Adjust only governing artifacts

In handoff review, correct bounded defects directly in `spec.md` and `plan.md` when the evidence determines one safe answer. This is the only mutation this skill authorizes. It does not modify source, tests, generated runtime files, wiki pages, `CONTEXT.md`, or ADRs. When a bounded plan correction is safe, invoke [writing-plans](../writing-plans/SKILL.md) and record the adjustment in `review.md`.

Record every adjustment and its reason in `review.md` using [REVIEW-FORMAT.md](REVIEW-FORMAT.md). Increment `revision` whenever `spec.md`, `plan.md`, or producer evidence changes. Never make silent edits. If a missing decision requires product authority or materially different architecture, leave it unresolved and return `fix-first` or `rework` instead of guessing.

## Record the verdict

Write `.codepatrol/work/<work-id>/review.md`, add it to the manifest, and choose exactly one verdict:

- `approve`: the resulting revision is decision-complete and executable;
- `fix-first`: bounded corrections or evidence still remain;
- `rework`: the contract, architecture, or verification strategy is materially unsound.

For `approve`, set status `approved` and record `approval.verdict: approve`, `approval.reviewed_revision` equal to the current revision, reviewer, and timestamp. Record `steps.review` with your harness, model when known, and the ISO completion time, then run `artifact record` followed by:

```bash
codepatrol artifact validate --manifest .codepatrol/work/<work-id>/handoff.yaml --stage implementation --workspace "$PWD" --format json
```

Approval is complete only if it passes.

For `fix-first` or `rework`, set status `changes-requested`, record the non-approve verdict and next owner/action, run `artifact record`, then re-run review validation. Do not set a stale or conditional approval.

In change review, produce the same severity-ordered assessment and `approve`, `fix-first`, or `rework` verdict without modifying the target. Keep code findings separate from artifact drift and cite exact verified locations.

`merge` remains a deprecated alias for `approve`: manifests that record it will still validate, with a deprecation warning, but new reviews must use `approve`.
