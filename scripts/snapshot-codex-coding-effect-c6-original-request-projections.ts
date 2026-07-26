#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  createC6RealHistoryOriginalRequestProjection,
  serializeC6RealHistoryOriginalRequestProjectionArtifact,
  validateC6RealHistoryOriginalRequestProjectionArtifact,
} from "./codex-coding-effect/c6-real-history-original-request-projection";
import {
  inspectC6RealHistorySemanticScreeningLedger,
} from "./codex-coding-effect/c6-real-history-semantic-screening";
import {
  parseC6RealHistoryTransitionQualification,
} from "./codex-coding-effect/c6-real-history-transition-qualification";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const inventorySchema = z.object({
  source: z.object({
    datasetId: z.literal("ByteDance-Seed/Multi-SWE-bench"),
    revision: z.string().regex(/^[a-f0-9]{40}$/u),
    files: z.array(z.object({
      bytes: z.number().int().positive(),
      path: z.string().min(1),
      rows: z.number().int().positive(),
      sha256: sha256Schema,
    }).passthrough()).min(1),
  }).passthrough(),
}).passthrough();

const options = parseArgs(Bun.argv.slice(2));
const [
  inventoryBytes,
  qualificationBytes,
  semanticBytes,
] = await Promise.all([
  readFile(options.sourceInventory),
  readFile(options.qualification),
  readFile(options.semanticScreening),
]);
const inventory = inventorySchema.parse(
  JSON.parse(inventoryBytes.toString("utf8")) as unknown,
);
const qualification = parseC6RealHistoryTransitionQualification(
  JSON.parse(qualificationBytes.toString("utf8")) as unknown,
);
const semantic = JSON.parse(semanticBytes.toString("utf8")) as unknown;
const continuationAnchorIds =
  inspectC6RealHistorySemanticScreeningLedger(
    semantic,
  ).continuationAnchorIds;
const continuationCandidates = continuationAnchorIds.map((anchorId) => {
  const candidate = qualification.candidates.find(
    (entry) => entry.anchorId === anchorId,
  );
  if (candidate === undefined) {
    throw new Error(
      `C6 original-request continuation is missing: ${anchorId}`,
    );
  }
  return candidate;
});
const sourceInputs = new Map(options.sources);
const sourceCache = new Map<string, {
  bytes: Buffer;
  lines: string[];
}>();
const projections = [];
for (const candidate of continuationCandidates) {
  const receipt = inventory.source.files.find(
    (file) => file.path === candidate.source.path,
  );
  const localPath = sourceInputs.get(candidate.source.path);
  if (receipt === undefined || localPath === undefined) {
    throw new Error(
      `C6 original-request source file is missing: ${candidate.source.path}`,
    );
  }
  let source = sourceCache.get(candidate.source.path);
  if (source === undefined) {
    const bytes = await readFile(localPath);
    if (
      bytes.byteLength !== receipt.bytes ||
      sha256(bytes) !== receipt.sha256 ||
      !bytes.toString("utf8").endsWith("\n")
    ) {
      throw new Error(
        `C6 original-request source file does not match: ${candidate.source.path}`,
      );
    }
    const lines = bytes.toString("utf8").slice(0, -1).split("\n");
    if (lines.length !== receipt.rows) {
      throw new Error(
        `C6 original-request source row count does not match: ${candidate.source.path}`,
      );
    }
    source = { bytes, lines };
    sourceCache.set(candidate.source.path, source);
  }
  const line = source.lines[candidate.source.rowIndex - 1];
  if (line === undefined) {
    throw new Error(
      `C6 original-request source row is missing: ${candidate.anchorId}`,
    );
  }
  projections.push(
    createC6RealHistoryOriginalRequestProjection({
      anchorId: candidate.anchorId,
      cappedPoolRank: candidate.cappedPoolRank,
      rawRecord: `${line}\n`,
      source: {
        fileBytes: receipt.bytes,
        fileSha256: receipt.sha256,
        path: receipt.path,
        rowIndex: candidate.source.rowIndex,
        rowSha256: candidate.source.rowSha256,
      },
    }),
  );
}
const artifact = {
  artifactKind:
    "c6-real-history-original-request-projection" as const,
  boundary: {
    acceptedEpisodeCount: 0 as const,
    candidateManifestFrozen: false as const,
    codexRunReady: false as const,
    machineQualificationCandidateCount: 0 as const,
  },
  policy:
    "resolved-issues-only-sorted-lf-trim-v1" as const,
  projections,
  recording: {
    exactSourceFilesRequiredForReplay: true as const,
    externalSourceCaptureAuthenticated: false as const,
    independentReviewComplete: false as const,
  },
  schemaVersion: 1 as const,
  source: {
    datasetId: "ByteDance-Seed/Multi-SWE-bench" as const,
    inventorySha256: sha256(inventoryBytes),
    revision: inventory.source.revision,
  },
};
validateC6RealHistoryOriginalRequestProjectionArtifact({
  artifact,
  continuationCandidates,
});
await writeFile(
  options.output,
  serializeC6RealHistoryOriginalRequestProjectionArtifact(
    artifact,
  ),
  { flag: "wx" },
);

function parseArgs(args: string[]): {
  output: string;
  qualification: string;
  semanticScreening: string;
  sourceInventory: string;
  sources: Array<[string, string]>;
} {
  const values = new Map<string, string>();
  const sources: Array<[string, string]> = [];
  for (const arg of args) {
    if (arg.startsWith("--source=")) {
      const binding = arg.slice("--source=".length);
      const separator = binding.indexOf("=");
      if (separator <= 0 || separator === binding.length - 1) {
        throw new Error(`Invalid --source binding: ${arg}`);
      }
      sources.push([
        binding.slice(0, separator),
        resolve(binding.slice(separator + 1)),
      ]);
      continue;
    }
    const match = /^--([^=]+)=(.+)$/u.exec(arg);
    if (match === null) {
      throw new Error(`Invalid argument: ${arg}`);
    }
    values.set(match[1]!, resolve(match[2]!));
  }
  const required = ([
    "output",
    "qualification",
    "semantic-screening",
    "source-inventory",
  ] as const).map((name) => [name, values.get(name)] as const);
  for (const [name, value] of required) {
    if (value === undefined) {
      throw new Error(`Missing --${name}`);
    }
  }
  return {
    output: values.get("output")!,
    qualification: values.get("qualification")!,
    semanticScreening: values.get("semantic-screening")!,
    sourceInventory: values.get("source-inventory")!,
    sources,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
