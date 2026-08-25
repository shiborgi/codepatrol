# CodePatrol

CodePatrol 1.0 is a recoverable, local-first workflow for coding agents. It owns
workflow state, immutable Git candidates, objective gates, and integration. An
external harness owns the intellectual work and exchanges strict JSON with the
CLI. No daemon, database, ContextPatrol, AgentPatrol, or agent runtime is required.

```text
Init
  Spec options -> Spec Review
  Wave
    Plan options -> Plan Review
    Build options -> Build Review
    Ship
```

## Principles

- Producers may submit any number of Spec, Plan, or Build options until review.
- Review seals the round, compares every option, and selects one passing option.
- Tasks are persistent and recoverable with `task list` and `task show`.
- Build candidates are immutable Git refs and are verified in disposable worktrees.
- Verification failure, acceptance return, executor failure, and infrastructure
  failure are different outcomes.
- Ship requires explicit operator confirmation.
- GitHub synchronization is optional, explicit, and outside lifecycle transactions.

## Configuration

Create `codepatrol.json` in the repository root:

```json
{
  "schemaVersion": 1,
  "baseBranch": "main",
  "verification": {
    "argv": ["npm", "run", "check"],
    "timeoutMs": 180000,
    "sharedPaths": ["node_modules"]
  },
  "maxReviewReturns": 3
}
```

`sharedPaths` optionally links existing ignored dependency directories into Build
and Review worktrees. CodePatrol never installs dependencies or runs autofix.

For a new repository, `codepatrol setup` discovers the checked-out base branch and
the `origin` GitHub remote without changing Git remotes or contacting GitHub:

```bash
codepatrol setup --verification-argv '["npm","run","check"]'
```

Use `--github-repo owner/repository` for a non-GitHub or missing remote, and
`--dry-run` to print the normalized configuration without writing it. A checked-out
branch is used as `baseBranch`; detached HEAD falls back to `main`. Setup stores
only the token environment variable name, never a token value. Existing config
requires `--update`, which preserves unrelated valid settings.

### Optional Agent Catalog

An AgentPatrol-compatible catalog can be configured as an optional, deterministic
process boundary. See `contracts/family.md`. CodePatrol has no AgentPatrol
dependency, discovery, network lookup, or catalog-layout knowledge. Do not add this section to a repository that
does not use catalog resolution:

```json
{
  "agentCatalog": {
    "argv": ["agentpatrol", "resolve", "--json"],
    "timeoutMs": 10000,
    "defaults": {
      "spec-review": { "agent": "agentpatrol/chief-architect", "version": "1.0.0" },
      "plan-review": { "agent": "agentpatrol/principal-engineer", "version": "1.0.0" },
      "build-review": { "agent": "agentpatrol/qa-engineer", "version": "1.0.0" },
      "ship": { "agent": "agentpatrol/release-manager", "version": "1.0.0" }
    }
  }
}
```

`argv` is the complete command. CodePatrol executes it directly without a shell
and appends no arguments, so any resolver-specific `resolve --json` arguments must
already be present. It sends
`{"schemaVersion":1,"reference":"...","version":"..."}` on stdin and requires
one strict response with `schemaVersion`, an `agent` containing `reference`,
`name`, exact `version`, and `digest`, plus `instructionsDigest` and
`instructions`. Digests use `sha256:` followed by 64 lowercase hexadecimal
characters. The instruction digest must match the nonempty instruction text.
Instructions are limited to 256 KiB, the full response to 512 KiB, and `timeoutMs`
to 60 seconds with a 10-second default.

Producer Open accepts `--agents <reference@version,reference@version,...>`, such
as `--agents agentpatrol/architect@1.0.0,agentpatrol/architect-lean@1.0.0`.
When `--agents` is omitted, the optional `defaults.spec`, `defaults.plan`, or
`defaults.build` selection is used for that operation. Without either an explicit
selection or an operation default, Producer Open remains a usage error.
All agents resolve before any state mutation, context is retrieved once, and Open
returns `{ "tasks": [TaskEnvelope...] }`, including for a single agent. Build tasks
in a batch share one base commit. Reviews and `ship show` resolve their one configured
default; they do not accept role-selection flags. A requested resolution never
silently falls back. Harnesses load resolved instructions as the system prompt for
each task execution; task input,
result contracts, schemas, verification, review, and Ship gates remain authoritative.

