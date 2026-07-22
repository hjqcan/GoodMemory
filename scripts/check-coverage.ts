import { readFile } from "node:fs/promises";
import { relative } from "node:path";

export interface CoverageRecord {
  path: string;
  covered: number;
  found: number;
  lineHits?: Record<number, number>;
}

export interface ThresholdGroup {
  name: string;
  threshold: number;
  matches: (path: string) => boolean;
}

export interface CoverageResult {
  overall: {
    covered: number;
    found: number;
    percent: number;
  };
  groups: Array<{
    name: string;
    threshold: number;
    covered: number;
    found: number;
    percent: number;
    matchedCount: number;
  }>;
  failures: string[];
}

const OVERALL_THRESHOLD = 90;

export const GROUPS: ThresholdGroup[] = [
  {
    name: "src/domain",
    threshold: 90,
    matches: (path) => path.startsWith("src/domain/"),
  },
  {
    name: "src/remember",
    threshold: 90,
    matches: (path) => path.startsWith("src/remember/"),
  },
  {
    name: "src/recall",
    threshold: 90,
    matches: (path) => path.startsWith("src/recall/"),
  },
  {
    name: "src/runtime",
    threshold: 90,
    matches: (path) => path.startsWith("src/runtime/"),
  },
  {
    name: "src/maintenance",
    threshold: 90,
    matches: (path) => path.startsWith("src/maintenance/"),
  },
  {
    name: "src/verify",
    threshold: 90,
    matches: (path) => path.startsWith("src/verify/"),
  },
  {
    name: "src/storage",
    threshold: 90,
    matches: (path) => path.startsWith("src/storage/"),
  },
  {
    name: "src/eval",
    threshold: 80,
    matches: (path) => path.startsWith("src/eval/"),
  },
  {
    name: "src/provider",
    threshold: 80,
    matches: (path) => path.startsWith("src/provider/"),
  },
  {
    name: "src/api",
    threshold: 90,
    matches: (path) => path.startsWith("src/api/"),
  },
  {
    name: "src/ai-sdk",
    threshold: 85,
    matches: (path) => path.startsWith("src/ai-sdk/"),
  },
  {
    name: "src/host",
    threshold: 90,
    matches: (path) => path.startsWith("src/host/"),
  },
  {
    name: "src/install",
    threshold: 80,
    matches: (path) => path.startsWith("src/install/"),
  },
  {
    name: "src/language",
    threshold: 85,
    matches: (path) => path.startsWith("src/language/"),
  },
  {
    name: "src/cli.ts",
    threshold: 85,
    matches: (path) => path === "src/cli.ts",
  },
  {
    name: "scripts/run-eval.ts",
    threshold: 80,
    matches: (path) => path === "scripts/run-eval.ts",
  },
  {
    name: "scripts/summarize-eval.ts",
    threshold: 80,
    matches: (path) => path === "scripts/summarize-eval.ts",
  },
];

export function normalizeCoveragePath(value: string): string {
  const path = relative(process.cwd(), value).replaceAll("\\", "/");
  return path.startsWith("../") ? value.replaceAll("\\", "/") : path;
}

export function parseLcov(content: string): CoverageRecord[] {
  const records: CoverageRecord[] = [];
  let currentPath: string | null = null;
  let currentCovered = 0;
  let currentFound = 0;
  let currentLineHits = new Map<number, number>();

  const flush = () => {
    if (!currentPath) {
      return;
    }

    const lineHits =
      currentLineHits.size > 0
        ? Object.fromEntries(currentLineHits.entries())
        : undefined;
    const found = lineHits === undefined ? currentFound : currentLineHits.size;
    const covered =
      lineHits === undefined
        ? currentCovered
        : Array.from(currentLineHits.values()).filter((hits) => hits > 0).length;

    records.push({
      path: normalizeCoveragePath(currentPath),
      covered,
      found,
      lineHits,
    });
  };

  for (const line of content.split("\n")) {
    if (line.startsWith("SF:")) {
      flush();
      currentPath = line.slice(3).trim();
      currentCovered = 0;
      currentFound = 0;
      currentLineHits = new Map<number, number>();
      continue;
    }

    if (line.startsWith("DA:")) {
      const [lineNumberValue, hitCountValue] = line.slice(3).split(",", 2);
      const lineNumber = Number(lineNumberValue);
      const hitCount = Number(hitCountValue);
      if (Number.isInteger(lineNumber) && Number.isFinite(hitCount)) {
        currentLineHits.set(lineNumber, hitCount);
      }
      continue;
    }

    if (line.startsWith("LH:")) {
      currentCovered = Number(line.slice(3));
      continue;
    }

    if (line.startsWith("LF:")) {
      currentFound = Number(line.slice(3));
      continue;
    }
  }

  flush();
  return records;
}

