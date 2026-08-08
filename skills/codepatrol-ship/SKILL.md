---
name: codepatrol-ship
description: Inspect the exact verified candidate of one CodePatrol Work and record an explicitly authorized Accept or Rollback.
---

# CodePatrol Ship

Ship decides the outcome of one Work. Only a human authority accepts or rolls
back.

## Contract

1. Start and capture the run id. The checkout must be clean and `HEAD` must
   equal the verified candidate. The base branch HEAD is revalidated against
   the recorded `baseCommit`:

```bash
codepatrol ship start --work <work-id> --todo todo.json
```

2. Inspect the verified candidate and the verification evidence. **Do not
   modify the candidate or the checkout.**

3. The base branch HEAD is revalidated again immediately before integration.
   If the base advanced between Ship Start and Ship Complete, the Accept is
   refused before any squash occurs (no automatic rebase).

4. Complete with the same run id. The checkout must be clean and `HEAD` must
   not have moved:

```bash
codepatrol ship complete --work <work-id> --run <run-id> --result result.json
```

## Lost-response recovery

Ship integration and the state transaction are not atomic. Before performing
a fresh squash, Ship searches the base branch history for an existing
integration commit with the deterministic marker
`codepatrol: ship <work-id> <candidate-commit>`. When found and valid
(reachable from base, subject exact match, tree identity with candidate,
single parent equals recorded baseCommit), the commit is adopted as
`finalCommit` without a second squash — producing exactly one integration
commit. Mismatched or ambiguous markers are refused.

## Remote publication

Remote publication is separate from the local Accept. Use
`ship complete --publish` to opt in; without it `remotePublication` records
`not-requested`. Publication failure never invalidates the local Accept.
Retry publication independently with `codepatrol ship publish --work <id>`.
See `docs/architecture.md#remote-publication`.

## Decisions

- `accept` with `"authority": "<who authorized>"` — the Work becomes terminal
  with outcome `accepted`. The Change branch is squashed onto the base as a
  single commit by the CLI; the worktree and the local Change branch are
  removed by the CLI after the lifecycle commit is recorded.
- `rollback` with `"authority": "<who authorized>"` — the Work becomes terminal
  with outcome `rolled-back`. The base branch is left unchanged; the worktree
  is removed by the CLI; the local Change branch is retained for investigation
  per the cleanup policy.

Both require an explicit authority. Ship cannot `continue` or `return`.

## Ship stays Work by Work

Plan, Review, Build and Verify accept `--wave`; Ship does not, and the absence
is a decision rather than an omission. Ship is the only stage that advances the
shared base: accepting one Work moves `main` under every sibling Change built
on the previous base. Shipping a layer at once would turn that into a race, so
each Ship is decided on its own, and a sibling left on a stale base is refused
with an instruction to rebuild rather than rebased silently.

## Rules

- Accept and Rollback never touch the base branch by hand. The CLI performs the
  local squash (Accept) or the no-op (Rollback) on the base as the sole
  integration step.
- Cleanup runs strictly after the CAS that records the lifecycle completion.
  It is best-effort: a failure emits a warning and never fails or rewrites the
  recorded completion.
- Repeated rollback is safe: the same run id with the same normalized result is
  a no-op; the cleanup is re-run for convergence.
- Ship will refuse Rollback if the base branch HEAD drifted from the recorded
  base commit during the active ship (the operator must re-verify or rebuild).
- Run-bound, idempotent completion.
- A GitHub projection warning is recoverable.
- The agent never edits branches, worktrees, or state directly. The CLI is
  the only writer; the CLI performs the integration and the cleanup after the
  terminal commit.
