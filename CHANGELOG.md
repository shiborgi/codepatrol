# Changelog

## Unreleased

- Add optional deterministic out-of-process agent catalog resolution with exact
  provenance and immutable advisory instruction snapshots.
- Add optional bounded out-of-process code-context profiles and advisory report
  snapshots, independently configurable from agent selection.
- Internal refactor preserving behavior: extract the StateStore interface,
  verification, and Ship transaction modules; thread a RunContext for clock,
  stdin, environment, and fetch access; add `--verbose` and `--quiet` global
  flags routing stderr-only diagnostics; distinguish missing from malformed
  configuration files.

## 1.0.0

Clean standalone release requiring Node.js 22 or newer.

- Recoverable task protocol over JSON stdin/stdout.
- Unlimited Spec, Plan, and Build proposals before a sealed Review round.
- Explicit review selection with separate verification and acceptance gates.
- Immutable ref-backed Build candidates and disposable Review worktrees.
- Atomic Ship Accept and Rollback with explicit operator confirmation.
- Compact validated state under `refs/codepatrol/v1/state`.
- Explicit idempotent GitHub Wiki, milestone, and issue reconciliation.
- No migration from previous state, profiles, support skills, Agent Plugins,
  ContextPatrol, AgentPatrol, automatic remote work, bootstrap, or autofix.
