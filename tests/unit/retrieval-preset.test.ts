import { describe, expect, it } from "bun:test";
import type { GoodMemorySemanticCandidatesConfig } from "../../src/api/contracts";
import {
  HASHED_LEXICAL_EMBEDDING_BRAND,
  RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
  RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
  RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES,
  RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
  RECOMMENDED_SEMANTIC_CANDIDATES_TOP_K,
  resolveGoodMemoryRetrievalRuntime,
} from "../../src/api/retrievalPreset";

// retrieval.preset "recommended" expands to the retrieval+extraction side of
// generalized RRF retrieval plus optional semantic candidates and
// conversational write-time extraction. Preset unset must be a byte-identical
// passthrough; explicit user fields always win; provider-free mode remains
// deterministic.

const fakeEmbeddingAdapter = { embed: async () => [[0, 1]] };

function resolve(input: Partial<Parameters<typeof resolveGoodMemoryRetrievalRuntime>[0]> = {}) {
  return resolveGoodMemoryRetrievalRuntime({
    assistedExtractorModelConfigured: false,
    embeddingEnabled: false,
    ...input,
  });
}

describe("resolveGoodMemoryRetrievalRuntime without a preset", () => {
  it("passes retrieval config through by reference", () => {
    const semanticCandidates: GoodMemorySemanticCandidatesConfig = {
      minRelativeScore: 0.8,
      topK: 32,
    };
    const resolved = resolve({
      retrieval: { bm25Ranking: true, semanticCandidates },
    });

    // Reference identity is the byte-identity proof: nothing is cloned or
    // normalized on the non-preset path.
    expect(resolved.retrieval.semanticCandidates).toBe(semanticCandidates);
    expect(resolved.retrieval.bm25Ranking).toBe(true);
    expect(resolved.retrieval.autoStrategyBias).toBeUndefined();
    expect(resolved.retrieval.preset).toBeUndefined();
  });

  it("mirrors the constructor's conversational predicate for extraction mode", () => {
    expect(resolve().extractionMode).toBe("default");
    expect(
      resolve({
        extraction: {
          apiKey: "k",
          model: "gpt-5.5",
          provider: "openai",
        },
      }).extractionMode,
    ).toBe("default");
    expect(
      resolve({
        extraction: {
          apiKey: "k",
          mode: "conversational",
          model: "gpt-5.5",
          provider: "openai",
        },
      }).extractionMode,
    ).toBe("conversational");
  });

  it("never throws without embedding when no preset is requested", () => {
    expect(() =>
      resolve({ retrieval: { semanticCandidates: { topK: 4 } } }),
    ).not.toThrow();
  });
});

