import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  modelUsageCompleteness,
  modelTokenTotal,
} from "../provider/model-usage";
import type {
  ModelUsageAttempt,
  ModelUsageIntent,
  ModelUsageOperation,
  ModelUsageSink,
} from "../provider/model-usage";
import {
  PHASE74_MODEL_USAGE_ALLOCATION_POLICY,
  PHASE74_MODEL_USAGE_ACCOUNTING_VERSION,
  type Phase74ModelUsageBranchEvidence,
  type Phase74ModelUsageEvidence,
  type Phase74ModelUsagePoolEvidence,
} from "./phase74PromotionGate";

export type Phase74ModelUsageBranch =
  | "baseline"
  | "candidate"
  | "judge"
  | "oracle_reader"
  | "protocol_reader"
  | "shadow";

export interface AttributedModelUsageAttempt extends ModelUsageAttempt {
  branch: Phase74ModelUsageBranch;
  caseId: string;
  recovery?: "interrupted_before_terminal";
  requestId: string;
}

export interface AttributedModelUsageIntent extends ModelUsageIntent {
  branch: Phase74ModelUsageBranch;
  caseId: string;
  requestId: string;
}

export interface Phase74ModelUsageLedger {
  events: AttributedModelUsageAttempt[];
  intents: AttributedModelUsageIntent[];
  pendingIntents: AttributedModelUsageIntent[];
}

const PHASE74_USAGE_BRANCHES = new Set<Phase74ModelUsageBranch>([
  "baseline",
  "candidate",
  "judge",
  "oracle_reader",
  "protocol_reader",
  "shadow",
]);
const PHASE74_USAGE_OPERATIONS = new Set<ModelUsageOperation>([
  "answer_generation",
  "assisted_extraction",
  "embedding",
  "judge",
  "recall_plan",
  "recall_router_plan",
  "recall_router_rerank",
  "reranker_listwise",
  "reranker_pointwise",
]);

function isUsageTokenCount(value: unknown): boolean {
  return value === null || (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function isAttributedModelUsageAttempt(
  value: unknown,
): value is AttributedModelUsageAttempt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  const usage = event.usage;
  return Number.isSafeInteger(event.attempt) && Number(event.attempt) > 0 &&
    typeof event.branch === "string" &&
    PHASE74_USAGE_BRANCHES.has(event.branch as Phase74ModelUsageBranch) &&
    typeof event.caseId === "string" && event.caseId.length > 0 &&
    typeof event.requestId === "string" && event.requestId.length > 0 &&
    (event.completeness === "complete" ||
      event.completeness === "missing" || event.completeness === "partial") &&
    typeof event.modelId === "string" && event.modelId.length > 0 &&
    typeof event.operation === "string" &&
    PHASE74_USAGE_OPERATIONS.has(event.operation as ModelUsageOperation) &&
    (event.outcome === "failed" || event.outcome === "succeeded") &&
    (event.recovery === undefined ||
      event.recovery === "interrupted_before_terminal") &&
    typeof event.providerId === "string" && event.providerId.length > 0 &&
    event.schemaVersion === 1 && usage !== null && typeof usage === "object" &&
    !Array.isArray(usage) && [
      "cacheCreationInputTokens",
      "cacheReadInputTokens",
      "inputTokens",
      "outputTokens",
      "uncachedInputTokens",
    ].every((key) => isUsageTokenCount((usage as Record<string, unknown>)[key]));
}

function isAttributedModelUsageIntent(
  value: unknown,
): value is AttributedModelUsageIntent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const intent = value as Record<string, unknown>;
  return Number.isSafeInteger(intent.attempt) && Number(intent.attempt) > 0 &&
    typeof intent.branch === "string" &&
    PHASE74_USAGE_BRANCHES.has(intent.branch as Phase74ModelUsageBranch) &&
    typeof intent.caseId === "string" && intent.caseId.length > 0 &&
    typeof intent.modelId === "string" && intent.modelId.length > 0 &&
    typeof intent.operation === "string" &&
    PHASE74_USAGE_OPERATIONS.has(intent.operation as ModelUsageOperation) &&
    typeof intent.providerId === "string" && intent.providerId.length > 0 &&
    typeof intent.requestId === "string" && intent.requestId.length > 0 &&
    intent.schemaVersion === 1;
}

