import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { GoodMemory } from "../api/contracts";
import { readGoodMemoryIntegrationSupport } from "../api/integrationSupport";
import type { MemoryScope } from "../domain/scope";
import type {
  LanguageContentAnalysis,
  LanguageService,
} from "../language";
import { createLanguageService } from "../language";
import { containsSensitiveCredentialFromAnalysis } from "../language/sensitive";
import type {
  ExtractionOutcome,
  RememberEvent,
} from "../remember/contracts";
import type {
  MessageAnnotation,
  MemoryCandidate,
  MemoryExtractionStrategy,
  MemoryCandidateKindHint,
  MemoryExtractor,
} from "../remember/candidates";
import {
  buildWritebackAuditEventId,
  buildScopedWritebackCandidateKey,
  buildWritebackScopeDigest,
  buildWritebackSessionDigest,
  clearWritebackAuditPending,
  markWritebackAuditCommitted,
  markWritebackAuditFailed,
  markWritebackAuditObserved,
  markWritebackAuditPending,
  readInstalledHostWritebackLedger,
  withInstalledHostWritebackLedgerLock,
  writeInstalledHostWritebackLedger,
  type InstalledHostWritebackLinkedRecordId,
} from "./hostWritebackAuditLedger";
import { persistReviewCandidates } from "./hostReviewQueue";
import { createProviderMemoryExtractor } from "../provider/layer";
import {
  isRecord,
  normalizeText,
  readOptionalText,
  type InstalledHostModelProviderConfig,
  type InstalledHostWritebackConfig,
  type InstalledHostWritebackMode,
} from "./hostConfigValidation";
import { buildAssistedWritebackCandidates } from "./hostWritebackExtraction";
import {
  createInstalledHostMemory,
  resolveInstalledHostContext,
  type InstalledHostContextDependencies,
  type InstalledHostResolvedContext,
} from "./hostExecutionContext";
import type { InstalledHostKind } from "./hostInstall";
import {
  commitInstalledHostTranscriptCursor,
  readInstalledHostTranscriptCursorCheckpoint,
  type InstalledHostTranscriptCursorCheckpoint,
} from "./hostTranscriptCursor";
import {
  readClaudeTranscriptDelta,
  readCodexRolloutDelta,
} from "./hostTranscriptReader";
import type {
  HostTranscriptFormatDrift,
  HostTranscriptReadStatus,
} from "./hostTranscriptReader";

export type InstalledHostWritebackCommand = "turn-end" | "session-end";

export interface InstalledHostWritebackDependencies
  extends InstalledHostContextDependencies {
  // Injectable batch-extractor factory so tests stay hermetic; the default
  // builds the provider-backed extractor from providers.assistedExtractor.
  createWritebackExtractor?: (
    config: InstalledHostModelProviderConfig,
  ) => MemoryExtractor;
}

export interface InstalledHostWritebackInput {
  command: InstalledHostWritebackCommand;
  dryRun?: boolean;
  homeRoot?: string;
  host: InstalledHostKind;
  mode?: InstalledHostWritebackMode;
  payload: Record<string, unknown>;
}

export interface InstalledHostWritebackCandidate {
  confidence: number;
  content: string;
  durable: boolean;
  kind: "preference" | "fact" | "feedback" | "reference" | "episode";
  reason: string;
  source: "user" | "assistant" | "host_event";
}

export interface InstalledHostWritebackResult {
  applied: boolean;
  candidates: InstalledHostWritebackCandidate[];
  mode: InstalledHostWritebackMode;
  reason:
    | "disabled"
    | "empty_transcript"
    | "audit_failed"
    | "missing_config"
    | "missing_repo_opt_in"
    | "no_candidates"
    | "observed"
    | "review_queued"
    | "transcript_read_failed"
    | "write_failed"
    | "written";
  trace: Record<string, unknown>;
  wrote: boolean;
}

interface RawWritebackMessage {
  annotation?: HostPayloadAnnotation;
  content: string;
  role: "assistant" | "host_event" | "user";
}

interface NormalizedWritebackMessage extends RawWritebackMessage {
  languageAnalysis: {
    content: LanguageContentAnalysis;
    extracted: MemoryCandidate[];
    sensitiveCredential: boolean;
  };
}

type NormalizedWritebackRole = RawWritebackMessage["role"];

interface HostPayloadAnnotation {
  confirmed?: boolean;
  kindHint?: InstalledHostWritebackCandidate["kind"];
  machineReason?: string;
  reason?: string;
  remember?: "always" | "auto" | "never";
  verified?: boolean;
}

// Exported for hostWritebackExtraction.ts (batch LLM pre-extraction),
// which maps extractor candidates onto the same governed candidate shape
// so downstream reserve/remember/commit stays single-sourced.
export interface CandidateWithKey extends InstalledHostWritebackCandidate {
  key: string;
  message: {
    content: string;
    role: "assistant" | "user";
  };
  messageAnnotation: MessageAnnotation;
}

export const MAX_WRITEBACK_MESSAGE_CHARS = 1_500;
export async function executeInstalledHostWriteback(
  input: InstalledHostWritebackInput,
  dependencies: InstalledHostWritebackDependencies = {},
): Promise<InstalledHostWritebackResult> {
  const resolved = await resolveInstalledHostContext(
    {
      cwd: readOptionalText(input.payload, "cwd"),
      homeRoot: input.homeRoot,
      host: input.host,
      sessionId: readOptionalText(input.payload, "session_id"),
    },
    dependencies,
  );
  if (resolved.status !== "ok") {
    return buildSkippedWritebackResult({
      host: input.host,
      mode: input.mode ?? "off",
      reason:
        resolved.status === "missing_global_config" ||
        resolved.status === "invalid_global_config"
          ? "missing_config"
          : "missing_repo_opt_in",
      trace: {
        contextStatus: resolved.status,
        rawTranscriptPersisted: false,
      },
    });
  }

  const config = resolveEffectiveWritebackConfig({
    context: resolved.context,
    dryRun: input.dryRun,
    mode: input.mode,
  });
  if (config.mode === "off") {
    return buildSkippedWritebackResult({
      host: input.host,
      mode: "off",
      reason: "disabled",
      trace: {
        command: input.command,
        rawTranscriptPersisted: false,
      },
    });
  }

  // Real Codex and Claude Code Stop payloads reference the session transcript
  // by path instead of carrying inline messages; hydrate
  // that path into the same bounded message window. Inline payloads always
  // win, and hydration runs only after the mode gate so `off` never touches
  // the transcript file.
  const hydration = await hydrateTranscriptPayload({
    homeRoot: input.homeRoot,
    host: input.host,
    maxChars: config.maxChars,
    maxMessages: config.maxMessages,
    payload: input.payload,
  });
  if (hydration.attempted && hydration.readStatus !== "ok") {
    return buildSkippedWritebackResult({
      host: input.host,
      mode: config.mode,
      reason: "transcript_read_failed",
      trace: {
        command: input.command,
        rawTranscriptPersisted: false,
        ...(hydration.formatDrift
          ? { transcriptFormatDrift: hydration.formatDrift }
          : {}),
        transcriptPathUsed: true,
        transcriptReadStatus: hydration.readStatus,
      },
    });
  }
  const result = await executeResolvedWriteback({
    config,
    dependencies,
    hydratedPayload: hydration.payload,
    input,
    resolved: { context: resolved.context },
  });
  return applyTranscriptHydrationOutcome({ hydration, input, result });
}

