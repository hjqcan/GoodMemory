import type {
  BuildContextInput,
  BuildContextResult,
  ExportMemoryResult,
  FeedbackResult,
  ForgetResult,
  GoodMemory,
  MemoryWriteJob,
  RecallInput,
  RecallResult,
  RememberInput,
  RememberResult,
  ReviseMemoryEvidenceSource,
  ReviseMemoryInput,
  ReviseMemoryReason,
  ReviseMemoryResult,
} from "../api/contracts";
import type { MemoryScope } from "../domain/scope";
import { isIanaTimezone, isRfc3339Instant } from "../domain/temporal";
import type { TemporalInterval } from "../domain/temporal";
import type { RememberConfig } from "../remember/profiles";
import { isProviderBackedRecallError } from "../recall/errors";
import { inspectGoodMemoryRuntime } from "../api/runtimeInfo";
import { buildGoodMemoryCapabilityDescriptor } from "../api/capabilityDescriptor";
import {
  resolveRecallRoutingWarningMessages,
  SEMANTIC_RECALL_INACTIVE_WARNING,
} from "../recall/router";

export const GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION =
  "phase-39.http-memory.v1";

export type GoodMemoryHttpBridgeOperation =
  | "recall-context"
  | "remember"
  | "feedback"
  | "forget"
  | "export"
  | "revise";

export interface GoodMemoryHttpBridgeCaller {
  authorizedOperations: GoodMemoryHttpBridgeOperation[] | "*";
  tenantId?: string;
  userId: string;
  workspaceId?: string;
}

export interface GoodMemoryHttpBridgeAuthorizationInput {
  body: Record<string, unknown>;
  caller: GoodMemoryHttpBridgeCaller | null;
  operation: GoodMemoryHttpBridgeOperation;
  request: Request;
  scope: MemoryScope;
  sensitive: boolean;
}

export interface GoodMemoryHttpBridgeAuthorizationResult {
  authorized: boolean;
  code?: string;
  message?: string;
  statusCode?: 401 | 403;
}

export interface CreateGoodMemoryHttpMemoryBridgeInput {
  authorize?(
    input: GoodMemoryHttpBridgeAuthorizationInput,
  ): GoodMemoryHttpBridgeAuthorizationResult | Promise<GoodMemoryHttpBridgeAuthorizationResult>;
  // Extra string fields echoed by GET /healthz (e.g. the serving profile).
  // Reserved fields (ok/status/contractVersion) cannot be overridden. Omit to
  // keep the healthz body minimal in hardened deployments.
  healthMetadata?: Record<string, string>;
  memory: GoodMemory;
  resolveCaller?(
    request: Request,
    body?: Record<string, unknown>,
  ): GoodMemoryHttpBridgeCaller | null;
}

export interface GoodMemoryHttpHealthzResponse {
  [key: string]: unknown;
  contractVersion: string;
  ok: true;
  status: "ok";
}

export interface GoodMemoryHttpBridgeErrorBody {
  error: {
    code: string;
    message: string;
  };
  ok: false;
}

export interface GoodMemoryHttpMemoryItem {
  category?: string;
  confidence?: number;
  content: string;
  memoryId: string;
  occurrence?: TemporalInterval;
  source: "goodmemory";
  tags?: string[];
  type:
    | "profile"
    | "preference"
    | "reference"
    | "fact"
    | "feedback"
    | "episode"
    | "working_memory"
    | "session_journal";
}

type GoodMemoryHttpRecallFallbackReason =
  | NonNullable<
      RecallResult["metadata"]["routingDecision"]["strategyExplanation"]["fallbackReason"]
    >
  | "provider_error";

export interface GoodMemoryHttpRecallProviderFallback {
  reason: "provider_error";
  recoveredStrategy: "rules-only";
}

export interface GoodMemoryHttpRecallRoutingDiagnostics {
  fallbackReason?: GoodMemoryHttpRecallFallbackReason;
  llmRefinement: boolean;
  providerFallback?: GoodMemoryHttpRecallProviderFallback;
  requestedStrategy: NonNullable<RecallInput["strategy"]>;
  resolvedStrategy: NonNullable<RecallInput["strategy"]>;
  semanticTieBreaking: boolean;
  // Non-fatal degradation codes (present only when non-empty): recall ran below
  // the configured/requested intent, e.g. "semantic_recall_inactive" when a
  // recommended preset or hybrid request silently fell to the lexical floor.
  warnings?: string[];
  // Human-readable companion to warnings for HTTP clients and agent hosts.
  warningMessages?: string[];
}

export interface GoodMemoryHttpRecallContextResponse {
  context: Pick<
    BuildContextResult,
    "content" | "estimatedTokens" | "omittedSections" | "output"
  >;
  contextText: string;
  contractVersion: typeof GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION;
  hasContext: boolean;
  itemCount: number;
  items: GoodMemoryHttpMemoryItem[];
  ok: true;
  operation: "recall-context";
  routing: GoodMemoryHttpRecallRoutingDiagnostics;
  traceId?: string;
}

export interface GoodMemoryHttpBridgeLooseBody {
  [key: string]: unknown;
  contractVersion?: string;
  contextText?: string;
  error?: GoodMemoryHttpBridgeErrorBody["error"];
  exported?: Partial<ExportMemoryResult>;
  hasContext?: boolean;
  idempotency?: {
    handledBy:
      | "consumer_provenance_only"
      | "goodmemory_jobs"
      | "goodmemory_revision"
      | "none";
    key?: string;
  };
  includeRuntime?: boolean;
  itemCount?: number;
  items?: GoodMemoryHttpMemoryItem[];
  job?: MemoryWriteJob;
  mode?: "async" | "sync";
  ok?: boolean;
  operation?: GoodMemoryHttpBridgeOperation;
  provenance?: Record<string, unknown>;
  result?: FeedbackResult | ForgetResult | RememberResult | ReviseMemoryResult;
  routing?: GoodMemoryHttpRecallRoutingDiagnostics;
  traceId?: string;
}

export type GoodMemoryHttpBridgeBody =
  | GoodMemoryHttpBridgeErrorBody
  | GoodMemoryHttpBridgeLooseBody
  | GoodMemoryHttpRecallContextResponse;

export interface GoodMemoryHttpBridgeResult {
  body: GoodMemoryHttpBridgeLooseBody;
  statusCode: number;
}

export interface GoodMemoryHttpMemoryBridge {
  fetch(request: Request): Promise<Response>;
  handle(request: Request): Promise<GoodMemoryHttpBridgeResult>;
}

