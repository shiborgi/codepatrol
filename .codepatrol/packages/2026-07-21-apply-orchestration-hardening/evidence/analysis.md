# Architecture analysis — 2026-07-21

## Scope and evidence

Scope is the v1 release branch at `1f03fd2` (`v1-release`), with a clean working tree before this package was created. The request is an architecture-mode assessment of the Qodo PR comments, the Apply step, and the skill catalog/invocation model; it is not permission to edit production code.

Evidence gathered in this session:

- `node bin/codepatrol.js graph sync --workspace "$PWD" --format json`: graph revision refreshed; 58 files, 1,579 symbols, 2,803 calls, and 83 test edges.
- `node bin/codepatrol.js wiki status --workspace "$PWD" --format json`: graph present; wiki absent with six generated concepts stale/missing. The absence is a valid current substrate state, not proof that the product must commit a placeholder wiki.
- `node bin/codepatrol.js graph impact --file src/shared/lock.ts ...`: lock callers include artifact, graph, wiki, workflow, status, and their tests; `src/shared/workspace.test.ts` is the direct test seam.
- `node bin/codepatrol.js graph impact --file scripts/install-lib.mjs ...`: installer tests and all local installer entry points are affected.
- `node bin/codepatrol.js graph impact --file src/workflow/types.ts ...`: workflow service/store, CLI/status, and workflow/status tests are affected.
- `npm run verify`: typecheck passed, then the suite stopped at 172/173 because `scripts/install-lib.test.mjs` calls `verify()` without a fake `codepatrol` executable in the OpenCode-only case. This is a pre-existing environmental/test-isolation defect exposed by the current checkout; it is not evidence that the Qodo symlink concern is fixed.
- Direct reads: `src/shared/lock.ts`, `scripts/install-lib.mjs`, `src/workflow/types.ts`, `src/workflow/store.ts`, `src/workflow/service.ts`, primary skills, `skills/catalog.yaml`, `.opencode/commands/*.md`, and the Qodo report.

The committed `2026-07-21-lean-docs` package is already verified at revision 3, but its own historical evidence intentionally contains old paths. The current `.opencode/commands/codepatrol-plan.md` still directs a producer to `docs/codepatrol/<work-id>` and the review command still says `merge`, so the release has a real contract-drift surface beyond the Qodo report.

## Candidates

### 1. Apply orchestration and contract hardening — `Strong`

- **Files/seams:** `skills/catalog.yaml`, primary/support `SKILL.md` contracts, `scripts/lint-skills.mjs`, `scripts/skills-contract.test.mjs`, `src/shared/lock.ts`, `scripts/install-lib.mjs`, `src/workflow/types.ts`, workflow tests, and stale OpenCode command templates.
- **Problem:** The most consequential failure is not one isolated comment: the Apply step relies on prose for preconditions, task ordering, support-skill triggers, and stop behavior while the catalog validates only reciprocal edges and acyclicity. At the same time, shared lock cleanup and installer link type are production reliability seams. The current `verify` failure also shows a test harness dependency is not isolated.
- **Proposed shape:** Keep the existing harness-agnostic pipeline and sequential fallback, but make the Apply contract explicit and machine-checkable at the catalog/skill boundary: exact entry preconditions, per-task execution order, conditional support triggers, evidence ownership, and a mandatory stop after sealing. Make the two verified runtime corrections at their deepest shared seams and add regression tests. Correct stale command/docs/glossary/dependency metadata in the same release-hardening package.
- **Wins:** One Apply interface remains deep; ordering and trigger policy become auditable without a scheduler; shared lock behavior is fixed once for all writers; installer behavior is correct for both directories and files; tests exercise the real seams.
- **Risks:** A catalog schema change can duplicate prose or over-constrain independent harnesses. The plan therefore requires a minimal declarative contract, a linter that detects contradictions, and no new runtime orchestrator or framework dependency.
- **Verification implications:** Unit tests for lock cleanup, symlink file/dir behavior and rollback, workflow ledger invariants, catalog reciprocity/order/trigger validation, stale command paths, and the full `npm run verify` gate. The failed installer verification test must first be made hermetic or explicitly split from production behavior.
- **Recommendation:** Strong.

### 2. Integrate a market agent framework or PR-review service — `Speculative`

- **Files/seams:** would add a new runtime integration, provider protocol, or CI service boundary.
- **Problem:** OpenAI Agents guardrails/tracing, MCP tools, Danger JS, and reviewdog offer useful concepts, but Codepatrol is deliberately local, harness-agnostic, and CLI/artifact based. No current acceptance criterion requires a hosted runner, MCP server, LLM tracing backend, or GitHub comment publisher.
- **Proposed shape:** Add one or more external dependencies and adapters now.
- **Wins:** Potential hosted observability and PR annotations.
- **Risks:** New trust boundaries, credentials, network/runtime requirements, provider coupling, duplicated artifact semantics, and a larger verification surface than the current problem requires.
- **Verification implications:** Would require separate security, compatibility, credential, CI, and failure-mode work.
- **Recommendation:** Speculative; reject for this package. Adapt concepts as local documentation/evaluation rules only.

### 3. Documentation-only Qodo remediation — `Worth exploring`

- **Files/seams:** Qodo report, `CONTEXT.md`, skill attribution links, `README.md`, `AGENTS.md`, and `.opencode/commands/`.
- **Problem:** Several Qodo observations are valid documentation or reproducibility drift, but documentation alone would leave the orphan-lock, symlink, workflow invariant, and Apply orchestration risks untouched.
- **Proposed shape:** Correct terms, pinned references, path instructions, verdict vocabulary, and dependency range without changing runtime behavior.
- **Wins:** Small surface and low migration risk.
- **Risks:** Does not close high-impact reliability findings or provide proof that skills trigger in coherent order; it could falsely make the release look complete.
- **Verification implications:** Link/path scans and contract tests only; insufficient as the primary correction.
- **Recommendation:** Worth exploring only as a bounded subtask of Candidate 1.

## Qodo disposition

- **Accept and plan:** orphan lock cleanup; typed file-vs-directory symlink creation and rollback; peer dependency range; unpinned inspiration URLs; glossary purity and `_Avoid_` completion; stale command templates; and the non-hermetic installer verification test.
- **Accept with domain correction:** `nextAction` is not universally required for closed items because closure removes it. Define and validate the invariant for actionable/open items (and document the closed-item exception) rather than making the field blindly required on every persisted record.
- **Reject as false positive:** the claimed invalid finding categories do not match the current `REVIEW-FORMAT.md` and parser contract; the current `approve` verdict is intentional and canonical, with `merge` retained only as a deprecated alias. Add regression checks against stale command prose rather than changing the verdict contract.
- **Correct interpretation:** missing `docs/wiki/` is not itself a bug. The product contract says the wiki is generated and freshness is checked; instructions should tell a harness what to do when the wiki is absent, not commit a hollow bundle.

## Selected correction

Promote Candidate 1: **contract-first Apply orchestration and release hardening**. It is one independently reviewable correction because all selected changes protect the same seam: an approved artifact must be executed by a bounded, correctly ordered, evidence-producing Apply step without orphaned runtime state or contradictory skill/command contracts. Candidate 2 is explicitly rejected as premature integration; Candidate 3 is absorbed only where it removes concrete drift.
