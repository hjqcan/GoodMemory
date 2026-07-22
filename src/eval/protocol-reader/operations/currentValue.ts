// Conflict-update (current value) guide: cue extraction and the
// latest-supported-value evidence guide.

import type { EvidenceTurn } from "../evidenceShared";
import { uniquePreservingOrder, currentValueTopicTokens } from "../evidenceShared";
import { resolveCurrentValue } from "../../../answer/currentValueResolution";
import { createLanguageService } from "../../../language";
import { COUNT_DATE_PATTERN, COUNT_QUANTITY_PATTERN } from "./count";

const CURRENT_VALUE_TIME_PATTERN = /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/giu;

const CURRENT_VALUE_TARGET_CONTEXT_PATTERN =
  /\b(?:to|for|on|by|at|deadline|due|scheduled|rescheduled|moved|shifted|changed|updated|complete|finish|finished|deliver|target)\s*$/iu;

const CURRENT_VALUE_REFERENCE_CONTEXT_PATTERN = /\b(?:as\s+of|reference)\s*$/iu;

const CURRENT_VALUE_SUPERSEDED_CONTEXT_PATTERN =
  /\b(?:from|originally|previously|first|initially)\s*$/iu;

const CURRENT_VALUE_QUANTITY_STOP_UNITS = new Set([
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "to",
]);

const CURRENT_VALUE_GENERIC_TOPIC_WORDS = new Set([
  "coverage",
  "date",
  "metric",
  "metrics",
  "module",
  "scheduled",
  "status",
  "test",
  "tests",
  "value",
]);

function formatCurrentValueEntry(
  entry: NonNullable<ReturnType<typeof resolveCurrentValue>["current"]>,
): string {
  const sourceId = entry.sourceId ?? "unknown";
  const timeAnchor = entry.timeAnchor ?? "unknown";
  return `[t=${timeAnchor} | #${sourceId}] ${entry.content}`;
}

interface CurrentValueCue {
  allValues: string[];
  referenceValues: string[];
  supersededValues: string[];
  targetValues: string[];
}

