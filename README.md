# CodePatrol 1

Local-first orchestration for real provider context and explicitly configured
execution. AgentPatrol supplies personas and composable specialist profiles;
ContextPatrol supplies read-only repository snapshots; MemoryPatrol supplies
optional persistent insights; CodePatrol owns routing, workflow gates, isolated
worktrees, durable state, and local adaptive telemetry.
There is no built-in model, fabricated execution, or automatic deployment.

```text
spec -> spec-review -> plan -> plan-review -> build -> build-review -> ship
                                                                    |
                                                           awaiting-approval
                                                                    |
                                                        explicit human approval
```

## Install

Requires Node.js 22.13+, Git for runs, and separately installed v1 providers:

The commands below apply after the coordinated 1.0.0 publication. To validate
these unpublished checkouts now, follow [local release acceptance](docs/release.md).

```bash
npm install -g \
  'git+ssh://git@github.com/shiborgi/agentpatrol.git#<commit-sha>' \
  'git+ssh://git@github.com/shiborgi/contextpatrol.git#<commit-sha>' \
  'git+ssh://git@github.com/shiborgi/memorypatrol.git#<commit-sha>' \
  'git+ssh://git@github.com/shiborgi/modelpatrol.git#<commit-sha>' \
  'git+ssh://git@github.com/shiborgi/codepatrol.git#<commit-sha>'
codepatrol --help
```

Packages communicate through [Patrol Protocol 1.0](docs/protocol.md), not sibling
source imports. Provider programs must be trusted local commands.

## Plan And Run

Task input is a closed JSON object. `root` is absolute; `paths` are optional
repository-relative seed files. An optional `config` path is resolved relative to
`root`; otherwise `<root>/codepatrol.json` is loaded when present. Tasks must be
nonempty and at most 8,192 characters. At most 100 unique seed paths are accepted,
each at most 1,024 characters, with no traversal, empty segments, control characters,
Windows drive paths, backslashes, colons or glob characters. Invalid inputs are
rejected before state/worktree creation.

```json
{
  "protocolVersion": "1.0",
  "root": "/absolute/path/to/repository",
  "task": "Repair React form validation",
  "paths": ["src/form.tsx"]
}
```

```bash
codepatrol plan --input task.json
codepatrol plan --input - < task.json
codepatrol run --input task.json
codepatrol approve --run RUN_ID --root /absolute/path/to/repository --confirm
codepatrol telemetry summary --root /absolute/path/to/repository
codepatrol remote sync --root /absolute/path/to/repository --dry-run
```

For interactive use, install this checkout once as a global Pi package (or use
`pi install npm:codepatrol@1.0.0` after publication):

```bash
pi install /absolute/path/to/codepatrol
```

Start Pi from the root of any clean, committed repository that has a valid
`codepatrol.json`, with `MODELPATROL_API_KEY` already exported, then run:

```text
/patrol Implement the requested feature
```

The global extension exposes only this command in an interactive session. It
starts the complete CodePatrol workflow for the current directory; each stage
runs in its own fresh Pi process and receives only the stage-appropriate tools.
Successful Ship ends at `awaiting-approval`, and changes remain in the retained
detached worktree for inspection. The command never merges, commits, pushes,
publishes or deploys.

Keep the input outside the target repository or commit it before running. Plan
can inspect dirty and non-Git directories. It calls the real catalog, obtains
overview context, selects eligible routes, and resolves an agent and appropriate
context for every stage. It caches context queries by stage/profile and resolved agents
by full catalog identity/persona/profiles within the plan. It never calls the
executor or writes run state.

Run requires a clean Git top-level directory with an existing commit, plus both
executor and verification commands. It creates a detached worktree at
`.codepatrol/v1/workspaces/<runId>` and records that actual workspace in requests
and state. The original checkout and branch are not updated. Dependencies are
not installed or shared automatically; the trusted adapter must prepare anything
its build and verification require in the isolated worktree.

