import test from "node:test";
import assert from "node:assert/strict";
import { parseKanbanArgs } from "./render-kanban.mjs";

test("Kanban script arguments are explicit and clock-free by default", () => {
	assert.deepEqual(parseKanbanArgs(["--workspace", "/tmp/example", "--format", "json", "--all"]), { workspace: "/tmp/example", format: "json", all: true });
	assert.throws(() => parseKanbanArgs(["--as-of", "tomorrow"]), /ISO/);
});
