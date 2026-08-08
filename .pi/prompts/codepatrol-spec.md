---
description: Run the CodePatrol Spec stage for an Initiative
argument-hint: <initiative-id>
---

Read and follow the shared contract in `skills/codepatrol-spec/SKILL.md` in full.

User arguments: $ARGUMENTS

The first argument is the Initiative ID (for example, INIT-1). Use the
CodePatrol CLI exclusively for start, validate, and complete.

Capture the runId returned by spec start and use the same runId for spec complete.

## Capability contract

When the command uses `--profile <name>`, the declared composition for **this**
method is recorded on the attempt. Before execution:

1. this primary method contract is mandatory and takes precedence over every capability;
2. capabilities are auxiliary and never replace the primary contract;
3. load the `SKILL.md` for every capability declared for **this** method in
   `skills/profiles/<name>.json` under `methods.<method>`;
4. do not load capabilities for other methods;
5. when instructions conflict, the primary method wins.

Do not edit refs/codepatrol/state manually.
