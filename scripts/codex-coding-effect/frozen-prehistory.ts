import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const rolloutMessageSchema = z.object({
  payload: z.object({
    content: z.array(z.object({
      text: z.string().min(1).refine(
        (value) => value.trim() === value,
        "text cannot be whitespace-padded",
      ),
      type: z.enum(["input_text", "output_text"]),
    }).strict()).min(1),
    role: z.enum(["assistant", "user"]),
    type: z.literal("message"),
  }).strict(),
  type: z.literal("response_item"),
}).strict();

const seedReceiptSchema = z.object({
  historySourceSha256: sha256Schema,
  memoryExportSha256: sha256Schema,
  rawTranscriptPersisted: z.literal(false),
  schemaVersion: z.literal(1),
  seedSurface: z.literal("codex-writeback-from-rollout"),
  sourceSessionDigest: z.string().min(1),
  writebackOutcome: z.literal("written"),
  writtenMemoryIds: z.array(z.string().min(1)).min(1),
}).strict();

export interface FrozenPrehistoryRecord {
  id: string;
  message: string;
  role: "assistant" | "user";
}

export interface FrozenPrehistoryArtifact {
  path: string;
  records: readonly Readonly<FrozenPrehistoryRecord>[];
  sourceBytes: string;
  sourceSha256: string;
}

export interface FrozenPrehistoryLeakageOverlap {
  kind:
    | "forbidden-string-exact"
    | "forbidden-string-normalized"
    | "source-file-exact"
    | "source-line-normalized";
  recordId?: string;
  sourceLabel?: string;
}

export interface FrozenPrehistoryLeakageAudit {
  declaredForbiddenSourceSha256: string[];
  overlaps: FrozenPrehistoryLeakageOverlap[];
  passed: boolean;
  sourceSha256: string;
}

export type FrozenPrehistorySeedReceipt = z.infer<typeof seedReceiptSchema>;

export const EMPTY_FROZEN_PREHISTORY_SHA256 = sha256("");

export async function loadFrozenPrehistory(input: {
  allowEmpty?: boolean;
  expectedSha256: string;
  path: string;
}): Promise<Readonly<FrozenPrehistoryArtifact>> {
  sha256Schema.parse(input.expectedSha256);
  const sourceBytes = await readFile(input.path, "utf8");
  const sourceSha256 = sha256(sourceBytes);
  if (sourceSha256 !== input.expectedSha256) {
    throw new Error(
      `frozen prehistory hash does not match ${input.path}: expected ${input.expectedSha256}, received ${sourceSha256}`,
    );
  }
  if (sourceBytes.length > 0 && sourceBytes.trim().length === 0) {
    throw new Error(
      "canonical empty frozen prehistory must be exactly zero bytes",
    );
  }

  const records: Readonly<FrozenPrehistoryRecord>[] = [];
  for (const [index, line] of sourceBytes.split("\n").entries()) {
    if (line.length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`frozen prehistory line ${index + 1} is not valid JSON`);
    }
    const parsed = rolloutMessageSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`frozen prehistory line ${index + 1} failed schema validation`);
    }
    const expectedBlockType = parsed.data.payload.role === "user"
      ? "input_text"
      : "output_text";
    if (parsed.data.payload.content.some((block) =>
      block.type !== expectedBlockType
    )) {
      throw new Error(`frozen prehistory line ${index + 1} has a role/block mismatch`);
    }
    records.push(Object.freeze({
      id: `line-${index + 1}`,
      message: parsed.data.payload.content.map((block) => block.text).join("\n"),
      role: parsed.data.payload.role,
    }));
  }
  if (records.length === 0 && input.allowEmpty !== true) {
    throw new Error("frozen prehistory must contain at least one record");
  }
  return Object.freeze({
    path: input.path,
    records: Object.freeze(records),
    sourceBytes,
    sourceSha256,
  });
}

