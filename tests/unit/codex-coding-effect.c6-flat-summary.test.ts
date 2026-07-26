import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  c4RepositoryIdForUrl,
} from "../../scripts/codex-coding-effect/c4-controlled-dataset";
import type {
  C6FlatSummaryCorpus,
  C6FlatSummaryCorpusExpectation,
  C6FlatSummaryProtocol,
} from "../../scripts/codex-coding-effect/c6-flat-summary";
import {
  buildC6FlatSummaryArtifact,
  buildC6InjectionBudgetReceipt,
  C6_FLAT_SUMMARY_GENERATION_POLICY,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  C6_NO_HISTORY_CONTROL,
  countC6InjectedTokens,
  validateC6FlatSummaryArtifact,
  validateC6InjectionBudgetReceipt,
  verifyC6FlatSummaryCorpusCompleteness,
} from "../../scripts/codex-coding-effect/c6-flat-summary";
import {
  loadCodexCodingEffectDataset,
} from "../../scripts/codex-coding-effect/dataset";

const SOURCE_ROOT = "fixtures/codex-coding-effect/c4-controlled-pilot";
const SUMMARY_PROMPT = "Summarize only the supplied prior history.";
const PRICING_SHA = "c".repeat(64);
const PRICING = {
  cachedInputUsdPerMillionTokens: 0.1,
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 4,
};

