import { createHmac } from "node:crypto";
import type {
  GoodMemory,
  RecallInput,
  RecallResult,
} from "../api/contracts";
import { readGoodMemoryIntegrationSupport } from "../api/integrationSupport";
import type { MemoryScope } from "../domain/scope";
import { scopeToKey } from "../domain/scope";
import type { TemporalInterval } from "../domain/temporal";
import type { LanguageRenderKey, LanguageService } from "../language";
import {
  estimateTextTokens,
  truncateTextToEstimatedTokens,
} from "../tokenEstimator";

const DEFAULT_INDEX_LIMIT = 24;
const DEFAULT_DETAIL_PREVIEW_CHARS = 1_200;
const MAX_VISIBLE_RECORDS_PER_SCOPE = 100;

export type ProgressiveRecordKind =
  | "profile"
  | "preference"
  | "fact"
  | "feedback"
  | "episode"
  | "evidence"
  | "experience"
  | "reference"
  | "archive"
  | "proposal"
  | "promotion"
  | "runtime-journal"
  | "runtime-spill"
  | "writeback-event";

export type GoodMemoryRecordRef =
  `gmrec:v1:${string}:${ProgressiveRecordKind}:${string}`;

export interface ParsedGoodMemoryRecordRef {
  id: string;
  recordKind: ProgressiveRecordKind;
  scopeDigest: string;
}

export interface EncodeGoodMemoryRecordRefInput {
  id: string;
  recordKind: ProgressiveRecordKind;
  scopeDigest: string;
}

export interface ProgressiveRecallMemory {
  recall(input: RecallInput): Promise<RecallResult>;
}

type ProgressiveLanguagePort = Pick<
  LanguageService,
  "render" | "resolveFromText" | "tokenize"
>;

export interface CreateProgressiveRecallServiceInput {
  language?: ProgressiveLanguagePort;
  memory: Pick<GoodMemory, "recall"> | ProgressiveRecallMemory;
  scopeDigestSecret: string;
  maxDetailPreviewChars?: number;
  now?: () => Date;
}

export interface SearchRecallIndexInput {
  scope: MemoryScope;
  query?: string;
  locale?: RecallInput["locale"];
  includeRuntime?: boolean;
  limit?: number;
  referenceTime?: RecallInput["referenceTime"];
  retrievalProfile?: RecallInput["retrievalProfile"];
  timezone?: RecallInput["timezone"];
}

export interface ProgressiveRecallIndexRecord {
  recordRef: GoodMemoryRecordRef;
  recordKind: ProgressiveRecordKind;
  title: string;
  summary: string;
  occurredAt?: string;
  occurrence?: TemporalInterval;
  score: number;
  estimatedDetailTokens: number;
  estimatedIndexTokens: number;
  source: "durable" | "runtime" | "writeback";
}

export interface ProgressiveRecallIndex {
  generatedAt: string;
  locale?: string;
  query?: string;
  records: ProgressiveRecallIndexRecord[];
  scopeDigest: string;
  totalRecordCount: number;
}

export interface BuildRecallTimelineInput extends SearchRecallIndexInput {
  recordsPerBucket?: number;
}

export interface ProgressiveRecallTimelineBucket {
  label: string;
  records: ProgressiveRecallIndexRecord[];
}

export interface ProgressiveRecallTimeline {
  buckets: ProgressiveRecallTimelineBucket[];
  locale?: string;
  scopeDigest: string;
  totalRecordCount: number;
}

export interface GetProgressiveRecordsInput {
  scope: MemoryScope;
  recordRefs: string[];
}

export interface ProgressiveRecordDetail {
  recordRef: GoodMemoryRecordRef;
  recordKind: ProgressiveRecordKind;
  title: string;
  summary: string;
  occurredAt?: string;
  detail: Record<string, unknown>;
  estimatedTokens: number;
}

export interface GetProgressiveRecordsResult {
  records: ProgressiveRecordDetail[];
  scopeDigest: string;
}

export interface RenderProgressiveContextInput {
  index: ProgressiveRecallIndex;
  query?: string;
  retrievalProfile?: RecallInput["retrievalProfile"];
  maxRecords?: number;
  maxTokens?: number;
}

