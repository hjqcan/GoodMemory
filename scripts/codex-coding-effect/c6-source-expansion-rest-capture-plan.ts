import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const sourceSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().positive(),
  rowSha256: sha256Schema,
}).strict();
const expansionSchema = z.object({
  artifactKind: z.literal("c6-review-trajectory-source-expansion"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
  }).passthrough(),
  inventory: z.object({
    sourceRevision: commitSchema,
    sourceRootSha256: sha256Schema,
    treeReceiptSha256: sha256Schema,
  }).passthrough(),
  policy: z.object({
    policyId: z.literal("prospective-structural-review-v2"),
    sha256: sha256Schema,
  }).passthrough(),
  pretargets: z.array(z.object({
    anchorId: z.string().min(1),
    canonicalAnchorId: z.string().min(1),
    captureDirectory: z.string().min(1),
    requestedRepository: z.string().min(3),
    restCaptureOrder: z.number().int().positive(),
    source: sourceSchema,
  }).passthrough()).min(1),
  schemaVersion: z.literal(1),
}).passthrough();
const sourceRowSchema = z.object({
  number: z.number().int().positive(),
  org: z.string().min(1),
  repo: z.string().min(1),
  resolved_issues: z.array(z.object({
    number: z.number().int().positive(),
  }).passthrough()).min(1),
}).passthrough();

type Expansion = z.infer<typeof expansionSchema>;

export interface C6SourceExpansionRestCapturePlan {
  artifactKind: "c6-source-expansion-rest-capture-plan";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    captureExecuted: false;
    codexRunReady: false;
    status: "rest-capture-plan-only-no-network-result";
  };
  counts: {
    repositoryCount: number;
    targetCount: number;
  };
  independenceBoundary: {
    selectionDependsOnCaptureOutcome: false;
    targetProjectionSha256: string;
  };
  input: {
    bytes: number;
    path: string;
    policyId: "prospective-structural-review-v2";
    policySha256: string;
    sha256: string;
  };
  rule: {
    order: "source-expansion-restCaptureOrder-ascending";
    sourceRows:
      "exact-path-rowIndex-rowSha256-from-frozen-source-revision";
  };
  schemaVersion: 1;
  source: {
    fullSourceRootRehashed: false;
    revision: string;
    rootSha256: string;
    selectedRowsReplayed: true;
    treeReceiptSha256: string;
  };
  targets: Array<{
    anchorId: string;
    canonicalAnchorId: string;
    captureDirectory: string;
    captureOrder: number;
    owner: string;
    pullNumber: number;
    repository: string;
    resolvedIssueNumbers: number[];
    source: z.infer<typeof sourceSchema>;
  }>;
}

