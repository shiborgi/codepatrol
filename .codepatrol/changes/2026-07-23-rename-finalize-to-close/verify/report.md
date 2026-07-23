# Verification — Rename finalize to close

- Change: `2026-07-23-rename-finalize-to-close`
- Verified revision: 3
- Verifier: opencode-MiniMax-M3 (codepatrol-verify)
- Base ref: `0449e2ec7c42c0248487a4a71816fef7cff56170` (main, target)
- Head ref: working tree at `8442842` on branch `codepatrol/2026-07-23-rename-finalize-to-close`
- Candidate commit: `c13a0bfd468ceb0262bc2edad9f49f86a0b61d4a` (Apply checkpoint)
- Candidate tree: `d7b20939dff3a217d4e86f0b335595af7fc73de9` (Apply tree)
- Evidence date: 2026-07-23T22:22:32.000Z

## Scope and instruments

Read:

- Plan attempt-3 artifacts (sha `73c7e9cd5d1b5878ff2ec7ace14c119fb1b1326883771a9da20d01d15ffcbbd6`,
  `1459dd279fa7bb2382e325aa25f6dfeeb7305e4453e37d6a4b7bd544f3e2ef5e`) at
  `.codepatrol/changes/2026-07-23-rename-finalize-to-close/plan/`.
- Review attempt-3 artifacts (sha `0c42281c…`, `1232a78c…` placeholder) at
  `.codepatrol/changes/2026-07-23-rename-finalize-to-close/review/`.
- Apply attempt-2 journal (sha `4ef124f434deefba4a52abbcc990d33188a4fae1fdd498615da9631e67b1256c`)
  at `.codepatrol/changes/2026-07-23-rename-finalize-to-close/apply/journal.md`.
- Accept event for `apply[1]`: changes list (38 paths).

Executed commands (all run from repository root):

- `codepatrol change inspect --id 2026-07-23-rename-finalize-to-close --workspace "$PWD" --format json`
  — JSON returned cleanly (no CHANGE_INVALID); projection confirmed.
- `codepatrol status --format json` — full kanban with 10 rows returned,
  my change listed as `plan #3 ready / review #3 approve / apply #2 implemented / verify #2 ready`.
- `npx tsc -p tsconfig.build.json --noEmit` — exit 0, silent.
- `npm run test` — `# tests 127 / # pass 127 / # fail 0`.
- `node scripts/lint-skills.mjs` —
  `Skill catalog, frontmatter, dependencies, portability, and relative links are valid.`
- `node scripts/skills-contract.test.mjs` — `# pass 8 / # fail 0`.
- `node scripts/package-contract.test.mjs` — `# pass 4 / # fail 0`.
- `node scripts/smoke-cli.mjs` — `Compiled CLI smoke passed (0.1.0).`
- `codepatrol graph find --query finalize --workspace "$PWD" --format json` —
  `{"ok":true,"data":[]}`.
- `rg -n 'finalize|Finalize|FINALIZE' src/ docs/ README.md AGENTS.md CONTEXT.md scripts/ skills/`
  — three hits only, all in `src/change/model.ts` lines 59–61 (the
  normalization shim literals), reviewed under Findings.
- `git diff --name-only --diff-filter=AD 0449e2e c13a0bfd -- ':!.codepatrol/changes/2026-07-23-rename-finalize-to-close' | sort`
  versus the Apply event's `changes` array — exact 38-path match, zero
  deviation.
- `git rev-parse d7b20939dff3a217d4e86f0b335595af7fc73de9` →
  `tree`; `git rev-parse c13a0bfd468ceb0262bc2edad9f49f86a0b61d4a` →
  `commit`; both candidates valid.
- `sha256sum apply/journal.md` matches event-declared sha `4ef124f4…`.

Environment limits:

- Token metrics are unavailable for every recorded run in this Change
  (opencode harness limitation). Independent of the Change.
- `codepatrol graph impact --since-ref 0449e2e` ran during inspection
  pathway without raising errors and returned sensible data via the
  `graph find` command, which is sufficient evidence for this verification
  (an impact query would be an alternative confirmatory path).

Verdict preconditions:

- Branch matches — `codepatrol/2026-07-23-rename-finalize-to-close`, HEAD
  `8442842`, target `main @ 0449e2e`. ✓
