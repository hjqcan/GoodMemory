import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type {
  C4HiddenArtifact,
  C4LeakageSurface,
} from "./c4-leakage";
import type {
  C5LiveLeakageAudit,
} from "./c5-live-leakage";
import {
  auditC5LiveLeakageSurfaces,
  C5_LIVE_LEAKAGE_SURFACE_IDS,
} from "./c5-live-leakage";
import {
  buildC5StageLeakageInput,
} from "./c5-leakage-input";
import {
  EMPTY_FROZEN_PREHISTORY_SHA256,
} from "./frozen-prehistory";
import type {
  CodexCodingEffectDatasetV3,
} from "./dataset";

type C6Episode = CodexCodingEffectDatasetV3["episodes"][number];
type C6Stage = C6Episode["stages"][number];
type C5StageLeakageInput = Awaited<
  ReturnType<typeof buildC5StageLeakageInput>
>;

interface C6DeclaredForbiddenArtifact {
  content: string;
  fragments: string[];
  path: string;
  sha256: string;
}

interface C6FutureVisibleClosure {
  fragments: string[];
  futureHistorySuffixRecordCount: number;
  futureTargetPromptCount: number;
  sha256: string;
}

interface C6HistoryRecord {
  fragments: string[];
  raw: string;
}

interface C6StageAuditSource {
  history: C6HistoryRecord[];
  leakageInput: C5StageLeakageInput;
  prompt: string;
  stage: C6Stage;
}

interface C6PreparedStage {
  artifacts: C4HiddenArtifact[];
  futureVisibleClosure: C6FutureVisibleClosure;
  leakageInput: C5StageLeakageInput;
  stage: C6Stage;
}

export interface C6CandidateStaticLeakageAudit {
  assetRootSha256: string;
  auditSha256: string;
  datasetId: string;
  datasetInputSha256: string;
  datasetManifestSha256: string;
  episodeCount: number;
  schemaVersion: 2;
  stageAudits: C6StageLeakageAudit[];
  stageCount: number;
  status: "accepted";
  summaryPromptSha256: string;
  variant: "candidate-static";
}

export interface C6FlatSummaryOutputLeakageAudit {
  assetRootSha256: string;
  auditSha256: string;
  datasetId: string;
  datasetInputSha256: string;
  datasetManifestSha256: string;
  episodeId: string;
  episodeInputSha256: string;
  historySourceSha256: string;
  outputSha256: string;
  schemaVersion: 2;
  stageAudit: C6StageLeakageAudit;
  stageId: string;
  status: "accepted";
  summaryPromptSha256: string;
  variant: "flat-summary-output";
}

export interface C6StageLeakageAudit {
  episodeId: string;
  episodeInputSha256: string;
  futureHistorySuffixRecordCount: number;
  futureTargetPromptCount: number;
  futureVisibleClosureSha256: string;
  historySourceSha256: string;
  matrixAuditReceipt: C5LiveLeakageAudit;
  stageId: string;
  stageInputSha256: string;
  stagePosition: number;
  status: "accepted";
}

export interface C6LeakageContext {
  assetRootSha256: string;
  dataset: CodexCodingEffectDatasetV3;
  datasetManifestSha256: string;
  datasetRoot: string;
  summaryPrompt: string;
  summaryPromptSha256: string;
}

export async function auditC6CandidateStaticLeakage(
  input: C6LeakageContext,
): Promise<C6CandidateStaticLeakageAudit> {
  validateContext(input);
  const declaredArtifacts = await loadDeclaredForbiddenArtifacts(
    input.datasetRoot,
    input.dataset.episodes,
  );
  const stageAudits: C6StageLeakageAudit[] = [];
  for (const episode of input.dataset.episodes) {
    const prepared = await prepareEpisodeAudit({
      context: input,
      declaredArtifacts,
      episode,
    });
    stageAudits.push(...prepared.stages.map((preparedStage) =>
      auditStage({
        artifacts: preparedStage.artifacts,
        context: input,
        episode,
        futureVisibleClosure: preparedStage.futureVisibleClosure,
        leakageInput: preparedStage.leakageInput,
        liveSurfaces: emptyLiveSurfaces(),
        rejectionLabel: "C6 candidate static leakage rejected",
        stage: preparedStage.stage,
      })
    ));
  }
  const basis = {
    assetRootSha256: input.assetRootSha256,
    datasetId: input.dataset.datasetId,
    datasetInputSha256: sha256(JSON.stringify(input.dataset)),
    datasetManifestSha256: input.datasetManifestSha256,
    episodeCount: input.dataset.episodes.length,
    schemaVersion: 2,
    stageAudits,
    stageCount: stageAudits.length,
    status: "accepted",
    summaryPromptSha256: input.summaryPromptSha256,
    variant: "candidate-static",
  } as const;
  return {
    ...basis,
    auditSha256: sha256(JSON.stringify(basis)),
  };
}

