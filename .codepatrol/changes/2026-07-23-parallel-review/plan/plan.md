# Plan — Parallel Review and Verify

- Work id: `2026-07-23-parallel-review`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Enhance the harness and agent instructions to explicitly support and document parallel review and verify operations, ensuring context isolation (no chat history carryover) and artifact aggregation. Since the underlying schema and CLI (`change session`) already support this mechanically, the work involves updating the agent instructions, skills, and potentially the coordinator script to codify this multi-persona capability and ensure return states surface all artifacts.

## Global constraints

- No changes to `ChangeRecordV2` schema.
- Must preserve the rule that stages only see their input artifacts.

## Simplicity proof

- Selected rung: minimum new implementation
- Reused capabilities: `src/change/session.ts` and `src/change/orchestrator.ts` already support multiple artifacts and concurrent items.
- Forbidden speculative surface: No complex consensus algorithms or dynamic agent spawning logic inside the core TS code.
- Expected surface delta: Documentation updates, minor tweaks to skill markdown files, and potentially the orchestrator/coordinator shell scripts to read all artifacts on return.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1 | Inspect session CLI capability with multiple items |
| AC-2 | T2 | Inspect harness/agent documentation and skill updates |
| AC-3 | T3 | Verify coordinator scripts surface all `review/` artifacts to `plan` or `apply` |

## Dependency order

`T1 → T2 → T3`

### T1 — Document concurrent session items for personas

**Purpose:** Satisfies AC-1 by documenting how to use `change session` to create and claim multiple parallel review items.

**Depends on:** None

**Files:**
- Modify: `skills/codepatrol-review/SKILL.md`
- Modify: `skills/codepatrol-verify/SKILL.md`

**Interfaces:**
- Consumes: existing CLI commands

**Simplicity proof:** Reuse existing CLI, only document the pattern.

**Surface delta:** Modifies 2 existing markdown files.

**Steps:**
1. Update `skills/codepatrol-review/SKILL.md` to instruct the agent/coordinator on how to prime and claim persona-specific items (e.g., `review-security`, `review-architecture`).
2. Run `codepatrol wiki validate`. Expected green.

### T2 — Codify context isolation

**Purpose:** Satisfies AC-2 by enforcing that the agent performing review/verify must be launched with a fresh context, avoiding bias.

**Depends on:** T1

**Files:**
- Modify: `AGENTS.md`
- Modify: `skills/codepatrol-review/SKILL.md`

**Interfaces:**
- Consumes: harness initialization protocol

**Simplicity proof:** Process and instruction update only.

**Surface delta:** Modifies existing documentation.

**Steps:**
1. Add explicit instructions in `AGENTS.md` regarding context clearing: "When transitioning to Review or Verify, the harness MUST initialize a fresh context window for the agent. The agent must not have access to the chat history of the Plan or Apply stages, ensuring an unbiased, persona-driven evaluation based purely on artifacts."
2. Run `codepatrol wiki validate`. Expected green.

### T3 — Surface aggregated artifacts on return

**Purpose:** Satisfies AC-3 by ensuring that when a change is returned to Plan or Apply, all review/verify artifacts are visible.

**Depends on:** T2

**Files:**
- Modify: `skills/codepatrol-plan/SKILL.md`
- Modify: `skills/codepatrol-apply/SKILL.md`

**Interfaces:**
- Consumes: `review/*.md` and `verify/*.md` artifacts

**Simplicity proof:** Instruct the agents to proactively read the target artifact directories when resuming after a return.

**Surface delta:** Modifies 2 existing markdown files.

**Steps:**
1. In `skills/codepatrol-plan/SKILL.md` and `skills/codepatrol-apply/SKILL.md`, add a step during resume: "If resuming after a return, read all markdown files in the returning stage's directory (e.g., `review/` or `verify/`) to aggregate and address all findings from all parallel personas."
2. Run `codepatrol wiki validate`. Expected green.

### T4 — Final Verification

**Purpose:** Ensure all ACs are met and no unexpected changes are introduced.

**Depends on:** T3

**Steps:**
1. Verify AC-1, AC-2, AC-3 are covered by the updated documentation.
2. Run `npm run test` or standard validation gates.
3. Diff the workspace to ensure only markdown files were touched.
