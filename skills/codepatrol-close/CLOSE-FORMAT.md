# Close receipt preflight

Before calling the deterministic Close command, record:

- work id and feature branch;
- target branch, recorded base and current target SHA;
- Verify candidate checkpoint/tree and verdict;
- requested action and explicit user authority;
- clean-worktree result;
- run start/finish, elapsed milliseconds and token coverage.

The generated `close/receipt.md` is authoritative for the terminal action.
Do not create a competing manual receipt or edit it after Close.
