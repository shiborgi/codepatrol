import { existsSync } from "node:fs";
import { CodepatrolError } from "../shared/errors.js";
import { resolveInside } from "../shared/workspace.js";

export interface PlanCheckInput {
	workspace: string;
	packageDirectory: string;
	specText: string;
	planText: string;
}

interface TaskBlock {
	id: string;
	text: string;
}

const ACCEPTANCE_DECLARATION = /^-\s*(AC-\d+):/gm;
const ACCEPTANCE_REFERENCE = /\b(AC-\d+)\b/g;
const TASK_HEADING = /^###\s+([A-Za-z]+\d+[a-z]?)\s+—/gm;
const TASK_REFERENCE = /\b([A-Za-z]+\d+[a-z]?)\b/g;
const FILE_MARKER = /^-\s*(Create|Modify|Delete):\s*`([^`]+)`/gm;

function matches(text: string, pattern: RegExp): string[] {
	return [...text.matchAll(pattern)].map((match) => match[1]);
}

function taskBlocks(planText: string): TaskBlock[] {
	const headings = [...planText.matchAll(TASK_HEADING)];
	return headings.map((heading, index) => ({
		id: heading[1],
		text: planText.slice(heading.index!, headings[index + 1]?.index ?? planText.length),
	}));
}

function checkAcceptanceMapping(specText: string, planText: string, errors: string[]): void {
	const declared = new Set(matches(specText, ACCEPTANCE_DECLARATION));
	const referenced = new Set(matches(planText, ACCEPTANCE_REFERENCE));
	for (const criterion of declared) {
		if (!referenced.has(criterion)) errors.push(`Acceptance criterion ${criterion} in spec.md is not referenced by any plan task.`);
	}
	for (const criterion of referenced) {
		if (!declared.has(criterion)) errors.push(`Plan references ${criterion}, which spec.md does not declare.`);
	}
	if (!declared.size) errors.push("No acceptance criteria were parsed from spec.md.");
}

function dependencies(task: TaskBlock): string[] {
	const line = task.text.match(/^.*Depends on:.*$/m)?.[0];
	return line ? matches(line, TASK_REFERENCE) : [];
}

function checkTaskGraph(tasks: TaskBlock[], errors: string[]): void {
	const taskIds = new Set(tasks.map((task) => task.id));
	const graph = new Map<string, string[]>();
	for (const task of tasks) {
		const taskDependencies = dependencies(task);
		graph.set(task.id, taskDependencies.filter((dependency) => taskIds.has(dependency)));
		for (const dependency of taskDependencies) {
			if (!taskIds.has(dependency)) errors.push(`Task ${task.id} depends on ${dependency}, which does not exist.`);
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const reported = new Set<string>();
	const visit = (taskId: string): void => {
		if (visiting.has(taskId)) {
			if (!reported.has(taskId)) errors.push(`Task dependency cycle at ${taskId}.`);
			reported.add(taskId);
			return;
		}
		if (visited.has(taskId)) return;
		visiting.add(taskId);
		for (const dependency of graph.get(taskId) ?? []) visit(dependency);
		visiting.delete(taskId);
		visited.add(taskId);
	};
	for (const task of tasks) visit(task.id);
	if (!tasks.length) errors.push("No tasks were parsed from plan.md.");
}

function checkFileMarkers(workspace: string, tasks: TaskBlock[], errors: string[]): void {
	for (const task of tasks) {
		for (const match of task.text.matchAll(FILE_MARKER)) {
			const marker = match[1];
			const path = match[2];
			let absolute: string;
			try {
				absolute = resolveInside(workspace, path);
			} catch (cause) {
				if (!(cause instanceof CodepatrolError)) throw cause;
				errors.push(`Task ${task.id} declares ${marker} on ${path}, which escapes the workspace.`);
				continue;
			}
			const exists = existsSync(absolute);
			if (marker === "Create" && exists) errors.push(`Task ${task.id} declares Create on ${path}, which already exists in the workspace.`);
			if (marker !== "Create" && !exists) errors.push(`Task ${task.id} declares ${marker} on ${path}, which does not exist in the workspace.`);
		}
	}
}

function withoutCode(text: string): string {
	return text
		.replace(/```[\s\S]*?(?:```|$)/g, "")
		.replace(/`[^`\n]*`/g, "");
}

function checkPlaceholders(text: string, file: "spec.md" | "plan.md", errors: string[]): void {
	const prose = withoutCode(text);
	const markers: Array<[string, RegExp]> = [
		["TBD", /\bTBD\b/i],
		["TODO", /\bTODO\b/i],
		["FIXME", /\bFIXME\b/i],
		["???", /\?\?\?/],
		["<placeholder>", /<placeholder>/i],
	];
	for (const [marker, pattern] of markers) {
		if (pattern.test(prose)) errors.push(`Placeholder marker ${marker} in ${file}.`);
	}
}

function checkDeferredConstraints(specText: string, errors: string[]): void {
	const labels = ["chosen simplification", "known ceiling", "observable trigger", "upgrade path"];
	for (const line of specText.split(/\r?\n/)) {
		if (!/^\s*\|\s*DC-\d+\s*\|/.test(line)) continue;
		const cells = line.trim().split("|").slice(1, line.trim().endsWith("|") ? -1 : undefined).map((cell) => cell.trim());
		const id = cells[0];
		for (let index = 0; index < labels.length; index++) {
			if (!cells[index + 1]) errors.push(`Deferred constraint ${id} is missing its ${labels[index]}.`);
		}
	}
}

function hasSection(text: string, heading: string): boolean {
	return new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(text);
}

function checkRequiredSections(specText: string, planText: string, errors: string[]): void {
	for (const heading of ["## Intent", "## Scope", "## Acceptance criteria"]) {
		if (!hasSection(specText, heading)) errors.push(`spec.md is missing the required section: ${heading}.`);
	}
	for (const heading of ["## Acceptance mapping", "## Dependency order"]) {
		if (!hasSection(planText, heading)) errors.push(`plan.md is missing the required section: ${heading}.`);
	}
}

export function checkPlanPackage(input: PlanCheckInput): string[] {
	const errors: string[] = [];
	const tasks = taskBlocks(input.planText);
	checkAcceptanceMapping(input.specText, input.planText, errors);
	checkTaskGraph(tasks, errors);
	checkFileMarkers(input.workspace, tasks, errors);
	checkPlaceholders(input.specText, "spec.md", errors);
	checkPlaceholders(input.planText, "plan.md", errors);
	checkDeferredConstraints(input.specText, errors);
	checkRequiredSections(input.specText, input.planText, errors);
	return errors;
}
