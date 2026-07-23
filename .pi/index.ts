import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CodepatrolError } from "../src/shared/errors.js";
import { transitionChange } from "../src/change/orchestrator.js";
import type { RunUsage, Stage, TransitionIntent } from "../src/change/types.js";

interface CommandSpec {
	name: string;
	skill: string;
	description: string;
}

const COMMANDS: CommandSpec[] = [
	{ name: "codepatrol-plan", skill: "codepatrol-plan", description: "Start or resume one branch-backed Change Plan" },
	{ name: "codepatrol-review", skill: "codepatrol-review", description: "Review an explicit Change Plan" },
	{ name: "codepatrol-apply", skill: "codepatrol-apply", description: "Implement an approved Change" },
	{ name: "codepatrol-verify", skill: "codepatrol-verify", description: "Independently verify a Change candidate" },
	{ name: "codepatrol-close", skill: "codepatrol-close", description: "Commit or roll back a verified Change" },
	{ name: "codepatrol-status", skill: "codepatrol-status", description: "Render the deterministic Change Kanban" },
];

const STAGE_BY_COMMAND: Record<string, Stage | undefined> = {
	"codepatrol-plan": "plan", "codepatrol-review": "review", "codepatrol-apply": "apply", "codepatrol-verify": "verify", "codepatrol-close": "close",
};

export function sumPiUsage(messages: unknown[]): { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; total: number; model?: string } {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, model: undefined as string | undefined };
	for (const value of messages) {
		const message = value as { role?: string; model?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; totalTokens?: number } };
		if (message.role !== "assistant" || !message.usage) continue;
		total.input += message.usage.input ?? 0; total.output += message.usage.output ?? 0; total.cacheRead += message.usage.cacheRead ?? 0; total.cacheWrite += message.usage.cacheWrite ?? 0; total.reasoning += message.usage.reasoning ?? 0; total.total += message.usage.totalTokens ?? 0; total.model = message.model ?? total.model;
	}
	return total;
}

export function kickoff(skill: string, args: string, runId?: string): string {
	const lines = [
		`Use the Agent Skill \`${skill}\` for this request.`,
		"Follow its portable sequential fallback because Pi does not provide native delegation.",
		args ? `User input: ${args}` : "If essential intent is missing, ask one focused question before continuing.",
	];
	if (runId) lines.push(`Before sealing the stage or invoking Close, call \`codepatrol_record_run\` exactly once for the work id. It owns run \`${runId}\`; do not submit a separate usage transition.`);
	return lines.join("\n");
}

interface PiExtensionDependencies {
	now?: () => number;
	transition?: typeof transitionChange;
}

interface ActivePiRun {
	workId?: string;
	stage: Stage;
	startedAt: number;
	cwd: string;
	runId: string;
	usage: ReturnType<typeof sumPiUsage>;
	result?: { run: RunUsage; view: unknown };
	recording?: Promise<{ run: RunUsage; view: unknown }>;
}

function addUsage(target: ReturnType<typeof sumPiUsage>, delta: ReturnType<typeof sumPiUsage>): void {
	target.input += delta.input; target.output += delta.output; target.cacheRead += delta.cacheRead; target.cacheWrite += delta.cacheWrite; target.reasoning += delta.reasoning; target.total += delta.total; target.model = delta.model ?? target.model;
}

export function installCodepatrolPiExtension(pi: ExtensionAPI, dependencies: PiExtensionDependencies = {}): void {
	const clock = dependencies.now ?? Date.now; const transition = dependencies.transition ?? transitionChange;
	let active: ActivePiRun | undefined;
	for (const command of COMMANDS) {
		pi.registerCommand(command.name, {
			description: command.description,
			handler: async (args, ctx) => {
				const input = args?.trim() ?? ""; const stage = STAGE_BY_COMMAND[command.name]; const workId = /\b\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\b/.exec(input)?.[0]; const startedAt = clock();
				active = stage && ctx?.cwd ? { workId, stage, startedAt, cwd: ctx.cwd, runId: `pi-${stage}-${startedAt}`, usage: sumPiUsage([]) } : undefined;
				pi.sendUserMessage(kickoff(command.skill, input, active?.runId), { deliverAs: "followUp" });
			},
		});
	}
	pi.on("message_end", (event) => { if (active) addUsage(active.usage, sumPiUsage([event.message])); });
	pi.registerTool({
		name: "codepatrol_record_run",
		label: "Record Codepatrol run",
		description: "Record the one authoritative Pi token/time envelope for the active Codepatrol stage before checkpoint or Close.",
		parameters: { type: "object", properties: { workId: { type: "string", description: "Explicit Codepatrol work id" } }, required: ["workId"], additionalProperties: false },
		executionMode: "sequential",
		execute: async (_toolCallId: string, params: { workId: string }, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) => {
			if (!active) throw new CodepatrolError("CHANGE_CONFLICT", "No active Codepatrol Pi run is available.", 4);
			if (active.cwd !== ctx.cwd) throw new CodepatrolError("CHANGE_CONFLICT", `Active Codepatrol run belongs to ${active.cwd}, not ${ctx.cwd}.`, 4);
			if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(params.workId) || (active.workId && active.workId !== params.workId)) throw new CodepatrolError("CHANGE_CONFLICT", "Recorder work id does not match the active Codepatrol command.", 4);
			if (!active.recording) {
				const finishedAt = clock(); const tokens = active.usage.total > 0
					? { status: "measured" as const, source: "provider" as const, input: active.usage.input, output: active.usage.output, cacheRead: active.usage.cacheRead, cacheWrite: active.usage.cacheWrite, reasoning: active.usage.reasoning, total: active.usage.total, harness: "pi", ...(active.usage.model ? { model: active.usage.model } : {}) }
					: { status: "unavailable" as const, reason: "Pi exposed no authoritative provider usage for this run.", harness: "pi" };
				const run: RunUsage = { id: active.runId, started_at: new Date(active.startedAt).toISOString(), finished_at: new Date(finishedAt).toISOString(), elapsed_ms: Math.max(0, finishedAt - active.startedAt), tokens };
				const intent: TransitionIntent = { type: "usage", actor: "pi", stage: active.stage, run };
				active.recording = transition(active.cwd, params.workId, intent, { signal }).then((view) => ({ run, view }));
			}
			active.result = await active.recording;
			return { content: [{ type: "text" as const, text: `Recorded ${active.result.run.id}.` }], details: active.result };
		},
	} as never);
}

export default function codepatrolPiExtension(pi: ExtensionAPI): void {
	installCodepatrolPiExtension(pi);
}
