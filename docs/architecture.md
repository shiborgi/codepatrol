# CodePatrol 1.0 architecture

CodePatrol is a workflow and state orchestrator. It manages Initiatives,
Waves, Works, Spec revisions, dependencies, lifecycle attempts, results, and
the GitHub projection of that state.

## Hierarchy

Three explicit local levels:

```
Initiative (INIT-1)          why / context
    └── Wave (WAVE-1.1)      delivery and evaluation boundary
        └── Work (WORK-1.1.1)  atomic execution unit
```

Identifier grammars, all components positive integers with no leading zeros:

```
INIT-<initiative>
WAVE-<initiative>.<wave>
WORK-<initiative>.<wave>.<position>
```

A Work owns the lifecycle. A Wave groups Works into a delivery boundary and
carries an explicit evaluation verdict. An Initiative provides long-lived
context and owns no lifecycle of its own. `blockedBy` may cross Waves inside
one Initiative — a Wave is a delivery boundary, not a dependency boundary —
and never crosses Initiatives.

## Wave completion and evaluation

Completion is derived, never stored: a Wave is complete when every one of its
Works is terminal. A completed Wave may then receive exactly one verdict from
`keep`, `adjust`, `rollback` or `inconclusive`, carrying an explicit human
authority. The verdict is never inferred from the outcomes of the Wave's
Works: a Wave with two accepted Works and one rolled-back Work may
legitimately be `adjust`.

## Primary methods

CodePatrol defines six primary methods. Only primary methods may start
authoritative executions, complete them, produce lifecycle verdicts, or
mutate authoritative state.

| Method   | Scope       | Skill            |
|----------|------------|-------------------|
| spec     | initiative | codepatrol-spec   |
| plan     | work       | codepatrol-plan   |
| review   | work       | codepatrol-review |
| build    | work       | codepatrol-build  |
| verify   | work       | codepatrol-verify |
| ship     | work       | codepatrol-ship   |

```
Spec                    Initiative-scoped
Plan through Ship       Work-scoped
```

## Boundaries

```
core          pure domain: identifiers, entities, lifecycle, dependency graph, state validation
application   use cases over ports: spec apply, stage transitions, sync, state transfer
adapters      git plumbing (state ref) and GitHub REST via `gh api`
cli           argument parsing and process wiring only
```

The `core` layer has zero dependencies on Node.js APIs, filesystem, git, or
network. Application services operate on `StateStore` and port interfaces
(`CheckoutPort`, `GitHubPort`). Adapters implement those ports. The CLI
dispatches to services and formats output; only `src/cli/entry.ts` reads
`process.argv`, writes process output, or invokes `runCli`.

## State

All orchestration state lives on exactly one non-head ref:

```
refs/codepatrol/state
```

Its tree contains only:

```
.codepatrol/initiatives/INIT-<number>.json
.codepatrol/waves/WAVE-<number>.<wave>.json
.codepatrol/works/WORK-<number>.<wave>.<position>.json
```

Any other path, mode, or object type is corruption. Filenames must match the
document `id`; every Wave must reference an existing Initiative; every Work
must reference an existing Wave whose Initiative matches the Work's own; the
dependency
graph must be acyclic; run ids are unique across the whole snapshot; attempt
semantics are validated on every read (state vs. active attempts, `finishedAt`
and `result` presence, execution role, per-stage numbering, todo coverage).

### Compare-and-swap

Every state transaction is a single compare-and-swap transaction:

1. Read the ref and parse the full tree through `StateStore.readCommit`.
2. Build the candidate tree and commit via `hash-object`, `mktree`, `commit-tree`.
3. Validate the candidate commit strictly through `StateStore.readCommit` (all
   parsers, all referential integrity, reconstruction assertions).
4. `git update-ref refs/codepatrol/state <new> <old>` with the previously
   observed commit as the old value.

A rejected candidate never becomes authoritative. A no-op transaction (no
initiative or work changes) writes nothing. A successful transaction returns
the already-validated snapshot of the commit it created, never a later,
possibly foreign, snapshot. Retries re-read and re-plan on CAS failure; partial
writes are impossible. State is never committed to `main` or any `refs/heads/*`
ref.

## Lifecycle states

```
ready     no attempt is currently running; the Work waits for its next stage
active    this Work has an attempt currently running
terminal  the Work has been accepted or rolled back
```

These are derived from the attempt history, not stored independently. A Work is
active if and only if its latest attempt has `status: "active"`. The
reconstructed state (`reconstructWorkflow`) must match the persisted `workflow`
projection; any mismatch is `STATE_CORRUPT`.

