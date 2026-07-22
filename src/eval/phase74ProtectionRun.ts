import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import {
  hashPhase74ProtectionCaseIds,
  parsePhase74ProtectionRunIdentity,
} from "./phase74ProtectionContracts";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
  Phase74ProtectionRunIdentity,
  Phase74ProtectionSafetyMetric,
} from "./phase74ProtectionContracts";
import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";

export type Phase74ProtectionBranch = "baseline" | "candidate";

export interface Phase74ProtectionRunIdentityInput {
  dataset: Phase74ProtectionIdentityDescriptor;
  judge: Phase74ProtectionIdentityDescriptor;
  model: Phase74ProtectionIdentityDescriptor;
  pipeline: Phase74ProtectionIdentityDescriptor;
  populationId: string;
  prompt: Phase74ProtectionIdentityDescriptor;
  source: Phase74ProtectionIdentityDescriptor;
}

export interface Phase74ProtectionCase<Input> {
  caseId: string;
  input: Input;
}

interface Phase74ProtectionRawFailure {
  branch: Phase74ProtectionBranch;
  caseId: string;
  message: string;
  name: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPhase74ProtectionValue(value: unknown): string {
  return sha256(canonicalJson(value));
}

function cloneJson<Input>(value: Input, label: string): Input {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error(`Phase 74 ${label} must be JSON serializable.`);
  }
  try {
    return JSON.parse(json) as Input;
  } catch (error) {
    throw new Error(`Phase 74 ${label} must be JSON serializable.`, {
      cause: error,
    });
  }
}

function errorDetails(
  error: unknown,
  branch: Phase74ProtectionBranch,
  caseId: string,
): Phase74ProtectionRawFailure {
  if (error instanceof Error) {
    return {
      branch,
      caseId,
      message: error.message,
      name: error.name,
    };
  }
  return {
    branch,
    caseId,
    message: String(error),
    name: "Error",
  };
}

function validateCasePopulation<Input>(
  cases: readonly Phase74ProtectionCase<Input>[],
): string[] {
  if (cases.length === 0) {
    throw new Error("Phase 74 protection run requires at least one case.");
  }
  const caseIds = cases.map(({ caseId }) => {
    if (caseId === "" || caseId.trim() !== caseId) {
      throw new Error(
        "Phase 74 protection case IDs must be non-empty trimmed strings.",
      );
    }
    return caseId;
  });
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("Phase 74 protection run contains duplicate case IDs.");
  }
  return caseIds;
}

async function writeFrozenJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

const SUITE_E4_FORMATS = [
  "prose",
  "chronology",
  "compact_json",
  "json_locale_note",
] as const satisfies readonly EvidenceLedgerFormat[];
const SUITE_SAFETY_METRICS = [
  "abstentionAccuracy",
  "hallucinationRate",
  "privacyPassRate",
  "updateCorrectness",
] as const satisfies readonly Phase74ProtectionSafetyMetric[];

export type Phase74ProtectionSuiteKind =
  | "benchmark-protection"
  | "e4"
  | "safety";

export interface Phase74ProtectionSuite {
  id: string;
  kind: Phase74ProtectionSuiteKind;
}

export interface Phase74ProtectionSuiteBranchScores {
  e4?: Record<EvidenceLedgerFormat, Record<string, number>>;
  protections?: Record<string, number>;
  safety?: Partial<Record<Phase74ProtectionSafetyMetric, number>>;
}

export interface Phase74ProtectionSuiteCaseRow {
  baseline: Phase74ProtectionSuiteBranchScores;
  candidate: Phase74ProtectionSuiteBranchScores;
  caseId: string;
}

export interface Phase74FrozenProtectionSuiteRunArtifact {
  artifactKind: "phase74-frozen-protection-suite-run";
  executionFailures: number;
  identity: Phase74ProtectionRunIdentity;
  rawArtifact: {
    path: string;
    sha256: string;
  };
  replicate: Phase74ProtectionReplicate;
  rows: Phase74ProtectionSuiteCaseRow[];
  runId: string;
  schemaVersion: 1;
  suite: Phase74ProtectionSuite;
}

