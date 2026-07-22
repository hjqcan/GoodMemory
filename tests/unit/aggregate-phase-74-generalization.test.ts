import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  aggregatePhase74GeneralizationArtifacts,
  aggregatePhase74StageDiagnosticArtifacts,
  parsePhase74AggregationCliOptions,
  runPhase74GeneralizationAggregation,
} from "../../scripts/aggregate-phase-74-generalization";
import { PHASE74_EXPERIMENT_ARMS } from "../../src/eval/phase74ExperimentDesign";
import {
  buildPhase74StageConfigurations,
  type Phase74EvaluationAttribution,
} from "../../src/eval/phase74Generalization";
import {
  buildPhase74IngestionUsageFingerprint,
  buildPhase74IngestionUsagePaths,
  buildPhase74RetrievalSnapshotId,
  phase74ExecutionBranch,
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "../../src/eval/phase74FullRuntime";
import {
  buildPhase74ModelUsageEvidence,
  validatePhase74ModelUsageLedger,
} from "../../src/eval/modelUsage";
import {
  runPhase74ProtectionSuiteCases,
} from "../../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionSuiteBranchScores,
  Phase74ProtectionSuiteKind,
} from "../../src/eval/phase74ProtectionRun";
import {
  buildPhase74FrozenProtectionSuiteEvidence,
  hashPhase74ProtectionSuiteIdentity,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionSuiteManifest,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionSuiteVerifier,
} from "../../src/eval/phase74ProtectionVerifier";
import { buildPhase74ProtocolScoringIdentity } from "../../src/eval/phase74ProtocolScoring";
import { buildPhase74ReplicateComparison } from "../../src/eval/phase74Replicates";
import {
  buildEvalRunIdentity,
  hashEvalExperimentIdentity,
  hashEvalRunIdentity,
} from "../../src/eval/runIdentity";

const roots: string[] = [];
const STAGES = ["E1", "E2", "E3", "E4"] as const;
const FORMATS = [
  "prose",
  "chronology",
  "compact_json",
  "json_locale_note",
] as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonLines(
  path: string,
  values: readonly unknown[],
): Promise<void> {
  await writeFile(
    path,
    values.map((value) => JSON.stringify(value)).join("\n") + "\n",
    "utf8",
  );
}

function stageArms(stage: "E1" | "E2" | "E3") {
  return PHASE74_EXPERIMENT_ARMS[stage];
}

function comparisonArms(stage: "E1" | "E2" | "E3") {
  const comparison = buildPhase74ReplicateComparison({
    benchmark: "locomo",
    selectedCaseIdsSha256: "a".repeat(64),
    stage,
  });
  return {
    baseline: comparison.baselineArm,
    candidate: comparison.candidateArm,
  };
}

function directUsageRows(caseIds: readonly string[]) {
  const intents = (["baseline", "candidate"] as const).flatMap((branch) =>
    caseIds.map((caseId, index) => ({
      attempt: 1,
      branch,
      caseId,
      modelId: "gpt-5.6-terra",
      operation: "answer_generation" as const,
      providerId: "openai",
      requestId: `${branch}-${index}-${caseId}`,
      schemaVersion: 1 as const,
    }))
  );
  const events = intents.map((intent) => ({
      ...intent,
      completeness: "complete" as const,
      outcome: "succeeded" as const,
      usage: {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: intent.branch === "candidate" ? 90 : 80,
        outputTokens: 20,
        uncachedInputTokens: intent.branch === "candidate" ? 90 : 80,
      },
    }));
  return { events, intents };
}

function ingestionUsageRows(key: string) {
  const intent = {
    attempt: 1,
    branch: "shadow" as const,
    caseId: `ingestion-${key}`,
    modelId: "gpt-5.6-terra",
    operation: "assisted_extraction" as const,
    providerId: "openai",
    requestId: `ingestion-${key}`,
    schemaVersion: 1 as const,
  };
  return {
    events: [{
      ...intent,
      completeness: "complete" as const,
      outcome: "succeeded" as const,
      usage: {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: 40,
        outputTokens: 10,
        uncachedInputTokens: 40,
      },
    }],
    intents: [intent],
  };
}

interface FixtureOptions {
  admission?:
    | "canonical"
    | "deterministic-reranker"
    | "legacy"
    | "missing-embedding"
    | "missing-evaluator-source"
    | "missing-provider-object-calls"
    | "noncanonical-scorer";
  costBoundary?: "full-product" | "query-only";
  crossFamilyCallBudgetDrift?: boolean;
  includeE3EvidenceLedger?: boolean;
  includeE4Scores?: boolean;
  negativeE3Replicate?: {
    benchmark: "locomo" | "longmemeval";
    replicate: 1 | 2 | 3;
  };
  protectionEvaluatorSourceMismatch?: boolean;
  subsetSelection?: boolean;
  unequalClusterE2?: boolean;
}

