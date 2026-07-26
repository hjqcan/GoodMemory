import { createHash } from "node:crypto";
import { COPYFILE_EXCL } from "node:constants";
import { appendFileSync } from "node:fs";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  buildC3CodexArgs,
  buildFrozenPrehistoryArmPlans,
} from "./c3-arms";
import {
  createC3EvaluatorEnvironment,
  evaluateC3ArmSafely,
  verifyC3EvaluatorFiles,
} from "./c3-evaluator";
import { auditC3PermissionIsolation } from "./c3-permission-isolation";
import {
  cleanupC3ArmRuntime,
  prepareC3NoMemoryArm,
} from "./c3-runtime";
import type { C3NoMemoryArmRuntime } from "./c3-runtime";
import { prepareC3IsolatedClone } from "./c3-workspace";
import {
  buildC4BaselineCeilingTargets,
  buildC4BaselineFrozenStageBindings,
  buildC4BaselinePrompt,
  loadC4BaselineStageEvidenceFiles,
  runC4AdaptiveBaselineCeiling,
  serializeC4BaselineCeilingReport,
  serializeC4BaselineRunIdentity,
  verifyC4BaselineRawStageEvidenceFiles,
} from "./c4-baseline-ceiling";
import type {
  C4BaselineCeilingReport,
  C4BaselineCeilingTarget,
  C4BaselineRunIdentity,
  C4BaselineFrozenStageBinding,
  C4BaselineStageResult,
} from "./c4-baseline-ceiling";
import {
  buildC4AssetLock,
  c4RepositoryIdForUrl,
  loadC4AssetLock,
  materializeC4SourceRepository,
} from "./c4-controlled-dataset";
import { validateC4ControlledPilotDataset } from "./c4-contracts";
import { runCodexProcess } from "./codex-runner";
import { loadCodexCodingEffectDataset } from "./dataset";
import type {
  CodexCodingEffectDatasetV2,
} from "./dataset";
import {
  createCodexCodingEffectLogger,
} from "./logging";
import type {
  CodexCodingEffectLogEvent,
} from "./logging";
import { captureWorkspacePatch } from "./patch";
import type { WorkspacePatch } from "./patch";
import {
  prepareCodexEvaluatorSandbox,
} from "./evaluator-sandbox";
import type {
  CodexEvaluatorNetworkProbe,
} from "./evaluator-sandbox";
import { runBoundaryProcess } from "./process";

export interface C4NoMemoryCeilingPilotInput {
  authFile: string;
  bunExecutable: string;
  codexExecutable: string;
  datasetRoot: string;
  evaluatorNetworkProbe?: CodexEvaluatorNetworkProbe;
  generatedAt: string;
  model: string;
  onLog?: (event: C4BaselineLiveLogEvent) => void;
  outputDirectory: string;
  reasoningEffort: string;
  runId: string;
  runtimeRoot: string;
  sourceRoot: string;
  stageTimeoutMs: number;
  testTimeoutMs: number;
  workspaceRoot: string;
}

export interface C4NoMemoryCeilingPilotResult {
  frozenStageBindings: C4BaselineFrozenStageBinding[];
  report: C4BaselineCeilingReport;
  reportBytes: string;
  reportSha256: string;
}

export interface C4BaselineLiveLogEvent {
  details: Record<string, unknown>;
  event: string;
  timestamp: string;
}

interface MaterializedRepository {
  commit: string;
  path: string;
  tree: string;
}

