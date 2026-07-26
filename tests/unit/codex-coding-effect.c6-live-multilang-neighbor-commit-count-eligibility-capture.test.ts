import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  captureC6LiveMultiLangNeighborCommitCountEligibility,
  classifyC6LiveMultiLangNeighborCommitCountEligibility,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-capture";
import {
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan";

const SOURCE_PLAN_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v2.json",
);
const TOKEN = "secret-c6-commit-count-token";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 live MultiLang commit-count eligibility capture", () => {
  it("classifies 250 as eligible and 251 as platform-cap-excluded", () => {
    expect(
      classifyC6LiveMultiLangNeighborCommitCountEligibility(250),
    ).toBe("within-platform-cap");
    expect(
      classifyC6LiveMultiLangNeighborCommitCountEligibility(251),
    ).toBe("exceeds-platform-cap");
  }, 120_000);

  it("captures all 643 targets in frozen order with private closed assets", async () => {
    const fixture = await captureFixture();
    const observed = new Map<string, number>();
    const fetchImpl = mockFetch(({ variables }) => {
      const anchor = `${String(variables.owner).toLowerCase()}/${
        String(variables.name).toLowerCase()
      }#${variables.number}`;
      const count = anchor === "mbed-tls/mbedtls#10815" ? 251 : 250;
      observed.set(anchor, count);
      return successResponse(variables, count);
    });

    const result =
      await captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl,
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
        progress: () => {},
        sleep: async () => {},
      });

    expect(observed.size).toBe(643);
    expect(result).toMatchObject({
      capturedTargetCount: 643,
      eligibleTargetCount: 642,
      excludedTargetCount: 1,
      logicalRequestCount: 643,
      networkRequestCount: 643,
      outputRoot: fixture.outputRoot,
    });
    const completion = JSON.parse(
      await readFile(join(fixture.outputRoot, "completion.json"), "utf8"),
    ) as {
      captures: Array<{ canonicalAnchorId: string; status: string }>;
    };
    expect(completion.captures).toHaveLength(643);
    expect(completion.captures[256]).toMatchObject({
      canonicalAnchorId: "mbed-tls/mbedtls#10815",
      status: "exceeds-platform-cap",
    });
    const lock = JSON.parse(
      await readFile(join(fixture.outputRoot, "asset-lock.json"), "utf8"),
    ) as { assetRootSha256: string; files: Array<{ mode: number }> };
    expect(lock.assetRootSha256).toBe(result.assetRootSha256);
    expect(lock.files.every((file) => file.mode === 0o600)).toBe(true);
    expect((await lstat(fixture.outputRoot)).mode & 0o777).toBe(0o700);
    const allBytes = await captureTreeBytes(fixture.outputRoot);
    expect(allBytes.includes(TOKEN)).toBe(false);
  }, 120_000);

  it("rejects malformed identity, totalCount, and a swapped raw response", async () => {
    for (const mutation of [
      (response: Record<string, unknown>) => {
        const repository = responseRepository(response);
        repository.nameWithOwner = "wrong/repository";
      },
      (response: Record<string, unknown>) => {
        responsePull(response).commits = { totalCount: -1 };
      },
      (response: Record<string, unknown>) => {
        responsePull(response).number = 999_999;
      },
      (response: Record<string, unknown>) => {
        responseRepository(response).pullRequest = null;
      },
      (response: Record<string, unknown>) => {
        response.data = {};
      },
      (
        response: Record<string, unknown>,
        fixture: Awaited<ReturnType<typeof captureFixture>>,
      ) => {
        const swapped = fixture.plan.targets[1]!;
        const repository = responseRepository(response);
        const pull = responsePull(response);
        repository.nameWithOwner = swapped.canonicalRepository;
        pull.number = swapped.pullNumber;
        pull.url = swapped.url;
      },
    ]) {
      const fixture = await captureFixture();
      let calls = 0;
      await expect(
        captureC6LiveMultiLangNeighborCommitCountEligibility({
          authorizationToken: TOKEN,
          expectedPlanSha256: fixture.planSha256,
          expectedQuerySha256: sha256(
            C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
          ),
          expectedSourceTargetProjectionSha256:
            fixture.plan.independenceBoundary
              .sourceTargetProjectionSha256,
          expectedTargetCount: 643,
          fetchImpl: mockFetch(({ variables }) => {
            calls += 1;
            const response = successPayload(variables, 1);
            mutation(response, fixture);
            return jsonResponse(response);
          }),
          outputRoot: fixture.outputRoot,
          planPath: fixture.planPath,
          progress: () => {},
          sleep: async () => {},
        }),
      ).rejects.toThrow();
      expect(calls).toBe(1);
      await expect(lstat(fixture.outputRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  }, 120_000);

  it("rejects plan query-hash, target-count, order, and terminal drift", async () => {
    const fixture = await captureFixture();
    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: "0".repeat(64),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) =>
          successResponse(variables, 1)
        ),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
      }),
    ).rejects.toThrow("query hash mismatch");

    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 642,
        fetchImpl: mockFetch(({ variables }) =>
          successResponse(variables, 1)
        ),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
      }),
    ).rejects.toThrow("target count mismatch");

    let calls = 0;
    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) => {
          calls += 1;
          return successResponse(variables, 1);
        }),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
        progress: () => {},
        testHooks: {
          beforeTerminalPlanVerification: async () => {
            await writeFile(fixture.planPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow("plan changed");
    expect(calls).toBe(643);
  }, 120_000);

  it("retries transient failures and never persists or reports the token", async () => {
    const fixture = await captureFixture();
    let calls = 0;
    const progress: string[] = [];
    const sleeps: number[] = [];
    const result =
      await captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) => {
          calls += 1;
          if (calls === 1) {
            throw new Error(`temporary transport ${TOKEN}`);
          }
          if (calls === 2) {
            const response = jsonResponse(
              { message: "temporary failure" },
              503,
            );
            response.headers.set("retry-after", "9".repeat(400));
            return response;
          }
          if (calls === 3) {
            const response = jsonResponse(
              { message: "temporary failure" },
              503,
            );
            response.headers.set(
              "retry-after",
              "Sat, 26 Jul 2026 12:00:00 GMT",
            );
            return response;
          }
          return successResponse(variables, 1);
        }),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
        progress: (message) => progress.push(message),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      });

    expect(calls).toBe(646);
    expect(result.networkRequestCount).toBe(646);
    expect(sleeps).toEqual([1_000, 60_000, 4_000]);
    expect(progress.join("\n")).not.toContain(TOKEN);
    expect(await captureTreeBytes(fixture.outputRoot)).not.toContain(
      TOKEN,
    );
  }, 120_000);

  it("rejects token echo, symlink plans, EEXIST outputs, and mode drift", async () => {
    const fixture = await captureFixture();
    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: async () => jsonResponse({ echoed: TOKEN }),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
      }),
    ).rejects.toThrow("authorization token appeared");

    const linkPath = join(fixture.root, "plan-link.json");
    await symlink(fixture.planPath, linkPath);
    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) =>
          successResponse(variables, 1)
        ),
        outputRoot: fixture.outputRoot,
        planPath: linkPath,
      }),
    ).rejects.toThrow("rejects symlink");

    await writeFile(fixture.outputRoot, "foreign\n");
    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) =>
          successResponse(variables, 1)
        ),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
      }),
    ).rejects.toThrow("already exists");
    expect(await readFile(fixture.outputRoot, "utf8")).toBe("foreign\n");
    await rm(fixture.outputRoot);

    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) =>
          successResponse(variables, 1)
        ),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
        progress: () => {},
        testHooks: {
          beforePublishedVerification: async (outputRoot) => {
            await chmod(outputRoot, 0o755);
          },
        },
      }),
    ).rejects.toThrow("mode mismatch");
    await expect(lstat(fixture.outputRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);

  it("preserves a foreign replacement during rollback", async () => {
    const fixture = await captureFixture();
    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) =>
          successResponse(variables, 1)
        ),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
        progress: () => {},
        testHooks: {
          beforePublishedVerification: async (outputRoot) => {
            await rm(outputRoot, { recursive: true });
            await writeFile(outputRoot, "foreign-agent-output\n");
          },
        },
      }),
    ).rejects.toThrow();
    expect(await readFile(fixture.outputRoot, "utf8")).toBe(
      "foreign-agent-output\n",
    );
    expect(
      (await readdir(fixture.root)).some((name) =>
        name.includes(".incomplete-")
      ),
    ).toBe(false);
  }, 120_000);

  it("preserves foreign extra and replaced-child entries inside the published root", async () => {
    for (const mutation of [
      {
        foreignPath: "foreign-extra.txt",
        inject: async (outputRoot: string) => {
          await writeFile(
            join(outputRoot, "foreign-extra.txt"),
            "foreign-extra\n",
          );
        },
        value: "foreign-extra\n",
      },
      {
        foreignPath: "completion.json",
        inject: async (outputRoot: string) => {
          await rm(join(outputRoot, "completion.json"));
          await writeFile(
            join(outputRoot, "completion.json"),
            "foreign-replacement\n",
            { mode: 0o600 },
          );
        },
        value: "foreign-replacement\n",
      },
    ]) {
      const fixture = await captureFixture();
      await expect(
        captureC6LiveMultiLangNeighborCommitCountEligibility({
          authorizationToken: TOKEN,
          expectedPlanSha256: fixture.planSha256,
          expectedQuerySha256: sha256(
            C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
          ),
          expectedSourceTargetProjectionSha256:
            fixture.plan.independenceBoundary
              .sourceTargetProjectionSha256,
          expectedTargetCount: 643,
          fetchImpl: mockFetch(({ variables }) =>
            successResponse(variables, 1)
          ),
          outputRoot: fixture.outputRoot,
          planPath: fixture.planPath,
          progress: () => {},
          testHooks: {
            beforePublishedVerification: mutation.inject,
          },
        }),
      ).rejects.toThrow();
      expect(
        await readFile(
          join(fixture.outputRoot, mutation.foreignPath),
          "utf8",
        ),
      ).toBe(mutation.value);
    }
  }, 120_000);

  it("preserves a foreign extra entry inside the temporary root", async () => {
    const fixture = await captureFixture();
    await expect(
      captureC6LiveMultiLangNeighborCommitCountEligibility({
        authorizationToken: TOKEN,
        expectedPlanSha256: fixture.planSha256,
        expectedQuerySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        expectedSourceTargetProjectionSha256:
          fixture.plan.independenceBoundary
            .sourceTargetProjectionSha256,
        expectedTargetCount: 643,
        fetchImpl: mockFetch(({ variables }) =>
          successResponse(variables, 1)
        ),
        outputRoot: fixture.outputRoot,
        planPath: fixture.planPath,
        progress: () => {},
        testHooks: {
          beforePrepublicationVerification: async (temporaryRoot) => {
            await writeFile(
              join(temporaryRoot, "foreign-extra.txt"),
              "foreign-temporary\n",
            );
          },
        },
      }),
    ).rejects.toThrow("unexpected file");
    const incomplete = (await readdir(fixture.root)).find((name) =>
      name.startsWith("capture.incomplete-")
    );
    expect(incomplete).toBeDefined();
    expect(
      await readFile(
        join(fixture.root, incomplete!, "foreign-extra.txt"),
        "utf8",
      ),
    ).toBe("foreign-temporary\n");
    await expect(lstat(fixture.outputRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);
});

async function captureFixture() {
  const root = await temporaryRoot();
  const sourcePlanBytes = await readFile(SOURCE_PLAN_PATH);
  const plan =
    deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan({
      sourcePlanBytes,
      sourcePlanPath: SOURCE_PLAN_PATH,
    });
  const planBytes = Buffer.from(
    serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(plan),
  );
  const planPath = join(root, "eligibility-plan.json");
  await writeFile(planPath, planBytes, { mode: 0o644 });
  return {
    outputRoot: join(root, "capture"),
    plan,
    planPath,
    planSha256: sha256(planBytes),
    root,
  };
}

function mockFetch(
  responder: (input: {
    variables: Record<string, unknown>;
  }) => Response,
) {
  return async (
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(body.query).toBe(
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
    );
    expect(String(new Headers(init?.headers).get("authorization")))
      .toBe(`Bearer ${TOKEN}`);
    return responder({ variables: body.variables });
  };
}

function successResponse(
  variables: Record<string, unknown>,
  totalCount: number,
): Response {
  return jsonResponse(successPayload(variables, totalCount));
}

function successPayload(
  variables: Record<string, unknown>,
  totalCount: number,
): Record<string, unknown> {
  const owner = String(variables.owner);
  const repo = String(variables.name);
  const number = Number(variables.number);
  return {
    data: {
      rateLimit: {
        cost: 1,
        remaining: 4_999,
        resetAt: "2026-07-26T12:00:00Z",
      },
      repository: {
        id: `repository-${owner}-${repo}`,
        nameWithOwner: `${owner}/${repo}`,
        pullRequest: {
          commits: { totalCount },
          id: `pull-${owner}-${repo}-${number}`,
          number,
          url: `https://github.com/${owner}/${repo}/pull/${number}`,
        },
      },
    },
  };
}

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: "Sat, 26 Jul 2026 12:00:00 GMT",
      "x-github-request-id": "TEST:commit-count",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": "1785067200",
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "1",
    },
    status,
  });
}

function responseRepository(response: Record<string, unknown>) {
  return (
    response.data as {
      repository: Record<string, unknown>;
    }
  ).repository;
}

function responsePull(response: Record<string, unknown>) {
  return responseRepository(response).pullRequest as
    Record<string, unknown>;
}

async function captureTreeBytes(root: string): Promise<string> {
  const glob = new Bun.Glob("**/*");
  const paths = await Array.fromAsync(glob.scan({
    cwd: root,
    onlyFiles: true,
  }));
  const bytes = await Promise.all(
    paths.sort().map((path) => readFile(join(root, path))),
  );
  return Buffer.concat(bytes).toString("utf8");
}

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(
      join(tmpdir(), "goodmemory-c6-commit-count-capture-"),
    ),
  );
  temporaryRoots.push(root);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
