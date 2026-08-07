import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPreferenceIdentityProviderAttemptCount,
  buildPreferenceIdentityCallPlan,
  buildPreferenceIdentityCostDisclosure,
  buildPreferenceIdentityEffectivePromptIdentity,
  buildPreferenceIdentityFingerprintArtifact,
  buildPreferenceIdentityInputPlanIdentity,
  buildPreferenceIdentityPrompt,
  fingerprintPreferenceIdentityCallInput,
  fingerprintPreferenceIdentityRawPayload,
  loadPreferenceIdentityManifest,
  loadPreferenceIdentityProtectionCohort,
  loadPreferenceIdentityPreregistration,
  parsePreferenceIdentityRawCompletion,
  reservePreferenceIdentityRunDirectory,
  runPreferenceIdentityRulesOnlyBaseline,
  summarizePreferenceIdentityRows,
  type PreferenceIdentityExperimentRow,
  type PreferenceIdentityPreregistration,
  writePreferenceIdentityRawCall,
  writePreferenceIdentityRawResults,
} from "../../scripts/run-preference-identity-stability";
import {
  loadPreferenceConflictSyntheticCohort,
  loadPreferenceConflictCensusPreregistration,
  PREFERENCE_CONFLICT_AGGREGATE_REPORT_PATH,
  runPreferenceFixtureCensus,
  runPreferenceConflictAnalysisCli,
  simulatePreferenceConflictPolicies,
} from "../../scripts/analyze-preference-conflicts";
import { resolveRepoRootFromScriptUrl } from "../../scripts/script-paths";

const REPO_ROOT = join(resolveRepoRootFromScriptUrl(import.meta.url), "..");

function buildPerfectRows(
  plan: ReturnType<typeof buildPreferenceIdentityCallPlan>,
  preregistration: PreferenceIdentityPreregistration,
): PreferenceIdentityExperimentRow[] {
  return plan.map((call) => ({
    ...call,
    candidates: call.expectedAtoms.map((atom) => ({
      context: call.context,
      key: call.arm === "open-key"
        ? atom.slot
        : preregistration.closedVocabulary.includes(atom.slot)
        ? atom.slot
        : "other",
      value: atom.value,
    })),
    executionStatus: "succeeded",
    rawOutputAvailable: true,
    rawFingerprint: call.inputFingerprint,
  }));
}

