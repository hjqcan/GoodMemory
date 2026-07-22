import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const GENERATED_BY = "scripts/project-historical-evidence.ts";
const PROJECTION_PATHS = [
  "benchmark-claims/evidence/beam-v0.6.0-historical.json",
  "benchmark-claims/evidence/implicitmembench-historical.json",
  "benchmark-claims/evidence/locomo-v0.6.0-historical.json",
  "benchmark-claims/evidence/longmemeval-historical.json",
  "benchmark-claims/evidence/memoryagentbench-v0.6.0-historical.json",
] as const;

const PHASE_72_RELEASE_GATE_PATH =
  "reports/quality-gates/phase-72/run-20260716-final/phase-72-release-gate.json";
const BEAM_ORDERING_AUDIT_PATH =
  "reports/quality-gates/phase-72/run-20260716-final/beam-event-ordering-integrity-audit.json";
const IMPLICIT_RESCORE_PATH =
  "reports/eval/research/phase-61/implicitmembench/" +
  "implicitmembench-independent-rescore-gpt54-current/rescore-summary.json";
const LONGMEMEVAL_DETERMINISTIC_PATH =
  "reports/eval/research/phase-62/longmemeval/" +
  "run-phase67b-longmemeval-rules-deterministic-current-deterministic-subset/" +
  "deterministic-subset.json";
const LONGMEMEVAL_RESCORE_PATH =
  "reports/eval/research/official-rescore/" +
  "rescore-longmemeval-official-judge/rescore-summary.json";

export interface HistoricalEvidenceProjection {
  generatedBy?: string;
  sourceArtifacts: Array<{
    bytes?: number;
    path: string;
    sha256?: string;
  }>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(value: unknown, path: readonly (number | string)[]): unknown {
  let cursor = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(cursor) || segment >= cursor.length) {
        throw new Error(`Source field ${path.join(".")} is missing.`);
      }
      cursor = cursor[segment];
      continue;
    }
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      throw new Error(`Source field ${path.join(".")} is missing.`);
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function booleanAt(value: unknown, path: readonly (number | string)[]): boolean {
  const resolved = valueAt(value, path);
  if (typeof resolved !== "boolean") {
    throw new Error(`Source field ${path.join(".")} must be a boolean.`);
  }
  return resolved;
}

function numberAt(value: unknown, path: readonly (number | string)[]): number {
  const resolved = valueAt(value, path);
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new Error(`Source field ${path.join(".")} must be a finite number.`);
  }
  return resolved;
}

function stringAt(value: unknown, path: readonly (number | string)[]): string {
  const resolved = valueAt(value, path);
  if (typeof resolved !== "string" || resolved.length === 0) {
    throw new Error(`Source field ${path.join(".")} must be a non-empty string.`);
  }
  return resolved;
}

function sourceJson(
  sources: ReadonlyMap<string, Uint8Array>,
  path: string,
): unknown {
  const content = sources.get(path);
  if (!content) {
    throw new Error(`Historical projection is missing required source ${path}.`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(content)) as unknown;
  } catch (error) {
    throw new Error(`Historical projection source ${path} is not valid JSON: ${String(error)}`);
  }
}

function phase72Claim(
  sources: ReadonlyMap<string, Uint8Array>,
  metric: "beam" | "locomo" | "memoryAgentBench",
): { packageVersion: string; values: unknown } {
  const gate = sourceJson(sources, PHASE_72_RELEASE_GATE_PATH);
  return {
    packageVersion: stringAt(gate, ["packageVersion"]),
    values: valueAt(gate, ["metrics", metric]),
  };
}

