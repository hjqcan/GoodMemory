import type {
  GoodMemory,
  GoodMemoryRuntimeInfo,
  LanguagePack,
  LanguageSourceOfTruthDirective,
} from "goodmemory";
import {
  createChineseLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createSpanishLanguagePack,
  inspectGoodMemoryRuntime,
} from "goodmemory";
import type {
  AgentEventStructuredValue,
  AgentInputEvent,
} from "goodmemory/ai-sdk";
import {
  validateAgentInputEvent,
} from "goodmemory/ai-sdk";
import type {
  HostActionExecutionPlan,
  HostActionIntent,
  HostAgentEvent,
} from "goodmemory/host";
import {
  resolveHostActionExecutionPlan,
  validateHostActionIntent,
  validateHostAgentEvent,
} from "goodmemory/host";
import type {
  GoodMemoryHttpBridgeCaller,
  GoodMemoryHttpBridgeOperation,
} from "goodmemory/http";
import {
  createGoodMemoryHttpMemoryBridge,
  toLifeCoachScope,
} from "goodmemory/http";

const toolPayload: AgentEventStructuredValue = {
  checks: ["network"],
  dryRun: true,
  metadata: {
    limit: 2,
  },
};

declare const memory: GoodMemory;

const japaneseBase = createJapaneseLanguagePack();
const traditionalChinese = createChineseLanguagePack("Hant") satisfies LanguagePack;
const korean = createKoreanLanguagePack() satisfies LanguagePack;
const french = createFrenchLanguagePack() satisfies LanguagePack;
const spanish = createSpanishLanguagePack() satisfies LanguagePack;
const customJapanese = {
  ...japaneseBase,
  analyzerVersion: "consumer-ja-v1",
} satisfies LanguagePack;
const sourceOfTruthDirective: LanguageSourceOfTruthDirective = {
  currentPointer: "docs/current.md",
};

const runtimeInfo: GoodMemoryRuntimeInfo | undefined = inspectGoodMemoryRuntime(memory);
const httpBridge = createGoodMemoryHttpMemoryBridge({ memory });
const httpBridgeCaller: GoodMemoryHttpBridgeCaller = {
  authorizedOperations: ["recall-context", "remember"],
  userId: "consumer-user",
};
const httpBridgeOperation: GoodMemoryHttpBridgeOperation = "recall-context";
const lifeCoachScope = toLifeCoachScope({
  sessionId: "consumer-session",
  userId: "consumer-user",
  workspaceId: "consumer-workspace",
});

const aiEvent = {
  surface: "ai-sdk",
  kind: "tool_call",
  eventId: "consumer-event-1",
  runId: "consumer-run-1",
  turnId: "consumer-turn-1",
  sequence: 0,
  occurredAt: "2026-04-22T00:00:00.000Z",
  hostKind: "codex",
  scope: {
    userId: "consumer-user",
    workspaceId: "consumer-workspace",
    sessionId: "consumer-s1",
  },
  toolName: "QuickCheck",
  payload: toolPayload,
} satisfies AgentInputEvent;

const hostEvent = {
  surface: "host",
  kind: "file_edit",
  eventId: "consumer-event-2",
  attemptId: "consumer-attempt-1",
  turnId: "consumer-turn-1",
  sequence: 1,
  occurredAt: "2026-04-22T00:00:01.000Z",
  parentEventId: "consumer-event-1",
  hostKind: "claude",
  scope: {
    userId: "consumer-user",
    workspaceId: "consumer-workspace",
    sessionId: "consumer-s1",
  },
  operation: "update",
  relativePath: "playbooks/consumer-checklist.md",
  summary: "Capture the installed-package smoke edit shape.",
} satisfies HostAgentEvent;

const hostActionIntent = {
  actionId: "consumer-action-1",
  runId: "consumer-run-1",
  turnId: "consumer-turn-2",
  sequence: 2,
  occurredAt: "2026-04-22T00:00:02.000Z",
  hostKind: "codex",
  scope: {
    userId: "consumer-user",
    workspaceId: "consumer-workspace",
    sessionId: "consumer-s1",
  },
  action: {
    kind: "command",
    command: "deploy preview",
  },
} satisfies HostActionIntent;

void validateAgentInputEvent(aiEvent);
void validateHostAgentEvent(hostEvent);
void validateHostActionIntent(hostActionIntent);
declare const assessedAction: Awaited<
  ReturnType<import("goodmemory/host").HostAdapter["assessAction"]>
>;
const hostExecutionPlan: HostActionExecutionPlan = resolveHostActionExecutionPlan({
  assessment: assessedAction,
  intent: hostActionIntent,
});

const legacyArgsEvent: AgentInputEvent = {
  surface: "ai-sdk",
  kind: "tool_call",
  eventId: "legacy-event",
  runId: "legacy-run",
  turnId: "legacy-turn",
  sequence: 2,
  occurredAt: "2026-04-22T00:00:02.000Z",
  hostKind: "codex",
  scope: {
    userId: "consumer-user",
  },
  toolName: "QuickCheck",
  // @ts-expect-error tool_call payload is adapter-neutral rather than CLI-shaped args.
  args: ["--network"],
};

// @ts-expect-error Root barrel must not export adapter-level agent input events.
type RootAgentInputEvent = import("goodmemory").AgentInputEvent;

// @ts-expect-error Root barrel must not export host-level agent events.
type RootHostAgentEvent = import("goodmemory").HostAgentEvent;

// @ts-expect-error Root barrel must not export runtime validation helpers for adapter events.
const rootValidateAgentInputEvent = import("goodmemory").validateAgentInputEvent;

// @ts-expect-error Root barrel must not export runtime validation helpers for host events.
const rootValidateHostAgentEvent = import("goodmemory").validateHostAgentEvent;

// @ts-expect-error Root barrel must not export host action intents.
type RootHostActionIntent = import("goodmemory").HostActionIntent;

// @ts-expect-error Root barrel must not export runtime validation helpers for host action intents.
const rootValidateHostActionIntent = import("goodmemory").validateHostActionIntent;

// @ts-expect-error Root barrel must not export internal evolution proposals.
type RootLearningProposal = import("goodmemory").LearningProposal;

// @ts-expect-error Root barrel must not export internal evolution promotions.
type RootPromotionRecord = import("goodmemory").PromotionRecord;

// @ts-expect-error Root barrel must not export internal evolution constructors.
const rootCreateLearningProposal = import("goodmemory").createLearningProposal;

// @ts-expect-error HTTP bridge request test helper is not public package surface.
type HttpBridgeRequestTestHelper = typeof import("goodmemory/http").runGoodMemoryHttpBridgeRequest;

void legacyArgsEvent;
void (0 as unknown as RootAgentInputEvent);
void (0 as unknown as RootHostAgentEvent);
void (0 as unknown as RootHostActionIntent);
void (0 as unknown as RootLearningProposal);
void (0 as unknown as RootPromotionRecord);
void rootValidateAgentInputEvent;
void rootValidateHostAgentEvent;
void rootValidateHostActionIntent;
void rootCreateLearningProposal;
void (0 as unknown as HttpBridgeRequestTestHelper);
void hostExecutionPlan;
void httpBridge;
void httpBridgeCaller;
void httpBridgeOperation;
void lifeCoachScope;
void runtimeInfo;
void traditionalChinese;
void korean;
void french;
void spanish;
void customJapanese;
void sourceOfTruthDirective;
