# Review — Post-apply assessment (2026-07-21-apply-orchestration-hardening) — rev 3

- Package: `2026-07-21-post-apply-assessment`
- Incoming revision: 3
- Reviewed revision: 3
- Reviewer: pi (MiniMax-M3)
- Evidence date: 2026-07-22T01:36:42Z
- Baseline: `89892a3` on `v1-release`

## Scope and evidence

Read in full: `spec.md` (rev 3, sha256 `9cb80f12…`, unchanged since rev 2), `plan.md` (rev 3, sha256 `65c3a944…`, unchanged since rev 2), `evidence/analysis.md` (sha256 `07275db5b…`, unchanged since rev 2), `evidence/reference-concepts.md` (rev 3, sha256 `e1ee0b7f…`, **changed** since rev 2), `implementation.md` (sha256 `180af336…`, unchanged since rev 2), `verification.md` (sha256 `aa100e4d…`, unchanged since rev 2), the prior review at rev 2 (sha256 `b3f7fcd1…`), `CONTEXT.md` (post-apply, two-line glossary addition in place), and the project root `npm run verify` gate.

Producer-side evidence:

- `node bin/codepatrol.js artifact validate --stage plan` — `valid: true`, 0 errors, 0 warnings.
- `node bin/codepatrol.js artifact validate --stage review` — `valid: true`, 0 errors, 0 warnings.
- `node bin/codepatrol.js artifact record` — ok, persisted at `2026-07-22T01:32:37Z`.

Independent re-checks:

