import { describe, expect, it } from "bun:test";
import {
  createFactMemory,
  createFeedbackMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import { createLanguageService } from "../../src/language";
import {
  buildFactCandidates,
  buildReferenceCandidates,
  freshnessScore,
  normalizeSemanticScores,
  rankFactCandidates,
  rankReferenceCandidates,
  sortFeedback,
} from "../../src/recall/scoring";

const TIMESTAMP = "2026-01-10T00:00:00.000Z";
const SOURCE = {
  method: "explicit" as const,
  extractedAt: TIMESTAMP,
};

describe("recall scoring", () => {
  it("normalizes semantic scores against the highest result", () => {
    const scores = normalizeSemanticScores([
      { id: "fact-1", score: 4 },
      { id: "fact-2", score: 2 },
    ]);

    expect(scores.get("fact-1")).toBe(1);
    expect(scores.get("fact-2")).toBe(0.5);
  });

  it("derives blocker fact metadata during candidate building", () => {
    const language = createLanguageService();
    const fact = createFactMemory({
      id: "fact-1",
      userId: "user-1",
      category: "project",
      content: "The runtime rollout is blocked by legal signoff.",
      source: SOURCE,
      updatedAt: TIMESTAMP,
    });

    const [candidate] = buildFactCandidates(
      [fact],
      "What is the blocker right now?",
      language,
      "en",
      TIMESTAMP,
    );

    expect(candidate?.factKind).toBe("blocker");
    expect(candidate?.scopeKind).toBe("project");
    expect(candidate?.explicitnessScore).toBeGreaterThan(0);
  });

  it("uses evidence support without retrieval-usage reinforcement", () => {
    const language = createLanguageService();
    const fact = createFactMemory({
      id: "fact-1",
      userId: "user-1",
      category: "project",
      content: "The runtime rollout is blocked by legal signoff.",
      source: SOURCE,
      accessCount: 4,
      lastAccessedAt: "2026-01-08T00:00:00.000Z",
      updatedAt: TIMESTAMP,
    });

    const [candidate] = buildFactCandidates(
      [fact],
      "What is the blocker right now?",
      language,
      "en",
      TIMESTAMP,
      undefined,
      new Map([["fact-1", 3]]),
    );

    expect(candidate?.usageScore).toBe(0);
    expect(candidate?.evidenceScore).toBeGreaterThan(0);
    expect(candidate?.outcomeScore).toBe(candidate?.evidenceScore);
  });

  it("ignores historical access telemetry when scoring otherwise equal facts", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-never-accessed",
        userId: "user-1",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-frequently-accessed",
        userId: "user-1",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: SOURCE,
        accessCount: 99,
        lastAccessedAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      }),
    ];

    const candidates = buildFactCandidates(
      facts,
      "What is the blocker right now?",
      language,
      "en",
      TIMESTAMP,
    );
    const neverAccessed = candidates.find(
      (candidate) => candidate.fact.id === "fact-never-accessed",
    );
    const frequentlyAccessed = candidates.find(
      (candidate) => candidate.fact.id === "fact-frequently-accessed",
    );

    expect(neverAccessed?.usageScore).toBe(0);
    expect(frequentlyAccessed?.usageScore).toBe(0);
    expect(frequentlyAccessed?.score).toBe(neverAccessed?.score);
  });

  it("applies an advisory verification penalty to stale action-driving facts", () => {
    const language = createLanguageService();
    const fact = createFactMemory({
      id: "fact-1",
      userId: "user-1",
      category: "project",
      content: "The runtime rollout is blocked by legal signoff.",
      source: SOURCE,
      accessCount: 5,
      lastAccessedAt: "2026-01-08T00:00:00.000Z",
      updatedAt: "2025-10-01T00:00:00.000Z",
    });

    const [candidate] = buildFactCandidates(
      [fact],
      "Proceed with the rollout using the remembered blocker.",
      language,
      "en",
      TIMESTAMP,
    );

    expect(candidate?.usageScore).toBe(0);
    expect(candidate?.verificationPenaltyScore).toBeGreaterThan(candidate?.usageScore ?? 0);
  });

  it("treats future timestamps as age zero instead of making them stale", () => {
    expect(freshnessScore("2027-01-10T00:00:00.000Z", TIMESTAMP)).toBe(
      freshnessScore(TIMESTAMP, TIMESTAMP),
    );
    expect(freshnessScore("2025-01-10T00:00:00.000Z", TIMESTAMP)).toBe(0);
  });

  it("keeps the documented 7, 30, and 90 day freshness boundaries", () => {
    expect(freshnessScore("2026-01-03T00:00:00.000Z", TIMESTAMP)).toBe(0.25);
    expect(freshnessScore("2026-01-02T23:59:59.999Z", TIMESTAMP)).toBe(0.15);
    expect(freshnessScore("2025-12-11T00:00:00.000Z", TIMESTAMP)).toBe(0.15);
    expect(freshnessScore("2025-12-10T23:59:59.999Z", TIMESTAMP)).toBe(0.05);
    expect(freshnessScore("2025-10-12T00:00:00.000Z", TIMESTAMP)).toBe(0.05);
    expect(freshnessScore("2025-10-11T23:59:59.999Z", TIMESTAMP)).toBe(0);
  });

  it("prefers higher lexical reference matches when ranking", () => {
    const language = createLanguageService();
    const references = [
      createReferenceMemory({
        id: "ref-lo",
        userId: "user-1",
        title: "Tracker",
        pointer: "docs/tracker.md",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createReferenceMemory({
        id: "ref-hi",
        userId: "user-1",
        title: "Runtime Runbook",
        pointer: "docs/runtime-runbook.md",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const ranked = rankReferenceCandidates(
      buildReferenceCandidates(
        references,
        "Where is the runtime runbook?",
        language,
        "en",
        TIMESTAMP,
      ),
      "rules-only",
    );

    expect(ranked[0]?.reference.id).toBe("ref-hi");
  });

  // Initiative 1: semanticScore must be a first-class ADDITIVE ranking term for
  // hybrid (not tie-break-only), while rules-only stays a pure lexical floor.
  // Two facts with identical content (so every lexical/intent/freshness term is
  // equal) are separated only by their injected semantic scores.
  const buildTwinFactCandidates = (
    semanticScores?: Map<string, number>,
  ) => {
    const language = createLanguageService();
    const content = "The current blocker is the rollout approval.";
    const facts = [
      createFactMemory({
        id: "fact-a",
        userId: "user-1",
        category: "project",
        content,
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-b",
        userId: "user-1",
        category: "project",
        content,
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];
    return buildFactCandidates(
      facts,
      "What is the rollout blocker?",
      language,
      "en",
      TIMESTAMP,
      semanticScores,
    );
  };

  it("rules-only ignores semantic scores entirely (pure lexical floor)", () => {
    // fact-b has the far higher semantic score, but rules-only must not look at
    // it: with all lexical terms tied, ranking falls to the deterministic id
    // order, surfacing fact-a.
    const candidates = buildTwinFactCandidates(
      new Map([
        ["fact-a", 0.2],
        ["fact-b", 0.9],
      ]),
    );
    const ranked = rankFactCandidates(candidates, "rules-only");
    expect(ranked[0]?.fact.id).toBe("fact-a");
  });

  it("hybrid promotes the higher semantic score additively over a lexical tie", () => {
    const candidates = buildTwinFactCandidates(
      new Map([
        ["fact-a", 0.2],
        ["fact-b", 0.9],
      ]),
    );
    const ranked = rankFactCandidates(candidates, "hybrid");
    expect(ranked[0]?.fact.id).toBe("fact-b");
  });

  it("is a no-op when no semantic scores are present (endpoint-free parity)", () => {
    // With every semanticScore defaulting to 0, hybrid and rules-only must
    // produce identical rankings — this is the guarantee that wiring the
    // additive term cannot regress the accepted rules-only/hybrid numbers until
    // a real embedding endpoint supplies non-zero scores.
    const rulesOnly = rankFactCandidates(
      buildTwinFactCandidates(),
      "rules-only",
    );
    const hybrid = rankFactCandidates(buildTwinFactCandidates(), "hybrid");
    expect(hybrid.map((candidate) => candidate.fact.id)).toEqual(
      rulesOnly.map((candidate) => candidate.fact.id),
    );
    expect(hybrid[0]?.fact.id).toBe("fact-a");
  });

  it("ignores last-used telemetry when sorting active guidance", () => {
    const feedback = sortFeedback([
      createFeedbackMemory({
        id: "feedback-newer",
        userId: "user-1",
        rule: "Keep summaries concise.",
        kind: "prefer",
        source: SOURCE,
        updatedAt: "2026-01-09T00:00:00.000Z",
      }),
      createFeedbackMemory({
        id: "feedback-older-but-used",
        userId: "user-1",
        rule: "Use bullet points in summaries.",
        kind: "prefer",
        source: SOURCE,
        updatedAt: "2026-01-05T00:00:00.000Z",
        lastUsedAt: "2026-01-10T00:00:00.000Z",
      }),
    ]);

    expect(feedback[0]?.id).toBe("feedback-newer");
  });
});
