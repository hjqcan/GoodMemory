import type {
  LanguageContentAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import type { MemoryCandidate, MemoryExtractionInput } from "./candidates";

export interface RememberSourceLanguageAnalysis {
  analysis: LanguageContentAnalysis;
  context: ResolvedLanguageContext;
}

export type RememberSourceLanguageAnalyses = ReadonlyMap<
  number,
  RememberSourceLanguageAnalysis
>;

export function analyzeRememberSourceMessages(
  input: MemoryExtractionInput,
  language: LanguageService,
): RememberSourceLanguageAnalyses {
  const analyses = new Map<number, RememberSourceLanguageAnalysis>();
  for (const [messageIndex, message] of input.messages.entries()) {
    const context = language.resolveFromText({
      locale: input.locale,
      text: message.content,
    });
    analyses.set(messageIndex, {
      analysis: language.analyzeContent(message.content, context),
      context,
    });
  }
  return analyses;
}

export function candidateSourceLanguageAnalysis(
  candidate: MemoryCandidate,
  analyses: RememberSourceLanguageAnalyses,
): RememberSourceLanguageAnalysis | undefined {
  for (const messageIndex of [
    candidate.sourceMessageIndex,
    ...(candidate.sourceMessageIndexes ?? []),
  ]) {
    const analysis = analyses.get(messageIndex);
    if (analysis) {
      return analysis;
    }
  }
  return undefined;
}

export function primarySourceLanguageAnalysis(
  input: MemoryExtractionInput,
  analyses: RememberSourceLanguageAnalyses,
): RememberSourceLanguageAnalysis | undefined {
  const firstUserIndex = input.messages.findIndex(({ role }) => role === "user");
  return analyses.get(firstUserIndex >= 0 ? firstUserIndex : 0);
}

export function storedTextLanguageKey(text: string, locale?: string): string {
  return `${locale ?? ""}\u0000${text}`;
}
