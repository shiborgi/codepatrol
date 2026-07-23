# Verification — Parallel Review and Verify

- Change: `2026-07-23-parallel-review`
- Verified revision: 1
- Verifier: opencode (codepatrol-verify)
- Base ref: `9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905`
- Head ref: candidate tree `c75867209a004d13a9ae9ef4139c588c01be0cbc` at Apply checkpoint `ea028b32d712e670a01ca56c5cb9889764a61bdd`
- Evidence date: 2026-07-23T23:05:28.000Z

## Scope and instruments

Artifacts read:

- `.codepatrol/changes/2026-07-23-parallel-review/plan/spec.md` — sha256 `679bb8de…c801` (matches declared).
- `.codepatrol/changes/2026-07-23-parallel-review/plan/plan.md` — sha256 `5c912486…28e0` (matches declared).
- `.codepatrol/changes/2026-07-23-parallel-review/review/report.md` — sha256 `e94a048c…9d48` (matches declared).
- `.codepatrol/changes/2026-07-23-parallel-review/apply/journal.md` — sha256 `4c23ab9b…6af9` (matches declared).
- `.codepatrol/changes/2026-07-23-parallel-review/change.yaml` — events for plan, review, apply, and verify stages reconcile with the Git log.

Diff range audited: `9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905..ea028b32d712e670a01ca56c5cb9889764a61bdd` (base → Apply content checkpoint). Production-tree additions: five markdown files only.

Commands executed in this session:

- `codepatrol change inspect --id 2026-07-23-parallel-review --workspace "$PWD" --format json` (multiple times)
- `codepatrol change doctor --id 2026-07-23-parallel-review`
- `codepatrol wiki status --workspace "$PWD" --format json`
- `codepatrol wiki validate --workspace "$PWD" --format json`
- `codepatrol graph impact --since-ref 9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905`
- `npm run typecheck`
- `npm run test`
- `npm run lint:skills`
- `npm run smoke:cli`
- `npm run build`
- `node --import jiti/register scripts/render-kanban.mjs`

Environment limits: opencode harness does not emit provider tokens; `tokens.status = unavailable` is recorded for this run, mirroring the catalog and earlier runs in this Change.

## Plan conformance

Task-by-task diff against `plan.md`:

| Plan task | Plan target | Applied to | Match |
|---|---|---|---|
| T1 — Document concurrent session items for personas | `skills/codepatrol-review/SKILL.md`, `skills/codepatrol-verify/SKILL.md` | both files | yes |
| T2 — Codify context isolation | `AGENTS.md`, `skills/codepatrol-review/SKILL.md` | both files | yes |
| T3 — Surface aggregated artifacts on return | `skills/codepatrol-plan/SKILL.md`, `skills/codepatrol-apply/SKILL.md` | both files | yes |
| T4 — Final Verification | `npm test`, diff-only-markdown check | `npm test` (127/127 pass), `git diff --stat` shows only `.md` | yes |

Deviations: none. The Apply also extended `skills/codepatrol-verify/SKILL.md` with a final line `If returning, ensure all persona-specific verification artifacts are attached.` and added a parallel clause to `skills/codepatrol-review/SKILL.md` (`If returning, all persona artifacts are attached.`). These additions are consistent with the persona-artifact aggregation pattern and with AC-3 — they strengthen the spec's intent that all per-persona findings ride on a return event. They are not silent semantic deviations: the persona-attachment rule is implied by the spec's "artifacts are hashed and tracked immutably; returning a stage must not lose any findings" (Safety floor). Recording here for transparency, not as a defect.

The `implementation.md` journal does not mention these two additions explicitly. They are still within the spec's safety floor and do not change the surface delta set declared by the Plan, but the journal would be more accurate if it listed them. Non-blocking.

## Acceptance re-verification

| Criterion | Command re-executed | Result | Independent of the journal |
|---|---|---|---|
| AC-1 — Concurrent Reviewers | `grep -n "review-security\|review-architecture" skills/codepatrol-review/SKILL.md` and same on verify SKILL | pattern present in both files at lines 16 and 17 | yes |
| AC-2 — Context Isolation | `grep -n "fresh context window" skills/codepatrol-review/SKILL.md skills/codepatrol-verify/SKILL.md AGENTS.md` | present in all three (lines 17, 18, 58 respectively); AGENTS.md covers both Plan→Review and Apply→Verify boundary | yes |
| AC-3 — Aggregated Feedback | `grep -n "aggregate and address" skills/codepatrol-plan/SKILL.md skills/codepatrol-apply/SKILL.md` | present at plan line 27 and apply line 20 | yes |

Substrate evidence (independently re-checked against the source):

- `src/change/session.ts:74-87` exposes `claimSessionItem`/`closeSessionItem` with `artifacts: string[]`, so a persona session item can carry multiple per-persona artifact paths.
- `src/change/types.ts:25` declares `StageAttempt.artifacts: ArtifactBinding[]` — multiple artifacts per attempt are first-class.
- `src/change/orchestrator.ts:235` emits `stage-returned` events that preserve the full event history; the `next_action` field can include the Plan/Apply resume hint.
- `codepatrol change session --help` lists `prime | claim | close | rebuild` — the runtime already supports parallel items.

Deferred constraints (per `spec.md`): DC-1 (manual persona creation) — no trigger activated during this Change. No dynamic-persona generator was needed.

## Wider suite

