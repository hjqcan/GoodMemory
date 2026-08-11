import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  assertV073CandidateProvenanceUnchanged,
  assertV073EvidenceRepositoryLineage,
  assertV073EvidencePublicationStatus,
  assertV073FullClaimOutputs,
  assertV073GitCheckoutDetached,
  assertV073SentinelRemoteConfirmation,
  buildV073TerminalClaimReceipt,
  buildV073FrozenProviderChildEnvironment,
  classifyV073SeedAttemptRecovery,
  consumeV073FullClaimProtocol2Attempt,
  deriveV073ExpectedExtractionCache,
  deriveV073FullClaimProtocol2Identity,
  persistV073FinalReportEvidence,
  persistV073FinalSeedEvidence,
  persistV073OfficialEvidence,
  persistV073SeedAttemptOneEvidence,
  persistV073TerminalClaimReceipt,
  preserveV073FinalReportIfPresent,
  preserveV073SeedArtifactsIfPresent,
  publishV073FullClaimPublication,
  renderV073FullClaimCommand,
  renderV073FullClaimProtocol2Command,
  resolveDistinctV073FullClaimRepositories,
  runV073SeedWithOneTimeoutResume,
  snapshotV073SeedAttemptOne,
  stageV073FullClaimPublication,
  withV073NoEnvFileCommandChain,
  V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
} from "../../scripts/run-v0-7-3-full-locomo-claim";
import { buildV073FullClaimCommandChain } from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
import type { V073CommandInvocation } from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
import { frozenV073LocomoQuestionSelection } from "../fixtures/v0-7-3-locomo-question-selection";

const REPO_ROOT = join(import.meta.dir, "../..");
const CLAIM_RAW = readFileSync(
  join(REPO_ROOT, "benchmark-claims/locomo.json"),
  "utf8",
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString().trim();
}

function fullClaimOutputs() {
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
    answerCorrect: true,
    answerTokenF1: 1,
    ...identity,
    evidenceRecall: 1,
    evidenceTurnIds: [`turn-${index}`],
    executionFailureMessage: null,
    executionFailureStage: null,
    generatedAnswer: `answer-${index}`,
    retrievedTurnIds: [`turn-${index}`],
  }));
  const seedRows = rows.map((row) => ({
    ...row,
    answerCorrect: null,
    answerTokenF1: null,
    generatedAnswer: null,
  }));
  const seedPath = "/candidate/raw/seed/smoke-report.json";
  const finalPath = "/candidate/raw/final/smoke-report.json";
  const rootPath = "/benchmarks/locomo/cases.json";
  const officialPath = "/candidate/reports/official/rescore-summary.json";
  const common = {
    benchmark: "locomo",
    benchmarkFingerprint:
      "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
    caseCount: 10,
    caseIds,
    cases: rows,
    executionFailures: 0,
    questionCount: 1540,
  };
  const seed = {
    ...common,
    answerEvaluation: "deferred-to-live-mode",
    cases: seedRows,
    generatedAt: "2026-08-06T10:00:00.000Z",
    generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
    mode: "retrieval-only",
    resume: true,
    runId: "seed",
  };
  const final = {
    ...common,
    answerAccuracyOverall: 1,
    answerEvaluation: "scored",
    answerSystem: "locomo-live-category-aware-v1",
    generatedAt: "2026-08-06T11:00:00.000Z",
    generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
    mode: "live-answer",
    resume: false,
    runId: "final",
    sourceReport: { path: seedPath, runId: "seed" },
  };
  const finalRaw = JSON.stringify(final);
  const rootRaw = new TextEncoder().encode("frozen-root");
  const categoryCounts = {
    multi_hop: 282,
    open_domain: 96,
    single_hop: 841,
    temporal: 321,
  };
  const official = {
    benchmark: "locomo",
    categories: Object.fromEntries(
      Object.entries(categoryCounts).map(([category, total]) => [
        category,
        { accuracy: 1, correct: total, total },
      ]),
    ),
    claimBoundary:
      "Official/industry-prompt-compatible stored-answer rescore; numeric comparability is benchmark-specific and requires a matching pinned evaluator configuration; not answer regeneration or a public benchmark claim.",
    generatedAt: "2026-08-06T00:00:00.000Z",
    generatedBy: "scripts/rescore-official-protocols.ts",
    judgeFailures: 0,
    judgeGateway: "https://ai.gurkiai.com/v1",
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    judgedCases: 1540,
    limit: null,
    limitUnit: "cases",
    overallAccuracy: 1,
    overallCorrect: 1540,
    outputPath: officialPath,
    protocol: "mem0ai/memory-benchmarks LoCoMo judge",
    runId: "official",
    scorerSource: null,
    selectedCases: 1540,
    sourceAnswersUnchanged: true,
    sourceCases: 1540,
    sourceInputFingerprints: {
      reportPath: {
        bytes: Buffer.byteLength(finalRaw),
        sha256: sha256(finalRaw),
      },
      rootPath: { bytes: rootRaw.byteLength, sha256: sha256(rootRaw) },
    },
    sourceInputs: { reportPath: finalPath, rootPath },
    totalCases: 1540,
  };
  return {
    final,
    finalPath,
    finalRaw,
    finalRunId: "final",
    official,
    officialPath,
    officialProgressRaw: `${rows.map((row) => JSON.stringify({
      correct: true,
      questionId: row.questionId,
    })).join("\n")}\n`,
    officialRunId: "official",
    rootPath,
    rootRaw,
    seed,
    seedPath,
    seedRunId: "seed",
  };
}

function extractionCacheRaw(count: number): string {
  return `${Array.from({ length: count }, (_, index) =>
    JSON.stringify({ candidates: [], key: `key-${index}` })).join("\n")}\n`;
}

function expectedCacheCaseByKey(
  missingCaseId = "locomo-conv-43",
): Map<string, string> {
  const result = new Map<string, string>(
    Array.from({ length: 272 }, (_, index) => [
      `key-${index}`,
      "locomo-conv-26",
    ] as const),
  );
  result.set("key-271", missingCaseId);
  return result;
}

function progressRaw(report: ReturnType<typeof fullClaimOutputs>["seed"]): string {
  const successfulRows = report.cases.filter(
    (row) => row.executionFailureMessage == null,
  );
  const config = { a: true, z: { a: 1, b: 2 } };
  return `${JSON.stringify({
    config,
    configFingerprint: sha256('{"a":true,"z":{"a":1,"b":2}}'),
    kind: "locomo-progress-config",
    version: 2,
  })}\n${successfulRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function seedTimeoutReport(caseId = "locomo-conv-43") {
  const output = fullClaimOutputs();
  const failedRows = output.seed.cases.filter((row) => row.caseId === caseId);
  for (const row of failedRows) {
    Object.assign(row, {
      evidenceRecall: 0,
      executionFailureMessage:
        "OpenAI-compatible gateway timeout after 120000ms.",
      executionFailureStage: "seed",
      goldEvidenceFullyRetrieved: false,
      missingEvidenceTurnIds: row.evidenceTurnIds,
      noiseTurnCount: 0,
      noiseTurnIds: [],
      retrievedTurnIds: [],
    });
  }
  output.seed.executionFailures = failedRows.length;
  return output.seed;
}

async function writeSeedAttempt(
  seedOutputPath: string,
  report: ReturnType<typeof fullClaimOutputs>["seed"],
  cacheCount: number,
  append = false,
): Promise<void> {
  await mkdir(seedOutputPath, { recursive: true });
  let cacheRaw = extractionCacheRaw(cacheCount);
  let currentProgressRaw = progressRaw(report);
  if (append) {
    const [previousCacheRaw, previousProgressRaw] = await Promise.all([
      readFile(join(seedOutputPath, "extraction-cache.jsonl"), "utf8"),
      readFile(join(seedOutputPath, "live-progress.jsonl"), "utf8"),
    ]);
    const previousQuestionKeys = new Set(
      previousProgressRaw.trimEnd().split("\n").slice(1).map((line) => {
        const row = JSON.parse(line) as { caseId: string; questionId: string };
        return `${row.caseId}\u0000${row.questionId}`;
      }),
    );
    const appendedRows = report.cases.filter((row) =>
      !previousQuestionKeys.has(`${row.caseId}\u0000${row.questionId}`));
    currentProgressRaw =
      `${previousProgressRaw}${appendedRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const missingCacheLines = extractionCacheRaw(cacheCount)
      .trimEnd()
      .split("\n")
      .slice(previousCacheRaw.trimEnd().split("\n").length);
    cacheRaw = `${previousCacheRaw}${missingCacheLines.join("\n")}\n`;
  }
  await Promise.all([
    writeFile(
      join(seedOutputPath, "smoke-report.json"),
      `${JSON.stringify(report)}\n`,
    ),
    writeFile(join(seedOutputPath, "live-progress.jsonl"), currentProgressRaw),
    writeFile(
      join(seedOutputPath, "extraction-cache.jsonl"),
      cacheRaw,
    ),
  ]);
}

