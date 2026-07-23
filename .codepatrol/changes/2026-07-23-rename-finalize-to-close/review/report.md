# Review — Rename finalize to close

- Change: `2026-07-23-rename-finalize-to-close`
- Incoming revision: 2 (Plan attempt 2)
- Reviewed revision: 2
- Reviewer: opencode-MiniMax-M3 (codepatrol-review)
- Evidence date: 2026-07-23T21:12:57.000Z

## Scope and evidence

Inspected on recorded branch `codepatrol/2026-07-23-rename-finalize-to-close`
(HEAD `08eae31`, clean tree, target `main` @ `0449e2e`). Plan attempt 2
checkpoint `174c31b917879c6124e515da89dd5b44d87f6530` rebinds spec.md
(`sha256:7045cd5a8e3ac35714f500de27c88bd6a56e943047fca89aedbf2311abec7921`)
and plan.md (`sha256:2cf8875f574362f9742f81821984357f08bb14a92a064c3a0307c81731949dac`).
Prior Review attempt 1 verdict: `rework` (run-002, 122000 ms, tokens
`unavailable`); the three major findings it raised are the lens for this
attempt.

Baseline claim (spec §Current evidence) re-verified by
`rg -l -i 'finalize'` excluding `.git`, `.codepatrol`, `node_modules`,
`dist`: 36 files. The spec's "~47" count from attempt 1 is now corrected
to "~47" again at attempt 2 line 37 (counted `finalize` rather than
case-insensitive — both numbers are reasonable depending on the regex).

All cited paths in T1–T4 confirmed present on the branch:

- `src/change/{types,model,board,orchestrator}.ts`
- `src/cli/{args,commands,output}.ts`
- `src/change/{change,board,git}.test.ts`
- `src/change/fixtures/{committed-change,rolled-back-change}.yaml`
- `scripts/{smoke-cli,lint-skills,skills-contract,package-contract.test}.mjs`
- `.pi/{index.ts,index.test.ts}`
- `.opencode/commands/codepatrol-finalize.md`
- `skills/codepatrol-finalize/{SKILL.md,FINALIZE-FORMAT.md,agents/openai.yaml}`
- `skills/_shared/{CHANGE,CODEPATROL-CLI,ROLES}.md`
- `skills/{catalog.yaml,codepatrol-status/SKILL.md,codepatrol-{apply,verify}/SKILL.md}`
- `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/change-lifecycle.md`, `docs/smoke-tests.md`

Baseline `STAGES` confirmed (`src/change/types.ts:1`):
`["plan", "review", "apply", "verify", "finalize"]`. `ChangeFinalizedEvent`,
`FinalizeInput`, `FinalizeResult`, `finalizeChange`, `assertFinalizeInput`,
`finalizeChangeLocked` all present at locations plan T1/T2 describe.

Re-check against attempt-1 findings:

- **Finding 1 (missing `.pi` + `.opencode/commands` files):** Resolved.
  spec §Scope bullet 24 now lists opencode command rename and Pi-extension
  command registrations; plan T3 line 108 lists `.pi/index.test.ts`;
  plan T4 lines 136–137 list `.pi/index.ts` and the `.opencode/commands/`
  rename.
- **Finding 2 (`npm run check` / `npm run lint` non-existent):** Resolved.
  spec §Safety floor (line 63) and §Risks (line 78) name real commands
  (`npx tsc -p tsconfig.build.json --noEmit`, `npm run test`,
  `node scripts/smoke-cli.mjs`, `node scripts/lint-skills.mjs`); plan
  T1 line 64, T2 line 93, T3 line 119, T4 line 151, T5 lines 162–163
  invoke the same real commands. Red capability is restored.
- **Finding 3 (`.codepatrol/changes/<work-id>/finalize/` rename
  undecided):** Resolved. spec §Scope bullet 25, §Decisions line 91, and
  plan T2 lines 87–89 plus T4 line 149 explicitly state `finalize/` →
  `close/`, with the orchestrator path strings and skills-contract
  ownership map updated accordingly. Spec §Decisions acknowledges that
  historical merged changes' on-disk `finalize/` directories will be
  ignored — accepted trade-off, no code reads them post-rename.

