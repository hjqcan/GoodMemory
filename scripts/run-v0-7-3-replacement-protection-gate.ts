import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { DEFAULT_AISDK_RETRY_LIMIT } from "../src/provider/ai-sdk-runtime";
import type { FetchLike } from "../src/provider/ai-sdk-runtime";
import { createProviderListwiseReranker } from "../src/provider/layer";
import { resolveCliFlagValueStrict } from "./cli-options";
import {
  assertProviderResponseFailuresRecovered,
  createProviderResponseTapeProxy,
  parseProviderResponseTape,
  PROVIDER_TAPE_TRANSPORT_ERROR_STATUS,
  serializeProviderResponseTape,
} from "./provider-response-tape";
import type {
  ProviderResponseTape,
  ProviderResponseTapeProxy,
  ProviderTapeRequestIdentity,
  ProviderTapeSessionStats,
} from "./provider-response-tape";
import {
  buildV073PairedCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
} from "./run-v0-7-3-lifecycle-protection-gate";
import type {
  V073PairedCommandChain,
  V073ProtectionArmManifest,
} from "./run-v0-7-3-lifecycle-protection-gate";
import {
  assertV073ProviderPreflightReceipt,
  evaluateV073ReplacementProtection,
  V073_PROVIDER_PREFLIGHT_POLICY,
} from "./v0-7-3-replacement-protection";
import type {
  V073ProtectionSmokeReport,
  V073ProviderPreflightReceipt,
  V073ProviderPreflightTarget,
  V073ProviderReplaySession,
  V073ReplacementProtectionInput,
  V073ReplacementProtectionReport,
} from "./v0-7-3-replacement-protection";
import { LOCOMO_LIVE_REQUEST_TIMEOUT_MS } from "./run-phase-65-locomo-smoke";

const BASELINE_COMMIT = "456edd106f29118b3455bf21c43d7b3107b48213";
const REQUIRED_BUN_VERSION = "1.3.14";
const BENCHMARK_FINGERPRINT =
  "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd";
const BENCHMARK_ROOT_SHA256 =
  "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28";
const BENCHMARK_ROOT_BYTES = 2_490_457;
const QUESTION_SELECTION_SHA256 =
  "43ed915ce851ba4f1501ed0fd995c29611195f8ff71d2c6af57ae9dc118a5c6c";
const CASE_IDS = ["locomo-conv-26", "locomo-conv-30"] as const;
const QUESTION_CATEGORIES = [
  "single_hop",
  "multi_hop",
  "temporal",
  "open_domain",
] as const;
const PROVIDER_CREDENTIAL_ENV_BY_ROLE = {
  assisted: "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
  embedding: "GOODMEMORY_EMBEDDING_API_KEY",
  eval: "GOODMEMORY_EVAL_API_KEY",
  judge: "GOODMEMORY_JUDGE_API_KEY",
  reranking: "GOODMEMORY_RERANKING_API_KEY",
} as const;
const EXPECTED_QUESTION_COUNT = 233;
const EXPECTED_CASE_COUNTS = {
  "locomo-conv-26": 152,
  "locomo-conv-30": 81,
} as const;
const EXPECTED_CATEGORY_COUNTS = {
  multi_hop: 43,
  open_domain: 13,
  single_hop: 114,
  temporal: 63,
} as const;
const CLAIM_RECIPE_PATH = "benchmark-claims/locomo.json";
const SEED_RUNNER_PATH = "scripts/run-phase-65-locomo-smoke.ts";
const REANSWER_RUNNER_PATH = "scripts/reanswer-phase-65-locomo-report.ts";
const OFFICIAL_RUNNER_PATH = "scripts/rescore-official-protocols.ts";
const EVIDENCE_ROOT = "reports/release/v0.7/v0.7.3-lifecycle-evidence";
const FORMAL_ATTEMPT_SENTINEL =
  "reports/release/v0.7/v0.7.3-lifecycle-schema7-attempt-consumed.json";
const PROTECTION_ARTIFACT =
  "reports/release/v0.7/v0.7.3-lifecycle-protection.json";

export const V073_PROVIDER_STAGE_ORDER = [
  "seedSmoke",
  "reanswer",
  "officialRescore",
] as const;

export const V073_ASSISTED_EXTRACTION_POLICY = {
  maxAttempts: DEFAULT_AISDK_RETRY_LIMIT,
  requestTimeoutMs: LOCOMO_LIVE_REQUEST_TIMEOUT_MS,
} as const;

export const V073_PROVIDER_TRANSPORT_POLICY = {
  errorResponseStatus: PROVIDER_TAPE_TRANSPORT_ERROR_STATUS,
  proxyRetries: 0,
  transportErrors: "record-and-replay",
} as const;

interface V073ReplacementGateCliOptions {
  baselineWorktree: string;
  benchmarkRoot: string;
  candidateWorktree: string;
  outputDir: string;
}

export interface ProviderIdentity {
  gateway: string;
  model: string;
  provider: string;
}

type ProviderRole = keyof typeof PROVIDER_CREDENTIAL_ENV_BY_ROLE;
type ProviderCredentials = Record<ProviderRole, string>;
type ProviderIdentities = Record<ProviderRole, ProviderIdentity>;

export interface V073StageSourceIdentity {
  claimRecipeRaw: string;
  officialSourceSha256: string;
  reanswerSourceSha256: string;
  seedSourceSha256: string;
}

export interface WorktreeProvenance {
  branch: string | null;
  commit: string;
  statusPorcelain: string;
}

interface CapturedProcess {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

interface CapturedProcessInput {
  args: readonly string[];
  command: string;
  cwd: string;
  environment?: Record<string, string>;
  sensitiveValues?: readonly string[];
}

interface ArtifactIdentity {
  bytes: number;
  path: string;
  sha256: string;
}

interface HarnessIdentity {
  bytes: number;
  path: string;
  sha256: string;
}

interface FormalSmokeCase {
  answerCorrect: boolean;
  answerTokenF1: number;
  caseId: string;
  category: string;
  evidenceRecall: number;
  questionId: string;
}

interface ProviderFreeRetrievalCase {
  caseId: string;
  category: string;
  evidenceRecall: number;
  evidenceTurnIds: string[];
  goldEvidenceFullyRetrieved: boolean;
  missingEvidenceTurnIds: string[];
  noiseTurnCount: number;
  noiseTurnIds: string[];
  questionId: string;
  retrievedTurnIds: string[];
}

interface ProviderFreeSmokeReport extends Omit<
  V073ProtectionSmokeReport,
  "cases"
> {
  cases: ProviderFreeRetrievalCase[];
}

interface FormalSmokeReport extends V073ProtectionSmokeReport {
  cases: FormalSmokeCase[];
}

interface OfficialSummary {
  judgeFailures: number;
  overallAccuracy: number;
}

interface OfficialProgressRow {
  correct: boolean;
  questionId: string;
}

interface ProviderStageResult {
  finalReport: FormalSmokeReport;
  finalReportPath: string;
  officialSummary: OfficialSummary;
  officialSummaryPath: string;
  officialProgress: OfficialProgressRow[];
  officialProgressPath: string;
  receiptPath: string;
  seedReportPath: string;
  session: ProviderTapeSessionStats;
}

export interface V073TapeBaseUrls {
  assisted: string;
  embedding: string;
  eval: string;
  judge: string;
  reranking: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifactIdentity(path: string, raw: string): ArtifactIdentity {
  const trackedPath = relative(process.cwd(), resolve(path));
  if (trackedPath.startsWith("..")) {
    throw new Error("replacement protection artifacts must stay inside the repository");
  }
  return {
    bytes: Buffer.byteLength(raw, "utf8"),
    path: trackedPath,
    sha256: sha256(raw),
  };
}

export function parseV073ReplacementGateCliOptions(
  argv: readonly string[],
): V073ReplacementGateCliOptions {
  const baselineWorktree = resolveCliFlagValueStrict(argv, "--baseline-worktree");
  const candidateWorktree = resolveCliFlagValueStrict(argv, "--candidate-worktree");
  const benchmarkRoot = resolveCliFlagValueStrict(argv, "--benchmark-root");
  const outputDir = resolveCliFlagValueStrict(argv, "--output-dir");
  if (!baselineWorktree || !candidateWorktree || !benchmarkRoot || !outputDir) {
    throw new Error(
      "usage: --baseline-worktree <detached-path> --candidate-worktree <detached-path> --benchmark-root <path> --output-dir <fresh-path>",
    );
  }
  return { baselineWorktree, benchmarkRoot, candidateWorktree, outputDir };
}

export function routeV073CommandChainThroughTape(
  chain: V073PairedCommandChain,
  baseUrls: V073TapeBaseUrls,
  options: { replayCredentials: boolean } = { replayCredentials: false },
): V073PairedCommandChain {
  const route = (environment: Record<string, string>): Record<string, string> => ({
    ...environment,
    GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL: baseUrls.assisted,
    GOODMEMORY_EMBEDDING_BASE_URL: baseUrls.embedding,
    GOODMEMORY_EVAL_BASE_URL: baseUrls.eval,
    GOODMEMORY_JUDGE_BASE_URL: baseUrls.judge,
    GOODMEMORY_RERANKING_BASE_URL: baseUrls.reranking,
    ...(options.replayCredentials
      ? {
          GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY:
            "provider-response-tape-replay",
          GOODMEMORY_EMBEDDING_API_KEY: "provider-response-tape-replay",
          GOODMEMORY_EVAL_API_KEY: "provider-response-tape-replay",
          GOODMEMORY_JUDGE_API_KEY: "provider-response-tape-replay",
          GOODMEMORY_RERANKING_API_KEY: "provider-response-tape-replay",
        }
      : {}),
  });
  return {
    officialRescore: {
      ...chain.officialRescore,
      environment: route(chain.officialRescore.environment),
    },
    reanswer: {
      ...chain.reanswer,
      environment: route(chain.reanswer.environment),
    },
    seedSmoke: {
      ...chain.seedSmoke,
      environment: route(chain.seedSmoke.environment),
    },
  };
}

function runCapturedProcess(input: CapturedProcessInput): Promise<CapturedProcess> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (input.sensitiveValues === undefined) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (input.sensitiveValues === undefined) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const captured = {
        stderr: redactSensitiveText(
          Buffer.concat(stderr).toString("utf8"),
          input.sensitiveValues ?? [],
        ),
        stdout: redactSensitiveText(
          Buffer.concat(stdout).toString("utf8"),
          input.sensitiveValues ?? [],
        ),
      };
      if (input.sensitiveValues !== undefined) {
        process.stdout.write(captured.stdout);
        process.stderr.write(captured.stderr);
      }
      resolveProcess({
        exitCode,
        ...captured,
      });
    });
  });
}

