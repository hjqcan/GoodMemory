import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  buildC6RestReviewerActorFilteredQualification,
  projectC6RestReviewerActorQualificationTargets,
} from "../../scripts/codex-coding-effect/c6-rest-reviewer-actor-filtered-qualification";
import {
  buildC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  captureC6ReviewerActorIdentities,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-identity-capture";
import {
  deriveC6ReviewerActorIdentityPlan,
  serializeC6ReviewerActorIdentityPlan,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-identity-plan";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("Codex coding-effect C6 REST reviewer actor qualification adapter", () => {
  it("normalizes REST qualification rows into actor-filter targets", () => {
    const targets = projectC6RestReviewerActorQualificationTargets({
      pullAuthors: new Map([["example__repo__1", "pull-author"]]),
      results: [{
        anchorId: "Example/Repo#1",
        canonicalAnchorId: "Example/Repo#1",
        captureDirectory: "example__repo__1",
        captureOrder: 1,
        source: {
          path: "ts/example__repo_dataset.jsonl",
          rowIndex: 4,
          rowSha256: "a".repeat(64),
        },
        status: "exact-structural-candidate",
      }],
    });

    expect(targets).toEqual([{
      canonicalAnchorId: "example/repo#1",
      canonicalRepository: "example/repo",
      captureDirectory: "example__repo__1",
      captureOrder: 1,
      pullAuthor: "pull-author",
      requestedAnchorId: "example/repo#1",
      source: {
        path: "ts/example__repo_dataset.jsonl",
        rowIndex: 4,
        rowSha256: "a".repeat(64),
      },
      status: "exact-structural-candidate",
    }]);
  });

  it("fails closed when a REST target has no pull-author closure", () => {
    expect(() =>
      projectC6RestReviewerActorQualificationTargets({
        pullAuthors: new Map(),
        results: [{
          anchorId: "example/repo#1",
          canonicalAnchorId: "example/repo#1",
          captureDirectory: "example__repo__1",
          captureOrder: 1,
          source: {
            path: "ts/example__repo_dataset.jsonl",
            rowIndex: 4,
            rowSha256: "a".repeat(64),
          },
          status: "no-exact-structural-sequence",
        }],
      })
    ).toThrow("missing pull author");
  });

  it("rejects actor plan mutation after the initial closure load", async () => {
    const fixture = await buildFixture();

    await expect(
      buildC6RestReviewerActorFilteredQualification({
        ...fixture.input,
        testHooks: {
          beforeTerminalVerification: async () => {
            await writeFile(
              fixture.actorPlanPath,
              `${fixture.actorPlanBytes.toString("utf8")} `,
            );
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects actor root mutation after the initial closure load", async () => {
    const fixture = await buildFixture();

    await expect(
      buildC6RestReviewerActorFilteredQualification({
        ...fixture.input,
        testHooks: {
          beforeTerminalVerification: async () => {
            await writeFile(
              fixture.actorResponsePath,
              "{\"login\":\"changed\",\"type\":\"User\"}\n",
            );
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("strictly replays a complete HTTP retry receipt chain", async () => {
    const fixture = await buildFixture({ retryFirstActor: true });

    const result =
      await buildC6RestReviewerActorFilteredQualification(
        fixture.input,
      );
    expect(result).toBeDefined();
  });

  it("rejects a mutated retry delay with a freshly bound asset root", async () => {
    const fixture = await buildFixture({ retryFirstActor: true });
    const manifest = JSON.parse(
      await readFile(fixture.actorManifestPath, "utf8"),
    ) as {
      attempts: Array<{ retryAfterMilliseconds?: number }>;
    };
    manifest.attempts[0]!.retryAfterMilliseconds = 7;
    await writeFile(fixture.actorManifestPath, bytes(manifest));

    await expect(
      buildC6RestReviewerActorFilteredQualification(
        await withCurrentActorRoot(fixture),
      ),
    ).rejects.toThrow(/retry delay|Retry-After/u);
  });

  it("rejects missing, extra, and structurally invalid attempt files", async () => {
    for (const mutate of [
      async (fixture: BuiltFixture) => {
        await rm(fixture.actorFinalResponsePath);
      },
      async (fixture: BuiltFixture) => {
        await writeFile(
          join(fixture.actorFirstAttemptRoot, "extra.json"),
          bytes({ unexpected: true }),
        );
      },
      async (fixture: BuiltFixture) => {
        const headers = JSON.parse(
          await readFile(
            fixture.actorFirstResponseHeadersPath,
            "utf8",
          ),
        ) as Record<string, unknown>;
        headers.authorization = "forbidden";
        await writeFile(
          fixture.actorFirstResponseHeadersPath,
          bytes(headers),
        );
      },
    ]) {
      const fixture = await buildFixture({ retryFirstActor: true });
      await mutate(fixture);
      await expect(
        buildC6RestReviewerActorFilteredQualification(
          await withCurrentActorRoot(fixture),
        ),
      ).rejects.toThrow();
    }
  });
});

interface BuiltFixture {
  actorFinalResponsePath: string;
  actorFirstAttemptRoot: string;
  actorFirstResponseHeadersPath: string;
  actorManifestPath: string;
  actorResponsePath: string;
  actorRoot: string;
  actorPlanBytes: Buffer;
  actorPlanPath: string;
  input: Parameters<
    typeof buildC6RestReviewerActorFilteredQualification
  >[0];
}

async function buildFixture(options?: {
  retryFirstActor?: boolean;
}): Promise<BuiltFixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "c6-rest-actor-qualification-")),
  );
  cleanup.push(root);
  const actorPlanPath = join(root, "actor-plan.json");
  const actorRoot = join(root, "actor-root");
  const baseQualificationPath = join(root, "qualification.json");
  const graphqlRoot = join(root, "graphql");
  const originalRestRoot = join(root, "original-rest");
  const supplementRoot = join(root, "supplement-rest");
  await Promise.all([
    mkdir(join(graphqlRoot, "example__repo__1"), {
      recursive: true,
    }),
    mkdir(
      join(
        originalRestRoot,
        "example__repo__1",
        "responses",
      ),
      { recursive: true },
    ),
    mkdir(supplementRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(graphqlRoot, "example__repo__1", "response.json"),
      bytes(graphqlResponse()),
    ),
    writeFile(
      join(
        originalRestRoot,
        "example__repo__1",
        "responses",
        "pull.json",
      ),
      bytes({
        base: { repo: { full_name: "example/repo" } },
        number: 1,
        user: { login: "pull-author" },
      }),
    ),
    writeFile(
      join(supplementRoot, "closure.json"),
      bytes({ unused: true }),
    ),
  ]);
  const [graphqlLock, originalRestLock, supplementLock] =
    await Promise.all([
      buildC6AssetLock(graphqlRoot),
      buildC6AssetLock(originalRestRoot),
      buildC6AssetLock(supplementRoot),
    ]);
  const qualificationBytes = bytes({
    artifactKind: "c6-source-expansion-rest-qualification-v2",
    counts: { targetCount: 1 },
    inputs: {
      graphqlRootSha256: graphqlLock.assetRootSha256,
      originalRestRootSha256:
        originalRestLock.assetRootSha256,
      supplementRootSha256: supplementLock.assetRootSha256,
    },
    results: [{
      anchorId: "example/repo#1",
      canonicalAnchorId: "example/repo#1",
      captureDirectory: "example__repo__1",
      captureOrder: 1,
      qualificationSource: "full-rest-v1",
      source: {
        path: "go/example__repo_dataset.jsonl",
        rowIndex: 0,
        rowSha256: "a".repeat(64),
      },
      status: "exact-structural-candidate",
    }],
    schemaVersion: 2,
  });
  await writeFile(baseQualificationPath, qualificationBytes);
  const actorPlan = deriveC6ReviewerActorIdentityPlan({
    authors: ["human-one", "human-two"],
    graphqlRootSha256: graphqlLock.assetRootSha256,
    qualificationBytes: qualificationBytes.byteLength,
    qualificationPath: baseQualificationPath,
    qualificationSha256: sha256(qualificationBytes),
    sourceTargetCount: 1,
  });
  const actorPlanBytes = Buffer.from(
    serializeC6ReviewerActorIdentityPlan(actorPlan),
  );
  await writeFile(actorPlanPath, actorPlanBytes);
  const actorCalls = new Map<string, number>();
  await captureC6ReviewerActorIdentities({
    authorizationToken: "test-token",
    expectedPlanSha256: sha256(actorPlanBytes),
    fetchImpl: async (request) => {
      const login = String(request).split("/").at(-1)!;
      const calls = (actorCalls.get(login) ?? 0) + 1;
      actorCalls.set(login, calls);
      if (
        options?.retryFirstActor &&
        login === "human-one" &&
        calls === 1
      ) {
        return githubResponse(
          String(request),
          { message: "busy" },
          503,
        );
      }
      return githubResponse(String(request), {
        login,
        type: "User",
      });
    },
    outputRoot: actorRoot,
    planPath: actorPlanPath,
    progress: () => {},
    sleep: async () => {},
  });
  const actorLock = await buildC6AssetLock(actorRoot);
  const firstActorRoot = join(
    actorRoot,
    actorPlan.targets[0]!.captureDirectory,
  );
  const finalAttempt = options?.retryFirstActor
    ? "attempt-02"
    : "attempt-01";
  return {
    actorFinalResponsePath: join(
      firstActorRoot,
      finalAttempt,
      "response.json",
    ),
    actorFirstAttemptRoot: join(firstActorRoot, "attempt-01"),
    actorFirstResponseHeadersPath: join(
      firstActorRoot,
      "attempt-01",
      "response-headers.json",
    ),
    actorManifestPath: join(firstActorRoot, "manifest.json"),
    actorResponsePath: join(
      firstActorRoot,
      finalAttempt,
      "response.json",
    ),
    actorRoot,
    actorPlanBytes,
    actorPlanPath,
    input: {
      actorPlanPath,
      actorRoot,
      baseQualificationPath,
      expectedActorPlanSha256: sha256(actorPlanBytes),
      expectedActorRootSha256: actorLock.assetRootSha256,
      expectedBaseQualificationSha256:
        sha256(qualificationBytes),
      expectedGraphqlRootSha256:
        graphqlLock.assetRootSha256,
      expectedOriginalRestRootSha256:
        originalRestLock.assetRootSha256,
      expectedSupplementRootSha256:
        supplementLock.assetRootSha256,
      graphqlRoot,
      originalRestRoot,
      supplementRoot,
    },
  };
}

async function withCurrentActorRoot(
  fixture: BuiltFixture,
): Promise<BuiltFixture["input"]> {
  const actorLock = await buildC6AssetLock(fixture.actorRoot);
  return {
    ...fixture.input,
    expectedActorRootSha256: actorLock.assetRootSha256,
  };
}

function graphqlResponse(): Record<string, unknown> {
  return {
    data: {
      repository: {
        nameWithOwner: "example/repo",
        pullRequest: {
          commits: {
            nodes: [
              graphqlCommit("a", "2026-01-01T00:00:00Z", []),
              graphqlCommit("b", "2026-01-01T02:00:00Z", ["a"]),
              graphqlCommit("c", "2026-01-01T04:00:00Z", ["b"]),
            ],
            pageInfo: { hasNextPage: false },
          },
          number: 1,
          reviews: {
            nodes: [
              graphqlReview(
                "human-one",
                "a",
                "2026-01-01T01:00:00Z",
                "one",
              ),
              graphqlReview(
                "human-two",
                "b",
                "2026-01-01T03:00:00Z",
                "two",
              ),
            ],
            pageInfo: { hasNextPage: false },
          },
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    },
  };
}

function graphqlCommit(
  label: string,
  committedDate: string,
  parents: string[],
): Record<string, unknown> {
  return {
    commit: {
      committedDate,
      oid: oid(label),
      parents: {
        nodes: parents.map((parent) => ({ oid: oid(parent) })),
        pageInfo: { hasNextPage: false },
      },
    },
  };
}

function graphqlReview(
  login: string,
  commitLabel: string,
  submittedAt: string,
  marker: string,
): Record<string, unknown> {
  return {
    author: { login },
    body: `Behavioral correction ${marker}`,
    commit: { oid: oid(commitLabel) },
    id: `review-${marker}`,
    state: "CHANGES_REQUESTED",
    submittedAt,
  };
}

function oid(label: string): string {
  return label.repeat(40).slice(0, 40);
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function githubResponse(
  url: string,
  body: unknown,
  status = 200,
): Response {
  const response = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: "Sun, 26 Jul 2026 12:00:00 GMT",
      "x-github-request-id": "request-id",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": "1785070800",
      "x-ratelimit-resource": "core",
      "x-ratelimit-used": "1",
    },
    status,
  });
  Object.defineProperties(response, {
    redirected: { value: false },
    url: { value: url },
  });
  return response;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
