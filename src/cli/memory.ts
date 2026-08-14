import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ExportMemoryResult, RecallResult } from "../api/contracts";
import type { MemoryScope } from "../domain/scope";
import type { RecallCandidateTrace } from "../recall/engine";
import type { RecallRetrievalTrace } from "../recall/retrievalTrace";
import type { RecallRouterStrategy } from "../recall/router";
import type { MemoryExtractionStrategy } from "../remember/candidates";
import type {
  CLICommandOutput,
  CLIResult,
  CLIStorageConfig,
  ParsedFlags,
} from "./contracts";
import {
  clipText,
  compareStrings,
  createDiagnosticMemory,
  createIgnoredDiagnosticMemory,
  flagEnabled,
  formatScope,
  pathExists,
  renderOutput,
  requireFlag,
  resolveScopeFromFlags,
  resolveWriteExecutionContext,
  shouldIncludeRuntime,
} from "./shared";

const TOP_RECORD_LIMIT = 3;
const TRACE_SUPPRESSED_LIMIT = 8;
function countActiveRecords<TRecord extends { lifecycle?: string }>(
  records: TRecord[],
): number {
  return records.filter(isCurrentInspectRecord).length;
}

function isCurrentInspectRecord<TRecord extends { lifecycle?: string }>(
  record: TRecord,
): boolean {
  return record.lifecycle !== "superseded";
}

function buildProfileSummary(
  result: ExportMemoryResult,
): Record<string, unknown> | null {
  if (!result.durable.profile) {
    return null;
  }

  return {
    currentProjects: result.durable.profile.activeContext.currentProjects,
    goals: result.durable.profile.activeContext.goals,
    languagePreference:
      result.durable.profile.identity.languagePreference ?? null,
    location: result.durable.profile.identity.location ?? null,
    name: result.durable.profile.identity.name ?? null,
    organization: result.durable.profile.identity.organization ?? null,
    role: result.durable.profile.identity.role ?? null,
    timezone: result.durable.profile.identity.timezone ?? null,
  };
}

function sortByTimestamp<TRecord>(
  records: TRecord[],
  selector: (record: TRecord) => string,
): TRecord[] {
  return [...records].sort((left, right) => {
    const updated = selector(right).localeCompare(selector(left));
    if (updated !== 0) {
      return updated;
    }

    return compareStrings(JSON.stringify(left), JSON.stringify(right));
  });
}

function selectCurrentTopTimestampedRecords<TRecord extends { lifecycle?: string }>(
  records: TRecord[],
  selector: (record: TRecord) => string,
): TRecord[] {
  return sortByTimestamp(
    records.filter(isCurrentInspectRecord),
    selector,
  ).slice(0, TOP_RECORD_LIMIT);
}

