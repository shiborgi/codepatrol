# CodePatrol

CodePatrol is a minimal, local-first workflow and state orchestrator. It manages
**Initiatives**, **Waves**, **Works**, dependencies, lifecycle attempts, and
results, across three explicit levels:

```
INIT-1
└── WAVE-1.1
    ├── WORK-1.1.1
    └── WORK-1.1.2
```

An Initiative carries context, a Wave is the delivery and evaluation boundary,
and a Work is the atomic execution unit that owns the lifecycle.
For code-delivery Works it also manages local **Changes**: isolated branches
(`codepatrol/<work-id>`), isolated worktrees, candidate commits, deterministic
verification, local squash integration on Ship Accept, rollback, and cleanup
per outcome policy. It projects Initiatives to wiki pages, Waves to
Milestones and Works to Issues.

The complete lifecycle works without GitHub or network access. Remote
publication is optional; Pull Requests and remote branches are projections
of a Change, never authoritative. A locally accepted Change does not require
a remote push unless the Work's acceptance criteria explicitly mandate it.

All state lives on one non-head Git ref, `refs/codepatrol/state`, updated with a
single compare-and-swap per transaction. See `docs/architecture.md` for the
boundaries and the invariants future changes must preserve, and
`docs/limitations.md` for what it deliberately does not do.

## Usage

```bash
codepatrol spec start --initiative INIT-1 --todo todo.json
# -> capture runId from the output
codepatrol spec complete --initiative INIT-1 --run <run-id> \
  --result spec-result.json --file initiative.json
codepatrol work list                             # the graph and its statuses

codepatrol plan start --work WORK-1.1.1 --todo todo.json
# -> capture attempt.runId from the output
codepatrol plan complete --work WORK-1.1.1 --run <run-id> --result result.json
# ... review, build, verify, ship ...

codepatrol ship complete --work WORK-1.1.1 --run <run-id> \
  --result accept.json --publish                  # opt-in remote publication
codepatrol ship publish --work WORK-1.1.1            # retry publication only

codepatrol sync                                  # converge GitHub Milestones/Issues/comments
codepatrol project prepare                       # what the GitHub Project still lacks
```

A whole Wave runs at once with `--wave` in place of `--work`. CodePatrol
resolves the Wave's current dependency layer and opens or completes every Work
of that layer in one transaction, with one entry per Work in each document:

```bash
codepatrol plan start --wave WAVE-1.1 --todo wave-todo.json
# { "works": { "WORK-1.1.1": { "todo": [{ "id": "t1", "title": "..." }] } } }
codepatrol plan complete --wave WAVE-1.1 --result wave-result.json
# { "works": { "WORK-1.1.1": { "run": "<run-id>", "decision": "continue", ... } } }
```

Ship has no `--wave` form: it is the only stage that advances the shared base,
so each Accept is decided on its own.

## Exit codes

The exit code is part of the interface — an automation reads it before it reads
anything else:

| Code | Meaning |
|------|---------|
| `0` | The command did what it was asked to do. |
| `1` | A domain refusal or failure: unknown work, wrong run, `RESULT_CONFLICT`, corrupt state, blocked build, GitHub failure. Also `codepatrol project prepare` when the Project is reachable but not yet prepared. |
| `2` | The invocation itself is wrong: unknown command or subcommand, missing or valueless flag, malformed input document. |

Every failure prints `{ "error": <code>, "message": ... }` on stderr. The `1`
from `codepatrol project prepare` is the one nonzero exit that instead prints a
report on stdout: nothing failed, the Project simply is not ready yet.

Stages: `plan`, `review`, `build`, `verify`, `ship`, each with `start` and
`complete`. A Work is `ready` when no attempt is running, `active` while its
attempt runs, and `terminal` after Accept or Rollback — completing a stage with
`continue` or `return` returns the Work to `ready` for its next stage. Build
starts only when every blocker is accepted. Execution is exclusive to one Wave:
any number of Works of that Wave may be active at once, and a Work of another
Wave waits until the Wave is idle.

Every stage also accepts `--wave <id>` instead of `--work <id>`, which opens or
completes the Wave's current dependency layer in a single transaction, with one
todo and one result entry per Work. Ship stays Work by Work: it is the only
stage that advances the shared base.

Every completion is bound to the exact run that `start` returned: repeating a
completion with the same run and the same result is a safe no-op, and a
different result for the same run fails with `RESULT_CONFLICT`.

Build, Verify, and Ship pin the observed `HEAD`: Build records the base and
candidate commits, Verify requires the checkout to stay on the Build candidate,
and Ship requires the verified candidate. Verify results must address every
acceptance criterion, and Verify derives the changed paths it actually observed
from the real candidate diff.

A Work declares `delivery: "code"` (produces a product commit via a
local Change) or `delivery: "no-code"` (metadata, analysis, or process-only
work). Code Works create an isolated branch and worktree at Build start, record
the candidate commit, verify it, and squash it onto the base branch on Ship
Accept. The branch and worktree are cleaned up per outcome: removed on Accept,
worktree removed and branch retained on Rollback.

## Harness commands

CodePatrol ships project-local command templates for OpenCode and Pi so the
same lifecycle contracts are reachable from either harness.

OpenCode:

- `.opencode/commands/codepatrol-spec.md`
- `.opencode/commands/codepatrol-plan.md`
- `.opencode/commands/codepatrol-review.md`
- `.opencode/commands/codepatrol-build.md`
- `.opencode/commands/codepatrol-verify.md`
- `.opencode/commands/codepatrol-ship.md`

