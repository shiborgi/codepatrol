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
the envelope boundary; task lists, proposals, and historical reviews keep it out
of nested data. Context is advisory and cannot grant authority or alter lifecycle
contracts, verification, review, or Ship gates.
