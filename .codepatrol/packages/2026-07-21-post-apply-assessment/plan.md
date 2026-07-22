# Plan — Post-apply assessment (architecture mode)

- Work id: `2026-07-21-post-apply-assessment`
- Governing spec: `spec.md`
- Target baseline: commit `89892a3` on `v1-release`
- Mode: architecture

## Goal and approach

This package is an **analysis-only architecture assessment**, not a code change. It re-evaluates the Qodo comments, the codepatrol-verify step, the skill trigger and ordering coherence, and the market-framework concepts that could be adoptable; it produces a top correction candidate and a one-line `CONTEXT.md` update. No production code is edited by this plan.

## Global constraints

- No new dependency, no MCP server, no hosted telemetry, no PR bot, no scheduler, no provider-specific API.
- No new runtime module; this package is evidence-only.
- The governed package is itself an evidence package; it is allowed to be untracked during analysis and committed only if the user authorizes the closure of the work id with the standard commit shape.
- The `simplicity` decision is recorded in the spec; no `simplification ladder rung` is required because no new implementation is produced.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T2 | Static check: `node -e "..."` walk of `skills/catalog.yaml` returns zero issues. `node scripts/lint-skills.mjs` returns 0 failures. |
| AC-2 | T3 | Re-read of `2026-07-21-apply-orchestration-hardening/verification.md`; every "non-blocker" finding recorded in `evidence/analysis.md` with bounded upgrade path. |
| AC-3 | T4 | Per-concept `adopt` / `adapt` / `reject` table in `evidence/reference-concepts.md`. |
| AC-4 | T5 | Top correction candidate in `spec.md` Simplicity decision; deferred constraints `DC-1` and `DC-2` recorded with stable id, ceiling, observable trigger, and upgrade path. |
| AC-5 | T6 | `git diff CONTEXT.md` shows the single-line glossary addition recording the rejected integration surfaces. |

## Dependency order

`T1 → T2 → T3 → T4 → T5 → T6`. Each task is bounded and re-uses prior tasks' evidence. Sequential execution is required because T2 depends on T1's catalog walk, T3 depends on T1's read of the latest verify, T4 depends on T1 and T3, T5 depends on all prior tasks, T6 depends on T5.

### T1 — Static catalog walk and prose read

**Purpose:** Satisfies AC-1 and feeds T2/T3.

**Depends on:** —

**Files:**

- Read: `skills/catalog.yaml`, `skills/codepatrol-{plan,review,apply,verify,status}/SKILL.md`, `skills/{assess-change,execute-change,verification-strategy}/SKILL.md`, `_shared/EXECUTION.md`, `_shared/ARTIFACTS.md`, `_shared/ROLES.md`.
- Write: `evidence/analysis.md` (the "Skill trigger, ordering, and contract coherence check" section).

**Steps:**

1. Run `node bin/codepatrol.js graph sync --workspace "$PWD" --format json` (no warnings expected) and `node bin/codepatrol.js wiki status --workspace "$PWD" --format json` (expect `absent`).
2. Walk `skills/catalog.yaml` with a one-off Node script that asserts: every `mayInvoke` target is reciprocated in the target's `invokedBy`; every `triggers` target is in the caller's `mayInvoke` and the target's `invokedBy`; every support `mayInvoke` target is covered by a trigger; the supported finite `when` set is honoured; `codepatrol-status` has no `order`. The script must exit 0.
3. Re-read every primary SKILL.md and the support skills it invokes, confirming the prose names the trigger-based invocation rule. The probe is a textual match, not a runtime check.
4. Record the static-coherence result and the prose-coherence result in `evidence/analysis.md`. **Red evidence:** the walk returns at least one issue against the unfixed catalog (no `triggers` rows, no `order` rows, no finite `when` set). **Green evidence:** the walk returns 0 issues on the merged catalog and `node scripts/lint-skills.mjs` reports "0 failures".

### T2 — `codepatrol-verify` step re-evaluation

**Purpose:** Satisfies AC-2.

**Depends on:** T1.

**Files:**

- Read: `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/{verification,implementation,plan,spec,review}.md`.
- Write: `evidence/analysis.md` (the "codepatrol-verify step re-evaluation" section).

**Steps:**

1. Re-read the seven duties in `skills/codepatrol-verify/SKILL.md:31-43` (Plan conformance, Acceptance criteria, Wider suite, Blast radius, Regressions, Unplanned changes, Evidence and residual risks).
2. For each duty, record whether the latest verify exercised it directly, waved it off as a minor finding, or did not cover it. The cross-package dependency audit, the structural surface-delta check, and the bounded-deviation acceptance test are recorded as gaps.
3. For each gap, name the bounded upgrade path. **Red evidence:** the latest verify's three minor findings are recorded verbatim and the gaps are listed. **Green evidence:** the per-duty table is complete with at least one bounded upgrade path for each gap.