Claude Code:

- `.claude/commands/codepatrol-spec.md`
- `.claude/commands/codepatrol-plan.md`
- `.claude/commands/codepatrol-review.md`
- `.claude/commands/codepatrol-build.md`
- `.claude/commands/codepatrol-verify.md`
- `.claude/commands/codepatrol-ship.md`

The same contracts are also exposed as native Claude Code skills through
`.claude/skills/codepatrol-<stage>`, symlinked to the shared files rather than
copied.

Pi:

- `.pi/prompts/codepatrol-spec.md`
- `.pi/prompts/codepatrol-plan.md`
- `.pi/prompts/codepatrol-review.md`
- `.pi/prompts/codepatrol-build.md`
- `.pi/prompts/codepatrol-verify.md`
- `.pi/prompts/codepatrol-ship.md`

All three harnesses use the shared lifecycle contracts under `skills/`, and all
three declare the capability loading contract: the primary method prevails,
capabilities are auxiliary, and only the current method's capabilities are
loaded. The CLI and `refs/codepatrol/state` remain authoritative.

Reload after template changes: in Pi, run `/reload` after adding or changing
templates during a session. In OpenCode, a new session or a project
configuration reload may be required to refresh the slash command list.

## GitHub projection

After a successful Spec Apply, CodePatrol attempts to project the Initiative,
its Waves and its Works to GitHub. The projection creates or updates:

- one wiki page for the Initiative;
- one milestone for each Wave;
- one Issue for each Work, associated to the milestone of its own Wave;
- managed type and priority labels;
- one comment per lifecycle attempt;
- one GitHub Project item per Work, carrying `Status` and `Next Step`;
- local associations with remote numbers.

`Status` is the stage that actually started — it never mirrors
`workflow.stage`, which already points at the next expected stage once a stage
completes. Completing a stage records the decided destination in `Next Step`
and leaves `Status` where it executed; starting the next stage moves `Status`
and clears `Next Step`. Enable it with `codepatrol.json`:

```json
{ "github": { "enabled": true, "project": { "owner": "<owner>", "number": 7 } } }
```

Without that file the Project projection is skipped. A manual board edit is
remote drift: the next sync restores the locally derived value and local state
is never changed.

Content outside the managed markers is preserved on wiki pages, milestone
bodies and Issue bodies.

The projection is best effort. A projection failure does not invalidate the
local Spec. Run `codepatrol sync` to reconcile the projection later.

## The Change (local) vs Pull Request (remote)

A Change is the local authoritative delivery artifact: the isolated branch,
worktree, candidate commits, and the local squash integration. A Pull Request
is an optional collaboration projection, never authoritative. Remote Pull
Requests, deployment, release management, and general repository hosting
remain outside the authoritative local lifecycle.

## Remote publication

Remote publication is explicit opt-in. On Ship Accept:

```bash
codepatrol ship complete --work <id> --run <run-id> \
  --result accept.json --publish
```

Without `--publish`, no push is attempted and `remotePublication` records
`not-requested`. With `--publish` and a resolvable origin, publication records
`pending` before the attempt and exactly one terminal status after (`pushed`
with `pushCommit` per the external-artifact evidence protocol, `push-denied`,
or `failed`). Publication failure never invalidates the local Accept.

If publication fails or is deferred, retry it independently:

```bash
codepatrol ship publish --work <id>
```

This retries only the push of the base branch, never repeats Ship Accept or
the local integration. Idempotent when already pushed.

## Improvement report

`codepatrol improve inspect` produces a deterministic improvement report from the
current state, without writing anything:

```bash
codepatrol improve inspect                          # human-readable
codepatrol improve inspect --format json            # canonical JSON
codepatrol improve inspect --initiative INIT-1      # filter by initiative
codepatrol improve inspect --since 2026-01-01       # attempts/completions since date
```

The report includes works (scoped, withActivity, acceptedInWindow,
rolledBackInWindow, currentlyActive), attempts by stage, return counts,
repeated attempts, and duration statistics. The `--since` window filters
attempts by `startedAt` and completions by `finalizedAt`.

## Execution composition

When `--profile <name>` is given to a stage start or spec start, CodePatrol
resolves the effective composition for the current method from
`skills/profiles/<name>.json` and `skills/catalog.json`. The recorded
composition includes `profile`, `capabilities` (id, version, digest), and
`compositionDigest` per attempt. Compatibility rules and the declared-vs-proven
disclaimer are in `docs/capabilities.md`.

## Spec modes

Spec has two explicit modes. The mode must be declared in the Spec summary.

- **Normal Spec** (default): defines the Initiative requested by the operator.
  Does not run evolution review or framework analysis.
- **Evolution Review** (explicit only): runs only when the operator explicitly
  requests framework evolution, backlog review, self-improvement, or roadmap
  discovery. Produces Facts (verbatim report observations) separated from
  Interpretation, and at most one proposal with hypothesis, smallest change,
  expected measure, and uncertainty. Never auto-creates an Initiative.

Every Initiative creation is a human decision. Nothing is created automatically.

The state ref is custom: ordinary clones do not fetch it. Transfer is explicit
and never automatic:

```bash
codepatrol state status            # local vs remote: ahead/behind/equal/diverged
codepatrol state push              # fast-forward only, force-with-lease
codepatrol state fetch             # fast-forward only, refuses divergence
```

## Development

```bash
npm run verify   # typecheck + unit/integration/e2e tests + smoke
```

`examples/` contains fictional documents for every input file.
