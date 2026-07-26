import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureC6ReviewerActorIdentities,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-identity-capture";
import {
  deriveC6LiveMultiLangNeighborActorPlanV2,
  parseC6LiveMultiLangNeighborActorPlanV2,
  serializeC6LiveMultiLangNeighborActorPlanV2,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan-v2";
import {
  parseC6LiveMultiLangNeighborStructuralUnion,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union";
import {
  C6_REVIEWER_ACTOR_POLICY_V1,
  serializeC6ReviewerActorPolicy,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-policy";

const cleanup: string[] = [];
const V2_STRUCTURAL_UNION_PATH = join(
  import.meta.dir,
  "../../fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-union-v1.json",
);
let cachedV2PlanBytes: Buffer | null = null;

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("Codex coding-effect C6 reviewer actor identity capture", () => {
  it("captures every frozen actor, including fail-closed 404 identities", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-reviewer-actors-")),
    );
    cleanup.push(root);
    const planPath = join(root, "plan.json");
    const outputRoot = join(root, "capture");
    const planBytes = bytes(plan());
    await writeFile(planPath, planBytes);
    const calls: string[] = [];

    const result = await captureC6ReviewerActorIdentities({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer secret-token",
        );
        if (url.endsWith("/missing-actor")) {
          return githubResponse(
            url,
            { message: "Not Found" },
            404,
          );
        }
        return githubResponse(url, {
          login: "human-reviewer",
          type: "User",
        });
      },
      outputRoot,
      planPath,
      progress: () => {},
    });

    expect(calls).toEqual([
      "https://api.github.com/users/human-reviewer",
      "https://api.github.com/users/missing-actor",
    ]);
    expect(result).toMatchObject({
      capturedTargetCount: 2,
      captureAttemptCompletenessProven: true,
      eligibleActorCount: 1,
    });
    const capture = JSON.parse(
      await readFile(join(outputRoot, "capture.json"), "utf8"),
    ) as {
      captures: Array<{ reason: string; status: number }>;
      counts: {
        eligibleActorCount: number;
        unresolvedActorCount: number;
      };
    };
    expect(capture.counts).toMatchObject({
      eligibleActorCount: 1,
      unresolvedActorCount: 1,
    });
    expect(capture.captures.map((entry) => [
      entry.status,
      entry.reason,
    ])).toEqual([
      [200, "eligible-platform-user"],
      [404, "platform-actor-unresolved"],
    ]);
    expect(
      await readFile(
        join(
          outputRoot,
          plan().targets[0]!.captureDirectory,
          "attempt-01",
          "request.json",
        ),
        "utf8",
      ),
    ).not.toContain("secret-token");
  });

  it("fails before publication on status, identity drift, or existing output", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-reviewer-actors-")),
    );
    cleanup.push(root);
    const planPath = join(root, "plan.json");
    const outputRoot = join(root, "capture");
    const planBytes = bytes(plan());
    await writeFile(planPath, planBytes);
    let retryRequestCount = 0;

    await expect(captureC6ReviewerActorIdentities({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async (input) => {
        retryRequestCount += 1;
        return githubResponse(
          String(input),
          { message: "unavailable" },
          503,
        );
      },
      outputRoot,
      planPath,
      progress: () => {},
      sleep: async () => {},
    })).rejects.toThrow("unexpected HTTP status 503");
    expect(retryRequestCount).toBe(4);
    await expect(readFile(join(outputRoot, "capture.json")))
      .rejects.toThrow();

    await expect(captureC6ReviewerActorIdentities({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async (input) =>
        githubResponse(String(input), {
          login: "different-reviewer",
          type: "User",
        }),
      outputRoot,
      planPath,
    })).rejects.toThrow("actor identity mismatch");

    await mkdir(outputRoot);
    await writeFile(join(outputRoot, "foreign.txt"), "foreign\n");
    let requestCount = 0;
    await expect(captureC6ReviewerActorIdentities({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async () => {
        requestCount += 1;
        return githubResponse(
          "https://api.github.com/users/human-reviewer",
          { message: "unreachable" },
          500,
        );
      },
      outputRoot,
      planPath,
      progress: () => {},
    })).rejects.toThrow("output root already exists");
    expect(requestCount).toBe(0);
    expect(
      await readFile(join(outputRoot, "foreign.txt"), "utf8"),
    ).toBe("foreign\n");
  });

  it("preserves a foreign output-root replacement after publication", async () => {
    const fixture = await createFixture();
    let temporaryRoot = "";

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async (paths) => {
          temporaryRoot = paths.temporaryRoot;
          await rm(paths.outputRoot, { recursive: true });
          await mkdir(paths.outputRoot, { mode: 0o700 });
          await writeFile(
            join(paths.outputRoot, "foreign.txt"),
            "foreign-output\n",
            { mode: 0o600 },
          );
        },
      },
    })).rejects.toThrow();

    expect(
      await readFile(
        join(fixture.outputRoot, "foreign.txt"),
        "utf8",
      ),
    ).toBe("foreign-output\n");
    expect(await pathExists(temporaryRoot)).toBe(false);
  });

  it("does not write into a foreign root replacement after root creation", async () => {
    const fixture = await createFixture();

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputRootCreation: async ({ outputRoot }) => {
          await rm(outputRoot, { recursive: true });
          await mkdir(outputRoot, { mode: 0o700 });
          await writeFile(
            join(outputRoot, "foreign.txt"),
            "foreign-root\n",
            { mode: 0o600 },
          );
        },
      },
    })).rejects.toThrow(/owned path identity changed/u);

    expect(await readdir(fixture.outputRoot)).toEqual([
      "foreign.txt",
    ]);
    expect(
      await readFile(
        join(fixture.outputRoot, "foreign.txt"),
        "utf8",
      ),
    ).toBe("foreign-root\n");
  });

  it("rejects noncanonical plan structure before any request", async () => {
    const fixture = await createFixture({
      planValue: {
        ...plan(),
        unexpected: true,
      },
    });
    let requestCount = 0;

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (input) => {
        requestCount += 1;
        return githubResponse(String(input), {
          login: "human-reviewer",
          type: "User",
        });
      },
    })).rejects.toThrow();

    expect(requestCount).toBe(0);
  });

  it("accepts the frozen live neighbor actor plan before transport", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-reviewer-actors-")),
    );
    cleanup.push(root);
    const planPath = join(
      import.meta.dir,
      "../../fixtures/codex-coding-effect/c6-source-pool/" +
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-reviewer-actor-plan-v1.json",
    );
    const planBytes = await readFile(planPath);
    expect(sha256(planBytes)).toBe(
      "abb0a817611c7f5568c0f3390625598a46a1a56c687617815260ee98121a92d3",
    );
    let requestCount = 0;

    await expect(captureC6ReviewerActorIdentities({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async () => {
        requestCount += 1;
        throw new Error("capture-stop");
      },
      outputRoot: join(root, "capture"),
      planPath,
    })).rejects.toThrow("capture-stop");

    expect(requestCount).toBe(1);
  });

  it("captures every v2 target as policy-neutral current-platform identity evidence", async () => {
    const planBytes = await v2PlanBytes();
    const fixture = await createFixture({ planBytes });
    const actorPlan =
      parseC6LiveMultiLangNeighborActorPlanV2(planBytes);
    let requestCount = 0;

    const result = await captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (input, init) => {
        requestCount += 1;
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer secret-token",
        );
        const url = String(input);
        const login = decodeURIComponent(
          new URL(url).pathname.split("/").at(-1)!,
        );
        return login === "zwick"
          ? githubResponse(url, { message: "Not Found" }, 404)
          : githubResponse(url, { login, type: "User" });
      },
    });

    expect(requestCount).toBe(507);
    expect(result).toMatchObject({
      actorEligibilityDecisionApplied: false,
      capturedTargetCount: 507,
      captureAttemptCompletenessProven: true,
      networkAttemptCount: 507,
    });
    expect("eligibleActorCount" in result).toBe(false);

    const root = JSON.parse(
      await readFile(
        join(fixture.outputRoot, "capture.json"),
        "utf8",
      ),
    ) as {
      boundary: Record<string, unknown>;
      captures: Array<Record<string, unknown> & {
        login: string;
        platformType: string | null;
        status: number;
      }>;
      counts: Record<string, number>;
      plan: {
        schemaVersion: number;
        sha256: string;
        targetProjectionSha256: string;
      };
      schemaVersion: number;
    };
    expect(root.schemaVersion).toBe(3);
    expect(root.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      actorEligibilityDecisionApplied: false,
      captureAttemptCompletenessProven: true,
      selectionExecuted: false,
    });
    expect(root.counts).toEqual({
      capturedTargetCount: 507,
      networkAttemptCount: 507,
      plannedTargetCount: 507,
      resolvedActorCount: 506,
      retryCount: 0,
      unresolvedActorCount: 1,
    });
    expect(root.plan).toMatchObject({
      schemaVersion: 2,
      sha256: sha256(planBytes),
      targetProjectionSha256:
        "68ac8d1823039f7375dc6903676ed146b3704511c4bb79bd077a15d38bc5b53c",
    });
    expect("policy" in root).toBe(false);
    expect(root.captures.every((capture) =>
      !("eligible" in capture) && !("reason" in capture)
    )).toBe(true);
    expect(
      root.captures.find((capture) =>
        capture.login === "coderabbitai"
      ),
    ).toMatchObject({
      login: "coderabbitai",
      platformType: "User",
      status: 200,
    });
    expect(root.captures.at(-1)).toMatchObject({
      login: "zwick",
      platformType: null,
      status: 404,
    });

    const automationTarget = actorPlan.targets.find((target) =>
      target.login === "coderabbitai"
    )!;
    const manifest = JSON.parse(
      await readFile(
        join(
          fixture.outputRoot,
          automationTarget.captureDirectory,
          "manifest.json",
        ),
        "utf8",
      ),
    ) as {
      boundary: Record<string, unknown>;
      capture: Record<string, unknown>;
      schemaVersion: number;
    };
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      actorEligibilityDecisionApplied: false,
      selectionExecuted: false,
    });
    expect("eligible" in manifest.capture).toBe(false);
    expect("reason" in manifest.capture).toBe(false);
    expect("policy" in manifest).toBe(false);
    expect(await readTreeUtf8(fixture.outputRoot))
      .not.toContain("secret-token");
  });

  it("strictly rejects v2 policy injection and plan dispatch drift before transport", async () => {
    const planBytes = await v2PlanBytes();
    const mutations: Array<(planValue: Record<string, unknown>) => void> = [
      (planValue) => {
        planValue.policy = {
          policyId: "reviewer-platform-actor-eligibility-v2",
        };
      },
      (planValue) => {
        planValue.schemaVersion = 1;
      },
      (planValue) => {
        const boundary = planValue.independenceBoundary as
          Record<string, unknown>;
        boundary.targetProjectionSha256 = "f".repeat(64);
      },
    ];

    for (const mutate of mutations) {
      const planValue = JSON.parse(
        planBytes.toString("utf8"),
      ) as Record<string, unknown>;
      mutate(planValue);
      const fixture = await createFixture({ planValue });
      let requestCount = 0;

      await expect(captureC6ReviewerActorIdentities({
        ...captureInput(fixture),
        fetchImpl: async () => {
          requestCount += 1;
          throw new Error("must not request");
        },
      })).rejects.toThrow();
      expect(requestCount).toBe(0);
    }
  });

  it("rejects terminal v2 plan mutation after all simulated captures", async () => {
    const planBytes = await v2PlanBytes();
    const fixture = await createFixture({ planBytes });
    let requestCount = 0;

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (input) => {
        requestCount += 1;
        const url = String(input);
        const login = decodeURIComponent(
          new URL(url).pathname.split("/").at(-1)!,
        );
        return githubResponse(url, { login, type: "User" });
      },
      testHooks: {
        afterOutputPublication: async () => {
          await writeFile(fixture.planPath, "{}\n");
        },
      },
    })).rejects.toThrow(/plan changed during capture/u);

    expect(requestCount).toBe(507);
    expect(await pathExists(fixture.outputRoot)).toBe(false);
  });

  it("stops before the next actor when the frozen plan drifts", async () => {
    const fixture = await createFixture();
    let requestCount = 0;

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (input) => {
        requestCount += 1;
        await writeFile(fixture.planPath, "{}\n");
        return githubResponse(String(input), {
          login: "human-reviewer",
          type: "User",
        });
      },
    })).rejects.toThrow(/plan changed during capture/u);

    expect(requestCount).toBe(1);
  });

  it("persists every bounded retry attempt and sanitizes transient errors", async () => {
    const fixture = await createFixture({
      planValue: oneTargetPlan(),
    });
    const sleeps: number[] = [];
    const progress: string[] = [];
    let requestCount = 0;

    const result = await captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (input) => {
        requestCount += 1;
        const url = String(input);
        if (requestCount === 1) {
          return githubResponse(
            url,
            { message: "busy" },
            503,
            { "retry-after": "9999" },
          );
        }
        if (requestCount === 2) {
          throw Object.assign(
            new Error("reset secret-token"),
            { code: "ECONNRESET" },
          );
        }
        return githubResponse(url, {
          login: "human-reviewer",
          type: "User",
        });
      },
      progress: (message) => progress.push(message),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(requestCount).toBe(3);
    expect(sleeps).toEqual([60_000, 2_000]);
    expect(progress.join("\n")).not.toContain("secret-token");
    expect(result.networkAttemptCount).toBe(3);
    const targetRoot = join(
      fixture.outputRoot,
      oneTargetPlan().targets[0]!.captureDirectory,
    );
    expect((await readdir(targetRoot)).sort()).toEqual([
      "attempt-01",
      "attempt-02",
      "attempt-03",
      "manifest.json",
    ]);
    const manifest = JSON.parse(
      await readFile(join(targetRoot, "manifest.json"), "utf8"),
    ) as {
      attempts: Array<{
        attempt: number;
        retryAfterMilliseconds?: number;
        transportError?: { path: string };
      }>;
      capture: { finalAttempt: number; networkAttemptCount: number };
      schemaVersion: number;
    };
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.capture).toMatchObject({
      finalAttempt: 3,
      networkAttemptCount: 3,
    });
    expect(manifest.attempts.map((attempt) => [
      attempt.attempt,
      attempt.retryAfterMilliseconds ?? null,
    ])).toEqual([
      [1, 60_000],
      [2, 2_000],
      [3, null],
    ]);
    expect(
      await readFile(
        join(targetRoot, "attempt-02", "transport-error.json"),
        "utf8",
      ),
    ).toContain("[REDACTED]");
  });

  it("does not retry permanent transport errors and redacts thrown text", async () => {
    const fixture = await createFixture({
      planValue: oneTargetPlan(),
    });
    let requestCount = 0;
    let thrown: unknown;

    try {
      await captureC6ReviewerActorIdentities({
        ...captureInput(fixture),
        fetchImpl: async () => {
          requestCount += 1;
          throw new Error("permanent secret-token");
        },
        sleep: async () => {
          throw new Error("must not sleep");
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(requestCount).toBe(1);
    expect(String(thrown)).toContain("[REDACTED]");
    expect(String(thrown)).not.toContain("secret-token");
  });

  it("validates timeout bounds before any request", async () => {
    const fixture = await createFixture({
      planValue: oneTargetPlan(),
    });
    let requestCount = 0;

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (input) => {
        requestCount += 1;
        return githubResponse(String(input), {
          login: "human-reviewer",
          type: "User",
        });
      },
      requestTimeoutMilliseconds: 300_001,
    })).rejects.toThrow(/timeout/u);

    expect(requestCount).toBe(0);
  });

  it("retries a timed-out request only three times", async () => {
    const fixture = await createFixture({
      planValue: oneTargetPlan(),
    });
    const sleeps: number[] = [];
    let requestCount = 0;

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (_input, init) => {
        requestCount += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          }, { once: true });
        });
      },
      requestTimeoutMilliseconds: 1,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    })).rejects.toThrow(/timeout failed after|transport timeout failed/u);

    expect(requestCount).toBe(4);
    expect(sleeps).toEqual([1_000, 2_000, 4_000]);
  });

  it("rejects missing success headers and response identity drift", async () => {
    for (const fetchImpl of [
      async (input: string | URL | Request) =>
        responseWithIdentity(
          new Response(JSON.stringify({
            login: "human-reviewer",
            type: "User",
          }), { status: 200 }),
          String(input),
          false,
        ),
      async (input: string | URL | Request) =>
        githubResponse(
          `${String(input)}-wrong`,
          {
            login: "human-reviewer",
            type: "User",
          },
        ),
      async (input: string | URL | Request) =>
        responseWithIdentity(
          githubResponse(String(input), {
            login: "human-reviewer",
            type: "User",
          }),
          String(input),
          true,
        ),
    ]) {
      const fixture = await createFixture({
        planValue: oneTargetPlan(),
      });
      await expect(captureC6ReviewerActorIdentities({
        ...captureInput(fixture),
        fetchImpl,
      })).rejects.toThrow();
    }
  });

  it("requires the 404 object error schema without actor identity", async () => {
    const fixture = await createFixture({
      planValue: oneTargetPlan(),
    });
    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      fetchImpl: async (input) =>
        githubResponse(String(input), {
          login: "human-reviewer",
          message: "Not Found",
          type: "User",
        }, 404),
    })).rejects.toThrow();
  });

  it("rolls back an owned output root after terminal mode drift", async () => {
    const fixture = await createFixture();
    let temporaryRoot = "";

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async (paths) => {
          temporaryRoot = paths.temporaryRoot;
          await chmod(paths.outputRoot, 0o755);
        },
      },
    })).rejects.toThrow();

    expect(await pathExists(fixture.outputRoot)).toBe(false);
    expect(await pathExists(temporaryRoot)).toBe(false);
  });

  it("rejects terminal plan-byte drift after publication", async () => {
    const fixture = await createFixture();

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async () => {
          await writeFile(fixture.planPath, "{}\n");
        },
      },
    })).rejects.toThrow(/plan changed during capture/u);

    expect(await pathExists(fixture.outputRoot)).toBe(false);
  });

  it("rejects published file, directory, and root mode drift", async () => {
    for (const mutation of [
      async (fixture: Fixture) => {
        await chmod(
          join(fixture.outputRoot, "capture.json"),
          0o644,
        );
      },
      async (fixture: Fixture) => {
        await chmod(
          join(
            fixture.outputRoot,
            plan().targets[0]!.captureDirectory,
          ),
          0o755,
        );
      },
      async (fixture: Fixture) => {
        await chmod(fixture.outputRoot, 0o755);
      },
      async (fixture: Fixture) => {
        await setSpecialMode(
          "4600",
          join(fixture.outputRoot, "capture.json"),
        );
      },
    ]) {
      const fixture = await createFixture();
      await expect(captureC6ReviewerActorIdentities({
        ...captureInput(fixture),
        testHooks: {
          afterOutputPublication: () => mutation(fixture),
        },
      })).rejects.toThrow(/mode mismatch/u);
      expect(await pathExists(fixture.outputRoot)).toBe(false);
    }
  });

  it("rejects and preserves a foreign symlink in the published tree", async () => {
    const fixture = await createFixture();
    const publishedCapturePath = join(
      fixture.outputRoot,
      "capture.json",
    );

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async () => {
          await rm(publishedCapturePath);
          await symlink(fixture.planPath, publishedCapturePath);
        },
      },
    })).rejects.toThrow();

    expect((await lstat(publishedCapturePath)).isSymbolicLink())
      .toBe(true);
  });

  it("rejects and preserves a foreign published-root symlink", async () => {
    const fixture = await createFixture();
    const foreignRoot = join(
      fixture.outputRoot,
      "..",
      "foreign-root",
    );
    await mkdir(foreignRoot, { mode: 0o700 });
    await writeFile(
      join(foreignRoot, "foreign.txt"),
      "foreign-root\n",
      { mode: 0o600 },
    );

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async () => {
          await rm(fixture.outputRoot, { recursive: true });
          await symlink(foreignRoot, fixture.outputRoot);
        },
      },
    })).rejects.toThrow(/symlink path component/u);

    expect((await lstat(fixture.outputRoot)).isSymbolicLink())
      .toBe(true);
    expect(
      await readFile(join(foreignRoot, "foreign.txt"), "utf8"),
    ).toBe("foreign-root\n");
  });

  it("rejects and preserves an extra published entry", async () => {
    const fixture = await createFixture();
    const extraPath = join(fixture.outputRoot, "foreign.txt");

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async () => {
          await writeFile(extraPath, "foreign-entry\n", {
            mode: 0o600,
          });
        },
      },
    })).rejects.toThrow(/unexpected file/u);

    expect(await readFile(extraPath, "utf8"))
      .toBe("foreign-entry\n");
  });

  it("rejects and preserves an extra published directory", async () => {
    const fixture = await createFixture();
    const extraPath = join(fixture.outputRoot, "foreign-directory");

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async () => {
          await mkdir(extraPath, { mode: 0o700 });
        },
      },
    })).rejects.toThrow(/unexpected directory/u);

    expect((await lstat(extraPath)).isDirectory()).toBe(true);
  });

  it("rejects the asset-lock filename as an extra published entry", async () => {
    const fixture = await createFixture();
    const extraPath = join(fixture.outputRoot, "asset-lock.json");

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async () => {
          await writeFile(extraPath, "{}\n", { mode: 0o600 });
        },
      },
    })).rejects.toThrow(/unexpected file/u);

    expect(await readFile(extraPath, "utf8")).toBe("{}\n");
  });

  it("preserves a publication-time EEXIST entry", async () => {
    const fixture = await createFixture();
    const foreignPath = join(fixture.outputRoot, "capture.json");

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputRootCreation: async () => {
          await writeFile(foreignPath, "foreign-eexist\n", {
            mode: 0o600,
          });
        },
      },
    })).rejects.toThrow();

    expect(await readFile(foreignPath, "utf8"))
      .toBe("foreign-eexist\n");
  });

  it("rejects a missing temporary root without unsafe cleanup", async () => {
    const fixture = await createFixture();
    let temporaryRoot = "";

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async (paths) => {
          temporaryRoot = paths.temporaryRoot;
          await rm(temporaryRoot, { recursive: true });
        },
      },
    })).rejects.toThrow();

    expect(await pathExists(temporaryRoot)).toBe(false);
    expect(await pathExists(fixture.outputRoot)).toBe(false);
  });

  it("preserves a foreign temporary-root replacement", async () => {
    const fixture = await createFixture();
    let foreignPath = "";

    await expect(captureC6ReviewerActorIdentities({
      ...captureInput(fixture),
      testHooks: {
        afterOutputPublication: async (paths) => {
          await rm(paths.temporaryRoot, { recursive: true });
          await mkdir(paths.temporaryRoot, { mode: 0o700 });
          foreignPath = join(paths.temporaryRoot, "foreign.txt");
          await writeFile(foreignPath, "foreign-temporary\n", {
            mode: 0o600,
          });
        },
      },
    })).rejects.toThrow();

    expect(await readFile(foreignPath, "utf8"))
      .toBe("foreign-temporary\n");
    expect(await pathExists(fixture.outputRoot)).toBe(false);
  });
});

