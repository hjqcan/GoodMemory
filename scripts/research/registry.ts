import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type {
  GitSourceIdentity,
} from "../proof/git";

const defaultRegistryPath = fileURLToPath(
  new URL("./protocols.json", import.meta.url),
);

export interface ResearchProtocol {
  canonicalArtifacts: string[];
  externalPrerequisites: string[];
  historicalGateEntrypoints: string[];
  id: string;
  inputSourceIdentity: GitSourceIdentity;
  runEntrypoint: string;
  status: ResearchProtocolStatus;
  verifyEntrypoint: string;
}

export type ResearchProtocolStatus =
  | "accepted-historical"
  | "active"
  | "diagnostic-frozen"
  | "superseded"
  | "terminal";

export interface ResearchProtocolRegistry {
  protocols: ResearchProtocol[];
  schemaVersion: 1;
}

export async function loadResearchProtocolRegistry(
  path = defaultRegistryPath,
): Promise<ResearchProtocolRegistry> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  assertRegistry(parsed);
  return parsed;
}

export function findResearchProtocol(
  registry: ResearchProtocolRegistry,
  id: string,
): ResearchProtocol {
  const protocol = registry.protocols.find((candidate) => candidate.id === id);
  if (protocol === undefined) {
    throw new Error(`unknown research protocol ${JSON.stringify(id)}`);
  }
  return protocol;
}

export function findActiveResearchProtocol(
  registry: ResearchProtocolRegistry,
  id: string,
): ResearchProtocol {
  const protocol = findResearchProtocol(registry, id);
  if (protocol.status !== "active") {
    throw new Error(`research protocol ${JSON.stringify(id)} is not active`);
  }
  return protocol;
}

export function activeResearchProtocols(
  registry: ResearchProtocolRegistry,
): ResearchProtocol[] {
  return registry.protocols.filter((protocol) => protocol.status === "active");
}

function assertRegistry(value: unknown): asserts value is ResearchProtocolRegistry {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("invalid research protocol registry");
  }
  const registry = value as Record<string, unknown>;
  if (
    Object.keys(registry).sort().join(",") !== "protocols,schemaVersion" ||
    registry.schemaVersion !== 1 ||
    !Array.isArray(registry.protocols)
  ) {
    throw new Error("invalid research protocol registry");
  }
  const ids = new Set<string>();
  for (const protocol of registry.protocols) {
    assertProtocol(protocol);
    if (ids.has(protocol.id)) {
      throw new Error(`duplicate research protocol ${protocol.id}`);
    }
    ids.add(protocol.id);
  }
}

function assertProtocol(value: unknown): asserts value is ResearchProtocol {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("invalid research protocol");
  }
  const protocol = value as Record<string, unknown>;
  if (
    Object.keys(protocol).sort().join(",") !==
      "canonicalArtifacts,externalPrerequisites,historicalGateEntrypoints,id,inputSourceIdentity,runEntrypoint,status,verifyEntrypoint" ||
    typeof protocol.id !== "string" ||
    protocol.id.length === 0 ||
    !isProtocolStatus(protocol.status) ||
    !isStringArray(protocol.canonicalArtifacts) ||
    !isStringArray(protocol.externalPrerequisites) ||
    !isStringArray(protocol.historicalGateEntrypoints) ||
    typeof protocol.runEntrypoint !== "string" ||
    typeof protocol.verifyEntrypoint !== "string" ||
    !isGitSourceIdentity(protocol.inputSourceIdentity)
  ) {
    throw new Error("invalid research protocol");
  }
  if (
    hasDuplicates(protocol.canonicalArtifacts) ||
    hasDuplicates(protocol.externalPrerequisites) ||
    hasDuplicates(protocol.historicalGateEntrypoints) ||
    protocol.historicalGateEntrypoints.some(
      (path) => path.includes("*") || !path.endsWith(".gate.ts"),
    )
  ) {
    throw new Error(`research protocol ${protocol.id} has invalid exact entries`);
  }
}

function isProtocolStatus(value: unknown): value is ResearchProtocolStatus {
  return (
    value === "accepted-historical" ||
    value === "active" ||
    value === "diagnostic-frozen" ||
    value === "superseded" ||
    value === "terminal"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isGitSourceIdentity(value: unknown): value is GitSourceIdentity {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const identity = value as Record<string, unknown>;
  return (
    Object.keys(identity).sort().join(",") === "commit,tree" &&
    typeof identity.commit === "string" &&
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(identity.commit) &&
    typeof identity.tree === "string" &&
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(identity.tree)
  );
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
