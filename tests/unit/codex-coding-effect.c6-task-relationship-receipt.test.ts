import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  assertC6TaskRelationshipEdgeCoverage,
  listC6TaskRelationshipArtifactReferences,
  validateC6TaskRelationshipReceipt,
} from "../../scripts/codex-coding-effect/c6-task-relationship-receipt";

const REPOSITORY_URL = "https://github.com/example/project.git";

describe("Codex coding-effect C6 task relationship receipt", () => {
  it("proves chronology and a multi-hop Git ancestry path from raw bytes", () => {
    const fixture = relationshipFixture();
    const evidence = validateC6TaskRelationshipReceipt(fixture.input);

    expect(evidence).toMatchObject({
      edgeId: "episode-001/stage-1->stage-2",
      episodeId: "episode-001",
      laterBaseCommit: fixture.commits.later.oid,
      laterRequestAt: "2026-02-01T00:00:00.000Z",
      priorCompletionAt: "2026-01-15T00:00:00.000Z",
      priorMergeCommit: fixture.commits.prior.oid,
      priorStageId: "stage-1",
      laterStageId: "stage-2",
    });
    expect(evidence.commitPathSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      listC6TaskRelationshipArtifactReferences(
        fixture.input.receiptBytes,
      ).map((reference) => reference.path),
    ).toEqual([
      fixture.receipt.priorRequest.path,
      fixture.receipt.priorCompletion.path,
      fixture.receipt.laterRequest.path,
      ...fixture.receipt.commitPath.map((reference) => reference.path),
    ]);
    expect(() => assertC6TaskRelationshipEdgeCoverage({
      edges: [evidence],
      episodeId: "episode-001",
      stageIds: ["stage-1", "stage-2"],
    })).not.toThrow();
  });

  it("rejects equal chronology, forged commit bytes, and a sibling path", () => {
    const equalTime = relationshipFixture({
      laterCreatedAt: "2026-01-15T00:00:00.000Z",
    });
    expect(() =>
      validateC6TaskRelationshipReceipt(equalTime.input)
    ).toThrow("prior completion must precede later request");

    const forged = relationshipFixture();
    const forgedArtifacts = new Map(forged.input.artifactsByPath);
    const firstPath = forged.receipt.commitPath[0]!.path;
    const forgedBytes = Buffer.from(
      forgedArtifacts.get(firstPath)!,
    );
    forgedBytes[forgedBytes.length - 1] ^= 1;
    forgedArtifacts.set(firstPath, forgedBytes);
    const forgedReceipt = {
      ...forged.receipt,
      commitPath: forged.receipt.commitPath.map((reference, index) =>
        index === 0
          ? artifactReference(firstPath, forgedBytes, reference.oid)
          : reference
      ),
    };
    expect(() => validateC6TaskRelationshipReceipt({
      ...forged.input,
      artifactsByPath: forgedArtifacts,
      receiptBytes: canonical(forgedReceipt),
    })).toThrow("Git commit object OID does not match raw bytes");

    const sibling = relationshipFixture({ siblingPath: true });
    expect(() =>
      validateC6TaskRelationshipReceipt(sibling.input)
    ).toThrow("Git commit path is not an ancestry chain");
  });

  it("rejects a valid but detached later request and incomplete edge sets", () => {
    const fixture = relationshipFixture();
    const detachedPath =
      "provenance/task-origin/upstream-receipts/detached.json";
    const detachedBytes = githubIssueReceipt({
      createdAt: "2026-02-01T00:00:00.000Z",
      issueNumber: 999,
    });
    const artifacts = new Map(fixture.input.artifactsByPath);
    artifacts.set(detachedPath, detachedBytes);
    const detachedReceipt = {
      ...fixture.receipt,
      laterRequest: {
        ...artifactReference(detachedPath, detachedBytes),
        format: "github-issue-api-json-v2",
      },
    };
    expect(() => validateC6TaskRelationshipReceipt({
      ...fixture.input,
      artifactsByPath: artifacts,
      receiptBytes: canonical(detachedReceipt),
    })).toThrow("later request does not match the later stage origin");

    const evidence = validateC6TaskRelationshipReceipt(fixture.input);
    expect(() => assertC6TaskRelationshipEdgeCoverage({
      edges: [],
      episodeId: "episode-001",
      stageIds: ["stage-1", "stage-2"],
    })).toThrow("relationship edges do not cover adjacent stages");
    expect(() => assertC6TaskRelationshipEdgeCoverage({
      edges: [evidence, evidence],
      episodeId: "episode-001",
      stageIds: ["stage-1", "stage-2"],
    })).toThrow("relationship edges do not cover adjacent stages");
    expect(() => assertC6TaskRelationshipEdgeCoverage({
      edges: [{
        ...evidence,
        laterStageId: "stage-1",
        priorStageId: "stage-2",
      }],
      episodeId: "episode-001",
      stageIds: ["stage-1", "stage-2"],
    })).toThrow("relationship edges do not cover adjacent stages");
  });

  it("rejects references outside provenance and mixed Git object formats", () => {
    const misplaced = relationshipFixture();
    const misplacedPath =
      "provenance/task-origin/upstream-receipts/../../escape.json";
    const originalPath = misplaced.receipt.priorCompletion.path;
    const artifacts = new Map(misplaced.input.artifactsByPath);
    const completionBytes = artifacts.get(originalPath)!;
    artifacts.delete(originalPath);
    artifacts.set(misplacedPath, completionBytes);
    const misplacedReceipt = {
      ...misplaced.receipt,
      priorCompletion: {
        ...misplaced.receipt.priorCompletion,
        path: misplacedPath,
      },
    };
    expect(() => validateC6TaskRelationshipReceipt({
      ...misplaced.input,
      artifactsByPath: artifacts,
      receiptBytes: canonical(misplacedReceipt),
    })).toThrow("upstream receipt path is invalid");
    expect(() =>
      listC6TaskRelationshipArtifactReferences(canonical(misplacedReceipt))
    ).toThrow("upstream receipt path is invalid");

    const mixed = relationshipFixture({ mixedObjectFormats: true });
    expect(() =>
      validateC6TaskRelationshipReceipt(mixed.input)
    ).toThrow("Git commit path mixes object formats");

    const edited = relationshipFixture({
      laterUpdatedAt: "2026-02-02T00:00:00.000Z",
    });
    expect(() =>
      validateC6TaskRelationshipReceipt(edited.input)
    ).toThrow("request was modified after creation");

    for (const invalid of [
      relationshipFixture({ laterLocatorKind: "pull" }),
      relationshipFixture({ completionLocatorKind: "issues" }),
      relationshipFixture({ githubPort: 444 }),
      relationshipFixture({ sameIssueIdentity: true }),
    ]) {
      expect(() =>
        validateC6TaskRelationshipReceipt(invalid.input)
      ).toThrow(/GitHub locator is invalid|requests must be distinct/u);
    }

    for (const stageIds of [
      [],
      ["stage-1"],
      ["stage-1", "stage-1"],
    ]) {
      expect(() => assertC6TaskRelationshipEdgeCoverage({
        edges: [],
        episodeId: "episode-001",
        stageIds,
      })).toThrow("requires ordered unique stage IDs");
    }
  });
});

