import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildC4AssetLock,
  loadC4AssetLock,
} from "../../scripts/codex-coding-effect/c4-controlled-dataset";
import {
  runC4DatasetCoreReadiness,
} from "../../scripts/codex-coding-effect/c4-readiness";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const DATASET_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c4-controlled-pilot",
);
const REPORT_ROOT = join(REPOSITORY_ROOT, "reports/quality-gates/phase-73");
const V8_DECLARED_SHA256 = {
  assetLockSha256: "a4db88c4dc9ebea7fc464ba104f34c3a0852e2743a798694723d9ae9614606c4",
  assetRootSha256: "0f1c6f2495c3fc57297f3f9595adb18c83fc0484db2753687453950f65b465fd",
  manifestSha256: "8841ac9138c028aa22dd423f7974a5079cda7f8d1055a1a2983dd298ecb2e733",
  runIdentitySha256: "4b51701d862aa3528f5c50054c04a7491b66940396a3080ac042de81aa95705f",
  stageEvidenceAggregateSha256: "d7401e38321dc6a1055c44dd41f20cd9336b240f0ca3c916ca837560e55e00af",
} as const;
const V8_ROOT_ARTIFACT_SHA256 = {
  "c4-baseline-ceiling-pilot-v8/report.json":
    "145075fe1db774e14fbce1ba6df6b6170c64cd87a9c81c89a7abb39aefcfb220",
  "c4-controlled-pilot-core-v8.json":
    "6ec596c99891376842e612520ae00b00f627e99ba63f48b9a690f02c06c72d3a",
  "c4-controlled-pilot-readiness-v8.json":
    "7cf3f8cb829472f34e475dddfe69911651887c2896559712988e1153b6ea0128",
} as const;
const V8_REVIEW_ARTIFACT_SHA256 = {
  "dispatch.json": "71fc4df6fec51308f0cbbb8b25a61ea13cab4b00f6cef9bb9935c531be1c6e59",
  "independent-review.json": "cfa5b75dc8ad7bc30fc287f05dae113a6af3720e5b3ca806ba1487e38acbf44e",
  "input-bundle.json": "a727bb37ad31d5974417d3803d338097a94967900c3bd4c95c1aeaeffdb13c41",
  "provenance.json": "1eee28b3fb8f08b5f57dcfb74db62632682145f062d32cad93341c227f54c4dc",
  "request.md": "bd56dfc7e09b8ace82cfb8bcf8e13a1c9466f9e4eb93cbecabca118849cba94d",
} as const;
const V8_STAGE_PROJECTION_SHA256 = {
  "delimiter-boundary-policy-stage-2": "47829b5d3381f8d2d414f8396bd6afe5e46d853a03d1e06461c5b272ac92689a",
  "delimiter-boundary-policy-stage-3": "3a46e00264b85c16c4970fb5f2e02616985c2bcb11b73b3d4324abd01c440609",
  "duration-configuration-policy-stage-2": "56f33c8638a593babcb3155f9963fdb0ecc5c5f95b99f206bfdc2ac0485aa9a2",
  "duration-configuration-policy-stage-3": "740fb7074379280116069169f70b616599d93ab44d9bb55bde2e8c44d5cc95b1",
  "endpoint-open-loop-stage-2": "cd37df1ef15f40b89939091ae3b827425955f10ddfef11ba0009f00880e6aee7",
  "endpoint-open-loop-stage-3": "ec939fac18636341b7d6115f5628e3c41a27dcb78c47ce4e43826fed433501e2",
  "field-boundary-policy-stage-2": "ab9e97f283d91cf700e0ba23c8cb1e49333dea0e85afce8902149fe1d198759a",
  "field-boundary-policy-stage-3": "0443b73ac838bbc2062bf56b4d0092e2dcf0b63958333da8fba4ac8c69ced1d3",
  "independent-string-utilities-stage-2": "5e4d89d7ec7750e2bd9c2ffe2819b52cade56a894cd027628b96e8adbeaaf42c",
  "independent-string-utilities-stage-3": "6598544bdb7b0f67decfed38a0fa4934fdb765e3ab8f572d0147a9066b0bcb3d",
  "parse-result-correction-stage-2": "ad82ede23035e3227cdbfd86b44fc1c58aa05e3e60ca66fd0b656e425a98967e",
  "parse-result-correction-stage-3": "f7f883963f4351ee6e3a42e509d7c160c2fcb2bcbf44f5322bac546789a00ab3",
} as const;

