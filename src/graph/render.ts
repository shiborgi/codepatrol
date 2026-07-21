/**
 * Graph facts → terminal-friendly markdown: aligned tables and Mermaid module
 * maps (fenced, so they render on GitHub/GitLab and stay readable raw).
 */
import type { Cluster } from "./analysis.js";

export function formatTable(headers: string[], rows: string[][]): string {
	const widths = headers.map((h, col) => Math.max(h.length, ...rows.map((r) => (r[col] ?? "").length)));
	const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
	return [
		line(headers),
		`| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`,
		...rows.map((r) => line(r)),
	].join("\n");
}

export interface ClusterEdge {
	from: number;
	to: number;
	count: number;
}

const MAX_CLUSTERS = 12;

export function mermaidModuleMap(clusters: Cluster[], edges: ClusterEdge[]): string {
	const shown = clusters.slice(0, MAX_CLUSTERS);
	const shownIds = new Set(shown.map((c) => c.id));
	const lines = ["```mermaid", "flowchart LR"];
	for (const cluster of shown) {
		const sample = cluster.files.slice(0, 3).map((f) => f.split("/").pop()).join("<br/>");
		lines.push(`  subgraph c${cluster.id}["${escapeLabel(cluster.label)} (${cluster.files.length} files)"]`);
		lines.push(`    c${cluster.id}n["${escapeLabel(sample)}"]`);
		lines.push("  end");
	}
	for (const edge of edges) {
		if (!shownIds.has(edge.from) || !shownIds.has(edge.to)) continue;
		lines.push(`  c${edge.from} -->|${edge.count}| c${edge.to}`);
	}
	lines.push("```");
	return lines.join("\n");
}

function escapeLabel(text: string): string {
	return text.replace(/"/g, "'");
}
