import { isActiveMemoryLifecycle } from "../../domain/records";
import type { NoteMemory } from "../../domain/records";
import type { LanguageService } from "../../language";
import { computeBm25Scores } from "../bm25";
import type { RecallCandidateTrace } from "../contracts";
import {
  evidenceSupportScore,
  explicitnessScore,
  freshnessScore,
} from "../scoring";
import { buildReturnedReason } from "./selectionContext";

// Notes are authored pages: whole documents, not sentence-shaped facts. They
// are ranked with length-normalized BM25 over title + body (plus any dense
// score), so a long page that covers the query is admitted instead of being
// starved by the fact lane's max-denominator overlap. The lane is capped so a
// page-sized record cannot displace the rest of the packet.
export const NOTE_RECALL_LIMIT = 2;

interface RankedNoteCandidate {
  evidenceScore: number;
  explicitnessScore: number;
  freshnessScore: number;
  lexicalScore: number;
  locale: string;
  note: NoteMemory;
  score: number;
  semanticScore: number;
}

export function selectNotes(input: {
  evidenceCountsByMemoryId?: Map<string, number>;
  language: LanguageService;
  maxRecords?: number;
  notes: readonly NoteMemory[];
  query: string;
  queryLocale: string;
  referenceTime: string;
  semanticScores?: Map<string, number>;
}): { notes: NoteMemory[]; traces: RecallCandidateTrace[] } {
  if (input.notes.length === 0) {
    return { notes: [], traces: [] };
  }
  const tokenize = (text: string): string[] =>
    input.language.tokenize(text, input.queryLocale, { excludeStopwords: true });
  const lexicalScores = computeBm25Scores(
    input.query,
    input.notes.map((note) => ({
      id: note.id,
      text: `${note.title}\n${note.body}`,
    })),
    { tokenize },
  );
  const ranked: RankedNoteCandidate[] = input.notes
    .map((note) => {
      const lexicalScore = lexicalScores.get(note.id) ?? 0;
      const semanticScore = input.semanticScores?.get(note.id) ?? 0;
      const freshness = freshnessScore(
        note.observedAt ?? note.updatedAt,
        input.referenceTime,
      );
      const explicitness = explicitnessScore(note.source.method);
      const evidenceScore = evidenceSupportScore(
        input.evidenceCountsByMemoryId?.get(note.id) ?? 0,
      );
      return {
        evidenceScore,
        explicitnessScore: explicitness,
        freshnessScore: freshness,
        lexicalScore,
        locale: note.source.locale ?? input.queryLocale,
        note,
        score: lexicalScore + semanticScore + freshness + explicitness + evidenceScore,
        semanticScore,
      };
    })
    .sort((left, right) =>
      right.score - left.score || left.note.id.localeCompare(right.note.id)
    );
  const traces: RecallCandidateTrace[] = ranked.map((entry) => ({
    memoryId: entry.note.id,
    memoryType: "note",
    slot: "generic",
    returned: false,
    whySuppressed: !input.language.localesCompatible(input.queryLocale, entry.locale)
      ? "locale mismatch"
      : !isActiveMemoryLifecycle(entry.note)
        ? "inactive lifecycle"
        : "not selected",
    intentScore: 0,
    lexicalScore: entry.lexicalScore,
    freshnessScore: entry.freshnessScore,
    explicitnessScore: entry.explicitnessScore,
    evidenceScore: entry.evidenceScore,
    ...(entry.semanticScore > 0 ? { semanticScore: entry.semanticScore } : {}),
    fallback: "none",
  }));
  const limit = input.maxRecords ?? NOTE_RECALL_LIMIT;
  const selected = ranked
    .filter(
      (entry) =>
        (entry.lexicalScore > 0 || entry.semanticScore > 0) &&
        isActiveMemoryLifecycle(entry.note) &&
        input.language.localesCompatible(input.queryLocale, entry.locale),
    )
    .slice(0, limit);
  for (const entry of selected) {
    const trace = traces.find(({ memoryId }) => memoryId === entry.note.id);
    if (!trace) {
      continue;
    }
    trace.returned = true;
    trace.whySuppressed = undefined;
    trace.whyReturned = buildReturnedReason(
      "generic",
      0,
      entry.lexicalScore,
      entry.evidenceScore,
      0,
      "none",
    );
  }
  return { notes: selected.map(({ note }) => note), traces };
}
