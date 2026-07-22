import type { MemoryScope } from "../domain/scope";
import type { GoodMemory, RecallResult } from "../api/contracts";
import { readGoodMemoryIntegrationSupport } from "../api/integrationSupport";
import { createLanguageService, type LanguageService } from "../language";
import { estimateTextTokens } from "../tokenEstimator";
import {
  normalizeText,
  readOptionalText,
} from "./hostConfigValidation";
import {
  createInstalledHostMemory,
  resolveInstalledHostContext,
  type InstalledHostContextDependencies,
  type InstalledHostResolvedContext,
} from "./hostExecutionContext";
import type { InstalledHostKind } from "./hostInstall";
import { evaluateInstalledHostPreToolUse } from "./hostActionRuntime";
import { isInstalledHostMcpRegistered } from "./hostMcpConfig";
import {
  createInstalledHostProgressiveRecallService,
  writeInstalledHostProgressiveRecordCache,
} from "./hostProgressiveRecall";
import { recordInstalledHostWritebackRecallHits } from "./hostWritebackAuditRuntime";
import { shouldInjectPromptContext } from "./hostInjectionGate";
import {
  hashInjectionContent,
  isDuplicateInjection,
  readInstalledHostInjectionSession,
  readInstalledHostMaintenanceMark,
  recordInstalledHostInjection,
  resetInstalledHostInjectionSession,
  writeInstalledHostMaintenanceMark,
} from "./hostInjectionState";
import { buildWritebackSessionDigest } from "./hostWritebackAuditLedger";
import {
  executeInstalledHostWriteback,
  type InstalledHostWritebackResult,
} from "./hostWritebackRuntime";
import { parseGoodMemoryRecordRef } from "../progressive/recall";
import { basename } from "node:path";

export type InstalledHostHookCommand =
  | "pre-tool-use"
  | "session-start"
  | "session-stop"
  | "user-prompt-submit";

export interface InstalledHostHookDependencies
  extends InstalledHostContextDependencies {}

export interface InstalledHostHookExecutionInput {
  command: InstalledHostHookCommand;
  host: InstalledHostKind;
  homeRoot?: string;
  payload: Record<string, unknown>;
}

export interface InstalledHostHookExecutionResult {
  applied: boolean;
  context: string | null;
  maxTokens?: number;
  output: Record<string, unknown> | null;
  query: string | null;
  reason:
    | "allow"
    | "assessment_failed"
    | "applied"
    | "disabled"
    | "duplicate_context"
    | "empty_context"
    | "empty_prompt"
    | "invalid_global_config"
    | "invalid_repo_config"
    | "low_relevance"
    | "managed_command"
    | "missing_command"
    | "missing_global_config"
    | "missing_session"
    | "missing_repo_config"
    | "recall_failed"
    | "unsupported_hook_event"
    | "unsupported_tool"
    | "writeback_failed"
    | "writeback_written";
  scope: MemoryScope | null;
  writeback: InstalledHostHookWritebackResult;
}

export interface InstalledHostHookWritebackResult {
  candidateCount: number;
  attempted: boolean;
  mode?: InstalledHostWritebackResult["mode"];
  reason:
    | "disabled"
    | "duplicate"
    | "empty_content"
    | "failed"
    | "no_candidates"
    | "observed"
    | "source_disabled"
    | "written";
  wrote: boolean;
}

const MAX_HOOK_CONTEXT_CHARS = 10_000;
const MAX_PROGRESSIVE_HOOK_RECORDS = 10;