interface Fixture {
  outputRoot: string;
  planBytes: Buffer;
  planPath: string;
}

async function createFixture(input?: {
  planBytes?: Buffer;
  planValue?: unknown;
}): Promise<Fixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "c6-reviewer-actors-")),
  );
  cleanup.push(root);
  const planPath = join(root, "plan.json");
  const planBytes = input?.planBytes ??
    bytes(input?.planValue ?? plan());
  await writeFile(planPath, planBytes);
  return {
    outputRoot: join(root, "capture"),
    planBytes,
    planPath,
  };
}

async function v2PlanBytes(): Promise<Buffer> {
  if (cachedV2PlanBytes === null) {
    const union =
      parseC6LiveMultiLangNeighborStructuralUnion(
        await readFile(V2_STRUCTURAL_UNION_PATH),
      );
    const plan =
      deriveC6LiveMultiLangNeighborActorPlanV2(union);
    cachedV2PlanBytes = Buffer.from(
      serializeC6LiveMultiLangNeighborActorPlanV2(plan),
    );
  }
  return Buffer.from(cachedV2PlanBytes);
}

async function readTreeUtf8(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  const contents: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    contents.push(entry.isDirectory()
      ? await readTreeUtf8(path)
      : await readFile(path, "utf8"));
  }
  return contents.join("\n");
}

