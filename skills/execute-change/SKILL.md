---
name: execute-change
description: (codepatrol) Execute one claimed task from an codepatrol-apply package using bounded mutation, test-first verification, assessment, and durable resume evidence. Use only behind codepatrol-apply.
---

# Execute Change

Execute exactly one claimed task from the currently approved package. Follow the [portable execution protocol](../_shared/EXECUTION.md), [artifact contract](../_shared/ARTIFACTS.md), [workflow contracts](../_shared/WORKFLOW.md), and [verification strategy](../verification-strategy/SKILL.md).

## Preconditions

- `codepatrol-apply` validated the current manifest for implementation.
- The task exists verbatim in the approved `plan.md`, its dependencies are closed, and the actor holds its workflow claim.
- File ownership, acceptance criteria, expected red/green signal, and governing spec/review are explicit.

If any precondition is false, do not mutate. Return the exact missing contract to `codepatrol-apply`.

## Execute

Read all files in scope and their graph neighbors before editing. For behavior change, run the specified check and observe the expected failure; a setup/typo failure does not count as red. For behavior-preserving refactoring, establish characterization coverage at the public seam.

The Apply contract invokes this skill with the single trigger `always-before-task-mutation` from `codepatrol-apply` and from itself for nested work. Apply decides when to invoke this skill based on the trigger table in `skills/catalog.yaml`; do not invoke a different support skill unless a catalog trigger is true.

Invoke [solution-simplification](../solution-simplification/SKILL.md) before mutation. Confirm the task still uses the approved ladder rung, reuses the declared local/platform capability, and introduces no surface absent from the plan. A simpler mechanical implementation within the same interface is allowed and recorded; a semantic simplification returns to review.

Make the smallest coherent change that satisfies the task. Do not redesign, bundle drive-by cleanup, weaken checks, change public behavior accidentally, or modify the approved spec/plan/review. Use [domain-modeling](../domain-modeling/SKILL.md) or [codebase-wiki](../codebase-wiki/SKILL.md) only when the approved task requires those project artifacts.

Run the targeted check to green, graph-affected tests, and the task's broader gate. Invoke [assess-change](../assess-change/SKILL.md) on the task diff. Fix verified blocking findings within task scope and rerun affected checks; scope-changing findings return to the primary workflow.

## Return evidence

Return changed paths, observed red signal, passing commands/results, assessment findings/corrections, deviations, risks, and the safe next action. `codepatrol-apply` appends this to `implementation.md`, records the manifest, and closes the claim only after verifying the evidence.
