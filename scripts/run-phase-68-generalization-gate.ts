import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveCliFlagValueStrict } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

interface Phase68AuditInput {
  sourceReports: Array<{ runId: string; scale: string }>;
  summary: {
    caseFitted: number;
    multiCase: number;
    totalGates: number;
    unobserved: number;
  };
  verdicts: Array<{
    caseIds: string[];
    gateId: string;
    hitCount: number;
    status: "case_fitted" | "multi_case" | "unobserved";
  }>;
}

interface Phase68BaselineInput {
  profiles: Record<string, {
    summary?: {
      evidenceCaseCount?: number;
      evidenceChatRecall?: number | null;
      missedRecallCases?: number;
      totalCases?: number;
    };
  }>;
  summary: {
    executionFailures: number;
    profilesCompared: string[];
    scale: string;
    totalCases: number;
  };
}

export interface Phase68GateCheck {
  detail: string;
  key: string;
  passed: boolean;
}

export function evaluatePhase68GeneralizationGate(input: {
  audit: Phase68AuditInput;
  baseline: Phase68BaselineInput;
  packageFiles: string[];
  productionRecallFiles: string[];
  productionRecallSources: Record<string, string>;
  productionSelectionSource: string;
}): { checks: Phase68GateCheck[]; passed: boolean } {
  const gateIds = input.audit.verdicts.map(({ gateId }) => gateId);
  const derivedStatusCounts = {
    caseFitted: input.audit.verdicts.filter(({ status }) => status === "case_fitted").length,
    multiCase: input.audit.verdicts.filter(({ status }) => status === "multi_case").length,
    unobserved: input.audit.verdicts.filter(({ status }) => status === "unobserved").length,
  };
  const auditCountMatches =
    input.audit.verdicts.length === 148 &&
    new Set(gateIds).size === 148 &&
    gateIds.every((gateId) => gateId.trim().length > 0) &&
    input.audit.summary.totalGates === 148 &&
    input.audit.summary.caseFitted === derivedStatusCounts.caseFitted &&
    input.audit.summary.multiCase === derivedStatusCounts.multiCase &&
    input.audit.summary.unobserved === derivedStatusCounts.unobserved &&
    input.audit.verdicts.every((verdict) => {
      const expectedStatus = verdict.caseIds.length === 0
        ? "unobserved"
        : verdict.caseIds.length === 1
          ? "case_fitted"
          : "multi_case";
      return verdict.hitCount === verdict.caseIds.length &&
        verdict.status === expectedStatus;
    });
  const auditedScales = new Set(
    input.audit.sourceReports.map(({ scale }) => scale),
  );
  const baselineSummary =
    input.baseline.profiles["goodmemory-rules-only"]?.summary;
  const allowedFactSelectionFiles = new Set([
    "factSelection/contracts.ts",
    "factSelection/draft.ts",
    "factSelection/generalizedFusionUnion.ts",
    "factSelection/semanticUnion.ts",
  ]);
  const allowedSelectorFiles = new Set([
    "selectors/recordSelection.ts",
    "selectors/selectionContext.ts",
  ]);
  const fittedSourceIsolated = input.productionRecallFiles.every((path) => {
    const normalized = path.replaceAll("\\", "/");
    if (normalized.startsWith("factSelection/")) {
      return allowedFactSelectionFiles.has(normalized);
    }
    if (normalized.startsWith("selectors/")) {
      return allowedSelectorFiles.has(normalized);
    }
    return ![
      "narrowGates.ts",
      "selectionLegacy.ts",
      "selectionRunContext.ts",
    ].includes(normalized);
  });
  const productionSourcePaths = Object.keys(input.productionRecallSources).sort();
  const productionRecallPaths = [...input.productionRecallFiles].sort();
  const productionSourcesAreGeneric =
    productionSourcePaths.length === productionRecallPaths.length &&
    productionSourcePaths.every(
      (path, index) => path === productionRecallPaths[index],
    ) &&
    Object.values(input.productionRecallSources).every(
      (source) =>
        !/\b(?:beam|external_benchmark|implicitmembench|locomo|longmemeval|memoryagentbench)\b/iu.test(
          source,
        ),
    );
  const checks: Phase68GateCheck[] = [
    {
      detail: "The merged audit must classify all 148 registered fitted gates.",
      key: "complete-gate-census",
      passed: auditCountMatches,
    },
    {
      detail: "The gate census must cover BEAM 100K, 500K, and 1M.",
      key: "cross-split-audit",
      passed:
        input.audit.sourceReports.length === 3 &&
        auditedScales.size === 3 &&
        new Set(input.audit.sourceReports.map(({ runId }) => runId)).size === 3 &&
        input.audit.sourceReports.every(({ runId }) => runId.trim().length > 0) &&
        ["100K", "500K", "1M"].every((scale) => auditedScales.has(scale)),
    },
    {
      detail: "The production package must exclude source and TypeScript bin entrypoints.",
      key: "compiled-only-package",
      passed:
        !input.packageFiles.some((path) => {
          const normalized = path.replace(/^\.\//, "");
          return normalized === "src" ||
            normalized.startsWith("src/") ||
            normalized.endsWith(".ts");
        }),
    },
    {
      detail: "The production selection module must not import the legacy fitted graph.",
      key: "production-import-isolation",
      passed:
        [
          "selectionLegacy",
          "sourceOrderRules",
          "factSelection/augmenterTable",
          "factSelection/routeTable",
          "selectionRunContext",
          "selectors/aggregateNarrowGates",
        ].every((marker) => !input.productionSelectionSource.includes(marker)),
    },
    {
      detail: "The fitted selector graph must live outside src/recall.",
      key: "fitted-source-isolation",
      passed: fittedSourceIsolated,
    },
    {
      detail: "Every production recall source must be scanned and contain no fitted benchmark identity.",
      key: "production-source-literal-isolation",
      passed: productionSourcesAreGeneric,
    },
    {
      detail: "The generalized BEAM 100K baseline must cover all 400 questions with zero failures.",
      key: "generalized-baseline-complete",
      passed:
        input.baseline.summary.executionFailures === 0 &&
        input.baseline.summary.totalCases === 400 &&
        input.baseline.summary.scale === "100K" &&
        input.baseline.summary.profilesCompared.length === 1 &&
        input.baseline.summary.profilesCompared[0] === "goodmemory-rules-only" &&
        baselineSummary?.totalCases === 400 &&
        baselineSummary.evidenceCaseCount === 355 &&
        typeof baselineSummary.evidenceChatRecall === "number" &&
        Number.isFinite(baselineSummary.evidenceChatRecall) &&
        typeof baselineSummary.missedRecallCases === "number",
    },
  ];
  return { checks, passed: checks.every(({ passed }) => passed) };
}

async function listTypeScriptFiles(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listTypeScriptFiles(
        join(directory, entry.name),
        relativePath,
      ));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }
  return files;
}

