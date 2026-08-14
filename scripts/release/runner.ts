import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  checkReleaseEvidenceInputs,
  createReleaseArtifactRef,
  evaluateProductionAudit,
  parsePackedTarEntries,
  sha256,
  summarizeReleaseChecks,
  writeReleaseArtifacts,
} from "./artifact";
import type { ReleaseEvidenceMaterial } from "./artifact";
import type {
  ReleaseCheck,
  ReleaseCommandOutcome,
  ReleaseManifestV1,
  ReleasePreparedArtifact,
  ReleaseProfile,
  ReleaseRunResult,
  ReleaseRuntimeIdentity,
  ReleaseSourceIdentity,
} from "./contracts";
import { satisfiesReleaseRuntimePolicy } from "./profile";
export interface ReleaseRunnerServices {
  prepareArtifact(input: {
    outputDir: string;
    profile: ReleaseProfile;
    repoRoot: string;
    runCommand: ReleaseCommandRunner;
  }): Promise<ReleasePreparedArtifact>;
  runCommand: ReleaseCommandRunner;
}
export type ReleaseCommandRunner = (input: {
  args: readonly string[];
  command: string;
  cwd: string;
  environment?: Readonly<Record<string, string | undefined>>;
}) => Promise<ReleaseCommandOutcome>;
interface SourceCollection {
  check: ReleaseCheck;
  identity: ReleaseSourceIdentity;
}
const SHA1_PATTERN = /^[0-9a-f]{40}$/u;
function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function failedCheck(input: {
  detail: string;
  id: string;
  required?: boolean;
  startedAt: number;
  title: string;
}): ReleaseCheck {
  return {
    detail: input.detail,
    durationMs: elapsed(input.startedAt),
    evidenceArtifactIds: [],
    id: input.id,
    required: input.required ?? true,
    status: "fail",
    title: input.title,
  };
}
function passCheck(input: {
  detail: string;
  durationMs?: number;
  evidenceArtifactIds?: string[];
  id: string;
  required?: boolean;
  startedAt?: number;
  title: string;
}): ReleaseCheck {
  return {
    detail: input.detail,
    durationMs: input.durationMs ?? elapsed(input.startedAt ?? performance.now()),
    evidenceArtifactIds: input.evidenceArtifactIds ?? [],
    id: input.id,
    required: input.required ?? true,
    status: "pass",
    title: input.title,
  };
}
export const runReleaseCommand: ReleaseCommandRunner = async (input) => {
  const startedAt = performance.now();
  const environment = { ...process.env, ...input.environment };
  if (input.command === "git") {
    delete environment.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    delete environment.GIT_COMMON_DIR;
    delete environment.GIT_DIR;
    delete environment.GIT_INDEX_FILE;
    delete environment.GIT_OBJECT_DIRECTORY;
    delete environment.GIT_WORK_TREE;
  }
  const child = Bun.spawn({
    cmd: [input.command, ...input.args],
    cwd: input.cwd,
    env: environment,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return {
    code,
    durationMs: elapsed(startedAt),
    stderr,
    stdout,
  };
};
function cleanOutput(outcome: ReleaseCommandOutcome): string {
  return (outcome.stderr || outcome.stdout)
    .trimEnd()
    .split(/\r?\n/u)
    .slice(-40)
    .join("\n");
}
async function collectSourceIdentity(input: {
  repoRoot: string;
  runCommand: ReleaseCommandRunner;
}): Promise<SourceCollection> {
  const startedAt = performance.now();
  const [commit, status, tree] = await Promise.all([
    input.runCommand({
      args: ["rev-parse", "HEAD"],
      command: "git",
      cwd: input.repoRoot,
    }),
    input.runCommand({
      args: ["status", "--porcelain", "--untracked-files=all"],
      command: "git",
      cwd: input.repoRoot,
    }),
    input.runCommand({
      args: ["rev-parse", "HEAD^{tree}"],
      command: "git",
      cwd: input.repoRoot,
    }),
  ]);
  const identity = {
    clean: status.code === 0 && status.stdout.trim().length === 0,
    commit: commit.code === 0 ? commit.stdout.trim() : "",
    tag: null,
    tree: tree.code === 0 ? tree.stdout.trim() : "",
  };
  const issues = [
    ...(commit.code === 0 && SHA1_PATTERN.test(identity.commit)
      ? []
      : [cleanOutput(commit) || "cannot resolve HEAD"]),
    ...(tree.code === 0 && SHA1_PATTERN.test(identity.tree)
      ? []
      : [cleanOutput(tree) || "cannot resolve HEAD tree"]),
    ...(status.code === 0
      ? status.stdout.trim().length === 0
        ? []
        : [`working tree is not clean: ${status.stdout.trim()}`]
      : [cleanOutput(status) || "cannot inspect working tree"]),
  ];
  return {
    check: issues.length === 0
      ? passCheck({
          detail: `clean source ${identity.commit} / ${identity.tree}`,
          id: "source-identity",
          startedAt,
          title: "Exact source identity",
        })
      : failedCheck({
          detail: issues.join("; "),
          id: "source-identity",
          startedAt,
          title: "Exact source identity",
        }),
    identity,
  };
}
async function releaseSourceCheck(input: {
  profile: ReleaseProfile;
  repoRoot: string;
  runCommand: ReleaseCommandRunner;
  source: ReleaseSourceIdentity;
}): Promise<ReleaseCheck> {
  const startedAt = performance.now();
  if (input.profile.package.status === "release-candidate") {
    return passCheck({
      detail: "release-candidate tag identity is not applicable",
      id: "release-source-identity",
      startedAt,
      title: "Release source tag identity",
    });
  }
  const tag = await input.runCommand({
    args: [
      "rev-parse",
      "--verify",
      `refs/tags/v${input.profile.package.version}^{commit}`,
    ],
    command: "git",
    cwd: input.repoRoot,
  });
  const taggedCommit = tag.stdout.trim();
  if (tag.code !== 0 || taggedCommit !== input.source.commit) {
    return failedCheck({
      detail: tag.code === 0
        ? `peeled tag ${taggedCommit} does not match HEAD ${input.source.commit}`
        : cleanOutput(tag) || `missing v${input.profile.package.version} tag`,
      id: "release-source-identity",
      startedAt,
      title: "Release source tag identity",
    });
  }
  return passCheck({
    detail: `clean HEAD matches peeled v${input.profile.package.version} tag`,
    id: "release-source-identity",
    startedAt,
    title: "Release source tag identity",
  });
}
async function runtimeCheck(input: {
  profile: ReleaseProfile;
  repoRoot: string;
  runCommand: ReleaseCommandRunner;
}): Promise<{ check: ReleaseCheck; runtime: ReleaseRuntimeIdentity }> {
  const startedAt = performance.now();
  const [bun, node] = await Promise.all([
    input.runCommand({ args: ["--version"], command: "bun", cwd: input.repoRoot }),
    input.runCommand({ args: ["--version"], command: "node", cwd: input.repoRoot }),
  ]);
  const runtime = {
    bunVersion: bun.code === 0 ? bun.stdout.trim() : "",
    nodeVersion: node.code === 0 ? node.stdout.trim() : "",
  };
  const issues = [
    ...(bun.code === 0 && satisfiesReleaseRuntimePolicy(
      runtime.bunVersion,
      input.profile.runtime.bun,
    )
      ? []
      : [`Bun ${runtime.bunVersion || "unavailable"} does not satisfy ${input.profile.runtime.bun}`]),
    ...(node.code === 0 && satisfiesReleaseRuntimePolicy(
      runtime.nodeVersion,
      input.profile.runtime.node,
    )
      ? []
      : [`Node ${runtime.nodeVersion || "unavailable"} does not satisfy ${input.profile.runtime.node}`]),
  ];
  return {
    check: issues.length === 0
      ? passCheck({
          detail: `Node ${runtime.nodeVersion} / Bun ${runtime.bunVersion}`,
          id: "runtime-identity",
          startedAt,
          title: "Release runtime identity",
        })
      : failedCheck({
          detail: issues.join("; "),
          id: "runtime-identity",
          startedAt,
          title: "Release runtime identity",
        }),
    runtime,
  };
}
function versionCheck(profile: ReleaseProfile): ReleaseCheck {
  const startedAt = performance.now();
  const expectedTarball = `${profile.package.name}-${profile.package.version}.tgz`;
  const valid = profile.package.tarballName === expectedTarball &&
    profile.package.distTag.length > 0 &&
    profile.package.installCommandsApplyAfterPublish;
  return valid
    ? passCheck({
        detail: `${profile.package.status} ${profile.package.name}@${profile.package.version} ` +
          `targets dist-tag ${profile.package.distTag}`,
        id: "version",
        startedAt,
        title: "Version and release metadata",
      })
    : failedCheck({
        detail: "release profile package identity is inconsistent",
        id: "version",
        startedAt,
        title: "Version and release metadata",
      });
}
async function runProfileCheck(input: {
  environment: Readonly<Record<string, string | undefined>>;
  outputDir: string;
  profileCheck: ReleaseProfile["checks"][number];
  repoRoot: string;
  runCommand: ReleaseCommandRunner;
}): Promise<{ check: ReleaseCheck; evidence?: ReleaseEvidenceMaterial }> {
  const check = input.profileCheck;
  if (check.requiredEnvironment &&
    !input.environment[check.requiredEnvironment]?.trim()) {
    return {
      check: {
        detail: `${check.requiredEnvironment} is required for the release gate`,
        durationMs: 0,
        evidenceArtifactIds: [],
        id: check.id,
        required: check.required,
        status: check.required ? "fail" : "skip",
        title: check.title,
      },
    };
  }
  const args = check.args.map((argument) => {
    if (typeof argument === "string") {
      return argument;
    }
    const path = resolve(input.outputDir, argument.outputPath);
    if (relative(input.outputDir, path).startsWith("..")) {
      throw new Error(`release command output escapes output directory: ${argument.outputPath}`);
    }
    return path;
  });
  const generatedEvidencePath = check.generatedEvidence
    ? resolve(input.outputDir, check.generatedEvidence.path)
    : undefined;
  if (generatedEvidencePath) {
    if (relative(input.outputDir, generatedEvidencePath).startsWith("..")) {
      throw new Error("generated evidence path escapes output directory");
    }
    await mkdir(dirname(generatedEvidencePath), { recursive: true });
  }
  const outcome = await input.runCommand({
    args,
    command: check.command,
    cwd: input.repoRoot,
    environment: input.environment,
  });
  let evidence: ReleaseEvidenceMaterial | undefined;
  let detail = outcome.code === 0 ? check.successDetail : cleanOutput(outcome);
  let status = outcome.code === 0 ? "pass" as const : "fail" as const;
  if (status === "pass" && check.generatedEvidence && generatedEvidencePath) {
    try {
      const bytes = await readFile(generatedEvidencePath);
      evidence = {
        bytes,
        ref: createReleaseArtifactRef({
          bytes,
          id: check.generatedEvidence.id,
          kind: "file",
          path: check.generatedEvidence.path,
          tracked: false,
        }),
      };
    } catch (error) {
      detail = `generated evidence missing: ${errorDetail(error)}`;
      status = "fail";
    }
  }
  return { check: {
    detail,
    durationMs: outcome.durationMs,
    evidenceArtifactIds: evidence ? [evidence.ref.id] : [],
    id: check.id,
    required: check.required,
    status,
    title: check.title,
  }, ...(evidence ? { evidence } : {}) };
}
function validateProfileIds(profile: ReleaseProfile): void {
  const builtInIds = [
    "source-identity",
    "runtime-identity",
    "release-source-identity",
    "version",
    "pack",
    "language-consumers",
    "source-stability",
  ];
  const ids = [
    ...builtInIds,
    ...profile.evidenceInputs.map((evidence) => evidence.checkId),
    ...profile.checks.map((check) => check.id),
  ];
  if (new Set(ids).size !== ids.length) {
    throw new Error("release profile contains duplicate check ids");
  }
  const evidenceIds = profile.evidenceInputs.map((entry) => entry.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error("release profile contains duplicate evidence ids");
  }
}
function sourceStabilityCheck(input: {
  final: SourceCollection;
  initial: SourceCollection;
}): ReleaseCheck {
  const startedAt = performance.now();
  const stable = input.initial.check.status === "pass" &&
    input.final.check.status === "pass" &&
    input.initial.identity.commit === input.final.identity.commit &&
    input.initial.identity.tree === input.final.identity.tree;
  return stable
    ? passCheck({
        detail: "source commit, tree, and clean status remained stable",
        id: "source-stability",
        startedAt,
        title: "Source identity stability",
      })
    : failedCheck({
        detail: `source changed from ${input.initial.identity.commit}/` +
          `${input.initial.identity.tree} to ${input.final.identity.commit}/` +
          `${input.final.identity.tree}`,
        id: "source-stability",
        startedAt,
        title: "Source identity stability",
      });
}
async function validateConsumers(input: {
  artifactPath: string;
  profile: ReleaseProfile;
  runCommand: ReleaseCommandRunner;
}): Promise<ReleaseCheck> {
  const startedAt = performance.now();
  const root = await mkdtemp(join(tmpdir(), "goodmemory-release-consumer-"));
  try {
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({
        dependencies: { [input.profile.package.name]: `file:${input.artifactPath}` },
        private: true,
        type: "module",
      }, null, 2)}\n`,
    );
    await writeFile(join(root, "smoke.mjs"), input.profile.artifact.consumerSmoke);
    const install = await input.runCommand({
      args: ["install", "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund"],
      command: "npm",
      cwd: root,
    });
    if (install.code !== 0) {
      throw new Error(cleanOutput(install));
    }
    const audit = await input.runCommand({
      args: ["audit", "--omit=dev", "--audit-level=high", "--json"],
      command: "npm",
      cwd: root,
    });
    const issues = evaluateProductionAudit(audit.stdout, audit.code);
    for (const [command, args] of [
      ["node", ["smoke.mjs"]],
      ["bun", ["run", "smoke.mjs"]],
    ] as const) {
      const smoke = await input.runCommand({ args, command, cwd: root });
      if (smoke.code !== 0 || !smoke.stdout.includes("LANGUAGE_CONSUMER_OK")) {
        issues.push(`${command} consumer: ${cleanOutput(smoke)}`);
      }
    }
    return issues.length === 0
      ? passCheck({
          detail: "the exact tarball passed production audit and Node/Bun consumer smoke",
          evidenceArtifactIds: ["release-tarball"],
          id: "language-consumers",
          startedAt,
          title: "Node and Bun packed LanguagePack consumers",
        })
      : failedCheck({
          detail: issues.join("; "),
          id: "language-consumers",
          startedAt,
          title: "Node and Bun packed LanguagePack consumers",
        });
  } catch (error) {
    return failedCheck({
      detail: errorDetail(error),
      id: "language-consumers",
      startedAt,
      title: "Node and Bun packed LanguagePack consumers",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
export async function prepareReleaseArtifact(input: {
  outputDir: string;
  profile: ReleaseProfile;
  repoRoot: string;
  runCommand: ReleaseCommandRunner;
}): Promise<ReleasePreparedArtifact> {
  const startedAt = performance.now();
  await mkdir(input.outputDir, { recursive: true });
  const packed = await input.runCommand({
    args: ["pm", "pack", "--destination", input.outputDir, "--quiet"],
    command: "bun",
    cwd: input.repoRoot,
  });
  if (packed.code !== 0) {
    throw new Error(cleanOutput(packed) || "bun pm pack failed");
  }
  const packedPath = packed.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tgz"))
    .at(-1);
  if (!packedPath) {
    throw new Error("bun pm pack did not report a tarball");
  }
  const artifactPath = resolve(
    packedPath.startsWith("/") ? packedPath : join(input.outputDir, packedPath),
  );
  if (
    relative(resolve(input.outputDir), artifactPath).startsWith("..") ||
    basename(artifactPath) !== input.profile.package.tarballName
  ) {
    throw new Error(`unexpected release tarball ${artifactPath}`);
  }
  const initialBytes = await readFile(artifactPath);
  const issues: string[] = [];
  if (initialBytes.byteLength >= input.profile.artifact.maxTarballBytes) {
    issues.push(
      `compressed tarball ${initialBytes.byteLength} bytes must be below ` +
        `${input.profile.artifact.maxTarballBytes} bytes`,
    );
  }
  const listing = await input.runCommand({
    args: ["-tzf", artifactPath],
    command: "tar",
    cwd: input.outputDir,
  });
  if (listing.code !== 0) {
    issues.push(cleanOutput(listing));
  }
  const files = parsePackedTarEntries(listing.stdout);
  const present = new Set(files);
  const missing = input.profile.artifact.requiredFiles.filter(
    (path) => !present.has(path),
  );
  if (missing.length > 0) {
    issues.push(`tarball missing: ${missing.join(", ")}`);
  }
  for (const [path, validate] of [
    ["package/package.json", (value: Record<string, unknown>) =>
      value.name === input.profile.package.name &&
      value.version === input.profile.package.version &&
      JSON.stringify(value.goodmemoryRelease) === JSON.stringify({
        installCommandsApplyAfterPublish:
          input.profile.package.installCommandsApplyAfterPublish,
        npmDistTag: input.profile.package.distTag,
        status: input.profile.package.status,
      })],
    ["package/.well-known/goodmemory.json", (value: Record<string, unknown>) => {
      const release = value.releaseStatus as Record<string, unknown> | undefined;
      return value.version === input.profile.package.version &&
        release?.status === input.profile.package.status &&
        release.npmDistTag === input.profile.package.distTag &&
        release.tarball === input.profile.package.tarballName;
    }],
  ] as const) {
    const extracted = await input.runCommand({
      args: ["-xOf", artifactPath, path],
      command: "tar",
      cwd: input.outputDir,
    });
    try {
      const value = JSON.parse(extracted.stdout) as Record<string, unknown>;
      if (extracted.code !== 0 || !validate(value)) {
        issues.push(`${path} does not match the release profile`);
      }
    } catch {
      issues.push(`${path} is not valid JSON`);
    }
  }
  const integrity = `sha512-${createHash("sha512").update(initialBytes).digest("base64")}`;
  const artifactRef = createReleaseArtifactRef({
    bytes: initialBytes,
    id: "release-tarball",
    integrity,
    kind: "tarball",
    path: input.profile.package.tarballName,
    tracked: false,
  });
  const packCheck = issues.length === 0
    ? passCheck({
        detail: `${files.length} packed files; ${initialBytes.byteLength} compressed bytes`,
        evidenceArtifactIds: [artifactRef.id],
        id: "pack",
        startedAt,
        title: "Package manifest, descriptor, and size",
      })
    : failedCheck({
        detail: issues.join("; "),
        id: "pack",
        startedAt,
        title: "Package manifest, descriptor, and size",
      });
  const consumerCheck = issues.length === 0
    ? await validateConsumers({
        artifactPath,
        profile: input.profile,
        runCommand: input.runCommand,
      })
    : failedCheck({
        detail: "consumer validation did not run because the packed artifact is invalid",
        id: "language-consumers",
        startedAt,
        title: "Node and Bun packed LanguagePack consumers",
      });
  const finalBytes = await readFile(artifactPath);
  if (sha256(finalBytes) !== artifactRef.sha256) {
    throw new Error("release tarball changed during same-artifact validation");
  }
  return { artifactRef, consumerCheck, packCheck, path: artifactPath };
}

const DEFAULT_SERVICES: ReleaseRunnerServices = {
  prepareArtifact: prepareReleaseArtifact,
  runCommand: runReleaseCommand,
};

export async function runReleaseProfile(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  outputDir: string;
  profile: ReleaseProfile;
  repoRoot: string;
  services?: Partial<ReleaseRunnerServices>;
}): Promise<ReleaseRunResult> {
  validateProfileIds(input.profile);
  const repoRoot = resolve(input.repoRoot);
  const outputDir = resolve(input.outputDir);
  const services = { ...DEFAULT_SERVICES, ...input.services };
  const environment = input.environment ?? process.env;
  const checks: ReleaseCheck[] = [];
  const generatedEvidence: ReleaseEvidenceMaterial[] = [];
  const initialSource = await collectSourceIdentity({
    repoRoot,
    runCommand: services.runCommand,
  });
  const runtime = await runtimeCheck({
    profile: input.profile,
    repoRoot,
    runCommand: services.runCommand,
  });
  checks.push(initialSource.check, runtime.check);
  const releaseSource = await releaseSourceCheck({
    profile: input.profile,
    repoRoot,
    runCommand: services.runCommand,
    source: initialSource.identity,
  });
  checks.push(releaseSource, versionCheck(input.profile));
  const capsule = await checkReleaseEvidenceInputs({
    inputs: input.profile.evidenceInputs,
    repoRoot,
    runGit: (args) => services.runCommand({ args, command: "git", cwd: repoRoot }),
  });
  checks.push(...capsule.checks);
  for (const profileCheck of input.profile.checks) {
    const result = await runProfileCheck({
      environment,
      outputDir,
      profileCheck,
      repoRoot,
      runCommand: services.runCommand,
    });
    checks.push(result.check);
    if (result.evidence) {
      generatedEvidence.push(result.evidence);
    }
  }
  let prepared: ReleasePreparedArtifact | undefined;
  try {
    prepared = await services.prepareArtifact({
      outputDir,
      profile: input.profile,
      repoRoot,
      runCommand: services.runCommand,
    });
    checks.push(prepared.packCheck, prepared.consumerCheck);
  } catch (error) {
    const startedAt = performance.now();
    checks.push(
      failedCheck({
        detail: errorDetail(error),
        id: "pack",
        startedAt,
        title: "Package manifest, descriptor, and size",
      }),
      failedCheck({
        detail: "consumer validation did not run because packing failed",
        id: "language-consumers",
        startedAt,
        title: "Node and Bun packed LanguagePack consumers",
      }),
    );
  }
  const finalSource = await collectSourceIdentity({
    repoRoot,
    runCommand: services.runCommand,
  });
  checks.push(sourceStabilityCheck({ final: finalSource, initial: initialSource }));
  const artifacts = [
    ...capsule.evidence.map((entry) => entry.ref),
    ...generatedEvidence.map((entry) => entry.ref),
    ...(prepared ? [prepared.artifactRef] : []),
  ];
  const summary = summarizeReleaseChecks(checks);
  const manifest: ReleaseManifestV1 = {
    allRequiredPassed: checks.every(
      (check) => !check.required || check.status === "pass",
    ),
    artifacts,
    checks,
    package: input.profile.package,
    profileId: input.profile.id,
    runtime: runtime.runtime,
    schemaVersion: "goodmemory.release-manifest.v1",
    source: {
      ...initialSource.identity,
      tag: input.profile.package.status === "stable" && releaseSource.status === "pass" ? `v${input.profile.package.version}` : null,
    },
    summary,
  };
  const written = await writeReleaseArtifacts({
    evidence: [...capsule.evidence, ...generatedEvidence],
    manifest,
    outputDir,
  });
  return {
    ...written,
    manifest,
    ...(prepared ? { tarballPath: prepared.path } : {}),
  };
}
