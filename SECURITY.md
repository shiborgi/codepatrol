# Security

- Local authority is the configured base branch and `refs/codepatrol/v1/state`.
- State publication uses compare-and-swap after full schema validation.
- Candidate commits are anchored by immutable refs before Review.
- Ship rechecks base and candidate identity and requires a clean base checkout.
- Ship Accept updates the base branch, state, and candidate ref in one reference
  transaction. Rollback never moves the base branch.
- External commands run without a shell, with timeout and bounded captured output.
- GitHub sync is explicit, never lifecycle authority, and reads tokens only from
  environment variables. Wiki authentication uses a temporary askpass helper.
- CodePatrol never installs dependencies or executes automatic fixes.

Tasks can execute arbitrary configured verification commands and harnesses can edit
Build worktrees. Treat repository configuration and selected harnesses as trusted.
Agent resolvers are also trusted and must not daemonize; descendant cleanup after a
timeout is best-effort when the platform cannot retain a process-group handle. Use
`doctor` and `cleanup` to inspect and reconcile managed resources.
