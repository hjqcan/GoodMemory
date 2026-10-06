import { describe, expect, it } from "bun:test";
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore } from "../../src";
import type { FactMemory } from "../../src/domain/records";

const scope = { userId: "public-correction-identity-v3", workspaceId: "public" };
const old = "Project decision: We deploy MarlinApp with blue-green releases.";
const next = "Project decision: We now deploy MarlinApp with canary releases instead of blue-green releases.";
const aliases = [
  ["exact", old], ["space", old.replace("deploy MarlinApp", "deploy  MarlinApp")],
  ["case", old.replace("We deploy", "we deploy")], ["terminal", old.slice(0, -1)],
  ["bang", old.replace(/\.$/, "!")], ["tab", old.replace("deploy MarlinApp", "deploy\tMarlinApp")],
  ["nbsp", old.replace("deploy MarlinApp", "deploy\u00a0MarlinApp")],
  ["upper", old.toUpperCase()], ["hyphen", old.replace("blue-green", "blue green")],
  ["unicode-hyphen", old.replace("blue-green", "blue\u2010green")],
] as const;
function fixture() {
  const store = createInMemoryDocumentStore();
  const memory = createGoodMemory({ storage: { provider: "memory" },
    adapters: { documentStore: store, sessionStore: createInMemorySessionStore() },
    testing: { now: () => new Date("2026-10-06T12:00:00Z") } });
  const write = (content: string, id: string, observedAt?: string) => memory.remember({ scope,
    messages: [{ id, role: "user", content, ...(observedAt ? { observedAt } : {}) }] });
  return { store, memory, write };
}

describe("same fact identity governs accepted observations and chronology", () => {
  it.each(aliases)("counts the newer merged %s source when rejecting backfill", async (_, alias) => {
    const f = fixture(); await f.write(old, "original", "2026-09-01T00:00:00Z");
    const target = (await f.store.query<FactMemory>("facts"))[0]!;
    expect((await f.write(alias, "reaffirmed", "2026-10-05T00:00:00Z")).events)
      .toContainEqual(expect.objectContaining({ outcome: "merged", reason: "duplicate_fact", memoryId: target.id }));
    expect((await f.write(next, "backfill", "2026-10-01T00:00:00Z")).events)
      .toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "stale_fact_correction_source" }));
    expect(await f.store.query<FactMemory>("facts")).toEqual([target]);
    const durable = (await f.memory.exportMemory({ scope })).durable;
    expect(durable.sourceMessages).toContainEqual(expect.objectContaining({ content: alias, observedAt: "2026-10-05T00:00:00.000Z" }));
  });

  it.each(aliases)("supports later correction and idempotent original %s source replay", async (_, alias) => {
    const f = fixture(); await f.write(old, "original", "2026-09-01T00:00:00Z");
    await f.write(alias, "reaffirmed", "2026-10-05T00:00:00Z");
    expect((await f.write(next, "current", "2026-10-05T06:00:00Z")).events)
      .toContainEqual(expect.objectContaining({ outcome: "superseded" }));
    expect((await f.write(alias, "reaffirmed", "2026-10-05T00:00:00Z")).events)
      .toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "superseded_fact_source_replay" }));
    await f.write(next, "current", "2026-10-05T06:00:00Z");
    const durable = (await f.memory.exportMemory({ scope })).durable;
    expect(durable.facts).toHaveLength(2);
    expect(durable.facts.filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([next]);
  });

  it("does not silently discard a linked author source beyond the complete assertion boundary", async () => {
    const f = fixture(); await f.write(old, "original", "2026-09-01T00:00:00Z");
    const extended = old + " This remains our current policy.";
    expect((await f.write(extended, "extended", "2026-10-05T00:00:00Z")).events)
      .toContainEqual(expect.objectContaining({ outcome: "merged", reason: "duplicate_fact" }));
    expect((await f.write(next, "backfill", "2026-10-01T00:00:00Z")).events)
      .toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "unverified_fact_correction_target" }));
    expect((await f.store.query<FactMemory>("facts")).find(fact => fact.content === old)?.lifecycle).toBe("active");
  });

  it("does not let an undated normalized reaffirmation borrow another source's clock", async () => {
    const f = fixture(); await f.write(old, "original", "2026-09-01T00:00:00Z");
    await f.write(old.toLowerCase(), "undated");
    expect((await f.write(next, "current", "2026-10-05T00:00:00Z")).events)
      .toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "unordered_fact_correction_source" }));
  });
});