function buildInspectPayload(input: {
  result: ExportMemoryResult;
  storage: CLIStorageConfig;
}): Record<string, unknown> {
  const { result, storage } = input;
  const facts = selectCurrentTopTimestampedRecords(
    result.durable.facts,
    (record) => record.updatedAt,
  );
  const references = selectCurrentTopTimestampedRecords(
    result.durable.references,
    (record) => record.updatedAt,
  );
  const feedback = selectCurrentTopTimestampedRecords(
    result.durable.feedback,
    (record) => record.updatedAt,
  );
  const proposals = sortByTimestamp(
    result.durable.proposals,
    (record) => record.updatedAt,
  ).slice(0, TOP_RECORD_LIMIT);
  const promotions = sortByTimestamp(
    result.durable.promotions,
    (record) => record.decidedAt,
  ).slice(0, TOP_RECORD_LIMIT);

  return {
    counts: {
      archives: result.durable.archives.length,
      episodes: result.durable.episodes.length,
      evidence: result.durable.evidence.length,
      experiences: result.durable.experiences.length,
      facts: result.durable.facts.length,
      feedback: result.durable.feedback.length,
      preferences: result.durable.preferences.length,
      profile: result.durable.profile ? 1 : 0,
      promotions: result.durable.promotions.length,
      proposals: result.durable.proposals.length,
      references: result.durable.references.length,
      runtimeSpills: result.runtime?.spills.length ?? 0,
    },
    profile: buildProfileSummary(result),
    runtime: result.runtime
      ? {
          journal: result.runtime.journal ? 1 : 0,
          spills: result.runtime.spills.length,
          workingMemory: result.runtime.workingMemory ? 1 : 0,
        }
      : null,
    scope: result.scope,
    storage: {
      location: storage.displayValue,
      provider: storage.provider,
    },
    topRecords: {
      facts: facts.map((record) => ({
        content: record.content,
        lifecycle: record.lifecycle,
        occurrence: record.occurrence ?? null,
        subject: record.subject ?? null,
      })),
      feedback: feedback.map((record) => ({
        kind: record.kind,
        lifecycle: record.lifecycle,
        rule: record.rule,
      })),
      promotions: promotions.map((record) => ({
        decision: record.decision,
        proposalId: record.proposalId,
        summary: record.summary,
      })),
      proposals: proposals.map((record) => ({
        status: record.status,
        summary: record.summary,
        type: record.proposalType,
      })),
      references: references.map((record) => ({
        lifecycle: record.lifecycle,
        pointer: record.pointer,
        title: record.title,
      })),
    },
  };
}

function renderInspectPayload(payload: Record<string, unknown>): string {
  const counts = payload.counts as Record<string, unknown>;
  const storage = payload.storage as Record<string, unknown>;
  const runtime = payload.runtime as Record<string, unknown> | null;
  const profile = payload.profile as Record<string, unknown> | null;
  const topRecords = payload.topRecords as Record<string, unknown>;
  const facts = topRecords.facts as Array<Record<string, unknown>>;
  const references = topRecords.references as Array<Record<string, unknown>>;
  const feedback = topRecords.feedback as Array<Record<string, unknown>>;
  const proposals = topRecords.proposals as Array<Record<string, unknown>>;
  const promotions = topRecords.promotions as Array<Record<string, unknown>>;

  return [
    `Scope: ${formatScope(payload.scope as unknown as MemoryScope)}`,
    `Storage: ${storage.provider} (${storage.location})`,
    `Profile: ${profile ? "present" : "absent"}`,
    `Preferences: ${counts.preferences}`,
    `References: ${counts.references}`,
    `Facts: ${counts.facts}`,
    `Feedback: ${counts.feedback}`,
    `Archives: ${counts.archives}`,
    `Evidence: ${counts.evidence}`,
    `Episodes: ${counts.episodes}`,
    `Experiences: ${counts.experiences}`,
    `Proposals: ${counts.proposals}`,
    `Promotions: ${counts.promotions}`,
    `Runtime: ${
      runtime
        ? `workingMemory=${runtime.workingMemory}, journal=${runtime.journal}, spills=${runtime.spills}`
        : "not requested"
    }`,
    ...(profile
      ? [
          "",
          "Profile Summary",
          `- name: ${profile.name ?? "unknown"}`,
          `- role: ${profile.role ?? "unknown"}`,
          `- location: ${profile.location ?? "unknown"}`,
          `- current projects: ${
            ((profile.currentProjects as string[]) ?? []).join(", ") || "none"
          }`,
        ]
      : []),
    "",
    "Top Facts",
    ...(facts.length > 0
      ? facts.map(
          (record) =>
            `- ${record.content}${
              record.subject
                ? ` [subject=${record.subject}]`
                : ""
            }${
              record.occurrence &&
                typeof record.occurrence === "object" &&
                "start" in record.occurrence &&
                "endExclusive" in record.occurrence &&
                "timezone" in record.occurrence
                ? ` [occurrence=${String(record.occurrence.start)}..${String(record.occurrence.endExclusive)}, ${String(record.occurrence.timezone)}]`
                : ""
            }`,
        )
      : ["- none"]),
    "",
    "Top References",
    ...(references.length > 0
      ? references.map(
          (record) =>
            `- ${record.title} -> ${record.pointer}`,
        )
      : ["- none"]),
    "",
    "Top Feedback",
    ...(feedback.length > 0
      ? feedback.map(
          (record) =>
            `- ${record.kind}: ${record.rule}`,
        )
      : ["- none"]),
    "",
    "Top Proposals",
    ...(proposals.length > 0
      ? proposals.map(
          (record) =>
            `- ${record.type} / ${record.status}: ${clipText(String(record.summary))}`,
        )
      : ["- none"]),
    "",
    "Top Promotions",
    ...(promotions.length > 0
      ? promotions.map(
          (record) =>
            `- ${record.proposalId} -> ${record.decision}: ${clipText(String(record.summary))}`,
        )
      : ["- none"]),
  ].join("\n");
}

