import assert from "node:assert/strict";
import test from "node:test";
import codepatrolPiExtension, { installCodepatrolPiExtension, kickoff, sumPiUsage } from "./index.js";

test("Pi extension registers exactly the six canonical primary entry points", async () => {
	const commands = new Map<string, { handler: (args?: string) => Promise<void> }>();
	const messages: string[] = [];
	const pi = {
		registerCommand(name: string, command: { handler: (args?: string) => Promise<void> }) { commands.set(name, command); },
		registerTool() {},
		sendUserMessage(message: string) { messages.push(message); },
		on() {},
	} as any;
	codepatrolPiExtension(pi);
	assert.deepEqual([...commands.keys()], ["codepatrol-plan", "codepatrol-review", "codepatrol-apply", "codepatrol-verify", "codepatrol-close", "codepatrol-status"]);
	await commands.get("codepatrol-plan")!.handler("add caching");
	assert.match(messages[0], /codepatrol-plan/);
	assert.match(messages[0], /add caching/);
	assert.doesNotMatch(messages[0], /spawn_agent|subagent\(/);
});

test("Pi usage capture sums provider dimensions without storing messages", () => {
	assert.deepEqual(sumPiUsage([{ role: "assistant", model: "m", usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 1, reasoning: 1, totalTokens: 10 } }, { role: "user", content: "secret" }]), { input: 3, output: 4, cacheRead: 2, cacheWrite: 1, reasoning: 1, total: 10, model: "m" });
});

test("kickoff includes the Pi sequential fallback", () => {
	assert.match(kickoff("codepatrol-plan", ""), /sequential fallback/);
});

function piHarness() {
	const commands = new Map<string, { handler: (args: string, ctx: { cwd: string }) => Promise<void> }>();
	const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
	const handlers = new Map<string, (...args: any[]) => Promise<void> | void>();
	const messages: string[] = [];
	const pi = {
		registerCommand(name: string, command: { handler: (args: string, ctx: { cwd: string }) => Promise<void> }) { commands.set(name, command); },
		registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) { tools.set(tool.name, tool); },
		on(name: string, handler: (...args: any[]) => Promise<void> | void) { handlers.set(name, handler); },
		sendUserMessage(message: string) { messages.push(message); },
	} as any;
	return { pi, commands, tools, handlers, messages };
}

test("Pi records one measured Close run before terminal mutation and is idempotent", async () => {
	const harness = piHarness();
	const transitions: Array<{ workspace: string; workId: string; intent: any }> = [];
	let clock = 1000;
	installCodepatrolPiExtension(harness.pi, {
		now: () => clock,
		transition: async (workspace, workId, intent) => {
			transitions.push({ workspace, workId, intent });
			return { identity: { work_id: workId }, state: "active" } as never;
		},
	});
	const id = "2026-07-22-pi-close";
	await harness.commands.get("codepatrol-close")!.handler(`${id} commit`, { cwd: "/repo" });
	assert.match(harness.messages[0], /codepatrol_record_run/);
	await harness.handlers.get("message_end")!({ message: { role: "assistant", model: "pi-model", usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 1, reasoning: 1, totalTokens: 10 } } });
	clock = 2500;
	const tool = harness.tools.get("codepatrol_record_run")!;
	await tool.execute("tool-1", { workId: id }, undefined, undefined, { cwd: "/repo" });
	await tool.execute("tool-2", { workId: id }, undefined, undefined, { cwd: "/repo" });
	assert.equal(transitions.length, 1);
	assert.deepEqual(transitions[0], {
		workspace: "/repo",
		workId: id,
		intent: {
			type: "usage",
			actor: "pi",
			stage: "close",
			run: {
				id: "pi-close-1000",
				started_at: "1970-01-01T00:00:01.000Z",
				finished_at: "1970-01-01T00:00:02.500Z",
				elapsed_ms: 1500,
				tokens: { status: "measured", source: "provider", input: 3, output: 4, cacheRead: 2, cacheWrite: 1, reasoning: 1, total: 10, harness: "pi", model: "pi-model" },
			},
		},
	});
});

test("Pi records unavailable coverage exactly once when the provider exposes no usage", async () => {
	const harness = piHarness();
	const intents: any[] = [];
	installCodepatrolPiExtension(harness.pi, {
		now: () => 5000,
		transition: async (_workspace, _workId, intent) => { intents.push(intent); return {} as never; },
	});
	const id = "2026-07-22-pi-plan";
	await harness.commands.get("codepatrol-plan")!.handler(id, { cwd: "/repo" });
	await harness.tools.get("codepatrol_record_run")!.execute("tool", { workId: id }, undefined, undefined, { cwd: "/repo" });
	assert.equal(intents.length, 1);
	assert.deepEqual(intents[0].run.tokens, { status: "unavailable", reason: "Pi exposed no authoritative provider usage for this run.", harness: "pi" });
});
