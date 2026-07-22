import {
  extractReferencePointer,
  extractReferencePointers,
} from "../domain/referencePointer";
import type {
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

function extractCanonicalReferencePointers(value: string | undefined): string[] {
  return extractReferencePointers(value);
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
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): MemoryCandidate {
  if (candidate.kindHint !== "reference") {
    return candidate;
  }

  const rawPointer = candidate.metadata?.referencePointer ?? candidate.content;
  const pointer =
    extractCanonicalReferencePointer(rawPointer) ??
    extractCanonicalReferencePointer(sourceMessageContent);

  if (!pointer) {
    return candidate;
  }

  const rawTitle = candidate.metadata?.referenceTitle?.trim();
  const resolvedTitle =
    !rawTitle ||
    rawTitle === candidate.content.trim() ||
    rawTitle === rawPointer.trim() ||
    rawTitle.length > pointer.length + 24
      ? basename(pointer)
      : rawTitle;
  const sourceDirective = languageContext
    ? languageContext.language.analyzeContent(
      sourceMessageContent ?? candidate.content,
      languageContext.resolved,
    ).sourceOfTruthDirective
    : undefined;
  const supersedesPointer =
    extractCanonicalReferencePointer(candidate.metadata?.supersedesPointer) ??
    (sourceDirective?.currentPointer === pointer
      ? sourceDirective.supersededPointer
      : undefined);

  return {
    ...candidate,
    content: pointer,
    metadata: {
      ...candidate.metadata,
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
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): MemoryCandidate {
  if (candidate.kindHint !== "preference" && candidate.kindHint !== "feedback") {
    return candidate;
  }

  const sourceText = [
    candidate.content,
    candidate.metadata?.preferenceValue,
    sourceMessageContent,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  if (!languageContext) {
    return candidate;
  }

  const directive = languageContext.language.analyzeContent(
    sourceText,
    languageContext.resolved,
  ).sourceOfTruthDirective;
  if (!directive) {
    return candidate;
  }

  const sourcePointers = new Set(extractReferencePointers(sourceText));
  if (!sourcePointers.has(directive.currentPointer)) {
    return candidate;
  }

  const supersededPointer =
    extractCanonicalReferencePointer(candidate.metadata?.supersedesPointer) ??
    (directive.supersededPointer && sourcePointers.has(directive.supersededPointer)
      ? directive.supersededPointer
      : undefined);

  return {
    ...candidate,
    kindHint: "reference",
    content: directive.currentPointer,
    metadata: {
      ...candidate.metadata,
      referenceKind: "source_of_truth",
      referencePointer: directive.currentPointer,
      referenceTitle: basename(directive.currentPointer),
      ...(supersededPointer
        ? { supersedesPointer: supersededPointer }
        : {}),
      appliesTo: undefined,
      feedbackKind: undefined,
      preferenceCategory: undefined,
      preferenceValue: undefined,
    },
  };
}

export function normalizeMemoryCandidate(
  candidate: MemoryCandidate,
  sourceMessageContent?: string,
  languageContext?: {
    language: LanguageService;
    resolved: ResolvedLanguageContext;
  },
): MemoryCandidate {
  const normalizedDirectiveCandidate = normalizeSourceOfTruthDirectiveCandidate(
    candidate,
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