async function worktreeProvenance(path: string): Promise<WorktreeProvenance> {
  const [head, status, branch] = await Promise.all([
    runCapturedProcess({ args: ["rev-parse", "HEAD"], command: "git", cwd: path }),
    runCapturedProcess({
      args: ["status", "--porcelain", "--untracked-files=all"],
      command: "git",
      cwd: path,
    }),
    runCapturedProcess({
      args: ["symbolic-ref", "-q", "--short", "HEAD"],
      command: "git",
      cwd: path,
    }),
  ]);
  if (head.exitCode !== 0 || status.exitCode !== 0) {
    throw new Error(`cannot inspect detached checkout ${path}`);
  }
  return {
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    commit: head.stdout.trim(),
    statusPorcelain: status.stdout,
  };
}

function assertCleanDetached(
  provenance: WorktreeProvenance,
  expectedCommit: string | null,
  label: string,
): void {
  if (provenance.branch !== null) {
    throw new Error(`${label} protection checkout must be detached`);
  }
  if (provenance.statusPorcelain !== "") {
    throw new Error(`${label} protection checkout must be clean`);
  }
  if (expectedCommit !== null && provenance.commit !== expectedCommit) {
    throw new Error(`${label} protection checkout must be at ${expectedCommit}`);
  }
}

export function assertV073DriverMatchesCandidate(
  driver: WorktreeProvenance,
  candidate: WorktreeProvenance,
): void {
  if (driver.statusPorcelain !== "") {
    throw new Error("replacement protection driver repository must be clean");
  }
  if (driver.commit !== candidate.commit) {
    throw new Error(
      "replacement protection driver repository must match the candidate commit",
    );
  }
}

function requiredProvider(prefix: string): ProviderIdentity {
  const gateway = process.env[`${prefix}_BASE_URL`]?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim();
  const provider = process.env[`${prefix}_PROVIDER`]?.trim();
  if (!gateway || !model || !provider) {
    throw new Error(`${prefix} provider identity is required`);
  }
  return { gateway, model, provider };
}

function requiredProviderCredentials(): {
  credentials: ProviderCredentials;
  sensitiveValues: string[];
} {
  const credentials = Object.fromEntries(
    Object.entries(PROVIDER_CREDENTIAL_ENV_BY_ROLE).map(([role, name]) => {
      const value = process.env[name]?.trim();
      if (!value) {
        throw new Error(`${name} is required`);
      }
      return [role, value];
    }),
  ) as ProviderCredentials;
  return {
    credentials,
    sensitiveValues: [...new Set(Object.values(credentials))],
  };
}

function assertProviderIdentities(input: {
  assisted: ProviderIdentity;
  embedding: ProviderIdentity;
  eval: ProviderIdentity;
  judge: ProviderIdentity;
  reranking: ProviderIdentity;
}): void {
  for (const [label, identity, gateway, model] of [
    ["eval", input.eval, "https://ai.gurkiai.com/v1", "gpt-5.6-terra"],
    ["assisted", input.assisted, "https://ai.gurkiai.com/v1", "gpt-5.6-terra"],
    ["embedding", input.embedding, "https://openrouter.ai/api/v1", "text-embedding-3-small"],
    ["reranking", input.reranking, "https://ai.gurkiai.com/v1", "gpt-5.6-terra"],
    ["judge", input.judge, "https://ai.gurkiai.com/v1", "gpt-5.5"],
  ] as const) {
    if (
      identity.gateway !== gateway ||
      identity.model !== model ||
      identity.provider !== "openai"
    ) {
      throw new Error(`${label} provider identity does not match the preregistration`);
    }
  }
}

function preflightFailureReason(
  error: unknown,
  session: ProviderTapeSessionStats,
): string {
  const attempt = session.transportAttemptLedger.at(-1);
  if (attempt?.outcome === "error") {
    return `transport-${attempt.errorCategory}`;
  }
  if (attempt?.outcome === "response" && attempt.responseStatus !== 200) {
    return `http-${attempt.responseStatus}`;
  }
  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError", "TypeError"].includes(error.name)
  ) {
    return `transport-${error.name}`;
  }
  return "invalid-response";
}

function assertProviderPreflightSession(session: ProviderTapeSessionStats): void {
  if (
    session.mode !== "prefetch" ||
    session.requests !== V073_PROVIDER_PREFLIGHT_POLICY.probeOrder.length ||
    session.hits !== 0 ||
    session.misses !== session.requests ||
    session.liveRequests !== session.requests ||
    session.coalesced !== 0 ||
    session.non2xxResponses !== 0 ||
    session.sequenceMismatches !== 0 ||
    session.transportAttempts !== session.requests ||
    session.transportErrors !== 0 ||
    session.requestSequenceSha256 !==
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256 ||
    JSON.stringify(session.requestSequence) !==
      JSON.stringify(V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence) ||
    JSON.stringify(session.transportAttemptLedger) !== JSON.stringify(
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence.map(
        ({ fingerprint, targetId }, requestIndex) => ({
          fingerprint,
          outcome: "response",
          requestIndex,
          responseStatus: 200,
          targetId,
        }),
      ),
    ) ||
    JSON.stringify(session.targetCounts) !==
      JSON.stringify({ embedding: 1, eval: 3, judge: 1 })
  ) {
    throw new Error("provider availability preflight transport census is invalid");
  }
}

async function runRawPreflightRequest(input: {
  apiKey: string;
  body: Record<string, unknown>;
  proxy: ProviderResponseTapeProxy;
  target: "embedding" | "judge";
}): Promise<void> {
  const response = await fetch(
    `${input.proxy.baseUrl(input.target)}/${
      input.target === "embedding" ? "embeddings" : "chat/completions"
    }`,
    {
      body: JSON.stringify(input.body),
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(V073_PROVIDER_PREFLIGHT_POLICY.requestTimeoutMs),
    },
  );
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error("provider availability preflight received non-200 response");
  }
  const payload = await response.json() as Record<string, unknown>;
  if (input.target === "embedding") {
    const data = payload.data;
    const first = Array.isArray(data) ? data[0] : undefined;
    const embedding = first !== null && typeof first === "object"
      ? (first as Record<string, unknown>).embedding
      : undefined;
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some((value) =>
        typeof value !== "number" || !Number.isFinite(value)
      )
    ) {
      throw new Error("provider availability preflight embedding is invalid");
    }
    return;
  }
  const choices = payload.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = first !== null && typeof first === "object"
    ? (first as Record<string, unknown>).message
    : undefined;
  const content = message !== null && typeof message === "object"
    ? (message as Record<string, unknown>).content
    : undefined;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("provider availability preflight judge response is invalid");
  }
}

