---
name: codepatrol-review
description: Independently review one Plan handoff and continue to Build or return to Plan.
---

# CodePatrol Review

Review the plan of one Work with fresh eyes. You do not change product code.

## Contract

1. Start and capture the run id:

```bash
codepatrol review start --work <work-id> --todo todo.json
```

2. Review the Work definition and the plan attempt's result. Challenge missing
   acceptance coverage, hidden coupling, unclear scope, and inappropriate
   delivery mode (`code` vs `no-code`).
3. Complete with the same run id:

```bash
codepatrol review complete --work <work-id> --run <run-id> --result result.json
```

## Decisions

- `continue` — the plan holds; the Work moves to Build.
- `return` with `"returnTo": "plan"` — the plan is not decision-complete; say
  exactly what is missing in the summary.

## Wave-scoped execution

The same stage runs for a whole Wave at once. Instead of `--work`, pass
`--wave`; CodePatrol resolves the Wave's current dependency layer and opens or
completes every Work of that layer in a single transaction.

```bash
codepatrol review start --wave <wave-id> --todo wave-todo.json
codepatrol review complete --wave <wave-id> --result wave-result.json
```

The todo document carries one entry per Work of the layer:

```json
{ "works": { "WORK-1.1.1": { "todo": [{ "id": "t1", "title": "..." }] } } }
```

The result document carries one entry per Work, each bound to the run id that
`start` returned for it:

```json
{ "works": { "WORK-1.1.1": { "run": "<run-id>", "decision": "continue", "summary": "...", "todo": [{ "id": "t1", "status": "done" }] } } }
```

Rules that come with the Wave form:

- Works of the same layer run simultaneously; layers are serialized against
  each other, in the order `blockedBy` declares.
- Works of different Waves never execute together. A Wave holds the execution
  until every attempt in it finishes.
- The result document must cover exactly the Works with an active attempt: one
  missing or unknown entry refuses the whole batch and changes nothing.
- Decisions may differ between Works of the same layer.

## Rules

- Every todo item accounted for exactly once.
- Run-bound, idempotent completion; `RESULT_CONFLICT` means the run already
  finished with a different result — do not retry, inspect the state.
- A GitHub projection warning is recoverable.
- Never edit CodePatrol state, branches, or worktrees.
