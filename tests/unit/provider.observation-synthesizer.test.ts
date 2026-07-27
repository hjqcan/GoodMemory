import { describe, expect, it } from "bun:test";

import { createProviderObservationSynthesizer } from "../../src/provider/observationSynthesizer";

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

describe("provider observation synthesizer", () => {
  it("requests a grounded observation and returns the trimmed text", async () => {
    let requestBody = "";
    const synthesizer = createProviderObservationSynthesizer({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return sseResponse(
          '{"observation":"  Marco lives in Lisbon, teaches ceramics, and is training for a marathon.  "}',
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

    const observation = await synthesizer.synthesize({
      contents: [
        "Marco lives in Lisbon.",
        "Marco teaches ceramics on weekends.",
        "Marco is training for a marathon.",
      ],
      subject: "Marco",
    });

    expect(observation).toBe(
      "Marco lives in Lisbon, teaches ceramics, and is training for a marathon.",
    );
    expect(requestBody).toContain("Subject: Marco");
    expect(requestBody).toContain("1. Marco lives in Lisbon.");
    expect(requestBody).toContain("never");
  });

  it("returns null for an empty observation and validates configuration", async () => {
    const synthesizer = createProviderObservationSynthesizer({
      fetch: async () => sseResponse('{"observation":"   "}'),
      model: {
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
        model: "test-model",
        provider: "openai",
      },
      retryLimit: 1,
    });
    expect(
      await synthesizer.synthesize({ contents: ["fact"], subject: "Ana" }),
    ).toBeNull();

    expect(() =>
      createProviderObservationSynthesizer({
        model: {
          apiKey: "k",
          baseURL: "https://example.test/v1",
          model: "m",
          provider: "openai",
        },
        requestTimeoutMs: 0,
      }),
    ).toThrow(/requestTimeoutMs/);
  });
});
