import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { z } from "zod";

import { createInternalGoodMemory } from "../src/api/createGoodMemory";
import type { MemoryScope } from "../src/domain/scope";
import type { SourceMessageRecord } from "../src/evidence/contracts";
import {
  buildPhase74StageConfigurations,
} from "../src/eval/phase74Generalization";
import type {
  Phase74RecallCase,
  Phase74RetrievalExecutionInput,
  Phase74RetrievalSnapshot,
} from "../src/eval/phase74Generalization";
import {
  createPhase74FullRetrievalRuntime,
} from "../src/eval/phase74FullRuntime";
import {
  PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET,
  PHASE74_HALUMEM_PRE_RANK_LIMIT,
  PHASE74_HALUMEM_QA_JUDGE_PROTOCOL,
  PHASE74_HALUMEM_SELECTED_LIMIT,
  PHASE74_HALUMEM_UPDATE_DECISION_PROTOCOL,
  PHASE74_HALUMEM_UPDATE_EVALUATOR_SOURCE,
  PHASE74_HALUMEM_UPDATE_JUDGE_SYSTEM_PROMPT,
  PHASE74_HALUMEM_UPDATE_TOP_K,
  buildPhase74HaluMemUserScope,
  buildPhase74HaluMemUpdateSnapshotId,
  buildPhase74HaluMemUpdateJudgePrompt,
  buildPhase74HaluMemSourceMessageId,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import type {
  Phase74HaluMemUpdateEvidenceLink,
  Phase74HaluMemProtectionConfiguration,
  Phase74HaluMemQuestion,
  Phase74HaluMemUpdateRecord,
  Phase74HaluMemUpdateRecordType,
  Phase74HaluMemUser,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../src/eval/modelUsage";
import { createAttributedModelUsageSink } from "../src/eval/modelUsage";
import type { Phase74LiveModels } from "../src/eval/phase74Live";
import {
  PHASE74_EMBEDDING_CALL_CONFIGURATION,
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "../src/eval/phase74ProviderConfiguration";
import { hashPhase74ProtectionValue } from "../src/eval/phase74ProtectionRun";
import type { EvalRunJsonObject } from "../src/eval/runIdentity";
import {
  requestOpenAICompatibleObjectResult,
  requestOpenAICompatibleTextResult,
  stripThinkingBlocks,
  withAISDKRetries,
} from "../src/provider/ai-sdk-runtime";
import type { FetchLike } from "../src/provider/ai-sdk-runtime";
import {
  createProviderEmbeddingAdapter,
  createProviderConversationalMemoryExtractor,
  createProviderListwiseReranker,
  createProviderMemoryExtractor,
} from "../src/provider/layer";
import {
  normalizeAISDKLanguageModelUsage,
  runWithModelUsageAttempt,
} from "../src/provider/model-usage";
import type { ModelUsageSink } from "../src/provider/model-usage";
import type { MemoryExtractor } from "../src/remember/candidates";
import type { EvidenceLedgerEntry } from "../src/recall/evidenceLedger";
import type { GeneralizedFusionChannel } from "../src/recall/generalizedFusion";
import type {
  Phase74HaluMemE4Dependencies,
  Phase74HaluMemPrivacyDependencies,
  Phase74HaluMemPrivacySnapshot,
  Phase74HaluMemUpdateDependencies,
  Phase74HaluMemUpdateEvidenceSnapshot,
} from "./phase-74-halumem-protection";

const ALL_FUSION_CHANNELS = [
  "lexical",
  "dense",
  "entity",
  "temporal",
  "relation",
] as const satisfies readonly GeneralizedFusionChannel[];

const BASELINE_FUSION_CHANNELS = [
  "lexical",
  "dense",
  "entity",
] as const satisfies readonly GeneralizedFusionChannel[];

const RAW_EVIDENCE_EXTRACTOR: MemoryExtractor = {
  async extract({ messages }) {
    return {
      candidates: messages.map((message, sourceMessageIndex) => ({
        content: message.content,
        explicitness: "explicit" as const,
        extractionSources: ["rules-only" as const],
        id: `raw-${sourceMessageIndex + 1}`,
        kindHint: "fact" as const,
        sourceMessageIndex,
        sourceRole: message.role,
      })),
      ignoredMessageCount: 0,
    };
  },
};

type LedgerRetrievalSnapshot = Phase74RetrievalSnapshot & {
  evidenceLedger?: EvidenceLedgerEntry[];
};

interface Phase74HaluMemRetrievalRuntime {
  execute(
    input: Phase74RetrievalExecutionInput,
  ): Promise<LedgerRetrievalSnapshot>;
}

export interface Phase74HaluMemScopedMemory {
  recall(input: {
    includeEvidence: true;
    query: string;
    referenceTime: string;
    scope: MemoryScope;
    strategy: "hybrid";
    usageCaseId: string;
  }): Promise<{
    evidence: readonly { sourceMessageIds: readonly string[] }[];
  }>;
  remember(input: {
    annotations: Array<{
      confirmed: true;
      kindHint: "fact";
      messageIndex: number;
      reason: string;
      remember: "always";
      verified: true;
    }>;
    extractionStrategy: "rules-only";
    messages: Array<{
      content: string;
      id: string;
      observedAt: string;
      role: "assistant" | "user";
    }>;
    scope: MemoryScope;
    usageCaseId: string;
  }): Promise<unknown>;
}

export interface Phase74HaluMemUpdateMemory {
  recall(input: {
    query: string;
    referenceTime: string;
    scope: MemoryScope;
    strategy: "hybrid";
    topK: number;
    usageCaseId: string;
  }): Promise<{
    records: readonly Phase74HaluMemUpdateRecord[];
  }>;
  setReferenceTime(referenceTime: string): void;
  remember(input: {
    annotations: Array<{
      confirmed: true;
      messageIndex: number;
      remember: "auto";
      verified: true;
    }>;
    extractionStrategy: "llm-assisted";
    messages: Array<{
      content: string;
      id: string;
      observedAt: string;
      role: "assistant" | "user";
    }>;
    scope: MemoryScope;
    usageCaseId: string;
  }): Promise<{ warnings?: string[] }>;
}

export interface Phase74HaluMemLiveDependencyInput {
  baseConfiguration?: EvalRunJsonObject;
  datasetSha256: string;
  evaluatorSourceSha256: string;
  events: AttributedModelUsageAttempt[];
  fetch?: FetchLike;
  intents: AttributedModelUsageIntent[];
  models: Phase74LiveModels;
  onIngestionUse?: Parameters<
    typeof createPhase74FullRetrievalRuntime
  >[0]["onIngestionUse"];
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
  promptSha256s: Readonly<Record<string, string>>;
  retrievalRuntime?: Phase74HaluMemRetrievalRuntime;
  runDirectory: string;
  users: readonly Phase74HaluMemUser[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isoTimestamp(value: string, label: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Phase 74 HaluMem ${label} is not an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function referenceTimeThroughSession(
  user: Phase74HaluMemUser,
  sessionIndex: number,
): string {
  const timestamps = user.sessions.slice(0, sessionIndex + 1).flatMap(
    (session) => [
      session.start_time,
      ...session.dialogue.map(({ timestamp }) => timestamp),
    ],
  ).map((value, index) => isoTimestamp(value, `timestamp ${index}`));
  return timestamps.sort((left, right) => left.localeCompare(right)).at(-1)!;
}

export function buildPhase74HaluMemCausalRecallCase(input: {
  question: Phase74HaluMemQuestion;
  questionCaseId: string;
  sessionIndex: number;
  user: Phase74HaluMemUser;
}): Phase74RecallCase {
  if (
    !Number.isSafeInteger(input.sessionIndex) ||
    input.sessionIndex < 0 ||
    input.sessionIndex >= input.user.sessions.length
  ) {
    throw new Error("Phase 74 HaluMem causal session index is out of range.");
  }
  const rawEvidence = input.user.sessions
    .slice(0, input.sessionIndex + 1)
    .flatMap((session, sessionIndex) =>
      session.dialogue.map((turn, turnIndex) => {
        const id = buildPhase74HaluMemSourceMessageId({
          sessionIndex,
          turnIndex,
          userUuid: input.user.uuid,
        });
        return {
          content: turn.content,
          id,
          observedAt: isoTimestamp(
            turn.timestamp,
            `${input.questionCaseId} source ${sessionIndex}:${turnIndex}`,
          ),
          role: turn.role === "assistant" ? "assistant" : "user",
          sourceIds: [id],
        };
      })
    );
  return {
    caseId: input.questionCaseId,
    memoryGroupId:
      `halumem:${input.user.uuid}:through-session:${input.sessionIndex}`,
    question: input.question.question,
    rawEvidence,
    referenceTime: referenceTimeThroughSession(
      input.user,
      input.sessionIndex,
    ),
  };
}

function usageCaseId(input: {
  format: string;
  questionCaseId: string;
}): string {
  return `${input.questionCaseId}:${input.format}`;
}

function createReader(input: Phase74HaluMemLiveDependencyInput) {
  const configuration = PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader;
  return async (payload: Parameters<Phase74HaluMemE4Dependencies["answer"]>[0]) => {
    const sink = createAttributedModelUsageSink({
      branch: payload.branch,
      caseId: usageCaseId(payload),
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    let attempt = 0;
    return withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.models.answer.model,
        operation: "answer_generation",
        providerId: input.models.answer.provider,
        run: async (report) => {
          const result = await requestOpenAICompatibleTextResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.models.answer,
            prompt: payload.prompt,
            reasoningEffort: configuration.reasoningEffort,
            system: payload.system,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          report(result.usage ?? normalizeAISDKLanguageModelUsage(undefined));
          const answer = stripThinkingBlocks(result.text);
          if (answer === "") {
            throw new Error("Phase 74 HaluMem live reader returned an empty answer.");
          }
          return answer;
        },
        sink,
      });
    }, { retryLimit: configuration.retryLimit });
  };
}

const QA_DECISION_SCHEMA = z.object({
  protocol: z.literal(PHASE74_HALUMEM_QA_JUDGE_PROTOCOL),
  reason: z.string().min(1),
  verdict: z.enum(["correct", "incorrect"]),
});

const UPDATE_DECISION_SCHEMA = z.object({
  evaluation_result: z.enum([
    "Correct",
    "Hallucination",
    "Omission",
    "Other",
  ]),
  reason: z.string().min(1),
}).strict();

function createJudge(input: Phase74HaluMemLiveDependencyInput) {
  const configuration = PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.oracle;
  return async (payload: Parameters<Phase74HaluMemE4Dependencies["judgeQa"]>[0]) => {
    const sink = createAttributedModelUsageSink({
      branch: "judge",
      caseId: usageCaseId(payload),
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    let attempt = 0;
    return withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.models.judge.model,
        operation: "judge",
        providerId: input.models.judge.provider,
        run: async (report) => {
          const result = await requestOpenAICompatibleObjectResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.models.judge,
            prompt: payload.prompt,
            reasoningEffort: configuration.reasoningEffort,
            schema: QA_DECISION_SCHEMA,
            system: payload.system,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          report(result.usage ?? normalizeAISDKLanguageModelUsage(undefined));
          return JSON.stringify(result.object);
        },
        sink,
      });
    }, { retryLimit: configuration.retryLimit });
  };
}

function createUpdateJudge(input: Phase74HaluMemLiveDependencyInput) {
  const configuration = PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.oracle;
  return async (
    payload: Parameters<NonNullable<Phase74HaluMemUpdateDependencies["evaluateUpdate"]>>[0],
  ) => {
    if (
      hashPhase74ProtectionValue(payload.evaluator) !==
        hashPhase74ProtectionValue(PHASE74_HALUMEM_UPDATE_EVALUATOR_SOURCE)
    ) {
      throw new Error("Phase 74 HaluMem update evaluator source drifted.");
    }
    const sink = createAttributedModelUsageSink({
      branch: "judge",
      caseId: `${payload.updateCaseId}:${payload.branch}:update`,
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    let attempt = 0;
    return withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.models.judge.model,
        operation: "judge",
        providerId: input.models.judge.provider,
        run: async (report) => {
          const result = await requestOpenAICompatibleObjectResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.models.judge,
            prompt: buildPhase74HaluMemUpdateJudgePrompt({
              expectedUpdate: payload.expectedUpdate,
              originalMemories: payload.originalMemories,
              retrievedMemories: payload.retrievedMemories,
            }),
            reasoningEffort: configuration.reasoningEffort,
            schema: UPDATE_DECISION_SCHEMA,
            system: PHASE74_HALUMEM_UPDATE_JUDGE_SYSTEM_PROMPT,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          const usage = result.usage ??
            normalizeAISDKLanguageModelUsage(undefined);
          report(usage);
          return JSON.stringify({
            category: result.object.evaluation_result,
            protocol: PHASE74_HALUMEM_UPDATE_DECISION_PROTOCOL,
            rawDecision: JSON.stringify(result.object),
            usage,
          });
        },
        sink,
      });
    }, { retryLimit: configuration.retryLimit });
  };
}

