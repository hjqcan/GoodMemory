import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { basename, join } from "node:path";

import { z } from "zod";

import type { C3BaseHealthEvidence } from "./c3-base-health";
import type { C3HostConfigurationEvidence } from "./c3-host-configuration";
import type {
  BoundaryProcessRequest,
  BoundaryProcessResult,
} from "./process";
import type {
  C3InstalledArmRuntime,
  C3NoMemoryArmRuntime,
} from "./c3-runtime";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitObjectSchema = z.string().regex(/^[a-f0-9]{40}$/u);

const executableSchema = z.object({
  executablePath: z.string().min(1),
  sha256: sha256Schema,
  version: z.string().min(1),
}).strict();

const armPathsSchema = z.object({
  codexHome: z.string().min(1),
  home: z.string().min(1),
  result: z.string().min(1),
  runtime: z.string().min(1),
  workspace: z.string().min(1),
}).strict();

const featureEvidenceSchema = z.object({
  hooks: z.object({
    enabled: z.boolean(),
    maturity: z.string().min(1),
  }).strict(),
  memories: z.object({
    enabled: z.boolean(),
    maturity: z.string().min(1),
  }).strict(),
  outputSha256: sha256Schema,
  rawOutput: z.string().min(1),
}).strict();

const hostPreflightEvidenceSchema = z.object({
  codex: z.object({
    executablePath: z.string().min(1),
    executableSha256: sha256Schema,
    features: z.object({
      goodmemoryInstalled: featureEvidenceSchema,
      noMemory: featureEvidenceSchema,
    }).strict(),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1),
    version: z.string().min(1),
  }).strict(),
  goodmemory: z.object({
    configSha256: sha256Schema,
    executablePath: z.string().min(1),
    executableSha256: sha256Schema,
    hooksSha256: sha256Schema,
    mcpExecutablePath: z.string().min(1),
    mcpExecutableSha256: sha256Schema,
    packageSha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
  hostConfigurationsSha256: sha256Schema,
  networkMode: z.literal("disabled"),
  paths: z.object({
    goodmemoryInstalled: armPathsSchema,
    noMemory: armPathsSchema,
  }).strict(),
  platform: z.object({
    arch: z.string().min(1),
    cpuCount: z.number().int().positive(),
    name: z.string().min(1),
    totalMemoryBytes: z.number().int().positive(),
  }).strict(),
  repository: z.object({
    commit: gitObjectSchema,
    dirtyStatePolicy: z.literal("reject"),
    tree: gitObjectSchema,
  }).strict(),
  schemaVersion: z.literal(1),
  toolchain: z.object({
    bun: executableSchema,
    git: executableSchema,
    node: executableSchema,
    npm: executableSchema,
    python: executableSchema,
  }).strict(),
}).strict().superRefine((evidence, context) => {
  const installedFeatures = evidence.codex.features.goodmemoryInstalled;
  const noMemoryFeatures = evidence.codex.features.noMemory;
  if (
    !installedFeatures.hooks.enabled ||
    installedFeatures.hooks.maturity !== "stable" ||
    installedFeatures.memories.enabled ||
    noMemoryFeatures.hooks.enabled ||
    noMemoryFeatures.hooks.maturity !== "stable" ||
    noMemoryFeatures.memories.enabled ||
    !featureEvidenceMatchesRaw(installedFeatures) ||
    !featureEvidenceMatchesRaw(noMemoryFeatures) ||
    installedFeatures.outputSha256 !== sha256(installedFeatures.rawOutput) ||
    noMemoryFeatures.outputSha256 !== sha256(noMemoryFeatures.rawOutput)
  ) {
    context.addIssue({ code: "custom", message: "invalid Codex feature evidence" });
  }
  const allPaths = Object.values(evidence.paths).flatMap((paths) =>
    Object.values(paths)
  );
  if (new Set(allPaths).size !== allPaths.length) {
    context.addIssue({ code: "custom", message: "C3 host paths are not unique" });
  }
});

export type C3HostPreflightEvidence = z.infer<
  typeof hostPreflightEvidenceSchema
>;

interface C3HostVersionRuntime {
  env: Record<string, string | undefined>;
  plan: { paths: { workspace: string } };
}

interface C3HostVersionProbe {
  args: readonly string[];
  executable: string;
  expectedPrefix?: string;
  runtime: C3HostVersionRuntime;
}

interface C3HostVersionSyncResult {
  exitCode: number | null;
  exitedDueToTimeout?: boolean;
  stderr: Uint8Array;
  stdout: Uint8Array;
}

export async function runC3HostVersionProcess(
  request: BoundaryProcessRequest,
  spawn: (
    request: BoundaryProcessRequest,
  ) => C3HostVersionSyncResult = spawnC3HostVersionProcess,
): Promise<BoundaryProcessResult> {
  const startedAt = performance.now();
  try {
    const result = spawn(request);
    const decoder = new TextDecoder();
    return {
      durationMs: performance.now() - startedAt,
      exitCode: result.exitCode,
      stderr: decoder.decode(result.stderr),
      stdout: decoder.decode(result.stdout),
      timedOut: result.exitedDueToTimeout === true,
    };
  } catch (error) {
    return {
      durationMs: performance.now() - startedAt,
      exitCode: null,
      spawnError: error instanceof Error ? error.message : String(error),
      stderr: "",
      stdout: "",
      timedOut: false,
    };
  }
}

function spawnC3HostVersionProcess(
  request: BoundaryProcessRequest,
): C3HostVersionSyncResult {
  return Bun.spawnSync({
    cmd: [request.executable, ...request.args],
    cwd: request.cwd,
    env: request.env,
    stderr: "pipe",
    stdout: "pipe",
    timeout: request.timeoutMs,
  });
}

export async function collectC3HostExecutablePaths(input: {
  bunExecutable: string;
  npmExecutable: string;
  resolve?: (value: string, label: string) => Promise<string>;
}): Promise<{
  bun: string;
  git: string;
  node: string;
  npm: string;
  python: string;
}> {
  const resolvePath = input.resolve ?? resolveExecutable;
  return {
    bun: await resolvePath(input.bunExecutable, "Bun"),
    git: await resolvePath("git", "Git"),
    node: await resolvePath("node", "Node"),
    npm: await resolvePath(input.npmExecutable, "npm"),
    python: await resolvePath("python3", "Python"),
  };
}

export async function collectC3HostVersionOutputs(input: {
  probes: readonly C3HostVersionProbe[];
  run: (request: BoundaryProcessRequest) => Promise<BoundaryProcessResult>;
}): Promise<string[]> {
  const outputs: string[] = [];
  for (const probe of input.probes) {
    outputs.push(await runVersion(
      input.run,
      probe.executable,
      probe.args,
      probe.runtime,
      probe.expectedPrefix,
    ));
  }
  return outputs;
}

export async function collectC3HostPreflightEvidence(input: {
  baseHealth: {
    goodmemoryInstalled: Pick<C3BaseHealthEvidence, "commit" | "passed" | "tree">;
    noMemory: Pick<C3BaseHealthEvidence, "commit" | "passed" | "tree">;
  };
  bunExecutable: string;
  hostConfigurations: C3HostConfigurationEvidence;
  hostConfigurationsBytes: string;
  installedRuntime: C3InstalledArmRuntime;
  model: string;
  noMemoryRuntime: C3NoMemoryArmRuntime;
  npmExecutable: string;
  reasoningEffort: string;
  runProcess?: (
    request: BoundaryProcessRequest,
  ) => Promise<BoundaryProcessResult>;
}): Promise<C3HostPreflightEvidence> {
  const run = input.runProcess ?? runC3HostVersionProcess;
  const executablePaths = await collectC3HostExecutablePaths({
    bunExecutable: input.bunExecutable,
    npmExecutable: input.npmExecutable,
  });
  const {
    bun: bunPath,
    git: gitPath,
    node: nodePath,
    npm: npmPath,
    python: pythonPath,
  } = executablePaths;
  const mcpExecutablePath = join(
    input.installedRuntime.plan.paths.packagePrefix!,
    "bin",
    "goodmemory-mcp",
  );
  const versionOutputs = await collectC3HostVersionOutputs({
    probes: [
      { args: ["--version"], executable: bunPath, runtime: input.noMemoryRuntime },
      {
        args: ["--version"],
        executable: gitPath,
        expectedPrefix: "git version ",
        runtime: input.noMemoryRuntime,
      },
      {
        args: ["--enable", "hooks", "--disable", "memories", "features", "list"],
        executable: input.installedRuntime.codex.executable,
        runtime: input.installedRuntime,
      },
      {
        args: ["--version"],
        executable: nodePath,
        expectedPrefix: "v",
        runtime: input.noMemoryRuntime,
      },
      {
        args: ["--disable", "hooks", "--disable", "memories", "features", "list"],
        executable: input.noMemoryRuntime.codex.executable,
        runtime: input.noMemoryRuntime,
      },
      { args: ["--version"], executable: npmPath, runtime: input.noMemoryRuntime },
      {
        args: ["--version"],
        executable: pythonPath,
        expectedPrefix: "Python ",
        runtime: input.noMemoryRuntime,
      },
    ],
    run,
  });
  const bunVersion = versionOutputs[0]!;
  const gitVersion = versionOutputs[1]!;
  const installedFeaturesRaw = versionOutputs[2]!;
  const nodeVersion = versionOutputs[3]!;
  const noMemoryFeaturesRaw = versionOutputs[4]!;
  const npmVersion = versionOutputs[5]!;
  const pythonVersion = versionOutputs[6]!;
  const installedBase = input.baseHealth.goodmemoryInstalled;
  const noMemoryBase = input.baseHealth.noMemory;
  if (
    !installedBase.passed ||
    !noMemoryBase.passed ||
    installedBase.commit !== noMemoryBase.commit ||
    installedBase.tree !== noMemoryBase.tree
  ) {
    throw new Error("C3 host preflight requires matching passed base health");
  }
  if (
    input.installedRuntime.codex.executableSha256 !==
      input.noMemoryRuntime.codex.executableSha256 ||
    input.installedRuntime.codex.version !== input.noMemoryRuntime.codex.version
  ) {
    throw new Error("C3 host preflight found Codex identity drift between arms");
  }
  const installedConfig = input.hostConfigurations.arms.goodmemoryInstalled;
  if (
    installedConfig.goodmemoryConfig === null ||
    installedConfig.hooksConfig === null
  ) {
    throw new Error("C3 host preflight is missing installed host configuration");
  }

  return parseC3HostPreflightEvidence({
    codex: {
      executablePath: input.installedRuntime.codex.executable,
      executableSha256: input.installedRuntime.codex.executableSha256,
      features: {
        goodmemoryInstalled: featureEvidence(installedFeaturesRaw),
        noMemory: featureEvidence(noMemoryFeaturesRaw),
      },
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      version: input.installedRuntime.codex.version,
    },
    goodmemory: {
      configSha256: installedConfig.goodmemoryConfig.sourceSha256,
      executablePath: input.installedRuntime.goodmemoryExecutable,
      executableSha256: await sha256File(
        input.installedRuntime.goodmemoryExecutable,
      ),
      hooksSha256: installedConfig.hooksConfig.sourceSha256,
      mcpExecutablePath,
      mcpExecutableSha256: await sha256File(mcpExecutablePath),
      packageSha256: input.installedRuntime.package.sha256,
      version: input.installedRuntime.package.version,
    },
    hostConfigurationsSha256: sha256(input.hostConfigurationsBytes),
    networkMode: "disabled",
    paths: {
      goodmemoryInstalled: projectPaths(input.installedRuntime),
      noMemory: projectPaths(input.noMemoryRuntime),
    },
    platform: {
      arch: arch(),
      cpuCount: cpus().length,
      name: platform(),
      totalMemoryBytes: totalmem(),
    },
    repository: {
      commit: installedBase.commit,
      dirtyStatePolicy: "reject",
      tree: installedBase.tree,
    },
    schemaVersion: 1,
    toolchain: {
      bun: await toolEvidence(bunPath, bunVersion),
      git: await toolEvidence(gitPath, gitVersion),
      node: await toolEvidence(nodePath, nodeVersion),
      npm: await toolEvidence(npmPath, npmVersion),
      python: await toolEvidence(pythonPath, pythonVersion),
    },
  });
}

export function parseC3HostPreflightEvidence(
  value: unknown,
): C3HostPreflightEvidence {
  const result = hostPreflightEvidenceSchema.safeParse(value);
  if (!result.success) {
    throw new Error("invalid C3 host preflight");
  }
  return result.data;
}

export function serializeC3HostPreflightEvidence(
  evidence: C3HostPreflightEvidence,
): string {
  return `${JSON.stringify(parseC3HostPreflightEvidence(evidence), null, 2)}\n`;
}

function featureEvidence(rawOutput: string) {
  return {
    hooks: parseFeature(rawOutput, "hooks"),
    memories: parseFeature(rawOutput, "memories"),
    outputSha256: sha256(rawOutput),
    rawOutput,
  };
}

function parseFeature(
  rawOutput: string,
  name: "hooks" | "memories",
): { enabled: boolean; maturity: string } {
  for (const line of rawOutput.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    if (
      fields[0] === name &&
      fields[1] !== undefined &&
      (fields[2] === "true" || fields[2] === "false")
    ) {
      return {
        enabled: fields[2] === "true",
        maturity: fields[1],
      };
    }
  }
  throw new Error(`Codex feature list does not contain ${name}`);
}

function featureEvidenceMatchesRaw(
  evidence: z.infer<typeof featureEvidenceSchema>,
): boolean {
  try {
    return JSON.stringify(evidence.hooks) ===
        JSON.stringify(parseFeature(evidence.rawOutput, "hooks")) &&
      JSON.stringify(evidence.memories) ===
        JSON.stringify(parseFeature(evidence.rawOutput, "memories"));
  } catch {
    return false;
  }
}

function projectPaths(
  runtime: C3InstalledArmRuntime | C3NoMemoryArmRuntime,
) {
  return {
    codexHome: runtime.plan.paths.codexHome,
    home: runtime.plan.paths.home,
    result: runtime.plan.paths.result,
    runtime: runtime.plan.paths.armRoot,
    workspace: runtime.plan.paths.workspace,
  };
}

async function resolveExecutable(value: string, label: string): Promise<string> {
  const candidate = value.includes("/") || value.includes("\\")
    ? value
    : Bun.which(value);
  if (candidate === null || candidate === undefined) {
    throw new Error(`${label} executable is unavailable`);
  }
  return realpath(candidate);
}

async function runVersion(
  run: (request: BoundaryProcessRequest) => Promise<BoundaryProcessResult>,
  executable: string,
  args: readonly string[],
  runtime: C3HostVersionRuntime,
  expectedPrefix?: string,
): Promise<string> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await run({
      args,
      cwd: runtime.plan.paths.workspace,
      env: runtime.env,
      executable,
      timeoutMs: 60_000,
    });
    if (
      result.spawnError !== undefined ||
      result.timedOut ||
      result.exitCode !== 0
    ) {
      throw new Error(`C3 host preflight command failed: ${basename(executable)}`);
    }
    const output = result.stdout.length > 0 ? result.stdout : result.stderr;
    if (output.trim().length === 0) {
      throw new Error(`C3 host preflight command returned no output: ${basename(executable)}`);
    }
    if (
      expectedPrefix === undefined ||
      output.trimStart().startsWith(expectedPrefix)
    ) {
      return output;
    }
    console.error(JSON.stringify({
      attempt,
      event: "c3_host_version_probe_output_retry",
      executable: basename(executable),
      expectedPrefix,
    }));
  }
  throw new Error(
    `C3 host preflight command returned mismatched output: ${basename(executable)}`,
  );
}

async function toolEvidence(executablePath: string, rawVersion: string) {
  return {
    executablePath,
    sha256: await sha256File(executablePath),
    version: rawVersion.trim(),
  };
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