export async function runV073ProviderAvailabilityPreflight(
  input: {
    credentials: ProviderCredentials;
    providers: ProviderIdentities;
  },
  dependencies: {
    fetch: FetchLike;
  } = { fetch: globalThis.fetch.bind(globalThis) as FetchLike },
): Promise<{
  receipt: V073ProviderPreflightReceipt;
  session: ProviderTapeSessionStats;
  tape: ProviderResponseTape;
}> {
  const proxy = createProviderResponseTapeProxy({
    targets: {
      embedding: input.providers.embedding.gateway,
      eval: input.providers.eval.gateway,
      judge: input.providers.judge.gateway,
    },
    upstreamFetch: dependencies.fetch,
  });
  const probes: V073ProviderPreflightReceipt["probes"] = [];
  const attempts = new Map<V073ProviderPreflightTarget, number>();
  proxy.beginSession({
    liveOnMiss: true,
    mode: "prefetch",
    name: "provider-availability-preflight",
  });
  try {
    for (const target of V073_PROVIDER_PREFLIGHT_POLICY.probeOrder) {
      const attempt = (attempts.get(target) ?? 0) + 1;
      attempts.set(target, attempt);
      try {
        if (target === "eval-listwise") {
          const scores = await createProviderListwiseReranker({
            model: {
              apiKey: input.credentials.eval,
              baseURL: proxy.baseUrl("eval"),
              model: input.providers.eval.model,
              provider: "openai",
            },
            requestTimeoutMs: V073_PROVIDER_PREFLIGHT_POLICY.requestTimeoutMs,
            retryLimit: 1,
            temperature: 0,
          }).rerank({
            documents: [
              { id: "candidate-a", text: "The release is blocked." },
              { id: "candidate-b", text: "The release gate passed." },
            ],
            query: "Which candidate says the release gate passed?",
          });
          if (
            scores.length !== 2 ||
            new Set(scores.map(({ id }) => id)).size !== 2
          ) {
            throw new Error("provider availability preflight rerank is invalid");
          }
        } else if (target === "embedding") {
          await runRawPreflightRequest({
            apiKey: input.credentials.embedding,
            body: {
              input: ["GoodMemory provider availability preflight"],
              model: input.providers.embedding.model,
            },
            proxy,
            target,
          });
        } else {
          await runRawPreflightRequest({
            apiKey: input.credentials.judge,
            body: {
              max_tokens: 8,
              messages: [{
                content: "Reply only YES.",
                role: "user",
              }],
              model: input.providers.judge.model,
              temperature: 0,
            },
            proxy,
            target,
          });
        }
        await proxy.waitForIdle();
        const transportAttempt =
          proxy.sessionStats().transportAttemptLedger.at(-1);
        if (
          transportAttempt?.outcome !== "response" ||
          transportAttempt.responseStatus !== 200
        ) {
          throw new Error("provider availability preflight requires HTTP 200");
        }
      } catch (error) {
        await proxy.waitForIdle();
        throw new Error(
          `provider preflight ${target} probe ${attempt} failed: ${
            preflightFailureReason(error, proxy.sessionStats())
          }`,
        );
      }
      probes.push({
        attempt,
        responseKind: target === "eval-listwise"
          ? "stream-object"
          : target === "embedding"
            ? "embedding"
            : "chat-json",
        status: 200,
        target,
      });
    }
    await proxy.waitForIdle();
    const session = proxy.endSession();
    const receipt: V073ProviderPreflightReceipt = {
      probeOrder: [...V073_PROVIDER_PREFLIGHT_POLICY.probeOrder],
      probes,
      totalRequests: probes.length,
    };
    assertV073ProviderPreflightReceipt(receipt);
    assertProviderPreflightSession(session);
    assertProviderTapeCredentialSafe(proxy, Object.values(input.credentials));
    const tape = parseProviderResponseTape(
      serializeProviderResponseTape(proxy.snapshot()),
    );
    return { receipt, session, tape };
  } finally {
    proxy.stop();
  }
}

