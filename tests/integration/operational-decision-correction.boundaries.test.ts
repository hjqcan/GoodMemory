import { describe, expect, it } from "bun:test";
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore } from "../../src";
import type { FactMemory } from "../../src/domain/records";

const scope = { userId: "public-correction-v2", workspaceId: "public" };
const old = "Project decision: We deploy MarlinApp with blue-green releases.";
const next = "Project decision: We now deploy MarlinApp with canary releases instead of blue-green releases.";
const now = "2026-10-06T12:00:00.000Z";
function fixture() {
  const store = createInMemoryDocumentStore();
  const memory = createGoodMemory({ storage: { provider: "memory" },
    adapters: { documentStore: store, sessionStore: createInMemorySessionStore() }, testing: { now: () => new Date(now) } });
  const write = (content: string, observedAt?: string, id = content) => memory.remember({ scope,
    messages: [{ id, role: "user", content, ...(observedAt ? { observedAt } : {}) }] });
  return { store, memory, write };
}

describe("operational correction observation order", () => {
  it.each([
    ["2026-10-05T00:00:00Z", "2026-09-01T00:00:00Z", "stale_fact_correction_source"],
    ["2026-10-05T00:00:00Z", "2026-10-05T00:00:00Z", "unordered_fact_correction_source"],
    ["2026-10-05T00:00:00Z", undefined, "unordered_fact_correction_source"],
    [undefined, "2026-10-05T00:00:00Z", "unordered_fact_correction_source"],
    ["2026-10-05T00:00:00Z", "2026-12-01T00:00:00Z", "not_current_fact_correction_source"],
  ])("refuses unsupported order %s -> %s", async (beforeAt, afterAt, reason) => {
    const f = fixture(); await f.write(old, beforeAt);
    expect((await f.write(next, afterAt)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason }));
    expect((await f.store.query<FactMemory>("facts")).filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([old]);
  });

  it.each([[undefined, undefined], ["2026-09-01T00:00:00Z", "2026-10-05T00:00:00Z"]])
  ("allows an undated authored replacement or positively ordered observations", async (beforeAt, afterAt) => {
    const f = fixture(); await f.write(old, beforeAt);
    expect((await f.write(next, afterAt)).events).toContainEqual(expect.objectContaining({ outcome: "superseded" }));
  });

  it("uses all supporting author observations rather than the first stored source", async () => {
    const f = fixture(); await f.write(old, "2026-09-01T00:00:00Z", "old-first");
    await f.write(old, "2026-10-05T00:00:00Z", "old-reaffirmed");
    expect((await f.write(next, "2026-10-01T00:00:00Z")).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "stale_fact_correction_source" }));
    expect((await f.store.query<FactMemory>("facts")).find(fact => fact.content === old)?.lifecycle).toBe("active");
  });

  it("fails closed for mixed dated and undated supporting observations", async () => {
    const f = fixture(); await f.write(old, undefined, "old-undated");
    await f.write(old, "2026-09-01T00:00:00Z", "old-dated");
    expect((await f.write(next, "2026-10-05T00:00:00Z")).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "unordered_fact_correction_source" }));
  });

  it("does not retire a target outside its current validity window", async () => {
    const f = fixture(); await f.write(old);
    const target = (await f.store.query<FactMemory>("facts"))[0]!;
    await f.store.set("facts", target.id, { ...target, validFrom: "2026-12-01T00:00:00Z" });
    expect((await f.write(next)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "not_current_fact_correction_source" }));
  });

  it("rechecks validity after awaited policy and source work", async () => {
    const store = createInMemoryDocumentStore(); let current = new Date(now);
    const memory = createGoodMemory({ storage: { provider: "memory" }, adapters: { documentStore: store, sessionStore: createInMemorySessionStore() },
      testing: { now: () => current }, policy: { resolveConflict: () => { current = new Date("2026-10-06T12:02:00Z"); return { action: "supersede_existing" }; } } });
    await memory.remember({ scope, messages: [{ role: "user", content: old }] });
    const target = (await store.query<FactMemory>("facts"))[0]!;
    await store.set("facts", target.id, { ...target, validUntil: "2026-10-06T12:01:00Z" });
    expect((await memory.remember({ scope, messages: [{ role: "user", content: next }] })).events)
      .toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "not_current_fact_correction_source" }));
    expect((await store.get<FactMemory>("facts", target.id))?.lifecycle).toBe("active");
  });

  it("fences later source evidence appended while conflict policy was awaited", async () => {
    const store = createInMemoryDocumentStore();
    const adapters = { documentStore: store, sessionStore: createInMemorySessionStore() };
    const writer = createGoodMemory({ storage: { provider: "memory" }, adapters, testing: { now: () => new Date(now) } });
    const memory = createGoodMemory({ storage: { provider: "memory" }, adapters, testing: { now: () => new Date(now) }, policy: { resolveConflict: async () => {
      await writer.remember({ scope, messages: [{ id: "new-reaffirmation", role: "user", content: old, observedAt: "2026-10-05T00:00:00Z" }] });
      return { action: "supersede_existing" };
    } } });
    await writer.remember({ scope, messages: [{ role: "user", content: old, observedAt: "2026-09-01T00:00:00Z" }] });
    expect((await memory.remember({ scope, messages: [{ role: "user", content: next, observedAt: "2026-10-01T00:00:00Z" }] })).events)
      .toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "fact_correction_target_changed_or_batch_unsupported" }));
    expect((await store.query<FactMemory>("facts")).find(fact => fact.content === old)?.lifecycle).toBe("active");
  });
});

describe("operational correction assertion and applicable context", () => {
  it.each([
    "canary releases if the pilot succeeds", "canary releases unless the pilot fails",
    "canary releases when the pilot succeeds", "canary releases pending approval",
    "canary releases only in staging", "canary releases according to Nora",
    "canary releases starting next year", "canary releases during the 2023 rehearsal",
    "canary releases once capacity permits", "canary releases subject to authorization",
    "canary releases on alternate weekends", "canary releases for test traffic",
    "hypothetical canary releases", "canary releases provided demand stays low",
  ])("does not consume an unparsed qualifier as a replacement value: %s", async value => {
    const f = fixture(); await f.write(old); await f.write(next.replace("canary releases", value));
    expect((await f.store.query<FactMemory>("facts")).find(fact => fact.content === old)?.lifecycle).toBe("active");
  });

  it.each([
    ["Repo decision: I route Harbor traffic through the primary gateway.", "Repo decision: I now route Harbor traffic through the secondary gateway instead of the primary gateway."],
    ["Repository policy: For Juniper production archives, we retain exports for thirty days.", "Repository policy: For Juniper production archives, we now retain exports for ninety days instead of thirty days."],
    ["Project decision: We store SableApp backups in weekly snapshots.", "Project decision: We now store SableApp backups in daily snapshots instead of weekly snapshots."],
  ])("retains a reusable positive nominal alternative grammar: %s", async (before, after) => {
    const f = fixture(); await f.write(before);
    expect((await f.write(after)).events).toContainEqual(expect.objectContaining({ outcome: "superseded" }));
  });
});
