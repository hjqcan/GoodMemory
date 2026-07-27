import {
  createHash,
  randomBytes,
} from "node:crypto";
import {
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

export const C6_BUN_FS_LIVENESS_EXECUTABLE_ENV =
  "GOODMEMORY_C6_BUN_LIVENESS_EXECUTABLE";
export const C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM = 7;

const CHILD_RESULT_KIND =
  "c6-bun-fs-liveness-child-result-v2";
const CHILD_START_KIND =
  "c6-bun-fs-liveness-child-start-v2";
const DEFAULT_SEEDS = [
  0x1a2b3c4d,
  0x5e6f7788,
  0x10293847,
] as const;
const MAX_CHILD_RECORD_BYTES = 16 * 1_024;
const REAP_GRACE_MS = 2_000;
const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface C6BunFsLivenessStressInput {
  bunExecutable?: string;
  concurrency: number;
  expectedArch: string;
  expectedBunExecutableSha256: string;
  expectedBunRevision: string;
  expectedBunVersion: string;
  expectedPlatform: NodeJS.Platform;
  expectedScriptSha256: string;
  seeds: readonly number[];
  testFaultMode?:
    | "fail-after-one-work-item"
    | "stall-after-start";
  timeoutMsPerSeed: number;
  workItemsPerSeed: number;
}

export interface C6BunFsLivenessRuntime {
  arch: string;
  bunRevision: string;
  bunVersion: string;
  executable: string;
  executableSha256: string;
  platform: NodeJS.Platform;
  scriptSha256: string;
}

export interface C6BunFsLivenessObservation {
  completedFsPromiseOperations: number;
  completedWorkItems: number;
  durationMs: number;
  exitCode: number | null;
  failureReason: string | null;
  protocolErrors: string[];
  resultSha256: string | null;
  runtime: C6BunFsLivenessRuntime | null;
  seed: number;
  signalCode: NodeJS.Signals | null;
  startSha256: string | null;
  status: "failed" | "passed" | "timed-out";
  stderrTail: string;
  terminationSignalRequested: "SIGKILL" | null;
  timedOut: boolean;
}

export interface C6BunFsLivenessStressReport {
  artifactKind: "c6-bun-fs-liveness-stress-report";
  clean: boolean;
  completedAt: string;
  configuration: {
    concurrency: number;
    fsPromiseOperationsPerSeed: number;
    seedCount: number;
    timeoutMsPerSeed: number;
    workItemsPerSeed: number;
  };
  durationMs: number;
  expected: {
    arch: string;
    bunExecutableSha256: string;
    bunRevision: string;
    bunVersion: string;
    platform: NodeJS.Platform;
    scriptSha256: string;
  };
  observations: C6BunFsLivenessObservation[];
  schemaVersion: 2;
  selectedBunExecutable: string;
  startedAt: string;
}

interface ChildConfiguration {
  challenge: string;
  concurrency: number;
  expectedArch: string;
  expectedBunExecutable: string;
  expectedBunExecutableSha256: string;
  expectedBunRevision: string;
  expectedBunVersion: string;
  expectedPlatform: NodeJS.Platform;
  expectedScriptSha256: string;
  faultMode?:
    | "fail-after-one-work-item"
    | "stall-after-start";
  resultPath: string;
  root: string;
  seed: number;
  startPath: string;
  workItems: number;
}

interface ChildStartRecord {
  artifactKind: typeof CHILD_START_KIND;
  challenge: string;
  configuration: {
    concurrency: number;
    requestedFsPromiseOperations: number;
    requestedWorkItems: number;
  };
  runtime: C6BunFsLivenessRuntime;
  schemaVersion: 2;
  seed: number;
}

interface ChildResultRecord {
  artifactKind: typeof CHILD_RESULT_KIND;
  challenge: string;
  completedFsPromiseOperations: number;
  completedWorkItems: number;
  errorMessage: string | null;
  schemaVersion: 2;
  seed: number;
  startSha256: string;
  status: "failed" | "passed";
}

interface LoadedChildRecord<T> {
  record: T;
  sha256: string;
}

class C6BunFsLivenessWorkloadFailure extends Error {
  constructor(
    readonly completedFsPromiseOperations: number,
    readonly completedWorkItems: number,
    error: unknown,
  ) {
    super(errorMessage(error));
    this.name = "C6BunFsLivenessWorkloadFailure";
  }
}

export async function runC6BunFsLivenessStress(
  input: C6BunFsLivenessStressInput,
): Promise<C6BunFsLivenessStressReport> {
  assertStressInput(input);
  const selectedExecutable =
    input.bunExecutable ??
    process.env[C6_BUN_FS_LIVENESS_EXECUTABLE_ENV] ??
    process.execPath;
  const bunExecutable =
    realpathSync(selectedExecutable);
  assertExecutableIdentity(
    bunExecutable,
    input.expectedBunExecutableSha256,
  );
  const sourceBytes = readStableFile(
    SCRIPT_PATH,
    "C6 Bun liveness child source",
  );
  if (
    sha256(sourceBytes) !==
      input.expectedScriptSha256
  ) {
    throw new Error(
      "C6 Bun liveness child script SHA-256 mismatch",
    );
  }

  const startedAt = new Date();
  const startedAtMs = performance.now();
  const temporaryRoot = mkdtempSync(
    join(
      tmpdir(),
      "goodmemory-c6-bun-fs-liveness-",
    ),
  );
  const childScript = join(
    temporaryRoot,
    "c6-bun-fs-liveness-child.ts",
  );
  writeFileSync(childScript, sourceBytes, {
    flag: "wx",
    mode: 0o500,
  });
  const observations: C6BunFsLivenessObservation[] = [];

  try {
    for (const [index, seed] of
      input.seeds.entries()) {
      const seedRoot = join(
        temporaryRoot,
        `${index}-${seed >>> 0}`,
      );
      mkdirSync(seedRoot, { mode: 0o700 });
      writeFileSync(
        join(seedRoot, "payload.bin"),
        `goodmemory-c6-bun-fs-liveness:${seed >>> 0}\n`,
        { flag: "wx", mode: 0o600 },
      );
      try {
        observations.push(await runSeedChild({
          bunExecutable,
          challenge:
            randomBytes(32).toString("hex"),
          childScript,
          concurrency: input.concurrency,
          expectedArch: input.expectedArch,
          expectedBunExecutableSha256:
            input.expectedBunExecutableSha256,
          expectedBunRevision:
            input.expectedBunRevision,
          expectedBunVersion:
            input.expectedBunVersion,
          expectedPlatform:
            input.expectedPlatform,
          expectedScriptSha256:
            input.expectedScriptSha256,
          faultMode: input.testFaultMode,
          root: seedRoot,
          seed: seed >>> 0,
          timeoutMs: input.timeoutMsPerSeed,
          workItems: input.workItemsPerSeed,
        }));
      } finally {
        rmSync(seedRoot, {
          force: true,
          recursive: true,
        });
      }
    }
    assertExecutableIdentity(
      bunExecutable,
      input.expectedBunExecutableSha256,
    );
    if (
      sha256(readStableFile(
        childScript,
        "C6 Bun liveness copied child source",
      )) !== input.expectedScriptSha256
    ) {
      throw new Error(
        "C6 Bun liveness copied child script changed",
      );
    }
  } finally {
    rmSync(temporaryRoot, {
      force: true,
      recursive: true,
    });
  }

  return {
    artifactKind:
      "c6-bun-fs-liveness-stress-report",
    clean:
      observations.length === input.seeds.length &&
      observations.every(
        (observation) =>
          observation.status === "passed",
      ),
    completedAt: new Date().toISOString(),
    configuration: {
      concurrency: input.concurrency,
      fsPromiseOperationsPerSeed:
        input.workItemsPerSeed *
        C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
      seedCount: input.seeds.length,
      timeoutMsPerSeed: input.timeoutMsPerSeed,
      workItemsPerSeed: input.workItemsPerSeed,
    },
    durationMs: performance.now() - startedAtMs,
    expected: {
      arch: input.expectedArch,
      bunExecutableSha256:
        input.expectedBunExecutableSha256,
      bunRevision: input.expectedBunRevision,
      bunVersion: input.expectedBunVersion,
      platform: input.expectedPlatform,
      scriptSha256: input.expectedScriptSha256,
    },
    observations,
    schemaVersion: 2,
    selectedBunExecutable: bunExecutable,
    startedAt: startedAt.toISOString(),
  };
}

interface RunSeedChildInput {
  bunExecutable: string;
  challenge: string;
  childScript: string;
  concurrency: number;
  expectedArch: string;
  expectedBunExecutableSha256: string;
  expectedBunRevision: string;
  expectedBunVersion: string;
  expectedPlatform: NodeJS.Platform;
  expectedScriptSha256: string;
  faultMode?:
    | "fail-after-one-work-item"
    | "stall-after-start";
  root: string;
  seed: number;
  timeoutMs: number;
  workItems: number;
}

async function runSeedChild(
  input: RunSeedChildInput,
): Promise<C6BunFsLivenessObservation> {
  const startedAt = performance.now();
  const startPath = join(input.root, "start.json");
  const resultPath = join(input.root, "result.json");
  const command = [
    input.bunExecutable,
    input.childScript,
    "--child",
    "--challenge",
    input.challenge,
    "--root",
    input.root,
    "--seed",
    String(input.seed),
    "--work-items",
    String(input.workItems),
    "--concurrency",
    String(input.concurrency),
    "--expected-arch",
    input.expectedArch,
    "--expected-bun-executable",
    input.bunExecutable,
    "--expected-bun-executable-sha256",
    input.expectedBunExecutableSha256,
    "--expected-bun-revision",
    input.expectedBunRevision,
    "--expected-bun-version",
    input.expectedBunVersion,
    "--expected-platform",
    input.expectedPlatform,
    "--expected-script-sha256",
    input.expectedScriptSha256,
    "--start-path",
    startPath,
    "--result-path",
    resultPath,
  ];
  if (input.faultMode !== undefined) {
    command.push(
      "--fault-mode",
      input.faultMode,
    );
  }

  try {
    const child = Bun.spawn({
      cmd: command,
      cwd: REPOSITORY_ROOT,
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    });
    const exitPromise = Promise.resolve(
      child.exited,
    );
    const initialExit = await settleWithin(
      exitPromise,
      input.timeoutMs,
    );
    let terminationSignalRequested:
      "SIGKILL" | null = null;
    let timedOut = !initialExit.settled;
    let exitCode = initialExit.settled
      ? initialExit.value
      : null;
    if (timedOut) {
      terminationSignalRequested = "SIGKILL";
      try {
        child.kill("SIGKILL");
      } catch {
        // The bounded reap below still terminates this observation.
      }
      const reaped = await settleWithin(
        exitPromise,
        REAP_GRACE_MS,
      );
      if (reaped.settled) {
        exitCode = reaped.value;
      }
    }

    const protocolErrors: string[] = [];
    const start = loadChildRecord(
      startPath,
      parseChildStartRecord,
      "start",
      protocolErrors,
    );
    const result = loadChildRecord(
      resultPath,
      parseChildResultRecord,
      "result",
      protocolErrors,
    );
    const failureReason = classifyFailure({
      challenge: input.challenge,
      exitCode,
      expected: input,
      protocolErrors,
      result,
      start,
      timedOut,
      timeoutMs: input.timeoutMs,
    });

    return {
      completedFsPromiseOperations:
        result?.record
          .completedFsPromiseOperations ?? 0,
      completedWorkItems:
        result?.record.completedWorkItems ?? 0,
      durationMs:
        performance.now() - startedAt,
      exitCode,
      failureReason,
      protocolErrors,
      resultSha256: result?.sha256 ?? null,
      runtime: start?.record.runtime ?? null,
      seed: input.seed,
      signalCode: child.signalCode,
      startSha256: start?.sha256 ?? null,
      status: timedOut
        ? "timed-out"
        : failureReason === null
          ? "passed"
          : "failed",
      stderrTail: "",
      terminationSignalRequested,
      timedOut,
    };
  } catch (error) {
    return {
      completedFsPromiseOperations: 0,
      completedWorkItems: 0,
      durationMs:
        performance.now() - startedAt,
      exitCode: null,
      failureReason:
        `child spawn failed: ${errorMessage(error)}`,
      protocolErrors: [],
      resultSha256: null,
      runtime: null,
      seed: input.seed,
      signalCode: null,
      startSha256: null,
      status: "failed",
      stderrTail: "",
      terminationSignalRequested: null,
      timedOut: false,
    };
  }
}

function classifyFailure(input: {
  challenge: string;
  exitCode: number | null;
  expected: RunSeedChildInput;
  protocolErrors: readonly string[];
  result: LoadedChildRecord<ChildResultRecord> | null;
  start: LoadedChildRecord<ChildStartRecord> | null;
  timedOut: boolean;
  timeoutMs: number;
}): string | null {
  if (input.timedOut) {
    return `child exceeded the ${input.timeoutMs}ms hard deadline`;
  }
  if (input.protocolErrors.length > 0) {
    return `child record is invalid: ${input.protocolErrors[0]}`;
  }
  if (input.start === null) {
    return "child did not publish its start identity";
  }
  const expectedConfiguration = {
    concurrency: input.expected.concurrency,
    requestedFsPromiseOperations:
      input.expected.workItems *
      C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
    requestedWorkItems:
      input.expected.workItems,
  };
  const expectedRuntime = {
    arch: input.expected.expectedArch,
    bunRevision:
      input.expected.expectedBunRevision,
    bunVersion: input.expected.expectedBunVersion,
    executable: input.expected.bunExecutable,
    executableSha256:
      input.expected
        .expectedBunExecutableSha256,
    platform: input.expected.expectedPlatform,
    scriptSha256:
      input.expected.expectedScriptSha256,
  };
  if (
    input.start.record.challenge !==
      input.challenge ||
    input.start.record.seed !==
      input.expected.seed ||
    JSON.stringify(
      input.start.record.configuration,
    ) !== JSON.stringify(expectedConfiguration)
  ) {
    return "child start identity mismatch";
  }
  if (
    JSON.stringify(input.start.record.runtime) !==
      JSON.stringify(expectedRuntime)
  ) {
    return input.result?.record.errorMessage ??
      "child runtime identity mismatch";
  }
  if (input.exitCode !== 0) {
    return input.result?.record.errorMessage ??
      `child exited with code ${input.exitCode}`;
  }
  if (input.result === null) {
    return "child exited without a result record";
  }
  const expectedOperations =
    input.expected.workItems *
    C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM;
  if (
    input.result.record.challenge !==
      input.challenge ||
    input.result.record.seed !==
      input.expected.seed ||
    input.result.record.startSha256 !==
      input.start.sha256
  ) {
    return "child result identity mismatch";
  }
  if (
    input.result.record.status !== "passed" ||
    input.result.record.errorMessage !== null
  ) {
    return input.result.record.errorMessage ??
      "child reported failure";
  }
  if (
    input.result.record.completedWorkItems !==
      input.expected.workItems ||
    input.result.record
      .completedFsPromiseOperations !==
      expectedOperations
  ) {
    return [
      "child completed an unexpected operation count:",
      `${input.result.record.completedWorkItems}/${input.expected.workItems} work items,`,
      `${input.result.record.completedFsPromiseOperations}/${expectedOperations}`,
      "fs.promises operations",
    ].join(" ");
  }
  return null;
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<
  | { settled: false }
  | { settled: true; value: T }
> {
  let timeout:
    ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<
    { settled: false }
  >((resolvePromise) => {
    timeout = setTimeout(
      () => resolvePromise({ settled: false }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      promise.then((value) => ({
        settled: true as const,
        value,
      })),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function runChild(
  config: ChildConfiguration,
): Promise<void> {
  const runtime: C6BunFsLivenessRuntime = {
    arch: process.arch,
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    executable: realpathSync(process.execPath),
    executableSha256: sha256(
      readStableFile(
        realpathSync(process.execPath),
        "C6 Bun liveness child executable",
      ),
    ),
    platform: process.platform,
    scriptSha256: sha256(
      readStableFile(
        SCRIPT_PATH,
        "C6 Bun liveness executing child source",
      ),
    ),
  };
  const startSha256 = writeChildRecord(
    config.startPath,
    {
      artifactKind: CHILD_START_KIND,
      challenge: config.challenge,
      configuration: {
        concurrency: config.concurrency,
        requestedFsPromiseOperations:
          config.workItems *
          C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
        requestedWorkItems: config.workItems,
      },
      runtime,
      schemaVersion: 2,
      seed: config.seed,
    } satisfies ChildStartRecord,
  );

  try {
    assertChildRuntime(config, runtime);
    if (config.faultMode === "stall-after-start") {
      await new Promise<never>(() => {
        setInterval(() => undefined, 60_000);
      });
    }
    const completed =
      await runChildWorkload(config);
    writeChildRecord(
      config.resultPath,
      {
        artifactKind: CHILD_RESULT_KIND,
        challenge: config.challenge,
        completedFsPromiseOperations:
          completed.completedFsPromiseOperations,
        completedWorkItems:
          completed.completedWorkItems,
        errorMessage: null,
        schemaVersion: 2,
        seed: config.seed,
        startSha256,
        status: "passed",
      } satisfies ChildResultRecord,
    );
  } catch (error) {
    const completed =
      error instanceof C6BunFsLivenessWorkloadFailure
        ? error
        : {
          completedFsPromiseOperations: 0,
          completedWorkItems: 0,
        };
    writeChildRecord(
      config.resultPath,
      {
        artifactKind: CHILD_RESULT_KIND,
        challenge: config.challenge,
        completedFsPromiseOperations:
          completed.completedFsPromiseOperations,
        completedWorkItems:
          completed.completedWorkItems,
        errorMessage: errorMessage(error),
        schemaVersion: 2,
        seed: config.seed,
        startSha256,
        status: "failed",
      } satisfies ChildResultRecord,
    );
    throw error;
  }
}

function assertChildRuntime(
  config: ChildConfiguration,
  runtime: C6BunFsLivenessRuntime,
): void {
  const expected = {
    arch: config.expectedArch,
    bunRevision: config.expectedBunRevision,
    bunVersion: config.expectedBunVersion,
    executable: config.expectedBunExecutable,
    executableSha256:
      config.expectedBunExecutableSha256,
    platform: config.expectedPlatform,
    scriptSha256: config.expectedScriptSha256,
  };
  if (
    JSON.stringify(runtime) !==
      JSON.stringify(expected)
  ) {
    if (
      runtime.bunVersion !==
        config.expectedBunVersion
    ) {
      throw new Error(
        `expected Bun ${config.expectedBunVersion}, got ${runtime.bunVersion}`,
      );
    }
    if (
      runtime.bunRevision !==
        config.expectedBunRevision
    ) {
      throw new Error(
        `expected Bun revision ${config.expectedBunRevision}, got ${runtime.bunRevision}`,
      );
    }
    throw new Error(
      "C6 Bun liveness child runtime identity mismatch",
    );
  }
}

async function runChildWorkload(
  config: ChildConfiguration,
): Promise<{
  completedFsPromiseOperations: number;
  completedWorkItems: number;
}> {
  const filePath = join(
    config.root,
    "payload.bin",
  );
  let completedFsPromiseOperations = 0;
  let completedWorkItems = 0;
  let nextWorkItem = 0;
  let workloadError: unknown;

  const runWorker = async (): Promise<void> => {
    while (
      workloadError === undefined &&
      nextWorkItem < config.workItems
    ) {
      try {
        const ordinal = nextWorkItem;
        nextWorkItem += 1;
        if (
          (
            mix32(config.seed ^ ordinal) &
            0x1f
          ) === 0
        ) {
          await new Promise<void>(
            (resolvePromise) => {
              setImmediate(resolvePromise);
            },
          );
        }

        const fileHandle = await open(
          filePath,
          constants.O_RDONLY |
            (constants.O_NOFOLLOW ?? 0),
        );
        completedFsPromiseOperations += 1;
        try {
          const metadata =
            await fileHandle.stat();
          completedFsPromiseOperations += 1;
          if (!metadata.isFile()) {
            throw new Error(
              "stress payload is not a regular file",
            );
          }
          const payload =
            await fileHandle.readFile();
          completedFsPromiseOperations += 1;
          if (payload.byteLength === 0) {
            throw new Error(
              "stress payload is empty",
            );
          }
        } finally {
          await fileHandle.close();
          completedFsPromiseOperations += 1;
        }

        const directoryHandle = await open(
          config.root,
          constants.O_RDONLY |
            (constants.O_DIRECTORY ?? 0),
        );
        completedFsPromiseOperations += 1;
        try {
          await directoryHandle.sync();
          completedFsPromiseOperations += 1;
        } finally {
          await directoryHandle.close();
          completedFsPromiseOperations += 1;
        }
        completedWorkItems += 1;
        if (
          config.faultMode ===
            "fail-after-one-work-item" &&
          completedWorkItems === 1
        ) {
          throw new Error(
            "forced workload failure after one work item",
          );
        }
      } catch (error) {
        workloadError ??= error;
      }
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          config.concurrency,
          config.workItems,
        ),
      },
      runWorker,
    ),
  );
  if (workloadError !== undefined) {
    throw new C6BunFsLivenessWorkloadFailure(
      completedFsPromiseOperations,
      completedWorkItems,
      workloadError,
    );
  }
  return {
    completedFsPromiseOperations,
    completedWorkItems,
  };
}

function loadChildRecord<T>(
  path: string,
  parse: (value: unknown) => T,
  label: string,
  errors: string[],
): LoadedChildRecord<T> | null {
  try {
    const bytes = readStableFile(
      path,
      `C6 Bun liveness child ${label}`,
      MAX_CHILD_RECORD_BYTES,
    );
    const text = new TextDecoder(
      "utf-8",
      { fatal: true },
    ).decode(bytes);
    const value = JSON.parse(text) as unknown;
    const record = parse(value);
    if (text !== canonicalJson(record)) {
      throw new Error(
        `${label} record is not canonical JSON`,
      );
    }
    return {
      record,
      sha256: sha256(bytes),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    errors.push(errorMessage(error));
    return null;
  }
}

function parseChildStartRecord(
  value: unknown,
): ChildStartRecord {
  assertRecord(
    value,
    [
      "artifactKind",
      "challenge",
      "configuration",
      "runtime",
      "schemaVersion",
      "seed",
    ],
    "start",
  );
  assertRecord(
    value.configuration,
    [
      "concurrency",
      "requestedFsPromiseOperations",
      "requestedWorkItems",
    ],
    "start configuration",
  );
  assertRecord(
    value.runtime,
    [
      "arch",
      "bunRevision",
      "bunVersion",
      "executable",
      "executableSha256",
      "platform",
      "scriptSha256",
    ],
    "start runtime",
  );
  if (
    value.artifactKind !== CHILD_START_KIND ||
    value.schemaVersion !== 2 ||
    !isSha256(value.challenge) ||
    !isUnsignedInteger(value.seed) ||
    !isPositiveInteger(
      value.configuration.concurrency,
    ) ||
    !isPositiveInteger(
      value.configuration
        .requestedFsPromiseOperations,
    ) ||
    !isPositiveInteger(
      value.configuration.requestedWorkItems,
    ) ||
    typeof value.runtime.arch !== "string" ||
    typeof value.runtime.bunRevision !==
      "string" ||
    typeof value.runtime.bunVersion !==
      "string" ||
    typeof value.runtime.executable !==
      "string" ||
    !isSha256(
      value.runtime.executableSha256,
    ) ||
    typeof value.runtime.platform !==
      "string" ||
    !isSha256(value.runtime.scriptSha256)
  ) {
    throw new Error(
      "invalid C6 Bun liveness child start record",
    );
  }
  return value as unknown as ChildStartRecord;
}

function parseChildResultRecord(
  value: unknown,
): ChildResultRecord {
  assertRecord(
    value,
    [
      "artifactKind",
      "challenge",
      "completedFsPromiseOperations",
      "completedWorkItems",
      "errorMessage",
      "schemaVersion",
      "seed",
      "startSha256",
      "status",
    ],
    "result",
  );
  if (
    value.artifactKind !== CHILD_RESULT_KIND ||
    value.schemaVersion !== 2 ||
    !isSha256(value.challenge) ||
    !isUnsignedInteger(value.seed) ||
    !isUnsignedInteger(
      value.completedFsPromiseOperations,
    ) ||
    !isUnsignedInteger(
      value.completedWorkItems,
    ) ||
    (
      value.errorMessage !== null &&
      typeof value.errorMessage !== "string"
    ) ||
    !isSha256(value.startSha256) ||
    (
      value.status !== "failed" &&
      value.status !== "passed"
    )
  ) {
    throw new Error(
      "invalid C6 Bun liveness child result record",
    );
  }
  return value as unknown as ChildResultRecord;
}

function writeChildRecord(
  path: string,
  value: ChildResultRecord | ChildStartRecord,
): string {
  const serialized = canonicalJson(value);
  const pendingPath = `${path}.pending`;
  writeFileSync(pendingPath, serialized, {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(pendingPath, path);
  return sha256(serialized);
}

function readStableFile(
  path: string,
  label: string,
  maxBytes?: number,
): Buffer {
  const before = lstatSync(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile()
  ) {
    throw new Error(
      `${label} must be a regular file`,
    );
  }
  if (
    maxBytes !== undefined &&
    before.size > maxBytes
  ) {
    throw new Error(
      `${label} exceeds ${maxBytes} bytes`,
    );
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    bytes.byteLength !== after.size
  ) {
    throw new Error(
      `${label} changed while being read`,
    );
  }
  return bytes;
}

function assertExecutableIdentity(
  executable: string,
  expectedSha256: string,
): void {
  const metadata = statSync(executable);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o111) === 0 ||
    sha256(readStableFile(
      executable,
      "C6 Bun liveness executable",
    )) !== expectedSha256
  ) {
    throw new Error(
      "C6 Bun liveness executable SHA-256 mismatch",
    );
  }
}

function assertStressInput(
  input: C6BunFsLivenessStressInput,
): void {
  if (input.seeds.length === 0) {
    throw new Error(
      "at least one seed is required",
    );
  }
  for (const seed of input.seeds) {
    assertUnsignedInteger(seed, "seed");
  }
  assertPositiveInteger(
    input.concurrency,
    "concurrency",
  );
  assertPositiveInteger(
    input.timeoutMsPerSeed,
    "timeoutMsPerSeed",
  );
  assertPositiveInteger(
    input.workItemsPerSeed,
    "workItemsPerSeed",
  );
  if (
    !isSha256(
      input.expectedBunExecutableSha256,
    )
  ) {
    throw new Error(
      "expectedBunExecutableSha256 must be SHA-256",
    );
  }
  if (!isSha256(input.expectedScriptSha256)) {
    throw new Error(
      "expectedScriptSha256 must be SHA-256",
    );
  }
}

function assertPositiveInteger(
  value: number,
  label: string,
): void {
  if (!isPositiveInteger(value)) {
    throw new Error(
      `${label} must be a positive integer`,
    );
  }
}

function assertUnsignedInteger(
  value: number,
  label: string,
): void {
  if (!isUnsignedInteger(value)) {
    throw new Error(
      `${label} must be an unsigned integer`,
    );
  }
}

function isPositiveInteger(
  value: unknown,
): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= 0xffff_ffff;
}

function isUnsignedInteger(
  value: unknown,
): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 0xffff_ffff;
}

function isSha256(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    SHA256_PATTERN.test(value);
}

function assertRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      `C6 Bun liveness child ${label} is not an object`,
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some(
      (key, index) => key !== expected[index],
    )
  ) {
    throw new Error(
      `C6 Bun liveness child ${label} keys mismatch`,
    );
  }
}

function parseChildConfiguration(
  args: readonly string[],
): ChildConfiguration {
  const values = parseArguments(args);
  const faultMode =
    values.get("fault-mode")?.[0];
  if (
    faultMode !== undefined &&
    faultMode !==
      "fail-after-one-work-item" &&
    faultMode !== "stall-after-start"
  ) {
    throw new Error(
      `unsupported child fault mode ${faultMode}`,
    );
  }
  const expectedPlatform =
    requiredArgument(values, "expected-platform");
  return {
    challenge:
      sha256Argument(values, "challenge"),
    concurrency:
      positiveIntegerArgument(
        values,
        "concurrency",
      ),
    expectedArch:
      requiredArgument(values, "expected-arch"),
    expectedBunExecutable:
      requiredArgument(
        values,
        "expected-bun-executable",
      ),
    expectedBunExecutableSha256:
      sha256Argument(
        values,
        "expected-bun-executable-sha256",
      ),
    expectedBunRevision:
      requiredArgument(
        values,
        "expected-bun-revision",
      ),
    expectedBunVersion:
      requiredArgument(
        values,
        "expected-bun-version",
      ),
    expectedPlatform:
      expectedPlatform as NodeJS.Platform,
    expectedScriptSha256:
      sha256Argument(
        values,
        "expected-script-sha256",
      ),
    faultMode:
      faultMode as ChildConfiguration["faultMode"],
    resultPath:
      requiredArgument(values, "result-path"),
    root: requiredArgument(values, "root"),
    seed:
      unsignedIntegerArgument(values, "seed"),
    startPath:
      requiredArgument(values, "start-path"),
    workItems:
      positiveIntegerArgument(
        values,
        "work-items",
      ),
  };
}

function parseParentInput(
  args: readonly string[],
): C6BunFsLivenessStressInput {
  const values = parseArguments(args);
  const seedValues = values.get("seed");
  return {
    bunExecutable:
      values.get("bun-executable")?.[0],
    concurrency:
      optionalPositiveIntegerArgument(
        values,
        "concurrency",
        8,
      ),
    expectedArch:
      values.get("expected-arch")?.[0] ??
      process.arch,
    expectedBunExecutableSha256:
      sha256Argument(
        values,
        "expected-bun-executable-sha256",
      ),
    expectedBunRevision:
      values.get(
        "expected-bun-revision",
      )?.[0] ??
      "700fc117a2fd01ac0201deaa6fa69c5557acb04f",
    expectedBunVersion:
      values.get(
        "expected-bun-version",
      )?.[0] ?? "1.3.12",
    expectedPlatform:
      (
        values.get("expected-platform")?.[0] ??
        process.platform
      ) as NodeJS.Platform,
    expectedScriptSha256:
      sha256Argument(
        values,
        "expected-script-sha256",
      ),
    seeds: seedValues === undefined
      ? DEFAULT_SEEDS
      : seedValues.map(
        (value) =>
          parseUnsignedInteger(value, "seed"),
      ),
    timeoutMsPerSeed:
      optionalPositiveIntegerArgument(
        values,
        "timeout-ms-per-seed",
        120_000,
      ),
    workItemsPerSeed:
      optionalPositiveIntegerArgument(
        values,
        "work-items-per-seed",
        100_000,
      ),
  };
}

function parseArguments(
  args: readonly string[],
): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (
    let index = 0;
    index < args.length;
    index += 2
  ) {
    const option = args[index];
    const value = args[index + 1];
    if (
      option === undefined ||
      !option.startsWith("--") ||
      value === undefined
    ) {
      throw new Error(
        `invalid argument sequence near ${option ?? "<end>"}`,
      );
    }
    const key = option.slice(2);
    const existing = values.get(key) ?? [];
    existing.push(value);
    values.set(key, existing);
  }
  return values;
}

function requiredArgument(
  values:
    ReadonlyMap<string, readonly string[]>,
  key: string,
): string {
  const value = values.get(key)?.[0];
  if (value === undefined) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function sha256Argument(
  values:
    ReadonlyMap<string, readonly string[]>,
  key: string,
): string {
  const value = requiredArgument(values, key);
  if (!isSha256(value)) {
    throw new Error(
      `${key} must be SHA-256`,
    );
  }
  return value;
}

function positiveIntegerArgument(
  values:
    ReadonlyMap<string, readonly string[]>,
  key: string,
): number {
  const value = parseUnsignedInteger(
    requiredArgument(values, key),
    key,
  );
  assertPositiveInteger(value, key);
  return value;
}

function unsignedIntegerArgument(
  values:
    ReadonlyMap<string, readonly string[]>,
  key: string,
): number {
  return parseUnsignedInteger(
    requiredArgument(values, key),
    key,
  );
}

function optionalPositiveIntegerArgument(
  values:
    ReadonlyMap<string, readonly string[]>,
  key: string,
  fallback: number,
): number {
  const value = values.get(key)?.[0];
  return value === undefined
    ? fallback
    : positiveIntegerArgument(values, key);
}

function parseUnsignedInteger(
  value: string,
  label: string,
): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(
      `${label} must be an unsigned integer`,
    );
  }
  const parsed = Number(value);
  assertUnsignedInteger(parsed, label);
  return parsed;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(
    mixed ^ (mixed >>> 16),
    0x21f0aaad,
  );
  mixed = Math.imul(
    mixed ^ (mixed >>> 15),
    0x735a2d97,
  );
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

async function runCli(
  args: readonly string[],
): Promise<void> {
  if (args[0] === "--child") {
    const config =
      parseChildConfiguration(args.slice(1));
    try {
      await runChild(config);
    } catch {
      process.exitCode = 1;
    }
    return;
  }

  const report =
    await runC6BunFsLivenessStress(
      parseParentInput(args),
    );
  process.stdout.write(
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (!report.clean) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${errorMessage(error)}\n`,
    );
    process.exitCode = 1;
  }
}
