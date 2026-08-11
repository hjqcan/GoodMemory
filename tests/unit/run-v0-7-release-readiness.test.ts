import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  fingerprintProviderRequest,
  fingerprintProviderRequestSequence,
  fingerprintProviderTransportAttemptLedger,
  serializeProviderResponseTape,
} from "../../scripts/provider-response-tape";
import type { ProviderTapeTransportAttempt } from "../../scripts/provider-response-tape";
import {
  encodeProviderResponseTapeBundle,
  PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY,
} from "../../scripts/provider-response-tape-bundle";
import {
  renderV073FullClaimProtocol2Command,
  V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
  V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
} from "../../scripts/run-v0-7-3-full-locomo-claim";
import {
  buildV073FullClaimCommandChain,
  buildV073PairedCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
} from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
import {
  buildV073ProviderFreeArgs,
  buildV073StageArm,
  routeV073CommandChainThroughTape,
  V073_PROVIDER_STAGE_ORDER,
  V073_SEMANTIC_SEED_RUN_ID,
  V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY,
} from "../../scripts/run-v0-7-3-replacement-protection-gate";
import {
  evaluateV073ReplacementProtection,
  V073_PROVIDER_PREFLIGHT_POLICY,
} from "../../scripts/v0-7-3-replacement-protection";
import { frozenV073LocomoQuestionSelection } from "../fixtures/v0-7-3-locomo-question-selection";

