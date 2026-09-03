import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createFactMemory } from "../../src/domain/records";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

const NOW = "2026-09-01T00:00:00.000Z";
const scope = { userId: "u-long", workspaceId: "workspace-a" };
const PAGE = [
  "Most MediaWiki sites (Wikipedia, Fandom, many corporate wikis) expose api.php.",
  "Use action=query with prop=extracts and explaintext=1 to get plain text for a page title.",
  "For full wikitext use prop=revisions with rvprop=content and rvslots=main.",
  "Search with list=search and srsearch=<terms>; it returns titles plus snippets.",
  "Always set a descriptive User-Agent header, otherwise Wikimedia rate-limits or blocks you.",
  "Fandom wikis need the same calls but under /api.php on the wiki subdomain.",
  "Category membership is list=categorymembers with cmtitle=Category:Name.",
  "If you only need a rendered summary, the REST endpoint /api/rest_v1/page/summary/<title> is faster.",
].join(" ");

function build(longRecordAdmission: boolean | undefined) {
  const documentStore = createInMemoryDocumentStore();
  const memory = createGoodMemory({
    storage: { provider: "memory" },
    adapters: { documentStore, sessionStore: createInMemorySessionStore() },
    ...(longRecordAdmission !== undefined ? { retrieval: { longRecordAdmission } } : {}),
    testing: { now: () => new Date(NOW) },
  });
  return { documentStore, memory };
}

async function seed(documentStore: ReturnType<typeof createInMemoryDocumentStore>) {
  await documentStore.set("facts", "fact-page", createFactMemory({
    ...scope, id: "fact-page", category: "technical", content: PAGE,
    source: { method: "explicit", extractedAt: NOW }, createdAt: NOW, updatedAt: NOW,
  }));
  await documentStore.set("facts", "fact-short", createFactMemory({
    ...scope, id: "fact-short", category: "project", content: "The rollout owner is Nora.",
    source: { method: "explicit", extractedAt: NOW }, createdAt: NOW, updatedAt: NOW,
  }));
}

describe("long-record admission (opt-in)", () => {
  it("admits a long record that covers the query only when the knob is on, with an explaining trace", async () => {
    const off = build(undefined);
    await seed(off.documentStore);
    const on = build(true);
    await seed(on.documentStore);

    const suppressed = await off.memory.recall({ scope, query: "MediaWiki api.php srsearch" });
    const admitted = await on.memory.recall({ scope, query: "MediaWiki api.php srsearch" });

    expect(suppressed.facts.map(({ id }) => id)).toEqual([]);
    expect(admitted.facts.map(({ id }) => id)).toEqual(["fact-page"]);
    const offTrace = suppressed.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-page");
    const onTrace = admitted.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-page");
    expect(offTrace?.whySuppressed).toBe("below long-record coverage floor");
    expect(onTrace?.returned).toBe(true);
    expect(onTrace?.fallback).toBe("long_record_coverage");
    expect(onTrace?.whyReturned).toContain("fallback=long_record_coverage");
    expect(onTrace?.queryCoverageScore).toBe(1);
  });

  it("leaves short-record recall byte-identical with the knob on", async () => {
    const off = build(undefined);
    await seed(off.documentStore);
    const on = build(true);
    await seed(on.documentStore);

    const baseline = await off.memory.recall({ scope, query: "Who is the rollout owner?" });
    const candidate = await on.memory.recall({ scope, query: "Who is the rollout owner?" });

    expect(candidate.facts).toEqual(baseline.facts);
    const strip = (traces: typeof baseline.metadata.candidateTraces) =>
      traces.map(({ queryCoverageScore: _c, ...trace }) => trace);
    expect(strip(candidate.metadata.candidateTraces)).toEqual(strip(baseline.metadata.candidateTraces));
  });

  it("does not admit a long record on a single shared common token", async () => {
    const on = build(true);
    await seed(on.documentStore);

    const result = await on.memory.recall({ scope, query: "which wikis?" });

    expect(result.facts.map(({ id }) => id)).toEqual([]);
  });
});