export async function auditC6FlatSummaryOutputLeakage(
  input: C6LeakageContext & {
    episodeId: string;
    output: string;
    stageId: string;
  },
): Promise<C6FlatSummaryOutputLeakageAudit> {
  validateContext(input);
  if (
    typeof input.stageId !== "string" ||
    input.stageId.length === 0 ||
    input.stageId.trim() !== input.stageId
  ) {
    throw new Error("C6 flat-summary leakage audit requires a stageId");
  }
  const episode = input.dataset.episodes.find((candidate) =>
    candidate.id === input.episodeId
  );
  if (episode === undefined) {
    throw new Error(`C6 leakage dataset has no episode ${input.episodeId}`);
  }
  const stage = episode.stages.find((candidate) =>
    candidate.id === input.stageId
  );
  if (stage === undefined) {
    throw new Error(
      `C6 leakage episode ${episode.id} has no stage ${input.stageId}`,
    );
  }
  if (stage.history.sha256 === EMPTY_FROZEN_PREHISTORY_SHA256) {
    throw new Error(
      "C6 no-history control forbids flat-summary provider output",
    );
  }
  const declaredArtifacts = await loadDeclaredForbiddenArtifacts(
    input.datasetRoot,
    [episode],
  );
  const prepared = await prepareEpisodeAudit({
    context: input,
    declaredArtifacts,
    episode,
  });
  const preparedStage = prepared.stages.find((candidate) =>
    candidate.stage.id === stage.id
  )!;
  const stageAudit = auditStage({
    artifacts: preparedStage.artifacts,
    context: input,
    episode,
    futureVisibleClosure: preparedStage.futureVisibleClosure,
    leakageInput: preparedStage.leakageInput,
    liveSurfaces: flatSummaryLiveSurfaces(input.output),
    rejectionLabel: "C6 flat-summary output leakage rejected",
    stage,
  });
  const basis = {
    assetRootSha256: input.assetRootSha256,
    datasetId: input.dataset.datasetId,
    datasetInputSha256: sha256(JSON.stringify(input.dataset)),
    datasetManifestSha256: input.datasetManifestSha256,
    episodeId: episode.id,
    episodeInputSha256: sha256(JSON.stringify(episode)),
    historySourceSha256: stage.history.sha256,
    outputSha256: sha256(input.output),
    schemaVersion: 2,
    stageAudit,
    stageId: stage.id,
    status: "accepted",
    summaryPromptSha256: input.summaryPromptSha256,
    variant: "flat-summary-output",
  } as const;
  return {
    ...basis,
    auditSha256: sha256(JSON.stringify(basis)),
  };
}

async function prepareEpisodeAudit(input: {
  context: C6LeakageContext;
  declaredArtifacts: ReadonlyMap<string, C6DeclaredForbiddenArtifact>;
  episode: C6Episode;
}): Promise<{
  stages: C6PreparedStage[];
}> {
  const repositoryAssetPath = input.episode.repository.assetPath;
  if (repositoryAssetPath === undefined) {
    throw new Error(
      `C6 leakage episode ${input.episode.id} requires repository.assetPath`,
    );
  }
  const stages = await Promise.all(input.episode.stages.map(async (stage) => {
    const view = c5StageView(input.episode, stage);
    return {
      leakageInput: await buildC5StageLeakageInput({
        allowEmptyPrehistory: input.episode.strata.includes(
          "no-history-negative-control",
        ),
        datasetRoot: resolve(input.context.datasetRoot),
        episode: view.episode,
        repositoryRoot: resolve(
          input.context.datasetRoot,
          repositoryAssetPath,
        ),
        stage: view.stage,
      }),
      stage,
    };
  }));
  const declared = declaredForbiddenArtifactsForEpisode(
    input.episode,
    input.declaredArtifacts,
  );
  const standardPaths = episodeStandardEvaluatorPaths(input.episode);
  const baseArtifacts = includeDeclaredForbiddenStrings(
    includeExtraDeclaredArtifacts(
      mergeEpisodeArtifacts(stages.flatMap((stage) =>
        stage.leakageInput.artifacts
      )),
      declared.filter((artifact) => !standardPaths.has(artifact.path)),
    ),
    input.episode.forbiddenLeakage.strings,
  );
  const stageSources = stages.map(
    ({ leakageInput, stage }): C6StageAuditSource => ({
      history: historyRecords(leakageInput, input.episode.id, stage.id),
      leakageInput,
      prompt: stageSurface(leakageInput, "stage-prompts").content,
      stage,
    }),
  );
  return {
    stages: stageSources.map((current): C6PreparedStage => {
      const futureVisibleClosure = buildFutureVisibleClosure(
        current,
        stageSources.filter((candidate) =>
          candidate.stage.position > current.stage.position
        ),
      );
      return {
        artifacts: includeFutureVisibleClosure(
          baseArtifacts,
          futureVisibleClosure,
        ),
        futureVisibleClosure,
        leakageInput: current.leakageInput,
        stage: current.stage,
      };
    }),
  };
}

