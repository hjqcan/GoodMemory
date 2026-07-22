#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildPhase74BeamSafetyLiveRunIdentity,
  buildPhase74BeamSafetyLiveSpec,
  createPhase74BeamSafetyLiveProviderWiring,
} from "../src/eval/phase74BeamSafetyLive";
import type { Phase74BeamSafetyLiveSpec } from "../src/eval/phase74BeamSafetyLive";
import {
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
  resolveCliFlagValueStrict,
} from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const GENERATED_BY = "scripts/run-phase-74-beam-safety-protection.ts";
const DEFAULT_CASE_CONCURRENCY = 16;

export interface Phase74BeamSafetyProtectionCliOptions {
  caseConcurrency: number;
  datasetPath: string;
  embeddingSpendLimitUsd: number;
  manifestPath: string;
  maxLanguageCalls: number;
  outputDir: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
}

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

export interface Phase74BeamSafetyProtectionCliResult {
  contractPath: string;
  identityPath: string;
  result: Phase74ProtectionSuiteRunResult;
  runDirectory: string;
  summaryPath: string;
}

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
  const allowed = new Set([
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
  const runId = requiredFlag(argv, "--run-id");
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
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
  datasetPath: string;
  identityHash: string;
  manifest: Awaited<ReturnType<typeof loadPhase74ProtectionSuiteManifest>>;
  spec: Phase74BeamSafetyLiveSpec;
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
    entry.dataset.id !== input.spec.contract.dataset.id ||
    entry.dataset.sha256 !== input.spec.contract.dataset.sha256 ||
    entry.dataset.path !== input.datasetPath ||
    canonicalJson(entry.requiredMetrics) !==
      canonicalJson([...PHASE74_BEAM_SAFETY_METRICS].sort())
  ) {
    throw new Error(
      "Phase 74 BEAM safety live identity does not match the pre-bound manifest.",
    );
  }
}

export async function runPhase74BeamSafetyProtectionCli(
  options: Phase74BeamSafetyProtectionCliOptions,
  dependencies: Phase74BeamSafetyProtectionCliDependencies = {},
  env: Record<string, string | undefined> = process.env,
): Promise<Phase74BeamSafetyProtectionCliResult> {
  const datasetBytes = await (dependencies.readDataset ?? readFile)(
    options.datasetPath,
  );
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
    datasetPath: options.datasetPath,
    identityHash,
    manifest,
    spec,
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
    return { contractPath, identityPath, result, runDirectory, summaryPath };
  } finally {
    await releaseRunLock();
  }
}

if (import.meta.main) {
  const result = await runPhase74BeamSafetyProtectionCli(
    parsePhase74BeamSafetyProtectionCliOptions(Bun.argv),
  );
  console.log(JSON.stringify({
    artifactPath: result.result.artifactPath,
    contractPath: result.contractPath,
    runDirectory: result.runDirectory,
    summaryPath: result.summaryPath,
  }, null, 2));
}
