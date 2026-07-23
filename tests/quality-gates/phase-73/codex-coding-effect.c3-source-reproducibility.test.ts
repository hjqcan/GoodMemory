import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  verifyC3RunnerSourceReproducibility,
} from "../../../scripts/codex-coding-effect/c3-source-reproducibility";
import type {
  C3RunnerSourceReproducibilityVerification,
} from "../../../scripts/codex-coding-effect/c3-source-reproducibility";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_REPRODUCIBILITY_ROOT = join(
  REPOSITORY_ROOT,
  "reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003-source-reproducibility",
);

describe("Codex coding-effect C3 source reproducibility", () => {
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
    const sourceManifest = JSON.parse(sourceManifestBytes) as Record<
      string,
      unknown
    >;
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
        sha256:
          "86aa767660b30fc9b6930c166c86cd9415d2e0083919e629abbdd9ef1d613ecb",
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
