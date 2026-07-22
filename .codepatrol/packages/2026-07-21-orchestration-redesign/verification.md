# Verification — Orchestration redesign, attempt 2

- Package: `2026-07-21-orchestration-redesign`
- Verified revision: 1
- Verifier: codex (model gpt-5)
- Base ref: `165a8c99cf5f50281605b68846bfef7d8dd04810`
- Head ref: current `v1-release` candidate working tree
- Evidence date: `2026-07-22T15:40:38Z`
- Verdict: `improve`

## Scope and instruments

This is the schema-v1 bootstrap verification assigned to T10. The delivered v2
CLI correctly returns `CHANGE_NOT_FOUND` for this historical package, so the
explicit exception in the governing spec was followed: `handoff.yaml`, its
SHA-256 declarations, Git topology and the complete diff from the recorded base
were validated directly. All incoming hashes matched, approval still applies to
revision 1, status was `implemented`, and `HEAD` remained the recorded base.

The complete spec, plan, review, implementation journal, prior verification and
architecture evidence were read. Verify changed no production file, ref,
commit, branch, target, installation or wiki bundle. Adversarial lifecycle
checks used isolated temporary repositories only.

## Plan conformance

T1 through T9 remain represented in the diff. The six findings from Verify
attempt 1 were rechecked: concurrent starts serialize; loser cleanup is
ownership-aware; Create/Modify/Delete baselines are wired; non-current refs and
copy conflicts validate; Pi records one measured-or-unavailable run including
Finalize; post-Verify path drift is rejected; and the obsolete worktree/ref no
longer exists.

The actual worktree has 111 changed or untracked paths: 77 tracked diff entries
and 34 untracked files. Fourteen product paths are not individually enumerated
in the task file lists: `scripts/clean-dist.mjs`,
`skills/_shared/EXECUTION.md`, five supporting-skill files, six graph/wiki/shared
source or test files, and `src/shared/errors.ts`. They are the same journaled
build, runtime-path and contract propagation accepted by attempt 1. The nine
attempt-2 correction paths are all inside declared T4/T8/T9 surfaces. No new
dependency, service, command or configuration surface appeared.

The current implementation does not yet satisfy the deeper invariant behind
T4: Finalize trusts checkpoint fields from the current mutable Change record.
It also does not satisfy the complete T2/T3 event and metric contract, because
closed/returned attempts and measured envelopes are not fully constrained.

## Acceptance re-verification

| Criterion | Command or inspection | Result | Independent of journal |
|---|---|---|---|
| AC-1 | focused Change/Git suite, including serialized start and ownership cleanup | pass | yes |
| AC-2 | event-order probe plus `src/change/model.ts:74-91` | fail: usage may be appended to a closed or terminal attempt | yes |
| AC-3 | baseline/ref tests and `src/change/orchestrator.ts:193-209` | partial: live/ref baseline tests pass, but declaration completeness is not enforced across prior commits | yes |
| AC-4 | session/runtime tests and topology inspection | pass | yes |
| AC-5 | candidate-binding probe and `src/change/orchestrator.ts:126-131` | fail: current record fields can rebind the candidate | yes |
| AC-6 | compiled usage probe and `src/change/usage.ts:21-48` | fail: zero-run returns and incomplete measured envelopes are accepted | yes |
| AC-7 | fixed-time cross-timezone rendering | pass: byte-identical empty bootstrap board | yes |
| AC-8 | commit fixtures plus candidate-binding probe | fail: exact verified-candidate integrity is bypassable | yes |
| AC-9 | rollback fixture | pass: target tree, tag-before-delete and clean recovery hold | yes |
| AC-10 | drift/concurrency/ref/cancellation tests plus candidate-binding probe | fail: governing-record drift is not anchored to immutable history | yes |
| AC-11 | full gate, installer and package checks | partial: distribution is aligned, but the core metric/event contract is not | yes |
| AC-12 | rollout inspection | blocked: independent verification is not green | yes |

## Wider suite

- Focused T10 command:
  `node --test --import jiti/register src/change/change.test.ts src/change/git.test.ts src/change/board.test.ts src/cli/cli.test.ts .pi/index.test.ts scripts/render-kanban.test.mjs scripts/install-lib.test.mjs scripts/skills-contract.test.mjs scripts/package-contract.test.mjs`
  — pass, 65/65.
- `npm run verify` — pass: typecheck, 122/122 tests, clean build, compiled CLI
  smoke and skill lint.
