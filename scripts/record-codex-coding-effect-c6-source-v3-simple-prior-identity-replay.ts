import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "./codex-coding-effect/c6-source-v3-simple-prior-repository-identity-replay";

const OPTION_NAMES = new Set([
  "capture-a",
  "capture-b",
  "output",
  "plan",
  "protocol",
  "source-universe",
]);

export interface C6SourceV3SimplePriorRepositoryIdentityReplayCliOptions {
  captureA: string;
  captureB: string;
  outputPath: string;
  planPath: string;
  protocolPath: string;
  sourceUniversePath: string;
}

export function parseC6SourceV3SimplePriorRepositoryIdentityReplayCliOptions(
  args: readonly string[],
): C6SourceV3SimplePriorRepositoryIdentityReplayCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `unknown C6 source-v3-simple prior identity replay argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 source-v3-simple prior identity replay option --${name}`,
      );
    }
    if (values.has(name!)) {
      throw new Error(
        `--${name} cannot be specified more than once`,
      );
    }
    if (value!.length === 0 || value!.trim() !== value) {
      throw new Error(
        `--${name} must not be empty or padded`,
      );
    }
    values.set(name!, value!);
  }
  return {
    captureA: required(values, "capture-a"),
    captureB: required(values, "capture-b"),
    outputPath: required(values, "output"),
    planPath: required(values, "plan"),
    protocolPath: required(values, "protocol"),
    sourceUniversePath: required(
      values,
      "source-universe",
    ),
  };
}

export async function materializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
  input: C6SourceV3SimplePriorRepositoryIdentityReplayCliOptions,
): Promise<{
  candidateManifestFrozen: false;
  codexRunReady: false;
  formalCensusPermitted: false;
  outputPath: string;
  priorRepositoryNodeIdExclusionComplete: false;
  receiptBytes: number;
  receiptSha256: string;
  repositoryIdentityReplayAgreementObserved: true;
  sourceV3SimpleFrozen: false;
}> {
  const replayInput = {
    captureA: resolve(input.captureA),
    captureB: resolve(input.captureB),
    planPath: resolve(input.planPath),
    protocolPath: resolve(input.protocolPath),
    sourceUniversePath: resolve(input.sourceUniversePath),
  };
  const outputPath = resolve(input.outputPath);
  const receipt =
    await buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      replayInput,
    );
  const bytes =
    serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      receipt,
    );
  await writeFile(outputPath, bytes, {
    encoding: "utf8",
    flag: "wx",
  });
  const publishedBytes = await readFile(outputPath);
  const published =
    await verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      publishedBytes,
      replayInput,
    );
  const canonicalPublished =
    serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      published,
    );
  return {
    candidateManifestFrozen: false,
    codexRunReady: false,
    formalCensusPermitted: false,
    outputPath,
    priorRepositoryNodeIdExclusionComplete: false,
    receiptBytes: Buffer.byteLength(canonicalPublished),
    receiptSha256: sha256(canonicalPublished),
    repositoryIdentityReplayAgreementObserved: true,
    sourceV3SimpleFrozen: false,
  };
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.main) {
  const options =
    parseC6SourceV3SimplePriorRepositoryIdentityReplayCliOptions(
      process.argv.slice(2),
    );
  const result =
    await materializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      options,
    );
  console.log(JSON.stringify(result, null, 2));
}
