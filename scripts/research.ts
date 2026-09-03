#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  rm,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import {
  resolveCleanGitSourceIdentity,
  verifyGitSourceStability,
  withGitSourceCheckout,
} from "./proof/git";
import type {
  LegacySourceV4Projection,
} from "./research/c6/legacy-inputs/source-v4";
import {
  activeResearchProtocols,
  findActiveResearchProtocol,
  loadResearchProtocolRegistry,
} from "./research/registry";
import type {
  ResearchProtocol,
} from "./research/registry";

const execFileAsync = promisify(execFile);
const SOURCE_V4_PROTOCOL_ID =
  "goodmemory-c6-codex-coding-effect-source-v4-bounded-v1";
const LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID =
  "goodmemory-longmemeval-v1-ku-temporal-source-paired-diagnostic-v1";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const legacySourceV4Adapter =
  "scripts/research/c6/legacy-inputs/source-v4.ts";

export async function runResearchCommand(
  argv: readonly string[],
): Promise<unknown> {
  const [command, id, ...options] = argv;
  const registry = await loadResearchProtocolRegistry();
  if (command === "list" && id === undefined && options.length === 0) {
    return activeResearchProtocols(registry).map((protocol) => ({
      id: protocol.id,
      status: protocol.status,
    }));
  }
  if (
    (command !== "run" && command !== "verify") ||
    id === undefined
  ) {
    throw new Error("usage: research.ts list | run|verify <id> [--root <path>]");
  }
  const protocol = findActiveResearchProtocol(registry, id);
  const preflight = resolveSnapshotRoot(options, protocol);
  if (preflight.status === "preflight-blocked") {
    return preflight;
  }
  const snapshotRoot = preflight.snapshotRoot;
  if (protocol.id === LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID) {
    return executeLongMemEvalV1SourcePairedProtocol(
      command,
      protocol,
      snapshotRoot,
    );
  }
  const executionSourceIdentity = await resolveCleanGitSourceIdentity(
    repositoryRoot,
  );
  const legacy = await withGitSourceCheckout(
    repositoryRoot,
    protocol.inputSourceIdentity,
    async (checkoutRoot) => {
      await installBoundDependencies(checkoutRoot);
      await verifyGitSourceStability(
        checkoutRoot,
        protocol.inputSourceIdentity,
      );
      const projection = await loadBoundLegacyProjection(
        checkoutRoot,
        snapshotRoot,
      );
      await verifyGitSourceStability(
        checkoutRoot,
        protocol.inputSourceIdentity,
      );
      if (command === "verify") {
        await runExactHistoricalGates(protocol, snapshotRoot, checkoutRoot);
        await verifyGitSourceStability(
          checkoutRoot,
          protocol.inputSourceIdentity,
        );
      }
      return projection;
    },
  );
  const result = await executeProtocol(
    command,
    protocol,
    snapshotRoot,
    legacy,
  );
  await verifyGitSourceStability(repositoryRoot, executionSourceIdentity);
  return {
    executionSourceIdentity,
    inputSourceIdentity: protocol.inputSourceIdentity,
    protocolId: protocol.id,
    result,
  };
}

async function executeLongMemEvalV1SourcePairedProtocol(
  command: "run" | "verify",
  protocol: ResearchProtocol,
  root: string,
): Promise<unknown> {
  const sourcePaired = await import(
    "./research/longmemeval-v1/source-paired"
  );
  if (
    protocol.runEntrypoint !==
      "scripts/research/longmemeval-v1/source-paired.ts#runLongMemEvalV1SourcePairedDiagnostic" ||
    protocol.verifyEntrypoint !==
      "scripts/research/longmemeval-v1/source-paired.ts#verifyLongMemEvalV1SourcePairedDiagnostic" ||
    protocol.historicalGateEntrypoints.length !== 0 ||
    !isDeepStrictEqual(
      protocol.inputSourceIdentity,
      sourcePaired.LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE,
    ) ||
    !isDeepStrictEqual(
      protocol.canonicalArtifacts,
      [...sourcePaired.LONGMEMEVAL_V1_SOURCE_PAIRED_CANONICAL_ARTIFACTS],
    )
  ) {
    throw new Error("LongMemEval V1 source-paired registry entrypoint mismatch");
  }
  const result = command === "run"
    ? await sourcePaired.runLongMemEvalV1SourcePairedDiagnostic(root)
    : await sourcePaired.verifyLongMemEvalV1SourcePairedDiagnostic(root);
  return {
    inputSourceIdentity: protocol.inputSourceIdentity,
    protocolId: protocol.id,
    result,
  };
}