export function projectC6SourceExpansionRestCapturePlan(input: {
  expansionBytes: Uint8Array;
  expansionPath: string;
  sourceRows: ReadonlyMap<string, string>;
}): C6SourceExpansionRestCapturePlan {
  const expansionBytes = Buffer.from(input.expansionBytes);
  const expansion = expansionSchema.parse(
    parseJson(expansionBytes, "source expansion"),
  );
  const ordered = [...expansion.pretargets].sort(
    (left, right) => left.restCaptureOrder - right.restCaptureOrder,
  );
  assertCaptureOrder(ordered);
  const targets = ordered.map((candidate) => {
    const rowKey = sourceRowKey(candidate.source);
    const rowBytes = input.sourceRows.get(rowKey);
    if (
      rowBytes === undefined ||
      sha256(rowBytes) !== candidate.source.rowSha256
    ) {
      throw new Error(
        `C6 REST capture plan source row hash mismatch ${
          candidate.anchorId
        }`,
      );
    }
    if (!rowBytes.endsWith("\n") || rowBytes.includes("\r")) {
      throw new Error(
        `C6 REST capture plan source row is not LF terminated ${
          candidate.anchorId
        }`,
      );
    }
    const row = sourceRowSchema.parse(
      parseJson(Buffer.from(rowBytes), `source row ${candidate.anchorId}`),
    );
    const requestedRepository = normalizeRepository(
      candidate.requestedRepository,
    );
    const rowRepository = normalizeRepository(`${row.org}/${row.repo}`);
    const anchor = parseAnchor(candidate.anchorId);
    if (
      rowRepository !== requestedRepository ||
      anchor.repository !== requestedRepository ||
      anchor.pullNumber !== row.number
    ) {
      throw new Error(
        `C6 REST capture plan source identity mismatch ${
          candidate.anchorId
        }`,
      );
    }
    const resolvedIssueNumbers = row.resolved_issues
      .map((issue) => issue.number)
      .sort((left, right) => left - right);
    if (
      new Set(resolvedIssueNumbers).size !== resolvedIssueNumbers.length ||
      resolvedIssueNumbers.includes(row.number)
    ) {
      throw new Error(
        `C6 REST capture plan invalid resolved issues ${
          candidate.anchorId
        }`,
      );
    }
    return {
      anchorId: candidate.anchorId,
      canonicalAnchorId: candidate.canonicalAnchorId,
      captureDirectory: candidate.captureDirectory,
      captureOrder: candidate.restCaptureOrder,
      owner: row.org,
      pullNumber: row.number,
      repository: row.repo,
      resolvedIssueNumbers,
      source: candidate.source,
    };
  });
  const repositories = new Set(
    targets.map((target) =>
      normalizeRepository(`${target.owner}/${target.repository}`)
    ),
  );
  return {
    artifactKind: "c6-source-expansion-rest-capture-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
      status: "rest-capture-plan-only-no-network-result",
    },
    counts: {
      repositoryCount: repositories.size,
      targetCount: targets.length,
    },
    independenceBoundary: {
      selectionDependsOnCaptureOutcome: false,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    input: {
      bytes: expansionBytes.byteLength,
      path: basename(input.expansionPath),
      policyId: expansion.policy.policyId,
      policySha256: expansion.policy.sha256,
      sha256: sha256(expansionBytes),
    },
    rule: {
      order: "source-expansion-restCaptureOrder-ascending",
      sourceRows:
        "exact-path-rowIndex-rowSha256-from-frozen-source-revision",
    },
    schemaVersion: 1,
    source: {
      fullSourceRootRehashed: false,
      revision: expansion.inventory.sourceRevision,
      rootSha256: expansion.inventory.sourceRootSha256,
      selectedRowsReplayed: true,
      treeReceiptSha256: expansion.inventory.treeReceiptSha256,
    },
    targets,
  };
}

export function serializeC6SourceExpansionRestCapturePlan(
  plan: C6SourceExpansionRestCapturePlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export async function materializeC6SourceExpansionRestCapturePlan(input: {
  expectedExpansionSha256: string;
  expansionPath: string;
  outputPath: string;
  sourceRoot: string;
}): Promise<{
  outputSha256: string;
  plan: C6SourceExpansionRestCapturePlan;
}> {
  const expectedExpansionSha256 = sha256Schema.parse(
    input.expectedExpansionSha256,
  );
  const [expansionPath, sourceRoot] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.expansionPath,
      "C6 REST capture plan expansion",
    ),
    assertC6NoSymlinkPathComponents(
      input.sourceRoot,
      "C6 REST capture plan source root",
    ),
  ]);
  const expansionBytes = await readC6StableRegularFile(
    expansionPath,
    "REST capture plan expansion",
  );
  if (sha256(expansionBytes) !== expectedExpansionSha256) {
    throw new Error("C6 REST capture plan expansion hash mismatch");
  }
  const expansion = expansionSchema.parse(
    parseJson(expansionBytes, "source expansion"),
  );
  const sourceRows = await readSelectedSourceRows(
    sourceRoot,
    expansion.pretargets.map((candidate) => candidate.source),
  );
  const plan = projectC6SourceExpansionRestCapturePlan({
    expansionBytes,
    expansionPath,
    sourceRows,
  });
  const terminalExpansionBytes = await readC6StableRegularFile(
    expansionPath,
    "REST capture plan terminal expansion",
  );
  if (!terminalExpansionBytes.equals(expansionBytes)) {
    throw new Error(
      "C6 REST capture plan expansion changed during projection",
    );
  }
  const serialized = serializeC6SourceExpansionRestCapturePlan(plan);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 REST capture plan output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