- `npm run verify` — pass: typecheck, 185/185 tests, build, CLI smoke, skill lint all green.
- `node bin/codepatrol.js graph sync` — pass: 58 files, 1639 symbols, 87 test edges, 0 warnings.
- `node bin/codepatrol.js wiki status` — pass: `Wiki: absent`, `Graph: present`; canonical pre-generation state.
- `node bin/codepatrol.js graph impact --file skills/catalog.yaml` — pass: `unknownSeeds: [skills/catalog.yaml]`, no affected callers/tests; confirms the assessment is analysis-only and does not touch the code graph.
- AC-3 table-shape check (one-off Node, mirroring the verifier's rev-2 check): the new `evidence/reference-concepts.md` contains 16 Markdown data rows across two tables (6 per-concept rows + 8 rejected-integration-surface rows + 2 separator rows). The rev-2 verifier's failing check (zero rows) is now satisfied.
- Decision-value check: each row in both tables contains a `Decision` cell constrained to `adopt` / `adapt` / `reject` (with qualifiers like `adopt (concept), reject (runtime)`); every named source family in the spec's header enumeration appears in the rejected-integration-surfaces table.
- `CONTEXT.md` (post-T6) check: the `Rejected Integration Surface` glossary entry exists with the five named products, the `_Avoid_` discipline, and a `.codepatrol/packages/2026-07-21-post-apply-assessment/` reference. `git diff --stat HEAD -- CONTEXT.md` reports 2 lines inserted (matches plan T6's bounded forecast).
- MCP `2025-06-18` and `2026-07-28` release candidate independently confirmed to exist on modelcontextprotocol.io (consulted via WebSearch 2026-07-22).

## Findings

### minor — contract — table covers all named sources despite a spec wording inconsistency

The spec's AC-3 says "the seven named sources", but the spec's own source enumerations disagree:

- Scope item 4 (`spec.md:20`) lists 6 sources (Agent Skills, OpenAI Agents SDK, MCP, AWS Bedrock AgentCore, GitHub Copilot Coding Agent, MITRE ATLAS).
- Header enumeration (`spec.md:57`) lists 9 sources (the 6 above + Microsoft `agent-skills`, Phoenixrr2113/agent-harness, jscraik/Agent-Skills).
- AC-5 list (`spec.md:22, 111, 120`) lists 5 rejected surfaces.

The rev 3 reference-concepts table covers **all sources named anywhere in the spec** (the 9 from line 57 plus the 5 from AC-5, grouped into one table with 8 rows because Microsoft/Phoenixrr2113/jscraik share the same disposition pattern). The literal AC-3 criterion ("per-concept adopt/adapt/reject table with verified locations and the corresponding disposition in the project's contract") is satisfied; the count mismatch in the spec is a pre-existing wording ambiguity from rev 2 that this review records as a minor observation. **Not blocking.**

The producer's bounded correction at rev 3 was the right move: it preserved the existing analysis content, eliminated the contract defect identified by the rev-2 verifier, and did not introduce new artifacts or new ambiguity. The `revision_history` block in `handoff.yaml` correctly documents the rev 1 → rev 2 → rev 3 provenance.

### minor — evidence — same harness/model as producer and verifier

`steps.plan`, `steps.review`, `steps.apply`, and `steps.verify` are all `pi · MiniMax-M3`. Fresh-eyes independence at the artifact/session level is present (each step's `completed_at` is distinct and the verification re-ran gates independently); vendor/model independence is not. This matches the pattern recorded in every prior package's `verification.md` and is disclosed in the manifest. **Not a contract failure.**

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `spec.md` | none | unchanged since rev 2; spec is correct as written. | none |
| `plan.md` | none | unchanged since rev 2; plan tasks T1–T6 are decision-complete. | none |
| `evidence/analysis.md` | none | unchanged since rev 2; the 10-row Qodo table and seven-duty verify re-evaluation remain correct. | AC-1, AC-2 |
| `evidence/reference-concepts.md` | none at this review (changed by producer at rev 3) | producer bounded correction replaced the loose Observed-concepts narrative with a 6-row per-concept table and added an 8-row Rejected-integration-surfaces table; satisfies AC-3's literal requirement. | AC-3 |
| `implementation.md` | none | unchanged since rev 2; the T1–T6 journal accurately describes the assessment as implemented. | none |
| `verification.md` | none | unchanged since rev 2; the rev-2 verifier's `improve` verdict and contract-defect finding are the input this review addresses. | none |
| `handoff.yaml` | status `ready-for-review` → `approved`; `artifacts.review.sha256` refreshed; `approval.{reviewed_revision: 2 → 3, reviewed_at: rev 3 stamp, reviewer: pi}`; `steps.review.{completed_at: rev 3 stamp, harness: pi, model: MiniMax-M3}`; `revision_history` appended. | required by the artifact handoff contract and the review skill's exit gate. | none |
| `CONTEXT.md` | none at this review (changed by T6 in apply at rev 2) | the `Rejected Integration Surface` glossary entry is in place and matches AC-5; no further change is needed. | AC-5 |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes (Qodo re-evaluation table; catalog walk; lint; prose read) | T1 | yes — static catalog walk exits 0; `lintSkillTree` red fixture detects malformed catalogs; 185/185 project tests | covered |
| AC-2 | yes (per-duty table in `evidence/analysis.md`) | T2 | yes — direct re-read of `2026-07-21-apply-orchestration-hardening/verification.md`; seven duties and three bounded upgrade paths recorded | covered |
| AC-3 | yes (per-concept adopt/adapt/reject table; corrected at rev 3) | T3 | yes — table now has 6 per-concept data rows + 8 rejected-source data rows; decision values constrained; all spec-named source families present | **covered at rev 3** |
| AC-4 | yes (top correction candidate + simplicity/deferred constraints) | T4 + T5 | yes — DC-1/DC-2 each have chosen simplification, ceiling, observable trigger, upgrade path; simplicity axes complete | covered |
| AC-5 | yes (CONTEXT.md glossary addition with `_Avoid_`) | T6 | yes — diff shows exactly one bounded two-line glossary entry; `npm run lint:skills` exits 0; reference paths point to this package | covered |

## Simplicity axis

- Selected rung: **confirmed** — unchanged from rev 2. Option 1 (eval harness, rung 7 — new local executable) is correctly scoped to a separate work id. Option 2 (surface-delta check, rung 6 — extend `assess-change`) is correctly scoped to a separate work id. This assessment is analysis-only.
- Safety floor: **retained**. No new dependency, no hosted service, no new trust boundary, no production code change. The rev 3 table fix is a documentation-only correction.
- Surface delta: **as predicted**. The implementation journal recorded the actual delta: one governed package, one `CONTEXT.md` glossary addition (2 physical lines). The rev 3 producer correction changed only `evidence/reference-concepts.md`; hashes of spec, plan, review, implementation, verification, and analysis.md are unchanged.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| already sufficient | `evidence/reference-concepts.md` (rev 3) | none | none — table fix completes AC-3 | kept as-is at rev 3 |
| already sufficient | the rest of the package (Qodo re-evaluation, catalog static check, verify step re-evaluation, candidate ranking, Simplicity decision, deferred constraints, CONTEXT.md glossary) | none | none | kept as-is |
| remove | the loose "Observed concepts" narrative block that existed at rev 2 | replaced by a 6-row per-concept table at rev 3 | none — the table preserves all unique content from the narrative | adjusted at rev 3 by producer |

## Executability audit

- All files referenced by the plan exist and are non-empty.
- The rev 3 table fix completes the T3 contract (per-concept adopt/adapt/reject table); no producer evidence is missing.
- The `CONTEXT.md` change in T6 is in place and matches AC-5's literal requirement.
- The producer's reference-concepts table covers all source families named in the spec; the wording inconsistency (six/seven/eight/nine counts across spec.md lines) is recorded above and is not blocking.
- No unrelated changes or untracked files outside the governed package.

## Verdict

`approve`

Revision 3 of this package is decision-complete and executable. The rev 2 → rev 3 producer correction closed the AC-3 contract-defect identified by the verifier (per-concept adopt/adapt/reject table now present; all named source families covered; decision values constrained to the supported set). Spec, plan, review, implementation, verification, and `evidence/analysis.md` are unchanged from rev 2 and remain correct. The `CONTEXT.md` glossary addition is in place and matches AC-5. Both producer gates (`plan` and `review` stages) pass with zero errors and zero warnings. The full project gate passes at 185/185 tests with typecheck, build, smoke, and lint green. The single wording ambiguity (source-count mismatch in the spec) is recorded as a minor observation; it is not a contract failure and does not block approval. Manifest status will be set to `approved` after this review closes; the approval applies to revision 3.

## External evidence sufficiency

`required and sufficient`. The package names seven+ external sources (Microsoft `agent-skills`, Phoenixrr2113/agent-harness, jscraik/Agent-Skills, OpenAI Agents SDK, MCP, AWS Bedrock AgentCore Memory SDK, GitHub Copilot Coding Agent, MITRE ATLAS) and a governing Reference Concept Analysis exists at `evidence/reference-concepts.md`. The load-bearing claims checked independently at this review are:

- MCP `2025-06-18` specification at `github.com/modelcontextprotocol/modelcontextprotocol/blob/.../docs/specification/2025-06-18/index.mdx` still exists and is still described as the authoritative protocol; the assessment's claim that Codepatrol's local CLI does not have the multi-tenant surface that the spec's transport-layer authorization targets is independent of any spec revision.
- MCP `2026-07-28` release candidate at `blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/` exists and is described as the largest revision of the protocol since launch; the assessment's claim that direct integration is rejected is product-contract-driven and unaffected by the new release.
- Microsoft `agent-skills` commit `d884ae04edebef577e82ff7c4e143debd0bbec99` (re-used from the prior apply-orchestration-hardening reference; consulted by the producer at 2026-07-21 and not re-verified here because the pin is unchanged from a prior verified source).

No new external integration was introduced by the rev 3 correction; the table fix is documentation-only.

## Residual concerns and evidence gaps

- The verifier-independence gap (same harness/model across plan/apply/verify/review) is a pattern across every prior package and is disclosed in the manifest. Not a contract failure.
- Option 1 (eval harness) and option 2 (surface-delta check) remain deferred candidates, awaiting user authority for their separate work ids. The open question recorded in `spec.md:128` is unchanged.
- The spec-internal source-count inconsistency (six/seven/eight/nine across spec.md lines) is a minor wording observation inherited from rev 2; not blocking; not material to AC-3's literal criterion.
- This review re-executed: catalog walk, `npm run verify`, AC-3 table-shape check, `CONTEXT.md` diff check, external-evidence check, and graph sync/impact/wiki-status probes. It did not re-execute a fresh verifier pass (same harness/model); the producer's gates and this review's independent re-checks together cover the contract.