Execution is exclusive to one Wave: any number of Works of that Wave may hold an
active attempt at the same time, and a Work of another Wave cannot start until
the Wave is idle. Any number of Works may be `ready`, and a blocked Work never
starves its blocker.

## Lifecycle transitions

```
Plan   -> Review
Review -> Build | Plan
Build  -> Verify | Plan
Verify -> Ship | Build | Plan
Ship   -> Accept | Rollback
```

Each attempt produces one of four decisions:

- `continue` — advance to the next stage; the Work returns to `ready`.
- `return` — return to an earlier stage; the Work returns to `ready`.
- `accept` — terminal; only valid at Ship.
- `rollback` — terminal; only valid at Ship.

Return targets are validated per stage:

| Stage  | Valid returns |
|--------|--------------|
| Plan   | (none)       |
| Review | Plan         |
| Build  | Plan         |
| Verify | Build, Plan  |
| Ship   | (none)       |

`accept` and `rollback` require an `authority` string. `continue` at Ship is
rejected.

## Runs

Every attempt has a unique `runId`. Completion requires `--run <run-id>` and is
bound to the active attempt:

- **Repeating a completion** with the same run and the same normalized result
  (canonical JSON, sorted arrays) is idempotent — a no-op.
- **Same run, different result** fails with `RESULT_CONFLICT`.
- **Old or unknown runs** are refused with `INVALID_STATE`.

### Idempotent replay

Result normalization sorts `todo` entries by id and `acceptance` entries by
index. Two results are equal iff their canonical JSON is identical. This allows
safe replay of the same completion command.

### Resume contract

Repeating `start` for the same stage when an active attempt already exists
resumes the run only when stage, harness, model, and the todo list (id and
title of every item, same count and order) match exactly. Any mismatch is
refused.

### Per-stage attempt numbering

Attempt numbers are per stage, not global. The first `plan` attempt is
`plan#1`, the second is `plan#2`, regardless of how many `review` or other
attempts occurred in between.

## Candidate validation before CAS

`StateStore.transact` builds the candidate commit, then validates it strictly
through `StateStore.readCommit` before the CAS step. `readCommit` parses every
document, checks referential integrity (every Work's initiative exists, every
blockedBy Work exists), validates the dependency graph is acyclic, ensures
unique run ids, asserts every active attempt belongs to one Wave, and confirms reconstruction
matches the persisted workflow. Only after all checks pass does the CAS proceed.
A rejected candidate never touches `refs/codepatrol/state`.

## Checkout evidence

Build, Verify, and Ship require a clean checkout at every boundary (`git status
--porcelain=v1 --untracked-files=all` must be empty). A dirty tree — modified
tracked files, staged files, untracked files, merge conflicts, or dirty
submodules — is refused without a state write. Evidence commit values are
always observed from `HEAD`; executors cannot supply them.

### Delivery

A Work has an explicit `delivery` field: `code` (default) or `no-code`. A code
Work must produce a commit different from its Build base commit; a no-code Work
may retain the same `HEAD`. Both require clean checkouts at every boundary.

### Commit pinning chain

| Boundary       | Records                        | Constraints                                      |
|---------------|--------------------------------|--------------------------------------------------|
| Build start   | `baseCommit` from observed HEAD | clean checkout required                           |
| Build complete | `candidateCommit` from observed HEAD | code work: must differ from base; no-code: may equal |
| Verify start  | `candidateCommit` pinned from latest Build continue | HEAD must equal build candidate; clean checkout  |
| Verify complete | candidate re-read; drift refused | HEAD must equal pinned candidate; clean checkout |
| Ship start    | `candidateCommit` pinned from latest Verify continue | HEAD must equal verified candidate; clean checkout |
| Ship complete (accept) | squash commit on base; `finalCommit` recorded | base moves only via the local squash; `finalCommit` must be present |
| Ship complete (rollback) | `baseCommit` and `candidateCommit` re-pinned; completion recorded | base unchanged; rejects on base drift; worktree pinned to candidate |

### Lost-response recovery

Ship integration and the state transaction are not atomic: the squash commit
may land on the base branch while the process terminates before the CAS
records `finalCommit`. When Ship Accept retries, `squashChange` searches the
base branch history for an existing integration commit identified by the
deterministic marker `codepatrol: ship <work-id> <candidate-commit>` before
performing a fresh squash:

- **Zero matches**: proceeds with the fresh squash unchanged.
- **Exactly one match** with all checks passing (reachable from base, subject
  exact match, tree identity with candidate via `^{tree}`, single parent
  equals recorded `baseCommit`): adopts the found commit as `finalCommit`
  without a second squash.
- **Two or more matches**: CONFLICT listing every SHA (ambiguous marker
  refused).