function frozenCacheRootRaw(): string {
  const caseIds = Object.keys(V073_FULL_LOCOMO_CASE_QUESTION_COUNTS);
  const sessionCounts = [19, 19, 32, 29, 29, 28, 31, 30, 25, 30];
  const cases = caseIds.map((caseId, caseIndex) => {
    const sessionCount = sessionCounts[caseIndex]!;
    return {
      caseId,
      questions: [],
      sourceConversation: `conversation-${caseIndex}`,
      speakers: ["A", "B"],
      turns: Array.from({ length: sessionCount }, (_, sessionIndex) => ({
        content: `message-${caseIndex}-${sessionIndex}`,
        diaId: `D${sessionIndex + 1}:1`,
        speaker: sessionIndex % 2 === 0 ? "A" : "B",
      })),
    };
  });
  return JSON.stringify({ cases });
}

async function writeProtocol2ReleaseRepository(input: {
  rejectSentinelPush?: boolean;
  root: string;
}): Promise<{
  lifecycleCandidateCommit: string;
  preregistrationPath: string;
  protocolCandidateCommit: string;
  releaseCommit: string;
  releaseRepo: string;
  remote: string;
}> {
  const releaseRepo = join(input.root, "release");
  const remote = join(input.root, "origin.git");
  const lifecyclePath =
    "reports/release/v0.7/v0.7.3-lifecycle-protection.json";
  const preregistrationPath =
    "reports/release/v0.7/v0.7.3-full-claim-protocol2-preregistration.json";
  const protocolCandidateCommit = "c".repeat(40);
  const lifecycleCandidateCommit = "1".repeat(40);
  const identity = deriveV073FullClaimProtocol2Identity(protocolCandidateCommit);
  await mkdir(releaseRepo);
  git(input.root, "init", "--bare", "--quiet", remote);
  git(releaseRepo, "init", "--quiet", "--initial-branch=main");
  git(releaseRepo, "config", "user.email", "test@example.com");
  git(releaseRepo, "config", "user.name", "Test");
  const lifecycleRaw = `${JSON.stringify({
    blockers: [],
    candidateCommit: lifecycleCandidateCommit,
    fullClaimRerunRequired: true,
    releaseAllowed: true,
    schemaVersion: 9,
  })}\n`;
  await mkdir(join(releaseRepo, "reports/release/v0.7"), { recursive: true });
  await writeFile(join(releaseRepo, lifecyclePath), lifecycleRaw);
  await writeFile(join(releaseRepo, preregistrationPath), `${JSON.stringify({
    benchmark: {
      bytes: 2_490_457,
      fingerprint:
        "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
      sha256:
        "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28",
    },
    generatedAt: "2026-08-10T12:00:00.000Z",
    generatedBy: "v0.7.3-full-locomo-claim-protocol2-preregistration",
    ...identity,
    lifecycleCandidateCommit,
    lifecycleProtection: {
      bytes: Buffer.byteLength(lifecycleRaw),
      path: lifecyclePath,
      sha256: sha256(lifecycleRaw),
    },
    maxSeedLaunches: 2,
    protocolCandidateCommit,
    protocolVersion: 2,
    sentinelPath:
      "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
  }, null, 2)}\n`);
  git(releaseRepo, "add", ".");
  git(releaseRepo, "commit", "--quiet", "-m", "preregister protocol 2");
  git(releaseRepo, "remote", "add", "origin", remote);
  git(releaseRepo, "push", "--quiet", "-u", "origin", "main");
  const releaseCommit = git(releaseRepo, "rev-parse", "HEAD");
  if (input.rejectSentinelPush) {
    const hookPath = join(remote, "hooks/pre-receive");
    await writeFile(hookPath, "#!/bin/sh\nexit 1\n");
    await chmod(hookPath, 0o755);
  }
  return {
    lifecycleCandidateCommit,
    preregistrationPath,
    protocolCandidateCommit,
    releaseCommit,
    releaseRepo,
    remote,
  };
}

