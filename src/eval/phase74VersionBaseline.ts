import { createHash } from "node:crypto";

import type { EvalRunJsonObject } from "./runIdentity";

export const PHASE74_RELEASE_REF = "v0.7.0";
export const PHASE74_RELEASE_COMMIT =
  "5ad83df2e3e5e9763318e74994a335cd681a32f6";
export const PHASE74_RELEASE_TREE =
  "80f7f5a1ff94862565767b5b45be5354c4754f9e";
export const PHASE74_RELEASE_ARCHIVE_SHA256 =
  "4cefbac3d9a9e8c3e4773a8e5cb8bca91f0eb50e87c58497c063cfe3c0d270f8";
export const PHASE74_RELEASE_LOCKFILE_SHA256 =
  "cf18263a6823508afa2c95c49fcad709621b1887d39bb2c21b65d88d2afb54c8";
export const PHASE74_ALPHA_COMMIT =
  "5d7639a8fa164d86e0aa1ed10a8ea398b7912464";
export const PHASE74_ALPHA_TREE =
  "90b4313b20065a708e94ff7d9635924d56b26bfc";

const PHASE74_VERSION_DETERMINISTIC_RERANKER = {
  implementation: "lexical-coverage-v1",
  mode: "deterministic",
} as const satisfies EvalRunJsonObject;
const PHASE74_VERSION_PROVIDER_RERANKER = {
  gateway: "https://ai.gurkiai.com/v1",
  implementation: "provider-listwise-v1",
  mode: "provider",
  model: "gpt-5.6-terra",
  provider: "openai",
} as const satisfies EvalRunJsonObject;

export type Phase74VersionArm = "release" | "alpha" | "candidate";

export interface Phase74VersionSourceIdentity {
  archiveSha256: string;
  arm: Phase74VersionArm;
  commit: string;
  lockfileSha256: string;
  ref: string;
  tree: string;
  workerSha256: string;
}

export interface Phase74VersionRawEvidenceItem {
  content: string;
  id: string;
  observedAt?: string;
  role?: string;
  sourceIds: readonly string[];
}

export interface Phase74VersionWorkerInput {
  arm: Phase74VersionArm;
  caseId: string;
  locale?: string;
  memoryGroupId: string;
  question: string;
  rawEvidence: readonly Phase74VersionRawEvidenceItem[];
  referenceTime?: string;
  schemaVersion: 1;
  sourceCommit: string;
}

