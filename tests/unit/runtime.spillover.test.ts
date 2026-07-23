import { describe, expect, it } from "bun:test";
import type { DocumentStore } from "../../src/storage/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";
import {
  ARTIFACT_SPILL_COLLECTION,
  ARTIFACT_SPILL_PAYLOAD_COLLECTION,
  createArtifactSpilloverService,
} from "../../src/runtime/spillover";
import type { ArtifactSpillPayloadRecord } from "../../src/runtime/spillover";

describe("artifact spillover service", () => {
  it("creates previews for oversized content and persists a spill record", async () => {
    const service = createArtifactSpilloverService({
      documentStore: createInMemoryDocumentStore(),
      previewChars: 24,
    });

    const record = await service.spill(
      { userId: "u-1", sessionId: "s-1" },
      {
        kind: "tool_result",
        sourceId: "tool-1",
        content:
          "This is a very long tool result that should not remain inline in the prompt.",
      },
    );

    expect(record.preview).toBe("This is a very long tool...");
    expect(record.replacementText).toContain("tool_result");
    expect(record.originalBytes).toBeGreaterThan(24);
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/u);

    const loaded = await service.getBySource(
      { userId: "u-1", sessionId: "s-1" },
      "tool-1",
    );
    expect(loaded).toEqual(record);
    expect(
      await service.resolve(
        { userId: "u-1", sessionId: "s-1" },
        record.storageUri,
      ),
    ).toBe(
      "This is a very long tool result that should not remain inline in the prompt.",
    );
  });

  it("reuses stable replacement text for the same source in one session lifecycle", async () => {
    const service = createArtifactSpilloverService({
      documentStore: createInMemoryDocumentStore(),
      previewChars: 18,
    });
    const scope = { userId: "u-1", sessionId: "s-1" };

    const first = await service.spill(scope, {
      kind: "retrieval_result",
      sourceId: "search-1",
      content: "First retrieval payload that is too large to inject verbatim.",
    });

    const second = await service.spill(scope, {
      kind: "retrieval_result",
      sourceId: "search-1",
      content: "Updated retrieval payload that should reuse the same replacement token.",
    });

    expect(second.replacementText).toBe(first.replacementText);
    expect(second.id).toBe(first.id);
    expect(second.preview).toBe("Updated retrieval...");
    expect(second.storageUri).not.toBe(first.storageUri);
    expect(await service.resolve(scope, first.storageUri)).toBe(
      "First retrieval payload that is too large to inject verbatim.",
    );
    expect(await service.resolve(scope, second.storageUri)).toBe(
      "Updated retrieval payload that should reuse the same replacement token.",
    );
  });

  it("creates independent replacement tokens across different sessions", async () => {
    const service = createArtifactSpilloverService({
      documentStore: createInMemoryDocumentStore(),
      previewChars: 18,
    });

    const first = await service.spill(
      { userId: "u-1", sessionId: "s-1" },
      {
        kind: "search_result",
        sourceId: "shared-source",
        content: "Session one payload",
      },
    );
    const second = await service.spill(
      { userId: "u-1", sessionId: "s-2" },
      {
        kind: "search_result",
        sourceId: "shared-source",
        content: "Session two payload",
      },
    );

    expect(second.replacementText).not.toBe(first.replacementText);
  });

  it("refuses to replay a payload whose content no longer matches its hash", async () => {
    const documentStore = createInMemoryDocumentStore();
    const service = createArtifactSpilloverService({ documentStore });
    const scope = { userId: "u-1", sessionId: "s-1" };
    const record = await service.spill(scope, {
      kind: "tool_result",
      sourceId: "tool-corrupted",
      content: "Original immutable payload",
    });
    const [payload] = await documentStore.query<ArtifactSpillPayloadRecord>(
      ARTIFACT_SPILL_PAYLOAD_COLLECTION,
    );
    if (!payload) {
      throw new Error("Expected the spill payload to be persisted.");
    }
    await documentStore.set(ARTIFACT_SPILL_PAYLOAD_COLLECTION, payload.id, {
      ...payload,
      content: "Corrupted payload",
    });

    expect(await service.resolve(scope, record.storageUri)).toBeNull();
  });

  it("retries a concurrent same-source spill after its atomic compare-and-set loses", async () => {
    const inner = createInMemoryDocumentStore();
    let releaseSecondRead: (() => void) | undefined;
    const secondRead = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });
    let releaseSecondBatch: (() => void) | undefined;
    const secondBatch = new Promise<void>((resolve) => {
      releaseSecondBatch = resolve;
    });
    let pointerReads = 0;
    let batchCalls = 0;
    const documentStore: DocumentStore = {
      ...inner,
      async get(collection, id) {
        const value = await inner.get(collection, id);
        if (collection !== ARTIFACT_SPILL_COLLECTION) {
          return value;
        }
        pointerReads += 1;
        if (pointerReads === 1) {
          await secondRead;
        } else if (pointerReads === 2) {
          releaseSecondRead?.();
        }
        return value;
      },
      async writeBatchIfUnchanged(input) {
        batchCalls += 1;
        if (batchCalls === 1) {
          await secondBatch;
        } else if (batchCalls === 2) {
          releaseSecondBatch?.();
        }
        return inner.writeBatchIfUnchanged(input);
      },
    };
    const service = createArtifactSpilloverService({ documentStore });
    const scope = { userId: "u-cas", sessionId: "s-cas" };

    const [first, second] = await Promise.all([
      service.spill(scope, {
        kind: "tool_result",
        sourceId: "shared-source",
        content: "First concurrent payload",
      }),
      service.spill(scope, {
        kind: "tool_result",
        sourceId: "shared-source",
        content: "Second concurrent payload",
      }),
    ]);

    expect(batchCalls).toBe(3);
    expect(await service.getBySource(scope, "shared-source")).toEqual(first);
    expect(await service.resolve(scope, first.storageUri)).toBe(
      "First concurrent payload",
    );
    expect(await service.resolve(scope, second.storageUri)).toBe(
      "Second concurrent payload",
    );
  });

  it("does not leave an orphan payload when the atomic spill commit fails", async () => {
    const inner = createInMemoryDocumentStore();
    const documentStore: DocumentStore = {
      ...inner,
      async set(collection, id, document) {
        if (collection === ARTIFACT_SPILL_COLLECTION) {
          throw new Error("simulated pointer write failure");
        }
        return inner.set(collection, id, document);
      },
      async writeBatchIfUnchanged() {
        throw new Error("simulated atomic storage failure");
      },
    };
    const service = createArtifactSpilloverService({ documentStore });
    const scope = { userId: "u-failure", sessionId: "s-failure" };

    await expect(service.spill(scope, {
      kind: "tool_result",
      sourceId: "failed-source",
      content: "Payload that must not become orphaned",
    })).rejects.toThrow("simulated atomic storage failure");

    expect(await inner.query(ARTIFACT_SPILL_PAYLOAD_COLLECTION)).toEqual([]);
    expect(await inner.query(ARTIFACT_SPILL_COLLECTION)).toEqual([]);
  });

  it("replays an atomically committed spill after the service is recreated", async () => {
    const inner = createInMemoryDocumentStore();
    const documentStore: DocumentStore = {
      ...inner,
      async set(collection) {
        if (
          collection === ARTIFACT_SPILL_COLLECTION ||
          collection === ARTIFACT_SPILL_PAYLOAD_COLLECTION
        ) {
          throw new Error("spill records require an atomic batch");
        }
      },
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
    };
    const scope = { userId: "u-restart", sessionId: "s-restart" };
    const beforeRestart = createArtifactSpilloverService({ documentStore });
    const record = await beforeRestart.spill(scope, {
      kind: "retrieval_result",
      sourceId: "restart-source",
      content: "Exact content survives service reconstruction",
    });

    const afterRestart = createArtifactSpilloverService({ documentStore });

    expect(await afterRestart.getBySource(scope, "restart-source")).toEqual(record);
    expect(await afterRestart.resolve(scope, record.storageUri)).toBe(
      "Exact content survives service reconstruction",
    );
  });
});
