# Verification — Minor improvements, token count logic, actor tracking, and legacy cleanup

- Change: `2026-07-23-cleanup-and-push`
- Verified revision: 6
- Verifier: opencode (codepatrol-verify)
- Base ref: `85936b5e1f5fbc5f10c32725042b610772d978d1` (= `main`)
- Head ref: candidate tree `6cb8c1f13df3e4d65519ac2cf42e6e328bf4586f` at Apply checkpoint `487c025d07ecc72356b5dd50a3e948a324a0e834`
- Evidence date: 2026-07-24T00:56:55.000Z

## Scope and instruments

Artifacts read:

- `.codepatrol/changes/2026-07-23-cleanup-and-push/plan/spec.md` — sha256 `8bfc5d02…844` (matches declared).
- `.codepatrol/changes/2026-07-23-cleanup-and-push/plan/plan.md` — sha256 `d17e1723…888` (matches declared).
- `.codepatrol/changes/2026-07-23-cleanup-and-push/review/report.md` — sha256 `621a086c…728c` (matches declared).
- `.codepatrol/changes/2026-07-23-cleanup-and-push/apply/journal.md` — sha256 `43aebaa4…1979` (matches declared).
- `.codepatrol/changes/2026-07-23-cleanup-and-push/change.yaml` — full event history: Plan attempts 1-6 (1-5 invalidated, 6 completed); Review attempts 1-6 (1 invalidated, 2-5 returned, 6 completed); Apply attempt 1 returned, attempt 2 completed at `487c025d`.

Diff range audited: `9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905..487c025d07ecc72356b5dd50a3e948a324a0e834`. This Apply's contribution: 13 production files (`.pi/index.test.ts`, `.pi/index.ts`, `src/change/board.test.ts`, `src/change/board.ts`, `src/change/change.test.ts`, three fixtures, `src/change/git.test.ts`, `src/change/orchestrator.ts`, `src/change/store.ts`, `src/change/types.ts`, `src/change/usage.ts`, `src/cli/cli.test.ts`). The remaining 6 files in the candidate tree (`AGENTS.md`, four skill markdowns) are from the prior parallel-review Change and are out of scope here.

Commands executed in this session:

- `codepatrol change inspect --id 2026-07-23-cleanup-and-push --workspace "$PWD" --format json` (multiple times)
- `git status --short --branch`
- `git diff --stat 9dbe8db..487c025d -- <files>`
- `git diff 9dbe8db..487c025d -- <files>` (spot-checked key files)
- `npm run typecheck`
- `npm run test`
- `npm run lint:skills`
- `npm run smoke:cli`
- `npm run build`
- `node --import jiti/register scripts/render-kanban.mjs`
- `node --import jiti/register scripts/render-kanban.test.mjs`
- `codepatrol graph impact --since-ref 9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905`

Environment limits: opencode harness does not emit provider tokens; `tokens.status = unavailable` is recorded for this run, mirroring the catalog and prior runs in this Change.

## Plan conformance

Task-by-task diff against `plan.md`:

| Plan task | Plan target | Applied to | Match |
|---|---|---|---|
| T1 — Type and core renaming | `types.ts`, `usage.ts`, `board.ts` | all three files; `TokenUsage` → `CharacterUsage`, `tokens` → `characters`, `tokenText` → `characterText`, `~t` → `~c` | yes |
| T2 — Test/fixture renaming | `change.test.ts`, `git.test.ts`, `board.test.ts`, three fixtures | all six files; `tokens:` → `characters:` in every run-recorded event | yes |
| T3 — YAML parsing backward compatibility | `src/change/orchestrator.ts:recordFromYaml` | `orchestrator.ts:241-251` migration shim, plus an unplanned `src/change/store.ts:readChangeRecord` shim | yes (orchestrator) + correct extension (store) — see Findings |
| T4 — Character counting and Actor tracking | `.pi/index.ts`, `.pi/index.test.ts` | both files; `sumPiUsage` sums `String(message.content\|\|"")` by role, retains `message.model`; intent `actor` is `` `pi (${active.usage.model\|\|"unknown"})` ``; `run.characters` | yes |
| T5 — Legacy cleanup | `src/cli/cli.test.ts` | legacy `run(["workflow", "prime", ...])` assertion deleted at line 39 | yes |

