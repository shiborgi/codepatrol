# Patrol Protocol 1.0

The Patrol packages are independently distributable Node.js 22.13+ tools. No package
imports source files from a sibling checkout. Provider commands are
explicit argument arrays, executed without a shell. Each invocation reads one
JSON object from stdin and writes one JSON object to stdout. Diagnostics go to
stderr; invalid input or provider failure exits nonzero. Consumers reject any
`protocolVersion` other than `1.0`, validate responses, and bound time and bytes.

## Ownership

| Package | Owns | Does not own |
| --- | --- | --- |
| AgentPatrol | Personas, specialist profiles, reusable skills, portable plugins | Task state, model execution, approval |
| ContextPatrol | Read-only snapshots, dependency graphs, impact, context budgets | Agents, workflow stages, deployment |
| MemoryPatrol | Local persistent insights, graph links, bounded recall | Workflow authority, repository analysis, model execution |
| CodePatrol | Routing, execution adapters, workflow gates, durable runs, telemetry | Provider internals, invented execution evidence |
| ModelPatrol | HTTP model gateway, model routing, token/cost observability | Workflow approval, personas, repository analysis |

## Agent Catalog

Command: `agentpatrol catalog`, input: `{"protocolVersion":"1.0"}`.

```json
{
  "protocolVersion": "1.0",
  "catalogVersion": "1.0.0",
  "contentDigest": "<lowercase SHA-256 of the full active catalog content>",
  "personas": [{
    "id": "developer",
    "description": "Implement and verify changes",
    "stages": ["build"],
    "skills": ["implement-change"]
  }],
  "profiles": [{
    "id": "react",
    "description": "React applications",
    "signals": ["react", "tsx", "jsx"],
    "skills": ["react-development"]
  }]
}
```

Required personas include `architect` (spec, plan), `developer` (build), `qa`
(spec-review, plan-review, build-review) and `release` (ship). Profiles include
`general`, `react`, `python`, and `mcp`. Specialist profiles are orthogonal to
personas and can be combined. IDs and skill references are unique and validated.

Command: `agentpatrol resolve`.

```json
{"protocolVersion":"1.0","persona":"developer","profiles":["react"]}
```

The required `contentDigest` fingerprints all active persona/profile descriptors,
complete instructions and skill files (including reference and asset bytes), not
only the discovery metadata. Changing content without changing IDs or package
version still invalidates routing history. AgentPatrol hashes a canonical object
containing `catalogVersion`, sorted `personas` and `profiles` with instructions,
and `skills` keyed by ID, each containing relative filenames and base64 bytes.

Response: `protocolVersion`, `catalogVersion`, `catalogDigest` (the full catalog
`contentDigest` from the same loaded snapshot), `persona` (ID), `profiles` (IDs,
possibly empty for a persona-only resolution),
`skills` (objects with `id` and `instructions`), `instructions` (composed text),
and `digest` (lowercase SHA-256 hex). Composition is persona, sorted unique
profiles, then deduplicated skills; digest covers the entire resolved payload
except the digest field, using recursively key-sorted JSON, UTF-8, no whitespace.
Consumers reject resolution whose `catalogDigest` differs from discovery.

