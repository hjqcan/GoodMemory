import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import type { C6AssetLock } from "./c6-asset-lock";
import type {
  C6RealHistoryTransitionQualification,
} from "./c6-real-history-transition-qualification";
import {
  validateC6RealHistorySemanticScreening,
} from "./c6-real-history-semantic-screening";
import type {
  C6ReviewTrajectoryDiscovery,
} from "./c6-review-trajectory-discovery";

const EXPECTED_ASSET_LOCK_SHA256 =
  "a9455232d26beeec738f647969506e248542dde4a6cb8d7405d270287aedeff0";
const IMAGE =
  "mswebench/fmtlib_m_fmt@sha256:52ce9e68edb03274b4305717e4d0b6a18c778ff784c8cb3c9e3ff4ef3b24d7f8";
const EXPECTED_STAGE_SNAPSHOTS = [
  {
    after: {
      alias: "stage1",
      commitSha: "4ffb4992a35a9f95bf60bad14cf0dfbb6d32ec50",
      treeSha: "1e647c8227baeae5ad4728748e88853e68f82fd4",
    },
    before: {
      alias: "stage1before-24594",
      commitSha: "24594c747e7d516baa6dac0113e81f3bfd1970b6",
      treeSha: "3acb21dbd7816f7326e4e7832bf1eb04a6b79a84",
    },
  },
  {
    after: {
      alias: "stage2",
      commitSha: "e636236a31b8a4f3139a8efdf9b166d58a9c46b2",
      treeSha: "35ac8faef208e08c41c4f10bb09d29e402c652c3",
    },
    before: {
      alias: "stage1",
      commitSha: "4ffb4992a35a9f95bf60bad14cf0dfbb6d32ec50",
      treeSha: "1e647c8227baeae5ad4728748e88853e68f82fd4",
    },
  },
  {
    after: {
      alias: "stage3after",
      commitSha: "2efaf142e2d4b7690edf0ea00ecc692e7da1e267",
      treeSha: "4500cbfa09e9e066e1ea7614d2bf7d1232d2a4e2",
    },
    before: {
      alias: "stage3before",
      commitSha: "a92ff7e1bd72d399615a6a4e747416c67e0f9a90",
      treeSha: "4b733a0dcb93ad263fe124e0c67fdbd21423a755",
    },
  },
] as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const fileReferenceSchema = z.object({
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const observationSchema = z.object({
  exitCode: z.number().int(),
  log: fileReferenceSchema,
  phase: z.enum(["compile", "run"]),
}).strict();
const snapshotSchema = z.object({
  commitSha: commitSchema,
  observation: observationSchema,
  treeSha: commitSchema,
}).strict();
const protectionResultSchema = z.object({
  failed: z.number().int().nonnegative(),
  log: fileReferenceSchema,
  passed: z.number().int().positive(),
}).strict();
const protectionSchema = z.object({
  after: protectionResultSchema,
  before: protectionResultSchema,
  excludedTest: z.literal("format-test"),
  nativeLinuxX64Complete: z.literal(false),
}).strict();
const baseStageSchema = z.object({
  after: snapshotSchema,
  before: snapshotSchema,
  evaluator: fileReferenceSchema,
  position: z.literal(1),
  protection: protectionSchema,
}).strict();
const secondStageSchema = z.object({
  after: snapshotSchema,
  before: snapshotSchema,
  evaluator: fileReferenceSchema,
  headerSmoke: observationSchema.extend({
    evaluator: fileReferenceSchema,
  }).strict(),
  position: z.literal(2),
  protection: protectionSchema,
}).strict();
const thirdStageSchema = z.object({
  after: snapshotSchema,
  before: snapshotSchema,
  evaluator: fileReferenceSchema,
  position: z.literal(3),
  protection: protectionSchema,
  terminateWarningProbe: observationSchema.extend({
    extraCompileFlag: z.literal("-Werror=terminate"),
  }).strict(),
}).strict();
const reasonCodeSchema = z.enum([
  "STAGE2_PUBLIC_HEADER_COMPILE_FAILURE",
  "STAGE3_THROW_TERMINATES",
]);
const assessmentSchema = z.object({
  anchorId: z.string().min(1),
  benchmarkBase: z.object({
    commitSha: z.literal(
      "7f7504b3f532c6cd7d6de405241f774df6b4b666",
    ),
    treeSha: z.literal(
      "740ae8b6f43cd1f8d3abff7dad3b835f929dc1c2",
    ),
  }).strict(),
  benchmarkBaseIsAncestorOfInitial: z.literal(false),
  blockingStagePositions: z.array(
    z.number().int().min(1).max(3),
  ),
  cappedPoolRank: z.number().int().positive(),
  decision: z.literal("reject-machine-qualification"),
  gitCommitObjects: z.array(
    fileReferenceSchema.extend({
      commitSha: commitSchema,
    }).strict(),
  ).length(6),
  historicalLicense: z.object({
    licensePath: z.literal("LICENSE.rst"),
    licenseSha256: z.literal(
      "560d39617dfb4b4e4088597291a070ed6c3a8d67668114ed475c673430c3e49a",
    ),
    spdx: z.literal("BSD-2-Clause"),
  }).strict(),
  mergeBaseCommitSha: z.literal(
    "24594c747e7d516baa6dac0113e81f3bfd1970b6",
  ),
  qualifiedStagePositions: z.array(
    z.number().int().min(1).max(3),
  ),
  reasonCodes: z.array(reasonCodeSchema).min(1),
  semanticAssessmentSha256: sha256Schema,
  stages: z.tuple([
    baseStageSchema,
    secondStageSchema,
    thirdStageSchema,
  ]),
}).strict();
const evidenceSchema = z.object({
  artifactKind: z.literal(
    "c6-real-history-transition-evaluator-screening",
  ),
  assessments: z.array(assessmentSchema).min(1),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedCount: z.literal(0),
  }).strict(),
  dockerProfile: z.object({
    capDrop: z.literal("ALL"),
    daemonIdentityCryptographicallyAttested: z.literal(false),
    image: z.literal(IMAGE),
    network: z.literal("none"),
    noNewPrivileges: z.literal(true),
    platform: z.literal("linux/amd64"),
    pull: z.literal("never"),
  }).strict(),
  recording: z.object({
    executionAuthenticated: z.literal(false),
    persistedValidation: z.literal(
      "frozen-assets-receipt-and-derived-rejection-only",
    ),
    projectionProvesLiveDockerReplay: z.literal(false),
    rawExecutionLogsRetained: z.literal(true),
    recordedExecutorAuthority: z.literal("local-system-docker"),
    sourceRepositoryArchiveRetained: z.literal(false),
  }).strict(),
  schemaVersion: z.literal(
    "goodmemory.c6.real-history-transition-evaluator-screening.v1",
  ),
  semanticScreening: z.object({
    assessmentPrefixSha256: sha256Schema,
    path: z.string().min(1),
    throughCappedPoolRank: z.number().int().positive(),
  }).strict(),
}).strict();
const semanticLedgerSchema = z.object({
  assessments: z.array(z.object({
    anchorId: z.string().min(1),
    cappedPoolRank: z.number().int().positive(),
    review: z.object({
      assessmentSha256: sha256Schema,
    }).passthrough(),
    screeningDecision: z.enum([
      "continue-machine-qualification",
      "reject",
    ]),
    stages: z.array(z.object({
      afterCommit: commitSchema,
      beforeCommit: commitSchema.nullable(),
      position: z.number().int().min(1).max(3),
    }).passthrough()).length(3),
  }).passthrough()).min(1),
}).passthrough();

