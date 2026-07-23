---
name: codepatrol-status
description: (codepatrol) Render the deterministic Change Kanban with Plan, Review, Apply, Verify and Close columns plus token/time totals, then report exact resume actions. Use to inspect lifecycle state; never mutate it.
---

# Codepatrol Status

Act as the read-only Dispatcher in [ROLES.md](../_shared/ROLES.md).
Follow the portable [execution protocol](../_shared/EXECUTION.md) when inspection is delegated.

Run `scripts/render-kanban.mjs --workspace "$PWD" --format markdown`. Add
`--all` only when the user asks for terminal Changes; add `--as-of <ISO>` only
when the user explicitly wants active intervals advanced to that time.

Reproduce the script output verbatim. Do not construct, reorder, embellish or
repair the table manually. Each row is one work id; columns are Work, Branch,
Plan, Review, Apply, Verify, Close and Total. Stage cells include attempt,
result/state, tokens with measured-run coverage and elapsed time. Close shows
commit or rollback; Total distinguishes summed active time from cycle time.

After the table, repeat each projected `nextAction` exactly. If there are no
rows, say the active board is empty and offer `codepatrol-plan` for new work.
Never select by recency, invoke another lifecycle skill or mutate files/refs.