function buildStatsPayload(input: {
  result: ExportMemoryResult;
  storage: CLIStorageConfig;
}): Record<string, unknown> {
  const { result, storage } = input;

  return {
    counts: {
      archives: result.durable.archives.length,
      episodes: result.durable.episodes.length,
      evidence: result.durable.evidence.length,
      experiences: result.durable.experiences.length,
      facts: result.durable.facts.length,
      factsActive: countActiveRecords(result.durable.facts),
      feedback: result.durable.feedback.length,
      feedbackActive: countActiveRecords(result.durable.feedback),
      preferences: result.durable.preferences.length,
      profile: result.durable.profile ? 1 : 0,
      promotions: result.durable.promotions.length,
      proposals: result.durable.proposals.length,
      references: result.durable.references.length,
      referencesActive: countActiveRecords(result.durable.references),
    },
    runtime: result.runtime
      ? {
          journal: result.runtime.journal ? 1 : 0,
          spills: result.runtime.spills.length,
          workingMemory: result.runtime.workingMemory ? 1 : 0,
        }
      : null,
    scope: result.scope,
    storage: {
      location: storage.displayValue,
      provider: storage.provider,
    },
  };
}

function renderStatsPayload(payload: Record<string, unknown>): string {
  const counts = payload.counts as Record<string, unknown>;
  const storage = payload.storage as Record<string, unknown>;
  const runtime = payload.runtime as Record<string, unknown> | null;

  return [
    `Scope: ${formatScope(payload.scope as unknown as MemoryScope)}`,
    `Storage Provider: ${storage.provider}`,
    `Storage Location: ${storage.location}`,
    `Profile Records: ${counts.profile}`,
    `Preferences: ${counts.preferences}`,
    `References: ${counts.references} (active=${counts.referencesActive})`,
    `Facts: ${counts.facts} (active=${counts.factsActive})`,
    `Feedback: ${counts.feedback} (active=${counts.feedbackActive})`,
    `Episodes: ${counts.episodes}`,
    `Archives: ${counts.archives}`,
    `Evidence: ${counts.evidence}`,
    `Experiences: ${counts.experiences}`,
    `Proposals: ${counts.proposals}`,
    `Promotions: ${counts.promotions}`,
    `Runtime: ${
      runtime
        ? `workingMemory=${runtime.workingMemory}, journal=${runtime.journal}, spills=${runtime.spills}`
        : "not requested"
    }`,
  ].join("\n");
}

function parseRetrievalProfile(flags: ParsedFlags): "coding_agent" | "general_chat" {
  const profile = flags["retrieval-profile"] ?? "general_chat";
  if (profile === "coding_agent" || profile === "general_chat") {
    return profile;
  }

  throw new Error(
    `Unsupported retrieval profile: ${profile}. Expected general_chat|coding_agent.`,
  );
}

function parseRememberRole(flags: ParsedFlags): "assistant" | "user" {
  const role = flags.role ?? "user";
  if (role === "assistant" || role === "user") {
    return role;
  }

  throw new Error(
    `Unsupported remember role: ${role}. Expected user|assistant.`,
  );
}