export interface OneLifeMemoryContextResponse {
  context: string;
  memories: Array<{
    id: string;
    kind: GoodMemoryHttpMemoryItem["type"];
    source: "goodmemory-http-bridge";
    text: string;
  }>;
  metadata: {
    hasContext: boolean;
    itemCount: number;
    policyBoundary: "product_owned";
    source: "goodmemory-http-bridge";
    traceId?: string;
  };
}

type ValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      code: string;
      message: string;
      ok: false;
    };

const SENSITIVE_OPERATIONS = new Set<GoodMemoryHttpBridgeOperation>([
  "export",
  "forget",
  "revise",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  return isNonEmptyString(value) ? value.trim() : undefined;
}

function validateScope(value: unknown): ValidationResult<MemoryScope> {
  if (!isRecord(value) || !isNonEmptyString(value.userId)) {
    return {
      code: "invalid_scope",
      message: "Expected scope.userId and optional string tenant/workspace/agent/session fields.",
      ok: false,
    };
  }
  for (const key of ["tenantId", "workspaceId", "agentId", "sessionId"] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      return {
        code: "invalid_scope",
        message: "Expected scope.userId and optional string tenant/workspace/agent/session fields.",
        ok: false,
      };
    }
  }

  const scope: MemoryScope = {
    userId: value.userId.trim(),
  };
  const tenantId = optionalString(value, "tenantId");
  const workspaceId = optionalString(value, "workspaceId");
  const agentId = optionalString(value, "agentId");
  const sessionId = optionalString(value, "sessionId");

  if (tenantId) {
    scope.tenantId = tenantId;
  }
  if (workspaceId) {
    scope.workspaceId = workspaceId;
  }
  if (agentId) {
    scope.agentId = agentId;
  }
  if (sessionId) {
    scope.sessionId = sessionId;
  }

  return { ok: true, value: scope };
}

function validateMessages(
  value: unknown,
): ValidationResult<RememberInput["messages"]> {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      code: "invalid_messages",
      message: "Expected messages to be a non-empty array.",
      ok: false,
    };
  }

  const messages: RememberInput["messages"] = [];
  for (const message of value) {
    if (
      !isRecord(message) ||
      !isNonEmptyString(message.role) ||
      !isNonEmptyString(message.content) ||
      (message.id !== undefined && typeof message.id !== "string") ||
      (message.observedAt !== undefined &&
        typeof message.observedAt !== "string") ||
      (message.timezone !== undefined && typeof message.timezone !== "string")
    ) {
      return {
        code: "invalid_messages",
        message: "Expected every message to include role and content string fields.",
        ok: false,
      };
    }

    if (
      (typeof message.observedAt === "string" &&
        !isRfc3339Instant(message.observedAt)) ||
      (typeof message.timezone === "string" &&
        !isIanaTimezone(message.timezone))
    ) {
      return {
        code: "invalid_temporal_context",
        message:
          "Expected observedAt to be an RFC 3339 instant and timezone to be an IANA timezone when provided.",
        ok: false,
      };
    }

    messages.push({
      content: message.content,
      role: message.role,
      ...(typeof message.id === "string" ? { id: message.id } : {}),
      ...(typeof message.observedAt === "string"
        ? { observedAt: message.observedAt }
        : {}),
      ...(typeof message.timezone === "string"
        ? { timezone: message.timezone }
        : {}),
    });
  }

  return { ok: true, value: messages };
}

function validateOptionalTemporalString(
  body: Record<string, unknown>,
  field: "referenceTime" | "timezone",
): ValidationResult<string | undefined> {
  const value = body[field];
  if (value === undefined) {
    return { ok: true, value };
  }

  if (
    typeof value === "string" &&
    (field === "referenceTime"
      ? isRfc3339Instant(value)
      : isIanaTimezone(value))
  ) {
    return { ok: true, value };
  }

  return {
    code: "invalid_temporal_context",
    message:
      field === "referenceTime"
        ? "Expected referenceTime to be an RFC 3339 instant when provided."
        : "Expected timezone to be an IANA timezone when provided.",
    ok: false,
  };
}

function isValidMemoryAttributeValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isValidAnnotationKindHint(
  value: unknown,
): value is NonNullable<RememberInput["annotations"]>[number]["kindHint"] {
  return (
    value === "profile" ||
    value === "preference" ||
    value === "reference" ||
    value === "fact" ||
    value === "feedback"
  );
}

function isValidRememberMode(
  value: unknown,
): value is NonNullable<RememberInput["annotations"]>[number]["remember"] {
  return value === "always" || value === "never" || value === "auto";
}

function isValidFactKind(
  value: unknown,
): value is NonNullable<
  NonNullable<RememberInput["annotations"]>[number]["metadataPatch"]
>["factKind"] {
  return (
    value === "blocker" ||
    value === "open_loop" ||
    value === "role_update" ||
    value === "focus_update" ||
    value === "project_state" ||
    value === "generic_project"
  );
}

function isValidScopeKind(
  value: unknown,
): value is NonNullable<
  NonNullable<RememberInput["annotations"]>[number]["metadataPatch"]
>["scopeKind"] {
  return (
    value === "identity" ||
    value === "project" ||
    value === "runtime" ||
    value === "reference" ||
    value === "preference"
  );
}

function isValidFeedbackKind(
  value: unknown,
): value is NonNullable<
  NonNullable<RememberInput["annotations"]>[number]["metadataPatch"]
>["feedbackKind"] {
  return (
    value === "do" ||
    value === "dont" ||
    value === "prefer" ||
    value === "validated_pattern"
  );
}

function isValidProfileField(
  value: unknown,
): value is NonNullable<
  NonNullable<RememberInput["annotations"]>[number]["metadataPatch"]
>["profileField"] {
  return (
    value === "name" ||
    value === "role" ||
    value === "organization" ||
    value === "location" ||
    value === "timezone" ||
    value === "languagePreference" ||
    value === "currentProject"
  );
}

function isValidReferenceKind(
  value: unknown,
): value is NonNullable<
  NonNullable<RememberInput["annotations"]>[number]["metadataPatch"]
>["referenceKind"] {
  return (
    value === "source_of_truth" ||
    value === "runbook" ||
    value === "doc" ||
    value === "dashboard" ||
    value === "tracker"
  );
}

