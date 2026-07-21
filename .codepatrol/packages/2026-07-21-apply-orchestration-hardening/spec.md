# Specification — Apply orchestration and skill contract hardening

## Intent

- Origin: improve-codebase
- Mode: architecture
- Target baseline: branch `v1-release`, `HEAD` `1f03fd2`, clean source tree before this package; the package itself is newly created under `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/`.
- Governing constraints: `CONTEXT.md` terms **Public Workflow**, **Codepatrol Apply**, **Support Skill**, **Change Package**, **Operational Memory**, **Distribution Adapter**, **Approve**, **Fix-first**, and **Rework**; `README.md` contracts for no scheduler/MCP server, portable artifacts, and the Plan → Review → Apply → Verify lifecycle.
- Substrate state: graph synced in this session at the current checkout; wiki `absent` (graph present, generated concepts missing).
- Problem: Qodo identified reliability, type-contract, reproducibility, documentation, and glossary issues. More importantly, the current Apply step and skill catalog leave important trigger/order/evidence rules in prose, stale OpenCode command templates contradict the canonical artifact path/verdict, `npm run verify` is not hermetic in the installer test, and shared seams have insufficient failure-path coverage. These gaps permit a seemingly approved change to execute with ambiguous scope or leave corrupted runtime state.
- Outcome: An independent harness can execute `codepatrol-apply` only after deterministic preconditions, claim and execute plan tasks in dependency order, invoke support skills only under explicit triggers, record concise evidence before closing each task, and stop at `implemented`; runtime locks/installers/workflow records are hardened and all canonical skill/command contracts are coherent and verified.

## Scope

### In scope

1. Repair the orphan-lock failure path in `src/shared/lock.ts` and add a deterministic failure-injection test at the existing workspace-lock seam.
2. Make installer symlink creation and rollback choose `file` or `dir` from the source `lstat`, and cover OpenCode command files plus directory skills.
3. Tighten the workflow ledger contract: preserve the closed-item exception, require a non-empty `nextAction` for actionable open/in-progress/blocked/waiting-user/deferred items, validate it on load and mutation, and update its portable type/docs/tests consistently.
4. Make Apply orchestration explicit and machine-checkable without introducing a scheduler: declare stage preconditions, task dependency/order rules, support-skill trigger conditions, stop authority, evidence obligations, and semantic-deviation routing in the catalog/shared contracts and `codepatrol-apply`, `execute-change`, `verification-strategy`, `assess-change`, and related primary/support skills.
5. Add catalog lint and contract tests for reciprocal trigger edges, invocation order/conditional triggers, primary stop rules, support-skill mutation policy, exact five-primary exposure, Agent Skills frontmatter limits, and stale `.opencode/commands/` templates.
6. Correct stale command templates, `approve`/`merge` wording, path references, unpinned inspiration URLs using the exact revisions consulted, `Distribution Adapter` glossary implementation leakage, and missing `_Avoid_` annotations. Pin the optional peer dependency to the repository's installed compatible major/minor range (`^0.80.8`) and refresh the lockfile only if npm changes it.
7. Make installer verification tests hermetic by supplying a fake CLI for every code path that calls `verify`, without weakening the production verification behavior.
8. Record the Qodo disposition and external concept adaptations in package evidence; do not add OpenAI Agents, MCP, Danger JS, reviewdog, telemetry, network calls, or provider-specific PR integrations.

### Out of scope

- Implementing a hosted PR bot, MCP server, agent scheduler, remote tracing/export, or direct Qodo integration: none is required by the local product contract and each adds a new trust/operability surface.
- Committing a placeholder `docs/wiki/index.md`: wiki absence is a valid generated-state condition; instructions and status behavior must remain honest.
- Changing the public lifecycle verdict vocabulary: `approve` remains canonical and `merge` remains only a deprecated compatibility alias.
- Broad redesign of the CLI, artifact schema version, graph model, or workflow ledger storage format.
- Opportunistic cleanup of unrelated legacy package evidence or historical references inside the governed package.

## Current evidence

