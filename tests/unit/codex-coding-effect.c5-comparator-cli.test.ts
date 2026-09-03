import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseC5LivePilotOptions } from "../../scripts/run-codex-coding-effect-c5-pilot";
import { parseC5ReadinessOptions } from "../../scripts/prepare-codex-coding-effect-c5-pilot";
import {
  C5_SUMMARY_API_KEY_ENVIRONMENT_NAME,
  generateC5FlatSummary,
} from "../../scripts/codex-coding-effect/c5-flat-summary-arm";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("Codex coding-effect C5 comparator CLI", () => {
  it("freezes the flat-summary comparator protocol from explicit flags and a credential env", async () => {
    const root = await mkdtemp(join(tmpdir(), "c5-comparator-cli-"));
    try {
      const promptPath = join(root, "summary-prompt.md");
      await writeFile(promptPath, "Summarize the prior stages.\n", "utf8");
      const options = parseC5LivePilotOptions([
        ...requiredArgs(),
        "--baseline-arm",
        "flat-summary",
        "--summary-model",
        "gpt-5.6",
        "--summary-prompt",
        promptPath,
        "--summary-endpoint",
        "https://example.invalid/v1/chat/completions",
      ], {
        bunExecutable: "/tooling/bun",
        cwd: "/repo/goodmemory",
        env: { [C5_SUMMARY_API_KEY_ENVIRONMENT_NAME]: "sk-test-1234567890" },
        homeDir: "/users/eval",
        now: () => "2026-09-02T00:00:00.000Z",
      });
      expect(options.baselineArm).toBe("flat-summary");
      expect(options.comparator).toEqual({
        summaryEndpointSha256: sha256("https://example.invalid/v1/chat/completions"),
        summaryModel: "gpt-5.6",
        summaryPromptSha256: sha256("Summarize the prior stages.\n"),
      });
      expect(options.comparatorRuntime).toEqual({
        apiToken: "sk-test-1234567890",
        summaryEndpoint: "https://example.invalid/v1/chat/completions",
        summaryModel: "gpt-5.6",
        summaryPrompt: "Summarize the prior stages.\n",
        summaryPromptSha256: sha256("Summarize the prior stages.\n"),
      });

      const legacy = parseC5LivePilotOptions(requiredArgs(), {
        bunExecutable: "/tooling/bun",
        cwd: "/repo/goodmemory",
        homeDir: "/users/eval",
      });
      expect(legacy.baselineArm).toBeUndefined();
      expect(legacy.comparator).toBeUndefined();
      expect(legacy.comparatorRuntime).toBeUndefined();

      expect(() => parseC5LivePilotOptions([
        ...requiredArgs(),
        "--baseline-arm",
        "flat-summary",
        "--summary-model",
        "gpt-5.6",
        "--summary-prompt",
        promptPath,
      ], {
        bunExecutable: "/tooling/bun",
        cwd: "/repo/goodmemory",
        env: {},
        homeDir: "/users/eval",
      })).toThrow(`${C5_SUMMARY_API_KEY_ENVIRONMENT_NAME} is required`);
      expect(() => parseC5LivePilotOptions([
        ...requiredArgs(),
        "--baseline-arm",
        "flat-summary",
      ], {
        bunExecutable: "/tooling/bun",
        cwd: "/repo/goodmemory",
        env: { [C5_SUMMARY_API_KEY_ENVIRONMENT_NAME]: "sk-test-1234567890" },
        homeDir: "/users/eval",
      })).toThrow("--summary-model is required");
      expect(() => parseC5LivePilotOptions([
        ...requiredArgs(),
        "--summary-model",
        "gpt-5.6",
      ], {
        bunExecutable: "/tooling/bun",
        cwd: "/repo/goodmemory",
        homeDir: "/users/eval",
      })).toThrow("summary flags require --baseline-arm flat-summary");
      expect(() => parseC5LivePilotOptions([
        ...requiredArgs(),
        "--baseline-arm",
        "oracle-memory",
      ], {
        bunExecutable: "/tooling/bun",
        cwd: "/repo/goodmemory",
        homeDir: "/users/eval",
      })).toThrow("--baseline-arm must be no-memory or flat-summary");

      const readiness = parseC5ReadinessOptions([
        "--order-seed=73",
        "--material-effect-pp=10",
        "--baseline-arm=flat-summary",
        "--summary-model=gpt-5.6",
        `--summary-prompt=${promptPath}`,
        "--summary-endpoint=https://example.invalid/v1/chat/completions",
      ]);
      expect(readiness.baselineArm).toBe("flat-summary");
      expect(readiness.comparator).toEqual({
        summaryEndpointSha256: sha256("https://example.invalid/v1/chat/completions"),
        summaryModel: "gpt-5.6",
        summaryPromptSha256: sha256("Summarize the prior stages.\n"),
      });
      expect(parseC5ReadinessOptions([
        "--order-seed=73",
        "--material-effect-pp=10",
      ]).comparator).toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("generates a summary through an injected transport and rejects leaked output", async () => {
    const requests: Array<{ body: string; headers: Record<string, string>; url: string }> = [];
    const transport = async (url: string, init: { body: string; headers: Record<string, string> }) => {
      requests.push({ body: init.body, headers: init.headers, url });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "Prior stage: policy established." } }],
          model: "gpt-5.6",
          usage: { completion_tokens: 6, prompt_tokens: 50 },
        }),
      };
    };
    const generated = await generateC5FlatSummary({
      apiToken: "sk-test-1234567890",
      auditLeakage: () => ({ auditSha256: "b".repeat(64), status: "accepted" }),
      endpoint: "https://example.invalid/v1/chat/completions",
      history: "## Stage 1\nEstablish the policy.\n",
      maxTokens: 512,
      model: "gpt-5.6",
      prompt: "Summarize.",
      transport,
    });
    expect(generated.summary).toBe("Prior stage: policy established.");
    expect(generated.usage).toEqual({ cachedInputTokens: 0, inputTokens: 50, outputTokens: 6 });
    expect(generated.leakageAuditSha256).toBe("b".repeat(64));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://example.invalid/v1/chat/completions");
    expect(requests[0]!.headers.authorization).toBe("Bearer sk-test-1234567890");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ max_tokens: 512, model: "gpt-5.6", temperature: 0 });
    expect(generated.requestSha256).toBe(sha256(requests[0]!.body));
    expect(generated.redactedRequest).not.toContain("sk-test-1234567890");

    await expect(generateC5FlatSummary({
      apiToken: "sk-test-1234567890",
      auditLeakage: () => ({ auditSha256: "c".repeat(64), status: "rejected" }),
      endpoint: "https://example.invalid/v1/chat/completions",
      history: "H",
      maxTokens: 512,
      model: "gpt-5.6",
      prompt: "Summarize.",
      transport,
    })).rejects.toThrow("C5 flat-summary output leaked hidden or gold content");

    let busyCalls = 0;
    await expect(generateC5FlatSummary({
      apiToken: "sk-test-1234567890",
      auditLeakage: () => ({ auditSha256: "b".repeat(64), status: "accepted" }),
      endpoint: "https://example.invalid/v1/chat/completions",
      history: "H",
      maxTokens: 512,
      model: "gpt-5.6",
      prompt: "Summarize.",
      sleep: async () => {},
      transport: async () => {
        busyCalls += 1;
        return { ok: false, status: 503, text: async () => "busy" };
      },
    })).rejects.toThrow("C5 flat-summary provider returned HTTP 503");
    expect(busyCalls).toBe(3);
  });
});

function requiredArgs(): string[] {
  return [
    "--run-id",
    "c5-run-001",
    "--package-tarball",
    "dist/goodmemory.tgz",
    "--codex-model",
    "gpt-test",
    "--reasoning-effort",
    "xhigh",
    "--material-effect-pp",
    "10",
    "--order-seed",
    "73",
  ];
}
