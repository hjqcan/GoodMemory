import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { resolveCliFlagValueStrict } from "./cli-options";
import type { V07RuntimeIdentity } from "./run-v0-7-release-readiness";
import {
  collectV07SourceIdentity,
  evaluateV07RuntimeVersions,
  verifyV07ArtifactConsumers,
} from "./run-v0-7-release-readiness";

const RELEASE_VERSION = "0.7.4";

export interface V07PrepublishArtifactEvidence {
  artifactName: string;
  artifactPath: string;
  generatedBy: "scripts/verify-v0-7-release-artifact.ts";
  integrity: string;
  runtime: V07RuntimeIdentity;
  sourceCommit: string;
  sourceTree: string;
  version: typeof RELEASE_VERSION;
}

export function buildV07PrepublishEvidence(input: {
  artifactBytes: Uint8Array;
  artifactPath: string;
  runtime: V07RuntimeIdentity;
  sourceCommit: string;
  sourceTree: string;
}): V07PrepublishArtifactEvidence {
  const sourceCommit = input.sourceCommit.trim();
  if (!/^[0-9a-f]{40}$/iu.test(sourceCommit)) {
    throw new Error("A full 40-character source commit is required.");
  }
  const sourceTree = input.sourceTree.trim();
  if (!/^[0-9a-f]{40}$/iu.test(sourceTree)) {
    throw new Error("A full 40-character source tree is required.");
  }
  const runtimeCheck = evaluateV07RuntimeVersions(input.runtime);
  if (runtimeCheck.status !== "pass") {
    throw new Error(runtimeCheck.detail);
  }
  const artifactPath = resolve(input.artifactPath);
  const artifactName = basename(artifactPath);
  if (artifactName !== `goodmemory-${RELEASE_VERSION}.tgz`) {
    throw new Error(`Expected goodmemory-${RELEASE_VERSION}.tgz, got ${artifactName}.`);
  }
  return {
    artifactName,
    artifactPath,
    generatedBy: "scripts/verify-v0-7-release-artifact.ts",
    integrity: `sha512-${createHash("sha512")
      .update(input.artifactBytes)
      .digest("base64")}`,
    runtime: input.runtime,
    sourceCommit,
    sourceTree,
    version: RELEASE_VERSION,
  };
}

function requiredFlag(argv: readonly string[], name: string): string {
  const value = resolveCliFlagValueStrict(argv, name)?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

if (import.meta.main) {
  const artifactPath = resolve(requiredFlag(Bun.argv, "--artifact"));
  const sourceCommit = requiredFlag(Bun.argv, "--source-commit");
  const sourceTree = requiredFlag(Bun.argv, "--source-tree");
  const expectedIntegrity = requiredFlag(Bun.argv, "--expected-integrity");
  const runtime = await verifyV07ArtifactConsumers({
    artifactPath,
    repoRoot: process.cwd(),
  });
  const cleanSource = await collectV07SourceIdentity(process.cwd());
  if (cleanSource.check.status !== "pass") {
    throw new Error(
      `Prepublish verification requires clean source: ${cleanSource.check.detail}`,
    );
  }
  if (
    cleanSource.sourceIdentity.commitSha !== sourceCommit ||
    cleanSource.sourceIdentity.treeSha !== sourceTree
  ) {
    throw new Error("Prepublish source identity does not match the clean checkout.");
  }
  const evidence = buildV07PrepublishEvidence({
    artifactBytes: await readFile(artifactPath),
    artifactPath,
    runtime,
    sourceCommit,
    sourceTree,
  });
  if (evidence.integrity !== expectedIntegrity) {
    throw new Error("Release artifact integrity does not match the packed artifact.");
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