export async function runC4NoMemoryCeilingPilot(
  input: C4NoMemoryCeilingPilotInput,
): Promise<C4NoMemoryCeilingPilotResult> {
  const outputDirectory = resolve(input.outputDirectory);
  const sourceRoot = resolve(input.sourceRoot);
  await Promise.all([
    assertAbsent(outputDirectory, "C4 baseline output directory"),
    assertAbsent(sourceRoot, "C4 baseline source root"),
  ]);
  await Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    mkdir(sourceRoot, { recursive: true }),
  ]);
  const log = createLiveLogger(input, outputDirectory);
  log("baseline_preflight_started", {
    datasetRootSha256: sha256(resolve(input.datasetRoot)),
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  });

  try {
    const codexHost = await collectC4BaselineCodexIdentity({
      codexExecutable: input.codexExecutable,
      cwd: input.datasetRoot,
    });
    const datasetSnapshotRoot = join(sourceRoot, "dataset");
    await cp(resolve(input.datasetRoot), datasetSnapshotRoot, {
      errorOnExist: true,
      force: false,
      recursive: true,
    });
    const [{ dataset, manifestSha256 }, storedAssetLock, currentAssetLock] =
      await Promise.all([
        loadCodexCodingEffectDataset(datasetSnapshotRoot),
        loadC4AssetLock(datasetSnapshotRoot),
        buildC4AssetLock(datasetSnapshotRoot),
      ]);
    const controlledDataset = validateC4ControlledPilotDataset(dataset);
    assertAssetLockCurrent(
      storedAssetLock.assetLock,
      currentAssetLock,
    );
    const repositories = await materializeRepositories({
      dataset: controlledDataset,
      datasetRoot: datasetSnapshotRoot,
      sourceRoot: join(sourceRoot, "repositories"),
    });
    const frozenStageBindings = await buildC4BaselineFrozenStageBindings({
      dataset: controlledDataset,
      datasetRoot: datasetSnapshotRoot,
      repositories,
    });
    const runIdentity: C4BaselineRunIdentity = {
      assetLockSha256: storedAssetLock.assetLockSha256,
      assetRootSha256: storedAssetLock.assetLock.assetRootSha256,
      claimBoundary: "diagnostic-no-memory-ceiling-only",
      codexExecutableSha256: codexHost.sha256,
      codexVersion: codexHost.version,
      datasetSnapshotMode: "asset-locked-copy",
      datasetId: controlledDataset.datasetId,
      generatedAt: input.generatedAt,
      host: "codex",
      manifestSha256,
      model: input.model,
      networkAccess: false,
      publicClaimEligible: false,
      reasoningEffort: input.reasoningEffort,
      runId: input.runId,
      schemaVersion: 2,
      stageTimeoutMs: input.stageTimeoutMs,
      strategy: "stage-3-first-then-stage-2-if-needed",
      testTimeoutMs: input.testTimeoutMs,
    };
    const runIdentityBytes = serializeC4BaselineRunIdentity(runIdentity);
    await writeFile(
      join(outputDirectory, "run-identity.json"),
      runIdentityBytes,
      { encoding: "utf8", flag: "wx" },
    );
    log("baseline_preflight_completed", {
      episodeCount: controlledDataset.episodes.length,
      manifestSha256,
      repositoryCount: repositories.size,
    });

    const seenThreadIds = new Set<string>();
    const report = await runC4AdaptiveBaselineCeiling({
      executeStage: (target) =>
        executeBaselineStage({
          dataset: controlledDataset,
          datasetRoot: datasetSnapshotRoot,
          input,
          log,
          repositories,
          runIdentity,
          seenThreadIds,
          target,
        }),
      runIdentity,
      targets: buildC4BaselineCeilingTargets(controlledDataset),
    });
    verifyC4BaselineRawStageEvidenceFiles(
      report,
      await loadC4BaselineStageEvidenceFiles(
        join(outputDirectory, "stages"),
        report,
      ),
      frozenStageBindings,
    );
    const reportBytes = serializeC4BaselineCeilingReport(report);
    const reportSha256 = sha256(reportBytes);
    await writeFile(join(outputDirectory, "report.json"), reportBytes, {
      encoding: "utf8",
      flag: "wx",
    });
    log("baseline_completed", {
      attemptedCount: report.attemptedCount,
      ceilingRisk: report.ceilingRisk,
      decision: report.decision,
      reportSha256,
      resolvedCount: report.resolvedCount,
    });
    return { frozenStageBindings, report, reportBytes, reportSha256 };
  } catch (error) {
    const reason = sanitizeFailureReason(errorMessage(error));
    await writeFile(
      join(outputDirectory, "preflight-failure.sanitized.json"),
      `${JSON.stringify({
        reason,
        reasonSha256: sha256(reason),
        schemaVersion: 1,
        status: "infrastructure-failure",
      }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    log("baseline_preflight_failed", {
      reasonSha256: sha256(reason),
    });
    throw error;
  } finally {
    await rm(sourceRoot, { force: true, recursive: true });
  }
}

async function executeBaselineStage(input: {
  dataset: CodexCodingEffectDatasetV2;
  datasetRoot: string;
  input: C4NoMemoryCeilingPilotInput;
  log: (event: string, details?: Record<string, unknown>) => void;
  repositories: ReadonlyMap<string, MaterializedRepository>;
  runIdentity: C4BaselineRunIdentity;
  seenThreadIds: Set<string>;
  target: C4BaselineCeilingTarget;
}): Promise<C4BaselineStageResult> {
  const episode = requiredEpisode(input.dataset, input.target.episodeId);
  const stage = requiredStage(episode, input.target.stageId);
  const repository = input.repositories.get(episode.repository.url);
  if (repository === undefined) {
    throw new Error(`missing materialized repository for ${episode.id}`);
  }
  const stageKey = `${episode.id}-${stage.id}`;
  const stageDirectory = join(input.input.outputDirectory, "stages", stageKey);
  const evaluationRoot = join(stageDirectory, "evaluation-sandbox");
  const evaluatorRoot = join(evaluationRoot, "evaluator");
  const evaluationWorkspace = join(evaluationRoot, "workspace");
  const logEvents: CodexCodingEffectLogEvent[] = [];
  const promptSource = await readFile(
    join(input.datasetRoot, stage.promptPath),
    "utf8",
  );
  const prompt = buildC4BaselinePrompt({
    allowedFeedback: stage.allowedFeedback,
    prompt: promptSource,
  });
  const datasetEvidence = {
    episodeId: episode.id,
    promptSha256: sha256(prompt),
    repositoryCommit: repository.commit,
    repositoryTree: repository.tree,
    snapshot: stage.snapshot,
    stageId: input.target.stageId,
    stageInputSha256: input.target.stageInputSha256,
  };
  const [plan] = buildFrozenPrehistoryArmPlans({
    episodeId: episode.id,
    repetition: 1,
    resultRoot: join(stageDirectory, "runtime-evidence"),
    runId: input.input.runId,
    runtimeRoot: input.input.runtimeRoot,
    seed: 1,
    stageId: stage.id,
    workspaceRoot: input.input.workspaceRoot,
  });
  let runtime: C3NoMemoryArmRuntime | null = null;
  let failureStage = "stage-setup";
  await mkdir(stageDirectory, { recursive: true });
  input.log("baseline_stage_started", {
    episodeId: episode.id,
    position: stage.position,
    stageId: stage.id,
  });

  try {
    failureStage = "source-clone";
    const clone = await prepareC3IsolatedClone({
      destination: plan.paths.workspace,
      expectedCommit: stage.snapshot,
      sourceRepository: repository.path,
    });
    if (clone.tree !== repository.tree) {
      throw new Error("C4 baseline clone tree does not match frozen repository");
    }

    failureStage = "no-memory-runtime";
    runtime = await prepareC3NoMemoryArm({
      authFile: input.input.authFile,
      bunExecutable: input.input.bunExecutable,
      codexExecutable: input.input.codexExecutable,
      plan,
    });
    if (
      runtime.codex.executableSha256 !==
        input.runIdentity.codexExecutableSha256 ||
      runtime.codex.version !== input.runIdentity.codexVersion
    ) {
      throw new Error("C4 baseline Codex identity drifted after preflight");
    }
    const logger = createCodexCodingEffectLogger({
      arm: "no-memory",
      attemptId: `${episode.id}/${stage.id}/no-memory/1/1#attempt-1`,
      episodeId: episode.id,
      repetition: 1,
      runId: input.input.runId,
      seed: 1,
      stageId: input.target.stageId,
      traceId: `${input.input.runId}/${episode.id}/${stage.id}/no-memory`,
    }, (event) => {
      logEvents.push(event);
      input.input.onLog?.({
        details: event.details,
        event: event.event,
        timestamp: event.timestamp,
      });
    });

    failureStage = "base-health";
    const visible = await runVisibleTest({
      command: stage.visibleTest ?? episode.preparation.command,
      cwd: plan.paths.workspace,
      env: runtime.env,
      timeoutMs: input.input.testTimeoutMs,
    });
    if (!visible.passed) {
      throw new Error(`C4 baseline visible base health failed: ${visible.status}`);
    }

    failureStage = "permission-isolation";
    const permissionIsolation = await auditC3PermissionIsolation({
      deniedReadPaths: hiddenReadPaths(
        input.datasetRoot,
        episode,
        stage.goldPatch.path,
      ),
      phase: "preflight",
      runtime,
    });

    const args = buildC3CodexArgs({
      arm: "no-memory",
      model: input.input.model,
      prompt,
      reasoningEffort: input.input.reasoningEffort,
      workspaceRoot: plan.paths.workspace,
    });

    failureStage = "codex-execution";
    const codex = await runCodexProcess({
      args,
      cwd: plan.paths.workspace,
      env: runtime.env,
      executable: runtime.codex.executable,
      logger,
      timeoutMs: input.input.stageTimeoutMs,
    });
    const codexExitedAt = new Date().toISOString();
    const threadId = codex.normalized?.threadId ?? null;
    let forcedFailureStage: string | null = null;
    if (codex.status === "completed" && threadId === null) {
      forcedFailureStage = "codex-session-isolation";
    } else if (threadId !== null && input.seenThreadIds.has(threadId)) {
      forcedFailureStage = "codex-session-isolation";
    } else if (threadId !== null) {
      input.seenThreadIds.add(threadId);
    }

    let patch = await captureWorkspacePatch({
      baseCommit: stage.snapshot,
      forbiddenPaths: [".goodmemory", "evaluator"],
      logger,
      workspace: plan.paths.workspace,
    });
    patch = markUnexpectedChangedFiles(patch, stage.expectedChangedFiles);

    failureStage = "credential-removal";
    const runtimeForEvidence = runtime;
    await cleanupC3ArmRuntime(runtimeForEvidence);
    runtime = null;
    const credentialsRemovedAt = new Date().toISOString();
    const copiedAuthRemovedBeforeEvaluator = !await pathExists(
      join(runtimeForEvidence.plan.paths.codexHome, "auth.json"),
    );
    if (!copiedAuthRemovedBeforeEvaluator) {
      throw new Error("C4 copied Codex auth remained after runtime cleanup");
    }

    failureStage = "evaluator-materialization";
    const evaluatorMaterializedAt = new Date().toISOString();
    const commitments = await materializeEvaluator({
      datasetRoot: input.datasetRoot,
      evaluatorRoot,
    });
    await verifyC3EvaluatorFiles(evaluatorRoot, commitments);
    const evaluatorEnv = await createC3EvaluatorEnvironment({
      bunExecutable: input.input.bunExecutable,
      outputDirectory: evaluationRoot,
    });

    failureStage = "evaluator-sandbox";
    const evaluatorSandbox = await prepareCodexEvaluatorSandbox({
      authFile: input.input.authFile,
      baseEnv: runtimeForEvidence.env,
      bunExecutable: input.input.bunExecutable,
      codexExecutable: runtimeForEvidence.codex.executable,
      copiedAuthRemovedBeforeEvaluator,
      evaluationWorkspace,
      evaluatorReadProbePath: join(evaluatorRoot, "runner.ts"),
      evaluatorRoot,
      ...(input.input.evaluatorNetworkProbe === undefined
        ? {}
        : { networkProbe: input.input.evaluatorNetworkProbe }),
      profileName: "c4-evaluator",
      sandboxRoot: evaluationRoot,
    });

    failureStage = "hidden-evaluation";
    const evaluated = await evaluateC3ArmSafely({
      agent: { codex, patch },
      evaluationWorkspace,
      evaluatorEnv,
      evaluatorRoot: evaluatorSandbox.evaluatorRoot,
      expectedCommit: stage.snapshot,
      failToPassCommand: stage.hiddenFailToPass,
      logger,
      passToPassCommand: stage.hiddenPassToPass,
      runProcess: evaluatorSandbox.runProcess,
      sourceRepository: repository.path,
      testTimeoutMs: Math.min(input.input.testTimeoutMs, stage.timeoutMs),
    });
    const score = forcedFailureStage === null
      ? evaluated.score
      : {
          disposition: "infrastructure-failure" as const,
          executionFailureStage: forcedFailureStage,
          resolved: false,
          taskFailureReasons: [],
        };
    const result = {
      changedFiles: evaluated.patch.changedFiles,
      codexStatus: evaluated.codex.status,
      disposition: score.disposition,
      episodeId: episode.id,
      executionFailureStage: score.executionFailureStage,
      failToPassStatus: evaluated.failToPass.status,
      passToPassStatus: evaluated.passToPass.status,
      patchSha256: evaluated.patch.sha256,
      resolved: score.resolved,
      stageId: input.target.stageId,
      stageInputSha256: input.target.stageInputSha256,
      taskFailureReasons: score.taskFailureReasons,
      threadId,
    };
    const stageEvidenceSha256 = await persistStageEvidence(stageDirectory, {
      arm: {
        absenceAudit: runtimeForEvidence.isolation,
        codexExecutableSha256: runtimeForEvidence.codex.executableSha256,
        codexVersion: runtimeForEvidence.codex.version,
        instructionSha256: runtimeForEvidence.instructionSha256,
        networkAccess: false,
        permissionIsolation,
      },
      codex: {
        durationMs: codex.durationMs,
        eventCount: codex.events.length,
        exitCode: codex.exitCode,
        failureEvents: codex.failureEvents ?? [],
        status: codex.status,
        stderr: codex.stderr,
        stdoutOmitted: true,
        timedOut: codex.timedOut,
        usage: codex.normalized?.usage ?? null,
      },
      dataset: datasetEvidence,
      evaluator: {
        commitments,
        credentialsRemovedAt,
        credentialsRemovedBeforeMaterialization:
          evaluatorMaterializedAt >= credentialsRemovedAt,
        failToPass: evaluated.failToPass,
        materializedAfterCodexExit:
          evaluatorMaterializedAt >= codexExitedAt,
        materializedAt: evaluatorMaterializedAt,
        passToPass: evaluated.passToPass,
        sandbox: evaluatorSandbox.evidence,
      },
      events: logEvents,
      patch: evaluated.patch,
      result,
      schemaVersion: 1,
      visibleBaseHealth: visible,
    });
    input.log("baseline_stage_completed", {
      episodeId: episode.id,
      resolved: result.resolved,
      stageEvidenceSha256,
      stageId: input.target.stageId,
    });
    return { ...result, stageEvidenceSha256 };
  } catch (error) {
    const reason = errorMessage(error);
    const result = {
      changedFiles: [],
      codexStatus: "not-started",
      disposition: "infrastructure-failure" as const,
      episodeId: episode.id,
      executionFailureStage: failureStage,
      failToPassStatus: "infrastructure-failure",
      passToPassStatus: "infrastructure-failure",
      patchSha256: null,
      resolved: false,
      stageId: input.target.stageId,
      stageInputSha256: input.target.stageInputSha256,
      taskFailureReasons: [],
      threadId: null,
    };
    const stageEvidenceSha256 = await persistStageEvidence(stageDirectory, {
      dataset: datasetEvidence,
      events: logEvents,
      failure: {
        failureStage,
        reason,
        reasonSha256: sha256(reason),
      },
      result,
      schemaVersion: 1,
    });
    input.log("baseline_stage_failed", {
      episodeId: episode.id,
      failureStage,
      reasonSha256: sha256(reason),
      stageEvidenceSha256,
      stageId: stage.id,
    });
    return { ...result, stageEvidenceSha256 };
  } finally {
    await Promise.all([
      runtime === null ? Promise.resolve() : cleanupC3ArmRuntime(runtime),
      rm(plan.paths.workspace, { force: true, recursive: true }),
      rm(evaluationRoot, { force: true, recursive: true }),
    ]);
  }
}

