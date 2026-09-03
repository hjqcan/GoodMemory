import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";
import { createLanguageService } from "../../src/language";
import {
  buildFactCandidates,
  rankFactCandidates,
} from "../../src/recall/scoring";
import {
  hasFactSelectionSignal,
  hasGenericFactSelectionSignal,
  hasLongRecordCoverageSignal,
  LONG_RECORD_COVERAGE_MIN,
  LONG_RECORD_COVERAGE_MIN_MATCHES,
} from "../../src/recall/selectors/selectionContext";
import type { RankedFactCandidate } from "../../src/recall/scoring";

const TIMESTAMP = "2026-09-01T00:00:00.000Z";
const SOURCE = { method: "explicit", extractedAt: TIMESTAMP } as const;
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

function fact(id: string, content: string) {
  return createFactMemory({ id, userId: "u-1", category: "project", content, source: SOURCE, updatedAt: TIMESTAMP });
}

describe("long-record query coverage", () => {
  it("scores coverage only for records above the overlap-token floor", () => {
    const language = createLanguageService();
    const candidates = buildFactCandidates(
      [fact("long", PAGE), fact("short", "The runtime rollout is blocked by legal signoff.")],
      "MediaWiki api.php srsearch",
      language,
      "en",
      TIMESTAMP,
    );
    const long = candidates.find((entry) => entry.fact.id === "long");
    const short = candidates.find((entry) => entry.fact.id === "short");

    expect(long?.queryCoverageScore).toBe(1);
    expect(long?.queryCoverageMatches).toBe(2);
    expect(short?.queryCoverageScore).toBeUndefined();
    expect(short?.queryCoverageMatches).toBeUndefined();
    expect(long!.lexicalScore).toBeLessThan(0.08);
  });

  it("never changes the ranking of existing candidates", () => {
    const language = createLanguageService();
    const facts = [
      fact("a", "The runtime rollout is blocked by legal signoff."),
      fact("b", "The runtime rollout owner is Nora."),
      fact("long", PAGE),
    ];
    const ranked = rankFactCandidates(
      buildFactCandidates(facts, "What is the rollout blocker?", language, "en", TIMESTAMP),
      "rules-only",
    );
    const stripped = rankFactCandidates(
      buildFactCandidates(facts, "What is the rollout blocker?", language, "en", TIMESTAMP).map(
        ({ queryCoverageMatches: _m, queryCoverageScore: _s, ...entry }) => entry as RankedFactCandidate,
      ),
      "rules-only",
    );

    expect(ranked.map((entry) => entry.fact.id)).toEqual(stripped.map((entry) => entry.fact.id));
  });

  it("requires at least two matched query tokens and the coverage floor", () => {
    const base = {
      intentScore: 0,
      lexicalScore: 0.03,
      subjectScore: 0,
    } as RankedFactCandidate;
    expect(LONG_RECORD_COVERAGE_MIN).toBe(0.6);
    expect(LONG_RECORD_COVERAGE_MIN_MATCHES).toBe(2);
    expect(hasLongRecordCoverageSignal({ ...base, queryCoverageScore: 1, queryCoverageMatches: 2 })).toBe(true);
    expect(hasLongRecordCoverageSignal({ ...base, queryCoverageScore: 1, queryCoverageMatches: 1 })).toBe(false);
    expect(hasLongRecordCoverageSignal({ ...base, queryCoverageScore: 0.5, queryCoverageMatches: 3 })).toBe(false);
    expect(hasLongRecordCoverageSignal(base)).toBe(false);
    // The legacy predicates are untouched by the coverage fields.
    expect(hasFactSelectionSignal({ ...base, queryCoverageScore: 1, queryCoverageMatches: 2 })).toBe(false);
    expect(hasGenericFactSelectionSignal({ ...base, queryCoverageScore: 1, queryCoverageMatches: 2, fact: fact("x", PAGE) } as RankedFactCandidate)).toBe(false);
  });
});
