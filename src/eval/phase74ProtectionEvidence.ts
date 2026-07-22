import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";
import type { Phase74ProtectionEvidence } from "./phase74PromotionGate";

const EVIDENCE_LEDGER_FORMATS = [
  "prose",
  "chronology",
  "compact_json",
  "json_locale_note",
] as const satisfies readonly EvidenceLedgerFormat[];
const SAFETY_METRICS = [
  "abstentionAccuracy",
  "hallucinationRate",
  "privacyPassRate",
  "updateCorrectness",
] as const;
const DERIVATION_METHOD =
  "paired-case-mean-across-three-replicates-v1" as const;

export type Phase74ProtectionReplicate = 1 | 2 | 3;
export type Phase74ProtectionSafetyMetric = (typeof SAFETY_METRICS)[number];

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

export interface Phase74ProtectionBranchScores {
  e4: Record<EvidenceLedgerFormat, Record<string, number>>;
  protections: Record<string, number>;
  safety: Record<Phase74ProtectionSafetyMetric, number>;
}

export interface Phase74ProtectionCaseRow {
  baseline: Phase74ProtectionBranchScores;
  candidate: Phase74ProtectionBranchScores;
  caseId: string;
}

export interface Phase74FrozenProtectionRunArtifact {
  artifactKind: "phase74-frozen-protection-run";
  executionFailures: number;
  identity: Phase74ProtectionRunIdentity;
  rawArtifact: {
    path: string;
    sha256: string;
  };
  replicate: Phase74ProtectionReplicate;
  rows: Phase74ProtectionCaseRow[];
  runId: string;
  schemaVersion: 1;
}

export interface LoadedPhase74FrozenProtectionRunArtifact {
  artifactPath: string;
  artifactSha256: string;
  identity: Phase74ProtectionRunIdentity;
  rawArtifactPath: string;
  rawArtifactSha256: string;
  replicate: Phase74ProtectionReplicate;
  rows: Phase74ProtectionCaseRow[];
  runId: string;
}

export interface Phase74FrozenProtectionEvidence {
  artifactKind: "phase74-frozen-protection-evidence";
  derivation: {
    caseCountPerReplicate: number;
    method: typeof DERIVATION_METHOD;
    pairedRowCount: number;
    replicateCount: 3;
  };
  e4: {
    formatDeltas: Record<EvidenceLedgerFormat, Phase74ProtectionEvidence[]>;
  };
  promotion: {
    protections: Phase74ProtectionEvidence[];
    safety: {
      abstentionAccuracyDelta: number;
      hallucinationRateDelta: number;
      privacyPassRateDelta: number;
      updateCorrectnessDelta: number;
    };
  };
  schemaVersion: 2;
  source: {
    files: Array<{
      artifactPath: string;
      artifactSha256: string;
      rawArtifactPath: string;
      rawArtifactSha256: string;
      replicate: Phase74ProtectionReplicate;
      runId: string;
    }>;
    identity: Phase74ProtectionRunIdentity;
    identityHash: string;
    runIds: [string, string, string];
  };
}