export interface RenderProgressiveContextResult {
  content: string;
  estimatedTokens: number;
  omittedRecordCount: number;
}

export interface ProgressiveRecallService {
  searchRecallIndex(input: SearchRecallIndexInput): Promise<ProgressiveRecallIndex>;
  buildRecallTimeline(input: BuildRecallTimelineInput): Promise<ProgressiveRecallTimeline>;
  getProgressiveRecords(
    input: GetProgressiveRecordsInput,
  ): Promise<GetProgressiveRecordsResult>;
  renderProgressiveContext(
    input: RenderProgressiveContextInput,
  ): RenderProgressiveContextResult;
}

interface CandidateRecord {
  detail: Record<string, unknown>;
  id: string;
  occurrence?: TemporalInterval;
  occurredAt?: string;
  recordKind: ProgressiveRecordKind;
  required?: boolean;
  source: "durable" | "runtime" | "writeback";
  summary: string;
  title: string;
}

interface VisibleCandidateEntry {
  candidate: CandidateRecord;
  lastSeenAt: number;
}

const RECORD_KINDS = new Set<ProgressiveRecordKind>([
  "profile",
  "preference",
  "fact",
  "feedback",
  "episode",
  "evidence",
  "experience",
  "reference",
  "archive",
  "proposal",
  "promotion",
  "runtime-journal",
  "runtime-spill",
  "writeback-event",
]);

export function encodeGoodMemoryRecordRef(
  input: EncodeGoodMemoryRecordRefInput,
): GoodMemoryRecordRef {
  if (!RECORD_KINDS.has(input.recordKind)) {
    throw new Error(`Unsupported GoodMemory record kind: ${input.recordKind}`);
  }

  if (!input.scopeDigest || input.scopeDigest.includes(":")) {
    throw new Error("GoodMemory recordRef requires a non-empty colon-free scopeDigest.");
  }

  if (!input.id) {
    throw new Error("GoodMemory recordRef requires a non-empty id.");
  }

  return `gmrec:v1:${input.scopeDigest}:${input.recordKind}:${encodeURIComponent(
    input.id,
  )}` as GoodMemoryRecordRef;
}

export function parseGoodMemoryRecordRef(
  value: string,
): ParsedGoodMemoryRecordRef | null {
  const match = /^gmrec:v1:([^:]+):([^:]+):(.+)$/u.exec(value);
  if (!match) {
    return null;
  }

  const [, scopeDigest, recordKind, encodedId] = match;
  if (!RECORD_KINDS.has(recordKind as ProgressiveRecordKind)) {
    return null;
  }

  try {
    return {
      id: decodeURIComponent(encodedId),
      recordKind: recordKind as ProgressiveRecordKind,
      scopeDigest,
    };
  } catch {
    return null;
  }
}

export function buildProgressiveScopeDigest(input: {
  scope: MemoryScope;
  secret: string;
}): string {
  return `scope_${createHmac("sha256", input.secret)
    .update(scopeToKey(input.scope))
    .digest("hex")
    .slice(0, 32)}`;
}

