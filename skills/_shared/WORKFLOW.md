# Shared workflow contracts

Use these contracts across all primary workflows. Store operational state with the Codepatrol CLI; keep the portable proposal package, implementation journal, wiki pages, `CONTEXT.md`, and ADRs as human-readable project artifacts.

## Resume protocol

Start with `codepatrol status --workspace "$PWD" --format json` to list open workflows and artifact packages. When the user or a governing artifact has not named a work id or workflow id, present the open ones and let the user choose one explicitly or start a new package; never select by recency alone.

Before continuing known work, run `codepatrol workflow prime --workspace "$PWD" --format json`, passing `--workflow-id` when known. Reconcile the result with Git and the referenced artifacts; files and Git win over stale memory.

Record memory after a meaningful decision, confirmed or rejected hypothesis, blocker, artifact, verification result, interruption, or safe next action. Do not manufacture fixed phases or checkpoints just to update memory.

For executable work:

1. Query `workflow ready`.
2. Claim exactly one bounded item before editing.
3. Update it when blocked or waiting for the user.
4. Close it only after its acceptance criteria and verification pass.
5. Record project-scoped knowledge with `workflow remember` only when it will matter beyond the current workflow.

Never store secrets, raw conversations, large logs, or full worker responses. Store conclusions and references to durable evidence.

## Evidence Note

- Claim being supported.
- Local or external source and exact revision when applicable.
- Verified location, command, or result.
- Confidence and limitations.
- Workflow item or artifact that consumes it.

## Verification Matrix

For each behavior or risk, record the feedback loop, expected red signal when applicable, passing result, and evidence. Include affected tests identified by graph impact and any required non-functional checks.

## Change Package

For planned work, use the revisioned package defined in [ARTIFACTS.md](ARTIFACTS.md). It binds the governing specification, plan, evidence, review, and implementation journal by hash. For change review, additionally bind that approved revision to the exact diff/ref, relevant graph impact, wiki concepts, verification matrix, and known deviations. Review must never guess either target from recency alone.

## Assessment Result

Record findings by severity with verified location, contract or code axis, impact, confidence, and required correction. End with `approve`, `fix-first`, or `rework` and identify artifact drift separately.
