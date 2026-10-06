import { expect, it } from "bun:test";
import { createInMemoryDocumentStore } from "../../src/storage/memory";
import { createScopeDeletionAwareDocumentStore } from "../../src/storage/scopeDeletion";

it("treats an absent document update as a checked no-op", async () => {
  const raw = createInMemoryDocumentStore();
  const store = createScopeDeletionAwareDocumentStore(raw);
  await store.update("facts", "absent", { text: "must not create" });
  expect(await raw.get("facts", "absent")).toBeNull();
  expect(await raw.query("facts")).toEqual([]);
});

it("updates a concurrently inserted document instead of losing it after an absent read", async () => {
  const raw = createInMemoryDocumentStore();
  let inserted = false;
  const store = createScopeDeletionAwareDocumentStore({ ...raw,
    async writeBatchIfUnchanged(batch) {
      if (!inserted && batch.expected.id === "target" && batch.expected.document === null) {
        inserted = true;
        await raw.set("facts", "target", { text: "concurrent original", preserved: "keep" });
      }
      return raw.writeBatchIfUnchanged!(batch);
    },
  });
  await store.update("facts", "target", { text: "updated" });
  expect(inserted).toBe(true);
  expect(await raw.get("facts", "target")).toEqual({ text: "updated", preserved: "keep" });
});

it("bounds retries on persistent point conflicts and leaves the stored document unchanged", async () => {
  const raw = createInMemoryDocumentStore();
  await raw.set("facts", "target", { text: "original" });
  let attempts = 0;
  const store = createScopeDeletionAwareDocumentStore({ ...raw,
    async writeBatchIfUnchanged() { attempts++; return false; },
  });
  await expect(store.update("facts", "target", { text: "replacement" })).rejects.toThrow("Document changed repeatedly while updating facts/target");
  expect(attempts).toBe(8);
  expect(await raw.get("facts", "target")).toEqual({ text: "original" });
});
