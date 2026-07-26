import { createHash } from "node:crypto";
import {
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
  buildC6LiveMultiLangNeighborActorPlan,
  deriveC6LiveMultiLangNeighborActorPlan,
  parseC6LiveMultiLangNeighborActorPlan,
  serializeC6LiveMultiLangNeighborActorPlan,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan";
import {
  parseC6LiveMultiLangNeighborStructuralQualification,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";
import {
  serializeC6ReviewerActorPolicy,
} from "../../../scripts/codex-coding-effect/c6-reviewer-actor-policy";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const STRUCTURAL_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-qualification-v1.json",
);
const ARTIFACT_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-plan-v1.json",
);
const STRUCTURAL_SHA256 =
  "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210";
const STRUCTURAL_BYTES = 1_358_575;
const ARTIFACT_SHA256 =
  "abb0a817611c7f5568c0f3390625598a46a1a56c687617815260ee98121a92d3";
const ARTIFACT_BYTES = 48_002;
const REVIEWER_OCCURRENCE_PROJECTION_SHA256 =
  "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49";
const REVIEWER_LOGIN_PROJECTION_SHA256 =
  "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34";
const TARGET_PROJECTION_SHA256 =
  "8393f1a04a25b3288932b954ab5825ec8ceca37f57dd3d3da8dc9bdd7ac62205";
