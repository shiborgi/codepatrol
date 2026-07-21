---
name: diagnose-bug
description: (codepatrol) Systematically diagnose a bug or regression, prove its root cause with a red-capable feedback loop, and return correction and regression-test constraints to codepatrol-plan without editing production code.
---

# Diagnose Bug

Find and prove the root cause, then define the minimum correction contract. Implementation belongs to an approved `codepatrol-apply` package.

## The iron law

**No fix before root-cause investigation.** A symptom fix is a failure even when it makes the error disappear. Every one of these thoughts means stop and return to the process:

- "Quick fix for now, investigate later"
- "Just try changing X and see"
- "It's probably X, let me fix that"
- "Add a few changes at once, run the tests"
- "I don't fully understand this, but it might work"

Emergencies don't suspend the law — systematic is *faster* than guess-and-check thrashing, especially under pressure. Simple-looking bugs have root causes too.

Use the [Codepatrol CLI](../_shared/CODEPATROL-CLI.md) for graph evidence, [EXECUTION.md](../_shared/EXECUTION.md) for portable coordination, and [WORKFLOW.md](../_shared/WORKFLOW.md) for hypotheses, evidence, blockers, and resumable next actions.

## Process

### 1. Feedback loop

Before reading a line of suspect code, build a tight pass/fail signal that goes red on *this* bug. With a loop, you will find the cause; without one, you're guessing. Pick the cheapest loop that can catch the bug — [FEEDBACK-LOOPS.md](FEEDBACK-LOOPS.md) ranks the options and the tightening tricks for flaky repros.

A loop is done when it is **red-capable** (catches this specific bug), **deterministic** (same result every run), **fast** (seconds), and **agent-runnable** (you can run it unattended). This phase ends when you can name the one command that runs the loop and you have already run it and seen it red.

### 2. Reproduce and minimize

Run the loop; confirm the failure matches what the user reported — not an adjacent bug that happens to be red too. Then shrink: remove one element of the repro at a time and re-run, until every remaining piece is load-bearing (removing any one makes it pass). The minimized repro is the raw material for both the hypotheses and the regression test.

Non-deterministic? Don't debug at 1-in-50 — tighten first (loop N times, stress, parallelize) until it reproduces most runs, per [FEEDBACK-LOOPS.md](FEEDBACK-LOOPS.md).

### 3. Localize

Read the full error and stack trace before anything else — every line, file path, and code; they often name the answer. Then work the evidence, graph-first:

- **Recent changes** (if git): inspect log/diff and run `codepatrol graph impact --since-ref <ref> --format json`. A regression's cause is usually inside that set.
- **Trace backward**: run `codepatrol graph neighbors --symbol <name> --format json` and walk callers to the bad value's origin. Confirm ambiguous edges by reading.
- **Mental model first**: read the module's `docs/wiki/` page and `CONTEXT.md` terms before its code, when they exist. ADRs may explain why the code is the strange way it is.
- **Pattern comparison**: find similar *working* code in the codebase (`codepatrol graph find`) and list every difference against the broken path — however small; "that can't matter" is how causes hide.

Define one read-only unit per independent lead: recent-change set, data-flow chain, and working-vs-broken comparison. Delegate in parallel when available, otherwise investigate sequentially. Every unit receives the symptom, minimized repro, its single lead, and the verified `file:line` contract. Wait at the barrier; the coordinator keeps the verdict.

### 4. Hypothesize and probe

Write down 3–5 ranked hypotheses **before testing any**. Each must be falsifiable with a stated prediction: "if X is the cause, then changing Y makes the loop pass / makes it fail twice as often." Show the user the ranked list — they hold domain knowledge that reorders it cheaply.

Then probe, top hypothesis first, one variable at a time:

- Prefer inspecting state (debugger, REPL, one targeted assertion) over print-scatter. Never "log everything and grep".
- Tag every temporary probe with a unique prefix (`[DEBUG-4f2a]`) so cleanup is one grep.
- A probe answers exactly one prediction. Ambiguous answer → tighten the probe, don't stack another change on top.
- Hypothesis falsified → cross it off, move to the next. All falsified → the list was wrong; return to Localize with what the probes taught you. Don't invent fix attempts "to see what happens".

### 5. Define the correction contract

Follow [verification-strategy](../verification-strategy/SKILL.md) to turn the minimized reproduction into a proposed regression test at the correct public seam. Name the exact setup, red signal, interface exercised, minimum behavior change, affected checks, and cleanup. Do not add the test or fix here.

Specify one root-cause correction with no bundled refactor or “while here” cleanup. Use `codepatrol graph impact` on the proposed files to list the tests and consumers the implementation plan must cover. If no stable seam can exercise the real pattern without internal contortion, record that as an architectural finding.

When three or more well-formed correction hypotheses fail under probing, stop treating the issue as local. Return to `codepatrol-plan` architecture mode with the full diagnosis; do not keep guessing.

### 6. Clean up and hand off

Remove every temporary `[DEBUG-…]` probe and throwaway runtime harness. The target project checkout must retain no diagnostic code change.

Return the symptom, minimized reproduction, proven root cause, rejected hypotheses, exact evidence, correction constraints, regression strategy, affected checks, confidence, and limitations. `codepatrol-plan` stores this in package evidence and normalizes it into `spec.md` and `plan.md`.

If the cause is genuinely environmental after a complete investigation, document what was ruled out and specify proposed handling and monitoring. Do not disguise an incomplete causal chain as an environmental result.

_Concepts from [superpowers](https://github.com/obra/superpowers) (systematic-debugging) and [mattpocock/skills](https://github.com/mattpocock/skills) (diagnosing-bugs); no dependency on either. Rebuilt around this package's graph, scout, and TDD machinery._
