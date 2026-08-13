import {
  createDurableOptOutDisposition,
  createDurableTargetIdentity,
} from "../domain/memoryCandidate";
import type {
  DurableOptOutDisposition,
  DurableTargetIdentity,
  MemoryCandidate,
} from "../domain/memoryCandidate";

export type DurableTargetSlotAliases = Readonly<Record<string, string>>;

function normalizeSlotKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function assignmentIdentity(
  content: string,
  aliases: DurableTargetSlotAliases,
): DurableTargetIdentity | undefined {
  const match = content.match(/^\s*([^=＝]+?)\s*[=＝]\s*(\S(?:.*\S)?)\s*$/u);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const key = normalizeSlotKey(match[1]);
  return createDurableTargetIdentity(
    aliases[key] ?? `assignment:${key}`,
    match[2],
  );
}

export function deriveLanguageDurableTarget(
  candidate: MemoryCandidate,
  aliases: DurableTargetSlotAliases,
): DurableTargetIdentity | undefined {
  if (candidate.kindHint === "profile" && candidate.metadata?.profileField) {
    return createDurableTargetIdentity(
      `profile:${candidate.metadata.profileField}`,
      candidate.content,
    );
  }
  if (candidate.kindHint === "preference") {
    return createDurableTargetIdentity(
      "preference",
      candidate.metadata?.preferenceValue ?? candidate.content,
    );
  }
  return candidate.kindHint === "fact"
    ? assignmentIdentity(candidate.content, aliases)
    : undefined;
}

export function attachLanguageDurableTarget(
  candidate: MemoryCandidate,
  aliases: DurableTargetSlotAliases,
): MemoryCandidate {
  const durableTarget = deriveLanguageDurableTarget(candidate, aliases);
  return durableTarget ? { ...candidate, durableTarget } : candidate;
}

export function createLanguageDurableOptOutDisposition(
  text: string,
  aliases: DurableTargetSlotAliases,
): DurableOptOutDisposition {
  return createDurableOptOutDisposition(
    text,
    assignmentIdentity(text, aliases),
  );
}
