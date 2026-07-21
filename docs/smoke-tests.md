# Manual smoke tests

Run the automated gate first:

```bash
npm run verify
```

Use a disposable repository for graph/wiki exercises. Never point a rewrite payload at a wiki whose content you intend to keep.

## CLI and compiled package

- Run `npm link`, then confirm `codepatrol --version` prints the package version.
- In a path containing spaces, run `graph sync`, `overview`, `outline`, `find`, `neighbors`, and `impact` with `--format json`; parse each stdout value as JSON.
- Set `CODEPATROL_WORKSPACE`, omit `--workspace`, and confirm the canonical workspace in the envelope.
- Try a `../` path and confirm exit `3` with `INVALID_WORKSPACE`.
- Interrupt a large `graph sync`; confirm exit `130`, no partial JSON, and a subsequent sync succeeds.
- Hold a writer lock with another process; confirm timeout diagnostics name its PID and command.

## Wiki

- Run `wiki status` with no wiki and confirm it reports absent without modifying the workspace.
- After `graph sync` in a workspace without `docs/wiki/`, run `wiki generate`; confirm it creates a valid architecture page and graph-cluster module pages with `path:line` citations rather than one page per file.
- Commit a complete valid rewrite payload and confirm `docs/wiki/index.md` plus `.codepatrol/wiki/manifest.json` exist, while `docs/wiki/manifest.json` does not.
- Run `wiki validate`, hash the tree before and after, and confirm validation is read-only.
- Add a broken relative link and confirm it is a warning; remove a concept's `type` and confirm exit `4` with a structural error.
- Modify a recorded source and confirm `wiki status` marks its concept stale.
- Attempt an invalid rewrite and confirm the previous bundle and manifest are byte-for-byte unchanged.
- Rewrite without a legacy page and confirm that obsolete page disappears.

## Workflow memory

- Create a workflow plus two tasks where the first blocks the second; confirm `workflow ready` returns only the first and returns the second after closing it.
- Race two `workflow claim` commands against one item; confirm one succeeds and the other returns `WORKFLOW_CONFLICT` without ledger corruption.
- Interrupt after recording `nextAction`, start a fresh harness context, and confirm `workflow prime` recovers the objective, decisions, artifacts, blockers, and next action within its budget.
- Try to create an `in-progress` item or update one directly to `closed`; confirm the CLI requires `claim` and `close`.
- Create a blocking or parent cycle and confirm `WORKFLOW_INVALID` leaves the previous ledger unchanged.
- Compact old closed work and confirm its archive retains the original while decisions, memories, and open work remain uncompacted.

## Artifact handoff

- Create `.codepatrol/work/<work-id>/` with `handoff.yaml`, `spec.md`, and `plan.md`; run `artifact record` and confirm all declared files receive SHA-256 values.
- Run `artifact validate --stage review`, hash the package before and after, and confirm validation is read-only.
- Change `plan.md` without recording it and confirm review validation exits `4` with a hash mismatch.
- Try `../`, an absolute path, a duplicate declaration, and a symlink outside the package; confirm each fails without rewriting the prior manifest.
- Add `review.md`, status `approved`, verdict `merge`, and a matching `reviewed_revision`; record and confirm implementation validation passes.
- Change only the manifest revision or use `fix-first`; confirm implementation validation rejects the package.
- Copy or merge the package into a fresh checkout without `.codepatrol/workflows/`; confirm `codepatrol-apply` can reconstruct its task ledger from `plan.md`.

## Installation

- Run `install-local.mjs --harness all --dry-run`; confirm no destination or registry is created.
- After a real install, confirm exactly the five primary entry points (`codepatrol-plan`, `codepatrol-review`, `codepatrol-apply`, `codepatrol-verify`, `codepatrol-status`) are linked into each discovery directory and no support skill is. Confirm a primary's `../<support>/SKILL.md` reference still resolves through the symlink to the source tree.
- Install twice; confirm the second run reports owned links as `ok`.
- Put a user-owned directory at two skill destinations and run `--dry-run`; confirm both are reported as `conflict` (not just the first) and nothing is written. Run without `--dry-run`; confirm it refuses and creates no links.
- Rename a directory inside the checkout, then re-install; confirm links left stale by the rename are `relinked` to the new path rather than refused, because they still point inside an owned root. Uninstall; confirm the broken owned links are removed.
- Uninstall Codex while OpenCode remains registered; confirm shared `~/.agents/skills` links remain. Uninstall the final shared harness and confirm only Codepatrol-owned links disappear.
- Move the checkout, run `verify-install`, and confirm it reports broken/missing links; reinstall from the new location.