describe("preference identity pre-API research protocol", () => {
  it("freezes 20 atomic and 10 compound groups with six bilingual context variants", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);

    expect(manifest.groups).toHaveLength(30);
    const atomicGroups = manifest.groups.filter(({ kind }) => kind === "atomic");
    expect(atomicGroups).toHaveLength(20);
    expect(
      atomicGroups.every(({ expectedAtoms }) => expectedAtoms.length === 1),
    ).toBe(true);
    const compoundGroups = manifest.groups.filter(
      ({ kind }) => kind === "compound",
    );
    expect(compoundGroups).toHaveLength(10);
    expect(
      compoundGroups.every(
        ({ expectedAtoms }) =>
          expectedAtoms.length >= 2 && expectedAtoms.length <= 3,
      ),
    ).toBe(true);
    expect(
      compoundGroups.some(({ expectedAtoms }) => expectedAtoms.length === 3),
    ).toBe(true);
    expect(manifest.groups.every(({ variants }) => variants.length === 6)).toBe(true);

    for (const group of manifest.groups) {
      expect(new Set(group.variants.map(({ locale }) => locale))).toEqual(
        new Set(["en-US", "zh-CN"]),
      );
      expect(new Set(group.variants.map(({ context }) => context))).toEqual(
        new Set(["general", "personal_study", "work"]),
      );
    }

    expect(preregistration.repetitions).toBe(2);
    expect(preregistration.comparisonMode).toBe("independent-prompt-arms");
    expect(preregistration.plannedTotalCalls).toBe(720);
    expect(preregistration.plannedProviderAttempts).toBe(720);
    expect(preregistration.model.retryLimit).toBe(0);
    expect(protectionCohort.variantIds).toHaveLength(90);
    expect(preregistration.protectionCohort.variantCount).toBe(90);
    expect(preregistration.protectionCohort.plannedCallsPerArm).toBe(180);
    expect(preregistration.protectionCohort.plannedTotalCalls).toBe(360);
    expect(preregistration.protectionCohort.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const protectedVariants = manifest.groups.flatMap(({ variants }) =>
      variants.filter(({ variantId }) =>
        protectionCohort.variantIds.includes(variantId)
      )
    );
    expect(protectedVariants).toHaveLength(90);
    expect(
      Object.fromEntries(
        ["en-US", "zh-CN"].map((locale) => [
          locale,
          protectedVariants.filter((variant) => variant.locale === locale).length,
        ]),
      ),
    ).toEqual({ "en-US": 45, "zh-CN": 45 });
    expect(
      Object.fromEntries(
        ["general", "personal_study", "work"].map((context) => [
          context,
          protectedVariants.filter((variant) => variant.context === context).length,
        ]),
      ),
    ).toEqual({ general: 30, personal_study: 30, work: 30 });
    expect(
      Object.fromEntries(
        ["atomic", "compound"].map((kind) => [
          kind,
          manifest.groups
            .filter((group) => group.kind === kind)
            .flatMap(({ variants }) => variants)
            .filter(({ variantId }) =>
              protectionCohort.variantIds.includes(variantId)
            ).length,
        ]),
      ),
    ).toEqual({ atomic: 60, compound: 30 });
    expect(new Set(preregistration.valueVocabulary)).toEqual(
      new Set(
        manifest.groups.flatMap(({ expectedAtoms }) =>
          expectedAtoms.map(({ value }) => value)
        ),
      ),
    );
    expect(preregistration.closedVocabulary.at(-1)).toBe("other");
    expect(preregistration.otherConflictMatchable).toBe(false);
    expect(preregistration.otherStorageSemantics).toEqual({
      conflictMatchable: false,
      rejectWrite: false,
      storedAndFlagged: true,
    });
    expect(preregistration.outputEvidence.trackableArtifacts).toEqual([
      "report.json",
      "raw-fingerprints.json",
    ]);
    expect(preregistration.outputEvidence.untrackedRawPayload).toBe(
      "raw-results.jsonl",
    );
    expect(preregistration.outputEvidence.untrackedRawPayloadPersisted).toBe(true);
    expect(preregistration.outputEvidence.untrackedPerCallRawDirectory).toBe(
      "raw-calls",
    );
    expect(preregistration.outputEvidence.perCallRawPersistence).toBe(
      "immediate-wx",
    );
    expect(preregistration.outputEvidence.rulesOnlyRowsPersisted).toBe(false);
    expect(preregistration.outputEvidence).toMatchObject({
      fixedRunId: "preference-independent-arms-v1",
      fixedRunPath:
        "reports/eval/research/preference-identity/preference-independent-arms-v1",
      liveRequiresCleanGit: true,
    });
    expect(preregistration.goldUsage).toEqual({
      expectedAtoms: "offline-scoring-only",
      promptValueVocabularyExposed: false,
      providerInputFingerprintsExcludeExpectedAtoms: true,
    });
  });

  it("binds both isolated effective prompts and the exact 720-call input plan", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const calls = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });

    const inputPlan = buildPreferenceIdentityInputPlanIdentity(calls);
    expect(inputPlan.count).toBe(720);
    expect(inputPlan.aggregateSha256).toBe(
      preregistration.inputPlan.aggregateSha256,
    );
    expect(preregistration.inputPlan.goldExpectedAtomsIncluded).toBe(false);
    const effectivePrompt = buildPreferenceIdentityEffectivePromptIdentity({
      calls,
      preregistration,
    });
    expect(effectivePrompt).toEqual(preregistration.effectivePrompt);
    expect(effectivePrompt.arms.openKey.customPromptsSha256).not.toBe(
      effectivePrompt.arms.closedKey.customPromptsSha256,
    );
    expect(effectivePrompt.arms.openKey.schemaSha256).not.toBe(
      effectivePrompt.arms.closedKey.schemaSha256,
    );

    const promptDrift = buildPreferenceIdentityEffectivePromptIdentity({
      calls,
      preregistration,
      promptBuilder: (input) =>
        `${buildPreferenceIdentityPrompt(input)}\nUNREGISTERED PROMPT CHANGE`,
    });
    expect(promptDrift.aggregateSha256).not.toBe(
      preregistration.effectivePrompt.aggregateSha256,
    );
    const systemDrift = buildPreferenceIdentityEffectivePromptIdentity({
      calls,
      preregistration,
      system: `${effectivePrompt.arms.openKey.system}\nUNREGISTERED SYSTEM CHANGE`,
    });
    expect(systemDrift.aggregateSha256).not.toBe(
      preregistration.effectivePrompt.aggregateSha256,
    );
    const schemaDrift = buildPreferenceIdentityEffectivePromptIdentity({
      calls,
      preregistration,
      schemaJson: { properties: {}, type: "object" },
    });
    expect(schemaDrift.aggregateSha256).not.toBe(
      preregistration.effectivePrompt.aggregateSha256,
    );

    const driftedCalls = structuredClone(calls);
    driftedCalls[0]!.text += " input drift";
    expect(() => buildPreferenceIdentityInputPlanIdentity(driftedCalls)).toThrow(
      "input fingerprint mismatch",
    );
    driftedCalls[0]!.inputFingerprint =
      fingerprintPreferenceIdentityCallInput(driftedCalls[0]!);
    expect(
      buildPreferenceIdentityInputPlanIdentity(driftedCalls).aggregateSha256,
    ).not.toBe(preregistration.inputPlan.aggregateSha256);

    const goldOnlyDrift = structuredClone(calls);
    goldOnlyDrift[0]!.expectedAtoms[0]!.value = "offline-gold-drift";
    expect(
      fingerprintPreferenceIdentityCallInput(goldOnlyDrift[0]!),
    ).toBe(calls[0]!.inputFingerprint);
    expect(
      buildPreferenceIdentityInputPlanIdentity(goldOnlyDrift).aggregateSha256,
    ).toBe(preregistration.inputPlan.aggregateSha256);

    expect(() =>
      assertPreferenceIdentityProviderAttemptCount({
        actual: 720,
        planned: preregistration.plannedProviderAttempts,
      })
    ).not.toThrow();
    expect(() =>
      assertPreferenceIdentityProviderAttemptCount({
        actual: 721,
        planned: preregistration.plannedProviderAttempts,
      })
    ).toThrow("expected exactly 720 provider attempts");
  });

  it("plans two complete isolated arms without cross-key prompt exposure", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const calls = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });

    expect(calls).toHaveLength(720);
    expect(new Set(calls.map(({ repetition }) => repetition))).toEqual(
      new Set([1, 2]),
    );
    expect(new Set(calls.map(({ callId }) => callId)).size).toBe(720);
    expect(calls.filter(({ arm }) => arm === "open-key")).toHaveLength(360);
    expect(calls.filter(({ arm }) => arm === "closed-key")).toHaveLength(360);
    expect(calls.filter(({ cohort }) => cohort === "protection")).toHaveLength(
      360,
    );
    expect(calls.filter(({ cohort }) => cohort === "development")).toHaveLength(
      360,
    );

    const openPrompt = buildPreferenceIdentityPrompt({
      arm: "open-key",
      text: calls[0]!.text,
    });
    expect(openPrompt).toContain("experimentalOpenPreferenceKey");
    expect(openPrompt).not.toContain("experimentalClosedPreferenceKey");
    expect(openPrompt).not.toContain("response.verbosity");
    expect(openPrompt).not.toContain("Use other");
    const closedPrompt = buildPreferenceIdentityPrompt({
      arm: "closed-key",
      closedVocabulary: preregistration.closedVocabulary,
      text: calls[0]!.text,
    });
    expect(closedPrompt).toContain("experimentalClosedPreferenceKey");
    expect(closedPrompt).not.toContain("experimentalOpenPreferenceKey");
    expect(closedPrompt).toContain("response.verbosity");
    expect(openPrompt).not.toContain("milestone_only");
    expect(closedPrompt).not.toContain("milestone_only");
    expect(openPrompt).not.toContain("canonical value from");
    expect(closedPrompt).not.toContain("canonical value from");
  });

  it("computes fingerprints and blocks a key protocol when repetitions disagree", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });
    const rows = buildPerfectRows(plan, preregistration);

    const accepted = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows,
    });
    expect(accepted.decisionBasis).toBe("protection");
    expect(accepted.recommendation).toBe("open-key");
    for (const summary of [
      accepted.protection.openKey,
      accepted.protection.closedKey,
    ]) {
      expect(summary.decision).toBe("accepted");
      expect(summary.metrics.executionFailureCount).toBe(0);
      expect(summary.metrics.preferenceCaptureRate).toBe(1);
      expect(summary.metrics.compoundAtomicizationPrecision).toBe(1);
      expect(summary.metrics.compoundAtomicizationRecall).toBe(1);
      expect(summary.metrics.paraphraseExactKeySetAgreement).toBe(1);
      expect(summary.metrics.repeatConsistency).toBe(1);
      expect(summary.metrics.atomicizationPrecision).toBe(1);
      expect(summary.metrics.atomicizationRecall).toBe(1);
      expect(summary.metrics.contextAgreement).toBe(1);
      expect(summary.metrics.parseOrMissingKeyCount).toBe(0);
      expect(summary.metrics.unintendedCrossDimensionCollisionCount).toBe(0);
    }
    expect(accepted.overall.closedKey.otherDistribution).toEqual({
      candidateCount: 48,
      contexts: {
        general: 16,
        personal_study: 16,
        work: 16,
      },
      groupIds: [
        "atomic-decision-verbal",
        "atomic-decision-written",
        "compound-checkins-verbal",
        "compound-deep-written",
      ],
      rate: 4 / 41,
    });

    const invalidClosedKeyRows = structuredClone(rows);
    invalidClosedKeyRows.find(({ arm }) => arm === "closed-key")!
      .candidates[0]!.key = "response.unregistered";
    const invalidClosedKey = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows: invalidClosedKeyRows,
    });
    expect(invalidClosedKey.protection.openKey.decision).toBe("accepted");
    expect(invalidClosedKey.protection.closedKey.decision).toBe("blocked");
    expect(
      invalidClosedKey.protection.closedKey.metrics.parseOrMissingKeyCount,
    ).toBe(1);
    expect(invalidClosedKey.protection.closedKey.failedGates).toContain(
      "parseOrMissingKeyCount",
    );

    const parseFailureRows = structuredClone(rows);
    const failedOpenRow = parseFailureRows.find(
      ({ arm }) => arm === "open-key",
    )!;
    failedOpenRow.candidates = [];
    failedOpenRow.executionStatus = "failed";
    failedOpenRow.parseFailureCount = 1;
    const parseFailure = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows: parseFailureRows,
    });
    expect(
      parseFailure.protection.openKey.metrics.parseOrMissingKeyCount,
    ).toBe(1);
    expect(parseFailure.protection.openKey.failedGates).toContain(
      "parseOrMissingKeyCount",
    );

    for (const row of rows
      .filter(
        ({ arm, cohort, repetition }) =>
          arm === "open-key" &&
          cohort === "protection" &&
          repetition === 2,
      )
      .slice(0, 3)) {
      row.candidates[0]!.key = "response.layout";
    }
    const blocked = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows,
    });
    expect(blocked.protection.openKey.decision).toBe("blocked");
    expect(blocked.protection.openKey.failedGates).toContain(
      "repeatConsistency",
    );
    expect(blocked.protection.closedKey.decision).toBe("accepted");
    expect(blocked.recommendation).toBe("closed-key");
  });

  it("uses frozen slots rather than a modal key learned from protection rows", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });
    const rows = buildPerfectRows(plan, preregistration);
    for (const row of rows.filter(
      ({ arm, cohort }) => arm === "open-key" && cohort === "protection",
    )) {
      for (const candidate of row.candidates) {
        candidate.key = `stable-but-wrong.${candidate.key}`;
      }
    }

    const result = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows,
    });

    expect(result.protection.openKey.metrics.repeatConsistency).toBe(1);
    expect(result.protection.openKey.metrics.atomicizationRecall).toBe(0);
    expect(result.protection.openKey.decision).toBe("blocked");
    expect(result.protection.closedKey.decision).toBe("accepted");
    expect(result.recommendation).toBe("closed-key");
  });

  it("scores every experimental key byte-exact without hiding format drift", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });
    const formatDrifts = [
      (key: string) => key.toUpperCase(),
      (key: string) => key.replaceAll(".", "-"),
      (key: string) => ` ${key}`,
      (key: string) => key.replaceAll(".", ".."),
    ];

    for (const drift of formatDrifts) {
      const exactRows = buildPerfectRows(plan, preregistration);
      for (const row of exactRows.filter(
        ({ arm, cohort }) => arm === "open-key" && cohort === "protection",
      )) {
        for (const candidate of row.candidates) {
          candidate.key = drift(candidate.key);
        }
      }
      const exact = summarizePreferenceIdentityRows({
        manifest,
        preregistration,
        rows: exactRows,
      });
      expect(exact.protection.openKey.metrics.atomicizationRecall).toBe(0);
      expect(
        exact.protection.openKey.metrics.paraphraseExactKeySetAgreement,
      ).toBe(0);
      expect(exact.protection.openKey.decision).toBe("blocked");

      const repeatRows = buildPerfectRows(plan, preregistration);
      for (const row of repeatRows.filter(
        ({ arm, cohort, repetition }) =>
          arm === "open-key" &&
          cohort === "protection" &&
          repetition === 2,
      )) {
        for (const candidate of row.candidates) {
          candidate.key = drift(candidate.key);
        }
      }
      const repeat = summarizePreferenceIdentityRows({
        manifest,
        preregistration,
        rows: repeatRows,
      });
      expect(repeat.protection.openKey.metrics.repeatConsistency).toBe(0);

      const closedRows = buildPerfectRows(plan, preregistration);
      const closedRow = closedRows.find(
        ({ arm, cohort }) =>
          arm === "closed-key" && cohort === "protection",
      )!;
      closedRow.candidates[0]!.key = drift(closedRow.candidates[0]!.key);
      const closed = summarizePreferenceIdentityRows({
        manifest,
        preregistration,
        rows: closedRows,
      });
      expect(
        closed.protection.closedKey.metrics.parseOrMissingKeyCount,
      ).toBe(1);
      expect(closed.protection.closedKey.decision).toBe("blocked");
    }

    const collisionRows = buildPerfectRows(plan, preregistration);
    for (const row of collisionRows.filter(
      ({ arm, cohort }) => arm === "open-key" && cohort === "protection",
    )) {
      row.candidates.forEach((candidate) => {
        if (candidate.key === "response.layout") {
          candidate.key = "response-verbosity";
        }
      });
    }
    const collision = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows: collisionRows,
    });
    expect(
      collision.protection.openKey.metrics
        .unintendedCrossDimensionCollisionCount,
    ).toBe(0);
    expect(collision.protection.openKey.decision).toBe("blocked");
  });

  it("rejects equal candidate counts when frozen dimensions or values are wrong", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });
    const rows = buildPerfectRows(plan, preregistration);
    for (const arm of ["open-key", "closed-key"] as const) {
      for (const row of rows
        .filter(({ arm: rowArm, cohort }) =>
          rowArm === arm && cohort === "protection"
        )
        .slice(0, 24)) {
        row.candidates[0] = {
          ...row.candidates[0]!,
          key: "response.layout",
          value: "wrong_value",
        };
      }
    }

    const result = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows,
    });

    expect(rows.reduce((sum, row) => sum + row.candidates.length, 0)).toBe(984);
    expect(
      result.protection.openKey.metrics.atomicizationPrecision,
    ).toBeLessThan(0.95);
    expect(result.protection.openKey.metrics.atomicizationRecall).toBeLessThan(
      0.95,
    );
    expect(result.protection.openKey.decision).toBe("blocked");
    expect(result.protection.closedKey.decision).toBe("blocked");
    expect(result.recommendation).toBe("no-api");
  });

  it("does not let development or overall failures change protection decisions", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });
    const rows = buildPerfectRows(plan, preregistration);
    for (const arm of ["open-key", "closed-key"] as const) {
      for (const row of rows
        .filter(({ arm: rowArm, cohort }) =>
          rowArm === arm && cohort === "development"
        )
        .slice(0, 30)) {
        row.candidates[0] = {
          ...row.candidates[0]!,
          key: "response.layout",
          value: "wrong_value",
        };
      }
    }

    const result = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows,
    });

    expect(result.development.openKey.metrics.atomicizationRecall).toBeLessThan(
      0.95,
    );
    expect(result.overall.openKey.metrics.atomicizationRecall).toBeLessThan(
      0.95,
    );
    expect("decision" in result.development.openKey).toBe(false);
    expect("decision" in result.overall.openKey).toBe(false);
    expect(result.protection.openKey.decision).toBe("accepted");
    expect(result.recommendation).toBe("open-key");
  });

  it("requires the frozen context in one-to-one assisted atom matching", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });
    const rows = buildPerfectRows(plan, preregistration);
    for (const arm of ["open-key", "closed-key"] as const) {
      for (const row of rows
        .filter(({ arm: rowArm, cohort }) =>
          rowArm === arm && cohort === "protection"
        )
        .slice(0, 24)) {
        row.candidates[0]!.context = row.context === "work" ? "general" : "work";
      }
    }

    const result = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows,
    });

    expect(result.protection.openKey.metrics.contextAgreement).toBeLessThan(
      0.95,
    );
    expect(result.protection.openKey.metrics.atomicizationRecall).toBeLessThan(
      0.95,
    );
    expect(result.protection.openKey.decision).toBe("blocked");
    expect(result.protection.closedKey.decision).toBe("blocked");
  });

  it("detects cross-dimension extras in compound rows", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const preregistration = await loadPreferenceIdentityPreregistration(REPO_ROOT);
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: preregistration.repetitions,
    });
    const rows = buildPerfectRows(plan, preregistration);
    for (const arm of ["open-key", "closed-key"] as const) {
      const compoundRow = rows.find(
        ({ arm: rowArm, cohort, groupKind }) =>
          rowArm === arm &&
          cohort === "protection" &&
          groupKind === "compound",
      )!;
      compoundRow.candidates.push({
        context: compoundRow.context,
        key: "response.verbosity",
        value: "bullets",
      });
    }

    const result = summarizePreferenceIdentityRows({
      manifest,
      preregistration,
      rows,
    });

    expect(
      result.protection.openKey.metrics
        .unintendedCrossDimensionCollisionCount,
    ).toBeGreaterThan(0);
    expect(
      result.protection.closedKey.metrics
        .unintendedCrossDimensionCollisionCount,
    ).toBeGreaterThan(0);
    expect(result.protection.openKey.failedGates).toContain(
      "unintendedCrossDimensionCollisionCount",
    );
    expect(result.protection.closedKey.failedGates).toContain(
      "unintendedCrossDimensionCollisionCount",
    );
  });

  it("writes one ignored raw completion per arm call and binds arm plus call ID", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const plan = buildPreferenceIdentityCallPlan({
      manifest,
      protectionCohort,
      repetitions: 2,
    });
    const rows: PreferenceIdentityExperimentRow[] = plan.map((call) => {
      const rawPayload = JSON.stringify({
        candidates: [],
        ignoredMessageCount: call.repetition - 1,
      });
      return {
        ...call,
        candidates: [],
        executionStatus: "succeeded",
        rawOutputAvailable: true,
        rawFingerprint: fingerprintPreferenceIdentityRawPayload(rawPayload),
        rawPayload,
      };
    });
    const parseFailurePayload = "not-json-but-preserved";
    rows[1] = {
      ...rows[1]!,
      executionStatus: "failed",
      parseFailureCount: 1,
      rawFingerprint: fingerprintPreferenceIdentityRawPayload(
        parseFailurePayload,
      ),
      rawOutputAvailable: true,
      rawPayload: parseFailurePayload,
    };
    const transportFailurePayload = {
      errorName: "TypeError",
      status: "transport-failed",
    };
    rows[2] = {
      ...rows[2]!,
      executionStatus: "failed",
      parseFailureCount: 0,
      rawFingerprint: fingerprintPreferenceIdentityRawPayload(
        transportFailurePayload,
      ),
      rawOutputAvailable: false,
      rawPayload: transportFailurePayload,
    };

    const artifact = buildPreferenceIdentityFingerprintArtifact(rows);

    expect(artifact.count).toBe(720);
    expect(artifact.aggregateSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.inputCount).toBe(720);
    expect(artifact.inputAggregateSha256).toBe(
      buildPreferenceIdentityInputPlanIdentity(plan).aggregateSha256,
    );
    expect(artifact.rows[0]).toEqual({
      arm: rows[0]!.arm,
      callId: rows[0]!.callId,
      rawFingerprint: rows[0]!.rawFingerprint,
    });
    expect(Object.keys(artifact.rows[0]!)).toEqual([
      "arm",
      "callId",
      "rawFingerprint",
    ]);

    const tempDirectory = await mkdtemp(
      join(tmpdir(), "goodmemory-preference-raw-"),
    );
    try {
      const outputPath = join(tempDirectory, "raw-results.jsonl");
      const written = await writePreferenceIdentityRawResults({
        outputPath,
        rows,
      });
      const records = (await readFile(outputPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(written.count).toBe(720);
      expect(records).toHaveLength(720);
      expect(records[0]).toEqual({
        arm: rows[0]!.arm,
        callId: rows[0]!.callId,
        executionStatus: "succeeded",
        missingKeyCount: 0,
        parseFailureCount: 0,
        rawOutputAvailable: true,
        rawFingerprint: rows[0]!.rawFingerprint,
        rawPayload: rows[0]!.rawPayload,
      });
      expect(records[0]!.rawFingerprint).toBe(
        createHash("sha256")
          .update(JSON.stringify(records[0]!.rawPayload))
          .digest("hex"),
      );
      expect(records[1]).toMatchObject({
        parseFailureCount: 1,
        rawOutputAvailable: true,
        rawPayload: parseFailurePayload,
      });
      expect(records[2]).toMatchObject({
        parseFailureCount: 0,
        rawOutputAvailable: false,
        rawPayload: transportFailurePayload,
      });
      await expect(
        writePreferenceIdentityRawResults({ outputPath, rows }),
      ).rejects.toThrow();
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }

    const gitignore = await readFile(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain(
      "!reports/eval/research/preference-identity/preference-independent-arms-v1/report.json",
    );
    expect(gitignore).toContain(
      "!reports/eval/research/preference-identity/preference-independent-arms-v1/raw-fingerprints.json",
    );
    expect(gitignore).not.toContain(
      "!reports/eval/research/preference-identity/preference-independent-arms-v1/raw-results.jsonl",
    );
    expect(gitignore).not.toContain(
      "!reports/eval/research/preference-identity/preference-independent-arms-v1/raw-calls",
    );
  });

  it("parses raw completions in the selected arm without accepting opposite-arm keys", () => {
    const completion = (attributes: Record<string, string>) => JSON.stringify({
      candidates: [{
        content: "The user prefers concise answers.",
        explicitness: "explicit",
        id: "p1",
        kindHint: "preference",
        metadata: {
          appliesTo: "general",
          attributes,
          preferenceValue: "concise",
        },
        sourceMessageIndex: 0,
        sourceRole: "user",
      }],
      ignoredMessageCount: 0,
    });

    expect(
      parsePreferenceIdentityRawCompletion({
        arm: "open-key",
        text: `<think>hidden</think>\n${completion({
          experimentalOpenPreferenceKey: "response.verbosity",
        })}`,
      }).candidates[0]?.metadata?.attributes,
    ).toEqual({ experimentalOpenPreferenceKey: "response.verbosity" });
    expect(
      parsePreferenceIdentityRawCompletion({
        arm: "closed-key",
        text: completion({
          experimentalClosedPreferenceKey: "response.verbosity",
        }),
      }).candidates[0]?.metadata?.attributes,
    ).toEqual({ experimentalClosedPreferenceKey: "response.verbosity" });
    expect(() =>
      parsePreferenceIdentityRawCompletion({
        arm: "open-key",
        text: completion({
          experimentalClosedPreferenceKey: "response.verbosity",
          experimentalOpenPreferenceKey: "response.verbosity",
        }),
      })
    ).toThrow("opposite-arm key");
    expect(() =>
      parsePreferenceIdentityRawCompletion({
        arm: "closed-key",
        text: completion({
          experimentalClosedPreferenceKey: "response.verbosity",
          experimentalOpenPreferenceKey: "response.verbosity",
        }),
      })
    ).toThrow("opposite-arm key");
    expect(() =>
      parsePreferenceIdentityRawCompletion({
        arm: "open-key",
        text: "not-json-but-must-remain-persistable",
      })
    ).toThrow("did not contain a JSON object");
  });

  it("reserves the fixed run directory once and discloses unpriced token usage honestly", async () => {
    const tempDirectory = await mkdtemp(
      join(tmpdir(), "goodmemory-preference-run-"),
    );
    const runDirectory = join(tempDirectory, "fixed", "run");
    try {
      await reservePreferenceIdentityRunDirectory(runDirectory);
      const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
      const protectionCohort = await loadPreferenceIdentityProtectionCohort(
        REPO_ROOT,
      );
      const call = buildPreferenceIdentityCallPlan({
        manifest,
        protectionCohort,
        repetitions: 2,
      })[0]!;
      const rawPayload = "first-completed-raw-response";
      const row: PreferenceIdentityExperimentRow = {
        ...call,
        candidates: [],
        executionStatus: "succeeded",
        rawFingerprint: fingerprintPreferenceIdentityRawPayload(rawPayload),
        rawOutputAvailable: true,
        rawPayload,
      };
      const persisted = await writePreferenceIdentityRawCall({
        row,
        runDirectory,
      });
      expect(persisted.relativePath).toStartWith("raw-calls/");
      expect(persisted.relativePath).not.toContain(":");
      expect(await readdir(join(runDirectory, "raw-calls"))).toHaveLength(1);
      expect(
        JSON.parse(await readFile(join(runDirectory, persisted.relativePath), "utf8")),
      ).toMatchObject({
        arm: row.arm,
        callId: row.callId,
        rawOutputAvailable: true,
        rawPayload,
      });
      await expect(
        writePreferenceIdentityRawCall({ row, runDirectory }),
      ).rejects.toThrow();
      try {
        throw new Error("simulated process interruption");
      } catch {
        expect(await readdir(join(runDirectory, "raw-calls"))).toHaveLength(1);
      }
      await expect(
        reservePreferenceIdentityRunDirectory(runDirectory),
      ).rejects.toThrow();
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }

    expect(buildPreferenceIdentityCostDisclosure()).toEqual({
      estimatedUsd: null,
      providerBilledUsd: null,
      reason:
        "No frozen verifiable gpt-5.6-terra/Gurki tariff is registered; token usage is reported without inventing a price.",
    });
  });

  it("records a same-input rules-only LanguagePack baseline without treating it as an assisted arm", async () => {
    const manifest = await loadPreferenceIdentityManifest(REPO_ROOT);
    const protectionCohort = await loadPreferenceIdentityProtectionCohort(
      REPO_ROOT,
    );
    const baseline = await runPreferenceIdentityRulesOnlyBaseline({
      manifest,
      protectionCohort,
    });

    expect(baseline.rows).toHaveLength(180);
    expect(baseline.summary.overall.variantCount).toBe(180);
    expect(baseline.summary.protection.variantCount).toBe(90);
    expect(baseline.summary.development.variantCount).toBe(90);
    expect(baseline.summary.overall.preferenceCandidateCount).toBe(60);
    expect(baseline.summary.overall.preferenceCaptureRate).toBe(1 / 3);
    expect(baseline.summary.overall.atomicizationPrecision).toBe(0);
    expect(baseline.summary.overall.atomicizationRecall).toBe(0);
    expect(baseline.summary.overall.compoundAtomicizationPrecision).toBe(0);
    expect(baseline.summary.overall.compoundAtomicizationRecall).toBe(0);
    expect(
      baseline.rows.filter(({ groupKind }) => groupKind === "compound"),
    ).toHaveLength(60);
    expect(
      baseline.rows.filter(
        ({ groupKind, expectedAtoms }) =>
          groupKind === "compound" && expectedAtoms.length === 3,
      ),
    ).toHaveLength(6);
    expect(baseline.summary.rowFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe("preference conflict fixture census and policy simulation", () => {
  it("loads and validates the frozen census while reporting unavailable identity metrics", async () => {
    const preregistration = await loadPreferenceConflictCensusPreregistration(
      REPO_ROOT,
    );
    const census = await runPreferenceFixtureCensus(REPO_ROOT);

    expect(preregistration.corpus.evalScenarios.expectedFileCount).toBe(46);
    expect(preregistration.corpus.evalScenarios.expectedUserTurnCount).toBe(335);
    expect(preregistration.corpus.behaviorScenarios.expectedScenarioCount).toBe(6);
    expect(preregistration.corpus.behaviorScenarios.expectedUserTurnCount).toBe(16);
    expect(preregistration.outputEvidence).toEqual({
      aggregateReportPath:
        "reports/eval/research/preference-identity/fixture-census/current/report.json",
      gitProvenanceRequired: true,
      rawCorpusTrackable: false,
    });
    expect(census.corpus.scenarioFileCount).toBe(46);
    expect(census.corpus.userTurnCount).toBe(335);
    expect(census.corpus.behaviorScenarioCount).toBe(6);
    expect(census.corpus.behaviorUserTurnCount).toBe(16);
    expect(census.rulesOnly.preferenceCandidateCount).toBe(44);
    expect(census.rulesOnly.behaviorPreferenceCandidateCount).toBe(1);
    expect(census.rulesOnly.legacyCategoryValueChangeCount).toBe(0);
    expect(census.preregistrationSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(census.identityMetrics).toEqual({
      ambiguousConflictCount: null,
      ambiguousConflictRate: null,
      recencyAppropriateCount: null,
      recencyAppropriateRate: null,
      sameSlotChangeCount: null,
      unavailableReason:
        "Current rules-only records expose legacy categories, not frozen identity slots.",
    });
    expect(census.decision).toEqual({
      adjudicationApiAllowed: false,
      minimumNaturalSameSlotChanges: 20,
      observedLegacyCategoryValueChanges: 0,
      reason:
        "Same-slot, recency-appropriateness, and ambiguity metrics are unavailable; the fixture corpus cannot admit an adjudication API.",
      status: "underpowered_no_adjudication",
    });
    expect(census.scope).toBe("repository_fixture_census_only");
    expect(census.productionIncidenceClaimed).toBe(false);

    const aggregate = await runPreferenceConflictAnalysisCli();
    expect(aggregate.git.commit).toMatch(/^[a-f0-9]{40}$/u);
    expect(typeof aggregate.git.dirty).toBe("boolean");
    expect(PREFERENCE_CONFLICT_AGGREGATE_REPORT_PATH).toBe(
      "reports/eval/research/preference-identity/fixture-census/current/report.json",
    );
    await expect(
      runPreferenceConflictAnalysisCli({
        outputDir: "reports/eval/research/preference-identity/not-fixed",
      }),
    ).rejects.toThrow("fixed aggregate report path");

    const gitignore = await readFile(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain(
      "!reports/eval/research/preference-identity/fixture-census/current/report.json",
    );
    expect(gitignore).not.toContain(
      "!reports/eval/research/preference-identity/fixture-census/current/raw",
    );
  });

  it("compares destructive, recency-lineage, and freeze policies on a balanced synthetic cohort", async () => {
    const cohort = await loadPreferenceConflictSyntheticCohort(REPO_ROOT);
    const report = simulatePreferenceConflictPolicies(cohort);

    expect(cohort.cases).toHaveLength(30);
    expect(report.cohortCounts).toEqual({
      compound_partial_update: 5,
      contextual_coexistence: 5,
      explicit_update: 5,
      legacy_unkeyed: 5,
      same_category_different_dimension: 5,
      synonymous_repeat: 5,
    });
    expect(report.cohortFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      cohort.cases
        .filter(({ relation }) => relation === "explicit_update")
        .every(
          ({ incoming, prior }) =>
            incoming.slot === prior.slot &&
            incoming.context === prior.context &&
            incoming.value !== prior.value,
        ),
    ).toBe(true);
    expect(
      cohort.cases
        .filter(
          ({ relation }) =>
            relation === "same_category_different_dimension",
        )
        .every(
          ({ incoming, prior }) =>
            incoming.legacyCategory === prior.legacyCategory &&
            incoming.slot !== prior.slot,
        ),
    ).toBe(true);
    expect(
      cohort.cases
        .filter(({ relation }) => relation === "contextual_coexistence")
        .every(
          ({ incoming, prior }) =>
            incoming.slot === prior.slot &&
            incoming.context !== prior.context,
        ),
    ).toBe(true);
    expect(
      cohort.cases
        .filter(({ relation }) => relation === "synonymous_repeat")
        .every(
          ({ incoming, prior }) =>
            incoming.slot === prior.slot &&
            incoming.context === prior.context &&
            incoming.value !== prior.value,
        ),
    ).toBe(true);
    expect(
      cohort.cases
        .filter(({ relation }) => relation === "compound_partial_update")
        .every(
          ({ expected, incoming, prior, priorCompanion }) =>
            priorCompanion !== undefined &&
            expected.active.includes("prior_companion") &&
            incoming.slot === prior.slot &&
            priorCompanion.slot !== prior.slot,
        ),
    ).toBe(true);
    expect(
      cohort.cases
        .filter(({ relation }) => relation === "legacy_unkeyed")
        .every(({ prior }) => prior.slot === null),
    ).toBe(true);
    expect(report.policies.recency_lineage).toMatchObject({
      acceptanceCount: 30,
      expectedActiveInstructionAccuracy: 1,
      falseConflictOrFreezeCount: 0,
      generalFallbackAvailabilityRate: 1,
      lineageRecoverabilityRate: 1,
      silentDataLossCount: 0,
      unrecoverableWithExistingReviseOrForgetCount: 0,
    });
    expect(report.policies.current_destructive).toMatchObject({
      expectedActiveInstructionAccuracy: 1 / 3,
      generalFallbackAvailabilityRate: 1,
      lineageRecoverabilityRate: 0,
      silentDataLossCount: 30,
      unrecoverableWithExistingReviseOrForgetCount: 30,
    });
    expect(report.policies.freeze).toMatchObject({
      expectedActiveInstructionAccuracy: 1 / 3,
      falseConflictOrFreezeCount: 15,
      generalFallbackAvailabilityRate: 1 / 3,
      lineageRecoverabilityRate: 1,
      silentDataLossCount: 0,
      unrecoverableWithExistingReviseOrForgetCount: 0,
    });
    expect(report.syntheticOnly).toBe(true);
    expect(report.productionIncidenceClaimed).toBe(false);
  });
});