async function createArtifactFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-phase74-aggregate-"));
  roots.push(root);
  const runDirectories: string[] = [];
  const protection = await writeProtectionArtifact(root);
  const protectionEvidence = JSON.parse(await readFile(
    protection.path,
    "utf8",
  ));

  for (const benchmark of ["longmemeval", "locomo"] as const) {
    const cases = benchmark === "locomo"
      ? [
          { caseId: "locomo-1/q1", clusterId: "conversation-1" },
          { caseId: "locomo-1/q2", clusterId: "conversation-1" },
          { caseId: "locomo-2/q1", clusterId: "conversation-2" },
        ]
      : [
          { caseId: "lme-q1", clusterId: "lme-q1" },
          { caseId: "lme-q2", clusterId: "lme-q2" },
        ];
    const caseIds = cases.map(({ caseId }) => caseId);
    const caseKeys = cases.map(({ caseId }) => `case-${sha256(caseId)}`);
    const selectedCaseIdsSha256 = sha256(JSON.stringify(caseIds));

    for (const replicate of [1, 2, 3] as const) {
      const runDirectory = join(root, `${benchmark}-replicate-${replicate}`);
      runDirectories.push(runDirectory);
      await mkdir(runDirectory, { recursive: true });
      const datasetManifest = {
        adaptedCasesSha256: sha256(JSON.stringify(cases)),
        benchmark,
        caseCount: cases.length,
        datasetSha256: sha256(`${benchmark}-dataset`),
        normalizedFingerprint: sha256(`${benchmark}-normalized`),
        schemaVersion: 2,
        selectedCaseIdsSha256,
        source: {
          commit: "source-commit",
          license: "test-only",
          repository: "https://example.test/benchmark",
          sourceSha256: sha256(`${benchmark}-source`),
          sourceUrl: "https://example.test/benchmark/data.json",
        },
        unresolvedGoldEvidence: [],
        unresolvedGoldEvidenceCount: 0,
      };
      const canonicalConfiguration = {
        answer: {
          maxTokens: 512,
          reasoningEffort: "medium",
          temperature: 0,
        },
        callBudget: {
          embeddingSpendLimitUsd: 0.1,
          maxLanguageCalls:
            options.crossFamilyCallBudgetDrift && benchmark === "locomo"
              ? 81
              : 80,
        },
        caseConcurrency: 1,
        context: {
          maxTokens: 6_000,
          tokenizer: "utf8-byte-upper-bound-v1",
        },
        costBoundary: options.costBoundary === "query-only"
          ? "query-only-comparison-with-shadow-ingestion"
          : "full-product-standalone-shared-v1",
        dataset: datasetManifest,
        ...(options.admission === "missing-embedding"
          ? {}
          : {
              embedding: {
                gateway: "https://openrouter.ai/api/v1",
                model: "text-embedding-3-small",
                provider: "openai",
              },
            }),
        ...(options.admission === "missing-evaluator-source"
          ? {}
          : {
              evaluatorSource: {
                commit: options.protectionEvaluatorSourceMismatch
                  ? "c".repeat(40)
                  : "a".repeat(40),
                sha256: options.protectionEvaluatorSourceMismatch
                  ? "d".repeat(64)
                  : "b".repeat(64),
              },
            }),
        ...(options.admission === "missing-provider-object-calls"
          ? {}
          : { providerObjectCalls: PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION }),
        protectionBlueprint: {
          id: "phase74-protection-suite-manifest-v2",
          sha256: protectionEvidence.source.manifest.sha256,
        },
        modelUsageAccounting: "phase74-model-usage-v2",
        preRankLimit: 32,
        caseScheduling: "interleaved-memory-groups-v1",
        reader: "generic-label-free-v1",
        replicate,
        reranker: {
          gateway: "https://ai.gurkiai.com/v1",
          implementation: "provider-listwise-v1",
          mode: "provider",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        scoring: buildPhase74ProtocolScoringIdentity(benchmark, {
          gateway: "https://judge.example/v1",
          model: "gpt-5.5",
          provider: "openai",
        }),
        selection: {
          mode: options.subsetSelection
            ? "deterministic-content-hash-v2"
            : "all",
          populationContentSha256: sha256(`${benchmark}-population`),
          populationSize: cases.length + (options.subsetSelection ? 7 : 0),
          ...(options.subsetSelection ? { seed: 74 } : {}),
          selectedCaseIdsSha256,
          selectedCaseKeysSha256: sha256(JSON.stringify([...caseKeys].sort())),
          selectedSize: cases.length,
        },
        selectedCaseIdsSha256,
        selectedLimit: 12,
        seenCasesOnly: true,
      };
      const admission = options.admission ?? "canonical";
      const identity = buildEvalRunIdentity({
        answerModel: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        benchmark: `${benchmark}-full`,
        configuration: admission === "legacy"
          ? {
              costBoundary: "diagnostic-all-live-calls",
              reader: "generic-label-free-v1",
              replicate,
              seenCasesOnly: true,
            }
          : {
              ...canonicalConfiguration,
              ...(admission === "deterministic-reranker"
                ? {
                    reranker: {
                      implementation: "lexical-coverage-v1",
                      mode: "deterministic",
                    },
                  }
                : {}),
              ...(admission === "noncanonical-scorer"
                ? {
                    scoring: {
                      ...canonicalConfiguration.scoring,
                      scorer: "unapproved-scorer",
                    },
                  }
                : {}),
            },
        datasetSha256: datasetManifest.datasetSha256,
        generatedAt: `2026-07-1${replicate}T00:00:00.000Z`,
        generatedBy: "scripts/run-phase-74-generalization.ts",
        judgeModel: {
          gateway: "https://judge.example/v1",
          model: "gpt-5.5",
          provider: "openai",
        },
        promptSha256s: {
          genericReader: "reader-prompt",
          judge: "judge-prompt",
        },
        runId: `${benchmark}-replicate-${replicate}`,
      });
      const identityHash = hashEvalRunIdentity(identity);
      const experimentIdentityHash = hashEvalExperimentIdentity(identity);
      await writeJson(join(runDirectory, "run-identity.json"), identity);
      await writeJson(join(runDirectory, "dataset-manifest.json"), datasetManifest);

      for (const stage of STAGES) {
        const prefix = stage.toLowerCase();
        const callBudget = {
          embeddingCalls: cases.length,
          embeddingInputByteUpperBound: cases.length * 100,
          embeddingSpendLimitUsd: 0.1,
          languageCalls: cases.length * 2,
          maxLanguageCalls: canonicalConfiguration.callBudget.maxLanguageCalls,
          schemaVersion: 1,
        };
        if (stage === "E4") {
          const e4Rows = cases.flatMap(({ caseId, clusterId }) =>
            FORMATS.map((format, formatIndex) => ({
              answer: "answer",
              caseId,
              clusterId,
              contextTokens: [120, 80, 100, 90][formatIndex],
              contextTokensBeforeTruncation: [120, 80, 100, 90][formatIndex],
              contextTruncated: false,
              correct: true,
              format,
              ...(options.includeE4Scores === false
                ? {}
                : { score: [0.82, 0.835, 0.84, 0.81][formatIndex] }),
              snapshotId: sha256(`${identity.runId}/${caseId}/E4`),
            }))
          );
          const packets = cases.map(({ caseId }) => ({
            retrievedMemories: [],
            snapshotId: sha256(`${identity.runId}/${caseId}/E4`),
            storedMemories: [],
          }));
          const report = {
            e4: {
              cases: e4Rows,
              formatResults: [],
              selectedFormat: "not_evaluable",
            },
            executions: [],
            experimentIdentityHash,
            identity,
            identityHash,
            oracle: [],
            reason: "fixture",
            schemaVersion: 1,
            status: "not_evaluable",
            summary: {
              caseCount: cases.length,
              executionFailures: 0,
              renderedContextMaxTokens: 120,
            },
          };
          await Promise.all([
            writeJson(join(runDirectory, `${prefix}-call-budget.json`), callBudget),
            writeJsonLines(join(runDirectory, `${prefix}-progress.jsonl`), e4Rows),
            writeJsonLines(
              join(runDirectory, `${prefix}-retrieval-packets.jsonl`),
              packets,
            ),
            writeJson(join(runDirectory, `${prefix}-model-usage-summary.json`), {
              reason: "not applicable",
              status: "not_applicable",
            }),
            writeJson(join(runDirectory, `${prefix}-report.json`), report),
            writeJson(join(runDirectory, `${prefix}-summary.json`), {
              benchmark,
              callBudget,
              caseCount: cases.length,
              comparison: null,
              endToEndScores: {},
              executionFailures: 0,
              experimentIdentityHash,
              identityHash,
              modelUsage: null,
              renderedContextMaxTokens: 120,
              replicate,
              stage,
              status: "not_evaluable",
            }),
          ]);
          continue;
        }

        const arms = stageArms(stage);
        const stageConfigurations = buildPhase74StageConfigurations(
          identity.configuration,
          stage,
        );
        const comparison = buildPhase74ReplicateComparison({
          benchmark,
          selectedCaseIdsSha256,
          stage,
        });
        const targetArms = comparisonArms(stage);
        const baselineScore = benchmark === "longmemeval" ? 0 : 0.4;
        const candidateDelta =
            stage === "E3" &&
              options.negativeE3Replicate?.benchmark === benchmark &&
              options.negativeE3Replicate.replicate === replicate
          ? -0.02
          : benchmark === "longmemeval" ? 0.04 : 0.02;
        const rows = cases.flatMap(({ caseId, clusterId }, caseIndex) =>
          arms.map((arm) => {
            const isCandidate = arm === targetArms.candidate;
            const rowDelta = options.unequalClusterE2 &&
                benchmark === "locomo" && stage === "E2"
              ? clusterId === "conversation-2" ? 0.6 : 0
              : candidateDelta;
            const score = benchmark === "longmemeval"
              ? Number(isCandidate && caseIndex === 0)
              : isCandidate ? baselineScore + rowDelta : baselineScore;
            return {
              answer: "answer",
              answerLatencyMs: isCandidate ? 30 : 25,
              arm,
              caseId,
              clusterId,
              configuration: stageConfigurations[arm],
              contextTokens: isCandidate ? 120 : 100,
              contextTokensBeforeTruncation: isCandidate ? 120 : 100,
              contextTruncated: false,
              correct: score === 1,
              productLatencyMs: isCandidate ? 110 : 100,
              recallLatencyMs: isCandidate ? 80 : 75,
              score,
              snapshotId: sha256(`${identity.runId}/${caseId}/${stage}/${arm}`),
              stage,
            };
          })
        );
        const ingestionRowsByKey = new Map<
          string,
          ReturnType<typeof ingestionUsageRows>
        >();
        const packets = rows.map((row) => {
          const comparisonBranch = phase74ExecutionBranch(stage, row.arm);
          const ingestionKey = comparisonBranch === "shadow"
            ? sha256(`${identity.runId}/${stage}/${row.arm}/ingestion`)
            : stage === "E1"
              ? sha256(`${identity.runId}/${stage}/${row.arm}/ingestion`)
              : sha256(`${identity.runId}/${stage}/shared-ingestion`);
          const representation = String(
            stageConfigurations[row.arm]?.representation ??
              identity.configuration.representation ??
              "atomic-contextual-raw-pointer",
          );
          const costTrace = {
            comparisonBranch,
            ingestionKey,
            representation,
          };
          if (comparisonBranch !== "shadow") {
            ingestionRowsByKey.set(
              ingestionKey,
              ingestionUsageRows(ingestionKey),
            );
          }
          const retrievedMemories = [{
            content: `evidence for ${row.caseId}`,
            id: `${row.caseId}-${row.arm}`,
            sourceIds: [],
          }];
          const storedMemories: unknown[] = [];
          const evidenceLedger = options.includeE3EvidenceLedger &&
              stage === "E3" && row.arm === "recall-plan-deterministic"
            ? [{
                evidenceId: `${row.caseId}-evidence`,
                excerpt: `evidence for ${row.caseId}`,
                relation: "supports" as const,
                sourceMemoryId: `${row.caseId}-${row.arm}`,
                temporalStatus: "current" as const,
              }]
            : undefined;
          const snapshotId = buildPhase74RetrievalSnapshotId({
            arm: row.arm,
            costTrace,
            evidenceLedger,
            evidenceLedgers: undefined,
            retrievedMemories,
            stage,
            storedMemories,
          });
          row.snapshotId = snapshotId;
          const attribution: Phase74EvaluationAttribution = {
            inputSha256: sha256(`${row.caseId}/${stage}/${row.arm}/reader-input`),
            observedAnswer: row.answer,
            observedCorrect: row.correct,
            observedScore: row.score,
            reused: false,
            sourceArm: row.arm,
            sourceSnapshotId: snapshotId,
          };
          Object.assign(row, { evaluationAttribution: attribution });
          return {
            costTrace,
            ...(evidenceLedger === undefined ? {} : { evidenceLedger }),
            evaluation: {
              answer: row.answer,
              answerLatencyMs: row.answerLatencyMs,
              attribution,
              contextTokens: row.contextTokens,
              contextTokensBeforeTruncation: row.contextTokensBeforeTruncation,
              contextTruncated: row.contextTruncated,
              correct: row.correct,
              productLatencyMs: row.productLatencyMs,
              recallLatencyMs: row.recallLatencyMs,
              score: row.score,
            },
            retrievedMemories,
            snapshotId,
            storedMemories,
          };
        });
        const directUsage = directUsageRows(caseKeys);
        const baselineIngestionKeys = [...new Set(packets
          .filter(({ costTrace }) => costTrace.comparisonBranch === "baseline")
          .map(({ costTrace }) => costTrace.ingestionKey))];
        const candidateIngestionKeys = [...new Set(packets
          .filter(({ costTrace }) => costTrace.comparisonBranch === "candidate")
          .map(({ costTrace }) => costTrace.ingestionKey))];
        const sharedKeys = baselineIngestionKeys.filter((key) =>
          candidateIngestionKeys.includes(key)
        );
        const ledgerForKey = (key: string) => {
          const usage = ingestionRowsByKey.get(key)!;
          return {
            key,
            ledger: validatePhase74ModelUsageLedger(usage),
          };
        };
        const modelUsage = buildPhase74ModelUsageEvidence({
          direct: validatePhase74ModelUsageLedger(directUsage),
          expected: {
            baselineCaseIds: caseKeys,
            candidateCaseIds: caseKeys,
          },
          ingestion: {
            baselineExclusive: baselineIngestionKeys
              .filter((key) => !sharedKeys.includes(key))
              .map(ledgerForKey),
            candidateExclusive: candidateIngestionKeys
              .filter((key) => !sharedKeys.includes(key))
              .map(ledgerForKey),
            shared: sharedKeys.map(ledgerForKey),
          },
        });
        const endToEndScores = Object.fromEntries(arms.map((arm) => {
          const armRows = rows.filter((row) => row.arm === arm);
          return [arm, {
            caseCount: armRows.length,
            meanFamilyScore:
              armRows.reduce((total, row) => total + row.score, 0) /
              armRows.length,
            scoredCaseCount: armRows.length,
            semanticAccuracy:
              armRows.filter(({ correct }) => correct).length / armRows.length,
          }];
        }));
        await Promise.all([
          writeJson(join(runDirectory, `${prefix}-call-budget.json`), callBudget),
          writeJsonLines(
            join(runDirectory, `${prefix}-model-usage.jsonl`),
            directUsage.events,
          ),
          writeJsonLines(
            join(runDirectory, `${prefix}-model-usage-intents.jsonl`),
            directUsage.intents,
          ),
          writeJsonLines(join(runDirectory, `${prefix}-progress.jsonl`), rows),
          writeJsonLines(
            join(runDirectory, `${prefix}-retrieval-packets.jsonl`),
            packets,
          ),
          writeJson(
            join(runDirectory, `${prefix}-model-usage-summary.json`),
            modelUsage,
          ),
          writeJson(join(runDirectory, `${prefix}-summary.json`), {
            benchmark,
            callBudget,
            caseCount: cases.length,
            comparison,
            endToEndScores,
            executionFailures: 0,
            experimentIdentityHash,
            identityHash,
            modelUsage,
            renderedContextMaxTokens: 120,
            replicate,
            stage,
            status: "not_evaluable",
          }),
          ...[...ingestionRowsByKey].flatMap(([key, usage]) => {
            const paths = buildPhase74IngestionUsagePaths(runDirectory, key);
            const ledger = validatePhase74ModelUsageLedger(usage);
            return [
              mkdir(join(runDirectory, "ingestion-usage", key), {
                recursive: true,
              }).then(() => writeJsonLines(paths.eventsPath, usage.events)),
              mkdir(join(runDirectory, "ingestion-usage", key), {
                recursive: true,
              }).then(() => writeJsonLines(paths.intentsPath, usage.intents)),
              mkdir(join(runDirectory, "ingestion", key), {
                recursive: true,
              }).then(() => writeJson(
                join(runDirectory, "ingestion", key, "manifest.json"),
                {
                  key,
                  schemaVersion: 8,
                  usage: buildPhase74IngestionUsageFingerprint(ledger),
                },
              )),
            ];
          }),
        ]);
      }
    }
  }
  return { protection, root, runDirectories };
}

