Read and follow the shared contract in `skills/codepatrol-build/SKILL.md` in full.

User arguments: $ARGUMENTS

The first argument is the Work ID (for example, WORK-1.1.1). Follow the skill
contract: `codepatrol build start --work <work-id> --todo <todo.json>`, capture
the run ID, implement the Work, commit product changes (the checkout must be
clean), and complete with `codepatrol build complete --work <work-id> --run <run-id> --result <result.json>`.

After build start, read the Change evidence and work exclusively in the
worktree created or adopted by CodePatrol. Never implement in the base checkout.
Create candidate commits on the Change branch. Leave the worktree clean before
build complete.

To execute a complete Wave layer, pass `--wave <wave-id>` instead of `--work`.
The current dependency layer starts and completes in one transaction, with one
todo and one result per Work.

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
