#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  assertPhase74BeamFull100kDatasetBytes,
  buildPhase74BeamSafetyLiveRunIdentity,
  buildPhase74BeamSafetyLiveSpec,
  createPhase74BeamSafetyLiveProviderWiring,
  PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
} from "../src/eval/phase74BeamSafetyLive";
import type { Phase74BeamSafetyLiveSpec } from "../src/eval/phase74BeamSafetyLive";
import {
  buildPhase74BeamSafetyProtectionRunIdentity,
  parsePhase74BeamSafetyContract,
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_METRICS,
  PHASE74_BEAM_SAFETY_SUITE,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
  runPhase74BeamSafetyProtection,
  verifyPhase74BeamSafetyProtectionArtifact,
} from "../src/eval/phase74BeamSafetyProtection";
import type {
  Phase74BeamSafetyDependencies,
} from "../src/eval/phase74BeamSafetyProtection";
import {
  capturePhase74EvaluatorSource,
  resolvePhase74LiveModels,
} from "../src/eval/phase74Live";
import type {
  Phase74EvaluatorSource,
  Phase74LiveModels,
} from "../src/eval/phase74Live";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  loadPhase74ModelUsageLedger,
} from "../src/eval/modelUsage";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../src/eval/modelUsage";
import type {
  Phase74ProtectionReplicate,
} from "../src/eval/phase74ProtectionContracts";
import type {
  Phase74ProtectionSuiteRunResult,
} from "../src/eval/phase74ProtectionRun";
import {
  hashPhase74ProtectionSuiteIdentity,
  loadPhase74ProtectionSuiteManifest,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import {
  acquirePhase74RunLock,
  createPhase74DurableCallBudget,
} from "./run-phase-74-generalization";
import {
  assertCliPathSegmentValue,
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const GENERATED_BY = "scripts/run-phase-74-beam-safety-protection.ts";
const DEFAULT_CASE_CONCURRENCY = 16;

interface Phase74BeamSafetyProtectionLiveCliOptions {
  caseConcurrency: number;
  datasetPath: string;
  embeddingSpendLimitUsd: number;
  manifestPath: string;
  maxLanguageCalls: number;
  mode: "live";
  outputDir: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
}

interface Phase74BeamSafetyProtectionPreflightCliOptions {
  datasetPath: string;
  mode: "preflight";
  outputDir: string;
  runId: string;
}

interface Phase74BeamSafetyProtectionVerifyCliOptions {
  mode: "verify";
  runDirectory: string;
}

export type Phase74BeamSafetyProtectionCliOptions =
  | Phase74BeamSafetyProtectionLiveCliOptions
  | Phase74BeamSafetyProtectionPreflightCliOptions
  | Phase74BeamSafetyProtectionVerifyCliOptions;

interface Phase74BeamSafetyLiveWiringInput {
  events: AttributedModelUsageAttempt[];
  intents: AttributedModelUsageIntent[];
  models: Phase74LiveModels;
  onUsageEvent(event: AttributedModelUsageAttempt): void;
  onUsageIntent(intent: AttributedModelUsageIntent): void;
  runDirectory: string;
  spec: Phase74BeamSafetyLiveSpec;
}

export interface Phase74BeamSafetyProtectionCliDependencies {
  captureEvaluatorSource?(input: {
    repoRoot: string;
  }): Promise<Phase74EvaluatorSource>;
  createLiveDependencies?(
    input: Phase74BeamSafetyLiveWiringInput,
  ): Phase74BeamSafetyDependencies;
  fetch?: typeof globalThis.fetch;
  now?(): Date;
  readDataset?(path: string): Promise<Uint8Array>;
  resolveModels?(env: Record<string, string | undefined>): Phase74LiveModels;
  runProtection?: typeof runPhase74BeamSafetyProtection;
  verifyProtection?: typeof verifyPhase74BeamSafetyProtectionArtifact;
}

export interface Phase74BeamSafetyProtectionLiveCliResult {
  contractPath: string;
  identityPath: string;
  result: Phase74ProtectionSuiteRunResult;
  runDirectory: string;
  status: "completed";
  summaryPath: string;
}

export type Phase74BeamSafetyProtectionCliResult =
  | Phase74BeamSafetyProtectionLiveCliResult
  | {
      identityPath: string;
      manifestPath: string;
      runDirectory: string;
      status: "preflight_complete";
    }
  | {
      runDirectory: string;
      status: "verified";
      summaryPath: string;
    };

function requiredFlag(argv: readonly string[], flag: string): string {
  const value = resolveCliFlagValueStrict(argv, flag);
  if (value === undefined || value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 BEAM safety live run requires ${flag}.`);
  }
  return value;
}

function positiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return Number(value);
}

function positiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be greater than zero.`);
  }
  return parsed;
}

function replicate(value: string): Phase74ProtectionReplicate {
  if (value !== "1" && value !== "2" && value !== "3") {
    throw new Error("--replicate must be 1, 2, or 3.");
  }
  return Number(value) as Phase74ProtectionReplicate;
}

export function parsePhase74BeamSafetyProtectionCliOptions(
  argv: readonly string[],
): Phase74BeamSafetyProtectionCliOptions {
  const preflightOnly = hasCliFlagStrict(argv, "--preflight-only");
  const verifyOnly = hasCliFlagStrict(argv, "--verify-only");
  if (preflightOnly && verifyOnly) {
    throw new Error("--preflight-only cannot be combined with --verify-only.");
  }
  const allowed = new Set(verifyOnly
    ? ["--run-directory", "--verify-only"]
    : preflightOnly
      ? ["--dataset-path", "--output-dir", "--preflight-only", "--run-id"]
      : [
          "--case-concurrency",
          "--dataset-path",
          "--embedding-spend-limit-usd",
          "--manifest",
          "--max-language-calls",
          "--output-dir",
          "--replicate",
          "--run-id",
        ]);
  for (const value of argv) {
    if (value.startsWith("--") && !allowed.has(value)) {
      throw new Error(`Phase 74 BEAM safety live run received unknown option ${value}.`);
    }
  }
  if (verifyOnly) {
    return {
      mode: "verify",
      runDirectory: resolve(requiredFlag(argv, "--run-directory")),
    };
  }
  const runId = requiredFlag(argv, "--run-id");
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  if (preflightOnly) {
    return {
      datasetPath: resolve(requiredFlag(argv, "--dataset-path")),
      mode: "preflight",
      outputDir: resolve(requiredFlag(argv, "--output-dir")),
      runId,
    };
  }
  return {
    caseConcurrency: positiveInteger(
      resolveCliFlagValueStrict(argv, "--case-concurrency") ??
        String(DEFAULT_CASE_CONCURRENCY),
      "--case-concurrency",
    ),
    datasetPath: resolve(requiredFlag(argv, "--dataset-path")),
    embeddingSpendLimitUsd: positiveNumber(
      requiredFlag(argv, "--embedding-spend-limit-usd"),
      "--embedding-spend-limit-usd",
    ),
    manifestPath: resolve(requiredFlag(argv, "--manifest")),
    maxLanguageCalls: positiveInteger(
      requiredFlag(argv, "--max-language-calls"),
      "--max-language-calls",
    ),
    mode: "live",
    outputDir: resolve(requiredFlag(argv, "--output-dir")),
    replicate: replicate(requiredFlag(argv, "--replicate")),
    runId,
  };
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fileSha256(path: string): Promise<string> {
  return sha256(await readFile(path));
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

function assertManifestEntry(input: {
  dataset: Phase74BeamSafetyLiveSpec["contract"]["dataset"];
  datasetPath: string;
  identityHash: string;
  manifest: Awaited<ReturnType<typeof loadPhase74ProtectionSuiteManifest>>;
}): void {
  const matches = input.manifest.manifest.suites.filter(
    ({ id }) => id === PHASE74_BEAM_SAFETY_SUITE.id,
  );
  if (matches.length !== 1) {
    throw new Error(
      "Phase 74 BEAM safety requires exactly one pre-bound manifest suite entry.",
    );
  }
  const entry = matches[0]!;
  if (
    entry.kind !== PHASE74_BEAM_SAFETY_SUITE.kind ||
    entry.verifierId !== PHASE74_BEAM_SAFETY_VERIFIER_ID ||
    entry.identityHash !== input.identityHash ||
    entry.dataset.id !== input.dataset.id ||
    entry.dataset.sha256 !== input.dataset.sha256 ||
    entry.dataset.path !== input.datasetPath ||
    canonicalJson(entry.requiredMetrics) !==
      canonicalJson([...PHASE74_BEAM_SAFETY_METRICS].sort())
  ) {
    throw new Error(
      "Phase 74 BEAM safety live identity does not match the pre-bound manifest.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOfficialProvenance(value: unknown): void {
  if (
    canonicalJson(value) !==
      canonicalJson(PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE)
  ) {
    throw new Error("Phase 74 BEAM official dataset provenance drifted.");
  }
}

function officialDatasetIdentity(datasetPath: string) {
  return {
    id: PHASE74_BEAM_FULL_100K_DATASET_ID,
    path: datasetPath,
    provenance: PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
    sha256:
      PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE.deterministicExport.sha256,
  };
}

async function runPhase74BeamSafetyPreflight(input: {
  dependencies: Pick<
    Phase74BeamSafetyProtectionCliDependencies,
    "captureEvaluatorSource" | "now" | "readDataset"
  >;
  options: Phase74BeamSafetyProtectionPreflightCliOptions;
}): Promise<Phase74BeamSafetyProtectionCliResult> {
  const datasetBytes = await (input.dependencies.readDataset ?? readFile)(
    input.options.datasetPath,
  );
  assertPhase74BeamFull100kDatasetBytes(datasetBytes);
  const evaluatorSource = await (
    input.dependencies.captureEvaluatorSource ?? capturePhase74EvaluatorSource
  )({ repoRoot: resolveRepoRootFromScriptUrl(import.meta.url) });
  const generatedAt = (
    input.dependencies.now ?? (() => new Date())
  )().toISOString();
  const runDirectory = join(input.options.outputDir, input.options.runId);
  await mkdir(input.options.outputDir, { recursive: true });
  await mkdir(runDirectory);
  const identityPath = join(runDirectory, "run-identity.json");
  const manifestPath = join(runDirectory, "dataset-provenance-manifest.json");
  await writeFile(identityPath, `${JSON.stringify({
    artifactKind: "phase74-beam-dataset-preflight-identity",
    dataset: officialDatasetIdentity(input.options.datasetPath),
    evaluatorSource,
    generatedAt,
    generatedBy: GENERATED_BY,
    runId: input.options.runId,
    schemaVersion: 1,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await writeFile(manifestPath, `${JSON.stringify({
    artifactKind: "phase74-beam-dataset-provenance-manifest",
    dataset: officialDatasetIdentity(input.options.datasetPath),
    identity: {
      path: identityPath,
      sha256: await fileSha256(identityPath),
    },
    schemaVersion: 1,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return {
    identityPath,
    manifestPath,
    runDirectory,
    status: "preflight_complete",
  };
}

export async function verifyPhase74BeamSafetyLiveRun(
  runDirectory: string,
  dependencies: Pick<
    Phase74BeamSafetyProtectionCliDependencies,
    "readDataset" | "verifyProtection"
  > = {},
): Promise<Extract<
  Phase74BeamSafetyProtectionCliResult,
  { status: "verified" }
>> {
  const directory = resolve(runDirectory);
  const identityPath = join(directory, "run-identity.json");
  const identityBytes = await readFile(identityPath);
  const identity = JSON.parse(identityBytes.toString("utf8")) as unknown;
  if (!isRecord(identity) || !isRecord(identity.dataset)) {
    throw new Error("Phase 74 BEAM live run identity is invalid.");
  }
  if (
    identity.artifactKind !== "phase74-beam-safety-live-run-identity" ||
    identity.schemaVersion !== 1 ||
    identity.dataset.id !== PHASE74_BEAM_FULL_100K_DATASET_ID ||
    typeof identity.dataset.path !== "string" ||
    identity.dataset.sha256 !==
      PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE.deterministicExport.sha256
  ) {
    throw new Error("Phase 74 BEAM live run identity is invalid.");
  }
  assertOfficialProvenance(identity.dataset.provenance);
  const datasetBytes = await (dependencies.readDataset ?? readFile)(
    identity.dataset.path,
  );
  assertPhase74BeamFull100kDatasetBytes(datasetBytes);

  const contractPath = join(directory, "trusted-contract.json");
  const contract = parsePhase74BeamSafetyContract(
    JSON.parse(await readFile(contractPath, "utf8")) as unknown,
  );
  if (
    canonicalJson(identity.contract) !== canonicalJson(contract) ||
    contract.dataset.sha256 !== identity.dataset.sha256
  ) {
    throw new Error("Phase 74 BEAM live contract/identity binding drifted.");
  }
  const protectionIdentity = buildPhase74BeamSafetyProtectionRunIdentity({
    contract,
    datasetBytes,
  });
  const protectionIdentityHash = hashPhase74ProtectionSuiteIdentity(
    protectionIdentity,
  );
  if (
    canonicalJson(identity.protectionIdentity) !==
      canonicalJson(protectionIdentity) ||
    identity.protectionIdentityHash !== protectionIdentityHash ||
    !isRecord(identity.spec) ||
    canonicalJson(identity.spec.contract) !== canonicalJson(contract) ||
    canonicalJson(identity.spec.datasetProvenance) !==
      canonicalJson(PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE)
  ) {
    throw new Error("Phase 74 BEAM live protection identity drifted.");
  }
  if (!isRecord(identity.manifest)) {
    throw new Error("Phase 74 BEAM live manifest identity is invalid.");
  }
  const manifestPath = identity.manifest.path;
  if (
    typeof manifestPath !== "string" ||
    typeof identity.manifest.sha256 !== "string"
  ) {
    throw new Error("Phase 74 BEAM live manifest identity is invalid.");
  }
  const manifest = await loadPhase74ProtectionSuiteManifest(manifestPath);
  if (manifest.sha256 !== identity.manifest.sha256) {
    throw new Error("Phase 74 BEAM live manifest SHA-256 drifted.");
  }
  assertManifestEntry({
    dataset: contract.dataset,
    datasetPath: identity.dataset.path,
    identityHash: protectionIdentityHash,
    manifest,
  });

  const summaryPath = join(directory, "run-summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as unknown;
  if (
    !isRecord(summary) ||
    !isRecord(summary.contract) ||
    !isRecord(summary.protectionRun) ||
    !isRecord(summary.rawArtifact) ||
    !isRecord(summary.runIdentity) ||
    !isRecord(summary.modelUsage) ||
    summary.contract.sha256 !== await fileSha256(contractPath) ||
    summary.runIdentity.sha256 !== sha256(identityBytes)
  ) {
    throw new Error("Phase 74 BEAM live summary identity drifted.");
  }
  const artifactPath = summary.protectionRun.path;
  const rawArtifactPath = summary.rawArtifact.path;
  if (
    typeof artifactPath !== "string" ||
    typeof rawArtifactPath !== "string" ||
    summary.protectionRun.sha256 !== await fileSha256(artifactPath) ||
    summary.rawArtifact.sha256 !== await fileSha256(rawArtifactPath)
  ) {
    throw new Error("Phase 74 BEAM live protection artifact drifted.");
  }
  const usagePath = join(directory, "model-usage.jsonl");
  const usageIntentsPath = join(directory, "model-usage-intents.jsonl");
  const usage = await loadPhase74ModelUsageLedger({
    eventsPath: usagePath,
    intentsPath: usageIntentsPath,
  });
  if (
    usage.pendingIntents.length > 0 ||
    summary.modelUsage.eventsSha256 !== await fileSha256(usagePath) ||
    summary.modelUsage.intentsSha256 !== await fileSha256(usageIntentsPath)
  ) {
    throw new Error("Phase 74 BEAM live usage ledger drifted.");
  }
  await (
    dependencies.verifyProtection ?? verifyPhase74BeamSafetyProtectionArtifact
  )({ artifactPath, contract, datasetBytes });
  return { runDirectory: directory, status: "verified", summaryPath };
}

export async function runPhase74BeamSafetyProtectionCli(
  options: Phase74BeamSafetyProtectionCliOptions,
  dependencies: Phase74BeamSafetyProtectionCliDependencies = {},
  env: Record<string, string | undefined> = process.env,
): Promise<Phase74BeamSafetyProtectionCliResult> {
  if (options.mode === "verify") {
    return verifyPhase74BeamSafetyLiveRun(options.runDirectory, dependencies);
  }
  if (options.mode === "preflight") {
    return runPhase74BeamSafetyPreflight({ dependencies, options });
  }
  const datasetBytes = await (dependencies.readDataset ?? readFile)(
    options.datasetPath,
  );
  assertPhase74BeamFull100kDatasetBytes(datasetBytes);
  const manifest = await loadPhase74ProtectionSuiteManifest(
    options.manifestPath,
  );
  const evaluatorSource = await (
    dependencies.captureEvaluatorSource ?? capturePhase74EvaluatorSource
  )({ repoRoot: resolveRepoRootFromScriptUrl(import.meta.url) });
  const models = (dependencies.resolveModels ?? resolvePhase74LiveModels)(env);
  const spec = buildPhase74BeamSafetyLiveSpec({
    dataset: {
      id: PHASE74_BEAM_FULL_100K_DATASET_ID,
      sha256: sha256(datasetBytes),
    },
    models,
    source: {
      id: `git:${evaluatorSource.commit}`,
      sha256: evaluatorSource.sha256,
    },
  });
  const protectionIdentity = buildPhase74BeamSafetyLiveRunIdentity({
    datasetBytes,
    spec,
  });
  const identityHash = hashPhase74ProtectionSuiteIdentity(protectionIdentity);
  assertManifestEntry({
    dataset: spec.contract.dataset,
    datasetPath: options.datasetPath,
    identityHash,
    manifest,
  });

  await mkdir(options.outputDir, { recursive: true });
  const runDirectory = join(options.outputDir, options.runId);
  await mkdir(runDirectory);
  const releaseRunLock = await acquirePhase74RunLock(runDirectory);
  try {
    const contractPath = join(runDirectory, "trusted-contract.json");
    const identityPath = join(runDirectory, "run-identity.json");
    const usagePath = join(runDirectory, "model-usage.jsonl");
    const usageIntentsPath = join(runDirectory, "model-usage-intents.jsonl");
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    await writeFile(
      contractPath,
      `${JSON.stringify(spec.contract, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await writeFile(identityPath, `${JSON.stringify({
      artifactKind: "phase74-beam-safety-live-run-identity",
      callBudget: {
        embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
        maxLanguageCalls: options.maxLanguageCalls,
      },
      caseConcurrency: options.caseConcurrency,
      contract: spec.contract,
      dataset: {
        id: spec.contract.dataset.id,
        path: options.datasetPath,
        provenance: PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
        sha256: spec.contract.dataset.sha256,
      },
      generatedAt,
      generatedBy: GENERATED_BY,
      manifest: {
        path: manifest.path,
        sha256: manifest.sha256,
      },
      protectionIdentity,
      protectionIdentityHash: identityHash,
      replicate: options.replicate,
      runId: options.runId,
      schemaVersion: 1,
      spec,
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await Promise.all([
      writeFile(usagePath, "", { encoding: "utf8", flag: "wx" }),
      writeFile(usageIntentsPath, "", { encoding: "utf8", flag: "wx" }),
    ]);

    const callBudget = createPhase74DurableCallBudget({
      embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
      fetch: dependencies.fetch ?? globalThis.fetch,
      maxLanguageCalls: options.maxLanguageCalls,
      path: join(runDirectory, "call-budget.json"),
    });
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    const onUsageEvent = (event: AttributedModelUsageAttempt) => {
      appendPhase74ModelUsageEventSync(usagePath, event);
    };
    const onUsageIntent = (intent: AttributedModelUsageIntent) => {
      appendPhase74ModelUsageIntentSync(usageIntentsPath, intent);
    };
    const liveDependencies = (
      dependencies.createLiveDependencies ??
      createPhase74BeamSafetyLiveProviderWiring
    )({
      events,
      intents,
      models,
      onUsageEvent,
      onUsageIntent,
      runDirectory,
      spec,
    });
    const originalFetch = globalThis.fetch;
    let result: Phase74ProtectionSuiteRunResult;
    globalThis.fetch = callBudget.fetch;
    try {
      result = await (
        dependencies.runProtection ?? runPhase74BeamSafetyProtection
      )({
        artifactPath: join(runDirectory, "protection-run.json"),
        caseConcurrency: options.caseConcurrency,
        contract: spec.contract,
        datasetBytes,
        rawArtifactPath: join(runDirectory, "raw.json"),
        replicate: options.replicate,
        runId: options.runId,
      }, liveDependencies);
    } finally {
      globalThis.fetch = originalFetch;
    }
    await (
      dependencies.verifyProtection ?? verifyPhase74BeamSafetyProtectionArtifact
    )({
      artifactPath: result.artifactPath,
      contract: spec.contract,
      datasetBytes,
    });
    const usage = await loadPhase74ModelUsageLedger({
      eventsPath: usagePath,
      intentsPath: usageIntentsPath,
    });
    if (usage.pendingIntents.length > 0) {
      throw new Error("Phase 74 BEAM safety live usage has pending requests.");
    }
    const summaryPath = join(runDirectory, "run-summary.json");
    await writeFile(summaryPath, `${JSON.stringify({
      artifactKind: "phase74-beam-safety-live-run-summary",
      callBudget: callBudget.snapshot(),
      caseConcurrency: options.caseConcurrency,
      contract: { path: contractPath, sha256: await fileSha256(contractPath) },
      executionFailures: result.artifact.executionFailures,
      modelUsage: {
        completeRequestCount: usage.events.filter(
          ({ completeness }) => completeness === "complete",
        ).length,
        eventCount: usage.events.length,
        eventsSha256: await fileSha256(usagePath),
        intentCount: usage.intents.length,
        intentsSha256: await fileSha256(usageIntentsPath),
        missingRequestCount: usage.events.filter(
          ({ completeness }) => completeness === "missing",
        ).length,
        partialRequestCount: usage.events.filter(
          ({ completeness }) => completeness === "partial",
        ).length,
        pendingRequestCount: usage.pendingIntents.length,
      },
      protectionRun: {
        path: result.artifactPath,
        sha256: await fileSha256(result.artifactPath),
      },
      rawArtifact: {
        path: result.rawArtifactPath,
        sha256: await fileSha256(result.rawArtifactPath),
      },
      runIdentity: { path: identityPath, sha256: await fileSha256(identityPath) },
      schemaVersion: 1,
      verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return {
      contractPath,
      identityPath,
      result,
      runDirectory,
      status: "completed",
      summaryPath,
    };
  } finally {
    await releaseRunLock();
  }
}

if (import.meta.main) {
  const result = await runPhase74BeamSafetyProtectionCli(
    parsePhase74BeamSafetyProtectionCliOptions(Bun.argv),
  );
  console.log(JSON.stringify(result.status === "completed"
    ? {
        artifactPath: result.result.artifactPath,
        contractPath: result.contractPath,
        runDirectory: result.runDirectory,
        status: result.status,
        summaryPath: result.summaryPath,
      }
    : result, null, 2));
}
