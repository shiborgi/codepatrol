# Analysis evidence format

Write analysis to `docs/codepatrol/<work-id>/evidence/analysis.md`. It is durable evidence for the adjacent `spec.md`, not a second governing specification. Use plain Markdown that reads in a terminal, editor, and Git host; no HTML or remote assets.

## Architecture mode

```markdown
# Architecture analysis — <date>

## Scope and evidence

<Scope, baseline, graph/wiki state, source paths and commands inspected,
limitations, and why this scope was selected.>

## System overview

<Optional Mermaid cluster/seam diagram for repository-wide analysis.>

## Candidates

### 1. <Verb-first deepening> — `Strong`

- Files/seams: <verified paths and interfaces>
- Problem: <one or two evidence-backed sentences>
- Proposed shape: <one or two sentences>
- Wins: <locality, leverage, depth, testability, operability>
- Risks: <compatibility, migration, invalidation evidence>
- Verification implications: <feedback loops and affected tests>
- Recommendation: Strong | Worth exploring | Speculative

<A small before/after Mermaid or ASCII diagram.>

## Selected correction

<Exactly one candidate promoted to spec.md, why it wins, and why the rest are
out of scope or separate work ids.>
```

Order candidates by recommendation strength. Every number names its command source, every `file:line` was read, and graph ambiguity is confirmed from source. A candidate too large for one independently reviewable package must be split.

## Bug mode

```markdown
# Bug diagnosis — <date>

## Symptom and minimized reproduction

<Observed behavior, exact red-capable command, expected/actual signal.>

## Investigation

<Ranked hypotheses, probes, results, graph/runtime/source evidence.>

## Root cause

<Proven causal chain and why competing explanations were rejected.>

## Correction constraints

<Minimum behavioral correction, regression-test seam, compatibility and
rollout risks, and signs this is architectural rather than local.>
```

Analysis records facts and reasoning. The normalized implementation contract belongs in `spec.md`; task instructions belong in `plan.md`; review adjustments belong in `review.md`; execution results belong in `implementation.md`.
