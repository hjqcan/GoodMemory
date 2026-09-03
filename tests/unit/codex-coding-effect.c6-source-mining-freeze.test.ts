import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Phase 73 convergence (2026-09-02): the C6 real-history source-mining family
// (Multi-SWE / SWE-bench Multilingual and Live / GitHub GraphQL and REST
// discovery, reviewer-actor identity, screening frames, source-v3/v4 census
// and activation) is frozen as a diagnostic subset. Six weeks of that work
// accepted zero episodes while the evaluation lane grew past the size of the
// production source tree. New modules in this family must not be added; the
// active track is the flat-summary-controlled internal effect evidence on
// controlled mutations over real repositories. Removing files is allowed.
const FAMILY_PATTERN =
  /(source|census|multilang|github|review-trajectory|reviewer-actor|multi-swe|real-history|wave3|rest-|neighbor|original-request|relationship|screening|transition|actor)/u;

const FROZEN_SOURCE_MINING_FILES = new Set([
  "scripts/activate-codex-coding-effect-c6-source-v4-bounded.ts",
  "scripts/capture-codex-coding-effect-c6-github-graphql-discovery.ts",
  "scripts/capture-codex-coding-effect-c6-github-rest.ts",
  "scripts/capture-codex-coding-effect-c6-live-multilang-neighbor-census.ts",
  "scripts/capture-codex-coding-effect-c6-live-multilang-neighbor-commit-count-eligibility.ts",
  "scripts/capture-codex-coding-effect-c6-live-multilang-neighbor-deep.ts",
  "scripts/capture-codex-coding-effect-c6-rest-identity-supplement.ts",
  "scripts/capture-codex-coding-effect-c6-reviewer-actor-identities.ts",
  "scripts/capture-codex-coding-effect-c6-source-v3-simple-prior-repository-identity.ts",
  "scripts/codex-coding-effect/c6-github-graphql-discovery-inventory.ts",
  "scripts/codex-coding-effect/c6-github-graphql-discovery.ts",
  "scripts/codex-coding-effect/c6-github-rest-capture.ts",
  "scripts/codex-coding-effect/c6-hidden-evaluator-factory.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan-v2.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-census-capture.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-census-continuation-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-census-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-census-qualification.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-capture.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-qualification.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-evidence.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union.ts",
  "scripts/codex-coding-effect/c6-multi-swe-jq-chain-ledger.ts",
  "scripts/codex-coding-effect/c6-multi-swe-jq-source-pool.ts",
  "scripts/codex-coding-effect/c6-multi-swe-original-request.ts",
  "scripts/codex-coding-effect/c6-multi-swe-relationship-discovery.ts",
  "scripts/codex-coding-effect/c6-multilingual-rest-identity-plan.ts",
  "scripts/codex-coding-effect/c6-multilingual-review-trajectory-expansion.ts",
  "scripts/codex-coding-effect/c6-multilingual-source-expansion-plan.ts",
  "scripts/codex-coding-effect/c6-multilingual-source-expansion-qualification.ts",
  "scripts/codex-coding-effect/c6-original-request-semantic-review.ts",
  "scripts/codex-coding-effect/c6-package-source-archive.ts",
  "scripts/codex-coding-effect/c6-package-source-artifact-publication.ts",
  "scripts/codex-coding-effect/c6-package-source-dependency-closure.ts",
  "scripts/codex-coding-effect/c6-package-source-docker-authority.ts",
  "scripts/codex-coding-effect/c6-package-source-receipt-verifier.ts",
  "scripts/codex-coding-effect/c6-package-source-reproducibility.ts",
  "scripts/codex-coding-effect/c6-real-history-original-request-projection.ts",
  "scripts/codex-coding-effect/c6-real-history-prehistory-selection.ts",
  "scripts/codex-coding-effect/c6-real-history-screening-frame.ts",
  "scripts/codex-coding-effect/c6-real-history-semantic-screening.ts",
  "scripts/codex-coding-effect/c6-real-history-transition-evaluator-screening.ts",
  "scripts/codex-coding-effect/c6-real-history-transition-qualification.ts",
  "scripts/codex-coding-effect/c6-real-history-yield.ts",
  "scripts/codex-coding-effect/c6-rest-identity-supplement-capture.ts",
  "scripts/codex-coding-effect/c6-rest-identity-supplement-plan.ts",
  "scripts/codex-coding-effect/c6-rest-identity-supplemented-qualification.ts",
  "scripts/codex-coding-effect/c6-rest-reviewer-actor-filtered-qualification.ts",
  "scripts/codex-coding-effect/c6-review-trajectory-discovery.ts",
  "scripts/codex-coding-effect/c6-review-trajectory-source-expansion.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-derived-classification-v3-gate.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-derived-classification-v3.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-derived-classification.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-filtered-qualification.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-identity-capture.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-identity-plan.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-policy-v2.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-policy-v3.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-policy.ts",
  "scripts/codex-coding-effect/c6-reviewer-actor-qualified-screening-frame.ts",
  "scripts/codex-coding-effect/c6-source-expansion-rest-capture-plan.ts",
  "scripts/codex-coding-effect/c6-source-expansion-rest-qualification.ts",
  "scripts/codex-coding-effect/c6-source-expansion-screening-frame-v2.ts",
  "scripts/codex-coding-effect/c6-source-expansion-screening-frame-v3.ts",
  "scripts/codex-coding-effect/c6-source-expansion-screening-frame-v4.ts",
  "scripts/codex-coding-effect/c6-source-expansion-screening-frame.ts",
  "scripts/codex-coding-effect/c6-source-pool.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-activation.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-artifacts.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-cli.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-contract.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-core.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-errors.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-executor.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-finalization.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-graphql.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-ledger.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-lock.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-pass-runner.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-preflight.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-publication.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-replay.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-runner.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-runtime-source.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-transport.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-exclusion.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-identity-portable-evidence.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-identity-replay-review.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-replay.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-structure.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-promotion.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-review.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-activation.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-contract.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-frame.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-live-contract.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-receipts.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-replay.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-review.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-snapshot.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-v3-observation.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-v3-reuse.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-v3-runtime.ts",
  "scripts/codex-coding-effect/c6-swe-bench-live-multilang-capture-plan.ts",
  "scripts/codex-coding-effect/c6-swe-bench-live-multilang-source-pool.ts",
  "scripts/codex-coding-effect/c6-task-relationship-receipt.ts",
  "scripts/codex-coding-effect/c6-transition-evaluator-review-receipt.ts",
  "scripts/codex-coding-effect/c6-wave3-pretarget-policy.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-artifacts.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-capture.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan.ts",
  "scripts/codex-coding-effect/c6-wave3-source-universe-v2.ts",
  "scripts/codex-coding-effect/c6-wave3-source-universe.ts",
  "scripts/materialize-codex-coding-effect-c6-source-v3-simple-prior-identity-portable-evidence.ts",
  "scripts/materialize-codex-coding-effect-c6-source-v4-bounded.ts",
  "scripts/prepare-codex-coding-effect-c6-source-v3-simple-prior-identity-replay-review.ts",
  "scripts/prepare-codex-coding-effect-c6-source-v3-simple-review.ts",
  "scripts/prepare-codex-coding-effect-c6-source-v4-bounded-review.ts",
  "scripts/promote-codex-coding-effect-c6-source-v3-simple.ts",
  "scripts/rebuild-codex-coding-effect-c6-package-source.ts",
  "scripts/record-codex-coding-effect-c6-source-v3-simple-prior-identity-replay-review-provenance.ts",
  "scripts/record-codex-coding-effect-c6-source-v3-simple-prior-identity-replay.ts",
  "scripts/record-codex-coding-effect-c6-source-v3-simple-review-provenance.ts",
  "scripts/record-codex-coding-effect-c6-source-v4-bounded-review-provenance.ts",
  "scripts/run-codex-coding-effect-c6-source-v3-simple-census.ts",
  "scripts/run-codex-coding-effect-c6-source-v4-bounded-capture.sh",
  "scripts/snapshot-codex-coding-effect-c6-github-graphql-discovery-inventory.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-actor-plan-v2.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-actor-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-continuation-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-continuation-qualification.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-qualification.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-commit-count-eligibility-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-commit-count-eligibility-qualification.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-deep-capture-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-structural-qualification.ts",
  "scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-structural-union.ts",
  "scripts/snapshot-codex-coding-effect-c6-multi-swe-jq-chain-ledger.ts",
  "scripts/snapshot-codex-coding-effect-c6-multi-swe-jq-source-pool.ts",
  "scripts/snapshot-codex-coding-effect-c6-multi-swe-relationship-discovery.ts",
  "scripts/snapshot-codex-coding-effect-c6-multilingual-review-trajectory-expansion.ts",
  "scripts/snapshot-codex-coding-effect-c6-multilingual-source-expansion-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-original-request-projections.ts",
  "scripts/snapshot-codex-coding-effect-c6-real-history-transition-qualification.ts",
  "scripts/snapshot-codex-coding-effect-c6-real-history-yield.ts",
  "scripts/snapshot-codex-coding-effect-c6-rest-identity-supplement-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-rest-identity-supplemented-qualification.ts",
  "scripts/snapshot-codex-coding-effect-c6-review-trajectory-discovery.ts",
  "scripts/snapshot-codex-coding-effect-c6-review-trajectory-source-expansion.ts",
  "scripts/snapshot-codex-coding-effect-c6-reviewer-actor-derived-classification-v3.ts",
  "scripts/snapshot-codex-coding-effect-c6-reviewer-actor-derived-classification.ts",
  "scripts/snapshot-codex-coding-effect-c6-source-expansion-rest-capture-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-source-expansion-rest-qualification.ts",
  "scripts/snapshot-codex-coding-effect-c6-source-expansion-screening-frame-v2.ts",
  "scripts/snapshot-codex-coding-effect-c6-source-expansion-screening-frame.ts",
  "scripts/snapshot-codex-coding-effect-c6-source-pool.ts",
  "scripts/snapshot-codex-coding-effect-c6-wave3-pretarget-policy.ts",
  "scripts/snapshot-codex-coding-effect-c6-wave3-prior-repository-identity-plan.ts",
  "scripts/snapshot-codex-coding-effect-c6-wave3-source-universe-v2.ts",
  "scripts/snapshot-codex-coding-effect-c6-wave3-source-universe.ts",
]);

