---
name: acceptance-criterion-mapping
description: Bind every acceptance criterion of a Work to its own independent observation, and report the ones the environment cannot decide.
---

# Acceptance criterion mapping

Bound by `skills/capabilities/CONSTITUTION.md`. The primary method contract
prevails over anything here.

## Purpose

Stop aggregate coverage from passing as per-criterion verification. A Verify
that runs the suite once and declares every criterion satisfied cannot tell
the criterion the suite actually exercises from the one it never touches.

This is narrower than `evidence-discipline`, which demands an observation per
*claim*. This demands an observation per *criterion*, and treats one
observation stretched across several criteria as a gap rather than as
efficiency. Both may be loaded together: the first governs how a claim is
supported, this one governs the unit of accounting.

## Applicable methods

`verify` only. Verify is the single stage whose contract is to decide each
acceptance criterion of the Work.

## Observable inputs

- the Work's `acceptance` array, in the order the definition declares it
- command invocations against the candidate, with exit codes and output
- file contents at a named path and line, in the candidate
- the candidate commit and the diff it carries

Nothing else is an observation. A plan, a Build summary and a Review verdict
are claims by other stages, never evidence about this candidate.

## Procedure

1. Enumerate the criteria by index, in declaration order. Do not merge,
   reorder or reword them.
2. For each index, name the single observation that decides it.
3. Refuse reuse: if one observation is offered for two indices, at least one
   of them is unverified. Find its own observation or report it as such.
4. Prefer execution over reading. When a criterion asserts runtime behaviour,
   a diff read does not decide it.
5. When a criterion asserts something the environment cannot exercise, report
   it unverified under the section below — do not infer it from a neighbour.
6. Emit one line per index before stating an overall verdict.

## Evidence format

One line per criterion index: the index, the verdict, and the observation.

```
0 passed — `npm run verify` exit 0, "343 pass / 0 fail"
1 passed — skills/capabilities/x/ lists exactly capability.json and SKILL.md
2 unverified — asserts behaviour under a real remote; no remote was reached
```

An overall verdict is only valid after every index has its own line.

## Limits and prohibitions

- Never modify the candidate, product code, state, branches or worktrees.
- Never call `start` or `complete`; the method does that.
- Never add, drop or rewrite a criterion. Report a criterion that reads
  ambiguously; do not resolve the ambiguity by choosing a reading.
- Never mark a criterion passed on the strength of another criterion's
  observation.
- Never treat a GitHub Issue, milestone or Project field as evidence about
  local state.

## When evidence is insufficient

Report the criterion as `unverified`, naming what was missing and what would
decide it. An unverified criterion is a valid, useful outcome; a criterion
marked passed on inference is a corrupted decision that every later stage
inherits.

```
3 unverified — asserts the migration is idempotent, and the script was never
run twice. Decided by running it a second time against the migrated state.
```
