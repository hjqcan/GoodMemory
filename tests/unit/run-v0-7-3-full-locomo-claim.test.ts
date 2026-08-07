import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  assertV073CandidateProvenanceUnchanged,
  assertV073EvidenceRepositoryLineage,
  assertV073EvidencePublicationStatus,
  assertV073FullClaimOutputs,
  publishV073FullClaimPublication,
  renderV073FullClaimCommand,
  resolveDistinctV073FullClaimRepositories,
  stageV073FullClaimPublication,
} from "../../scripts/run-v0-7-3-full-locomo-claim";
import { buildV073FullClaimCommandChain } from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
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
    executionFailureMessage: null,
    generatedAnswer: `answer-${index}`,
    retrievedTurnIds: [`turn-${index}`],
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
    generatedAt: "2026-08-06T10:00:00.000Z",
    generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
    resume: true,
    runId: "seed",
  };
  const final = {
    ...common,
    answerAccuracyOverall: 1,
    answerSystem: "locomo-live-category-aware-v1",
    generatedAt: "2026-08-06T11:00:00.000Z",
    generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
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

describe("v0.7.3 full LoCoMo claim launcher", () => {
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

    expect(chain.seedSmoke.args).not.toContain("--case-id");
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

  it("rejects incomplete official evidence before tracked publication", () => {
    expect(() => assertV073FullClaimOutputs(fullClaimOutputs())).not.toThrow();

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
import { createHash } from "node:crypto";