async function seedUserThroughSession(input: {
  branch: "baseline" | "candidate";
  memory: Phase74HaluMemScopedMemory;
  sessionIndex: number;
  user: Phase74HaluMemUser;
}): Promise<void> {
  const scope = buildPhase74HaluMemUserScope(input.user.uuid);
  for (
    const [sessionIndex, session] of input.user.sessions
      .slice(0, input.sessionIndex + 1)
      .entries()
  ) {
    const messages = session.dialogue.map((turn, turnIndex) => ({
      content: turn.content,
      id: buildPhase74HaluMemSourceMessageId({
        sessionIndex,
        turnIndex,
        userUuid: input.user.uuid,
      }),
      observedAt: isoTimestamp(
        turn.timestamp,
        `${input.user.uuid} privacy source ${sessionIndex}:${turnIndex}`,
      ),
      role: turn.role === "assistant" ? "assistant" as const : "user" as const,
    }));
    await input.memory.remember({
      annotations: messages.map((_, messageIndex) => ({
        confirmed: true,
        kindHint: "fact" as const,
        messageIndex,
        reason: "Preserve immutable external privacy evidence.",
        remember: "always" as const,
        verified: true,
      })),
      extractionStrategy: "rules-only",
      messages,
      scope: { ...scope, sessionId: `session-${sessionIndex}` },
      usageCaseId:
        `halumem-privacy:${input.user.uuid}:session:${sessionIndex}:${input.branch}:ingest`,
    });
  }
}

