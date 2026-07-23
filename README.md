# Codepatrol

Codepatrol is a local, harness-agnostic toolkit for planning, reviewing,
implementing, verifying and explicitly closing code changes. One branch-backed
**Change** is the lifecycle truth; Git supplies snapshots and recovery, while a
deterministic CLI supplies validation, projection and orchestration.

## The lifecycle

```text
Plan → Review → Apply → Verify → Finalize → committed | rolled-back
 ↑       │          ↑       │
 └───────┘          └───────┘ implementation defect
 └─────────────────────────── contract defect
```

Every Plan creates exactly one `codepatrol/<work-id>` branch from an exact
target branch/head. The Change at `.codepatrol/changes/<work-id>/change.yaml`
contains immutable identity plus ordered validated events. Current stage,
attempt, revision, checkpoint, next action and metrics are projections; there
is no second mutable status or global workflow ledger.

```text
.codepatrol/
├── changes/<work-id>/
│   ├── change.yaml
│   ├── plan/{spec.md,plan.md,evidence/}
│   ├── review/{report.md,evidence/}
│   ├── apply/{journal.md,evidence/}
│   ├── verify/{report.md,evidence/}
│   └── finalize/receipt.md
└── runtime/
    ├── graph/graph.json
    ├── wiki/{manifest.json,transactions/}
    ├── sessions/<work-id>/<stage>/<attempt>.json
    ├── evaluations/
    ├── locks/
    ├── tmp/
    └── version.json
```

Changes are portable and tracked. Runtime is ignored, disposable and never
owns lifecycle, approval, terminal outcome or project decisions. Durable ADRs
live in `docs/adr/`; the generated OKF wiki lives in `docs/wiki/`.

## Public skills

- `$codepatrol-plan` creates the branch/Change and writes
  `plan/spec.md`, `plan/plan.md` and Plan evidence.
- `$codepatrol-review` writes `review/report.md` and approves or returns the
  Change without editing production code.
- `$codepatrol-apply` executes the approved plan test-first and writes
  `apply/journal.md`, production changes and a clean candidate checkpoint.
- `$codepatrol-verify` independently audits the candidate and writes
  `verify/report.md`, then advances or returns it without production edits.
- `$codepatrol-finalize` performs only an explicitly authorized fast-forward
  commit or recoverable rollback and writes the terminal receipt/tag.
- `$codepatrol-status` reproduces the deterministic Kanban and exact resume
  actions without mutation.

Each lifecycle skill owns one stage, records one or more attempts and stops.
No stage silently invokes its successor. `skills/catalog.yaml` is authoritative
for roles, ordering, support edges, inputs, outputs and mutation policy.

## CLI

```bash
codepatrol status --workspace "$PWD" --format json
codepatrol change start --input change.json --workspace "$PWD" --format json
codepatrol change inspect --id 2026-07-22-example --workspace "$PWD" --format json
codepatrol change transition --id 2026-07-22-example --input transition.json --workspace "$PWD" --format json
codepatrol change session --id 2026-07-22-example --input session.json --workspace "$PWD" --format json
codepatrol change doctor --id 2026-07-22-example --workspace "$PWD" --format json
codepatrol change finalize --id 2026-07-22-example --input finalize.json --workspace "$PWD" --format json
npm run kanban -- --workspace "$PWD" --format markdown
```

Lifecycle commands require an explicit work id; none choose by recency. Change
writers validate workspace containment, exact branch/ref identity, event order,
attempt and return rules, artifact ownership/hashes, run coverage and unexpected
dirty paths. Writers use locks, cancellation and atomic files. Git execution
uses argv arrays and local operations only.

`change doctor` validates durable state and may rebuild the current Stage
Session. It never edits events, refreshes hashes, repairs source or mutates refs.

### Deterministic Kanban

`scripts/render-kanban.mjs` and `codepatrol status` use the same pure projector.
Rows sort by creation timestamp then work id. Columns are fixed: Work, Branch,
Plan, Review, Apply, Verify, Finalize and Total. Each stage shows attempt,
result/state, token coverage and elapsed time; Total shows all-attempt tokens,
summed active time and terminal cycle time. Default output never advances an
active clock. Pass an explicit `--as-of <ISO>` when that projection is wanted.

### Tokens and time

Every finished run records start, finish and non-negative elapsed milliseconds.
Runs belong only to the current active stage attempt; checkpoint, return and
Finalize sealing all require a finished run.
Token usage is either actual provider/harness measurement (input, output,
cache, reasoning and authoritative total) or `unavailable` with a reason.
Codepatrol never estimates tokens from text or elapsed time. Totals sum measured
runs exactly once and display `measured/total` coverage; cache/reasoning
dimensions are not added again to a provider total. Pi accumulates only numeric
provider dimensions in memory and exposes `codepatrol_record_run`; each primary
calls it exactly once before checkpoint or Finalize so one measured or
explicitly unavailable run is recorded without storing messages.

### Finalize safety

Finalize requires explicit work id/action/authority, a Verify `commit` verdict,
the recorded candidate branch, an unchanged target ref and a clean tree.

- `commit` writes receipt/event, creates
  `codepatrol/committed/<work-id>`, switches to the target, performs
  fast-forward-only integration and deletes the feature branch.
- `rollback` writes receipt/event, creates
  `codepatrol/rolled-back/<work-id>`, proves the target tree unchanged and
  deletes the feature branch.

The tag is created before deletion. Codepatrol never fetches, pushes, rebases,
forces, resolves conflicts or deletes remote refs.

## Graph and wiki

```bash
codepatrol graph sync --workspace "$PWD" --format json
codepatrol graph overview --workspace "$PWD" --format json
codepatrol graph outline --file src/example.ts --workspace "$PWD" --format json
codepatrol graph neighbors --file src/example.ts --relation tests --workspace "$PWD" --format json
codepatrol graph impact --since-ref HEAD~10 --workspace "$PWD" --format json
codepatrol wiki status --workspace "$PWD" --format json
codepatrol wiki generate --workspace "$PWD" --format json
codepatrol wiki validate --workspace "$PWD" --format json
```

The incremental graph cache and wiki freshness/transaction state live below
`.codepatrol/runtime/`. `docs/wiki/` remains the optional durable OKF v0.1
bundle. A missing wiki is valid and reported as absent.

## Installation

```bash
npm install
npm run build
node scripts/install-local.mjs --harness codex
node scripts/install-local.mjs --harness opencode
node scripts/install-local.mjs --harness pi
```

The filesystem installers and Pi extension expose the six public skills only;
support skills remain internal composition. OpenCode command adapters live in
`.opencode/commands/`.

## Development

Requires Node.js 20+ and Git.

```bash
npm run typecheck
npm test
npm run build
npm run smoke:cli
npm run lint:skills
npm run verify
```

## v1 bootstrap cutover

Schema v1 is intentionally unsupported by the delivered CLI. Its historical
`.codepatrol/packages/` and `.codepatrol/workflows/` remain only while this
replacement is independently verified on `v1-release`. After a green Verify
and a new explicit user instruction:

1. record the verified `v1-release` SHA and unchanged `main` SHA;
2. fast-forward `main` to `v1-release`, or stop;
3. enumerate and remove only the historical v1 package/runtime paths;
4. run `npm run verify`, compiled `codepatrol status`, and the Kanban script;
5. require an empty active board and clean `main`, commit the cleanup, create
   the v2 cutover tag, then delete local `v1-release`.

Push and remote deletion always require separate authority. Git history and the
cutover tag preserve recovery; no compatibility reader or migration store is
shipped.
