import {
  createTextStreamResponse,
  createUIMessageStreamResponse,
  generateText as aiGenerateText,
  pipeTextStreamToResponse as aiPipeTextStreamToResponse,
  pipeUIMessageStreamToResponse as aiPipeUIMessageStreamToResponse,
  streamText as aiStreamText,
  type ToolSet,
} from "ai";
import type {
  ModelMessage,
  SystemModelMessage,
} from "@ai-sdk/provider-utils";

import type {
  AISDKGenerateTextResult,
  AISDKStreamTextResult,
  CreateGoodMemoryAISDKInput,
  GoodMemoryAISDK,
  GoodMemoryAISDKErrorEvent,
  GoodMemoryAISDKEvent,
  GoodMemoryAISDKRetrievalProfile,
  GoodMemoryGenerateTextInput,
  GoodMemoryModelMessage,
  GoodMemoryRememberSkipReason,
  GoodMemoryRecallSkipReason,
  GoodMemoryStreamTextInput,
} from "./contracts";
import { createGoodMemoryRuntimeKit } from "../runtime-kit/public";
import type {
  GoodMemoryRuntimeKit,
  RuntimeKitBeforeModelCallResult,
  RuntimeKitMessage,
} from "../runtime-kit/contracts";
import {
  assertTemporalMessageContext,
  isIanaTimezone,
  isRfc3339Instant,
} from "../domain/temporal";

const DEFAULT_MEMORY_FRAGMENT_MAX_TOKENS = 160;

type AsyncIterableStreamLike<T> = ReadableStream<T> & AsyncIterable<T>;

interface PreparedMemoryContext {
  retrievalProfile: GoodMemoryAISDKRetrievalProfile;
  system?: string | SystemModelMessage | Array<SystemModelMessage>;
}

function assertAISDKTemporalContext(input: Pick<
  GoodMemoryGenerateTextInput | GoodMemoryStreamTextInput,
  | "assistantObservedAt"
  | "assistantTimezone"
  | "messages"
  | "referenceTime"
  | "timezone"
>): void {
  if (input.referenceTime !== undefined && !isRfc3339Instant(input.referenceTime)) {
    throw new TypeError(`Invalid referenceTime: ${input.referenceTime}`);
  }
  if (input.timezone !== undefined && !isIanaTimezone(input.timezone)) {
    throw new TypeError(`Invalid timezone: ${input.timezone}`);
  }
  input.messages.forEach((message, index) => {
    assertTemporalMessageContext(message, `messages[${index}]`);
  });
  assertTemporalMessageContext({
    observedAt: input.assistantObservedAt,
    timezone: input.assistantTimezone,
  }, "assistant");
}

function createSystemMessage(content: string): SystemModelMessage {
  return {
    role: "system",
    content,
  };
}

function mergeSystemPrompt(input: {
  fragment: string;
  system?: string | SystemModelMessage | Array<SystemModelMessage>;
}): string | SystemModelMessage | Array<SystemModelMessage> {
  const { fragment, system } = input;
  if (!system) {
    return fragment;
  }

  if (typeof system === "string") {
    return `${system}\n\n${fragment}`;
  }

  if (Array.isArray(system)) {
    return [...system, createSystemMessage(fragment)];
  }

  return [system, createSystemMessage(fragment)];
}

function normalizeText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractTextFromMessageContent(content: ModelMessage["content"]): string | null {
  if (typeof content === "string") {
    return normalizeText(content);
  }

  const parts: string[] = [];

  for (const part of content) {
    if (part.type === "text") {
      const text = normalizeText(part.text);
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function deriveRecallQuery(messages: GoodMemoryModelMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") {
      continue;
    }

    return extractTextFromMessageContent(message.content);
  }

  return null;
}

async function invokeEventCallback<T>(
  callback: ((event: T) => Promise<void> | void) | undefined,
  event: T,
): Promise<void> {
  if (!callback) {
    return;
  }

  try {
    await callback(event);
  } catch (error) {
    console.error("GoodMemory ai-sdk callback failed.", error);
  }
}

function createRecallSkipEvent(input: {
  reason: GoodMemoryRecallSkipReason;
  retrievalProfile: GoodMemoryAISDKRetrievalProfile;
  scope: GoodMemoryGenerateTextInput["scope"];
}): GoodMemoryAISDKEvent {
  return {
    phase: "recall",
    status: "skipped",
    reason: input.reason,
    scope: input.scope,
    retrievalProfile: input.retrievalProfile,
  };
}

function createRememberSkipEvent(input: {
  reason: GoodMemoryRememberSkipReason;
  scope: GoodMemoryGenerateTextInput["scope"];
}): GoodMemoryAISDKEvent {
  return {
    phase: "remember",
    status: "skipped",
    reason: input.reason,
    scope: input.scope,
  };
}

function toRuntimeKitMessages(messages: GoodMemoryModelMessage[]): RuntimeKitMessage[] {
  return messages.map((message) => ({
      role: message.role,
      content: extractTextFromMessageContent(message.content) ?? "",
      ...(message.id !== undefined ? { id: message.id } : {}),
      ...(message.observedAt !== undefined
        ? { observedAt: message.observedAt }
        : {}),
      ...(message.timezone !== undefined ? { timezone: message.timezone } : {}),
  }));
}

function toProviderMessages(messages: GoodMemoryModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    const {
      id: _id,
      observedAt: _observedAt,
      timezone: _timezone,
      ...providerMessage
    } = message;
    return providerMessage as ModelMessage;
  });
}

