# Architecture

CodePatrol has four runtime boundaries:

```text
CLI -> optional agent resolver process
    -> lifecycle service -> Git repository
                         -> explicit GitHub adapter
```

## Domain

An Init starts with an open Spec round. Approved Spec materializes Waves and
Works. Each Wave owns Plan and Build rounds. A round accepts concurrent producer
tasks until Review seals it. Review either selects one proposal or returns the
round. Tasks, proposals, selections, and terminal decisions are explicit state.

## Persistence

`refs/codepatrol/v1/state` contains `state.json` and the latest `event.json`.
Commit ancestry is the audit history; the current snapshot remains directly
inspectable. Every prospective state is schema-validated before a CAS update.
Locks use the Git common directory and exist only for short transitions.

## Candidates

A Build task receives an external worktree. Submission requires a clean worktree
and creates one canonical commit from its final tree and fixed base. The commit is
anchored under `refs/codepatrol/v1/candidates/<wave>/<proposal>`. Review runs the
configured command in a fresh detached worktree, with bounded output and timeout.

## Review Protocol and Scorecards

Every newly opened review persists a complete anonymized review protocol snapshot:
the exact operation rubric (`spec-v1`, `plan-v1`, or `build-v1`) with its category
weights, the operation-specific dimensions and their weights, the shared anchors
`[0,25,50,75,100]`, deterministic `C01..` labels assigned by lexical `proposalId`,
a separate audit-provenance map, and a sorted host-addressable evidence catalog.
Mixed-profile envelopes also expose profiles and artifacts in lexical order. The
envelope exposes anonymized candidates first. Category and dimension quality is
advisory to objective verification and acceptance gates; `contextComparison`
remains a separate advisory dimension outside rubric totals.

Protocol-bearing reviews require either the historical `scorecard` shape with
`rubricVersion` and one `assessments` entry per category, or the explicit stage
shape with the review operation and one `dimensions` entry per stage dimension,
each exactly once in declared order. All candidates in one review use one shape.
Stage dimensions have integer levels from 0 through 100, nonempty rationales, and
nonempty sorted, unique evidence references from the task's frozen evidence
catalog. The host derives the integer total from declared weights. Candidates sort
by effective passed before failed, total descending, dimension levels
lexicographically descending in declared order, profile lexical ascending, then
`proposalId` lexical ascending; the rank and the first comparator that resolved
each tie are persisted in an immutable review outcome.
Approval must select the rank-one effective passing candidate, and effective
passing status is distinct from objective Build verification and selected-candidate
acceptance. Historical review tasks without a persisted protocol retain the legacy
optional score path with no fabricated scorecard, rubric, total, rank, or outcome.

Ship Accept requires a clean checked-out base branch, pre-applies the reviewed
tree, and updates the base ref, state ref, and selected candidate ref in one Git
reference transaction. Rollback atomically updates state and removes the selected
candidate without moving the base branch.

## Failure Boundaries

Malformed results do not mutate state. Executor failures are explicit task
outcomes. Verification process/setup failures block and retry the same Review.
Nonzero verification is evidence against one candidate, not an infrastructure
failure. Acceptance is evaluated independently.

## Optional Integrations

GitHub synchronization runs only through `remote sync` after local publication.
It reconciles stable markers and is never lifecycle authority.

Agent catalog resolution is optional and out-of-process. The configured `argv` is
the complete command and is invoked directly without a shell or appended arguments.
One strict versioned request is written to stdin and one strict versioned response
is read from stdout. CodePatrol validates exact identity, SHA-256 plugin and
instruction digests, response and instruction bounds, and timeout before any state
mutation, Build worktree creation, or Build Review verification. There is no
package dependency, sibling discovery, network lookup, or knowledge of catalog
storage. Typed resolver failures do not fall back.

Resolved identity and digests become proposal provenance. Full instructions are
stored only on the task and conditionally exposed at the task envelope's top level.
Show, Submit, and Retry use that snapshot and never re-resolve. Ship Show resolves
read-only on every invocation when explicitly requested or defaulted; Accept and
Rollback remain human-only. Catalog instructions are advisory and cannot change
inputs, result schemas, contracts, verification, review, or Ship gates.

Context provider resolution is separately optional and out-of-process. A selected
profile produces a bounded code-analysis report from a neutral query before task
publication. The complete report is an immutable task snapshot exposed only at
the envelope boundary; task lists and historical reviews keep the report out of
nested data. A proposal may record the profile name as `contextProfile` provenance
without embedding the report. Context is advisory and cannot grant authority or
alter lifecycle contracts, verification, review, or Ship gates.

## Module Map

Each module has one primary responsibility. Dependencies point inward toward
contracts and infrastructure; modules must not import CLI handlers from domain
or persistence code.

| Module | Responsibility | Allowed dependencies |
| --- | --- | --- |
| `agent-protocol.ts` | Agent reference and version predicates | None |
| `agent-catalog.ts` | Agent catalog adapter and identity/digest checks | `config`, `core`, `errors`, `resolver-rpc`, `run-context`, `shared` |
| `context-provider.ts` | ContextPatrol profile adapter and snapshot checks | `config`, `errors`, `resolver-rpc`, `run-context`, `shared` |
| `resolver-rpc.ts` | Shared JSON resolver response parsing and schema validation | `errors`, `process-rpc` |
| `process-rpc.ts` | Bounded child-process execution | Node platform APIs |
| `schemas.ts` | Zod contracts and inferred domain types | `agent-protocol`, `shared` |
| `core.ts` | State construction, IDs, and round helpers | `schemas` |
| `service.ts` | Lifecycle orchestration facade | Domain modules, `git`, `verification` |
| `service/results.ts` | Producer and review result parsing | `errors`, `schemas` |
| `service/review.ts` | Review selection, sealing, and Spec materialization | `core`, `errors`, `selectors`, `service/results`, `validators` |
| `scorecards.ts` | Immutable rubric constants, review protocol, scorecard validation, and deterministic ranking | `core`, `errors`, `selectors` |
| `validators.ts` | Contract and acceptance validation | `core`, `errors`, `selectors`, `service/results` |
| `selectors.ts` | State lookup helpers | `core`, `errors` |
| `git.ts` | Git state, refs, worktrees, and locks | `command`, `core`, `errors`, `run-context` |
| `verification.ts` | Candidate verification in disposable worktrees | `command`, `git`, `run-context` |
| `command.ts` | Safe subprocess command execution and diagnostics | Node platform APIs |
| `config.ts` | Repository configuration loading and validation | `errors`, `shared` |
| `setup.ts` | Initial and updated repository configuration | `config`, `git`, `errors` |
| `remote.ts` | GitHub synchronization adapter | `config`, `git`, `run-context` |
| `ship.ts` | Ship recovery and transition support | `core`, `git`, `errors` |
| `run-context.ts` | Clock, environment, IO, and logging seams | Node platform APIs |
| `shared.ts` | Digests, stable JSON, and shared limits | Node platform APIs |
| `envelope.ts` | Task envelope projection | `core` |
| `sync-hooks.ts` | Lifecycle commentary and remote hook selection | `commentary`, `remote`, `core` |
| `commentary.ts` | Deterministic lifecycle comments | `core` |
| `errors.ts` | Typed lifecycle error codes and formatting | None |
| `version.ts` | Package version constant | None |
| `cli.ts` | Command registry, global flags, routing, and usage | `cli-handlers`, `service`, `setup`, `remote` |
| `cli-handlers.ts` | Per-command operation handlers | `cli`, `service`, provider adapters |