function updateCaseId(
  userUuid: string,
  sessionIndex: number,
  memoryPointIndex: number,
): string {
  return `${userUuid}:session:${sessionIndex}:update:${memoryPointIndex}`;
}

export function createPhase74HaluMemScopedUpdateRuntime(input: {
  branch: "baseline" | "candidate";
  createMemory(input: {
    referenceTime: string;
    userUuid: string;
  }): Phase74HaluMemUpdateMemory;
  users: readonly Phase74HaluMemUser[];
}): {
  retrieve: Phase74HaluMemUpdateDependencies["retrieveUpdateEvidence"];
} {
  const snapshots = new Map<string, Phase74HaluMemUpdateEvidenceSnapshot>();
  let ready: Promise<void> | undefined;
  const prepare = () => {
    ready ??= Promise.all(input.users.map(async (user) => {
      const memory = input.createMemory({
        referenceTime: referenceTimeThroughSession(
          user,
          0,
        ),
        userUuid: user.uuid,
      });
      const scope = buildPhase74HaluMemUserScope(user.uuid);
      for (const [sessionIndex, session] of user.sessions.entries()) {
        const referenceTime = referenceTimeThroughSession(user, sessionIndex);
        memory.setReferenceTime(referenceTime);
        const messages = session.dialogue.map((turn, turnIndex) => ({
          content: turn.content,
          id: buildPhase74HaluMemSourceMessageId({
            sessionIndex,
            turnIndex,
            userUuid: user.uuid,
          }),
          observedAt: isoTimestamp(
            turn.timestamp,
            `${user.uuid} update source ${sessionIndex}:${turnIndex}`,
          ),
          role: turn.role === "assistant" ? "assistant" as const : "user" as const,
        }));
        const rememberResult = await memory.remember({
          annotations: messages.flatMap((message, messageIndex) =>
            message.role === "assistant"
              ? [{
                  confirmed: true as const,
                  messageIndex,
                  remember: "auto" as const,
                  verified: true as const,
                }]
              : []
          ),
          extractionStrategy: "llm-assisted",
          messages,
          scope: { ...scope, sessionId: `session-${sessionIndex}` },
          usageCaseId:
            `halumem-update:${user.uuid}:session:${sessionIndex}:${input.branch}:ingest`,
        });
        if (rememberResult.warnings?.includes("assisted_extraction_failed")) {
          throw new Error(
            `Phase 74 HaluMem ${input.branch} update extraction failed for session ${sessionIndex}.`,
          );
        }
        for (const [memoryPointIndex, memoryPoint] of session.memory_points.entries()) {
          if (
            memoryPoint.is_update !== "True" ||
            memoryPoint.original_memories.length === 0
          ) {
            continue;
          }
          const caseId = updateCaseId(user.uuid, sessionIndex, memoryPointIndex);
          const recall = await memory.recall({
            query: memoryPoint.memory_content,
            referenceTime,
            scope,
            strategy: "hybrid",
            topK: PHASE74_HALUMEM_UPDATE_TOP_K,
            usageCaseId: `${caseId}:${input.branch}:retrieve`,
          });
          const records = recall.records.slice(0, PHASE74_HALUMEM_UPDATE_TOP_K);
          const sourceMessageIds = [...new Set(
            records.flatMap((record) => record.sourceMessageIds),
          )].sort();
          snapshots.set(caseId, {
            records,
            snapshotId: buildPhase74HaluMemUpdateSnapshotId({
              branch: input.branch,
              caseId,
              records,
              sessionIndex,
              sourceMessageIds,
            }),
            sourceMessageIds,
          });
        }
      }
    })).then(() => undefined);
    return ready;
  };
  return {
    async retrieve(payload) {
      if (payload.branch !== input.branch) {
        throw new Error("Phase 74 HaluMem update branch drifted.");
      }
      await prepare();
      const snapshot = snapshots.get(payload.updateCaseId);
      if (!snapshot) {
        throw new Error(
          `Phase 74 HaluMem update case is not in the causal snapshot: ${payload.updateCaseId}.`,
        );
      }
      return structuredClone(snapshot);
    },
  };
}

