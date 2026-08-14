import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  fingerprintProviderRequest,
  fingerprintProviderRequestSequence,
  fingerprintProviderTransportAttemptLedger,
  serializeProviderResponseTape,
} from "../../scripts/provider-response-tape";
import type { ProviderTapeTransportAttempt } from "../../scripts/provider-response-tape";
import {
  encodeProviderResponseTapeBundle,
  PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY,
} from "../../scripts/provider-response-tape-bundle";
import {
  buildV073PairedCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
} from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
import {
  buildV073ProviderFreeArgs,
  buildV073StageArm,
  routeV073CommandChainThroughTape,
  V073_PROVIDER_STAGE_ORDER,
  V073_SEMANTIC_SEED_RUN_ID,
  V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY,
} from "../../scripts/run-v0-7-3-replacement-protection-gate";
import {
  evaluateV073ReplacementProtection,
  V073_PROVIDER_PREFLIGHT_POLICY,
} from "../../scripts/v0-7-3-replacement-protection";
import { frozenV073LocomoQuestionSelection } from "../fixtures/v0-7-3-locomo-question-selection";

import type { V07ReleaseReadinessReport } from "../../scripts/run-v0-7-release-readiness";
import {
  assertV073MeasurementEvidenceRoot,
  evaluateV07RuntimeVersions,
  evaluateV07ReleaseSourceIdentity,
  evaluateV07SourceIdentity,
  evaluateV07SourceStability,
  evaluateV073LifecycleProtectionArtifact,
  evaluateV073LifecycleProtectionArtifactFile,
  evaluateV073LifecycleProtectionBundle,
  evaluateV073HistoricalSourceLineage,
  evaluateV073LifecycleToProtocolSourceDrift,
  evaluateV073LifecycleProtectionSourceDrift,
  evaluateV073CurrentLocomoClaimState,
  resolveV073MeasuredClaimRecipeRaw,
  evaluateVersionConsistency,
  evaluateV07RequiredEnvironment,
  evaluateV07PackManifest,
  evaluateV07PackedProductionDependencyClosure,
  evaluateV07RequiredChecks,
  isV073ProtocolDependencyPinningExact,
  parseV07ReleaseReadinessCliOptions,
  renderV07LanguageConsumerSmoke,
  renderV07ReleaseSummary,
  summarizeCommandFailureOutput,
  V07_RELEASE_REQUIRED_COMMANDS,
} from "../../scripts/run-v0-7-release-readiness";

const FROZEN_V074_COMMIT = "05d39fcfb8bb6efe6b8065ec3ea8372c15b9c1b8";
const REPOSITORY_ROOT = join(import.meta.dir, "../..");
const CLAIM_RECIPE_RAW = readFileSync(
  new URL(
    "../../reports/release/v0.7/" +
      "v0.7.3-locomo-claim-evidence/claim-recipe-source.json",
    import.meta.url,
  ),
  "utf8",
);
function providerPreflightPlan() {
  return {
    probeOrder: [...V073_PROVIDER_PREFLIGHT_POLICY.probeOrder],
    probes: [
      { attempt: 1, responseKind: "stream-object" as const, status: 200, target: "eval-listwise" as const },
      { attempt: 2, responseKind: "stream-object" as const, status: 200, target: "eval-listwise" as const },
      { attempt: 3, responseKind: "stream-object" as const, status: 200, target: "eval-listwise" as const },
      { attempt: 1, responseKind: "embedding" as const, status: 200, target: "embedding" as const },
      { attempt: 1, responseKind: "chat-json" as const, status: 200, target: "judge" as const },
    ],
    totalRequests: 5,
  };
}

function report(
  overrides: Partial<V07ReleaseReadinessReport> = {},
): V07ReleaseReadinessReport {
  return {
    allRequiredPassed: false,
    checks: [
      {
        detail: "package is 0.7.3",
        durationMs: 1,
        id: "version",
        required: true,
        status: "pass",
        title: "Version consistency",
      },
      {
        detail: "tarball is too large | 4194305 bytes",
        durationMs: 1,
        id: "pack",
        required: true,
        status: "fail",
        title: "Package manifest and size",
      },
    ],
    generatedAt: "2026-07-21T00:00:00.000Z",
    generatedBy: "scripts/run-v0-7-release-readiness.ts",
    packageVersion: "0.7.3",
    runtime: {
      bunVersion: "1.3.14",
      nodeVersion: "v20.19.0",
    },
    sourceIdentity: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    },
    summary: { failed: 1, passed: 1, skipped: 0, total: 2 },
    ...overrides,
  };
}

function evidenceIdentity(path: string, raw: string) {
  return {
    bytes: Buffer.byteLength(raw, "utf8"),
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

function runFixtureGit(repoRoot: string, ...args: string[]): string {
  const env = { ...process.env };
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_DIR;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_WORK_TREE;
  const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot, env });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString().trim();
}

function readFixtureGitObject(repoRoot: string, object: string): string {
  const env = { ...process.env };
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_DIR;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_WORK_TREE;
  const result = Bun.spawnSync(["git", "show", object], { cwd: repoRoot, env });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
}

async function createFrozenV074Checkout(): Promise<{
  repoRoot: string;
  temporaryDirectory: string;
}> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "goodmemory-v074-checkout-"),
  );
  const repoRoot = join(temporaryDirectory, "repo");
  const clone = Bun.spawnSync(
    ["git", "clone", "--quiet", "--shared", "--no-checkout", REPOSITORY_ROOT, repoRoot],
    { cwd: REPOSITORY_ROOT },
  );
  if (clone.exitCode !== 0) {
    throw new Error(clone.stderr.toString());
  }
  runFixtureGit(repoRoot, "checkout", "--quiet", "--detach", FROZEN_V074_COMMIT);
  return { repoRoot, temporaryDirectory };
}

async function createFixtureCommitWithoutPath(
  repoRoot: string,
  path: string,
): Promise<{ commit: string; temporaryDirectory: string }> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "goodmemory-historical-current-"),
  );
  const env: Record<string, string | undefined> = {
    ...process.env,
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_AUTHOR_NAME: "GoodMemory fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "GoodMemory fixture",
    GIT_INDEX_FILE: join(temporaryDirectory, "index"),
  };
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_WORK_TREE;
  const run = (...args: string[]): string => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot, env });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
    return result.stdout.toString().trim();
  };

  run("read-tree", "HEAD");
  run("update-index", "--force-remove", "--", path);
  const tree = run("write-tree");
  const commit = run(
    "commit-tree",
    tree,
    "-p",
    "HEAD",
    "-m",
    "historical readiness fixture without retired source",
  );
  return { commit, temporaryDirectory };
}

