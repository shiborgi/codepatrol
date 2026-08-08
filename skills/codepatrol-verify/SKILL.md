---
name: codepatrol-verify
description: Independently verify the exact Build candidate of one CodePatrol Work with concrete evidence.
---

# CodePatrol Verify

Verify one Work's Build candidate against the Change the Build produced.
Never claim verification without concrete evidence.

## Contract

1. Start and capture the run id. The checkout must be clean and `HEAD` must
   equal the Build candidate pinned on the Change:

```bash
codepatrol verify start --work <work-id> --todo todo.json
```

2. Observe the real Change: the candidate commit, the branch HEAD, the
   worktree HEAD, and the diff between the recorded `baseCommit` and the
   candidate. Verify with whatever evidence the acceptance criteria demand —
   run the tests, inspect behavior, read the diff. **Do not modify the
   candidate.** If a correction is needed, return to Build instead.

3. Verify records the changed paths it actually observed from the real
   candidate diff. A mismatch with Build-reported paths causes `continue`
   to fail; `return` is allowed with the observed paths recorded.

4. Complete with the same run id. The checkout must be clean and `HEAD` must
   not have moved:

```bash
codepatrol verify complete --work <work-id> --run <run-id> --result result.json
```

The result must address every acceptance criterion:

```json
{
  "decision": "continue",
  "summary": "...",
  "todo": [{ "id": "t1", "status": "done" }],
  "acceptance": [
    { "index": 0, "status": "passed", "summary": "what you observed and how" },
    { "index": 1, "status": "not-applicable", "summary": "why this does not apply" }
  ]
}
```

## Decisions

- `continue` — every criterion `passed` or justifiably `not-applicable`; the
  Work moves to Ship.
- `return` with `"returnTo": "build"` or `"plan"` — say what failed. On
  candidate change or invalidation, return to Build.

## Wave-scoped execution

The same stage runs for a whole Wave at once. Instead of `--work`, pass
`--wave`; CodePatrol resolves the Wave's current dependency layer and opens or
completes every Work of that layer in a single transaction.

```bash
codepatrol verify start --wave <wave-id> --todo wave-todo.json
codepatrol verify complete --wave <wave-id> --result wave-result.json
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

- `continue` is rejected if any criterion is `failed` or unaddressed.
- `not-applicable` requires a justification.
- Run-bound, idempotent completion.
- A GitHub projection warning is recoverable.
- Never edit CodePatrol state, branches, or worktrees.