Deviations: one unplanned but correct extension. T3's intent ("ensure old records don't crash the orchestrator") logically requires the same migration shim at the second YAML-loading point — `src/change/store.ts:readChangeRecord` (used by `change close` and other paths that read a Change's persisted YAML). The Apply added the identical shim there. The journal entry for T3 (`apply/journal.md:7`) only mentions `src/change/orchestrator.ts:recordFromYaml`, which understates the change; this is a minor journal-completeness issue, not a defect (the shim logic is identical and correct at both sites).

## Acceptance re-verification

| Criterion | Command re-executed | Result | Independent of the journal |
|---|---|---|---|
| AC-1 — Characters-based metric with rename + YAML backward-compat | `grep -n "characters:" src/change/fixtures/*.yaml`; `grep -n "characters\." src/change/board.ts`; `git diff --stat 9dbe8db..487c025d -- src/change/orchestrator.ts src/change/store.ts` | three fixtures carry `characters:` exclusively; `board.ts` reads `usage.characters.{total,complete,coverage}`; both YAML-load sites have the migration shim; `npm run test` (127/127 pass) and `npm run typecheck` (clean) confirm runtime correctness | yes |
| AC-2 — `actor` string includes harness and model | `grep -n "actor.*pi.*model" .pi/index.ts`; `grep -n "characters.*model" .pi/index.ts` | `actor: \`pi (${active.usage.model\|\|"unknown"})\`` is set at line 95 of `.pi/index.ts`; the test at `.pi/index.test.ts` was updated in lockstep | yes |
| AC-3 — Legacy `workflow prime` test removed | `grep -n "workflow\|prime" src/cli/cli.test.ts` | legacy assertion is gone; remaining `cli.test.ts` covers the explicit Change lifecycle and the deterministic status command | yes |

Substrate evidence (independently re-checked):

- `src/change/types.ts:5,9,26` now exports `CharacterUsage`, `RunUsage.characters`, `UsageSummary.characters`.
- `src/change/board.ts:5-26` renames the helper to `characterText` and emits the `~c` suffix — visible in the kanban render (e.g., `#4 active; 0~c 0/6; 1h05m`).
- `src/change/orchestrator.ts:241-251` parses YAML and rewrites `run.tokens` → `run.characters` before `assertChangeRecord` validates the record.
- `src/change/store.ts:13-26` mirrors the shim in `readChangeRecord`, the second YAML-loading point.
- `.pi/index.ts:25-37` iterates all messages, sums `String(message.content\|\|"").length` for `user`/`system` into `input` and for `assistant` into `output`, and tracks `message.model` separately. `total.total = total.input + total.output` is recomputed at the end so the existing field semantics hold.
- `src/cli/cli.test.ts` no longer references `workflow` or `prime`.

Deferred constraints (per `spec.md`): none. No DC-N trigger activated.

## Wider suite

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass (no diagnostics) |
| Tests | `npm run test` | pass (127/127) |
| Lint skills | `npm run lint:skills` | pass (`Skill catalog, frontmatter, dependencies, portability, and relative links are valid.`) |
| CLI smoke | `npm run smoke:cli` | pass (`Compiled CLI smoke passed (0.1.0).`) |
| Build | `npm run build` | pass (clean tsc) |
| Kanban render | `node --import jiti/register scripts/render-kanban.mjs` | pass; `2026-07-23-cleanup-and-push` row reflects `#1 active` in Verify |
| Kanban script test | `node --import jiti/register scripts/render-kanban.test.mjs` | pass (1/1) |

Shortest decisive output lines quoted above; no warnings emitted.

## Blast radius

`codepatrol graph impact --since-ref 9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905`:

- 31 seed files (13 production files of this Apply + 6 from the prior parallel-review Change + 12 Change artifact files); 7 affected files at depth 1.
- Affected files: `scripts/render-kanban.mjs`, `src/change/{model,session,validation}.ts`, `src/cli/commands.ts` (depth 1) and `scripts/render-kanban.test.mjs`, `src/cli/main.ts` (depth 2).
- Affected tests: `scripts/render-kanban.test.mjs`, `scripts/skills-contract.test.mjs`, `src/change/board.test.ts`, `src/change/change.test.ts`, `src/change/git.test.ts`, `src/graph/store.test.ts`, `src/shared/workspace.test.ts`, `src/wiki/wiki.test.ts`. All 127 `node --test` cases pass and `render-kanban.test.mjs` passes — affected tests are exercised and green.
- "Possibly affected through ambiguous edges" lists 12 additional files (graph analysis, manifest, lock, etc.) — these were not in the seeds and are flagged only because the graph cannot resolve every edge. No regression was observed in the suite.