export function createProgressiveRecallService(
  input: CreateProgressiveRecallServiceInput,
): ProgressiveRecallService {
  if (input.scopeDigestSecret.trim().length < 16) {
    throw new Error("ProgressiveRecallService requires a stable scopeDigestSecret.");
  }

  const maxDetailPreviewChars =
    input.maxDetailPreviewChars ?? DEFAULT_DETAIL_PREVIEW_CHARS;
  const now = input.now ?? (() => new Date());
  const language = input.language ?? readGoodMemoryIntegrationSupport(
    input.memory as GoodMemory,
  )?.language;
  if (!language) {
    throw new Error(
      "ProgressiveRecallService requires the memory LanguageService.",
    );
  }
  const activeLanguage: ProgressiveLanguagePort = language;
  const defaultLanguage = activeLanguage.resolveFromText({ text: "" });
  const visibleCandidatesByScopeDigest = new Map<
    string,
    Map<string, VisibleCandidateEntry>
  >();

  async function loadCandidates(options: {
    includeRuntime?: boolean;
    locale?: RecallInput["locale"];
    query?: string;
    referenceTime?: RecallInput["referenceTime"];
    retrievalProfile?: RecallInput["retrievalProfile"];
    scope: MemoryScope;
    timezone?: RecallInput["timezone"];
  }): Promise<{
    candidates: CandidateRecord[];
    generatedAt: string;
    locale: string;
    scopeDigest: string;
  }> {
    const retrievalProfile =
      options.retrievalProfile ??
      (options.includeRuntime === true ? "coding_agent" : undefined);
    const recall = await input.memory.recall({
      retrievalProfile,
      locale: options.locale,
      query: options.query ?? "",
      referenceTime: options.referenceTime,
      scope: options.scope,
      timezone: options.timezone,
    });
    const scopeDigest = buildProgressiveScopeDigest({
      scope: options.scope,
      secret: input.scopeDigestSecret,
    });
    const locale = recall.metadata.locale ?? options.locale ?? defaultLanguage.locale;

    return {
      candidates: collectCandidates({
        includeRuntime: options.includeRuntime,
        language: activeLanguage,
        locale,
        maxDetailPreviewChars,
        recall,
        scope: options.scope,
      }),
      generatedAt: now().toISOString(),
      locale,
      scopeDigest,
    };
  }

  function rememberVisibleCandidates(input: {
    includeRuntime?: boolean;
    scopeDigest: string;
    selected: Array<{
      candidate: CandidateRecord;
      record: ProgressiveRecallIndexRecord;
    }>;
  }): void {
    const current =
      visibleCandidatesByScopeDigest.get(input.scopeDigest) ??
      new Map<string, VisibleCandidateEntry>();
    if (input.includeRuntime !== true) {
      for (const [recordRef, entry] of current) {
        if (entry.candidate.source === "runtime") {
          current.delete(recordRef);
        }
      }
    }
    const lastSeenAt = now().getTime();
    for (const item of input.selected) {
      current.set(item.record.recordRef, {
        candidate: item.candidate,
        lastSeenAt,
      });
    }
    pruneVisibleCandidates(current);
    visibleCandidatesByScopeDigest.set(input.scopeDigest, current);
  }

  async function searchRecallIndex(
    options: SearchRecallIndexInput,
  ): Promise<ProgressiveRecallIndex> {
    const { candidates, generatedAt, locale, scopeDigest } = await loadCandidates({
      includeRuntime: options.includeRuntime,
      locale: options.locale,
      query: options.query,
      referenceTime: options.referenceTime,
      retrievalProfile: options.retrievalProfile,
      scope: options.scope,
      timezone: options.timezone,
    });
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        record: toIndexRecord({
          candidate,
          language: activeLanguage,
          locale,
          query: options.query,
          scopeDigest,
        }),
      }))
      .sort((left, right) => compareIndexRecords(left.record, right.record));
    const selected = selectIndexRecords({
      limit: options.limit ?? DEFAULT_INDEX_LIMIT,
      ranked,
    });
    rememberVisibleCandidates({
      includeRuntime: options.includeRuntime,
      scopeDigest,
      selected,
    });

    return {
      generatedAt,
      locale,
      query: options.query,
      records: selected.map((item) => item.record),
      scopeDigest,
      totalRecordCount: candidates.length,
    };
  }

  async function buildRecallTimeline(
    options: BuildRecallTimelineInput,
  ): Promise<ProgressiveRecallTimeline> {
    const index = await searchRecallIndex(options);
    const recordsPerBucket = options.recordsPerBucket ?? 6;
    const groups = new Map<string, ProgressiveRecallIndexRecord[]>();

    for (const record of index.records) {
      const candidate = visibleCandidatesByScopeDigest
        .get(index.scopeDigest)
        ?.get(record.recordRef)
        ?.candidate;
      const label = buildTimelineLabel(
        record.occurredAt,
        activeLanguage,
        index.locale ?? defaultLanguage.locale,
        candidate?.occurrence,
      );
      const bucket = groups.get(label) ?? [];
      if (bucket.length < recordsPerBucket) {
        bucket.push(record);
      }
      groups.set(label, bucket);
    }

    return {
      buckets: Array.from(groups, ([label, records]) => ({ label, records })),
      locale: index.locale,
      scopeDigest: index.scopeDigest,
      totalRecordCount: index.totalRecordCount,
    };
  }

  async function getProgressiveRecords(
    options: GetProgressiveRecordsInput,
  ): Promise<GetProgressiveRecordsResult> {
    const scopeDigest = buildProgressiveScopeDigest({
      scope: options.scope,
      secret: input.scopeDigestSecret,
    });
    const visibleCandidates =
      visibleCandidatesByScopeDigest.get(scopeDigest) ??
      new Map<string, VisibleCandidateEntry>();

    const records: ProgressiveRecordDetail[] = [];
    for (const recordRef of options.recordRefs) {
      const parsed = parseGoodMemoryRecordRef(recordRef);
      if (!parsed) {
        throw new Error(`Invalid GoodMemory recordRef: ${recordRef}`);
      }
      if (parsed.scopeDigest !== scopeDigest) {
        throw new Error(
          `GoodMemory recordRef ${recordRef} does not belong to the requested scope.`,
        );
      }

      const visible = visibleCandidates.get(recordRef);
      if (!visible) {
        throw new Error(
          `GoodMemory recordRef ${recordRef} is not available in the current progressive recall visibility set.`,
        );
      }
      const candidate = visible.candidate;

      const detail = {
        occurredAt: candidate.occurredAt,
        recordKind: candidate.recordKind,
        recordRef: recordRef as GoodMemoryRecordRef,
        title: candidate.title,
        summary: candidate.summary,
        detail: candidate.detail,
        estimatedTokens: estimateTextTokens(JSON.stringify(candidate.detail)),
      };
      records.push(detail);
    }

    return {
      records,
      scopeDigest,
    };
  }

  return {
    searchRecallIndex,
    buildRecallTimeline,
    getProgressiveRecords,
    renderProgressiveContext(
      options: RenderProgressiveContextInput,
    ): RenderProgressiveContextResult {
      const maxRecords = options.maxRecords ?? 10;
      const maxTokens = options.maxTokens
        ? Math.max(1, Math.floor(options.maxTokens))
        : undefined;
      const candidateRecords = options.index.records.slice(0, maxRecords);
      const locale = options.index.locale ?? defaultLanguage.locale;
      const header = buildProgressiveContextHeader(
        options,
        Boolean(maxTokens),
        activeLanguage,
        locale,
      );
      const lines: string[] = [];

      for (const record of candidateRecords) {
        const line = findBudgetedRecordLine({
          header,
          lines,
          maxTokens,
          record,
          recordIndex: lines.length,
          language: activeLanguage,
          locale,
        });
        if (!line) {
          break;
        }
        lines.push(line);
      }

      const omittedRecordCount = Math.max(0, options.index.records.length - lines.length);
      const footer =
        omittedRecordCount > 0 && !wouldExceedTokenBudget({
          header,
          lines,
          maxTokens,
          footer: [activeLanguage.render({
            key: "omitted_records",
            values: { count: omittedRecordCount },
          }, locale)],
        })
          ? [activeLanguage.render({
            key: "omitted_records",
            values: { count: omittedRecordCount },
          }, locale)]
          : [];
      const content = [...header, ...lines, ...footer].join("\n");
      const budgetedContent = enforceTokenBudget(content, maxTokens);

      return {
        content: budgetedContent,
        estimatedTokens: estimateTextTokens(budgetedContent),
        omittedRecordCount,
      };
    },
  };
}

