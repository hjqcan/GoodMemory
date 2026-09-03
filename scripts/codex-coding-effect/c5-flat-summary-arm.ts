import { createHash } from "node:crypto";

import {
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
  buildC6InjectionBudgetReceipt,
} from "./c6-flat-summary";
import type {
  C6InjectionBudgetReceipt,
  C6InjectionMode,
} from "./c6-flat-summary";
import {
  C6_FLAT_SUMMARY_REQUEST_SEED,
  C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES,
} from "./c6-flat-summary-generation-capture";
import type { NormalizedCodexUsage } from "./codex-events";
import { EMPTY_FROZEN_PREHISTORY_SHA256 } from "./frozen-prehistory";

// The flat-summary comparator arm answers the plan's 6.2 question: is
// GoodMemory's selective memory better than putting a compact history into the
// prompt? It receives, at the same SessionStart and UserPromptSubmit
// placements the installed GoodMemory profile uses, one pinned-model summary of
// its own prior stages, capped at the installed profile's fresh-install
// budgets. Position-1 stages (no history) inject nothing and make no provider
// call, mirroring the C6 no-history control.
export const C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS = 1024;
export const C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS = 512;
export const C5_FLAT_SUMMARY_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
] as const;
export const C5_FLAT_SUMMARY_SESSION_START_MATCHER =
  "startup|resume|clear|compact";
export const C5_FLAT_SUMMARY_INJECTION_FILES = {
  SessionStart: "session-start.txt",
  UserPromptSubmit: "user-prompt-submit.txt",
} as const;
export const C5_FLAT_SUMMARY_RECEIPTS_FILE = "receipts.jsonl";
export const C5_SUMMARY_API_KEY_ENVIRONMENT_NAME =
  "GOODMEMORY_C5_SUMMARY_API_KEY";
export const C5_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS = 300_000;
// A relay outage must not silently turn a Codex stage pair incomparable: the
// same request bytes are retried a bounded number of times on transport
// errors and transient HTTP statuses, then the stage fails closed.
export const C5_FLAT_SUMMARY_MAX_ATTEMPTS = 3;
export const C5_FLAT_SUMMARY_RETRY_DELAYS_MS = [2_000, 8_000] as const;

export type C5FlatSummaryHookEvent = typeof C5_FLAT_SUMMARY_HOOK_EVENTS[number];

export interface C5FlatSummaryPriorStage {
  finalMessage: string | null;
  patchDiff: string;
  position: number;
  prompt: string;
  stageId: string;
}

export interface C5FlatSummaryHistory {
  sha256: string;
  text: string;
}

export interface C5FlatSummaryInjection {
  historySourceSha256: string;
  injectedText: string;
  mode: C6InjectionMode;
  sessionStart: C6InjectionBudgetReceipt;
  userPromptSubmit: C6InjectionBudgetReceipt;
}

export interface C5FlatSummaryHookReceipt {
  contentSha256: string | null;
  event: string;
  utf8Bytes: number;
}

export interface C5FlatSummaryHookEvaluation {
  passed: boolean;
  reasons: string[];
  sessionStartCount: number;
  userPromptSubmitCount: number;
}

export interface C5FlatSummaryProviderResult {
  finishReason: string | null;
  text: string;
  usage: NormalizedCodexUsage;
}

export function buildC5FlatSummaryHookConfig(input: {
  runnerPath: string;
}): string {
  assertAbsoluteRunnerPath(input.runnerPath);
  return `${JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{
          command: `node ${input.runnerPath} SessionStart`,
          type: "command",
        }],
        matcher: C5_FLAT_SUMMARY_SESSION_START_MATCHER,
      }],
      UserPromptSubmit: [{
        hooks: [{
          command: `node ${input.runnerPath} UserPromptSubmit`,
          type: "command",
        }],
      }],
    },
  }, null, 2)}\n`;
}