export interface Phase74ProtectionSuiteEvaluationResult {
  rawOutput: unknown;
  scores: Phase74ProtectionSuiteBranchScores;
}

export interface Phase74ProtectionSuiteRunResult {
  artifact: Phase74FrozenProtectionSuiteRunArtifact;
  artifactPath: string;
  rawArtifactPath: string;
}

export interface LoadedPhase74FrozenProtectionSuiteRunArtifact {
  artifactPath: string;
  artifactSha256: string;
  identity: Phase74ProtectionRunIdentity;
  rawArtifactPath: string;
  rawArtifactSha256: string;
  replicate: Phase74ProtectionReplicate;
  rows: Phase74ProtectionSuiteCaseRow[];
  runId: string;
  suite: Phase74ProtectionSuite;
}

interface Phase74ProtectionSuiteRawRow {
  baseline: {
    rawOutput: unknown;
    scores: Phase74ProtectionSuiteBranchScores;
  };
  candidate: {
    rawOutput: unknown;
    scores: Phase74ProtectionSuiteBranchScores;
  };
  caseId: string;
  inputSha256: string;
}

interface Phase74ProtectionSuiteRawArtifact {
  artifactKind: "phase74-frozen-protection-suite-raw";
  executionFailures: number;
  failures: Phase74ProtectionRawFailure[];
  population: {
    caseCount: number;
    caseIdsSha256: string;
  };
  replicate: Phase74ProtectionReplicate;
  rows: Phase74ProtectionSuiteRawRow[];
  runId: string;
  schemaVersion: 1;
  suite: Phase74ProtectionSuite;
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
  if (
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    throw new Error(
      `Phase 74 ${label} must contain exactly: ${[...expected].sort().join(", ")}.`,
    );
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 ${label} must be a non-empty trimmed string.`);
  }
  return value;
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

function metricMap(value: unknown, label: string): Record<string, number> {
  const record = recordValue(value, label);
  const names = Object.keys(record).sort();
  if (names.length === 0) {
    throw new Error(`Phase 74 ${label} must contain at least one metric.`);
  }
  return Object.fromEntries(names.map((name) => [
    nonEmptyString(name, `${label} metric name`),
    unitValue(record[name], `${label}.${name}`),
  ]));
}

function parseSuite(value: unknown, label: string): Phase74ProtectionSuite {
  const record = recordValue(value, label);
  assertExactKeys(record, ["id", "kind"], label);
  if (
    record.kind !== "benchmark-protection" &&
    record.kind !== "e4" &&
    record.kind !== "safety"
  ) {
    throw new Error(`Phase 74 ${label}.kind is invalid.`);
  }
  return {
    id: nonEmptyString(record.id, `${label}.id`),
    kind: record.kind,
  };
}

function parseSuiteScores(
  value: unknown,
  suite: Phase74ProtectionSuite,
  label: string,
): Phase74ProtectionSuiteBranchScores {
  const record = recordValue(value, label);
  if (suite.kind === "benchmark-protection") {
    assertExactKeys(record, ["protections"], label);
    return { protections: metricMap(record.protections, `${label}.protections`) };
  }
  if (suite.kind === "safety") {
    assertExactKeys(record, ["safety"], label);
    const safety = recordValue(record.safety, `${label}.safety`);
    const names = Object.keys(safety).sort();
    if (names.length === 0 || names.some((name) =>
      !(SUITE_SAFETY_METRICS as readonly string[]).includes(name)
    )) {
      throw new Error(`Phase 74 ${label}.safety metric population is invalid.`);
    }
    return {
      safety: Object.fromEntries(names.map((name) => [
        name,
        unitValue(safety[name], `${label}.safety.${name}`),
      ])),
    };
  }
  assertExactKeys(record, ["e4"], label);
  const formats = recordValue(record.e4, `${label}.e4`);
  assertExactKeys(formats, SUITE_E4_FORMATS, `${label}.e4`);
  const e4 = Object.fromEntries(SUITE_E4_FORMATS.map((format) => [
    format,
    metricMap(formats[format], `${label}.e4.${format}`),
  ])) as Record<EvidenceLedgerFormat, Record<string, number>>;
  const names = Object.keys(e4.prose).sort().join("\0");
  if (SUITE_E4_FORMATS.some((format) =>
    Object.keys(e4[format]).sort().join("\0") !== names
  )) {
    throw new Error(`Phase 74 ${label}.e4 metric population drifted.`);
  }
  return { e4 };
}

function suiteScoreSignature(scores: Phase74ProtectionSuiteBranchScores): string {
  if (scores.protections !== undefined) {
    return `protections:${Object.keys(scores.protections).sort().join("\0")}`;
  }
  if (scores.safety !== undefined) {
    return `safety:${Object.keys(scores.safety).sort().join("\0")}`;
  }
  const names = Object.keys(scores.e4?.prose ?? {}).sort().join("\0");
  return `e4:${names}`;
}

function parseSuiteRow(
  value: unknown,
  suite: Phase74ProtectionSuite,
  label: string,
): Phase74ProtectionSuiteCaseRow {
  const record = recordValue(value, label);
  assertExactKeys(record, ["baseline", "candidate", "caseId"], label);
  const baseline = parseSuiteScores(record.baseline, suite, `${label}.baseline`);
  const candidate = parseSuiteScores(record.candidate, suite, `${label}.candidate`);
  if (suiteScoreSignature(baseline) !== suiteScoreSignature(candidate)) {
    throw new Error(`Phase 74 ${label} branch metric population drifted.`);
  }
  return {
    baseline,
    candidate,
    caseId: nonEmptyString(record.caseId, `${label}.caseId`),
  };
}

function parseReplicate(value: unknown): Phase74ProtectionReplicate {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error("Phase 74 protection suite replicate must be 1, 2, or 3.");
  }
  return value;
}

function validateSuiteRows(input: {
  identity: Phase74ProtectionRunIdentity;
  rows: readonly Phase74ProtectionSuiteCaseRow[];
}): void {
  const caseIds = input.rows.map(({ caseId }) => caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("Phase 74 protection suite run contains duplicate case IDs.");
  }
  if (
    caseIds.length !== input.identity.population.caseCount ||
    hashPhase74ProtectionCaseIds(caseIds) !==
      input.identity.population.caseIdsSha256
  ) {
    throw new Error("Phase 74 protection suite population does not match identity.");
  }
  const signature = suiteScoreSignature(input.rows[0]!.baseline);
  if (input.rows.some((row) =>
    suiteScoreSignature(row.baseline) !== signature ||
    suiteScoreSignature(row.candidate) !== signature
  )) {
    throw new Error("Phase 74 protection suite metric population drifted.");
  }
}

export async function loadPhase74FrozenProtectionSuiteRunArtifact(
  path: string,
): Promise<LoadedPhase74FrozenProtectionSuiteRunArtifact> {
  const artifactPath = resolve(path);
  const artifactBytes = await readFile(artifactPath);
  const record = recordValue(
    JSON.parse(artifactBytes.toString("utf8")) as unknown,
    "protection suite run artifact",
  );
  assertExactKeys(record, [
    "artifactKind",
    "executionFailures",
    "identity",
    "rawArtifact",
    "replicate",
    "rows",
    "runId",
    "schemaVersion",
    "suite",
  ], "protection suite run artifact");
  if (
    record.artifactKind !== "phase74-frozen-protection-suite-run" ||
    record.schemaVersion !== 1
  ) {
    throw new Error(
      "Phase 74 protection suite run artifact kind or schemaVersion is invalid.",
    );
  }
  if (record.executionFailures !== 0) {
    throw new Error(
      "Phase 74 protection suite evidence requires zero execution failures.",
    );
  }
  if (!Array.isArray(record.rows) || record.rows.length === 0) {
    throw new Error("Phase 74 protection suite rows must be non-empty.");
  }
  const suite = parseSuite(record.suite, "protection suite run suite");
  const rows = record.rows.map((row, index) =>
    parseSuiteRow(row, suite, `protection suite run rows[${index}]`)
  );
  const identity = parsePhase74ProtectionRunIdentity(
    record.identity,
    "protection suite run identity",
  );
  validateSuiteRows({ identity, rows });
  const rawReference = recordValue(
    record.rawArtifact,
    "protection suite run rawArtifact",
  );
  assertExactKeys(
    rawReference,
    ["path", "sha256"],
    "protection suite run rawArtifact",
  );
  const rawArtifactPath = resolve(
    dirname(artifactPath),
    nonEmptyString(rawReference.path, "protection suite run rawArtifact.path"),
  );
  const rawArtifactSha256 = nonEmptyString(
    rawReference.sha256,
    "protection suite run rawArtifact.sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(rawArtifactSha256)) {
    throw new Error("Phase 74 protection suite raw SHA-256 is invalid.");
  }
  const rawBytes = await readFile(rawArtifactPath);
  if (sha256(rawBytes) !== rawArtifactSha256) {
    throw new Error("Phase 74 protection suite raw SHA-256 mismatch.");
  }
  const raw = recordValue(
    JSON.parse(rawBytes.toString("utf8")) as unknown,
    "protection suite raw artifact",
  );
  assertExactKeys(raw, [
    "artifactKind",
    "executionFailures",
    "failures",
    "population",
    "replicate",
    "rows",
    "runId",
    "schemaVersion",
    "suite",
  ], "protection suite raw artifact");
  if (
    raw.artifactKind !== "phase74-frozen-protection-suite-raw" ||
    raw.schemaVersion !== 1 ||
    raw.executionFailures !== 0 ||
    !Array.isArray(raw.failures) ||
    raw.failures.length !== 0
  ) {
    throw new Error("Phase 74 protection suite raw artifact is invalid.");
  }
  if (canonicalJson(parseSuite(raw.suite, "protection suite raw suite")) !==
    canonicalJson(suite)) {
    throw new Error("Phase 74 protection suite raw suite drifted.");
  }
  const replicate = parseReplicate(record.replicate);
  const runId = nonEmptyString(record.runId, "protection suite runId");
  if (raw.replicate !== replicate || raw.runId !== runId) {
    throw new Error("Phase 74 protection suite raw run identity drifted.");
  }
  const population = recordValue(
    raw.population,
    "protection suite raw population",
  );
  assertExactKeys(
    population,
    ["caseCount", "caseIdsSha256"],
    "protection suite raw population",
  );
  if (
    population.caseCount !== identity.population.caseCount ||
    population.caseIdsSha256 !== identity.population.caseIdsSha256
  ) {
    throw new Error("Phase 74 protection suite raw population drifted.");
  }
  if (!Array.isArray(raw.rows) || raw.rows.length !== rows.length) {
    throw new Error("Phase 74 protection suite raw rows drifted.");
  }
  const rawRows = raw.rows.map((value, index) => {
    const row = recordValue(value, `protection suite raw rows[${index}]`);
    assertExactKeys(
      row,
      ["baseline", "candidate", "caseId", "inputSha256"],
      `protection suite raw rows[${index}]`,
    );
    if (!/^[a-f0-9]{64}$/u.test(String(row.inputSha256))) {
      throw new Error("Phase 74 protection suite raw input SHA-256 is invalid.");
    }
    const branch = (name: Phase74ProtectionBranch) => {
      const branchRecord = recordValue(
        row[name],
        `protection suite raw rows[${index}].${name}`,
      );
      assertExactKeys(
        branchRecord,
        ["rawOutput", "scores"],
        `protection suite raw rows[${index}].${name}`,
      );
      return parseSuiteScores(
        branchRecord.scores,
        suite,
        `protection suite raw rows[${index}].${name}.scores`,
      );
    };
    return {
      baseline: branch("baseline"),
      candidate: branch("candidate"),
      caseId: nonEmptyString(
        row.caseId,
        `protection suite raw rows[${index}].caseId`,
      ),
    };
  });
  if (canonicalJson(rawRows) !== canonicalJson(rows)) {
    throw new Error(
      "Phase 74 protection suite raw outcomes do not match frozen rows.",
    );
  }
  return {
    artifactPath,
    artifactSha256: sha256(artifactBytes),
    identity,
    rawArtifactPath,
    rawArtifactSha256,
    replicate,
    rows,
    runId,
    suite,
  };
}

export async function runPhase74ProtectionSuiteCases<Input>(input: {
  artifactPath: string;
  cases: readonly Phase74ProtectionCase<Input>[];
  evaluate: (input: {
    branch: Phase74ProtectionBranch;
    caseId: string;
    input: Input;
  }) => Promise<Phase74ProtectionSuiteEvaluationResult>;
  identity: Phase74ProtectionRunIdentityInput;
  rawArtifactPath: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  suite: Phase74ProtectionSuite;
}): Promise<Phase74ProtectionSuiteRunResult> {
  const artifactPath = resolve(input.artifactPath);
  const rawArtifactPath = resolve(input.rawArtifactPath);
  if (artifactPath === rawArtifactPath) {
    throw new Error(
      "Phase 74 protection suite run and raw artifact paths must differ.",
    );
  }
  const suite = parseSuite(input.suite, "protection suite");
  const caseIds = validateCasePopulation(input.cases);
  const caseIdsSha256 = hashPhase74ProtectionCaseIds(caseIds);
  const rows: Phase74ProtectionSuiteRawRow[] = [];
  const failures: Phase74ProtectionRawFailure[] = [];
  for (const testCase of input.cases) {
    const inputSnapshot = cloneJson(testCase.input, `${testCase.caseId} input`);
    const evaluate = async (branch: Phase74ProtectionBranch) => {
      const result = cloneJson(
        await input.evaluate({
          branch,
          caseId: testCase.caseId,
          input: cloneJson(inputSnapshot, `${testCase.caseId} ${branch} input`),
        }),
        `${testCase.caseId} ${branch} result`,
      );
      parseSuiteScores(result.scores, suite, `${testCase.caseId} ${branch}`);
      return result;
    };
    let baseline: Phase74ProtectionSuiteEvaluationResult;
    try {
      baseline = await evaluate("baseline");
    } catch (error) {
      failures.push(errorDetails(error, "baseline", testCase.caseId));
      continue;
    }
    let candidate: Phase74ProtectionSuiteEvaluationResult;
    try {
      candidate = await evaluate("candidate");
    } catch (error) {
      failures.push(errorDetails(error, "candidate", testCase.caseId));
      continue;
    }
    rows.push({
      baseline,
      candidate,
      caseId: testCase.caseId,
      inputSha256: hashPhase74ProtectionValue(inputSnapshot),
    });
  }
  const rawArtifact: Phase74ProtectionSuiteRawArtifact = {
    artifactKind: "phase74-frozen-protection-suite-raw",
    executionFailures: failures.length,
    failures,
    population: { caseCount: caseIds.length, caseIdsSha256 },
    replicate: input.replicate,
    rows,
    runId: input.runId,
    schemaVersion: 1,
    suite,
  };
  await writeFrozenJson(rawArtifactPath, rawArtifact);
  const rawText = `${JSON.stringify(rawArtifact, null, 2)}\n`;
  const artifact: Phase74FrozenProtectionSuiteRunArtifact = {
    artifactKind: "phase74-frozen-protection-suite-run",
    executionFailures: failures.length,
    identity: {
      dataset: input.identity.dataset,
      judge: input.identity.judge,
      model: input.identity.model,
      pipeline: input.identity.pipeline,
      population: {
        caseCount: caseIds.length,
        caseIdsSha256,
        id: input.identity.populationId,
      },
      prompt: input.identity.prompt,
      source: input.identity.source,
    },
    rawArtifact: {
      path: relative(dirname(artifactPath), rawArtifactPath),
      sha256: sha256(rawText),
    },
    replicate: input.replicate,
    rows: rows.map(({ baseline, candidate, caseId }) => ({
      baseline: baseline.scores,
      candidate: candidate.scores,
      caseId,
    })),
    runId: input.runId,
    schemaVersion: 1,
    suite,
  };
  await writeFrozenJson(artifactPath, artifact);
  if (failures.length > 0) {
    const suffix = failures.length === 1 ? "failure" : "failures";
    throw new Error(
      `Phase 74 protection suite run recorded ${failures.length} execution ${suffix}; artifact is not composable.`,
    );
  }
  await loadPhase74FrozenProtectionSuiteRunArtifact(artifactPath);
  return { artifact, artifactPath, rawArtifactPath };
}