export async function executeInstalledHostHook(
  input: InstalledHostHookExecutionInput,
  dependencies: InstalledHostHookDependencies = {},
): Promise<InstalledHostHookExecutionResult> {
  if (input.command === "pre-tool-use") {
    const preToolUse = await evaluateInstalledHostPreToolUse(
      {
        homeRoot: input.homeRoot,
        host: input.host,
        payload: input.payload,
      },
      dependencies,
    );

    if (preToolUse.reason === "applied") {
      return {
        applied: true,
        context: null,
        maxTokens: preToolUse.maxTokens,
        output: preToolUse.output,
        query: preToolUse.command,
        reason: "applied",
        scope: preToolUse.scope,
        writeback: {
          attempted: false,
          candidateCount: 0,
          reason: "source_disabled",
          wrote: false,
        },
      };
    }

    return buildHookSkipResult({
      debug: preToolUse.debug,
      host: input.host,
      reason: preToolUse.reason,
      command: input.command,
      maxTokens: preToolUse.maxTokens,
      query: preToolUse.command,
      scope: preToolUse.scope,
    });
  }

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
    return buildHookSkipResult({
      debug: resolved.debug,
      host: input.host,
      reason: resolved.status,
      command: input.command,
    });
  }

  if (input.command === "session-stop") {
    // Claude Code's Stop hook fires once per assistant turn, so writeback
    // provenance is per-turn; the transcript cursor keeps each firing O(delta).
    const writeback = await executeInstalledHostWriteback(
      {
        command: "turn-end",
        homeRoot: input.homeRoot,
        host: input.host,
        payload: input.payload,
      },
      dependencies,
    );

    // Writeback first, opportunistic maintenance second: capture must never
    // wait behind a maintenance pass.
    await runOpportunisticMaintenance({
      context: resolved.context,
      dependencies,
      homeRoot: input.homeRoot,
      host: input.host,
    });

    return {
      applied: false,
      context: null,
      output: null,
      query: null,
      reason:
        writeback.reason === "written"
          ? "writeback_written"
          : writeback.reason === "write_failed" ||
              writeback.reason === "audit_failed" ||
              writeback.reason === "transcript_read_failed"
            ? "writeback_failed"
            : "empty_context",
      scope: resolved.context.scope,
      writeback: summarizeHookWriteback(writeback),
    };
  }

  const context = resolved.context;
  const sessionMemory = input.command === "session-start"
    ? createInstalledHostMemory(context, dependencies)
    : undefined;
  const language = sessionMemory
    ? readGoodMemoryIntegrationSupport(sessionMemory)?.language ??
      createLanguageService(context.language)
    : undefined;
  const hookQuery = deriveHookQuery(
    input.command,
    input.payload,
    workspaceRootOf(context),
    language,
  );
  if (!hookQuery) {
    return buildHookSkipResult({
      debug: resolved.context.debug,
      host: input.host,
      reason: "empty_prompt",
      command: input.command,
    });
  }

  const query = hookQuery.query;
  const memory = sessionMemory ?? createInstalledHostMemory(context, dependencies);
  // The once-per-session brief may spend more than per-prompt injection.
  const effectiveMaxTokens =
    input.command === "session-start"
      ? context.sessionStartMaxTokens ?? context.maxTokens
      : context.maxTokens;
  const sessionDigest = buildWritebackSessionDigest(context.scope.sessionId);

  // clear/compact rebuild the host context window from scratch, so the
  // duplicate-suppression state for this session must start over too.
  const sessionStartSource = normalizeText(readOptionalText(input.payload, "source"));
  if (
    input.command === "session-start" &&
    sessionDigest &&
    (sessionStartSource === "clear" || sessionStartSource === "compact")
  ) {
    await resetInstalledHostInjectionSession({
      homeRoot: input.homeRoot,
      host: input.host,
      now: new Date().toISOString(),
      sessionDigest,
    });
  }

  try {
    const recallStartedAt = performance.now();
    const hookContext =
      context.contextMode === "progressive"
        ? await buildProgressiveHookContext({
            context,
            dependencies,
            homeRoot: input.homeRoot,
            host: input.host,
            maxTokens: effectiveMaxTokens,
            locale: hookQuery.locale,
            memory,
            query,
          }).catch(() => null)
        : null;
    const built = hookContext ?? await buildFragmentHookContext({
      context,
      dependencies,
      maxTokens: effectiveMaxTokens,
      locale: hookQuery.locale,
      memory,
      query,
    });
    const recallLatencyMs = Math.round(performance.now() - recallStartedAt);

    if (!built) {
      return buildHookSkipResult({
        debug: resolved.context.debug,
        host: input.host,
        reason: "empty_context",
        command: input.command,
        maxTokens: effectiveMaxTokens,
        query,
        scope: resolved.context.scope,
      });
    }

    const boundedContext = clampText(built.content, MAX_HOOK_CONTEXT_CHARS);
    const injectionDecision = await decidePromptInjection({
      boundedContext,
      built,
      command: input.command,
      context,
      homeRoot: input.homeRoot,
      host: input.host,
      recallLatencyMs,
      sessionDigest,
    });
    if (injectionDecision) {
      return buildHookSkipResult({
        debug: resolved.context.debug,
        host: input.host,
        reason: injectionDecision,
        command: input.command,
        maxTokens: effectiveMaxTokens,
        query,
        scope: resolved.context.scope,
      });
    }

    await recordInstalledHostWritebackRecallHits({
      homeRoot: input.homeRoot,
      host: input.host,
      recalledRecordIds: built.recalledRecordIds,
      scope: context.scope,
      sessionId: context.scope.sessionId,
    }).catch(() => undefined);
    // pre-tool-use never reaches here (deriveHookQuery returns null for it),
    // so the surviving commands are exactly the two injection events.
    if (sessionDigest) {
      await recordInstalledHostInjection({
        contentHash: hashInjectionContent(boundedContext),
        event: {
          command: input.command === "session-start"
            ? "session-start"
            : "user-prompt-submit",
          decision: "injected",
          estimatedTokens: estimateTextTokens(boundedContext),
          recallLatencyMs,
          recordIds: built.recalledRecordIds,
        },
        homeRoot: input.homeRoot,
        host: input.host,
        now: new Date().toISOString(),
        recordIds: built.recalledRecordIds,
        sessionDigest,
      });
    }

    return {
      applied: true,
      context: boundedContext,
      maxTokens: effectiveMaxTokens,
      output: {
        hookSpecificOutput: {
          hookEventName: mapHookEventName(input.command),
          additionalContext: boundedContext,
        },
      },
      query,
      reason: "applied",
      scope: resolved.context.scope,
      writeback: {
        attempted: false,
        candidateCount: 0,
        reason: "source_disabled",
        wrote: false,
      },
    };
  } catch {
    return buildHookSkipResult({
      debug: resolved.context.debug,
      host: input.host,
      reason: "recall_failed",
      command: input.command,
      maxTokens: effectiveMaxTokens,
      query,
      scope: resolved.context.scope,
    });
  }
}

