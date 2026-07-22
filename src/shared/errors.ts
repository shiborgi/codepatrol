export type ErrorCode =
	| "INVALID_ARGUMENT"
	| "INVALID_WORKSPACE"
	| "GRAPH_NOT_FOUND"
	| "STATE_INCOMPATIBLE"
	| "WIKI_INVALID"
	| "ARTIFACT_INVALID"
	| "CHANGE_INVALID"
	| "CHANGE_DRIFT"
	| "CHANGE_CONFLICT"
	| "CHANGE_NOT_FOUND"
	| "TARGET_ADVANCED"
	| "WORKFLOW_NOT_FOUND"
	| "WORKFLOW_INVALID"
	| "WORKFLOW_CONFLICT"
	| "LOCK_TIMEOUT"
	| "OPERATION_FAILED"
	| "CANCELLED";

export class CodepatrolError extends Error {
	constructor(
		readonly code: ErrorCode,
		message: string,
		readonly exitCode: 2 | 3 | 4 | 5 | 130,
		readonly retryable = false,
		readonly details?: unknown,
	) {
		super(message);
		this.name = "CodepatrolError";
	}
}

export function operationalError(error: unknown): CodepatrolError {
	if (error instanceof CodepatrolError) return error;
	if (error instanceof Error && error.name === "AbortError") {
		return new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
	}
	const message = error instanceof Error ? error.message : String(error);
	return new CodepatrolError("OPERATION_FAILED", message, 5, true);
}
