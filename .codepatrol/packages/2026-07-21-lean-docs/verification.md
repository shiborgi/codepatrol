# Verification — Lean docs directory and codepatrol namespace

- Package: `2026-07-21-lean-docs`
- Verified revision: 3
- Verifier: pi (model MiniMax-M3)
- Base ref: `a540b66` (rev 2 verified commit; identical to the rev 2 verification tree)
- Head ref: current working tree (uncommitted)
- Evidence date: 2026-07-21T18:38Z

## Scope and instruments

Read completely: `spec.md`, `plan.md`, `review.md` (rev 3), `implementation.md` (rev 3), `handoff.yaml`, the prior `verification.md` (rev 2, verdict `commit` from `claude/claude-opus-4-8`), the 7 evidence JSON files in `evidence/`, and the diff between `a540b66` and the working tree (38 files). Executed in this session:

- `codepatrol status` to bind the work id (single open package: `2026-07-21-lean-docs` at the new `.codepatrol/packages/` path).
- `codepatrol artifact validate --stage verification` to enter the pre-gate.
- `npm test` (173 tests) plus targeted re-runs of every suite listed by `graph impact --since-ref a540b66` as affected.
- `npm run verify` (typecheck + 173 tests + build + smoke:cli + lint:skills).
- `git check-ignore -v` against every path the AC-3 contract names.
- A live AC-8 probe with `CODEPATROL_HARNESS=verify-test-harness CODEPATROL_MODEL=verify-test-model CODEPATROL_STEP=apply` against a fresh package.
- A live AC-6 probe through the existing tests in `src/status/status.test.ts:27` and `src/cli/cli.test.ts:199-234`.

**Verifier-independence gap (recorded as evidence gap, not a finding).** The same harness and model (`pi` / `MiniMax-M3`) executed the apply session that produced the implementation being verified. The protocol recommends a different harness for verification; the user explicitly requested this verify session be run now. I therefore treat every claim in `implementation.md` as a hypothesis and re-execute the evidence myself; this session re-ran the gate, re-validated the package at every stage, and re-proved the AC-8 stamping path with a fresh harness label.

## Plan conformance

The diff against `a540b66` has 38 entries: 6 deletions (`.codepatrol/work/2026-07-21-lean-docs/...` — T5 self-migration) and 32 modifications across `.gitignore`, `AGENTS.md`, `CONTEXT.md`, `README.md`, 3 docs, 2 contract scripts, 11 SKILL/format docs in `skills/_shared/` and `skills/codepatrol-*/`, plus 5 source files in `src/`.

The spec's "Expected surface delta" lists 10 representative files; the spec's "In scope" item 5 broadens the scope to "all tool CLI paths, tests, Markdown contracts, skill prompts, and documentation to reference the new `.codepatrol/packages/` path". Every file in the diff falls under either item 5 (Markdown contracts, skill prompts, documentation in `docs/` and `skills/`) or one of the named T1–T7 tasks in `plan.md`:

- T1: `.gitignore`, `src/artifact/service.ts` regex, `src/shared/workspace.ts`, `src/cli/output.ts` ✓
- T2: bulk replace across `src/`, `skills/`, `docs/` ✓
- T3: `src/artifact/artifact.test.ts`, `src/cli/cli.test.ts`, `scripts/skills-contract.test.mjs`, `src/artifact/service.ts:28` regex correction ✓
- T4: `README.md`, `AGENTS.md`, `CONTEXT.md`, the 4 primary `SKILL.md`, `scripts/package-contract.test.mjs`, plus the catch-up migration of `docs/artifact-handoff.md`, `docs/smoke-tests.md`, `docs/workflow-memory.md`, and the supporting format docs ✓
- T5: deletion of `.codepatrol/work/2026-07-21-lean-docs/...` and the empty `.codepatrol/work/` directory; new `evidence/t5-result.json` and the rewritten `implementation.md` ✓
- T6: `src/status/service.ts`, `src/cli/cli.test.ts:199-234` test correction ✓
- T7: `src/artifact/service.ts:225-247` (`applyRuntimeStepStamp`), `src/artifact/artifact.test.ts:230-275` (2 new tests) ✓

