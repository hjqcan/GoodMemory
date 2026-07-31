import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";

import {
  buildC6ReviewerActorDerivedClassificationV3,
  materializeC6ReviewerActorDerivedClassificationV3,
  parseC6ReviewerActorDerivedClassificationV3,
  serializeC6ReviewerActorDerivedClassificationV3,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-derived-classification-v3";
import {
  runC6ReviewerActorDerivedClassificationV3Gate,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-derived-classification-v3-gate";

const ACTOR_PLAN_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-plan-v2.json",
);
const ACTOR_ROOT =
  "/private/tmp/" +
  "goodmemory-c6-live-multilang-neighbor-" +
  "reviewer-actor-identities-v2";
const JOESTUMP_DIRECTORY =
  "actor-eb2705a6e717ad25af6e028a2ae1d6e8ccffec8d14b04a9be2eda078ca231c6c";
const FIRST_DIRECTORY =
  "actor-07334386287751ba02a4588c1a0875dbd074a61bd9e6ab7c48d244eacd0c99e0";
const temporaryRoots: string[] = [];
const describeIfActorRootExists = existsSync(ACTOR_ROOT)
  ? describe
  : describe.skip;

setDefaultTimeout(300_000);

afterAll(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describeIfActorRootExists("Codex coding-effect C6 reviewer actor derived classification v3", () => {
  it("derives a strict sanitized 507-row v2/v3 decision diff", async () => {
    const result =
      await buildC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
      });
    const { classification } = result;

    expect(classification.counts).toEqual({
      actorCount: 507,
      newlyExcludedActorCount: 1,
      resolvedActorCount: 500,
      unresolvedActorCount: 7,
      v2EligibleActorCount: 487,
      v2IneligibleActorCount: 20,
      v3EligibleActorCount: 486,
      v3IneligibleActorCount: 21,
    });
    expect(classification.decisionDiff.v2ToV3).toEqual([
      {
        captureOrder: 235,
        login: "joestump-agent",
        v2: {
          eligible: true,
          reason:
            "current-platform-user-no-known-automation-signal",
        },
        v3: {
          eligible: false,
          reason: "automation-agent-suffix-excluded",
        },
      },
    ]);
    expect(classification.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorFilteredSelectionExecuted: false,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      independentReviewCompleted: false,
      independentReviewReceiptRequired: true,
      selectionExecuted: false,
      status:
        "policy-v3-independent-review-and-commit-freeze-required",
    });
    expect(classification.independenceBoundary).toEqual({
      fullStructuralRowsInput: false,
      goldInput: false,
      reviewBodyInput: false,
      reviewOutcomeInput: false,
      selectedSequenceInput: false,
      structuralReviewerLoginProjectionInput: true,
      structuralSelectionOutcomeInput: false,
    });
    expect(classification.chronology).toEqual({
      adaptiveAfterCompleteActorCapture: true,
      policyV3PreregisteredBeforeActorCapture: false,
      selectionExecuted: false,
    });
    expect(classification.sanitizedProjection.rows).toHaveLength(
      507,
    );
    expect(
      Object.keys(classification.sanitizedProjection.rows[0]!)
        .sort(),
    ).toEqual([
      "captureOrder",
      "currentPlatformType",
      "login",
      "status",
    ]);
    expect(classification.inputs).toMatchObject({
      actorPlan: {
        bytes: 86_991,
        path:
          "swe-bench-live-multilang-608f7ae9." +
          "neighbor-reviewer-actor-plan-v2.json",
        sha256:
          "9603ab1f3ccf52efb632ca090a0a87b4235dad178f85d1f9b7ecb976b9d0dc17",
        targetProjectionSha256:
          "68ac8d1823039f7375dc6903676ed146b3704511c4bb79bd077a15d38bc5b53c",
      },
      actorRoot: {
        assetRootSha256:
          "4ff26b0d9dd69900f750c8699d30ff588ec9a82eaff73ea4954e8c3db23f5842",
        captureManifestSha256:
          "a3695941b1d7d12fdaf6d08df46023176ff10e1f12b4f833d3e1ee391a95b2c5",
        fileCount: 2_029,
        totalBytes: 1_883_615,
      },
    });
    expect(classification.policy).toMatchObject({
      v2: {
        policyId: "reviewer-platform-actor-eligibility-v2",
        schemaVersion: 2,
        sha256:
          "c243571bc95c44494dca68606ba772c26a7b640d1c2bbe60fc1818603efc0e44",
      },
      v3: {
        policyId: "reviewer-platform-actor-eligibility-v3",
        schemaVersion: 3,
        sha256:
          "a8769b437d8515c9f489639aa90fa4fb3230647cc4508bafaf29d1e970bc2899",
      },
    });
    const serialized =
      serializeC6ReviewerActorDerivedClassificationV3(
        classification,
      );
    expect(
      parseC6ReviewerActorDerivedClassificationV3(serialized),
    ).toEqual(classification);
    expect(Buffer.byteLength(serialized)).toBe(225_600);
    expect(result.outputSha256).toBe(hash(serialized));
    expect(result.outputSha256).toBe(
      "7b8a812b7740ce2703eee470b01043fce8f8a64a120dca5ebc11f8226920696b",
    );
    expect(classification.sanitizedProjection).toMatchObject({
      bytes: 42_331,
      sha256:
        "d1149dd3d0969e655dba75372236c1531bbc7a244f2d5f304ed6b24856742c83",
    });
  });

  it("rejects sanitized-row, decision, policy, and diff drift", async () => {
    const { classification } =
      await buildC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
      });
    const mutations: Array<
      (raw: Record<string, unknown>) => void
    > = [
      (raw) => {
        projectionOf(raw).rows.pop();
      },
      (raw) => {
        projectionOf(raw).rows.reverse();
      },
      (raw) => {
        projectionOf(raw).rows[0]!.currentPlatformType =
          "Organization";
      },
      (raw) => {
        decisionsOf(raw)[0]!.login = "wrong-login";
      },
      (raw) => {
        policyOf(raw, "v3").sha256 = "0".repeat(64);
      },
      (raw) => {
        decisionDiffOf(raw).pop();
      },
    ];

    for (const mutate of mutations) {
      const raw = JSON.parse(
        serializeC6ReviewerActorDerivedClassificationV3(
          classification,
        ),
      ) as Record<string, unknown>;
      mutate(raw);
      expect(() =>
        parseC6ReviewerActorDerivedClassificationV3(
          `${JSON.stringify(raw, null, 2)}\n`,
        )
      ).toThrow();
    }
  });

  it("rejects missing, extra, symlinked, mode-drifted, and modified raw closure entries", async () => {
    const mutations: Array<
      (actorRoot: string) => Promise<void>
    > = [
      async (actorRoot) => {
        await rm(join(
          actorRoot,
          FIRST_DIRECTORY,
          "attempt-01/request.json",
        ));
      },
      async (actorRoot) => {
        await writeFile(join(actorRoot, "foreign.txt"), "extra\n", {
          mode: 0o600,
        });
      },
      async (actorRoot) => {
        const responsePath = join(
          actorRoot,
          FIRST_DIRECTORY,
          "attempt-01/response.json",
        );
        await rm(responsePath);
        await symlink(ACTOR_PLAN_PATH, responsePath);
      },
      async (actorRoot) => {
        await chmod(join(
          actorRoot,
          FIRST_DIRECTORY,
          "manifest.json",
        ), 0o644);
      },
      async (actorRoot) => {
        await mutateCanonicalJson(join(
          actorRoot,
          JOESTUMP_DIRECTORY,
          "manifest.json",
        ), (raw) => {
          const attempts = raw.attempts as Array<
            Record<string, unknown>
          >;
          const request = attempts[0]!.request as
            Record<string, unknown>;
          request.sha256 = "0".repeat(64);
        });
      },
      async (actorRoot) => {
        const responsePath = join(
          actorRoot,
          JOESTUMP_DIRECTORY,
          "attempt-01/response.json",
        );
        const raw = JSON.parse(
          await readFile(responsePath, "utf8"),
        ) as Record<string, unknown>;
        raw.login = "wrong-login";
        await writeFile(responsePath, JSON.stringify(raw));
      },
      async (actorRoot) => {
        await mutateCanonicalJson(
          join(actorRoot, "capture.json"),
          (raw) => {
            raw.policy = {
              policyId:
                "reviewer-platform-actor-eligibility-v3",
            };
          },
        );
      },
      async (actorRoot) => {
        await mutateCanonicalJson(
          join(actorRoot, "capture.json"),
          (raw) => {
            const counts = raw.counts as Record<string, unknown>;
            counts.retryCount = 1;
          },
        );
      },
    ];

    for (const mutate of mutations) {
      const actorRoot = await copyActorRoot("raw-mutation");
      await mutate(actorRoot);
      await expect(
        buildC6ReviewerActorDerivedClassificationV3({
          actorPlanPath: ACTOR_PLAN_PATH,
          actorRoot,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects actor-plan hash drift and terminal root mutation", async () => {
    const planParent = await temporaryRoot("plan-mutation");
    const planPath = join(
      planParent,
      "swe-bench-live-multilang-608f7ae9." +
        "neighbor-reviewer-actor-plan-v2.json",
    );
    await writeFile(planPath, "{}\n", { mode: 0o644 });
    await expect(
      buildC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: planPath,
        actorRoot: ACTOR_ROOT,
      }),
    ).rejects.toThrow(/plan hash mismatch/u);

    const actorRoot = await copyActorRoot("terminal-mutation");
    await expect(
      buildC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot,
        testHooks: {
          beforeTerminalVerification: async () => {
            await writeFile(
              join(actorRoot, "capture.json"),
              "{}\n",
            );
          },
        },
      }),
    ).rejects.toThrow(/changed|hash mismatch/u);
  });

  it("preserves a foreign publication inode and removes only owned stale output", async () => {
    const foreignParent = await temporaryRoot(
      "foreign-publication",
    );
    const foreignOutput = join(
      foreignParent,
      "classification.json",
    );
    await expect(
      materializeC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
        outputPath: foreignOutput,
        testHooks: {
          afterOutputPublication: async () => {
            await rm(foreignOutput);
            await writeFile(foreignOutput, "foreign-output\n", {
              mode: 0o644,
            });
          },
        },
      }),
    ).rejects.toThrow(/ownership mismatch/u);
    expect(await readFile(foreignOutput, "utf8")).toBe(
      "foreign-output\n",
    );

    const rollbackParent = await temporaryRoot(
      "owned-rollback",
    );
    const rollbackRoot = join(
      rollbackParent,
      "actor-root",
    );
    await cp(ACTOR_ROOT, rollbackRoot, { recursive: true });
    const rollbackOutput = join(
      rollbackParent,
      "classification.json",
    );
    await expect(
      materializeC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: rollbackRoot,
        outputPath: rollbackOutput,
        testHooks: {
          afterOutputPublication: async () => {
            await writeFile(
              join(rollbackRoot, "capture.json"),
              "{}\n",
            );
          },
        },
      }),
    ).rejects.toThrow();
    await expect(readFile(rollbackOutput)).rejects.toThrow();
  });

  it("publishes a complete 0644 inode under a secure process umask", async () => {
    const parent = await temporaryRoot("secure-umask");
    const outputPath = join(parent, "classification.json");
    const previousUmask = process.umask(0o077);
    try {
      await materializeC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
        outputPath,
      });
    } finally {
      process.umask(previousUmask);
    }

    expect((await stat(outputPath)).mode & 0o7777).toBe(0o644);
    expect(await readdir(parent)).toEqual(["classification.json"]);
    expect(
      parseC6ReviewerActorDerivedClassificationV3(
        await readFile(outputPath),
      ).counts,
    ).toMatchObject({
      actorCount: 507,
      v3EligibleActorCount: 486,
    });
  });

  it("propagates rollback lstat failures other than ENOENT", async () => {
    const parent = await temporaryRoot("rollback-eacces");
    const outputPath = join(parent, "classification.json");
    let thrown: unknown;
    try {
      await materializeC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(parent, 0o000);
          },
        },
      });
    } catch (error) {
      thrown = error;
    } finally {
      await chmod(parent, 0o700);
    }
    expect(thrown).toMatchObject({ code: "EACCES" });
    expect(await readFile(outputPath)).not.toHaveLength(0);
  });

  it("replays a frozen-path gate without writing canonical output", async () => {
    const result =
      await buildC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
      });
    const parent = await temporaryRoot("gate-helper");
    const classificationPath = join(
      parent,
      "swe-bench-live-multilang-608f7ae9." +
        "neighbor-reviewer-actor-derived-classification-v3.json",
    );
    await writeFile(
      classificationPath,
      serializeC6ReviewerActorDerivedClassificationV3(
        result.classification,
      ),
      { mode: 0o644 },
    );

    expect(
      await runC6ReviewerActorDerivedClassificationV3Gate({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
        classificationPath,
      }),
    ).toMatchObject({
      acceptedEpisodeCount: 0,
      codexRunReady: false,
      independentReviewCompleted: false,
      outputBytes: 225_600,
      outputSha256:
        "7b8a812b7740ce2703eee470b01043fce8f8a64a120dca5ebc11f8226920696b",
      passed: true,
      selectionExecuted: false,
    });
  });
});

