import { describe, expect, it } from "bun:test";

import { createProviderRetrievalCueGenerator } from "../../src/provider/retrievalCueGenerator";

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

describe("provider retrieval-cue generator", () => {
  it("requests cues for a fact and returns the parsed list", async () => {
    let requestBody = "";
    const generator = createProviderRetrievalCueGenerator({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return sseResponse(
          '{"cues":["Where is the deploy runbook kept?","Which document explains deployments?"]}',
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

    const cues = await generator.generate({
      category: "project",
      content: "The infra handbook lives in the ops vault.",
      subject: "infra handbook",
    });

    expect(cues).toEqual([
      "Where is the deploy runbook kept?",
      "Which document explains deployments?",
    ]);
    expect(requestBody).toContain("test-model");
    expect(requestBody).toContain("The infra handbook lives in the ops vault.");
    expect(requestBody).toContain("infra handbook");
    // Deterministic by default.
    expect(requestBody).toContain('"temperature":0');
  });

  it("propagates provider failures so the maintenance job can skip the fact", async () => {
    const generator = createProviderRetrievalCueGenerator({
      fetch: async () => new Response("gateway error", { status: 502 }),
      model: {
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
        model: "test-model",
        provider: "openai",
      },
      retryLimit: 1,
    });

    await expect(
      generator.generate({
        category: "project",
        content: "The infra handbook lives in the ops vault.",
      }),
    ).rejects.toThrow();
  });
});
