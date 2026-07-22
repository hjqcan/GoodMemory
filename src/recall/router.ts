import { createLanguageService } from "../language";
import type { LanguageQueryAnalysis, LanguageService } from "../language";

export type RetrievalProfile = "general_chat" | "coding_agent";
export type RecallRouterStrategy =
  | "rules-only"
  | "hybrid"
  | "llm-assisted"
  | "auto";

export type RecallSlot =
  | "role"
  | "focus"
  | "blocker"
  | "open_loop"
  | "reference"
  | "project_state_support"
  | "runtime_continuity"
  | "feedback_guidance";

export type RecallSource =
  | "profile"
  | "feedback"
  | "fact"
  | "evidence"
  | "session_archive"
  | "episode"
  | "working_memory"
  | "session_journal";

export interface RecallRuntimeAvailability {
  hasWorkingMemory: boolean;
  hasJournal: boolean;
}

export interface RecallRouterAvailability {
  semanticSearch: boolean;
  llmRouting: boolean;
}

export interface RouterStrategyExplanation {
  requestedStrategy: RecallRouterStrategy;
  resolvedStrategy: RecallRouterStrategy;
  fallbackReason?:
    | "semantic_search_unavailable"
    | "llm_routing_unavailable";
  // Non-fatal degradation signals for consumers: present (and non-empty) only
  // when recall silently ran below the configured/requested intent — e.g. a
  // recommended preset (or an explicit hybrid request) resolved to the
  // rules-only lexical floor because semantic search was unavailable at
  // runtime (no embedding endpoint or no vector index). Machine codes, mirroring
  // the ReviseMemoryResult.warnings convention.
  warnings?: string[];
  // Human-readable warning text for agent-facing surfaces that should not force
  // integrators to reverse-map the machine warning code.
  warningMessages?: string[];
  summary: string;
  hardFloor: "lexical_runtime_procedural_priors";
  semanticTieBreaking: boolean;
  llmRefinement: boolean;
}

export interface RoutingDecision {
  retrievalProfile: RetrievalProfile;
  intent: "general_assistance" | "task_continuation";
  strategy: RecallRouterStrategy;
  strategyExplanation: RouterStrategyExplanation;
  sourcePriorities: RecallSource[];
  requestedSlots: RecallSlot[];
  supportSlots: RecallSlot[];
  actionDriving: boolean;
  referenceSeeking: boolean;
  continuation: boolean;
}

export interface RecallRoutingInput {
  retrievalProfile?: RetrievalProfile;
  strategy?: RecallRouterStrategy;
  // Set by retrieval.preset resolution (never a public per-call knob): biases
  // "auto" to hybrid whenever semantic search is available, so the semantic
  // candidate union fires without an explicit per-call strategy.
  autoStrategyBias?: "hybrid";
  availability?: Partial<RecallRouterAvailability>;
  query: string;
  runtime: RecallRuntimeAvailability;
  locale?: string;
  language?: LanguageService;
  queryAnalysis?: LanguageQueryAnalysis;
}

interface AutoRouterSignals {
  retrievalProfile: RetrievalProfile;
  requestedSlots: RecallSlot[];
  supportSlots: RecallSlot[];
  continuation: boolean;
  referenceSeeking: boolean;
  actionDriving: boolean;
}

const DEFAULT_LANGUAGE = createLanguageService();
export const SEMANTIC_RECALL_INACTIVE_WARNING = "semantic_recall_inactive";
export const SEMANTIC_RECALL_INACTIVE_WARNING_MESSAGE =
  "semantic recall inactive — set strategy:hybrid + RETRIEVAL_PRESET";

export function resolveRecallRoutingWarningMessages(input: {
  existingMessages?: readonly string[];
  warnings?: readonly string[];
}): string[] {
  const messages = [...(input.existingMessages ?? [])];
  for (const warning of input.warnings ?? []) {
    if (
      warning === SEMANTIC_RECALL_INACTIVE_WARNING &&
      !messages.includes(SEMANTIC_RECALL_INACTIVE_WARNING_MESSAGE)
    ) {
      messages.push(SEMANTIC_RECALL_INACTIVE_WARNING_MESSAGE);
    }
  }

  return messages;
}

