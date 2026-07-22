import type { RankedFactCandidate } from "../scoring";

/** Generic production primitives reused by the repo-only legacy profile. */
export * from "../../../../../src/recall/selectors/selectionContext";

export const ASSISTANT_EVIDENCE_RECALL_LIMIT = 6;
export const DIRECT_FACTUAL_RECALL_LIMIT = 6;
export const DIRECT_FACTUAL_COMPANION_LIMIT = 3;
export const PREFERENCE_EVIDENCE_RECALL_LIMIT = 4;
export const TEMPORAL_BRIDGE_EVIDENCE_RECALL_LIMIT = 4;
export const UPDATE_EVIDENCE_RECALL_LIMIT = 3;
export const RESEARCH_RECOMMENDATION_LIMIT = 2;
export const SOURCE_ORDER_TAG = "source_order";
export const AGGREGATE_TRUSTED_EVIDENCE_TAGS = new Set([
  "compact_evidence",
  "dated_event",
  "user_answer",
]);
export const DIRECT_FACTUAL_COMPANION_TAGS = new Set([
  "compact_evidence",
  "dated_event",
  "source_message",
  "user_answer",
]);
export const QUANTIFIED_FACT_PATTERN =
  /\b(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\$\s*\d|\d+(?:[.,]\d+)?\s*(?:元|块|人民币)/iu;
export const PERSONAL_ELECTRONICS_FACT_PATTERN =
  /\bPersonal electronics (?:spec|purchase cost|ownership) evidence:/iu;
export const INSTRUMENT_PRACTICE_FACT_PATTERN =
  /\bInstrument practice evidence:/iu;
export const ENTITY_BEARING_FACT_PATTERN =
  /\bDr\.?\s+[A-Z][\p{L}'-]+\b|\b[A-Z][\p{L}'-]+(?:\s+(?:of|the|[A-Z][\p{L}'-]+)){1,}\b|["'][^"']+["']/u;
export const ASSISTANT_COUNT_HEADING_FACT_PATTERN =
  /^[^:\n]{2,120}\(\d+\):$/u;

export function hasSourceMessageTag(entry: RankedFactCandidate): boolean {
  return entry.fact.tags?.includes("source_message") === true;
}

export function hasDirectFactualCompanionTag(entry: RankedFactCandidate): boolean {
  return entry.fact.tags?.some((tag) => DIRECT_FACTUAL_COMPANION_TAGS.has(tag)) === true;
}

export function hasUserAnswerTag(entry: RankedFactCandidate): boolean {
  return entry.fact.tags?.includes("user_answer") === true;
}

export function isDatedEventFact(entry: RankedFactCandidate): boolean {
  return entry.fact.tags?.includes("dated_event") === true;
}

export function hasTrustedAggregateEvidence(entry: RankedFactCandidate): boolean {
  if (entry.fact.source.method === "inferred") {
    return false;
  }

  if (entry.fact.source.method === "confirmed") {
    return true;
  }

  return entry.fact.tags?.some((tag) => AGGREGATE_TRUSTED_EVIDENCE_TAGS.has(tag)) === true;
}

export function isAssistantProvidedDetailRecallQuery(query: string): boolean {
  return /\b(?:did|do)\s+you\s+(?:give|list|mention|provide|recommend|say|suggest|tell)\b/iu.test(query) ||
    /\byou\s+(?:gave|listed|mentioned|provided|recommended|said|suggested|told)\b/iu.test(query) ||
    /\b(?:previous chat|previous conversation|earlier|remind me|going back)\b[\s\S]{0,160}\b(?:how many|what|which|phone|number|quote)\b/iu.test(query) ||
    /\b(?:what|which)\b[\s\S]{0,120}\b(?:did\s+you\s+recommend|recommended|recommendation|provided|suggested|told me|gave me)\b/iu.test(query) ||
    /(你|助手)[\s\S]{0,80}(给|列|列出|提到|提供|推荐|建议|告诉|说)[\s\S]{0,120}(什么|哪个|哪一个|多少|第\s*[一二三四五六七八九十\d]+|最后)/u.test(query) ||
    /(之前|上次|前面|刚才|早些时候)[\s\S]{0,120}(你|助手)[\s\S]{0,80}(推荐|建议|提供|告诉|说|列出)/u.test(query);
}

export function explicitlyAsksForAssistantProvidedDetail(query: string): boolean {
  return /\b(?:did|do)\s+you\s+(?:give|list|mention|provide|recommend|say|suggest|tell)\b/iu.test(query) ||
    /\byou\s+(?:gave|listed|mentioned|provided|recommended|said|suggested|told)\b/iu.test(query) ||
    /\b(?:list|details?|phone|number|quote)\s+you\s+(?:gave|listed|mentioned|provided|recommended|said|suggested|told)\b/iu.test(query) ||
    /(你|助手)[\s\S]{0,80}(给|列|列出|提到|提供|推荐|建议|告诉|说)/u.test(query);
}

export function isUserGroundedRecallQuery(query: string): boolean {
  return (
    /\b(?:I|I'm|I've|I'd|I'll|me|my|mine)\b/iu.test(query) ||
    /(我|我的|我们|我们的)/u.test(query)
  ) &&
    !explicitlyAsksForAssistantProvidedDetail(query) &&
    !/\byou\b[\s\S]{0,100}\b(?:give|gave|list|listed|mention|mentioned|provide|provided|recommend|recommended|say|said|suggest|suggested|tell|told)\b/iu.test(query) &&
    !/(你|助手)[\s\S]{0,100}(给|列|列出|提到|提供|推荐|建议|告诉|说)/u.test(query);
}

export function stripEvidencePrefix(content: string): string {
  return content.replace(/^\[[^\]]+\]\s*/u, "");
}

export function isInstrumentPracticeTimeQuery(query: string): boolean {
  return /\b(?:practice|practicing)\b/i.test(query) &&
    /\b(?:daily|every day|time|minutes?|hours?|how much)\b/i.test(query) &&
    /\b(?:instrument|violin|guitar|piano|saxophone|harmonica)\b/i.test(query);
}

export function valueBearingFactContent(content: string): string {
  return stripEvidencePrefix(content)
    .replace(/^On\s+\d{4}\/\d{1,2}\/\d{1,2},\s*/iu, "")
    .trim();
}

export function hasEntityBearingEvidenceSignal(entry: RankedFactCandidate): boolean {
  return ENTITY_BEARING_FACT_PATTERN.test(
    valueBearingFactContent(entry.fact.content),
  );
}
