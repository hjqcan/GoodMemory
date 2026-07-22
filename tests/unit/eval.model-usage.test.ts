import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  buildPhase74ModelUsageEvidence,
  createAttributedModelUsageSink,
  loadPhase74ModelUsageLedger,
  reconcilePhase74PendingModelUsageSync,
  validatePhase74ModelUsageLedger,
  type AttributedModelUsageAttempt,
  type AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
import type { ModelUsageAttempt } from "../../src/provider/model-usage";

function attempt(input: {
  attempt?: number;
  completeness?: ModelUsageAttempt["completeness"];
  inputTokens?: number | null;
  operation?: ModelUsageAttempt["operation"];
  outputTokens?: number | null;
} = {}): ModelUsageAttempt {
  return {
    attempt: input.attempt ?? 1,
    completeness: input.completeness ?? "complete",
    modelId: "model-v1",
    operation: input.operation ?? "answer_generation",
    outcome: "succeeded",
    providerId: "openai",
    schemaVersion: 1,
    usage: {
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inputTokens: input.inputTokens === undefined ? 10 : input.inputTokens,
      outputTokens: input.outputTokens === undefined ? 2 : input.outputTokens,
      uncachedInputTokens: input.inputTokens === undefined ? 10 : input.inputTokens,
    },
  };
}

