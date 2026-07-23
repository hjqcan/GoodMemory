import { describe, expect, it } from "bun:test";
import {
  buildPhase63BeamCurlRequestCommand,
  buildPhase63BeamGithubIndexUrl,
  buildPhase63BeamRowsUrl,
  parsePhase63BeamPrepareCliOptions,
  preparePhase63BeamData,
} from "../../scripts/prepare-phase-63-beam-data";

interface TestRowsResponse {
  num_rows_per_page: number;
  num_rows_total: number;
  partial: boolean;
  rows: Array<{
    row: Record<string, unknown>;
    row_idx: number;
    truncated_cells: string[];
  }>;
}

function buildRowsResponse(): TestRowsResponse {
  return {
    num_rows_per_page: 100,
    num_rows_total: 1,
    partial: false,
    rows: [
      {
        row: {
          chat: [],
          conversation_id: "1",
          conversation_plan: "BATCH 1 PLAN",
          conversation_seed: {
            category: "Coding",
            id: 1,
            subtopics: ["Flask"],
            theme: "Budget tracker",
            title: "Building a Flask App",
          },
          narratives: "Narratives",
          probing_questions: "{'abstention': []}",
          user_profile: {
            user_info: "USER PROFILE",
            user_relationships: "None",
          },
          user_questions: [],
        },
        row_idx: 0,
        truncated_cells: [],
      },
    ],
  } satisfies TestRowsResponse;
}