async function readTypeScriptSources(
  directory: string,
  paths: readonly string[],
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        await readFile(join(directory, path), "utf8"),
      ] as const),
    ),
  );
}

async function main(argv: readonly string[]): Promise<void> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const auditPath = resolveCliFlagValueStrict(argv, "--audit") ??
    join(root, "scripts/eval-profiles/legacy-fitted/gate-audit.json");
  const baselinePath = resolveCliFlagValueStrict(argv, "--baseline") ??
    join(
      root,
      "reports/eval/research/phase-63/beam/phase68-generalized-baseline-100k/recall-diagnostic.json",
    );
  const outputPath = resolveCliFlagValueStrict(argv, "--output") ??
    join(
      root,
      "reports/quality-gates/phase-68/run-20260709-generalization-boundary/phase-68-quality-gate.json",
    );
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as { files?: string[] };
  const audit = JSON.parse(await readFile(auditPath, "utf8")) as Phase68AuditInput;
  const baseline = JSON.parse(
    await readFile(baselinePath, "utf8"),
  ) as Phase68BaselineInput;
  const productionSelectionSource = await readFile(
    join(root, "src/recall/selection.ts"),
    "utf8",
  );
  const productionRecallDirectory = join(root, "src/recall");
  const productionRecallFiles = await listTypeScriptFiles(
    productionRecallDirectory,
  );
  const result = evaluatePhase68GeneralizationGate({
    audit,
    baseline,
    packageFiles: packageJson.files ?? [],
    productionRecallFiles,
    productionRecallSources: await readTypeScriptSources(
      productionRecallDirectory,
      productionRecallFiles,
    ),
    productionSelectionSource,
  });
  const artifact = {
    ...result,
    audit: {
      path: auditPath.replace(`${root}/`, ""),
      summary: audit.summary,
    },
    baseline: {
      path: baselinePath.replace(`${root}/`, ""),
      summary: baseline.profiles["goodmemory-rules-only"]?.summary,
    },
    generatedAt: new Date().toISOString(),
    phase: "phase-68",
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
  if (!result.passed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main(Bun.argv);
}
