import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
} from "node:path";
import { promisify } from "node:util";

import {
  describe,
  expect,
  it,
} from "bun:test";

import {
  C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
  C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
  verifyC6SourceV4BoundedActivationLineage,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-activation";
import {
  buildC6SourceV4BoundedReviewBundle,
  C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
  C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
  C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
  C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
  C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-review";
import {
  parseC6SourceV4BoundedReviewPreparationCliOptions,
} from "../../scripts/prepare-codex-coding-effect-c6-source-v4-bounded-review";
import {
  parseC6SourceV4BoundedReviewProvenanceCliOptions,
  recordC6SourceV4BoundedReviewProvenance,
} from "../../scripts/record-codex-coding-effect-c6-source-v4-bounded-review-provenance";
import {
  withC6GateTemporaryRoot,
} from "../support/c6-gate-lifecycle";

const execFileAsync = promisify(execFile);
const AUTHOR = "/root";
const REVIEWER =
  "/root/c6_source_v4_bounded_review_v2";
const SNAPSHOT_ROOT = "/tmp/c6-v4-snapshot";
const REVIEWED_AT =
  "2026-07-31T03:00:00.000Z";

describe("C6 source-v4 bounded review workflow", () => {
  it("parses only exact create-only preparation and recorder options", () => {
    const options = [
      `--author-task-name=${AUTHOR}`,
      "--output-root=/tmp/c6-v4-review",
      `--reviewer-agent-name=${REVIEWER}`,
      `--snapshot-root=${SNAPSHOT_ROOT}`,
    ];
    expect(
      parseC6SourceV4BoundedReviewPreparationCliOptions(
        options,
      ),
    ).toEqual({
      authorTaskName: AUTHOR,
      outputRoot: "/tmp/c6-v4-review",
      reviewerAgentName: REVIEWER,
      snapshotRoot: SNAPSHOT_ROOT,
    });
    expect(
      parseC6SourceV4BoundedReviewProvenanceCliOptions(
        options.slice(0, 3),
      ),
    ).toEqual({
      authorTaskName: AUTHOR,
      outputRoot: "/tmp/c6-v4-review",
      reviewerAgentName: REVIEWER,
    });
    expect(() =>
      parseC6SourceV4BoundedReviewPreparationCliOptions([
        ...options,
        "--replace",
      ])
    ).toThrow("unknown");
  });

  it("records a rejected review as a five-file negative receipt and blocks activation", async () => {
    await withC6GateTemporaryRoot(
      "goodmemory-c6-rejected-review-",
      async (parent) => {
        const repositoryRoot =
          join(parent, "repository");
        await execFileAsync("/usr/bin/git", [
          "clone",
          "--quiet",
          "--local",
          "--no-hardlinks",
          process.cwd(),
          repositoryRoot,
        ]);
        await git(repositoryRoot, [
          "config",
          "user.email",
          "c6-review@example.invalid",
        ]);
        await git(repositoryRoot, [
          "config",
          "user.name",
          "C6 rejected review test",
        ]);
        for (
          const path of
            C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS
        ) {
          const target =
            join(repositoryRoot, path);
          await mkdir(dirname(target), {
            recursive: true,
          });
          await cp(
            join(process.cwd(), path),
            target,
          );
        }
        const freezeCommitSha = await commit(
          repositoryRoot,
          "repaired freeze",
          true,
        );
        const freezeTreeSha = await gitText(
          repositoryRoot,
          ["show", "-s", "--format=%T", "HEAD"],
        );
        const reviewedSources =
          await Promise.all(
            C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS
              .map(async (path) => ({
                bytes: await readFile(
                  join(repositoryRoot, path),
                ),
                path,
              })),
          );
        const bundle =
          buildC6SourceV4BoundedReviewBundle({
            authorTaskName: AUTHOR,
            freezeCandidate: {
              commitSha: freezeCommitSha,
              treeSha: freezeTreeSha,
            },
            reviewedSources,
            reviewerAgentName: REVIEWER,
            snapshot:
              C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
          });
        await Promise.all([
          writePath(
            repositoryRoot,
            C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
              .dispatch,
            bundle.dispatchBytes,
          ),
          writePath(
            repositoryRoot,
            C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
              .input,
            bundle.inputBytes,
          ),
          writePath(
            repositoryRoot,
            C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
              .request,
            bundle.requestBytes,
          ),
          writePath(
            repositoryRoot,
            C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
              .response,
            rejectedResponse(bundle),
          ),
        ]);
        const recorded =
          await recordC6SourceV4BoundedReviewProvenance({
            authorTaskName: AUTHOR,
            outputRoot: repositoryRoot,
            repositoryRoot,
            reviewerAgentName: REVIEWER,
          });
        expect(recorded).toMatchObject({
          blockingFindings: [
            "[P1] integrated activation gate timed out",
          ],
          decision: "rejected",
          independentReviewAccepted: false,
          liveCaptureAuthorized: false,
          reviewReceiptStructureVerified: true,
          sourceSelectionFrozen: false,
        });
        const reviewCommitSha = await commit(
          repositoryRoot,
          "record rejected review",
        );
        await writePath(
          repositoryRoot,
          C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
          C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
        );
        const activationCommitSha = await commit(
          repositoryRoot,
          "attempt activation",
        );
        await expect(
          verifyC6SourceV4BoundedActivationLineage({
            activationCommitSha,
            authorTaskName: AUTHOR,
            freezeCommitSha,
            repositoryRoot,
            reviewCommitSha,
            reviewerAgentName: REVIEWER,
          }),
        ).rejects.toThrow(
          "review rejected the freeze",
        );
        await expect(
          readFile(join(
            repositoryRoot,
            C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
          )),
        ).rejects.toMatchObject({
          code: "ENOENT",
        });
      },
    );
  }, 30_000);
});

async function writePath(
  root: string,
  path: string,
  bytes: string | Uint8Array,
): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), {
    recursive: true,
  });
  await writeFile(target, bytes, {
    flag: "wx",
  });
}

function rejectedResponse(
  bundle: {
    dispatchBytes: string;
    inputBytes: string;
    requestBytes: string;
  },
): string {
  return canonicalJson({
    acceptedChecks:
      C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS.slice(
        0,
        6,
      ),
    artifactKind:
      "c6-source-v4-bounded-review-response",
    blockingFindings: [
      "[P1] integrated activation gate timed out",
    ],
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      liveCaptureAuthorized: false,
      sourceSelectionFrozen: false,
      status:
        "review-rejected-new-freeze-required",
    },
    decision: "rejected",
    dispatchSha256: sha256(bundle.dispatchBytes),
    inputSha256: sha256(bundle.inputBytes),
    requestSha256: sha256(bundle.requestBytes),
    reviewedAt: REVIEWED_AT,
    reviewerAgentName: REVIEWER,
    schemaVersion: 2,
  });
}

async function commit(
  root: string,
  message: string,
  allowEmpty = false,
): Promise<string> {
  await git(root, ["add", "."]);
  await git(root, [
    "commit",
    "--quiet",
    ...(allowEmpty ? ["--allow-empty"] : []),
    "-m",
    message,
  ]);
  return await gitText(
    root,
    ["rev-parse", "HEAD"],
  );
}

async function git(
  root: string,
  args: readonly string[],
): Promise<void> {
  await execFileAsync(
    "/usr/bin/git",
    ["-C", root, ...args],
  );
}

async function gitText(
  root: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync(
    "/usr/bin/git",
    ["-C", root, ...args],
  );
  return stdout.trim();
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
