import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  verifyPhase74BeamSafetyLiveRun,
} from "./run-phase-74-beam-safety-protection";
import {
  verifyPhase74HaluMemLiveRun,
} from "./run-phase-74-halumem-live-protection";
import {
  PHASE74_BEAM_SAFETY_SUITE,
} from "../src/eval/phase74BeamSafetyProtection";
import {
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_SUITE,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import {
  PHASE74_BEAM_LIVE_CLOSURE_VERIFIER_ID,
  PHASE74_HALUMEM_LIVE_CLOSURE_VERIFIER_ID,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionFileReference,
  Phase74ProtectionLiveClosureReceipt,
  Phase74ProtectionLiveClosureVerifier,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import {
  hashPhase74ProtectionValue,
} from "../src/eval/phase74ProtectionRun";

async function fileReference(
  path: string,
): Promise<Phase74ProtectionFileReference> {
  const absolutePath = resolve(path);
  return {
    path: absolutePath,
    sha256: createHash("sha256")
      .update(await readFile(absolutePath))
      .digest("hex"),
  };
}

function verifierDescriptor(id: string): { id: string; sha256: string } {
  return { id, sha256: hashPhase74ProtectionValue({ id }) };
}

const HALUMEM_SUITES: string[] = [
  PHASE74_HALUMEM_E4_SUITE.id,
  PHASE74_HALUMEM_PRIVACY_SUITE.id,
  PHASE74_HALUMEM_UPDATE_SUITE.id,
].sort();

export const PHASE74_CANONICAL_LIVE_CLOSURE_VERIFIER:
  Phase74ProtectionLiveClosureVerifier = {
    async verify(input) {
      const receipts: Phase74ProtectionLiveClosureReceipt[] = [];
      for (const replicate of [1, 2, 3] as const) {
        const beamRuns = input.runs.filter(({ replicate: runReplicate, suite }) =>
          runReplicate === replicate &&
          suite.id === PHASE74_BEAM_SAFETY_SUITE.id
        );
        if (beamRuns.length !== 1 || beamRuns[0]!.schemaVersion !== 2) {
          throw new Error(
            `Phase 74 BEAM live closure requires one planned replicate ${replicate}.`,
          );
        }
        const beamRun = beamRuns[0]!;
        const beamDirectory = dirname(beamRun.artifactPath);
        if (
          beamRun.artifactPath !== join(beamDirectory, "protection-run.json") ||
          beamRun.rawArtifactPath !== join(beamDirectory, "raw.json")
        ) {
          throw new Error("Phase 74 BEAM live closure layout drifted.");
        }
        const verifiedBeam = await verifyPhase74BeamSafetyLiveRun({
          manifestPath: input.manifest.path,
          runDirectory: beamDirectory,
        });
        receipts.push({
          callBudgetArtifact: await fileReference(
            join(beamDirectory, "call-budget.json"),
          ),
          closureArtifact: await fileReference(verifiedBeam.summaryPath),
          closureVerifier: verifierDescriptor(
            PHASE74_BEAM_LIVE_CLOSURE_VERIFIER_ID,
          ),
          kind: "beam",
          planSha256: input.plan.sha256,
          plannedRunSha256s: [beamRun.plannedRunSha256],
          replicate,
          runIds: [beamRun.runId],
          suiteIds: [beamRun.suite.id],
          usageArtifacts: await Promise.all([
            fileReference(join(beamDirectory, "model-usage-intents.jsonl")),
            fileReference(join(beamDirectory, "model-usage.jsonl")),
          ]),
        });

        const haluRuns = input.runs.filter(({ replicate: runReplicate, suite }) =>
          runReplicate === replicate && HALUMEM_SUITES.includes(suite.id)
        );
        if (
          haluRuns.length !== 3 ||
          haluRuns.some(({ schemaVersion }) => schemaVersion !== 2)
        ) {
          throw new Error(
            `Phase 74 HaluMem live closure requires three planned suite runs for replicate ${replicate}.`,
          );
        }
        const haluDirectory = dirname(dirname(haluRuns[0]!.artifactPath));
        for (const run of haluRuns) {
          const expectedDirectory = run.suite.id === PHASE74_HALUMEM_E4_SUITE.id
            ? "e4"
            : run.suite.id === PHASE74_HALUMEM_PRIVACY_SUITE.id
              ? "privacy"
              : "update";
          if (
            run.artifactPath !==
              join(haluDirectory, expectedDirectory, "protection-run.json") ||
            run.rawArtifactPath !==
              join(haluDirectory, expectedDirectory, "raw.json")
          ) {
            throw new Error("Phase 74 HaluMem live closure layout drifted.");
          }
        }
        await verifyPhase74HaluMemLiveRun(haluDirectory);
        receipts.push({
          callBudgetArtifact: await fileReference(
            join(haluDirectory, "call-budget.json"),
          ),
          closureArtifact: await fileReference(
            join(haluDirectory, "run-completion.json"),
          ),
          closureVerifier: verifierDescriptor(
            PHASE74_HALUMEM_LIVE_CLOSURE_VERIFIER_ID,
          ),
          kind: "halumem",
          planSha256: input.plan.sha256,
          plannedRunSha256s: haluRuns.map((run) => {
            if (run.schemaVersion !== 2) {
              throw new Error("Phase 74 HaluMem live run is not planned.");
            }
            return run.plannedRunSha256;
          }).sort(),
          replicate,
          runIds: haluRuns.map(({ runId }) => runId).sort(),
          suiteIds: haluRuns.map(({ suite }) => suite.id).sort(),
          usageArtifacts: await Promise.all([
            fileReference(join(haluDirectory, "model-usage-intents.jsonl")),
            fileReference(join(haluDirectory, "model-usage-summary.json")),
            fileReference(join(haluDirectory, "model-usage.jsonl")),
          ]),
        });
      }
      return receipts;
    },
  };
