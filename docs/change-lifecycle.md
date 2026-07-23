# Change lifecycle

One Change binds work id, `codepatrol/<work-id>` branch, target branch, base
commit, stage artifacts, attempt history, run metrics and terminal outcome.
`change.yaml` is append-only identity/events; every other lifecycle value is a
validated fold.

## Transitions

| Current | Successful result | Next | Return routes |
|---|---|---|---|
| Plan | `ready` | Review | — |
| Review | `approve` | Apply | `fix-first`/`rework` → Plan |
| Apply | `implemented` | Verify | contract defect → Plan |
| Verify | `commit` | Close | implementation defect → Apply; contract defect → Plan |
| Close | `committed` or `rolled-back` | terminal | target advance → stop |

A ready stage records `begin`; work records one or more usage events; a
successful stage records a checkpoint. Block/resume never changes ownership.
Returns create a new attempt and preserve all earlier evidence/cost.

## Git protocol

Start requires a clean trusted target checkout. Checkpoints use local commits
and exact expected refs. Verify binds candidate commit/tree. Close checks the
target has not advanced, creates receipt/event and terminal tag, then either
fast-forwards the target or proves rollback tree equality before deleting the
feature branch. Partial failure retains the branch or tag for explicit recovery.

No lifecycle operation performs network Git, rebase, force update or conflict
resolution.

## Metrics and board

Every run has timestamps, elapsed milliseconds and measured or unavailable
token usage. Stage and total views sum all attempts and display coverage. The
Kanban is a pure projection with fixed columns and stable sort/formatting; an
active clock changes output only with explicit `--as-of`.

## Bootstrap from v1

The `v1-release` implementation is independently verified before any cleanup.
Only a later explicit Close/cutover instruction may fast-forward `main`,
enumerate/remove historical `.codepatrol/packages/` and old ignored runtime,
verify the empty v2 board, commit cleanup, tag the cutover and delete local
`v1-release`. Failure to fast-forward stops the procedure.
