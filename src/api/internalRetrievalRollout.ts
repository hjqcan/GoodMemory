import type {
  GoodMemory,
  RecallInput,
  RecallResult,
} from "./contracts";
import type {
  LanguageQueryAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import type { RecallRouterStrategy } from "../recall/router";
import {
  assertRetrievalPromotionAuthorizationAllowsDefaultRollout,
  type RetrievalStrategyRolloutConfig,
} from "../governance/retrievalInternalRollout";

interface InternalRetrievalRolloutState {
  assistedRecallRouterEnabled: boolean;
  languageService: LanguageService;
  now?: () => Date;
  rollout?: RetrievalStrategyRolloutConfig;
}

const INTERNAL_RECALL_LANGUAGE_ANALYSIS = Symbol(
  "goodmemory.internalRecallLanguageAnalysis",
);

interface InternalRecallLanguageAnalysis {
  analysis: LanguageQueryAnalysis;
  context: ResolvedLanguageContext;
  query: string;
}

type AnalyzedRecallInput = RecallInput & {
  [INTERNAL_RECALL_LANGUAGE_ANALYSIS]?: InternalRecallLanguageAnalysis;
};

export function readInternalRecallLanguageAnalysis(
  input: RecallInput,
): InternalRecallLanguageAnalysis | undefined {
  return (input as AnalyzedRecallInput)[INTERNAL_RECALL_LANGUAGE_ANALYSIS];
}

function resolveRequestedStrategy(
  input: RecallInput,
): RecallRouterStrategy {
  return input.strategy ?? "auto";
}

function buildPromotedSummary(input: {
  requestedStrategy: "auto" | RecallInput["strategy"];
}): string {
  const requestedLabel = input.requestedStrategy ?? "auto";
  return `internal promote rollout elevated ${requestedLabel} recall to llm-assisted for an authorized high-value query while preserving the rules-first floor.`;
}

function analyzeHighValueRecallQuery(input: {
  languageService: LanguageService;
  locale?: string;
  query: string;
}): InternalRecallLanguageAnalysis & { highValue: boolean } {
  const context = input.languageService.resolveFromText({
    locale: input.locale,
    text: input.query,
  });
  const analysis = input.languageService.analyzeQuery(input.query, context);
  return {
    analysis,
    context,
    highValue: analysis.continuation || analysis.blocker ||
      analysis.openLoop || analysis.referenceSeeking || analysis.actionDriving,
    query: input.query,
  };
}

function shouldApplyInternalRetrievalPromotion(input: {
  languageService: LanguageService;
  recallInput: RecallInput;
  rollout?: RetrievalStrategyRolloutConfig;
}): {
  analysis?: InternalRecallLanguageAnalysis;
  promotionApplied: boolean;
} {
  const rollout = input.rollout;
  if (!rollout) {
    return { promotionApplied: false };
  }

  const mode = rollout.mode ?? "promote";
  const promotedStrategy = rollout.promotedStrategy ?? "rules-only";
  if (mode !== "promote" || promotedStrategy !== "llm-assisted") {
    return { promotionApplied: false };
  }

  if (input.recallInput.strategy && input.recallInput.strategy !== "auto") {
    return { promotionApplied: false };
  }

  if ((input.recallInput.retrievalProfile ?? "general_chat") === "coding_agent") {
    return { promotionApplied: true };
  }

  const analysis = analyzeHighValueRecallQuery({
    languageService: input.languageService,
    locale: input.recallInput.locale,
    query: input.recallInput.query,
  });
  return {
    analysis,
    promotionApplied: analysis.highValue,
  };
}

function patchPromotedRecallResult(input: {
  originalInput: RecallInput;
  result: RecallResult;
}): RecallResult {
  const requestedStrategy = resolveRequestedStrategy(input.originalInput);

  input.result.metadata.routingDecision.strategyExplanation = {
    ...input.result.metadata.routingDecision.strategyExplanation,
    requestedStrategy,
    summary: buildPromotedSummary({
      requestedStrategy,
    }),
  };

  return input.result;
}

export function wrapInternalRetrievalRolloutMemory(
  memory: GoodMemory,
  state: InternalRetrievalRolloutState,
): GoodMemory {
  if (!state.rollout) {
    return memory;
  }

  const mode = state.rollout.mode ?? "promote";
  const promotedStrategy = state.rollout.promotedStrategy ?? "rules-only";
  if (mode === "promote" && promotedStrategy === "llm-assisted") {
    if (!state.assistedRecallRouterEnabled) {
      throw new Error(
        "Internal retrieval rollout promoting llm-assisted requires assisted recall router support.",
      );
    }

    assertRetrievalPromotionAuthorizationAllowsDefaultRollout({
      now: state.now?.().toISOString(),
      rollout: state.rollout,
    });
  }

  const languageService = state.languageService;

  return {
    jobs: memory.jobs,
    runtime: memory.runtime,
    async buildContext(input) {
      return memory.buildContext(input);
    },
    async deleteAllMemory(input) {
      return memory.deleteAllMemory(input);
    },
    async importMemory(input) {
      return memory.importMemory(input);
    },
    async exportMemory(input) {
      return memory.exportMemory(input);
    },
    async feedback(input) {
      return memory.feedback(input);
    },
    async forget(input) {
      return memory.forget(input);
    },
    async recall(input) {
      const promotion = shouldApplyInternalRetrievalPromotion({
        languageService,
        recallInput: input,
        rollout: state.rollout,
      });

      if (promotion.promotionApplied) {
        assertRetrievalPromotionAuthorizationAllowsDefaultRollout({
          now: state.now?.().toISOString(),
          rollout: state.rollout,
        });
      }

      const effectiveInput = promotion.promotionApplied
        ? {
            ...input,
            strategy: "llm-assisted" as const,
          }
        : input;
      const analyzedInput: AnalyzedRecallInput = promotion.analysis
        ? {
            ...effectiveInput,
            [INTERNAL_RECALL_LANGUAGE_ANALYSIS]: promotion.analysis,
          }
        : effectiveInput;
      const result = await memory.recall(analyzedInput);

      if (!promotion.promotionApplied) {
        return result;
      }

      return patchPromotedRecallResult({
        originalInput: input,
        result,
      });
    },
    async remember(input) {
      return memory.remember(input);
    },
    async reviseMemory(input) {
      return memory.reviseMemory(input);
    },
    async runMaintenance(input) {
      return memory.runMaintenance(input);
    },
  };
}