function recalledSourceMessageIds(
  evidence: readonly { sourceMessageIds: readonly string[] }[],
): string[] {
  return [...new Set(evidence.flatMap(({ sourceMessageIds }) => sourceMessageIds))]
    .sort();
}

export function buildPhase74HaluMemUpdateRecords(
  recall: {
    archives?: readonly { id: string; summary: string }[];
    episodes?: readonly { id: string; summary: string }[];
    facts?: readonly { content: string; id: string }[];
    feedback?: readonly { id: string; rule: string }[];
    evidence?: readonly {
      excerpt: string;
      id: string;
      linkedArchiveIds: readonly string[];
      linkedMemoryIds: readonly string[];
      sourceMessageIds: readonly string[];
      sourceRecordIds?: readonly string[];
      sourceUri?: string;
    }[];
    metadata?: {
      hits?: readonly { id: string; type: string }[];
    };
    preferences?: readonly { category: string; id: string; value: unknown }[];
    profile?: {
      activeContext: unknown;
      expertise: unknown;
      identity: unknown;
      userId: string;
    } | null;
    references?: readonly {
      description?: string;
      id: string;
      pointer: string;
      title: string;
    }[];
  },
  topK = PHASE74_HALUMEM_UPDATE_TOP_K,
  sourceMessages: readonly SourceMessageRecord[] = [],
): Phase74HaluMemUpdateRecord[] {
  if (!Number.isSafeInteger(topK) || topK <= 0) {
    throw new Error("Phase 74 HaluMem update topK must be positive.");
  }
  const candidates: Array<{
    content: string;
    id: string;
    key: string;
    type: Phase74HaluMemUpdateRecordType;
  }> = [];
  if (recall.profile) {
    candidates.push({
      content: JSON.stringify({
        activeContext: recall.profile.activeContext,
        expertise: recall.profile.expertise,
        identity: recall.profile.identity,
      }),
      id: recall.profile.userId,
      key: `profile:${recall.profile.userId}`,
      type: "profile",
    });
  }
  for (const preference of recall.preferences ?? []) {
    candidates.push({
      content: `${preference.category}: ${
        typeof preference.value === "string"
          ? preference.value
          : JSON.stringify(preference.value)
      }`,
      id: preference.id,
      key: `preference:${preference.id}`,
      type: "preference",
    });
  }
  for (const reference of recall.references ?? []) {
    candidates.push({
      content: `${reference.title}: ${reference.description ?? reference.pointer}`,
      id: reference.id,
      key: `reference:${reference.id}`,
      type: "reference",
    });
  }
  for (const fact of recall.facts ?? []) {
    candidates.push({
      content: fact.content,
      id: fact.id,
      key: `fact:${fact.id}`,
      type: "fact",
    });
  }
  for (const feedback of recall.feedback ?? []) {
    candidates.push({
      content: feedback.rule,
      id: feedback.id,
      key: `feedback:${feedback.id}`,
      type: "feedback",
    });
  }
  for (const archive of recall.archives ?? []) {
    candidates.push({
      content: archive.summary,
      id: archive.id,
      key: `session_archive:${archive.id}`,
      type: "session_archive",
    });
  }
  for (const episode of recall.episodes ?? []) {
    candidates.push({
      content: episode.summary,
      id: episode.id,
      key: `episode:${episode.id}`,
      type: "episode",
    });
  }

  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const ordered = (recall.metadata?.hits ?? [])
    .map(({ id, type }) => byKey.get(`${type}:${id}`))
    .filter((candidate): candidate is typeof candidates[number] =>
      candidate !== undefined
    );
  const seen = new Set(ordered.map(({ key }) => key));
  for (const candidate of candidates) {
    if (!seen.has(candidate.key)) {
      ordered.push(candidate);
      seen.add(candidate.key);
    }
  }
  const evidence = recall.evidence ?? [];
  const sourceMessagesById = new Map(sourceMessages.map((source) => [
    source.id,
    source,
  ]));
  const records = ordered.flatMap((candidate) => {
    const evidenceLinks = evidence.flatMap((record) => {
      const linkedIds = candidate.type === "session_archive"
        ? record.linkedArchiveIds
        : record.linkedMemoryIds;
      const linkedSourceRecords = (record.sourceRecordIds ?? []).map(
        (sourceRecordId) => sourceMessagesById.get(sourceRecordId),
      );
      if (
        !linkedIds.includes(candidate.id) ||
        record.sourceMessageIds.length === 0 ||
        (record.sourceRecordIds?.length ?? 0) !== record.sourceMessageIds.length ||
        record.sourceUri === undefined ||
        linkedSourceRecords.some((source) =>
          source?.sourceMessageId === undefined ||
          source.observedAt === undefined ||
          (source.role !== "assistant" && source.role !== "user")
        )
      ) {
        return [];
      }
      return [{
        evidenceId: record.id,
        excerpt: record.excerpt,
        excerptSha256: sha256(record.excerpt),
        linkedArchiveIds: [...record.linkedArchiveIds],
        linkedMemoryIds: [...record.linkedMemoryIds],
        sourceMessageIds: [...record.sourceMessageIds],
        sourceRecordIds: [...record.sourceRecordIds!],
        sourceRecords: linkedSourceRecords.map((source) => ({
          contentSha256: source!.contentSha256,
          id: source!.id,
          observedAt: source!.observedAt!,
          role: source!.role as "assistant" | "user",
          sourceMessageId: source!.sourceMessageId!,
        })),
        sourceUri: record.sourceUri,
      } satisfies Phase74HaluMemUpdateEvidenceLink];
    }).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
    if (evidenceLinks.length === 0) {
      return [];
    }
    return [{
      content: candidate.content,
      evidenceLinks,
      id: candidate.id,
      rank: 0,
      sourceMessageIds: [...new Set(
        evidenceLinks.flatMap((record) => record.sourceMessageIds),
      )].sort(),
      type: candidate.type,
    }];
  });
  return records
    .slice(0, Math.min(topK, PHASE74_HALUMEM_UPDATE_TOP_K))
    .map((record, index) => ({ ...record, rank: index + 1 }));
}

