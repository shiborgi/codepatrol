# Limitations

CodePatrol 1.0 is deliberately minimal. Current limitations:

- **Change branches and worktrees are managed locally.** The Build path
  creates or adopts a local Change branch (`codepatrol/<work-id>`) and worktree
  (`<repoRoot>/../.codepatrol-worktrees/<work-id>`); the Ship CLI performs a
  local squash on Accept and removes the worktree (and the branch on Accept;
  retained on Rollback for investigation). There is no automatic rebase, no
  automatic merge, and no automatic push.
- **Automatic commits are limited to the Ship Accept squash.** Build and Verify
  record the observed `HEAD` as evidence; CodePatrol does not commit, merge,
  rebase, or push product code. The only product commit the CLI creates is
  the single local squash on Ship Accept.
- **Parallel attempts are scoped to one Wave.** Any number of Works of the same
  Wave may have active attempts at once — that is what `--wave` opens — but a
  Work of another Wave cannot start until that Wave is idle. A Work still has
  at most one active attempt, and Ship remains Work by Work because it is the
  only stage that advances the shared base.
- **Verify does not execute tests.** Verify records structured acceptance
  evidence and pins the candidate commit; running a test suite is the
  executor's responsibility.
- **GitHub projection requires the `gh` CLI** and an authenticated user with
  Issues, Milestones, and Labels permissions. Projection is optional: every
  lifecycle command works without it, and `codepatrol sync` converges later.
- **State transfer is explicit.** `refs/codepatrol/state` is a custom ref that
  ordinary clones do not fetch. Use `codepatrol state push` and
  `codepatrol state fetch`; neither runs automatically.
- **No Windows support.** Continuous verification runs on Linux and macOS only.
- **State schema is strict.** Parsers reject unknown fields and unsupported
  schema versions. CodePatrol v1 has no legacy state reader or migration path.

- **Build, Verify, and Ship require a clean checkout.** Modified tracked
  files, staged files, untracked files, merge conflicts, and dirty submodules
  are refused at every evidence boundary. The executor must commit product
  changes before Build completion.
- **Reblocking is explicit and audited.** A dependency change is recorded with
  reason and authority in `dependencyRevisions`. A rolled-back blocker stays
  blocking until explicitly replaced.
- **The local lock is repository-scoped.** Two independent clones can sync
  simultaneously; the lock cannot prevent distributed races on GitHub.
- **Product commit evidence is not transferred with the state ref.**
  `refs/codepatrol/state` stores commit hashes but not Git objects.
  The operator is responsible for preserving product commits.
- **Code versus no-code delivery is explicit.** A Work must declare whether
  it produces a product commit. A code Work whose Build does not change
  `HEAD` is refused.
- **Change cleanup is best-effort and local.** Cleanup runs strictly after the
  lifecycle commit is recorded; a failure emits a warning and never fails or
  rewrites the recorded completion. The operator must remove the worktree
  (`git worktree remove`) and, where applicable, the local Change branch
  (`git branch -D codepatrol/<work-id>`) by hand if cleanup fails. The future
  `refs/codepatrol/candidates/<work-id>` preservation is a separate Wave.

## GitHub projection recovery

If `codepatrol sync` reports that multiple remote objects carry the same
managed marker (e.g. "multiple issues carry marker ... (numbers 4, 5)"):

1. Identify the duplicates from the object numbers listed in the error
   message.
2. Delete the duplicate objects on GitHub (keep the oldest; check the
   managed section content if unsure).
3. Run `codepatrol sync` again. The remaining object will be adopted by its
   marker, and the Work association will be persisted.

Duplicates are a `CONFLICT` and are never resolved automatically. The
recovery is a manual operation performed on the GitHub side, not through
CodePatrol.

## The GitHub Project must exist before it can receive the projection

`projectStatusOf` and `projectNextStepOf` derive the `Status` and `Next Step`
values from local state, and `codepatrol sync` writes them onto the Project
configured under `github.project` in `codepatrol.json`. CodePatrol does not
create the Project itself: run `codepatrol project prepare` to be told exactly
what is missing — access, a single-select field, or one of its options. As with
every projection, absence of configuration, of network, or of the Project only
produces a warning; no lifecycle command depends on it.

## The wiki projection needs the wiki to exist

`Initiative -> wiki page` writes through the repository's wiki git remote
(`<repo>.wiki.git`). A repository whose wiki has never been initialised has no
such remote, and the projection fails as a best-effort warning like any other
GitHub failure. Local state remains authoritative.
