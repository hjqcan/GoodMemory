import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  parseC6SourceV3SimpleReviewPreparationCliOptions,
  prepareC6SourceV3SimpleReview,
} from "../../scripts/prepare-codex-coding-effect-c6-source-v3-simple-review";
import {
  C6_SOURCE_V3_SIMPLE_REVIEW_PATHS,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-review";

const AUTHOR = "/root";
const REVIEWER = "/root/c6_source_v3_simple_review_v1";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 source-v3-simple review materializer", () => {
  it("parses only the create-only review request options", () => {
    expect(
      parseC6SourceV3SimpleReviewPreparationCliOptions([
        `--author-task-name=${AUTHOR}`,
        "--output-root=/tmp/c6-source-v3-review",
        `--reviewer-agent-name=${REVIEWER}`,
      ]),
    ).toEqual({
      authorTaskName: AUTHOR,
      outputRoot: "/tmp/c6-source-v3-review",
      reviewerAgentName: REVIEWER,
    });
    expect(() =>
      parseC6SourceV3SimpleReviewPreparationCliOptions([
        `--author-task-name=${AUTHOR}`,
        "--output-root=/tmp/c6-source-v3-review",
        `--reviewer-agent-name=${REVIEWER}`,
        "--replace",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6SourceV3SimpleReviewPreparationCliOptions([
        `--author-task-name=${AUTHOR}`,
        "--output-root=/tmp/c6-source-v3-review",
      ])
    ).toThrow("--reviewer-agent-name is required");
    expect(() =>
      parseC6SourceV3SimpleReviewPreparationCliOptions([
        `--author-task-name=${AUTHOR}`,
        "--author-task-name=/root/duplicate",
        "--output-root=/tmp/c6-source-v3-review",
        `--reviewer-agent-name=${REVIEWER}`,
      ])
    ).toThrow("cannot be specified more than once");
  });

  it("writes only the canonical input, request, and dispatch", async () => {
    const outputRoot = await temporaryRoot();
    const result = await prepareC6SourceV3SimpleReview({
      authorTaskName: AUTHOR,
      outputRoot,
      repositoryRoot: process.cwd(),
      reviewerAgentName: REVIEWER,
    });
    const reviewRoot = join(
      outputRoot,
      "provenance/source-v3-simple/review",
    );
    const entries = await readdir(reviewRoot);
    const [inputBytes, requestBytes, dispatchBytes] =
      await Promise.all([
        readFile(join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input)),
        readFile(join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request)),
        readFile(join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch)),
      ]);

    expect(entries.sort()).toEqual([
      "dispatch.json",
      "input.json",
      "request.json",
    ]);
    expect(result).toEqual({
      dispatchSha256: sha256(dispatchBytes),
      formalCensusPermitted: false,
      inputSha256: sha256(inputBytes),
      outputRoot,
      provenanceMaterialized: false,
      requestSha256: sha256(requestBytes),
      responseMaterialized: false,
      reviewRoot,
      sourceV3SimpleFrozen: false,
    });
    expect(
      JSON.parse(dispatchBytes.toString("utf8")),
    ).toMatchObject({
      authorTaskName: AUTHOR,
      reviewerAgentName: REVIEWER,
      responsePath: C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
    });
  });

  it("refuses replacement and preserves the first exact request", async () => {
    const outputRoot = await temporaryRoot();
    const input = {
      authorTaskName: AUTHOR,
      outputRoot,
      repositoryRoot: process.cwd(),
      reviewerAgentName: REVIEWER,
    };
    await prepareC6SourceV3SimpleReview(input);
    const firstDispatch = await readFile(
      join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch),
    );

    await expect(
      prepareC6SourceV3SimpleReview(input),
    ).rejects.toThrow("already exists");
    expect(
      await readFile(
        join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch),
      ),
    ).toEqual(firstDispatch);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(
      join(tmpdir(), "goodmemory-c6-source-v3-review-"),
    ),
  );
  temporaryRoots.push(root);
  return root;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
