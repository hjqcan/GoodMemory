import { describe, expect, it } from "bun:test";
import {
  decomposedRecall,
  splitQueryIntoSubQueries,
} from "../../src/recall/queryDecomposition";
import {
  createEnglishLanguagePack,
  createLanguageService,
} from "../../src/language";

describe("splitQueryIntoSubQueries", () => {
  it("splits a compound question on coordinating conjunctions", () => {
    expect(
      splitQueryIntoSubQueries(
        "What database do I use and which editor did I switch to?",
      ),
    ).toEqual(["What database do I use", "which editor did I switch to"]);
  });

  it("does not split coordinated people as if they were independent facets", () => {
    expect(
      splitQueryIntoSubQueries(
        "Which activity do Rowan and Priya plan on doing together next month?",
      ),
    ).toEqual([]);
    expect(
      splitQueryIntoSubQueries(
        "What project will Priya and Rowan complete together next quarter?",
      ),
    ).toEqual([]);
  });

  it("returns [] for a single-part query (no spurious decomposition)", () => {
    expect(splitQueryIntoSubQueries("Where do I live?")).toEqual([]);
    expect(splitQueryIntoSubQueries("")).toEqual([]);
  });

  it("splits across sentence boundaries too", () => {
    expect(
      splitQueryIntoSubQueries("What is my role? What is my current focus?"),
    ).toEqual(["What is my role", "What is my current focus"]);
  });

  it("keeps a with-complement inside its original proposition", () => {
    expect(
      splitQueryIntoSubQueries(
        "Did the team launch Atlas with vendor approval in 2025?",
      ),
    ).toEqual([]);
    expect(
      splitQueryIntoSubQueries(
        "How did Rowan describe the time restoring telescopes with volunteers?",
      ),
    ).toEqual([]);
  });

  it("does not split a with-phrase when it cannot form two useful queries", () => {
    expect(splitQueryIntoSubQueries("What did I discuss with Alice?")).toEqual(
      [],
    );
  });

  it("splits Chinese multi-facet queries without relying on spaces", () => {
    expect(
      splitQueryIntoSubQueries("我用什么数据库以及后来换成了哪个编辑器？"),
    ).toEqual(["我用什么数据库", "后来换成了哪个编辑器"]);
  });

  it("delegates Traditional Chinese and Japanese facets to language packs", () => {
    const language = createLanguageService();
    expect(
      splitQueryIntoSubQueries(
        "目前的資料庫是什麼？同時阻礙是什麼？",
        { language, locale: "zh-TW" },
      ),
    ).toEqual(["目前的資料庫是什麼", "阻礙是什麼"]);
    expect(
      splitQueryIntoSubQueries(
        "現在のデータベースは何ですか？そしてブロッカーは何ですか？",
        { language, locale: "ja-JP" },
      ),
    ).toEqual([
      "現在のデータベースは何ですか",
      "ブロッカーは何ですか",
    ]);
  });

  it("does not reinterpret a commercial partner term as a relationship facet", () => {
    expect(splitQueryIntoSubQueries("Which partner API did Acme use?")).toEqual(
      [],
    );
  });

  it("derives temporal operands from equivalent ordering and elapsed-time grammar", () => {
    expect(
      splitQueryIntoSubQueries(
        "Which event happened first, the laptop repair or the router replacement?",
      ),
    ).toEqual(["the laptop repair", "the router replacement"]);
    expect(
      splitQueryIntoSubQueries(
        "How many weeks passed between the bake sale and the marathon?",
      ),
    ).toEqual(["the bake sale", "the marathon"]);
    expect(
      splitQueryIntoSubQueries(
        "How many days ago did I attend a community workshop?",
      ),
    ).toEqual(["I attend a community workshop"]);
    expect(
      splitQueryIntoSubQueries(
        "How many days ago did I attend a pottery class when I made the vase?",
      ),
    ).toEqual(["I attend a pottery class", "I made the vase"]);
    expect(
      splitQueryIntoSubQueries(
        "Which event, lunch or dinner, happened first?",
      ),
    ).toEqual(["lunch", "dinner"]);
    expect(
      splitQueryIntoSubQueries(
        "Did the bake sale happen before the charity marathon?",
      ),
    ).toEqual(["the bake sale", "the charity marathon"]);
    expect(
      splitQueryIntoSubQueries(
        "How long ago did I attend a community workshop?",
      ),
    ).toEqual(["I attend a community workshop"]);
    expect(
      splitQueryIntoSubQueries(
        "How many days have passed since I attended a community workshop?",
      ),
    ).toEqual(["I attended a community workshop"]);
  });

  it("does not derive temporal operands from advice, ordinary comparison, position, or counts", () => {

    expect(
      splitQueryIntoSubQueries(
        "Which database should I use, PostgreSQL or SQLite?",
      ),
    ).toEqual([]);
    expect(
      splitQueryIntoSubQueries(
        "Which task should I do first, deploy backend or update docs?",
      ),
    ).toEqual([]);
    expect(
      splitQueryIntoSubQueries(
        "What is the difference between relational database and embedded database?",
      ),
    ).toEqual([]);
    expect(
      splitQueryIntoSubQueries(
        "How many people stood between Alice Cooper and Bob Dylan?",
      ),
    ).toEqual([]);
    expect(
      splitQueryIntoSubQueries(
        "How long is the bridge between Staten Island and Brooklyn?",
      ),
    ).toEqual([]);
    expect(splitQueryIntoSubQueries("How many items are pending?")).toEqual([]);
  });

  it("dedupes and caps to maxSubQueries", () => {
    const result = splitQueryIntoSubQueries(
      "alpha topic and beta topic and alpha topic and gamma topic and delta topic",
      { maxSubQueries: 2 },
    );
    expect(result).toEqual(["alpha topic", "beta topic"]);
  });

  it("drops fragments shorter than minWords", () => {
    // "ok" is a single word, so it is not a sub-query; only the multi-word part
    // survives, which alone is fewer than two parts -> no decomposition.
    expect(splitQueryIntoSubQueries("ok and the build pipeline status")).toEqual(
      [],
    );
  });
});