export function createPhase74HaluMemScopedPrivacyRuntime(input: {
  branch: "baseline" | "candidate";
  createMemory(input: { referenceTime: string }): Phase74HaluMemScopedMemory;
  users: readonly Phase74HaluMemUser[];
}): {
  recall(input: {
    ownerUserUuid: string;
    privacyCaseId: string;
    question: string;
    sessionIndex: number;
    targetUserUuid: string;
  }): Promise<Phase74HaluMemPrivacySnapshot>;
} {
  const users = new Map(input.users.map((user) => [user.uuid, user] as const));
  const storeReferenceTime = input.users
    .map((user) => referenceTimeThroughSession(user, user.sessions.length - 1))
    .sort((left, right) => left.localeCompare(right))
    .at(-1)!;
  let ready: Promise<Phase74HaluMemScopedMemory> | undefined;
  const prepare = () => {
    ready ??= (async () => {
      const memory = input.createMemory({ referenceTime: storeReferenceTime });
      for (const user of input.users) {
        await seedUserThroughSession({
          branch: input.branch,
          memory,
          sessionIndex: user.sessions.length - 1,
          user,
        });
      }
      return memory;
    })();
    return ready;
  };
  return {
    async recall(payload) {
      const owner = users.get(payload.ownerUserUuid);
      const target = users.get(payload.targetUserUuid);
      if (!owner || !target) {
        throw new Error("Phase 74 HaluMem privacy user is not selected.");
      }
      const referenceTime = referenceTimeThroughSession(
        owner,
        payload.sessionIndex,
      );
      const memory = await prepare();
      const [ownerRecall, foreignRecall] = await Promise.all([
        memory.recall({
          includeEvidence: true,
          query: payload.question,
          referenceTime,
          scope: buildPhase74HaluMemUserScope(owner.uuid),
          strategy: "hybrid",
          usageCaseId: `${payload.privacyCaseId}:${input.branch}:owner`,
        }),
        memory.recall({
          includeEvidence: true,
          query: payload.question,
          referenceTime,
          scope: buildPhase74HaluMemUserScope(target.uuid),
          strategy: "hybrid",
          usageCaseId: `${payload.privacyCaseId}:${input.branch}:foreign`,
        }),
      ]);
      const snapshot = {
        branch: input.branch,
        foreignScopeSourceMessageIds: recalledSourceMessageIds(
          foreignRecall.evidence,
        ),
        ownerScopeSourceMessageIds: recalledSourceMessageIds(ownerRecall.evidence),
        privacyCaseId: payload.privacyCaseId,
      };
      return {
        foreignScopeSourceMessageIds: snapshot.foreignScopeSourceMessageIds,
        ownerScopeSourceMessageIds: snapshot.ownerScopeSourceMessageIds,
        snapshotId: hashPhase74ProtectionValue(snapshot),
      };
    },
  };
}

