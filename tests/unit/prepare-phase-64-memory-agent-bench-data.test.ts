import { describe, expect, it } from "bun:test";
import {
  buildPhase64MabRowsUrl,
  parsePhase64MabPrepareCliOptions,
  preparePhase64MemoryAgentBenchData,
} from "../../scripts/prepare-phase-64-memory-agent-bench-data";

// A tiny synthetic event_qa row (no upstream data vendored): two questions over
// a three-event ordering sequence. event 1 = previous_events[0]; the gold next
// events are answers[i][0].
function buildEventQaRowsResponse() {
  return {
    num_rows_total: 22,
    partial: false,
    rows: [
      {
        row: {
          answers: [["B happens"], ["C happens"]],
          context: "the long source story text...",
          metadata: {
            previous_events: ["1. A happens.\n", "1. A happens.\n2. B happens.\n"],
            qa_pair_ids: ["eventqa_full_no0", "eventqa_full_no1"],
            source: "eventqa_full",
          },
          questions: [
            'Already occurred:\n1. A happens.\nNext from ["B happens","Z happens"]?',
            'Already occurred:\n1. A happens.\n2. B happens.\nNext from ["C happens","Y happens"]?',
          ],
        },
        row_idx: 5,
        truncated_cells: [],
      },
    ],
  };
}

// A tiny synthetic factconsolidation (CR) row: a numbered fact list whose gold
// answers recur a controlled number of times. "red" recurs in 4 facts (over the
// default --max-evidence-facts 3) and must be dropped as common-string noise.
function buildFactConsolidationRowsResponse() {
  return {
    num_rows_total: 8,
    partial: false,
    rows: [
      {
        row: {
          answers: [["London"], ["pesapallo"], ["Paris"], ["red"]],
          context: [
            "Here is a list of facts:",
            "0. Alice was born in London.",
            "1. Bob plays pesapallo.",
            "2. Carol lives in Paris.",
            "3. Bob now plays pesapallo professionally.",
            "4. The flag is red.",
            "5. The car is red.",
            "6. The barn is red.",
            "7. The apple is red.",
          ].join("\n"),
          metadata: {
            qa_pair_ids: ["fc_no0", "fc_no1", "fc_no2", "fc_no3"],
            source: "factconsolidation_sh_6k",
          },
          questions: [
            "Where was Alice born?",
            "What does Bob play?",
            "Where does Carol live?",
            "What color is the flag?",
          ],
        },
        row_idx: 4,
        truncated_cells: [],
      },
    ],
  };
}

// A tiny synthetic ICL (TTL) row: "<utterance>\nlabel: <id>" demos. Gold label
// 11 has two demos (kept); gold 99 has none (dropped, cannot be learned).
function buildIclRowsResponse() {
  return {
    num_rows_total: 6,
    partial: false,
    rows: [
      {
        row: {
          answers: [["11"], ["99"]],
          context: [
            "I tried to transfer money but it failed.\nlabel: 11",
            "My card got lost yesterday.\nlabel: 22",
            "Another failed transfer attempt.\nlabel: 11",
            "I need a new PIN.\nlabel: 33",
          ].join("\n\n"),
          metadata: {
            qa_pair_ids: ["icl_no0", "icl_no1"],
            source: "icl_banking77_5900shot_balance",
          },
          questions: [
            "My transfer keeps failing, what's wrong?",
            "An utterance whose gold label has no demo.",
          ],
        },
        row_idx: 1,
        truncated_cells: [],
      },
    ],
  };
}

// A tiny synthetic detective_qa (LRU) row: a short story plus one multiple-choice
// whodunit whose options + "Output:" cue are in the question; gold is the full
// chosen option (exact_match). The story mentions the answer entity.
function buildDetectiveQaRowsResponse() {
  return {
    num_rows_total: 110,
    partial: false,
    rows: [
      {
        row: {
          answers: [["B. The Brandt couple"]],
          context:
            "The manor stood silent. The Brandt couple had lived there for years before the incident, and several witnesses placed them at the scene.",
          metadata: {
            qa_pair_ids: ["detective_qa_book124_no0"],
            source: "detective_qa_book124",
          },
          questions: [
            "Who is related to the death? A. Mrs. Hemm B. The Brandt couple C. Miss House\nOutput:",
          ],
        },
        row_idx: 100,
        truncated_cells: [],
      },
    ],
  };
}