describe("Codex coding-effect C4 tracked evidence", () => {
  it("keeps v8 historical while replaying the canonical v9 evidence bundle", async () => {
    const [
      baselineBytes,
      coreBytes,
      currentStatus,
      manifestBytes,
      plan,
      readinessBytes,
      taskBoard,
    ] = await Promise.all([
      readFile(join(REPORT_ROOT, "c4-baseline-ceiling-pilot-v8/report.json"), "utf8"),
      readFile(join(REPORT_ROOT, "c4-controlled-pilot-core-v8.json"), "utf8"),
      readFile(
        join(REPOSITORY_ROOT, "docs/GoodMemory-Current-Status-and-Evidence.md"),
        "utf8",
      ),
      readFile(join(DATASET_ROOT, "manifest.json"), "utf8"),
      readFile(
        join(
          REPOSITORY_ROOT,
          "docs/plans/GoodMemory-Codex-Coding-Effect-Evaluation-and-Development-Plan.md",
        ),
        "utf8",
      ),
      readFile(join(REPORT_ROOT, "c4-controlled-pilot-readiness-v8.json"), "utf8"),
      readFile(
        join(
          REPOSITORY_ROOT,
          "task-board/78-phase-73-codex-installed-host-coding-effect-evaluation.txt",
        ),
        "utf8",
      ),
    ]);
    const baseline = JSON.parse(baselineBytes) as {
      assetLockSha256: string;
      assetRootSha256: string;
      manifestSha256: string;
      results: Array<{
        episodeId: string;
        stageEvidenceSha256: string;
        stageId: string;
      }>;
      runIdentitySha256: string;
      stageEvidenceAggregateSha256: string;
    };
    const core = JSON.parse(coreBytes) as {
      assetLockSha256: string;
      manifestSha256: string;
    };
    const readiness = JSON.parse(readinessBytes) as {
      assetLockSha256: string;
      manifestSha256: string;
      status: string;
    };
    const manifest = JSON.parse(manifestBytes) as {
      episodes: Array<{
        allowedPublicLeakageRelations: unknown[];
        id: string;
      }>;
    };
    const { assetLock, assetLockSha256 } = await loadC4AssetLock(DATASET_ROOT);
    const [currentCoreBytes, currentReadinessBytes] = await Promise.all([
      readFile(join(REPORT_ROOT, "c4-controlled-pilot-core.json"), "utf8"),
      readFile(join(REPORT_ROOT, "c4-controlled-pilot-readiness.json"), "utf8"),
    ]);
    const currentReadiness = JSON.parse(currentReadinessBytes) as {
      baselineCeiling: { reportSha256: string };
      coreSha256: string;
      status: string;
    };

    expect(baseline).toMatchObject(V8_DECLARED_SHA256);
    for (const [path, expectedSha256] of Object.entries(
      V8_ROOT_ARTIFACT_SHA256,
    )) {
      expect(sha256(await readFile(join(REPORT_ROOT, path), "utf8"))).toBe(
        expectedSha256,
      );
    }
    for (const [path, expectedSha256] of Object.entries(
      V8_REVIEW_ARTIFACT_SHA256,
    )) {
      expect(sha256(await readFile(join(
        REPORT_ROOT,
        "c4-controlled-pilot-review-v8",
        path,
      ), "utf8"))).toBe(expectedSha256);
    }
    const projectedRawSha256 = new Map<string, string>();
    for (const [stage, expectedSha256] of Object.entries(
      V8_STAGE_PROJECTION_SHA256,
    )) {
      const bytes = await readFile(
        join(
          REPORT_ROOT,
          "c4-baseline-ceiling-pilot-v8/stages",
          stage,
          "stage-evidence.json",
        ),
        "utf8",
      );
      expect(sha256(bytes)).toBe(expectedSha256);
      const projection = JSON.parse(bytes) as { rawStageEvidenceSha256: string };
      projectedRawSha256.set(stage, projection.rawStageEvidenceSha256);
    }
    expect(projectedRawSha256.size).toBe(12);
    for (const result of baseline.results) {
      expect(projectedRawSha256.get(
        `${result.episodeId}-${result.stageId}`,
      )).toBe(result.stageEvidenceSha256);
    }

    expect(await buildC4AssetLock(DATASET_ROOT)).toEqual(assetLock);
    expect(manifest.episodes.find((episode) =>
      episode.id === "parse-result-correction"
    )?.allowedPublicLeakageRelations).toEqual([
      ["debug", true],
      ["direct", true],
      ["json", true],
      ["relay", true],
      ["text", true],
      ["warn", true],
    ]);
    expect(core.assetLockSha256).not.toBe(assetLockSha256);
    expect(core.manifestSha256).not.toBe(sha256(manifestBytes));
    expect(baseline.assetLockSha256).toBe(core.assetLockSha256);
    expect(baseline.manifestSha256).toBe(core.manifestSha256);
    expect(readiness).toMatchObject({
      assetLockSha256: core.assetLockSha256,
      manifestSha256: core.manifestSha256,
      status: "accepted",
    });
    expect(await Bun.file(
      join(REPORT_ROOT, "c4-baseline-ceiling-pilot/report.json"),
    ).exists()).toBe(true);
    expect(await Bun.file(
      join(REPORT_ROOT, "c4-controlled-pilot-core.json"),
    ).exists()).toBe(true);
    expect(await Bun.file(
      join(REPORT_ROOT, "c4-controlled-pilot-readiness.json"),
    ).exists()).toBe(true);
    expect(await Bun.file(join(DATASET_ROOT, "review/independent-review.json")).exists())
      .toBe(true);
    expect(currentReadiness).toMatchObject({
      baselineCeiling: {
        reportSha256: sha256(await readFile(
          join(REPORT_ROOT, "c4-baseline-ceiling-pilot/report.json"),
          "utf8",
        )),
      },
      coreSha256: sha256(currentCoreBytes),
      status: "accepted",
    });
    const currentBaseline = JSON.parse(await readFile(
      join(REPORT_ROOT, "c4-baseline-ceiling-pilot/report.json"),
      "utf8",
    )) as typeof baseline;
    expect((await readdir(join(
      REPORT_ROOT,
      "c4-baseline-ceiling-pilot/raw-stages",
    ))).sort()).toEqual(currentBaseline.results.map((result) =>
      `${result.episodeId}-${result.stageId}`
    ).sort());
    for (const result of currentBaseline.results) {
      const rawBytes = await readFile(join(
        REPORT_ROOT,
        "c4-baseline-ceiling-pilot/raw-stages",
        `${result.episodeId}-${result.stageId}`,
        "stage-evidence.json",
      ), "utf8");
      expect(sha256(rawBytes)).toBe(result.stageEvidenceSha256);
    }
    const regenerationRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-c4-release-regeneration-"),
    );
    try {
      const regenerated = await runC4DatasetCoreReadiness({
        datasetRoot: DATASET_ROOT,
        workspaceRoot: join(regenerationRoot, "readiness"),
      });
      expect(regenerated.core.assetLockSha256).toBe(assetLockSha256);
      expect(regenerated.core.manifestSha256).toBe(sha256(manifestBytes));
      expect(regenerated.core.leakage.candidateExtractionVersion).toBe(
        "semantic-documents-exact-relations-corpus-wide-v9",
      );
      expect(regenerated.coreBytes).toBe(currentCoreBytes);
    } finally {
      await rm(regenerationRoot, { force: true, recursive: true });
    }

    expect(taskBoard).toContain("[DONE] Canonical C4 v9 is accepted.");
    expect(taskBoard).toContain("[DONE] C5 internal run");
    expect(plan).toContain("**V8 SUPERSEDED; V9 ACCEPTED; C5");
    expect(currentStatus).toContain(
      "the canonical v9",
    );
    expect(currentStatus).toContain("C5 internal run");
  }, 180_000);
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
