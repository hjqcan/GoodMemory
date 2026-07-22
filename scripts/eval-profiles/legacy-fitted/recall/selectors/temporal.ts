/** Repo-only legacy-fitted temporal selection heuristics. */
import type { LanguageService } from "../../language";
import type { RankedFactCandidate } from "../scoring";
import {
  hasConversationEvidenceTag,
  hasEntityBearingEvidenceSignal,
  hasTrustedAggregateEvidence,
  hasUserAnswerTag,
  isDatedEventFact,
  isUserGroundedRecallQuery,
  SOURCE_ORDER_TAG,
  stripEvidencePrefix,
  valueBearingFactContent,
} from "./selectionContext";
import { selectorTopicOverlapCount, selectorTopicTokens } from "./topic";

export const TEMPORAL_INTERVAL_ANCHOR_STOPWORDS = new Set([
  "about",
  "after",
  "before",
  "between",
  "completed",
  "complete",
  "day",
  "days",
  "finished",
  "finish",
  "obtained",
  "obtain",
  "passed",
  "planned",
  "received",
  "scheduled",
  "started",
  "using",
  "when",
]);
export const TEMPORAL_INTERVAL_ACQUISITION_OBJECT_PATTERN =
  /\b(?:api\s+key|key|token|credential|access|license|permit|certificate|approval|confirmation|receipt|authorization|invite|invitation)\b/iu;

export const DATE_OR_TIME_FACT_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{1,2}:\d{2}\b/iu;

export const REALIZED_TEMPORAL_EVENT_FACT_PATTERN =
  /\b(?:attended|bought|came\s+back\s+from|finished|got\s+back\s+from|helped|ordered|participated|prescribed|replaced|saw|started|took|visited|went)\b/iu;

export const HEALTH_ISSUE_EVENT_FACT_PATTERN =
  /\b(?:persistent cough|skin tag removed|had a skin tag removed)\b/iu;
export const PERSONAL_WORK_CHALLENGE_STATE_PATTERN =
  /\b(?:burnout|challenge|concern|confus(?:ed|ing)|fatigue|irritability|nervous|overwhelm(?:ed|ing)?|stress(?:ed|ful)?|tension)\b/iu;
export const PERSONAL_WORK_CONTEXT_PATTERN =
  /\b(?:agenda|career|collaborat(?:e|ed|ing|ion)|deadline|delegat(?:e|ed|ing|ion)|meeting|productiv(?:e|ity)|promotion|role|schedule|team|work|workflow)\b/iu;
export const PERSONAL_LIFE_CONTEXT_PATTERN =
  /\b(?:anniversary|celebrat(?:e|ed|ing|ion)|dinner|family|favor|flowers?|friend|getaway|menu|note|partner|personal|picnic|relationship|surprise|weekend)\b/iu;
export const PERSONAL_WORK_CHALLENGE_RESPONSE_PATTERN =
  /\b(?:agenda|celebrat(?:e|ed|ing)|dinner|flowers?|favor|getaway|meeting|menu|note|picnic|promotion|reserve|schedule|surprise)\b/iu;

export function isTemporalIntervalQuery(query: string): boolean {
  return /\bhow many\s+(?:days?|weeks?|months?|years?)\b/i.test(query) &&
    /\b(?:passed|between|ago)\b/i.test(query);
}

export function temporalIntervalAnchorFragments(query: string): string[] {
  const betweenWhenMatch = query.match(
    /\bbetween\s+when\s+(?:I|we|you)?\s*(.+?)\s+and\s+when\s+(?:I|we|you)?\s*(.+?)(?:[?.!]|$)/iu,
  );
  if (betweenWhenMatch?.[1] && betweenWhenMatch[2]) {
    return [betweenWhenMatch[1], betweenWhenMatch[2]];
  }

  const betweenMatch = query.match(/\bbetween\s+(.+?)\s+and\s+(.+?)(?:[?.!]|$)/iu);
  if (betweenMatch?.[1] && betweenMatch[2]) {
    return [betweenMatch[1], betweenMatch[2]];
  }

  return [];
}