const POLICY_SHA256 =
  "ca0014e5e6d47dc63f490b49bff6835b9d5ed99e69b3eb8d8ddf4266edc8643f";
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe(
  "Codex coding-effect C6 Live/MultiLang Wave1 actor-plan gate",
  () => {
    it("matches the tracked canonical artifact byte-for-byte", async () => {
      const artifactBytes = await readFile(ARTIFACT_PATH);
      expect(artifactBytes.byteLength).toBe(ARTIFACT_BYTES);
      expect(sha256(artifactBytes)).toBe(ARTIFACT_SHA256);
      const artifact =
        parseC6LiveMultiLangNeighborActorPlan(artifactBytes);
      const rebuilt = await buildC6LiveMultiLangNeighborActorPlan({
        structuralQualificationPath: STRUCTURAL_PATH,
      });

      expect(rebuilt.outputSha256).toBe(ARTIFACT_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborActorPlan(rebuilt.plan),
        "utf8",
      )).toEqual(artifactBytes);
      expect(rebuilt.plan).toEqual(artifact);
    });

    it("rebuilds the complete actor closure with exact frozen boundaries", async () => {
      const [structuralBytes, rebuilt] = await Promise.all([
        readFile(STRUCTURAL_PATH),
        buildC6LiveMultiLangNeighborActorPlan({
          structuralQualificationPath: STRUCTURAL_PATH,
        }),
      ]);
      const plan = rebuilt.plan;
      const serialized =
        serializeC6LiveMultiLangNeighborActorPlan(plan);

      expect(structuralBytes.byteLength).toBe(STRUCTURAL_BYTES);
      expect(sha256(structuralBytes)).toBe(STRUCTURAL_SHA256);
      expect(rebuilt.outputSha256).toBe(ARTIFACT_SHA256);
      expect(Buffer.byteLength(serialized)).toBe(ARTIFACT_BYTES);
      expect(plan.counts).toEqual({
        sourceReviewReferenceCount: 3_185,
        sourceTargetCount: 692,
        uniqueActorCount: 267,
      });
      expect(plan.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        candidateManifestFrozen: false,
        codexRunReady: false,
        status: "reviewer-actor-identity-capture-required",
      });
      expect(plan.independenceBoundary).toEqual({
        goldInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        reviewerActorOccurrenceProjectionSha256:
          REVIEWER_OCCURRENCE_PROJECTION_SHA256,
        reviewerLoginProjectionSha256:
          REVIEWER_LOGIN_PROJECTION_SHA256,
        semanticLedgerInput: false,
        selectedSequenceInput: false,
        targetProjectionSha256: TARGET_PROJECTION_SHA256,
        testInput: false,
      });
      expect(plan.inputs).toEqual({
        deepCapturePlan: {
          bytes: 518_443,
          path:
            "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v1.json",
          sha256:
            "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a",
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
            "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf",
        },
        graphqlRootSha256:
          "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
        qualification: {
          bytes: STRUCTURAL_BYTES,
          path: basename(STRUCTURAL_PATH),
          sha256: STRUCTURAL_SHA256,
        },
      });
      expect(plan.policy).toMatchObject({
        policyId: "reviewer-platform-actor-eligibility-v1",
        schemaVersion: 1,
        sha256: POLICY_SHA256,
      });
      expect(sha256(serializeC6ReviewerActorPolicy())).toBe(
        POLICY_SHA256,
      );
      expect(plan.targets).toHaveLength(267);
      expect(plan.targets[0]).toEqual({
        captureDirectory:
          "actor-07334386287751ba02a4588c1a0875dbd074a61bd9e6ab7c48d244eacd0c99e0",
        captureOrder: 1,
        login: "0101",
      });
      expect(plan.targets.at(-1)).toEqual({
        captureDirectory:
          "actor-ea5f6db59492309a4ae6351c8ec77ac73ddfae034295d022f686cc187239a355",
        captureOrder: 267,
        login: "yxmura",
      });
      expect(plan.targets.map(({ captureOrder }) => captureOrder))
        .toEqual(Array.from(
          { length: 267 },
          (_, index) => index + 1,
        ));
      expect(plan.targets.map(({ login }) => login)).toEqual(
        [...plan.targets.map(({ login }) => login)].sort(),
      );
      expect(new Set(plan.targets.map(({ login }) => login)).size)
        .toBe(267);
      expect(sha256(JSON.stringify(plan.targets))).toBe(
        TARGET_PROJECTION_SHA256,
      );
    });

    it("rejects terminal structural-artifact drift", async () => {
      const parent = await mkdtemp(
        "/private/tmp/goodmemory-c6-actor-plan-gate-drift-",
      );
      temporaryRoots.push(parent);
      const structuralPath = join(
        parent,
        basename(STRUCTURAL_PATH),
      );
      await cp(STRUCTURAL_PATH, structuralPath);
      let hookCalled = false;

      await expect(
        buildC6LiveMultiLangNeighborActorPlan({
          structuralQualificationPath: structuralPath,
          testHooks: {
            beforeTerminalReplay: async () => {
              hookCalled = true;
              await writeFile(structuralPath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow(/changed|hash mismatch/u);
      expect(hookCalled).toBe(true);
    });

    it("rejects omitted or extra logins and forbidden metadata", async () => {
      const structuralBytes = await readFile(STRUCTURAL_PATH);
      const qualification =
        parseC6LiveMultiLangNeighborStructuralQualification(
          structuralBytes,
        );
      const structuralArtifact = {
        bytes: structuralBytes.byteLength,
        path: basename(STRUCTURAL_PATH),
        sha256: sha256(structuralBytes),
      };
      const omitted = structuredClone(qualification);
      omitted.reviewerLogins.pop();
      expect(() =>
        deriveC6LiveMultiLangNeighborActorPlan({
          qualification: omitted,
          structuralArtifact,
        })
      ).toThrow();

      const extra = structuredClone(qualification);
      extra.reviewerLogins.push("zz-unobserved-actor");
      expect(() =>
        deriveC6LiveMultiLangNeighborActorPlan({
          qualification: extra,
          structuralArtifact,
        })
      ).toThrow();

      const plan = deriveC6LiveMultiLangNeighborActorPlan({
        qualification,
        structuralArtifact,
      });
      const raw = JSON.parse(
        serializeC6LiveMultiLangNeighborActorPlan(plan),
      ) as Record<string, unknown>;
      raw.forbiddenEvaluatorMetadata = {
        goldPatch: "forbidden",
        hiddenTest: "forbidden",
        machineOutcome: "forbidden",
        semanticDecision: "forbidden",
      };
      expect(() =>
        parseC6LiveMultiLangNeighborActorPlan(
          `${JSON.stringify(raw, null, 2)}\n`,
        )
      ).toThrow();
    });
  },
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