function collectCandidates(input: {
  includeRuntime?: boolean;
  language: ProgressiveLanguagePort;
  locale: string;
  maxDetailPreviewChars: number;
  recall: RecallResult;
  scope: MemoryScope;
}): CandidateRecord[] {
  const records: CandidateRecord[] = [];
  const render = (
    key: LanguageRenderKey,
    values?: Record<string, number | string>,
  ): string => input.language.render(
    values ? { key, values } : { key },
    input.locale,
  );
  const add = (candidate: CandidateRecord): void => {
    records.push(redactCandidate(candidate, input.scope, input.maxDetailPreviewChars));
  };

  const profile = input.recall.profile;
  if (profile) {
    add({
      detail: {
        activeContext: profile.activeContext,
        expertise: profile.expertise,
        identity: redactScopeObject(profile.identity, input.scope),
        version: profile.version,
      },
      id: "profile",
      occurredAt: profile.updatedAt,
      recordKind: "profile",
      source: "durable",
      summary: [
        ...profile.activeContext.goals,
        ...profile.activeContext.currentProjects,
      ].join("; "),
      title: render("profile"),
    });
  }

  for (const preference of input.recall.preferences) {
    add({
      detail: {
        category: preference.category,
        confidence: preference.confidence,
        lifecycle: preference.lifecycle,
        tags: preference.tags,
        value: preference.value,
      },
      id: preference.id,
      occurredAt: preference.updatedAt,
      recordKind: "preference",
      source: "durable",
      summary: stringifyValue(preference.value),
      title: `${render("preference")}: ${preference.category}`,
    });
  }

  for (const fact of input.recall.facts) {
    add({
      detail: {
        category: fact.category,
        confidence: fact.confidence,
        content: fact.content,
        factKind: fact.factKind,
        importance: fact.importance,
        lifecycle: fact.lifecycle,
        occurrence: fact.occurrence,
        subject: fact.subject,
        tags: fact.tags,
      },
      id: fact.id,
      occurrence: fact.occurrence,
      occurredAt: fact.occurrence?.start ?? fact.updatedAt,
      recordKind: "fact",
      source: "durable",
      summary: fact.content,
      title: buildTitle(render("fact_item"), fact.subject ?? fact.category),
    });
  }

  for (const feedback of input.recall.feedback) {
    add({
      detail: {
        appliesTo: feedback.appliesTo,
        confidence: feedback.confidence,
        kind: feedback.kind,
        lifecycle: feedback.lifecycle,
        rule: feedback.rule,
        tags: feedback.tags,
        why: feedback.why,
      },
      id: feedback.id,
      occurredAt: feedback.updatedAt,
      recordKind: "feedback",
      source: "durable",
      summary: feedback.rule,
      title: `${render("feedback")}: ${feedback.kind}`,
    });
  }

  for (const reference of input.recall.references) {
    add({
      detail: {
        confidence: reference.confidence,
        description: reference.description,
        pointer: reference.pointer,
        referenceKind: reference.referenceKind,
        subject: reference.subject,
        tags: reference.tags,
        title: reference.title,
      },
      id: reference.id,
      occurredAt: reference.updatedAt,
      recordKind: "reference",
      source: "durable",
      summary: reference.description ?? reference.pointer,
      title: reference.title,
    });
  }

  for (const episode of input.recall.episodes) {
    add({
      detail: {
        confidence: episode.confidence,
        keyDecisions: episode.keyDecisions,
        summary: episode.summary,
        topics: episode.topics,
        unresolvedItems: episode.unresolvedItems,
      },
      id: episode.id,
      occurredAt: episode.archivedAt ?? episode.createdAt,
      recordKind: "episode",
      source: "durable",
      summary: episode.summary,
      title: render("episode_item"),
    });
  }

  for (const archive of input.recall.archives) {
    add({
      detail: {
        keyDecisions: archive.keyDecisions,
        referencedArtifacts: archive.referencedArtifacts,
        sourceSessionCount: archive.sourceSessionIds.length,
        summary: archive.summary,
        unresolvedItems: archive.unresolvedItems,
      },
      id: archive.id,
      occurredAt: archive.archivedAt,
      recordKind: "archive",
      source: "durable",
      summary: archive.summary,
      title: archive.summary,
    });
  }

  for (const evidence of input.recall.evidence) {
    add({
      detail: {
        excerpt: evidence.excerpt,
        kind: evidence.kind,
        linkedArchiveIds: evidence.linkedArchiveIds,
        linkedMemoryIds: evidence.linkedMemoryIds,
        sourceUri: evidence.sourceUri,
      },
      id: evidence.id,
      occurredAt: evidence.createdAt,
      recordKind: "evidence",
      source: "durable",
      summary: evidence.excerpt,
      title: `${render("evidence")}: ${evidence.kind}`,
    });
  }

  if (input.includeRuntime === true && input.recall.journal) {
    const journal = input.recall.journal;
    add({
      detail: {
        currentState: journal.currentState,
        errorsAndCorrections: journal.errorsAndCorrections,
        filesAndFunctions: journal.filesAndFunctions,
        keyResults: journal.keyResults,
        learnings: journal.learnings,
        taskSpecification: journal.taskSpecification,
        title: journal.title,
        workflow: journal.workflow,
        worklog: journal.worklog,
      },
      id: "current",
      occurredAt: journal.updatedAt,
      recordKind: "runtime-journal",
      source: "runtime",
      summary: journal.currentState ?? journal.title ?? journal.worklog[0] ?? render("journal"),
      title: journal.title ?? render("journal"),
    });
  }

  if (input.includeRuntime === true && input.recall.workingMemory) {
    const workingMemory = input.recall.workingMemory;
    add({
      detail: {
        constraints: workingMemory.constraints,
        currentGoal: workingMemory.currentGoal,
        openLoops: workingMemory.openLoops,
        state: workingMemory.state,
        temporaryDecisions: workingMemory.temporaryDecisions,
        toolState: workingMemory.toolState,
      },
      id: "working-memory",
      occurredAt: workingMemory.updatedAt,
      recordKind: "runtime-journal",
      required: true,
      source: "runtime",
      summary: [
        workingMemory.currentGoal
          ? `${render("current_goal")}: ${workingMemory.currentGoal}`
          : undefined,
        workingMemory.openLoops.length > 0
          ? `${render("open_loops")}: ${workingMemory.openLoops.join(", ")}`
          : undefined,
      ].filter(isPresent).join("; ") || render("working_memory"),
      title: render("working_memory"),
    });
  }

  return records;
}