function relationshipFixture(input: {
  completionLocatorKind?: "issues" | "pull";
  githubPort?: number;
  laterCreatedAt?: string;
  laterLocatorKind?: "issues" | "pull";
  laterUpdatedAt?: string;
  mixedObjectFormats?: boolean;
  sameIssueIdentity?: boolean;
  siblingPath?: boolean;
} = {}) {
  const prior = gitCommit("prior\n");
  const middle = gitCommit(
    "middle\n",
    [prior.oid],
    input.mixedObjectFormats ? "sha256" : "sha1",
  );
  const later = gitCommit("later\n", [middle.oid]);
  const sibling = gitCommit("sibling\n", [prior.oid]);
  const commits = { later, middle, prior, sibling };
  const priorRequestPath =
    "provenance/task-origin/upstream-receipts/prior-issue.json";
  const priorCompletionPath =
    "provenance/task-origin/upstream-receipts/prior-pull.json";
  const laterRequestPath =
    "provenance/task-origin/upstream-receipts/later-issue.json";
  const priorRequest = githubIssueReceipt({
    createdAt: "2026-01-01T00:00:00.000Z",
    githubPort: input.githubPort,
    issueNumber: 1,
  });
  const priorCompletion = githubPullReceipt({
    githubPort: input.githubPort,
    locatorKind: input.completionLocatorKind,
    mergeCommitSha: prior.oid,
    mergedAt: "2026-01-15T00:00:00.000Z",
    pullNumber: 10,
  });
  const laterRequest = githubIssueReceipt({
    createdAt:
      input.laterCreatedAt ?? "2026-02-01T00:00:00.000Z",
    githubPort: input.githubPort,
    issueNumber: input.sameIssueIdentity ? 1 : 2,
    locatorKind: input.laterLocatorKind,
    updatedAt: input.laterUpdatedAt,
  });
  const pathCommits = input.siblingPath
    ? [later, sibling, prior]
    : [later, middle, prior];
  const commitPath = pathCommits.map((commit) =>
    artifactReference(
      `provenance/task-origin/repository-objects/${commit.oid}.commit`,
      commit.bytes,
      commit.oid,
    )
  );
  const receipt = {
    commitPath,
    edgeId: "episode-001/stage-1->stage-2",
    episodeId: "episode-001",
    laterRequest: {
      ...artifactReference(laterRequestPath, laterRequest),
      format: "github-issue-api-json-v2",
    },
    laterStageId: "stage-2",
    priorCompletion: {
      ...artifactReference(priorCompletionPath, priorCompletion),
      format: "github-pull-request-api-json-v1",
    },
    priorRequest: {
      ...artifactReference(priorRequestPath, priorRequest),
      format: "github-issue-api-json-v2",
    },
    priorStageId: "stage-1",
    schemaVersion: 1,
  } as const;
  const artifactsByPath = new Map<string, Uint8Array>([
    [priorRequestPath, priorRequest],
    [priorCompletionPath, priorCompletion],
    [laterRequestPath, laterRequest],
    ...commitPath.map((reference, index) => [
      reference.path,
      pathCommits[index]!.bytes,
    ] as const),
  ]);
  return {
    commits,
    input: {
      artifactsByPath,
      episodeId: "episode-001",
      laterBaseCommit: later.oid,
      laterStageId: "stage-2",
      laterStageOrigin: artifactReference(
        laterRequestPath,
        laterRequest,
      ),
      priorStageId: "stage-1",
      priorStageOrigin: artifactReference(
        priorRequestPath,
        priorRequest,
      ),
      receiptBytes: canonical(receipt),
      repositoryUrl: REPOSITORY_URL,
    },
    receipt,
  };
}