- **Match fails any check** (mismatched tree, mismatched parent): CONFLICT
  naming the found SHA and the failed check.

Adopted evidence is identical to fresh integration (`candidateCommit`,
`baseCommit`, `finalCommit`, `localIntegration`). No schema, parser, or
reconstruction changes are required.

### Base-boundary enforcement

Three checkpoints enforce the base commit boundary:

| Checkpoint                | Behavior |
|---------------------------|----------|
| Ship Start                | Compares base HEAD with the build-recorded `baseCommit`; refuses `INVALID_STATE` on drift |
| Ship Complete Accept (inside `squashChange`, after marker adoption, before `git merge --squash`) | Compares base HEAD with the recorded `baseCommit`; refuses `INVALID_STATE` on drift. Runs after `findIntegrationCommit` so lost-response adoption skips the check — the drift is explained by the integration commit itself |
| Ship Complete Rollback    | Compares base HEAD with the recorded `baseCommit`; refuses `INVALID_STATE` on drift |

No automatic rebase, merge, or conflict resolution occurs on any refusal
path. The base checkout, Change branch, and worktree are untouched.

### Change

A Change is the local delivery artifact for one code-delivery Work. Its stable
identity is `{work, baseRef, headRef}` with:

- **Branch pattern**: `codepatrol/<work-id>` on `refs/heads/codepatrol/<work-id>`
- **Worktree convention**: `<repository-parent>/.codepatrol-worktrees/<work-id>`
  (local operational data; never required by state validation or transfer)

Build records minimal Change evidence as `type: codepatrol-change` with
`baseRef`, `baseCommit`, `headRef`, and `candidateCommit`. Optional operational
fields (`worktree`, `changedPaths`, `commitCount`) are explicitly
non-authoritative and are never required for state validation or portability.

When `evidence.change` is present, its `baseCommit` and `candidateCommit` must
match the top-level evidence values, and `headRef` must match the expected ref
for the Work (`refs/heads/codepatrol/<work-id>`). Mismatch is `STATE_CORRUPT`.

### Change cleanup policy

After a Ship completes (Accept or Rollback), the CLI performs Change cleanup
per the outcome. Cleanup is a best-effort post-CAS operation: it runs strictly
after the lifecycle commit is recorded, never inside the CAS transaction, and
a failure emits a warning without failing or rewriting the recorded completion.

| Outcome             | Worktree | Local Change branch | Notes |
|---------------------|----------|---------------------|-------|
| `accepted`          | removed  | removed             | the squash commit on base preserves the candidate |
| `rolled-back`       | removed  | retained            | branch is retained for investigation; the future `refs/codepatrol/candidates/<work-id>` preservation is a later improvement |
| `failed`            | retained | retained            | manual investigation |
| `under-investigation`| retained | retained            | manual investigation |

The matrix is a pure function (`changeCleanupPolicy`) in `core/change.ts`; the
git plumbing lives in `adapters/change.ts`. Cleanup is idempotent: an absent
worktree or branch is treated as already clean. Repeated rollback is also
idempotent — the same run id with the same normalized result is a no-op; the
cleanup is re-run for convergence.

Ship Rollback also refuses if the base branch HEAD drifted from the recorded
`baseCommit` during the active ship — the operator must re-verify or rebuild.
This is a defensive check, not a rollback mechanism; the lifecycle commit is
never written on this path.

### Change recovery rules

Change branches, worktrees, and recorded evidence must agree before a Build
can proceed. The recovery rules make adoption and reconstruction explicit and
deterministic, and they make silent loss or duplication impossible.

**Inspection.** `ChangePort.inspect(workId)` returns the live state parsed
exactly from `git worktree list --porcelain`:

- `branchExists`, `branchHead`
- `worktreePath`, `worktreeExists`
- `worktrees: { path, head, branch, isBare }[]` — every porcelain entry
- `conflictingWorktreePaths: string[]` — worktrees outside the expected path
  that claim the Change branch, plus paths nested inside or over the
  expected path (prefix-collision safe)

Substring matching of worktree paths is forbidden. Every lookup uses the
parsed `worktrees` array.

**Adoption validation.** When `WorkService.startEvidence(build)` runs and
recorded Change evidence exists for the Work (`latestCompletedAttempt(work,
"build")?.evidence?.change`), adoption is allowed only if every one of the
following holds:

- If the branch exists, its HEAD equals the recorded `candidateCommit`.
- If the worktree exists, its HEAD equals the recorded `candidateCommit` and
  it is on the expected Change branch with a clean working tree.
- No worktree outside the expected path claims the Change branch, and no
  worktree is nested inside or over the expected path (no prefix collision).