describe("prepare-phase-64 MemoryAgentBench data script", () => {
  it("parses competency, offset, max-questions, and merge flags", () => {
    expect(
      parsePhase64MabPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        "--competency",
        "AR",
        "--offset",
        "5",
        "--max-questions",
        "20",
        "--merge",
        "--output-root",
        "/tmp/MAB",
      ]),
    ).toEqual({
      competency: "AR",
      dataset: "ai-hyz/MemoryAgentBench",
      maxChunks: null,
      maxEvidenceFacts: 3,
      maxQuestions: 20,
      merge: true,
      offset: 5,
      outputRoot: "/tmp/MAB",
    });
  });

  it("parses a fixed local parquet source", () => {
    expect(
      parsePhase64MabPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        "--competency",
        "CR",
        "--parquet-file",
        "/evidence/MAB/conflict.parquet",
      ]),
    ).toMatchObject({
      parquetFile: "/evidence/MAB/conflict.parquet",
    });
  });

  it("rejects duplicate CLI mode and output flags before preparation", () => {
    expect(() =>
      parsePhase64MabPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        "--merge",
        "--merge",
      ]),
    ).toThrow("--merge cannot be specified more than once.");

    expect(() =>
      parsePhase64MabPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        "--output-root",
        "/tmp/MAB-a",
        "--output-root",
        "/tmp/MAB-b",
      ]),
    ).toThrow("--output-root cannot be specified more than once.");
  });

  it("normalizes a selected row from fixed local parquet without reading dataset HEAD", async () => {
    const writes = new Map<string, string>();
    let parquetPath = "";
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "CR",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: false,
        offset: 0,
        outputRoot: "/tmp/MAB",
        parquetFile: "/evidence/MAB/conflict.parquet",
      },
      {
        mkdir: async () => undefined,
        now: () => new Date("2026-07-23T00:00:00.000Z"),
        readParquetObjects: async (path) => {
          parquetPath = path;
          return [buildFactConsolidationRowsResponse().rows[0].row];
        },
        requestJson: async () => {
          throw new Error("dataset HEAD must not be read");
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(parquetPath).toBe("/evidence/MAB/conflict.parquet");
    expect(result.rowsEndpoint).toBe("file:///evidence/MAB/conflict.parquet#row=0");
    expect(result.questionCount).toBe(3);
    expect(JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}").cases).toHaveLength(1);
  });

  it("rejects empty or whitespace-padded MemoryAgentBench root environment values", () => {
    const original = process.env.GOODMEMORY_MAB_ROOT;
    try {
      process.env.GOODMEMORY_MAB_ROOT = "/tmp/MAB-env";
      expect(
        parsePhase64MabPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        ]).outputRoot,
      ).toBe("/tmp/MAB-env");
      expect(
        parsePhase64MabPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-64-memory-agent-bench-data.ts",
          "--output-root",
          "/tmp/MAB-cli",
        ]).outputRoot,
      ).toBe("/tmp/MAB-cli");

      process.env.GOODMEMORY_MAB_ROOT = " /tmp/MAB-env ";
      expect(() =>
        parsePhase64MabPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        ]),
      ).toThrow("GOODMEMORY_MAB_ROOT cannot be empty or whitespace-padded.");

      process.env.GOODMEMORY_MAB_ROOT = "";
      expect(() =>
        parsePhase64MabPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        ]),
      ).toThrow("GOODMEMORY_MAB_ROOT cannot be empty or whitespace-padded.");
    } finally {
      if (original === undefined) {
        delete process.env.GOODMEMORY_MAB_ROOT;
      } else {
        process.env.GOODMEMORY_MAB_ROOT = original;
      }
    }
  });

  it("defaults AR to the eventqa_full row (offset 5), all questions, no merge", () => {
    expect(
      parsePhase64MabPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-64-memory-agent-bench-data.ts",
        "--output-root",
        "/tmp/MAB",
      ]),
    ).toEqual({
      competency: "AR",
      dataset: "ai-hyz/MemoryAgentBench",
      maxChunks: null,
      maxEvidenceFacts: 3,
      maxQuestions: null,
      merge: false,
      offset: 5,
      outputRoot: "/tmp/MAB",
    });
  });

  it("rejects an unknown competency", () => {
    expect(() =>
      parsePhase64MabPrepareCliOptions([
        "bun",
        "run",
        "x",
        "--competency",
        "XX",
      ]),
    ).toThrow("--competency must be one of");
  });

  it("builds the Hugging Face rows endpoint URL for a competency split", () => {
    expect(
      buildPhase64MabRowsUrl({
        dataset: "ai-hyz/MemoryAgentBench",
        length: 1,
        offset: 5,
        split: "Accurate_Retrieval",
      }),
    ).toBe(
      "https://datasets-server.huggingface.co/rows?dataset=ai-hyz%2FMemoryAgentBench&config=default&split=Accurate_Retrieval&offset=5&length=1",
    );
  });

  it("normalizes an event_qa row into the smoke cases.json contract", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "AR",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: false,
        offset: 5,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        now: () => new Date("2026-06-23T00:00:00.000Z"),
        requestJson: async (url) => {
          expect(url).toContain("split=Accurate_Retrieval");
          expect(url).toContain("offset=5");
          return buildEventQaRowsResponse();
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(result.casesFile).toBe("/tmp/MAB/cases.json");
    expect(result.competency).toBe("AR");
    expect(result.sourceDataset).toBe("eventqa_full");
    expect(result.caseId).toBe("ar_eventqa_full");
    expect(result.chunkCount).toBe(3);
    expect(result.questionCount).toBe(2);
    expect(result.totalQuestionsAvailable).toBe(2);
    expect(result.totalCasesWritten).toBe(1);

    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    expect(parsed.cases).toHaveLength(1);
    const testCase = parsed.cases[0];
    // event 1 from previous_events[0] (number prefix stripped); events 2/3 from answers.
    expect(testCase.chunks).toEqual([
      { content: "A happens.", id: 1, role: "user" },
      { content: "B happens", id: 2, role: "user" },
      { content: "C happens", id: 3, role: "user" },
    ]);
    // question i's gold evidence is the NEXT-event chunk (id i+2), by construction.
    expect(testCase.questions[0]).toMatchObject({
      competency: "AR",
      evidenceChunkIds: [2],
      goldAnswer: "B happens",
      matchMode: "substring_exact_match",
      questionId: "eventqa_full_no0",
      staleChunkIds: [],
    });
    expect(testCase.questions[1]).toMatchObject({
      evidenceChunkIds: [3],
      goldAnswer: "C happens",
      questionId: "eventqa_full_no1",
    });
    expect(writes.has("/tmp/MAB/phase-64-mab-export-metadata.json")).toBe(true);
    const metadata = JSON.parse(
      writes.get("/tmp/MAB/phase-64-mab-export-metadata.json") ?? "{}",
    );
    expect(metadata.upstreamLicense).toBe("MIT");
  });

  it("caps questions with --max-questions and keeps only the needed event chunks", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "AR",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: 1,
        merge: false,
        offset: 5,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        requestJson: async () => buildEventQaRowsResponse(),
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );
    expect(result.questionCount).toBe(1);
    expect(result.chunkCount).toBe(2); // seed event + 1 gold next event
    expect(result.totalQuestionsAvailable).toBe(2);
    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    expect(parsed.cases[0].questions).toHaveLength(1);
    expect(parsed.cases[0].chunks).toHaveLength(2);
  });

  it("normalizes a factconsolidation (CR) row, dropping high-recurrence answers", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "CR",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: false,
        offset: 4,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        requestJson: async (url) => {
          expect(url).toContain("split=Conflict_Resolution");
          expect(url).toContain("offset=4");
          return buildFactConsolidationRowsResponse();
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(result.competency).toBe("CR");
    expect(result.caseId).toBe("cr_factconsolidation_sh_6k");
    expect(result.chunkCount).toBe(8); // every fact injected as a chunk
    expect(result.questionCount).toBe(3); // London, pesapallo, Paris kept
    expect(result.droppedQuestions).toBe(1); // "red" (4 facts) dropped as noise

    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    const testCase = parsed.cases[0];
    // chunk id == fact number + 1; content keeps the "N. " prefix.
    expect(testCase.chunks[0]).toEqual({
      content: "0. Alice was born in London.",
      id: 1,
      role: "user",
    });
    const evidenceByAnswer = Object.fromEntries(
      testCase.questions.map(
        (q: { evidenceChunkIds: number[]; goldAnswer: string }) => [
          q.goldAnswer,
          q.evidenceChunkIds,
        ],
      ),
    );
    expect(evidenceByAnswer.London).toEqual([1]); // fact 0
    expect(evidenceByAnswer.pesapallo).toEqual([2, 4]); // facts 1 + 3 (consolidation chain)
    expect(evidenceByAnswer.Paris).toEqual([3]); // fact 2
    expect(evidenceByAnswer.red).toBeUndefined(); // dropped
    expect(testCase.questions[0]).toMatchObject({
      competency: "CR",
      matchMode: "substring_exact_match",
      staleChunkIds: [],
    });
  });

  it("tightens the CR recurrence filter with --max-evidence-facts 1", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "CR",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 1,
        maxQuestions: null,
        merge: false,
        offset: 4,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        requestJson: async () => buildFactConsolidationRowsResponse(),
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );
    // pesapallo (2 facts) now also dropped; only London + Paris (1 fact each) stay.
    expect(result.questionCount).toBe(2);
    expect(result.droppedQuestions).toBe(2);
  });

  it("merges by replacing same-competency cases while retaining others", async () => {
    const writes = new Map<string, string>();
    const existing = {
      cases: [
        { caseId: "cr_existing", chunks: [], competency: "CR", questions: [], sourceDataset: "fact_sh" },
        { caseId: "ar_stale", chunks: [], competency: "AR", questions: [], sourceDataset: "old" },
      ],
    };
    await preparePhase64MemoryAgentBenchData(
      {
        competency: "AR",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: true,
        offset: 5,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        readFile: async () => JSON.stringify(existing),
        requestJson: async () => buildEventQaRowsResponse(),
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );
    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    const ids = parsed.cases.map((c: { caseId: string }) => c.caseId);
    expect(ids).toContain("cr_existing"); // other competency retained
    expect(ids).not.toContain("ar_stale"); // stale AR replaced
    expect(ids).toContain("ar_eventqa_full"); // fresh AR added
    expect(parsed.cases).toHaveLength(2);
  });

  it("overwrites (does not merge) by default", async () => {
    const writes = new Map<string, string>();
    let readCount = 0;
    await preparePhase64MemoryAgentBenchData(
      {
        competency: "AR",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: false,
        offset: 5,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        readFile: async () => {
          readCount += 1;
          return '{"cases":[{"caseId":"cr_existing","competency":"CR","chunks":[],"questions":[],"sourceDataset":"x"}]}';
        },
        requestJson: async () => buildEventQaRowsResponse(),
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );
    expect(readCount).toBe(0); // no read in overwrite mode
    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0].caseId).toBe("ar_eventqa_full");
  });

  it("rejects a row whose consumed cell was truncated by the rows endpoint", async () => {
    await expect(
      preparePhase64MemoryAgentBenchData(
        {
          competency: "AR",
          dataset: "ai-hyz/MemoryAgentBench",
          maxChunks: null,
          maxEvidenceFacts: 3,
          maxQuestions: null,
          merge: false,
          offset: 5,
          outputRoot: "/tmp/MAB",
        },
        {
          mkdir: async () => undefined,
          requestJson: async () => ({
            ...buildEventQaRowsResponse(),
            rows: [
              {
                ...buildEventQaRowsResponse().rows[0],
                truncated_cells: ["metadata"],
              },
            ],
          }),
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("truncated");
  });

  it("rejects an empty rows response (offset out of range)", async () => {
    await expect(
      preparePhase64MemoryAgentBenchData(
        {
          competency: "AR",
          dataset: "ai-hyz/MemoryAgentBench",
          maxChunks: null,
          maxEvidenceFacts: 3,
          maxQuestions: null,
          merge: false,
          offset: 999,
          outputRoot: "/tmp/MAB",
        },
        {
          mkdir: async () => undefined,
          requestJson: async () => ({ rows: [] }),
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("empty");
  });

  it("rejects malformed CR rows before writing normalized cases", async () => {
    await expect(
      preparePhase64MemoryAgentBenchData(
        {
          competency: "CR",
          dataset: "ai-hyz/MemoryAgentBench",
          maxChunks: null,
          maxEvidenceFacts: 3,
          maxQuestions: null,
          merge: false,
          offset: 0,
          outputRoot: "/tmp/MAB",
        },
        {
          mkdir: async () => undefined,
          requestJson: async () => buildEventQaRowsResponse(),
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("produced no numbered facts");
  });

  it("normalizes a TTL/ICL row into an answer-eval case (label-id gold, exact_match)", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "TTL",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: false,
        offset: 1,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        requestJson: async (url) => {
          expect(url).toContain("split=Test_Time_Learning");
          return buildIclRowsResponse();
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(result.competency).toBe("TTL");
    expect(result.caseId).toBe("ttl_icl_banking77_5900shot_balance");
    expect(result.chunkCount).toBe(4); // every demo injected
    expect(result.questionCount).toBe(1); // gold 11 kept
    expect(result.droppedQuestions).toBe(1); // gold 99 has no demo

    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    const question = parsed.cases[0].questions[0];
    expect(question).toMatchObject({
      competency: "TTL",
      goldAnswer: "11",
      matchMode: "exact_match",
      evidenceChunkIds: [1, 3], // both label-11 demos
      staleChunkIds: [],
    });
    // the chunk content keeps the "<utterance>\nlabel: <id>" mapping for ICL.
    expect(parsed.cases[0].chunks[0].content).toContain("label: 11");
  });

  it("caps injected TTL demos with --max-chunks", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "TTL",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: 2,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: false,
        offset: 1,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        requestJson: async () => buildIclRowsResponse(),
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );
    // Only the first 2 demos injected (label 11, label 22); gold 11 keeps demo 1.
    expect(result.chunkCount).toBe(2);
    expect(result.questionCount).toBe(1);
    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    expect(parsed.cases[0].questions[0].evidenceChunkIds).toEqual([1]);
  });

  it("normalizes an LRU/detective_qa row into a multiple-choice answer-eval case", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase64MemoryAgentBenchData(
      {
        competency: "LRU",
        dataset: "ai-hyz/MemoryAgentBench",
        maxChunks: null,
        maxEvidenceFacts: 3,
        maxQuestions: null,
        merge: false,
        offset: 100,
        outputRoot: "/tmp/MAB",
      },
      {
        mkdir: async () => undefined,
        requestJson: async (url) => {
          expect(url).toContain("split=Long_Range_Understanding");
          return buildDetectiveQaRowsResponse();
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(result.competency).toBe("LRU");
    expect(result.caseId).toBe("lru_detective_qa_book124");
    expect(result.questionCount).toBe(1);
    expect(result.chunkCount).toBeGreaterThan(0); // story chunked into windows

    const parsed = JSON.parse(writes.get("/tmp/MAB/cases.json") ?? "{}");
    const question = parsed.cases[0].questions[0];
    expect(question).toMatchObject({
      competency: "LRU",
      goldAnswer: "B. The Brandt couple",
      matchMode: "exact_match",
      staleChunkIds: [],
    });
    // evidence = story windows mentioning the answer entity (option letter stripped).
    expect(question.evidenceChunkIds.length).toBeGreaterThan(0);
  });
});