type Evidence = z.infer<typeof evidenceSchema>;
type AssetFile = C6AssetLock["files"][number];

export interface C6RealHistoryTransitionEvaluatorAssessment {
  anchorId: string;
  blockingStagePositions: number[];
  cappedPoolRank: number;
  decision: "reject-machine-qualification";
  qualifiedStagePositions: number[];
  reasonCodes: Array<z.infer<typeof reasonCodeSchema>>;
}

export interface C6RealHistoryTransitionEvaluatorScreening {
  assessments: C6RealHistoryTransitionEvaluatorAssessment[];
  derived: {
    acceptedEpisodeCount: 0;
    candidateExpansionRequired: boolean;
    candidateManifestFrozen: false;
    cappedCandidateCount: number;
    cappedPoolCanMeetMinimum: boolean;
    codexRunReady: false;
    definitivelyRejectedCandidateCount: number;
    evaluatedContinuationCount: number;
    maximumPossibleMachineQualifiedCount: number;
    machineQualifiedCount: 0;
    minimumRequiredMachineQualifiedCount: number;
    rejectedContinuationCount: number;
  };
  recording: Evidence["recording"];
}

export interface LoadedC6RealHistoryTransitionEvaluatorScreening
  extends C6RealHistoryTransitionEvaluatorScreening {
  assetContents: Readonly<Record<string, string>>;
  assetFiles: readonly AssetFile[];
  assetLockSha256: string;
  assetRootSha256: string;
  evidence: Evidence;
}