async function readSelectedSourceRows(
  sourceRoot: string,
  sources: readonly z.infer<typeof sourceSchema>[],
): Promise<Map<string, string>> {
  const byPath = new Map<
    string,
    Map<number, z.infer<typeof sourceSchema>>
  >();
  for (const source of sources) {
    assertSafeRelativePath(source.path);
    const rows = byPath.get(source.path) ?? new Map();
    if (rows.has(source.rowIndex)) {
      throw new Error(
        `C6 REST capture plan duplicate source row ${sourceRowKey(source)}`,
      );
    }
    rows.set(source.rowIndex, source);
    byPath.set(source.path, rows);
  }
  const result = new Map<string, string>();
  for (const [relativePath, rows] of byPath) {
    const absolutePath = await assertC6NoSymlinkPathComponents(
      join(sourceRoot, ...relativePath.split("/")),
      "C6 REST capture plan source file",
    );
    const handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile()) {
        throw new Error(
          `C6 REST capture plan source is not a file ${relativePath}`,
        );
      }
      const maximumRow = Math.max(...rows.keys());
      const lines = createInterface({
        crlfDelay: Infinity,
        input: handle.createReadStream({ autoClose: false }),
      });
      let rowIndex = 0;
      for await (const line of lines) {
        rowIndex += 1;
        if (rows.has(rowIndex)) {
          result.set(`${relativePath}#${rowIndex}`, `${line}\n`);
        }
        if (rowIndex >= maximumRow) {
          break;
        }
      }
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.mtimeMs !== after.mtimeMs ||
        before.size !== after.size
      ) {
        throw new Error(
          `C6 REST capture plan source changed ${relativePath}`,
        );
      }
      for (const rowIndex of rows.keys()) {
        if (!result.has(`${relativePath}#${rowIndex}`)) {
          throw new Error(
            `C6 REST capture plan missing source row ${
              relativePath
            }#${rowIndex}`,
          );
        }
      }
    } finally {
      await handle.close();
    }
  }
  return result;
}

function assertCaptureOrder(
  pretargets: readonly Expansion["pretargets"][number][],
): void {
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const [index, candidate] of pretargets.entries()) {
    if (candidate.restCaptureOrder !== index + 1) {
      throw new Error(
        "C6 REST capture plan capture order must be contiguous",
      );
    }
    if (
      anchors.has(candidate.canonicalAnchorId) ||
      directories.has(candidate.captureDirectory)
    ) {
      throw new Error("C6 REST capture plan duplicate target");
    }
    anchors.add(candidate.canonicalAnchorId);
    directories.add(candidate.captureDirectory);
  }
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const match = /^([^/#]+\/[^/#]+)#([1-9]\d*)$/u.exec(value);
  if (match === null) {
    throw new Error(`C6 REST capture plan invalid anchor ${value}`);
  }
  return {
    pullNumber: Number(match[2]),
    repository: normalizeRepository(match[1]!),
  };
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#]+\/[^/#]+$/u.test(normalized)) {
    throw new Error(`C6 REST capture plan invalid repository ${value}`);
  }
  return normalized;
}

function sourceRowKey(source: z.infer<typeof sourceSchema>): string {
  return `${source.path}#${source.rowIndex}`;
}

function assertSafeRelativePath(path: string): void {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((component) =>
      component.length === 0 || component === "." || component === ".."
    )
  ) {
    throw new Error(`C6 REST capture plan unsafe source path ${path}`);
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 REST capture plan invalid ${label} JSON`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
