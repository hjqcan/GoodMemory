import type {
  LanguageAnalyzerManifest,
  LanguageConfig,
  LanguageCandidateExtractionInput,
  LanguagePack,
  LanguageService,
  LocaleDetector,
  ResolvedLanguageContext,
} from "./contracts";
import type {
  DurableTargetIdentity,
  MemoryCandidate,
} from "../domain/memoryCandidate";
import {
  durableOptOutTargetIdentities,
  durableTargetIdentityKey,
} from "../domain/memoryCandidate";
import { createChineseLanguagePack } from "./chinese";
import { createEnglishLanguagePack } from "./english";
import { createFrenchLanguagePack } from "./french";
import { createNeutralLanguagePack } from "./generic";
import { createJapaneseLanguagePack } from "./japanese";
import { createKoreanLanguagePack } from "./korean";
import { createSpanishLanguagePack } from "./spanish";

const ENGLISH_PACK = createEnglishLanguagePack();
const CHINESE_HANS_PACK = createChineseLanguagePack("Hans");
const CHINESE_HANT_PACK = createChineseLanguagePack("Hant");
const JAPANESE_PACK = createJapaneseLanguagePack();
const KOREAN_PACK = createKoreanLanguagePack();
const FRENCH_PACK = createFrenchLanguagePack();
const SPANISH_PACK = createSpanishLanguagePack();
const NEUTRAL_PACK = createNeutralLanguagePack();

const BUILTIN_PACKS = [
  ENGLISH_PACK,
  CHINESE_HANS_PACK,
  CHINESE_HANT_PACK,
  JAPANESE_PACK,
  KOREAN_PACK,
  FRENCH_PACK,
  SPANISH_PACK,
  NEUTRAL_PACK,
] as const;

const LANGUAGE_RESOLVER_VERSION = "3";
const MAX_SEARCH_TERMS = 128;
const PURE_NUMERIC_TOKEN = /^\p{N}+$/u;

function attachPackDerivedDurableTarget(
  pack: LanguagePack,
  candidate: MemoryCandidate,
): MemoryCandidate {
  if (candidate.durableTarget) {
    return candidate;
  }
  if (!pack.deriveDurableTarget) {
    return candidate;
  }
  const { durableTarget: _producerTarget, ...candidateWithoutTarget } = candidate;
  const durableTarget = pack.deriveDurableTarget(candidateWithoutTarget);
  return durableTarget
    ? { ...candidateWithoutTarget, durableTarget }
    : candidateWithoutTarget;
}

function uniqueDurableTargetIdentities(
  identities: readonly DurableTargetIdentity[],
): DurableTargetIdentity[] {
  return [...new Map(
    identities.map((identity) => [
      durableTargetIdentityKey(identity),
      identity,
    ]),
  ).values()];
}

function deriveOptOutTargetIdentities(
  pack: LanguagePack,
  input: LanguageCandidateExtractionInput,
  text: string,
): DurableTargetIdentity[] {
  let candidateNumber = 0;
  const identities = pack.extractCandidates({
    locale: input.locale,
    messages: [{ content: text, role: "user" }],
    nextId: () => `durable-target-${candidateNumber += 1}`,
  }).flatMap((candidate) => {
    const durableTarget = attachPackDerivedDurableTarget(pack, candidate)
      .durableTarget;
    return durableTarget ? [durableTarget] : [];
  });
  return uniqueDurableTargetIdentities(identities);
}

function authorizePackCandidateGovernance(
  pack: LanguagePack,
  input: LanguageCandidateExtractionInput,
  candidate: MemoryCandidate,
): MemoryCandidate {
  const derivedCandidate = attachPackDerivedDurableTarget(
    pack,
    candidate,
  );
  if (candidate.disposition?.kind !== "durable_opt_out") {
    return derivedCandidate;
  }
  const identities = uniqueDurableTargetIdentities(
    [
      ...durableOptOutTargetIdentities(candidate.disposition.target),
      ...deriveOptOutTargetIdentities(
        pack,
        input,
        candidate.disposition.target.text,
      ),
    ],
  );
  return {
    ...derivedCandidate,
    disposition: {
      kind: "durable_opt_out",
      target: {
        identities,
        match: "exact",
        text: candidate.disposition.target.text,
      },
    },
  };
}

