import { fail } from "../core/errors.js";

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
  repeated: Map<string, string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  const repeated = new Map<string, string[]>();
  const set = (name: string, value: string | true): void => {
    if (flags.has(name)) {
      const prior = repeated.get(name) ?? [flags.get(name) as string];
      repeated.set(name, [...prior, value === true ? "" : value]);
    }
    flags.set(name, value);
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith("--")) {
          set(token.slice(2), next);
          index += 1;
        } else {
          set(token.slice(2), true);
        }
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags, repeated };
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name);
  if (value === undefined || value === true || value === "") {
    fail("USAGE", `--${name} requires a value`);
  }
  return value;
}

export function optionalFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) fail("USAGE", `--${name} requires a value`);
  if (value === "") fail("USAGE", `--${name} must not be empty`);
  return value;
}

export function repeatedFlag(args: ParsedArgs, name: string): string[] {
  const values = args.repeated.get(name);
  if (values === undefined) {
    const single = args.flags.get(name);
    if (single === undefined) return [];
    if (single === true || single === "") fail("USAGE", `--${name} requires a value`);
    return [single];
  }
  for (const value of values) {
    if (value === "") fail("USAGE", `--${name} must not be empty`);
  }
  return values;
}
