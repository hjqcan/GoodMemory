import type {
  GoodMemoryConfig,
  GoodMemoryExtractionProviderConfig,
  GoodMemoryRetrievalConfig,
  GoodMemoryRetrievalPresetId,
  GoodMemorySemanticCandidatesConfig,
} from "./contracts";
import type { RecallGeneralizedFusionConfig } from "../recall/engine";

// Pure expansion of retrieval.preset "recommended" (mirrors the
// remember.preset style: a named string that selects config, resolved in one
// unit-testable module). The preset enables provider-free multi-granular
// lexical/entity fusion, adds a neural dense channel at topK 16 when one
// resolves, selects conversational write-time extraction when a model resolves,
// and biases auto routing to hybrid. Answer-side prompting remains an
// application concern and is not covered here.

export const RECOMMENDED_SEMANTIC_CANDIDATES_TOP_K = 16;
export const RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES = 8;
export const RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS = 10;
export const RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES = 32;
export const RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS = 32;

// Brand carried by createLocalEmbeddingAdapter(): hashed-lexical vectors are
// not semantic, so the preset must reject them — structural typing makes a
// documentation-only ban unenforceable.
export const HASHED_LEXICAL_EMBEDDING_BRAND: unique symbol = Symbol.for(
  "goodmemory.embedding.hashed-lexical",
);

export interface GoodMemoryRetrievalPresetStatus {
  requested: GoodMemoryRetrievalPresetId;
  // The generalized local channel is always constructible; providers only add
  // optional channels.
  active: true;
  // Whether the write-time half of the profile engaged: "conversational"
  // (flipped or explicitly set), "kept_existing" (explicit default mode or an
  // injected opaque extractor), or "unavailable" (no extractor resolves).
  extraction: "conversational" | "kept_existing" | "unavailable";
}

export interface ResolvedGoodMemoryRetrieval {
  autoStrategyBias?: "hybrid";
  bm25Ranking?: boolean;
  longRecordAdmission?: boolean;
  generalizedFusion?: RecallGeneralizedFusionConfig;
  preset?: GoodMemoryRetrievalPresetStatus;
  rerankGeneralizedFusion?: RecallGeneralizedFusionConfig;
  semanticCandidates?: GoodMemorySemanticCandidatesConfig;
}

export interface ResolvedGoodMemoryRetrievalRuntime {
  extractionMode: "conversational" | "default";
  providerRerankingStrategy?: "listwise" | "pointwise";
  retrieval: ResolvedGoodMemoryRetrieval;
}

export function resolveGoodMemoryRetrievalRuntime(input: {
  adapters?: GoodMemoryConfig["adapters"];
  // Boolean(assistedExtractorModelConfig): a model resolved from provider
  // config OR env — the flip condition must not key on the config object
  // alone, because env-only extraction has no mode knob.
  assistedExtractorModelConfigured: boolean;
  embeddingEnabled: boolean;
  extraction?: GoodMemoryExtractionProviderConfig;
  providerRerankerConfigured?: boolean;
  retrieval?: GoodMemoryRetrievalConfig;
}): ResolvedGoodMemoryRetrievalRuntime {
  const explicitMode = input.extraction?.mode;
  const baselineExtractionMode: "conversational" | "default" =
    explicitMode === "conversational" ? "conversational" : "default";

  if (input.retrieval?.preset === undefined) {
    // Passthrough by reference: the non-preset path must stay byte-identical,
    // including the constructor's exact conversational predicate.
    return {
      extractionMode: baselineExtractionMode,
      ...(input.providerRerankerConfigured
        ? { providerRerankingStrategy: "pointwise" as const }
        : {}),
      retrieval: {
        bm25Ranking: input.retrieval?.bm25Ranking,
        longRecordAdmission: input.retrieval?.longRecordAdmission,
        semanticCandidates: input.retrieval?.semanticCandidates,
      },
    };
  }

  const embeddingAdapter = input.adapters?.embeddingAdapter as
    | (Record<PropertyKey, unknown> & { embed: unknown })
    | undefined;
  if (embeddingAdapter?.[HASHED_LEXICAL_EMBEDDING_BRAND] === true) {
    throw new Error(
      'retrieval.preset "recommended" accepts either no embedding adapter or a neural semantic adapter; createLocalEmbeddingAdapter() produces hashed-lexical vectors and would duplicate the preset\'s lexical channel as fake dense evidence. Remove that adapter, configure a neural endpoint (GOODMEMORY_EMBEDDING_* or providers.embedding), or remove retrieval.preset.',
    );
  }

  const userCandidates = input.retrieval.semanticCandidates;
  const semanticCandidates: GoodMemorySemanticCandidatesConfig | undefined =
    input.embeddingEnabled
      ? {
          ...userCandidates,
          topK: userCandidates?.topK ?? RECOMMENDED_SEMANTIC_CANDIDATES_TOP_K,
        }
      : userCandidates;
  const generalizedFusion: RecallGeneralizedFusionConfig = {
    ...(input.retrieval.generalizedFusionChannels
      ? { channels: input.retrieval.generalizedFusionChannels }
      : {}),
    ...(input.retrieval.generalizedFusionMinRelativeStrength !== undefined
      ? {
          minRelativeStrength:
            input.retrieval.generalizedFusionMinRelativeStrength,
        }
      : {}),
    ...(input.retrieval.generalizedFusionEntityPageRank !== undefined
      ? { entityPageRank: input.retrieval.generalizedFusionEntityPageRank }
      : {}),
    maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
    maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
  };
  const rerankGeneralizedFusion: RecallGeneralizedFusionConfig | undefined =
    input.providerRerankerConfigured || input.adapters?.reranker
      ? {
          ...(input.retrieval.generalizedFusionChannels
            ? { channels: input.retrieval.generalizedFusionChannels }
            : {}),
          ...(input.retrieval.generalizedFusionMinRelativeStrength !== undefined
            ? {
                minRelativeStrength:
                  input.retrieval.generalizedFusionMinRelativeStrength,
              }
            : {}),
          ...(input.retrieval.generalizedFusionEntityPageRank !== undefined
            ? {
                entityPageRank:
                  input.retrieval.generalizedFusionEntityPageRank,
              }
            : {}),
          maxCandidates:
            RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES,
          maxTotalFacts: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
        }
      : undefined;

  let extractionMode = baselineExtractionMode;
  let extractionStatus: GoodMemoryRetrievalPresetStatus["extraction"];
  if (explicitMode !== undefined) {
    extractionStatus =
      explicitMode === "conversational" ? "conversational" : "kept_existing";
  } else if (input.adapters?.assistedExtractor) {
    // Opaque injected extractor: mode only affects provider-built extractors.
    extractionStatus = "kept_existing";
  } else if (input.assistedExtractorModelConfigured) {
    extractionMode = "conversational";
    extractionStatus = "conversational";
  } else {
    extractionStatus = "unavailable";
  }

  return {
    extractionMode,
    ...(input.providerRerankerConfigured
      ? { providerRerankingStrategy: "listwise" as const }
      : {}),
    retrieval: {
      autoStrategyBias: "hybrid",
      bm25Ranking: input.retrieval.bm25Ranking,
      longRecordAdmission: input.retrieval.longRecordAdmission,
      generalizedFusion,
      preset: {
        active: true,
        extraction: extractionStatus,
        requested: "recommended",
      },
      ...(rerankGeneralizedFusion ? { rerankGeneralizedFusion } : {}),
      semanticCandidates,
    },
  };
}
