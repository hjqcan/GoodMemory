import { describe, expect, it, spyOn } from "bun:test";

import { createGoodMemory } from "../../src";
import { EXPERIENCES_COLLECTION } from "../../src/evolution/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

function createFixture() {
  const documentStore = createInMemoryDocumentStore();
  const spans: unknown[] = [];
  const memory = createGoodMemory({
    adapters: { documentStore },
    observability: {
      traceSink: {
        emit(span) {
          spans.push(span);
        },
      },
    },
    storage: { provider: "memory" },
    testing: {
      now: () => new Date("2026-04-17T00:00:00.000Z"),
    },
  });

  return { documentStore, memory, spans };
}

describe("public mutation storage-safe admission", () => {
  it("rejects a NUL-containing forget memoryId before tracing or store access", async () => {
    const { documentStore, memory, spans } = createFixture();
    const getDocument = spyOn(documentStore, "get");

    await expect(memory.forget({
      memoryId: "fact\u0000unsafe",
      scope: { userId: "forget-storage-safe" },
    })).rejects.toMatchObject({
      code: "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT",
      path: "input.memoryId",
    });

    expect(spans).toEqual([]);
    expect(getDocument).not.toHaveBeenCalled();
    expect(await documentStore.query(EXPERIENCES_COLLECTION)).toEqual([]);
  });

  it("rejects a NUL-containing maintenance job before tracing or durable writes", async () => {
    const { documentStore, memory, spans } = createFixture();
    const getDocument = spyOn(documentStore, "get");
    const setDocument = spyOn(documentStore, "set");

    await expect(memory.runMaintenance({
      // @ts-expect-error Exercise malformed input arriving across the runtime API boundary.
      jobs: ["dedupe\u0000"],
      scope: { userId: "maintenance-job-storage-safe" },
    })).rejects.toMatchObject({
      code: "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT",
      path: "input.jobs[0]",
    });

    expect(spans).toEqual([]);
    expect(getDocument).not.toHaveBeenCalled();
    expect(setDocument).not.toHaveBeenCalled();
    expect(await documentStore.query(EXPERIENCES_COLLECTION)).toEqual([]);
  });

  it("rejects a NUL-containing maintenance lastRunAt before tracing or durable writes", async () => {
    const { documentStore, memory, spans } = createFixture();
    const getDocument = spyOn(documentStore, "get");
    const setDocument = spyOn(documentStore, "set");

    await expect(memory.runMaintenance({
      jobs: ["dedupe"],
      lastRunAt: "2026-04-01T00:00:00.000Z\u0000",
      scope: { userId: "maintenance-time-storage-safe" },
    })).rejects.toMatchObject({
      code: "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT",
      path: "input.lastRunAt",
    });

    expect(spans).toEqual([]);
    expect(getDocument).not.toHaveBeenCalled();
    expect(setDocument).not.toHaveBeenCalled();
    expect(await documentStore.query(EXPERIENCES_COLLECTION)).toEqual([]);
  });
});
