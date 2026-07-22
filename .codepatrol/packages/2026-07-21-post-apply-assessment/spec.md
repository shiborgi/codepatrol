# Specification — Post-apply assessment (2026-07-21-apply-orchestration-hardening)

## Intent

- Origin: improve-codebase
- Mode: architecture
- Target baseline: commit `89892a3` on `v1-release` (the merge of `2026-07-21-apply-orchestration-hardening`).
- Governing constraints: `CONTEXT.md` terms `Public Workflow`, `Codepatrol Plan`, `Codepatrol Review`, `Codepatrol Apply`, `Codepatrol Verify`, `Change Package`, `Distribution Adapter`, `Approve`, `Fix-first`, `Rework`; `README.md` product contract (no MCP server, no agent scheduler, local-only, deterministic CLI gates, portable artifact handoff); `AGENTS.md` no-product-promise rule.
- Substrate state: graph synced (58 files, 1639 symbols, 87 test edges); wiki `absent` (canonical pre-generation state); `npm run verify` 185/185 green at baseline.
- Problem: surface the post-merge quality of the apply package, the residual gaps in the codepatrol-verify step, the skill trigger and ordering coherence, and the market-framework concepts that would be adoptable without violating the product contract. Provide a top correction candidate without editing production code.
- Outcome: a reviewable analysis (this package) that classifies every Qodo item, every skill-trigger claim, and every market-framework survey result, and ranks three concrete improvement candidates by Strong / Worth exploring / Speculative.

## Scope

### In scope

1. Re-evaluate the ten Qodo items against the delivered state at `89892a3`; accept, reject, or reclassify any item whose disposition changed between the apply session and the post-merge state.
2. Validate skill trigger coherence (catalog static check) and contract prose (read every primary SKILL.md and `assess-change`, `execute-change`, `verification-strategy` for the trigger-based invocation rule).
3. Re-evaluate the `codepatrol-verify` step against the seven duties in its skill; identify any duty that the latest verify had to wave off as "non-blocker" and that a future verifier should automate.
4. Survey market frameworks (Agent Skills, OpenAI Agents SDK, MCP, AWS Bedrock AgentCore, GitHub Copilot Coding Agent, MITRE ATLAS) for concepts adoptable as a local pattern, not as a dependency.
5. Produce a candidate ranking and a top correction candidate; document the bounded upgrade paths for the two deferred candidates (eval harness = DC-1 trigger; lifecycle stop-rule check = cross-cutting future hardening).
6. Update `CONTEXT.md` to record the rejected integration surfaces (MCP, OpenAI Agents SDK, AWS Bedrock AgentCore Memory SDK, GitHub Copilot Coding Agent, MITRE ATLAS) so a future contributor does not re-litigate.

### Out of scope

- Editing production code; this package is analysis-only and does not produce `implementation.md`.
- Re-running or re-committing the apply session's evidence; the merged `verification.md` is the authoritative record.
- Direct integration of any external framework, provider, or hosted service; the product contract forbids it.
- Re-creating the OKF wiki bundle; `wiki generate` is the supported path and the wiki is correctly `absent` at baseline.
- A new `package.json` peer-dependency range; the existing `^0.80.8` is correct.

## Current evidence

### Qodo disposition re-evaluation

- Every Qodo item dispositioned in `evidence/qodo-disposition.md` stands after re-examination. See `evidence/analysis.md` for the per-item table.
- No new item was added in this assessment that the apply session missed.
- L2 (categories) remains the only category with `major` items, three of which the apply session rejected as false positives against the current parser/format. Qodo's own report admitted 2.4 as a *falso positivo / regra externa*. Our `reject` is therefore stronger than the source's own framing.

### Skill trigger coherence (catalog)

- `skills/catalog.yaml` primary order: Plan=1, Review=2, Apply=3, Verify=4. `codepatrol-status` has no order.
- The 27-row `triggers` table covers every `mayInvoke` → support target. Every `when` value is in the supported finite set. Reciprocity holds (`invokedBy` ⇄ `mayInvoke`).
- Static coherence check (a one-off Node script that walks `catalog.yaml` directly) reports **0 issues** on this baseline.
- The `lintSkillTree(root)` export is exercised by the new `lintSkillTree fixture violations` test in `scripts/skills-contract.test.mjs`.
- Prose coherence: every primary skill and the support skills it invokes name the *trigger-based* invocation rule in their SKILL.md (re-read: `codepatrol-apply`, `execute-change`, `assess-change`, `verification-strategy` all match the rule).
- Order: the primary `order` field is now lint-enforceable; `codepatrol-status` is explicitly excluded. This closes a class of drift where a future harness adapter might re-arrange the primaries.

