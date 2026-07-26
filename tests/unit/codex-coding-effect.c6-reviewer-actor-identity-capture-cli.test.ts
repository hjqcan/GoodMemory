import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseC6ReviewerActorIdentityCaptureCliOptions,
  runC6ReviewerActorIdentityCaptureCommand,
} from "../../scripts/capture-codex-coding-effect-c6-reviewer-actor-identities";
import {
  deriveC6LiveMultiLangNeighborActorPlanV2,
  serializeC6LiveMultiLangNeighborActorPlanV2,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan-v2";
import {
  parseC6LiveMultiLangNeighborStructuralUnion,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union";
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

describe("C6 reviewer actor identity capture CLI", () => {
  it("parses a strict bounded option surface", () => {
    const sha = "a".repeat(64);
    expect(parseC6ReviewerActorIdentityCaptureCliOptions([
      `--expected-plan-sha256=${sha}`,
      "--output-root=/tmp/actors",
      "--plan=/tmp/plan.json",
      "--token-env=GITHUB_TOKEN",
    ])).toEqual({
      expectedPlanSha256: sha,
      outputRoot: "/tmp/actors",
      plan: "/tmp/plan.json",
      requestTimeoutMilliseconds: 60_000,
      tokenEnv: "GITHUB_TOKEN",
    });
    expect(() =>
      parseC6ReviewerActorIdentityCaptureCliOptions([
        `--expected-plan-sha256=${sha}`,
        "--output-root=/tmp/actors",
        "--plan=/tmp/plan.json",
        "--request-timeout-ms=300001",
        "--token-env=GITHUB_TOKEN",
      ])
    ).toThrow("at most 300000");
    expect(() =>
      parseC6ReviewerActorIdentityCaptureCliOptions([
        "--unknown=value",
      ])
    ).toThrow("unknown");
  });

  it("runs the capture without exposing the token in artifacts", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-actor-cli-")),
    );
    cleanup.push(root);
    const planPath = join(root, "plan.json");
    const outputRoot = join(root, "capture");
    const plan = deriveC6ReviewerActorIdentityPlan({
      authors: ["human-reviewer"],
      graphqlRootSha256: "a".repeat(64),
      qualificationBytes: 10,
      qualificationPath: "qualification.json",
      qualificationSha256: "b".repeat(64),
      sourceTargetCount: 1,
    });
    const planBytes = Buffer.from(
      serializeC6ReviewerActorIdentityPlan(plan),
    );
    await writeFile(planPath, planBytes);

    const result = await runC6ReviewerActorIdentityCaptureCommand([
      `--expected-plan-sha256=${sha256(planBytes)}`,
      `--output-root=${outputRoot}`,
      `--plan=${planPath}`,
      "--request-timeout-ms=1000",
      "--token-env=GITHUB_TOKEN",
    ], {
      env: { GITHUB_TOKEN: "secret-token" },
      fetchImpl: async (input) =>
        githubResponse(String(input), {
          login: "human-reviewer",
          type: "User",
        }),
      progress: () => {},
      sleep: async () => {},
    });

    expect(result).toMatchObject({
      capturedTargetCount: 1,
      networkAttemptCount: 1,
    });
    const request = await readFile(join(
      outputRoot,
      plan.targets[0]!.captureDirectory,
      "attempt-01",
      "request.json",
    ), "utf8");
    expect(request).not.toContain("secret-token");
    expect(sha256(await readFile(
      join(outputRoot, "capture.json"),
    ))).toBe(
      "a4b540cf4f55860c80be75b667c8a35ce3fcf1acdb1fc5e2fff51b65b8dc842d",
    );
  });

  it("dispatches a policy-neutral v2 plan without leaking a transport token", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-actor-cli-v2-")),
    );
    cleanup.push(root);
    const unionPath = join(
      import.meta.dir,
      "../../fixtures/codex-coding-effect/c6-source-pool/" +
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-structural-union-v1.json",
    );
    const union = parseC6LiveMultiLangNeighborStructuralUnion(
      await readFile(unionPath),
    );
    const planBytes = Buffer.from(
      serializeC6LiveMultiLangNeighborActorPlanV2(
        deriveC6LiveMultiLangNeighborActorPlanV2(union),
      ),
    );
    const planPath = join(root, "actor-plan-v2.json");
    await writeFile(planPath, planBytes);
    let requestCount = 0;
    let thrown: unknown;

    try {
      await runC6ReviewerActorIdentityCaptureCommand([
        `--expected-plan-sha256=${sha256(planBytes)}`,
        `--output-root=${join(root, "capture")}`,
        `--plan=${planPath}`,
        "--request-timeout-ms=1000",
        "--token-env=GITHUB_TOKEN",
      ], {
        env: { GITHUB_TOKEN: "secret-token" },
        fetchImpl: async () => {
          requestCount += 1;
          throw new Error("transport secret-token");
        },
        progress: () => {},
        sleep: async () => {},
      });
    } catch (error) {
      thrown = error;
    }

    expect(requestCount).toBe(1);
    expect(String(thrown)).toContain("[REDACTED]");
    expect(String(thrown)).not.toContain("secret-token");
  });
});

function githubResponse(url: string, body: unknown): Response {
  const response = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      date: "Sun, 26 Jul 2026 12:00:00 GMT",
      "x-github-request-id": "request-id",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": "1785070800",
      "x-ratelimit-resource": "core",
      "x-ratelimit-used": "1",
    },
    status: 200,
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