// Per-prompt injection control (promptInjection: "relevance_gated"): skip
// continuity-only recalls (the session-start brief already covered them) and
// exact repeats of already-injected content. Session-start is never gated.
// Skips are recorded to the injection event ring; state failures fail open.
async function decidePromptInjection(input: {
  boundedContext: string;
  built: HookContextBuildResult;
  command: InstalledHostHookCommand;
  context: InstalledHostResolvedContext;
  homeRoot?: string;
  host: InstalledHostKind;
  recallLatencyMs: number;
  sessionDigest: string | undefined;
}): Promise<"duplicate_context" | "low_relevance" | null> {
  if (
    input.command !== "user-prompt-submit" ||
    input.context.promptInjection !== "relevance_gated"
  ) {
    return null;
  }

  const recordSkip = async (
    decision: "duplicate_context" | "low_relevance",
  ): Promise<void> => {
    if (!input.sessionDigest) {
      return;
    }
    await recordInstalledHostInjection({
      event: {
        command: "user-prompt-submit",
        decision,
        estimatedTokens: 0,
        recallLatencyMs: input.recallLatencyMs,
        recordIds: input.built.recalledRecordIds,
      },
      homeRoot: input.homeRoot,
      host: input.host,
      now: new Date().toISOString(),
      sessionDigest: input.sessionDigest,
    });
  };

  // The progressive path has no RecallResult to gate on; only the fragment
  // path carries one.
  if (input.built.recall && !shouldInjectPromptContext(input.built.recall).inject) {
    await recordSkip("low_relevance");
    return "low_relevance";
  }

  if (input.sessionDigest) {
    const session = await readInstalledHostInjectionSession({
      homeRoot: input.homeRoot,
      host: input.host,
      sessionDigest: input.sessionDigest,
    });
    if (
      isDuplicateInjection({
        contentHash: hashInjectionContent(input.boundedContext),
        recordIds: input.built.recalledRecordIds,
        session,
      })
    ) {
      await recordSkip("duplicate_context");
      return "duplicate_context";
    }
  }

  return null;
}

function workspaceRootOf(context: InstalledHostResolvedContext): string {
  return context.workspaceRoot;
}