function validateMetadataPatch(
  value: unknown,
): ValidationResult<NonNullable<RememberInput["annotations"]>[number]["metadataPatch"]> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) {
    return {
      code: "invalid_annotations",
      message: "Expected annotation.metadataPatch to be an object when provided.",
      ok: false,
    };
  }

  for (const key of [
    "category",
    "factKind",
    "scopeKind",
    "subject",
    "feedbackKind",
    "appliesTo",
    "profileField",
    "preferenceCategory",
    "preferenceValue",
    "referenceKind",
    "referenceTitle",
    "referencePointer",
    "supersedesPointer",
  ] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.metadataPatch string fields to be non-empty strings.",
        ok: false,
      };
    }
  }

  if (value.factKind !== undefined && !isValidFactKind(value.factKind)) {
    return {
      code: "invalid_annotations",
      message: "Expected annotation.metadataPatch.factKind to be a supported fact kind.",
      ok: false,
    };
  }
  if (value.scopeKind !== undefined && !isValidScopeKind(value.scopeKind)) {
    return {
      code: "invalid_annotations",
      message: "Expected annotation.metadataPatch.scopeKind to be a supported scope kind.",
      ok: false,
    };
  }
  if (value.feedbackKind !== undefined && !isValidFeedbackKind(value.feedbackKind)) {
    return {
      code: "invalid_annotations",
      message: "Expected annotation.metadataPatch.feedbackKind to be a supported feedback kind.",
      ok: false,
    };
  }
  if (value.profileField !== undefined && !isValidProfileField(value.profileField)) {
    return {
      code: "invalid_annotations",
      message: "Expected annotation.metadataPatch.profileField to be a supported profile field.",
      ok: false,
    };
  }
  if (value.referenceKind !== undefined && !isValidReferenceKind(value.referenceKind)) {
    return {
      code: "invalid_annotations",
      message: "Expected annotation.metadataPatch.referenceKind to be a supported reference kind.",
      ok: false,
    };
  }

  if (
    value.tags !== undefined &&
    (!Array.isArray(value.tags) || !value.tags.every(isNonEmptyString))
  ) {
    return {
      code: "invalid_annotations",
      message: "Expected annotation.metadataPatch.tags to be an array of non-empty strings.",
      ok: false,
    };
  }

  if (value.attributes !== undefined) {
    if (!isRecord(value.attributes)) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.metadataPatch.attributes to be an object.",
        ok: false,
      };
    }
    for (const attributeValue of Object.values(value.attributes)) {
      if (!isValidMemoryAttributeValue(attributeValue)) {
        return {
          code: "invalid_annotations",
          message: "Expected annotation.metadataPatch.attributes values to be string, number, boolean, or null.",
          ok: false,
        };
      }
    }
  }
  const attributes:
    | NonNullable<
        NonNullable<RememberInput["annotations"]>[number]["metadataPatch"]
      >["attributes"]
    | undefined = isRecord(value.attributes)
    ? Object.fromEntries(
        Object.entries(value.attributes).filter((entry): entry is [
          string,
          string | number | boolean | null,
        ] => isValidMemoryAttributeValue(entry[1])),
      )
    : undefined;

  return {
    ok: true,
    value: {
      ...(isNonEmptyString(value.category) ? { category: value.category } : {}),
      ...(isValidFactKind(value.factKind) ? { factKind: value.factKind } : {}),
      ...(isValidScopeKind(value.scopeKind) ? { scopeKind: value.scopeKind } : {}),
      ...(isNonEmptyString(value.subject) ? { subject: value.subject } : {}),
      ...(Array.isArray(value.tags) ? { tags: [...value.tags] } : {}),
      ...(attributes !== undefined ? { attributes } : {}),
      ...(isValidFeedbackKind(value.feedbackKind)
        ? { feedbackKind: value.feedbackKind }
        : {}),
      ...(isNonEmptyString(value.appliesTo) ? { appliesTo: value.appliesTo } : {}),
      ...(isValidProfileField(value.profileField)
        ? { profileField: value.profileField }
        : {}),
      ...(isNonEmptyString(value.preferenceCategory)
        ? { preferenceCategory: value.preferenceCategory }
        : {}),
      ...(isNonEmptyString(value.preferenceValue)
        ? { preferenceValue: value.preferenceValue }
        : {}),
      ...(isValidReferenceKind(value.referenceKind)
        ? { referenceKind: value.referenceKind }
        : {}),
      ...(isNonEmptyString(value.referenceTitle)
        ? { referenceTitle: value.referenceTitle }
        : {}),
      ...(isNonEmptyString(value.referencePointer)
        ? { referencePointer: value.referencePointer }
        : {}),
      ...(isNonEmptyString(value.supersedesPointer)
        ? { supersedesPointer: value.supersedesPointer }
        : {}),
    },
  };
}

function validateAnnotations(
  value: unknown,
): ValidationResult<RememberInput["annotations"] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (!Array.isArray(value)) {
    return {
      code: "invalid_annotations",
      message: "Expected annotations to be an array when provided.",
      ok: false,
    };
  }

  const annotations: NonNullable<RememberInput["annotations"]> = [];
  for (const annotation of value) {
    if (!isRecord(annotation)) {
      return {
        code: "invalid_annotations",
        message: "Expected every annotation to be an object.",
        ok: false,
      };
    }
    const messageIndex = annotation.messageIndex;
    if (typeof messageIndex !== "number" || !Number.isInteger(messageIndex)) {
      return {
        code: "invalid_annotations",
        message: "Expected every annotation to include integer messageIndex.",
        ok: false,
      };
    }
    if (messageIndex < 0) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.messageIndex to be non-negative.",
        ok: false,
      };
    }
    if (
      annotation.remember !== undefined &&
      !isValidRememberMode(annotation.remember)
    ) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.remember to be always, never, or auto.",
        ok: false,
      };
    }
    if (
      annotation.kindHint !== undefined &&
      !isValidAnnotationKindHint(annotation.kindHint)
    ) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.kindHint to be profile, preference, reference, fact, or feedback.",
        ok: false,
      };
    }
    if (
      annotation.confirmed !== undefined &&
      typeof annotation.confirmed !== "boolean"
    ) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.confirmed to be a boolean when provided.",
        ok: false,
      };
    }
    if (
      annotation.verified !== undefined &&
      typeof annotation.verified !== "boolean"
    ) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.verified to be a boolean when provided.",
        ok: false,
      };
    }
    if (annotation.reason !== undefined && !isNonEmptyString(annotation.reason)) {
      return {
        code: "invalid_annotations",
        message: "Expected annotation.reason to be a non-empty string when provided.",
        ok: false,
      };
    }

    const metadataPatch = validateMetadataPatch(annotation.metadataPatch);
    if (!metadataPatch.ok) {
      return metadataPatch;
    }

    annotations.push({
      messageIndex,
      ...(annotation.remember !== undefined ? { remember: annotation.remember } : {}),
      ...(annotation.kindHint !== undefined ? { kindHint: annotation.kindHint } : {}),
      ...(metadataPatch.value !== undefined
        ? { metadataPatch: metadataPatch.value }
        : {}),
      ...(annotation.confirmed !== undefined
        ? { confirmed: annotation.confirmed }
        : {}),
      ...(annotation.verified !== undefined ? { verified: annotation.verified } : {}),
      ...(isNonEmptyString(annotation.reason) ? { reason: annotation.reason } : {}),
    });
  }

  return { ok: true, value: annotations };
}

