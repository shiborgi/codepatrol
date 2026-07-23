---
name: codepatrol-verify
description: (codepatrol) Independently verify the exact candidate checkpoint of an implemented branch-backed Change, audit acceptance and blast radius, and advance to Close or return defects. Use for the Verify stage; never edit production code.
---

# Codepatrol Verify

Act as the Auditor in [ROLES.md](../_shared/ROLES.md). Follow
[CHANGE.md](../_shared/CHANGE.md) and [SESSION.md](../_shared/SESSION.md).
Use the portable [execution protocol](../_shared/EXECUTION.md) for bounded verification.

Run `codepatrol change inspect --id <work-id>` for the explicit work id. Stop unless the checkout is its recorded branch,
the projection is Verify, the Apply checkpoint/tree is intact, the tree is
clean, and accepted artifacts validate. Submit Verify `begin`, capture run
start and prime the exact Stage Session. To support multiple parallel personas,
the coordinator or agent may prime and claim persona-specific session items (e.g.,
`verify-security`, `verify-architecture`). When transitioning to Verify, the
harness MUST initialize a fresh context window for the agent. The agent must not
have access to the chat history of the Apply stage, ensuring an unbiased,
persona-driven evaluation based purely on artifacts.

Read all Plan, Review and Apply artifacts; implementation claims are hypotheses.

Audit the diff against every task and `AC-N`; re-run focused checks, full
project gates, graph blast radius, regressions, unplanned changes, storage
taxonomy and Git/ref safety. Use `assess-change` and `verification-strategy`.
Write only `.codepatrol/changes/<work-id>/verify/report.md` (or persona-specific
reports like `verify/report-security.md`) and declared Verify evidence using
[VERIFICATION-FORMAT.md](VERIFICATION-FORMAT.md).

Record a finished Verify run with elapsed time and measured or unavailable
tokens. Choose exactly one route:

- `commit`: checkpoint Verify with result `commit`, binding the candidate
  commit/tree, and next action
  `codepatrol-close <work-id> commit|rollback on codepatrol/<work-id>`;
- implementation defect: return to Apply with an exact next action;
- contract defect: return to Plan with an exact next action.

If returning, ensure all persona-specific verification artifacts are attached.
Report evidence, findings, residual risks, candidate binding and coverage. Do
not edit production code, invoke Close, merge, push or delete refs.