describe("v0.7 release readiness", () => {
  it("accepts release metadata with no current benchmark claims", async () => {
    const fixture = await createFrozenV074Checkout();
    try {
      await expect(
        evaluateVersionConsistency(fixture.repoRoot),
      ).resolves.toEqual(expect.objectContaining({ status: "pass" }));
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("keeps the LoCoMo claim boundary paused and current claims empty", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-paused-"));
    try {
      await mkdir(join(repoRoot, "benchmark-claims"), { recursive: true });
      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        JSON.stringify({
          claimBoundary: { publicClaimAllowed: false },
          status: "paused_boundary",
        }),
      );

      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        repoRoot,
      })).resolves.toEqual([]);
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [{ name: "LoCoMo" }],
        repoRoot,
      })).resolves.toContain(
        "0.7.4 has no promotable current benchmark claims",
      );

      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        JSON.stringify({
          claimBoundary: { publicClaimAllowed: true },
          status: "candidate_public_claim",
        }),
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        repoRoot,
      })).resolves.toContain(
        "LoCoMo declaration must remain paused_boundary with publicClaimAllowed false",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("rejects interrupted LoCoMo publication locks without validating audit bundles", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-locomo-lock-"));
    try {
      await mkdir(join(repoRoot, "benchmark-claims/evidence"), { recursive: true });
      await mkdir(join(repoRoot, "reports/release/v0.7"), { recursive: true });
      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        JSON.stringify({
          claimBoundary: { publicClaimAllowed: false },
          status: "paused_boundary",
        }),
      );
      await writeFile(
        join(
          repoRoot,
          "reports/release/v0.7/.v0.7.3-locomo-claim-publication.lock",
        ),
        "",
      );

      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        repoRoot,
      })).resolves.toContain("current LoCoMo publication lock is incomplete");

      await rm(
        join(
          repoRoot,
          "reports/release/v0.7/.v0.7.3-locomo-claim-publication.lock",
        ),
      );
      await writeFile(
        join(
          repoRoot,
          "benchmark-claims/evidence/.locomo-v0.7.3-current.json.partial-run",
        ),
        "",
      );
      await expect(evaluateV073CurrentLocomoClaimState({
        claims: [],
        repoRoot,
      })).resolves.toContain("current LoCoMo publication lock is incomplete");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("pins package, lockfile, capability, and MCP descriptors to the frozen 0.7.4 release source", async () => {
    const fixture = await createFrozenV074Checkout();
    const readJson = (path: string) =>
      JSON.parse(
        readFileSync(join(fixture.repoRoot, path), "utf8"),
      ) as {
        goodmemoryRelease?: { status?: string };
        packages?: Record<string, { version?: string }> | Array<{ version?: string }>;
        releaseStatus?: { npmDistTag?: string; status?: string };
        version?: string;
      };
    try {
      const packageJson = readJson("package.json");
      const packageLock = readJson("package-lock.json");
      const capability = readJson(".well-known/goodmemory.json");
      const server = readJson("server.json");

      expect(packageJson.version).toBe("0.7.4");
      expect(
        ["release-candidate", "stable"].includes(
          packageJson.goodmemoryRelease?.status ?? "",
        ),
      ).toBe(true);
      expect(packageLock.version).toBe("0.7.4");
      expect((packageLock.packages as Record<string, { version?: string }>)[""]?.version).toBe(
        "0.7.4",
      );
      expect(capability.version).toBe("0.7.4");
      expect(capability.releaseStatus).toEqual(expect.objectContaining({
        npmDistTag: "latest",
        status: packageJson.goodmemoryRelease?.status,
      }));
      expect(server.version).toBe("0.7.4");
      expect((server.packages as Array<{ version?: string }>)[0]?.version).toBe("0.7.4");
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("requires the 0.7 migration guide and a compressed tarball below 4 MiB", () => {
    expect(
      evaluateV07PackManifest(
        [
          "dist/index.js",
          "dist/index.d.ts",
          "dist/ai-sdk/index.js",
          "dist/ai-sdk/index.d.ts",
          "dist/host/index.js",
          "dist/host/index.d.ts",
          "dist/http/index.js",
          "dist/http/index.d.ts",
          "dist/runtime-kit/index.js",
          "dist/runtime-kit/index.d.ts",
          "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
          "package.json",
        ],
        4 * 1024 * 1024 - 1,
      ),
    ).toEqual([]);
    expect(
      evaluateV07PackManifest(["dist/index.js", "package.json"], 4 * 1024 * 1024),
    ).toEqual([
      "tarball missing: dist/index.d.ts, dist/ai-sdk/index.js, dist/ai-sdk/index.d.ts, dist/host/index.js, dist/host/index.d.ts, dist/http/index.js, dist/http/index.d.ts, dist/runtime-kit/index.js, dist/runtime-kit/index.d.ts, docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
      "compressed tarball 4194304 bytes must be below 4194304 bytes",
    ]);
  });

  it("rejects a packed production closure with undici or a high npm advisory", () => {
    const cleanLock = JSON.stringify({
      packages: {
        "": { dependencies: { goodmemory: "file:goodmemory-0.7.3.tgz" } },
        "node_modules/goodmemory": { version: "0.7.3" },
      },
    });
    const cleanAudit = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 0, high: 0 },
      },
    });
    expect(evaluateV07PackedProductionDependencyClosure({
      auditExitCode: 0,
      auditRaw: cleanAudit,
      packageLockRaw: cleanLock,
    })).toEqual([]);

    const cleanModernUndiciLock = JSON.stringify({
      packages: {
        "": { dependencies: { goodmemory: "file:goodmemory-0.7.3.tgz" } },
        "node_modules/undici": { version: "8.9.0" },
      },
    });
    expect(evaluateV07PackedProductionDependencyClosure({
      auditExitCode: 0,
      auditRaw: cleanAudit,
      packageLockRaw: cleanModernUndiciLock,
    })).toEqual([]);

    const vulnerableLock = JSON.stringify({
      packages: {
        "": { dependencies: { goodmemory: "file:goodmemory-0.7.3.tgz" } },
        "node_modules/undici": { version: "5.29.0" },
      },
    });
    expect(evaluateV07PackedProductionDependencyClosure({
      auditExitCode: 1,
      auditRaw: JSON.stringify({
        metadata: {
          vulnerabilities: { critical: 0, high: 1 },
        },
      }),
      packageLockRaw: vulnerableLock,
    })).toEqual([
      "packed production dependency closure must not install undici 5.x",
      "packed production dependency audit reported 1 high and 0 critical vulnerabilities",
    ]);
  });

  it("executes every built-in LanguagePack factory in the packed consumer", () => {
    const smoke = renderV07LanguageConsumerSmoke();

    for (const factoryCall of [
      "createEnglishLanguagePack()",
      'createChineseLanguagePack("Hans")',
      'createChineseLanguagePack("Hant")',
      "createJapaneseLanguagePack()",
      "createKoreanLanguagePack()",
      "createFrenchLanguagePack()",
      "createSpanishLanguagePack()",
    ]) {
      expect(smoke).toContain(factoryCall);
    }
  });

  it("binds readiness to one clean commit and tree", () => {
    expect(evaluateV07SourceIdentity({
      commitSha: "a".repeat(40),
      status: "",
      treeSha: "b".repeat(40),
    })).toEqual({
      check: expect.objectContaining({ status: "pass" }),
      sourceIdentity: {
        commitSha: "a".repeat(40),
        treeSha: "b".repeat(40),
      },
    });
    expect(evaluateV07SourceIdentity({
      commitSha: "a".repeat(40),
      status: " M src/index.ts",
      treeSha: "b".repeat(40),
    }).check).toEqual(expect.objectContaining({
      detail: expect.stringContaining("src/index.ts"),
      status: "fail",
    }));
  });

  it("rejects source drift while release checks are running", () => {
    const initial = {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    };
    expect(evaluateV07SourceStability({
      final: {
        check: {
          detail: "clean source",
          durationMs: 0,
          id: "source-identity",
          required: true,
          status: "pass",
          title: "Exact source identity",
        },
        sourceIdentity: initial,
      },
      initial,
    })).toEqual(expect.objectContaining({ status: "pass" }));
    expect(evaluateV07SourceStability({
      final: {
        check: {
          detail: "clean source",
          durationMs: 0,
          id: "source-identity",
          required: true,
          status: "pass",
          title: "Exact source identity",
        },
        sourceIdentity: {
          commitSha: "c".repeat(40),
          treeSha: "d".repeat(40),
        },
      },
      initial,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("changed while release checks ran"),
      status: "fail",
    }));
  });

  it("requires stable readiness to use the clean peeled release tag identity", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-readiness-identity-"));
    try {
      runFixtureGit(repoRoot, "init", "--quiet");
      runFixtureGit(repoRoot, "config", "user.email", "release-test@example.com");
      runFixtureGit(repoRoot, "config", "user.name", "Release Test");
      await writeFile(join(repoRoot, "source.ts"), "export const release = true;\n");
      runFixtureGit(repoRoot, "add", ".");
      runFixtureGit(repoRoot, "commit", "--quiet", "-m", "release source");

      await expect(evaluateV07ReleaseSourceIdentity({
        releaseStatus: "release-candidate",
        repoRoot,
        version: "0.7.4",
      })).resolves.toEqual(expect.objectContaining({ status: "pass" }));
      await expect(evaluateV07ReleaseSourceIdentity({
        releaseStatus: "stable",
        repoRoot,
        version: "0.7.4",
      })).resolves.toEqual(expect.objectContaining({
        detail: expect.stringContaining("peeled v0.7.4 tag"),
        status: "fail",
      }));

      runFixtureGit(repoRoot, "tag", "v0.7.4");
      await expect(evaluateV07ReleaseSourceIdentity({
        releaseStatus: "stable",
        repoRoot,
        version: "0.7.4",
      })).resolves.toEqual(expect.objectContaining({ status: "pass" }));
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("requires the release consumer to execute with Node 20", () => {
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.14",
      nodeVersion: "v20.19.4",
    })).toEqual(expect.objectContaining({ status: "pass" }));
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.11",
      nodeVersion: "v22.14.0",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("Node 20"),
      status: "fail",
    }));
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.11",
      nodeVersion: "v20.19.4",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("Bun 1.3.14"),
      status: "fail",
    }));
  });

  it("rejects duplicate CLI flags", () => {
    expect(() =>
      parseV07ReleaseReadinessCliOptions(["--strict", "--strict"]),
    ).toThrow("--strict cannot be specified more than once.");
    expect(() =>
      parseV07ReleaseReadinessCliOptions([
        "--output-dir",
        "/tmp/a",
        "--output-dir",
        "/tmp/b",
      ]),
    ).toThrow("--output-dir cannot be specified more than once.");
  });

  it("parses one explicit lifecycle-protection artifact path", () => {
    expect(
      parseV07ReleaseReadinessCliOptions([
        "--strict",
        "--lifecycle-protection-artifact",
        "/tmp/v0.7.3-protection.json",
      ]),
    ).toEqual({
      lifecycleProtectionArtifact: "/tmp/v0.7.3-protection.json",
      outputDir: undefined,
      skipBuild: false,
      skipCoverage: false,
      skipTests: false,
      strict: true,
    });
  });

  it("accepts only a canonical schema 9 measurement evidence root", () => {
    expect(() => assertV073MeasurementEvidenceRoot(
      "/tmp/driver/reports/release/v0.7/" +
        "v0.7.3-lifecycle-schema9-evidence",
    )).not.toThrow();
    for (const root of [
      "/tmp/measurement-evidence",
      "/tmp/driver/reports/release/v0.7/" +
        "v0.7.3-lifecycle-schema8-evidence",
      "/tmp/driver/reports/release/v0.7/" +
        "v0.7.3-lifecycle-schema9-evidence-drifted",
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence",
      "/tmp/driver/reports/release/v0.7/../v0.7/" +
        "v0.7.3-lifecycle-schema9-evidence",
    ]) {
      expect(() => assertV073MeasurementEvidenceRoot(root)).toThrow(
        "canonical schema 9 evidence root",
      );
    }
  });

  it("accepts only a completed lifecycle artifact bound to the candidate commit", async () => {
    const candidateCommit = "a".repeat(40);
    const bundlePrefix =
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence/";
    const bundlePath = (path: string) =>
      `${bundlePrefix}${path.replace(/^\/+|\//gu, "-")}`;
    const artifactIdentity = (path: string, fill: string) => ({
      bytes: 100,
      path: bundlePath(path),
      sha256: fill.repeat(64),
    });
    const tapeSha256 = "f".repeat(64);
    const providerSession = {
      coalesced: 0,
      hits: 10,
      liveRequests: 0,
      misses: 0,
      mode: "replay",
      non2xxResponses: 0,
      requestFingerprintMultisetSha256: "e".repeat(64),
      requestSequenceSha256: "d".repeat(64),
      requests: 10,
      sequenceMismatches: 0,
      targetCounts: { embedding: 2, eval: 7, judge: 1 },
      tapeSha256,
      transportAttemptLedgerSha256:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      transportAttempts: 0,
      transportErrors: 0,
    };
    const artifact = {
      artifacts: {
        attemptSentinel: {
          bytes: 100,
          path:
            "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json",
          sha256: "0".repeat(64),
        },
        manifest: artifactIdentity("manifest.json", "0"),
        protocolInput: artifactIdentity("protocol-input.json", "1"),
        providerPreflight: {
          receipt: artifactIdentity("provider-preflight/execution-receipt.json", "1"),
          tape: artifactIdentity("provider-preflight/tape.json", "1"),
        },
        providerFree: {
          c1Baseline: artifactIdentity("provider-free/c1-baseline.json", "2"),
          c1BaselineReceipt: artifactIdentity("provider-free/c1-baseline-receipt.json", "2"),
          c1Candidate: artifactIdentity("provider-free/c1-candidate.json", "3"),
          c1CandidateReceipt: artifactIdentity("provider-free/c1-candidate-receipt.json", "3"),
          c40Baseline: artifactIdentity("provider-free/c40-baseline.json", "4"),
          c40BaselineReceipt: artifactIdentity("provider-free/c40-baseline-receipt.json", "4"),
          c40Candidate: artifactIdentity("provider-free/c40-candidate.json", "5"),
          c40CandidateReceipt: artifactIdentity("provider-free/c40-candidate-receipt.json", "5"),
        },
        providerReplay: {
          baselineDiscoveryReceipt: artifactIdentity("provider-replay/baseline-discovery.json", "6"),
          baselineFormalOfficial: artifactIdentity("provider-replay/baseline-official.json", "7"),
          baselineFormalProgress: artifactIdentity("provider-replay/baseline-progress.jsonl", "7"),
          baselineFormalReport: artifactIdentity("provider-replay/baseline-report.json", "8"),
          baselineFormalReceipt: artifactIdentity("provider-replay/baseline-formal.json", "9"),
          candidateDiscoveryReceipt: artifactIdentity("provider-replay/candidate-discovery.json", "a"),
          candidateFormalOfficial: artifactIdentity("provider-replay/candidate-official.json", "b"),
          candidateFormalProgress: artifactIdentity("provider-replay/candidate-progress.jsonl", "b"),
          candidateFormalReport: artifactIdentity("provider-replay/candidate-report.json", "c"),
          candidateFormalReceipt: artifactIdentity("provider-replay/candidate-formal.json", "d"),
          tape: artifactIdentity(
            "provider-response-tape/manifest.json",
            "e",
          ),
        },
        scenarioReceipt: artifactIdentity("scenario/execution-receipt.json", "f"),
      },
      baselineCommit: "456edd106f29118b3455bf21c43d7b3107b48213",
      blockers: [],
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      claimBoundary:
        "Provider-free hard gate, frozen provider replay, and explicit provider-variance spread.",
      fullClaimRerunRequired: true,
      generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
      hardGate: {
        providerFree: [{ concurrency: 1 }, { concurrency: 40 }],
        scenarioReplay: { failures: 0, passed: 8 },
      },
      liveDiagnostic: {
        signTest: {
          alpha: 0.05,
          discordant: 26,
          improved: 11,
          pValue: 0.5571970939636236,
          regressed: 15,
          significant: false,
          test: "exact_two_sided_sign_test",
        },
        totalQuestions: 233,
      },
      providerReplay: {
        baselineExecutionFailures: 0,
        baselineJudgeFailures: 0,
        candidateExecutionFailures: 0,
        candidateJudgeFailures: 0,
        concurrency: 1 as const,
        discovery: {
          baseline: { ...providerSession, mode: "prefetch" },
          candidate: { ...providerSession, mode: "prefetch" },
        },
        formal: { baseline: providerSession, candidate: providerSession },
        tapeEntryCount: 10,
        tapeSha256,
        tapeTargetCounts: { embedding: 2, eval: 7, judge: 1 },
      },
      providerPreflight: providerPreflightPlan(),
      releaseAllowed: true,
      researchRecordRequired: false,
      schemaVersion: 9,
    };

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact,
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      id: "v0.7.3-lifecycle-protection",
      status: "pass",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, schemaVersion: 3 },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("schemaVersion must be 9"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: {
        ...artifact,
        candidateCommit: "c",
      },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("candidate"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, releaseAllowed: false },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({ status: "fail" }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, providerPreflight: undefined },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("five successful probes"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: {
        ...artifact,
        providerReplay: {
          ...artifact.providerReplay,
          discovery: {
            ...artifact.providerReplay.discovery,
            baseline: {
              ...artifact.providerReplay.discovery.baseline,
              non2xxResponses: 1,
            },
          },
        },
      },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({ status: "fail" }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: { ...artifact, artifacts: undefined },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("source artifact identities"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionArtifact({
      artifact: {
        ...artifact,
        artifacts: {
          ...artifact.artifacts,
          providerReplay: {
            ...artifact.artifacts.providerReplay,
            tape: undefined,
          },
        },
      },
      artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("source artifact identities"),
      status: "fail",
    }));

    const emptyRepo = await mkdtemp(join(tmpdir(), "goodmemory-v073-bundle-"));
    const artifactPath = join(emptyRepo, "v0.7.3-lifecycle-protection.json");
    await writeFile(artifactPath, JSON.stringify(artifact));
    const strictChecks = await evaluateV073LifecycleProtectionArtifactFile({
      artifactPath,
      currentCommit: candidateCommit,
      repoRoot: emptyRepo,
    });
    expect(strictChecks[0]).toEqual(expect.objectContaining({
      detail: expect.stringContaining("ENOENT"),
      status: "fail",
    }));
  });

  it("recomputes schema 9 lifecycle evidence from bound preflight, deterministic, and frozen-replay bytes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "goodmemory-v073-replacement-bundle-"));
    const evidencePrefix =
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence";
    const measurementEvidenceRoot = join(repoRoot, evidencePrefix);
    const candidateCommit = "c5665458f79adbc7d35eccb2155dc40b2a443ae2";
    const writeEvidence = async (name: string, raw: string) => {
      const path = `${evidencePrefix}/${name}`;
      const absolutePath = join(repoRoot, path);
      await mkdir(join(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, raw);
      return {
        bytes: Buffer.byteLength(raw, "utf8"),
        path,
        sha256: createHash("sha256").update(raw).digest("hex"),
      };
    };
    const writeTapeBundle = async (tape: Parameters<
      typeof encodeProviderResponseTapeBundle
    >[0]) => {
      const encoded = encodeProviderResponseTapeBundle(tape);
      const root = join(repoRoot, evidencePrefix, "provider-response-tape");
      await rm(root, { force: true, recursive: true });
      await mkdir(root, { recursive: true });
      await Promise.all(encoded.parts.map((part) =>
        writeFile(join(root, part.path), part.bytes)
      ));
      return writeEvidence(
        "provider-response-tape/manifest.json",
        encoded.manifestRaw,
      );
    };
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const benchmarkRoot = join(
      homedir(),
      ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
    );
    const frozenRows = frozenV073LocomoQuestionSelection()
      .filter((row) =>
        row.caseId === "locomo-conv-26" || row.caseId === "locomo-conv-30"
      )
      .map((row, index) => {
        const evidenceTurnId = `evidence-${index}`;
        const retrieved = index % 2 === 1;
        return {
          ...row,
          evidenceRecall: retrieved ? 1 : 0,
          evidenceTurnIds: [evidenceTurnId],
          goldEvidenceFullyRetrieved: retrieved,
          missingEvidenceTurnIds: retrieved ? [] : [evidenceTurnId],
          noiseTurnCount: 0,
          noiseTurnIds: [],
          retrievedTurnIds: retrieved ? [evidenceTurnId] : [],
        };
      });
    const providerFreeReport = (concurrency: number) => ({
      answerEvaluation: "deferred-to-live-mode",
      benchmarkFingerprint:
        "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
      caseIds: ["locomo-conv-26", "locomo-conv-30"],
      cases: frozenRows,
      concurrency,
      executionFailures: 0,
      externalRoot: benchmarkRoot,
      generalizedFusion: true,
      generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
      ingestMode: "raw-turns",
      labelFreeIngest: true,
      mode: "retrieval-only",
      profilesCompared: ["goodmemory-recommended"],
      providerReranking: false,
      questionCategories: [
        "single_hop",
        "multi_hop",
        "temporal",
        "open_domain",
      ],
      questionCount: frozenRows.length,
      resume: false,
      semanticCandidateEmbeddingSource: "none",
    });
    const formal = {
      cases: frozenRows.map((row) => ({
        ...row,
        answerCorrect: true,
        answerTokenF1: 1,
      })),
      executionFailures: 0,
      questionCount: frozenRows.length,
    };
    const official = { judgeFailures: 0, overallAccuracy: 1 };
    const officialProgressRaw = frozenRows
      .map((row) => JSON.stringify({ correct: true, questionId: row.questionId }))
      .join("\n") + "\n";
    const semanticHeadersSha256 = createHash("sha256")
      .update(JSON.stringify([]))
      .digest("hex");
    const tapeEntries = [
      ["embedding", "/embeddings"],
      ["eval", "/chat/completions"],
      ["judge", "/chat/completions"],
    ].map(([targetId, path]) => {
      const body = JSON.stringify({ targetId });
      const responseBytes = Buffer.from(`ok-${targetId}`);
      return {
        fingerprint: fingerprintProviderRequest({
          body,
          method: "POST",
          path: path!,
          targetId: targetId!,
        }),
        occurrence: 0,
        request: {
          canonicalBodySha256: createHash("sha256").update(body).digest("hex"),
          method: "POST",
          path: path!,
          semanticHeadersSha256,
          targetId: targetId!,
        },
        response: {
          bodyBase64: responseBytes.toString("base64"),
          bytes: responseBytes.byteLength,
          contentType: "text/plain",
          sha256: createHash("sha256").update(responseBytes).digest("hex"),
          status: 200,
          statusText: "OK",
        },
      };
    });
    const tapeRaw = serializeProviderResponseTape({
      entries: tapeEntries,
      schemaVersion: 3,
    });
    const tapeSha256 = createHash("sha256").update(tapeRaw).digest("hex");
    const requestFingerprintMultisetSha256 = createHash("sha256")
      .update(JSON.stringify(
        tapeEntries
          .map((entry): [string, number] => [entry.fingerprint, 1])
          .sort(([left], [right]) => left.localeCompare(right)),
      ))
      .digest("hex");
    const requestSequence = tapeEntries.map((entry) => ({
      fingerprint: entry.fingerprint,
      ...entry.request,
    }));
    const requestSequenceSha256 = fingerprintProviderRequestSequence(
      requestSequence,
    );
    const transportAttemptLedger = requestSequence.map(
      ({ fingerprint, targetId }, requestIndex) => ({
        fingerprint,
        outcome: "response" as const,
        requestIndex,
        responseStatus: 200,
        targetId,
      }),
    );
    const transportAttemptLedgerSha256 =
      fingerprintProviderTransportAttemptLedger(transportAttemptLedger);
    const emptyTransportAttemptLedgerSha256 =
      fingerprintProviderTransportAttemptLedger([]);
    const replaySession = {
      coalesced: 0,
      hits: 3,
      liveRequests: 0,
      misses: 0,
      mode: "replay" as const,
      non2xxResponses: 0,
      requestFingerprintMultisetSha256,
      requestSequenceSha256,
      requests: 3,
      sequenceMismatches: 0,
      targetCounts: { embedding: 1, eval: 1, judge: 1 },
      tapeSha256,
      transportAttemptLedgerSha256: emptyTransportAttemptLedgerSha256,
      transportAttempts: 0,
      transportErrors: 0,
    };
    const discoverySession = {
      coalesced: 0,
      hits: 0,
      liveRequests: 3,
      misses: 3,
      mode: "prefetch" as const,
      non2xxResponses: 0,
      requestFingerprintMultisetSha256,
      requestSequenceSha256,
      requests: 3,
      sequenceMismatches: 0,
      targetCounts: { embedding: 1, eval: 1, judge: 1 },
      tapeSha256,
      transportAttemptLedgerSha256,
      transportAttempts: 3,
      transportErrors: 0,
    };
    const replayReceiptSession = {
      ...replaySession,
      requestSequence,
      sequenceMismatchDetails: [],
      transportAttemptLedger: [],
    };
    const discoveryReceiptSession = {
      ...discoverySession,
      requestSequence,
      sequenceMismatchDetails: [],
      transportAttemptLedger,
    };
    const preflightOccurrences = new Map<string, number>();
    const preflightTapeEntries =
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence.map((identity) => {
        const occurrence = preflightOccurrences.get(identity.fingerprint) ?? 0;
        preflightOccurrences.set(identity.fingerprint, occurrence + 1);
        const responseBody = identity.targetId === "embedding"
          ? JSON.stringify({ data: [{ embedding: [0.5, -0.5] }] })
          : identity.targetId === "eval"
            ? `data: ${JSON.stringify({
                choices: [{
                  delta: {
                    content: `<think>fixture</think>${JSON.stringify({
                      orderedCandidateIds: ["candidate-1"],
                    })}`,
                  },
                }],
              })}\n\ndata: [DONE]\n\n`
            : JSON.stringify({
                choices: [{ message: { content: "YES" } }],
              });
        const responseBytes = Buffer.from(responseBody);
        const {
          fingerprint,
          ...request
        } = identity;
        return {
          fingerprint,
          occurrence,
          request,
          response: {
            bodyBase64: responseBytes.toString("base64"),
            bytes: responseBytes.byteLength,
            contentType: identity.targetId === "eval"
              ? "text/event-stream"
              : "application/json",
            sha256: createHash("sha256").update(responseBytes).digest("hex"),
            status: 200,
            statusText: "OK",
          },
        };
      });
    const preflightTapeRaw = serializeProviderResponseTape({
      entries: preflightTapeEntries,
      schemaVersion: 3,
    });
    const preflightTapeSha256 = createHash("sha256")
      .update(preflightTapeRaw)
      .digest("hex");
    const preflightFingerprintCounts = new Map<string, number>();
    for (const { fingerprint } of
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence) {
      preflightFingerprintCounts.set(
        fingerprint,
        (preflightFingerprintCounts.get(fingerprint) ?? 0) + 1,
      );
    }
    const preflightRequestFingerprintMultisetSha256 = createHash("sha256")
      .update(JSON.stringify(
        [...preflightFingerprintCounts.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      ))
      .digest("hex");
    const preflightTransportAttemptLedger =
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence.map(
        ({ fingerprint, targetId }, requestIndex) => ({
          fingerprint,
          outcome: "response" as const,
          requestIndex,
          responseStatus: 200,
          targetId,
        }),
      );
    const preflightSession = {
      coalesced: 0,
      hits: 0,
      liveRequests: 5,
      misses: 5,
      mode: "prefetch" as const,
      name: "provider-availability-preflight",
      non2xxResponses: 0,
      requestFingerprintMultisetSha256:
        preflightRequestFingerprintMultisetSha256,
      requestSequence: V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence,
      requestSequenceSha256:
        V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
      requests: 5,
      sequenceMismatchDetails: [],
      sequenceMismatches: 0,
      tapeSha256: preflightTapeSha256,
      targetCounts: { embedding: 1, eval: 3, judge: 1 },
      transportAttemptLedger: preflightTransportAttemptLedger,
      transportAttemptLedgerSha256:
        fingerprintProviderTransportAttemptLedger(
          preflightTransportAttemptLedger,
        ),
      transportAttempts: 5,
      transportErrors: 0,
    };
    const protocolInput = {
      baselineCommit: "456edd106f29118b3455bf21c43d7b3107b48213",
      candidateCommit,
      candidatePromptSha256: deriveV073PromptSha256(),
      deterministicArms: [
        {
          baseline: providerFreeReport(1),
          candidate: providerFreeReport(1),
          concurrency: 1,
        },
        {
          baseline: providerFreeReport(40),
          candidate: providerFreeReport(40),
          concurrency: 40,
        },
      ],
      providerPreflight: providerPreflightPlan(),
      providerReplay: {
        baselineExecutionFailures: 0,
        baselineJudgeFailures: 0,
        candidateExecutionFailures: 0,
        candidateJudgeFailures: 0,
        concurrency: 1 as const,
        discovery: {
          baseline: discoverySession,
          candidate: discoverySession,
        },
        formal: { baseline: replaySession, candidate: replaySession },
        pointDeltas: {
          evidenceRecall: 0,
          officialScore: 0,
          strictAnswerScore: 0,
        },
        tapeEntryCount: 3,
        tapeSha256,
        tapeTargetCounts: { embedding: 1, eval: 1, judge: 1 },
      },
      questionTransitions: { improved: 0, regressed: 0, total: 233 },
      scenarioReplay: { failures: 0, passed: 8 },
    };
    const attemptSentinelPath =
      "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json";
    const storagePreflight = {
      availableBytes:
        V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes,
      minimumAvailableBytes:
        V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes,
      path: "reports/release/v0.7",
    };
    const attemptSentinelRaw = json({
      baselineCommit: protocolInput.baselineCommit,
      candidateCommit: protocolInput.candidateCommit,
      generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
      providerPreflight: protocolInput.providerPreflight,
      requestSequenceSha256:
        V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
      schemaVersion: 9,
      state: "consumed",
      storagePreflight,
    });

    try {
      await mkdir(join(repoRoot, "reports/release/v0.7"), {
        recursive: true,
      });
      await writeFile(join(repoRoot, attemptSentinelPath), attemptSentinelRaw);
      const attemptSentinel = evidenceIdentity(
        attemptSentinelPath,
        attemptSentinelRaw,
      );
      await mkdir(join(repoRoot, "benchmark-claims"), { recursive: true });
      await writeFile(join(repoRoot, "benchmark-claims/locomo.json"), CLAIM_RECIPE_RAW);
      const sourceRoot = join(import.meta.dir, "../..");
      const historicalSource = (path: string) =>
        readFixtureGitObject(
          sourceRoot,
          `456edd106f29118b3455bf21c43d7b3107b48213:${path}`,
        );
      const harnessSources = {
        claimRecipe: ["benchmark-claims/locomo.json", CLAIM_RECIPE_RAW],
        officialRunner: [
          "scripts/rescore-official-protocols.ts",
          historicalSource("scripts/rescore-official-protocols.ts"),
        ],
        reanswerRunner: [
          "scripts/reanswer-phase-65-locomo-report.ts",
          historicalSource("scripts/reanswer-phase-65-locomo-report.ts"),
        ],
        seedRunner: [
          "scripts/run-phase-65-locomo-smoke.ts",
          historicalSource("scripts/run-phase-65-locomo-smoke.ts"),
        ],
      } as const;
      for (const [path, raw] of Object.values(harnessSources)) {
        await mkdir(join(repoRoot, path, ".."), { recursive: true });
        await writeFile(join(repoRoot, path), raw);
      }
      const measurementHarness = Object.fromEntries(
        Object.entries(harnessSources).map(([name, [path, raw]]) => [name, {
          bytes: Buffer.byteLength(raw, "utf8"),
          path,
          sha256: createHash("sha256").update(raw).digest("hex"),
        }]),
      ) as Record<string, { bytes: number; path: string; sha256: string }>;
      const sourceIdentity = {
        claimCommandTemplateSha256:
          deriveV073ClaimCommandTemplateSha256(CLAIM_RECIPE_RAW),
        claimSourceSha256: measurementHarness.claimRecipe!.sha256,
        officialSourceSha256: measurementHarness.officialRunner!.sha256,
        promptSha256: deriveV073PromptSha256(),
        reanswerSourceSha256: measurementHarness.reanswerRunner!.sha256,
        seedSourceSha256: measurementHarness.seedRunner!.sha256,
      };
      const providers = {
        assisted: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        embedding: {
          gateway: "https://openrouter.ai/api/v1",
          model: "text-embedding-3-small",
          provider: "openai",
        },
        eval: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        judge: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.5",
          provider: "openai",
        },
        reranking: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
      };
      const baselineWorktree = "/tmp/baseline-v073";
      const candidateWorktree = "/tmp/candidate-v073";
      const preflightTape = await writeEvidence(
        "provider-preflight/tape.json",
        preflightTapeRaw,
      );
      const preflightReceipt = await writeEvidence(
        "provider-preflight/execution-receipt.json",
        json({
          generatedBy:
            "scripts/run-v0-7-3-replacement-protection-gate.ts",
          probePlan: providerPreflightPlan(),
          session: preflightSession,
          tape: preflightTape,
        }),
      );
      const manifestValue = {
        baseline: {
          branch: null,
          commit: protocolInput.baselineCommit,
          statusPorcelain: "",
          worktreePath: baselineWorktree,
        },
        benchmark: {
          bytes: 2_490_457,
          fingerprint:
            "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd",
          root: benchmarkRoot,
          sha256:
            "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28",
        },
        candidate: {
          branch: null,
          commit: candidateCommit,
          statusPorcelain: "",
          worktreePath: candidateWorktree,
        },
        formalAttempt: { sentinel: attemptSentinel },
        generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
        measurementEvidenceRoot,
        measurementHarness,
        providerPreflight: {
          receipt: preflightReceipt,
          summary: providerPreflightPlan(),
          tape: preflightTape,
        },
        storagePreflight,
        protocol: {
          assistedExtractionMaxAttempts: 4,
          assistedExtractionRequestTimeoutMs: 120_000,
          claimCommandTemplateSha256: sourceIdentity.claimCommandTemplateSha256,
          failureTapeCredentialMaterial: "excluded-before-persistence",
          failedDiscoveryTape: "atomic-before-stage-error",
          formalNetworkOnMiss: false,
          hardRegressionLimit: 0.01,
          promptSha256: sourceIdentity.promptSha256,
          providerFailureRecovery:
            "immediate-same-fingerprint-retry-to-2xx",
          providerPreflightFormalAttemptBoundary:
            "schema9-consumed-sentinel-created-only-after-success",
          providerPreflightProbeOrder:
            V073_PROVIDER_PREFLIGHT_POLICY.probeOrder,
          providerPreflightRequestSequenceSha256:
            V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256,
          providerPreflightRequestTimeoutMs:
            V073_PROVIDER_PREFLIGHT_POLICY.requestTimeoutMs,
          providerPreflightRetries: 0,
          providerFreeConcurrency: [1, 40],
          providerLogCredentialMaterial:
            "redacted-before-output-hash-and-persistence",
          providerReplayConcurrency: 1,
          semanticSeedRunId: V073_SEMANTIC_SEED_RUN_ID,
          signTestAlpha: 0.05,
          storagePreflightMinimumAvailableBytes:
            V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes,
          tapeInputIdentity:
            "ordered request fingerprint + logical target + method + path/query + canonical-body digest + semantic-header digest",
          tapeArtifactEncoding: "canonical-json-sharded-gzip",
          tapeMaxPartBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes,
          tapeMaxParts: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts,
          tapeMaxRawBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes,
          tapeMaxTotalBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes,
          tapePartUncompressedBytes:
            PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes,
          tapeRequestIdentity:
            "sha256(logical-target + method + path/query + canonical-json-body + semantic-headers)",
          tapeResponseVariants: "ordered-per-fingerprint",
          tapeSequenceCoverage: "exact-discovery-occurrence-union",
          transportAttemptLedger: "hash-only-session-receipt",
          transportErrorResponseStatus: 502,
          transportErrors: "record-and-replay",
          transportProxyRetries: 0,
        },
        providers,
        schemaVersion: 9,
      };
      const sharedStdout = await writeEvidence("logs/stdout.log", "8 pass\n0 fail\n");
      const sharedStderr = await writeEvidence("logs/stderr.log", "");
      const [
        manifest,
        protocolInputIdentity,
        c1Baseline,
        c1Candidate,
        c40Baseline,
        c40Candidate,
        baselineFormalReport,
        candidateFormalReport,
        baselineFormalOfficial,
        candidateFormalOfficial,
        baselineFormalProgress,
        candidateFormalProgress,
        tape,
      ] = await Promise.all([
        writeEvidence("manifest.json", json(manifestValue)),
        writeEvidence("protocol-input.json", json(protocolInput)),
        writeEvidence("provider-free/c1-baseline.json", json(providerFreeReport(1))),
        writeEvidence("provider-free/c1-candidate.json", json(providerFreeReport(1))),
        writeEvidence("provider-free/c40-baseline.json", json(providerFreeReport(40))),
        writeEvidence("provider-free/c40-candidate.json", json(providerFreeReport(40))),
        writeEvidence("provider-replay/baseline-report.json", json(formal)),
        writeEvidence("provider-replay/candidate-report.json", json(formal)),
        writeEvidence("provider-replay/baseline-official.json", json(official)),
        writeEvidence("provider-replay/candidate-official.json", json(official)),
        writeEvidence("provider-replay/baseline-progress.jsonl", officialProgressRaw),
        writeEvidence("provider-replay/candidate-progress.jsonl", officialProgressRaw),
        writeTapeBundle({ entries: tapeEntries, schemaVersion: 3 }),
      ]);
      const providerFreeReceipt = async (input: {
        concurrency: 1 | 40;
        label: "baseline" | "candidate";
        report: typeof c1Baseline;
      }) => {
        const runId = `v073-provider-free-c${input.concurrency}-${input.label}`;
        return writeEvidence(
          `provider-free/${runId}-receipt.json`,
          json({
            args: buildV073ProviderFreeArgs({
              benchmarkRoot,
              concurrency: input.concurrency,
              outputDir: join(measurementEvidenceRoot, "provider-free"),
              runId,
            }),
            command: "bun",
            commit: input.label === "baseline"
              ? protocolInput.baselineCommit
              : candidateCommit,
            concurrency: input.concurrency,
            cwd: input.label === "baseline" ? baselineWorktree : candidateWorktree,
            exitCode: 0,
            generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
            label: input.label,
            report: input.report,
            stderr: sharedStderr,
            stdout: sharedStdout,
          }),
        );
      };
      const [
        c1BaselineReceipt,
        c1CandidateReceipt,
        c40BaselineReceipt,
        c40CandidateReceipt,
      ] = await Promise.all([
        providerFreeReceipt({ concurrency: 1, label: "baseline", report: c1Baseline }),
        providerFreeReceipt({ concurrency: 1, label: "candidate", report: c1Candidate }),
        providerFreeReceipt({ concurrency: 40, label: "baseline", report: c40Baseline }),
        providerFreeReceipt({ concurrency: 40, label: "candidate", report: c40Candidate }),
      ]);
      const scenarioReceipt = await writeEvidence("scenario/receipt.json", json({
        args: ["test", "tests/scenarios"],
        candidateCommit,
        command: "bun",
        cwd: candidateWorktree,
        exitCode: 0,
        failures: 0,
        generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
        passed: 8,
        stderr: sharedStderr,
        stdout: sharedStdout,
      }));
      const providerReceipt = async (input: {
        commit: string;
        formalStage: boolean;
        name: string;
        session: typeof replayReceiptSession | typeof discoveryReceiptSession;
        stage: string;
        worktreePath: string;
      }) => {
        const expectedArm = buildV073StageArm({
          benchmarkRoot,
          claimRecipeRaw: CLAIM_RECIPE_RAW,
          commit: input.commit,
          outputDir: measurementEvidenceRoot,
          providers,
          sourceIdentity: {
            officialSourceSha256: sourceIdentity.officialSourceSha256,
            reanswerSourceSha256: sourceIdentity.reanswerSourceSha256,
            seedSourceSha256: sourceIdentity.seedSourceSha256,
          },
          stage: input.stage,
          worktreePath: input.worktreePath,
        });
        const commandChain = routeV073CommandChainThroughTape(
          buildV073PairedCommandChain(expectedArm.arm, CLAIM_RECIPE_RAW),
          {
            assisted: "http://127.0.0.1:4567/assisted",
            embedding: "http://127.0.0.1:4567/embedding",
            eval: "http://127.0.0.1:4567/eval",
            judge: "http://127.0.0.1:4567/judge",
            reranking: "http://127.0.0.1:4567/reranking",
          },
          { replayCredentials: input.formalStage },
        );
        return writeEvidence(input.name, json({
        commandChain,
        commit: input.commit,
        executionOrder: V073_PROVIDER_STAGE_ORDER,
        generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
        outputs: {
          finalReport: input.commit === protocolInput.baselineCommit
            ? baselineFormalReport
            : candidateFormalReport,
          officialProgress: input.commit === protocolInput.baselineCommit
            ? baselineFormalProgress
            : candidateFormalProgress,
          officialSummary: input.commit === protocolInput.baselineCommit
            ? baselineFormalOfficial
            : candidateFormalOfficial,
          seedReport: input.commit === protocolInput.baselineCommit
            ? baselineFormalReport
            : candidateFormalReport,
        },
        session: input.session,
        sourceIdentity,
        stage: input.stage,
        stderr: sharedStderr,
        steps: V073_PROVIDER_STAGE_ORDER.map((step) => ({ exitCode: 0, step })),
        stdout: sharedStdout,
        }));
      };
      const [
        baselineDiscoveryReceipt,
        candidateDiscoveryReceipt,
        baselineFormalReceipt,
        candidateFormalReceipt,
      ] = await Promise.all([
        providerReceipt({
          commit: protocolInput.baselineCommit,
          formalStage: false,
          name: "provider-replay/baseline-discovery.json",
          session: discoveryReceiptSession,
          stage: "baseline-discovery",
          worktreePath: baselineWorktree,
        }),
        providerReceipt({
          commit: candidateCommit,
          formalStage: false,
          name: "provider-replay/candidate-discovery.json",
          session: discoveryReceiptSession,
          stage: "candidate-discovery",
          worktreePath: candidateWorktree,
        }),
        providerReceipt({
          commit: protocolInput.baselineCommit,
          formalStage: true,
          name: "provider-replay/baseline-formal.json",
          session: replayReceiptSession,
          stage: "baseline-formal",
          worktreePath: baselineWorktree,
        }),
        providerReceipt({
          commit: candidateCommit,
          formalStage: true,
          name: "provider-replay/candidate-formal.json",
          session: replayReceiptSession,
          stage: "candidate-formal",
          worktreePath: candidateWorktree,
        }),
      ]);
      const artifacts = {
        attemptSentinel,
        manifest,
        protocolInput: protocolInputIdentity,
        providerPreflight: {
          receipt: preflightReceipt,
          tape: preflightTape,
        },
        providerFree: {
          c1Baseline,
          c1BaselineReceipt,
          c1Candidate,
          c1CandidateReceipt,
          c40Baseline,
          c40BaselineReceipt,
          c40Candidate,
          c40CandidateReceipt,
        },
        providerReplay: {
          baselineDiscoveryReceipt,
          baselineFormalOfficial,
          baselineFormalProgress,
          baselineFormalReport,
          baselineFormalReceipt,
          candidateDiscoveryReceipt,
          candidateFormalOfficial,
          candidateFormalProgress,
          candidateFormalReport,
          candidateFormalReceipt,
          tape,
        },
        scenarioReceipt,
      };
      const artifact = {
        ...evaluateV073ReplacementProtection(protocolInput),
        artifacts,
      };

      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({ status: "pass" }));

      const gitDirectory = new TextDecoder().decode(Bun.spawnSync([
        "git",
        "rev-parse",
        "--absolute-git-dir",
      ]).stdout).trim();
      await writeFile(join(repoRoot, ".git"), `gitdir: ${gitDirectory}\n`);
      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        json({ claim: "fresh v0.7.3 publication", schemaVersion: 1 }),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({ status: "pass" }));
      await writeFile(
        join(repoRoot, "benchmark-claims/locomo.json"),
        CLAIM_RECIPE_RAW,
      );
      await rm(join(repoRoot, ".git"));

      const trackedEvidenceRoot = join(repoRoot, evidencePrefix);
      const externalEvidenceRoot = `${trackedEvidenceRoot}-external`;
      await rename(trackedEvidenceRoot, externalEvidenceRoot);
      await symlink(externalEvidenceRoot, trackedEvidenceRoot);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("real path"),
        status: "fail",
      }));
      await rm(trackedEvidenceRoot);
      await rename(externalEvidenceRoot, trackedEvidenceRoot);

      for (const driftedEvidenceRoot of [
        "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence",
        join(repoRoot, "measurement-evidence"),
        join(
          repoRoot,
          "reports/release/v0.7/v0.7.3-lifecycle-schema8-evidence",
        ),
        `${measurementEvidenceRoot}-drifted`,
        `${repoRoot}/reports/release/v0.7/../v0.7/` +
          "v0.7.3-lifecycle-schema9-evidence",
      ]) {
        const driftedManifestRaw = json({
          ...manifestValue,
          measurementEvidenceRoot: driftedEvidenceRoot,
        });
        await writeFile(join(repoRoot, manifest.path), driftedManifestRaw);
        Object.assign(
          artifact.artifacts.manifest,
          evidenceIdentity(manifest.path, driftedManifestRaw),
        );
        expect(await evaluateV073LifecycleProtectionBundle({
          artifact,
          artifactPath:
            "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
          repoRoot,
        })).toEqual(expect.objectContaining({ status: "fail" }));
      }
      const restoredManifestRaw = json(manifestValue);
      await writeFile(join(repoRoot, manifest.path), restoredManifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, restoredManifestRaw),
      );

      const tapeManifest = JSON.parse(
        await readFile(join(repoRoot, tape.path), "utf8"),
      ) as { parts: Array<{ path: string }> };
      const firstTapePartPath = join(
        repoRoot,
        evidencePrefix,
        "provider-response-tape",
        tapeManifest.parts[0]!.path,
      );
      const firstTapePart = await readFile(firstTapePartPath);
      const mutatedTapePart = Uint8Array.from(firstTapePart);
      mutatedTapePart[mutatedTapePart.length - 1] ^= 1;
      await writeFile(firstTapePartPath, mutatedTapePart);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("bytes do not match"),
        status: "fail",
      }));
      await writeFile(firstTapePartPath, firstTapePart);

      const externalTapePartPath = join(repoRoot, "external-tape-part.json.gz");
      await writeFile(externalTapePartPath, firstTapePart);
      await rm(firstTapePartPath);
      await symlink(externalTapePartPath, firstTapePartPath);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("regular file"),
        status: "fail",
      }));
      await rm(firstTapePartPath);
      await writeFile(firstTapePartPath, firstTapePart);

      const extraTapePath = join(
        repoRoot,
        evidencePrefix,
        "provider-response-tape",
        "extra.json.gz",
      );
      await writeFile(extraTapePath, firstTapePart);
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("directory closure"),
        status: "fail",
      }));
      await rm(extraTapePath);

      const legacyTapePath = join(
        repoRoot,
        evidencePrefix,
        "provider-response-tape",
        "provider-response-tape.json",
      );
      await writeFile(legacyTapePath, "{}\n");
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("directory closure"),
        status: "fail",
      }));
      await rm(legacyTapePath);

      const canonicalC1BaselinePath = c1Baseline.path;
      c1Baseline.path = canonicalC1BaselinePath.replace(
        "v0.7.3-lifecycle-schema9-evidence",
        "v0.7.3-lifecycle-evidence",
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("outside the tracked bundle"),
        status: "fail",
      }));
      c1Baseline.path = canonicalC1BaselinePath;

      for (const protocolDrift of [
        { assistedExtractionMaxAttempts: 3 },
        { assistedExtractionRequestTimeoutMs: 60_000 },
        { failureTapeCredentialMaterial: "persist-raw" },
        { failedDiscoveryTape: "after-stage-error" },
        { formalNetworkOnMiss: true },
        { hardRegressionLimit: 0.02 },
        { providerFailureRecovery: "allow-terminal-fallback" },
        { providerPreflightFormalAttemptBoundary: "root-before-preflight" },
        { providerPreflightProbeOrder: ["judge"] },
        { providerPreflightRequestSequenceSha256: "0".repeat(64) },
        { providerPreflightRequestTimeoutMs: 1 },
        { providerPreflightRetries: 1 },
        { providerFreeConcurrency: [1] },
        { providerLogCredentialMaterial: "persist-before-redaction" },
        { providerReplayConcurrency: 40 },
        { semanticSeedRunId: "stage-specific-seed" },
        { signTestAlpha: 0.1 },
        { storagePreflightMinimumAvailableBytes: 1 },
        { tapeInputIdentity: "unordered" },
        { tapeArtifactEncoding: "raw-json" },
        { tapeMaxPartBytes: 100 * 1024 * 1024 },
        { tapeMaxParts: 25 },
        { tapeMaxRawBytes: 2 * 1024 * 1024 * 1024 },
        { tapeMaxTotalBytes: 2 * 1024 * 1024 * 1024 },
        { tapePartUncompressedBytes: 64 * 1024 * 1024 },
        { tapeRequestIdentity: "body-only" },
        { tapeResponseVariants: "last-write-wins" },
        { tapeSequenceCoverage: "entry-count-only" },
        { transportAttemptLedger: "raw-error-receipt" },
        { transportErrorResponseStatus: 500 },
        { transportErrors: "invalidate-discovery" },
        { transportProxyRetries: 1 },
      ]) {
        const driftedManifestRaw = json({
          ...manifestValue,
          protocol: { ...manifestValue.protocol, ...protocolDrift },
        });
        await writeFile(join(repoRoot, manifest.path), driftedManifestRaw);
        Object.assign(
          artifact.artifacts.manifest,
          evidenceIdentity(manifest.path, driftedManifestRaw),
        );
        expect(await evaluateV073LifecycleProtectionBundle({
          artifact,
          artifactPath:
            "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
          repoRoot,
        })).toEqual(expect.objectContaining({
          detail: expect.stringContaining("manifest"),
          status: "fail",
        }));
      }
      const manifestRaw = json(manifestValue);
      await writeFile(join(repoRoot, manifest.path), manifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, manifestRaw),
      );

      const insufficientStorage = {
        ...storagePreflight,
        availableBytes:
          V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes - 1,
      };
      const insufficientSentinelRaw = json({
        ...(JSON.parse(attemptSentinelRaw) as Record<string, unknown>),
        storagePreflight: insufficientStorage,
      });
      const insufficientSentinel = evidenceIdentity(
        attemptSentinelPath,
        insufficientSentinelRaw,
      );
      await writeFile(
        join(repoRoot, attemptSentinelPath),
        insufficientSentinelRaw,
      );
      Object.assign(attemptSentinel, insufficientSentinel);
      const insufficientStorageManifestRaw = json({
        ...manifestValue,
        formalAttempt: { sentinel: insufficientSentinel },
        storagePreflight: insufficientStorage,
      });
      await writeFile(
        join(repoRoot, manifest.path),
        insufficientStorageManifestRaw,
      );
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, insufficientStorageManifestRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(
          "provider preflight artifacts are not independently bound",
        ),
        status: "fail",
      }));
      await writeFile(join(repoRoot, attemptSentinelPath), attemptSentinelRaw);
      Object.assign(
        attemptSentinel,
        evidenceIdentity(attemptSentinelPath, attemptSentinelRaw),
      );
      await writeFile(join(repoRoot, manifest.path), manifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, manifestRaw),
      );

      const preflightReceiptRaw = await readFile(
        join(repoRoot, preflightReceipt.path),
        "utf8",
      );
      const alteredPreflightReceipt = JSON.parse(preflightReceiptRaw) as {
        session: {
          transportAttemptLedger: ProviderTapeTransportAttempt[];
          transportAttemptLedgerSha256: string;
        };
      };
      const firstPreflightAttempt =
        alteredPreflightReceipt.session.transportAttemptLedger[0];
      if (firstPreflightAttempt?.outcome !== "response") {
        throw new Error("preflight fixture must start with a response attempt");
      }
      firstPreflightAttempt.responseStatus = 201;
      alteredPreflightReceipt.session.transportAttemptLedgerSha256 =
        fingerprintProviderTransportAttemptLedger(
          alteredPreflightReceipt.session.transportAttemptLedger,
        );
      const alteredPreflightReceiptRaw = json(alteredPreflightReceipt);
      const alteredPreflightReceiptIdentity = evidenceIdentity(
        preflightReceipt.path,
        alteredPreflightReceiptRaw,
      );
      await writeFile(
        join(repoRoot, preflightReceipt.path),
        alteredPreflightReceiptRaw,
      );
      Object.assign(preflightReceipt, alteredPreflightReceiptIdentity);
      const alteredPreflightManifestRaw = json({
        ...manifestValue,
        providerPreflight: {
          ...manifestValue.providerPreflight,
          receipt: alteredPreflightReceiptIdentity,
        },
      });
      await writeFile(join(repoRoot, manifest.path), alteredPreflightManifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, alteredPreflightManifestRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("request or transport evidence"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, preflightReceipt.path), preflightReceiptRaw);
      Object.assign(
        preflightReceipt,
        evidenceIdentity(preflightReceipt.path, preflightReceiptRaw),
      );
      await writeFile(join(repoRoot, manifest.path), manifestRaw);
      Object.assign(
        artifact.artifacts.manifest,
        evidenceIdentity(manifest.path, manifestRaw),
      );

      const scenarioReceiptRaw = await readFile(
        join(repoRoot, scenarioReceipt.path),
        "utf8",
      );
      const alteredScenarioReceipt = JSON.parse(scenarioReceiptRaw) as {
        stdout: { path: string };
      };
      const scenarioStdoutPath = alteredScenarioReceipt.stdout.path;
      const scenarioStdoutRaw = await readFile(
        join(repoRoot, scenarioStdoutPath),
        "utf8",
      );
      const alteredScenarioStdoutRaw = "9 pass\n0 fail\n";
      await writeFile(
        join(repoRoot, scenarioStdoutPath),
        alteredScenarioStdoutRaw,
      );
      alteredScenarioReceipt.stdout = evidenceIdentity(
        scenarioStdoutPath,
        alteredScenarioStdoutRaw,
      );
      const alteredScenarioRaw = json(alteredScenarioReceipt);
      await writeFile(join(repoRoot, scenarioReceipt.path), alteredScenarioRaw);
      Object.assign(
        artifact.artifacts.scenarioReceipt,
        evidenceIdentity(scenarioReceipt.path, alteredScenarioRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("bound logs"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, scenarioReceipt.path), scenarioReceiptRaw);
      await writeFile(join(repoRoot, scenarioStdoutPath), scenarioStdoutRaw);
      Object.assign(
        artifact.artifacts.scenarioReceipt,
        evidenceIdentity(scenarioReceipt.path, scenarioReceiptRaw),
      );

      const formalReceiptRaw = await readFile(
        join(repoRoot, candidateFormalReceipt.path),
        "utf8",
      );
      const alteredFormalReceipt = JSON.parse(formalReceiptRaw) as {
        commandChain: { seedSmoke: { args: string[] } };
      };
      alteredFormalReceipt.commandChain.seedSmoke.args.push("--drifted");
      const alteredFormalRaw = json(alteredFormalReceipt);
      await writeFile(join(repoRoot, candidateFormalReceipt.path), alteredFormalRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, alteredFormalRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("drifted from the recipe"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, candidateFormalReceipt.path), formalReceiptRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, formalReceiptRaw),
      );

      const reorderedFormalReceipt = JSON.parse(formalReceiptRaw) as {
        session: { requestSequence: unknown[] };
      };
      reorderedFormalReceipt.session.requestSequence.reverse();
      const reorderedFormalRaw = json(reorderedFormalReceipt);
      await writeFile(
        join(repoRoot, candidateFormalReceipt.path),
        reorderedFormalRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, reorderedFormalRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("input or transport ledger is invalid"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, candidateFormalReceipt.path), formalReceiptRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, formalReceiptRaw),
      );

      const missingMismatchLedgerReceipt = JSON.parse(formalReceiptRaw) as {
        session: { sequenceMismatchDetails?: unknown[] };
      };
      delete missingMismatchLedgerReceipt.session.sequenceMismatchDetails;
      const missingMismatchLedgerRaw = json(missingMismatchLedgerReceipt);
      await writeFile(
        join(repoRoot, candidateFormalReceipt.path),
        missingMismatchLedgerRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, missingMismatchLedgerRaw),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("input or transport ledger is invalid"),
        status: "fail",
      }));
      await writeFile(join(repoRoot, candidateFormalReceipt.path), formalReceiptRaw);
      Object.assign(
        artifact.artifacts.providerReplay.candidateFormalReceipt,
        evidenceIdentity(candidateFormalReceipt.path, formalReceiptRaw),
      );

      const discoveryReceiptRaw = await readFile(
        join(repoRoot, candidateDiscoveryReceipt.path),
        "utf8",
      );
      const rawTransportErrorReceipt = JSON.parse(discoveryReceiptRaw) as {
        session: { transportAttemptLedger: Array<Record<string, unknown>> };
      };
      rawTransportErrorReceipt.session.transportAttemptLedger[0]!.rawMessage =
        "must-not-persist";
      const rawTransportErrorReceiptRaw = json(rawTransportErrorReceipt);
      await writeFile(
        join(repoRoot, candidateDiscoveryReceipt.path),
        rawTransportErrorReceiptRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateDiscoveryReceipt,
        evidenceIdentity(
          candidateDiscoveryReceipt.path,
          rawTransportErrorReceiptRaw,
        ),
      );
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("transport ledger is invalid"),
        status: "fail",
      }));
      await writeFile(
        join(repoRoot, candidateDiscoveryReceipt.path),
        discoveryReceiptRaw,
      );
      Object.assign(
        artifact.artifacts.providerReplay.candidateDiscoveryReceipt,
        evidenceIdentity(candidateDiscoveryReceipt.path, discoveryReceiptRaw),
      );

      const alternateBody = JSON.stringify({ targetId: "eval-alternate" });
      const alternateResponse = Buffer.from("ok-eval-alternate");
      const alternateTape = {
        entries: tapeEntries.map((entry) => entry.request.targetId === "eval"
          ? {
              fingerprint: fingerprintProviderRequest({
                body: alternateBody,
                method: "POST",
                path: "/chat/completions",
                targetId: "eval",
              }),
              occurrence: 0,
              request: {
                canonicalBodySha256: createHash("sha256")
                  .update(alternateBody)
                  .digest("hex"),
                method: "POST",
                path: "/chat/completions",
                semanticHeadersSha256,
                targetId: "eval",
              },
              response: {
                bodyBase64: alternateResponse.toString("base64"),
                bytes: alternateResponse.byteLength,
                contentType: "text/plain",
                sha256: createHash("sha256").update(alternateResponse).digest("hex"),
                status: 200,
                statusText: "OK",
              },
            }
          : entry),
        schemaVersion: 3 as const,
      };
      const alternateTapeRaw = serializeProviderResponseTape(alternateTape);
      const alternateTapeSha256 = createHash("sha256")
        .update(alternateTapeRaw)
        .digest("hex");
      const alteredProtocolInput = structuredClone(protocolInput);
      alteredProtocolInput.providerReplay.tapeSha256 = alternateTapeSha256;
      for (const session of [
        alteredProtocolInput.providerReplay.discovery.baseline,
        alteredProtocolInput.providerReplay.discovery.candidate,
        alteredProtocolInput.providerReplay.formal.baseline,
        alteredProtocolInput.providerReplay.formal.candidate,
      ]) {
        session.tapeSha256 = alternateTapeSha256;
      }
      const alteredProtocolInputRaw = json(alteredProtocolInput);
      Object.assign(tape, await writeTapeBundle(alternateTape));
      await writeFile(
        join(repoRoot, protocolInputIdentity.path),
        alteredProtocolInputRaw,
      );
      Object.assign(
        protocolInputIdentity,
        evidenceIdentity(protocolInputIdentity.path, alteredProtocolInputRaw),
      );
      const receiptIdentities = [
        baselineDiscoveryReceipt,
        candidateDiscoveryReceipt,
        baselineFormalReceipt,
        candidateFormalReceipt,
      ];
      const receiptRaws = await Promise.all(receiptIdentities.map((identity) =>
        readFile(join(repoRoot, identity.path), "utf8")
      ));
      for (const [index, identity] of receiptIdentities.entries()) {
        const receipt = JSON.parse(receiptRaws[index]!) as {
          session: { tapeSha256: string };
        };
        receipt.session.tapeSha256 = alternateTapeSha256;
        const raw = json(receipt);
        await writeFile(join(repoRoot, identity.path), raw);
        Object.assign(identity, evidenceIdentity(identity.path, raw));
      }
      Object.assign(artifact, evaluateV073ReplacementProtection(alteredProtocolInput), {
        artifacts: artifact.artifacts,
      });
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath:
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(
          "does not exactly cover discovery sequences",
        ),
        status: "fail",
      }));
      const protocolInputRaw = json(protocolInput);
      Object.assign(
        tape,
        await writeTapeBundle({ entries: tapeEntries, schemaVersion: 3 }),
      );
      await writeFile(join(repoRoot, protocolInputIdentity.path), protocolInputRaw);
      Object.assign(
        protocolInputIdentity,
        evidenceIdentity(protocolInputIdentity.path, protocolInputRaw),
      );
      for (const [index, identity] of receiptIdentities.entries()) {
        const raw = receiptRaws[index]!;
        await writeFile(join(repoRoot, identity.path), raw);
        Object.assign(identity, evidenceIdentity(identity.path, raw));
      }
      Object.assign(artifact, evaluateV073ReplacementProtection(protocolInput), {
        artifacts: artifact.artifacts,
      });

      await writeFile(join(repoRoot, c1Baseline.path), "{}\n");
      expect(await evaluateV073LifecycleProtectionBundle({
        artifact,
        artifactPath: "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        repoRoot,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining("bytes do not match"),
        status: "fail",
      }));
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("[stable-source-correction-lineage] exposes a fail-closed exact A-R0-D2-G2-A2 validator", async () => {
    const readiness = await import("../../scripts/run-v0-7-release-readiness");
    const evaluate = (readiness as unknown as Record<string, unknown>)[
      "evaluateV073StableSourceTestCorrection"
    ];
    const source = readFileSync(
      new URL("../../scripts/run-v0-7-release-readiness.ts", import.meta.url),
      "utf8",
    );

    expect(typeof evaluate).toBe("function");
    if (typeof evaluate !== "function") {
      return;
    }
    const check = (evaluate as (input: unknown) => { status: string })({});
    expect(check.status).toBe("fail");
    expect(source).toContain("b9c9b796803b9a7a39a491abe95d4c9f802a2520");
    expect(source).toContain("6928ffdd7545a609495ed483bc8878894980301f");
    expect(source).toContain(
      "v0.7.3-stable-source-test-correction-preregistration.json",
    );
    expect(source).toContain(
      "v0.7.3-stable-source-test-correction-attestation.json",
    );
  });

  it("[cross-host-lifecycle-verifier-correction-lineage] exposes a fail-closed exact A2-D3-G3-A3 validator", async () => {
    const readiness = await import("../../scripts/run-v0-7-release-readiness");
    const evaluate = (readiness as unknown as Record<string, unknown>)[
      "evaluateV073CrossHostLifecycleVerifierCorrection"
    ];
    const source = readFileSync(
      new URL("../../scripts/run-v0-7-release-readiness.ts", import.meta.url),
      "utf8",
    );

    expect(typeof evaluate).toBe("function");
    if (typeof evaluate !== "function") {
      return;
    }
    const check = (evaluate as (input: unknown) => { status: string })({});
    expect(check.status).toBe("fail");
    expect(source).toContain("a7f78e2b3f324febb227f548c299f57ea487044e");
    expect(source).toContain(
      "v0.7.3-cross-host-lifecycle-verifier-correction-preregistration.json",
    );
    expect(source).toContain(
      "v0.7.3-cross-host-lifecycle-verifier-correction-attestation.json",
    );
  });

  it("allows a later tracked attestation commit without requiring an impossible self-reference", () => {
    const candidatePackage = {
      goodmemoryRelease: {
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "release-candidate",
      },
      name: "goodmemory",
      version: "0.7.3",
    };
    const releasePackage = {
      ...candidatePackage,
      goodmemoryRelease: {
        ...candidatePackage.goodmemoryRelease,
        status: "stable",
      },
    };

    expect(evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage,
      changedPaths: [
        ".well-known/goodmemory.json",
        "benchmark-claims/locomo.json",
        "benchmark-claims/evidence/locomo-v0.7.3-current.json",
        "docs/GoodMemory-Current-Status-and-Evidence.md",
        "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
        "docs/README.md",
        "kimi.plugin.json",
        "llms.txt",
        "package.json",
        "README.md",
        "README.zh-CN.md",
        "reports/release/v0.7/phase-74-storage-scale-gate.json",
        "reports/release/v0.7/readiness-report.json",
        "reports/release/v0.7/summary.md",
        "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json",
        "reports/release/v0.7/v0.7.3-full-claim-protocol2-preregistration.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/claim-recipe-source.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/execution-receipt.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/final-smoke-report.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/official-progress.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/official-rescore-summary.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/official-runner-source.ts",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-extraction-cache.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-live-progress.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-attempt-1-smoke-report.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-extraction-cache.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-live-progress.jsonl",
        "reports/release/v0.7/v0.7.3-locomo-claim-evidence/seed-smoke-report.json",
        "server.json",
      ],
      currentCommit: "b".repeat(40),
      currentPackage: releasePackage,
      isAncestor: true,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("evidence-only descendant"),
      status: "pass",
    }));
  });

  it("rejects unrelated documentation, report, and benchmark drift after the protocol candidate", () => {
    const packageJson = {
      goodmemoryRelease: { status: "release-candidate" },
      name: "goodmemory",
      version: "0.7.3",
    };

    for (const forbiddenPath of [
      "docs/unrelated-release-note.md",
      "reports/release/v0.7/unrelated-attestation.json",
      "benchmark-claims/unrelated.json",
    ]) {
      expect(evaluateV073LifecycleProtectionSourceDrift({
        candidateCommit: "a".repeat(40),
        candidatePackage: packageJson,
        changedPaths: [forbiddenPath],
        currentCommit: "b".repeat(40),
        currentPackage: packageJson,
        isAncestor: true,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(forbiddenPath),
        status: "fail",
      }));
    }
  });

  it("allows only the exact protocol-v2 implementation and prior evidence between lifecycle and protocol candidates", () => {
    const lifecycleCandidateCommit = "a".repeat(40);
    const protocolCandidateCommit = "b".repeat(40);
    const allowed = evaluateV073LifecycleToProtocolSourceDrift({
      changedPaths: [
        ".github/workflows/release.yml",
        ".gitignore",
        "bun.lock",
        "docs/GoodMemory-Current-Status-and-Evidence.md",
        "docs/README.md",
        "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
        "package-lock.json",
        "package.json",
        "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json",
        "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence/manifest.json",
        "reports/release/v0.7/v0.7.3-locomo-claim-attempt-1-failed/attribution.md",
        "reports/release/v0.7/v0.7.3-locomo-claim-attempt-2-failed/attribution.md",
        "scripts/run-coverage.ts",
        "scripts/run-v0-7-release-readiness.ts",
        "tests/quality-gates/phase-73/codex-coding-effect.c6-protocol-readiness.gate.ts",
        "tests/release/release.test.ts",
        "tests/release/v0-7-stable-artifact.test.ts",
        "tests/integration/codex-coding-effect.c6-protocol-readiness.test.ts",
        "tests/unit/run-coverage.script.test.ts",
        "tests/unit/run-v0-7-3-lifecycle-protection-gate.test.ts",
        "tests/unit/run-v0-7-release-readiness.test.ts",
      ],
      dependencyPinningValid: true,
      isAncestor: true,
      lifecycleCandidateCommit,
      protocolCandidateCommit,
    });
    expect(allowed).toEqual(expect.objectContaining({
      detail: expect.stringContaining(protocolCandidateCommit),
      status: "pass",
    }));

    for (const forbiddenPath of [
      "src/recall/scoring.ts",
      "benchmark-claims/locomo.json",
      "scripts/run-phase-65-locomo-smoke.ts",
      "scripts/reanswer-phase-65-locomo-report.ts",
      "scripts/rescore-official-protocols.ts",
      "scripts/run-v0-7-3-lifecycle-protection-gate.ts",
      "scripts/unrelated-release-helper.ts",
      "tests/unit/unrelated-release-helper.test.ts",
    ]) {
      expect(evaluateV073LifecycleToProtocolSourceDrift({
        changedPaths: [forbiddenPath],
        isAncestor: true,
        lifecycleCandidateCommit,
        protocolCandidateCommit,
      })).toEqual(expect.objectContaining({
        detail: expect.stringContaining(forbiddenPath),
        status: "fail",
      }));
    }

    expect(evaluateV073LifecycleToProtocolSourceDrift({
      changedPaths: ["bun.lock", "package-lock.json", "package.json"],
      dependencyPinningValid: false,
      isAncestor: true,
      lifecycleCandidateCommit,
      protocolCandidateCommit,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("dependency pinning"),
      status: "fail",
    }));
  });

  it("accepts only the exact AI SDK caret-to-measured dependency pinning", () => {
    const beforeDependencies = {
      "@ai-sdk/anthropic": "^3.0.64",
      "@ai-sdk/openai": "^3.0.49",
      "@ai-sdk/openai-compatible": "^2.0.40",
      "@ai-sdk/provider-utils": "^4.0.21",
      ai: "^6.0.143",
      zod: "^4.3.6",
    };
    const afterDependencies = {
      "@ai-sdk/anthropic": "3.0.64",
      "@ai-sdk/openai": "3.0.49",
      "@ai-sdk/openai-compatible": "2.0.40",
      "@ai-sdk/provider-utils": "4.0.23",
      ai: "6.0.143",
      zod: "^4.3.6",
    };
    const providerUtils21 = { license: "Apache-2.0", version: "4.0.21" };
    const providerUtils23 = { license: "Apache-2.0", version: "4.0.23" };
    const providerUtils21Registry = {
      integrity:
        "sha512-MtFUYI1/8mgDvRmaBDjbLJPFFrMG777AvSgyIFQtZHIMzm88R/12vYBBpnk7pfiWLFE1DSZzY4WDYzGbKAcmiw==",
      resolved:
        "https://registry.npmjs.org/@ai-sdk/provider-utils/-/provider-utils-4.0.21.tgz",
    };
    const providerUtils23Registry = {
      integrity:
        "sha512-z8GlDaCmRSDlqkMF2f4/RFgWxdarvIbyuk+m6WXT1LYgsnGiXRJGTD2Z1+SDl3LqtFuRtGX1aghYvQLoHL/9pg==",
      resolved:
        "https://registry.npmjs.org/@ai-sdk/provider-utils/-/provider-utils-4.0.23.tgz",
    };
    const lifecycleRaws = {
      "bun.lock": `${JSON.stringify({ dependencies: beforeDependencies }, null, 2)}\n`,
      "package-lock.json": `${JSON.stringify({
        packages: {
          "": { dependencies: beforeDependencies },
          "node_modules/@ai-sdk/openai-compatible/node_modules/@ai-sdk/provider-utils":
            providerUtils23,
          "node_modules/@ai-sdk/provider-utils": providerUtils21,
        },
      }, null, 2)}\n`,
      "package.json": `${JSON.stringify({ dependencies: beforeDependencies }, null, 2)}\n`,
    };
    const protocolRaws = {
      "bun.lock": `${JSON.stringify({ dependencies: afterDependencies }, null, 2)}\n`,
      "package-lock.json": `${JSON.stringify({
        packages: {
          "": { dependencies: afterDependencies },
          "node_modules/@ai-sdk/anthropic/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
          "node_modules/@ai-sdk/gateway/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
          "node_modules/@ai-sdk/openai/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
          "node_modules/@ai-sdk/provider-utils": {
            ...providerUtils23,
            ...providerUtils23Registry,
          },
          "node_modules/ai/node_modules/@ai-sdk/provider-utils": {
            ...providerUtils21,
            ...providerUtils21Registry,
          },
        },
      }, null, 2)}\n`,
      "package.json": `${JSON.stringify({ dependencies: afterDependencies }, null, 2)}\n`,
    };

    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws,
    })).toBe(true);
    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws: {
        ...protocolRaws,
        "package.json": protocolRaws["package.json"].replace(
          '"zod": "^4.3.6"',
          '"zod": "4.3.6"',
        ),
      },
    })).toBe(false);
    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws: {
        ...protocolRaws,
        "package-lock.json": protocolRaws["package-lock.json"].replace(
          providerUtils21Registry.integrity,
          "sha512-attacker-controlled-bytes==",
        ),
      },
    })).toBe(false);
    expect(isV073ProtocolDependencyPinningExact({
      lifecycleRaws,
      protocolRaws: {
        ...protocolRaws,
        "package-lock.json": protocolRaws["package-lock.json"].replace(
          providerUtils23Registry.resolved,
          "https://example.invalid/provider-utils-4.0.23.tgz",
        ),
      },
    })).toBe(false);
  });

  it("uses the frozen measured candidate recipe after later audit metadata changes", () => {
    const identity = {
      bytes: Buffer.byteLength(CLAIM_RECIPE_RAW, "utf8"),
      path: "benchmark-claims/locomo.json",
      sha256: createHash("sha256").update(CLAIM_RECIPE_RAW).digest("hex"),
    };
    const publishedClaimRaw = `${JSON.stringify({
      claim: "fresh v0.7.3 publication",
      schemaVersion: 1,
    }, null, 2)}\n`;

    expect(resolveV073MeasuredClaimRecipeRaw({
      candidateGitObjectRaw: CLAIM_RECIPE_RAW,
      currentClaimRecipeRaw: publishedClaimRaw,
      identity,
    })).toBe(CLAIM_RECIPE_RAW);
    expect(() => resolveV073MeasuredClaimRecipeRaw({
      candidateGitObjectRaw: `${CLAIM_RECIPE_RAW} `,
      currentClaimRecipeRaw: publishedClaimRaw,
      identity,
    })).toThrow("measured candidate claim recipe");
  });

  it("rejects post-measurement execution drift and non-status package changes", () => {
    const packageJson = {
      goodmemoryRelease: { status: "release-candidate" },
      name: "goodmemory",
      version: "0.7.3",
    };
    const drift = evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage: packageJson,
      changedPaths: [
        "src/recall/scoring.ts",
        "scripts/run-phase-65-locomo-smoke.ts",
        "tests/unit/recall.scoring.test.ts",
        ".github/workflows/release.yml",
        ".gitignore",
      ],
      currentCommit: "b".repeat(40),
      currentPackage: packageJson,
      isAncestor: true,
    });
    expect(drift.status).toBe("fail");
    expect(drift.detail).toContain("src/recall/scoring.ts");
    expect(drift.detail).not.toContain(".github/workflows/release.yml");
    expect(drift.detail).toContain(".gitignore");

    expect(evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage: packageJson,
      changedPaths: ["package.json"],
      currentCommit: "b".repeat(40),
      currentPackage: { ...packageJson, version: "0.7.4" },
      isAncestor: true,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("package.json"),
      status: "fail",
    }));

    expect(evaluateV073LifecycleProtectionSourceDrift({
      candidateCommit: "a".repeat(40),
      candidatePackage: packageJson,
      changedPaths: [],
      currentCommit: "b".repeat(40),
      currentPackage: packageJson,
      isAncestor: false,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("not an ancestor"),
      status: "fail",
    }));
  });

  it("keeps the immutable v0.7.3 lifecycle closure historical on v0.7.4", async () => {
    const fixture = await createFrozenV074Checkout();
    try {
      const currentCommit = runFixtureGit(fixture.repoRoot, "rev-parse", "HEAD");
      const checks = await evaluateV073LifecycleProtectionArtifactFile({
        artifactPath: join(
          fixture.repoRoot,
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        ),
        currentCommit,
        repoRoot: fixture.repoRoot,
      });

      expect(checks).toHaveLength(5);
      expect(checks.filter((check) => check.status === "fail")).toEqual([]);
      expect(checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "v0.7.3-protocol-source",
          status: "pass",
        }),
        expect.objectContaining({
          detail: expect.stringContaining("historical"),
          id: "v0.7.3-lifecycle-source",
          status: "pass",
        }),
        expect.objectContaining({
          id: "v0.7.3-stable-source-test-correction",
          status: "pass",
        }),
        expect.objectContaining({
          id: "v0.7.3-cross-host-lifecycle-verifier-correction",
          status: "pass",
        }),
      ]));
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  }, 30_000);

  it("reads retired stable-source evidence from its frozen commit after the current source is deleted", async () => {
    const checkout = await createFrozenV074Checkout();
    const fixture = await createFixtureCommitWithoutPath(
      checkout.repoRoot,
      "tests/unit/run-v0-7-3-full-locomo-claim.test.ts",
    );
    try {
      const checks = await evaluateV073LifecycleProtectionArtifactFile({
        artifactPath: join(
          checkout.repoRoot,
          "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
        ),
        currentCommit: fixture.commit,
        repoRoot: checkout.repoRoot,
      });

      expect(checks).toHaveLength(5);
      expect(checks.filter((check) => check.status === "fail")).toEqual([]);
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
      await rm(checkout.temporaryDirectory, { force: true, recursive: true });
    }
  }, 30_000);

  it("binds historical evidence checks to repoRoot instead of ambient GIT_DIR", async () => {
    const fixture = await createFrozenV074Checkout();
    const repoRoot = fixture.repoRoot;
    await symlink(join(REPOSITORY_ROOT, "node_modules"), join(repoRoot, "node_modules"));
    const currentCommit = runFixtureGit(repoRoot, "rev-parse", "HEAD");
    const artifactPath = join(
      repoRoot,
      "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    );
    const source = `
      import { evaluateV073LifecycleProtectionArtifactFile } from ${JSON.stringify(
        join(repoRoot, "scripts/run-v0-7-release-readiness.ts"),
      )};
      const checks = await evaluateV073LifecycleProtectionArtifactFile({
        artifactPath: ${JSON.stringify(artifactPath)},
        currentCommit: ${JSON.stringify(currentCommit)},
        repoRoot: ${JSON.stringify(repoRoot)},
      });
      process.exit(checks.every((check) => check.status === "pass") ? 0 : 1);
    `;
    try {
      const result = Bun.spawnSync(["bun", "--no-env-file", "-e", source], {
        cwd: repoRoot,
        env: {
          ...process.env,
          GIT_DIR: join(tmpdir(), "goodmemory-decoy-git"),
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `${result.stdout.toString()}\n${result.stderr.toString()}`.trim(),
        );
      }
    } finally {
      await rm(fixture.temporaryDirectory, { force: true, recursive: true });
    }
  }, 30_000);

  it("requires the frozen v0.7.3 measured candidate in later release history", () => {
    const candidateCommit = "a".repeat(40);
    const currentCommit = "b".repeat(40);

    expect(evaluateV073HistoricalSourceLineage({
      candidateCommit,
      currentCommit,
      isAncestor: true,
    })).toEqual(expect.objectContaining({ status: "pass" }));
    expect(evaluateV073HistoricalSourceLineage({
      candidateCommit,
      currentCommit,
      isAncestor: false,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("not an ancestor"),
      status: "fail",
    }));
  });

  it("runs every mandatory release command instead of a focused substitute", () => {
    expect(V07_RELEASE_REQUIRED_COMMANDS).toEqual([
      {
        args: ["run", "typecheck"],
        command: "bun",
        id: "typecheck",
      },
      {
        args: ["test", "--timeout=300000"],
        command: "bun",
        id: "tests",
      },
      {
        args: ["run", "test:coverage"],
        command: "bun",
        id: "coverage",
      },
      {
        args: ["run", "build"],
        command: "bun",
        id: "build",
      },
      {
        args: ["run", "gate:public-benchmark-claim", "--strict"],
        command: "bun",
        id: "public-claims",
      },
      {
        args: [
          "run",
          "gate:phase-74-storage-scale",
          "--output",
          "reports/release/v0.7/phase-74-storage-scale-gate.json",
        ],
        command: "bun",
        id: "scale",
      },
      {
        args: [
          "test",
          "tests/integration/storage.postgres.test.ts",
          "tests/integration/api.postgres.test.ts",
        ],
        command: "bun",
        id: "postgres",
        requiredEnvironment: "GOODMEMORY_TEST_POSTGRES_URL",
      },
    ]);
  });

  it("fails readiness when a required check is skipped", () => {
    expect(
      evaluateV07RequiredChecks([
        {
          detail: "skipped via --skip-tests",
          durationMs: 0,
          id: "tests",
          required: true,
          status: "skip",
          title: "Full canonical Bun test suite",
        },
      ]),
    ).toBe(false);
  });

  it("fails the real Postgres check when its required URL is unavailable", () => {
    expect(
      evaluateV07RequiredEnvironment({
        environment: {},
        environmentName: "GOODMEMORY_TEST_POSTGRES_URL",
        id: "postgres",
        title: "Real Postgres gate",
      }),
    ).toEqual({
      detail: "GOODMEMORY_TEST_POSTGRES_URL is required for the release gate",
      durationMs: 0,
      id: "postgres",
      required: true,
      status: "fail",
      title: "Real Postgres gate",
    });
    expect(
      evaluateV07RequiredEnvironment({
        environment: {
          GOODMEMORY_TEST_POSTGRES_URL: "postgres://localhost/goodmemory",
        },
        environmentName: "GOODMEMORY_TEST_POSTGRES_URL",
        id: "postgres",
        title: "Real Postgres gate",
      }),
    ).toBeUndefined();
  });

  it("prohibits skip flags in strict mode", () => {
    expect(() =>
      parseV07ReleaseReadinessCliOptions(["--strict", "--skip-tests"]),
    ).toThrow("--strict cannot be combined with release-check skip flags.");
  });

  it("passes the configured Postgres URL into the active release prepare workflow", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("secrets.GOODMEMORY_TEST_POSTGRES_URL");
    expect(workflow).toContain(
      "bun scripts/release.ts prepare --output-dir \"$RELEASE_OUTPUT_DIR\"",
    );
    expect(workflow).not.toContain("--strict");
    expect(workflow).not.toContain("reports/release/v0.7/");
    const gitignore = readFileSync(
      new URL("../../.gitignore", import.meta.url),
      "utf8",
    );
    expect(gitignore).toContain(
      "!reports/release/v0.7/v0.7.3-lifecycle-protection.json",
    );
    expect(gitignore).not.toContain("!reports/release/v0.7/**");
  });

  it("renders the v0.7 verdict and escapes markdown table pipes", () => {
    const markdown = renderV07ReleaseSummary(report());
    expect(markdown).toContain("# v0.7 Release Readiness");
    expect(markdown).toContain("REQUIRED CHECK(S) FAILED");
    expect(markdown).toContain("too large \\| 4194305 bytes");
    expect(markdown).toContain("## Failure Details");
    expect(markdown).toContain("tarball is too large | 4194305 bytes");
    expect(markdown).toContain(`source commit: ${"a".repeat(40)}`);
    expect(markdown).toContain("runtime: Node v20.19.0 / Bun 1.3.14");
  });

  it("summarizes command failures from signal lines before skipped-test tails", () => {
    const summarized = summarizeCommandFailureOutput([
      "bun test v1.3.14",
      "(pass) unrelated > succeeds [1.00ms]",
      "error: expected noisy diagnostic from a passing test",
      "(pass) noisy test still succeeds [2.00ms]",
      "(pass) spacer one [1.00ms]",
      "(pass) spacer two [1.00ms]",
      "(pass) spacer three [1.00ms]",
      "(pass) spacer four [1.00ms]",
      "(pass) spacer five [1.00ms]",
      "tests/unit/example.test.ts:",
      "(fail) important suite > exposes the real failure [5010.00ms]",
      "^ this test timed out",
      "error: expect(received).toBe(expected)",
      "(skip) noisy tail > skipped real evidence one",
      "(skip) noisy tail > skipped real evidence two",
      "(skip) noisy tail > skipped real evidence three",
    ].join("\n"));

    expect(summarized).toContain("(fail) important suite");
    expect(summarized).toContain("^ this test timed out");
    expect(summarized).not.toContain("expected noisy diagnostic");
    expect(summarized.trimStart().startsWith("(skip)")).toBe(false);
  });
});
