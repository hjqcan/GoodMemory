import type { MemoryScope } from "./domain/scope";
import { assertStorageSafeExternalValue } from "./domain/semanticText";

export type AgentEventKind =
  | "file_edit"
  | "task_transition"
  | "tool_call"
  | "tool_result"
  | "user_correction"
  | "verify_result";

export type AgentEventHostKind = "claude" | "codex" | "generic";

export interface AgentEventStructuredObject {
  [key: string]: AgentEventStructuredValue;
}

export type AgentEventStructuredValue =
  | AgentEventStructuredObject
  | AgentEventStructuredValue[]
  | boolean
  | null
  | number
  | string;

export interface AgentEventIdentity {
  attemptId?: string;
  eventId: string;
  occurredAt: string;
  parentEventId?: string;
  runId?: string;
  sequence: number;
  turnId: string;
}

export interface AgentEventScope extends MemoryScope {}

interface AgentEventBaseFields extends AgentEventIdentity {
  hostKind: AgentEventHostKind;
  scope: AgentEventScope;
}

interface ToolCallAgentEventFields {
  kind: "tool_call";
  payload?: AgentEventStructuredValue;
  raw?: string;
  toolName: string;
}

interface ToolResultAgentEventFields {
  excerpt?: string;
  kind: "tool_result";
  outcome: "blocked" | "failure" | "success" | "timeout";
  toolName: string;
}

interface FileEditAgentEventFields {
  kind: "file_edit";
  operation: "create" | "delete" | "update";
  relativePath: string;
  summary?: string;
}

interface VerifyResultAgentEventFields {
  checkName: string;
  kind: "verify_result";
  outcome: "blocked" | "failed" | "passed";
  summary?: string;
}

interface TaskTransitionAgentEventFields {
  kind: "task_transition";
  nextState: string;
  previousState?: string;
  summary?: string;
}

interface UserCorrectionAgentEventBaseFields {
  correction: string;
  kind: "user_correction";
  targetEventId?: string;
}

interface AgentInputUserCorrectionAgentEventFields
  extends UserCorrectionAgentEventBaseFields {
  retrievalProfile: "general_chat" | "coding_agent";
}

interface HostUserCorrectionAgentEventFields
  extends UserCorrectionAgentEventBaseFields {
  retrievalProfile?: "general_chat" | "coding_agent";
}

type SharedAgentEventPayloadFields =
  | FileEditAgentEventFields
  | TaskTransitionAgentEventFields
  | ToolCallAgentEventFields
  | ToolResultAgentEventFields
  | VerifyResultAgentEventFields;

type AgentInputEventPayloadFields =
  | AgentInputUserCorrectionAgentEventFields
  | SharedAgentEventPayloadFields;

type HostAgentEventPayloadFields =
  | HostUserCorrectionAgentEventFields
  | SharedAgentEventPayloadFields;

type AgentEventRunBinding =
  | {
      attemptId: string;
      runId?: string;
    }
  | {
      attemptId?: string;
      runId: string;
    };

export type AgentInputEvent = AgentEventBaseFields &
  AgentInputEventPayloadFields &
  AgentEventRunBinding & {
    surface: "ai-sdk";
  };

export type HostAgentEvent = AgentEventBaseFields &
  HostAgentEventPayloadFields &
  AgentEventRunBinding & {
    surface: "host";
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function assertStorageSafeAgentEvent(value: unknown, path: string): void {
  if (!isRecord(value)) {
    return;
  }
  const {
    correction: _correction,
    excerpt: _excerpt,
    raw: _raw,
    summary: _summary,
    ...persistedFields
  } = value;
  assertStorageSafeExternalValue(persistedFields, path);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }

  return value.trim();
}

function assertOptionalNonEmptyString(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertNonEmptyString(value, path);
}

