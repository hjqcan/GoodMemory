import type {
  LanguageContentAnalysis,
  LanguageEntityMention,
  LanguageQueryAnalysis,
  LanguageRenderInput,
  LanguageRenderKey,
  LanguageSourceOfTruthDirective,
  LanguageTemporalExpression,
} from "./contracts";
import { extractReferencePointerOccurrences } from "../domain/referencePointer";

export function emptyQueryAnalysis(): LanguageQueryAnalysis {
  return {
    actionDriving: false,
    after: false,
    aggregateCount: false,
    answerComposition: false,
    assistantEvidenceRecall: false,
    before: false,
    blocker: false,
    change: false,
    continuation: false,
    current: false,
    directFactualLookup: false,
    exhaustiveList: false,
    factConfirmation: false,
    focus: false,
    guidanceSeeking: false,
    history: false,
    openLoop: false,
    procedural: false,
    projectState: false,
    recommendationStyle: false,
    relation: false,
    referenceSeeking: false,
    role: false,
    userGroundedEventOrder: false,
  };
}

export function emptyContentAnalysis(): LanguageContentAnalysis {
  return {
    assistantAcknowledgement: false,
    assistantContinuity: false,
    blockerFact: false,
    correctionCue: false,
    durableCue: false,
    factPolarity: "unknown",
    feedbackKind: "do",
    focusFact: false,
    openLoopFact: false,
    personalEvidence: false,
    preferenceEvidence: false,
    projectStateFact: false,
    roleFact: false,
    unresolved: false,
  };
}

export function resolveSourceOfTruthDirective(
  text: string,
  matches: {
    affirmed(index: number, pointerLength: number): boolean;
    negated(index: number, pointerLength: number): boolean;
  },
): LanguageSourceOfTruthDirective | undefined {
  const occurrences = extractReferencePointerOccurrences(text);
  const byPointer = new Map<string, typeof occurrences>();
  for (const occurrence of occurrences) {
    const matchesForPointer = byPointer.get(occurrence.pointer);
    if (matchesForPointer) {
      matchesForPointer.push(occurrence);
    } else {
      byPointer.set(occurrence.pointer, [occurrence]);
    }
  }

  const currentPointer = [...byPointer.entries()].find(([, pointerMatches]) =>
    pointerMatches.some(({ index, pointer }) =>
      matches.affirmed(index, pointer.length)
    )
  )?.[0];
  if (!currentPointer) {
    return undefined;
  }

  const supersededPointer = [...byPointer.entries()].find(
    ([pointer, pointerMatches]) =>
      pointer !== currentPointer &&
      pointerMatches.some(({ index, pointer: value }) =>
        matches.negated(index, value.length)
      ),
  )?.[0];

  return {
    currentPointer,
    ...(supersededPointer ? { supersededPointer } : {}),
  };
}

export function splitSentencesGeneric(text: string): string[] {
  return text
    .split(/\r?\n+|(?<=[。！？])|(?<=[.!?])(?=\s|$)/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function decomposeQueryByPattern(
  text: string,
  boundary: RegExp,
): string[] {
  const parts = text
    .split(/\r?\n+|[。？；！]+|(?<=[?.;!])(?=\s|$)/u)
    .flatMap((clause) => clause.split(boundary))
    .map((part) => part.trim().replace(/[?.;!]+$/u, "").trim())
    .filter((part) => part.length >= 2);
  const unique = [...new Set(parts)];
  return unique.length > 1 ? unique : [];
}

export function extractPatternMentions(
  text: string,
  patterns: ReadonlyArray<{ kind?: LanguageEntityMention["kind"]; pattern: RegExp }>,
): LanguageEntityMention[] {
  const mentions = new Map<string, LanguageEntityMention>();
  for (const { kind, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const surface = (match[1] ?? match[0]).trim();
      if (!surface) {
        continue;
      }
      const normalized = surface.normalize("NFKC").toLocaleLowerCase("en-US");
      mentions.set(`${kind ?? "term"}\u0000${normalized}`, {
        ...(kind ? { kind } : {}),
        normalized,
        surface,
      });
    }
  }
  return [...mentions.values()];
}

export function matchesNormalizedEntityAlias(
  query: string,
  alias: string,
  normalize: (value: string) => string,
): boolean {
  const normalizedQuery = normalize(query);
  const normalizedAlias = normalize(alias);
  if (normalizedAlias.length < 2) {
    return false;
  }
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      normalizedAlias,
    )
  ) {
    return normalizedQuery.includes(normalizedAlias);
  }
  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`,
    "u",
  ).test(normalizedQuery);
}

export function parsePatternTemporalExpressions(
  text: string,
  patterns: ReadonlyArray<{
    kind: LanguageTemporalExpression["kind"];
    pattern: RegExp;
    unit?: LanguageTemporalExpression["unit"];
  }>,
): LanguageTemporalExpression[] {
  const expressions: LanguageTemporalExpression[] = [];
  for (const { kind, pattern, unit } of patterns) {
    for (const match of text.matchAll(pattern)) {
      expressions.push({
        kind,
        raw: match[0],
        ...(unit ? { unit } : {}),
      });
    }
  }
  return expressions;
}

export function parseTechnicalTemporalExpressions(
  text: string,
): LanguageTemporalExpression[] {
  return parsePatternTemporalExpressions(text, [
    {
      kind: "absolute",
      pattern: /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/gu,
      unit: "day",
    },
    {
      kind: "absolute",
      pattern: /\btime\s*=\s*(?!unknown\b)[^\]\s]+/giu,
    },
  ]);
}

export function renderFromCatalog(
  input: LanguageRenderInput,
  catalog: Readonly<Record<LanguageRenderKey, string>>,
): string {
  const template = catalog[input.key];
  if (!input.values) {
    return template;
  }
  return Object.entries(input.values).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
