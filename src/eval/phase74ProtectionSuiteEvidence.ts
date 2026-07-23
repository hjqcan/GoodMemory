import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";
import {
  PHASE74_BEAM_SAFETY_SUITE,
} from "./phase74BeamSafetyProtection";
import type {
  Phase74ProtectionRunIdentity,
  Phase74ProtectionSafetyMetric,
} from "./phase74ProtectionContracts";
import {
  PHASE74_MAB_PROTECTION_SUITE,
  PHASE74_MEMORY_AGENT_BENCH_PROTECTION_VERIFIER,
} from "./phase74MemoryAgentBenchProtectionVerifier";
import {
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_UPDATE_SUITE,
} from "./phase74HaluMemProtectionVerifier";
import {
  hashPhase74ProtectionValue,
  loadPhase74FrozenProtectionSuiteRunArtifact,
} from "./phase74ProtectionRun";
import type {
  LoadedPhase74FrozenProtectionSuiteRunArtifact,
  Phase74ProtectionSuiteBranchScores,
  Phase74ProtectionSuiteKind,
} from "./phase74ProtectionRun";
import {
  describePhase74ProtectionCallBudget,
  isPhase74ProtectionPlanPromotionAdmissible,
  loadPhase74ProtectionPlan,
} from "./phase74ProtectionPlan";
import type {
  LoadedPhase74ProtectionPlan,
  Phase74ProtectionPlanAdmissionClass,
} from "./phase74ProtectionPlan";
import type { Phase74ProtectionEvidence } from "./phase74PromotionGate";
import type {
  Phase74ProtectionDatasetReference,
  Phase74ProtectionSuiteVerifier,
} from "./phase74ProtectionVerifier";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "./phase74ProtectionVerifier";
import type { EvalRunJsonObject } from "./runIdentity";

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
] as const satisfies readonly Phase74ProtectionSafetyMetric[];
const SUITE_KINDS = [
  "benchmark-protection",
  "e4",
  "safety",
] as const satisfies readonly Phase74ProtectionSuiteKind[];
const DERIVATION_METHOD =
  "paired-case-mean-per-suite-across-three-replicates-v1" as const;
const MANIFEST_ADMISSION = "canonical-verifier-bound-v1" as const;
export const PHASE74_BEAM_LIVE_CLOSURE_VERIFIER_ID =
  "phase74-beam-live-closure-v1";
export const PHASE74_HALUMEM_LIVE_CLOSURE_VERIFIER_ID =
  "phase74-halumem-live-closure-v1";
const DEFAULT_VERIFIERS = [
  PHASE74_MEMORY_AGENT_BENCH_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER,
] as const satisfies readonly Phase74ProtectionSuiteVerifier[];

export interface Phase74ProtectionSuiteManifestEntry {
  dataset: Phase74ProtectionDatasetReference;
  id: string;
  identityHash: string;
  kind: Phase74ProtectionSuiteKind;
  requiredMetrics: string[];
  verifierId: string;
}

export interface Phase74ProtectionSuiteManifest {
  admission: typeof MANIFEST_ADMISSION;
  artifactKind: "phase74-protection-suite-manifest";
  schemaVersion: 2;
  suites: Phase74ProtectionSuiteManifestEntry[];
}

interface Phase74ProtectionSuiteSourceFile {
  artifactPath: string;
  artifactSha256: string;
  plannedRunSha256?: string;
  rawArtifactPath: string;
  rawArtifactSha256: string;
  replicate: 1 | 2 | 3;
  runId: string;
}

export interface Phase74ProtectionFileReference {
  path: string;
  sha256: string;
}

export interface Phase74ProtectionLiveClosureReceipt {
  callBudgetArtifact: Phase74ProtectionFileReference;
  closureArtifact: Phase74ProtectionFileReference;
  closureVerifier: Phase74ProtectionRunIdentity["source"];
  kind: "beam" | "halumem";
  planSha256: string;
  plannedRunSha256s: string[];
  replicate: 1 | 2 | 3;
  runIds: string[];
  suiteIds: string[];
  usageArtifacts: Phase74ProtectionFileReference[];
}

export interface Phase74ProtectionLiveClosureVerifier {
  verify(input: {
    manifest: LoadedPhase74ProtectionSuiteManifest;
    plan: LoadedPhase74ProtectionPlan;
    runs: readonly LoadedPhase74FrozenProtectionSuiteRunArtifact[];
  }): Promise<readonly Phase74ProtectionLiveClosureReceipt[]>;
}

interface Phase74ProtectionSuiteSource {
  caseCountPerReplicate: number;
  files: [
    Phase74ProtectionSuiteSourceFile,
    Phase74ProtectionSuiteSourceFile,
    Phase74ProtectionSuiteSourceFile,
  ];
  dataset: Phase74ProtectionDatasetReference;
  id: string;
  identityHash: string;
  kind: Phase74ProtectionSuiteKind;
  pairedRowCount: number;
  requiredMetrics: string[];
  source: Phase74ProtectionRunIdentity["source"];
  verifierId: string;
}