export function auditFrozenPrehistoryLeakage(input: {
  artifact: FrozenPrehistoryArtifact;
  declaredForbiddenSourceSha256: readonly string[];
  forbiddenSources: ReadonlyArray<{ content: string; label: string }>;
  forbiddenStrings: readonly string[];
}): FrozenPrehistoryLeakageAudit {
  const declared = new Set(
    input.declaredForbiddenSourceSha256.map((value) => sha256Schema.parse(value)),
  );
  for (const source of input.forbiddenSources) {
    const sourceSha256 = sha256(source.content);
    if (!declared.has(sourceSha256)) {
      throw new Error(
        `undeclared forbidden source hash for ${source.label}: ${sourceSha256}`,
      );
    }
  }

  const overlaps: FrozenPrehistoryLeakageOverlap[] = [];
  const normalizedArtifact = normalizeLeakageText(input.artifact.sourceBytes);
  for (const forbidden of input.forbiddenStrings) {
    if (input.artifact.sourceBytes.includes(forbidden)) {
      overlaps.push({ kind: "forbidden-string-exact" });
      continue;
    }
    const normalized = normalizeLeakageText(forbidden);
    if (normalized.length > 0 && normalizedArtifact.includes(normalized)) {
      overlaps.push({ kind: "forbidden-string-normalized" });
    }
  }

  for (const source of input.forbiddenSources) {
    if (input.artifact.sourceBytes === source.content) {
      overlaps.push({
        kind: "source-file-exact",
        sourceLabel: source.label,
      });
    }
    for (const sourceLine of meaningfulSourceLines(source.content)) {
      const record = input.artifact.records.find((candidate) =>
        normalizeLeakageText(candidate.message).includes(sourceLine)
      );
      if (record !== undefined) {
        overlaps.push({
          kind: "source-line-normalized",
          recordId: record.id,
          sourceLabel: source.label,
        });
      }
    }
  }

  return {
    declaredForbiddenSourceSha256: [...declared].sort(),
    overlaps,
    passed: overlaps.length === 0,
    sourceSha256: input.artifact.sourceSha256,
  };
}

export async function assertFrozenPrehistoryUnchanged(
  artifact: FrozenPrehistoryArtifact,
): Promise<void> {
  const currentSha256 = sha256(await readFile(artifact.path, "utf8"));
  if (currentSha256 !== artifact.sourceSha256) {
    throw new Error(
      `frozen prehistory changed after run identity: ${artifact.path}`,
    );
  }
}

export async function sealFrozenPrehistory(input: {
  allowEmpty?: boolean;
  artifact: FrozenPrehistoryArtifact;
  sealedPath: string;
}): Promise<Readonly<FrozenPrehistoryArtifact>> {
  if (
    input.artifact.sourceBytes.length === 0 &&
    input.allowEmpty !== true
  ) {
    throw new Error("frozen prehistory must contain at least one record");
  }
  await mkdir(dirname(input.sealedPath), { recursive: true });
  await writeFile(input.sealedPath, input.artifact.sourceBytes, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o400,
  });
  await chmod(input.sealedPath, 0o400);
  return loadFrozenPrehistory({
    allowEmpty: input.allowEmpty,
    expectedSha256: input.artifact.sourceSha256,
    path: input.sealedPath,
  });
}

export async function persistFrozenPrehistorySeedReceipt(
  path: string,
  receipt: FrozenPrehistorySeedReceipt,
): Promise<void> {
  const parsed = parseFrozenPrehistorySeedReceipt(receipt);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export function parseFrozenPrehistorySeedReceipt(
  value: unknown,
): FrozenPrehistorySeedReceipt {
  const parsed = seedReceiptSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid frozen-prehistory seed receipt");
  }
  if (new Set(parsed.data.writtenMemoryIds).size !== parsed.data.writtenMemoryIds.length) {
    throw new Error("invalid frozen-prehistory seed receipt");
  }
  return parsed.data;
}

export function assertFlatSummaryControlComparable(input: {
  goodMemory: {
    historySourceSha256: string;
    maxInjectedTokens: number;
  };
  summary: {
    historySourceSha256: string;
    maxInjectedTokens: number;
  };
}): void {
  if (
    input.goodMemory.historySourceSha256 !==
      input.summary.historySourceSha256
  ) {
    throw new Error("flat-summary history source hash must match GoodMemory");
  }
  if (
    input.goodMemory.maxInjectedTokens !== input.summary.maxInjectedTokens
  ) {
    throw new Error("flat-summary token budget must match GoodMemory");
  }
}

function meaningfulSourceLines(source: string): string[] {
  const lines = new Set<string>();
  for (const rawLine of source.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("diff --git ") ||
      trimmed.startsWith("@@") ||
      trimmed.startsWith("---") ||
      trimmed.startsWith("+++")
    ) {
      continue;
    }
    const withoutDiffMarker = /^[+-]/u.test(trimmed)
      ? trimmed.slice(1)
      : trimmed;
    const normalized = normalizeLeakageText(withoutDiffMarker);
    if (normalized.length >= 24) {
      lines.add(normalized);
    }
  }
  return [...lines];
}

function normalizeLeakageText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(
    /\s+/gu,
    " ",
  ).trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