async function executeResolvedWriteback(args: {
  config: InstalledHostWritebackConfig;
  dependencies: InstalledHostWritebackDependencies;
  hydratedPayload: Record<string, unknown>;
  input: InstalledHostWritebackInput;
  resolved: { context: InstalledHostResolvedContext };
}): Promise<InstalledHostWritebackResult> {
  const { config, dependencies, hydratedPayload, input, resolved } = args;
  const durableScope = toDurableWritebackScope(resolved.context.scope);
  const memory = createInstalledHostMemory(resolved.context, dependencies);
  const language = readGoodMemoryIntegrationSupport(memory)?.language ??
    createLanguageService(resolved.context.language);
  const messages = normalizeWritebackMessages(hydratedPayload, config, language);
  if (messages.length === 0) {
    return {
      applied: false,
      candidates: [],
      mode: config.mode,
      reason: "empty_transcript",
      trace: {
        command: input.command,
        rawTranscriptPersisted: false,
      },
      wrote: false,
    };
  }

  // Batch LLM pre-extraction over the whole window (when configured); the
  // language-pack rules stay the floor and the union is deduped by candidate key.
  const batch = await runBatchWritebackExtraction({
    command: input.command,
    config,
    context: resolved.context,
    dependencies,
    host: input.host,
    language,
    messages,
    scope: durableScope,
  });
  const candidates = mergeWritebackCandidateSets(
    buildWritebackCandidates({
      command: input.command,
      config,
      host: input.host,
      scope: durableScope,
      messages,
    }),
    batch.candidates,
  );
  if (candidates.length === 0) {
    return {
      applied: true,
      candidates: [],
      mode: config.mode,
      reason: "no_candidates",
      trace: {
        batchExtraction: batch.status,
        command: input.command,
        messageCount: messages.length,
        rawTranscriptPersisted: false,
      },
      wrote: false,
    };
  }

  if (config.mode === "review") {
    // Inspector "review" mode: capture durable candidates into the review
    // queue for human approval/rejection instead of committing (selective) or
    // storing a preview-only ledger note (observe). No durable write happens
    // here; the raw transcript is never persisted.
    const durableForReview = candidates.filter((candidate) => candidate.durable);
    const queued = await persistReviewCandidates({
      homeRoot: input.homeRoot,
      now: () => new Date(),
      candidates: durableForReview.map((candidate) => ({
        host: input.host,
        scope: durableScope,
        candidateKey: candidate.key,
        kind: candidate.kind,
        content: candidate.content,
        reason: candidate.reason,
        source: candidate.source,
        confidence: candidate.confidence,
      })),
    });
    return {
      applied: true,
      candidates: candidates.map(stripCandidateKey),
      mode: "review",
      reason: "review_queued",
      trace: {
        batchExtraction: batch.status,
        command: input.command,
        durableCandidateCount: durableForReview.length,
        messageCount: messages.length,
        rawTranscriptPersisted: false,
        reviewQueuedCount: queued.persisted,
      },
      wrote: false,
    };
  }

  if (config.mode === "observe") {
    const observed = await recordObservedCandidates({
      candidates: candidates.filter((candidate) => candidate.durable),
      command: input.command,
      homeRoot: input.homeRoot,
      host: input.host,
      scope: durableScope,
      sessionDigest: buildWritebackSessionDigest(
        readOptionalText(input.payload, "session_id"),
      ),
    });
    return {
      applied: true,
      candidates: candidates.map(stripCandidateKey),
      mode: "observe",
      reason: observed.failed ? "audit_failed" : "observed",
      trace: {
        auditWriteFailed: observed.failed,
        batchExtraction: batch.status,
        command: input.command,
        durableCandidateCount: candidates.filter((candidate) => candidate.durable)
          .length,
        messageCount: messages.length,
        observedCandidateCount: observed.observedCount,
        rawTranscriptPersisted: false,
      },
      wrote: false,
    };
  }

  const durableCandidates = candidates.filter((candidate) => candidate.durable);
  if (durableCandidates.length === 0) {
    return {
      applied: true,
      candidates: candidates.map(stripCandidateKey),
      mode: "selective",
      reason: "no_candidates",
      trace: {
        batchExtraction: batch.status,
        command: input.command,
        durableCandidateCount: 0,
        messageCount: messages.length,
        rawTranscriptPersisted: false,
      },
      wrote: false,
    };
  }

  try {
    // When the batch stage already ran the LLM over the window, the inner
    // per-candidate remember stays rules-only: the remember-always annotation
    // force-adds the extracted content verbatim, so a second LLM pass would
    // only add cost and drift.
    const extractionStrategy =
      batch.status === "ok" && batch.attempted
        ? "rules-only"
        : resolveWritebackExtractionStrategy(resolved.context);
    const scopeDigest = buildWritebackScopeDigest(durableScope);
    const toScopedKey = (candidate: CandidateWithKey): string =>
      buildScopedWritebackCandidateKey({
        candidateKey: candidate.key,
        scopeDigest,
      });
    const writeResult = await writeNewCandidates({
      candidates: durableCandidates,
      command: input.command,
      extractionStrategy,
      homeRoot: input.homeRoot,
      host: input.host,
      memory,
      scope: durableScope,
      sessionDigest: buildWritebackSessionDigest(
        readOptionalText(input.payload, "session_id"),
      ),
    });

    return {
      applied: true,
      candidates: candidates.map((candidate) => {
        const scopedKey = toScopedKey(candidate);
        return writeResult.writtenKeys.has(scopedKey)
          ? stripCandidateKey(candidate)
          : {
              ...stripCandidateKey(candidate),
              durable: writeResult.uncommittedKeys.has(scopedKey),
              reason: writeResult.uncommittedKeys.has(scopedKey)
                ? "ledger_pending"
                : writeResult.rejectedKeys.has(scopedKey)
                  ? "write_rejected"
                  : writeResult.failedKeys.has(scopedKey)
                    ? "write_failed"
                    : candidate.durable
                      ? "duplicate"
                      : candidate.reason,
            };
      }),
      mode: "selective",
      reason: writeResult.failed
        ? "write_failed"
        : writeResult.wrote
          ? "written"
          : "no_candidates",
      trace: {
        batchExtraction: batch.status,
        command: input.command,
        duplicateCandidateCount: writeResult.duplicateCount,
        durableCandidateCount: durableCandidates.length,
        extractionStrategy,
        failedCandidateCount: writeResult.failedKeys.size,
        pendingCandidateCount: writeResult.pendingCandidateCount,
        rawTranscriptPersisted: false,
        rejectedCandidateCount: writeResult.rejectedKeys.size,
        resolvedExtractionStrategies: [...writeResult.resolvedExtractionStrategies],
        uncommittedCandidateCount: writeResult.uncommittedKeys.size,
        writtenCandidateCount: writeResult.writtenKeys.size,
      },
      wrote: writeResult.wrote,
    };
  } catch {
    return {
      applied: true,
      candidates: candidates.map(stripCandidateKey),
      mode: "selective",
      reason: "write_failed",
      trace: {
        batchExtraction: batch.status,
        command: input.command,
        rawTranscriptPersisted: false,
      },
      wrote: false,
    };
  }
}