function auditStage(input: {
  artifacts: readonly C4HiddenArtifact[];
  context: C6LeakageContext;
  episode: C6Episode;
  futureVisibleClosure: C6FutureVisibleClosure;
  leakageInput: C5StageLeakageInput;
  liveSurfaces: C4LeakageSurface[];
  rejectionLabel: string;
  stage: C6Stage;
}): C6StageLeakageAudit {
  const staticSurfaces = mergeSummaryPrompt(
    input.leakageInput.staticSurfaces,
    input.context.summaryPrompt,
  );
  const matrixAuditReceipt = auditC5LiveLeakageSurfaces({
    artifacts: input.artifacts,
    liveSurfaces: input.liveSurfaces,
    staticSurfaces,
    trajectoryOrigins: [],
  });
  assertZeroOverlap(
    matrixAuditReceipt,
    `${input.rejectionLabel} for ${input.episode.id}/${input.stage.id}`,
  );
  return {
    episodeId: input.episode.id,
    episodeInputSha256: sha256(JSON.stringify(input.episode)),
    futureHistorySuffixRecordCount:
      input.futureVisibleClosure.futureHistorySuffixRecordCount,
    futureTargetPromptCount:
      input.futureVisibleClosure.futureTargetPromptCount,
    futureVisibleClosureSha256: input.futureVisibleClosure.sha256,
    historySourceSha256: input.stage.history.sha256,
    matrixAuditReceipt,
    stageId: input.stage.id,
    stageInputSha256: sha256(JSON.stringify(input.stage)),
    stagePosition: input.stage.position,
    status: "accepted",
  };
}

function c5StageView(
  episode: C6Episode,
  stage: C6Stage,
): Pick<
  Parameters<typeof buildC5StageLeakageInput>[0],
  "episode" | "stage"
> {
  const {
    history,
    ...stageView
  } = stage;
  const {
    historyPolicy: _historyPolicy,
    stages: _stages,
    ...episodeView
  } = episode;
  return {
    episode: {
      ...episodeView,
      prehistory: history,
      stages: [stageView],
    },
    stage: stageView,
  };
}

function buildFutureVisibleClosure(
  current: C6StageAuditSource,
  future: readonly C6StageAuditSource[],
): C6FutureVisibleClosure {
  const nonHistorySurfaces = current.leakageInput.staticSurfaces
    .filter((surface) => surface.id !== "frozen-prehistory")
    .flatMap(surfaceTexts);
  const nonTargetSurfaces = current.leakageInput.staticSurfaces
    .filter((surface) =>
      surface.id !== "frozen-prehistory" &&
      surface.id !== "stage-prompts"
    )
    .flatMap(surfaceTexts);
  const currentSurfaces = current.leakageInput.staticSurfaces
    .flatMap(surfaceTexts);
  const fragments: string[] = [];
  const futureHistorySuffixes = future.map((candidate) => {
    const suffix = exactHistorySuffix(current, candidate);
    for (const record of suffix) {
      fragments.push(...record.fragments.filter((fragment) =>
        !appearsInSurfaces(currentSurfaces, fragment)
      ));
    }
    return {
      recordSha256: suffix.map((record) => sha256(record.raw)),
      stageId: candidate.stage.id,
    };
  });
  const futureTargetPrompts = future.map((candidate) => {
    const prompt = candidate.prompt.trim();
    if (!appearsInSurfaces(nonTargetSurfaces, prompt)) {
      fragments.push(prompt);
    }
    for (const fragment of semanticPromptFragments(prompt)) {
      if (!appearsInSurfaces(nonHistorySurfaces, fragment)) {
        fragments.push(fragment);
      }
    }
    return {
      promptPath: candidate.stage.promptPath,
      promptSha256: sha256(candidate.prompt),
      stageId: candidate.stage.id,
    };
  });
  const uniqueFragments = uniqueStrings(fragments.filter((fragment) =>
    fragment.length > 0
  ));
  const fragmentSha256 = uniqueFragments.map(sha256);
  const futureHistorySuffixRecordCount = new Set(
    futureHistorySuffixes.flatMap((suffix) => suffix.recordSha256),
  ).size;
  const basis = {
    currentStageId: current.stage.id,
    fragmentSha256,
    futureHistorySuffixes,
    futureTargetPrompts,
    schemaVersion: 1,
  } as const;
  return {
    fragments: uniqueFragments,
    futureHistorySuffixRecordCount,
    futureTargetPromptCount: futureTargetPrompts.length,
    sha256: sha256(JSON.stringify(basis)),
  };
}

