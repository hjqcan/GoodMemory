import type { MemoryCandidate } from "../domain/memoryCandidate";
import { createDurableTargetIdentity } from "../domain/memoryCandidate";
import {
  attachLanguageDurableTarget,
  createLanguageDurableOptOutDisposition,
  deriveLanguageDurableTarget,
} from "./durableTarget";
import type { DurableTargetSlotAliases } from "./durableTarget";
import type { FactKind } from "../domain/records";
import type {
  LanguageContentAnalysis,
  LanguageEntityCandidateInput,
  LanguageEntityMention,
  LanguagePack,
  LanguageQueryAnalysis,
  LanguageRenderKey,
  LanguageTemporalExpression,
} from "./contracts";
import type { BehavioralRulePatterns } from "./packHelpers";
import {
  collectProtectedRetrievalTokens,
  expandExplicitFactCandidateClauses,
  hasUnterminatedQuote,
  isExplicitlyQuotedValue,
  isolateDirectiveGrammar,
  maskQuotedText,
  normalizeUnicodeForEquality,
  replaceUnquotedText,
  splitClausesGeneric,
  splitTrailingClause,
  tokenizeUnicodeText,
} from "./generic";
import type { DirectiveGrammarMatch } from "./generic";
import {
  analyzeBehavioralRuleWithPatterns,
  createSourceOfTruthReferenceCandidate,
  decomposeQueryByPattern,
  extractPatternMentions,
  matchesNormalizedEntityAlias,
  parseTechnicalTemporalExpressions,
  renderFromCatalog,
  splitSentencesGeneric,
} from "./packHelpers";
import {
  canResolveOccurrenceExpression,
  hasOccurrenceResolutionContext,
  maskQuotedTemporalLiterals,
} from "./temporal";

export interface RomanceTemporalPattern {
  offset: number;
  pattern: RegExp;
  unit: "day" | "month" | "quarter" | "week" | "year";
}

export interface RomanceWordDate {
  monthNames: readonly string[];
  pattern: RegExp;
}

export interface RomanceCandidatePatterns {
  assignmentConfirmation: RegExp;
  behavioralPreamble: RegExp;
  behavioralDirective: RegExp;
  completedEvent: RegExp;
  correctionPreamble: RegExp;
  currentProject: RegExp;
  explicitFact: RegExp;
  explicitFactPrefix: RegExp;
  durableBehavioralScope: RegExp;
  futurePlan: RegExp;
  hasReportedDirectiveScope(input: DirectiveGrammarMatch): boolean;
  occurrenceConfirmation: RegExp;
  optOut: RegExp;
  optOutClauseBoundary: RegExp;
  optOutConnectorBoundary: RegExp;
  optOutGrammar: RegExp;
  goal: RegExp;
  inferredFact: RegExp;
  standaloneFact?: RegExp;
  name: RegExp;
  preference: RegExp;
  role: RegExp;
  timezone: RegExp;
  unpunctuatedQuestion: RegExp;
}

export interface RomancePackDefinition {
  behavioralRulePatterns: BehavioralRulePatterns;
  analyzerVersion: string;
  compatibilityGroup: string;
  defaultLocale: string;
  id: string;
  locales: readonly string[];
  stopwords: ReadonlySet<string>;
  entityStopwords: ReadonlySet<string>;
  distinctivePatterns: readonly RegExp[];
  incompatiblePatterns: readonly RegExp[];
  interrogativeAnchors: readonly string[];
  nominalClauseAssertion: RegExp;
  decompositionBoundary: RegExp;
  analyzeQuery(text: string): LanguageQueryAnalysis;
  analyzeContent(text: string): LanguageContentAnalysis;
  daysAgoPattern: RegExp;
  temporalPatterns: readonly RomanceTemporalPattern[];
  wordDate: RomanceWordDate;
  candidatePatterns: RomanceCandidatePatterns;
  durableTargetAliases: DurableTargetSlotAliases;
  renderCatalog: Readonly<Record<LanguageRenderKey, string>>;
}

function hasAnyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cleanCapturedValue(value: string): string {
  return value.trim().replace(/[.!?。！？…]+$/u, "").trim();
}

