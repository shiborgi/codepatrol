---
name: codepatrol-verify
description: "(codepatrol) Deeply verify an implemented Codepatrol package after apply: re-check the plan, acceptance criteria, wider suite, blast radius, regressions, and unplanned changes, then record a commit or improve verdict with evidence. This skill never edits production code."
---

# Codepatrol Verify

Judge delivered work independently of the session that produced it. Act as the **Auditor** defined in [ROLES.md](../_shared/ROLES.md): own evidence-backed re-verification and the delivery verdict, never production edits. Review gates the contract before implementation; this skill gates the implementation before it is committed. It never edits production code.

Follow the [artifact handoff contract](../_shared/ARTIFACTS.md), [workflow memory contract](../_shared/WORKFLOW.md), and [portable execution protocol](../_shared/EXECUTION.md). Use [assess-change](../assess-change/SKILL.md) for the change assessment and [verification-strategy](../verification-strategy/SKILL.md) to judge whether a check could have failed.

## Stop rule (mandatory)

This skill is the auditor. After recording a `commit` or `improve` verdict in `verification.md` and sealing the artifact, **do NOT automatically invoke the next workflow** (no `git commit`, no push, no `codepatrol-plan` follow-up, no auto-advance to a sibling package). Stop and await user instruction. Verification ends with a verdict; the commit decision is the user's.

## Bind the verification target

Start with `codepatrol status` to list open work; verify only an explicitly chosen work id, otherwise help the user identify one. Never select by recency. On every new or resumed session run:

```bash
codepatrol artifact validate --manifest .codepatrol/packages/<work-id>/handoff.yaml --stage verification --workspace "$PWD" --format json
```

A structural failure, hash mismatch, non-`implemented` status, missing `implementation.md`, or stale approval stops verification until provenance is restored. Read `spec.md`, `plan.md`, `review.md`, `implementation.md`, and governing evidence completely before inspecting code. Resume or create workflow memory so scope, executed checks, findings, and the safe next action survive interruption.

## Re-verify independently

`implementation.md` records what the implementer believes happened. Treat every claim in it as a hypothesis and re-execute the evidence yourself; a recorded green result is not proof. Cover all seven duties:

- **Plan conformance** — audit the diff since `implementation.base_ref` task by task against `plan.md`. Every difference must be journaled and contract-preserving.
- **Acceptance criteria** — re-run every `AC-N` verification from the plan's acceptance mapping and observe the result directly.
- **Wider suite** — run the plan's final verification task and the full project gate: tests, types, lint, build, and the declared security, performance, accessibility, and operability checks. This is broader than the affected sets apply ran per task.
- **Blast radius** — query `codepatrol graph impact --since-ref <base_ref>` and confirm the affected callers and tests were actually exercised. Inspect impacted seams the plan did not name.
- **Regressions** — run affected tests beyond the changed files. Behavior drift at a surviving interface is a finding even when every suite passes.
- **Unplanned changes** — audit the complete diff against the spec's expected surface delta. Undeclared files, dependencies, public interfaces, configuration, or runtime state are findings.
- **Evidence and residual risks** — record exact commands, observed results, confidence, evidence gaps, and residual risks.

Independent read-only slices may split these duties per the execution protocol. Wait at the barrier, validate every reported finding against verified locations, resolve contradictions, and only then synthesize. Judge whether each check could have failed at all; a suite that cannot falsify the delivered behavior is an evidence gap, not passing evidence.

## Record the verdict

Write `.codepatrol/packages/<work-id>/verification.md` using [VERIFICATION-FORMAT.md](VERIFICATION-FORMAT.md), declare it as `artifacts.verification` in the manifest, and choose exactly one verdict:

- `commit`: every acceptance criterion passed independent re-verification and no blocking finding remains. Set status `verified` and record `verification.verdict: commit`, `verification.verified_revision` equal to the current revision, verifier, and timestamp.
- `improve`: one or more checks failed. Classify every blocking finding in `verification.md` as `implementation-defect` (delivered code/tests diverge from the still-correct approved contract) or `contract-defect` (spec, plan, or evidence is wrong or incomplete). If every finding is an implementation defect, set status `implementing` and return to `codepatrol-apply` with approval intact. If any finding is a contract defect, including a mixed set, set status `changes-requested` and return to `codepatrol-plan`. Ambiguity takes the stricter Plan route.

Run `artifact record` after writing the manifest and its `steps.verify` provenance stamp, then confirm the recorded state in the way that verdict allows. `--stage verification` is a pre-verdict gate that requires status `implemented`, so it cannot confirm a completed `commit`: for `commit`, rely on shape-valid `artifact record` output, which enforces that `verification.verdict` is `commit` and `verification.verified_revision` equals the current revision. For the `improve` transition, re-running `--stage verification` is expected to fail on the status rule alone, confirming the package left `implemented`; prove the return route separately with `--stage review` after the producer edits the plan. Never record a conditional, partial, or stale verdict, and never grant `commit` on unexecuted evidence.

This skill writes only `verification.md` and the manifest's verification metadata. It does not modify source, tests, generated runtime files, `spec.md`, `plan.md`, `review.md`, `implementation.md`, wiki pages, `CONTEXT.md`, or ADRs. Authorizing a commit is not performing one: report the verdict, the evidence, and the residual risks, and leave the commit to the user or project policy.
