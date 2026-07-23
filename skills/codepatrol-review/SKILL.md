---
name: codepatrol-review
description: (codepatrol) Review the Plan artifacts of an explicit branch-backed Change, record an auditable approve/fix-first/rework verdict, and return defects to Plan. Use for the Review stage; never edit production code.
---

# Codepatrol Review

Act as the Gatekeeper in [ROLES.md](../_shared/ROLES.md). Follow
[CHANGE.md](../_shared/CHANGE.md) and [SESSION.md](../_shared/SESSION.md).
Use the portable [execution protocol](../_shared/EXECUTION.md) for bounded evidence work.

Run `codepatrol change inspect --id <work-id>` and stop unless the checkout is
the recorded branch and the projection is Review. Capture run start, submit a
Review `begin` event when ready, and prime the exact Stage Session. To support
multiple parallel personas, the coordinator or agent may prime and claim
persona-specific session items (e.g., `review-security`, `review-architecture`).
When transitioning to Review, the harness MUST initialize a fresh context window
for the agent. The agent must not have access to the chat history of the Plan
stage, ensuring an unbiased, persona-driven evaluation based purely on artifacts.

Read the complete Plan specification, plan and declared evidence before inspecting code.

Re-check hashes, baseline, graph impact, cited files/interfaces/tests, external
evidence triggers, `CONTEXT.md` invariants, simplicity, acceptance coverage and
red capability. Invoke `assess-change`; use `research-technology` only when
external claims govern the design. Upstream conclusions are hypotheses.

Write only `.codepatrol/changes/<work-id>/review/report.md` (or persona-specific
reports like `review/report-security.md`) and declared Review evidence. Use
[REVIEW-FORMAT.md](REVIEW-FORMAT.md). Review never corrects Plan files in place:
bounded or material defects return to a new Plan attempt so stage ownership
and revision history remain explicit.

Record one finished Review run with elapsed time and measured or unavailable
tokens. Then choose exactly one route:

- `approve`: checkpoint Review with result `approve` and next action
  `codepatrol-apply <work-id> on codepatrol/<work-id>`;
- `fix-first` or `rework`: submit a `return` event to Plan with findings and an
  exact `codepatrol-plan` next action. If returning, all persona artifacts are attached.

Report the verdict, findings, branch/checkpoint and metric coverage. Do not
invoke Apply or edit production code.
