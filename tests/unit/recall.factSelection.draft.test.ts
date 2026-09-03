import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";
import { createLanguageService } from "../../src/language";
import type { RecallCandidateTrace } from "../../src/recall/engine";
import { buildFactCandidates, rankFactCandidates } from "../../src/recall/scoring";
import {
  createSelectionDraft,
  selectZeroRetrievalLexicalFallback,
} from "../../src/recall/factSelection/draft";

const TIMESTAMP = "2026-01-10T00:00:00.000Z";

function buildRankedEntry() {
  const language = createLanguageService();
  const fact = createFactMemory({
    id: "fact-draft-1",
    userId: "user-1",
    category: "project",
    content: "I built three raised garden beds for the redesign.",
    source: { method: "explicit", extractedAt: TIMESTAMP },
    updatedAt: TIMESTAMP,
  });
  return rankFactCandidates(
    buildFactCandidates([fact], "garden redesign", language, "en", TIMESTAMP),
    "rules-only",
  )[0]!;
}

function buildEntryWithLexical(id: string, lexicalScore: number) {
  const base = buildRankedEntry();
  const fact = createFactMemory({
    id,
    userId: "user-1",
    category: "project",
    content: base.fact.content,
    source: { method: "explicit", extractedAt: TIMESTAMP },
    updatedAt: TIMESTAMP,
  });
  return { ...base, fact, lexicalScore };
}

function buildTrace(memoryId: string): RecallCandidateTrace {
  return {
    memoryId,
    memoryType: "fact",
    slot: "generic",
    returned: false,
    whySuppressed: "not selected",
    intentScore: 0,
    lexicalScore: 0,
    freshnessScore: 0,
    explicitnessScore: 0,
    evidenceScore: 0,
    verificationPenaltyScore: 0,
    fallback: "none",
  };
}

describe("selection draft", () => {
  it("preserves legacy selectAndTrace semantics: unconditional push without dedupe", () => {
    const entry = buildRankedEntry();
    const traces = [buildTrace(entry.fact.id)];
    const draft = createSelectionDraft({ traces });

    draft.select(entry);
    draft.select(entry);

    // Deliberate: the legacy closure pushed unconditionally and callers guard
    // duplicates with selectedIds at the call site. Do not "fix" this here.
    expect(draft.selected).toHaveLength(2);
    expect(draft.selectedIds.has(entry.fact.id)).toBe(true);
    expect(traces[0]?.returned).toBe(true);
    expect(traces[0]?.whyReturned).toBeDefined();
    expect(traces[0]?.whySuppressed).toBeUndefined();
  });

  it("marks slot and fallback through to the trace", () => {
    const entry = buildRankedEntry();
    const traces = [buildTrace(entry.fact.id)];
    const draft = createSelectionDraft({ traces });

    draft.select(entry, "blocker", "same_slot_unique_candidate");

    expect(traces[0]?.slot).toBe("blocker");
    expect(traces[0]?.fallback).toBe("same_slot_unique_candidate");
  });

  it("starts with an empty summary shell", () => {
    const draft = createSelectionDraft({ traces: [] });

    expect(draft.summary).toEqual({ augmenterStages: [] });
    expect(draft.selected).toEqual([]);
    expect(draft.selectedIds.size).toBe(0);
  });
});

describe("zero-retrieval lexical fallback", () => {
  it("surfaces the best-lexical fact when nothing was selected and overlap is substantial", () => {
    const entry = buildEntryWithLexical("fact-zrf-hi", 0.15);
    const traces = [buildTrace(entry.fact.id)];
    const draft = createSelectionDraft({ traces });

    selectZeroRetrievalLexicalFallback({ compatible: [entry], draft });

    expect(draft.selected).toHaveLength(1);
    expect(draft.selected[0]?.fact.id).toBe("fact-zrf-hi");
    expect(traces[0]?.returned).toBe(true);
    expect(traces[0]?.fallback).toBe("zero_retrieval_lexical");
  });

  it("preserves abstention when the best lexical overlap is below the floor", () => {
    const entry = buildEntryWithLexical("fact-zrf-lo", 0.05);
    const traces = [buildTrace(entry.fact.id)];
    const draft = createSelectionDraft({ traces });

    selectZeroRetrievalLexicalFallback({ compatible: [entry], draft });

    expect(draft.selected).toHaveLength(0);
  });

  it("does not fire when a fact was already selected", () => {
    const selectedEntry = buildEntryWithLexical("fact-zrf-sel", 0.2);
    const otherEntry = buildEntryWithLexical("fact-zrf-other", 0.3);
    const traces = [buildTrace(selectedEntry.fact.id), buildTrace(otherEntry.fact.id)];
    const draft = createSelectionDraft({ traces });
    draft.select(selectedEntry);

    selectZeroRetrievalLexicalFallback({
      compatible: [selectedEntry, otherEntry],
      draft,
    });

    expect(draft.selected).toHaveLength(1);
    expect(draft.selected[0]?.fact.id).toBe("fact-zrf-sel");
  });

  it("picks the highest-lexical candidate among several", () => {
    const a = buildEntryWithLexical("fact-zrf-a", 0.11);
    const b = buildEntryWithLexical("fact-zrf-b", 0.22);
    const c = buildEntryWithLexical("fact-zrf-c", 0.05);
    const traces = [buildTrace(a.fact.id), buildTrace(b.fact.id), buildTrace(c.fact.id)];
    const draft = createSelectionDraft({ traces });

    selectZeroRetrievalLexicalFallback({ compatible: [a, b, c], draft });

    expect(draft.selected).toHaveLength(1);
    expect(draft.selected[0]?.fact.id).toBe("fact-zrf-b");
  });

  it("is a no-op when there are no compatible candidates", () => {
    const draft = createSelectionDraft({ traces: [] });

    selectZeroRetrievalLexicalFallback({ compatible: [], draft });

    expect(draft.selected).toHaveLength(0);
  });
});