## Primary entry points

- Confirm the harness presents `codepatrol-plan`, `codepatrol-review`, `codepatrol-apply`, `codepatrol-verify`, and `codepatrol-status` as the primary entry points. The four Public Workflows are Plan, Review, Apply, and Verify; `codepatrol-status` is a primary skill that reports open work and owns no lifecycle stage. Supporting skills are not linked as separate entry points; the primaries reach them through relative references into the source tree.
- Run `codepatrol-plan` once for a greenfield project/feature and once for an architecture scan or bug symptom in an existing repository. Confirm both produce `handoff.yaml`, `spec.md`, and `plan.md` with status `ready-for-review` and never edit production code.
- Confirm that in architecture or bug mode, `codepatrol-plan` states the mode first, preserves the analysis in `evidence/analysis.md`, selects one correction, and does not implement it.
- Confirm the produced spec records the earliest sufficient solution rung, evidence against earlier rungs, the retained safety floor, expected surface delta, and either complete trigger-bearing deferred constraints or an explicit reason that none exist.
- Give `codepatrol-plan` a GitHub reference. Confirm `research-technology` pins a revision, separates facts/inferences/recommendations, adapts concepts to the target project, and introduces no dependency or integration by default.
- Run `codepatrol-review` on a handoff package. Confirm it validates the incoming hashes, records every bounded spec/plan adjustment in `review.md`, increments the governing revision, and grants `approved` only when the resulting package passes implementation validation.
- Deliberately add an unnecessary wrapper, option, dependency, or duplicated helper to a package/diff. Confirm review classifies the evidence as `remove`, `reuse`, `built-in`, `speculative`, or `simplify`, while preserving applicable safety and acceptance checks.
- Add a deferred constraint without an observable trigger or upgrade path. Confirm review returns `fix-first` or `rework` rather than approving an invisible future risk.
- Run `codepatrol-review` on a branch diff. Confirm contract/code findings and a `merge`, `fix-first`, or `rework` verdict are returned without modifying production code.
- Run `codepatrol-verify` on an implemented package and confirm it produces `verification.md`, exactly one `commit` or `improve` verdict, and the matching manifest status transition without editing production code.
- Run `codepatrol-apply` on an unreviewed, stale, and approved package. Confirm only the approved current revision reaches production edits, plan tasks become resumable workflow items, and execution evidence goes to `implementation.md` rather than modifying the plan.
- Confirm implementation reconciles actual files, dependencies, public interfaces, configuration, and runtime state with the forecast, and does not report counterfactual savings without a controlled baseline.

## Pi

- Install with `--harness pi`, reload Pi, and confirm exactly the five commands `/codepatrol-plan`, `/codepatrol-review`, `/codepatrol-apply`, `/codepatrol-verify`, and `/codepatrol-status` are present.
- Confirm the package does not add a `subagent` tool.
- Start a workflow that defines two independent read-only units and confirm Pi executes both sequentially before synthesis.
- Run graph commands through the shell and confirm no MCP configuration is needed.

## Claude Code

- Confirm the skills appear from `~/.claude/skills` after reload.
- Run a workflow with two independent read-only units; confirm native delegation waits for both before synthesis.
- Disable or deny native delegation and confirm the same units execute sequentially.
- Confirm no MCP configuration or provider-specific profile was created.

## Codex

- Confirm the skills appear from `~/.agents/skills` after reload.
- Run a workflow with independent read-only units; confirm native delegation respects the harness limit and reaches the barrier before synthesis.
- Run the same workflow without delegation and confirm the required output shape is unchanged.
- Confirm no plugin, agent profile, or MCP server is required.

## Kiro IDE

- Confirm the skills appear from `~/.kiro/skills` after reloading the IDE.
- Run graph commands through the shell and use native subagents for an independent read-only group.
- Disable subagents and confirm the sequential fallback completes the same group.
- Confirm installation created no `mcp.json`, Power, Spec, Hook, or agent profile.

## OpenCode

- Confirm the skills appear from `~/.agents/skills` after reload.
- Run graph commands through bash and an independent read-only group through native delegation when allowed.
- Disable native task delegation and confirm the sequential fallback completes.
- Confirm no `opencode.json`, plugin, custom tool, profile, or MCP server is required.