function exactHistorySuffix(
  current: C6StageAuditSource,
  future: C6StageAuditSource,
): C6HistoryRecord[] {
  if (
    current.history.length > future.history.length ||
    current.history.some((record, index) =>
      record.raw !== future.history[index]?.raw
    )
  ) {
    throw new Error(
      `C6 stage history ${current.stage.id} is not an exact record prefix of ${future.stage.id}`,
    );
  }
  return future.history.slice(current.history.length);
}

function historyRecords(
  leakageInput: C5StageLeakageInput,
  episodeId: string,
  stageId: string,
): C6HistoryRecord[] {
  const source = stageSurface(leakageInput, "frozen-prehistory").content;
  return source.split("\n")
    .filter((line) => line.length > 0)
    .map((raw, index) => {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(
          `C6 stage history ${episodeId}/${stageId} record ${index + 1} is not JSON`,
        );
      }
      if (!hasRecordTextBlocks(value)) {
        throw new Error(
          `C6 stage history ${episodeId}/${stageId} record ${index + 1} is not a message record`,
        );
      }
      return {
        fragments: uniqueStrings([
          raw,
          ...value.payload.content.map((block) => block.text),
        ]),
        raw,
      };
    });
}

function hasRecordTextBlocks(value: unknown): value is {
  payload: { content: Array<{ text: string }> };
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = (value as Record<PropertyKey, unknown>).payload;
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const content = (payload as Record<PropertyKey, unknown>).content;
  return Array.isArray(content) && content.length > 0 &&
    content.every((block) =>
      typeof block === "object" &&
      block !== null &&
      typeof (block as Record<PropertyKey, unknown>).text === "string"
    );
}

function stageSurface(
  leakageInput: C5StageLeakageInput,
  id: "frozen-prehistory" | "stage-prompts",
): C4LeakageSurface {
  const surface = leakageInput.staticSurfaces.find((candidate) =>
    candidate.id === id
  );
  if (surface === undefined) {
    throw new Error(`C6 stage leakage input is missing ${id}`);
  }
  return surface;
}

function surfaceTexts(surface: C4LeakageSurface): string[] {
  return uniqueStrings([
    surface.content,
    ...(surface.fragmentContents ?? []),
    ...(surface.hiddenValueContents ?? []),
    ...(surface.hiddenValueContent === undefined
      ? []
      : [surface.hiddenValueContent]),
  ]);
}

function semanticPromptFragments(prompt: string): string[] {
  return uniqueStrings(prompt.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      line.length >= 8 && /[\p{L}\p{N}_]/u.test(line)
    ));
}

function appearsInSurfaces(
  surfaces: readonly string[],
  fragment: string,
): boolean {
  const normalizedFragment = normalizeLeakageText(fragment);
  return normalizedFragment.length > 0 && surfaces.some((surface) =>
    normalizeLeakageText(surface).includes(normalizedFragment)
  );
}

function normalizeLeakageText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(
    /\s+/gu,
    " ",
  ).trim();
}

function includeFutureVisibleClosure(
  artifacts: readonly C4HiddenArtifact[],
  closure: C6FutureVisibleClosure,
): C4HiddenArtifact[] {
  return artifacts.map((artifact) =>
    artifact.id === "hidden-test-source"
      ? {
          ...artifact,
          content: [
            artifact.content,
            JSON.stringify({
              c6FutureVisibleClosureSha256: closure.sha256,
            }),
          ].join("\n"),
          fragments: uniqueStrings([
            ...artifact.fragments,
            ...closure.fragments,
          ]),
        }
      : artifact
  );
}

