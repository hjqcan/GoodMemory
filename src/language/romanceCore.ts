import type { MemoryCandidate } from "../domain/memoryCandidate";
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
  expandExplicitFactCandidateClauses,
  normalizeUnicodeForEquality,
  splitClausesGeneric,
  tokenizeUnicodeText,
} from "./generic";
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
  explicitFact: RegExp;
  explicitFactPrefix: RegExp;
  feedback: RegExp;
  optOut: RegExp;
  optOutClauseBoundary: RegExp;
  bareQuestionValue: RegExp;
  postposedQuestionValue: RegExp;
  goal: RegExp;
  inferredFact: RegExp;
  literalQuestionValue: RegExp;
  standaloneFact?: RegExp;
  name: RegExp;
  preference: RegExp;
  role: RegExp;
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
  decompositionBoundary: RegExp;
  analyzeQuery(text: string): LanguageQueryAnalysis;
  analyzeContent(text: string): LanguageContentAnalysis;
  temporalPatterns: readonly RomanceTemporalPattern[];
  wordDate: RomanceWordDate;
  candidatePatterns: RomanceCandidatePatterns;
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

const ROMANCE_QUESTION_CLAUSE_PATTERN =
  /^(?:¿\s*)?(?:quel(?:le|les|s)?|qui|où|quand|pourquoi|comment|combien|est-ce|qu['’]est-ce|qué|cuál(?:es)?|quién(?:es)?|dónde|cuándo|por\s+qué|cómo|cuánto)(?=$|[^\p{L}\p{N}])/iu;
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

function isRomanceExplicitFactQuestion(
  content: string,
  source: string,
  definition: RomancePackDefinition,
): boolean {
  const assignmentIndex = content.search(/[=＝]/u);
  if (assignmentIndex >= 0) {
    const left = content.slice(0, assignmentIndex).trim();
    const right = content.slice(assignmentIndex + 1).trim();
    if (ROMANCE_QUESTION_CLAUSE_PATTERN.test(left)) {
      return true;
    }
    if (/[?？]\s*$/u.test(source)) {
      if (definition.candidatePatterns.assignmentConfirmation.test(right)) {
        return true;
      }
      if (definition.candidatePatterns.postposedQuestionValue.test(right)) {
        return true;
      }
      return !definition.candidatePatterns.literalQuestionValue.test(right) ||
        definition.candidatePatterns.bareQuestionValue.test(right);
    }
    return false;
  }

  return /[?？]\s*$/u.test(source) ||
    definition.candidatePatterns.unpunctuatedQuestion.test(content) ||
    ROMANCE_QUESTION_CLAUSE_PATTERN.test(content);
}

function splitRomanceClauses(
  text: string,
  definition: RomancePackDefinition,
): string[] {
  return splitClausesGeneric(text)
    .flatMap((clause) =>
      definition.candidatePatterns.optOut.test(clause.trim())
        ? [clause]
        : clause.split(definition.candidatePatterns.optOutClauseBoundary)
    )
    .map((clause) => clause.trim())
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
    isRomanceExplicitFactQuestion(clause, source, definition)
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
    locale: string;
    patterns: readonly RomanceTemporalPattern[];
    wordDate: RomanceWordDate;
  },
): LanguageTemporalExpression[] {
  const expressions: LanguageTemporalExpression[] = [];

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

  expressions.push(...parseTechnicalTemporalExpressions(text));
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
    const sourceAnalysis = message.analysis ??
      definition.analyzeContent(message.content);
    for (const clause of clauses) {
      const content = clause.content.trim();
      const clauseAnalysis = clauses.length === 1 && clause.content === message.content
        ? sourceAnalysis
        : definition.analyzeContent(content);
      const isFeedback = clause.disposition === "feedback" ||
        (clause.disposition === "ordinary" &&
          definition.candidatePatterns.feedback.test(content));
      if (isFeedback) {
        pushCandidate(candidates, {
          content,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "feedback",
          metadata: {
            appliesTo: "general_response",
            feedbackKind: clause.disposition === "feedback"
              ? "dont"
              : clauseAnalysis.feedbackKind,
            ...(clause.disposition === "feedback"
              ? {
                optOutTarget: extractRomanceOptOutTarget(
                  content,
                  definition.candidatePatterns.optOut,
                ),
              }
              : {}),
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
        pushCandidate(candidates, {
          content: factContent,
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
  return candidates;
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
        ? tokens.filter((token) => !definition.stopwords.has(token))
        : tokens;
    },
    buildSearchTerms(text) {
      return unique(
        tokenizeUnicodeText(text, definition.defaultLocale).filter(
          (token) => token.length >= 2 && !definition.stopwords.has(token),
        ),
      );
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
    analyzeContent: definition.analyzeContent,
    parseTemporalExpressions(text) {
      return parseRomanceTemporalExpressions(text, {
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
    extractCandidates(input) {
      return extractRomanceCandidates(input, definition);
    },
    render(input) {
      return renderFromCatalog(input, definition.renderCatalog);
    },
  };
}
