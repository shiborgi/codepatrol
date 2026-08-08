---
name: independent-review
description: Forbid Review from ratifying the plan it received. Challenge missing coverage, hidden coupling, imprecise scope, and inappropriate delivery mode.
---

# Independent Review

Bound by `skills/capabilities/CONSTITUTION.md`. The primary method contract
prevails over anything here.

## Purpose

Review exists to challenge, not to ratify. A Review that merely agrees with
the Plan it received adds no value — it wastes a lifecycle stage. This
capability enforces the discipline: Review must identify and record at least
one challenge, or return the Work to Plan with a reason why no challenge
could be formed (meaning the Plan was either too vague to evaluate or
deliberately avoided leaving testable gaps).

## Applicable methods

`review` only.

## Observable inputs

- the Plan result (summary, todo, acceptance coverage claims)
- the Work definition (title, description, workType, priority, delivery, acceptance criteria, blockedBy)
- the CodePatrol state (other Works, their stages, their dependencies)
- the identified codebase area (files, modules, existing tests)

## What Review must challenge

1. **Missing acceptance coverage.** A criterion that cannot be verified or
   that rephrases the Work description rather than constraining behavior.
2. **Hidden coupling.** An assumption about another Work's completion,
   a shared mutable resource, or a side effect the Plan does not name.
3. **Imprecise scope.** A title or description broad enough to absorb
   unplanned changes without triggering a return to Spec.
4. **Inappropriate delivery mode.** A `no-code` Work that must produce a
   product change to satisfy its criteria, or a `code` Work whose criteria
   are purely observational.

## Procedure

1. Read the Plan result and the Work definition. Identify what the Plan
   claims to deliver and how it maps to each acceptance criterion.
2. For each of the four challenge areas, ask whether the Plan addresses
   it explicitly. A silent assumption is a gap.
3. Record each challenge concretely: the area, the specific Plan gap,
   and why it matters for downstream stages.
4. If the gap is severe (unverifiable criterion, missing dependency that
   would deadlock Build), the decision must be `return` to Plan with a
   concrete reason. Light gaps (ambiguous wording, missing but non-blocking
   evidence) may be recorded and carried forward with `continue`.

## Distinguishing recorded challenges from mandatory returns

| Severity | Decision | Record |
|----------|----------|--------|
| Unverifiable criterion or missing deadlocking dependency | `return` to Plan | Concrete gap, why it blocks, what the Plan must clarify |
| Ambiguous scope, missing non-blocking evidence | `continue` | Challenge recorded in the todo with a note; not blocking |

A recorded challenge is evidence that Review was exercised. A `continue`
without any recorded challenge is a self-contradiction — the reviewer found
nothing to improve yet chose not to return, which means the Plan was either
perfect (improbable) or the Review was perfunctory.

## When no challenge is found

Return to Plan with an explicit statement: the Plan was too vague to form a
concrete challenge, or the Plan deliberately scoped itself to avoid
testability. Either way, a Work that reaches Build without a Review
that challenged it has not been reviewed.

## Limits and prohibitions

- Never call `start` or `complete`.
- Never modify product code, state, branches, or worktrees.
- Never propose solution alternatives — that is the Plan's scope.
- Never silently agree. Every Review result must contain either a
  recorded challenge or an explicit return.

## Evidence format

Per challenge, in one line: the area challenged, the specific Plan gap, and
why it matters for downstream stages.

```
coverage gap — criterion 3 rephrases the description without constraining behaviour — Build cannot verify it
hidden coupling — Plan assumes WORK-1.2.1 is shipped but does not declare it as blockedBy — Build will deadlock
imprecise scope — title covers "and related improvements" — any change can be absorbed without Spec revision
delivery mismatch — no-code work requires a product file change per criterion 1 — must be code
```

## When evidence is insufficient

State what the Plan omitted and why it prevents forming a concrete challenge.
Return to Plan with the observation: the Plan was too vague to evaluate. Do
not invent gaps the Plan does not contain and do not downgrade a real gap
into vagueness to avoid returning.