function resolveEffectiveWritebackConfig(input: {
  context: InstalledHostResolvedContext;
  dryRun?: boolean;
  mode?: InstalledHostWritebackMode;
}): InstalledHostWritebackConfig {
  const explicitDryRun = input.dryRun === true;
  const dryRun = explicitDryRun || input.context.writeback.dryRun;
  return {
    ...input.context.writeback,
    dryRun,
    mode: dryRun
      ? "observe"
      : input.mode ?? input.context.writeback.mode,
  };
}

function buildSkippedWritebackResult(input: {
  host: InstalledHostKind;
  mode: InstalledHostWritebackMode;
  reason: InstalledHostWritebackResult["reason"];
  trace: Record<string, unknown>;
}): InstalledHostWritebackResult {
  return {
    applied: false,
    candidates: [],
    mode: input.mode,
    reason: input.reason,
    trace: {
      host: input.host,
      ...input.trace,
    },
    wrote: false,
  };
}

function resolveWritebackExtractionOutcome(
  result: InstalledHostWritebackResult,
): ExtractionOutcome {
  if (
    result.trace.batchExtraction === "extractor_failed" ||
    result.trace.pendingCandidateCount
  ) {
    return "failed";
  }
  if (
    result.reason === "write_failed" ||
    result.reason === "audit_failed" ||
    result.reason === "transcript_read_failed"
  ) {
    return "failed";
  }
  if (result.reason === "empty_transcript" || result.reason === "no_candidates") {
    return "no_admissible_candidate";
  }
  if (
    result.reason === "observed" ||
    result.reason === "review_queued" ||
    result.reason === "written"
  ) {
    return "committed";
  }
  return "failed";
}

interface TranscriptHydration {
  attempted: boolean;
  cursorCheckpoint: InstalledHostTranscriptCursorCheckpoint | null | undefined;
  deltaMessageCount: number;
  formatDrift?: HostTranscriptFormatDrift;
  nextOffset: number;
  payload: Record<string, unknown>;
  readStatus: HostTranscriptReadStatus | undefined;
  sessionDigest: string | undefined;
  transcriptIdentity: string | undefined;
}

async function buildTranscriptIdentity(transcriptPath: string): Promise<string> {
  let fileIdentity = "unavailable";
  try {
    const metadata = await stat(transcriptPath);
    fileIdentity = `${metadata.dev}:${metadata.ino}`;
  } catch {
    // The transcript reader reports the concrete read failure. A path-bound
    // identity still keeps a failed lookup from colliding with another file.
  }
  return `transcript:${createHash("sha256")
    .update(transcriptPath)
    .update("\0")
    .update(fileIdentity)
    .digest("hex")
    .slice(0, 32)}`;
}

async function hydrateTranscriptPayload(input: {
  homeRoot?: string;
  host: InstalledHostKind;
  maxChars: number;
  maxMessages: number;
  payload: Record<string, unknown>;
}): Promise<TranscriptHydration> {
  const skipped: TranscriptHydration = {
    attempted: false,
    cursorCheckpoint: undefined,
    deltaMessageCount: 0,
    nextOffset: 0,
    payload: input.payload,
    readStatus: undefined,
    sessionDigest: undefined,
    transcriptIdentity: undefined,
  };
  const hasInlineContent =
    Array.isArray(input.payload.messages) || input.payload.transcript !== undefined;
  const transcriptPath = readOptionalText(input.payload, "transcript_path");
  if (hasInlineContent || !transcriptPath) {
    return skipped;
  }

  const sessionDigest = buildWritebackSessionDigest(
    readOptionalText(input.payload, "session_id"),
  );
  const transcriptIdentity = await buildTranscriptIdentity(transcriptPath);
  const cursorCheckpoint = sessionDigest
    ? await readInstalledHostTranscriptCursorCheckpoint({
        homeRoot: input.homeRoot,
        host: input.host,
        sessionDigest,
      })
    : undefined;
  const fromOffset = cursorCheckpoint?.transcriptIdentity === transcriptIdentity
    ? cursorCheckpoint.offset
    : undefined;
  // Host-specific transcript formats: Claude Stop payloads reference Claude
  // session JSONL; native Codex Stop and --from-rollout both point at rollout
  // files.
  const readDelta =
    input.host === "codex" ? readCodexRolloutDelta : readClaudeTranscriptDelta;
  const delta = await readDelta({
    ...(fromOffset !== undefined ? { fromOffset } : {}),
    maxContentChars: input.maxChars,
    maxMessages: input.maxMessages,
    transcriptPath,
  });
  const hydratedPayload: Record<string, unknown> = {
    ...input.payload,
    messages: delta.messages,
  };
  delete hydratedPayload.prompt;
  delete hydratedPayload.summary;

  return {
    attempted: true,
    cursorCheckpoint,
    deltaMessageCount: delta.messages.length,
    ...(delta.formatDrift ? { formatDrift: delta.formatDrift } : {}),
    nextOffset: delta.nextOffset,
    payload: hydratedPayload,
    readStatus: delta.status,
    sessionDigest,
    transcriptIdentity,
  };
}

