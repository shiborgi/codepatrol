# Codepatrol CLI

Run deterministic operations through the local CLI. Prefer JSON when a result feeds later reasoning:

```bash
codepatrol status --workspace "$PWD" --format json        # summarize open workflows and packages; --all includes closed/implemented
codepatrol graph sync --workspace "$PWD" --format json
codepatrol graph overview --workspace "$PWD" --format json
codepatrol graph overview --path src/example --workspace "$PWD" --format json
codepatrol graph outline --file src/example.ts --workspace "$PWD" --format json
codepatrol graph find --query Example --workspace "$PWD" --format json
codepatrol graph neighbors --symbol Example --workspace "$PWD" --format json
codepatrol graph neighbors --file src/example.ts --relation tests --workspace "$PWD" --format json
codepatrol graph impact --file src/example.ts --workspace "$PWD" --format json
codepatrol graph impact --since-ref HEAD~30 --workspace "$PWD" --format json
codepatrol wiki status --workspace "$PWD" --format json
codepatrol wiki validate --workspace "$PWD" --format json
codepatrol wiki generate --workspace "$PWD" --format json
codepatrol wiki record --input result.json --workspace "$PWD" --format json
codepatrol artifact record --manifest docs/codepatrol/<work-id>/handoff.yaml --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage plan --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage review --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage implementation --workspace "$PWD" --format json
codepatrol artifact validate --manifest docs/codepatrol/<work-id>/handoff.yaml --stage verification --workspace "$PWD" --format json
codepatrol workflow create --input workflow.json --workspace "$PWD" --format json
codepatrol workflow ready --workflow-id cpw-example --workspace "$PWD" --format json
codepatrol workflow claim --id cpw-item --actor codex --workspace "$PWD" --format json
codepatrol workflow update --id cpw-item --input update.json --workspace "$PWD" --format json
codepatrol workflow close --id cpw-item --result result.json --workspace "$PWD" --format json
codepatrol workflow remember --input memory.json --workspace "$PWD" --format json
codepatrol workflow prime --workflow-id cpw-example --budget 1200 --workspace "$PWD" --format json
codepatrol workflow compact --workflow-id cpw-example --workspace "$PWD" --format json
```

Treat ambiguous graph edges as leads and confirm them by reading. A missing or stale graph is resolved once by the coordinator with `graph sync` before independent queries begin.

The artifact manifest is the portable, versioned handoff between harnesses. `artifact record` atomically refreshes declared hashes; `artifact validate` is read-only and rejects stale content or missing review approval. Its `plan` stage enforces only deterministic spec/plan format rules and is not a design-quality verdict; its `verification` stage additionally requires an implemented package whose approval still matches the current revision.

The workflow ledger is Codepatrol-owned operational memory. Use dependency relations to expose ready work, claim before editing, and record only concise conclusions plus artifact references. It is not a replacement for the portable package or other human-readable project documentation.