function validateRetrievalProfile(
  value: unknown,
): ValidationResult<"coding_agent" | "general_chat" | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (value === "coding_agent" || value === "general_chat") {
    return { ok: true, value };
  }

  return {
    code: "invalid_retrieval_profile",
    message: "Expected retrievalProfile to be general_chat or coding_agent.",
    ok: false,
  };
}

function validateRecallStrategy(
  value: unknown,
): ValidationResult<RecallInput["strategy"]> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (
    value === "auto" ||
    value === "rules-only" ||
    value === "hybrid"
  ) {
    return { ok: true, value };
  }

  return {
    code: "invalid_recall_strategy",
    message: "Expected strategy to be auto, rules-only, or hybrid.",
    ok: false,
  };
}

function validateContextOutput(
  value: unknown,
): ValidationResult<BuildContextInput["output"]> {
  if (value === undefined) {
    return { ok: true, value: "system_prompt_fragment" };
  }
  if (
    value === "json" ||
    value === "markdown" ||
    value === "system_prompt_fragment" ||
    value === "developer_prompt_fragment"
  ) {
    return { ok: true, value };
  }

  return {
    code: "invalid_context_output",
    message: "Expected output to be json, markdown, system_prompt_fragment, or developer_prompt_fragment.",
    ok: false,
  };
}

function validateExtractionStrategy(
  value: unknown,
): ValidationResult<RememberInput["extractionStrategy"]> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (value === "auto" || value === "rules-only" || value === "llm-assisted") {
    return { ok: true, value };
  }

  return {
    code: "invalid_extraction_strategy",
    message: "Expected extractionStrategy to be auto, rules-only, or llm-assisted.",
    ok: false,
  };
}

function validateIdempotencyKey(
  value: unknown,
  required: boolean,
): ValidationResult<string | undefined> {
  if (value === undefined && !required) {
    return { ok: true, value: undefined };
  }

  if (isNonEmptyString(value)) {
    return { ok: true, value: value.trim() };
  }

  return {
    code: "invalid_idempotency_key",
    message: "Expected a non-empty idempotencyKey string.",
    ok: false,
  };
}

function validateEvidence(
  value: unknown,
): ValidationResult<ReviseMemoryInput["evidence"]> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (!isRecord(value)) {
    return {
      code: "invalid_evidence",
      message: "Expected evidence to be an object when provided.",
      ok: false,
    };
  }
  if (
    value.source !== "user_message" &&
    value.source !== "manual_review" &&
    value.source !== "system"
  ) {
    return {
      code: "invalid_evidence",
      message: "Expected evidence.source to be user_message, manual_review, or system.",
      ok: false,
    };
  }

  return {
    ok: true,
    value: {
      source: value.source as ReviseMemoryEvidenceSource,
      ...(isNonEmptyString(value.message) ? { message: value.message } : {}),
      ...(isNonEmptyString(value.excerpt) ? { excerpt: value.excerpt } : {}),
      ...(isNonEmptyString(value.sourceUri) ? { sourceUri: value.sourceUri } : {}),
      ...(Array.isArray(value.sourceMessageIds)
        ? { sourceMessageIds: value.sourceMessageIds.filter(isNonEmptyString) }
        : {}),
    },
  };
}

function errorBody(code: string, message: string): GoodMemoryHttpBridgeErrorBody {
  return {
    error: { code, message },
    ok: false,
  };
}

function result(
  statusCode: number,
  body: GoodMemoryHttpBridgeBody,
): GoodMemoryHttpBridgeResult {
  return {
    body: body as GoodMemoryHttpBridgeLooseBody,
    statusCode,
  };
}

function errorResult(
  statusCode: number,
  code: string,
  message: string,
): GoodMemoryHttpBridgeResult {
  return result(statusCode, errorBody(code, message));
}

async function parseJsonBody(
  request: Request,
): Promise<ValidationResult<Record<string, unknown>>> {
  try {
    const body = await request.json();

    if (!isRecord(body)) {
      return {
        code: "invalid_json_body",
        message: "Expected a JSON object request body.",
        ok: false,
      };
    }

    return { ok: true, value: body };
  } catch {
    return {
      code: "invalid_json_body",
      message: "Expected a valid JSON object request body.",
      ok: false,
    };
  }
}

function resolveDefaultCaller(request: Request): GoodMemoryHttpBridgeCaller | null {
  const userId = request.headers.get("x-goodmemory-user-id")?.trim();
  if (!userId) {
    return null;
  }

  const operationsHeader = request.headers.get("x-goodmemory-operations");
  const authorizedOperations = operationsHeader
    ?.split(",")
    .map((operation) => operation.trim())
    .filter(Boolean);

  return {
    authorizedOperations: authorizedOperations?.includes("*")
      ? "*"
      : (authorizedOperations as GoodMemoryHttpBridgeOperation[] | undefined) ?? [],
    tenantId: request.headers.get("x-goodmemory-tenant-id")?.trim() || undefined,
    userId,
    workspaceId:
      request.headers.get("x-goodmemory-workspace-id")?.trim() || undefined,
  };
}