async function collectC4BaselineCodexIdentity(input: {
  codexExecutable: string;
  cwd: string;
}): Promise<{ sha256: string; version: string }> {
  const candidate = input.codexExecutable.includes("/") ||
      input.codexExecutable.includes("\\")
    ? input.codexExecutable
    : Bun.which(input.codexExecutable);
  if (candidate === null || candidate === undefined) {
    throw new Error("C4 baseline Codex executable is unavailable");
  }
  const executable = await realpath(candidate);
  const result = await runBoundaryProcess({
    args: ["--version"],
    cwd: input.cwd,
    executable,
    timeoutMs: 60_000,
  });
  if (
    result.spawnError !== undefined ||
    result.timedOut ||
    result.exitCode !== 0 ||
    result.stdout.trim().length === 0
  ) {
    throw new Error("C4 baseline Codex version preflight failed");
  }
  return {
    sha256: sha256(await readFile(executable)),
    version: result.stdout.trim(),
  };
}

async function materializeRepositories(input: {
  dataset: CodexCodingEffectDatasetV2;
  datasetRoot: string;
  sourceRoot: string;
}): Promise<Map<string, MaterializedRepository>> {
  const repositories = new Map<string, MaterializedRepository>();
  for (const episode of input.dataset.episodes) {
    if (repositories.has(episode.repository.url)) {
      continue;
    }
    const repositoryId = c4RepositoryIdForUrl(episode.repository.url);
    const path = join(input.sourceRoot, repositoryId);
    const identity = await materializeC4SourceRepository({
      datasetRoot: input.datasetRoot,
      destination: path,
      repositoryId,
    });
    if (identity.commit !== episode.repository.baseCommit) {
      throw new Error(`C4 repository commit mismatch for ${repositoryId}`);
    }
    repositories.set(episode.repository.url, { ...identity, path });
  }
  return repositories;
}

