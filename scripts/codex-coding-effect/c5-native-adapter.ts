import { createHash } from "node:crypto";
import { COPYFILE_EXCL } from "node:constants";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildC3CodexArgs,
  buildComparatorArmPlans,
} from "./c3-arms";
import type {
  C3ArmPlan,
  C3FlatSummaryArmPlan,
  C3NoMemoryArmPlan,
} from "./c3-arms";
import {
  createC3EvaluatorEnvironment,
  evaluateC3ArmSafely,
  verifyC3EvaluatorFiles,
} from "./c3-evaluator";
import {
  auditC3PermissionIsolation,
} from "./c3-permission-isolation";
import {
  cleanupC3ArmRuntime,
  prepareC3FlatSummaryArm,
  prepareC3InstalledArm,
  prepareC3NoMemoryArm,
  removeC3ArmModelCredential,
} from "./c3-runtime";
import {
  collectC3HostConfigurationEvidence,
  serializeC3HostConfigurationEvidence,
} from "./c3-host-configuration";
import { collectC3HostPreflightEvidence } from "./c3-host-preflight";
import type {
  C3BaselineArmRuntime,
  C3FlatSummaryArmRuntime,
  C3InstalledArmRuntime,
} from "./c3-runtime";
import {
  C5_FLAT_SUMMARY_INJECTION_FILES,
  C5_FLAT_SUMMARY_RECEIPTS_FILE,
  C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS,
  buildC5FlatSummaryHistory,
  evaluateC5FlatSummaryHookReceipts,
  generateC5FlatSummary,
  parseC5FlatSummaryHookReceipts,
  resolveC5FlatSummaryInjection,
} from "./c5-flat-summary-arm";
import type {
  C5FlatSummaryGeneration,
  C5FlatSummaryInjection,
} from "./c5-flat-summary-arm";
import { prepareC3IsolatedClone } from "./c3-workspace";
import {
  buildC4BaselinePrompt,
} from "./c4-baseline-ceiling";
import {
  buildC4AssetLock,
  c4RepositoryIdForUrl,
  loadC4AssetLock,
  materializeC4SourceRepository,
  serializeC4AssetLock,
} from "./c4-controlled-dataset";
import {
  collectC5InstalledHostCanary,
} from "./c5-host-canary";
import type {
  C5InstalledHostCanaryResult,
} from "./c5-host-canary";
import {
  hashC5ComparableHostEnvironment,
  parseC5HostEnvironment,
} from "./c5-host-environment";
import { buildC5StageLeakageInput } from "./c5-leakage-input";
import type {
  C5LivePilotAdapter,
  C5LivePilotHandle,
  C5NativeLongitudinalPilotInput,
} from "./c5-live-pilot";
import {
  auditC5LiveLeakageSurfaces,
} from "./c5-live-leakage";
import type { C5TrajectoryOrigin } from "./c5-live-leakage";
import type {
  C5StageEvaluation,
  C5StageExecution,
} from "./c5-longitudinal";
import { c5PlanBaselineArm } from "./c5-pilot-plan";
import type {
  C5PilotEpisodeArmRun,
  C5PilotPlan,
  C5PilotStageRun,
} from "./c5-pilot-plan";
import { isC5StageWritebackRequired } from "./c5-memory-protocol";
import { restoreC5ArmModelCredential } from "./c5-runtime";
import {
  auditC5TaskAliasIsolation,
  buildC5TaskDeniedPaths,
  persistC5SanitizedPermissionIsolation,
} from "./c5-task-isolation";
import type {
  C5SanitizedPermissionIsolationEvidence,
  C5TaskAliasIsolationEvidence,
} from "./c5-task-isolation";
import {
  runCodexProcess,
} from "./codex-runner";
import type { CodexRunResult } from "./codex-runner";
import {
  loadCodexCodingEffectDataset,
} from "./dataset";
import type {
  CodexCodingEffectDatasetV2,
} from "./dataset";
import { prepareCodexEvaluatorSandbox } from "./evaluator-sandbox";
import { createCodexCodingEffectLogger } from "./logging";
import type {
  CodexCodingEffectLogEvent,
  CodexCodingEffectLogger,
} from "./logging";
import {
  captureWorkspacePatch,
} from "./patch";
import type { WorkspacePatch } from "./patch";
import { runBoundaryProcess } from "./process";

type C5Runtime = C3InstalledArmRuntime | C3BaselineArmRuntime;
type C5Episode = CodexCodingEffectDatasetV2["episodes"][number];
type C5DatasetStage = C5Episode["stages"][number];

const RUNNER_SOURCE_FILE = fileURLToPath(import.meta.url);
const RUNNER_SOURCE_ROOT = resolve(dirname(RUNNER_SOURCE_FILE), "../..");

interface MaterializedRepository {
  commit: string;
  path: string;
  tree: string;
}

interface C5NativeStageState {
  canary: C5InstalledHostCanaryResult | null;
  codex: CodexRunResult;
  comparatorInjectedText: string | null;
  patch: WorkspacePatch;
  prompt: string;
}

interface C5ComparatorStagePreparation {
  evidenceSha256: string;
  generation: C5FlatSummaryGeneration | null;
  historySourceSha256: string;
  injection: C5FlatSummaryInjection;
}

interface C5NativeTrajectoryState {
  credentialPresent: boolean;
  episode: C5Episode;
  permissionIsolation: C5SanitizedPermissionIsolationEvidence | null;
  plan: C3ArmPlan;
  priorWrittenMemoryIds: string[];
  repository: MaterializedRepository;
  run: C5PilotEpisodeArmRun;
  runtime: C5Runtime;
  stages: Map<string, C5NativeStageState>;
  taskAliasIsolation: C5TaskAliasIsolationEvidence | null;
}

const C5_EMPTY_STORAGE_DELETE_KEYS = [
  "archives",
  "artifactSpills",
  "episodes",
  "evidence",
  "experiences",
  "facts",
  "feedback",
  "journal",
  "preferences",
  "profiles",
  "promotions",
  "proposals",
  "references",
  "workingMemory",
] as const;

export function resolveC5CodexStageInput(input: {
  allowedFeedback: readonly string[];
  prompt: string;
  stageTimeoutMs: number;
}): { prompt: string; timeoutMs: number } {
  return {
    prompt: buildC4BaselinePrompt({
      allowedFeedback: input.allowedFeedback,
      prompt: input.prompt,
    }),
    timeoutMs: input.stageTimeoutMs,
  };
}

export function resolveC5PriorStageTrajectoryOrigins(input: {
  codexStdout: string;
  patch: string;
  prompt: string;
  stageId: string;
}): C5TrajectoryOrigin[] {
  return [
    {
      content: input.prompt,
      id: `${input.stageId}:effective-prompt`,
    },
    ...(input.patch.length > 0
      ? [{
          content: input.patch,
          id: `${input.stageId}:agent-patch`,
        }]
      : []),
    ...(input.codexStdout.length > 0
      ? [{
          content: input.codexStdout,
          id: `${input.stageId}:codex-jsonl-output`,
        }]
      : []),
  ];
}

export function sanitizeC5StageEvents(input: {
  codexExecutableSha256: string;
  events: readonly CodexCodingEffectLogEvent[];
}): CodexCodingEffectLogEvent[] {
  return input.events.map((event) => ({
    ...event,
    details: sanitizeC5StageEventDetails(event, input.codexExecutableSha256),
  }));
}

export async function initializeC5EmptyInstalledStorage(input: {
  env: Record<string, string | undefined>;
  executable: string;
  run?: typeof runBoundaryProcess;
  storagePath: string;
  timeoutMs: number;
  userId: string;
  workspaceId: string;
  workspaceRoot: string;
}): Promise<"already-initialized" | "initialized"> {
  if (await installedStorageExists(input.storagePath)) {
    return "already-initialized";
  }
  const result = await (input.run ?? runBoundaryProcess)({
    args: [
      "forget",
      "--all",
      "--user-id",
      input.userId,
      "--workspace-id",
      input.workspaceId,
      "--storage-provider",
      "sqlite",
      "--storage-url",
      input.storagePath,
      "--json",
    ],
    cwd: input.workspaceRoot,
    env: input.env,
    executable: input.executable,
    timeoutMs: input.timeoutMs,
  });
  if (result.spawnError !== undefined || result.timedOut || result.exitCode !== 0) {
    throw new Error("C5 empty installed storage initialization failed");
  }
  assertEmptyStorageInitializationReceipt(result.stdout, input);
  if (!await installedStorageExists(input.storagePath)) {
    throw new Error("C5 empty installed storage initialization created no database");
  }
  return "initialized";
}

