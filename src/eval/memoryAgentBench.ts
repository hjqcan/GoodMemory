// MemoryAgentBench (Phase 64) evaluation contract and synthetic smoke fixtures.
//
// Upstream: https://github.com/HUST-AI-HYZ/MemoryAgentBench (MIT), dataset
// `ai-hyz/MemoryAgentBench`. The benchmark uses an "inject once, query multiple
// times" design: one long source text is chunked to simulate a conversation,
// then many questions probe it. We do NOT vendor upstream data; this module
// defines a normalized case shape, the deterministic answer metrics, and a small
// synthetic smoke fixture (one case per competency) so the Phase 64 adapter can
// be built and gated before any external-root run.

export const MEMORY_AGENT_BENCH_COMPETENCIES = [
  "AR",
  "TTL",
  "LRU",
  "CR",
] as const;

export type MemoryAgentBenchCompetency =
  (typeof MEMORY_AGENT_BENCH_COMPETENCIES)[number];

// AR / CR upstream score with substring_exact_match; LRU / TTL with exact_match.
export const MEMORY_AGENT_BENCH_MATCH_MODES = [
  "substring_exact_match",
  "exact_match",
] as const;

export type MemoryAgentBenchMatchMode =
  (typeof MEMORY_AGENT_BENCH_MATCH_MODES)[number];

// One ordered chunk of the injected source ("inject once" half).
export interface MemoryAgentBenchChunk {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
}

// One probing question against the injected source ("query many" half).
export interface MemoryAgentBenchQuestion {
  competency: MemoryAgentBenchCompetency;
  // Chunk ids that carry the gold evidence (for recall / noise diagnostics).
  evidenceChunkIds: number[];
  goldAnswer: string;
  matchMode: MemoryAgentBenchMatchMode;
  question: string;
  questionId: string;
  // For CR cases: chunk ids that hold a now-stale/superseded value the answer
  // must NOT use. Empty for non-conflict cases.
  staleChunkIds: number[];
}

export interface MemoryAgentBenchCase {
  caseId: string;
  chunks: MemoryAgentBenchChunk[];
  competency: MemoryAgentBenchCompetency;
  questions: MemoryAgentBenchQuestion[];
  // Mirrors the upstream dataset name (e.g. "event_qa", "fact_sh") for
  // bucket reporting; synthetic fixtures use a `synthetic-*` prefix.
  sourceDataset: string;
}

export interface MemoryAgentBenchQuestionRetrieval {
  answerCorrect: boolean | null;
  caseId: string;
  competency: MemoryAgentBenchCompetency;
  evidenceChunkIds: number[];
  evidenceRecall: number;
  generatedAnswer: string | null;
  goldEvidenceFullyRetrieved: boolean;
  missingEvidenceChunkIds: number[];
  noiseChunkCount: number;
  noiseChunkIds: number[];
  questionId: string;
  retrievedChunkIds: number[];
  staleChunkIds: number[];
  staleChunkSelected: boolean;
}

export function scoreMemoryAgentBenchRetrieval(input: {
  question: MemoryAgentBenchQuestion;
  retrievedChunkIds: number[];
  testCase: MemoryAgentBenchCase;
}): MemoryAgentBenchQuestionRetrieval {
  const retrieved = new Set(input.retrievedChunkIds);
  const evidenceSet = new Set(input.question.evidenceChunkIds);
  const staleSet = new Set(input.question.staleChunkIds);
  const evidenceHit = input.question.evidenceChunkIds.filter((id) =>
    retrieved.has(id)
  ).length;
  const evidenceRecall = input.question.evidenceChunkIds.length === 0
    ? 1
    : evidenceHit / input.question.evidenceChunkIds.length;
  const noiseChunkIds = input.retrievedChunkIds.filter(
    (id, index, all) =>
      !evidenceSet.has(id) &&
      !staleSet.has(id) &&
      all.indexOf(id) === index,
  );

  return {
    answerCorrect: null,
    caseId: input.testCase.caseId,
    competency: input.question.competency,
    evidenceChunkIds: input.question.evidenceChunkIds,
    evidenceRecall,
    generatedAnswer: null,
    goldEvidenceFullyRetrieved: evidenceRecall === 1,
    missingEvidenceChunkIds: input.question.evidenceChunkIds.filter(
      (id) => !retrieved.has(id),
    ),
    noiseChunkCount: noiseChunkIds.length,
    noiseChunkIds,
    questionId: input.question.questionId,
    retrievedChunkIds: input.retrievedChunkIds,
    staleChunkIds: input.question.staleChunkIds,
    staleChunkSelected: input.question.staleChunkIds.some((id) =>
      retrieved.has(id)
    ),
  };
}