async function applyTranscriptHydrationOutcome(args: {
  hydration: TranscriptHydration;
  input: InstalledHostWritebackInput;
  result: InstalledHostWritebackResult;
}): Promise<InstalledHostWritebackResult> {
  const { hydration, input, result } = args;
  if (!hydration.attempted) {
    return result;
  }

  const sessionDigest = hydration.sessionDigest;
  const extractionOutcome = resolveWritebackExtractionOutcome(result);
  let cursorAdvanced = false;
  if (
    sessionDigest &&
    hydration.cursorCheckpoint !== undefined &&
    hydration.readStatus === "ok" &&
    hydration.transcriptIdentity &&
    extractionOutcome !== "failed"
  ) {
    try {
      cursorAdvanced = await commitInstalledHostTranscriptCursor({
        expected: hydration.cursorCheckpoint,
        homeRoot: input.homeRoot,
        host: input.host,
        now: new Date().toISOString(),
        offset: hydration.nextOffset,
        sessionDigest,
        transcriptIdentity: hydration.transcriptIdentity,
      });
    } catch {
      // Fail open: a lost cursor write only means the next turn re-reads the
      // same delta, which the ledger dedupe absorbs.
    }
  }

  return {
    ...result,
    trace: {
      ...result.trace,
      extractionOutcome,
      transcriptCursorAdvanced: cursorAdvanced,
      transcriptDeltaMessageCount: hydration.deltaMessageCount,
      transcriptPathUsed: true,
      transcriptReadStatus: hydration.readStatus,
      ...(sessionDigest ? { transcriptSessionDigest: sessionDigest } : {}),
    },
  };
}

function normalizeWritebackMessages(
  payload: Record<string, unknown>,
  config: InstalledHostWritebackConfig,
  language: LanguageService,
): NormalizedWritebackMessage[] {
  const annotations = readPayloadAnnotations(payload.annotations);
  const rawMessages = Array.isArray(payload.messages)
    ? payload.messages
    : Array.isArray(payload.transcript)
      ? payload.transcript
      : null;
  const messages = rawMessages
    ? rawMessages.flatMap((message, index) =>
        normalizePayloadMessage(message, annotations.get(index)),
      )
    : normalizeTranscriptText(payload, annotations);
  const summary = normalizeText(readOptionalText(payload, "summary"));
  const prompt = normalizeText(readOptionalText(payload, "prompt"));
  const summaryAnnotation = readSummaryAnnotation(payload);
  const withSignals = [
    ...messages,
    ...(summary
      ? [
          {
            ...(summaryAnnotation ? { annotation: summaryAnnotation } : {}),
            content: summary,
            role: "assistant" as const,
          },
        ]
      : []),
    ...(prompt
      ? [
          {
            content: prompt,
            role: "user" as const,
          },
        ]
      : []),
  ];

  let remainingChars = config.maxChars;
  const bounded: NormalizedWritebackMessage[] = [];
  for (
    let index = withSignals.length - 1;
    index >= 0 && bounded.length < config.maxMessages && remainingChars > 0;
    index -= 1
  ) {
    const message = withSignals[index];
    const content = clampText(
      message.content,
      Math.min(remainingChars, MAX_WRITEBACK_MESSAGE_CHARS),
    );
    const normalized = normalizeText(content);
    if (!normalized) {
      continue;
    }
    const analyzed = analyzeWritebackMessage(
      {
        ...message,
        content: normalized,
      },
      language,
    );
    if (isAcknowledgementOnlyMessage(analyzed)) {
      continue;
    }
    bounded.unshift(analyzed);
    remainingChars -= normalized.length;
  }

  return bounded;
}

function isAcknowledgementOnlyMessage(
  message: NormalizedWritebackMessage,
): boolean {
  if (message.annotation?.remember === "always") {
    return false;
  }
  return message.languageAnalysis.content.assistantAcknowledgement;
}

function analyzeWritebackMessage(
  message: RawWritebackMessage,
  language: LanguageService,
): NormalizedWritebackMessage {
  const context = language.resolveFromText({ text: message.content });
  const content = language.analyzeContent(message.content, context);
  let candidateCounter = 0;
  const extracted = language.extractCandidates(
    {
      locale: context.locale,
      messages: [
        {
          analysis: content,
          content: message.content,
          role: "user",
          sourceMessageIndex: 0,
        },
      ],
      nextId: () => `host-writeback-${++candidateCounter}`,
    },
    context,
  );
  return {
    ...message,
    languageAnalysis: {
      content,
      extracted,
      sensitiveCredential: containsSensitiveCredentialFromAnalysis(
        message.content,
        content,
      ),
    },
  };
}

function readPayloadAnnotations(value: unknown): Map<number, HostPayloadAnnotation> {
  const annotations = new Map<number, HostPayloadAnnotation>();
  if (!Array.isArray(value)) {
    return annotations;
  }

  value.forEach((annotation) => {
    if (!isRecord(annotation)) {
      return;
    }
    const messageIndex = typeof annotation.messageIndex === "number"
      ? Math.floor(annotation.messageIndex)
      : undefined;
    if (messageIndex === undefined || messageIndex < 0) {
      return;
    }
    const remember =
      annotation.remember === "always" ||
      annotation.remember === "auto" ||
      annotation.remember === "never"
        ? annotation.remember
        : undefined;
    const kindHint = readCandidateKind(annotation.kindHint);
    annotations.set(messageIndex, {
      ...(annotation.confirmed === true ? { confirmed: true } : {}),
      ...(kindHint ? { kindHint } : {}),
      ...(typeof annotation.reason === "string" && annotation.reason.trim().length > 0
        ? { machineReason: "host_annotation" }
        : {}),
      ...(typeof annotation.reason === "string" && annotation.reason.trim().length > 0
        ? { reason: annotation.reason.trim() }
        : {}),
      ...(remember ? { remember } : {}),
      ...(annotation.verified === true ? { verified: true } : {}),
    });
  });

  return annotations;
}

function readSummaryAnnotation(
  payload: Record<string, unknown>,
): HostPayloadAnnotation | undefined {
  const confirmed = payload.summary_confirmed === true;
  const verified = payload.summary_verified === true;
  const remember =
    payload.summary_remember === "always" ||
    payload.summary_remember === "auto" ||
    payload.summary_remember === "never"
      ? payload.summary_remember
      : undefined;
  const kindHint = readCandidateKind(payload.summary_kind);
  const reason = normalizeText(readOptionalText(payload, "summary_reason"));

  if (!confirmed && !verified) {
    if (remember === "never") {
      return {
        ...(kindHint ? { kindHint } : {}),
        ...(reason ? { machineReason: "host_annotation" } : {}),
        ...(reason ? { reason } : {}),
        remember: "never",
      };
    }
    return undefined;
  }

  return {
    ...(confirmed ? { confirmed: true } : {}),
    ...(kindHint ? { kindHint } : {}),
    ...(reason ? { machineReason: "host_annotation" } : {}),
    ...(reason ? { reason } : {}),
    remember: remember ?? (confirmed || verified ? "always" : "auto"),
    ...(verified ? { verified: true } : {}),
  };
}

