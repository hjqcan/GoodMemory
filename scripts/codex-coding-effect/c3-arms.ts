import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { CodexCodingEffectArm } from "./contracts";
import type {
  NativeCanaryInjectionEvent,
  NativeCanaryWritebackEvent,
} from "./native-canary-contracts";

export interface C3ArmPaths {
  armRoot: string;
  cache: string;
  codexHome: string;
  home: string;
  injectionRoot?: string;
  packagePrefix?: string;
  result: string;
  temp: string;
  workspace: string;
}

export interface C3ArmScopes {
  sessionId: string;
  userId: string;
  workspaceId: string;
}

// The baseline arm is either the amnesiac no-memory control or the
// flat-summary comparator (plan 6.2): a hook-only runtime with no GoodMemory
// that injects a compact history summary at the same placements.
export type C3BaselineArm = "flat-summary" | "no-memory";

export interface C3ArmPlan {
  arm: "goodmemory-installed" | C3BaselineArm;
  paths: C3ArmPaths;
  scopes: C3ArmScopes;
}

export type C3InstalledArmPlan = C3ArmPlan & {
  arm: "goodmemory-installed";
};

export type C3NoMemoryArmPlan = C3ArmPlan & {
  arm: "no-memory";
};

export type C3FlatSummaryArmPlan = C3ArmPlan & {
  arm: "flat-summary";
  paths: C3ArmPaths & { injectionRoot: string };
};

export type C3BaselineArmPlan = C3NoMemoryArmPlan | C3FlatSummaryArmPlan;

export interface NoMemoryRuntimeAudit {
  codexHomeEntryNames: string[];
  goodMemoryFileCount: number;
  hookConfigPresent: boolean;
  mcpConfigPresent: boolean;
  passed: boolean;
  preexistingSessionCount: number;
  reasons: string[];
}

export interface InstalledArmCanaryEvaluation {
  failureStage: string | null;
  injectedExpectedMemoryIds: string[];
  passed: boolean;
  reasons: string[];
  stopCursorAdvanced: boolean;
  terminalWritebackStatuses: string[];
}

export function buildFrozenPrehistoryArmPlans(input: {
  episodeId: string;
  repetition: number;
  resultRoot: string;
  runId: string;
  runtimeRoot: string;
  seed: number;
  stageId: string;
  workspaceRoot: string;
}): readonly [C3NoMemoryArmPlan, C3InstalledArmPlan] {
  return buildComparatorArmPlans({ ...input, baselineArm: "no-memory" });
}

export function buildComparatorArmPlans<Baseline extends C3BaselineArm>(input: {
  baselineArm: Baseline;
  episodeId: string;
  repetition: number;
  resultRoot: string;
  runId: string;
  runtimeRoot: string;
  seed: number;
  stageId: string;
  workspaceRoot: string;
}): readonly [Extract<C3BaselineArmPlan, { arm: Baseline }>, C3InstalledArmPlan] {
  const createPlanDetails = (arm: C3ArmPlan["arm"]): Omit<C3ArmPlan, "arm"> => {
    const identity = [
      input.runId,
      input.episodeId,
      input.stageId,
      input.seed,
      input.repetition,
      arm,
    ].join("/");
    const digest = createHash("sha256").update(identity).digest("hex").slice(0, 16);
    const armRoot = join(resolve(input.runtimeRoot), `runtime-${digest}`);
    const workspace = join(
      resolve(input.workspaceRoot),
      `task-${digest}`,
    );
    return {
      paths: {
        armRoot,
        cache: join(armRoot, "cache"),
        codexHome: join(armRoot, "home", ".codex"),
        home: join(armRoot, "home"),
        ...(arm === "flat-summary"
          ? { injectionRoot: join(armRoot, "injection") }
          : {}),
        ...(arm === "goodmemory-installed"
          ? { packagePrefix: join(armRoot, "prefix") }
          : {}),
        result: join(resolve(input.resultRoot), arm),
        temp: join(armRoot, "tmp"),
        workspace,
      },
      scopes: {
        sessionId: `c3-session-${digest}`,
        userId: `c3-user-${digest}`,
        workspaceId: basename(workspace),
      },
    };
  };
  const baseline = {
    arm: input.baselineArm,
    ...createPlanDetails(input.baselineArm),
  } as Extract<C3BaselineArmPlan, { arm: Baseline }>;
  const result = [
    baseline,
    {
      arm: "goodmemory-installed",
      ...createPlanDetails("goodmemory-installed"),
    } satisfies C3InstalledArmPlan,
  ] as const;
  assertPairedArmIsolation(result);
  return result;
}

