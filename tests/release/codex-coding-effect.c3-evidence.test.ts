import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  verifyC3RunnerSourceReproducibility,
} from "../../scripts/codex-coding-effect/c3-source-reproducibility";
import type {
  C3RunnerSourceReproducibilityVerification,
} from "../../scripts/codex-coding-effect/c3-source-reproducibility";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const EVIDENCE_ROOT = join(
  REPOSITORY_ROOT,
  "reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003",
);
const SOURCE_REPRODUCIBILITY_ROOT = join(
  REPOSITORY_ROOT,
  "reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003-source-reproducibility",
);

describe("Codex coding-effect C3 tracked evidence", () => {
  it("binds the internally accepted clean-clone projection without promoting its tie to uplift", async () => {
    const [
      baseHealthBytes,
      hostPreflightBytes,
      identityBytes,
      manifestBytes,
      summaryBytes,
      verificationBytes,
    ] = await Promise.all([
      readFile(join(EVIDENCE_ROOT, "base-health.json"), "utf8"),
      readFile(join(EVIDENCE_ROOT, "host-preflight.sanitized.json"), "utf8"),
      readFile(join(EVIDENCE_ROOT, "run-identity.json"), "utf8"),
      readFile(join(EVIDENCE_ROOT, "projection-manifest.json"), "utf8"),
      readFile(join(EVIDENCE_ROOT, "summary.json"), "utf8"),
      readFile(join(EVIDENCE_ROOT, "c3-verification.json"), "utf8"),
    ]);
    const baseHealth = JSON.parse(baseHealthBytes) as {
      passed: boolean;
      reasons: string[];
    };
    const hostPreflight = JSON.parse(hostPreflightBytes) as {
      codex: {
        model: string;
        reasoningEffort: string;
        version: string;
      };
      goodmemory: {
        packageSha256: string;
        version: string;
      };
      networkMode: string;
      repository: {
        dirtyStatePolicy: string;
      };
      schemaVersion: number;
    };
    const identity = JSON.parse(identityBytes) as {
      arms: Record<string, {
        permissionIsolation: {
          audit: {
            deniedReads: Array<{
              denied: boolean;
              label: string;
            }>;
            networkDenied: boolean;
            passed: boolean;
          };
        };
      }>;
      evidenceClass: string;
      goodMemorySource: {
        commit: string;
        dirty: boolean;
        tree: string;
      };
      hostPreflightSha256: string;
      runId: string;
      runnerSource: {
        commit: string;
        dirty: boolean;
        tree: string;
      };
    };
    const manifest = JSON.parse(manifestBytes) as {
      evidenceClass: string;
      files: Array<{
        bytes: number;
        path: string;
        sha256: string;
      }>;
      runId: string;
    };
    const summary = JSON.parse(summaryBytes) as Record<string, unknown>;
    const verification = JSON.parse(verificationBytes) as Record<string, unknown>;

    expect(baseHealth).toEqual({
      ...baseHealth,
      passed: true,
      reasons: [],
    });
    expect(summary).toMatchObject({
      attemptedCount: 2,
      comparablePairs: 1,
      evidenceClass: "frozen-prehistory-pilot",
      finalizedCount: 2,
      infrastructureFailureCount: 0,
      memoryDiagnosticsUsedForTaskScore: false,
      outcome: "tie-both-pass",
      publicClaimEligible: false,
      resolvedCount: 2,
      runId: "c3-controlled-20260716-cleanclone-003",
      taskScoringSource: "deterministic-hidden-tests",
    });
    expect(verification).toEqual({
      decision: "accepted",
      evidenceClass: "frozen-prehistory-pilot",
      externalAuthenticityVerified: false,
      projectionManifestSha256: sha256(manifestBytes),
      reasons: [],
      replayedArmCount: 2,
      runId: "c3-controlled-20260716-cleanclone-003",
      schemaVersion: 1,
      verificationScope: "internal-consistency-and-clean-clone-patch-replay",
      verifiedFileCount: 17,
    });
    expect(manifest).toMatchObject({
      evidenceClass: "frozen-prehistory-pilot",
      runId: "c3-controlled-20260716-cleanclone-003",
    });
    expect(manifest.files).toHaveLength(17);
    for (const file of manifest.files) {
      const bytes = await readFile(join(EVIDENCE_ROOT, file.path));
      expect(bytes.byteLength).toBe(file.bytes);
      expect(sha256(bytes)).toBe(file.sha256);
    }

    expect(identity).toMatchObject({
      evidenceClass: "frozen-prehistory-pilot",
      goodMemorySource: {
        commit: "594ee5406ff082f6210d4be4f763f529f13a1a9f",
        dirty: false,
        tree: "af13dc2688a0e3636f2c2e40728a47eb52ce90eb",
      },
      hostPreflightSha256: sha256(hostPreflightBytes),
      runId: "c3-controlled-20260716-cleanclone-003",
      runnerSource: {
        commit: "fc31f4f96f3975daea361805da3fc4fc942c5aa4",
        dirty: false,
        tree: "996b1c24bfb53a9d9c62eb109997576df7b512af",
      },
    });
    const requiredDeniedLabels = [
      "codex-auth-source",
      "controlled-evaluator-source",
      "current-runtime-auth",
      "current-runtime-config",
      "goodmemory-source-package",
      "other-arm-runtime-auth",
      "other-arm-runtime-config",
      "other-arm-workspace",
      "output-root",
      "package-tarball",
      "runner-source",
      "source-repository",
    ];
    for (const arm of Object.values(identity.arms)) {
      expect(arm.permissionIsolation.audit).toMatchObject({
        networkDenied: true,
        passed: true,
      });
      expect(arm.permissionIsolation.audit.deniedReads).toHaveLength(
        requiredDeniedLabels.length,
      );
      expect(arm.permissionIsolation.audit.deniedReads.map((probe) =>
        probe.label
      ).sort()).toEqual([...requiredDeniedLabels].sort());
      expect(arm.permissionIsolation.audit.deniedReads.every((probe) =>
        probe.denied
      )).toBe(true);
    }
    expect(hostPreflight).toMatchObject({
      codex: {
        model: "gpt-5.6-sol",
        reasoningEffort: "xhigh",
        version: "codex-cli 0.144.5",
      },
      goodmemory: {
        packageSha256:
          "4526fc05ee1fadf05ff80e555827af67477724bf5e0d4cd3613452b899a647c3",
        version: "goodmemory 0.5.1",
      },
      networkMode: "disabled",
      repository: {
        dirtyStatePolicy: "reject",
      },
      schemaVersion: 1,
    });
  });

  it("reconstructs the exact runner source and replays the projection from the tracked bundle", async () => {
    const [
      replayedVerificationBytes,
      sourceManifestBytes,
      sourceVerificationBytes,
      status,
    ] = await Promise.all([
      readFile(
        join(SOURCE_REPRODUCIBILITY_ROOT, "replayed-c3-verification.json"),
        "utf8",
      ),
      readFile(join(SOURCE_REPRODUCIBILITY_ROOT, "manifest.json"), "utf8"),
      readFile(join(SOURCE_REPRODUCIBILITY_ROOT, "verification.json"), "utf8"),
      readFile(
        join(REPOSITORY_ROOT, "docs/GoodMemory-Current-Status-and-Evidence.md"),
        "utf8",
      ),
    ]);
    const sourceManifest = JSON.parse(sourceManifestBytes) as Record<string, unknown>;
    const sourceVerification = JSON.parse(sourceVerificationBytes) as
      C3RunnerSourceReproducibilityVerification;
    const replayed = await verifyC3RunnerSourceReproducibility({
      evidenceDirectory: SOURCE_REPRODUCIBILITY_ROOT,
    });

    expect(sha256(sourceManifestBytes)).toBe(
      "cbf8f3c5acd33cf48c24f20de723cb550c1a2685f20e875672874b3a520f16a4",
    );
    expect(sha256(sourceVerificationBytes)).toBe(
      "7ddaa17f3fbd000bf5563ecd489c5a508f543157a69cebc63d0572f65202406c",
    );
    expect(sourceManifest).toMatchObject({
      bundle: {
        bytes: 4_891_617,
        path: "runner-source.bundle",
        ref: "refs/heads/c3-snapshot-003",
        sha256: "86aa767660b30fc9b6930c166c86cd9415d2e0083919e629abbdd9ef1d613ecb",
      },
      projectionManifestSha256:
        "1210f9908154af56b68c22f5235eff1a19824d009c2cd06a5ec9932b869f5008",
      runId: "c3-controlled-20260716-cleanclone-003",
      runnerSource: {
        commit: "fc31f4f96f3975daea361805da3fc4fc942c5aa4",
        tree: "996b1c24bfb53a9d9c62eb109997576df7b512af",
      },
      schemaVersion: 1,
    });
    expect(sourceVerification).toMatchObject({
      decision: "accepted",
      externalAuthenticityVerified: false,
      reasons: [],
      replayedArmCount: 2,
      runnerSourceReproducible: true,
      verificationScope:
        "bundled-recorded-runner-clean-clone-and-projection-replay",
      verifiedFileCount: 17,
    });
    expect(replayed.verification).toEqual(sourceVerification);
    expect(replayed.replayedVerificationBytes).toBe(replayedVerificationBytes);
    expect(status).toContain("C3 source-reproducibility gate is closed");
  });
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
