# Evaluations

An evaluation is the judgment written after a delivered Initiative, comparing
what the proposal expected to move with what the improve report actually shows.
It is step twelve of the Evolution Review procedure in
`skills/codepatrol-spec/SKILL.md`, and it is what keeps the evolution loop
honest: without it, a proposal is never wrong.

One evaluation per delivered Initiative, named `INIT-<number>.md`. An
evaluation is written after the Initiative reaches its terminal state, and is
never edited to agree with the outcome after the fact — a wrong prediction is
recorded as wrong.

## Record format

```markdown
# INIT-<number> — Title

- **Delivered:** YYYY-MM-DD
- **Problem:** the record in `docs/problems`, by number and slug
- **Hypothesis:** the claim the Initiative was built on
- **Expected measure:** which report number should move, direction, magnitude
- **Observed measure:** the same number, measured after delivery
- **Verdict:** held | partially held | did not hold

## What the evidence shows

The comparison, with the exact `codepatrol improve inspect` invocation and
observation window used for both measurements.

## What changed that was not predicted

Effects the proposal did not anticipate, in either direction.

## What this changes about the next proposal
```

The observation window and the command must match between the expected and
observed measurements, otherwise the comparison is not a comparison.
