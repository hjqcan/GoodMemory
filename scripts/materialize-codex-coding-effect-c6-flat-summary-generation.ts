import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type {
  C6CandidatePlan,
} from "./codex-coding-effect/c6-candidate-plan";
import type {
  C6FlatSummaryTransport,
} from "./codex-coding-effect/c6-flat-summary-generation-capture";
import {
  C6FlatSummaryTransportBoundaryError,
  C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
  C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
  C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
  validateC6FlatSummaryApiToken,
} from "./codex-coding-effect/c6-flat-summary-generation-capture";
import type {
  C6FlatSummaryGenerationPublication,
} from "./codex-coding-effect/c6-flat-summary-generation-publication";
import {
  finalizeC6FlatSummaryGenerationCaptureRoot,
  materializeC6FlatSummaryGenerationCaptureToRoot,
} from "./codex-coding-effect/c6-flat-summary-generation-publication";
import {
  canonicalExistingDirectory,
} from "./codex-coding-effect/c6-package-source-artifact-publication";
import {
  readC6StableRegularFile,
} from "./codex-coding-effect/c6-asset-lock";

const API_KEY_ENVIRONMENT_NAME =
  "GOODMEMORY_C6_FLAT_SUMMARY_API_KEY";
export {
  C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
  C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
};
const OPTION_NAMES = new Set([
  "histories-root",
  "output-root",
  "plan",
  "plan-sha256",
  "summary-prompt",
  "summary-protocol",
]);

export interface C6FlatSummaryGenerationCliOptions {
  historiesRoot: string;
  mode: "execute" | "finalize-only";
  outputRoot: string;
  planPath: string;
  planSha256: string;
  summaryPromptPath: string;
  summaryProtocolPath: string;
}

export interface C6FlatSummaryGenerationCommandInput {
  apiToken: string;
  options: C6FlatSummaryGenerationCliOptions;
}

export type C6FlatSummaryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function parseC6FlatSummaryGenerationCliOptions(
  args: readonly string[],
): C6FlatSummaryGenerationCliOptions {
  let mode: C6FlatSummaryGenerationCliOptions["mode"] | undefined;
  const values = new Map<string, string>();
  for (const argument of args) {
    if (
      argument === "--execute" ||
      argument === "--finalize-only"
    ) {
      if (mode !== undefined) {
        throw new Error(
          "exactly one C6 flat-summary generation mode is required",
        );
      }
      mode = argument === "--execute"
        ? "execute"
        : "finalize-only";
      continue;
    }
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null || !OPTION_NAMES.has(match[1]!)) {
      throw new Error(
        `unknown C6 flat-summary generation option ${argument}`,
      );
    }
    const [, name, value] = match;
    if (values.has(name!)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value!.length === 0 || value!.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name!, value!);
  }
  if (mode === undefined) {
    throw new Error(
      "exactly one C6 flat-summary generation mode is required",
    );
  }
  const options = {
    historiesRoot: required(values, "histories-root"),
    mode,
    outputRoot: required(values, "output-root"),
    planPath: required(values, "plan"),
    planSha256: required(values, "plan-sha256"),
    summaryPromptPath: required(values, "summary-prompt"),
    summaryProtocolPath: required(values, "summary-protocol"),
  };
  for (const [name, value] of [
    ["histories-root", options.historiesRoot],
    ["output-root", options.outputRoot],
    ["plan", options.planPath],
    ["summary-prompt", options.summaryPromptPath],
    ["summary-protocol", options.summaryProtocolPath],
  ] as const) {
    if (!isAbsolute(value)) {
      throw new Error(`--${name} must be absolute`);
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(options.planSha256)) {
    throw new Error("--plan-sha256 must be one lowercase SHA-256");
  }
  return options;
}

export async function runC6FlatSummaryGenerationCommand<T =
  C6FlatSummaryGenerationPublication>(
  args: readonly string[],
  dependencies: {
    apiToken: string;
    dispatch?: (
      input: C6FlatSummaryGenerationCommandInput,
    ) => Promise<T>;
  },
): Promise<T> {
  const options = parseC6FlatSummaryGenerationCliOptions(args);
  if (options.mode === "execute") {
    try {
      validateC6FlatSummaryApiToken(dependencies.apiToken);
    } catch {
      throw new Error(
        `${API_KEY_ENVIRONMENT_NAME} API key is required`,
      );
    }
  }
  if (
    options.mode === "finalize-only" &&
    dependencies.apiToken.length > 0
  ) {
    throw new Error(
      "C6 flat-summary finalize-only must not receive an API key",
    );
  }
  const dispatch = dependencies.dispatch ??
    executeC6FlatSummaryGenerationCommand as (
      input: C6FlatSummaryGenerationCommandInput,
    ) => Promise<T>;
  return dispatch({
    apiToken: dependencies.apiToken,
    options,
  });
}