Portable artifacts use Agent Plugins **1.0.0** (the external format version is
not Patrol's protocol version): root `plugin.json`, `skills/*/SKILL.md`, optional
`mcp.json`. Persona/profile metadata belongs under `extensions.io.shiborgi.agentpatrol`
and its matching extension directory, never extra manifest fields. This is a
skills publisher and resolver, not an MCP execution client. A skill about MCP
development does not launch a server or grant permissions.

## Context Query

Command: `contextpatrol query`.

```json
{
  "protocolVersion": "1.0",
  "root": "/absolute/repository/path",
  "task": "Repair React form validation",
  "profile": "implementation",
  "paths": ["src/form.tsx"],
  "budget": {"maxFiles": 30, "maxBytes": 24000, "maxDepth": 2}
}
```

`root` and `task` are required. `profile` defaults to `overview`; `paths` defaults
to an empty array; budget values have bounded defaults. Profiles: `overview`,
`architecture`, `implementation`, `review`. Paths are repository-relative seed
files, not permission to escape the root. A query reads the current filesystem
without executing repository code, installing dependencies, or accessing a network.
Tasks are nonempty and at most 8,192 characters. At most 100 unique seed paths are
accepted, with at most 1,024 characters each; absolute paths, traversal, empty or
dot segments, backslashes, control characters and colon characters are rejected.
CodePatrol validates these bounds before creating execution state. ContextPatrol
excludes `.codepatrol` and `.memorypatrol` tooling metadata and retained worktrees at all depths.

Response fields:

- `protocolVersion`: `1.0`.
- `profile`: effective profile.
- `snapshot`: SHA-256 identifying bounded input content and analysis semantics.
- `signals`: sorted stack tags such as `typescript`, `react`, `python`, `mcp`.
- `files`: selected objects with `path`, `language`, `score`, `reasons`, and optional `excerpt`.
- `graph`: `nodes` (path strings), `edges` (`from`, `to`, `kind: "imports"`),
  `cycles` (arrays of paths), `impacted` (path strings).
- `diagnostics`: strings describing unresolved/heuristic analysis and truncation.
- `stats`: `scannedFiles`, `selectedFiles`, `truncated`.
- `digest`: SHA-256 of the recursively key-sorted response without `digest`.

Only local dependency facts are reported, not fabricated call graphs or test
coverage. Graph traversal and complete serialized output are bounded. Selection
is deterministic. Sensitive files and external symlinks are excluded. Omitted
files and heuristic limitations are reported rather than silently called complete.

## Workflow and Execution

The ordered stages are `spec`, `spec-review`, `plan`, `plan-review`, `build`,
`build-review`, `ship`. CodePatrol chooses an eligible persona per stage and
profiles from both task text and ContextPatrol signals. Context profiles are
chosen per stage; decisions expose reasons, scores and content digests.
The fixed stage map is Spec overview, Spec Review review, Plan architecture, Plan
Review review, Build implementation, Build Review review and Ship review. Only a
structural/refactor Spec selects architecture instead, and a focused nonstructural
bugfix Plan selects implementation instead. Context selection precedes historical
route scoring and is included in its partition. Context request budgets are overview
30 files/24,000 bytes/depth 1; architecture 30/32,000/3; implementation 20/64,000/2;
review 20/48,000/3, with complete request JSON capped below 65,536 bytes. Execution
refreshes selected context before every stage, adding safe existing producer artifacts
as bounded seeds for review. Generated/artifact directories are excluded. Seed
priority does not determine ContextPatrol's sorted representation. Its graph is local
imports and heuristics; reviews require reported existing source/test artifact paths,
not fabricated changed paths or diffs. Catalog content identity must remain stable
throughout a run. Planning caches identical stage/profile contexts and resolutions
only within that planning call. Stored route alternatives are
limited to 16, plans to 8 MiB, and run state to 64 MiB.

`codepatrol plan --input FILE` accepts `protocolVersion`, `root`, `task`, optional
`paths` and optional `config` (a config file path). It resolves real providers and
returns a proposed execution plan without pretending work was executed.
`codepatrol run --input FILE` additionally invokes an explicitly configured
executor. The package supplies `codepatrol-pi-executor`, but it is active only
when named in configuration and requires separately installed Pi and ModelPatrol.
When installed as a Pi package, CodePatrol also exposes `/patrol <feature>` in
interactive sessions; the command submits the closed v1 run input for the current
working directory. Executor stage processes receive the completion tool instead
of the interactive command, preventing recursion. No default model, gateway
lifecycle, credentials, merge, commit, push or deployment is implied.

An executor command receives:

```json
{
  "protocolVersion": "1.0",
  "runId": "generated-id",
  "stage": "build",
  "task": "Repair React form validation",
  "workspace": "/absolute/isolated/worktree",
  "agent": {},
  "context": {},
  "previous": []
}
```

The `agent` and `context` objects are the resolved provider responses. Optional
`memory` is a transient validated MemoryPatrol recall response. `previous`
contains completed stage results. The response has `protocolVersion`, `status`
(`passed` or `failed`), `summary` (nonempty text), `artifacts` (string array),
optional `approved` (boolean, required for review), optional `memories` (at most
ten executor-selected MemoryPatrol candidates), and optional `usage` with
nonnegative `inputTokens`, `outputTokens`, `costUsd`. Missing usage is unknown,
never zero-cost evidence. A failed stage or non-approved review stops advancement.
Memory candidates are removed before state persistence and are written through the
configured MemoryPatrol `remember` command only after a complete passing stage.
Build verification is an explicitly configured argv command, not an executor's
claim. Release requires a separate explicit human approval and never implicitly
publishes, pushes or deploys. The executor is a trusted local process, not a
sandboxed plugin; only trusted commands may be configured.

## Configuration

`codepatrol.json` is a closed v1 configuration. Paths in argv are interpreted in
the configured process working directory; use PATH-installed commands for portable
configuration. No implicit arguments are appended to configured commands.

```json
{
  "protocolVersion": "1.0",
  "providers": {
    "agents": {
      "catalog": ["agentpatrol", "catalog"],
      "resolve": ["agentpatrol", "resolve"]
    },
    "context": ["contextpatrol", "query"]
  },
  "memorypatrol": {
    "recall": ["memorypatrol", "recall"],
    "remember": ["memorypatrol", "remember"],
    "store": "codepatrol",
    "budget": {"maxResults": 10, "maxBytes": 24000, "maxVisited": 500}
  },
  "executor": ["codepatrol-pi-executor"],
  "modelpatrol": {
    "baseUrl": "http://127.0.0.1:4318",
    "model": "auto",
    "apiKeyEnv": "MODELPATROL_API_KEY",
    "harness": "pi",
    "api": "chat",
    "project": "my-project"
  },
  "verification": ["npm", "run", "verify"],
  "limits": {"timeoutMs": 900000, "maxOutputBytes": 1048576},
  "telemetry": {"enabled": true},
  "remote": {"github": {"repository": "owner/repository", "sync": "manual"}}
}
```

The Pi example uses a 15-minute per-process timeout because a complete coding
stage can legitimately exceed the library's conservative two-minute default.
Timeout still fails closed and never causes automatic replay.

Providers default to these PATH commands. Executor and verification have no
implicit defaults. Limits and telemetry have documented bounded defaults.

### Optional MemoryPatrol provider

`memorypatrol` is a closed optional object. It contains exact `recall` and
`remember` argv (defaulting to the installed MemoryPatrol commands), a lowercase
named `store` (default `codepatrol`), and bounded recall `budget`. The recall
budget's `maxBytes` cannot exceed CodePatrol's process output limit. Recall is
run-stage-only; `plan` remains read-only and does not access memory. A configured
memory command failure blocks execution. Its recall response and executor-proposed
insights are transient and do not enter state, telemetry, or remote projection.

### Optional ModelPatrol transport

`modelpatrol` is an optional closed object with `baseUrl` (HTTPS or loopback
HTTP), `harness` (`opencode` or `pi`), required operator label `project`,
`model` (default `auto`), `api` (`chat`, `responses`, or `messages`, default
`chat`) and `apiKeyEnv` (default `MODELPATROL_API_KEY`). At stage execution,
CodePatrol injects `MODELPATROL_BASE_URL`, `MODELPATROL_MODEL`, `MODELPATROL_API`,
`MODELPATROL_API_KEY_ENV` and JSON `MODELPATROL_HEADERS` into the trusted child
process. Headers identify step, persona, profiles, harness, project, run,
session and stage trace. Credentials are inherited, never included in the
executor JSON. Missing configured credentials fail before executing the child.

The trusted executor must load ModelPatrol's OpenCode plugin or Pi extension
and preserve that environment. It must still produce the existing executor
response; a raw harness CLI is not a Patrol executor. The packaged
`codepatrol-pi-executor` performs this translation through the modular
`codepatrol/pi` completion plugin and ModelPatrol's resolved `modelpatrol/pi`
provider extension. It accepts exactly one completion result, uses exact-JSON
fallback only for providers without tool calls, and replaces model-supplied usage
with structured Pi event usage. Use a fresh harness
process per stage, not a shared server with stale stage metadata. ModelPatrol
selects only compatible models and owns its own accounting. It cannot grant
approvals or override verification/release gates. No sibling-source imports or
changes to AgentPatrol/ContextPatrol protocols are required.

## GitHub Tracking

`remote.github` configures explicit GitHub tracking sync. `repository` is optional
when `gitRemote` can be inferred; the token is read from `tokenEnv`, never config.
`codepatrol remote sync --root PATH [--config FILE] [--dry-run]` maps tracked Init,
Wave and Work state to a Wiki page, milestone and issue. It uses stable SHA-256 HTML
markers, rejects duplicate markers and conflicting metadata, and writes Wiki before
REST entities. `sync: "run-end"` is best-effort after the state lock is released;
sync failure never changes the completed local state or approval decision.

## Telemetry and Learning

Telemetry is local, versioned and can be disabled. Events include run and stage
identity, route, outcome, elapsed milliseconds and provider digests. Task text,
source excerpts, environment variables and raw executor output are not telemetry.
There is no automatic remote export. Token/cost values are stored only when
reported by the executor and remain estimates supplied by that executor.

Adaptive route scoring partitions observations by stage, normalized task class,
persona, specialist profiles, context profile and catalog content digest. It uses
bounded historical adjustments after a minimum number of observations, records
its reasons, and cannot change eligibility or bypass review/release gates. Run
state is authoritative; telemetry is not. Corrupt or unavailable telemetry must
not grant approvals or turn a committed execution into a failed execution.
Reviewer approval and rejection are not independent evidence of review quality:
reviewer learning remains neutral without adjudication. Explicit valid review
decisions provide feedback for the producer only. Objective verification failure
blocks execution even when an executor claims success. Three observations are
required before producer scores can change, by at most +/-0.3.
