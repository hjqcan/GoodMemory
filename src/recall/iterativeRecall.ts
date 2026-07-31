// Iterative (two-pass) recall for multi-hop questions.
//
// Single-pass lexical/semantic recall cannot answer a question whose evidence is
// only reachable through a bridge: "What sport does the goaltender play?" matches
// the fact that NAMES the goaltender, but not the separate fact that records that
// person's sport. This composes recall with itself: hop 1 retrieves the facts the
// query matches directly, salient bridge entities (names, values) are extracted
// from those facts, and the query is expanded with them so a second recall also
// matches the chained fact. A caller-provided merger can preserve direct
// evidence from every hop; without one, the historical latest-hop behavior is
// retained.
//
// It is opt-in and provider-free: the caller supplies a `recall` closure (already
// bound to scope/strategy), so this never changes default single-pass behavior
// and adds no dependency on the recall engine internals.

const DEFAULT_BRIDGE_ENTITY_LIMIT = 4;
const DEFAULT_BRIDGE_FACT_LIMIT = 6;
const ISO_TIMESTAMP_PATTERN =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/giu;

interface BridgeCandidate {
  count: number;
  firstIndex: number;
  proper: boolean;
  token: string;
}

export interface BridgeTextAnalysis {
  entities: readonly string[];
  tokens: readonly string[];
}

function normalizeBridgeToken(raw: string): { key: string; token: string } {
  const token = raw.normalize("NFKC").trim();
  return { key: token.toLocaleLowerCase(), token };
}

// Salient terms in the retrieved facts that the query did NOT already contain:
// the entities/values that bridge hop 1 to hop 2. Proper nouns (capitalized) and
// numeric values rank first, then novel content words by frequency, with original
// reading order as the deterministic tie-breaker.
export function extractBridgeEntities(input: {
  analyzeBridgeText: (text: string) => BridgeTextAnalysis;
  facts: readonly { content: string }[];
  query: string;
  limit?: number;
}): string[] {
  const limit = input.limit ?? DEFAULT_BRIDGE_ENTITY_LIMIT;
  const queryAnalysis = input.analyzeBridgeText(input.query);
  const querySet = new Set(
    [...queryAnalysis.entities, ...queryAnalysis.tokens]
      .map((term) => normalizeBridgeToken(term).key)
      .filter(Boolean),
  );
  const candidates = new Map<string, BridgeCandidate>();
  let position = 0;

  for (const fact of input.facts.slice(0, DEFAULT_BRIDGE_FACT_LIMIT)) {
    const analyzed = input.analyzeBridgeText(
      fact.content.replace(ISO_TIMESTAMP_PATTERN, " "),
    );
    const terms = [
      ...analyzed.entities.map((raw) => ({ proper: true, raw })),
      ...analyzed.tokens.map((raw) => ({ proper: false, raw })),
    ];
    for (const term of terms) {
      const normalized = normalizeBridgeToken(term.raw);
      const lower = normalized.key;
      position += 1;
      if (!lower || querySet.has(lower)) {
        continue;
      }
      const existing = candidates.get(lower);
      if (existing) {
        existing.count += 1;
        existing.proper = existing.proper || term.proper;
      } else {
        candidates.set(lower, {
          count: 1,
          firstIndex: position,
          proper: term.proper,
          token: normalized.token,
        });
      }
    }
  }

  return [...candidates.values()]
    .sort((left, right) => {
      if (left.proper !== right.proper) {
        return left.proper ? -1 : 1;
      }
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      return left.firstIndex - right.firstIndex;
    })
    .slice(0, limit)
    .map((candidate) => candidate.token);
}

// Safety ceiling on the number of recall passes, independent of the requested
// maxHops, so an injected follow-up strategy can never trigger a runaway loop.
const MAX_HOPS_CEILING = 6;
const DEFAULT_MAX_HOPS = 2;

export type FollowUpDecision =
  | {
      missingSlots: readonly [];
      sufficient: true;
    }
  | {
      // R8 executes one focused query per hop. The only missing slot is that
      // standalone query, so there is no second query field to drift.
      missingSlots: readonly [string];
      sufficient: false;
    };

export interface IterativeRecallOptions {
  // Required for the built-in bridge strategy. The caller must use the same
  // LanguageService as the surrounding recall request.
  analyzeBridgeText?: (text: string) => BridgeTextAnalysis;
  bridgeEntityLimit?: number;
  // Maximum total recall passes (>= 1). Default 2 (one bridge expansion), the
  // historical two-pass behavior. The literature shows 2-3 hops capture most of
  // the multi-hop gain; clamped to MAX_HOPS_CEILING.
  maxHops?: number;
  // Optional evidence-sufficiency decision. It may request another hop only
  // when it identifies at least one concrete missing slot and a focused query.
  // null means the decision adapter was unavailable. When provided it replaces
  // lexical bridge expansion, so bridgeEntities stays empty.
  decideNextHop?: (input: {
    evidence: readonly { content: string }[];
    originalQuery: string;
    query: string;
    hop: number;
  }) => FollowUpDecision | null | Promise<FollowUpDecision | null>;
}