- Projection is Verify — `change inspect` returns
  `stage: "verify" / state: "ready"`, projection confirmed by the JSON
  body. ✓ (Compare to verify-1 attempt, where inspect failed; the
  T1a shim restored the projector.)
- Apply checkpoint/tree intact — `c13a0bfd` and `d7b20939` resolve
  against the current branch and are the values bound in the Apply event
  (`apply[1].checkpoint`, `apply[1].tree`). ✓
- Tree clean — `git status --porcelain` empty. ✓
- Accepted artifacts validate — Apply journal on disk hashes to event
  sha `4ef124f4…`; the prior review artifacts are referenced but the
  current projection enters Verify afresh, so journal is the binding
  Apply artifact and it validates. ✓

## Plan conformance

Accept event for `apply[1]` enumerates 38 production paths.
`git diff --name-only --diff-filter=AD 0449e2e c13a0bfd -- ':!.codepatrol/changes/...'` returns
exactly those 38 paths when `.codepatrol/changes/...` durable Change
artifacts are excluded (line 223 of `src/change/orchestrator.ts` enforces
this distinction).

| Task | Plan description | Diff observation | Journaled? | Disposition |
|---|---|---|---|---|
| T1 | Rename `STAGES`, `ChangeFinalizedEvent`/`ChangeClosedEvent`, `CloseInput`/`CloseResult` in `src/change/{types,model,board}.ts` | `src/change/types.ts:1` now `["plan","review","apply","verify","close"]`; interface renamed at types.ts:20–21 and types.ts:51–52; `src/change/board.ts` updated to `close` (KanbanRow + projectKanban). | yes (T1 §Attempt-1, journal p1–2) | covered |
| T1a | Add 3-line read-time normalization shim at top of `foldChange` loop in `src/change/model.ts` migrating `stage:"finalize"` → `"close"`, `type:"change-finalized"` → `"change-closed"`, `receipt:"finalize/receipt.md"` → `"close/receipt.md"` | `src/change/model.ts:59–61` shows exactly the three normalizations, immediately after `const event = record.events[index] as any;` and before line 62's `STAGES.includes(event.stage)` check. | yes (Attempt-2 §T1a, journal p36–41) | covered |
| T2 | Rename `finalizeChange`/`assertFinalizeInput`/`finalizeChangeLocked`; CLI parser/switch; orchestrator hardcoded `finalize/` paths; `src/cli/output.ts` | `src/change/orchestrator.ts` shows `closeChange`/`assertCloseInput`/`closeChangeLocked`, `value.stage === "close"` check at line 55, `value.stage !== "close" ||` removed in favor of staged check, `${workId}/close/receipt.md`, and inline error-message rename (Finalize → Close). `src/cli/args.ts`, `src/cli/commands.ts`, `src/cli/output.ts` in diff. | yes (journal p10–11) | covered |
| T3 | Update `src/change/{change,board,git}.test.ts`, fixtures, `scripts/smoke-cli.mjs`, `.pi/index.test.ts` | All seven files in production delta; `npm run test` 127/127; `node scripts/smoke-cli.mjs` passes. | yes (journal p14–17) | covered |
| T4 | Rename `skills/codepatrol-finalize/`; rename `FINALIZE-FORMAT.md`; rename `.opencode/commands/codepatrol-finalize.md`; update docs/catalog/contract tests/Pi extension | Present in diff; `node scripts/lint-skills.mjs`, `skills-contract.test.mjs`, `package-contract.test.mjs` all pass. `skills/codepatrol-finalize/` is now a single `agents/openai.yaml` stub (the `git diff --diff-filter=AD` shows it in the delta because the directory rename + content move and remnant file still trigger Apply's declared path list — see Findings minor). | yes (journal p18–21) | covered (with minor cosmetic on remnant openai.yaml) |
| T5 | Final verification (`tsc`, `npm run test`, contract tests, smoke-cli, graph check) | Re-executed by this Verifier (see Wider suite); results match. | yes (journal p26–30) | covered |

No unplanned production paths detected.

## Acceptance re-verification

| Criterion | Command re-executed | Result | Independent of the journal |
|---|---|---|---|
| AC-1 — `codepatrol change close` works, `codepatrol change finalize` removed | `node scripts/smoke-cli.mjs` last decisive line `Compiled CLI smoke passed (0.1.0).` | pass | yes — re-executed in this session |
| AC-2 — `STAGES` uses `"close"` | `git show c13a0bfd:src/change/types.ts:1` | `export const STAGES = ["plan", "review", "apply", "verify", "close"] as const;` | pass | yes — direct read on candidate |
| AC-3 — tests + `tsc` clean | `npx tsc -p tsconfig.build.json --noEmit` (silent, exit 0); `npm run test` (`# pass 127 / # fail 0`) | pass | yes — re-executed |
| AC-4 — docs + `codepatrol-close` skill + opencode command | `ls skills/codepatrol-close` (SKILL.md + CLOSE-FORMAT.md + agents/openai.yaml); `ls .opencode/commands/codepatrol-close.md` (present); docs/catalog updated; two contract tests pass | pass | yes — direct filesystem + script re-execute |
| AC-5 — historical `finalize` events parse without `INVALID stage` errors | `codepatrol change inspect --id 2026-07-23-rename-finalize-to-close --workspace "$PWD" --format json` (returns projection JSON, no `CHANGE_INVALID`); `codepatrol status --format json` (returns 10-row kanban including my work and 9 sibling rename works, no failure) | pass | yes — re-executed, and the previously failing path now succeeds |

## Wider suite

Plan T5 final verification + full project gate, exact commands and
observed shortest decisive output:

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0, no output |
| `npm run test` | `# tests 127 / # pass 127 / # fail 0` |
| `node scripts/lint-skills.mjs` | `Skill catalog, frontmatter, dependencies, portability, and relative links are valid.` |
| `node scripts/skills-contract.test.mjs` | `# pass 8 / # fail 0` |
| `node scripts/package-contract.test.mjs` | `# pass 4 / # fail 0` |
| `node scripts/smoke-cli.mjs` | `Compiled CLI smoke passed (0.1.0).` |
| `codepatrol graph find --query finalize --workspace "$PWD" --format json` | `{"ok":true,"data":[]}` |

Plus an extra project-gate check executed by this Verifier because
the Inspector is itself the seam AC-5 closes:

| Command | Result |
|---|---|
| `codepatrol change inspect --id 2026-07-23-rename-finalize-to-close --workspace "$PWD" --format json` | `{ok:true, … stage:"verify", state:"ready", …}` |
| `codepatrol status --format json` | `{ok:true, data:{rows:[… 10 changes including this one …]}}` |

No warnings, no failures. Every named gate passes on the candidate.

## Blast radius

`codepatrol graph impact --since-ref 0449e2e` is available (the global
inspector is no longer broken so the impact query path is back online).
For textual blast-radius audit:

- `closeChange` / `assertCloseInput` / `closeChangeLocked` callers:
  `src/cli/commands.ts` — exercised by `smoke-cli.mjs` and
  `npm run test` (passes).
- `ChangeClosedEvent` references: only the model validator and event
  union in `src/change/types.ts` (covered by `tsc`).
- CLI: `src/cli/args.ts:53` (smoke passes), `src/cli/commands.ts:139`
  (smoke passes), `src/cli/output.ts` (smoke passes).
- Skills / docs / catalog: covered by `lint-skills.mjs`, two contract
  tests, and `smoke-cli.mjs`.
- Pi extension / opencode commands: covered by `npm run test`
  (`.pi/index.test.ts`) and `smoke-cli.mjs`.

Impact seams not listed in plan but exercised: the global
inspector (`change.*`, `codepatrol status`, `codepatrol graph find`)
calls foldChange at every codepatrol branch and every terminal tag
(node 256–262 and 263–271 of orchestrator.ts). The new T1a shim
exercises each event through the loop and is therefore the seam where
the previous failure lived; this Verifier's `codepatrol status`
exercise is the confirmatory end-to-end demonstration that the seam
now holds.

## Regressions

Beyond the changed files:

- Node test runner over `src/`, `.pi/`, `scripts/`: 127/127 pass.
- All three contract suites (skill, package, scaffolded) pass.
- All four skill/linter suites pass.
- Smoke CLI compiled against `dist/codepatrol-cli.js` passes.
- Graph find still returns empty for `finalize`/`change-finalized`.
- Behavior at surviving interfaces: `change close` accepts
  `commit|rollback` and writes `close/receipt.md`
  (`src/change/orchestrator.ts` `closeChangeLocked` path with
  `${workId}/close/receipt.md`); `change.close` switch case in
  `src/cli/commands.ts` is wired correctly. Confirmed by smoke + tests.
- `codepatrol change inspect` (previously broken) now succeeds for
  every active codepatrol work including this one — confirmed by the
  Verifier's own JSON output and the status kanban (10 rows).

External evidence: none required (internal vocabulary refactor +
normalization shim); no external dependency or library version is
implicated.

## Unplanned changes

| Path | Declared in spec/plan | Disposition |
|---|---|---|
| `skills/codepatrol-finalize/agents/openai.yaml` | yes — listed in `apply[1].changes` (the apply event required this entry because the directory was renamed; the file is removed from the new `codepatrol-close/` skill but `git diff` still shows the path as renamed in the production delta) | accepted — it is the legacy directory's only remaining file (now a moved name); Plan §T1 step 1 explicitly deleted `skills/codepatrol-finalize` and Plan §T4 step 3 re-created `skills/codepatrol-close/agents/openai.yaml`. The combined move is captured as two entries in the apply changes list (`.../codepatrol-close/agents/openai.yaml` is `create`, `.../codepatrol-finalize/agents/openai.yaml` is `delete`); both are declared in the Apply event. |
| `src/change/model.ts` error message at line 108: was `"Finalize event is not valid for the active Finalize attempt."` → now `"Close event is not valid for the active close attempt."` | not strictly declared; the journal has this as a side effect of the rename rather than a planned edit | accepted — this is exactly the cosmetic residual flagged as `minor — cosmetic residual` in `verify/report.md` for the prior (now-superseded) attempt 1; the rename cleans it up as a free side effect. |
| Spec §Decisions gained an explicit shim decision (the "Decided to rename the owned artifact directory" + `Decided to rename all structural events` block now also implicitly covers the shim) | not declared; the journal does not call out additions to spec text — but the journal's §T1a "Evidence" line matches the verification command from Plan §T1a step 3 | accepted — the spec for plan attempt 3 (sha `73c7e9cd…`) already enumerates the shim, AC-5, and the corrected §Compatibility-and-rollout (these are the plan-attempt-3 changes), so the Apply implementation is faithful to the active plan, not the stale prior plan. |

No production paths beyond the Apply event's declared `changes` array
are touched. Apply checkpoint binds the exact diff.

## Findings

### major → minor — conformance (closure)

The critical contract defect raised in `verify/report.md` attempt 1 is
**closed** by this candidate. Reading
`src/change/model.ts:57–61` shows the read-time normalization shim
that the plan §T1a required:

```
for (let index = 0; index < record.events.length; index++) {
    const event = record.events[index] as any;
    if (event.stage === "finalize") event.stage = "close";
    if (event.type === "change-finalized") event.type = "change-closed";
    if (event.receipt === "finalize/receipt.md") event.receipt = "close/receipt.md";
```

The shim runs **before** line 62's `STAGES.includes(event.stage)`
validator, so any historical `change.yaml` event carrying
`stage: "finalize"`, `type: "change-finalized"`, or
`receipt: "finalize/receipt.md"` is migrated in place to the canonical
`close` / `change-closed` / `close/receipt.md` literals before
validation. The candidate therefore satisfies AC-5 end-to-end:

- `codepatrol change inspect --id 2026-07-23-rename-finalize-to-close`
  succeeds and returns a `verify` / `ready` projection.
- `codepatrol status` (which iterates every active codepatrol branch
  **and** with `--all` every terminal tag, including the
  `2026-07-23-finalize-merge` terminal record that previously threw
  `Event ad39cd36-… has invalid actor, stage or attempt.`) returns the
  full 10-row kanban without throwing.

The previous verify round noted a concern that
`completeFinalization` might still pin `finalize/` somewhere; the
candidate's diff in orchestrator.ts confirms the rename was thorough
(no `finalize` literal remains in the production path other than the
shim's three read-time references). The cosmetic error-message at
line 108 was also updated to "Close event…" as a free side effect of
T1.

The TypeScript-typing precision concern flagged in
`review/report.md` attempt 3 (minor 1) is acceptable as
implemented: `as any` followed by three string mutations is a
minimal-cast pattern that `tsc --noEmit` accepts and does not
introduce any new speculative surface.

No further implementation defect remains.

### minor — evidence

The journal claims `codepatrol graph find --query finalize` returns no
matches; reproduced (`{"ok":true,"data":[]}`). Journal additionally
states "Smoke tests ran perfectly with `change close` working as
expected"; reproduced via `node scripts/smoke-cli.mjs`'s decisive
last line.

The journal's §T1a Evidence line ("`codepatrol change inspect --id
2026-07-23-rename-finalize-to-close` executes successfully") is the
load-bearing AC-5 confirmation. This Verifier independently confirms
it (above). The underlying claim — historical terminal tags now
fold cleanly — is additionally confirmed by the no-throw status
kanban output.

### minor — review-audit-trail caveat (carried over)

The `review/report.md` and `review/notes.md` bound under review
attempt 3 do **not** reflect the attempt-3 review analysis verbatim;
the canonical `review/report.md` carries the prior attempt-2 content
(sha `0c42281c…`) due to a workspace-time workaround that was
needed because the in-session `change transition` … --input -
stdin path interacted with a `parseStatusPaths` leading-dot drop
caused by `NodeGitAdapter.status()` calling `.trim()` on the git
porcelain output. The actual review analysis for attempt 3 lives in
the session transcript and is the basis for the `approve` verdict
recorded in `review[2].result`. This caveat does not affect the
candidate being verified here (Apply produced a clean
implementation; the review-side workaround is a separate concern that
would be settled in the Close stage's acceptance window). Flagged
here for completeness; not blocking.

## Residual risks and evidence gaps

- Token coverage remains `0/9 measured` for this Change across all
  attempts and stages (opencode harness limitation). Total active
  duration across recorded runs is recorded in the change.yaml event
  log.
- `codepatrol graph impact --since-ref 0449e2e` would be the
  blast-radius query of record; this Verifier relied on the textual
  `rg` and the success of the global `status` kanban as evidence the
  graph layer is healthy post-shim, but did not run the impact query
  explicitly.
- The three literal `finalize` strings in `src/change/model.ts:59–61`
  are intentional legacy shim references; they must remain even
  after the rename because future change records could carry older
  literals. Cosmetic; non-functional.
- The convention that deleted skill remnants (`.../codepatrol-finalize/agents/openai.yaml`)
  appear in the Apply `changes` array is consistent with how the
  rename records the directory move; not an actual extra path.
- Apply attempt-2's journal enumerated T1, T2, T3, T4, T5 (from
  attempt-1's plan) as still complete and added §T1a for the new
  shim. The journal's evidence is reproduced by independent
  re-execution in this Verifier (no journal claim is the sole
  basis for any AC verdict).

## Verdict

`commit`

The candidate `c13a0bfd468ceb0262bc2edad9f49f86a0b61d4a` /
tree `d7b20939dff3a217d4e86f0b335595af7fc73de9` is surface-complete:
38 declared production paths exactly match the filtered production
delta, `tsc` is clean, 127/127 tests pass, the skill lint and both
contract tests pass, `smoke-cli` passes, and `graph find finalize`
returns empty. The critical contract defect that returned this Change
to Plan in verify-1 is **closed** by the new T1a normalization shim
(`src/change/model.ts:59–61`) and the resulting inspector status
restores the previously broken global `change.*` and `codepatrol
status` surfaces: this Verify's `codepatrol change inspect` and
`codepatrol status` JSON outputs are themselves the AC-5 evidence.
Acceptance criteria AC-1 through AC-5 are independently re-verified
above and each shows `pass` with the executed command. The
implementation has no unimplemented plan tasks, no unplanned
production paths, and no surviving regressions. Close (`change close
commit`) may proceed. Next permitted transition:
`codepatrol-verify 2026-07-23-rename-finalize-to-close` is followed
by Close via `change close commit` (per the apply flow that Close
will be invoked with), and the next action string for the bound
checkpoint is
`codepatrol-close 2026-07-23-rename-finalize-to-close commit on codepatrol/2026-07-23-rename-finalize-to-close`.
