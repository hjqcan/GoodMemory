import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { validateC4ControlledPilotDataset } from "./c4-contracts";
import { openC5EvidenceLedger } from "./c5-ledger";
import { createC5NativeLiveAdapter } from "./c5-native-adapter";
import {
  runC5LongitudinalPilot,
} from "./c5-longitudinal";
import type {
  C5LiveLeakageAuditResult,
  C5LongitudinalPilotResult,
  C5StageEvaluation,
  C5StageExecution,
} from "./c5-longitudinal";
import type {
  C5PilotCluster,
  C5PilotEpisodeArmRun,
  C5PilotPlan,
  C5PilotStageRun,
} from "./c5-pilot-plan";
import { serializeC5PilotPlan } from "./c5-pilot-plan";
import {
  loadC5PilotReadiness,
} from "./c5-readiness";
import type {
  C5PilotReadinessInput,
} from "./c5-readiness";
import {
  buildC5PilotReport,
  serializeC5PilotReport,
} from "./c5-reporting";
import type { C5PilotReport } from "./c5-reporting";
import {
  assertC5RunnerSourceStateIdentical,
  captureC5RunnerSourceState,
} from "./c5-runner-source";
import {
  loadCodexCodingEffectDataset,
} from "./dataset";
import type {
  CodexCodingEffectDatasetV2,
  LoadedCodexCodingEffectDataset,
} from "./dataset";

const RUNNER_SOURCE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OWNED_ROOT_MARKER = ".goodmemory-c5-owned-root.json";

interface C5OwnedMutableRoot {
  lexicalPath: string;
  markerBytes: string;
  physicalPath: string;
  role: "runtime" | "source" | "workspace";
}

export interface C5LivePilotHandle {
  runId: string;
}

export interface C5LivePilotAdapter {
  auditLiveLeakage(context: {
    cluster: C5PilotCluster;
    executions: readonly (C5StageExecution & {
      clusterId: string;
      episodeId: string;
      repetition: 1 | 2;
      stageId: string;
    })[];
    runs: readonly C5PilotEpisodeArmRun[];
    stage: C5PilotStageRun;
  }): Promise<C5LiveLeakageAuditResult>;
  cleanupTrajectory(context: {
    handle: C5LivePilotHandle;
    run: C5PilotEpisodeArmRun;
  }): Promise<void>;
  evaluatePair(context: {
    cluster: C5PilotCluster;
    executions: readonly (C5StageExecution & {
      clusterId: string;
      episodeId: string;
      repetition: 1 | 2;
      stageId: string;
    })[];
    runs: readonly C5PilotEpisodeArmRun[];
    stage: C5PilotStageRun;
  }): Promise<C5StageEvaluation[]>;
  executeStage(context: {
    handle: C5LivePilotHandle;
    run: C5PilotEpisodeArmRun;
    stage: C5PilotStageRun;
  }): Promise<C5StageExecution>;
  prepareTrajectory(context: {
    run: C5PilotEpisodeArmRun;
  }): Promise<C5LivePilotHandle>;
  restoreCredential(context: {
    handle: C5LivePilotHandle;
    run: C5PilotEpisodeArmRun;
    stage: C5PilotStageRun;
  }): Promise<void>;
  revokeCredential(context: {
    handle: C5LivePilotHandle;
    run: C5PilotEpisodeArmRun;
    stage: C5PilotStageRun;
  }): Promise<void>;
}

// Runtime inputs for the flat-summary comparator baseline: the summarizer
// credential never enters an arm's environment; the runner calls the provider
// between stages and writes only the accepted summary into the arm.
export interface C5ComparatorRuntimeInput {
  apiToken: string;
  summaryEndpoint: string;
  summaryModel: string;
  summaryPrompt: string;
  summaryPromptSha256: string;
}

