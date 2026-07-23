# Domain Glossary

**Public Workflow** — one of Plan, Review, Apply, Verify, Finalize or Status.

**Codepatrol Plan** — creates or resumes one branch-backed Change and produces a
decision-complete specification and executable plan. _Avoid_: proposal package.

**Codepatrol Review** — adversarially judges the current Plan attempt and either
approves it or returns the Change to Plan. _Avoid_: silent plan correction.

**Codepatrol Apply** — executes only the approved current attempt and produces a
clean candidate checkpoint. _Avoid_: unguarded implementation.

**Codepatrol Verify** — independently audits the candidate commit/tree and
advances to Finalize or returns the defect. _Avoid_: trusting the Apply journal.

**Codepatrol Finalize** — executes an explicitly authorized terminal commit or
rollback and leaves a recoverable tag plus clean target checkout.

**Codepatrol Status** — reproduces the deterministic Kanban and projected resume
actions without interpreting or mutating them.

**Change** — the tracked `.codepatrol/changes/<work-id>/` aggregate containing
immutable identity, ordered events and stage-owned artifacts for one branch.

**Stage Attempt** — one append-only Plan, Review, Apply, Verify or Finalize
attempt, including every run and its metrics.

**Stage Session** — disposable task progress under
`.codepatrol/runtime/sessions/` for exactly one attempt. It never owns lifecycle.

**Terminal Outcome** — `committed` or `rolled-back`, always preserved by a
`codepatrol/<outcome>/<work-id>` Git tag.

**Approve / Fix-first / Rework** — Review verdicts. Approve advances; the other
two return to Plan with recorded findings.

**Commit verdict** — Verify result declaring the exact candidate eligible for
Finalize; it is not authority to integrate automatically.

**Support Skill** — a bounded capability invoked behind a Public Workflow.

**Distribution Adapter** — a harness-specific presentation/capture layer with
no independent lifecycle semantics.

**Rejected Integration Surface** — hosted agent runtimes, provider memory,
external issue trackers and remote Git automation remain outside the local-only
contract unless a future Change explicitly adopts them.