export function isStrongLegacyProjectionLocaleSignal(
  text: string,
  context: ResolvedLanguageContext,
): boolean {
  if (context.localeSource !== "detected") {
    return false;
  }
  const input = { texts: [text] };
  const japaneseSignal = JAPANESE_PACK.detect(input) === "distinctive";
  const distinctiveChinesePack = [CHINESE_HANS_PACK, CHINESE_HANT_PACK]
    .filter((pack) => pack.detect(input) === "distinctive");
  const expectedPackId = japaneseSignal
    ? JAPANESE_PACK.id
    : distinctiveChinesePack.length === 1
      ? distinctiveChinesePack[0]?.id
      : undefined;
  return context.languagePackId === expectedPackId;
}

function stableCompare(left: string, right: string): number {
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalizeLocale(locale: string): string {
  const trimmed = locale.trim();
  if (!trimmed) {
    return "und";
  }
  try {
    return new Intl.Locale(trimmed).toString();
  } catch {
    return trimmed;
  }
}

function requireIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Language pack ${label} must not be empty.`);
  }
  return normalized;
}

function canonicalizeRequiredLocale(locale: string, label: string): string {
  const required = requireIdentity(locale, label);
  try {
    return new Intl.Locale(required).toString();
  } catch {
    throw new Error(`Language pack ${label} must be a valid locale.`);
  }
}

function primaryLanguage(locale: string): string {
  try {
    return new Intl.Locale(locale).language.toLowerCase();
  } catch {
    return locale.toLowerCase().split("-")[0] ?? locale.toLowerCase();
  }
}

function chineseScript(locale: string): "Hans" | "Hant" | undefined {
  if (primaryLanguage(locale) !== "zh") {
    return undefined;
  }
  const normalized = canonicalizeLocale(locale);
  if (normalized.toLowerCase() === "zh") {
    return undefined;
  }
  try {
    const maximized = new Intl.Locale(normalized).maximize();
    return maximized.script === "Hant" ? "Hant" : "Hans";
  } catch {
    return undefined;
  }
}

function localeClaimKey(locale: string): string {
  const canonical = canonicalizeLocale(locale);
  const language = primaryLanguage(canonical);
  if (language === "zh") {
    const script = chineseScript(canonical);
    return script ? `zh-${script.toLowerCase()}` : "zh";
  }
  return canonical.includes("-") ? canonical.toLowerCase() : language;
}

function snapshotPack(pack: LanguagePack): LanguagePack {
  if (pack.apiVersion !== 1) {
    throw new Error(`Unsupported language pack apiVersion for ${pack.id}.`);
  }
  const id = requireIdentity(pack.id, "id");
  const locales = [
    ...new Set(
      pack.locales.map((locale) =>
        canonicalizeRequiredLocale(locale, `${id} locale`)
      ),
    ),
  ];
  return Object.freeze({
    ...pack,
    acceptsEntityCandidate: pack.acceptsEntityCandidate,
    analyzeBehavioralRule: pack.analyzeBehavioralRule,
    analyzeContent: pack.analyzeContent,
    analyzeQuery: pack.analyzeQuery,
    analyzerVersion: requireIdentity(
      pack.analyzerVersion,
      `${id} analyzerVersion`,
    ),
    apiVersion: pack.apiVersion,
    buildSearchTerms: pack.buildSearchTerms,
    compatibilityGroup: requireIdentity(
      pack.compatibilityGroup,
      `${id} compatibilityGroup`,
    ),
    decomposeQuery: pack.decomposeQuery,
    defaultLocale: canonicalizeRequiredLocale(
      pack.defaultLocale,
      `${id} defaultLocale`,
    ),
    detect: pack.detect,
    ...(pack.deriveDurableTarget
      ? { deriveDurableTarget: pack.deriveDurableTarget }
      : {}),
    extractCandidates: pack.extractCandidates,
    extractEntityMentions: pack.extractEntityMentions,
    id,
    locales: Object.freeze(locales),
    matchesEntityAlias: pack.matchesEntityAlias,
    ...(pack.matchesEventPredicate
      ? { matchesEventPredicate: pack.matchesEventPredicate }
      : {}),
    normalizeForEquality: pack.normalizeForEquality,
    parseTemporalExpressions: pack.parseTemporalExpressions,
    render: pack.render,
    splitClauses: pack.splitClauses,
    splitSentences: pack.splitSentences,
    tokenizeForScoring: pack.tokenizeForScoring,
  });
}

function createPackRegistry(customPacks: readonly LanguagePack[] | undefined): {
  byId: ReadonlyMap<string, LanguagePack>;
  packs: readonly LanguagePack[];
} {
  const byId = new Map<string, LanguagePack>(
    BUILTIN_PACKS.map((pack) => {
      const snapshot = snapshotPack(pack);
      return [snapshot.id, snapshot] as const;
    }),
  );
  for (const pack of customPacks ?? []) {
    const snapshot = snapshotPack(pack);
    byId.set(snapshot.id, snapshot);
  }
  const packs = [...byId.values()];
  const claimedLocales = new Map<string, string>();
  for (const pack of packs) {
    for (const locale of pack.locales) {
      const key = localeClaimKey(locale);
      const owner = claimedLocales.get(key);
      if (owner && owner !== pack.id) {
        throw new Error(
          `Language packs ${owner} and ${pack.id} both claim locale ${locale}.`,
        );
      }
      claimedLocales.set(key, pack.id);
    }
  }
  return { byId, packs };
}

function buildAnalyzerManifest(input: {
  defaultLocale: string;
  detection: "auto" | "default_only";
  detectorVersion?: string;
  packs: readonly LanguagePack[];
  usesCustomDetector: boolean;
}): LanguageAnalyzerManifest {
  const packs = input.packs
    .map((pack) => Object.freeze({
      analyzerVersion: pack.analyzerVersion,
      apiVersion: pack.apiVersion,
      compatibilityGroup: pack.compatibilityGroup,
      defaultLocale: pack.defaultLocale,
      id: pack.id,
      locales: Object.freeze([...pack.locales].sort(stableCompare)),
    }))
    .sort((left, right) => stableCompare(left.id, right.id));
  const hasCompletePackIdentity = packs.every(
    (pack) =>
      pack.id.trim().length > 0 &&
      pack.analyzerVersion.trim().length > 0 &&
      pack.compatibilityGroup.trim().length > 0 &&
      pack.defaultLocale.trim().length > 0,
  );
  return Object.freeze({
    defaultLocale: input.defaultLocale,
    detection: input.detection,
    ...(input.usesCustomDetector && input.detectorVersion
      ? { detectorVersion: input.detectorVersion }
      : {}),
    packs: Object.freeze(packs),
    persistable:
      hasCompletePackIdentity &&
      (!input.usesCustomDetector || Boolean(input.detectorVersion)),
    resolutionOrder: Object.freeze(input.packs.map((pack) => pack.id)),
    resolverVersion: LANGUAGE_RESOLVER_VERSION,
    schemaVersion: 1,
  });
}

function resolveBareChinesePack(
  packs: readonly LanguagePack[],
  defaultLocale: string,
): LanguagePack | undefined {
  const defaultScript = chineseScript(defaultLocale);
  const targetScript = defaultScript ?? "Hans";
  return packs.find((pack) => pack.id === `zh-${targetScript}`);
}

function packSupportsLocale(pack: LanguagePack, locale: string): boolean {
  const canonical = canonicalizeLocale(locale);
  const language = primaryLanguage(canonical);
  const script = chineseScript(canonical);
  return pack.locales.some((claim) => {
    const canonicalClaim = canonicalizeLocale(claim);
    const claimLanguage = primaryLanguage(canonicalClaim);
    if (claimLanguage !== language) {
      return false;
    }
    if (language === "zh") {
      const claimScript = chineseScript(canonicalClaim);
      return Boolean(script && claimScript === script);
    }
    return !canonicalClaim.includes("-") ||
      canonicalClaim.toLowerCase() === canonical.toLowerCase();
  });
}

function resolvePackForLocale(
  locale: string,
  packs: readonly LanguagePack[],
  defaultLocale: string,
): LanguagePack {
  const neutralPack = packs.find(({ id }) => id === NEUTRAL_PACK.id) ??
    NEUTRAL_PACK;
  if (canonicalizeLocale(locale).toLowerCase() === "zh") {
    return resolveBareChinesePack(packs, defaultLocale) ?? neutralPack;
  }
  return packs.find((pack) => packSupportsLocale(pack, locale)) ?? neutralPack;
}

function validatePackRegistry(
  registry: {
    byId: ReadonlyMap<string, LanguagePack>;
    packs: readonly LanguagePack[];
  },
  defaultLocale: string,
): void {
  for (const builtin of BUILTIN_PACKS) {
    const registered = registry.byId.get(builtin.id);
    if (
      !registered ||
      builtin.locales.some((locale) => !packSupportsLocale(registered, locale))
    ) {
      throw new Error(
        `Language pack ${builtin.id} must preserve its built-in locale claims.`,
      );
    }
  }

  for (const pack of registry.packs) {
    if (pack.id === NEUTRAL_PACK.id) {
      continue;
    }
    for (const locale of new Set([pack.defaultLocale, ...pack.locales])) {
      const resolved = resolvePackForLocale(
        locale,
        registry.packs,
        defaultLocale,
      );
      if (resolved.id !== pack.id) {
        throw new Error(
          `Language pack ${pack.id} locale ${locale} resolves to ${resolved.id}.`,
        );
      }
    }
  }
}

function resolvedContext(
  locale: string,
  localeSource: ResolvedLanguageContext["localeSource"],
  pack: LanguagePack,
): ResolvedLanguageContext {
  return {
    analysisMode: "rules-only",
    compatibilityGroup: pack.compatibilityGroup,
    languagePackId: pack.id,
    languagePackVersion: pack.analyzerVersion,
    locale,
    localeSource,
  };
}

function resolveDetectedPack(
  matches: readonly LanguagePack[],
  defaultLocale: string,
): LanguagePack | undefined {
  if (matches.length <= 1) {
    return matches[0];
  }
  const languages = new Set(
    matches.map((pack) => primaryLanguage(pack.defaultLocale)),
  );
  if (languages.size !== 1) {
    return undefined;
  }
  return matches.find((pack) => packSupportsLocale(pack, defaultLocale)) ??
    matches[0];
}

export function createLanguageService(
  config: LanguageConfig = {},
): LanguageService {
  const defaultLocale = config.defaultLocale === undefined
    ? "en-US"
    : canonicalizeRequiredLocale(config.defaultLocale, "defaultLocale");
  const detectionMode = config.detection ?? "auto";
  const detector: LocaleDetector | undefined = config.detector;
  const detectorVersion = config.detectorVersion?.trim() || undefined;
  const registry = createPackRegistry(config.packs);
  validatePackRegistry(registry, defaultLocale);
  const analyzerManifest = buildAnalyzerManifest({
    defaultLocale,
    detection: detectionMode,
    detectorVersion,
    packs: registry.packs,
    usesCustomDetector: detectionMode === "auto" && detector !== undefined,
  });

  const resolveLocale = (input: {
    locale?: string;
    texts: string[];
  }): ResolvedLanguageContext => {
    if (input.locale) {
      const locale = canonicalizeLocale(input.locale);
      return resolvedContext(
        locale,
        "explicit",
        resolvePackForLocale(locale, registry.packs, defaultLocale),
      );
    }

    if (detectionMode === "default_only") {
      return resolvedContext(
        defaultLocale,
        "default",
        resolvePackForLocale(defaultLocale, registry.packs, defaultLocale),
      );
    }

    const customDetected = detector?.({
      texts: input.texts,
      defaultLocale,
    });
    if (customDetected) {
      const locale = canonicalizeLocale(customDetected);
      return resolvedContext(
        locale,
        "detected",
        resolvePackForLocale(locale, registry.packs, defaultLocale),
      );
    }

    const strengths = registry.packs.map((pack) => ({
      pack,
      strength: pack.detect({ texts: input.texts }),
    }));
    const distinctive = strengths.filter(({ strength }) =>
      strength === "distinctive"
    );
    const distinctivePack = resolveDetectedPack(
      distinctive.map(({ pack }) => pack),
      defaultLocale,
    );
    if (distinctivePack) {
      const pack = distinctivePack;
      return resolvedContext(pack.defaultLocale, "detected", pack);
    }
    const compatible = strengths.filter(({ strength }) =>
      strength === "compatible"
    );
    const compatiblePack = distinctive.length === 0
      ? resolveDetectedPack(
        compatible.map(({ pack }) => pack),
        defaultLocale,
      )
      : undefined;
    if (compatiblePack) {
      const pack = compatiblePack;
      return resolvedContext(pack.defaultLocale, "detected", pack);
    }

    return resolvedContext(
      defaultLocale,
      "default",
      resolvePackForLocale(defaultLocale, registry.packs, defaultLocale),
    );
  };

  const packFor = (
    context: ResolvedLanguageContext | string,
  ): LanguagePack => {
    if (typeof context !== "string") {
      return registry.byId.get(context.languagePackId) ??
        registry.byId.get(NEUTRAL_PACK.id) ??
        NEUTRAL_PACK;
    }
    return resolvePackForLocale(context, registry.packs, defaultLocale);
  };

  return {
    getAnalyzerManifest() {
      return analyzerManifest;
    },
    resolveFromMessages(input) {
      return resolveLocale({
        locale: input.locale,
        texts: input.messages.map((message) => message.content),
      });
    },
    resolveFromText(input) {
      return resolveLocale({ locale: input.locale, texts: [input.text] });
    },
    analyzerVersion(context) {
      return packFor(context).analyzerVersion;
    },
    normalizeForEquality(text, context) {
      return packFor(context).normalizeForEquality(text);
    },
    tokenize(text, context, options) {
      return packFor(context).tokenizeForScoring(text, "bm25", options);
    },
    buildSearchTerms(text, context) {
      const terms: string[] = [];
      const seen = new Set<string>();
      for (const candidate of packFor(context).buildSearchTerms(text)) {
        const term = candidate.trim();
        if (!term || seen.has(term)) {
          continue;
        }
        seen.add(term);
        terms.push(term);
        if (terms.length === MAX_SEARCH_TERMS) {
          break;
        }
      }
      return terms;
    },
    splitClauses(text, context) {
      return packFor(context).splitClauses(text);
    },
    splitSentences(text, context) {
      return packFor(context).splitSentences(text);
    },
    decomposeQuery(text, context) {
      return packFor(context).decomposeQuery(text);
    },
    analyzeBehavioralRule(text, context) {
      return packFor(context).analyzeBehavioralRule(text);
    },
    analyzeQuery(text, context) {
      return packFor(context).analyzeQuery(text);
    },
    analyzeContent(text, context) {
      return packFor(context).analyzeContent(text);
    },
    parseTemporalExpressions(text, context) {
      return packFor(context).parseTemporalExpressions(text);
    },
    matchesEventPredicate(query, candidate, context) {
      return packFor(context).matchesEventPredicate?.(query, candidate) ?? false;
    },
    extractEntityMentions(text, context) {
      return packFor(context).extractEntityMentions(text);
    },
    matchesEntityAlias(query, alias, context) {
      return packFor(context).matchesEntityAlias(query, alias);
    },
    acceptsEntityCandidate(input, context) {
      return packFor(context).acceptsEntityCandidate(input);
    },
    deriveDurableTarget(candidate, context) {
      return packFor(context).deriveDurableTarget?.(candidate);
    },
    extractCandidates(input, context) {
      const pack = packFor(context);
      return pack.extractCandidates(input).map((candidate) =>
        authorizePackCandidateGovernance(pack, input, candidate)
      );
    },
    render(input, context) {
      return packFor(context).render(input);
    },
    tokenOverlap(left, right, context, options) {
      const pack = packFor(context);
      const leftTokens = new Set(
        pack.tokenizeForScoring(left, "overlap", options),
      );
      const rightTokens = new Set(
        pack.tokenizeForScoring(right, "overlap", options),
      );
      if (leftTokens.size === 0 || rightTokens.size === 0) {
        return 0;
      }
      const leftHasNumeric = [...leftTokens].some((token) =>
        PURE_NUMERIC_TOKEN.test(token)
      );
      const rightHasNumeric = [...rightTokens].some((token) =>
        PURE_NUMERIC_TOKEN.test(token)
      );
      if (leftHasNumeric !== rightHasNumeric) {
        const oneSidedTokens = leftHasNumeric ? leftTokens : rightTokens;
        for (const token of oneSidedTokens) {
          if (PURE_NUMERIC_TOKEN.test(token)) {
            oneSidedTokens.delete(token);
          }
        }
      }
      let intersection = 0;
      for (const token of leftTokens) {
        if (rightTokens.has(token)) {
          intersection += 1;
        }
      }
      if (options?.excludeStopwords && pack.id === "en") {
        const leftRaw = new Set(pack.tokenizeForScoring(left, "overlap"));
        const rightRaw = new Set(pack.tokenizeForScoring(right, "overlap"));
        const leftAnchors = pack.tokenizeForScoring(left, "bm25", options);
        const rightAnchors = new Set(
          pack.tokenizeForScoring(right, "bm25", options),
        );
        if (
          leftRaw.has("before") &&
          rightRaw.has("before") &&
          leftAnchors.some((token) => rightAnchors.has(token))
        ) {
          leftTokens.add("before");
          rightTokens.add("before");
          intersection += 1;
        }
      }
      return intersection / Math.max(leftTokens.size, rightTokens.size);
    },
    localesCompatible(left, right) {
      const leftPack = resolvePackForLocale(left, registry.packs, defaultLocale);
      const rightPack = resolvePackForLocale(right, registry.packs, defaultLocale);
      if (
        leftPack.id !== NEUTRAL_PACK.id &&
        rightPack.id !== NEUTRAL_PACK.id
      ) {
        return leftPack.compatibilityGroup === rightPack.compatibilityGroup;
      }
      return primaryLanguage(left) === primaryLanguage(right);
    },
    isAnswerCompositionQuery(query, context) {
      return this.analyzeQuery(query, context).answerComposition;
    },
    isReferenceSeekingQuery(query, context) {
      return this.analyzeQuery(query, context).referenceSeeking;
    },
    isRoleQuery(query, context) {
      return this.analyzeQuery(query, context).role;
    },
    isFocusQuery(query, context) {
      return this.analyzeQuery(query, context).focus;
    },
    isOpenLoopQuery(query, context) {
      return this.analyzeQuery(query, context).openLoop;
    },
    isBlockerQuery(query, context) {
      return this.analyzeQuery(query, context).blocker;
    },
    isProjectStateQuery(query, context) {
      return this.analyzeQuery(query, context).projectState;
    },
    isFactConfirmationQuery(query, context) {
      return this.analyzeQuery(query, context).factConfirmation;
    },
    isActionDrivingQuery(query, context) {
      return this.analyzeQuery(query, context).actionDriving;
    },
    isAggregateCountQuery(query, context) {
      return this.analyzeQuery(query, context).aggregateCount;
    },
    isAssistantEvidenceRecallQuery(query, context) {
      return this.analyzeQuery(query, context).assistantEvidenceRecall;
    },
    isContinuationQuery(query, context) {
      return this.analyzeQuery(query, context).continuation;
    },
    isDirectFactualLookupQuery(query, context) {
      return this.analyzeQuery(query, context).directFactualLookup;
    },
    isGuidanceSeekingQuery(query, context) {
      return this.analyzeQuery(query, context).guidanceSeeking;
    },
    isRecommendationStyleQuery(query, context) {
      return this.analyzeQuery(query, context).recommendationStyle;
    },
    isRoleFact(content, context) {
      return this.analyzeContent(content, context).roleFact;
    },
    isFocusFact(content, context) {
      return this.analyzeContent(content, context).focusFact;
    },
    isOpenLoopFact(content, context) {
      return this.analyzeContent(content, context).openLoopFact;
    },
    isBlockerFact(content, context) {
      return this.analyzeContent(content, context).blockerFact;
    },
    isProjectStateFact(content, context) {
      return this.analyzeContent(content, context).projectStateFact;
    },
    isPersonalEvidenceSignal(content, context) {
      return this.analyzeContent(content, context).personalEvidence;
    },
    isPreferenceEvidenceSignal(content, context) {
      return this.analyzeContent(content, context).preferenceEvidence;
    },
    detectFactPolarity(content, context) {
      return this.analyzeContent(content, context).factPolarity;
    },
    isAssistantAcknowledgement(content, context) {
      return this.analyzeContent(content, context).assistantAcknowledgement;
    },
    isAssistantContinuitySignal(content, context) {
      return this.analyzeContent(content, context).assistantContinuity;
    },
    isUnresolvedSignal(content, context) {
      return this.analyzeContent(content, context).unresolved;
    },
    deriveFeedbackKind(signal, context) {
      return this.analyzeContent(signal, context).feedbackKind;
    },
  };
}