// Opportunistic session-stop maintenance (config maintenance.auto). Jobs are
// the non-synthesizing set — consolidation stays off (LLM rewriting of
// memories is deliberately not automated). The dream orchestrator enforces
// its own thresholds and a per-scope concurrency gate on top of the
// min-hours cooldown tracked here. Entirely fail-open: results land in the
// state file, never in the hook output.
async function runOpportunisticMaintenance(input: {
  context: InstalledHostResolvedContext;
  dependencies: InstalledHostHookDependencies;
  homeRoot?: string;
  host: InstalledHostKind;
}): Promise<void> {
  if (input.context.maintenance?.auto !== true) {
    return;
  }
  try {
    const lastRunAt = await readInstalledHostMaintenanceMark(
      input.host,
      input.homeRoot,
    );
    const memory = createInstalledHostMemory(input.context, input.dependencies);
    const { sessionId: _sessionId, ...durableScope } = input.context.scope;
    const result = await memory.runMaintenance({
      jobs: [
        "dedupe",
        "contradiction",
        "qualityRepair",
        "ttlExpiry",
        ...(input.context.providers?.embedding ? ["embeddingRepair" as const] : []),
      ],
      ...(lastRunAt ? { lastRunAt } : {}),
      minHoursBetweenRuns: input.context.maintenance.minHoursBetweenRuns ?? 24,
      scope: durableScope,
    });
    if (result.ran) {
      await writeInstalledHostMaintenanceMark({
        homeRoot: input.homeRoot,
        host: input.host,
        lastRunAt: new Date().toISOString(),
      });
    }
  } catch {
    // Fail open.
  }
}

interface HookContextBuildResult {
  content: string;
  // Present on the fragment path only; the relevance gate reads it.
  recall?: RecallResult;
  recalledRecordIds: string[];
}

async function buildProgressiveHookContext(input: {
  context: InstalledHostResolvedContext;
  dependencies: InstalledHostHookDependencies;
  homeRoot?: string;
  host: InstalledHostKind;
  maxTokens: number;
  locale?: string;
  memory: GoodMemory;
  query: string;
}): Promise<HookContextBuildResult | null> {
  const mcpRegistered = await isInstalledHostMcpRegistered({
    homeRoot: input.homeRoot,
    host: input.host,
  });
  if (!mcpRegistered) {
    return null;
  }

  const service = await createInstalledHostProgressiveRecallService({
    context: input.context,
    dependencies: input.dependencies,
    homeRoot: input.homeRoot,
    memory: input.memory,
  });
  const index = await service.searchRecallIndex({
    includeRuntime: true,
    limit: MAX_PROGRESSIVE_HOOK_RECORDS,
    locale: input.locale,
    query: input.query,
    retrievalProfile: input.context.retrievalProfile,
    scope: input.context.scope,
  });
  if (index.records.length === 0) {
    return null;
  }

  const rendered = service.renderProgressiveContext({
    index,
    maxRecords: MAX_PROGRESSIVE_HOOK_RECORDS,
    maxTokens: input.maxTokens,
    query: input.query,
    retrievalProfile: input.context.retrievalProfile,
  });
  const content = normalizeText(rendered.content);
  if (!content) {
    return null;
  }

  const detail = await service.getProgressiveRecords({
    recordRefs: index.records.map((record) => record.recordRef),
    scope: input.context.scope,
  });
  await writeInstalledHostProgressiveRecordCache({
    homeRoot: input.homeRoot,
    host: input.host,
    records: detail.records,
    scopeDigest: index.scopeDigest,
  });

  return {
    content,
    recalledRecordIds: collectProgressiveRecordIds(
      index.records.map((record) => record.recordRef),
    ),
  };
}

async function buildFragmentHookContext(input: {
  context: InstalledHostResolvedContext;
  dependencies: InstalledHostHookDependencies;
  maxTokens: number;
  locale?: string;
  memory: GoodMemory;
  query: string;
}): Promise<HookContextBuildResult | null> {
  const recall = await input.memory.recall({
    locale: input.locale,
    scope: input.context.scope,
    query: input.query,
    retrievalProfile: input.context.retrievalProfile,
  });
  const builtContext = await input.memory.buildContext({
    recall,
    output: "developer_prompt_fragment",
    maxTokens: input.maxTokens,
    suppressDuplicateEvidence: true,
  });
  const fragment = normalizeText(builtContext.content);
  if (!fragment) {
    return null;
  }

  return {
    content: fragment,
    recall,
    recalledRecordIds: collectRecallRecordIds(recall),
  };
}