export interface C5NativeLongitudinalPilotInput
  extends C5PilotReadinessInput {
  authFile: string;
  bunExecutable: string;
  codexExecutable: string;
  comparatorRuntime?: C5ComparatorRuntimeInput;
  generatedAt: string;
  model: string;
  // Optional pre-populated npm cache copied into each installed arm's own
  // cache before an offline install, so the run's dependency resolution is
  // identical across clusters and independent of registry reachability.
  npmCacheSeed?: string;
  npmExecutable: string;
  npmRegistry?: string;
  onLog?: (event: C5LivePilotLogEvent) => void;
  outputDirectory: string;
  packageTarball: string;
  reasoningEffort: string;
  resume?: boolean;
  runId: string;
  runtimeRoot: string;
  sourceRoot: string;
  stageTimeoutMs: number;
  testTimeoutMs: number;
  workspaceRoot: string;
  dependencies?: {
    createAdapter?: (context: {
      dataset: CodexCodingEffectDatasetV2;
      frozenPlan: C5PilotPlan;
      input: C5NativeLongitudinalPilotInput;
    }) => Promise<C5LivePilotAdapter>;
    loadDataset?: (
      root: string,
    ) => Promise<LoadedCodexCodingEffectDataset>;
    loadReadiness?: (
      input: C5PilotReadinessInput,
    ) => Promise<{
      plan: C5PilotPlan;
      planBytes: string;
      planSha256: string;
      prerequisiteEvidenceBytes: string;
      prerequisiteEvidenceSha256: string;
    }>;
  };
}

export interface C5LivePilotLogEvent {
  details: Record<string, unknown>;
  event: string;
  timestamp: string;
}

export interface C5NativeLongitudinalPilotResult {
  pilot: C5LongitudinalPilotResult;
  plan: C5PilotPlan;
  planSha256: string;
  report: C5PilotReport;
  reportBytes: string;
  reportSha256: string;
}

export interface C5NativeLongitudinalCanaryInput
  extends C5NativeLongitudinalPilotInput {
  clusterId: string;
}

export interface C5NativeLongitudinalCanaryReport {
  claimBoundary: "internal-lifecycle-canary-only";
  clusterId: string;
  decision: "accepted" | "rejected";
  evidenceClass: "native-longitudinal-lifecycle-canary";
  generatedAt: string;
  pairCount: number;
  phase: "C5";
  planSha256: string;
  publicClaimEligible: false;
  publicCodingEffectProof: false;
  reasons: string[];
  runId: string;
  schemaVersion: 1;
  stageExecutionCount: number;
  taskOutcomeUsedForAcceptance: false;
}

export interface C5NativeLongitudinalCanaryResult {
  pilot: C5LongitudinalPilotResult;
  plan: C5PilotPlan;
  planSha256: string;
  report: C5NativeLongitudinalCanaryReport;
  reportSha256: string;
}