export interface LoadedPhase74FrozenProtectionEvidence {
  evidence: Phase74FrozenProtectionEvidence;
  sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Phase 74 ${label} must be a JSON object.`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.join("\0") !== sortedExpected.join("\0")) {
    throw new Error(
      `Phase 74 ${label} must contain exactly: ${sortedExpected.join(", ")}.`,
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

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Phase 74 ${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
  const result = nonNegativeInteger(value, label);
  if (result === 0) {
    throw new Error(`Phase 74 ${label} must be greater than zero.`);
  }
  return result;
}

function unitValue(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`Phase 74 ${label} must be a number between 0 and 1.`);
  }
  return value;
}

function deltaValue(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < -1 ||
    value > 1
  ) {
    throw new Error(`Phase 74 ${label} must be a finite delta between -1 and 1.`);
  }
  return value;
}

function parseReplicate(
  value: unknown,
  label: string,
): Phase74ProtectionReplicate {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error(`Phase 74 ${label} must be 1, 2, or 3.`);
  }
  return value;
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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPhase74ProtectionCaseIds(
  caseIds: readonly string[],
): string {
  return sha256(canonicalJson([...caseIds].sort()));
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

function scoreNames(scores: Record<string, number>): string[] {
  return Object.keys(scores).sort();
}

function assertSameNames(
  actual: Record<string, number>,
  expected: readonly string[],
  label: string,
): void {
  if (scoreNames(actual).join("\0") !== expected.join("\0")) {
    throw new Error(`Phase 74 ${label} metric population drift.`);
  }
}

function parseScoreMap(value: unknown, label: string): Record<string, number> {
  const record = recordValue(value, label);
  const names = Object.keys(record).sort();
  if (names.length === 0) {
    throw new Error(`Phase 74 ${label} must contain at least one metric.`);
  }
  return Object.fromEntries(names.map((name) => {
    stringValue(name, `${label} metric name`);
    return [name, unitValue(record[name], `${label}.${name}`)];
  }));
}

function parseSafety(
  value: unknown,
  label: string,
): Record<Phase74ProtectionSafetyMetric, number> {
  const record = recordValue(value, label);
  assertExactKeys(record, SAFETY_METRICS, label);
  return Object.fromEntries(SAFETY_METRICS.map((metric) => [
    metric,
    unitValue(record[metric], `${label}.${metric}`),
  ])) as Record<Phase74ProtectionSafetyMetric, number>;
}

function parseBranch(
  value: unknown,
  label: string,
): Phase74ProtectionBranchScores {
  const record = recordValue(value, label);
  assertExactKeys(record, ["e4", "protections", "safety"], label);
  const protections = parseScoreMap(record.protections, `${label}.protections`);
  const names = scoreNames(protections);
  const e4Record = recordValue(record.e4, `${label}.e4`);
  assertExactKeys(e4Record, EVIDENCE_LEDGER_FORMATS, `${label}.e4`);
  const e4 = Object.fromEntries(EVIDENCE_LEDGER_FORMATS.map((format) => {
    const scores = parseScoreMap(e4Record[format], `${label}.e4.${format}`);
    assertSameNames(scores, names, `${label}.e4.${format}`);
    return [format, scores];
  })) as Record<EvidenceLedgerFormat, Record<string, number>>;
  return {
    e4,
    protections,
    safety: parseSafety(record.safety, `${label}.safety`),
  };
}

function parseRow(value: unknown, label: string): Phase74ProtectionCaseRow {
  const record = recordValue(value, label);
  assertExactKeys(record, ["baseline", "candidate", "caseId"], label);
  const baseline = parseBranch(record.baseline, `${label}.baseline`);
  const candidate = parseBranch(record.candidate, `${label}.candidate`);
  assertSameNames(
    candidate.protections,
    scoreNames(baseline.protections),
    `${label}.candidate.protections`,
  );
  return {
    baseline,
    candidate,
    caseId: stringValue(record.caseId, `${label}.caseId`),
  };
}

function validateStructuredRawArtifact(input: {
  identity: Phase74ProtectionRunIdentity;
  raw: unknown;
  replicate: Phase74ProtectionReplicate;
  rows: readonly Phase74ProtectionCaseRow[];
  runId: string;
}): void {
  if (!isRecord(input.raw)) {
    throw new Error("Phase 74 protection raw artifact must be a JSON object.");
  }
  if (input.raw.artifactKind !== "phase74-frozen-protection-raw") {
    throw new Error(
      "Phase 74 protection raw artifact artifactKind is invalid.",
    );
  }
  assertExactKeys(input.raw, [
    "artifactKind",
    "executionFailures",
    "failures",
    "population",
    "replicate",
    "rows",
    "runId",
    "schemaVersion",
  ], "protection raw artifact");
  if (input.raw.schemaVersion !== 1) {
    throw new Error("Phase 74 protection raw artifact schemaVersion is invalid.");
  }
  if (nonNegativeInteger(
    input.raw.executionFailures,
    "protection raw artifact executionFailures",
  ) !== 0) {
    throw new Error(
      "Phase 74 protection evidence requires zero raw execution failures.",
    );
  }
  if (!Array.isArray(input.raw.failures) || input.raw.failures.length !== 0) {
    throw new Error("Phase 74 protection raw artifact contains failures.");
  }
  if (input.raw.replicate !== input.replicate || input.raw.runId !== input.runId) {
    throw new Error("Phase 74 protection raw artifact run identity drifted.");
  }
  const population = recordValue(
    input.raw.population,
    "protection raw artifact population",
  );
  assertExactKeys(
    population,
    ["caseCount", "caseIdsSha256"],
    "protection raw artifact population",
  );
  if (
    population.caseCount !== input.identity.population.caseCount ||
    population.caseIdsSha256 !== input.identity.population.caseIdsSha256
  ) {
    throw new Error("Phase 74 protection raw artifact population drifted.");
  }
  if (!Array.isArray(input.raw.rows) ||
    input.raw.rows.length !== input.rows.length) {
    throw new Error("Phase 74 protection raw artifact rows do not match the run.");
  }
  const rawRows = input.raw.rows.map((value, index) => {
    const row = recordValue(value, `protection raw artifact rows[${index}]`);
    assertExactKeys(row, [
      "baseline",
      "candidate",
      "caseId",
      "inputSha256",
    ], `protection raw artifact rows[${index}]`);
    sha256Value(
      row.inputSha256,
      `protection raw artifact rows[${index}].inputSha256`,
    );
    const branch = (name: "baseline" | "candidate") => {
      const record = recordValue(
        row[name],
        `protection raw artifact rows[${index}].${name}`,
      );
      assertExactKeys(
        record,
        ["rawOutput", "scores"],
        `protection raw artifact rows[${index}].${name}`,
      );
      return parseBranch(
        record.scores,
        `protection raw artifact rows[${index}].${name}.scores`,
      );
    };
    return {
      baseline: branch("baseline"),
      candidate: branch("candidate"),
      caseId: stringValue(
        row.caseId,
        `protection raw artifact rows[${index}].caseId`,
      ),
    };
  });
  if (canonicalJson(rawRows) !== canonicalJson(input.rows)) {
    throw new Error(
      "Phase 74 protection raw outcomes do not match the frozen run rows.",
    );
  }
}

export async function loadPhase74FrozenProtectionRunArtifact(
  path: string,
): Promise<LoadedPhase74FrozenProtectionRunArtifact> {
  const artifactPath = resolve(path);
  const bytes = await readFile(artifactPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Phase 74 protection run artifact at ${artifactPath} is not valid JSON.`,
      { cause: error },
    );
  }
  const record = recordValue(parsed, "protection run artifact");
  if (record.artifactKind === "phase74-frozen-protection-suite-run") {
    throw new Error(
      "Phase 74 protection suite runs must be composed with the other required suites before building final protection evidence.",
    );
  }
  assertExactKeys(record, [
    "artifactKind",
    "executionFailures",
    "identity",
    "rawArtifact",
    "replicate",
    "rows",
    "runId",
    "schemaVersion",
  ], "protection run artifact");
  if (
    record.artifactKind !== "phase74-frozen-protection-run" ||
    record.schemaVersion !== 1
  ) {
    throw new Error(
      "Phase 74 protection run artifact kind or schemaVersion is invalid.",
    );
  }
  if (nonNegativeInteger(
    record.executionFailures,
    "protection run executionFailures",
  ) !== 0) {
    throw new Error(
      "Phase 74 protection evidence requires zero execution failures.",
    );
  }
  if (!Array.isArray(record.rows) || record.rows.length === 0) {
    throw new Error("Phase 74 protection run rows must be a non-empty array.");
  }
  const rows = record.rows.map((row, index) =>
    parseRow(row, `protection run rows[${index}]`)
  );
  const identity = parsePhase74ProtectionRunIdentity(
    record.identity,
    "protection run identity",
  );
  const caseIds = rows.map(({ caseId }) => caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("Phase 74 protection run contains duplicate case IDs.");
  }
  if (
    rows.length !== identity.population.caseCount ||
    hashPhase74ProtectionCaseIds(caseIds) !== identity.population.caseIdsSha256
  ) {
    throw new Error("Phase 74 protection run case population does not match its identity.");
  }
  const expectedNames = scoreNames(rows[0]!.baseline.protections);
  for (const [index, row] of rows.entries()) {
    assertSameNames(
      row.baseline.protections,
      expectedNames,
      `protection run rows[${index}].baseline.protections`,
    );
    assertSameNames(
      row.candidate.protections,
      expectedNames,
      `protection run rows[${index}].candidate.protections`,
    );
  }
  const rawArtifact = recordValue(
    record.rawArtifact,
    "protection run rawArtifact",
  );
  assertExactKeys(
    rawArtifact,
    ["path", "sha256"],
    "protection run rawArtifact",
  );
  const rawPathValue = stringValue(
    rawArtifact.path,
    "protection run rawArtifact.path",
  );
  const rawArtifactPath = resolve(dirname(artifactPath), rawPathValue);
  const rawArtifactSha256 = sha256Value(
    rawArtifact.sha256,
    "protection run rawArtifact.sha256",
  );
  const rawBytes = await readFile(rawArtifactPath);
  if (sha256(rawBytes) !== rawArtifactSha256) {
    throw new Error(
      `Phase 74 protection raw artifact SHA-256 mismatch at ${rawArtifactPath}.`,
    );
  }
  const replicate = parseReplicate(record.replicate, "protection run replicate");
  const runId = stringValue(record.runId, "protection run runId");
  let raw: unknown;
  try {
    raw = JSON.parse(rawBytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      "Phase 74 protection raw artifact must be valid structured JSON.",
      { cause: error },
    );
  }
  validateStructuredRawArtifact({ identity, raw, replicate, rows, runId });
  return {
    artifactPath,
    artifactSha256: sha256(bytes),
    identity,
    rawArtifactPath,
    rawArtifactSha256,
    replicate,
    rows,
    runId,
  };
}