function normalizePayloadMessage(
  value: unknown,
  annotation: HostPayloadAnnotation | undefined,
): RawWritebackMessage[] {
  if (typeof value === "string") {
    const annotations = new Map<number, HostPayloadAnnotation>();
    if (annotation) {
      annotations.set(0, annotation);
    }
    return normalizeTranscriptLine(value, 0, annotations);
  }
  if (!isRecord(value)) {
    return [];
  }

  const content = normalizeText(
    typeof value.content === "string"
      ? value.content
      : typeof value.text === "string"
        ? value.text
        : undefined,
  );
  if (!content) {
    return [];
  }
  const role = readPayloadMessageRole(value.role);
  if (!role) {
    return [];
  }

  return [
    {
      annotation,
      content,
      role,
    },
  ];
}

function normalizeTranscriptText(
  payload: Record<string, unknown>,
  annotations: Map<number, HostPayloadAnnotation>,
): RawWritebackMessage[] {
  const transcript = normalizeText(readOptionalText(payload, "transcript"));
  if (!transcript) {
    return [];
  }

  return transcript
    .split(/\r?\n/u)
    .map((line, index): RawWritebackMessage | null => {
      return normalizeTranscriptLine(line, index, annotations)[0] ?? null;
    })
    .filter((message): message is RawWritebackMessage => message !== null);
}

function normalizeTranscriptLine(
  line: string,
  index: number,
  annotations: Map<number, HostPayloadAnnotation>,
): RawWritebackMessage[] {
  const match = line.match(
    /^\s*(user|assistant|host|host_event|system|tool)\s*:\s*(.+)$/iu,
  );
  if (!match) {
    return [];
  }
  const roleLabel = match[1];
  const contentText = match[2];
  if (!roleLabel || !contentText) {
    return [];
  }
  const role = readPayloadMessageRole(roleLabel);
  if (!role) {
    return [];
  }
  const content = normalizeText(contentText);
  if (!content) {
    return [];
  }
  return [
    {
      annotation: annotations.get(index),
      content,
      role,
    },
  ];
}

function readPayloadMessageRole(value: unknown): NormalizedWritebackRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }
  const role = normalized.toLowerCase();
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "user") {
    return "user";
  }
  if (role === "host" || role === "host_event") {
    return "host_event";
  }

  return undefined;
}

function buildWritebackCandidates(input: {
  command: InstalledHostWritebackCommand;
  config: InstalledHostWritebackConfig;
  host: InstalledHostKind;
  scope: MemoryScope;
  messages: NormalizedWritebackMessage[];
}): CandidateWithKey[] {
  return input.messages.flatMap((message) =>
    buildMessageCandidate(message, {
      command: input.command,
      config: input.config,
      host: input.host,
      scope: input.scope,
    }),
  );
}

function toDurableWritebackScope(scope: MemoryScope): MemoryScope {
  const { sessionId: _sessionId, ...durableScope } = scope;
  return durableScope;
}

function resolveWritebackExtractionStrategy(
  context: InstalledHostResolvedContext,
): MemoryExtractionStrategy {
  return context.providers?.assistedExtractor ? "llm-assisted" : "rules-only";
}

// Runs the batch LLM pre-extraction stage when the writeback config and the
// configured provider allow it. "skipped" is not a failure: rules-only
// configs and provider-less installs simply never attempt the stage.
async function runBatchWritebackExtraction(input: {
  command: InstalledHostWritebackCommand;
  config: InstalledHostWritebackConfig;
  context: InstalledHostResolvedContext;
  dependencies: InstalledHostWritebackDependencies;
  host: InstalledHostKind;
  language: LanguageService;
  messages: NormalizedWritebackMessage[];
  scope: MemoryScope;
}): Promise<{
  attempted: boolean;
  candidates: CandidateWithKey[];
  status: "extractor_failed" | "ok" | "skipped";
}> {
  const strategy = input.config.extractionStrategy ?? "auto";
  const provider = input.context.providers?.assistedExtractor;
  const safeMessages = input.messages.filter(
    (message) =>
      message.annotation?.remember !== "never" &&
      !message.languageAnalysis.sensitiveCredential,
  );
  if (strategy === "rules-only" || !provider || safeMessages.length === 0) {
    return { attempted: false, candidates: [], status: "skipped" };
  }

  const extractor = (
    input.dependencies.createWritebackExtractor ??
    ((model: InstalledHostModelProviderConfig) =>
      createProviderMemoryExtractor({ model }))
  )(provider);
  const result = await buildAssistedWritebackCandidates({
    command: input.command,
    config: input.config,
    extractor,
    host: input.host,
    language: input.language,
    messages: safeMessages.map((message) => ({
      content: message.content,
      role: message.role,
      sensitiveCredential: message.languageAnalysis.sensitiveCredential,
    })),
    scope: input.scope,
  });
  return { attempted: true, candidates: result.candidates, status: result.status };
}

// Rules candidates stay first (they are the deterministic floor); batch
// candidates join only when their scoped content key is new.
function mergeWritebackCandidateSets(
  rules: CandidateWithKey[],
  batch: CandidateWithKey[],
): CandidateWithKey[] {
  if (batch.length === 0) {
    return rules;
  }
  const seen = new Set(rules.map((candidate) => candidate.key));
  const merged = [...rules];
  for (const candidate of batch) {
    if (seen.has(candidate.key)) {
      continue;
    }
    seen.add(candidate.key);
    merged.push(candidate);
  }
  return merged;
}

