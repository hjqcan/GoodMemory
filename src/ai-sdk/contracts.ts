import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";

import type { GoodMemory } from "../api/contracts";
import type { AgentEventIngestResult } from "../api/integrationSupport";
import type { SessionMessage } from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type {
  AgentEventHostKind,
  AgentEventIdentity,
  AgentEventKind,
  AgentEventScope,
  AgentEventStructuredValue,
  AgentInputEvent,
} from "../agentEvents";

import {
  generateText,
  streamText,
  type GenerateTextOnFinishCallback,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";

const DEFAULT_GENERATE_TEXT = generateText;
const DEFAULT_STREAM_TEXT = streamText;

export type {
  AgentEventHostKind,
  AgentEventIngestResult,
  AgentEventIdentity,
  AgentEventKind,
  AgentEventScope,
  AgentEventStructuredValue,
  AgentInputEvent,
};

export type AISDKGenerateTextInput = Parameters<typeof DEFAULT_GENERATE_TEXT>[0];
export type AISDKGenerateTextResult = Awaited<
  ReturnType<typeof DEFAULT_GENERATE_TEXT>
>;
export type AISDKStreamTextInput = Parameters<typeof DEFAULT_STREAM_TEXT>[0];
export type AISDKStreamTextResult = ReturnType<typeof DEFAULT_STREAM_TEXT>;

export type GoodMemoryAISDKRetrievalProfile = "general_chat" | "coding_agent";

export type GoodMemoryModelMessage = ModelMessage &
  Pick<SessionMessage, "id" | "observedAt" | "timezone">;

export type GoodMemoryRecallSkipReason =
  | "empty_context"
  | "ignore_memory"
  | "no_query";

export type GoodMemoryRememberSkipReason =
  | "ignore_memory"
  | "no_final_assistant_text"
  | "no_text_messages";

export interface GoodMemoryAISDKRecallEvent {
  phase: "recall";
  reason?: GoodMemoryRecallSkipReason;
  retrievalProfile: GoodMemoryAISDKRetrievalProfile;
  scope: MemoryScope;
  status: "applied" | "skipped";
}

export interface GoodMemoryAISDKRememberEvent {
  accepted?: number;
  phase: "remember";
  reason?: GoodMemoryRememberSkipReason;
  rejected?: number;
  scope: MemoryScope;
  status: "skipped" | "succeeded";
}

export type GoodMemoryAISDKEvent =
  | GoodMemoryAISDKRecallEvent
  | GoodMemoryAISDKRememberEvent;

export interface GoodMemoryAISDKErrorEvent {
  error: unknown;
  phase: "recall" | "remember";
  scope: MemoryScope;
}

interface GoodMemoryAISDKBaseCallInput {
  assistantObservedAt?: string;
  assistantTimezone?: string;
  ignoreMemory?: boolean;
  locale?: string;
  maxMemoryTokens?: number;
  query?: string;
  referenceTime?: string;
  retrievalProfile?: GoodMemoryAISDKRetrievalProfile;
  scope: MemoryScope;
  system?: string | SystemModelMessage | Array<SystemModelMessage>;
  timezone?: string;
}

export type GoodMemoryGenerateTextInput<
  TOOLS extends ToolSet = ToolSet,
> = Omit<
  AISDKGenerateTextInput,
  "messages" | "onFinish" | "prompt" | "system"
> &
  GoodMemoryAISDKBaseCallInput & {
    messages: GoodMemoryModelMessage[];
    onFinish?: GenerateTextOnFinishCallback<TOOLS>;
  };

export type GoodMemoryStreamTextInput<
  TOOLS extends ToolSet = ToolSet,
> = Omit<
  AISDKStreamTextInput,
  "messages" | "onFinish" | "prompt" | "system"
> &
  GoodMemoryAISDKBaseCallInput & {
    messages: GoodMemoryModelMessage[];
    onFinish?: StreamTextOnFinishCallback<TOOLS>;
  };

export interface GoodMemoryAISDKDependencies {
  generateText?: typeof generateText;
  streamText?: typeof streamText;
}

export interface CreateGoodMemoryAISDKInput {
  defaultMaxMemoryTokens?: number;
  defaultRetrievalProfile?: GoodMemoryAISDKRetrievalProfile;
  dependencies?: GoodMemoryAISDKDependencies;
  memory: GoodMemory;
  onMemoryError?(
    event: GoodMemoryAISDKErrorEvent,
  ): Promise<void> | void;
  onMemoryEvent?(event: GoodMemoryAISDKEvent): Promise<void> | void;
}

export interface GoodMemoryAISDK {
  generateText<TOOLS extends ToolSet = ToolSet>(
    input: GoodMemoryGenerateTextInput<TOOLS>,
  ): Promise<AISDKGenerateTextResult>;
  streamText<TOOLS extends ToolSet = ToolSet>(
    input: GoodMemoryStreamTextInput<TOOLS>,
  ): AISDKStreamTextResult;
}