describe("Phase 74 eval model usage", () => {
  it("fsyncs an attributed intent before exposing its request receipt", () => {
    const calls: string[] = [];
    appendPhase74ModelUsageIntentSync("usage-intents.jsonl", {
      attempt: 1,
      branch: "candidate",
      caseId: "case-1",
      modelId: "model-v1",
      operation: "answer_generation",
      providerId: "openai",
      requestId: "request-1",
      schemaVersion: 1,
    }, {
      close(fd) {
        calls.push(`close:${fd}`);
      },
      fsync(fd) {
        calls.push(`fsync:${fd}`);
      },
      open(path, flags) {
        calls.push(`open:${path}:${flags}`);
        return flags === "r" ? 75 : 74;
      },
      write(fd, value) {
        calls.push(`write:${fd}:${value.endsWith("\n")}`);
      },
    });

    expect(calls).toEqual([
      "open:usage-intents.jsonl:a",
      "write:74:true",
      "fsync:74",
      "close:74",
      "open:.:r",
      "fsync:75",
      "close:75",
    ]);
  });

  it("binds one durable intent to exactly one terminal", () => {
    const intents: AttributedModelUsageIntent[] = [];
    const events: AttributedModelUsageAttempt[] = [];
    const trace: string[] = [];
    const sink = createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "case-1",
      createRequestId: () => "request-1",
      events,
      intents,
      onEvent: ({ requestId }) => trace.push(`terminal:${requestId}`),
      onIntent: ({ requestId }) => trace.push(`intent:${requestId}`),
    });

    const commit = sink.begin!({
      attempt: 1,
      modelId: "model-v1",
      operation: "answer_generation",
      providerId: "openai",
      schemaVersion: 1,
    });
    expect(trace).toEqual(["intent:request-1"]);
    expect(intents).toHaveLength(1);
    expect(events).toHaveLength(0);

    commit(attempt());
    expect(trace).toEqual(["intent:request-1", "terminal:request-1"]);
    expect(events[0]?.requestId).toBe("request-1");
  });

  it("resolves a contextual case id once when an attempt begins", () => {
    const intents: AttributedModelUsageIntent[] = [];
    const events: AttributedModelUsageAttempt[] = [];
    let caseId = "case-a";
    const sink = createAttributedModelUsageSink({
      branch: "candidate",
      caseId: () => caseId,
      createRequestId: () => `request-${intents.length + 1}`,
      events,
      intents,
    });

    const commit = sink.begin!({
      attempt: 1,
      modelId: "model-v1",
      operation: "embedding",
      providerId: "openai",
      schemaVersion: 1,
    });
    caseId = "case-b";
    commit(attempt({ operation: "embedding" }));
    sink.emit(attempt({ operation: "embedding" }));

    expect(intents.map((intent) => intent.caseId)).toEqual([
      "case-a",
      "case-b",
    ]);
    expect(events.map((event) => event.caseId)).toEqual([
      "case-a",
      "case-b",
    ]);
  });

  it("loads pending intents but rejects duplicate or orphan terminals", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-phase74-usage-v2-"));
    const intentsPath = join(root, "intents.jsonl");
    const eventsPath = join(root, "events.jsonl");
    const firstIntent = {
      attempt: 1,
      branch: "candidate",
      caseId: "case-1",
      modelId: "model-v1",
      operation: "answer_generation",
      providerId: "openai",
      requestId: "request-1",
      schemaVersion: 1,
    } as const;
    const pendingIntent = {
      ...firstIntent,
      attempt: 2,
      requestId: "request-pending",
    } as const;
    const terminal = {
      ...attempt(),
      branch: "candidate",
      caseId: "case-1",
      requestId: "request-1",
    } as const;
    try {
      await writeFile(
        intentsPath,
        `${JSON.stringify(firstIntent)}\n${JSON.stringify(pendingIntent)}\n`,
        "utf8",
      );
      await writeFile(eventsPath, `${JSON.stringify(terminal)}\n`, "utf8");

      const ledger = await loadPhase74ModelUsageLedger({
        eventsPath,
        intentsPath,
      });
      expect(ledger.pendingIntents.map(({ requestId }) => requestId)).toEqual([
        "request-pending",
      ]);

      await writeFile(
        eventsPath,
        `${JSON.stringify(terminal)}\n${JSON.stringify(terminal)}\n`,
        "utf8",
      );
      await expect(loadPhase74ModelUsageLedger({ eventsPath, intentsPath }))
        .rejects.toThrow("duplicate terminal requestId request-1");

      await writeFile(eventsPath, `${JSON.stringify({
        ...terminal,
        requestId: "request-orphan",
      })}\n`, "utf8");
      await expect(loadPhase74ModelUsageLedger({ eventsPath, intentsPath }))
        .rejects.toThrow("terminal without intent request-orphan");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("closes interrupted intents durably and idempotently before retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-phase74-usage-recovery-"));
    const intentsPath = join(root, "intents.jsonl");
    const eventsPath = join(root, "events.jsonl");
    const intent = {
      attempt: 2,
      branch: "candidate",
      caseId: "case-1",
      modelId: "model-v1",
      operation: "answer_generation",
      providerId: "openai",
      requestId: "request-interrupted",
      schemaVersion: 1,
    } as const;
    try {
      await writeFile(intentsPath, `${JSON.stringify(intent)}\n`, "utf8");
      const pending = await loadPhase74ModelUsageLedger({
        eventsPath,
        intentsPath,
      });

      const recovered = reconcilePhase74PendingModelUsageSync({
        eventsPath,
        ledger: pending,
      });
      expect(recovered.pendingIntents).toEqual([]);
      expect(recovered.events).toEqual([{
        ...intent,
        completeness: "missing",
        outcome: "failed",
        recovery: "interrupted_before_terminal",
        usage: {
          cacheCreationInputTokens: null,
          cacheReadInputTokens: null,
          inputTokens: null,
          outputTokens: null,
          uncachedInputTokens: null,
        },
      }]);

      const second = reconcilePhase74PendingModelUsageSync({
        eventsPath,
        ledger: await loadPhase74ModelUsageLedger({ eventsPath, intentsPath }),
      });
      expect(second.events).toHaveLength(1);
      expect(second.pendingIntents).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects terminal completeness that disagrees with recorded tokens", () => {
    const intents: AttributedModelUsageIntent[] = [];
    const events: AttributedModelUsageAttempt[] = [];
    createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "case-1",
      events,
      intents,
    }).emit(attempt({
      completeness: "complete",
      inputTokens: null,
      outputTokens: null,
    }));

    expect(() => validatePhase74ModelUsageLedger({ events, intents }))
      .toThrow("terminal completeness drift");

    const completeUsageEvents: AttributedModelUsageAttempt[] = [];
    const completeUsageIntents: AttributedModelUsageIntent[] = [];
    createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "case-2",
      events: completeUsageEvents,
      intents: completeUsageIntents,
    }).emit(attempt({ completeness: "missing" }));
    expect(() => validatePhase74ModelUsageLedger({
      events: completeUsageEvents,
      intents: completeUsageIntents,
    })).toThrow("terminal completeness drift");
  });

  it("counts one physical shared ingestion ledger in both standalone product arms", () => {
    const directIntents: AttributedModelUsageIntent[] = [];
    const directEvents: AttributedModelUsageAttempt[] = [];
    const emitDirect = (
      branch: "baseline" | "candidate",
      caseId: string,
      event: ModelUsageAttempt,
    ) => createAttributedModelUsageSink({
      branch,
      caseId,
      events: directEvents,
      intents: directIntents,
    }).emit(event);
    emitDirect("baseline", "case-a", attempt());
    emitDirect("candidate", "case-a", attempt());

    const ingestionIntents: AttributedModelUsageIntent[] = [];
    const ingestionEvents: AttributedModelUsageAttempt[] = [];
    createAttributedModelUsageSink({
      branch: "shadow",
      caseId: "group-a",
      events: ingestionEvents,
      intents: ingestionIntents,
    }).emit(attempt({
      inputTokens: 90,
      operation: "assisted_extraction",
      outputTokens: 0,
    }));

    const evidence = buildPhase74ModelUsageEvidence({
      direct: validatePhase74ModelUsageLedger({
        events: directEvents,
        intents: directIntents,
      }),
      expected: {
        baselineCaseIds: ["case-a"],
        candidateCaseIds: ["case-a"],
      },
      ingestion: {
        baselineExclusive: [],
        candidateExclusive: [],
        shared: [{
          key: "ingestion-key-a",
          ledger: validatePhase74ModelUsageLedger({
            events: ingestionEvents,
            intents: ingestionIntents,
          }),
        }],
      },
    });

    expect(evidence).toMatchObject({
      accountingVersion: "phase74-model-usage-v2",
      allocationPolicy: "standalone-full-shared-v1",
      baseline: {
        pendingRequestCount: 0,
        requestCount: 2,
        totalTokens: 102,
      },
      candidate: {
        pendingRequestCount: 0,
        requestCount: 2,
        totalTokens: 102,
      },
      costBoundary: "full-product",
      ingestion: {
        baselineExclusive: { keyCount: 0, totalTokens: 0 },
        candidateExclusive: { keyCount: 0, totalTokens: 0 },
        shared: {
          keyCount: 1,
          requestCount: 1,
          totalTokens: 90,
        },
      },
    });
  });

  it("requires physical extraction coverage for each ingestion key", () => {
    const directIntents: AttributedModelUsageIntent[] = [];
    const directEvents: AttributedModelUsageAttempt[] = [];
    for (const branch of ["baseline", "candidate"] as const) {
      createAttributedModelUsageSink({
        branch,
        caseId: "case-a",
        events: directEvents,
        intents: directIntents,
      }).emit(attempt());
    }
    const extractionIntents: AttributedModelUsageIntent[] = [];
    const extractionEvents: AttributedModelUsageAttempt[] = [];
    const extractionSink = createAttributedModelUsageSink({
      branch: "shadow",
      caseId: "group-b",
      events: extractionEvents,
      intents: extractionIntents,
    });
    extractionSink.emit(attempt({ operation: "assisted_extraction" }));
    extractionSink.emit(attempt({ attempt: 2, operation: "assisted_extraction" }));

    expect(() => buildPhase74ModelUsageEvidence({
      direct: validatePhase74ModelUsageLedger({
        events: directEvents,
        intents: directIntents,
      }),
      expected: {
        baselineCaseIds: ["case-a"],
        candidateCaseIds: ["case-a"],
      },
      ingestion: {
        baselineExclusive: [],
        candidateExclusive: [],
        shared: [{
          key: "empty-key",
          ledger: validatePhase74ModelUsageLedger({ events: [], intents: [] }),
        }, {
          key: "covered-key",
          ledger: validatePhase74ModelUsageLedger({
            events: extractionEvents,
            intents: extractionIntents,
          }),
        }],
      },
    })).toThrow("ingestion key empty-key has no model requests");
  });

  it("commits each attributed event to the durable recorder before returning", () => {
    const intents: AttributedModelUsageIntent[] = [];
    const events: AttributedModelUsageAttempt[] = [];
    const recorded: AttributedModelUsageAttempt[] = [];
    const inMemoryLengthsAtCommit: number[] = [];
    const sink = createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "case-1",
      events,
      intents,
      onEvent: (event) => {
        inMemoryLengthsAtCommit.push(events.length);
        recorded.push(event);
      },
    });

    sink.emit(attempt());

    expect(recorded).toEqual(events);
    expect(inMemoryLengthsAtCommit).toEqual([0]);
    expect(sink.strict).toBe(true);
  });

  it("fsyncs each terminal event before closing its append handle", () => {
    const calls: string[] = [];
    appendPhase74ModelUsageEventSync("usage.jsonl", {
      ...attempt(),
      branch: "candidate",
      caseId: "case-1",
      requestId: "request-1",
    }, {
      close(fd) {
        calls.push(`close:${fd}`);
      },
      fsync(fd) {
        calls.push(`fsync:${fd}`);
      },
      open(path, flags) {
        calls.push(`open:${path}:${flags}`);
        return flags === "r" ? 75 : 74;
      },
      write(fd, value) {
        calls.push(`write:${fd}:${value.endsWith("\n")}`);
      },
    });

    expect(calls).toEqual([
      "open:usage.jsonl:a",
      "write:74:true",
      "fsync:74",
      "close:74",
      "open:.:r",
      "fsync:75",
      "close:75",
    ]);
  });

  it("attributes every retry and excludes judge usage from product-cost evidence", () => {
    const intents: AttributedModelUsageIntent[] = [];
    const events: AttributedModelUsageAttempt[] = [];
    const baselineA = createAttributedModelUsageSink({
      branch: "baseline",
      caseId: "a",
      events,
      intents,
    });
    const baselineB = createAttributedModelUsageSink({
      branch: "baseline",
      caseId: "b",
      events,
      intents,
    });
    const candidateA = createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "a",
      events,
      intents,
    });
    const candidateB = createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "b",
      events,
      intents,
    });
    const judge = createAttributedModelUsageSink({
      branch: "judge",
      caseId: "a",
      events,
      intents,
    });

    baselineA.emit(attempt());
    baselineB.emit(attempt());
    candidateA.emit(attempt({ operation: "assisted_extraction" }));
    candidateA.emit(attempt({ attempt: 2, operation: "answer_generation" }));
    candidateB.emit(attempt({ operation: "embedding" }));
    candidateB.emit(attempt({ operation: "answer_generation" }));
    judge.emit(attempt({ inputTokens: 1_000, operation: "judge" }));

    const evidence = buildPhase74ModelUsageEvidence({
      direct: validatePhase74ModelUsageLedger({ events, intents }),
      expected: {
        baselineCaseIds: ["a", "b"],
        candidateCaseIds: ["a", "b"],
      },
      ingestion: {
        baselineExclusive: [],
        candidateExclusive: [],
        shared: [],
      },
    });
    expect(evidence).toMatchObject({
      accountingVersion: "phase74-model-usage-v2",
      allocationPolicy: "standalone-full-shared-v1",
      baseline: {
        answerGenerationCaseCount: 2,
        completeRequestCount: 2,
        logicalCaseCount: 2,
        missingRequestCount: 0,
        partialRequestCount: 0,
        pendingRequestCount: 0,
        operationCounts: { answer_generation: 2 },
        requestCount: 2,
        totalTokens: 24,
      },
      candidate: {
        answerGenerationCaseCount: 2,
        completeRequestCount: 4,
        logicalCaseCount: 2,
        missingRequestCount: 0,
        partialRequestCount: 0,
        pendingRequestCount: 0,
        operationCounts: {
          answer_generation: 2,
          assisted_extraction: 1,
          embedding: 1,
        },
        requestCount: 4,
        totalTokens: 48,
      },
      costBoundary: "full-product",
    });
    expect(evidence.baseline.caseIdsSha256).toBe(
      evidence.candidate.caseIdsSha256,
    );
  });

  it("retains missing attempts instead of treating them as zero-cost", () => {
    const intents: AttributedModelUsageIntent[] = [];
    const events: AttributedModelUsageAttempt[] = [];
    const sink = createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "case-1",
      events,
      intents,
    });
    sink.emit(attempt({
      completeness: "missing",
      inputTokens: null,
      outputTokens: null,
    }));

    const evidence = buildPhase74ModelUsageEvidence({
      direct: validatePhase74ModelUsageLedger({ events, intents }),
      expected: {
        baselineCaseIds: ["case-1"],
        candidateCaseIds: ["case-1"],
      },
      ingestion: {
        baselineExclusive: [],
        candidateExclusive: [],
        shared: [],
      },
    });
    expect(evidence.candidate).toMatchObject({
      completeRequestCount: 0,
      logicalCaseCount: 1,
      missingRequestCount: 1,
      pendingRequestCount: 0,
      requestCount: 1,
      totalTokens: 0,
    });
  });

  it("uses the frozen cohort as denominator and records cases that failed before any model event", () => {
    const intents: AttributedModelUsageIntent[] = [];
    const events: AttributedModelUsageAttempt[] = [];
    createAttributedModelUsageSink({
      branch: "baseline",
      caseId: "case-a",
      events,
      intents,
    }).emit(attempt());
    createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "case-a",
      events,
      intents,
    }).emit(attempt());
    createAttributedModelUsageSink({
      branch: "candidate",
      caseId: "case-b",
      events,
      intents,
    }).emit(attempt());

    const evidence = buildPhase74ModelUsageEvidence({
      direct: validatePhase74ModelUsageLedger({ events, intents }),
      expected: {
        baselineCaseIds: ["case-a", "case-b"],
        candidateCaseIds: ["case-a", "case-b"],
      },
      ingestion: {
        baselineExclusive: [],
        candidateExclusive: [],
        shared: [],
      },
    });
    expect(evidence.baseline).toMatchObject({
      logicalCaseCount: 2,
      unobservedCaseIds: ["case-b"],
    });
    expect(evidence.candidate.unobservedCaseIds).toEqual([]);
  });
});