function captureInput(fixture: Fixture) {
  return {
    authorizationToken: "secret-token",
    expectedPlanSha256: sha256(fixture.planBytes),
    fetchImpl: async (input: string | URL | Request) => {
      const login = decodeURIComponent(
        new URL(String(input)).pathname.split("/").at(-1)!,
      );
      return githubResponse(String(input), {
        login,
        type: "User",
      });
    },
    outputRoot: fixture.outputRoot,
    planPath: fixture.planPath,
    progress: () => {},
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function setSpecialMode(
  mode: string,
  path: string,
): Promise<void> {
  const child = Bun.spawn(["chmod", mode, path], {
    stderr: "pipe",
    stdout: "pipe",
  });
  if (await child.exited !== 0) {
    throw new Error("test chmod failed");
  }
}

function plan() {
  const targets = [
    target("human-reviewer", 1),
    target("missing-actor", 2),
  ];
  return {
    artifactKind: "c6-reviewer-actor-identity-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "reviewer-actor-identity-capture-required",
    },
    counts: {
      sourceReviewReferenceCount: 2,
      sourceTargetCount: 1,
      uniqueActorCount: targets.length,
    },
    independenceBoundary: {
      goldInput: false,
      machineOutcomeInput: false,
      semanticLedgerInput: false,
      selectedSequenceInput: false,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    inputs: {
      graphqlRootSha256: "a".repeat(64),
      qualification: {
        bytes: 100,
        path: "qualification.json",
        sha256: "b".repeat(64),
      },
    },
    policy: {
      definition: C6_REVIEWER_ACTOR_POLICY_V1,
      policyId: C6_REVIEWER_ACTOR_POLICY_V1.policyId,
      schemaVersion: 1,
      sha256: sha256(serializeC6ReviewerActorPolicy()),
    },
    rule: {
      actorSurface:
        "all-non-null-whole-review-and-review-thread-comment-authors",
      captureOrder: "normalized-login-code-unit-ascending",
      normalization: "case-insensitive-login",
    },
    schemaVersion: 1,
    targets,
  };
}

function oneTargetPlan(): ReturnType<typeof plan> {
  const value = plan();
  const targets = [value.targets[0]!];
  return {
    ...value,
    counts: {
      ...value.counts,
      sourceReviewReferenceCount: 1,
      uniqueActorCount: 1,
    },
    independenceBoundary: {
      ...value.independenceBoundary,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    targets,
  };
}

function githubResponse(
  url: string,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return responseWithIdentity(
    new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        date: "Sun, 26 Jul 2026 12:00:00 GMT",
        "x-github-request-id": "request-id",
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1785070800",
        "x-ratelimit-resource": "core",
        "x-ratelimit-used": "1",
        ...headers,
      },
      status,
    }),
    url,
    false,
  );
}

function responseWithIdentity(
  response: Response,
  url: string,
  redirected: boolean,
): Response {
  Object.defineProperties(response, {
    redirected: {
      configurable: true,
      value: redirected,
    },
    url: {
      configurable: true,
      value: url,
    },
  });
  return response;
}

function target(login: string, captureOrder: number) {
  return {
    captureDirectory: `actor-${sha256(login)}`,
    captureOrder,
    login,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
