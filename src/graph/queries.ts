/**
 * Per-language tree-sitter queries — internal to the graph module.
 *
 * Symbol kind is encoded in the capture name (`@name.function`, `@name.class`,
 * …) so extraction never depends on pattern order. Compilation failures
 * degrade per query (grammar node names can drift between versions): a failed
 * query yields no captures instead of crashing the sync.
 */
import type { LanguageId, TSQuery } from "./languages.js";
import { createQuery } from "./languages.js";

export type QueryKind = "defs" | "imports" | "calls" | "inherits";

const TS_DEFS = `
(function_declaration name: (identifier) @name.function) @def
(class_declaration name: (type_identifier) @name.class) @def
(abstract_class_declaration name: (type_identifier) @name.class) @def
(interface_declaration name: (type_identifier) @name.interface) @def
(type_alias_declaration name: (type_identifier) @name.type) @def
(enum_declaration name: (identifier) @name.type) @def
(method_definition name: (property_identifier) @name.method) @def
(lexical_declaration (variable_declarator name: (identifier) @name.function value: [(arrow_function) (function_expression)])) @def
(lexical_declaration (variable_declarator name: (identifier) @name.const)) @def
(variable_declaration (variable_declarator name: (identifier) @name.const)) @def
`;

const JS_DEFS = `
(function_declaration name: (identifier) @name.function) @def
(class_declaration name: (identifier) @name.class) @def
(method_definition name: (property_identifier) @name.method) @def
(lexical_declaration (variable_declarator name: (identifier) @name.function value: [(arrow_function) (function_expression)])) @def
(lexical_declaration (variable_declarator name: (identifier) @name.const)) @def
(variable_declaration (variable_declarator name: (identifier) @name.const)) @def
`;

const JS_IMPORTS = `
(import_statement source: (string) @source)
(export_statement source: (string) @source)
(call_expression function: (identifier) @_fn arguments: (arguments (string) @source) (#eq? @_fn "require"))
`;

const JS_CALLS = `
(call_expression function: (identifier) @callee)
(call_expression function: (member_expression property: (property_identifier) @callee))
(new_expression constructor: (identifier) @callee)
`;

const TS_INHERITS = `
(extends_clause value: (identifier) @parent)
(extends_clause value: (member_expression) @parent)
(implements_clause (type_identifier) @parent)
(extends_type_clause type: (type_identifier) @parent)
`;

const JS_INHERITS = `
(class_heritage (identifier) @parent)
`;

const QUERIES: Record<LanguageId, Record<QueryKind, string>> = {
	typescript: { defs: TS_DEFS, imports: JS_IMPORTS, calls: JS_CALLS, inherits: TS_INHERITS },
	tsx: { defs: TS_DEFS, imports: JS_IMPORTS, calls: JS_CALLS, inherits: TS_INHERITS },
	javascript: { defs: JS_DEFS, imports: JS_IMPORTS, calls: JS_CALLS, inherits: JS_INHERITS },
	python: {
		defs: `
(function_definition name: (identifier) @name.function) @def
(class_definition name: (identifier) @name.class) @def
(module (expression_statement (assignment left: (identifier) @name.const) @def))
`,
		imports: `
(import_statement name: (dotted_name) @source)
(import_statement name: (aliased_import name: (dotted_name) @source))
(import_from_statement module_name: (dotted_name) @source)
(import_from_statement module_name: (relative_import) @source)
`,
		calls: `
(call function: (identifier) @callee)
(call function: (attribute attribute: (identifier) @callee))
`,
		inherits: `
(class_definition superclasses: (argument_list [(identifier) (attribute)] @parent))
`,
	},
	go: {
		defs: `
(function_declaration name: (identifier) @name.function) @def
(method_declaration name: (field_identifier) @name.method) @def
(type_declaration (type_spec name: (type_identifier) @name.type)) @def
(const_declaration (const_spec name: (identifier) @name.const)) @def
(var_declaration (var_spec name: (identifier) @name.const)) @def
`,
		imports: `(import_spec path: (interpreted_string_literal) @source)`,
		calls: `
(call_expression function: (identifier) @callee)
(call_expression function: (selector_expression field: (field_identifier) @callee))
`,
		inherits: ``, // struct embedding is not worth an unreliable query
	},
	java: {
		defs: `
(class_declaration name: (identifier) @name.class) @def
(interface_declaration name: (identifier) @name.interface) @def
(enum_declaration name: (identifier) @name.type) @def
(record_declaration name: (identifier) @name.class) @def
(method_declaration name: (identifier) @name.method) @def
`,
		imports: `(import_declaration (scoped_identifier) @source)`,
		calls: `(method_invocation name: (identifier) @callee)`,
		inherits: `
(superclass (type_identifier) @parent)
(super_interfaces (type_list (type_identifier) @parent))
`,
	},
	rust: {
		defs: `
(function_item name: (identifier) @name.function) @def
(struct_item name: (type_identifier) @name.class) @def
(enum_item name: (type_identifier) @name.type) @def
(trait_item name: (type_identifier) @name.interface) @def
(mod_item name: (identifier) @name.type) @def
(const_item name: (identifier) @name.const) @def
(static_item name: (identifier) @name.const) @def
`,
		imports: `(use_declaration argument: (_) @source)`,
		calls: `
(call_expression function: (identifier) @callee)
(call_expression function: (field_expression field: (field_identifier) @callee))
(call_expression function: (scoped_identifier name: (identifier) @callee))
`,
		inherits: `(impl_item trait: (type_identifier) @parent)`,
	},
};

const compiled = new Map<string, TSQuery | undefined>();

export async function query(language: LanguageId, kind: QueryKind): Promise<TSQuery | undefined> {
	const source = QUERIES[language][kind];
	if (!source.trim()) return undefined;
	const key = `${language}:${kind}`;
	if (!compiled.has(key)) compiled.set(key, await createQuery(language, source));
	return compiled.get(key);
}