export async function executeC6FlatSummaryGenerationCommand(
  input: C6FlatSummaryGenerationCommandInput,
  transport: C6FlatSummaryTransport = liveTransport,
): Promise<C6FlatSummaryGenerationPublication> {
  const [
    planBytes,
    summaryPromptBytes,
    summaryProtocolBytes,
    histories,
  ] = await Promise.all([
    readC6StableRegularFile(
      input.options.planPath,
      "flat-summary candidate plan",
      128 * 1_024 * 1_024,
      true,
    ),
    readC6StableRegularFile(
      input.options.summaryPromptPath,
      "flat-summary prompt",
      4 * 1_024 * 1_024,
      true,
    ),
    readC6StableRegularFile(
      input.options.summaryProtocolPath,
      "flat-summary protocol",
      4 * 1_024 * 1_024,
      true,
    ),
    loadHistories(input.options.historiesRoot),
  ]);
  if (input.options.mode === "finalize-only") {
    return finalizeC6FlatSummaryGenerationCaptureRoot({
      histories,
      outputRoot: input.options.outputRoot,
      planBytes,
      planSha256: input.options.planSha256,
      summaryPromptBytes,
      summaryProtocolBytes,
    });
  }
  let planValue: unknown;
  try {
    planValue = JSON.parse(planBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("C6 flat-summary candidate plan is not valid JSON");
  }
  return materializeC6FlatSummaryGenerationCaptureToRoot({
    apiToken: input.apiToken,
    endpoint: C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
    histories,
    outputRoot: input.options.outputRoot,
    plan: planValue as C6CandidatePlan,
    planBytes,
    planSha256: input.options.planSha256,
    summaryPromptBytes,
    summaryProtocolBytes,
    transport,
  });
}

async function loadHistories(root: string): Promise<Array<{
  bytes: Uint8Array;
  generationKey: string;
}>> {
  const canonicalRoot = await canonicalExistingDirectory(
    root,
    "flat-summary histories root",
  );
  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  entries.sort((left, right) =>
    compareCodeUnits(left.name, right.name)
  );
  return Promise.all(entries.map(async (entry) => {
    const match = /^([a-f0-9]{64})\.history$/u.exec(entry.name);
    if (
      match === null ||
      !entry.isFile() ||
      entry.isSymbolicLink()
    ) {
      throw new Error(
        "C6 flat-summary histories root contains an unexpected entry",
      );
    }
    const path = join(canonicalRoot, entry.name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        "C6 flat-summary history must be a regular file",
      );
    }
    return {
      bytes: await readC6StableRegularFile(
        path,
        `flat-summary history ${entry.name}`,
        128 * 1_024 * 1_024,
        true,
      ),
      generationKey: match[1]!,
    };
  }));
}

export function createC6FlatSummaryLiveTransport(
  fetchImpl: C6FlatSummaryFetch = fetch,
): C6FlatSummaryTransport {
  return async (request) => {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new C6FlatSummaryTransportBoundaryError(
          "C6 flat-summary transport exceeded its frozen deadline",
          "request-timeout",
        ));
      }, C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS);
    });
    let reader:
      ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await Promise.race([
        fetchImpl(request.url, {
          body: Buffer.from(request.body),
          headers: request.headers,
          method: request.method,
          redirect: "error",
          signal: controller.signal,
        }),
        deadline,
      ]);
      const declaredLength = response.headers.get(
        "content-length",
      );
      if (
        declaredLength !== null &&
        (
          !/^(0|[1-9]\d*)$/u.test(declaredLength) ||
          Number(declaredLength) >
            C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES
        )
      ) {
        await response.body?.cancel();
        throw new C6FlatSummaryTransportBoundaryError(
          "C6 flat-summary response exceeds its frozen byte limit",
          "response-byte-limit-exceeded",
          response.status,
        );
      }
      if (response.body === null) {
        return {
          body: new Uint8Array(),
          status: response.status,
        };
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const next = await Promise.race([
          reader.read(),
          deadline,
        ]);
        if (next.done) {
          break;
        }
        bytes += next.value.byteLength;
        if (bytes > C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES) {
          await reader.cancel();
          reader = undefined;
          throw new C6FlatSummaryTransportBoundaryError(
            "C6 flat-summary response exceeds its frozen byte limit",
            "response-byte-limit-exceeded",
            response.status,
          );
        }
        chunks.push(next.value);
      }
      return {
        body: Buffer.concat(
          chunks.map((chunk) => Buffer.from(chunk)),
          bytes,
        ),
        status: response.status,
      };
    } catch (error) {
      if (timedOut) {
        throw new C6FlatSummaryTransportBoundaryError(
          "C6 flat-summary transport exceeded its frozen deadline",
          "request-timeout",
        );
      }
      throw error;
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (timedOut) {
        await reader?.cancel().catch(() => undefined);
      }
    }
  };
}

const liveTransport = createC6FlatSummaryLiveTransport();

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (import.meta.main) {
  try {
    const options = parseC6FlatSummaryGenerationCliOptions(
      process.argv.slice(2),
    );
    let apiToken = "";
    if (options.mode === "execute") {
      apiToken = process.env[API_KEY_ENVIRONMENT_NAME] ?? "";
      delete process.env[API_KEY_ENVIRONMENT_NAME];
    }
    const result = await executeC6FlatSummaryGenerationCommand({
      apiToken,
      options,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
