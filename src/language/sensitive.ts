import type { LanguageContentAnalysis, LanguageService } from "./contracts";
import { createLanguageService } from "./service";

const UNIVERSAL_CREDENTIAL_PATTERN =
  /sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}/u;
const PRESERVED_REDACTION_PATTERN = /\[redacted-(?:email|url-auth)\]/gu;
const DEFAULT_LANGUAGE = createLanguageService();

export function containsSensitiveCredential(
  text: string,
  language: LanguageService = DEFAULT_LANGUAGE,
): boolean {
  const context = language.resolveFromText({ text });
  return containsSensitiveCredentialFromAnalysis(
    text,
    language.analyzeContent(text, context),
  );
}

export function containsSensitiveCredentialFromAnalysis(
  text: string,
  analysis: LanguageContentAnalysis,
): boolean {
  return UNIVERSAL_CREDENTIAL_PATTERN.test(text) || analysis.sensitiveCredential;
}

export function redactSensitiveCredentialText(
  text: string,
  language: LanguageService = DEFAULT_LANGUAGE,
): string {
  if (!containsSensitiveCredential(text, language)) {
    return text;
  }

  return [
    ...new Set([
      ...(text.match(PRESERVED_REDACTION_PATTERN) ?? []),
      "[redacted-secret]",
    ]),
  ].join(" ");
}