function deriveClaimFields(
  projection: HistoricalEvidenceProjection,
  sources: ReadonlyMap<string, Uint8Array>,
): Partial<HistoricalEvidenceProjection> {
  if (projection.benchmark === "BEAM") {
    const { packageVersion, values } = phase72Claim(sources, "beam");
    const audit = sourceJson(sources, BEAM_ORDERING_AUDIT_PATH);
    return {
      claim: {
        adjacentEvidenceOrderInversions: numberAt(
          audit,
          ["audit", "summary", "adjacentEvidenceOrderInversions"],
        ),
        casesWithNonChronologicalEvidenceOrder: numberAt(
          audit,
          ["audit", "summary", "casesWithNonChronologicalEvidenceOrder"],
        ),
        casesWithRequestedRubricCountMismatch: numberAt(
          audit,
          ["audit", "summary", "casesWithRequestedRubricCountMismatch"],
        ),
        executionFailures: numberAt(values, ["executionFailures"]),
        officialJudgeFailures: numberAt(values, ["officialJudgeFailures"]),
        officialUnifiedScore: numberAt(values, ["officialUnifiedScore"]),
        packageVersion,
        strictBinaryGateEligible: booleanAt(
          audit,
          ["audit", "summary", "strictBinaryGateEligible"],
        ),
        strictBinaryScore: numberAt(values, ["strictBinaryScore"]),
        totalEventOrderingCases: numberAt(
          audit,
          ["audit", "summary", "totalEventOrderingCases"],
        ),
      },
    };
  }
  if (projection.benchmark === "LoCoMo") {
    const { packageVersion, values } = phase72Claim(sources, "locomo");
    return {
      claim: {
        executionFailures: numberAt(values, ["executionFailures"]),
        officialJudgeFailures: numberAt(values, ["officialJudgeFailures"]),
        officialScore: numberAt(values, ["officialScore"]),
        openDomainScore: numberAt(values, ["openDomainScore"]),
        packageVersion,
        strictScore: numberAt(values, ["strictScore"]),
      },
    };
  }
  if (projection.benchmark === "MemoryAgentBench") {
    const { packageVersion, values } = phase72Claim(sources, "memoryAgentBench");
    return {
      claim: {
        conflictResolutionExecutionFailures: numberAt(
          values,
          ["conflictResolutionExecutionFailures"],
        ),
        conflictResolutionScore: numberAt(values, ["conflictResolutionScore"]),
        packageVersion,
        testTimeLearningExecutionFailures: numberAt(
          values,
          ["testTimeLearningExecutionFailures"],
        ),
        testTimeLearningScore: numberAt(values, ["testTimeLearningScore"]),
      },
    };
  }
  if (projection.benchmark === "ImplicitMemBench") {
    const summary = sourceJson(sources, IMPLICIT_RESCORE_PATH);
    return {
      claim: {
        answerModel: stringAt(summary, ["answerModel"]),
        baselineScore: numberAt(
          summary,
          ["overallSummary", "comparison", "baselineOverallRate"],
        ),
        blockingScore: numberAt(
          summary,
          ["overallSummary", "comparison", "bestGoodMemoryBlockingOnlyRate"],
        ),
        executionFailures: numberAt(
          summary,
          [
            "overallSummary",
            "profiles",
            "goodmemory-distilled-feedback+controlled-priming",
            "executionFailures",
          ],
        ),
        judgeModel: stringAt(summary, ["judgeModel"]),
        runId: stringAt(summary, ["runId"]),
        sameModelJudge: booleanAt(summary, ["sameModelJudge"]),
        score: numberAt(
          summary,
          ["overallSummary", "comparison", "bestGoodMemoryOverallRate"],
        ),
        sourceAnswersUnchanged: booleanAt(summary, ["sourceAnswersUnchanged"]),
        sourceRunId: stringAt(summary, ["sourceReports", "sourceRunId"]),
        totalCases: numberAt(summary, ["overallSummary", "benchmark", "totalCases"]),
      },
    };
  }
  if (projection.benchmark === "LongMemEval") {
    const deterministic = sourceJson(sources, LONGMEMEVAL_DETERMINISTIC_PATH);
    const rescore = sourceJson(sources, LONGMEMEVAL_RESCORE_PATH);
    const claimProfile = stringAt(deterministic, ["claim", "profile"]);
    const profiles = valueAt(deterministic, ["profiles"]);
    if (!Array.isArray(profiles)) {
      throw new Error("Source field profiles must be an array.");
    }
    const profile = profiles.find(
      (candidate) => isRecord(candidate) && candidate.profile === claimProfile,
    );
    if (!profile) {
      throw new Error(`Source profile ${claimProfile} is missing.`);
    }
    const diagnostic = isRecord(projection.promptCompatibleDiagnostic)
      ? projection.promptCompatibleDiagnostic
      : {};
    return {
      deterministicClaim: {
        baselineAccuracy: numberAt(
          deterministic,
          ["baseline", "deterministicSubsetAccuracy"],
        ),
        executionFailures: numberAt(deterministic, ["claim", "executionFailures"]),
        judgeFree: booleanAt(deterministic, ["claim", "judgeFree"]),
        profile: claimProfile,
        score: numberAt(deterministic, ["claim", "deterministicSubsetAccuracy"]),
        sourceCases: numberAt(profile, ["totalCases"]),
      },
      promptCompatibleDiagnostic: {
        ...diagnostic,
        judgeFailures: numberAt(rescore, ["judgeFailures"]),
        judgeModel: stringAt(rescore, ["judgeModel"]),
        overallAccuracy: numberAt(rescore, ["overallAccuracy"]),
        protocol: stringAt(rescore, ["protocol"]),
        selectedCases: numberAt(rescore, ["selectedCases"]),
        sourceAnswersUnchanged: booleanAt(rescore, ["sourceAnswersUnchanged"]),
        sourceInputFingerprints: valueAt(rescore, ["sourceInputFingerprints"]),
      },
    };
  }
  return {};
}

