import { createHash } from "node:crypto";

export const PHASE74_PROTECTION_SAFETY_METRICS = [
  "abstentionAccuracy",
  "hallucinationRate",
  "privacyPassRate",
  "updateCorrectness",
] as const;

export type Phase74ProtectionReplicate = 1 | 2 | 3;
export type Phase74ProtectionSafetyMetric =
  (typeof PHASE74_PROTECTION_SAFETY_METRICS)[number];

export interface Phase74ProtectionIdentityDescriptor {
  id: string;
  sha256: string;
}

export interface Phase74ProtectionRunIdentity {
  dataset: Phase74ProtectionIdentityDescriptor;
  judge: Phase74ProtectionIdentityDescriptor;
  model: Phase74ProtectionIdentityDescriptor;
  pipeline: Phase74ProtectionIdentityDescriptor;
  population: {
    caseCount: number;
    caseIdsSha256: string;
    id: string;
  };
  prompt: Phase74ProtectionIdentityDescriptor;
  source: Phase74ProtectionIdentityDescriptor;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Phase 74 ${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort().join("\0");
  if (actual !== [...expected].sort().join("\0")) {
    throw new Error(
      `Phase 74 ${label} must contain exactly: ${[...expected].sort().join(", ")}.`,
    );
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 ${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function sha256Value(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw new Error(`Phase 74 ${label} must be a lowercase SHA-256.`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Phase 74 ${label} must be greater than zero.`);
  }
  return Number(value);
}

function parseDescriptor(
  value: unknown,
  label: string,
): Phase74ProtectionIdentityDescriptor {
  const record = recordValue(value, label);
  assertExactKeys(record, ["id", "sha256"], label);
  return {
    id: stringValue(record.id, `${label}.id`),
    sha256: sha256Value(record.sha256, `${label}.sha256`),
  };
}

export function hashPhase74ProtectionCaseIds(
  caseIds: readonly string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([...caseIds].sort()))
    .digest("hex");
}

export function parsePhase74ProtectionRunIdentity(
  value: unknown,
  label: string,
): Phase74ProtectionRunIdentity {
  const record = recordValue(value, label);
  assertExactKeys(record, [
    "dataset",
    "judge",
    "model",
    "pipeline",
    "population",
    "prompt",
    "source",
  ], label);
  const population = recordValue(record.population, `${label}.population`);
  assertExactKeys(
    population,
    ["caseCount", "caseIdsSha256", "id"],
    `${label}.population`,
  );
  return {
    dataset: parseDescriptor(record.dataset, `${label}.dataset`),
    judge: parseDescriptor(record.judge, `${label}.judge`),
    model: parseDescriptor(record.model, `${label}.model`),
    pipeline: parseDescriptor(record.pipeline, `${label}.pipeline`),
    population: {
      caseCount: positiveInteger(
        population.caseCount,
        `${label}.population.caseCount`,
      ),
      caseIdsSha256: sha256Value(
        population.caseIdsSha256,
        `${label}.population.caseIdsSha256`,
      ),
      id: stringValue(population.id, `${label}.population.id`),
    },
    prompt: parseDescriptor(record.prompt, `${label}.prompt`),
    source: parseDescriptor(record.source, `${label}.source`),
  };
}
