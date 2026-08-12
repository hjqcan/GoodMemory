import type { MemoryCandidate } from "../domain/memoryCandidate";
import {
  extractReferencePointerOccurrences,
  parseReferencePointer,
} from "../domain/referencePointer";
import type {
  LanguageBehavioralRuleAnalysis,
  LanguageContentAnalysis,
  LanguageEntityMention,
  LanguageQueryAnalysis,
  LanguageRenderInput,
  LanguageRenderKey,
  LanguageSourceOfTruthDirective,
  LanguageTemporalExpression,
} from "./contracts";

export interface BehavioralRulePatterns {
  firstAction: readonly RegExp[];
  format: RegExp;
  general: RegExp;
  hostAction?: BehavioralHostActionPatterns;
  negative: RegExp;
  trigger?: readonly RegExp[];
}

export interface BehavioralHostActionPatterns {
  destination: readonly RegExp[];
  flags?: readonly RegExp[];
  mode?: readonly RegExp[];
  owner?: readonly RegExp[];
  permissions?: readonly RegExp[];
  sources?: readonly RegExp[];
  tag?: readonly RegExp[];
  verbs?: ReadonlyArray<{ pattern: RegExp; value: string }>;
}

function firstCapturedValue(
  text: string,
  patterns: readonly RegExp[] | undefined,
): string | undefined {
  if (!patterns) {
    return undefined;
  }
  for (const pattern of patterns) {
    const value = text.match(pattern)?.slice(1)
      .find((entry) => entry?.trim())
      ?.trim()
      .replace(/[.,;:!?。！？；，]+$/u, "");
    if (value) {
      return value;
    }
  }
  return undefined;
}