### codepatrol-verify step

- The latest verify at `2026-07-21-apply-orchestration-hardening/verification.md` recorded three minor documentation findings (T6 journal entry partially incomplete, T3 journal entry has two `Result:` lines, AGENTS.md was listed in T5 plan but not modified). All three are non-blockers because the table-driven acceptance evidence and the final surface delta are present.
- Verifier-independence gap (same harness/model as apply) was recorded; matches the pattern in every prior package's `verification.md`.
- Three duties that the verify step did **not** automate are candidates for follow-up: cross-package dependency audit, structural diff against the spec's `Expected surface delta`, and re-execution of the bounded mechanical deviation's own acceptance test.

### Market framework survey

- `agentskills/agentskills` at commit `38a2ff8…`, OpenAI Agents SDK handoffs and tracing docs, MCP `2025-06-18` + `2026-07-28` release candidate, AWS Bedrock AgentCore Memory SDK, GitHub Copilot Coding Agent risks and mitigations, MITRE ATLAS AI agent threat model, Microsoft `agent-skills`, Phoenixrr2113/agent-harness, jscraik/Agent-Skills.
- The only substantive new concept is the executable skill-evaluation harness (option 1 below). All hosted or networked concepts are correctly out of scope per the product contract.
- See `evidence/reference-concepts.md` for the per-concept analysis and rejected integration surfaces.

### Substrate and project health

- `npm run verify` (baseline): 185/185 tests, typecheck, build, smoke, lint all exit 0.
- Working tree clean at baseline; no untracked files outside the governed package.
- `docs/wiki/` is `absent`; `codepatrol wiki status` reports the six generated concepts as `page-missing` and four `src/artifact/{plan-check,review-check}.{ts,test.ts}` sources as `uncovered`. These are expected pre-generation state and do not block the assessment.

## Proposed design

Three options were ranked (full analysis in `evidence/analysis.md`). The two **Strong** candidates are:

1. **Executable skill-evaluation harness** (a new `scripts/eval-skills.mjs` exporting `evalSkillTree(root)`, called by a new `npm run eval:skills` script, producing per-skill eval evidence in `docs/codepatrol/<work-id>/eval/`). This is the bounded upgrade path for the `DC-1` deferred constraint recorded in multiple prior packages. It introduces a new gate; therefore it is a separate work id, not part of this assessment.
2. **Structural surface-delta check in `codepatrol-verify`** (extend `assess-change` with a `compareSurfaceDelta(spec, gitDiff, allowList)` routine; the verify step calls it). This is a small, bounded extension that closes the gap the latest verify had to wave off as "non-blocker".

The third candidate (**Worth exploring, defer**) is a CLI check that the four primary skills' stop rules are not violated at runtime; the absence of a concrete incident means the prose rule is currently sufficient.

The two **Speculative** candidates (MCP integration and OpenAI Agents SDK adoption) are rejected for direct integration; the *concepts* of per-task guardrails and structured event records are already adopted locally.

The top correction candidate is **option 1 (eval harness)** as a separate work id, with **option 2 (surface-delta check)** as a bounded follow-up that could be folded into the same work id or shipped independently.

## Alternatives

- **Reject the entire assessment and return to "ship as-is".** Rejected: the project has real gaps (no eval discipline) and the survey produced a real concept. The Strong candidate is bounded and uses the local-only product contract.
- **Bundle options 1 and 2 in this package.** Rejected: option 1 is a new executable surface (a new gate); option 2 is an extension of an existing skill. Bundling them would inflate the surface delta and require a longer review. They are correctly separate work ids.
- **Adopt MCP for multi-tenant access.** Rejected: contradicts the product contract. Re-litigation risk is reduced by recording the rejection in `CONTEXT.md` (see Recommendations).

## Simplicity decision