function defaultAuthorize(
  input: GoodMemoryHttpBridgeAuthorizationInput,
): GoodMemoryHttpBridgeAuthorizationResult {
  if (!input.caller) {
    return {
      authorized: false,
      code: "caller_required",
      message: "The bridge requires a backend-resolved caller identity.",
      statusCode: 401,
    };
  }

  if (input.caller.userId !== input.scope.userId) {
    return {
      authorized: false,
      code: "scope_not_authorized",
      message: "Caller userId must match scope.userId.",
      statusCode: 403,
    };
  }

  if (input.caller.tenantId && input.scope.tenantId !== input.caller.tenantId) {
    return {
      authorized: false,
      code: "scope_not_authorized",
      message: "Request scope.tenantId must be present and match the caller tenantId.",
      statusCode: 403,
    };
  }
  if (input.scope.tenantId && !input.caller.tenantId) {
    return {
      authorized: false,
      code: "scope_not_authorized",
      message: "Caller must provide tenantId to authorize tenant-scoped memory.",
      statusCode: 403,
    };
  }

  if (
    input.caller.workspaceId &&
    input.scope.workspaceId !== input.caller.workspaceId
  ) {
    return {
      authorized: false,
      code: "scope_not_authorized",
      message: "Request scope.workspaceId must be present and match the caller workspaceId.",
      statusCode: 403,
    };
  }
  if (input.scope.workspaceId && !input.caller.workspaceId) {
    return {
      authorized: false,
      code: "scope_not_authorized",
      message: "Caller must provide workspaceId to authorize workspace-scoped memory.",
      statusCode: 403,
    };
  }

  if (input.sensitive && input.caller.authorizedOperations !== "*") {
    const authorized = input.caller.authorizedOperations.includes(input.operation);
    if (!authorized) {
      return {
        authorized: false,
        code: "operation_not_authorized",
        message: "Caller is not authorized for this scoped memory operation.",
        statusCode: 403,
      };
    }
  }

  return { authorized: true };
}

function toMemoryScope(record: {
  agentId?: string;
  sessionId?: string;
  tenantId?: string;
  userId: string;
  workspaceId?: string;
}): MemoryScope {
  return {
    userId: record.userId,
    ...(record.tenantId ? { tenantId: record.tenantId } : {}),
    ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    ...(record.agentId ? { agentId: record.agentId } : {}),
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
  };
}

function compactText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function appendItem(
  items: GoodMemoryHttpMemoryItem[],
  item: GoodMemoryHttpMemoryItem | null,
): void {
  if (!item || item.content.trim().length === 0) {
    return;
  }

  items.push(item);
}

function recallHasContext(recall: RecallResult): boolean {
  return Boolean(
    recall.profile ||
      recall.preferences.length > 0 ||
      recall.references.length > 0 ||
      recall.facts.length > 0 ||
      recall.feedback.length > 0 ||
      recall.archives.length > 0 ||
      recall.episodes.length > 0 ||
      recall.workingMemory ||
      recall.journal,
  );
}

function buildRecallRoutingDiagnostics(
  recall: RecallResult,
  extraWarnings: readonly string[] = [],
): GoodMemoryHttpRecallRoutingDiagnostics {
  const explanation = recall.metadata.routingDecision.strategyExplanation;
  // Merge the router's degradation warnings with the engine's policy signal:
  // "semantic_candidates_unavailable" fires when the strategy resolved to
  // hybrid but the semantic union still could not run (e.g. no vector index),
  // which the router alone cannot see. Deduped; omitted when empty.
  const warnings = new Set<string>([
    ...(explanation.warnings ?? []),
    ...extraWarnings,
  ]);
  if (recall.metadata.policyApplied?.includes("semantic_candidates_unavailable")) {
    warnings.add(SEMANTIC_RECALL_INACTIVE_WARNING);
  }
  const warningMessages = resolveRecallRoutingWarningMessages({
    existingMessages: explanation.warningMessages,
    warnings: [...warnings],
  });

  return {
    ...(explanation.fallbackReason
      ? { fallbackReason: explanation.fallbackReason }
      : {}),
    llmRefinement: explanation.llmRefinement,
    requestedStrategy: explanation.requestedStrategy,
    resolvedStrategy: explanation.resolvedStrategy,
    semanticTieBreaking: explanation.semanticTieBreaking,
    ...(warningMessages.length > 0 ? { warningMessages } : {}),
    ...(warnings.size > 0 ? { warnings: [...warnings] } : {}),
  };
}

function buildBridgeRecallWarnings(input: {
  recall: RecallResult;
  requestedStrategy: NonNullable<RecallInput["strategy"]>;
  runtimeInfo: ReturnType<typeof inspectGoodMemoryRuntime>;
}): string[] {
  if (
    input.requestedStrategy !== "auto" ||
    input.runtimeInfo?.embeddingEnabled !== true ||
    input.runtimeInfo.retrievalPreset
  ) {
    return [];
  }

  const resolvedStrategy =
    input.recall.metadata.routingDecision.strategyExplanation.resolvedStrategy ??
    input.recall.metadata.routingDecision.strategy;
  return resolvedStrategy === "rules-only"
    ? [SEMANTIC_RECALL_INACTIVE_WARNING]
    : [];
}

function buildProviderFallbackRoutingDiagnostics(input: {
  recall: RecallResult;
  requestedStrategy: Exclude<NonNullable<RecallInput["strategy"]>, "rules-only">;
}): GoodMemoryHttpRecallRoutingDiagnostics {
  const fallback = buildRecallRoutingDiagnostics(input.recall);

  return {
    ...fallback,
    fallbackReason: "provider_error",
    providerFallback: {
      reason: "provider_error",
      recoveredStrategy: "rules-only",
    },
    requestedStrategy: input.requestedStrategy,
    resolvedStrategy: "rules-only",
    semanticTieBreaking: false,
  };
}

