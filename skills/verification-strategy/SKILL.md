---
name: verification-strategy
description: (codepatrol) Design risk-based feedback loops and a verification matrix for a behavior change, refactor, bug fix, or plan. Use before implementation and when assessing whether tests and non-functional checks prove the intended outcome.
---

# Verification Strategy

Define the smallest reliable evidence that could falsify the change. Use the [Verification Matrix](../_shared/WORKFLOW.md#verification-matrix) contract and graph impact to include affected callers and tests.

## Choose the opening signal

- **Behavior change or bug:** write one minimal test that demands the intended behavior. Run it and confirm RED for the missing behavior or diagnosed root cause before implementation.
- **Behavior-preserving refactor:** add characterization tests at the interface that survives the move. They pass initially by design and must stay green.
- **Drift discovered during characterization:** treat the incorrect copy as a behavior bug and add a failing assertion before unifying it.
- **Non-code artifact:** define a deterministic validator, schema check, fixture comparison, or review assertion that fails on the current gap.

Exercise the real interface. Fake only unavailable outer systems, at their outermost seam. A test that bypasses the caller pattern does not prove the change.

## Build the matrix

For each outcome or material risk, record:

- expected behavior or invariant;
- risk and blast radius;
- feedback-loop command;
- expected red or characterization baseline;
- passing evidence;
- affected tests and non-functional checks;
- any evidence gap and its consequence.

Cover correctness first, then relevant security, reliability, data integrity, performance, operability, compatibility, and accessibility. Do not add categories unrelated to the actual change.

## Execute red-green-refactor

1. Run the focused signal and inspect the expected failure.
2. Implement the minimum behavior that can make it pass.
3. Re-run the focused signal and the graph-identified affected set.
4. Refactor without adding behavior while all checks remain green.
5. Record exact commands and results; manual observation is evidence only when the behavior cannot be automated yet, and the gap must be explicit.

No production behavior before a red test demands it. If production code was written first, remove that change and restart from the test. Do not claim safety from a passing suite that lacks a check capable of failing on the proposed behavior.
