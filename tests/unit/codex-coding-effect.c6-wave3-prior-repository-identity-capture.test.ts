import {
  copyFile,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  captureC6Wave3PriorRepositoryIdentity,
} from "../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-capture";
import {
  buildC6Wave3PriorRepositoryIdentityPlan,
  serializeC6Wave3PriorRepositoryIdentityPlan,
} from "../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan";

const SOURCE_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const SOURCE_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-source-universe-v2.json";
const PLAN_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-prior-repository-identity-plan-v1.json";
const SOURCE_PATH = join(SOURCE_ROOT, SOURCE_BASENAME);
const TOKEN = "github_pat_C6_PRIOR_SENTINEL_947301";
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("Codex coding-effect C6 Wave3 prior identity capture", () => {
  it("fails the formal source-v2 entry before any transport request", async () => {
    const root = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave3-prior-runner-",
    );
    temporaryRoots.push(root);
    const sourceUniversePath = join(root, SOURCE_BASENAME);
    await copyFile(SOURCE_PATH, sourceUniversePath);
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath,
      });
    const planPath = join(root, PLAN_BASENAME);
    await writeFile(
      planPath,
      serializeC6Wave3PriorRepositoryIdentityPlan(plan),
      "utf8",
    );
    let requestCount = 0;

    await expect(
      captureC6Wave3PriorRepositoryIdentity({
        authorizationToken: TOKEN,
        planPath,
        sourceUniversePath,
        temporaryParent: root,
        transport: async () => {
          requestCount += 1;
          throw new Error("transport must remain unreachable");
        },
      }),
    ).rejects.toThrow(
      /authorization.*external promotion verifier/u,
    );
    expect(requestCount).toBe(0);
  });

  it("redacts the exact token from pre-authorization failures", async () => {
    const root = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave3-prior-redaction-",
    );
    temporaryRoots.push(root);
    let requestCount = 0;
    const error = await captureC6Wave3PriorRepositoryIdentity({
      authorizationToken: TOKEN,
      planPath: join(root, TOKEN, "missing-plan.json"),
      sourceUniversePath: join(root, SOURCE_BASENAME),
      temporaryParent: root,
      transport: async () => {
        requestCount += 1;
        throw new Error("transport must remain unreachable");
      },
    }).then(
      () => new Error("capture unexpectedly succeeded"),
      (reason: unknown) => reason,
    );

    expect(String(error)).toContain("[REDACTED]");
    expect(String(error)).not.toContain(TOKEN);
    expect(requestCount).toBe(0);
  });
});