export function mergeCoverageRecords(records: CoverageRecord[]): CoverageRecord[] {
  const byPath = new Map<string, CoverageRecord>();

  for (const record of records) {
    const existing = byPath.get(record.path);
    if (existing === undefined) {
      byPath.set(record.path, record);
      continue;
    }

    byPath.set(record.path, mergeCoverageRecordPair(existing, record));
  }

  return Array.from(byPath.values());
}

function mergeCoverageRecordPair(
  existing: CoverageRecord,
  next: CoverageRecord,
): CoverageRecord {
  if (existing.lineHits !== undefined && next.lineHits !== undefined) {
    const lineHits = new Map<number, number>();

    for (const record of [existing, next]) {
      for (const [lineNumberValue, hitCount] of Object.entries(
        record.lineHits ?? {},
      )) {
        const lineNumber = Number(lineNumberValue);
        if (!Number.isInteger(lineNumber)) {
          continue;
        }

        lineHits.set(
          lineNumber,
          Math.max(lineHits.get(lineNumber) ?? 0, hitCount),
        );
      }
    }

    return {
      path: existing.path,
      covered: Array.from(lineHits.values()).filter(
        (hitCount) => hitCount > 0,
      ).length,
      found: lineHits.size,
      lineHits: Object.fromEntries(
        Array.from(lineHits.entries()).sort(([left], [right]) => left - right),
      ),
    };
  }

  const existingPercent = existing.found === 0 ? 0 : existing.covered / existing.found;
  const nextPercent = next.found === 0 ? 0 : next.covered / next.found;
  if (
    nextPercent > existingPercent ||
    (nextPercent === existingPercent && next.found > existing.found)
  ) {
    return next;
  }

  return existing;
}

export function formatPercent(covered: number, found: number): string {
  if (found === 0) {
    return "0.00";
  }

  return ((covered / found) * 100).toFixed(2);
}

export function resolveOverallRecords(records: CoverageRecord[]): CoverageRecord[] {
  return records.filter(
    (record) =>
      record.path.startsWith("src/") ||
      record.path === "scripts/run-eval.ts" ||
      record.path === "scripts/summarize-eval.ts",
  );
}

export function evaluateCoverage(records: CoverageRecord[]): CoverageResult {
  const failures: string[] = [];
  const mergedRecords = mergeCoverageRecords(records);

  const overallRecords = resolveOverallRecords(mergedRecords);
  const overallCovered = overallRecords.reduce((sum, record) => sum + record.covered, 0);
  const overallFound = overallRecords.reduce((sum, record) => sum + record.found, 0);
  const overallPercent = Number(formatPercent(overallCovered, overallFound));

  if (overallPercent < OVERALL_THRESHOLD) {
    failures.push(
      `overall deterministic line coverage ${overallPercent.toFixed(2)}% < ${OVERALL_THRESHOLD.toFixed(2)}%`,
    );
  }

  const groups = GROUPS.map((group) => {
    const matched = mergedRecords.filter((record) => group.matches(record.path));
    const covered = matched.reduce((sum, record) => sum + record.covered, 0);
    const found = matched.reduce((sum, record) => sum + record.found, 0);
    const percent = Number(formatPercent(covered, found));

    if (matched.length === 0) {
      failures.push(`coverage group ${group.name} did not match any files`);
    } else if (percent < group.threshold) {
      failures.push(
        `${group.name} line coverage ${percent.toFixed(2)}% < ${group.threshold.toFixed(2)}%`,
      );
    }

    return {
      name: group.name,
      threshold: group.threshold,
      covered,
      found,
      percent,
      matchedCount: matched.length,
    };
  });

  return {
    overall: {
      covered: overallCovered,
      found: overallFound,
      percent: overallPercent,
    },
    groups,
    failures,
  };
}

export async function readCoverageRecords(
  filePaths: string | string[] = "coverage/lcov.info",
): Promise<CoverageRecord[]> {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  const records = await Promise.all(
    paths.map(async (filePath) => parseLcov(await readFile(filePath, "utf8"))),
  );

  return records.flat();
}

function logCoverageReport(result: CoverageResult): void {
  console.log(
    `Coverage overall: ${result.overall.percent.toFixed(2)}% (${result.overall.covered}/${result.overall.found})`,
  );

  for (const group of result.groups) {
    console.log(`${group.name}: ${group.percent.toFixed(2)}% (${group.covered}/${group.found})`);
  }
}

async function main(): Promise<void> {
  const coveragePaths =
    process.argv.length > 2 ? process.argv.slice(2) : ["coverage/lcov.info"];
  const records = await readCoverageRecords(coveragePaths);
  const result = evaluateCoverage(records);

  logCoverageReport(result);

  if (result.failures.length > 0) {
    throw new Error(`Coverage gate failed:\n- ${result.failures.join("\n- ")}`);
  }
}

if (import.meta.main) {
  await main();
}