function assertStructuredValue(
  value: unknown,
  path: string,
): AgentEventStructuredValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be a JSON-serializable value`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      assertStructuredValue(entry, `${path}[${index}]`),
    );
  }

  if (isPlainRecord(value)) {
    const structured: AgentEventStructuredObject = {};

    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        throw new Error(`${path}.${key} must not be undefined`);
      }

      structured[key] = assertStructuredValue(entry, `${path}.${key}`);
    }

    return structured;
  }

  throw new Error(`${path} must be a JSON-serializable value`);
}

function assertNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }

  return value;
}

function assertOccurredAt(value: unknown, path: string): string {
  const occurredAt = assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error(`${path} must be a valid date-time string`);
  }

  return occurredAt;
}

function assertAgentEventHostKind(
  value: unknown,
  path: string,
): AgentEventHostKind {
  if (value === "generic" || value === "codex" || value === "claude") {
    return value;
  }

  throw new Error(`${path} must be generic, codex, or claude`);
}

function assertAgentEventRetrievalProfile(
  value: unknown,
  path: string,
): "general_chat" | "coding_agent" {
  if (value === "general_chat" || value === "coding_agent") {
    return value;
  }

  throw new Error(`${path} must be general_chat or coding_agent`);
}

function assertAgentEventScope(value: unknown, path: string): AgentEventScope {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const userId = assertNonEmptyString(value.userId, `${path}.userId`);

  return {
    userId,
    ...(value.tenantId !== undefined
      ? { tenantId: assertNonEmptyString(value.tenantId, `${path}.tenantId`) }
      : {}),
    ...(value.workspaceId !== undefined
      ? {
          workspaceId: assertNonEmptyString(
            value.workspaceId,
            `${path}.workspaceId`,
          ),
        }
      : {}),
    ...(value.agentId !== undefined
      ? { agentId: assertNonEmptyString(value.agentId, `${path}.agentId`) }
      : {}),
    ...(value.sessionId !== undefined
      ? {
          sessionId: assertNonEmptyString(value.sessionId, `${path}.sessionId`),
        }
      : {}),
  };
}

function assertRelativePath(value: unknown, path: string): string {
  const relativePath = assertNonEmptyString(value, path);
  const segments = relativePath.split("/");

  if (
    relativePath.startsWith("/") ||
    relativePath.startsWith("~/") ||
    relativePath.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(relativePath)
  ) {
    throw new Error(
      `${path} must be a normalized relative path without traversal or absolute segments`,
    );
  }

  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      `${path} must be a normalized relative path without traversal or absolute segments`,
    );
  }

  return relativePath;
}

function assertRunBinding(input: {
  attemptId: unknown;
  path: string;
  runId: unknown;
}): AgentEventRunBinding {
  const attemptId = assertOptionalNonEmptyString(
    input.attemptId,
    `${input.path}.attemptId`,
  );
  const runId = assertOptionalNonEmptyString(input.runId, `${input.path}.runId`);

  if (!attemptId && !runId) {
    throw new Error(`${input.path} must include runId or attemptId`);
  }

  return {
    ...(attemptId ? { attemptId } : {}),
    ...(runId ? { runId } : {}),
  } as AgentEventRunBinding;
}

function assertSurface<TSurface extends AgentInputEvent["surface"] | HostAgentEvent["surface"]>(
  value: unknown,
  path: string,
  expected: TSurface,
): TSurface {
  if (value !== expected) {
    throw new Error(`${path} must be ${expected}`);
  }

  return expected;
}

function assertBaseFields(
  value: Record<string, unknown>,
  path: string,
): AgentEventBaseFields & AgentEventRunBinding {
  return {
    ...assertRunBinding({
      attemptId: value.attemptId,
      runId: value.runId,
      path,
    }),
    eventId: assertNonEmptyString(value.eventId, `${path}.eventId`),
    occurredAt: assertOccurredAt(value.occurredAt, `${path}.occurredAt`),
    ...(value.parentEventId !== undefined
      ? {
          parentEventId: assertNonEmptyString(
            value.parentEventId,
            `${path}.parentEventId`,
          ),
        }
      : {}),
    sequence: assertNonNegativeInteger(value.sequence, `${path}.sequence`),
    turnId: assertNonEmptyString(value.turnId, `${path}.turnId`),
    hostKind: assertAgentEventHostKind(value.hostKind, `${path}.hostKind`),
    scope: assertAgentEventScope(value.scope, `${path}.scope`),
  };
}

function assertSharedPayloadFields(
  kind: Exclude<AgentEventKind, "user_correction">,
  value: Record<string, unknown>,
  path: string,
): SharedAgentEventPayloadFields {
  switch (kind) {
    case "tool_call":
      return {
        kind,
        toolName: assertNonEmptyString(value.toolName, `${path}.toolName`),
        ...(value.payload !== undefined
          ? { payload: assertStructuredValue(value.payload, `${path}.payload`) }
          : {}),
        ...(value.raw !== undefined
          ? { raw: assertNonEmptyString(value.raw, `${path}.raw`) }
          : {}),
      };
    case "tool_result":
      if (
        value.outcome !== "success" &&
        value.outcome !== "failure" &&
        value.outcome !== "timeout" &&
        value.outcome !== "blocked"
      ) {
        throw new Error(`${path}.outcome must be success, failure, timeout, or blocked`);
      }

      return {
        kind,
        toolName: assertNonEmptyString(value.toolName, `${path}.toolName`),
        outcome: value.outcome,
        ...(value.excerpt !== undefined
          ? { excerpt: assertNonEmptyString(value.excerpt, `${path}.excerpt`) }
          : {}),
      };
    case "file_edit":
      if (
        value.operation !== "create" &&
        value.operation !== "update" &&
        value.operation !== "delete"
      ) {
        throw new Error(`${path}.operation must be create, update, or delete`);
      }

      return {
        kind,
        operation: value.operation,
        relativePath: assertRelativePath(value.relativePath, `${path}.relativePath`),
        ...(value.summary !== undefined
          ? { summary: assertNonEmptyString(value.summary, `${path}.summary`) }
          : {}),
      };
    case "verify_result":
      if (
        value.outcome !== "passed" &&
        value.outcome !== "failed" &&
        value.outcome !== "blocked"
      ) {
        throw new Error(`${path}.outcome must be passed, failed, or blocked`);
      }

      return {
        kind,
        checkName: assertNonEmptyString(value.checkName, `${path}.checkName`),
        outcome: value.outcome,
        ...(value.summary !== undefined
          ? { summary: assertNonEmptyString(value.summary, `${path}.summary`) }
          : {}),
      };
    case "task_transition":
      return {
        kind,
        nextState: assertNonEmptyString(value.nextState, `${path}.nextState`),
        ...(value.previousState !== undefined
          ? {
              previousState: assertNonEmptyString(
                value.previousState,
                `${path}.previousState`,
              ),
            }
          : {}),
        ...(value.summary !== undefined
          ? { summary: assertNonEmptyString(value.summary, `${path}.summary`) }
          : {}),
      };
  }
}

function assertAgentInputPayloadFields(
  value: Record<string, unknown>,
  path: string,
): AgentInputEventPayloadFields {
  const kind = assertNonEmptyString(value.kind, `${path}.kind`) as AgentEventKind;

  switch (kind) {
    case "user_correction":
      if (value.retrievalProfile === undefined) {
        throw new Error(
          `${path}.retrievalProfile must be provided for ai-sdk user_correction events`,
        );
      }

      return {
        kind,
        correction: assertNonEmptyString(value.correction, `${path}.correction`),
        retrievalProfile: assertAgentEventRetrievalProfile(
          value.retrievalProfile,
          `${path}.retrievalProfile`,
        ),
        ...(value.targetEventId !== undefined
          ? {
              targetEventId: assertNonEmptyString(
                value.targetEventId,
                `${path}.targetEventId`,
              ),
            }
          : {}),
      };
    default:
      return assertSharedPayloadFields(kind, value, path);
  }
}

function assertHostPayloadFields(
  value: Record<string, unknown>,
  path: string,
): HostAgentEventPayloadFields {
  const kind = assertNonEmptyString(value.kind, `${path}.kind`) as AgentEventKind;

  switch (kind) {
    case "user_correction":
      return {
        kind,
        correction: assertNonEmptyString(value.correction, `${path}.correction`),
        retrievalProfile: value.retrievalProfile === undefined
          ? "coding_agent"
          : assertAgentEventRetrievalProfile(
              value.retrievalProfile,
              `${path}.retrievalProfile`,
            ),
        ...(value.targetEventId !== undefined
          ? {
              targetEventId: assertNonEmptyString(
                value.targetEventId,
                `${path}.targetEventId`,
              ),
            }
          : {}),
      };
    default:
      return assertSharedPayloadFields(kind, value, path);
  }
}

export function validateAgentInputEvent(
  value: unknown,
  path = "event",
): AgentInputEvent {
  assertStorageSafeAgentEvent(value, path);
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return {
    surface: assertSurface(value.surface, `${path}.surface`, "ai-sdk"),
    ...assertBaseFields(value, path),
    ...assertAgentInputPayloadFields(value, path),
  };
}

export function validateHostAgentEvent(
  value: unknown,
  path = "event",
): HostAgentEvent {
  assertStorageSafeAgentEvent(value, path);
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return {
    surface: assertSurface(value.surface, `${path}.surface`, "host"),
    ...assertBaseFields(value, path),
    ...assertHostPayloadFields(value, path),
  };
}

export function isAgentInputEvent(value: unknown): value is AgentInputEvent {
  try {
    validateAgentInputEvent(value);
    return true;
  } catch {
    return false;
  }
}

export function isHostAgentEvent(value: unknown): value is HostAgentEvent {
  try {
    validateHostAgentEvent(value);
    return true;
  } catch {
    return false;
  }
}