export async function runC5NativeLongitudinalPilot(
  input: C5NativeLongitudinalPilotInput,
): Promise<C5NativeLongitudinalPilotResult> {
  const roots = await validateC5NativePilotPaths(input);
  const readiness = await (input.dependencies?.loadReadiness ??
    loadC5PilotReadiness)(readinessInput(input));
  assertReadinessResult(readiness);
  const loaded = await (input.dependencies?.loadDataset ??
    loadCodexCodingEffectDataset)(input.datasetRoot);
  const dataset = validateC4ControlledPilotDataset(loaded.dataset);
  assertDatasetBoundToPlan(loaded, readiness.plan);
  const runnerSourceBefore = await captureC5RunnerSourceState({
    repositoryRoot: RUNNER_SOURCE_ROOT,
  });

  const resume = input.resume === true;
  if (!resume) {
    await Promise.all(roots.map((path) => assertAbsent(path)));
  }

  const createAdapter = input.dependencies?.createAdapter ??
    createC5NativeLiveAdapter;
  await mkdir(input.outputDirectory, { recursive: true });
  const log = createLiveLogger(input);
  const generatedAt = resume
    ? await existingRunGeneratedAt(input.outputDirectory)
    : input.generatedAt;
  const ownedRoots = await prepareOwnedMutableRoots(input, resume);
  const runIdentity = buildRunIdentity(
    { ...input, generatedAt },
    readiness.planSha256,
    runnerSourceBefore.state.aggregateSha256,
    ownedRoots,
  );
  await Promise.all([
    writeOrVerifyRunInput({
      bytes: readiness.prerequisiteEvidenceBytes,
      path: resolve(input.outputDirectory, "c4-prerequisite-evidence.json"),
      resume,
    }),
    writeOrVerifyRunInput({
      bytes: readiness.planBytes,
      path: resolve(input.outputDirectory, "pilot-plan.json"),
      resume,
    }),
    writeOrVerifyRunInput({
      bytes: runnerSourceBefore.sourceStateArtifactBytes,
      path: resolve(input.outputDirectory, "runner-source-state.json"),
      resume,
    }),
  ]);
  const ledger = await openC5EvidenceLedger({
    directory: input.outputDirectory,
    identity: runIdentity,
    plan: readiness.plan,
    resume,
  });
  if (resume && ledger.remainingClusterIds.length > 0) {
    await Promise.all(ownedRoots.map(clearOwnedMutableRoot));
  }
  log("readiness_completed", {
    planSha256: readiness.planSha256,
    resumedClusterCount:
      readiness.plan.clusters.length - ledger.remainingClusterIds.length,
    scheduledStageCount: readiness.plan.counts.stageRuns,
  });
  try {
    log("pilot_started", { runId: input.runId });
    if (ledger.remainingClusterIds.length > 0) {
      const adapter = await createAdapter({
        dataset,
        frozenPlan: readiness.plan,
        input: {
          ...input,
          generatedAt,
          onLog: (event) => log(event.event, event.details),
        },
      });
      await runC5LongitudinalPilot({
        ...adapter,
        clusterIds: ledger.remainingClusterIds,
        commitCluster: ({ cluster }) => ledger.commitCluster(cluster.id),
        plan: readiness.plan,
        recordPair: ledger.appendPair,
        recordStageExecution: ledger.appendStageExecution,
      });
    }
    const pilot: C5LongitudinalPilotResult = {
      pairs: [...ledger.pairs],
      stageExecutions: [...ledger.stageExecutions],
    };
    const runnerSourceAfter = await captureC5RunnerSourceState({
      repositoryRoot: RUNNER_SOURCE_ROOT,
    });
    assertC5RunnerSourceStateIdentical(
      runnerSourceBefore.state,
      runnerSourceAfter.state,
    );
    await writeOrVerifyRunInput({
      bytes: runnerSourceAfter.sourceStateArtifactBytes,
      path: resolve(input.outputDirectory, "runner-source-state-post-run.json"),
      resume,
    });
    const report = buildC5PilotReport({
      generatedAt,
      plan: readiness.plan,
      planSha256: readiness.planSha256,
      result: pilot,
      runId: input.runId,
    });
    const reportBytes = serializeC5PilotReport(report);
    await writeOrVerifyRunInput({
      bytes: reportBytes,
      path: resolve(input.outputDirectory, "report.json"),
      resume,
    });
    log("pilot_completed", {
      pairCount: pilot.pairs.length,
      reportSha256: sha256(reportBytes),
      stageExecutionCount: pilot.stageExecutions.length,
    });
    return {
      pilot,
      plan: readiness.plan,
      planSha256: readiness.planSha256,
      report,
      reportBytes,
      reportSha256: sha256(reportBytes),
    };
  } catch (error) {
    log("pilot_failed", { reasonSha256: sha256(errorMessage(error)) });
    throw error;
  }
}

