# Changelog

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0

First released version. State lives only on `refs/codepatrol/state`, one
compare-and-swap per transaction, and the full lifecycle works offline.

### Model

- Three local levels: Initiative (`INIT-1`), Wave (`WAVE-1.1`), Work (`WORK-1.1.1`).
- Six primary methods: spec (initiative-scoped), plan, review, build, verify,
  ship (work-scoped). Only they mutate authoritative state.
- Spec produces immutable Initiative definition revisions declaring Waves and
  their Works. A Wave containing a started Work cannot be removed by a later
  revision; a started Work cannot be redefined.
- Wave completion is derived (all Works terminal). A completed Wave takes one
  explicit verdict — `keep`, `adjust`, `rollback`, `inconclusive` — with an
  authority, never inferred from Work outcomes.
- Code-delivery Works produce a local Change: isolated branch and worktree,
  candidate commits, local squash on Ship Accept, cleanup per outcome.

### Execution

- Every completion is bound to the run id its `start` returned. Repeating a
  completion with the same run and the same normalized result is a no-op; a
  different result for the same run fails with `RESULT_CONFLICT`.
- Execution is exclusive to one Wave. Any number of Works of that Wave may hold
  an active attempt at once; a Work of another Wave waits until the Wave is
  idle, and a Work never holds two attempts.
- `plan`, `review`, `build` and `verify` accept `--wave <id>` instead of
  `--work <id>`: CodePatrol derives the Wave's dependency layers from
  `blockedBy`, opens or completes the current layer in a single transaction,
  and refuses the whole batch when one entry does not match its run. Ship stays
  Work by Work — it is the only stage that advances the shared base.
- Build refuses before creating any branch or worktree when a Work of the layer
  cannot start, so a refused start leaves no orphan resource behind.

### Capabilities

- Profiles resolve a per-method capability composition recorded on every
  attempt as `profile`, `capabilities` and `compositionDigest`.
- Harness templates for OpenCode, Pi and Claude Code are generated from one
  shared source in `skills/harness/`; a test fails when the three drift apart.
- A capability is exactly `capability.json` plus `SKILL.md`, governed by a
  shared constitution and a written convention.

### GitHub projection

- Initiative to wiki page, Wave to Milestone, Work to Issue, attempt to Issue
  comment, and Work Issues as GitHub Project items carrying `Status` and
  `Next Step`.
- `Status` is the stage that actually started, never a mirror of
  `workflow.stage`. Completing a stage sets `Next Step` and leaves `Status`
  where it executed.
- Local state always wins: remote drift is corrected, never absorbed. The
  projection runs strictly after the local transaction and never blocks it.
- `codepatrol project prepare` reports whether the configured Project can
  receive the projection — access, the two single-select fields, and every
  option — without creating remote state.

### Package

- The published API is deliberately small: `runCli`, the error type, the
  Initiative-document parser, the identifier grammar, and the types needed to
  read what the CLI emits. A test fails when anything else is exported.
- The package ships the CLI, the shared contracts, and the harness command
  templates for the three harnesses; compiled tests are excluded.

### Verification

- `npm run verify` runs the whole chain — typecheck, lint, one build, the test
  suite with native coverage, the external smoke, the closed-loop and
  local-delivery fixtures, and the CLI entry point — and CI runs that same
  command rather than an enumeration of its steps.
- Biome is the lint and formatting gate; coverage is measured by the Node test
  runner, with no additional dependency.
- Contracts are executed, not trusted: tests submit the published example
  document and the Spec contract's own JSON block to the real parser, check
  every command cited in the six contracts against the CLI surface, and verify
  that documentation cites no missing path and no superseded identifier.
