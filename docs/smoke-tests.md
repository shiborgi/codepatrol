# Smoke tests

## Project gate

```bash
npm run verify
```

This runs typecheck, all Node tests, build, compiled CLI smoke and skill lint.

## Change lifecycle

In a temporary Git repository:

1. initialize `main` with one commit and a clean tree;
2. run `change start` and confirm branch `codepatrol/<work-id>` plus Plan attempt;
3. record measured and unavailable run fixtures and checkpoint every stage;
4. confirm wrong order, unknown fields, drift, wrong branch, dirty unexpected
   path and duplicate run ids fail closed;
5. confirm Verify binds candidate commit/tree;
6. run commit and rollback in separate fixtures; require tag-before-delete,
   fast-forward-only commit, rollback target-tree equality and clean targets;
7. advance the target and confirm Close returns `TARGET_ADVANCED` without
   rebasing or resolving.

## Deterministic Kanban

Run the Change/board/script tests under `TZ=UTC` and
`TZ=Pacific/Auckland`; outputs must be byte-identical for the same fixtures.
Check active, returned, blocked, partial-coverage, committed and rolled-back
rows. Without `--as-of`, repeated renders must not read the current clock.

## Distribution

Run installer dry-runs for Codex, OpenCode and Pi. Confirm exactly six public
skills/commands, including Close, and no support skill exposure. Confirm Pi
usage aggregation stores only numeric dimensions/model identity and never raw
messages.

## Storage

Confirm durable Changes remain tracked, all ignored state is below
`.codepatrol/runtime/`, ADRs use `docs/adr/`, and no root scratch JSON or global
ledger is read by v2. During the bootstrap branch only, historical v1 paths may
remain for later explicitly authorized cutover.