Full project gate results:

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass (no diagnostics) |
| Tests | `npm run test` | pass (127/127) |
| Lint skills | `npm run lint:skills` | pass (`Skill catalog, frontmatter, dependencies, portability, and relative links are valid.`) |
| CLI smoke | `npm run smoke:cli` | pass (`Compiled CLI smoke passed (0.1.0).`) |
| Build | `npm run build` | pass (clean tsc) |
| Kanban render | `node --import jiti/register scripts/render-kanban.mjs` | pass; `2026-07-23-parallel-review` row reflects `#1 active` in Verify |
| Wiki status | `codepatrol wiki status --format json` | `exists: false` — valid absent-wiki substrate per AGENTS.md |
| Wiki validate | `codepatrol wiki validate --format json` | `valid: false, code INDEX_MISSING` — see "Residual risks" |
| Doctor | `codepatrol change doctor` | `Change 2026-07-23-parallel-review is structurally valid; runtime is rebuildable.` |

Shortest decisive output lines quoted above; no warnings emitted.

## Blast radius

`codepatrol graph impact --since-ref 9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905`:

- 10 seed files; 0 affected files.
- "Seeds not in graph" lists all 10 changed files — they are markdown/markdown-sidecars only and have no graph dependents.
- Affected tests: none.

Seams the plan did not list: none. The substrate modules (`session.ts`, `orchestrator.ts`, `types.ts`) and their tests (`change.test.ts`, `git.test.ts`, `cli.test.ts`) are unmodified.

## Regressions

`npm run test` exercises 127 tests covering the change orchestrator, CLI commands, args parsing, graph store/render, wiki state machine, repo-files, lock, atomic-store, board render, kanban, render-kanban, and skills contract. All pass — no behavior drift at any surviving interface.

Cross-checks beyond the changed files:

- `src/change/session.ts` (claim/close artifacts path) — not modified; tested by existing tests, all pass.
- `src/change/orchestrator.ts` (stage-returned emission) — not modified; tested by existing tests, all pass.
- `skills/catalog.yaml` — not modified; `assess-change` and `verification-strategy` still bound to `codepatrol-review` and `codepatrol-verify` as expected.

## Unplanned changes

| Path | Declared in spec/plan | Disposition |
|---|---|---|
| `AGENTS.md` | yes | accepted — declared by T2 |
| `skills/codepatrol-apply/SKILL.md` | yes | accepted — declared by T3 |
| `skills/codepatrol-plan/SKILL.md` | yes | accepted — declared by T3 |
| `skills/codepatrol-review/SKILL.md` | yes | accepted — declared by T1 and T2 |
| `skills/codepatrol-verify/SKILL.md` | yes | accepted — declared by T1 and T2 |

Five files modified; all five declared by the Plan or implicitly required by T1/T2. No unplanned path. No undeclared durable artifact under `.codepatrol/changes/2026-07-23-parallel-review/{plan,review,apply,verify}/`.

## Findings

### minor — evidence — `wiki validate` returns `INDEX_MISSING` while the apply journal claims a green gate

- Location: `.codepatrol/changes/2026-07-23-parallel-review/apply/journal.md:23, 35, 47`.
- Verified command: `codepatrol wiki validate --workspace "$PWD" --format json` → `valid: false, code INDEX_MISSING`.
- Impact: low. `codepatrol wiki status` reports `exists: false`, which `AGENTS.md` line 109 declares a valid substrate state. The Apply did not change the wiki state — it was absent before and is absent after. The journal's "wiki validate passes" wording is misleading but the substrate is unchanged and within contract.
- Required correction: none for this Change (out of scope, would require a separate Plan to materialize a wiki). Future Apply journals should distinguish `wiki status` (substrate) from `wiki validate` (bundle completeness) and only claim green when a bundle exists.

## Residual risks and evidence gaps

- **AC-2 runtime isolation is not enforceable here.** The "fresh context window" rule is a harness contract; the repository only documents it. There is no test that proves a new agent session is started on Review/Verify transitions. This is the same residual the Review report flagged and is a coordination-layer concern, not a Plan or Apply defect.
- **Wiki substrate absent.** `wiki validate` cannot be green without a `docs/wiki/index.md`. The substrate state is unchanged from `main` and is a declared valid state in AGENTS.md, so this is not a regression — but it is an evidence gap for any future persona-driven review that would consume the wiki.
- **Token coverage incomplete.** `tokens.status = unavailable` for this Verify run and for prior runs in this Change (opencode harness limitation). Coverage remains `0/1` measured for this stage.
- **Plan and Apply run metrics also unavailable.** Coverage for the whole Change (plan+review+apply+verify) is `0/4` measured. This matches the existing metric profile and is not a verification defect.
- **Journal accuracy.** The Apply journal claims `codepatrol wiki validate` passes on three steps; in fact the wiki is absent. See the minor finding above. The Apply work product itself is sound.

## Verdict

`commit`

Every Plan task is satisfied by the five markdown files declared in the Apply artifact list. The five gates (typecheck, tests, lint:skills, smoke:cli, build) pass cleanly. Blast radius is zero code dependents. The only finding is a minor evidence accuracy note about the Apply journal's wiki wording; the substrate state itself is unchanged and valid. The candidate is `ea028b32d712e670a01ca56c5cb9889764a61bdd` (tree `c75867209a004d13a9ae9ef4139c588c01be0cbc`). Next Change transition: `codepatrol-close 2026-07-23-parallel-review commit|rollback on codepatrol/2026-07-23-parallel-review`.
