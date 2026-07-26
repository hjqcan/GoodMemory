import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import type {
  C6CandidatePlan,
} from "../../scripts/codex-coding-effect/c6-candidate-plan";
import {
  serializeC6CandidatePlan,
} from "../../scripts/codex-coding-effect/c6-candidate-plan";
import type {
  C6FlatSummaryTransportRequest,
  C6FlatSummaryTransportResponse,
} from "../../scripts/codex-coding-effect/c6-flat-summary-generation-capture";
import {
  C6FlatSummaryCaptureError,
  C6_FLAT_SUMMARY_REQUEST_SEED,
  C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
  materializeC6FlatSummaryGenerationCapture,
} from "../../scripts/codex-coding-effect/c6-flat-summary-generation-capture";
import {
  computeC6FlatSummaryGenerationKey,
  C6_FLAT_SUMMARY_GENERATION_POLICY,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  C6_NO_HISTORY_CONTROL,
  C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
  verifyC6FlatSummaryCorpusCompleteness,
} from "../../scripts/codex-coding-effect/c6-flat-summary";
import {
  buildC6FlatSummaryCorpusExpectation,
} from "../../scripts/codex-coding-effect/c6-readiness";

const ENDPOINT = C6_GURKIAI_FLAT_SUMMARY_ENDPOINT;
const API_TOKEN = "runtime-only-token-123456";
const SUMMARY_PROMPT = "Summarize only the supplied prior history.\n";

