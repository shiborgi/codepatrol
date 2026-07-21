---
name: codepatrol-status
description: (codepatrol) Summarize open Codepatrol workflows and artifact packages, then help the user resume existing work with explicit identifiers or start a new package. This skill never mutates project state.
---

# Codepatrol Status

Show what work is open and route the user to the right primary workflow. Act as the **Dispatcher** defined in [ROLES.md](../_shared/ROLES.md): remain read-only, present lifecycle provenance, and never mutate project state.

Follow the [workflow memory contract](../_shared/WORKFLOW.md), the [portable execution protocol](../_shared/EXECUTION.md), and use the [Codepatrol CLI](../_shared/CODEPATROL-CLI.md). The summary runs in the main conversation; no delegation is needed for two read-only queries.

## Summarize open work

Run:

```bash
codepatrol status --workspace "$PWD" --format json
```

The summary lists open workflow roots from the ledger and non-`implemented` artifact packages from `docs/codepatrol/`, correlated by `workflow_id`. Use `--all` to include closed workflows and implemented packages.

## Present and route

Transform the result into a Kanban-style table with **one row per workflow/package** and the following columns: **Plan**, **Review**, **Apply**, **Verify**. Include the workflow title or work id and revision. A completed cell shows `harness · model · date` from `steps.<step>` (omit the model when absent); the current actionable cell is prefixed with `▶`; an absent or pending cell is `—`.

For legacy packages without `steps`, use `approval.reviewer`/`approval.reviewed_at` for Review and `verification.verifier`/`verification.verified_at` for Verify, and render completed Plan/Apply cells as `✓` without provenance. A ledger-only workflow has `▶` in Plan and `—` in the other cells. Keep the status-to-step routing below as the definition of the current cell. For example:

```text
| Workflow | Plan | Review | Apply | Verify |
|---|---|---|---|---|
| 2026-07-20-example (rev 3) | claude · fable-5 · 07-20 | pi · m3 · 07-20 | ▶ codex · gpt-5.4 · started | — |
```

- `draft` or `changes-requested` package → **Plan** column. Resume with `codepatrol-plan` (passing the work id). For older packages in the workspace whose origin skill was `codepatrol-scan`, status routing maps them to `codepatrol-plan` as well.
- `ready-for-review` package → **Review** column. Resume with `codepatrol-review` on that work id.
- `approved`, `implementing`, or `blocked` package → **Apply** column. Resume with `codepatrol-apply` on that work id.
- `implemented` packages awaiting verification → **Verify** column. Resume with `codepatrol-verify` on that work id.
- Ledger workflow without a package → Place in **Plan** and resume it by passing its `workflow_id` to `workflow prime` inside the matching primary workflow.

Ask the user to pick one open item explicitly from the Kanban board, or to start new work. Never select by recency alone. When the summary is empty, say so and route to the primary workflow matching the user's intent.
