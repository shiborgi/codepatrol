# Security

## Trust Boundary

Configured providers, executor and verification commands are trusted local
programs. CodePatrol is not a sandbox. They inherit the process environment and
user filesystem/network permissions, may read secrets, and can write outside the
worktree or launch other programs. Never use unreviewed repository configuration
or an untrusted adapter. Context/agent instructions are data, not permission to
override workflow gates. A malicious executor can lie about review outcomes;
objective verification is only as strong as the configured command.

CodePatrol uses exact argv with no shell, bounds input and combined captured
output, validates strict v1 responses/digests and kills timed-out process groups
on POSIX. Descendant termination is best effort, especially for daemonized or
Windows children. Timeout and overflow close local stdio and settle without waiting
for escaped descendants, which may still require operator cleanup. These controls
do not make malicious commands safe. The trusted
adapter must avoid publication/deployment and keep writes in its supplied workspace.
CodePatrol itself never deploys, publishes, merges, installs dependencies or invokes
a model. Explicit GitHub tracking sync may commit and push only an owned Wiki page
through a temporary clone, and may create/update marked milestones and issues.

## State And Approval

Run requires a clean Git target and uses a detached worktree. State is local
`.codepatrol/v1` data. Exclusive locks, exclusive run creation, atomic
rename and fsync protect cooperative writers. Processes with the same permissions
can tamper with state, Git metadata and telemetry; this is not multi-user
authorization or a tamper-proof audit system. No lock is stolen and no executor
write is automatically replayed after a crash. Inspect partial work and stop all
relevant processes before removing a stale lock.

State and telemetry reject symlinked `.codepatrol`/`v1` directories. Telemetry
rotation uses a random `wx` temporary file and only writes through its owned handle;
it never follows a predictable compaction filename. Leaf telemetry opens use
no-follow flags. These checks do not prevent an adversarial same-user process from
racing directory replacement; use OS isolation for hostile executors.

Plans are capped at 8 MiB and state at 64 MiB, consistently on publication and
reading. Response capacity is reserved before each executor call; oversize initial
plans block before worktree creation. Routes retain at most 16 alternatives. Context
requests match ContextPatrol's task/path constraints. Producer artifacts are only
bounded context seeds after syntactic and actual-workspace containment checks.

Reviews and real successful build verification must pass before operator approval.
`approve --confirm` records the local OS username and timestamp only, not a
cryptographic signature or external identity check. It does not freeze the
worktree or prove its contents stayed unchanged after verification. Review the
current content before manual integration/release. Publishing is outside
CodePatrol's authority.

## Privacy

Telemetry is local-only, opt-out, allowlisted and failure tolerant. It never stores
task text, source excerpts, environment values, summaries, artifacts or raw output.
Optional token/cost values are unverified executor reports. Corrupt lines are
skipped; bounded scoring cannot alter eligibility or gates. No remote export exists.
Reviewer feedback remains unknown without independent adjudication; neither approval
nor rejection trains reviewer quality. Skill-only catalog changes invalidate history
through the required full-authoring content identity, not metadata-only hashing.

Authoritative run state intentionally contains task text, provider instructions,
source context, executor summaries and artifact names. Treat `.codepatrol` and
retained worktrees as sensitive. Keep them out of source control and protect local
permissions/backups. Restrictive file modes do not replace OS isolation.

GitHub sync reads its token only from the configured environment variable. It does
not place credentials in remote URLs, command arguments, logs, state or the askpass
script. Wiki synchronization uses exact Git argv without a shell, a temporary
restricted clone, non-force push, and cleanup. Tracking projections exclude paths,
workspaces, source/context, agents, executor summaries, errors, and raw output.

Report vulnerabilities privately through the repository's security reporting
channel. Do not include credentials, private source, full run state or raw logs in
public issues. Only v1 is supported.