function roundedMean(values: readonly number[]): number {
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(12),
  );
}

function deriveProtectionDeltas(
  artifacts: readonly LoadedPhase74FrozenProtectionRunArtifact[],
  score: (row: Phase74ProtectionCaseRow, name: string) => [number, number],
): Phase74ProtectionEvidence[] {
  const names = scoreNames(artifacts[0]!.rows[0]!.baseline.protections);
  return names.map((name) => ({
    delta: roundedMean(artifacts.flatMap(({ rows }) => rows.map((row) => {
      const [baseline, candidate] = score(row, name);
      return candidate - baseline;
    }))),
    name,
  }));
}

function deriveSafetyDelta(
  artifacts: readonly LoadedPhase74FrozenProtectionRunArtifact[],
  metric: Phase74ProtectionSafetyMetric,
): number {
  return roundedMean(artifacts.flatMap(({ rows }) => rows.map((row) =>
    row.candidate.safety[metric] - row.baseline.safety[metric]
  )));
}

export async function buildPhase74FrozenProtectionEvidence(input: {
  runArtifactPaths: readonly string[];
}): Promise<Phase74FrozenProtectionEvidence> {
  if (input.runArtifactPaths.length !== 3) {
    throw new Error(
      "Phase 74 protection evidence requires exactly three run artifact paths.",
    );
  }
  const paths = input.runArtifactPaths.map((path) => resolve(path));
  if (new Set(paths).size !== paths.length) {
    throw new Error("Phase 74 protection evidence contains duplicate run artifact paths.");
  }
  const artifacts = (await Promise.all(
    paths.map(loadPhase74FrozenProtectionRunArtifact),
  )).sort(
    (left, right) => left.replicate - right.replicate,
  );
  if (artifacts.some(({ replicate }, index) => replicate !== index + 1)) {
    throw new Error(
      "Phase 74 protection evidence requires replicates 1, 2, and 3 exactly once.",
    );
  }
  if (new Set(artifacts.map(({ runId }) => runId)).size !== artifacts.length) {
    throw new Error("Phase 74 protection evidence contains duplicate run IDs.");
  }
  if (artifacts[0]!.identity.pipeline.id === "phase74-protection-dry-run-v1") {
    throw new Error(
      "Phase 74 dry-run protection artifacts are not promotion evidence.",
    );
  }
  const identityJson = canonicalJson(artifacts[0]!.identity);
  if (artifacts.some(({ identity }) => canonicalJson(identity) !== identityJson)) {
    throw new Error("Phase 74 protection run identity drift across replicates.");
  }
  const expectedMetricNames = scoreNames(
    artifacts[0]!.rows[0]!.baseline.protections,
  ).join("\0");
  if (artifacts.some(({ rows }) =>
    scoreNames(rows[0]!.baseline.protections).join("\0") !== expectedMetricNames
  )) {
    throw new Error("Phase 74 protection metric population drift across replicates.");
  }
  const promotionProtections = deriveProtectionDeltas(
    artifacts,
    (row, name) => [
      row.baseline.protections[name]!,
      row.candidate.protections[name]!,
    ],
  );
  const formatDeltas = Object.fromEntries(EVIDENCE_LEDGER_FORMATS.map((format) => [
    format,
    deriveProtectionDeltas(artifacts, (row, name) => [
      row.baseline.e4[format][name]!,
      row.candidate.e4[format][name]!,
    ]),
  ])) as Record<EvidenceLedgerFormat, Phase74ProtectionEvidence[]>;
  const files = artifacts.map((artifact) => ({
    artifactPath: artifact.artifactPath,
    artifactSha256: artifact.artifactSha256,
    rawArtifactPath: artifact.rawArtifactPath,
    rawArtifactSha256: artifact.rawArtifactSha256,
    replicate: artifact.replicate,
    runId: artifact.runId,
  }));
  return {
    artifactKind: "phase74-frozen-protection-evidence",
    derivation: {
      caseCountPerReplicate: artifacts[0]!.rows.length,
      method: DERIVATION_METHOD,
      pairedRowCount: artifacts.reduce((sum, { rows }) => sum + rows.length, 0),
      replicateCount: 3,
    },
    e4: { formatDeltas },
    promotion: {
      protections: promotionProtections,
      safety: {
        abstentionAccuracyDelta: deriveSafetyDelta(
          artifacts,
          "abstentionAccuracy",
        ),
        hallucinationRateDelta: deriveSafetyDelta(
          artifacts,
          "hallucinationRate",
        ),
        privacyPassRateDelta: deriveSafetyDelta(
          artifacts,
          "privacyPassRate",
        ),
        updateCorrectnessDelta: deriveSafetyDelta(
          artifacts,
          "updateCorrectness",
        ),
      },
    },
    schemaVersion: 2,
    source: {
      files,
      identity: artifacts[0]!.identity,
      identityHash: sha256(identityJson),
      runIds: artifacts.map(({ runId }) => runId) as [string, string, string],
    },
  };
}