export interface IterativeRecallOutcome<TResult> {
  bridgeEntities: string[];
  expandedQuery: string;
  hops: number;
  result: TResult;
  steps: IterativeRecallStep[];
  stopReason: IterativeRecallStopReason;
}

export type IterativeRecallStopReason =
  | "decision_unavailable"
  | "evidence_sufficient"
  | "max_hops_reached"
  | "missing_slots_unresolved"
  | "no_bridge_entities"
  | "no_new_evidence"
  | "unchanged_query";

export interface IterativeRecallStep {
  bridgeEntities: string[];
  factCount: number;
  hop: number;
  query: string;
  sufficiencyDecision?: FollowUpDecision;
}

export async function iterativeRecall<
  TResult extends { facts: readonly { content: string; id: string }[] },
>(input: {
  query: string;
  recall: (query: string) => Promise<TResult>;
  merge?: (primary: TResult, supplementary: TResult[]) => TResult;
  options?: IterativeRecallOptions;
}): Promise<IterativeRecallOutcome<TResult>> {
  const maxHops = Math.min(
    MAX_HOPS_CEILING,
    Math.max(1, input.options?.maxHops ?? DEFAULT_MAX_HOPS),
  );
  const decideNextHop = input.options?.decideNextHop;
  if (maxHops > 1 && !decideNextHop && !input.options?.analyzeBridgeText) {
    throw new Error(
      "iterativeRecall requires analyzeBridgeText when no decideNextHop is provided",
    );
  }

  let result = await input.recall(input.query);
  const primaryResult = result;
  const supplementaryResults: TResult[] = [];
  let activeQuery = input.query;
  let hops = 1;
  const bridgeEntities: string[] = [];
  const seenBridge = new Set<string>();
  const seenFactIds = new Set(result.facts.map((fact) => fact.id));
  const accumulatedEvidence = [...result.facts];
  const steps: IterativeRecallStep[] = [
    {
      bridgeEntities: [],
      factCount: result.facts.length,
      hop: 1,
      query: input.query,
    },
  ];
  let stopReason: IterativeRecallStopReason = "max_hops_reached";

  while (hops < maxHops) {
    let nextQuery: string | null;
    if (decideNextHop) {
      const decision = await decideNextHop({
        evidence: accumulatedEvidence,
        originalQuery: input.query,
        query: activeQuery,
        hop: hops,
      });
      if (!decision) {
        stopReason = "decision_unavailable";
        break;
      }
      const activeStep = steps[steps.length - 1]!;
      activeStep.sufficiencyDecision = decision;
      if (decision.sufficient) {
        stopReason = "evidence_sufficient";
        break;
      }
      nextQuery = decision.missingSlots[0].trim();
      if (!nextQuery) {
        stopReason = "missing_slots_unresolved";
        break;
      }
    } else {
      const hopBridges = extractBridgeEntities({
        analyzeBridgeText: input.options!.analyzeBridgeText!,
        facts: result.facts,
        limit: input.options?.bridgeEntityLimit,
        query: activeQuery,
      });
      const freshBridges = hopBridges.filter(
        (bridge) => !seenBridge.has(normalizeBridgeToken(bridge).key),
      );
      if (freshBridges.length === 0) {
        stopReason = "no_bridge_entities";
        break;
      }
      steps[steps.length - 1]!.bridgeEntities = [...freshBridges];
      for (const bridge of freshBridges) {
        seenBridge.add(normalizeBridgeToken(bridge).key);
        bridgeEntities.push(bridge);
      }
      nextQuery = `${input.query} ${bridgeEntities.join(" ")}`;
    }
    const normalizedNextQuery = nextQuery.trim();
    if (normalizedNextQuery === activeQuery.trim()) {
      stopReason = "unchanged_query";
      break;
    }
    result = await input.recall(normalizedNextQuery);
    supplementaryResults.push(result);
    activeQuery = normalizedNextQuery;
    hops += 1;
    steps.push({
      bridgeEntities: [],
      factCount: result.facts.length,
      hop: hops,
      query: activeQuery,
    });
    // Stop early once a hop surfaces nothing new, so extra hops are not wasted.
    const sizeBefore = seenFactIds.size;
    for (const fact of result.facts) {
      if (!seenFactIds.has(fact.id)) {
        accumulatedEvidence.push(fact);
      }
      seenFactIds.add(fact.id);
    }
    if (seenFactIds.size === sizeBefore) {
      stopReason = "no_new_evidence";
      break;
    }
  }

  return {
    bridgeEntities,
    expandedQuery: activeQuery,
    hops,
    result: input.merge && supplementaryResults.length > 0
      ? input.merge(primaryResult, supplementaryResults)
      : result,
    steps,
    stopReason,
  };
}