export function temporalIntervalActionPattern(fragment: string): RegExp | undefined {
  const normalized = fragment.toLowerCase();
  if (/\b(?:obtain(?:ed)?|got|received)\b/u.test(normalized)) {
    return /\b(?:obtain(?:ed)?|got|received)\b/iu;
  }
  if (/\b(?:complet(?:e|ed)|finish(?:ed)?|finali[sz](?:e|ed))\b/u.test(normalized)) {
    return /\b(?:complet(?:e|ed)|finish(?:ed)?|finali[sz](?:e|ed))\b/iu;
  }
  if (/\b(?:start(?:ed)?|began|begin)\b/u.test(normalized)) {
    return /\b(?:start(?:ed)?|began|begin)\b/iu;
  }
  if (/\b(?:plan(?:ned)?|aim(?:ed)?|schedul(?:e|ed))\b/u.test(normalized)) {
    return /\b(?:plan(?:ned)?|aim(?:ed)?|schedul(?:e|ed))\b/iu;
  }
  if (/\b(?:file(?:d)?|submit(?:ted)?|register(?:ed)?|attend(?:ed)?|met)\b/u.test(normalized)) {
    return /\b(?:file(?:d)?|submit(?:ted)?|register(?:ed)?|attend(?:ed)?|met)\b/iu;
  }

  return undefined;
}

export function hasTemporalIntervalCredentialAcquisitionAnchor(fragment: string): boolean {
  const normalized = fragment.toLowerCase();
  return /\b(?:obtain(?:ed)?|got|received)\b/u.test(normalized) &&
    TEMPORAL_INTERVAL_ACQUISITION_OBJECT_PATTERN.test(normalized);
}

export function isTemporalEventOrderQuery(query: string): boolean {
  return /\bwhat\s+is\s+the\s+order\b/i.test(query) ||
    /\border\s+of\b/i.test(query) ||
    /\border\s+in\s+which\b/i.test(query) ||
    /\bin\s+which\s+order\b/i.test(query) ||
    /\bin\s+order\b/i.test(query) && /\b(?:brought\s+up|discussed|mentioned|talked\s+about|listed)\b/i.test(query) ||
    /\bchronological(?:ly)?\b/i.test(query) ||
    /\border\b[\s\S]{0,120}\b(?:earliest|latest|first|last)\b/i.test(query) ||
    /\b(?:earliest|first)\s+to\s+(?:latest|last)\b/i.test(query) ||
    /\bstarting\s+from\s+(?:the\s+)?earliest\b/i.test(query) ||
    /\border\s+from\s+first\s+to\s+last\b/i.test(query) ||
    /\bwhich\b[\s\S]{0,120}\bevents?\b[\s\S]{0,120}\bfirst\b[\s\S]{0,120}\blast\b/i.test(query) ||
    /\bwhich\b[\s\S]{0,120}\bevents?\b[\s\S]{0,120}\bhappened\s+first\b/i.test(query) ||
    /\bwhich\b[\s\S]{0,120}\b(?:health\s+issues?|issues?|tasks?|activities?)\b[\s\S]{0,120}\bfirst\b/i.test(query) ||
    /(顺序|先后|先.*后|从早到晚|从最早到最后|时间线|按时间|最先|最后|第一个|一步步)/u.test(query);
}

export function isPersonalWorkChallengeEventOrderQuery(query: string): boolean {
  return isTemporalEventOrderQuery(query) &&
    /\b(?:personal|work(?:-related)?|professional|career)\b/iu.test(query) &&
    /\b(?:challenges?|concerns?|issues?|problems?|stress(?:ors)?|struggles?)\b/iu.test(
      query,
    );
}

export function isUserBroughtUpEventOrderQuery(query: string): boolean {
  return isTemporalEventOrderQuery(query) &&
    (
      /\bI\b[\s\S]{0,80}\b(?:brought\s+up|discussed|mentioned|talked\s+about)\b/iu.test(query) ||
      /\b(?:brought\s+up|discussed|mentioned|talked\s+about)\b[\s\S]{0,80}\b(?:by|from)\s+me\b/iu.test(query) ||
      /我[\s\S]{0,80}(提到|讨论|聊到|说过)/u.test(query)
    );
}