export function buildC5FlatSummaryHookRunnerSource(input: {
  injectionRoot: string;
}): string {
  assertAbsoluteRunnerPath(input.injectionRoot);
  return `import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const eventName = process.argv[2];
if (eventName !== "SessionStart" && eventName !== "UserPromptSubmit") {
  throw new Error("unsupported flat-summary hook event");
}
const root = ${JSON.stringify(input.injectionRoot)};
const fileName = eventName === "SessionStart"
  ? ${JSON.stringify(C5_FLAT_SUMMARY_INJECTION_FILES.SessionStart)}
  : ${JSON.stringify(C5_FLAT_SUMMARY_INJECTION_FILES.UserPromptSubmit)};
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
let context = "";
try {
  context = await readFile(\`\${root}/\${fileName}\`, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}
const output = context.length === 0
  ? {}
  : {
      hookSpecificOutput: {
        additionalContext: context,
        hookEventName: eventName,
      },
    };
const contentSha256 = context.length === 0
  ? null
  : createHash("sha256").update(context).digest("hex");
await mkdir(root, { recursive: true });
await appendFile(
  \`\${root}/${C5_FLAT_SUMMARY_RECEIPTS_FILE}\`,
  JSON.stringify({
    at: new Date().toISOString(),
    contentSha256,
    event: eventName,
    utf8Bytes: Buffer.byteLength(context, "utf8"),
  }) + "\\n",
);
process.stdout.write(JSON.stringify(output) + "\\n");
`;
}

export function buildC5FlatSummaryHistory(
  stages: readonly C5FlatSummaryPriorStage[],
): C5FlatSummaryHistory {
  if (stages.length === 0) {
    return { sha256: EMPTY_FROZEN_PREHISTORY_SHA256, text: "" };
  }
  const ordered = [...stages].sort((left, right) =>
    left.position - right.position || left.stageId.localeCompare(right.stageId)
  );
  const seen = new Set<string>();
  const sections = ordered.map((stage) => {
    if (seen.has(stage.stageId)) {
      throw new Error(`C5 flat-summary history repeats stage ${stage.stageId}`);
    }
    seen.add(stage.stageId);
    return [
      `## Stage ${stage.position} (${stage.stageId})`,
      "### Prompt",
      stage.prompt.trim(),
      "### Codex final message",
      stage.finalMessage?.trim() || "(none)",
      "### Patch",
      stage.patchDiff.trim() || "(no patch)",
    ].join("\n");
  });
  const text = `${sections.join("\n\n")}\n`;
  return { sha256: sha256(text), text };
}

export function buildC5FlatSummaryRequestBody(input: {
  history: string;
  maxTokens: number;
  model: string;
  prompt: string;
}): {
  max_tokens: number;
  messages: Array<{ content: string; role: "system" | "user" }>;
  model: string;
  n: 1;
  seed: number;
  stream: false;
  temperature: 0;
} {
  return {
    max_tokens: input.maxTokens,
    messages: [
      { content: input.prompt, role: "system" },
      { content: input.history, role: "user" },
    ],
    model: input.model,
    n: 1,
    seed: C6_FLAT_SUMMARY_REQUEST_SEED,
    stream: false,
    temperature: 0,
  };
}

export function resolveC5FlatSummaryInjection(input: {
  history: C5FlatSummaryHistory;
  summary: string | null;
}): C5FlatSummaryInjection {
  const noHistory = input.history.sha256 === EMPTY_FROZEN_PREHISTORY_SHA256;
  if (noHistory) {
    if (input.summary !== null) {
      throw new Error(
        "C5 no-history control forbids a flat-summary provider artifact",
      );
    }
    return {
      historySourceSha256: EMPTY_FROZEN_PREHISTORY_SHA256,
      injectedText: "",
      mode: "no-history-zero-injection",
      sessionStart: receipt({
        compositionSha256: C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
        historySourceSha256: EMPTY_FROZEN_PREHISTORY_SHA256,
        injectedText: "",
        injectionMode: "no-history-zero-injection",
        maxInjectedTokens: C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS,
      }),
      userPromptSubmit: receipt({
        compositionSha256: C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
        historySourceSha256: EMPTY_FROZEN_PREHISTORY_SHA256,
        injectedText: "",
        injectionMode: "no-history-zero-injection",
        maxInjectedTokens: C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS,
      }),
    };
  }
  const injectedText = input.summary?.trim() ?? "";
  if (injectedText.length === 0) {
    throw new Error(
      "C5 flat-summary stage with history requires a generated summary",
    );
  }
  return {
    historySourceSha256: input.history.sha256,
    injectedText,
    mode: "content-injection",
    sessionStart: receipt({
      compositionSha256: C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256: input.history.sha256,
      injectedText,
      injectionMode: "content-injection",
      maxInjectedTokens: C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS,
    }),
    userPromptSubmit: receipt({
      compositionSha256: C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256: input.history.sha256,
      injectedText,
      injectionMode: "content-injection",
      maxInjectedTokens: C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS,
    }),
  };
}

