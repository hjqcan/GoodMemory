import type { GoodMemory } from "../../src";
import type {
  GoodMemoryRuntimeKit,
  RuntimeKitAfterModelCallInput,
  RuntimeKitBeforeModelCallInput,
  RuntimeKitContextMode,
  RuntimeKitWritebackMode,
} from "goodmemory/runtime-kit";
import { createGoodMemoryRuntimeKit } from "goodmemory/runtime-kit";

declare const memory: GoodMemory;

const contextMode: RuntimeKitContextMode = "progressive";
const writebackMode: RuntimeKitWritebackMode = "observe";

const runtimeKit: GoodMemoryRuntimeKit = createGoodMemoryRuntimeKit({
  memory,
  defaultContextMode: contextMode,
});

const beforeModelCallInput: RuntimeKitBeforeModelCallInput = {
  scope: {
    userId: "runtime-kit-types-user",
    workspaceId: "runtime-kit-types-workspace",
    sessionId: "runtime-kit-types-session",
  },
  query: "What context is useful?",
  contextMode: "fragment",
  timezone: "America/New_York",
};

async function runModelTurn(): Promise<void> {
  const before = await runtimeKit.beforeModelCall(beforeModelCallInput);
  const afterModelCallInput: RuntimeKitAfterModelCallInput = {
    scope: beforeModelCallInput.scope,
    messages: [{ role: "user", content: "Remember the review cadence." }],
    assistantText: "The review cadence is weekly.",
    referenceTime: before.referenceTime,
    timezone: before.timezone,
    writeback: {
      mode: writebackMode,
      annotation: "session_only",
      policy: "deny",
    },
  };

  await runtimeKit.afterModelCall(afterModelCallInput);
}

void runModelTurn;

void runtimeKit.preAction({
  intent: {
    actionId: "runtime-kit-types-action",
    runId: "runtime-kit-types-run",
    turnId: "runtime-kit-types-turn",
    sequence: 1,
    occurredAt: "2026-04-26T00:00:00.000Z",
    hostKind: "codex",
    scope: beforeModelCallInput.scope,
    action: {
      kind: "command",
      command: "bun test",
    },
  },
});

// @ts-expect-error Root barrel must not export the runtime-kit factory.
type RootCreateRuntimeKit = typeof import("../../src").createGoodMemoryRuntimeKit;

void (0 as unknown as RootCreateRuntimeKit);