async function materializeEvaluator(input: {
  datasetRoot: string;
  evaluatorRoot: string;
}): Promise<Array<{ relativePath: string; sha256: string }>> {
  await mkdir(input.evaluatorRoot, { recursive: true });
  const relativePaths = ["cases.json", "runner.ts"] as const;
  await Promise.all(relativePaths.map((relativePath) =>
    copyFile(
      join(input.datasetRoot, "evaluator", relativePath),
      join(input.evaluatorRoot, relativePath),
      COPYFILE_EXCL,
    )
  ));
  return Promise.all(relativePaths.map(async (relativePath) => ({
    relativePath,
    sha256: sha256(await readFile(join(input.evaluatorRoot, relativePath))),
  })));
}

function hiddenReadPaths(
  datasetRoot: string,
  episode: CodexCodingEffectDatasetV2["episodes"][number],
  goldPatchPath: string,
): Array<{ label: string; path: string }> {
  if (episode.prehistory.source !== "frozen-artifact") {
    throw new Error("C4 baseline requires frozen prehistory");
  }
  return [
    { label: "asset-lock", path: join(datasetRoot, "asset-lock.json") },
    { label: "dataset-manifest", path: join(datasetRoot, "manifest.json") },
    { label: "evaluator-cases", path: join(datasetRoot, "evaluator", "cases.json") },
    { label: "evaluator-runner", path: join(datasetRoot, "evaluator", "runner.ts") },
    { label: "frozen-prehistory", path: join(datasetRoot, episode.prehistory.path) },
    { label: "gold-patch", path: join(datasetRoot, goldPatchPath) },
  ];
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
  stderr: string;
  stdout: string;
}> {
  const executable = input.command[0];
  if (executable === undefined) {
    throw new Error("C4 visible base-health command cannot be empty");
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
    stderr: result.stderr,
    stdout: result.stdout,
  };
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

async function persistStageEvidence(
  stageDirectory: string,
  evidence: Record<string, unknown>,
): Promise<string> {
  const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(join(stageDirectory, "stage-evidence.json"), bytes, {
    encoding: "utf8",
    flag: "wx",
  });
  return sha256(bytes);
}

function requiredEpisode(
  dataset: CodexCodingEffectDatasetV2,
  episodeId: string,
): CodexCodingEffectDatasetV2["episodes"][number] {
  const episode = dataset.episodes.find((candidate) => candidate.id === episodeId);
  if (episode === undefined) {
    throw new Error(`unknown C4 baseline episode ${episodeId}`);
  }
  return episode;
}

function requiredStage(
  episode: CodexCodingEffectDatasetV2["episodes"][number],
  stageId: string,
): CodexCodingEffectDatasetV2["episodes"][number]["stages"][number] {
  const stage = episode.stages.find((candidate) => candidate.id === stageId);
  if (stage === undefined) {
    throw new Error(`unknown C4 baseline stage ${episode.id}/${stageId}`);
  }
  return stage;
}

function assertAssetLockCurrent(
  stored: Awaited<ReturnType<typeof loadC4AssetLock>>["assetLock"],
  current: Awaited<ReturnType<typeof buildC4AssetLock>>,
): void {
  if (JSON.stringify(stored) !== JSON.stringify(current)) {
    throw new Error("C4 baseline dataset does not match its asset lock");
  }
}

function createLiveLogger(
  input: C4NoMemoryCeilingPilotInput,
  outputDirectory: string,
): (event: string, details?: Record<string, unknown>) => void {
  const path = join(outputDirectory, "events.jsonl");
  return (event, details = {}) => {
    const row: C4BaselineLiveLogEvent = {
      details,
      event,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
    input.onLog?.(row);
  };
}

async function assertAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`${label} already exists: ${basename(path)}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeFailureReason(reason: string): string {
  return reason.replace(
    /\/(?:Users|home|private|tmp|var\/folders)\/[^\s"'`,;()]+/gu,
    "<host-path>",
  );
}