export function hasPersonalWorkChallengeEventSignal(entry: RankedFactCandidate): boolean {
  const content = valueBearingFactContent(entry.fact.content);
  const hasChallengeState = PERSONAL_WORK_CHALLENGE_STATE_PATTERN.test(content);
  const hasWorkContext = PERSONAL_WORK_CONTEXT_PATTERN.test(content);
  const hasPersonalContext = PERSONAL_LIFE_CONTEXT_PATTERN.test(content);
  const hasChallengeResponse =
    PERSONAL_WORK_CHALLENGE_RESPONSE_PATTERN.test(content);

  return hasChallengeState ||
    (hasWorkContext && hasChallengeResponse) ||
    (hasPersonalContext && hasChallengeResponse);
}

export function isTemporalMostRecentQuery(query: string): boolean {
  return /\b(?:which|what)\b/i.test(query) &&
    /\b(?:most\s+recent(?:ly)?|latest|last)\b/i.test(query) ||
    /(最近|最新|最后一次|上一次|最晚)/u.test(query);
}

export function isTemporalRelativeEventQuery(query: string): boolean {
  return /\b(?:what|which|who)\b/i.test(query) &&
    (
      /\b(?:\d+\s+|a\s+)?(?:days?|weeks?|months?|years?)\s+ago\b/i.test(query) ||
      /\blast\s+(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|week|weekend|month)\b/i.test(query) ||
      /\bvalentine'?s\s+day\b/i.test(query)
    ) &&
    /\b(?:activity|activities|airline|concert|event|flight|gardening|music|participat|sport|sports|went|with)\b/i.test(query);
}

export function isSleepBeforeAppointmentQuery(query: string): boolean {
  return /\bwhat\s+time\b/i.test(query) &&
    /\b(?:go|went|get|got)\s+to\s+bed\b/i.test(query) &&
    /\bappointment\b/i.test(query);
}

export function isTemporalIntervalEvidenceFact(entry: RankedFactCandidate): boolean {
  return isDatedEventFact(entry) ||
    (
      hasConversationEvidenceTag(entry) &&
      DATE_OR_TIME_FACT_PATTERN.test(valueBearingFactContent(entry.fact.content))
    );
}

export function isSourceOrderedFact(entry: RankedFactCandidate): boolean {
  return entry.fact.tags?.includes(SOURCE_ORDER_TAG) === true;
}

export function isTemporalOrderFact(entry: RankedFactCandidate): boolean {
  return isDatedEventFact(entry) || isSourceOrderedFact(entry);
}

export function temporalIntervalBoundaryPriority(input: {
  content: string;
  entry: RankedFactCandidate;
  language: LanguageService;
  query: string;
  queryLocale: string;
}): number {
  const anchors = temporalIntervalAnchorFragments(input.query);
  if (anchors.length === 0) {
    return 0;
  }
  if (!anchors.some(hasTemporalIntervalCredentialAcquisitionAnchor)) {
    return 0;
  }

  const content = stripEvidencePrefix(input.content);
  const contentTopics = selectorTopicTokens(
    content,
    input.language,
    input.entry.locale,
  );
  let bestPriority = 0;
  for (const anchor of anchors) {
    const anchorTopics = selectorTopicTokens(
      anchor,
      input.language,
      input.queryLocale,
    );
    const importantAnchorTopics = [...anchorTopics].filter(
      (token) => !TEMPORAL_INTERVAL_ANCHOR_STOPWORDS.has(token),
    );
    const overlap = selectorTopicOverlapCount(anchorTopics, contentTopics);
    const importantOverlap = importantAnchorTopics.filter((token) =>
      contentTopics.has(token),
    ).length;
    const actionPattern = temporalIntervalActionPattern(anchor);
    const actionBonus = actionPattern?.test(content) === true ? 120 : 0;
    if (overlap < 2 && (importantOverlap === 0 || actionBonus === 0)) {
      continue;
    }

    const boundaryObjectBonus = importantOverlap >= Math.min(
      2,
      Math.max(1, importantAnchorTopics.length),
    )
      ? 80
      : importantOverlap * 45;
    bestPriority = Math.max(
      bestPriority,
      overlap * 12 + boundaryObjectBonus + actionBonus,
    );
  }

  return bestPriority;
}