- **Selected rung:** direct local change (option 2) + new local executable (option 1, in a separate work id). Reusing the existing `assess-change` skill (option 2) is rung 6 of the sufficiency ladder; introducing `scripts/eval-skills.mjs` (option 1) is rung 7 because the local helper does not exist.
- **Earlier rungs considered:** "do nothing" (rejected — gaps are real and bounded); "remove the verify step" (rejected — its seven duties are necessary); "adopt an external framework" (rejected — every candidate is out of scope per the product contract).
- **Irreducible complexity:** option 2 — one new function in `assess-change`; one new test. Option 1 — one new module with one new export, one new npm script, and one new docs bundle. Both are small.
- **Safety floor:** preserved. No new dependency, no hosted service, no new trust boundary, no public surface change. The diff remains toolchain-readable.
- **Expected surface delta (this assessment, evidence-only):** two new files in `evidence/`; one new `CONTEXT.md` line recording the rejected integration surfaces. No production change.
- **Expected surface delta (option 2, follow-up work id):** one new exported function in `assess-change`; one new call in `codepatrol-verify`; one new test in the contract suite. No new files, no new dependencies, no new npm scripts.
- **Expected surface delta (option 1, separate work id):** one new file `scripts/eval-skills.mjs`; one new npm script `eval:skills`; one new docs bundle. Optional `wiki generate` integration. No new dependencies, no hosted service.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | No executable skill-eval harness yet (the project relies on `lintSkillTree` + manual red-capability demos). | The `npm run verify` gate is structural; content drift in a support skill could ship undetected. | A plan invokes a support skill and the produced evidence does not match the skill's prose contract, or a second verifier finds an unfinished verification claim in workflow memory. | Option 1 of this assessment: `scripts/eval-skills.mjs` exporting `evalSkillTree(root)`, called by `npm run eval:skills`, producing per-skill eval evidence. |
| DC-2 | The four primary skills' "Stop rule (mandatory)" sections are enforced by prose, not by the CLI. | A future harness that imports Codepatrol skills but does not honor prose rules could chain Plan → Review → Apply → Verify in a single session, violating the contract. | A toolchain-side observation of a primary invoking another primary in a non-handoff context (e.g. via `subagent` tool). | Record the expected call graph; add a CLI check that asserts no primary-to-primary `mayInvoke` exists except through a new `invoke` field; fold into a future work id. |

## Compatibility and rollout

This package is evidence-only and has no production change. The proposed option 1 is a new work id in its own `codepatrol-plan` invocation; option 2 is a bounded follow-up that can be folded into option 1 or shipped independently. `CONTEXT.md` will gain one new line recording the rejected integration surfaces, after the user authorizes the change.

## Risks and mitigations

- **Eval harness growth (option 1).** Mitigated by writing one eval per support skill at a time, only when a real package exercises the trigger. The eval harness is opt-in and is gated on per-skill red-capable fixtures.
- **Surface-delta check (option 2) over-asserting.** Mitigated by keeping the `allowList` for the package's own governance artifacts and treating warnings rather than hard failures for "extras" outside the spec.
- **Re-litigation of MCP / OpenAI Agents SDK / AWS Bedrock AgentCore Memory SDK / GitHub Copilot Coding Agent / MITRE ATLAS.** Mitigated by recording the rejected integration surfaces in `CONTEXT.md` with the same `_Avoid_` discipline used for `Distribution Adapter`.
- **CONTEXT.md change scope.** Recording the rejected surfaces adds a small glossary line; it does not modify the existing `Distribution Adapter` definition.

## Acceptance criteria

- AC-1: Every Qodo item dispositioned in this analysis is recorded with a verified location and a class (`accept`, `reject`, `reinterpret`); a static walk of the catalog returns zero issues on `mayInvoke` ⇄ `invokedBy` reciprocity, trigger target membership in `mayInvoke`, support-only targets, and the supported finite `when` set.
- AC-2: The `codepatrol-verify` step's seven duties are re-evaluated against `2026-07-21-apply-orchestration-hardening/verification.md`; every duty that the latest verify waved off as "non-blocker" is recorded as a candidate improvement with a bounded upgrade path.
- AC-3: A market-framework survey of the seven named sources is recorded as a per-concept `adopt` / `adapt` / `reject` table with verified locations and the corresponding disposition in the project's contract.
- AC-4: A top correction candidate is selected with `simplification` evidence: selected rung, earlier rungs considered, irreducible complexity, safety floor retained, expected surface delta, deferred constraints with stable id, chosen simplification, observable trigger, and upgrade path.
- AC-5: `CONTEXT.md` is updated to record the rejected integration surfaces (MCP, OpenAI Agents SDK, AWS Bedrock AgentCore Memory SDK, GitHub Copilot Coding Agent, MITRE ATLAS) so a future contributor does not re-litigate. The record uses the existing `_Avoid_` discipline.

## Decisions and open questions

- **Decision:** the top correction candidate is **option 1 (executable skill-evaluation harness)** as a separate work id, with **option 2 (structural surface-delta check in `codepatrol-verify`)** as a bounded follow-up.
- **Decision:** option 3 (CLI check for primary stop rules) is **Worth exploring, defer**.
- **Decision:** options 4 and 5 (MCP integration, Agents SDK adoption) are **reject for direct integration**; their *concepts* are already adopted locally (per-task guardrails, structured event records).
- **Open question:** whether option 1 should ship as a separate work id or be folded into a future `codepatrol-verify post-apply verification gate` package (see the `cpw-92b9a0a63155` work id in the workflow memory). The user is the only authority to choose; this assessment records both paths as available.