function buildMessageCandidate(
  message: NormalizedWritebackMessage,
  runtime: {
    command: InstalledHostWritebackCommand;
    config: InstalledHostWritebackConfig;
    host: InstalledHostKind;
    scope: MemoryScope;
  },
): CandidateWithKey[] {
  if (message.annotation?.remember === "never") {
    return [];
  }

  const source = message.role === "host_event" ? "host_event" : message.role;
  const secretLike = message.languageAnalysis.sensitiveCredential;
  const base = secretLike
    ? null
    : classifyDurableSignal(message);
  if (!base && !secretLike) {
    return [];
  }

  const content = secretLike
    ? "[redacted secret-like content]"
    : clampText(message.content, MAX_WRITEBACK_MESSAGE_CHARS);
  const kind = message.annotation?.kindHint ?? base?.kind ?? "fact";
  const confidence = secretLike ? 0 : base?.confidence ?? 0.72;
  const assistantAllowed =
    source !== "assistant" ||
    isAssistantOutputAllowed(
      message.annotation,
      runtime.config.allowAssistantOutput,
    );
  const durable =
    !secretLike &&
    assistantAllowed &&
    confidence >= runtime.config.minConfidence &&
    kind !== "episode";
  const reason = secretLike
    ? "secret_blocked"
    : !assistantAllowed
      ? "assistant_policy_blocked"
      : durable
        ? base?.reason ?? message.annotation?.machineReason ?? "host_annotation"
        : "below_confidence";

  const messageRole = source === "assistant" ? "assistant" : "user";
  const candidate: InstalledHostWritebackCandidate = {
    confidence,
    content,
    durable,
    kind,
    reason,
    source,
  };

  return [
    {
      ...candidate,
      key: buildCandidateKey({
        candidate,
        scope: runtime.scope,
      }),
      message: {
        content,
        role: messageRole,
      },
      messageAnnotation: {
        ...(source === "user" && durable ? { confirmed: true } : {}),
        ...(source === "assistant" && message.annotation?.confirmed === true
          ? { confirmed: true }
          : {}),
        ...(source === "assistant" && message.annotation?.verified === true
          ? { verified: true }
          : {}),
        kindHint: toMessageAnnotationKind(kind),
        messageIndex: 0,
        metadataPatch: {
          attributes: {
            hostWritebackAssistantPolicy: runtime.config.allowAssistantOutput,
            hostWritebackCommand: runtime.command,
            hostWritebackHost: runtime.host,
            hostWritebackMode: runtime.config.mode,
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

function classifyDurableSignal(
  message: NormalizedWritebackMessage,
): { confidence: number; kind: InstalledHostWritebackCandidate["kind"]; reason: string } | null {
  if (message.annotation?.remember === "always") {
    return {
      confidence: 0.86,
      kind: message.annotation.kindHint ?? "fact",
      reason: message.annotation.machineReason ?? "host_annotation",
    };
  }

  const analysis = message.languageAnalysis.content;
  const extracted = message.languageAnalysis.extracted;

  if (
    extracted.some((candidate) =>
      candidate.metadata?.attributes?.languageDurableSignal ===
        "procedural_feedback"
    )
  ) {
    return {
      confidence: 0.9,
      kind: "feedback",
      reason: "procedural_feedback",
    };
  }
  if (analysis.correctionCue && hasDurableLanguageCandidate(extracted)) {
    return {
      confidence: 0.9,
      kind: "feedback",
      reason: "procedural_feedback",
    };
  }
  if (
    extracted.some((candidate) => candidate.kindHint === "preference") ||
    extracted.some((candidate) => candidate.kindHint === "feedback")
  ) {
    return {
      confidence: 0.88,
      kind: "preference",
      reason: "explicit_preference",
    };
  }
  if (
    analysis.blockerFact || analysis.openLoopFact || analysis.unresolved
  ) {
    return {
      confidence: 0.84,
      kind: "fact",
      reason: "open_loop",
    };
  }
  if (
    extracted.some((candidate) =>
      candidate.metadata?.attributes?.languageDurableSignal ===
        "confirmed_decision"
    ) ||
    (analysis.durableCue && !analysis.sourceOfTruthDirective)
  ) {
    return {
      confidence: 0.82,
      kind: "fact",
      reason: "confirmed_decision",
    };
  }
  if (
    analysis.sourceOfTruthDirective ||
    extracted.some((candidate) => candidate.kindHint === "reference")
  ) {
    return {
      confidence: 0.78,
      kind: "reference",
      reason: "stable_reference",
    };
  }

  return null;
}

function hasDurableLanguageCandidate(candidates: MemoryCandidate[]): boolean {
  return candidates.some(
    (candidate) =>
      candidate.kindHint !== "episode" && candidate.kindHint !== "noise",
  );
}

export function isAssistantOutputAllowed(
  annotation: HostPayloadAnnotation | undefined,
  policy: InstalledHostWritebackConfig["allowAssistantOutput"],
): boolean {
  if (!annotation || annotation.remember !== "always") {
    return false;
  }
  if (policy === "never") {
    return false;
  }
  if (policy === "confirmed") {
    return annotation.confirmed === true;
  }
  if (policy === "verified") {
    return annotation.verified === true;
  }

  return annotation.confirmed === true || annotation.verified === true;
}

async function recordObservedCandidates(input: {
  candidates: CandidateWithKey[];
  command: InstalledHostWritebackCommand;
  homeRoot: string | undefined;
  host: InstalledHostKind;
  scope: MemoryScope;
  sessionDigest?: string;
}): Promise<{
  failed: boolean;
  observedCount: number;
}> {
  if (input.candidates.length === 0) {
    return {
      failed: false,
      observedCount: 0,
    };
  }

  const scopeDigest = buildWritebackScopeDigest(input.scope);
  const seenInBatch = new Set<string>();
  const records = input.candidates.flatMap((candidate) => {
    const scopedKey = buildScopedWritebackCandidateKey({
      candidateKey: candidate.key,
      scopeDigest,
    });
    if (seenInBatch.has(scopedKey) || seenInBatch.has(candidate.key)) {
      return [];
    }
    seenInBatch.add(scopedKey);
    seenInBatch.add(candidate.key);
    return [
      {
        candidate,
        eventId: buildWritebackAuditEventId({
          candidateKey: scopedKey,
          scopeDigest,
        }),
        legacyKey: candidate.key,
        scopedKey,
      },
    ];
  });
  let observedCount = 0;

  try {
    await withInstalledHostWritebackLedgerLock(
      input.host,
      input.homeRoot,
      async () => {
        const now = new Date().toISOString();
        let ledger = await readInstalledHostWritebackLedger(input.host, input.homeRoot);
        const committedOrPending = new Set([...ledger.events, ...ledger.pending]);
        for (const { candidate, eventId, legacyKey, scopedKey } of records) {
          if (committedOrPending.has(scopedKey) || committedOrPending.has(legacyKey)) {
            continue;
          }
          const nextLedger = markWritebackAuditObserved(ledger, {
            candidateKey: scopedKey,
            command: input.command,
            content: candidate.content,
            eventId,
            host: input.host,
            kind: candidate.kind,
            now,
            reason: candidate.reason,
            scopeDigest,
            source: candidate.source,
            ...(input.sessionDigest ? { sessionDigest: input.sessionDigest } : {}),
          });
          if (nextLedger !== ledger) {
            observedCount += 1;
          }
          ledger = nextLedger;
        }
        await writeInstalledHostWritebackLedger(input.host, input.homeRoot, ledger);
      },
    );
    return {
      failed: false,
      observedCount,
    };
  } catch {
    return {
      failed: true,
      observedCount: 0,
    };
  }
}

async function writeNewCandidates(input: {
  candidates: CandidateWithKey[];
  command: InstalledHostWritebackCommand;
  extractionStrategy: MemoryExtractionStrategy;
  homeRoot: string | undefined;
  host: InstalledHostKind;
  memory: GoodMemory;
  scope: MemoryScope;
  sessionDigest?: string;
}): Promise<{
  duplicateCount: number;
  failed: boolean;
  failedKeys: Set<string>;
  pendingCandidateCount: number;
  rejectedKeys: Set<string>;
  resolvedExtractionStrategies: Set<MemoryExtractionStrategy>;
  uncommittedKeys: Set<string>;
  wrote: boolean;
  writtenKeys: Set<string>;
}> {
  const scopeDigest = buildWritebackScopeDigest(input.scope);
  const records = input.candidates.map((candidate) => ({
    candidate,
    eventId: buildWritebackAuditEventId({
      candidateKey: buildScopedWritebackCandidateKey({
        candidateKey: candidate.key,
        scopeDigest,
      }),
      scopeDigest,
    }),
    legacyKey: candidate.key,
    scopedKey: buildScopedWritebackCandidateKey({
      candidateKey: candidate.key,
      scopeDigest,
    }),
  }));
  const seenInBatch = new Set<string>();
  const writtenKeys: string[] = [];
  const rejectedKeys: string[] = [];
  const uncommittedKeys: string[] = [];
  const failedKeys = new Set<string>();
  const resolvedExtractionStrategies = new Set<MemoryExtractionStrategy>();
  let duplicateCount = 0;
  let pendingCandidateCount = 0;

  for (const [index, record] of records.entries()) {
    const { candidate, eventId, legacyKey, scopedKey } = record;
    if (seenInBatch.has(scopedKey) || seenInBatch.has(legacyKey)) {
      duplicateCount += 1;
      continue;
    }
    seenInBatch.add(scopedKey);
    seenInBatch.add(legacyKey);

    try {
      const reservation = await reserveWritebackCandidate({
        candidate,
        command: input.command,
        eventId,
        homeRoot: input.homeRoot,
        host: input.host,
        legacyKey,
        scopedKey,
        scopeDigest,
        sessionDigest: input.sessionDigest,
      });
      if (reservation !== "reserved") {
        duplicateCount += 1;
        if (reservation === "pending") {
          pendingCandidateCount += 1;
        }
        continue;
      }
    } catch {
      failedKeys.add(scopedKey);
      return buildWritebackFailureResult({
        duplicateCount,
        failedKeys,
        pendingCandidateCount,
        records: records.slice(index + 1),
        rejectedKeys,
        resolvedExtractionStrategies,
        uncommittedKeys,
        writtenKeys,
      });
    }

    let acceptedCurrentCandidate = false;
    try {
      const result = await input.memory.remember({
        annotations: [
          {
            ...candidate.messageAnnotation,
            messageIndex: 0,
          },
        ],
        extractionStrategy: input.extractionStrategy,
        messages: [candidate.message],
        scope: input.scope,
      });
      if (result.metadata?.resolvedExtractionStrategy) {
        resolvedExtractionStrategies.add(
          result.metadata.resolvedExtractionStrategy,
        );
      }
      if (result.accepted > 0) {
        acceptedCurrentCandidate = true;
        const linkedRecordIds = collectWritebackLinkedRecordIds(result.events);
        const memoryIds = linkedRecordIds
          .filter((record) => record.type === "memory")
          .map((record) => record.id);
        await commitWritebackCandidate({
          eventId,
          homeRoot: input.homeRoot,
          host: input.host,
          linkedRecordIds,
          memoryIds,
          scopedKey,
        });
        writtenKeys.push(scopedKey);
      } else {
        await clearRejectedWritebackCandidate({
          eventId,
          homeRoot: input.homeRoot,
          host: input.host,
          scopedKey,
        });
        rejectedKeys.push(scopedKey);
      }
    } catch {
      if (acceptedCurrentCandidate) {
        uncommittedKeys.push(scopedKey);
      } else {
        try {
          await failWritebackCandidate({
            eventId,
            homeRoot: input.homeRoot,
            host: input.host,
            scopedKey,
          });
        } catch {
          // Keep the conservative pending marker if cleanup cannot be persisted.
        }
      }
      failedKeys.add(scopedKey);
      return buildWritebackFailureResult({
        duplicateCount,
        failedKeys,
        pendingCandidateCount,
        records: records.slice(index + 1),
        rejectedKeys,
        resolvedExtractionStrategies,
        uncommittedKeys,
        writtenKeys,
      });
    }
  }

  return {
    duplicateCount,
    failed: false,
    failedKeys: new Set<string>(),
    pendingCandidateCount,
    rejectedKeys: new Set(rejectedKeys),
    resolvedExtractionStrategies,
    uncommittedKeys: new Set<string>(),
    wrote: writtenKeys.length > 0,
    writtenKeys: new Set(writtenKeys),
  };
}

async function reserveWritebackCandidate(input: {
  candidate: CandidateWithKey;
  command: InstalledHostWritebackCommand;
  eventId: string;
  homeRoot: string | undefined;
  host: InstalledHostKind;
  legacyKey: string;
  scopedKey: string;
  scopeDigest: string;
  sessionDigest?: string;
}): Promise<"committed" | "pending" | "reserved"> {
  return await withInstalledHostWritebackLedgerLock(
    input.host,
    input.homeRoot,
    async () => {
      let ledger = await readInstalledHostWritebackLedger(input.host, input.homeRoot);
      if (
        ledger.events.includes(input.scopedKey) ||
        ledger.events.includes(input.legacyKey)
      ) {
        return "committed";
      }
      if (
        ledger.pending.includes(input.scopedKey) ||
        ledger.pending.includes(input.legacyKey)
      ) {
        return "pending";
      }
      ledger = markWritebackAuditPending(ledger, {
        candidateKey: input.scopedKey,
        command: input.command,
        content: input.candidate.content,
        eventId: input.eventId,
        host: input.host,
        kind: input.candidate.kind,
        mode: "selective",
        now: new Date().toISOString(),
        reason: input.candidate.reason,
        scopeDigest: input.scopeDigest,
        source: input.candidate.source,
        ...(input.sessionDigest ? { sessionDigest: input.sessionDigest } : {}),
      });
      await writeInstalledHostWritebackLedger(input.host, input.homeRoot, ledger);
      return "reserved";
    },
  );
}

async function commitWritebackCandidate(input: {
  eventId: string;
  homeRoot: string | undefined;
  host: InstalledHostKind;
  linkedRecordIds: InstalledHostWritebackLinkedRecordId[];
  memoryIds: string[];
  scopedKey: string;
}): Promise<void> {
  await withInstalledHostWritebackLedgerLock(input.host, input.homeRoot, async () => {
    const ledger = markWritebackAuditCommitted(
      await readInstalledHostWritebackLedger(input.host, input.homeRoot),
      {
        candidateKey: input.scopedKey,
        eventId: input.eventId,
        linkedRecordIds: input.linkedRecordIds,
        memoryIds: input.memoryIds,
        now: new Date().toISOString(),
      },
    );
    await writeInstalledHostWritebackLedger(input.host, input.homeRoot, ledger);
  });
}

async function clearRejectedWritebackCandidate(input: {
  eventId: string;
  homeRoot: string | undefined;
  host: InstalledHostKind;
  scopedKey: string;
}): Promise<void> {
  await withInstalledHostWritebackLedgerLock(input.host, input.homeRoot, async () => {
    const ledger = clearWritebackAuditPending(
      await readInstalledHostWritebackLedger(input.host, input.homeRoot),
      {
        candidateKey: input.scopedKey,
        eventId: input.eventId,
      },
    );
    await writeInstalledHostWritebackLedger(input.host, input.homeRoot, ledger);
  });
}

export interface RecordRememberToolWritebackInput {
  content: string;
  events: RememberEvent[];
  homeRoot?: string;
  host: InstalledHostKind;
  mode: InstalledHostWritebackMode;
  scope: MemoryScope;
  sessionId?: string;
  source: "assistant" | "user";
}

// Explicit goodmemory_remember tool writes share the writeback audit surface
// (`goodmemory <host> writeback inspect` / `forget --event-id`) instead of
// being auditable only through exportMemory. Recorded as an already-committed
// remember-tool event: there is no reserve phase because the durable write has
// already happened by the time this runs.
export async function recordRememberToolWriteback(
  input: RecordRememberToolWritebackInput,
): Promise<{ eventId: string } | null> {
  const linkedRecordIds = collectWritebackLinkedRecordIds(input.events);
  if (linkedRecordIds.length === 0) {
    return null;
  }
  const memoryIds = linkedRecordIds
    .filter((record) => record.type === "memory")
    .map((record) => record.id);
  const kind = input.events
    .filter((event) => event.outcome !== "rejected")
    .map((event) => readCandidateKind(event.memoryType))
    .find((value) => value !== undefined) ?? "fact";
  const scopeDigest = buildWritebackScopeDigest(input.scope);
  const scopedKey = buildScopedWritebackCandidateKey({
    candidateKey: buildCandidateKey({
      candidate: {
        confidence: 1,
        content: input.content,
        durable: true,
        kind,
        reason: "remember_tool",
        source: input.source,
      },
      scope: input.scope,
    }),
    scopeDigest,
  });
  const eventId = buildWritebackAuditEventId({
    candidateKey: scopedKey,
    scopeDigest,
  });
  const now = new Date().toISOString();
  const sessionDigest = input.sessionId
    ? buildWritebackSessionDigest(input.sessionId)
    : undefined;

  await withInstalledHostWritebackLedgerLock(input.host, input.homeRoot, async () => {
    let ledger = await readInstalledHostWritebackLedger(input.host, input.homeRoot);
    ledger = markWritebackAuditPending(ledger, {
      candidateKey: scopedKey,
      command: "remember-tool",
      content: input.content,
      eventId,
      host: input.host,
      kind,
      mode: input.mode,
      now,
      reason: "remember_tool",
      scopeDigest,
      source: input.source,
      ...(sessionDigest ? { sessionDigest } : {}),
    });
    ledger = markWritebackAuditCommitted(ledger, {
      candidateKey: scopedKey,
      eventId,
      linkedRecordIds,
      memoryIds,
      now,
    });
    await writeInstalledHostWritebackLedger(input.host, input.homeRoot, ledger);
  });
  return { eventId };
}

async function failWritebackCandidate(input: {
  eventId: string;
  homeRoot: string | undefined;
  host: InstalledHostKind;
  scopedKey: string;
}): Promise<void> {
  await withInstalledHostWritebackLedgerLock(input.host, input.homeRoot, async () => {
    const ledger = markWritebackAuditFailed(
      await readInstalledHostWritebackLedger(input.host, input.homeRoot),
      {
        candidateKey: input.scopedKey,
        errorCode: "remember_failed",
        eventId: input.eventId,
        now: new Date().toISOString(),
      },
    );
    await writeInstalledHostWritebackLedger(input.host, input.homeRoot, ledger);
  });
}

function buildWritebackFailureResult(input: {
  duplicateCount: number;
  failedKeys: Set<string>;
  pendingCandidateCount: number;
  records: Array<{ scopedKey: string }>;
  rejectedKeys: string[];
  resolvedExtractionStrategies: Set<MemoryExtractionStrategy>;
  uncommittedKeys: string[];
  writtenKeys: string[];
}): {
  duplicateCount: number;
  failed: boolean;
  failedKeys: Set<string>;
  pendingCandidateCount: number;
  rejectedKeys: Set<string>;
  resolvedExtractionStrategies: Set<MemoryExtractionStrategy>;
  uncommittedKeys: Set<string>;
  wrote: boolean;
  writtenKeys: Set<string>;
} {
  for (const record of input.records) {
    input.failedKeys.add(record.scopedKey);
  }
  return {
    duplicateCount: input.duplicateCount,
    failed: true,
    failedKeys: input.failedKeys,
    pendingCandidateCount: input.pendingCandidateCount,
    rejectedKeys: new Set(input.rejectedKeys),
    resolvedExtractionStrategies: input.resolvedExtractionStrategies,
    uncommittedKeys: new Set(input.uncommittedKeys),
    wrote: input.writtenKeys.length > 0 || input.uncommittedKeys.length > 0,
    writtenKeys: new Set(input.writtenKeys),
  };
}

function collectWritebackLinkedRecordIds(
  events: RememberEvent[],
): InstalledHostWritebackLinkedRecordId[] {
  const linked = new Map<string, InstalledHostWritebackLinkedRecordId>();
  for (const event of events) {
    if (event.outcome === "rejected") {
      continue;
    }
    if (event.memoryId && event.outcome !== "merged") {
      linked.set(`memory:${event.memoryId}`, {
        id: event.memoryId,
        type: "memory",
      });
    }
    for (const evidenceId of event.evidenceIds ?? []) {
      linked.set(`evidence:${evidenceId}`, {
        id: evidenceId,
        type: "evidence",
      });
    }
  }
  return [...linked.values()];
}

function stripCandidateKey(
  candidate: CandidateWithKey,
): InstalledHostWritebackCandidate {
  return {
    confidence: candidate.confidence,
    content: candidate.content,
    durable: candidate.durable,
    kind: candidate.kind,
    reason: candidate.reason,
    source: candidate.source,
  };
}

export function buildCandidateKey(input: {
  candidate: InstalledHostWritebackCandidate;
  scope: MemoryScope;
}): string {
  const hash = createHash("sha256")
    .update(
      [
        input.scope.userId,
        input.scope.workspaceId ?? "",
        input.scope.agentId ?? "",
        input.candidate.kind,
        input.candidate.content.toLowerCase(),
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 32);
  return `candidate:${hash}`;
}

function readCandidateKind(
  value: unknown,
): InstalledHostWritebackCandidate["kind"] | undefined {
  return value === "preference" ||
    value === "fact" ||
    value === "feedback" ||
    value === "reference" ||
    value === "episode"
    ? value
    : undefined;
}

export function toMessageAnnotationKind(
  kind: InstalledHostWritebackCandidate["kind"],
): Exclude<MemoryCandidateKindHint, "episode" | "noise"> {
  return kind === "episode" ? "fact" : kind;
}

export function clampText(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