export function hasTemporalEventOrderSignal(
  entry: RankedFactCandidate,
  query: string,
): boolean {
  if (!isTemporalOrderFact(entry)) {
    return false;
  }

  const importedSourceOrder = isSourceOrderedFact(entry);

  if (
    importedSourceOrder &&
    isUserGroundedRecallQuery(query) &&
    !hasUserAnswerTag(entry)
  ) {
    return false;
  }

  if (
    importedSourceOrder &&
    isPersonalWorkChallengeEventOrderQuery(query) &&
    !hasPersonalWorkChallengeEventSignal(entry)
  ) {
    return false;
  }

  return (
    (
      importedSourceOrder ||
      entry.intentScore > 0 ||
      entry.lexicalScore >= 0.03 ||
      entry.subjectScore > 0 ||
      (
        hasTrustedAggregateEvidence(entry) &&
        REALIZED_TEMPORAL_EVENT_FACT_PATTERN.test(
          valueBearingFactContent(entry.fact.content),
        )
      ) ||
      (
        hasTrustedAggregateEvidence(entry) &&
        HEALTH_ISSUE_EVENT_FACT_PATTERN.test(
          valueBearingFactContent(entry.fact.content),
        )
      )
    )
  );
}

export function temporalOrderEvidencePriority(
  entry: RankedFactCandidate,
  query?: string,
): number {
  let priority = 0;
  const valueContent = valueBearingFactContent(entry.fact.content);

  if (hasTrustedAggregateEvidence(entry)) {
    priority += 20;
  }
  if (hasUserAnswerTag(entry)) {
    priority += 35;
  }
  if (hasEntityBearingEvidenceSignal(entry)) {
    priority += 30;
  }
  if (REALIZED_TEMPORAL_EVENT_FACT_PATTERN.test(valueContent)) {
    priority += 40;
  }
  if (HEALTH_ISSUE_EVENT_FACT_PATTERN.test(valueContent)) {
    priority += 50;
  }
  if (query && isPersonalWorkChallengeEventOrderQuery(query)) {
    if (PERSONAL_WORK_CHALLENGE_STATE_PATTERN.test(valueContent)) {
      priority += 180;
    }
    if (PERSONAL_WORK_CONTEXT_PATTERN.test(valueContent)) {
      priority += 70;
    }
    if (PERSONAL_LIFE_CONTEXT_PATTERN.test(valueContent)) {
      priority += 70;
    }
    if (PERSONAL_WORK_CHALLENGE_RESPONSE_PATTERN.test(valueContent)) {
      priority += 90;
    }
  }

  return priority;
}

export function datedFactSortKey(entry: RankedFactCandidate): string {
  return stripEvidencePrefix(entry.fact.content).match(
    /\bOn\s+(\d{4}\/\d{2}\/\d{2})\b/u,
  )?.[1] ?? "";
}

export function sourceOrderSortKey(entry: RankedFactCandidate): number | undefined {
  for (const key of ["sourceOrder", "chatId", "chat_id", "sourceMessageIndex"]) {
    const value = entry.fact.attributes?.[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export function compareTemporalFactChronology(
  left: RankedFactCandidate,
  right: RankedFactCandidate,
): number {
  const leftDate = datedFactSortKey(left);
  const rightDate = datedFactSortKey(right);

  if (!leftDate || !rightDate || leftDate === rightDate) {
    const leftSourceOrder = sourceOrderSortKey(left);
    const rightSourceOrder = sourceOrderSortKey(right);
    if (
      leftSourceOrder !== undefined &&
      rightSourceOrder !== undefined &&
      leftSourceOrder !== rightSourceOrder
    ) {
      return leftSourceOrder - rightSourceOrder;
    }

    return temporalOrderEvidencePriority(right) - temporalOrderEvidencePriority(left);
  }

  return leftDate.localeCompare(rightDate);
}
