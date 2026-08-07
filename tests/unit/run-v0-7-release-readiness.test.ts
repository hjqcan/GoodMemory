import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildV073FullClaimCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
} from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
import {
  renderV073FullClaimCommand,
  V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
  V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
} from "../../scripts/run-v0-7-3-full-locomo-claim";
import { frozenV073LocomoQuestionSelection } from "../fixtures/v0-7-3-locomo-question-selection";

import type { V07ReleaseReadinessReport } from "../../scripts/run-v0-7-release-readiness";
import {
  evaluateV07RuntimeVersions,
  evaluateV07SourceIdentity,
  evaluateV07SourceStability,
  evaluateV073LifecycleProtectionArtifact,
  evaluateV073LifecycleProtectionArtifactFile,
  evaluateV073LifecycleProtectionSourceDrift,
  evaluateV073CurrentLocomoClaimState,
  evaluateStableLocomoCandidateLink,
  evaluateVersionConsistency,
  evaluateV07RequiredEnvironment,
  evaluateV07PackManifest,
  evaluateV07RequiredChecks,
  parseV07ReleaseReadinessCliOptions,
  renderV07LanguageConsumerSmoke,
  renderV07ReleaseSummary,
  summarizeCommandFailureOutput,
  stableLocomoClaimIssues,
  validateStableLocomoClaimEvidence,
  V07_RELEASE_REQUIRED_COMMANDS,
} from "../../scripts/run-v0-7-release-readiness";

const CLAIM_RECIPE_RAW = readFileSync(
  new URL("../../benchmark-claims/locomo.json", import.meta.url),
  "utf8",
);
const CLAIM_RECIPE_COMMAND = (
  JSON.parse(CLAIM_RECIPE_RAW) as { run: { command: string } }
).run.command;

function report(
  overrides: Partial<V07ReleaseReadinessReport> = {},
): V07ReleaseReadinessReport {
  return {
    allRequiredPassed: false,
    checks: [
      {
        detail: "package is 0.7.3",
        durationMs: 1,
        id: "version",
        required: true,
        status: "pass",
        title: "Version consistency",
      },
      {
        detail: "tarball is too large | 4194305 bytes",
        durationMs: 1,
        id: "pack",
        required: true,
        status: "fail",
        title: "Package manifest and size",
      },
    ],
    generatedAt: "2026-07-21T00:00:00.000Z",
    generatedBy: "scripts/run-v0-7-release-readiness.ts",
    packageVersion: "0.7.3",
    runtime: {
      bunVersion: "1.3.14",
      nodeVersion: "v20.19.0",
    },
    sourceIdentity: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    },
    summary: { failed: 1, passed: 1, skipped: 0, total: 2 },
    ...overrides,
  };
}