export async function loadC6RealHistoryTransitionEvaluatorScreening(
  input: {
    fixtureRoot: string;
    qualification: C6RealHistoryTransitionQualification;
    semanticScreening: unknown;
    trajectory: C6ReviewTrajectoryDiscovery;
  },
): Promise<LoadedC6RealHistoryTransitionEvaluatorScreening> {
  const root = resolve(input.fixtureRoot);
  const lock = await loadC6AssetLock(root);
  if (lock.assetLockSha256 !== EXPECTED_ASSET_LOCK_SHA256) {
    throw new Error(
      "C6 transition-evaluator screening asset lock identity does not match",
    );
  }
  const assetContents: Record<string, string> = {};
  for (const file of lock.assetLock.files) {
    assetContents[file.path] = (
      await readC6StableRegularFile(
        join(root, file.path),
        `transition-evaluator asset ${file.path}`,
      )
    ).toString("utf8");
  }
  const evidence = evidenceSchema.parse(
    JSON.parse(assetContents["evidence.json"] ?? "") as unknown,
  );
  const validated = validateC6RealHistoryTransitionEvaluatorScreening({
    assetContents,
    assetFiles: lock.assetLock.files,
    evidence,
    qualification: input.qualification,
    semanticScreening: input.semanticScreening,
    trajectory: input.trajectory,
  });
  await verifyC6AssetClosure(root, lock);
  return {
    ...validated,
    assetContents,
    assetFiles: lock.assetLock.files,
    assetLockSha256: lock.assetLockSha256,
    assetRootSha256: lock.assetLock.assetRootSha256,
    evidence,
  };
}

