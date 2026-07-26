import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  join,
  resolve,
} from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  buildC6LiveMultiLangNeighborStructuralQualification,
  parseC6LiveMultiLangNeighborStructuralQualification,
  serializeC6LiveMultiLangNeighborStructuralQualification,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v1.json",
);
const ARTIFACT_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-qualification-v1.json",
);
const DEEP_ROOT =
  "/private/tmp/goodmemory-c6-live-multilang-neighbor-deep-v1";
const ARTIFACT_SHA256 =
  "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210";
const ARTIFACT_BYTES = 1_358_575;
const PLAN_SHA256 =
  "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a";
const EVIDENCE_TARGET_PROJECTION_SHA256 =
  "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf";
const STRUCTURAL_RESULT_PROJECTION_SHA256 =
  "f599d7ced72a3cebd4f175a059a604d2bb2c09b97d81e268dd18915cdd136081";
const REVIEWER_OCCURRENCE_PROJECTION_SHA256 =
  "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49";
const REVIEWER_LOGIN_PROJECTION_SHA256 =
  "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34";
const PULL_AUTHOR_PROJECTION_SHA256 =
  "72b4f597546917d0140b07c516a6a8577849f4f54e8b8ef074177a47b4aeaffc";
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
}, 120_000);

describe(
  "Codex coding-effect C6 Live/MultiLang Wave1 structural qualification gate",
  () => {
    it("matches the tracked canonical artifact byte-for-byte", async () => {
      const artifactBytes = await readFile(ARTIFACT_PATH);
      expect(artifactBytes.byteLength).toBe(ARTIFACT_BYTES);
      expect(sha256(artifactBytes)).toBe(ARTIFACT_SHA256);
      const artifact =
        parseC6LiveMultiLangNeighborStructuralQualification(
          artifactBytes,
        );
      const rebuilt =
        await buildC6LiveMultiLangNeighborStructuralQualification({
          deepCaptureRoot: DEEP_ROOT,
          planPath: PLAN_PATH,
          tranche: "wave1",
        });

      expect(rebuilt.outputSha256).toBe(ARTIFACT_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborStructuralQualification(
          rebuilt.qualification,
        ),
        "utf8",
      )).toEqual(artifactBytes);
      expect(rebuilt.qualification).toEqual(artifact);
    }, 120_000);

    it("rebuilds the frozen external closure with exact counts and projections", async () => {
      expect(existsSync(DEEP_ROOT)).toBe(true);
      const [planBytes, rebuilt] = await Promise.all([
        readFile(PLAN_PATH),
        buildC6LiveMultiLangNeighborStructuralQualification({
          deepCaptureRoot: DEEP_ROOT,
          planPath: PLAN_PATH,
          tranche: "wave1",
        }),
      ]);
      const qualification = rebuilt.qualification;
      const serialized =
        serializeC6LiveMultiLangNeighborStructuralQualification(
          qualification,
        );

      expect(sha256(planBytes)).toBe(PLAN_SHA256);
      expect(rebuilt.outputSha256).toBe(ARTIFACT_SHA256);
      expect(Buffer.byteLength(serialized)).toBe(ARTIFACT_BYTES);
      expect(qualification.counts).toEqual({
        exactStructuralCandidateCount: 34,
        exactStructuralRepositoryCount: 15,
        noExactStructuralSequenceCount: 658,
        projectedStructuralEventCount: 830,
        pullAuthorOccurrenceCount: 692,
        repositoryCappedStructuralCeiling: 30,
        reviewerActorOccurrenceCount: 3_185,
        reviewerUniqueLoginCount: 267,
        targetCount: 692,
      });
      expect(qualification.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        evaluatorQualifiedEpisodeCount: 0,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
        status: "pre-actor-structural-qualification-only",
      });
      expect(qualification.independenceBoundary).toEqual({
        acceptedEpisodeInput: false,
        actorEligibilityInput: false,
        evaluatorDecisionInput: false,
        goldInput: false,
        hiddenTestInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        pullAuthorOccurrenceProjectionSha256:
          PULL_AUTHOR_PROJECTION_SHA256,
        reviewerActorOccurrenceProjectionSha256:
          REVIEWER_OCCURRENCE_PROJECTION_SHA256,
        reviewerLoginProjectionSha256:
          REVIEWER_LOGIN_PROJECTION_SHA256,
        semanticDecisionInput: false,
        structuralResultProjectionSha256:
          STRUCTURAL_RESULT_PROJECTION_SHA256,
      });
      expect(qualification.inputs).toEqual({
        deepCapturePlan: {
          bytes: 518_443,
          path:
            "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v1.json",
          sha256: PLAN_SHA256,
        },
        deepEvidence: {
          assetRootSha256:
            "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
          completionSha256:
            "62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d",
          directoryCount: 2_771,
          fileCount: 2_772,
          finalSuccessfulResponseCount: 693,
          logicalRequestCount: 693,
          networkRequestCount: 693,
          targetProjectionSha256:
            EVIDENCE_TARGET_PROJECTION_SHA256,
        },
      });
      expect(qualification.policy).toEqual({
        policyId: "prospective-structural-review-v2",
        schemaVersion: 2,
        sha256:
          "b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a",
      });
      expect(qualification.results).toHaveLength(692);
      expect(qualification.results.filter((result) =>
        result.status ===
          "exact-structural-candidate-pre-actor"
      )).toHaveLength(34);
      expect(qualification.results.filter((result) =>
        result.status === "no-exact-structural-sequence"
      )).toHaveLength(658);
      expect(qualification.reviewerActorOccurrences).toHaveLength(
        3_185,
      );
      expect(qualification.reviewerActorOccurrences.filter(
        (occurrence) => occurrence.surface === "review",
      )).toHaveLength(1_848);
      expect(qualification.reviewerActorOccurrences.filter(
        (occurrence) =>
          occurrence.surface === "review-thread-comment",
      )).toHaveLength(1_337);
      expect(qualification.reviewerLogins).toHaveLength(267);
      expect(qualification.pullAuthorOccurrences).toHaveLength(692);
      expect(sha256(JSON.stringify(
        qualification.reviewerActorOccurrences,
      ))).toBe(REVIEWER_OCCURRENCE_PROJECTION_SHA256);
      expect(sha256(JSON.stringify(
        qualification.reviewerLogins,
      ))).toBe(REVIEWER_LOGIN_PROJECTION_SHA256);
      expect(sha256(JSON.stringify(
        qualification.pullAuthorOccurrences,
      ))).toBe(PULL_AUTHOR_PROJECTION_SHA256);
      expect(sha256(JSON.stringify(
        qualification.results,
      ))).toBe(STRUCTURAL_RESULT_PROJECTION_SHA256);
    }, 120_000);

    it("rejects terminal frozen-plan drift after the first full replay", async () => {
      const parent = await mkdtemp(
        "/private/tmp/goodmemory-c6-structural-gate-plan-",
      );
      temporaryRoots.push(parent);
      const planPath = join(parent, basename(PLAN_PATH));
      await cp(PLAN_PATH, planPath);
      let hookCalled = false;

      await expect(
        buildC6LiveMultiLangNeighborStructuralQualification({
          deepCaptureRoot: DEEP_ROOT,
          planPath,
          tranche: "wave1",
          testHooks: {
            beforeTerminalReplay: async () => {
              hookCalled = true;
              await writeFile(planPath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow();
      expect(hookCalled).toBe(true);
    }, 120_000);

    it("rejects terminal external-root drift after the first full replay", async () => {
      const parent = await mkdtemp(
        "/private/tmp/goodmemory-c6-structural-gate-root-",
      );
      temporaryRoots.push(parent);
      const root = join(parent, "capture");
      await cp(DEEP_ROOT, root, {
        preserveTimestamps: true,
        recursive: true,
      });
      await chmod(root, 0o700);
      let hookCalled = false;

      await expect(
        buildC6LiveMultiLangNeighborStructuralQualification({
          deepCaptureRoot: root,
          planPath: PLAN_PATH,
          tranche: "wave1",
          testHooks: {
            beforeTerminalReplay: async () => {
              hookCalled = true;
              await writeFile(
                join(root, "terminal-gate-drift.json"),
                "{}\n",
                { mode: 0o600 },
              );
            },
          },
        }),
      ).rejects.toThrow();
      expect(hookCalled).toBe(true);
    }, 120_000);
  },
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
