import type { EmbeddingAdapter } from "../embedding/contracts";
import type { EvidenceRecord } from "../evidence/contracts";
import type { LanguageQueryAnalysis } from "../language";
import type { RecallVectorSearchPort } from "../storage/ports";
import {
  resolveRecallRouterInfluenceStatus,
} from "./assistant";
import type {
  RecallAssistantFallbackReason,
  RecallAssistantFallbackStage,
  RecallAssistantInfluence,
  RecallAssistantProviderDiagnostic,
} from "./assistant";
import type {
  RecallCandidateTrace,
  RecallSemanticCandidatesConfig,
} from "./contracts";
import { matchesRecallRerankCandidateId, recallRerankCandidateKey } from "./rerankPool";
import {
  resolveRecallRoutingWarningMessages,
  SEMANTIC_RECALL_INACTIVE_WARNING,
} from "./router";
import type { RoutingDecision } from "./router";

export { SEMANTIC_RECALL_INACTIVE_WARNING };

export function buildEvidenceCountByMemoryId(
  evidence: EvidenceRecord[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const record of evidence) {
    for (const memoryId of record.linkedMemoryIds) {
      counts.set(memoryId, (counts.get(memoryId) ?? 0) + 1);
    }
  }

  return counts;
}

export function buildEmptyAssistantInfluence(): RecallAssistantInfluence {
  return {
    addedRequestedSlots: [],
    addedSupportSlots: [],
    decisions: [],
    planApplied: false,
    rerankApplied: false,
    rerankedCandidateIds: [],
    routerInfluenceStatus: "full_fallback",
    suppressedCandidateIds: [],
  };
}

export function resolveAssistantFallbackReason(error: unknown): RecallAssistantFallbackReason {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (message.includes("schema validation failed")) {
    return "schema_invalid";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }

  return "provider_error";
}

