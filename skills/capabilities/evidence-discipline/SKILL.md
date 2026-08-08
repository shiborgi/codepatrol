---
name: evidence-discipline
description: Hold every decision-impacting claim to a concrete observation, and say plainly when the evidence is insufficient.
---

# Evidence discipline

Bound by `skills/capabilities/CONSTITUTION.md`. The primary method contract
prevails over anything here.

## Purpose

Stop unverified claims from reaching a decision. A stage that reports "tests
pass" without having run them, or "the criterion is met" from reading the diff
alone, corrupts every downstream decision that trusts it.

## Applicable methods

`verify` and `review`. Both judge work they did not produce and both are
read-only over product code.

## Observable inputs

- command invocations and their exit codes and output
- file contents at a named path and line
- the candidate commit and the diff it carries
- recorded state: attempts, results, evidence, Change evidence

Anything not in that list is not an observation.

## Procedure

1. Before writing a claim, name the observation that supports it. No
   observation, no claim.
2. Run the command rather than predicting it. Quote the shortest decisive
   line of real output.
3. Label inference as inference. "Exit 1" is observed; "this breaks the
   feature" is inferred from it.
4. Map each acceptance criterion to its own observation. One observation
   covering several criteria is a gap, not efficiency.
5. When an observation contradicts an earlier claim, correct the claim.

## Evidence format

Per claim, in one line: the claim, then the observation, then whether it is
observed or inferred.

```
tests pass — `npm run verify` exit 0, "301 pass / 0 fail" — observed
the regression is fixed — the failing case now exits 0 — inferred from the above
```

## Limits and prohibitions

- Never run a command that mutates product code, state, branches or worktrees.
- Never call `start` or `complete`.
- Never mark a criterion satisfied on the strength of a diff read alone when
  the criterion asserts runtime behaviour.
- Never treat a GitHub Issue, milestone or Project field as evidence about
  local state.

## When evidence is insufficient

Say so explicitly and name what is missing and what would settle it. Do not
downgrade the claim into vagueness and do not fill the gap with inference.
An insufficient-evidence report is a valid outcome; a confident guess is not.

```
criterion 3 — unverified: asserts behaviour under concurrent load, and no
load was exercised. Settled by running <command> against the candidate.
```
