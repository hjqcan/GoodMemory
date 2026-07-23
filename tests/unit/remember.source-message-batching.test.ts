import { describe, expect, it } from "bun:test";
import {
  SOURCE_MESSAGES_COLLECTION,
  type SourceMessageRecord,
} from "../../src/evidence/contracts";
import { createRememberEngine } from "../../src/remember/engine";
import type { MemoryExtractionInput } from "../../src/remember/candidates";
import {
  type ConditionalDocumentWriteBatch,
  type ProjectionCapableDocumentStore,
} from "../../src/storage/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createDeterministicIdGenerator } from "../../src/testing/utils";

function createCountingStore() {
  const inner = createInMemoryDocumentStore();
  const sourceBatches: ConditionalDocumentWriteBatch[] = [];
  const store: ProjectionCapableDocumentStore = {
    ...inner,
    async writeBatchIfUnchanged(input) {
      if (
        input.set.some((operation) =>
          operation.collection === SOURCE_MESSAGES_COLLECTION
        )
      ) {
        sourceBatches.push(structuredClone(input));
      }
      return inner.writeBatchIfUnchanged(input);
    },
  };
  return { inner, sourceBatches, store };
}

function createEngine(
  documentStore: ProjectionCapableDocumentStore,
  now: () => string,
) {
  return createRememberEngine({
    createId: createDeterministicIdGenerator("memory"),
    documentStore,
    extractor: {
      async extract() {
        return { candidates: [], ignoredMessageCount: 0 };
      },
    },
    now,
    repositories: createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    }),
  });
}

const scope = {
  sessionId: "session-source-batch",
  userId: "user-source-batch",
};

const messages: MemoryExtractionInput["messages"] = [
  { content: "First immutable source.", id: "message-1", role: "user" },
  { content: "Second immutable source.", id: "message-2", role: "assistant" },
  { content: "Third immutable source.", id: "message-3", role: "user" },
];

describe("remember source-message batching", () => {
  it("commits all allowed source messages in one conditional batch", async () => {
    const { sourceBatches, store } = createCountingStore();
    const engine = createEngine(store, () => "2026-07-23T20:00:00.000Z");

    await engine.remember({ messages, scope });

    expect(sourceBatches).toHaveLength(1);
    expect(
      sourceBatches[0]!.set.filter(({ collection }) =>
        collection === SOURCE_MESSAGES_COLLECTION
      ),
    ).toHaveLength(3);
    expect(
      await store.query<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        scope,
      ),
    ).toHaveLength(3);
  });

  it("constrains an existing immutable record and batches only missing records", async () => {
    let timestamp = "2026-07-23T20:00:00.000Z";
    const { sourceBatches, store } = createCountingStore();
    const engine = createEngine(store, () => timestamp);

    await engine.remember({ messages: [messages[0]!], scope });
    const existing = (
      await store.query<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        scope,
      )
    )[0]!;
    sourceBatches.length = 0;
    timestamp = "2026-07-23T21:00:00.000Z";

    await engine.remember({ messages, scope });

    expect(sourceBatches).toHaveLength(1);
    expect(
      sourceBatches[0]!.set.filter(({ collection }) =>
        collection === SOURCE_MESSAGES_COLLECTION
      ),
    ).toHaveLength(2);
    expect([
      sourceBatches[0]!.expected,
      ...(sourceBatches[0]!.unchanged ?? []),
    ]).toContainEqual({
      collection: SOURCE_MESSAGES_COLLECTION,
      document: existing,
      id: existing.id,
    });
    expect(
      await store.get<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        existing.id,
      ),
    ).toEqual(existing);
  });
});