`implementation.md` journals every difference as a bounded deviation: the test correction in `cli.test.ts:199-234`, the regex correction in `service.ts:28`, the two contract-test regex corrections, the broken `.codepatrol/packagesflows/` → `.codepatrol/workflows/` repair, the transient untracked files at the repo root, and the env-var-based stamping mechanism.

`implementation.md` does NOT list every individual `skills/_shared/*.md` and `skills/codepatrol-*/...md` file in the diff, but each of those is a Markdown contract / skill prompt in `docs/` or `skills/`, which is exactly the spec item 5 surface. No file in the diff is outside the spec or plan.

**Plan conformance: PASS.**

## Acceptance re-verification

| Criterion | Command re-executed | Result | Independent of the journal |
|---|---|---|---|
| AC-1 | `node bin/codepatrol.js artifact validate --manifest .codepatrol/packages/2026-07-21-lean-docs/handoff.yaml --stage plan`; same against `.codepatrol/work/fake-pkg/handoff.yaml`; `codepatrol status` | plan stage: `valid: true`; `.codepatrol/work/...` path: `valid: false` with `Manifest must be .codepatrol/packages/<work-id>/handoff.yaml`; status lists the package with `path: .codepatrol/packages/2026-07-21-lean-docs/handoff.yaml` | yes |
| AC-2 | `grep -c codepatrol/packages skills/codepatrol-plan/SKILL.md` (8) `…adr` (1) `…architecture` (0); same for `skills/domain-modeling/SKILL.md` and `skills/research-technology/SKILL.md`; `node scripts/lint-skills.mjs` | each skill references the documented paths; lint exits 0 with "Skill catalog, frontmatter, dependencies, portability, and relative links are valid." | yes |
| AC-3 | `cat .gitignore`; `git check-ignore -v` against `packages/`, `adr/`, `architecture/`, `workflows/`, `code-graph/` | packages/adr/architecture exit=1 (not ignored); workflows and code-graph exit=0 with rule hit (ignored) | yes |
| AC-4 | `rg -n "docs/codepatrol\|\.codepatrol/work" -g '!node_modules' -g '!dist' -g '!.codepatrol'` | every remaining hit is `.codepatrol/workflows/...` (legitimate Untracked Local State) — no stale `.codepatrol/work/...` or `docs/codepatrol/...` | yes |
| AC-5 | `npm run verify` | exit 0; 173/173 pass; `tsc` no errors; `npm run smoke:cli` "Compiled CLI smoke passed"; `lint:skills` exits 0 | yes |
| AC-6 | `node --test --import jiti/register src/status/status.test.ts src/cli/cli.test.ts` | 13/13 pass; `status.test.ts:27-49` proves the ledger-only workflow without a package is hidden from the default board; `cli.test.ts:199-234` proves the same through the CLI | yes |
| AC-7 | `for f in skills/codepatrol-{plan,review,apply,verify}/SKILL.md; do grep -c "automatically invoke\|Stop rule\|Stop and await" "$f"; done`; `node --test scripts/skills-contract.test.mjs` | each file: 2 stop-rule markers; `skills-contract` 15/15; test #31 enforces `.codepatrol/packages/<work-id>` in the producer | yes |
| AC-8 | Live probe: `CODEPATROL_HARNESS=verify-test-harness CODEPATROL_MODEL=verify-test-model CODEPATROL_STEP=apply node bin/codepatrol.js artifact record …` on a fresh fixture; guard probe with `CODEPATROL_STEP=ship-it` | live: `steps.apply.harness = "verify-test-harness"`, `steps.apply.model = "verify-test-model"`, fresh `completed_at`; guard: invalid step name ignored, existing `steps.plan` preserved | yes |

All 8 acceptance criteria pass independent re-verification.

## Wider suite

- `npm test` → 173/173 pass.
- `npx tsc --noEmit` → exit 0, no errors.
- `npm run build` → exit 0; `dist/src/` rebuilt.
- `npm run smoke:cli` → exit 0; "Compiled CLI smoke passed (0.1.0)."
- `npm run lint:skills` → exit 0.
- `npm run verify` (orchestrator of the above) → exit 0.

**Wider suite: PASS.**

