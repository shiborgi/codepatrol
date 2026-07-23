---
name: codepatrol-apply
description: (codepatrol) Implement an explicitly selected branch-backed Change only after its current Plan attempt is approved. Use for the Apply stage to execute the accepted plan test-first, record evidence and produce a clean candidate checkpoint.
---

# Codepatrol Apply

Act as the Implementer in [ROLES.md](../_shared/ROLES.md). Follow
[CHANGE.md](../_shared/CHANGE.md), [SESSION.md](../_shared/SESSION.md), and
[execute-change](../execute-change/SKILL.md).
Use the portable [execution protocol](../_shared/EXECUTION.md) for bounded tasks.

Run `codepatrol change inspect --id <work-id>` before every new or resumed
mutation session. Stop unless the checkout is the recorded
`codepatrol/<work-id>` branch, the projection is Apply, the accepted Review
attempt says `approve`, and all accepted artifact hashes validate. Submit Apply
`begin` when ready, capture run start and prime/rebuild only the exact Apply
Stage Session.

Read the accepted spec, plan, review and evidence completely. If resuming after a return from Verify, explicitly read all markdown files in the `verify/` directory to aggregate and address all findings from all parallel personas. Execute tasks in
dependency order. Claim one session item before editing; establish its planned
red/characterization loop, make the minimum compliant change, run affected
checks, assess the result, append concise evidence to
`.codepatrol/changes/<work-id>/apply/journal.md`, and close the item only when
its acceptance passes. Preserve unrelated changes.

A semantic deviation, contract defect or materially different design returns
to Plan; do not hide it in the journal. External blockers use block/resume
events with an exact next action.

After every `AC-N` has passing evidence, reconcile actual surface delta,
refresh required graph/wiki/domain artifacts, and run the affected project
gate. Record one finished Apply run with elapsed time and measured or
unavailable tokens. Hash every Apply artifact and submit an Apply checkpoint
with result `implemented`, the complete list of production `changes`, and next
action `codepatrol-verify <work-id> on codepatrol/<work-id>`. The checkpoint
must leave a clean tree.

Report checks actually run, deviations, residual risks, checkpoint and metrics.
Do not invoke Verify, merge, push or close.
