import { createHash } from "node:crypto";
import { basename } from "node:path";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  buildC6ReviewerActorDerivedClassificationV3,
  parseC6ReviewerActorDerivedClassificationV3,
  serializeC6ReviewerActorDerivedClassificationV3,
} from "./c6-reviewer-actor-derived-classification-v3";

const FROZEN_CLASSIFICATION = {
  bytes: 225_600,
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-derived-classification-v3.json",
  sha256:
    "7b8a812b7740ce2703eee470b01043fce8f8a64a120dca5ebc11f8226920696b",
} as const;

export interface C6ReviewerActorDerivedClassificationV3GateInput {
  actorPlanPath: string;
  actorRoot: string;
  classificationPath: string;
}

export async function runC6ReviewerActorDerivedClassificationV3Gate(
  input: C6ReviewerActorDerivedClassificationV3GateInput,
) {
  const frozenBytes = await readC6StableRegularFile(
    input.classificationPath,
    "reviewer actor v3 gate classification",
  );
  if (
    basename(input.classificationPath) !==
      FROZEN_CLASSIFICATION.path ||
    frozenBytes.byteLength !== FROZEN_CLASSIFICATION.bytes ||
    sha256(frozenBytes) !== FROZEN_CLASSIFICATION.sha256
  ) {
    throw new Error(
      "C6 reviewer actor v3 gate classification hash mismatch",
    );
  }
  const frozen =
    parseC6ReviewerActorDerivedClassificationV3(frozenBytes);
  const rebuilt =
    await buildC6ReviewerActorDerivedClassificationV3({
      actorPlanPath: input.actorPlanPath,
      actorRoot: input.actorRoot,
    });
  if (
    rebuilt.outputSha256 !== FROZEN_CLASSIFICATION.sha256 ||
    serializeC6ReviewerActorDerivedClassificationV3(
      rebuilt.classification,
    ) !== frozenBytes.toString("utf8") ||
    JSON.stringify(rebuilt.classification) !==
      JSON.stringify(frozen)
  ) {
    throw new Error(
      "C6 reviewer actor v3 gate replay mismatch",
    );
  }
  const terminalBytes = await readC6StableRegularFile(
    input.classificationPath,
    "reviewer actor v3 gate terminal classification",
  );
  if (!terminalBytes.equals(frozenBytes)) {
    throw new Error(
      "C6 reviewer actor v3 gate classification changed",
    );
  }
  return {
    acceptedEpisodeCount: 0 as const,
    codexRunReady: false as const,
    counts: frozen.counts,
    independentReviewCompleted: false as const,
    outputBytes: frozenBytes.byteLength,
    outputSha256: sha256(frozenBytes),
    passed: true as const,
    selectionExecuted: false as const,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