export function resolveRetrievalProfile(
  profile?: RetrievalProfile,
): RetrievalProfile {
  return profile ?? "general_chat";
}

export function resolveRouterStrategy(input: {
  strategy?: RecallRouterStrategy;
  autoStrategyBias?: "hybrid";
  availability?: Partial<RecallRouterAvailability>;
  autoSignals?: AutoRouterSignals;
}): RouterStrategyExplanation {
  const requestedStrategy = input.strategy ?? "auto";
  const semanticSearchAvailable = input.availability?.semanticSearch === true;
  const llmRoutingAvailable = input.availability?.llmRouting === true;

  if (requestedStrategy === "auto") {
    const signalHybrid = Boolean(
      input.autoSignals &&
        (
          input.autoSignals.retrievalProfile === "coding_agent" ||
          input.autoSignals.continuation ||
          input.autoSignals.referenceSeeking ||
          input.autoSignals.actionDriving ||
          input.autoSignals.requestedSlots.some((slot) =>
            slot === "blocker" || slot === "open_loop" || slot === "reference"
          ) ||
          input.autoSignals.supportSlots.includes("project_state_support")
        ),
    );
    const shouldUseHybrid =
      semanticSearchAvailable &&
      (input.autoStrategyBias === "hybrid" || signalHybrid);

    if (shouldUseHybrid) {
      return {
        requestedStrategy,
        resolvedStrategy: "hybrid",
        // Signal-driven hybrid keeps its summary verbatim (pinned by tests);
        // the bias-only path carries its own attribution.
        summary: signalHybrid
          ? "auto routing enabled hybrid recall because the query needs continuation, references, or action-driving semantic support while keeping rules-first priorities as the hard floor."
          : "auto routing enabled hybrid recall because the recommended retrieval preset biases auto routing to hybrid whenever semantic search is available, keeping rules-first priorities as the hard floor.",
        hardFloor: "lexical_runtime_procedural_priors",
        semanticTieBreaking: true,
        llmRefinement: false,
      };
    }

    return {
      requestedStrategy,
      resolvedStrategy: "rules-only",
      // The preset asked for hybrid (autoStrategyBias) but semantic search is
      // unavailable at runtime, so recall silently ran the lexical floor —
      // flag it. A plain auto→rules-only with no bias is the correct floor,
      // not a degradation, so it carries no warning.
      ...(input.autoStrategyBias === "hybrid"
        ? {
            warningMessages: [SEMANTIC_RECALL_INACTIVE_WARNING_MESSAGE],
            warnings: [SEMANTIC_RECALL_INACTIVE_WARNING],
          }
        : {}),
      summary: semanticSearchAvailable
        ? "auto routing kept deterministic rules-only recall because the query is profile/procedural/general assistance and does not need semantic tie-breaking."
        : "auto routing kept deterministic rules-only recall because semantic search is unavailable.",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: false,
      llmRefinement: false,
    };
  }

  if (requestedStrategy === "rules-only") {
    return {
      requestedStrategy,
      resolvedStrategy: "rules-only",
      summary:
        "rules-only default keeps lexical, runtime, and procedural priors as the hard floor.",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: false,
      llmRefinement: false,
    };
  }

  if (requestedStrategy === "hybrid") {
    if (semanticSearchAvailable) {
      return {
        requestedStrategy,
        resolvedStrategy: "hybrid",
        summary:
          "hybrid routing keeps rules-first priorities primary and only enables semantic tie-breaking around them.",
        hardFloor: "lexical_runtime_procedural_priors",
        semanticTieBreaking: true,
        llmRefinement: false,
      };
    }

    return {
      requestedStrategy,
      resolvedStrategy: "rules-only",
      fallbackReason: "semantic_search_unavailable",
      warningMessages: [SEMANTIC_RECALL_INACTIVE_WARNING_MESSAGE],
      warnings: [SEMANTIC_RECALL_INACTIVE_WARNING],
      summary:
        "hybrid routing was requested but semantic search is unavailable, so routing falls back to deterministic rules-only behavior.",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: false,
      llmRefinement: false,
    };
  }

  if (llmRoutingAvailable) {
    return {
      requestedStrategy,
      resolvedStrategy: "llm-assisted",
      summary:
        "llm-assisted routing keeps rules-first priorities primary and only allows model refinement after the deterministic floor is established.",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: semanticSearchAvailable,
      llmRefinement: true,
    };
  }

  if (semanticSearchAvailable) {
    return {
      requestedStrategy,
      resolvedStrategy: "hybrid",
      fallbackReason: "llm_routing_unavailable",
      summary:
        "llm-assisted routing was requested but model refinement is unavailable, so routing falls back to hybrid semantic tie-breaking.",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: true,
      llmRefinement: false,
    };
  }

  return {
    requestedStrategy,
    resolvedStrategy: "rules-only",
    fallbackReason: "llm_routing_unavailable",
    summary:
      "llm-assisted routing was requested but provider-backed assistance is unavailable, so routing falls back to deterministic rules-only behavior.",
    hardFloor: "lexical_runtime_procedural_priors",
    semanticTieBreaking: false,
    llmRefinement: false,
  };
}