async function loadJsonLines<T>(input: {
  isValue(value: unknown): value is T;
  label: string;
  path: string;
}): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(input.path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return raw.split("\n").filter(Boolean).map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(
        `Invalid Phase 74 ${input.label} JSON at line ${index + 1}.`,
      );
    }
    if (!input.isValue(value)) {
      throw new Error(
        `Invalid Phase 74 ${input.label} at line ${index + 1}.`,
      );
    }
    return value;
  });
}

export async function loadPhase74ModelUsageEvents(
  path: string,
): Promise<AttributedModelUsageAttempt[]> {
  return loadJsonLines({
    isValue: isAttributedModelUsageAttempt,
    label: "model usage event",
    path,
  });
}

export async function loadPhase74ModelUsageIntents(
  path: string,
): Promise<AttributedModelUsageIntent[]> {
  return loadJsonLines({
    isValue: isAttributedModelUsageIntent,
    label: "model usage intent",
    path,
  });
}

export function validatePhase74ModelUsageLedger(input: {
  events: readonly AttributedModelUsageAttempt[];
  intents: readonly AttributedModelUsageIntent[];
}): Phase74ModelUsageLedger {
  const intentsById = new Map<string, AttributedModelUsageIntent>();
  for (const intent of input.intents) {
    if (intentsById.has(intent.requestId)) {
      throw new Error(
        `Phase 74 model usage duplicate intent requestId ${intent.requestId}.`,
      );
    }
    intentsById.set(intent.requestId, intent);
  }
  const terminalIds = new Set<string>();
  for (const event of input.events) {
    if (terminalIds.has(event.requestId)) {
      throw new Error(
        `Phase 74 model usage duplicate terminal requestId ${event.requestId}.`,
      );
    }
    terminalIds.add(event.requestId);
    const intent = intentsById.get(event.requestId);
    if (!intent) {
      throw new Error(
        `Phase 74 model usage terminal without intent ${event.requestId}.`,
      );
    }
    if (
      intent.attempt !== event.attempt ||
      intent.branch !== event.branch ||
      intent.caseId !== event.caseId ||
      intent.modelId !== event.modelId ||
      intent.operation !== event.operation ||
      intent.providerId !== event.providerId
    ) {
      throw new Error(
        `Phase 74 model usage terminal drift for requestId ${event.requestId}.`,
      );
    }
    if (modelUsageCompleteness(event.usage) !== event.completeness) {
      throw new Error(
        `Phase 74 model usage terminal completeness drift for requestId ${event.requestId}.`,
      );
    }
  }
  return {
    events: [...input.events],
    intents: [...input.intents],
    pendingIntents: input.intents.filter(
      ({ requestId }) => !terminalIds.has(requestId),
    ),
  };
}

export async function loadPhase74ModelUsageLedger(input: {
  eventsPath: string;
  intentsPath: string;
}): Promise<Phase74ModelUsageLedger> {
  const [events, intents] = await Promise.all([
    loadPhase74ModelUsageEvents(input.eventsPath),
    loadPhase74ModelUsageIntents(input.intentsPath),
  ]);
  return validatePhase74ModelUsageLedger({ events, intents });
}

interface Phase74ModelUsageAppendDependencies {
  close(fd: number): void;
  fsync(fd: number): void;
  open(path: string, flags: "a" | "r"): number;
  write(fd: number, value: string): void;
}

const DEFAULT_APPEND_DEPENDENCIES: Phase74ModelUsageAppendDependencies = {
  close: closeSync,
  fsync: fsyncSync,
  open: (path, flags) => openSync(path, flags),
  write: (fd, value) => writeFileSync(fd, value, "utf8"),
};