function createContextualHaluMemUsage(input: {
  branch: "baseline" | "candidate";
  live: Phase74HaluMemLiveDependencyInput;
}): {
  run<T>(caseId: string, operation: () => Promise<T>): Promise<T>;
  sink: ModelUsageSink;
} {
  const context = new AsyncLocalStorage<string>();
  return {
    run: (caseId, operation) => context.run(caseId, operation),
    sink: createAttributedModelUsageSink({
      branch: input.branch,
      caseId: () => {
        const caseId = context.getStore();
        if (!caseId) {
          throw new Error("Phase 74 HaluMem model usage context is missing.");
        }
        return caseId;
      },
      events: input.live.events,
      intents: input.live.intents,
      onEvent: input.live.onUsageEvent,
      onIntent: input.live.onUsageIntent,
    }),
  };
}

function createPrivacyMemory(input: {
  branch: "baseline" | "candidate";
  caseId: string;
  live: Phase74HaluMemLiveDependencyInput;
  referenceTime: string;
}): Phase74HaluMemScopedMemory {
  const configuration = buildPhase74HaluMemPrivacyPipelineMaterial(
    input.branch,
    input.live.models,
  );
  const usage = createContextualHaluMemUsage(input);
  const memory = createInternalGoodMemory({
    adapters: {
      embeddingAdapter: createProviderEmbeddingAdapter({
        ...PHASE74_EMBEDDING_CALL_CONFIGURATION,
        model: input.live.models.embedding,
        modelUsageSink: usage.sink,
      }),
      reranker: createProviderListwiseReranker({
        ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.listwiseReranker,
        model: input.live.models.reranker,
        modelUsageSink: usage.sink,
      }),
    },
    remember: {
      profiles: [{
        assistantOutputs: { mode: "confirmed_or_verified_only" },
        id: "external-evidence",
      }],
    },
    retrieval: {
      generalizedFusionChannels: [
        ...configuration.retrieval.generalizedFusionChannels,
      ],
      preset: configuration.retrieval.preset,
      recallPlanExecution: configuration.retrieval.recallPlanExecution,
    },
    testing: {
      extractor: RAW_EVIDENCE_EXTRACTOR,
      now: () => new Date(input.referenceTime),
    },
  }, { environment: {} });
  return {
    recall({ usageCaseId, ...payload }) {
      return usage.run(usageCaseId, () => memory.recall(payload));
    },
    remember({ usageCaseId, ...payload }) {
      return usage.run(usageCaseId, () => memory.remember(payload));
    },
  };
}

function createUpdateMemory(input: {
  branch: "baseline" | "candidate";
  caseId: string;
  live: Phase74HaluMemLiveDependencyInput;
  referenceTime: string;
}): Phase74HaluMemUpdateMemory {
  let referenceTime = input.referenceTime;
  const configuration = buildPhase74HaluMemUpdatePipelineMaterial(
    input.branch,
    input.live.models,
  );
  const usage = createContextualHaluMemUsage(input);
  const assistedExtractor = input.branch === "candidate"
    ? createProviderConversationalMemoryExtractor({
        contextualDescriptor: true,
        ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.assistedExtraction,
        model: input.live.models.assistedExtraction,
        modelUsageSink: usage.sink,
      })
    : createProviderMemoryExtractor({
        ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.assistedExtraction,
        model: input.live.models.assistedExtraction,
        modelUsageSink: usage.sink,
      });
  const memory = createInternalGoodMemory({
    adapters: {
      assistedExtractor,
      embeddingAdapter: createProviderEmbeddingAdapter({
        ...PHASE74_EMBEDDING_CALL_CONFIGURATION,
        model: input.live.models.embedding,
        modelUsageSink: usage.sink,
      }),
      reranker: createProviderListwiseReranker({
        ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.listwiseReranker,
        model: input.live.models.reranker,
        modelUsageSink: usage.sink,
      }),
    },
    remember: {
      profiles: [{
        assistantOutputs: { mode: "confirmed_or_verified_only" },
        id: "external-evidence",
      }],
    },
    retrieval: {
      generalizedFusionChannels: [
        ...configuration.retrieval.generalizedFusionChannels,
      ],
      preset: configuration.retrieval.preset,
      recallPlanExecution: configuration.retrieval.recallPlanExecution,
    },
    testing: { now: () => new Date(referenceTime) },
  }, { environment: {} });
  return {
    async recall({ topK, usageCaseId, ...payload }) {
      return usage.run(usageCaseId, async () => {
        const result = await memory.recall({
          ...payload,
          decompose: false,
          includeEvidence: true,
          multiHop: false,
        });
        const exported = await memory.exportMemory({ scope: payload.scope });
        return {
          records: buildPhase74HaluMemUpdateRecords(
            result,
            topK,
            exported.durable.sourceMessages ?? [],
          ),
        };
      });
    },
    setReferenceTime(value) {
      referenceTime = isoTimestamp(value, `${input.caseId} update clock`);
    },
    remember: ({ usageCaseId, ...payload }) =>
      usage.run(usageCaseId, () => memory.remember(payload)),
  };
}