function declaredForbiddenArtifactsForEpisode(
  episode: C6Episode,
  declaredArtifacts: ReadonlyMap<string, C6DeclaredForbiddenArtifact>,
): C6DeclaredForbiddenArtifact[] {
  const hashes = new Set([
    ...episode.forbiddenLeakage.fileSha256,
    ...episode.stages.flatMap((stage) =>
      stage.history.forbiddenLeakageSha256
    ),
  ]);
  return [...hashes].sort().map((hash) => {
    const artifact = declaredArtifacts.get(hash);
    if (artifact === undefined) {
      throw new Error(
        `C6 declared forbidden artifact ${hash} was not resolved`,
      );
    }
    return artifact;
  });
}

function episodeStandardEvaluatorPaths(
  episode: C6Episode,
): Set<string> {
  return new Set([
    "evaluator/cases.json",
    "evaluator/runner.ts",
    ...episode.stages.map((stage) => stage.goldPatch.path),
  ]);
}

function mergeEpisodeArtifacts(
  artifacts: readonly C4HiddenArtifact[],
): C4HiddenArtifact[] {
  return ([
    "expected-changed-files",
    "gold-patches",
    "hidden-test-source",
  ] as const).map((id) => {
    const matching = artifacts.filter((artifact) => artifact.id === id);
    return {
      allowedPublicFragments: uniqueStrings(matching.flatMap((artifact) =>
        artifact.allowedPublicFragments ?? []
      )),
      content: matching.map((artifact) => artifact.content).join("\n"),
      fragments: uniqueStrings(matching.flatMap((artifact) =>
        artifact.fragments
      )),
      hiddenValueRelations: uniqueJson(matching.flatMap((artifact) =>
        artifact.hiddenValueRelations ?? []
      )),
      hiddenValues: uniqueJson(matching.flatMap((artifact) =>
        artifact.hiddenValues ?? []
      )),
      id,
    };
  });
}

function includeExtraDeclaredArtifacts(
  artifacts: readonly C4HiddenArtifact[],
  declared: readonly C6DeclaredForbiddenArtifact[],
): C4HiddenArtifact[] {
  if (declared.length === 0) {
    return [...artifacts];
  }
  return artifacts.map((artifact) =>
    artifact.id === "hidden-test-source"
      ? {
          ...artifact,
          content: [
            artifact.content,
            ...declared.map((candidate) =>
              `${candidate.path}\n${candidate.content}`
            ),
          ].join("\n"),
          fragments: uniqueStrings([
            ...artifact.fragments,
            ...declared.flatMap((candidate) => [
              candidate.content,
              ...candidate.fragments,
            ]),
          ]),
        }
      : artifact
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueJson<T>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [
    JSON.stringify(value),
    value,
  ])).entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, value]) => value);
}

function includeDeclaredForbiddenStrings(
  artifacts: readonly C4HiddenArtifact[],
  values: readonly string[],
): C4HiddenArtifact[] {
  const forbidden = [...new Set(values)].sort();
  if (forbidden.length === 0) {
    return [...artifacts];
  }
  return artifacts.map((artifact) =>
    artifact.id === "hidden-test-source"
      ? {
          ...artifact,
          content: [
            artifact.content,
            JSON.stringify({ c6DeclaredForbiddenStrings: forbidden }),
          ].join("\n"),
          fragments: [...new Set([
            ...artifact.fragments,
            ...forbidden,
          ])],
        }
      : artifact
  );
}

async function loadDeclaredForbiddenArtifacts(
  datasetRoot: string,
  episodes: readonly C6Episode[],
): Promise<Map<string, C6DeclaredForbiddenArtifact>> {
  const requiredHashes = new Set(episodes.flatMap((episode) => [
    ...episode.forbiddenLeakage.fileSha256,
    ...episode.stages.flatMap((stage) =>
      stage.history.forbiddenLeakageSha256
    ),
  ]));
  const evaluatorRoot = resolve(datasetRoot, "evaluator");
  const candidates = await collectEvaluatorFiles(evaluatorRoot);
  const byHash = new Map<string, C6DeclaredForbiddenArtifact[]>();
  for (const candidate of candidates) {
    const matches = byHash.get(candidate.sha256) ?? [];
    matches.push(candidate);
    byHash.set(candidate.sha256, matches);
  }
  const resolved = new Map<string, C6DeclaredForbiddenArtifact>();
  for (const hash of requiredHashes) {
    const matches = byHash.get(hash) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `C6 declared forbidden artifact ${hash} must resolve to exactly one evaluator file`,
      );
    }
    resolved.set(hash, matches[0]!);
  }
  return resolved;
}

