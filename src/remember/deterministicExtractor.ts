import { createLanguageService } from "../language";
import type { LanguageConfig, LanguageService } from "../language";
import type {
  MemoryCandidate,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryExtractor,
} from "./candidates";
import { analyzeRememberSourceMessages } from "./languageAnalysis";
import type { RememberSourceLanguageAnalyses } from "./languageAnalysis";

export function createDeterministicMemoryExtractor(
  config: LanguageConfig = {},
): MemoryExtractor {
  const language = createLanguageService(config);
  return {
    async extract(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
      return extractDeterministicMemoryWithLanguage(input, language);
    },
  };
}

export function extractDeterministicMemoryWithLanguage(
  input: MemoryExtractionInput,
  language: LanguageService,
  providedAnalyses?: RememberSourceLanguageAnalyses,
): MemoryExtractionResult {
  const analyses = providedAnalyses ??
    analyzeRememberSourceMessages(input, language);
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `candidate-${String(counter).padStart(4, "0")}`;
  };

  const candidates: MemoryCandidate[] = [];
  let ignoredMessageCount = 0;
  input.messages.forEach((message, index) => {
    if (message.role !== "user") {
      return;
    }

    const resolved = analyses.get(index)?.context;
    if (!resolved) {
      return;
    }
    const clauses = language.splitClauses(message.content, resolved);
    const extracted = language.extractCandidates(
      {
        messages: [
          {
            ...message,
            analysis: analyses.get(index)?.analysis,
            sourceMessageIndex: index,
          },
        ],
        locale: resolved.locale,
        nextId,
      },
      resolved,
    );
    candidates.push(...extracted);
    if (clauses.length === 0 || extracted.length === 0) {
      ignoredMessageCount += 1;
    }
  });

  return {
    candidates,
    ignoredMessageCount,
  };
}