async function executeProtocol(
  command: "run" | "verify",
  protocol: ResearchProtocol,
  snapshotRoot: string,
  legacy: LegacySourceV4Projection,
): Promise<unknown> {
  switch (protocol.id) {
    case SOURCE_V4_PROTOCOL_ID: {
      const sourceV4 = await import("./research/c6/source-v4-capture");
      assertEntrypoints(protocol);
      return command === "run"
        ? await sourceV4.runSourceV4CaptureProtocol(
            legacy,
            protocol.canonicalArtifacts,
          )
        : await sourceV4.verifySourceV4CaptureProtocol(
            snapshotRoot,
            legacy,
            protocol.canonicalArtifacts,
          );
    }
    default:
      throw new Error(`no executable research protocol ${protocol.id}`);
  }
}

async function runExactHistoricalGates(
  protocol: ResearchProtocol,
  snapshotRoot: string,
  checkoutRoot: string,
): Promise<void> {
  if (
    protocol.historicalGateEntrypoints.some((path) => path.includes("*"))
  ) {
    throw new Error("research gate entrypoints must not contain globs");
  }
  await execFileAsync(
    process.execPath,
    [
      "--no-install",
      "--config=bunfig.phase-73-gates.toml",
      "test",
      ...protocol.historicalGateEntrypoints,
    ],
    {
      cwd: checkoutRoot,
      env: {
        ...buildResearchChildEnvironment(process.env),
        GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT: snapshotRoot,
      },
    },
  );
}

async function installBoundDependencies(checkoutRoot: string): Promise<void> {
  await execFileAsync(
    process.execPath,
    [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--silent",
    ],
    {
      cwd: checkoutRoot,
      env: buildResearchChildEnvironment(process.env),
    },
  );
}

async function loadBoundLegacyProjection(
  checkoutRoot: string,
  snapshotRoot: string,
): Promise<LegacySourceV4Projection> {
  const adapterPath = join(checkoutRoot, legacySourceV4Adapter);
  await mkdir(dirname(adapterPath), { recursive: true });
  await copyFile(
    join(repositoryRoot, legacySourceV4Adapter),
    adapterPath,
    constants.COPYFILE_EXCL,
  );
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--no-install", adapterPath, snapshotRoot],
      {
        cwd: checkoutRoot,
        encoding: "utf8",
        env: buildResearchChildEnvironment(process.env),
      },
    );
    return JSON.parse(stdout) as LegacySourceV4Projection;
  } finally {
    await rm(adapterPath, { force: true });
  }
}

function resolveSnapshotRoot(
  options: readonly string[],
  protocol: ResearchProtocol,
):
  | {
    missingPrerequisites: string[];
    protocolId: string;
    status: "preflight-blocked";
  }
  | {
    snapshotRoot: string;
    status: "ready";
  } {
  let root: string | undefined;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option !== "--root" || root !== undefined) {
      throw new Error(`unknown research option ${JSON.stringify(option)}`);
    }
    root = options[index + 1];
    if (root === undefined || root.length === 0) {
      throw new Error("--root requires a path");
    }
    index += 1;
  }
  const prerequisite = protocol.externalPrerequisites[0];
  const resolved = root ?? (
    prerequisite === undefined
      ? undefined
      : process.env[prerequisite]?.trim()
  );
  if (resolved === undefined || resolved.length === 0) {
    return {
      missingPrerequisites: prerequisite === undefined
        ? ["snapshot-root"]
        : [prerequisite],
      protocolId: protocol.id,
      status: "preflight-blocked",
    };
  }
  return {
    snapshotRoot: resolve(resolved),
    status: "ready",
  };
}

export function buildResearchChildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => name !== "BUN_OPTIONS" && !name.startsWith("GIT_"),
    ),
  );
}

function assertEntrypoints(protocol: ResearchProtocol): void {
  if (
    protocol.runEntrypoint !==
      "scripts/research/c6/source-v4-capture.ts#runSourceV4CaptureProtocol" ||
    protocol.verifyEntrypoint !==
      "scripts/research/c6/source-v4-capture.ts#verifySourceV4CaptureProtocol"
  ) {
    throw new Error("source-v4 registry entrypoint mismatch");
  }
}

if (import.meta.main) {
  try {
    const result = await runResearchCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (isPreflightBlocked(result)) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "unknown research command failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function isPreflightBlocked(
  result: unknown,
): result is { status: "preflight-blocked" } {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === "preflight-blocked"
  );
}