function privacySessionIndex(privacyCaseId: string): number {
  const match = privacyCaseId.match(/:session:(\d+):question:/u);
  if (!match) {
    throw new Error("Phase 74 HaluMem privacy case ID has no session index.");
  }
  return Number(match[1]);
}

function modelCallIdentity(
  model: Phase74LiveModels["answer"],
  configuration: {
    maxOutputTokens: number;
    reasoningEffort: "low" | "medium" | "high";
    requestTimeoutMs: number;
    retryLimit: number;
    temperature: number;
  },
) {
  return {
    gateway: model.baseURL ?? "",
    maxOutputTokens: configuration.maxOutputTokens,
    model: model.model,
    provider: model.provider,
    reasoningEffort: configuration.reasoningEffort,
    requestTimeoutMs: configuration.requestTimeoutMs,
    retryLimit: configuration.retryLimit,
    temperature: configuration.temperature,
  };
}

export function buildPhase74HaluMemPrivacyPipelineMaterial(
  branch: "baseline" | "candidate",
  models: Phase74LiveModels,
) {
  const publicModel = (model: Phase74LiveModels["answer"]) => ({
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  });
  return {
    embedding: {
      ...publicModel(models.embedding),
      ...PHASE74_EMBEDDING_CALL_CONFIGURATION,
    },
    extraction: "rules-only-immutable-message-v1" as const,
    reranker: {
      ...publicModel(models.reranker),
      ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.listwiseReranker,
    },
    retrieval: {
      generalizedFusionChannels: branch === "candidate"
        ? ALL_FUSION_CHANNELS
        : BASELINE_FUSION_CHANNELS,
      preset: "recommended" as const,
      recallPlanExecution: branch === "candidate",
    },
    scopeTopology: "one-store-distinct-user-scopes-v1" as const,
  };
}

export function buildPhase74HaluMemUpdatePipelineMaterial(
  branch: "baseline" | "candidate",
  models: Phase74LiveModels,
) {
  const publicModel = (model: Phase74LiveModels["answer"]) => ({
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  });
  return {
    embedding: {
      ...publicModel(models.embedding),
      ...PHASE74_EMBEDDING_CALL_CONFIGURATION,
    },
    extraction: {
      ...publicModel(models.assistedExtraction),
      ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.assistedExtraction,
      contextualDescriptors: branch === "candidate",
      mode: branch === "candidate" ? "conversational" : "generic",
    },
    ingestionClock: "latest-dialogue-time-through-session-v1" as const,
    reranker: {
      ...publicModel(models.reranker),
      ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.listwiseReranker,
    },
    retrieval: {
      generatedMemoryRecords: "evidence-backed-retrieved-records-v2" as const,
      generalizedFusionChannels: branch === "candidate"
        ? ALL_FUSION_CHANNELS
        : BASELINE_FUSION_CHANNELS,
      preset: "recommended" as const,
      recallPlanExecution: branch === "candidate",
      topK: PHASE74_HALUMEM_UPDATE_TOP_K,
    },
    sessionPolicy: "causal-session-write-then-update-retrieval-v1" as const,
  };
}

