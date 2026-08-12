import {
  extractReferencePointer,
  parseReferencePointer,
} from "../domain/referencePointer";
import type {
  LanguageContentAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language/contracts";
import type { MemoryCandidate } from "./candidates";

const WRAPPING_PUNCTUATION = /^[`"'([{<\s]+|[`"')\]}>.,!?;:]+$/g;

function trimWrappingPunctuation(value: string): string {
  return value.replace(WRAPPING_PUNCTUATION, "").trim();
}

function basename(pointer: string): string {
  const segments = pointer.split("/");
  return segments.at(-1) ?? pointer;
}

interface ExplicitOptOutDisposition {
  canonicalMatch?: MemoryCandidate;
  optOutFeedback: MemoryCandidate;
}

function resolveExplicitOptOutDisposition(
  candidate: MemoryCandidate,
  sourceMessageContent: string | undefined,
  languageContext: {
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  } | undefined,
): ExplicitOptOutDisposition | undefined {
  if (!sourceMessageContent || !languageContext) {
    return undefined;
  }

  let nextId = 0;
  const extracted = languageContext.language.extractCandidates(
    {
      locale: languageContext.resolved.locale,
      messages: [{
        content: sourceMessageContent,
        role: candidate.sourceRole,
        sourceMessageIndex: 0,
      }],
      nextId: () => `opt-out-normalization-${nextId++}`,
    },
    languageContext.resolved,
  );
  const optOutFeedback = extracted.find((sourceCandidate) =>
    sourceCandidate.kindHint === "feedback" &&
    sourceCandidate.metadata?.feedbackKind === "dont"
  );
  if (!optOutFeedback) {
    return undefined;
  }

  const normalizedCandidateContent = languageContext.language.normalizeForEquality(
    candidate.content,
    languageContext.resolved,
  );
  const canonicalMatch = extracted.find((sourceCandidate) =>
    sourceCandidate.kindHint === candidate.kindHint &&
    languageContext.language.normalizeForEquality(
      sourceCandidate.content,
      languageContext.resolved,
    ) === normalizedCandidateContent
  );
  return { canonicalMatch, optOutFeedback };
}

function normalizeExplicitOptOutCandidate(
  candidate: MemoryCandidate,
  sourceMessageContent?: string,
  languageContext?: {
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): { candidate: MemoryCandidate; explicitOptOut: boolean } {
  const disposition = resolveExplicitOptOutDisposition(
    candidate,
    sourceMessageContent,
    languageContext,
  );
  if (!disposition) {
    return { candidate, explicitOptOut: false };
  }

  if (disposition.canonicalMatch) {
    return {
      candidate: disposition.canonicalMatch.kindHint === "feedback" &&
          disposition.canonicalMatch.metadata?.feedbackKind === "dont"
        ? {
          ...candidate,
          content: disposition.canonicalMatch.content,
          metadata: {
            ...candidate.metadata,
            ...disposition.canonicalMatch.metadata,
          },
        }
        : candidate,
      explicitOptOut: true,
    };
  }

  if (candidate.kindHint === "feedback") {
    return {
      candidate: {
        ...candidate,
        content: disposition.optOutFeedback.content,
        metadata: {
          ...candidate.metadata,
          ...disposition.optOutFeedback.metadata,
        },
      },
      explicitOptOut: true,
    };
  }

  return {
    candidate: {
      ...candidate,
      kindHint: "noise",
    },
    explicitOptOut: true,
  };
}

interface ProvenSourceOfTruthDirective {
  currentPointer: string;
  supersededPointer?: string;
}

function resolveProvenSourceOfTruthDirective(
  sourceMessageContent: string | undefined,
  languageContext: {
    analysis?: LanguageContentAnalysis;
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  } | undefined,
): ProvenSourceOfTruthDirective | undefined {
  if (!sourceMessageContent || !languageContext) {
    return undefined;
  }

  const directive = languageContext.analysis?.sourceOfTruthDirective ??
    languageContext.language.analyzeContent(
      sourceMessageContent,
      languageContext.resolved,
    ).sourceOfTruthDirective;
  const currentPointer = parseReferencePointer(directive?.currentPointer);
  if (!currentPointer || !sourceMessageContent.includes(currentPointer)) {
    return undefined;
  }

  const supersededPointer = parseReferencePointer(
    directive?.supersededPointer,
  );
  return {
    currentPointer,
    ...(supersededPointer &&
        supersededPointer !== currentPointer &&
        sourceMessageContent.includes(supersededPointer)
      ? { supersededPointer }
      : {}),
  };
}

function tokenizeName(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isStructurallyCanonicalName(value: string): boolean {
  const trimmed = trimWrappingPunctuation(value);
  if (trimmed.length === 0 || trimmed.length > 80) {
    return false;
  }

  if (/[.,:;()\\/。！？；，、]/u.test(trimmed)) {
    return false;
  }

  const tokens = tokenizeName(trimmed);
  if (tokens.length === 0 || tokens.length > 3) {
    return false;
  }

  return tokens.every((token) => /^[\p{L}'’.-]+$/u.test(token));
}

function extractPackProfileName(
  value: string | undefined,
  sourceRole: string,
  languageContext: {
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  } | undefined,
): string | undefined {
  if (!value || !languageContext) {
    return undefined;
  }

  let nextId = 0;
  const extracted = languageContext.language.extractCandidates(
    {
      locale: languageContext.resolved.locale,
      messages: [{ content: value, role: sourceRole, sourceMessageIndex: 0 }],
      nextId: () => `profile-normalization-${nextId++}`,
    },
    languageContext.resolved,
  );
  return extracted.find(
    (candidate) =>
      candidate.kindHint === "profile" &&
      candidate.metadata?.profileField === "name",
  )?.content.trim();
}

export function extractCanonicalReferencePointer(
  value: string | undefined,
): string | undefined {
  return extractReferencePointer(value);
}

function normalizeProfileCandidate(
  candidate: MemoryCandidate,
  sourceMessageContent?: string,
  languageContext?: {
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): MemoryCandidate {
  if (candidate.kindHint !== "profile") {
    return candidate;
  }

  const profileField = candidate.metadata?.profileField;
  if (profileField && profileField !== "name") {
    return candidate;
  }

  const canonicalCandidateName =
    profileField === "name" && isStructurallyCanonicalName(candidate.content)
      ? trimWrappingPunctuation(candidate.content)
      : undefined;
  const normalizedName = extractPackProfileName(
    sourceMessageContent,
    candidate.sourceRole,
    languageContext,
  ) ?? canonicalCandidateName ?? extractPackProfileName(
    candidate.content,
    candidate.sourceRole,
    languageContext,
  );

  if (!normalizedName) {
    return candidate;
  }

  return {
    ...candidate,
    content: normalizedName,
    metadata: {
      ...candidate.metadata,
      profileField: "name",
    },
  };
}

function normalizeReferenceCandidate(
  candidate: MemoryCandidate,
  sourceMessageContent?: string,
  languageContext?: {
    analysis?: LanguageContentAnalysis;
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): MemoryCandidate {
  if (candidate.kindHint !== "reference") {
    return candidate;
  }

  const rawPointer = candidate.metadata?.referencePointer ?? candidate.content;
  const sourceDirective = resolveProvenSourceOfTruthDirective(
    sourceMessageContent,
    languageContext,
  );
  if (
    candidate.metadata?.referenceKind === "source_of_truth" &&
    sourceDirective?.currentPointer !== extractCanonicalReferencePointer(rawPointer)
  ) {
    return { ...candidate, kindHint: "noise" };
  }
  const pointer =
    (candidate.metadata?.referenceKind === "source_of_truth"
      ? sourceDirective?.currentPointer
      : undefined) ??
    extractCanonicalReferencePointer(rawPointer) ??
    extractCanonicalReferencePointer(sourceMessageContent);
  const metadata = { ...candidate.metadata };
  delete metadata.supersedesPointer;

  if (!pointer) {
    return { ...candidate, metadata };
  }

  const rawTitle = candidate.metadata?.referenceTitle?.trim();
  const resolvedTitle =
    !rawTitle ||
    rawTitle === candidate.content.trim() ||
    rawTitle === rawPointer.trim() ||
    rawTitle.length > pointer.length + 24
      ? basename(pointer)
      : rawTitle;
  const supersedesPointer = sourceDirective?.currentPointer === pointer
    ? sourceDirective.supersededPointer
    : undefined;

  return {
    ...candidate,
    content: pointer,
    metadata: {
      ...metadata,
      referencePointer: pointer,
      referenceTitle: resolvedTitle,
      ...(supersedesPointer ? { supersedesPointer } : {}),
    },
  };
}

function normalizeSourceOfTruthDirectiveCandidate(
  candidate: MemoryCandidate,
  sourceMessageContent?: string,
  languageContext?: {
    analysis?: LanguageContentAnalysis;
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): MemoryCandidate {
  if (candidate.kindHint !== "preference" && candidate.kindHint !== "feedback") {
    return candidate;
  }

  const directive = resolveProvenSourceOfTruthDirective(
    sourceMessageContent,
    languageContext,
  );
  if (!directive) {
    return candidate;
  }

  const metadata = { ...candidate.metadata };
  delete metadata.supersedesPointer;

  return {
    ...candidate,
    kindHint: "reference",
    content: directive.currentPointer,
    metadata: {
      ...metadata,
      referenceKind: "source_of_truth",
      referencePointer: directive.currentPointer,
      referenceTitle: basename(directive.currentPointer),
      ...(directive.supersededPointer
        ? { supersedesPointer: directive.supersededPointer }
        : {}),
      appliesTo: undefined,
      feedbackKind: undefined,
      preferenceCategory: undefined,
      preferenceValue: undefined,
    },
  };
}

function stripUnprovenSupersession(
  candidate: MemoryCandidate,
): MemoryCandidate {
  if (!candidate.metadata || !Object.hasOwn(candidate.metadata, "supersedesPointer")) {
    return candidate;
  }
  const metadata = { ...candidate.metadata };
  delete metadata.supersedesPointer;
  return { ...candidate, metadata };
}

export function normalizeMemoryCandidate(
  candidate: MemoryCandidate,
  sourceMessageContent?: string,
  languageContext?: {
    analysis?: LanguageContentAnalysis;
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): MemoryCandidate {
  const optOutNormalization = normalizeExplicitOptOutCandidate(
    candidate,
    sourceMessageContent,
    languageContext,
  );
  const strippedCandidate = stripUnprovenSupersession(
    optOutNormalization.candidate,
  );
  const normalizedDirectiveCandidate = optOutNormalization.explicitOptOut
    ? strippedCandidate
    : normalizeSourceOfTruthDirectiveCandidate(
      strippedCandidate,
      sourceMessageContent,
      languageContext,
    );
  const normalizedProfileCandidate = normalizeProfileCandidate(
    normalizedDirectiveCandidate,
    sourceMessageContent,
    languageContext,
  );

  return normalizeReferenceCandidate(
    normalizedProfileCandidate,
    sourceMessageContent,
    languageContext,
  );
}
