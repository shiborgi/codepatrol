import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityRef } from "../core/execution.js";
import { canonicalJson, sha256Hex } from "../core/json.js";
import { METHODS } from "../core/methods.js";

export interface ProfileManifest {
  schemaVersion: number;
  id: string;
  methods: Record<string, string[]>;
}

export interface CapabilityManifest {
  schemaVersion: number;
  id: string;
  version: number;
}

export interface CatalogEntry {
  id: string;
}

export interface Catalog {
  schemaVersion: number;
  primaryMethods: { id: string; scope: string; skill: string }[];
  capabilities: CatalogEntry[];
}

export interface ResolvedComposition {
  profile: string;
  method: string;
  capabilities: CapabilityRef[];
  compositionDigest: string;
}

function readJsonFile(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf-8");
  return JSON.parse(text) as Record<string, unknown>;
}

function parseProfile(value: Record<string, unknown>, id: string): ProfileManifest {
  if (value.schemaVersion !== 1) throw new Error(`profile ${id}: unsupported schemaVersion`);
  if (value.id !== id) throw new Error(`profile ${id}: id mismatch`);
  const methods = value.methods as Record<string, unknown>;
  if (typeof methods !== "object" || methods === null) throw new Error(`profile ${id}: methods must be an object`);
  const parsed: Record<string, string[]> = {};
  for (const key of Object.keys(methods)) {
    if (!(METHODS as readonly string[]).includes(key))
      throw new Error(`profile ${id}: unknown method ${JSON.stringify(key)}`);
    if (!Array.isArray(methods[key])) throw new Error(`profile ${id}: methods.${key} must be an array`);
    parsed[key] = (methods[key] as unknown[]).map((entry, index) => {
      if (typeof entry !== "string") throw new Error(`profile ${id}: methods.${key}[${index}] must be a string`);
      return entry;
    });
  }
  return { schemaVersion: 1, id, methods: parsed };
}

function parseCapabilityManifest(value: Record<string, unknown>, id: string): CapabilityManifest {
  if (value.schemaVersion !== 1) throw new Error(`capability ${id}: unsupported schemaVersion`);
  if (value.id !== id) throw new Error(`capability ${id}: id mismatch`);
  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error(`capability ${id}: version must be a positive integer`);
  }
  return { schemaVersion: 1, id, version };
}

function capabilityDigest(capabilityId: string, repoRoot: string): string {
  const metaPath = join(repoRoot, "skills", "capabilities", capabilityId, "capability.json");
  const manifestRaw = readFileSync(metaPath, "utf-8");
  const manifest = parseCapabilityManifest(JSON.parse(manifestRaw) as Record<string, unknown>, capabilityId);

  const skillPath = join(repoRoot, "skills", "capabilities", capabilityId, "SKILL.md");
  let instructions = "";
  try {
    instructions = readFileSync(skillPath, "utf-8");
  } catch {
    // SKILL.md is optional; absent instructions are empty string
  }

  return sha256Hex(canonicalJson({ manifest, instructions }));
}

export function loadProfile(repoRoot: string, method: string, profileName: string): ResolvedComposition {
  const profilePath = join(repoRoot, "skills", "profiles", `${profileName}.json`);
  const profileData = readJsonFile(profilePath);
  const profile = parseProfile(profileData, profileName);

  if (!(method in profile.methods)) {
    throw new Error(`profile ${profileName} does not define method ${method}`);
  }

  const capabilityIds = profile.methods[method] as string[];
  const seen = new Set<string>();
  for (const id of capabilityIds) {
    if (seen.has(id)) throw new Error(`profile ${profileName} method ${method}: duplicate capability ${id}`);
    seen.add(id);
  }

  const catalogPath = join(repoRoot, "skills", "catalog.json");
  const catalogData = readJsonFile(catalogPath);
  const catalog = catalogData as unknown as Catalog;

  const capabilities: CapabilityRef[] = [];
  for (const id of capabilityIds) {
    const entry = catalog.capabilities.find((c) => c.id === id);
    if (entry === undefined) throw new Error(`capability ${id} not found in catalog`);
    const manifestPath = join(repoRoot, "skills", "capabilities", id, "capability.json");
    const manifestData = readJsonFile(manifestPath);
    const manifest = parseCapabilityManifest(manifestData, id);
    const digest = capabilityDigest(id, repoRoot);
    capabilities.push({ id, version: manifest.version, digest });
  }

  capabilities.sort((a, b) => a.id.localeCompare(b.id));

  const composition = { profile: profile.id, method, capabilities };
  const compositionDigest = sha256Hex(canonicalJson(composition));

  return { profile: profile.id, method, capabilities, compositionDigest };
}
