# Codepatrol

Codepatrol is a local, harness-agnostic toolkit for planning, scanning, reviewing, and safely applying codebase changes. It combines one deterministic CLI, a persistent incremental code graph, an Open Knowledge Format (OKF) v0.1 wiki, portable cross-harness artifact packages, native dependency-aware workflow memory, and one canonical Agent Skills tree under `skills/`.

The repository has no MCP server and no agent scheduler. Skills describe independent work units and a synchronization barrier in natural language. Harnesses with native delegation may run those units in parallel; Pi and restricted harness sessions run the same units sequentially.

## Requirements

- Node.js 20 or newer
- A local checkout of this repository
- At least one supported harness if you want to use the bundled skills

No package publication or network service is required after dependencies are installed.

## Local installation

Start from the repository checkout and install the CLI once. Every harness uses this same CLI:

```bash
npm install
npm link
codepatrol --version
```

Distribution is local-only: the same checkout is a Pi package with a native extension, and filesystem installers link the canonical skills for Claude Code, Codex, Kiro IDE, and OpenCode. Nothing is published to or installed from any registry.

### Pi

Make sure the `pi` executable is already installed and available on `PATH`, then run:

```bash
node scripts/install-local.mjs --harness pi
node scripts/verify-install.mjs --harness pi
```

The installer runs `pi install <checkout>`. The Pi package loads the canonical skills and the native extension at `.pi/`, which exposes `/codepatrol-plan`, `/codepatrol-review`, `/codepatrol-apply`, `/codepatrol-verify`, and `/codepatrol-status`. Pi-only installation does not create duplicate links under `~/.agents/skills`.

### Claude Code

```bash
node scripts/install-local.mjs --harness claude
node scripts/verify-install.mjs --harness claude
```

This links skills under `~/.claude/skills`, where they are available as `/codepatrol-plan`, `/codepatrol-review`, `/codepatrol-apply`, `/codepatrol-verify`, and `/codepatrol-status`. `claude-code` is accepted as an installer alias.

### Codex

```bash
node scripts/install-local.mjs --harness codex
node scripts/verify-install.mjs --harness codex
```

This links the canonical skills under `~/.agents/skills`. In Codex, choose an installed skill from `/skills`; it is invoked as `$codepatrol-plan` and the other direct skill names.

### Kiro IDE

```bash
node scripts/install-local.mjs --harness kiro-ide
node scripts/verify-install.mjs --harness kiro-ide
```

The skills are linked under `~/.kiro/skills`. Reload Kiro IDE after installation so it discovers them. `kiro` is accepted as an alias for `kiro-ide` in both commands; no Power, Spec, Hook, agent profile, or MCP configuration is created.

### OpenCode

```bash
node scripts/install-local.mjs --harness opencode
node scripts/verify-install.mjs --harness opencode
```

The skills are linked under `~/.agents/skills`, and thin slash-command templates from `.opencode/commands/` are linked into `~/.config/opencode/commands/` so `/codepatrol-plan`, `/codepatrol-review`, `/codepatrol-apply`, `/codepatrol-verify`, and `/codepatrol-status` appear in the OpenCode slash menu. Each command loads the matching skill through the skill tool and passes `$ARGUMENTS` as the work intent. Restart OpenCode after installation so it reloads skill and command discovery. No `opencode.json`, plugin, custom tool, agent profile, or MCP server is required. `XDG_CONFIG_HOME` is honored when set.

### Install every harness

If all five harnesses are present on the same machine, install and verify them together:

```bash
node scripts/install-local.mjs --harness all
node scripts/verify-install.mjs --harness all
```

Pi is registered as a package. Codex and OpenCode deduplicate the shared `~/.agents/skills` destination; Claude Code and Kiro IDE keep harness-specific standalone destinations.

### Preview or uninstall

Preview any installation without writing by adding `--dry-run`. To uninstall, use the same harness name with `uninstall-local.mjs`:

```bash
node scripts/install-local.mjs --harness codex --dry-run
node scripts/uninstall-local.mjs --harness codex
```

The installer preflights every destination before writing and never replaces an existing file or directory it does not own. A failed Pi registration leaves the registry unchanged. Codex and OpenCode shared links remain until the last shared harness is uninstalled. Claude uses `~/.claude/skills`, and Kiro uses `~/.kiro/skills` for their standalone routes.