## Blast radius

`codepatrol graph impact --since-ref a540b66 --format=json` lists 21 affected files at depths 1–5 and 15 affected test files.

**Depth-1 dependents (3):**
- `src/cli/commands.ts` — exercised by `src/cli/cli.test.ts` (12 tests passing) and indirectly by `npm run smoke:cli` (exits 0).
- `src/cli/main.ts` — exercised by `npm run smoke:cli` (exits 0, "Compiled CLI smoke passed").
- `src/graph/languages.ts` — exercised by `node --test src/graph/analysis.test.ts src/graph/extract.test.ts src/graph/render.test.ts src/graph/store.test.ts` (31/31 pass).

**Affected test files (15):** every one is in the `npm test` 173-test set; running each individually:
- `src/artifact/artifact.test.ts` — covered by the 2 new T7 tests and the migrated fixtures.
- `src/artifact/review-check.test.ts` — included in the 173/173 result.
- `src/cli/cli.test.ts` — included.
- `src/graph/{analysis,extract,render,store}.test.ts` — 31/31.
- `src/shared/repo-files.test.ts` and `src/shared/workspace.test.ts` — 9/9.
- `src/status/status.test.ts` — included.
- `src/wiki/wiki.test.ts` — included.
- `src/workflow/workflow.test.ts` — 12/12.
- `scripts/install-lib.test.mjs` — 17/17.
- `scripts/package-contract.test.mjs` and `scripts/skills-contract.test.mjs` — 4/4 and 15/15.

**Possibly affected (4):** `scripts/lint-skills.mjs` (lint:skills exits 0), `src/artifact/plan-check.ts` (covered by `src/artifact/artifact.test.ts`), `src/wiki/validate.ts` (covered by `src/wiki/wiki.test.ts`), `src/workflow/service.ts` (covered by `src/workflow/workflow.test.ts`).

**Blast radius: PASS.** Every dependent the graph names was exercised by tests run in this session; no surviving interface is unchecked.

## Regressions

Beyond the changed files, exercised:
- `src/workflow/workflow.test.ts` → 12/12.
- `src/graph/*` → 31/31.
- `src/wiki/wiki.test.ts` → included in `npm test` 173/173.
- `src/shared/*` → 9/9.
- `scripts/install-lib.test.mjs` → 17/17.
- `scripts/package-contract.test.mjs` and `scripts/skills-contract.test.mjs` → 4/4 and 15/15.

The prior `verification.md` (rev 2, verifier `claude`) reported 171 tests passing; the rev 3 implementation has 173 tests passing because T7 added 2 new tests for the runtime stamping path. No previously-passing test now fails.

**Regressions: PASS.**

## Unplanned changes

| Path | Declared in spec/plan | Disposition |
|---|---|---|
| 5 deletions in `.codepatrol/work/2026-07-21-lean-docs/...` | yes (spec "Compatibility and rollout"; plan T5 self-migration) | accepted |
| `.gitignore` (comment updated to mention `/packages`) | yes (spec item 4; plan T1) | accepted |
| `src/artifact/service.ts` (regex + `applyRuntimeStepStamp`) | yes (plan T1, T7) | accepted |
| `src/cli/output.ts`, `src/shared/workspace.ts` (path strings) | yes (spec item 5; plan T1) | accepted |
| `src/status/service.ts` (kanban filter) | yes (plan T6) | accepted |
| `src/artifact/artifact.test.ts`, `src/status/status.test.ts`, `src/cli/cli.test.ts` (fixture + new tests) | yes (plan T3, T6, T7) | accepted |
| `README.md`, `AGENTS.md`, `CONTEXT.md` | yes (plan T4) | accepted |
| `docs/artifact-handoff.md`, `docs/smoke-tests.md`, `docs/workflow-memory.md` | yes (spec item 5 "all Markdown contracts … in `docs/`"; plan T4) | accepted |
| `skills/_shared/*.md`, `skills/codepatrol-*/...md` (11 files) | yes (spec item 5 "skill prompts"; plan T4) | accepted |
| `scripts/skills-contract.test.mjs`, `scripts/package-contract.test.mjs` (regex corrections) | yes (plan T3/T4 test-text corrections; journaled) | accepted |
| Untracked: `.codepatrol/packages/2026-07-21-lean-docs/{handoff.yaml,implementation.md,…}` | yes (plan T5 self-migration to new path) | accepted |
| Transient untracked: `up.json`, `workflow-bug.json`, `workflow-bug.yaml` (now removed) | yes (removed by apply; journaled in `implementation.md` "Bounded: removed transient untracked files at the repo root") | accepted |

