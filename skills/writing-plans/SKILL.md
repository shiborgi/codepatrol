---
name: writing-plans
description: (codepatrol) Convert a decision-complete Codepatrol specification into a context-free, dependency-ordered, test-first plan for an independent implementation harness. Also repair plan artifacts during review.
---

# Writing Plans

Write or repair `.codepatrol/changes/<work-id>/plan/plan.md` from the Change's `plan/spec.md`. Follow [PLAN-FORMAT.md](PLAN-FORMAT.md), the [Change contract](../_shared/CHANGE.md), [solution-simplification](../solution-simplification/SKILL.md), and [verification-strategy](../verification-strategy/SKILL.md).

Read the complete spec and governing evidence. For brownfield work, use graph
impact and verified source reads to name real paths, interfaces, callers, and
tests. A plan must be executable by another harness with the repository and
Change branch but no conversation history.

Decompose work into bounded tasks with explicit dependencies and non-overlapping ownership where possible. Map each `AC-N` to tasks and checks. Preserve the spec's selected simplicity rung; each task proves why it needs its new surface and reuses declared local/runtime/platform capabilities. Every behavior task names its red-capable feedback loop, expected failure, minimum implementation shape, green result, affected checks, and artifact updates. Every interface consumed by a later task is produced with exact names/types by an earlier task.

Do not create Stage Session items: Apply derives them after approval. Do not put execution checkboxes or mutable progress in the accepted plan; `apply/journal.md` and the rebuildable Stage Session own execution evidence. Stage checkpoint commits are created only by the Change orchestrator.

Before returning, audit paths, dependency order, acceptance coverage, setup prerequisites, migrations, rollback, security/operability checks, and expected command results. A plan with a material assumption or placeholder is not ready for review.