function evidenceIdentity(path: string, raw: string) {
  return {
    bytes: Buffer.byteLength(raw, "utf8"),
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

async function rewriteTrackedEvidence(input: {
  kind: string;
  projection: { sourceArtifacts: Array<Record<string, unknown>> };
  raw: string;
  repoRoot: string;
}): Promise<void> {
  const source = input.projection.sourceArtifacts.find(
    (artifact) => artifact.kind === input.kind,
  );
  if (!source || typeof source.path !== "string") {
    throw new Error(`missing ${input.kind} fixture artifact`);
  }
  await writeFile(join(input.repoRoot, source.path), input.raw, "utf8");
  Object.assign(source, evidenceIdentity(source.path, input.raw));
}

async function writeValidCurrentLocomoEvidence(
  repoRoot: string,
  options: { officialProgressRaw?: string } = {},
) {
  const prefix = "reports/release/v0.7/v0.7.3-locomo-claim-evidence";
  const caseIds = [
    "locomo-conv-26",
    "locomo-conv-30",
    "locomo-conv-41",
    "locomo-conv-42",
    "locomo-conv-43",
    "locomo-conv-44",
    "locomo-conv-47",
    "locomo-conv-48",
    "locomo-conv-49",
    "locomo-conv-50",
  ];
  const rows = frozenV073LocomoQuestionSelection().map((identity, index) => ({
    answerCorrect: index < 924,
    answerTokenF1: 0.7,
    ...identity,
    evidenceRecall: 1,
    evidenceTurnIds: [`turn-${index}`],
    executionFailureMessage: null,
    generatedAnswer: `answer-${index}`,
    goldEvidenceFullyRetrieved: true,
    missingEvidenceTurnIds: [],
    noiseTurnCount: 0,
    noiseTurnIds: [],
    retrievedTurnIds: [`turn-${index}`],
  }));
  const seedDirectory = join(repoRoot, "raw-runs/seed");
  const finalDirectory = join(repoRoot, "raw-runs/final");
  const benchmarkRoot = join(
    homedir(),
    ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
  );
  const common = {
    answerEvaluation: "scored",
    benchmark: "locomo",
    benchmarkFingerprint:
      "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
    caseCount: 10,
    caseIds,
    cases: rows,
    executionFailures: 0,
    mode: "live-answer",
    questionCount: 1540,
  };
  const seedReport = {
    ...common,
    generatedAt: "2026-08-06T10:00:00.000Z",
    generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
    resume: true,
    runDirectory: seedDirectory,
    runId: "current-seed",
  };
  const finalReport = {
    ...common,
    answerAccuracyOverall: 0.6,
    answerSystem: "locomo-live-category-aware-v1",
    generatedAt: "2026-08-06T11:00:00.000Z",
    generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
    resume: false,
    runDirectory: finalDirectory,
    runId: "current-final",
    sourceReport: {
      path: join(seedDirectory, "smoke-report.json"),
      runId: "current-seed",
    },
  };
  const seedRaw = JSON.stringify(seedReport);
  const finalRaw = JSON.stringify(finalReport);
  const officialCorrect = {
    multi_hop: 226,
    open_domain: 77,
    single_hop: 673,
    temporal: 257,
  };
  const officialCorrectTotal = Object.values(officialCorrect).reduce(
    (sum, value) => sum + value,
    0,
  );
  const officialSummary = {
    benchmark: "locomo",
    categories: {
      multi_hop: { accuracy: 226 / 282, correct: 226, total: 282 },
      open_domain: { accuracy: 77 / 96, correct: 77, total: 96 },
      single_hop: { accuracy: 673 / 841, correct: 673, total: 841 },
      temporal: { accuracy: 257 / 321, correct: 257, total: 321 },
    },
    generatedBy: "scripts/rescore-official-protocols.ts",
    judgeFailures: 0,
    judgeGateway: "https://ai.gurkiai.com/v1",
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    judgedCases: 1540,
    overallAccuracy: officialCorrectTotal / 1540,
    overallCorrect: officialCorrectTotal,
    outputPath: join(repoRoot, "raw-runs/official/rescore-summary.json"),
    protocol: "mem0ai/memory-benchmarks LoCoMo judge (no-evidence variant, categories 1-4)",
    runId: "current-official",
    selectedCases: 1540,
    sourceAnswersUnchanged: true,
    sourceCases: 1540,
    sourceInputFingerprints: {
      reportPath: evidenceIdentity("ignored", finalRaw),
      rootPath: {
        bytes: 2490457,
        sha256: "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28",
      },
    },
    sourceInputs: {
      reportPath: join(finalDirectory, "smoke-report.json"),
      rootPath: join(benchmarkRoot, "cases.json"),
    },
    totalCases: 1540,
  };
  const officialRaw = JSON.stringify(officialSummary);
  const officialSeen = new Map<string, number>();
  const officialProgressRaw = options.officialProgressRaw ?? `${rows.map((row) => {
    const index = officialSeen.get(row.category) ?? 0;
    officialSeen.set(row.category, index + 1);
    return JSON.stringify({
      correct:
        index < officialCorrect[row.category as keyof typeof officialCorrect],
      questionId: row.questionId,
    });
  }).join("\n")}\n`;
  const commandChain = buildV073FullClaimCommandChain({
    answerGateway: "https://ai.gurkiai.com/v1",
    answerModel: "gpt-5.6-terra",
    answerProvider: "openai",
    assistedExtractorGateway: "https://ai.gurkiai.com/v1",
    assistedExtractorModel: "gpt-5.6-terra",
    assistedExtractorProvider: "openai",
    benchmarkRoot,
    embeddingGateway: "https://openrouter.ai/api/v1",
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
    finalOutputPath: finalDirectory,
    finalRunId: "current-final",
    judgeGateway: "https://ai.gurkiai.com/v1",
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    officialRunId: "current-official",
    rerankingGateway: "https://ai.gurkiai.com/v1",
    rerankingModel: "gpt-5.6-terra",
    rerankingProvider: "openai",
    seedOutputPath: seedDirectory,
    seedRunId: "current-seed",
    worktreePath: repoRoot,
  }, CLAIM_RECIPE_RAW);
  const command = renderV073FullClaimCommand(commandChain, repoRoot);
  const officialRunnerRaw = "export const officialPrompt = 'current';\n";
  const execution = {
    answerGateway: "https://ai.gurkiai.com/v1",
    answerModel: "gpt-5.6-terra",
    answerProvider: "openai",
    assistedExtractorGateway: "https://ai.gurkiai.com/v1",
    assistedExtractorModel: "gpt-5.6-terra",
    assistedExtractorProvider: "openai",
    benchmarkFingerprint:
      "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
    benchmarkRootBytes: 2490457,
    benchmarkRootSha256:
      "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28",
    bunVersion: "1.3.14",
    claimCommandSha256: createHash("sha256").update(command).digest("hex"),
    claimCommandTemplateSha256:
      deriveV073ClaimCommandTemplateSha256(CLAIM_RECIPE_RAW),
    concurrency: 40,
    embeddingGateway: "https://openrouter.ai/api/v1",
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
    judgeGateway: "https://ai.gurkiai.com/v1",
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    officialSourceSha256: createHash("sha256").update(officialRunnerRaw).digest("hex"),
    promptSha256: deriveV073PromptSha256(),
    questionSelectionSha256: V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
    caseQuestionCounts: V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
    rerankingGateway: "https://ai.gurkiai.com/v1",
    rerankingModel: "gpt-5.6-terra",
    rerankingProvider: "openai",
  };
  const commit = "e".repeat(40);
  const receipt = {
    command,
    commandChain,
    commit,
    evidenceRepositoryBefore: {
      headCommit: commit,
      statusPorcelain: "",
    },
    execution,
    freshOutputEvidence: {
      finalOutputPathAbsentBeforeRun: true,
      officialOutputPathAbsentBeforeRun: true,
      seedOutputPathAbsentBeforeRun: true,
    },
    generatedBy: "v0.7.3-full-locomo-claim-launch",
    outputs: {
      finalReport: evidenceIdentity(
        join(finalDirectory, "smoke-report.json"),
        finalRaw,
      ),
      officialSummary: evidenceIdentity(officialSummary.outputPath, officialRaw),
      officialProgress: evidenceIdentity(
        join(repoRoot, "raw-runs/official/progress.jsonl"),
        officialProgressRaw,
      ),
      seedReport: evidenceIdentity(
        join(seedDirectory, "smoke-report.json"),
        seedRaw,
      ),
    },
    sources: {
      claimRecipe: evidenceIdentity(
        join(repoRoot, "benchmark-claims/locomo.json"),
        CLAIM_RECIPE_RAW,
      ),
      officialRunner: evidenceIdentity(
        join(repoRoot, "scripts/rescore-official-protocols.ts"),
        officialRunnerRaw,
      ),
    },
    schemaVersion: 1,
    worktreeProvenance: { headCommit: commit, statusPorcelain: "" },
  };
  const receiptRaw = JSON.stringify(receipt);
  const rawByKind = {
    "claim-recipe-source": CLAIM_RECIPE_RAW,
    "execution-receipt": receiptRaw,
    "final-report": finalRaw,
    "official-summary": officialRaw,
    "official-progress": officialProgressRaw,
    "official-runner-source": officialRunnerRaw,
    "seed-report": seedRaw,
  };
  const fileNames = {
    "claim-recipe-source": "claim-recipe-source.json",
    "execution-receipt": "execution-receipt.json",
    "final-report": "final-smoke-report.json",
    "official-summary": "official-rescore-summary.json",
    "official-progress": "official-progress.jsonl",
    "official-runner-source": "official-runner-source.ts",
    "seed-report": "seed-smoke-report.json",
  } as const;
  await mkdir(join(repoRoot, prefix), { recursive: true });
  const sourceArtifacts = await Promise.all(
    Object.entries(rawByKind).map(async ([kind, raw]) => {
      const path = `${prefix}/${fileNames[kind as keyof typeof fileNames]}`;
      await writeFile(join(repoRoot, path), raw, "utf8");
      return { ...evidenceIdentity(path, raw), kind };
    }),
  );
  const officialScore = officialCorrectTotal / 1540;
  const descriptorClaim = {
    claimDeclaration: "benchmark-claims/locomo.json",
    config: "full 10 conversations / 1540 questions",
    measuredPackageVersion: "0.7.3",
    metric: "independent official judge accuracy",
    name: "LoCoMo",
    reference: "benchmark-claims/evidence/locomo-v0.7.3-current.json",
    result: `official ${officialScore.toFixed(4)}; strict 0.6000; open-domain 77/96 (${(77 / 96).toFixed(4)})`,
    runtimeProfile: "recommended-current",
  };
  const projection = {
    artifactKind: "tracked-current-claim-projection",
    benchmark: "LoCoMo",
    claim: {
      answerSystem: "locomo-live-category-aware-v1",
      conversationCount: 10,
      executionFailures: 0,
      judgeFailures: 0,
      officialScore,
      openDomainCorrect: 77,
      openDomainScore: 77 / 96,
      openDomainTotal: 96,
      packageVersion: "0.7.3",
      questionCount: 1540,
      strictScore: 0.6,
    },
    descriptorClaim,
    evidenceRepositoryBefore: receipt.evidenceRepositoryBefore,
    execution,
    generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts",
    runIdentity: {
      commit,
      finalRunId: "current-final",
      officialRunId: "current-official",
      seedRunId: "current-seed",
    },
    schemaVersion: 1,
    sourceArtifacts,
  };
  const claimDeclaration = {
    benchmark: "LoCoMo",
    claimBoundary: { publicClaimAllowed: true, reason: "fresh current evidence" },
    comparison: {
      availability: "production-default",
      runtimeProfile: "recommended-current",
    },
    coverage: { complete: true },
    evidence: {
      artifacts: [{
        path: "benchmark-claims/evidence/locomo-v0.7.3-current.json",
      }],
    },
    metrics: { score: officialScore },
    model: {
      answerGateway: execution.answerGateway,
      answerModel: execution.answerModel,
      answerProvider: execution.answerProvider,
      judgeGateway: execution.judgeGateway,
      judgeModel: execution.judgeModel,
      judgeProvider: execution.judgeProvider,
      sameModelJudge: false,
    },
    run: {
      command,
      commit,
      executionFailures: 0,
      packageVersion: "0.7.3",
    },
    status: "candidate_public_claim",
  };
  return { claimDeclaration, projection };
}

describe("v0.7 release readiness", () => {
  it("allows release-candidate claims to stay empty until the full rerun", async () => {
    await expect(
      evaluateVersionConsistency(
        new URL("../..", import.meta.url).pathname,
      ),
    ).resolves.toEqual(expect.objectContaining({ status: "pass" }));
  });

  it("allows an RC with no current LoCoMo projection or bundle to remain pending", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-pending-"));
    try {
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("deep-validates a complete current LoCoMo bundle while still RC", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-rc-complete-"));
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
      await mkdir(join(repoRoot, "benchmark-claims/evidence"), { recursive: true });
      await writeFile(
        join(repoRoot, "benchmark-claims/evidence/locomo-v0.7.3-current.json"),
        JSON.stringify(evidence.projection),
        "utf8",
      );
      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        JSON.stringify(evidence.claimDeclaration),
        "utf8",
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("rejects either half of a partial current LoCoMo RC publication", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-rc-partial-"));
    try {
      await mkdir(join(repoRoot, "benchmark-claims/evidence"), { recursive: true });
      await writeFile(
        join(repoRoot, "benchmark-claims/evidence/locomo-v0.7.3-current.json"),
        "{}\n",
        "utf8",
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toContain(
        "current LoCoMo evidence is partial: projection and all seven tracked source artifacts must appear together",
      );

      await rm(join(repoRoot, "benchmark-claims"), { force: true, recursive: true });
      await mkdir(
        join(
          repoRoot,
          "reports/release/v0.7/.v0.7.3-locomo-claim-evidence.partial-interrupted",
        ),
        { recursive: true },
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toContain(
        "current LoCoMo evidence is partial: projection and all seven tracked source artifacts must appear together",
      );

      await rm(join(repoRoot, "reports"), { force: true, recursive: true });
      await mkdir(
        join(repoRoot, "reports/release/v0.7/v0.7.3-locomo-claim-evidence"),
        { recursive: true },
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toContain(
        "current LoCoMo evidence is partial: projection and all seven tracked source artifacts must appear together",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("requires a 0.7.3 LoCoMo declaration and tracked projection for stable", () => {
    expect(stableLocomoClaimIssues({
      claims: [],
      projection: undefined,
      releaseStatus: "release-candidate",
    })).toEqual([]);
    expect(stableLocomoClaimIssues({
      claims: [],
      projection: undefined,
      releaseStatus: "stable",
    })).toEqual([
      "stable release requires a current LoCoMo 0.7.3 declaration",
      expect.stringContaining("locomo-v0.7.3-current.json"),
    ]);
    const sourceArtifacts = [
      ["claim-recipe-source", "claim-recipe-source.json"],
      ["seed-report", "seed-smoke-report.json"],
      ["final-report", "final-smoke-report.json"],
      ["official-summary", "official-rescore-summary.json"],
      ["official-progress", "official-progress.jsonl"],
      ["official-runner-source", "official-runner-source.ts"],
      ["execution-receipt", "execution-receipt.json"],
    ].map(([kind, name]) => ({
      bytes: 100,
      kind,
      path: `reports/release/v0.7/v0.7.3-locomo-claim-evidence/${name}`,
      sha256: "a".repeat(64),
    }));
    const projection = {
      artifactKind: "tracked-current-claim-projection",
      benchmark: "LoCoMo",
      claim: {
        answerSystem: "locomo-live-category-aware-v1",
        conversationCount: 10,
        executionFailures: 0,
        judgeFailures: 0,
        officialScore: 0.8,
        openDomainCorrect: 67,
        openDomainScore: 67 / 96,
        openDomainTotal: 96,
        packageVersion: "0.7.3",
        questionCount: 1540,
        strictScore: 0.6,
      },
      descriptorClaim: {
        claimDeclaration: "benchmark-claims/locomo.json",
        config: "full 10 conversations / 1540 questions",
        measuredPackageVersion: "0.7.3",
        metric: "independent official judge accuracy",
        name: "LoCoMo",
        reference: "benchmark-claims/evidence/locomo-v0.7.3-current.json",
        result: "official 0.8000; strict 0.6000; open-domain 67/96 (0.6979)",
        runtimeProfile: "recommended-current",
      },
      evidenceRepositoryBefore: {
        headCommit: "e".repeat(40),
        statusPorcelain: "",
      },
      execution: {
        answerGateway: "https://ai.gurkiai.com/v1",
        answerModel: "gpt-5.6-terra",
        answerProvider: "openai",
        assistedExtractorGateway: "https://ai.gurkiai.com/v1",
        assistedExtractorModel: "gpt-5.6-terra",
        assistedExtractorProvider: "openai",
        benchmarkFingerprint: "b".repeat(64),
        benchmarkRootBytes: 2490457,
        benchmarkRootSha256: "c".repeat(64),
        bunVersion: "1.3.14",
        claimCommandSha256: "d".repeat(64),
        claimCommandTemplateSha256: "1".repeat(64),
        concurrency: 40,
        embeddingGateway: "https://openrouter.ai/api/v1",
        embeddingModel: "text-embedding-3-small",
        embeddingProvider: "openai",
        judgeGateway: "https://ai.gurkiai.com/v1",
        judgeModel: "gpt-5.5",
        judgeProvider: "openai",
        officialSourceSha256: "f".repeat(64),
        promptSha256: deriveV073PromptSha256(),
        questionSelectionSha256: V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
        caseQuestionCounts: V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
        rerankingGateway: "https://ai.gurkiai.com/v1",
        rerankingModel: "gpt-5.6-terra",
        rerankingProvider: "openai",
      },
      generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts",
      runIdentity: {
        commit: "e".repeat(40),
        finalRunId: "final",
        officialRunId: "official",
        seedRunId: "seed",
      },
      schemaVersion: 1,
      sourceArtifacts,
    };
    expect(stableLocomoClaimIssues({
      claims: [{ measuredPackageVersion: "0.7.3", name: "LoCoMo" }],
      projection,
      releaseStatus: "stable",
    })).toEqual([]);
    expect(stableLocomoClaimIssues({
      claims: [{ measuredPackageVersion: "0.7.3", name: "LoCoMo" }],
      projection: {
        ...projection,
        evidenceRepositoryBefore: {
          ...projection.evidenceRepositoryBefore,
          statusPorcelain: " M benchmark-claims/locomo.json\n",
        },
      },
      releaseStatus: "stable",
    })).toEqual([expect.stringContaining("full 1540-question evidence contract")]);
    expect(stableLocomoClaimIssues({
      claims: [{ measuredPackageVersion: "0.7.3", name: "LoCoMo" }],
      projection: {
        artifactKind: "tracked-current-claim-projection",
        benchmark: "LoCoMo",
        claim: { packageVersion: "0.7.3" },
        schemaVersion: 1,
        sourceArtifacts: [{
          bytes: 100,
          path: "reports/eval/locomo.json",
          sha256: "a".repeat(64),
        }],
      },
      releaseStatus: "stable",
    })).toEqual([expect.stringContaining("full 1540-question evidence contract")]);
  });

  it("rejects stable LoCoMo projection bytes that do not satisfy the full-run contract", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-claim-"));
    await expect(validateStableLocomoClaimEvidence({
      claimDeclaration: {},
      projection: {
        artifactKind: "tracked-current-claim-projection",
        benchmark: "LoCoMo",
        claim: { packageVersion: "0.7.3" },
        schemaVersion: 1,
      },
      repoRoot,
    })).resolves.toContain(
      "current LoCoMo projection does not satisfy the full 1540-question evidence contract",
    );
  });

  it("binds the full current claim to the paired lifecycle candidate commit", () => {
    const candidateCommit = "a".repeat(40);
    expect(evaluateStableLocomoCandidateLink({
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      projection: {
        execution: { promptSha256: deriveV073PromptSha256() },
        runIdentity: { commit: candidateCommit },
      },
    }).status).toBe("pass");
    expect(evaluateStableLocomoCandidateLink({
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      projection: {
        execution: { promptSha256: deriveV073PromptSha256() },
        runIdentity: { commit: "b".repeat(40) },
      },
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("does not match lifecycle candidate"),
      status: "fail",
    }));
    expect(evaluateStableLocomoCandidateLink({
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      projection: {
        execution: { promptSha256: "0".repeat(64) },
        runIdentity: { commit: candidateCommit },
      },
    })).toEqual(expect.objectContaining({ status: "fail" }));
  });

  it("recomputes a valid full-1540 current claim and rejects altered raw bytes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-full-"));
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toEqual([]);

      await writeFile(
        join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-locomo-claim-evidence/final-smoke-report.json",
        ),
        "{}",
        "utf8",
      );
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toContain(
        "final-report bytes do not match the tracked projection fingerprint",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("rejects stale-output receipts and command chains not derived from the claim recipe", async () => {
    for (const mutation of ["fresh-output", "command-chain"] as const) {
      const repoRoot = await mkdtemp(join(tmpdir(), `goodmemory-locomo-${mutation}-`));
      try {
        const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
        const receiptPath = join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
        );
        const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
          commandChain: { seedSmoke: { args: string[] } };
          freshOutputEvidence: { seedOutputPathAbsentBeforeRun: boolean };
        };
        if (mutation === "fresh-output") {
          receipt.freshOutputEvidence.seedOutputPathAbsentBeforeRun = false;
        } else {
          receipt.commandChain.seedSmoke.args.push("--question-id", "made-up");
        }
        await rewriteTrackedEvidence({
          kind: "execution-receipt",
          projection: evidence.projection,
          raw: JSON.stringify(receipt),
          repoRoot,
        });
        const issues = await validateStableLocomoClaimEvidence({
          ...evidence,
          repoRoot,
        });
        expect(issues).toContain(
          mutation === "fresh-output"
            ? "full-claim execution receipt does not bind a clean exact execution"
            : "execution receipt command chain does not match the claim recipe",
        );
      } finally {
        await rm(repoRoot, { force: true, recursive: true });
      }
    }
  });

  it("requires the published claim declaration to carry the fresh actual command", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-published-command-"));
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toEqual([]);

      for (const command of [
        CLAIM_RECIPE_COMMAND,
        `${evidence.claimDeclaration.run.command} --tampered`,
      ]) {
        const claimDeclaration = {
          ...evidence.claimDeclaration,
          run: { ...evidence.claimDeclaration.run, command },
        };
        await expect(validateStableLocomoClaimEvidence({
          claimDeclaration,
          projection: evidence.projection,
          repoRoot,
        })).resolves.toContain(
          "benchmark-claims/locomo.json is not a current public 0.7.3 declaration bound to the projection",
        );
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("fails closed on malformed official progress JSONL", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-progress-"));
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot, {
        officialProgressRaw: "not-json\n",
      });
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toContain("official progress is not valid JSONL");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("pins package, lockfile, capability, and MCP descriptors to 0.7.3", () => {
    const readJson = (path: string) =>
      JSON.parse(
        readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
      ) as {
        packages?: Record<string, { version?: string }> | Array<{ version?: string }>;
        releaseStatus?: { npmDistTag?: string; status?: string };
        version?: string;
      };
    const packageJson = readJson("package.json");
    const packageLock = readJson("package-lock.json");
    const capability = readJson(".well-known/goodmemory.json");
    const server = readJson("server.json");

    expect(packageJson.version).toBe("0.7.3");
    expect(packageLock.version).toBe("0.7.3");
    expect((packageLock.packages as Record<string, { version?: string }>)[""]?.version).toBe(
      "0.7.3",
    );
    expect(capability.version).toBe("0.7.3");
    expect(capability.releaseStatus).toEqual(expect.objectContaining({
      npmDistTag: "latest",
      status: "release-candidate",
    }));
    expect(server.version).toBe("0.7.3");
    expect((server.packages as Array<{ version?: string }>)[0]?.version).toBe("0.7.3");
  });

  it("requires the 0.7 migration guide and a compressed tarball below 4 MiB", () => {
    expect(
      evaluateV07PackManifest(
        [
          "dist/index.js",
          "dist/index.d.ts",
          "dist/ai-sdk/index.js",
          "dist/ai-sdk/index.d.ts",
          "dist/host/index.js",
          "dist/host/index.d.ts",
          "dist/http/index.js",
          "dist/http/index.d.ts",
          "dist/runtime-kit/index.js",
          "dist/runtime-kit/index.d.ts",
          "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
          "package.json",
        ],
        4 * 1024 * 1024 - 1,
      ),
    ).toEqual([]);
    expect(
      evaluateV07PackManifest(["dist/index.js", "package.json"], 4 * 1024 * 1024),
    ).toEqual([
      "tarball missing: dist/index.d.ts, dist/ai-sdk/index.js, dist/ai-sdk/index.d.ts, dist/host/index.js, dist/host/index.d.ts, dist/http/index.js, dist/http/index.d.ts, dist/runtime-kit/index.js, dist/runtime-kit/index.d.ts, docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
      "compressed tarball 4194304 bytes must be below 4194304 bytes",
    ]);
  });

  it("executes every built-in LanguagePack factory in the packed consumer", () => {
    const smoke = renderV07LanguageConsumerSmoke();

    for (const factoryCall of [
      "createEnglishLanguagePack()",
      'createChineseLanguagePack("Hans")',
      'createChineseLanguagePack("Hant")',
      "createJapaneseLanguagePack()",
      "createKoreanLanguagePack()",
      "createFrenchLanguagePack()",
      "createSpanishLanguagePack()",
    ]) {
      expect(smoke).toContain(factoryCall);
    }
  });

  it("binds readiness to one clean commit and tree", () => {
    expect(evaluateV07SourceIdentity({
      commitSha: "a".repeat(40),
      status: "",
      treeSha: "b".repeat(40),
    })).toEqual({
      check: expect.objectContaining({ status: "pass" }),
      sourceIdentity: {
        commitSha: "a".repeat(40),
        treeSha: "b".repeat(40),
      },
    });
    expect(evaluateV07SourceIdentity({
      commitSha: "a".repeat(40),
      status: " M src/index.ts",
      treeSha: "b".repeat(40),
    }).check).toEqual(expect.objectContaining({
      detail: expect.stringContaining("src/index.ts"),
      status: "fail",
    }));
  });

  it("rejects source drift while release checks are running", () => {
    const initial = {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    };
    expect(evaluateV07SourceStability({
      final: {
        check: {
          detail: "clean source",
          durationMs: 0,
          id: "source-identity",
          required: true,
          status: "pass",
          title: "Exact source identity",
        },
        sourceIdentity: initial,
      },
      initial,
    })).toEqual(expect.objectContaining({ status: "pass" }));
    expect(evaluateV07SourceStability({
      final: {
        check: {
          detail: "clean source",
          durationMs: 0,
          id: "source-identity",
          required: true,
          status: "pass",
          title: "Exact source identity",
        },
        sourceIdentity: {
          commitSha: "c".repeat(40),
          treeSha: "d".repeat(40),
        },
      },
      initial,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("changed while release checks ran"),
      status: "fail",
    }));
  });

  it("requires the release consumer to execute with Node 20", () => {
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.14",
      nodeVersion: "v20.19.4",
    })).toEqual(expect.objectContaining({ status: "pass" }));
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.11",
      nodeVersion: "v22.14.0",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("Node 20"),
      status: "fail",
    }));
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.11",
      nodeVersion: "v20.19.4",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("Bun 1.3.14"),
      status: "fail",
    }));
  });

  it("rejects duplicate CLI flags", () => {
    expect(() =>
      parseV07ReleaseReadinessCliOptions(["--strict", "--strict"]),
    ).toThrow("--strict cannot be specified more than once.");
    expect(() =>
      parseV07ReleaseReadinessCliOptions([
        "--output-dir",
        "/tmp/a",
        "--output-dir",
        "/tmp/b",
      ]),
    ).toThrow("--output-dir cannot be specified more than once.");
  });

  it("parses one explicit lifecycle-protection artifact path", () => {
    expect(
      parseV07ReleaseReadinessCliOptions([
        "--strict",
        "--lifecycle-protection-artifact",
        "/tmp/v0.7.3-protection.json",
      ]),
    ).toEqual({
      lifecycleProtectionArtifact: "/tmp/v0.7.3-protection.json",
      outputDir: undefined,
      skipBuild: false,
      skipCoverage: false,
      skipTests: false,
      strict: true,
    });
  });

  it("accepts only a completed lifecycle artifact bound to the candidate commit", async () => {
    const candidateCommit = "a".repeat(40);
    const bundlePrefix =
      "reports/release/v0.7/v0.7.3-lifecycle-evidence/";
    const bundlePath = (path: string) =>
      `${bundlePrefix}${path.replace(/^\/+|\//gu, "-")}`;
    const artifactIdentity = (path: string, fill: string) => ({
      bytes: 100,
      path: bundlePath(path),
      sha256: fill.repeat(64),
    });
    const scenarioReceiptPath = bundlePath("scenario/execution-receipt.json");
    const scenarioReportPath = bundlePath("scenario/report.json");
    const scenarioStderrPath = bundlePath("scenario/stderr.log");
    const scenarioStdoutPath = bundlePath("scenario/stdout.log");
    const artifact = {
      artifacts: {
        baseline: {
          claimRecipeSource: artifactIdentity("/worktrees/baseline/benchmark-claims/locomo.json", "0"),
          executionReceipt: artifactIdentity("/reports/baseline/receipt.json", "1"),
          officialSummary: artifactIdentity("/reports/baseline/official.json", "2"),
          officialProgress: artifactIdentity("/reports/baseline/progress.jsonl", "7"),
          officialRunnerSource: artifactIdentity("/worktrees/baseline/scripts/rescore-official-protocols.ts", "8"),
          reanswerRunnerSource: artifactIdentity("/worktrees/baseline/scripts/reanswer-phase-65-locomo-report.ts", "9"),
          report: artifactIdentity("/reports/baseline/smoke-report.json", "3"),
          seedReport: artifactIdentity("/reports/baseline-seed/smoke-report.json", "a"),
          seedRunnerSource: artifactIdentity("/worktrees/baseline/scripts/run-phase-65-locomo-smoke.ts", "b"),
        },
        candidate: {
          claimRecipeSource: artifactIdentity("/worktrees/candidate/benchmark-claims/locomo.json", "c"),
          executionReceipt: artifactIdentity("/reports/candidate/receipt.json", "4"),
          officialSummary: artifactIdentity("/reports/candidate/official.json", "5"),
          officialProgress: artifactIdentity("/reports/candidate/progress.jsonl", "9"),
          officialRunnerSource: artifactIdentity("/worktrees/candidate/scripts/rescore-official-protocols.ts", "a"),
          reanswerRunnerSource: artifactIdentity("/worktrees/candidate/scripts/reanswer-phase-65-locomo-report.ts", "d"),
          report: artifactIdentity("/reports/candidate/smoke-report.json", "6"),
          seedReport: artifactIdentity("/reports/candidate-seed/smoke-report.json", "e"),
          seedRunnerSource: artifactIdentity("/worktrees/candidate/scripts/run-phase-65-locomo-smoke.ts", "f"),
        },
        liveDelta: artifactIdentity("/reports/live-delta.json", "7"),
        liveDeltaAnalyzerSource: artifactIdentity(
          "/worktrees/candidate/scripts/analyze-phase-65-locomo-live-delta.ts",
          "5",
        ),
        liveDeltaExecutionReceipt: artifactIdentity(
          "/reports/live-delta-execution-receipt.json",
          "6",
        ),
        liveDeltaStderr: artifactIdentity("/reports/live-delta-stderr.log", "7"),
        liveDeltaStdout: artifactIdentity("/reports/live-delta-stdout.log", "8"),
        manifest: artifactIdentity("/reports/manifest.json", "8"),
        scenarioExecutionReceipt: artifactIdentity(
          "scenario/execution-receipt.json",
          "1",
        ),
        scenarioReplay: artifactIdentity(
          "scenario/report.json",
          "2",
        ),
        scenarioStderr: {
          bytes: 0,
          path: scenarioStderrPath,
          sha256: "3".repeat(64),
        },
        scenarioStdout: artifactIdentity(
          "scenario/stdout.log",
          "4",
        ),
      },
      baselineCommit: "456edd106f29118b3455bf21c43d7b3107b48213",
      blockers: [],
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      claimBoundary:
        "Current recipe omits --answer-profile; historical 0.8799 evidence cannot be reused.",
      fullClaimRerunRequired: true,
      generatedBy: "scripts/run-v0-7-3-lifecycle-protection-gate.ts",
      releaseAllowed: true,
      scenarioReplay: {
        candidateCommit,
        command: "bun test tests/scenarios",
        executionReceiptPath: scenarioReceiptPath,
        executionReceiptSha256: "1".repeat(64),
        failures: 0,
        passed: 8,
        reportPath: scenarioReportPath,
        reportSha256: "2".repeat(64),
        stderrPath: scenarioStderrPath,
        stderrSha256: "3".repeat(64),
        stdoutPath: scenarioStdoutPath,
        stdoutSha256: "4".repeat(64),
      },
      schemaVersion: 1,
    };

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact,
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      id: "v0.7.3-lifecycle-protection",
      status: "pass",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: {
        ...artifact,
        scenarioReplay: {
          ...artifact.scenarioReplay,
          candidateCommit: "c".repeat(40),
        },
      },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("candidate commit"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, releaseAllowed: false },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({ status: "fail" }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, artifacts: undefined },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("source artifact identities"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: {
        ...artifact,
        artifacts: {
          ...artifact.artifacts,
          scenarioExecutionReceipt: undefined,
        },
      },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("source artifact identities"),
      status: "fail",
    }));

    const emptyRepo = await mkdtemp(join(tmpdir(), "goodmemory-v073-bundle-"));
    const artifactPath = join(emptyRepo, "v0.7.3-lifecycle-protection.json");
    await writeFile(artifactPath, JSON.stringify(artifact));
    const strictChecks = await evaluateV073LifecycleProtectionArtifactFile({
      artifactPath,
      currentCommit: candidateCommit,
      repoRoot: emptyRepo,
    });
    expect(strictChecks[0]).toEqual(expect.objectContaining({
      detail: expect.stringContaining("ENOENT"),
      status: "fail",
    }));
  });

  it("allows a later tracked attestation commit without requiring an impossible self-reference", () => {
    const candidatePackage = {
      goodmemoryRelease: {
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "release-candidate",
      },
      name: "goodmemory",
      version: "0.7.3",
    };
    const releasePackage = {
      ...candidatePackage,
      goodmemoryRelease: {
        ...candidatePackage.goodmemoryRelease,
        status: "stable",
      },
    };

    expect(evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage,
      changedPaths: [
        "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        "benchmark-claims/locomo.json",
        "docs/GoodMemory-Current-Status-and-Evidence.md",
        "README.md",
        ".well-known/goodmemory.json",
        "package.json",
      ],
      currentCommit: "b".repeat(40),
      currentPackage: releasePackage,
      isAncestor: true,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("evidence-only descendant"),
      status: "pass",
    }));
  });

  it("rejects post-measurement execution drift and non-status package changes", () => {
    const packageJson = {
      goodmemoryRelease: { status: "release-candidate" },
      name: "goodmemory",
      version: "0.7.3",
    };
    const drift = evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage: packageJson,
      changedPaths: [
        "src/recall/scoring.ts",
        "scripts/run-phase-65-locomo-smoke.ts",
        "tests/unit/recall.scoring.test.ts",
        ".github/workflows/release.yml",
      ],
      currentCommit: "b".repeat(40),
      currentPackage: packageJson,
      isAncestor: true,
    });
    expect(drift.status).toBe("fail");
    expect(drift.detail).toContain("src/recall/scoring.ts");
    expect(drift.detail).toContain(".github/workflows/release.yml");

    expect(evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage: packageJson,
      changedPaths: ["package.json"],
      currentCommit: "b".repeat(40),
      currentPackage: { ...packageJson, version: "0.7.4" },
      isAncestor: true,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("package.json"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage: packageJson,
      changedPaths: [],
      currentCommit: "b".repeat(40),
      currentPackage: packageJson,
      isAncestor: false,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("not an ancestor"),
      status: "fail",
    }));
  });

  it("runs every mandatory release command instead of a focused substitute", () => {
    expect(V07_RELEASE_REQUIRED_COMMANDS).toEqual([
      {
        args: ["run", "typecheck"],
        command: "bun",
        id: "typecheck",
      },
      {
        args: ["test", "--timeout=300000"],
        command: "bun",
        id: "tests",
      },
      {
        args: ["run", "test:coverage"],
        command: "bun",
        id: "coverage",
      },
      {
        args: ["run", "build"],
        command: "bun",
        id: "build",
      },
      {
        args: ["run", "gate:public-benchmark-claim", "--strict"],
        command: "bun",
        id: "public-claims",
      },
      {
        args: [
          "run",
          "gate:phase-74-storage-scale",
          "--output",
          "reports/release/v0.7/phase-74-storage-scale-gate.json",
        ],
        command: "bun",
        id: "scale",
      },
      {
        args: [
          "test",
          "tests/integration/storage.postgres.test.ts",
          "tests/integration/api.postgres.test.ts",
        ],
        command: "bun",
        id: "postgres",
        requiredEnvironment: "GOODMEMORY_TEST_POSTGRES_URL",
      },
    ]);
  });

  it("fails readiness when a required check is skipped", () => {
    expect(
      evaluateV07RequiredChecks([
        {
          detail: "skipped via --skip-tests",
          durationMs: 0,
          id: "tests",
          required: true,
          status: "skip",
          title: "Full canonical Bun test suite",
        },
      ]),
    ).toBe(false);
  });

  it("fails the real Postgres check when its required URL is unavailable", () => {
    expect(
      evaluateV07RequiredEnvironment({
        environment: {},
        environmentName: "GOODMEMORY_TEST_POSTGRES_URL",
        id: "postgres",
        title: "Real Postgres gate",
      }),
    ).toEqual({
      detail: "GOODMEMORY_TEST_POSTGRES_URL is required for the release gate",
      durationMs: 0,
      id: "postgres",
      required: true,
      status: "fail",
      title: "Real Postgres gate",
    });
    expect(
      evaluateV07RequiredEnvironment({
        environment: {
          GOODMEMORY_TEST_POSTGRES_URL: "postgres://localhost/goodmemory",
        },
        environmentName: "GOODMEMORY_TEST_POSTGRES_URL",
        id: "postgres",
        title: "Real Postgres gate",
      }),
    ).toBeUndefined();
  });

  it("prohibits skip flags in strict mode", () => {
    expect(() =>
      parseV07ReleaseReadinessCliOptions(["--strict", "--skip-tests"]),
    ).toThrow("--strict cannot be combined with release-check skip flags.");
  });

  it("passes the configured Postgres URL into the strict release workflow", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("secrets.GOODMEMORY_TEST_POSTGRES_URL");
    expect(workflow).toContain(
      "bun run gate:v0.7 --strict --lifecycle-protection-artifact reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    );
    expect(workflow).toContain(
      "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    );
    const gitignore = readFileSync(
      new URL("../../.gitignore", import.meta.url),
      "utf8",
    );
    expect(gitignore).toContain(
      "!reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    );
    expect(gitignore).not.toContain("!reports/release/v0.7/**");
  });

  it("renders the v0.7 verdict and escapes markdown table pipes", () => {
    const markdown = renderV07ReleaseSummary(report());
    expect(markdown).toContain("# v0.7 Release Readiness");
    expect(markdown).toContain("REQUIRED CHECK(S) FAILED");
    expect(markdown).toContain("too large \\| 4194305 bytes");
    expect(markdown).toContain("## Failure Details");
    expect(markdown).toContain("tarball is too large | 4194305 bytes");
    expect(markdown).toContain(`source commit: ${"a".repeat(40)}`);
    expect(markdown).toContain("runtime: Node v20.19.0 / Bun 1.3.14");
  });

  it("summarizes command failures from signal lines before skipped-test tails", () => {
    const summarized = summarizeCommandFailureOutput([
      "bun test v1.3.14",
      "(pass) unrelated > succeeds [1.00ms]",
      "error: expected noisy diagnostic from a passing test",
      "(pass) noisy test still succeeds [2.00ms]",
      "(pass) spacer one [1.00ms]",
      "(pass) spacer two [1.00ms]",
      "(pass) spacer three [1.00ms]",
      "(pass) spacer four [1.00ms]",
      "(pass) spacer five [1.00ms]",
      "tests/unit/example.test.ts:",
      "(fail) important suite > exposes the real failure [5010.00ms]",
      "^ this test timed out",
      "error: expect(received).toBe(expected)",
      "(skip) noisy tail > skipped real evidence one",
      "(skip) noisy tail > skipped real evidence two",
      "(skip) noisy tail > skipped real evidence three",
    ].join("\n"));

    expect(summarized).toContain("(fail) important suite");
    expect(summarized).toContain("^ this test timed out");
    expect(summarized).not.toContain("expected noisy diagnostic");
    expect(summarized.trimStart().startsWith("(skip)")).toBe(false);
  });
});