function buildProgressiveContextHeader(
  options: RenderProgressiveContextInput,
  compact: boolean,
  language: ProgressiveLanguagePort,
  locale: string,
): string[] {
  if (compact) {
    return [
      language.render({ key: "progressive_recall" }, locale),
      `scopeDigest: ${options.index.scopeDigest}`,
      language.render({ key: "progressive_detail_instruction_compact" }, locale),
    ];
  }

  return [
    language.render({ key: "progressive_recall" }, locale),
    `query: ${options.query ?? options.index.query ?? language.render({ key: "none" }, locale)}`,
    `scopeDigest: ${options.index.scopeDigest}`,
    `retrievalProfile: ${options.retrievalProfile ?? language.render({ key: "default_label" }, locale)}`,
    language.render({ key: "progressive_detail_instruction" }, locale),
  ];
}

function selectIndexRecords(input: {
  limit: number;
  ranked: Array<{
    candidate: CandidateRecord;
    record: ProgressiveRecallIndexRecord;
  }>;
}): Array<{
  candidate: CandidateRecord;
  record: ProgressiveRecallIndexRecord;
}> {
  const limit = Math.max(1, Math.floor(input.limit));
  const selected = new Map<string, {
    candidate: CandidateRecord;
    record: ProgressiveRecallIndexRecord;
  }>();

  for (const item of input.ranked) {
    if (item.candidate.required) {
      selected.set(item.record.recordRef, item);
    }
  }

  for (const item of input.ranked) {
    if (selected.size >= limit) {
      break;
    }
    selected.set(item.record.recordRef, item);
  }

  return Array.from(selected.values()).slice(0, limit);
}

