# Specification format

Write the governing specification to `.codepatrol/packages/<work-id>/spec.md`. It is shared by project proposals, feature proposals, architecture improvements, and bug corrections. The plan reads this file, not the producing conversation.

```markdown
# Specification — <name>

## Intent

- Origin: propose-codebase | improve-codebase
- Mode: project | feature | architecture | bug
- Target baseline: <Git commit, unborn project, and any material dirty state>
- Governing constraints: <`CONTEXT.md` terms and ADR ids the design depends on, or `None — <reason>`>
- Substrate state: <graph revision or absent; wiki state present | stale | absent>
- Problem: <who or what is affected and why it matters>
- Outcome: <one observable end state>

## Scope

### In scope

<Bounded behaviors and structural changes.>

### Out of scope

<Explicit exclusions with reasons.>

## Current evidence

<Verified code, graph, wiki, runtime, reproduction, or external-reference facts.
Use exact paths, commands, revisions, and confidence. For greenfield work, state
which assumptions replace code evidence.>

## Proposed design

<Chosen architecture or correction. Describe modules, interfaces, invariants,
data/trust boundaries, error behavior, and dependency direction. For a bug,
include the root cause and why the correction addresses it.>

## Alternatives

<Genuinely different options and why they were rejected.>

## Simplicity decision

- Selected rung: <need | local reuse | runtime/stdlib | native platform |
  installed dependency | direct local change | minimum new implementation>
- Earlier rungs: <evidence showing why each earlier option cannot satisfy the contract>
- Irreducible complexity: <behavior the project must own and the interface hiding it>
- Safety floor: <validation, data protection, security, accessibility, reliability,
  operability, and acceptance constraints that remain mandatory>
- Expected surface delta: <files, dependencies, public interfaces, configuration,
  and runtime state expected to be added, changed, or removed>

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | <what is sufficient now> | <limit intentionally accepted> | <measurable event> | <bounded next design> |

## Compatibility and rollout

<Migration, compatibility, observability, rollback, and operational impact.
Say “none” with a reason when a concern does not apply.>

## Risks and mitigations

<Concrete invalidation risks, early signals, and mitigations.>

## Acceptance criteria

- AC-1: <observable trigger or condition and one observable result>
- AC-2: <observable trigger or condition and one observable result>

## Decisions and open questions

<Settled decisions with rationale. A package cannot become ready-for-review
while a question can materially change scope, interfaces, or acceptance.>
```

Rules:

- Every acceptance criterion has a stable `AC-N` identifier used by `plan.md`, `review.md`, and `implementation.md`, names an observable trigger or condition, and names one observable result in project vocabulary.
- Governing constraints records the `CONTEXT.md` terms and ADR ids the design depends on, or `None — <reason>`; Substrate state records the graph revision and wiki state as `present`, `stale`, or `absent`.
- Brownfield claims cite evidence read in the current investigation. External concepts link the pinned reference analysis and distinguish fact, inference, and recommendation.
- Use project domain language from `CONTEXT.md` and architecture vocabulary from [codebase-design](../codebase-design/SKILL.md).
- The simplicity decision stops at the earliest sufficient ladder rung. It cannot remove a safety-floor requirement or substitute a small diff for correcting the right seam.
- Write `None — <reason>` under deferred constraints when no known ceiling is being accepted. Every listed constraint has a stable `DC-N`, an observable trigger, and an upgrade path; vague future-proofing does not qualify.
- Expected surface delta is a reviewable forecast, not a claim about counterfactual effort or savings.
- No placeholders, conversation-only decisions, unexplained scope, or implementation steps belong in an approved spec.
- A complete spec states non-functional constraints when relevant: security, privacy, performance, accessibility, reliability, compatibility, and operability.