function parseExtractionStrategy(flags: ParsedFlags): MemoryExtractionStrategy {
  const strategy = flags["extraction-strategy"] ?? "auto";
  if (
    strategy === "auto" ||
    strategy === "llm-assisted" ||
    strategy === "rules-only"
  ) {
    return strategy;
  }

  throw new Error(
    `Unsupported extraction strategy: ${strategy}. Expected auto|rules-only|llm-assisted.`,
  );
}

function parseRecallStrategy(flags: ParsedFlags): RecallRouterStrategy {
  const strategy = flags.strategy ?? "auto";
  if (
    strategy === "auto" ||
    strategy === "rules-only" ||
    strategy === "hybrid" ||
    strategy === "llm-assisted"
  ) {
    return strategy;
  }

  throw new Error(
    `Unsupported recall strategy: ${strategy}. Expected auto|rules-only|hybrid|llm-assisted.`,
  );
}

function buildTracePayload(input: {
  query: string;
  recall: RecallResult;
  scope: MemoryScope;
  storage: CLIStorageConfig;
}): Record<string, unknown> {
  return {
    candidateTraceCount: input.recall.metadata.candidateTraces.length,
    candidateTraces: input.recall.metadata.candidateTraces,
    hits: input.recall.metadata.hits,
    policyApplied: input.recall.metadata.policyApplied,
    query: input.query,
    retrievalTrace: input.recall.metadata.retrievalTrace ?? null,
    routingDecision: input.recall.metadata.routingDecision,
    scope: input.scope,
    storage: {
      location: input.storage.displayValue,
      provider: input.storage.provider,
    },
    verificationHints: input.recall.metadata.verificationHints,
  };
}

function formatCandidateTrace(trace: RecallCandidateTrace): string {
  const outcome = trace.returned
    ? trace.whyReturned ?? "returned"
    : trace.whySuppressed ?? "suppressed";

  return `- ${trace.memoryType}:${trace.memoryId} slot=${trace.slot} ${
    trace.returned ? "returned" : "suppressed"
  } ${clipText(outcome, 160)}`;
}

function renderTracePayload(payload: Record<string, unknown>): string {
  const routingDecision =
    payload.routingDecision as RecallResult["metadata"]["routingDecision"];
  const warningMessages =
    routingDecision.strategyExplanation.warningMessages ?? [];
  const hits = payload.hits as RecallResult["metadata"]["hits"];
  const candidateTraces =
    payload.candidateTraces as unknown as RecallCandidateTrace[];
  const verificationHints =
    payload.verificationHints as RecallResult["metadata"]["verificationHints"];
  const returned = candidateTraces.filter((trace) => trace.returned);
  const suppressed = candidateTraces
    .filter((trace) => !trace.returned)
    .slice(0, TRACE_SUPPRESSED_LIMIT);
  const policyApplied = payload.policyApplied as string[];
  const storage = payload.storage as Record<string, unknown>;
  const retrievalTrace = payload.retrievalTrace as RecallRetrievalTrace | null;
  const temporalConstraints = retrievalTrace?.schemaVersion === 2
    ? retrievalTrace.plan.temporalConstraints
    : [];

  return [
    `Scope: ${formatScope(payload.scope as unknown as MemoryScope)}`,
    `Storage: ${storage.provider} (${storage.location})`,
    `Query: ${payload.query}`,
    "",
    "Routing Decision",
    `- requested strategy: ${routingDecision.strategyExplanation.requestedStrategy}`,
    `- resolved strategy: ${routingDecision.strategyExplanation.resolvedStrategy}`,
    `- retrieval profile: ${routingDecision.retrievalProfile}`,
    `- intent: ${routingDecision.intent}`,
    `- explanation: ${routingDecision.strategyExplanation.summary}`,
    ...(warningMessages.length > 0
      ? warningMessages.map((message) => `- warning: ${message}`)
      : []),
    "",
    "Temporal Constraints",
    ...(temporalConstraints.length > 0
      ? temporalConstraints.map((constraint) => `- ${JSON.stringify(constraint)}`)
      : ["- none"]),
    "",
    "Hits",
    ...(hits.length > 0
      ? hits.map(
          (hit) =>
            `- ${hit.type}: ${hit.reason ?? "no_reason"}${
              hit.evidenceIds?.length ? ` [evidence=${hit.evidenceIds.join(",")}]` : ""
            }`,
        )
      : ["- none"]),
    "",
    "Returned Candidate Traces",
    ...(returned.length > 0 ? returned.map(formatCandidateTrace) : ["- none"]),
    "",
    "Suppressed Candidate Traces",
    ...(suppressed.length > 0
      ? suppressed.map(formatCandidateTrace)
      : ["- none"]),
    "",
    "Verification Hints",
    ...(verificationHints.length > 0
      ? verificationHints.map(
          (hint) =>
            `- ${hint.memoryType}:${hint.memoryId} ${clipText(hint.reason, 160)}${
              hint.evidenceIds?.length ? ` [evidence=${hint.evidenceIds.join(",")}]` : ""
            }`,
        )
      : ["- none"]),
    "",
    "Policy Applied",
    ...(policyApplied.length > 0 ? policyApplied.map((item) => `- ${item}`) : ["- none"]),
  ].join("\n");
}

