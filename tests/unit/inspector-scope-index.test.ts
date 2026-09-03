import { describe, expect, it } from "bun:test";
import { scopeToKey } from "../../src/domain/scope";
import type { ScopeSummary } from "../../src/inspector/contracts";
import { listScopes } from "../../src/inspector/scopeIndex";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

const FIXED_NOW = (): Date => new Date("2026-07-07T00:00:00.000Z");

function byKey(scopes: ScopeSummary[], scope: Parameters<typeof scopeToKey>[0]): ScopeSummary {
  const key = scopeToKey(scope);
  const found = scopes.find((summary) => summary.scopeKey === key);
  if (!found) {
    throw new Error(`scope ${key} not found in index`);
  }
  return found;
}

describe("listScopes", () => {
  it("discovers distinct scopes with per-collection counts, recency, and coverage", async () => {
    const store = createInMemoryDocumentStore();

    // Scope A = {userId: userA}: two facts + one preference + one profile.
    await store.set("facts", "f1", {
      id: "f1",
      userId: "userA",
      content: "A1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await store.set("facts", "f2", {
      id: "f2",
      userId: "userA",
      content: "A2",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await store.set("preferences", "p1", {
      id: "p1",
      userId: "userA",
      category: "ui",
      value: "dark",
      updatedAt: "2026-02-15T00:00:00.000Z",
    });
    await store.set("profiles", "userA", {
      userId: "userA",
      identity: {},
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    // Scope B = {userId: userA, sessionId: S}: a distinct tuple, one fact.
    await store.set("facts", "f3", {
      id: "f3",
      userId: "userA",
      sessionId: "S",
      content: "B1",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    // Scope C = {userId: userB, tenantId: T}: a reference + a nested-scope spill.
    await store.set("references", "r1", {
      id: "r1",
      userId: "userB",
      tenantId: "T",
      title: "Runbook",
      pointer: "docs/runbook.md",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    await store.set("artifact_spills", "sp1", {
      id: "sp1",
      scope: { userId: "userB", tenantId: "T" },
      kind: "tool_result",
      sourceId: "src-1",
      preview: "…",
      replacementText: "…",
      storageUri: "mem://sp1",
      originalBytes: 1024,
      createdAt: "2026-05-20T00:00:00.000Z",
    });

    // Malformed record with no userId — must be skipped, not counted as a scope.
    await store.set("facts", "bad", { id: "bad", content: "orphan" });

    const result = await listScopes({ documentStore: store, now: FIXED_NOW });

    expect(result.generatedAt).toBe("2026-07-07T00:00:00.000Z");
    expect(result.scopes).toHaveLength(3);

    const scopeA = byKey(result.scopes, { userId: "userA" });
    expect(scopeA.counts).toEqual({ facts: 2, preferences: 1, profiles: 1 });
    expect(scopeA.totalRecords).toBe(4);
    expect(scopeA.lastUpdatedAt).toBe("2026-06-01T00:00:00.000Z");

    const scopeB = byKey(result.scopes, { userId: "userA", sessionId: "S" });
    expect(scopeB.counts).toEqual({ facts: 1 });
    expect(scopeB.totalRecords).toBe(1);
    expect(scopeB.lastUpdatedAt).toBe("2026-04-01T00:00:00.000Z");

    const scopeC = byKey(result.scopes, { userId: "userB", tenantId: "T" });
    expect(scopeC.counts).toEqual({ references: 1, artifact_spills: 1 });
    expect(scopeC.totalRecords).toBe(2);
    expect(scopeC.lastUpdatedAt).toBe("2026-05-20T00:00:00.000Z");

    // Sorted by record count descending: A (4) leads.
    expect(result.scopes[0]?.scopeKey).toBe(scopeToKey({ userId: "userA" }));

    // Coverage: all 12 durable collections scanned; session/vector disclosed.
    expect(result.coverage.collectionsScanned).toHaveLength(13);
    expect(result.coverage.collectionsScanned).toContain("facts");
    expect(result.coverage.collectionsScanned).toContain("artifact_spills");
    expect(result.coverage.sessionStoreScanned).toBe(false);
    expect(result.coverage.vectorStoreScanned).toBe(false);
    expect(result.coverage.blindSpots.some((note) => note.includes("Session-only"))).toBe(true);
    expect(result.coverage.blindSpots.some((note) => note.includes("Vector-only"))).toBe(true);

    // Pure read: the store is untouched (the orphan fact still counts as stored).
    expect(await store.query("facts")).toHaveLength(4);
  });

  it("returns no scopes but still discloses coverage for an empty store", async () => {
    const store = createInMemoryDocumentStore();

    const result = await listScopes({ documentStore: store, now: FIXED_NOW });

    expect(result.scopes).toEqual([]);
    expect(result.coverage.collectionsScanned).toHaveLength(13);
    expect(result.coverage.blindSpots.length).toBeGreaterThanOrEqual(3);
  });

  it("discloses a collection it could not scan without dropping the others", async () => {
    const base = createInMemoryDocumentStore();
    await base.set("preferences", "p1", {
      id: "p1",
      userId: "userA",
      category: "ui",
      value: "dark",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const store = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return async (collection: string, filter?: unknown) => {
            if (collection === "facts") {
              throw new Error("boom");
            }
            return (target.query as (c: string, f?: unknown) => Promise<unknown[]>)(
              collection,
              filter,
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await listScopes({ documentStore: store, now: FIXED_NOW });

    expect(result.coverage.collectionsScanned).not.toContain("facts");
    expect(result.coverage.blindSpots.some((note) => note.includes('"facts"'))).toBe(true);
    expect(result.scopes).toHaveLength(1);
  });
});
