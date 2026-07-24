---
name: codepatrol-plan
description: (codepatrol) Start or resume one branch-backed Change and turn a project, feature, architecture assessment, or bug symptom into a decision-complete specification and executable plan. Use for the Plan stage; never implement production code.
---

# Codepatrol Plan

Act as the Architect in [ROLES.md](../_shared/ROLES.md). Follow
[CHANGE.md](../_shared/CHANGE.md), [SESSION.md](../_shared/SESSION.md), and the
portable [execution protocol](../_shared/EXECUTION.md).

## Bind or start exactly one Change

If a work id is supplied, run `codepatrol change inspect --id <work-id>` and
continue only when the projection says Plan on branch
`codepatrol/<work-id>`. Otherwise require a clean trusted Git checkout and use
`change start --input -` with a collision-safe `YYYY-MM-DD-slug`, title, current
target branch, actor and exact Plan next action. The command creates and checks
out the feature branch. Never infer an id by recency.

Capture the run start time immediately. Prime the current Stage Session. For a
brownfield Change, sync the graph once, check wiki status, read `CONTEXT.md` and
`docs/adr/`, trace relevant modules/callers/tests and record absent substrates.
Use the appropriate supporting skills for bug diagnosis, domain language,
module/seam design, external evidence, simplification and executable planning.

If resuming after a return from Review or Verify, explicitly read all markdown files in the returning stage's directory (e.g., `review/` or `verify/`) to aggregate and address all findings from all parallel personas. The close stage now includes an opt-in push suggestion.

For a brownfield Change, also read the most recent `docs/codepatrol/improvement-reports/*.md` (sorted by file mtime, take the most recent) and surface its top three `Recommendations` bullets as `Improvement signals:` lines in the new spec's Intent section. If no mirror exists yet, record `Improvement signals: none — first Change on this workspace.` and continue.

## Produce the Plan artifacts

Write only:

- `.codepatrol/changes/<work-id>/plan/spec.md` using
  [SPEC-FORMAT.md](../_shared/SPEC-FORMAT.md);
- `.codepatrol/changes/<work-id>/plan/plan.md` using
  [PLAN-FORMAT.md](../writing-plans/PLAN-FORMAT.md);
- governing evidence beneath `plan/evidence/`.

The specification must settle scope, interfaces, invariants, failures,
rollout, risks and observable `AC-N` criteria. The plan must map every criterion
to dependency-ordered tasks, exact files/interfaces, red-capable checks and
expected results. Another harness must need no conversation history.

## Seal and stop

Record one finished Plan run with actual provider/harness tokens or explicit
`unavailable`, start/finish timestamps and elapsed milliseconds. Hash and
declare every Plan artifact, then submit a `checkpoint` transition with stage
`plan`, result `ready`, and exact next action
`codepatrol-review <work-id> on codepatrol/<work-id>`. The orchestrator creates
the checkpoint and advances the projection to Review.

Report the work id, branch, target/base, artifact paths, metrics coverage and
risks. Do not invoke Review or edit production code.
