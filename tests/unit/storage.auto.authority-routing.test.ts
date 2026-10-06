import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createAutoStorageAdapters } from "../../src/storage/auto";
import { createInMemoryDocumentStore, createInMemorySessionStore, createInMemoryVectorStore } from "../../src/storage/memory";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";
import { canBootstrapPostgresStorageBackend, setPostgresPublicModuleLoaderForTests } from "../../src/storage/postgresPublic";

// Test the existing backend-selection seam, not the Postgres SQL engine.
afterEach(() => setPostgresPublicModuleLoaderForTests(null));

function backend(probe: () => Promise<boolean>) {
  const documentStore = createInMemoryDocumentStore();
  const sessionStore = createInMemorySessionStore();
  const vectorStore = createInMemoryVectorStore();
  const counts = { probe: 0, document: 0, session: 0, vector: 0 };
  setPostgresPublicModuleLoaderForTests(async () => ({
    async canBootstrapPostgresStorageBackend() { counts.probe++; return probe(); },
    createPostgresDocumentStore() { counts.document++; return documentStore; },
    createPostgresSessionStore() { counts.session++; return sessionStore; },
    createPostgresVectorStore() { counts.vector++; return vectorStore; },
    async migratePostgresStorageBackend() {},
  }));
  return { documentStore, sessionStore, vectorStore, counts };
}

it("shares one successful durable-authority probe and forwards all three stores without selecting SQLite", async () => {
  const directory = mkdtempSync("/tmp/gm-auto-authority-");
  try {
    const path = join(directory, "decoy.sqlite");
    const decoy = createSQLiteDocumentStore(path);
    await decoy.set("facts", "target", { text: "local decoy" });
    const selected = backend(async () => true);
    await selected.documentStore.set("facts", "target", { text: "selected authority" });
    const scope = { userId: "routing-test", sessionId: "session" };
    const state = { userId: scope.userId, sessionId: scope.sessionId, currentGoal: "selected goal", openLoops: [], temporaryDecisions: [], updatedAt: "2026-10-06T00:00:00Z" };
    await selected.sessionStore.saveWorkingMemory(scope, state);
    const vector = { id: "vector", content: "selected vector", embedding: [1, 0], metadata: { userId: scope.userId } };
    await selected.vectorStore.upsert("facts", [vector]);
    const adapters = createAutoStorageAdapters({ postgresUrl: "postgres://fixture.invalid/authority", sqliteUrl: path });
    expect(await Promise.all([adapters.documentStore.get("facts", "target"), adapters.sessionStore.getWorkingMemory(scope), adapters.vectorStore.get("facts", "vector")])).toEqual([
      { text: "selected authority" }, state, vector,
    ]);
    await adapters.documentStore.set("facts", "new", { text: "new authority record" });
    expect(await selected.documentStore.get("facts", "new")).toEqual({ text: "new authority record" });
    expect(await decoy.get("facts", "new")).toBeNull();
    expect(await decoy.get("facts", "target")).toEqual({ text: "local decoy" });
    expect(selected.counts).toEqual({ probe: 1, document: 1, session: 1, vector: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("uses the configured SQLite fallback only after a definite negative capability probe", async () => {
  const directory = mkdtempSync("/tmp/gm-auto-negative-");
  try {
    const selected = backend(async () => false);
    const path = join(directory, "local.sqlite");
    const adapters = createAutoStorageAdapters({ postgresUrl: "postgres://fixture.invalid/unavailable", sqliteUrl: path });
    await adapters.documentStore.set("facts", "local", { text: "local fallback" });
    expect(await createSQLiteDocumentStore(path).get("facts", "local")).toEqual({ text: "local fallback" });
    expect(await selected.documentStore.get("facts", "local")).toBeNull();
    expect(selected.counts).toEqual({ probe: 1, document: 0, session: 0, vector: 0 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const [error, description] of [["probe refused", "probe refused"], [new Error(""), "Error"]] as const) {
  it(`fails closed and preserves the local decoy when a probe throws ${description}`, async () => {
    const directory = mkdtempSync("/tmp/gm-auto-refused-");
    try {
      const path = join(directory, "decoy.sqlite");
      const decoy = createSQLiteDocumentStore(path);
      await decoy.set("facts", "target", { text: "local decoy" });
      const selected = backend(async () => { throw error; });
      const adapters = createAutoStorageAdapters({ postgresUrl: "postgres://fixture.invalid/inconclusive", sqliteUrl: path });
      await expect(adapters.documentStore.get("facts", "target")).rejects.toThrow(`Underlying error: ${description}`);
      await expect(adapters.documentStore.set("facts", "new", { text: "must not silently fall back" })).rejects.toThrow("could not establish");
      expect(await decoy.get("facts", "target")).toEqual({ text: "local decoy" });
      expect(await decoy.get("facts", "new")).toBeNull();
      expect(selected.counts).toEqual({ probe: 1, document: 0, session: 0, vector: 0 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

for (const [failure, detail] of [["runtime loader refused", "runtime loader refused"], [new Error(""), "Error"]] as const) {
  it(`reports a useful deferred runtime error for ${detail} and retries loading`, async () => {
    let loads = 0;
    setPostgresPublicModuleLoaderForTests(async () => { loads++; throw failure; });
    const config = { url: "postgres://fixture.invalid/unavailable-runtime" };
    await expect(canBootstrapPostgresStorageBackend(config)).rejects.toThrow(`Underlying error: ${detail}`);
    await expect(canBootstrapPostgresStorageBackend(config)).rejects.toThrow("built-in Postgres storage is unavailable in this runtime");
    expect(loads).toBe(2);
  });
}