Specialized agent profiles are intentionally outside v1. Passing `--with-agent-profiles` returns an explicit error rather than silently installing provider-specific configuration.

Restart or reload the harness after updating skills if it caches discovery results.

## Repository layout

The core is harness-agnostic. Anything that must know about a specific harness is isolated in a root dotfolder named for that harness.

```text
bin/         # agnostic — CLI entry point
src/         # agnostic — CLI engine (graph, wiki, artifact, workflow)
skills/      # agnostic — canonical Agent Skills tree
  _shared/   #            shared skill contracts (ARTIFACTS, WORKFLOW, EXECUTION, SPEC)
  catalog.yaml
docs/        # agnostic — artifact packages, ADRs, OKF wiki
scripts/     # agnostic — installer, verifier, linters (the cross-harness install adapter)
.pi/         # harness-specific — Pi native extension source
.claude/     # harness-specific — this repository's Claude Code development settings
```

Rule: never place a harness name (`pi`, `claude`, `codex`, `opencode`, `kiro`) on anything outside its dotfolder or the installer. If a harness needs specific wiring, create `.<harness>/` at the root; do not create empty placeholder dotfolders. Only Pi currently needs adapter source — every other harness consumes the agnostic `skills/` tree through the installer.

The installer links only the four public workflow skills (`role: primary` in `skills/catalog.yaml`) into each harness's discovery directory. Support skills stay in `skills/` and are reached by the primaries through relative references, which resolve through the primary's symlink back into the source tree. This keeps discovery uncluttered and avoids generically named support skills colliding with skills from other sources.

## CLI

Every command accepts `--workspace <path>` and `--format text|json`. Workspace resolution is explicit flag, then `CODEPATROL_WORKSPACE`, then the CLI process directory. The core never silently reads `process.cwd()`.

```bash
codepatrol status --workspace "$PWD" --format json
codepatrol status --all --workspace "$PWD" --format json

codepatrol graph sync --workspace "$PWD" --format json
codepatrol graph overview --workspace "$PWD" --format json
codepatrol graph overview --path src --workspace "$PWD" --format json
codepatrol graph outline --file src/example.ts --workspace "$PWD" --format json
codepatrol graph find --query Example --workspace "$PWD" --format json
codepatrol graph neighbors --symbol Example --workspace "$PWD" --format json
codepatrol graph neighbors --file src/example.ts --relation tests --workspace "$PWD" --format json
codepatrol graph impact --file src/example.ts --workspace "$PWD" --format json
codepatrol graph impact --since-ref HEAD~10 --workspace "$PWD" --format json

codepatrol wiki status --workspace "$PWD" --format json
codepatrol wiki validate --workspace "$PWD" --format json
codepatrol wiki generate --workspace "$PWD" --format json
codepatrol wiki record --input result.json --workspace "$PWD" --format json

codepatrol artifact record --manifest .codepatrol/packages/2026-07-18-example/handoff.yaml --workspace "$PWD" --format json
codepatrol artifact validate --manifest .codepatrol/packages/2026-07-18-example/handoff.yaml --stage plan --workspace "$PWD" --format json
codepatrol artifact validate --manifest .codepatrol/packages/2026-07-18-example/handoff.yaml --stage review --workspace "$PWD" --format json
codepatrol artifact validate --manifest .codepatrol/packages/2026-07-18-example/handoff.yaml --stage implementation --workspace "$PWD" --format json

codepatrol workflow create --input workflow.json --workspace "$PWD" --format json
codepatrol workflow ready --workflow-id cpw-example --workspace "$PWD" --format json
codepatrol workflow claim --id cpw-task --actor codex --workspace "$PWD" --format json
codepatrol workflow update --id cpw-task --input update.json --workspace "$PWD" --format json
codepatrol workflow close --id cpw-task --result result.json --workspace "$PWD" --format json
codepatrol workflow remember --input memory.json --workspace "$PWD" --format json
codepatrol workflow prime --workflow-id cpw-example --budget 1200 --workspace "$PWD" --format json
codepatrol workflow compact --workflow-id cpw-example --workspace "$PWD" --format json
```

Run `codepatrol --help` for the complete option summary.