### ContextPatrol Integration

ContextPatrol is configured independently of the agent catalog. See
`contracts/family.md`. It receives a
neutral, output-byte-bounded code-analysis query and returns advisory context. It
never receives task identifiers, lifecycle labels, agent identity, or agent
instructions. CodePatrol targets the current base commit, so a snapshot is
immutable even when the working tree changes afterward.

```json
{
  "contextPatrol": {
    "argv": ["contextpatrol", "query", "--input", "-"],
    "timeoutMs": 60000,
    "profiles": {
      "orientation": {
        "facets": ["structure", "symbols", "relations"],
        "maxOutputBytes": 9600
      }
    },
    "defaults": { "spec": "orientation" }
  }
}
```

Profiles select fixed neutral analysis facets and an output-byte limit. Use
`--context-profile <name>` to override an operation default or
`--context-profile none` to suppress it. A selected provider resolves before the
task state changes; failure never falls back silently. The report is an immutable
advisory snapshot exposed only at the task envelope's top level. It cannot change
contracts, verification, review selection, or Ship authority.

## Golden Path

Create an Init and open producer tasks:

```bash
codepatrol init create --title "Feature" --brief "What must change"
codepatrol spec open --init INIT-1 --harness opencode --model model-id --agents agentpatrol/architect@1.0.0,agentpatrol/architect-lean@1.0.0
codepatrol task show TASK-id
codepatrol task submit --task TASK-id --result - < spec.json
```

Open more `spec` tasks for alternatives. When all producers are submitted,
cancelled, or failed, seal the round:

```bash
codepatrol spec-review open --init INIT-1 --harness reviewer
codepatrol task submit --task TASK-id --result - < spec-review.json
```

Repeat at Wave scope:

```bash
codepatrol plan open --wave WAVE-1.1 --harness producer --agents agentpatrol/tech-lead@1.0.0,agentpatrol/tech-lead-lean@1.0.0
codepatrol plan-review open --wave WAVE-1.1 --harness reviewer
codepatrol build open --wave WAVE-1.1 --harness producer --agents agentpatrol/developer@1.0.0,agentpatrol/developer-lean@1.0.0
codepatrol build-review open --wave WAVE-1.1 --harness reviewer
```

`build open` returns the isolated workspace. Commit the implementation there and
submit the task. Build Review automatically verifies every immutable candidate.

Inspect and explicitly ship the selected candidate:

```bash
codepatrol ship show --wave WAVE-1.1
codepatrol ship accept --wave WAVE-1.1 --confirm accept
# or
codepatrol ship rollback --wave WAVE-1.1 --confirm rollback
```

If the base branch advanced, open a new Build seeded from the selected candidate:

```bash
codepatrol build open --wave WAVE-1.1 --from PROP-id --harness producer --agents agentpatrol/developer@1.0.0
```

## Recovery

```bash
codepatrol task list
codepatrol task show --task TASK-id
codepatrol task cancel --task TASK-id
codepatrol task fail --task TASK-id --reason "executor stopped"
codepatrol task retry --task TASK-id
codepatrol cleanup
codepatrol doctor
```

Invalid results leave tasks open. A blocked Build Review can retry verification
against the same candidates. After the configured return limit, `init resume` or
`wave resume` requires an explicit operator action to open another round.

## State

Current state lives at `refs/codepatrol/v1/state`. Every transition creates a
validated snapshot and event commit, then publishes it with compare-and-swap.
Candidates live under `refs/codepatrol/v1/candidates/` until terminal cleanup.
Older CodePatrol refs are neither read nor migrated.

## GitHub

Optional GitHub sync maps Init to Wiki page, Wave to milestone, and Work to issue.
It never runs automatically and never pushes the base branch:

```json
{
  "remote": {
    "github": {
      "enabled": true,
      "gitRemote": "origin",
      "tokenEnv": "GITHUB_TOKEN",
      "wiki": true,
      "milestones": true,
      "issues": true
    }
  }
}
```

```bash
codepatrol remote sync
```

See `contracts/` for the harness-neutral contract of every step.
