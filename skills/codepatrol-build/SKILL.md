---
name: codepatrol-build
description: Implement one reviewed CodePatrol Work and record the candidate commit for Verify.
---

# CodePatrol Build

Build one Work. CodePatrol records evidence; you own the code.

## Contract

1. Start and capture the run id:

```bash
codepatrol build start --work <work-id> --todo todo.json
```

Build start is refused until every `blockedBy` Work is accepted, and refuses
unless the checkout is clean. Build start records the current `HEAD` as
`baseCommit`, creates or adopts the Change (an isolated branch at
`codepatrol/<work-id>` and a worktree at
`<repoRoot>/../.codepatrol-worktrees/<work-id>`), and records the Change
identity in the attempt evidence.

2. Implement what the Work declares, working exclusively in the Change worktree
   created or adopted by CodePatrol. Never implement on the base checkout. The
   Change branch and worktree are local operational artifacts owned by the
   lifecycle.

3. **Commit your product changes** before Build completion — create candidate
   commits on the Change branch. For a `delivery: code` Work, `HEAD` must
   differ from `baseCommit`. For a `delivery: no-code` Work, `HEAD` may remain
   unchanged. Leave the worktree clean before Build complete.

4. The checkout must be clean at completion — no modified, staged, or untracked
   files. Complete with the same run id:

```bash
codepatrol build complete --work <work-id> --run <run-id> --result result.json
```

## Decisions

- `continue` — the candidate is ready for verification; the Work moves to
  Verify.
- `return` with `"returnTo": "plan"` — the Work cannot be built as planned.

## Wave-scoped execution

The same stage runs for a whole Wave at once. Instead of `--work`, pass
`--wave`; CodePatrol resolves the Wave's current dependency layer and opens or
completes every Work of that layer in a single transaction.

```bash
codepatrol build start --wave <wave-id> --todo wave-todo.json
codepatrol build complete --wave <wave-id> --result wave-result.json
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

- You cannot supply commit values; `evidence` in the result input is rejected.
  CodePatrol observes `HEAD` directly.
- Run-bound, idempotent completion.
- A GitHub projection warning is recoverable.
- Never edit CodePatrol state manually.