function mapRuntimeRecallEvent(input: {
  result: RuntimeKitBeforeModelCallResult;
  retrievalProfile: GoodMemoryAISDKRetrievalProfile;
  scope: GoodMemoryGenerateTextInput["scope"];
}): GoodMemoryAISDKEvent {
  const event = input.result.events[0];
  if (event?.status === "applied") {
    return {
      phase: "recall",
      status: "applied",
      scope: input.scope,
      retrievalProfile: input.retrievalProfile,
    };
  }

  return createRecallSkipEvent({
    reason: resolveRecallSkipReason(event?.reason),
    retrievalProfile: input.retrievalProfile,
    scope: input.scope,
  });
}

function resolveRecallSkipReason(
  reason: string | undefined,
): GoodMemoryRecallSkipReason {
  if (
    reason === "ignore_memory" ||
    reason === "no_query" ||
    reason === "empty_context"
  ) {
    return reason;
  }

  return "empty_context";
}

async function prepareMemoryContext(
  config: CreateGoodMemoryAISDKInput,
  runtimeKit: GoodMemoryRuntimeKit,
  input: Pick<
    GoodMemoryGenerateTextInput | GoodMemoryStreamTextInput,
    | "ignoreMemory"
    | "locale"
    | "maxMemoryTokens"
    | "messages"
    | "query"
    | "referenceTime"
    | "retrievalProfile"
    | "scope"
    | "system"
    | "timezone"
  >,
): Promise<PreparedMemoryContext> {
  const retrievalProfile =
    input.retrievalProfile ??
    config.defaultRetrievalProfile ??
    "general_chat";

  const query = normalizeText(input.query ?? "") ?? deriveRecallQuery(input.messages);

  try {
    const result = await runtimeKit.beforeModelCall({
      scope: input.scope,
      ...(query ? { query } : {}),
      locale: input.locale,
      ignoreMemory: input.ignoreMemory,
      retrievalProfile,
      maxMemoryTokens:
        input.maxMemoryTokens ??
        config.defaultMaxMemoryTokens ??
        DEFAULT_MEMORY_FRAGMENT_MAX_TOKENS,
      messages: toRuntimeKitMessages(input.messages),
      referenceTime: input.referenceTime,
      timezone: input.timezone,
    });
    await invokeEventCallback(config.onMemoryEvent, mapRuntimeRecallEvent({
      result,
      retrievalProfile,
      scope: input.scope,
    }));
    const fragment = normalizeText(result.context.content);
    if (!fragment) {
      return {
        retrievalProfile,
        system: input.system,
      };
    }

    return {
      retrievalProfile,
      system: mergeSystemPrompt({
        system: input.system,
        fragment,
      }),
    };
  } catch (error) {
    await invokeEventCallback<GoodMemoryAISDKErrorEvent>(config.onMemoryError, {
      phase: "recall",
      scope: input.scope,
      error,
    });

    return {
      retrievalProfile,
      system: input.system,
    };
  }
}