async function writeExportMemoryOutput(input: {
  force: boolean;
  outputPath: string;
  result: ExportMemoryResult;
}): Promise<void> {
  if ((await pathExists(input.outputPath)) && !input.force) {
    throw new Error(
      `Output path already exists: ${input.outputPath}. Pass --force to overwrite.`,
    );
  }

  if (input.force) {
    await rm(input.outputPath, { force: true, recursive: true });
  }

  await mkdir(input.outputPath, { recursive: true });
  await writeFile(
    join(input.outputPath, "memory-export.json"),
    `${JSON.stringify(input.result, null, 2)}\n`,
    "utf8",
  );

  for (const file of input.result.artifacts.files) {
    const destination = join(
      input.outputPath,
      input.result.artifacts.rootPath,
      file.relativePath,
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, "utf8");
  }
}

function renderRememberPayload(payload: {
  accepted: number;
  rejected: number;
  scope: MemoryScope;
  storage: {
    location: string;
    provider: CLIStorageConfig["provider"];
  };
}): string {
  return [
    `Remembered durable memory for ${formatScope(payload.scope)}`,
    `- storage: ${payload.storage.provider} (${payload.storage.location})`,
    `- accepted: ${payload.accepted}`,
    `- rejected: ${payload.rejected}`,
  ].join("\n");
}

function renderFeedbackPayload(payload: {
  accepted: boolean;
  kind?: string;
  memoryId?: string;
  outcome?: string;
  promotionReceiptCount: number;
  proposalReceiptCount: number;
  scope: MemoryScope;
  storage: {
    location: string;
    provider: CLIStorageConfig["provider"];
  };
}): string {
  return [
    `Stored feedback for ${formatScope(payload.scope)}`,
    `- storage: ${payload.storage.provider} (${payload.storage.location})`,
    `- accepted: ${payload.accepted}`,
    `- outcome: ${payload.outcome ?? "unknown"}`,
    `- kind: ${payload.kind ?? "unknown"}`,
    ...(payload.memoryId ? [`- memoryId: ${payload.memoryId}`] : []),
    `- proposal receipts: ${payload.proposalReceiptCount}`,
    `- promotion receipts: ${payload.promotionReceiptCount}`,
  ].join("\n");
}

function renderForgetPayload(payload: {
  forgotten: boolean;
  memoryId: string;
  scope: MemoryScope;
  storage: {
    location: string;
    provider: CLIStorageConfig["provider"];
  };
}): string {
  return [
    payload.forgotten
      ? `Forgot memory ${payload.memoryId} for ${formatScope(payload.scope)}`
      : `No memory forgotten for ${formatScope(payload.scope)}`,
    `- storage: ${payload.storage.provider} (${payload.storage.location})`,
  ].join("\n");
}