function appendPhase74ModelUsageLineSync(
  path: string,
  value: string,
  dependencies: Phase74ModelUsageAppendDependencies,
): void {
  const fd = dependencies.open(path, "a");
  try {
    dependencies.write(fd, `${value}\n`);
    dependencies.fsync(fd);
  } finally {
    dependencies.close(fd);
  }

  const directory = dependencies.open(dirname(path), "r");
  try {
    dependencies.fsync(directory);
  } finally {
    dependencies.close(directory);
  }
}

export function appendPhase74ModelUsageEventSync(
  path: string,
  event: AttributedModelUsageAttempt,
  dependencies: Phase74ModelUsageAppendDependencies =
    DEFAULT_APPEND_DEPENDENCIES,
): void {
  appendPhase74ModelUsageLineSync(path, JSON.stringify(event), dependencies);
}

export function appendPhase74ModelUsageIntentSync(
  path: string,
  intent: AttributedModelUsageIntent,
  dependencies: Phase74ModelUsageAppendDependencies =
    DEFAULT_APPEND_DEPENDENCIES,
): void {
  appendPhase74ModelUsageLineSync(path, JSON.stringify(intent), dependencies);
}

export function reconcilePhase74PendingModelUsageSync(input: {
  eventsPath: string;
  ledger: Phase74ModelUsageLedger;
}): Phase74ModelUsageLedger {
  if (input.ledger.pendingIntents.length === 0) {
    return validatePhase74ModelUsageLedger(input.ledger);
  }
  const events = [...input.ledger.events];
  for (const intent of input.ledger.pendingIntents) {
    const event: AttributedModelUsageAttempt = {
      ...intent,
      completeness: "missing",
      outcome: "failed",
      recovery: "interrupted_before_terminal",
      usage: {
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
        inputTokens: null,
        outputTokens: null,
        uncachedInputTokens: null,
      },
    };
    appendPhase74ModelUsageEventSync(input.eventsPath, event);
    events.push(event);
  }
  return validatePhase74ModelUsageLedger({
    events,
    intents: input.ledger.intents,
  });
}

export function createAttributedModelUsageSink(input: {
  branch: Phase74ModelUsageBranch;
  caseId: string;
  createRequestId?: () => string;
  events: AttributedModelUsageAttempt[];
  intents: AttributedModelUsageIntent[];
  onEvent?: (event: AttributedModelUsageAttempt) => void;
  onIntent?: (intent: AttributedModelUsageIntent) => void;
}): ModelUsageSink {
  const begin = (intent: ModelUsageIntent) => {
    const attributedIntent = {
      ...intent,
      branch: input.branch,
      caseId: input.caseId,
      requestId: input.createRequestId?.() ?? randomUUID(),
    };
    input.onIntent?.(attributedIntent);
    input.intents.push(attributedIntent);
    return (event: ModelUsageAttempt) => {
      const attributed = {
        ...event,
        branch: input.branch,
        caseId: input.caseId,
        requestId: attributedIntent.requestId,
        usage: { ...event.usage },
      };
      input.onEvent?.(attributed);
      input.events.push(attributed);
    };
  };
  return {
    begin,
    emit(event) {
      begin({
        attempt: event.attempt,
        modelId: event.modelId,
        operation: event.operation,
        providerId: event.providerId,
        schemaVersion: event.schemaVersion,
      })(event);
    },
    strict: true,
  };
}

export interface Phase74IngestionUsageLedger {
  key: string;
  ledger: Phase74ModelUsageLedger;
}

export interface BuildPhase74ModelUsageEvidenceInput {
  direct: Phase74ModelUsageLedger;
  expected: {
    baselineCaseIds: readonly string[];
    candidateCaseIds: readonly string[];
  };
  ingestion: {
    baselineExclusive: readonly Phase74IngestionUsageLedger[];
    candidateExclusive: readonly Phase74IngestionUsageLedger[];
    shared: readonly Phase74IngestionUsageLedger[];
  };
}

function countOperations(
  intents: readonly Pick<AttributedModelUsageIntent, "operation">[],
): Phase74ModelUsageBranchEvidence["operationCounts"] {
  const counts: Partial<Record<ModelUsageOperation, number>> = {};
  for (const intent of intents) {
    counts[intent.operation] = (counts[intent.operation] ?? 0) + 1;
  }
  return counts;
}