`codepatrol status` is the read-only entry point for open work: it lists active workflow roots from the local ledger together with non-`implemented` artifact packages from `.codepatrol/packages/`, correlating both by `workflow_id` (`--all` includes closed workflows and implemented packages). When several workflows are active, `codepatrol workflow prime` without `--workflow-id` resumes the most recently updated one and names the others in a warning so the resume target is never a silent guess.

### JSON contract

Successful commands write one JSON value to stdout:

```json
{
  "ok": true,
  "command": "graph.overview",
  "workspace": "/absolute/project",
  "data": {},
  "warnings": []
}
```

Failures are also machine-readable when `--format json` is used:

```json
{
  "ok": false,
  "command": "graph.overview",
  "error": {
    "code": "GRAPH_NOT_FOUND",
    "message": "Run codepatrol graph sync first.",
    "retryable": true
  }
}
```

Exit statuses are stable: `0` success, `2` invalid arguments, `3` invalid or untrusted workspace, `4` missing/incompatible state or invalid wiki/artifact validation, `5` operational failure, and `130` cancellation. Validation commands deliberately return a success envelope containing findings but exit `4` when their subject is invalid.

### Code graph

The incremental graph supports TypeScript/TSX, JavaScript, Python, Go, Java, and Rust. File content hashes avoid reparsing unchanged files. The graph records imports, calls, inheritance, and test relationships; call edges are labeled `extracted`, `inferred`, or `ambiguous`. Impact excludes ambiguous edges by default and reports them separately unless `--include-ambiguous` is passed.

`graph sync` is serialized by a workspace lock and writes with atomic rename. Readers use the last complete snapshot. A first sync can read the legacy `.pi/code-graph/graph.json`, but every new write goes to `.codepatrol/code-graph/graph.json`.

### OKF wiki

`docs/wiki/` is an OKF v0.1 bundle produced by the CLI; the directory is absent by default and a fresh checkout must run `codepatrol wiki status` (which reports `absent`) and then `codepatrol wiki generate` to produce the bundle. A missing bundle is a valid current state, not a defect. Do not commit a placeholder `index.md`; let the generator own the bundle. The root `index.md` declares only `okf_version: "0.1"`; conceptual pages have YAML frontmatter with a non-empty `type`; subdirectory indexes and `log.md` have no frontmatter. Unknown fields and concept types are preserved. Broken links and recommended-field omissions are warnings, while malformed structural fields are errors.

The freshness manifest lives separately at `.codepatrol/wiki/manifest.json`. `wiki status` requires a full rewrite when an existing tree is nonconformant, uses another OKF version, lacks a compatible manifest, or disagrees with the manifest's concept set. A rewrite does not import legacy wiki pages or metadata.

After `graph sync`, `wiki generate` provides the complete clean-workspace path: it groups files by graph cluster, produces architecture and module concepts with entry points, exported interfaces, dependencies, tests, and `path:line` citations, validates the staged OKF bundle, and commits it through the same recoverable rewrite transaction as `wiki record`. It deliberately generates concepts at architectural granularity rather than one page per file.

`wiki record` consumes JSON from a workspace-relative file or stdin (`--input -`). A minimal rewrite payload is:

```json
{
  "version": 1,
  "mode": "rewrite",
  "files": [
    {
      "path": "index.md",
      "content": "---\nokf_version: \"0.1\"\n---\n\n# Project wiki\n\n- [Architecture](architecture.md) - System map.\n"
    },
    {
      "path": "architecture.md",
      "content": "---\ntype: Software Architecture\ntitle: Architecture\ndescription: System modules and relationships.\n---\n\n# Architecture\n",
      "sources": ["src/main.ts"]
    }
  ],
  "remove": [],
  "updateAgentsPointer": true
}
```

Concept files must include `sources`, even if empty. Reserved `index.md` and `log.md` files do not. Incremental payloads contain only changed files and explicit removals. Record stages and validates the complete staged bundle before replacing the live tree, then atomically updates the manifest. Interrupted or failed transactions roll back to the previous bundle and manifest.

### Workflow memory

Workflow memory is a Codepatrol-owned operational ledger, not an integration with an external issue tracker. It records workflow roots, tasks, decisions, evidence, project memories, dependencies, claims, blockers, artifacts, and safe next actions. The portable package and human-readable wiki, `CONTEXT.md`, and ADR files remain the durable project documentation.