Every failure blocks advancement. Reviews require `approved: true`; an explicit
`approved: false` blocks any stage. After a successful build response, CodePatrol
actually runs the configured verification argv. Nonzero exit, timeout, missing
verification, or malformed executor output fails closed. Immediately before every
stage, CodePatrol checks the catalog identity and refreshes selected stage context
from the actual workspace. Existing, safe relative producer artifacts become
additional seeds, newest producers first, within the 100-path and context input-byte
bounds. Seed priority is not ContextPatrol representation ordering, which is sorted.
Escaping symlinks, invalid artifact paths, and paths under `dist`, `build`,
`coverage`, `.next`, `.codepatrol`, `.memorypatrol`, `node_modules`, or `vendor` are not followed.
Spec/plan artifacts therefore reach their reviews. Immutable agent
resolutions are reused; a changed catalog content identity blocks the run.

Successful Ship means release preparation only and leaves `awaiting-approval`.
`approve --confirm` records the local operator name and timestamp, changing state
to `approved`. It does not merge, commit, publish, push, or deploy. Human review of
the retained worktree and all actual release actions are separate responsibilities.

## Configuration

The repository's `codepatrol.json` uses the packaged Pi executor and the separately
installed ModelPatrol Pi provider extension. All fields are closed and v1-only;
unknown keys are rejected:

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
    "budget": { "maxResults": 10, "maxBytes": 24000, "maxVisited": 500 }
  },
  "executor": ["codepatrol-pi-executor"],
  "modelpatrol": {
    "baseUrl": "http://127.0.0.1:4318",
    "model": "auto",
    "apiKeyEnv": "MODELPATROL_API_KEY",
    "harness": "pi",
    "api": "chat",
    "project": "codepatrol"
  },
  "verification": ["npm", "run", "verify"],
  "limits": { "timeoutMs": 900000, "maxOutputBytes": 1048576 },
  "telemetry": { "enabled": true }
}
```

The checked-in Pi configuration allows 15 minutes for each model stage or
verification process. This remains below the protocol's one-hour ceiling and
avoids treating a normal coding turn as a transport failure. Tune it explicitly
for other executors; timeout never implies retry or resume.

Provider defaults are exactly the PATH argv above. No arguments are implicitly
appended, and no shell is used. During planning, commands run in the input root;
run preflight also resolves a bounded proposed plan in the input root before creating
a worktree. During stages, provider, executor and verification commands run in the
isolated worktree. Relative argv paths use that working directory, not the config file's
directory. Use PATH commands or explicit absolute adapter paths where appropriate.

Default timeout is 120,000 ms, bounded to 10 through 3,600,000 ms per process.
Default byte cap is 1,048,576, bounded to 1,024 through 16,777,216. The cap covers
combined stdout/stderr and independently bounds JSON stdin. Verification stdout
is not a JSON protocol and is not persisted. Context queries have a fixed public
stage/profile policy: overview 30 files/24,000 bytes/depth 1; architecture
30/32,000/3; implementation 20/64,000/2; review 20/48,000/3. Complete context
request JSON remains capped at 65,536 bytes.
Artifact seeds are bounded; oversized executor requests fail instead of dropping
completed execution evidence. Timeout/overflow settles immediately and destroys
stdio handles even if an escaped descendant retains inherited pipes.

## MemoryPatrol

MemoryPatrol is an optional local provider that gives CodePatrol durable,
repository-scoped memory. When `memorypatrol` is configured, CodePatrol calls its
bounded `recall` argv immediately before each executor stage, using the canonical
repository root rather than the isolated worktree. The validated recall response is
available only in that executor request as `memory`; it is never copied into the
plan, run state, telemetry, GitHub projection, or environment.

The executor remains responsible for deciding which useful, non-sensitive insights
to retain. Its successful response may include at most ten `memories`, each with
`content`, optional `category` (`preference`, `decision`, `fact`, `insight`,
`context`, or `general`), `importance` 1–5, `tags`, and `entities`. After the full
stage has passed — including Build verification — CodePatrol submits those candidates
to the configured `remember` argv with source `agent`. It removes candidates from the
accepted executor result before persisting state. Failed or blocked stages never
write candidates. A configured MemoryPatrol failure blocks the run; omitted
configuration disables memory entirely. The named store defaults to `codepatrol`.
The recall byte budget must not exceed `limits.maxOutputBytes`.

## GitHub Tracking Sync

Tracked task input maps Init to an owned GitHub Wiki page, Wave to a milestone, and
Work to an issue. `codepatrol remote sync --root PATH` is manual by default and uses
`remote.github.repository` or infers the repository from `gitRemote`. The token is
read only from `tokenEnv` (default `GITHUB_TOKEN`). Sync preflights Wiki support,
then writes Wiki pages before milestones and issues. It projects all local tracked
states, rejects conflicts and duplicate markers, and excludes paths, workspaces,
source/context, agents, executor summaries, errors, and raw outputs. `--dry-run`
performs inspection without mutations.

Proposed plans are limited to 8 MiB and durable state to 64 MiB of compact JSON,
including its trailing newline. Readers and writers enforce the same limits.
Catalogs allow at most 256 personas and 256 profiles; persisted routes retain only
the top 16 alternatives. Run rejects an oversized initial plan with compact blocked
state before creating a worktree. Before every executor call it reserves capacity
for the maximum permitted response, verification argv and error overhead. A later
capacity failure blocks without that executor call and drops the bulky proposed
plan, preserving previously completed records.

## Trusted Executor

An executor reads one JSON object on stdin and returns one JSON object on stdout.
CodePatrol includes `codepatrol-pi-executor`, a trusted launcher that starts a
fresh Pi process per stage, loads the modular CodePatrol completion plugin and
ModelPatrol provider extension, restricts non-build stages to read-only tools,
and derives usage from Pi events rather than model claims. Pi and ModelPatrol are
installed and operated separately. The same Pi package registers `/patrol` only
outside executor stages, preventing recursive workflow commands. Custom executors remain supported. Send
diagnostics to stderr. See [protocol.md](docs/protocol.md). Requests contain
`protocolVersion`, `runId`, `stage`, `task`, `workspace`, resolved `agent`, stage
`context`, optional transient `memory`, and `previous` completed stage records. Each previous record includes
`stage`, `result`, route/context evidence, duration, status, and optional verification.

```json
{
  "protocolVersion": "1.0",
  "status": "passed",
  "summary": "Describe actual completed work and evidence",
  "artifacts": ["relative/path/to/evidence"],
  "approved": true
}
```

`approved` is mandatory for review responses. Optional `usage` may contain
nonnegative `inputTokens`, `outputTokens`, and `costUsd`; missing values mean
unknown, not zero. Artifact strings are advisory, never run; safe existing producer
artifacts can be passed to the read-only context provider as bounded seeds.
The adapter must perform the real work, restrict writes to its provided workspace,
and never deploy or push. The packaged Pi plugin provides a protocol boundary and
tool allowlist, not an OS sandbox; operators must still trust the configured Pi,
ModelPatrol and extension installations.

## State And Learning

Fresh v1 state lives in `.codepatrol/v1/<runId>.json`, outside the execution
worktree. Writes use exclusive run-ID reservation, fsync and atomic rename under
an exclusive repository writer lock. Execution intent is saved before each
potentially non-idempotent adapter call. There is no automatic retry or resume.
If killed, inspect retained state/worktree before removing a stale `writer.lock`;
ensure its process and executor descendants are stopped. Decide how to handle
partial work before starting a new run. Never hand-edit run state. Worktrees remain
for inspection; remove them explicitly with Git when no longer needed and manage
corresponding local state deliberately.

Telemetry defaults on and is strictly local JSONL. Set `telemetry.enabled` to
`false` to disable both recording and historical learning. The allowlist contains
run/stage identity, route partition, status, feedback, duration, provider digests,
snapshot and optional reported usage. It excludes task text, source, environment,
summaries, artifacts and raw process output. State does contain task/context and
executor evidence, so protect it separately. Telemetry errors never grant approval
or change an execution's persisted outcome.

Routing combines task words and overview stack signals; matching specialist
profiles are composed together, with a general-profile alternative. Only personas
eligible for the current stage can compete. Ties are stable. History is partitioned
by stage, normalized task class, persona, sorted profiles, context profile and
catalog content digest. The required catalog `contentDigest` covers full active
authoring, including skill instructions, not just catalog metadata. Resolved agents
must echo that identity in `catalogDigest` and pass their own canonical payload
`digest` check. Skill-only edits therefore invalidate both cached resolutions and
learning partitions, even when IDs and `catalogVersion` remain unchanged.
After three producer observations, a smoothed success rate adjusts
scores by at most +/-0.3, enough to favor a better general route over a repeatedly
failing specialized route. Reasons, scores, alternatives and sample counts are
exposed in every plan. No exploration executes arbitrary additional work.

Producer success/failure review feedback requires an explicit approved/rejected
decision in a valid passing review response; build success also requires real
verification. Malformed/failed reviewer responses do not penalize producers.
Producer execution/verification failures give negative feedback. Reviewer quality
feedback is always unknown without external adjudication, regardless of approval
or rejection, and historical reviewer observations never affect route scores.
This avoids rewarding rubber-stamping or demoting correct rejection. Ship's passing
claim remains unknown. Reviews are trusted adapter evidence, not an independent
correctness oracle. History reads
at most 1 MiB/2,000 events, uses the latest 100 observations per partition, rejects
corrupt/unknown-schema lines and deduplicates run/stage samples. Logs compact once
over 1 MiB using random, exclusively created temporary files. State/telemetry
directories reject symlinked parents and telemetry file opens reject symlinks.
Local users can tamper with telemetry, but bounded scoring never
overrides workflow gates.

The audited fixed stage map is Spec overview, Spec Review review, Plan architecture,
Plan Review review, Build implementation, Build Review review and Ship review.
Only structural/refactor Spec work selects architecture instead, and a focused
nonstructural bugfix Plan selects implementation instead. The selected profile and
rationale are recorded in the route and partition its learning history. ContextPatrol
graphs report local imports and heuristics, not complete semantic or runtime behavior;
reviews need reported existing source/test artifact paths and do not receive invented
changed-path or diff data.

## Library

```ts
import { plan, run, approve, readRun, configSchema } from "codepatrol";

const config = configSchema.parse({ protocolVersion: "1.0" });
const proposed = await plan(input, config);
// run(input, configuredExecutorAndVerification) returns durable RunState.
// approve({ root, runId, confirm: true }) records operator approval only.
```

ESM exports include Zod contracts and inferred types, routing, provider RPC,
executor boundaries, state reading and telemetry helpers. See
[architecture](docs/architecture.md) for the exact API groups. The CLI prints JSON
on stdout and diagnostics on stderr; blocked runs return persisted state with exit
code 1. Usage/provider/setup errors return exit code 1.

## Development

```bash
npm ci
npm run verify
npm run release-check
```

Tests use isolated fixture providers and a deterministic fixture executor, not a
pretend production model. Release checks pack/install the npm artifact, test ESM
exports and declarations, and exercise the installed binary through all stages
and operator approval. See [CONTRIBUTING](CONTRIBUTING.md) and [SECURITY](SECURITY.md).

`npm run test:family` additionally packs and installs all five real Patrol
projects and checks their integrated lifecycle, graph context, adaptive routing,
and privacy gates. See [coordinated release acceptance](docs/release.md) for
alternate checkout paths, CI refs, release steps and intentional limitations.
