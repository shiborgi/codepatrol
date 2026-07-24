export const STAGES = ["plan", "review", "apply", "verify", "close"] as const;
export type Stage = typeof STAGES[number];
export type TerminalOutcome = "committed" | "rolled-back";

export type CharacterUsage =
	| { status: "measured"; source: "provider" | "harness"; input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; total: number; model?: string; harness?: string }
	| { status: "unavailable"; reason: string; model?: string; harness?: string };

export interface RunUsage { id: string; started_at: string; finished_at?: string; elapsed_ms?: number; characters: CharacterUsage }
export interface ArtifactBinding { path: string; sha256: string; intent?: "create" | "modify" | "delete" }

interface EventBase { id: string; type: string; at: string; actor: string; stage: Stage; attempt: number }
export interface ChangeStartedEvent extends EventBase { type: "change-started"; stage: "plan"; attempt: 1; next_action: string }
export interface StageBeganEvent extends EventBase { type: "stage-began"; next_action: string }
export interface RunRecordedEvent extends EventBase { type: "run-recorded"; run: RunUsage }
export interface StageCheckpointedEvent extends EventBase { type: "stage-checkpointed"; result: "ready" | "approve" | "implemented" | "commit"; checkpoint: string; tree?: string; artifacts: ArtifactBinding[]; changes?: string[]; next_action: string }
export interface StageReturnedEvent extends EventBase { type: "stage-returned"; to_stage: "plan" | "apply"; reason: string; next_action: string }
export interface StageBlockedEvent extends EventBase { type: "stage-blocked"; reason: string; next_action: string }
export interface StageResumedEvent extends EventBase { type: "stage-resumed"; next_action: string }
export interface ChangeClosedEvent extends EventBase { type: "change-closed"; stage: "close"; outcome: TerminalOutcome; commit: string; tag: string; receipt: string }
export type ChangeEvent = ChangeStartedEvent | StageBeganEvent | RunRecordedEvent | StageCheckpointedEvent | StageReturnedEvent | StageBlockedEvent | StageResumedEvent | ChangeClosedEvent;

export interface ChangeIdentity { work_id: string; title: string; created_at: string; branch: string; target_branch: string; base_commit: string }
export interface ChangeRecordV2 { schema_version: 2; identity: ChangeIdentity; events: ChangeEvent[] }
export interface StageAttempt { attempt: number; status: "ready" | "active" | "blocked" | "completed" | "returned" | "invalidated"; result?: string; runs: RunUsage[]; checkpoint?: string; tree?: string; artifacts: ArtifactBinding[]; changes?: string[] }
export interface UsageSummary { activeMs: number; characters: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; total: number; measuredRuns: number; totalRuns: number; coverage: string; complete: boolean } }
export interface ChangeView {
	identity: ChangeIdentity;
	stage: Stage;
	attempt: number;
	state: "ready" | "active" | "blocked" | "terminal";
	nextAction?: string;
	revision: number;
	checkpoint?: string;
	outcome?: TerminalOutcome;
	terminalCommit?: string;
	attempts: Record<Stage, StageAttempt[]>;
	usage: UsageSummary;
	cycleMs?: number;
}

export type TransitionIntent =
	| { type: "begin"; actor: string; stage: Stage; nextAction: string }
	| { type: "usage"; actor: string; stage: Stage; run: RunUsage }
	| { type: "checkpoint"; actor: string; stage: Exclude<Stage, "close">; result: StageCheckpointedEvent["result"]; artifacts: ArtifactBinding[]; changes?: string[]; nextAction: string }
	| { type: "return"; actor: string; stage: "review" | "apply" | "verify"; toStage: "plan" | "apply"; reason: string; nextAction: string }
	| { type: "block"; actor: string; stage: Stage; reason: string; nextAction: string }
	| { type: "resume"; actor: string; stage: Stage; nextAction: string };
export interface StartChangeInput { workId: string; title: string; targetBranch: string; actor: string; nextAction?: string }
export interface ChangeQuery { workId?: string; all?: boolean }
export interface CloseInput { outcome: "commit" | "rollback"; actor: string; authority: string }
export interface CloseResult { outcome: TerminalOutcome; workId: string; targetBranch: string; terminalCommit: string; tag: string }
export interface OperationOptions { signal?: AbortSignal; now?: Date; git?: import("./git.js").GitAdapter }