export function normalizeMemoryAgentBenchAnswer(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

// Some upstream MemoryAgentBench tasks (e.g. LRU detective_qa) prompt for a JSON
// object like {"answer": "C. The Brandt couple", "reasoning": "..."} while the gold
// is the bare option string. Pull the "answer" field so JSON-wrapped output is
// scored on the answer, not the whole envelope. Returns null when no such object
// is present (so plain answers are untouched).
function extractJsonAnswerField(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "answer" in parsed &&
      typeof (parsed as { answer: unknown }).answer === "string"
    ) {
      return (parsed as { answer: string }).answer;
    }
  } catch {
    // not a JSON answer envelope; fall through
  }
  return null;
}

export function extractMemoryAgentBenchScoredAnswer(value: string): string {
  const withoutClosedReasoning = value
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/giu, "")
    .trim();
  // Prefer a JSON {"answer": ...} envelope when the model emits one.
  const jsonAnswer = extractJsonAnswerField(withoutClosedReasoning);
  if (jsonAnswer !== null) {
    return jsonAnswer;
  }
  if (withoutClosedReasoning !== value.trim()) {
    return withoutClosedReasoning;
  }

  const openReasoning = value.match(/^\s*<think\b[^>]*>([\s\S]*)$/iu);
  if (!openReasoning) {
    return value.trim();
  }
  const nonEmptyLines = openReasoning[1]
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return nonEmptyLines.at(-1) ?? "";
}

export function substringExactMatch(answer: string, gold: string): boolean {
  const normalizedGold = normalizeMemoryAgentBenchAnswer(gold);
  if (normalizedGold.length === 0) {
    return false;
  }
  return normalizeMemoryAgentBenchAnswer(answer).includes(normalizedGold);
}

export function exactMatch(answer: string, gold: string): boolean {
  return (
    normalizeMemoryAgentBenchAnswer(answer) ===
    normalizeMemoryAgentBenchAnswer(gold)
  );
}

export function scoreMemoryAgentBenchAnswer(input: {
  answer: string;
  goldAnswer: string;
  matchMode: MemoryAgentBenchMatchMode;
}): boolean {
  const scoredAnswer = extractMemoryAgentBenchScoredAnswer(input.answer);
  return input.matchMode === "substring_exact_match"
    ? substringExactMatch(scoredAnswer, input.goldAnswer)
    : exactMatch(scoredAnswer, input.goldAnswer);
}

