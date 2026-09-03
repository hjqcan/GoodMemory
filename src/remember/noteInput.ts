import type { MemoryCandidateMetadata } from "../domain/memoryCandidate";
import type { MemoryScope } from "../domain/scope";

// One shape for every authored-page entry point (library, MCP, HTTP, CLI):
// the body is the whole message, and the annotation is the exact confirmed
// note shape the extraction pipeline admits verbatim (ADR-010 §2).
export interface NoteRememberInput {
  body: string;
  locale?: string;
  observedAt?: string;
  reason?: string;
  role?: "assistant" | "user";
  scope: MemoryScope;
  tags?: readonly string[];
  timezone?: string;
  title: string;
}

export function buildNoteRememberInput(input: NoteRememberInput) {
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  const metadataPatch: MemoryCandidateMetadata = {
    noteTitle: input.title.trim(),
    ...(tags.length > 0 ? { tags } : {}),
  };
  return {
    scope: input.scope,
    messages: [
      {
        role: input.role ?? ("assistant" as const),
        content: input.body,
        ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      },
    ],
    annotations: [
      {
        messageIndex: 0,
        remember: "always" as const,
        confirmed: true,
        kindHint: "note" as const,
        reason: input.reason ?? "explicit note write",
        metadataPatch,
      },
    ],
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
  };
}
