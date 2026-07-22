import { describe, expect, it } from "bun:test";
import type { LanguagePack } from "../../src";
import {
  createEnglishLanguagePack,
  createGoodMemory,
  createGoodMemoryLangGraphStore,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src";

// Structural mirror of LangGraph's BaseStore (batch/get/put/delete/search/
// listNamespaces) backed by GoodMemory. Items live under the configured
// GoodMemory scope; LangGraph namespaces are logical labels carried in fact
// attributes, so put/get round-trip exact values while search rides recall.

const scope = { userId: "u-1", workspaceId: "workspace-a" };

function buildStore() {
  const memory = createGoodMemory({
    adapters: {
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
      vectorStore: createInMemoryVectorStore(),
    },
    storage: { provider: "memory" },
  });
  return { memory, store: createGoodMemoryLangGraphStore({ memory, scope }) };
}

describe("createGoodMemoryLangGraphStore", () => {
  it("round-trips put/get with Item shape and overwrites by key", async () => {
    const { store } = buildStore();
    const namespace = ["memories", "u-1"];

    await store.put(namespace, "pref-1", {
      content: "User prefers concise bullet-point summaries.",
      importance: "high",
    });

    const item = await store.get(namespace, "pref-1");
    expect(item).not.toBeNull();
    expect(item?.key).toBe("pref-1");
    expect(item?.namespace).toEqual(namespace);
    expect(item?.value).toEqual({
      content: "User prefers concise bullet-point summaries.",
      importance: "high",
    });
    expect(item?.createdAt).toBeInstanceOf(Date);
    expect(item?.updatedAt).toBeInstanceOf(Date);

    // put on the same key replaces the value (LangGraph semantics).
    await store.put(namespace, "pref-1", {
      content: "User prefers detailed narrative summaries.",
    });
    const replaced = await store.get(namespace, "pref-1");
    expect(replaced?.value).toEqual({
      content: "User prefers detailed narrative summaries.",
    });

    const missing = await store.get(namespace, "absent");
    expect(missing).toBeNull();
  });

  it("deletes by key", async () => {
    const { store } = buildStore();
    const namespace = ["memories"];
    await store.put(namespace, "gone", { content: "Temporary note." });
    await store.delete(namespace, "gone");
    expect(await store.get(namespace, "gone")).toBeNull();
  });

  it("searches with query, filter, and limit under a namespace prefix", async () => {
    const { store } = buildStore();
    await store.put(["memories", "u-1"], "tea", {
      content: "The user drinks jasmine tea every evening.",
      kind: "habit",
    });
    await store.put(["memories", "u-1"], "deploy", {
      content: "The deploy pipeline is blocked on smoke verification.",
      kind: "project",
    });
    await store.put(["other"], "outside", {
      content: "The user drinks jasmine tea at breakfast too.",
      kind: "habit",
    });

    const results = await store.search(["memories"], {
      query: "What tea does the user drink in the evenings?",
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.key).toBe("tea");
    // Prefix confinement: the ["other"] item never appears.
    expect(results.some((entry) => entry.key === "outside")).toBe(false);

    const filtered = await store.search(["memories"], {
      filter: { kind: "project" },
    });
    expect(filtered.map((entry) => entry.key)).toEqual(["deploy"]);

    const limited = await store.search(["memories"], { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("uses the memory LanguagePack tokenizer for Korean namespace fallback", async () => {
    const { memory, store } = buildStore();
    await store.put(["memories", "ko"], "release", {
      content: "프로젝트를 배포했습니다.",
    });
    const emptyRecall = await memory.recall({ query: "missing", scope });
    memory.recall = async () => ({ ...emptyRecall, facts: [] });

    const results = await store.search(["memories", "ko"], {
      query: "프로젝트",
    });

    expect(results.map((entry) => entry.key)).toContain("release");
  });

  it("keeps namespace fallback horizontally extensible for custom tokenizers", async () => {
    const english = createEnglishLanguagePack();
    const customPack: LanguagePack = {
      ...english,
      analyzerVersion: "custom-1",
      compatibilityGroup: "test-lexical",
      defaultLocale: "tlh-Latn",
      id: "test-lexical",
      locales: ["tlh-Latn"],
      detect({ texts }) {
        return texts.some((text) => text.includes("¤"))
          ? "distinctive"
          : "none";
      },
      tokenizeForScoring(text) {
        return text.includes("¤") ? ["shared-custom-term"] : [];
      },
    };
    const memory = createGoodMemory({
      language: { packs: [customPack] },
      storage: { provider: "memory" },
    });
    const store = createGoodMemoryLangGraphStore({ memory, scope });
    await store.put(["memories", "custom"], "custom", {
      content: "¤archive",
    });
    const emptyRecall = await memory.recall({ query: "missing", scope });
    memory.recall = async () => ({ ...emptyRecall, facts: [] });

    const results = await store.search(["memories", "custom"], {
      query: "¤lookup",
    });

    expect(results.map((entry) => entry.key)).toEqual(["custom"]);
  });

  it("keeps index:false items gettable but out of query search and fact content", async () => {
    const { memory, store } = buildStore();
    const namespace = ["memories", "u-1"];
    const privateContent = "The private launch codeword is heliotrope-only.";

    await store.put(
      namespace,
      "private",
      {
        content: privateContent,
        kind: "private",
      },
      false,
    );
    await store.put(namespace, "public", {
      content: "The public launch note mentions jasmine tea.",
      kind: "public",
    });

    expect(await store.get(namespace, "private")).toMatchObject({
      key: "private",
      value: {
        content: privateContent,
        kind: "private",
      },
    });
    expect(
      (await store.search(["memories"], { query: "heliotrope-only" })).map(
        (entry) => entry.key,
      ),
    ).not.toContain("private");
    expect(
      (await store.search(["memories"], { query: "jasmine tea" })).map(
        (entry) => entry.key,
      ),
    ).toContain("public");
    expect((await store.search(["memories"])).map((entry) => entry.key)).toContain(
      "private",
    );

    const exported = await memory.exportMemory({ scope });
    const storedPrivate = exported.durable.facts.find(
      (fact) => fact.attributes?.langgraphKey === "private",
    );
    expect(storedPrivate?.content).not.toContain("heliotrope-only");
  });

  it("throws when the governed remember pipeline rejects a put", async () => {
    const memory = createGoodMemory({
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
        vectorStore: createInMemoryVectorStore(),
      },
      policy: {
        shouldRemember: () => false,
      },
      storage: { provider: "memory" },
    });
    const store = createGoodMemoryLangGraphStore({ memory, scope });

    await expect(
      store.put(["memories"], "blocked", {
        content: "This write must be rejected by policy.",
      }),
    ).rejects.toThrow("GoodMemory LangGraph put was rejected");
    expect(await store.get(["memories"], "blocked")).toBeNull();
  });

  it("lists namespaces with prefix filtering and maxDepth truncation", async () => {
    const { store } = buildStore();
    await store.put(["memories", "u-1", "prefs"], "a", { content: "A note." });
    await store.put(["memories", "u-2"], "b", { content: "B note." });
    await store.put(["playbooks"], "c", { content: "C note." });

    const all = await store.listNamespaces();
    expect(all).toContainEqual(["memories", "u-1", "prefs"]);
    expect(all).toContainEqual(["playbooks"]);

    const prefixed = await store.listNamespaces({ prefix: ["memories"] });
    expect(prefixed.every((namespace) => namespace[0] === "memories")).toBe(true);
    expect(prefixed).toHaveLength(2);

    const truncated = await store.listNamespaces({ maxDepth: 2 });
    expect(truncated).toContainEqual(["memories", "u-1"]);
    expect(
      truncated.some((namespace) => namespace.length > 2),
    ).toBe(false);
  });

  it("dispatches mixed batch operations with order-aligned results", async () => {
    const { store } = buildStore();
    await store.put(["memories"], "seed", {
      content: "The seeded note mentions kayaking.",
    });

    const results = await store.batch([
      { key: "seed", namespace: ["memories"] },
      {
        key: "new",
        namespace: ["memories"],
        value: { content: "A second note about climbing." },
      },
      { namespacePrefix: ["memories"], query: "kayaking" },
      { limit: 10, offset: 0 },
    ]);

    expect((results[0] as { key: string } | null)?.key).toBe("seed");
    expect(results[1]).toBeUndefined();
    expect(
      (results[2] as Array<{ key: string }>).some(
        (entry) => entry.key === "seed",
      ),
    ).toBe(true);
    expect(results[3]).toContainEqual(["memories"]);
  });
});
