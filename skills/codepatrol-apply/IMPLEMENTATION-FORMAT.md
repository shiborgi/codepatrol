# Implementation journal format

Create `.codepatrol/work/<work-id>/implementation.md` before the first code change. This is the append-only execution account; do not tick or rewrite the approved plan.

```markdown
# Implementation — <name>

- Package revision: <N>
- Approval: `review.md` verdict approve
- Target start ref: <Git ref or unborn>
- Actor: <harness>
- Status: implementing | blocked | implemented

## Baseline reconciliation

<Artifact validation result, target drift checked, and conclusion.>

## Task journal

### T1 — <task title>

- Claim/workflow item: <id>
- Started: <timestamp>
- Files changed: <paths>
- Simplicity check: <approved ladder rung still holds; reused capabilities and avoided speculative surface>
- Surface delta: <actual files, dependencies, public interfaces, configuration, and runtime state added/removed>
- Red evidence: <command and expected failure observed>
- Green evidence: <command and passing result>
- Assessment: <findings and corrections>
- Result: complete | blocked

## Deviations

<What differed from the plan. “None” is explicit. Semantic deviations require
status changes-requested and a return to review before more production edits.>

## Acceptance evidence

| Criterion | Implementation | Verification | Result |
|---|---|---|---|
| AC-1 | <paths/symbols> | <command/result> | pass |

## Surface delta

<Reconcile the total actual delta in files, dependencies, public interfaces,
configuration, and runtime state against the approved forecast. Explain every
difference and identify any activated `DC-N` trigger and upgrade path. Report
observed surface only, never unmeasured savings.>

## Final verification

<Affected checks, full relevant gate, graph/wiki/domain refresh, residual risks.>
```

Keep commands and concise results, not full logs. On interruption, update the current task, status, deviation/blocker, and safe next action in workflow memory before yielding.
