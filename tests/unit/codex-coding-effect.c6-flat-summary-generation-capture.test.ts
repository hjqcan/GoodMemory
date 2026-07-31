import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { describe, expect, it } from "bun:test";

import type {
  C6CandidatePlan,
} from "../../scripts/codex-coding-effect/c6-candidate-plan";
import {
  serializeC6CandidatePlan,
} from "../../scripts/codex-coding-effect/c6-candidate-plan";
import type {
  C6FlatSummaryCaptureEvidenceSink,
  C6FlatSummaryTransportRequest,
  C6FlatSummaryTransportResponse,
} from "../../scripts/codex-coding-effect/c6-flat-summary-generation-capture";
import {
  C6FlatSummaryCaptureError,
  C6FlatSummaryTransportBoundaryError,
  C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
  C6_FLAT_SUMMARY_REQUEST_SEED,
  C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
  materializeC6FlatSummaryGenerationCapture,
  serializeC6FlatSummaryCanonicalJson,
} from "../../scripts/codex-coding-effect/c6-flat-summary-generation-capture";
import {
  C6FlatSummaryGenerationPublicationError,
  finalizeC6FlatSummaryGenerationCaptureRoot,
  materializeC6FlatSummaryGenerationCaptureToRoot,
  verifyC6FlatSummaryGenerationCaptureRoot,
} from "../../scripts/codex-coding-effect/c6-flat-summary-generation-publication";
import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  createC6FlatSummaryLiveTransport,
  executeC6FlatSummaryGenerationCommand,
} from "../../scripts/materialize-codex-coding-effect-c6-flat-summary-generation";
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

  it("awaits append-only evidence in prepared, raw, decision, accepted order", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const events: string[] = [];
    const evidenceSink: C6FlatSummaryCaptureEvidenceSink = {
      onAttemptDecision: async ({ attempt }) => {
        events.push(`decision:${attempt.attempt}:${attempt.decision}`);
      },
      onGenerationAccepted: async ({ generation }) => {
        events.push(`accepted:${generation.generationKey}`);
      },
      onGenerationPrepared: async ({
        generationKey,
        redactedRequestBytes,
      }) => {
        expect(Buffer.from(redactedRequestBytes).includes(
          Buffer.from(API_TOKEN),
        )).toBe(false);
        events.push(`prepared:${generationKey}`);
      },
      onRawAttempt: async ({ attempt }) => {
        expect(sha256(attempt.rawResponseBytes)).toBe(
          attempt.rawResponseSha256,
        );
        events.push(`raw:${attempt.attempt}`);
      },
    };
    let requestCount = 0;

    const result = await materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      evidenceSink,
      now: sequenceClock([
        "2026-07-26T01:10:00.000Z",
        "2026-07-26T01:10:01.000Z",
        "2026-07-26T01:10:02.000Z",
        "2026-07-26T01:10:03.000Z",
      ]),
      sleep: async () => {},
      transport: async () => {
        requestCount += 1;
        return requestCount === 1
          ? {
            body: Buffer.from("retry"),
            status: 503,
          }
          : providerResponse({
            id: "req-evidence-order",
            output: "Summary.",
          });
      },
    });

    const generationKey = result.generations[0]!.generationKey;
    expect(events).toEqual([
      `prepared:${generationKey}`,
      "raw:1",
      "decision:1:retry-transient-status",
      "raw:2",
      "decision:2:accepted-success",
      `accepted:${generationKey}`,
    ]);
    expect(events.some((event) =>
      event.includes("received-http-200")
    )).toBe(false);
  });

  it("persists rejected HTTP 200 evidence before surfacing validation failure", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const events: string[] = [];
    const rawResponseBytes = Buffer.from("{invalid-json");

    await expect(materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      evidenceSink: {
        onAttemptDecision: async ({ attempt }) => {
          events.push(`decision:${attempt.decision}`);
        },
        onGenerationAccepted: async () => {
          events.push("accepted");
        },
        onGenerationPrepared: async () => {
          events.push("prepared");
        },
        onRawAttempt: async ({ attempt }) => {
          expect(Buffer.from(attempt.rawResponseBytes)).toEqual(
            rawResponseBytes,
          );
          events.push("raw");
        },
      },
      transport: async () => ({
        body: rawResponseBytes,
        status: 200,
      }),
    })).rejects.toThrow("invalid JSON");

    expect(events).toEqual([
      "prepared",
      "raw",
      "decision:rejected-invalid-json",
    ]);
  });

  it("rejects an oversized injected response before copying or persisting raw bytes", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const events: string[] = [];

    await expect(materializeC6FlatSummaryGenerationCapture({
      ...fixture.input,
      evidenceSink: {
        onAttemptDecision: async ({ attempt }) => {
          events.push(
            `decision:${attempt.transportError?.type ?? "none"}`,
          );
        },
        onGenerationAccepted: async () => {
          events.push("accepted");
        },
        onGenerationPrepared: async () => {
          events.push("prepared");
        },
        onRawAttempt: async () => {
          events.push("raw");
        },
      },
      transport: async () => ({
        body: new Uint8Array(
          C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES + 1,
        ),
        status: 200,
      }),
    })).rejects.toThrow(/byte limit/u);

    expect(events).toEqual([
      "prepared",
      "decision:response-byte-limit-exceeded",
    ]);
  });

  it("preserves the typed live transport boundary in rejected attempt evidence", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    let thrown: unknown;
    try {
      await materializeC6FlatSummaryGenerationCapture({
        ...fixture.input,
        transport: async () => {
          throw new C6FlatSummaryTransportBoundaryError(
            "live request timed out",
            "request-timeout",
          );
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(C6FlatSummaryCaptureError);
    expect(
      (thrown as C6FlatSummaryCaptureError)
        .attemptManifest?.attempts[0],
    ).toMatchObject({
      decision: "rejected-transport-error",
      transportError: {
        sanitized: true,
        type: "request-timeout",
      },
    });
  });

  it("seals live oversized HTTP 200 bodies with their observed status", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-live-oversize-",
    )));
    const outputRoot = join(parent, "capture");
    const transport = createC6FlatSummaryLiveTransport(
      async () => new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(
              C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
            ));
            controller.enqueue(Uint8Array.of(1));
          },
        }),
        { status: 200 },
      ),
    );
    try {
      let failure: C6FlatSummaryGenerationPublicationError | undefined;
      try {
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport,
        });
      } catch (error) {
        if (
          error instanceof C6FlatSummaryGenerationPublicationError
        ) {
          failure = error;
        } else {
          throw error;
        }
      }
      if (failure === undefined) {
        throw new Error("expected a sealed flat-summary failure");
      }
      const verified =
        await verifyC6FlatSummaryGenerationCaptureRoot({
          expectedReceiptSha256: failure.receiptSha256,
          outputRoot,
        });
      expect(verified).toMatchObject({
        attemptCount: 1,
        generationCount: 0,
        status: "rejected-provider-capture-evidence-retained",
      });
      const artifactsRoot = join(outputRoot, "artifacts");
      const index = JSON.parse(
        await readFile(
          join(artifactsRoot, "generation-index.json"),
          "utf8",
        ),
      ) as {
        generations: Array<{
          attempts: Array<{
            decisionArtifact: { path: string };
            rawResponse: null;
          }>;
        }>;
      };
      const attempt = index.generations[0]!.attempts[0]!;
      expect(attempt.rawResponse).toBeNull();
      const decision = JSON.parse(
        await readFile(
          join(artifactsRoot, attempt.decisionArtifact.path),
          "utf8",
        ),
      );
      expect(decision).toMatchObject({
        decision: "rejected-transport-error",
        status: 200,
        transportError: {
          sanitized: true,
          type: "response-byte-limit-exceeded",
        },
      });
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
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

  it("rejects invalid or colliding authorization material before claiming an output root", async () => {
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-auth-preflight-",
    )));
    const defaultFixture = generationFixture({
      oneGeneration: true,
    });
    const promptCollisionFixture = generationFixture({
      oneGeneration: true,
      summaryPrompt:
        `Never persist this runtime credential: ${API_TOKEN}\n`,
    });
    const cases = [
      {
        input: {
          ...defaultFixture.input,
          apiToken: "",
        },
        name: "empty",
      },
      {
        input: {
          ...defaultFixture.input,
          apiToken: ` ${API_TOKEN}`,
        },
        name: "padded",
      },
      {
        input: {
          ...defaultFixture.input,
          apiToken: "runtime\\only-token",
        },
        name: "json-sensitive",
      },
      {
        input: promptCollisionFixture.input,
        name: "input-collision",
      },
    ];
    try {
      for (const testCase of cases) {
        const outputRoot = join(parent, testCase.name);
        let requestCount = 0;
        await expect(
          materializeC6FlatSummaryGenerationCaptureToRoot({
            ...testCase.input,
            outputRoot,
            transport: async () => {
              requestCount += 1;
              return providerResponse({
                id: "must-not-run",
                output: "Must not run.",
              });
            },
          }),
        ).rejects.toThrow(/authorization/u);
        expect(requestCount).toBe(0);
        await expect(readdir(outputRoot)).rejects.toThrow();
      }
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("publishes a receipt-last asset-locked corpus and rejects later mutation", async () => {
    const fixture = generationFixture();
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-publication-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const published =
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
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

      expect((await readdir(outputRoot)).sort()).toEqual([
        "artifacts",
        "receipt.json",
      ]);
      expect((await readdir(join(outputRoot, "artifacts"))).sort())
        .toEqual([
          "asset-lock.json",
          "capture-claim.json",
          "capture-terminal.json",
          "corpus.json",
          "generation-index.json",
          "generations",
          "inputs",
        ]);
      expect(published).toMatchObject({
        codexRunReady: false,
        generationCount: 2,
        outputRoot,
        providerAuthenticityVerified: false,
        status: "local-transport-structural-capture-only",
      });
      const verified = await verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: published.receiptSha256,
        outputRoot,
      });
      expect(verified).toEqual(published);

      const lock = JSON.parse(
        await readFile(
          join(outputRoot, "artifacts", "asset-lock.json"),
          "utf8",
        ),
      ) as {
        files: Array<{ path: string }>;
      };
      const persisted = Buffer.concat(await Promise.all(
        lock.files.map(({ path }) =>
          readFile(join(outputRoot, "artifacts", path))
        ),
      ));
      expect(persisted.includes(Buffer.from(API_TOKEN))).toBe(false);

      await writeFile(
        join(outputRoot, "artifacts", "corpus.json"),
        "{}\n",
      );
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: published.receiptSha256,
        outputRoot,
      })).rejects.toThrow(/asset (?:closure|lock)|hash/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("retains prior success and seals rejected HTTP 200 evidence instead of deleting it", async () => {
    const fixture = generationFixture();
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-rejected-publication-",
    )));
    const outputRoot = join(parent, "capture");
    let requestCount = 0;
    try {
      let failure: C6FlatSummaryGenerationPublicationError | undefined;
      try {
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => {
            requestCount += 1;
            return requestCount === 1
              ? providerResponse({
                id: "req-retained-success",
                output: "Retained summary.",
              })
              : {
                body: Buffer.from("{invalid-json"),
                status: 200,
              };
          },
        });
      } catch (error) {
        if (
          error instanceof C6FlatSummaryGenerationPublicationError
        ) {
          failure = error;
        } else {
          throw error;
        }
      }
      if (failure === undefined) {
        throw new Error("expected a sealed flat-summary failure");
      }

      expect(requestCount).toBe(2);
      expect(failure).toMatchObject({
        outputRoot,
        status: "rejected-provider-capture-evidence-retained",
      });
      const rejected = await verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: failure.receiptSha256,
        outputRoot,
      });
      expect(rejected).toMatchObject({
        attemptCount: 2,
        codexRunReady: false,
        generationCount: 1,
        providerAuthenticityVerified: false,
        status: "rejected-provider-capture-evidence-retained",
      });

      const lock = JSON.parse(
        await readFile(
          join(outputRoot, "artifacts", "asset-lock.json"),
          "utf8",
        ),
      ) as {
        files: Array<{ path: string }>;
      };
      const paths = lock.files.map(({ path }) => path);
      expect(paths).toContain("capture-failure-terminal.json");
      expect(paths.filter((path) =>
        path.endsWith(".response.raw")
      )).toHaveLength(2);
      expect(paths.filter((path) =>
        path.endsWith(".decision.json")
      )).toHaveLength(2);
      expect(paths.filter((path) =>
        path.endsWith("/output.txt")
      )).toHaveLength(1);
      const decisions = await Promise.all(paths
        .filter((path) => path.endsWith(".decision.json"))
        .map(async (path) =>
          JSON.parse(await readFile(
            join(outputRoot, "artifacts", path),
            "utf8",
          )) as { decision: string }
        ));
      expect(decisions.map(({ decision }) => decision).sort()).toEqual([
        "accepted-success",
        "rejected-invalid-json",
      ]);
      const persisted = Buffer.concat(await Promise.all(
        paths.map((path) =>
          readFile(join(outputRoot, "artifacts", path))
        ),
      ));
      expect(persisted.includes(Buffer.from(API_TOKEN))).toBe(false);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("seals token-reflecting responses without raw bytes or authorization material", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-token-reflection-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      let failure: C6FlatSummaryGenerationPublicationError | undefined;
      try {
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => providerResponse({
            id: API_TOKEN,
            output: "Must not persist.",
          }),
        });
      } catch (error) {
        if (
          error instanceof C6FlatSummaryGenerationPublicationError
        ) {
          failure = error;
        } else {
          throw error;
        }
      }
      if (failure === undefined) {
        throw new Error("expected a sealed token-reflection failure");
      }

      const verified = await verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: failure.receiptSha256,
        outputRoot,
      });
      expect(verified).toMatchObject({
        attemptCount: 1,
        generationCount: 0,
        status: "rejected-provider-capture-evidence-retained",
      });
      const artifactsRoot = join(outputRoot, "artifacts");
      const lock = JSON.parse(
        await readFile(
          join(artifactsRoot, "asset-lock.json"),
          "utf8",
        ),
      ) as {
        files: Array<{ path: string }>;
      };
      const paths = lock.files.map(({ path }) => path);
      expect(paths.filter((path) =>
        path.endsWith(".response.raw")
      )).toEqual([]);
      const decisionPath = paths.find((path) =>
        path.endsWith(".decision.json")
      );
      if (decisionPath === undefined) {
        throw new Error("token-reflection decision is missing");
      }
      expect(JSON.parse(
        await readFile(join(artifactsRoot, decisionPath), "utf8"),
      )).toMatchObject({
        decision: "rejected-transport-error",
        transportError: {
          sanitized: true,
          type: "authorization-material-detected",
        },
      });
      const persisted = Buffer.concat([
        ...await Promise.all(paths.map((path) =>
          readFile(join(artifactsRoot, path))
        )),
        await readFile(join(outputRoot, "receipt.json")),
      ]);
      expect(persisted.includes(Buffer.from(API_TOKEN))).toBe(false);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("detects JSON-unicode-escaped authorization material before raw persistence", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-escaped-token-",
    )));
    const outputRoot = join(parent, "capture");
    const escapedToken = [...API_TOKEN].map((character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    ).join("");
    const safeResponse = providerResponse({
      id: "replace-me",
      output: "Must not persist.",
    });
    const escapedResponseBytes = Buffer.from(
      Buffer.from(safeResponse.body).toString("utf8").replace(
        '"id":"replace-me"',
        `"id":"${escapedToken}"`,
      ),
    );
    expect(
      escapedResponseBytes.includes(Buffer.from(API_TOKEN)),
    ).toBe(false);
    try {
      let failure: C6FlatSummaryGenerationPublicationError | undefined;
      try {
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => ({
            body: escapedResponseBytes,
            status: 200,
          }),
        });
      } catch (error) {
        if (
          error instanceof C6FlatSummaryGenerationPublicationError
        ) {
          failure = error;
        } else {
          throw error;
        }
      }
      if (failure === undefined) {
        throw new Error("expected an escaped-token capture failure");
      }
      const artifactsRoot = join(outputRoot, "artifacts");
      const lock = JSON.parse(
        await readFile(
          join(artifactsRoot, "asset-lock.json"),
          "utf8",
        ),
      ) as {
        files: Array<{ path: string }>;
      };
      expect(lock.files.some(({ path }) =>
        path.endsWith(".response.raw")
      )).toBe(false);
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: failure.receiptSha256,
        outputRoot,
      })).resolves.toMatchObject({
        status: "rejected-provider-capture-evidence-retained",
      });
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("finalize-only seals raw-only interrupted evidence without another provider call", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-finalize-only-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      let failure: C6FlatSummaryGenerationPublicationError | undefined;
      try {
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => ({
            body: Buffer.from("{invalid-json"),
            status: 200,
          }),
        });
      } catch (error) {
        if (
          error instanceof C6FlatSummaryGenerationPublicationError
        ) {
          failure = error;
        } else {
          throw error;
        }
      }
      if (failure === undefined) {
        throw new Error("expected a sealed flat-summary failure");
      }
      const artifactsRoot = join(outputRoot, "artifacts");
      const index = JSON.parse(
        await readFile(
          join(artifactsRoot, "generation-index.json"),
          "utf8",
        ),
      ) as {
        generations: Array<{
          attemptManifest?: { path: string };
          attempts: Array<{
            decisionArtifact?: { path: string };
          }>;
        }>;
      };
      await Promise.all([
        rm(join(outputRoot, "receipt.json")),
        rm(join(artifactsRoot, "asset-lock.json")),
        rm(join(artifactsRoot, "capture-failure-terminal.json")),
        rm(join(artifactsRoot, "generation-index.json")),
        ...index.generations.flatMap(({ attemptManifest }) =>
          attemptManifest === undefined
            ? []
            : [rm(join(artifactsRoot, attemptManifest.path))]
        ),
        ...index.generations.flatMap(({ attempts }) =>
          attempts.flatMap(({ decisionArtifact }) =>
            decisionArtifact === undefined
              ? []
              : [rm(join(artifactsRoot, decisionArtifact.path))]
          )
        ),
      ]);

      const finalized = await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      });
      expect(finalized).toMatchObject({
        attemptCount: 1,
        generationCount: 0,
        status: "rejected-provider-capture-evidence-retained",
      });
      expect(await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      })).toEqual(finalized);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("finalize-only resumes success after terminal or asset-lock publication without provider work", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-success-finalize-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const published =
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => providerResponse({
            id: "req-success-finalize",
            output: "Stable summary.",
          }),
        });
      const artifactsRoot = join(outputRoot, "artifacts");
      const lockPath = join(artifactsRoot, "asset-lock.json");
      const originalLock = await readFile(lockPath);

      await rm(join(outputRoot, "receipt.json"));
      const fromExistingLock =
        await finalizeC6FlatSummaryGenerationCaptureRoot({
          histories: fixture.input.histories,
          outputRoot,
          planBytes: fixture.input.planBytes,
          planSha256: fixture.input.planSha256,
          summaryPromptBytes: fixture.input.summaryPromptBytes,
          summaryProtocolBytes: fixture.input.summaryProtocolBytes,
        });
      expect(fromExistingLock).toEqual(published);
      expect(await readFile(lockPath)).toEqual(originalLock);

      await Promise.all([
        rm(join(outputRoot, "receipt.json")),
        rm(lockPath),
      ]);
      const fromTerminal =
        await finalizeC6FlatSummaryGenerationCaptureRoot({
          histories: fixture.input.histories,
          outputRoot,
          planBytes: fixture.input.planBytes,
          planSha256: fixture.input.planSha256,
          summaryPromptBytes: fixture.input.summaryPromptBytes,
          summaryProtocolBytes: fixture.input.summaryProtocolBytes,
        });
      expect(fromTerminal).toEqual(published);
      expect(await readFile(lockPath)).toEqual(originalLock);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("finalize-only seals normalization and output written before the provider commit marker", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-partial-generation-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const published =
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => providerResponse({
            id: "req-partial-generation",
            output: "Retained partial output.",
          }),
        });
      const artifactsRoot = join(outputRoot, "artifacts");
      const index = JSON.parse(
        await readFile(
          join(artifactsRoot, "generation-index.json"),
          "utf8",
        ),
      ) as {
        generations: Array<{
          accepted: {
            providerArtifact: { path: string };
          };
        }>;
      };
      await Promise.all([
        rm(join(outputRoot, "receipt.json")),
        rm(join(artifactsRoot, "asset-lock.json")),
        rm(join(artifactsRoot, "capture-terminal.json")),
        rm(join(artifactsRoot, "corpus.json")),
        rm(join(artifactsRoot, "generation-index.json")),
        rm(join(
          artifactsRoot,
          index.generations[0]!.accepted.providerArtifact.path,
        )),
      ]);

      const finalized = await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      });
      expect(finalized).toMatchObject({
        attemptCount: 1,
        generationCount: 0,
        receiptSha256: expect.not.stringMatching(
          published.receiptSha256,
        ),
        status: "rejected-provider-capture-evidence-retained",
      });
      const lock = JSON.parse(
        await readFile(
          join(artifactsRoot, "asset-lock.json"),
          "utf8",
        ),
      ) as {
        files: Array<{ path: string }>;
      };
      const paths = lock.files.map(({ path }) => path);
      expect(paths.some((path) =>
        path.endsWith("/normalization-index.json")
      )).toBe(true);
      expect(paths.some((path) =>
        path.endsWith("/output.txt")
      )).toBe(true);
      expect(paths.some((path) =>
        path.endsWith("/provider-artifact.json")
      )).toBe(false);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("finalize-only retains an uncommitted corpus written before the success terminal", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-uncommitted-corpus-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      await materializeC6FlatSummaryGenerationCaptureToRoot({
        ...fixture.input,
        outputRoot,
        transport: async () => providerResponse({
          id: "req-uncommitted-corpus",
          output: "Retained corpus output.",
        }),
      });
      const artifactsRoot = join(outputRoot, "artifacts");
      await Promise.all([
        rm(join(outputRoot, "receipt.json")),
        rm(join(artifactsRoot, "asset-lock.json")),
        rm(join(artifactsRoot, "capture-terminal.json")),
      ]);

      const finalized = await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      });
      expect(finalized).toMatchObject({
        attemptCount: 1,
        generationCount: 1,
        stageBindingCount: 0,
        status: "rejected-provider-capture-evidence-retained",
      });
      const receipt = JSON.parse(
        await readFile(join(outputRoot, "receipt.json"), "utf8"),
      ) as {
        uncommittedCorpus: { path: string } | null;
      };
      expect(receipt.uncommittedCorpus).toMatchObject({
        path: "corpus.json",
      });
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("recovers known create-only pending files and rejects ambiguous pending state", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-pending-recovery-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const published =
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => providerResponse({
            id: "req-pending-recovery",
            output: "Stable summary.",
          }),
        });
      const receiptPath = join(outputRoot, "receipt.json");
      const receiptBytes = await readFile(receiptPath);
      const pendingReceiptPath = join(
        outputRoot,
        `.receipt.json.${sha256(receiptBytes)}.pending`,
      );

      await rename(receiptPath, pendingReceiptPath);
      expect(await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      })).toEqual(published);
      await expect(readFile(pendingReceiptPath)).rejects.toThrow();

      await link(receiptPath, pendingReceiptPath);
      expect(await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      })).toEqual(published);
      await expect(readFile(pendingReceiptPath)).rejects.toThrow();

      await writeFile(pendingReceiptPath, "different inode");
      await expect(
        finalizeC6FlatSummaryGenerationCaptureRoot({
          histories: fixture.input.histories,
          outputRoot,
          planBytes: fixture.input.planBytes,
          planSha256: fixture.input.planSha256,
          summaryPromptBytes: fixture.input.summaryPromptBytes,
          summaryProtocolBytes: fixture.input.summaryProtocolBytes,
        }),
      ).rejects.toThrow(/pending\/final inode mismatch/u);
      await rm(pendingReceiptPath);

      await writeFile(
        join(outputRoot, ".unknown.pending"),
        "unknown",
      );
      await expect(
        finalizeC6FlatSummaryGenerationCaptureRoot({
          histories: fixture.input.histories,
          outputRoot,
          planBytes: fixture.input.planBytes,
          planSha256: fixture.input.planSha256,
          summaryPromptBytes: fixture.input.summaryPromptBytes,
          summaryProtocolBytes: fixture.input.summaryProtocolBytes,
        }),
      ).rejects.toThrow(/pending artifact is unknown/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("does not promote a truncated derived pending receipt", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-truncated-pending-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const published =
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => providerResponse({
            id: "req-truncated-pending",
            output: "Stable summary.",
          }),
        });
      const receiptPath = join(outputRoot, "receipt.json");
      const receiptBytes = await readFile(receiptPath);
      const pendingPath = join(
        outputRoot,
        `.receipt.json.${sha256(receiptBytes)}.pending`,
      );
      await rm(receiptPath);
      await writeFile(
        pendingPath,
        receiptBytes.subarray(0, 16),
      );

      expect(await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      })).toEqual(published);
      expect(await readFile(receiptPath)).toEqual(receiptBytes);
      await expect(readFile(pendingPath)).rejects.toThrow();
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("retains partial raw pending bytes as interrupted provider evidence", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-partial-raw-pending-",
    )));
    const outputRoot = join(parent, "capture");
    const originalRaw = Buffer.from(
      "{invalid-json-provider-response",
    );
    const partialRaw = originalRaw.subarray(0, 13);
    try {
      let failure: C6FlatSummaryGenerationPublicationError | undefined;
      try {
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => ({
            body: originalRaw,
            status: 200,
          }),
        });
      } catch (error) {
        if (
          error instanceof C6FlatSummaryGenerationPublicationError
        ) {
          failure = error;
        } else {
          throw error;
        }
      }
      if (failure === undefined) {
        throw new Error("expected a sealed flat-summary failure");
      }
      const artifactsRoot = join(outputRoot, "artifacts");
      const index = JSON.parse(
        await readFile(
          join(artifactsRoot, "generation-index.json"),
          "utf8",
        ),
      ) as {
        generations: Array<{
          attemptManifest: { path: string };
          attempts: Array<{
            decisionArtifact: { path: string };
            rawResponse: { path: string };
            responseMarker: { path: string };
          }>;
        }>;
      };
      const generation = index.generations[0]!;
      const attempt = generation.attempts[0]!;
      const rawPath = join(artifactsRoot, attempt.rawResponse.path);
      const pendingPath = join(
        dirname(rawPath),
        `.${basename(rawPath)}.${sha256(originalRaw)}.pending`,
      );
      await Promise.all([
        rm(join(outputRoot, "receipt.json")),
        rm(join(artifactsRoot, "asset-lock.json")),
        rm(join(
          artifactsRoot,
          "capture-failure-terminal.json",
        )),
        rm(join(artifactsRoot, "generation-index.json")),
        rm(join(
          artifactsRoot,
          generation.attemptManifest.path,
        )),
        rm(join(
          artifactsRoot,
          attempt.decisionArtifact.path,
        )),
        rm(join(
          artifactsRoot,
          attempt.responseMarker.path,
        )),
        rm(rawPath),
      ]);
      await writeFile(pendingPath, partialRaw);

      const finalized =
        await finalizeC6FlatSummaryGenerationCaptureRoot({
          histories: fixture.input.histories,
          outputRoot,
          planBytes: fixture.input.planBytes,
          planSha256: fixture.input.planSha256,
          summaryPromptBytes: fixture.input.summaryPromptBytes,
          summaryProtocolBytes: fixture.input.summaryProtocolBytes,
        });
      expect(finalized).toMatchObject({
        attemptCount: 1,
        generationCount: 0,
        status: "rejected-provider-capture-evidence-retained",
      });
      expect(await readFile(rawPath)).toEqual(partialRaw);
      await expect(readFile(pendingPath)).rejects.toThrow();

      const finalizedIndex = JSON.parse(
        await readFile(
          join(artifactsRoot, "generation-index.json"),
          "utf8",
        ),
      ) as {
        generations: Array<{
          attempts: Array<{
            decisionArtifact: { path: string };
          }>;
        }>;
      };
      const finalizedDecision = JSON.parse(
        await readFile(
          join(
            artifactsRoot,
            finalizedIndex.generations[0]!
              .attempts[0]!.decisionArtifact.path,
          ),
          "utf8",
        ),
      );
      expect(finalizedDecision).toMatchObject({
        decision: "rejected-process-interruption",
        rawResponseSha256: sha256(partialRaw),
        transportError: {
          sanitized: true,
          type: "process-interruption",
        },
      });
      await expect(
        verifyC6FlatSummaryGenerationCaptureRoot({
          expectedReceiptSha256: finalized.receiptSha256,
          outputRoot,
        }),
      ).resolves.toEqual(finalized);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("rejects a fully re-pinned raw response that no longer yields the published output", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-semantic-mutation-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const published =
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => providerResponse({
            id: "req-original",
            output: "Original summary.",
          }),
        });
      const mutatedReceiptSha256 =
        await repinRawResponseWithoutSemanticDependents(
          outputRoot,
          providerResponse({
            id: "req-original",
            output: "Unrelated repinned summary.",
          }).body,
        );

      expect(mutatedReceiptSha256).not.toBe(
        published.receiptSha256,
      );
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: mutatedReceiptSha256,
        outputRoot,
      })).rejects.toThrow(/raw|normaliz|attempt|provider/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("rejects a fully re-pinned semantic raw response beyond the frozen byte cap", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-oversized-repin-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      await materializeC6FlatSummaryGenerationCaptureToRoot({
        ...fixture.input,
        outputRoot,
        transport: async () => providerResponse({
          id: "req-oversized-repin",
          output: "Stable summary.",
        }),
      });
      const original = providerResponse({
        id: "req-oversized-repin",
        output: "Stable summary.",
      }).body;
      const oversized = Buffer.concat([
        Buffer.from(original),
        Buffer.alloc(
          C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES + 1 -
            original.byteLength,
          0x20,
        ),
      ]);
      const receiptSha256 =
        await repinRawResponseWithoutSemanticDependents(
          outputRoot,
          oversized,
        );

      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: receiptSha256,
        outputRoot,
      })).rejects.toThrow(/frozen byte limit/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("rejects a fully re-pinned failure decision that no longer classifies its raw response", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-failure-classification-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const failure = await publishRejectedCapture(
        fixture,
        outputRoot,
        async () => ({
          body: Buffer.from("{invalid-json"),
          status: 200,
        }),
      );
      const repinnedReceiptSha256 =
        await repinFailureRawWithoutDecisionReclassification(
          outputRoot,
          providerResponse({
            id: "req-now-valid",
            output: "Now valid.",
          }).body,
        );
      expect(repinnedReceiptSha256).not.toBe(
        failure.receiptSha256,
      );
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: repinnedReceiptSha256,
        outputRoot,
      })).rejects.toThrow(/decision does not derive/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("rejects fully re-pinned noncanonical claim and terminal paths", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-path-repin-",
    )));
    try {
      const claimRoot = join(parent, "claim-path");
      await materializeC6FlatSummaryGenerationCaptureToRoot({
        ...fixture.input,
        outputRoot: claimRoot,
        transport: async () => providerResponse({
          id: "req-claim-path",
          output: "Stable summary.",
        }),
      });
      const claimReceiptSha256 =
        await repinClaimPlanPath(
          claimRoot,
          "inputs/renamed-plan.json",
        );
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: claimReceiptSha256,
        outputRoot: claimRoot,
      })).rejects.toThrow(/claim bindings|canonical/u);

      const terminalRoot = join(parent, "terminal-path");
      await materializeC6FlatSummaryGenerationCaptureToRoot({
        ...fixture.input,
        outputRoot: terminalRoot,
        transport: async () => providerResponse({
          id: "req-terminal-path",
          output: "Stable summary.",
        }),
      });
      const terminalReceiptSha256 =
        await repinTerminalPath(
          terminalRoot,
          "renamed-terminal.json",
        );
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: terminalReceiptSha256,
        outputRoot: terminalRoot,
      })).rejects.toThrow(/paths are not canonical/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("rejects a fully re-pinned failure that skips the claim prefix", async () => {
    const fixture = generationFixture();
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-prefix-repin-",
    )));
    const outputRoot = join(parent, "capture");
    let requestCount = 0;
    try {
      await publishRejectedCapture(
        fixture,
        outputRoot,
        async () => {
          requestCount += 1;
          return requestCount === 1
            ? providerResponse({
              id: "req-prefix-accepted",
              output: "Accepted prefix.",
            })
            : {
              body: Buffer.from("{invalid-json"),
              status: 200,
            };
        },
      );
      const receiptSha256 =
        await repinFailureWithoutFirstGeneration(outputRoot);
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: receiptSha256,
        outputRoot,
      })).rejects.toThrow(/reachable claim prefix/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("revalidates an accepted generation retained inside an overall failure", async () => {
    const fixture = generationFixture();
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-retained-semantic-",
    )));
    const outputRoot = join(parent, "capture");
    let requestCount = 0;
    try {
      await publishRejectedCapture(
        fixture,
        outputRoot,
        async () => {
          requestCount += 1;
          return requestCount === 1
            ? providerResponse({
              id: "req-retained-semantic",
              output: "Accepted prefix.",
            })
            : {
              body: Buffer.from("{invalid-json"),
              status: 200,
            };
        },
      );
      const receiptSha256 =
        await repinRetainedProviderModel(
          outputRoot,
          "gpt-5.6-terra-mutated",
        );
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: receiptSha256,
        outputRoot,
      })).rejects.toThrow(/provider artifact/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("seals a reachable interruption after a persisted transient retry", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-trailing-retry-",
    )));
    const outputRoot = join(parent, "capture");
    let requestCount = 0;
    try {
      await publishRejectedCapture(
        fixture,
        outputRoot,
        async () => {
          requestCount += 1;
          return requestCount === 1
            ? {
              body: providerResponse({
                id: "req-transient",
                output: "Retry.",
              }).body,
              status: 503,
            }
            : {
              body: Buffer.from("{invalid-json"),
              status: 200,
            };
        },
        async () => undefined,
      );
      const artifactsRoot = join(outputRoot, "artifacts");
      const index = JSON.parse(
        await readFile(
          join(artifactsRoot, "generation-index.json"),
          "utf8",
        ),
      ) as {
        generations: Array<{
          attemptManifest: { path: string };
          attempts: Array<{
            decisionArtifact: { path: string };
            rawResponse: { path: string } | null;
            responseMarker: { path: string } | null;
          }>;
        }>;
      };
      const generation = index.generations[0]!;
      const secondAttempt = generation.attempts[1]!;
      await Promise.all([
        rm(join(outputRoot, "receipt.json")),
        rm(join(artifactsRoot, "asset-lock.json")),
        rm(join(artifactsRoot, "capture-failure-terminal.json")),
        rm(join(artifactsRoot, "generation-index.json")),
        rm(join(artifactsRoot, generation.attemptManifest.path)),
        rm(join(
          artifactsRoot,
          secondAttempt.decisionArtifact.path,
        )),
        ...(secondAttempt.rawResponse === null
          ? []
          : [rm(join(
            artifactsRoot,
            secondAttempt.rawResponse.path,
          ))]),
        ...(secondAttempt.responseMarker === null
          ? []
          : [rm(join(
            artifactsRoot,
            secondAttempt.responseMarker.path,
          ))]),
      ]);

      const finalized = await finalizeC6FlatSummaryGenerationCaptureRoot({
        histories: fixture.input.histories,
        outputRoot,
        planBytes: fixture.input.planBytes,
        planSha256: fixture.input.planSha256,
        summaryPromptBytes: fixture.input.summaryPromptBytes,
        summaryProtocolBytes: fixture.input.summaryProtocolBytes,
      });
      expect(finalized).toMatchObject({
        attemptCount: 1,
        generationCount: 0,
        status: "rejected-provider-capture-evidence-retained",
      });
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("revalidates the complete asset closure after all semantic reads", async () => {
    const fixture = generationFixture({
      oneGeneration: true,
    });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-terminal-revalidation-",
    )));
    const outputRoot = join(parent, "capture");
    try {
      const published =
        await materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => providerResponse({
            id: "req-terminal-revalidation",
            output: "Stable summary.",
          }),
        });
      await expect(verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: published.receiptSha256,
        outputRoot,
        testHooks: {
          beforeTerminalRevalidation: async () => {
            await writeFile(
              join(
                outputRoot,
                "artifacts",
                "inputs",
                "plan.json",
              ),
              "{}\n",
            );
          },
        },
      })).rejects.toThrow(/asset closure changed/u);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("reserves the output before transport and leaves no lock after failure", async () => {
    const fixture = generationFixture({ oneGeneration: true });
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-reservation-",
    )));
    const outputRoot = join(parent, "capture");
    await mkdir(outputRoot);
    let requestCount = 0;
    try {
      await expect(
        materializeC6FlatSummaryGenerationCaptureToRoot({
          ...fixture.input,
          outputRoot,
          transport: async () => {
            requestCount += 1;
            return providerResponse({
              id: "must-not-run",
              output: "Must not run.",
            });
          },
        }),
      ).rejects.toThrow(/output root already exists/u);
      expect(requestCount).toBe(0);
      await expect(readFile(`${outputRoot}.materialize.lock`))
        .rejects.toThrow();
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("loads the exact CLI file closure and publishes through an injected transport", async () => {
    const fixture = generationFixture();
    const parent = await realpath(await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-flat-summary-command-",
    )));
    const historiesRoot = join(parent, "histories");
    const outputRoot = join(parent, "capture");
    const planPath = join(parent, "plan.json");
    const summaryPromptPath = join(parent, "summary-prompt.md");
    const summaryProtocolPath = join(parent, "summary-protocol.json");
    await mkdir(historiesRoot);
    await Promise.all([
      writeFile(planPath, fixture.input.planBytes),
      writeFile(summaryPromptPath, fixture.input.summaryPromptBytes),
      writeFile(summaryProtocolPath, fixture.input.summaryProtocolBytes),
      ...fixture.input.histories.map((history) =>
        writeFile(
          join(historiesRoot, `${history.generationKey}.history`),
          history.bytes,
        )
      ),
    ]);
    let requestCount = 0;
    try {
      const result = await executeC6FlatSummaryGenerationCommand(
        {
          apiToken: API_TOKEN,
          options: {
            historiesRoot,
            mode: "execute",
            outputRoot,
            planPath,
            planSha256: fixture.input.planSha256,
            summaryPromptPath,
            summaryProtocolPath,
          },
        },
        async (request) => {
          requestCount += 1;
          const history = parseRequestBody(request.body)
            .messages[1]!.content;
          return providerResponse({
            id: `req-cli-${history}`,
            output: history === "history-a"
              ? "Summary A."
              : "Summary B.",
          });
        },
      );
      expect(requestCount).toBe(2);
      expect(result.generationCount).toBe(2);
      expect(await verifyC6FlatSummaryGenerationCaptureRoot({
        expectedReceiptSha256: result.receiptSha256,
        outputRoot,
      })).toEqual(result);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });
});

