# ADR format

Architectural Decision Records live in `docs/adr/`, named sequentially: `0001-short-slug.md`, `0002-short-slug.md`. Create the directory with the first ADR, not before.

The point of an ADR is to capture *that* a decision was made and *why* — so a future explorer (human or agent) doesn't re-litigate it. Format is secondary to that.

## Minimal ADR (the default)

A title plus 1–3 sentences: the context, the decision, the reason.

```markdown
# 0003 — Keep the report as plain markdown

Reviews are read in terminals and on git hosts, not in browsers. We render
`docs/codepatrol/<work-id>/evidence/analysis.md` with Mermaid fences instead of generating
HTML; a browser-opening step was rejected because it breaks headless and
remote sessions.
```

## Optional sections

Add only when they genuinely earn their space — most ADRs won't need them:

- **Status** — `superseded by 0007`, `reopened 2026-07-17`. Only when it's no longer simply "accepted".
- **Considered options** — when the rejected alternatives are non-obvious and a future reader would otherwise re-propose them.
- **Consequences** — when the decision has follow-on costs someone will hit later.

## What gets an ADR

All three criteria from [SKILL.md](SKILL.md) — hard to reverse, surprising without context, real trade-off. Typical fits: an architectural pattern choice, an integration approach, technology lock-in, a deliberate departure from the conventional path, a non-obvious rejection (the architecture review's "don't re-suggest this" case).

What doesn't: reversible trivia, self-evident choices, foregone conclusions, anything fully explained by the code itself.
