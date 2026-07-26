import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateC4ControlledPilotDataset } from "./c4-contracts";
import {
  c4RepositoryIdForUrl,
  materializeC4SourceRepository,
} from "./c4-controlled-dataset";
import type {
  CodexCodingEffectDataset,
  CodexCodingEffectDatasetV2,
} from "./dataset";

export interface C4BaselineCeilingTarget {
  episodeId: string;
  position: 2 | 3;
  stageInputSha256: string;
  stageId: "stage-2" | "stage-3";
}

export interface C4BaselineStageResult {
  changedFiles: string[];
  codexStatus: string;
  disposition: "finalized" | "infrastructure-failure";
  episodeId: string;
  executionFailureStage: string | null;
  failToPassStatus: string;
  passToPassStatus: string;
  patchSha256: string | null;
  resolved: boolean;
  stageEvidenceSha256: string;
  stageId: "stage-2" | "stage-3";
  stageInputSha256: string;
  taskFailureReasons: string[];
  threadId: string | null;
}

export interface C4BaselineCeilingRound {
  attemptedCount: number;
  ceilingThreshold: number;
  infrastructureFailureCount: number;
  position: 2 | 3;
  resolvedCount: number;
  stageId: "stage-2" | "stage-3";
}

export interface C4BaselineCeilingReport {
  assetLockSha256: string;
  assetRootSha256: string;
  attemptedCount: number;
  ceilingRisk: boolean | null;
  claimBoundary: "diagnostic-no-memory-ceiling-only";
  codexExecutableSha256: string;
  codexVersion: string;
  datasetSnapshotMode: "asset-locked-copy";
  datasetId: string;
  decision:
    | "inconclusive"
    | "proceed-to-c5-pilot"
    | "redesign-episodes-before-c5";
  generatedAt: string;
  infrastructureFailureCount: number;
  manifestSha256: string;
  model: string;
  networkAccess: false;
  publicClaimEligible: false;
  reasoningEffort: string;
  resolvedCount: number;
  results: C4BaselineStageResult[];
  rounds: C4BaselineCeilingRound[];
  runIdentitySha256: string;
  runId: string;
  schemaVersion: 2;
  stageEvidenceAggregateSha256: string;
  stageTimeoutMs: number;
  strategy: {
    earlyCeilingThreshold: 5;
    finalCeilingThreshold: 10;
    firstRound: "stage-3-all-episodes";
    secondRound: "stage-2-all-episodes-if-needed";
    stage1Excluded: true;
  };
  testTimeoutMs: number;
}

export interface C4BaselineRunIdentity {
  assetLockSha256: string;
  assetRootSha256: string;
  claimBoundary: "diagnostic-no-memory-ceiling-only";
  codexExecutableSha256: string;
  codexVersion: string;
  datasetSnapshotMode: "asset-locked-copy";
  datasetId: string;
  generatedAt: string;
  host: "codex";
  manifestSha256: string;
  model: string;
  networkAccess: false;
  publicClaimEligible: false;
  reasoningEffort: string;
  runId: string;
  schemaVersion: 2;
  stageTimeoutMs: number;
  strategy: "stage-3-first-then-stage-2-if-needed";
  testTimeoutMs: number;
}

export interface C4BaselineStageEvidenceFile {
  bytes: string;
  path: string;
}

export interface C4BaselineFrozenStageBinding {
  episodeId: string;
  evaluatorCommitments: ReadonlyArray<{
    relativePath: "cases.json" | "runner.ts";
    sha256: string;
  }>;
  promptSha256: string;
  repositoryCommit: string;
  repositoryTree: string;
  stageId: "stage-2" | "stage-3";
}

export async function buildC4BaselineFrozenStageBindings(input: {
  dataset: CodexCodingEffectDataset;
  datasetRoot: string;
  repositories: ReadonlyMap<string, { commit: string; tree: string }>;
}): Promise<C4BaselineFrozenStageBinding[]> {
  const evaluatorCommitments = await Promise.all(
    (["cases.json", "runner.ts"] as const).map(async (relativePath) => ({
      relativePath,
      sha256: sha256(await readFile(join(
        input.datasetRoot,
        "evaluator",
        relativePath,
      ))),
    })),
  );
  return Promise.all(validateC4ControlledPilotDataset(input.dataset).episodes
    .flatMap((episode) => episode.stages
      .filter((stage) => stage.position === 2 || stage.position === 3)
      .map(async (stage): Promise<C4BaselineFrozenStageBinding> => {
        const repository = input.repositories.get(episode.repository.url);
        if (repository === undefined) {
          throw new Error(`missing C4 frozen repository ${episode.repository.url}`);
        }
        const prompt = buildC4BaselinePrompt({
          allowedFeedback: stage.allowedFeedback,
          prompt: await readFile(
            join(input.datasetRoot, stage.promptPath),
            "utf8",
          ),
        });
        return {
          episodeId: episode.id,
          evaluatorCommitments,
          promptSha256: sha256(prompt),
          repositoryCommit: repository.commit,
          repositoryTree: repository.tree,
          stageId: stage.id as "stage-2" | "stage-3",
        };
      })));
}