function projectionOf(raw: Record<string, unknown>): {
  rows: Array<Record<string, unknown>>;
} {
  return raw.sanitizedProjection as {
    rows: Array<Record<string, unknown>>;
  };
}

function decisionsOf(
  raw: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return raw.decisions as Array<Record<string, unknown>>;
}

function decisionDiffOf(
  raw: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return (
    raw.decisionDiff as Record<string, unknown>
  ).v2ToV3 as Array<Record<string, unknown>>;
}

function policyOf(
  raw: Record<string, unknown>,
  version: "v2" | "v3",
): Record<string, unknown> {
  return (raw.policy as Record<string, unknown>)[version] as
    Record<string, unknown>;
}

async function mutateCanonicalJson(
  path: string,
  mutate: (raw: Record<string, unknown>) => void,
): Promise<void> {
  const raw = JSON.parse(
    await readFile(path, "utf8"),
  ) as Record<string, unknown>;
  mutate(raw);
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
}

async function copyActorRoot(label: string): Promise<string> {
  const parent = await temporaryRoot(label);
  const actorRoot = join(parent, "actor-root");
  await cp(ACTOR_ROOT, actorRoot, { recursive: true });
  return actorRoot;
}

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), `goodmemory-c6-actor-v3-${label}-`),
  );
  temporaryRoots.push(root);
  return root;
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
