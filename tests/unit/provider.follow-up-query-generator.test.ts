import { describe, expect, it } from "bun:test";

import { createProviderFollowUpQueryGenerator } from "../../src/provider/followUpQueryGenerator";

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

describe("provider follow-up query generator", () => {
  it("returns the focused follow-up and passes evidence in the prompt", async () => {
    let requestBody = "";
    const generator = createProviderFollowUpQueryGenerator({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return sseResponse(
          '{"followUpQuery":"What sport does Priya Raman practice?"}',
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

    const followUp = await generator.generate({
      evidence: ["The team goaltender is Priya Raman."],
      hop: 1,
      query: "What sport does the team goaltender play?",
    });

    expect(followUp).toBe("What sport does Priya Raman practice?");
    expect(requestBody).toContain("Retrieval hop: 1");
    expect(requestBody).toContain("1. The team goaltender is Priya Raman.");
  });

  it("returns null for an empty follow-up and validates configuration", async () => {
    const generator = createProviderFollowUpQueryGenerator({
      fetch: async () => sseResponse('{"followUpQuery":"  "}'),
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
    ).toBeNull();

    expect(() =>
      createProviderFollowUpQueryGenerator({
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
});