// Synthetic smoke fixture: one small case per competency, following the shapes
// named in the Phase 64 breakdown board. No upstream data is vendored.
export function buildMemoryAgentBenchSmokeCases(): MemoryAgentBenchCase[] {
  return [
    // AR: a later question asks for a directly stated fact.
    {
      caseId: "synthetic-ar-launch-room",
      competency: "AR",
      sourceDataset: "synthetic-event_qa",
      chunks: [
        {
          id: 1,
          role: "user",
          content:
            "Kickoff notes: the platform launch review is scheduled for March 14, 2025 in Room 301 with the data team.",
        },
        {
          id: 2,
          role: "assistant",
          content:
            "Noted. I have logged the launch review details for the platform team.",
        },
        {
          id: 3,
          role: "user",
          content:
            "Also remember the design sync happens every Tuesday in Room 118.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-ar-launch-room:1",
          competency: "AR",
          question: "Which room is the platform launch review scheduled in?",
          goldAnswer: "Room 301",
          matchMode: "substring_exact_match",
          evidenceChunkIds: [1],
          staleChunkIds: [],
        },
      ],
    },
    // TTL: the user teaches a labelling rule; a later task must apply it.
    {
      caseId: "synthetic-ttl-priority-rule",
      competency: "TTL",
      sourceDataset: "synthetic-ICL",
      chunks: [
        {
          id: 1,
          role: "user",
          content:
            "Rule: when I tag a message with [P1], classify its category as exactly: urgent.",
        },
        {
          id: 2,
          role: "user",
          content:
            "Rule: when I tag a message with [P3], classify its category as exactly: low.",
        },
        {
          id: 3,
          role: "assistant",
          content: "Understood. I will apply your [P1] and [P3] tagging rules.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-ttl-priority-rule:1",
          competency: "TTL",
          question:
            "I just tagged the outage report with [P1]. Reply with only its category.",
          goldAnswer: "urgent",
          matchMode: "exact_match",
          evidenceChunkIds: [1],
          staleChunkIds: [],
        },
      ],
    },
    // LRU: the final question joins distant trajectory events.
    {
      caseId: "synthetic-lru-badge-holder",
      competency: "LRU",
      sourceDataset: "synthetic-detectiveQA",
      chunks: [
        {
          id: 1,
          role: "user",
          content: "Alice received the access badge from the security desk.",
        },
        {
          id: 2,
          role: "user",
          content: "The quarterly report was filed on Monday.",
        },
        {
          id: 3,
          role: "user",
          content: "Alice handed the access badge to Bob before leaving early.",
        },
        {
          id: 4,
          role: "user",
          content: "Lunch was rescheduled to 1 PM on Wednesday.",
        },
        {
          id: 5,
          role: "user",
          content: "Bob passed the access badge to Carol for the night shift.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-lru-badge-holder:1",
          competency: "LRU",
          question:
            "Who holds the access badge at the end of the shift? Reply with only the name.",
          goldAnswer: "Carol",
          matchMode: "exact_match",
          evidenceChunkIds: [3, 5],
          staleChunkIds: [],
        },
      ],
    },
    // CR: an old fact is superseded; the answer must use the current value.
    {
      caseId: "synthetic-cr-travel-budget",
      competency: "CR",
      sourceDataset: "synthetic-fact_sh",
      chunks: [
        {
          id: 1,
          role: "user",
          content: "Set the quarterly travel budget to $5,000 for the team.",
        },
        {
          id: 2,
          role: "assistant",
          content: "The quarterly travel budget is recorded as $5,000.",
        },
        {
          id: 3,
          role: "user",
          content:
            "Update: after the revision, the quarterly travel budget is now $8,000.",
        },
      ],
      questions: [
        {
          questionId: "synthetic-cr-travel-budget:1",
          competency: "CR",
          question: "What is the current quarterly travel budget?",
          goldAnswer: "$8,000",
          matchMode: "substring_exact_match",
          evidenceChunkIds: [3],
          staleChunkIds: [1],
        },
      ],
    },
  ];
}

// Per-question evaluation result for the Phase 64 smoke report.
export interface MemoryAgentBenchQuestionResult {
  answerCorrect: boolean;
  caseId: string;
  competency: MemoryAgentBenchCompetency;
  // Evidence chunk ids the system retrieved (when the adapter can report them).
  evidenceRecall: number;
  noiseChunkCount: number;
  questionId: string;
  staleChunkSelected: boolean;
}

export interface MemoryAgentBenchCompetencySummary {
  answerAccuracy: number;
  averageEvidenceRecall: number;
  competency: MemoryAgentBenchCompetency;
  correctCount: number;
  noiseChunkTotal: number;
  questionCount: number;
  staleSelectedCount: number;
}

export function summarizeMemoryAgentBenchResults(
  results: MemoryAgentBenchQuestionResult[],
): MemoryAgentBenchCompetencySummary[] {
  return MEMORY_AGENT_BENCH_COMPETENCIES.map((competency) => {
    const bucket = results.filter(
      (result) => result.competency === competency,
    );
    const questionCount = bucket.length;
    const correctCount = bucket.filter(
      (result) => result.answerCorrect,
    ).length;
    const recallTotal = bucket.reduce(
      (sum, result) => sum + result.evidenceRecall,
      0,
    );
    return {
      competency,
      questionCount,
      correctCount,
      answerAccuracy: questionCount === 0 ? 0 : correctCount / questionCount,
      averageEvidenceRecall:
        questionCount === 0 ? 0 : recallTotal / questionCount,
      noiseChunkTotal: bucket.reduce(
        (sum, result) => sum + result.noiseChunkCount,
        0,
      ),
      staleSelectedCount: bucket.filter(
        (result) => result.staleChunkSelected,
      ).length,
    };
  });
}
