---
description: Run the CodePatrol Ship stage for a Work
---

Read and follow the shared contract in `skills/codepatrol-ship/SKILL.md` in full.

User arguments: $ARGUMENTS

The first argument is the Work ID (for example, WORK-1.1.1). Follow the skill
contract: `codepatrol ship start --work <work-id> --todo <todo.json>` (clean
checkout and HEAD equal to the verified candidate), inspect the candidate and
Verify evidence without changing anything, then complete with `codepatrol ship complete --work <work-id> --run <run-id> --result <result.json>`.

Present evidence to the operator and require an explicit Accept, Rollback, or
Cancel decision before ship complete. Never infer authorization.

Ship runs Work by Work because it is the only stage that advances the shared base.

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
