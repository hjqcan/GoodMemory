import { Buffer } from "node:buffer";

import { describe, expect, it } from "bun:test";

import {
  createC6FlatSummaryLiveTransport,
  C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
  C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
  parseC6FlatSummaryGenerationCliOptions,
  runC6FlatSummaryGenerationCommand,
} from "../../scripts/materialize-codex-coding-effect-c6-flat-summary-generation";
import {
  C6FlatSummaryTransportBoundaryError,
  C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
} from "../../scripts/codex-coding-effect/c6-flat-summary-generation-capture";

const SHA256 = "a".repeat(64);
const VALID_ARGS = [
  "--execute",
  "--histories-root=/inputs/histories",
  "--output-root=/output/capture",
  "--plan=/inputs/plan.json",
  `--plan-sha256=${SHA256}`,
  "--summary-prompt=/inputs/summary-prompt.md",
  "--summary-protocol=/inputs/summary-protocol.json",
] as const;

describe("Codex coding-effect C6 flat-summary generation CLI", () => {
  it("parses one exact absolute input set", () => {
    expect(parseC6FlatSummaryGenerationCliOptions(VALID_ARGS)).toEqual({
      historiesRoot: "/inputs/histories",
      mode: "execute",
      outputRoot: "/output/capture",
      planPath: "/inputs/plan.json",
      planSha256: SHA256,
      summaryPromptPath: "/inputs/summary-prompt.md",
      summaryProtocolPath: "/inputs/summary-protocol.json",
    });
  });

  it("rejects missing, duplicate, relative, padded, malformed, and unknown options", () => {
    const invalid = [
      VALID_ARGS.slice(1),
      [...VALID_ARGS, VALID_ARGS[0]],
      VALID_ARGS.map((value) =>
        value.startsWith("--histories-root=")
          ? "--histories-root=relative"
          : value
      ),
      VALID_ARGS.map((value) =>
        value.startsWith("--output-root=")
          ? "--output-root= /output/capture"
          : value
      ),
      VALID_ARGS.map((value) =>
        value.startsWith("--plan-sha256=")
          ? "--plan-sha256=not-a-sha"
          : value
      ),
      [...VALID_ARGS, "--endpoint=https://example.invalid"],
    ];

    for (const args of invalid) {
      expect(() => parseC6FlatSummaryGenerationCliOptions(args))
        .toThrow();
    }
  });

  it("requires a runtime-only token and dispatches exactly once", async () => {
    const calls: unknown[] = [];
    await expect(runC6FlatSummaryGenerationCommand(
      VALID_ARGS,
      {
        apiToken: "",
        dispatch: async (input) => {
          calls.push(input);
          return "must-not-run";
        },
      },
    )).rejects.toThrow(/API key is required/u);
    expect(calls).toEqual([]);

    const result = await runC6FlatSummaryGenerationCommand(
      VALID_ARGS,
      {
        apiToken: "runtime-only-token",
        dispatch: async (input) => {
          calls.push(input);
          return "dispatched";
        },
      },
    );
    expect(result).toBe("dispatched");
    expect(calls).toEqual([{
      apiToken: "runtime-only-token",
      options: {
        historiesRoot: "/inputs/histories",
        mode: "execute",
        outputRoot: "/output/capture",
        planPath: "/inputs/plan.json",
        planSha256: SHA256,
        summaryPromptPath: "/inputs/summary-prompt.md",
        summaryProtocolPath: "/inputs/summary-protocol.json",
      },
    }]);

    calls.length = 0;
    const finalized = await runC6FlatSummaryGenerationCommand(
      VALID_ARGS.map((argument) =>
        argument === "--execute"
          ? "--finalize-only"
          : argument
      ),
      {
        apiToken: "",
        dispatch: async (input) => {
          calls.push(input);
          return "finalized";
        },
      },
    );
    expect(finalized).toBe("finalized");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      apiToken: "",
      options: {
        mode: "finalize-only",
      },
    });
  });

  it("freezes a total deadline and rejects streamed bodies beyond the byte cap", async () => {
    expect(C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS).toBe(300_000);
    expect(C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES).toBe(
      4 * 1_024 * 1_024,
    );
    let observedSignal: AbortSignal | null = null;
    let cancelCount = 0;
    const transport = createC6FlatSummaryLiveTransport(
      async (_url, init) => {
        observedSignal = init?.signal as AbortSignal;
        return new Response(new ReadableStream<Uint8Array>({
          cancel() {
            cancelCount += 1;
          },
          start(controller) {
            controller.enqueue(
              new Uint8Array(
                C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
              ),
            );
            controller.enqueue(Uint8Array.of(1));
          },
        }), {
          status: 200,
        });
      },
    );

    let thrown: unknown;
    try {
      await transport({
        body: Buffer.from("{}"),
        headers: {
          accept: "application/json",
          authorization: "Bearer runtime-only-token",
          "content-type": "application/json",
        },
        method: "POST",
        url: C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(
      C6FlatSummaryTransportBoundaryError,
    );
    expect(thrown).toMatchObject({
      type: "response-byte-limit-exceeded",
    });
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(cancelCount).toBe(1);
  });
});