export async function runC5NativeLongitudinalCanary(
  input: C5NativeLongitudinalCanaryInput,
): Promise<C5NativeLongitudinalCanaryResult> {
  const roots = await validateC5NativePilotPaths(input);
  const readiness = await (input.dependencies?.loadReadiness ??
    loadC5PilotReadiness)(readinessInput(input));
  assertReadinessResult(readiness);
  if (readiness.plan.clusters[0]?.id !== input.clusterId) {
    throw new Error(
      "C5 canary must use the first frozen cluster so an accepted run can resume into the pilot",
    );
  }
  const canaryRun = readiness.plan.episodeArmRuns.find((run) =>
    run.clusterId === input.clusterId
  )!;
  if (!canaryRun.stages.some((stage) => stage.memoryExpectation === "required")) {
    throw new Error("C5 lifecycle canary must exercise a required-memory stage");
  }
  const loaded = await (input.dependencies?.loadDataset ??
    loadCodexCodingEffectDataset)(input.datasetRoot);
  const dataset = validateC4ControlledPilotDataset(loaded.dataset);
  assertDatasetBoundToPlan(loaded, readiness.plan);
  const runnerSourceBefore = await captureC5RunnerSourceState({
    repositoryRoot: RUNNER_SOURCE_ROOT,
  });

  await Promise.all(roots.map((path) => assertAbsent(path)));

  const createAdapter = input.dependencies?.createAdapter ??
    createC5NativeLiveAdapter;
  await mkdir(input.outputDirectory, { recursive: true });
  const log = createLiveLogger(input);
  const ownedRoots = await prepareOwnedMutableRoots(input, false);
  await Promise.all([
    writeFile(
      resolve(input.outputDirectory, "c4-prerequisite-evidence.json"),
      readiness.prerequisiteEvidenceBytes,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      resolve(input.outputDirectory, "pilot-plan.json"),
      readiness.planBytes,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      resolve(input.outputDirectory, "runner-source-state.json"),
      runnerSourceBefore.sourceStateArtifactBytes,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  const ledger = await openC5EvidenceLedger({
    directory: input.outputDirectory,
    identity: buildRunIdentity(
      input,
      readiness.planSha256,
      runnerSourceBefore.state.aggregateSha256,
      ownedRoots,
    ),
    plan: readiness.plan,
  });
  log("canary_started", { clusterId: input.clusterId, runId: input.runId });
  try {
    const adapter = await createAdapter({
      dataset,
      frozenPlan: readiness.plan,
      input: {
        ...input,
        onLog: (event) => log(event.event, event.details),
      },
    });
    const pilot = await runC5LongitudinalPilot({
      ...adapter,
      clusterIds: [input.clusterId],
      commitCluster: ({ cluster }) => ledger.commitCluster(cluster.id),
      plan: readiness.plan,
      recordPair: ledger.appendPair,
      recordStageExecution: ledger.appendStageExecution,
    });
    const runnerSourceAfter = await captureC5RunnerSourceState({
      repositoryRoot: RUNNER_SOURCE_ROOT,
    });
    assertC5RunnerSourceStateIdentical(
      runnerSourceBefore.state,
      runnerSourceAfter.state,
    );
    await writeFile(
      resolve(input.outputDirectory, "runner-source-state-post-run.json"),
      runnerSourceAfter.sourceStateArtifactBytes,
      { encoding: "utf8", flag: "wx" },
    );
    const report = buildC5NativeLongitudinalCanaryReport({
      clusterId: input.clusterId,
      generatedAt: input.generatedAt,
      pilot,
      planSha256: readiness.planSha256,
      runId: input.runId,
    });
    const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
    await writeFile(
      resolve(input.outputDirectory, "canary-report.json"),
      reportBytes,
      { encoding: "utf8", flag: "wx" },
    );
    log("canary_completed", {
      clusterId: input.clusterId,
      decision: report.decision,
      reportSha256: sha256(reportBytes),
    });
    return {
      pilot,
      plan: readiness.plan,
      planSha256: readiness.planSha256,
      report,
      reportSha256: sha256(reportBytes),
    };
  } catch (error) {
    log("canary_failed", { reasonSha256: sha256(errorMessage(error)) });
    throw error;
  }
}

function buildC5NativeLongitudinalCanaryReport(input: {
  clusterId: string;
  generatedAt: string;
  pilot: C5LongitudinalPilotResult;
  planSha256: string;
  runId: string;
}): C5NativeLongitudinalCanaryReport {
  const installed = input.pilot.stageExecutions.filter((execution) =>
    execution.arm === "goodmemory-installed"
  );
  // The baseline is whichever non-installed arm the plan froze (no-memory or
  // the flat-summary comparator); neither may report a memory channel.
  const noMemory = input.pilot.stageExecutions.filter((execution) =>
    execution.arm !== "goodmemory-installed"
  );
  const reasons = [
    ...(input.pilot.stageExecutions.length === 6
      ? []
      : ["canary-did-not-account-for-six-stage-executions"]),
    ...(input.pilot.pairs.length === 3
      ? []
      : ["canary-did-not-account-for-three-pairs"]),
    ...(input.pilot.stageExecutions.every((execution) =>
        execution.codexStatus === "completed" &&
        execution.infrastructureFailureStage === null
      )
      ? []
      : ["canary-stage-infrastructure-failure"]),
    ...(installed.length === 3 && installed.every((execution) =>
        execution.memoryChannelStatus === "passed"
      )
      ? []
      : ["canary-installed-memory-channel-failure"]),
    ...(noMemory.length === 3 && noMemory.every((execution) =>
        execution.memoryChannelStatus === "not-applicable" &&
        execution.memoryObservation === null
      )
      ? []
      : ["canary-no-memory-isolation-failure"]),
    ...(input.pilot.pairs.every((pair) =>
        pair.comparable &&
        pair.evaluations.every((evaluation) =>
          evaluation.disposition === "finalized"
        )
      )
      ? []
      : ["canary-pair-lifecycle-failure"]),
  ];
  return {
    claimBoundary: "internal-lifecycle-canary-only",
    clusterId: input.clusterId,
    decision: reasons.length === 0 ? "accepted" : "rejected",
    evidenceClass: "native-longitudinal-lifecycle-canary",
    generatedAt: input.generatedAt,
    pairCount: input.pilot.pairs.length,
    phase: "C5",
    planSha256: input.planSha256,
    publicClaimEligible: false,
    publicCodingEffectProof: false,
    reasons,
    runId: input.runId,
    schemaVersion: 1,
    stageExecutionCount: input.pilot.stageExecutions.length,
    taskOutcomeUsedForAcceptance: false,
  };
}

function readinessInput(
  input: C5NativeLongitudinalPilotInput,
): C5PilotReadinessInput {
  assertComparatorInputConsistent(input);
  return {
    ...(input.baselineArm === undefined ? {} : { baselineArm: input.baselineArm }),
    baselineReportPath: input.baselineReportPath,
    ...(input.comparator === undefined ? {} : { comparator: input.comparator }),
    baselineRawStageEvidenceRoot: input.baselineRawStageEvidenceRoot,
    baselineStageEvidenceRoot: input.baselineStageEvidenceRoot,
    c4ReadinessCorePath: input.c4ReadinessCorePath,
    c4ReadinessReportPath: input.c4ReadinessReportPath,
    c4ReadinessWorkspaceRoot: input.c4ReadinessWorkspaceRoot,
    c4ReviewDispatchPath: input.c4ReviewDispatchPath,
    c4ReviewInputBundlePath: input.c4ReviewInputBundlePath,
    c4ReviewProvenancePath: input.c4ReviewProvenancePath,
    c4ReviewRequestPath: input.c4ReviewRequestPath,
    c4ReviewResponsePath: input.c4ReviewResponsePath,
    datasetRoot: input.datasetRoot,
    materialEffectPercentagePoints: input.materialEffectPercentagePoints,
    orderSeed: input.orderSeed,
  };
}

// The frozen plan hashes the summarizer protocol; the runtime input carries
// the matching prompt bytes and credential. They must describe the same
// protocol or the run cannot claim the plan it prints.
function assertComparatorInputConsistent(
  input: C5NativeLongitudinalPilotInput,
): void {
  const flatSummary = input.baselineArm === "flat-summary";
  if (!flatSummary) {
    if (input.comparator !== undefined || input.comparatorRuntime !== undefined) {
      throw new Error("C5 comparator inputs require the flat-summary baseline");
    }
    return;
  }
  if (input.comparator === undefined || input.comparatorRuntime === undefined) {
    throw new Error(
      "C5 flat-summary baseline requires both the comparator protocol and runtime",
    );
  }
  if (
    input.comparator.summaryModel !== input.comparatorRuntime.summaryModel ||
    input.comparator.summaryPromptSha256 !==
      input.comparatorRuntime.summaryPromptSha256 ||
    input.comparator.summaryEndpointSha256 !==
      sha256(input.comparatorRuntime.summaryEndpoint)
  ) {
    throw new Error("C5 comparator runtime does not match its frozen protocol");
  }
}

async function validateC5NativePilotPaths(
  input: C5NativeLongitudinalPilotInput,
): Promise<string[]> {
  const roots = [
    resolve(input.c4ReadinessWorkspaceRoot),
    resolve(input.outputDirectory),
    resolve(input.runtimeRoot),
    resolve(input.sourceRoot),
    resolve(input.workspaceRoot),
  ];
  await assertDisjointRoots(roots);
  await assertMutableRootsOutsideProtectedInputs(roots, [
    resolve(input.authFile),
    resolve(input.baselineReportPath),
    ...(input.baselineRawStageEvidenceRoot
      ? [resolve(input.baselineRawStageEvidenceRoot)]
      : []),
    ...(input.baselineStageEvidenceRoot
      ? [resolve(input.baselineStageEvidenceRoot)]
      : []),
    resolve(input.c4ReadinessCorePath),
    resolve(input.c4ReadinessReportPath),
    resolve(input.c4ReviewDispatchPath),
    resolve(input.c4ReviewInputBundlePath),
    resolve(input.c4ReviewProvenancePath),
    resolve(input.c4ReviewRequestPath),
    resolve(input.c4ReviewResponsePath),
    resolve(input.datasetRoot),
    ...(input.npmCacheSeed === undefined ? [] : [resolve(input.npmCacheSeed)]),
    resolve(input.packageTarball),
    RUNNER_SOURCE_ROOT,
  ]);
  return roots;
}

function assertReadinessResult(input: {
  plan: C5PilotPlan;
  planBytes: string;
  planSha256: string;
  prerequisiteEvidenceBytes: string;
  prerequisiteEvidenceSha256: string;
}): void {
  if (
    input.planBytes !== serializeC5PilotPlan(input.plan) ||
    input.planSha256 !== sha256(input.planBytes) ||
    input.prerequisiteEvidenceSha256 !==
      sha256(input.prerequisiteEvidenceBytes)
  ) {
    throw new Error("C5 readiness result is not internally bound");
  }
}

function assertDatasetBoundToPlan(
  loaded: LoadedCodexCodingEffectDataset,
  plan: C5PilotPlan,
): void {
  if (
    loaded.dataset.datasetId !== plan.datasetId ||
    loaded.manifestSha256 !== plan.bindings.manifestSha256
  ) {
    throw new Error("C5 loaded dataset drifted from the frozen plan");
  }
}

function buildRunIdentity(
  input: C5NativeLongitudinalPilotInput,
  planSha256: string,
  runnerSourceAggregateSha256: string,
  ownedRoots: readonly C5OwnedMutableRoot[],
): Record<string, unknown> {
  return {
    claimBoundary: "internal-native-longitudinal-pilot-only",
    evidenceClass: "native-longitudinal-pilot",
    generatedAt: input.generatedAt,
    host: "codex",
    model: input.model,
    mutableRootsSha256: sha256(JSON.stringify({
      c4ReadinessWorkspaceRoot: resolve(input.c4ReadinessWorkspaceRoot),
      outputDirectory: resolve(input.outputDirectory),
      ownedRoots: ownedRoots.map((root) => ({
        lexicalPath: root.lexicalPath,
        markerSha256: sha256(root.markerBytes),
        physicalPath: root.physicalPath,
        role: root.role,
      })),
    })),
    networkAccess: false,
    phase: "C5",
    planSha256,
    publicClaimEligible: false,
    publicCodingEffectProof: false,
    reasoningEffort: input.reasoningEffort,
    runId: input.runId,
    runnerSourceAggregateSha256,
    schemaVersion: 1,
    stageTimeoutMs: input.stageTimeoutMs,
    testTimeoutMs: input.testTimeoutMs,
  };
}

async function prepareOwnedMutableRoots(
  input: C5NativeLongitudinalPilotInput,
  resume: boolean,
): Promise<C5OwnedMutableRoot[]> {
  const configured = [
    { path: input.runtimeRoot, role: "runtime" as const },
    { path: input.sourceRoot, role: "source" as const },
    { path: input.workspaceRoot, role: "workspace" as const },
  ];
  return Promise.all(configured.map(async ({ path, role }) => {
    const lexicalPath = resolve(path);
    const markerBytes = `${JSON.stringify({
      lexicalPath,
      role,
      runId: input.runId,
      schemaVersion: 1,
    }, null, 2)}\n`;
    const markerPath = resolve(lexicalPath, OWNED_ROOT_MARKER);
    if (!resume) {
      await mkdir(lexicalPath, { recursive: true });
      await writeFile(markerPath, markerBytes, { encoding: "utf8", flag: "wx" });
    } else {
      let persistedMarker: string;
      try {
        persistedMarker = await readFile(markerPath, "utf8");
      } catch (error) {
        throw new Error(`C5 resume mutable root is not run-owned: ${role}`, {
          cause: error,
        });
      }
      if (persistedMarker !== markerBytes) {
        throw new Error(`C5 resume mutable root is not run-owned: ${role}`);
      }
    }
    return {
      lexicalPath,
      markerBytes,
      physicalPath: await realpath(lexicalPath),
      role,
    };
  }));
}

async function clearOwnedMutableRoot(root: C5OwnedMutableRoot): Promise<void> {
  const markerPath = resolve(root.physicalPath, OWNED_ROOT_MARKER);
  if (
    await realpath(root.lexicalPath) !== root.physicalPath ||
    await readFile(markerPath, "utf8") !== root.markerBytes
  ) {
    throw new Error(`C5 resume mutable root ownership drifted: ${root.role}`);
  }
  const entries = await readdir(root.physicalPath);
  await Promise.all(entries
    .filter((entry) => entry !== OWNED_ROOT_MARKER)
    .map((entry) =>
      rm(resolve(root.physicalPath, entry), { force: true, recursive: true })
    ));
}

async function existingRunGeneratedAt(outputDirectory: string): Promise<string> {
  let identity: unknown;
  try {
    identity = JSON.parse(await readFile(
      resolve(outputDirectory, "run-identity.json"),
      "utf8",
    ));
  } catch (error) {
    throw new Error("C5 resume requires a valid existing run identity", {
      cause: error,
    });
  }
  if (
    typeof identity !== "object" ||
    identity === null ||
    !("generatedAt" in identity) ||
    typeof identity.generatedAt !== "string" ||
    identity.generatedAt.length === 0
  ) {
    throw new Error("C5 resume run identity has no generatedAt");
  }
  return identity.generatedAt;
}

async function writeOrVerifyRunInput(input: {
  bytes: string;
  path: string;
  resume: boolean;
}): Promise<void> {
  if (input.resume && await exists(input.path)) {
    if (await readFile(input.path, "utf8") !== input.bytes) {
      throw new Error(`C5 resume input bytes drifted: ${basename(input.path)}`);
    }
    return;
  }
  await writeFile(input.path, input.bytes, { encoding: "utf8", flag: "wx" });
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`C5 mutable run root already exists: ${path}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertDisjointRoots(roots: readonly string[]): Promise<void> {
  const candidates = await Promise.all(roots.map(physicalPathCandidates));
  for (const [index, root] of roots.entries()) {
    for (const [offset] of roots.slice(index + 1).entries()) {
      const otherIndex = index + offset + 1;
      if (candidates[index]!.some((first) =>
        candidates[otherIndex]!.some((second) =>
          pathInsideOrEqual(first, second) || pathInsideOrEqual(second, first)
        )
      )) {
        throw new Error("C5 mutable run roots must be disjoint");
      }
    }
  }
}

async function assertMutableRootsOutsideProtectedInputs(
  roots: readonly string[],
  protectedInputs: readonly string[],
): Promise<void> {
  const rootCandidates = await Promise.all(roots.map(physicalPathCandidates));
  const protectedCandidates = await Promise.all(
    protectedInputs.map(physicalPathCandidates),
  );
  for (const [rootIndex, root] of roots.entries()) {
    for (const [protectedIndex, protectedInput] of protectedInputs.entries()) {
      if (rootCandidates[rootIndex]!.some((rootCandidate) =>
        protectedCandidates[protectedIndex]!.some((protectedCandidate) =>
          pathInsideOrEqual(rootCandidate, protectedCandidate) ||
          pathInsideOrEqual(protectedCandidate, rootCandidate)
        )
      )) {
        throw new Error(
          `C5 mutable run root ${root} must not overlap protected input ${protectedInput}`,
        );
      }
    }
  }
}

async function physicalPathCandidates(path: string): Promise<string[]> {
  const lexicalPath = resolve(path);
  let existingAncestor = lexicalPath;
  const missingSegments: string[] = [];
  while (true) {
    try {
      return [...new Set([
        lexicalPath,
        resolve(await realpath(existingAncestor), ...missingSegments),
      ])];
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        return [lexicalPath];
      }
      missingSegments.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
}

function pathInsideOrEqual(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createLiveLogger(
  input: C5NativeLongitudinalPilotInput,
): (event: string, details?: Record<string, unknown>) => void {
  const path = resolve(input.outputDirectory, "events.jsonl");
  return (event, details = {}) => {
    const row: C5LivePilotLogEvent = {
      details,
      event,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
    input.onLog?.(row);
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
