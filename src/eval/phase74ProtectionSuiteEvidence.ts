import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";
import type {
  Phase74ProtectionRunIdentity,
  Phase74ProtectionSafetyMetric,
} from "./phase74ProtectionContracts";
import {
  PHASE74_MEMORY_AGENT_BENCH_PROTECTION_VERIFIER,
} from "./phase74MemoryAgentBenchProtectionVerifier";
import {
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER,
} from "./phase74HaluMemProtectionVerifier";
import {
  loadPhase74FrozenProtectionSuiteRunArtifact,
} from "./phase74ProtectionRun";
import type {
  LoadedPhase74FrozenProtectionSuiteRunArtifact,
  Phase74ProtectionSuiteBranchScores,
  Phase74ProtectionSuiteKind,
} from "./phase74ProtectionRun";
import type { Phase74ProtectionEvidence } from "./phase74PromotionGate";
import type {
  Phase74ProtectionDatasetReference,
  Phase74ProtectionSuiteVerifier,
} from "./phase74ProtectionVerifier";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "./phase74ProtectionVerifier";

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
  rawArtifactPath: string;
  rawArtifactSha256: string;
  replicate: 1 | 2 | 3;
  runId: string;
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

export interface Phase74FrozenProtectionSuiteEvidence {
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
  schemaVersion: 1;
  source: {
    evaluatorSource: Phase74ProtectionRunIdentity["source"];
    manifest: {
      path: string;
      sha256: string;
    };
    suites: Phase74ProtectionSuiteSource[];
  };
}

export interface LoadedPhase74FrozenProtectionSuiteEvidence {
  evidence: Phase74FrozenProtectionSuiteEvidence;
  sha256: string;
}

interface LoadedManifest {
  manifest: Phase74ProtectionSuiteManifest;
  path: string;
  sha256: string;
}

export interface Phase74ProtectionSuiteEvidenceDependencies {
  verifiers?: readonly Phase74ProtectionSuiteVerifier[];
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

async function loadManifest(path: string): Promise<LoadedManifest> {
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
  const loaded = await loadManifest(path);
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
    rawArtifactPath: run.rawArtifactPath,
    rawArtifactSha256: run.rawArtifactSha256,
    replicate: run.replicate,
    runId: run.runId,
  };
}

export async function buildPhase74FrozenProtectionSuiteEvidence(input: {
  manifestPath: string;
  runArtifactPaths: readonly string[];
}, dependencies: Phase74ProtectionSuiteEvidenceDependencies = {}): Promise<Phase74FrozenProtectionSuiteEvidence> {
  const paths = input.runArtifactPaths.map((path) => resolve(path));
  if (new Set(paths).size !== paths.length) {
    throw new Error("Phase 74 protection suite evidence has a duplicate run artifact path.");
  }
  const loadedManifest = await loadManifest(input.manifestPath);
  const verifiers = dependencies.verifiers ?? DEFAULT_VERIFIERS;
  const loadedRuns = await Promise.all(
    paths.map(loadPhase74FrozenProtectionSuiteRunArtifact),
  );
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
  return {
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
    schemaVersion: 1,
    source: {
      evaluatorSource,
      manifest: {
        path: loadedManifest.path,
        sha256: loadedManifest.sha256,
      },
      suites: sources,
    },
  };
}

function sourcePaths(value: unknown): {
  manifestPath: string;
  runArtifactPaths: string[];
} {
  const record = recordValue(value, "frozen protection suite evidence");
  if (
    record.artifactKind !== "phase74-frozen-protection-suite-evidence" ||
    record.schemaVersion !== 1
  ) {
    throw new Error(
      "Phase 74 frozen protection suite evidence kind or schemaVersion is invalid.",
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
  return { manifestPath, runArtifactPaths };
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
  const source = sourcePaths(parsed);
  const derived = await buildPhase74FrozenProtectionSuiteEvidence({
    manifestPath: source.manifestPath,
    runArtifactPaths: source.runArtifactPaths,
  }, dependencies);
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