function currentFamilyFiles(): string[] {
  const repoRoot = join(import.meta.dir, "..", "..");
  const moduleDirectory = "scripts/codex-coding-effect";
  const modules = readdirSync(join(repoRoot, moduleDirectory))
    .filter((name) => name.startsWith("c6-") && FAMILY_PATTERN.test(name))
    .map((name) => `${moduleDirectory}/${name}`);
  const entrypoints = readdirSync(join(repoRoot, "scripts"))
    .filter((name) =>
      name.includes("codex-coding-effect-c6") && FAMILY_PATTERN.test(name)
    )
    .map((name) => `scripts/${name}`);
  return [...modules, ...entrypoints].sort();
}

describe("Phase 73 convergence: C6 source-mining family freeze", () => {
  it("adds no new real-history source-mining modules or entrypoints", () => {
    const added = currentFamilyFiles().filter((path) =>
      !FROZEN_SOURCE_MINING_FILES.has(path)
    );
    expect(
      added,
      "the C6 real-history source-mining family is frozen as a diagnostic subset (task-board/78, Convergence 2026-09-02); build the flat-summary-controlled track instead",
    ).toEqual([]);
  });

  it("keeps the frozen allowlist bounded to the paused family", () => {
    expect(FROZEN_SOURCE_MINING_FILES.size).toBe(169);
    for (const path of FROZEN_SOURCE_MINING_FILES) {
      expect(FAMILY_PATTERN.test(path)).toBe(true);
    }
  });
});
