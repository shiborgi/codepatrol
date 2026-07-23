# Change contract

A Change is the sole durable lifecycle record for one independently reviewable
work item. It lives on branch `codepatrol/<work-id>` and targets the exact
branch/head recorded when Plan started it.

```text
.codepatrol/changes/<work-id>/
├── change.yaml
├── plan/{spec.md,plan.md,evidence/}
├── review/{report.md,evidence/}
├── apply/{journal.md,evidence/}
├── verify/{report.md,evidence/}
└── close/receipt.md
```

`change.yaml` contains immutable identity and ordered validated events. Never
write status, current stage, revision, next action or totals into a second
store. Obtain those projections through:

```bash
codepatrol change inspect --id <work-id> --workspace "$PWD" --format json
```

The only forward route is Plan → Review → Apply → Verify → Close. Contract
defects return to Plan; implementation defects found by Verify return to Apply.
Every non-terminal projection names one exact next action with work id and
branch. Never select by recency.

## Stage protocol

Except for a newly started Plan, a stage first records `begin`. Every harness
records at least one finished run before sealing its stage. Use actual
provider/harness token usage when available; otherwise record `unavailable`
with a reason. Never estimate tokens.

```json
{"type":"usage","actor":"codex","stage":"apply","run":{"id":"apply-1","started_at":"2026-07-22T10:00:00Z","finished_at":"2026-07-22T10:01:00Z","elapsed_ms":60000,"tokens":{"status":"unavailable","reason":"harness exposes no authoritative usage hook"}}}
```

Plan, Review, Apply and Verify seal with `change transition --id <work-id>
--input -`. The checkpoint payload declares every owned durable artifact by
path, SHA-256 and explicit `create`, `modify` or `delete` intent. Required stage
artifacts may not use `delete`. Apply additionally declares every production
`changes` path; that list must exactly match the Git delta from the prior
accepted checkpoint.
The orchestrator validates branch, event order, run coverage, hashes, owned
directories and unexpected dirty paths, then creates local checkpoint commits.
No stage invokes its successor.

Close is the only normal terminal mutation. It requires an active Close
attempt, a finished run, explicit user authority, unchanged target ref and a
clean tree. It creates a receipt, terminal event and recoverable tag before
fast-forward integration or branch deletion. It never fetches, pushes, rebases,
forces or resolves conflicts.

## Ownership and failure

- Plan owns `plan/`; Review owns `review/`; Apply owns `apply/`; Verify owns
  `verify/`; Close owns `close/`.
- Declare every durable file. Raw logs, prompts, transcripts, credentials and
  scratch payloads belong nowhere in a Change.
- On drift, wrong branch, unexpected file, target advance or invalid event,
  stop. Do not refresh hashes or mutate refs to make validation pass.
- Files and Git outrank rebuildable runtime. Use `change doctor --id` only to
  validate durable state and rebuild the current Stage Session.
