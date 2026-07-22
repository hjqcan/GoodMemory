import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadC5PilotReadiness } from "../../../scripts/codex-coding-effect/c5-readiness";
import { withAcceptedC4ReadinessFixture } from "../../support/codex-coding-effect-c4-readiness-fixture";

const DATASET_ROOT = "fixtures/codex-coding-effect/c4-controlled-pilot";

setDefaultTimeout(120_000);

describe("Codex coding-effect C5 readiness", () => {
  it("binds an accepted C4 dataset, baseline, and readiness gate into a zero-write plan", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const result = await loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      });

      expect(result.plan).toMatchObject({
        analysis: { materialEffectPercentagePoints: 10 },
        counts: {
          codexProcesses: 72,
          episodeArmRuns: 24,
          stageRuns: 72,
        },
        datasetId: "codex-c4-controlled-pilot-v2",
        evidenceClass: "native-longitudinal-pilot",
        publicClaimEligible: false,
      });
      expect(result.planSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.prerequisiteEvidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.parse(result.prerequisiteEvidenceBytes)).toMatchObject({
        schemaVersion: 2,
      });
      expect(result.plan.bindings).toMatchObject({
        assetLockSha256: result.c4Readiness.assetLockSha256,
        assetRootSha256: result.c4Readiness.assetRootSha256,
        baselineCeilingReportSha256:
          result.c4Readiness.baselineCeiling.reportSha256,
        c4ReadinessReportSha256: result.c4ReadinessReportSha256,
        manifestSha256: result.c4Readiness.manifestSha256,
      });
      expect(result.planBytes).not.toContain(process.cwd());
      expect(result.planBytes).not.toContain("goldPatch");
      expect(result.planBytes).not.toContain("hiddenFailToPass");
      expect(result.planBytes).not.toContain("prehistory/");
    });
  });

  it("accepts a custom baseline locator and derives its adjacent stage projections", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const {
        baselineStageEvidenceRoot: _derivedStageRoot,
        ...paths
      } = fixture.paths;

      const result = await loadC5PilotReadiness({
        ...paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      });

      expect(result.c4Readiness.baselineCeiling.path).toBe(
        fixture.paths.baselineReportPath,
      );
      expect(result.plan.counts.stageRuns).toBe(72);
    });
  });

  it("ignores non-evidence files inside a real raw baseline stage tree", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const sandboxDirectory = join(
        fixture.paths.baselineRawStageEvidenceRoot,
        "delimiter-boundary-policy-stage-3",
        "evaluation-sandbox",
        "workspace",
      );
      await mkdir(sandboxDirectory, { recursive: true });
      await writeFile(join(sandboxDirectory, "package.json"), "{}\n", "utf8");

      const result = await loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      });

      expect(result.plan.counts.codexProcesses).toBe(72);
    });
  });

  it("fails closed when the C4 acceptance report is mutated", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const report = JSON.parse(
        await readFile(fixture.paths.c4ReadinessReportPath, "utf8"),
      ) as { status: string };
      report.status = "rejected";
      await writeFile(
        fixture.paths.c4ReadinessReportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );

      await expect(loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      })).rejects.toThrow("invalid accepted C4 readiness report");
    });
  });

  it("fails closed when C4 review provenance is absent", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const report = JSON.parse(
        await readFile(fixture.paths.c4ReadinessReportPath, "utf8"),
      ) as Record<string, unknown>;
      delete report.reviewProvenanceSha256;
      await writeFile(
        fixture.paths.c4ReadinessReportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );

      await expect(loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      })).rejects.toThrow("invalid accepted C4 readiness report");
    });
  });

  it("fails closed for a non-canonical C4 reviewer identity", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const report = JSON.parse(
        await readFile(fixture.paths.c4ReadinessReportPath, "utf8"),
      ) as { reviewerAgentName: string };
      report.reviewerAgentName = "/root/not-the-frozen-reviewer";
      await writeFile(
        fixture.paths.c4ReadinessReportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );

      await expect(loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      })).rejects.toThrow("invalid accepted C4 readiness report");
    });
  });

  it("fails closed when the C4 readiness report has an unknown field", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const report = JSON.parse(
        await readFile(fixture.paths.c4ReadinessReportPath, "utf8"),
      ) as Record<string, unknown>;
      report.unboundReviewReceipt = "accepted";
      await writeFile(
        fixture.paths.c4ReadinessReportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );

      await expect(loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      })).rejects.toThrow("invalid accepted C4 readiness report");
    });
  });

  it("fails closed when C4 readiness JSON bytes are not canonical", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const bytes = await readFile(
        fixture.paths.c4ReadinessReportPath,
        "utf8",
      );
      await writeFile(
        fixture.paths.c4ReadinessReportPath,
        `${bytes}\n`,
        "utf8",
      );

      await expect(loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      })).rejects.toThrow("invalid accepted C4 readiness report");
    });
  });

  it("fails closed when a C4 review artifact is coherently shaped but unbound", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const review = JSON.parse(
        await readFile(fixture.paths.c4ReviewResponsePath, "utf8"),
      ) as { reviewer: string };
      review.reviewer = "Substituted independent reviewer";
      await writeFile(
        fixture.paths.c4ReviewResponsePath,
        `${JSON.stringify(review, null, 2)}\n`,
        "utf8",
      );

      await expect(loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      })).rejects.toThrow("review response hash mismatch");
    });
  });

  it("fails closed when finalized baseline evidence is only hash-consistent", async () => {
    await withAcceptedC4ReadinessFixture(async (fixture) => {
      const binding = JSON.parse(
        await readFile(fixture.firstStageEvidencePath, "utf8"),
      ) as { evidence: { arm: unknown } };
      binding.evidence.arm = null;
      await writeFile(
        fixture.firstStageEvidencePath,
        `${JSON.stringify(binding, null, 2)}\n`,
        "utf8",
      );

      await expect(loadC5PilotReadiness({
        ...fixture.paths,
        datasetRoot: DATASET_ROOT,
        materialEffectPercentagePoints: 10,
        orderSeed: 73,
      })).rejects.toThrow("does not match authenticated raw source");
    });
  });
});
