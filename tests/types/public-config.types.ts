import type {
  GoodMemoryConfig,
  GoodMemoryTraceSink,
  NamedRememberProfileExtractor,
  ReviseMemoryInput,
  RememberInput,
  RememberProfile,
} from "../../src";
import {
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createSpanishLanguagePack,
  rememberRules,
} from "../../src";

const defaultConfig: GoodMemoryConfig = {};

const minimalConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
};

// The recommended retrieval preset is a first-class config literal; explicit
// semanticCandidates fields compose with it (user keys win at resolution).
const recommendedPresetConfig: GoodMemoryConfig = {
  retrieval: {
    preset: "recommended",
    semanticCandidates: { maxAdditions: 4 },
  },
  storage: { provider: "memory" },
};
void recommendedPresetConfig;

const testingConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  testing: {
    now: () => new Date(),
  },
};

const languageConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  language: {
    defaultLocale: "zh-CN",
    detection: "auto",
    detector: () => "zh-CN",
    detectorVersion: "host-locale-router-v1",
  },
};

const languagePackConfig: GoodMemoryConfig = {
  language: {
    defaultLocale: "ja-JP",
    packs: [
      createJapaneseLanguagePack(),
      createKoreanLanguagePack(),
      createFrenchLanguagePack(),
      createSpanishLanguagePack(),
    ],
  },
  storage: { provider: "memory" },
};

const embeddingAdapterConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  adapters: {
    embeddingAdapter: {
      async embed(texts) {
        return texts.map(() => [1, 0, 0]);
      },
    },
  },
};

const assistedExtractorConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  adapters: {
    assistedExtractor: {
      async extract() {
        return {
          candidates: [],
          ignoredMessageCount: 0,
        };
      },
    },
  },
};

const traceSink: GoodMemoryTraceSink = {
  emit(span) {
    void span.traceId;
    void span.scopeDigest.userIdHash;
    void span.redaction.containsRawUserText;
  },
};

const observabilityConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  observability: {
    scopeDigestSecret: "trusted-public-config-secret",
    traceSink,
  },
};

const providerFacadeConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  providers: {
    embedding: {
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "embedding-key",
      baseURL: "https://embedding-provider.example/v1",
    },
    extraction: {
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      apiKey: "extraction-key",
    },
  },
};

const lifeCoachProfile: RememberProfile = {
  id: "life-coach",
  when: { agentId: "life-coach" },
  extends: "default",
  rules: [
    rememberRules.fact(/my top priority this quarter is (.+)/i, {
      id: "life-goal-priority",
      category: "goal",
      tags: ["life_coach", "long_term_goal"],
      content: ({ match }) => match[1] ?? "",
    }),
    rememberRules.preference(/please coach me with (.+)/i, {
      id: "life-coaching-style",
      category: "coaching_style",
      value: ({ match }) => match[1] ?? "",
    }),
    rememberRules.predicate({
      id: "life-relationship-context",
      when: ({ message }) => message.content.includes("my sister"),
      kindHint: "fact",
      content: ({ message }) => message.content,
      metadata: {
        category: "relationship_dynamic",
        tags: ["life_coach", "relationship"],
      },
    }),
    rememberRules.mapper({
      id: "life-direct-goal",
      map: (input) => [
        {
          id: "life-direct-goal-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: input.messages[0]?.content ?? "",
          sourceMessageIndex: 0,
          sourceRole: input.messages[0]?.role ?? "user",
          metadata: {
            category: "goal",
            attributes: { source: "host_mapper" },
          },
        },
      ],
    }),
  ],
  extractors: [
    {
      id: "life-coach-values-extractor",
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
    },
  ],
  assistantOutputs: {
    mode: "confirmed_or_verified_only",
  },
};

const namedProfileExtractor: NamedRememberProfileExtractor = {
  id: "life-coach-domain-extractor",
  extractor: {
    async extract() {
      return {
        candidates: [],
        ignoredMessageCount: 0,
      };
    },
  },
};

const rememberConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  remember: {
    preset: "default",
    profiles: [lifeCoachProfile],
  },
};

const annotatedRememberInput: RememberInput = {
  scope: { userId: "user-1", agentId: "life-coach" },
  messages: [
    { role: "assistant", content: "A weekly review cadence may help." },
    { role: "user", content: "Yes, let's use that." },
  ],
  annotations: [
    {
      messageIndex: 0,
      remember: "always",
      kindHint: "fact",
      confirmed: true,
      metadataPatch: {
        category: "habit",
        tags: ["life_coach", "weekly_review"],
        attributes: {
          cadence: "weekly",
        },
      },
    },
  ],
};

const targetedRevisionInput: ReviseMemoryInput = {
  scope: { userId: "user-1", sessionId: "session-1" },
  target: { memoryId: "mem-1" },
  revision: {
    content: "The current editor preference is Cursor.",
  },
  reason: "user_correction",
  evidence: {
    source: "user_message",
    message: "Actually use Cursor.",
  },
  idempotencyKey: "user-1:session-1:correction-1",
};

void defaultConfig;
void minimalConfig;
void testingConfig;
void languageConfig;
void languagePackConfig;
void embeddingAdapterConfig;
void assistedExtractorConfig;
void observabilityConfig;
void providerFacadeConfig;
void rememberConfig;
void annotatedRememberInput;
void namedProfileExtractor;
void targetedRevisionInput;

const invalidQueryRevisionTarget: ReviseMemoryInput = {
  scope: { userId: "user-1" },
  // @ts-expect-error Phase 38 targeted revision only accepts memoryId targets.
  target: { query: "editor preference" },
  revision: { content: "Use Cursor." },
  reason: "user_correction",
  idempotencyKey: "correction-query-target",
};

const invalidEmbeddingConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  // @ts-expect-error GoodMemory core config no longer accepts embedding settings.
  embedding: { provider: "openai", model: "text-embedding-3-small" },
};

const invalidLLMConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  // @ts-expect-error GoodMemory core config no longer accepts llm settings.
  llm: { provider: "anthropic", model: "claude-sonnet" },
};

const invalidRouterConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  // @ts-expect-error GoodMemory core config does not expose router tuning.
  router: { strategy: "rules-only" },
};

const invalidProviderRouterConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  providers: {
    // @ts-expect-error Provider facade exposes embedding and extraction only.
    router: { provider: "openai", model: "gpt-4o-mini", apiKey: "router-key" },
  },
};

const invalidEmbeddingProviderConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  providers: {
    embedding: {
      // @ts-expect-error Embedding provider facade only supports OpenAI embeddings.
      provider: "anthropic",
      model: "text-embedding-3-small",
      apiKey: "embedding-key",
    },
  },
};

const invalidEvolutionConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  // @ts-expect-error GoodMemory core config does not expose evolution internals.
  evolution: { enabled: true },
};

const invalidStrategyRolloutConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  // @ts-expect-error GoodMemory core config does not expose eval rollout controls.
  strategyRollout: { family: "retrieval", mode: "assist" },
};

const invalidPromotionGateConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  // @ts-expect-error GoodMemory core config does not expose promotion-gate runtime controls.
  promotionGate: { decision: "accepted" },
};

const invalidEvalConfig: GoodMemoryConfig = {
  storage: { provider: "memory" },
  // @ts-expect-error GoodMemory core config does not expose eval-only configuration.
  eval: { outputDir: "reports/eval" },
};

void invalidEmbeddingConfig;
void invalidLLMConfig;
void invalidRouterConfig;
void invalidProviderRouterConfig;
void invalidEmbeddingProviderConfig;
void invalidEvolutionConfig;
void invalidStrategyRolloutConfig;
void invalidPromotionGateConfig;
void invalidEvalConfig;
void invalidQueryRevisionTarget;
