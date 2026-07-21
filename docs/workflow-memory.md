# Workflow memory

Codepatrol stores operational memory in `.codepatrol/workflows/ledger.json`. This is a native Codepatrol schema. It does not require or mirror an external issue tracker.

Human-readable artifacts remain authoritative for project decisions and deliverables. The ledger answers: what is the objective, what was decided, what is blocked, what can run now, who claimed it, what evidence exists, and where should an interrupted harness resume?

## Ledger and item contract

The ledger is one atomically written document:

```json
{
  "version": 1,
  "updatedAt": "2026-07-18T20:00:00.000Z",
  "items": {}
}
```

Every `WorkflowItemV1` contains:

```json
{
  "schemaVersion": 1,
  "id": "cpw-0123456789ab",
  "workflowId": "cpw-fedcba987654",
  "kind": "task",
  "scope": "workflow",
  "title": "Implement the ledger",
  "summary": "",
  "nextAction": "Write the failing persistence test.",
  "status": "open",
  "priority": 2,
  "relations": [],
  "acceptance": ["workflow tests pass"],
  "artifacts": ["src/workflow/service.ts"],
  "createdAt": "2026-07-18T20:00:00.000Z",
  "updatedAt": "2026-07-18T20:00:00.000Z"
}
```

Kinds are `workflow`, `task`, `decision`, `evidence`, and `memory`. Scopes are `workflow` and `project`. Priority ranges from 0 (highest) to 4.

Statuses are:

- `open`: eligible when actionable and unblocked;
- `in-progress`: acquired only through `workflow claim`;
- `blocked`: waiting on an internal condition not represented by a dependency;
- `waiting-user`: waiting on a user decision or authority;
- `deferred`: intentionally outside the current frontier;
- `closed`: terminal, with a result recorded by `workflow close`.

A deliberate limit from an approved package may be mirrored as a `deferred` task when that improves later discovery. Its summary references the authoritative `DC-N` in `spec.md` and records the known ceiling, observable trigger, and upgrade path. It becomes open work only after evidence establishes that trigger; the ledger never replaces or silently changes the package decision.

`workflow update` cannot bypass `claim` or `close`. Closed items cannot be reopened or edited.

## Hierarchy and relations

`parentId` creates workflow/task/subtask hierarchy and must remain inside one workflow. Parent cycles are rejected.

Relations are:

- `blocks`: the source item blocks the target item;
- `relates-to`: relevant but non-ordering context;
- `duplicates`: the source duplicates the target;
- `supersedes`: the source replaces the target's conclusion;
- `replies-to`: the source responds to the target.

`blocks` stays within a workflow and must form a DAG. An open task or decision is ready when no non-closed item has a `blocks` relation targeting it and its workflow root is open.

## Creating and executing work

Create a workflow root:

```json
{"kind":"workflow","title":"Propose offline search","summary":"Produce an approved architecture and plan."}
```

Create a task using the returned root ID:

```json
{
  "kind": "task",
  "workflowId": "cpw-root",
  "title": "Compare index designs",
  "nextAction": "Read the target constraints.",
  "acceptance": ["two native alternatives have verified trade-offs"]
}
```

To make an earlier item block this task, update the earlier item:

```json
{"relations":[{"type":"blocks","targetId":"cpw-task"}]}
```

Query `workflow ready`, claim one returned ID, implement within its scope, and close it with a result:

```json
{
  "summary": "Compared two designs and selected the segment-based index.",
  "artifacts": ["docs/codepatrol/2026-07-18-search/spec.md"]
}
```

Claims are atomic. A competing actor receives `WORKFLOW_CONFLICT` and must select another ready item.

## Durable memory and resume

`workflow remember` accepts a memory payload:

```json
{
  "workflowId": "cpw-root",
  "scope": "project",
  "title": "Reference-project policy",
  "summary": "External projects supply concepts for this target project, never automatic integrations.",
  "artifacts": ["docs/codepatrol/2026-07-18-memory/evidence/reference-concepts.md"]
}
```

Use project scope only for knowledge that should appear when other workflows resume. Keep detailed reasoning in the referenced artifact.

`workflow prime` selects the requested workflow, or the most recently updated active workflow when no ID is given. Its token budget is converted to a bounded context containing the objective, project memories, decisions, active/ready/blocked work, recent results, artifacts, and next actions.

Record memory after meaningful events rather than fixed phases: settled decisions, confirmed or rejected hypotheses, blockers, produced artifacts, verification results, interruptions, and safe next actions. A different harness may receive only `docs/codepatrol/<work-id>/`, so the ledger cannot contain a decision required to understand the specification or plan. Never store secrets, raw conversations, large logs, or full delegated-worker output.

## Compaction and recovery

`workflow compact` considers closed tasks and evidence older than 30 days. Before shortening their active representation, it writes the original item to `.codepatrol/workflows/archive/<id>.json`. It preserves identity, relations, result summary, artifacts, timestamps, and the archive reference. Workflow roots, decisions, memories, open work, and blockers are never compacted.

The ledger uses the workspace `workflow` lock and atomic rename. A dead local lock owner is reclaimed by the shared lock implementation. Invalid JSON, unsupported versions, and structurally corrupt items fail explicitly; commands do not continue from guessed memory.
