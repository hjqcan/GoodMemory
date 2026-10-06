import { expect, it } from "bun:test";
import { createPostgresDocumentStore, createPostgresVectorStore } from "../../src/storage/postgres";

// No database fixture is contacted: each operation must refuse/return before
// SQL execution. These tests do not establish live PostgreSQL semantics.
const config = { url: "postgres://127.0.0.1:9/goodmemory_preconnection_guard" };

for (const readOnly of [false, true]) {
  it(`refuses query-set snapshots before serializing any mutation when readOnly=${readOnly}`, async () => {
    const store = createPostgresDocumentStore(config, { readOnly });
    let serializationCalls = 0;
    const document = { toJSON() { serializationCalls++; throw new Error("must never serialize refused mutation"); } };
    await expect(store.writeBatchIfUnchanged!({ expected: { collection: "facts", id: "target", document: null },
      querySnapshots: [{ collection: "facts", filter: { userId: "author" }, documents: [] }],
      set: [{ collection: "facts", id: "target", document }] })).rejects.toThrow("Postgres conditional query snapshots are unsupported.");
    expect(serializationCalls).toBe(0);
  });
}

it("keeps empty vector searches as preconnection no-ops and rejects readonly writes", async () => {
  const store = createPostgresVectorStore(config, { readOnly: true });
  expect(await store.search("facts", [1, 0], { topK: 0 })).toEqual([]);
  expect(await store.search("facts", [], { topK: 1 })).toEqual([]);
  await expect(store.upsert("facts", [{ id: "forbidden", content: "must not write", embedding: [1, 0], metadata: {} }])).rejects.toThrow("read-only");
  await expect(store.delete("facts", "forbidden")).rejects.toThrow("read-only");
});