export function planRecall(input: RecallRoutingInput): RoutingDecision {
  const retrievalProfile = resolveRetrievalProfile(input.retrievalProfile);
  const language = input.language ?? DEFAULT_LANGUAGE;
  const locale =
    input.locale ??
    language.resolveFromText({
      text: input.query,
    }).locale;
  const queryAnalysis = input.queryAnalysis ??
    language.analyzeQuery(input.query, locale);
  const continuationIntent =
    retrievalProfile === "coding_agent" ||
    queryAnalysis.continuation;
  const roleQuery = queryAnalysis.role;
  const focusQuery = queryAnalysis.focus;
  const blockerQuery = queryAnalysis.blocker;
  const openLoopQuery = queryAnalysis.openLoop;
  const referenceSeeking = queryAnalysis.referenceSeeking;
  const actionDriving = queryAnalysis.actionDriving;
  const requestedSlots: RecallSlot[] = [];

  if (roleQuery) {
    requestedSlots.push("role");
  }
  if (focusQuery) {
    requestedSlots.push("focus");
  }
  if (blockerQuery) {
    requestedSlots.push("blocker");
  }
  if (openLoopQuery) {
    requestedSlots.push("open_loop");
  }
  if (referenceSeeking) {
    requestedSlots.push("reference");
  }

  const supportSlots: RecallSlot[] = [];
  if (
    actionDriving &&
    (requestedSlots.includes("role") ||
      requestedSlots.includes("focus") ||
      requestedSlots.includes("reference"))
  ) {
    supportSlots.push("project_state_support");
  }
  if (continuationIntent) {
    supportSlots.push("runtime_continuity");
  }
  const strategyExplanation = resolveRouterStrategy({
    strategy: input.strategy,
    autoStrategyBias: input.autoStrategyBias,
    availability: input.availability,
    autoSignals: {
      retrievalProfile,
      requestedSlots,
      supportSlots,
      continuation: continuationIntent,
      referenceSeeking,
      actionDriving,
    },
  });
  const includeEvidence =
    continuationIntent || actionDriving || referenceSeeking;
  const evidenceSources: RecallSource[] = includeEvidence ? ["evidence"] : [];

  if (continuationIntent) {
    return {
      retrievalProfile,
      intent: "task_continuation",
      strategy: strategyExplanation.resolvedStrategy,
      strategyExplanation,
      sourcePriorities: [
        "working_memory",
        "session_journal",
        "session_archive",
        "episode",
        "fact",
        ...evidenceSources,
        "feedback",
        "profile",
      ],
      requestedSlots,
      supportSlots,
      actionDriving,
      referenceSeeking,
      continuation: continuationIntent,
    };
  }

  return {
    retrievalProfile,
    intent: "general_assistance",
    strategy: strategyExplanation.resolvedStrategy,
    strategyExplanation,
    sourcePriorities: [
      "profile",
      "feedback",
      "fact",
      ...evidenceSources,
      "episode",
      "working_memory",
      "session_journal",
    ],
    requestedSlots,
    supportSlots,
    actionDriving,
    referenceSeeking,
    continuation: continuationIntent,
  };
}