describe("decomposedRecall", () => {
  it("runs a single recall and skips merge when the query does not decompose", async () => {
    const calls: string[] = [];
    const outcome = await decomposedRecall<string>({
      query: "Where do I live?",
      recall: async (query) => {
        calls.push(query);
        return `r:${query}`;
      },
      merge: () => {
        throw new Error("merge should not be called without decomposition");
      },
    });
    expect(calls).toEqual(["Where do I live?"]);
    expect(outcome.subQueries).toEqual([]);
    expect(outcome.queriesRun).toBe(1);
    expect(outcome.result).toBe("r:Where do I live?");
  });

  it("does not reinterpret commercial partner terms as relationship status", async () => {
    const calls: string[] = [];
    const outcome = await decomposedRecall<string>({
      query: "Which partner API did Acme use?",
      recall: async (query) => {
        calls.push(query);
        return query;
      },
      merge: (primary, supplementary) => [primary, ...supplementary].join(" | "),
    });

    expect(calls).toEqual(["Which partner API did Acme use?"]);
    expect(outcome.queriesRun).toBe(1);
  });

  it("recalls the original plus each sub-query and merges", async () => {
    const calls: string[] = [];
    const outcome = await decomposedRecall<string>({
      query: "What is A and what is B?",
      decompose: () => ["what is A", "what is B"],
      recall: async (query) => {
        calls.push(query);
        return query;
      },
      merge: (primary, supplementary) =>
        [primary, ...supplementary].join(" | "),
    });
    expect(calls).toEqual([
      "What is A and what is B?",
      "what is A",
      "what is B",
    ]);
    expect(outcome.subQueries).toEqual(["what is A", "what is B"]);
    expect(outcome.queriesRun).toBe(3);
    expect(outcome.result).toBe("What is A and what is B? | what is A | what is B");
  });

  it("drops sub-queries equal to the original and respects maxSubQueries", async () => {
    const calls: string[] = [];
    const outcome = await decomposedRecall<string>({
      query: "q",
      decompose: () => ["q", "sub one", "sub two", "sub three"],
      recall: async (query) => {
        calls.push(query);
        return query;
      },
      merge: (primary, supplementary) => [primary, ...supplementary].join(","),
      options: { maxSubQueries: 2 },
    });
    expect(outcome.subQueries).toEqual(["sub one", "sub two"]);
    expect(calls).toEqual(["q", "sub one", "sub two"]);
    expect(outcome.queriesRun).toBe(3);
  });

  it("deduplicates provider facets with LanguagePack equality semantics", async () => {
    const english = createEnglishLanguagePack();
    const language = createLanguageService({
      packs: [{
        ...english,
        analyzerVersion: "sentinel-equality-v1",
        normalizeForEquality(text) {
          return english.normalizeForEquality(text).replaceAll("colour", "color");
        },
      }],
    });
    const calls: string[] = [];

    const outcome = await decomposedRecall<string>({
      query: "palette advice",
      decompose: () => ["colour choice", "color choice", "shade choice"],
      recall: async (query) => {
        calls.push(query);
        return query;
      },
      merge: (primary, supplementary) => [primary, ...supplementary].join(","),
      options: { language, locale: "en" },
    });

    expect(outcome.subQueries).toEqual(["colour choice", "shade choice"]);
    expect(calls).toEqual(["palette advice", "colour choice", "shade choice"]);
  });
});