describe("resolveGoodMemoryRetrievalRuntime with preset recommended", () => {
  it("expands to generalized fusion when the user set nothing", () => {
    const resolved = resolve({
      embeddingEnabled: true,
      retrieval: { preset: "recommended" },
    });

    expect(resolved.retrieval.semanticCandidates).toEqual({
      topK: RECOMMENDED_SEMANTIC_CANDIDATES_TOP_K,
    });
    expect(resolved.retrieval.generalizedFusion).toEqual({
      maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
    });
    // maxAdditions belongs to the legacy semantic-union path. Generalized fusion
    // owns its own bounded candidate budget.
    expect(resolved.retrieval.semanticCandidates?.maxAdditions).toBeUndefined();
    expect(resolved.retrieval.autoStrategyBias).toBe("hybrid");
    expect(resolved.retrieval.bm25Ranking).toBeUndefined();
    expect(resolved.retrieval.preset).toEqual({
      active: true,
      extraction: "unavailable",
      requested: "recommended",
    });
    expect(resolved.providerRerankingStrategy).toBeUndefined();
    expect(resolved.retrieval.rerankGeneralizedFusion).toBeUndefined();
  });

  it("preserves an explicit fusion-channel ablation in the experimental preset", () => {
    const channels = ["lexical", "dense", "entity"] as const;
    const resolved = resolve({
      retrieval: {
        generalizedFusionChannels: channels,
        preset: "recommended",
      },
    });

    expect(resolved.retrieval.generalizedFusion).toEqual({
      channels,
      maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
    });
  });

  it("preserves an explicit dynamic-budget floor in the experimental preset", () => {
    const resolved = resolve({
      retrieval: {
        generalizedFusionMinRelativeStrength: 0.35,
        preset: "recommended",
      },
    });

    expect(resolved.retrieval.generalizedFusion).toEqual({
      maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
      minRelativeStrength: 0.35,
    });

    const reranking = resolve({
      providerRerankerConfigured: true,
      retrieval: {
        generalizedFusionMinRelativeStrength: 0.35,
        preset: "recommended",
      },
    });
    expect(reranking.retrieval.rerankGeneralizedFusion).toEqual({
      maxCandidates: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
      minRelativeStrength: 0.35,
    });
  });

  it("preserves the explicit entity PageRank opt-in in the experimental preset", () => {
    const resolved = resolve({
      retrieval: {
        generalizedFusionEntityPageRank: true,
        preset: "recommended",
      },
    });

    expect(resolved.retrieval.generalizedFusion).toEqual({
      entityPageRank: true,
      maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
    });

    const reranking = resolve({
      providerRerankerConfigured: true,
      retrieval: {
        generalizedFusionEntityPageRank: true,
        preset: "recommended",
      },
    });
    expect(reranking.retrieval.rerankGeneralizedFusion).toEqual({
      entityPageRank: true,
      maxCandidates: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
    });
  });

  it("widens only the first-party provider reranker lane", () => {
    const resolved = resolve({
      embeddingEnabled: true,
      providerRerankerConfigured: true,
      retrieval: { preset: "recommended" },
    });

    expect(resolved.providerRerankingStrategy).toBe("listwise");
    expect(resolved.retrieval.rerankGeneralizedFusion).toEqual({
      maxCandidates: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
    });

    const nonPreset = resolve({ providerRerankerConfigured: true });
    expect(nonPreset.providerRerankingStrategy).toBe("pointwise");
    expect(nonPreset.retrieval.rerankGeneralizedFusion).toBeUndefined();
  });

  it("merges per key with explicit user fields winning", () => {
    const resolved = resolve({
      embeddingEnabled: true,
      retrieval: {
        preset: "recommended",
        semanticCandidates: { maxAdditions: 4, minRelativeScore: 0.8 },
      },
    });
    expect(resolved.retrieval.semanticCandidates).toEqual({
      maxAdditions: 4,
      minRelativeScore: 0.8,
      topK: RECOMMENDED_SEMANTIC_CANDIDATES_TOP_K,
    });

    const userTopK = resolve({
      embeddingEnabled: true,
      retrieval: {
        preset: "recommended",
        semanticCandidates: { topK: 24 },
      },
    });
    expect(userTopK.retrieval.semanticCandidates?.topK).toBe(24);
  });

  it("does not enable the separate additive bm25Ranking slot by default", () => {
    const resolved = resolve({
      embeddingEnabled: true,
      retrieval: { bm25Ranking: true, preset: "recommended" },
    });
    expect(resolved.retrieval.bm25Ranking).toBe(true);

    const unset = resolve({
      embeddingEnabled: true,
      retrieval: { preset: "recommended" },
    });
    expect(unset.retrieval.bm25Ranking).toBeUndefined();
  });

  it("flips extraction to conversational only when a model resolves and mode is unset", () => {
    // (c) model resolved (provider config or env), mode unset ⇒ flip.
    const flipped = resolve({
      assistedExtractorModelConfigured: true,
      embeddingEnabled: true,
      retrieval: { preset: "recommended" },
    });
    expect(flipped.extractionMode).toBe("conversational");
    expect(flipped.retrieval.preset?.extraction).toBe("conversational");

    // (a) explicit mode always wins.
    const explicitDefault = resolve({
      assistedExtractorModelConfigured: true,
      embeddingEnabled: true,
      extraction: {
        apiKey: "k",
        mode: "default",
        model: "gpt-5.5",
        provider: "openai",
      },
      retrieval: { preset: "recommended" },
    });
    expect(explicitDefault.extractionMode).toBe("default");
    expect(explicitDefault.retrieval.preset?.extraction).toBe("kept_existing");

    const explicitConversational = resolve({
      assistedExtractorModelConfigured: true,
      embeddingEnabled: true,
      extraction: {
        apiKey: "k",
        mode: "conversational",
        model: "gpt-5.5",
        provider: "openai",
      },
      retrieval: { preset: "recommended" },
    });
    expect(explicitConversational.extractionMode).toBe("conversational");
    expect(explicitConversational.retrieval.preset?.extraction).toBe(
      "conversational",
    );

    // (b) injected opaque extractor adapter: mode only affects provider-built
    // extractors, so it stays untouched.
    const injected = resolve({
      adapters: {
        assistedExtractor: { extract: async () => [] } as never,
        embeddingAdapter: fakeEmbeddingAdapter,
      },
      assistedExtractorModelConfigured: true,
      embeddingEnabled: true,
      retrieval: { preset: "recommended" },
    });
    expect(injected.extractionMode).toBe("default");
    expect(injected.retrieval.preset?.extraction).toBe("kept_existing");

    // (d) no extractor at all ⇒ unavailable, and it does NOT throw: write-time
    // infrastructure is orthogonal to retrieval.
    const unavailable = resolve({
      embeddingEnabled: true,
      retrieval: { preset: "recommended" },
    });
    expect(unavailable.retrieval.preset?.extraction).toBe("unavailable");
  });

  it("keeps generalized fusion active without a resolvable embedding", () => {
    const resolved = resolve({ retrieval: { preset: "recommended" } });
    expect(resolved.retrieval.generalizedFusion).toEqual({
      maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
      maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
    });
    expect(resolved.retrieval.semanticCandidates).toBeUndefined();
    expect(resolved.retrieval.autoStrategyBias).toBe("hybrid");
  });

  it("rejects the hashed-lexical local adapter by brand", () => {
    const hashedAdapter = Object.assign(
      { embed: async () => [[0, 1]] },
      { [HASHED_LEXICAL_EMBEDDING_BRAND]: true },
    );
    expect(() =>
      resolve({
        adapters: { embeddingAdapter: hashedAdapter },
        embeddingEnabled: true,
        retrieval: { preset: "recommended" },
      }),
    ).toThrow(/hashed-lexical/);
  });
});