- `npm pack --cache /tmp/codepatrol-npm-cache-verify-2 --dry-run --json` — pass,
  212 entries; Change, Finalize and Kanban are present and compiled v1
  artifact/workflow/status modules are absent.
- `node scripts/install-local.mjs --harness all --dry-run` — pass; Finalize is
  the expected new link and Pi is the expected package refresh.
- `npm run kanban` — pass; the bootstrap board is empty and valid.
- `git diff --check` — pass.

The green suites do not cover the failing record-integrity and malformed-metric
cases below.

## Blast radius

`graph sync` passed with 59 files, 1 extracted, 58 unchanged and 1,512 symbols.
`graph impact --since-ref 165a8c99cf5f50281605b68846bfef7d8dd04810`
reported 15 affected tests and no possibly-affected entries. Every listed test
ran in the 122-test full gate. The impacted seams are Change orchestration,
usage/board, CLI, install, graph, shared lock/workspace and wiki; none is absent
from the executed suite.

`wiki status` passed with the wiki intentionally absent, graph present and no
rewrite required. No wiki content was generated.

## Regressions

- Existing post-Verify path-drift regression now rejects ordinary candidate
  drift.
- Concurrent start, foreign-winner cleanup, immutable baseline, ref artifact
  validation, copy conflict and terminal recovery regressions pass.
- Pi tests prove one idempotent Finalize run and explicit unavailable coverage.
- Kanban Markdown output at a fixed `--as-of` is byte-identical under UTC and
  Pacific/Auckland.
- One worktree remains, on `v1-release`; no `codepatrol/*` branch or terminal
  tag exists in the real repository.

## Unplanned changes

| Path group | Declared in spec/plan | Disposition |
|---|---|---|
| Change, CLI, lifecycle skills, Finalize, Kanban, docs and v1 deletions | yes | accepted |
| Attempt-2 corrections in Pi, README and Change/Git implementation/tests | yes, within T4/T8/T9 | accepted |
| Fourteen build/support/graph/wiki/shared propagation paths | not individually listed | accepted as journaled T6-T9 support delta |
| Governing schema-v1 package | explicit T10 bootstrap exception | retained until authorized cutover |

## Findings

### critical — acceptance — candidate binding is derived from mutable record fields

`src/change/orchestrator.ts:126-131` obtains the accepted Verify checkpoint and
tree from the currently loaded record, then permits `change.yaml` itself to
differ after Verify. `src/change/orchestrator.ts:262-315` does not independently
prove that this event is the append-only successor of the immutable record at
that checkpoint. An isolated lifecycle probe changed only that binding and
showed that later candidate content could be accepted by Finalize while the
target remained clean.

Required correction: validate checkpoint/event lineage against immutable Git
history, including the exact record prefix at every checkpoint, before trusting
the current event fields. Add a regression where checkpoint fields differ from
the immutable accepted record and prove that no target ref, tag, receipt or
branch is changed.

### major — acceptance — run ordering and return coverage are not enforced

`src/change/model.ts:74-78` accepts a `run-recorded` event for any known
non-invalidated attempt without requiring it to be the current active attempt.
`src/change/model.ts:85-91` permits a return without a finished run, and
`src/change/fixtures/returned-change.yaml:13-14` codifies a zero-run Review as
valid. The probe accepted an additional run after terminal completion. This
violates append-only stage ownership and makes per-attempt time/token coverage
incomplete without saying so.

Required correction: accept usage only for the current active attempt; require
at least one finished run before return as well as checkpoint/finalization; and
add returned, late-stage and post-terminal rejection fixtures.

### major — acceptance — incomplete measured usage is reported as complete

`src/change/usage.ts:21-24` validates numeric fields only when they happen to be
present. `src/change/usage.ts:40-48` then adds required but absent input, output
and total values. The compiled-module probe accepted such an envelope and
projected null numeric totals with coverage `1/1` and `complete: true`.

Required correction: require `input`, `output` and authoritative `total` as
non-negative safe integers for every measured envelope; validate optional
dimensions when present; reject non-finite/overflowed aggregates; add a
red-capable malformed-envelope test through the public transition interface.

### major — conformance — checkpoint declarations ignore already committed delta

`src/change/orchestrator.ts:193-209` checks only current worktree status before
creating a checkpoint. Production or artifact paths already committed after the
prior accepted checkpoint are not reconciled against `intent.changes` and the
artifact declarations. Required artifacts are checked by path membership, so a
delete binding can also satisfy the membership test on a retry.

