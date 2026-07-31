import type { MemoryScope } from "../domain/scope";
import type { MemoryPlane } from "../domain/taxonomy";
import { createLanguageService } from "../language";
import type {
  LanguageQueryAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import { splitQueryIntoSubQueries } from "./queryDecomposition";
import { resolveTemporalReference } from "./temporalReference";

export const RECALL_PLAN_PRE_RANK_LIMIT = 32;
export const RECALL_PLAN_SELECTED_LIMIT = 12;
export const RECALL_PLAN_MAX_RENDERED_TOKENS = 6_000;

export type RecallAggregation = "change" | "count" | "current" | "history";
export type RecallEvidenceNeed =
  | "aggregation"
  | "direct"
  | "multi_facet"
  | "relation"
  | "temporal";
export type RecallPlanUncertainty = "high" | "low" | "medium";

export interface TemporalConstraint {
  kind: "after" | "before" | "current" | "history";
  referenceTime: string;
}

export interface RecallPlan {
  entities: string[];
  facets: string[];
  temporalConstraints: TemporalConstraint[];
  aggregation?: RecallAggregation;
  evidenceNeeds: RecallEvidenceNeed[];
  planes: MemoryPlane[];
  maxHops: number;
  preRankLimit: number;
  // Final global durable-evidence limit across all selected content lanes.
  selectedLimit: number;
  maxRenderedTokens: number;
  uncertainty: RecallPlanUncertainty;
}

export interface BuildRecallPlanInput {
  language?: LanguageService;
  languageContext?: ResolvedLanguageContext;
  locale?: string;
  query: string;
  queryAnalysis?: LanguageQueryAnalysis;
  referenceTime: string;
  scope: MemoryScope;
}

export interface RecallPlanAssistantInput {
  deterministicPlan: RecallPlan;
  locale?: string;
  query: string;
  referenceTime: string;
  scope: MemoryScope;
}

export interface RecallPlanAssistant {
  plan(input: RecallPlanAssistantInput): Promise<Partial<RecallPlan>>;
}

export interface RecallPlanResolution {
  assistantApplied: boolean;
  fallbackReason?: "assistant_error";
  plan: RecallPlan;
}

export function buildUnplannedRecallPlan(): RecallPlan {
  return {
    entities: [],
    facets: [],
    temporalConstraints: [],
    evidenceNeeds: ["direct"],
    planes: ["semantic"],
    maxHops: 1,
    preRankLimit: RECALL_PLAN_PRE_RANK_LIMIT,
    selectedLimit: RECALL_PLAN_SELECTED_LIMIT,
    maxRenderedTokens: RECALL_PLAN_MAX_RENDERED_TOKENS,
    uncertainty: "low",
  };
}

// Acronyms that describe an interface or data shape are facets, not named
// entities. Keeping this list narrow avoids erasing real product names.
const GENERIC_ENTITY_KEYS = new Set(["api", "id", "url"]);

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function resolveAggregation(
  analysis: LanguageQueryAnalysis,
): RecallAggregation | undefined {
  if (analysis.aggregateCount) {
    return "count";
  }
  if (analysis.change) {
    return "change";
  }
  if (analysis.history) {
    return "history";
  }
  if (analysis.current) {
    return "current";
  }
  return undefined;
}

function buildTemporalConstraints(input: {
  aggregation: RecallAggregation | undefined;
  analysis: LanguageQueryAnalysis;
  language: LanguageService;
  languageContext: ResolvedLanguageContext;
  query: string;
  referenceTime: string;
}): TemporalConstraint[] {
  const kinds: TemporalConstraint["kind"][] = [];
  if (input.analysis.current || input.aggregation === "current") {
    kinds.push("current");
  }
  if (input.analysis.history || input.aggregation === "history") {
    kinds.push("history");
  }
  if (input.analysis.before) {
    kinds.push("before");
  }
  if (input.analysis.after) {
    kinds.push("after");
  }
  const explicitReferenceTime = resolveTemporalReference(
    input.language.parseTemporalExpressions(
      input.query,
      input.languageContext,
    ),
    input.referenceTime,
  );
  return unique(kinds).map((kind) => ({
    kind,
    referenceTime:
      (kind === "before" || kind === "after") && explicitReferenceTime
        ? explicitReferenceTime
        : input.referenceTime,
  }));
}

/**
 * Build the provider-free recall plan from request-local information only.
 * Benchmark labels, case ids, expected answers, and retrieved memories are not
 * inputs, so this plan can be reproduced before retrieval starts.
 */
export function buildDeterministicRecallPlan(
  input: BuildRecallPlanInput,
): RecallPlan {
  const language = input.language ?? createLanguageService();
  const resolvedLanguage = input.languageContext ?? language.resolveFromText({
    locale: input.locale,
    text: input.query,
  });
  const locale = resolvedLanguage.locale;
  const analysis = input.queryAnalysis ??
    language.analyzeQuery(input.query, resolvedLanguage);
  const facets = splitQueryIntoSubQueries(input.query, {
    analysis,
    language,
    languageContext: resolvedLanguage,
    locale,
  });
  const aggregation = resolveAggregation(analysis);
  const temporalConstraints = buildTemporalConstraints({
    aggregation,
    analysis,
    language,
    languageContext: resolvedLanguage,
    query: input.query,
    referenceTime: input.referenceTime,
  });
  const relation = analysis.relation;
  const temporalOperandQuery = (analysis.temporalOperands?.length ?? 0) > 0;

  const evidenceNeeds: RecallEvidenceNeed[] = ["direct"];
  if (aggregation) {
    evidenceNeeds.push("aggregation");
  }
  if (
    temporalConstraints.length > 0 ||
    aggregation === "change" ||
    analysis.temporalInterval ||
    temporalOperandQuery
  ) {
    evidenceNeeds.push("temporal");
  }
  if (relation) {
    evidenceNeeds.push("relation");
  }
  if (facets.length > 0) {
    evidenceNeeds.push("multi_facet");
  }

  const planes: MemoryPlane[] = ["semantic"];
  if (
    temporalConstraints.length > 0 ||
    aggregation === "change" ||
    analysis.temporalInterval ||
    temporalOperandQuery ||
    relation ||
    facets.length > 0
  ) {
    planes.push("episodic");
  }
  if (
    analysis.procedural || analysis.guidanceSeeking
  ) {
    planes.push("procedural");
  }
  if (input.scope.sessionId || analysis.continuation) {
    planes.push("runtime");
  }

  const maxHops = relation || analysis.temporalInterval ? 2 : 1;
  const broadAggregation =
    aggregation === "change" ||
    aggregation === "count" ||
    aggregation === "history";
  const uncertainty: RecallPlanUncertainty =
    facets.length > 0 || maxHops > 1 || broadAggregation
      ? "high"
      : aggregation || temporalConstraints.length > 0
        ? "medium"
        : "low";
  const entities = unique(
    language.extractEntityMentions(input.query, resolvedLanguage)
      .map((entity) =>
        language.normalizeForEquality(entity.normalized, resolvedLanguage)
      )
      .filter((entity) => entity.length > 0 && !GENERIC_ENTITY_KEYS.has(entity)),
  );

  return {
    entities,
    facets,
    temporalConstraints,
    ...(aggregation ? { aggregation } : {}),
    evidenceNeeds: unique(evidenceNeeds),
    planes: unique(planes),
    maxHops,
    preRankLimit: RECALL_PLAN_PRE_RANK_LIMIT,
    selectedLimit: RECALL_PLAN_SELECTED_LIMIT,
    maxRenderedTokens: RECALL_PLAN_MAX_RENDERED_TOKENS,
    uncertainty,
  };
}

export async function resolveRecallPlan(input: {
  assistant?: RecallPlanAssistant;
  input: BuildRecallPlanInput;
}): Promise<RecallPlanResolution> {
  const language = input.input.language ?? createLanguageService();
  const languageContext = input.input.languageContext ??
    language.resolveFromText({
      locale: input.input.locale,
      text: input.input.query,
    });
  const queryAnalysis = input.input.queryAnalysis ??
    language.analyzeQuery(input.input.query, languageContext);
  const deterministicPlan = buildDeterministicRecallPlan({
    ...input.input,
    language,
    languageContext,
    queryAnalysis,
  });
  if (!input.assistant || deterministicPlan.uncertainty === "low") {
    return { assistantApplied: false, plan: deterministicPlan };
  }
  try {
    const assisted = await input.assistant.plan({
      deterministicPlan,
      locale: input.input.locale,
      query: input.input.query,
      referenceTime: input.input.referenceTime,
      scope: input.input.scope,
    });
    const entities = unique([
      ...deterministicPlan.entities,
      ...(assisted.entities ?? []),
    ]);
    const normalizedEntities = entities
      .map((entity) => language.normalizeForEquality(entity, languageContext))
      .filter((entity) => entity.length > 0);
    const assistedFacets = (assisted.facets ?? []).filter((facet) => {
      const normalizedFacet = language.normalizeForEquality(
        facet,
        languageContext,
      );
      return normalizedEntities.some((entity) => {
        const entityIndex = normalizedFacet.indexOf(entity);
        if (entityIndex < 0) {
          return false;
        }
        return `${normalizedFacet.slice(0, entityIndex)}${normalizedFacet.slice(
          entityIndex + entity.length,
        )}`.replace(/[\p{P}\p{S}\s]+/gu, "").length > 0;
      });
    });
    const facets = unique([
      ...deterministicPlan.facets,
      ...assistedFacets,
    ]);
    const evidenceNeeds = [...deterministicPlan.evidenceNeeds];
    const planes = [...deterministicPlan.planes];
    if (assistedFacets.length > 0) {
      evidenceNeeds.push("multi_facet");
      planes.push("episodic");
    }
    return {
      assistantApplied: true,
      plan: {
        ...deterministicPlan,
        entities,
        facets,
        evidenceNeeds: unique(evidenceNeeds),
        planes: unique(planes),
        preRankLimit: RECALL_PLAN_PRE_RANK_LIMIT,
        selectedLimit: RECALL_PLAN_SELECTED_LIMIT,
        maxRenderedTokens: RECALL_PLAN_MAX_RENDERED_TOKENS,
        uncertainty: facets.length > 0
          ? "high"
          : deterministicPlan.uncertainty,
      },
    };
  } catch {
    return {
      assistantApplied: false,
      fallbackReason: "assistant_error",
      plan: deterministicPlan,
    };
  }
}