async function publishRejectedCapture(
  fixture: ReturnType<typeof generationFixture>,
  outputRoot: string,
  transport: (
    request: C6FlatSummaryTransportRequest,
  ) => Promise<C6FlatSummaryTransportResponse>,
  sleep?: (milliseconds: number) => Promise<void>,
): Promise<C6FlatSummaryGenerationPublicationError> {
  try {
    await materializeC6FlatSummaryGenerationCaptureToRoot({
      ...fixture.input,
      outputRoot,
      ...(sleep === undefined ? {} : { sleep }),
      transport,
    });
  } catch (error) {
    if (
      error instanceof C6FlatSummaryGenerationPublicationError
    ) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a rejected flat-summary publication");
}

async function repinFailureRawWithoutDecisionReclassification(
  outputRoot: string,
  rawResponseBytes: Uint8Array,
): Promise<string> {
  interface Reference {
    bytes: number;
    path: string;
    sha256: string;
  }
  const artifactsRoot = join(outputRoot, "artifacts");
  const indexPath = join(artifactsRoot, "generation-index.json");
  const receiptPath = join(outputRoot, "receipt.json");
  const receipt = JSON.parse(
    await readFile(receiptPath, "utf8"),
  ) as {
    assetLock: {
      assetRootSha256: string;
      sha256: string;
    };
    generationIndex: Reference;
    terminal: Reference;
  };
  const index = JSON.parse(
    await readFile(indexPath, "utf8"),
  ) as {
    generations: Array<{
      attemptManifest: Reference;
      attempts: Array<{
        decisionArtifact: Reference;
        rawResponse: Reference;
        responseMarker: Reference;
      }>;
    }>;
  };
  const generation = index.generations.at(-1)!;
  const attempt = generation.attempts.at(-1)!;
  await writeFile(
    join(artifactsRoot, attempt.rawResponse.path),
    rawResponseBytes,
  );
  updateReference(attempt.rawResponse, rawResponseBytes);

  const markerPath = join(
    artifactsRoot,
    attempt.responseMarker.path,
  );
  const marker = JSON.parse(
    await readFile(markerPath, "utf8"),
  ) as {
    rawResponse: Reference;
  };
  marker.rawResponse = { ...attempt.rawResponse };
  const markerBytes =
    serializeC6FlatSummaryCanonicalJson(marker);
  await writeFile(markerPath, markerBytes);
  updateReference(attempt.responseMarker, markerBytes);

  const decisionPath = join(
    artifactsRoot,
    attempt.decisionArtifact.path,
  );
  const decision = JSON.parse(
    await readFile(decisionPath, "utf8"),
  ) as {
    rawResponseSha256: string;
  };
  decision.rawResponseSha256 = attempt.rawResponse.sha256;
  const decisionBytes =
    serializeC6FlatSummaryCanonicalJson(decision);
  await writeFile(decisionPath, decisionBytes);
  updateReference(attempt.decisionArtifact, decisionBytes);

  const manifestPath = join(
    artifactsRoot,
    generation.attemptManifest.path,
  );
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as {
    attempts: Array<{ rawResponseSha256: string }>;
  };
  manifest.attempts.at(-1)!.rawResponseSha256 =
    attempt.rawResponse.sha256;
  const manifestBytes =
    serializeC6FlatSummaryCanonicalJson(manifest);
  await writeFile(manifestPath, manifestBytes);
  updateReference(generation.attemptManifest, manifestBytes);

  const indexBytes = Buffer.from(
    `${JSON.stringify(index, null, 2)}\n`,
  );
  await writeFile(indexPath, indexBytes);
  updateReference(receipt.generationIndex, indexBytes);
  const terminalPath = join(
    artifactsRoot,
    receipt.terminal.path,
  );
  const terminal = JSON.parse(
    await readFile(terminalPath, "utf8"),
  ) as {
    generationIndex: Reference;
  };
  terminal.generationIndex = {
    ...receipt.generationIndex,
  };
  const terminalBytes =
    serializeC6FlatSummaryCanonicalJson(terminal);
  await writeFile(terminalPath, terminalBytes);
  updateReference(receipt.terminal, terminalBytes);
  return repinAssetLockAndReceipt(outputRoot, receipt);
}

async function repinClaimPlanPath(
  outputRoot: string,
  nextPath: string,
): Promise<string> {
  const artifactsRoot = join(outputRoot, "artifacts");
  const receipt = JSON.parse(
    await readFile(join(outputRoot, "receipt.json"), "utf8"),
  ) as {
    assetLock: {
      assetRootSha256: string;
      sha256: string;
    };
    plan: {
      bytes: number;
      path: string;
      sha256: string;
    };
  };
  const claimPath = join(artifactsRoot, "capture-claim.json");
  const claim = JSON.parse(
    await readFile(claimPath, "utf8"),
  ) as {
    plan: {
      bytes: number;
      path: string;
      sha256: string;
    };
  };
  await rename(
    join(artifactsRoot, claim.plan.path),
    join(artifactsRoot, nextPath),
  );
  claim.plan.path = nextPath;
  receipt.plan.path = nextPath;
  await writeFile(
    claimPath,
    serializeC6FlatSummaryCanonicalJson(claim),
  );
  return repinAssetLockAndReceipt(outputRoot, receipt);
}

async function repinTerminalPath(
  outputRoot: string,
  nextPath: string,
): Promise<string> {
  const artifactsRoot = join(outputRoot, "artifacts");
  const receipt = JSON.parse(
    await readFile(join(outputRoot, "receipt.json"), "utf8"),
  ) as {
    assetLock: {
      assetRootSha256: string;
      sha256: string;
    };
    terminal: {
      bytes: number;
      path: string;
      sha256: string;
    };
  };
  await rename(
    join(artifactsRoot, receipt.terminal.path),
    join(artifactsRoot, nextPath),
  );
  receipt.terminal.path = nextPath;
  return repinAssetLockAndReceipt(outputRoot, receipt);
}

async function repinFailureWithoutFirstGeneration(
  outputRoot: string,
): Promise<string> {
  interface Reference {
    bytes: number;
    path: string;
    sha256: string;
  }
  const artifactsRoot = join(outputRoot, "artifacts");
  const indexPath = join(artifactsRoot, "generation-index.json");
  const receipt = JSON.parse(
    await readFile(join(outputRoot, "receipt.json"), "utf8"),
  ) as {
    assetLock: {
      assetRootSha256: string;
      sha256: string;
    };
    attemptCount: number;
    generationCount: number;
    generationIndex: Reference;
    terminal: Reference;
  };
  const index = JSON.parse(
    await readFile(indexPath, "utf8"),
  ) as {
    generations: Array<{
      accepted: unknown | null;
      attempts: unknown[];
      generationKey: string;
    }>;
  };
  const removed = index.generations.shift();
  if (removed === undefined) {
    throw new Error("failure prefix mutation needs two generations");
  }
  await rm(
    join(artifactsRoot, "generations", removed.generationKey),
    { recursive: true },
  );
  receipt.attemptCount = index.generations.reduce(
    (count, generation) =>
      count + generation.attempts.length,
    0,
  );
  receipt.generationCount = index.generations.filter(
    ({ accepted }) => accepted !== null,
  ).length;
  const indexBytes = Buffer.from(
    `${JSON.stringify(index, null, 2)}\n`,
  );
  await writeFile(indexPath, indexBytes);
  updateReference(receipt.generationIndex, indexBytes);

  const terminalPath = join(
    artifactsRoot,
    receipt.terminal.path,
  );
  const terminal = JSON.parse(
    await readFile(terminalPath, "utf8"),
  ) as {
    attemptCount: number;
    completedGenerationCount: number;
    generationIndex: Reference;
  };
  terminal.attemptCount = receipt.attemptCount;
  terminal.completedGenerationCount =
    receipt.generationCount;
  terminal.generationIndex = {
    ...receipt.generationIndex,
  };
  const terminalBytes =
    serializeC6FlatSummaryCanonicalJson(terminal);
  await writeFile(terminalPath, terminalBytes);
  updateReference(receipt.terminal, terminalBytes);
  return repinAssetLockAndReceipt(outputRoot, receipt);
}

async function repinRetainedProviderModel(
  outputRoot: string,
  model: string,
): Promise<string> {
  interface Reference {
    bytes: number;
    path: string;
    sha256: string;
  }
  const artifactsRoot = join(outputRoot, "artifacts");
  const indexPath = join(artifactsRoot, "generation-index.json");
  const receipt = JSON.parse(
    await readFile(join(outputRoot, "receipt.json"), "utf8"),
  ) as {
    assetLock: {
      assetRootSha256: string;
      sha256: string;
    };
    generationIndex: Reference;
    terminal: Reference;
  };
  const index = JSON.parse(
    await readFile(indexPath, "utf8"),
  ) as {
    generations: Array<{
      accepted: {
        providerArtifact: Reference;
      } | null;
    }>;
  };
  const accepted = index.generations.find(
    (generation) => generation.accepted !== null,
  )?.accepted;
  if (accepted === null || accepted === undefined) {
    throw new Error("retained provider mutation needs one accepted generation");
  }
  const providerPath = join(
    artifactsRoot,
    accepted.providerArtifact.path,
  );
  const providerArtifact = JSON.parse(
    await readFile(providerPath, "utf8"),
  ) as {
    model: string;
  };
  providerArtifact.model = model;
  const providerBytes =
    serializeC6FlatSummaryCanonicalJson(providerArtifact);
  await writeFile(providerPath, providerBytes);
  updateReference(accepted.providerArtifact, providerBytes);

  const indexBytes = Buffer.from(
    `${JSON.stringify(index, null, 2)}\n`,
  );
  await writeFile(indexPath, indexBytes);
  updateReference(receipt.generationIndex, indexBytes);
  const terminalPath = join(
    artifactsRoot,
    receipt.terminal.path,
  );
  const terminal = JSON.parse(
    await readFile(terminalPath, "utf8"),
  ) as {
    generationIndex: Reference;
  };
  terminal.generationIndex = {
    ...receipt.generationIndex,
  };
  const terminalBytes =
    serializeC6FlatSummaryCanonicalJson(terminal);
  await writeFile(terminalPath, terminalBytes);
  updateReference(receipt.terminal, terminalBytes);
  return repinAssetLockAndReceipt(outputRoot, receipt);
}

async function repinAssetLockAndReceipt(
  outputRoot: string,
  receipt: {
    assetLock: {
      assetRootSha256: string;
      sha256: string;
    };
  },
): Promise<string> {
  const artifactsRoot = join(outputRoot, "artifacts");
  const assetLock = await buildC6AssetLock(artifactsRoot);
  const assetLockBytes = Buffer.from(
    serializeC6AssetLock(assetLock),
  );
  await writeFile(
    join(artifactsRoot, "asset-lock.json"),
    assetLockBytes,
  );
  receipt.assetLock.assetRootSha256 =
    assetLock.assetRootSha256;
  receipt.assetLock.sha256 = sha256(assetLockBytes);
  const receiptBytes = Buffer.from(
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await writeFile(join(outputRoot, "receipt.json"), receiptBytes);
  return sha256(receiptBytes);
}

function generationFixture(options: {
  oneGeneration?: boolean;
  onlyNoHistory?: boolean;
  summaryPrompt?: string;
} = {}) {
  const summaryPromptBytes = Buffer.from(
    options.summaryPrompt ?? SUMMARY_PROMPT,
  );
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

async function repinRawResponseWithoutSemanticDependents(
  outputRoot: string,
  rawResponseBytes: Uint8Array,
): Promise<string> {
  interface Reference {
    bytes: number;
    path: string;
    sha256: string;
  }
  const artifactsRoot = join(outputRoot, "artifacts");
  const indexPath = join(artifactsRoot, "generation-index.json");
  const receiptPath = join(outputRoot, "receipt.json");
  const index = JSON.parse(
    await readFile(indexPath, "utf8"),
  ) as {
    generations: Array<{
      accepted: {
        providerArtifact: Reference;
        rawToNormalizedIndex: Reference;
      };
      attemptManifest: Reference;
      attempts: Array<{
        decisionArtifact: Reference;
        rawResponse: Reference;
        responseMarker: Reference;
      }>;
    }>;
  };
  const generation = index.generations[0]!;
  const attempt = generation.attempts[0]!;
  const rawReference = attempt.rawResponse;
  await writeFile(
    join(artifactsRoot, rawReference.path),
    rawResponseBytes,
  );
  updateReference(rawReference, rawResponseBytes);

  const responseMarkerPath = join(
    artifactsRoot,
    attempt.responseMarker.path,
  );
  const responseMarker = JSON.parse(
    await readFile(responseMarkerPath, "utf8"),
  ) as {
    rawResponse: Reference;
  };
  updateReference(responseMarker.rawResponse, rawResponseBytes);
  const responseMarkerBytes =
    serializeC6FlatSummaryCanonicalJson(responseMarker);
  await writeFile(responseMarkerPath, responseMarkerBytes);
  updateReference(
    attempt.responseMarker,
    responseMarkerBytes,
  );

  const decisionPath = join(
    artifactsRoot,
    attempt.decisionArtifact.path,
  );
  const decision = JSON.parse(
    await readFile(decisionPath, "utf8"),
  ) as {
    rawResponseSha256: string;
  };
  decision.rawResponseSha256 = sha256(rawResponseBytes);
  const decisionBytes =
    serializeC6FlatSummaryCanonicalJson(decision);
  await writeFile(decisionPath, decisionBytes);
  updateReference(attempt.decisionArtifact, decisionBytes);

  const attemptManifestPath = join(
    artifactsRoot,
    generation.attemptManifest.path,
  );
  const attemptManifest = JSON.parse(
    await readFile(attemptManifestPath, "utf8"),
  ) as {
    attempts: Array<{ rawResponseSha256: string }>;
  };
  attemptManifest.attempts[0]!.rawResponseSha256 =
    sha256(rawResponseBytes);
  const attemptManifestBytes =
    serializeC6FlatSummaryCanonicalJson(attemptManifest);
  await writeFile(attemptManifestPath, attemptManifestBytes);
  updateReference(
    generation.attemptManifest,
    attemptManifestBytes,
  );

  const normalizationPath = join(
    artifactsRoot,
    generation.accepted.rawToNormalizedIndex.path,
  );
  const normalization = JSON.parse(
    await readFile(normalizationPath, "utf8"),
  ) as {
    rawResponseSha256: string;
  };
  normalization.rawResponseSha256 = sha256(rawResponseBytes);
  const normalizationBytes =
    serializeC6FlatSummaryCanonicalJson(normalization);
  await writeFile(normalizationPath, normalizationBytes);
  updateReference(
    generation.accepted.rawToNormalizedIndex,
    normalizationBytes,
  );

  const providerArtifactPath = join(
    artifactsRoot,
    generation.accepted.providerArtifact.path,
  );
  const providerArtifact = JSON.parse(
    await readFile(providerArtifactPath, "utf8"),
  ) as {
    attemptManifestSha256: string;
    rawResponseSha256: string;
    rawToNormalizedIndexSha256: string;
  };
  providerArtifact.attemptManifestSha256 =
    generation.attemptManifest.sha256;
  providerArtifact.rawResponseSha256 =
    sha256(rawResponseBytes);
  providerArtifact.rawToNormalizedIndexSha256 =
    generation.accepted.rawToNormalizedIndex.sha256;
  const providerArtifactBytes =
    serializeC6FlatSummaryCanonicalJson(providerArtifact);
  await writeFile(
    providerArtifactPath,
    providerArtifactBytes,
  );
  updateReference(
    generation.accepted.providerArtifact,
    providerArtifactBytes,
  );

  const receipt = JSON.parse(
    await readFile(receiptPath, "utf8"),
  ) as {
    assetLock: {
      assetRootSha256: string;
      sha256: string;
    };
    corpus: Reference;
    generationIndex: Reference;
    terminal: Reference;
  };
  const corpusPath = join(artifactsRoot, receipt.corpus.path);
  const corpus = JSON.parse(
    await readFile(corpusPath, "utf8"),
  ) as {
    generationReceipts: Array<{
      providerArtifactSha256: string;
    }>;
  };
  corpus.generationReceipts[0]!.providerArtifactSha256 =
    generation.accepted.providerArtifact.sha256;
  const corpusBytes = Buffer.from(
    `${JSON.stringify(corpus, null, 2)}\n`,
  );
  await writeFile(corpusPath, corpusBytes);
  updateReference(receipt.corpus, corpusBytes);

  const indexBytes = Buffer.from(
    `${JSON.stringify(index, null, 2)}\n`,
  );
  await writeFile(indexPath, indexBytes);
  updateReference(receipt.generationIndex, indexBytes);

  const terminalPath = join(
    artifactsRoot,
    receipt.terminal.path,
  );
  const terminal = JSON.parse(
    await readFile(terminalPath, "utf8"),
  ) as {
    corpus: Reference;
    generationIndex: Reference;
  };
  terminal.corpus = { ...receipt.corpus };
  terminal.generationIndex = {
    ...receipt.generationIndex,
  };
  const terminalBytes =
    serializeC6FlatSummaryCanonicalJson(terminal);
  await writeFile(terminalPath, terminalBytes);
  updateReference(receipt.terminal, terminalBytes);

  const assetLock = await buildC6AssetLock(artifactsRoot);
  const assetLockBytes = Buffer.from(
    serializeC6AssetLock(assetLock),
  );
  await writeFile(
    join(artifactsRoot, "asset-lock.json"),
    assetLockBytes,
  );
  receipt.assetLock.assetRootSha256 =
    assetLock.assetRootSha256;
  receipt.assetLock.sha256 = sha256(assetLockBytes);
  const receiptBytes = Buffer.from(
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await writeFile(receiptPath, receiptBytes);
  return sha256(receiptBytes);
}

function updateReference(
  reference: {
    bytes: number;
    sha256: string;
  },
  bytes: Uint8Array,
): void {
  reference.bytes = bytes.byteLength;
  reference.sha256 = sha256(bytes);
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
