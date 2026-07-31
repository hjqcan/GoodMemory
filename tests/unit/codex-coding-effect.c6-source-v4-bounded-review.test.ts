import { createHash } from "node:crypto";

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
} from "node:path";

import { describe, expect, it } from "bun:test";
import ts from "typescript";

import {
  buildC6SourceV4BoundedReviewBundle,
  C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
  C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
  C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
  C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
  validateC6SourceV4BoundedReview,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-review";
import type {
  C6SourceV4BoundedReviewSourceInput,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-review";
import {
  withC6GateTemporaryRoot,
} from "../support/c6-gate-lifecycle";

const AUTHOR = "/root";
const REVIEWER = "/root/c6_source_v4_bounded_review_v2";
const FREEZE_COMMIT = "a".repeat(40);
const FREEZE_TREE = "b".repeat(40);
const REVIEWED_AT = "2026-07-27T22:00:00.000Z";

describe("C6 source-v4 bounded independent review", () => {
  it("binds the activation protocol tests and explicit mutation gate", () => {
    const reviewedPaths = new Set<string>(
      C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
    );
    expect(
      reviewedPaths,
    ).toContain(
      "tests/quality-gates/phase-73/codex-coding-effect.c6-source-v4-bounded-review-activation.gate.ts",
    );
    expect(
      reviewedPaths,
    ).toContain(
      "tests/unit/codex-coding-effect.c6-source-v4-bounded-activation.test.ts",
    );
    expect(
      reviewedPaths,
    ).toContain(
      "tests/unit/codex-coding-effect.c6-source-v4-bounded-review.test.ts",
    );
    expect(
      reviewedPaths,
    ).toContain(
      "tests/quality-gates/phase-73/codex-coding-effect.c6-source-v3-simple-census-preflight.gate.ts",
    );
    expect(
      reviewedPaths,
    ).toContain(
      "tests/unit/codex-coding-effect.c6-source-v3-simple-frame-fixture.ts",
    );
    expect(
      C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
    ).toContain(
      "clean-shell-worker-and-native-bun-fetch",
    );
    for (
      const check of [
        "resumable-single-writer-crash-recovery",
        "every-durable-write-exact-canonical-cap",
        "disk-derived-failure-prefix-and-tail",
        "failure-tail-semantic-attempt-and-result-replay",
        "two-network-off-independent-replay-receipts",
        "token-preclaim-zeroization-and-recursive-secret-scan",
        "separate-canonical-lock-and-total-byte-caps",
      ] as const
    ) {
      expect(
        C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
      ).toContain(check);
    }
    for (
      const path of [
        "scripts/codex-coding-effect/c6-source-v4-bounded-live-contract.ts",
        "tests/unit/codex-coding-effect.c6-source-v3-simple-census-executor.test.ts",
        "tests/unit/codex-coding-effect.c6-source-v3-simple-census-ledger.test.ts",
        "tests/unit/codex-coding-effect.c6-source-v4-bounded-live-contract.test.ts",
        "tests/unit/codex-coding-effect.c6-source-v4-bounded-contract.test.ts",
        "tests/unit/codex-coding-effect.c6-source-v4-bounded-frame.test.ts",
        "tests/unit/codex-coding-effect.c6-source-v4-bounded-snapshot.test.ts",
        "tests/unit/codex-coding-effect.c6-source-v4-bounded-v3-observation.test.ts",
      ]
    ) {
      expect(
        reviewedPaths,
      ).toContain(path);
    }
  });

  it("binds the complete transitive relative TypeScript import closure", () => {
    const reviewedPaths = new Set<string>(
      C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
    );
    const pending: string[] =
      C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS
        .filter(
          (path) =>
            path.endsWith(".ts"),
        );
    const visited = new Set<string>();
    const missing = new Set<string>();

    while (pending.length > 0) {
      const path = pending.pop()!;
      if (visited.has(path)) {
        continue;
      }
      visited.add(path);
      for (
        const specifier of
          relativeTypeScriptImports(path)
      ) {
        const dependency =
          resolveTypeScriptDependency(
            path,
            specifier,
          );
        if (!reviewedPaths.has(dependency)) {
          missing.add(dependency);
        }
        if (!visited.has(dependency)) {
          pending.push(dependency);
        }
      }
    }

    expect([...missing].sort()).toEqual([]);
  });

  it("discovers relative import type nodes in the reviewed source closure", async () => {
    await withC6GateTemporaryRoot(
      "goodmemory-c6-import-type-node-",
      async (root) => {
        const sourcePath = join(root, "fixture.ts");
        writeFileSync(
          sourcePath,
          'type Imported = import("./dependency").Imported;\n',
        );

        expect(
          relativeTypeScriptImports(
            relative(process.cwd(), sourcePath),
          ),
        ).toEqual(["./dependency"]);
      },
    );
  });

  it("binds the exact checkpoint, snapshot, source closure, and non-live review boundary", () => {
    const input = reviewInput();
    const bundle =
      buildC6SourceV4BoundedReviewBundle(input);
    const responseBytes = acceptedResponse(bundle);
    const provenanceBytes = provenance(
      bundle,
      responseBytes,
    );
    const evidence =
      validateC6SourceV4BoundedReview({
        ...input,
        ...bundle,
        provenanceBytes,
        responseBytes,
      });

    expect(JSON.parse(bundle.inputBytes))
      .toMatchObject({
        freezeCandidate: {
          commitSha: FREEZE_COMMIT,
          treeSha: FREEZE_TREE,
        },
        selectionCheckpoint: {
          commitSha:
            "3b0ba2d13fc53a8a71b034342bf16c78b5e1507a",
          treeSha:
            "4d2c73ba54bd44b21c3fd16b3ae1b1c9869b9865",
        },
        snapshot:
          C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
      });
    expect(evidence).toMatchObject({
      candidateManifestFrozen: false,
      codexRunReady: false,
      cryptographicReviewIndependence: false,
      independentReviewAccepted: true,
      liveCaptureAuthorized: false,
      sourceSelectionFrozen: false,
    });

    const validateResponse = (
      response: Record<string, unknown>,
    ) => {
      const bytes = canonicalJson(response);
      return validateC6SourceV4BoundedReview({
        ...input,
        ...bundle,
        provenanceBytes: provenance(
          bundle,
          bytes,
        ),
        responseBytes: bytes,
      });
    };
    const acceptedWithFinding = JSON.parse(
      acceptedResponse(bundle),
    ) as Record<string, unknown>;
    acceptedWithFinding.blockingFindings = [
      "[P1] cannot be accepted",
    ];
    expect(() =>
      validateResponse(acceptedWithFinding)
    ).toThrow();

    const rejected = JSON.parse(
      rejectedResponse(bundle),
    ) as Record<string, unknown>;
    expect(() =>
      validateResponse({
        ...rejected,
        blockingFindings: [],
      })
    ).toThrow();
    expect(() =>
      validateResponse({
        ...rejected,
        boundary: {
          ...(rejected.boundary as object),
          status:
            "review-accepted-freeze-and-activation-required",
        },
      })
    ).toThrow();
    expect(() =>
      validateResponse({
        ...rejected,
        acceptedChecks: [
          C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[0],
          C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[0],
        ],
      })
    ).toThrow(
      "unique canonical subset",
    );
    expect(() =>
      validateResponse({
        ...rejected,
        acceptedChecks: [
          "unknown-required-check",
        ],
      })
    ).toThrow(
      "unique canonical subset",
    );
    expect(() =>
      validateResponse({
        ...rejected,
        dispatchSha256: "0".repeat(64),
      })
    ).toThrow("bind the exact request");
  });

  it("records an explicit rejected decision without granting freeze or activation authority", () => {
    const input = reviewInput();
    const bundle =
      buildC6SourceV4BoundedReviewBundle(input);
    const responseBytes = rejectedResponse(bundle);
    const evidence =
      validateC6SourceV4BoundedReview({
        ...input,
        ...bundle,
        provenanceBytes: provenance(
          bundle,
          responseBytes,
        ),
        responseBytes,
      });

    expect(evidence).toMatchObject({
      blockingFindings: [
        "[P1] integrated activation gate timed out",
      ],
      candidateManifestFrozen: false,
      codexRunReady: false,
      decision: "rejected",
      independentReviewAccepted: false,
      liveCaptureAuthorized: false,
      reviewReceiptStructureVerified: true,
      sourceSelectionFrozen: false,
    });
  });

  it("binds timeout-safe comprehensive gate cleanup, progress logs, and a thirty-minute budget", () => {
    const gateSource = readFileSync(
      join(
        process.cwd(),
        "tests/quality-gates/phase-73/codex-coding-effect.c6-source-v4-bounded-review-activation.gate.ts",
      ),
      "utf8",
    );
    const activationSource = readFileSync(
      join(
        process.cwd(),
        "scripts/codex-coding-effect/c6-source-v4-bounded-activation.ts",
      ),
      "utf8",
    );

    expect(gateSource).not.toContain(
      "afterEach",
    );
    expect(gateSource).toContain(
      "withC6GateTemporaryRoot",
    );
    expect(gateSource).toContain(
      "}, 1_800_000);",
    );
    expect(gateSource).toContain(
      '"failure-mutations-complete"',
    );
    expect(gateSource).toContain(
      '"claim-mutation-rejected"',
    );
    expect(activationSource).toContain(
      "if (!reviewEvidence.independentReviewAccepted)",
    );
  });

  it("keeps one gate-owned root until its active operation settles after an earlier deadline", async () => {
    let release!: () => void;
    let markRootReady!: () => void;
    const blocked = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );
    const rootReady = new Promise<void>(
      (resolve) => {
        markRootReady = resolve;
      },
    );
    let ownedRoot = "";
    const operation = withC6GateTemporaryRoot(
      "owned-root-",
      async (root) => {
        ownedRoot = root;
        markRootReady();
        await blocked;
      },
    );
    await rootReady;
    const deadline = await Promise.race([
      operation.then(() => "operation" as const),
      new Promise<"deadline">((resolve) => {
        setTimeout(
          () => resolve("deadline"),
          5,
        );
      }),
    ]);

    expect(deadline).toBe("deadline");
    expect(existsSync(ownedRoot)).toBeTrue();
    release();
    await operation;
    expect(existsSync(ownedRoot)).toBeFalse();
  });

  it("rejects another snapshot, incomplete source closure, and a same-task reviewer", () => {
    const wrongSnapshot = reviewInput();
    wrongSnapshot.snapshot = {
      ...wrongSnapshot.snapshot,
      assetRootSha256: "0".repeat(64),
    };
    expect(() =>
      buildC6SourceV4BoundedReviewBundle(
        wrongSnapshot,
      )
    ).toThrow("canonical snapshot identity");

    const missingSource = reviewInput();
    missingSource.reviewedSources =
      missingSource.reviewedSources.slice(1);
    expect(() =>
      buildC6SourceV4BoundedReviewBundle(
        missingSource,
      )
    ).toThrow("reviewed source path set");

    expect(() =>
      buildC6SourceV4BoundedReviewBundle({
        ...reviewInput(),
        reviewerAgentName: AUTHOR,
      })
    ).toThrow("separate from the author");
  });

  it("rejects response authority expansion and provenance substitution", () => {
    const input = reviewInput();
    const bundle =
      buildC6SourceV4BoundedReviewBundle(input);
    const expanded = JSON.parse(
      acceptedResponse(bundle),
    ) as Record<string, unknown>;
    expanded.liveCaptureAuthorized = true;
    const expandedBytes = canonicalJson(expanded);
    expect(() =>
      validateC6SourceV4BoundedReview({
        ...input,
        ...bundle,
        provenanceBytes: provenance(
          bundle,
          expandedBytes,
        ),
        responseBytes: expandedBytes,
      })
    ).toThrow();

    const responseBytes = acceptedResponse(bundle);
    const substituted = JSON.parse(
      provenance(bundle, responseBytes),
    ) as {
      reviewer: { agentName: string };
    };
    substituted.reviewer.agentName =
      "/root/substituted-reviewer";
    expect(() =>
      validateC6SourceV4BoundedReview({
        ...input,
        ...bundle,
        provenanceBytes: canonicalJson(substituted),
        responseBytes,
      })
    ).toThrow("identity fields");
  });
});

function relativeTypeScriptImports(
  path: string,
): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(join(process.cwd(), path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith(".")
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith(".")
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      node.argument.literal.text.startsWith(".")
    ) {
      imports.push(node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind ===
        ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      node.arguments[0]!.text.startsWith(".")
    ) {
      imports.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function resolveTypeScriptDependency(
  importer: string,
  specifier: string,
): string {
  const unresolved = normalize(
    join(dirname(importer), specifier),
  );
  const candidates = extname(unresolved) !== ".ts"
    ? [
        `${unresolved}.ts`,
        join(unresolved, "index.ts"),
      ]
    : [unresolved];
  const dependency = candidates.find(
    (candidate) =>
      existsSync(join(process.cwd(), candidate)),
  );
  if (dependency === undefined) {
    throw new Error(
      `unresolved reviewed relative TypeScript import ${specifier} from ${importer}`,
    );
  }
  return dependency;
}

function reviewInput():
  C6SourceV4BoundedReviewSourceInput {
  return {
    authorTaskName: AUTHOR,
    freezeCandidate: {
      commitSha: FREEZE_COMMIT,
      treeSha: FREEZE_TREE,
    },
    reviewedSources:
      C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS.map(
        (path) => ({
          bytes: `reviewed source ${path}\n`,
          path,
        }),
      ),
    reviewerAgentName: REVIEWER,
    snapshot: structuredClone(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    ),
  };
}

function acceptedResponse(
  bundle: {
    dispatchBytes: string;
    inputBytes: string;
    requestBytes: string;
  },
): string {
  return canonicalJson({
    acceptedChecks:
      C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
    artifactKind:
      "c6-source-v4-bounded-review-response",
    blockingFindings: [],
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      liveCaptureAuthorized: false,
      sourceSelectionFrozen: false,
      status:
        "review-accepted-freeze-and-activation-required",
    },
    decision: "accepted-for-freeze",
    dispatchSha256: sha256(bundle.dispatchBytes),
    inputSha256: sha256(bundle.inputBytes),
    requestSha256: sha256(bundle.requestBytes),
    reviewedAt: REVIEWED_AT,
    reviewerAgentName: REVIEWER,
    schemaVersion: 2,
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

function provenance(
  bundle: {
    dispatchBytes: string;
    inputBytes: string;
    requestBytes: string;
  },
  responseBytes: string,
): string {
  return canonicalJson({
    artifactKind:
      "c6-source-v4-bounded-review-provenance",
    authorTaskName: AUTHOR,
    dispatch: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.dispatch,
      bundle.dispatchBytes,
    ),
    input: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
      bundle.inputBytes,
    ),
    recordedAt: REVIEWED_AT,
    request: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.request,
      bundle.requestBytes,
    ),
    response: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.response,
      responseBytes,
    ),
    reviewer: {
      agentName: REVIEWER,
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName: AUTHOR,
        basis:
          "orchestrator-observed-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName:
        "c6_source_v4_bounded_review_v2",
      type: "independent-ai-agent",
    },
    schemaVersion: 2,
  });
}

function reference(
  path: string,
  bytes: string,
) {
  return {
    byteLength: Buffer.byteLength(bytes),
    path,
    sha256: sha256(bytes),
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