export function validateC6RealHistoryTransitionEvaluatorScreening(
  input: {
    assetContents: Readonly<Record<string, string>>;
    assetFiles: readonly AssetFile[];
    evidence: unknown;
    qualification: C6RealHistoryTransitionQualification;
    semanticScreening: unknown;
    trajectory: C6ReviewTrajectoryDiscovery;
  },
): C6RealHistoryTransitionEvaluatorScreening {
  const evidence = evidenceSchema.parse(input.evidence);
  validateC6RealHistorySemanticScreening({
    ledger: input.semanticScreening,
    qualification: input.qualification,
    trajectory: input.trajectory,
  });
  const semanticLedger = semanticLedgerSchema.parse(
    input.semanticScreening,
  );
  const rawSemanticLedger = input.semanticScreening as {
    assessments: unknown[];
  };
  const prefix = semanticLedger.assessments.slice(
    0,
    evidence.semanticScreening.throughCappedPoolRank,
  );
  const rawPrefix = rawSemanticLedger.assessments.slice(
    0,
    evidence.semanticScreening.throughCappedPoolRank,
  );
  if (
    prefix.length !==
      evidence.semanticScreening.throughCappedPoolRank ||
    sha256(JSON.stringify(rawPrefix)) !==
      evidence.semanticScreening.assessmentPrefixSha256
  ) {
    throw new Error(
      "C6 transition-evaluator semantic prefix does not match",
    );
  }
  const continuations = prefix.filter((assessment) =>
    assessment.screeningDecision === "continue-machine-qualification"
  );
  if (continuations.length !== evidence.assessments.length) {
    throw new Error(
      "C6 transition-evaluator screening must cover every semantic continuation in its bound prefix",
    );
  }

  const assetMap = new Map(
    input.assetFiles.map((file) => [file.path, file.sha256]),
  );
  const assessments = evidence.assessments.map((assessment, index) => {
    const semantic = continuations[index];
    if (
      semantic === undefined ||
      assessment.anchorId !== semantic.anchorId ||
      assessment.cappedPoolRank !== semantic.cappedPoolRank ||
      assessment.semanticAssessmentSha256 !==
        semantic.review.assessmentSha256
    ) {
      throw new Error(
        "C6 transition-evaluator assessment does not match semantic continuation",
      );
    }
    const expectedCommitTrees = new Map<string, string>([
      [
        assessment.benchmarkBase.commitSha,
        assessment.benchmarkBase.treeSha,
      ],
      ...EXPECTED_STAGE_SNAPSHOTS.flatMap((snapshot) => [
        [snapshot.before.commitSha, snapshot.before.treeSha] as const,
        [snapshot.after.commitSha, snapshot.after.treeSha] as const,
      ]),
    ]);
    if (
      assessment.gitCommitObjects.length !== expectedCommitTrees.size ||
      JSON.stringify(
        assessment.gitCommitObjects.map((object) => object.commitSha),
      ) !== JSON.stringify([...expectedCommitTrees.keys()])
    ) {
      throw new Error(
        "C6 transition-evaluator commit-object closure does not match snapshots",
      );
    }
    for (const object of assessment.gitCommitObjects) {
      assertAssetReference(object, assetMap, input.assetContents);
      assertGitCommitObject(
        object,
        expectedCommitTrees.get(object.commitSha)!,
        input.assetContents,
      );
    }
    for (const [stageIndex, stage] of assessment.stages.entries()) {
      const semanticStage = semantic.stages[stageIndex];
      const expectedSnapshot = EXPECTED_STAGE_SNAPSHOTS[stageIndex];
      if (
        semanticStage === undefined ||
        expectedSnapshot === undefined ||
        stage.position !== semanticStage.position ||
        stage.after.commitSha !== semanticStage.afterCommit ||
        (
          stage.position > 1 &&
          stage.before.commitSha !== semanticStage.beforeCommit
        ) ||
        stage.before.commitSha !== expectedSnapshot.before.commitSha ||
        stage.before.treeSha !== expectedSnapshot.before.treeSha ||
        stage.after.commitSha !== expectedSnapshot.after.commitSha ||
        stage.after.treeSha !== expectedSnapshot.after.treeSha
      ) {
        throw new Error(
          "C6 transition-evaluator stage lineage does not match semantic screening",
        );
      }
      assertAssetReference(
        stage.evaluator,
        assetMap,
        input.assetContents,
      );
      assertObservation(
        stage.before.observation,
        assetMap,
        input.assetContents,
        {
          sourcePath: stage.evaluator.path,
          treeAlias: expectedSnapshot.before.alias,
        },
      );
      assertObservation(
        stage.after.observation,
        assetMap,
        input.assetContents,
        {
          sourcePath: stage.evaluator.path,
          treeAlias: expectedSnapshot.after.alias,
        },
      );
      assertProtection(
        stage.protection,
        assetMap,
        input.assetContents,
        {
          afterTreeAlias: expectedSnapshot.after.alias,
          beforeTreeAlias: expectedSnapshot.before.alias,
        },
      );
      if (stage.position === 2) {
        assertAssetReference(
          stage.headerSmoke.evaluator,
          assetMap,
          input.assetContents,
        );
        assertObservation(
          stage.headerSmoke,
          assetMap,
          input.assetContents,
          {
            sourcePath: stage.headerSmoke.evaluator.path,
            treeAlias: expectedSnapshot.after.alias,
          },
        );
      }
      if (stage.position === 3) {
        assertObservation(
          stage.terminateWarningProbe,
          assetMap,
          input.assetContents,
          {
            sourcePath: stage.evaluator.path,
            treeAlias: expectedSnapshot.after.alias,
          },
        );
      }
    }
    if (
      assessment.stages[0].before.commitSha !==
        assessment.mergeBaseCommitSha ||
      assessment.stages[1].before.commitSha !==
        assessment.stages[0].after.commitSha
    ) {
      throw new Error(
        "C6 transition-evaluator selected history boundary does not match",
      );
    }

    const qualifiedStagePositions = assessment.stages
      .filter((stage) =>
        stage.before.observation.exitCode !== 0 &&
        stage.after.observation.phase === "run" &&
        stage.after.observation.exitCode === 0 &&
        stage.protection.before.failed === 0 &&
        stage.protection.after.failed === 0
      )
      .map((stage) => stage.position);
    const blockingStagePositions = assessment.stages
      .filter((stage) => !qualifiedStagePositions.includes(stage.position))
      .map((stage) => stage.position);
    const reasonCodes: Array<z.infer<typeof reasonCodeSchema>> = [];
    const stageTwo = assessment.stages[1];
    const stageTwoAfterLog =
      input.assetContents[stageTwo.after.observation.log.path] ?? "";
    const stageTwoHeaderLog =
      input.assetContents[stageTwo.headerSmoke.log.path] ?? "";
    if (
      stageTwo.after.observation.phase === "compile" &&
      stageTwo.after.observation.exitCode !== 0 &&
      stageTwo.headerSmoke.phase === "compile" &&
      stageTwo.headerSmoke.exitCode !== 0 &&
      isPublicHeaderCompileFailure(stageTwoAfterLog) &&
      isPublicHeaderCompileFailure(stageTwoHeaderLog)
    ) {
      reasonCodes.push("STAGE2_PUBLIC_HEADER_COMPILE_FAILURE");
    }
    const stageThree = assessment.stages[2];
    const stageThreeAfterLog =
      input.assetContents[stageThree.after.observation.log.path] ?? "";
    const terminateProbeLog =
      input.assetContents[stageThree.terminateWarningProbe.log.path] ?? "";
    if (
      stageThree.after.observation.phase === "run" &&
      stageThree.after.observation.exitCode === 134 &&
      stageThree.terminateWarningProbe.phase === "compile" &&
      stageThree.terminateWarningProbe.exitCode !== 0 &&
      isThrowTerminatesFailure(stageThreeAfterLog) &&
      isTerminateCompileFailure(terminateProbeLog)
    ) {
      reasonCodes.push("STAGE3_THROW_TERMINATES");
    }
    if (
      blockingStagePositions.length === 0 ||
      JSON.stringify(qualifiedStagePositions) !==
        JSON.stringify(assessment.qualifiedStagePositions) ||
      JSON.stringify(blockingStagePositions) !==
        JSON.stringify(assessment.blockingStagePositions) ||
      JSON.stringify(reasonCodes) !==
        JSON.stringify(assessment.reasonCodes)
    ) {
      throw new Error(
        "C6 transition-evaluator rejection is not derivable from its receipt",
      );
    }
    return {
      anchorId: assessment.anchorId,
      blockingStagePositions,
      cappedPoolRank: assessment.cappedPoolRank,
      decision: assessment.decision,
      qualifiedStagePositions,
      reasonCodes,
    };
  });
  const cappedCandidateCount =
    input.qualification.counts.cappedCandidateCount;
  const definitivelyRejectedCandidateCount =
    semanticLedger.assessments.filter((assessment) =>
      assessment.screeningDecision === "reject"
    ).length + assessments.length;
  const maximumPossibleMachineQualifiedCount =
    cappedCandidateCount - definitivelyRejectedCandidateCount;
  const minimumRequiredMachineQualifiedCount =
    input.qualification.stopGo.minimumMachineQualified;
  const cappedPoolCanMeetMinimum =
    maximumPossibleMachineQualifiedCount >=
      minimumRequiredMachineQualifiedCount;

  return {
    assessments,
    derived: {
      acceptedEpisodeCount: 0,
      candidateExpansionRequired: !cappedPoolCanMeetMinimum,
      candidateManifestFrozen: false,
      cappedCandidateCount,
      cappedPoolCanMeetMinimum,
      codexRunReady: false,
      definitivelyRejectedCandidateCount,
      evaluatedContinuationCount: assessments.length,
      maximumPossibleMachineQualifiedCount,
      machineQualifiedCount: 0,
      minimumRequiredMachineQualifiedCount,
      rejectedContinuationCount: assessments.length,
    },
    recording: evidence.recording,
  };
}

