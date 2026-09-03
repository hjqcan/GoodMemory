import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const EVIDENCE_ROOT = join(
  REPOSITORY_ROOT,
  "reports/quality-gates/phase-73/c5-native-comparator-flat-summary-v1",
);
const ARTIFACT_SHA256 = {
  "c5-gate.json":
    "b57073757273de6270a8237bd0e6fb07f894b2606eb2f826d8e345eaedf17d61",
  "c5-verification.json":
    "aae8d8ff9eb1fbebce97f829d56477521504c5074c55505ad745290b43125fe9",
  "independent-review.json":
    "51b0758694b452cc0630bdfd2f808adbe677da44e62226c18e73ea979c8480d4",
  "provenance.json":
    "c276ffbc3eea2da32aa043193dc2911b9cdd46c0b4389f265bae1d9214cc1e30",
  "report.json":
    "570816f96f786ddff3fb97d8cd9be84fa03af6984a0c0830f25a0057a2bce534",
} as const;

// The flat-summary comparator is the control that decides whether the pilot's
// continuity effect belongs to GoodMemory's memory policy or to any compact
// history injected at the same placements. Its tracked evidence binds the
// negative answer and keeps every public-claim flag false.
describe("Codex coding-effect C5 flat-summary comparator tracked evidence", () => {
  it("binds the gate-accepted comparator run and its null effect without a public claim", async () => {
    const artifacts = new Map<string, string>();
    for (const [name, expectedSha256] of Object.entries(ARTIFACT_SHA256)) {
      const bytes = await readFile(join(EVIDENCE_ROOT, name), "utf8");
      expect(sha256(bytes)).toBe(expectedSha256);
      artifacts.set(name, bytes);
    }

    const gate = JSON.parse(artifacts.get("c5-gate.json")!) as {
      decision: string;
      independentReviewSha256: string;
      publicClaimEligible: boolean;
      publicCodingEffectProof: boolean;
      reasons: string[];
      reviewProvenanceSha256: string;
      runId: string;
      verificationSha256: string;
    };
    expect(gate).toMatchObject({
      decision: "accepted",
      independentReviewSha256: ARTIFACT_SHA256["independent-review.json"],
      publicClaimEligible: false,
      publicCodingEffectProof: false,
      reasons: [],
      reviewProvenanceSha256: ARTIFACT_SHA256["provenance.json"],
      runId: "run-c5-canary-flat-20260903T065126Z",
      verificationSha256: ARTIFACT_SHA256["c5-verification.json"],
    });

    const verification = JSON.parse(
      artifacts.get("c5-verification.json")!,
    ) as {
      checks: Record<string, boolean>;
      counts: Record<string, number>;
      decision: string;
      externalAuthenticityVerified: boolean;
      publicClaimEligible: boolean;
    };
    expect(verification).toMatchObject({
      checks: {
        actualFileHashesVerified: true,
        exactPlanTopologyVerified: true,
        hostPreflightVerified: true,
        noInfrastructureFailure: false,
        noLeakageRejection: true,
        noMemoryChannelFailure: true,
        noSilentFallback: true,
        reportRecomputed: true,
      },
      counts: {
        hostPreflights: 12,
        opaqueProcessOnlyTrajectoryOrigins: 70,
        pairs: 36,
        projectedFiles: 428,
        stageExecutions: 72,
      },
      decision: "accepted",
      externalAuthenticityVerified: false,
      publicClaimEligible: false,
    });

    const report = JSON.parse(artifacts.get("report.json")!) as {
      attempts: Record<string, number>;
      comparatorInjection: Record<string, number>;
      effect: Record<string, unknown>;
      pairs: { comparableCount: number; incomparableCount: number };
      publicClaimEligible: boolean;
      readmeRowAllowed: boolean;
    };
    expect(report).toMatchObject({
      attempts: {
        accountedCount: 72,
        codexCompletedCount: 70,
        infrastructureFailureCount: 2,
        memoryChannelFailureCount: 0,
        scheduledCount: 72,
      },
      comparatorInjection: {
        contentInjectionCount: 22,
        hookCanaryFailureCount: 2,
        zeroInjectionCount: 12,
      },
      effect: {
        baselineArm: "flat-summary",
        comparablePairs: 34,
        netRescueRate: 0,
        regressions: 0,
        rescues: 0,
      },
      pairs: { comparableCount: 34, incomparableCount: 2 },
      publicClaimEligible: false,
      readmeRowAllowed: false,
    });
    expect(report.effect.goodMemoryResolveRate).toBe(
      report.effect.baselineResolveRate,
    );
    expect(report.effect.netRescueRateInterval95).toMatchObject({
      lower: 0,
      upper: 0,
    });

    const review = JSON.parse(artifacts.get("independent-review.json")!) as {
      decision: string;
      findings: Array<{ severity: string }>;
      publicClaimEligible: boolean;
    };
    expect(review.decision).toBe("accepted");
    expect(review.publicClaimEligible).toBe(false);
    expect(review.findings.every((finding) => finding.severity === "advisory"))
      .toBe(true);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