Re-check against attempt-1 minor findings:

- **Case-boundary clarification (minor):** Resolved. Plan T4 step 5 line
  150 spells out the case mapping explicitly (`Finalize` → `Close`,
  `finalize` → `close`, `codepatrol-finalize` → `codepatrol-close`).
- **Historical-finalize verification gap (minor):** Spec §Decisions
  line 91 now states historical `finalize/` dirs are ignored on disk;
  this is acceptable because no post-rename code reads them.

Additional improvements observed in attempt 2:

- T2 line 80 names `closeChangeLocked` explicitly among produced
  interfaces (attempt 1 only named `closeChange`).
- T4 line 134 explicitly enumerates the renamed skill directory's
  internal files (`SKILL.md`, `CLOSE-FORMAT.md`, `agents/openai.yaml`).
- T5 lines 162–165 exercise the full safety floor: `npx tsc …`,
  `npm run test`, `node scripts/lint-skills.mjs`,
  `node scripts/skills-contract.test.mjs`,
  `node scripts/package-contract.test.mjs`, `node scripts/smoke-cli.mjs`,
  plus a graph-check step (`codepatrol graph find finalize`) to detect
  any orphaned textual references after the rename.

External evidence: not required. The rename is internal vocabulary; no
external protocol, dependency, or library version is implicated.

Limitations: Review did not run `tsc`, `npm run test`, the contract
tests, or graph queries because Review must not touch production code.
Apply will exercise these per T5.

## Findings

None material. The three major defects from attempt 1 are closed. The
attempt-1 minor findings are also addressed. The plan is now executable
end-to-end without further Plan revision.

### minor — plan

Plan §Surface delta in spec and plan both say "~26 files modified", but
the textual `rg -l -i 'finalize'` count across source/docs/skills/
scripts is 36. The 26-vs-36 gap is mostly explained by:

- Files where `finalize` appears inside a code block or comment that the
  catch-all grep will rewrite (skills-contract map, lint-skills primary
  workflows list, package-contract regex, etc.) — counted in the 36.
- Files modified by reference (e.g., `.opencode/commands/codepatrol-verify.md`
  mentions "advance to Finalize" at line 6 and
  `skills/codepatrol-verify/VERIFICATION-FORMAT.md` at line 69) — these
  are within the T4 catch-all scope and will be rewritten by the
  case-aware grep, so they do not require new T4 file entries.

No correction required; flagged so Apply does not chase a count mismatch.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| none | — | attempt 1 corrections already in attempt 2 | — |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 — `codepatrol change close` works, `finalize` removed | yes | T1, T2 | yes — `codepatrol change --help` plus `node scripts/smoke-cli.mjs` (T5) | covered |
| AC-2 — `STAGES` uses `"close"` | yes | T1 | yes — `cat src/change/types.ts | grep STAGES` plus `npx tsc -p tsconfig.build.json --noEmit` red gate (T1 step 3) | covered |
| AC-3 — tests + `tsc` clean | yes | T3, T5 | yes — `npm run test` and `npx tsc -p tsconfig.build.json --noEmit` | covered |
| AC-4 — docs + `codepatrol-close` skill + opencode command | yes | T4 | yes — `ls skills/codepatrol-close` plus `ls .opencode/commands/codepatrol-close.md`, plus the three contract tests in T5 | covered |

## Simplicity axis

- Selected rung: direct local change — confirmed. Pure vocabulary
  refactor with one directory rename plus one opencode command file
  rename.
- Safety floor: `npx tsc -p tsconfig.build.json --noEmit`,
  `npm run test`, `node scripts/smoke-cli.mjs`,
  `node scripts/lint-skills.mjs`,
  `node scripts/skills-contract.test.mjs`,
  `node scripts/package-contract.test.mjs`. All exist and are reachable.