interface Phase74FrozenProtectionSuiteEvidenceBase {
  artifactKind: "phase74-frozen-protection-suite-evidence";
  derivation: {
    method: typeof DERIVATION_METHOD;
    pairedRowCount: number;
    replicateCountPerSuite: 3;
    suiteCount: number;
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
  source: {
    beamContractSources?: Phase74ProtectionFileReference[];
    evaluatorSource: Phase74ProtectionRunIdentity["source"];
    executionReceipts?: Phase74ProtectionLiveClosureReceipt[];
    manifest: {
      path: string;
      sha256: string;
    };
    profile?: Phase74ProtectionExecutionProfile;
    suites: Phase74ProtectionSuiteSource[];
  };
}

export interface Phase74ProtectionExecutionProfile {
  embedding: EvalRunJsonObject;
  reranker: EvalRunJsonObject;
}

export interface Phase74FrozenDiagnosticProtectionSuiteEvidence extends
  Phase74FrozenProtectionSuiteEvidenceBase {
  admission?: never;
  schemaVersion: 1;
  source: Phase74FrozenProtectionSuiteEvidenceBase["source"] & {
    plan?: never;
  };
}

export interface Phase74FrozenPlannedProtectionSuiteEvidence extends
  Phase74FrozenProtectionSuiteEvidenceBase {
  admission: Phase74ProtectionPlanAdmissionClass;
  schemaVersion: 2;
  source: Phase74FrozenProtectionSuiteEvidenceBase["source"] & {
    beamContractSources: Phase74ProtectionFileReference[];
    executionReceipts: Phase74ProtectionLiveClosureReceipt[];
    plan: { path: string; sha256: string };
    profile?: Phase74ProtectionExecutionProfile;
  };
}

export type Phase74FrozenProtectionSuiteEvidence =
  | Phase74FrozenDiagnosticProtectionSuiteEvidence
  | Phase74FrozenPlannedProtectionSuiteEvidence;

export interface LoadedPhase74FrozenProtectionSuiteEvidence {
  evidence: Phase74FrozenProtectionSuiteEvidence;
  sha256: string;
}

export interface LoadedPhase74ProtectionSuiteManifest {
  manifest: Phase74ProtectionSuiteManifest;
  path: string;
  sha256: string;
}

export interface Phase74ProtectionSuiteEvidenceDependencies {
  additionalVerifiers?: readonly Phase74ProtectionSuiteVerifier[];
  beamContractSourceFiles?: readonly string[];
  liveClosureVerifier?: Phase74ProtectionLiveClosureVerifier;
  verifiers?: readonly Phase74ProtectionSuiteVerifier[];
}

export function isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(
  evidence: Phase74FrozenProtectionSuiteEvidence,
): evidence is Phase74FrozenPlannedProtectionSuiteEvidence & {
  admission: "promotion-admissible";
} {
  return evidence.schemaVersion === 2 &&
    evidence.admission === "promotion-admissible" &&
    evidence.source.plan !== undefined &&
    evidence.source.profile !== undefined &&
    evidence.source.executionReceipts.length === 6 &&
    evidence.source.beamContractSources.length === 1;
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
  if (
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
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

function kindValue(value: unknown, label: string): Phase74ProtectionSuiteKind {
  if (!(SUITE_KINDS as readonly unknown[]).includes(value)) {
    throw new Error(`Phase 74 ${label} is invalid.`);
  }
  return value as Phase74ProtectionSuiteKind;
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

function fileReference(
  value: unknown,
  label: string,
): Phase74ProtectionFileReference {
  const record = recordValue(value, label);
  assertExactKeys(record, ["path", "sha256"], label);
  const path = stringValue(record.path, `${label}.path`);
  if (!isAbsolute(path)) {
    throw new Error(`Phase 74 ${label}.path must be absolute.`);
  }
  return {
    path,
    sha256: sha256Value(record.sha256, `${label}.sha256`),
  };
}

async function sourceFileReference(
  path: string,
  label: string,
): Promise<Phase74ProtectionFileReference> {
  const absolutePath = resolve(stringValue(path, label));
  return {
    path: absolutePath,
    sha256: sha256(await readFile(absolutePath)),
  };
}

function closureVerifierDescriptor(
  kind: Phase74ProtectionLiveClosureReceipt["kind"],
): Phase74ProtectionRunIdentity["source"] {
  const id = kind === "beam"
    ? PHASE74_BEAM_LIVE_CLOSURE_VERIFIER_ID
    : PHASE74_HALUMEM_LIVE_CLOSURE_VERIFIER_ID;
  return { id, sha256: hashPhase74ProtectionValue({ id }) };
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Phase 74 ${label} must be a non-empty array.`);
  }
  const values = value.map((entry, index) =>
    stringValue(entry, `${label}[${index}]`)
  );
  if (new Set(values).size !== values.length) {
    throw new Error(`Phase 74 ${label} must not contain duplicates.`);
  }
  return values.sort();
}

function parseLiveClosureReceipt(
  value: unknown,
  index: number,
): Phase74ProtectionLiveClosureReceipt {
  const label = `protection live closure receipts[${index}]`;
  const record = recordValue(value, label);
  assertExactKeys(record, [
    "callBudgetArtifact",
    "closureArtifact",
    "closureVerifier",
    "kind",
    "planSha256",
    "plannedRunSha256s",
    "replicate",
    "runIds",
    "suiteIds",
    "usageArtifacts",
  ], label);
  if (record.kind !== "beam" && record.kind !== "halumem") {
    throw new Error(`Phase 74 ${label}.kind is invalid.`);
  }
  if (
    record.replicate !== 1 &&
    record.replicate !== 2 &&
    record.replicate !== 3
  ) {
    throw new Error(`Phase 74 ${label}.replicate must be 1, 2, or 3.`);
  }
  if (!Array.isArray(record.usageArtifacts) || record.usageArtifacts.length === 0) {
    throw new Error(`Phase 74 ${label}.usageArtifacts must be non-empty.`);
  }
  const receipt: Phase74ProtectionLiveClosureReceipt = {
    callBudgetArtifact: fileReference(
      record.callBudgetArtifact,
      `${label}.callBudgetArtifact`,
    ),
    closureArtifact: fileReference(
      record.closureArtifact,
      `${label}.closureArtifact`,
    ),
    closureVerifier: recordValue(
      record.closureVerifier,
      `${label}.closureVerifier`,
    ) as unknown as Phase74ProtectionRunIdentity["source"],
    kind: record.kind,
    planSha256: sha256Value(record.planSha256, `${label}.planSha256`),
    plannedRunSha256s: stringArray(
      record.plannedRunSha256s,
      `${label}.plannedRunSha256s`,
    ).map((hash, hashIndex) =>
      sha256Value(hash, `${label}.plannedRunSha256s[${hashIndex}]`)
    ),
    replicate: record.replicate,
    runIds: stringArray(record.runIds, `${label}.runIds`),
    suiteIds: stringArray(record.suiteIds, `${label}.suiteIds`),
    usageArtifacts: record.usageArtifacts.map((artifact, artifactIndex) =>
      fileReference(
        artifact,
        `${label}.usageArtifacts[${artifactIndex}]`,
      )
    ).sort((left, right) => left.path.localeCompare(right.path)),
  };
  if (
    canonicalJson(receipt.closureVerifier) !==
      canonicalJson(closureVerifierDescriptor(receipt.kind))
  ) {
    throw new Error(
      `Phase 74 ${label}.closureVerifier is not canonical.`,
    );
  }
  return receipt;
}

async function validatePromotionClosureReceipts(input: {
  loadedPlan: LoadedPhase74ProtectionPlan;
  receipts: readonly Phase74ProtectionLiveClosureReceipt[];
  runs: readonly LoadedPhase74FrozenProtectionSuiteRunArtifact[];
}): Promise<Phase74ProtectionLiveClosureReceipt[]> {
  const receipts = input.receipts.map(parseLiveClosureReceipt)
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.replicate - right.replicate
    );
  if (receipts.length !== 6) {
    throw new Error(
      "Phase 74 promotion protection evidence requires six live closure receipts.",
    );
  }
  const expectedSuiteIds: Record<
    Phase74ProtectionLiveClosureReceipt["kind"],
    readonly string[]
  > = {
    beam: [PHASE74_BEAM_SAFETY_SUITE.id],
    halumem: [
      PHASE74_HALUMEM_E4_SUITE.id,
      PHASE74_HALUMEM_PRIVACY_SUITE.id,
      PHASE74_HALUMEM_UPDATE_SUITE.id,
    ].sort(),
  };
  const liveRuns = input.runs.filter(({ suite }) =>
    suite.id !== PHASE74_MAB_PROTECTION_SUITE.id
  );
  for (const receipt of receipts) {
    const expectedRuns = liveRuns.filter(({ replicate, suite }) =>
      replicate === receipt.replicate &&
      expectedSuiteIds[receipt.kind].includes(suite.id)
    );
    if (
      receipt.planSha256 !== input.loadedPlan.sha256 ||
      canonicalJson(receipt.suiteIds) !==
        canonicalJson(expectedSuiteIds[receipt.kind]) ||
      canonicalJson(receipt.runIds) !==
        canonicalJson(expectedRuns.map(({ runId }) => runId).sort()) ||
      canonicalJson(receipt.plannedRunSha256s) !==
        canonicalJson(expectedRuns.map((run) => {
          if (run.schemaVersion !== 2) {
            throw new Error(
              "Phase 74 live closure receipt referenced an unplanned run.",
            );
          }
          return run.plannedRunSha256;
        }).sort())
    ) {
      throw new Error(
        "Phase 74 live closure receipt drifted from its planned runs.",
      );
    }
    const references = [
      receipt.callBudgetArtifact,
      receipt.closureArtifact,
      ...receipt.usageArtifacts,
    ];
    if (new Set(references.map(({ path }) => path)).size !== references.length) {
      throw new Error(
        "Phase 74 live closure receipt contains duplicate artifact paths.",
      );
    }
    for (const reference of references) {
      if (sha256(await readFile(reference.path)) !== reference.sha256) {
        throw new Error(
          `Phase 74 live closure receipt artifact drifted: ${reference.path}.`,
        );
      }
    }
    const callBudget = recordValue(
      JSON.parse(await readFile(receipt.callBudgetArtifact.path, "utf8")),
      "live closure call budget",
    );
    const callBudgetDescriptor = describePhase74ProtectionCallBudget({
      embeddingSpendLimitUsd: callBudget.embeddingSpendLimitUsd as number,
      maxLanguageCalls: callBudget.maxLanguageCalls as number,
    });
    if (expectedRuns.some((run) => {
      if (run.schemaVersion !== 2) {
        return true;
      }
      const planned = input.loadedPlan.plan.runs.find((plannedRun) =>
        hashPhase74ProtectionValue(plannedRun) === run.plannedRunSha256
      );
      return planned === undefined ||
        canonicalJson(planned.controls.callBudget) !==
          canonicalJson(callBudgetDescriptor);
    })) {
      throw new Error(
        "Phase 74 live closure call budget drifted from its planned runs.",
      );
    }
  }
  const expectedHashes = liveRuns.map((run) => {
    if (run.schemaVersion !== 2) {
      throw new Error("Phase 74 live protection run must be planned.");
    }
    return run.plannedRunSha256;
  }).sort();
  const actualHashes = receipts.flatMap(({ plannedRunSha256s }) =>
    plannedRunSha256s
  ).sort();
  if (
    new Set(actualHashes).size !== expectedHashes.length ||
    canonicalJson(actualHashes) !== canonicalJson(expectedHashes)
  ) {
    throw new Error(
      "Phase 74 live closure receipts do not cover every live planned run exactly once.",
    );
  }
  return receipts;
}

export function hashPhase74ProtectionSuiteIdentity(
  identity: Phase74ProtectionRunIdentity,
): string {
  return sha256(canonicalJson(identity));
}

export function phase74ProtectionSuiteMetricName(
  suiteId: string,
  metric: string,
): string {
  return `${suiteId}::${metric}`;
}

function metricNames(value: unknown, label: string): string[] {
  const record = recordValue(value, label);
  const names = Object.keys(record).sort();
  if (names.length === 0) {
    throw new Error(`Phase 74 ${label} must contain at least one metric.`);
  }
  return names;
}

function parseManifest(value: unknown): Phase74ProtectionSuiteManifest {
  const record = recordValue(value, "protection suite manifest");
  if (
    record.admission !== MANIFEST_ADMISSION ||
    record.artifactKind !== "phase74-protection-suite-manifest" ||
    record.schemaVersion !== 2
  ) {
    throw new Error(
      "Phase 74 protection suite manifest requires canonical verifier-bound admission.",
    );
  }
  assertExactKeys(
    record,
    ["admission", "artifactKind", "schemaVersion", "suites"],
    "protection suite manifest",
  );
  if (!Array.isArray(record.suites) || record.suites.length === 0) {
    throw new Error("Phase 74 protection suite manifest suites must be non-empty.");
  }
  const suites = record.suites.map((value, index) => {
    const suite = recordValue(value, `protection suite manifest suites[${index}]`);
    assertExactKeys(
      suite,
      [
        "dataset",
        "id",
        "identityHash",
        "kind",
        "requiredMetrics",
        "verifierId",
      ],
      `protection suite manifest suites[${index}]`,
    );
    const dataset = recordValue(
      suite.dataset,
      `protection suite manifest suites[${index}].dataset`,
    );
    assertExactKeys(
      dataset,
      ["id", "path", "sha256"],
      `protection suite manifest suites[${index}].dataset`,
    );
    const datasetPath = stringValue(
      dataset.path,
      `protection suite manifest suites[${index}].dataset.path`,
    );
    if (!isAbsolute(datasetPath)) {
      throw new Error(
        `Phase 74 protection suite manifest suites[${index}].dataset.path must be absolute.`,
      );
    }
    if (!Array.isArray(suite.requiredMetrics) || suite.requiredMetrics.length === 0) {
      throw new Error(
        `Phase 74 protection suite manifest suites[${index}].requiredMetrics must be non-empty.`,
      );
    }
    const requiredMetrics = suite.requiredMetrics.map((metric, metricIndex) =>
      stringValue(
        metric,
        `protection suite manifest suites[${index}].requiredMetrics[${metricIndex}]`,
      )
    ).sort();
    if (new Set(requiredMetrics).size !== requiredMetrics.length) {
      throw new Error("Phase 74 protection suite manifest contains duplicate required metrics.");
    }
    return {
      dataset: {
        id: stringValue(
          dataset.id,
          `protection suite manifest suites[${index}].dataset.id`,
        ),
        path: datasetPath,
        sha256: sha256Value(
          dataset.sha256,
          `protection suite manifest suites[${index}].dataset.sha256`,
        ),
      },
      id: stringValue(suite.id, `protection suite manifest suites[${index}].id`),
      identityHash: sha256Value(
        suite.identityHash,
        `protection suite manifest suites[${index}].identityHash`,
      ),
      kind: kindValue(
        suite.kind,
        `protection suite manifest suites[${index}].kind`,
      ),
      requiredMetrics,
      verifierId: stringValue(
        suite.verifierId,
        `protection suite manifest suites[${index}].verifierId`,
      ),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(suites.map(({ id }) => id)).size !== suites.length) {
    throw new Error("Phase 74 protection suite manifest contains duplicate suite IDs.");
  }
  for (const kind of SUITE_KINDS) {
    if (!suites.some((suite) => suite.kind === kind)) {
      throw new Error(`Phase 74 protection suite manifest is missing kind ${kind}.`);
    }
  }
  const safetyMetrics = new Set(
    suites.filter(({ kind }) => kind === "safety")
      .flatMap(({ requiredMetrics }) => requiredMetrics),
  );
  if (
    safetyMetrics.size !== SAFETY_METRICS.length ||
    [...safetyMetrics].some((metric) =>
      !(SAFETY_METRICS as readonly string[]).includes(metric)
    )
  ) {
    throw new Error("Phase 74 protection suite manifest must cover every safety metric.");
  }
  return {
    admission: MANIFEST_ADMISSION,
    artifactKind: "phase74-protection-suite-manifest",
    schemaVersion: 2,
    suites,
  };
}

export async function loadPhase74ProtectionSuiteManifest(
  path: string,
): Promise<LoadedPhase74ProtectionSuiteManifest> {
  const manifestPath = resolve(path);
  const bytes = await readFile(manifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Phase 74 protection suite manifest must be valid JSON.", {
      cause: error,
    });
  }
  return {
    manifest: parseManifest(parsed),
    path: manifestPath,
    sha256: sha256(bytes),
  };
}

export async function loadPhase74ProtectionBlueprintDescriptor(
  path: string,
): Promise<{ id: typeof PHASE74_PROTECTION_BLUEPRINT_ID; sha256: string }> {
  const loaded = await loadPhase74ProtectionSuiteManifest(path);
  return {
    id: PHASE74_PROTECTION_BLUEPRINT_ID,
    sha256: loaded.sha256,
  };
}

function verifierForSuite(
  manifest: Phase74ProtectionSuiteManifestEntry,
  verifiers: readonly Phase74ProtectionSuiteVerifier[],
): Phase74ProtectionSuiteVerifier {
  const matches = verifiers.filter(({ id }) => id === manifest.verifierId);
  if (matches.length !== 1) {
    throw new Error(
      `Phase 74 protection suite ${manifest.id} requires exactly one registered verifier ${manifest.verifierId}.`,
    );
  }
  const verifier = matches[0]!;
  if (
    verifier.suiteId !== manifest.id ||
    verifier.kind !== manifest.kind ||
    [...verifier.requiredMetrics].sort().join("\0") !==
      manifest.requiredMetrics.join("\0")
  ) {
    throw new Error(
      `Phase 74 protection suite ${manifest.id} canonical verifier binding drifted.`,
    );
  }
  return verifier;
}

async function verifySuiteRuns(input: {
  manifest: Phase74ProtectionSuiteManifestEntry;
  runs: readonly LoadedPhase74FrozenProtectionSuiteRunArtifact[];
  verifier: Phase74ProtectionSuiteVerifier;
}): Promise<void> {
  const datasetBytes = await readFile(input.manifest.dataset.path);
  if (sha256(datasetBytes) !== input.manifest.dataset.sha256) {
    throw new Error(
      `Phase 74 protection suite ${input.manifest.id} dataset SHA-256 drifted.`,
    );
  }
  for (const run of input.runs) {
    await input.verifier.verify({
      dataset: input.manifest.dataset,
      datasetBytes,
      run,
    });
  }
}

function scoreMetrics(
  scores: Phase74ProtectionSuiteBranchScores,
  kind: Phase74ProtectionSuiteKind,
  format?: EvidenceLedgerFormat,
): string[] {
  if (kind === "benchmark-protection") {
    return metricNames(scores.protections, "benchmark protection scores");
  }
  if (kind === "safety") {
    return metricNames(scores.safety, "safety scores");
  }
  return metricNames(scores.e4?.[format!], `E4 ${format} scores`);
}

function validateSuiteRuns(input: {
  manifest: Phase74ProtectionSuiteManifestEntry;
  runs: readonly LoadedPhase74FrozenProtectionSuiteRunArtifact[];
}): LoadedPhase74FrozenProtectionSuiteRunArtifact[] {
  if (input.runs.length !== 3) {
    throw new Error(
      `Phase 74 protection suite ${input.manifest.id} requires exactly three replicates.`,
    );
  }
  const runs = [...input.runs].sort((left, right) =>
    left.replicate - right.replicate
  );
  if (runs.some(({ replicate }, index) => replicate !== index + 1)) {
    throw new Error(
      `Phase 74 protection suite ${input.manifest.id} requires replicates 1, 2, and 3 exactly once.`,
    );
  }
  if (new Set(runs.map(({ runId }) => runId)).size !== runs.length) {
    throw new Error(`Phase 74 protection suite ${input.manifest.id} has duplicate run IDs.`);
  }
  const identity = canonicalJson(runs[0]!.identity);
  if (runs.some((run) => canonicalJson(run.identity) !== identity)) {
    throw new Error(
      `Phase 74 protection suite ${input.manifest.id} identity or population drift across replicates.`,
    );
  }
  if (
    hashPhase74ProtectionSuiteIdentity(runs[0]!.identity) !==
      input.manifest.identityHash
  ) {
    throw new Error(
      `Phase 74 protection suite ${input.manifest.id} identity hash does not match manifest.`,
    );
  }
  const expectedDataset = {
    id: input.manifest.dataset.id,
    sha256: input.manifest.dataset.sha256,
  };
  if (runs.some((run) =>
    canonicalJson(run.identity.dataset) !== canonicalJson(expectedDataset)
  )) {
    throw new Error(
      `Phase 74 protection suite ${input.manifest.id} dataset identity does not match manifest.`,
    );
  }
  const expectedMetrics = input.manifest.requiredMetrics.join("\0");
  for (const run of runs) {
    for (const row of run.rows) {
      for (const branch of [row.baseline, row.candidate]) {
        const formats = input.manifest.kind === "e4"
          ? EVIDENCE_LEDGER_FORMATS
          : [undefined];
        for (const format of formats) {
          if (
            scoreMetrics(branch, input.manifest.kind, format).join("\0") !==
              expectedMetrics
          ) {
            throw new Error(
              `Phase 74 protection suite ${input.manifest.id} required metric population drift.`,
            );
          }
        }
      }
    }
  }
  return runs;
}

function roundedMean(values: readonly number[]): number {
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(12),
  );
}

function deriveDelta(input: {
  metric: string;
  runs: readonly LoadedPhase74FrozenProtectionSuiteRunArtifact[];
  score: (
    scores: Phase74ProtectionSuiteBranchScores,
    metric: string,
  ) => number;
}): number {
  return roundedMean(input.runs.flatMap(({ rows }) => rows.map((row) =>
    input.score(row.candidate, input.metric) -
      input.score(row.baseline, input.metric)
  )));
}

function sourceFile(
  run: LoadedPhase74FrozenProtectionSuiteRunArtifact,
): Phase74ProtectionSuiteSourceFile {
  return {
    artifactPath: run.artifactPath,
    artifactSha256: run.artifactSha256,
    ...(run.schemaVersion === 2
      ? { plannedRunSha256: run.plannedRunSha256 }
      : {}),
    rawArtifactPath: run.rawArtifactPath,
    rawArtifactSha256: run.rawArtifactSha256,
    replicate: run.replicate,
    runId: run.runId,
  };
}

function validatePlannedRuns(input: {
  loadedManifest: LoadedPhase74ProtectionSuiteManifest;
  loadedPlan: LoadedPhase74ProtectionPlan;
  runs: readonly LoadedPhase74FrozenProtectionSuiteRunArtifact[];
}): void {
  if (input.loadedPlan.plan.runs.length !== 15 || input.runs.length !== 15) {
    throw new Error(
      "Phase 74 planned protection evidence requires exactly 15 run artifacts.",
    );
  }
  const expectedBlueprint = {
    id: PHASE74_PROTECTION_BLUEPRINT_ID,
    sha256: input.loadedManifest.sha256,
  };
  if (
    canonicalJson(input.loadedPlan.plan.protectionBlueprint) !==
      canonicalJson(expectedBlueprint)
  ) {
    throw new Error(
      "Phase 74 planned protection evidence blueprint drifted from its manifest.",
    );
  }
  if (input.runs.some(({ schemaVersion }) => schemaVersion !== 2)) {
    throw new Error(
      "Phase 74 planned protection evidence cannot mix schema-v1 and schema-v2 runs.",
    );
  }
  const plannedRuns = input.runs.filter(
    (run) => run.schemaVersion === 2,
  );
  if (plannedRuns.some(({ planSha256 }) =>
    planSha256 !== input.loadedPlan.sha256
  )) {
    throw new Error(
      "Phase 74 planned protection evidence run plan SHA-256 drifted.",
    );
  }
  const expectedRunHashes = input.loadedPlan.plan.runs
    .map(hashPhase74ProtectionValue)
    .sort();
  const actualRunHashes = plannedRuns
    .map(({ plannedRunSha256 }) => plannedRunSha256)
    .sort();
  if (
    new Set(actualRunHashes).size !== 15 ||
    actualRunHashes.join("\0") !== expectedRunHashes.join("\0")
  ) {
    throw new Error(
      "Phase 74 planned protection evidence has missing, extra, or duplicate planned runs.",
    );
  }
}

export async function buildPhase74FrozenProtectionSuiteEvidence(input: {
  manifestPath: string;
  planPath?: string;
  runArtifactPaths: readonly string[];
}, dependencies: Phase74ProtectionSuiteEvidenceDependencies = {}): Promise<Phase74FrozenProtectionSuiteEvidence> {
  const paths = input.runArtifactPaths.map((path) => resolve(path));
  if (new Set(paths).size !== paths.length) {
    throw new Error("Phase 74 protection suite evidence has a duplicate run artifact path.");
  }
  if (input.planPath !== undefined && paths.length !== 15) {
    throw new Error(
      "Phase 74 planned protection evidence requires exactly 15 run artifacts.",
    );
  }
  const loadedManifest = await loadPhase74ProtectionSuiteManifest(
    input.manifestPath,
  );
  const loadedPlan = input.planPath === undefined
    ? undefined
    : await loadPhase74ProtectionPlan(input.planPath);
  const verifiers = dependencies.verifiers ?? [
    ...DEFAULT_VERIFIERS,
    ...(dependencies.additionalVerifiers ?? []),
  ];
  const loadedRuns = await Promise.all(
    paths.map(loadPhase74FrozenProtectionSuiteRunArtifact),
  );
  if (loadedPlan === undefined) {
    if (loadedRuns.some(({ schemaVersion }) => schemaVersion !== 1)) {
      throw new Error(
        "Phase 74 unplanned diagnostic evidence accepts schema-v1 runs only.",
      );
    }
  } else {
    validatePlannedRuns({ loadedManifest, loadedPlan, runs: loadedRuns });
  }
  const manifestById = new Map(
    loadedManifest.manifest.suites.map((suite) => [suite.id, suite]),
  );
  for (const run of loadedRuns) {
    const expected = manifestById.get(run.suite.id);
    if (expected === undefined || expected.kind !== run.suite.kind) {
      throw new Error(`Phase 74 protection evidence contains unexpected suite ${run.suite.id}.`);
    }
  }

  const validated = new Map<string, LoadedPhase74FrozenProtectionSuiteRunArtifact[]>();
  for (const suite of loadedManifest.manifest.suites) {
    const runs = loadedRuns.filter((run) =>
      run.suite.id === suite.id && run.suite.kind === suite.kind
    );
    if (runs.length === 0) {
      throw new Error(`Phase 74 protection evidence is missing required suite ${suite.id}.`);
    }
    const verifier = verifierForSuite(suite, verifiers);
    const suiteRuns = validateSuiteRuns({ manifest: suite, runs });
    await verifySuiteRuns({
      manifest: suite,
      runs: suiteRuns,
      verifier,
    });
    validated.set(suite.id, suiteRuns);
  }

  const evaluatorSource = validated.get(
    loadedManifest.manifest.suites[0]!.id,
  )![0]!.identity.source;
  if ([...validated.values()].flat().some((run) =>
    canonicalJson(run.identity.source) !== canonicalJson(evaluatorSource)
  )) {
    throw new Error(
      "Phase 74 protection evaluator source drift across suites.",
    );
  }
  const executionReceipts = loadedPlan !== undefined &&
      isPhase74ProtectionPlanPromotionAdmissible(loadedPlan.plan) &&
      dependencies.liveClosureVerifier !== undefined
    ? await validatePromotionClosureReceipts({
        loadedPlan,
        receipts: await dependencies.liveClosureVerifier.verify({
          manifest: loadedManifest,
          plan: loadedPlan,
          runs: loadedRuns,
        }),
        runs: loadedRuns,
      })
    : [];
  const beamContractSources = loadedPlan === undefined
    ? []
    : await Promise.all(
        [...new Set(dependencies.beamContractSourceFiles ?? [])]
          .sort()
          .map((path, index) =>
            sourceFileReference(path, `BEAM contract source files[${index}]`)
          ),
      );

  const protections: Phase74ProtectionEvidence[] = [];
  const formatDeltas = Object.fromEntries(EVIDENCE_LEDGER_FORMATS.map((format) => [
    format,
    [] as Phase74ProtectionEvidence[],
  ])) as Record<EvidenceLedgerFormat, Phase74ProtectionEvidence[]>;
  const safetyDeltas = new Map<Phase74ProtectionSafetyMetric, number[]>();
  const sources: Phase74ProtectionSuiteSource[] = [];

  for (const suite of loadedManifest.manifest.suites) {
    const runs = validated.get(suite.id)!;
    if (suite.kind === "benchmark-protection") {
      for (const metric of suite.requiredMetrics) {
        protections.push({
          delta: deriveDelta({
            metric,
            runs,
            score: (scores, name) => scores.protections![name]!,
          }),
          name: phase74ProtectionSuiteMetricName(suite.id, metric),
        });
      }
    } else if (suite.kind === "e4") {
      for (const format of EVIDENCE_LEDGER_FORMATS) {
        for (const metric of suite.requiredMetrics) {
          formatDeltas[format].push({
            delta: deriveDelta({
              metric,
              runs,
              score: (scores, name) => scores.e4![format][name]!,
            }),
            name: phase74ProtectionSuiteMetricName(suite.id, metric),
          });
        }
      }
    } else {
      for (const metric of suite.requiredMetrics) {
        const typedMetric = metric as Phase74ProtectionSafetyMetric;
        const deltas = safetyDeltas.get(typedMetric) ?? [];
        deltas.push(deriveDelta({
          metric,
          runs,
          score: (scores, name) => scores.safety![
            name as Phase74ProtectionSafetyMetric
          ]!,
        }));
        safetyDeltas.set(typedMetric, deltas);
      }
    }
    sources.push({
      caseCountPerReplicate: runs[0]!.rows.length,
      dataset: suite.dataset,
      files: runs.map(sourceFile) as Phase74ProtectionSuiteSource["files"],
      id: suite.id,
      identityHash: suite.identityHash,
      kind: suite.kind,
      pairedRowCount: runs.reduce((total, { rows }) => total + rows.length, 0),
      requiredMetrics: suite.requiredMetrics,
      source: runs[0]!.identity.source,
      verifierId: suite.verifierId,
    });
  }

  const conservativeSafetyDelta = (
    metric: Phase74ProtectionSafetyMetric,
  ): number => {
    const deltas = safetyDeltas.get(metric)!;
    return metric === "hallucinationRate"
      ? Math.max(...deltas)
      : Math.min(...deltas);
  };
  const evidenceBase: Phase74FrozenProtectionSuiteEvidenceBase = {
    artifactKind: "phase74-frozen-protection-suite-evidence",
    derivation: {
      method: DERIVATION_METHOD,
      pairedRowCount: sources.reduce(
        (total, { pairedRowCount }) => total + pairedRowCount,
        0,
      ),
      replicateCountPerSuite: 3,
      suiteCount: sources.length,
    },
    e4: { formatDeltas },
    promotion: {
      protections,
      safety: {
        abstentionAccuracyDelta: conservativeSafetyDelta("abstentionAccuracy"),
        hallucinationRateDelta: conservativeSafetyDelta("hallucinationRate"),
        privacyPassRateDelta: conservativeSafetyDelta("privacyPassRate"),
        updateCorrectnessDelta: conservativeSafetyDelta("updateCorrectness"),
      },
    },
    source: {
      evaluatorSource,
      manifest: {
        path: loadedManifest.path,
        sha256: loadedManifest.sha256,
      },
      suites: sources,
    },
  };
  if (loadedPlan === undefined) {
    return { ...evidenceBase, schemaVersion: 1 };
  }
  return {
    ...evidenceBase,
    admission: "diagnostic",
    schemaVersion: 2,
    source: {
      ...evidenceBase.source,
      beamContractSources,
      executionReceipts,
      plan: {
        path: loadedPlan.path,
        sha256: loadedPlan.sha256,
      },
    },
  };
}

function sourcePaths(value: unknown): {
  manifestPath: string;
  planPath?: string;
  runArtifactPaths: string[];
} {
  const record = recordValue(value, "frozen protection suite evidence");
  if (
    record.artifactKind !== "phase74-frozen-protection-suite-evidence" ||
    (record.schemaVersion !== 1 && record.schemaVersion !== 2)
  ) {
    throw new Error(
      "Phase 74 frozen protection suite evidence kind or schemaVersion is invalid.",
    );
  }
  if (
    record.schemaVersion === 2 &&
    record.admission !== "diagnostic" &&
    record.admission !== "promotion-admissible"
  ) {
    throw new Error(
      "Phase 74 planned protection suite evidence admission is invalid.",
    );
  }
  const source = recordValue(record.source, "frozen protection suite evidence source");
  const manifest = recordValue(source.manifest, "protection suite evidence manifest");
  const manifestPath = stringValue(manifest.path, "protection suite evidence manifest.path");
  if (!isAbsolute(manifestPath)) {
    throw new Error("Phase 74 protection suite evidence manifest path must be absolute.");
  }
  if (!Array.isArray(source.suites) || source.suites.length === 0) {
    throw new Error("Phase 74 protection suite evidence source suites must be non-empty.");
  }
  const runArtifactPaths = source.suites.flatMap((value, suiteIndex) => {
    const suite = recordValue(value, `protection suite evidence source suites[${suiteIndex}]`);
    if (!Array.isArray(suite.files) || suite.files.length !== 3) {
      throw new Error("Phase 74 protection suite evidence source requires three files per suite.");
    }
    return suite.files.map((value, fileIndex) => {
      const file = recordValue(
        value,
        `protection suite evidence source suites[${suiteIndex}].files[${fileIndex}]`,
      );
      const path = stringValue(
        file.artifactPath,
        `protection suite evidence source suites[${suiteIndex}].files[${fileIndex}].artifactPath`,
      );
      if (!isAbsolute(path)) {
        throw new Error("Phase 74 protection suite evidence run paths must be absolute.");
      }
      return path;
    });
  });
  if (record.schemaVersion === 1) {
    return { manifestPath, runArtifactPaths };
  }
  const plan = recordValue(
    source.plan,
    "planned protection suite evidence plan",
  );
  const planPath = stringValue(
    plan.path,
    "planned protection suite evidence plan.path",
  );
  if (!isAbsolute(planPath)) {
    throw new Error("Phase 74 protection suite evidence plan path must be absolute.");
  }
  sha256Value(plan.sha256, "planned protection suite evidence plan.sha256");
  return { manifestPath, planPath, runArtifactPaths };
}

export async function rebuildPhase74FrozenProtectionSuiteEvidence(
  value: unknown,
  dependencies: Phase74ProtectionSuiteEvidenceDependencies = {},
): Promise<Phase74FrozenProtectionSuiteEvidence> {
  const source = sourcePaths(value);
  return buildPhase74FrozenProtectionSuiteEvidence({
    manifestPath: source.manifestPath,
    ...(source.planPath === undefined ? {} : { planPath: source.planPath }),
    runArtifactPaths: source.runArtifactPaths,
  }, dependencies);
}

export async function loadPhase74FrozenProtectionSuiteEvidence(
  path: string,
  dependencies: Phase74ProtectionSuiteEvidenceDependencies = {},
): Promise<LoadedPhase74FrozenProtectionSuiteEvidence> {
  const artifactPath = resolve(path);
  const bytes = await readFile(artifactPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Phase 74 frozen protection suite evidence must be valid JSON.", {
      cause: error,
    });
  }
  const derived = await rebuildPhase74FrozenProtectionSuiteEvidence(
    parsed,
    dependencies,
  );
  if (canonicalJson(parsed) !== canonicalJson(derived)) {
    throw new Error(
      "Phase 74 frozen protection suite evidence does not match its manifest and source runs.",
    );
  }
  return {
    evidence: derived,
    sha256: sha256(bytes),
  };
}
