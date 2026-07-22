---
name: domain-modeling
description: (codepatrol) Use when pinning down domain terminology or a ubiquitous language, recording an architectural decision, or when another skill needs the domain model maintained. Builds and sharpens CONTEXT.md and docs/adr/ inline as decisions crystallise.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design: challenge terms, invent edge-case scenarios, and write the glossary and decisions down the moment they crystallise.

Use the invoking [Change](../_shared/CHANGE.md) to link a settled term or ADR to the decision that required it. Store the definition in the human-readable artifact, not duplicated in a Stage Session.

Merely *reading* `CONTEXT.md` for vocabulary is not this skill — that's a one-line habit any skill can do. This skill is for **changing** the model, not consuming it.

## File structure

Most repos have a single context:

```
/
├── CONTEXT.md                        ← the glossary
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts; the map lists each context, where it lives, and how they relate. Each context then has its own `CONTEXT.md` and optional `docs/adr/` inside its area, with root `docs/adr/` reserved for system-wide decisions. When multiple contexts exist, infer which one the current topic belongs to before editing.

**Create files lazily** — only when there is something to write. No `CONTEXT.md`? Create it when the first term is resolved. No `docs/adr/`? Create it when the first ADR is needed. Never scaffold empty structure.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with `CONTEXT.md`, call it out immediately: "Your glossary defines *cancellation* as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When a term is vague or overloaded, propose a precise canonical one: "You're saying *account* — do you mean the Customer or the User? Those are different things here."

### Stress-test with concrete scenarios

When domain relationships are on the table, invent specific edge-case scenarios that force precision about the boundaries between concepts: "A subscription is cancelled mid-billing-period — does the Invoice for that period still exist?"

### Cross-reference with code

When the user states how something works, check whether the code agrees — `codepatrol graph find` and `codepatrol graph neighbors` locate the module fast. Surface contradictions: "The code cancels entire Orders (`orders/cancel.ts:14`), but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

The moment a term is resolved, write it — don't batch. Use the format in [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md).

`CONTEXT.md` is a glossary and nothing else: no implementation details, no specs, no scratch notes. Implementation decisions go in ADRs; module vocabulary (seam, depth, adapter) stays in [codebase-design](../codebase-design/SKILL.md).

### Offer ADRs sparingly

Offer to record an ADR only when **all three** hold:

1. **Hard to reverse** — changing your mind later carries meaningful cost
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **A real trade-off** — genuine alternatives existed and one was picked for specific reasons

Any of the three missing → skip it. Trivial reversible choices, self-evident picks, and foregone conclusions don't get ADRs. Use the format in [ADR-FORMAT.md](ADR-FORMAT.md).

_Concepts from [mattpocock/skills at commit `ed37663cc5fbef691ddfecd080dff42f7e7e350d`](https://github.com/mattpocock/skills/tree/ed37663cc5fbef691ddfecd080dff42f7e7e350d) (domain-modeling skill); no dependency on it. Adapted to this package's code-graph tools._