const SOURCE_IDENTITY_SHA256_FIELDS = [
  "archiveSha256",
  "lockfileSha256",
  "workerSha256",
] as const;
const WORKER_INPUT_FIELDS = new Set([
  "arm",
  "caseId",
  "locale",
  "memoryGroupId",
  "question",
  "rawEvidence",
  "referenceTime",
  "schemaVersion",
  "sourceCommit",
]);
const RAW_EVIDENCE_FIELDS = new Set([
  "content",
  "id",
  "observedAt",
  "role",
  "sourceIds",
]);
const CANDIDATE_SOURCE_FIELDS = new Set(["commit", "sha256"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactHex(value: unknown, length: number, label: string): string {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`, "iu").test(value)
  ) {
    throw new Error(`${label} must be an exact ${length}-character hexadecimal value.`);
  }
  return value.toLowerCase();
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, label);
}

function phase74VersionArm(value: unknown): Phase74VersionArm {
  if (value !== "release" && value !== "alpha" && value !== "candidate") {
    throw new Error("Phase 74 version arm must be release, alpha, or candidate.");
  }
  return value;
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown !== undefined) {
    throw new Error(`${label} has unknown field ${unknown}.`);
  }
}

function assertArmSourceCommit(arm: Phase74VersionArm, commit: string): void {
  if (arm === "release" && commit !== PHASE74_RELEASE_COMMIT) {
    throw new Error(`Phase 74 release commit must equal ${PHASE74_RELEASE_COMMIT}.`);
  }
  if (arm === "alpha" && commit !== PHASE74_ALPHA_COMMIT) {
    throw new Error(`Phase 74 alpha commit must equal ${PHASE74_ALPHA_COMMIT}.`);
  }
}

export function parsePhase74VersionCandidateSource(value: unknown): {
  commit: string;
  sha256: string;
} {
  if (!isRecord(value)) {
    throw new Error("Phase 74 candidate source must be an object.");
  }
  assertKnownFields(value, CANDIDATE_SOURCE_FIELDS, "Phase 74 candidate source");
  return {
    commit: exactHex(value.commit, 40, "Phase 74 candidate commit"),
    sha256: exactHex(value.sha256, 64, "Phase 74 candidate source SHA-256"),
  };
}

export function parsePhase74VersionCandidateReranker(
  value: unknown,
): EvalRunJsonObject {
  const identity = canonicalJson(value);
  if (identity === canonicalJson(PHASE74_VERSION_DETERMINISTIC_RERANKER)) {
    return PHASE74_VERSION_DETERMINISTIC_RERANKER;
  }
  if (identity === canonicalJson(PHASE74_VERSION_PROVIDER_RERANKER)) {
    return PHASE74_VERSION_PROVIDER_RERANKER;
  }
  throw new Error(
    "Phase 74 candidate reranker must equal the frozen deterministic or Gurki listwise identity.",
  );
}

export function createPhase74VersionSourceIdentity(
  input: Phase74VersionSourceIdentity,
): Phase74VersionSourceIdentity {
  const arm = phase74VersionArm(input.arm);
  const commit = exactHex(input.commit, 40, "Phase 74 source commit");
  assertArmSourceCommit(arm, commit);
  const tree = exactHex(input.tree, 40, "Phase 74 source tree");
  if (arm === "release" && tree !== PHASE74_RELEASE_TREE) {
    throw new Error(`Phase 74 release tree must equal ${PHASE74_RELEASE_TREE}.`);
  }
  if (arm === "alpha" && tree !== PHASE74_ALPHA_TREE) {
    throw new Error(`Phase 74 alpha tree must equal ${PHASE74_ALPHA_TREE}.`);
  }
  const ref = nonEmptyString(input.ref, "Phase 74 source ref");
  if (arm === "release" && ref !== PHASE74_RELEASE_REF) {
    throw new Error(`Phase 74 release ref must equal ${PHASE74_RELEASE_REF}.`);
  }
  if (arm !== "release" && ref !== commit) {
    throw new Error(`Phase 74 ${arm} ref must equal its exact commit.`);
  }
  const sha256s = Object.fromEntries(
    SOURCE_IDENTITY_SHA256_FIELDS.map((field) => [
      field,
      exactHex(input[field], 64, `Phase 74 ${field}`),
    ]),
  ) as Pick<
    Phase74VersionSourceIdentity,
    (typeof SOURCE_IDENTITY_SHA256_FIELDS)[number]
  >;
  if (
    arm === "release" &&
    sha256s.archiveSha256 !== PHASE74_RELEASE_ARCHIVE_SHA256
  ) {
    throw new Error(
      `Phase 74 release archive must equal ${PHASE74_RELEASE_ARCHIVE_SHA256}.`,
    );
  }
  if (
    arm === "release" &&
    sha256s.lockfileSha256 !== PHASE74_RELEASE_LOCKFILE_SHA256
  ) {
    throw new Error(
      `Phase 74 release lockfile must equal ${PHASE74_RELEASE_LOCKFILE_SHA256}.`,
    );
  }
  return { ...sha256s, arm, commit, ref, tree };
}

function parseRawEvidenceItem(
  value: unknown,
  index: number,
): Phase74VersionRawEvidenceItem {
  if (!isRecord(value)) {
    throw new Error(`Phase 74 worker rawEvidence[${index}] must be an object.`);
  }
  assertKnownFields(value, RAW_EVIDENCE_FIELDS, `Phase 74 worker rawEvidence[${index}]`);
  if (
    !Array.isArray(value.sourceIds) ||
    !value.sourceIds.every((sourceId) =>
      typeof sourceId === "string" && sourceId.length > 0
    )
  ) {
    throw new Error(`Phase 74 worker rawEvidence[${index}].sourceIds must be strings.`);
  }
  const observedAt = optionalString(
    value.observedAt,
    `Phase 74 worker rawEvidence[${index}].observedAt`,
  );
  const role = optionalString(
    value.role,
    `Phase 74 worker rawEvidence[${index}].role`,
  );
  return {
    content: nonEmptyString(
      value.content,
      `Phase 74 worker rawEvidence[${index}].content`,
    ),
    id: nonEmptyString(value.id, `Phase 74 worker rawEvidence[${index}].id`),
    ...(observedAt === undefined ? {} : { observedAt }),
    ...(role === undefined ? {} : { role }),
    sourceIds: [...value.sourceIds],
  };
}

export function parsePhase74VersionWorkerInput(
  value: unknown,
): Phase74VersionWorkerInput {
  if (!isRecord(value)) {
    throw new Error("Phase 74 version worker input must be an object.");
  }
  assertKnownFields(value, WORKER_INPUT_FIELDS, "Phase 74 version worker input");
  if (value.schemaVersion !== 1) {
    throw new Error("Phase 74 version worker schemaVersion must equal 1.");
  }
  if (!Array.isArray(value.rawEvidence)) {
    throw new Error("Phase 74 version worker rawEvidence must be an array.");
  }
  const arm = phase74VersionArm(value.arm);
  const sourceCommit = exactHex(
    value.sourceCommit,
    40,
    "Phase 74 worker sourceCommit",
  );
  assertArmSourceCommit(arm, sourceCommit);
  const locale = optionalString(value.locale, "Phase 74 worker locale");
  const referenceTime = optionalString(
    value.referenceTime,
    "Phase 74 worker referenceTime",
  );
  return {
    arm,
    caseId: nonEmptyString(value.caseId, "Phase 74 worker caseId"),
    ...(locale === undefined ? {} : { locale }),
    memoryGroupId: nonEmptyString(
      value.memoryGroupId,
      "Phase 74 worker memoryGroupId",
    ),
    question: nonEmptyString(value.question, "Phase 74 worker question"),
    rawEvidence: value.rawEvidence.map(parseRawEvidenceItem),
    ...(referenceTime === undefined ? {} : { referenceTime }),
    schemaVersion: 1,
    sourceCommit,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pairedPayload(input: Phase74VersionWorkerInput): unknown {
  return {
    caseId: input.caseId,
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    memoryGroupId: input.memoryGroupId,
    question: input.question,
    rawEvidence: input.rawEvidence,
    ...(input.referenceTime === undefined
      ? {}
      : { referenceTime: input.referenceTime }),
    schemaVersion: input.schemaVersion,
  };
}

export function assertPhase74VersionPair(input: {
  baseline: Phase74VersionWorkerInput;
  candidate: Phase74VersionWorkerInput;
}): { caseId: string; memoryGroupId: string } {
  if (
    (input.baseline.arm !== "release" && input.baseline.arm !== "alpha") ||
    input.candidate.arm !== "candidate"
  ) {
    throw new Error(
      "Phase 74 version pair must compare a release or alpha baseline with candidate.",
    );
  }
  if (input.baseline.sourceCommit === input.candidate.sourceCommit) {
    throw new Error("Phase 74 version pair requires independent source commits.");
  }
  if (
    canonicalJson(pairedPayload(input.baseline)) !==
      canonicalJson(pairedPayload(input.candidate))
  ) {
    throw new Error("Phase 74 paired label-free payload drift.");
  }
  return {
    caseId: input.baseline.caseId,
    memoryGroupId: input.baseline.memoryGroupId,
  };
}

export function buildPhase74VersionIngestionKey(input: {
  configurationSha256: string;
  datasetSha256: string;
  memoryGroupId: string;
  rawEvidence: readonly Phase74VersionRawEvidenceItem[];
  sourceCommit: string;
}): string {
  const configurationSha256 = exactHex(
    input.configurationSha256,
    64,
    "Phase 74 ingestion configurationSha256",
  );
  const datasetSha256 = exactHex(
    input.datasetSha256,
    64,
    "Phase 74 ingestion datasetSha256",
  );
  const sourceCommit = exactHex(
    input.sourceCommit,
    40,
    "Phase 74 ingestion sourceCommit",
  );
  const payload = canonicalJson({
    configurationSha256,
    datasetSha256,
    memoryGroupId: nonEmptyString(
      input.memoryGroupId,
      "Phase 74 ingestion memoryGroupId",
    ),
    rawEvidence: input.rawEvidence,
    schemaVersion: 1,
    sourceCommit,
  });
  const digest = createHash("sha256").update(payload).digest("hex");
  return `phase74-version-ingestion-v1:${sourceCommit}:${digest}`;
}

function nonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

export function assertPhase74VersionModelCallAllowance(input: {
  completedCalls: number;
  hardLimit: number;
  requestedCalls: number;
}): number {
  if (!Number.isSafeInteger(input.hardLimit) || input.hardLimit <= 0) {
    throw new Error("Phase 74 model-call hard limit must be a positive safe integer.");
  }
  nonNegativeSafeInteger(input.completedCalls, "Phase 74 completed model calls");
  nonNegativeSafeInteger(input.requestedCalls, "Phase 74 requested model calls");
  const remaining = input.hardLimit - input.completedCalls - input.requestedCalls;
  if (remaining < 0) {
    throw new Error(
      `Phase 74 model-call hard limit ${input.hardLimit} would be exceeded.`,
    );
  }
  return remaining;
}