export function buildGoodMemoryHttpMemoryItems(
  recall: RecallResult,
): GoodMemoryHttpMemoryItem[] {
  const items: GoodMemoryHttpMemoryItem[] = [];

  if (recall.profile) {
    const profileParts = [
      recall.profile.identity.name,
      recall.profile.identity.role,
      recall.profile.identity.organization,
      ...recall.profile.activeContext.goals,
      ...recall.profile.activeContext.currentProjects,
    ].filter(isNonEmptyString);

    appendItem(items, {
      content: profileParts.join("; "),
      memoryId: `profile:${recall.profile.userId}`,
      source: "goodmemory",
      type: "profile",
    });
  }

  for (const preference of recall.preferences) {
    appendItem(items, {
      category: preference.category,
      confidence: preference.confidence,
      content: `${preference.category}: ${compactText(preference.value)}`,
      memoryId: preference.id,
      source: "goodmemory",
      tags: preference.tags,
      type: "preference",
    });
  }

  for (const reference of recall.references) {
    appendItem(items, {
      category: reference.referenceKind,
      confidence: reference.confidence,
      content: reference.description
        ? `${reference.title}: ${reference.pointer} - ${reference.description}`
        : `${reference.title}: ${reference.pointer}`,
      memoryId: reference.id,
      source: "goodmemory",
      tags: reference.tags,
      type: "reference",
    });
  }

  for (const fact of recall.facts) {
    appendItem(items, {
      category: fact.category,
      confidence: fact.confidence,
      content: fact.content,
      memoryId: fact.id,
      ...(fact.occurrence ? { occurrence: fact.occurrence } : {}),
      source: "goodmemory",
      tags: fact.tags,
      type: "fact",
    });
  }

  for (const feedback of recall.feedback) {
    appendItem(items, {
      category: feedback.kind,
      confidence: feedback.confidence,
      content: feedback.rule,
      memoryId: feedback.id,
      source: "goodmemory",
      tags: feedback.tags,
      type: "feedback",
    });
  }

  for (const episode of recall.episodes) {
    appendItem(items, {
      confidence: episode.confidence,
      content: episode.summary,
      memoryId: episode.id,
      source: "goodmemory",
      tags: episode.topics,
      type: "episode",
    });
  }

  if (recall.workingMemory) {
    appendItem(items, {
      content: [
        recall.workingMemory.currentGoal,
        ...recall.workingMemory.openLoops,
        ...(recall.workingMemory.temporaryDecisions ?? []),
      ].filter(isNonEmptyString).join("; "),
      memoryId: `working-memory:${recall.workingMemory.userId}:${recall.workingMemory.sessionId}`,
      source: "goodmemory",
      type: "working_memory",
    });
  }

  if (recall.journal) {
    appendItem(items, {
      content: [
        recall.journal.currentState,
        recall.journal.taskSpecification,
        ...(recall.journal.workflow ?? []),
        ...(recall.journal.errorsAndCorrections ?? []),
        ...(recall.journal.learnings ?? []),
        ...(recall.journal.keyResults ?? []),
        ...recall.journal.worklog,
      ].filter(isNonEmptyString).join("; "),
      memoryId: `session-journal:${recall.journal.userId}:${recall.journal.sessionId}`,
      source: "goodmemory",
      type: "session_journal",
    });
  }

  return items;
}

async function handleRecallContext(
  memory: GoodMemory,
  body: Record<string, unknown>,
  scope: MemoryScope,
): Promise<GoodMemoryHttpBridgeResult> {
  if (!isNonEmptyString(body.query)) {
    return errorResult(400, "invalid_query", "Expected query to be a non-empty string.");
  }

  const retrievalProfile = validateRetrievalProfile(body.retrievalProfile);
  if (!retrievalProfile.ok) {
    return errorResult(400, retrievalProfile.code, retrievalProfile.message);
  }

  const strategy = validateRecallStrategy(body.strategy);
  if (!strategy.ok) {
    return errorResult(400, strategy.code, strategy.message);
  }

  const output = validateContextOutput(body.output);
  if (!output.ok) {
    return errorResult(400, output.code, output.message);
  }

  const referenceTime = validateOptionalTemporalString(body, "referenceTime");
  const timezone = validateOptionalTemporalString(body, "timezone");
  if (!referenceTime.ok) {
    return errorResult(400, referenceTime.code, referenceTime.message);
  }
  if (!timezone.ok) {
    return errorResult(400, timezone.code, timezone.message);
  }

  const maxTokens =
    typeof body.maxTokens === "number" && Number.isFinite(body.maxTokens)
      ? Math.max(1, Math.floor(body.maxTokens))
      : undefined;
  const requestedStrategy = strategy.value ?? "auto";
  // Pass the validated strategy through to the engine's router ONLY when a
  // retrieval preset is active — the preset's autoStrategyBias:"hybrid" is what
  // makes "auto" resolve to hybrid, so without it that bias is dead code and
  // recall silently runs the lexical floor (the bug this fixes). Gating on the
  // preset also preserves the deliberate conservative default (Phase 47 rollout
  // invariant): with no preset, any non-hybrid strategy stays rules-only so a
  // default recall never engages a provider on query signal alone.
  const runtimeInfo = inspectGoodMemoryRuntime(memory);
  const presetActive = runtimeInfo?.retrievalPreset !== undefined;
  const effectiveRecallStrategy: NonNullable<RecallInput["strategy"]> =
    presetActive
      ? requestedStrategy
      : requestedStrategy === "hybrid"
        ? "hybrid"
        : "rules-only";
  const recallInput: RecallInput = {
    scope,
    query: body.query,
    ...(retrievalProfile.value ? { retrievalProfile: retrievalProfile.value } : {}),
    strategy: effectiveRecallStrategy,
    ...(referenceTime.value !== undefined
      ? { referenceTime: referenceTime.value }
      : {}),
    ...(timezone.value !== undefined ? { timezone: timezone.value } : {}),
  };
  let recall: RecallResult;
  let routing = undefined as GoodMemoryHttpRecallRoutingDiagnostics | undefined;

  try {
    recall = await memory.recall(recallInput);
  } catch (error) {
    // Retry on the rules-only floor for any strategy that could have engaged a
    // provider-backed semantic path — "auto" (now that it reaches the router
    // and may resolve to hybrid) as well as explicit "hybrid". Explicit
    // "rules-only" never engages a provider, so its errors are real.
    if (requestedStrategy === "rules-only" || !isProviderBackedRecallError(error)) {
      throw error;
    }
    recall = await memory.recall({
      ...recallInput,
      strategy: "rules-only",
    });
    routing = buildProviderFallbackRoutingDiagnostics({
      recall,
      requestedStrategy,
    });
  }
  const context = await memory.buildContext({
    recall,
    output: output.value,
    ...(maxTokens ? { maxTokens } : {}),
  });
  const items = buildGoodMemoryHttpMemoryItems(recall);
  const traceId = context.traceId ?? recall.metadata.traceId;

  return result(200, {
    context: {
      content: context.content,
      estimatedTokens: context.estimatedTokens,
      omittedSections: context.omittedSections,
      output: context.output,
    },
    contextText: context.content,
    contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
    hasContext: recallHasContext(recall),
    itemCount: items.length,
    items,
    ok: true,
    operation: "recall-context",
    routing: routing ?? {
      ...buildRecallRoutingDiagnostics(
        recall,
        buildBridgeRecallWarnings({
          recall,
          requestedStrategy,
          runtimeInfo,
        }),
      ),
      requestedStrategy,
    },
    ...(traceId ? { traceId } : {}),
  } satisfies GoodMemoryHttpRecallContextResponse);
}