async function collectEvaluatorFiles(
  root: string,
  directory = root,
): Promise<C6DeclaredForbiddenArtifact[]> {
  const files: C6DeclaredForbiddenArtifact[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("C6 evaluator leakage closure rejects symlinks");
    }
    if (entry.isDirectory()) {
      files.push(...await collectEvaluatorFiles(root, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("C6 evaluator leakage closure rejects non-files");
    }
    const stat = await lstat(path);
    if (!stat.isFile()) {
      throw new Error("C6 evaluator leakage closure requires regular files");
    }
    const bytes = await readFile(path);
    const content = bytes.toString("utf8");
    files.push({
      content,
      fragments: semanticForbiddenFileFragments(content),
      path: `evaluator/${
        relative(root, path).split(sep).join("/")
      }`,
      sha256: sha256Bytes(bytes),
    });
  }
  return files.sort((first, second) => first.path.localeCompare(second.path));
}

function semanticForbiddenFileFragments(content: string): string[] {
  return [...new Set(content.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      line.length >= 8 && /[\p{L}\p{N}_]/u.test(line)
    ))];
}

function mergeSummaryPrompt(
  surfaces: readonly C4LeakageSurface[],
  summaryPrompt: string,
): C4LeakageSurface[] {
  return surfaces.map((surface) => {
    if (surface.id === "frozen-prehistory") {
      return {
        ...surface,
        fragmentContents: [
          ...(surface.fragmentContents ?? [surface.content]),
          ...(surface.hiddenValueContents ?? (
            surface.hiddenValueContent === undefined
              ? []
              : [surface.hiddenValueContent]
          )),
        ],
      };
    }
    if (surface.id !== "stage-prompts") {
      return surface;
    }
    return {
      content: JSON.stringify({
        flatSummaryPrompt: summaryPrompt,
        stagePrompt: surface.content,
      }),
      fragmentContents: [
        ...(surface.fragmentContents ?? [surface.content]),
        summaryPrompt,
      ],
      hiddenValueContents: [
        ...(surface.hiddenValueContents ?? [
          surface.hiddenValueContent ?? surface.content,
        ]),
        summaryPrompt,
      ],
      id: surface.id,
    };
  });
}

function emptyLiveSurfaces(): C4LeakageSurface[] {
  return C5_LIVE_LEAKAGE_SURFACE_IDS.map((id) => ({ content: "", id }));
}

function flatSummaryLiveSurfaces(output: string): C4LeakageSurface[] {
  return C5_LIVE_LEAKAGE_SURFACE_IDS.map((id) => ({
    content: id === "flat-summary-after-seeding" ? output : "",
    id,
  }));
}

function assertZeroOverlap(
  audit: C5LiveLeakageAudit,
  label: string,
): void {
  if (
    audit.status === "accepted" &&
    audit.fullMatrixAuditReceipt.status === "accepted" &&
    audit.fullMatrixAuditReceipt.overlapCount === 0 &&
    audit.liveOverlapCount === 0 &&
    audit.staticOverlapCount === 0 &&
    audit.trajectoryOriginOverlapCount === 0 &&
    audit.unexplainedLiveOverlapCount === 0
  ) {
    return;
  }
  const first = audit.fullMatrixAuditReceipt.cells.find((cell) =>
    cell.status === "rejected"
  );
  throw new Error(
    first === undefined
      ? label
      : `${label} at ${first.surfaceId}/${first.artifactId}`,
  );
}

function validateContext(input: C6LeakageContext): void {
  for (const value of [
    input.assetRootSha256,
    input.datasetManifestSha256,
    input.summaryPromptSha256,
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error("C6 leakage bindings must be SHA-256 digests");
    }
  }
  if (input.dataset.schemaVersion !== 3) {
    throw new Error("C6 leakage audit requires dataset schema version 3");
  }
  if (
    input.summaryPrompt.length === 0 ||
    input.summaryPromptSha256 !== sha256(input.summaryPrompt)
  ) {
    throw new Error("C6 leakage summary prompt does not match its binding");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
