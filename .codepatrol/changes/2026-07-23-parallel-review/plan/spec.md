# Specification — Parallel Review and Verify

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main (9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905)
- Governing constraints: None — this extends the session/harness capability for multiple actors
- Substrate state: graph revision present; wiki state absent
- Problem: Complex changes benefit from parallel, multi-agent reviews or verifications (e.g., security persona + architecture persona), but currently the tooling or agent instructions may implicitly assume a single monolithic review/verify pass by one agent, potentially carrying over context bias if the same agent instance is reused.
- Outcome: The system supports multiple concurrent reviewers/verifiers for a single attempt, isolates context between lifecycle roles to prevent bias, and aggregates all findings so that subsequent Plan/Apply stages can access the combined feedback.

## Scope

### In scope

- Enabling concurrent session item claims in `review` and `verify` stages for multiple personas.
- Aggregating artifacts (e.g., `review/findings-security.md`, `review/findings-architecture.md`) within the same stage attempt.
- Ensuring the transition to `plan` or `apply` on rejection surfaces all aggregated artifacts to the responsible agent.
- Defining strict context boundaries: agents performing `review` or `verify` must only be provided the stage's input artifacts, explicitly excluding the prompt history or internal memory of the agent that performed `plan` or `apply`.

### Out of scope

- Automated merging of conflicting review verdicts (e.g., if one agent approves and another rejects, the orchestrator transition logic handles the first rejection as a return, or waits for all mandatory session items; managing that consensus algorithm is out of scope beyond basic aggregation).
- Changing the underlying schema of `ChangeRecordV2` or `StageAttempt`; the current `artifacts` array and session `items` can already support this.

## Current evidence

- Code evidence: `src/change/session.ts` supports `claimSessionItem` and `closeSessionItem` with multiple actors and artifacts.
- Code evidence: `src/change/orchestrator.ts` allows checkpointing/returning with artifacts.
- Design evidence: "Another harness must need no conversation history." is already stated in `codepatrol-plan` skill. The gap is primarily in how harnesses are invoked (the contextual isolation) and how multiple session items are structured and surfaced to the return state.

## Proposed design

1. **Session Items for Personas**: When `review` or `verify` is primed, the session (or the coordinator) can define multiple concurrent items (e.g., `review-security`, `review-architecture`).
2. **Contextual Isolation**: Harnesses invoking these items must use a fresh context window (no prior chat history from Plan/Apply). They are initialized with only the role instructions (e.g., `codepatrol-review` skill) and the target artifacts (`spec.md`, `plan.md`, candidate diff). This guarantees the "vision of another persona" without bias, even if the underlying LLM is the same.
3. **Artifact Aggregation**: As each agent finishes, it closes its session item with its specific artifacts (`review/findings-<persona>.md`).
4. **Return Context**: If any reviewer returns the change (or if the coordinator aggregates them and issues a return), the `stage-returned` event preserves the state. The subsequent `plan` or `apply` agent is given the paths to all `review/*.md` or `verify/*.md` artifacts produced during that attempt to address them holistically.

## Alternatives

- Creating a new `multi-review` stage in the schema: Rejected because it breaks the simple 5-stage pipeline and schema compatibility, whereas sessions already support concurrent tasks.
- Forcing different LLM models for different personas: Rejected because a single capable model can adopt different personas effectively if the context window is isolated.

## Simplicity decision

- Selected rung: direct local change / minimum new implementation
- Earlier rungs: N/A - requires adjusting harness invocation and session item structure.
- Irreducible complexity: Isolating context requires explicitly starting a new LLM session or clearing chat history before the review/verify prompt.
- Safety floor: Artifacts must be hashed and tracked immutably; returning a stage must not lose any findings.
- Expected surface delta: Minor updates to harness prompts/coordinator scripts and documentation (`AGENTS.md` or skills) to define the parallel persona usage and context clearing.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | Manual item creation | Coordinator must define the specific personas upfront | Needs dynamic personas | Add dynamic session item generation based on change risk |

## Compatibility and rollout

Fully compatible with existing `ChangeRecordV2` schema since multiple artifacts per attempt are already supported.

## Risks and mitigations

- Risk: One reviewer approves, one returns. What happens?
- Mitigation: The coordinator script should wait for all parallel session items to close. If any return, the aggregated transition is a `return`.

## Acceptance criteria

- AC-1: Concurrent Reviewers: A review stage can have multiple session items claimed in parallel by different "personas" producing distinct artifacts.
- AC-2: Context Isolation: An agent performing review/verify can be proven to lack access to the plan/apply conversation history, eliminating bias.
- AC-3: Aggregated Feedback: Upon return to plan or apply, the responsible agent is provided with all artifacts from all reviewers/verifiers.

## Decisions and open questions

- Settled: Use existing `session.ts` for concurrent review items.
- Settled: Context isolation is the responsibility of the harness/coordinator invoking the agent.