async function rememberCompletedGeneration(
  config: CreateGoodMemoryAISDKInput,
  runtimeKit: GoodMemoryRuntimeKit,
  input: Pick<
    GoodMemoryGenerateTextInput | GoodMemoryStreamTextInput,
    | "assistantObservedAt"
    | "assistantTimezone"
    | "ignoreMemory"
    | "locale"
    | "messages"
    | "referenceTime"
    | "scope"
    | "timezone"
  >,
  assistantText: string,
  providerObservedAt?: string,
): Promise<void> {
  const runtimeMessages = toRuntimeKitMessages(input.messages);
  if (input.ignoreMemory) {
    await runtimeKit.afterModelCall({
      scope: input.scope,
      locale: input.locale,
      messages: runtimeMessages,
      assistantText,
      assistantObservedAt: input.assistantObservedAt ?? providerObservedAt,
      assistantTimezone: input.assistantTimezone,
      referenceTime: input.referenceTime,
      timezone: input.timezone,
      writeback: { mode: "off" },
    });
    await invokeEventCallback(config.onMemoryEvent, createRememberSkipEvent({
      reason: "ignore_memory",
      scope: input.scope,
    }));
    return;
  }

  const normalizedAssistantText = normalizeText(assistantText);
  if (!normalizedAssistantText) {
    await runtimeKit.afterModelCall({
      scope: input.scope,
      locale: input.locale,
      messages: runtimeMessages,
      assistantText,
      assistantObservedAt: input.assistantObservedAt ?? providerObservedAt,
      assistantTimezone: input.assistantTimezone,
      referenceTime: input.referenceTime,
      timezone: input.timezone,
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "allow",
      },
    });
    await invokeEventCallback(config.onMemoryEvent, createRememberSkipEvent({
      reason: "no_final_assistant_text",
      scope: input.scope,
    }));
    return;
  }

  if (!deriveRecallQuery(input.messages)) {
    await runtimeKit.afterModelCall({
      scope: input.scope,
      locale: input.locale,
      messages: runtimeMessages,
      assistantText: normalizedAssistantText,
      assistantObservedAt: input.assistantObservedAt ?? providerObservedAt,
      assistantTimezone: input.assistantTimezone,
      referenceTime: input.referenceTime,
      timezone: input.timezone,
      writeback: { mode: "off" },
    });
    await invokeEventCallback(config.onMemoryEvent, createRememberSkipEvent({
      reason: "no_text_messages",
      scope: input.scope,
    }));
    return;
  }

  try {
    const result = await runtimeKit.afterModelCall({
      scope: input.scope,
      locale: input.locale,
      messages: runtimeMessages,
      assistantText: normalizedAssistantText,
      assistantObservedAt: input.assistantObservedAt ?? providerObservedAt,
      assistantTimezone: input.assistantTimezone,
      referenceTime: input.referenceTime,
      timezone: input.timezone,
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "allow",
      },
    });
    const rememberResult = result.rememberResult;
    if (!rememberResult) {
      await invokeEventCallback(config.onMemoryEvent, createRememberSkipEvent({
        reason: "no_text_messages",
        scope: input.scope,
      }));
      return;
    }

    await invokeEventCallback(config.onMemoryEvent, {
      phase: "remember",
      status: "succeeded",
      scope: input.scope,
      accepted: rememberResult.accepted,
      rejected: rememberResult.rejected,
    });
  } catch (error) {
    await invokeEventCallback<GoodMemoryAISDKErrorEvent>(config.onMemoryError, {
      phase: "remember",
      scope: input.scope,
      error,
    });
  }
}

const promiseResultProperties = new Set<PropertyKey>([
  "content",
  "text",
  "reasoning",
  "reasoningText",
  "files",
  "sources",
  "toolCalls",
  "staticToolCalls",
  "dynamicToolCalls",
  "staticToolResults",
  "dynamicToolResults",
  "toolResults",
  "finishReason",
  "rawFinishReason",
  "usage",
  "totalUsage",
  "warnings",
  "steps",
  "request",
  "response",
  "providerMetadata",
  "output",
]);

const streamResultProperties = new Set<PropertyKey>([
  "textStream",
  "fullStream",
  "experimental_partialOutputStream",
  "partialOutputStream",
  "elementStream",
]);

function createDeferredPromiseProperty<T>(
  getResult: () => Promise<AISDKStreamTextResult>,
  key: string,
): Promise<T> {
  return getResult().then(
    (result) => result[key as keyof AISDKStreamTextResult] as PromiseLike<T> | T,
  );
}

async function getStreamSource<T>(
  sourceFactory: () => Promise<AsyncIterable<T> | ReadableStream<T>>,
): Promise<
  | { reader: ReadableStreamDefaultReader<T>; iterator?: never }
  | { iterator: AsyncIterator<T>; reader?: never }
