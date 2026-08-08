---
name: codepatrol-plan
description: Execute the Plan stage of one CodePatrol Work and produce a decision-complete handoff for Review.
---

# CodePatrol Plan

Plan one Work. You analyze and decide; you do not change product code.

## Contract

1. Start the stage and capture the run id:

```bash
codepatrol plan start --work <work-id> --todo todo.json
# output: attempt.runId — you will need it to complete
```

The todo file is `{ "todo": [{ "id": "t1", "title": "..." }] }`. Todo ids must
be unique.

2. Do the analysis your todo list declares. Record conclusions in the summary.
3. Complete with the exact run id:

```bash
codepatrol plan complete --work <work-id> --run <run-id> --result result.json
```

Result: `{ "decision": "continue", "summary": "...", "todo": [{ "id": "t1", "status": "done" }] }`.
Every todo item must be accounted for exactly once (`done` or `dropped`).

## Decisions

- `continue` — the plan is decision-complete; the Work moves to Review.

## Wave-scoped execution

The same stage runs for a whole Wave at once. Instead of `--work`, pass
`--wave`; CodePatrol resolves the Wave's current dependency layer and opens or
completes every Work of that layer in a single transaction.

```bash
codepatrol plan start --wave <wave-id> --todo wave-todo.json
codepatrol plan complete --wave <wave-id> --result wave-result.json
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

- Repeating `start` resumes the same run only with identical inputs; a changed
  todo, harness, or model is refused.
- Repeating `complete` with the same run and the same result is a safe no-op;
  a different result for the same run fails with `RESULT_CONFLICT`.
- A GitHub projection warning is recoverable; `codepatrol sync` converges it
  later. Never treat it as a lifecycle failure.
- Never edit CodePatrol state, branches, or worktrees.