describe("Codex coding-effect C6 flat-summary control", () => {
  it("freezes the same estimated-token counter used by GoodMemory", async () => {
    expect(C6_INJECTION_TOKEN_COUNTER_ID).toBe(
      "goodmemory-estimate-text-tokens-v1",
    );
    expect(C6_INJECTION_TOKEN_COUNTER_SHA256).toBe(
      "53627b6b61ecd56dff9511dab714e1610d9c899a2a7c388d9baa13a62ae5bc5b",
    );
    expect(sha256(await Bun.file("src/tokenEstimator.ts").text())).toBe(
      C6_INJECTION_TOKEN_COUNTER_SHA256,
    );
    expect(countC6InjectedTokens("Aé")).toBe(2);
    expect(countC6InjectedTokens("abcd")).toBe(1);
  });

  it("binds one audited stage summary to the same history and injection budget as GoodMemory", async () => {
    const input = await validInput({
      output: "Keep the repository convention and avoid the failed approach.",
      outputTokens: 12,
      usage: {
        cachedInputTokens: 20,
        inputTokens: 800,
        outputTokens: 12,
      },
    });
    const artifact = await buildC6FlatSummaryArtifact(input);

    expect(artifact).toMatchObject({
      assetRootSha256: input.leakageContext.assetRootSha256,
      datasetManifestSha256:
        input.leakageContext.datasetManifestSha256,
      episodeId: input.episodeId,
      estimatedCostUsd: 0.00083,
      generationPolicy: C6_FLAT_SUMMARY_GENERATION_POLICY,
      historySourceSha256: input.summaryHistorySourceSha256,
      injectedTokenCount: countC6InjectedTokens(input.output),
      leakageStatus: "accepted",
      maxInjectedTokens: 512,
      model: "gpt-5.6-terra",
      outputTokens: 12,
      pricingSnapshotSha256: PRICING_SHA,
      promptSha256: sha256(SUMMARY_PROMPT),
      provider: "gurkiai-openai-compatible",
      schemaVersion: 3,
      stageId: input.stageId,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    });
    expect(artifact.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.leakageAuditSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(validateC6FlatSummaryArtifact(
      artifact,
      protocol(),
      expectedBinding(input),
      input.leakageContext,
    )).resolves.toBeUndefined();
  });

  it("counts each arm's final injected text with one frozen counter", () => {
    const finalText = "x".repeat(384);
    const historySourceSha256 = sha256("nonempty-history");
    const goodMemory = buildC6InjectionBudgetReceipt({
      arm: "goodmemory-installed",
      compositionSha256: C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256,
      injectedText: finalText,
      injectionMode: "content-injection",
      maxInjectedTokens: 96,
    });
    const flatSummary = buildC6InjectionBudgetReceipt({
      arm: "flat-summary",
      compositionSha256: C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256,
      injectedText: finalText,
      injectionMode: "content-injection",
      maxInjectedTokens: 96,
    });

    expect(goodMemory.injectedTokenCount).toBe(96);
    expect(flatSummary.injectedTokenCount).toBe(96);
    expect(() => buildC6InjectionBudgetReceipt({
      arm: "flat-summary",
      compositionSha256: C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256,
      injectedText: `wrapper:${finalText}`,
      injectionMode: "content-injection",
      maxInjectedTokens: 96,
    })).toThrow("C6 final injected text exceeds its token budget");
    expect(() => validateC6InjectionBudgetReceipt(
      {
        ...flatSummary,
        injectedTokenCount: 95,
      },
      {
        arm: "flat-summary",
        compositionSha256: C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
        historySourceSha256,
        injectedText: finalText,
        injectionMode: "content-injection",
        maxInjectedTokens: 96,
      },
    )).toThrow("C6 injection budget receipt is invalid");
  });

  it("builds explicit zero-injection receipts for both no-history arms", () => {
    const historySourceSha256 = sha256("");
    const compositionSha256 = sha256(
      "no-history-zero-additional-context-v1",
    );
    for (const arm of [
      "flat-summary",
      "goodmemory-installed",
    ] as const) {
      const receipt = buildC6InjectionBudgetReceipt({
        arm,
        compositionSha256,
        historySourceSha256,
        injectedText: "",
        injectionMode: "no-history-zero-injection",
        maxInjectedTokens: 96,
      });

      expect(receipt).toEqual({
        arm,
        compositionSha256,
        contentSha256: historySourceSha256,
        historySourceSha256,
        injectedTokenCount: 0,
        injectionMode: "no-history-zero-injection",
        maxInjectedTokens: 96,
        schemaVersion: 2,
        tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
        tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
      });
      expect(() => validateC6InjectionBudgetReceipt(receipt, {
        arm,
        compositionSha256,
        historySourceSha256,
        injectedText: "",
        injectionMode: "no-history-zero-injection",
        maxInjectedTokens: 96,
      })).not.toThrow();
    }
    expect(() => buildC6InjectionBudgetReceipt({
      arm: "flat-summary",
      compositionSha256,
      historySourceSha256: sha256("nonempty-history"),
      injectedText: "",
      injectionMode: "no-history-zero-injection",
      maxInjectedTokens: 96,
    })).toThrow("C6 final injected text exceeds its token budget");
    expect(() => buildC6InjectionBudgetReceipt({
      arm: "flat-summary",
      compositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256,
      injectedText: "unexpected context",
      injectionMode: "content-injection",
      maxInjectedTokens: 96,
    })).toThrow("C6 final injected text exceeds its token budget");
  });

  it("forbids a provider-generated summary artifact for empty history", async () => {
    const input = await validInput();
    await expect(buildC6FlatSummaryArtifact({
      ...input,
      goodMemoryHistorySourceSha256: sha256(""),
      summaryHistorySourceSha256: sha256(""),
    })).rejects.toThrow(
      "C6 no-history control forbids a flat-summary provider artifact",
    );
  });

  it("rejects unequal history, unequal budgets, and over-budget injection", async () => {
    const input = await validInput();
    await expect(buildC6FlatSummaryArtifact({
      ...input,
      summaryHistorySourceSha256: "b".repeat(64),
    })).rejects.toThrow(
      "flat-summary history source hash must match GoodMemory",
    );
    await expect(buildC6FlatSummaryArtifact({
      ...input,
      summaryMaxInjectedTokens: 256,
    })).rejects.toThrow("flat-summary token budget must match GoodMemory");
    await expect(buildC6FlatSummaryArtifact({
      ...input,
      output: "x".repeat(2_049),
    })).rejects.toThrow("C6 flat summary exceeds its injected token budget");
  });

  it("rejects invalid pricing, usage, or post-freeze protocol drift", async () => {
    const input = await validInput();
    await expect(buildC6FlatSummaryArtifact({
      ...input,
      pricing: {
        ...PRICING,
        outputUsdPerMillionTokens: Number.NaN,
      },
    })).rejects.toThrow("C6 flat summary pricing is invalid");
    await expect(buildC6FlatSummaryArtifact({
      ...input,
      stageId: undefined as unknown as string,
    })).rejects.toThrow(
      "C6 flat summary identity values must be non-empty",
    );

    const artifact = await buildC6FlatSummaryArtifact(input);
    await expect(validateC6FlatSummaryArtifact(
      {
        ...artifact,
        estimatedCostUsd: -1,
      },
      protocol(),
      expectedBinding(input),
      input.leakageContext,
    )).rejects.toThrow("C6 flat summary artifact is invalid");
    await expect(validateC6FlatSummaryArtifact(
      {
        ...artifact,
        injectedTokenCount: artifact.injectedTokenCount - 1,
      },
      protocol(),
      expectedBinding(input),
      input.leakageContext,
    )).rejects.toThrow("C6 flat summary artifact is invalid");
    await expect(validateC6FlatSummaryArtifact(
      artifact,
      {
        ...protocol(),
        model: "different-model",
      },
      expectedBinding(input),
      input.leakageContext,
    )).rejects.toThrow(
      "C6 flat summary does not match the frozen protocol",
    );
  });

  it("rejects a summary rebound to another episode, stage, history, or leakage receipt", async () => {
    const input = await validInput();
    const artifact = await buildC6FlatSummaryArtifact(input);
    await expect(validateC6FlatSummaryArtifact(
      {
        ...artifact,
        episodeId: "different-episode",
      },
      protocol(),
      expectedBinding(input),
      input.leakageContext,
    )).rejects.toThrow("C6 flat summary does not match its candidate episode");
    await expect(validateC6FlatSummaryArtifact(
      {
        ...artifact,
        stageId: input.leakageContext.dataset.episodes[0]!.stages[1]!.id,
      },
      protocol(),
      expectedBinding(input),
      input.leakageContext,
    )).rejects.toThrow("C6 flat summary does not match its candidate stage");
    await expect(validateC6FlatSummaryArtifact(
      {
        ...artifact,
        historySourceSha256: "b".repeat(64),
      },
      protocol(),
      expectedBinding(input),
      input.leakageContext,
    )).rejects.toThrow("C6 flat summary does not match its candidate stage");
    await expect(validateC6FlatSummaryArtifact(
      {
        ...artifact,
        leakageAuditSha256: "d".repeat(64),
      },
      protocol(),
      expectedBinding(input),
      input.leakageContext,
    )).rejects.toThrow("C6 flat summary leakage audit does not match");

    const substituteContext = {
      ...input.leakageContext,
      assetRootSha256: sha256("substitute-asset-root"),
      datasetManifestSha256: sha256("substitute-manifest"),
    };
    const substituteArtifact = await buildC6FlatSummaryArtifact({
      ...input,
      leakageContext: substituteContext,
    });
    await expect(validateC6FlatSummaryArtifact(
      substituteArtifact,
      protocol(),
      expectedBinding(input),
      substituteContext,
    )).rejects.toThrow(
      "C6 flat summary does not match the candidate asset bindings",
    );
  });

  it("exact-set verifies one structural generation receipt and every per-seed stage binding", () => {
    const expectation = corpusExpectation();
    const corpus = validCorpus(expectation);

    expect(verifyC6FlatSummaryCorpusCompleteness(
      corpus,
      expectation,
    )).toEqual({
      codexRunReady: false,
      generationReceipts: {
        required: 2,
        structurallyVerified: 2,
      },
      providerAuthenticityVerified: false,
      schemaVersion: 1,
      stageBindingReceipts: {
        required: 9,
        structurallyVerified: 9,
      },
      status: "structural-preflight-only",
    });

    const sharedGenerationKey =
      expectation.stageBindings[0]!.generationKey;
    const sharedOutputHashes = corpus.stageBindingReceipts
      .filter((receipt) => receipt.generationKey === sharedGenerationKey)
      .map((receipt) => receipt.outputSha256);
    expect(sharedOutputHashes).toHaveLength(6);
    expect(new Set(sharedOutputHashes)).toEqual(new Set([
      sha256(`output:${sharedGenerationKey}`),
    ]));
  });

  it("rejects missing, extra, or duplicate generation and stage-binding receipts", () => {
    const expectation = corpusExpectation();
    const corpus = validCorpus(expectation);
    const extraGenerationKey = sha256("extra-generation");

    for (const mutation of [
      {
        ...corpus,
        generationReceipts: corpus.generationReceipts.slice(1),
      },
      {
        ...corpus,
        generationReceipts: [
          ...corpus.generationReceipts,
          {
            generationKey: extraGenerationKey,
            historySourceSha256: sha256("extra-history"),
            outputSha256: sha256("extra-output"),
            providerArtifactSha256: sha256("extra-provider-artifact"),
          },
        ],
      },
      {
        ...corpus,
        generationReceipts: [
          ...corpus.generationReceipts,
          structuredClone(corpus.generationReceipts[0]!),
        ],
      },
    ] satisfies C6FlatSummaryCorpus[]) {
      expect(() => verifyC6FlatSummaryCorpusCompleteness(
        mutation,
        expectation,
      )).toThrow(/generation receipt (exact set|duplicates)/u);
    }

    for (const mutation of [
      {
        ...corpus,
        stageBindingReceipts: corpus.stageBindingReceipts.slice(1),
      },
      {
        ...corpus,
        stageBindingReceipts: [
          ...corpus.stageBindingReceipts,
          {
            episodeId: "extra-episode",
            generationKey: corpus.generationReceipts[0]!.generationKey,
            outputSha256: corpus.generationReceipts[0]!.outputSha256,
            seed: 101,
            stageId: "stage-2",
          },
        ],
      },
      {
        ...corpus,
        stageBindingReceipts: [
          ...corpus.stageBindingReceipts,
          structuredClone(corpus.stageBindingReceipts[0]!),
        ],
      },
    ] satisfies C6FlatSummaryCorpus[]) {
      expect(() => verifyC6FlatSummaryCorpusCompleteness(
        mutation,
        expectation,
      )).toThrow(/stage-binding receipt (exact set|duplicates)/u);
    }
  });

  it("forbids no-history provider artifacts or bindings and rejects per-seed output drift", () => {
    const expectation = corpusExpectation();
    const corpus = validCorpus(expectation);
    const noHistoryGenerationKey = sha256("no-history-generation");
    expect(() => verifyC6FlatSummaryCorpusCompleteness({
      ...corpus,
      generationReceipts: [
        ...corpus.generationReceipts,
        {
          generationKey: noHistoryGenerationKey,
          historySourceSha256: C6_NO_HISTORY_CONTROL.historySourceSha256,
          outputSha256: sha256("forbidden-output"),
          providerArtifactSha256: sha256("forbidden-provider-artifact"),
        },
      ],
    }, expectation)).toThrow(
      "C6 no-history control forbids a flat-summary generation receipt",
    );
    expect(() => verifyC6FlatSummaryCorpusCompleteness({
      ...corpus,
      stageBindingReceipts: [
        ...corpus.stageBindingReceipts,
        {
          episodeId: "episode-no-history",
          generationKey: corpus.generationReceipts[0]!.generationKey,
          outputSha256: corpus.generationReceipts[0]!.outputSha256,
          seed: 101,
          stageId: "stage-1",
        },
      ],
    }, expectation)).toThrow(
      "C6 no-history control forbids a flat-summary stage binding",
    );

    const rebound = structuredClone(corpus);
    rebound.stageBindingReceipts[0]!.outputSha256 =
      sha256("seed-specific-regeneration");
    expect(() => verifyC6FlatSummaryCorpusCompleteness(
      rebound,
      expectation,
    )).toThrow(
      "C6 flat-summary stage bindings must reuse the generation output hash",
    );

    const wrongGeneration = structuredClone(corpus);
    wrongGeneration.stageBindingReceipts[0]!.generationKey =
      corpus.generationReceipts[1]!.generationKey;
    wrongGeneration.stageBindingReceipts[0]!.outputSha256 =
      corpus.generationReceipts[1]!.outputSha256;
    expect(() => verifyC6FlatSummaryCorpusCompleteness(
      wrongGeneration,
      expectation,
    )).toThrow(
      "C6 flat-summary stage binding does not match its generation key",
    );
  });

  it("rejects any corpus schema that claims provider authenticity", () => {
    const expectation = corpusExpectation();
    const corpus = validCorpus(expectation);

    expect(() => verifyC6FlatSummaryCorpusCompleteness({
      ...corpus,
      providerAuthenticityVerified: true as false,
    }, expectation)).toThrow(
      "C6 flat-summary corpus is structural preflight only",
    );
    expect(() => verifyC6FlatSummaryCorpusCompleteness({
      ...corpus,
      status: "authenticated" as "structural-preflight-only",
    }, expectation)).toThrow(
      "C6 flat-summary corpus is structural preflight only",
    );
  });
});

function corpusExpectation(): C6FlatSummaryCorpusExpectation {
  const firstGenerationKey = sha256("generation-a");
  const secondGenerationKey = sha256("generation-b");
  return {
    generationBindings: [
      {
        generationKey: firstGenerationKey,
        historySourceSha256: sha256("history-a"),
      },
      {
        generationKey: secondGenerationKey,
        historySourceSha256: sha256("history-b"),
      },
    ],
    noHistoryStageBindings: [
      {
        episodeId: "episode-no-history",
        stageId: "stage-1",
      },
    ],
    seeds: [101, 202, 303],
    stageBindings: [
      {
        episodeId: "episode-a",
        generationKey: firstGenerationKey,
        stageId: "stage-2",
      },
      {
        episodeId: "episode-b",
        generationKey: firstGenerationKey,
        stageId: "stage-2",
      },
      {
        episodeId: "episode-b",
        generationKey: secondGenerationKey,
        stageId: "stage-3",
      },
    ],
  };
}

function validCorpus(
  expectation: C6FlatSummaryCorpusExpectation,
): C6FlatSummaryCorpus {
  const generationReceipts = expectation.generationBindings.map((binding) => ({
    ...binding,
    outputSha256: sha256(`output:${binding.generationKey}`),
    providerArtifactSha256:
      sha256(`provider-artifact:${binding.generationKey}`),
  }));
  const outputSha256ByGenerationKey = new Map(
    generationReceipts.map((receipt) => [
      receipt.generationKey,
      receipt.outputSha256,
    ]),
  );
  return {
    generationReceipts,
    providerAuthenticityVerified: false,
    schemaVersion: 1,
    stageBindingReceipts: expectation.stageBindings.flatMap((binding) =>
      expectation.seeds.map((seed) => ({
        ...binding,
        outputSha256:
          outputSha256ByGenerationKey.get(binding.generationKey)!,
        seed,
      }))
    ),
    status: "structural-preflight-only",
  };
}

function expectedBinding(
  input: Awaited<ReturnType<typeof validInput>>,
) {
  return {
    assetRootSha256: input.leakageContext.assetRootSha256,
    datasetManifestSha256:
      input.leakageContext.datasetManifestSha256,
    episodeId: input.episodeId,
    historySourceSha256: input.summaryHistorySourceSha256,
    stageId: input.stageId,
  };
}

function protocol(): C6FlatSummaryProtocol {
  return {
    generationPolicy: C6_FLAT_SUMMARY_GENERATION_POLICY,
    maxInjectedTokens: 512,
    model: "gpt-5.6-terra",
    noHistoryControl: structuredClone(C6_NO_HISTORY_CONTROL),
    pricing: PRICING,
    pricingSnapshotSha256: PRICING_SHA,
    promptSha256: sha256(SUMMARY_PROMPT),
    provider: "gurkiai-openai-compatible",
    schemaVersion: 3 as const,
    tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
  };
}

async function validInput(overrides: {
  output?: string;
  outputTokens?: number;
  usage?: {
    cachedInputTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
} = {}) {
  const loaded = await loadCodexCodingEffectDataset(SOURCE_ROOT);
  if (loaded.dataset.schemaVersion !== 2) {
    throw new Error("test fixture requires dataset schema version 2");
  }
  const episode = structuredClone(loaded.dataset.episodes[0]!);
  if (episode.prehistory.source !== "frozen-artifact") {
    throw new Error("test fixture requires frozen prehistory");
  }
  const {
    prehistory,
    ...episodeWithoutHistory
  } = episode;
  const stageScopedEpisode = {
    ...episodeWithoutHistory,
    historyPolicy: "stage-scoped-sealed-prefix-v1" as const,
    repository: {
      ...episodeWithoutHistory.repository,
      assetPath: `repositories/${
        c4RepositoryIdForUrl(episodeWithoutHistory.repository.url)
      }`,
    },
    stages: episodeWithoutHistory.stages.map((stage) => ({
      ...stage,
      history: structuredClone(prehistory),
    })),
  };
  const dataset = {
    datasetId: loaded.dataset.datasetId,
    episodes: [stageScopedEpisode],
    schemaVersion: 3 as const,
  };
  const stage = stageScopedEpisode.stages[0]!;
  const outputTokens = overrides.outputTokens ?? 8;
  return {
    episodeId: stageScopedEpisode.id,
    goodMemoryHistorySourceSha256: stage.history.sha256,
    goodMemoryMaxInjectedTokens: 512,
    leakageContext: {
      assetRootSha256: sha256("asset-root"),
      dataset,
      datasetManifestSha256: sha256(JSON.stringify(dataset)),
      datasetRoot: SOURCE_ROOT,
      summaryPrompt: SUMMARY_PROMPT,
      summaryPromptSha256: sha256(SUMMARY_PROMPT),
    },
    model: "gpt-5.6-terra",
    output: overrides.output ?? "Keep the repository convention.",
    outputTokens,
    pricing: PRICING,
    pricingSnapshotSha256: PRICING_SHA,
    promptSha256: sha256(SUMMARY_PROMPT),
    provider: "gurkiai-openai-compatible",
    stageId: stage.id,
    summaryHistorySourceSha256: stage.history.sha256,
    summaryMaxInjectedTokens: 512,
    tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    usage: overrides.usage ?? {
      cachedInputTokens: 20,
      inputTokens: 800,
      outputTokens,
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
