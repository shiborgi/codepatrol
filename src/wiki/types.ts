export interface WikiIssue {
	path: string;
	code: string;
	message: string;
	line?: number;
}

export interface WikiConcept {
	id: string;
	path: string;
	type: string;
	title?: string;
	description?: string;
	fields: Record<string, unknown>;
}

export interface WikiValidation {
	valid: boolean;
	errors: WikiIssue[];
	warnings: WikiIssue[];
	concepts: WikiConcept[];
	text: string;
}

export interface WikiPageRecord {
	path: string;
	sources: Record<string, string>;
	updatedAt: string;
}

export interface WikiManifest {
	version: 1;
	okfVersion: "0.1";
	generatedAt: string;
	pages: Record<string, WikiPageRecord>;
}

export interface WikiRecordFile {
	path: string;
	content: string;
	sources?: string[];
}

export interface WikiRecordPayload {
	version: 1;
	mode: "rewrite" | "incremental";
	files: WikiRecordFile[];
	remove?: string[];
	updateAgentsPointer?: boolean;
}