Any divergence is refused with `INVALID_STATE` naming the actual and recorded
commits. Any conflict is refused with `CONFLICT` listing every conflicting
resource (the branch ref plus all conflicting worktree paths) — no automatic
selection.

**Recovery semantics.**

| Situation | Behavior |
|-----------|----------|
| Worktree missing, branch consistent with evidence | Recreate the worktree from the existing branch at the expected path |
| Recorded branch missing | `INVALID_STATE` with an explicit recovery message naming the work id and the missing ref; never recreated from base or any uncertain commit |
| Orphan branch or worktree (claims the identity, no recorded evidence) | `CONFLICT`; manual investigation required; never adopted, never overwritten |
| Duplicate identity (branch checked out at unexpected path, expected path occupied by a different identity, or multiple conflicting resources) | `CONFLICT` listing every conflicting resource |
| Diverged branch HEAD (out-of-band commit on the Change branch) | `INVALID_STATE` naming both commits; refresh by rebuilding on the current base or revert the branch to the recorded candidate |

**Base advancement policy.**

| Stage | Policy |
|-------|--------|
| Build | Continue is allowed; a rebuild adopts the consistent Change and records the newly observed `baseCommit` with no automatic rebase. The Build-complete ancestry check then refuses a candidate not reachable from the new base, so a valid candidate requires manual reconciliation during the active Build. |
| Verify | Records the observed base HEAD as `evidence.baseCommit` for code works with change evidence, in addition to the pinned `candidateCommit`. Derives the changed paths actually observed from the real candidate diff via `git diff --name-only baseCommit...candidateCommit` and records them as `evidence.changedPaths`. A mismatch with Build-reported paths causes `continue` to fail `INVALID_STATE` (return is allowed with the observed paths recorded). The relationship is observable but Verify does not refuse on base advancement. |
| Ship | Refuses strict integration until the Change is rebuilt and reverified on the current base. The Ship lookup uses `latestCompletedAttempt(work, "build")` so multi-build histories compare against the latest recorded `baseCommit`. |

These rules are exercised by the deterministic test matrix in
`src/test/change-recovery.test.ts`: adoption, missing worktree, missing
branch, diverged HEAD, duplicate identity, orphan resource, base-advanced
flow, and prefix-collision regression for work ids that share a prefix
(`WORK-1.1.1` vs `WORK-1.1.10`).

### Authoritative boundaries

- **Product repository**: code, Change branches, commits, squash results
- **`refs/codepatrol/state`**: orchestration state and Change identity evidence
- **Remote providers (GitHub, wiki)**: projections only. No projection becomes
  authoritative by being remote.

### Acceptance evidence

Verify results must address every acceptance criterion with `passed`, `failed`,
or `not-applicable` and a justification summary. `continue` requires no
failures. Indices are validated against the Work's current `acceptance` array;
every criterion must be addressed exactly once.

## Lifecycle reconstruction

`reconstructWorkflow` replays the complete attempt history from an initial
`{ready, plan}` state through every attempt using the same pure transition
functions and validation as the live code-path:

```typescript
import { reconstructWorkflow, assertReconstructionMatches } from "./core/reconstruct.js";
```

The reconstructed workflow state, stage, and completion are compared with the
persisted projections; any mismatch is `STATE_CORRUPT`. Evidence contracts are
validated during replay:

- Build must carry `baseCommit` (and `candidateCommit` if completed). A code
  Work's candidate must differ from its base.
- Verify must pin the latest Build `candidateCommit` from a `continue`.
- Ship must reference the verified candidate.
- `return` at Build or Verify clears the candidate chain.

Impossible stage histories — Review without Plan, attempt after terminal
completion, invalid return targets, acceptance on non-Verify stages,
`accept` or `rollback` on non-Ship stages — are corruption.

## Dependency revision and reblocking

`codepatrol work reblock` replaces a Work's `blockedBy` list atomically and
appends a `dependencyRevisions` entry:

```typescript
interface DependencyRevision {
  revision: number;
  previous: string[];
  next: string[];
  summary: string;
  authority: string;
  changedAt: string;
}
```

### Reblock conditions

Reblocking is permitted when:

- The Work is not terminal (`completion === null`).
- The Work has no active attempt.
- The resulting dependency graph is acyclic.
- No blocker is the Work itself.
- Every blocker exists in the repository.
- Reason must include non-empty `summary` and `authority`.

The initial Work definition has no revision entry. Revisions are sequentially
numbered. A rolled-back blocker stays blocking until explicitly reblocked.

## Projection authority

Local state is authoritative; GitHub is a projection. Stage transitions trigger
a best-effort projection whose failure is only a warning; `codepatrol sync` is
the explicit, idempotent convergence point.

