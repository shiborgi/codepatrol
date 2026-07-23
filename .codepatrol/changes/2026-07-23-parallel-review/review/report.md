# Review — Parallel Review and Verify

- Change: `2026-07-23-parallel-review`
- Incoming revision: 1
- Reviewed revision: 1
- Reviewer: opencode (codepatrol-review)
- Evidence date: 2026-07-23T22:52:45.000Z

## Scope and evidence

Files inspected (read-only, no production code touched):

- `.codepatrol/changes/2026-07-23-parallel-review/change.yaml` — stage-checkpointed event at `03c5f31d617ba2cfd5893891518972edb9446a05` with tree `960acdbc5065f72743a56c88b3accca13b5c53bb`.
- `.codepatrol/changes/2026-07-23-parallel-review/plan/spec.md` — sha256 `679bb8de…c801` (matches declared hash).
- `.codepatrol/changes/2026-07-23-parallel-review/plan/plan.md` — sha256 `5c912486…28e0` (matches declared hash).

Git reconciliation:

- Branch: `codepatrol/2026-07-23-parallel-review` (HEAD `685d0b245cc56533db6b7d520a409452d0bd5677`).
- Base commit `9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905` resolves to `main`.
- Working tree clean; only `.codepatrol/changes/2026-07-23-parallel-review/{change.yaml,plan/spec.md,plan/plan.md}` differ from `main`.
- No production code modified by Plan.

Substrate evidence (cited files verified by `Read`):

- `src/change/session.ts:74` — `claimSessionItem` exists; `session.ts:81` — `closeSessionItem` accepts `artifacts: string[]`, so a single session item can carry multiple persona artifacts.
- `src/change/session.ts:44` — `deriveItems` walks `plan.md` task headings; the Apply stage may end up with multiple items, but Review/Verify default to one `{stage}-work` item. The schema permits multiple parallel items via `items: SessionItem[]` (line 11).
- `src/change/types.ts:25` — `StageAttempt.artifacts: ArtifactBinding[]` is an array (multiple artifacts per attempt are first-class).
- `src/change/orchestrator.ts:235` — supports `stage-returned` events with `to_stage`, `reason`, `next_action`; return flow already preserves the full event history.
- `skills/catalog.yaml:30` — `codepatrol-review` may invoke `assess-change` and `research-technology`; verification path is `assess-change` (line 78) and `solution-simplification` (line 159).
- `AGENTS.md` — currently has no explicit context-isolation clause; the harness rule "Another harness must need no conversation history" lives in `skills/codepatrol-plan/SKILL.md:40` but does not bind the explicit Review/Verify stages.

Baseline and graph impact:

- `codepatrol graph impact --file src/change/session.ts` and `--file src/change/orchestrator.ts` show that the substrate modules are referenced by `src/change/change.test.ts`, `src/cli/commands.ts`, and the public scripts. The plan does not modify any of these files, so impact is unchanged.
- Wiki substrate state: AGENTS.md declares wiki can be reported absent (valid). The plan exercises `codepatrol wiki validate` as a green gate, which sidesteps the absent-wiki case.

Limitations:

- AC-2 (Context Isolation) is verified by inspection of the updated documentation, not by a runtime test asserting that the harness has a fresh context window. This is acceptable for a documentation-only Change whose substrate is not under review.
- Token metrics for the Plan run are unavailable in the opencode harness; the metrics section below records `complete: false` for the Plan phase, which is the current normal state.

## Findings

No critical or major findings. One minor observation (non-blocking) is recorded under "Residual concerns".

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `spec.md` | none | spec is decision-complete; alternatives, deferred constraints, and risks are sound | AC-1, AC-2, AC-3 |
| `plan.md` | none | dependency order T1→T2→T3, surfaces, and verification verbs are aligned with substrate | AC-1, AC-2, AC-3 |

No Plan artifact edits required before approval.

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 — Concurrent Reviewers | yes | T1 | yes — `change session claim`/`close` with multiple `*-work` items, observed in `.codepatrol/runtime/sessions/<id>/review/1.json` and the documented `review-security`/`review-architecture` pattern | covered |
| AC-2 — Context Isolation | yes | T2 | partially — README/SKILL update is observable; runtime isolation is delegated to the harness and cannot be asserted by repo tests alone | covered (documentation) |
| AC-3 — Aggregated Feedback | yes | T3 | yes — updated `codepatrol-plan`/`codepatrol-apply` skills instruct agents to read all `.md` in `review/` or `verify/` after a return; the substrate already preserves `artifacts[]` on `stage-returned` events | covered |

