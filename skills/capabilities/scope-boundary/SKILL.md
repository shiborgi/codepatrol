---
name: scope-boundary
description: Keep Plan and Build within the declared Work scope. Distinguish enabling fixes from new scope, and report adjacent work without executing it.
---

# Scope Boundary

Bound by `skills/capabilities/CONSTITUTION.md`. The primary method contract
prevails over anything here.

## Purpose

Clause 3 of the constitution prohibits scope expansion. Plan may discover
adjacent problems; Build may find pre-existing bugs that block delivery.
Neither is authorised to address them inside the current Work. This
capability teaches how to recognise scope expansion, distinguish an
enabling fix from new scope, and report adjacent work without executing it.

## Applicable methods

`plan` and `build`. Plan discovers the Work boundary during analysis;
Build encounters it during implementation.

## Observable inputs

- the Work definition (title, description, acceptance criteria, blockedBy)
- the Initiative intent and its other Works
- the Plan result and the Plan's scope claims
- the diff the Build candidate carries against the base commit

## Procedure

1. **At Plan time.** Before declaring the Plan decision-complete, read the
   Work description and every acceptance criterion. If the Plan proposes
   any change not traceable to at least one criterion, it is scope
   expansion. Re-scope the Plan (remove the excess) or return to Spec
   for a redefinition.

2. **At Build time.** Before committing a change, map it to a specific
   acceptance criterion. Changes justified by "while I'm here" or "this
   would be better" are scope expansion. Changes required to make the
   committed change compile, pass tests, or not break existing invariants
   are enabling fixes and are allowed — but must be the smallest possible
   change that unblocks the delivery.

3. **Reporting adjacent work.** When Plan or Build discovers a problem
   outside the current scope, record it in the attempt todo with a note
   describing what and where, and explicitly state "out of scope — not
   implemented." Never implement it. The recorded note becomes discoverable
   by `codepatrol improve inspect` and can seed a future Initiative.

## Distinguishing enabling fixes from new scope

| Change | Classification | Action |
|--------|---------------|--------|
| Fix a broken import that blocks compilation | Enabling fix | Allowed |
| Add a missing type annotation to satisfy strict mode | Enabling fix | Allowed |
| Refactor a function "while I'm here" | New scope | Forbidden — record, don't implement |
| Add a feature not demanded by any criterion | New scope | Forbidden — record, don't implement |
| Update a dependency to fix a known vulnerability | New scope | Forbidden — record, propose a separate Work |

## Evidence format

Per scope decision, in one line: the change, which criterion it serves, and
the classification.

```
renamed getCwd → getCurrentWorkingDirectory — criterion 2 (consistency) — enabled fix
added dark-mode CSS — no criterion demands this — new scope, recorded but not implemented
fixed broken import in src/foo.ts — criterion 1 passes after fix — enabling fix
```

## Limits and prohibitions

- Never commit a change not demanded by an acceptance criterion unless it
  is strictly required to make the demanded change work.
- Never expand a Work's blockedBy list from Build (that is Plan's scope).
- Never modify an unrelated module "while you're passing through."
- Never silently absorb adjacent work into the current Work — record it
  explicitly or don't touch it.

## When evidence is insufficient

When unsure whether a change is enabling or new scope, record the dilemma
in the todo with both arguments and mark the change as deferred. Do not
commit it hoping for forgiveness later. An uncertain change recorded is
better than a certain violation committed.