function addOperationCounts(
  ...counts: readonly Phase74ModelUsageBranchEvidence["operationCounts"][]
): Phase74ModelUsageBranchEvidence["operationCounts"] {
  const combined: Partial<Record<ModelUsageOperation, number>> = {};
  for (const entries of counts) {
    for (const [operation, count] of Object.entries(entries)) {
      const key = operation as ModelUsageOperation;
      combined[key] = (combined[key] ?? 0) + (count ?? 0);
    }
  }
  return combined;
}

function aggregatePool(
  entries: readonly Phase74IngestionUsageLedger[],
): Phase74ModelUsagePoolEvidence {
  const keys = entries.map(({ key }) => key).sort();
  if (new Set(keys).size !== keys.length) {
    throw new Error("Phase 74 ingestion usage allocation contains duplicate keys.");
  }
  const ledgers = entries.map(({ key, ledger }) => {
    const validated = validatePhase74ModelUsageLedger(ledger);
    if (validated.intents.length === 0) {
      throw new Error(`Phase 74 ingestion key ${key} has no model requests.`);
    }
    if (validated.pendingIntents.length > 0) {
      throw new Error(`Phase 74 ingestion key ${key} has pending requests.`);
    }
    if (!validated.intents.some(
      ({ operation }) => operation === "assisted_extraction"
    )) {
      throw new Error(
        `Phase 74 ingestion key ${key} has no assisted extraction request.`,
      );
    }
    return validated;
  });
  const intents = ledgers.flatMap(({ intents }) => intents);
  const events = ledgers.flatMap(({ events }) => events);
  if (intents.some(({ branch }) => branch !== "shadow")) {
    throw new Error("Phase 74 ingestion usage must originate from the shadow branch.");
  }
  return {
    completeRequestCount: events.filter(
      ({ completeness }) => completeness === "complete",
    ).length,
    keyCount: keys.length,
    keysSha256: createHash("sha256")
      .update(JSON.stringify(keys))
      .digest("hex"),
    missingRequestCount: events.filter(
      ({ completeness }) => completeness === "missing",
    ).length,
    operationCounts: countOperations(intents),
    partialRequestCount: events.filter(
      ({ completeness }) => completeness === "partial",
    ).length,
    pendingRequestCount: ledgers.reduce(
      (total, { pendingIntents }) => total + pendingIntents.length,
      0,
    ),
    requestCount: intents.length,
    totalTokens: events.reduce(
      (total, event) => total + (modelTokenTotal(event.usage) ?? 0),
      0,
    ),
  };
}

function aggregateDirectBranch(
  ledger: Phase74ModelUsageLedger,
  branch: "baseline" | "candidate",
  expectedCaseIds?: readonly string[],
): Phase74ModelUsageBranchEvidence {
  const selectedIntents = ledger.intents.filter(
    (intent) => intent.branch === branch,
  );
  const selectedEvents = ledger.events.filter(
    (event) => event.branch === branch,
  );
  const observedCaseIds = new Set(
    selectedIntents.map(({ caseId }) => caseId),
  );
  const answeredCaseIds = new Set(
    selectedEvents
      .filter(({ operation }) => operation === "answer_generation")
      .map(({ caseId }) => caseId),
  );
  if (expectedCaseIds !== undefined) {
    const expected = new Set(expectedCaseIds);
    if (expected.size !== expectedCaseIds.length) {
      throw new Error(`${branch} model usage expected case IDs must be unique.`);
    }
    const unexpected = [...observedCaseIds].filter((caseId) => !expected.has(caseId));
    if (unexpected.length > 0) {
      throw new Error(
        `${branch} model usage contains unexpected case(s): ${unexpected.join(", ")}`,
      );
    }
  }
  if (selectedIntents.some(({ operation }) => operation === "judge")) {
    throw new Error(`${branch} product usage must not include judge operations.`);
  }
  const caseIds = expectedCaseIds === undefined
    ? [...observedCaseIds].sort()
    : [...expectedCaseIds].sort();
  return {
    answerGenerationCaseCount: answeredCaseIds.size,
    caseIdsSha256: createHash("sha256")
      .update(JSON.stringify(caseIds))
      .digest("hex"),
    completeRequestCount: selectedEvents.filter(
      ({ completeness }) => completeness === "complete",
    ).length,
    logicalCaseCount: expectedCaseIds?.length ?? observedCaseIds.size,
    missingRequestCount: selectedEvents.filter(
      ({ completeness }) => completeness === "missing",
    ).length,
    operationCounts: countOperations(selectedIntents),
    partialRequestCount: selectedEvents.filter(
      ({ completeness }) => completeness === "partial",
    ).length,
    pendingRequestCount: ledger.pendingIntents.filter(
      (intent) => intent.branch === branch,
    ).length,
    requestCount: selectedIntents.length,
    totalTokens: selectedEvents.reduce(
      (total, event) => total + (modelTokenTotal(event.usage) ?? 0),
      0,
    ),
    unobservedCaseIds: expectedCaseIds?.filter(
      (caseId) => !answeredCaseIds.has(caseId),
    ) ?? [],
  };
}