function renderForgetAllPayload(payload: {
  deleted: Record<string, number>;
  includeRuntime: boolean;
  scope: MemoryScope;
  storage: {
    location: string;
    provider: CLIStorageConfig["provider"];
  };
}): string {
  return [
    `Forgot scoped memory for ${formatScope(payload.scope)}`,
    `- storage: ${payload.storage.provider} (${payload.storage.location})`,
    `- includeRuntime: ${payload.includeRuntime}`,
    `- deleted: ${Object.entries(payload.deleted)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ") || "none"}`,
  ].join("\n");
}

async function handleInspect(flags: ParsedFlags): Promise<CLICommandOutput> {
  const scope = resolveScopeFromFlags(flags);
  const includeRuntime = shouldIncludeRuntime(flags, scope);
  const { memory, storage } = await createDiagnosticMemory(flags, {
    includeVectorStore: false,
    readOnlyStorage: true,
  });
  const result = await memory.exportMemory({
    includeRuntime,
    scope,
  });
  const payload = buildInspectPayload({
    result,
    storage,
  });

  return {
    json: payload,
    text: renderInspectPayload(payload),
  };
}

async function handleStats(flags: ParsedFlags): Promise<CLICommandOutput> {
  const scope = resolveScopeFromFlags(flags);
  const includeRuntime = shouldIncludeRuntime(flags, scope);
  const { memory, storage } = await createDiagnosticMemory(flags, {
    includeVectorStore: false,
    readOnlyStorage: true,
  });
  const result = await memory.exportMemory({
    includeRuntime,
    scope,
  });
  const payload = buildStatsPayload({
    result,
    storage,
  });

  return {
    json: payload,
    text: renderStatsPayload(payload),
  };
}

async function handleTrace(flags: ParsedFlags): Promise<CLICommandOutput> {
  const scope = resolveScopeFromFlags(flags);
  const query = requireFlag(flags, "query");
  const retrievalProfile = parseRetrievalProfile(flags);
  const strategy = parseRecallStrategy(flags);
  const ignoreMemory = flagEnabled(flags, "ignore-memory");
  const { memory, storage } = ignoreMemory
    ? createIgnoredDiagnosticMemory()
    : await createDiagnosticMemory(flags, {
        readOnlyStorage: true,
      });
  const recall = await memory.diagnoseRecall({
    ignoreMemory,
    locale: flags.locale,
    query,
    referenceTime: flags["reference-time"],
    retrievalProfile,
    scope,
    strategy,
    timezone: flags.timezone,
  });
  const payload = buildTracePayload({
    query,
    recall,
    scope,
    storage,
  });

  return {
    json: payload,
    text: renderTracePayload(payload),
  };
}

async function handleExportMemory(
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const scope = resolveScopeFromFlags(flags);
  const includeRuntime = shouldIncludeRuntime(flags, scope);
  const outputPath = resolve(requireFlag(flags, "output"));
  const force = flagEnabled(flags, "force");
  const { memory, storage } = await createDiagnosticMemory(flags, {
    includeVectorStore: false,
    readOnlyStorage: true,
  });
  const result = await memory.exportMemory({
    includeRuntime,
    scope,
  });

  await writeExportMemoryOutput({
    force,
    outputPath,
    result,
  });

  const payload = {
    artifactFileCount: result.artifacts.files.length,
    artifactRootPath: result.artifacts.rootPath,
    includeRuntime,
    jsonPath: join(outputPath, "memory-export.json"),
    outputPath,
    scope,
    storage: {
      location: storage.displayValue,
      provider: storage.provider,
    },
  };

  return {
    json: payload,
    text:
      `Exported memory snapshot to ${outputPath}\n` +
      `- json: ${join(outputPath, "memory-export.json")}\n` +
      `- markdown root: ${join(outputPath, result.artifacts.rootPath)}`,
  };
}

