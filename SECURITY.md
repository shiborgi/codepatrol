# Security Policy

## Supported Versions

Security fixes are provided for the latest release on `main`.

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability or include credentials, tokens, personal data, or private repository content in a report.

Use GitHub private vulnerability reporting for this repository. Include affected versions, reproduction steps, impact, and any suggested mitigation. If private vulnerability reporting is unavailable, contact the maintainer through the private contact method listed on the maintainer's GitHub profile.

## What CodePatrol stores and publishes

All orchestration state lives in Git objects on the custom ref `refs/codepatrol/state`. That ref is local until explicitly transferred: `codepatrol state push` and `codepatrol state fetch` are the only transfer operations, and neither runs automatically from lifecycle commands.

Work content — titles, descriptions, acceptance criteria, todo items, summaries, results, and acceptance evidence — may be projected publicly to GitHub Issues, Milestones, and comments. **Never place secrets in Work descriptions, todo items, summaries, or any other orchestration field.** Once projected or pushed, treat the content as public and permanent.

Todo and result JSON files are temporary command inputs. Create them outside the repository, restrict their filesystem permissions as appropriate, and remove them when the run is complete.

## What CodePatrol does not do

- CodePatrol does not execute verification commands itself. Verify records structured acceptance evidence and pins the observed commit; no command output is captured, redacted, or stored by CodePatrol.
- Build, Verify, and Ship require a clean checkout: modified tracked files,
staged files, untracked files, and unresolved conflicts are refused at every
evidence boundary so they cannot be implicitly included in a verification claim.

- CodePatrol creates isolated Change branches and worktrees for code-delivery Works. Ship Accept creates one local squash commit, then removes the Change resources according to its outcome policy.
- GitHub projection is optional. Lifecycle commands work without a remote, projection failures never invalidate local transitions, and `codepatrol sync` converges explicitly later.

Grant `gh` only the repository access the projection requires.