### Markers

Objects are matched by hidden HTML comment markers, never by title alone:

```
Initiative -> Milestone  "INIT-1: <title>"   <!-- codepatrol:initiative:INIT-1 -->
Work       -> Issue      "WORK-1.1.1: <title>" <!-- codepatrol:work:WORK-1.1.1 -->
Attempt    -> Comment                        <!-- codepatrol:run:<run-id> -->
```

Duplicates of a managed marker are a synchronization conflict (`CONFLICT`) and
are never guessed.

### Managed sections

Issue bodies use delimited managed sections (`<!-- codepatrol:work:start -->`
/ `<!-- codepatrol:work:end -->`). Content outside the section is preserved;
reconciliation compares the exact managed content (description, acceptance
criteria, dependencies, type, priority, title). Only CodePatrol-managed labels
(`codepatrol:type/*`, `codepatrol:priority/*`) are reconciled; user labels are
preserved.

### Issue and milestone lifecycle

A terminal Work closes its Issue. An Initiative whose Works are all terminal
closes its Milestone. Associations (issue number, milestone number) are
persisted in the Work's `github` field after resolution and recovered by marker
when stale. Labels are ensured to exist with standard colors before use.

### Convergence

`codepatrol sync` converges the full projection by iterating all Works,
matching existing GitHub objects by stored number or marker, and creating or
updating as needed. Created objects receive their authoritative identity from
the create response itself. The associations are written back to state in a
final CAS transaction.

## Remote publication

Remote branches and Draft Pull Requests are projections of a Change, not
authoritative. The mapping from a local Change to its remote projection is
governed by the Wave page and is never required for local lifecycle completion.

### Remote publication status

Ship records two distinct pieces of evidence:

- **`localIntegration`** — recorded on Ship Accept for code-delivery Works.
  Contains `status: "integrated"` and the `finalCommit` (the local squash
  commit on the base branch). Computed atomically with the lifecycle commit
  inside the CAS transaction.

- **`remotePublication`** — recorded after the lifecycle commit, outside the
  CAS transaction. Never fails the lifecycle. Five statuses:

| Status          | Meaning                                                  | Recorded at |
|-----------------|----------------------------------------------------------|-------------|
| `not-requested` | Remote publication was not attempted (no remote configured, publication disabled, Work acceptance does not require it) | Ship complete |
| `pending`       | Publication was requested but not yet completed           | Ship complete |
| `pushed`        | Successfully pushed; `pushCommit` is the remote-reachable SHA | Ship complete |
| `push-denied`   | Authentication or authorization failure (HTTP 401/403)   | Ship complete |
| `failed`        | Any other publication failure (network, transient, target missing) | Ship complete |

### Local-first contract

The lifecycle works without GitHub or network access. A locally accepted Change
does not require a remote push unless the Work explicitly includes remote
publication in its acceptance criteria. When remote publication is part of
acceptance, `pushCommit` carries the remote-reachable SHA after a successful
publication.

The CLI's publish policy defaults to `never`: remote publication is not
attempted and `remotePublication` records `not-requested`. Use `--publish` to
opt in to remote publication on Ship Accept.

### Publication reconciliation

`codepatrol ship publish --work <id>` retries only the publication for an
accepted Work, updating `remotePublication` on the existing ship attempt. It
records `pending` before the push attempt and exactly one terminal status
after (`pushed`, `push-denied`, or `failed`). Idempotent when already pushed.
The command refuses unless `completion.outcome === "accepted"` and `finalCommit`
exists, and never repeats Ship Accept or the local integration — only
`git push` of the base branch is attempted.

### Deterministic fixtures

The local-first contract is exercised by:

- `scripts/local-delivery-fixture.mjs` — five code-delivery Works: (1) Accept
  with squash, changedPaths, cleanup; (2) invalidation by new commit after
  Verify + revert-to-candidate then Accept; (3) dirty worktree then Rollback
  with base unchanged and branch retained; (4) rebuild and re-verify after
  verify return, proving the final integration tree equals the new candidate;
  (5) base advancement between Ship Start and Ship Complete refused then
  retry after base restoration; (6) a Wave layer built in parallel, where the
  first sibling to ship advances the shared base and the second is refused with
  an instruction to rebuild. No network, no remote configured.
- `src/test/remote-publication.test.ts` — real-git tests for all five
  `remotePublication` statuses, pending observation, publication-only
  reconciliation via `ship publish`, and accept-stays-accepted.

## State transfer

`refs/codepatrol/state` is a custom ref that ordinary clones do not fetch.
`codepatrol state status|fetch|push` transfer it explicitly. Neither runs
automatically.

