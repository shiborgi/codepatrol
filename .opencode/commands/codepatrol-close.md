---
description: (codepatrol) Commit or roll back one verified Change
---
Load `codepatrol-close` for `$ARGUMENTS`. Require explicit work id and
`commit` or `rollback`, verify the unchanged target and clean candidate, record
Close metrics, then use the deterministic terminal command. Never push,
rebase, force or resolve conflicts.