describe("Codex coding-effect C6 flat-summary generation capture", () => {
  it("materializes the exact generation set with fixed requests and structural-only evidence", async () => {
    const fixture = generationFixture();
    const requests: C6FlatSummaryTransportRequest[] = [];
    const result = await materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      now: sequenceClock([
        "2026-07-26T00:00:00.000Z",
        "2026-07-26T00:00:01.000Z",
        "2026-07-26T00:00:02.000Z",
        "2026-07-26T00:00:03.000Z",
      ]),
      transport: async (request) => {
        requests.push(request);
        const body = parseRequestBody(request.body);
        const history = body.messages[1]!.content;
        return providerResponse({
          id: `req-${history}`,
          output: history === "history-a"
            ? "Summary A."
            : "Summary B.",
        });
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) =>
      parseRequestBody(request.body).messages[1]!.content
    ).sort()).toEqual(["history-a", "history-b"]);
    for (const request of requests) {
      expect(request).toMatchObject({
        headers: {
          accept: "application/json",
          authorization: `Bearer ${API_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
        url: ENDPOINT,
      });
      expect(parseRequestBody(request.body)).toMatchObject({
        max_tokens: 512,
        model: "gpt-5.6-terra",
        n: 1,
        seed: C6_FLAT_SUMMARY_REQUEST_SEED,
        stream: false,
        temperature: 0,
      });
      expect(parseRequestBody(request.body).messages[0]).toEqual({
        content: SUMMARY_PROMPT,
        role: "system",
      });
    }

    expect(result).toMatchObject({
      codexRunReady: false,
      planSha256: fixture.input.planSha256,
      providerAuthenticityVerified: false,
      providerEndpoint: ENDPOINT,
      providerEndpointSha256: sha256(ENDPOINT),
      schemaVersion: 1,
      status: "local-transport-structural-capture-only",
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
      summaryProtocolSha256:
        sha256(fixture.input.summaryProtocolBytes),
    });
    expect(result.generations).toHaveLength(2);
    expect(result.corpus.generationReceipts).toHaveLength(2);
    expect(result.corpus.stageBindingReceipts).toHaveLength(9);
    expect(verifyC6FlatSummaryCorpusCompleteness(
      result.corpus,
      buildC6FlatSummaryCorpusExpectation(fixture.plan),
    )).toMatchObject({
      codexRunReady: false,
      generationReceipts: {
        required: 2,
        structurallyVerified: 2,
      },
      providerAuthenticityVerified: false,
      stageBindingReceipts: {
        required: 9,
        structurallyVerified: 9,
      },
    });

    for (const generation of result.generations) {
      expect(generation.artifact).toMatchObject({
        attemptManifestSha256: generation.attemptManifestSha256,
        generationKey: generation.generationKey,
        historySourceSha256: generation.historySourceSha256,
        model: "gpt-5.6-terra",
        outputSha256: generation.normalized.outputSha256,
        planSha256: fixture.input.planSha256,
        provider: "gurkiai-openai-compatible",
        providerAuthenticityVerified: false,
        providerEndpoint: ENDPOINT,
        providerEndpointSha256: sha256(ENDPOINT),
        rawResponseSha256: generation.rawResponseSha256,
        rawToNormalizedIndexSha256:
          generation.rawToNormalizedIndexSha256,
        requestSha256: generation.requestSha256,
        schemaVersion: 1,
        summaryPromptSha256: sha256(SUMMARY_PROMPT),
        summaryProtocolSha256:
          sha256(fixture.input.summaryProtocolBytes),
        usage: {
          cachedInputTokens: 4,
          inputTokens: 40,
          outputTokens: 3,
        },
      });
      expect(generation.normalizationIndex.model).toEqual({
        path: "$.model",
        value: "gpt-5.6-terra",
      });
      expect(sha256(generation.rawResponseBytes)).toBe(
        generation.rawResponseSha256,
      );
      expect(sha256(generation.redactedRequestBytes)).toBe(
        generation.requestSha256,
      );
      expect(sha256(generation.rawToNormalizedIndexBytes)).toBe(
        generation.rawToNormalizedIndexSha256,
      );
      expect(sha256(generation.artifactBytes)).toBe(
        generation.artifactSha256,
      );
      expect(sha256(generation.attemptManifestBytes)).toBe(
        generation.attemptManifestSha256,
      );
      expect(generation.attempts).toHaveLength(1);
      expect(generation.attempts[0]).toMatchObject({
        attempt: 1,
        decision: "accepted-success",
        status: 200,
      });
      expect(Buffer.from(generation.redactedRequestBytes).toString("utf8"))
        .toContain("Bearer [REDACTED]");
      expect(generation.artifactSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(JSON.stringify(result)).not.toContain(API_TOKEN);
  });

  it("rejects missing, extra, or duplicate history generations before transport", async () => {
    const fixture = generationFixture();
    const extra = {
      bytes: Buffer.from("extra-history"),
      generationKey: sha256("extra-generation"),
    };
    const mutations = [
      fixture.input.histories.slice(1),
      [...fixture.input.histories, extra],
      [...fixture.input.histories, fixture.input.histories[0]!],
    ];

    for (const histories of mutations) {
      let requestCount = 0;
      await expect(materializeC6FlatSummaryGenerationCapture({
        ...fixture.input,
        histories,
        transport: async () => {
          requestCount += 1;
          return providerResponse({
            id: "must-not-run",
            output: "Must not run.",
          });
        },
      })).rejects.toThrow(/generation (exact set|duplicates)/u);
      expect(requestCount).toBe(0);
    }
  });

  it("never calls the provider for no-history stages", async () => {
    const fixture = generationFixture({
      onlyNoHistory: true,
    });
    let requestCount = 0;
    const result = await materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      transport: async () => {
        requestCount += 1;
        return providerResponse({
          id: "must-not-run",
          output: "Must not run.",
        });
      },
    });

    expect(requestCount).toBe(0);
    expect(result.generations).toEqual([]);
    expect(result.corpus.generationReceipts).toEqual([]);
    expect(result.corpus.stageBindingReceipts).toEqual([]);
    expect(result.providerAuthenticityVerified).toBe(false);
    expect(result.codexRunReady).toBe(false);
  });

  it("rejects an endpoint that tries to impersonate the frozen provider", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    let requestCount = 0;

    await expect(materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      endpoint: "https://provider.example/v1/chat/completions",
      transport: async () => {
        requestCount += 1;
        return providerResponse({
          id: "must-not-run",
          output: "Must not run.",
        });
      },
    })).rejects.toThrow(/provider endpoint.*does not match/u);
    expect(requestCount).toBe(0);
  });

  it("retains and hash-binds every transient HTTP attempt", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const statuses = [429, 503, 200];
    const sleeps: number[] = [];
    let requestCount = 0;
    const result = await materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      now: sequenceClock([
        "2026-07-26T01:00:00.000Z",
        "2026-07-26T01:00:01.000Z",
        "2026-07-26T01:00:02.000Z",
        "2026-07-26T01:00:03.000Z",
        "2026-07-26T01:00:04.000Z",
        "2026-07-26T01:00:05.000Z",
      ]),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      transport: async () => {
        const status = statuses[requestCount]!;
        requestCount += 1;
        return status === 200
          ? providerResponse({
            id: "req-retry-success",
            output: "Summary after retry.",
          })
          : {
            body: Buffer.from(`transient-${status}`),
            status,
          };
      },
    });

    expect(requestCount).toBe(3);
    expect(sleeps).toEqual([1_000, 2_000]);
    expect(result.generations).toHaveLength(1);
    const generation = result.generations[0]!;
    expect(generation.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      completedAt: attempt.completedAt,
      decision: attempt.decision,
      raw: attempt.rawResponseBytes === undefined
        ? null
        : Buffer.from(attempt.rawResponseBytes).toString("utf8"),
      startedAt: attempt.startedAt,
      status: attempt.status ?? null,
    }))).toEqual([
      {
        attempt: 1,
        completedAt: "2026-07-26T01:00:01.000Z",
        decision: "retry-transient-status",
        raw: "transient-429",
        startedAt: "2026-07-26T01:00:00.000Z",
        status: 429,
      },
      {
        attempt: 2,
        completedAt: "2026-07-26T01:00:03.000Z",
        decision: "retry-transient-status",
        raw: "transient-503",
        startedAt: "2026-07-26T01:00:02.000Z",
        status: 503,
      },
      {
        attempt: 3,
        completedAt: "2026-07-26T01:00:05.000Z",
        decision: "accepted-success",
        raw: Buffer.from(generation.rawResponseBytes).toString("utf8"),
        startedAt: "2026-07-26T01:00:04.000Z",
        status: 200,
      },
    ]);
    for (const attempt of generation.attempts) {
      if (attempt.rawResponseBytes !== undefined) {
        const rawResponseSha256 = attempt.rawResponseSha256;
        if (rawResponseSha256 === undefined) {
          throw new Error("captured response hash is missing");
        }
        expect(sha256(attempt.rawResponseBytes)).toBe(
          rawResponseSha256,
        );
      }
    }
    expect(sha256(generation.attemptManifestBytes)).toBe(
      generation.attemptManifestSha256,
    );
    expect(generation.artifact.attemptManifestSha256).toBe(
      generation.attemptManifestSha256,
    );
    expect(generation.attemptManifest.attempts).toHaveLength(3);

    requestCount = 0;
    await expect(materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      sleep: async () => {
        throw new Error("must not sleep");
      },
      transport: async () => {
        requestCount += 1;
        return {
          body: Buffer.from("unauthorized"),
          status: 401,
        };
      },
    })).rejects.toThrow("non-retryable status 401");
    expect(requestCount).toBe(1);
  });

  it("rejects invalid JSON after HTTP 200 with complete pending-attempt evidence", async () => {
    const rawResponseBytes = Buffer.from("{invalid-json");
    const error = await captureRejectedHttp200({
      body: rawResponseBytes,
      status: 200,
    });

    expectRejectedHttp200Attempt(
      error,
      "rejected-invalid-json",
      rawResponseBytes,
    );
  });

  it("rejects invalid usage after HTTP 200 without marking the attempt accepted", async () => {
    const response = providerResponse({
      id: "req-invalid-usage",
      output: "Summary.",
      usage: {
        completion_tokens: 3,
        prompt_tokens: 40,
        prompt_tokens_details: {
          cached_tokens: 4,
        },
        total_tokens: 999,
      },
    });
    const error = await captureRejectedHttp200(response);

    expectRejectedHttp200Attempt(
      error,
      "rejected-invalid-usage",
      response.body,
    );
  });

  it("rejects an HTTP 200 response that omits its observed model", async () => {
    const response = providerResponse({
      id: "req-missing-model",
      includeModel: false,
      output: "Summary.",
    });
    const error = await captureRejectedHttp200(response);

    expectRejectedHttp200Attempt(
      error,
      "rejected-model-mismatch",
      response.body,
    );
  });

  it("rejects an HTTP 200 response from a model other than the frozen model", async () => {
    const response = providerResponse({
      id: "req-wrong-model",
      model: "gpt-5.5",
      output: "Summary.",
    });
    const error = await captureRejectedHttp200(response);

    expectRejectedHttp200Attempt(
      error,
      "rejected-model-mismatch",
      response.body,
    );
  });

  it("rejects an over-budget HTTP 200 output with its raw attempt still bound", async () => {
    const response = providerResponse({
      id: "req-over-budget",
      output: "x".repeat(4_096),
    });
    const error = await captureRejectedHttp200(response);

    expectRejectedHttp200Attempt(
      error,
      "rejected-output-over-budget",
      response.body,
    );
  });

  it("redacts thrown transport text and rejects token-reflecting responses", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    let requestCount = 0;
    let thrown: unknown;
    try {
      await materializeC6FlatSummaryGenerationCapture({
        ...fixture.input,
        transport: async () => {
          requestCount += 1;
          throw new Error(`gateway echoed ${API_TOKEN}`);
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(requestCount).toBe(1);
    expect(String(thrown)).toBe(
      "Error: C6 flat-summary transport failed",
    );
    expect(String(thrown)).not.toContain(API_TOKEN);
    expect(thrown).toBeInstanceOf(C6FlatSummaryCaptureError);
    const captureError = thrown as C6FlatSummaryCaptureError;
    expect(captureError.attemptManifest?.attempts[0]).toMatchObject({
      attempt: 1,
      decision: "rejected-transport-error",
      transportError: {
        sanitized: true,
        type: "transport-threw",
      },
    });
    if (
      captureError.attemptManifestBytes === null ||
      captureError.attemptManifestSha256 === null
    ) {
      throw new Error("sanitized attempt manifest is missing");
    }
    expect(sha256(captureError.attemptManifestBytes)).toBe(
      captureError.attemptManifestSha256,
    );
    expect(JSON.stringify(captureError)).not.toContain(API_TOKEN);

    requestCount = 0;
    thrown = undefined;
    try {
      await materializeC6FlatSummaryGenerationCapture({
        ...fixture.input,
        transport: async () => {
          requestCount += 1;
          return providerResponse({
            id: API_TOKEN,
            output: "Summary.",
          });
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(requestCount).toBe(1);
    expect(String(thrown)).toBe(
      "Error: C6 flat-summary response contains authorization material",
    );
    expect(String(thrown)).not.toContain(API_TOKEN);
  });

  it("binds frozen plan, protocol, prompt, and actual history bytes before any request", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const inputs = [
      {
        ...fixture.input,
        planBytes: Buffer.concat([
          fixture.input.planBytes,
          Buffer.from(" "),
        ]),
      },
      {
        ...fixture.input,
        summaryProtocolBytes: Buffer.concat([
          fixture.input.summaryProtocolBytes,
          Buffer.from(" "),
        ]),
      },
      {
        ...fixture.input,
        histories: [{
          ...fixture.input.histories[0]!,
          bytes: Buffer.from("substituted-history"),
        }],
      },
    ];

    for (const input of inputs) {
      let requestCount = 0;
      await expect(materializeC6FlatSummaryGenerationCapture({
        ...input,
        transport: async () => {
          requestCount += 1;
          return providerResponse({
            id: "must-not-run",
            output: "Must not run.",
          });
        },
      })).rejects.toThrow(/(plan|protocol|history)/u);
      expect(requestCount).toBe(0);
    }
  });

  it("uses code-unit ordering without consulting the process locale", async () => {
    const fixture = generationFixture();
    const originalLocaleCompare = String.prototype.localeCompare;
    let result: Awaited<
      ReturnType<typeof materializeC6FlatSummaryGenerationCapture>
    >;
    String.prototype.localeCompare = () => {
      throw new Error("locale ordering is forbidden");
    };
    try {
      result = await materializeC6FlatSummaryGenerationCapture({
        ...fixture.input,
        transport: async (request) => {
          const history = parseRequestBody(request.body)
            .messages[1]!.content;
          return providerResponse({
            id: `req-${history}`,
            output: history === "history-a"
              ? "Summary A."
              : "Summary B.",
          });
        },
      });
    } finally {
      String.prototype.localeCompare = originalLocaleCompare;
    }

    expect(result.generations.map(({ generationKey }) => generationKey))
      .toEqual(
        [...result.generations.map(({ generationKey }) => generationKey)]
          .sort(codeUnitCompare),
      );
    expect(result.corpus.stageBindingReceipts).toEqual(
      [...result.corpus.stageBindingReceipts].sort((left, right) =>
        codeUnitCompare(left.episodeId, right.episodeId) ||
        codeUnitCompare(left.stageId, right.stageId) ||
        codeUnitCompare(left.generationKey, right.generationKey) ||
        left.seed - right.seed
      ),
    );
  });
});

function generationFixture(options: {
  oneGeneration?: boolean;
  onlyNoHistory?: boolean;
} = {}) {
  const summaryPromptBytes = Buffer.from(SUMMARY_PROMPT);
  const summaryProtocol = {
    generationPolicy: C6_FLAT_SUMMARY_GENERATION_POLICY,
    historySource: "same-stage-sealed-prefix-as-goodmemory",
    injectionComposition: C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
    leakageAuditRequired: true,
    maxInjectedTokens: 512,
    model: "gpt-5.6-terra",
    noHistoryControl: structuredClone(C6_NO_HISTORY_CONTROL),
    pricingSnapshot: {
      path: "pricing.json",
      sha256: sha256("pricing"),
    },
    prompt: {
      path: "summary-prompt.md",
      sha256: sha256(summaryPromptBytes),
    },
    provider: "gurkiai-openai-compatible",
    rawGoldAccess: false,
    schemaVersion: 3,
    seedReusePolicy:
      "one-output-hash-reused-across-all-three-seeds",
    tokenCounter: {
      id: C6_INJECTION_TOKEN_COUNTER_ID,
      sha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
  };
  const summaryProtocolBytes = Buffer.from(
    `${JSON.stringify(summaryProtocol, null, 2)}\n`,
  );
  const firstHistory = historyBinding("history-a");
  const secondHistory = historyBinding("history-b");
  const noHistory = historyBinding("");
  const requiredStages = options.onlyNoHistory
    ? []
    : [
      stageBinding("stage-2", firstHistory, "required"),
      ...(options.oneGeneration
        ? []
        : [stageBinding("stage-3", secondHistory, "required")]),
    ];
  const sharedStages = options.onlyNoHistory || options.oneGeneration
    ? []
    : [stageBinding("stage-2", firstHistory, "required")];
  const episodeBindings = [
    {
      episodeId: "episode-a",
      stageBindings: [
        stageBinding("stage-1", noHistory, "prohibited"),
        ...requiredStages,
      ],
    },
    ...(sharedStages.length === 0
      ? []
      : [{
        episodeId: "episode-b",
        stageBindings: sharedStages,
      }]),
  ];
  const summaryStageCount = episodeBindings.reduce(
    (count, episode) => count + episode.stageBindings.filter(
      (stage) => stage.treatment.flatSummary.providerCall === "required",
    ).length,
    0,
  );
  const summaryGenerationCount = new Set(
    episodeBindings.flatMap((episode) =>
      episode.stageBindings
        .filter((stage) =>
          stage.treatment.flatSummary.providerCall === "required"
        )
        .map((stage) =>
          computeC6FlatSummaryGenerationKey(stage.sourceLineage.history)
        )
    ),
  ).size;
  const plan = {
    bindings: {
      injectionTokenCounterSha256:
        C6_INJECTION_TOKEN_COUNTER_SHA256,
      pricingSnapshotSha256: summaryProtocol.pricingSnapshot.sha256,
      summaryPromptSha256: summaryProtocol.prompt.sha256,
      summaryProtocolSha256: sha256(summaryProtocolBytes),
    },
    candidateManifestFrozen: false,
    codexRunReady: false,
    counts: {
      summaryGenerationCalls: summaryGenerationCount,
      summaryStageArtifactBindings: summaryStageCount,
    },
    episodeBindings,
    flatSummary: {
      generationProvenance: {
        requiredBefore: "run-identity-and-codex-execution",
        requiredReceiptFields: [
          "providerRequestId",
          "requestSha256",
          "rawResponseSha256",
          "rawToNormalizedIndexSha256",
          "startedAt",
          "completedAt",
          "usage",
        ],
        status: "authenticated-provider-receipts-required",
      },
      generationPolicy: C6_FLAT_SUMMARY_GENERATION_POLICY,
      historySource: "same-stage-sealed-prefix-as-goodmemory",
      injectionComposition: C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
      injectionCompositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      leakageAuditRequired: true,
      maxInjectedTokens: 512,
      model: "gpt-5.6-terra",
      provider: "gurkiai-openai-compatible",
      rawGoldAccess: false,
      seedReusePolicy:
        "one-output-hash-reused-across-all-three-seeds",
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
    noHistoryControl: structuredClone(C6_NO_HISTORY_CONTROL),
    seeds: [101, 202, 303],
  } as unknown as C6CandidatePlan;
  const planBytes = Buffer.from(serializeC6CandidatePlan(plan));
  const histories = [
    ...(options.onlyNoHistory
      ? []
      : [{
        bytes: firstHistory.bytes,
        generationKey:
          computeC6FlatSummaryGenerationKey(firstHistory.lineage),
      }]),
    ...(!options.onlyNoHistory && !options.oneGeneration
      ? [{
        bytes: secondHistory.bytes,
        generationKey:
          computeC6FlatSummaryGenerationKey(secondHistory.lineage),
      }]
      : []),
  ];

  return {
    input: {
      apiToken: API_TOKEN,
      endpoint: ENDPOINT,
      histories,
      plan,
      planBytes,
      planSha256: sha256(planBytes),
      summaryPromptBytes,
      summaryProtocolBytes,
    },
    plan,
  };
}

function historyBinding(value: string) {
  const bytes = Buffer.from(value);
  return {
    bytes,
    historySourceSha256: sha256(bytes),
    lineage: {
      artifactSha256: sha256(`artifact:${value}`),
      materializationSha256: sha256(`materialization:${value}`),
      sourceUnitCount: value.length === 0 ? 0 : 1,
      sourceUnitIdsSha256: sha256(`source-units:${value}`),
    },
  };
}

function stageBinding(
  stageId: string,
  history: ReturnType<typeof historyBinding>,
  providerCall: "prohibited" | "required",
) {
  const noHistory = providerCall === "prohibited";
  return {
    historySourceSha256: history.historySourceSha256,
    sourceLineage: {
      history: history.lineage,
      stageLineageSha256: sha256(`stage-lineage:${stageId}`),
      target: {
        locator: `issues/${stageId}`,
        normalizedSourceRequestSha256:
          sha256(`normalized-request:${stageId}`),
        recordSha256: sha256(`record:${stageId}`),
        sourceRequestNormalization:
          "ecmascript-string-trim-v1" as const,
        sourceRequestSha256: sha256(`request:${stageId}`),
        sourceUnitId: `unit-${stageId}`,
        upstreamItemRevision: "1",
      },
    },
    stageId,
    stageInputSha256: sha256(`stage-input:${stageId}`),
    treatment: {
      flatSummary: {
        compositionSha256: noHistory
          ? C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256
          : C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
        injectionMode: noHistory
          ? "no-history-zero-injection" as const
          : "content-injection" as const,
        providerCall,
      },
      goodMemory: {
        compositionSha256: noHistory
          ? C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256
          : sha256("goodmemory-composition"),
        injectionMode: noHistory
          ? "no-history-zero-injection" as const
          : "content-injection" as const,
      },
    },
  };
}

function providerResponse(input: {
  id: string;
  includeModel?: boolean;
  model?: string;
  output: string;
  usage?: {
    completion_tokens: number;
    prompt_tokens: number;
    prompt_tokens_details?: {
      cached_tokens: number;
    };
    total_tokens: number;
  };
}): C6FlatSummaryTransportResponse {
  return {
    body: Buffer.from(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        index: 0,
        message: {
          content: input.output,
          role: "assistant",
        },
      }],
      id: input.id,
      ...(input.includeModel === false
        ? {}
        : { model: input.model ?? "gpt-5.6-terra" }),
      usage: input.usage ?? {
        completion_tokens: 3,
        prompt_tokens: 40,
        prompt_tokens_details: {
          cached_tokens: 4,
        },
        total_tokens: 43,
      },
    })),
    status: 200,
  };
}

async function captureRejectedHttp200(
  response: C6FlatSummaryTransportResponse,
): Promise<C6FlatSummaryCaptureError> {
  const fixture = generationFixture({
    oneGeneration: true,
  });
  let requestCount = 0;
  try {
    await materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      now: sequenceClock([
        "2026-07-26T02:00:00.000Z",
        "2026-07-26T02:00:01.000Z",
      ]),
      transport: async () => {
        requestCount += 1;
        return response;
      },
    });
  } catch (error) {
    expect(requestCount).toBe(1);
    if (error instanceof C6FlatSummaryCaptureError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected HTTP 200 capture rejection");
}

function expectRejectedHttp200Attempt(
  error: C6FlatSummaryCaptureError,
  decision:
    | "rejected-invalid-json"
    | "rejected-invalid-usage"
    | "rejected-model-mismatch"
    | "rejected-output-over-budget",
  rawResponseBytes: Uint8Array,
): void {
  expect(error.attempts).toHaveLength(1);
  expect(error.attempts[0]).toMatchObject({
    attempt: 1,
    decision,
    rawResponseSha256: sha256(rawResponseBytes),
    status: 200,
  });
  expect(Buffer.from(error.attempts[0]!.rawResponseBytes!)).toEqual(
    Buffer.from(rawResponseBytes),
  );
  expect(error.attemptManifest?.attempts[0]).toMatchObject({
    attempt: 1,
    decision,
    rawResponseSha256: sha256(rawResponseBytes),
    status: 200,
  });
  expect(
    error.attemptManifest?.attempts.some((attempt) =>
      attempt.decision === "accepted-success"
    ),
  ).toBe(false);
  if (
    error.attemptManifestBytes === null ||
    error.attemptManifestSha256 === null
  ) {
    throw new Error("rejected attempt manifest is missing");
  }
  expect(sha256(error.attemptManifestBytes)).toBe(
    error.attemptManifestSha256,
  );
  expect(JSON.stringify(error)).not.toContain(API_TOKEN);
}

function parseRequestBody(bytes: Uint8Array): {
  max_tokens: number;
  messages: Array<{
    content: string;
    role: string;
  }>;
  model: string;
  n: number;
  seed: number;
  stream: boolean;
  temperature: number;
} {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as ReturnType<
    typeof parseRequestBody
  >;
}

function sequenceClock(values: readonly string[]): () => Date {
  let index = 0;
  return () => new Date(values[index++]!);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