### Relations

`codepatrol state status` reports one of:

| Relation       | Meaning                                                    |
|---------------|------------------------------------------------------------|
| `equal`        | Local and remote are the same commit                        |
| `ahead`        | Remote is an ancestor of local                              |
| `behind`       | Local is an ancestor of remote                              |
| `diverged`     | Neither is an ancestor of the other                         |
| `missing-local` | Only remote has the ref                                   |
| `missing-remote` | Only local has the ref                                   |
| `unknown`      | Remote commit exists but is not locally available; ancestry cannot be determined |
| `unavailable`  | Remote could not be queried                                 |

`status` never fetches. `unknown` means both refs exist but the remote object
is absent locally — a fetch is needed to determine ancestry.

### Fetch

Fetch writes fetched state to a temporary ref (`refs/codepatrol/remotes/<name>/state`),
validates it through `readCommit`, checks fast-forward ancestry from the
current local commit, and only then CAS-updates the authoritative ref. If
ancestry check fails (diverged), no local state is modified.

### Push

Push reads and validates local state through `readCommit` first, refusing
before publishing a corrupt commit. It uses `force-with-lease` against the
observed remote commit; if the lease fails, the push is refused and local state
is untouched. Push never touches `main` or any product branch.

Remote names are validated against `^[A-Za-z0-9][A-Za-z0-9._-]*$`.

## Single-writer local lock

All mutating commands acquire a local advisory lock at startup:

```
<git-common-dir>/codepatrol.lock/
├── info.json   {"pid": <number>, "command": "<argv>", "hostname": "<host>", "acquiredAt": "<ISO>"}
```

The lock is a directory created with `mkdir` (atomic in POSIX). A live owner
blocks a concurrent process with `CONFLICT`. Stale locks are recovered by
checking PID liveness via `process.kill(pid, 0)`; EPERM (owned by another user)
is treated as alive; ESRCH is dead. Read-only commands (`list`, `show`,
`graph`, `evidence`, `spec inspect`, `spec validate`, `state status`, `--help`,
`--version`) do not acquire the lock.

The lock is process-local and repository-scoped; it cannot prevent two
independent clones from syncing simultaneously.

## Distributed GitHub sync limitation

The local lock prevents concurrent CodePatrol processes on the same repository.
It cannot prevent two independent clones from syncing simultaneously. Objects
are matched by stored number or marker lookups on the remote list. Duplicate
managed markers are a `CONFLICT` and are never resolved automatically. See
`docs/limitations.md` for the recovery procedure.

## Product evidence reachability limitation

`codepatrol work evidence <id>` reports which recorded commit hashes are
locally resolvable via `git cat-file -e`. State stored on `refs/codepatrol/state`
contains commit hashes but does not carry the product commit objects
themselves. Transferring the state ref does not transfer product history. The
operator or harness is responsible for preserving product commits through a
branch, tag, or other ref. Verify and Ship require their required candidates
to exist locally. State remains readable even when product evidence objects
are missing.

## TypeScript package surface

The public API at `src/index.ts` exports:

```typescript
// Errors
export { CodepatrolError } from "./core/errors.js";
export type { ErrorCode } from "./core/errors.js";

// Identifiers
export { isInitiativeId, isWorkId, initiativeIdOf, parseInitiativeId, parseWorkId, workPositionOf };

// Initiative types, parsers, and constructors
export { createInitiative, initiativeStatus, parseInitiative };
export type { Initiative, InitiativeStatus };

// Work types, parsers, constructors, and accessors
export { STAGES, activeAttempt, buildCandidate, createWork, normalizeResult,
         parseAttemptResult, parseStage, parseTodoList, parseWork, verifiedCandidate };
export type { AcceptanceResult, AcceptanceStatus, Attempt, AttemptEvidence,
              AttemptResult, AttemptStatus, Completion, CompletionOutcome,
              DependencyRevision, ExecutionIdentity, LocalIntegration,
              RemotePublication, RemotePublicationStatus, ResultDecision,
              Stage, TodoItem, TodoResult, Work, WorkDelivery, WorkflowState,
              WorkPriority, WorkType };

// Lifecycle pure functions
export { completeStage, expectedStage, executionContractMatches,
         startStage, validateAcceptance, validateDecision, validateTodoCoverage };

// Graph functions
export { assertAcyclic, assertBuildUnblocked, assertSingleActive, unresolvedBlockers };

// Reconstruction
export { assertReconstructionMatches, reconstructWorkflow, type ReconstructedWorkflow };

// State validation
export { validateState };

// Public package API
export { CodepatrolError, DOCUMENT_TYPE, parseDocument, runCli };
export type { AttemptResult, CliIO, ErrorCode, ImprovementReport, RunCliOptions,
              SpecDocument, Stage, TodoItem, Work, WorkDefinition };
export { initiativeIdOf, isInitiativeId, isWaveId, isWorkId,
         parseInitiativeId, parseWaveId, parseWorkId, waveIdOf };

// CLI entry
export { runCli, type CliIO, type RunCliOptions };
```

