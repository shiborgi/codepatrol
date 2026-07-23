# Stage Session contract

A Stage Session is disposable operational progress for exactly one Change
stage attempt. It lives at
`.codepatrol/runtime/sessions/<work-id>/<stage>/<attempt>.json` and may contain
bounded tasks, dependencies, claims, concise results, artifact paths and the
projected next action.

Prime it with `codepatrol change session --id <work-id> --input -`. Claim one
ready item before mutation and close it only after its acceptance evidence
passes. If the file is missing or corrupt, use action `rebuild`; the accepted
Change artifacts reconstruct it.

A session must never own lifecycle, revision, approval, terminal outcome,
project-wide decisions, conversations or logs. Losing it cannot change the
Change stage or invalidate a checkpoint.
