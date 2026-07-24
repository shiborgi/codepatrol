# Apply Journal — Minor improvements, token count logic, actor tracking, and legacy cleanup

## Execution

- **T1**: Renamed `tokens` to `characters` throughout `src/change/types.ts` and `src/change/usage.ts`. Fixed string formatting in `src/change/board.ts` to output `~c` instead of `~t`.
- **T2**: Renamed `tokens:` to `characters:` across all test mocks in `change.test.ts`, `git.test.ts`, `board.test.ts` and `src/change/fixtures/*.yaml`.
- **T3**: Implemented backward compatibility inside `src/change/orchestrator.ts:recordFromYaml` by mutating `.tokens` to `.characters` directly before parsing.
- **T4**: Modified `.pi/index.ts` and its tests to sum up actual string length (`String(message.content || "").length`) instead of relying on token API returns. Injected the actor with `active.usage.model`.
- **T5**: Removed the `workflow prime` test case entirely from `src/cli/cli.test.ts`.

All tests pass perfectly via `npm run test` and `npm run typecheck`.

## Assessment

The token conversion avoids polluting the exact measurement logic while remaining compatible. The legacy CLI check is gone. 