Application services (`SpecService`, `WorkService`, `SyncService`,
`StateTransferService`) and infrastructure adapters (`StateStore`,
`GitCheckout`, `GhGitHub`, `acquireLock`) are internal unless explicitly
intended for external embedding. Package import is side-effect free: only
`src/cli/entry.ts` touches `process.argv`, writes process output, or invokes
the CLI runner.

## Invariants

1. Lifecycle commands never commit product code on the base branch outside
   the explicit Ship Accept path, never push anywhere automatically, and never
   move `main` except for the single local squash commit on Ship Accept. The
   Build path creates or adopts a Change branch and a worktree locally; the
   Ship Rollback path performs no base-branch operation. After a terminal Ship,
   the CLI performs the Change cleanup per the explicit policy (see the
   Change cleanup policy section above); the cleanup is best-effort and runs
   only after the lifecycle commit is recorded.
2. The only ref ever written by lifecycle commands is `refs/codepatrol/state`,
   always via one CAS per transaction. Retries re-read and re-plan; partial
   writes are impossible.
3. Build may start only when every `blockedBy` Work is `accepted`.
4. Active attempts all belong to the same Wave, and a Work has at most one.
5. State corruption is detected and refused with `STATE_CORRUPT`, never
   silently normalized.
6. Identifiers are canonical: `INIT-<number>`, `WAVE-<initiative>.<wave>` and
   `WORK-<initiative>.<wave>.<position>` with no leading zeros. A Work belongs to exactly one Initiative; an
   Initiative document may only touch its own Works, and a Work that has
   started (attempts.length > 0 or `workflow.state !== "ready"`) can never be
   redefined.
7. Evidence commit values are always observed from `HEAD`; the `evidence` field
   in result input is rejected. Executors cannot fabricate commit evidence.
8. Parsers reject unknown fields and unknown schema versions by default. New
   optional fields may be added to an existing schema without a version bump
   when the additive optional-field rules in `docs/schema-evolution.md` are
   followed. A schema version bump is mandatory for breaking changes; a single
   manual migration script is the only supported migration.
9. Run ids are unique across every Work and attempt in the entire snapshot.
10. The reconstructed history must always match the persisted workflow
     projections.

## Loops

### Delivery loop

The six primary methods form the delivery loop: **Spec → Plan → Review → Build
→ Verify → Ship**. Spec defines an Initiative with its Works. Plan through Ship
execute Work by Work, advancing (continue), returning (return), or terminating
(accept/rollback). Build, Verify, and Ship pin the observed `HEAD` as evidence.

### Evolution loop

The evolution loop uses the Spec skill in Evolution Review mode and the
`improve inspect` command to discover and propose improvements from
deterministic evidence:

1. **Observe** — `codepatrol improve inspect` derives a deterministic report
   from the current state.
2. **Derive evidence** — the report provides return counts, repeated attempts,
   duration statistics, and work counts.
3. **Explicit Evolution Review** — triggered by the operator via keywords
   (framework evolution, backlog review, self-improvement, roadmap discovery).
   Runs the 12-step procedure defined in `skills/codepatrol-spec/SKILL.md`.
4. **Propose** — at most one Initiative, with hypothesis, smallest testable
   change, expected measure, and explicit uncertainty.
5. **Human approval** — every Initiative is a human decision. No Initiative
   is created automatically.
6. **Deliver** — the proposed Initiative enters the delivery loop.
7. **Evaluate** — the delivered change is evaluated via the improvement report
   and recorded as a judgment in `docs/evaluations/`.

Evolution Review is **not a separate primary method**. It is a mode of the Spec
skill. Spec remains the only initiative-scoped method.

## Non-goals

Automatic commits outside the Ship Accept squash, automatic pushes, pull
request creation, automatic rebase, automatic merge, creating a GitHub Project,
attempts active in more than one Wave at a time, archive refs, change refresh, telemetry, automatic
skill editing, autonomous self-improvement or automatic Initiative creation,
state schema migrations, and Windows support. The Change branch and worktree are
created by the Build path and removed by the post-CAS cleanup on Ship Accept
or Rollback; they are not "automatic branches" in a product sense — they are
local operational artifacts that the lifecycle owns while a Work is active.

## Layout