Required correction: compare the complete Git delta from the prior accepted
checkpoint to the candidate checkpoint, require every production path to match
Apply `changes`, require stage-owned bindings to explain the artifact delta,
and require mandatory spec/plan/report/journal files to exist as regular files
at acceptance. Cover precommitted undeclared paths and deleted required
artifacts in temporary repositories.

## Residual risks and evidence gaps

- Exact provider tokens and active elapsed time for this schema-v1 Verify
  session are unavailable; they were not estimated.
- The bootstrap candidate is an uncommitted `v1-release` working tree by
  explicit design, so there is no honest Verify checkpoint SHA to publish.
- The long isolated candidate-integrity probe is summarized rather than copied
  verbatim into this report; its decisive result and required regression are
  recorded without storing raw execution logs.
- DC-1 did not trigger: no remote-only Change was used.
- DC-2 did not trigger: the target remained at its recorded base; existing
  target-advanced fixtures pass.
- DC-3 triggered and the Pi collector upgrade is present, but the portable
  validator/ordering defects above still prevent trustworthy coverage.

## Simplicity assessment

The architecture remains the earliest sufficient design and adds no unjustified
dependency, store, service, scheduler or configuration. The prior corrections
correctly reuse the existing lock, Git adapter and event fold. No surface can be
removed without weakening the accepted contract. The required fixes should
deepen those same seams: immutable record-lineage validation in the existing
orchestrator and stricter event/usage invariants in the existing fold/validator.

Assessment conclusion: `fix-first`.

## Verdict

`improve`

The six findings from attempt 1 are corrected, but the candidate is not safe to
Finalize because the governing Verify binding is not anchored independently of
the mutable record. Metrics and checkpoint declarations also accept invalid
states. Keep revision 1 and its approval, return to Apply with:

```text
codepatrol-apply 2026-07-21-orchestration-redesign
```

Apply must add the four bounded regression groups above, correct the existing
orchestration/fold/usage seams, run the focused and full gates, and update the
implementation journal. Do not commit, merge, Finalize, cut over, delete the v1
package or alter real refs before another independent Verify.


## Attempt 3 — 2026-07-22T18:33:31.273Z

**Verdict: commit**

**Reviewed revision:** 1

### Scope and handoff integrity

The package was re-opened from its durable artifacts because the redesigned v2 workflow memory intentionally cannot import this bootstrap v1 record. The recorded artifact hashes match, the approval still targets revision 1, the package entered verification as implemented, and the inspected branch is `v1-release` at the expected lineage.

### Findings

- Contract: no blocking finding. The implementation satisfies the approved lifecycle, branch-per-plan, deterministic board, usage accounting, checkpoint, and Finalize contracts.
- Code: no blocking finding. Immutable checkpoint replay, ancestry checks, active-attempt restrictions, safe measured counters, and exact checkpoint delta reconciliation close the four findings from attempt 2.
- Simplicity: no blocking finding. The correction deepens the existing model, Git adapter, and orchestrator seams without adding a dependency, service, store, configuration layer, or public command.
- Verification: no blocking finding. Adversarial regressions cover mutable candidate bindings, post-terminal run mutation, returns without finished runs, incomplete/unsafe metrics, precommitted undeclared production changes, and deletion of required artifacts.
- Artifact drift: none. Governing artifact hashes and the implementation journal are internally consistent; verification made no production-code changes.

### Evidence

- `npm run verify`: passed, including 127 tests, typecheck, build, lint, package/skill contracts, and smoke coverage.
- Focused orchestration/contract selection: 70 tests passed.
- Deterministic Kanban tests passed under both `TZ=UTC` and `TZ=Pacific/Auckland`.
- Graph sync/impact, wiki status, all-harness installer dry-run, package dry-run, and `git diff --check`: passed.
- The actual surface delta remains aligned with the approved package; no unplanned dependency or public-surface expansion was found.

### Metrics

Exact model-token and end-to-end elapsed-time counters are unavailable for this bootstrap v1 execution and were not estimated. The redesigned workflow now requires and aggregates those counters for measured v2 runs.

### Delivery decision

The package is safe to finalize through the new explicit Finalize operation. This verdict authorizes a commit/finalization step; it does not itself create a commit, tag, merge, rollback, or branch change.
