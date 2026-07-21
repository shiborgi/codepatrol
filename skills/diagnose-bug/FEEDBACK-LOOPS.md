# Feedback loop catalog

The loop is the instrument the whole diagnosis plays through: a single command whose red/green answers "is the bug still there?". Build it before reading suspect code. Pick the cheapest option that can catch this bug — ranked, best first:

1. **Failing test at the relevant seam** — unit, integration, or e2e, whichever seam the bug actually crosses. Best because it later *becomes* the regression test.
2. **HTTP script against a running dev server** — `curl`/fetch script with a fixed request and an assertion on the response.
3. **CLI invocation with fixture input** — run the binary on a checked-in fixture, compare against expected output.
4. **Headless browser script** — when the bug lives in real browser behaviour, drive it scripted rather than by hand.
5. **Replay a captured trace in isolation** — feed a recorded input (request log, JSONL transcript, event stream) through the component alone.
6. **Throwaway harness** — a small script that imports the suspect module and exercises the path directly. Delete it in cleanup, or promote it into a real test deliberately.
7. **Property/fuzz loop** — for bugs that need the "right" input: generate inputs until one fails, then freeze that input as the repro.
8. **Bisection harness** — regression between two known states (git): a script `git bisect run` can call. Turns "somewhere in N commits" into "this commit".
9. **Differential loop** — run two versions/configs side by side and diff outputs; the bug is where they diverge.
10. **Human-in-the-loop script** — last resort when only a human can observe the failure (visual glitch, hardware): a script that sets everything up, tells the user exactly what to check, and takes a y/n. Slow — climb back up this list as soon as you learn enough.

## Tightening the loop

Optimize the three qualities in order of pain:

- **Speed** — seconds, not minutes. Cut startup: run one test file not the suite, use a smaller fixture, skip unrelated services. A loop you hesitate to run is a loop you'll stop running.
- **Signal** — the loop's output must say red or green at a glance: exit code, or one grep-able line. No reading walls of logs per run.
- **Determinism** — same input, same verdict. Pin time, seed randomness, fake the network edge (outermost edge only — a stub server beats mocking your own client wrapper).

## Flaky bugs — raise the reproduction rate first

Debugging at 1-in-50 reproduction wastes every probe. Before hypothesizing, get it to most-runs-red:

- **Loop it**: run the repro N times in one command; red if any iteration fails (`for i in $(seq 50); do cmd || exit 1; done`).
- **Stress it**: shrink timeouts, add load, run tasks in parallel — race conditions widen under pressure.
- **Trap it**: if it only fails "sometimes, somewhere", add a tagged `[DEBUG-…]` assertion at the suspected invariant and loop until it trips.

A flake that reproduces 50%+ of runs is debuggable; keep tightening until then. (This package's own turn-budget test flaked at ~25% until isolated runs made it 100% — isolation itself is a tightening move.)
