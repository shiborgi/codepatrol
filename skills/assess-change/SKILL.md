---
name: assess-change
description: (codepatrol) Assess a proposal, plan, diff, branch, or implemented work item for contract compliance, correctness, risk, verification, and artifact drift. Use as the read-only assessment engine behind codepatrol-review and execute-change gates.
---

# Assess Change

Assess without editing. Consume the explicit [Change](../_shared/CHANGE.md) and produce severity-ordered findings with exactly one `approve`, `fix-first`, or `rework` conclusion.

## Bind evidence

Identify the exact target and governing artifact from content and explicit user direction, never filename recency. Enumerate the complete diff or artifact scope. Use graph impact and neighbors to band changed files as high, medium, or low risk; confirm ambiguous graph edges by reading.

## Contract axis

Check both directions:

- promised outcomes, interfaces, and acceptance criteria are delivered;
- delivered behavior is declared and within scope;
- proposal, plan, review report, wiki, domain language, and ADRs remain honest.

Record missing delivery separately from artifact drift.

## Code axis

Review highest risk first:

1. Correctness, invariants, error modes, cancellation, and data integrity.
2. Security and privacy where the change crosses trust seams.
3. Verification quality using the verification matrix: each behavior check must be capable of failing without the change.
4. Interface depth, locality, compatibility, performance, operability, and accessibility when relevant.
5. Undeclared scope, duplication, dead code, and drive-by changes.

Read every cited location. Findings from independent units are leads until the coordinator verifies them.

## Simplicity axis

Invoke [solution-simplification](../solution-simplification/SKILL.md) only when
the catalog trigger `always-before-assessment` is true. This is the single path
that invokes `solution-simplification` from assessment. Verify that the Change
chose the earliest sufficient ladder rung after understanding the real flow,
introduced no unjustified dependency, file, public interface, configuration,
or runtime state, and preserved every safety-floor requirement.

Classify excess as `remove`, `reuse`, `built-in`, `speculative`, or `simplify`. Each finding names the exact removable surface and safe replacement. Validate every deferred constraint's ceiling, observable trigger, and upgrade path. Report actual surface delta; never invent counterfactual savings.

## Result

Order findings by severity and render each as:

```text
<path>:<line> — <critical|major|minor> — <contract|code> — <problem>. <required correction>.
```

End with the risk table, delivered/partial/missing contract units, artifact drift, simplicity findings/surface delta, evidence gaps, and exactly one verdict:

- `approve`: no blocking finding and sufficient evidence;
- `fix-first`: bounded corrections can satisfy the contract;
- `rework`: the contract, architecture, or verification strategy is materially unsound.