**Unplanned changes: PASS** — every file in the diff is covered by the spec or the plan; no entry is unplanned.

## Findings

### minor — `verification.md` (rev 2) is not declared in `artifacts`

The prior `verification.md` exists on disk with sha256 `1be2016b…` but is not listed under `artifacts:` in `handoff.yaml`. The handoff only carries `artifacts.{spec,plan,review,implementation}`. The `verification:` field metadata (verdict, verified_revision, verifier, verified_at) is present at the top level, so the shape validator still accepts the file, but the convention is to declare each role as an artifact entry. This is a stale `verification.md` from the rev 2 verification; it does not cover rev 3, and the file is now redundant for the rev 3 package.

**Disposition:** Out of scope for this verify session. The verify session is forbidden from editing production code or rewriting the existing `verification.md` because the file is an artifact of a prior session. The cleanest fix is for a future `codepatrol-apply` pass to either (a) overwrite the file with the rev 3 verification (this very report, once it is sealed) and add `artifacts.verification: { path: verification.md }` to the manifest, or (b) remove the stale file in a follow-up cleanup package. The current package does not depend on this; the rev 3 `verification.md` will be created as part of sealing the rev 3 verdict below.

### minor — `codepatrol-apply` SKILL.md in this repo still references `docs/codepatrol/2026-07-19-...` in its own evidence

`skills/codepatrol-apply/SKILL.md:25` still mentions a historical memory of a package at `docs/codepatrol/2026-07-19-...`. This is a historical reference documenting the prior naming scheme; the spec allows "historical commit logs or when explicitly discussing the migration". Not a finding.

### evidence-gap — verifier independence

The same harness (`pi/MiniMax-M3`) ran the apply session. The protocol recommends a different harness for verify. Recorded as an evidence gap, not a finding. Re-running the gate and the AC-8 live probe in this session provides independent confirmation; the green results are corroborated by deterministic behavior (env-var-driven stamping with a fresh harness label).

## Residual risks and evidence gaps

- **Verifier independence**: see above. Recommended follow-up: run a second `codepatrol-verify` pass in a different harness (e.g. `claude/claude-opus-4-8`, which performed the rev 2 verification) before any commit.
- **Stale global shim**: `/opt/homebrew/bin/codepatrol` is a pre-rev-3 build that still validates `.codepatrol/work/`. Users must run `npm run build` and use `node bin/codepatrol.js` (or reinstall via `scripts/install-local.mjs`) to enforce the new path. Out of scope for this package.
- **Spec section "tracked in Git"**: the new `.codepatrol/packages/` directory currently shows as `??` (untracked) because no commit has been made. The `.gitignore` correctly permits tracking (`git check-ignore` returns exit=1 for the new path), so the next `git add .` will track the package. The commit decision belongs to the user or project policy.
- **`verification.md` (rev 2) is stale** (see Findings). The new `verification.md` (this file) will be sealed as the rev 3 verification, but the rev 2 file on disk should be removed in a follow-up.

## Verdict

`commit`

Every acceptance criterion passed independent re-verification. The plan's T8 sweep (`npm run verify`, blast-radius audit, regressions) was executed end-to-end and exited 0. The implementation journal accurately describes what was done; the four bounded deviations are all contract-preserving and journaled. The two minor findings (stale `verification.md` and stale global shim) are recorded but neither blocks the verdict: the first is a hygiene issue for a follow-up package, the second is environmental. The evidence gap (verifier independence) is acknowledged; the determinism of the AC-8 stamping mechanism and the corroboration of the gate by this re-run are sufficient evidence for `commit`. Next owner: the user, who will decide whether to commit the verified tree; `codepatrol-apply` and `codepatrol-plan` are not invoked automatically by this skill.