export function parseC5FlatSummaryProviderResponse(input: {
  expectedModel: string;
  responseBytes: string;
}): C5FlatSummaryProviderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.responseBytes);
  } catch {
    throw new Error("C5 flat-summary provider response is not JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("C5 flat-summary provider response is not an object");
  }
  if (parsed.model !== input.expectedModel) {
    throw new Error("C5 flat-summary provider response model does not match");
  }
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw new Error("C5 flat-summary provider response must carry one choice");
  }
  const choice = choices[0];
  const message = isRecord(choice) ? choice.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("C5 flat-summary provider response has no text content");
  }
  const usage = parsed.usage;
  if (
    !isRecord(usage) ||
    !isCount(usage.prompt_tokens) ||
    !isCount(usage.completion_tokens)
  ) {
    throw new Error("C5 flat-summary provider response has no usage");
  }
  const details = usage.prompt_tokens_details;
  const cached = isRecord(details) && isCount(details.cached_tokens)
    ? details.cached_tokens
    : 0;
  return {
    finishReason: isRecord(choice) && typeof choice.finish_reason === "string"
      ? choice.finish_reason
      : null,
    text: content.trim(),
    usage: {
      cachedInputTokens: cached,
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
    },
  };
}

export type C5FlatSummaryTransport = (
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface C5FlatSummaryGeneration {
  leakageAuditSha256: string;
  redactedRequest: string;
  requestSha256: string;
  responseSha256: string;
  summary: string;
  usage: NormalizedCodexUsage;
}

// One provider call per non-empty history prefix. The token never enters any
// arm; the runner holds it, calls the provider, audits the output against the
// stage's hidden/gold closure, and only then writes the summary into the arm.
export async function generateC5FlatSummary(input: {
  apiToken: string;
  auditLeakage: (summary: string) => {
    auditSha256: string;
    status: "accepted" | "rejected";
  };
  endpoint: string;
  history: string;
  maxTokens: number;
  model: string;
  prompt: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  transport?: C5FlatSummaryTransport;
}): Promise<C5FlatSummaryGeneration> {
  if (input.apiToken.trim().length === 0) {
    throw new Error("C5 flat-summary provider token must be non-empty");
  }
  const body = JSON.stringify(buildC5FlatSummaryRequestBody({
    history: input.history,
    maxTokens: input.maxTokens,
    model: input.model,
    prompt: input.prompt,
  }));
  if (body.includes(input.apiToken)) {
    throw new Error("C5 flat-summary request contains authorization material");
  }
  const redactedRequest = JSON.stringify({
    body: JSON.parse(body),
    headers: {
      accept: "application/json",
      authorization: "Bearer [REDACTED]",
      "content-type": "application/json",
    },
    method: "POST",
    url: input.endpoint,
  });
  const transport = input.transport ?? defaultTransport;
  const sleep = input.sleep ?? defaultSleep;
  const attempt = async (): Promise<
    { ok: true; responseBytes: string } | { ok: false; status: number }
  > => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? C5_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
    );
    try {
      const response = await transport(input.endpoint, {
        body,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.apiToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });
      const responseBytes = await response.text();
      return response.ok
        ? { ok: true, responseBytes }
        : { ok: false, status: response.status };
    } finally {
      clearTimeout(timer);
    }
  };
  let responseBytes: string | null = null;
  for (let index = 0; index < C5_FLAT_SUMMARY_MAX_ATTEMPTS; index += 1) {
    const last = index === C5_FLAT_SUMMARY_MAX_ATTEMPTS - 1;
    let outcome: Awaited<ReturnType<typeof attempt>>;
    try {
      outcome = await attempt();
    } catch (error) {
      if (last) throw error;
      await sleep(C5_FLAT_SUMMARY_RETRY_DELAYS_MS[index] ?? 0);
      continue;
    }
    if (outcome.ok) {
      responseBytes = outcome.responseBytes;
      break;
    }
    const transient = (C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES as readonly number[])
      .includes(outcome.status);
    if (!transient || last) {
      throw new Error(`C5 flat-summary provider returned HTTP ${outcome.status}`);
    }
    await sleep(C5_FLAT_SUMMARY_RETRY_DELAYS_MS[index] ?? 0);
  }
  if (responseBytes === null) {
    throw new Error("C5 flat-summary provider produced no response");
  }
  const parsed = parseC5FlatSummaryProviderResponse({
    expectedModel: input.model,
    responseBytes,
  });
  const audit = input.auditLeakage(parsed.text);
  if (audit.status !== "accepted") {
    throw new Error("C5 flat-summary output leaked hidden or gold content");
  }
  return {
    leakageAuditSha256: audit.auditSha256,
    redactedRequest,
    requestSha256: sha256(body),
    responseSha256: sha256(responseBytes),
    summary: parsed.text,
    usage: parsed.usage,
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultTransport: C5FlatSummaryTransport = async (url, init) => {
  const response = await fetch(url, {
    body: init.body,
    headers: init.headers,
    method: init.method,
    signal: init.signal,
  });
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

export function parseC5FlatSummaryHookReceipts(
  jsonl: string,
): C5FlatSummaryHookReceipt[] {
  const receipts: C5FlatSummaryHookReceipt[] = [];
  for (const line of jsonl.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("C5 flat-summary hook receipt line is not JSON");
    }
    if (
      !isRecord(parsed) ||
      typeof parsed.event !== "string" ||
      !(parsed.contentSha256 === null || typeof parsed.contentSha256 === "string") ||
      !isCount(parsed.utf8Bytes)
    ) {
      throw new Error("C5 flat-summary hook receipt line is malformed");
    }
    receipts.push({
      contentSha256: parsed.contentSha256,
      event: parsed.event,
      utf8Bytes: parsed.utf8Bytes,
    });
  }
  return receipts;
}

export function evaluateC5FlatSummaryHookReceipts(input: {
  expectedContentSha256: string | null;
  receipts: readonly C5FlatSummaryHookReceipt[];
}): C5FlatSummaryHookEvaluation {
  const reasons: string[] = [];
  let sessionStartCount = 0;
  let userPromptSubmitCount = 0;
  for (const receipt of input.receipts) {
    if (receipt.event === "SessionStart") {
      sessionStartCount += 1;
    } else if (receipt.event === "UserPromptSubmit") {
      userPromptSubmitCount += 1;
    } else {
      reasons.push(`unexpected flat-summary hook event ${receipt.event}`);
      continue;
    }
    if (input.expectedContentSha256 === null) {
      if (receipt.contentSha256 !== null || receipt.utf8Bytes !== 0) {
        reasons.push(
          `${receipt.event} hook injected content on a no-history stage`,
        );
      }
    } else if (receipt.contentSha256 === null) {
      reasons.push(`${receipt.event} hook injected no content`);
    } else if (receipt.contentSha256 !== input.expectedContentSha256) {
      reasons.push(`${receipt.event} hook injected unexpected content`);
    }
  }
  if (sessionStartCount === 0) {
    reasons.push("SessionStart hook did not fire");
  }
  if (userPromptSubmitCount === 0) {
    reasons.push("UserPromptSubmit hook did not fire");
  }
  const unique = [...new Set(reasons)];
  return {
    passed: unique.length === 0,
    reasons: unique,
    sessionStartCount,
    userPromptSubmitCount,
  };
}

function receipt(input: {
  compositionSha256: string;
  historySourceSha256: string;
  injectedText: string;
  injectionMode: C6InjectionMode;
  maxInjectedTokens: number;
}): C6InjectionBudgetReceipt {
  return buildC6InjectionBudgetReceipt({ arm: "flat-summary", ...input });
}

function assertAbsoluteRunnerPath(path: string): void {
  if (!path.startsWith("/") || path.includes("\n") || path.includes("\"")) {
    throw new Error("C5 flat-summary runner paths must be absolute and quotable");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