function assertAssetReference(
  reference: z.infer<typeof fileReferenceSchema>,
  assetMap: ReadonlyMap<string, string>,
  assetContents: Readonly<Record<string, string>>,
): void {
  const contents = assetContents[reference.path];
  if (
    assetMap.get(reference.path) !== reference.sha256 ||
    contents === undefined ||
    sha256(contents) !== reference.sha256
  ) {
    throw new Error(
      `C6 transition-evaluator asset does not match: ${reference.path}`,
    );
  }
}

function assertGitCommitObject(
  reference: z.infer<typeof fileReferenceSchema> & {
    commitSha: string;
  },
  expectedTreeSha: string,
  assetContents: Readonly<Record<string, string>>,
): void {
  const encoded = assetContents[reference.path] ?? "";
  const hex = encoded.replaceAll(/\s/gu, "");
  if (
    hex.length === 0 ||
    hex.length % 2 !== 0 ||
    !/^[a-f0-9]+$/u.test(hex)
  ) {
    throw new Error(
      `C6 transition-evaluator commit object is not canonical hex: ${reference.path}`,
    );
  }
  const bytes = Buffer.from(hex, "hex");
  const objectHeader = Buffer.from(`commit ${bytes.byteLength}\0`);
  const commitSha = createHash("sha1")
    .update(objectHeader)
    .update(bytes)
    .digest("hex");
  const treeSha = /^tree ([a-f0-9]{40})\n/u.exec(
    bytes.toString("utf8"),
  )?.[1];
  if (
    commitSha !== reference.commitSha ||
    treeSha !== expectedTreeSha
  ) {
    throw new Error(
      `C6 transition-evaluator commit object does not match: ${reference.commitSha}`,
    );
  }
}

