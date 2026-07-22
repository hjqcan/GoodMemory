import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const EVIDENCE_ROOT = join(
  REPOSITORY_ROOT,
  "reports/quality-gates/phase-73/c5-native-longitudinal-pilot-v16",
);
const ARTIFACT_SHA256 = {
  "c5-gate.json":
    "16a7864adbf5c496d004f8b484ece89242cbe92438a84dfee2e0c06ab806380c",
  "c5-verification.json":
    "de8aea82bb832d406256877d902f068037c6e9fb3e1a3530ae24480744d28af8",
  "independent-review.json":
    "bd19614ab8b8034c4cd3fe0db97073765153199a4e0511b0c01b76addef7e5d8",
  "provenance.json":
    "0099cffd09defd0204602a4d1d96d693aa6913cbe20ae517e0aa9539d81c0d66",
  "report.json":
    "5985be5969750286ef2d2af623741e12051d3830f96bd4b8e0907b849b1eab0b",
} as const;

describe("Codex coding-effect C5 tracked evidence", () => {
  it("binds the accepted internal pilot without promoting a public claim", async () => {
    const artifacts = new Map<string, string>();
    for (const [name, expectedSha256] of Object.entries(ARTIFACT_SHA256)) {
      const bytes = await readFile(join(EVIDENCE_ROOT, name), "utf8");
      expect(sha256(bytes)).toBe(expectedSha256);
      artifacts.set(name, bytes);
    }

    const gate = JSON.parse(artifacts.get("c5-gate.json")!) as {
      decision: string;
      publicClaimEligible: boolean;
      publicCodingEffectProof: boolean;
      reasons: string[];
    };
    expect(gate).toMatchObject({
      decision: "accepted",
      publicClaimEligible: false,
      publicCodingEffectProof: false,
      reasons: [],
    });

    const verification = JSON.parse(
      artifacts.get("c5-verification.json")!,
    ) as {
      checks: {
        noInfrastructureFailure: boolean;
        noLeakageRejection: boolean;
        noMemoryChannelFailure: boolean;
        noSilentFallback: boolean;
      };
      counts: {
        opaqueProcessOnlyTrajectoryOrigins: number;
        pairs: number;
        projectedFiles: number;
        stageExecutions: number;
      };
      decision: string;
      externalAuthenticityVerified: boolean;
    };
    expect(verification).toMatchObject({
      checks: {
        noInfrastructureFailure: false,
        noLeakageRejection: true,
        noMemoryChannelFailure: false,
        noSilentFallback: true,
      },
      counts: {
        opaqueProcessOnlyTrajectoryOrigins: 36,
        pairs: 36,
        projectedFiles: 395,
        stageExecutions: 72,
      },
      decision: "accepted",
      externalAuthenticityVerified: false,
    });

    const report = JSON.parse(artifacts.get("report.json")!) as {
      attempts: { accountedCount: number; infrastructureFailureCount: number };
      pairs: { comparableCount: number; incomparableCount: number };
      publicClaimEligible: boolean;
      publicCodingEffectProof: boolean;
      readmeRowAllowed: boolean;
    };
    expect(report).toMatchObject({
      attempts: { accountedCount: 72, infrastructureFailureCount: 6 },
      pairs: { comparableCount: 30, incomparableCount: 6 },
      publicClaimEligible: false,
      publicCodingEffectProof: false,
      readmeRowAllowed: false,
    });

    const review = JSON.parse(artifacts.get("independent-review.json")!) as {
      decision: string;
      findings: Array<{ code: string; severity: string }>;
      reviewerTaskName: string;
    };
    expect(review).toMatchObject({
      decision: "accepted",
      findings: [{
        code: "authenticity-scope-boundary",
        severity: "advisory",
      }],
      reviewerTaskName: "/root/c5_final_independent_review_v1",
    });

    const provenance = JSON.parse(artifacts.get("provenance.json")!) as {
      authorTaskName: string;
      reviewDecision: string;
      reviewer: { agentName: string; contextPolicy: string };
    };
    expect(provenance).toMatchObject({
      authorTaskName: "/root",
      reviewDecision: "accepted",
      reviewer: {
        agentName: "/root/c5_final_independent_review_v1",
        contextPolicy: "fork-turns-none",
      },
    });
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