async function writeProtectionArtifact(
  root: string,
  source = {
    id: `git:${"a".repeat(40)}`,
    sha256: "b".repeat(64),
  },
): Promise<{
  path: string;
  verifiers: Phase74ProtectionSuiteVerifier[];
}> {
  const path = join(root, "frozen-protection-suite.json");
  const descriptor = (id: string) => ({ id, sha256: sha256(id) });
  const e4Scores = (
    branch: "baseline" | "candidate",
  ): Phase74ProtectionSuiteBranchScores => {
    const scores = (format: (typeof FORMATS)[number]) => ({
      beam: branch === "baseline"
        ? 0.8
        : format === "json_locale_note"
          ? 0.78
          : 0.795,
      "memory-agent-bench": 0.8,
    });
    return {
      e4: {
        chronology: scores("chronology"),
        compact_json: scores("compact_json"),
        json_locale_note: scores("json_locale_note"),
        prose: scores("prose"),
      },
    };
  };
  const suites: Array<{
    caseCount: number;
    id: string;
    kind: Phase74ProtectionSuiteKind;
    requiredMetrics: string[];
    scores: (
      branch: "baseline" | "candidate",
    ) => Phase74ProtectionSuiteBranchScores;
  }> = [
    {
      caseCount: 2,
      id: "benchmark-protection",
      kind: "benchmark-protection",
      requiredMetrics: ["beam", "memory-agent-bench"],
      scores: (branch) => ({
        protections: {
          beam: branch === "baseline" ? 0.8 : 0.795,
          "memory-agent-bench": 0.8,
        },
      }),
    },
    {
      caseCount: 1,
      id: "e4-reader",
      kind: "e4",
      requiredMetrics: ["beam", "memory-agent-bench"],
      scores: e4Scores,
    },
    {
      caseCount: 3,
      id: "safety",
      kind: "safety",
      requiredMetrics: [
        "abstentionAccuracy",
        "hallucinationRate",
        "privacyPassRate",
        "updateCorrectness",
      ],
      scores: () => ({
        safety: {
          abstentionAccuracy: 0.9,
          hallucinationRate: 0.1,
          privacyPassRate: 1,
          updateCorrectness: 0.9,
        },
      }),
    },
  ];
  const runArtifactPaths: string[] = [];
  const manifestSuites: Phase74ProtectionSuiteManifest["suites"] = [];
  const verifiers: Phase74ProtectionSuiteVerifier[] = [];
  for (const suite of suites) {
    const datasetPath = join(root, `${suite.id}-dataset.json`);
    const datasetText = `${JSON.stringify({ suiteId: suite.id })}\n`;
    await writeFile(datasetPath, datasetText, "utf8");
    const dataset = {
      id: `${suite.id}:dataset`,
      path: datasetPath,
      sha256: sha256(datasetText),
    };
    const verifierId = `${suite.id}-test-verifier-v1`;
    const identity = {
      dataset: { id: dataset.id, sha256: dataset.sha256 },
      judge: descriptor(`${suite.id}:judge`),
      model: descriptor(`${suite.id}:model`),
      pipeline: descriptor(`${suite.id}:pipeline`),
      populationId: `${suite.id}:population`,
      prompt: descriptor(`${suite.id}:prompt`),
      source,
    };
    let identityHash = "";
    for (const replicate of [1, 2, 3] as const) {
      const directory = join(root, suite.id, `replicate-${replicate}`);
      const result = await runPhase74ProtectionSuiteCases({
        artifactPath: join(directory, "run.json"),
        cases: Array.from({ length: suite.caseCount }, (_, index) => ({
          caseId: `${suite.id}:case-${index + 1}`,
          input: { index },
        })),
        evaluate: async ({ branch }) => ({
          rawOutput: { branch, suiteId: suite.id },
          scores: suite.scores(branch),
        }),
        identity,
        rawArtifactPath: join(directory, "raw.json"),
        replicate,
        runId: `${suite.id}:run-${replicate}`,
        suite: { id: suite.id, kind: suite.kind },
      });
      identityHash = hashPhase74ProtectionSuiteIdentity(
        result.artifact.identity,
      );
      runArtifactPaths.push(result.artifactPath);
    }
    manifestSuites.push({
      dataset,
      id: suite.id,
      identityHash,
      kind: suite.kind,
      requiredMetrics: suite.requiredMetrics,
      verifierId,
    });
    verifiers.push({
      id: verifierId,
      kind: suite.kind,
      requiredMetrics: suite.requiredMetrics,
      suiteId: suite.id,
      verify: async ({ datasetBytes, run }) => {
        const parsed = JSON.parse(Buffer.from(datasetBytes).toString("utf8"));
        if (parsed.suiteId !== run.suite.id) {
          throw new Error("aggregate test verifier dataset drifted");
        }
      },
    });
  }
  const manifestPath = join(root, "protection-suite-manifest.json");
  await writeJson(manifestPath, {
    admission: "canonical-verifier-bound-v1",
    artifactKind: "phase74-protection-suite-manifest",
    schemaVersion: 2,
    suites: manifestSuites,
  } satisfies Phase74ProtectionSuiteManifest);
  await writeJson(path, await buildPhase74FrozenProtectionSuiteEvidence({
    manifestPath,
    runArtifactPaths,
  }, { verifiers }));
  return { path, verifiers };
}

