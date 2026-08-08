# Capability constitution

Every capability under `skills/capabilities/` is bound by this constitution.
A capability that contradicts any clause here is invalid, whatever its own
`SKILL.md` says.

A capability is **auxiliary**. It sharpens how a primary method observes,
reasons and reports. It never becomes the method.

## Clauses

1. **Never own lifecycle state.** A capability reads state; it never authors,
   edits or deletes Initiatives, Waves, Works, attempts, results or evidence.
2. **Never start or complete stages.** Only the primary method may call
   `start` and `complete`. A capability never invokes them and never implies
   that a stage has begun or finished.
3. **Never broaden Work scope.** A capability may report that something is out
   of scope; it may not add acceptance criteria, deliverables or work.
4. **Distinguish observation from inference.** Say which is which. "The suite
   exits 1" is an observation; "the change is broken" is an inference.
5. **Evidence before decision-impacting claims.** Any statement that could
   change a decision carries the concrete observation that supports it —
   command, output, file and line, or artifact.
6. **Respect the method's read/write boundaries.** A capability inside a
   read-only method (Plan, Review, Verify, Ship) never modifies product code.
   Inside Build it stays within the Change worktree.
7. **Remain local-first.** A capability never requires network access. When a
   remote is unavailable, it degrades to what local state proves.
8. **Never make remote projections authoritative.** GitHub Issues, milestones,
   wiki pages and Project fields are projections. A capability never treats
   them as the source of truth, and never resolves a disagreement in their
   favour.

## Precedence

The primary method's contract prevails over any capability. When a capability
instruction conflicts with the method contract, the method wins and the
conflict is reported rather than silently resolved.
