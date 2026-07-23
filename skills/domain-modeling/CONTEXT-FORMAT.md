# CONTEXT.md format

`CONTEXT.md` defines the project's domain language — the terms the team (and every skill in this package) uses when talking about the domain. It is a glossary, nothing else.

## Rules

- **One or two sentences per term**, focused on what the thing *is*. Not how it's implemented, not where it lives in the code.
- **Be opinionated.** Pick one canonical term and list the rejected synonyms under `_Avoid_` — that's what makes the glossary useful when reviewing text.
- **Project-specific concepts only.** No general programming vocabulary (that's [codebase-design](../codebase-design/SKILL.md)'s job for architecture terms), no framework terms the docs already define.
- **Group related terms under subheadings** when natural clusters exist (e.g. `## Billing`, `## Fulfilment`). Flat list until then.

## Template

```markdown
# Domain Glossary

**Order** — a customer's confirmed intent to buy, from checkout until fulfilment or cancellation. _Avoid_: purchase, transaction (a transaction is the payment event, not the intent).

**Cancellation** — the customer-initiated termination of an entire Order before shipment. Always whole-order; partial cancellation does not exist in this domain. _Avoid_: refund (a refund can happen without cancellation).

## Billing

**Invoice** — the immutable statement of what an Order cost at confirmation time. Reissued, never edited.
```

## Multiple contexts

When the repo grows more than one bounded domain, add a root `CONTEXT-MAP.md`:

```markdown
# Context Map

- **Ordering** — `src/ordering/CONTEXT.md`. Owns Order, Cancellation.
- **Billing** — `src/billing/CONTEXT.md`. Owns Invoice, Payment. An Ordering "Order" appears here only by id.
```

Each context's `CONTEXT.md` follows the same format. A term may legitimately mean different things in different contexts — the map is where that's declared, so neither glossary has to hedge.
