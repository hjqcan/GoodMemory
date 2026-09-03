import type { MemoryScope } from "../domain/scope";
import type { MemoryCandidate, MemoryExtractor } from "../remember/candidates";
import type { InstalledHostWritebackConfig } from "./hostConfigValidation";
import type { InstalledHostKind } from "./hostInstall";
import type { LanguageService } from "../language";
import { containsSensitiveCredential } from "../language/sensitive";
import {
  buildCandidateKey,
  clampText,
  isAssistantOutputAllowed,
  MAX_WRITEBACK_MESSAGE_CHARS,
  toMessageAnnotationKind,
  type CandidateWithKey,
  type InstalledHostWritebackCommand,
} from "./hostWritebackRuntime";

// Batch LLM pre-extraction over the whole bounded writeback window. The
// per-candidate llm-assisted strategy inside memory.remember() only ever
// re-extracts single messages the LanguagePack rules floor already selected,
// so it can never recover signals those rules missed — this stage can. It runs
// at most once per writeback invocation, bounded by a timeout so a slow
// provider can never stall the host's Stop hook; on any failure the caller
// falls back to the rules candidates alone.

const DEFAULT_EXTRACTOR_TIMEOUT_MS = 15_000;

export interface AssistedWritebackExtractionInput {
  command: InstalledHostWritebackCommand;
  config: InstalledHostWritebackConfig;
  extractor: MemoryExtractor;
  host: InstalledHostKind;
  language?: LanguageService;
  messages: Array<{
    content: string;
    role: "assistant" | "host_event" | "user";
    sensitiveCredential?: boolean;
  }>;
  scope: MemoryScope;
  timeoutMs?: number;
}

export interface AssistedWritebackExtractionResult {
  candidates: CandidateWithKey[];
  status: "extractor_failed" | "ok";
}

export async function buildAssistedWritebackCandidates(
  input: AssistedWritebackExtractionInput,
): Promise<AssistedWritebackExtractionResult> {
  let extracted: MemoryCandidate[];
  try {
    const result = await withTimeout(
      input.extractor.extract({
        messages: input.messages.map((message) => ({
          content: message.content,
          role: message.role === "host_event" ? "user" : message.role,
        })),
        scope: input.scope,
      }),
      input.timeoutMs ?? DEFAULT_EXTRACTOR_TIMEOUT_MS,
    );
    extracted = result.candidates;
  } catch {
    return { candidates: [], status: "extractor_failed" };
  }

  return {
    candidates: extracted.flatMap((candidate) =>
      mapExtractorCandidate(candidate, input),
    ),
    status: "ok",
  };
}

function mapExtractorCandidate(
  candidate: MemoryCandidate,
  input: AssistedWritebackExtractionInput,
): CandidateWithKey[] {
  if (candidate.kindHint === "noise") {
    return [];
  }
  const trimmed = candidate.content.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const source = candidate.sourceRole === "assistant" ? "assistant" : "user";
  const analyzedSource = input.messages.find(
    (message) => message.content.trim() === trimmed,
  );
  const secretLike = analyzedSource?.sensitiveCredential ??
    containsSensitiveCredential(trimmed, input.language);
  const content = secretLike
    ? "[redacted secret-like content]"
    : clampText(trimmed, MAX_WRITEBACK_MESSAGE_CHARS);
  const kind = mapExtractorKind(candidate.kindHint);
  // Inferred candidates score below explicit ones so a raised minConfidence
  // prunes them first.
  const confidence = secretLike
    ? 0
    : candidate.explicitness === "explicit"
      ? 0.85
      : 0.75;
  // LLM candidates never carry host annotations, so assistant-derived ones
  // stay blocked under every confirm/verify policy — visible in the ledger,
  // never durable. The explicit goodmemory_remember tool is the sanctioned
  // channel for assistant-originated durable memory.
  const assistantAllowed =
    source !== "assistant" ||
    isAssistantOutputAllowed(undefined, input.config.allowAssistantOutput);
  const durable =
    !secretLike &&
    assistantAllowed &&
    confidence >= input.config.minConfidence &&
    kind !== "episode";
  const reason = secretLike
    ? "secret_blocked"
    : !assistantAllowed
      ? "assistant_policy_blocked"
      : durable
        ? "llm_extraction"
        : "below_confidence";

  const base = {
    confidence,
    content,
    durable,
    kind,
    reason,
    source,
  } as const;

  return [
    {
      ...base,
      key: buildCandidateKey({ candidate: base, scope: input.scope }),
      message: {
        content,
        role: source,
      },
      messageAnnotation: {
        kindHint: toMessageAnnotationKind(kind),
        messageIndex: 0,
        metadataPatch: {
          attributes: {
            hostWritebackAssistantPolicy: input.config.allowAssistantOutput,
            hostWritebackCommand: input.command,
            hostWritebackExtraction: "batch-llm",
            hostWritebackHost: input.host,
            hostWritebackMode: input.config.mode,
            hostWritebackReason: reason,
            hostWritebackSource: source,
          },
          tags: ["installed-host-writeback"],
        },
        reason: `GoodMemory installed-host writeback: ${reason}`,
        remember: durable ? "always" : "auto",
      },
    },
  ];
}

function mapExtractorKind(
  kindHint: MemoryCandidate["kindHint"],
): CandidateWithKey["kind"] {
  if (kindHint === "profile") {
    return "fact";
  }
  if (kindHint === "episode") {
    return "episode";
  }
  if (kindHint === "noise") {
    return "fact";
  }
  if (kindHint === "note") {
    // Writeback previews harvest transcript candidates; an authored note
    // never arrives through this path, so a stray note hint previews as a fact
    // rather than widening the review-queue contract.
    return "fact";
  }
  return kindHint;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("writeback extractor timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
