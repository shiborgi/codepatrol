---
name: solution-simplification
description: (codepatrol) Choose the minimum sufficient solution after understanding the real behavior and flow. Use while designing a proposal or improvement, writing a plan, reviewing artifacts or changes, and executing a task to avoid unnecessary code, dependencies, files, configuration, and abstractions without weakening safety or acceptance criteria.
---

# Solution Simplification

Minimize owned complexity, not understanding or correctness. Produce a `Simplicity Decision` that another harness can verify.

## Understand before simplifying

Bind the exact acceptance criteria, affected flow, callers, invariants, trust seams, existing modules, installed dependencies, and project constraints. Read and trace the real path before choosing a solution. A small change at the wrong seam is not simple; it is an incomplete change.

For a bug, locate the shared cause and all relevant callers. Prefer one correction at the deepest shared seam over repeated symptom guards when evidence proves the cause is common.

## Walk the sufficiency ladder

Stop at the first rung that satisfies every current acceptance criterion and safety floor:

1. **Does this need to exist?** Remove, defer, or narrow behavior that has no current accepted outcome.
2. **Already exists in this codebase?** Reuse or deepen the existing module, helper, type, pattern, or configuration.
3. **Standard library or language runtime?** Prefer its maintained primitive over owned implementation.
4. **Native platform capability?** Use the browser, database, operating system, framework, protocol, or deployment platform when it supplies the behavior correctly.
5. **Installed dependency?** Reuse it when it already owns the problem and does not distort the local interface. Do not add a new dependency for a small stable behavior.
6. **Direct local change or single expression?** Implement at the existing seam without scaffolding a speculative module.
7. **Minimum new implementation?** Add only the irreducible module/interface required by current outcomes, with no options or extension points lacking a caller.

If two rungs work, choose the earlier rung. Move lower only with verified evidence that every earlier rung fails a current criterion, invariant, or constraint. Apply [codebase-design](../codebase-design/SKILL.md) to irreducible complexity: the result should be a deep module, not pass-through layering.

## Preserve the safety floor

Never simplify away:

- validation at trust seams;
- error handling that prevents data loss or corrupt state;
- security, privacy, authorization, and audit requirements;
- accessibility and compatibility required by the target users;
- reliability, cancellation, calibration, rollback, and operability when the environment makes them material;
- explicit acceptance criteria and the risk-based checks required by [verification-strategy](../verification-strategy/SKILL.md).

A shorter unsafe or unverifiable solution is invalid. Simplify redundant verification setup, not coverage needed to falsify behavior and risk.

## Produce a Simplicity Decision

Record:

- acceptance criteria and comprehension evidence;
- selected ladder rung and native solution;
- each earlier rung considered and why it cannot satisfy the contract;
- irreducible complexity hidden behind the selected interface;
- safety-floor requirements retained;
- expected surface delta: files, dependencies, public interfaces, configuration, and runtime state added/removed;
- any deferred constraint with stable id, chosen simplification, known ceiling, observable trigger, and upgrade path.

A deferred constraint without both a trigger and upgrade path is an unowned risk, not a valid simplification. Store durable constraints in `spec.md`; create a `deferred` workflow item only when it improves later discovery. Do not create a separate comment protocol or debt store.

## Review excess complexity

When assessing a design, plan, diff, or repository candidate, classify each verified simplicity finding:

- `remove` — no accepted behavior needs it;
- `reuse` — local functionality already owns it;
- `built-in` — the language/runtime/platform already owns it;
- `speculative` — abstraction, option, dependency, configuration, or indirection has no current caller;
- `simplify` — the same contract has a smaller, clearer implementation.

Each finding names the exact location, removable surface, replacement, safety check, and acceptance impact. If nothing can be removed without weakening the contract, say the solution is already sufficient.

Report actual surface delta only. The result must not report savings in lines, cost, tokens, or time for a live project without a controlled baseline; the unbuilt alternative is not measured evidence.

_Concepts adapted from [Ponytail v4.8.4 (commit `bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324`)](https://github.com/DietrichGebert/ponytail/tree/bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324) into Codepatrol's artifact and workflow model; no dependency or integration._