function findBudgetedRecordLine(input: {
  header: string[];
  language: ProgressiveLanguagePort;
  lines: string[];
  locale: string;
  maxTokens?: number;
  record: ProgressiveRecallIndexRecord;
  recordIndex: number;
}): string | null {
  const summaryBudgets = input.maxTokens
    ? [160, 96, 48, 0]
    : [260];
  for (const summaryMaxChars of summaryBudgets) {
    const line = renderProgressiveRecordLine({
      record: input.record,
      recordIndex: input.recordIndex,
      summaryMaxChars,
      language: input.language,
      locale: input.locale,
    });
    if (
      !wouldExceedTokenBudget({
        header: input.header,
        lines: [...input.lines, line],
        maxTokens: input.maxTokens,
      })
    ) {
      return line;
    }
  }

  return null;
}

function renderProgressiveRecordLine(input: {
  language: ProgressiveLanguagePort;
  locale: string;
  record: ProgressiveRecallIndexRecord;
  recordIndex: number;
  summaryMaxChars: number;
}): string {
  const parts = [
    `${input.recordIndex + 1}. ${input.record.title}`,
    `${input.language.render({ key: "record_kind" }, input.locale)}: ${input.record.recordKind}`,
    `${input.language.render({ key: "record_ref" }, input.locale)}: ${input.record.recordRef}`,
  ];
  if (input.record.occurrence) {
    parts.push(formatProgressiveOccurrence(input.record.occurrence));
  }
  if (input.summaryMaxChars > 0) {
    parts.push(
      `${input.language.render({ key: "summary" }, input.locale)}: ${clipText(input.record.summary, input.summaryMaxChars)}`,
    );
  }
  parts.push(
    `${input.language.render({ key: "detail_tokens" }, input.locale)}: ${input.record.estimatedDetailTokens}`,
  );
  return parts.join(" | ");
}

