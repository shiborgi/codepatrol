# AGENTS

CodePatrol v1 owns routing, workflow gates, trusted execution boundaries, durable
local state and adaptive telemetry. AgentPatrol owns personas/profiles/skills;
ContextPatrol owns read-only repository context. Follow `docs/protocol.md`.
MemoryPatrol owns persistent LLM-supervised insights and named stores.

```text
spec -> spec-review -> plan -> plan-review -> build -> build-review -> ship
```

- Resolve real providers; do not fabricate model execution or usage.
- Run explicitly configured trusted executor and verification argv without a shell.
- Execute in an isolated Git worktree and retain authoritative state outside it.
- Failed stages, non-approved reviews and failed/missing verification block advancement.
- Ship prepares release; separate explicit operator approval never publishes or pushes.
- Serialize state writers and never automatically retry arbitrary executor writes.
- Telemetry is optional, sanitized and advisory; it cannot grant approvals.
- Keep the v1 command, state and contract surface strict.

Quality gates: `npm run verify` and `npm run release-check`. Use isolated fixture
repositories in tests. Keep code, documentation and comments in English.
