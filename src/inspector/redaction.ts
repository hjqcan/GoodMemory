import type { MemoryScope } from "../domain/scope";
import type { LanguageService } from "../language";
import { redactSensitiveCredentialText } from "../language/sensitive";

const MAX_VIEWER_TEXT_CHARS = 600;

export function sanitizeViewerValue(
  value: unknown,
  scope: MemoryScope,
  parentKey?: string,
  language?: LanguageService,
): unknown {
  if (typeof value === "string") {
    return redactScopeText(redactViewerText(value, language), scope);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeViewerValue(item, scope, parentKey, language)
    );
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if ((isRawTranscriptKey(key) && nested !== false) || isRawScopeKey(key)) {
        continue;
      }
      result[key] = sanitizeViewerValue(nested, scope, key, language);
    }
    return result;
  }
  return value;
}

export function redactScopeText(value: string, scope: MemoryScope): string {
  const replacements: Array<[string | undefined, string]> = [
    [scope.userId, "[user]"],
    [scope.tenantId, "[tenant]"],
    [scope.workspaceId, "[workspace]"],
    [scope.agentId, "[agent]"],
    [scope.sessionId, "[session]"],
  ];
  let result = value;
  for (const [raw, replacement] of replacements) {
    if (raw) {
      result = result.split(raw).join(replacement);
    }
  }
  return result;
}

export function redactViewerText(
  value: string,
  language?: LanguageService,
): string {
  const structurallyRedacted = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gu, "[redacted-secret]")
    .replace(
      /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^:\s/@]+:[^\s/@]+@/gu,
      "[redacted-url-auth]@",
    );
  const redacted = redactSensitiveCredentialText(
    structurallyRedacted,
    language,
  );
  const ordered = redacted.includes("[redacted-secret]")
    ? [
        "[redacted-secret]",
        ...new Set(
          redacted.match(/\[redacted-(?:email|url-auth)\]/gu) ?? [],
        ),
      ].join(" ")
    : redacted;
  return ordered.length <= MAX_VIEWER_TEXT_CHARS
    ? ordered
    : `${ordered.slice(0, MAX_VIEWER_TEXT_CHARS - 3).trimEnd()}...`;
}

function isRawTranscriptKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "normalizedtranscript" ||
    normalized === "rawtranscript" ||
    normalized === "rawtranscriptcontent";
}

function isRawScopeKey(key: string): boolean {
  return [
    "agentId",
    "scope",
    "scopeLineage",
    "sessionId",
    "sourceSessionIds",
    "tenantId",
    "userId",
    "workspaceId",
  ].includes(key);
}