describe("Phase 74 frozen artifact aggregation", () => {
  it("keeps stage diagnostic score deltas question-weighted for unequal LoCoMo clusters", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
      unequalClusterE2: true,
    });
    const report = await aggregatePhase74StageDiagnosticArtifacts({
      bootstrapSamples: 500,
      runDirectories: fixture.runDirectories.filter((path) =>
        path.includes("locomo-replicate-")
      ),
      seed: 74,
      stage: "E2",
    });

    expect(report.aggregation.aggregate.inference.delta).toBeCloseTo(0.2);
    for (const delta of report.aggregation.replicateStability.deltas) {
      expect(delta).toBeCloseTo(0.2);
    }
  });

  it("aggregates one deterministic stage from three frozen diagnostic replicates", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    await Promise.all(runDirectories.flatMap((runDirectory) => [
      rm(join(runDirectory, "e1-summary.json")),
      rm(join(runDirectory, "e3-summary.json")),
      rm(join(runDirectory, "e4-summary.json")),
    ]));

    const report = await aggregatePhase74StageDiagnosticArtifacts({
      bootstrapSamples: 500,
      runDirectories,
      seed: 74,
      stage: "E2",
    });

    expect(report).toMatchObject({
      evidenceBoundary: "seen-case-stage-ablation-diagnostic",
      kind: "phase74-stage-only-diagnostic",
      promotionEvaluated: false,
      reason: "A selected single-stage ablation cannot authorize product promotion.",
      schemaVersion: 1,
      seenCasesOnly: true,
      status: "not_evaluable_for_promotion",
    });
    expect(report.aggregation).toMatchObject({
      benchmark: "locomo",
      caseCount: 3,
      clusterCount: 2,
      replicateStability: { direction: "consistent_positive" },
      stage: "E2",
    });
    expect(report.inputs).toHaveLength(3);
    expect(report.aggregation.aggregate.inference.delta).toBeCloseTo(0.02);
    expect(report.aggregation.modelUsage).toMatchObject({
      accountingVersion: "phase74-model-usage-v2",
      allocationPolicy: "standalone-full-shared-v1",
      baseline: {
        pendingRequestCount: 0,
        requestCount: 12,
        totalTokens: 1_050,
      },
      candidate: {
        pendingRequestCount: 0,
        requestCount: 12,
        totalTokens: 1_140,
      },
      costBoundary: "full-product",
      ingestion: {
        shared: {
          keyCount: 3,
          operationCounts: { assisted_extraction: 3 },
          pendingRequestCount: 0,
          requestCount: 3,
          totalTokens: 150,
        },
      },
    });
    expect(report.aggregation.modelUsage.ingestion.shared.keysSha256)
      .toMatch(/^[a-f0-9]{64}$/);
    const virtualSharedKeys = await Promise.all(runDirectories.map(
      async (runDirectory) => {
        const identity = JSON.parse(await readFile(
          join(runDirectory, "run-identity.json"),
          "utf8",
        ));
        const packets = (await readFile(
          join(runDirectory, "e2-retrieval-packets.jsonl"),
          "utf8",
        )).trim().split("\n").map((line) => JSON.parse(line));
        const sharedKey = packets.find(({ costTrace }) =>
          costTrace.comparisonBranch === "baseline"
        ).costTrace.ingestionKey;
        return {
          artifactIdentityHash: hashEvalRunIdentity(identity),
          benchmark: "locomo",
          keyCount: 1,
          keysSha256: sha256(JSON.stringify([sharedKey])),
          replicate: identity.configuration.replicate,
        };
      },
    ));
    virtualSharedKeys.sort((left, right) =>
      left.artifactIdentityHash.localeCompare(right.artifactIdentityHash)
    );
    expect(report.aggregation.modelUsage.ingestion.shared.keysSha256)
      .toBe(sha256(JSON.stringify(virtualSharedKeys)));

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories: runDirectories.slice(0, 2),
      stage: "E2",
    })).rejects.toThrow("exactly three run directories");
  });

  it("rejects a stage progress row whose product configuration was tampered", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const progressPath = join(runDirectories[0]!, "e2-progress.jsonl");
    const rows = (await readFile(progressPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    rows[0].configuration = { tampered: true };
    await writeJsonLines(progressPath, rows);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("progress configuration drift");
  });

  it("rejects raw model usage that does not reproduce the frozen summary", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const usagePath = join(runDirectories[0]!, "e2-model-usage.jsonl");
    const events = (await readFile(usagePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    events[0].usage.inputTokens += 1;
    await writeJsonLines(usagePath, events);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("raw model usage drift");
  });

  it("requires the exact v2 full-product usage schema", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const runDirectory = runDirectories[0]!;
    const summaryPath = join(runDirectory, "e2-summary.json");
    const persistedPath = join(runDirectory, "e2-model-usage-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.modelUsage.legacyAllocation = true;
    await writeJson(summaryPath, summary);
    await writeJson(persistedPath, summary.modelUsage);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("unsupported field");
  });

  it("fails closed on pending, orphan, and duplicate direct usage WAL rows", async () => {
    for (const corruption of ["pending", "orphan", "duplicate"] as const) {
      const fixture = await createArtifactFixture({
        admission: "deterministic-reranker",
        subsetSelection: true,
      });
      const runDirectories = fixture.runDirectories.filter((path) =>
        path.includes("locomo-replicate-")
      );
      const runDirectory = runDirectories[0]!;
      const intentsPath = join(runDirectory, "e2-model-usage-intents.jsonl");
      const intents = (await readFile(intentsPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      if (corruption === "pending") {
        intents.push({
          ...intents[0],
          requestId: "pending-request",
        });
      } else if (corruption === "orphan") {
        intents.shift();
      } else {
        intents.push({ ...intents[0] });
      }
      await writeJsonLines(intentsPath, intents);

      await expect(aggregatePhase74StageDiagnosticArtifacts({
        runDirectories,
        stage: "E2",
      })).rejects.toThrow(
        corruption === "pending"
          ? "pending requests"
          : corruption === "orphan"
            ? "terminal without intent"
            : "duplicate intent",
      );
    }
  });

  it("fails closed when retrieval cost provenance or its ingestion ledger is missing", async () => {
    const missingPacketFixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const missingPacketRuns = missingPacketFixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const missingPacketsPath = join(
      missingPacketRuns[0]!,
      "e2-retrieval-packets.jsonl",
    );
    const missingPackets = (await readFile(missingPacketsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    missingPackets.pop();
    await writeJsonLines(missingPacketsPath, missingPackets);
    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories: missingPacketRuns,
      stage: "E2",
    })).rejects.toThrow("retrieval packet population drift");

    const missingTraceFixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const missingTraceRuns = missingTraceFixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const packetsPath = join(missingTraceRuns[0]!, "e2-retrieval-packets.jsonl");
    const packets = (await readFile(packetsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    delete packets[0].costTrace;
    await writeJsonLines(packetsPath, packets);
    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories: missingTraceRuns,
      stage: "E2",
    })).rejects.toThrow("cost trace");

    const missingLedgerFixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const missingLedgerRuns = missingLedgerFixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const ledgerPackets = (await readFile(
      join(missingLedgerRuns[0]!, "e2-retrieval-packets.jsonl"),
      "utf8",
    )).trim().split("\n").map((line) => JSON.parse(line));
    const ingestionKey = ledgerPackets.find(({ costTrace }) =>
      costTrace.comparisonBranch === "baseline"
    ).costTrace.ingestionKey;
    await rm(join(missingLedgerRuns[0]!, "ingestion-usage", ingestionKey), {
      force: true,
      recursive: true,
    });
    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories: missingLedgerRuns,
      stage: "E2",
    })).rejects.toThrow("usage ledger");

    const driftFixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const driftRuns = driftFixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const driftPackets = (await readFile(
      join(driftRuns[0]!, "e2-retrieval-packets.jsonl"),
      "utf8",
    )).trim().split("\n").map((line) => JSON.parse(line));
    const driftKey = driftPackets.find(({ costTrace }) =>
      costTrace.comparisonBranch === "baseline"
    ).costTrace.ingestionKey;
    const manifestPath = join(
      driftRuns[0]!,
      "ingestion",
      driftKey,
      "manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.usage.eventCount = 0;
    await writeJson(manifestPath, manifest);
    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories: driftRuns,
      stage: "E2",
    })).rejects.toThrow("ingestion manifest drift");
  });

  it("binds the model usage cost boundary to the frozen run identity", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      costBoundary: "query-only",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("costBoundary drift");
  });

  it("rejects incomplete baseline or candidate model usage", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const runDirectory = runDirectories[0]!;
    const usagePath = join(runDirectory, "e2-model-usage.jsonl");
    const events = (await readFile(usagePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const baselineEvent = events.find(({ branch }) => branch === "baseline");
    baselineEvent.completeness = "missing";
    for (const key of Object.keys(baselineEvent.usage)) {
      baselineEvent.usage[key] = null;
    }
    await writeJsonLines(usagePath, events);

    const summaryPath = join(runDirectory, "e2-summary.json");
    const usageSummaryPath = join(runDirectory, "e2-model-usage-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.modelUsage.baseline.completeRequestCount -= 1;
    summary.modelUsage.baseline.missingRequestCount += 1;
    summary.modelUsage.baseline.totalTokens -= 100;
    await writeJson(summaryPath, summary);
    await writeJson(usageSummaryPath, summary.modelUsage);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("incomplete model usage");
  });

  it("rejects a retrieval packet whose committed evaluation was tampered", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const packetsPath = join(runDirectories[0]!, "e2-retrieval-packets.jsonl");
    const packets = (await readFile(packetsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    packets[0].evaluation.score = 0.99;
    await writeJsonLines(packetsPath, packets);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("retrieval packet evaluation drift");
  });

  it("accepts an E3 retrieval packet whose typed ledger is bound into its hash", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      includeE3EvidenceLedger: true,
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );

    const report = await aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E3",
    });

    expect(report.aggregation.caseCount).toBe(3);

    const packetsPath = join(runDirectories[0]!, "e3-retrieval-packets.jsonl");
    const packets = (await readFile(packetsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const ledgerPacket = packets.find(({ evidenceLedger }) => evidenceLedger);
    ledgerPacket.evidenceLedger[0].excerpt += " tampered";
    await writeJsonLines(packetsPath, packets);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E3",
    })).rejects.toThrow("retrieval packet hash drift");
  });

  it("accepts content-addressed snapshots shared by multiple cases", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const runDirectory = runDirectories[0]!;
    const progressPath = join(runDirectory, "e2-progress.jsonl");
    const rows = (await readFile(progressPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const first = rows[0];
    const second = rows.find(({ arm, caseId }) =>
      arm === first.arm && caseId !== first.caseId
    );
    const secondSnapshotId = second.snapshotId;
    second.snapshotId = first.snapshotId;
    second.evaluationAttribution.sourceSnapshotId = first.snapshotId;
    await writeJsonLines(progressPath, rows);

    const packetsPath = join(runDirectory, "e2-retrieval-packets.jsonl");
    const packets = (await readFile(packetsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const firstPacket = packets.find(({ snapshotId }) =>
      snapshotId === first.snapshotId
    );
    const secondPacket = packets.find(({ snapshotId }) =>
      snapshotId === secondSnapshotId
    );
    secondPacket.retrievedMemories = firstPacket.retrievedMemories;
    secondPacket.storedMemories = firstPacket.storedMemories;
    secondPacket.snapshotId = firstPacket.snapshotId;
    secondPacket.evaluation.attribution.sourceSnapshotId = firstPacket.snapshotId;
    await writeJsonLines(packetsPath, packets);

    const report = await aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    });
    expect(report.aggregation.caseCount).toBe(3);
  });

  it("rejects different scores attributed to an identical reader input", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const progressPath = join(runDirectories[0]!, "e2-progress.jsonl");
    const rows = (await readFile(progressPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const baseline = rows.find(({ arm }) => arm === "claim-temporal-off");
    const candidate = rows.find(({ arm, caseId }) =>
      arm === "claim-temporal-on" && caseId === baseline.caseId
    );
    candidate.evaluationAttribution = {
      ...candidate.evaluationAttribution,
      inputSha256: baseline.evaluationAttribution.inputSha256,
      reused: true,
      sourceArm: baseline.arm,
      sourceSnapshotId: baseline.snapshotId,
    };
    await writeJsonLines(progressPath, rows);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("identical reader input assessment drift");
  });

  it("rejects score and correctness pairs that violate the frozen family scorer", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("locomo-replicate-")
    );
    const runDirectory = runDirectories[0]!;
    const progressPath = join(runDirectory, "e2-progress.jsonl");
    const rows = (await readFile(progressPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    rows[0].correct = true;
    await writeJsonLines(progressPath, rows);

    const packetsPath = join(runDirectory, "e2-retrieval-packets.jsonl");
    const packets = (await readFile(packetsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    packets.find(({ snapshotId }) => snapshotId === rows[0].snapshotId)
      .evaluation.correct = true;
    await writeJsonLines(packetsPath, packets);

    const summaryPath = join(runDirectory, "e2-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    const armRows = rows.filter(({ arm }) => arm === rows[0].arm);
    summary.endToEndScores[rows[0].arm].semanticAccuracy =
      armRows.filter(({ correct }) => correct).length / armRows.length;
    await writeJson(summaryPath, summary);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("score/correctness drift");
  });

  it("rejects fractional LongMemEval scores even when binary correctness agrees", async () => {
    const fixture = await createArtifactFixture({
      admission: "deterministic-reranker",
      subsetSelection: true,
    });
    const runDirectories = fixture.runDirectories.filter((path) =>
      path.includes("longmemeval-replicate-")
    );
    const runDirectory = runDirectories[0]!;
    const progressPath = join(runDirectory, "e2-progress.jsonl");
    const rows = (await readFile(progressPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    rows[0].score = 0.5;
    rows[0].correct = false;
    await writeJsonLines(progressPath, rows);

    const packetsPath = join(runDirectory, "e2-retrieval-packets.jsonl");
    const packets = (await readFile(packetsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const packet = packets.find(({ snapshotId }) => snapshotId === rows[0].snapshotId);
    packet.evaluation.score = 0.5;
    packet.evaluation.correct = false;
    await writeJsonLines(packetsPath, packets);

    const summaryPath = join(runDirectory, "e2-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    const armRows = rows.filter(({ arm }) => arm === rows[0].arm);
    summary.endToEndScores[rows[0].arm].meanFamilyScore =
      armRows.reduce((total, { score }) => total + score, 0) / armRows.length;
    summary.endToEndScores[rows[0].arm].semanticAccuracy =
      armRows.filter(({ correct }) => correct).length / armRows.length;
    await writeJson(summaryPath, summary);

    await expect(aggregatePhase74StageDiagnosticArtifacts({
      runDirectories,
      stage: "E2",
    })).rejects.toThrow("score/correctness drift");
  });

  it("derives repeated statistics and blocks seen-case evidence from promotion", async () => {
    const fixture = await createArtifactFixture();
    const protectionArtifactPath = fixture.protection.path;

    const report = await aggregatePhase74GeneralizationArtifacts({
      bootstrapSamples: 500,
      promotionStage: "E3",
      protectionArtifactPath,
      runDirectories: fixture.runDirectories,
      seed: 74,
    }, { protectionVerifiers: fixture.protection.verifiers });

    expect(report.stageAggregations).toHaveLength(6);
    const locomoE3 = report.stageAggregations.find(
      ({ benchmark, stage }) => benchmark === "locomo" && stage === "E3",
    );
    expect(locomoE3).toMatchObject({
      caseCount: 3,
      clusterCount: 2,
      latency: {
        baselineP95Ms: 100,
        candidateP95Ms: 110,
      },
    });
    expect(locomoE3?.aggregate.inference.delta).toBeCloseTo(0.02);
    expect(locomoE3?.aggregate.inference).toMatchObject({
      replicateCount: 3,
      samplingUnit: "replicate-and-cluster",
    });
    expect(locomoE3?.perCase[0]?.baselineMean).toBeCloseTo(0.4);
    expect(locomoE3?.perCase[0]?.candidateMean).toBeCloseTo(0.42);
    expect(locomoE3?.perCase[0]?.delta).toBeCloseTo(0.02);
    expect(locomoE3?.aggregate.mcnemarByReplicate).toHaveLength(3);
    expect(report.e4).toMatchObject({
      selectedFormat: "chronology",
      status: "evaluated",
    });
    expect(report.e4.formats.find(({ format }) => format === "chronology"))
      .toMatchObject({ averageTokens: 80, macroScore: 0.835 });
    expect(report.promotion.status).toBe("not_evaluable");
    expect(report.promotion.gaps.join(" ")).toContain("seen-case");
  });

  it("fails closed on comparison drift, missing cluster identity, and missing latency", async () => {
    const fixture = await createArtifactFixture();
    const runDirectory = fixture.runDirectories[0]!;
    const summaryPath = join(runDirectory, "e2-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.comparison.candidateArm = "recall-plan-deterministic";
    await writeJson(summaryPath, summary);

    await expect(aggregatePhase74GeneralizationArtifacts({
      runDirectories: fixture.runDirectories,
    })).rejects.toThrow("comparison arms");

    summary.comparison.candidateArm = "claim-temporal-on";
    await writeJson(summaryPath, summary);
    const progressPath = join(runDirectory, "e2-progress.jsonl");
    const progress = (await readFile(progressPath, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line));
    delete progress[0].clusterId;
    await writeJsonLines(progressPath, progress);
    await expect(aggregatePhase74GeneralizationArtifacts({
      runDirectories: fixture.runDirectories,
    })).rejects.toThrow("clusterId");

    progress[0].clusterId = "lme-q1";
    delete progress[0].productLatencyMs;
    await writeJsonLines(progressPath, progress);
    await expect(aggregatePhase74GeneralizationArtifacts({
      runDirectories: fixture.runDirectories,
    })).rejects.toThrow("productLatencyMs");
  });

  it("rejects identities that do not satisfy scoring, reranker, and selection admission", async () => {
    for (const [admission, message] of [
      ["legacy", "admission"],
      ["deterministic-reranker", "reranker"],
      ["noncanonical-scorer", "scoring"],
      ["missing-embedding", "missing embedding"],
      ["missing-evaluator-source", "missing evaluatorSource"],
      ["missing-provider-object-calls", "missing providerObjectCalls"],
    ] as const) {
      const fixture = await createArtifactFixture({ admission });
      await expect(aggregatePhase74GeneralizationArtifacts({
        runDirectories: fixture.runDirectories,
      })).rejects.toThrow(message);
    }
  });

  it("rejects fixed model, prompt, and budget identity drift across benchmark families", async () => {
    const fixture = await createArtifactFixture({
      crossFamilyCallBudgetDrift: true,
    });

    await expect(aggregatePhase74GeneralizationArtifacts({
      runDirectories: fixture.runDirectories,
    })).rejects.toThrow("fixed cross-family identity drift");
  });

  it("rejects protection suites produced from a different evaluator source", async () => {
    const fixture = await createArtifactFixture({
      protectionEvaluatorSourceMismatch: true,
    });
    const protectionArtifactPath = fixture.protection.path;

    await expect(aggregatePhase74GeneralizationArtifacts({
      protectionArtifactPath,
      runDirectories: fixture.runDirectories,
    }, { protectionVerifiers: fixture.protection.verifiers })).rejects.toThrow(
      "protection evaluator source does not match",
    );
  });

  it("rejects a post-hoc replacement blueprint even when evaluator source matches", async () => {
    const fixture = await createArtifactFixture();
    const replacementRoot = await mkdtemp(join(
      tmpdir(),
      "goodmemory-phase74-replacement-protection-",
    ));
    roots.push(replacementRoot);
    const replacement = await writeProtectionArtifact(replacementRoot);

    await expect(aggregatePhase74GeneralizationArtifacts({
      protectionArtifactPath: replacement.path,
      runDirectories: fixture.runDirectories,
    }, { protectionVerifiers: replacement.verifiers })).rejects.toThrow(
      "protection blueprint does not match the pre-bound main run identity",
    );
  });

  it("reports explicit blockers for legacy E4 scores and missing protection", async () => {
    const fixture = await createArtifactFixture({
      includeE4Scores: false,
    });

    const report = await aggregatePhase74GeneralizationArtifacts({
      promotionStage: "E3",
      runDirectories: fixture.runDirectories,
    }, { protectionVerifiers: fixture.protection.verifiers });

    expect(report.e4.status).toBe("not_evaluable");
    expect(report.e4.gaps.join(" ")).toContain("per-case score");
    expect(report.e4.gaps.join(" ")).toContain("protection artifact");
    expect(report.promotion.status).toBe("not_evaluable");
    expect(report.promotion.gaps.join(" ")).toContain("seen-case");
    expect(report.promotion.gaps.join(" ")).toContain("protection artifact");
  });

  it("aggregates a case-consistent subset but never promotes it as a full-family result", async () => {
    const fixture = await createArtifactFixture({ subsetSelection: true });
    const protectionArtifactPath = fixture.protection.path;
    const report = await aggregatePhase74GeneralizationArtifacts({
      promotionStage: "E3",
      protectionArtifactPath,
      runDirectories: fixture.runDirectories,
    }, { protectionVerifiers: fixture.protection.verifiers });

    expect(report.stageAggregations).toHaveLength(6);
    expect(report.promotion.status).toBe("not_evaluable");
    expect(report.promotion.gaps.join(" ")).toContain("selected subset");
  });

  it("blocks promotion when one independent replicate reverses direction", async () => {
    const fixture = await createArtifactFixture({
      negativeE3Replicate: { benchmark: "locomo", replicate: 3 },
    });
    const protectionArtifactPath = fixture.protection.path;

    const report = await aggregatePhase74GeneralizationArtifacts({
      bootstrapSamples: 500,
      promotionStage: "E3",
      protectionArtifactPath,
      runDirectories: fixture.runDirectories,
      seed: 74,
    }, { protectionVerifiers: fixture.protection.verifiers });

    const locomoE3 = report.stageAggregations.find(
      ({ benchmark, stage }) => benchmark === "locomo" && stage === "E3",
    );
    expect(locomoE3?.replicateStability.direction).toBe("mixed");
    expect(locomoE3?.replicateStability.deltas[0]).toBeCloseTo(0.02);
    expect(locomoE3?.replicateStability.deltas[1]).toBeCloseTo(0.02);
    expect(locomoE3?.replicateStability.deltas[2]).toBeCloseTo(-0.02);
    expect(locomoE3?.aggregate.inference.lower).toBeLessThanOrEqual(0);
    expect(report.promotion.status).toBe("not_evaluable");
    expect(report.promotion.gaps.join(" ")).toContain(
      "each of the three independent replicates",
    );
  });

  it("rejects protection artifacts that contain derivable promotion fields", async () => {
    const fixture = await createArtifactFixture();
    const protectionArtifactPath = fixture.protection.path;
    const protection = JSON.parse(await readFile(protectionArtifactPath, "utf8"));
    protection.promotion.families = [];
    await writeJson(protectionArtifactPath, protection);

    await expect(aggregatePhase74GeneralizationArtifacts({
      promotionStage: "E3",
      protectionArtifactPath,
      runDirectories: fixture.runDirectories,
    }, { protectionVerifiers: fixture.protection.verifiers })).rejects.toThrow(
      "does not match its manifest and source runs",
    );
  });

  it("rejects cross-stage, E4, and model-usage population drift", async () => {
    const stageFixture = await createArtifactFixture();
    const stageRun = stageFixture.runDirectories[0]!;
    const e3ProgressPath = join(stageRun, "e3-progress.jsonl");
    const e3Progress = (await readFile(e3ProgressPath, "utf8")).trim()
      .split("\n").map((line) => JSON.parse(line));
    const driftedCaseId = e3Progress[0].caseId;
    for (const row of e3Progress) {
      if (row.caseId === driftedCaseId) {
        row.clusterId = "drifted-cluster";
      }
    }
    await writeJsonLines(e3ProgressPath, e3Progress);
    await expect(aggregatePhase74GeneralizationArtifacts({
      runDirectories: stageFixture.runDirectories,
    })).rejects.toThrow("cluster population drifted from E1");

    const e4Fixture = await createArtifactFixture();
    const e4Run = e4Fixture.runDirectories[0]!;
    const e4ProgressPath = join(e4Run, "e4-progress.jsonl");
    const e4Progress = (await readFile(e4ProgressPath, "utf8")).trim()
      .split("\n").map((line) => JSON.parse(line));
    const e4CaseId = e4Progress[0].caseId;
    for (const row of e4Progress) {
      if (row.caseId === e4CaseId) {
        row.clusterId = "drifted-e4-cluster";
      }
    }
    await writeJsonLines(e4ProgressPath, e4Progress);
    const e4ReportPath = join(e4Run, "e4-report.json");
    const e4Report = JSON.parse(await readFile(e4ReportPath, "utf8"));
    e4Report.e4.cases = e4Progress;
    await writeJson(e4ReportPath, e4Report);
    await expect(aggregatePhase74GeneralizationArtifacts({
      runDirectories: e4Fixture.runDirectories,
    })).rejects.toThrow("E4 cluster population drifted from retrieval stages");

    const usageFixture = await createArtifactFixture();
    const usageRun = usageFixture.runDirectories[0]!;
    const usageSummaryPath = join(usageRun, "e2-summary.json");
    const usageFilePath = join(usageRun, "e2-model-usage-summary.json");
    const usageSummary = JSON.parse(await readFile(usageSummaryPath, "utf8"));
    usageSummary.modelUsage.baseline.unobservedCaseIds = ["unknown-case"];
    await writeJson(usageSummaryPath, usageSummary);
    await writeJson(usageFilePath, usageSummary.modelUsage);
    await expect(aggregatePhase74GeneralizationArtifacts({
      runDirectories: usageFixture.runDirectories,
    })).rejects.toThrow("non-opaque unobserved case");
  });

  it("creates aggregate output exactly once without replacing existing bytes", async () => {
    const fixture = await createArtifactFixture();
    const outputPath = join(fixture.root, "aggregate", "existing.json");
    await mkdir(join(fixture.root, "aggregate"), { recursive: true });
    await writeFile(outputPath, "existing aggregate\n", "utf8");

    await expect(runPhase74GeneralizationAggregation({
      outputPath,
      runDirectories: fixture.runDirectories,
    })).rejects.toThrow();
    expect(await readFile(outputPath, "utf8")).toBe("existing aggregate\n");
  });

  it("refuses aggregate output over protection evidence or any frozen source", async () => {
    const fixture = await createArtifactFixture();
    const protectionArtifactPath = fixture.protection.path;
    const protection = JSON.parse(await readFile(
      protectionArtifactPath,
      "utf8",
    ));
    const sourceFile = protection.source.suites[0].files[0];
    const protectedPaths = [
      protectionArtifactPath,
      protection.source.manifest.path,
      sourceFile.artifactPath,
      sourceFile.rawArtifactPath,
    ];

    for (const outputPath of protectedPaths) {
      await expect(runPhase74GeneralizationAggregation({
        outputPath,
        protectionArtifactPath,
        runDirectories: fixture.runDirectories,
      }, { protectionVerifiers: fixture.protection.verifiers })).rejects.toThrow(
        "--output must not overwrite",
      );
    }
  });

  it("writes a reproducible report and parses strict paths", async () => {
    const fixture = await createArtifactFixture();
    const outputPath = join(fixture.root, "aggregate", "report.json");
    const options = parsePhase74AggregationCliOptions([
      "bun",
      "scripts/aggregate-phase-74-generalization.ts",
      ...fixture.runDirectories.flatMap((path) => ["--run-dir", path]),
      "--output",
      outputPath,
      "--promotion-stage",
      "E3",
    ]);
    expect(options.runDirectories).toEqual(fixture.runDirectories);

    await runPhase74GeneralizationAggregation(options);
    const persisted = JSON.parse(await readFile(outputPath, "utf8"));
    expect(persisted.schemaVersion).toBe(1);

    expect(() => parsePhase74AggregationCliOptions([
      "--run-dir",
      fixture.runDirectories[0]!,
      "--run-dir",
      fixture.runDirectories[0]!,
      "--output",
      outputPath,
    ])).toThrow("duplicate");
    expect(() => parsePhase74AggregationCliOptions([
      ...fixture.runDirectories.flatMap((path) => ["--run-dir", path]),
      "--output",
      outputPath,
      "--unknown",
      "value",
    ])).toThrow("unknown option");
    expect(() => parsePhase74AggregationCliOptions([
      ...fixture.runDirectories.flatMap((path) => ["--run-dir", path]),
      "--output",
      outputPath,
      "stray-value",
    ])).toThrow("unexpected positional argument");
  });
});