export async function createC5NativeLiveAdapter(input: {
  dataset: CodexCodingEffectDatasetV2;
  frozenPlan: C5PilotPlan;
  input: C5NativeLongitudinalPilotInput;
}): Promise<C5LivePilotAdapter> {
  const datasetSnapshotRoot = await materializeDatasetSnapshot(input);
  const repositories = await materializeRepositories({
    dataset: input.dataset,
    datasetRoot: datasetSnapshotRoot,
    sourceRoot: join(resolve(input.input.sourceRoot), "repositories"),
  });
  emit(input.input, "dataset_snapshot_validated", {
    datasetId: input.dataset.datasetId,
    repositoryCount: repositories.size,
  });
  const states = new Map<string, C5NativeTrajectoryState>();
  let frozenHostIdentitySha256: string | null = null;

  return {
    auditLiveLeakage: async ({ cluster, runs, stage }) => {
      const pairDirectory = pairStageDirectory(
        input.input.outputDirectory,
        cluster.id,
        stage.stageId,
      );
      await mkdir(pairDirectory, { recursive: true });
      const installed = requiredState(
        states,
        runs.find((run) => run.arm === "goodmemory-installed")!.id,
      );
      const baselineArm = c5PlanBaselineArm(input.frozenPlan);
      const noMemory = requiredState(
        states,
        runs.find((run) => run.arm === baselineArm)!.id,
      );
      assertCredentialsRevoked([noMemory, installed]);
      const installedStage = installed.stages.get(stage.stageId);
      if (installedStage?.canary === null || installedStage === undefined) {
        return persistRejectedLeakageAudit(
          pairDirectory,
          "installed host canary did not produce all live surfaces",
        );
      }
      // The comparator's injected summary is audited as the frozen
      // "flat-summary-after-seeding" surface; the installed canary carries the
      // other three.
      const comparatorText =
        noMemory.stages.get(stage.stageId)?.comparatorInjectedText ?? null;
      const liveSurfaces = installedStage.canary.liveSurfaces.map((surface) =>
        surface.id === "flat-summary-after-seeding" && comparatorText !== null
          ? { ...surface, content: comparatorText }
          : surface
      );
      try {
        const datasetStage = requiredDatasetStage(
          installed.episode,
          stage.stageId,
        );
        const leakageInput = await buildC5StageLeakageInput({
          datasetRoot: datasetSnapshotRoot,
          episode: installed.episode,
          repositoryRoot: installed.repository.path,
          stage: datasetStage,
        });
        const audit = auditC5LiveLeakageSurfaces({
          ...leakageInput,
          liveSurfaces,
          trajectoryOrigins: stage.priorStageIds.flatMap((priorStageId) => {
            const priorStage = installed.stages.get(priorStageId);
            const priorBaselineStage = noMemory.stages.get(priorStageId);
            if (priorStage === undefined || priorBaselineStage === undefined) {
              throw new Error(
                `missing C5 trajectory origin stage ${priorStageId}`,
              );
            }
            return [
              ...resolveC5PriorStageTrajectoryOrigins({
                codexStdout: priorStage.codex.stdout,
                patch: priorStage.patch.diff,
                prompt: priorStage.prompt,
                stageId: priorStageId,
              }),
              ...(baselineArm === "flat-summary"
                ? resolveC5PriorStageTrajectoryOrigins({
                    codexStdout: priorBaselineStage.codex.stdout,
                    patch: priorBaselineStage.patch.diff,
                    prompt: priorBaselineStage.prompt,
                    stageId: `${priorStageId}:flat-summary`,
                  })
                : []),
            ];
          }),
        });
        await writeFile(
          join(pairDirectory, "live-leakage-audit.json"),
          `${JSON.stringify(audit, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
        emit(input.input, "live_leakage_audit_completed", {
          clusterId: cluster.id,
          stageId: stage.stageId,
          status: audit.status,
        });
        return { auditSha256: audit.auditSha256, status: audit.status };
      } catch (error) {
        return persistRejectedLeakageAudit(
          pairDirectory,
          `live leakage audit failed: ${errorMessage(error)}`,
        );
      }
    },
    cleanupTrajectory: async ({ handle, run }) => {
      const state = requiredHandleState(states, handle, run);
      await Promise.all([
        cleanupC3ArmRuntime(state.runtime),
        rm(state.plan.paths.workspace, { force: true, recursive: true }),
      ]);
      states.delete(run.id);
      emit(input.input, "trajectory_cleaned", { runId: run.id });
    },
    evaluatePair: async ({ cluster, runs, stage }) => {
      const pairDirectory = pairStageDirectory(
        input.input.outputDirectory,
        cluster.id,
        stage.stageId,
      );
      const pairRuntimeRoot = join(
        resolve(input.input.runtimeRoot),
        "evaluators",
        sha256(cluster.id).slice(0, 16),
        stage.stageId,
      );
      const sourceEvaluatorRoot = join(pairRuntimeRoot, "source");
      const statesForRuns = runs.map((run) => requiredState(states, run.id));
      assertCredentialsRevoked(statesForRuns);
      emit(input.input, "pair_evaluation_started", {
        clusterId: cluster.id,
        stageId: stage.stageId,
      });
      try {
        const commitments = await materializeEvaluator({
          datasetRoot: datasetSnapshotRoot,
          evaluatorRoot: sourceEvaluatorRoot,
        });
        await verifyC3EvaluatorFiles(sourceEvaluatorRoot, commitments);
        const evaluations: C5StageEvaluation[] = [];
        for (const run of runs) {
          const state = requiredState(states, run.id);
          evaluations.push(await evaluateStage({
            authFile: input.input.authFile,
            bunExecutable: input.input.bunExecutable,
            commitments,
            datasetStage: requiredDatasetStage(state.episode, stage.stageId),
            deniedReadPaths: [
              datasetSnapshotRoot,
              resolve(input.input.outputDirectory),
              resolve(input.input.packageTarball),
              ...(input.input.npmCacheSeed === undefined
                ? []
                : [resolve(input.input.npmCacheSeed)]),
              RUNNER_SOURCE_ROOT,
              ...statesForRuns.flatMap((candidate) => [
                candidate.runtime.plan.paths.armRoot,
                candidate.runtime.plan.paths.workspace,
              ]),
            ],
            pairDirectory,
            pairRuntimeRoot,
            sourceEvaluatorRoot,
            state,
            testTimeoutMs: input.input.testTimeoutMs,
          }));
        }
        emit(input.input, "pair_evaluation_completed", {
          clusterId: cluster.id,
          infrastructureFailureCount: evaluations.filter((evaluation) =>
            evaluation.disposition === "infrastructure-failure"
          ).length,
          stageId: stage.stageId,
        });
        return evaluations;
      } catch (error) {
        const reason = errorMessage(error);
        return Promise.all(runs.map((run) =>
          persistInfrastructureEvaluation(pairDirectory, run.arm, reason)
        ));
      } finally {
        await rm(pairRuntimeRoot, { force: true, recursive: true });
      }
    },
    executeStage: async ({ handle, run, stage }) => {
      const state = requiredHandleState(states, handle, run);
      return executeNativeStage({
        datasetRoot: datasetSnapshotRoot,
        input: input.input,
        stage,
        state,
      });
    },
    prepareTrajectory: async ({ run }) => {
      if (states.has(run.id)) {
        throw new Error(`C5 trajectory was prepared twice: ${run.id}`);
      }
      emit(input.input, "trajectory_prepare_started", {
        arm: run.arm,
        runId: run.id,
      });
      const episode = requiredEpisode(input.dataset, run.episodeId);
      const repository = repositories.get(episode.repository.url);
      if (repository === undefined) {
        throw new Error(`C5 source repository is missing for ${episode.id}`);
      }
      const baselineArm = c5PlanBaselineArm(input.frozenPlan);
      if (run.arm !== baselineArm && run.arm !== "goodmemory-installed") {
        throw new Error(`C5 run ${run.id} is outside the frozen arm pair`);
      }
      const [noMemoryPlan, installedPlan] = buildComparatorArmPlans({
        baselineArm,
        episodeId: run.episodeId,
        repetition: run.repetition,
        resultRoot: join(
          resolve(input.input.outputDirectory),
          "trajectories",
          sha256(run.clusterId).slice(0, 16),
        ),
        runId: input.input.runId,
        runtimeRoot: input.input.runtimeRoot,
        seed: input.frozenPlan.randomization.orderSeed,
        stageId: `longitudinal-${sha256(run.clusterId).slice(0, 12)}`,
        workspaceRoot: input.input.workspaceRoot,
      });
      const plan = run.arm === "goodmemory-installed" ? installedPlan : noMemoryPlan;
      await prepareC3IsolatedClone({
        destination: plan.paths.workspace,
        expectedCommit: run.stages[0]!.snapshot,
        sourceRepository: repository.path,
      });
      const permissionDeniedReadPaths = buildTaskDeniedPathValues({
        currentPlan: plan,
        datasetRoot: datasetSnapshotRoot,
        input: input.input,
        otherPlan: run.arm === "goodmemory-installed" ? noMemoryPlan : installedPlan,
        repository,
      });
      let runtime: C5Runtime;
      if (run.arm === "no-memory") {
        runtime = await prepareC3NoMemoryArm({
          authFile: input.input.authFile,
          bunExecutable: input.input.bunExecutable,
          codexExecutable: input.input.codexExecutable,
          permissionDeniedReadPaths,
          plan: noMemoryPlan as C3NoMemoryArmPlan,
        });
      } else if (run.arm === "flat-summary") {
        if (input.input.comparatorRuntime === undefined) {
          throw new Error(
            "C5 flat-summary baseline requires the comparator runtime input",
          );
        }
        runtime = await prepareC3FlatSummaryArm({
          authFile: input.input.authFile,
          bunExecutable: input.input.bunExecutable,
          codexExecutable: input.input.codexExecutable,
          permissionDeniedReadPaths,
          plan: noMemoryPlan as C3FlatSummaryArmPlan,
        });
      } else {
        runtime = await prepareC3InstalledArm({
          authFile: input.input.authFile,
          bunExecutable: input.input.bunExecutable,
          codexExecutable: input.input.codexExecutable,
          ...(input.input.npmCacheSeed === undefined
            ? {}
            : { npmCacheSeed: resolve(input.input.npmCacheSeed) }),
          npmExecutable: input.input.npmExecutable,
          ...(input.input.npmRegistry === undefined
            ? {}
            : { npmRegistry: input.input.npmRegistry }),
          packageTarball: input.input.packageTarball,
          permissionDeniedReadPaths,
          plan: installedPlan,
        });
        const storageStatus = await initializeC5EmptyInstalledStorage({
          env: runtime.env,
          executable: runtime.goodmemoryExecutable,
          storagePath: runtime.storagePath,
          timeoutMs: input.input.testTimeoutMs,
          userId: runtime.plan.scopes.userId,
          workspaceId: runtime.plan.scopes.workspaceId,
          workspaceRoot: runtime.plan.paths.workspace,
        });
        emit(input.input, "installed_storage_ready", {
          status: storageStatus,
        });
      }
      const state: C5NativeTrajectoryState = {
        credentialPresent: true,
        episode,
        permissionIsolation: null,
        plan,
        priorWrittenMemoryIds: [],
        repository,
        run,
        runtime,
        stages: new Map(),
        taskAliasIsolation: null,
      };
      states.set(run.id, state);
      try {
        const hostIdentitySha256 = await auditClusterWhenReady({
          clusterId: run.clusterId,
          datasetRoot: datasetSnapshotRoot,
          input: input.input,
          states,
        });
        if (hostIdentitySha256 !== null) {
          if (
            frozenHostIdentitySha256 !== null &&
            frozenHostIdentitySha256 !== hostIdentitySha256
          ) {
            throw new Error("C5 Codex or GoodMemory host identity drifted");
          }
          frozenHostIdentitySha256 = hostIdentitySha256;
        }
      } catch (error) {
        states.delete(run.id);
        await Promise.all([
          cleanupC3ArmRuntime(state.runtime),
          rm(state.plan.paths.workspace, { force: true, recursive: true }),
        ]);
        throw error;
      }
      emit(input.input, "trajectory_prepare_completed", {
        arm: run.arm,
        runId: run.id,
      });
      return { runId: run.id };
    },
    restoreCredential: async ({ handle, run }) => {
      const state = requiredHandleState(states, handle, run);
      if (state.credentialPresent) {
        throw new Error("C5 trajectory credential was not revoked before restore");
      }
      await restoreC5ArmModelCredential({
        authFile: input.input.authFile,
        runtime: state.runtime,
      });
      state.credentialPresent = true;
      emit(input.input, "credential_restored", { runId: run.id });
    },
    revokeCredential: async ({ handle, run }) => {
      const state = requiredHandleState(states, handle, run);
      if (!state.credentialPresent) {
        throw new Error("C5 trajectory credential was already revoked");
      }
      await removeC3ArmModelCredential(state.runtime);
      state.credentialPresent = false;
      emit(input.input, "credential_revoked", { runId: run.id });
    },
  };
}

async function materializeDatasetSnapshot(input: {
  dataset: CodexCodingEffectDatasetV2;
  frozenPlan: C5PilotPlan;
  input: C5NativeLongitudinalPilotInput;
}): Promise<string> {
  const sourceRoot = resolve(input.input.sourceRoot);
  const snapshotRoot = join(sourceRoot, "dataset");
  await mkdir(sourceRoot, { recursive: true });
  await cp(resolve(input.input.datasetRoot), snapshotRoot, {
    errorOnExist: true,
    force: false,
    recursive: true,
  });
  const [loaded, stored, current] = await Promise.all([
    loadCodexCodingEffectDataset(snapshotRoot),
    loadC4AssetLock(snapshotRoot),
    buildC4AssetLock(snapshotRoot),
  ]);
  if (
    loaded.manifestSha256 !== input.frozenPlan.bindings.manifestSha256 ||
    stored.assetLockSha256 !== input.frozenPlan.bindings.assetLockSha256 ||
    current.assetRootSha256 !== input.frozenPlan.bindings.assetRootSha256 ||
    serializeC4AssetLock(stored.assetLock) !== serializeC4AssetLock(current) ||
    JSON.stringify(loaded.dataset) !== JSON.stringify(input.dataset)
  ) {
    throw new Error("C5 copied dataset does not match the frozen readiness plan");
  }
  return snapshotRoot;
}

async function materializeRepositories(input: {
  dataset: CodexCodingEffectDatasetV2;
  datasetRoot: string;
  sourceRoot: string;
}): Promise<Map<string, MaterializedRepository>> {
  const repositories = new Map<string, MaterializedRepository>();
  for (const episode of input.dataset.episodes) {
    if (repositories.has(episode.repository.url)) continue;
    const repositoryId = c4RepositoryIdForUrl(episode.repository.url);
    const path = join(input.sourceRoot, repositoryId);
    const identity = await materializeC4SourceRepository({
      datasetRoot: input.datasetRoot,
      destination: path,
      repositoryId,
    });
    if (identity.commit !== episode.repository.baseCommit) {
      throw new Error(`C5 repository commit mismatch for ${repositoryId}`);
    }
    repositories.set(episode.repository.url, { ...identity, path });
  }
  return repositories;
}

async function executeNativeStage(input: {
  datasetRoot: string;
  input: C5NativeLongitudinalPilotInput;
  stage: C5PilotStageRun;
  state: C5NativeTrajectoryState;
}): Promise<C5StageExecution> {
  emit(input.input, "stage_started", {
    arm: input.state.run.arm,
    stageRunId: input.stage.id,
  });
  const datasetStage = requiredDatasetStage(
    input.state.episode,
    input.stage.stageId,
  );
  const stageDirectory = join(input.state.plan.paths.result, input.stage.stageId);
  await mkdir(stageDirectory, { recursive: true });
  const events: CodexCodingEffectLogEvent[] = [];
  const logger = createStageLogger(input, events);
  let codex = notStartedCodex();
  let patch = emptyPatch(input.stage.snapshot);
  let prompt = "";
  let memoryExportBeforeStage = "";
  let canary: C5InstalledHostCanaryResult | null = null;
  let comparator: C5ComparatorStagePreparation | null = null;
  let comparatorHookPassed: boolean | null = null;
  let visible: Awaited<ReturnType<typeof runVisibleTest>> | null = null;
  let failureStage: string | null = null;
  let failureReason: string | null = null;
  try {
    if (!input.state.credentialPresent) {
      throw new Error("C5 stage cannot launch without its copied credential");
    }
    if (input.state.permissionIsolation === null) {
      throw new Error("C5 stage permission isolation was not audited");
    }
    failureStage = "repository-isolation";
    await replaceC5TrajectoryWorkspace({
      destination: input.state.plan.paths.workspace,
      expectedCommit: input.stage.snapshot,
      sourceRepository: input.state.repository.path,
    });
    const stageInput = resolveC5CodexStageInput({
      allowedFeedback: datasetStage.allowedFeedback,
      prompt: await readFile(join(input.datasetRoot, datasetStage.promptPath), "utf8"),
      stageTimeoutMs: input.input.stageTimeoutMs,
    });
    prompt = stageInput.prompt;
    failureStage = "visible-base-health";
    visible = await runVisibleTest({
      command: datasetStage.visibleTest ?? input.state.episode.preparation.command,
      cwd: input.state.plan.paths.workspace,
      env: input.state.runtime.env,
      timeoutMs: input.input.testTimeoutMs,
    });
    if (!visible.passed) {
      throw new Error(`C5 visible base health failed: ${visible.status}`);
    }
    if (
      input.state.run.arm === "goodmemory-installed" &&
      isInstalledRuntime(input.state.runtime)
    ) {
      failureStage = "pre-stage-memory-export";
      memoryExportBeforeStage = await capturePreStageMemoryExport({
        runtime: input.state.runtime,
        stageDirectory,
        timeoutMs: input.input.testTimeoutMs,
      });
    }
    if (
      input.state.run.arm === "flat-summary" &&
      isFlatSummaryRuntime(input.state.runtime)
    ) {
      failureStage = "flat-summary-injection";
      comparator = await prepareC5ComparatorStage({
        datasetRoot: input.datasetRoot,
        datasetStage,
        input: input.input,
        runtime: input.state.runtime,
        stage: input.stage,
        stageDirectory,
        state: input.state,
      });
    }
    failureStage = "codex-execution";
    codex = await runCodexProcess({
      args: buildC3CodexArgs({
        arm: input.state.run.arm,
        model: input.input.model,
        prompt,
        reasoningEffort: input.input.reasoningEffort,
        workspaceRoot: input.state.plan.paths.workspace,
      }),
      cwd: input.state.plan.paths.workspace,
      env: input.state.runtime.env,
      executable: input.state.runtime.codex.executable,
      logger,
      timeoutMs: stageInput.timeoutMs,
    });
    failureStage = codex.status === "completed" ? null : "codex-execution";
    patch = markUnexpectedChangedFiles(
      await captureWorkspacePatch({
        baseCommit: input.stage.snapshot,
        forbiddenPaths: [".goodmemory", "evaluator"],
        logger,
        workspace: input.state.plan.paths.workspace,
      }),
      datasetStage.expectedChangedFiles,
    );
    if (
      input.state.run.arm === "goodmemory-installed" &&
      isInstalledRuntime(input.state.runtime) &&
      codex.status === "completed"
    ) {
      canary = await collectC5InstalledHostCanary({
        codex,
        effectivePrompt: prompt,
        evidenceDirectory: join(stageDirectory, "host-canary"),
        expectedPriorMemoryIds: input.state.priorWrittenMemoryIds,
        memoryExportBeforeStage,
        memoryExpectation: input.stage.memoryExpectation,
        runtime: input.state.runtime,
        timeoutMs: input.input.testTimeoutMs,
        writebackRequired: isC5StageWritebackRequired({
          priorWritebackCommitted: input.state.priorWrittenMemoryIds.length > 0,
          run: input.state.run,
          stage: input.stage,
        }),
      });
      if (!canary.canary.passed) {
        failureStage = "host-canary";
        failureReason = canary.canary.reasons.join("\n");
      }
      input.state.priorWrittenMemoryIds = uniqueSorted([
        ...input.state.priorWrittenMemoryIds,
        ...canary.canary.currentWrittenMemoryIds,
      ]);
    }
    if (
      comparator !== null &&
      isFlatSummaryRuntime(input.state.runtime) &&
      codex.status === "completed"
    ) {
      const receiptsPath = join(
        input.state.runtime.plan.paths.injectionRoot,
        C5_FLAT_SUMMARY_RECEIPTS_FILE,
      );
      const receipts = parseC5FlatSummaryHookReceipts(
        await readOptionalUtf8(receiptsPath) ?? "",
      );
      const hookEvaluation = evaluateC5FlatSummaryHookReceipts({
        expectedContentSha256: comparator.injection.mode === "content-injection"
          ? comparator.injection.userPromptSubmit.contentSha256
          : null,
        receipts,
      });
      comparatorHookPassed = hookEvaluation.passed;
      if (!hookEvaluation.passed) {
        failureStage = "comparator-hook-canary";
        failureReason = hookEvaluation.reasons.join("\n");
      }
    }
  } catch (error) {
    failureReason = errorMessage(error);
    if (failureStage === null) failureStage = "stage-execution";
  }
  const memoryChannelStatus = input.state.run.arm !== "goodmemory-installed"
    ? "not-applicable" as const
    : canary?.canary.memoryChannelStatus ?? "failed";
  const executionBasis = {
    arm: input.state.run.arm,
    codexDurationMs: codex.durationMs,
    codexStatus: codex.status,
    codexUsage: codex.normalized?.usage ?? null,
    ...(input.state.run.arm === "flat-summary"
      ? {
          comparatorInjection: comparator === null
            ? null
            : {
                historySourceSha256: comparator.historySourceSha256,
                hookEvaluationPassed: comparatorHookPassed === true,
                injectedContentSha256:
                  comparator.injection.mode === "content-injection"
                    ? comparator.injection.userPromptSubmit.contentSha256
                    : null,
                injectedTokenCount:
                  comparator.injection.userPromptSubmit.injectedTokenCount,
                mode: comparator.injection.mode,
              },
        }
      : {}),
    infrastructureFailureStage: failureStage,
    memoryObservation: canary === null
      ? null
      : {
          injectedRecordCount: canary.canary.injectedRecordIds.length,
          irrelevantInjection: canary.canary.irrelevantInjection,
          recalledPriorMemoryCount:
            canary.canary.recalledPriorMemoryIds.length,
          writebackCommitted: canary.canary.writebackCommitted,
          writtenMemoryCount: canary.canary.currentWrittenMemoryIds.length,
        },
    memoryChannelStatus,
    stageRunId: input.stage.id,
    threadId: codex.normalized?.threadId ?? null,
  };
  const evidenceBytes = `${JSON.stringify({
    canaryEvidenceSha256: canary?.evidenceSha256 ?? null,
    ...(input.state.run.arm === "flat-summary"
      ? { comparatorEvidenceSha256: comparator?.evidenceSha256 ?? null }
      : {}),
    codex: {
      durationMs: codex.durationMs,
      eventCount: codex.events.length,
      exitCode: codex.exitCode,
      status: codex.status,
      timedOut: codex.timedOut,
      usage: codex.normalized?.usage ?? null,
    },
    effectivePromptSha256: sha256(prompt),
    events: sanitizeC5StageEvents({
      codexExecutableSha256: input.state.runtime.codex.executableSha256,
      events,
    }),
    execution: executionBasis,
    failureReasonSha256:
      failureReason === null ? null : sha256(failureReason),
    patch: {
      changedFiles: patch.changedFiles,
      forbiddenFiles: patch.forbiddenFiles,
      hasPatch: patch.hasPatch,
      sha256: patch.sha256,
      untrackedFiles: patch.untrackedFiles,
    },
    permissionIsolationSha256:
      input.state.permissionIsolation?.evidenceSha256 ?? null,
    schemaVersion: 1,
    visibleBaseHealth: visible,
  }, null, 2)}\n`;
  const execution: C5StageExecution = {
    ...executionBasis,
    stageEvidenceSha256: sha256(evidenceBytes),
  };
  await Promise.all([
    writeFile(join(stageDirectory, "agent.patch"), patch.diff, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(
      join(stageDirectory, "stage-execution.sanitized.json"),
      evidenceBytes,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  input.state.stages.set(input.stage.stageId, {
    canary,
    codex,
    comparatorInjectedText:
      comparator?.injection.mode === "content-injection"
        ? comparator.injection.injectedText
        : null,
    patch,
    prompt,
  });
  emit(input.input, "stage_completed", {
    arm: input.state.run.arm,
    codexStatus: execution.codexStatus,
    infrastructureFailureStage: execution.infrastructureFailureStage,
    memoryChannelStatus: execution.memoryChannelStatus,
    stageRunId: input.stage.id,
  });
  return execution;
}

async function capturePreStageMemoryExport(input: {
  runtime: C3InstalledArmRuntime;
  stageDirectory: string;
  timeoutMs: number;
}): Promise<string> {
  const outputRoot = join(input.stageDirectory, ".pre-stage-memory-export");
  await rm(outputRoot, { force: true, recursive: true });
  try {
    const result = await runBoundaryProcess({
      args: [
        "export-memory",
        "--user-id",
        input.runtime.plan.scopes.userId,
        "--workspace-id",
        input.runtime.plan.scopes.workspaceId,
        "--storage-provider",
        "sqlite",
        "--storage-url",
        input.runtime.storagePath,
        "--output",
        outputRoot,
      ],
      cwd: input.runtime.plan.paths.workspace,
      env: input.runtime.env,
      executable: input.runtime.goodmemoryExecutable,
      timeoutMs: input.timeoutMs,
    });
    if (result.spawnError !== undefined || result.timedOut || result.exitCode !== 0) {
      throw new Error("C5 pre-stage memory export failed");
    }
    return await readFile(join(outputRoot, "memory-export.json"), "utf8");
  } finally {
    await rm(outputRoot, { force: true, recursive: true });
  }
}

async function installedStorageExists(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) {
      throw new Error("C5 installed storage path is not a regular file");
    }
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function assertEmptyStorageInitializationReceipt(
  stdout: string,
  expected: {
    storagePath: string;
    userId: string;
    workspaceId: string;
  },
): void {
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error("C5 empty installed storage receipt is not JSON");
  }
  if (!isRecord(value)) {
    throw new Error("C5 empty installed storage receipt is invalid");
  }
  const deleted = value.deleted;
  if (!isRecord(deleted)) {
    throw new Error("C5 empty installed storage receipt is invalid");
  }
  // The receipt must cover every known memory kind with a zero count; a
  // newer package may report additional kinds (for example `notes`), which
  // must be zero as well but do not make the storage non-empty.
  const deletedKeys = Object.keys(deleted).sort();
  if (
    C5_EMPTY_STORAGE_DELETE_KEYS.some((key) => !deletedKeys.includes(key)) ||
    deletedKeys.some((key) => deleted[key] !== 0) ||
    value.includeRuntime !== false ||
    !isRecord(value.scope) ||
    value.scope.userId !== expected.userId ||
    value.scope.workspaceId !== expected.workspaceId ||
    !isRecord(value.storage) ||
    value.storage.provider !== "sqlite" ||
    value.storage.location !== expected.storagePath
  ) {
    throw new Error("C5 empty installed storage receipt is not empty and bound");
  }
}

async function evaluateStage(input: {
  authFile: string;
  bunExecutable: string;
  commitments: ReadonlyArray<{ relativePath: string; sha256: string }>;
  datasetStage: C5DatasetStage;
  deniedReadPaths: readonly string[];
  pairDirectory: string;
  pairRuntimeRoot: string;
  sourceEvaluatorRoot: string;
  state: C5NativeTrajectoryState;
  testTimeoutMs: number;
}): Promise<C5StageEvaluation> {
  const stage = input.state.stages.get(input.datasetStage.id);
  if (stage === undefined) {
    return persistInfrastructureEvaluation(
      input.pairDirectory,
      input.state.run.arm,
      "missing-stage-evidence",
    );
  }
  const sandboxRoot = join(input.pairRuntimeRoot, input.state.run.arm);
  const evaluationWorkspace = join(sandboxRoot, "workspace");
  try {
    const evaluatorEnv = await createC3EvaluatorEnvironment({
      bunExecutable: input.bunExecutable,
      outputDirectory: sandboxRoot,
    });
    const sandbox = await prepareCodexEvaluatorSandbox({
      authFile: input.authFile,
      baseEnv: input.state.runtime.env,
      bunExecutable: input.bunExecutable,
      codexExecutable: input.state.runtime.codex.executable,
      copiedAuthRemovedBeforeEvaluator: !input.state.credentialPresent,
      deniedReadPaths: input.deniedReadPaths,
      evaluationWorkspace,
      evaluatorReadProbePath: join(input.sourceEvaluatorRoot, "runner.ts"),
      evaluatorRoot: input.sourceEvaluatorRoot,
      profileName: "c4-evaluator",
      sandboxRoot,
    });
    const evaluated = await evaluateC3ArmSafely({
      agent: { codex: stage.codex, patch: stage.patch },
      evaluationWorkspace,
      evaluatorEnv,
      evaluatorRoot: sandbox.evaluatorRoot,
      expectedCommit: input.datasetStage.snapshot,
      failToPassCommand: input.datasetStage.hiddenFailToPass,
      logger: noOpLogger,
      passToPassCommand: input.datasetStage.hiddenPassToPass,
      runProcess: sandbox.runProcess,
      sourceRepository: input.state.repository.path,
      testTimeoutMs: Math.min(input.testTimeoutMs, input.datasetStage.timeoutMs),
    });
    const evidence = {
      arm: input.state.run.arm,
      evaluatorFiles: input.commitments,
      failToPass: sanitizeTestResult(evaluated.failToPass),
      passToPass: sanitizeTestResult(evaluated.passToPass),
      sandbox: sandbox.evidence,
      schemaVersion: 1,
      score: evaluated.score,
    };
    const evidenceBytes = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(
      join(input.pairDirectory, `${input.state.run.arm}-evaluation.json`),
      evidenceBytes,
      { encoding: "utf8", flag: "wx" },
    );
    return {
      arm: input.state.run.arm,
      disposition: evaluated.score.disposition,
      evaluationEvidenceSha256: sha256(evidenceBytes),
      resolved: evaluated.score.resolved,
      taskFailureReasons: evaluated.score.taskFailureReasons,
    };
  } catch (error) {
    return persistInfrastructureEvaluation(
      input.pairDirectory,
      input.state.run.arm,
      errorMessage(error),
    );
  }
}

async function auditClusterWhenReady(input: {
  clusterId: string;
  datasetRoot: string;
  input: C5NativeLongitudinalPilotInput;
  states: Map<string, C5NativeTrajectoryState>;
}): Promise<string | null> {
  const clusterStates = [...input.states.values()].filter((state) =>
    state.run.clusterId === input.clusterId
  );
  if (clusterStates.length < 2) return null;
  if (clusterStates.length !== 2) {
    throw new Error("C5 cluster prepared more than two arm trajectories");
  }
  assertPairedRuntimeBindings(clusterStates);
  for (const state of clusterStates) {
    const other = clusterStates.find((candidate) => candidate !== state)!;
    const permissionIsolation = await auditC3PermissionIsolation({
      deniedReadPaths: buildTaskDeniedReadProbes({
        datasetRoot: input.datasetRoot,
        input: input.input,
        other,
        state,
      }),
      phase: "preflight",
      runtime: state.runtime,
    });
    state.permissionIsolation = await persistC5SanitizedPermissionIsolation({
      directory: state.plan.paths.result,
      evidence: permissionIsolation,
    });
    state.taskAliasIsolation = await auditC5TaskAliasIsolation({
      runtime: state.runtime,
      targets: buildTaskAliasReadTargets({
        datasetRoot: input.datasetRoot,
        input: input.input,
        other,
        state,
        states: clusterStates,
      }),
    });
  }
  const installed = clusterStates.find((state) =>
    isInstalledRuntime(state.runtime)
  );
  const noMemory = clusterStates.find((state) =>
    !isInstalledRuntime(state.runtime)
  );
  if (
    installed === undefined ||
    noMemory === undefined ||
    !isInstalledRuntime(installed.runtime) ||
    isInstalledRuntime(noMemory.runtime)
  ) {
    throw new Error("C5 paired host preflight has no exact two-arm binding");
  }
  const baselineRuntime = noMemory.runtime as C3BaselineArmRuntime;
  const hostConfigurations = await collectC3HostConfigurationEvidence({
    installedRuntime: installed.runtime,
    noMemoryRuntime: baselineRuntime,
    repositoryRoot: installed.repository.path,
  });
  const hostPreflight = await collectC3HostPreflightEvidence({
    baseHealth: {
      goodmemoryInstalled: {
        commit: installed.repository.commit,
        passed: true,
        tree: installed.repository.tree,
      },
      noMemory: {
        commit: noMemory.repository.commit,
        passed: true,
        tree: noMemory.repository.tree,
      },
    },
    bunExecutable: input.input.bunExecutable,
    hostConfigurations,
    hostConfigurationsBytes: serializeC3HostConfigurationEvidence(
      hostConfigurations,
    ),
    installedRuntime: installed.runtime,
    model: input.input.model,
    noMemoryRuntime: baselineRuntime,
    npmExecutable: input.input.npmExecutable,
    reasoningEffort: input.input.reasoningEffort,
  });
  const hostEnvironment = parseC5HostEnvironment({
    ...(isFlatSummaryRuntime(baselineRuntime)
      ? { baselineArm: "flat-summary" as const }
      : {}),
    codexFeatures: hostPreflight.codex.features,
    configurations: hostConfigurations,
    goodmemory: {
      configSha256: hostPreflight.goodmemory.configSha256,
      executableSha256: hostPreflight.goodmemory.executableSha256,
      hooksSha256: hostPreflight.goodmemory.hooksSha256,
      mcpExecutableSha256: hostPreflight.goodmemory.mcpExecutableSha256,
      packageSha256: hostPreflight.goodmemory.packageSha256,
    },
    platform: hostPreflight.platform,
    repositoryPolicy: {
      dirtyStatePolicy: "reject",
      workspaceIsolation: "fresh-isolated-clone-per-stage",
    },
    toolchain: Object.fromEntries(Object.entries(hostPreflight.toolchain).map(
      ([name, tool]) => [name, { sha256: tool.sha256, version: tool.version }],
    )),
  }, {
    ...(isFlatSummaryRuntime(baselineRuntime)
      ? { expectedBaselineHooksSha256: baselineRuntime.hookConfig.sha256 }
      : {}),
  });
  const comparableHostEnvironmentSha256 =
    hashC5ComparableHostEnvironment(hostEnvironment);
  const hostIdentity = {
    baselineArm: baselineRuntime.plan.arm,
    codexExecutableSha256: installed.runtime.codex.executableSha256,
    codexVersion: installed.runtime.codex.version,
    goodMemoryPackageSha256: installed.runtime.package.sha256,
    goodMemoryPackageVersion: installed.runtime.package.version,
    comparableHostEnvironmentSha256,
    installedProfile: installed.runtime.profile,
    model: input.input.model,
    reasoningEffort: input.input.reasoningEffort,
  };
  const hostIdentitySha256 = sha256(JSON.stringify(hostIdentity));
  const bytes = `${JSON.stringify({
    arms: clusterStates.map((state) => ({
      arm: state.run.arm,
      instructionSha256: state.runtime.instructionSha256,
      noMemoryAbsence: isInstalledRuntime(state.runtime)
        ? null
        : {
            goodMemoryFileCount: state.runtime.isolation.goodMemoryFileCount,
            hookConfigPresent: state.runtime.isolation.hookConfigPresent,
            mcpConfigPresent: state.runtime.isolation.mcpConfigPresent,
            passed: state.runtime.isolation.passed,
            preexistingSessionCount:
              state.runtime.isolation.preexistingSessionCount,
          },
      permissionIsolationSha256:
        state.permissionIsolation?.evidenceSha256 ?? null,
      taskAliasIsolationSha256:
        state.taskAliasIsolation?.evidenceSha256 ?? null,
    })),
    clusterId: input.clusterId,
    hostEnvironment,
    hostIdentity,
    hostIdentitySha256,
    networkAccess: false,
    repository: {
      commit: installed.repository.commit,
      tree: installed.repository.tree,
    },
    schemaVersion: 2,
  }, null, 2)}\n`;
  await writeFile(
    join(
      resolve(input.input.outputDirectory),
      "trajectories",
      sha256(input.clusterId).slice(0, 16),
      "host-preflight.sanitized.json",
    ),
    bytes,
    { encoding: "utf8", flag: "wx" },
  );
  return hostIdentitySha256;
}

function assertPairedRuntimeBindings(
  states: readonly C5NativeTrajectoryState[],
): void {
  const [first, second] = states;
  if (
    first === undefined ||
    second === undefined ||
    new Set(states.map((state) => state.run.arm)).size !== 2 ||
    first.runtime.codex.executableSha256 !==
      second.runtime.codex.executableSha256 ||
    first.runtime.codex.version !== second.runtime.codex.version ||
    first.runtime.instructionSha256 !== second.runtime.instructionSha256 ||
    first.repository.commit !== second.repository.commit ||
    first.repository.tree !== second.repository.tree
  ) {
    throw new Error("C5 paired runtime bindings are not identical");
  }
}

function buildTaskDeniedPathValues(input: {
  currentPlan: C3ArmPlan;
  datasetRoot: string;
  input: C5NativeLongitudinalPilotInput;
  otherPlan: C3ArmPlan;
  repository: MaterializedRepository;
}): string[] {
  return buildC5TaskDeniedPaths({
    authFile: input.input.authFile,
    currentPlan: input.currentPlan,
    datasetRoot: input.datasetRoot,
    ...(input.input.npmCacheSeed === undefined
      ? {}
      : { npmCacheSeed: resolve(input.input.npmCacheSeed) }),
    otherPlan: input.otherPlan,
    outputDirectory: input.input.outputDirectory,
    packageTarball: input.input.packageTarball,
    repositoryRoot: input.repository.path,
    runnerSourceRoot: RUNNER_SOURCE_ROOT,
  });
}

function buildTaskDeniedReadProbes(input: {
  datasetRoot: string;
  input: C5NativeLongitudinalPilotInput;
  other: C5NativeTrajectoryState;
  state: C5NativeTrajectoryState;
}): Array<{ label: string; path: string }> {
  const episode = input.state.episode;
  if (episode.prehistory.source !== "frozen-artifact") {
    throw new Error("C5 controlled pilot requires frozen audit prehistory");
  }
  const firstStage = episode.stages[0]!;
  const installedPackage = installedPackageProbePath([input.state, input.other]);
  return [
    { label: "asset-lock", path: join(input.datasetRoot, "asset-lock.json") },
    { label: "codex-auth-source", path: resolve(input.input.authFile) },
    {
      label: "current-runtime-auth",
      path: join(input.state.plan.paths.codexHome, "auth.json"),
    },
    {
      label: "current-runtime-config",
      path: join(input.state.plan.paths.codexHome, "config.toml"),
    },
    { label: "dataset-manifest", path: join(input.datasetRoot, "manifest.json") },
    {
      label: "evaluator-cases",
      path: join(input.datasetRoot, "evaluator", "cases.json"),
    },
    {
      label: "evaluator-runner",
      path: join(input.datasetRoot, "evaluator", "runner.ts"),
    },
    {
      label: "frozen-prehistory",
      path: join(input.datasetRoot, episode.prehistory.path),
    },
    {
      label: "gold-patch",
      path: join(input.datasetRoot, firstStage.goldPatch.path),
    },
    {
      label: "installed-package",
      path: installedPackage,
    },
    {
      label: "other-arm-runtime-auth",
      path: join(input.other.plan.paths.codexHome, "auth.json"),
    },
    {
      label: "other-arm-runtime-config",
      path: join(input.other.plan.paths.codexHome, "config.toml"),
    },
    {
      label: "other-arm-workspace",
      path: join(input.other.plan.paths.workspace, "package.json"),
    },
    {
      label: "output-root",
      path: join(resolve(input.input.outputDirectory), "pilot-plan.json"),
    },
    { label: "package-tarball", path: resolve(input.input.packageTarball) },
    {
      label: "goodmemory-source-package",
      path: join(RUNNER_SOURCE_ROOT, "package.json"),
    },
    { label: "runner-source", path: RUNNER_SOURCE_FILE },
    {
      label: "source-repository",
      path: join(input.state.repository.path, "package.json"),
    },
  ];
}

function buildTaskAliasReadTargets(input: {
  datasetRoot: string;
  input: C5NativeLongitudinalPilotInput;
  other: C5NativeTrajectoryState;
  state: C5NativeTrajectoryState;
  states: readonly C5NativeTrajectoryState[];
}): Array<{ label: string; path: string }> {
  const firstStage = input.state.episode.stages[0]!;
  return [
    { label: "source-auth", path: resolve(input.input.authFile) },
    {
      label: "current-runtime-auth",
      path: join(input.state.plan.paths.codexHome, "auth.json"),
    },
    {
      label: "installed-package",
      path: installedPackageProbePath(input.states),
    },
    {
      label: "evaluator-runner",
      path: join(input.datasetRoot, "evaluator", "runner.ts"),
    },
    {
      label: "gold-patch",
      path: join(input.datasetRoot, firstStage.goldPatch.path),
    },
    {
      label: "other-arm-workspace",
      path: join(input.other.plan.paths.workspace, "package.json"),
    },
  ];
}

function installedPackageProbePath(
  states: readonly C5NativeTrajectoryState[],
): string {
  const installed = states.find((state) => isInstalledRuntime(state.runtime));
  const prefix = installed?.plan.paths.packagePrefix;
  if (prefix === undefined) {
    throw new Error("C5 paired task isolation has no installed package prefix");
  }
  return join(
    prefix,
    "lib",
    "node_modules",
    "goodmemory",
    "dist",
    "index.js",
  );
}

async function materializeEvaluator(input: {
  datasetRoot: string;
  evaluatorRoot: string;
}): Promise<Array<{ relativePath: string; sha256: string }>> {
  await mkdir(input.evaluatorRoot, { recursive: true });
  const relativePaths = ["cases.json", "runner.ts"] as const;
  await Promise.all(relativePaths.map((relativePath) => copyFile(
    join(input.datasetRoot, "evaluator", relativePath),
    join(input.evaluatorRoot, relativePath),
    COPYFILE_EXCL,
  )));
  return Promise.all(relativePaths.map(async (relativePath) => ({
    relativePath,
    sha256: sha256(await readFile(join(input.evaluatorRoot, relativePath))),
  })));
}

export async function replaceC5TrajectoryWorkspace(input: {
  destination: string;
  expectedCommit: string;
  sourceRepository: string;
}): Promise<void> {
  await rm(input.destination, { force: true, recursive: true });
  await prepareC3IsolatedClone({
    destination: input.destination,
    expectedCommit: input.expectedCommit,
    sourceRepository: input.sourceRepository,
  });
}

async function runVisibleTest(input: {
  command: readonly string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<{
  durationMs: number;
  exitCode: number | null;
  passed: boolean;
  status: string;
}> {
  const executable = input.command[0];
  if (executable === undefined) {
    throw new Error("C5 visible test command cannot be empty");
  }
  const result = await runBoundaryProcess({
    args: input.command.slice(1),
    cwd: input.cwd,
    env: input.env,
    executable,
    timeoutMs: input.timeoutMs,
  });
  const status = result.spawnError !== undefined
    ? "spawn-failed"
    : result.timedOut
    ? "timed-out"
    : result.exitCode === 0
    ? "passed"
    : "failed";
  return {
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    passed: status === "passed",
    status,
  };
}

function createStageLogger(
  input: {
    input: C5NativeLongitudinalPilotInput;
    stage: C5PilotStageRun;
    state: C5NativeTrajectoryState;
  },
  events: CodexCodingEffectLogEvent[],
): CodexCodingEffectLogger {
  return createCodexCodingEffectLogger({
    arm: input.state.run.arm,
    attemptId: `${input.stage.id}#attempt-1`,
    episodeId: input.state.run.episodeId,
    repetition: input.state.run.repetition,
    runId: input.input.runId,
    seed: input.input.orderSeed,
    stageId: input.stage.stageId,
    traceId: input.stage.id,
  }, (event) => events.push(event));
}

function sanitizeC5StageEventDetails(
  event: CodexCodingEffectLogEvent,
  codexExecutableSha256: string,
): Record<string, unknown> {
  switch (event.event) {
    case "codex_process_started":
      return {
        argumentCount: event.details.argumentCount,
        executableSha256: codexExecutableSha256,
      };
    case "codex_process_exited":
      return {
        durationMs: event.details.durationMs,
        exitCode: event.details.exitCode,
        status: event.details.status,
        timedOut: event.details.timedOut,
      };
    case "codex_event_parse_failed":
      return { errorSha256: sha256(String(event.details.error)) };
    case "codex_process_failure": {
      const failureEvents = event.details.failureEvents as unknown[];
      return {
        failureEventCount: failureEvents.length,
        failureEventsSha256: sha256(JSON.stringify(failureEvents)),
      };
    }
    case "patch_captured":
      return {
        changedFileCount: event.details.changedFileCount,
        forbiddenFileCount: event.details.forbiddenFileCount,
        hasPatch: event.details.hasPatch,
        sha256: event.details.sha256,
        untrackedFileCount: event.details.untrackedFileCount,
      };
    default:
      throw new Error(`C5 stage evidence cannot persist event ${event.event}`);
  }
}

function markUnexpectedChangedFiles(
  patch: WorkspacePatch,
  expectedChangedFiles: readonly string[],
): WorkspacePatch {
  const expected = new Set(expectedChangedFiles);
  return {
    ...patch,
    forbiddenFiles: [...new Set([
      ...patch.forbiddenFiles,
      ...patch.changedFiles.filter((path) => !expected.has(path)),
    ])].sort(),
  };
}

function requiredEpisode(
  dataset: CodexCodingEffectDatasetV2,
  episodeId: string,
): C5Episode {
  const episode = dataset.episodes.find((candidate) => candidate.id === episodeId);
  if (episode === undefined) throw new Error(`unknown C5 episode ${episodeId}`);
  return episode;
}

function requiredDatasetStage(
  episode: C5Episode,
  stageId: string,
): C5DatasetStage {
  const stage = episode.stages.find((candidate) => candidate.id === stageId);
  if (stage === undefined) {
    throw new Error(`unknown C5 stage ${episode.id}/${stageId}`);
  }
  return stage;
}

function requiredState(
  states: ReadonlyMap<string, C5NativeTrajectoryState>,
  runId: string,
): C5NativeTrajectoryState {
  const state = states.get(runId);
  if (state === undefined) throw new Error(`missing C5 trajectory ${runId}`);
  return state;
}

function requiredHandleState(
  states: ReadonlyMap<string, C5NativeTrajectoryState>,
  handle: C5LivePilotHandle,
  run: C5PilotEpisodeArmRun,
): C5NativeTrajectoryState {
  if (handle.runId !== run.id) {
    throw new Error("C5 live adapter handle does not match its scheduled run");
  }
  return requiredState(states, run.id);
}

function isInstalledRuntime(
  runtime: C5Runtime,
): runtime is C3InstalledArmRuntime {
  return runtime.plan.arm === "goodmemory-installed";
}

function isFlatSummaryRuntime(
  runtime: C5Runtime,
): runtime is C3FlatSummaryArmRuntime {
  return runtime.plan.arm === "flat-summary";
}

async function readOptionalUtf8(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

// Before a flat-summary stage launches Codex, the runner builds the arm's own
// prior-stage history, generates one capped summary (or none for a no-history
// stage), audits it against the stage's hidden/gold closure with prior-stage
// origins attested, and writes it into the arm's injection files. Evidence is
// persisted next to the stage: the summary text as a raw artifact and a
// sanitized receipt with hashes, token counts, and provider usage.
async function prepareC5ComparatorStage(input: {
  datasetRoot: string;
  datasetStage: C5DatasetStage;
  input: C5NativeLongitudinalPilotInput;
  runtime: C3FlatSummaryArmRuntime;
  stage: C5PilotStageRun;
  stageDirectory: string;
  state: C5NativeTrajectoryState;
}): Promise<C5ComparatorStagePreparation> {
  const injectionRoot = input.runtime.plan.paths.injectionRoot;
  await mkdir(injectionRoot, { recursive: true });
  await Promise.all([
    rm(join(injectionRoot, C5_FLAT_SUMMARY_INJECTION_FILES.SessionStart), {
      force: true,
    }),
    rm(join(injectionRoot, C5_FLAT_SUMMARY_INJECTION_FILES.UserPromptSubmit), {
      force: true,
    }),
    rm(join(injectionRoot, C5_FLAT_SUMMARY_RECEIPTS_FILE), { force: true }),
  ]);
  const priorStages = input.stage.priorStageIds.map((priorStageId) => {
    const prior = input.state.stages.get(priorStageId);
    const datasetPrior = input.state.episode.stages.find((candidate) =>
      candidate.id === priorStageId
    );
    if (prior === undefined || datasetPrior === undefined) {
      throw new Error(`missing C5 flat-summary history stage ${priorStageId}`);
    }
    return {
      finalMessage: prior.codex.normalized?.finalMessage ?? null,
      patchDiff: prior.patch.diff,
      position: datasetPrior.position,
      prompt: prior.prompt,
      stageId: priorStageId,
    };
  });
  const history = buildC5FlatSummaryHistory(priorStages);
  let generation: C5FlatSummaryGeneration | null = null;
  let injection: C5FlatSummaryInjection;
  if (priorStages.length === 0) {
    injection = resolveC5FlatSummaryInjection({ history, summary: null });
  } else {
    const comparatorRuntime = input.input.comparatorRuntime;
    if (comparatorRuntime === undefined) {
      throw new Error("C5 flat-summary stage has no comparator runtime input");
    }
    const leakageInput = await buildC5StageLeakageInput({
      datasetRoot: input.datasetRoot,
      episode: input.state.episode,
      repositoryRoot: input.state.repository.path,
      stage: input.datasetStage,
    });
    const trajectoryOrigins = priorStages.flatMap((priorStage) => {
      const prior = input.state.stages.get(priorStage.stageId)!;
      return resolveC5PriorStageTrajectoryOrigins({
        codexStdout: prior.codex.stdout,
        patch: prior.patch.diff,
        prompt: prior.prompt,
        stageId: `${priorStage.stageId}:flat-summary`,
      });
    });
    generation = await generateC5FlatSummary({
      apiToken: comparatorRuntime.apiToken,
      auditLeakage: (summary) => {
        const audit = auditC5LiveLeakageSurfaces({
          ...leakageInput,
          liveSurfaces: [
            { content: "", id: "effective-codex-input-after-seeding" },
            { content: summary, id: "flat-summary-after-seeding" },
            { content: "", id: "goodmemory-export-after-seeding" },
            { content: "", id: "goodmemory-hook-context-after-seeding" },
          ],
          trajectoryOrigins,
        });
        return { auditSha256: audit.auditSha256, status: audit.status };
      },
      endpoint: comparatorRuntime.summaryEndpoint,
      history: history.text,
      maxTokens: C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS,
      model: comparatorRuntime.summaryModel,
      prompt: comparatorRuntime.summaryPrompt,
    });
    injection = resolveC5FlatSummaryInjection({
      history,
      summary: generation.summary,
    });
    await Promise.all([
      writeFile(
        join(injectionRoot, C5_FLAT_SUMMARY_INJECTION_FILES.SessionStart),
        injection.injectedText,
        "utf8",
      ),
      writeFile(
        join(injectionRoot, C5_FLAT_SUMMARY_INJECTION_FILES.UserPromptSubmit),
        injection.injectedText,
        "utf8",
      ),
    ]);
  }
  const evidenceRoot = join(input.stageDirectory, "flat-summary");
  await mkdir(evidenceRoot, { recursive: true });
  const receipt = {
    generation: generation === null
      ? null
      : {
          leakageAuditSha256: generation.leakageAuditSha256,
          model: input.input.comparatorRuntime?.summaryModel ?? null,
          promptSha256: input.input.comparatorRuntime?.summaryPromptSha256 ?? null,
          redactedRequestSha256: sha256(generation.redactedRequest),
          requestSha256: generation.requestSha256,
          responseSha256: generation.responseSha256,
          usage: generation.usage,
        },
    historySourceSha256: history.sha256,
    injection: {
      // The verifier binds the pair's "flat-summary-after-seeding" live
      // surface to these two commitments without the summary text itself.
      injectedUtf8Bytes: Buffer.byteLength(injection.injectedText, "utf8"),
      mode: injection.mode,
      semanticSurfaceCommitmentSha256: sha256(JSON.stringify([
        injection.injectedText,
      ])),
      sessionStart: injection.sessionStart,
      userPromptSubmit: injection.userPromptSubmit,
    },
    priorStageIds: input.stage.priorStageIds,
    schemaVersion: 1,
  };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  await Promise.all([
    writeFile(
      join(evidenceRoot, "injection.sanitized.json"),
      receiptBytes,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(join(evidenceRoot, "summary.txt"), injection.injectedText, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(join(evidenceRoot, "history.txt"), history.text, {
      encoding: "utf8",
      flag: "wx",
    }),
  ]);
  return {
    evidenceSha256: sha256(receiptBytes),
    generation,
    historySourceSha256: history.sha256,
    injection,
  };
}

function assertCredentialsRevoked(
  states: readonly C5NativeTrajectoryState[],
): void {
  if (states.length !== 2 || states.some((state) => state.credentialPresent)) {
    throw new Error("C5 evaluator boundary requires both credentials revoked");
  }
}

async function persistRejectedLeakageAudit(
  directory: string,
  reason: string,
): Promise<{ auditSha256: string; status: "rejected" }> {
  const basis = {
    failureReasonSha256: sha256(reason),
    schemaVersion: 5,
    status: "rejected" as const,
    variant: "infrastructure-rejected" as const,
  };
  const auditSha256 = sha256(JSON.stringify(basis));
  await writeFile(
    join(directory, "live-leakage-audit.json"),
    `${JSON.stringify({ ...basis, auditSha256 }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { auditSha256, status: "rejected" };
}

function pairStageDirectory(
  outputDirectory: string,
  clusterId: string,
  stageId: string,
): string {
  return join(
    resolve(outputDirectory),
    "pairs",
    sha256(clusterId).slice(0, 16),
    stageId,
  );
}

function notStartedCodex(): CodexRunResult {
  return {
    durationMs: 0,
    events: [],
    exitCode: null,
    normalized: null,
    status: "not-started",
    stderr: "",
    stdout: "",
    timedOut: false,
  };
}

function emptyPatch(baseCommit: string): WorkspacePatch {
  return {
    baseCommit,
    changedFiles: [],
    diff: "",
    forbiddenFiles: [],
    hasPatch: false,
    sha256: null,
    untrackedFiles: [],
  };
}

async function persistInfrastructureEvaluation(
  directory: string,
  arm: C5PilotEpisodeArmRun["arm"],
  reason: string,
): Promise<C5StageEvaluation> {
  const bytes = `${JSON.stringify({
    arm,
    reasonSha256: sha256(reason),
    schemaVersion: 1,
    status: "infrastructure-failure",
  }, null, 2)}\n`;
  await writeFile(
    join(directory, `${arm}-evaluation-failure.sanitized.json`),
    bytes,
    { encoding: "utf8", flag: "wx" },
  );
  return {
    arm,
    disposition: "infrastructure-failure",
    evaluationEvidenceSha256: sha256(bytes),
    resolved: false,
    taskFailureReasons: [],
  };
}

function sanitizeTestResult(result: {
  command: string[];
  durationMs: number;
  exitCode: number | null;
  kind: string;
  status: string;
}): Record<string, unknown> {
  return {
    commandSha256: sha256(JSON.stringify(result.command)),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    kind: result.kind,
    status: result.status,
  };
}

const noOpLogger: CodexCodingEffectLogger = () => {};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emit(
  input: C5NativeLongitudinalPilotInput,
  event: string,
  details: Record<string, unknown>,
): void {
  input.onLog?.({
    details,
    event,
    timestamp: new Date().toISOString(),
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