export function summarizeAssistantProviderError(error: unknown): string {
  const rawMessage =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : String(error);

  return rawMessage.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function extractValidationIssueSummary(message: string): string | undefined {
  const marker = "schema validation failed:";
  const index = message.toLowerCase().indexOf(marker);
  if (index === -1) {
    return undefined;
  }

  return message.slice(index + marker.length).trim().slice(0, 240);
}

export function buildAssistantProviderDiagnostic(input: {
  error: unknown;
  stage: RecallAssistantFallbackStage;
}): RecallAssistantProviderDiagnostic {
  const message = summarizeAssistantProviderError(input.error);
  const reason = resolveAssistantFallbackReason(input.error);

  return {
    message,
    reason,
    stage: input.stage,
    ...(reason === "schema_invalid"
      ? { validationIssueSummary: extractValidationIssueSummary(message) }
      : {}),
  };
}

export function withAssistantProviderFallback(input: {
  error: unknown;
  influence: RecallAssistantInfluence | undefined;
  stage: RecallAssistantFallbackStage;
}): RecallAssistantInfluence {
  const current = input.influence ?? buildEmptyAssistantInfluence();
  const diagnostic = buildAssistantProviderDiagnostic({
    error: input.error,
    stage: input.stage,
  });
  const next = {
    ...current,
    fallbackReason: diagnostic.reason,
    fallbackStage: input.stage,
    providerDiagnostics: [
      ...(current.providerDiagnostics ?? []),
      diagnostic,
    ],
  };

  return {
    ...next,
    routerInfluenceStatus: resolveRecallRouterInfluenceStatus(next),
  };
}

export function finalizeAssistantInfluence(
  influence: RecallAssistantInfluence | undefined,
): RecallAssistantInfluence | undefined {
  if (!influence) {
    return undefined;
  }

  return {
    ...influence,
    routerInfluenceStatus: resolveRecallRouterInfluenceStatus(influence),
  };
}

export function appendAssistantTraceDetails(
  traces: RecallCandidateTrace[],
  influence?: RecallAssistantInfluence,
): RecallCandidateTrace[] {
  if (!influence) {
    return traces;
  }

  const decisions = influence.decisions;

  return traces.map((trace) => {
    const collection = trace.memoryType === "archive" ? "session_archives" :
      trace.memoryType === "episode" ? "episodes" :
      trace.memoryType === "reference" ? "references" :
      "facts";
    const decision = decisions.find(({ candidateId }) =>
      matchesRecallRerankCandidateId(candidateId, collection, trace.memoryId)
    );
    if (!decision) {
      return trace;
    }

    if (trace.returned) {
      if (decision.decision !== "promote") {
        return trace;
      }

      return {
        ...trace,
        whyReturned: trace.whyReturned
          ? `${trace.whyReturned}, llmDecision=${decision.decision}:${decision.reason}`
          : `llmDecision=${decision.decision}:${decision.reason}`,
      };
    }

    if (decision.decision === "suppress") {
      return {
        ...trace,
        whySuppressed: `llm-assisted suppress: ${decision.reason}`,
      };
    }

    return trace;
  });
}

export function collectAssistantProtectedCandidateIds(
  traceGroups: RecallCandidateTrace[][],
): Set<string> {
  const protectedCandidateIds = new Set<string>();

  for (const traces of traceGroups) {
    for (const trace of traces) {
      if (trace.returned && trace.slot !== "generic") {
        protectedCandidateIds.add(recallRerankCandidateKey(
          trace.memoryType === "archive" ? "session_archives" :
            trace.memoryType === "episode" ? "episodes" :
            trace.memoryType === "reference" ? "references" :
            "facts",
          trace.memoryId,
        ));
      }
    }
  }

  return protectedCandidateIds;
}

export function createAssistantSuppressionTraceReason(
  suppressedCandidateIds: readonly string[],
): (trace: RecallCandidateTrace) => string {
  const suppressedIds = new Set(suppressedCandidateIds);

  return (trace) => {
    const collection = trace.memoryType === "archive" ? "session_archives" :
      trace.memoryType === "episode" ? "episodes" :
      trace.memoryType === "reference" ? "references" :
      "facts";
    return suppressedIds.has(recallRerankCandidateKey(collection, trace.memoryId))
      ? "llm-assisted suppress"
      : "policy filtered";
  };
}

export function shouldSuppressGuidanceLanesForFactQuery(input: {
  queryAnalysis: LanguageQueryAnalysis;
  routingDecision: RoutingDecision;
}): boolean {
  if (
    input.routingDecision.retrievalProfile === "coding_agent" ||
    input.routingDecision.continuation ||
    input.routingDecision.actionDriving ||
    input.routingDecision.referenceSeeking ||
    input.queryAnalysis.answerComposition ||
    input.queryAnalysis.guidanceSeeking
  ) {
    return false;
  }

  return input.queryAnalysis.directFactualLookup;
}

export function withRoutingWarning(
  routingDecision: RoutingDecision,
  warning: string,
): RoutingDecision {
  const warnings = routingDecision.strategyExplanation.warnings ?? [];
  if (warnings.includes(warning)) {
    return routingDecision;
  }

  const nextWarnings = [...warnings, warning];
  const warningMessages = resolveRecallRoutingWarningMessages({
    existingMessages: routingDecision.strategyExplanation.warningMessages,
    warnings: nextWarnings,
  });

  return {
    ...routingDecision,
    strategyExplanation: {
      ...routingDecision.strategyExplanation,
      ...(warningMessages.length > 0 ? { warningMessages } : {}),
      warnings: nextWarnings,
    },
  };
}

export function shouldWarnSemanticUnionInactive(input: {
  embedding: EmbeddingAdapter | undefined;
  routingDecision: RoutingDecision;
  semanticCandidates: RecallSemanticCandidatesConfig | undefined;
  vectorIndex: RecallVectorSearchPort | null;
}): boolean {
  return Boolean(
    input.semanticCandidates &&
      input.embedding &&
      input.vectorIndex &&
      input.routingDecision.strategy !== "hybrid" &&
      input.routingDecision.strategyExplanation.requestedStrategy !== "rules-only",
  );
}