export function assertPairedArmIsolation(
  plans: readonly C3ArmPlan[],
): void {
  if (
    plans.length !== 2 ||
    (plans[0]?.arm !== "no-memory" && plans[0]?.arm !== "flat-summary") ||
    plans[1]?.arm !== "goodmemory-installed"
  ) {
    throw new Error(
      "C3 paired arms must be ordered no-memory and goodmemory-installed",
    );
  }
  for (const [index, plan] of plans.entries()) {
    for (const other of plans.slice(index + 1)) {
      for (const firstPath of definedPaths(plan.paths)) {
        for (const secondPath of definedPaths(other.paths)) {
          if (pathsOverlap(firstPath, secondPath)) {
            throw new Error("C3 arm paths must be unique and non-overlapping");
          }
        }
      }
    }
  }
  for (const scope of ["sessionId", "userId", "workspaceId"] as const) {
    if (new Set(plans.map((plan) => plan.scopes[scope])).size !== plans.length) {
      throw new Error(`C3 arm ${scope} values must be unique`);
    }
  }
}

export function buildC3CodexArgs(input: {
  arm: C3ArmPlan["arm"];
  model: string;
  prompt: string;
  reasoningEffort: string;
  workspaceRoot: string;
}): string[] {
  // Both hook-carrying arms (installed GoodMemory and the flat-summary
  // comparator) enable native hooks; only the amnesiac control disables them.
  const treatmentArgs = input.arm === "no-memory"
    ? ["--disable", "hooks"]
    : ["--enable", "hooks", "--dangerously-bypass-hook-trust"];
  return [
    ...treatmentArgs,
    "--disable",
    "memories",
    "--ask-for-approval",
    "never",
    "exec",
    "--strict-config",
    "--json",
    "--model",
    input.model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`,
    "--cd",
    input.workspaceRoot,
    input.prompt,
  ];
}

export function normalizeC3CodexArgvForEvidence(
  args: readonly string[],
  input: {
    prompt: string;
    workspaceRoot: string;
  },
): string[] {
  return args.map((value) =>
    value === input.workspaceRoot
      ? "<workspace>"
      : value === input.prompt
      ? "<prompt>"
      : value
  );
}

export function normalizeC3CodexTreatmentArgs(
  args: readonly string[],
): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (
      (value === "--enable" || value === "--disable") &&
      args[index + 1] === "hooks"
    ) {
      index += 1;
      continue;
    }
    if (value === "--dangerously-bypass-hook-trust") {
      continue;
    }
    if (value !== undefined) {
      normalized.push(value);
    }
  }
  return normalized;
}

export function buildInstalledGoodMemorySetupArgs(input: {
  userId: string;
}): string[] {
  return [
    "setup",
    "--recommended",
    "--host",
    "codex",
    "--user-id",
    input.userId,
    "--yes",
    "--json",
  ];
}

export async function auditNoMemoryRuntime(input: {
  codexHome: string;
  home: string;
}): Promise<NoMemoryRuntimeAudit> {
  const codexHomeEntryNames = (await readDirectoryNames(input.codexHome)).sort();
  const sessionsRoot = join(input.codexHome, "sessions");
  const preexistingSessionCount = (await readDirectoryNames(sessionsRoot)).length;
  const hookConfigPresent = codexHomeEntryNames.includes("hooks.json");
  const configPath = join(input.codexHome, "config.toml");
  const config = await readOptionalText(configPath);
  const mcpConfigPresent = config !== null && /\bmcp_servers\b/u.test(config);
  const goodMemoryFileCount = await countTreeEntries(join(input.home, ".goodmemory"));
  const reasons: string[] = [];
  if (hookConfigPresent) {
    reasons.push("Codex hooks.json is present");
  }
  if (mcpConfigPresent) {
    reasons.push("Codex MCP configuration is present");
  }
  if (goodMemoryFileCount > 0) {
    reasons.push("GoodMemory files are present");
  }
  if (preexistingSessionCount > 0) {
    reasons.push("pre-existing Codex sessions are present");
  }
  const unexpectedEntries = codexHomeEntryNames.filter((name) =>
    name !== "auth.json" && name !== "config.toml"
  );
  if (unexpectedEntries.some((name) => name !== "hooks.json")) {
    reasons.push("unexpected Codex home state is present");
  }
  return {
    codexHomeEntryNames,
    goodMemoryFileCount,
    hookConfigPresent,
    mcpConfigPresent,
    passed: reasons.length === 0,
    preexistingSessionCount,
    reasons,
  };
}

export async function auditFlatSummaryRuntime(input: {
  codexHome: string;
  expectedHookConfigSha256: string;
  home: string;
}): Promise<NoMemoryRuntimeAudit> {
  const codexHomeEntryNames = (await readDirectoryNames(input.codexHome)).sort();
  const sessionsRoot = join(input.codexHome, "sessions");
  const preexistingSessionCount = (await readDirectoryNames(sessionsRoot)).length;
  const hookConfigPath = join(input.codexHome, "hooks.json");
  const hookConfig = await readOptionalText(hookConfigPath);
  const hookConfigPresent = hookConfig !== null;
  const configPath = join(input.codexHome, "config.toml");
  const config = await readOptionalText(configPath);
  const mcpConfigPresent = config !== null && /\bmcp_servers\b/u.test(config);
  const goodMemoryFileCount = await countTreeEntries(join(input.home, ".goodmemory"));
  const reasons: string[] = [];
  if (!hookConfigPresent) {
    reasons.push("Codex hooks.json is absent");
  } else if (
    createHash("sha256").update(hookConfig).digest("hex") !==
      input.expectedHookConfigSha256
  ) {
    reasons.push("Codex hooks.json is not the flat-summary hook config");
  }
  if (mcpConfigPresent) {
    reasons.push("Codex MCP configuration is present");
  }
  if (goodMemoryFileCount > 0) {
    reasons.push("GoodMemory files are present");
  }
  if (preexistingSessionCount > 0) {
    reasons.push("pre-existing Codex sessions are present");
  }
  const unexpectedEntries = codexHomeEntryNames.filter((name) =>
    name !== "auth.json" && name !== "config.toml" && name !== "hooks.json"
  );
  if (unexpectedEntries.length > 0) {
    reasons.push("unexpected Codex home state is present");
  }
  return {
    codexHomeEntryNames,
    goodMemoryFileCount,
    hookConfigPresent,
    mcpConfigPresent,
    passed: reasons.length === 0,
    preexistingSessionCount,
    reasons,
  };
}

export function evaluateInstalledArmCanary(input: {
  expectedMemoryIds: readonly string[];
  hostStatus: {
    activationMode: string;
    hookRegistered: boolean;
    mcpRegistered: boolean;
    persistRawTranscript: boolean;
    workspaceStatus: string;
    writebackMode: string;
  };
  injectionEvents: readonly NativeCanaryInjectionEvent[];
  preexistingSessionCount: number;
  sessionDigest: string;
  stopCursorSessionDigests: readonly string[];
  threadId: string;
  writebackEvents: readonly NativeCanaryWritebackEvent[];
}): InstalledArmCanaryEvaluation {
  const reasons: string[] = [];
  let failureStage: string | null = null;
  const fail = (stage: string, reason: string): void => {
    failureStage ??= stage;
    reasons.push(reason);
  };
  if (
    input.hostStatus.activationMode !== "global" ||
    !input.hostStatus.hookRegistered ||
    !input.hostStatus.mcpRegistered ||
    input.hostStatus.workspaceStatus !== "ok" ||
    input.hostStatus.writebackMode !== "selective" ||
    input.hostStatus.persistRawTranscript
  ) {
    fail("goodmemory-setup", "installed GoodMemory profile is not the frozen recommended profile");
  }
  if (input.preexistingSessionCount !== 0) {
    fail("codex-session-isolation", "installed arm reused pre-existing Codex session state");
  }
  if (input.threadId.length === 0) {
    fail("codex-session-isolation", "installed arm did not emit a fresh thread id");
  }
  const injectedExpectedMemoryIds = input.expectedMemoryIds.filter((memoryId) =>
    input.injectionEvents.some((event) =>
      event.sessionDigest === input.sessionDigest &&
      event.decision === "injected" &&
      event.recordIds.includes(memoryId)
    )
  );
  if (injectedExpectedMemoryIds.length !== input.expectedMemoryIds.length) {
    fail("goodmemory-injection", "expected frozen-prehistory memory was not injected");
  }
  const stopCursorAdvanced = input.stopCursorSessionDigests.includes(
    input.sessionDigest,
  );
  if (!stopCursorAdvanced) {
    fail("goodmemory-stop", "native Stop did not advance the current session cursor");
  }
  const terminalWritebackStatuses = [...new Set(
    input.writebackEvents
      .filter((event) =>
        event.sessionDigest === input.sessionDigest &&
        event.command === "turn-end" &&
        ["committed", "dismissed", "failed", "forgotten"].includes(event.status)
      )
      .map((event) => event.status),
  )].sort();
  if (terminalWritebackStatuses.length === 0) {
    fail("goodmemory-stop", "native Stop has no terminal writeback audit event");
  } else if (!terminalWritebackStatuses.includes("committed")) {
    fail("goodmemory-stop", "native Stop writeback did not commit");
  }
  return {
    failureStage,
    injectedExpectedMemoryIds,
    passed: reasons.length === 0,
    reasons,
    stopCursorAdvanced,
    terminalWritebackStatuses,
  };
}

function definedPaths(paths: C3ArmPaths): string[] {
  return Object.values(paths).filter((value): value is string =>
    value !== undefined
  );
}

function pathsOverlap(firstPath: string, secondPath: string): boolean {
  return pathInsideOrEqual(firstPath, secondPath) ||
    pathInsideOrEqual(secondPath, firstPath);
}

function pathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const child = relative(resolve(parentPath), resolve(candidatePath));
  return child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

async function readDirectoryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).map((entry) => entry.name);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function countTreeEntries(path: string): Promise<number> {
  let root;
  try {
    root = await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return 0;
    }
    throw error;
  }
  if (!root.isDirectory()) {
    return 1;
  }
  let count = 1;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    count += entry.isDirectory()
      ? await countTreeEntries(join(path, entry.name))
      : 1;
  }
  return count;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}