describe("prepare-phase-63 BEAM data script", () => {
  it("parses the external-root preparation flags", () => {
    expect(
      parsePhase63BeamPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-63-beam-data.ts",
        "--output-root",
        "/tmp/BEAM",
        "--split",
        "100K",
        "--offset",
        "2",
        "--length",
        "20",
      ]),
    ).toEqual({
      dataset: "Mohammadta/BEAM",
      length: 20,
      offset: 2,
      outputRoot: "/tmp/BEAM",
      split: "100K",
    });
  });

  it("parses the GitHub raw preparation source flag", () => {
    expect(
      parsePhase63BeamPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-63-beam-data.ts",
        "--source",
        "github-raw",
        "--github-api-root",
        "https://api.github.test/contents/chats",
        "--github-concurrency",
        "3",
        "--github-raw-root",
        "https://raw.github.test/BEAM/main/chats",
      ]),
    ).toMatchObject({
      githubApiRoot: "https://api.github.test/contents/chats",
      githubConcurrency: 3,
      githubRawRoot: "https://raw.github.test/BEAM/main/chats",
      source: "github-raw",
    });
  });

  it("parses a fixed local parquet source without consulting dataset HEAD", () => {
    expect(
      parsePhase63BeamPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-63-beam-data.ts",
        "--source",
        "local-parquet",
        "--parquet-file",
        "/evidence/BEAM/100K.parquet",
      ]),
    ).toMatchObject({
      parquetFile: "/evidence/BEAM/100K.parquet",
      source: "local-parquet",
    });
  });

  it("rejects empty or whitespace-padded BEAM root environment values", () => {
    const original = process.env.GOODMEMORY_BEAM_ROOT;
    try {
      process.env.GOODMEMORY_BEAM_ROOT = "/tmp/BEAM-env";
      expect(
        parsePhase63BeamPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-63-beam-data.ts",
        ]).outputRoot,
      ).toBe("/tmp/BEAM-env");
      expect(
        parsePhase63BeamPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-63-beam-data.ts",
          "--output-root",
          "/tmp/BEAM-cli",
        ]).outputRoot,
      ).toBe("/tmp/BEAM-cli");

      process.env.GOODMEMORY_BEAM_ROOT = " /tmp/BEAM-env ";
      expect(() =>
        parsePhase63BeamPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-63-beam-data.ts",
        ]),
      ).toThrow("GOODMEMORY_BEAM_ROOT cannot be empty or whitespace-padded.");

      process.env.GOODMEMORY_BEAM_ROOT = "";
      expect(() =>
        parsePhase63BeamPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-63-beam-data.ts",
        ]),
      ).toThrow("GOODMEMORY_BEAM_ROOT cannot be empty or whitespace-padded.");
    } finally {
      if (original === undefined) {
        delete process.env.GOODMEMORY_BEAM_ROOT;
      } else {
        process.env.GOODMEMORY_BEAM_ROOT = original;
      }
    }
  });

  it("rejects invalid GitHub raw concurrency", () => {
    expect(() =>
      parsePhase63BeamPrepareCliOptions([
        "bun",
        "run",
        "scripts/prepare-phase-63-beam-data.ts",
        "--github-concurrency",
        "0",
      ]),
    ).toThrow("--github-concurrency must be a positive integer");
  });

  it("rejects duplicate scalar preparation flags before fetching rows", () => {
    const duplicateScalarFlags = [
      "--dataset",
      "--github-api-root",
      "--github-concurrency",
      "--github-raw-root",
      "--length",
      "--offset",
      "--output-root",
      "--parquet-file",
      "--source",
      "--split",
    ];

    for (const flag of duplicateScalarFlags) {
      expect(() =>
        parsePhase63BeamPrepareCliOptions([
          "bun",
          "run",
          "scripts/prepare-phase-63-beam-data.ts",
          flag,
          flag === "--source" ? "huggingface" : "first",
          flag,
          flag === "--source" ? "github-raw" : "second",
        ]),
      ).toThrow(`${flag} cannot be specified more than once.`);
    }
  });

  it("builds the Hugging Face rows endpoint URL", () => {
    expect(
      buildPhase63BeamRowsUrl({
        dataset: "Mohammadta/BEAM",
        length: 20,
        offset: 0,
        split: "100K",
      }),
    ).toBe(
      "https://datasets-server.huggingface.co/rows?dataset=Mohammadta%2FBEAM&config=default&split=100K&offset=0&length=20",
    );
  });

  it("builds the GitHub raw source index URL", () => {
    expect(
      buildPhase63BeamGithubIndexUrl({
        githubApiRoot: "https://api.github.test/contents/chats/",
        split: "100K",
      }),
    ).toBe("https://api.github.test/contents/chats/100K");
  });

  it("uses bounded retry flags for external BEAM curl requests", () => {
    expect(buildPhase63BeamCurlRequestCommand("https://beam.test/row.json")).toEqual([
      "curl",
      "-sS",
      "-L",
      "--retry",
      "4",
      "--retry-delay",
      "1",
      "--retry-all-errors",
      "--connect-timeout",
      "20",
      "--max-time",
      "120",
      "https://beam.test/row.json",
    ]);
  });

  it("writes an external-root JSON export without vendoring upstream rows", async () => {
    const writes = new Map<string, string>();
    const result = await preparePhase63BeamData(
      {
        dataset: "Mohammadta/BEAM",
        length: 20,
        offset: 0,
        outputRoot: "/tmp/BEAM",
        split: "100K",
      },
      {
        mkdir: async () => undefined,
        now: () => new Date("2026-05-18T00:00:00.000Z"),
        requestJson: async () => buildRowsResponse(),
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(result.dataFile).toBe("/tmp/BEAM/100K.json");
    expect(result.rowCount).toBe(1);
    expect(writes.has("/tmp/BEAM/100K.json")).toBe(true);
    expect(writes.has("/tmp/BEAM/phase-63-beam-export-metadata.json")).toBe(true);
    expect(JSON.parse(writes.get("/tmp/BEAM/100K.json") ?? "[]")).toEqual([
      buildRowsResponse().rows[0].row,
    ]);
  });

  it("rebuilds the canonical rows from a fixed local parquet file", async () => {
    const writes = new Map<string, string>();
    let parquetPath = "";
    const result = await preparePhase63BeamData(
      {
        dataset: "Mohammadta/BEAM",
        length: 1,
        offset: 0,
        outputRoot: "/tmp/BEAM",
        parquetFile: "/evidence/BEAM/100K.parquet",
        source: "local-parquet",
        split: "100K",
      },
      {
        mkdir: async () => undefined,
        now: () => new Date("2026-07-23T00:00:00.000Z"),
        readParquetObjects: async (path) => {
          parquetPath = path;
          return [{
            ...buildRowsResponse().rows[0].row,
            conversation_seed: {
              ...buildRowsResponse().rows[0].row.conversation_seed as Record<
                string,
                unknown
              >,
              id: 1n,
            },
          }];
        },
        requestJson: async () => {
          throw new Error("dataset HEAD must not be read");
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(parquetPath).toBe("/evidence/BEAM/100K.parquet");
    expect(result).toMatchObject({
      rowCount: 1,
      rowsEndpoint: "file:///evidence/BEAM/100K.parquet",
      source: "local-parquet",
      totalRows: 1,
    });
    expect(JSON.parse(writes.get("/tmp/BEAM/100K.json") ?? "[]")).toEqual([
      buildRowsResponse().rows[0].row,
    ]);
  });

  it("writes a GitHub raw JSON export reconstructed from conversation folders", async () => {
    const writes = new Map<string, string>();
    const jsonResponses = new Map<string, unknown>([
      [
        "https://api.github.test/contents/chats/100K",
        [
          { name: "2", type: "dir" },
          { name: "notes.txt", type: "file" },
          { name: "1", type: "dir" },
        ],
      ],
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/chat.json",
        [
          {
            batch_number: 1,
            time_anchor: "March-15-2024",
            turns: [
              [
                {
                  content: "I prefer minimal dependencies.",
                  id: 4,
                  index: "1,2",
                  question_type: "main_question",
                  role: "user",
                  time_anchor: "March-15-2024",
                },
              ],
            ],
          },
        ],
      ],
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/topic.json",
        {
          category: "Coding",
          id: 1,
          subtopics: ["Flask"],
          theme: "Budget tracker",
          title: "Building a Flask App",
        },
      ],
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/probing_questions/probing_questions.json",
        {
          preference_following: [
            {
              answer: "Use minimal dependencies.",
              question: "What dependency style do I prefer?",
              question_id: "beam-github-q1",
              source_chat_ids: [4],
            },
          ],
        },
      ],
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/user_messages.json",
        [
          {
            batch: 1,
            messages: [
              {
                content: "I prefer minimal dependencies.",
                role: "user",
              },
            ],
            time_anchor: "March-15-2024",
          },
        ],
      ],
    ]);
    const textResponses = new Map<string, string>([
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/plan_new.txt",
        "BATCH 1 PLAN",
      ],
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/labels.txt",
        "Technical Problem-Solving Labels",
      ],
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/main_spec.txt",
        "USER PROFILE: Craig",
      ],
      [
        "https://raw.github.test/BEAM/main/chats/100K/1/relationships.txt",
        "CLOSE FRIENDS: Kelly",
      ],
    ]);
    const result = await preparePhase63BeamData(
      {
        dataset: "Mohammadta/BEAM",
        githubApiRoot: "https://api.github.test/contents/chats",
        githubRawRoot: "https://raw.github.test/BEAM/main/chats",
        length: 1,
        offset: 0,
        outputRoot: "/tmp/BEAM",
        source: "github-raw",
        split: "100K",
      },
      {
        mkdir: async () => undefined,
        now: () => new Date("2026-05-18T00:00:00.000Z"),
        requestJson: async (url) => {
          if (!jsonResponses.has(url)) {
            throw new Error(`Unexpected JSON request ${url}`);
          }
          return jsonResponses.get(url);
        },
        requestText: async (url) => {
          const value = textResponses.get(url);
          if (value === undefined) {
            throw new Error(`Unexpected text request ${url}`);
          }
          return value;
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    expect(result.rowCount).toBe(1);
    expect(result.rowsEndpoint).toBe("https://api.github.test/contents/chats/100K");
    expect(result.source).toBe("github-raw");
    const rows = JSON.parse(writes.get("/tmp/BEAM/100K.json") ?? "[]");
    expect(rows[0]).toMatchObject({
      conversation_id: "1",
      conversation_plan: "BATCH 1 PLAN",
      narratives: "Technical Problem-Solving Labels",
      user_profile: {
        user_info: "USER PROFILE: Craig",
        user_relationships: "CLOSE FRIENDS: Kelly",
      },
    });
    expect(rows[0].chat).toEqual([
      [
        {
          content: "I prefer minimal dependencies.",
          id: 4,
          index: "1,2",
          question_type: "main_question",
          role: "user",
          time_anchor: "March-15-2024",
        },
      ],
    ]);
    expect(rows[0].user_questions).toEqual([
      {
        messages: [["I prefer minimal dependencies."]],
        time_anchor: "March-15-2024",
      },
    ]);
  });

  it("fetches GitHub raw conversation folders concurrently while preserving row order", async () => {
    const writes = new Map<string, string>();
    const jsonResponses = new Map<string, unknown>([
      [
        "https://api.github.test/contents/chats/100K",
        [
          { name: "1", type: "dir" },
          { name: "2", type: "dir" },
        ],
      ],
    ]);
    const textResponses = new Map<string, string>();
    for (const conversationId of ["1", "2"]) {
      jsonResponses.set(
        `https://raw.github.test/BEAM/main/chats/100K/${conversationId}/chat.json`,
        [
          {
            batch_number: 1,
            time_anchor: "March-15-2024",
            turns: [
              [
                {
                  content: `conversation ${conversationId}`,
                  id: Number(conversationId),
                  index: `1,${conversationId}`,
                  question_type: "main_question",
                  role: "user",
                  time_anchor: "March-15-2024",
                },
              ],
            ],
          },
        ],
      );
      jsonResponses.set(
        `https://raw.github.test/BEAM/main/chats/100K/${conversationId}/topic.json`,
        { id: Number(conversationId), title: `Conversation ${conversationId}` },
      );
      jsonResponses.set(
        `https://raw.github.test/BEAM/main/chats/100K/${conversationId}/probing_questions/probing_questions.json`,
        { information_extraction: [] },
      );
      jsonResponses.set(
        `https://raw.github.test/BEAM/main/chats/100K/${conversationId}/user_messages.json`,
        [
          {
            messages: [{ content: `conversation ${conversationId}`, role: "user" }],
            time_anchor: "March-15-2024",
          },
        ],
      );
      for (const fileName of [
        "plan_new.txt",
        "labels.txt",
        "main_spec.txt",
        "relationships.txt",
      ]) {
        textResponses.set(
          `https://raw.github.test/BEAM/main/chats/100K/${conversationId}/${fileName}`,
          `${fileName} ${conversationId}`,
        );
      }
    }
    let activeChatRequests = 0;
    let maxActiveChatRequests = 0;

    await preparePhase63BeamData(
      {
        dataset: "Mohammadta/BEAM",
        githubApiRoot: "https://api.github.test/contents/chats",
        githubConcurrency: 2,
        githubRawRoot: "https://raw.github.test/BEAM/main/chats",
        length: 2,
        offset: 0,
        outputRoot: "/tmp/BEAM",
        source: "github-raw",
        split: "100K",
      },
      {
        mkdir: async () => undefined,
        requestJson: async (url) => {
          const value = jsonResponses.get(url);
          if (value === undefined) {
            throw new Error(`Unexpected JSON request ${url}`);
          }
          if (url.endsWith("/chat.json")) {
            activeChatRequests += 1;
            maxActiveChatRequests = Math.max(
              maxActiveChatRequests,
              activeChatRequests,
            );
            await new Promise((resolve) => setTimeout(resolve, 10));
            activeChatRequests -= 1;
          }
          return value;
        },
        requestText: async (url) => {
          const value = textResponses.get(url);
          if (value === undefined) {
            throw new Error(`Unexpected text request ${url}`);
          }
          return value;
        },
        writeFile: async (path, value) => {
          writes.set(path, value);
        },
      },
    );

    const rows = JSON.parse(writes.get("/tmp/BEAM/100K.json") ?? "[]");
    expect(maxActiveChatRequests).toBeGreaterThan(1);
    expect(rows.map((row: { conversation_id: string }) => row.conversation_id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("rejects truncated rows responses before writing an incomplete export", async () => {
    await expect(
      preparePhase63BeamData(
        {
          dataset: "Mohammadta/BEAM",
          length: 20,
          offset: 0,
          outputRoot: "/tmp/BEAM",
          split: "100K",
        },
        {
          mkdir: async () => undefined,
          requestJson: async () => ({
            ...buildRowsResponse(),
            rows: [
              {
                row: {},
                row_idx: 0,
                truncated_cells: ["chat"],
              },
            ],
          }),
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("truncated cells");
  });
});
