import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS,
  C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS,
  buildC5FlatSummaryHistory,
  buildC5FlatSummaryHookConfig,
  buildC5FlatSummaryHookRunnerSource,
  buildC5FlatSummaryRequestBody,
  evaluateC5FlatSummaryHookReceipts,
  generateC5FlatSummary,
  parseC5FlatSummaryProviderResponse,
  resolveC5FlatSummaryInjection,
} from "../../scripts/codex-coding-effect/c5-flat-summary-arm";
import type {
  C5FlatSummaryTransport,
} from "../../scripts/codex-coding-effect/c5-flat-summary-arm";
import {
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
} from "../../scripts/codex-coding-effect/c6-flat-summary";
import { EMPTY_FROZEN_PREHISTORY_SHA256 } from "../../scripts/codex-coding-effect/frozen-prehistory";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("Codex coding-effect C5 flat-summary comparator arm", () => {
  it("binds the injection caps to the installed-host fresh-install defaults", () => {
    const source = readFileSync("src/install/hostInstall.ts", "utf8");
    expect(source).toContain(
      `INSTALL_DEFAULT_MAX_TOKENS = ${C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS};`,
    );
    expect(source).toContain(
      `INSTALL_DEFAULT_SESSION_START_MAX_TOKENS = ${C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS};`,
    );
  });

  it("mirrors the managed GoodMemory injection placements without Stop or PreToolUse", () => {
    const config = JSON.parse(
      buildC5FlatSummaryHookConfig({ runnerPath: "/arm/flat-summary-hook.mjs" }),
    ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string; type: string }>; matcher?: string }>> };
    expect(Object.keys(config.hooks).sort()).toEqual(["SessionStart", "UserPromptSubmit"]);
    expect(config.hooks.SessionStart![0]).toMatchObject({
      hooks: [{ command: "node /arm/flat-summary-hook.mjs SessionStart", type: "command" }],
      matcher: "startup|resume|clear|compact",
    });
    expect(config.hooks.UserPromptSubmit![0]).toMatchObject({
      hooks: [{ command: "node /arm/flat-summary-hook.mjs UserPromptSubmit", type: "command" }],
    });
    expect(config.hooks.UserPromptSubmit![0]!.matcher).toBeUndefined();
  });

  it("emits a runner that reads per-event injection files and records receipts", () => {
    const source = buildC5FlatSummaryHookRunnerSource({
      injectionRoot: "/arm/injection",
    });
    expect(source).toContain('"/arm/injection"');
    expect(source).toContain("session-start.txt");
    expect(source).toContain("user-prompt-submit.txt");
    expect(source).toContain("receipts.jsonl");
    expect(source).toContain("additionalContext");
    expect(source).toContain("hookEventName");
    expect(source).not.toContain("goodmemory");
  });

  it("builds a deterministic ordered history from the arm's own prior stages", () => {
    const empty = buildC5FlatSummaryHistory([]);
    expect(empty).toEqual({ sha256: EMPTY_FROZEN_PREHISTORY_SHA256, text: "" });

    const stages = [
      {
        finalMessage: "Implemented splitAssignment.",
        patchDiff: "diff --git a/src/tasks.ts b/src/tasks.ts\n+export function splitAssignment() {}\n",
        position: 1,
        prompt: "Establish the policy.",
        stageId: "stage-1",
      },
      {
        finalMessage: "Applied it to splitHeader.",
        patchDiff: "",
        position: 2,
        prompt: "Apply the accepted policy to splitHeader.",
        stageId: "stage-2",
      },
    ];
    const history = buildC5FlatSummaryHistory(stages);
    const reordered = buildC5FlatSummaryHistory([stages[1]!, stages[0]!]);
    expect(history.text).toBe(reordered.text);
    expect(history.sha256).toBe(sha256(history.text));
    expect(history.text.indexOf("stage-1")).toBeLessThan(history.text.indexOf("stage-2"));
    expect(history.text).toContain("Establish the policy.");
    expect(history.text).toContain("Implemented splitAssignment.");
    expect(history.text).toContain("+export function splitAssignment() {}");
    expect(() => buildC5FlatSummaryHistory([stages[0]!, { ...stages[0]! }])).toThrow(
      "C5 flat-summary history repeats stage stage-1",
    );
  });

  it("builds the same pinned chat-completion request shape as the C6 summary capture", () => {
    const body = buildC5FlatSummaryRequestBody({
      history: "H",
      maxTokens: 512,
      model: "gpt-5.6",
      prompt: "P",
    });
    expect(body).toEqual({
      max_tokens: 512,
      messages: [
        { content: "P", role: "system" },
        { content: "H", role: "user" },
      ],
      model: "gpt-5.6",
      n: 1,
      seed: 6_002,
      stream: false,
      temperature: 0,
    });
  });

  it("resolves zero injection for a no-history stage and capped content injection otherwise", () => {
    const zero = resolveC5FlatSummaryInjection({
      history: buildC5FlatSummaryHistory([]),
      summary: null,
    });
    expect(zero.mode).toBe("no-history-zero-injection");
    expect(zero.injectedText).toBe("");
    expect(zero.sessionStart.compositionSha256).toBe(
      C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
    );
    expect(zero.sessionStart.injectedTokenCount).toBe(0);
    expect(zero.userPromptSubmit.injectedTokenCount).toBe(0);
    expect(zero.sessionStart.maxInjectedTokens).toBe(
      C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS,
    );
    expect(zero.userPromptSubmit.maxInjectedTokens).toBe(
      C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS,
    );

    const history = buildC5FlatSummaryHistory([{
      finalMessage: "done",
      patchDiff: "",
      position: 1,
      prompt: "Establish the policy.",
      stageId: "stage-1",
    }]);
    const content = resolveC5FlatSummaryInjection({
      history,
      summary: "Prior stage established the delimiter policy: split at the last delimiter.",
    });
    expect(content.mode).toBe("content-injection");
    expect(content.sessionStart.compositionSha256).toBe(
      C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
    );
    expect(content.sessionStart.historySourceSha256).toBe(history.sha256);
    expect(content.userPromptSubmit.contentSha256).toBe(sha256(content.injectedText));
    expect(content.sessionStart.contentSha256).toBe(content.userPromptSubmit.contentSha256);

    expect(() => resolveC5FlatSummaryInjection({ history, summary: null })).toThrow(
      "C5 flat-summary stage with history requires a generated summary",
    );
    expect(() => resolveC5FlatSummaryInjection({
      history: buildC5FlatSummaryHistory([]),
      summary: "unexpected",
    })).toThrow("C5 no-history control forbids a flat-summary");
    expect(() => resolveC5FlatSummaryInjection({
      history,
      summary: "word ".repeat(2_000),
    })).toThrow("C6 final injected text exceeds its token budget");
  });

  it("accepts a provider response only in the pinned chat-completion shape", () => {
    const parsed = parseC5FlatSummaryProviderResponse({
      expectedModel: "gpt-5.6",
      responseBytes: JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "  summary text\n", role: "assistant" } }],
        model: "gpt-5.6",
        usage: { completion_tokens: 3, prompt_tokens: 40 },
      }),
    });
    expect(parsed).toEqual({
      finishReason: "stop",
      text: "summary text",
      usage: { cachedInputTokens: 0, inputTokens: 40, outputTokens: 3 },
    });
    for (const bytes of [
      "not json",
      JSON.stringify({ choices: [] }),
      JSON.stringify({ choices: [{ message: { content: "x" } }], model: "other" }),
      JSON.stringify({ choices: [{ message: { content: "" } }], model: "gpt-5.6", usage: { completion_tokens: 0, prompt_tokens: 1 } }),
      JSON.stringify({ choices: [{ message: { content: "x" } }, { message: { content: "y" } }], model: "gpt-5.6", usage: { completion_tokens: 1, prompt_tokens: 1 } }),
    ]) {
      expect(() => parseC5FlatSummaryProviderResponse({ expectedModel: "gpt-5.6", responseBytes: bytes }))
        .toThrow();
    }
  });

  it("retries transient provider failures with identical request bytes and fails closed otherwise", async () => {
    const okResponse = JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "summary", role: "assistant" } }],
      model: "gpt-5.6",
      usage: { completion_tokens: 1, prompt_tokens: 10 },
    });
    const respond = (status: number, body: string) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    });
    const generate = (transport: C5FlatSummaryTransport, delays: number[]) =>
      generateC5FlatSummary({
        apiToken: "sk-test-secret-0123",
        auditLeakage: () => ({ auditSha256: sha256("audit"), status: "accepted" }),
        endpoint: "https://summary.test/v1/chat/completions",
        history: "## Stage 1\nprompt\n",
        maxTokens: 512,
        model: "gpt-5.6",
        prompt: "Summarize.",
        sleep: async (ms) => {
          delays.push(ms);
        },
        transport,
      });

    const bodies: string[] = [];
    let calls = 0;
    const flaky: C5FlatSummaryTransport = async (_url, init) => {
      bodies.push(init.body);
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      if (calls === 2) return respond(503, "upstream busy");
      return respond(200, okResponse);
    };
    const delays: number[] = [];
    const generation = await generate(flaky, delays);
    expect(generation.summary).toBe("summary");
    expect(generation.requestSha256).toBe(sha256(bodies[0]!));
    expect(new Set(bodies).size).toBe(1);
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);

    let nonTransientCalls = 0;
    await expect(generate(async () => {
      nonTransientCalls += 1;
      return respond(400, "bad request");
    }, [])).rejects.toThrow("HTTP 400");
    expect(nonTransientCalls).toBe(1);

    let exhaustedCalls = 0;
    await expect(generate(async () => {
      exhaustedCalls += 1;
      return respond(502, "bad gateway");
    }, [])).rejects.toThrow("HTTP 502");
    expect(exhaustedCalls).toBe(6);
  });

  it("verifies that both injection hooks fired with the expected content", () => {
    const content = "Prior stage summary.";
    const passed = evaluateC5FlatSummaryHookReceipts({
      expectedContentSha256: sha256(content),
      receipts: [
        { contentSha256: sha256(content), event: "SessionStart", utf8Bytes: content.length },
        { contentSha256: sha256(content), event: "UserPromptSubmit", utf8Bytes: content.length },
      ],
    });
    expect(passed).toEqual({
      passed: true,
      reasons: [],
      sessionStartCount: 1,
      userPromptSubmitCount: 1,
    });

    const zero = evaluateC5FlatSummaryHookReceipts({
      expectedContentSha256: null,
      receipts: [
        { contentSha256: null, event: "SessionStart", utf8Bytes: 0 },
        { contentSha256: null, event: "UserPromptSubmit", utf8Bytes: 0 },
      ],
    });
    expect(zero.passed).toBe(true);

    const missing = evaluateC5FlatSummaryHookReceipts({
      expectedContentSha256: sha256(content),
      receipts: [
        { contentSha256: sha256(content), event: "SessionStart", utf8Bytes: content.length },
      ],
    });
    expect(missing.passed).toBe(false);
    expect(missing.reasons).toContain("UserPromptSubmit hook did not fire");

    const drifted = evaluateC5FlatSummaryHookReceipts({
      expectedContentSha256: sha256(content),
      receipts: [
        { contentSha256: sha256("other"), event: "SessionStart", utf8Bytes: 5 },
        { contentSha256: sha256(content), event: "UserPromptSubmit", utf8Bytes: content.length },
      ],
    });
    expect(drifted.passed).toBe(false);
    expect(drifted.reasons).toContain("SessionStart hook injected unexpected content");

    const leaked = evaluateC5FlatSummaryHookReceipts({
      expectedContentSha256: null,
      receipts: [
        { contentSha256: sha256(content), event: "SessionStart", utf8Bytes: content.length },
        { contentSha256: null, event: "UserPromptSubmit", utf8Bytes: 0 },
      ],
    });
    expect(leaked.passed).toBe(false);
    expect(leaked.reasons).toContain("SessionStart hook injected content on a no-history stage");
  });
});