- `src/shared/lock.ts:30-69` opens the lock with `wx`, writes JSON, closes the descriptor, and on a post-open failure closes but does not remove the newly created lock file. All graph/artifact/wiki/workflow writers depend on this seam; graph impact identified `src/shared/workspace.test.ts` and the broader writer/test set.
- `scripts/install-lib.mjs:178,237` always passes `"dir"` to `symlinkSync`, including `.opencode/commands/*.md` files; rollback repeats the same assumption. `scripts/install-lib.test.mjs:152-180` verifies OpenCode but calls the real CLI lookup without a hermetic fake, causing the current `npm run verify` failure (172/173).
- `src/workflow/types.ts:37` and related summary/input types make `nextAction` optional; `src/workflow/store.ts:16-35` does not validate it; `src/workflow/service.ts:209-214,240-244` permits creation/update without it and removes it on close. The durable docs describe it as a required item field, while close semantics prove it must be absent after closure. The selected invariant is therefore conditional, not an unconditional type field.
- `skills/catalog.yaml` is reciprocal and acyclic but does not express invocation order or triggers; `codepatrol-apply` only declares `execute-change`, while `execute-change` prose lists several conditional support skills. Primary stop rules exist, but `.opencode/commands/codepatrol-plan.md` still uses `docs/codepatrol` and `.opencode/commands/codepatrol-review.md` still instructs `merge`, proving distribution drift.
- `skills/codepatrol-review/REVIEW-FORMAT.md` and `src/artifact/review-check.ts:97` already support optional bullet prefixes for headers, and current parser categories/verdicts are canonical; the corresponding Qodo claims are false positives against an older contract.
- Inspiration links in `skills/diagnose-bug/SKILL.md`, `skills/domain-modeling/SKILL.md`, and `skills/grilling/SKILL.md` are floating GitHub repository URLs. Current upstream heads consulted were `mattpocock/skills` `ed37663cc5fbef691ddfecd080dff42f7e7e350d` and `obra/superpowers` `d884ae04edebef577e82ff7c4e143debd0bbec99`; Ponytail v4.8.4 is already pinned at `bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324` through its tag.
- External concept evidence: `evidence/reference-concepts.md`. It recommends adopting portable Agent Skills format discipline and adapting guardrails, trace/evidence, typed-tool, and diff-scoped review concepts, while rejecting direct integrations.

## Proposed design

### Deep interface: Apply execution contract

Keep `codepatrol-apply` as the single deep module for authorized mutation. Its interface is the approved manifest plus current checkout and workflow memory; callers must know only the implementation-stage validation, task claim/dependency rules, evidence result, and stop/return outcomes. The implementation remains distributed across skills and CLI, but the contract is centralized in the primary Apply skill and catalog rather than adding an orchestration runtime.

The catalog uses this exact shape for every support trigger:

```yaml
order: 3
triggers:
  - target: execute-change
    when: before-each-approved-task
```

`order` is required only for the four lifecycle primaries and must be `1..4` for Plan, Review, Apply, Verify respectively. `codepatrol-status` is a read-only dispatcher and is explicitly exempt from lifecycle order. `triggers` is required on any skill with a non-empty `mayInvoke` list and is a list of `{target, when}` objects. The initial finite `when` values are `always-before-recommendation`, `always-before-verdict`, `always-before-task-mutation`, `always-before-assessment`, `when-artifact-refresh-required`, `when-behavior-change`, `when-bug-mode`, `when-domain-term-settled`, `when-external-evidence-required`, `when-irreducible-seam`, `when-load-bearing-decision-unsettled`, `when-module-or-seam-change`, `when-plan-correction-required`, `when-seam-or-module-decision`, `after-decision-tree`, `after-root-cause`, `after-spec-decision-complete`, `after-task-change`, `after-task-result`, and `when-wiki-refresh-required`. Each trigger target must appear in `mayInvoke`, and the target's `invokedBy` must contain the caller. No trigger may target a primary. The plan must enumerate the final trigger entries for every changed catalog skill rather than asking the implementer to infer them.

