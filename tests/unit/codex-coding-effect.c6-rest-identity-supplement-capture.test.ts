import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  captureC6RestIdentitySupplement,
} from "../../scripts/codex-coding-effect/c6-rest-identity-supplement-capture";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("Codex coding-effect C6 REST identity supplement capture", () => {
  it("captures every frozen pull identity in order without storing the token", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-rest-identity-")),
    );
    cleanup.push(root);
    const planPath = join(root, "plan.json");
    const outputRoot = join(root, "capture");
    const planBytes = bytes(plan());
    await writeFile(planPath, planBytes);
    const calls: string[] = [];

    const result = await captureC6RestIdentitySupplement({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer secret-token",
        );
        const pullNumber = Number(url.split("/").at(-1));
        return new Response(JSON.stringify(pull(pullNumber)), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
      outputRoot,
      planPath,
    });

    expect(calls).toEqual([
      "https://api.github.com/repos/canonical/one/pulls/10",
      "https://api.github.com/repos/requested/two/pulls/30",
    ]);
    expect(result).toMatchObject({
      capturedTargetCount: 2,
      captureAttemptCompletenessProven: true,
    });
    const capture = JSON.parse(
      await readFile(join(outputRoot, "capture.json"), "utf8"),
    ) as {
      boundary: { captureAttemptCompletenessProven: boolean };
      captures: Array<{ pullAuthor: string }>;
    };
    expect(capture.boundary.captureAttemptCompletenessProven).toBe(true);
    expect(capture.captures.map((entry) => entry.pullAuthor)).toEqual([
      "author-10",
      "author-30",
    ]);
    expect(
      await readFile(
        join(outputRoot, "requested__one__10", "request.json"),
        "utf8",
      ),
    ).not.toContain("secret-token");
  });

  it("fails before publishing the final root on status or identity drift", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-rest-identity-")),
    );
    cleanup.push(root);
    const planPath = join(root, "plan.json");
    const outputRoot = join(root, "capture");
    const planBytes = bytes(plan());
    await writeFile(planPath, planBytes);

    await expect(captureC6RestIdentitySupplement({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
      outputRoot,
      planPath,
    })).rejects.toThrow("unexpected HTTP status 503");
    await expect(readFile(join(outputRoot, "capture.json")))
      .rejects.toThrow();

    await expect(captureC6RestIdentitySupplement({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async (_input) =>
        new Response(JSON.stringify({
          ...pull(10),
          number: 99,
        }), { status: 200 }),
      outputRoot,
      planPath,
    })).rejects.toThrow("pull identity mismatch");
  });

  it("rejects token reflection and an existing output before any request", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-rest-identity-")),
    );
    cleanup.push(root);
    const planPath = join(root, "plan.json");
    const reflectedOutput = join(root, "reflected");
    const existingOutput = join(root, "existing");
    const planBytes = bytes(plan());
    await writeFile(planPath, planBytes);

    await expect(captureC6RestIdentitySupplement({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async (input) => {
        const pullNumber = Number(String(input).split("/").at(-1));
        return new Response(JSON.stringify({
          ...pull(pullNumber),
          reflectedCredential: "secret-token",
        }), { status: 200 });
      },
      outputRoot: reflectedOutput,
      planPath,
    })).rejects.toThrow("authorization token appeared in pull response");
    await expect(readFile(join(reflectedOutput, "capture.json")))
      .rejects.toThrow();

    await mkdir(existingOutput);
    let requestCount = 0;
    await expect(captureC6RestIdentitySupplement({
      authorizationToken: "secret-token",
      expectedPlanSha256: sha256(planBytes),
      fetchImpl: async () => {
        requestCount += 1;
        return new Response("unreachable", { status: 500 });
      },
      outputRoot: existingOutput,
      planPath,
    })).rejects.toThrow("output root already exists");
    expect(requestCount).toBe(0);
  });
});

function plan() {
  const targets = [
    {
      anchorId: "requested/one#10",
      canonicalAnchorId: "canonical/one#10",
      canonicalOwner: "canonical",
      canonicalRepository: "one",
      captureDirectory: "requested__one__10",
      originalCaptureOrder: 1,
      pullNumber: 10,
      supplementOrder: 1,
    },
    {
      anchorId: "requested/two#30",
      canonicalAnchorId: "requested/two#30",
      canonicalOwner: "requested",
      canonicalRepository: "two",
      captureDirectory: "requested__two__30",
      originalCaptureOrder: 3,
      pullNumber: 30,
      supplementOrder: 2,
    },
  ];
  return {
    artifactKind: "c6-rest-identity-supplement-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
    },
    counts: {
      supplementTargetCount: targets.length,
    },
    independenceBoundary: {
      supplementTargetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    schemaVersion: 1,
    targets,
  };
}

function pull(number: number) {
  const repository = number === 10
    ? "canonical/one"
    : "requested/two";
  return {
    base: { repo: { full_name: repository } },
    head: { sha: String(number).padStart(40, "0") },
    html_url: `https://github.com/${repository}/pull/${number}`,
    number,
    user: { login: `author-${number}` },
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