function hasRomanceOccurrenceContext(
  message: Parameters<LanguagePack["extractCandidates"]>[0]["messages"][number],
): boolean {
  return hasOccurrenceResolutionContext(message);
}

function extractRomanceOccurrenceEvent(
  content: string,
  definition: RomancePackDefinition,
  context: {
    locale: string;
    observedAt?: string;
    timezone?: string;
  },
): { content: string; occurrenceExpression: LanguageTemporalExpression } | undefined {
  if (
    /[?？]/u.test(content) ||
    definition.candidatePatterns.occurrenceConfirmation.test(content) ||
    definition.candidatePatterns.futurePlan.test(content) ||
    /\b(?:quoi|qui|où|quand|pourquoi|comment|combien|qué|cuál|quién|dónde|cuándo|cómo|cuánto)\s*[.!]?$/iu.test(
      content,
    ) ||
    /\b(?:ne|n['’])[^.!?]{0,40}\b(?:pas|jamais)\b/iu.test(content)
  ) {
    return undefined;
  }
  const maskedLiterals = maskQuotedTemporalLiterals(content);
  const occurrenceExpression = parseRomanceTemporalExpressions(
    maskedLiterals,
    {
      daysAgoPattern: definition.daysAgoPattern,
      locale: definition.defaultLocale,
      patterns: definition.temporalPatterns,
      wordDate: definition.wordDate,
    },
  )[0];
  if (!occurrenceExpression) {
    return undefined;
  }

  const expressionIndex = maskedLiterals.indexOf(occurrenceExpression.raw);
  const before = content.slice(0, expressionIndex).replace(
    /\b(?:en|pendant|durante)\s*$/iu,
    "",
  );
  const after = content.slice(expressionIndex + occurrenceExpression.raw.length);
  const canonical = `${before}${after}`
    .replace(/^\s*[,;:]\s*/u, "")
    .replace(/\s+([,.;!?])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
  const canonicalize = canResolveOccurrenceExpression({
    ...context,
    expression: occurrenceExpression,
  });

  return definition.candidatePatterns.completedEvent.test(canonical)
    ? {
      content: canonicalize ? canonical : content,
      occurrenceExpression,
    }
    : undefined;
}

function hasSemanticContent(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function extractRomanceOptOutTarget(
  content: string,
  optOutPattern: RegExp,
): string {
  return content
    .replace(optOutPattern, "")
    .replace(/^\s*(?:que\b\s*)?[:：,]?\s*/iu, "")
    .trim();
}

const ROMANCE_FACT_COUNT_PATTERN =
  /^\s*(?:s['’]il\s+(?:te|vous)\s+plaît|por\s+favor)?\s*,?\s*(?:souviens-toi|rappelez-vous|mémorise|recuerda|recuérdalo|memoriza)\s+(?:de\s+|d['’])?(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+(?:choses?|cosas?)\b/iu;

function romanceFactCount(content: string): number {
  const token = content.match(ROMANCE_FACT_COUNT_PATTERN)?.[1]?.toLowerCase();
  if (!token) {
    return 1;
  }
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return numeric;
  }
  const counts: Readonly<Record<string, number>> = {
    cinq: 5,
    cinco: 5,
    cuatro: 4,
    deux: 2,
    diez: 10,
    dix: 10,
    dos: 2,
    huit: 8,
    neuf: 9,
    nueve: 9,
    ocho: 8,
    quatre: 4,
    seis: 6,
    sept: 7,
    siete: 7,
    six: 6,
    tres: 3,
    trois: 3,
    un: 1,
    una: 1,
    une: 1,
    uno: 1,
  };
  return counts[token] ?? 1;
}

function romanceInterrogativeAnchorSource(
  definition: RomancePackDefinition,
): string {
  return definition.interrogativeAnchors
    .map((anchor) => anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
    .join("|");
}

function romanceInterrogativeAnchorPattern(
  definition: RomancePackDefinition,
): RegExp {
  return new RegExp(
    `^(?:¿\\s*)?(?:${romanceInterrogativeAnchorSource(definition)})(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  );
}

function romancePostposedQuestionValuePattern(
  definition: RomancePackDefinition,
): RegExp {
  return new RegExp(
    `[,，、]\\s*(?:${romanceInterrogativeAnchorSource(definition)})$`,
    "iu",
  );
}

function stripRomanceInterrogativeAnchors(
  text: string,
  definition: RomancePackDefinition,
): string {
  return replaceUnquotedText(
    text,
    new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${romanceInterrogativeAnchorSource(definition)})(?![\\p{L}\\p{N}])`,
      "giu",
    ),
    " ",
  );
}

function romanceRetrievalTokens(
  text: string,
  definition: RomancePackDefinition,
  minimumLength: number,
): string[] {
  const protectedTokens = collectProtectedRetrievalTokens(
    text,
    definition.defaultLocale,
  );
  return tokenizeUnicodeText(
    stripRomanceInterrogativeAnchors(text, definition),
    definition.defaultLocale,
  ).filter((token) =>
    protectedTokens.has(token) ||
    (token.length >= minimumLength && !definition.stopwords.has(token))
  );
}

function isRomanceInterrogativeClause(
  content: string,
  source: string,
  definition: RomancePackDefinition,
): boolean {
  const unquotedContent = maskQuotedText(content).trim();
  const unquotedSource = maskQuotedText(source).trim();
  const anchorPattern = romanceInterrogativeAnchorPattern(definition);
  if (
    !/[?？]\s*$/u.test(unquotedSource) &&
    anchorPattern.test(unquotedContent) &&
    definition.nominalClauseAssertion.test(unquotedContent) &&
    !new RegExp(
      `(?:${romanceInterrogativeAnchorSource(definition)})$`,
      "iu",
    ).test(unquotedContent)
  ) {
    return false;
  }
  const leadingCommaIndex = unquotedContent.search(/[,，]/u);
  if (
    !/[?？]\s*$/u.test(unquotedSource) &&
    leadingCommaIndex >= 0 &&
    anchorPattern.test(unquotedContent)
  ) {
    const mainClause = unquotedContent.slice(leadingCommaIndex + 1).trim();
    if (!isRomanceInterrogativeClause(mainClause, mainClause, definition)) {
      return false;
    }
  }
  if (definition.candidatePatterns.occurrenceConfirmation.test(unquotedContent)) {
    return true;
  }
  const assignmentIndex = content.search(/[=＝]/u);
  if (assignmentIndex >= 0) {
    const left = content.slice(0, assignmentIndex).trim();
    const right = content.slice(assignmentIndex + 1).trim();
    if (anchorPattern.test(maskQuotedText(left).trim())) {
      return true;
    }
    if (hasUnterminatedQuote(right)) {
      return true;
    }
    if (isExplicitlyQuotedValue(right)) {
      return false;
    }
    if (/[?？]\s*$/u.test(unquotedSource)) {
      if (definition.candidatePatterns.assignmentConfirmation.test(right)) {
        return true;
      }
      if (romancePostposedQuestionValuePattern(definition).test(right)) {
        return true;
      }
      return true;
    }
    return false;
  }

  const hasDeclarativeTerminator = /[.!。！]\s*$/u.test(unquotedSource);
  const statementBody = hasDeclarativeTerminator
    ? unquotedContent.replace(/[.!。！]\s*$/u, "").trim()
    : unquotedContent;

  return /[?？]\s*$/u.test(unquotedSource) ||
    /^¿/u.test(unquotedSource) ||
    definition.candidatePatterns.unpunctuatedQuestion.test(statementBody) ||
    (!hasDeclarativeTerminator && anchorPattern.test(unquotedContent));
}

function analyzeRomanceContent(
  content: string,
  definition: RomancePackDefinition,
): LanguageContentAnalysis {
  const analysis = definition.analyzeContent(content);
  return {
    ...analysis,
    behavioralDirective: classifyRomanceBehavioralDirective(
      content,
      definition,
      analysis,
    ),
    interrogative: isRomanceInterrogativeClause(
      content,
      content,
      definition,
    ),
  };
}

function classifyRomanceBehavioralDirective(
  content: string,
  definition: RomancePackDefinition,
  analysis = definition.analyzeContent(content),
): NonNullable<LanguageContentAnalysis["behavioralDirective"]> {
  const trimmed = content.trim();
  if (
    definition.candidatePatterns.explicitFactPrefix.test(trimmed) ||
    definition.candidatePatterns.optOut.test(trimmed) ||
    analysis.sourceOfTruthDirective ||
    definition.candidatePatterns.preference.test(trimmed)
  ) {
    return "none";
  }

  const unquoted = maskQuotedText(trimmed).trim();
  if (!unquoted) {
    return "none";
  }
  const correctionMatch = unquoted.match(
    definition.candidatePatterns.correctionPreamble,
  );
  const corrected = correctionMatch
    ? unquoted.slice(correctionMatch[0].length).trim()
    : unquoted;
  if (!corrected) {
    return correctionMatch ? "one_off" : "none";
  }
  const directiveBody = corrected
    .replace(definition.candidatePatterns.durableBehavioralScope, "")
    .replace(/^[：:,，;；\s]+/u, "");
  const namedActionAssertion =
    /^\p{L}+(?:['’-]\p{L}+)*\s+(?:est|sont|était|étaient|es|está|son|era|fue)\b/iu
      .test(directiveBody);
  const structuralBehavioralDirective = definition.id === "fr"
    ? /^\p{L}+ez\s+(?:pourquoi|comment|quoi|le|la|les|un|une|ce|cet|cette|ces)(?=$|[^\p{L}\p{N}])/iu
      .test(directiveBody)
    : /^\p{L}+(?:a|e)\s+(?:por\s+qué|cómo|qué|el|la|los|las|un|una|este|esta|estos|estas)(?=$|[^\p{L}\p{N}])/iu
      .test(directiveBody);
  const frenchInfinitiveSubjectAssertion =
    /^\p{L}+(?:er|ir|re)\s+(?!(?:un|une|le|la|les|des|du|de|d['’]|l['’]|en|à|au|aux|pour|sans|avec)\b)\p{L}+(?:e|es|ent|ait|aient)\b/iu
      .test(directiveBody);
  const durableInfinitiveDirective = definition.id === "fr" &&
    definition.candidatePatterns.durableBehavioralScope.test(corrected) &&
    /^\p{L}+(?:er|ir|re)(?=$|[^\p{L}\p{N}])/iu.test(directiveBody) &&
    !frenchInfinitiveSubjectAssertion;
  const explicitBehavioralDirective = !namedActionAssertion &&
    (definition.candidatePatterns.behavioralDirective.test(corrected) ||
      definition.candidatePatterns.behavioralDirective.test(directiveBody) ||
      structuralBehavioralDirective ||
      durableInfinitiveDirective);
  if (
    definition.candidatePatterns.durableBehavioralScope.test(corrected) &&
    explicitBehavioralDirective
  ) {
    return "durable";
  }
  return explicitBehavioralDirective ? "one_off" : "none";
}

function splitRomanceClauses(
  text: string,
  definition: RomancePackDefinition,
): string[] {
  return splitClausesGeneric(text)
    .filter(Boolean)
    .flatMap((clause) =>
      definition.candidatePatterns.explicitFactPrefix.test(clause.trim()) ||
        definition.candidatePatterns.optOut.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) =>
            isRomanceInterrogativeClause(candidate, candidate, definition),
          (candidate) =>
            /[?？]\s*$/u.test(maskQuotedText(candidate)) ||
            definition.candidatePatterns.unpunctuatedQuestion.test(
              maskQuotedText(candidate).trim(),
            ),
        )
    )
    .flatMap((clause) =>
      definition.candidatePatterns.explicitFactPrefix.test(clause.trim()) ||
        definition.candidatePatterns.optOut.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) =>
            classifyRomanceBehavioralDirective(candidate, definition) !==
              "none" ||
            definition.candidatePatterns.durableBehavioralScope.test(
              maskQuotedText(candidate).trim(),
            ),
          (candidate) =>
            classifyRomanceBehavioralDirective(candidate, definition) !==
              "none",
          (candidate) =>
            definition.candidatePatterns.behavioralPreamble.test(
              candidate.trim(),
            ),
        )
    )
    .flatMap((clause) =>
      clause.split(definition.candidatePatterns.optOutConnectorBoundary)
    )
    .map((clause) =>
      isolateDirectiveGrammar(
        clause,
        definition.candidatePatterns.optOutGrammar,
        definition.candidatePatterns.hasReportedDirectiveScope,
      )
    )
    .flatMap((clause) =>
      definition.candidatePatterns.optOut.test(clause.trim())
        ? [clause]
        : clause.split(definition.candidatePatterns.optOutClauseBoundary)
    )
    .filter(Boolean);
}

function extractExplicitFactClauses(
  content: string,
  definition: RomancePackDefinition,
) {
  const trimmed = content.trim();
  if (definition.candidatePatterns.optOut.test(trimmed)) {
    return {
      clauses: [{ content: trimmed, disposition: "feedback" as const }],
      status: "complete" as const,
    };
  }

  const match = content.match(definition.candidatePatterns.explicitFact);
  if (!match) {
    return definition.candidatePatterns.explicitFactPrefix.test(content)
      ? { clauses: [], status: "invalid" as const }
      : undefined;
  }

  const expectedFactCount = romanceFactCount(content);
  const payload = match.slice(1).find((value) => value !== undefined) ?? "";
  if (/^[\s:：,]*[?？]/u.test(payload)) {
    return { clauses: [], status: "invalid" as const };
  }
  const clauses = splitRomanceClauses(payload, definition)
    .map((source) => ({
      content: source
        .trim()
        .replace(/^[\s:：,，;；.!?。！？…]+/u, "")
        .replace(/[\s:：,，;；.!?。！？…]+$/u, "")
        .trim(),
      source,
    }))
    .filter(({ content: clause }) => hasSemanticContent(clause));
  if (clauses.length < expectedFactCount) {
    return ROMANCE_FACT_COUNT_PATTERN.test(content)
      ? {
        clauses: clauses.map(({ content: clause }) => ({
          content: clause,
          disposition: definition.candidatePatterns.optOut.test(clause)
            ? "feedback" as const
            : "fact" as const,
        })),
        status: "incomplete-counted-list" as const,
      }
      : { clauses: [], status: "invalid" as const };
  }
  if (clauses.some(({ content: clause, source }) =>
    !definition.candidatePatterns.optOut.test(clause) &&
    isRomanceInterrogativeClause(clause, source, definition)
  )) {
    return { clauses: [], status: "invalid" as const };
  }

  return {
    clauses: clauses.slice(0, expectedFactCount).map(({ content: clause }) => ({
      content: clause,
      disposition: definition.candidatePatterns.optOut.test(clause)
        ? "feedback" as const
        : "fact" as const,
    })),
    status: "complete" as const,
  };
}

function factKind(analysis: LanguageContentAnalysis): FactKind {
  if (analysis.blockerFact) return "blocker";
  if (analysis.openLoopFact) return "open_loop";
  if (analysis.focusFact) return "focus_update";
  if (analysis.projectStateFact) return "project_state";
  return "generic_project";
}

function pushCandidate(
  candidates: MemoryCandidate[],
  candidate: MemoryCandidate,
): void {
  const duplicate = candidates.some(
    ({ content, kindHint, sourceMessageIndex }) =>
      content === candidate.content &&
      kindHint === candidate.kindHint &&
      sourceMessageIndex === candidate.sourceMessageIndex,
  );
  if (!duplicate) {
    candidates.push(candidate);
  }
}

export function detectLatinLanguage(
  texts: readonly string[],
  input: {
    distinctivePatterns: readonly RegExp[];
    incompatiblePatterns: readonly RegExp[];
  },
): "compatible" | "distinctive" | "none" {
  const joined = texts.join(" ");
  if (hasAnyPattern(joined, input.distinctivePatterns)) {
    return "distinctive";
  }
  if (
    hasAnyPattern(joined, input.incompatiblePatterns) ||
    !/\p{Script=Latin}/u.test(joined)
  ) {
    return "none";
  }
  return "compatible";
}

export function parseRomanceTemporalExpressions(
  text: string,
  input: {
    daysAgoPattern: RegExp;
    locale: string;
    patterns: readonly RomanceTemporalPattern[];
    wordDate: RomanceWordDate;
  },
): LanguageTemporalExpression[] {
  const technical = parseTechnicalTemporalExpressions(text);
  const instant = technical.find((expression) => "iso" in expression);
  if (instant) {
    return [instant, ...technical.filter(({ raw }) => raw !== instant.raw)];
  }
  const expressions: LanguageTemporalExpression[] = [];

  const daysAgo = text.match(input.daysAgoPattern);
  if (daysAgo?.[1]) {
    expressions.push({
      kind: "relative",
      offset: -Number(daysAgo[1]),
      raw: daysAgo[0],
      unit: "day",
    });
  }

  const wordDate = text.match(input.wordDate.pattern);
  if (wordDate?.[1] && wordDate[2] && wordDate[3]) {
    const normalizedMonth = wordDate[2]
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase(input.locale);
    const month = input.wordDate.monthNames.findIndex(
      (name) =>
        name.normalize("NFD").replace(/\p{M}/gu, "")
          .toLocaleLowerCase(input.locale) === normalizedMonth,
    ) + 1;
    if (month > 0) {
      expressions.push({
        calendar: {
          day: Number(wordDate[1]),
          month,
          year: Number(wordDate[3]),
        },
        kind: "absolute",
        raw: wordDate[0],
      });
    }
  }

  const numericDate = text.match(
    /(?:^|[^\d])(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:$|[^\d])/u,
  );
  if (numericDate) {
    expressions.push({
      calendar: {
        day: Number(numericDate[1]),
        month: Number(numericDate[2]),
        year: Number(numericDate[3]),
      },
      kind: "absolute",
      raw: numericDate[0].trim(),
    });
  }

  for (const { offset, pattern, unit } of input.patterns) {
    const match = text.match(pattern);
    if (match) {
      expressions.push({
        kind: "relative",
        offset,
        raw: match[0],
        unit,
      });
    }
  }

  expressions.push(...technical);
  const seen = new Set<string>();
  return expressions.filter((expression) => {
    const key = `${expression.kind}\u0000${expression.raw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractLatinEntityMentions(
  text: string,
  stopwords: ReadonlySet<string>,
): LanguageEntityMention[] {
  return extractPatternMentions(text, [
    { kind: "term", pattern: /[«“"]([^»”"]{2,80})[»”"]/gu },
    {
      kind: "term",
      pattern:
        /(?:^|[^\p{L}\p{N}])(\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+\p{Lu}[\p{L}\p{M}'’.-]*){0,4})/gu,
    },
    {
      kind: "identifier",
      pattern: /\b([A-Za-z]+[-_]\d+|[A-Z]{2,}\d*)\b/gu,
    },
  ]).filter(({ normalized }) => !stopwords.has(normalized));
}

export function acceptsLatinEntityCandidate(
  input: LanguageEntityCandidateInput,
  stopwords: ReadonlySet<string>,
): boolean {
  const surfaces = input.aliases.length > 0
    ? input.aliases
    : [input.canonicalKey];
  return surfaces.some((surface) => {
    const normalized = normalizeUnicodeForEquality(surface);
    if (normalized.length < 2 || stopwords.has(normalized)) {
      return false;
    }
    if (!/^\p{Lu}[\p{Ll}\p{M}]+$/u.test(surface.trim())) {
      return true;
    }
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lowercaseOccurrence = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`,
      "u",
    );
    return !input.documentTexts.some((document) =>
      lowercaseOccurrence.test(document.normalize("NFKC"))
    );
  });
}

function extractRomanceCandidates(
  input: Parameters<LanguagePack["extractCandidates"]>[0],
  definition: RomancePackDefinition,
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  for (const [messageIndex, message] of input.messages.entries()) {
    if (message.role !== "user") continue;
    const sourceMessageIndex = message.sourceMessageIndex ?? messageIndex;
    const clauses = expandExplicitFactCandidateClauses(
      message.content,
      (content) => extractExplicitFactClauses(content, definition),
      (content) => splitRomanceClauses(content, definition),
    );
    const canonicalSourceAnalysis = analyzeRomanceContent(
      message.content,
      definition,
    );
    const sourceAnalysis = {
      ...(message.analysis ?? canonicalSourceAnalysis),
      behavioralDirective: canonicalSourceAnalysis.behavioralDirective,
      interrogative: canonicalSourceAnalysis.interrogative,
    };
    for (const clause of clauses) {
      const content = clause.content.trim();
      const clauseAnalysis = clauses.length === 1 && clause.content === message.content
        ? sourceAnalysis
        : analyzeRomanceContent(content, definition);
      if (
        clause.disposition === "ordinary" &&
        (isRomanceInterrogativeClause(content, content, definition) ||
          clauseAnalysis.behavioralDirective === "one_off")
      ) {
        continue;
      }
      const isFeedback = clause.disposition === "feedback" ||
        (clause.disposition === "ordinary" &&
          clauseAnalysis.behavioralDirective === "durable");
      if (isFeedback) {
        const optOutTarget = clause.disposition === "feedback"
          ? extractRomanceOptOutTarget(
            content,
            definition.candidatePatterns.optOut,
          )
          : undefined;
        pushCandidate(candidates, {
          content,
          ...(optOutTarget
            ? {
              disposition: createLanguageDurableOptOutDisposition(
                optOutTarget,
                definition.durableTargetAliases,
              ),
            }
            : {}),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "feedback",
          metadata: {
            appliesTo: "general_response",
            feedbackKind: clause.disposition === "feedback"
              ? "dont"
              : clauseAnalysis.feedbackKind,
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      const occurrenceContext = hasRomanceOccurrenceContext(message);
      const occurrenceEvent = extractRomanceOccurrenceEvent(
        content,
        definition,
        {
          locale: input.locale,
          observedAt: message.observedAt,
          timezone: message.timezone,
        },
      );
      if (occurrenceEvent) {
        pushCandidate(candidates, {
          content: occurrenceEvent.content,
          explicitness: occurrenceContext || clause.disposition === "fact"
            ? "explicit"
            : "inferred",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "event",
            occurrenceExpression: occurrenceEvent.occurrenceExpression,
            scopeKind: "identity",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      if (definition.candidatePatterns.futurePlan.test(content)) {
        pushCandidate(candidates, {
          content: cleanCapturedValue(content),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "personal",
            factKind: "open_loop",
            scopeKind: "identity",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
        continue;
      }
      const sourceOfTruthReference = createSourceOfTruthReferenceCandidate({
        analysis: clauseAnalysis,
        nextId: input.nextId,
        sourceMessageIndex,
      });
      if (sourceOfTruthReference) {
        candidates.push(sourceOfTruthReference);
      }
      let hasTypedCandidate = Boolean(
        sourceOfTruthReference &&
          clauseAnalysis.sourceOfTruthDirective?.currentPointer,
      );
      const name = content.match(definition.candidatePatterns.name)?.[1];
      if (name) {
        hasTypedCandidate = true;
        pushCandidate(candidates, {
          content: cleanCapturedValue(name),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "name" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const role = content.match(definition.candidatePatterns.role)?.[1];
      if (role) {
        hasTypedCandidate = true;
        pushCandidate(candidates, {
          content: cleanCapturedValue(role),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "role" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const timezone = content.match(
        definition.candidatePatterns.timezone,
      )?.[1];
      if (timezone) {
        hasTypedCandidate = true;
        pushCandidate(candidates, {
          content: cleanCapturedValue(timezone),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "timezone" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const preference = content.match(
        definition.candidatePatterns.preference,
      )?.[1];
      if (preference) {
        hasTypedCandidate = true;
        const preferenceValue = cleanCapturedValue(preference);
        pushCandidate(candidates, {
          content: preferenceValue,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "preference",
          metadata: {
            preferenceCategory: "response_style",
            preferenceValue,
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const goal = content.match(definition.candidatePatterns.goal)?.[1];
      if (goal) {
        hasTypedCandidate = true;
        pushCandidate(candidates, {
          content: cleanCapturedValue(goal),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "goal",
            factKind: "focus_update",
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const standaloneFact =
        definition.candidatePatterns.standaloneFact?.test(content) === true;
      const explicitFact = clause.disposition === "fact" || standaloneFact
        ? content
        : undefined;
      const inferredFact = !sourceOfTruthReference && !explicitFact &&
        !isFeedback &&
        content.length >= 16 &&
        definition.candidatePatterns.inferredFact.test(content)
        ? content
        : undefined;
      const fact = explicitFact ?? inferredFact;
      if (fact && !(explicitFact && hasTypedCandidate)) {
        const factContent = cleanCapturedValue(fact);
        const currentProject = content.match(
          definition.candidatePatterns.currentProject,
        )?.[1];
        pushCandidate(candidates, {
          content: factContent,
          ...(currentProject
            ? {
              durableTarget: createDurableTargetIdentity(
                "profile:currentProject",
                cleanCapturedValue(currentProject),
              ),
            }
            : {}),
          explicitness: explicitFact ? "explicit" : "inferred",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: factKind(clauseAnalysis),
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

    }
  }
  return candidates.map((candidate) =>
    attachLanguageDurableTarget(candidate, definition.durableTargetAliases)
  );
}

export function createRomanceLanguagePack(
  definition: RomancePackDefinition,
): LanguagePack {
  return {
    analyzerVersion: definition.analyzerVersion,
    apiVersion: 1,
    compatibilityGroup: definition.compatibilityGroup,
    defaultLocale: definition.defaultLocale,
    id: definition.id,
    locales: definition.locales,
    detect({ texts }) {
      return detectLatinLanguage(texts, definition);
    },
    normalizeForEquality: normalizeUnicodeForEquality,
    tokenizeForScoring(text, mode, options) {
      const minimumLength = mode === "overlap" ? 3 : 2;
      const tokens = tokenizeUnicodeText(text, definition.defaultLocale)
        .filter((token) => token.length >= minimumLength);
      return options?.excludeStopwords
        ? romanceRetrievalTokens(text, definition, minimumLength)
        : tokens;
    },
    buildSearchTerms(text) {
      return unique(romanceRetrievalTokens(text, definition, 2));
    },
    splitClauses(text) {
      return splitRomanceClauses(text, definition);
    },
    splitSentences: splitSentencesGeneric,
    decomposeQuery(text) {
      return decomposeQueryByPattern(text, definition.decompositionBoundary);
    },
    analyzeBehavioralRule(text) {
      return analyzeBehavioralRuleWithPatterns(
        text,
        definition.behavioralRulePatterns,
      );
    },
    analyzeQuery: definition.analyzeQuery,
    analyzeContent(text) {
      return analyzeRomanceContent(text, definition);
    },
    parseTemporalExpressions(text) {
      return parseRomanceTemporalExpressions(text, {
        daysAgoPattern: definition.daysAgoPattern,
        locale: definition.defaultLocale,
        patterns: definition.temporalPatterns,
        wordDate: definition.wordDate,
      });
    },
    extractEntityMentions(text) {
      return extractLatinEntityMentions(text, definition.entityStopwords);
    },
    matchesEntityAlias(query, alias) {
      return matchesNormalizedEntityAlias(
        query,
        alias,
        normalizeUnicodeForEquality,
      );
    },
    acceptsEntityCandidate(input) {
      return acceptsLatinEntityCandidate(input, definition.entityStopwords);
    },
    deriveDurableTarget(candidate) {
      return deriveLanguageDurableTarget(
        candidate,
        definition.durableTargetAliases,
      );
    },
    extractCandidates(input) {
      return extractRomanceCandidates(input, definition);
    },
    render(input) {
      return renderFromCatalog(input, definition.renderCatalog);
    },
  };
}