function analyzeHostActionWithPatterns(
  text: string,
  patterns: BehavioralHostActionPatterns | undefined,
): LanguageBehavioralRuleAnalysis["hostAction"] {
  if (!patterns) {
    return undefined;
  }
  const destination = firstCapturedValue(text, patterns.destination);
  const owner = firstCapturedValue(text, patterns.owner);
  const permissions = firstCapturedValue(text, patterns.permissions);
  const mode = firstCapturedValue(text, patterns.mode);
  const tag = firstCapturedValue(text, patterns.tag);
  const flags = uniqueCapturedValues(text, patterns.flags ?? []);
  const explicitSources = uniqueCapturedValues(text, patterns.sources ?? []);
  const verb = patterns.verbs?.find(({ pattern }) => pattern.test(text))?.value;
  const compression = ["bzip2", "gzip", "xz"].find((value) =>
    text.toLowerCase().includes(value)
  );
  const hasSignal = destination || explicitSources.length > 0 || owner ||
    permissions || mode || tag || flags.length > 0 || verb;
  if (!hasSignal) {
    return undefined;
  }
  const excluded = new Set(
    [destination, owner, permissions, mode, tag, ...flags].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const quoted = [...text.matchAll(
    /(['"`])([^'"`]+)\1/gu,
  )]
    .map((match) => match[2]?.trim())
    .filter((value): value is string => Boolean(value));
  const sources = [...new Set([
    ...explicitSources,
    ...quoted.filter((value) => !excluded.has(value)),
  ])];
  return {
    ...(compression ? { compression } : {}),
    ...(destination ? { destination } : {}),
    ...(flags.length > 0 ? { flags } : {}),
    ...(mode ? { mode } : {}),
    ...(owner ? { owner } : {}),
    ...(permissions ? { permissions } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(tag ? { tag } : {}),
    ...(verb ? { verb } : {}),
  };
}

export function analyzeBehavioralRuleWithPatterns(
  text: string,
  patterns: BehavioralRulePatterns,
): LanguageBehavioralRuleAnalysis {
  let firstActionName: string | undefined;
  for (const pattern of patterns.firstAction) {
    const match = text.match(pattern);
    firstActionName = match?.slice(1)
      .find((value) => value?.trim())
      ?.trim()
      .replace(/[.,;:!?。！？；，]+$/u, "");
    if (firstActionName) {
      break;
    }
  }

  const triggerPhrases = patterns.trigger
    ? uniqueCapturedValues(text, patterns.trigger)
    : [];
  const hostAction = analyzeHostActionWithPatterns(text, patterns.hostAction);

  return {
    firstActionName,
    formatRule: patterns.format.test(text),
    generalRule: patterns.general.test(text),
    ...(hostAction ? { hostAction } : {}),
    negativeRule: patterns.negative.test(text),
    ...(triggerPhrases.length > 0 ? { triggerPhrases } : {}),
  };
}

export function uniqueCapturedValues(
  text: string,
  patterns: readonly RegExp[],
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.slice(1).find((entry) => entry?.trim())?.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function emptyBehavioralRuleAnalysis(): LanguageBehavioralRuleAnalysis {
  return {
    firstActionName: undefined,
    formatRule: false,
    generalRule: false,
    negativeRule: false,
  };
}
export function createSourceOfTruthReferenceCandidate(input: {
  analysis: LanguageContentAnalysis | undefined;
  nextId: () => string;
  sourceMessageIndex: number;
  subject?: string;
}): MemoryCandidate | undefined {
  const directive = input.analysis?.sourceOfTruthDirective;
  const currentPointer = parseReferencePointer(directive?.currentPointer);
  if (!currentPointer) {
    return undefined;
  }
  const parsedSupersededPointer = parseReferencePointer(
    directive?.supersededPointer,
  );
  const supersedesPointer = parsedSupersededPointer !== currentPointer
    ? parsedSupersededPointer
    : undefined;

  return {
    content: currentPointer,
    explicitness: "explicit",
    id: input.nextId(),
    kindHint: "reference",
    metadata: {
      referenceKind: "source_of_truth",
      referencePointer: currentPointer,
      referenceTitle: currentPointer.split("/").at(-1) ?? currentPointer,
      subject: input.subject ?? "unknown",
      ...(supersedesPointer ? { supersedesPointer } : {}),
    },
    sourceMessageIndex: input.sourceMessageIndex,
    sourceRole: "user",
  };
}

function extractDirectivePointerOccurrences(
  text: string,
  allowsEmbeddedStart: ((index: number) => boolean) | undefined,
): ReturnType<typeof extractReferencePointerOccurrences> {
  const occurrences = extractReferencePointerOccurrences(text);
  const expanded = new Map<string, (typeof occurrences)[number]>();

  for (const occurrence of occurrences) {
    expanded.set(`${occurrence.index}\u0000${occurrence.pointer}`, occurrence);
    const end = occurrence.index + occurrence.pointer.length;
    for (let start = occurrence.index + 1; start < end; start += 1) {
      if (!allowsEmbeddedStart?.(start)) {
        continue;
      }
      const pointer = parseReferencePointer(text.slice(start, end));
      if (pointer) {
        expanded.set(`${start}\u0000${pointer}`, { index: start, pointer });
      }
    }
  }

  return [...expanded.values()];
}

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
    sensitiveCredential: false,
    unresolved: false,
  };
}

export function resolveSourceOfTruthDirective(
  text: string,
  matches: {
    allowsEmbeddedStart?(index: number): boolean;
    affirmed(index: number, pointerLength: number): boolean;
    negated(index: number, pointerLength: number): boolean;
    trimPointerSuffix?(pointer: string): string;
  },
): LanguageSourceOfTruthDirective | undefined {
  const occurrences = extractDirectivePointerOccurrences(
    text,
    matches.allowsEmbeddedStart,
  ).flatMap((occurrence) => {
    const candidate = matches.trimPointerSuffix?.(occurrence.pointer) ??
      occurrence.pointer;
    const pointer = parseReferencePointer(candidate);
    return pointer ? [{ ...occurrence, pointer }] : [];
  });
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

export function parseTechnicalTemporalExpressions(
  text: string,
): LanguageTemporalExpression[] {
  const expressions: LanguageTemporalExpression[] = [];
  for (const match of text.matchAll(
    /\btime\s*=\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/giu,
  )) {
    expressions.push({ kind: "absolute", raw: match[0], iso: match[1]! });
  }
  for (const match of text.matchAll(
    /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/gu,
  )) {
    if (expressions.some(({ raw }) => raw.includes(match[0]))) {
      continue;
    }
    expressions.push({
      kind: "absolute",
      raw: match[0],
      calendar: {
        day: Number(match[3]),
        month: Number(match[2]),
        year: Number(match[1]),
      },
    });
  }
  return expressions;
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
