# Problems

A problem record is the durable, citable statement of something that is
failing. Evolution Review may not propose an Initiative that is not traced to
a record in this directory, and no evidence becomes authoritative by being
remote: a GitHub Issue used as evidence has its full body reproduced here.

One problem per file, named `NNN-short-slug.md` with a zero-padded sequential
number. A record is never deleted; when a problem is resolved, its status
changes and the resolution names what closed it.

## Record format

```markdown
# NNN — Title

- **Status:** open | resolved | withdrawn
- **First observed:** YYYY-MM-DD
- **Evidence:** improve-report numbers, `file.ts:line` references, or the full
  reproduced body of an external report
- **Resolved by:** WORK-<id> (only when status is resolved)

## Observation

What was observed, stated without interpretation.

## Why it is a problem

Which guarantee, invariant, or declared behaviour it breaks.

## What would falsify this

The observation that would show the problem does not exist or no longer does.
```

Evidence is quoted, not paraphrased. A record that cannot name a number or a
file and line is not a problem record yet — it is a suspicion.