describe("v0.7.3 full LoCoMo claim launcher", () => {
  it("wires release-main consumption before bounded seed and downstream scoring", () => {
    const source = readFileSync(
      join(REPO_ROOT, "scripts/run-v0-7-3-full-locomo-claim.ts"),
      "utf8",
    );
    const runCliSource = source.slice(source.indexOf("async function runCli"));
    expect(runCliSource).toContain('"--release-repo"');
    expect(runCliSource).not.toContain('"--output-root"');
    expect(runCliSource).not.toContain('"--seed-run-id"');
    expect(runCliSource).not.toContain('"--final-run-id"');
    expect(runCliSource).not.toContain('"--official-run-id"');
    expect(runCliSource).not.toContain('"--expected-candidate-commit"');
    const consumedIndex = runCliSource.indexOf(
      "consumeV073FullClaimProtocol2Attempt({",
    );
    const candidateDetachedIndex = runCliSource.indexOf(
      'assertV073GitCheckoutDetached(worktreePath, "full claim candidate")',
    );
    const evidenceDetachedIndex = runCliSource.indexOf(
      "assertV073GitCheckoutDetached(\n    evidenceRepoPath",
    );
    const seedIndex = runCliSource.indexOf(
      "runV073SeedWithOneTimeoutResume({",
    );
    const reanswerIndex = runCliSource.indexOf(
      "runProviderInvocation(commandChain.reanswer)",
    );
    const officialIndex = runCliSource.indexOf(
      "runProviderInvocation(\n      commandChain.officialRescore",
    );
    expect(consumedIndex).toBeGreaterThan(-1);
    expect(candidateDetachedIndex).toBeGreaterThan(-1);
    expect(candidateDetachedIndex).toBeLessThan(consumedIndex);
    expect(evidenceDetachedIndex).toBeGreaterThan(candidateDetachedIndex);
    expect(evidenceDetachedIndex).toBeLessThan(consumedIndex);
    expect(seedIndex).toBeGreaterThan(consumedIndex);
    expect(reanswerIndex).toBeGreaterThan(seedIndex);
    expect(officialIndex).toBeGreaterThan(reanswerIndex);
  });

  it("derives one fixed protocol-v2 namespace and output identity from candidate C", () => {
    expect(deriveV073FullClaimProtocol2Identity("a".repeat(40))).toEqual({
      finalRunId: "v073-aaaaaaaa-full1540-protocol2-final",
      namespace: "v073-aaaaaaaa-full1540-protocol2",
      officialRunId: "v073-aaaaaaaa-full1540-protocol2-official-gpt55",
      outputRoot: "reports/eval/research/v073-aaaaaaaa-full1540-protocol2",
      seedRunId: "v073-aaaaaaaa-full1540-protocol2-seed",
    });
    expect(() => deriveV073FullClaimProtocol2Identity("not-a-commit")).toThrow(
      "full protocol candidate commit",
    );
  });

  it("mechanically derives the complete seed -> reanswer -> official chain", () => {
    const outputRoot = join(REPO_ROOT, "reports/eval/research/v073-current");
    const chain = buildV073FullClaimCommandChain({
      answerGateway: "https://ai.gurkiai.com/v1",
      answerModel: "gpt-5.6-terra",
      answerProvider: "openai",
      assistedExtractorGateway: "https://ai.gurkiai.com/v1",
      assistedExtractorModel: "gpt-5.6-terra",
      assistedExtractorProvider: "openai",
      benchmarkRoot: join(
        homedir(),
        ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      ),
      embeddingGateway: "https://openrouter.ai/api/v1",
      embeddingModel: "text-embedding-3-small",
      embeddingProvider: "openai",
      finalOutputPath: join(outputRoot, "candidate-final"),
      finalRunId: "candidate-final",
      judgeGateway: "https://ai.gurkiai.com/v1",
      judgeModel: "gpt-5.5",
      judgeProvider: "openai",
      officialRunId: "candidate-official",
      rerankingGateway: "https://ai.gurkiai.com/v1",
      rerankingModel: "gpt-5.6-terra",
      rerankingProvider: "openai",
      seedOutputPath: join(outputRoot, "candidate-seed"),
      seedRunId: "candidate-seed",
      worktreePath: REPO_ROOT,
    }, CLAIM_RAW);
    withV073NoEnvFileCommandChain(chain);

    expect(chain.seedSmoke.args).not.toContain("--case-id");
    expect(chain.seedSmoke.args[0]).toBe("--no-env-file");
    expect(chain.reanswer.args[0]).toBe("--no-env-file");
    expect(chain.officialRescore.args[0]).toBe("--no-env-file");
    expect(chain.seedSmoke.args[2]).toBe(
      "scripts/run-phase-65-locomo-smoke.ts",
    );
    expect(chain.reanswer.args[2]).toBe(
      "scripts/reanswer-phase-65-locomo-report.ts",
    );
    expect(chain.officialRescore.args[2]).toBe(
      "scripts/rescore-official-protocols.ts",
    );
    expect(chain.officialRescore.args).not.toContain("eval:official-rescore");
    expect(chain.seedSmoke.args).toContain("candidate-seed");
    expect(chain.reanswer.args).toContain(
      join(outputRoot, "candidate-seed/smoke-report.json"),
    );
    expect(chain.officialRescore.args).toContain(
      join(outputRoot, "candidate-final/smoke-report.json"),
    );
    expect(chain.seedSmoke.environment).toEqual(expect.objectContaining({
      GOODMEMORY_ASSISTED_EXTRACTOR_MODEL: "gpt-5.6-terra",
      GOODMEMORY_EMBEDDING_BASE_URL: "https://openrouter.ai/api/v1",
      GOODMEMORY_EMBEDDING_MODEL: "text-embedding-3-small",
      GOODMEMORY_RERANKING_MODEL: "gpt-5.6-terra",
    }));
    expect(chain.officialRescore.environment).toEqual(expect.objectContaining({
      GOODMEMORY_JUDGE_BASE_URL: "https://ai.gurkiai.com/v1",
    }));
    const rendered = renderV073FullClaimCommand(chain, REPO_ROOT);
    expect(rendered).toContain("candidate-seed");
    expect(rendered).toContain("candidate-final");
    expect(rendered).toContain("candidate-official");
    expect(rendered).toContain("GOODMEMORY_JUDGE_MODEL=gpt-5.5");
    expect(rendered).not.toContain(REPO_ROOT);
    const resumed = renderV073FullClaimProtocol2Command(chain, REPO_ROOT, 2);
    expect(resumed.match(/candidate-seed/gu)?.length).toBe(
      (rendered.match(/candidate-seed/gu)?.length ?? 0) + 1,
    );

    const originalBenchmarkRoot = join(
      homedir(),
      ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
    );
    const otherBenchmarkRoot =
      "/different-home/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1";
    const otherHomeChain: typeof chain = structuredClone(chain);
    for (const invocation of [
      otherHomeChain.seedSmoke,
      otherHomeChain.reanswer,
      otherHomeChain.officialRescore,
    ]) {
      invocation.args = invocation.args.map((argument: string) =>
        argument.replace(originalBenchmarkRoot, otherBenchmarkRoot));
    }
    const originalHomeCommand = renderV073FullClaimProtocol2Command(
      chain,
      REPO_ROOT,
      1,
    );
    const otherHomeCommand = renderV073FullClaimProtocol2Command(
      otherHomeChain,
      REPO_ROOT,
      1,
    );
    expect(otherHomeCommand).toBe(originalHomeCommand);
    expect(originalHomeCommand).toContain("@locomo-full10-root");
    expect(originalHomeCommand).not.toContain(originalBenchmarkRoot);
    expect(originalHomeCommand).not.toContain("~/.cache");
  });

  it("prevents a candidate cwd .env from injecting or replacing frozen child values", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-no-env-file-"));
    const scriptsPath = join(root, "scripts");
    await mkdir(scriptsPath);
    const scriptRaw =
      "console.log(JSON.stringify({ model: process.env.GOODMEMORY_EVAL_MODEL, storage: process.env.GOODMEMORY_STORAGE_URL ?? null }));\n";
    await Promise.all([
      writeFile(
        join(root, ".env"),
        [
          "GOODMEMORY_EVAL_MODEL=dotenv-model",
          "GOODMEMORY_STORAGE_URL=postgres://dotenv-injection",
          "",
        ].join("\n"),
      ),
      writeFile(
        join(root, "package.json"),
        `${JSON.stringify({
          scripts: {
            "eval:official-rescore":
              "bun run scripts/rescore-official-protocols.ts",
          },
        })}\n`,
      ),
      writeFile(join(scriptsPath, "run-phase-65-locomo-smoke.ts"), scriptRaw),
      writeFile(
        join(scriptsPath, "reanswer-phase-65-locomo-report.ts"),
        scriptRaw,
      ),
      writeFile(join(scriptsPath, "rescore-official-protocols.ts"), scriptRaw),
    ]);
    try {
      const invocation = (target: string): V073CommandInvocation => ({
        args: ["run", target],
        command: "bun",
        cwd: root,
        environment: {
          GOODMEMORY_EVAL_MODEL: "frozen-model",
          PATH: process.env.PATH ?? "",
        },
      });
      const nestedControl = invocation("eval:official-rescore");
      const nestedResult = Bun.spawnSync([
        nestedControl.command,
        "--no-env-file",
        ...nestedControl.args,
      ], {
        cwd: nestedControl.cwd,
        env: nestedControl.environment,
      });
      expect(nestedResult.exitCode).toBe(0);
      expect(JSON.parse(nestedResult.stdout.toString())).toEqual({
        model: "frozen-model",
        storage: "postgres://dotenv-injection",
      });
      const chain = withV073NoEnvFileCommandChain({
        officialRescore: invocation("eval:official-rescore"),
        reanswer: invocation("scripts/reanswer-phase-65-locomo-report.ts"),
        seedSmoke: invocation("scripts/run-phase-65-locomo-smoke.ts"),
      });
      expect(chain.officialRescore.args).toEqual([
        "--no-env-file",
        "run",
        "scripts/rescore-official-protocols.ts",
      ]);
      for (const child of [
        chain.seedSmoke,
        chain.reanswer,
        chain.officialRescore,
      ]) {
        const result = Bun.spawnSync([child.command, ...child.args], {
          cwd: child.cwd,
          env: child.environment,
        });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout.toString())).toEqual({
          model: "frozen-model",
          storage: null,
        });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("builds a frozen provider child environment without ambient overrides", () => {
    const providerPrefixes = [
      "GOODMEMORY_ASSISTED_EXTRACTOR",
      "GOODMEMORY_EMBEDDING",
      "GOODMEMORY_EVAL",
      "GOODMEMORY_JUDGE",
      "GOODMEMORY_RERANKING",
    ];
    const hostEnvironment: Record<string, string> = {
      HOME: "/Users/test",
      PATH: "/usr/bin:/bin",
      TMPDIR: "/tmp/test/",
      GOODMEMORY_LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS: "1",
      GOODMEMORY_LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS: "2",
      GOODMEMORY_OFFICIAL_RESCORE_REQUEST_TIMEOUT_MS: "3",
      GOODMEMORY_STORAGE_URL: "postgres://ambient",
      UNRELATED_SECRET: "must-not-enter-child",
    };
    for (const prefix of providerPrefixes) {
      hostEnvironment[`${prefix}_API_KEY`] = `${prefix}-secret`;
      hostEnvironment[`${prefix}_BASE_URL`] = `https://${prefix}.example/v1`;
      hostEnvironment[`${prefix}_MODEL`] = `${prefix}-ambient-model`;
      hostEnvironment[`${prefix}_PROVIDER`] = "openai";
    }
    const commandEnvironment = {
      GOODMEMORY_EVAL_BASE_URL: "https://eval.example/v1",
      GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
      GOODMEMORY_EVAL_PROVIDER: "openai",
    };
    const first = buildV073FrozenProviderChildEnvironment({
      commandEnvironment,
      hostEnvironment,
    });
    const second = buildV073FrozenProviderChildEnvironment({
      commandEnvironment,
      hostEnvironment: {
        ...hostEnvironment,
        GOODMEMORY_LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS: "999999",
        GOODMEMORY_OFFICIAL_RESCORE_REQUEST_TIMEOUT_MS: "999999",
      },
    });
    expect(second).toEqual(first);
    expect(first).toEqual(expect.objectContaining({
      HOME: "/Users/test",
      PATH: "/usr/bin:/bin",
      TMPDIR: "/tmp/test/",
      GOODMEMORY_EVAL_API_KEY: "GOODMEMORY_EVAL-secret",
      GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
    }));
    expect(first).not.toHaveProperty(
      "GOODMEMORY_LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS",
    );
    expect(first).not.toHaveProperty(
      "GOODMEMORY_OFFICIAL_RESCORE_REQUEST_TIMEOUT_MS",
    );
    expect(first).not.toHaveProperty("GOODMEMORY_STORAGE_URL");
    expect(first).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("derives the exact expected extraction cache keys from frozen sessions", () => {
    const expected = deriveV073ExpectedExtractionCache({
      configTag: "gpt-5.6-terra",
      rootRaw: frozenCacheRootRaw(),
    });
    expect(expected.size).toBe(272);
    expect(new Set(expected.values())).toEqual(
      new Set(Object.keys(V073_FULL_LOCOMO_CASE_QUESTION_COUNTS)),
    );
    let firstHash = 0;
    const firstMessages = JSON.stringify([
      { content: "A: message-0-0", role: "user" },
    ]);
    for (let index = 0; index < firstMessages.length; index += 1) {
      firstHash = (firstHash * 31 + firstMessages.charCodeAt(index)) >>> 0;
    }
    expect(expected.get(`gpt-5.6-terra:${firstHash}`)).toBe("locomo-conv-26");
  });

  it("requires a separate evidence worktree and keeps candidate provenance clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-repos-"));
    const candidate = join(root, "candidate");
    const evidence = join(root, "evidence");
    await Promise.all([
      mkdir(candidate),
      mkdir(evidence),
    ]);
    try {
      await expect(resolveDistinctV073FullClaimRepositories({
        candidateWorktree: candidate,
        evidenceRepo: candidate,
      })).rejects.toThrow("must be a separate worktree");
      await expect(resolveDistinctV073FullClaimRepositories({
        candidateWorktree: root,
        evidenceRepo: evidence,
      })).rejects.toThrow("must be a separate worktree");
      const resolved = await resolveDistinctV073FullClaimRepositories({
        candidateWorktree: candidate,
        evidenceRepo: evidence,
      });
      expect(resolved).toEqual({
        candidateWorktree: await realpath(candidate),
        evidenceRepo: await realpath(evidence),
      });

      const clean = { headCommit: "a".repeat(40), statusPorcelain: "" };
      expect(() => assertV073CandidateProvenanceUnchanged({
        current: clean,
        expected: clean,
        label: "candidate",
      })).not.toThrow();
      expect(() => assertV073CandidateProvenanceUnchanged({
        current: { ...clean, statusPorcelain: "?? evidence.json\n" },
        expected: clean,
        label: "candidate",
      })).toThrow("candidate worktree must be clean");

      expect(() => assertV073EvidencePublicationStatus({
        current: {
          headCommit: "b".repeat(40),
          statusPorcelain:
            "?? benchmark-claims/evidence/locomo-v0.7.3-current.json\n" +
            "?? reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json\n",
        },
        expectedHeadCommit: "b".repeat(40),
        fileNames: ["execution-receipt.json"],
      })).not.toThrow();
      expect(() => assertV073EvidencePublicationStatus({
        current: {
          headCommit: "b".repeat(40),
          statusPorcelain: "?? unexpected.txt\n",
        },
        expectedHeadCommit: "b".repeat(40),
        fileNames: ["execution-receipt.json"],
      })).toThrow("changed outside the expected tracked bundle");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires candidate and evidence repositories to be detached", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-detached-"));
    const candidate = join(root, "candidate");
    const evidence = join(root, "evidence");
    try {
      for (const repository of [candidate, evidence]) {
        await mkdir(repository);
        git(repository, "init", "--quiet");
        git(repository, "config", "user.email", "test@example.com");
        git(repository, "config", "user.name", "Test");
        await writeFile(join(repository, "identity.txt"), repository, "utf8");
        git(repository, "add", "identity.txt");
        git(repository, "commit", "--quiet", "-m", "identity");
      }

      await expect(assertV073GitCheckoutDetached(candidate, "candidate"))
        .rejects.toThrow("candidate worktree must be detached");
      await expect(assertV073GitCheckoutDetached(evidence, "evidence"))
        .rejects.toThrow("evidence worktree must be detached");

      git(candidate, "checkout", "--quiet", "--detach");
      git(evidence, "checkout", "--quiet", "--detach");
      await expect(assertV073GitCheckoutDetached(candidate, "candidate"))
        .resolves.toBeUndefined();
      await expect(assertV073GitCheckoutDetached(evidence, "evidence"))
        .resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an arbitrary clean git repository as the evidence worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-lineage-"));
    const candidate = join(root, "candidate");
    const unrelated = join(root, "unrelated");
    try {
      for (const repository of [candidate, unrelated]) {
        await mkdir(repository);
        git(repository, "init", "--quiet");
        git(repository, "config", "user.email", "test@example.com");
        git(repository, "config", "user.name", "Test");
        await writeFile(join(repository, "identity.txt"), repository, "utf8");
        git(repository, "add", "identity.txt");
        git(repository, "commit", "--quiet", "-m", "identity");
      }
      const candidateCommit = git(candidate, "rev-parse", "HEAD");
      await expect(assertV073EvidenceRepositoryLineage({
        evidenceHeadCommit: candidateCommit,
        evidenceRepo: candidate,
        expectedCandidateCommit: candidateCommit,
      })).resolves.toBeUndefined();
      await expect(assertV073EvidenceRepositoryLineage({
        evidenceHeadCommit: git(unrelated, "rev-parse", "HEAD"),
        evidenceRepo: unrelated,
        expectedCandidateCommit: candidateCommit,
      })).rejects.toThrow("must equal the expected candidate commit");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("stages and publishes the tracked bundle create-only outside the candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-publish-"));
    const evidence = join(root, "evidence");
    await mkdir(evidence);
    try {
      const staged = await stageV073FullClaimPublication({
        evidenceRepo: evidence,
        projectionRaw: "{\"projection\":true}\n",
        trackedRaws: {
          "execution-receipt.json": "{\"receipt\":true}\n",
          "seed-smoke-report.json": "{\"seed\":true}\n",
        },
      });
      await expect(stat(staged.partialEvidenceRootPath)).resolves.toBeDefined();
      await expect(stat(staged.evidenceRootPath)).rejects.toThrow();
      await publishV073FullClaimPublication(staged);
      await expect(readFile(
        join(staged.evidenceRootPath, "execution-receipt.json"),
        "utf8",
      )).resolves.toBe("{\"receipt\":true}\n");
      await expect(readFile(staged.projectionPath, "utf8")).resolves.toBe(
        "{\"projection\":true}\n",
      );
      await expect(stat(staged.partialEvidenceRootPath)).rejects.toThrow();
      await expect(stat(staged.partialProjectionPath)).rejects.toThrow();

      const raced = await stageV073FullClaimPublication({
        evidenceRepo: join(root, "second-evidence"),
        projectionRaw: "{}\n",
        trackedRaws: { "execution-receipt.json": "{}\n" },
      });
      await mkdir(raced.evidenceRootPath);
      await expect(publishV073FullClaimPublication(raced)).rejects.toThrow(
        "must not exist before launch",
      );
      await expect(stat(raced.partialEvidenceRootPath)).resolves.toBeDefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves canonical pass-one evidence through terminal or successful completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-pass1-evidence-"));
    const evidence = join(root, "evidence");
    await mkdir(evidence);
    const artifacts = {
      extractionCacheRaw: "{\"candidates\":[],\"key\":\"one\"}\n",
      progressRaw: "{\"kind\":\"locomo-progress-config\"}\n",
      reportRaw: "{\"attempt\":1}\n",
    };
    try {
      const evidenceRoot = await persistV073SeedAttemptOneEvidence({
        artifacts,
        evidenceRepo: evidence,
      });
      expect((await readdir(evidenceRoot)).sort()).toEqual([
        "seed-attempt-1-extraction-cache.jsonl",
        "seed-attempt-1-live-progress.jsonl",
        "seed-attempt-1-smoke-report.json",
      ]);
      await expect(persistV073SeedAttemptOneEvidence({
        artifacts,
        evidenceRepo: evidence,
      })).rejects.toThrow("must not exist before launch");

      const terminalRepo = join(root, "terminal-evidence");
      await mkdir(terminalRepo);
      const terminalRoot = await persistV073SeedAttemptOneEvidence({
        artifacts,
        evidenceRepo: terminalRepo,
      });
      const finalArtifacts = {
        extractionCacheRaw: `${artifacts.extractionCacheRaw}{"candidates":[],"key":"two"}\n`,
        progressRaw: `${artifacts.progressRaw}{"row":2}\n`,
        reportRaw: "{\"attempt\":2}\n",
      };
      await persistV073FinalSeedEvidence({
        artifacts: finalArtifacts,
        evidenceRepo: terminalRepo,
      });
      await persistV073FinalReportEvidence({
        evidenceRepo: terminalRepo,
        finalRaw: "{\"final\":true}\n",
      });
      await persistV073OfficialEvidence({
        evidenceRepo: terminalRepo,
        progressRaw: "{\"questionId\":\"q1\"}\n",
      });
      await persistV073TerminalClaimReceipt({
        evidenceRepo: terminalRepo,
        receiptRaw: "{\"outcome\":\"terminal\"}\n",
      });
      expect((await readdir(terminalRoot)).sort()).toEqual([
        "execution-receipt.json",
        "final-smoke-report.json",
        "official-progress.jsonl",
        "seed-attempt-1-extraction-cache.jsonl",
        "seed-attempt-1-live-progress.jsonl",
        "seed-attempt-1-smoke-report.json",
        "seed-extraction-cache.jsonl",
        "seed-live-progress.jsonl",
        "seed-smoke-report.json",
      ]);
      await expect(persistV073FinalSeedEvidence({
        artifacts: finalArtifacts,
        evidenceRepo: terminalRepo,
      })).rejects.toMatchObject({ code: "EEXIST" });
      await expect(persistV073TerminalClaimReceipt({
        evidenceRepo: terminalRepo,
        receiptRaw: "{}\n",
      })).rejects.toMatchObject({ code: "EEXIST" });

      const emptyTerminalRepo = join(root, "empty-terminal-evidence");
      await mkdir(emptyTerminalRepo);
      await persistV073TerminalClaimReceipt({
        evidenceRepo: emptyTerminalRepo,
        receiptRaw: "{\"seedAttemptOne\":null}\n",
      });
      expect(await readdir(join(
        emptyTerminalRepo,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence",
      ))).toEqual(["execution-receipt.json"]);

      const preservedRaws = {
        "final-smoke-report.json": "{\"final\":true}\n",
        "official-progress.jsonl": "{\"questionId\":\"q1\"}\n",
        "official-rescore-summary.json": "{\"official\":true}\n",
        "seed-attempt-1-extraction-cache.jsonl": artifacts.extractionCacheRaw,
        "seed-attempt-1-live-progress.jsonl": artifacts.progressRaw,
        "seed-attempt-1-smoke-report.json": artifacts.reportRaw,
        "seed-extraction-cache.jsonl": finalArtifacts.extractionCacheRaw,
        "seed-live-progress.jsonl": finalArtifacts.progressRaw,
        "seed-smoke-report.json": finalArtifacts.reportRaw,
      };
      await persistV073FinalSeedEvidence({
        artifacts: finalArtifacts,
        evidenceRepo: evidence,
      });
      await persistV073FinalReportEvidence({
        evidenceRepo: evidence,
        finalRaw: "{\"final\":true}\n",
      });
      await persistV073OfficialEvidence({
        evidenceRepo: evidence,
        progressRaw: "{\"questionId\":\"q1\"}\n",
        summaryRaw: "{\"official\":true}\n",
      });
      const trackedRaws = {
        ...preservedRaws,
        "execution-receipt.json": "{\"outcome\":\"success\"}\n",
      };
      const staged = await stageV073FullClaimPublication({
        evidenceRepo: evidence,
        preservedRaws,
        projectionRaw: "{\"projection\":true}\n",
        trackedRaws,
      });
      await publishV073FullClaimPublication(staged);
      expect((await readdir(evidenceRoot)).sort()).toEqual(
        Object.keys(trackedRaws).sort(),
      );
      expect(await readFile(
        join(evidenceRoot, "seed-attempt-1-smoke-report.json"),
        "utf8",
      )).toBe(artifacts.reportRaw);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves only available nonzero-stage artifacts create-only before terminal evidence", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "goodmemory-full-claim-nonzero-evidence-"),
    );
    const evidenceRepo = join(root, "evidence");
    const seedOutputPath = join(root, "seed");
    const finalPath = join(root, "final", "smoke-report.json");
    await Promise.all([
      mkdir(evidenceRepo),
      mkdir(seedOutputPath),
      mkdir(join(root, "final")),
    ]);
    try {
      await Promise.all([
        writeFile(join(seedOutputPath, "smoke-report.json"), "{\"attempt\":1}\n"),
        writeFile(
          join(seedOutputPath, "extraction-cache.jsonl"),
          "{\"cache\":1}\n",
        ),
      ]);
      const attemptOne = await preserveV073SeedArtifactsIfPresent({
        attempt: 1,
        evidenceRepo,
        seedOutputPath,
      });
      expect(attemptOne).toEqual({
        extractionCacheRaw: "{\"cache\":1}\n",
        reportRaw: "{\"attempt\":1}\n",
      });
      expect((await readdir(join(
        evidenceRepo,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence",
      ))).sort()).toEqual([
        "seed-attempt-1-extraction-cache.jsonl",
        "seed-attempt-1-smoke-report.json",
      ]);
      await expect(preserveV073SeedArtifactsIfPresent({
        attempt: 1,
        evidenceRepo,
        seedOutputPath,
      })).rejects.toMatchObject({ code: "EEXIST" });

      await Promise.all([
        writeFile(join(seedOutputPath, "smoke-report.json"), "{\"attempt\":2}\n"),
        writeFile(join(seedOutputPath, "live-progress.jsonl"), "{\"row\":2}\n"),
      ]);
      const attemptTwo = await preserveV073SeedArtifactsIfPresent({
        attempt: 2,
        evidenceRepo,
        seedOutputPath,
      });
      expect(attemptTwo).toEqual({
        extractionCacheRaw: "{\"cache\":1}\n",
        progressRaw: "{\"row\":2}\n",
        reportRaw: "{\"attempt\":2}\n",
      });
      await writeFile(finalPath, "{\"final\":true}\n");
      await expect(preserveV073FinalReportIfPresent({
        evidenceRepo,
        finalPath,
      })).resolves.toBe("{\"final\":true}\n");
      await expect(preserveV073FinalReportIfPresent({
        evidenceRepo,
        finalPath,
      })).rejects.toMatchObject({ code: "EEXIST" });
      expect((await readdir(join(
        evidenceRepo,
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence",
      ))).sort()).toEqual([
        "final-smoke-report.json",
        "seed-attempt-1-extraction-cache.jsonl",
        "seed-attempt-1-smoke-report.json",
        "seed-extraction-cache.jsonl",
        "seed-live-progress.jsonl",
        "seed-smoke-report.json",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("snapshots pass-one seed report, progress, and cache create-only before resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-seed-snapshot-"));
    const seedOutputPath = join(root, "seed");
    const snapshotPath = join(root, "seed-attempt-1");
    await mkdir(seedOutputPath);
    await Promise.all([
      writeFile(join(seedOutputPath, "smoke-report.json"), "{\"attempt\":1}\n"),
      writeFile(join(seedOutputPath, "live-progress.jsonl"), "{\"row\":1}\n"),
      writeFile(join(seedOutputPath, "extraction-cache.jsonl"), "{\"cache\":1}\n"),
    ]);
    try {
      const snapshot = await snapshotV073SeedAttemptOne({
        seedOutputPath,
        snapshotPath,
      });
      expect(snapshot.reportRaw).toBe("{\"attempt\":1}\n");
      expect(snapshot.progressRaw).toBe("{\"row\":1}\n");
      expect(snapshot.extractionCacheRaw).toBe("{\"cache\":1}\n");
      await writeFile(join(seedOutputPath, "smoke-report.json"), "{\"attempt\":2}\n");
      expect(await readFile(join(snapshotPath, "smoke-report.json"), "utf8")).toBe(
        "{\"attempt\":1}\n",
      );
      await expect(snapshotV073SeedAttemptOne({
        seedOutputPath,
        snapshotPath,
      })).rejects.toThrow("seed attempt-one snapshot must not exist");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("consumes the canonical release-main attempt sentinel exactly once", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "goodmemory-full-claim-protocol2-consume-"),
    );
    try {
      const repository = await writeProtocol2ReleaseRepository({ root });
      const consumed = await consumeV073FullClaimProtocol2Attempt({
        generatedAt: "2026-08-10T13:00:00.000Z",
        protocolCandidateCommit: repository.protocolCandidateCommit,
        releaseCommit: repository.releaseCommit,
        releaseRepo: repository.releaseRepo,
      });
      expect(consumed.sentinel.releaseCommit).toBe(repository.releaseCommit);
      expect(consumed.sentinelCommit).toMatch(/^[0-9a-f]{40}$/u);
      expect(git(repository.releaseRepo, "rev-parse", "HEAD")).toBe(
        consumed.sentinelCommit,
      );
      expect(git(repository.remote, "rev-parse", "refs/heads/main")).toBe(
        consumed.sentinelCommit,
      );
      expect(git(
        repository.releaseRepo,
        "diff",
        "--name-only",
        repository.releaseCommit,
        consumed.sentinelCommit,
      )).toBe(
        "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
      );
      expect(consumed.preregistrationIdentity.path).toBe(
        repository.preregistrationPath,
      );
      expect(consumed.sentinelIdentity.path).toBe(
        "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
      );
      await expect(consumeV073FullClaimProtocol2Attempt({
        generatedAt: "2026-08-10T13:01:00.000Z",
        protocolCandidateCommit: repository.protocolCandidateCommit,
        releaseCommit: consumed.sentinelCommit,
        releaseRepo: repository.releaseRepo,
      })).rejects.toThrow("already consumed in Git history");

      const rejectedRoot = join(root, "rejected");
      await mkdir(rejectedRoot);
      const rejected = await writeProtocol2ReleaseRepository({
        rejectSentinelPush: true,
        root: rejectedRoot,
      });
      await expect(consumeV073FullClaimProtocol2Attempt({
        protocolCandidateCommit: rejected.protocolCandidateCommit,
        releaseCommit: rejected.releaseCommit,
        releaseRepo: rejected.releaseRepo,
      })).rejects.toThrow("does not contain the protocol-v2 sentinel commit");
      expect(git(rejected.remote, "rev-parse", "refs/heads/main")).toBe(
        rejected.releaseCommit,
      );

      const driftRoot = join(root, "remote-drift");
      await mkdir(driftRoot);
      const drifted = await writeProtocol2ReleaseRepository({ root: driftRoot });
      const otherClone = join(driftRoot, "other-clone");
      git(
        driftRoot,
        "clone",
        "--quiet",
        "--branch",
        "main",
        drifted.remote,
        otherClone,
      );
      git(otherClone, "config", "user.email", "test@example.com");
      git(otherClone, "config", "user.name", "Test");
      await writeFile(join(otherClone, "remote-drift.txt"), "drift\n");
      git(otherClone, "add", "remote-drift.txt");
      git(otherClone, "commit", "--quiet", "-m", "remote drift");
      git(otherClone, "push", "--quiet", "origin", "main");
      await expect(consumeV073FullClaimProtocol2Attempt({
        protocolCandidateCommit: drifted.protocolCandidateCommit,
        releaseCommit: drifted.releaseCommit,
        releaseRepo: drifted.releaseRepo,
      })).rejects.toThrow("origin/main moved");
      await expect(stat(join(
        drifted.releaseRepo,
        "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
      ))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses remote sentinel ancestry as the authoritative push outcome", () => {
    const sentinelCommit = "a".repeat(40);
    expect(() => assertV073SentinelRemoteConfirmation({
      pushExitCode: 1,
      remoteExitCode: 0,
      remoteHeadCommit: sentinelCommit,
      sentinelCommit,
      sentinelIsRemoteAncestor: false,
    })).not.toThrow();
    expect(() => assertV073SentinelRemoteConfirmation({
      pushExitCode: 0,
      remoteExitCode: 0,
      remoteHeadCommit: "b".repeat(40),
      sentinelCommit,
      sentinelIsRemoteAncestor: true,
    })).not.toThrow();
    expect(() => assertV073SentinelRemoteConfirmation({
      pushExitCode: 1,
      remoteExitCode: 0,
      remoteHeadCommit: "b".repeat(40),
      sentinelCommit,
      sentinelIsRemoteAncestor: false,
    })).toThrow("does not contain the protocol-v2 sentinel commit");
    expect(() => assertV073SentinelRemoteConfirmation({
      pushExitCode: 1,
      remoteExitCode: 1,
      remoteHeadCommit: "",
      sentinelCommit,
      sentinelIsRemoteAncestor: false,
    })).toThrow("cannot confirm whether origin/main consumed");
  });

  it("binds terminal seed, reanswer, and official stage evidence", () => {
    const invocation: V073CommandInvocation = {
      args: ["run", "stage.ts"],
      command: "bun",
      cwd: REPO_ROOT,
      environment: {},
    };
    const artifacts = {
      extractionCacheRaw: "{\"candidates\":[],\"key\":\"one\"}\n",
      progressRaw: "{\"kind\":\"locomo-progress-config\"}\n",
      reportRaw: "{\"attempt\":1}\n",
    };
    const common = {
      generatedAt: "2026-08-10T12:00:00.000Z",
      lifecycleCandidateCommit: "a".repeat(40),
      protocolCandidateCommit: "b".repeat(40),
      seedAttemptOne: {
        artifacts,
        classification: {
          failedCaseId: "locomo-conv-43",
          recoveryClassification: "eligible-single-case-seed-timeout" as const,
        },
      },
      sentinel: {
        bytes: 3,
        path: "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
        sha256: "c".repeat(64),
      },
      sentinelCommit: "d".repeat(40),
      stageInvocation: invocation,
    };
    const passTwoNonzero = JSON.parse(buildV073TerminalClaimReceipt({
      ...common,
      seedFinal: {
        artifacts: { reportRaw: "{\"attempt\":2}\n" },
        attempt: 2,
      },
      seedLaunches: 2,
      stage: "seed",
      stageProcess: { exitCode: 17, stderr: "ignored", stdout: "ignored" },
      stageSeedAttempt: 2,
    })) as Record<string, unknown>;
    expect(passTwoNonzero).toEqual(expect.objectContaining({
      finalReport: null,
      seedFinal: expect.objectContaining({
        attempt: 2,
        extractionCache: null,
        progress: null,
        report: expect.objectContaining({
          path: expect.stringContaining("seed-smoke-report.json"),
        }),
      }),
      seedLaunches: 2,
      stage: "seed",
      stageResult: { exitCode: 17, seedAttempt: 2 },
    }));

    const cleanSeed = {
      artifacts,
      attempt: 1 as const,
      classification: {
        failedCaseId: null,
        recoveryClassification: "failure-free" as const,
      },
    };
    const reanswerTerminal = JSON.parse(buildV073TerminalClaimReceipt({
      ...common,
      seedFinal: cleanSeed,
      seedLaunches: 1,
      stage: "reanswer",
      stageProcess: { exitCode: 19, stderr: "ignored", stdout: "ignored" },
      stageSeedAttempt: null,
    })) as Record<string, unknown>;
    expect(reanswerTerminal).toEqual(expect.objectContaining({
      finalReport: null,
      seedFinal: expect.objectContaining({
        attempt: 1,
        recoveryClassification: "failure-free",
      }),
      stageResult: { exitCode: 19, seedAttempt: null },
    }));

    const officialTerminal = JSON.parse(buildV073TerminalClaimReceipt({
      ...common,
      finalReportRaw: "{\"final\":true}\n",
      officialProgressRaw: "{\"questionId\":\"q1\"}\n",
      seedFinal: cleanSeed,
      seedLaunches: 1,
      stage: "official-rescore",
      stageProcess: { exitCode: 23, stderr: "ignored", stdout: "ignored" },
      stageSeedAttempt: null,
    })) as Record<string, unknown>;
    expect(officialTerminal).toEqual(expect.objectContaining({
      finalReport: expect.objectContaining({
        path: expect.stringContaining("final-smoke-report.json"),
      }),
      officialProgress: expect.objectContaining({
        path: expect.stringContaining("official-progress.jsonl"),
      }),
      officialSummary: null,
      stageResult: { exitCode: 23, seedAttempt: null },
    }));
    expect(JSON.stringify(officialTerminal)).not.toContain("ignored");

    const malformedOfficial = JSON.parse(buildV073TerminalClaimReceipt({
      ...common,
      finalReportRaw: "{\"final\":true}\n",
      officialProgressRaw: "malformed-progress\n",
      officialSummaryRaw: "{malformed-summary\n",
      seedFinal: cleanSeed,
      seedLaunches: 1,
      stage: "official-rescore",
      stageProcess: { exitCode: 0, stderr: "ignored", stdout: "ignored" },
      stageSeedAttempt: null,
    })) as Record<string, unknown>;
    expect(malformedOfficial).toEqual(expect.objectContaining({
      officialProgress: expect.objectContaining({ bytes: 19 }),
      officialSummary: expect.objectContaining({ bytes: 19 }),
      stageResult: { exitCode: 0, seedAttempt: null },
    }));
    const emptyFinal = JSON.parse(buildV073TerminalClaimReceipt({
      ...common,
      finalReportRaw: "",
      seedFinal: cleanSeed,
      seedLaunches: 1,
      stage: "reanswer",
      stageSeedAttempt: null,
    })) as Record<string, unknown>;
    expect(emptyFinal.finalReport).toEqual(expect.objectContaining({ bytes: 0 }));
  });

  it("permits one resume only for a complete single-case 120000ms seed timeout", () => {
    const eligible = fullClaimOutputs();
    const failedCaseId = "locomo-conv-43";
    eligible.seed = seedTimeoutReport(failedCaseId);
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: extractionCacheRaw(271),
      progressRaw: progressRaw(eligible.seed),
      report: eligible.seed,
      runId: "seed",
    })).toEqual({
      failedCaseId,
      recoveryClassification: "eligible-single-case-seed-timeout",
    });

    const failureFree = fullClaimOutputs();
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(),
      extractionCacheRaw: extractionCacheRaw(272),
      progressRaw: progressRaw(failureFree.seed),
      report: failureFree.seed,
      runId: "seed",
    })).toEqual({
      failedCaseId: null,
      recoveryClassification: "failure-free",
    });

    const wrongStage = structuredClone(eligible.seed);
    (wrongStage.cases.find((row) => row.caseId === failedCaseId) as {
      executionFailureStage: string | null;
    }).executionFailureStage = "recall";
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: extractionCacheRaw(271),
      progressRaw: progressRaw(wrongStage),
      report: wrongStage,
      runId: "seed",
    })).toEqual({
      failedCaseId,
      recoveryClassification: "terminal",
    });

    const twoCases = structuredClone(eligible.seed);
    const secondCaseRows = twoCases.cases.filter(
      (row) => row.caseId === "locomo-conv-44",
    );
    for (const row of secondCaseRows) {
      Object.assign(row, {
        executionFailureMessage:
          "OpenAI-compatible gateway timeout after 120000ms.",
        executionFailureStage: "seed",
      });
    }
    twoCases.executionFailures += secondCaseRows.length;
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: extractionCacheRaw(271),
      progressRaw: progressRaw(twoCases),
      report: twoCases,
      runId: "seed",
    })
      .recoveryClassification).toBe("terminal");

    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: extractionCacheRaw(270),
      progressRaw: progressRaw(eligible.seed),
      report: eligible.seed,
      runId: "seed",
    }).recoveryClassification).toBe("terminal");

    const missingCandidates = extractionCacheRaw(271).replace(
      '{"candidates":[],"key":"key-0"}',
      '{"key":"key-0"}',
    );
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: missingCandidates,
      progressRaw: progressRaw(eligible.seed),
      report: eligible.seed,
      runId: "seed",
    }).recoveryClassification).toBe("terminal");

    const missingProgressConfig = progressRaw(eligible.seed).replace(
      /"config":\{[^\n]+?\},"configFingerprint"/u,
      '"configFingerprint"',
    );
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: extractionCacheRaw(271),
      progressRaw: missingProgressConfig,
      report: eligible.seed,
      runId: "seed",
    }).recoveryClassification).toBe("terminal");

    const invalidProgressFingerprint = progressRaw(eligible.seed).replace(
      /"configFingerprint":"[0-9a-f]{64}"/u,
      `"configFingerprint":"${"f".repeat(64)}"`,
    );
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: extractionCacheRaw(271),
      progressRaw: invalidProgressFingerprint,
      report: eligible.seed,
      runId: "seed",
    }).recoveryClassification).toBe("terminal");

    const missingProgress = progressRaw(eligible.seed).trimEnd().split("\n");
    missingProgress.pop();
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: extractionCacheRaw(271),
      progressRaw: `${missingProgress.join("\n")}\n`,
      report: eligible.seed,
      runId: "seed",
    }).recoveryClassification).toBe("terminal");

    const sameCountFakeKey = extractionCacheRaw(271).replace(
      '"key":"key-0"',
      '"key":"invented-key"',
    );
    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey(failedCaseId),
      extractionCacheRaw: sameCountFakeKey,
      progressRaw: progressRaw(eligible.seed),
      report: eligible.seed,
      runId: "seed",
    }).recoveryClassification).toBe("terminal");

    expect(classifyV073SeedAttemptRecovery({
      expectedCacheCaseByKey: expectedCacheCaseByKey("locomo-conv-44"),
      extractionCacheRaw: extractionCacheRaw(271),
      progressRaw: progressRaw(eligible.seed),
      report: eligible.seed,
      runId: "seed",
    }).recoveryClassification).toBe("terminal");
  });

  it("runs the exact seed invocation once or one conditional same-invocation resume", async () => {
    const invocation: V073CommandInvocation = {
      args: ["run", "seed.ts", "--resume"],
      command: "bun",
      cwd: REPO_ROOT,
      environment: { GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra" },
    };

    const runScenario = async (
      reports: ReturnType<typeof fullClaimOutputs>["seed"][],
      cacheCounts: number[],
      mutateSecond?: (seedOutputPath: string) => Promise<void>,
    ) => {
      const root = await mkdtemp(join(tmpdir(), "goodmemory-full-claim-seed-run-"));
      const seedOutputPath = join(root, "seed");
      const calls: V073CommandInvocation[] = [];
      const events: string[] = [];
      try {
        const result = await runV073SeedWithOneTimeoutResume({
          afterAttemptOne: async () => {
            events.push("attempt-one-persisted");
          },
          afterFinalArtifacts: async ({ attempt }) => {
            events.push(`final-${attempt}`);
          },
          expectedCacheCaseByKey: expectedCacheCaseByKey(),
          invocation,
          runSeed: async (actual) => {
            const attemptIndex = calls.length;
            calls.push(actual);
            events.push(`seed-${attemptIndex + 1}`);
            await writeSeedAttempt(
              seedOutputPath,
              reports[attemptIndex]!,
              cacheCounts[attemptIndex]!,
              attemptIndex > 0,
            );
            if (attemptIndex === 1 && mutateSecond) {
              await mutateSecond(seedOutputPath);
            }
            return { exitCode: 0, stderr: "", stdout: "" };
          },
          seedOutputPath,
          seedRunId: "seed",
          snapshotPath: join(root, "seed-attempt-1"),
        });
        return { calls, events, result, root };
      } catch (error) {
        await rm(root, { force: true, recursive: true });
        throw Object.assign(error as Error, { calls, events });
      }
    };

    const green = await runScenario([fullClaimOutputs().seed], [272]);
    expect(green.calls).toEqual([invocation]);
    expect(green.events).toEqual([
      "seed-1",
      "attempt-one-persisted",
      "final-1",
    ]);
    expect(green.result.attempts).toHaveLength(1);
    await rm(green.root, { force: true, recursive: true });

    const recovered = await runScenario(
      [seedTimeoutReport(), fullClaimOutputs().seed],
      [271, 272],
    );
    expect(recovered.calls).toEqual([invocation, invocation]);
    expect(recovered.events).toEqual([
      "seed-1",
      "attempt-one-persisted",
      "seed-2",
      "final-2",
    ]);
    expect(recovered.calls[0]).toBe(recovered.calls[1]);
    expect(recovered.result.attempts.map((attempt) =>
      attempt.recoveryClassification)).toEqual([
      "eligible-single-case-seed-timeout",
      "failure-free-after-single-resume",
    ]);
    await rm(recovered.root, { force: true, recursive: true });

    const terminal = seedTimeoutReport();
    (terminal.cases.find((row) => row.caseId === "locomo-conv-43") as {
      executionFailureStage: string | null;
    }).executionFailureStage = "recall";
    await expect(runScenario([terminal], [271])).rejects.toMatchObject({
      calls: [invocation],
      events: ["seed-1", "attempt-one-persisted", "final-1"],
    });

    await expect(runScenario(
      [seedTimeoutReport(), seedTimeoutReport()],
      [271, 271],
    )).rejects.toMatchObject({
      calls: [invocation, invocation],
      events: ["seed-1", "attempt-one-persisted", "seed-2", "final-2"],
    });

    await expect(runScenario(
      [seedTimeoutReport(), fullClaimOutputs().seed],
      [271, 272],
      async (seedOutputPath) => {
        const cachePath = join(seedOutputPath, "extraction-cache.jsonl");
        const raw = await readFile(cachePath, "utf8");
        await writeFile(cachePath, raw.replace("key-0", "changed-key"));
      },
    )).rejects.toThrow("must append to the exact attempt-one cache and progress");

    await expect(runScenario(
      [seedTimeoutReport(), fullClaimOutputs().seed],
      [271, 272],
      async (seedOutputPath) => {
        const reportPath = join(seedOutputPath, "smoke-report.json");
        const report = JSON.parse(await readFile(reportPath, "utf8")) as
          ReturnType<typeof fullClaimOutputs>["seed"];
        report.cases[0]!.retrievedTurnIds = ["changed-turn"];
        await writeFile(reportPath, `${JSON.stringify(report)}\n`);
      },
    )).rejects.toThrow("changed an attempt-one successful retrieval");

    const malformedRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-full-claim-malformed-pass1-"),
    );
    const malformedSeedOutput = join(malformedRoot, "seed");
    let malformedPersisted = 0;
    try {
      await expect(runV073SeedWithOneTimeoutResume({
        afterAttemptOne: async () => {
          malformedPersisted += 1;
        },
        expectedCacheCaseByKey: expectedCacheCaseByKey(),
        invocation,
        runSeed: async () => {
          await writeSeedAttempt(
            malformedSeedOutput,
            fullClaimOutputs().seed,
            272,
          );
          await writeFile(
            join(malformedSeedOutput, "smoke-report.json"),
            "{malformed\n",
          );
          return { exitCode: 0, stderr: "", stdout: "" };
        },
        seedOutputPath: malformedSeedOutput,
        seedRunId: "seed",
        snapshotPath: join(malformedRoot, "seed-attempt-1"),
      })).rejects.toBeDefined();
      expect(malformedPersisted).toBe(1);
    } finally {
      await rm(malformedRoot, { force: true, recursive: true });
    }

    const nonzeroRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-full-claim-nonzero-seed-"),
    );
    const processResults: Array<{ attempt: 1 | 2; exitCode: number | null }> = [];
    const nonzeroArtifacts: Array<{
      attempt: 1 | 2;
      reportRaw: string | undefined;
    }> = [];
    try {
      await expect(runV073SeedWithOneTimeoutResume({
        afterNonzeroAttemptArtifacts: async ({ artifacts, attempt }) => {
          nonzeroArtifacts.push({ attempt, reportRaw: artifacts.reportRaw });
        },
        afterAttemptProcess: async ({ attempt, result }) => {
          processResults.push({ attempt, exitCode: result.exitCode });
        },
        expectedCacheCaseByKey: expectedCacheCaseByKey(),
        invocation,
        runSeed: async () => {
          const seedOutputPath = join(nonzeroRoot, "seed");
          await mkdir(seedOutputPath, { recursive: true });
          await writeFile(
            join(seedOutputPath, "smoke-report.json"),
            "{\"partial\":true}\n",
          );
          return { exitCode: 17, stderr: "", stdout: "" };
        },
        seedOutputPath: join(nonzeroRoot, "seed"),
        seedRunId: "seed",
        snapshotPath: join(nonzeroRoot, "seed-attempt-1"),
      })).rejects.toThrow("seed attempt 1 exited with 17");
      expect(processResults).toEqual([{ attempt: 1, exitCode: 17 }]);
      expect(nonzeroArtifacts).toEqual([{
        attempt: 1,
        reportRaw: "{\"partial\":true}\n",
      }]);
    } finally {
      await rm(nonzeroRoot, { force: true, recursive: true });
    }

    const nonzeroResumeRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-full-claim-nonzero-seed-resume-"),
    );
    const nonzeroResumeOutput = join(nonzeroResumeRoot, "seed");
    const resumeArtifacts: Array<{
      attempt: 1 | 2;
      reportRaw: string | undefined;
    }> = [];
    let resumeLaunches = 0;
    try {
      await expect(runV073SeedWithOneTimeoutResume({
        afterNonzeroAttemptArtifacts: async ({ artifacts, attempt }) => {
          resumeArtifacts.push({ attempt, reportRaw: artifacts.reportRaw });
        },
        expectedCacheCaseByKey: expectedCacheCaseByKey(),
        invocation,
        runSeed: async () => {
          resumeLaunches += 1;
          if (resumeLaunches === 1) {
            await writeSeedAttempt(
              nonzeroResumeOutput,
              seedTimeoutReport(),
              271,
            );
            return { exitCode: 0, stderr: "", stdout: "" };
          }
          await writeSeedAttempt(
            nonzeroResumeOutput,
            fullClaimOutputs().seed,
            272,
            true,
          );
          return { exitCode: 29, stderr: "", stdout: "" };
        },
        seedOutputPath: nonzeroResumeOutput,
        seedRunId: "seed",
        snapshotPath: join(nonzeroResumeRoot, "seed-attempt-1"),
      })).rejects.toThrow("seed attempt 2 exited with 29");
      expect(resumeArtifacts).toHaveLength(1);
      expect(resumeArtifacts[0]).toEqual({
        attempt: 2,
        reportRaw: `${JSON.stringify(fullClaimOutputs().seed)}\n`,
      });
    } finally {
      await rm(nonzeroResumeRoot, { force: true, recursive: true });
    }
  });

  it("captures a nonzero reanswer report before checking the child exit", () => {
    const source = readFileSync(
      join(REPO_ROOT, "scripts/run-v0-7-3-full-locomo-claim.ts"),
      "utf8",
    );
    const start = source.indexOf(
      "reanswerProcess = await runProviderInvocation(commandChain.reanswer)",
    );
    const end = source.indexOf("let officialRaw: string", start);
    const reanswerStage = source.slice(start, end);
    expect(reanswerStage.indexOf("preserveV073FinalReportIfPresent({"))
      .toBeGreaterThan(-1);
    expect(reanswerStage.indexOf("preserveV073FinalReportIfPresent({"))
      .toBeLessThan(reanswerStage.indexOf("reanswerProcess.exitCode !== 0"));
  });

  it("rejects incomplete official evidence before tracked publication", () => {
    expect(() => assertV073FullClaimOutputs(fullClaimOutputs())).not.toThrow();

    const scoredSeed = fullClaimOutputs();
    (scoredSeed.seed.cases[0] as { answerCorrect: boolean | null })
      .answerCorrect = true;
    expect(() => assertV073FullClaimOutputs(scoredSeed)).toThrow(
      "seed row 0 must remain retrieval-only",
    );

    const duplicate = fullClaimOutputs();
    duplicate.final.cases[1]!.questionId = duplicate.final.cases[0]!.questionId;
    expect(() => assertV073FullClaimOutputs(duplicate)).toThrow(
      "has invalid identity or execution state",
    );

    const inventedQuestion = fullClaimOutputs();
    inventedQuestion.seed.cases[0]!.questionId = "conv-26:q999";
    expect(() => assertV073FullClaimOutputs(inventedQuestion)).toThrow(
      "question selection does not match the frozen full-10 set",
    );

    const wrongCategory = fullClaimOutputs();
    wrongCategory.final.cases[0]!.category = "open_domain";
    expect(() => assertV073FullClaimOutputs(wrongCategory)).toThrow(
      "category",
    );

    const failed = fullClaimOutputs();
    (failed.final.cases[0] as { executionFailureMessage: string | null })
      .executionFailureMessage = "provider failed";
    expect(() => assertV073FullClaimOutputs(failed)).toThrow(
      "has invalid identity or execution state",
    );

    const wrongSource = fullClaimOutputs();
    wrongSource.official.sourceInputFingerprints.reportPath.sha256 = "0".repeat(64);
    expect(() => assertV073FullClaimOutputs(wrongSource)).toThrow(
      "not bound to the complete final report and root bytes",
    );

    const incompleteProgress = fullClaimOutputs();
    incompleteProgress.officialProgressRaw = incompleteProgress.officialProgressRaw
      .split("\n")
      .slice(0, -2)
      .join("\n");
    expect(() => assertV073FullClaimOutputs(incompleteProgress)).toThrow(
      "does not cover the 1540 final questions",
    );
  });
});