function parseProtectionEvidence(
  value: unknown,
  label: string,
): Phase74ProtectionEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Phase 74 ${label} must be a non-empty array.`);
  }
  const evidence = value.map((item, index) => {
    const record = recordValue(item, `${label}[${index}]`);
    assertExactKeys(record, ["delta", "name"], `${label}[${index}]`);
    return {
      delta: deltaValue(record.delta, `${label}[${index}].delta`),
      name: stringValue(record.name, `${label}[${index}].name`),
    };
  });
  if (new Set(evidence.map(({ name }) => name)).size !== evidence.length) {
    throw new Error(`Phase 74 ${label} contains duplicate metric names.`);
  }
  return evidence;
}

function parseFrozenEvidence(value: unknown): Phase74FrozenProtectionEvidence {
  const record = recordValue(value, "frozen protection evidence");
  if (
    record.artifactKind !== "phase74-frozen-protection-evidence" ||
    record.schemaVersion !== 2
  ) {
    throw new Error(
      "Phase 74 frozen protection evidence requires artifact kind phase74-frozen-protection-evidence and schemaVersion 2; legacy v1 is rejected.",
    );
  }
  assertExactKeys(record, [
    "artifactKind",
    "derivation",
    "e4",
    "promotion",
    "schemaVersion",
    "source",
  ], "frozen protection evidence");
  const derivation = recordValue(record.derivation, "protection derivation");
  assertExactKeys(derivation, [
    "caseCountPerReplicate",
    "method",
    "pairedRowCount",
    "replicateCount",
  ], "protection derivation");
  if (
    derivation.method !== DERIVATION_METHOD ||
    derivation.replicateCount !== 3
  ) {
    throw new Error("Phase 74 protection derivation contract is invalid.");
  }
  const e4 = recordValue(record.e4, "protection E4");
  assertExactKeys(e4, ["formatDeltas"], "protection E4");
  const formatDeltasRecord = recordValue(
    e4.formatDeltas,
    "protection E4 formatDeltas",
  );
  assertExactKeys(
    formatDeltasRecord,
    EVIDENCE_LEDGER_FORMATS,
    "protection E4 formatDeltas",
  );
  const formatDeltas = Object.fromEntries(EVIDENCE_LEDGER_FORMATS.map((format) => [
    format,
    parseProtectionEvidence(
      formatDeltasRecord[format],
      `protection E4 ${format}`,
    ),
  ])) as Record<EvidenceLedgerFormat, Phase74ProtectionEvidence[]>;
  const promotion = recordValue(record.promotion, "protection promotion");
  assertExactKeys(
    promotion,
    ["protections", "safety"],
    "protection promotion",
  );
  const protections = parseProtectionEvidence(
    promotion.protections,
    "promotion protections",
  );
  const expectedNames = protections.map(({ name }) => name).sort().join("\0");
  for (const format of EVIDENCE_LEDGER_FORMATS) {
    if (
      formatDeltas[format].map(({ name }) => name).sort().join("\0") !==
      expectedNames
    ) {
      throw new Error("Phase 74 E4 protection metric population drift.");
    }
  }
  const safety = recordValue(promotion.safety, "protection safety");
  const safetyDeltaKeys = [
    "abstentionAccuracyDelta",
    "hallucinationRateDelta",
    "privacyPassRateDelta",
    "updateCorrectnessDelta",
  ] as const;
  assertExactKeys(safety, safetyDeltaKeys, "protection safety");
  const source = recordValue(record.source, "protection source");
  assertExactKeys(
    source,
    ["files", "identity", "identityHash", "runIds"],
    "protection source",
  );
  if (!Array.isArray(source.files) || source.files.length !== 3) {
    throw new Error("Phase 74 protection source requires exactly three files.");
  }
  const files = source.files.map((item, index) => {
    const file = recordValue(item, `protection source files[${index}]`);
    assertExactKeys(file, [
      "artifactPath",
      "artifactSha256",
      "rawArtifactPath",
      "rawArtifactSha256",
      "replicate",
      "runId",
    ], `protection source files[${index}]`);
    const artifactPath = stringValue(
      file.artifactPath,
      `protection source files[${index}].artifactPath`,
    );
    const rawArtifactPath = stringValue(
      file.rawArtifactPath,
      `protection source files[${index}].rawArtifactPath`,
    );
    if (!isAbsolute(artifactPath) || !isAbsolute(rawArtifactPath)) {
      throw new Error("Phase 74 protection source paths must be absolute.");
    }
    return {
      artifactPath,
      artifactSha256: sha256Value(
        file.artifactSha256,
        `protection source files[${index}].artifactSha256`,
      ),
      rawArtifactPath,
      rawArtifactSha256: sha256Value(
        file.rawArtifactSha256,
        `protection source files[${index}].rawArtifactSha256`,
      ),
      replicate: parseReplicate(
        file.replicate,
        `protection source files[${index}].replicate`,
      ),
      runId: stringValue(file.runId, `protection source files[${index}].runId`),
    };
  });
  if (!Array.isArray(source.runIds) || source.runIds.length !== 3) {
    throw new Error("Phase 74 protection source requires exactly three run IDs.");
  }
  const runIds = source.runIds.map((runId, index) =>
    stringValue(runId, `protection source runIds[${index}]`)
  ) as [string, string, string];
  return {
    artifactKind: "phase74-frozen-protection-evidence",
    derivation: {
      caseCountPerReplicate: positiveInteger(
        derivation.caseCountPerReplicate,
        "protection derivation.caseCountPerReplicate",
      ),
      method: DERIVATION_METHOD,
      pairedRowCount: positiveInteger(
        derivation.pairedRowCount,
        "protection derivation.pairedRowCount",
      ),
      replicateCount: 3,
    },
    e4: { formatDeltas },
    promotion: {
      protections,
      safety: {
        abstentionAccuracyDelta: deltaValue(
          safety.abstentionAccuracyDelta,
          "protection safety.abstentionAccuracyDelta",
        ),
        hallucinationRateDelta: deltaValue(
          safety.hallucinationRateDelta,
          "protection safety.hallucinationRateDelta",
        ),
        privacyPassRateDelta: deltaValue(
          safety.privacyPassRateDelta,
          "protection safety.privacyPassRateDelta",
        ),
        updateCorrectnessDelta: deltaValue(
          safety.updateCorrectnessDelta,
          "protection safety.updateCorrectnessDelta",
        ),
      },
    },
    schemaVersion: 2,
    source: {
      files,
      identity: parsePhase74ProtectionRunIdentity(
        source.identity,
        "protection source identity",
      ),
      identityHash: sha256Value(
        source.identityHash,
        "protection source identityHash",
      ),
      runIds,
    },
  };
}

export async function loadPhase74FrozenProtectionEvidence(
  path: string,
): Promise<LoadedPhase74FrozenProtectionEvidence> {
  const artifactPath = resolve(path);
  const bytes = await readFile(artifactPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Phase 74 frozen protection evidence at ${artifactPath} is not valid JSON.`,
      { cause: error },
    );
  }
  const evidence = parseFrozenEvidence(parsed);
  const derived = await buildPhase74FrozenProtectionEvidence({
    runArtifactPaths: evidence.source.files.map(({ artifactPath: pathValue }) =>
      pathValue
    ),
  });
  if (canonicalJson(evidence) !== canonicalJson(derived)) {
    throw new Error(
      "Phase 74 frozen protection evidence does not match its paired source rows.",
    );
  }
  return { evidence, sha256: sha256(bytes) };
}