async function handleRemember(
  memory: GoodMemory,
  body: Record<string, unknown>,
  scope: MemoryScope,
): Promise<GoodMemoryHttpBridgeResult> {
  const messages = validateMessages(body.messages);
  if (!messages.ok) {
    return errorResult(400, messages.code, messages.message);
  }

  const annotations = validateAnnotations(body.annotations);
  if (!annotations.ok) {
    return errorResult(400, annotations.code, annotations.message);
  }

  const extractionStrategy = validateExtractionStrategy(body.extractionStrategy);
  if (!extractionStrategy.ok) {
    return errorResult(400, extractionStrategy.code, extractionStrategy.message);
  }

  const timezone = validateOptionalTemporalString(body, "timezone");
  if (!timezone.ok) {
    return errorResult(400, timezone.code, timezone.message);
  }

  const mode = body.mode === undefined ? "sync" : body.mode;
  if (mode !== "sync" && mode !== "async") {
    return errorResult(400, "invalid_mode", "Expected mode to be sync or async.");
  }

  const idempotencyKey = validateIdempotencyKey(body.idempotencyKey, mode === "async");
  if (!idempotencyKey.ok) {
    return errorResult(400, idempotencyKey.code, idempotencyKey.message);
  }

  const rememberInput: RememberInput = {
    scope,
    messages: messages.value,
    ...(annotations.value ? { annotations: annotations.value } : {}),
    ...(extractionStrategy.value
      ? { extractionStrategy: extractionStrategy.value }
      : {}),
    ...(isNonEmptyString(body.locale) ? { locale: body.locale } : {}),
    ...(timezone.value !== undefined ? { timezone: timezone.value } : {}),
  };

  if (mode === "async") {
    try {
      const job = await memory.jobs.enqueueRemember({
        ...rememberInput,
        idempotencyKey: idempotencyKey.value as string,
        reason: "manual_enqueue",
      });

      return result(200, {
        contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
        idempotency: {
          handledBy: "goodmemory_jobs",
          key: idempotencyKey.value,
        },
        job,
        mode,
        ok: true,
        operation: "remember",
      });
    } catch (error) {
      if (
        isRecord(error) &&
        error.code === "idempotency_conflict"
      ) {
        return errorResult(
          409,
          "idempotency_conflict",
          "GoodMemory job idempotency key already exists for a different payload.",
        );
      }

      throw error;
    }
  }

  const remember = await memory.remember(rememberInput);

  return result(200, {
    contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
    idempotency: idempotencyKey.value
      ? {
          handledBy: "consumer_provenance_only",
          key: idempotencyKey.value,
        }
      : {
          handledBy: "none",
        },
    mode,
    ok: true,
    operation: "remember",
    result: remember,
  });
}

async function handleFeedback(
  memory: GoodMemory,
  body: Record<string, unknown>,
  scope: MemoryScope,
): Promise<GoodMemoryHttpBridgeResult> {
  if (!isNonEmptyString(body.signal)) {
    return errorResult(400, "invalid_signal", "Expected signal to be a non-empty string.");
  }

  const idempotencyKey = validateIdempotencyKey(body.idempotencyKey, true);
  if (!idempotencyKey.ok) {
    return errorResult(400, idempotencyKey.code, idempotencyKey.message);
  }

  const source = isRecord(body.source) ? body.source : {};
  const feedback = await memory.feedback({
    scope,
    signal: body.signal,
    ...(isNonEmptyString(body.locale) ? { locale: body.locale } : {}),
  });

  return result(200, {
    contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
    idempotency: {
      handledBy: "consumer_provenance_only",
      key: idempotencyKey.value,
    },
    ok: true,
    operation: "feedback",
    provenance: {
      ...(isNonEmptyString(source.eventId) ? { eventId: source.eventId } : {}),
      ...(isNonEmptyString(source.proposalId) ? { proposalId: source.proposalId } : {}),
      ...(isNonEmptyString(source.reason) ? { reason: source.reason } : {}),
      ...(isNonEmptyString(source.reviewDecision)
        ? { reviewDecision: source.reviewDecision }
        : {}),
      ...(isNonEmptyString(source.system) ? { system: source.system } : {}),
    },
    result: feedback,
  });
}

async function handleForget(
  memory: GoodMemory,
  body: Record<string, unknown>,
  scope: MemoryScope,
): Promise<GoodMemoryHttpBridgeResult> {
  if (!isNonEmptyString(body.memoryId)) {
    return errorResult(400, "invalid_memory_id", "Expected memoryId to be a non-empty string.");
  }

  const forgotten = await memory.forget({
    memoryId: body.memoryId,
    scope,
  });

  return result(200, {
    contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
    ok: true,
    operation: "forget",
    result: forgotten,
  });
}

async function handleExport(
  memory: GoodMemory,
  body: Record<string, unknown>,
  scope: MemoryScope,
): Promise<GoodMemoryHttpBridgeResult> {
  const includeRuntime = body.includeRuntime === true;
  const exported = await memory.exportMemory({
    includeRuntime,
    scope,
  });

  return result(200, {
    contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
    exported,
    includeRuntime,
    ok: true,
    operation: "export",
  });
}

async function handleRevise(
  memory: GoodMemory,
  body: Record<string, unknown>,
  scope: MemoryScope,
): Promise<GoodMemoryHttpBridgeResult> {
  const target = isRecord(body.target) ? body.target : null;
  if (!target || !isNonEmptyString(target.memoryId)) {
    return errorResult(
      400,
      "target_memory_id_required",
      "Expected target.memoryId. Query-resolved revision targets are out of scope.",
    );
  }
  if (!isRecord(body.revision) || !isNonEmptyString(body.revision.content)) {
    return errorResult(
      400,
      "invalid_revision",
      "Expected revision.content to be a non-empty string.",
    );
  }
  if (!isNonEmptyString(body.reason)) {
    return errorResult(400, "invalid_reason", "Expected reason to be a non-empty string.");
  }

  const idempotencyKey = validateIdempotencyKey(body.idempotencyKey, true);
  if (!idempotencyKey.ok) {
    return errorResult(400, idempotencyKey.code, idempotencyKey.message);
  }
  const revisionIdempotencyKey = idempotencyKey.value;
  if (!revisionIdempotencyKey) {
    return errorResult(400, "invalid_idempotency_key", "Expected a non-empty idempotencyKey string.");
  }

  const evidence = validateEvidence(body.evidence);
  if (!evidence.ok) {
    return errorResult(400, evidence.code, evidence.message);
  }

  const revised = await memory.reviseMemory({
    evidence: evidence.value,
    idempotencyKey: revisionIdempotencyKey,
    reason: body.reason as ReviseMemoryReason,
    revision: {
      content: body.revision.content,
    },
    scope,
    target: {
      memoryId: target.memoryId,
    },
  });

  return result(200, {
    contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
    idempotency: {
      handledBy: "goodmemory_revision",
      key: revisionIdempotencyKey,
    },
    ok: true,
    operation: "revise",
    result: revised,
  });
}

