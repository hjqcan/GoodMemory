import { describe, expect, it } from "bun:test";
import { createMemoryRepositories } from "../../src/storage/repositories";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";
import { createRememberEngine } from "../../src/remember/engine";
import type { RememberEngineConfig } from "../../src/remember/engine";
import {
  DeterministicClock,
  createDeterministicIdGenerator,
} from "../../src/testing/utils";

const PAGE = [
  "Most MediaWiki sites (Wikipedia, Fandom, many corporate wikis) expose api.php.",
  "Use action=query with prop=extracts and explaintext=1 to get plain text for a page title.",
  "For full wikitext use prop=revisions with rvprop=content and rvslots=main.",
  "Search with list=search and srsearch=<terms>; it returns titles plus snippets.",
  "Always set a descriptive User-Agent header, otherwise Wikimedia rate-limits or blocks you.",
  "Fandom wikis need the same calls but under /api.php on the wiki subdomain.",
  "Category membership is list=categorymembers with cmtitle=Category:Name.",
  "If you only need a rendered summary, the REST endpoint /api/rest_v1/page/summary/<title> is faster.",
  "Citations: https://www.mediawiki.org/wiki/API:Main_page",
].join(" ");

const NOTE_ANNOTATION = {
  messageIndex: 0,
  remember: "always",
  confirmed: true,
  kindHint: "note",
  metadataPatch: { noteTitle: "Reading MediaWiki sites as an agent" },
} as const;

function createEngine(overrides: Partial<RememberEngineConfig> = {}) {
  const clock = new DeterministicClock("2026-09-01T00:00:00.000Z");
  const documentStore = createInMemoryDocumentStore();
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore: createInMemorySessionStore(),
  });
  const engine = createRememberEngine({
    repositories,
    documentStore,
    now: () => clock.now().toISOString(),
    createId: createDeterministicIdGenerator("mem"),
    ...overrides,
  });
  return { documentStore, engine };
}

describe("note gate in extraction", () => {
  it("emits exactly one whole-message note candidate instead of sentence facts", async () => {
    const { engine } = createEngine();

    const extraction = await engine.extract({
      scope: { userId: "u-note" },
      messages: [{ role: "user", content: PAGE }],
      annotations: [NOTE_ANNOTATION],
    });

    const forMessage = extraction.candidates.filter(
      (candidate) => candidate.sourceMessageIndex === 0,
    );
    expect(forMessage).toHaveLength(1);
    expect(forMessage[0]).toMatchObject({
      kindHint: "note",
      explicitness: "explicit",
      content: PAGE,
      metadata: { noteTitle: "Reading MediaWiki sites as an agent" },
    });
  });

  it("admits an explicit confirmed note from the assistant under the library default policy", async () => {
    const { engine } = createEngine();

    const noteResult = await engine.remember({
      scope: { userId: "u-note-assistant" },
      messages: [{ role: "assistant", content: PAGE }],
      annotations: [NOTE_ANNOTATION],
    });
    const factResult = await engine.remember({
      scope: { userId: "u-fact-assistant" },
      messages: [{ role: "assistant", content: PAGE }],
      annotations: [{ ...NOTE_ANNOTATION, kindHint: "fact" }],
    });

    expect(
      noteResult.events.some((event) => event.reason === "assistant_policy_blocked"),
    ).toBe(false);
    expect(noteResult.accepted).toBe(1);
    expect(factResult.accepted).toBe(0);
    expect(factResult.events.map((event) => event.reason)).toEqual([
      "assistant_policy_blocked",
    ]);
  });

  it("does not derive an episode from a note candidate", async () => {
    const messages = [
      { role: "user" as const, content: PAGE },
      { role: "assistant" as const, content: "Saved. I will use the extracts endpoint for plain text." },
    ];
    const control = createEngine();
    await control.engine.remember({
      scope: { userId: "u-episode-control" },
      messages,
      annotations: [{ ...NOTE_ANNOTATION, kindHint: "fact" }],
    });
    const gated = createEngine();
    await gated.engine.remember({
      scope: { userId: "u-episode-gated" },
      messages,
      annotations: [NOTE_ANNOTATION],
    });

    expect(await control.documentStore.query("episodes")).not.toHaveLength(0);
    expect(await gated.documentStore.query("episodes")).toHaveLength(0);
  });
});
