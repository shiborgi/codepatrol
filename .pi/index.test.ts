import assert from "node:assert/strict";
import test from "node:test";
import codepatrolPiExtension, { kickoff } from "./index.js";

test("Pi extension registers exactly the six canonical primary entry points", async () => {
	const commands = new Map<string, { handler: (args?: string) => Promise<void> }>();
	const messages: string[] = [];
	const pi = {
		registerCommand(name: string, command: { handler: (args?: string) => Promise<void> }) { commands.set(name, command); },
		sendUserMessage(message: string) { messages.push(message); },
	} as any;
	codepatrolPiExtension(pi);
	assert.deepEqual([...commands.keys()], ["codepatrol-plan", "codepatrol-review", "codepatrol-apply", "codepatrol-verify", "codepatrol-status"]);
	await commands.get("codepatrol-plan")!.handler("add caching");
	assert.match(messages[0], /codepatrol-plan/);
	assert.match(messages[0], /add caching/);
	assert.doesNotMatch(messages[0], /spawn_agent|subagent\(/);
});

test("kickoff includes the Pi sequential fallback", () => {
	assert.match(kickoff("codepatrol-plan", ""), /sequential fallback/);
});
