# OKF Wiki Page Format

Every concept is UTF-8 Markdown with YAML frontmatter and a non-empty descriptive `type`:

```markdown
---
type: Software Module
title: Orders
description: Owns order placement and lifecycle transitions.
tags: [orders]
timestamp: 2026-07-18T00:00:00Z
---

# Orders

## Purpose

What the module hides behind its interface, with verified `path:line` evidence.

## Interface

Exported operations, inputs, invariants, ordering, and error modes.

## Dependencies

- Uses [Billing](billing.md) for payment authorization.
- Used by the HTTP entry point at `src/http/orders.ts:42`.

## Tests

How behavior is exercised through the interface and which test files cover it.

# Citations

[1] [External source](https://example.com/reference)
```

Use `type: Software Architecture` for `architecture.md`, `Software Module` for module concepts, and `Reference` for supporting internal references. Types are descriptive, not a closed enum. Include `title` and one-sentence `description`; add `resource`, `tags`, and `timestamp` when meaningful. Unknown fields are allowed.

The bundle-root index is the only index with frontmatter:

```markdown
---
okf_version: "0.1"
---

# Project wiki

- [Architecture](architecture.md) - System map and key seams.
- [Orders](modules/orders.md) - Order lifecycle module.
```

Subdirectory `index.md` files have no frontmatter and contain headings plus Markdown lists. `log.md` has no frontmatter and groups newest-first entries under `## YYYY-MM-DD` headings. Both names are reserved and never represent concepts.

Use relative or bundle-relative Markdown links. Broken links are warnings, but fix them when the target should already exist. External claims use a final `# Citations` section with numbered links. Prefer facts, tables, diagrams, and verified evidence over adjectives; keep every concept useful when opened independently.