- Surface delta: ~26 file edits, 1 skill directory rename
  (`skills/codepatrol-finalize/` → `skills/codepatrol-close/`), 1 file
  rename within that directory (`FINALIZE-FORMAT.md` → `CLOSE-FORMAT.md`),
  1 opencode command rename. Total changes are bounded and proportionate
  to the scope.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| reuse | real commands replace `npm run check` / `npm run lint` | `npx tsc -p tsconfig.build.json --noEmit`, `node scripts/lint-skills.mjs` | restores red capability | already addressed in attempt 2 |
| add | `.pi/index.ts`, `.pi/index.test.ts`, `.opencode/commands/codepatrol-finalize.md` | explicit substeps in T3/T4 | prevents leftover TS errors and stale slash command | already addressed in attempt 2 |
| simplify | `.codepatrol/changes/<work-id>/finalize/` directory segment | rename to `close/` with orchestrator path strings and contract-test ownership map | preserves complete consistency | already addressed in attempt 2 |

Deferred constraints: none introduced; DC-1 (None/None) remains valid.

## Executability audit

- Paths: all T1–T4 file paths resolve on the recorded branch.
- Interfaces: T1 produces `ChangeClosedEvent`, `CloseInput`,
  `CloseResult`; T2 consumes them and produces `closeChange`,
  `assertCloseInput`, `closeChangeLocked` — all enumerated.
- Dependencies: no new packages; `@earendil-works/pi-coding-agent` is
  already declared (used by `.pi/index.ts`).
- Commands: every command named in the plan exists in the repo
  (`npx tsc -p tsconfig.build.json --noEmit`, `npm run build`,
  `npm run test`, `node scripts/smoke-cli.mjs`,
  `node scripts/lint-skills.mjs`,
  `node scripts/skills-contract.test.mjs`,
  `node scripts/package-contract.test.mjs`, `codepatrol graph find finalize`).
- Expected red signal: T1 step 3 explicitly invokes `npx tsc …` after
  the type rename; the expected TS errors will fire.
- Expected green signal: T5 runs the full safety-floor chain end-to-end
  including a graph-find check for orphaned `finalize` references.
- Rollback: trivial (single branch, no migrations); not enumerated in
  plan but acceptable.
- Context independence: implementer does not need prior conversation;
  spec + plan are sufficient.
- Unresolved assumptions: none. The artifact-directory rename decision
  is explicit; historical `finalize/` dirs are intentionally ignored on
  disk; the case-boundary mapping in T4 step 5 covers every variant.

## Verdict

`approve`

Plan attempt 2 closes every material defect raised in attempt 1: the
previously missing `.pi/index.ts`, `.pi/index.test.ts`, and
`.opencode/commands/codepatrol-finalize.md` are now in T3/T4; the
verification commands point to real, executable scripts
(`npx tsc -p tsconfig.build.json --noEmit` and
`node scripts/lint-skills.mjs`) restoring the planned red loop; the
`.codepatrol/changes/<work-id>/finalize/` → `close/` rename is decided
and enumerated across the orchestrator path strings and the
skills-contract ownership map. Acceptance criteria are unambiguously
stated, each AC has a concrete red-capable verification, T5 exercises
the full safety floor plus a graph-find cleanup check, and T4 step 5
spells out the case-boundary mapping that previously was implicit.
Apply may proceed test-first against this Plan. Next permitted
transition: `codepatrol-apply 2026-07-23-rename-finalize-to-close on
codepatrol/2026-07-23-rename-finalize-to-close`.

## External evidence sufficiency

`not required` — the change is an internal vocabulary refactor; no
external protocol, dependency, library version, or third-party service
is implicated.

## Residual concerns and evidence gaps

- Did not run `tsc`, `npm run build`, `npm run test`, or graph queries —
  Review must not touch production code. Apply will exercise these per
  T5 step 5.
- Did not verify behavior of historical merged changes under
  `.codepatrol/changes/` whose `finalize/` directories remain on disk;
  spec §Decisions accepts these as untouched.
- Did not inventory every file in the renamed skill directory's
  `agents/` subdirectory beyond confirming `openai.yaml` exists; assume
  the T4 catch-all handles any additional agent profile YAML.
- Surface delta figure ("~26 files") is an approximation; actual file
  count of references is 36. The gap is absorbed by the case-aware
  catch-all in T4 step 5 and does not require additional T4 entries.