Seams the plan did not list but were touched: `src/change/store.ts` (T3 extension — see Findings). The extension is bounded and correct.

## Regressions

`npm run test` exercises 127 tests covering the change orchestrator, CLI commands, args parsing, graph store/render, wiki state machine, repo-files, lock, atomic-store, board render, kanban, render-kanban, and skills contract. All pass — no behavior drift at any surviving interface.

Cross-checks beyond the changed files:

- The Kanban CLI render uses the new `characterText` helper and emits the `~c` suffix consistently; no `~t` suffix anywhere in the output.
- `codepatrol change doctor --id 2026-07-23-cleanup-and-push` (skipped in this session to avoid mutating state, but the inspect data is internally consistent: every accepted artifact hash matches the recorded file).
- The prior `parallel-review` Change's `AGENTS.md` and skill markdowns remain intact; this Apply did not touch them.

## Unplanned changes

| Path | Declared in spec/plan | Disposition |
|---|---|---|
| `src/change/store.ts` | no (T3 listed only `orchestrator.ts`) | accepted as a correct extension of T3's intent — `readChangeRecord` is the second YAML-loading point and must perform the same shim to keep legacy workspaces loadable. Identical logic to `orchestrator.ts:recordFromYaml`. |
| `.pi/index.ts` line 9 → `sumPiUsage` signature | yes (T4 modifies `.pi/index.ts`) | accepted |
| `.pi/index.test.ts` | yes (T4 step 4) | accepted |
| The 6 prior-Change files (`AGENTS.md`, `skills/codepatrol-{apply,plan,review,verify}/SKILL.md`) | n/a (out of this Apply's scope) | not touched by this Apply; carried over from `2026-07-23-parallel-review` |

One unplanned path, one rationale, accepted.

## Findings

### minor — evidence — apply journal understates T3's surface

- Location: `.codepatrol/changes/2026-07-23-cleanup-and-push/apply/journal.md:7`.
- Verified evidence: the journal says "Implemented backward compatibility inside `src/change/orchestrator.ts:recordFromYaml`" but the actual diff also adds the same shim to `src/change/store.ts:readChangeRecord`. Both edits are required to keep legacy `tokens:` records loadable from any code path that reads a Change YAML.
- Impact: low. The shim is identical in both files, both pass `npm run test` (127/127), and `codepatrol change doctor` would not flag a drift because the working tree is clean. A reviewer reading the journal alone would miss the second site; reading the diff makes the scope clear.
- Required correction: none for this Change (out of scope). Future Apply journals should enumerate every file an Apply step touched, especially when a documented step logically fans out to multiple files.

## Residual risks and evidence gaps

- The YAML migration shim is a runtime compatibility layer; it does not migrate on-disk state. A workspace that has already been closed under the old schema will still contain `tokens:` YAML literals on disk until Apply's T2 renames the in-repo fixtures. External users with their own change records under the old schema will be auto-migrated at read time — this is the intended behavior per `spec.md:65`.
- Token-metric coverage for this Verify run is `0/1` measured (opencode harness). Coverage for the whole Change (plan+review+apply+verify) is `0/4` measured. Mirrors the existing metric profile and is not a verification defect.
- The migration shim is a structural rewrite (sets `event.run.characters = event.run.tokens; delete event.run.tokens;`) which mutates the parsed object before validation. If a future Change introduces new fields on the `RunUsage` envelope, the shim's hardcoded set of "tokens" / "characters" must be revisited. Recorded as a future-trigger note; not a defect today.
- `git diff` for `src/change/store.ts` shows the migration shim is correct and self-contained, but the journal should ideally have noted it. Recorded under Findings.

## Verdict

`commit`

Every Plan task is satisfied by the production diff. The five gates (typecheck, tests, lint:skills, smoke:cli, build) plus the kanban render all pass. Blast radius is small and exercised; affected tests are green. The only finding is a minor journal-completeness note: T3's shim was applied at the second YAML-loading site (`src/change/store.ts`) in addition to the documented `src/change/orchestrator.ts:recordFromYaml`, and the journal entry names only the documented site. The implementation is correct and necessary; the journal understates the scope. This does not block commit.

Candidate is `487c025d07ecc72356b5dd50a3e948a324a0e834` (tree `6cb8c1f13df3e4d65519ac2cf42e6e328bf4586f`). Next Change transition: `codepatrol-close 2026-07-23-cleanup-and-push commit|rollback on codepatrol/2026-07-23-cleanup-and-push`.
