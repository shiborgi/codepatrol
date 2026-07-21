import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CommandSpec {
	name: string;
	skill: string;
	description: string;
}

const COMMANDS: CommandSpec[] = [
	{ name: "codepatrol-plan", skill: "codepatrol-plan", description: "Plan a project or feature as a reviewable package" },
	{ name: "codepatrol-review", skill: "codepatrol-review", description: "Review a package, plan, branch, diff, or change" },
	{ name: "codepatrol-apply", skill: "codepatrol-apply", description: "Apply an approved Codepatrol artifact package" },
	{ name: "codepatrol-verify", skill: "codepatrol-verify", description: "Deeply verify an implemented package and record a verdict" },
	{ name: "codepatrol-status", skill: "codepatrol-status", description: "Summarize open Codepatrol workflows and packages" },
];

export function kickoff(skill: string, args: string): string {
	return [
		`Use the Agent Skill \`${skill}\` for this request.`,
		"Follow its portable sequential fallback because Pi does not provide native delegation.",
		args ? `User input: ${args}` : "If essential intent is missing, ask one focused question before continuing.",
	].join("\n");
}

export default function codepatrolPiExtension(pi: ExtensionAPI): void {
	for (const command of COMMANDS) {
		pi.registerCommand(command.name, {
			description: command.description,
			handler: async (args) => {
				pi.sendUserMessage(kickoff(command.skill, args?.trim() ?? ""), { deliverAs: "followUp" });
			},
		});
	}
}