Apply executes a sequential fallback as follows: validate the exact approved package with the existing implementation-stage artifact gate; reconstruct plan tasks; establish `implementation.md`; for each dependency-ready task, claim it, verify the task's declared file ownership and acceptance mapping, run the task's red/characterization signal, invoke only the support skills whose catalog trigger is true, make the smallest approved mutation, run affected checks and assessment, append evidence, and close the task. A semantic deviation, invalid interface, or missing acceptance mapping changes status to `changes-requested` and stops. Environmental failure changes status to `blocked` and stops. After every task and at final sealing, no downstream primary is invoked automatically.

### Shared runtime corrections

- `withWorkspaceLock` tracks whether the current attempt created the lock path. If writing or closing the record fails after creation, it closes the descriptor if necessary and unlinks only that attempt's path before rethrowing. The normal owner-token cleanup remains unchanged.
- Installer link operations carry a `linkType` derived from `lstat(source).isDirectory() ? "dir" : "file"`; preflight rejects unsupported source types. Creation and rollback use the same type. No new abstraction or dependency is introduced.
- Workflow store validates `nextAction` as a non-empty string for non-closed items and permits its absence only for `closed` items. Service creation requires it for non-closed items, update rejects clearing it unless closing through `workflow close`, and close removes it. Public input/summary types reflect this conditional contract without lying that it exists on closed records.

### Contract/documentation corrections

OpenCode command templates are generated/checked against the same canonical paths and verdict vocabulary as the skills. Qodo's valid issues are corrected without changing behavior; false-positive claims are recorded as rejected evidence. Attribution URLs become pinned commit/tree URLs. The glossary defines `Distribution Adapter` by role, not repository paths, and adds `_Avoid_` terms to `Fix-first` and `Rework`. The missing wiki guidance says to run `codepatrol wiki status` and generate only when the graph/state requires it.

## Alternatives

1. **Add a new Apply orchestrator module/scheduler.** Rejected: it duplicates the existing workflow ledger and would make support triggers and user authority implicit in runtime code. The catalog plus deep Apply contract reaches the acceptance criteria with less surface.
2. **Only patch Qodo's ten comments.** Rejected: it would miss the actual Apply ordering/trigger contract, stale distribution templates, test isolation failure, and workflow conditional invariant.
3. **Integrate OpenAI Agents/MCP/Danger/reviewdog.** Rejected: external evidence supports concepts but no current criterion needs network/provider integration; this would add credentials, trust boundaries, dependencies, and verification burden.

## Simplicity decision

- Selected rung: direct local change, reusing existing CLI, artifact validator, workflow ledger, catalog, and test seams.
- Earlier rungs: removing the Apply rules fails the safety floor; existing prose alone cannot be machine-checked; standard Node primitives already provide locks/symlinks and are retained; no installed dependency owns this local contract; a new orchestrator is unnecessary because the ledger and primary skill already own execution state.
- Irreducible complexity: dependency-aware, interruption-safe, evidence-producing execution across a portable artifact handoff. It is hidden behind the Apply primary workflow and deterministic CLI gates rather than exposed as new caller-facing modules.
- Safety floor: hash/revision/approval validation before mutation; path containment; lock cleanup; atomic workflow/artifact writes; user authority between primary steps; cancellation; red-capable tests; affected and full gates; no raw secrets/prompts in evidence; compatibility for the deprecated `merge` alias.
- Expected surface delta: modify `src/shared/lock.ts` and test; `scripts/install-lib.mjs` and test; `src/workflow/types.ts`, `src/workflow/store.ts`, `src/workflow/service.ts`, docs, and tests; catalog/linter/skill contracts and contract tests; `.opencode/commands/`; `CONTEXT.md`; `package.json`/`package-lock.json` if needed; add no runtime dependency, scheduler, protocol, or production module.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | Keep orchestration declarative in YAML/Markdown and the local CLI; do not add a scheduler or telemetry backend. | Native harnesses may eventually need richer parallel execution or cross-run trace visualization. | A concrete user-approved requirement demands concurrent task scheduling, remote trace correlation, or a provider protocol; current sequential execution cannot meet it. | Create a separate architecture package for a provider-neutral execution graph/trace interface, with security and migration analysis; do not expand Apply opportunistically. |

## Compatibility and rollout

