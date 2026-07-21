---
name: grilling
description: (codepatrol) Use when the user picks an architecture-review candidate to explore, wants a plan or design stress-tested, or says "grill me" / "grill this". A relentless one-question-at-a-time interview that walks the decision tree until the design is settled.
---

# Grilling

Stress-test a plan, decision, or design by interviewing the user through its decision tree — one question at a time, until every load-bearing decision is settled and both of you would state the design the same way.

Resume and record settled decisions through [WORKFLOW.md](../_shared/WORKFLOW.md). Do not treat the interview order as fixed phases; follow the actual decision dependencies.

**Do not implement anything until the design is settled and the user has confirmed it.** Grilling produces decisions, not code.

## The decision tree

A design is a tree of decisions where some depend on others. Walk it in dependency order — settle the decisions that others hang on first:

1. **Constraints** — what is fixed and non-negotiable? (Runtime, compatibility, existing ADRs, deadlines.) Everything else bends around these.
2. **Dependencies** — what does the thing under discussion depend on, and what depends on it? Use `codepatrol graph impact --file <path> --format json` and graph neighbors for evidence — run them, don't ask.
3. **The shape** — what is the module's interface: operations, inputs, invariants, error modes? This is where depth is won or lost.
4. **The seam** — where does the interface live, and what sits behind it? What varies across it today (one adapter = hypothetical seam, two = real — [codebase-design](../codebase-design/SKILL.md))?
5. **The tests** — which existing tests survive unchanged, which move to the new interface, which die with the old shape? `codepatrol graph impact` lists the affected tests.

Don't march through this list mechanically — follow the actual dependencies. If an answer invalidates an earlier decision, go back and re-settle it.

## How to ask

- **One question per message.** Never bundle. If a topic needs three questions, that's three messages.
- **Offer a recommended answer with every question**, with one line of reasoning. "Which error mode should `parse` have — throw, or return a result? I'd recommend a result type: callers already pattern-match on the sibling module." The user should be able to answer most questions with "yes".
- **Research facts yourself; ask only about decisions.** "How many callers does this have?" is a `codepatrol graph neighbors` call, not a question. "Which of these callers should keep working unchanged?" is a decision — ask it.
- **Bring evidence to the question.** When a decision touches callers or tests, run `codepatrol graph impact` on the candidate's files first and put the numbers in the question: "This seam has 7 callers and 3 test files — should the new interface keep the old call shape as a deprecated overload, or migrate all 7 now? I'd migrate: the shapes differ in one parameter."
- **Chase vagueness.** "Probably", "we could", "something like" are unsettled decisions wearing a disguise. Ask the follow-up.
- **Respect settled ground.** Existing ADRs are decisions already made — don't re-litigate them unless the friction is real enough to reopen one, and say so explicitly if it is.

## Side effects while grilling

Decisions crystallise language and sometimes deserve records — follow [domain-modeling](../domain-modeling/SKILL.md) inline as you go: new or sharpened terms go into `CONTEXT.md` the moment they're settled; a rejection with a load-bearing reason gets an ADR offer (only when the three ADR criteria hold).

## Ending the grill

The grill is done when you can state the settled design in a few sentences and the user confirms it. State it, get the confirmation, then record it in the package `spec.md` decisions section (what was decided, what was rejected, and where the seam landed).

_Concepts from [mattpocock/skills](https://github.com/mattpocock/skills) (grilling skill); no dependency on it. Adapted to this package's review-candidate workflow and code-graph evidence tools._
