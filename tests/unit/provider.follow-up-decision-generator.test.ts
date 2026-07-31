import { describe, expect, it } from "bun:test";

import { createProviderFollowUpDecisionGenerator } from "../../src/provider/followUpDecisionGenerator";

function sseResponse(content: string): Response {
  return new Response(
    [
      `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}},"index":0}]}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    },
  );
}

describe("provider follow-up decision generator", () => {
  it("returns structured sufficiency and missing slots", async () => {
    let requestBody = "";
    const generator = createProviderFollowUpDecisionGenerator({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return sseResponse(
          [
            "{",
            '"sufficient":false,',
            '"missingSlots":["What sport does Priya Raman practice?"]',
            "}",
          ].join(""),
        );
      },
      model: {
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
        model: "test-model",
        provider: "openai",
      },
      retryLimit: 1,
    });

    const decision = await generator.generate({
      evidence: ["The team goaltender is Priya Raman."],
      hop: 1,
      query: "What sport does the team goaltender play?",
    });

    expect(decision).toEqual({
      missingSlots: ["What sport does Priya Raman practice?"],
      sufficient: false,
    });
    expect(requestBody).toContain("Retrieval hop: 1");
    expect(requestBody).toContain("1. The team goaltender is Priya Raman.");
    expect(requestBody).toContain("missingSlots");
    expect(requestBody).toContain("explicitly support every part");
    expect(requestBody).toContain("different from the original question");
    for (const forbidden of [
      "gold answer",
      "gold evidence",
      "locomo",
      "longmemeval",
      "memoryagentbench",
      "multi_hop",
    ]) {
      expect(requestBody.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("returns a sufficient decision and validates configuration", async () => {
    const generator = createProviderFollowUpDecisionGenerator({
      fetch: async () =>
        sseResponse(
          '{"sufficient":true,"missingSlots":[]}',
        ),
      model: {
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
        model: "test-model",
        provider: "openai",
      },
      retryLimit: 1,
    });
    expect(
      await generator.generate({ evidence: ["snippet"], hop: 1, query: "q" }),
    ).toEqual({
      missingSlots: [],
      sufficient: true,
    });

    expect(() =>
      createProviderFollowUpDecisionGenerator({
        model: {
          apiKey: "k",
          baseURL: "https://example.test/v1",
          model: "m",
          provider: "openai",
        },
        retryLimit: 0,
      }),
    ).toThrow(/retryLimit/);
  });

  it("preserves the historical query-only arm behind an explicit experiment mode", async () => {
    const generator = createProviderFollowUpDecisionGenerator({
      fetch: async () =>
        sseResponse(
          '{"followUpQuery":"What sport does Priya Raman practice?"}',
        ),
      mode: "query_only",
      model: {
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
        model: "test-model",
        provider: "openai",
      },
      retryLimit: 1,
    });

    expect(
      await generator.generate({
        evidence: ["The team goaltender is Priya Raman."],
        hop: 1,
        query: "What sport does the team goaltender play?",
      }),
    ).toEqual({
      missingSlots: ["What sport does Priya Raman practice?"],
      sufficient: false,
    });
  });
});