function wouldExceedTokenBudget(input: {
  footer?: string[];
  header: string[];
  lines: string[];
  maxTokens?: number;
}): boolean {
  if (!input.maxTokens) {
    return false;
  }

  return estimateTextTokens([
    ...input.header,
    ...input.lines,
    ...(input.footer ?? []),
  ].join("\n")) > input.maxTokens;
}

function enforceTokenBudget(content: string, maxTokens: number | undefined): string {
  if (!maxTokens || estimateTextTokens(content) <= maxTokens) {
    return content;
  }

  const ellipsis = "...";
  const ellipsisTokens = estimateTextTokens(ellipsis);
  if (maxTokens <= ellipsisTokens) {
    return truncateTextToEstimatedTokens(content, maxTokens);
  }
  const truncated = truncateTextToEstimatedTokens(
    content,
    maxTokens - ellipsisTokens,
  ).trimEnd();
  return `${truncated}${ellipsis}`;
}

function toIndexRecord(input: {
  candidate: CandidateRecord;
  language: ProgressiveLanguagePort;
  locale: string;
  query?: string;
  scopeDigest: string;
}): ProgressiveRecallIndexRecord {
  const summary = clipText(input.candidate.summary, 260);
  const title = clipText(input.candidate.title, 120);
  const recordRef = encodeGoodMemoryRecordRef({
    id: input.candidate.id,
    recordKind: input.candidate.recordKind,
    scopeDigest: input.scopeDigest,
  });
  const indexText = [title, summary].join(" ");

  return {
    estimatedDetailTokens: estimateTextTokens(
      JSON.stringify(input.candidate.detail),
    ),
    estimatedIndexTokens: estimateTextTokens(indexText),
    occurredAt: input.candidate.occurredAt,
    occurrence: input.candidate.occurrence,
    recordKind: input.candidate.recordKind,
    recordRef,
    score: scoreText(indexText, input.query, input.language, input.locale),
    source: input.candidate.source,
    summary,
    title,
  };
}

function formatProgressiveOccurrence(occurrence: TemporalInterval): string {
  if (occurrence.precision === "instant") {
    return `[${occurrence.start}, ${occurrence.timezone}]`;
  }
  const start = formatOccurrenceDate(occurrence.start, occurrence.timezone);
  if (occurrence.precision === "day") {
    return `[${start}, ${occurrence.timezone}]`;
  }
  const endExclusive = formatOccurrenceDate(
    occurrence.endExclusive,
    occurrence.timezone,
  );
  return `[${start} to ${endExclusive}, ${occurrence.precision}, ${occurrence.timezone}]`;
}

function formatOccurrenceDate(value: string, timezone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      day: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(new Date(value))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]),
  );
  return `${parts.get("year")!}-${parts.get("month")!}-${parts.get("day")!}`;
}

function compareIndexRecords(
  left: ProgressiveRecallIndexRecord,
  right: ProgressiveRecallIndexRecord,
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return dateValue(right.occurredAt) - dateValue(left.occurredAt);
}