function resolveOperation(pathname: string): GoodMemoryHttpBridgeOperation | null {
  if (pathname === "/memory/recall-context") {
    return "recall-context";
  }
  if (pathname === "/memory/remember") {
    return "remember";
  }
  if (pathname === "/memory/feedback") {
    return "feedback";
  }
  if (pathname === "/memory/forget") {
    return "forget";
  }
  if (pathname === "/memory/export") {
    return "export";
  }
  if (pathname === "/memory/revise") {
    return "revise";
  }

  return null;
}

async function handleAuthorizedOperation(input: {
  body: Record<string, unknown>;
  memory: GoodMemory;
  operation: GoodMemoryHttpBridgeOperation;
  scope: MemoryScope;
}): Promise<GoodMemoryHttpBridgeResult> {
  if (input.operation === "recall-context") {
    return handleRecallContext(input.memory, input.body, input.scope);
  }
  if (input.operation === "remember") {
    return handleRemember(input.memory, input.body, input.scope);
  }
  if (input.operation === "feedback") {
    return handleFeedback(input.memory, input.body, input.scope);
  }
  if (input.operation === "forget") {
    return handleForget(input.memory, input.body, input.scope);
  }
  if (input.operation === "export") {
    return handleExport(input.memory, input.body, input.scope);
  }

  return handleRevise(input.memory, input.body, input.scope);
}

export function createGoodMemoryHttpMemoryBridge(
  input: CreateGoodMemoryHttpMemoryBridgeInput,
): GoodMemoryHttpMemoryBridge {
  const resolveCaller = input.resolveCaller ?? resolveDefaultCaller;
  const authorize = input.authorize ?? defaultAuthorize;

  async function handle(request: Request): Promise<GoodMemoryHttpBridgeResult> {
    // Liveness answers before the POST guard, body parsing, and caller
    // resolution: auth-free by construction, zero data access.
    if (
      request.method === "GET" &&
      new URL(request.url).pathname === "/healthz"
    ) {
      return result(200, {
        ...(input.healthMetadata ?? {}),
        contractVersion: GOODMEMORY_HTTP_MEMORY_BRIDGE_CONTRACT_VERSION,
        ok: true,
        status: "ok",
      });
    }

    // Machine-readable capability discovery: an agent that reaches a deployed
    // bridge can parse install commands, the MCP endpoint, and HTTP endpoints
    // without reading prose. Auth-free and data-free like /healthz — the
    // descriptor is static package metadata, not user memory.
    if (
      request.method === "GET" &&
      new URL(request.url).pathname === "/.well-known/goodmemory.json"
    ) {
      // The descriptor is a strict interface (no index signature); it is a
      // plain JSON record at the serialization boundary.
      return result(
        200,
        buildGoodMemoryCapabilityDescriptor() as unknown as GoodMemoryHttpBridgeBody,
      );
    }

    if (request.method !== "POST") {
      return errorResult(405, "method_not_allowed", "GoodMemory bridge endpoints require POST.");
    }

    const operation = resolveOperation(new URL(request.url).pathname);
    if (!operation) {
      return errorResult(404, "not_found", "Unknown GoodMemory bridge endpoint.");
    }

    const body = await parseJsonBody(request);
    if (!body.ok) {
      return errorResult(400, body.code, body.message);
    }

    const scope = validateScope(body.value.scope);
    if (!scope.ok) {
      return errorResult(400, scope.code, scope.message);
    }

    const authorization = await authorize({
      body: body.value,
      caller: resolveCaller(request, body.value),
      operation,
      request,
      scope: scope.value,
      sensitive: SENSITIVE_OPERATIONS.has(operation),
    });
    if (!authorization.authorized) {
      return errorResult(
        authorization.statusCode ?? 403,
        authorization.code ?? "operation_not_authorized",
        authorization.message ?? "Caller is not authorized for this memory operation.",
      );
    }

    try {
      return await handleAuthorizedOperation({
        body: body.value,
        memory: input.memory,
        operation,
        scope: scope.value,
      });
    } catch {
      return errorResult(
        500,
        "bridge_operation_failed",
        "GoodMemory bridge operation failed.",
      );
    }
  }

  return {
    async fetch(request) {
      const bridgeResult = await handle(request);

      return new Response(JSON.stringify(bridgeResult.body), {
        headers: {
          "content-type": "application/json",
        },
        status: bridgeResult.statusCode,
      });
    },
    handle,
  };
}

export function createLifeCoachHttpRememberConfig(): RememberConfig {
  return {
    preset: "default",
    profiles: [
      {
        assistantOutputs: { mode: "confirmed_or_verified_only" },
        extends: "default",
        id: "life-coach",
        when: { agentId: "life-coach" },
      },
    ],
  };
}

export function toOneLifeMemoryContextResponse(
  response: GoodMemoryHttpRecallContextResponse | GoodMemoryHttpBridgeLooseBody,
): OneLifeMemoryContextResponse {
  if (response.ok !== true || !Array.isArray(response.items)) {
    throw new Error("Expected a successful GoodMemory recall-context response.");
  }

  const items = response.items
    .filter(isRecord)
    .map((item) => ({
      content: isNonEmptyString(item.content) ? item.content : "",
      memoryId: isNonEmptyString(item.memoryId) ? item.memoryId : "",
      type: typeof item.type === "string"
        ? item.type as GoodMemoryHttpMemoryItem["type"]
        : "fact",
    }))
    .filter((item) => item.memoryId.length > 0 && item.content.length > 0);

  return {
    context: typeof response.contextText === "string" ? response.contextText : "",
    memories: items.map((item) => ({
      id: item.memoryId,
      kind: item.type,
      source: "goodmemory-http-bridge",
      text: item.content,
    })),
    metadata: {
      hasContext: response.hasContext === true,
      itemCount: typeof response.itemCount === "number"
        ? response.itemCount
        : items.length,
      policyBoundary: "product_owned",
      source: "goodmemory-http-bridge",
      ...(isNonEmptyString(response.traceId) ? { traceId: response.traceId } : {}),
    },
  };
}

export function toLifeCoachScope(input: {
  agentId?: string;
  sessionId?: string;
  tenantId?: string;
  userId: string;
  workspaceId?: string;
}): MemoryScope {
  return toMemoryScope({
    agentId: input.agentId ?? "life-coach",
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
}