export async function reconstructC4BaselineFrozenStageBindings(input: {
  dataset: CodexCodingEffectDataset;
  datasetRoot: string;
}): Promise<C4BaselineFrozenStageBinding[]> {
  const workspace = await mkdtemp(join(tmpdir(), "goodmemory-c4-bindings-"));
  try {
    const repositories = new Map<string, { commit: string; tree: string }>();
    for (const episode of validateC4ControlledPilotDataset(input.dataset).episodes) {
      if (repositories.has(episode.repository.url)) continue;
      const identity = await materializeC4SourceRepository({
        datasetRoot: input.datasetRoot,
        destination: join(
          workspace,
          c4RepositoryIdForUrl(episode.repository.url),
        ),
        repositoryId: c4RepositoryIdForUrl(episode.repository.url),
      });
      repositories.set(episode.repository.url, identity);
    }
    return buildC4BaselineFrozenStageBindings({ ...input, repositories });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

export function buildC4BaselineCeilingTargets(
  dataset: CodexCodingEffectDataset,
): C4BaselineCeilingTarget[] {
  return validateC4ControlledPilotDataset(dataset).episodes.flatMap((episode) =>
    episode.stages
      .filter((stage) => stage.position === 2 || stage.position === 3)
      .map((stage) => ({
        episodeId: episode.id,
        position: stage.position as 2 | 3,
        stageInputSha256: c4BaselineStageInputSha256(episode, stage),
        stageId: stage.id as "stage-2" | "stage-3",
      }))
  );
}

export function c4BaselineStageInputSha256(
  episode: CodexCodingEffectDatasetV2["episodes"][number],
  stage: CodexCodingEffectDatasetV2["episodes"][number]["stages"][number],
): string {
  return sha256(canonicalJson({
    episode: {
      id: episode.id,
      preparation: episode.preparation,
      prehistory: episode.prehistory,
      repository: episode.repository,
    },
    stage,
  }));
}

export function buildC4BaselinePrompt(input: {
  allowedFeedback: readonly string[];
  prompt: string;
}): string {
  const prompt = input.prompt.trim();
  if (input.allowedFeedback.length === 0) {
    return prompt;
  }
  return [
    prompt,
    "",
    "Prior user-visible feedback:",
    ...input.allowedFeedback,
  ].join("\n");
}

export async function runC4AdaptiveBaselineCeiling(input: {
  executeStage: (
    target: C4BaselineCeilingTarget,
  ) => Promise<C4BaselineStageResult>;
  runIdentity: C4BaselineRunIdentity;
  targets: readonly C4BaselineCeilingTarget[];
}): Promise<C4BaselineCeilingReport> {
  const targets = validateTargets(input.targets);
  const runIdentityBytes = serializeC4BaselineRunIdentity(input.runIdentity);
  const results: C4BaselineStageResult[] = [];
  const rounds: C4BaselineCeilingRound[] = [];

  await runRound({
    executeStage: input.executeStage,
    results,
    roundTargets: targets.filter((target) => target.position === 3),
  });
  rounds.push(summarizeRound(results, 3, 5));

  if (infrastructureFailureCount(results) === 0 && resolvedCount(results) < 5) {
    await runRound({
      executeStage: input.executeStage,
      results,
      roundTargets: targets.filter((target) => target.position === 2),
    });
    rounds.push(summarizeRound(results, 2, 10));
  }

  const failures = infrastructureFailureCount(results);
  const resolved = resolvedCount(results);
  const ceilingRisk = failures > 0
    ? null
    : rounds.length === 1
    ? true
    : resolved >= 10;
  const report: C4BaselineCeilingReport = {
    assetLockSha256: input.runIdentity.assetLockSha256,
    assetRootSha256: input.runIdentity.assetRootSha256,
    attemptedCount: results.length,
    ceilingRisk,
    claimBoundary: "diagnostic-no-memory-ceiling-only",
    codexExecutableSha256: input.runIdentity.codexExecutableSha256,
    codexVersion: input.runIdentity.codexVersion,
    datasetSnapshotMode: input.runIdentity.datasetSnapshotMode,
    datasetId: input.runIdentity.datasetId,
    decision: ceilingRisk === null
      ? "inconclusive"
      : ceilingRisk
      ? "redesign-episodes-before-c5"
      : "proceed-to-c5-pilot",
    generatedAt: input.runIdentity.generatedAt,
    infrastructureFailureCount: failures,
    manifestSha256: input.runIdentity.manifestSha256,
    model: input.runIdentity.model,
    networkAccess: false,
    publicClaimEligible: false,
    reasoningEffort: input.runIdentity.reasoningEffort,
    resolvedCount: resolved,
    results,
    rounds,
    runIdentitySha256: sha256(runIdentityBytes),
    runId: input.runIdentity.runId,
    schemaVersion: 2,
    stageEvidenceAggregateSha256: sha256(JSON.stringify(
      stageEvidenceReferences(results),
    )),
    stageTimeoutMs: input.runIdentity.stageTimeoutMs,
    strategy: {
      earlyCeilingThreshold: 5,
      finalCeilingThreshold: 10,
      firstRound: "stage-3-all-episodes",
      secondRound: "stage-2-all-episodes-if-needed",
      stage1Excluded: true,
    },
    testTimeoutMs: input.runIdentity.testTimeoutMs,
  };
  assertC4BaselineCeilingReportBindings(report);
  return report;
}

export function assertC4BaselineCeilingReportBindings(
  report: C4BaselineCeilingReport,
): void {
  const runIdentity: C4BaselineRunIdentity = {
    assetLockSha256: report.assetLockSha256,
    assetRootSha256: report.assetRootSha256,
    claimBoundary: "diagnostic-no-memory-ceiling-only",
    codexExecutableSha256: report.codexExecutableSha256,
    codexVersion: report.codexVersion,
    datasetSnapshotMode: report.datasetSnapshotMode,
    datasetId: report.datasetId,
    generatedAt: report.generatedAt,
    host: "codex",
    manifestSha256: report.manifestSha256,
    model: report.model,
    networkAccess: false,
    publicClaimEligible: false,
    reasoningEffort: report.reasoningEffort,
    runId: report.runId,
    schemaVersion: 2,
    stageTimeoutMs: report.stageTimeoutMs,
    strategy: "stage-3-first-then-stage-2-if-needed",
    testTimeoutMs: report.testTimeoutMs,
  };
  if (
    report.runIdentitySha256 !==
      sha256(serializeC4BaselineRunIdentity(runIdentity))
  ) {
    throw new Error("C4 baseline run identity hash is inconsistent");
  }
  if (
    report.stageEvidenceAggregateSha256 !==
      sha256(JSON.stringify(stageEvidenceReferences(report.results)))
  ) {
    throw new Error("C4 baseline stage evidence aggregate is inconsistent");
  }
  if (
    report.attemptedCount !== report.results.length ||
    report.resolvedCount !== resolvedCount(report.results) ||
    report.infrastructureFailureCount !==
      infrastructureFailureCount(report.results)
  ) {
    throw new Error("C4 baseline result counts are inconsistent");
  }
  const stage3Results = report.results.filter((result) =>
    result.stageId === "stage-3"
  );
  const stage2Results = report.results.filter((result) =>
    result.stageId === "stage-2"
  );
  const resultKeys = report.results.map((result) =>
    `${result.episodeId}/${result.stageId}`
  );
  const shouldRunSecondRound =
    infrastructureFailureCount(stage3Results) === 0 &&
    resolvedCount(stage3Results) < 5;
  if (
    stage3Results.length !== 6 ||
    stage2Results.length !== (shouldRunSecondRound ? 6 : 0) ||
    new Set(resultKeys).size !== resultKeys.length ||
    report.results.some((result) =>
      (result.stageId !== "stage-2" && result.stageId !== "stage-3") ||
      !/^[a-z0-9][a-z0-9._-]*$/u.test(result.episodeId) ||
      !/^[a-f0-9]{64}$/u.test(result.stageInputSha256)
    )
  ) {
    throw new Error("C4 baseline adaptive rounds are inconsistent");
  }
  const expectedRounds = [
    summarizeRound(report.results, 3, 5),
    ...(shouldRunSecondRound
      ? [summarizeRound(report.results, 2, 10)]
      : []),
  ];
  if (JSON.stringify(report.rounds) !== JSON.stringify(expectedRounds)) {
    throw new Error("C4 baseline round summaries are inconsistent");
  }
  const expectedCeilingRisk = report.infrastructureFailureCount > 0
    ? null
    : expectedRounds.length === 1
    ? true
    : report.resolvedCount >= 10;
  const expectedDecision = expectedCeilingRisk === null
    ? "inconclusive"
    : expectedCeilingRisk
    ? "redesign-episodes-before-c5"
    : "proceed-to-c5-pilot";
  if (
    report.ceilingRisk !== expectedCeilingRisk ||
    report.decision !== expectedDecision
  ) {
    throw new Error("C4 baseline ceiling decision is inconsistent");
  }
}

export function verifyC4BaselineDatasetTargets(
  report: C4BaselineCeilingReport,
  expectedTargets: readonly C4BaselineCeilingTarget[],
): void {
  const expectedByKey = new Map(
    validateTargets(expectedTargets).map((target) => [
      `${target.episodeId}/${target.stageId}`,
      target,
    ]),
  );
  const expected = report.results.map((result) => {
    const target = expectedByKey.get(`${result.episodeId}/${result.stageId}`);
    if (target === undefined) {
      return null;
    }
    return targetKey(target);
  });
  const actual = report.results.map((result) =>
    targetKey({
      episodeId: result.episodeId,
      position: result.stageId === "stage-2" ? 2 : 3,
      stageId: result.stageId,
      stageInputSha256: result.stageInputSha256,
    })
  );
  const expectedKeys = expected.filter(
    (target): target is string => target !== null,
  );
  if (
    expectedKeys.length !== expected.length ||
    JSON.stringify([...actual].sort()) !==
      JSON.stringify(expectedKeys.sort())
  ) {
    throw new Error("C4 baseline results do not match the frozen dataset targets");
  }
}

export async function loadC4BaselineStageEvidenceFiles(
  stageEvidenceRoot: string,
  report: C4BaselineCeilingReport,
): Promise<C4BaselineStageEvidenceFile[]> {
  return Promise.all(report.results.map(async (result) => {
    const path = stageEvidenceRelativePath(result);
    return {
      bytes: await readFile(join(stageEvidenceRoot, path), "utf8"),
      path,
    };
  }));
}

export function buildC4BaselineStageEvidenceBindings(
  report: C4BaselineCeilingReport,
  rawFiles: readonly C4BaselineStageEvidenceFile[],
  frozenBindings: readonly C4BaselineFrozenStageBinding[],
): C4BaselineStageEvidenceFile[] {
  verifyC4BaselineRawStageEvidenceFiles(report, rawFiles, frozenBindings);
  const byPath = new Map(rawFiles.map((file) => [file.path, file.bytes]));
  return report.results.map((result) => {
    const path = stageEvidenceRelativePath(result);
    const rawBytes = byPath.get(path);
    if (rawBytes === undefined) {
      throw new Error(`missing C4 baseline raw stage evidence for ${path}`);
    }
    return {
      bytes: `${JSON.stringify({
        evidence: projectStageEvidence(parseRawStageEvidence(rawBytes, path)),
        rawStageEvidenceSha256: result.stageEvidenceSha256,
        result: stageEvidenceResult(result),
        schemaVersion: 2,
      }, null, 2)}\n`,
      path,
    };
  });
}

export function verifyC4BaselineStageEvidenceFiles(
  report: C4BaselineCeilingReport,
  files: readonly C4BaselineStageEvidenceFile[],
  frozenBindings: readonly C4BaselineFrozenStageBinding[],
  rawFiles?: readonly C4BaselineStageEvidenceFile[],
): void {
  if (rawFiles !== undefined) {
    verifyC4BaselineRawStageEvidenceFiles(report, rawFiles, frozenBindings);
  }
  verifyStageEvidenceFileSet(report, files);
  const expectedFiles = rawFiles === undefined
    ? null
    : new Map(
        buildC4BaselineStageEvidenceBindings(
          report,
          rawFiles,
          frozenBindings,
        ).map((file) => [
          file.path,
          file.bytes,
        ]),
      );
  const byPath = new Map(files.map((file) => [file.path, file.bytes]));
  for (const result of report.results) {
    const path = stageEvidenceRelativePath(result);
    const bytes = byPath.get(path);
    if (bytes === undefined) {
      throw new Error(`missing C4 baseline stage evidence binding for ${path}`);
    }
    if (expectedFiles !== null && bytes !== expectedFiles.get(path)) {
      throw new Error(
        `C4 baseline stage evidence does not match authenticated raw source for ${path}`,
      );
    }
    const parsed = parseStageEvidenceBinding(bytes, path);
    if (parsed.rawStageEvidenceSha256 !== result.stageEvidenceSha256) {
      throw new Error(`C4 baseline stage evidence source mismatch for ${path}`);
    }
    const expectedResult = stageEvidenceResult(result);
    if (canonicalJson(parsed.result) !== canonicalJson(expectedResult)) {
      throw new Error(`C4 baseline stage evidence result mismatch for ${path}`);
    }
    verifyProjectedStageEvidence(
      parsed.evidence,
      expectedResult,
      report,
      path,
      requiredFrozenBinding(frozenBindings, result),
    );
  }
}

export function verifyC4BaselineRawStageEvidenceFiles(
  report: C4BaselineCeilingReport,
  files: readonly C4BaselineStageEvidenceFile[],
  frozenBindings: readonly C4BaselineFrozenStageBinding[],
): void {
  verifyStageEvidenceFileSet(report, files);
  const byPath = new Map(files.map((file) => [file.path, file.bytes]));
  for (const result of report.results) {
    const path = stageEvidenceRelativePath(result);
    const bytes = byPath.get(path);
    if (bytes === undefined || sha256(bytes) !== result.stageEvidenceSha256) {
      throw new Error(`C4 baseline stage evidence hash mismatch for ${path}`);
    }
    const parsed = parseRawStageEvidence(bytes, path);
    const expectedResult = stageEvidenceResult(result);
    if (canonicalJson(parsed.result) !== canonicalJson(expectedResult)) {
      throw new Error(`C4 baseline stage evidence result mismatch for ${path}`);
    }
    verifyProjectedStageEvidence(
      projectStageEvidence(parsed),
      expectedResult,
      report,
      path,
      requiredFrozenBinding(frozenBindings, result),
    );
  }
}

function verifyStageEvidenceFileSet(
  report: C4BaselineCeilingReport,
  files: readonly C4BaselineStageEvidenceFile[],
): void {
  const expectedPaths = report.results.map(stageEvidenceRelativePath).sort();
  const actualPaths = files.map((file) => file.path).sort();
  if (
    new Set(actualPaths).size !== actualPaths.length ||
    JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)
  ) {
    throw new Error("C4 baseline stage evidence file set is inconsistent");
  }
}

function requiredFrozenBinding(
  bindings: readonly C4BaselineFrozenStageBinding[],
  result: Pick<C4BaselineStageResult, "episodeId" | "stageId">,
): C4BaselineFrozenStageBinding {
  const binding = bindings.find((candidate) =>
    candidate.episodeId === result.episodeId &&
    candidate.stageId === result.stageId
  );
  if (binding === undefined) {
    throw new Error(
      `missing C4 frozen stage binding for ${result.episodeId}/${result.stageId}`,
    );
  }
  return binding;
}

export function serializeC4BaselineRunIdentity(
  identity: C4BaselineRunIdentity,
): string {
  return `${JSON.stringify(identity, null, 2)}\n`;
}

export function serializeC4BaselineCeilingReport(
  report: C4BaselineCeilingReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function runRound(input: {
  executeStage: (
    target: C4BaselineCeilingTarget,
  ) => Promise<C4BaselineStageResult>;
  results: C4BaselineStageResult[];
  roundTargets: readonly C4BaselineCeilingTarget[];
}): Promise<void> {
  for (const target of input.roundTargets) {
    const result = await input.executeStage(target);
    if (
      result.episodeId !== target.episodeId ||
      result.stageId !== target.stageId ||
      result.stageInputSha256 !== target.stageInputSha256
    ) {
      throw new Error("C4 baseline stage result does not match its target");
    }
    input.results.push(result);
  }
}

function summarizeRound(
  results: readonly C4BaselineStageResult[],
  position: 2 | 3,
  ceilingThreshold: number,
): C4BaselineCeilingRound {
  const stageId = `stage-${position}` as const;
  const roundResults = results.filter((result) => result.stageId === stageId);
  return {
    attemptedCount: roundResults.length,
    ceilingThreshold,
    infrastructureFailureCount: infrastructureFailureCount(roundResults),
    position,
    resolvedCount: resolvedCount(roundResults),
    stageId,
  };
}

function validateTargets(
  targets: readonly C4BaselineCeilingTarget[],
): C4BaselineCeilingTarget[] {
  if (targets.length !== 12) {
    throw new Error("C4 baseline requires stage 2 and stage 3 for six episodes");
  }
  const keys = new Set<string>();
  const episodeIds = new Set<string>();
  for (const target of targets) {
    if (target.stageId !== `stage-${target.position}`) {
      throw new Error("C4 baseline target position and stage id must match");
    }
    if (!/^[a-f0-9]{64}$/u.test(target.stageInputSha256)) {
      throw new Error("C4 baseline target input hash is invalid");
    }
    const key = `${target.episodeId}/${target.stageId}`;
    if (keys.has(key)) {
      throw new Error(`C4 baseline repeats target ${key}`);
    }
    keys.add(key);
    episodeIds.add(target.episodeId);
  }
  if (
    episodeIds.size !== 6 ||
    [...episodeIds].some((episodeId) =>
      !keys.has(`${episodeId}/stage-2`) ||
      !keys.has(`${episodeId}/stage-3`)
    )
  ) {
    throw new Error("C4 baseline targets must cover two stages for six episodes");
  }
  return [...targets].sort((first, second) =>
    first.position === second.position
      ? first.episodeId.localeCompare(second.episodeId)
      : second.position - first.position
  );
}

function targetKey(target: C4BaselineCeilingTarget): string {
  return `${target.episodeId}\0${target.stageId}\0${target.stageInputSha256}`;
}

function infrastructureFailureCount(
  results: readonly C4BaselineStageResult[],
): number {
  return results.filter((result) =>
    result.disposition === "infrastructure-failure"
  ).length;
}

function resolvedCount(results: readonly C4BaselineStageResult[]): number {
  return results.filter((result) => result.resolved).length;
}

function stageEvidenceReferences(
  results: readonly C4BaselineStageResult[],
): Array<{ path: string; sha256: string }> {
  return results.map((result) => ({
    path: stageEvidenceRelativePath(result),
    sha256: result.stageEvidenceSha256,
  }));
}

function stageEvidenceRelativePath(result: C4BaselineStageResult): string {
  return `${result.episodeId}-${result.stageId}/stage-evidence.json`;
}

function stageEvidenceResult(
  result: C4BaselineStageResult,
): Omit<C4BaselineStageResult, "stageEvidenceSha256"> {
  const { stageEvidenceSha256: _, ...evidenceResult } = result;
  return evidenceResult;
}

function parseRawStageEvidence(
  bytes: string,
  path: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    throw new Error(`invalid C4 baseline stage evidence JSON for ${path}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("result" in parsed)
  ) {
    throw new Error(`C4 baseline stage evidence lacks result for ${path}`);
  }
  return parsed as Record<string, unknown>;
}

function parseStageEvidenceBinding(
  bytes: string,
  path: string,
): {
  evidence: Record<string, unknown>;
  rawStageEvidenceSha256: string;
  result: unknown;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    throw new Error(`invalid C4 baseline stage evidence binding JSON for ${path}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Object.keys(parsed).sort().join(",") !==
      "evidence,rawStageEvidenceSha256,result,schemaVersion" ||
    !("evidence" in parsed) ||
    typeof parsed.evidence !== "object" ||
    parsed.evidence === null ||
    !("result" in parsed) ||
    !("schemaVersion" in parsed) ||
    parsed.schemaVersion !== 2 ||
    !("rawStageEvidenceSha256" in parsed) ||
    typeof parsed.rawStageEvidenceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(parsed.rawStageEvidenceSha256)
  ) {
    throw new Error(`invalid C4 baseline stage evidence binding for ${path}`);
  }
  const binding = parsed as {
    evidence: Record<string, unknown>;
    rawStageEvidenceSha256: string;
    result: unknown;
    schemaVersion: 2;
  };
  if (
    bytes !== `${JSON.stringify(binding, null, 2)}\n`
  ) {
    throw new Error(
      `non-canonical C4 baseline stage evidence binding for ${path}`,
    );
  }
  return binding;
}

function projectStageEvidence(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const arm = optionalRecord(raw.arm);
  const codex = optionalRecord(raw.codex);
  const codexFailureEvents = Array.isArray(codex?.failureEvents)
    ? codex.failureEvents
    : null;
  const dataset = optionalRecord(raw.dataset);
  const evaluator = optionalRecord(raw.evaluator);
  const evaluatorSandbox = evaluator === null
    ? null
    : optionalRecord(evaluator.sandbox);
  const failure = optionalRecord(raw.failure);
  const patch = optionalRecord(raw.patch);
  const visibleBaseHealth = optionalRecord(raw.visibleBaseHealth);
  return {
    arm: arm === null
      ? null
      : {
          absenceAuditPassed: optionalRecord(arm.absenceAudit)?.passed ?? null,
          absenceAuditSha256: sha256(canonicalJson(arm.absenceAudit)),
          codexExecutableSha256: arm.codexExecutableSha256,
          codexVersion: arm.codexVersion,
          instructionSha256: arm.instructionSha256,
          networkAccess: arm.networkAccess,
          permissionIsolationEvidenceSha256:
            optionalRecord(arm.permissionIsolation)?.evidenceSha256 ?? null,
          permissionIsolationPassed:
            optionalRecord(optionalRecord(arm.permissionIsolation)?.audit)
              ?.passed ?? null,
        },
    codex: codex === null
      ? null
      : {
          durationMs: codex.durationMs,
          eventCount: codex.eventCount,
          exitCode: codex.exitCode,
          failureEventCount: codexFailureEvents?.length ?? null,
          failureEventsSha256: codexFailureEvents === null
            ? null
            : sha256(canonicalJson(codexFailureEvents)),
          status: codex.status,
          stderrSha256: sha256(String(codex.stderr ?? "")),
          timedOut: codex.timedOut,
          usage: codex.usage ?? null,
        },
    dataset: dataset === null
      ? null
      : {
          episodeId: dataset.episodeId,
          promptSha256: dataset.promptSha256,
          repositoryCommit: dataset.repositoryCommit,
          repositoryTree: dataset.repositoryTree,
          snapshot: dataset.snapshot,
          stageId: dataset.stageId,
          stageInputSha256: dataset.stageInputSha256,
        },
    evaluator: evaluator === null
      ? null
      : {
          commitments: evaluator.commitments,
          credentialsRemovedBeforeMaterialization:
            evaluator.credentialsRemovedBeforeMaterialization,
          failToPass: projectTestObservation(evaluator.failToPass),
          materializedAfterCodexExit: evaluator.materializedAfterCodexExit,
          passToPass: projectTestObservation(evaluator.passToPass),
          sandbox: evaluatorSandbox === null
            ? null
            : {
                configSha256: evaluatorSandbox.configSha256,
                configWriteDenied: evaluatorSandbox.configWriteDenied,
                copiedAuthRemovedBeforeEvaluator:
                  evaluatorSandbox.copiedAuthRemovedBeforeEvaluator,
                evaluatorRead: evaluatorSandbox.evaluatorRead,
                evaluatorWriteDenied: evaluatorSandbox.evaluatorWriteDenied,
                networkAccess: evaluatorSandbox.networkAccess,
                networkDenied: evaluatorSandbox.networkDenied,
                networkPositiveControl:
                  evaluatorSandbox.networkPositiveControl,
                originalAuthAliasDenied:
                  evaluatorSandbox.originalAuthAliasDenied,
                originalAuthDenied: evaluatorSandbox.originalAuthDenied,
                profileName: evaluatorSandbox.profileName,
                schemaVersion: evaluatorSandbox.schemaVersion,
                workspaceRead: evaluatorSandbox.workspaceRead,
                workspaceWrite: evaluatorSandbox.workspaceWrite,
              },
          sandboxEvidenceSha256: sha256(canonicalJson(evaluator.sandbox)),
        },
    failure: failure === null
      ? null
      : {
          failureStage: failure.failureStage,
          reasonSha256: failure.reasonSha256,
        },
    patch: patch === null
      ? null
      : {
          baseCommit: patch.baseCommit,
          changedFiles: patch.changedFiles,
          diff: patch.diff,
          forbiddenFiles: patch.forbiddenFiles,
          hasPatch: patch.hasPatch,
          sha256: patch.sha256,
          untrackedFiles: patch.untrackedFiles,
        },
    visibleBaseHealth: visibleBaseHealth === null
      ? null
      : {
          durationMs: visibleBaseHealth.durationMs,
          exitCode: visibleBaseHealth.exitCode,
          passed: visibleBaseHealth.passed,
          status: visibleBaseHealth.status,
          stderrSha256: sha256(String(visibleBaseHealth.stderr ?? "")),
          stdoutSha256: sha256(String(visibleBaseHealth.stdout ?? "")),
        },
  };
}

function projectTestObservation(value: unknown): Record<string, unknown> | null {
  const test = optionalRecord(value);
  return test === null
    ? null
    : {
        durationMs: test.durationMs,
        exitCode: test.exitCode,
        kind: test.kind,
        status: test.status,
        stderrSha256: sha256(String(test.stderr ?? "")),
        stdoutSha256: sha256(String(test.stdout ?? "")),
      };
}

function verifyProjectedStageEvidence(
  evidence: Record<string, unknown>,
  result: Omit<C4BaselineStageResult, "stageEvidenceSha256">,
  report: C4BaselineCeilingReport,
  path: string,
  frozen: C4BaselineFrozenStageBinding,
): void {
  const dataset = optionalRecord(evidence.dataset);
  if (
    dataset === null ||
    dataset.episodeId !== result.episodeId ||
    dataset.stageId !== result.stageId ||
    dataset.stageInputSha256 !== result.stageInputSha256
  ) {
    throw new Error(`C4 baseline stage dataset binding mismatch for ${path}`);
  }
  const codex = optionalRecord(evidence.codex);
  const evaluator = optionalRecord(evidence.evaluator);
  const patch = optionalRecord(evidence.patch);
  if (
    codex !== null &&
    (codex.status !== result.codexStatus ||
      !validCodexFailureEventsProjection(codex))
  ) {
    throw new Error(`C4 baseline Codex observation mismatch for ${path}`);
  }
  if (evaluator !== null) {
    const failToPass = optionalRecord(evaluator.failToPass);
    const passToPass = optionalRecord(evaluator.passToPass);
    if (
      failToPass?.status !== result.failToPassStatus ||
      passToPass?.status !== result.passToPassStatus
    ) {
      throw new Error(`C4 baseline evaluator observation mismatch for ${path}`);
    }
  }
  if (patch !== null) {
    const diff = patch.diff;
    const patchSha256 = typeof diff === "string" && diff.length > 0
      ? sha256(diff)
      : null;
    if (
      canonicalJson(patch.changedFiles) !== canonicalJson(result.changedFiles) ||
      patch.sha256 !== result.patchSha256 ||
      patchSha256 !== result.patchSha256
    ) {
      throw new Error(`C4 baseline patch observation mismatch for ${path}`);
    }
  }
  const failure = optionalRecord(evidence.failure);
  if (
    failure !== null &&
    failure.failureStage !== result.executionFailureStage
  ) {
    throw new Error(`C4 baseline failure observation mismatch for ${path}`);
  }
  if (
    result.disposition === "finalized" &&
    !isValidFinalizedEvidence({
      arm: optionalRecord(evidence.arm),
      codex,
      dataset,
      evaluator,
      failure,
      frozen,
      patch,
      report,
      result,
      visibleBaseHealth: optionalRecord(evidence.visibleBaseHealth),
    })
  ) {
    throw new Error(
      `C4 baseline finalized evidence is semantically invalid for ${path}`,
    );
  }
}

function isValidFinalizedEvidence(input: {
  arm: Record<string, unknown> | null;
  codex: Record<string, unknown> | null;
  dataset: Record<string, unknown>;
  evaluator: Record<string, unknown> | null;
  failure: Record<string, unknown> | null;
  frozen: C4BaselineFrozenStageBinding;
  patch: Record<string, unknown> | null;
  report: C4BaselineCeilingReport;
  result: Omit<C4BaselineStageResult, "stageEvidenceSha256">;
  visibleBaseHealth: Record<string, unknown> | null;
}): boolean {
  const {
    arm,
    codex,
    dataset,
    evaluator,
    failure,
    patch,
    report,
    result,
    visibleBaseHealth,
  } = input;
  if (
    arm === null ||
    codex === null ||
    evaluator === null ||
    patch === null ||
    visibleBaseHealth === null ||
    failure !== null ||
    arm.absenceAuditPassed !== true ||
    arm.permissionIsolationPassed !== true ||
    arm.networkAccess !== false ||
    arm.codexExecutableSha256 !== report.codexExecutableSha256 ||
    arm.codexVersion !== report.codexVersion ||
    !isSha256(arm.absenceAuditSha256) ||
    !isSha256(arm.instructionSha256) ||
    !isSha256(arm.permissionIsolationEvidenceSha256) ||
    result.executionFailureStage !== null ||
    !validDatasetProjection(dataset, result, input.frozen) ||
    !validCodexProjection(codex, result) ||
    !validEvaluatorProjection(evaluator, result, input.frozen) ||
    !validBaseHealthProjection(visibleBaseHealth)
  ) {
    return false;
  }
  const changedFiles = stringArray(patch.changedFiles);
  const forbiddenFiles = stringArray(patch.forbiddenFiles);
  const untrackedFiles = untrackedFilePaths(patch.untrackedFiles);
  const diff = patch.diff;
  const hasPatch = patch.hasPatch;
  const patchSha256 = typeof diff === "string" && diff.length > 0
    ? sha256(diff)
    : null;
  if (
    changedFiles === null ||
    forbiddenFiles === null ||
    untrackedFiles === null ||
    typeof hasPatch !== "boolean" ||
    patch.baseCommit !== dataset.snapshot ||
    patch.sha256 !== result.patchSha256 ||
    patchSha256 !== result.patchSha256 ||
    hasPatch !== (result.patchSha256 !== null) ||
    canonicalJson(changedFiles) !== canonicalJson(result.changedFiles) ||
    [...forbiddenFiles, ...untrackedFiles].some((file) =>
      !changedFiles.includes(file)
    )
  ) {
    return false;
  }
  const expectedReasons = taskFailureReasons({
    codexStatus: result.codexStatus,
    failToPassStatus: result.failToPassStatus,
    forbiddenFiles,
    hasPatch,
    passToPassStatus: result.passToPassStatus,
  });
  return canonicalJson(result.taskFailureReasons) ===
      canonicalJson(expectedReasons) &&
    result.resolved === (expectedReasons.length === 0);
}

function validDatasetProjection(
  dataset: Record<string, unknown>,
  result: Omit<C4BaselineStageResult, "stageEvidenceSha256">,
  frozen: C4BaselineFrozenStageBinding,
): boolean {
  return dataset.episodeId === result.episodeId &&
    dataset.stageId === result.stageId &&
    dataset.stageInputSha256 === result.stageInputSha256 &&
    frozen.episodeId === result.episodeId &&
    frozen.stageId === result.stageId &&
    dataset.promptSha256 === frozen.promptSha256 &&
    dataset.repositoryCommit === frozen.repositoryCommit &&
    dataset.repositoryTree === frozen.repositoryTree &&
    dataset.snapshot === dataset.repositoryCommit;
}

function validCodexProjection(
  codex: Record<string, unknown>,
  result: Omit<C4BaselineStageResult, "stageEvidenceSha256">,
): boolean {
  if (
    codex.status !== result.codexStatus ||
    !nonnegativeNumber(codex.durationMs) ||
    !nonnegativeInteger(codex.eventCount) ||
    !nonnegativeInteger(codex.failureEventCount) ||
    !isSha256(codex.failureEventsSha256) ||
    !isSha256(codex.stderrSha256)
  ) {
    return false;
  }
  if (result.codexStatus === "completed") {
    return codex.exitCode === 0 &&
      codex.failureEventCount === 0 &&
      codex.timedOut === false &&
      typeof result.threadId === "string" &&
      result.threadId.length > 0;
  }
  return result.codexStatus === "timed-out" &&
    codex.exitCode === null &&
    codex.timedOut === true;
}

function validCodexFailureEventsProjection(
  codex: Record<string, unknown>,
): boolean {
  if (
    !nonnegativeInteger(codex.failureEventCount) ||
    !isSha256(codex.failureEventsSha256)
  ) {
    return false;
  }
  return codex.failureEventCount !== 0 ||
    codex.failureEventsSha256 === sha256("[]");
}

function validEvaluatorProjection(
  evaluator: Record<string, unknown>,
  result: Omit<C4BaselineStageResult, "stageEvidenceSha256">,
  frozen: C4BaselineFrozenStageBinding,
): boolean {
  const commitments = evaluator.commitments;
  const failToPass = optionalRecord(evaluator.failToPass);
  const passToPass = optionalRecord(evaluator.passToPass);
  const sandbox = optionalRecord(evaluator.sandbox);
  return Array.isArray(commitments) &&
    commitments.length === 2 &&
    canonicalJson(commitments) === canonicalJson(frozen.evaluatorCommitments) &&
    new Set(commitments.map((commitment) => {
      const record = optionalRecord(commitment);
      return record !== null && isSha256(record.sha256)
        ? record.relativePath
        : null;
    })).size === 2 &&
    commitments.every((commitment) => {
      const record = optionalRecord(commitment);
      return record !== null &&
        (record.relativePath === "cases.json" ||
          record.relativePath === "runner.ts") &&
        isSha256(record.sha256);
    }) &&
    evaluator.credentialsRemovedBeforeMaterialization === true &&
    evaluator.materializedAfterCodexExit === true &&
    sandbox !== null &&
    evaluator.sandboxEvidenceSha256 === sha256(canonicalJson(sandbox)) &&
    isSha256(sandbox.configSha256) &&
    sandbox.configWriteDenied === true &&
    sandbox.copiedAuthRemovedBeforeEvaluator === true &&
    sandbox.evaluatorRead === true &&
    sandbox.evaluatorWriteDenied === true &&
    sandbox.networkAccess === false &&
    sandbox.networkDenied === true &&
    sandbox.networkPositiveControl === true &&
    sandbox.originalAuthAliasDenied === true &&
    sandbox.originalAuthDenied === true &&
    sandbox.profileName === "c4-evaluator" &&
    sandbox.schemaVersion === 1 &&
    sandbox.workspaceRead === true &&
    sandbox.workspaceWrite === true &&
    validTestProjection(failToPass, "fail-to-pass", result.failToPassStatus) &&
    validTestProjection(passToPass, "pass-to-pass", result.passToPassStatus);
}

function validTestProjection(
  test: Record<string, unknown> | null,
  kind: "fail-to-pass" | "pass-to-pass",
  status: string,
): boolean {
  if (
    test === null ||
    test.kind !== kind ||
    test.status !== status ||
    !nonnegativeNumber(test.durationMs) ||
    !isSha256(test.stderrSha256) ||
    !isSha256(test.stdoutSha256)
  ) {
    return false;
  }
  return status === "passed"
    ? test.exitCode === 0
    : status === "failed"
    ? test.exitCode === 1
    : status === "timed-out" && test.exitCode === null;
}

function validBaseHealthProjection(
  baseHealth: Record<string, unknown>,
): boolean {
  return baseHealth.status === "passed" &&
    baseHealth.passed === true &&
    baseHealth.exitCode === 0 &&
    nonnegativeNumber(baseHealth.durationMs) &&
    isSha256(baseHealth.stderrSha256) &&
    isSha256(baseHealth.stdoutSha256);
}

function taskFailureReasons(input: {
  codexStatus: string;
  failToPassStatus: string;
  forbiddenFiles: readonly string[];
  hasPatch: boolean;
  passToPassStatus: string;
}): string[] {
  if (input.codexStatus === "timed-out") {
    return ["codex-timeout"];
  }
  const reasons: string[] = [];
  if (!input.hasPatch) {
    reasons.push("no-patch");
  }
  if (input.forbiddenFiles.length > 0) {
    reasons.push("forbidden-file-change");
  }
  if (
    input.failToPassStatus === "timed-out" ||
    input.passToPassStatus === "timed-out"
  ) {
    reasons.push("hidden-test-timeout");
  }
  if (input.failToPassStatus === "failed") {
    reasons.push("hidden-fail-to-pass-failed");
  }
  if (input.passToPassStatus === "failed") {
    reasons.push("pass-to-pass-regression");
  }
  return reasons;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) =>
      typeof item === "string" && item.length > 0
    )
    ? value
    : null;
}

function untrackedFilePaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const paths: string[] = [];
  for (const item of value) {
    const record = optionalRecord(item);
    if (
      record === null ||
      typeof record.path !== "string" ||
      record.path.length === 0 ||
      !isSha256(record.sha256) ||
      !nonnegativeInteger(record.size)
    ) {
      return null;
    }
    paths.push(record.path);
  }
  return paths;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isGitObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]));
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