function pruneVisibleCandidates(
  current: Map<string, VisibleCandidateEntry>,
): void {
  if (current.size <= MAX_VISIBLE_RECORDS_PER_SCOPE) {
    return;
  }

  const keep = new Set(
    Array.from(current)
      .sort((left, right) => right[1].lastSeenAt - left[1].lastSeenAt)
      .slice(0, MAX_VISIBLE_RECORDS_PER_SCOPE)
      .map(([recordRef]) => recordRef),
  );
  for (const recordRef of current.keys()) {
    if (!keep.has(recordRef)) {
      current.delete(recordRef);
    }
  }
}

function redactCandidate(
  candidate: CandidateRecord,
  scope: MemoryScope,
  maxDetailPreviewChars: number,
): CandidateRecord {
  return {
    ...candidate,
    detail: truncateDetail(redactScopeObject(candidate.detail, scope), maxDetailPreviewChars),
    summary: redactScopeText(candidate.summary, scope),
    title: redactScopeText(candidate.title, scope),
  };
}

function redactScopeObject(
  value: unknown,
  scope: MemoryScope,
): Record<string, unknown> {
  return sanitizeObject(value, scope) as Record<string, unknown>;
}

function sanitizeObject(value: unknown, scope: MemoryScope): unknown {
  if (typeof value === "string") {
    return redactScopeText(value, scope);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item, scope));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isRawScopeField(key) || key === "normalizedTranscript") {
        continue;
      }
      result[key] = sanitizeObject(nested, scope);
    }
    return result;
  }

  return value;
}

function truncateDetail(
  detail: Record<string, unknown>,
  maxDetailPreviewChars: number,
): Record<string, unknown> {
  const serialized = JSON.stringify(detail);
  if (serialized.length <= maxDetailPreviewChars) {
    return detail;
  }

  return {
    preview: `${serialized.slice(0, maxDetailPreviewChars)}...`,
    truncated: true,
  };
}

function isRawScopeField(key: string): boolean {
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

function redactScopeText(value: string, scope: MemoryScope): string {
  const replacements: Array<[string | undefined, string]> = [
    [scope.userId, "[user]"],
    [scope.tenantId, "[tenant]"],
    [scope.workspaceId, "[workspace]"],
    [scope.agentId, "[agent]"],
    [scope.sessionId, "[session]"],
  ];
  let result = value;
  for (const [raw, replacement] of replacements) {
    if (!raw) {
      continue;
    }
    result = result.split(raw).join(replacement);
  }
  return result;
}

function buildTitle(prefix: string, value: string): string {
  return `${prefix}: ${value}`;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function clipText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function scoreText(
  text: string,
  query: string | undefined,
  language: ProgressiveLanguagePort,
  locale: string,
): number {
  const queryTokens = language.tokenize(query ?? "", locale, {
    excludeStopwords: true,
  });
  if (queryTokens.length === 0) {
    return 0;
  }

  const textTokens = new Set(language.tokenize(text, locale, {
    excludeStopwords: true,
  }));
  return queryTokens.reduce(
    (score, token) => score + (textTokens.has(token) ? 1 : 0),
    0,
  );
}

function dateValue(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function buildTimelineLabel(
  value: string | undefined,
  language: ProgressiveLanguagePort,
  locale: string,
  occurrence?: TemporalInterval,
): string {
  if (!value) {
    return language.render({ key: "undated" }, locale);
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return language.render({ key: "undated" }, locale);
  }

  if (occurrence) {
    const values = new Map(
      new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
        minute: "2-digit",
        month: "2-digit",
        second: "2-digit",
        timeZone: occurrence.timezone,
        year: "numeric",
      }).formatToParts(new Date(timestamp))
        .filter(({ type }) => type !== "literal")
        .map(({ type, value: part }) => [type, part]),
    );
    const year = values.get("year")!;
    const month = values.get("month")!;
    const day = values.get("day")!;
    if (occurrence.precision === "year") {
      return year;
    }
    if (occurrence.precision === "quarter") {
      return `${year}-Q${Math.floor((Number(month) - 1) / 3) + 1}`;
    }
    if (occurrence.precision === "month") {
      return `${year}-${month}`;
    }
    const date = `${year}-${month}-${day}`;
    return occurrence.precision === "instant"
      ? `${date}T${values.get("hour")!}:${values.get("minute")!}:${
        values.get("second")!
      }`
      : date;
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}