async function handleRemember(flags: ParsedFlags): Promise<CLICommandOutput> {
  const { memory, scope, storage } = await resolveWriteExecutionContext(flags);
  const result = await memory.remember({
    extractionStrategy: parseExtractionStrategy(flags),
    locale: flags.locale,
    messages: [
      {
        content: requireFlag(flags, "message"),
        ...(flags["observed-at"] !== undefined
          ? { observedAt: flags["observed-at"] }
          : {}),
        role: parseRememberRole(flags),
        ...(flags.timezone !== undefined ? { timezone: flags.timezone } : {}),
      },
    ],
    scope,
    timezone: flags.timezone,
  });
  const payload = {
    accepted: result.accepted,
    events: result.events,
    metadata: result.metadata ?? null,
    rejected: result.rejected,
    scope,
    storage: {
      location: storage.displayValue,
      provider: storage.provider,
    },
  };

  return {
    json: payload,
    text: renderRememberPayload(payload),
  };
}

async function handleFeedback(flags: ParsedFlags): Promise<CLICommandOutput> {
  const { memory, scope, storage } = await resolveWriteExecutionContext(flags);
  const result = await memory.feedback({
    locale: flags.locale,
    scope,
    signal: requireFlag(flags, "signal"),
  });
  const payload = {
    accepted: result.accepted,
    kind: result.kind,
    memoryId: result.memoryId,
    metadata: result.metadata ?? null,
    outcome: result.outcome,
    promotionReceiptCount: result.promotionReceipts?.length ?? 0,
    promotionReceipts: result.promotionReceipts ?? [],
    proposalReceiptCount: result.proposalReceipts?.length ?? 0,
    proposalReceipts: result.proposalReceipts ?? [],
    scope,
    storage: {
      location: storage.displayValue,
      provider: storage.provider,
    },
  };

  return {
    json: payload,
    text: renderFeedbackPayload(payload),
  };
}

async function handleForget(flags: ParsedFlags): Promise<CLICommandOutput> {
  const { memory, scope, storage } = await resolveWriteExecutionContext(flags);
  const deleteAll = flagEnabled(flags, "all");
  const memoryId = flags["memory-id"];

  if (deleteAll && memoryId) {
    throw new Error("Use either --memory-id or --all, not both.");
  }
  if (!deleteAll && !memoryId) {
    throw new Error("Missing required flag --memory-id or --all.");
  }

  if (deleteAll) {
    const includeRuntime = flagEnabled(flags, "include-runtime");
    const payload = {
      deleted: (
        await memory.deleteAllMemory({
          includeRuntime,
          scope,
        })
      ).deleted,
      includeRuntime,
      scope,
      storage: {
        location: storage.displayValue,
        provider: storage.provider,
      },
    };

    return {
      json: payload,
      text: renderForgetAllPayload(payload),
    };
  }

  const payload = {
    ...(await memory.forget({
      memoryId,
      scope,
    })),
    memoryId,
    scope,
    storage: {
      location: storage.displayValue,
      provider: storage.provider,
    },
  };

  return {
    json: payload,
    text: renderForgetPayload(payload),
  };
}


export async function runMemoryCommand(
  primary: string,
  flags: ParsedFlags,
): Promise<CLIResult> {
  switch (primary) {
    case "remember":
      return renderOutput(await handleRemember(flags), flags);
    case "feedback":
      return renderOutput(await handleFeedback(flags), flags);
    case "forget":
      return renderOutput(await handleForget(flags), flags);
    case "inspect":
      return renderOutput(await handleInspect(flags), flags);
    case "trace":
      return renderOutput(await handleTrace(flags), flags);
    case "stats":
      return renderOutput(await handleStats(flags), flags);
    case "export-memory":
      return renderOutput(await handleExportMemory(flags), flags);
    default:
      throw new Error(`Unknown command: ${primary}. Run 'goodmemory --help'.`);
  }
}
