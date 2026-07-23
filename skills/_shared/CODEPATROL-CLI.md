# Codepatrol CLI

Prefer JSON for lifecycle and graph operations consumed by another step:

```bash
codepatrol status --workspace "$PWD" --format json
codepatrol change start --input change.json --workspace "$PWD" --format json
codepatrol change inspect --id <work-id> --workspace "$PWD" --format json
codepatrol change transition --id <work-id> --input transition.json --workspace "$PWD" --format json
codepatrol change session --id <work-id> --input session.json --workspace "$PWD" --format json
codepatrol change doctor --id <work-id> --workspace "$PWD" --format json
codepatrol change close --id <work-id> --input close.json --workspace "$PWD" --format json
node --import jiti/register scripts/render-kanban.mjs --workspace "$PWD" --format markdown

codepatrol graph sync --workspace "$PWD" --format json
codepatrol graph overview --workspace "$PWD" --format json
codepatrol graph outline --file src/example.ts --workspace "$PWD" --format json
codepatrol graph find --query Example --workspace "$PWD" --format json
codepatrol graph neighbors --file src/example.ts --relation tests --workspace "$PWD" --format json
codepatrol graph impact --since-ref HEAD~30 --workspace "$PWD" --format json
codepatrol wiki status --workspace "$PWD" --format json
codepatrol wiki validate --workspace "$PWD" --format json
codepatrol wiki generate --workspace "$PWD" --format json
codepatrol wiki record --input result.json --workspace "$PWD" --format json
```

Lifecycle commands require an explicit work id; none select by recency. All
durable lifecycle mutations pass through the four-function Change seam. Status
and the Kanban script share one pure projector. Stage Sessions are rebuildable;
`change doctor` may rebuild runtime but never refresh hashes, alter events,
repair source or mutate refs.

Treat graph edges as leads and verify cited locations directly. A missing or
stale graph may be synced once by the coordinator. User-controlled paths remain
workspace-relative and symlink-contained. All writers use locks, cancellation
checks and atomic replacement; Git commands use argv arrays and local refs only.
