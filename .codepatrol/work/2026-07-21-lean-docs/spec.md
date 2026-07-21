# Specification — Lean docs directory and codepatrol namespace

## Intent

- Origin: improve-codebase
- Mode: architecture
- Target baseline: branch `main`, `HEAD` = `2d69b44`, clean tree
- Governing constraints: `CONTEXT.md` terms **Change Package**. 
- Substrate state: graph synced at this baseline; wiki `absent`.
- Problem: The `docs/` directory is cluttered with process artifacts and operational records (`.codepatrol/work/` for change packages, `.codepatrol/adr/` for architectural decisions, and `.codepatrol/architecture/` for standalone research). This mixes functional project documentation (like the wiki and static manuals) with meta-work and agentic records.
- Outcome: `docs/` contains only functional project documentation. All process artifacts, ADRs, and standalone research are migrated into the `.codepatrol/` namespace (which already holds operational workflows and graph data), separating the tool's footprint from the project's documentation. The new subdirectories are tracked in Git.

## Scope

### In scope

1. Migrate the location of artifact change packages from `.codepatrol/work/<work-id>/` to `.codepatrol/work/<work-id>/`.
2. Migrate the location of Architecture Decision Records from `.codepatrol/adr/` to `.codepatrol/adr/`.
3. Migrate the location of standalone research analyses from `.codepatrol/architecture/` to `.codepatrol/architecture/`.
4. Update `.gitignore` to ensure `.codepatrol/work/`, `.codepatrol/adr/`, and `.codepatrol/architecture/` are tracked by Git, while maintaining the ignore rules for `.codepatrol/workflows/` and `.codepatrol/code-graph/`.
5. Update all tool CLI paths, tests, Markdown contracts, skill prompts, and documentation to reference the new paths.
6. The `docs/wiki/` directory and existing functional markdowns (`artifact-handoff.md`, `smoke-tests.md`, `workflow-memory.md`) remain in `docs/`.

### Out of scope

- Renaming the `.codepatrol/` folder itself to remove the dot. It remains a hidden operational folder to keep the root directory clean.
- Changing the internal structure or schema of change packages, ADRs, or analyses. Only their parent directory is changing.
- Modifying the wiki path (`docs/wiki/`).

## Current evidence

- `src/artifact/service.ts:221` and `:337` hardcode `.codepatrol/work`.
- `.gitignore` broadly ignores `.codepatrol/`.
- Over 25 files in `src/`, `docs/`, `skills/`, and `README.md` contain literal strings like `.codepatrol/work`, `.codepatrol/adr/`, and `.codepatrol/architecture/`.

## Proposed design

**Namespace consolidation.** We will consolidate all agentic process artifacts under `.codepatrol/`. 
- Packages: `.codepatrol/work/`
- ADRs: `.codepatrol/adr/`
- Research: `.codepatrol/architecture/`

To allow committing these artifacts, we will replace the broad `.codepatrol/` ignore rule in `.gitignore` with specific rules for local-only state:
```text
.codepatrol/workflows/
.codepatrol/code-graph/
```
This cleanly splits the tool's footprint into *Tracked Process Artifacts* and *Untracked Local State*, all within the single `.codepatrol` root.

**Path updates.** We will mechanically replace `.codepatrol/work` with `.codepatrol/work`, `.codepatrol/adr` with `.codepatrol/adr`, and `.codepatrol/architecture` with `.codepatrol/architecture` across all source code, tests, and markdown files. The regex matching for task file markers and package resolution will be adjusted accordingly.

## Simplicity decision

- Selected rung: local reuse. 
- Reused capabilities: The `.codepatrol/` namespace already exists and is the logical owner for these files. We reuse the existing CLI logic by simply updating the root path variables.
- Expected surface delta: **Modified** — `.gitignore`, `src/artifact/service.ts`, `src/artifact/artifact.test.ts`, `src/artifact/review-check.test.ts`, `src/cli/output.ts`, `src/cli/cli.test.ts`, `CONTEXT.md`, `README.md`, `AGENTS.md`, and multiple `SKILL.md` and format documents in `skills/` and `docs/`. **No** new dependencies, stages, or schemas.

## Deferred constraints

None.

## Compatibility and rollout

- This is a breaking change for the physical location of artifacts. The current implementation journal and package files will be moved by `codepatrol-apply` itself during the execution of this very plan. The apply script must carefully move its own package directory and then continue updating files.
- To safely migrate the active package `2026-07-21-lean-docs`, the implementation task will move `.codepatrol/work/2026-07-21-lean-docs` to `.codepatrol/work/2026-07-21-lean-docs` as the *last* step, and update the execution context so that the final validation runs against the new path.

## Acceptance criteria

- AC-1: WHEN the `codepatrol artifact validate` or `codepatrol status` CLI commands run, THEY resolve packages from `.codepatrol/work/` instead of `.codepatrol/work/`.
- AC-2: WHEN `codepatrol-plan` or `domain-modeling` define new artifacts, THEY reference `.codepatrol/work/`, `.codepatrol/adr/`, and `.codepatrol/architecture/`.
- AC-3: `.gitignore` ignores `.codepatrol/workflows/` and `.codepatrol/code-graph/` but permits tracking of packages and ADRs.
- AC-4: No references to `.codepatrol/work`, `.codepatrol/adr`, or `.codepatrol/architecture` remain in the repository text (except historical commit logs or when explicitly discussing the migration).
- AC-5: `npm run verify` exits 0 with all tests passing.