function githubIssueReceipt(input: {
  createdAt: string;
  githubPort?: number;
  issueNumber: number;
  locatorKind?: "issues" | "pull";
  updatedAt?: string;
}): Buffer {
  return Buffer.from(canonical({
    body: `Issue ${input.issueNumber}`,
    created_at: input.createdAt,
    html_url:
      `https://github.com${input.githubPort === undefined ? "" : `:${input.githubPort}`}/example/project/${input.locatorKind ?? "issues"}/${input.issueNumber}`,
    node_id: `issue-${input.issueNumber}`,
    number: input.issueNumber,
    repository_url:
      `https://api.github.com${input.githubPort === undefined ? "" : `:${input.githubPort}`}/repos/example/project`,
    updated_at: input.updatedAt ?? input.createdAt,
  }));
}

function githubPullReceipt(input: {
  githubPort?: number;
  locatorKind?: "issues" | "pull";
  mergeCommitSha: string;
  mergedAt: string;
  pullNumber: number;
}): Buffer {
  return Buffer.from(canonical({
    html_url:
      `https://github.com${input.githubPort === undefined ? "" : `:${input.githubPort}`}/example/project/${input.locatorKind ?? "pull"}/${input.pullNumber}`,
    merge_commit_sha: input.mergeCommitSha,
    merged: true,
    merged_at: input.mergedAt,
    node_id: `pull-${input.pullNumber}`,
    number: input.pullNumber,
    repository_url:
      `https://api.github.com${input.githubPort === undefined ? "" : `:${input.githubPort}`}/repos/example/project`,
  }));
}

function gitCommit(
  message: string,
  parents: string[] = [],
  algorithm: "sha1" | "sha256" = "sha1",
) {
  const bytes = Buffer.from([
    `tree ${"a".repeat(40)}`,
    ...parents.map((parent) => `parent ${parent}`),
    "author Test <test@example.com> 0 +0000",
    "committer Test <test@example.com> 0 +0000",
    "",
    message,
  ].join("\n"));
  return {
    bytes,
    oid: createHash(algorithm)
      .update(`commit ${bytes.byteLength}\0`)
      .update(bytes)
      .digest("hex"),
  };
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
  oid?: string,
) {
  return {
    bytes: bytes.byteLength,
    ...(oid === undefined ? {} : { oid }),
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