## Simplicity axis

- Selected rung: confirmed — "minimum new implementation: documentation updates only."
- Safety floor: durable artifacts are hashed at every stage-checkpointed event; `stage-returned` events carry `to_stage`/`reason`/`next_action` and the existing event history is preserved. The plan does not weaken validation, data protection, security, accessibility, or reliability.
- Surface delta: five markdown files (`skills/codepatrol-review/SKILL.md`, `skills/codepatrol-verify/SKILL.md`, `AGENTS.md`, `skills/codepatrol-plan/SKILL.md`, `skills/codepatrol-apply/SKILL.md`). No code, schema, or catalog changes.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| reuse | `src/change/session.ts` | `claimSessionItem`/`closeSessionItem` already support multiple items per attempt | none — substrate fully supports the pattern | already sufficient |
| built-in | `StageAttempt.artifacts: ArtifactBinding[]` | multiple artifacts per attempt already first-class | none | already sufficient |
| simplify | risk note "one reviewer approves, one returns" | coordinator should wait for all parallel items to close; wait logic is the harness's responsibility, not a code change here | none — coordination rule is a documentation directive | adjusted (already in spec) |
| speculative | dynamic persona generation | explicitly deferred (DC-1) with ceiling and trigger | none today | deferred |

Deferred constraint DC-1 has a known ceiling (needs dynamic personas), an observable trigger (needs dynamic personas), and a bounded upgrade path (add dynamic session item generation based on change risk). All three are required by the format spec and are present.

## Executability audit

- Paths: all five target files exist and are writable. Confirmed by `ls`.
- Interfaces: `codepatrol change session claim/close` already accepts the per-item artifact array; `codepatrol change transition` already accepts `stage-returned` with `to_stage`/`reason`/`next_action`; no interface changes proposed.
- Dependencies: no new dependencies.
- Commands: `codepatrol wiki validate --workspace "$PWD" --format json` is a real CLI subcommand and is the documented green gate.
- Expected red and green signals: T1 expects green `wiki validate` after doc edits; T2 expects green after `AGENTS.md` adds the context-isolation clause; T3 expects green after `plan`/`apply` skills add the "read all `review/`/`verify/` markdown on resume" step. T4 re-runs the targeted validations and verifies that only markdown files were touched.
- Rollback: a Plan- or Review-stage return is the documented rollback path; no production code, so there is no runtime regression to revert.
- Context independence: the resulting plan is self-contained — every cited file, command, and AC trace is in this report or in the plan artifacts.

No unresolved assumptions block approval.

## Verdict

`approve`

The Plan is decision-complete, substrate-consistent, and contains zero production code changes. The schema, session, and orchestrator already support concurrent session items and multiple artifacts per attempt, so the Change is a legitimate capability codification. All five cited target files exist; the base commit, branch, and working tree reconcile cleanly; and the dependency order preserves the existing ownership boundary. The Plan is ready for `codepatrol-apply` on `codepatrol/2026-07-23-parallel-review`.

## External evidence sufficiency

`not required` — the Change is internal to the project's harness documentation. Substrate changes (graph introspection, schema, session.ts, orchestrator.ts) are governed by the repository, not by external protocols, and no external protocol or dependency is modified.

## Residual concerns and evidence gaps

- AC-2 verification is documentation-only. The "fresh context window" requirement is not enforceable by repo tests; the harness/init protocol must actually invoke a new agent session or clear prior chat history. This is a coordination-layer concern, not a Plan defect, and does not block approval.
- Plan metrics coverage is `0/1` with `complete: false` because provider tokens are unavailable in the opencode harness. This mirrors the catalog note (`complete: false`) for this Change and is not a Review defect.
- The wiki substrate is reported absent (AGENTS.md). `codepatrol wiki validate` is used as a green gate, which is consistent with the absent-wiki substrate state declared in `AGENTS.md`.