function assertObservation(
  observation: z.infer<typeof observationSchema>,
  assetMap: ReadonlyMap<string, string>,
  assetContents: Readonly<Record<string, string>>,
  expected: {
    sourcePath: string;
    treeAlias: string;
  },
): void {
  assertAssetReference(observation.log, assetMap, assetContents);
  const contents = assetContents[observation.log.path] ?? "";
  const match = contents.match(/(?:^|\n)exit_code=(-?\d+)\n?$/u);
  if (
    match === null ||
    Number(match[1]) !== observation.exitCode ||
    !contents.startsWith(`image=${IMAGE}\nplatform=linux/amd64\n`) ||
    !contents.includes(`\ntree=${expected.treeAlias}\n`) ||
    !contents.includes(`\nsource=${expected.sourcePath}\n`)
  ) {
    throw new Error(
      `C6 transition-evaluator observation does not match: ${observation.log.path}`,
    );
  }
}

function assertProtection(
  protection: z.infer<typeof protectionSchema>,
  assetMap: ReadonlyMap<string, string>,
  assetContents: Readonly<Record<string, string>>,
  expected: {
    afterTreeAlias: string;
    beforeTreeAlias: string;
  },
): void {
  for (const [result, treeAlias] of [
    [protection.before, expected.beforeTreeAlias],
    [protection.after, expected.afterTreeAlias],
  ] as const) {
    assertAssetReference(result.log, assetMap, assetContents);
    const contents = assetContents[result.log.path] ?? "";
    if (
      !contents.startsWith(`image=${IMAGE}\nplatform=linux/amd64\n`) ||
      !contents.includes(`\ntree=${treeAlias}\n`) ||
      !contents.includes(
        `${result.passed}/${result.passed} Test`,
      ) ||
      !contents.includes(
        `100% tests passed, ${result.failed} tests failed out of ${result.passed}`,
      ) ||
      !contents.endsWith("exit_code=0\n")
    ) {
      throw new Error(
        `C6 transition-evaluator protection receipt does not match: ${result.log.path}`,
      );
    }
  }
}

function isPublicHeaderCompileFailure(contents: string): boolean {
  return (
    contents.includes("/work/include/fmt/color.h") &&
    contents.includes("expected unqualified-id before") &&
    contents.includes("FMT_NOEXCEPT")
  );
}

function isThrowTerminatesFailure(contents: string): boolean {
  return (
    contents.includes("throw’ will always call ‘terminate") &&
    contents.includes("terminate called after throwing an instance") &&
    contents.includes("what():  can't OR a terminal color") &&
    contents.includes("Aborted")
  );
}

function isTerminateCompileFailure(contents: string): boolean {
  return (
    contents.includes("extra_compile_flags=-Werror=terminate") &&
    contents.includes("error: ‘throw’ will always call ‘terminate") &&
    contents.includes("some warnings being treated as errors")
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