export function parseHistoricalEvidenceProjection(
  value: unknown,
): HistoricalEvidenceProjection {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as HistoricalEvidenceProjection).sourceArtifacts) ||
    !(value as HistoricalEvidenceProjection).sourceArtifacts.every(
      (artifact) =>
        artifact !== null &&
        typeof artifact === "object" &&
        typeof artifact.path === "string" &&
        artifact.path.length > 0,
    )
  ) {
    throw new Error("Historical evidence projection is malformed.");
  }
  return value as HistoricalEvidenceProjection;
}

export async function refreshHistoricalEvidenceProjection(input: {
  projection: HistoricalEvidenceProjection;
  readArtifact(path: string): Promise<Uint8Array>;
}): Promise<HistoricalEvidenceProjection> {
  const sources = new Map<string, Uint8Array>();
  const sourceArtifacts = await Promise.all(
    input.projection.sourceArtifacts.map(async ({ path }) => {
      const content = await input.readArtifact(path);
      sources.set(path, content);
      return {
        bytes: content.byteLength,
        path,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    }),
  );
  return {
    ...input.projection,
    ...deriveClaimFields(input.projection, sources),
    generatedBy: GENERATED_BY,
    sourceArtifacts,
  };
}

export function assertHistoricalEvidenceProjectionCurrent(input: {
  actual: HistoricalEvidenceProjection;
  expected: HistoricalEvidenceProjection;
}): void {
  if (!isDeepStrictEqual(input.actual, input.expected)) {
    throw new Error(
      "Historical evidence projection claims or source fingerprints drifted.",
    );
  }
}

async function main(): Promise<void> {
  const write = Bun.argv.includes("--write");
  for (const path of PROJECTION_PATHS) {
    const absolutePath = resolve(path);
    const actual = parseHistoricalEvidenceProjection(
      JSON.parse(await readFile(absolutePath, "utf8")),
    );
    const expected = await refreshHistoricalEvidenceProjection({
      projection: actual,
      readArtifact: (artifactPath) => readFile(resolve(artifactPath)),
    });
    if (write) {
      await writeFile(absolutePath, `${JSON.stringify(expected, null, 2)}\n`, "utf8");
    } else {
      assertHistoricalEvidenceProjectionCurrent({ actual, expected });
    }
  }
  console.log(write ? "Historical evidence projections refreshed." : "Historical evidence projections are current.");
}

if (import.meta.main) {
  await main();
}
