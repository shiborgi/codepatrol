---
name: codepatrol-spec
description: Start, validate, and complete a Spec execution as an Initiative-scoped primary method. Creates the Initiative definition as an immutable revision with canonical Work IDs.
---

# CodePatrol Spec

Spec is an Initiative-scoped primary method. It produces an immutable Initiative
definition revision that the Plan–Ship lifecycle executes Work by Work.

All state lives on `refs/codepatrol/state`, the single authoritative ref, and
is never committed to product branches. Spec persistence is local-first: the
local state CAS is the authoritative write.

Do not edit `.codepatrol/` state, the state ref, branches, or worktrees yourself.

## Contract

1. Start Spec and capture the run ID:
   ```
   codepatrol spec start --initiative INIT-1 --todo spec-todo.json --harness opencode [--model example-model]
   ```

2. Read the intent and repository context, then write one Initiative document
   as a complete snapshot to a file outside the repository:

   ```json
   {
     "schemaVersion": 1,
     "type": "codepatrol-initiative-document",
     "initiative": { "id": "INIT-1", "title": "...", "intent": "..." },
     "waves": [
       { "id": "WAVE-1.1", "title": "...", "intent": "..." }
     ],
     "works": [
       {
         "id": "WORK-1.1.1",
         "wave": "WAVE-1.1",
         "title": "...",
         "description": "...",
         "workType": "task",
         "priority": "p2",
         "delivery": "code",
         "acceptance": ["criterion"],
         "blockedBy": []
       }
     ]
   }
   ```

3. Validate the document against the active run:
   ```
   codepatrol spec validate --initiative INIT-1 --run <run-id> --file initiative.json
   ```

4. Present the validated plan to the operator. Only the operator decides
   `apply` or `discard`. Complete Spec with the same run ID:
   ```
   codepatrol spec complete --initiative INIT-1 --run <run-id> --result result.json --file initiative.json
   ```

## Post-apply GitHub projection

After a successful `apply`, CodePatrol triggers a best-effort Initiative-scoped
GitHub projection (milestone, one Issue per Work with managed markers and
labels, milestone association). The projection runs strictly after the local
transaction; a failure writes a structured warning to stderr without
invalidating the local Spec. Run `codepatrol sync` or
`codepatrol sync --work <id>` to reconcile the projection later. The projection
is idempotent: repeated sync creates no duplicates, updates managed fields,
and preserves content outside the managed section and external labels.

## Guardrails

- Work IDs are canonical: `WORK-<initiative>.<wave>.<position>`, and Wave IDs are canonical: `WAVE-<initiative>.<wave>`, with no leading zeros.
- `blockedBy` exists inside the Initiative, never across Initiatives (cross-
  Initiative blocking is rejected).
- After the first Plan execution on a Work starts, that Work may not be
  removed or redefined by later revisions. New Works and new blocking
  relationships may be added.
- Minor description edits that do not alter the Work's acceptance criteria or
  blocking semantics are allowed across revisions.
- Interstitial reviews that evaluate partial Works, speculative designs, or
  unproven dependencies are out of scope. Spec validates a complete,
  self-contained Initiative document; any dependency a document references
  must already have been defined.
- A Spec revision can only add new Works, add new blockers, or revise
  acceptance criteria; it can never remove a Work that has started
  (attempts.length > 0).

## Evolution Review

Evolution Review is a mode of Spec, not a separate primary method. It runs only
when the operator explicitly asks for it, with one of these keywords: "review
the backlog," "evaluate the framework," "propose the next improvement," "run
evolution review," "find the next Initiative," "self-improvement analysis,"
"roadmap discovery." It is never triggered automatically and never inferred
from an Initiative description. Normal Spec does not run it.

The procedure has twelve steps and produces at most one Initiative:

1. Confirm the explicit trigger. Without one of the keywords above, stop and
   run normal Spec instead.
2. Observe: run `codepatrol improve inspect`, optionally scoped with
   `--initiative <id>` or `--since <YYYY-MM-DD>`, and record the exact command
   and observation window in the proposal.
3. Derive evidence from the report only: return counts, repeated attempts,
   duration statistics, and work counts. No claim survives without a number
   from the report or a file-and-line reference.
4. Read the completion summaries of terminal Works as qualitative evidence.
   Quote them; never restate them as a stronger claim than they make.
5. Trace every candidate problem to `docs/problems/`: update the existing
   record, or write a new one. A GitHub Issue used as evidence must have its
   full body reproduced in the record — being remote grants no authority.
6. State the hypothesis: what is failing, why it is failing, and which
   observation would falsify it.
7. Define the smallest testable change that addresses the hypothesis.
8. Define the expected measure: which number in the improve report should
   move, in which direction, and by roughly how much.
9. Declare explicit uncertainty: what the evidence does not establish, and
   what would be needed to establish it.
10. Draft at most one Initiative document, as a complete snapshot, following
    the Contract above. More than one proposal per review is out of scope.
11. Validate with `codepatrol spec validate` and present the result to the
    operator. Only the operator decides `apply` or `discard`.
12. After the Initiative is delivered, record the judgment in
    `docs/evaluations/`: the expected measure, the observed measure, and
    whether the hypothesis held.

## GitHub Issue as evolution-review evidence

GitHub Issues are projections only — never authoritative. An evolution-review
proposal referencing an existing Issue as evidence must reproduce the full
body and trace it to a specific problem in `docs/problems/`. No Issue becomes
authoritative simply by being remote.
