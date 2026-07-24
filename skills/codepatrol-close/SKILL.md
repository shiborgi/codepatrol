---
name: codepatrol-close
description: (codepatrol) Close an explicitly selected verified branch-backed Change with an authorized fast-forward commit or recoverable rollback. Use only for the Close stage after a Verify commit verdict; leave the target checkout clean and valid.
---

# Codepatrol Close

Act as the Closer in [ROLES.md](../_shared/ROLES.md). Follow
[CHANGE.md](../_shared/CHANGE.md). This is the only lifecycle skill authorized
to integrate or discard a Change branch.
Use the portable [execution protocol](../_shared/EXECUTION.md) for preflight evidence.

Require the user to state the work id and exactly one action: `commit` or
`rollback`. Run `codepatrol change inspect --id <work-id>` and stop unless the
projection is Close, Verify recorded `commit`, the candidate binding is
intact, the checkout is the recorded branch, the tree is clean and the target
ref still equals the recorded base. Never infer authority from a prior stage.

Submit Close `begin`, capture run start, and perform the bounded preflight in
[CLOSE-FORMAT.md](CLOSE-FORMAT.md). Record a finished run with elapsed
time and measured or unavailable tokens. Then call `change close --id
<work-id> --input -` with the explicit action, actor and a concise authority
record.

Close owns only `.codepatrol/changes/<work-id>/close/receipt.md`, its
terminal event and the authorized local Git result.

For `commit`, the orchestrator writes the receipt/event, creates a recoverable
`codepatrol/committed/<work-id>` tag, switches to the unchanged target,
fast-forwards it and deletes the feature branch. For `rollback`, it creates
`codepatrol/rolled-back/<work-id>`, leaves the target tree byte-identical and
deletes the feature branch. Tag creation precedes deletion.

On target advance, dirty state, conflict or partial failure, stop with the exact
reported recovery action. Never fetch, push, rebase, force, resolve conflicts,
delete remote refs or edit production code. An opt-in `git push origin <target>`
is allowed when the outcome is `commit` and `push: true` is set. Report outcome, target SHA, tag,
receipt, metrics and clean-checkout validation.