There are no mandatory workflow phases. Skills checkpoint after meaningful decisions, evidence, blockers, verification results, artifacts, and interruptions. `workflow ready` computes the executable frontier from open task/decision items whose incoming `blocks` relations are closed. `workflow claim` atomically moves one ready item to `in-progress`; `workflow close` records its verified result and releases dependents.

`workflow prime` reconstructs bounded resume context from the objective, current work, ready work, blockers, decisions, project memories, recent results, artifacts, and next actions. `workflow compact` archives old closed task/evidence records before shortening their active ledger representation; open work, workflow roots, decisions, and project memories are not compacted.

The schema, relation direction, status transitions, and payload examples are documented in [docs/workflow-memory.md](docs/workflow-memory.md).

### Artifact workflow and handoff

The public workflows form one artifact pipeline. They may be performed by the same harness or handed between different harnesses, but the contract is always one version-controlled package in the project:

```text
.codepatrol/packages/<work-id>/
├── handoff.yaml
├── spec.md
├── plan.md
├── review.md
├── implementation.md
├── verification.md
└── evidence/
```

| Workflow | Package responsibility |
|---|---|
| `codepatrol-plan` | Creates `handoff.yaml`, `spec.md`, `plan.md`, and optional evidence for a project, feature, architecture scan, or bug correction. |
| `codepatrol-review` | Creates `review.md`, records auditable spec/plan corrections, and approves or rejects an exact revision. |
| `codepatrol-apply` | Creates `implementation.md`, applies only an approved revision, and records execution and acceptance evidence. |
| `codepatrol-verify` | Creates `verification.md`, re-verifies an implemented revision independently, and records a `commit` or `improve` verdict. |

`codepatrol-plan` finishes with status `ready-for-review` and never edits production code. `codepatrol-review` validates the package, may correct only its governing artifacts with an audit trail, and grants `approved` only to the exact reviewed revision. `codepatrol-apply` accepts only a hash-valid package whose review verdict is `approve` (or its deprecated alias `merge`) for the current revision, and finishes at `implemented` without authorizing a commit. `codepatrol-verify` re-verifies that implementation against the plan, acceptance criteria, wider suite, blast radius, regressions, and unplanned changes, then grants `verified` only with verdict `commit`.

`handoff.yaml` binds every declared file by SHA-256. `artifact record` validates containment and refreshes hashes atomically. `artifact validate` is read-only and rejects missing files, stale content, path escapes, invalid lifecycle state, missing approval, or a stale reviewed revision. The additive `plan` stage enforces deterministic spec/plan format rules before producer handoff; it does not judge design semantics. The package travels through Git; `.codepatrol/workflows/` is local execution memory that can be recreated from `plan.md` and is not part of the portable handoff.

Harness identity does not create a branch, checkout, or parallel project structure. Collaboration happens through the artifacts and their lifecycle; the active Git topology remains a user or repository choice.

The detailed schema, lifecycle, rationale, and a Claude → Codex → Pi handoff example are in [docs/artifact-handoff.md](docs/artifact-handoff.md).

## Skills and execution model

Codepatrol exposes exactly four public workflow skills. The first is the producer; review, implementation, and verification form the shared downstream path:

- `codepatrol-plan` — turn a project, feature, architecture scan, or bug symptom into a normalized `spec.md` and context-free `plan.md`; it never edits production code.
- `codepatrol-review` — validate a proposal package or assess a diff/branch. For package review it may correct the spec and plan, increments their revision, records every adjustment in `review.md`, and returns `approve`, `fix-first`, or `rework`; it never edits production code.
- `codepatrol-apply` — validate that review approved the current package revision, reconstruct resumable tasks from the plan, execute them test-first, and record outcomes and deviations in `implementation.md`; it stops at `implemented` and recommends verification.
- `codepatrol-verify` — re-verify an implemented package independently of the session that produced it, execute the wider gate and blast-radius sweep, and record `commit` or `improve` in `verification.md`; it never edits production code.

```text
codepatrol-plan ──→ codepatrol-review ──→ codepatrol-apply ──→ codepatrol-verify
```

The supporting-skill catalog is:

- `codebase-design` — module depth, interfaces, seams, and relevant cross-cutting constraints.
- `codebase-wiki` — graph-backed architectural knowledge in OKF v0.1.
- `diagnose-bug` — reproduction, localization, hypotheses, and root cause.
- `domain-modeling` — project language and durable architectural decisions.
- `grilling` — one-decision-at-a-time design resolution.
- `writing-plans` — immutable, context-free executable plans with dependency and acceptance mappings.
- `research-technology` — primary-source and GitHub reference research that adapts concepts to the project being built or analyzed; it never introduces direct integration by default.
- `solution-simplification` — comprehension-first selection of the earliest sufficient solution, with a non-negotiable safety floor and evidence for the owned surface.
- `verification-strategy` — risk-based feedback loops, characterization, red-green-refactor, and verification matrices.
- `assess-change` — read-only contract/code assessment shared by reviews and implementation gates.
- `execute-change` — one claimed, bounded mutation behind `codepatrol-apply`, with verification and assessment evidence.

`skills/catalog.yaml` is the source of truth for primary/support roles, invocation edges, inputs, outputs, and mutation policy. Supporting skills are invoked by the public workflows; they are not additional product entry points. All deterministic graph, wiki, artifact, and workflow-memory operations go through the CLI.

The shared execution protocol defines bounded units with objective, scope, access mode, dependencies, input, and evidence-bearing output. The main conversation remains coordinator, performs graph sync once, owns wiki writes, waits at a barrier, verifies evidence, and synthesizes the final result. Native delegation is optional; sequential execution is semantically equivalent.

Pi's native extension registers only `/codepatrol-plan`, `/codepatrol-review`, `/codepatrol-apply`, `/codepatrol-verify`, and `/codepatrol-status`. These commands send a kickoff for the canonical skill and explicitly select the sequential fallback. The package registers no `subagent` tool and starts no child Pi processes.

## State and safety

Shared state has a provider-neutral home:

```text
.codepatrol/
├── code-graph/graph.json
├── wiki/manifest.json
├── workflows/
│   ├── ledger.json
│   └── archive/
├── locks/
└── version.json
```

User-controlled paths must be workspace-relative. Traversal, absolute paths, and symlink escapes are rejected. Artifact entries must additionally remain inside their own package directory. Graph, wiki, artifact, and workflow writers use per-workspace locks, cancellation checks, and atomic files; wiki replacement is additionally recoverable as a transaction. Workflow claims serialize through the ledger lock. Generated `.codepatrol/` state is ignored by this repository; artifact packages under `.codepatrol/packages/` are intended for version control.

## Development

```bash
npm run typecheck
npm test
npm run lint:skills
npm run build
npm run verify
```

The tests cover graph extraction/query contracts, incremental and legacy state, workspace/package containment, locks and cancellation, CLI envelopes and exit statuses, OKF validation and transactional replacement, artifact integrity/approval, workflow dependency/claim/resume/compaction semantics, catalog-driven skill linting, installer ownership/idempotency, and the thin Pi extension.

Manual harness checks are documented in [docs/smoke-tests.md](docs/smoke-tests.md).

## Troubleshooting

- `GRAPH_NOT_FOUND`: run `codepatrol graph sync` for the same workspace.
- `STATE_INCOMPATIBLE` from incremental wiki record: run `graph sync` and `wiki generate`, or provide a complete payload with `mode: "rewrite"`.
- `LOCK_TIMEOUT`: another writer owns the named lock; let it finish. A dead local PID is reclaimed automatically.
- `WORKFLOW_CONFLICT`: the item is already claimed, closed, not actionable, or still blocked; inspect it and query `workflow ready` instead of bypassing the ledger.
- `WORKFLOW_INVALID`: repair or restore the structurally invalid ledger before continuing; Codepatrol will not guess through corrupted memory.
- `ARTIFACT_INVALID`: restore the declared package files/provenance, run `artifact record` only when intentionally publishing a new revision, and repeat stage validation; never bypass a hash or approval failure.
- Installer conflict: move or remove the user-owned destination yourself, or choose a different harness. Codepatrol will not overwrite it.
- `Pi executable not found`: installation is rolled back. Install Pi and rerun the same installer command.
- Broken links after moving this checkout: rerun `install-local.mjs`, then `verify-install.mjs`.

## License

MIT. See [LICENSE](LICENSE).