This is a backward-compatible hardening release except for rejecting malformed non-closed workflow records that already violate the documented `nextAction` invariant. Existing closed records remain valid. Existing `merge` approvals remain valid with a warning. Existing installer links are relinked only when owned; user-owned paths remain conflicts. Rollback is standard Git/package rollback plus lock/install rollback; no migration is required for valid ledgers. If invalid legacy records are found, Apply stops with `WORKFLOW_INVALID` and the package returns to review rather than silently repairing operational memory.

## Risks and mitigations

- **Catalog/prose divergence:** linter fixture with intentionally contradictory trigger/order data; catalog remains structural source.
- **Over-constraining harnesses:** test sequential fallback equivalence and forbid provider-specific names, not native parallelism itself.
- **Lock cleanup race:** unlink only a lock created by the current attempt; test a post-open write failure and confirm another owner is not removed.
- **Installer rollback regression:** test file and directory links, relink, uninstall, and failed multi-link rollback.
- **Workflow compatibility:** fixture closed and open records; test exact error and valid close transition.
- **Evidence leakage:** enforce concise paths/results and no raw conversation/secrets in the new format guidance.
- **Unrelated Qodo drift:** preserve a disposition table in evidence and do not alter canonical `approve`/category behavior.

## Acceptance criteria

- AC-1: WHEN a lock record write or descriptor close fails after the current process creates the lock path, THEN the operation rethrows and the current lock path is absent, while a lock owned by another process is not removed.
- AC-2: WHEN Codepatrol installs or rolls back a skill directory and an OpenCode command file, THEN each symlink is created/restored with the matching platform type and all existing ownership/conflict guarantees remain true.
- AC-3: WHEN a non-closed workflow item is created, updated, or loaded, THEN it has a non-empty `nextAction`; WHEN it is closed, THEN the record may omit `nextAction` and remains valid. The runtime invariant is shared between the ledger validator, the create/update paths, and the `assertNextActionInvariant` helper; the static `WorkflowItemV1` keeps `nextAction?: string` so the same JSON shape encodes both states.
- AC-4: WHEN an approved Apply session starts, THEN the existing implementation-stage artifact gate proves the exact manifest/revision/approval and the workflow ledger proves the claimed task is dependency-ready; before each task mutation, the implementer verifies the plan's declared file ownership and acceptance mapping; a failed precondition stops without production mutation.
- AC-5: WHEN Apply completes or encounters a task result, THEN its task evidence, acceptance mapping, support-trigger decisions, deviation classification, and stop/next-owner result are recorded before closure; semantic deviation routes to review and environmental blockage routes to blocked.
- AC-6: WHEN the catalog and public command templates are linted, THEN primary order, support trigger edges, reciprocal declarations, mutation policy, frontmatter, path, and verdict contracts are coherent, with stale/contradictory fixtures failing the checks.
- AC-7: WHEN the full project verification gate runs in a clean checkout, THEN typecheck, all tests, build, CLI smoke, skill lint, package contracts, and installer verification pass without relying on an ambient global `codepatrol` binary; this final gate is owned by `codepatrol-verify`, not Apply.
- AC-8: WHEN the final diff and docs are audited, THEN valid Qodo findings are corrected, false positives are documented as rejected, external concepts are pinned/adapted without integration, stale OpenCode instructions are gone, and no unnecessary dependency/module/test remains.

## Decisions and open questions

- **Decision:** `approve` is canonical; `merge` is compatibility-only. The Qodo verdict-category complaint is rejected against the current parser and format.
- **Decision:** `nextAction` is conditionally required for actionable non-closed records, not universally required on closed records; the static `WorkflowItemV1` keeps `nextAction?: string` while `assertNextActionInvariant` enforces the same conditional rule at create, update, and load time.
- **Decision:** Agent Skills, guardrails, tracing, MCP, and PR feedback research informs local contracts only. No external dependency or integration is adopted.
- **Decision:** The primary workflow order is Plan → Review → Apply → Verify; no primary may invoke the next primary automatically. Support invocation is conditional and catalog-audited.
- **Open questions:** None that materially change scope, interface, trust, or acceptance. A future hosted/provider integration is explicitly deferred under DC-1 and requires a separate package.