function addPoolsToBranch(
  direct: Phase74ModelUsageBranchEvidence,
  ...pools: readonly Phase74ModelUsagePoolEvidence[]
): Phase74ModelUsageBranchEvidence {
  return {
    ...direct,
    completeRequestCount: direct.completeRequestCount + pools.reduce(
      (total, pool) => total + pool.completeRequestCount,
      0,
    ),
    missingRequestCount: direct.missingRequestCount + pools.reduce(
      (total, pool) => total + pool.missingRequestCount,
      0,
    ),
    operationCounts: addOperationCounts(
      direct.operationCounts,
      ...pools.map(({ operationCounts }) => operationCounts),
    ),
    partialRequestCount: direct.partialRequestCount + pools.reduce(
      (total, pool) => total + pool.partialRequestCount,
      0,
    ),
    pendingRequestCount: direct.pendingRequestCount + pools.reduce(
      (total, pool) => total + pool.pendingRequestCount,
      0,
    ),
    requestCount: direct.requestCount + pools.reduce(
      (total, pool) => total + pool.requestCount,
      0,
    ),
    totalTokens: direct.totalTokens + pools.reduce(
      (total, pool) => total + pool.totalTokens,
      0,
    ),
  };
}

export function buildPhase74ModelUsageEvidence(
  input: BuildPhase74ModelUsageEvidenceInput,
): Phase74ModelUsageEvidence {
  const direct = validatePhase74ModelUsageLedger(input.direct);
  const ingestion = input.ingestion;
  const allKeys = [
    ...ingestion.baselineExclusive,
    ...ingestion.candidateExclusive,
    ...ingestion.shared,
  ].map(({ key }) => key);
  if (new Set(allKeys).size !== allKeys.length) {
    throw new Error("Phase 74 ingestion usage allocation pools overlap.");
  }
  const baselineExclusive = aggregatePool(ingestion.baselineExclusive);
  const candidateExclusive = aggregatePool(ingestion.candidateExclusive);
  const shared = aggregatePool(ingestion.shared);
  return {
    accountingVersion: PHASE74_MODEL_USAGE_ACCOUNTING_VERSION,
    allocationPolicy: PHASE74_MODEL_USAGE_ALLOCATION_POLICY,
    baseline: addPoolsToBranch(
      aggregateDirectBranch(
        direct,
        "baseline",
        input.expected.baselineCaseIds,
      ),
      baselineExclusive,
      shared,
    ),
    candidate: addPoolsToBranch(
      aggregateDirectBranch(
        direct,
        "candidate",
        input.expected.candidateCaseIds,
      ),
      candidateExclusive,
      shared,
    ),
    costBoundary: "full-product",
    ingestion: {
      baselineExclusive,
      candidateExclusive,
      shared,
    },
  };
}