### T3 — Market framework survey

**Purpose:** Satisfies AC-3.

**Depends on:** T1.

**Files:**

- Read: official documentation of the seven sources (consulted via WebSearch; URLs recorded in `evidence/reference-concepts.md`).
- Write: `evidence/reference-concepts.md` and `evidence/analysis.md` (the "Market frameworks survey" and "Candidate improvements" sections).

**Steps:**

1. For each of the seven sources, record: what problem the source solves, what mechanism is involved, what trade-offs apply, whether the concept is `adopt` / `adapt` / `reject`, and the local equivalent (or absence thereof) in Codepatrol v1.0.
2. Record the rejected integration surfaces (MCP, OpenAI Agents SDK, AWS Bedrock AgentCore, GitHub Copilot Coding Agent, MITRE ATLAS) in a separate table. Each row names the exact source and revision. **Red evidence:** the survey produces at least one row with `reject` and at least one with `adapt`. **Green evidence:** the table covers all seven sources, every row is supported by a documented primary reference, and the recommendations are recorded in the `Candidate improvements` section of `evidence/analysis.md`.

### T4 — Candidate ranking and Simplicity decision

**Purpose:** Satisfies AC-4.

**Depends on:** T1, T3.

**Files:**

- Write: `evidence/analysis.md` (the "Candidate improvements — ranked" and "Simplicity Decision" sections); `spec.md` (the "Simplicity decision" section).

**Steps:**

1. Read `skills/solution-simplification/SKILL.md` (the sufficiency ladder) and the "Simplicity Decision" section of `skills/_shared/SPEC-FORMAT.md`.
2. For each candidate (eval harness, surface-delta check, lifecycle stop-rule check, MCP, Agents SDK), classify as `remove` / `reuse` / `built-in` / `speculative` / `simplify` per the `assess-change` skill's simplicity axis.
3. Record the top correction candidate with full Simplicity Decision fields. **Red evidence:** the candidate is recorded with at least one earlier rung considered and rejected. **Green evidence:** the Simplicity Decision is complete (selected rung, earlier rungs, irreducible complexity, safety floor, expected surface delta, deferred constraints).

### T5 — Top correction candidate recorded in spec

**Purpose:** Bridges T1–T4 into the spec so the user can act on it.

**Depends on:** T1, T2, T3, T4.

**Files:**

- Write: `spec.md` (the "Proposed design", "Alternatives", "Simplicity decision", "Deferred constraints" sections); `evidence/analysis.md` final summary.

**Steps:**

1. Update `spec.md` with the top correction candidate, the alternatives considered, the Simplicity Decision, and the deferred constraints (`DC-1` and `DC-2`).
2. Ensure the `AC-N` mapping is consistent with the analysis.
3. Record the "Decisions and open questions" section. **Red evidence:** the spec does not yet contain the Simplicity Decision. **Green evidence:** the spec is complete and self-consistent with `evidence/analysis.md`.

### T6 — `CONTEXT.md` rejected integration surfaces (one line)

**Purpose:** Satisfies AC-5.

**Depends on:** T5.

**Files:**

- Modify: `CONTEXT.md` — add one entry near the existing "Distribution Adapter" glossary entry recording the rejected integration surfaces (MCP, OpenAI Agents SDK, AWS Bedrock AgentCore, GitHub Copilot Coding Agent, MITRE ATLAS) with `_Avoid_` notes. The record uses the existing glossary discipline.

**Steps:**

1. Read `CONTEXT.md` end-to-end.
2. Add the new glossary entry, mirroring the `_Avoid_` discipline used for `Distribution Adapter`. The entry is short (one paragraph) and references the assessment package by path.
3. Re-run `npm run lint:skills` to confirm no lint regression. **Red evidence:** the new entry breaks the linter or contradicts an existing term. **Green evidence:** the linter exits 0 and the entry reads correctly with the rest of the glossary.

## Task result

- T1 through T6 each append their evidence to `implementation.md`. This plan is an assessment plan; the `implementation.md` is a journal of the assessment, not of a code change.

## Rollback and final verification

- T6's `CONTEXT.md` addition is text-only and can be reverted with `git restore`. No other change in this package is reversible because no other change exists; the package is evidence-only.
- The final verification is the artifact validate: `codepatrol artifact validate --manifest .codepatrol/packages/2026-07-21-post-apply-assessment/handoff.yaml --stage plan --workspace "$PWD" --format json` must exit with `valid: true`.
- The full `npm run verify` at the baseline is 185/185 green; this package does not change that number. After T6, re-run `npm run lint:skills` to confirm no glossary change introduced a new failure.

## Final verification (owner: this plan)

Run the full project gate (the affected subset is `node scripts/lint-skills.mjs` and the static catalog walk) after T6. The full `npm run verify` is owned by a future work id if this assessment is approved.
