---
description: (codepatrol) Review a proposal/diff/branch and record an auditable verdict
---
Load the `codepatrol-review` skill via the skill tool and execute it against the following target:

$ARGUMENTS

Follow the skill's SKILL.md exactly. Bind the review target (handoff package or diff/branch), validate incoming hashes, analyze on contract and evidence axes, record findings and verdict in `review.md`, and never edit production code. Return `merge`, `fix-first`, or `rework`.