export function buildPhase74HaluMemLiveConfigurations(
  models: Phase74LiveModels,
  baseConfiguration: EvalRunJsonObject = {},
): {
  e4: Phase74HaluMemProtectionConfiguration;
  privacy: Phase74HaluMemProtectionConfiguration;
  update: Phase74HaluMemProtectionConfiguration;
} {
  const e3 = buildPhase74StageConfigurations(baseConfiguration, "E3");
  const publicModel = (model: Phase74LiveModels["answer"]) => ({
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  });
  const privacyBaselinePipeline = {
    id: "halumem-live-privacy-baseline-v1",
    sha256: hashPhase74ProtectionValue(
      buildPhase74HaluMemPrivacyPipelineMaterial("baseline", models),
    ),
  };
  const privacyCandidatePipeline = {
    id: "halumem-live-privacy-candidate-v1",
    sha256: hashPhase74ProtectionValue(
      buildPhase74HaluMemPrivacyPipelineMaterial("candidate", models),
    ),
  };
  const updateBaselinePipeline = {
    id: "halumem-live-update-baseline-v1",
    sha256: hashPhase74ProtectionValue(
      buildPhase74HaluMemUpdatePipelineMaterial("baseline", models),
    ),
  };
  const updateCandidatePipeline = {
    id: "halumem-live-update-candidate-v1",
    sha256: hashPhase74ProtectionValue(
      buildPhase74HaluMemUpdatePipelineMaterial("candidate", models),
    ),
  };
  const e4Pipeline = {
    id: "halumem-live-e3-deterministic-v1",
    sha256: hashPhase74ProtectionValue({
      configuration: e3["recall-plan-deterministic"],
      embedding: publicModel(models.embedding),
      extraction: publicModel(models.assistedExtraction),
      reranker: publicModel(models.reranker),
      runtime: "phase74-full-retrieval-runtime-v1",
    }),
  };
  const common = {
    answerModel: modelCallIdentity(
      models.answer,
      PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader,
    ),
    context: {
      maxTokens: PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET,
      tokenizer: "utf8-byte-upper-bound-v1" as const,
    },
    judgeModel: modelCallIdentity(
      models.judge,
      PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.oracle,
    ),
    retrievalBudget: {
      preRankLimit: PHASE74_HALUMEM_PRE_RANK_LIMIT,
      selectedLimit: PHASE74_HALUMEM_SELECTED_LIMIT,
    },
  };
  return {
    e4: {
      ...common,
      baselinePipeline: e4Pipeline,
      candidatePipeline: e4Pipeline,
    },
    privacy: {
      ...common,
      baselinePipeline: privacyBaselinePipeline,
      candidatePipeline: privacyCandidatePipeline,
    },
    update: {
      ...common,
      baselinePipeline: updateBaselinePipeline,
      candidatePipeline: updateCandidatePipeline,
      updateEvaluator: PHASE74_HALUMEM_UPDATE_EVALUATOR_SOURCE,
    },
  };
}

export function createPhase74HaluMemLiveDependencies(
  input: Phase74HaluMemLiveDependencyInput,
): {
  e4: Phase74HaluMemE4Dependencies;
  privacy: Phase74HaluMemPrivacyDependencies;
  update: Phase74HaluMemUpdateDependencies;
} {
  const configurations = buildPhase74StageConfigurations(
    input.baseConfiguration ?? {},
    "E3",
  );
  const retrieval = input.retrievalRuntime ?? createPhase74FullRetrievalRuntime({
    datasetSha256: input.datasetSha256,
    evaluatorSourceSha256: input.evaluatorSourceSha256,
    events: input.events,
    intents: input.intents,
    models: input.models,
    onIngestionUse: input.onIngestionUse,
    onUsageEvent: input.onUsageEvent,
    onUsageIntent: input.onUsageIntent,
    promptSha256s: input.promptSha256s,
    rerankerMode: "provider",
    runDirectory: input.runDirectory,
  });
  const users = new Map(input.users.map((user) => [user.uuid, user] as const));
  const privacyRuntimes = Object.fromEntries(
    (["baseline", "candidate"] as const).map((branch) => [
      branch,
      createPhase74HaluMemScopedPrivacyRuntime({
        branch,
        createMemory: ({ referenceTime }) => createPrivacyMemory({
          branch,
          caseId: `halumem-privacy:${branch}`,
          live: input,
          referenceTime,
        }),
        users: input.users,
      }),
    ]),
  );
  const updateRuntimes = Object.fromEntries(
    (["baseline", "candidate"] as const).map((branch) => [
      branch,
      createPhase74HaluMemScopedUpdateRuntime({
        branch,
        createMemory: ({ referenceTime, userUuid }) => createUpdateMemory({
          branch,
          caseId: `halumem-update:${userUuid}:${branch}`,
          live: input,
          referenceTime,
        }),
        users: input.users,
      }),
    ]),
  );
  return {
    e4: {
      answer: createReader(input),
      judgeQa: createJudge(input),
      async retrieveEvidence(payload) {
        const snapshot = await retrieval.execute({
          arm: "recall-plan-deterministic",
          configuration: configurations["recall-plan-deterministic"]!,
          stage: "E3",
          testCase: buildPhase74HaluMemCausalRecallCase(payload),
        });
        if (!Array.isArray(snapshot.evidenceLedger)) {
          throw new Error(
            "Phase 74 HaluMem deterministic E3 snapshot has no typed evidence ledger.",
          );
        }
        return {
          evidenceLedger: structuredClone(snapshot.evidenceLedger),
          snapshotId: snapshot.snapshotId,
        };
      },
    },
    privacy: {
      async recallScopes(payload) {
        if (
          !users.has(payload.ownerUserUuid) ||
          !users.has(payload.targetUserUuid)
        ) {
          throw new Error("Phase 74 HaluMem privacy user is not selected.");
        }
        return privacyRuntimes[payload.branch].recall({
          ownerUserUuid: payload.ownerUserUuid,
          privacyCaseId: payload.privacyCaseId,
          question: payload.question,
          sessionIndex: privacySessionIndex(payload.privacyCaseId),
          targetUserUuid: payload.targetUserUuid,
        });
      },
    },
    update: {
      evaluateUpdate: createUpdateJudge(input),
      retrieveUpdateEvidence(payload) {
        return updateRuntimes[payload.branch].retrieve(payload);
      },
    },
  };
}