async function assertPathAbsent(path: string, label: string): Promise<void> {
  try {
    await stat(resolve(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${label} must not exist before the run`);
}

async function measurementHarness(
  worktreePath: string,
): Promise<Record<string, HarnessIdentity>> {
  const sources = {
    claimRecipe: CLAIM_RECIPE_PATH,
    officialRunner: OFFICIAL_RUNNER_PATH,
    reanswerRunner: REANSWER_RUNNER_PATH,
    seedRunner: SEED_RUNNER_PATH,
  } as const;
  return Object.fromEntries(await Promise.all(
    Object.entries(sources).map(async ([name, path]) => {
      const raw = await readFile(join(worktreePath, path), "utf8");
      return [name, {
        bytes: Buffer.byteLength(raw, "utf8"),
        path,
        sha256: sha256(raw),
      }] as const;
    }),
  ));
}

async function writeJson(path: string, value: unknown): Promise<string> {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), raw);
  return raw;
}

async function writeAtomic(path: string, raw: string): Promise<void> {
  const resolved = resolve(path);
  const partial = `${resolved}.partial`;
  await writeFile(partial, raw, { flag: "wx" });
  await rename(partial, resolved);
}

export async function claimV073Schema7FormalAttempt(
  path: string,
  raw: string,
): Promise<void> {
  await writeFile(resolve(path), raw, { flag: "wx" });
}

async function persistDiscoveryFailureTape(input: {
  mode: "prefetch" | "replay";
  proxy: ProviderResponseTapeProxy;
  sensitiveValues: readonly string[];
  stageRoot: string;
}): Promise<{
  artifact: ArtifactIdentity;
  excludedCredentialEntries: number;
} | undefined> {
  if (input.mode !== "prefetch") {
    return undefined;
  }
  const snapshot = input.proxy.snapshot();
  const credentialFingerprints = new Set(
    snapshot.entries
      .filter((entry) =>
        providerTapeEntryContainsSensitiveValue(entry, input.sensitiveValues)
      )
      .map((entry) => entry.fingerprint),
  );
  const entries = snapshot.entries.filter(
    (entry) => !credentialFingerprints.has(entry.fingerprint),
  );
  const raw = serializeProviderResponseTape({ entries, schemaVersion: 3 });
  parseProviderResponseTape(raw);
  const path = join(input.stageRoot, "failure-tape.json");
  await writeAtomic(path, raw);
  return {
    artifact: artifactIdentity(path, raw),
    excludedCredentialEntries: snapshot.entries.length - entries.length,
  };
}

function providerTapeEntryContainsSensitiveValue(
  entry: ProviderResponseTape["entries"][number],
  sensitiveValues: readonly string[],
): boolean {
  const metadata = JSON.stringify({
    request: {
      method: entry.request.method,
      path: entry.request.path,
      targetId: entry.request.targetId,
    },
    response: {
      contentType: entry.response.contentType,
      statusText: entry.response.statusText,
    },
  });
  const body = Buffer.from(entry.response.bodyBase64, "base64");
  return sensitiveValues.some((value) => {
    return sensitiveRepresentations(value).some((candidate) =>
      metadata.includes(candidate) ||
      body.includes(Buffer.from(candidate, "utf8"))
    );
  });
}

function assertProviderTapeCredentialSafe(
  proxy: ProviderResponseTapeProxy,
  sensitiveValues: readonly string[],
): void {
  if (proxy.snapshot().entries.some((entry) =>
    providerTapeEntryContainsSensitiveValue(entry, sensitiveValues)
  )) {
    throw new Error("provider response tape contains configured credential material");
  }
}

function sensitiveRepresentations(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  return [...new Set([
    value,
    encodeURIComponent(value),
    JSON.stringify(value).slice(1, -1),
  ])];
}

function redactSensitiveText(
  text: string,
  sensitiveValues: readonly string[],
): string {
  return sensitiveValues.reduce(
    (redacted, value) => sensitiveRepresentations(value).reduce(
      (current, representation) =>
        current.split(representation).join("[redacted]"),
      redacted,
    ),
    text,
  );
}

function redactSensitiveSessionValues(
  session: ProviderTapeSessionStats,
  sensitiveValues: readonly string[],
): ProviderTapeSessionStats {
  return JSON.parse(JSON.stringify(session, (_key, value: unknown) => {
    if (typeof value !== "string") {
      return value;
    }
    return redactSensitiveText(value, sensitiveValues);
  })) as ProviderTapeSessionStats;
}

function stageRunId(stage: string, suffix: string, outputDir: string): string {
  return `v073-${stage}-${suffix}-${sha256(resolve(outputDir)).slice(0, 8)}`;
}

export function buildV073StageArm(input: {
  benchmarkRoot: string;
  claimRecipeRaw: string;
  commit: string;
  outputDir: string;
  providers: {
    assisted: ProviderIdentity;
    embedding: ProviderIdentity;
    eval: ProviderIdentity;
    judge: ProviderIdentity;
    reranking: ProviderIdentity;
  };
  sourceIdentity: Omit<V073StageSourceIdentity, "claimRecipeRaw">;
  stage: string;
  worktreePath: string;
}): { arm: V073ProtectionArmManifest; claimRecipeRaw: string } {
  const stageRoot = join(input.outputDir, "provider-replay", input.stage);
  const seedRunId = stageRunId(input.stage, "seed", input.outputDir);
  const runId = stageRunId(input.stage, "final", input.outputDir);
  const officialRunId = stageRunId(input.stage, "official", input.outputDir);
  const seedOutputPath = join(stageRoot, seedRunId);
  const outputPath = join(stageRoot, runId);
  const execution = {
    answerGateway: input.providers.eval.gateway,
    answerModel: input.providers.eval.model,
    answerProvider: input.providers.eval.provider,
    answerSystem: "locomo-live-category-aware-v1",
    assistedExtractorGateway: input.providers.assisted.gateway,
    assistedExtractorModel: input.providers.assisted.model,
    assistedExtractorProvider: input.providers.assisted.provider,
    benchmarkFingerprint: BENCHMARK_FINGERPRINT,
    benchmarkRoot: input.benchmarkRoot,
    benchmarkRootSha256: BENCHMARK_ROOT_SHA256,
    bunVersion: REQUIRED_BUN_VERSION,
    caseIds: CASE_IDS,
    claimCommandTemplateSha256:
      deriveV073ClaimCommandTemplateSha256(input.claimRecipeRaw),
    claimSourceSha256: sha256(input.claimRecipeRaw),
    concurrency: 1,
    embeddingGateway: input.providers.embedding.gateway,
    embeddingModel: input.providers.embedding.model,
    embeddingProvider: input.providers.embedding.provider,
    freshOutputEvidence: {
      checkpointPath: join(seedOutputPath, "live-progress.jsonl"),
      checkpointPathAbsentBeforeRun: true,
      outputPath: seedOutputPath,
      outputPathAbsentBeforeRun: true,
    },
    generatedBy: REANSWER_RUNNER_PATH,
    judgeGateway: input.providers.judge.gateway,
    judgeModel: input.providers.judge.model,
    judgeProvider: input.providers.judge.provider,
    officialRunId,
    officialSourceSha256: input.sourceIdentity.officialSourceSha256,
    outputPath,
    promptSha256: deriveV073PromptSha256(),
    questionSelectionSha256: QUESTION_SELECTION_SHA256,
    reanswerSourceSha256: input.sourceIdentity.reanswerSourceSha256,
    rerankingGateway: input.providers.reranking.gateway,
    rerankingModel: input.providers.reranking.model,
    rerankingProvider: input.providers.reranking.provider,
    resume: false,
    runId,
    seedGeneratedBy: SEED_RUNNER_PATH,
    seedOutputPath,
    seedResume: true,
    seedRunId,
    seedSourceSha256: input.sourceIdentity.seedSourceSha256,
    worktreePath: input.worktreePath,
  };
  return {
    arm: {
      commit: input.commit,
      execution,
      executionReceiptPath: join(stageRoot, "execution-receipt.json"),
      executionReceiptSha256: "0".repeat(64),
      officialSummaryPath: join(
        input.worktreePath,
        "reports/eval/research/official-rescore",
        officialRunId,
        "rescore-summary.json",
      ),
      reportPath: join(outputPath, "smoke-report.json"),
      seedReportPath: join(seedOutputPath, "smoke-report.json"),
    },
    claimRecipeRaw: input.claimRecipeRaw,
  };
}

async function buildStageArm(input: {
  benchmarkRoot: string;
  commit: string;
  outputDir: string;
  providers: {
    assisted: ProviderIdentity;
    embedding: ProviderIdentity;
    eval: ProviderIdentity;
    judge: ProviderIdentity;
    reranking: ProviderIdentity;
  };
  stage: string;
  worktreePath: string;
}): Promise<{ arm: V073ProtectionArmManifest; claimRecipeRaw: string }> {
  const [claimRecipeRaw, seedSource, reanswerSource, officialSource] =
    await Promise.all([
      readFile(join(input.worktreePath, CLAIM_RECIPE_PATH), "utf8"),
      readFile(join(input.worktreePath, SEED_RUNNER_PATH), "utf8"),
      readFile(join(input.worktreePath, REANSWER_RUNNER_PATH), "utf8"),
      readFile(join(input.worktreePath, OFFICIAL_RUNNER_PATH), "utf8"),
    ]);
  return buildV073StageArm({
    ...input,
    claimRecipeRaw,
    sourceIdentity: {
      officialSourceSha256: sha256(officialSource),
      reanswerSourceSha256: sha256(reanswerSource),
      seedSourceSha256: sha256(seedSource),
    },
  });
}

function tapeBaseUrls(proxy: ProviderResponseTapeProxy): V073TapeBaseUrls {
  return {
    assisted: proxy.baseUrl("assisted"),
    embedding: proxy.baseUrl("embedding"),
    eval: proxy.baseUrl("eval"),
    judge: proxy.baseUrl("judge"),
    reranking: proxy.baseUrl("reranking"),
  };
}

function questionSelectionSha256(
  rows: ReadonlyArray<{ caseId: string; category: string; questionId: string }>,
): string {
  return sha256(JSON.stringify(rows.map(({ caseId, category, questionId }) => ({
    caseId,
    category,
    questionId,
  }))));
}

export function assertV073SeedStageReport(raw: string): void {
  const report = JSON.parse(raw) as Pick<
    FormalSmokeReport,
    "cases" | "executionFailures" | "questionCount"
  >;
  if (
    report.questionCount !== EXPECTED_QUESTION_COUNT ||
    !Array.isArray(report.cases) ||
    report.cases.length !== EXPECTED_QUESTION_COUNT ||
    report.executionFailures !== 0 ||
    questionSelectionSha256(report.cases) !== QUESTION_SELECTION_SHA256
  ) {
    throw new Error("provider seed report is incomplete");
  }
}

export function assertV073ProviderStageCanContinue(
  mode: "prefetch" | "replay",
  session: ProviderTapeSessionStats,
  tape?: ProviderResponseTape,
): void {
  if (mode === "prefetch" && session.coalesced !== 0) {
    throw new Error(
      `provider discovery observed ${session.coalesced} coalesced request(s)`,
    );
  }
  if (mode === "prefetch") {
    if (tape === undefined) {
      throw new Error("provider discovery response tape is required");
    }
    assertProviderResponseFailuresRecovered(tape, session.requestSequence);
  }
  if (mode === "replay" && session.sequenceMismatches !== 0) {
    throw new Error(
      `formal provider replay observed ${session.sequenceMismatches} input sequence mismatch(es)`,
    );
  }
  if (mode === "replay" && session.misses !== 0) {
    throw new Error(
      `formal provider replay observed ${session.misses} tape miss(es)`,
    );
  }
}

export function parseV073FormalSmokeReport(raw: string): FormalSmokeReport {
  const report = JSON.parse(raw) as FormalSmokeReport;
  if (
    report.questionCount !== EXPECTED_QUESTION_COUNT ||
    report.cases.length !== EXPECTED_QUESTION_COUNT ||
    report.executionFailures !== 0 ||
    report.cases.some((row) =>
      typeof row.answerCorrect !== "boolean" ||
      !Number.isFinite(row.answerTokenF1) ||
      row.answerTokenF1 < 0 ||
      row.answerTokenF1 > 1 ||
      !Number.isFinite(row.evidenceRecall) ||
      row.evidenceRecall < 0 ||
      row.evidenceRecall > 1
    ) ||
    questionSelectionSha256(report.cases) !== QUESTION_SELECTION_SHA256
  ) {
    throw new Error("formal provider replay report is incomplete");
  }
  return report;
}

export function parseV073OfficialSummary(raw: string): OfficialSummary {
  const summary = JSON.parse(raw) as OfficialSummary;
  if (
    !Number.isFinite(summary.overallAccuracy) ||
    summary.overallAccuracy < 0 ||
    summary.overallAccuracy > 1 ||
    !Number.isSafeInteger(summary.judgeFailures) ||
    summary.judgeFailures < 0
  ) {
    throw new Error("formal provider replay official summary is incomplete");
  }
  return summary;
}

export function parseV073OfficialProgress(raw: string): OfficialProgressRow[] {
  const rows = raw
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OfficialProgressRow);
  if (
    rows.length !== EXPECTED_QUESTION_COUNT ||
    rows.some((row) =>
      typeof row.questionId !== "string" ||
      typeof row.correct !== "boolean"
    ) ||
    new Set(rows.map((row) => row.questionId)).size !== EXPECTED_QUESTION_COUNT
  ) {
    throw new Error("formal provider replay official progress is incomplete");
  }
  return rows;
}

export function parseV073ProviderFreeReport(input: {
  benchmarkRoot: string;
  concurrency: number;
  raw: string;
}): V073ProtectionSmokeReport {
  const report = JSON.parse(input.raw) as ProviderFreeSmokeReport & {
    answerEvaluation: string;
    benchmarkFingerprint: string;
    caseIds: string[];
    concurrency: number;
    externalRoot: string;
    generalizedFusion: boolean;
    generatedBy: string;
    ingestMode: string;
    labelFreeIngest: boolean;
    mode: string;
    profilesCompared: string[];
    providerReranking: boolean;
    questionCategories: string[];
    resume: boolean;
    semanticCandidateEmbeddingSource: string;
  };
  if (
    report.answerEvaluation !== "deferred-to-live-mode" ||
    report.benchmarkFingerprint !== BENCHMARK_FINGERPRINT ||
    JSON.stringify(report.caseIds) !== JSON.stringify(CASE_IDS) ||
    report.concurrency !== input.concurrency ||
    resolve(report.externalRoot) !== resolve(input.benchmarkRoot) ||
    report.generalizedFusion !== true ||
    report.generatedBy !== SEED_RUNNER_PATH ||
    report.ingestMode !== "raw-turns" ||
    report.labelFreeIngest !== true ||
    report.mode !== "retrieval-only" ||
    JSON.stringify(report.profilesCompared) !==
      JSON.stringify(["goodmemory-recommended"]) ||
    report.providerReranking !== false ||
    JSON.stringify(report.questionCategories) !==
      JSON.stringify(QUESTION_CATEGORIES) ||
    report.resume !== false ||
    report.semanticCandidateEmbeddingSource !== "none" ||
    report.questionCount !== EXPECTED_QUESTION_COUNT ||
    report.cases.length !== EXPECTED_QUESTION_COUNT
  ) {
    throw new Error("provider-free report does not match the preregistered mode");
  }
  for (const [caseId, count] of Object.entries(EXPECTED_CASE_COUNTS)) {
    if (report.cases.filter((row) => row.caseId === caseId).length !== count) {
      throw new Error("provider-free report does not match the frozen population");
    }
  }
  for (const [category, count] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    if (report.cases.filter((row) => row.category === category).length !== count) {
      throw new Error("provider-free report does not match the frozen population");
    }
  }
  if (
    new Set(report.cases.map((row) => `${row.caseId}\0${row.questionId}`)).size !==
      EXPECTED_QUESTION_COUNT
  ) {
    throw new Error("provider-free report question identities must be unique");
  }
  if (questionSelectionSha256(report.cases) !== QUESTION_SELECTION_SHA256) {
    throw new Error(
      "provider-free report does not match the frozen question selection",
    );
  }
  for (const row of report.cases) {
    if (
      !Array.isArray(row.evidenceTurnIds) ||
      row.evidenceTurnIds.some((id) => typeof id !== "string") ||
      !Array.isArray(row.retrievedTurnIds) ||
      row.retrievedTurnIds.some((id) => typeof id !== "string") ||
      !Array.isArray(row.missingEvidenceTurnIds) ||
      row.missingEvidenceTurnIds.some((id) => typeof id !== "string") ||
      !Array.isArray(row.noiseTurnIds) ||
      row.noiseTurnIds.some((id) => typeof id !== "string")
    ) {
      throw new Error("provider-free retrieval metrics are inconsistent");
    }
    const retrieved = new Set(row.retrievedTurnIds);
    const evidence = new Set(row.evidenceTurnIds);
    const evidenceHitCount = row.evidenceTurnIds.filter((id) =>
      retrieved.has(id)
    ).length;
    const evidenceRecall = row.evidenceTurnIds.length === 0
      ? 1
      : evidenceHitCount / row.evidenceTurnIds.length;
    const missingEvidenceTurnIds = row.evidenceTurnIds.filter(
      (id) => !retrieved.has(id),
    );
    const noiseTurnIds = row.retrievedTurnIds.filter(
      (id, index, all) => !evidence.has(id) && all.indexOf(id) === index,
    );
    if (
      row.evidenceRecall !== evidenceRecall ||
      row.goldEvidenceFullyRetrieved !== (evidenceRecall === 1) ||
      JSON.stringify(row.missingEvidenceTurnIds) !==
        JSON.stringify(missingEvidenceTurnIds) ||
      row.noiseTurnCount !== noiseTurnIds.length ||
      JSON.stringify(row.noiseTurnIds) !== JSON.stringify(noiseTurnIds)
    ) {
      throw new Error("provider-free retrieval metrics are inconsistent");
    }
  }
  return report;
}

export async function runV073ProviderStage(input: {
  arm: V073ProtectionArmManifest;
  claimRecipeRaw: string;
  expectedRequestSequence?: readonly ProviderTapeRequestIdentity[];
  liveOnMiss: boolean;
  mode: "prefetch" | "replay";
  proxy: ProviderResponseTapeProxy;
  sensitiveValues: readonly string[];
  stage: string;
}, dependencies: {
  runProcess(input: CapturedProcessInput): Promise<CapturedProcess>;
} = { runProcess: runCapturedProcess }): Promise<ProviderStageResult> {
  await Promise.all([
    assertPathAbsent(input.arm.execution.seedOutputPath, `${input.stage} seed output`),
    assertPathAbsent(input.arm.execution.outputPath, `${input.stage} final output`),
    assertPathAbsent(dirname(input.arm.officialSummaryPath), `${input.stage} official output`),
  ]);
  const chain = routeV073CommandChainThroughTape(
    buildV073PairedCommandChain(input.arm, input.claimRecipeRaw),
    tapeBaseUrls(input.proxy),
    { replayCredentials: input.mode === "replay" },
  );
  input.proxy.beginSession({
    ...(input.expectedRequestSequence === undefined
      ? {}
      : { expectedRequestSequence: input.expectedRequestSequence }),
    liveOnMiss: input.liveOnMiss,
    mode: input.mode,
    name: input.stage,
  });
  const processes: Array<{ result: CapturedProcess; step: string }> = [];
  let validationFailure: string | undefined;
  let session: ProviderTapeSessionStats;
  try {
    for (const step of V073_PROVIDER_STAGE_ORDER) {
      const invocation = chain[step];
      const result = await dependencies.runProcess({
        args: invocation.args,
        command: invocation.command,
        cwd: invocation.cwd,
        environment: invocation.environment,
        sensitiveValues: input.sensitiveValues,
      });
      processes.push({
        result: {
          ...result,
          stderr: redactSensitiveText(result.stderr, input.sensitiveValues),
          stdout: redactSensitiveText(result.stdout, input.sensitiveValues),
        },
        step,
      });
      if (result.exitCode !== 0) {
        break;
      }
      if (step === "seedSmoke") {
        try {
          assertV073SeedStageReport(
            await readFile(input.arm.seedReportPath, "utf8"),
          );
        } catch (error) {
          validationFailure = error instanceof Error
            ? error.message
            : String(error);
          break;
        }
      }
      try {
        assertV073ProviderStageCanContinue(
          input.mode,
          input.proxy.sessionStats(),
          input.proxy.snapshot(),
        );
      } catch (error) {
        validationFailure = error instanceof Error
          ? error.message
          : String(error);
        break;
      }
    }
  } catch (error) {
    validationFailure = error instanceof Error ? error.message : String(error);
  } finally {
    await input.proxy.waitForIdle();
    session = input.proxy.endSession();
  }
  try {
    assertV073ProviderStageCanContinue(input.mode, session, input.proxy.snapshot());
  } catch (error) {
    validationFailure = error instanceof Error ? error.message : String(error);
  }
  const stageRoot = dirname(input.arm.executionReceiptPath);
  validationFailure = validationFailure === undefined
    ? undefined
    : redactSensitiveText(validationFailure, input.sensitiveValues);
  const stdout = processes
    .map(({ result, step }) => `[${step}]\n${result.stdout}`)
    .join("\n");
  const stderr = processes
    .map(({ result, step }) => `[${step}]\n${result.stderr}`)
    .join("\n");
  const stdoutPath = join(stageRoot, "stdout.log");
  const stderrPath = join(stageRoot, "stderr.log");
  await mkdir(stageRoot, { recursive: true });
  await Promise.all([writeFile(stdoutPath, stdout), writeFile(stderrPath, stderr)]);
  const failed = processes.find(({ result }) => result.exitCode !== 0);
  const receiptBase = {
    commandChain: chain,
    commit: input.arm.commit,
    executionOrder: V073_PROVIDER_STAGE_ORDER,
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    session: redactSensitiveSessionValues(session, input.sensitiveValues),
    sourceIdentity: {
      claimCommandTemplateSha256:
        input.arm.execution.claimCommandTemplateSha256,
      claimSourceSha256: input.arm.execution.claimSourceSha256,
      officialSourceSha256: input.arm.execution.officialSourceSha256,
      promptSha256: input.arm.execution.promptSha256,
      reanswerSourceSha256: input.arm.execution.reanswerSourceSha256,
      seedSourceSha256: input.arm.execution.seedSourceSha256,
    },
    stage: input.stage,
    stderr: artifactIdentity(stderrPath, stderr),
    steps: processes.map(({ result, step }) => ({
      exitCode: result.exitCode,
      step,
    })),
    stdout: artifactIdentity(stdoutPath, stdout),
  };
  const writeFailureReceipt = async (
    failure: string | undefined,
  ): Promise<void> => {
    const failureTape = await persistDiscoveryFailureTape({
      mode: input.mode,
      proxy: input.proxy,
      sensitiveValues: input.sensitiveValues,
      stageRoot,
    });
    await writeJson(input.arm.executionReceiptPath, {
      ...receiptBase,
      ...(failureTape === undefined
        ? {}
        : {
            failureTape: failureTape.artifact,
            failureTapeExcludedCredentialEntries:
              failureTape.excludedCredentialEntries,
          }),
      ...(failure === undefined ? {} : { validationFailure: failure }),
    });
  };
  if (validationFailure !== undefined) {
    await writeFailureReceipt(validationFailure);
    throw new Error(`${input.stage} ${validationFailure}`);
  }
  if (failed !== undefined) {
    await writeFailureReceipt(undefined);
    throw new Error(
      `${input.stage} ${failed.step} exited with ${String(failed.result.exitCode)}`,
    );
  }
  try {
    assertProviderTapeCredentialSafe(input.proxy, input.sensitiveValues);
    const officialProgressPath = join(
      dirname(input.arm.officialSummaryPath),
      "progress.jsonl",
    );
    const [seedRaw, finalRaw, officialRaw, officialProgressRaw] = await Promise.all([
      readFile(input.arm.seedReportPath, "utf8"),
      readFile(input.arm.reportPath, "utf8"),
      readFile(input.arm.officialSummaryPath, "utf8"),
      readFile(officialProgressPath, "utf8"),
    ]);
    const finalReport = parseV073FormalSmokeReport(finalRaw);
    const officialSummary = parseV073OfficialSummary(officialRaw);
    const officialProgress = parseV073OfficialProgress(officialProgressRaw);
    const reportQuestionIds = new Set(
      finalReport.cases.map((row) => row.questionId),
    );
    if (
      officialProgress.some((row) => !reportQuestionIds.has(row.questionId)) ||
      Math.abs(
        mean(officialProgress.map((row) => Number(row.correct))) -
          officialSummary.overallAccuracy,
      ) > 1e-12
    ) {
      throw new Error("formal provider replay official outputs disagree");
    }
    const copiedOfficialPath = join(stageRoot, "official-summary.json");
    const copiedProgressPath = join(stageRoot, "official-progress.jsonl");
    await Promise.all([
      writeFile(copiedOfficialPath, officialRaw),
      writeFile(copiedProgressPath, officialProgressRaw),
    ]);
    await writeJson(input.arm.executionReceiptPath, {
      ...receiptBase,
      outputs: {
        finalReport: artifactIdentity(input.arm.reportPath, finalRaw),
        officialProgress: artifactIdentity(copiedProgressPath, officialProgressRaw),
        officialSummary: artifactIdentity(copiedOfficialPath, officialRaw),
        seedReport: artifactIdentity(input.arm.seedReportPath, seedRaw),
      },
    });
    return {
      finalReport,
      finalReportPath: input.arm.reportPath,
      officialProgress,
      officialProgressPath: copiedProgressPath,
      officialSummary,
      officialSummaryPath: copiedOfficialPath,
      receiptPath: input.arm.executionReceiptPath,
      seedReportPath: input.arm.seedReportPath,
      session,
    };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await writeFailureReceipt(failure);
    throw new Error(`${input.stage} ${failure}`);
  }
}

export function buildV073ProviderFreeArgs(input: {
  benchmarkRoot: string;
  concurrency: number;
  outputDir: string;
  runId: string;
}): string[] {
  return [
    "run",
    SEED_RUNNER_PATH,
    "--",
    "--benchmark-root",
    input.benchmarkRoot,
    "--case-id",
    CASE_IDS[0],
    "--case-id",
    CASE_IDS[1],
    ...QUESTION_CATEGORIES.flatMap((category) => ["--category", category]),
    "--label-free-ingest",
    "--generalized-fusion",
    "--concurrency",
    String(input.concurrency),
    "--output-dir",
    input.outputDir,
    "--run-id",
    input.runId,
  ];
}

async function runProviderFreeArm(input: {
  benchmarkRoot: string;
  commit: string;
  concurrency: number;
  label: "baseline" | "candidate";
  outputDir: string;
  worktreePath: string;
}): Promise<{
  path: string;
  receiptPath: string;
  report: V073ProtectionSmokeReport;
}> {
  const runId = `v073-provider-free-c${input.concurrency}-${input.label}`;
  const runRoot = join(input.outputDir, "provider-free", runId);
  await assertPathAbsent(runRoot, `${runId} output`);
  const args = buildV073ProviderFreeArgs({
    benchmarkRoot: input.benchmarkRoot,
    concurrency: input.concurrency,
    outputDir: join(input.outputDir, "provider-free"),
    runId,
  });
  const result = await runCapturedProcess({
    args,
    command: "bun",
    cwd: input.worktreePath,
  });
  const receiptRoot = join(input.outputDir, "provider-free", "receipts", runId);
  await mkdir(receiptRoot, { recursive: true });
  const stdoutPath = join(receiptRoot, "stdout.log");
  const stderrPath = join(receiptRoot, "stderr.log");
  await Promise.all([
    writeFile(stdoutPath, result.stdout),
    writeFile(stderrPath, result.stderr),
  ]);
  const receiptPath = join(receiptRoot, "execution-receipt.json");
  const receiptBase = {
    args,
    command: "bun",
    commit: input.commit,
    concurrency: input.concurrency,
    cwd: input.worktreePath,
    exitCode: result.exitCode,
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    label: input.label,
    stderr: artifactIdentity(stderrPath, result.stderr),
    stdout: artifactIdentity(stdoutPath, result.stdout),
  };
  if (result.exitCode !== 0) {
    await writeJson(receiptPath, receiptBase);
    throw new Error(`${runId} exited with ${String(result.exitCode)}`);
  }
  const path = join(runRoot, "smoke-report.json");
  const raw = await readFile(path, "utf8");
  const report = parseV073ProviderFreeReport({
    benchmarkRoot: input.benchmarkRoot,
    concurrency: input.concurrency,
    raw,
  });
  await writeJson(receiptPath, {
    ...receiptBase,
    report: artifactIdentity(path, raw),
  });
  return { path, receiptPath, report };
}

async function runScenario(input: {
  candidateCommit: string;
  outputDir: string;
  worktreePath: string;
}): Promise<{
  failures: number;
  passed: number;
  receiptPath: string;
}> {
  const result = await runCapturedProcess({
    args: ["test", "tests/scenarios"],
    command: "bun",
    cwd: input.worktreePath,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const passed = Number(output.match(/\b(\d+)\s+pass\b/u)?.[1] ?? -1);
  const failures = Number(output.match(/\b(\d+)\s+fail\b/u)?.[1] ?? -1);
  const root = join(input.outputDir, "scenario");
  await mkdir(root, { recursive: true });
  const stdoutPath = join(root, "stdout.log");
  const stderrPath = join(root, "stderr.log");
  await Promise.all([
    writeFile(stdoutPath, result.stdout),
    writeFile(stderrPath, result.stderr),
  ]);
  const receiptPath = join(root, "execution-receipt.json");
  await writeJson(receiptPath, {
    args: ["test", "tests/scenarios"],
    candidateCommit: input.candidateCommit,
    command: "bun",
    cwd: input.worktreePath,
    exitCode: result.exitCode,
    failures,
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    passed,
    stderr: artifactIdentity(stderrPath, result.stderr),
    stdout: artifactIdentity(stdoutPath, result.stdout),
  });
  assertV073ScenarioOutcome({
    exitCode: result.exitCode,
    failures,
    passed,
  });
  return { failures, passed, receiptPath };
}

export function assertV073ScenarioOutcome(input: {
  exitCode: number | null;
  failures: number;
  passed: number;
}): void {
  if (input.exitCode !== 0) {
    throw new Error(`scenario replay exited with ${String(input.exitCode)}`);
  }
  if (
    !Number.isSafeInteger(input.failures) ||
    input.failures < 0 ||
    !Number.isSafeInteger(input.passed) ||
    input.passed < 0
  ) {
    throw new Error("scenario replay counts are invalid");
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function providerPointDeltas(
  baseline: ProviderStageResult,
  candidate: ProviderStageResult,
): NonNullable<V073ReplacementProtectionInput["providerReplay"]["pointDeltas"]> {
  return {
    evidenceRecall:
      mean(candidate.finalReport.cases.map((row) => row.evidenceRecall)) -
      mean(baseline.finalReport.cases.map((row) => row.evidenceRecall)),
    officialScore:
      candidate.officialSummary.overallAccuracy -
      baseline.officialSummary.overallAccuracy,
    strictAnswerScore:
      mean(candidate.finalReport.cases.map((row) => row.answerTokenF1)) -
      mean(baseline.finalReport.cases.map((row) => row.answerTokenF1)),
  };
}

export function officialQuestionTransitions(
  baseline: readonly OfficialProgressRow[],
  candidate: readonly OfficialProgressRow[],
): V073ReplacementProtectionInput["questionTransitions"] {
  const candidateByQuestion = new Map(
    candidate.map((row) => [row.questionId, row.correct]),
  );
  if (
    baseline.length !== candidate.length ||
    new Set(baseline.map((row) => row.questionId)).size !== baseline.length ||
    candidateByQuestion.size !== candidate.length ||
    baseline.some((row) => !candidateByQuestion.has(row.questionId))
  ) {
    throw new Error("formal provider replay question identities must match");
  }
  let improved = 0;
  let regressed = 0;
  for (const baselineRow of baseline) {
    const candidateCorrect = candidateByQuestion.get(baselineRow.questionId)!;
    if (!baselineRow.correct && candidateCorrect) {
      improved += 1;
    } else if (baselineRow.correct && !candidateCorrect) {
      regressed += 1;
    }
  }
  return { improved, regressed, total: baseline.length };
}

function replaySession(stats: ProviderTapeSessionStats): V073ProviderReplaySession {
  return {
    coalesced: stats.coalesced,
    hits: stats.hits,
    liveRequests: stats.liveRequests,
    misses: stats.misses,
    mode: stats.mode,
    non2xxResponses: stats.non2xxResponses,
    requestFingerprintMultisetSha256: stats.requestFingerprintMultisetSha256,
    requestSequenceSha256: stats.requestSequenceSha256,
    requests: stats.requests,
    sequenceMismatches: stats.sequenceMismatches,
    targetCounts: stats.targetCounts,
    tapeSha256: stats.tapeSha256,
    transportAttemptLedgerSha256: stats.transportAttemptLedgerSha256,
    transportAttempts: stats.transportAttempts,
    transportErrors: stats.transportErrors,
  };
}

async function trackedArtifact(path: string): Promise<ArtifactIdentity> {
  const resolved = resolve(path);
  const trackedPath = relative(process.cwd(), resolved);
  if (trackedPath.startsWith("..")) {
    throw new Error("replacement protection artifacts must stay inside the repository");
  }
  return artifactIdentity(trackedPath, await readFile(resolved, "utf8"));
}

async function runGate(options: V073ReplacementGateCliOptions): Promise<void> {
  if (Bun.version !== REQUIRED_BUN_VERSION) {
    throw new Error(`replacement protection requires Bun ${REQUIRED_BUN_VERSION}`);
  }
  const baselineWorktree = resolve(options.baselineWorktree);
  const candidateWorktree = resolve(options.candidateWorktree);
  const benchmarkRoot = resolve(options.benchmarkRoot);
  const outputDir = resolve(options.outputDir);
  const formalAttemptSentinelPath = resolve(FORMAL_ATTEMPT_SENTINEL);
  const reportPath = resolve(PROTECTION_ARTIFACT);
  if (baselineWorktree === candidateWorktree) {
    throw new Error("baseline and candidate detached checkouts must differ");
  }
  if (outputDir !== resolve(EVIDENCE_ROOT)) {
    throw new Error(`replacement protection output must be ${EVIDENCE_ROOT}`);
  }
  await Promise.all([
    assertPathAbsent(outputDir, "replacement protection evidence root"),
    assertPathAbsent(
      formalAttemptSentinelPath,
      "replacement protection schema 7 attempt sentinel",
    ),
    assertPathAbsent(reportPath, "replacement protection artifact"),
  ]);
  const [
    driverProvenance,
    baselineProvenance,
    candidateProvenance,
    benchmarkBytes,
    baselineHarness,
    candidateHarness,
  ] =
    await Promise.all([
      worktreeProvenance(process.cwd()),
      worktreeProvenance(baselineWorktree),
      worktreeProvenance(candidateWorktree),
      readFile(join(benchmarkRoot, "cases.json")),
      measurementHarness(baselineWorktree),
      measurementHarness(candidateWorktree),
    ]);
  assertCleanDetached(baselineProvenance, BASELINE_COMMIT, "baseline");
  assertCleanDetached(candidateProvenance, null, "candidate");
  assertV073DriverMatchesCandidate(driverProvenance, candidateProvenance);
  if (JSON.stringify(baselineHarness) !== JSON.stringify(candidateHarness)) {
    throw new Error("baseline and candidate measurement harness bytes must match");
  }
  if (
    benchmarkBytes.byteLength !== BENCHMARK_ROOT_BYTES ||
    sha256(benchmarkBytes) !== BENCHMARK_ROOT_SHA256
  ) {
    throw new Error("LoCoMo benchmark root does not match the preregistration");
  }
  const providers = {
    assisted: requiredProvider("GOODMEMORY_ASSISTED_EXTRACTOR"),
    embedding: requiredProvider("GOODMEMORY_EMBEDDING"),
    eval: requiredProvider("GOODMEMORY_EVAL"),
    judge: requiredProvider("GOODMEMORY_JUDGE"),
    reranking: requiredProvider("GOODMEMORY_RERANKING"),
  } satisfies ProviderIdentities;
  const { credentials, sensitiveValues } = requiredProviderCredentials();
  assertProviderIdentities(providers);
  const providerPreflight = await runV073ProviderAvailabilityPreflight({
    credentials,
    providers,
  });
  const formalAttemptSentinelRaw = `${JSON.stringify({
    baselineCommit: baselineProvenance.commit,
    candidateCommit: candidateProvenance.commit,
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    providerPreflight: providerPreflight.receipt,
    requestSequenceSha256:
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
    schemaVersion: 7,
    state: "consumed",
  }, null, 2)}\n`;
  await claimV073Schema7FormalAttempt(
    formalAttemptSentinelPath,
    formalAttemptSentinelRaw,
  );
  await mkdir(outputDir);
  const providerPreflightRoot = join(outputDir, "provider-preflight");
  await mkdir(providerPreflightRoot);
  const providerPreflightTapePath = join(providerPreflightRoot, "tape.json");
  const providerPreflightTapeRaw = serializeProviderResponseTape(
    providerPreflight.tape,
  );
  await writeAtomic(providerPreflightTapePath, providerPreflightTapeRaw);
  const providerPreflightReceiptPath = join(
    providerPreflightRoot,
    "execution-receipt.json",
  );
  const providerPreflightReceiptRaw = await writeJson(
    providerPreflightReceiptPath,
    {
      generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
      probePlan: providerPreflight.receipt,
      session: redactSensitiveSessionValues(
        providerPreflight.session,
        sensitiveValues,
      ),
      tape: artifactIdentity(
        providerPreflightTapePath,
        providerPreflightTapeRaw,
      ),
    },
  );
  const manifestPath = join(outputDir, "manifest.json");
  await writeJson(manifestPath, {
    baseline: { ...baselineProvenance, worktreePath: baselineWorktree },
    benchmark: {
      bytes: benchmarkBytes.byteLength,
      fingerprint: BENCHMARK_FINGERPRINT,
      root: benchmarkRoot,
      sha256: sha256(benchmarkBytes),
    },
    candidate: { ...candidateProvenance, worktreePath: candidateWorktree },
    formalAttempt: {
      sentinel: artifactIdentity(
        formalAttemptSentinelPath,
        formalAttemptSentinelRaw,
      ),
    },
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    measurementHarness: baselineHarness,
    providerPreflight: {
      receipt: artifactIdentity(
        providerPreflightReceiptPath,
        providerPreflightReceiptRaw,
      ),
      summary: providerPreflight.receipt,
      tape: artifactIdentity(
        providerPreflightTapePath,
        providerPreflightTapeRaw,
      ),
    },
    protocol: {
      assistedExtractionMaxAttempts:
        V073_ASSISTED_EXTRACTION_POLICY.maxAttempts,
      assistedExtractionRequestTimeoutMs:
        V073_ASSISTED_EXTRACTION_POLICY.requestTimeoutMs,
      claimCommandTemplateSha256:
        deriveV073ClaimCommandTemplateSha256(
          await readFile(join(candidateWorktree, CLAIM_RECIPE_PATH), "utf8"),
        ),
      failureTapeCredentialMaterial: "excluded-before-persistence",
      failedDiscoveryTape: "atomic-before-stage-error",
      formalNetworkOnMiss: false,
      hardRegressionLimit: 0.01,
      promptSha256: deriveV073PromptSha256(),
      providerFailureRecovery:
        "immediate-same-fingerprint-retry-to-2xx",
      providerPreflightFormalAttemptBoundary:
        "schema7-consumed-sentinel-created-only-after-success",
      providerPreflightProbeOrder:
        V073_PROVIDER_PREFLIGHT_POLICY.probeOrder,
      providerPreflightRequestTimeoutMs:
        V073_PROVIDER_PREFLIGHT_POLICY.requestTimeoutMs,
      providerPreflightRequestSequenceSha256:
        V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
      providerPreflightRetries: 0,
      providerFreeConcurrency: [1, 40],
      providerLogCredentialMaterial:
        "redacted-before-output-hash-and-persistence",
      providerReplayConcurrency: 1,
      signTestAlpha: 0.05,
      tapeInputIdentity:
        "ordered request fingerprint + logical target + method + path/query + canonical-body digest + semantic-header digest",
      tapeRequestIdentity:
        "sha256(logical-target + method + path/query + canonical-json-body + semantic-headers)",
      tapeResponseVariants: "ordered-per-fingerprint",
      tapeSequenceCoverage: "exact-discovery-occurrence-union",
      transportAttemptLedger: "hash-only-session-receipt",
      transportErrorResponseStatus:
        V073_PROVIDER_TRANSPORT_POLICY.errorResponseStatus,
      transportErrors: V073_PROVIDER_TRANSPORT_POLICY.transportErrors,
      transportProxyRetries: V073_PROVIDER_TRANSPORT_POLICY.proxyRetries,
    },
    providers,
    schemaVersion: 7,
  });

  const [providerFreeC1Baseline, providerFreeC1Candidate] = await Promise.all([
    runProviderFreeArm({
      benchmarkRoot,
      commit: baselineProvenance.commit,
      concurrency: 1,
      label: "baseline",
      outputDir,
      worktreePath: baselineWorktree,
    }),
    runProviderFreeArm({
      benchmarkRoot,
      commit: candidateProvenance.commit,
      concurrency: 1,
      label: "candidate",
      outputDir,
      worktreePath: candidateWorktree,
    }),
  ]);
  const [providerFreeC40Baseline, providerFreeC40Candidate, scenario] =
    await Promise.all([
      runProviderFreeArm({
        benchmarkRoot,
        commit: baselineProvenance.commit,
        concurrency: 40,
        label: "baseline",
        outputDir,
        worktreePath: baselineWorktree,
      }),
      runProviderFreeArm({
        benchmarkRoot,
        commit: candidateProvenance.commit,
        concurrency: 40,
        label: "candidate",
        outputDir,
        worktreePath: candidateWorktree,
      }),
      runScenario({
        candidateCommit: candidateProvenance.commit,
        outputDir,
        worktreePath: candidateWorktree,
      }),
    ]);

  const tapeTargets = {
    assisted: providers.assisted.gateway,
    embedding: providers.embedding.gateway,
    eval: providers.eval.gateway,
    judge: providers.judge.gateway,
    reranking: providers.reranking.gateway,
  };
  const discoveryProxy = createProviderResponseTapeProxy({ targets: tapeTargets });
  let baselineDiscovery: ProviderStageResult;
  let candidateDiscovery: ProviderStageResult;
  try {
    const baselineDiscoveryArm = await buildStageArm({
      benchmarkRoot,
      commit: baselineProvenance.commit,
      outputDir,
      providers,
      stage: "baseline-discovery",
      worktreePath: baselineWorktree,
    });
    baselineDiscovery = await runV073ProviderStage({
      ...baselineDiscoveryArm,
      liveOnMiss: true,
      mode: "prefetch",
      proxy: discoveryProxy,
      sensitiveValues,
      stage: "baseline-discovery",
    });
    const candidateDiscoveryArm = await buildStageArm({
      benchmarkRoot,
      commit: candidateProvenance.commit,
      outputDir,
      providers,
      stage: "candidate-discovery",
      worktreePath: candidateWorktree,
    });
    candidateDiscovery = await runV073ProviderStage({
      ...candidateDiscoveryArm,
      liveOnMiss: true,
      mode: "prefetch",
      proxy: discoveryProxy,
      sensitiveValues,
      stage: "candidate-discovery",
    });
    const tapeRaw = serializeProviderResponseTape(discoveryProxy.snapshot());
    const tapePath = join(outputDir, "provider-response-tape.json");
    await writeAtomic(tapePath, tapeRaw);
  } finally {
    discoveryProxy.stop();
  }

  const tapePath = join(outputDir, "provider-response-tape.json");
  const tapeRaw = await readFile(tapePath, "utf8");
  const frozenTape = parseProviderResponseTape(tapeRaw);
  const replayProxy = createProviderResponseTapeProxy({
    initialTape: frozenTape,
    targets: tapeTargets,
  });
  let baselineFormal: ProviderStageResult;
  let candidateFormal: ProviderStageResult;
  try {
    const baselineFormalArm = await buildStageArm({
      benchmarkRoot,
      commit: baselineProvenance.commit,
      outputDir,
      providers,
      stage: "baseline-formal",
      worktreePath: baselineWorktree,
    });
    baselineFormal = await runV073ProviderStage({
      ...baselineFormalArm,
      expectedRequestSequence: baselineDiscovery.session.requestSequence,
      liveOnMiss: false,
      mode: "replay",
      proxy: replayProxy,
      sensitiveValues,
      stage: "baseline-formal",
    });
    const candidateFormalArm = await buildStageArm({
      benchmarkRoot,
      commit: candidateProvenance.commit,
      outputDir,
      providers,
      stage: "candidate-formal",
      worktreePath: candidateWorktree,
    });
    candidateFormal = await runV073ProviderStage({
      ...candidateFormalArm,
      expectedRequestSequence: candidateDiscovery.session.requestSequence,
      liveOnMiss: false,
      mode: "replay",
      proxy: replayProxy,
      sensitiveValues,
      stage: "candidate-formal",
    });
  } finally {
    replayProxy.stop();
  }

  const tapeSha256 = sha256(tapeRaw);
  const protocolInput: V073ReplacementProtectionInput = {
    baselineCommit: baselineProvenance.commit,
    candidateCommit: candidateProvenance.commit,
    candidatePromptSha256: deriveV073PromptSha256(),
    deterministicArms: [
      {
        baseline: providerFreeC1Baseline.report,
        candidate: providerFreeC1Candidate.report,
        concurrency: 1,
      },
      {
        baseline: providerFreeC40Baseline.report,
        candidate: providerFreeC40Candidate.report,
        concurrency: 40,
      },
    ],
    providerPreflight: providerPreflight.receipt,
    providerReplay: {
      baselineExecutionFailures: baselineFormal.finalReport.executionFailures,
      baselineJudgeFailures: baselineFormal.officialSummary.judgeFailures,
      candidateExecutionFailures: candidateFormal.finalReport.executionFailures,
      candidateJudgeFailures: candidateFormal.officialSummary.judgeFailures,
      concurrency: 1,
      discovery: {
        baseline: replaySession(baselineDiscovery.session),
        candidate: replaySession(candidateDiscovery.session),
      },
      formal: {
        baseline: replaySession(baselineFormal.session),
        candidate: replaySession(candidateFormal.session),
      },
      pointDeltas: providerPointDeltas(baselineFormal, candidateFormal),
      tapeEntryCount: frozenTape.entries.length,
      tapeSha256,
      tapeTargetCounts: Object.fromEntries(
        [...new Set(frozenTape.entries.map((entry) => entry.request.targetId))]
          .sort()
          .map((targetId) => [
            targetId,
            frozenTape.entries.filter((entry) => entry.request.targetId === targetId).length,
          ]),
      ),
    },
    questionTransitions: officialQuestionTransitions(
      baselineFormal.officialProgress,
      candidateFormal.officialProgress,
    ),
    scenarioReplay: {
      failures: scenario.failures,
      passed: scenario.passed,
    },
  };
  const protocolInputPath = join(outputDir, "protocol-input.json");
  await writeJson(protocolInputPath, protocolInput);
  const evaluated = evaluateV073ReplacementProtection(protocolInput);
  const [baselineAfter, candidateAfter] = await Promise.all([
    worktreeProvenance(baselineWorktree),
    worktreeProvenance(candidateWorktree),
  ]);
  assertCleanDetached(baselineAfter, baselineProvenance.commit, "baseline");
  assertCleanDetached(candidateAfter, candidateProvenance.commit, "candidate");
  const artifacts = {
    attemptSentinel: await trackedArtifact(formalAttemptSentinelPath),
    manifest: await trackedArtifact(manifestPath),
    protocolInput: await trackedArtifact(protocolInputPath),
    providerPreflight: {
      receipt: await trackedArtifact(providerPreflightReceiptPath),
      tape: await trackedArtifact(providerPreflightTapePath),
    },
    providerFree: {
      c1Baseline: await trackedArtifact(providerFreeC1Baseline.path),
      c1BaselineReceipt: await trackedArtifact(providerFreeC1Baseline.receiptPath),
      c1Candidate: await trackedArtifact(providerFreeC1Candidate.path),
      c1CandidateReceipt: await trackedArtifact(providerFreeC1Candidate.receiptPath),
      c40Baseline: await trackedArtifact(providerFreeC40Baseline.path),
      c40BaselineReceipt: await trackedArtifact(providerFreeC40Baseline.receiptPath),
      c40Candidate: await trackedArtifact(providerFreeC40Candidate.path),
      c40CandidateReceipt: await trackedArtifact(providerFreeC40Candidate.receiptPath),
    },
    providerReplay: {
      baselineDiscoveryReceipt: await trackedArtifact(baselineDiscovery.receiptPath),
      baselineFormalOfficial: await trackedArtifact(baselineFormal.officialSummaryPath),
      baselineFormalProgress: await trackedArtifact(baselineFormal.officialProgressPath),
      baselineFormalReport: await trackedArtifact(baselineFormal.finalReportPath),
      baselineFormalReceipt: await trackedArtifact(baselineFormal.receiptPath),
      candidateDiscoveryReceipt: await trackedArtifact(candidateDiscovery.receiptPath),
      candidateFormalOfficial: await trackedArtifact(candidateFormal.officialSummaryPath),
      candidateFormalProgress: await trackedArtifact(candidateFormal.officialProgressPath),
      candidateFormalReport: await trackedArtifact(candidateFormal.finalReportPath),
      candidateFormalReceipt: await trackedArtifact(candidateFormal.receiptPath),
      tape: await trackedArtifact(tapePath),
    },
    scenarioReceipt: await trackedArtifact(scenario.receiptPath),
  };
  const report: V073ReplacementProtectionReport & { artifacts: typeof artifacts } = {
    ...evaluated,
    artifacts,
  };
  await writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.releaseAllowed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await runGate(parseV073ReplacementGateCliOptions(Bun.argv));
}