function buildHookSkipResult(input: {
  command: InstalledHostHookCommand;
  debug: boolean;
  host: InstalledHostKind;
  maxTokens?: number;
  query?: string | null;
  reason: InstalledHostHookExecutionResult["reason"];
  scope?: MemoryScope | null;
}): InstalledHostHookExecutionResult {
  return {
    applied: false,
    context: null,
    maxTokens: input.maxTokens,
    output: input.debug
      ? {
          systemMessage: `GoodMemory ${input.host} ${input.command} hook skipped: ${input.reason}.`,
        }
      : null,
    query: input.query ?? null,
    reason: input.reason,
    scope: input.scope ?? null,
    writeback: {
      attempted: false,
      candidateCount: 0,
      reason: "disabled",
      wrote: false,
    },
  };
}

function deriveHookQuery(
  command: InstalledHostHookCommand,
  payload: Record<string, unknown>,
  workspaceRoot?: string,
  language?: LanguageService,
): { locale?: string; query: string } | null {
  if (command === "pre-tool-use") {
    return null;
  }
  if (command === "user-prompt-submit") {
    const query = normalizeText(readOptionalText(payload, "prompt"));
    return query ? { query } : null;
  }

  if (command === "session-stop") {
    return null;
  }

  const service = language ?? createLanguageService();
  const locale = service.getAnalyzerManifest().defaultLocale;
  const context = service.resolveFromText({ locale, text: "" });
  const source = normalizeText(readOptionalText(payload, "source")) ?? "startup";
  const baseQuery = service.render(
    {
      key: source === "resume" ? "session_resume_query" : "session_start_query",
    },
    context,
  );
  // The workspace name is a discriminative lexical anchor (BM25 IDF) for
  // project-tagged facts; the generic brief question alone has almost no
  // overlap with stored content.
  const workspaceName = workspaceRoot ? basename(workspaceRoot) : "";
  const query = workspaceName
    ? `${baseQuery} ${service.render({
        key: "workspace_query_anchor",
        values: { workspace: workspaceName },
      }, context)}`
    : baseQuery;
  return { locale: context.locale, query };
}

function mapHookEventName(
  command: InstalledHostHookCommand,
): "PreToolUse" | "SessionStart" | "Stop" | "UserPromptSubmit" {
  if (command === "pre-tool-use") {
    return "PreToolUse";
  }
  if (command === "session-start") {
    return "SessionStart";
  }
  return command === "session-stop" ? "Stop" : "UserPromptSubmit";
}

function clampText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function collectRecallRecordIds(recall: RecallResult): string[] {
  const ids = new Set<string>();
  for (const record of [
    ...recall.preferences,
    ...recall.references,
    ...recall.facts,
    ...recall.feedback,
    ...recall.evidence,
    ...recall.episodes,
    ...recall.archives,
  ]) {
    ids.add(record.id);
  }
  for (const hit of recall.metadata.hits) {
    ids.add(hit.id);
    for (const evidenceId of hit.evidenceIds ?? []) {
      ids.add(evidenceId);
    }
  }
  for (const trace of recall.metadata.candidateTraces) {
    if (!trace.returned) {
      continue;
    }
    ids.add(trace.memoryId);
    for (const evidenceId of trace.evidenceIds ?? []) {
      ids.add(evidenceId);
    }
  }
  return [...ids];
}

function collectProgressiveRecordIds(recordRefs: string[]): string[] {
  const ids = new Set<string>();
  for (const recordRef of recordRefs) {
    const parsed = parseGoodMemoryRecordRef(recordRef);
    if (parsed) {
      ids.add(parsed.id);
    }
  }
  return [...ids];
}

function summarizeHookWriteback(
  result: InstalledHostWritebackResult,
): InstalledHostHookWritebackResult {
  if (result.reason === "disabled") {
    return {
      attempted: false,
      candidateCount: 0,
      mode: result.mode,
      reason: "disabled",
      wrote: false,
    };
  }
  if (result.reason === "empty_transcript") {
    return {
      attempted: false,
      candidateCount: 0,
      mode: result.mode,
      reason: "empty_content",
      wrote: false,
    };
  }
  if (result.reason === "write_failed" || result.reason === "audit_failed") {
    return {
      attempted: true,
      candidateCount: result.candidates.length,
      mode: result.mode,
      reason: "failed",
      wrote: result.wrote,
    };
  }

  return {
    attempted: result.applied,
    candidateCount: result.candidates.length,
    mode: result.mode,
    reason:
      result.reason === "written"
        ? "written"
        : result.reason === "observed"
          ? "observed"
          : result.reason === "no_candidates"
            ? "no_candidates"
            : "source_disabled",
    wrote: result.wrote,
  };
}