import type { V07ReleaseReadinessReport } from "../../scripts/run-v0-7-release-readiness";
import {
  assertV073MeasurementEvidenceRoot,
  evaluateV07RuntimeVersions,
  evaluateV07SourceIdentity,
  evaluateV07SourceStability,
  evaluateV073LifecycleProtectionArtifact,
  evaluateV073LifecycleProtectionArtifactFile,
  evaluateV073LifecycleProtectionBundle,
  evaluateV073LifecycleToProtocolSourceDrift,
  evaluateV073LifecycleProtectionSourceDrift,
  evaluateV073PublicClaimGovernanceCorrection,
  evaluateV073PublicClaimGovernanceCorrectionFile,
  evaluateV073CurrentLocomoClaimState,
  resolveV073MeasuredClaimRecipeRaw,
  evaluateStableLocomoCandidateLink,
  evaluateVersionConsistency,
  evaluateV07RequiredEnvironment,
  evaluateV07PackManifest,
  evaluateV07PackedProductionDependencyClosure,
  evaluateV07RequiredChecks,
  isV073ProtocolDependencyPinningExact,
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
const V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_RAW = readFileSync(
  new URL(
    "../../reports/release/v0.7/" +
      "v0.7.3-public-claim-governance-correction-preregistration.json",
    import.meta.url,
  ),
  "utf8",
);
const V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION = JSON.parse(
  V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_RAW,
) as Record<string, unknown>;
const FROZEN_EXTRACTION_CACHE_KEYS = `1026011752,1043075633,1048640987,1064385496,1074118592,1082572768,1085614012,1100013451,1106738478,1107927765,1149940053,1174402540,1179366734,119627208,1210345783,1214355198,1233087856,1235470133,1235797445,1262789243,1274083946,1282170511,1283329829,1286918907,1295601743,1297782189,1307988077,1319705907,1328173301,1328689511,1349955765,1350941805,1379854271,1413391623,1435136569,1442320489,1456333297,1462198132,1462209140,1468470661,1504783545,1512102553,1514661872,1540321149,158635861,1605258038,1605375082,1608409831,1624202483,1626462396,1637799839,1640645819,1657807838,1662822657,1683467400,1695447940,17478626,1759105343,1765845080,1783812631,1794648524,1818642755,1830021848,1831804471,1851107591,1867438061,1899024238,190435261,190514398,1908455853,1921862501,1932501489,1950914891,1954375170,197078112,1973152628,1974647250,2023388394,2028687634,2029739893,2082863547,2104432904,2110024156,2127925618,2169031043,2170519568,2208365546,2213123762,2241677242,2252021607,2257662354,2269934223,2271878572,2289891018,2296526698,2313786091,2345910704,2365345403,2374437865,2374691122,2377254015,2409284101,2467338410,2470288298,2499175648,2520178360,2537119988,2556547485,2580518300,2613174370,2628407233,2628720039,2638044662,2660362212,2667468039,268223945,2682876890,2690261994,2697045242,2704211094,2720575096,2728504571,272962455,2739697176,2756416341,2778393052,2788849373,2808754637,2847703965,2854501767,2881632957,2883901230,2885592754,291345923,2941581325,2946553860,2956805899,2956828830,2964053549,3019328255,3048976956,3065890162,3082216776,3091806564,3094338424,3097614024,3117857382,3122434169,3124136818,3157804431,3171500229,3173281100,3191763993,3207441003,3212366713,3253399891,3262206268,3278473437,330521969,3317603065,334965310,3353188566,3355255159,3357769836,3366081265,3372475236,3383102199,3399309972,3404659494,3409194407,3433338164,3475091123,347589968,3477136000,348451955,3515465047,3528477104,3534871376,3548914855,3550718725,3601917062,3603537566,3603678876,365614635,3656327079,3658789493,3718654866,3725668826,3735345225,3776053402,3782774512,3793646152,3807215703,3822027981,3827649987,383922720,3858417783,3858893291,3865864865,3884181463,388633262,3909652640,3913271655,3916739008,3918147773,3953785847,3987803998,3998055624,4020401383,4041516452,4048306217,4050607731,4054623380,405704242,4064958010,4087715158,408816433,4101383531,4135370547,4185930273,4191367251,4202314565,422010356,4225549544,4242304435,4249433875,4269397799,4288617617,439644231,439839894,444360337,445998733,446964711,457524894,461882634,466502363,485635095,498500745,504799247,5232106,523648874,53669181,551705100,557935800,601233020,603562177,611308681,621666406,667563176,670731536,716508937,753832901,756375679,757596036,759425599,764744235,770665424,792488089,798097702,804639734,819411587,821135895,8652893,87803361,884269538,888563539,890823627,895915931,917508735,918610777,946157475,990812899`
  .split(",")
  .map((value) => `gpt-5.6-terra:${value}`);
const EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256 =
  "30fde28c5e2450365d8cc3d90a80f72aa900691151f4d1127e0a4f3c8a520f4f";
const EXPECTED_EXTRACTION_CACHE_KEY_CASE_MAP_SHA256 =
  "24732a6040c70d52999a18b9d95d72e663a883aa7c5524fc5ee8b4187611e03b";
const CLAIM_RECIPE_COMMAND = (
  JSON.parse(CLAIM_RECIPE_RAW) as { run: { command: string } }
).run.command;

function providerPreflightPlan() {
  return {
    probeOrder: [...V073_PROVIDER_PREFLIGHT_POLICY.probeOrder],
    probes: [
      { attempt: 1, responseKind: "stream-object" as const, status: 200, target: "eval-listwise" as const },
      { attempt: 2, responseKind: "stream-object" as const, status: 200, target: "eval-listwise" as const },
      { attempt: 3, responseKind: "stream-object" as const, status: 200, target: "eval-listwise" as const },
      { attempt: 1, responseKind: "embedding" as const, status: 200, target: "embedding" as const },
      { attempt: 1, responseKind: "chat-json" as const, status: 200, target: "judge" as const },
    ],
    totalRequests: 5,
  };
}

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

function runFixtureGit(repoRoot: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString().trim();
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
  options: {
    benchmarkRoot?: string;
    officialProgressRaw?: string;
    protocolCandidateClaimRecipeRaw?: string;
    protocolCandidateOfficialRunnerRaw?: string;
    recoveredSeedCaseId?: "locomo-conv-43";
  } = {},
) {
  const prefix = "reports/release/v0.7/v0.7.3-locomo-claim-evidence";
  const officialRunnerRaw = "export const officialPrompt = 'current';\n";
  runFixtureGit(repoRoot, "init", "--quiet");
  runFixtureGit(repoRoot, "config", "user.email", "test@example.com");
  runFixtureGit(repoRoot, "config", "user.name", "Test");
  await Promise.all([
    mkdir(join(repoRoot, "benchmark-claims"), { recursive: true }),
    mkdir(join(repoRoot, "scripts"), { recursive: true }),
  ]);
  await writeFile(join(repoRoot, "protocol-candidate.txt"), "protocol v2\n");
  await Promise.all([
    writeFile(
      join(repoRoot, "benchmark-claims/locomo.json"),
      options.protocolCandidateClaimRecipeRaw ?? CLAIM_RECIPE_RAW,
      "utf8",
    ),
    writeFile(
      join(repoRoot, "scripts/rescore-official-protocols.ts"),
      options.protocolCandidateOfficialRunnerRaw ?? officialRunnerRaw,
      "utf8",
    ),
  ]);
  runFixtureGit(
    repoRoot,
    "add",
    "benchmark-claims/locomo.json",
    "protocol-candidate.txt",
    "scripts/rescore-official-protocols.ts",
  );
  runFixtureGit(repoRoot, "commit", "--quiet", "-m", "protocol candidate");
  const protocolCandidateCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");
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
  const finalRows = frozenV073LocomoQuestionSelection().map((identity, index) => ({
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
  const seedRows = finalRows.map((row) => ({
    ...row,
    answerCorrect: null,
    answerTokenF1: null,
    generatedAnswer: null,
  }));
  const lifecycleCandidateCommit = "d".repeat(40);
  const namespace =
    `v073-${protocolCandidateCommit.slice(0, 8)}-full1540-protocol2`;
  const seedRunId = `${namespace}-seed`;
  const finalRunId = `${namespace}-final`;
  const officialRunId = `${namespace}-official-gpt55`;
  const outputRoot = `reports/eval/research/${namespace}`;
  const seedDirectory = join(repoRoot, outputRoot, seedRunId);
  const finalDirectory = join(repoRoot, outputRoot, finalRunId);
  const officialDirectory = join(
    repoRoot,
    "reports/eval/research/official-rescore",
    officialRunId,
  );
  const benchmarkRoot = options.benchmarkRoot ?? join(
    homedir(),
    ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
  );
  const common = {
    benchmark: "locomo",
    benchmarkFingerprint:
      "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
    caseCount: 10,
    caseIds,
    executionFailures: 0,
    questionCount: 1540,
  };
  const seedReport = {
    ...common,
    answerEvaluation: "deferred-to-live-mode",
    cases: seedRows,
    generatedAt: "2026-08-06T10:00:00.000Z",
    generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
    mode: "retrieval-only",
    resume: true,
    runDirectory: seedDirectory,
    runId: seedRunId,
  };
  const finalReport = {
    ...common,
    answerAccuracyOverall: 0.6,
    answerEvaluation: "scored",
    answerSystem: "locomo-live-category-aware-v1",
    cases: finalRows,
    generatedAt: "2026-08-06T11:00:00.000Z",
    generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
    mode: "live-answer",
    resume: false,
    runDirectory: finalDirectory,
    runId: finalRunId,
    sourceReport: {
      path: join(seedDirectory, "smoke-report.json"),
      runId: seedRunId,
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
    outputPath: join(officialDirectory, "rescore-summary.json"),
    protocol: "mem0ai/memory-benchmarks LoCoMo judge (no-evidence variant, categories 1-4)",
    runId: officialRunId,
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
  const officialProgressRaw = options.officialProgressRaw ?? `${finalRows.map((row) => {
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
    finalRunId,
    judgeGateway: "https://ai.gurkiai.com/v1",
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    officialRunId,
    rerankingGateway: "https://ai.gurkiai.com/v1",
    rerankingModel: "gpt-5.6-terra",
    rerankingProvider: "openai",
    seedOutputPath: seedDirectory,
    seedRunId,
    worktreePath: repoRoot,
  }, CLAIM_RECIPE_RAW);
  const command = renderV073FullClaimProtocol2Command(
    commandChain,
    repoRoot,
    options.recoveredSeedCaseId ? 2 : 1,
  );
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
    expectedExtractionCacheKeyCaseMapSha256:
      EXPECTED_EXTRACTION_CACHE_KEY_CASE_MAP_SHA256,
    expectedExtractionCacheKeySetSha256:
      EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256,
    embeddingGateway: "https://openrouter.ai/api/v1",
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
    judgeGateway: "https://ai.gurkiai.com/v1",
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    officialSourceSha256: createHash("sha256").update(officialRunnerRaw).digest("hex"),
    officialRescoreRequestTimeoutMs: 180_000,
    promptSha256: deriveV073PromptSha256(),
    questionSelectionSha256: V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
    caseQuestionCounts: V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
    rerankingGateway: "https://ai.gurkiai.com/v1",
    rerankingModel: "gpt-5.6-terra",
    rerankingProvider: "openai",
    providerEmbeddingRunTimeoutMs: null,
    providerEmbeddingTimeoutMs: null,
    providerRerankingTimeoutMs: 120_000,
  };
  const progressConfig = {};
  const progressConfigFingerprint = createHash("sha256")
    .update(JSON.stringify(progressConfig))
    .digest("hex");
  const seedProgressRaw = `${[
    JSON.stringify({
      config: progressConfig,
      configFingerprint: progressConfigFingerprint,
      kind: "locomo-progress-config",
      version: 2,
    }),
    ...finalRows.map((row) => JSON.stringify({
      caseId: row.caseId,
      executionFailureMessage: null,
      questionId: row.questionId,
    })),
  ].join("\n")}\n`;
  const seedExtractionCacheRaw = `${FROZEN_EXTRACTION_CACHE_KEYS.map(
    (key) => JSON.stringify({
      candidates: [],
      key,
    }),
  ).join("\n")}\n`;
  const recoveredSeedRows = options.recoveredSeedCaseId
    ? seedRows.map((row) => row.caseId === options.recoveredSeedCaseId
      ? {
          ...row,
          executionFailureMessage:
            "OpenAI-compatible gateway timeout after 120000ms.",
          executionFailureStage: "seed",
        }
      : row)
    : seedRows;
  const attemptOneSeedRaw = options.recoveredSeedCaseId
    ? JSON.stringify({
        ...seedReport,
        cases: recoveredSeedRows,
        executionFailures: recoveredSeedRows.filter(
          (row) => row.executionFailureMessage != null,
        ).length,
      })
    : seedRaw;
  const successfulAttemptOneRows = recoveredSeedRows.filter(
    (row) => row.executionFailureMessage == null,
  );
  const failedAttemptOneRows = recoveredSeedRows.filter(
    (row) => row.executionFailureMessage != null,
  );
  const attemptOneProgressRaw = options.recoveredSeedCaseId
    ? `${[
        JSON.stringify({
          config: progressConfig,
          configFingerprint: progressConfigFingerprint,
          kind: "locomo-progress-config",
          version: 2,
        }),
        ...successfulAttemptOneRows.map((row) => JSON.stringify({
          caseId: row.caseId,
          executionFailureMessage: null,
          questionId: row.questionId,
        })),
      ].join("\n")}\n`
    : seedProgressRaw;
  const finalSeedProgressRaw = options.recoveredSeedCaseId
    ? `${attemptOneProgressRaw}${failedAttemptOneRows.map((row) => JSON.stringify({
        caseId: row.caseId,
        executionFailureMessage: null,
        questionId: row.questionId,
      })).join("\n")}\n`
    : seedProgressRaw;
  const attemptOneExtractionCacheRaw = options.recoveredSeedCaseId
      ? `${FROZEN_EXTRACTION_CACHE_KEYS.slice(0, -1).map(
        (key) => JSON.stringify({
          candidates: [],
          key,
        }),
      ).join("\n")}\n`
    : seedExtractionCacheRaw;
  const lifecycleProtectionPath =
    "reports/release/v0.7/v0.7.3-lifecycle-protection.json";
  const lifecycleProtectionRaw = `${JSON.stringify({
    blockers: [],
    candidateCommit: lifecycleCandidateCommit,
    fullClaimRerunRequired: true,
    releaseAllowed: true,
    schemaVersion: 9,
  })}\n`;
  const preregistrationPath =
    "reports/release/v0.7/v0.7.3-full-claim-protocol2-preregistration.json";
  const sentinelPath =
    "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json";
  const preregistrationRaw = `${JSON.stringify({
    benchmark: {
      bytes: 2_490_457,
      fingerprint:
        "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
      sha256:
        "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28",
    },
    finalRunId,
    generatedAt: "2026-08-10T09:00:00.000Z",
    generatedBy: "v0.7.3-full-locomo-claim-protocol2-preregistration",
    lifecycleCandidateCommit,
    lifecycleProtection: evidenceIdentity(
      lifecycleProtectionPath,
      lifecycleProtectionRaw,
    ),
    maxSeedLaunches: 2,
    namespace,
    officialRunId,
    outputRoot,
    protocolCandidateCommit,
    protocolVersion: 2,
    seedRunId,
    sentinelPath,
  })}\n`;
  await mkdir(join(repoRoot, "reports/release/v0.7"), { recursive: true });
  await Promise.all([
    writeFile(
      join(repoRoot, lifecycleProtectionPath),
      lifecycleProtectionRaw,
      "utf8",
    ),
    writeFile(join(repoRoot, preregistrationPath), preregistrationRaw, "utf8"),
  ]);
  runFixtureGit(repoRoot, "add", lifecycleProtectionPath, preregistrationPath);
  runFixtureGit(repoRoot, "commit", "--quiet", "-m", "preregister protocol v2");
  const releaseCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");
  const sentinelRaw = `${JSON.stringify({
    generatedAt: "2026-08-10T10:00:00.000Z",
    generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts",
    lifecycleCandidateCommit,
    maxSeedLaunches: 2,
    namespace,
    protocolCandidateCommit,
    protocolVersion: 2,
    releaseCommit,
    state: "consumed",
  })}\n`;
  await writeFile(join(repoRoot, sentinelPath), sentinelRaw, "utf8");
  runFixtureGit(repoRoot, "add", sentinelPath);
  runFixtureGit(repoRoot, "commit", "--quiet", "-m", "consume protocol v2");
  const sentinelCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");
  const receipt = {
    command,
    commandChain,
    commit: protocolCandidateCommit,
    evidenceRepositoryBefore: {
      headCommit: protocolCandidateCommit,
      statusPorcelain: "",
    },
    execution,
    freshOutputEvidence: {
      finalOutputPathAbsentBeforeRun: true,
      officialOutputPathAbsentBeforeRun: true,
      seedAttemptOneSnapshotPathAbsentBeforeRun: true,
      seedOutputPathAbsentBeforeRun: true,
    },
    generatedBy: "v0.7.3-full-locomo-claim-launch",
    lifecycleCandidateCommit,
    maxSeedLaunches: 2,
    outputs: {
      finalReport: evidenceIdentity(
        join(finalDirectory, "smoke-report.json"),
        finalRaw,
      ),
      officialSummary: evidenceIdentity(officialSummary.outputPath, officialRaw),
      officialProgress: evidenceIdentity(
        join(officialDirectory, "progress.jsonl"),
        officialProgressRaw,
      ),
      seedExtractionCache: evidenceIdentity(
        join(seedDirectory, "extraction-cache.jsonl"),
        seedExtractionCacheRaw,
      ),
      seedProgress: evidenceIdentity(
        join(seedDirectory, "live-progress.jsonl"),
        finalSeedProgressRaw,
      ),
      seedReport: evidenceIdentity(
        join(seedDirectory, "smoke-report.json"),
        seedRaw,
      ),
    },
    preregistration: evidenceIdentity(preregistrationPath, preregistrationRaw),
    protocolCandidateCommit,
    protocolVersion: 2,
    seedAttempts: [{
      attempt: 1,
      command: commandChain.seedSmoke,
      exitCode: 0,
      extractionCache: evidenceIdentity(
        `${prefix}/seed-attempt-1-extraction-cache.jsonl`,
        attemptOneExtractionCacheRaw,
      ),
      failedCaseId: options.recoveredSeedCaseId ?? null,
      progress: evidenceIdentity(
        `${prefix}/seed-attempt-1-live-progress.jsonl`,
        attemptOneProgressRaw,
      ),
      recoveryClassification: options.recoveredSeedCaseId
        ? "eligible-single-case-seed-timeout"
        : "failure-free",
      report: evidenceIdentity(
        `${prefix}/seed-attempt-1-smoke-report.json`,
        attemptOneSeedRaw,
      ),
    }, ...(options.recoveredSeedCaseId
      ? [{
          attempt: 2,
          command: commandChain.seedSmoke,
          exitCode: 0,
          extractionCache: evidenceIdentity(
            `${prefix}/seed-extraction-cache.jsonl`,
            seedExtractionCacheRaw,
          ),
          failedCaseId: null,
          progress: evidenceIdentity(
            `${prefix}/seed-live-progress.jsonl`,
            finalSeedProgressRaw,
          ),
          recoveryClassification: "failure-free-after-single-resume",
          report: evidenceIdentity(`${prefix}/seed-smoke-report.json`, seedRaw),
        }]
      : [])],
    sentinel: evidenceIdentity(sentinelPath, sentinelRaw),
    sentinelCommit,
    sources: {
      claimRecipe: evidenceIdentity(
        join(repoRoot, "benchmark-claims/locomo.json"),
        CLAIM_RECIPE_RAW,
      ),
      officialRunner: evidenceIdentity(
        join(repoRoot, "scripts/rescore-official-protocols.ts"),
        officialRunnerRaw,
      ),
      preregistration: evidenceIdentity(preregistrationPath, preregistrationRaw),
      sentinel: evidenceIdentity(sentinelPath, sentinelRaw),
    },
    schemaVersion: 1,
    worktreeProvenance: {
      headCommit: protocolCandidateCommit,
      statusPorcelain: "",
    },
  };
  const receiptRaw = JSON.stringify(receipt);
  const rawByKind = {
    "claim-recipe-source": CLAIM_RECIPE_RAW,
    "execution-receipt": receiptRaw,
    "final-report": finalRaw,
    "official-summary": officialRaw,
    "official-progress": officialProgressRaw,
    "official-runner-source": officialRunnerRaw,
    "protocol-attempt-sentinel": sentinelRaw,
    "protocol-preregistration": preregistrationRaw,
    "seed-attempt-1-extraction-cache": attemptOneExtractionCacheRaw,
    "seed-attempt-1-progress": attemptOneProgressRaw,
    "seed-attempt-1-report": attemptOneSeedRaw,
    "seed-extraction-cache": seedExtractionCacheRaw,
    "seed-progress": finalSeedProgressRaw,
    "seed-report": seedRaw,
  };
  const pathsByKind = {
    "claim-recipe-source": `${prefix}/claim-recipe-source.json`,
    "execution-receipt": `${prefix}/execution-receipt.json`,
    "final-report": `${prefix}/final-smoke-report.json`,
    "official-summary": `${prefix}/official-rescore-summary.json`,
    "official-progress": `${prefix}/official-progress.jsonl`,
    "official-runner-source": `${prefix}/official-runner-source.ts`,
    "protocol-attempt-sentinel": sentinelPath,
    "protocol-preregistration": preregistrationPath,
    "seed-attempt-1-extraction-cache":
      `${prefix}/seed-attempt-1-extraction-cache.jsonl`,
    "seed-attempt-1-progress": `${prefix}/seed-attempt-1-live-progress.jsonl`,
    "seed-attempt-1-report": `${prefix}/seed-attempt-1-smoke-report.json`,
    "seed-extraction-cache": `${prefix}/seed-extraction-cache.jsonl`,
    "seed-progress": `${prefix}/seed-live-progress.jsonl`,
    "seed-report": `${prefix}/seed-smoke-report.json`,
  } as const;
  await Promise.all([
    mkdir(join(repoRoot, prefix), { recursive: true }),
    mkdir(join(repoRoot, "reports/release/v0.7"), { recursive: true }),
  ]);
  await writeFile(
    join(repoRoot, lifecycleProtectionPath),
    lifecycleProtectionRaw,
    "utf8",
  );
  const sourceArtifacts = await Promise.all(
    Object.entries(rawByKind).map(async ([kind, raw]) => {
      const path = pathsByKind[kind as keyof typeof pathsByKind];
      await writeFile(join(repoRoot, path), raw, "utf8");
      return { ...evidenceIdentity(path, raw), kind };
    }),
  );
  runFixtureGit(repoRoot, "add", "reports/release/v0.7");
  runFixtureGit(repoRoot, "commit", "--quiet", "-m", "publish protocol evidence");
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
    lifecycleCandidateCommit,
    maxSeedLaunches: 2,
    protocolCandidateCommit,
    protocolVersion: 2,
    runIdentity: {
      commit: protocolCandidateCommit,
      finalRunId,
      officialRunId,
      seedRunId,
    },
    seedAttempts: receipt.seedAttempts,
    sentinelCommit,
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
      commit: protocolCandidateCommit,
      executionFailures: 0,
      packageVersion: "0.7.3",
    },
    status: "candidate_public_claim",
  };
  return { claimDeclaration, projection, sentinelCommit };
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

      await mkdir(join(repoRoot, "reports/release/v0.7"), { recursive: true });
      await writeFile(
        join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-full-claim-protocol2-preregistration.json",
        ),
        "{\"protocolVersion\":2}\n",
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toEqual([]);

      await writeFile(
        join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
        ),
        "{\"protocolVersion\":2,\"state\":\"consumed\"}\n",
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toContain(
        "current LoCoMo evidence is partial: projection and all 14 tracked source artifacts must appear together",
      );
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

      await writeFile(
        join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-locomo-claim-evidence/unbound-extra.json",
        ),
        "{}\n",
        "utf8",
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toContain(
        "current LoCoMo evidence directory must contain exactly the 12 tracked bundle files",
      );

      const evidenceRoot = join(
        repoRoot,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence",
      );
      await rm(join(evidenceRoot, "unbound-extra.json"));
      const claimRecipePath = join(evidenceRoot, "claim-recipe-source.json");
      const claimRecipeRaw = await readFile(claimRecipePath, "utf8");
      const externalClaimRecipePath = join(repoRoot, "external-claim-recipe.json");
      await writeFile(externalClaimRecipePath, claimRecipeRaw, "utf8");
      await rm(claimRecipePath);
      await symlink(externalClaimRecipePath, claimRecipePath);
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toContain(
        "claim-recipe-source must be a regular tracked file",
      );

      await rm(claimRecipePath);
      await writeFile(claimRecipePath, claimRecipeRaw, "utf8");
      const externalEvidenceRoot = join(repoRoot, "external-claim-evidence");
      await rename(evidenceRoot, externalEvidenceRoot);
      await symlink(externalEvidenceRoot, evidenceRoot);
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        releaseStatus: "release-candidate",
        repoRoot,
      })).resolves.toContain(
        "current LoCoMo evidence root must be a real directory",
      );
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
        "current LoCoMo evidence is partial: projection and all 14 tracked source artifacts must appear together",
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
        "current LoCoMo evidence is partial: projection and all 14 tracked source artifacts must appear together",
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
        "current LoCoMo evidence is partial: projection and all 14 tracked source artifacts must appear together",
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
      ["execution-receipt", "execution-receipt.json"],
      ["final-report", "final-smoke-report.json"],
      ["official-summary", "official-rescore-summary.json"],
      ["official-progress", "official-progress.jsonl"],
      ["official-runner-source", "official-runner-source.ts"],
      [
        "protocol-attempt-sentinel",
        "../v0.7.3-full-claim-protocol2-attempt-consumed.json",
      ],
      [
        "protocol-preregistration",
        "../v0.7.3-full-claim-protocol2-preregistration.json",
      ],
      ["seed-attempt-1-extraction-cache", "seed-attempt-1-extraction-cache.jsonl"],
      ["seed-attempt-1-progress", "seed-attempt-1-live-progress.jsonl"],
      ["seed-attempt-1-report", "seed-attempt-1-smoke-report.json"],
      ["seed-extraction-cache", "seed-extraction-cache.jsonl"],
      ["seed-progress", "seed-live-progress.jsonl"],
      ["seed-report", "seed-smoke-report.json"],
    ].map(([kind, name]) => ({
      bytes: 100,
      kind,
      path: name.startsWith("../")
        ? `reports/release/v0.7/${name.slice(3)}`
        : `reports/release/v0.7/v0.7.3-locomo-claim-evidence/${name}`,
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
        expectedExtractionCacheKeyCaseMapSha256:
          EXPECTED_EXTRACTION_CACHE_KEY_CASE_MAP_SHA256,
        expectedExtractionCacheKeySetSha256:
          EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256,
        embeddingGateway: "https://openrouter.ai/api/v1",
        embeddingModel: "text-embedding-3-small",
        embeddingProvider: "openai",
        judgeGateway: "https://ai.gurkiai.com/v1",
        judgeModel: "gpt-5.5",
        judgeProvider: "openai",
        officialSourceSha256: "f".repeat(64),
        officialRescoreRequestTimeoutMs: 180_000,
        promptSha256: deriveV073PromptSha256(),
        questionSelectionSha256: V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
        caseQuestionCounts: V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
        rerankingGateway: "https://ai.gurkiai.com/v1",
        rerankingModel: "gpt-5.6-terra",
        rerankingProvider: "openai",
        providerEmbeddingRunTimeoutMs: null,
        providerEmbeddingTimeoutMs: null,
        providerRerankingTimeoutMs: 120_000,
      },
      generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts",
      lifecycleCandidateCommit: "d".repeat(40),
      maxSeedLaunches: 2,
      protocolCandidateCommit: "e".repeat(40),
      protocolVersion: 2,
      runIdentity: {
        commit: "e".repeat(40),
        finalRunId: "final",
        officialRunId: "official",
        seedRunId: "seed",
      },
      seedAttempts: [{}],
      sentinelCommit: "f".repeat(40),
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

  it("binds the full current claim to the protocol candidate commit", () => {
    const protocolCandidateCommit = "a".repeat(40);
    expect(evaluateStableLocomoCandidateLink({
      protocolCandidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      projection: {
        execution: { promptSha256: deriveV073PromptSha256() },
        runIdentity: { commit: protocolCandidateCommit },
      },
    }).status).toBe("pass");
    expect(evaluateStableLocomoCandidateLink({
      protocolCandidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      projection: {
        execution: { promptSha256: deriveV073PromptSha256() },
        runIdentity: { commit: "b".repeat(40) },
      },
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("does not match protocol candidate"),
      status: "fail",
    }));
    expect(evaluateStableLocomoCandidateLink({
      protocolCandidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      projection: {
        execution: { promptSha256: "0".repeat(64) },
        runIdentity: { commit: protocolCandidateCommit },
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

  it("requires retrieval-only seed rows and scored final answer rows", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-stage-contract-"));
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toEqual([]);

      const seedPath = join(
        repoRoot,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-smoke-report.json",
      );
      const seed = JSON.parse(await readFile(seedPath, "utf8")) as {
        answerEvaluation: string;
        cases: Array<{
          answerCorrect: boolean | null;
          answerTokenF1: number | null;
          generatedAnswer: string | null;
        }>;
        mode: string;
      };
      seed.mode = "live-answer";
      seed.answerEvaluation = "scored";
      seed.cases[0] = {
        ...seed.cases[0]!,
        answerCorrect: true,
        answerTokenF1: 1,
        generatedAnswer: "stale answer from seed",
      };
      await rewriteTrackedEvidence({
        kind: "seed-report",
        projection: evidence.projection,
        raw: JSON.stringify(seed),
        repoRoot,
      });

      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toContain(
        "seed report is not a complete failure-free retrieval-only full-1540 LoCoMo report",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("accepts one fully-bound seed-timeout resume with its pass-one snapshot", async () => {
    const repoRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-locomo-protocol2-recovered-seed-"),
    );
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot, {
        recoveredSeedCaseId: "locomo-conv-43",
      });
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("binds the exact sentinel-only commit between preregistration and publication", async () => {
    const repoRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-locomo-protocol2-sentinel-commit-"),
    );
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
      const receiptPath = join(
        repoRoot,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
      );
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
        sentinelCommit: string;
      };
      const publicationCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");
      receipt.sentinelCommit = publicationCommit;
      evidence.projection.sentinelCommit = publicationCommit;
      await rewriteTrackedEvidence({
        kind: "execution-receipt",
        projection: evidence.projection,
        raw: JSON.stringify(receipt),
        repoRoot,
      });

      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toContain(
        "full-claim protocol-v2 git boundary is inconsistent",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("pins portable commands, provider timeouts, and the real 272-key cache", async () => {
    const repoRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-locomo-protocol2-frozen-contract-"),
    );
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot, {
        recoveredSeedCaseId: "locomo-conv-43",
      });
      expect(evidence.claimDeclaration.run.command).toContain(
        "--benchmark-root @locomo-full10-root",
      );
      expect(evidence.claimDeclaration.run.command).not.toContain(
        ".cache/goodmemory-benchmarks",
      );

      const receiptPath = join(
        repoRoot,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
      );
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
        execution: Record<string, unknown>;
        outputs: { seedExtractionCache: ReturnType<typeof evidenceIdentity> };
        seedAttempts: typeof evidence.projection.seedAttempts;
      };
      receipt.execution.providerRerankingTimeoutMs = 1;
      evidence.projection.execution.providerRerankingTimeoutMs = 1;
      await rewriteTrackedEvidence({
        kind: "execution-receipt",
        projection: evidence.projection,
        raw: JSON.stringify(receipt),
        repoRoot,
      });
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toContain(
        "current LoCoMo projection does not satisfy the full 1540-question evidence contract",
      );

      receipt.execution.providerRerankingTimeoutMs = 120_000;
      evidence.projection.execution.providerRerankingTimeoutMs = 120_000;
      const cacheKind = "seed-extraction-cache";
      const cacheArtifact = evidence.projection.sourceArtifacts.find(
        (artifact) => artifact.kind === cacheKind,
      )!;
      const cachePath = join(repoRoot, cacheArtifact.path);
      const cacheLines = (await readFile(cachePath, "utf8")).trimEnd().split("\n");
      cacheLines[cacheLines.length - 1] = JSON.stringify({
        candidates: [],
        key: "gpt-5.6-terra:post-hoc-cache-key",
      });
      const cacheRaw = `${cacheLines.join("\n")}\n`;
      await rewriteTrackedEvidence({
        kind: cacheKind,
        projection: evidence.projection,
        raw: cacheRaw,
        repoRoot,
      });
      const cacheIdentity = evidenceIdentity(cacheArtifact.path, cacheRaw);
      receipt.outputs.seedExtractionCache = evidenceIdentity(
        receipt.outputs.seedExtractionCache.path,
        cacheRaw,
      );
      receipt.seedAttempts[1]!.extractionCache = cacheIdentity;
      evidence.projection.seedAttempts = receipt.seedAttempts;
      await rewriteTrackedEvidence({
        kind: "execution-receipt",
        projection: evidence.projection,
        raw: JSON.stringify(receipt),
        repoRoot,
      });
      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toContain(
        "full-claim protocol-v2 seed attempt history is inconsistent",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("reconstructs a macOS-recorded protocol command under a different verifier home", async () => {
    const repoRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-locomo-protocol2-cross-home-"),
    );
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
      const projectionPath = join(repoRoot, "cross-home-projection.json");
      const claimPath = join(repoRoot, "cross-home-claim.json");
      await Promise.all([
        writeFile(projectionPath, JSON.stringify(evidence.projection), "utf8"),
        writeFile(claimPath, JSON.stringify(evidence.claimDeclaration), "utf8"),
      ]);
      const child = Bun.spawnSync([
        process.execPath,
        "-e",
        `const { validateStableLocomoClaimEvidence } = await import("./scripts/run-v0-7-release-readiness.ts");
const projection = await Bun.file(process.env.CROSS_HOME_PROJECTION).json();
const claimDeclaration = await Bun.file(process.env.CROSS_HOME_CLAIM).json();
console.log(JSON.stringify(await validateStableLocomoClaimEvidence({ claimDeclaration, projection, repoRoot: process.env.CROSS_HOME_REPO })));`,
      ], {
        cwd: new URL("../..", import.meta.url).pathname,
        env: {
          ...process.env,
          CROSS_HOME_CLAIM: claimPath,
          CROSS_HOME_PROJECTION: projectionPath,
          CROSS_HOME_REPO: repoRoot,
          HOME: "/home/linux-verifier",
        },
      });
      expect(child.exitCode).toBe(0);
      expect(JSON.parse(child.stdout.toString().trim())).toEqual([]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("rejects retrieval drift on a successful pass-one row before seed resume", async () => {
    const repoRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-locomo-protocol2-pass1-drift-"),
    );
    try {
      const evidence = await writeValidCurrentLocomoEvidence(repoRoot, {
        recoveredSeedCaseId: "locomo-conv-43",
      });
      const passOnePath = join(
        repoRoot,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-smoke-report.json",
      );
      const passOne = JSON.parse(await readFile(passOnePath, "utf8")) as {
        cases: Array<{
          caseId: string;
          retrievedTurnIds: string[];
        }>;
      };
      const successful = passOne.cases.find(
        (row) => row.caseId !== "locomo-conv-43",
      )!;
      successful.retrievedTurnIds = ["post-hoc-retrieval-drift"];
      const passOneRaw = JSON.stringify(passOne);
      await rewriteTrackedEvidence({
        kind: "seed-attempt-1-report",
        projection: evidence.projection,
        raw: passOneRaw,
        repoRoot,
      });
      const passOneIdentity = evidenceIdentity(
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-smoke-report.json",
        passOneRaw,
      );
      const receiptPath = join(
        repoRoot,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
      );
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
        seedAttempts: typeof evidence.projection.seedAttempts;
      };
      receipt.seedAttempts[0]!.report = passOneIdentity;
      evidence.projection.seedAttempts = receipt.seedAttempts;
      await rewriteTrackedEvidence({
        kind: "execution-receipt",
        projection: evidence.projection,
        raw: JSON.stringify(receipt),
        repoRoot,
      });

      await expect(validateStableLocomoClaimEvidence({
        ...evidence,
        repoRoot,
      })).resolves.toContain(
        "full-claim protocol-v2 seed attempt history is inconsistent",
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

  it("rejects protocol-v2 receipt limits, old caches, and a non-consumed sentinel", async () => {
    for (const mutation of ["max-launches", "old-cache", "sentinel"] as const) {
      const repoRoot = await mkdtemp(
        join(tmpdir(), `goodmemory-locomo-protocol2-${mutation}-`),
      );
      try {
        const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
        const receiptPath = join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
        );
        const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
          maxSeedLaunches: number;
          seedAttempts: Array<{
            extractionCache: { bytes: number; path: string; sha256: string };
          }>;
          sentinel: { bytes: number; path: string; sha256: string };
        };
        if (mutation === "max-launches") {
          receipt.maxSeedLaunches = 3;
        } else if (mutation === "old-cache") {
          receipt.seedAttempts[0]!.extractionCache.path =
            "reports/release/v0.7/v0.7.3-locomo-claim-attempt-2-failed/extraction-cache.jsonl";
        } else {
          const sentinelPath = join(repoRoot, receipt.sentinel.path);
          const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
            state: string;
          };
          sentinel.state = "ready";
          const sentinelRaw = JSON.stringify(sentinel);
          await rewriteTrackedEvidence({
            kind: "protocol-attempt-sentinel",
            projection: evidence.projection,
            raw: sentinelRaw,
            repoRoot,
          });
          receipt.sentinel = evidenceIdentity(
            "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
            sentinelRaw,
          );
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
          mutation === "sentinel"
            ? "full-claim protocol-v2 sentinel is inconsistent"
            : mutation === "old-cache"
              ? "full-claim protocol-v2 seed attempt history is inconsistent"
              : "full-claim protocol-v2 execution receipt is inconsistent",
        );
      } finally {
        await rm(repoRoot, { force: true, recursive: true });
      }
    }
  });

  it("rejects post-hoc preregistration or a sentinel claimed to predate itself", async () => {
    for (const mutation of ["preregistration", "sentinel"] as const) {
      const repoRoot = await mkdtemp(
        join(tmpdir(), `goodmemory-locomo-protocol2-git-${mutation}-`),
      );
      try {
        const evidence = await writeValidCurrentLocomoEvidence(repoRoot);
        const receiptPath = join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
        );
        const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
          preregistration: { bytes: number; path: string; sha256: string };
          sentinel: { bytes: number; path: string; sha256: string };
          sources: {
            preregistration: { bytes: number; path: string; sha256: string };
            sentinel: { bytes: number; path: string; sha256: string };
          };
        };
        const kind = mutation === "preregistration"
          ? "protocol-preregistration"
          : "protocol-attempt-sentinel";
        const identity = evidence.projection.sourceArtifacts.find(
          (artifact) => artifact.kind === kind,
        )!;
        const value = JSON.parse(
          await readFile(join(repoRoot, identity.path), "utf8"),
        ) as Record<string, unknown>;
        if (mutation === "preregistration") {
          value.generatedAt = "2026-08-10T09:30:00.000Z";
        } else {
          value.releaseCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");
        }
        const raw = JSON.stringify(value);
        await rewriteTrackedEvidence({
          kind,
          projection: evidence.projection,
          raw,
          repoRoot,
        });
        const updatedIdentity = evidenceIdentity(identity.path, raw);
        if (mutation === "preregistration") {
          receipt.preregistration = updatedIdentity;
          receipt.sources.preregistration = updatedIdentity;
        } else {
          receipt.sentinel = updatedIdentity;
          receipt.sources.sentinel = updatedIdentity;
        }
        await rewriteTrackedEvidence({
          kind: "execution-receipt",
          projection: evidence.projection,
          raw: JSON.stringify(receipt),
          repoRoot,
        });

        await expect(validateStableLocomoClaimEvidence({
          ...evidence,
          repoRoot,
        })).resolves.toContain(
          "full-claim protocol-v2 git boundary is inconsistent",
        );
      } finally {
        await rm(repoRoot, { force: true, recursive: true });
      }
    }
  });

  it("binds tracked claim and official-runner bytes to protocol candidate C", async () => {
    for (const source of ["claim", "official-runner"] as const) {
      const repoRoot = await mkdtemp(
        join(tmpdir(), `goodmemory-locomo-protocol2-source-${source}-`),
      );
      try {
        const evidence = await writeValidCurrentLocomoEvidence(repoRoot, {
          ...(source === "claim"
            ? { protocolCandidateClaimRecipeRaw: "{\"stale\":true}\n" }
            : {
                protocolCandidateOfficialRunnerRaw:
                  "export const officialPrompt = 'stale';\n",
              }),
        });
        await expect(validateStableLocomoClaimEvidence({
          ...evidence,
          repoRoot,
        })).resolves.toContain(
          "full-claim protocol-v2 git boundary is inconsistent",
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

  it("rejects a packed production closure with undici or a high npm advisory", () => {
    const cleanLock = JSON.stringify({
      packages: {
        "": { dependencies: { goodmemory: "file:goodmemory-0.7.3.tgz" } },
        "node_modules/goodmemory": { version: "0.7.3" },
      },
    });
    const cleanAudit = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 0, high: 0 },
      },
    });
    expect(evaluateV07PackedProductionDependencyClosure({
      auditExitCode: 0,
      auditRaw: cleanAudit,
      packageLockRaw: cleanLock,
    })).toEqual([]);

    const cleanModernUndiciLock = JSON.stringify({
      packages: {
        "": { dependencies: { goodmemory: "file:goodmemory-0.7.3.tgz" } },
        "node_modules/undici": { version: "8.9.0" },
      },
    });
    expect(evaluateV07PackedProductionDependencyClosure({
      auditExitCode: 0,
      auditRaw: cleanAudit,
      packageLockRaw: cleanModernUndiciLock,
    })).toEqual([]);

    const vulnerableLock = JSON.stringify({
      packages: {
        "": { dependencies: { goodmemory: "file:goodmemory-0.7.3.tgz" } },
        "node_modules/undici": { version: "5.29.0" },
      },
    });
    expect(evaluateV07PackedProductionDependencyClosure({
      auditExitCode: 1,
      auditRaw: JSON.stringify({
        metadata: {
          vulnerabilities: { critical: 0, high: 1 },
        },
      }),
      packageLockRaw: vulnerableLock,
    })).toEqual([
      "packed production dependency closure must not install undici 5.x",
      "packed production dependency audit reported 1 high and 0 critical vulnerabilities",
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

  it("accepts only a canonical schema 9 measurement evidence root", () => {
    expect(() => assertV073MeasurementEvidenceRoot(
      "/tmp/driver/reports/release/v0.7/" +
        "v0.7.3-lifecycle-schema9-evidence",
    )).not.toThrow();
    for (const root of [
      "/tmp/measurement-evidence",
      "/tmp/driver/reports/release/v0.7/" +
        "v0.7.3-lifecycle-schema8-evidence",
      "/tmp/driver/reports/release/v0.7/" +
        "v0.7.3-lifecycle-schema9-evidence-drifted",
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence",
      "/tmp/driver/reports/release/v0.7/../v0.7/" +
        "v0.7.3-lifecycle-schema9-evidence",
    ]) {
      expect(() => assertV073MeasurementEvidenceRoot(root)).toThrow(
        "canonical schema 9 evidence root",
      );
    }
  });

  it("accepts only a completed lifecycle artifact bound to the candidate commit", async () => {
    const candidateCommit = "a".repeat(40);
    const bundlePrefix =
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence/";
    const bundlePath = (path: string) =>
      `${bundlePrefix}${path.replace(/^\/+|\//gu, "-")}`;
    const artifactIdentity = (path: string, fill: string) => ({
      bytes: 100,
      path: bundlePath(path),
      sha256: fill.repeat(64),
    });
    const tapeSha256 = "f".repeat(64);
    const providerSession = {
      coalesced: 0,
      hits: 10,
      liveRequests: 0,
      misses: 0,
      mode: "replay",
      non2xxResponses: 0,
      requestFingerprintMultisetSha256: "e".repeat(64),
      requestSequenceSha256: "d".repeat(64),
      requests: 10,
      sequenceMismatches: 0,
      targetCounts: { embedding: 2, eval: 7, judge: 1 },
      tapeSha256,
      transportAttemptLedgerSha256:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      transportAttempts: 0,
      transportErrors: 0,
    };
    const artifact = {
      artifacts: {
        attemptSentinel: {
          bytes: 100,
          path:
            "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json",
          sha256: "0".repeat(64),
        },
        manifest: artifactIdentity("manifest.json", "0"),
        protocolInput: artifactIdentity("protocol-input.json", "1"),
        providerPreflight: {
          receipt: artifactIdentity("provider-preflight/execution-receipt.json", "1"),
          tape: artifactIdentity("provider-preflight/tape.json", "1"),
        },
        providerFree: {
          c1Baseline: artifactIdentity("provider-free/c1-baseline.json", "2"),
          c1BaselineReceipt: artifactIdentity("provider-free/c1-baseline-receipt.json", "2"),
          c1Candidate: artifactIdentity("provider-free/c1-candidate.json", "3"),
          c1CandidateReceipt: artifactIdentity("provider-free/c1-candidate-receipt.json", "3"),
          c40Baseline: artifactIdentity("provider-free/c40-baseline.json", "4"),
          c40BaselineReceipt: artifactIdentity("provider-free/c40-baseline-receipt.json", "4"),
          c40Candidate: artifactIdentity("provider-free/c40-candidate.json", "5"),
          c40CandidateReceipt: artifactIdentity("provider-free/c40-candidate-receipt.json", "5"),
        },
        providerReplay: {
          baselineDiscoveryReceipt: artifactIdentity("provider-replay/baseline-discovery.json", "6"),
          baselineFormalOfficial: artifactIdentity("provider-replay/baseline-official.json", "7"),
          baselineFormalProgress: artifactIdentity("provider-replay/baseline-progress.jsonl", "7"),
          baselineFormalReport: artifactIdentity("provider-replay/baseline-report.json", "8"),
          baselineFormalReceipt: artifactIdentity("provider-replay/baseline-formal.json", "9"),
          candidateDiscoveryReceipt: artifactIdentity("provider-replay/candidate-discovery.json", "a"),
          candidateFormalOfficial: artifactIdentity("provider-replay/candidate-official.json", "b"),
          candidateFormalProgress: artifactIdentity("provider-replay/candidate-progress.jsonl", "b"),
          candidateFormalReport: artifactIdentity("provider-replay/candidate-report.json", "c"),
          candidateFormalReceipt: artifactIdentity("provider-replay/candidate-formal.json", "d"),
          tape: artifactIdentity(
            "provider-response-tape/manifest.json",
            "e",
          ),
        },
        scenarioReceipt: artifactIdentity("scenario/execution-receipt.json", "f"),
      },
      baselineCommit: "456edd106f29118b3455bf21c43d7b3107b48213",
      blockers: [],
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      claimBoundary:
        "Provider-free hard gate, frozen provider replay, and explicit provider-variance spread.",
      fullClaimRerunRequired: true,
      generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
      hardGate: {
        providerFree: [{ concurrency: 1 }, { concurrency: 40 }],
        scenarioReplay: { failures: 0, passed: 8 },
      },
      liveDiagnostic: {
        signTest: {
          alpha: 0.05,
          discordant: 26,
          improved: 11,
          pValue: 0.5571970939636236,
          regressed: 15,
          significant: false,
          test: "exact_two_sided_sign_test",
        },
        totalQuestions: 233,
      },
      providerReplay: {
        baselineExecutionFailures: 0,
        baselineJudgeFailures: 0,
        candidateExecutionFailures: 0,
        candidateJudgeFailures: 0,
        concurrency: 1 as const,
        discovery: {
          baseline: { ...providerSession, mode: "prefetch" },
          candidate: { ...providerSession, mode: "prefetch" },
        },
        formal: { baseline: providerSession, candidate: providerSession },
        tapeEntryCount: 10,
        tapeSha256,
        tapeTargetCounts: { embedding: 2, eval: 7, judge: 1 },
      },
      providerPreflight: providerPreflightPlan(),
      releaseAllowed: true,
      researchRecordRequired: false,
      schemaVersion: 9,
    };

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact,
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      id: "v0.7.3-lifecycle-protection",
      status: "pass",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, schemaVersion: 3 },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("schemaVersion must be 9"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: {
        ...artifact,
        candidateCommit: "c",
      },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("candidate"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, releaseAllowed: false },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({ status: "fail" }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, providerPreflight: undefined },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("five successful probes"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: {
        ...artifact,
        providerReplay: {
          ...artifact.providerReplay,
          discovery: {
            ...artifact.providerReplay.discovery,
            baseline: {
              ...artifact.providerReplay.discovery.baseline,
              non2xxResponses: 1,
            },
          },
        },
      },
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
          providerReplay: {
            ...artifact.artifacts.providerReplay,
            tape: undefined,
          },
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

  it("recomputes schema 9 lifecycle evidence from bound preflight, deterministic, and frozen-replay bytes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-v073-replacement-bundle-"));
    const evidencePrefix =
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence";
    const measurementEvidenceRoot = join(repoRoot, evidencePrefix);
    const candidateCommit = "c5665458f79adbc7d35eccb2155dc40b2a443ae2";
    const writeEvidence = async (name: string, raw: string) => {
      const path = `${evidencePrefix}/${name}`;
      const absolutePath = join(repoRoot, path);
      await mkdir(join(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, raw);
      return {
        bytes: Buffer.byteLength(raw, "utf8"),
        path,
        sha256: createHash("sha256").update(raw).digest("hex"),
      };
    };
    const writeTapeBundle = async (tape: Parameters<
      typeof encodeProviderResponseTapeBundle
    >[0]) => {
      const encoded = encodeProviderResponseTapeBundle(tape);
      const root = join(repoRoot, evidencePrefix, "provider-response-tape");
      await rm(root, { force: true, recursive: true });
      await mkdir(root, { recursive: true });
      await Promise.all(encoded.parts.map((part) =>
        writeFile(join(root, part.path), part.bytes)
      ));
      return writeEvidence(
        "provider-response-tape/manifest.json",
        encoded.manifestRaw,
      );
    };
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const benchmarkRoot = join(
      homedir(),
      ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
    );
    const frozenRows = frozenV073LocomoQuestionSelection()
      .filter((row) =>
        row.caseId === "locomo-conv-26" || row.caseId === "locomo-conv-30"
      )
      .map((row, index) => {
        const evidenceTurnId = `evidence-${index}`;
        const retrieved = index % 2 === 1;
        return {
          ...row,
          evidenceRecall: retrieved ? 1 : 0,
          evidenceTurnIds: [evidenceTurnId],
          goldEvidenceFullyRetrieved: retrieved,
          missingEvidenceTurnIds: retrieved ? [] : [evidenceTurnId],
          noiseTurnCount: 0,
          noiseTurnIds: [],
          retrievedTurnIds: retrieved ? [evidenceTurnId] : [],
        };
      });
    const providerFreeReport = (concurrency: number) => ({
      answerEvaluation: "deferred-to-live-mode",
      benchmarkFingerprint:
        "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
      caseIds: ["locomo-conv-26", "locomo-conv-30"],
      cases: frozenRows,
      concurrency,
      executionFailures: 0,
      externalRoot: benchmarkRoot,
      generalizedFusion: true,
      generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
      ingestMode: "raw-turns",
      labelFreeIngest: true,
      mode: "retrieval-only",
      profilesCompared: ["goodmemory-recommended"],
      providerReranking: false,
      questionCategories: [
        "single_hop",
        "multi_hop",
        "temporal",
        "open_domain",
      ],
      questionCount: frozenRows.length,
      resume: false,
      semanticCandidateEmbeddingSource: "none",
    });
    const formal = {
      cases: frozenRows.map((row) => ({
        ...row,
        answerCorrect: true,
        answerTokenF1: 1,
      })),
      executionFailures: 0,
      questionCount: frozenRows.length,
    };
    const official = { judgeFailures: 0, overallAccuracy: 1 };
    const officialProgressRaw = frozenRows
      .map((row) => JSON.stringify({ correct: true, questionId: row.questionId }))
      .join("\n") + "\n";
    const semanticHeadersSha256 = createHash("sha256")
      .update(JSON.stringify([]))
      .digest("hex");
    const tapeEntries = [
      ["embedding", "/embeddings"],
      ["eval", "/chat/completions"],
      ["judge", "/chat/completions"],
    ].map(([targetId, path]) => {
      const body = JSON.stringify({ targetId });
      const responseBytes = Buffer.from(`ok-${targetId}`);
      return {
        fingerprint: fingerprintProviderRequest({
          body,
          method: "POST",
          path: path!,
          targetId: targetId!,
        }),
        occurrence: 0,
        request: {
          canonicalBodySha256: createHash("sha256").update(body).digest("hex"),
          method: "POST",
          path: path!,
          semanticHeadersSha256,
          targetId: targetId!,
        },
        response: {
          bodyBase64: responseBytes.toString("base64"),
          bytes: responseBytes.byteLength,
          contentType: "text/plain",
          sha256: createHash("sha256").update(responseBytes).digest("hex"),
          status: 200,
          statusText: "OK",
        },
      };
    });
    const tapeRaw = serializeProviderResponseTape({
      entries: tapeEntries,
      schemaVersion: 3,
    });
    const tapeSha256 = createHash("sha256").update(tapeRaw).digest("hex");
    const requestFingerprintMultisetSha256 = createHash("sha256")
      .update(JSON.stringify(
        tapeEntries
          .map((entry): [string, number] => [entry.fingerprint, 1])
          .sort(([left], [right]) => left.localeCompare(right)),
      ))
      .digest("hex");
    const requestSequence = tapeEntries.map((entry) => ({
      fingerprint: entry.fingerprint,
      ...entry.request,
    }));
    const requestSequenceSha256 = fingerprintProviderRequestSequence(
      requestSequence,
    );
    const transportAttemptLedger = requestSequence.map(
      ({ fingerprint, targetId }, requestIndex) => ({
        fingerprint,
        outcome: "response" as const,
        requestIndex,
        responseStatus: 200,
        targetId,
      }),
    );
    const transportAttemptLedgerSha256 =
      fingerprintProviderTransportAttemptLedger(transportAttemptLedger);
    const emptyTransportAttemptLedgerSha256 =
      fingerprintProviderTransportAttemptLedger([]);
    const replaySession = {
      coalesced: 0,
      hits: 3,
      liveRequests: 0,
      misses: 0,
      mode: "replay" as const,
      non2xxResponses: 0,
      requestFingerprintMultisetSha256,
      requestSequenceSha256,
      requests: 3,
      sequenceMismatches: 0,
      targetCounts: { embedding: 1, eval: 1, judge: 1 },
      tapeSha256,
      transportAttemptLedgerSha256: emptyTransportAttemptLedgerSha256,
      transportAttempts: 0,
      transportErrors: 0,
    };
    const discoverySession = {
      coalesced: 0,
      hits: 0,
      liveRequests: 3,
      misses: 3,
      mode: "prefetch" as const,
      non2xxResponses: 0,
      requestFingerprintMultisetSha256,
      requestSequenceSha256,
      requests: 3,
      sequenceMismatches: 0,
      targetCounts: { embedding: 1, eval: 1, judge: 1 },
      tapeSha256,
      transportAttemptLedgerSha256,
      transportAttempts: 3,
      transportErrors: 0,
    };
    const replayReceiptSession = {
      ...replaySession,
      requestSequence,
      sequenceMismatchDetails: [],
      transportAttemptLedger: [],
    };
    const discoveryReceiptSession = {
      ...discoverySession,
      requestSequence,
      sequenceMismatchDetails: [],
      transportAttemptLedger,
    };
    const preflightOccurrences = new Map<string, number>();
    const preflightTapeEntries =
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence.map((identity) => {
        const occurrence = preflightOccurrences.get(identity.fingerprint) ?? 0;
        preflightOccurrences.set(identity.fingerprint, occurrence + 1);
        const responseBody = identity.targetId === "embedding"
          ? JSON.stringify({ data: [{ embedding: [0.5, -0.5] }] })
          : identity.targetId === "eval"
            ? `data: ${JSON.stringify({
                choices: [{
                  delta: {
                    content: `<think>fixture</think>${JSON.stringify({
                      orderedCandidateIds: ["candidate-1"],
                    })}`,
                  },
                }],
              })}\n\ndata: [DONE]\n\n`
            : JSON.stringify({
                choices: [{ message: { content: "YES" } }],
              });
        const responseBytes = Buffer.from(responseBody);
        const {
          fingerprint,
          ...request
        } = identity;
        return {
          fingerprint,
          occurrence,
          request,
          response: {
            bodyBase64: responseBytes.toString("base64"),
            bytes: responseBytes.byteLength,
            contentType: identity.targetId === "eval"
              ? "text/event-stream"
              : "application/json",
            sha256: createHash("sha256").update(responseBytes).digest("hex"),
            status: 200,
            statusText: "OK",
          },
        };
      });
    const preflightTapeRaw = serializeProviderResponseTape({
      entries: preflightTapeEntries,
      schemaVersion: 3,
    });
    const preflightTapeSha256 = createHash("sha256")
      .update(preflightTapeRaw)
      .digest("hex");
    const preflightFingerprintCounts = new Map<string, number>();
    for (const { fingerprint } of
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence) {
      preflightFingerprintCounts.set(
        fingerprint,
        (preflightFingerprintCounts.get(fingerprint) ?? 0) + 1,
      );
    }
    const preflightRequestFingerprintMultisetSha256 = createHash("sha256")
      .update(JSON.stringify(
        [...preflightFingerprintCounts.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      ))
      .digest("hex");
    const preflightTransportAttemptLedger =
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence.map(
        ({ fingerprint, targetId }, requestIndex) => ({
          fingerprint,
          outcome: "response" as const,
          requestIndex,
          responseStatus: 200,
          targetId,
        }),
      );
    const preflightSession = {
      coalesced: 0,
      hits: 0,
      liveRequests: 5,
      misses: 5,
      mode: "prefetch" as const,
      name: "provider-availability-preflight",
      non2xxResponses: 0,
      requestFingerprintMultisetSha256:
        preflightRequestFingerprintMultisetSha256,
      requestSequence: V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence,
      requestSequenceSha256:
        V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
      requests: 5,
      sequenceMismatchDetails: [],
      sequenceMismatches: 0,
      tapeSha256: preflightTapeSha256,
      targetCounts: { embedding: 1, eval: 3, judge: 1 },
      transportAttemptLedger: preflightTransportAttemptLedger,
      transportAttemptLedgerSha256:
        fingerprintProviderTransportAttemptLedger(
          preflightTransportAttemptLedger,
        ),
      transportAttempts: 5,
      transportErrors: 0,
    };
    const protocolInput = {
      baselineCommit: "456edd106f29118b3455bf21c43d7b3107b48213",
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      deterministicArms: [
        {
          baseline: providerFreeReport(1),
          candidate: providerFreeReport(1),
          concurrency: 1,
        },
        {
          baseline: providerFreeReport(40),
          candidate: providerFreeReport(40),
          concurrency: 40,
        },
      ],
      providerPreflight: providerPreflightPlan(),
      providerReplay: {
        baselineExecutionFailures: 0,
        baselineJudgeFailures: 0,
        candidateExecutionFailures: 0,
        candidateJudgeFailures: 0,
        concurrency: 1 as const,
        discovery: {
          baseline: discoverySession,
          candidate: discoverySession,
        },
        formal: { baseline: replaySession, candidate: replaySession },
        pointDeltas: {
          evidenceRecall: 0,
          officialScore: 0,
          strictAnswerScore: 0,
        },
        tapeEntryCount: 3,
        tapeSha256,
        tapeTargetCounts: { embedding: 1, eval: 1, judge: 1 },
      },
      questionTransitions: { improved: 0, regressed: 0, total: 233 },
      scenarioReplay: { failures: 0, passed: 8 },
    };
    const attemptSentinelPath =
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json";
    const storagePreflight = {
      availableBytes:
        V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes,
      minimumAvailableBytes:
        V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes,
      path: "reports/release/v0.7",
    };
    const attemptSentinelRaw = json({
      baselineCommit: protocolInput.baselineCommit,
      candidateCommit: protocolInput.candidateCommit,
      generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
      providerPreflight: protocolInput.providerPreflight,
      requestSequenceSha256:
        V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
      schemaVersion: 9,
      state: "consumed",
      storagePreflight,
    });

    try {
      await mkdir(join(repoRoot, "reports/release/v0.7"), {
        recursive: true,
      });
      await writeFile(join(repoRoot, attemptSentinelPath), attemptSentinelRaw);
      const attemptSentinel = evidenceIdentity(
        attemptSentinelPath,
        attemptSentinelRaw,
      );
      await mkdir(join(repoRoot, "benchmark-claims"), { recursive: true });
      await writeFile(join(repoRoot, "benchmark-claims/locomo.json"), CLAIM_RECIPE_RAW);
      const harnessSources = {
        claimRecipe: ["benchmark-claims/locomo.json", CLAIM_RECIPE_RAW],
        officialRunner: [
          "scripts/rescore-official-protocols.ts",
          readFileSync("scripts/rescore-official-protocols.ts", "utf8"),
        ],
        reanswerRunner: [
          "scripts/reanswer-phase-65-locomo-report.ts",
          readFileSync("scripts/reanswer-phase-65-locomo-report.ts", "utf8"),
        ],
        seedRunner: [
          "scripts/run-phase-65-locomo-smoke.ts",
          readFileSync("scripts/run-phase-65-locomo-smoke.ts", "utf8"),
        ],
      } as const;
      for (const [path, raw] of Object.values(harnessSources)) {
        await mkdir(join(repoRoot, path, ".."), { recursive: true });
        await writeFile(join(repoRoot, path), raw);
      }
      const measurementHarness = Object.fromEntries(
        Object.entries(harnessSources).map(([name, [path, raw]]) => [name, {
          bytes: Buffer.byteLength(raw, "utf8"),
          path,
          sha256: createHash("sha256").update(raw).digest("hex"),
        }]),
      ) as Record<string, { bytes: number; path: string; sha256: string }>;
      const sourceIdentity = {
        claimCommandTemplateSha256:
          deriveV073ClaimCommandTemplateSha256(CLAIM_RECIPE_RAW),
        claimSourceSha256: measurementHarness.claimRecipe!.sha256,
        officialSourceSha256: measurementHarness.officialRunner!.sha256,
        promptSha256: deriveV073PromptSha256(),
        reanswerSourceSha256: measurementHarness.reanswerRunner!.sha256,
        seedSourceSha256: measurementHarness.seedRunner!.sha256,
      };
      const providers = {
        assisted: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        embedding: {
          gateway: "https://openrouter.ai/api/v1",
          model: "text-embedding-3-small",
          provider: "openai",
        },
        eval: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        judge: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.5",
          provider: "openai",
        },
        reranking: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
      };
      const baselineWorktree = "/tmp/baseline-v073";
      const candidateWorktree = "/tmp/candidate-v073";
      const preflightTape = await writeEvidence(
        "provider-preflight/tape.json",
        preflightTapeRaw,
      );
      const preflightReceipt = await writeEvidence(
        "provider-preflight/execution-receipt.json",
        json({
          generatedBy:
            "scripts/run-v0-7-3-replacement-protection-gate.ts",
          probePlan: providerPreflightPlan(),
          session: preflightSession,
          tape: preflightTape,
        }),
      );
      const manifestValue = {
        baseline: {
          branch: null,
          commit: protocolInput.baselineCommit,
          statusPorcelain: "",
          worktreePath: baselineWorktree,
        },
        benchmark: {
          bytes: 2_490_457,
          fingerprint:
            "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
          root: benchmarkRoot,
          sha256:
            "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28",
        },
        candidate: {
          branch: null,
          commit: candidateCommit,
          statusPorcelain: "",
          worktreePath: candidateWorktree,
        },
        formalAttempt: { sentinel: attemptSentinel },
        generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
        measurementEvidenceRoot,
        measurementHarness,
        providerPreflight: {
          receipt: preflightReceipt,
          summary: providerPreflightPlan(),
          tape: preflightTape,
        },
        storagePreflight,
        protocol: {
          assistedExtractionMaxAttempts: 4,
          assistedExtractionRequestTimeoutMs: 120_000,
          claimCommandTemplateSha256: sourceIdentity.claimCommandTemplateSha256,
          failureTapeCredentialMaterial: "excluded-before-persistence",
          failedDiscoveryTape: "atomic-before-stage-error",
          formalNetworkOnMiss: false,
          hardRegressionLimit: 0.01,
          promptSha256: sourceIdentity.promptSha256,
          providerFailureRecovery:
            "immediate-same-fingerprint-retry-to-2xx",
          providerPreflightFormalAttemptBoundary:
            "schema9-consumed-sentinel-created-only-after-success",
          providerPreflightProbeOrder:
            V073_PROVIDER_PREFLIGHT_POLICY.probeOrder,
          providerPreflightRequestSequenceSha256:
            V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
          providerPreflightRequestTimeoutMs:
            V073_PROVIDER_PREFLIGHT_POLICY.requestTimeoutMs,
          providerPreflightRetries: 0,
          providerFreeConcurrency: [1, 40],
          providerLogCredentialMaterial:
            "redacted-before-output-hash-and-persistence",
          providerReplayConcurrency: 1,
          semanticSeedRunId: V073_SEMANTIC_SEED_RUN_ID,
          signTestAlpha: 0.05,
          storagePreflightMinimumAvailableBytes:
            V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes,
          tapeInputIdentity:
            "ordered request fingerprint + logical target + method + path/query + canonical-body digest + semantic-header digest",
          tapeArtifactEncoding: "canonical-json-sharded-gzip",
          tapeMaxPartBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes,
          tapeMaxParts: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts,
          tapeMaxRawBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes,
          tapeMaxTotalBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes,
          tapePartUncompressedBytes:
            PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes,
          tapeRequestIdentity:
            "sha256(logical-target + method + path/query + canonical-json-body + semantic-headers)",
          tapeResponseVariants: "ordered-per-fingerprint",
          tapeSequenceCoverage: "exact-discovery-occurrence-union",
          transportAttemptLedger: "hash-only-session-receipt",
          transportErrorResponseStatus: 502,
          transportErrors: "record-and-replay",
          transportProxyRetries: 0,
        },
        providers,
        schemaVersion: 9,
      };
      const sharedStdout = await writeEvidence("logs/stdout.log", "8 pass\n0 fail\n");
      const sharedStderr = await writeEvidence("logs/stderr.log", "");
      const [
        manifest,
        protocolInputIdentity,
        c1Baseline,
        c1Candidate,
        c40Baseline,
        c40Candidate,
        baselineFormalReport,
        candidateFormalReport,
        baselineFormalOfficial,
        candidateFormalOfficial,
        baselineFormalProgress,
        candidateFormalProgress,
        tape,
      ] = await Promise.all([
        writeEvidence("manifest.json", json(manifestValue)),
        writeEvidence("protocol-input.json", json(protocolInput)),
        writeEvidence("provider-free/c1-baseline.json", json(providerFreeReport(1))),
        writeEvidence("provider-free/c1-candidate.json", json(providerFreeReport(1))),
        writeEvidence("provider-free/c40-baseline.json", json(providerFreeReport(40))),
        writeEvidence("provider-free/c40-candidate.json", json(providerFreeReport(40))),
        writeEvidence("provider-replay/baseline-report.json", json(formal)),
        writeEvidence("provider-replay/candidate-report.json", json(formal)),
        writeEvidence("provider-replay/baseline-official.json", json(official)),
        writeEvidence("provider-replay/candidate-official.json", json(official)),
        writeEvidence("provider-replay/baseline-progress.jsonl", officialProgressRaw),
        writeEvidence("provider-replay/candidate-progress.jsonl", officialProgressRaw),
        writeTapeBundle({ entries: tapeEntries, schemaVersion: 3 }),
      ]);
      const providerFreeReceipt = async (input: {
        concurrency: 1 | 40;
        label: "baseline" | "candidate";
        report: typeof c1Baseline;
      }) => {
        const runId = `v073-provider-free-c${input.concurrency}-${input.label}`;
        return writeEvidence(
          `provider-free/${runId}-receipt.json`,
          json({
            args: buildV073ProviderFreeArgs({
              benchmarkRoot,
              concurrency: input.concurrency,
              outputDir: join(measurementEvidenceRoot, "provider-free"),
              runId,
            }),
            command: "bun",
            commit: input.label === "baseline"
              ? protocolInput.baselineCommit
              : candidateCommit,
            concurrency: input.concurrency,
            cwd: input.label === "baseline" ? baselineWorktree : candidateWorktree,
            exitCode: 0,
            generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
            label: input.label,
            report: input.report,
            stderr: sharedStderr,
            stdout: sharedStdout,
          }),
        );
      };
      const [
        c1BaselineReceipt,
        c1CandidateReceipt,
        c40BaselineReceipt,
        c40CandidateReceipt,
      ] = await Promise.all([
        providerFreeReceipt({ concurrency: 1, label: "baseline", report: c1Baseline }),
        providerFreeReceipt({ concurrency: 1, label: "candidate", report: c1Candidate }),
        providerFreeReceipt({ concurrency: 40, label: "baseline", report: c40Baseline }),
        providerFreeReceipt({ concurrency: 40, label: "candidate", report: c40Candidate }),
      ]);
      const scenarioReceipt = await writeEvidence("scenario/receipt.json", json({
        args: ["test", "tests/scenarios"],
        candidateCommit,
        command: "bun",
        cwd: candidateWorktree,
        exitCode: 0,
        failures: 0,
        generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
        passed: 8,
        stderr: sharedStderr,
        stdout: sharedStdout,
      }));
      const providerReceipt = async (input: {
        commit: string;
        formalStage: boolean;
        name: string;
        session: typeof replayReceiptSession | typeof discoveryReceiptSession;
        stage: string;
        worktreePath: string;
      }) => {
        const expectedArm = buildV073StageArm({
          benchmarkRoot,
          claimRecipeRaw: CLAIM_RECIPE_RAW,
          commit: input.commit,
          outputDir: measurementEvidenceRoot,
          providers,
          sourceIdentity: {
            officialSourceSha256: sourceIdentity.officialSourceSha256,
            reanswerSourceSha256: sourceIdentity.reanswerSourceSha256,
            seedSourceSha256: sourceIdentity.seedSourceSha256,
          },
          stage: input.stage,
          worktreePath: input.worktreePath,
        });
        const commandChain = routeV073CommandChainThroughTape(
          buildV073PairedCommandChain(expectedArm.arm, CLAIM_RECIPE_RAW),
          {
            assisted: "http://127.0.0.1:4567/assisted",
            embedding: "http://127.0.0.1:4567/embedding",
            eval: "http://127.0.0.1:4567/eval",
            judge: "http://127.0.0.1:4567/judge",
            reranking: "http://127.0.0.1:4567/reranking",
          },
          { replayCredentials: input.formalStage },
        );
        return writeEvidence(input.name, json({
        commandChain,
        commit: input.commit,
        executionOrder: V073_PROVIDER_STAGE_ORDER,
        generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
        outputs: {
          finalReport: input.commit === protocolInput.baselineCommit
            ? baselineFormalReport
            : candidateFormalReport,
          officialProgress: input.commit === protocolInput.baselineCommit
            ? baselineFormalProgress
            : candidateFormalProgress,
          officialSummary: input.commit === protocolInput.baselineCommit
            ? baselineFormalOfficial
            : candidateFormalOfficial,
          seedReport: input.commit === protocolInput.baselineCommit
            ? baselineFormalReport
            : candidateFormalReport,
        },
        session: input.session,
        sourceIdentity,
        stage: input.stage,
        stderr: sharedStderr,
        steps: V073_PROVIDER_STAGE_ORDER.map((step) => ({ exitCode: 0, step })),
        stdout: sharedStdout,
        }));
      };
      const [
        baselineDiscoveryReceipt,
        candidateDiscoveryReceipt,
        baselineFormalReceipt,
        candidateFormalReceipt,
      ] = await Promise.all([
        providerReceipt({
          commit: protocolInput.baselineCommit,
          formalStage: false,
          name: "provider-replay/baseline-discovery.json",
          session: discoveryReceiptSession,
          stage: "baseline-discovery",
          worktreePath: baselineWorktree,
        }),
        providerReceipt({
          commit: candidateCommit,
          formalStage: false,
          name: "provider-replay/candidate-discovery.json",
          session: discoveryReceiptSession,
          stage: "candidate-discovery",
          worktreePath: candidateWorktree,
        }),
        providerReceipt({
          commit: protocolInput.baselineCommit,
          formalStage: true,
          name: "provider-replay/baseline-formal.json",
          session: replayReceiptSession,
          stage: "baseline-formal",
          worktreePath: baselineWorktree,
        }),
        providerReceipt({
          commit: candidateCommit,
          formalStage: true,
          name: "provider-replay/candidate-formal.json",
          session: replayReceiptSession,
          stage: "candidate-formal",
          worktreePath: candidateWorktree,
        }),
      ]);
      const artifacts = {
        attemptSentinel,
        manifest,
        protocolInput: protocolInputIdentity,
        providerPreflight: {
          receipt: preflightReceipt,
          tape: preflightTape,
        },
        providerFree: {
          c1Baseline,
          c1BaselineReceipt,
          c1Candidate,
          c1CandidateReceipt,
          c40Baseline,
          c40BaselineReceipt,
          c40Candidate,
          c40CandidateReceipt,
        },
        providerReplay: {
          baselineDiscoveryReceipt,
          baselineFormalOfficial,
          baselineFormalProgress,
          baselineFormalReport,
          baselineFormalReceipt,
          candidateDiscoveryReceipt,
          candidateFormalOfficial,
          candidateFormalProgress,
          candidateFormalReport,
          candidateFormalReceipt,
          tape,
        },
        scenarioReceipt,
      };
      const artifact = {
        ...evaluateV073ReplacementProtection(protocolInput),
        artifacts,
      };

      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({ status: "pass" }));

      const gitDirectory = new TextDecoder().decode(Bun.spawnSync([
        "git",
        "rev-parse",
        "--absolute-git-dir",
      ]).stdout).trim();
      await writeFile(join(repoRoot, ".git"), `gitdir: ${gitDirectory}\n`);
      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        json({ claim: "fresh v0.7.3 publication", schemaVersion: 1 }),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({ status: "pass" }));
      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        CLAIM_RECIPE_RAW,
      );
      await rm(join(repoRoot, ".git"));

      const trackedEvidenceRoot = join(repoRoot, evidencePrefix);
      const externalEvidenceRoot = `${trackedEvidenceRoot}-external`;
      await rename(trackedEvidenceRoot, externalEvidenceRoot);
      await symlink(externalEvidenceRoot, trackedEvidenceRoot);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("real path"),
        status: "fail",
      }));
      await rm(trackedEvidenceRoot);
      await rename(externalEvidenceRoot, trackedEvidenceRoot);

      for (const driftedEvidenceRoot of [
        "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence",
        join(repoRoot, "measurement-evidence"),
        join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-lifecycle-schema8-evidence",
        ),
        `${measurementEvidenceRoot}-drifted`,
        `${repoRoot}/reports/release/v0.7/../v0.7/` +
          "v0.7.3-lifecycle-schema9-evidence",
      ]) {
        const driftedManifestRaw = json({
          ...manifestValue,
          measurementEvidenceRoot: driftedEvidenceRoot,
        });
        await writeFile(join(repoRoot, manifest.path), driftedManifestRaw);
        Object.assign(
          artifact.artifacts.manifest,
          evidenceIdentity(manifest.path, driftedManifestRaw),
        );
        expect(await evaluateV073LifecycleProtectionBundle({
          artifact,
          artifactPath:
            "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
          repoRoot,
        })).toEqual(expect.objectContaining({ status: "fail" }));
      }
      const restoredManifestRaw = json(manifestValue);
      await writeFile(join(repoRoot, manifest.path), restoredManifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, restoredManifestRaw),
      );

      const tapeManifest = JSON.parse(
        await readFile(join(repoRoot, tape.path), "utf8"),
      ) as { parts: Array<{ path: string }> };
      const firstTapePartPath = join(
        repoRoot,
        evidencePrefix,
        "provider-response-tape",
        tapeManifest.parts[0]!.path,
      );
      const firstTapePart = await readFile(firstTapePartPath);
      const mutatedTapePart = Uint8Array.from(firstTapePart);
      mutatedTapePart[mutatedTapePart.length - 1] ^= 1;
      await writeFile(firstTapePartPath, mutatedTapePart);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("bytes do not match"),
        status: "fail",
      }));
      await writeFile(firstTapePartPath, firstTapePart);

      const externalTapePartPath = join(repoRoot, "external-tape-part.json.gz");
      await writeFile(externalTapePartPath, firstTapePart);
      await rm(firstTapePartPath);
      await symlink(externalTapePartPath, firstTapePartPath);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("regular file"),
        status: "fail",
      }));
      await rm(firstTapePartPath);
      await writeFile(firstTapePartPath, firstTapePart);

      const extraTapePath = join(
        repoRoot,
        evidencePrefix,
        "provider-response-tape",
        "extra.json.gz",
      );
      await writeFile(extraTapePath, firstTapePart);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("directory closure"),
        status: "fail",
      }));
      await rm(extraTapePath);

      const legacyTapePath = join(
        repoRoot,
        evidencePrefix,
        "provider-response-tape",
        "provider-response-tape.json",
      );
      await writeFile(legacyTapePath, "{}\n");
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("directory closure"),
        status: "fail",
      }));
      await rm(legacyTapePath);

      const canonicalC1BaselinePath = c1Baseline.path;
      c1Baseline.path = canonicalC1BaselinePath.replace(
        "v0.7.3-lifecycle-schema9-evidence",
        "v0.7.3-lifecycle-evidence",
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("outside the tracked bundle"),
        status: "fail",
      }));
      c1Baseline.path = canonicalC1BaselinePath;

      for (const protocolDrift of [
        { assistedExtractionMaxAttempts: 3 },
        { assistedExtractionRequestTimeoutMs: 60_000 },
        { failureTapeCredentialMaterial: "persist-raw" },
        { failedDiscoveryTape: "after-stage-error" },
        { formalNetworkOnMiss: true },
        { hardRegressionLimit: 0.02 },
        { providerFailureRecovery: "allow-terminal-fallback" },
        { providerPreflightFormalAttemptBoundary: "root-before-preflight" },
        { providerPreflightProbeOrder: ["judge"] },
        { providerPreflightRequestSequenceSha256: "0".repeat(64) },
        { providerPreflightRequestTimeoutMs: 1 },
        { providerPreflightRetries: 1 },
        { providerFreeConcurrency: [1] },
        { providerLogCredentialMaterial: "persist-before-redaction" },
        { providerReplayConcurrency: 40 },
        { semanticSeedRunId: "stage-specific-seed" },
        { signTestAlpha: 0.1 },
        { storagePreflightMinimumAvailableBytes: 1 },
        { tapeInputIdentity: "unordered" },
        { tapeArtifactEncoding: "raw-json" },
        { tapeMaxPartBytes: 100 * 1024 * 1024 },
        { tapeMaxParts: 25 },
        { tapeMaxRawBytes: 2 * 1024 * 1024 * 1024 },
        { tapeMaxTotalBytes: 2 * 1024 * 1024 * 1024 },
        { tapePartUncompressedBytes: 64 * 1024 * 1024 },
        { tapeRequestIdentity: "body-only" },
        { tapeResponseVariants: "last-write-wins" },
        { tapeSequenceCoverage: "entry-count-only" },
        { transportAttemptLedger: "raw-error-receipt" },
        { transportErrorResponseStatus: 500 },
        { transportErrors: "invalidate-discovery" },
        { transportProxyRetries: 1 },
      ]) {
        const driftedManifestRaw = json({
          ...manifestValue,
          protocol: { ...manifestValue.protocol, ...protocolDrift },
        });
        await writeFile(join(repoRoot, manifest.path), driftedManifestRaw);
        Object.assign(
          artifact.artifacts.manifest,
          evidenceIdentity(manifest.path, driftedManifestRaw),
        );
        expect(await evaluateV073LifecycleProtectionBundle({
          artifact,
          artifactPath:
            "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
          repoRoot,
        })).toEqual(expect.objectContaining({
          detail: expect.stringContaining("manifest"),
          status: "fail",
        }));
      }
      const manifestRaw = json(manifestValue);
      await writeFile(join(repoRoot, manifest.path), manifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, manifestRaw),
      );

      const insufficientStorage = {
        ...storagePreflight,
        availableBytes:
          V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes - 1,
      };
      const insufficientSentinelRaw = json({
        ...(JSON.parse(attemptSentinelRaw) as Record<string, unknown>),
        storagePreflight: insufficientStorage,
      });
      const insufficientSentinel = evidenceIdentity(
        attemptSentinelPath,
        insufficientSentinelRaw,
      );
      await writeFile(
        join(repoRoot, attemptSentinelPath),
        insufficientSentinelRaw,
      );
      Object.assign(attemptSentinel, insufficientSentinel);
      const insufficientStorageManifestRaw = json({
        ...manifestValue,
        formalAttempt: { sentinel: insufficientSentinel },
        storagePreflight: insufficientStorage,
      });
      await writeFile(
        join(repoRoot, manifest.path),
        insufficientStorageManifestRaw,
      );
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, insufficientStorageManifestRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(
          "provider preflight artifacts are not independently bound",
        ),
        status: "fail",
      }));
      await writeFile(join(repoRoot, attemptSentinelPath), attemptSentinelRaw);
      Object.assign(
        attemptSentinel,
        evidenceIdentity(attemptSentinelPath, attemptSentinelRaw),
      );
      await writeFile(join(repoRoot, manifest.path), manifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, manifestRaw),
      );

      const preflightReceiptRaw = await readFile(
        join(repoRoot, preflightReceipt.path),
        "utf8",
      );
      const alteredPreflightReceipt = JSON.parse(preflightReceiptRaw) as {
        session: {
          transportAttemptLedger: ProviderTapeTransportAttempt[];
          transportAttemptLedgerSha256: string;
        };
      };
      const firstPreflightAttempt =
        alteredPreflightReceipt.session.transportAttemptLedger[0];
      if (firstPreflightAttempt?.outcome !== "response") {
        throw new Error("preflight fixture must start with a response attempt");
      }
      firstPreflightAttempt.responseStatus = 201;
      alteredPreflightReceipt.session.transportAttemptLedgerSha256 =
        fingerprintProviderTransportAttemptLedger(
          alteredPreflightReceipt.session.transportAttemptLedger,
        );
      const alteredPreflightReceiptRaw = json(alteredPreflightReceipt);
      const alteredPreflightReceiptIdentity = evidenceIdentity(
        preflightReceipt.path,
        alteredPreflightReceiptRaw,
      );
      await writeFile(
        join(repoRoot, preflightReceipt.path),
        alteredPreflightReceiptRaw,
      );
      Object.assign(preflightReceipt, alteredPreflightReceiptIdentity);
      const alteredPreflightManifestRaw = json({
        ...manifestValue,
        providerPreflight: {
          ...manifestValue.providerPreflight,
          receipt: alteredPreflightReceiptIdentity,
        },
      });
      await writeFile(join(repoRoot, manifest.path), alteredPreflightManifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, alteredPreflightManifestRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("request or transport evidence"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, preflightReceipt.path), preflightReceiptRaw);
      Object.assign(
        preflightReceipt,
        evidenceIdentity(preflightReceipt.path, preflightReceiptRaw),
      );
      await writeFile(join(repoRoot, manifest.path), manifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, manifestRaw),
      );

      const scenarioReceiptRaw = await readFile(
        join(repoRoot, scenarioReceipt.path),
        "utf8",
      );
      const alteredScenarioReceipt = JSON.parse(scenarioReceiptRaw) as {
        stdout: { path: string };
      };
      const scenarioStdoutPath = alteredScenarioReceipt.stdout.path;
      const scenarioStdoutRaw = await readFile(
        join(repoRoot, scenarioStdoutPath),
        "utf8",
      );
      const alteredScenarioStdoutRaw = "9 pass\n0 fail\n";
      await writeFile(
        join(repoRoot, scenarioStdoutPath),
        alteredScenarioStdoutRaw,
      );
      alteredScenarioReceipt.stdout = evidenceIdentity(
        scenarioStdoutPath,
        alteredScenarioStdoutRaw,
      );
      const alteredScenarioRaw = json(alteredScenarioReceipt);
      await writeFile(join(repoRoot, scenarioReceipt.path), alteredScenarioRaw);
      Object.assign(
        artifact.artifacts.scenarioReceipt,
        evidenceIdentity(scenarioReceipt.path, alteredScenarioRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("bound logs"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, scenarioReceipt.path), scenarioReceiptRaw);
      await writeFile(join(repoRoot, scenarioStdoutPath), scenarioStdoutRaw);
      Object.assign(
        artifact.artifacts.scenarioReceipt,
        evidenceIdentity(scenarioReceipt.path, scenarioReceiptRaw),
      );

      const formalReceiptRaw = await readFile(
        join(repoRoot, candidateFormalReceipt.path),
        "utf8",
      );
      const alteredFormalReceipt = JSON.parse(formalReceiptRaw) as {
        commandChain: { seedSmoke: { args: string[] } };
      };
      alteredFormalReceipt.commandChain.seedSmoke.args.push("--drifted");
      const alteredFormalRaw = json(alteredFormalReceipt);
      await writeFile(join(repoRoot, candidateFormalReceipt.path), alteredFormalRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, alteredFormalRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("drifted from the recipe"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, candidateFormalReceipt.path), formalReceiptRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, formalReceiptRaw),
      );

      const reorderedFormalReceipt = JSON.parse(formalReceiptRaw) as {
        session: { requestSequence: unknown[] };
      };
      reorderedFormalReceipt.session.requestSequence.reverse();
      const reorderedFormalRaw = json(reorderedFormalReceipt);
      await writeFile(
        join(repoRoot, candidateFormalReceipt.path),
        reorderedFormalRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, reorderedFormalRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("input or transport ledger is invalid"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, candidateFormalReceipt.path), formalReceiptRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, formalReceiptRaw),
      );

      const missingMismatchLedgerReceipt = JSON.parse(formalReceiptRaw) as {
        session: { sequenceMismatchDetails?: unknown[] };
      };
      delete missingMismatchLedgerReceipt.session.sequenceMismatchDetails;
      const missingMismatchLedgerRaw = json(missingMismatchLedgerReceipt);
      await writeFile(
        join(repoRoot, candidateFormalReceipt.path),
        missingMismatchLedgerRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, missingMismatchLedgerRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("input or transport ledger is invalid"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, candidateFormalReceipt.path), formalReceiptRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, formalReceiptRaw),
      );

      const discoveryReceiptRaw = await readFile(
        join(repoRoot, candidateDiscoveryReceipt.path),
        "utf8",
      );
      const rawTransportErrorReceipt = JSON.parse(discoveryReceiptRaw) as {
        session: { transportAttemptLedger: Array<Record<string, unknown>> };
      };
      rawTransportErrorReceipt.session.transportAttemptLedger[0]!.rawMessage =
        "must-not-persist";
      const rawTransportErrorReceiptRaw = json(rawTransportErrorReceipt);
      await writeFile(
        join(repoRoot, candidateDiscoveryReceipt.path),
        rawTransportErrorReceiptRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateDiscoveryReceipt,
        evidenceIdentity(
          candidateDiscoveryReceipt.path,
          rawTransportErrorReceiptRaw,
        ),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("transport ledger is invalid"),
        status: "fail",
      }));
      await writeFile(
        join(repoRoot, candidateDiscoveryReceipt.path),
        discoveryReceiptRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateDiscoveryReceipt,
        evidenceIdentity(candidateDiscoveryReceipt.path, discoveryReceiptRaw),
      );

      const alternateBody = JSON.stringify({ targetId: "eval-alternate" });
      const alternateResponse = Buffer.from("ok-eval-alternate");
      const alternateTape = {
        entries: tapeEntries.map((entry) => entry.request.targetId === "eval"
          ? {
              fingerprint: fingerprintProviderRequest({
                body: alternateBody,
                method: "POST",
                path: "/chat/completions",
                targetId: "eval",
              }),
              occurrence: 0,
              request: {
                canonicalBodySha256: createHash("sha256")
                  .update(alternateBody)
                  .digest("hex"),
                method: "POST",
                path: "/chat/completions",
                semanticHeadersSha256,
                targetId: "eval",
              },
              response: {
                bodyBase64: alternateResponse.toString("base64"),
                bytes: alternateResponse.byteLength,
                contentType: "text/plain",
                sha256: createHash("sha256").update(alternateResponse).digest("hex"),
                status: 200,
                statusText: "OK",
              },
            }
          : entry),
        schemaVersion: 3 as const,
      };
      const alternateTapeRaw = serializeProviderResponseTape(alternateTape);
      const alternateTapeSha256 = createHash("sha256")
        .update(alternateTapeRaw)
        .digest("hex");
      const alteredProtocolInput = structuredClone(protocolInput);
      alteredProtocolInput.providerReplay.tapeSha256 = alternateTapeSha256;
      for (const session of [
        alteredProtocolInput.providerReplay.discovery.baseline,
        alteredProtocolInput.providerReplay.discovery.candidate,
        alteredProtocolInput.providerReplay.formal.baseline,
        alteredProtocolInput.providerReplay.formal.candidate,
      ]) {
        session.tapeSha256 = alternateTapeSha256;
      }
      const alteredProtocolInputRaw = json(alteredProtocolInput);
      Object.assign(tape, await writeTapeBundle(alternateTape));
      await writeFile(
        join(repoRoot, protocolInputIdentity.path),
        alteredProtocolInputRaw,
      );
      Object.assign(
        protocolInputIdentity,
        evidenceIdentity(protocolInputIdentity.path, alteredProtocolInputRaw),
      );
      const receiptIdentities = [
        baselineDiscoveryReceipt,
        candidateDiscoveryReceipt,
        baselineFormalReceipt,
        candidateFormalReceipt,
      ];
      const receiptRaws = await Promise.all(receiptIdentities.map((identity) =>
        readFile(join(repoRoot, identity.path), "utf8")
      ));
      for (const [index, identity] of receiptIdentities.entries()) {
        const receipt = JSON.parse(receiptRaws[index]!) as {
          session: { tapeSha256: string };
        };
        receipt.session.tapeSha256 = alternateTapeSha256;
        const raw = json(receipt);
        await writeFile(join(repoRoot, identity.path), raw);
        Object.assign(identity, evidenceIdentity(identity.path, raw));
      }
      Object.assign(artifact, evaluateV073ReplacementProtection(alteredProtocolInput), {
        artifacts: artifact.artifacts,
      });
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(
          "does not exactly cover discovery sequences",
        ),
        status: "fail",
      }));
      const protocolInputRaw = json(protocolInput);
      Object.assign(
        tape,
        await writeTapeBundle({ entries: tapeEntries, schemaVersion: 3 }),
      );
      await writeFile(join(repoRoot, protocolInputIdentity.path), protocolInputRaw);
      Object.assign(
        protocolInputIdentity,
        evidenceIdentity(protocolInputIdentity.path, protocolInputRaw),
      );
      for (const [index, identity] of receiptIdentities.entries()) {
        const raw = receiptRaws[index]!;
        await writeFile(join(repoRoot, identity.path), raw);
        Object.assign(identity, evidenceIdentity(identity.path, raw));
      }
      Object.assign(artifact, evaluateV073ReplacementProtection(protocolInput), {
        artifacts: artifact.artifacts,
      });

      await writeFile(join(repoRoot, c1Baseline.path), "{}\n");
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("bytes do not match"),
        status: "fail",
      }));
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
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
        ".well-known/goodmemory.json",
        "benchmark-claims/locomo.json",
        "benchmark-claims/evidence/locomo-v0.7.3-current.json",
        "docs/GoodMemory-Current-Status-and-Evidence.md",
        "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
        "docs/README.md",
        "kimi.plugin.json",
        "llms.txt",
        "package.json",
        "README.md",
        "README.zh-CN.md",
        "reports/release/v0.7/phase-74-storage-scale-gate.json",
        "reports/release/v0.7/readiness-report.json",
        "reports/release/v0.7/summary.md",
        "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
        "reports/release/v0.7/v0.7.3-full-claim-protocol2-preregistration.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/claim-recipe-source.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/final-smoke-report.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/official-progress.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/official-rescore-summary.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/official-runner-source.ts",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-extraction-cache.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-live-progress.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-smoke-report.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-extraction-cache.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-live-progress.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-smoke-report.json",
        "server.json",
      ],
      currentCommit: "b".repeat(40),
      currentPackage: releasePackage,
      isAncestor: true,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("evidence-only descendant"),
      status: "pass",
    }));
  });

  it("[governance-correction-lineage] enforces the preregistered S-D-G-A-release lineage", () => {
    const preregistrationCommit = "1".repeat(40);
    const implementationCommit = "2".repeat(40);
    const attestationCommit = "3".repeat(40);
    const currentCommit = "4".repeat(40);
    const preregistrationPaths = [
      "reports/release/v0.7/" +
        "v0.7.3-public-claim-governance-correction-preregistration.json",
      "tests/release/release.test.ts",
      "tests/unit/run-public-benchmark-claim-gate.test.ts",
      "tests/unit/run-v0-7-release-readiness.test.ts",
    ];
    const implementationPaths = [
      ".github/workflows/release.yml",
      "scripts/run-public-benchmark-claim-gate.ts",
      "scripts/run-v0-7-release-readiness.ts",
    ];
    const sourceRaws = {
      ".github/workflows/release.yml": "name: Release\n",
      "scripts/run-public-benchmark-claim-gate.ts": "export const publicGate = true;\n",
      "scripts/run-v0-7-release-readiness.ts": "export const readiness = true;\n",
      "tests/release/release.test.ts": "test('release evidence');\n",
      "tests/unit/run-public-benchmark-claim-gate.test.ts": "test('public gate');\n",
      "tests/unit/run-v0-7-release-readiness.test.ts": "test('readiness');\n",
    } satisfies Record<string, string>;
    const attestation = {
      artifactKind: "v0.7.3-public-claim-governance-correction-attestation",
      baselineCommits: {
        fullClaimAttemptSentinel:
          "078ca74ac45fe4bd268e52921528e1e15a0ec52f",
        fullClaimProtocolPreregistration:
          "3f84011ba091f295e2d1f175a9e7ba5d2faebc76",
        protocolCandidate: "996c181e97e2d0a56bbd78957e79026af328b03b",
      },
      correctionCommits: {
        implementation: implementationCommit,
        preregistration: preregistrationCommit,
      },
      generatedAt: "2026-08-11T02:00:00.000Z",
      generatedBy: "v0.7.3-public-claim-governance-correction-attestation",
      implementationDiffPaths: implementationPaths,
      providerCalls: 0,
      schemaVersion: 1,
      sourceArtifacts: Object.entries(sourceRaws).map(([path, raw]) =>
        evidenceIdentity(path, raw)
      ),
      verification: {
        green: {
          publicClaimGate: {
            command:
              "bun test tests/unit/run-public-benchmark-claim-gate.test.ts",
            exitCode: 0,
            failed: 0,
            outputSha256: "a".repeat(64),
            passed: 41,
          },
          releaseReadiness: {
            command:
              "bun test tests/unit/run-v0-7-release-readiness.test.ts " +
              "-t governance-correction-lineage",
            exitCode: 0,
            failed: 0,
            outputSha256: "b".repeat(64),
            passed: 2,
          },
          releaseWorkflowEvidence: {
            command:
              "bun test tests/release/release.test.ts --test-name-pattern " +
              '"ships the public-claim governance correction evidence"',
            exitCode: 0,
            failed: 0,
            outputSha256: "f".repeat(64),
            passed: 1,
          },
          typecheck: {
            command: "bun run typecheck",
            exitCode: 0,
            failed: 0,
            outputSha256: "c".repeat(64),
            passed: 1,
          },
        },
        red: {
          publicClaimGate: {
            command:
              "bun test tests/unit/run-public-benchmark-claim-gate.test.ts",
            exitCode: 1,
            failed: 2,
            outputSha256: "d".repeat(64),
            passed: 39,
          },
          releaseReadiness: {
            command:
              "bun test tests/unit/run-v0-7-release-readiness.test.ts " +
              "-t governance-correction-lineage",
            exitCode: 1,
            failed: 1,
            outputSha256: "e".repeat(64),
            passed: 0,
          },
          releaseWorkflowEvidence: {
            command:
              "bun test tests/release/release.test.ts --test-name-pattern " +
              '"ships the public-claim governance correction evidence"',
            exitCode: 1,
            failed: 1,
            outputSha256: "f".repeat(64),
            passed: 0,
          },
        },
      },
    };
    const attestationRaw = `${JSON.stringify(attestation, null, 2)}\n`;
    const valid = {
      attestation,
      attestationChangedPaths: [
        "reports/release/v0.7/" +
          "v0.7.3-public-claim-governance-correction-attestation.json",
      ],
      attestationCommit,
      attestationIsAncestor: true,
      attestationParentCommit: implementationCommit,
      attestationRawAtCommit: attestationRaw,
      attestationRawCurrent: attestationRaw,
      currentCommit,
      currentSourceRaws: sourceRaws,
      implementationChangedPaths: implementationPaths,
      implementationCommit,
      implementationParentCommit: preregistrationCommit,
      implementationSourceRaws: sourceRaws,
      postAttestationChangedPaths: [
        "benchmark-claims/evidence/locomo-v0.7.3-current.json",
        "benchmark-claims/locomo.json",
        "reports/release/v0.7/" +
          "v0.7.3-locomo-claim-evidence/execution-receipt.json",
        "README.md",
      ],
      preregistration: V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION,
      preregistrationChangedPaths: preregistrationPaths,
      preregistrationCommit,
      preregistrationParentCommit:
        "078ca74ac45fe4bd268e52921528e1e15a0ec52f",
      preregistrationRawAtCommit:
        V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_RAW,
      preregistrationRawCurrent:
        V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_RAW,
    };

    expect(evaluateV073PublicClaimGovernanceCorrection(valid)).toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("S-D-G-A-release"),
        status: "pass",
      }),
    );

    expect(evaluateV073PublicClaimGovernanceCorrection({
      ...valid,
      implementationChangedPaths: [
        ...implementationPaths,
        "tests/unit/run-v0-7-release-readiness.test.ts",
      ],
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("implementation commit paths"),
      status: "fail",
    }));

    expect(evaluateV073PublicClaimGovernanceCorrection({
      ...valid,
      postAttestationChangedPaths: ["reports/release/v0.7/arbitrary.json"],
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("post-attestation release paths"),
      status: "fail",
    }));

    expect(evaluateV073PublicClaimGovernanceCorrection({
      ...valid,
      currentSourceRaws: {
        ...sourceRaws,
        "scripts/run-v0-7-release-readiness.ts": "tampered\n",
      },
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("frozen governance sources"),
      status: "fail",
    }));

    expect(evaluateV073PublicClaimGovernanceCorrection({
      ...valid,
      attestation: {
        ...attestation,
        verification: {
          ...attestation.verification,
          green: {
            ...attestation.verification.green,
            typecheck: {
              ...attestation.verification.green.typecheck,
              exitCode: 1,
            },
          },
        },
      },
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("verification results"),
      status: "fail",
    }));
  });

  it("[governance-correction-lineage] verifies the correction against git objects", async () => {
    const sourceRoot = join(import.meta.dir, "../..");
    const fixtureParent = await mkdtemp(
      join(tmpdir(), "goodmemory-v073-governance-lineage-"),
    );
    const repoRoot = join(fixtureParent, "repo");
    try {
      const clone = Bun.spawnSync(
        ["git", "clone", "--quiet", "--no-local", sourceRoot, repoRoot],
      );
      if (clone.exitCode !== 0) {
        throw new Error(clone.stderr.toString());
      }
      runFixtureGit(repoRoot, "config", "user.email", "test@example.com");
      runFixtureGit(repoRoot, "config", "user.name", "Test");
      runFixtureGit(
        repoRoot,
        "checkout",
        "--quiet",
        "--detach",
        "078ca74ac45fe4bd268e52921528e1e15a0ec52f",
      );
      expect(runFixtureGit(repoRoot, "rev-parse", "HEAD")).toBe(
        "078ca74ac45fe4bd268e52921528e1e15a0ec52f",
      );

      const preregistrationPath =
        "reports/release/v0.7/" +
        "v0.7.3-public-claim-governance-correction-preregistration.json";
      const preregistrationTestPaths = [
        "tests/release/release.test.ts",
        "tests/unit/run-public-benchmark-claim-gate.test.ts",
        "tests/unit/run-v0-7-release-readiness.test.ts",
      ];
      await mkdir(join(repoRoot, "reports/release/v0.7"), { recursive: true });
      await writeFile(
        join(repoRoot, preregistrationPath),
        V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_RAW,
      );
      for (const path of preregistrationTestPaths) {
        await writeFile(
          join(repoRoot, path),
          await readFile(join(sourceRoot, path), "utf8"),
        );
      }
      runFixtureGit(
        repoRoot,
        "add",
        "-f",
        preregistrationPath,
        ...preregistrationTestPaths,
      );
      runFixtureGit(repoRoot, "commit", "--quiet", "-m", "preregister correction");
      const preregistrationCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");

      const implementationPaths = [
        ".github/workflows/release.yml",
        "scripts/run-public-benchmark-claim-gate.ts",
        "scripts/run-v0-7-release-readiness.ts",
      ];
      for (const path of implementationPaths) {
        await writeFile(
          join(repoRoot, path),
          await readFile(join(sourceRoot, path), "utf8"),
        );
      }
      runFixtureGit(repoRoot, "add", ...implementationPaths);
      runFixtureGit(repoRoot, "commit", "--quiet", "-m", "implement correction");
      const implementationCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");
      const sourcePaths = [
        ".github/workflows/release.yml",
        "scripts/run-public-benchmark-claim-gate.ts",
        "scripts/run-v0-7-release-readiness.ts",
        "tests/release/release.test.ts",
        "tests/unit/run-public-benchmark-claim-gate.test.ts",
        "tests/unit/run-v0-7-release-readiness.test.ts",
      ];
      const sourceArtifacts = await Promise.all(sourcePaths.map(async (path) => {
        const raw = await readFile(join(repoRoot, path), "utf8");
        return evidenceIdentity(path, raw);
      }));
      const attestationPath =
        "reports/release/v0.7/" +
        "v0.7.3-public-claim-governance-correction-attestation.json";
      const attestation = {
        artifactKind: "v0.7.3-public-claim-governance-correction-attestation",
        baselineCommits: {
          fullClaimAttemptSentinel:
            "078ca74ac45fe4bd268e52921528e1e15a0ec52f",
          fullClaimProtocolPreregistration:
            "3f84011ba091f295e2d1f175a9e7ba5d2faebc76",
          protocolCandidate: "996c181e97e2d0a56bbd78957e79026af328b03b",
        },
        correctionCommits: {
          implementation: implementationCommit,
          preregistration: preregistrationCommit,
        },
        generatedAt: "2026-08-11T02:00:00.000Z",
        generatedBy: "v0.7.3-public-claim-governance-correction-attestation",
        implementationDiffPaths: implementationPaths,
        providerCalls: 0,
        schemaVersion: 1,
        sourceArtifacts,
        verification: {
          green: {
            publicClaimGate: {
              command:
                "bun test tests/unit/run-public-benchmark-claim-gate.test.ts",
              exitCode: 0,
              failed: 0,
              outputSha256: "a".repeat(64),
              passed: 41,
            },
            releaseReadiness: {
              command:
                "bun test tests/unit/run-v0-7-release-readiness.test.ts " +
                "-t governance-correction-lineage",
              exitCode: 0,
              failed: 0,
              outputSha256: "b".repeat(64),
              passed: 2,
            },
            releaseWorkflowEvidence: {
              command:
                "bun test tests/release/release.test.ts --test-name-pattern " +
                '"ships the public-claim governance correction evidence"',
              exitCode: 0,
              failed: 0,
              outputSha256: "f".repeat(64),
              passed: 1,
            },
            typecheck: {
              command: "bun run typecheck",
              exitCode: 0,
              failed: 0,
              outputSha256: "c".repeat(64),
              passed: 1,
            },
          },
          red: {
            publicClaimGate: {
              command:
                "bun test tests/unit/run-public-benchmark-claim-gate.test.ts",
              exitCode: 1,
              failed: 2,
              outputSha256: "d".repeat(64),
              passed: 39,
            },
            releaseReadiness: {
              command:
                "bun test tests/unit/run-v0-7-release-readiness.test.ts " +
                "-t governance-correction-lineage",
              exitCode: 1,
              failed: 1,
              outputSha256: "e".repeat(64),
              passed: 0,
            },
            releaseWorkflowEvidence: {
              command:
                "bun test tests/release/release.test.ts --test-name-pattern " +
                '"ships the public-claim governance correction evidence"',
              exitCode: 1,
              failed: 1,
              outputSha256: "f".repeat(64),
              passed: 0,
            },
          },
        },
      };
      await writeFile(
        join(repoRoot, attestationPath),
        `${JSON.stringify(attestation, null, 2)}\n`,
      );
      runFixtureGit(repoRoot, "add", "-f", attestationPath);
      runFixtureGit(repoRoot, "commit", "--quiet", "-m", "attest correction");

      const readmePath = join(repoRoot, "README.md");
      await writeFile(
        readmePath,
        `${await readFile(readmePath, "utf8")}\nrelease projection\n`,
      );
      runFixtureGit(repoRoot, "add", "README.md");
      runFixtureGit(repoRoot, "commit", "--quiet", "-m", "project release");
      const currentCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");

      expect(await evaluateV073PublicClaimGovernanceCorrectionFile({
        currentCommit,
        repoRoot,
      })).toEqual(expect.objectContaining({ status: "pass" }));

      await writeFile(
        join(repoRoot, "reports/release/v0.7/arbitrary.json"),
        "{}\n",
      );
      runFixtureGit(repoRoot, "add", "-f", "reports/release/v0.7/arbitrary.json");
      runFixtureGit(repoRoot, "commit", "--quiet", "-m", "unrelated report");
      expect(await evaluateV073PublicClaimGovernanceCorrectionFile({
        currentCommit: runFixtureGit(repoRoot, "rev-parse", "HEAD"),
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("arbitrary.json"),
        status: "fail",
      }));
    } finally {
      await rm(fixtureParent, { force: true, recursive: true });
    }
  }, 30_000);

  it("rejects unrelated documentation, report, and benchmark drift after the protocol candidate", () => {
    const packageJson = {
      goodmemoryRelease: { status: "release-candidate" },
      name: "goodmemory",
      version: "0.7.3",
    };

    for (const forbiddenPath of [
      "docs/unrelated-release-note.md",
      "reports/release/v0.7/unrelated-attestation.json",
      "benchmark-claims/unrelated.json",
    ]) {
      expect(evaluateV073LifecycleProtectionSourceDrift({
        candidateCommit: "a".repeat(40),
        candidatePackage: packageJson,
        changedPaths: [forbiddenPath],
        currentCommit: "b".repeat(40),
        currentPackage: packageJson,
        isAncestor: true,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(forbiddenPath),
        status: "fail",
      }));
    }
  });

  it("allows only the exact protocol-v2 implementation and prior evidence between lifecycle and protocol candidates", () => {
    const lifecycleCandidateCommit = "a".repeat(40);
    const protocolCandidateCommit = "b".repeat(40);
    const allowed = evaluateV073LifecycleToProtocolSourceDrift({
      changedPaths: [
        ".github/workflows/release.yml",
        ".gitignore",
        "bun.lock",
        "docs/GoodMemory-Current-Status-and-Evidence.md",
        "docs/README.md",
        "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
        "package-lock.json",
        "package.json",
        "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json",
        "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence/manifest.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-attempt-1-failed/attribution.md",
        "reports/release/v0.7/v0.7.3-locomo-claim-attempt-2-failed/attribution.md",
        "scripts/run-v0-7-3-full-locomo-claim.ts",
        "scripts/run-coverage.ts",
        "scripts/run-v0-7-release-readiness.ts",
        "tests/quality-gates/phase-73/codex-coding-effect.c6-protocol-readiness.gate.ts",
        "tests/release/release.test.ts",
        "tests/release/v0-7-stable-artifact.test.ts",
        "tests/integration/codex-coding-effect.c6-protocol-readiness.test.ts",
        "tests/unit/run-coverage.script.test.ts",
        "tests/unit/run-v0-7-3-lifecycle-protection-gate.test.ts",
        "tests/unit/run-v0-7-3-full-locomo-claim.test.ts",
        "tests/unit/run-v0-7-release-readiness.test.ts",
      ],
      dependencyPinningValid: true,
      isAncestor: true,
      lifecycleCandidateCommit,
      protocolCandidateCommit,
    });
    expect(allowed).toEqual(expect.objectContaining({
      detail: expect.stringContaining(protocolCandidateCommit),
      status: "pass",
    }));

    for (const forbiddenPath of [
      "src/recall/scoring.ts",
      "benchmark-claims/locomo.json",
      "scripts/run-phase-65-locomo-smoke.ts",
      "scripts/reanswer-phase-65-locomo-report.ts",
      "scripts/rescore-official-protocols.ts",
      "scripts/run-v0-7-3-lifecycle-protection-gate.ts",
      "scripts/unrelated-release-helper.ts",
      "tests/unit/unrelated-release-helper.test.ts",
    ]) {
      expect(evaluateV073LifecycleToProtocolSourceDrift({
        changedPaths: [forbiddenPath],
        isAncestor: true,
        lifecycleCandidateCommit,
        protocolCandidateCommit,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(forbiddenPath),
        status: "fail",
      }));
    }

    expect(evaluateV073LifecycleToProtocolSourceDrift({
      changedPaths: ["bun.lock", "package-lock.json", "package.json"],
      dependencyPinningValid: false,
      isAncestor: true,
      lifecycleCandidateCommit,
      protocolCandidateCommit,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("dependency pinning"),
      status: "fail",
    }));
  });

  it("accepts only the exact AI SDK caret-to-measured dependency pinning", () => {
    const beforeDependencies = {
      "@ai-sdk/anthropic": "^3.0.64",
      "@ai-sdk/openai": "^3.0.49",
      "@ai-sdk/openai-compatible": "^2.0.40",
      "@ai-sdk/provider-utils": "^4.0.21",
      ai: "^6.0.143",
      zod: "^4.3.6",
    };
    const afterDependencies = {
      "@ai-sdk/anthropic": "3.0.64",
      "@ai-sdk/openai": "3.0.49",
      "@ai-sdk/openai-compatible": "2.0.40",
      "@ai-sdk/provider-utils": "4.0.23",
      ai: "6.0.143",
      zod: "^4.3.6",
    };
    const providerUtils21 = { license: "Apache-2.0", version: "4.0.21" };
    const providerUtils23 = { license: "Apache-2.0", version: "4.0.23" };
    const providerUtils21Registry = {
      integrity:
        "sha512-MtFUYI1/8mgDvRmaBDjbLJPFFrMG777AvSgyIFQtZHIMzm88R/12vYBBpnk7pfiWLFE1DSZzY4WDYzGbKAcmiw==",
      resolved:
        "https://registry.npmjs.org/@ai-sdk/provider-utils/-/provider-utils-4.0.21.tgz",
    };
    const providerUtils23Registry = {
      integrity:
        "sha512-z8GlDaCmRSDlqkMF2f4/RFgWxdarvIbyuk+m6WXT1LYgsnGiXRJGTD2Z1+SDl3LqtFuRtGX1aghYvQLoHL/9pg==",
      resolved:
        "https://registry.npmjs.org/@ai-sdk/provider-utils/-/provider-utils-4.0.23.tgz",
    };
    const lifecycleRaws = {
      "bun.lock": `${JSON.stringify({ dependencies: beforeDependencies }, null, 2)}\n`,
      "package-lock.json": `${JSON.stringify({
        packages: {
          "": { dependencies: beforeDependencies },
          "node_modules/@ai-sdk/openai-compatible/node_modules/@ai-sdk/provider-utils":
            providerUtils23,
          "node_modules/@ai-sdk/provider-utils": providerUtils21,
        },
      }, null, 2)}\n`,
      "package.json": `${JSON.stringify({ dependencies: beforeDependencies }, null, 2)}\n`,
    };
    const protocolRaws = {
      "bun.lock": `${JSON.stringify({ dependencies: afterDependencies }, null, 2)}\n`,
      "package-lock.json": `${JSON.stringify({
        packages: {
          "": { dependencies: afterDependencies },
          "node_modules/@ai-sdk/anthropic/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
          "node_modules/@ai-sdk/gateway/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
          "node_modules/@ai-sdk/openai/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
          "node_modules/@ai-sdk/provider-utils": {
            ...providerUtils23,
            ...providerUtils23Registry,
          },
          "node_modules/ai/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
        },
      }, null, 2)}\n`,
      "package.json": `${JSON.stringify({ dependencies: afterDependencies }, null, 2)}\n`,
    };

    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws,
    })).toBe(true);
    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws: {
        ...protocolRaws,
        "package.json": protocolRaws["package.json"].replace(
          '"zod": "^4.3.6"',
          '"zod": "4.3.6"',
        ),
      },
    })).toBe(false);
    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws: {
        ...protocolRaws,
        "package-lock.json": protocolRaws["package-lock.json"].replace(
          providerUtils21Registry.integrity,
          "sha512-attacker-controlled-bytes==",
        ),
      },
    })).toBe(false);
    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws: {
        ...protocolRaws,
        "package-lock.json": protocolRaws["package-lock.json"].replace(
          providerUtils23Registry.resolved,
          "https://example.invalid/provider-utils-4.0.23.tgz",
        ),
      },
    })).toBe(false);
  });

  it("uses the measured candidate recipe after current claim publication changes locomo.json", () => {
    const identity = {
      bytes: Buffer.byteLength(CLAIM_RECIPE_RAW, "utf8"),
      path: "benchmark-claims/locomo.json",
      sha256: createHash("sha256").update(CLAIM_RECIPE_RAW).digest("hex"),
    };
    const publishedClaimRaw = `${JSON.stringify({
      claim: "fresh v0.7.3 publication",
      schemaVersion: 1,
    }, null, 2)}\n`;

    expect(resolveV073MeasuredClaimRecipeRaw({
      candidateGitObjectRaw: CLAIM_RECIPE_RAW,
      currentClaimRecipeRaw: publishedClaimRaw,
      identity,
    })).toBe(CLAIM_RECIPE_RAW);
    expect(() => resolveV073MeasuredClaimRecipeRaw({
      candidateGitObjectRaw: `${CLAIM_RECIPE_RAW} `,
      currentClaimRecipeRaw: publishedClaimRaw,
      identity,
    })).toThrow("measured candidate claim recipe");
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
        ".gitignore",
      ],
      currentCommit: "b".repeat(40),
      currentPackage: packageJson,
      isAncestor: true,
    });
    expect(drift.status).toBe("fail");
    expect(drift.detail).toContain("src/recall/scoring.ts");
    expect(drift.detail).toContain(".github/workflows/release.yml");
    expect(drift.detail).toContain(".gitignore");

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