function collectCurrentValueMentions(input: {
  content: string;
  pattern: RegExp;
}): Array<{ contextPrefix: string; value: string }> {
  const mentions: Array<{ contextPrefix: string; value: string }> = [];
  for (const match of input.content.matchAll(input.pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    const contextPrefix = input.content
      .slice(Math.max(0, index - 48), index)
      .replace(/\s+/gu, " ")
      .trim();
    mentions.push({ contextPrefix, value });
  }
  return mentions;
}

function normalizeCurrentValueQuantityMention(value: string): string | undefined {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const amountWithUnit =
    /^(\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|\$\d+(?:\.\d+)?|\d+(?:\.\d+)?%?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+([a-z][a-z-]*)\b/iu.exec(
      normalized,
    );
  if (!amountWithUnit) {
    return normalized.length > 0 ? normalized : undefined;
  }
  const unit = amountWithUnit[2].toLowerCase();
  if (CURRENT_VALUE_QUANTITY_STOP_UNITS.has(unit)) {
    return undefined;
  }
  return `${amountWithUnit[1]} ${amountWithUnit[2]}`;
}

function extractCurrentValueCues(content: string): CurrentValueCue {
  const quantityMentions = collectCurrentValueMentions({
    content,
    pattern: COUNT_QUANTITY_PATTERN,
  })
    .map((mention) => ({
      ...mention,
      value: normalizeCurrentValueQuantityMention(mention.value),
    }))
    .filter(
      (mention): mention is { contextPrefix: string; value: string } =>
        mention.value !== undefined,
    );
  const mentions = [
    ...collectCurrentValueMentions({
      content,
      pattern: COUNT_DATE_PATTERN,
    }),
    ...collectCurrentValueMentions({
      content,
      pattern: CURRENT_VALUE_TIME_PATTERN,
    }),
    ...quantityMentions,
  ];

  const targetValues: string[] = [];
  const referenceValues: string[] = [];
  const supersededValues: string[] = [];
  for (const mention of mentions) {
    if (CURRENT_VALUE_REFERENCE_CONTEXT_PATTERN.test(mention.contextPrefix)) {
      referenceValues.push(mention.value);
      continue;
    }
    if (CURRENT_VALUE_SUPERSEDED_CONTEXT_PATTERN.test(mention.contextPrefix)) {
      supersededValues.push(mention.value);
      continue;
    }
    if (CURRENT_VALUE_TARGET_CONTEXT_PATTERN.test(mention.contextPrefix)) {
      targetValues.push(mention.value);
    }
  }

  return {
    allValues: uniquePreservingOrder(mentions.map((mention) => mention.value)),
    referenceValues: uniquePreservingOrder(referenceValues),
    supersededValues: uniquePreservingOrder(supersededValues),
    targetValues: uniquePreservingOrder(targetValues),
  };
}

function formatCurrentValueCues(content: string): string | undefined {
  const cues = extractCurrentValueCues(content);
  if (cues.allValues.length === 0) {
    return undefined;
  }
  return [
    "Priority current-value cues:",
    `updated target values: ${
      cues.targetValues.length > 0 ? cues.targetValues.join(", ") : "(none detected)"
    }`,
    `as-of/reference values: ${
      cues.referenceValues.length > 0
        ? cues.referenceValues.join(", ")
        : "(none detected)"
    }`,
    `superseded/source values: ${
      cues.supersededValues.length > 0
        ? cues.supersededValues.join(", ")
        : "(none detected)"
    }`,
    `all date/time/quantity mentions in latest/current candidate: ${cues.allValues.join(
      ", ",
    )}`,
    "Prefer updated target values when the question asks the current schedule, deadline, amount, or count.",
    "Do not answer with an as-of/reference value unless the question asks for that reference date.",
  ].join("\n");
}

function currentValueSpecificTopicTokens(value: string): Set<string> {
  const tokens = currentValueTopicTokens(value);
  return new Set(
    [...tokens].filter((token) => !CURRENT_VALUE_GENERIC_TOPIC_WORDS.has(token)),
  );
}

function currentValueOverlapScore(
  turn: EvidenceTurn,
  queryTokens: ReadonlySet<string>,
): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const turnTokens = currentValueTopicTokens(turn.content);
  return [...queryTokens].filter((token) => turnTokens.has(token)).length;
}

function selectCurrentValueTurns(input: {
  ordered: readonly EvidenceTurn[];
  question: string;
}): EvidenceTurn[] {
  const queryTokens = currentValueTopicTokens(input.question);
  if (queryTokens.size === 0) {
    return [...input.ordered];
  }
  const specificTokens = currentValueSpecificTopicTokens(input.question);
  if (specificTokens.size > 0) {
    const specificSelected = input.ordered.filter(
      (turn) => currentValueOverlapScore(turn, specificTokens) > 0,
    );
    if (specificSelected.length > 0) {
      return specificSelected;
    }
  }
  const selected = input.ordered.filter(
    (turn) => currentValueOverlapScore(turn, queryTokens) > 0,
  );
  return selected.length > 0 ? selected : [...input.ordered];
}

export function buildCurrentValueEvidenceGuide(input: {
  ordered: readonly EvidenceTurn[];
  question: string;
}): string {
  const language = createLanguageService();
  const selectedTurns = selectCurrentValueTurns({
    ordered: input.ordered,
    question: input.question,
  });
  const resolution = resolveCurrentValue(
    selectedTurns.map((turn) => {
      const context = language.resolveFromText({ text: turn.content });
      return {
        content: turn.content,
        orderKey: turn.orderKey,
        polarity: language.analyzeContent(turn.content, context).factPolarity,
        sourceId: turn.sourceId,
        timeAnchor: turn.timeAnchor,
      };
    }),
  );

  if (!resolution.current) {
    return [
      "Current-value ledger:",
      "Latest/current candidate: (no evidence)",
      "Earlier history: (none in retrieved evidence)",
    ].join("\n");
  }

  const lines = [
    "Current-value ledger:",
    `Latest/current candidate: ${formatCurrentValueEntry(resolution.current)}`,
  ];
  const currentValueCues = formatCurrentValueCues(resolution.current.content);
  if (currentValueCues) {
    lines.push(currentValueCues);
  }
  if (resolution.history.length > 0) {
    lines.push("Earlier history superseded by that latest candidate:");
    lines.push(
      ...resolution.history.map(
        (entry, index) => `${index + 1}. ${formatCurrentValueEntry(entry)}`,
      ),
    );
  } else {
    lines.push("Earlier history: (none in retrieved evidence)");
  }
  if (resolution.contradiction) {
    lines.push(
      "Contradiction signal: the latest candidate is a denial or retraction after earlier affirmative evidence; surface both sides and ask for clarification instead of reporting only the denial.",
    );
  } else {
    lines.push(
      "Use exact values, dates, amounts, names, and status terms from the latest/current candidate when answering the current-value question.",
    );
  }
  return lines.join("\n");
}
