import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const GENERATED_BY = "scripts/project-historical-evidence.ts";
const PROJECTION_PATHS = [
  "benchmark-claims/evidence/beam-v0.6.0-historical.json",
  "benchmark-claims/evidence/implicitmembench-historical.json",
  "benchmark-claims/evidence/locomo-v0.6.0-historical.json",
  "benchmark-claims/evidence/longmemeval-historical.json",
  "benchmark-claims/evidence/memoryagentbench-v0.6.0-historical.json",
] as const;

interface HistoricalEvidenceProjection {
  generatedBy?: string;
  sourceArtifacts: Array<{
    bytes?: number;
    path: string;
    sha256?: string;
  }>;
  [key: string]: unknown;
}

function parseProjection(value: unknown): HistoricalEvidenceProjection {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as HistoricalEvidenceProjection).sourceArtifacts) ||
    !(value as HistoricalEvidenceProjection).sourceArtifacts.every(
      (artifact) =>
        artifact !== null &&
        typeof artifact === "object" &&
        typeof artifact.path === "string" &&
        artifact.path.length > 0,
    )
  ) {
    throw new Error("Historical evidence projection is malformed.");
  }
  return value as HistoricalEvidenceProjection;
}

export async function refreshHistoricalEvidenceProjection(input: {
  projection: HistoricalEvidenceProjection;
  readArtifact(path: string): Promise<Uint8Array>;
}): Promise<HistoricalEvidenceProjection> {
  const sourceArtifacts = await Promise.all(
    input.projection.sourceArtifacts.map(async ({ path }) => {
      const content = await input.readArtifact(path);
      return {
        bytes: content.byteLength,
        path,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    }),
  );
  return {
    ...input.projection,
    generatedBy: GENERATED_BY,
    sourceArtifacts,
  };
}

export function assertHistoricalEvidenceProjectionCurrent(input: {
  actual: HistoricalEvidenceProjection;
  expected: HistoricalEvidenceProjection;
}): void {
  if (
    input.actual.generatedBy !== input.expected.generatedBy ||
    JSON.stringify(input.actual.sourceArtifacts) !==
      JSON.stringify(input.expected.sourceArtifacts)
  ) {
    throw new Error("Historical evidence projection source fingerprints drifted.");
  }
}

async function main(): Promise<void> {
  const write = Bun.argv.includes("--write");
  for (const path of PROJECTION_PATHS) {
    const absolutePath = resolve(path);
    const actual = parseProjection(JSON.parse(await readFile(absolutePath, "utf8")));
    const expected = await refreshHistoricalEvidenceProjection({
      projection: actual,
      readArtifact: (artifactPath) => readFile(resolve(artifactPath)),
    });
    if (write) {
      await writeFile(absolutePath, `${JSON.stringify(expected, null, 2)}\n`, "utf8");
    } else {
      assertHistoricalEvidenceProjectionCurrent({ actual, expected });
    }
  }
  console.log(write ? "Historical evidence projections refreshed." : "Historical evidence projections are current.");
}

if (import.meta.main) {
  await main();
}
