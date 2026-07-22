import { describe, expect, it } from "bun:test";

import { evaluatePhase68GeneralizationGate } from "../../scripts/run-phase-68-generalization-gate";

function passingInput(): Parameters<typeof evaluatePhase68GeneralizationGate>[0] {
  return {
    audit: {
      sourceReports: [
        { runId: "a", scale: "100K" },
        { runId: "b", scale: "500K" },
        { runId: "c", scale: "1M" },
      ],
      summary: {
        caseFitted: 129,
        multiCase: 6,
        totalGates: 148,
        unobserved: 13,
      },
      verdicts: [
        ...Array.from({ length: 129 }, (_, index) => ({
          caseIds: [`100K:q-${index}`],
          gateId: `case.${index}`,
          hitCount: 1,
          status: "case_fitted" as const,
        })),
        ...Array.from({ length: 6 }, (_, index) => ({
          caseIds: [`100K:q-${index}`, `500K:q-${index}`],
          gateId: `multi.${index}`,
          hitCount: 2,
          status: "multi_case" as const,
        })),
        ...Array.from({ length: 13 }, (_, index) => ({
          caseIds: [],
          gateId: `unused.${index}`,
          hitCount: 0,
          status: "unobserved" as const,
        })),
      ],
    },
    baseline: {
      profiles: {
        "goodmemory-rules-only": {
          summary: {
            evidenceCaseCount: 355,
            evidenceChatRecall: 0.16982313070341237,
            missedRecallCases: 332,
            totalCases: 400,
          },
        },
      },
      summary: {
        executionFailures: 0,
        profilesCompared: ["goodmemory-rules-only"],
        scale: "100K",
        totalCases: 400,
      },
    },
    packageFiles: ["dist", "scripts/goodmemory-cli.js"],
    productionRecallFiles: [
      "factSelection/contracts.ts",
      "factSelection/draft.ts",
      "factSelection/generalizedFusionUnion.ts",
      "factSelection/semanticUnion.ts",
      "generalizedSelection.ts",
      "selection.ts",
      "selectors/recordSelection.ts",
      "selectors/selectionContext.ts",
    ],
    productionRecallSources: Object.fromEntries(
      [
        "factSelection/contracts.ts",
        "factSelection/draft.ts",
        "factSelection/generalizedFusionUnion.ts",
        "factSelection/semanticUnion.ts",
        "generalizedSelection.ts",
        "selection.ts",
        "selectors/recordSelection.ts",
        "selectors/selectionContext.ts",
      ].map((path) => [path, "export {};"] as const),
    ),
    productionSelectionSource: "export const selectFacts = generalized;",
  };
}

describe("phase-68 generalization gate", () => {
  it("passes only with complete audit, clean baseline, and isolated package", () => {
    const result = evaluatePhase68GeneralizationGate(passingInput());

    expect(result.passed).toBe(true);
    expect(result.checks.every(({ passed }) => passed)).toBe(true);
  });

  it("fails when production imports legacy selection", () => {
    const result = evaluatePhase68GeneralizationGate({
      audit: {
        sourceReports: [],
        summary: { caseFitted: 0, multiCase: 0, totalGates: 0, unobserved: 0 },
        verdicts: [],
      },
      baseline: {
        profiles: {},
        summary: {
          executionFailures: 1,
          profilesCompared: [],
          scale: "100K",
          totalCases: 0,
        },
      },
      packageFiles: ["src"],
      productionRecallFiles: ["selectionLegacy.ts"],
      productionRecallSources: {
        "selectionLegacy.ts": "import './selectionLegacy';",
      },
      productionSelectionSource: "import './selectionLegacy';",
    });

    expect(result.passed).toBe(false);
  });

  it("rejects duplicate gate ids, incomplete package exclusions, and legacy imports", () => {
    const duplicateGateIds = passingInput();
    duplicateGateIds.audit.verdicts = duplicateGateIds.audit.verdicts.map(
      (verdict) => ({ ...verdict, gateId: "duplicate.gate" }),
    );

    const nestedSourcePath = passingInput();
    nestedSourcePath.packageFiles.push("src/internal");

    const legacyRouteImport = passingInput();
    legacyRouteImport.productionSelectionSource =
      "import { FACT_SELECTION_ROUTE_TABLE } from './factSelection/routeTable';";

    const duplicateScale = passingInput();
    duplicateScale.audit.sourceReports.push({ runId: "d", scale: "100K" });

    const fittedSource = passingInput();
    fittedSource.productionRecallFiles.push(
      "selectors/sourceOrderRules/case-specific.ts",
    );
    fittedSource.productionRecallSources[
      "selectors/sourceOrderRules/case-specific.ts"
    ] = "export {};";

    const evalOnlyProbeInProduction = passingInput();
    evalOnlyProbeInProduction.productionRecallFiles.push(
      "factSelection/entityUnion.ts",
    );
    evalOnlyProbeInProduction.productionRecallSources[
      "factSelection/entityUnion.ts"
    ] = "export {};";

    for (const input of [
      duplicateGateIds,
      nestedSourcePath,
      legacyRouteImport,
      duplicateScale,
      evalOnlyProbeInProduction,
      fittedSource,
    ]) {
      expect(evaluatePhase68GeneralizationGate(input).passed).toBe(false);
    }
  });

  it("rejects benchmark identities embedded in production recall source", () => {
    for (const identity of [
      "BEAM",
      "external_benchmark",
      "ImplicitMemBench",
      "LoCoMo",
      "LongMemEval",
      "MemoryAgentBench",
    ]) {
      const value = passingInput();
      value.productionRecallSources["selectors/selectionContext.ts"] =
        `const benchmark = ${JSON.stringify(identity)};`;

      expect(evaluatePhase68GeneralizationGate(value).passed).toBe(false);
    }
  });
});
