import type { MemoryScope } from "../domain/scope";
import type { AgentEventStructuredValue } from "../agentEvents";
import { assertStorageSafeExternalValue } from "../domain/semanticText";
import type {
  HostActionIntent,
  HostCommandAction,
  HostFileEditAction,
  HostPlannedAction,
  HostToolCallAction,
  HostKind,
} from "./contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    typeof value === "number" ||
    typeof value === "string"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${path} must be a JSON-serializable value`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      assertStructuredValue(entry, `${path}[${index}]`)
    );
  }

  if (isPlainRecord(value)) {
    const structured: Record<string, AgentEventStructuredValue> = {};

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

function assertHostKind(value: unknown, path: string): HostKind {
  if (value === "generic" || value === "claude" || value === "codex") {
    return value;
  }

  throw new Error(`${path} must be generic, claude, or codex`);
}

function assertScope(value: unknown, path: string): MemoryScope {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return {
    userId: assertNonEmptyString(value.userId, `${path}.userId`),
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

function validateCommandAction(
  value: Record<string, unknown>,
  path: string,
): HostCommandAction {
  return {
    kind: "command",
    command: assertNonEmptyString(value.command, `${path}.command`),
    ...(value.summary !== undefined
      ? {
          summary: assertOptionalNonEmptyString(value.summary, `${path}.summary`),
        }
      : {}),
  };
}

function validateToolCallAction(
  value: Record<string, unknown>,
  path: string,
): HostToolCallAction {
  const payload = value.payload === undefined
    ? undefined
    : assertStructuredValue(value.payload, `${path}.payload`);

  return {
    kind: "tool_call",
    toolName: assertNonEmptyString(value.toolName, `${path}.toolName`),
    ...(payload !== undefined ? { payload } : {}),
    ...(value.raw !== undefined
      ? { raw: assertOptionalNonEmptyString(value.raw, `${path}.raw`) }
      : {}),
    ...(value.summary !== undefined
      ? {
          summary: assertOptionalNonEmptyString(value.summary, `${path}.summary`),
        }
      : {}),
  };
}

function validateFileEditAction(
  value: Record<string, unknown>,
  path: string,
): HostFileEditAction {
  if (
    value.operation !== "create" &&
    value.operation !== "delete" &&
    value.operation !== "update"
  ) {
    throw new Error(`${path}.operation must be create, delete, or update`);
  }

  return {
    kind: "file_edit",
    operation: value.operation,
    relativePath: assertRelativePath(value.relativePath, `${path}.relativePath`),
    ...(value.summary !== undefined
      ? {
          summary: assertOptionalNonEmptyString(value.summary, `${path}.summary`),
        }
      : {}),
  };
}

function validatePlannedAction(value: unknown, path: string): HostPlannedAction {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (value.kind === "command") {
    return validateCommandAction(value, path);
  }

  if (value.kind === "tool_call") {
    return validateToolCallAction(value, path);
  }

  if (value.kind === "file_edit") {
    return validateFileEditAction(value, path);
  }

  throw new Error(`${path}.kind must be command, tool_call, or file_edit`);
}

export function validateHostActionIntent(
  value: unknown,
  path = "actionIntent",
): HostActionIntent {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  assertStorageSafeExternalValue(value, path);

  const runId = value.runId === undefined
    ? undefined
    : assertNonEmptyString(value.runId, `${path}.runId`);
  const attemptId = value.attemptId === undefined
    ? undefined
    : assertNonEmptyString(value.attemptId, `${path}.attemptId`);

  if (!runId && !attemptId) {
    throw new Error(`${path} must include runId or attemptId`);
  }

  const base = {
    actionId: assertNonEmptyString(value.actionId, `${path}.actionId`),
    hostKind: assertHostKind(value.hostKind, `${path}.hostKind`),
    occurredAt: assertOccurredAt(value.occurredAt, `${path}.occurredAt`),
    scope: assertScope(value.scope, `${path}.scope`),
    sequence: assertNonNegativeInteger(value.sequence, `${path}.sequence`),
    turnId: assertNonEmptyString(value.turnId, `${path}.turnId`),
    action: validatePlannedAction(value.action, `${path}.action`),
  };

  if (runId) {
    return {
      ...base,
      runId,
      ...(attemptId ? { attemptId } : {}),
    };
  }

  return {
    ...base,
    attemptId: attemptId!,
  };
}

export function isHostActionIntent(value: unknown): value is HostActionIntent {
  try {
    validateHostActionIntent(value);
    return true;
  } catch {
    return false;
  }
}
