import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildEvalRunIdentity,
  hashEvalRunIdentity,
} from "../../src/eval/runIdentity";
import { PHASE74_RELEASE_COMMIT } from "../../src/eval/phase74VersionBaseline";
import {
  buildPhase74VersionPreparedReceiptSet,
} from "../../scripts/phase74-version-process";
import {
  PHASE74_PRODUCT_CASE_SCHEDULING,
  buildPhase74ProductAttemptTerminal,
  buildPhase74ProductQueryPathLatencyMs,
  buildPhase74ProductRunIdentityConfiguration,
  commitPhase74ProductSuccessArtifacts,
  createPhase74ProductNetworkFetch,
  parsePhase74ProductComparisonCliOptions,
  runPhase74LiveProductComparison,
  runPhase74ProductComparison,
  verifyPhase74ProductAttemptTerminal,
  writePhase74ProductAttemptTerminal,
  type Phase74ProductPreparedGroup,
} from "../../scripts/run-phase-74-product-comparison";

const CASES = [
  {
    caseId: "case-a",
    clusterId: "cluster-a",
    memoryGroupId: "group-a",
    question: "Question A?",
  },
  {
    caseId: "case-b",
    clusterId: "cluster-b",
    memoryGroupId: "group-b",
    question: "Question B?",
  },
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function productTestIdentity() {
  return buildEvalRunIdentity({
    answerModel: {
      gateway: "https://answer.invalid/v1",
      model: "answer-model",
      provider: "openai",
    },
    benchmark: "locomo-product-comparison",
    configuration: { comparisonKind: "diagnostic" },
    datasetSha256: "d".repeat(64),
    generatedAt: "2026-07-23T00:00:00.000Z",
    generatedBy: "run-phase-74-product-comparison.test.ts",
    judgeModel: {
      gateway: "https://judge.invalid/v1",
      model: "judge-model",
      provider: "openai",
    },
    promptSha256s: { answer: "e".repeat(64) },
    runId: "phase74-product-test",
  });
}

function productTestReceiptSet(input: {
  executionIdentityHash: string;
  root: string;
}) {
  const content = {
    executionIdentityHash: input.executionIdentityHash,
    ingestionKey: "1".repeat(64),
    ingestionLatencyMs: 1,
    memoryGroupId: "group-a",
    rawEvidenceSha256: "2".repeat(64),
    sourceCommit: PHASE74_RELEASE_COMMIT,
    sourceSqlitePath: join(input.root, "source.sqlite"),
    sqlitePath: join(input.root, "sealed.sqlite"),
    sqliteSha256: "3".repeat(64),
  };
  return buildPhase74VersionPreparedReceiptSet([{
    ...content,
    receiptSha256: sha256(JSON.stringify(content)),
  }]);
}

describe("Phase 74 cumulative product runner", () => {
  it("parses a source-bound release-to-final live run with explicit budgets", () => {
    expect(parsePhase74ProductComparisonCliOptions([
      "bun",
      "run-phase-74-product-comparison.ts",
      "--benchmark",
      "locomo",
      "--benchmark-root",
      "/tmp/locomo",
      "--output-dir",
      "/tmp/output",
      "--run-id",
      "phase74-product-locomo-r1",
      "--replicate",
      "1",
      "--case-selection-seed",
      "74076",
      "--case-selection-size",
      "8",
      "--release-source-root",
      "/tmp/release",
      "--release-archive",
      "/tmp/release.tar",
      "--protection-blueprint",
      "/tmp/protection.json",
      "--selected-evidence-ledger-format",
      "compact_json",
      "--max-language-calls",
      "5000",
      "--embedding-spend-limit-usd",
      "1",
      "--preparation-concurrency",
      "2",
    ])).toEqual({
      benchmark: "locomo",
      benchmarkRoot: "/tmp/locomo",
      caseSelectionSeed: 74076,
      caseSelectionSize: 8,
      embeddingSpendLimitUsd: 1,
      maxLanguageCalls: 5000,
      outputDir: "/tmp/output",
      preparationConcurrency: 2,
      protectionBlueprintPath: "/tmp/protection.json",
      releaseArchive: "/tmp/release.tar",
      releaseSourceRoot: "/tmp/release",
      replicate: 1,
      runId: "phase74-product-locomo-r1",
      selectedEvidenceLedgerFormat: "compact_json",
    });
  });

  it("does not leave an attempt directory when preflight cannot build an identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-product-preflight-"));
    const runId = "phase74-product-preflight-failure";
    try {
      await expect(runPhase74LiveProductComparison({
        benchmark: "locomo",
        benchmarkRoot: join(root, "missing-benchmark"),
        caseSelectionSeed: 74076,
        caseSelectionSize: 2,
        embeddingSpendLimitUsd: 1,
        maxLanguageCalls: 10,
        outputDir: root,
        preparationConcurrency: 1,
        protectionBlueprintPath: join(root, "missing-protection.json"),
        releaseArchive: join(root, "missing-release.tar"),
        releaseSourceRoot: join(root, "missing-release"),
        replicate: 1,
        runId,
        selectedEvidenceLedgerFormat: "compact_json",
      }, {})).rejects.toThrow();

      await expect(access(join(root, runId))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("marks the same-process deterministic product comparison as diagnostic", () => {
    expect(buildPhase74ProductRunIdentityConfiguration({
      candidateConfiguration: {
        caseScheduling: PHASE74_PRODUCT_CASE_SCHEDULING,
        embedding: {
          adapterVersion: "openai-compatible-embedding-v2",
          model: "baai/bge-m3",
          providerOrder: "parasail",
        },
        evidenceLedger: { format: "compact_json" },
        planner: { mode: "deterministic" },
        representation: "atomic-contextual-raw-pointer",
        retrieval: {
          generalizedFusionChannels: [
            "lexical",
            "dense",
            "entity",
            "temporal",
            "relation",
          ],
          recallPlanExecution: true,
        },
      },
      candidateSource: {
        commit: "a".repeat(40),
        sha256: "b".repeat(64),
      },
      releaseSource: {
        archiveSha256: "c".repeat(64),
        arm: "release",
        commit: "d".repeat(40),
        lockfileSha256: "e".repeat(64),
        ref: "v0.6.0",
        tree: "f".repeat(40),
        workerSha256: "1".repeat(64),
      },
      releaseDependencyTreeSha256: "2".repeat(64),
      replicate: 1,
      selectedEvidenceLedgerFormat: "compact_json",
      seenCasesOnly: true,
    })).toMatchObject({
      arms: {
        baseline: "release-v0.6.0",
        candidate: "phase74-deterministic-candidate",
      },
      candidateConfiguration: {
        evidenceLedger: { format: "compact_json" },
        planner: { mode: "deterministic" },
        representation: "atomic-contextual-raw-pointer",
      },
      evidenceBoundary: {
        executionIsolation: "same-process-with-gold-scorer-v1",
        goldAware: true,
        nonPromotionReasons: [
          "gold-material-in-executor-process",
          "seen-cases-only",
          "independent-call-budget-pools",
          "deterministic-reranker",
          "unprotected-ledger-format-selection",
        ],
        promotionEligible: false,
        protocolReader: false,
        seenCasesOnly: true,
      },
      embeddingRoutingByArm: {
        baseline: {
          adapterVersion: "openai-compatible-embedding-v2",
          model: "baai/bge-m3",
          providerOrder: "parasail",
        },
        candidate: {
          adapterVersion: "openai-compatible-embedding-v2",
          model: "baai/bge-m3",
          providerOrder: "parasail",
        },
      },
      releaseDependencyTreeSha256: "2".repeat(64),
      replicate: 1,
      selectedEvidenceLedgerFormat: "compact_json",
    });
  });

  it("finishes every arm memory-group ingestion before the first query", async () => {
    const events: string[] = [];
    let preparedCount = 0;
    const result = await runPhase74ProductComparison({
      cases: CASES,
      async prepare({ arm, memoryGroupId }) {
        events.push(`prepare:${arm}:${memoryGroupId}`);
        preparedCount += 1;
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query(testCase) {
            expect(preparedCount).toBe(4);
            events.push(`query:${arm}:${testCase.caseId}`);
            return {
              context: `${arm} context for ${testCase.caseId}`,
              contextTokens: 12,
              queryPathLatencyMs: 20,
              recallLatencyMs: 7,
            };
          },
        } satisfies Phase74ProductPreparedGroup;
      },
      async read({ arm, caseId }) {
        events.push(`read:${arm}:${caseId}`);
        return { answer: `${arm} answer`, latencyMs: 5 };
      },
      async score({ arm, caseId }) {
        events.push(`score:${arm}:${caseId}`);
        return { correct: true, latencyMs: 11, score: 1 };
      },
      preparationConcurrency: 2,
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(events.findIndex((event) => event.startsWith("query:"))).toBe(4);
    expect(result.rows).toHaveLength(4);
  });

  it("records one reader and scorer result per arm and case with judge latency separate", async () => {
    let readerCalls = 0;
    let scorerCalls = 0;
    const result = await runPhase74ProductComparison({
      cases: CASES,
      async prepare({ arm, memoryGroupId }) {
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query() {
            return {
              context: "evidence",
              contextTokens: 24,
              queryPathLatencyMs: 30,
              recallLatencyMs: 9,
            };
          },
        };
      },
      async read({ arm }) {
        readerCalls += 1;
        return { answer: `${arm} answer`, latencyMs: 6 };
      },
      async score() {
        scorerCalls += 1;
        return { correct: false, latencyMs: 13, score: 0.25 };
      },
      preparationConcurrency: 2,
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(readerCalls).toBe(4);
    expect(scorerCalls).toBe(4);
    expect(result.rows.every((row) =>
      row.productLatencyMs === 36 &&
      row.judgeLatencyMs === 13 &&
      row.recallLatencyMs === 9
    )).toBeTrue();
    expect(result.rows.map(({ arm, caseId }) => `${arm}/${caseId}`).sort())
      .toEqual([
        "phase74-deterministic-candidate/case-a",
        "phase74-deterministic-candidate/case-b",
        "release-v0.6.0/case-a",
        "release-v0.6.0/case-b",
      ]);
    expect(result.selectedEvidenceLedgerFormat).toBe("compact_json");
  });

  it("bounds group preparation and waits for active work to settle on failure", async () => {
    let active = 0;
    let maxActive = 0;
    let releaseSecondGroupSettled = false;
    let releaseSecondGroupStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      releaseSecondGroupStarted = resolve;
    });

    await expect(runPhase74ProductComparison({
      cases: CASES,
      async prepare({ arm, memoryGroupId }) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          if (arm === "release-v0.6.0" && memoryGroupId === "group-a") {
            await secondStarted;
            throw new Error("prepare failed");
          }
          if (arm === "release-v0.6.0" && memoryGroupId === "group-b") {
            releaseSecondGroupStarted();
            await new Promise((resolve) => setTimeout(resolve, 20));
            releaseSecondGroupSettled = true;
          }
          return {
            arm,
            ingestionKey: `${arm}/${memoryGroupId}`,
            memoryGroupId,
            async query() {
              throw new Error("query must not run after preparation failure");
            },
          };
        } finally {
          active -= 1;
        }
      },
      async read() {
        throw new Error("reader must not run after preparation failure");
      },
      async score() {
        throw new Error("scorer must not run after preparation failure");
      },
      preparationConcurrency: 2,
      selectedEvidenceLedgerFormat: "compact_json",
    })).rejects.toThrow("prepare failed");

    expect(maxActive).toBe(2);
    expect(releaseSecondGroupSettled).toBeTrue();
    expect(active).toBe(0);
  });

  it("runs paired product arms concurrently without a fixed release-first bias", async () => {
    let activeQueries = 0;
    let maxActiveQueries = 0;
    const result = await runPhase74ProductComparison({
      cases: CASES.slice(0, 1),
      async prepare({ arm, memoryGroupId }) {
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query() {
            activeQueries += 1;
            maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
            await new Promise((resolve) => setTimeout(resolve, 20));
            activeQueries -= 1;
            return {
              context: "evidence",
              contextTokens: 1,
              queryPathLatencyMs: 1,
              recallLatencyMs: 1,
            };
          },
        };
      },
      async read({ arm }) {
        return { answer: arm, latencyMs: 1 };
      },
      async score() {
        return { correct: true, latencyMs: 1, score: 1 };
      },
      preparationConcurrency: 2,
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(maxActiveQueries).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it("waits for the paired arm to settle before propagating a query failure", async () => {
    let candidateSettled = false;
    await expect(runPhase74ProductComparison({
      cases: CASES.slice(0, 1),
      async prepare({ arm, memoryGroupId }) {
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query() {
            if (arm === "release-v0.6.0") {
              throw new Error("release query failed");
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
            candidateSettled = true;
            return {
              context: "evidence",
              contextTokens: 1,
              queryPathLatencyMs: 1,
              recallLatencyMs: 1,
            };
          },
        };
      },
      async read({ arm }) {
        return { answer: arm, latencyMs: 1 };
      },
      async score() {
        return { correct: true, latencyMs: 1, score: 1 };
      },
      preparationConcurrency: 2,
      selectedEvidenceLedgerFormat: "compact_json",
    })).rejects.toThrow("release query failed");

    expect(candidateSettled).toBeTrue();
  });

  it("builds product query latency from recall and context assembly only", () => {
    expect(buildPhase74ProductQueryPathLatencyMs({
      contextAssemblyLatencyMs: 7,
      recallLatencyMs: 23,
    })).toBe(30);
  });

  it("pins the same BGE provider route at the shared product network boundary", async () => {
    const requests: string[] = [];
    const fetch = createPhase74ProductNetworkFetch({
      fetch: async (_request, init) => {
        requests.push(String(init?.body));
        return Response.json({ data: [], usage: { prompt_tokens: 0 } });
      },
      model: {
        apiKey: "embedding-key",
        baseURL: "https://openrouter.ai/api/v1",
        model: "baai/bge-m3",
        provider: "openai",
      },
    });

    await fetch("https://openrouter.ai/api/v1/embeddings", {
      body: JSON.stringify({ input: ["evidence"], model: "baai/bge-m3" }),
      method: "POST",
    });

    expect(JSON.parse(requests[0]!)).toMatchObject({
      provider: {
        allow_fallbacks: false,
        order: ["parasail"],
      },
    });
  });

  it("writes a redacted create-only terminal artifact for failed attempts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-product-terminal-"));
    const terminalPath = join(directory, "attempt-terminal.json");
    const candidateBudgetPath = join(directory, "candidate-budget.json");
    const candidateEventsPath = join(directory, "candidate-events.jsonl");
    const candidateIntentsPath = join(directory, "candidate-intents.jsonl");
    try {
      await writeFile(candidateBudgetPath, "{\"languageCalls\":1}\n");
      await writeFile(candidateEventsPath, "{}\n");
      await writeFile(candidateIntentsPath, "");
      const terminal = await buildPhase74ProductAttemptTerminal({
        completedReceiptSetSha256: "a".repeat(64),
        error: new Error("PHASE74-SECRET-ERROR-SENTINEL"),
        identityHash: "b".repeat(64),
        paths: {
          candidateBudgetPath,
          candidateEventsPath,
          candidateIntentsPath,
          datasetManifestPath: join(directory, "dataset-manifest.json"),
          releaseBudgetPath: join(directory, "release-budget.json"),
          releaseEventsPath: join(directory, "release-events.jsonl"),
          releaseIntentsPath: join(directory, "release-intents.jsonl"),
          reportPath: join(directory, "report.json"),
        },
        process: {
          failed: {
            exitCode: 7,
            pid: 43,
            stderrSha256: "c".repeat(64),
          },
          successfulPids: [42],
        },
        status: "failed",
      });
      const written = await writePhase74ProductAttemptTerminal({
        path: terminalPath,
        terminal,
      });
      const raw = await readFile(terminalPath, "utf8");

      expect(raw).not.toContain("PHASE74-SECRET-ERROR-SENTINEL");
      expect(written.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(terminal).toMatchObject({
        completedReceiptSetSha256: "a".repeat(64),
        evidence: {
          candidateBudget: {
            exists: true,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
          candidateUsage: { reconciled: false },
          datasetManifest: { exists: false },
          releaseBudget: { exists: false },
          releaseUsage: { reconciled: false },
          report: { exists: false },
        },
        errorFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        identityHash: "b".repeat(64),
        process: {
          failed: { exitCode: 7, pid: 43 },
          successfulPids: [42],
        },
        schemaVersion: 1,
        status: "failed",
      });
      await expect(writePhase74ProductAttemptTerminal({
        path: terminalPath,
        terminal,
      })).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("refuses a success terminal without complete receipts and reconciled evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-product-success-"));
    try {
      await expect(buildPhase74ProductAttemptTerminal({
        identityHash: "b".repeat(64),
        paths: {
          candidateBudgetPath: join(directory, "candidate-budget.json"),
          candidateEventsPath: join(directory, "candidate-events.jsonl"),
          candidateIntentsPath: join(directory, "candidate-intents.jsonl"),
          datasetManifestPath: join(directory, "dataset-manifest.json"),
          releaseBudgetPath: join(directory, "release-budget.json"),
          releaseEventsPath: join(directory, "release-events.jsonl"),
          releaseIntentsPath: join(directory, "release-intents.jsonl"),
          reportPath: join(directory, "report.json"),
        },
        process: {
          failed: null,
          successfulPids: [42],
        },
        status: "succeeded",
      })).rejects.toThrow("success terminal");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("commits manifest and report before the final success terminal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-product-commit-"));
    const paths = {
      candidateBudgetPath: join(directory, "candidate-budget.json"),
      candidateEventsPath: join(directory, "candidate-events.jsonl"),
      candidateIntentsPath: join(directory, "candidate-intents.jsonl"),
      datasetManifestPath: join(directory, "dataset-manifest.json"),
      releaseBudgetPath: join(directory, "release-budget.json"),
      releaseEventsPath: join(directory, "release-events.jsonl"),
      releaseIntentsPath: join(directory, "release-intents.jsonl"),
      reportPath: join(directory, "report.json"),
    };
    const terminalPath = join(directory, "attempt-terminal.json");
    try {
      const identity = productTestIdentity();
      const identityHash = hashEvalRunIdentity(identity);
      const receiptSet = productTestReceiptSet({
        executionIdentityHash: identityHash,
        root: directory,
      });
      await mkdir(join(directory, "release"));
      await Promise.all([
        writeFile(paths.candidateBudgetPath, "{}\n"),
        writeFile(paths.candidateEventsPath, ""),
        writeFile(paths.candidateIntentsPath, ""),
        writeFile(paths.releaseBudgetPath, "{}\n"),
        writeFile(paths.releaseEventsPath, ""),
        writeFile(paths.releaseIntentsPath, ""),
        writeFile(
          join(directory, "run-identity.json"),
          `${JSON.stringify(identity, null, 2)}\n`,
        ),
        writeFile(
          join(directory, "release", "prepared-receipts.json"),
          `${JSON.stringify(receiptSet, null, 2)}\n`,
        ),
      ]);
      const committed = await commitPhase74ProductSuccessArtifacts({
        datasetManifest: { datasetSha256: "d".repeat(64) },
        report: {
          identityHash,
          releasePreparedReceiptSet: {
            receiptSetSha256: receiptSet.receiptSetSha256,
          },
          status: "not_evaluable",
        },
        terminalInput: {
          completedReceiptSetSha256: receiptSet.receiptSetSha256,
          identityHash,
          paths,
          process: {
            failed: null,
            successfulPids: [42],
          },
          status: "succeeded",
        },
        terminalPath,
      });

      expect(committed.terminal).toMatchObject({
        evidence: {
          datasetManifest: {
            exists: true,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
          report: {
            exists: true,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        },
        status: "succeeded",
      });
      await expect(verifyPhase74ProductAttemptTerminal({
        path: terminalPath,
        paths,
      })).resolves.toEqual(committed.terminal);

      const originalTerminal = JSON.parse(
        await readFile(terminalPath, "utf8"),
      );
      await writeFile(terminalPath, JSON.stringify({
        ...originalTerminal,
        identityHash: "f".repeat(64),
      }));
      await expect(verifyPhase74ProductAttemptTerminal({
        path: terminalPath,
        paths,
      })).rejects.toThrow("terminal drifted");

      await writeFile(terminalPath, JSON.stringify({
        ...originalTerminal,
        completedReceiptSetSha256: "f".repeat(64),
      }));
      await expect(verifyPhase74ProductAttemptTerminal({
        path: terminalPath,
        paths,
      })).rejects.toThrow("terminal drifted");

      await writeFile(terminalPath, JSON.stringify({
        ...originalTerminal,
        errorFingerprint: null,
        status: "failed",
      }));
      await expect(verifyPhase74ProductAttemptTerminal({
        path: terminalPath,
        paths,
      })).rejects.toThrow("terminal");

      await writeFile(terminalPath, JSON.stringify(originalTerminal));
      await writeFile(paths.reportPath, "{\"status\":\"tampered\"}\n");
      await expect(verifyPhase74ProductAttemptTerminal({
        path: terminalPath,
        paths,
      })).rejects.toThrow("artifact drifted");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("commits only a failed terminal when manifest or report creation fails", async () => {
    for (const blocked of ["datasetManifestPath", "reportPath"] as const) {
      const directory = await mkdtemp(join(tmpdir(), "phase74-product-fault-"));
      const paths = {
        candidateBudgetPath: join(directory, "candidate-budget.json"),
        candidateEventsPath: join(directory, "candidate-events.jsonl"),
        candidateIntentsPath: join(directory, "candidate-intents.jsonl"),
        datasetManifestPath: join(directory, "dataset-manifest.json"),
        releaseBudgetPath: join(directory, "release-budget.json"),
        releaseEventsPath: join(directory, "release-events.jsonl"),
        releaseIntentsPath: join(directory, "release-intents.jsonl"),
        reportPath: join(directory, "report.json"),
      };
      const terminalPath = join(directory, "attempt-terminal.json");
      try {
        await Promise.all([
          writeFile(paths.candidateBudgetPath, "{}\n"),
          writeFile(paths.candidateEventsPath, ""),
          writeFile(paths.candidateIntentsPath, ""),
          writeFile(paths.releaseBudgetPath, "{}\n"),
          writeFile(paths.releaseEventsPath, ""),
          writeFile(paths.releaseIntentsPath, ""),
          writeFile(paths[blocked], "pre-existing"),
        ]);
        await expect(commitPhase74ProductSuccessArtifacts({
          datasetManifest: { datasetSha256: "d".repeat(64) },
          report: { status: "not_evaluable" },
          terminalInput: {
            completedReceiptSetSha256: "a".repeat(64),
            identityHash: "b".repeat(64),
            paths,
            process: {
              failed: null,
              successfulPids: [42],
            },
            status: "succeeded",
          },
          terminalPath,
        })).rejects.toThrow();

        expect(JSON.parse(await readFile(terminalPath, "utf8")))
          .toMatchObject({ status: "failed" });
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  });
});