> {
  const source = await sourceFactory();
  if (typeof (source as ReadableStream<T>).getReader === "function") {
    return {
      reader: (source as ReadableStream<T>).getReader(),
    };
  }

  return {
    iterator: (source as AsyncIterable<T>)[Symbol.asyncIterator](),
  };
}

function createLazyAsyncIterableStream<T>(
  sourceFactory: () => Promise<AsyncIterable<T> | ReadableStream<T>>,
): AsyncIterableStreamLike<T> {
  let sourcePromise:
    | Promise<
      | { reader: ReadableStreamDefaultReader<T>; iterator?: never }
      | { iterator: AsyncIterator<T>; reader?: never }
    >
    | null = null;

  const getSource = () => {
    sourcePromise ??= getStreamSource(sourceFactory);
    return sourcePromise;
  };

  const stream = new ReadableStream<T>({
    async pull(controller) {
      try {
        const source = await getSource();
        const next = source.reader
          ? await source.reader.read()
          : await source.iterator.next();

        if (next.done) {
          source.reader?.releaseLock();
          controller.close();
          return;
        }

        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      const source = await sourcePromise;
      await source?.reader?.cancel(reason);
      await source?.iterator?.return?.();
      source?.reader?.releaseLock();
    },
  });

  return Object.assign(stream, {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function createDeferredStreamProperty<T>(
  getResult: () => Promise<AISDKStreamTextResult>,
  key: string,
): AsyncIterableStreamLike<T> {
  return createLazyAsyncIterableStream(async () => {
    const result = await getResult();
    return result[key as keyof AISDKStreamTextResult] as
      | AsyncIterable<T>
      | ReadableStream<T>;
  });
}

function createDeferredMethod<TArgs extends unknown[], TResult>(
  getResult: () => Promise<AISDKStreamTextResult>,
  key: string,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    const result = await getResult();
    const method = result[key as keyof AISDKStreamTextResult] as unknown as (
      ...methodArgs: TArgs
    ) => TResult | PromiseLike<TResult>;
    return method.apply(result, args);
  };
}

function splitUIMessageStreamResponseOptions(options: unknown): {
  responseInit: Record<string, unknown>;
  streamOptions: Record<string, unknown>;
} {
  const {
    originalMessages,
    generateMessageId,
    onFinish,
    messageMetadata,
    sendReasoning,
    sendSources,
    sendFinish,
    sendStart,
    onError,
    ...responseInit
  } = options && typeof options === "object"
    ? options as Record<string, unknown>
    : {};

  return {
    responseInit,
    streamOptions: {
      originalMessages,
      generateMessageId,
      onFinish,
      messageMetadata,
      sendReasoning,
      sendSources,
      sendFinish,
      sendStart,
      onError,
    },
  };
}

function createDeferredUIMessageStream(
  getResult: () => Promise<AISDKStreamTextResult>,
  options: unknown,
): AsyncIterableStreamLike<unknown> {
  return createLazyAsyncIterableStream(async () => {
    const result = await getResult();
    return result.toUIMessageStream(options as never) as AsyncIterable<unknown>;
  });
}

function createDeferredStreamTextResult(
  resultFactory: () => Promise<AISDKStreamTextResult>,
): AISDKStreamTextResult {
  let resultPromise: Promise<AISDKStreamTextResult> | null = null;
  const getResult = () => {
    resultPromise ??= resultFactory();
    return resultPromise;
  };

  return new Proxy({}, {
    get(_target, property) {
      if (promiseResultProperties.has(property)) {
        return createDeferredPromiseProperty(getResult, property as string);
      }

      if (streamResultProperties.has(property)) {
        return createDeferredStreamProperty(getResult, property as string);
      }

      if (property === "consumeStream") {
        return createDeferredMethod(getResult, "consumeStream");
      }

      if (property === "toUIMessageStream") {
        return (options?: unknown) =>
          createDeferredUIMessageStream(getResult, options);
      }

      if (property === "pipeUIMessageStreamToResponse") {
        return (response: unknown, options?: unknown) => {
          const { responseInit, streamOptions } =
            splitUIMessageStreamResponseOptions(options);
          aiPipeUIMessageStreamToResponse({
            response,
            stream: createDeferredUIMessageStream(getResult, streamOptions),
            ...responseInit,
          } as never);
        };
      }

      if (property === "pipeTextStreamToResponse") {
        return (response: unknown, init?: ResponseInit) => {
          aiPipeTextStreamToResponse({
            response,
            textStream: createDeferredStreamProperty<string>(
              getResult,
              "textStream",
            ),
            ...init,
          } as never);
        };
      }

      if (property === "toUIMessageStreamResponse") {
        return (options?: unknown) => {
          const { responseInit, streamOptions } =
            splitUIMessageStreamResponseOptions(options);
          return createUIMessageStreamResponse({
            stream: createDeferredUIMessageStream(getResult, streamOptions),
            ...responseInit,
          } as never);
        };
      }

      if (property === "toTextStreamResponse") {
        return (init?: ResponseInit) =>
          createTextStreamResponse({
            textStream: createDeferredStreamProperty<string>(
              getResult,
              "textStream",
            ),
            ...init,
          });
      }

      return undefined;
    },
  }) as AISDKStreamTextResult;
}

export function createGoodMemoryAISDK(
  input: CreateGoodMemoryAISDKInput,
): GoodMemoryAISDK {
  const generateTextDependency =
    input.dependencies?.generateText ?? aiGenerateText;
  const streamTextDependency =
    input.dependencies?.streamText ?? aiStreamText;
  const runtimeKit = createGoodMemoryRuntimeKit({
    memory: input.memory,
    defaultContextMode: "fragment",
    defaultMaxMemoryTokens:
      input.defaultMaxMemoryTokens ?? DEFAULT_MEMORY_FRAGMENT_MAX_TOKENS,
  });

  return {
    async generateText<TOOLS extends ToolSet = ToolSet>(
      callInput: GoodMemoryGenerateTextInput<TOOLS>,
    ): Promise<AISDKGenerateTextResult> {
      const turnInput = {
        ...callInput,
        referenceTime: callInput.referenceTime ?? new Date().toISOString(),
      };
      assertAISDKTemporalContext(turnInput);
      const prepared = await prepareMemoryContext(input, runtimeKit, turnInput);
      const onFinish = callInput.onFinish;
      const {
        assistantObservedAt: _assistantObservedAt,
        assistantTimezone: _assistantTimezone,
        ignoreMemory: _ignoreMemory,
        locale: _locale,
        maxMemoryTokens: _maxMemoryTokens,
        messages: _messages,
        onFinish: _onFinish,
        query: _query,
        referenceTime: _referenceTime,
        retrievalProfile: _retrievalProfile,
        scope: _scope,
        system: _system,
        timezone: _timezone,
        ...providerInput
      } = turnInput;

      return generateTextDependency({
        ...providerInput,
        system: prepared.system,
        messages: toProviderMessages(callInput.messages),
        onFinish: async (event) => {
          await rememberCompletedGeneration(
            input,
            runtimeKit,
            turnInput,
            event.text,
            event.response?.timestamp?.toISOString(),
          );
          if (onFinish) {
            await onFinish(event as never);
          }
        },
      });
    },
    streamText<TOOLS extends ToolSet = ToolSet>(
      callInput: GoodMemoryStreamTextInput<TOOLS>,
    ): AISDKStreamTextResult {
      return createDeferredStreamTextResult(async () => {
        const turnInput = {
          ...callInput,
          referenceTime: callInput.referenceTime ?? new Date().toISOString(),
        };
        assertAISDKTemporalContext(turnInput);
        const prepared = await prepareMemoryContext(input, runtimeKit, turnInput);
        const onFinish = callInput.onFinish;
        const {
          assistantObservedAt: _assistantObservedAt,
          assistantTimezone: _assistantTimezone,
          ignoreMemory: _ignoreMemory,
          locale: _locale,
          maxMemoryTokens: _maxMemoryTokens,
          messages: _messages,
          onFinish: _onFinish,
          query: _query,
          referenceTime: _referenceTime,
          retrievalProfile: _retrievalProfile,
          scope: _scope,
          system: _system,
          timezone: _timezone,
          ...providerInput
        } = turnInput;

        return streamTextDependency({
          ...providerInput,
          system: prepared.system,
          messages: toProviderMessages(callInput.messages),
          onFinish: async (event) => {
            await rememberCompletedGeneration(
              input,
              runtimeKit,
              turnInput,
              event.text,
              event.response?.timestamp?.toISOString(),
            );
            if (onFinish) {
              await onFinish(event as never);
            }
          },
        });
      });
    },
  };
}