```
src/
  index.ts              public API, no side effects

  cli/
    args.ts             argument parser
    surface.ts          the command surface as data; the help text is rendered from it
    run-cli.ts          dispatch and the repository lock, nothing else
    context.ts          wiring: services, GitHub resolution, best-effort projection
    render.ts           output formatting, with no service or adapter dependency
    commands/           one module per command group (inspect, spec, stage, remote)
    entry.ts            the only process-aware module (process.argv, process.exit)

  core/
    errors.ts           CodepatrolError, ErrorCode, fail()
    identifiers.ts      INIT-<number>, WAVE-<i>.<w>, WORK-<i>.<w>.<p> parsing and derivation
    json.ts             canonical and pretty JSON serialization
    initiative.ts       Initiative entity, parseInitiative, initiativeStatus
    work.ts             Work entity with all sub-types (Attempt, Execution, Todo, Acceptance,
                        Completion, DependencyRevision), parseWork, createWork, accessors
    lifecycle.ts        startStage, completeStage, todo/acceptance/decision validation
    graph.ts            acyclic check, unresolved blockers, build unblocking, wave-scoped concurrency
    wave-execution.ts   dependency layers of a Wave, current layer, canonical Work ordering
    reconstruct.ts      reconstructWorkflow, assertReconstructionMatches, evidence validation
    validate.ts         validateState (referential integrity, reconstruction, unique run ids)

  application/
    ports.ts            GitHubPort interface (milestones, issues, comments, labels)
    spec-service.ts     SpecDocument parsing, validation, apply
    work-service.ts     WorkService: start and complete, per Work and per Wave, in one transaction
    attempt-evidence.ts what an attempt observes: checkout, Change, candidates, local squash
    sync-service.ts     SyncService: the five GitHub projections and project preparation
    sync/render.ts      markers, titles, labels and managed sections of projected bodies
    publication.ts      remote publication policy and its recorded outcome
    state-transfer.ts   StateTransferService: status, fetch (ff-only), push (force-with-lease)

  adapters/
    git.ts              localGit(): spawns `git` child processes, neutral env
    state-store.ts      StateStore: read, readCommit, transact with CAS and retry
    checkout.ts         GitCheckout: observe HEAD commit and tree cleanliness
    lock.ts             acquireLock: directory-based advisory lock with PID stale recovery
    gh.ts               GhGitHub: GitHub REST and Projects v2 adapter via `gh api`
    config.ts           optional codepatrol.json reading (github.project)
    harness-templates.ts renders the eighteen harness command files from one source

  test/
    support/            repo.ts (temp git repos), app.ts (test harness), github.ts (fake GitHub)
    *.test.ts           one file per subject: lifecycle and state, Change and Ship scenarios,
                        wave execution, projection and sync, contracts and documentation,
                        published API and package contents
```


## GitHub projection

The local state is authoritative at all times. GitHub is a projection and is
never required for, nor able to invalidate, a local operation.

| Local | GitHub | Purpose |
|---|---|---|
| Initiative | Wiki page | long-lived context |
| Wave | Milestone | delivery and evaluation boundary |
| Work | Issue | atomic execution unit |
| Attempt | Issue comment | execution history |
| Work type / priority | Labels | classification |
| Work completion | Issue open/closed | lifecycle |

Deterministic markers make reconciliation independent of display titles:

```
<!-- codepatrol:initiative:INIT-1 -->
<!-- codepatrol:wave:WAVE-1.1 -->
<!-- codepatrol:work:WORK-1.1.1 -->
<!-- codepatrol:run:<run-id> -->
```

Content outside the managed markers is preserved on Issue bodies, milestone
bodies and wiki pages. `codepatrol sync` reconciles every surface; local state
always wins, and a manual remote edit is corrected rather than absorbed.

### Ordering

The projection always runs strictly after the local transaction:

```
local validation -> local transaction -> best-effort GitHub projection
```

A projection failure writes a structured warning and leaves the local
transaction intact; a later `codepatrol sync` converges it.

### Derived Status and Next Step

`projectStatusOf(work)` and `projectNextStepOf(work)` (in `src/core/projection.ts`)
derive the two values a GitHub Project board would display. `Status` is the
stage that actually started or is running — it deliberately does **not** mirror
`work.workflow.stage`, which already points at the next expected stage once a
stage completes. Completing Plan with `continue` yields `Status = Plan` and
`Next Step = Review`; `Status` becomes `Review` only when Review actually
starts. These functions are pure and carry no GitHub dependency; `codepatrol sync`
writes their values onto the configured Project's `Status` and `Next Step`
single-select fields, and `codepatrol project prepare` reports whether that
Project can receive them.
